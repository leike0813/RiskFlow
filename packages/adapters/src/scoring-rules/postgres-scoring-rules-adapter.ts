import type { ColumnType, Kysely, Selectable, Transaction } from "kysely";

import type {
  AgentTaskResultRefV1,
  ContentArtifactRefV1,
  ReviewDecisionRefV1,
  ReviewTaskRefV1,
  RuleConflictRefV1,
  StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeResolutionResultV1Schema,
  KnowledgeRevisionRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewTaskRefV1Schema,
  RuleConflictRefV1Schema,
  StartAgentTaskResultV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeResolutionCommandV1,
  type KnowledgeResolutionResultV1,
  type KnowledgeRevisionRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type StartAgentTaskCommandV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  canonicalJson,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactRefV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactReferenceGuardV1,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  emptyAgentBudgetUsage,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentTaskSnapshotV1,
  type AgentTaskStoreV1,
} from "@riskflow/core/agent-runtime";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  AssessmentConfigurationDocumentV1Schema,
  type AssessmentConfigurationSetResultV1,
  type ResolveAssessmentConfigurationSetV1,
} from "@riskflow/core/assessment-config";
import type { DataCleaningFrozenInputV1 } from "@riskflow/core/engineering-data/cleaning";
import type {
  DataCleaningBoundResultReadRequestV1,
  DataCleaningBoundResultReadResultV1,
} from "../engineering-data/cleaning/index.js";
import {
  APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
  APPLICABLE_RULE_SET_MEDIA_TYPE_V1,
  AssessmentBasisReleaseSetMembersV1Schema,
  AssessmentBasisReleaseSetV1Schema,
  AssessmentBasisReleaseSetReadResultV1Schema,
  AssessmentPreparationProjectionV1Schema,
  AssembleApplicableRuleSetResultV1Schema,
  PrepareScoringRuleAuthoringResultV1Schema,
  ScoringRuleAuthoringCandidateV1Schema,
  ScoringRuleAuthoringManifestV1Schema,
  ScoringRuleError,
  ScoringRuleRelationV1Schema,
  SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
  SCORING_RULES_BASIS_TARGET_REF_V1,
  SCORING_RULES_MAX_ARTIFACT_BYTES_V1,
  SCORING_RULES_SCHEMA_VERSION_V1,
  SCORING_RULE_AUTHORING_MANIFEST_PURPOSE_CODE_V1,
  STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
  STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
  ApplicableRuleSetDocumentV1Schema,
  StructuredScoringRuleDocumentV1Schema,
  applicableRuleSetDocumentDigest,
  assembleApplicableRuleSet,
  assertScoringRuleMembersMatchApplicableRuleSet,
  assessmentBasisMemberDigest,
  buildAssessmentBasisMembers,
  detectRuleRelations,
  failScoringRule,
  materializeScoringRuleDocument,
  projectApplicableRuleSetMembers,
  scoringRuleFailureFrom,
  scoringRuleRelationSnapshotDigest,
  structuredScoringRuleDocumentDigest,
  validateScoringRuleOperations,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type AssessmentBasisReleaseSetReadResultV1,
  type AssessmentPreparationSnapshotReaderV1,
  type AssessmentBasisReleaseSetReaderV1,
  type AssembleApplicableRuleSetResultV1,
  type AssembleApplicableRuleSetV1,
  type PrepareScoringRuleAuthoringResultV1,
  type PrepareScoringRuleAuthoringV1,
  type ScoringRuleRevisionAppendV1,
  type ScoringRuleRevisionMetadataAssertionV1,
  type ScoringRuleReleaseAppendV1,
  type SubmitScoringRuleRevisionV1,
  type PreparedScoringRuleV1,
  type ReadAssessmentBasisReleaseSetV1,
  type ScoringRuleAuthoringCandidateV1,
  type ScoringRuleAuthoringManifestV1,
  type ScoringRuleRelationV1,
  type ScoringRulesDefinitionTypeV1,
  type ScoringRulesGovernancePolicyV1,
  type ScoringRulesPolicyV1,
  type ScoringRuleValidationViewV1,
  type StructuredScoringRuleDocumentV1,
} from "@riskflow/core/scoring-rules";

type JsonColumn = ColumnType<unknown, unknown, unknown>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface ScoringRuleRevisionMetadataRow {
  revision_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  project_revision_ref: JsonColumn;
  compatibility_ref: JsonColumn;
  artifact_entity_id: string;
  artifact_version_id: string;
  artifact_ref: JsonColumn;
  content_digest: string;
  relation_digest: string;
  base_release_id: string | null;
  base_release_version_id: string | null;
  base_release_ref: JsonColumn | null;
  base_revision_ref: JsonColumn | null;
  item_count: number;
  command_id: string;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RuleRelationRow {
  relation_id: string;
  version_id: string;
  project_id: string;
  revision_id: string;
  revision_version_id: string;
  relation_kind: string;
  policy_ref: JsonColumn;
  left_rule_id: string;
  left_rule_version_id: string;
  left_rule_version_ref: JsonColumn;
  right_rule_id: string;
  right_rule_version_id: string;
  right_rule_version_ref: JsonColumn;
  overlap: JsonColumn;
  overlap_digest: string;
  retained_rule_version_ref: JsonColumn | null;
  excluded_rule_version_ref: JsonColumn | null;
  evidence_references: JsonColumn;
  command_id: string;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RuleConflictReviewLinkRow {
  link_id: string;
  relation_id: string;
  version_id: string;
  project_id: string;
  attempt: number;
  review_attempt_id: string;
  review_task_ref: JsonColumn;
  command_id: string;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface ApplicableRuleSetRevisionMetadataRow {
  revision_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  project_revision_ref: JsonColumn;
  applicability_snapshot_ref: JsonColumn;
  configuration_set_ref: JsonColumn;
  compatibility_ref: JsonColumn;
  artifact_entity_id: string;
  artifact_version_id: string;
  artifact_ref: JsonColumn;
  content_digest: string;
  decision_digest: string;
  command_id: string;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface AssessmentBasisReleaseSetRow {
  set_id: string;
  version_id: string;
  project_id: string;
  preparation_snapshot_ref: JsonColumn;
  applicability_snapshot_ref: JsonColumn;
  applicable_rule_set_release_ref: JsonColumn;
  configuration_set_ref: JsonColumn;
  required_at: TimestampColumn;
  issued_at: TimestampColumn;
  member_digest: string;
  member_snapshot: JsonColumn;
  recorded_at: TimestampColumn;
}

type ScoringRulesDatabase = PostgresDatabase & {
  "business.scoring_rule_revision_metadata": ScoringRuleRevisionMetadataRow;
  "business.rule_relations": RuleRelationRow;
  "business.rule_conflict_review_links": RuleConflictReviewLinkRow;
  "business.applicable_rule_set_revision_metadata": ApplicableRuleSetRevisionMetadataRow;
  "business.assessment_basis_release_sets": AssessmentBasisReleaseSetRow;
};

type ScoringRulesTransaction = Transaction<ScoringRulesDatabase>;

const jsonbValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

const BASIS_READ_SUCCEEDED_ACTION = "knowledge.read-assessment-basis-release-set.succeeded";
const BASIS_READ_UNAVAILABLE_ACTION = "knowledge.read-assessment-basis-release-set.unavailable";

const asTransaction = (context: TransactionContextV1): ScoringRulesTransaction =>
  getPostgresTransaction(context) as unknown as ScoringRulesTransaction;

const sameVersion = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const asContractReference = (value: unknown): ContractReferenceV1 =>
  ContractReferenceV1Schema.parse(value);

const moduleError = (
  value:
    | ({
        code: "AUTHORIZATION_DENIED";
        branch: ModuleBranchV1;
        causalRunId: string;
      } & { occurredAt?: string })
    | ({
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        targetRef: ContractReferenceV1;
        causalRunId: string;
      } & { occurredAt?: string })
    | ({
        code: "BUSINESS_BLOCKED";
        blockerKind: string;
        blockerRef: ContractReferenceV1;
        causalRunId: string;
      } & { occurredAt?: string })
    | ({
        code: "IDEMPOTENCY_CONFLICT";
        idempotencyKey: string;
        priorCommandId: string;
        causalRunId: string;
      } & { occurredAt?: string })
    | ({ code: "UNSUPPORTED_CONTRACT"; causalRunId: string } & { occurredAt?: string })
    | ({
        code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE";
        causalRunId: string;
      } & { occurredAt?: string }),
): ModuleErrorV1 => {
  const common = {
    stageCode: `scoring-rules.${value.code.toLowerCase()}`,
    // 同一请求重放必须得到逐字一致的结果：调用方可固定发生时刻（如请求时刻）。
    occurredAt: value.occurredAt ?? new Date().toISOString(),
    causalRunId: IdentifierSchema.parse(value.causalRunId),
  };
  switch (value.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "authorization",
        retryable: false,
        requiredCapability: MODULE_BRANCH_CAPABILITY_V1[value.branch],
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      });
    case "ENTITY_NOT_FOUND":
    case "STALE_VERSION":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: value.code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
        retryable: false,
        targetRef: value.targetRef,
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "business-blocked",
        retryable: false,
        blockerKind: IdentifierSchema.parse(value.blockerKind),
        blockerRef: value.blockerRef,
      });
    case "IDEMPOTENCY_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "idempotency",
        retryable: false,
        idempotencyKey: IdentifierSchema.parse(value.idempotencyKey),
        priorCommandId: IdentifierSchema.parse(value.priorCommandId),
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: false,
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: value.code === "TRANSIENT_FAILURE",
        ...(value.code === "TRANSIENT_FAILURE"
          ? {
              attempt: 1,
              retryPolicyRef: { entityId: "scoring-rules-retry-policy", versionId: "1" },
            }
          : {}),
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: {
            entityId: `scoring-rules-${value.code.toLowerCase()}`,
            versionId: "1",
          },
        },
      });
  }
};

/** C16 拥有的精确规则发布成员（与 C18 的 governed release 接缝同形）。 */
export interface ScoringRulesGovernedReleaseMemberV1 {
  readonly definitionType: string;
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
}

export interface ScoringRulesGovernedReleaseResolverV1 {
  resolveGovernedReleases(input: {
    readonly projectId: string;
    readonly requiredDefinitionTypes: readonly string[];
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly result: {
          readonly releaseRefs: readonly KnowledgeReleaseRefV1[];
          readonly members: readonly ScoringRulesGovernedReleaseMemberV1[];
        };
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/** C15 只读接缝：绑定结果读取 + 冻结输入（两个都是 C15 公共方法）。 */
export interface ScoringRulesDataCleaningSeamV1 {
  readBoundResult(
    input: DataCleaningBoundResultReadRequestV1,
  ): Promise<DataCleaningBoundResultReadResultV1>;
  loadFrozenInput(task: AgentTaskSnapshotV1): Promise<DataCleaningFrozenInputV1>;
}

/** C08 任务快照读取（`AgentTaskStoreV1.getTask`）。 */
export type ScoringRulesTaskSnapshotReaderV1 = Pick<AgentTaskStoreV1, "getTask">;

/** C18 精确配置集合解析（`PostgresAssessmentConfigurationAdapter.resolveConfigurationSet`）。 */
export interface ScoringRulesConfigurationResolverV1 {
  resolveConfigurationSet(
    request: ResolveAssessmentConfigurationSetV1,
  ): Promise<AssessmentConfigurationSetResultV1>;
}

/** C08 任务启动接缝：C19 只提交草案，授权由组合根按 agent-task.start-task 精确签发。 */
export interface ScoringRulesAgentTaskStartRequestV1 {
  readonly command: Omit<StartAgentTaskCommandV1, "authorization">;
  readonly requestedSpatialScopeRefs: readonly { readonly reference: VersionReference }[];
  readonly requestedSourceVersionRefs: readonly { readonly reference: VersionReference }[];
}

/** C16 修订提交接缝：由组合根按原调用者身份签发精确治理授权。 */
export interface ScoringRulesRevisionSubmitterV1 {
  submitRevision(input: {
    readonly projectId: string;
    readonly definitionType: ScoringRulesDefinitionTypeV1;
    readonly candidateArtifactRef: ContentArtifactRefV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly task?: AgentTaskSnapshotV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly revisionRef: KnowledgeRevisionRefV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/** C07 冲突审阅任务的幂等创建接缝。 */
export interface ScoringRulesConflictReviewLinkerV1 {
  ensureConflictReviewTask(input: {
    readonly projectId: string;
    readonly relation: ScoringRuleRelationV1;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly reviewTaskRef: ReviewTaskRefV1;
        readonly reviewAttemptId: string;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/**
 * C07 精确规则冲突决定的读取接缝：由组合根注入 C07 concrete adapter 的窄读取方法，
 * 不扩展公共 `ReviewAuditPortV1`，也不缓存 link 状态作为批准事实。
 */
export interface ScoringRulesConflictDecisionReaderV1 {
  readRuleConflictDecision(input: {
    readonly projectId: string;
    readonly relationRef: RuleConflictRefV1;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<
    | {
        readonly kind: "decided";
        readonly decision: "approve-publication" | "reject" | "return-for-revision";
        readonly reviewDecisionRef: ReviewDecisionRefV1;
        readonly decidedAt: string;
      }
    | { readonly kind: "pending" }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

export interface PostgresScoringRulesAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly access: LocalIdentityAccessV1;
  readonly taskStore: ScoringRulesTaskSnapshotReaderV1;
  readonly dataCleaning: ScoringRulesDataCleaningSeamV1;
  readonly configuration: ScoringRulesConfigurationResolverV1;
  readonly governedReleases: ScoringRulesGovernedReleaseResolverV1;
  readonly preparationSnapshot: AssessmentPreparationSnapshotReaderV1;
  readonly submitRevision: ScoringRulesRevisionSubmitterV1;
  readonly conflictReview?: ScoringRulesConflictReviewLinkerV1;
  readonly conflictDecisions?: ScoringRulesConflictDecisionReaderV1;
  readonly startAgentTask: (
    request: ScoringRulesAgentTaskStartRequestV1,
  ) => Promise<StartAgentTaskResultV1>;
  readonly policy: ScoringRulesPolicyV1;
  readonly now?: () => Date;
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

const one = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

const readBounded = async (handle: ArtifactReadHandleV1): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of handle.content) {
    size += chunk.byteLength;
    if (size > SCORING_RULES_MAX_ARTIFACT_BYTES_V1) {
      throw new RangeError("scoring rule artifact exceeds the bounded read limit");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * C19 PostgreSQL 适配器：正文留在 C04，本适配器只保存修订元数据、关系事实、
 * 审阅链接与不可变评估依据集合，并复用 C15/C16/C18/C08 的公开接缝。
 */
export class PostgresScoringRulesAdapter
  implements ScoringRulesGovernancePolicyV1, AssessmentBasisReleaseSetReaderV1
{
  readonly #db: Kysely<ScoringRulesDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #taskStore: ScoringRulesTaskSnapshotReaderV1;
  readonly #dataCleaning: ScoringRulesDataCleaningSeamV1;
  readonly #configuration: ScoringRulesConfigurationResolverV1;
  readonly #governedReleases: ScoringRulesGovernedReleaseResolverV1;
  readonly #preparationSnapshot: AssessmentPreparationSnapshotReaderV1;
  readonly #submitRevision: ScoringRulesRevisionSubmitterV1;
  readonly #conflictReview: ScoringRulesConflictReviewLinkerV1 | undefined;
  readonly #conflictDecisions: ScoringRulesConflictDecisionReaderV1 | undefined;
  readonly #startAgentTask: PostgresScoringRulesAdapterOptionsV1["startAgentTask"];
  readonly #policy: ScoringRulesPolicyV1;
  readonly #now: () => Date;
  /**
   * 任务级证据访问上下文缓存：同一 taskRef 固定复用首次解析出的 C06 上下文与查询身份，
   * 使「同任务同查询身份同载荷」为重放、「同任务同查询身份异载荷」为冲突，
   * 并避免 C04 按任务派生读键在换授权时先触发 ARTIFACT_IDEMPOTENCY_CONFLICT。
   */
  readonly #dataCleaningQueries = new Map<
    string,
    {
      readonly requestId: string;
      readonly authorization: AuthorizationContextV1;
    }
  >();

  constructor(options: PostgresScoringRulesAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<ScoringRulesDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#artifactStore = options.artifactStore;
    this.#access = options.access;
    this.#taskStore = options.taskStore;
    this.#dataCleaning = options.dataCleaning;
    this.#configuration = options.configuration;
    this.#governedReleases = options.governedReleases;
    this.#preparationSnapshot = options.preparationSnapshot;
    this.#submitRevision = options.submitRevision;
    this.#conflictReview = options.conflictReview;
    this.#conflictDecisions = options.conflictDecisions;
    this.#startAgentTask = options.startAgentTask;
    this.#policy = options.policy;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------- authoring entry

  /** C19 编制入口：C15 冻结输入 + C18 配置固定 → manifest → C08 任务。 */
  async prepareAuthoring(
    request: PrepareScoringRuleAuthoringV1,
  ): Promise<PrepareScoringRuleAuthoringResultV1> {
    try {
      const authorization = await this.#verifyAuthorization({
        authorization: request.authorization,
        projectId: request.projectId,
        requestId: request.requestId,
        requestedAt: request.requestedAt,
      });
      const taskKey = `${request.projectId}:${request.dataCleaningTaskRef.reference.entityId}@${request.dataCleaningTaskRef.reference.versionId}`;
      const cachedQuery = this.#dataCleaningQueries.get(taskKey);
      const query = cachedQuery ?? {
        requestId: request.requestId,
        authorization: request.dataCleaningAuthorization,
      };
      if (cachedQuery === undefined) this.#dataCleaningQueries.set(taskKey, query);
      const read = await this.#dataCleaning.readBoundResult({
        projectId: query.authorization.projectId,
        actorId: query.authorization.actorId,
        requestId: query.requestId,
        requestedAt: query.authorization.decidedAt,
        authorization: query.authorization,
        taskRef: request.dataCleaningTaskRef,
      });
      if (read.kind === "error") {
        return PrepareScoringRuleAuthoringResultV1Schema.parse({
          kind: "failed",
          error: this.#moduleErrorFrom(
            read.error,
            request.requestId,
            "scoring-rule-source-unavailable",
          ),
        });
      }
      const result = read.result;
      if (result.overallAvailability === "unavailable") {
        return this.#prepareFailure(request, "scoring-rule-source-unavailable");
      }
      const retainedSourceSegments = result.inputs
        .filter(
          (input) => input.sourceVersionRef !== undefined && input.retainedSegmentIds.length > 0,
        )
        .map((input) => ({
          sourceVersionRef: input.sourceVersionRef!,
          sourceSegmentIds: [...input.retainedSegmentIds].sort(),
        }));
      if (retainedSourceSegments.length === 0) {
        return this.#prepareFailure(request, "scoring-rule-source-excluded");
      }
      const configurationSet = await this.#configuration.resolveConfigurationSet({
        requestId: `${request.requestId}:configuration`,
        idempotencyKey: `${request.idempotencyKey}:configuration`,
        projectId: request.projectId,
        actorId: request.actorId,
        requestedAt: request.requestedAt,
        authorization,
        requiredAt: request.requiredAt,
        asOfRecordedAt: request.asOfRecordedAt,
      });
      if (configurationSet.kind !== "succeeded") {
        return PrepareScoringRuleAuthoringResultV1Schema.parse({
          kind: "failed",
          error: configurationSet.error,
        });
      }
      const indicatorSystem = configurationSet.configurationSet.members.find(
        (member) => member.definitionType === "indicator-system",
      );
      if (indicatorSystem === undefined) {
        return this.#prepareFailure(request, "scoring-rule-configuration-incomplete");
      }
      const indicatorIds = await this.#readIndicatorIds({
        artifactRef: indicatorSystem.artifactRef,
        projectId: request.projectId,
        actorId: request.actorId,
        requestId: `${request.requestId}:indicator-system`,
        authorization,
      });
      if (indicatorIds.length === 0) {
        return this.#prepareFailure(request, "scoring-rule-configuration-incomplete");
      }
      const manifest = ScoringRuleAuthoringManifestV1Schema.parse({
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
        projectId: request.projectId,
        actorId: request.actorId,
        projectRevisionRef: request.projectRevisionRef,
        authorizationContextRef: request.authorization.authorizationContextRef,
        cleaningResultArtifactRef: read.resultArtifactRef,
        cleaningResultDigest: sha256CanonicalJson(result),
        dataCleaningTaskRef: request.dataCleaningTaskRef,
        compatibilityRef: this.#policy.compatibilityRef,
        retainedSourceSegments,
        sourceStandardKinds: [...request.sourceStandardKinds].sort(),
        configurationSetRef: configurationSet.configurationSet.configurationSetRef,
        indicatorSystemMember: {
          releaseRef: indicatorSystem.releaseRef,
          revisionRef: indicatorSystem.revisionRef,
          artifactRef: indicatorSystem.artifactRef,
          contentDigest: indicatorSystem.contentDigest,
        },
        ...(request.baseRuleReleaseRef === undefined
          ? {}
          : { baseRuleReleaseRef: request.baseRuleReleaseRef }),
        scoringPolicyRef: request.scoringPolicyRef,
        taskPolicy: {
          modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
          promptTemplateRef: this.#policy.agent.promptTemplateRef,
          toolPolicyRef: this.#policy.agent.toolPolicyRef,
          budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
          incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
          validationPolicyRef: this.#policy.agent.validationPolicyRef,
        },
      });
      const manifestDigest = sha256CanonicalJson({
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
        projectId: request.projectId,
        idempotencyKey: request.idempotencyKey,
        manifest,
      });
      const manifestArtifactRef = ContentArtifactRefV1Schema.parse(
        await this.#put({
          projectId: request.projectId,
          actorId: request.actorId,
          issuedAt: request.requestedAt,
          authorization,
          artifactId: `scoring-rule-manifest-${manifestDigest.slice(0, 40)}`,
          purposeCode: SCORING_RULE_AUTHORING_MANIFEST_PURPOSE_CODE_V1,
          mediaType: "application/json",
          value: manifest,
          parentArtifactRefs: [],
        }),
      );
      const started = StartAgentTaskResultV1Schema.parse(
        await this.#startAgentTask({
          command: {
            commandId: `scoring-rule-authoring-${manifestDigest.slice(0, 40)}`,
            idempotencyKey: `scoring-rule-authoring-task-${manifestDigest.slice(0, 40)}`,
            projectId: request.projectId,
            actorId: request.actorId,
            issuedAt: request.requestedAt,
            kind: "start-task",
            payload: {
              taskType: "knowledge-authoring",
              triggerMode: "embedded",
              parentRunRef: {
                kind: "workflow-run",
                reference: {
                  entityId: `scoring-rule-authoring-run-${manifestDigest.slice(0, 40)}`,
                  versionId: "1",
                },
              },
              frozenInputRef: manifestArtifactRef,
              modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
              promptTemplateRef: this.#policy.agent.promptTemplateRef,
              toolPolicyRef: this.#policy.agent.toolPolicyRef,
              budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
              incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
              validationPolicyRef: this.#policy.agent.validationPolicyRef,
            },
          },
          requestedSpatialScopeRefs: result.spatialScopeRefs.map((scope) => ({
            reference: scope.reference,
          })),
          requestedSourceVersionRefs: retainedSourceSegments.map((entry) => ({
            reference: entry.sourceVersionRef.reference,
          })),
        }),
      );
      if (started.kind !== "succeeded") {
        return PrepareScoringRuleAuthoringResultV1Schema.parse({
          kind: "failed",
          error:
            started.kind === "failed"
              ? started.error
              : moduleError({
                  code: "BUSINESS_BLOCKED",
                  blockerKind: "scoring-rule-source-unavailable",
                  blockerRef: asContractReference(request.dataCleaningTaskRef),
                  causalRunId: request.requestId,
                }),
        });
      }
      return PrepareScoringRuleAuthoringResultV1Schema.parse({
        kind: "succeeded",
        agentTaskRef: started.result.agentTaskRef,
        manifestArtifactRef,
        manifestDigest,
        replayed: false,
      });
    } catch (error) {
      return PrepareScoringRuleAuthoringResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "knowledge-modeling.assessment-basis",
          causalRunId: request.requestId,
        }),
      });
    }
  }

  #prepareFailure(
    request: PrepareScoringRuleAuthoringV1,
    reasonCode: string,
  ): PrepareScoringRuleAuthoringResultV1 {
    return PrepareScoringRuleAuthoringResultV1Schema.parse({
      kind: "failed",
      error: moduleError({
        code: "BUSINESS_BLOCKED",
        blockerKind: reasonCode,
        blockerRef: asContractReference(request.dataCleaningTaskRef),
        causalRunId: request.requestId,
      }),
    });
  }

  // ------------------------------------------------- authoring task seams

  async loadAuthoringManifest(task: AgentTaskSnapshotV1): Promise<{
    readonly manifest: ScoringRuleAuthoringManifestV1;
    readonly manifestArtifactRef: ContentArtifactRefV1;
    readonly manifestDigest: string;
  }> {
    const frozenInputRef = task.envelope.frozenInputRef;
    if (frozenInputRef.kind !== "content-artifact") {
      failScoringRule(
        "scoring-rule-artifact-mismatch",
        asContractReference(task.envelope.agentTaskRef),
      );
    }
    const manifestArtifactRef = ContentArtifactRefV1Schema.parse(frozenInputRef);
    const manifest = ScoringRuleAuthoringManifestV1Schema.parse(
      await this.#readJson(manifestArtifactRef, {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        requestId: `${task.envelope.commandId}:manifest`,
        requestedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
        purposeCode: SCORING_RULE_AUTHORING_MANIFEST_PURPOSE_CODE_V1,
      }),
    );
    return {
      manifest,
      manifestArtifactRef,
      manifestDigest: sha256CanonicalJson({
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
        projectId: manifest.projectId,
        idempotencyKey: task.envelope.idempotencyKey,
        manifest,
      }),
    };
  }

  async readStandardSegmentSlice(
    input: {
      readonly kind: "read-standard-segment-slice";
      readonly sourceVersionRef: { readonly reference: VersionReference };
      readonly sourceSegmentIds: readonly string[];
    },
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const { manifest } = await this.loadAuthoringManifest(context.task);
    const retained = manifest.retainedSourceSegments.find((entry) =>
      sameVersion(entry.sourceVersionRef.reference, input.sourceVersionRef.reference),
    );
    if (retained === undefined) {
      throw new RangeError("requested source version is not part of the frozen manifest");
    }
    if (input.sourceSegmentIds.length > this.#policy.tools.maxSegmentsPerRead) {
      throw new RangeError("requested segment slice exceeds the frozen tool limit");
    }
    const allowed = new Set(retained.sourceSegmentIds);
    if (input.sourceSegmentIds.some((segmentId) => !allowed.has(segmentId))) {
      throw new RangeError("requested segment is not part of the frozen manifest");
    }
    const cleaningTask = await this.#taskStore.getTask(manifest.dataCleaningTaskRef);
    if (cleaningTask === undefined) {
      failScoringRule(
        "scoring-rule-source-unavailable",
        asContractReference(manifest.dataCleaningTaskRef),
      );
    }
    const frozen = await this.#dataCleaning.loadFrozenInput(cleaningTask);
    const document = frozen.documents.find((entry) =>
      sameVersion(entry.sourceVersionRef.reference, input.sourceVersionRef.reference),
    );
    if (document === undefined) {
      failScoringRule(
        "scoring-rule-source-unavailable",
        asContractReference(manifest.dataCleaningTaskRef),
      );
    }
    const selected = new Set(input.sourceSegmentIds);
    const segments = document.segments.filter((segment) => selected.has(segment.sourceSegmentId));
    if (segments.length !== selected.size) {
      throw new RangeError("requested segment is not part of the frozen preparation");
    }
    const observationArtifactRef = await this.#put({
      projectId: context.task.envelope.projectId,
      actorId: context.task.envelope.actorId,
      issuedAt: context.task.envelope.createdAt,
      authorization: context.task.envelope.authorization,
      artifactId: `${context.actionId}:standard-segment-slice`,
      purposeCode: "knowledge-modeling.standard-segment-observation",
      mediaType: "application/json",
      artifactKind: "diagnostic",
      value: {
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
        manifestArtifactRef: manifest.cleaningResultArtifactRef,
        sourceVersionRef: input.sourceVersionRef,
        jsonLdArtifactRef: document.jsonLdArtifactRef,
        sourceSegmentSetRef: document.sourceSegmentSetRef,
        inputKind: document.inputKind,
        segments: segments.map((segment) => ({
          sourceSegmentId: segment.sourceSegmentId,
          kind: segment.kind,
          locator: segment.locator,
          textBlockIds: segment.textBlockIds,
        })),
      },
      parentArtifactRefs: [],
    });
    return {
      observationArtifactRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: segments.length },
    };
  }

  async readIndicatorCatalogSlice(
    input: {
      readonly kind: "read-indicator-catalog-slice";
      readonly indicatorIds: readonly string[];
    },
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const { manifest } = await this.loadAuthoringManifest(context.task);
    if (input.indicatorIds.length > this.#policy.tools.maxIndicatorsPerRead) {
      throw new RangeError("requested indicator slice exceeds the frozen tool limit");
    }
    const content = await this.#readIndicatorSystem({
      artifactRef: manifest.indicatorSystemMember.artifactRef,
      projectId: context.task.envelope.projectId,
      actorId: context.task.envelope.actorId,
      requestId: `${context.actionId}:indicator-catalog`,
      requestedAt: context.task.envelope.createdAt,
      authorization: context.task.envelope.authorization,
    });
    const requested = new Set(input.indicatorIds);
    const indicators = content.indicators.filter((indicator) =>
      requested.has(indicator.indicatorId),
    );
    if (indicators.length !== requested.size) {
      throw new RangeError("requested indicator is not part of the frozen configuration");
    }
    const observationArtifactRef = await this.#put({
      projectId: context.task.envelope.projectId,
      actorId: context.task.envelope.actorId,
      issuedAt: context.task.envelope.createdAt,
      authorization: context.task.envelope.authorization,
      artifactId: `${context.actionId}:indicator-catalog-slice`,
      purposeCode: "knowledge-modeling.indicator-catalog-observation",
      mediaType: "application/json",
      artifactKind: "diagnostic",
      value: {
        schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
        indicatorSystemMember: manifest.indicatorSystemMember,
        indicators,
      },
      parentArtifactRefs: [],
    });
    return {
      observationArtifactRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: indicators.length },
    };
  }

  async validateAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ScoringRuleAuthoringCandidateV1;
  }): Promise<{
    readonly validation: ScoringRuleValidationViewV1;
    readonly validationArtifactRef: ArtifactRefV1;
  }> {
    const { manifest } = await this.loadAuthoringManifest(input.task);
    const indicatorIds = (
      await this.#readIndicatorIds({
        artifactRef: manifest.indicatorSystemMember.artifactRef,
        projectId: input.task.envelope.projectId,
        actorId: input.task.envelope.actorId,
        requestId: `${input.task.envelope.commandId}:validation-indicators`,
        authorization: input.task.envelope.authorization,
      })
    ).map((indicatorId) => indicatorId);
    const baseline = await this.#readBaselineRules({ manifest, task: input.task });
    const baseDocument = baseline?.document;
    const existingRules = [...(baseDocument?.members ?? [])].map((member) => member.rule);
    const outcome = validateScoringRuleOperations({
      manifest,
      policy: this.#policy,
      agentTaskRef: input.task.envelope.agentTaskRef,
      ...(baseDocument === undefined ? {} : { baseDocument }),
      candidate: ScoringRuleAuthoringCandidateV1Schema.parse(input.candidate),
      indicatorIds,
      configurationSetRef: manifest.configurationSetRef,
      compatibilityRef: this.#policy.compatibilityRef,
      existingRules,
    });
    const validationArtifactRef = ContentArtifactRefV1Schema.parse(
      await this.#put({
        projectId: input.task.envelope.projectId,
        actorId: input.task.envelope.actorId,
        issuedAt: input.task.envelope.createdAt,
        authorization: input.task.envelope.authorization,
        artifactId: `${input.task.envelope.commandId}:validation:${sha256CanonicalJson(
          input.candidate,
        ).slice(0, 32)}`,
        purposeCode: "agent-validation",
        mediaType: "application/json",
        artifactKind: "content",
        value: {
          schemaVersion: SCORING_RULES_SCHEMA_VERSION_V1,
          candidateDigest: sha256CanonicalJson(
            ScoringRuleAuthoringCandidateV1Schema.parse(input.candidate),
          ),
          validation: outcome.validation,
        },
        parentArtifactRefs: [],
      }),
    );
    return {
      validation: outcome.validation,
      validationArtifactRef: ArtifactRefV1Schema.parse(validationArtifactRef),
    };
  }

  async finalizeAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ScoringRuleAuthoringCandidateV1;
  }): Promise<AgentTaskResultRefV1> {
    const { manifest } = await this.loadAuthoringManifest(input.task);
    const indicatorIds = await this.#readIndicatorIds({
      artifactRef: manifest.indicatorSystemMember.artifactRef,
      projectId: input.task.envelope.projectId,
      actorId: input.task.envelope.actorId,
      requestId: `${input.task.envelope.commandId}:finalize-indicators`,
      authorization: input.task.envelope.authorization,
    });
    const baseDocument = (await this.#readBaselineRules({ manifest, task: input.task }))?.document;
    const outcome = validateScoringRuleOperations({
      manifest,
      policy: this.#policy,
      agentTaskRef: input.task.envelope.agentTaskRef,
      ...(baseDocument === undefined ? {} : { baseDocument }),
      candidate: ScoringRuleAuthoringCandidateV1Schema.parse(input.candidate),
      indicatorIds,
      configurationSetRef: manifest.configurationSetRef,
      compatibilityRef: this.#policy.compatibilityRef,
      existingRules: [...(baseDocument?.members ?? [])].map((member) => member.rule),
    });
    if (outcome.disposition !== "accepted") {
      failScoringRule(
        "scoring-rule-content-invalid",
        asContractReference(input.task.envelope.agentTaskRef),
      );
    }
    const members = [...(baseDocument?.members ?? [])].filter(
      (member) =>
        !outcome.acceptedMembers.some((accepted) => accepted.rule.ruleId === member.rule.ruleId),
    );
    const document = materializeScoringRuleDocument({
      manifest,
      agentTaskRef: input.task.envelope.agentTaskRef,
      members: [...members, ...outcome.acceptedMembers],
    });
    const contentDigest = structuredScoringRuleDocumentDigest(document);
    const candidateArtifactRef = ContentArtifactRefV1Schema.parse(
      await this.#put({
        projectId: input.task.envelope.projectId,
        actorId: input.task.envelope.actorId,
        issuedAt: input.task.envelope.createdAt,
        authorization: input.task.envelope.authorization,
        artifactId: `structured-scoring-rule-${contentDigest.slice(0, 40)}`,
        purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
        mediaType: STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
        value: document,
        parentArtifactRefs: [],
      }),
    );
    const submitted = await this.#submitRevision.submitRevision({
      projectId: input.task.envelope.projectId,
      definitionType: "structured-scoring-rule",
      candidateArtifactRef,
      commandId: `${input.task.envelope.commandId}:submit-revision`,
      idempotencyKey: `${input.task.envelope.idempotencyKey}:submit-revision`,
      issuedAt: input.task.envelope.createdAt,
      task: input.task,
    });
    if (submitted.kind === "failed") {
      failScoringRule(
        "scoring-rule-revision-unverified",
        asContractReference(input.task.envelope.agentTaskRef),
      );
    }
    // 修订与全部关系事实已随 C16 提交事务耐久；此处只按稳定身份补 C07 task/link。
    await this.#ensureConflictReviewLinks({
      projectId: input.task.envelope.projectId,
      revisionRef: submitted.revisionRef,
      authorization: input.task.envelope.authorization,
      issuedAt: input.task.envelope.createdAt,
    });
    return {
      kind: "agent-task-result",
      reference: {
        entityId: `agent-result:${input.task.envelope.agentTaskRef.reference.entityId}`,
        versionId: "1",
      },
      agentTaskRef: input.task.envelope.agentTaskRef,
      status: "completed",
      candidateRef: submitted.revisionRef,
    } as AgentTaskResultRefV1;
  }

  // ------------------------------------------------------- C16 policy seam

  async prepareRevision(command: SubmitScoringRuleRevisionV1): Promise<PreparedScoringRuleV1> {
    const authorization = await this.#verifyGovernanceAuthorization(command);
    const artifactRef = ContentArtifactRefV1Schema.parse(command.candidateArtifactRef);
    if (command.definitionType === "structured-scoring-rule") {
      const document = StructuredScoringRuleDocumentV1Schema.parse(
        await this.#readJson(artifactRef, {
          projectId: command.projectId,
          actorId: command.authorization.actorId,
          requestId: `${command.projectId}:scoring-rule-revision:${artifactRef.reference.entityId}:${artifactRef.reference.versionId}`,
          requestedAt: authorization.decidedAt,
          authorization,
          purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
        }),
      );
      const contentDigest = structuredScoringRuleDocumentDigest(document);
      const task = await this.#taskStore.getTask(document.agentTaskRef);
      if (task === undefined) {
        failScoringRule(
          "scoring-rule-source-unavailable",
          asContractReference(document.agentTaskRef),
          "TERMINAL_FAILURE",
        );
      }
      const { manifest } = await this.loadAuthoringManifest(task);
      const declaredBase = manifest.baseRuleReleaseRef;
      if (
        (command.baseReleaseRef === undefined) !== (declaredBase === undefined) ||
        (command.baseReleaseRef !== undefined &&
          declaredBase !== undefined &&
          !sameVersion(command.baseReleaseRef.reference, declaredBase.reference))
      ) {
        failScoringRule(
          "scoring-rule-base-version-conflict",
          asContractReference(command.baseReleaseRef ?? command.candidateArtifactRef),
          "STALE_VERSION",
        );
      }
      const baseline = await this.#readBaselineRules({ manifest, task });
      const relationSnapshot = detectRuleRelations({
        policyRef: this.#policy.conflictPriorityPolicyRef,
        candidateContentDigest: contentDigest,
        candidates: document.members.map((member) => ({
          rule: member.rule,
          sourceVersionRef: member.binding.sourceVersionRef,
        })),
        ...(baseline === undefined
          ? {}
          : {
              baseline: baseline.document.members.map((member) => ({
                rule: member.rule,
                sourceVersionRef: member.binding.sourceVersionRef,
              })),
              baseReleaseRef: baseline.releaseRef,
              baseRevisionRef: baseline.revisionRef,
            }),
        standardKindRank: [...this.#policy.allowedSourceStandardKinds],
      });
      return {
        definitionType: command.definitionType,
        projectRevisionRef: document.projectRevisionRef,
        compatibilityRef: document.compatibilityRef,
        contentDigest,
        itemCount: document.members.length,
        relationSnapshot,
      };
    }
    const document = ApplicableRuleSetDocumentV1Schema.parse(
      await this.#readJson(artifactRef, {
        projectId: command.projectId,
        actorId: command.authorization.actorId,
        requestId: `${command.projectId}:applicable-rule-set-revision:${artifactRef.reference.entityId}:${artifactRef.reference.versionId}`,
        requestedAt: authorization.decidedAt,
        authorization,
        purposeCode: APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
      }),
    );
    return {
      definitionType: command.definitionType,
      projectRevisionRef: document.projectRevisionRef,
      compatibilityRef: document.compatibilityRef,
      contentDigest: applicableRuleSetDocumentDigest(document),
      itemCount: document.includedMembers.length,
    };
  }

  async appendPreparedRevision(
    context: TransactionContextV1,
    input: ScoringRuleRevisionAppendV1,
  ): Promise<void> {
    const transaction = asTransaction(context);
    if (input.definitionType === "structured-scoring-rule") {
      const snapshot = input.prepared.relationSnapshot;
      if (
        snapshot === undefined ||
        snapshot.candidateContentDigest !== input.prepared.contentDigest ||
        !sameVersion(snapshot.policyRef, this.#policy.conflictPriorityPolicyRef)
      ) {
        failScoringRule("scoring-rule-revision-unverified", asContractReference(input.revisionRef));
      }
      await transaction
        .insertInto("business.scoring_rule_revision_metadata")
        .values({
          revision_id: input.revisionRef.reference.entityId,
          version_id: input.revisionRef.reference.versionId,
          project_id: input.projectId,
          definition_type: input.definitionType,
          project_revision_ref: jsonbValue(input.prepared.projectRevisionRef),
          compatibility_ref: jsonbValue(input.prepared.compatibilityRef),
          artifact_entity_id: input.candidateArtifactRef.reference.entityId,
          artifact_version_id: input.candidateArtifactRef.reference.versionId,
          artifact_ref: jsonbValue(input.candidateArtifactRef),
          content_digest: input.prepared.contentDigest,
          relation_digest: snapshot.relationDigest,
          base_release_id: snapshot.baseReleaseRef?.reference.entityId ?? null,
          base_release_version_id: snapshot.baseReleaseRef?.reference.versionId ?? null,
          base_release_ref:
            snapshot.baseReleaseRef === undefined ? null : jsonbValue(snapshot.baseReleaseRef),
          base_revision_ref:
            snapshot.baseRevisionRef === undefined ? null : jsonbValue(snapshot.baseRevisionRef),
          item_count: input.prepared.itemCount,
          command_id: input.commandId,
          audit_entry_id: input.auditEntryId,
          occurred_at: input.persistedAt,
          recorded_at: input.persistedAt,
          persisted_at: input.persistedAt,
        })
        .onConflict((conflict) => conflict.columns(["revision_id", "version_id"]).doNothing())
        .execute();
      // 全部关系事实与 C16 revision 同事务耐久；同一 revision+关系身份只写一次。
      for (const relation of snapshot.relations) {
        await transaction
          .insertInto("business.rule_relations")
          .values({
            relation_id: relation.relationId,
            version_id: "1",
            project_id: input.projectId,
            revision_id: input.revisionRef.reference.entityId,
            revision_version_id: input.revisionRef.reference.versionId,
            relation_kind: relation.relationKind,
            policy_ref: jsonbValue(relation.policyRef),
            left_rule_id: relation.leftRuleId,
            left_rule_version_id: relation.leftRuleVersion.entityId,
            left_rule_version_ref: jsonbValue(relation.leftRuleVersion),
            right_rule_id: relation.rightRuleId,
            right_rule_version_id: relation.rightRuleVersion.entityId,
            right_rule_version_ref: jsonbValue(relation.rightRuleVersion),
            overlap: jsonbValue(relation.overlap),
            overlap_digest: relation.overlapDigest,
            retained_rule_id: relation.retainedRuleVersionRef?.entityId ?? null,
            retained_rule_version_id: relation.retainedRuleVersionRef?.versionId ?? null,
            retained_rule_version_ref:
              relation.retainedRuleVersionRef === undefined
                ? null
                : jsonbValue(relation.retainedRuleVersionRef),
            excluded_rule_id: relation.excludedRuleVersionRef?.entityId ?? null,
            excluded_rule_version_id: relation.excludedRuleVersionRef?.versionId ?? null,
            excluded_rule_version_ref:
              relation.excludedRuleVersionRef === undefined
                ? null
                : jsonbValue(relation.excludedRuleVersionRef),
            evidence_references: jsonbValue(relation.evidenceReferences),
            command_id: input.commandId,
            audit_entry_id: input.auditEntryId,
            occurred_at: input.persistedAt,
            recorded_at: input.persistedAt,
            persisted_at: input.persistedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["relation_id", "version_id"]).doNothing())
          .execute();
      }
      return;
    }
    await transaction
      .insertInto("business.applicable_rule_set_revision_metadata")
      .values({
        revision_id: input.revisionRef.reference.entityId,
        version_id: input.revisionRef.reference.versionId,
        project_id: input.projectId,
        definition_type: input.definitionType,
        project_revision_ref: jsonbValue(input.prepared.projectRevisionRef),
        applicability_snapshot_ref: jsonbValue(input.candidateArtifactRef),
        configuration_set_ref: jsonbValue(input.prepared.compatibilityRef),
        compatibility_ref: jsonbValue(input.prepared.compatibilityRef),
        artifact_entity_id: input.candidateArtifactRef.reference.entityId,
        artifact_version_id: input.candidateArtifactRef.reference.versionId,
        artifact_ref: jsonbValue(input.candidateArtifactRef),
        content_digest: input.prepared.contentDigest,
        decision_digest: input.prepared.contentDigest,
        command_id: input.commandId,
        audit_entry_id: input.auditEntryId,
        occurred_at: input.persistedAt,
        recorded_at: input.persistedAt,
        persisted_at: input.persistedAt,
      })
      .onConflict((conflict) => conflict.columns(["revision_id", "version_id"]).doNothing())
      .execute();
  }

  async assertRevisionMetadata(input: ScoringRuleRevisionMetadataAssertionV1): Promise<void> {
    if (
      input.authorization.projectId !== input.projectId ||
      !input.authorization.grantedCapabilities.includes("knowledge-modeling.govern")
    ) {
      throw new ScoringRuleError({
        code: "AUTHORIZATION_DENIED",
        reasonCode: "scoring-rule-project-mismatch",
        targetRef: asContractReference(input.revisionRef),
      });
    }
    const metadata = await this.#findRevisionMetadata(input.projectId, input.revisionRef);
    if (metadata === undefined) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-revision-unverified",
        targetRef: asContractReference(input.revisionRef),
      });
    }
    // 进入 C16 人工审核前：关系事实、快照摘要、比较基线与全部 C07 决定必须精确闭合。
    if (metadata.definitionType === "structured-scoring-rule") {
      await this.#assertRelationGate({
        projectId: input.projectId,
        revisionRef: input.revisionRef,
        authorization: input.authorization,
        db: this.#db,
        requestedAt: this.#now().toISOString(),
        ...(input.baseReleaseRef === undefined
          ? {}
          : { declaredBaseReleaseRef: input.baseReleaseRef }),
        ...(input.baseRevisionRef === undefined
          ? {}
          : { declaredBaseRevisionRef: input.baseRevisionRef }),
      });
    }
  }

  async appendRelease(
    context: TransactionContextV1,
    input: ScoringRuleReleaseAppendV1,
  ): Promise<DomainEventV1[]> {
    const transaction = asTransaction(context);
    const metadata = await this.#findRevisionMetadata(
      input.command.projectId,
      input.revisionRef,
      transaction,
    );
    if (
      metadata === undefined ||
      metadata.definitionType !== input.definitionType ||
      metadata.artifactRef.reference.entityId !== input.candidateArtifactRef.reference.entityId ||
      metadata.artifactRef.reference.versionId !== input.candidateArtifactRef.reference.versionId
    ) {
      throw new ScoringRuleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "scoring-rule-revision-unverified",
        targetRef: asContractReference(input.revisionRef),
      });
    }
    if (input.definitionType === "structured-scoring-rule") {
      // 只有发布新 release 才重跑最终门禁：回滚复用既有已闭合修订，重新按基线漂移判断会误拦回滚。
      if (input.command.kind === "publish-approved-release") {
        await this.#assertRelationGate({
          projectId: input.command.projectId,
          revisionRef: input.revisionRef,
          authorization: input.command.authorization,
          db: transaction,
          requestedAt: input.command.issuedAt,
          ...(input.command.baseReleaseRef === undefined
            ? {}
            : { declaredBaseReleaseRef: input.command.baseReleaseRef }),
          ...(input.command.baseRevisionRef === undefined
            ? {}
            : { declaredBaseRevisionRef: input.command.baseRevisionRef }),
        });
      }
      return [];
    }
    if (input.definitionType !== "applicable-rule-set") return [];
    return [
      DomainEventV1Schema.parse({
        schemaVersion: "1",
        eventId: `knowledge-assessment-basis-published-${sha256CanonicalJson({
          projectId: input.command.projectId,
          releaseRef: input.releaseRef,
        })}`,
        eventVersion: 1,
        projectId: input.command.projectId,
        aggregateRef: input.releaseRef,
        occurredAt: input.command.issuedAt,
        recordedAt: input.recordedAt,
        causationId: input.command.commandId,
        correlationId: input.command.idempotencyKey,
        producerCommandId: input.command.commandId,
        idempotencyKey: input.command.idempotencyKey,
        authorizationContextRef: input.command.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: {
            entityId: input.audit.auditEntryId,
            versionId: input.audit.version.versionId,
          },
        },
        eventType: "knowledge.assessment-basis-published.v1",
        payload: {
          basisKind: "assessment-basis",
          newKnowledgeReleaseRef: input.releaseRef,
          affectedProjectRevisionRef: metadata.projectRevisionRef,
        },
      }),
    ];
  }

  // ------------------------------------------------------ applicability assembly

  /** 三维筛选 + 冲突门禁 → applicable-rule-set 候选修订（仍需 C16 人工批准）。 */
  async assembleApplicableRuleSetRevision(
    request: AssembleApplicableRuleSetV1,
  ): Promise<AssembleApplicableRuleSetResultV1> {
    try {
      const authorization = await this.#verifyAuthorization({
        authorization: request.authorization,
        projectId: request.projectId,
        requestId: request.requestId,
        requestedAt: request.requestedAt,
      });
      const snapshot = await this.#preparationSnapshot.readAssessmentPreparationSnapshot({
        projectId: request.projectId,
        actorId: request.actorId,
        requestId: request.requestId,
        idempotencyKey: `${request.idempotencyKey}:preparation`,
        requestedAt: request.requestedAt,
        authorization,
        preparationSnapshotRef: request.preparationSnapshotRef,
        requiredAt: request.requiredAt,
      });
      if (snapshot.kind === "waiting") {
        return AssembleApplicableRuleSetResultV1Schema.parse({
          kind: "waiting",
          waiting: snapshot.waiting,
        });
      }
      if (snapshot.kind === "failed") {
        return AssembleApplicableRuleSetResultV1Schema.parse({
          kind: "failed",
          error: snapshot.error,
        });
      }
      const projection = AssessmentPreparationProjectionV1Schema.parse(snapshot.projection);
      if (
        projection.projectId !== request.projectId ||
        !sameVersion(projection.configurationSetRef, request.configurationSetRef) ||
        !sameVersion(
          projection.applicabilitySnapshotRef.reference,
          request.applicabilitySnapshotRef.reference,
        )
      ) {
        failScoringRule(
          "scoring-rule-applicability-mismatch",
          SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
        );
      }
      const releases = await this.#governedReleases.resolveGovernedReleases({
        projectId: request.projectId,
        requiredDefinitionTypes: ["structured-scoring-rule"],
        requiredAt: request.requiredAt,
        asOfRecordedAt: request.asOfRecordedAt,
        authorization,
      });
      if (releases.kind === "failed") {
        return AssembleApplicableRuleSetResultV1Schema.parse({
          kind: "failed",
          error: releases.error,
        });
      }
      const candidates = [];
      const relations: ScoringRuleRelationV1[] = [];
      const approvedConflicts: {
        retainedRuleVersionRef: VersionReference;
        excludedRuleVersionRef: VersionReference;
      }[] = [];
      for (const member of releases.result.members) {
        if (member.definitionType !== "structured-scoring-rule") {
          failScoringRule(
            "scoring-rule-compatibility-mismatch",
            asContractReference(member.releaseRef),
          );
        }
        const metadata = await this.#findRevisionMetadata(request.projectId, member.revisionRef);
        if (
          metadata === undefined ||
          metadata.artifactRef.reference.entityId !==
            member.candidateArtifactRef.reference.entityId ||
          metadata.artifactRef.reference.versionId !==
            member.candidateArtifactRef.reference.versionId ||
          !sameVersion(metadata.compatibilityRef, request.compatibilityRef)
        ) {
          failScoringRule(
            "scoring-rule-compatibility-mismatch",
            asContractReference(member.releaseRef),
          );
        }
        const document = StructuredScoringRuleDocumentV1Schema.parse(
          await this.#readJson(metadata.artifactRef, {
            projectId: request.projectId,
            actorId: request.actorId,
            requestId: `${request.requestId}:rule:${metadata.artifactRef.reference.entityId}`,
            requestedAt: request.requestedAt,
            authorization,
            purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
          }),
        );
        if (structuredScoringRuleDocumentDigest(document) !== metadata.contentDigest) {
          failScoringRule(
            "scoring-rule-artifact-mismatch",
            asContractReference(metadata.artifactRef),
          );
        }
        for (const entry of document.members) {
          candidates.push({
            member: entry,
            ruleReleaseRef: member.releaseRef,
            ruleRevisionRef: member.revisionRef,
            artifactRef: metadata.artifactRef,
            contentDigest: metadata.contentDigest,
          });
        }
        // 组装只消费发布前已闭合的关系事实：正文不再触发检测，也不再创建 C07 任务。
        const persistedRelations = await this.#findRevisionRelations(
          request.projectId,
          member.revisionRef,
        );
        if (
          metadata.relationDigest === undefined ||
          scoringRuleRelationSnapshotDigest({
            policyRef: this.#policy.conflictPriorityPolicyRef,
            candidateContentDigest: metadata.contentDigest,
            ...(metadata.baseReleaseRef === undefined
              ? {}
              : { baseReleaseRef: metadata.baseReleaseRef }),
            ...(metadata.baseRevisionRef === undefined
              ? {}
              : { baseRevisionRef: metadata.baseRevisionRef }),
            relations: persistedRelations,
          }) !== metadata.relationDigest
        ) {
          failScoringRule(
            "scoring-rule-relation-unresolved",
            asContractReference(member.releaseRef),
          );
        }
        for (const relation of persistedRelations) {
          relations.push(relation);
          if (relation.relationKind !== "conflict") continue;
          // 已发布修订的冲突都必须有精确批准：仍从 C07 当前决定事实逐条复验。
          if (
            relation.retainedRuleVersionRef === undefined ||
            relation.excludedRuleVersionRef === undefined
          ) {
            failScoringRule(
              "scoring-rule-relation-unresolved",
              asContractReference(member.releaseRef),
            );
          }
          const link = await this.#findReviewLink(request.projectId, relation.relationId);
          const reader = this.#conflictDecisions;
          if (link === undefined || reader === undefined) {
            failScoringRule(
              "scoring-rule-relation-unresolved",
              asContractReference(member.releaseRef),
            );
          }
          const decision = await reader.readRuleConflictDecision({
            projectId: request.projectId,
            relationRef: RuleConflictRefV1Schema.parse(link.reviewTaskRef.targetRef),
            reviewTaskRef: link.reviewTaskRef,
            authorization,
            invocationId: `scoring-rule-conflict-assembly-${relation.relationId.slice(0, 32)}`,
            requestedAt: request.requestedAt,
          });
          if (decision.kind !== "decided" || decision.decision !== "approve-publication") {
            failScoringRule(
              "scoring-rule-relation-unresolved",
              asContractReference(member.releaseRef),
            );
          }
          approvedConflicts.push({
            retainedRuleVersionRef: relation.retainedRuleVersionRef,
            excludedRuleVersionRef: relation.excludedRuleVersionRef,
          });
        }
      }
      if (candidates.length === 0) {
        failScoringRule("scoring-rule-set-incomplete", SCORING_RULES_ASSEMBLY_TARGET_REF_V1);
      }
      const document = assembleApplicableRuleSet({
        projectRevisionRef: request.projectRevisionRef,
        applicabilitySnapshotRef: request.applicabilitySnapshotRef,
        applicability: request.applicability,
        configurationSetRef: request.configurationSetRef,
        compatibilityRef: request.compatibilityRef,
        policy: this.#policy,
        requiredAt: request.requiredAt,
        candidates,
        relations,
        resolvedConflicts: approvedConflicts,
      });
      const contentDigest = applicableRuleSetDocumentDigest(document);
      const candidateArtifactRef = ContentArtifactRefV1Schema.parse(
        await this.#put({
          projectId: request.projectId,
          actorId: request.actorId,
          issuedAt: request.requestedAt,
          authorization,
          artifactId: `applicable-rule-set-${contentDigest.slice(0, 40)}`,
          purposeCode: APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
          mediaType: APPLICABLE_RULE_SET_MEDIA_TYPE_V1,
          value: document,
          parentArtifactRefs: [],
        }),
      );
      const submitted = await this.#submitRevision.submitRevision({
        projectId: request.projectId,
        definitionType: "applicable-rule-set",
        candidateArtifactRef,
        commandId: `${request.requestId}:submit-revision`,
        idempotencyKey: `${request.idempotencyKey}:submit-revision`,
        issuedAt: request.requestedAt,
      });
      if (submitted.kind === "failed") {
        return AssembleApplicableRuleSetResultV1Schema.parse({
          kind: "failed",
          error: submitted.error,
        });
      }
      return AssembleApplicableRuleSetResultV1Schema.parse({
        kind: "succeeded",
        applicableRuleSetRevisionRef: submitted.revisionRef,
        applicableRuleSetArtifactRef: candidateArtifactRef,
      });
    } catch (error) {
      return AssembleApplicableRuleSetResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "knowledge-modeling.assessment-basis",
          causalRunId: request.requestId,
        }),
      });
    }
  }

  // ------------------------------------------------------ public basis resolve

  /** C02 `resolve(assessment-basis)`：物化不可变集合引用，不复制任何正文。 */
  async resolve(
    command: Extract<KnowledgeResolutionCommandV1, { kind: "assessment-basis" }>,
  ): Promise<KnowledgeResolutionResultV1> {
    try {
      const authorization = await this.#verifyAuthorization({
        authorization: command.authorization,
        projectId: command.projectId,
        requestId: command.commandId,
        requestedAt: command.payload.requiredAt,
      });
      const snapshot = await this.#preparationSnapshot.readAssessmentPreparationSnapshot({
        projectId: command.projectId,
        actorId: command.actorId,
        requestId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        requestedAt: command.issuedAt,
        authorization,
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        requiredAt: command.payload.requiredAt,
      });
      if (snapshot.kind !== "succeeded") {
        return KnowledgeResolutionResultV1Schema.parse({
          kind: "failed",
          error:
            snapshot.kind === "failed"
              ? snapshot.error
              : moduleError({
                  code: "BUSINESS_BLOCKED",
                  blockerKind: "scoring-rule-basis-unavailable",
                  blockerRef: asContractReference(command.payload.preparationSnapshotRef),
                  causalRunId: command.commandId,
                }),
        });
      }
      const projection = AssessmentPreparationProjectionV1Schema.parse(snapshot.projection);
      if (projection.projectId !== command.projectId) {
        return this.#resolutionDenied(command, "scoring-rule-project-mismatch");
      }
      const releases = await this.#governedReleases.resolveGovernedReleases({
        projectId: command.projectId,
        requiredDefinitionTypes: ["applicable-rule-set"],
        requiredAt: command.payload.requiredAt,
        asOfRecordedAt: command.issuedAt,
        authorization,
      });
      if (releases.kind === "failed") {
        return KnowledgeResolutionResultV1Schema.parse({ kind: "failed", error: releases.error });
      }
      const release = releases.result.members.find(
        (member) => member.definitionType === "applicable-rule-set",
      );
      if (release === undefined || releases.result.members.length !== 1) {
        return this.#resolutionDenied(command, "scoring-rule-basis-unavailable");
      }
      const metadata = await this.#findRevisionMetadata(command.projectId, release.revisionRef);
      if (
        metadata === undefined ||
        metadata.artifactRef.reference.entityId !==
          release.candidateArtifactRef.reference.entityId ||
        metadata.artifactRef.reference.versionId !==
          release.candidateArtifactRef.reference.versionId
      ) {
        return this.#resolutionDenied(command, "scoring-rule-revision-unverified");
      }
      const document = ApplicableRuleSetDocumentV1Schema.parse(
        await this.#readJson(metadata.artifactRef, {
          projectId: command.projectId,
          actorId: command.actorId,
          requestId: `${command.commandId}:applicable-rule-set`,
          requestedAt: command.issuedAt,
          authorization,
          purposeCode: APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
        }),
      );
      if (applicableRuleSetDocumentDigest(document) !== metadata.contentDigest) {
        return this.#resolutionDenied(command, "scoring-rule-artifact-mismatch");
      }
      if (
        !sameVersion(
          document.applicabilitySnapshotRef.reference,
          projection.applicabilitySnapshotRef.reference,
        ) ||
        !sameVersion(document.configurationSetRef, projection.configurationSetRef) ||
        !sameVersion(document.compatibilityRef, projection.compatibilityRef)
      ) {
        return this.#resolutionDenied(command, "scoring-rule-applicability-mismatch");
      }
      const configurationSet = await this.#configuration.resolveConfigurationSet({
        requestId: `${command.commandId}:configuration`,
        idempotencyKey: `${command.idempotencyKey}:configuration`,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization,
        requiredAt: command.payload.requiredAt,
        asOfRecordedAt: command.issuedAt,
      });
      if (configurationSet.kind !== "succeeded") {
        return KnowledgeResolutionResultV1Schema.parse({
          kind: "failed",
          error: configurationSet.error,
        });
      }
      const applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1 = {
        releaseRef: release.releaseRef,
        revisionRef: release.revisionRef,
        artifactRef: metadata.artifactRef,
        contentDigest: metadata.contentDigest,
      };
      const scoringRuleMembers: AssessmentBasisReleaseSetMemberV1[] = [];
      for (const member of projectApplicableRuleSetMembers(document)) {
        const ruleMetadata = await this.#findRevisionMetadata(
          command.projectId,
          member.revisionRef,
        );
        if (
          ruleMetadata === undefined ||
          ruleMetadata.definitionType !== "structured-scoring-rule" ||
          ruleMetadata.artifactRef.reference.entityId !== member.artifactRef.reference.entityId ||
          ruleMetadata.artifactRef.reference.versionId !== member.artifactRef.reference.versionId ||
          ruleMetadata.contentDigest !== member.contentDigest
        ) {
          return this.#resolutionDenied(command, "scoring-rule-basis-unavailable");
        }
        scoringRuleMembers.push(member);
      }
      const configurationMembers: AssessmentBasisConfigurationMemberV1[] =
        configurationSet.configurationSet.members.map((member) => ({
          definitionType: member.definitionType,
          releaseRef: member.releaseRef,
          revisionRef: member.revisionRef,
          artifactRef: member.artifactRef,
          contentDigest: member.contentDigest,
        }));
      const members = buildAssessmentBasisMembers({
        applicableRuleSetMember,
        scoringRuleMembers,
        configurationMembers,
      });
      assertScoringRuleMembersMatchApplicableRuleSet({ document, scoringRuleMembers });
      const memberDigest = assessmentBasisMemberDigest(members);
      const identityDigest = sha256CanonicalJson({
        projectId: command.projectId,
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        applicabilitySnapshotRef: document.applicabilitySnapshotRef,
        applicableRuleSetReleaseRef: release.releaseRef,
        configurationSetRef: document.configurationSetRef,
        requiredAt: command.payload.requiredAt,
        memberDigest,
      });
      const recordedAt = this.#now().toISOString();
      const releaseSet = AssessmentBasisReleaseSetV1Schema.parse({
        schemaVersion: "1",
        projectId: command.projectId,
        assessmentBasisReleaseSetRef: {
          kind: "assessment-basis-release-set",
          reference: { entityId: `assessment-basis-${identityDigest}`, versionId: "1" },
        },
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        applicabilitySnapshotRef: document.applicabilitySnapshotRef,
        applicableRuleSetReleaseRef: release.releaseRef,
        configurationSetRef: document.configurationSetRef,
        requiredAt: command.payload.requiredAt,
        issuedAt: command.issuedAt,
        memberDigest,
        members,
        recordedAt,
      });
      const atomic = atomicCommandFor(command, "knowledge.resolve-assessment-basis.v1", {
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        requiredAt: command.payload.requiredAt,
        identityDigest,
      });
      await this.#transactionUnit.execute(
        atomic,
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          await transaction
            .insertInto("business.assessment_basis_release_sets")
            .values({
              set_id: releaseSet.assessmentBasisReleaseSetRef.reference.entityId,
              version_id: releaseSet.assessmentBasisReleaseSetRef.reference.versionId,
              project_id: command.projectId,
              preparation_snapshot_ref: jsonbValue(releaseSet.preparationSnapshotRef),
              preparation_snapshot_id: releaseSet.preparationSnapshotRef.reference.entityId,
              preparation_snapshot_version_id:
                releaseSet.preparationSnapshotRef.reference.versionId,
              applicability_snapshot_ref: jsonbValue(releaseSet.applicabilitySnapshotRef),
              applicable_rule_set_release_ref: jsonbValue(releaseSet.applicableRuleSetReleaseRef),
              applicable_rule_set_release_id:
                releaseSet.applicableRuleSetReleaseRef.reference.entityId,
              applicable_rule_set_release_version_id:
                releaseSet.applicableRuleSetReleaseRef.reference.versionId,
              configuration_set_ref: jsonbValue(releaseSet.configurationSetRef),
              required_at: releaseSet.requiredAt,
              issued_at: releaseSet.issuedAt,
              member_digest: releaseSet.memberDigest,
              identity_digest: identityDigest,
              member_snapshot: jsonbValue(releaseSet.members),
              command_id: command.commandId,
              actor_ref: command.actorId,
              authorization_context_ref: jsonbValue(command.authorization.authorizationContextRef),
              audit_entry_id: `${command.commandId}:basis-set`,
              occurred_at: command.issuedAt,
              recorded_at: recordedAt,
              persisted_at: recordedAt,
            } as never)
            .onConflict((conflict) => conflict.columns(["set_id", "version_id"]).doNothing())
            .execute();
          return {
            resultRef: releaseSet.assessmentBasisReleaseSetRef,
            audit: {
              auditEntryId: `${command.commandId}:basis-set`,
              projectId: command.projectId,
              action: "knowledge.resolve-assessment-basis",
              targetRef: releaseSet.assessmentBasisReleaseSetRef,
              actorRef: command.actorId,
              authorizationContextRef: command.authorization.authorizationContextRef,
              occurredAt: command.issuedAt,
              recordedAt,
              version: releaseSet.assessmentBasisReleaseSetRef.reference,
              commandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
            },
            events: [],
          };
        },
        { isolationLevel: "repeatable read" },
      );
      return KnowledgeResolutionResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "assessment-basis",
          assessmentBasisReleaseSetRef: releaseSet.assessmentBasisReleaseSetRef,
        },
      });
    } catch (error) {
      return KnowledgeResolutionResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "knowledge-modeling.assessment-basis",
          causalRunId: command.commandId,
        }),
      });
    }
  }

  #resolutionDenied(
    command: Extract<KnowledgeResolutionCommandV1, { kind: "assessment-basis" }>,
    reasonCode: string,
  ): KnowledgeResolutionResultV1 {
    return KnowledgeResolutionResultV1Schema.parse({
      kind: "failed",
      error: moduleError({
        code: "BUSINESS_BLOCKED",
        blockerKind: reasonCode,
        blockerRef: asContractReference(command.payload.preparationSnapshotRef),
        causalRunId: command.commandId,
      }),
    });
  }

  // ------------------------------------------------------ bounded member read

  /**
   * D-14 成员读取：授权复验先于 C03 回执查询与单点读取；工程与 actor 只取 C06 验证结果，
   * 缺失/跨工程/成员不符/撤权统一不可枚举拒绝；成功与不可用结果各自以一条只追加审计进入 C03 回执。
   */
  async readAssessmentBasisReleaseSet(
    input: ReadAssessmentBasisReleaseSetV1,
  ): Promise<AssessmentBasisReleaseSetReadResultV1> {
    let authorization: AuthorizationContextV1;
    try {
      authorization = await this.#verifyReaderAuthorization(input);
    } catch (error) {
      const access = resolveAccessFailure(error);
      if (access !== undefined && access.details.retryable) {
        return AssessmentBasisReleaseSetReadResultV1Schema.parse({
          kind: "failed",
          error: moduleError({ code: "TRANSIENT_FAILURE", causalRunId: input.requestId }),
        });
      }
      // 授权复验失败只由 C06 记录安全拒绝：C19 不以未验证身份写领域审计或回执。
      return this.#basisUnavailable(input);
    }
    try {
      const atomic = atomicCommandFor(
        {
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          projectId: authorization.projectId,
          actorId: authorization.actorId,
          issuedAt: input.requestedAt,
          authorization,
        },
        "knowledge.read-assessment-basis-release-set.v1",
        { assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef },
      );
      const receipt = await this.#transactionUnit.execute(
        atomic,
        async (context): Promise<AtomicCommitV1> =>
          this.#basisReadCommit(context, input, authorization),
      );
      const auditRow = await this.#db
        .selectFrom("audit.entries")
        .select(["action"])
        .where("audit_entry_id", "=", receipt.auditEntryId)
        .executeTakeFirst();
      if (auditRow?.action === BASIS_READ_UNAVAILABLE_ACTION) {
        return this.#basisUnavailable(input);
      }
      if (auditRow?.action !== BASIS_READ_SUCCEEDED_ACTION) {
        return this.#basisReadFailed(input.requestId, "TRANSIENT_FAILURE");
      }
      const row = await this.#db
        .selectFrom("business.assessment_basis_release_sets")
        .selectAll()
        .where("project_id", "=", authorization.projectId)
        .where("set_id", "=", input.assessmentBasisReleaseSetRef.reference.entityId)
        .where("version_id", "=", input.assessmentBasisReleaseSetRef.reference.versionId)
        .executeTakeFirst();
      const projection =
        row === undefined
          ? undefined
          : basisMemberProjection(row, input.assessmentBasisReleaseSetRef);
      if (projection === undefined) {
        return this.#basisReadFailed(input.requestId, "TRANSIENT_FAILURE");
      }
      return AssessmentBasisReleaseSetReadResultV1Schema.parse(projection);
    } catch (error) {
      const mapped = mapPostgresError(error, "scoring-rules.basis-read");
      if (mapped.code === "IDEMPOTENCY_CONFLICT") {
        return AssessmentBasisReleaseSetReadResultV1Schema.parse({
          kind: "failed",
          error: moduleError({
            code: "IDEMPOTENCY_CONFLICT",
            idempotencyKey: input.idempotencyKey,
            priorCommandId: input.requestId,
            causalRunId: input.requestId,
          }),
        });
      }
      return this.#basisReadFailed(
        input.requestId,
        mapped.retryable || mapped.code === "CONNECTION_FAILED"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      );
    }
  }

  /** 首次执行或重放都由同一事务形成结果；回放时 C03 直接返回既有回执。 */
  async #basisReadCommit(
    context: TransactionContextV1,
    input: ReadAssessmentBasisReleaseSetV1,
    authorization: AuthorizationContextV1,
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    const recordedAt = this.#now().toISOString();
    const row = await transaction
      .selectFrom("business.assessment_basis_release_sets")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("set_id", "=", input.assessmentBasisReleaseSetRef.reference.entityId)
      .where("version_id", "=", input.assessmentBasisReleaseSetRef.reference.versionId)
      .executeTakeFirst();
    const projection =
      row === undefined
        ? undefined
        : basisMemberProjection(row, input.assessmentBasisReleaseSetRef);
    const action =
      projection === undefined ? BASIS_READ_UNAVAILABLE_ACTION : BASIS_READ_SUCCEEDED_ACTION;
    return {
      resultRef: input.assessmentBasisReleaseSetRef,
      audit: {
        auditEntryId: `${input.requestId}:${action}`,
        projectId: authorization.projectId,
        action,
        targetRef: input.assessmentBasisReleaseSetRef,
        actorRef: authorization.actorId,
        authorizationContextRef: authorization.authorizationContextRef,
        occurredAt: input.requestedAt,
        recordedAt,
        version: input.assessmentBasisReleaseSetRef.reference,
        commandId: input.requestId,
        idempotencyKey: input.idempotencyKey,
      },
      events: [],
    };
  }

  #basisReadFailed(
    causalRunId: string,
    code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE",
  ): AssessmentBasisReleaseSetReadResultV1 {
    return AssessmentBasisReleaseSetReadResultV1Schema.parse({
      kind: "failed",
      error: moduleError({ code, causalRunId }),
    });
  }

  #basisUnavailable(input: ReadAssessmentBasisReleaseSetV1): AssessmentBasisReleaseSetReadResultV1 {
    return AssessmentBasisReleaseSetReadResultV1Schema.parse({
      kind: "unavailable",
      error: moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: "knowledge-modeling.assessment-basis",
        causalRunId: input.requestId,
        // 同一请求载荷重放必须逐字一致：不可用结果固定以请求时刻为准。
        occurredAt: input.requestedAt,
      }),
    });
  }

  /**
   * 成员读取固定按 `knowledge-modeling.assessment-basis` 对授权上下文做当前事实复验；
   * 不枚举 capability 对应的其它 branch，也不接受调用方自报工程或 actor。
   */
  async #verifyReaderAuthorization(
    input: ReadAssessmentBasisReleaseSetV1,
  ): Promise<AuthorizationContextV1> {
    const capability = input.authorization.grantedCapabilities[0];
    if (capability !== MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.assessment-basis"]) {
      throw new ScoringRuleError({
        code: "AUTHORIZATION_DENIED",
        reasonCode: "scoring-rule-capability-required",
        targetRef: SCORING_RULES_BASIS_TARGET_REF_V1,
      });
    }
    const decision = await this.#access.verify({
      authorizationContextRef: input.authorization.authorizationContextRef,
      invocationId: input.requestId,
      projectId: input.authorization.projectId,
      branch: "knowledge-modeling.assessment-basis",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: input.requestedAt,
    });
    return decision.context;
  }

  // ------------------------------------------------------------------ helpers

  /**
   * 调用方只能提交自己那一个 capability 的上下文：按 capability 反查精确分支复验，
   * 返回按当前事实收窄的授权；全部候选失败与撤权落到同一个不可重试拒绝。
   */
  async #verifyAuthorization(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1> {
    if (input.authorization.projectId !== input.projectId) {
      throw new ScoringRuleError({
        code: "AUTHORIZATION_DENIED",
        reasonCode: "scoring-rule-project-mismatch",
        targetRef: SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
      });
    }
    const capability = input.authorization.grantedCapabilities[0];
    const branches = (Object.keys(MODULE_BRANCH_CAPABILITY_V1) as ModuleBranchV1[])
      .filter((branch) => MODULE_BRANCH_CAPABILITY_V1[branch] === capability)
      .sort();
    let retryable: unknown;
    for (const branch of branches) {
      try {
        const decision = await this.#access.verify({
          authorizationContextRef: input.authorization.authorizationContextRef,
          invocationId: input.requestId,
          projectId: input.projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          requestedAt: input.requestedAt,
        });
        return decision.context;
      } catch (error) {
        const failure = resolveAccessFailure(error);
        if (failure === undefined || failure.details.retryable) retryable = error;
      }
    }
    if (retryable !== undefined) throw retryable;
    throw new ScoringRuleError({
      code: "AUTHORIZATION_DENIED",
      reasonCode: "scoring-rule-capability-required",
      targetRef: SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
    });
  }

  /** C16 已在提交命令内复验过该上下文；这里只用其授权读取 C04 工件。 */
  async #verifyGovernanceAuthorization(command: SubmitScoringRuleRevisionV1) {
    return command.authorization;
  }

  async #findRevisionMetadata(
    projectId: string,
    revisionRef: KnowledgeRevisionRefV1,
    db: Kysely<ScoringRulesDatabase> = this.#db,
  ): Promise<RevisionMetadataView | undefined> {
    const ruleRow = await db
      .selectFrom("business.scoring_rule_revision_metadata")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    if (ruleRow !== undefined) {
      return {
        ...revisionMetadataFromRow(ruleRow),
        relationDigest: ruleRow.relation_digest,
        ...(ruleRow.base_release_ref === null
          ? {}
          : { baseReleaseRef: KnowledgeReleaseRefV1Schema.parse(ruleRow.base_release_ref) }),
        ...(ruleRow.base_revision_ref === null
          ? {}
          : { baseRevisionRef: KnowledgeRevisionRefV1Schema.parse(ruleRow.base_revision_ref) }),
      };
    }
    const setRow = await db
      .selectFrom("business.applicable_rule_set_revision_metadata")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    return setRow === undefined ? undefined : revisionMetadataFromRow(setRow);
  }

  /** 结构化规则修订的关系事实：只读单点，供门禁与组装共用。 */
  async #findRevisionRelations(
    projectId: string,
    revisionRef: KnowledgeRevisionRefV1,
    db: Kysely<ScoringRulesDatabase> = this.#db,
  ): Promise<readonly ScoringRuleRelationV1[]> {
    const rows = await db
      .selectFrom("business.rule_relations")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("revision_version_id", "=", revisionRef.reference.versionId)
      .orderBy("relation_id", "asc")
      .execute();
    return rows.map((row) => relationFromRow(row));
  }

  /**
   * C16 审核/发布前的关系门禁：复验快照摘要、比较基线一致与全部精确 C07 决定。
   * 任一缺失、未决、错目标、非批准或基线不符都抛错，让调用方事务整体失败。
   */
  async #assertRelationGate(input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly db: Kysely<ScoringRulesDatabase>;
    readonly requestedAt: string;
    readonly declaredBaseReleaseRef?: KnowledgeReleaseRefV1;
    readonly declaredBaseRevisionRef?: KnowledgeRevisionRefV1;
  }): Promise<void> {
    const metadata = await this.#findRevisionMetadata(input.projectId, input.revisionRef, input.db);
    if (
      metadata === undefined ||
      metadata.definitionType !== "structured-scoring-rule" ||
      metadata.relationDigest === undefined
    ) {
      failScoringRule("scoring-rule-revision-unverified", asContractReference(input.revisionRef));
    }
    const relations = await this.#findRevisionRelations(
      input.projectId,
      input.revisionRef,
      input.db,
    );
    const recomputed = scoringRuleRelationSnapshotDigest({
      policyRef: this.#policy.conflictPriorityPolicyRef,
      candidateContentDigest: metadata.contentDigest,
      ...(metadata.baseReleaseRef === undefined ? {} : { baseReleaseRef: metadata.baseReleaseRef }),
      ...(metadata.baseRevisionRef === undefined
        ? {}
        : { baseRevisionRef: metadata.baseRevisionRef }),
      relations,
    });
    if (recomputed !== metadata.relationDigest) {
      failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
    }
    // 检测基线与 C16 已校验的 revision 基线必须逐字一致：C16 在提交/发布时已确认它是当前版本。
    const declaredBase = input.declaredBaseReleaseRef;
    const baseMatches =
      (declaredBase === undefined) === (metadata.baseReleaseRef === undefined) &&
      (declaredBase === undefined ||
        (metadata.baseReleaseRef !== undefined &&
          sameVersion(metadata.baseReleaseRef.reference, declaredBase.reference) &&
          metadata.baseRevisionRef !== undefined &&
          input.declaredBaseRevisionRef !== undefined &&
          sameVersion(
            metadata.baseRevisionRef.reference,
            input.declaredBaseRevisionRef.reference,
          )));
    if (!baseMatches) {
      failScoringRule(
        "scoring-rule-base-version-conflict",
        asContractReference(input.revisionRef),
        "STALE_VERSION",
      );
    }
    for (const relation of relations) {
      if (relation.relationKind !== "conflict") continue;
      if (
        relation.retainedRuleVersionRef === undefined ||
        relation.excludedRuleVersionRef === undefined
      ) {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
      const link = await this.#findReviewLink(input.projectId, relation.relationId);
      if (link === undefined || link.reviewTaskRef.reviewType !== "rule-conflict") {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
      const reader = this.#conflictDecisions;
      if (reader === undefined) {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
      const decision = await reader.readRuleConflictDecision({
        projectId: input.projectId,
        relationRef: RuleConflictRefV1Schema.parse(link.reviewTaskRef.targetRef),
        reviewTaskRef: link.reviewTaskRef,
        authorization: input.authorization,
        invocationId: `scoring-rule-conflict-gate-${relation.relationId.slice(0, 32)}`,
        requestedAt: input.requestedAt,
      });
      if (decision.kind !== "decided" || decision.decision !== "approve-publication") {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
    }
  }

  /** 提交成功后按稳定身份补链：失败只留下仍被门禁的候选修订，重试只补缺失事实。 */
  async #ensureConflictReviewLinks(input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly issuedAt: string;
  }): Promise<void> {
    const relations = await this.#findRevisionRelations(input.projectId, input.revisionRef);
    for (const relation of relations) {
      if (relation.relationKind !== "conflict") continue;
      if ((await this.#findReviewLink(input.projectId, relation.relationId)) !== undefined) {
        continue;
      }
      const linker = this.#conflictReview;
      if (linker === undefined) {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
      const identity = sha256CanonicalJson({
        projectId: input.projectId,
        revisionRef: input.revisionRef,
        relationId: relation.relationId,
      });
      const created = await linker.ensureConflictReviewTask({
        projectId: input.projectId,
        relation,
        authorization: input.authorization,
        commandId: `rule-conflict-${identity}`,
        idempotencyKey: `rule-conflict-${identity}`,
        issuedAt: input.issuedAt,
      });
      if (created.kind === "failed" || created.reviewTaskRef.reviewType !== "rule-conflict") {
        failScoringRule("scoring-rule-relation-unresolved", asContractReference(input.revisionRef));
      }
      await this.#appendReviewLink({
        projectId: input.projectId,
        actorId: input.authorization.actorId,
        relation,
        authorization: input.authorization,
        created,
        issuedAt: input.issuedAt,
      });
    }
  }

  /** relation→C07 task 的只追加链接；同键同载荷重放不重复，异载荷冲突。 */
  async #appendReviewLink(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly relation: ScoringRuleRelationV1;
    readonly authorization: AuthorizationContextV1;
    readonly created: { readonly reviewTaskRef: ReviewTaskRefV1; readonly reviewAttemptId: string };
    readonly issuedAt: string;
  }): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `${input.created.reviewAttemptId}:link`;
    const atomic = atomicCommandFor(
      {
        commandId: `${input.created.reviewAttemptId}:link`,
        idempotencyKey: `${input.created.reviewAttemptId}:link`,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
      },
      "knowledge.link-rule-conflict-review.v1",
      {
        relationId: input.relation.relationId,
        reviewAttemptId: input.created.reviewAttemptId,
      },
    );
    await this.#transactionUnit.execute(atomic, async (context): Promise<AtomicCommitV1> => {
      const transaction = asTransaction(context);
      await transaction
        .insertInto("business.rule_conflict_review_links")
        .values({
          link_id: `${input.relation.relationId}:${input.created.reviewAttemptId}`,
          relation_id: input.relation.relationId,
          version_id: "1",
          project_id: input.projectId,
          attempt: 1,
          review_attempt_id: input.created.reviewAttemptId,
          review_task_ref: jsonbValue(input.created.reviewTaskRef),
          command_id: atomic.commandId,
          audit_entry_id: auditEntryId,
          occurred_at: input.issuedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.columns(["link_id"]).doNothing())
        .execute();
      return {
        resultRef: input.created.reviewTaskRef,
        audit: {
          auditEntryId,
          projectId: input.projectId,
          action: "knowledge.link-rule-conflict-review",
          targetRef: input.created.reviewTaskRef,
          actorRef: input.actorId,
          authorizationContextRef: input.authorization.authorizationContextRef,
          occurredAt: input.issuedAt,
          recordedAt,
          version: input.created.reviewTaskRef.reference,
          commandId: atomic.commandId,
          idempotencyKey: atomic.idempotencyKey,
        },
        events: [],
      };
    });
  }

  async #findReviewLink(
    projectId: string,
    relationId: string,
  ): Promise<{ readonly reviewTaskRef: ReviewTaskRefV1 } | undefined> {
    const row = await this.#db
      .selectFrom("business.rule_conflict_review_links")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("relation_id", "=", relationId)
      .where("version_id", "=", "1")
      .orderBy("attempt", "desc")
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : { reviewTaskRef: ReviewTaskRefV1Schema.parse(row.review_task_ref) };
  }

  /**
   * 读取 manifest 声明的精确比较基线（已发布规则文档）。
   * 未声明基线时返回 `undefined`；声明了但不可解析/不可读一律失败，不静默跳过检测。
   */
  async #readBaselineRules(input: {
    readonly manifest: ScoringRuleAuthoringManifestV1;
    readonly task: AgentTaskSnapshotV1;
  }): Promise<
    | {
        readonly releaseRef: KnowledgeReleaseRefV1;
        readonly revisionRef: KnowledgeRevisionRefV1;
        readonly document: StructuredScoringRuleDocumentV1;
      }
    | undefined
  > {
    const declaredReleaseRef = input.manifest.baseRuleReleaseRef;
    if (declaredReleaseRef === undefined) return undefined;
    const projectId = input.task.envelope.projectId;
    const releases = await this.#governedReleases.resolveGovernedReleases({
      projectId,
      requiredDefinitionTypes: ["structured-scoring-rule"],
      requiredAt: input.task.envelope.createdAt,
      asOfRecordedAt: input.task.envelope.createdAt,
      authorization: input.task.envelope.authorization,
    });
    const base =
      releases.kind === "succeeded"
        ? releases.result.members.find((member) =>
            sameVersion(member.releaseRef.reference, declaredReleaseRef.reference),
          )
        : undefined;
    if (base === undefined) {
      failScoringRule(
        "scoring-rule-base-version-conflict",
        asContractReference(declaredReleaseRef),
        "STALE_VERSION",
      );
    }
    const metadata = await this.#findRevisionMetadata(projectId, base.revisionRef);
    if (metadata === undefined || metadata.definitionType !== "structured-scoring-rule") {
      failScoringRule(
        "scoring-rule-base-version-conflict",
        asContractReference(declaredReleaseRef),
        "STALE_VERSION",
      );
    }
    const document = StructuredScoringRuleDocumentV1Schema.parse(
      await this.#readJson(metadata.artifactRef, {
        projectId,
        actorId: input.task.envelope.actorId,
        requestId: `${input.task.envelope.commandId}:base-document`,
        requestedAt: input.task.envelope.createdAt,
        authorization: input.task.envelope.authorization,
        purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
      }),
    );
    if (structuredScoringRuleDocumentDigest(document) !== metadata.contentDigest) {
      failScoringRule("scoring-rule-artifact-mismatch", asContractReference(metadata.artifactRef));
    }
    return { releaseRef: base.releaseRef, revisionRef: base.revisionRef, document };
  }

  async #readIndicatorIds(input: {
    readonly artifactRef: ContentArtifactRefV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly string[]> {
    const content = await this.#readIndicatorSystem({
      ...input,
      requestedAt: input.authorization.decidedAt,
    });
    return content.indicators.map((indicator) => indicator.indicatorId);
  }

  async #readIndicatorSystem(input: {
    readonly artifactRef: ContentArtifactRefV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }) {
    const raw = await this.#readJson(ContentArtifactRefV1Schema.parse(input.artifactRef), {
      ...input,
      purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
    });
    const document = AssessmentConfigurationDocumentV1Schema.parse(raw);
    if (document.definitionType !== "indicator-system") {
      failScoringRule(
        "scoring-rule-configuration-incompatible",
        asContractReference(input.artifactRef),
      );
    }
    return document.content;
  }

  async #put(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly value: unknown;
    readonly artifactKind?: "content" | "diagnostic";
    readonly parentArtifactRefs: readonly ContentArtifactRefV1[];
  }): Promise<ArtifactRefV1> {
    const capability = input.authorization.grantedCapabilities[0]!;
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: `${input.artifactId}:put`,
        idempotencyKey: `${input.artifactId}:put`,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
        requiredCapability: capability,
        artifactId: input.artifactId,
        artifactKind: input.artifactKind ?? "content",
        purposeCode: input.purposeCode,
        mediaType: input.mediaType,
        parentArtifactRefs: [...input.parentArtifactRefs],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(new TextEncoder().encode(canonicalJson(input.value))),
    );
    return ArtifactRefV1Schema.parse(result.artifactRef);
  }

  async #readJson(
    artifactRef: ContentArtifactRefV1,
    input: {
      readonly projectId: string;
      readonly actorId: string;
      readonly requestId: string;
      readonly requestedAt: string;
      readonly authorization: AuthorizationContextV1;
      readonly purposeCode: string;
    },
  ): Promise<unknown> {
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: input.requestId,
        idempotencyKey: `${input.requestId}:read`,
        artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: input.purposeCode,
        requiredCapability: input.authorization.grantedCapabilities[0]!,
        authorization: input.authorization,
      }),
    );
    const bytes = await readBounded(handle);
    await handle.verified;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  }

  #moduleErrorFrom(
    error: Record<string, unknown>,
    causalRunId: string,
    reasonCode: string,
  ): ModuleErrorV1 {
    const parsed = ModuleErrorV1Schema.safeParse(error);
    if (parsed.success) return parsed.data;
    return moduleError({
      code: "BUSINESS_BLOCKED",
      blockerKind: reasonCode,
      blockerRef: SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
      causalRunId,
    });
  }

  async #mapError(
    error: unknown,
    context: { readonly branch: ModuleBranchV1; readonly causalRunId: string },
  ): Promise<ModuleErrorV1> {
    const failure = scoringRuleFailureFrom(error);
    if (failure !== undefined) {
      switch (failure.code) {
        case "AUTHORIZATION_DENIED":
          return moduleError({
            code: "AUTHORIZATION_DENIED",
            branch: context.branch,
            causalRunId: context.causalRunId,
          });
        case "BUSINESS_BLOCKED":
          return moduleError({
            code: "BUSINESS_BLOCKED",
            blockerKind: failure.reasonCode,
            blockerRef: failure.targetRef,
            causalRunId: context.causalRunId,
          });
        case "ENTITY_NOT_FOUND":
        case "STALE_VERSION":
          return moduleError({
            code: failure.code,
            targetRef: failure.targetRef,
            causalRunId: context.causalRunId,
          });
        case "UNSUPPORTED_CONTRACT":
          return moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: context.causalRunId });
        default:
          return moduleError({
            code: failure.code === "TRANSIENT_FAILURE" ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
            causalRunId: context.causalRunId,
          });
      }
    }
    const access = resolveAccessFailure(error);
    if (access !== undefined) {
      if (access.details.code === "AUTHORIZATION_DENIED") {
        return moduleError({
          code: "AUTHORIZATION_DENIED",
          branch: context.branch,
          causalRunId: context.causalRunId,
        });
      }
      return moduleError({
        code: access.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId: context.causalRunId,
      });
    }
    const mapped = mapPostgresError(error, "scoring-rules.adapter");
    return moduleError({
      code:
        mapped.retryable || mapped.code === "CONNECTION_FAILED"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      causalRunId: context.causalRunId,
    });
  }
}

interface RevisionMetadataView {
  readonly definitionType: string;
  readonly artifactRef: ContentArtifactRefV1;
  readonly contentDigest: string;
  readonly projectRevisionRef: JsonColumn;
  readonly compatibilityRef: VersionReference;
  readonly relationDigest?: string;
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
}

const revisionMetadataFromRow = (
  row:
    Selectable<ScoringRuleRevisionMetadataRow> | Selectable<ApplicableRuleSetRevisionMetadataRow>,
): RevisionMetadataView => ({
  definitionType: row.definition_type,
  artifactRef: ContentArtifactRefV1Schema.parse(row.artifact_ref) as never,
  contentDigest: row.content_digest,
  projectRevisionRef: row.project_revision_ref as JsonColumn,
  compatibilityRef: (row as Selectable<ScoringRuleRevisionMetadataRow>).compatibility_ref as never,
});

/** 关系事实行 → strict 领域对象；正文与决定事实都不在此表。 */
const relationFromRow = (row: Selectable<RuleRelationRow>): ScoringRuleRelationV1 =>
  ScoringRuleRelationV1Schema.parse({
    relationId: row.relation_id,
    relationKind: row.relation_kind,
    policyRef: row.policy_ref,
    leftRuleVersion: row.left_rule_version_ref,
    rightRuleVersion: row.right_rule_version_ref,
    leftRuleId: row.left_rule_id,
    rightRuleId: row.right_rule_id,
    overlap: row.overlap,
    overlapDigest: row.overlap_digest,
    ...(row.retained_rule_version_ref === null
      ? {}
      : { retainedRuleVersionRef: row.retained_rule_version_ref }),
    ...(row.excluded_rule_version_ref === null
      ? {}
      : { excludedRuleVersionRef: row.excluded_rule_version_ref }),
    evidenceReferences: row.evidence_references,
  });

export const createPostgresScoringRulesAdapter = (
  options: PostgresScoringRulesAdapterOptionsV1,
): PostgresScoringRulesAdapter => new PostgresScoringRulesAdapter(options);

/**
 * 持久化成员快照 → 顶层 success 投影：strict parse、摘要复算与集合引用一致全部通过才返回，
 * 否则调用方按统一不可枚举拒绝处理。不打开任何 C04 工件，也不返回内部集合字段。
 */
const basisMemberProjection = (
  row: Selectable<AssessmentBasisReleaseSetRow>,
  requestedRef: ReadAssessmentBasisReleaseSetV1["assessmentBasisReleaseSetRef"],
): AssessmentBasisReleaseSetReadResultV1 | undefined => {
  try {
    if (
      row.set_id !== requestedRef.reference.entityId ||
      row.version_id !== requestedRef.reference.versionId
    ) {
      return undefined;
    }
    const raw =
      typeof row.member_snapshot === "string"
        ? (JSON.parse(row.member_snapshot) as unknown)
        : row.member_snapshot;
    const members = AssessmentBasisReleaseSetMembersV1Schema.parse(raw);
    if (assessmentBasisMemberDigest(members) !== row.member_digest) return undefined;
    const applicableReleaseRef = KnowledgeReleaseRefV1Schema.parse(
      row.applicable_rule_set_release_ref,
    );
    if (
      !sameVersion(
        members.applicableRuleSetMember.releaseRef.reference,
        applicableReleaseRef.reference,
      )
    ) {
      return undefined;
    }
    return AssessmentBasisReleaseSetReadResultV1Schema.parse({
      kind: "succeeded",
      schemaVersion: "1",
      assessmentBasisReleaseSetRef: requestedRef,
      memberDigest: row.member_digest,
      applicableRuleSetMember: members.applicableRuleSetMember,
      scoringRuleMembers: members.scoringRuleMembers,
      configurationMembers: members.configurationMembers,
    });
  } catch {
    return undefined;
  }
};

/** C02 命令的规范原子命令包装：只带引用与摘要，不含正文。 */
const atomicCommandFor = (
  command: {
    readonly commandId?: string;
    readonly requestId?: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt?: string;
    readonly requestedAt?: string;
    readonly authorization: { readonly authorizationContextRef: unknown };
  },
  commandKind: string,
  payload: Record<string, unknown>,
): AtomicCommandV1 => ({
  projectId: command.projectId,
  commandKind,
  commandId: IdentifierSchema.parse(command.commandId ?? command.requestId),
  idempotencyKey: command.idempotencyKey,
  payload: JSON.parse(JSON.stringify(payload)) as never,
  actorRef: command.actorId,
  authorizationContextRef: command.authorization.authorizationContextRef as never,
  issuedAt: IsoDateTimeSchema.parse(command.issuedAt ?? command.requestedAt),
});

/** C06 在事务内抛出的是裸错误，事务外则被包装；两种情况都必须映射为授权失败。 */
const resolveAccessFailure = (error: unknown): AccessServiceError | undefined => {
  if (error instanceof AccessServiceError) return error;
  if (!(error instanceof Error)) return undefined;
  const wrapped = (error as Error & { accessError?: unknown }).accessError;
  if (wrapped instanceof AccessServiceError) return wrapped;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof AccessServiceError ? cause : undefined;
};
