import type { ColumnType, Kysely, Selectable, Transaction } from "kysely";

import type {
  AgentTaskResultRefV1,
  ContentArtifactRefV1,
  ReviewTaskRefV1,
  StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeResolutionResultV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
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
  AssessmentBasisReleaseSetV1Schema,
  AssessmentBasisReleaseSetReadResultV1Schema,
  AssessmentPreparationProjectionV1Schema,
  AssembleApplicableRuleSetResultV1Schema,
  PrepareScoringRuleAuthoringResultV1Schema,
  ScoringRuleAuthoringCandidateV1Schema,
  ScoringRuleAuthoringManifestV1Schema,
  ScoringRuleError,
  SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
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
  relation_kind: string;
  policy_ref: JsonColumn;
  overlap_digest: string;
  status: string;
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
  decision_ref: JsonColumn | null;
  status: string;
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

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

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
    | { code: "AUTHORIZATION_DENIED"; branch: ModuleBranchV1; causalRunId: string }
    | {
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        targetRef: ContractReferenceV1;
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
    stageCode: `scoring-rules.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
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
      const manifestArtifactRef = await this.#put({
        projectId: request.projectId,
        actorId: request.actorId,
        issuedAt: request.requestedAt,
        authorization,
        artifactId: `scoring-rule-manifest-${manifestDigest.slice(0, 40)}`,
        purposeCode: SCORING_RULE_AUTHORING_MANIFEST_PURPOSE_CODE_V1,
        mediaType: "application/json",
        value: manifest,
        parentArtifactRefs: [],
      });
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
    const baseDocument = await this.#readBaseDocument(manifest, input.task);
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
    const validationArtifactRef = await this.#put({
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
    });
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
    const baseDocument = await this.#readBaseDocument(manifest, input.task);
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
    const candidateArtifactRef = await this.#put({
      projectId: input.task.envelope.projectId,
      actorId: input.task.envelope.actorId,
      issuedAt: input.task.envelope.createdAt,
      authorization: input.task.envelope.authorization,
      artifactId: `structured-scoring-rule-${contentDigest.slice(0, 40)}`,
      purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
      mediaType: STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
      value: document,
      parentArtifactRefs: [],
    });
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
          requestId: `${command.projectId}:scoring-rule-revision`,
          requestedAt: authorization.decidedAt,
          authorization,
          purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
        }),
      );
      return {
        definitionType: command.definitionType,
        projectRevisionRef: document.projectRevisionRef,
        compatibilityRef: document.compatibilityRef,
        contentDigest: structuredScoringRuleDocumentDigest(document),
        itemCount: document.members.length,
      };
    }
    const document = ApplicableRuleSetDocumentV1Schema.parse(
      await this.#readJson(artifactRef, {
        projectId: command.projectId,
        actorId: command.authorization.actorId,
        requestId: `${command.projectId}:applicable-rule-set-revision`,
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
          item_count: input.prepared.itemCount,
          command_id: input.commandId,
          audit_entry_id: input.auditEntryId,
          occurred_at: input.persistedAt,
          recorded_at: input.persistedAt,
          persisted_at: input.persistedAt,
        })
        .onConflict((conflict) => conflict.columns(["revision_id", "version_id"]).doNothing())
        .execute();
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
  }

  async appendRelease(
    _context: TransactionContextV1,
    input: ScoringRuleReleaseAppendV1,
  ): Promise<DomainEventV1[]> {
    const metadata = await this.#findRevisionMetadata(input.command.projectId, input.revisionRef);
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
      }
      if (candidates.length === 0) {
        failScoringRule("scoring-rule-set-incomplete", SCORING_RULES_ASSEMBLY_TARGET_REF_V1);
      }
      const relations = detectRuleRelations({
        policyRef: this.#policy.conflictPriorityPolicyRef,
        candidates: candidates.map((candidate) => ({
          rule: candidate.member.rule,
          sourceVersionRef: candidate.member.binding.sourceVersionRef,
        })),
      });
      const approvedConflicts = await this.#ensureConflictReviewLinks({
        request,
        authorization,
        relations,
      });
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
      const candidateArtifactRef = await this.#put({
        projectId: request.projectId,
        actorId: request.actorId,
        issuedAt: request.requestedAt,
        authorization,
        artifactId: `applicable-rule-set-${contentDigest.slice(0, 40)}`,
        purposeCode: APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
        mediaType: APPLICABLE_RULE_SET_MEDIA_TYPE_V1,
        value: document,
        parentArtifactRefs: [],
      });
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

  /** 每个未决冲突都先耐久记录，再由 C07 幂等创建审阅任务并回填链接。 */
  async #ensureConflictReviewLinks(input: {
    readonly request: AssembleApplicableRuleSetV1;
    readonly authorization: AuthorizationContextV1;
    readonly relations: readonly ScoringRuleRelationV1[];
  }): Promise<
    readonly {
      retainedRuleVersionRef: VersionReference;
      excludedRuleVersionRef: VersionReference;
    }[]
  > {
    const approved: {
      retainedRuleVersionRef: VersionReference;
      excludedRuleVersionRef: VersionReference;
    }[] = [];
    for (const relation of input.relations) {
      if (relation.relationKind !== "conflict") continue;
      const existing = await this.#findReviewLink(input.request.projectId, relation.relationId);
      if (existing === undefined) {
        await this.#appendRelation(input.request, input.authorization, relation);
        if (this.#conflictReview === undefined) {
          failScoringRule(
            "scoring-rule-relation-unresolved",
            asContractReference(input.request.projectRevisionRef),
          );
        }
        const created = await this.#conflictReview.ensureConflictReviewTask({
          projectId: input.request.projectId,
          relation,
          authorization: input.authorization,
          commandId: `${input.request.requestId}:conflict:${relation.relationId}`,
          idempotencyKey: `${input.request.idempotencyKey}:conflict:${relation.relationId}`,
          issuedAt: input.request.requestedAt,
        });
        if (created.kind === "failed") {
          failScoringRule(
            "scoring-rule-relation-unresolved",
            asContractReference(input.request.projectRevisionRef),
          );
        }
        await this.#appendReviewLink(input.request, input.authorization, relation, created);
      }
      const link =
        existing ?? (await this.#findReviewLink(input.request.projectId, relation.relationId));
      if (link?.status !== "approved") {
        failScoringRule(
          "scoring-rule-relation-unresolved",
          asContractReference(input.request.projectRevisionRef),
        );
      }
      const retained = relation.retainedRuleVersionRef;
      const excluded = relation.excludedRuleVersionRef;
      if (retained === undefined || excluded === undefined) {
        failScoringRule(
          "scoring-rule-relation-unresolved",
          asContractReference(input.request.projectRevisionRef),
        );
      }
      approved.push({ retainedRuleVersionRef: retained, excludedRuleVersionRef: excluded });
    }
    return approved;
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
   * D-14 成员读取：授权复验先于单点查询；缺失/跨工程/撤权/不存在统一不可枚举拒绝，
   * 成功与不可用结果都以只追加审计进入既有 C03 回执。
   */
  async readAssessmentBasisReleaseSet(
    input: ReadAssessmentBasisReleaseSetV1,
  ): Promise<AssessmentBasisReleaseSetReadResultV1> {
    const requestedAt = input.requestedAt;
    try {
      const authorization = await this.#verifyAuthorization({
        authorization: input.authorization,
        projectId: input.projectId,
        requestId: input.requestId,
        requestedAt,
      });
      const row = await this.#db
        .selectFrom("business.assessment_basis_release_sets")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("set_id", "=", input.assessmentBasisReleaseSetRef.reference.entityId)
        .where("version_id", "=", input.assessmentBasisReleaseSetRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) {
        return this.#basisUnavailable(input);
      }
      const releaseSet = AssessmentBasisReleaseSetV1Schema.parse({
        schemaVersion: "1",
        projectId: row.project_id,
        assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
        preparationSnapshotRef: row.preparation_snapshot_ref,
        applicabilitySnapshotRef: row.applicability_snapshot_ref,
        applicableRuleSetReleaseRef: row.applicable_rule_set_release_ref,
        configurationSetRef: row.configuration_set_ref,
        requiredAt: asIso(row.required_at),
        issuedAt: asIso(row.issued_at),
        memberDigest: row.member_digest,
        members:
          typeof row.member_snapshot === "string"
            ? JSON.parse(row.member_snapshot)
            : row.member_snapshot,
        recordedAt: asIso(row.recorded_at),
      });
      if (
        releaseSet.projectId !== input.projectId ||
        assessmentBasisMemberDigest(releaseSet.members) !== row.member_digest
      ) {
        return this.#basisUnavailable(input);
      }
      const recordedAt = this.#now().toISOString();
      const resultRef = input.assessmentBasisReleaseSetRef;
      const action = "knowledge.read-assessment-basis-release-set.succeeded";
      await this.#appendReadReceipt({
        input,
        authorization,
        resultRef,
        action,
        recordedAt,
        payload: {
          assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
          memberDigest: releaseSet.memberDigest,
        },
      });
      return AssessmentBasisReleaseSetReadResultV1Schema.parse({
        kind: "succeeded",
        releaseSet,
      });
    } catch (error) {
      const failure = scoringRuleFailureFrom(error);
      const access = resolveAccessFailure(error);
      if (failure === undefined && access === undefined) {
        return AssessmentBasisReleaseSetReadResultV1Schema.parse({
          kind: "unavailable",
          error: moduleError({ code: "TRANSIENT_FAILURE", causalRunId: input.requestId }),
        });
      }
      return this.#basisUnavailable(input);
    }
  }

  #basisUnavailable(input: ReadAssessmentBasisReleaseSetV1): AssessmentBasisReleaseSetReadResultV1 {
    return AssessmentBasisReleaseSetReadResultV1Schema.parse({
      kind: "unavailable",
      error: moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: "knowledge-modeling.assessment-basis",
        causalRunId: input.requestId,
      }),
    });
  }

  async #appendReadReceipt(input: {
    readonly input: ReadAssessmentBasisReleaseSetV1;
    readonly authorization: AuthorizationContextV1;
    readonly resultRef: ReadAssessmentBasisReleaseSetV1["assessmentBasisReleaseSetRef"];
    readonly action: string;
    readonly recordedAt: string;
    readonly payload: Record<string, unknown>;
  }): Promise<void> {
    const atomic = atomicCommandFor(input.input, "knowledge.read-assessment-basis-release-set.v1", {
      ...input.payload,
      action: input.action,
    });
    await this.#transactionUnit.execute(atomic, async (): Promise<AtomicCommitV1> => ({
      resultRef: input.resultRef,
      audit: {
        auditEntryId: `${input.input.requestId}:${input.action}`,
        projectId: input.input.projectId,
        action: input.action,
        targetRef: input.resultRef,
        actorRef: input.input.actorId,
        authorizationContextRef: input.authorization.authorizationContextRef,
        occurredAt: input.input.requestedAt,
        recordedAt: input.recordedAt,
        version: input.resultRef.reference,
        commandId: input.input.requestId,
        idempotencyKey: input.input.idempotencyKey,
      },
      events: [],
    }));
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
  ): Promise<
    | {
        readonly definitionType: string;
        readonly artifactRef: ContentArtifactRefV1;
        readonly contentDigest: string;
        readonly projectRevisionRef: JsonColumn;
        readonly compatibilityRef: VersionReference;
      }
    | undefined
  > {
    const ruleRow = await this.#db
      .selectFrom("business.scoring_rule_revision_metadata")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    if (ruleRow !== undefined) return revisionMetadataFromRow(ruleRow);
    const setRow = await this.#db
      .selectFrom("business.applicable_rule_set_revision_metadata")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    return setRow === undefined ? undefined : revisionMetadataFromRow(setRow);
  }

  async #appendRelation(
    request: AssembleApplicableRuleSetV1,
    authorization: AuthorizationContextV1,
    relation: ScoringRuleRelationV1,
  ): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `${request.requestId}:relation:${relation.relationId}`;
    const atomic = atomicCommandFor(request, "knowledge.record-rule-relation.v1", {
      relationId: relation.relationId,
      relationKind: relation.relationKind,
      overlapDigest: relation.overlapDigest,
    });
    await this.#transactionUnit.execute(atomic, async (context): Promise<AtomicCommitV1> => {
      const transaction = asTransaction(context);
      await transaction
        .insertInto("business.rule_relations")
        .values({
          relation_id: relation.relationId,
          version_id: "1",
          project_id: request.projectId,
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
          status: "pending",
          command_id: request.requestId,
          audit_entry_id: auditEntryId,
          occurred_at: request.requestedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.columns(["relation_id", "version_id"]).doNothing())
        .execute();
      return {
        resultRef: {
          kind: "knowledge-revision",
          reference: { entityId: `relation:${relation.relationId}`, versionId: "1" },
        },
        audit: {
          auditEntryId,
          projectId: request.projectId,
          action: "knowledge.record-rule-relation",
          targetRef: {
            kind: "knowledge-revision",
            reference: { entityId: `relation:${relation.relationId}`, versionId: "1" },
          },
          actorRef: request.actorId,
          authorizationContextRef: authorization.authorizationContextRef,
          occurredAt: request.requestedAt,
          recordedAt,
          version: { entityId: `relation:${relation.relationId}`, versionId: "1" },
          commandId: request.requestId,
          idempotencyKey: atomic.idempotencyKey,
        },
        events: [],
      };
    });
  }

  async #appendReviewLink(
    request: AssembleApplicableRuleSetV1,
    authorization: AuthorizationContextV1,
    relation: ScoringRuleRelationV1,
    created: { readonly reviewTaskRef: ReviewTaskRefV1; readonly reviewAttemptId: string },
  ): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `${request.requestId}:link:${relation.relationId}`;
    // 补链是关系事实之后的独立原子命令；C03 回执按 command_id 唯一，不能复用组装请求身份。
    const atomic = atomicCommandFor(
      {
        ...request,
        requestId: `${request.requestId}:link:${relation.relationId}`,
        idempotencyKey: `${request.idempotencyKey}:link:${relation.relationId}`,
      },
      "knowledge.link-rule-conflict-review.v1",
      {
        relationId: relation.relationId,
        reviewAttemptId: created.reviewAttemptId,
      },
    );
    await this.#transactionUnit.execute(atomic, async (context): Promise<AtomicCommitV1> => {
      const transaction = asTransaction(context);
      await transaction
        .insertInto("business.rule_conflict_review_links")
        .values({
          link_id: `${relation.relationId}:${created.reviewAttemptId}`,
          relation_id: relation.relationId,
          version_id: "1",
          project_id: request.projectId,
          attempt: 1,
          review_attempt_id: created.reviewAttemptId,
          review_task_ref: jsonbValue(created.reviewTaskRef),
          decision_ref: null,
          status: "pending",
          command_id: atomic.commandId,
          audit_entry_id: auditEntryId,
          occurred_at: request.requestedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.columns(["link_id"]).doNothing())
        .execute();
      return {
        resultRef: created.reviewTaskRef,
        audit: {
          auditEntryId,
          projectId: request.projectId,
          action: "knowledge.link-rule-conflict-review",
          targetRef: created.reviewTaskRef,
          actorRef: request.actorId,
          authorizationContextRef: authorization.authorizationContextRef,
          occurredAt: request.requestedAt,
          recordedAt,
          version: created.reviewTaskRef.reference,
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
  ): Promise<{ readonly status: string; readonly decisionRef: unknown } | undefined> {
    const row = await this.#db
      .selectFrom("business.rule_conflict_review_links")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("relation_id", "=", relationId)
      .where("version_id", "=", "1")
      .orderBy("attempt", "desc")
      .executeTakeFirst();
    return row === undefined ? undefined : { status: row.status, decisionRef: row.decision_ref };
  }

  async #readBaseDocument(
    manifest: ScoringRuleAuthoringManifestV1,
    task: AgentTaskSnapshotV1,
  ): Promise<StructuredScoringRuleDocumentV1 | undefined> {
    if (manifest.baseRuleReleaseRef === undefined) return undefined;
    const releases = await this.#governedReleases.resolveGovernedReleases({
      projectId: task.envelope.projectId,
      requiredDefinitionTypes: ["structured-scoring-rule"],
      requiredAt: task.envelope.createdAt,
      asOfRecordedAt: task.envelope.createdAt,
      authorization: task.envelope.authorization,
    });
    if (releases.kind === "failed") return undefined;
    const base = releases.result.members.find((member) =>
      sameVersion(member.releaseRef.reference, manifest.baseRuleReleaseRef!.reference),
    );
    if (base === undefined) return undefined;
    const metadata = await this.#findRevisionMetadata(task.envelope.projectId, base.revisionRef);
    if (metadata === undefined) return undefined;
    return StructuredScoringRuleDocumentV1Schema.parse(
      await this.#readJson(metadata.artifactRef, {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        requestId: `${task.envelope.commandId}:base-document`,
        requestedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
        purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
      }),
    );
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
  }): Promise<ContentArtifactRefV1> {
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
    return ContentArtifactRefV1Schema.parse(result.artifactRef);
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

export const createPostgresScoringRulesAdapter = (
  options: PostgresScoringRulesAdapterOptionsV1,
): PostgresScoringRulesAdapter => new PostgresScoringRulesAdapter(options);

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
