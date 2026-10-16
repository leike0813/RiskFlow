import { randomUUID } from "node:crypto";

import { sql, type ColumnType, type Kysely, type Selectable, type Transaction } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  KnowledgeLifecycleError,
  selectGovernedReleaseCandidates,
  validateApprovalProof,
  validateCandidateArtifactIdentity,
  validatePublicationTimeline,
  validateRevisionBase,
  KnowledgeDefinitionV1Schema,
  KnowledgeReleaseDecisionV1Schema,
  KnowledgeReleaseV2Schema,
  KnowledgeRevisionV1Schema,
  KnowledgeReviewLinkV1Schema,
  ResolveGovernedReleasesRequestV1Schema,
  type KnowledgeRelease,
  type KnowledgeRevisionV1,
} from "@riskflow/core/knowledge-governance";
import {
  isScoringRulesDefinitionTypeV1,
  ScoringRuleError,
  scoringRuleFailureFrom,
  type PreparedScoringRuleV1,
  type ScoringRuleReleaseAppendV1,
  type ScoringRuleRevisionAppendV1,
  type ScoringRulesDefinitionTypeV1,
  type ScoringRulesGovernancePolicyV1,
  type SubmitScoringRuleRevisionV1,
} from "@riskflow/core/scoring-rules";
import {
  AssessmentConfigurationError,
  assessmentConfigurationFailureFrom,
  isAssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationGovernancePolicyV1,
  type AssessmentConfigurationReleaseAppendV1,
  type AssessmentConfigurationRevisionAppendV1,
  type PreparedAssessmentConfigurationV1,
  type SubmitAssessmentConfigurationRevisionV1,
} from "@riskflow/core/assessment-config";
import {
  isIdentificationKnowledgeDefinitionTypeV1,
  type IdentificationKnowledgeGovernancePolicyV1,
} from "@riskflow/core/identification-knowledge";
import {
  ContractReferenceV1Schema,
  KnowledgeDefinitionTypeV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  type ContentArtifactRefV1,
  type KnowledgeDefinitionTypeV1,
  KnowledgeRevisionApprovalProofResultV1Schema,
  KnowledgeRevisionApprovalProofQueryV1Schema,
  KnowledgeRevisionRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeGovernanceResultV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ReviewRequestV1Schema,
  ReviewTaskRefV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeGovernanceResultForCommandV1,
  type KnowledgeRevisionApprovalProofV1,
  type KnowledgeRevisionRefV1,
  type KnowledgeReleaseRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewAuditPortV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import type { DomainEventV1 } from "@riskflow/contracts/events";

import { makePersistenceError, mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface KnowledgeDefinitionRow {
  definition_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  created_by: string;
  authorization_context_ref: JsonColumn;
  command_id: string;
  audit_entry_id: string;
  created_at: TimestampColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface KnowledgeRevisionRow {
  revision_id: string;
  version_id: string;
  definition_id: string;
  definition_version_id: string;
  project_id: string;
  definition_type: string;
  candidate_artifact_entity_id: string;
  candidate_artifact_version_id: string;
  candidate_artifact_ref: JsonColumn;
  evidence_references: JsonColumn;
  base_release_ref: JsonColumn | null;
  base_revision_ref: JsonColumn | null;
  artifact_identity_digest: string;
  command_id: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface KnowledgeReviewLinkRow {
  review_attempt_id: string;
  version_id: string;
  project_id: string;
  revision_id: string;
  revision_version_id: string;
  revision_ref: JsonColumn;
  review_policy_entity_id: string;
  review_policy_version_id: string;
  review_policy_ref: JsonColumn;
  validation_snapshot_ref: JsonColumn;
  evidence_snapshot_ref: JsonColumn;
  waiting_run_ref: JsonColumn;
  review_task_ref: JsonColumn | null;
  review_decision_ref: JsonColumn | null;
  state: "waiting" | "linked";
  requested_by: string;
  authorization_context_ref: JsonColumn;
  command_id: string;
  audit_entry_id: string;
  requested_at: TimestampColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface KnowledgeReleaseRow {
  release_id: string;
  version_id: string;
  definition_id: string;
  definition_version_id: string;
  project_id: string;
  definition_type: string;
  revision_id: string;
  revision_version_id: string;
  revision_ref: JsonColumn;
  review_task_ref: JsonColumn | null;
  review_decision_ref: JsonColumn | null;
  publication_origin: JsonColumn | null;
  derivation_scope_key: string | null;
  effective_from: TimestampColumn;
  restored_from_release_ref: JsonColumn | null;
  reason_code: string | null;
  command_id: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface KnowledgeReleaseDecisionRow {
  decision_id: string;
  version_id: string;
  release_id: string;
  release_version_id: string;
  project_id: string;
  definition_id: string;
  release_ref: JsonColumn;
  decision: "deactivated";
  reason_code: string;
  command_id: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

type KnowledgeGovernanceDatabase = PostgresDatabase & {
  "business.knowledge_definitions": KnowledgeDefinitionRow;
  "business.knowledge_revisions": KnowledgeRevisionRow;
  "business.knowledge_review_links": KnowledgeReviewLinkRow;
  "business.knowledge_releases": KnowledgeReleaseRow;
  "business.knowledge_release_decisions": KnowledgeReleaseDecisionRow;
};
type KnowledgeTransaction = Transaction<KnowledgeGovernanceDatabase>;

const asKnowledgeTransaction = (context: TransactionContextV1): KnowledgeTransaction =>
  getPostgresTransaction(context) as unknown as KnowledgeTransaction;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("value is not JSON serializable");
  return JSON.parse(serialized) as JsonValue;
};

const jsonbValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("value is not JSON serializable");
  return serialized as unknown as JsonValue;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const versionedReferenceEquals = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const asContractReference = (value: unknown): ContractReferenceV1 =>
  ContractReferenceV1Schema.parse(value);

const lifecycleDomainError = (error: KnowledgeLifecycleError) => {
  const mapped = makePersistenceError("TRANSACTION_FAILED", "knowledge-governance.domain");
  Object.defineProperty(mapped, "knowledgeFailure", { value: error.failure });
  return mapped;
};

const assessmentConfigurationDomainError = (error: AssessmentConfigurationError) => {
  const mapped = makePersistenceError(
    "TRANSACTION_FAILED",
    "knowledge-governance.assessment-configuration",
  );
  Object.defineProperty(mapped, "assessmentConfigurationFailure", { value: error.failure });
  return mapped;
};

const atomicPayload = (value: object): Record<string, JsonValue> =>
  jsonValue(value) as Record<string, JsonValue>;

const atomicCommand = (
  command: KnowledgeGovernanceCommandV1,
  commandKind = `knowledge.${command.kind}.v1`,
  payload: object = command,
  commandId = command.commandId,
  idempotencyKey = command.idempotencyKey,
  authorization = command.authorization,
): AtomicCommandV1 =>
  AtomicCommandV1Schema.parse({
    projectId: command.projectId,
    commandKind,
    commandId,
    idempotencyKey,
    payload: atomicPayload(payload),
    actorRef: command.actorId,
    authorizationContextRef: authorization.authorizationContextRef,
    issuedAt: command.issuedAt,
  });

const auditCommit = (input: {
  command: AtomicCommandV1;
  targetRef: ContractReferenceV1;
  action: string;
  occurredAt: string;
  recordedAt: string;
  auditEntryId?: string;
}): AtomicCommitV1["audit"] => ({
  auditEntryId: input.auditEntryId ?? randomId("audit"),
  projectId: input.command.projectId,
  action: input.action,
  targetRef: input.targetRef,
  actorRef: input.command.actorRef,
  authorizationContextRef: input.command.authorizationContextRef,
  occurredAt: input.occurredAt,
  recordedAt: input.recordedAt,
  version:
    "reference" in input.targetRef
      ? input.targetRef.reference
      : { entityId: input.targetRef.eventId, versionId: String(input.targetRef.eventVersion) },
  commandId: input.command.commandId,
  idempotencyKey: input.command.idempotencyKey,
});

const commitWithoutEvents = (input: {
  command: AtomicCommandV1;
  targetRef: ContractReferenceV1;
  action: string;
  occurredAt: string;
  recordedAt: string;
  auditEntryId?: string;
}): AtomicCommitV1 => {
  const audit = auditCommit(input);
  return { resultRef: input.targetRef, audit, events: [] };
};

const knowledgeBranch = (kind: KnowledgeGovernanceCommandV1["kind"]): ModuleBranchV1 =>
  `knowledge-modeling.${kind}` as ModuleBranchV1;

const refKey = (value: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): string => `${value.reference.entityId}:${value.reference.versionId}`;

const targetForRevision = (revisionRef: KnowledgeRevisionRefV1): ContractReferenceV1 =>
  asContractReference(revisionRef);

const targetForRelease = (releaseRef: KnowledgeReleaseRefV1): ContractReferenceV1 =>
  asContractReference(releaseRef);

const lifecycleFailureFrom = (error: unknown): KnowledgeLifecycleError["failure"] | undefined => {
  if (error instanceof KnowledgeLifecycleError) return error.failure;
  if (error instanceof Error && "knowledgeFailure" in error) {
    const failure = (error as Error & { knowledgeFailure?: unknown }).knowledgeFailure;
    return typeof failure === "object" && failure !== null
      ? (failure as KnowledgeLifecycleError["failure"])
      : undefined;
  }
  return undefined;
};

const moduleError = (
  value:
    | { code: "AUTHORIZATION_DENIED"; branch: ModuleBranchV1; causalRunId: string }
    | {
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        targetRef: ContractReferenceV1;
        currentRef?: ContractReferenceV1;
        causalRunId: string;
      }
    | {
        code: "BUSINESS_BLOCKED";
        blockerKind: string;
        blockerRef: ContractReferenceV1;
        causalRunId: string;
      }
    | {
        code: "IDEMPOTENCY_CONFLICT";
        idempotencyKey: string;
        priorCommandId: string;
        causalRunId: string;
      }
    | { code: "UNSUPPORTED_CONTRACT"; causalRunId: string }
    | { code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE"; causalRunId: string },
): ModuleErrorV1 => {
  const common = {
    stageCode: `knowledge-governance.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId: IdentifierSchema.parse(value.causalRunId),
  };
  if (value.code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code: value.code,
      category: "authorization",
      retryable: false,
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1[value.branch],
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    };
  }
  if (value.code === "ENTITY_NOT_FOUND" || value.code === "STALE_VERSION") {
    return {
      ...common,
      code: value.code,
      category: value.code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
      retryable: false,
      targetRef: value.targetRef,
      ...(value.code === "STALE_VERSION" && value.currentRef === undefined
        ? {}
        : value.code === "STALE_VERSION"
          ? { currentRef: value.currentRef }
          : {}),
    } as ModuleErrorV1;
  }
  if (value.code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code: value.code,
      category: "business-blocked",
      retryable: false,
      blockerKind: IdentifierSchema.parse(value.blockerKind),
      blockerRef: value.blockerRef,
    };
  }
  if (value.code === "IDEMPOTENCY_CONFLICT") {
    return {
      ...common,
      code: value.code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: IdentifierSchema.parse(value.idempotencyKey),
      priorCommandId: IdentifierSchema.parse(value.priorCommandId),
    };
  }
  if (value.code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: false,
      schemaVersion: "1",
    };
  }
  if (value.code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: { entityId: "knowledge-governance-retry-policy", versionId: "1" },
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "knowledge-governance-transient-failure", versionId: "1" },
      },
    };
  }
  return {
    ...common,
    code: value.code,
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "knowledge-governance-terminal-failure", versionId: "1" },
    },
  };
};

const definitionFromRow = (row: Selectable<KnowledgeDefinitionRow>) =>
  KnowledgeDefinitionV1Schema.parse({
    definitionRef: {
      kind: "knowledge-definition",
      reference: { entityId: row.definition_id, versionId: row.version_id },
    },
    projectId: row.project_id,
    definitionType: row.definition_type,
    createdBy: row.created_by,
    authorizationContextRef: row.authorization_context_ref,
    createdAt: asIso(row.created_at),
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

const revisionFromRow = (row: Selectable<KnowledgeRevisionRow>) =>
  KnowledgeRevisionV1Schema.parse({
    revisionRef: {
      kind: "knowledge-revision",
      reference: { entityId: row.revision_id, versionId: row.version_id },
    },
    definitionRef: {
      kind: "knowledge-definition",
      reference: { entityId: row.definition_id, versionId: row.definition_version_id },
    },
    projectId: row.project_id,
    definitionType: row.definition_type,
    candidateArtifactRef: row.candidate_artifact_ref,
    evidenceReferences: row.evidence_references,
    ...(row.base_release_ref === null ? {} : { baseReleaseRef: row.base_release_ref }),
    ...(row.base_revision_ref === null ? {} : { baseRevisionRef: row.base_revision_ref }),
    artifactIdentityDigest: row.artifact_identity_digest,
    commandId: row.command_id,
    actorId: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

const reviewLinkFromRow = (row: Selectable<KnowledgeReviewLinkRow>) =>
  KnowledgeReviewLinkV1Schema.parse({
    reviewAttemptId: row.review_attempt_id,
    projectId: row.project_id,
    revisionRef: row.revision_ref,
    reviewPolicyRef: row.review_policy_ref,
    validationSnapshotRef: row.validation_snapshot_ref,
    evidenceSnapshotRef: row.evidence_snapshot_ref,
    waitingRunRef: row.waiting_run_ref,
    ...(row.review_task_ref === null ? {} : { reviewTaskRef: row.review_task_ref }),
    ...(row.review_decision_ref === null ? {} : { reviewDecisionRef: row.review_decision_ref }),
    state: row.state,
    requestedBy: row.requested_by,
    authorizationContextRef: row.authorization_context_ref,
    requestedAt: asIso(row.requested_at),
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

const releaseFromRow = (row: Selectable<KnowledgeReleaseRow>) =>
  KnowledgeReleaseV2Schema.parse({
    schemaVersion: "2",
    releaseRef: {
      kind: "knowledge-release",
      reference: { entityId: row.release_id, versionId: row.version_id },
    },
    definitionRef: {
      kind: "knowledge-definition",
      reference: { entityId: row.definition_id, versionId: row.definition_version_id },
    },
    projectId: row.project_id,
    definitionType: row.definition_type,
    revisionRef: row.revision_ref,
    publicationOrigin: row.publication_origin ?? {
      kind: "human-reviewed",
      reviewTaskRef: row.review_task_ref,
      reviewDecisionRef: row.review_decision_ref,
    },
    effectiveFrom: asIso(row.effective_from),
    ...(row.restored_from_release_ref === null
      ? {}
      : { restoredFromReleaseRef: row.restored_from_release_ref }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    commandId: row.command_id,
    actorId: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

const decisionFromRow = (row: Selectable<KnowledgeReleaseDecisionRow>) =>
  KnowledgeReleaseDecisionV1Schema.parse({
    decisionRef: {
      kind: "knowledge-release-decision",
      reference: { entityId: row.decision_id, versionId: row.version_id },
    },
    releaseRef: row.release_ref,
    projectId: row.project_id,
    decision: row.decision,
    reasonCode: row.reason_code,
    commandId: row.command_id,
    actorId: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

/**
 * C16 组合解析的稳定调用身份：解析调用方（含 C17 发布策略）必须用同一派生为 C06 上下文
 * 授权，否则 `resolveGovernedReleases` 会按 invocationId 绑定拒绝。
 */
export const governedReleaseResolutionInvocationId = (input: {
  readonly requiredDefinitionTypes: readonly string[];
  readonly requiredAt: string;
  readonly asOfRecordedAt: string;
}): string =>
  `knowledge-resolve-${sha256CanonicalJson({
    requiredTypes: input.requiredDefinitionTypes.map((value) =>
      KnowledgeDefinitionTypeV1Schema.parse(value),
    ),
    requiredAt: input.requiredAt,
    asOfRecordedAt: input.asOfRecordedAt,
  })}`;

/**
 * C16→C07 的结构化授权请求：C16 派生精确 `invocationId`、`branch` 和目标引用，
 * provider 只把请求交给受信来源与 C06，不得改写调用身份或能力。
 */
export type KnowledgeGovernanceReviewAuthorizationRequestV1 =
  | {
      readonly task: "request-review";
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt: string;
      readonly branch: "review-audit.request-review";
      readonly reviewAttemptId: string;
      readonly revisionRef: KnowledgeRevisionRefV1;
    }
  | {
      readonly task: "verify-knowledge-revision-approval";
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt: string;
      readonly branch: "review-audit.verify-knowledge-revision-approval";
      readonly revisionRef: KnowledgeRevisionRefV1;
      readonly reviewDecisionRef: ReviewDecisionRefV1;
    };

export interface KnowledgeGovernanceReviewAuthorizationProviderV1 {
  authorize(
    input: KnowledgeGovernanceReviewAuthorizationRequestV1,
  ): Promise<AuthorizationContextV1>;
}

/** D-11：复核上下文必须绑定请求的工程、actor 且只携带该分支的唯一能力。 */
const reviewContextMatches = (
  context: AuthorizationContextV1,
  request: KnowledgeGovernanceReviewAuthorizationRequestV1,
  requiredCapability: "review-audit.request" | "review-audit.read",
): boolean =>
  context.projectId === request.projectId &&
  context.actorId === request.actorId &&
  context.grantedCapabilities.length === 1 &&
  context.grantedCapabilities[0] === requiredCapability;

export interface PostgresKnowledgeGovernanceAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly reviewAudit: ReviewAuditPortV1;
  readonly now?: () => Date;
  /** Optional C18 content policy; C18 definition types are blocked without it. */
  readonly assessmentConfigurationPolicy?: AssessmentConfigurationGovernancePolicyV1;
  /** C17 识别知识治理接缝：与 C18 的策略同构，在发布/回滚事务内写绑定并产出领域事件。 */
  readonly identificationKnowledgePolicy?: IdentificationKnowledgeGovernancePolicyV1;
  /** Optional C19 content policy; C19 definition types are blocked without it. */
  readonly scoringRulesPolicy?: ScoringRulesGovernancePolicyV1;
  /**
   * D-11：C16→C07 结构化授权来源。C16 派生精确调用身份与分支，provider 返回上下文后
   * C16 复验工程/actor/唯一能力；缺失或绑定不符在 C07 读取前关闭失败。
   */
  readonly reviewAuthorizationProvider?: KnowledgeGovernanceReviewAuthorizationProviderV1;
}

export interface DerivedKnowledgeReleaseInput {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly effectiveFrom: string;
  readonly authorization: AuthorizationContextV1;
  readonly definitionType: "retrieval-evidence-base" | "applicable-rule-set";
  readonly candidateArtifactRef: ContentArtifactRefV1;
  readonly evidenceReferences: KnowledgeRevisionV1["evidenceReferences"];
  readonly parentReleaseRefs: readonly KnowledgeReleaseRefV1[];
  readonly derivationPolicyRef: VersionReference;
  readonly contextRef: ContractReferenceV1;
  readonly derivationScopeKey?: string;
  readonly append: (
    context: TransactionContextV1,
    input: {
      readonly revision: KnowledgeRevisionV1;
      readonly releaseRef: KnowledgeReleaseRefV1;
      readonly audit: AtomicCommitV1["audit"];
      readonly recordedAt: string;
    },
  ) => Promise<readonly DomainEventV1[]>;
}

export class PostgresKnowledgeGovernanceAdapter {
  readonly #db: Kysely<KnowledgeGovernanceDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #reviewAudit: ReviewAuditPortV1;
  readonly #now: () => Date;
  readonly #assessmentConfigurationPolicy: AssessmentConfigurationGovernancePolicyV1 | undefined;
  readonly #identificationKnowledgePolicy: IdentificationKnowledgeGovernancePolicyV1 | undefined;
  readonly #scoringRulesPolicy: ScoringRulesGovernancePolicyV1 | undefined;
  readonly #reviewAuthorizationProvider:
    KnowledgeGovernanceReviewAuthorizationProviderV1 | undefined;

  constructor(options: PostgresKnowledgeGovernanceAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<KnowledgeGovernanceDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#reviewAudit = options.reviewAudit;
    this.#now = options.now ?? (() => new Date());
    this.#assessmentConfigurationPolicy = options.assessmentConfigurationPolicy;
    this.#identificationKnowledgePolicy = options.identificationKnowledgePolicy;
    this.#scoringRulesPolicy = options.scoringRulesPolicy;
    this.#reviewAuthorizationProvider = options.reviewAuthorizationProvider;
  }

  /** C17/C19 确定性组装的内部事务入口，来源是已批准父发布。 */
  async publishDerivedRelease(input: DerivedKnowledgeReleaseInput): Promise<{
    readonly releaseRef: KnowledgeReleaseRefV1;
    readonly revisionRef: KnowledgeRevisionRefV1;
  }> {
    const origin = KnowledgeReleaseV2Schema.shape.publicationOrigin.parse({
      kind: "derived-approved",
      parentReleaseRefs: input.parentReleaseRefs,
      derivationPolicyRef: input.derivationPolicyRef,
      contextRef: input.contextRef,
    });
    const identity = sha256CanonicalJson(
      input.definitionType === "retrieval-evidence-base"
        ? {
            projectId: input.projectId,
            definitionType: input.definitionType,
            parentReleaseRefs: input.parentReleaseRefs,
            derivationPolicyRef: input.derivationPolicyRef,
          }
        : {
            projectId: input.projectId,
            definitionType: input.definitionType,
            candidateArtifactRef: input.candidateArtifactRef,
            publicationOrigin: origin,
            derivationScopeKey: input.derivationScopeKey ?? null,
          },
    );
    const revisionRef = KnowledgeRevisionRefV1Schema.parse({
      kind: "knowledge-revision",
      reference: { entityId: `derived-revision:${identity}`, versionId: "1" },
    });
    const releaseRef = KnowledgeReleaseRefV1Schema.parse({
      kind: "knowledge-release",
      reference: { entityId: `derived-release:${identity}`, versionId: "1" },
    });
    const atomic = AtomicCommandV1Schema.parse({
      projectId: input.projectId,
      commandKind: "knowledge.publish-derived-release.v2",
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      actorRef: input.actorId,
      authorizationContextRef: input.authorization.authorizationContextRef,
      issuedAt: input.issuedAt,
      payload: { identity, effectiveFrom: input.effectiveFrom },
    });
    await this.#transactionUnit.execute(atomic, async (context) => {
      const tx = asKnowledgeTransaction(context);
      await this.#lock(tx, `${input.projectId}:${input.definitionType}`);
      const existing = await this.#findRelease(tx, input.projectId, releaseRef);
      const recordedAt = nowIso(this.#now);
      const audit = auditCommit({
        command: atomic,
        targetRef: releaseRef,
        action: "knowledge.publish-derived-release",
        occurredAt: input.issuedAt,
        recordedAt,
      });
      if (existing !== undefined) return { resultRef: releaseRef, audit, events: [] };
      for (const parentRef of input.parentReleaseRefs) {
        const parent = await this.#findRelease(tx, input.projectId, parentRef);
        if (parent === undefined)
          throwLifecycle("BUSINESS_BLOCKED", "derived-parent-release-unavailable", parentRef);
      }
      const definitionRow = await tx
        .selectFrom("business.knowledge_definitions")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("definition_type", "=", input.definitionType)
        .executeTakeFirst();
      const definitionRef =
        definitionRow === undefined
          ? {
              kind: "knowledge-definition" as const,
              reference: { entityId: randomId("knowledge-definition"), versionId: "1" },
            }
          : definitionFromRow(definitionRow).definitionRef;
      if (definitionRow === undefined)
        await tx
          .insertInto("business.knowledge_definitions")
          .values({
            definition_id: definitionRef.reference.entityId,
            version_id: definitionRef.reference.versionId,
            project_id: input.projectId,
            definition_type: input.definitionType,
            created_by: input.actorId,
            authorization_context_ref: jsonbValue(input.authorization.authorizationContextRef),
            command_id: input.commandId,
            audit_entry_id: audit.auditEntryId,
            created_at: input.issuedAt,
            occurred_at: input.issuedAt,
            recorded_at: recordedAt,
            persisted_at: recordedAt,
          })
          .execute();
      const revision = KnowledgeRevisionV1Schema.parse({
        revisionRef,
        definitionRef,
        projectId: input.projectId,
        definitionType: input.definitionType,
        candidateArtifactRef: input.candidateArtifactRef,
        evidenceReferences: input.evidenceReferences,
        artifactIdentityDigest: sha256CanonicalJson(input.candidateArtifactRef),
        commandId: input.commandId,
        actorId: input.actorId,
        authorizationContextRef: input.authorization.authorizationContextRef,
        occurredAt: input.issuedAt,
        recordedAt,
        persistedAt: recordedAt,
      });
      await tx
        .insertInto("business.knowledge_revisions")
        .values({
          revision_id: revisionRef.reference.entityId,
          version_id: revisionRef.reference.versionId,
          definition_id: definitionRef.reference.entityId,
          definition_version_id: definitionRef.reference.versionId,
          project_id: input.projectId,
          definition_type: input.definitionType,
          candidate_artifact_entity_id: input.candidateArtifactRef.reference.entityId,
          candidate_artifact_version_id: input.candidateArtifactRef.reference.versionId,
          candidate_artifact_ref: jsonbValue(input.candidateArtifactRef),
          evidence_references: jsonbValue(input.evidenceReferences),
          base_release_ref: null,
          base_revision_ref: null,
          artifact_identity_digest: revision.artifactIdentityDigest,
          command_id: input.commandId,
          actor_ref: input.actorId,
          authorization_context_ref: jsonbValue(input.authorization.authorizationContextRef),
          audit_entry_id: audit.auditEntryId,
          occurred_at: input.issuedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        })
        .execute();
      const release = KnowledgeReleaseV2Schema.parse({
        schemaVersion: "2",
        publicationOrigin: origin,
        releaseRef,
        definitionRef,
        projectId: input.projectId,
        definitionType: input.definitionType,
        revisionRef,
        effectiveFrom: input.effectiveFrom,
        commandId: input.commandId,
        actorId: input.actorId,
        authorizationContextRef: input.authorization.authorizationContextRef,
        occurredAt: input.issuedAt,
        recordedAt,
      });
      await tx
        .insertInto("business.knowledge_releases")
        .values({
          release_id: releaseRef.reference.entityId,
          version_id: releaseRef.reference.versionId,
          definition_id: definitionRef.reference.entityId,
          definition_version_id: definitionRef.reference.versionId,
          project_id: input.projectId,
          definition_type: input.definitionType,
          revision_id: revisionRef.reference.entityId,
          revision_version_id: revisionRef.reference.versionId,
          revision_ref: jsonbValue(revisionRef),
          review_task_ref: null,
          review_decision_ref: null,
          publication_origin: jsonbValue(release.publicationOrigin),
          derivation_scope_key: input.derivationScopeKey ?? null,
          effective_from: input.effectiveFrom,
          restored_from_release_ref: null,
          reason_code: null,
          command_id: input.commandId,
          actor_ref: input.actorId,
          authorization_context_ref: jsonbValue(input.authorization.authorizationContextRef),
          audit_entry_id: audit.auditEntryId,
          occurred_at: input.issuedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        })
        .execute();
      const events = await input.append(context, { revision, releaseRef, audit, recordedAt });
      return { resultRef: releaseRef, audit, events: [...events] };
    });
    return { releaseRef, revisionRef };
  }

  async govern<T extends KnowledgeGovernanceCommandV1>(
    command: T,
  ): Promise<KnowledgeGovernanceResultForCommandV1<T>> {
    const parsed = KnowledgeGovernanceCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "knowledge-governance" }),
      } as KnowledgeGovernanceResultForCommandV1<T>;
    }
    const valid = parsed.data;
    let result: ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>;
    switch (valid.kind) {
      case "submit-revision":
        result = await this.#submit(valid);
        break;
      case "request-review":
        result = await this.#requestReview(valid);
        break;
      case "publish-approved-release":
        result = await this.#publish(valid);
        break;
      case "deactivate-release":
        result = await this.#deactivate(valid);
        break;
      case "rollback-by-new-release":
        result = await this.#rollback(valid);
        break;
    }
    return result as KnowledgeGovernanceResultForCommandV1<T>;
  }

  async resolveGovernedReleases(input: {
    readonly invocationId?: string;
    readonly projectId: string;
    readonly requiredDefinitionTypes: readonly string[];
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly contextRef?: ContractReferenceV1;
  }) {
    const parsed = ResolveGovernedReleasesRequestV1Schema.safeParse(input);
    if (!parsed.success) {
      return {
        kind: "failed" as const,
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "knowledge-resolve" }),
      };
    }
    const valid = parsed.data;
    const requiredTypes = valid.requiredDefinitionTypes.map((value) =>
      KnowledgeDefinitionTypeV1Schema.parse(value),
    );
    const branch = this.#knowledgeResolutionBranch(requiredTypes);
    if (branch === undefined) {
      return {
        kind: "failed" as const,
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "knowledge-resolve" }),
      };
    }
    const requiredAt = IsoDateTimeSchema.parse(valid.requiredAt);
    const asOfRecordedAt = IsoDateTimeSchema.parse(valid.asOfRecordedAt);
    try {
      await this.#verifyAuthorization(
        valid.authorization,
        valid.projectId,
        valid.invocationId ??
          governedReleaseResolutionInvocationId({
            requiredDefinitionTypes: requiredTypes,
            requiredAt,
            asOfRecordedAt,
          }),
        branch,
      );
      const rows = await this.#db
        .selectFrom("business.knowledge_releases")
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("definition_type", "in", requiredTypes)
        .where("effective_from", "<=", new Date(requiredAt))
        .where("recorded_at", "<=", new Date(asOfRecordedAt))
        .execute();
      const releaseKeys = rows.map((row) => row.release_id);
      const decisionRows =
        releaseKeys.length === 0
          ? []
          : await this.#db
              .selectFrom("business.knowledge_release_decisions")
              .selectAll()
              .where("project_id", "=", valid.projectId)
              .where("release_id", "in", releaseKeys)
              .where("recorded_at", "<=", new Date(asOfRecordedAt))
              .execute();
      const decisions = decisionRows.map(decisionFromRow);
      const candidates = rows.map((row) => {
        const release = releaseFromRow(row);
        const decision = decisions.find(
          (candidate) =>
            versionedReferenceEquals(candidate.releaseRef, release.releaseRef) &&
            candidate.decision === "deactivated",
        );
        return {
          release,
          ...(decision === undefined
            ? {}
            : {
                deactivatedAt: decision.occurredAt,
                deactivatedRecordedAt: decision.recordedAt,
              }),
        };
      });
      const selection = selectGovernedReleaseCandidates({
        projectId: valid.projectId,
        requiredDefinitionTypes: requiredTypes,
        requiredAt,
        asOfRecordedAt,
        candidates,
        ...(valid.contextRef === undefined ? {} : { contextRef: valid.contextRef }),
      });
      const members: Array<{
        readonly definitionType: KnowledgeDefinitionTypeV1;
        readonly releaseRef: KnowledgeReleaseRefV1;
        readonly revisionRef: KnowledgeRevisionRefV1;
        readonly candidateArtifactRef: ContentArtifactRefV1;
      }> = [];
      for (const releaseRef of selection.releaseRefs) {
        const selected = candidates.find((candidate) =>
          versionedReferenceEquals(candidate.release.releaseRef, releaseRef),
        );
        const revision =
          selected === undefined
            ? undefined
            : await this.#findRevision(this.#db, valid.projectId, selected.release.revisionRef);
        if (revision === undefined) {
          return {
            kind: "failed" as const,
            error: moduleError({
              code: "BUSINESS_BLOCKED",
              blockerKind: "required-release-unavailable",
              blockerRef: asContractReference(releaseRef),
              causalRunId: `knowledge-resolve-${valid.projectId}`,
            }),
          };
        }
        members.push({
          definitionType: revision.definitionType,
          releaseRef,
          revisionRef: revision.revisionRef,
          candidateArtifactRef: revision.candidateArtifactRef,
        });
      }
      return {
        kind: "succeeded" as const,
        result: { ...selection, members },
      };
    } catch (error) {
      return {
        kind: "failed" as const,
        error: await this.#mapError(error, {
          branch,
          causalRunId: `knowledge-resolve-${valid.projectId}`,
        }),
      };
    }
  }

  /**
   * 纯识别族使用 `knowledge-modeling.identification-basis`，纯评估族保持
   * `knowledge-modeling.assessment-basis`；混合族、空集或未知类型在访问数据库前关闭失败。
   */
  #knowledgeResolutionBranch(
    requiredDefinitionTypes: readonly KnowledgeDefinitionTypeV1[],
  ): ModuleBranchV1 | undefined {
    if (requiredDefinitionTypes.length === 0) return undefined;
    const identificationCount = requiredDefinitionTypes.filter((definitionType) =>
      isIdentificationKnowledgeDefinitionTypeV1(definitionType),
    ).length;
    if (identificationCount === requiredDefinitionTypes.length) {
      return "knowledge-modeling.identification-basis";
    }
    if (identificationCount === 0) return "knowledge-modeling.assessment-basis";
    return undefined;
  }

  async #submit(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verifiedAuthorization = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        knowledgeBranch(command.kind),
      );
      const prepared = await this.#prepareAssessmentConfiguration(command, verifiedAuthorization);
      const preparedScoring = await this.#prepareScoringRuleRevision(
        command,
        verifiedAuthorization,
      );
      const receipt = await this.#runTransaction(command, async (tx, atomic, context) => {
        const identityKey = `${command.projectId}:${command.payload.definitionType}`;
        const artifactKey = `${command.projectId}:${refKey(command.payload.candidateArtifactRef)}`;
        for (const key of [identityKey, artifactKey].sort()) {
          await this.#lock(tx, key);
        }
        const definitionRow = await tx
          .selectFrom("business.knowledge_definitions")
          .selectAll()
          .where("project_id", "=", command.projectId)
          .where("definition_type", "=", command.payload.definitionType)
          .executeTakeFirst();
        const definition =
          definitionRow === undefined ? undefined : definitionFromRow(definitionRow);
        const facts =
          definition === undefined
            ? { releases: [], decisions: [] }
            : await this.#releaseFacts(
                tx,
                command.projectId,
                definition.definitionRef.reference.entityId,
              );
        const baseReleaseRef = command.payload.baseReleaseRef;
        const baseRelease =
          baseReleaseRef === undefined
            ? undefined
            : await this.#findRelease(tx, command.projectId, baseReleaseRef);
        const missingBaseRevision = KnowledgeRevisionRefV1Schema.parse({
          kind: "knowledge-revision",
          reference: { entityId: "missing-base-revision", versionId: "1" },
        });
        validateRevisionBase({
          projectId: command.projectId,
          definitionType: command.payload.definitionType,
          hasDefinition: definition !== undefined,
          baseReleaseRef,
          ...(baseReleaseRef === undefined
            ? {}
            : { baseRevisionRef: baseRelease?.revisionRef ?? missingBaseRevision }),
          baseRelease,
          latestRelease: this.#latestRelease(facts.releases, command.issuedAt),
        });
        const existingArtifactRow = await tx
          .selectFrom("business.knowledge_revisions")
          .selectAll()
          .where("project_id", "=", command.projectId)
          .where(
            "candidate_artifact_entity_id",
            "=",
            command.payload.candidateArtifactRef.reference.entityId,
          )
          .where(
            "candidate_artifact_version_id",
            "=",
            command.payload.candidateArtifactRef.reference.versionId,
          )
          .executeTakeFirst();
        if (existingArtifactRow !== undefined) {
          validateCandidateArtifactIdentity({
            candidateArtifactRef: command.payload.candidateArtifactRef,
            existingRevision: revisionFromRow(existingArtifactRow),
          });
        }

        const recordedAt = nowIso(this.#now);
        const auditEntryId = randomId("audit");
        const definitionRef = definition?.definitionRef ?? {
          kind: "knowledge-definition" as const,
          reference: { entityId: randomId("knowledge-definition"), versionId: "1" },
        };
        const revisionRef = KnowledgeRevisionRefV1Schema.parse({
          kind: "knowledge-revision",
          reference: { entityId: randomId("knowledge-revision"), versionId: "1" },
        });
        const revision = {
          revisionRef,
          definitionRef,
          projectId: command.projectId,
          definitionType: command.payload.definitionType,
          candidateArtifactRef: command.payload.candidateArtifactRef,
          evidenceReferences: command.payload.evidenceReferences,
          ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
          ...(baseRelease === undefined ? {} : { baseRevisionRef: baseRelease.revisionRef }),
          artifactIdentityDigest: sha256CanonicalJson(command.payload.candidateArtifactRef),
          commandId: atomic.commandId,
          actorId: atomic.actorRef,
          authorizationContextRef: atomic.authorizationContextRef,
          occurredAt: command.issuedAt,
          recordedAt,
          persistedAt: recordedAt,
        };
        const parsedRevision = KnowledgeRevisionV1Schema.parse(revision);
        const audit = auditCommit({
          command: atomic,
          targetRef: targetForRevision(revisionRef),
          action: "knowledge.submit-revision",
          occurredAt: command.issuedAt,
          recordedAt,
          auditEntryId,
        });
        if (definition === undefined) {
          await tx
            .insertInto("business.knowledge_definitions")
            .values({
              definition_id: definitionRef.reference.entityId,
              version_id: definitionRef.reference.versionId,
              project_id: command.projectId,
              definition_type: command.payload.definitionType,
              created_by: atomic.actorRef,
              authorization_context_ref: jsonbValue(atomic.authorizationContextRef),
              command_id: atomic.commandId,
              audit_entry_id: audit.auditEntryId,
              created_at: command.issuedAt,
              occurred_at: command.issuedAt,
              recorded_at: recordedAt,
              persisted_at: recordedAt,
            })
            .execute();
        }
        await tx
          .insertInto("business.knowledge_revisions")
          .values({
            revision_id: parsedRevision.revisionRef.reference.entityId,
            version_id: parsedRevision.revisionRef.reference.versionId,
            definition_id: parsedRevision.definitionRef.reference.entityId,
            definition_version_id: parsedRevision.definitionRef.reference.versionId,
            project_id: parsedRevision.projectId,
            definition_type: parsedRevision.definitionType,
            candidate_artifact_entity_id: parsedRevision.candidateArtifactRef.reference.entityId,
            candidate_artifact_version_id: parsedRevision.candidateArtifactRef.reference.versionId,
            candidate_artifact_ref: jsonbValue(parsedRevision.candidateArtifactRef),
            evidence_references: jsonbValue(parsedRevision.evidenceReferences),
            base_release_ref:
              parsedRevision.baseReleaseRef === undefined
                ? null
                : jsonbValue(parsedRevision.baseReleaseRef),
            base_revision_ref:
              parsedRevision.baseRevisionRef === undefined
                ? null
                : jsonbValue(parsedRevision.baseRevisionRef),
            artifact_identity_digest: parsedRevision.artifactIdentityDigest,
            command_id: parsedRevision.commandId,
            actor_ref: parsedRevision.actorId,
            authorization_context_ref: jsonbValue(parsedRevision.authorizationContextRef),
            audit_entry_id: audit.auditEntryId,
            occurred_at: parsedRevision.occurredAt,
            recorded_at: parsedRevision.recordedAt,
            persisted_at: recordedAt,
          })
          .execute();
        if (prepared !== undefined) {
          await this.#appendAssessmentConfigurationRevision(context, {
            revision: parsedRevision,
            prepared,
            auditEntryId: audit.auditEntryId,
            persistedAt: recordedAt,
          });
        }
        if (preparedScoring !== undefined) {
          await this.#appendScoringRuleRevision(context, {
            revisionRef: parsedRevision.revisionRef,
            commandId: parsedRevision.commandId,
            projectId: parsedRevision.projectId,
            definitionType: parsedRevision.definitionType as ScoringRulesDefinitionTypeV1,
            candidateArtifactRef: parsedRevision.candidateArtifactRef,
            prepared: preparedScoring,
            auditEntryId: audit.auditEntryId,
            persistedAt: recordedAt,
          });
        }
        return {
          resultRef: targetForRevision(parsedRevision.revisionRef),
          audit,
          events: [],
        };
      });
      const knowledgeRevisionRef = KnowledgeRevisionRefV1Schema.parse(receipt.resultRef);
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "revision", knowledgeRevisionRef },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: knowledgeBranch(command.kind),
          causalRunId: command.commandId,
          command: atomicCommand(command),
        }),
      };
    }
  }

  async #requestReview(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "request-review" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verifiedAuthorization = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        knowledgeBranch(command.kind),
      );
      const checkedRevision = await this.#findRevision(
        this.#db,
        command.projectId,
        command.payload.revisionRef,
      );
      if (checkedRevision !== undefined) {
        await this.#assertAssessmentConfigurationMetadata(
          command,
          checkedRevision,
          verifiedAuthorization,
        );
        await this.#assertScoringRuleMetadata(command, checkedRevision, verifiedAuthorization);
      }
      const reviewAttemptId = `knowledge-review-attempt-${sha256CanonicalJson({
        projectId: command.projectId,
        revisionRef: command.payload.revisionRef,
        reviewPolicyRef: command.payload.reviewPolicyRef,
      })}`;
      const prepareCommand = atomicCommand(
        command,
        "knowledge.request-review.prepare.v1",
        {
          revisionRef: command.payload.revisionRef,
          reviewPolicyRef: command.payload.reviewPolicyRef,
        },
        `${reviewAttemptId}:prepare`,
        `${reviewAttemptId}:prepare`,
      );
      await this.#runTransaction(
        command,
        async (tx, atomic) => {
          await this.#lock(tx, `${command.projectId}:${refKey(command.payload.revisionRef)}`);
          const revisionCandidate = await this.#findRevision(
            tx,
            command.projectId,
            command.payload.revisionRef,
          );
          if (revisionCandidate === undefined) {
            throwLifecycle(
              "ENTITY_NOT_FOUND",
              "knowledge-revision-not-found",
              targetForRevision(command.payload.revisionRef),
            );
          }
          const revision = revisionCandidate as NonNullable<typeof revisionCandidate>;
          const facts = await this.#releaseFacts(
            tx,
            command.projectId,
            revision.definitionRef.reference.entityId,
          );
          if (
            facts.releases.some((release) =>
              versionedReferenceEquals(release.revisionRef, revision.revisionRef),
            )
          ) {
            throwLifecycle(
              "BUSINESS_BLOCKED",
              "revision-already-published",
              targetForRevision(revision.revisionRef),
            );
          }
          const existing = await tx
            .selectFrom("business.knowledge_review_links")
            .selectAll()
            .where("review_attempt_id", "=", reviewAttemptId)
            .where("project_id", "=", command.projectId)
            .executeTakeFirst();
          if (existing !== undefined) {
            const link = reviewLinkFromRow(existing);
            if (!versionedReferenceEquals(link.revisionRef, revision.revisionRef)) {
              throwLifecycle(
                "STALE_VERSION",
                "review-attempt-target-mismatch",
                targetForRevision(revision.revisionRef),
              );
            }
            return commitWithoutEvents({
              command: atomic,
              targetRef: targetForRevision(revision.revisionRef),
              action: "knowledge.request-review.prepare",
              occurredAt: command.issuedAt,
              recordedAt: nowIso(this.#now),
            });
          }
          const recordedAt = nowIso(this.#now);
          const validationSnapshotRef = ContractReferenceV1Schema.parse({
            kind: "validation-snapshot",
            reference: {
              entityId: `knowledge-validation-${revision.revisionRef.reference.entityId}`,
              versionId: sha256CanonicalJson({
                revisionRef: revision.revisionRef,
                candidateArtifactRef: revision.candidateArtifactRef,
                evidenceReferences: revision.evidenceReferences,
              }),
            },
          });
          const evidenceSnapshotRef = ContractReferenceV1Schema.parse({
            kind: "evidence-snapshot",
            reference: {
              entityId: `knowledge-evidence-${revision.revisionRef.reference.entityId}`,
              versionId: sha256CanonicalJson(revision.evidenceReferences),
            },
          });
          const waitingRunRef = {
            kind: "workflow-run" as const,
            reference: {
              entityId: `knowledge-review:${revision.revisionRef.reference.entityId}`,
              versionId: reviewAttemptId,
            },
          };
          const audit = auditCommit({
            command: atomic,
            targetRef: targetForRevision(revision.revisionRef),
            action: "knowledge.request-review.prepare",
            occurredAt: command.issuedAt,
            recordedAt,
          });
          await tx
            .insertInto("business.knowledge_review_links")
            .values({
              review_attempt_id: reviewAttemptId,
              version_id: "1",
              project_id: command.projectId,
              revision_id: revision.revisionRef.reference.entityId,
              revision_version_id: revision.revisionRef.reference.versionId,
              revision_ref: jsonbValue(revision.revisionRef),
              review_policy_entity_id: command.payload.reviewPolicyRef.entityId,
              review_policy_version_id: command.payload.reviewPolicyRef.versionId,
              review_policy_ref: jsonbValue(command.payload.reviewPolicyRef),
              validation_snapshot_ref: jsonbValue(validationSnapshotRef),
              evidence_snapshot_ref: jsonbValue(evidenceSnapshotRef),
              waiting_run_ref: jsonbValue(waitingRunRef),
              review_task_ref: null,
              review_decision_ref: null,
              state: "waiting",
              requested_by: atomic.actorRef,
              authorization_context_ref: jsonbValue(atomic.authorizationContextRef),
              command_id: atomic.commandId,
              audit_entry_id: audit.auditEntryId,
              requested_at: command.issuedAt,
              occurred_at: command.issuedAt,
              recorded_at: recordedAt,
              persisted_at: recordedAt,
            })
            .execute();
          return { resultRef: targetForRevision(revision.revisionRef), audit, events: [] };
        },
        prepareCommand,
      );
      const linkRow = await this.#db
        .selectFrom("business.knowledge_review_links")
        .selectAll()
        .where("review_attempt_id", "=", reviewAttemptId)
        .where("project_id", "=", command.projectId)
        .executeTakeFirst();
      if (linkRow === undefined) {
        throwLifecycle(
          "ENTITY_NOT_FOUND",
          "review-attempt-not-found",
          targetForRevision(command.payload.revisionRef),
        );
      }
      const link = reviewLinkFromRow(linkRow as NonNullable<typeof linkRow>);
      let reviewTaskRef = link.reviewTaskRef;
      if (reviewTaskRef === undefined) {
        // D-11：C16 派生精确调用身份与分支，provider 只解析受信来源与 C06 授权。
        const reviewAuthorization = await this.#reviewAuthorization(
          {
            task: "request-review",
            projectId: command.projectId,
            actorId: command.actorId,
            invocationId: `${reviewAttemptId}:review`,
            requestedAt: command.issuedAt,
            branch: "review-audit.request-review",
            reviewAttemptId,
            revisionRef: link.revisionRef,
          },
          "review-audit.request",
        );
        if (reviewAuthorization === undefined) {
          return {
            kind: "failed",
            error: moduleError({
              code: "AUTHORIZATION_DENIED",
              branch: knowledgeBranch(command.kind),
              causalRunId: command.commandId,
            }),
          };
        }
        const request = ReviewRequestV1Schema.parse({
          kind: "request-review",
          commandId: `${reviewAttemptId}:review`,
          idempotencyKey: `${reviewAttemptId}:review`,
          projectId: command.projectId,
          actorId: reviewAuthorization.actorId,
          issuedAt: command.issuedAt,
          authorization: reviewAuthorization,
          payload: {
            reviewType: "knowledge-revision",
            targetRef: link.revisionRef,
            validationSnapshotRef: link.validationSnapshotRef,
            evidenceSnapshotRef: link.evidenceSnapshotRef,
            waitingRunRef: link.waitingRunRef,
            reviewPolicyRef: link.reviewPolicyRef,
          },
        });
        const reviewResult = await this.#reviewAudit.requestReview(request);
        if (reviewResult.kind !== "succeeded") {
          return {
            kind: "failed",
            error:
              "error" in reviewResult
                ? reviewResult.error
                : moduleError({
                    code: "TERMINAL_FAILURE",
                    causalRunId: command.commandId,
                  }),
          };
        }
        reviewTaskRef = ReviewTaskRefV1Schema.parse(reviewResult.result.reviewTaskRef);
      }
      const receipt = await this.#runTransaction(command, async (tx, atomic) => {
        await this.#lock(tx, `${command.projectId}:${reviewAttemptId}`);
        const row = await tx
          .selectFrom("business.knowledge_review_links")
          .selectAll()
          .where("review_attempt_id", "=", reviewAttemptId)
          .where("project_id", "=", command.projectId)
          .executeTakeFirst();
        if (row === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "review-attempt-not-found",
            targetForRevision(command.payload.revisionRef),
          );
        }
        const link = reviewLinkFromRow(row as NonNullable<typeof row>);
        if (!versionedReferenceEquals(link.revisionRef, command.payload.revisionRef)) {
          throwLifecycle(
            "STALE_VERSION",
            "review-attempt-target-mismatch",
            targetForRevision(command.payload.revisionRef),
          );
        }
        KnowledgeReviewLinkV1Schema.parse({
          ...link,
          reviewTaskRef,
          state: "linked",
        });
        if (
          link.reviewTaskRef !== undefined &&
          !versionedReferenceEquals(link.reviewTaskRef, reviewTaskRef)
        ) {
          throwLifecycle(
            "STALE_VERSION",
            "review-task-mismatch",
            targetForRevision(command.payload.revisionRef),
          );
        }
        await tx
          .updateTable("business.knowledge_review_links")
          .set({ review_task_ref: jsonbValue(reviewTaskRef), state: "linked" })
          .where("review_attempt_id", "=", reviewAttemptId)
          .where("project_id", "=", command.projectId)
          .execute();
        const recordedAt = nowIso(this.#now);
        const audit = auditCommit({
          command: atomic,
          targetRef: asContractReference(reviewTaskRef),
          action: "knowledge.request-review",
          occurredAt: command.issuedAt,
          recordedAt,
        });
        return { resultRef: asContractReference(reviewTaskRef), audit, events: [] };
      });
      const linkedTask = ReviewTaskRefV1Schema.parse(receipt.resultRef);
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "review-task", reviewTaskRef: linkedTask },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: knowledgeBranch(command.kind),
          causalRunId: command.commandId,
          command: atomicCommand(command),
        }),
      };
    }
  }

  async #publish(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "publish-approved-release" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verifiedAuthorization = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        knowledgeBranch(command.kind),
      );
      if (verifiedAuthorization.invocation.kind !== "human") {
        return {
          kind: "failed",
          error: moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: knowledgeBranch(command.kind),
            causalRunId: command.commandId,
          }),
        };
      }
      const approvalAuthorization = await this.#reviewAuthorization(
        {
          task: "verify-knowledge-revision-approval",
          projectId: command.projectId,
          actorId: command.actorId,
          invocationId: `${command.commandId}:approval`,
          requestedAt: command.issuedAt,
          branch: "review-audit.verify-knowledge-revision-approval",
          revisionRef: command.payload.revisionRef,
          reviewDecisionRef: command.payload.reviewDecisionRef,
        },
        "review-audit.read",
      );
      if (approvalAuthorization === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: knowledgeBranch(command.kind),
            causalRunId: command.commandId,
          }),
        };
      }
      const proofResult = await this.#reviewAudit.verifyKnowledgeRevisionApproval(
        KnowledgeRevisionApprovalProofQueryV1Schema.parse({
          queryId: `${command.commandId}:approval`,
          projectId: command.projectId,
          actorId: approvalAuthorization.actorId,
          requestedAt: command.issuedAt,
          kind: "verify-knowledge-revision-approval",
          authorization: approvalAuthorization,
          payload: {
            revisionRef: command.payload.revisionRef,
            reviewDecisionRef: command.payload.reviewDecisionRef,
          },
        }),
      );
      const parsedProofResult = KnowledgeRevisionApprovalProofResultV1Schema.parse(proofResult);
      if (parsedProofResult.kind !== "succeeded") {
        return {
          kind: "failed",
          error:
            "error" in parsedProofResult
              ? parsedProofResult.error
              : moduleError({ code: "TERMINAL_FAILURE", causalRunId: command.commandId }),
        };
      }
      const proof = parsedProofResult.result as KnowledgeRevisionApprovalProofV1;
      if (proof.kind !== "approved") {
        throwLifecycle(
          "BUSINESS_BLOCKED",
          `review-${proof.reason}`,
          targetForRevision(command.payload.revisionRef),
        );
      }
      const approvedProof = proof as Extract<
        KnowledgeRevisionApprovalProofV1,
        { kind: "approved" }
      >;
      validateApprovalProof({
        projectId: command.projectId,
        revisionRef: command.payload.revisionRef,
        reviewDecisionRef: command.payload.reviewDecisionRef,
        proof: approvedProof,
      });
      const receipt = await this.#runTransaction(command, async (tx, atomic, context) => {
        await this.#lock(tx, `${command.projectId}:${refKey(command.payload.revisionRef)}`);
        const revisionCandidate = await this.#findRevision(
          tx,
          command.projectId,
          command.payload.revisionRef,
        );
        if (revisionCandidate === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "knowledge-revision-not-found",
            targetForRevision(command.payload.revisionRef),
          );
        }
        const revision = revisionCandidate as NonNullable<typeof revisionCandidate>;
        await this.#lock(tx, `${command.projectId}:${revision.definitionType}`);
        validateApprovalProof({
          projectId: command.projectId,
          revisionRef: revision.revisionRef,
          reviewDecisionRef: command.payload.reviewDecisionRef,
          proof: approvedProof,
        });
        const link = await this.#findMatchingReviewLink(
          tx,
          command.projectId,
          revision.revisionRef,
          approvedProof.reviewTaskRef,
        );
        if (link === undefined) {
          throwLifecycle(
            "BUSINESS_BLOCKED",
            "review-link-required",
            targetForRevision(revision.revisionRef),
          );
        }
        const requiredLink = link as NonNullable<typeof link>;
        if (
          requiredLink.reviewDecisionRef !== undefined &&
          !versionedReferenceEquals(requiredLink.reviewDecisionRef, approvedProof.reviewDecisionRef)
        ) {
          throwLifecycle(
            "STALE_VERSION",
            "review-decision-mismatch",
            targetForRevision(revision.revisionRef),
          );
        }
        const definitionRow = await tx
          .selectFrom("business.knowledge_definitions")
          .selectAll()
          .where("project_id", "=", command.projectId)
          .where("definition_id", "=", revision.definitionRef.reference.entityId)
          .where("version_id", "=", revision.definitionRef.reference.versionId)
          .executeTakeFirst();
        if (definitionRow === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "knowledge-definition-not-found",
            targetForRevision(revision.revisionRef),
          );
        }
        const facts = await this.#releaseFacts(
          tx,
          command.projectId,
          revision.definitionRef.reference.entityId,
        );
        const currentRelease = this.#currentRelease(
          facts.releases,
          facts.decisions,
          command.issuedAt,
        );
        const latestRelease = this.#latestRelease(facts.releases, command.issuedAt);
        const baseRelease =
          revision.baseReleaseRef === undefined
            ? undefined
            : await this.#findRelease(tx, command.projectId, revision.baseReleaseRef);
        if (latestRelease !== undefined || revision.baseReleaseRef !== undefined) {
          validateRevisionBase({
            projectId: command.projectId,
            definitionType: revision.definitionType,
            hasDefinition: true,
            baseReleaseRef: revision.baseReleaseRef,
            baseRevisionRef: revision.baseRevisionRef,
            baseRelease,
            latestRelease,
          });
        }
        validatePublicationTimeline({
          projectId: command.projectId,
          definitionType: revision.definitionType,
          revisionRef: revision.revisionRef,
          effectiveFrom: command.payload.effectiveFrom,
          now: command.issuedAt,
          existingReleases: facts.releases,
          currentRelease,
          expectedBaseReleaseRef:
            currentRelease === undefined ? undefined : revision.baseReleaseRef,
        });
        const recordedAt = nowIso(this.#now);
        const releaseRef = KnowledgeReleaseRefV1Schema.parse({
          kind: "knowledge-release",
          reference: { entityId: randomId("knowledge-release"), versionId: "1" },
        });
        const audit = auditCommit({
          command: atomic,
          targetRef: targetForRelease(releaseRef),
          action: "knowledge.publish-approved-release",
          occurredAt: command.issuedAt,
          recordedAt,
        });
        // C19 最终关系/C07 门禁必须在 release INSERT 前观察同一事务状态。
        const scoringEvents = await this.#appendScoringRuleRelease(context, {
          command,
          authorization: verifiedAuthorization,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        await tx
          .insertInto("business.knowledge_releases")
          .values({
            release_id: releaseRef.reference.entityId,
            version_id: releaseRef.reference.versionId,
            definition_id: revision.definitionRef.reference.entityId,
            definition_version_id: revision.definitionRef.reference.versionId,
            project_id: revision.projectId,
            definition_type: revision.definitionType,
            revision_id: revision.revisionRef.reference.entityId,
            revision_version_id: revision.revisionRef.reference.versionId,
            revision_ref: jsonbValue(revision.revisionRef),
            review_task_ref: jsonbValue(approvedProof.reviewTaskRef),
            review_decision_ref: jsonbValue(approvedProof.reviewDecisionRef),
            publication_origin: null,
            derivation_scope_key: null,
            effective_from: command.payload.effectiveFrom,
            restored_from_release_ref: null,
            reason_code: null,
            command_id: atomic.commandId,
            actor_ref: atomic.actorRef,
            authorization_context_ref: jsonbValue(atomic.authorizationContextRef),
            audit_entry_id: audit.auditEntryId,
            occurred_at: command.issuedAt,
            recorded_at: recordedAt,
            persisted_at: recordedAt,
          })
          .execute();
        if (requiredLink.reviewDecisionRef === undefined) {
          await tx
            .updateTable("business.knowledge_review_links")
            .set({ review_decision_ref: jsonbValue(approvedProof.reviewDecisionRef) })
            .where("review_attempt_id", "=", requiredLink.reviewAttemptId)
            .where("project_id", "=", command.projectId)
            .execute();
        }
        const assessmentEvents = await this.#appendAssessmentConfigurationRelease(context, {
          command,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        const identificationEvents = await this.#appendIdentificationKnowledgeRelease(context, {
          command,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        return {
          resultRef: targetForRelease(releaseRef),
          audit,
          events: [...assessmentEvents, ...identificationEvents, ...scoringEvents],
        };
      });
      const knowledgeReleaseRef = KnowledgeReleaseRefV1Schema.parse(receipt.resultRef);
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "release", knowledgeReleaseRef },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: knowledgeBranch(command.kind),
          causalRunId: command.commandId,
          command: atomicCommand(command),
        }),
      };
    }
  }

  async #deactivate(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "deactivate-release" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verifiedAuthorization = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        knowledgeBranch(command.kind),
      );
      if (verifiedAuthorization.invocation.kind !== "human") {
        return {
          kind: "failed",
          error: moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: knowledgeBranch(command.kind),
            causalRunId: command.commandId,
          }),
        };
      }
      const receipt = await this.#runTransaction(command, async (tx, atomic) => {
        await this.#lock(tx, `${command.projectId}:${refKey(command.payload.releaseRef)}`);
        const releaseCandidate = await this.#findRelease(
          tx,
          command.projectId,
          command.payload.releaseRef,
        );
        if (releaseCandidate === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "knowledge-release-not-found",
            targetForRelease(command.payload.releaseRef),
          );
        }
        const release = releaseCandidate as NonNullable<typeof releaseCandidate>;
        const decisions = await tx
          .selectFrom("business.knowledge_release_decisions")
          .selectAll()
          .where("project_id", "=", command.projectId)
          .where("release_id", "=", command.payload.releaseRef.reference.entityId)
          .where("release_version_id", "=", command.payload.releaseRef.reference.versionId)
          .execute();
        if (decisions.length > 0) {
          throwLifecycle(
            "STALE_VERSION",
            "knowledge-release-already-deactivated",
            targetForRelease(release.releaseRef),
          );
        }
        const recordedAt = nowIso(this.#now);
        const decisionRef = {
          kind: "knowledge-release-decision",
          reference: { entityId: randomId("knowledge-release-decision"), versionId: "1" },
        } as const;
        const audit = auditCommit({
          command: atomic,
          targetRef: targetForRelease(release.releaseRef),
          action: "knowledge.deactivate-release",
          occurredAt: command.issuedAt,
          recordedAt,
        });
        await tx
          .insertInto("business.knowledge_release_decisions")
          .values({
            decision_id: decisionRef.reference.entityId,
            version_id: decisionRef.reference.versionId,
            release_id: release.releaseRef.reference.entityId,
            release_version_id: release.releaseRef.reference.versionId,
            project_id: release.projectId,
            definition_id: release.definitionRef.reference.entityId,
            release_ref: jsonbValue(release.releaseRef),
            decision: "deactivated",
            reason_code: command.payload.reasonCode,
            command_id: atomic.commandId,
            actor_ref: atomic.actorRef,
            authorization_context_ref: jsonbValue(atomic.authorizationContextRef),
            audit_entry_id: audit.auditEntryId,
            occurred_at: command.issuedAt,
            recorded_at: recordedAt,
            persisted_at: recordedAt,
          })
          .execute();
        return { resultRef: targetForRelease(release.releaseRef), audit, events: [] };
      });
      const knowledgeReleaseRef = KnowledgeReleaseRefV1Schema.parse(receipt.resultRef);
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "release", knowledgeReleaseRef },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: knowledgeBranch(command.kind),
          causalRunId: command.commandId,
          command: atomicCommand(command),
        }),
      };
    }
  }

  async #rollback(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "rollback-by-new-release" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verifiedAuthorization = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        knowledgeBranch(command.kind),
      );
      if (verifiedAuthorization.invocation.kind !== "human") {
        return {
          kind: "failed",
          error: moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: knowledgeBranch(command.kind),
            causalRunId: command.commandId,
          }),
        };
      }
      const historicalCandidate = await this.#findRelease(
        this.#db,
        command.projectId,
        command.payload.historicalReleaseRef,
      );
      if (historicalCandidate === undefined) {
        throwLifecycle(
          "ENTITY_NOT_FOUND",
          "historical-release-not-found",
          targetForRelease(command.payload.historicalReleaseRef),
        );
      }
      const historical = historicalCandidate as NonNullable<typeof historicalCandidate>;
      const initialFacts = await this.#releaseFacts(
        this.#db,
        command.projectId,
        historical.definitionRef.reference.entityId,
      );
      const initialCurrentRelease = this.#currentRelease(
        initialFacts.releases,
        initialFacts.decisions,
        command.issuedAt,
      );
      // 回滚的批准证明针对待恢复的历史修订，不是命令载荷中的 release。
      const approvalAuthorization = await this.#reviewAuthorization(
        {
          task: "verify-knowledge-revision-approval",
          projectId: command.projectId,
          actorId: command.actorId,
          invocationId: `${command.commandId}:approval`,
          requestedAt: command.issuedAt,
          branch: "review-audit.verify-knowledge-revision-approval",
          revisionRef: historical.revisionRef,
          reviewDecisionRef: command.payload.reviewDecisionRef,
        },
        "review-audit.read",
      );
      if (approvalAuthorization === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: knowledgeBranch(command.kind),
            causalRunId: command.commandId,
          }),
        };
      }
      const proofResult = await this.#reviewAudit.verifyKnowledgeRevisionApproval(
        KnowledgeRevisionApprovalProofQueryV1Schema.parse({
          queryId: `${command.commandId}:approval`,
          projectId: command.projectId,
          actorId: approvalAuthorization.actorId,
          requestedAt: command.issuedAt,
          kind: "verify-knowledge-revision-approval",
          authorization: approvalAuthorization,
          payload: {
            revisionRef: historical.revisionRef,
            reviewDecisionRef: command.payload.reviewDecisionRef,
          },
        }),
      );
      const parsedProofResult = KnowledgeRevisionApprovalProofResultV1Schema.parse(proofResult);
      if (parsedProofResult.kind !== "succeeded") {
        return {
          kind: "failed",
          error:
            "error" in parsedProofResult
              ? parsedProofResult.error
              : moduleError({ code: "TERMINAL_FAILURE", causalRunId: command.commandId }),
        };
      }
      const proof = parsedProofResult.result as KnowledgeRevisionApprovalProofV1;
      if (proof.kind !== "approved") {
        throwLifecycle(
          "BUSINESS_BLOCKED",
          `review-${proof.reason}`,
          targetForRelease(command.payload.historicalReleaseRef),
        );
      }
      const approvedProof = proof as Extract<
        KnowledgeRevisionApprovalProofV1,
        { kind: "approved" }
      >;
      validateApprovalProof({
        projectId: command.projectId,
        revisionRef: historical.revisionRef,
        reviewDecisionRef: command.payload.reviewDecisionRef,
        proof: approvedProof,
      });
      const receipt = await this.#runTransaction(command, async (tx, atomic, context) => {
        await this.#lock(tx, `${command.projectId}:${historical.definitionRef.reference.entityId}`);
        const currentHistoricalCandidate = await this.#findRelease(
          tx,
          command.projectId,
          command.payload.historicalReleaseRef,
        );
        if (currentHistoricalCandidate === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "historical-release-not-found",
            targetForRelease(command.payload.historicalReleaseRef),
          );
        }
        const currentHistorical = currentHistoricalCandidate as NonNullable<
          typeof currentHistoricalCandidate
        >;
        const revisionCandidate = await this.#findRevision(
          tx,
          command.projectId,
          currentHistorical.revisionRef,
        );
        if (revisionCandidate === undefined) {
          throwLifecycle(
            "ENTITY_NOT_FOUND",
            "historical-revision-not-found",
            targetForRelease(currentHistorical.releaseRef),
          );
        }
        const revision = revisionCandidate as NonNullable<typeof revisionCandidate>;
        validateApprovalProof({
          projectId: command.projectId,
          revisionRef: revision.revisionRef,
          reviewDecisionRef: command.payload.reviewDecisionRef,
          proof: approvedProof,
        });
        const link = await this.#findMatchingReviewLink(
          tx,
          command.projectId,
          revision.revisionRef,
          approvedProof.reviewTaskRef,
        );
        if (link === undefined) {
          throwLifecycle(
            "BUSINESS_BLOCKED",
            "review-link-required",
            targetForRevision(revision.revisionRef),
          );
        }
        const requiredLink = link as NonNullable<typeof link>;
        if (
          requiredLink.reviewDecisionRef !== undefined &&
          !versionedReferenceEquals(requiredLink.reviewDecisionRef, approvedProof.reviewDecisionRef)
        ) {
          throwLifecycle(
            "STALE_VERSION",
            "review-decision-mismatch",
            targetForRevision(revision.revisionRef),
          );
        }
        const facts = await this.#releaseFacts(
          tx,
          command.projectId,
          currentHistorical.definitionRef.reference.entityId,
        );
        const currentRelease = this.#currentRelease(
          facts.releases,
          facts.decisions,
          command.issuedAt,
        );
        validatePublicationTimeline({
          projectId: command.projectId,
          definitionType: currentHistorical.definitionType,
          revisionRef: revision.revisionRef,
          effectiveFrom: command.issuedAt,
          now: command.issuedAt,
          existingReleases: facts.releases,
          currentRelease,
          expectedBaseReleaseRef: initialCurrentRelease?.releaseRef,
          allowPreviouslyPublishedRevision: true,
        });
        const recordedAt = nowIso(this.#now);
        const releaseRef = KnowledgeReleaseRefV1Schema.parse({
          kind: "knowledge-release",
          reference: { entityId: randomId("knowledge-release"), versionId: "1" },
        });
        const audit = auditCommit({
          command: atomic,
          targetRef: targetForRelease(releaseRef),
          action: "knowledge.rollback-by-new-release",
          occurredAt: command.issuedAt,
          recordedAt,
        });
        await tx
          .insertInto("business.knowledge_releases")
          .values({
            release_id: releaseRef.reference.entityId,
            version_id: releaseRef.reference.versionId,
            definition_id: currentHistorical.definitionRef.reference.entityId,
            definition_version_id: currentHistorical.definitionRef.reference.versionId,
            project_id: currentHistorical.projectId,
            definition_type: currentHistorical.definitionType,
            revision_id: revision.revisionRef.reference.entityId,
            revision_version_id: revision.revisionRef.reference.versionId,
            revision_ref: jsonbValue(revision.revisionRef),
            review_task_ref: jsonbValue(approvedProof.reviewTaskRef),
            review_decision_ref: jsonbValue(approvedProof.reviewDecisionRef),
            publication_origin: null,
            derivation_scope_key: null,
            effective_from: command.issuedAt,
            restored_from_release_ref: jsonbValue(currentHistorical.releaseRef),
            reason_code: command.payload.reasonCode,
            command_id: atomic.commandId,
            actor_ref: atomic.actorRef,
            authorization_context_ref: jsonbValue(atomic.authorizationContextRef),
            audit_entry_id: audit.auditEntryId,
            occurred_at: command.issuedAt,
            recorded_at: recordedAt,
            persisted_at: recordedAt,
          })
          .execute();
        if (requiredLink.reviewDecisionRef === undefined) {
          await tx
            .updateTable("business.knowledge_review_links")
            .set({ review_decision_ref: jsonbValue(approvedProof.reviewDecisionRef) })
            .where("review_attempt_id", "=", requiredLink.reviewAttemptId)
            .where("project_id", "=", command.projectId)
            .execute();
        }
        const assessmentEvents = await this.#appendAssessmentConfigurationRelease(context, {
          command,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        const identificationEvents = await this.#appendIdentificationKnowledgeRelease(context, {
          command,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        const scoringEvents = await this.#appendScoringRuleRelease(context, {
          command,
          authorization: verifiedAuthorization,
          atomic,
          revision,
          releaseRef,
          audit,
          recordedAt,
        });
        return {
          resultRef: targetForRelease(releaseRef),
          audit,
          events: [...assessmentEvents, ...identificationEvents, ...scoringEvents],
        };
      });
      const knowledgeReleaseRef = KnowledgeReleaseRefV1Schema.parse(receipt.resultRef);
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "release", knowledgeReleaseRef },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: knowledgeBranch(command.kind),
          causalRunId: command.commandId,
          command: atomicCommand(command),
        }),
      };
    }
  }

  async #runTransaction(
    command: KnowledgeGovernanceCommandV1,
    handler: (
      tx: KnowledgeTransaction,
      atomic: AtomicCommandV1,
      context: TransactionContextV1,
    ) => Promise<AtomicCommitV1>,
    atomic = atomicCommand(command),
  ) {
    return this.#transactionUnit.execute(atomic, async (context) => {
      try {
        return await handler(asKnowledgeTransaction(context), atomic, context);
      } catch (error) {
        if (error instanceof KnowledgeLifecycleError) throw lifecycleDomainError(error);
        if (error instanceof AssessmentConfigurationError)
          throw assessmentConfigurationDomainError(error);
        throw error;
      }
    });
  }

  async #verifyAuthorization(
    authorization: AuthorizationContextV1,
    projectId: string,
    invocationId: string,
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    const decision = await this.#access.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: authorization.decidedAt,
    });
    return decision.context;
  }

  /**
   * D-11：provider 缺失即关闭失败；provider 返回的上下文必须绑定请求的工程/actor 与该分支的
   * 唯一能力，C16 再用精确 `invocationId`、`branch`、工程与空 scope 向 C06 亲自复验，
   * 两步都通过才交给 C07，不允许用 C07 兜底或回退命令 authorization。
   */
  async #reviewAuthorization(
    request: KnowledgeGovernanceReviewAuthorizationRequestV1,
    requiredCapability: "review-audit.request" | "review-audit.read",
  ): Promise<AuthorizationContextV1 | undefined> {
    const provider = this.#reviewAuthorizationProvider;
    if (provider === undefined) return undefined;
    const context = await provider.authorize(request);
    if (!reviewContextMatches(context, request, requiredCapability)) return undefined;
    const decision = await this.#access.verify({
      authorizationContextRef: context.authorizationContextRef,
      invocationId: request.invocationId,
      projectId: request.projectId,
      branch: request.branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: request.requestedAt,
    });
    const verified = decision.context;
    if (!reviewContextMatches(verified, request, requiredCapability)) return undefined;
    return verified;
  }

  async #prepareAssessmentConfiguration(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
    authorization: AuthorizationContextV1,
  ): Promise<PreparedAssessmentConfigurationV1 | undefined> {
    if (!isAssessmentConfigurationDefinitionTypeV1(command.payload.definitionType)) {
      return undefined;
    }
    const policy = this.#assessmentConfigurationPolicy;
    if (policy === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-policy-required",
        targetRef: asContractReference(command.payload.candidateArtifactRef),
      });
    }
    const submission: SubmitAssessmentConfigurationRevisionV1 = {
      projectId: command.projectId,
      definitionType: command.payload.definitionType,
      candidateArtifactRef: command.payload.candidateArtifactRef,
      authorization,
    };
    return policy.prepareRevision(submission);
  }

  async #appendAssessmentConfigurationRevision(
    context: TransactionContextV1,
    input: AssessmentConfigurationRevisionAppendV1,
  ): Promise<void> {
    const policy = this.#assessmentConfigurationPolicy;
    if (policy === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-policy-required",
        targetRef: asContractReference(input.revision.revisionRef),
      });
    }
    await policy.appendPreparedRevision(context, input);
  }

  async #assertAssessmentConfigurationMetadata(
    command: KnowledgeGovernanceCommandV1,
    revision: KnowledgeRevisionV1,
    authorization: AuthorizationContextV1,
  ): Promise<void> {
    if (!isAssessmentConfigurationDefinitionTypeV1(revision.definitionType)) return;
    const policy = this.#assessmentConfigurationPolicy;
    if (policy === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-policy-required",
        targetRef: asContractReference(revision.revisionRef),
      });
    }
    await policy.assertRevisionMetadata({
      projectId: command.projectId,
      revisionRef: revision.revisionRef,
      authorization,
    });
  }

  async #appendIdentificationKnowledgeRelease(
    context: TransactionContextV1,
    input: {
      readonly command: Extract<
        KnowledgeGovernanceCommandV1,
        { kind: "publish-approved-release" | "rollback-by-new-release" }
      >;
      readonly atomic: AtomicCommandV1;
      readonly revision: KnowledgeRevisionV1;
      readonly releaseRef: KnowledgeReleaseRefV1;
      readonly audit: AtomicCommitV1["audit"];
      readonly recordedAt: string;
    },
  ): Promise<DomainEventV1[]> {
    if (!isIdentificationKnowledgeDefinitionTypeV1(input.revision.definitionType)) return [];
    const policy = this.#identificationKnowledgePolicy;
    if (policy === undefined) {
      throw new KnowledgeLifecycleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "identification-knowledge-policy-required",
        targetRef: asContractReference(input.releaseRef),
      });
    }
    return [
      ...(await policy.appendRelease(context, {
        command: {
          kind: input.command.kind,
          commandId: input.command.commandId,
          idempotencyKey: input.command.idempotencyKey,
          projectId: input.command.projectId,
          actorId: input.command.actorId,
          issuedAt: input.command.issuedAt,
          authorizationContextRef: input.atomic.authorizationContextRef,
        },
        revision: {
          projectId: input.revision.projectId,
          definitionType: input.revision.definitionType,
          revisionRef: input.revision.revisionRef,
          candidateArtifactRef: input.revision.candidateArtifactRef,
        },
        releaseRef: input.releaseRef,
        audit: { auditEntryId: input.audit.auditEntryId },
        recordedAt: input.recordedAt,
        requiredAt:
          input.command.kind === "publish-approved-release"
            ? input.command.payload.effectiveFrom
            : input.command.issuedAt,
        authorization: input.command.authorization,
      })),
    ];
  }

  async #appendAssessmentConfigurationRelease(
    context: TransactionContextV1,
    input: {
      readonly command: Extract<
        KnowledgeGovernanceCommandV1,
        { kind: "publish-approved-release" | "rollback-by-new-release" }
      >;
      readonly atomic: AtomicCommandV1;
      readonly revision: KnowledgeRevisionV1;
      readonly releaseRef: KnowledgeReleaseRefV1;
      readonly audit: AtomicCommitV1["audit"];
      readonly recordedAt: string;
    },
  ): Promise<DomainEventV1[]> {
    if (!isAssessmentConfigurationDefinitionTypeV1(input.revision.definitionType)) return [];
    const policy = this.#assessmentConfigurationPolicy;
    if (policy === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-policy-required",
        targetRef: asContractReference(input.releaseRef),
      });
    }
    const release: AssessmentConfigurationReleaseAppendV1 = {
      command: {
        kind: input.command.kind,
        commandId: input.command.commandId,
        idempotencyKey: input.command.idempotencyKey,
        projectId: input.command.projectId,
        actorId: input.command.actorId,
        issuedAt: input.command.issuedAt,
        authorizationContextRef: input.atomic.authorizationContextRef,
      },
      revision: input.revision,
      releaseRef: input.releaseRef,
      audit: input.audit,
      recordedAt: input.recordedAt,
    };
    return policy.appendRelease(context, release);
  }

  async #prepareScoringRuleRevision(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
    authorization: AuthorizationContextV1,
  ): Promise<PreparedScoringRuleV1 | undefined> {
    if (!isScoringRulesDefinitionTypeV1(command.payload.definitionType)) return undefined;
    const policy = this.#scoringRulesPolicy;
    if (policy === undefined) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-policy-required",
        targetRef: asContractReference(command.payload.candidateArtifactRef),
      });
    }
    const submission: SubmitScoringRuleRevisionV1 = {
      projectId: command.projectId,
      definitionType: command.payload.definitionType,
      candidateArtifactRef: command.payload.candidateArtifactRef,
      authorization,
      ...(command.payload.baseReleaseRef === undefined
        ? {}
        : { baseReleaseRef: command.payload.baseReleaseRef }),
    };
    return policy.prepareRevision(submission);
  }

  async #appendScoringRuleRevision(
    context: TransactionContextV1,
    input: ScoringRuleRevisionAppendV1,
  ): Promise<void> {
    const policy = this.#scoringRulesPolicy;
    if (policy === undefined) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-policy-required",
        targetRef: asContractReference(input.revisionRef),
      });
    }
    await policy.appendPreparedRevision(context, input);
  }

  async #assertScoringRuleMetadata(
    command: KnowledgeGovernanceCommandV1,
    revision: KnowledgeRevisionV1,
    authorization: AuthorizationContextV1,
  ): Promise<void> {
    if (!isScoringRulesDefinitionTypeV1(revision.definitionType)) return;
    const policy = this.#scoringRulesPolicy;
    if (policy === undefined) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-policy-required",
        targetRef: asContractReference(revision.revisionRef),
      });
    }
    await policy.assertRevisionMetadata({
      projectId: command.projectId,
      revisionRef: revision.revisionRef,
      authorization,
      ...(revision.baseReleaseRef === undefined ? {} : { baseReleaseRef: revision.baseReleaseRef }),
      ...(revision.baseRevisionRef === undefined
        ? {}
        : { baseRevisionRef: revision.baseRevisionRef }),
    });
  }

  async #appendScoringRuleRelease(
    context: TransactionContextV1,
    input: {
      readonly command: Extract<
        KnowledgeGovernanceCommandV1,
        { kind: "publish-approved-release" | "rollback-by-new-release" }
      >;
      readonly authorization: AuthorizationContextV1;
      readonly atomic: AtomicCommandV1;
      readonly revision: KnowledgeRevisionV1;
      readonly releaseRef: KnowledgeReleaseRefV1;
      readonly audit: AtomicCommitV1["audit"];
      readonly recordedAt: string;
    },
  ): Promise<DomainEventV1[]> {
    if (!isScoringRulesDefinitionTypeV1(input.revision.definitionType)) return [];
    const policy = this.#scoringRulesPolicy;
    if (policy === undefined) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-policy-required",
        targetRef: asContractReference(input.releaseRef),
      });
    }
    const release: ScoringRuleReleaseAppendV1 = {
      command: {
        kind: input.command.kind,
        commandId: input.command.commandId,
        idempotencyKey: input.command.idempotencyKey,
        projectId: input.command.projectId,
        actorId: input.command.actorId,
        issuedAt: input.command.issuedAt,
        authorizationContextRef: input.atomic.authorizationContextRef,
        authorization: input.authorization,
        ...(input.revision.baseReleaseRef === undefined
          ? {}
          : { baseReleaseRef: input.revision.baseReleaseRef }),
        ...(input.revision.baseRevisionRef === undefined
          ? {}
          : { baseRevisionRef: input.revision.baseRevisionRef }),
      },
      revisionRef: input.revision.revisionRef,
      definitionType: input.revision.definitionType as ScoringRulesDefinitionTypeV1,
      candidateArtifactRef: input.revision.candidateArtifactRef,
      releaseRef: input.releaseRef,
      audit: { auditEntryId: input.audit.auditEntryId, version: input.audit.version },
      recordedAt: input.recordedAt,
    };
    return policy.appendRelease(context, release);
  }

  async #lock(tx: KnowledgeTransaction, key: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx);
  }

  async #findRevision(
    db: Kysely<KnowledgeGovernanceDatabase>,
    projectId: string,
    revisionRef: KnowledgeRevisionRefV1,
  ) {
    const row = await db
      .selectFrom("business.knowledge_revisions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : revisionFromRow(row);
  }

  async #findRelease(
    db: Kysely<KnowledgeGovernanceDatabase>,
    projectId: string,
    releaseRef: KnowledgeReleaseRefV1,
  ) {
    const row = await db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("release_id", "=", releaseRef.reference.entityId)
      .where("version_id", "=", releaseRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : releaseFromRow(row);
  }

  async #releaseFacts(
    db: Kysely<KnowledgeGovernanceDatabase>,
    projectId: string,
    definitionId: string,
  ): Promise<{
    releases: ReturnType<typeof releaseFromRow>[];
    decisions: ReturnType<typeof decisionFromRow>[];
  }> {
    const releaseRows = await db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("definition_id", "=", definitionId)
      .execute();
    const releases = releaseRows.map(releaseFromRow);
    const releaseIds = releases.map((release) => release.releaseRef.reference.entityId);
    const decisionRows =
      releaseIds.length === 0
        ? []
        : await db
            .selectFrom("business.knowledge_release_decisions")
            .selectAll()
            .where("project_id", "=", projectId)
            .where("release_id", "in", releaseIds)
            .execute();
    return { releases, decisions: decisionRows.map(decisionFromRow) };
  }

  #currentRelease(
    releases: readonly ReturnType<typeof releaseFromRow>[],
    decisions: readonly ReturnType<typeof decisionFromRow>[],
    requiredAt: string,
  ) {
    const requiredTime = Date.parse(requiredAt);
    const eligible = releases.filter((release) => {
      if (Date.parse(release.effectiveFrom) > requiredTime) return false;
      const deactivated = decisions.find((decision) =>
        versionedReferenceEquals(decision.releaseRef, release.releaseRef),
      );
      if (deactivated === undefined) return true;
      return Date.parse(deactivated.occurredAt) > requiredTime;
    });
    return eligible.sort(
      (left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom),
    )[0];
  }

  // 演进基线：不看停用决定，只取命令时刻最近一次已生效的历史发布；运行解析仍走 #currentRelease。
  #latestRelease(releases: readonly KnowledgeRelease[], requiredAt: string) {
    const requiredTime = Date.parse(requiredAt);
    return releases
      .filter((release) => Date.parse(release.effectiveFrom) <= requiredTime)
      .sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom))[0];
  }

  async #findMatchingReviewLink(
    db: Kysely<KnowledgeGovernanceDatabase>,
    projectId: string,
    revisionRef: KnowledgeRevisionRefV1,
    reviewTaskRef: ReviewTaskRefV1,
  ) {
    const rows = await db
      .selectFrom("business.knowledge_review_links")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("revision_version_id", "=", revisionRef.reference.versionId)
      .where("state", "=", "linked")
      .execute();
    return rows
      .map(reviewLinkFromRow)
      .find(
        (link) =>
          link.reviewTaskRef !== undefined &&
          versionedReferenceEquals(link.reviewTaskRef, reviewTaskRef),
      );
  }

  async #lookupPriorCommand(command: AtomicCommandV1): Promise<string> {
    try {
      const row = await this.#db
        .selectFrom("business.command_receipts")
        .select("command_id")
        .where("project_id", "=", command.projectId)
        .where("command_kind", "=", command.commandKind)
        .where("idempotency_key", "=", command.idempotencyKey)
        .executeTakeFirst();
      return row?.command_id ?? "unknown-command";
    } catch {
      return "unknown-command";
    }
  }

  async #mapError(
    error: unknown,
    context: {
      readonly branch: ModuleBranchV1;
      readonly causalRunId: string;
      readonly command?: AtomicCommandV1;
    },
  ): Promise<ModuleErrorV1> {
    const failure = lifecycleFailureFrom(error);
    if (failure !== undefined) {
      if (failure.code === "AUTHORIZATION_DENIED") {
        return moduleError({
          code: failure.code,
          branch: context.branch,
          causalRunId: context.causalRunId,
        });
      }
      if (failure.code === "BUSINESS_BLOCKED") {
        return moduleError({
          code: failure.code,
          blockerKind: failure.reasonCode,
          blockerRef: failure.targetRef,
          causalRunId: context.causalRunId,
        });
      }
      if (failure.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError({
          code: failure.code,
          idempotencyKey: context.command?.idempotencyKey ?? "unknown-idempotency",
          priorCommandId: "unknown-command",
          causalRunId: context.causalRunId,
        });
      }
      return moduleError({
        code: failure.code,
        targetRef: failure.targetRef,
        ...(failure.currentRef === undefined ? {} : { currentRef: failure.currentRef }),
        causalRunId: context.causalRunId,
      });
    }
    const assessmentFailure = assessmentConfigurationFailureFrom(error);
    if (assessmentFailure !== undefined) {
      if (assessmentFailure.code === "AUTHORIZATION_DENIED") {
        return moduleError({
          code: assessmentFailure.code,
          branch: context.branch,
          causalRunId: context.causalRunId,
        });
      }
      if (assessmentFailure.code === "BUSINESS_BLOCKED") {
        return moduleError({
          code: assessmentFailure.code,
          blockerKind: assessmentFailure.reasonCode,
          blockerRef: assessmentFailure.targetRef,
          causalRunId: context.causalRunId,
        });
      }
      if (assessmentFailure.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError({
          code: assessmentFailure.code,
          idempotencyKey: context.command?.idempotencyKey ?? "unknown-idempotency",
          priorCommandId: "unknown-command",
          causalRunId: context.causalRunId,
        });
      }
      if (
        assessmentFailure.code === "TRANSIENT_FAILURE" ||
        assessmentFailure.code === "TERMINAL_FAILURE"
      ) {
        return moduleError({ code: assessmentFailure.code, causalRunId: context.causalRunId });
      }
      return moduleError({
        code: assessmentFailure.code,
        targetRef: assessmentFailure.targetRef,
        causalRunId: context.causalRunId,
      });
    }
    const scoringFailure = scoringRuleFailureFrom(error);
    if (scoringFailure !== undefined) {
      if (scoringFailure.code === "AUTHORIZATION_DENIED") {
        return moduleError({
          code: scoringFailure.code,
          branch: context.branch,
          causalRunId: context.causalRunId,
        });
      }
      if (scoringFailure.code === "BUSINESS_BLOCKED") {
        return moduleError({
          code: scoringFailure.code,
          blockerKind: scoringFailure.reasonCode,
          blockerRef: scoringFailure.targetRef,
          causalRunId: context.causalRunId,
        });
      }
      if (scoringFailure.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError({
          code: scoringFailure.code,
          idempotencyKey: context.command?.idempotencyKey ?? "unknown-idempotency",
          priorCommandId: "unknown-command",
          causalRunId: context.causalRunId,
        });
      }
      if (
        scoringFailure.code === "TRANSIENT_FAILURE" ||
        scoringFailure.code === "TERMINAL_FAILURE"
      ) {
        return moduleError({ code: scoringFailure.code, causalRunId: context.causalRunId });
      }
      if (scoringFailure.code === "UNSUPPORTED_CONTRACT") {
        return moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: context.causalRunId });
      }
      return moduleError({
        code: scoringFailure.code,
        targetRef: scoringFailure.targetRef,
        causalRunId: context.causalRunId,
      });
    }
    if (error instanceof AccessServiceError) {
      if (error.details.code === "ACCESS_TRANSIENT_FAILURE") {
        return moduleError({ code: "TRANSIENT_FAILURE", causalRunId: context.causalRunId });
      }
      if (error.details.code === "ACCESS_TERMINAL_FAILURE") {
        return moduleError({ code: "TERMINAL_FAILURE", causalRunId: context.causalRunId });
      }
      return moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: context.branch,
        causalRunId: context.causalRunId,
      });
    }
    const mapped = mapPostgresError(error, "knowledge-governance.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT" && context.command !== undefined) {
      return moduleError({
        code: "IDEMPOTENCY_CONFLICT",
        idempotencyKey: context.command.idempotencyKey,
        priorCommandId: await this.#lookupPriorCommand(context.command),
        causalRunId: context.causalRunId,
      });
    }
    return moduleError({
      code:
        mapped.retryable || mapped.code === "CONNECTION_FAILED"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      causalRunId: context.causalRunId,
    });
  }
}

const throwLifecycle = (
  code: KnowledgeLifecycleError["failure"]["code"],
  reasonCode: string,
  targetRef: ContractReferenceV1,
  currentRef?: ContractReferenceV1,
): never => {
  throw new KnowledgeLifecycleError({
    code,
    reasonCode,
    targetRef,
    ...(currentRef === undefined ? {} : { currentRef }),
  });
};

export const createPostgresKnowledgeGovernanceAdapter = (
  options: PostgresKnowledgeGovernanceAdapterOptionsV1,
): PostgresKnowledgeGovernanceAdapter => new PostgresKnowledgeGovernanceAdapter(options);
