import { isDeepStrictEqual } from "node:util";

import {
  sql,
  type ColumnType,
  type Kysely,
  type Selectable,
  type SqlBool,
  type Transaction,
} from "kysely";

import {
  canonicalJson,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  isAuthorizationSubset,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
  ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1,
  AssessmentConfigurationDocumentV1Schema,
  ASSESSMENT_SCORING_CONFIGURATION_TYPES,
  assessmentConfigurationDocumentDigest,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import type { PostgresAssessmentConfigurationAdapter } from "../../assessment-config/index.js";
import type { ApplicabilityMetadataSnapshotV1 } from "@riskflow/core/engineering-data/context-source";
import {
  AssessmentDecisionArtifactV1Schema,
  ForecastRiskStateRequestV1Schema,
  ForecastRiskStateResultV1Schema,
  IndicatorActualValueSetV1Schema,
  type AssessmentDecisionArtifactV1,
  type ForecastRiskStateRequestV1,
  type ForecastRiskStateResultV1,
  type IndicatorActualValueSetV1,
} from "@riskflow/core/risk-assessment/engine";
import type {
  AssessmentConfigurationV1,
  AssessmentDownstreamAuthorizationRequestV1,
  AssessmentDownstreamAuthorizerV1,
  AssessmentEngineContextV1,
  AssessmentInputSnapshotReaderV1,
  AssessmentMonitoringInputV1,
  AssessmentMonitoringReaderV1,
  AssessmentPreparationContextReaderV1,
  ForecastRiskStatePortV1,
  RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
  RISK_ASSESSMENT_MAX_ARTIFACT_BYTES_V1,
  RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
  RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1,
  RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
  RiskInputFactsV1Schema,
  evaluateDeterministicAssessment,
  mapAssessmentRiskLevel,
  scoreAssessmentAxes,
  readApplicableRuleSetDocument,
  readStructuredScoringRuleDocument,
  riskAssessmentFailureFrom,
  toModuleError,
  type AssessmentScoringContextV1,
  type DeterministicAssessmentV1,
  type RiskInputFactsV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  assertScoringRuleMembersMatchApplicableRuleSet,
  type ApplicableRuleSetDocumentV1,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type AssessmentBasisReleaseSetReaderV1,
  type StructuredScoringRuleDocumentV1,
} from "@riskflow/core/scoring-rules";
import {
  AssessmentInputSnapshotSchema,
  AssessmentInputSnapshotV2Schema,
  AssessmentScoringReferencesSchema,
  AssessmentPreparationSnapshotV1Schema,
} from "@riskflow/contracts/workflows";
import type {
  AssessmentInputSnapshot,
  AssessmentScoringReferences,
  AssessmentPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";
import { RiskAssessmentRecordSchema } from "@riskflow/contracts/records";
import {
  ActualAssessmentProofQueryV1Schema,
  AssessmentEvaluationCommandV1Schema,
  AssessmentEvaluationResultV1Schema,
  AssessmentPreparationCommandV1Schema,
  AssessmentPreparationResultV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeReleaseRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  RiskAssessmentReadQueryV1Schema,
  RiskAssessmentReadResultV1Schema,
  RiskInputVersionRefV1Schema,
  type ActualAssessmentProofPortV1,
  type ActualAssessmentProofQueryV1,
  type ActualAssessmentProofResultV1,
  type AssessmentEntryContextReadPortV1,
  type AssessmentEntryContextReadQueryV1,
  type AssessmentEvaluationCommandV1,
  type AssessmentEvaluationResultV1,
  type AssessmentPreparationCommandV1,
  type AssessmentPreparationResultV1,
  type AssessmentMatrixPlotV1,
  type AssessmentRecordCatalogItemV1,
  type AssessmentRecordViewV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type PendingRiskItemV1,
  type ReadActionV1,
  type ReassessmentHistoryItemV1,
  type RiskAssessmentPortV1,
  type RiskAssessmentReadPortV1,
  type RiskAssessmentReadQueryV1,
  type RiskAssessmentReadResultV1,
  type RiskAssessmentRecordRefV1,
  type RiskInputVersionRefV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
  type WorkflowEntryModeV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { RiskIdentificationReadPortV1 } from "@riskflow/contracts/ports";
import {
  workflowGraphInvocationIdV1,
  type AssessmentEntriesReadPortV1,
  type AssessmentRunReadPortV1,
} from "@riskflow/core/workflow";
import { VersionReferenceSchema, type VersionReference } from "@riskflow/contracts/common";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";

import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

/** C34 读命令按 `operation` 判别：公共查询信封把 payload 包在 discriminator 内，直接对顶层
 *  `Extract` 不会收窄，因此在此显式取出 payload 判别联合。 */
type C34ReadCommandV1<T extends RiskAssessmentReadQueryV1["payload"]["operation"]> = Omit<
  RiskAssessmentReadQueryV1,
  "payload"
> & {
  readonly payload: Extract<RiskAssessmentReadQueryV1["payload"], { readonly operation: T }>;
};

type JsonColumn = ColumnType<unknown, unknown, unknown>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface AssessmentInputSnapshotRow {
  input_snapshot_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  payload_hash: string;
  preparation_snapshot_ref: JsonColumn;
  preparation_snapshot_id: string;
  preparation_snapshot_version_id: string;
  basis_release_set_ref: JsonColumn;
  basis_release_set_id: string;
  basis_release_set_version_id: string;
  previous_assessment_record_ref: JsonColumn | null;
  entry_kind: string;
  effective_at: TimestampColumn | null;
  reference_digest: string;
  snapshot_payload: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface IndicatorActualValueSetRow {
  value_set_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  content_digest: string;
  evidence_digest: string;
  value_set_payload: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface AssessmentDecisionArtifactRow {
  decision_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  value_set_id: string;
  value_set_version_id: string;
  value_set_ref: JsonColumn;
  content_artifact_ref: JsonColumn;
  content_artifact_id: string;
  content_artifact_version_id: string;
  content_digest: string;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RiskAssessmentRecordRow {
  record_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  risk_input_kind: string;
  risk_record_id: string | null;
  external_risk_event_id: string | null;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  value_set_id: string;
  value_set_version_id: string;
  decision_id: string;
  decision_version_id: string;
  record_payload: JsonColumn;
  likelihood_score_canonical: string;
  consequence_score_canonical: string;
  risk_level_id: string;
  configuration_digest: string;
  content_digest: string;
  identity_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

/**
 * 准备快照登记行的完整列集合。读侧要用到入口方式、空间范围、风险输入精确版本与前驱，
 * 只声明前四列会让这些登记事实对类型不可见，因此按建表迁移补全。
 */
interface AssessmentPreparationSnapshotRow {
  project_id: string;
  snapshot_id: string;
  version_id: string;
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  payload_hash: string;
  risk_input_ref: JsonColumn;
  risk_input_kind: string;
  risk_input_entity_id: string;
  risk_input_version_id: string;
  project_revision_ref: JsonColumn;
  spatial_scope_ref: JsonColumn;
  applicability_snapshot_ref: JsonColumn;
  monitoring_snapshot_refs: JsonColumn | null;
  entry_mode: string;
  trigger_reason_code: string;
  previous_assessment_record_ref: JsonColumn | null;
  causal_run_ref: JsonColumn | null;
  snapshot_payload: JsonColumn;
  applicability_values: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RiskAssessmentDatabase extends PostgresDatabase {
  "business.assessment_preparation_snapshots": AssessmentPreparationSnapshotRow;
  "business.assessment_input_snapshots": AssessmentInputSnapshotRow;
  "business.indicator_actual_value_sets": IndicatorActualValueSetRow;
  "business.assessment_decision_artifacts": AssessmentDecisionArtifactRow;
  "business.risk_assessment_records": RiskAssessmentRecordRow;
}

const asRiskAssessmentTransaction = (
  context: TransactionContextV1,
): Transaction<RiskAssessmentDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<RiskAssessmentDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

// 并发重复等待窗：另一事务登记同一内容寻址工件的有限等待与轮询间隔。
const CONCURRENT_ARTIFACT_WAIT_MS_V1 = 15_000;
const CONCURRENT_ARTIFACT_POLL_MS_V1 = 250;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const refKey = (value: { readonly kind: string; readonly reference: VersionReference }): string =>
  `${value.kind}\u0000${value.reference.entityId}\u0000${value.reference.versionId}`;

const versionKey = (value: VersionReference): string => `${value.entityId}\u0000${value.versionId}`;

/** 登记列里的契约引用只取其版本身份；形状不成立时按不匹配处理，不补默认值。 */
const asVersionRef = (value: unknown): VersionReference => {
  const parsed = VersionReferenceSchema.safeParse(
    typeof value === "object" && value !== null && "reference" in value
      ? (value as { readonly reference: unknown }).reference
      : value,
  );
  return parsed.success
    ? parsed.data
    : { entityId: "\u0000unresolved", versionId: "\u0000unresolved" };
};

const withoutClock = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "createdAt" && key !== "createdBy" && key !== "auditTrailRef",
    ),
  );

const moduleError = (
  code: ModuleErrorV1["code"],
  causalRunId: string,
  extras: Partial<Record<string, unknown>> = {},
  requiredCapability: ModuleCapabilityV1 = "risk-assessment.read",
): ModuleErrorV1 => {
  const common = {
    stageCode: "risk-assessment.engine",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      ...extras,
    });
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "technical",
      retryable: false,
      schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
      ...extras,
    });
  }
  if (code === "BUSINESS_BLOCKED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "risk-assessment",
      blockerRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    });
  }
  if (code === "STALE_VERSION") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "concurrency",
      retryable: false,
      targetRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    });
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: "unknown",
      priorCommandId: "unknown",
      ...extras,
    });
  }
  return ModuleErrorV1Schema.parse({
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "risk-assessment-failure", versionId: "1" },
    },
    ...extras,
  });
};

const failureToModuleError = (error: unknown, causalRunId: string): ModuleErrorV1 => {
  const failure = riskAssessmentFailureFrom(error);
  if (failure !== undefined) return toModuleError(failure, causalRunId);
  // C06 在撤权/会话失效时抛 AccessServiceError：按闭合授权错误表达，不折叠成终止失败。
  if (error instanceof AccessServiceError) {
    return moduleError("AUTHORIZATION_DENIED", causalRunId);
  }
  // 已类型化的模块错误（授权/陈旧/业务阻断）原样保留，不被折叠成终止失败。
  const typed = ModuleErrorV1Schema.safeParse(
    typeof error === "object" && error !== null && "code" in error && "category" in error
      ? error
      : undefined,
  );
  if (typed.success) return typed.data;
  // C03 回执冲突与数据库故障：幂等冲突保持不可重试，其余按可重试性分流。
  const mapped = mapPostgresError(error, "risk-assessment.engine");
  if (mapped.code === "IDEMPOTENCY_CONFLICT") {
    return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
  }
  return moduleError(mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE", causalRunId);
};

const readBounded = async (
  handle: ArtifactReadHandleV1,
  targetRef: ContractReferenceV1,
  causalRunId: string,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of handle.content) {
    byteLength += chunk.byteLength;
    if (byteLength > ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1) {
      throw moduleError("STALE_VERSION", causalRunId, { targetRef });
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const INPUT_SNAPSHOT_REFERENCE_FIELDS_V1 = Object.keys(
  AssessmentScoringReferencesSchema.shape,
) as (keyof AssessmentScoringReferences)[];

/** 经 basis 接缝签发的上下文只带 `knowledge-modeling.read`；C04 读取必须与之一致。 */
const BASIS_READ_CAPABILITY: ModuleCapabilityV1 =
  MODULE_BRANCH_CAPABILITY_V1[RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers];

const branchForCommandKind = (kind: AssessmentPreparationCommandV1["kind"]): ModuleBranchV1 =>
  kind === "initial"
    ? "risk-assessment.initial"
    : kind === "reassessment"
      ? "risk-assessment.reassessment"
      : "risk-assessment.historical-backfill";

/**
 * 准备快照声明的读取范围：空间引用与证据资料版本。
 * 下游窄读与只读证明都用它声明将要读取的范围，再由 C06 复验是否仍在授权内。
 */
const declaredPreparationRefs = (
  preparation: AssessmentPreparationSnapshotV1,
): {
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
} => ({
  spatialScopeRef: preparation.spatialScopeRef,
  sourceVersionRefs: [
    ...new Map(
      preparation.sourceEvidenceReferences.map((evidence) => [
        versionKey(evidence.sourceVersion),
        { kind: "source-version" as const, reference: evidence.sourceVersion },
      ]),
    ).values(),
  ].sort((left, right) => (versionKey(left.reference) < versionKey(right.reference) ? -1 : 1)),
});

type PreparationReadV1 = Awaited<
  ReturnType<AssessmentPreparationContextReaderV1["readAssessmentPreparationContext"]>
>;
type PreparationContextV1 = Extract<PreparationReadV1, { kind: "succeeded" }>;
type InputSnapshotRefV1 = Extract<ContractReferenceV1, { kind: "assessment-input-snapshot" }>;
type BasisRefV1 = Extract<ContractReferenceV1, { kind: "assessment-basis-release-set" }>;

interface EvaluationResultRefsV1 {
  readonly indicatorActualValueSetRef: Extract<
    ContractReferenceV1,
    { kind: "indicator-actual-value-set" }
  >;
  readonly assessmentDecisionArtifactRef: Extract<
    ContractReferenceV1,
    { kind: "assessment-decision-artifact" }
  >;
  readonly assessmentRecordRef: Extract<ContractReferenceV1, { kind: "risk-assessment-record" }>;
}

interface LoadedBasisV1 {
  /** C19 集合成员摘要：提交前复验用它证明读取到提交之间成员未变。 */
  readonly memberDigest: string;
  readonly applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1;
  readonly scoringRuleMembers: readonly AssessmentBasisReleaseSetMemberV1[];
  readonly configurationMembers: readonly AssessmentBasisConfigurationMemberV1[];
  readonly applicableRuleSet: ApplicableRuleSetDocumentV1;
  readonly rules: readonly {
    readonly member: AssessmentBasisReleaseSetMemberV1;
    readonly document: StructuredScoringRuleDocumentV1;
  }[];
  readonly configuration: AssessmentConfigurationV1;
}

export interface PostgresRiskAssessmentEngineOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C11 实现的评估准备上下文窄读。 */
  readonly preparationContext: AssessmentPreparationContextReaderV1;
  /** C24/C11 实现的风险输入事实窄读。 */
  readonly riskInputFacts: RiskInputFactsReaderV1;
  /** C19 实现的评估依据成员窄读。 */
  readonly basisReader: AssessmentBasisReleaseSetReaderV1;
  /** C14 快照查询与序列修订读取。 */
  readonly monitoring: AssessmentMonitoringReaderV1;
  /** 下游读取授权签发接缝：组合根按精确 branch 签发，绑定不符时关闭失败。 */
  readonly authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  // ---- C34 风险评估只读（design D-04）----
  /** C11 实现的评估启动输入候选窄读：适用性快照与外部事件两个目录。 */
  readonly entryContext: AssessmentEntryContextReadPortV1;
  readonly configuration?: Pick<PostgresAssessmentConfigurationAdapter, "readConfigurationMembers">;
  /** C30 实现的运行投影窄读：按精确运行引用返回已登记的阶段与结果引用。 */
  readonly runRead: AssessmentRunReadPortV1;
  /** C30 实现的入口元数据窄读：重评前驱、原因与变化引用只来自已登记入口事实。 */
  readonly entriesRead: AssessmentEntriesReadPortV1;
  /** C33 实现的识别只读：待评估目录的风险记录候选由其自有接缝提供。 */
  readonly recordCatalog: RiskIdentificationReadPortV1;
  /**
   * 部署组合根显式注入的精确运行策略（design D-04）。缺省即「无可用部署配置」，
   * 不替用户补默认引用，也不从任何已登记事实反推。
   */
  readonly entryRunPolicy?:
    | {
        readonly graphVersion: VersionReference;
        readonly retryPolicyRef: VersionReference;
      }
    | undefined;
  readonly now?: () => Date;
}

/**
 * C25 正式用例 adapter：`prepare` 全量物化 22 引用输入快照，`evaluate` 只消费冻结输入，
 * 并在单事务内保存取值集、决策链接、正式记录、审计、回执与 `assessment.recorded.v1`。
 */
export class PostgresRiskAssessmentEngine
  implements
    RiskAssessmentPortV1,
    AssessmentInputSnapshotReaderV1,
    ActualAssessmentProofPortV1,
    ForecastRiskStatePortV1,
    RiskAssessmentReadPortV1
{
  readonly #db: Kysely<RiskAssessmentDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #preparationContext: AssessmentPreparationContextReaderV1;
  readonly #riskInputFacts: RiskInputFactsReaderV1;
  readonly #basisReader: AssessmentBasisReleaseSetReaderV1;
  readonly #monitoring: AssessmentMonitoringReaderV1;
  readonly #authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  readonly #entryContext: AssessmentEntryContextReadPortV1;
  readonly #configuration: PostgresRiskAssessmentEngineOptionsV1["configuration"];
  readonly #runRead: AssessmentRunReadPortV1;
  readonly #entriesRead: AssessmentEntriesReadPortV1;
  readonly #recordCatalog: RiskIdentificationReadPortV1;
  readonly #entryRunPolicy: PostgresRiskAssessmentEngineOptionsV1["entryRunPolicy"];
  readonly #now: () => Date;

  constructor(options: PostgresRiskAssessmentEngineOptionsV1) {
    this.#db = options.db as unknown as Kysely<RiskAssessmentDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#preparationContext = options.preparationContext;
    this.#riskInputFacts = options.riskInputFacts;
    this.#basisReader = options.basisReader;
    this.#monitoring = options.monitoring;
    this.#authorizeDownstream = options.authorizeDownstream;
    this.#entryContext = options.entryContext;
    this.#configuration = options.configuration;
    this.#runRead = options.runRead;
    this.#entriesRead = options.entriesRead;
    this.#recordCatalog = options.recordCatalog;
    this.#entryRunPolicy = options.entryRunPolicy;
    this.#now = options.now ?? (() => new Date());
  }

  async readInputSnapshot(
    input: Parameters<AssessmentInputSnapshotReaderV1["readInputSnapshot"]>[0],
  ): ReturnType<AssessmentInputSnapshotReaderV1["readInputSnapshot"]> {
    const snapshotRef = AssessmentInputSnapshotRefV1Schema.safeParse(input.inputSnapshotRef);
    const targetRef = KnowledgeReleaseRefV1Schema.safeParse(input.targetReleaseRef);
    if (!snapshotRef.success || !targetRef.success) {
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", input.requestId) };
    }
    try {
      const command = {
        commandId: input.requestId,
        projectId: input.projectId,
        actorId: input.actorId,
        authorization: input.authorization,
      };
      await this.#verifyCommand(command, "risk-assessment.read-input-snapshot");
      const row = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .select(["preparation_snapshot_ref", "basis_release_set_ref", "snapshot_payload"])
        .where("project_id", "=", input.projectId)
        .where("input_snapshot_id", "=", snapshotRef.data.reference.entityId)
        .where("version_id", "=", snapshotRef.data.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) {
        throw moduleError("AUTHORIZATION_DENIED", input.requestId);
      }
      const snapshot = AssessmentInputSnapshotSchema.parse(row.snapshot_payload);
      const basisRef = this.#parseBasisRef(row.basis_release_set_ref, input.requestId);
      if (
        refKey(snapshot.preparationSnapshotRef) !==
        refKey(AssessmentPreparationSnapshotRefV1Schema.parse(row.preparation_snapshot_ref))
      ) {
        throw moduleError("TERMINAL_FAILURE", input.requestId);
      }
      const declared = await this.#declaredPreparation(
        input.projectId,
        input.requestId,
        snapshot.preparationSnapshotRef,
      );
      await this.#verifyCommand(command, "risk-assessment.read-input-snapshot", {
        spatialScopeRefs: [declared.spatialScopeRef],
        sourceVersionRefs: declared.sourceVersionRefs,
      });
      const preparation = (
        await this.#loadPreparationContext(
          {
            commandId: input.requestId,
            projectId: input.projectId,
            actorId: input.actorId,
            issuedAt: input.requestedAt,
          },
          snapshot.preparationSnapshotRef,
        )
      ).preparation;
      if (refKey(preparation.spatialScopeRef) !== refKey(declared.spatialScopeRef)) {
        throw moduleError("TERMINAL_FAILURE", input.requestId);
      }
      const basisAuthorization = await this.#authorizeFor(
        {
          branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers,
          invocationId: `${input.requestId}:basis`,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          requestedSpatialScopeRefs: [preparation.spatialScopeRef],
        },
        "risk-assessment.read",
      );
      const basis = AssessmentBasisReleaseSetReadResultV1Schema.parse(
        await this.#basisReader.readAssessmentBasisReleaseSet({
          requestId: `${input.requestId}:basis`,
          idempotencyKey: `${input.requestId}:basis`,
          requestedAt: input.requestedAt,
          authorization: basisAuthorization,
          assessmentBasisReleaseSetRef: basisRef,
        }),
      );
      if (
        basis.kind !== "succeeded" ||
        refKey(basis.assessmentBasisReleaseSetRef) !== refKey(basisRef)
      ) {
        throw moduleError("AUTHORIZATION_DENIED", input.requestId);
      }
      const matching = [
        ...basis.configurationMembers,
        ...basis.scoringRuleMembers.map((member) => ({
          ...member,
          definitionType: "structured-scoring-rule",
        })),
      ].filter((member) => refKey(member.releaseRef) === refKey(targetRef.data));
      if (matching.length !== 1) {
        throw moduleError("STALE_VERSION", input.requestId, { targetRef: targetRef.data });
      }
      const member = matching[0]!;
      const snapshotField = {
        "weight-set": "weightSetRef",
        "risk-matrix": "riskMatrixRef",
        "risk-acceptance-threshold": "riskAcceptanceThresholdRef",
        "monitoring-warning-threshold": "monitoringWarningThresholdRef",
      } as const;
      const field = snapshotField[member.definitionType as keyof typeof snapshotField];
      if (
        field !== undefined &&
        versionKey(snapshot[field]) !== versionKey(targetRef.data.reference)
      ) {
        throw moduleError("STALE_VERSION", input.requestId, { targetRef: targetRef.data });
      }
      if (field === undefined && member.definitionType !== "structured-scoring-rule") {
        throw moduleError("STALE_VERSION", input.requestId, { targetRef: targetRef.data });
      }
      return {
        kind: "succeeded",
        projectId: input.projectId,
        spatialScopeRef: preparation.spatialScopeRef,
        basisReleaseSetRef: basisRef,
        targetReleaseRef: targetRef.data,
        targetContentDigest: member.contentDigest,
      };
    } catch (error: unknown) {
      return { kind: "failed", error: failureToModuleError(error, input.requestId) };
    }
  }

  /**
   * C25 加法式只读证明：只按精确评估记录引用返回最小投影，供 C41 反馈组合逐项对账。
   * 披露前复验当前主体、工程、空间与资料范围；缺失与越权同型失败，正文或索引不一致以
   * 终止失败闭合。不重算评估、不返回正文/列表，也不写任何事实。
   */
  async verifyActualAssessment(
    query: ActualAssessmentProofQueryV1,
  ): Promise<ActualAssessmentProofResultV1> {
    const parsed = ActualAssessmentProofQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      const candidate = query as { readonly queryId?: unknown } | undefined;
      return {
        kind: "failed",
        error: moduleError(
          "UNSUPPORTED_CONTRACT",
          typeof candidate?.queryId === "string" ? candidate.queryId : "",
        ),
      };
    }
    const valid = parsed.data;
    const queryId = valid.queryId;
    const command = {
      commandId: queryId,
      projectId: valid.projectId,
      actorId: valid.actorId,
      authorization: valid.authorization,
    };
    try {
      await this.#verifyCommand(command, "risk-assessment.read-input-snapshot");
      const row = await this.#readRecordRow(valid.projectId, valid.payload.riskAssessmentRecordRef);
      if (row === undefined) {
        // 缺失与越权同型失败：不枚举目标是否存在。
        throw moduleError("AUTHORIZATION_DENIED", queryId);
      }
      // 完整性核对：正文摘要、索引身份与公共记录 Schema 必须互证，任一处不符即终止失败。
      const record = RiskAssessmentRecordSchema.safeParse(row.record_payload);
      if (!record.success || row.content_digest !== sha256CanonicalJson(row.record_payload)) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      const payload = record.data;
      const standardized = payload.kind === "standardized-risk-record";
      const riskInputEntityId = standardized ? payload.riskRecordId : payload.externalRiskEventId;
      if (
        row.record_id !== payload.assessmentRecordId ||
        row.risk_input_kind !== payload.kind ||
        (standardized ? row.risk_record_id : row.external_risk_event_id) !== riskInputEntityId ||
        (standardized ? row.external_risk_event_id : row.risk_record_id) !== null
      ) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      const inputSnapshotRow = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .select(["preparation_snapshot_ref", "basis_release_set_ref", "snapshot_payload"])
        .where("project_id", "=", valid.projectId)
        .where("input_snapshot_id", "=", row.input_snapshot_id)
        .where("version_id", "=", row.input_snapshot_version_id)
        .executeTakeFirst();
      const indexedSnapshotRef = AssessmentInputSnapshotRefV1Schema.safeParse(
        row.input_snapshot_ref,
      );
      const inputSnapshot = AssessmentInputSnapshotSchema.safeParse(
        inputSnapshotRow?.snapshot_payload,
      );
      if (
        inputSnapshotRow === undefined ||
        !indexedSnapshotRef.success ||
        indexedSnapshotRef.data.reference.entityId !== row.input_snapshot_id ||
        indexedSnapshotRef.data.reference.versionId !== row.input_snapshot_version_id ||
        !inputSnapshot.success
      ) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      const inputSnapshotValue = inputSnapshot.data;
      const rowPreparationRef = AssessmentPreparationSnapshotRefV1Schema.safeParse(
        inputSnapshotRow.preparation_snapshot_ref,
      );
      if (
        !rowPreparationRef.success ||
        refKey(rowPreparationRef.data) !== refKey(inputSnapshotValue.preparationSnapshotRef)
      ) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      const basisRef = this.#parseBasisRef(inputSnapshotRow.basis_release_set_ref, queryId);
      const preparationRow = await this.#db
        .selectFrom("business.assessment_preparation_snapshots")
        .select(["snapshot_payload"])
        .where("project_id", "=", valid.projectId)
        .where("snapshot_id", "=", inputSnapshotValue.preparationSnapshotRef.reference.entityId)
        .where("version_id", "=", inputSnapshotValue.preparationSnapshotRef.reference.versionId)
        .executeTakeFirst();
      const preparation = AssessmentPreparationSnapshotV1Schema.safeParse(
        preparationRow?.snapshot_payload,
      );
      if (preparationRow === undefined || !preparation.success) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      const preparationValue = preparation.data;
      if (
        preparationValue.riskInput.kind !== payload.kind ||
        preparationValue.riskInput.reference.entityId !== riskInputEntityId
      ) {
        throw moduleError("TERMINAL_FAILURE", queryId);
      }
      // 披露前按记录冻结的空间与来源复验：跨工程或跨空间一律拒绝。
      const declared = declaredPreparationRefs(preparationValue);
      const verified = await this.#verifyCommand(command, "risk-assessment.read-input-snapshot", {
        spatialScopeRefs: [declared.spatialScopeRef],
        sourceVersionRefs: declared.sourceVersionRefs,
      });
      return {
        kind: "succeeded",
        result: {
          kind: "established",
          projectId: valid.projectId,
          riskAssessmentRecordRef: valid.payload.riskAssessmentRecordRef,
          riskInputRef: preparationValue.riskInput,
          spatialScopeRef: preparationValue.spatialScopeRef,
          assessmentInputSnapshotRef: {
            kind: "assessment-input-snapshot",
            reference: {
              entityId: row.input_snapshot_id,
              versionId: row.input_snapshot_version_id,
            },
          },
          assessmentBasisReleaseSetRef: basisRef,
          monitoringSnapshotRefs: [...(preparationValue.monitoringSnapshotRefs ?? [])],
          ...(inputSnapshotValue.schemaVersion === "1"
            ? {
                deviationPolicyRef: inputSnapshotValue.deviationPolicyRef,
                calibrationAgentPolicyRef: inputSnapshotValue.calibrationAgentPolicyRef,
              }
            : {}),
          assessmentRunRef: this.#assessmentRunRef(verified, preparationValue, queryId),
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: row.audit_entry_id, versionId: "1" },
          },
          recordedAt: asIso(row.recorded_at),
        },
      } satisfies ActualAssessmentProofResultV1;
    } catch (error: unknown) {
      return { kind: "failed", error: failureToModuleError(error, queryId) };
    }
  }

  // ------------------------------------------------------------- authorization

  async #verifyCommand(
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    },
    branch: ModuleBranchV1,
    requested?: {
      readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
    },
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(capability)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", command.commandId, {}, capability);
    }
    const decision = await this.#access.verify({
      authorizationContextRef: command.authorization.authorizationContextRef,
      invocationId: command.commandId,
      projectId: command.projectId,
      branch,
      requestedSpatialScopeRefs: [...(requested?.spatialScopeRefs ?? [])],
      requestedSourceVersionRefs: [...(requested?.sourceVersionRefs ?? [])],
      requestedAt: command.authorization.decidedAt,
    });
    if (decision.context.actorId !== command.actorId) {
      throw moduleError("AUTHORIZATION_DENIED", command.commandId, {}, capability);
    }
    return decision.context;
  }

  /**
   * 准备快照的空间身份必须落在当前授权上下文内：C06 只认访问空间修订，
   * 因此按 scope 身份把准备快照映射到已验证上下文自己的空间引用与来源版本上复验。
   */
  #preparationBinding(
    causalRunId: string,
    verified: AuthorizationContextV1,
    preparation: AssessmentPreparationSnapshotV1,
  ): {
    readonly spatialScopeRefs: SpatialScopeRefV1[];
    readonly sourceVersionRefs: SourceVersionRefV1[];
  } {
    const preparationScopeId = preparation.spatialScopeRef.reference.entityId;
    const spatialScopeRefs = verified.spatialScopeRefs.filter(
      (scope) => scope.reference.entityId === preparationScopeId,
    );
    if (spatialScopeRefs.length === 0) {
      throw moduleError("AUTHORIZATION_DENIED", causalRunId);
    }
    const sourceVersionRefs = [
      ...new Map(
        preparation.sourceEvidenceReferences.map((evidence) => [
          versionKey(evidence.sourceVersion),
          { kind: "source-version" as const, reference: evidence.sourceVersion },
        ]),
      ).values(),
    ].sort((left, right) => (versionKey(left.reference) < versionKey(right.reference) ? -1 : 1));
    return { spatialScopeRefs, sourceVersionRefs };
  }

  async #authorizeFor(
    input: AssessmentDownstreamAuthorizationRequestV1,
    requiredCapability: ModuleCapabilityV1,
  ): Promise<AuthorizationContextV1> {
    const context = await this.#authorizeDownstream(input);
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.invocationId, {}, requiredCapability);
    }
    return context;
  }

  #atomicCommand(
    command: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    commandKind: string,
    payload: object,
    runRef?: { readonly reference: VersionReference },
  ): AtomicCommandV1 {
    return {
      projectId: command.projectId,
      commandKind,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, never>,
      actorRef: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      issuedAt: command.issuedAt,
      ...(runRef === undefined ? {} : { runId: runRef.reference.entityId }),
    };
  }

  // ------------------------------------------------------------------ loaders

  async #loadPreparationContext(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
    },
    preparationSnapshotRef: AssessmentInputSnapshot["preparationSnapshotRef"],
  ): Promise<PreparationContextV1> {
    // 先按 C25 自有表读出准备快照的空间与来源清单，据此签发带来源的下游授权；
    // 快照本身仍只以 C11 窄读（在授权内按空间与来源双重复验）返回的事实为准。
    const declared = await this.#declaredPreparation(
      input.projectId,
      input.commandId,
      preparationSnapshotRef,
    );
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.preparationContext,
        invocationId: `${input.commandId}:preparation`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        requestedSpatialScopeRefs: [declared.spatialScopeRef],
        requestedSourceVersionRefs: declared.sourceVersionRefs,
      },
      "risk-assessment.read",
    );
    const read = await this.#preparationContext.readAssessmentPreparationContext({
      requestId: `${input.commandId}:preparation`,
      idempotencyKey: `${input.commandId}:preparation`,
      requestedAt: input.issuedAt,
      authorization,
      preparationSnapshotRef,
    });
    if (read.kind === "failed") throw read.error;
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "assessment-preparation-unavailable",
        blockerRef: preparationSnapshotRef,
      });
    }
    const preparation = AssessmentPreparationSnapshotV1Schema.parse(read.preparation);
    // 授权按声明清单签发，事实必须与之逐项一致，否则关闭失败。
    const verifiedSourceRefs = [
      ...new Map(
        preparation.sourceEvidenceReferences.map((evidence) => [
          versionKey(evidence.sourceVersion),
          evidence.sourceVersion,
        ]),
      ).values(),
    ];
    if (
      preparation.spatialScopeRef.reference.entityId !==
        declared.spatialScopeRef.reference.entityId ||
      verifiedSourceRefs.length !== declared.sourceVersionRefs.length ||
      verifiedSourceRefs.some(
        (reference) =>
          !declared.sourceVersionRefs.some(
            (item) => versionKey(item.reference) === versionKey(reference),
          ),
      )
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    return {
      kind: "succeeded",
      preparation,
      applicability: read.applicability,
    };
  }

  /**
   * 准备快照的授权清单：空间引用与证据资料版本取自 C25 自有只追加表，
   * 用于向下游接缝声明将要读取的范围；缺失即视为准备快照不可用。
   */
  async #declaredPreparation(
    projectId: string,
    causalRunId: string,
    preparationSnapshotRef: AssessmentInputSnapshot["preparationSnapshotRef"],
  ): Promise<{
    readonly spatialScopeRef: SpatialScopeRefV1;
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }> {
    const row = await this.#db
      .selectFrom("business.assessment_preparation_snapshots")
      .select(["snapshot_payload"])
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", preparationSnapshotRef.reference.entityId)
      .where("version_id", "=", preparationSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      throw moduleError("BUSINESS_BLOCKED", causalRunId, {
        blockerKind: "assessment-preparation-unavailable",
        blockerRef: preparationSnapshotRef,
      });
    }
    const preparation = AssessmentPreparationSnapshotV1Schema.parse(row.snapshot_payload);
    return declaredPreparationRefs(preparation);
  }

  async #loadRiskFacts(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly riskInput: AssessmentPreparationSnapshotV1["riskInput"];
    /**
     * 已由 `#verifyCommand` 复验的准备绑定：事实读取授权只能按这里的精确空间与来源范围签发，
     * 既不从自由请求、风险标识或最新资料推断，也不扩大调用方已获准范围。
     */
    readonly binding: {
      readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    };
  }): Promise<RiskInputFactsV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts,
        invocationId: `${input.commandId}:risk-input-facts`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        requestedSpatialScopeRefs: input.binding.spatialScopeRefs,
        requestedSourceVersionRefs: input.binding.sourceVersionRefs,
      },
      "risk-assessment.read",
    );
    // 下游签发接缝不得返回超出已复验绑定的空间；绑定带来源时也不得返回无来源授权，
    // 否则风险事实读取会在收窄阶段被拒，这里提前按授权失败收口。
    const bindingScopeIds = new Set(
      input.binding.spatialScopeRefs.map((scope) => scope.reference.entityId),
    );
    if (
      authorization.spatialScopeRefs.length === 0 ||
      authorization.spatialScopeRefs.some(
        (scope) => !bindingScopeIds.has(scope.reference.entityId),
      ) ||
      (input.binding.sourceVersionRefs.length > 0 &&
        authorization.sourceAccessGrantRefs.length === 0)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    const read = await this.#riskInputFacts.readRiskInputFacts({
      requestId: `${input.commandId}:risk-input-facts`,
      idempotencyKey: `${input.commandId}:risk-input-facts`,
      requestedAt: input.issuedAt,
      authorization,
      riskInput: input.riskInput,
    });
    if (read.kind === "failed") throw read.error;
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-input-facts-unavailable",
        blockerRef: input.riskInput,
      });
    }
    const facts = RiskInputFactsV1Schema.parse(read.facts);
    if (
      facts.projectId !== input.projectId ||
      refKey(facts.riskInput) !== refKey(input.riskInput)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    return facts;
  }

  async #loadBasis(input: {
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly actorId: string;
    /** 业务有效时点：历史回填用 effectiveAt，其余用命令 issuedAt。 */
    readonly businessAt: string;
    readonly requiredCapability: ModuleCapabilityV1;
    readonly basisRef: BasisRefV1;
  }): Promise<LoadedBasisV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers,
        invocationId: `${input.commandId}:basis`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.businessAt,
      },
      input.requiredCapability,
    );
    const read = AssessmentBasisReleaseSetReadResultV1Schema.parse(
      await this.#basisReader.readAssessmentBasisReleaseSet({
        requestId: `${input.commandId}:basis`,
        idempotencyKey: `${input.idempotencyKey}:basis`,
        requestedAt: input.businessAt,
        authorization,
        assessmentBasisReleaseSetRef: input.basisRef,
      }),
    );
    if (read.kind === "unavailable") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-basis-unavailable",
        blockerRef: input.basisRef,
      });
    }
    if (read.kind === "failed") {
      throw moduleError(
        read.error.code === "TRANSIENT_FAILURE" ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        input.commandId,
      );
    }
    const applicableRuleSet = await this.#readApplicableRuleSet(
      {
        commandId: input.commandId,
        projectId: input.projectId,
        actorId: input.actorId,
        businessAt: input.businessAt,
        authorization,
      },
      read.applicableRuleSetMember,
    );
    assertScoringRuleMembersMatchApplicableRuleSet({
      document: applicableRuleSet,
      scoringRuleMembers: read.scoringRuleMembers,
    });

    const rules: {
      member: AssessmentBasisReleaseSetMemberV1;
      document: StructuredScoringRuleDocumentV1;
    }[] = [];
    for (const member of read.scoringRuleMembers) {
      const document = await readStructuredScoringRuleDocument({
        artifactStore: this.#artifactStore,
        artifactRef: member.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestId: `${input.commandId}:rule:${member.releaseRef.reference.entityId}`,
        idempotencyKey: `${input.commandId}:rule:${member.releaseRef.reference.entityId}`,
        requestedAt: input.businessAt,
        requiredCapability: BASIS_READ_CAPABILITY,
        authorization,
      });
      if (
        document.contentDigest !== member.contentDigest ||
        versionKey(document.value.configurationSetRef) !==
          versionKey(applicableRuleSet.configurationSetRef) ||
        versionKey(document.value.compatibilityRef) !==
          versionKey(applicableRuleSet.compatibilityRef)
      ) {
        throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
      }
      rules.push({ member, document: document.value });
    }

    const documents = new Map<string, AssessmentConfigurationDocumentV1>();
    for (const member of read.configurationMembers) {
      documents.set(
        member.definitionType,
        await this.#readConfigurationDocument(input, authorization, member, applicableRuleSet),
      );
    }
    const content = <T extends string>(definitionType: T): unknown => {
      const document = documents.get(definitionType);
      if (document === undefined || document.definitionType !== definitionType) {
        throw moduleError("BUSINESS_BLOCKED", input.commandId, {
          blockerKind: "risk-assessment-configuration-incomplete",
          blockerRef: input.basisRef,
        });
      }
      return document.content;
    };
    const configuration: AssessmentConfigurationV1 = {
      indicatorSystem: content("indicator-system") as never,
      fieldMapping: content("indicator-field-mapping") as never,
      weightSet: content("weight-set") as never,
      scoringStrategy: content("scoring-strategy") as never,
      riskMatrix: content("risk-matrix") as never,
      riskAcceptanceThreshold: content("risk-acceptance-threshold") as never,
      monitoringWarningThreshold: content("monitoring-warning-threshold") as never,
      jointTriggerPolicy: content("joint-trigger-policy") as never,
    };

    return {
      memberDigest: read.memberDigest,
      applicableRuleSetMember: read.applicableRuleSetMember,
      scoringRuleMembers: read.scoringRuleMembers,
      configurationMembers: read.configurationMembers,
      applicableRuleSet,
      rules,
      configuration,
    };
  }

  async #readConfigurationDocument(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly businessAt: string;
    },
    authorization: AuthorizationContextV1,
    member: AssessmentBasisConfigurationMemberV1,
    applicableRuleSet: ApplicableRuleSetDocumentV1,
  ): Promise<AssessmentConfigurationDocumentV1> {
    const requestId = `${input.commandId}:configuration:${member.definitionType}`;
    const handle = await this.#artifactStore
      .open({
        schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
        requestId,
        idempotencyKey: requestId,
        artifactRef: member.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.businessAt,
        purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
        requiredCapability: BASIS_READ_CAPABILITY,
        authorization,
      })
      .catch((): never => {
        throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
      });
    const bytes = await readBounded(handle, member.releaseRef, input.commandId);
    const receipt = await handle.completed;
    if (
      receipt.content.hash.value !== handle.manifest.content.hash.value ||
      handle.manifest.mediaType !== ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1
    ) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    const parsed = AssessmentConfigurationDocumentV1Schema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.definitionType !== member.definitionType ||
      assessmentConfigurationDocumentDigest(parsed.data) !== member.contentDigest ||
      versionKey(parsed.data.configurationSetRef) !==
        versionKey(applicableRuleSet.configurationSetRef) ||
      refKey(parsed.data.projectRevisionRef) !== refKey(applicableRuleSet.projectRevisionRef)
    ) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    return parsed.data;
  }

  async #readApplicableRuleSet(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly businessAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    member: AssessmentBasisReleaseSetMemberV1,
  ): Promise<ApplicableRuleSetDocumentV1> {
    const read = await readApplicableRuleSetDocument({
      artifactStore: this.#artifactStore,
      artifactRef: member.artifactRef,
      projectId: input.projectId,
      actorId: input.actorId,
      requestId: `${input.commandId}:applicable-rule-set`,
      idempotencyKey: `${input.commandId}:applicable-rule-set`,
      requestedAt: input.businessAt,
      requiredCapability: BASIS_READ_CAPABILITY,
      authorization: input.authorization,
    });
    if (read.contentDigest !== member.contentDigest) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    return read.value;
  }

  async #loadMonitoring(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly monitoringSnapshotRefs: readonly {
      readonly kind: "monitoring-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
    /** 复验后的授权空间与来源引用：C06 只认访问空间修订。 */
    readonly binding: {
      readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    };
  }): Promise<readonly AssessmentMonitoringInputV1[]> {
    const inputs: AssessmentMonitoringInputV1[] = [];
    for (const monitoringRef of input.monitoringSnapshotRefs) {
      inputs.push(
        await this.#readMonitoringSnapshotRef({
          commandId: input.commandId,
          projectId: input.projectId,
          actorId: input.actorId,
          issuedAt: input.issuedAt,
          monitoringRef,
          binding: input.binding,
        }),
      );
    }
    return inputs;
  }

  /**
   * 精确读取一个监测快照及其序列修订（design D-08）。正式评估按准备快照登记的引用逐个读取，
   * 预测则读取请求声明的执行前快照：两者走同一条受权接缝，不另建监测读取路径。
   */
  async #readMonitoringSnapshotRef(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly monitoringRef: {
      readonly kind: "monitoring-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly binding: {
      readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    };
  }): Promise<AssessmentMonitoringInputV1> {
    const { monitoringRef } = input;
    // C06 verify 与本次调用 invocationId 绑定：快照查询与序列读取各签发一次。
    const invocationId = `${input.commandId}:monitoring-snapshot:${monitoringRef.reference.entityId}@${monitoringRef.reference.versionId}`;
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.monitoringReads,
        invocationId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        requestedSpatialScopeRefs: input.binding.spatialScopeRefs,
        requestedSourceVersionRefs: input.binding.sourceVersionRefs,
      },
      "risk-assessment.read",
    );
    const read = await this.#monitoring.readSnapshot({
      kind: "monitoring-snapshot",
      queryId: invocationId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.issuedAt,
      authorization,
      payload: { monitoringSnapshotRef: monitoringRef },
    });
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-monitoring-unavailable",
        blockerRef: monitoringRef,
      });
    }
    const resolved = await this.#monitoring.resolveSnapshotQuery({
      queryResultRef: read.result.queryResultRef,
      invocationId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.issuedAt,
      authorization,
    });
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "snapshot-query") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-monitoring-unavailable",
        blockerRef: monitoringRef,
      });
    }
    const snapshot = resolved.result.query.snapshot;
    if (snapshot.projectId !== input.projectId) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    const seriesQueryId = `${input.commandId}:monitoring-series:${snapshot.monitoringSeriesRef.reference.entityId}@${snapshot.monitoringSeriesRef.reference.versionId}`;
    const seriesAuthorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.monitoringReads,
        invocationId: seriesQueryId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        requestedSpatialScopeRefs: input.binding.spatialScopeRefs,
        requestedSourceVersionRefs: input.binding.sourceVersionRefs,
      },
      "risk-assessment.read",
    );
    const seriesRead = await this.#monitoring.readSeriesRevision({
      queryId: seriesQueryId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.issuedAt,
      authorization: seriesAuthorization,
      monitoringSeriesRef: snapshot.monitoringSeriesRef,
    });
    if (seriesRead.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-series-unavailable",
        blockerRef: snapshot.monitoringSeriesRef,
      });
    }
    if (
      refKey(seriesRead.result.monitoringSeriesRef) !== refKey(snapshot.monitoringSeriesRef) ||
      seriesRead.result.projectId !== input.projectId
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    return { snapshot, seriesRevision: seriesRead.result };
  }

  // ------------------------------------------------------- commit preconditions

  #basisFingerprint(basis: LoadedBasisV1): string {
    return sha256CanonicalJson({
      memberDigest: basis.memberDigest,
      applicable: {
        releaseRef: basis.applicableRuleSetMember.releaseRef,
        revisionRef: basis.applicableRuleSetMember.revisionRef,
        artifactRef: basis.applicableRuleSetMember.artifactRef,
        contentDigest: basis.applicableRuleSetMember.contentDigest,
        document: sha256CanonicalJson(basis.applicableRuleSet),
      },
      rules: basis.rules
        .map((entry) => ({
          releaseRef: entry.member.releaseRef,
          revisionRef: entry.member.revisionRef,
          artifactRef: entry.member.artifactRef,
          contentDigest: entry.member.contentDigest,
          document: sha256CanonicalJson(entry.document),
        }))
        .sort((left, right) =>
          versionKey(left.releaseRef.reference) < versionKey(right.releaseRef.reference) ? -1 : 1,
        ),
      configuration: basis.configurationMembers.map((member) => ({
        definitionType: member.definitionType,
        releaseRef: member.releaseRef,
        revisionRef: member.revisionRef,
        artifactRef: member.artifactRef,
        contentDigest: member.contentDigest,
      })),
    });
  }

  /**
   * 提交前复验（D-10）：C06 主体仍有效、C19 basis 成员与 C04 正文摘要未漂移、
   * 运行时策略版本仍等价；任一变化都关闭失败，不落库部分结果。
   */
  async #assertCommitPreconditions(input: {
    readonly command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    };
    readonly branch: ModuleBranchV1;
    readonly binding: {
      readonly spatialScopeRefs: SpatialScopeRefV1[];
      readonly sourceVersionRefs: SourceVersionRefV1[];
    };
    readonly businessAt: string;
    readonly requiredCapability: ModuleCapabilityV1;
    readonly basisRef: BasisRefV1;
    readonly preparationSnapshotRef: AssessmentInputSnapshot["preparationSnapshotRef"];
    readonly basis: LoadedBasisV1;
  }): Promise<void> {
    await this.#verifyCommand(input.command, input.branch, input.binding);
    // 复核是第二次独立读取，必须有自己的命令身份：C03 的 `command_receipts.command_id`
    // 全局唯一，沿用主命令身份会让复核撞唯一约束而永远走不通。
    const recheckCommandId = `${input.command.commandId}:recheck`;
    const basisAgain = await this.#loadBasis({
      commandId: recheckCommandId,
      idempotencyKey: `${input.command.commandId}:recheck`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      businessAt: input.businessAt,
      requiredCapability: input.requiredCapability,
      basisRef: input.basisRef,
    });
    if (this.#basisFingerprint(basisAgain) !== this.#basisFingerprint(input.basis)) {
      throw moduleError("STALE_VERSION", input.command.commandId, {
        targetRef: input.basis.applicableRuleSetMember.releaseRef,
      });
    }
  }

  // ------------------------------------------------------------------ context

  #inputSnapshotReferences(basis: LoadedBasisV1): AssessmentScoringReferences {
    const configurationRef = (definitionType: string): VersionReference => {
      const member = basis.configurationMembers.find(
        (candidate) => candidate.definitionType === definitionType,
      );
      if (member === undefined) {
        throw moduleError("BUSINESS_BLOCKED", "risk-assessment.input-snapshot", {
          blockerKind: "risk-assessment-configuration-incomplete",
        });
      }
      return member.releaseRef.reference;
    };
    return {
      indicatorSystemRef: configurationRef("indicator-system"),
      indicatorFieldMappingRef: configurationRef("indicator-field-mapping"),
      applicableRuleSetRef: basis.applicableRuleSetMember.releaseRef.reference,
      weightSetRef: configurationRef("weight-set"),
      scoringStrategyRef: configurationRef("scoring-strategy"),
      riskMatrixRef: configurationRef("risk-matrix"),
      riskAcceptanceThresholdRef: configurationRef("risk-acceptance-threshold"),
      monitoringWarningThresholdRef: configurationRef("monitoring-warning-threshold"),
      jointTriggerPolicyRef: configurationRef("joint-trigger-policy"),
    };
  }

  #engineContext(input: {
    readonly projectId: string;
    readonly preparation: AssessmentPreparationSnapshotV1;
    readonly preparationSnapshotRef: AssessmentInputSnapshot["preparationSnapshotRef"];
    readonly inputSnapshot: AssessmentInputSnapshot;
    readonly inputSnapshotRef: InputSnapshotRefV1;
    readonly basisRef: BasisRefV1;
    readonly applicability: ApplicabilityMetadataSnapshotV1;
    readonly basis: LoadedBasisV1;
    readonly facts: RiskInputFactsV1;
    readonly monitoring: readonly AssessmentMonitoringInputV1[];
  }): AssessmentEngineContextV1 {
    return {
      projectId: input.projectId,
      projectRevisionRef: input.preparation.projectRevisionRef,
      preparation: input.preparation,
      preparationSnapshotRef: input.preparationSnapshotRef,
      inputSnapshot: input.inputSnapshot,
      inputSnapshotRef: input.inputSnapshotRef,
      assessmentBasisReleaseSetRef: input.basisRef,
      applicabilitySnapshotRef: input.preparation.applicabilityMetadataSnapshotRef,
      applicability: input.applicability.applicabilityMetadata,
      basis: {
        applicableRuleSetMember: input.basis.applicableRuleSetMember,
        scoringRuleMembers: input.basis.scoringRuleMembers,
        configurationMembers: input.basis.configurationMembers,
      },
      configuration: input.basis.configuration,
      applicableRuleSet: input.basis.applicableRuleSet,
      rules: input.basis.rules,
      facts: input.facts,
      monitoring: input.monitoring,
    };
  }

  // ------------------------------------------------------------------ prepare

  async prepare(command: AssessmentPreparationCommandV1): Promise<AssessmentPreparationResultV1> {
    const parsed = AssessmentPreparationCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return AssessmentPreparationResultV1Schema.parse({
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "risk-assessment.prepare"),
      });
    }
    const valid = parsed.data;
    try {
      const branch = branchForCommandKind(valid.kind);
      await this.#verifyCommand(valid, branch);
      const preparationRead = await this.#loadPreparationContext(
        {
          commandId: valid.commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          issuedAt: valid.issuedAt,
        },
        valid.payload.preparationSnapshotRef,
      );
      const preparation = preparationRead.preparation;
      // 准备快照的空间与来源身份必须由当前授权复验后才继续（只使用验证后的上下文）。
      const binding = this.#preparationBinding(valid.commandId, valid.authorization, preparation);
      const verified = await this.#verifyCommand(valid, branch, binding);
      const basisRef = valid.payload.assessmentBasisReleaseSetRef;
      this.#assertEntryBranch(valid, preparation, valid.commandId);
      const businessAt =
        valid.kind === "historical-backfill" ? valid.payload.effectiveAt : valid.issuedAt;

      const basis = await this.#loadBasis({
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: verified.actorId,
        businessAt,
        requiredCapability: "risk-assessment.prepare",
        basisRef,
      });
      this.#assertBasisMatchesPreparation(valid.commandId, basis, preparation);

      const recordedAt = this.#now().toISOString();
      const auditEntryId = `audit-${valid.commandId}:assessment-input`;
      const inputSnapshot = AssessmentInputSnapshotV2Schema.parse({
        schemaVersion: "2",
        preparationSnapshotRef: valid.payload.preparationSnapshotRef,
        ...this.#inputSnapshotReferences(basis),
        authorizationContextRef: valid.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: auditEntryId, versionId: "1" },
        },
        createdBy: verified.actorId,
        createdAt: recordedAt,
      });
      const referenceDigest = sha256CanonicalJson({
        projectId: valid.projectId,
        ...withoutClock(inputSnapshot as unknown as Record<string, unknown>),
      });
      const inputSnapshotRef: InputSnapshotRefV1 = {
        kind: "assessment-input-snapshot",
        reference: { entityId: `assessment-input-${referenceDigest}`, versionId: "1" },
      };

      // 重评变更判定需要读取前次记录与其准备快照；提交前复验必须紧邻持久化放在其后。
      const changeEvent =
        valid.kind === "reassessment"
          ? await this.#reassessmentChangeEvent(valid, preparation, inputSnapshot, inputSnapshotRef)
          : undefined;

      // 提交前复验：授权、C19 basis 成员与 C04 正文摘要、运行时策略版本仍等价。
      await this.#assertCommitPreconditions({
        command: valid,
        branch,
        binding,
        businessAt,
        requiredCapability: "risk-assessment.prepare",
        basisRef,
        preparationSnapshotRef: valid.payload.preparationSnapshotRef,
        basis,
      });

      await this.#transactionUnit.execute(
        this.#atomicCommand(valid, "risk-assessment.prepare-input-snapshot.v1", {
          inputSnapshotRef,
          referenceDigest,
          entryKind: valid.kind,
        }),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asRiskAssessmentTransaction(context);
          await transaction
            .insertInto("business.assessment_input_snapshots")
            .values({
              input_snapshot_id: inputSnapshotRef.reference.entityId,
              version_id: inputSnapshotRef.reference.versionId,
              schema_version: inputSnapshot.schemaVersion,
              project_id: valid.projectId,
              command_id: valid.commandId,
              idempotency_key: valid.idempotencyKey,
              payload_hash: referenceDigest,
              preparation_snapshot_ref: jsonValue(inputSnapshot.preparationSnapshotRef),
              preparation_snapshot_id: inputSnapshot.preparationSnapshotRef.reference.entityId,
              preparation_snapshot_version_id:
                inputSnapshot.preparationSnapshotRef.reference.versionId,
              basis_release_set_ref: jsonValue(basisRef),
              basis_release_set_id: basisRef.reference.entityId,
              basis_release_set_version_id: basisRef.reference.versionId,
              previous_assessment_record_ref:
                valid.kind === "reassessment"
                  ? jsonValue(valid.payload.previousAssessmentRecordRef)
                  : null,
              entry_kind: valid.kind,
              effective_at: valid.kind === "historical-backfill" ? valid.payload.effectiveAt : null,
              reference_digest: referenceDigest,
              snapshot_payload: jsonValue(inputSnapshot),
              actor_ref: valid.actorId,
              authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
              audit_entry_id: auditEntryId,
              occurred_at: valid.issuedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) =>
              conflict.columns(["input_snapshot_id", "version_id"]).doNothing(),
            )
            .execute();
          return {
            resultRef: inputSnapshotRef,
            audit: {
              auditEntryId,
              projectId: valid.projectId,
              action: "risk-assessment.prepare-input-snapshot",
              targetRef: inputSnapshotRef,
              actorRef: valid.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.issuedAt,
              recordedAt,
              version: inputSnapshotRef.reference,
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
            },
            events: changeEvent === undefined ? [] : [changeEvent],
          } satisfies AtomicCommitV1;
        },
        { isolationLevel: "repeatable read" },
      );

      return AssessmentPreparationResultV1Schema.parse({
        kind: "succeeded",
        result: { assessmentInputSnapshotRef: inputSnapshotRef },
      });
    } catch (error) {
      return AssessmentPreparationResultV1Schema.parse({
        kind: "failed",
        error: failureToModuleError(error, valid.commandId),
      });
    }
  }

  #assertEntryBranch(
    command: AssessmentPreparationCommandV1,
    preparation: AssessmentPreparationSnapshotV1,
    causalRunId: string,
  ): void {
    if (command.kind === "initial") {
      if (preparation.entryMode !== "assess" && preparation.entryMode !== "identify-and-assess") {
        throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
      }
      return;
    }
    if (command.kind === "reassessment") {
      if (preparation.entryMode !== "reassess") {
        throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
      }
      const previous = preparation.previousAssessmentRecordRef;
      if (
        previous === undefined ||
        refKey(previous) !== refKey(command.payload.previousAssessmentRecordRef)
      ) {
        throw moduleError("STALE_VERSION", causalRunId, {
          targetRef: command.payload.previousAssessmentRecordRef,
        });
      }
      return;
    }
    if (preparation.entryMode !== "historical-backfill") {
      throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
    }
  }

  #assertBasisMatchesPreparation(
    causalRunId: string,
    basis: LoadedBasisV1,
    preparation: AssessmentPreparationSnapshotV1,
  ): void {
    if (
      refKey(basis.applicableRuleSet.applicabilitySnapshotRef) !==
        refKey(preparation.applicabilityMetadataSnapshotRef) ||
      refKey(basis.applicableRuleSet.projectRevisionRef) !== refKey(preparation.projectRevisionRef)
    ) {
      throw moduleError("STALE_VERSION", causalRunId, {
        targetRef: basis.applicableRuleSetMember.releaseRef,
      });
    }
  }

  async #reassessmentChangeEvent(
    command: Extract<AssessmentPreparationCommandV1, { kind: "reassessment" }>,
    preparation: AssessmentPreparationSnapshotV1,
    next: AssessmentInputSnapshot,
    nextRef: InputSnapshotRefV1,
  ): Promise<DomainEventV1 | undefined> {
    const previousRow = await this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("record_id", "=", command.payload.previousAssessmentRecordRef.reference.entityId)
      .where("version_id", "=", command.payload.previousAssessmentRecordRef.reference.versionId)
      .executeTakeFirst();
    if (previousRow === undefined) {
      throw moduleError("AUTHORIZATION_DENIED", command.commandId);
    }
    const previousInputRow = await this.#db
      .selectFrom("business.assessment_input_snapshots")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("input_snapshot_id", "=", previousRow.input_snapshot_id)
      .where("version_id", "=", previousRow.input_snapshot_version_id)
      .executeTakeFirst();
    if (previousInputRow === undefined) {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    const previousInput = AssessmentInputSnapshotSchema.parse(previousInputRow.snapshot_payload);
    const previousPreparation = (
      await this.#loadPreparationContext(
        {
          commandId: `${command.commandId}:previous`,
          projectId: command.projectId,
          actorId: command.actorId,
          issuedAt: command.issuedAt,
        },
        previousInput.preparationSnapshotRef,
      )
    ).preparation;

    const notObserved = (): never => {
      throw moduleError("BUSINESS_BLOCKED", command.commandId, {
        blockerKind: "risk-assessment-change-not-observed",
        blockerRef: nextRef,
      });
    };
    const event = (
      reasonCode: string,
      change:
        | {
            readonly kind: "monitoring-snapshot";
            readonly previousMonitoringSnapshotRefs?: readonly unknown[];
            readonly newMonitoringSnapshotRefs?: readonly unknown[];
          }
        | {
            readonly kind: "applicability-metadata";
            readonly previousApplicabilityMetadataSnapshotRef: unknown;
            readonly newApplicabilityMetadataSnapshotRef: unknown;
          },
    ): DomainEventV1 =>
      DomainEventV1Schema.parse({
        schemaVersion: "1",
        eventId: `assessment-input-changed-${sha256CanonicalJson({
          projectId: command.projectId,
          previousRecord: command.payload.previousAssessmentRecordRef,
          nextRef,
        })}`,
        eventVersion: 1,
        eventType: "engineering.assessment-input-changed.v1",
        projectId: command.projectId,
        aggregateRef: nextRef,
        occurredAt: command.issuedAt,
        recordedAt: this.#now().toISOString(),
        causationId: command.commandId,
        correlationId: `assessment-input-changed-${nextRef.reference.entityId}`,
        producerCommandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        authorizationContextRef: command.authorization.authorizationContextRef,
        auditTrailRef: next.auditTrailRef,
        payload: { change, reasonCode },
      });

    if (command.payload.reason === "monitoring-snapshot") {
      const previousRefs = previousPreparation.monitoringSnapshotRefs ?? [];
      const currentRefs = preparation.monitoringSnapshotRefs ?? [];
      const previousKeys = new Set(previousRefs.map((ref) => refKey(ref)));
      const currentKeys = new Set(currentRefs.map((ref) => refKey(ref)));
      // 事件表达的是变化本身：纯新增只给新侧、纯删除只给前侧、替换同时给两侧，空侧省略。
      const removed = previousRefs.filter((ref) => !currentKeys.has(refKey(ref)));
      const added = currentRefs.filter((ref) => !previousKeys.has(refKey(ref)));
      if (removed.length === 0 && added.length === 0) throw notObserved();
      return event("monitoring-snapshot", {
        kind: "monitoring-snapshot",
        ...(removed.length === 0 ? {} : { previousMonitoringSnapshotRefs: removed }),
        ...(added.length === 0 ? {} : { newMonitoringSnapshotRefs: added }),
      });
    }
    if (command.payload.reason === "applicability-metadata") {
      const previousRef = previousPreparation.applicabilityMetadataSnapshotRef;
      const currentRef = preparation.applicabilityMetadataSnapshotRef;
      if (refKey(previousRef) === refKey(currentRef)) throw notObserved();
      return event("applicability-metadata", {
        kind: "applicability-metadata",
        previousApplicabilityMetadataSnapshotRef: previousRef,
        newApplicabilityMetadataSnapshotRef: currentRef,
      });
    }
    // 规则集与矩阵是单一引用；weight-or-strategy 必须同时比较权重与评分策略版本。
    const fields =
      command.payload.reason === "applicable-rule-set"
        ? (["applicableRuleSetRef"] as const)
        : command.payload.reason === "risk-matrix"
          ? (["riskMatrixRef"] as const)
          : (["weightSetRef", "scoringStrategyRef"] as const);
    const changed = fields.some(
      (field) => versionKey(previousInput[field]) !== versionKey(next[field]),
    );
    if (!changed) throw notObserved();
    return undefined;
  }

  // ----------------------------------------------------------------- evaluate

  async evaluate(command: AssessmentEvaluationCommandV1): Promise<AssessmentEvaluationResultV1> {
    const parsed = AssessmentEvaluationCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return AssessmentEvaluationResultV1Schema.parse({
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "risk-assessment.evaluate"),
      });
    }
    const valid = parsed.data;
    try {
      await this.#verifyCommand(valid, "risk-assessment.evaluate");
      const inputSnapshotRef = valid.payload.assessmentInputSnapshotRef;
      const inputRow = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("input_snapshot_id", "=", inputSnapshotRef.reference.entityId)
        .where("version_id", "=", inputSnapshotRef.reference.versionId)
        .executeTakeFirst();
      if (inputRow === undefined) {
        return AssessmentEvaluationResultV1Schema.parse({
          kind: "failed",
          error: moduleError(
            "AUTHORIZATION_DENIED",
            valid.commandId,
            {},
            "risk-assessment.evaluate",
          ),
        });
      }
      const inputSnapshot = AssessmentInputSnapshotSchema.parse(inputRow.snapshot_payload);
      const basisRef = this.#parseBasisRef(inputRow.basis_release_set_ref, valid.commandId);
      const preparationRead = await this.#loadPreparationContext(
        {
          commandId: valid.commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          issuedAt: valid.issuedAt,
        },
        inputSnapshot.preparationSnapshotRef,
      );
      const preparation = preparationRead.preparation;
      /**
       * 准备快照的空间与来源身份由当前授权复验后才继续；之后只用验证后的上下文。
       *
       * 收窄的证明与评估上下文必须分开取得：评估要写出的决策工件以依据成员为父工件，
       * 而依据成员的来源授权宽于准备快照的证据来源（C19 规则编制来自 C15 清洗结果）。
       * 若把准备身份当作收窄请求交给 C06，得到的上下文装不下父工件的来源授权，C04
       * 会在 `ARTIFACT_ACCESS_DENIED` 处关闭失败。因此这里按准备身份单独窄签一次作为
       * 「可授予」证明，再取不收窄的评估上下文（上限仍是调用方按 branch 签发的那份），
       * 并断言前者落在后者之内——与本文件读取路径的既有包含检查同一口径。
       */
      const binding = this.#preparationBinding(valid.commandId, valid.authorization, preparation);
      const preparationScoped = await this.#verifyCommand(
        valid,
        "risk-assessment.evaluate",
        binding,
      );
      const verified = await this.#verifyCommand(valid, "risk-assessment.evaluate");
      if (
        !preparationScoped.spatialScopeRefs.every((ref) =>
          verified.spatialScopeRefs.some(
            (scope) => versionKey(scope.reference) === versionKey(ref.reference),
          ),
        ) ||
        !preparationScoped.sourceAccessGrantRefs.every(
          (ref) =>
            ref.kind === "source-access-grant" &&
            verified.sourceAccessGrantRefs.some(
              (grant) =>
                grant.kind === "source-access-grant" &&
                versionKey(grant.reference) === versionKey(ref.reference),
            ),
        )
      ) {
        throw moduleError("AUTHORIZATION_DENIED", valid.commandId, {}, "risk-assessment.evaluate");
      }
      const runRef = this.#assessmentRunRef(verified, preparation, valid.commandId);
      const businessAt =
        inputRow.entry_kind === "historical-backfill" && inputRow.effective_at !== null
          ? asIso(inputRow.effective_at)
          : valid.issuedAt;
      const facts = await this.#loadRiskFacts({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: verified.actorId,
        issuedAt: valid.issuedAt,
        riskInput: preparation.riskInput,
        binding,
      });
      const basis = await this.#loadBasis({
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: verified.actorId,
        businessAt,
        requiredCapability: "risk-assessment.evaluate",
        basisRef,
      });

      this.#assertInputSnapshotReferences(
        valid.commandId,
        inputSnapshot,
        this.#inputSnapshotReferences(basis),
      );
      const monitoring = await this.#loadMonitoring({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: verified.actorId,
        issuedAt: valid.issuedAt,
        monitoringSnapshotRefs: preparation.monitoringSnapshotRefs ?? [],
        binding,
      });

      const recordedAt = this.#now().toISOString();
      const assessment = evaluateDeterministicAssessment(
        this.#engineContext({
          projectId: valid.projectId,
          preparation,
          preparationSnapshotRef: inputSnapshot.preparationSnapshotRef,
          inputSnapshot,
          inputSnapshotRef,
          basisRef,
          applicability: preparationRead.applicability,
          basis,
          facts,
          monitoring,
        }),
        { actorId: verified.actorId, recordedAt },
      );
      // 同一冻结输入只对应一份正式事实：已存在则直接返回原引用，不重复提交事件与审计。
      const existing = await this.#readRecordRow(valid.projectId, assessment.recordRef);
      if (existing !== undefined) {
        return AssessmentEvaluationResultV1Schema.parse({
          kind: "succeeded",
          result: this.#resultRefsFromRow(existing),
        });
      }
      // 提交前复验：授权、C19 basis/C04 摘要与策略版本仍等价。
      await this.#assertCommitPreconditions({
        command: valid,
        branch: "risk-assessment.evaluate",
        binding,
        businessAt,
        requiredCapability: "risk-assessment.evaluate",
        basisRef,
        preparationSnapshotRef: inputSnapshot.preparationSnapshotRef,
        basis,
      });
      let result: EvaluationResultRefsV1;
      try {
        result = await this.#commitEvaluation({
          command: valid,
          verified,
          inputSnapshot,
          inputSnapshotRef,
          preparation,
          basis,
          assessment,
          runRef,
          recordedAt,
        });
      } catch (error) {
        // 并发重复：另一事务已写入同一内容寻址记录，两者必须观察同一逻辑结果。
        const concurrent = await this.#readRecordRow(valid.projectId, assessment.recordRef);
        if (concurrent === undefined) throw error;
        result = this.#resultRefsFromRow(concurrent);
      }
      return AssessmentEvaluationResultV1Schema.parse({ kind: "succeeded", result });
    } catch (error) {
      return AssessmentEvaluationResultV1Schema.parse({
        kind: "failed",
        error: failureToModuleError(error, valid.commandId),
      });
    }
  }

  async #readRecordRow(
    projectId: string,
    ref: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<Selectable<RiskAssessmentRecordRow> | undefined> {
    return this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("record_id", "=", ref.reference.entityId)
      .where("version_id", "=", ref.reference.versionId)
      .executeTakeFirst();
  }

  /**
   * 预测风险状态投影（design D-08）。它复用正式评估的同一评分与矩阵映射，但只读：
   * 读取基线记录的冻结依据与已存实际值集合，把目标指标替换为预测值后重算，
   * 随后直接返回风险状态。
   *
   * 这里刻意不建立实际值集合、不冻结准备、不写评估记录、预警、收据或 Outbox 事件——
   * 预测不是一次正式评估。同一请求重复执行必须得到完全相同的结果。
   */
  async projectForecastRiskState(
    request: ForecastRiskStateRequestV1,
  ): Promise<ForecastRiskStateResultV1> {
    const parsed = ForecastRiskStateRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return ForecastRiskStateResultV1Schema.parse({
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "risk-assessment.forecast-risk-state"),
      });
    }
    const valid = parsed.data;
    const commandId = valid.requestId;
    const denied = (reasonCode: "risk-state-unavailable" | "monitoring-series-mismatch") =>
      ForecastRiskStateResultV1Schema.parse({ kind: "unavailable", reasonCode });
    try {
      if (valid.projectId !== valid.authorization.projectId) {
        throw moduleError("AUTHORIZATION_DENIED", commandId);
      }
      // 预测读的是已冻结事实，因此按正式评估的读取分支复验当前身份。
      await this.#verifyCommand(
        {
          commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          authorization: valid.authorization,
        },
        "risk-assessment.read-input-snapshot",
      );
      const record = await this.#readRecordRow(valid.projectId, {
        reference: valid.baselineAssessmentRecordRef.reference,
      });
      if (record === undefined) {
        throw moduleError("AUTHORIZATION_DENIED", commandId);
      }
      // 评分依据只能来自基线记录冻结的那一版；请求声明的引用必须与之相同。
      const boundInputSnapshot = AssessmentInputSnapshotRefV1Schema.safeParse(
        record.input_snapshot_ref,
      );
      if (
        !boundInputSnapshot.success ||
        boundInputSnapshot.data.reference.entityId !==
          valid.frozenAssessmentBasisRef.reference.entityId ||
        boundInputSnapshot.data.reference.versionId !==
          valid.frozenAssessmentBasisRef.reference.versionId
      ) {
        return denied("risk-state-unavailable");
      }
      const inputRow = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("input_snapshot_id", "=", record.input_snapshot_id)
        .where("version_id", "=", record.input_snapshot_version_id)
        .executeTakeFirst();
      if (inputRow === undefined) {
        throw moduleError("AUTHORIZATION_DENIED", commandId);
      }
      const basisRef = this.#parseBasisRef(inputRow.basis_release_set_ref, commandId);
      const basis = await this.#loadBasis({
        commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        businessAt: valid.requestedAt,
        // 依据成员读取与正式评估走同一条 C19 读取接缝，因此声明同一能力面。
        requiredCapability: "risk-assessment.evaluate",
        basisRef,
      });
      const valueSet = await this.#readValueSetForForecast(valid, {
        value_set_id: record.value_set_id,
        value_set_version_id: record.value_set_version_id,
      });
      if (valueSet === undefined) {
        throw moduleError("AUTHORIZATION_DENIED", commandId);
      }
      const target = valueSet.values.values.find(
        (value) => value.indicatorId === valid.targetIndicatorId,
      );
      if (target === undefined) {
        return denied("risk-state-unavailable");
      }
      const indicator = basis.configuration.indicatorSystem.indicators.find(
        (candidate) => candidate.indicatorId === valid.targetIndicatorId,
      );
      if (indicator === undefined) {
        return denied("risk-state-unavailable");
      }
      // 预测值必须落在该指标正式声明的单位与量纲上：数值指标比规范单位，序数指标没有单位。
      // 口径不同即不可用，不在这里做任何换算或推断。
      const indicatorUnit = indicator.valueKind === "numeric" ? indicator.canonicalUnit : undefined;
      if (indicatorUnit === undefined || indicatorUnit !== valid.targetUnit) {
        return denied("risk-state-unavailable");
      }
      // 执行前监测快照必须真的承载目标指标：按序列修订的 monitoringIndicator/parameterCode
      // 与该指标已发布字段映射的监测来源逐字比对，不从序列标识反推语义。快照本身读不到
      // （撤权、失效或技术故障）时按类型化失败闭合，不降级为"序列不匹配"，也不改走其它序列。
      // 目标指标本身没有监测来源（来源字段指标）时无序列可核对，该快照只作为请求声明的冻结事实读取。
      const preparation = await this.#readForecastPreparation(valid, inputRow);
      if (preparation === undefined) {
        throw moduleError("AUTHORIZATION_DENIED", commandId);
      }
      const binding = this.#preparationBinding(commandId, valid.authorization, preparation);
      const verified = await this.#verifyCommand(
        {
          commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          authorization: valid.authorization,
        },
        "risk-assessment.read-input-snapshot",
        binding,
      );
      const series = (
        await this.#readMonitoringSnapshotRef({
          commandId,
          projectId: valid.projectId,
          actorId: verified.actorId,
          issuedAt: valid.requestedAt,
          monitoringRef: valid.preActionMonitoringSnapshotRef,
          binding,
        })
      ).seriesRevision;
      const monitoredOrigins = basis.configuration.fieldMapping.mappings.filter(
        (mapping) =>
          mapping.targetIndicatorId === valid.targetIndicatorId &&
          mapping.origin.kind !== "source-field",
      );
      const carried =
        monitoredOrigins.length === 0 ||
        monitoredOrigins.some(
          (mapping) =>
            mapping.origin.kind !== "source-field" &&
            mapping.origin.monitoringIndicator === series.monitoringIndicator &&
            mapping.origin.parameterCode === series.parameterCode &&
            mapping.targetUnit === valid.targetUnit &&
            series.canonicalUnit === valid.targetUnit,
        );
      if (!carried) {
        return denied("monitoring-series-mismatch");
      }
      const predicted = this.#projectedValueSet(valid, valueSet);
      // 评分只按已发布配置与规则重算：这里不构造完整实际评估上下文，预测不需要准备、
      // 输入快照、风险事实或监测输入（design D-08）。
      const scoring: AssessmentScoringContextV1 = {
        basis: {
          applicableRuleSetMember: basis.applicableRuleSetMember,
          configurationMembers: basis.configurationMembers,
        },
        configuration: basis.configuration,
        rules: basis.rules,
      };
      const score = scoreAssessmentAxes(scoring, predicted);
      const mapping = mapAssessmentRiskLevel(
        scoring,
        score.possibility.scoreValue,
        score.consequence.scoreValue,
      );
      return ForecastRiskStateResultV1Schema.parse({
        kind: "succeeded",
        riskState: {
          likelihoodScore: score.possibility.axis.publicScore,
          consequenceScore: score.consequence.axis.publicScore,
          riskLevel: mapping.riskLevelId,
        },
      });
    } catch (error) {
      return ForecastRiskStateResultV1Schema.parse({
        kind: "failed",
        error: failureToModuleError(error, commandId),
      });
    }
  }

  /**
   * 预测只在内存里替换一个指标取值：返回的取值集合不落库，因此不生成新引用，
   * 也不携带内容摘要——它只是评分函数的一次入参。
   */
  #projectedValueSet(
    request: ForecastRiskStateRequestV1,
    valueSet: LoadedValueSetV1,
  ): IndicatorActualValueSetV1 {
    return {
      ...valueSet.values,
      values: valueSet.values.values.map((value) =>
        value.indicatorId === request.targetIndicatorId
          ? { ...value, actualValue: request.predictedValue }
          : value,
      ),
    };
  }

  /**
   * 预测沿基线输入快照登记的精确准备引用取回已保存的准备正文：执行前监测快照的读取必须
   * 在准备快照登记的空间与来源范围内复验，预测不接受自由传入的范围。
   */
  async #readForecastPreparation(
    request: ForecastRiskStateRequestV1,
    inputRow: Pick<
      Selectable<AssessmentInputSnapshotRow>,
      "preparation_snapshot_id" | "preparation_snapshot_version_id"
    >,
  ): Promise<AssessmentPreparationSnapshotV1 | undefined> {
    let stored: { readonly snapshot_payload: unknown } | undefined;
    try {
      stored = await this.#db
        .selectFrom("business.assessment_preparation_snapshots")
        .select(["snapshot_payload"])
        .where("project_id", "=", request.projectId)
        .where("snapshot_id", "=", inputRow.preparation_snapshot_id)
        .where("version_id", "=", inputRow.preparation_snapshot_version_id)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.preparation-snapshot");
    }
    if (stored === undefined) return undefined;
    const preparation = AssessmentPreparationSnapshotV1Schema.safeParse(stored.snapshot_payload);
    return preparation.success ? preparation.data : undefined;
  }

  async #readValueSetForForecast(
    request: ForecastRiskStateRequestV1,
    row: { readonly value_set_id: string; readonly value_set_version_id: string },
  ): Promise<LoadedValueSetV1 | undefined> {
    let stored: { readonly value_set_payload: unknown } | undefined;
    try {
      stored = await this.#db
        .selectFrom("business.indicator_actual_value_sets")
        .select(["value_set_payload"])
        .where("project_id", "=", request.projectId)
        .where("value_set_id", "=", row.value_set_id)
        .where("version_id", "=", row.value_set_version_id)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.value-set");
    }
    if (stored === undefined) return undefined;
    const values = IndicatorActualValueSetV1Schema.safeParse(stored.value_set_payload);
    return values.success ? { values: values.data } : undefined;
  }

  #resultRefsFromRow(row: {
    readonly value_set_id: string;
    readonly value_set_version_id: string;
    readonly decision_id: string;
    readonly decision_version_id: string;
    readonly record_id: string;
    readonly version_id: string;
  }): EvaluationResultRefsV1 {
    return {
      indicatorActualValueSetRef: {
        kind: "indicator-actual-value-set",
        reference: { entityId: row.value_set_id, versionId: row.value_set_version_id },
      },
      assessmentDecisionArtifactRef: {
        kind: "assessment-decision-artifact",
        reference: { entityId: row.decision_id, versionId: row.decision_version_id },
      },
      assessmentRecordRef: {
        kind: "risk-assessment-record",
        reference: { entityId: row.record_id, versionId: row.version_id },
      },
    };
  }

  #parseBasisRef(value: unknown, causalRunId: string): BasisRefV1 {
    const candidate = value as { kind?: unknown };
    if (
      typeof value !== "object" ||
      value === null ||
      candidate.kind !== "assessment-basis-release-set"
    ) {
      throw moduleError("TERMINAL_FAILURE", causalRunId);
    }
    return value as BasisRefV1;
  }

  #assessmentRunRef(
    authorization: AuthorizationContextV1,
    preparation: AssessmentPreparationSnapshotV1,
    causalRunId: string,
  ): { readonly kind: "workflow-run"; readonly reference: VersionReference } {
    const authorizationRun = authorization.causalRunRef;
    const preparationRun = preparation.causalRunRef;
    if (authorizationRun === undefined && preparationRun === undefined) {
      throw moduleError("BUSINESS_BLOCKED", causalRunId, {
        blockerKind: "risk-assessment-assessment-run-required",
        blockerRef: preparation.applicabilityMetadataSnapshotRef,
      });
    }
    if (
      authorizationRun !== undefined &&
      preparationRun !== undefined &&
      versionKey(authorizationRun.reference) !== versionKey(preparationRun.reference)
    ) {
      throw moduleError("STALE_VERSION", causalRunId, { targetRef: preparationRun });
    }
    const resolved = (authorizationRun ?? preparationRun)!;
    return { kind: "workflow-run" as const, reference: resolved.reference };
  }

  #assertInputSnapshotReferences(
    causalRunId: string,
    stored: AssessmentInputSnapshot,
    expected: Record<(typeof INPUT_SNAPSHOT_REFERENCE_FIELDS_V1)[number], VersionReference>,
  ): void {
    for (const field of INPUT_SNAPSHOT_REFERENCE_FIELDS_V1) {
      if (versionKey(stored[field]) !== versionKey(expected[field])) {
        throw moduleError("STALE_VERSION", causalRunId, {
          targetRef: { kind: "project-revision", reference: expected[field] },
        });
      }
    }
  }

  async #putDecisionArtifact(
    command: Extract<AssessmentEvaluationCommandV1, { kind: "evaluate" }>,
    verified: AuthorizationContextV1,
    basis: LoadedBasisV1,
    assessment: DeterministicAssessmentV1,
  ): Promise<{ readonly ref: ContentArtifactRefV1; readonly digest: string }> {
    const parentArtifactRefs = [
      basis.applicableRuleSetMember.artifactRef,
      ...basis.scoringRuleMembers.map((member) => member.artifactRef),
    ].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
    const artifactRef: ContentArtifactRefV1 = {
      kind: "content-artifact",
      reference: {
        entityId: `assessment-decision-${assessment.decisionDigest}`,
        versionId: `sha256:${assessment.decisionDigest}`,
      },
    };
    let putRef: ContentArtifactRefV1;
    try {
      const put = await this.#artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
          commandId: `${command.commandId}:decision`,
          idempotencyKey: `${command.commandId}:decision`,
          projectId: command.projectId,
          actorId: command.actorId,
          issuedAt: command.issuedAt,
          authorization: verified,
          requiredCapability: "risk-assessment.evaluate",
          artifactId: artifactRef.reference.entityId,
          artifactKind: "content",
          purposeCode: RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
          mediaType: RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
          parentArtifactRefs,
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        one(new TextEncoder().encode(canonicalJson(assessment.decision))),
      );
      putRef = put.artifactRef as ContentArtifactRefV1;
    } catch (error) {
      // 并发重复：同一内容寻址工件已由另一事务登记；能按同一引用读出且摘要一致即为同一逻辑结果。
      const handle = await this.#openDecisionArtifact(command, verified, artifactRef);
      if (handle === undefined) throw error;
      await handle.completed;
      putRef = { kind: "content-artifact", reference: handle.manifest.artifactRef.reference };
    }
    if (
      putRef.kind !== "content-artifact" ||
      putRef.reference.versionId !== artifactRef.reference.versionId
    ) {
      throw moduleError("STALE_VERSION", command.commandId, {
        targetRef: { kind: "content-artifact", reference: putRef.reference },
      });
    }
    return { ref: putRef, digest: assessment.decisionDigest };
  }

  /**
   * 并发重复时按同一内容寻址引用回读已登记工件：另一事务可能仍在提交，
   * 因此在有限窗口内轮询，超窗仍未可见即视为真实失败。
   */
  async #openDecisionArtifact(
    command: Extract<AssessmentEvaluationCommandV1, { kind: "evaluate" }>,
    verified: AuthorizationContextV1,
    artifactRef: ContentArtifactRefV1,
  ): Promise<ArtifactReadHandleV1 | undefined> {
    const deadline = Date.now() + CONCURRENT_ARTIFACT_WAIT_MS_V1;
    for (;;) {
      const handle = await this.#artifactStore
        .open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
            requestId: `${command.commandId}:decision-read-${Date.now()}`,
            idempotencyKey: `${command.commandId}:decision-read`,
            artifactRef,
            projectId: command.projectId,
            actorId: command.actorId,
            requestedAt: command.issuedAt,
            purposeCode: RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
            requiredCapability: "risk-assessment.evaluate",
            authorization: verified,
          }),
        )
        .catch(() => undefined);
      if (handle !== undefined) return handle;
      if (Date.now() >= deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, CONCURRENT_ARTIFACT_POLL_MS_V1));
    }
  }

  async #commitEvaluation(input: {
    readonly command: Extract<AssessmentEvaluationCommandV1, { kind: "evaluate" }>;
    readonly verified: AuthorizationContextV1;
    readonly recordedAt: string;
    readonly inputSnapshot: AssessmentInputSnapshot;
    readonly inputSnapshotRef: InputSnapshotRefV1;
    readonly preparation: AssessmentPreparationSnapshotV1;
    readonly basis: LoadedBasisV1;
    readonly assessment: DeterministicAssessmentV1;
    readonly runRef: { readonly kind: "workflow-run"; readonly reference: VersionReference };
  }): Promise<EvaluationResultRefsV1> {
    const command = input.command;
    const assessment = input.assessment;
    const recordedAt = input.recordedAt;
    const auditEntryId = `audit-${command.commandId}:assessment-record`;
    const evidenceDigest = sha256CanonicalJson(
      assessment.valueSet.values.map((value) => value.evidenceReferences),
    );
    const configurationDigest = sha256CanonicalJson(
      Object.fromEntries(
        INPUT_SNAPSHOT_REFERENCE_FIELDS_V1.map((field) => [field, input.inputSnapshot[field]]),
      ),
    );
    // 记录判别字段由公共契约决定，风险输入标识据此二选一。
    const riskRecordId =
      assessment.record.kind === "standardized-risk-record"
        ? assessment.record.riskRecordId
        : undefined;
    const externalRiskEventId =
      assessment.record.kind === "external-risk-event"
        ? assessment.record.externalRiskEventId
        : undefined;
    const receipt = await this.#transactionUnit.execute(
      this.#atomicCommand(
        command,
        "risk-assessment.record.v1",
        {
          valueSetRef: assessment.valueSet.indicatorActualValueSetRef,
          decisionRef: assessment.decisionRef,
          recordRef: assessment.recordRef,
          inputSnapshotRef: input.inputSnapshotRef,
        },
        input.runRef,
      ),
      async (context): Promise<AtomicCommitV1> => {
        const transaction = asRiskAssessmentTransaction(context);
        // 工件登记在回执取得之后：同一幂等身份的并发调用被回执主键串行，避免并发重复登记。
        const decisionArtifact = await this.#putDecisionArtifact(
          command,
          input.verified,
          input.basis,
          assessment,
        );
        await transaction
          .insertInto("business.indicator_actual_value_sets")
          .values({
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            version_id: assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            content_digest: assessment.valueSet.contentDigest,
            evidence_digest: evidenceDigest,
            value_set_payload: jsonValue(assessment.valueSet),
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["value_set_id", "version_id"]).doNothing())
          .execute();
        await transaction
          .insertInto("business.assessment_decision_artifacts")
          .values({
            decision_id: assessment.decisionRef.reference.entityId,
            version_id: assessment.decisionRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            value_set_version_id:
              assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            value_set_ref: jsonValue(assessment.valueSet.indicatorActualValueSetRef),
            content_artifact_ref: jsonValue(decisionArtifact.ref),
            content_artifact_id: decisionArtifact.ref.reference.entityId,
            content_artifact_version_id: decisionArtifact.ref.reference.versionId,
            content_digest: decisionArtifact.digest,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["decision_id", "version_id"]).doNothing())
          .execute();
        await transaction
          .insertInto("business.risk_assessment_records")
          .values({
            record_id: assessment.recordRef.reference.entityId,
            version_id: assessment.recordRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            command_id: command.commandId,
            idempotency_key: command.idempotencyKey,
            risk_input_kind:
              riskRecordId === undefined ? "external-risk-event" : "standardized-risk-record",
            risk_record_id: riskRecordId ?? null,
            external_risk_event_id: externalRiskEventId ?? null,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            value_set_version_id:
              assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            decision_id: assessment.decisionRef.reference.entityId,
            decision_version_id: assessment.decisionRef.reference.versionId,
            record_payload: jsonValue(assessment.record),
            likelihood_score_canonical: assessment.decision.axisScores.possibility.score,
            consequence_score_canonical: assessment.decision.axisScores.consequence.score,
            risk_level_id: assessment.decision.matrix.riskLevelId,
            configuration_digest: configurationDigest,
            content_digest: sha256CanonicalJson(assessment.record),
            identity_digest: assessment.recordDigest,
            actor_ref: input.verified.actorId,
            authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            occurred_at: command.issuedAt,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["record_id", "version_id"]).doNothing())
          .execute();
        return {
          resultRef: assessment.recordRef,
          audit: {
            auditEntryId,
            projectId: command.projectId,
            action: "risk-assessment.record",
            targetRef: assessment.recordRef,
            actorRef: input.verified.actorId,
            authorizationContextRef: command.authorization.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt,
            version: assessment.recordRef.reference,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            runId: input.runRef.reference.entityId,
          },
          events: [
            DomainEventV1Schema.parse({
              schemaVersion: "1",
              eventId: `assessment-recorded-${assessment.recordDigest}`,
              eventVersion: 1,
              eventType: "assessment.recorded.v1",
              projectId: command.projectId,
              aggregateRef: assessment.recordRef,
              occurredAt: command.issuedAt,
              recordedAt,
              causationId: command.commandId,
              correlationId: `assessment-record-${assessment.recordDigest}`,
              producerCommandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              authorizationContextRef: command.authorization.authorizationContextRef,
              auditTrailRef: {
                kind: "audit-trail",
                reference: { entityId: auditEntryId, versionId: "1" },
              },
              payload: {
                riskInputRef: input.preparation.riskInput,
                assessmentInputSnapshotRef: input.inputSnapshotRef,
                assessmentRecordRef: assessment.recordRef,
                assessmentRunRef: input.runRef,
              },
            }),
          ],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );

    const recordRef = receipt.resultRef;
    if (recordRef.kind !== "risk-assessment-record") {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    const row = await this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("record_id", "=", recordRef.reference.entityId)
      .where("version_id", "=", recordRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    return this.#resultRefsFromRow(row);
  }

  // ==================================================================
  // C34 风险评估只读（design D-04）
  // ==================================================================

  async verifyCheckpointReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly reference: ContractReferenceV1;
    readonly preparationSnapshotRef?: AssessmentInputSnapshot["preparationSnapshotRef"];
  }): Promise<boolean> {
    const reference = ContractReferenceV1Schema.safeParse(input.reference);
    if (
      !reference.success ||
      (reference.data.kind !== "assessment-input-snapshot" &&
        reference.data.kind !== "risk-assessment-record")
    )
      return false;
    if (
      input.authorization.projectId !== input.projectId ||
      input.authorization.actorId !== input.actorId ||
      input.authorization.grantedCapabilities.length !== 1 ||
      input.authorization.grantedCapabilities[0] !== "risk-assessment.read"
    )
      return false;
    const verify = async (sourceVersionRefs: readonly SourceVersionRefV1[]) => {
      const decision = await this.#access
        .verify({
          authorizationContextRef: input.authorization.authorizationContextRef,
          invocationId: input.invocationId,
          projectId: input.projectId,
          branch: "risk-assessment.read",
          requestedSpatialScopeRefs: [...input.authorization.spatialScopeRefs],
          requestedSourceVersionRefs: [...sourceVersionRefs],
          requestedAt: input.requestedAt,
        })
        .catch((error: unknown) => {
          if (error instanceof AccessServiceError) return undefined;
          throw error;
        });
      return (
        decision !== undefined &&
        !decision.redacted &&
        isDeepStrictEqual(decision.context, input.authorization)
      );
    };
    if (!(await verify([]))) return false;
    const target = reference.data;
    const recordRow =
      target.kind === "risk-assessment-record"
        ? await this.#readRecordRow(input.projectId, target)
        : undefined;
    if (target.kind === "risk-assessment-record") {
      if (recordRow === undefined) return false;
      const record = RiskAssessmentRecordSchema.safeParse(recordRow.record_payload);
      if (
        !record.success ||
        record.data.assessmentRecordId !== target.reference.entityId ||
        sha256CanonicalJson(record.data) !== recordRow.content_digest ||
        (record.data.kind === "standardized-risk-record"
          ? record.data.riskRecordId !== recordRow.risk_record_id
          : record.data.externalRiskEventId !== recordRow.external_risk_event_id)
      )
        return false;
    }
    const snapshotRef =
      target.kind === "assessment-input-snapshot"
        ? target.reference
        : {
            entityId: recordRow!.input_snapshot_id,
            versionId: recordRow!.input_snapshot_version_id,
          };
    const row = await this.#db
      .selectFrom("business.assessment_input_snapshots")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("input_snapshot_id", "=", snapshotRef.entityId)
      .where("version_id", "=", snapshotRef.versionId)
      .executeTakeFirst();
    if (row === undefined) return false;
    const parsed = AssessmentInputSnapshotSchema.safeParse(row.snapshot_payload);
    if (!parsed.success) return false;
    const snapshot = parsed.data;
    if (
      snapshot.createdBy !== row.actor_ref ||
      !isDeepStrictEqual(snapshot.authorizationContextRef, row.authorization_context_ref) ||
      !isDeepStrictEqual(snapshot.preparationSnapshotRef, row.preparation_snapshot_ref) ||
      snapshot.preparationSnapshotRef.reference.entityId !== row.preparation_snapshot_id ||
      snapshot.preparationSnapshotRef.reference.versionId !== row.preparation_snapshot_version_id ||
      sha256CanonicalJson({
        projectId: input.projectId,
        ...withoutClock(snapshot as unknown as Record<string, unknown>),
      }) !== row.reference_digest ||
      (recordRow !== undefined &&
        !isDeepStrictEqual(recordRow.input_snapshot_ref, {
          kind: "assessment-input-snapshot",
          reference: snapshotRef,
        })) ||
      (target.kind === "assessment-input-snapshot" && input.preparationSnapshotRef === undefined) ||
      (input.preparationSnapshotRef !== undefined &&
        !isDeepStrictEqual(snapshot.preparationSnapshotRef, input.preparationSnapshotRef))
    )
      return false;
    const preparationRow = await this.#db
      .selectFrom("business.assessment_preparation_snapshots")
      .select("snapshot_payload")
      .where("project_id", "=", input.projectId)
      .where("snapshot_id", "=", row.preparation_snapshot_id)
      .where("version_id", "=", row.preparation_snapshot_version_id)
      .executeTakeFirst();
    const preparation = AssessmentPreparationSnapshotV1Schema.safeParse(
      preparationRow?.snapshot_payload,
    );
    if (
      !preparation.success ||
      !input.authorization.spatialScopeRefs.some((scope) =>
        isDeepStrictEqual(scope, preparation.data.spatialScopeRef),
      )
    )
      return false;
    return verify(declaredPreparationRefs(preparation.data).sourceVersionRefs);
  }

  /**
   * 八个读操作共享同一入口：先按公共读契约解析命令并复验授权，再按 `operation` 分派。
   * 任何未登记事实、读不到的正文或绑定不符的分支都失败闭合，不返回部分结果。
   */
  async read(query: RiskAssessmentReadQueryV1): Promise<RiskAssessmentReadResultV1> {
    const valid = RiskAssessmentReadQueryV1Schema.safeParse(query);
    if (!valid.success) {
      return this.#readFailure(query, moduleError("UNSUPPORTED_CONTRACT", query.queryId));
    }
    const command = valid.data;
    const verified = await this.#verifyReadAuthorization(command);
    if (verified === undefined) {
      return this.#readFailure(command, this.#readDenied(command));
    }
    try {
      return await this.#dispatchRead(command, verified);
    } catch (error) {
      // 公开读契约是全函数：任何已定型的模块错误都收口为失败结果，绝不把错误对象抛给调用方。
      if (error instanceof RiskAssessmentReadFailure) {
        return this.#readFailure(command, error.error);
      }
      const typed = ModuleErrorV1Schema.safeParse(error);
      if (typed.success) return this.#readFailure(command, typed.data);
      throw error;
    }
  }

  #readDenied(query: RiskAssessmentReadQueryV1): ModuleErrorV1 {
    return moduleError(
      "AUTHORIZATION_DENIED",
      query.queryId,
      {},
      MODULE_BRANCH_CAPABILITY_V1["risk-assessment.read"],
    );
  }

  #readFailure(query: RiskAssessmentReadQueryV1, error: ModuleErrorV1): RiskAssessmentReadResultV1 {
    return RiskAssessmentReadResultV1Schema.parse({ kind: "failed", error });
  }

  /**
   * 只读复验：沿 `risk-assessment.read` 分支复验当前授权上下文。`redacted` 表示授权已撤销或
   * 不可判定，此时失败闭合而不是当作「没有数据」——两者对调用方的含义完全不同。
   */
  async #verifyReadAuthorization(
    command: RiskAssessmentReadQueryV1,
  ): Promise<AuthorizationContextV1 | undefined> {
    const decision = await this.#access
      .verify({
        authorizationContextRef: command.authorization.authorizationContextRef,
        invocationId: command.queryId,
        projectId: command.projectId,
        branch: "risk-assessment.read",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: command.requestedAt,
      })
      .catch((error: unknown) => {
        if (error instanceof AccessServiceError) return undefined;
        throw error;
      });
    if (decision === undefined || decision.redacted) return undefined;
    const context = decision.context;
    if (
      context.projectId !== command.projectId ||
      context.actorId !== command.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes("risk-assessment.read")
    ) {
      return undefined;
    }
    return context;
  }

  async #dispatchRead(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    switch (command.payload.operation) {
      case "pending-catalog":
        return this.#readPendingCatalog(command as C34ReadCommandV1<"pending-catalog">, verified);
      case "entry-context":
        return this.#readEntryContext(command as C34ReadCommandV1<"entry-context">, verified);
      case "record-catalog":
        return this.#readRecordCatalog(command as C34ReadCommandV1<"record-catalog">, verified);
      case "record-read":
        return this.#readRecord(command as C34ReadCommandV1<"record-read">, verified);
      case "reassessment-history":
        return this.#readReassessmentHistory(
          command as C34ReadCommandV1<"reassessment-history">,
          verified,
        );
      case "overview":
        return this.#readOverview(command as C34ReadCommandV1<"overview">, verified);
      case "resolve":
        return this.#readResolve(command as C34ReadCommandV1<"resolve">, verified);
      case "run-read":
        return this.#readRun(command as C34ReadCommandV1<"run-read">, verified);
    }
  }

  /**
   * 动作可用性（design D-06）：逐分支尝试签发下游授权，仅据此产生安全呈现元数据。
   * 签发失败记 `denied`，业务上不成立（无部署运行策略等）记 `business-unavailable`。
   * 绝不因为读成功就推断写能力，也不在此处执行任何领域命令。
   */
  async #readActions(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
    branches: readonly ModuleBranchV1[],
    unavailable?: (branch: ModuleBranchV1) => string | undefined,
  ): Promise<ReadActionV1[]> {
    const actions: ReadActionV1[] = [];
    for (const branch of branches) {
      const reason = unavailable?.(branch);
      if (reason !== undefined) {
        actions.push({ branch, availability: "business-unavailable", reasonCode: reason });
        continue;
      }
      const issued = await this.#authorizeDownstream({
        branch,
        invocationId: `${command.queryId}:action:${branch}`,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
      }).then(
        (context) => {
          const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
          return context.grantedCapabilities.includes(capability);
        },
        () => false,
      );
      actions.push(
        issued ? { branch, availability: "allowed" } : { branch, availability: "denied" },
      );
    }
    void verified;
    return actions;
  }

  // ---------------------------------------------------------------- 待评估目录

  /**
   * 待评估候选由两个各自所属的接缝提供：C33 的风险记录目录与 C11 的外部事件目录。
   * 评估拥有方只在本页精确候选集合上批量判断是否已有评估，不逐条回查其它域的内部结构。
   */
  async #readPendingCatalog(
    command: C34ReadCommandV1<"pending-catalog">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const pageSize = command.payload.pageSize ?? 50;
    const scope = command.payload.spatialScopeRef;
    const candidates =
      command.payload.riskInputKind === "risk-record"
        ? await this.#pendingRiskRecordCandidates(command, verified, pageSize)
        : await this.#pendingExternalEventCandidates(command, verified, pageSize);
    const states = await this.#assessmentStatesFor(command, candidates.items);
    const items: PendingRiskItemV1[] = [];
    for (const candidate of candidates.items) {
      if (
        scope !== undefined &&
        !candidate.spatialScopeRefs.some(
          (item) => versionKey(item.reference) === versionKey(scope.reference),
        )
      ) {
        continue;
      }
      const last = states.get(candidate.riskInputKey);
      items.push({
        riskInput: candidate.riskInput,
        spatialScopeRefs: candidate.spatialScopeRefs,
        assessmentState: last === undefined ? "unassessed" : "assessed",
        ...(last === undefined ? {} : { lastAssessmentRecordRef: last }),
        evidenceReferences: candidate.evidenceReferences,
      });
    }
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "pending-catalog",
        actorId: command.actorId,
        items,
        ...(candidates.nextCursor === undefined ? {} : { nextCursor: candidates.nextCursor }),
        actions: await this.#readActions(command, verified, [
          "risk-assessment.initial",
          "risk-assessment.reassessment",
        ]),
      },
    });
  }

  async #pendingRiskRecordCandidates(
    command: C34ReadCommandV1<"pending-catalog">,
    verified: AuthorizationContextV1,
    pageSize: number,
  ): Promise<PendingCandidatePageV1> {
    const context = await this.#authorizeFor(
      {
        branch: "risk-identification.record-catalog",
        invocationId: `${command.queryId}:pending-record-catalog`,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
        requestedSpatialScopeRefs: verified.spatialScopeRefs,
        // 目录只列记录元数据与证据定位，不读资料正文，因此不请求来源授权。
        // 带上来源授权会让本次读取的 `authorizationScopeDigest` 多出 grant 项，
        // 与记录按自身登记范围计算的摘要不相等，目录将对所有记录返回空。
        // 证据正文的可读与脱敏由 C33 逐来源判定，不在这里提前收窄。
        requestedSourceVersionRefs: [],
      },
      "risk-identification.read",
    );
    const page = await this.#recordCatalog.read({
      queryId: `${command.queryId}:pending-record-catalog`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: context,
      kind: "record-catalog",
      payload: {
        pageSize,
        ...(command.payload.cursor === undefined ? {} : { cursor: command.payload.cursor }),
      },
    });
    if (page.kind !== "succeeded") {
      throw this.#readBlocked(command.queryId, "downstream-read-not-succeeded");
    }
    if (page.result.kind !== "record-catalog") {
      throw this.#readBlocked(command.queryId, "pending-catalog-kind-mismatch");
    }
    return {
      items: page.result.items.map((item) => ({
        riskInput: {
          kind: "standardized-risk-record",
          reference: item.riskRecordRef.reference,
        } as RiskInputVersionRefV1,
        riskInputKey: `risk-record ${item.riskRecordRef.reference.entityId}`,
        spatialScopeRefs: item.spatialScopeRefs,
        evidenceReferences: item.evidenceReferences,
      })),
      nextCursor: page.result.nextCursor,
    };
  }

  async #pendingExternalEventCandidates(
    command: C34ReadCommandV1<"pending-catalog">,
    verified: AuthorizationContextV1,
    pageSize: number,
  ): Promise<PendingCandidatePageV1> {
    if (command.payload.riskInputKind !== "external-risk-event")
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const read = await this.#readEntryDirectory(
      command,
      verified,
      `${command.queryId}:pending-external-events`,
      {
        spatialScopeRef: command.payload.spatialScopeRef,
        operation: "external-event-catalog",
        pageSize,
        ...(command.payload.cursor === undefined ? {} : { cursor: command.payload.cursor }),
      },
    );
    if (read.result.kind !== "external-event-catalog") {
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(command.queryId, "pending-catalog-kind-mismatch"),
      );
    }
    return {
      items: read.result.items.map((item) => ({
        riskInput: {
          kind: "external-risk-event",
          reference: item.riskInput.reference,
        } as RiskInputVersionRefV1,
        riskInputKey: `external-event ${item.riskInput.reference.entityId}`,
        spatialScopeRefs: [item.spatialScopeRef],
        evidenceReferences: item.evidenceReferences,
      })),
      nextCursor: read.result.nextCursor,
    };
  }

  /** 在本页精确风险输入集合上批量判断是否已有评估：两次有界查询，不逐条回查。 */
  async #assessmentStatesFor(
    command: RiskAssessmentReadQueryV1,
    candidates: PendingCandidatePageV1["items"],
  ): Promise<Map<string, RiskAssessmentRecordRefV1>> {
    if (candidates.length === 0) return new Map();
    const states = new Map<string, RiskAssessmentRecordRefV1>();
    const record = (row: {
      risk_input_kind: string;
      risk_record_id: string | null;
      external_risk_event_id: string | null;
      record_id: string;
      version_id: string;
    }) => {
      const key =
        row.risk_input_kind === "standardized-risk-record"
          ? `risk-record ${row.risk_record_id ?? ""}`
          : `external-event ${row.external_risk_event_id ?? ""}`;
      if (states.has(key)) return;
      states.set(key, {
        kind: "risk-assessment-record",
        reference: { entityId: row.record_id, versionId: row.version_id },
      });
    };
    const riskRecordIds = candidates
      .filter((item) => item.riskInputKey.startsWith("risk-record "))
      .map((item) => item.riskInput.reference.entityId);
    const externalEventIds = candidates
      .filter((item) => item.riskInputKey.startsWith("external-event "))
      .map((item) => item.riskInput.reference.entityId);
    try {
      if (riskRecordIds.length > 0) {
        const rows = await this.#db
          .selectFrom("business.risk_assessment_records")
          .select([
            "risk_input_kind",
            "risk_record_id",
            "external_risk_event_id",
            "record_id",
            "version_id",
            "recorded_at",
          ])
          .where("project_id", "=", command.projectId)
          .where("risk_input_kind", "=", "standardized-risk-record")
          .where("risk_record_id", "in", riskRecordIds)
          .distinctOn("risk_record_id")
          .orderBy("risk_record_id", "asc")
          .orderBy("recorded_at", "desc")
          .limit(riskRecordIds.length)
          .execute();
        for (const row of rows) record(row);
      }
      if (externalEventIds.length > 0) {
        const rows = await this.#db
          .selectFrom("business.risk_assessment_records")
          .select([
            "risk_input_kind",
            "risk_record_id",
            "external_risk_event_id",
            "record_id",
            "version_id",
            "recorded_at",
          ])
          .where("project_id", "=", command.projectId)
          .where("risk_input_kind", "=", "external-risk-event")
          .where("external_risk_event_id", "in", externalEventIds)
          .distinctOn("external_risk_event_id")
          .orderBy("external_risk_event_id", "asc")
          .orderBy("recorded_at", "desc")
          .limit(externalEventIds.length)
          .execute();
        for (const row of rows) record(row);
      }
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.pending-catalog");
    }
    return states;
  }

  // ---------------------------------------------------------------- 启动上下文

  /**
   * 启动上下文只提供已成立的输入引用与部署注入的运行策略，绝不创建快照。
   * 两个目录各自独立分页：一个目录没有下一页不影响另一个目录的游标。
   */
  async #readEntryDirectory(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
    queryId: string,
    payload: AssessmentEntryContextReadQueryV1["payload"],
  ) {
    const scope = verified.spatialScopeRefs.find(
      (ref) => ref.reference.entityId === payload.spatialScopeRef.reference.entityId,
    );
    if (scope === undefined) throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const sourceScope = await this.#entryContext.readAuthorizedSourceVersions({
      queryId: command.queryId,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: verified,
      kind: "read-assessment-entry-source-versions",
      payload: { spatialScopeRef: payload.spatialScopeRef },
    });
    if (sourceScope.kind === "failed") throw new RiskAssessmentReadFailure(sourceScope.error);
    if (sourceScope.kind !== "succeeded")
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(command.queryId, "source-scope-read-not-succeeded"),
      );
    let authorization: AuthorizationContextV1;
    try {
      authorization = await this.#authorizeFor(
        {
          branch: "engineering-data.context-read",
          invocationId: queryId,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: command.requestedAt,
          requestedSpatialScopeRefs: [scope],
          requestedSourceVersionRefs: sourceScope.result.sourceVersionRefs,
        },
        "engineering-data.read",
      );
    } catch {
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    }
    if (
      !authorization.spatialScopeRefs.every(
        (ref) => versionKey(ref.reference) === versionKey(scope.reference),
      ) ||
      !authorization.sourceAccessGrantRefs.every((ref) =>
        verified.sourceAccessGrantRefs.some(
          (grant) => versionKey(grant.reference) === versionKey(ref.reference),
        ),
      )
    )
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const result = await this.#entryContext.read({
      queryId,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization,
      kind: "read-assessment-entry-context",
      payload,
    });
    if (result.kind === "failed") throw new RiskAssessmentReadFailure(result.error);
    if (result.kind !== "succeeded")
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(command.queryId, "downstream-read-not-succeeded"),
      );
    return result;
  }

  async #readEntryContext(
    command: C34ReadCommandV1<"entry-context">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const readDirectory = async (
      operation: "applicability-catalog" | "external-event-catalog",
      cursor: string | undefined,
    ) =>
      this.#readEntryDirectory(command, verified, `${command.queryId}:entry-context:${operation}`, {
        spatialScopeRef: command.payload.spatialScopeRef,
        ...(operation === "applicability-catalog"
          ? { operation, projectRevisionRef: command.payload.projectRevisionRef }
          : { operation }),
        ...(command.payload.pageSize === undefined ? {} : { pageSize: command.payload.pageSize }),
        ...(cursor === undefined ? {} : { cursor }),
      });
    const [applicability, external] = await Promise.all([
      readDirectory("applicability-catalog", command.payload.applicabilityCursor),
      readDirectory("external-event-catalog", command.payload.externalEventCursor),
    ]);
    if (applicability.result.kind !== "applicability-catalog") {
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(command.queryId, "entry-context-applicability-kind-mismatch"),
      );
    }
    if (external.result.kind !== "external-event-catalog") {
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(command.queryId, "entry-context-external-kind-mismatch"),
      );
    }
    const runPolicy =
      this.#entryRunPolicy === undefined
        ? { kind: "unavailable" as const, reasonCode: "entry-run-policy-not-injected" }
        : { kind: "available" as const, ...this.#entryRunPolicy };
    const preparationMissingKinds: "scoring-configuration"[] = [];
    if (this.#configuration !== undefined) {
      const configuration = await this.#configuration.readConfigurationMembers({
        requiredDefinitionTypes: ASSESSMENT_SCORING_CONFIGURATION_TYPES,
        projectId: command.projectId,
        authorization: verified,
        requiredAt: command.requestedAt,
        asOfRecordedAt: command.requestedAt,
      });
      if (configuration.kind !== "succeeded") {
        if (
          configuration.error.code !== "BUSINESS_BLOCKED" ||
          ![
            "required-release-unavailable",
            "assessment-configuration-set-incomplete",
            "assessment-configuration-policy-required",
          ].includes(configuration.error.blockerKind)
        )
          return RiskAssessmentReadResultV1Schema.parse(configuration);
        preparationMissingKinds.push("scoring-configuration");
      } else if (
        ASSESSMENT_SCORING_CONFIGURATION_TYPES.some(
          (type) => !configuration.members.some((member) => member.definitionType === type),
        )
      ) {
        preparationMissingKinds.push("scoring-configuration");
      }
    }
    const actions = await this.#readActions(
      command,
      verified,
      ["risk-assessment.initial", "risk-assessment.reassessment"],
      (branch) =>
        this.#entryRunPolicy === undefined &&
        (branch === "risk-assessment.initial" || branch === "risk-assessment.reassessment")
          ? "entry-run-policy-not-injected"
          : undefined,
    );
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "entry-context",
        actorId: command.actorId,
        projectId: command.projectId,
        projectRevisionRef: command.payload.projectRevisionRef,
        spatialScopeRef: command.payload.spatialScopeRef,
        ...(command.payload.riskInput === undefined
          ? {}
          : { riskInput: command.payload.riskInput }),
        applicabilityItems: applicability.result.items,
        externalEventItems: external.result.items,
        ...(applicability.result.nextCursor === undefined
          ? {}
          : { applicabilityNextCursor: applicability.result.nextCursor }),
        ...(external.result.nextCursor === undefined
          ? {}
          : { externalEventNextCursor: external.result.nextCursor }),
        runPolicy,
        preparationMissingKinds,
        actions,
      },
    });
  }

  // ---------------------------------------------------------------- 记录目录

  /**
   * 记录目录只给摘要与冻结落点，正文由 `record-read` 解释。
   *
   * 入口方式、空间范围与前驱只登记在准备快照上，矩阵版本只登记在决策工件正文里，两者都不是
   * 记录行的列。这里分三段有界查询（记录页 → 该页输入快照 → 该页准备快照）后在页内判定，
   * 不做全量连接，也不为每条记录单独回读正文。
   */
  async #readRecordCatalog(
    command: C34ReadCommandV1<"record-catalog">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const pageSize = command.payload.pageSize ?? 50;
    const after = decodeC34RecordCursor(command.payload.cursor, command, verified);
    if (after === null) return this.#readFailure(command, this.#readDenied(command));
    const page = await this.#recordPage(command, {
      pageSize,
      verified,
      after,
      ...(command.payload.riskInput === undefined ? {} : { riskInput: command.payload.riskInput }),
    });
    const preparations = await this.#preparationsOf(command, page.rows);
    const decisions = new Map<string, LoadedDecisionV1 | undefined>();
    const items: AssessmentRecordCatalogItemV1[] = [];
    for (const row of page.rows) {
      const preparation = preparations.get(this.#inputSnapshotKeyOf(row));
      if (preparation === undefined) {
        throw this.#readBlocked(command.queryId, "assessment-preparation-snapshot-missing");
      }
      if (
        command.payload.entryMode !== undefined &&
        preparation.entry_mode !== command.payload.entryMode
      ) {
        continue;
      }
      if (
        command.payload.spatialScopeRef !== undefined &&
        versionKey(asVersionRef(preparation.spatial_scope_ref)) !==
          versionKey(command.payload.spatialScopeRef.reference)
      ) {
        continue;
      }
      const decisionKey = `${row.decision_id}\u0000${row.decision_version_id}`;
      if (!decisions.has(decisionKey))
        decisions.set(
          decisionKey,
          await this.#loadDecisionContext(
            command,
            verified,
            row.decision_id,
            row.decision_version_id,
          ),
        );
      const context = decisions.get(decisionKey);
      if (context === undefined) {
        throw this.#readBlocked(command.queryId, "record-decision-artifact-unreadable");
      }
      if (
        command.payload.riskMatrixVersion !== undefined &&
        versionKey(context.decision.matrix.riskMatrixRef) !==
          versionKey(command.payload.riskMatrixVersion)
      ) {
        continue;
      }
      items.push(this.#catalogItemOf(row, preparation, context.decision, command.queryId));
    }
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "record-catalog",
        actorId: command.actorId,
        items,
        ...(page.hasMore
          ? { nextCursor: encodeC34RecordCursor(page.rows.at(-1)!, command, verified) }
          : {}),
        actions: await this.#readActions(command, verified, ["risk-assessment.reassessment"]),
      },
    });
  }

  /**
   * 记录行先按拥有方保存的空间、来源和筛选条件缩小，再按稳定排序键分页。
   * 多取的一行只用于判定 `hasMore`，绝不返回给调用方——否则页大小会越界一行。
   */
  async #recordPage(
    command: RiskAssessmentReadQueryV1,
    options: {
      readonly pageSize: number;
      readonly verified: AuthorizationContextV1;
      readonly after: C34RecordCursorV1 | undefined;
      readonly riskInput?: RiskInputVersionRefV1;
      readonly ascending?: boolean;
    },
  ): Promise<{
    readonly rows: readonly Selectable<RiskAssessmentRecordRow>[];
    readonly hasMore: boolean;
  }> {
    let query = await this.#authorizedRecordQuery(command, options.verified);
    if (options.riskInput !== undefined) {
      // 记录行按公共 `RiskInputVersionRefV1` 的判别值登记，此处不再另造一份内部枚举。
      const kind = options.riskInput.kind;
      query = query
        .where("r.risk_input_kind", "=", kind)
        .where(
          kind === "standardized-risk-record" ? "r.risk_record_id" : "r.external_risk_event_id",
          "=",
          options.riskInput.reference.entityId,
        )
        .where("p.risk_input_version_id", "=", options.riskInput.reference.versionId);
    }
    if (options.after !== undefined) {
      const after = options.after;
      const timeOrder = options.ascending === true ? sql`>` : sql`<`;
      query = query.where(sql<SqlBool>`(
        r.occurred_at ${timeOrder} ${after.afterOccurredAt}
        OR (r.occurred_at = ${after.afterOccurredAt} AND r.record_id > ${after.afterEntityId})
        OR (r.occurred_at = ${after.afterOccurredAt} AND r.record_id = ${after.afterEntityId} AND r.version_id > ${after.afterVersionId})
      )`);
    }
    let rows: readonly Selectable<RiskAssessmentRecordRow>[];
    try {
      rows = await query
        .selectAll("r")
        .orderBy("r.occurred_at", options.ascending === true ? "asc" : "desc")
        .orderBy("r.record_id", "asc")
        .orderBy("r.version_id", "asc")
        .limit(options.pageSize + 1)
        .execute();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.record-page");
    }
    return {
      rows: rows.slice(0, options.pageSize),
      hasMore: rows.length > options.pageSize,
    };
  }

  /** 同一授权过滤用于目录、历史和 SQL 摘要；不借 C04 私表发现来源授权。 */
  async #authorizedRecordQuery(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
  ) {
    const scopeIds = verified.spatialScopeRefs.map((ref) => ref.reference.entityId);
    const requestedScope =
      "spatialScopeRef" in command.payload ? command.payload.spatialScopeRef : undefined;
    if (
      scopeIds.length === 0 ||
      (requestedScope !== undefined && !scopeIds.includes(requestedScope.reference.entityId))
    ) {
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    }
    const sources = await this.#entryContext.readAuthorizedSourceVersions({
      queryId: command.queryId,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: verified,
      kind: "read-assessment-entry-source-versions",
      payload: { spatialScopeRef: requestedScope ?? verified.spatialScopeRefs[0]! },
    });
    if (sources.kind !== "succeeded")
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const allowedSources = JSON.stringify(
      sources.result.sourceVersionRefs.map((ref) => ref.reference),
    );
    let query = this.#db
      .selectFrom("business.risk_assessment_records as r")
      .innerJoin("business.assessment_input_snapshots as i", (join) =>
        join
          .onRef("i.project_id", "=", "r.project_id")
          .onRef("i.input_snapshot_id", "=", "r.input_snapshot_id")
          .onRef("i.version_id", "=", "r.input_snapshot_version_id"),
      )
      .innerJoin("business.assessment_preparation_snapshots as p", (join) =>
        join
          .onRef("p.project_id", "=", "i.project_id")
          .onRef("p.snapshot_id", "=", "i.preparation_snapshot_id")
          .onRef("p.version_id", "=", "i.preparation_snapshot_version_id"),
      )
      .where("r.project_id", "=", command.projectId)
      .where(sql<SqlBool>`p.spatial_scope_ref -> 'reference' ->> 'entityId' = ANY(${scopeIds})`)
      .where(sql<SqlBool>`jsonb_typeof(p.snapshot_payload -> 'sourceEvidenceReferences') = 'array'`)
      .where(sql<SqlBool>`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.snapshot_payload -> 'sourceEvidenceReferences') evidence
        WHERE evidence -> 'sourceVersion' IS NULL
           OR NOT ${allowedSources}::jsonb @> jsonb_build_array(evidence -> 'sourceVersion')
      )`);
    if (requestedScope !== undefined)
      query = query.where(
        sql<SqlBool>`p.spatial_scope_ref = ${JSON.stringify(requestedScope)}::jsonb`,
      );
    if (command.payload.operation === "record-catalog") {
      if (command.payload.entryMode !== undefined)
        query = query.where("p.entry_mode", "=", command.payload.entryMode);
      if (command.payload.riskMatrixVersion !== undefined)
        query = query.where(
          sql<SqlBool>`i.snapshot_payload -> 'riskMatrixRef' = ${JSON.stringify(command.payload.riskMatrixVersion)}::jsonb`,
        );
    }
    return query;
  }

  #inputSnapshotKeyOf(row: {
    readonly input_snapshot_id: string;
    readonly input_snapshot_version_id: string;
  }): string {
    return `${row.input_snapshot_id}\u0000${row.input_snapshot_version_id}`;
  }

  /**
   * 该页记录对应的准备快照：记录行 → 输入快照 → 准备快照各一次有界查询，按精确标识建索引。
   * 缺登记事实即失败闭合，不按记录正文反推入口方式或空间范围。
   */
  async #preparationsOf(
    command: RiskAssessmentReadQueryV1,
    rows: readonly {
      readonly input_snapshot_id: string;
      readonly input_snapshot_version_id: string;
    }[],
  ): Promise<Map<string, Selectable<AssessmentPreparationSnapshotRow>>> {
    if (rows.length === 0) return new Map();
    const pairs = [
      ...new Map(rows.map((row) => [this.#inputSnapshotKeyOf(row), row] as const)).values(),
    ];
    let inputSnapshots: readonly Selectable<AssessmentInputSnapshotRow>[];
    try {
      inputSnapshots = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where(
          sql<SqlBool>`(${sql.join(
            pairs.map(
              (row) =>
                sql`(input_snapshot_id = ${row.input_snapshot_id} AND version_id = ${row.input_snapshot_version_id})`,
            ),
            sql` OR `,
          )})`,
        )
        .execute();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.input-snapshots");
    }
    const preparations = [
      ...new Map(
        inputSnapshots.map(
          (snapshot) =>
            [
              `${snapshot.preparation_snapshot_id}\u0000${snapshot.preparation_snapshot_version_id}`,
              snapshot,
            ] as const,
        ),
      ).values(),
    ];
    let rows2: readonly Selectable<AssessmentPreparationSnapshotRow>[];
    try {
      rows2 = await this.#db
        .selectFrom("business.assessment_preparation_snapshots")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where(
          sql<SqlBool>`(${sql.join(
            preparations.map(
              (snapshot) =>
                sql`(snapshot_id = ${snapshot.preparation_snapshot_id} AND version_id = ${snapshot.preparation_snapshot_version_id})`,
            ),
            sql` OR `,
          )})`,
        )
        .execute();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.preparation-snapshots");
    }
    const byPreparationKey = new Map(
      rows2.map((row) => [`${row.snapshot_id}\u0000${row.version_id}`, row] as const),
    );
    return new Map(
      inputSnapshots.flatMap((snapshot) => {
        const preparation = byPreparationKey.get(
          `${snapshot.preparation_snapshot_id}\u0000${snapshot.preparation_snapshot_version_id}`,
        );
        return preparation === undefined
          ? []
          : [[`${snapshot.input_snapshot_id}\u0000${snapshot.version_id}`, preparation] as const];
      }),
    );
  }

  #catalogItemOf(
    row: Selectable<RiskAssessmentRecordRow>,
    preparation: Selectable<AssessmentPreparationSnapshotRow>,
    decision: AssessmentDecisionArtifactV1,
    causalRunId: string,
  ): AssessmentRecordCatalogItemV1 {
    const previous =
      preparation.previous_assessment_record_ref === null
        ? undefined
        : (preparation.previous_assessment_record_ref as RiskAssessmentRecordRefV1);
    return {
      assessmentRecordRef: {
        kind: "risk-assessment-record",
        reference: { entityId: row.record_id, versionId: row.version_id },
      },
      riskInput: this.#riskInputOf(preparation, causalRunId),
      entryMode: preparation.entry_mode as WorkflowEntryModeV1,
      ...(previous === undefined ? {} : { previousAssessmentRecordRef: previous }),
      occurredAt: asIso(row.occurred_at),
      likelihoodScore: Number(row.likelihood_score_canonical),
      consequenceScore: Number(row.consequence_score_canonical),
      riskState: row.risk_level_id,
      matrixPlot: this.#matrixPlotOf(decision),
    };
  }

  /** 风险输入的精确版本只登记在准备快照上；记录行不带版本，绝不在此处补空版本。 */
  #riskInputOf(
    preparation: Selectable<AssessmentPreparationSnapshotRow>,
    causalRunId: string,
  ): RiskInputVersionRefV1 {
    const parsed = RiskInputVersionRefV1Schema.safeParse(preparation.risk_input_ref);
    if (!parsed.success) {
      throw new RiskAssessmentReadFailure(
        this.#readBlocked(causalRunId, "risk-input-reference-invalid", preparation.risk_input_kind),
      );
    }
    return parsed.data;
  }

  #matrixPlotOf(decision: AssessmentDecisionArtifactV1): AssessmentMatrixPlotV1 {
    return {
      riskMatrixRef: decision.matrix.riskMatrixRef,
      possibilityBandId: decision.matrix.possibilityBandId,
      consequenceBandId: decision.matrix.consequenceBandId,
      riskLevelId: decision.matrix.riskLevelId,
      riskLevelOrdinal: decision.matrix.riskLevelOrdinal,
    };
  }

  // ---------------------------------------------------------------- 记录解释

  /**
   * 精确记录解释：实际值来自保存的实际值集，矩阵与分带来自保存的决策工件，重评前驱与
   * 原因来自 C30 已登记的入口事实。四者任一读不到即失败闭合，不返回半份解释。
   */
  async #readRecord(
    command: C34ReadCommandV1<"record-read">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const ref = command.payload.assessmentRecordRef;
    const row = await (
      await this.#authorizedRecordQuery(command, verified)
    )
      .selectAll("r")
      .where("r.record_id", "=", ref.reference.entityId)
      .where("r.version_id", "=", ref.reference.versionId)
      .limit(1)
      .executeTakeFirst()
      .catch((error: unknown) => {
        throw mapPostgresError(error, "risk-assessment.read.record-read");
      });
    if (row === undefined) {
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    }
    const record = RiskAssessmentRecordSchema.safeParse(row.record_payload);
    if (!record.success) {
      throw this.#readBlocked(command.queryId, "assessment-record-body-invalid");
    }
    const inputSnapshot = await this.#readInputSnapshotForRecord(command, row);
    if (inputSnapshot === undefined) {
      throw this.#readBlocked(command.queryId, "assessment-input-snapshot-unreadable");
    }
    const preparation = await this.#readPreparationSnapshot(command, inputSnapshot.preparationRef);
    if (preparation === undefined) {
      throw this.#readBlocked(command.queryId, "assessment-preparation-snapshot-unreadable");
    }
    const values = await this.#readValueSet(command, row);
    if (values === undefined) {
      throw this.#readBlocked(command.queryId, "indicator-actual-value-set-unreadable");
    }
    const decision = await this.#loadDecisionContext(
      command,
      verified,
      row.decision_id,
      row.decision_version_id,
    );
    if (decision === undefined) {
      throw this.#readBlocked(command.queryId, "assessment-decision-artifact-unreadable");
    }
    const entry = await this.#entriesRead.readAssessmentEntriesForRecords({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: await this.#artifactReadAuthorization(
        command,
        workflowGraphInvocationIdV1({
          operation: "assessment-entries",
          projectId: command.projectId,
          targetId: ref.reference.entityId,
        }),
        verified,
        "projection.query",
      ),
      assessmentRecordRefs: [ref],
    });
    if (entry.kind === "failed") throw new RiskAssessmentReadFailure(entry.error);
    const metadata = entry.entries.find(
      (item) => versionKey(item.assessmentRecordRef.reference) === versionKey(ref.reference),
    );
    const view: AssessmentRecordViewV1 & { readonly kind: "record-read" } = {
      kind: "record-read",
      actorId: command.actorId,
      record: record.data,
      assessmentRecordRef: ref,
      preparationSnapshotRef: inputSnapshot.preparationRef,
      inputSnapshotRef: inputSnapshot.inputSnapshotRef,
      entryMode: preparation.entry_mode as WorkflowEntryModeV1,
      ...(metadata?.previousAssessmentRecordRef === undefined
        ? {}
        : { previousAssessmentRecordRef: metadata.previousAssessmentRecordRef }),
      ...(metadata?.reason === undefined ? {} : { reassessmentReason: metadata.reason }),
      changedInputRefs: metadata?.changedInputRefs ?? [],
      applicability: decision.decision.applicability,
      configurationRefs: decision.decision.configurationRefs,
      indicators: this.#indicatorExplanations(decision.decision, values, command.queryId),
      axes: {
        possibility: this.#axisOf(decision.decision.axisScores.possibility),
        consequence: this.#axisOf(decision.decision.axisScores.consequence),
      },
      matrixPlot: this.#matrixPlotOf(decision.decision),
      triggerFacts: decision.decision.triggers.map((trigger) => ({
        triggerType: trigger.triggerType,
        indicatorItem: trigger.indicatorItem,
        ...(trigger.actualValue === undefined ? {} : { actualValue: trigger.actualValue }),
        ...(trigger.thresholdId === undefined ? {} : { thresholdId: trigger.thresholdId }),
        ...(trigger.thresholdValue === undefined ? {} : { thresholdValue: trigger.thresholdValue }),
        ...(trigger.jointRuleId === undefined ? {} : { jointRuleId: trigger.jointRuleId }),
        evidenceReferences: trigger.evidenceReferences,
      })),
      evidenceReferences: values.values.values.flatMap((value) => value.evidenceReferences),
      // 审计轨迹只给已登记的审计条目引用；不重述审计正文，也不据此判断是否已复核。
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: row.audit_entry_id, versionId: row.version_id },
      },
      actions: await this.#readActions(command, verified, ["risk-assessment.reassessment"]),
    };
    return RiskAssessmentReadResultV1Schema.parse({ kind: "succeeded", result: view });
  }

  /** 指标解释逐项取自保存的实际值集与同记录的规则引用，不在读侧重算得分。 */
  #indicatorExplanations(
    decision: AssessmentDecisionArtifactV1,
    values: LoadedValueSetV1,
    causalRunId: string,
  ): AssessmentRecordViewV1["indicators"] {
    const byId = new Map(values.values.values.map((value) => [value.indicatorId, value]));
    return decision.rules.map((rule) => {
      const value = byId.get(rule.indicatorId);
      if (value === undefined) {
        throw new RiskAssessmentReadFailure(
          this.#readBlocked(causalRunId, "indicator-actual-value-missing"),
        );
      }
      return {
        indicatorId: rule.indicatorId,
        actualValue: value.actualValue,
        canonicalValue: value.canonicalValue,
        ...(value.canonicalUnit === undefined ? {} : { canonicalUnit: value.canonicalUnit }),
        sourceReferences: this.#sourceReferencesOf(value.source),
        evidenceReferences: value.evidenceReferences,
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        grade: rule.grade,
        baseScore: rule.baseScore,
      };
    });
  }

  #sourceReferencesOf(
    source: IndicatorActualValueSetV1["values"][number]["source"],
  ): ContractReferenceV1[] {
    switch (source.kind) {
      case "risk-input":
        return [source.riskInput];
      case "monitoring-value":
      case "monitoring-feature":
        return [source.monitoringSnapshotRef];
    }
  }

  #axisOf(
    axis: AssessmentDecisionArtifactV1["axisScores"]["possibility"],
  ): AssessmentRecordViewV1["axes"]["possibility"] {
    return {
      strategy: axis.kind,
      score: axis.score,
      publicScore: axis.publicScore,
      ...(axis.kind === "weighted-average" ? { weightSetRef: axis.weightSetRef } : {}),
      contributions: axis.contributions.map((contribution) => ({
        indicatorId: contribution.indicatorId,
        baseScore: contribution.baseScore,
        weightedScore: contribution.weightedScore,
        ...(contribution.basisPoints === undefined
          ? {}
          : { basisPoints: contribution.basisPoints }),
      })),
    };
  }

  // ---------------------------------------------------------------- 重评历史

  /**
   * 重评历史只列同一风险输入的记录，按 `occurred_at` 升序给出完整链条。
   * 原因与变化引用取 C30 已登记的入口事实，读不到就留空，而不是按冻结引用或触发原因反推。
   */
  async #readReassessmentHistory(
    command: C34ReadCommandV1<"reassessment-history">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const pageSize = command.payload.pageSize ?? 50;
    const after = decodeC34RecordCursor(command.payload.cursor, command, verified);
    if (after === null) return this.#readFailure(command, this.#readDenied(command));
    const page = await this.#recordPage(command, {
      pageSize,
      verified,
      after,
      riskInput: command.payload.riskInput,
      ascending: true,
    });
    const preparations = await this.#preparationsOf(command, page.rows);
    // 空页无需入口事实：没有记录就没有可解释对象，也不必换取下游授权。
    const entries =
      page.rows.length === 0
        ? ({ kind: "succeeded", entries: [] } as const)
        : await this.#entriesRead.readAssessmentEntriesForRecords({
            projectId: command.projectId,
            actorId: command.actorId,
            requestedAt: command.requestedAt,
            authorization: await this.#artifactReadAuthorization(
              command,
              workflowGraphInvocationIdV1({
                operation: "assessment-entries",
                projectId: command.projectId,
                targetId: page.rows[0]!.record_id,
              }),
              verified,
              "projection.query",
            ),
            assessmentRecordRefs: page.rows.map((row) => ({
              kind: "risk-assessment-record" as const,
              reference: { entityId: row.record_id, versionId: row.version_id },
            })),
          });
    if (entries.kind !== "succeeded") throw new RiskAssessmentReadFailure(entries.error);
    const metadataByKey = new Map(
      entries.entries.map((item) => [versionKey(item.assessmentRecordRef.reference), item]),
    );
    const items: ReassessmentHistoryItemV1[] = [];
    for (const row of page.rows) {
      const preparation = preparations.get(this.#inputSnapshotKeyOf(row));
      if (preparation === undefined) {
        throw this.#readBlocked(command.queryId, "assessment-preparation-snapshot-missing");
      }
      if (
        command.payload.spatialScopeRef !== undefined &&
        versionKey(asVersionRef(preparation.spatial_scope_ref)) !==
          versionKey(command.payload.spatialScopeRef.reference)
      ) {
        continue;
      }
      const context = await this.#loadDecisionContext(
        command,
        verified,
        row.decision_id,
        row.decision_version_id,
      );
      if (context === undefined) {
        throw this.#readBlocked(command.queryId, "record-decision-artifact-unreadable");
      }
      const metadata = metadataByKey.get(
        versionKey({ entityId: row.record_id, versionId: row.version_id }),
      );
      items.push({
        ...this.#catalogItemOf(row, preparation, context.decision, command.queryId),
        ...(metadata?.reason === undefined ? {} : { reason: metadata.reason }),
        changedInputRefs: metadata?.changedInputRefs ?? [],
      });
    }
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "reassessment-history",
        actorId: command.actorId,
        items,
        ...(page.hasMore
          ? { nextCursor: encodeC34RecordCursor(page.rows.at(-1)!, command, verified) }
          : {}),
        actions: await this.#readActions(command, verified, ["risk-assessment.reassessment"]),
      },
    });
  }

  // ---------------------------------------------------------------- 总览

  /**
   * 总览按当前授权空间与来源统计已入库的记录版本；SQL 聚合只返回等级计数。
   */
  async #readOverview(
    command: C34ReadCommandV1<"overview">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const query = await this.#authorizedRecordQuery(command, verified);
    const counts = await query
      .select("r.risk_level_id")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .groupBy("r.risk_level_id")
      .orderBy("r.risk_level_id", "asc")
      .execute();
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "overview",
        actorId: command.actorId,
        projectId: command.projectId,
        ...(command.payload.spatialScopeRef === undefined
          ? {}
          : { spatialScopeRef: command.payload.spatialScopeRef }),
        recordedAssessmentCount: counts.reduce((total, row) => total + Number(row.count), 0),
        riskLevelCounts: counts.map((row) => ({
          riskLevel: row.risk_level_id,
          count: Number(row.count),
        })),
        asOf: this.#now().toISOString(),
        actions: await this.#readActions(command, verified, ["risk-assessment.initial"]),
      },
    });
  }

  // ---------------------------------------------------------------- 解析与运行面

  /** 解析只按精确实体标识在自有登记行内定位，不猜测目标类型也不跨域搜索。 */
  async #readResolve(
    command: C34ReadCommandV1<"resolve">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    let record: Selectable<RiskAssessmentRecordRow> | undefined;
    if (command.payload.targetKind === "record") {
      let query = (await this.#authorizedRecordQuery(command, verified))
        .selectAll("r")
        .where("r.record_id", "=", command.payload.entityId);
      if (command.payload.versionId !== undefined)
        query = query.where("r.version_id", "=", command.payload.versionId);
      record = await query.orderBy("r.recorded_at", "desc").limit(1).executeTakeFirst();
      if (
        record === undefined ||
        (await this.#loadDecisionContext(
          command,
          verified,
          record.decision_id,
          record.decision_version_id,
        )) === undefined
      ) {
        throw new RiskAssessmentReadFailure(this.#readDenied(command));
      }
    }
    if (record !== undefined) {
      return RiskAssessmentReadResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "resolve",
          actorId: command.actorId,
          targetKind: "record",
          assessmentRecordRef: {
            kind: "risk-assessment-record",
            reference: { entityId: record.record_id, versionId: record.version_id },
          },
          // 解析结果与其它读一致给出获准动作：记录可重评，运行不能借记录分支发起重评。
          actions: await this.#readActions(command, verified, ["risk-assessment.reassessment"]),
        },
      });
    }
    const run = await this.#readRunProjection(command, verified, {
      kind: "workflow-run",
      reference: {
        entityId: command.payload.entityId,
        versionId: command.payload.versionId ?? "",
      },
    });
    if (run !== undefined) {
      return RiskAssessmentReadResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "resolve",
          actorId: command.actorId,
          targetKind: "run",
          workflowRunRef: {
            kind: "workflow-run",
            reference: {
              entityId: run.runRef.reference.entityId,
              versionId: run.runRef.reference.versionId,
            },
          },
          actions: await this.#readActions(command, verified, []),
        },
      });
    }
    throw this.#readBlocked(command.queryId, "resolve-target-not-found");
  }

  async #readRun(
    command: C34ReadCommandV1<"run-read">,
    verified: AuthorizationContextV1,
  ): Promise<RiskAssessmentReadResultV1> {
    const cursor = decodeC34RunCursor(
      command.payload.resultCursor,
      command.payload.reviewTaskCursor,
      c34RecordCursorAnchor(command, verified),
    );
    if (cursor === undefined) return this.#readFailure(command, this.#readDenied(command));
    const projection = await this.#readRunProjection(
      command,
      verified,
      command.payload.workflowRunRef,
      {
        ...(command.payload.assessmentRunRef === undefined
          ? {}
          : { assessmentRunRef: command.payload.assessmentRunRef }),
        ...(cursor.resultCursor === undefined ? {} : { resultCursor: cursor.resultCursor }),
        ...(cursor.reviewTaskCursor === undefined
          ? {}
          : { reviewTaskCursor: cursor.reviewTaskCursor }),
      },
    );
    if (projection === undefined) {
      throw this.#readBlocked(command.queryId, "assessment-run-not-found");
    }
    const next =
      projection.nextResultCursor === undefined && projection.nextReviewTaskCursor === undefined
        ? undefined
        : encodeC34RunCursor(
            projection.nextResultCursor,
            projection.nextReviewTaskCursor,
            c34RecordCursorAnchor(command, verified),
          );
    return RiskAssessmentReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "run-read",
        actorId: command.actorId,
        runRef: projection.runRef,
        entryMode: projection.entryMode,
        status: projection.status,
        ...(projection.waitingRef === undefined ? {} : { waitingRef: projection.waitingRef }),
        stage: projection.stage,
        graphVersion: projection.graphVersion,
        actorRef: projection.actorRef,
        startedAt: projection.startedAt,
        stateVersion: projection.stateVersion,
        stages: projection.stages,
        resultRefs: projection.resultRefs,
        reviewTaskRefs: projection.reviewTaskRefs,
        assessmentRunRefs: projection.assessmentRunRefs,
        ...(projection.selectedAssessmentRunRef === undefined
          ? {}
          : { selectedAssessmentRunRef: projection.selectedAssessmentRunRef }),
        ...(projection.error === undefined ? {} : { error: projection.error }),
        ...(next === undefined ? {} : { nextCursor: next }),
        actions: await this.#readActions(command, verified, [
          "workflow.resume-run",
          "workflow.cancel-run",
        ]),
      },
    });
  }

  async #readRunProjection(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
    workflowRunRef: WorkflowRunRefV1,
    selection?: {
      readonly assessmentRunRef?: WorkflowRunRefV1;
      readonly resultCursor?: string;
      readonly reviewTaskCursor?: string;
    },
  ) {
    const projection = await this.#runRead.readAssessmentRun({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: await this.#artifactReadAuthorization(
        command,
        workflowGraphInvocationIdV1({
          operation: "run-read",
          projectId: command.projectId,
          targetId: workflowRunRef.reference.entityId,
        }),
        verified,
        "projection.query",
      ),
      workflowRunRef,
      ...(selection?.assessmentRunRef === undefined
        ? {}
        : { assessmentRunRef: selection.assessmentRunRef }),
      ...(selection?.resultCursor === undefined ? {} : { resultCursor: selection.resultCursor }),
      ...(selection?.reviewTaskCursor === undefined
        ? {}
        : { reviewTaskCursor: selection.reviewTaskCursor }),
    });
    if (projection.kind !== "succeeded")
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    return projection.projection;
  }

  // ---------------------------------------------------------------- 冻结事实读取

  async #loadDecisionContext(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
    decisionId: string,
    decisionVersionId: string,
  ): Promise<LoadedDecisionV1 | undefined> {
    let row:
      | { content_artifact_ref: unknown; value_set_id: string; value_set_version_id: string }
      | undefined;
    try {
      row = await this.#db
        .selectFrom("business.assessment_decision_artifacts")
        .select(["content_artifact_ref", "value_set_id", "value_set_version_id"])
        .where("project_id", "=", command.projectId)
        .where("decision_id", "=", decisionId)
        .where("version_id", "=", decisionVersionId)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.decision-artifact");
    }
    if (row === undefined) return undefined;
    const artifactRef = ContentArtifactRefV1Schema.safeParse(row.content_artifact_ref);
    if (!artifactRef.success) return undefined;
    const body = await this.#openReadArtifact(command, verified, artifactRef.data);
    if (body === undefined) return undefined;
    const decision = AssessmentDecisionArtifactV1Schema.safeParse(body);
    if (!decision.success) return undefined;
    return { decision: decision.data };
  }

  /**
   * 指标实际取值集：取值集正文即该登记行的业务列，解析失败即失败闭合，
   * 绝不用空取值集冒充「没有指标」。
   */
  async #readValueSet(
    command: RiskAssessmentReadQueryV1,
    row: { readonly value_set_id: string; readonly value_set_version_id: string },
  ): Promise<LoadedValueSetV1 | undefined> {
    let stored: { readonly value_set_payload: unknown } | undefined;
    try {
      stored = await this.#db
        .selectFrom("business.indicator_actual_value_sets")
        .select(["value_set_payload"])
        .where("project_id", "=", command.projectId)
        .where("value_set_id", "=", row.value_set_id)
        .where("version_id", "=", row.value_set_version_id)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.value-set");
    }
    if (stored === undefined) return undefined;
    const values = IndicatorActualValueSetV1Schema.safeParse(stored.value_set_payload);
    return values.success ? { values: values.data } : undefined;
  }

  /** 输入快照登记行：只取准备快照的精确引用，正文另行按该引用读取。 */
  async #readInputSnapshotForRecord(
    command: RiskAssessmentReadQueryV1,
    row: {
      readonly input_snapshot_id: string;
      readonly input_snapshot_version_id: string;
      readonly input_snapshot_ref: unknown;
    },
  ): Promise<
    | {
        readonly preparationRef: ContractReferenceV1;
        readonly inputSnapshotRef: ContractReferenceV1;
      }
    | undefined
  > {
    let stored: Selectable<AssessmentInputSnapshotRow> | undefined;
    try {
      stored = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("input_snapshot_id", "=", row.input_snapshot_id)
        .where("version_id", "=", row.input_snapshot_version_id)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.input-snapshot");
    }
    if (stored === undefined) return undefined;
    const preparationRef = ContractReferenceV1Schema.safeParse(stored.preparation_snapshot_ref);
    if (!preparationRef.success) return undefined;
    // 输入快照的精确引用登记在记录行上（`input_snapshot_ref`），不由本读面拼装。
    const inputRef = ContractReferenceV1Schema.safeParse(row.input_snapshot_ref);
    if (!inputRef.success) return undefined;
    return { preparationRef: preparationRef.data, inputSnapshotRef: inputRef.data };
  }

  async #readPreparationSnapshot(
    command: RiskAssessmentReadQueryV1,
    preparationRef: ContractReferenceV1,
  ): Promise<Selectable<AssessmentPreparationSnapshotRow> | undefined> {
    // 只接受准备快照这一种引用：其它 kind 的引用不是本读面的目标，不做宽松匹配。
    if (preparationRef.kind !== "assessment-preparation-snapshot") return undefined;
    try {
      const row = await this.#db
        .selectFrom("business.assessment_preparation_snapshots")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("snapshot_id", "=", preparationRef.reference.entityId)
        .where("version_id", "=", preparationRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      return AssessmentPreparationSnapshotV1Schema.safeParse(row.snapshot_payload).success
        ? row
        : undefined;
    } catch (error) {
      throw mapPostgresError(error, "risk-assessment.read.preparation-snapshot");
    }
  }

  /** C04 受权有界读取：用途码与能力沿用决策工件自身，失败一律关闭而不是返回空正文。 */
  async #openReadArtifact(
    command: RiskAssessmentReadQueryV1,
    verified: AuthorizationContextV1,
    artifactRef: ContentArtifactRefV1,
  ): Promise<unknown | undefined> {
    // 一次查询可能读多份正文，幂等键必须逐份唯一，否则第二份会被判同键异载荷。
    const identity = `${command.queryId}:read:${artifactRef.reference.entityId}:${artifactRef.reference.versionId}`;
    const readWith = async (
      authorization: AuthorizationContextV1,
    ): Promise<unknown | undefined> => {
      const handle = await this.#artifactStore
        .open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
            requestId: identity,
            idempotencyKey: identity,
            artifactRef,
            projectId: command.projectId,
            actorId: command.actorId,
            requestedAt: command.requestedAt,
            purposeCode: RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
            requiredCapability: "risk-assessment.read",
            authorization,
          }),
        )
        .catch(() => {
          throw new RiskAssessmentReadFailure(this.#readDenied(command));
        });
      return handle === undefined ? undefined : await readArtifactJson(handle);
    };
    return readWith(await this.#artifactReadAuthorization(command, identity, verified));
  }

  /** 读取身份独立签发，空间与来源上限保持调用方已复验范围。 */
  async #artifactReadAuthorization(
    command: RiskAssessmentReadQueryV1,
    invocationId: string,
    verified: AuthorizationContextV1,
    branch: "risk-assessment.read" | "projection.query" = "risk-assessment.read",
  ): Promise<AuthorizationContextV1> {
    const scope = verified.spatialScopeRefs[0];
    if (scope === undefined) throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const sources = await this.#entryContext.readAuthorizedSourceVersions({
      kind: "read-assessment-entry-source-versions",
      queryId: command.queryId,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      authorization: verified,
      payload: { spatialScopeRef: scope },
    });
    if (sources.kind !== "succeeded")
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    const authorization = await this.#authorizeFor(
      {
        branch,
        invocationId,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
        requestedSpatialScopeRefs: verified.spatialScopeRefs,
        requestedSourceVersionRefs: sources.result.sourceVersionRefs,
      },
      branch,
    ).catch(() => {
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    });
    // 能力由独立 branch 签发/复验；这里只比较主体、策略、空间与来源上限。
    if (
      !isAuthorizationSubset(
        { ...verified, grantedCapabilities: authorization.grantedCapabilities },
        authorization,
      )
    )
      throw new RiskAssessmentReadFailure(this.#readDenied(command));
    return authorization;
  }

  /**
   * 读面失败闭合：`blockerKind` 给出稳定的详情码，`blockerRef` 按 `<查询身份>:<详情码>`
   * 编码同一事实，让调用方既拿到类型化错误，也能在不解析正文的前提下定位到具体读操作。
   */
  #readBlocked(causalRunId: string, detailCode: string, blockerEntityId?: string): ModuleErrorV1 {
    return moduleError("BUSINESS_BLOCKED", causalRunId, {
      blockerKind: detailCode,
      blockerRef: {
        kind: "project-revision",
        reference: {
          entityId: blockerEntityId ?? `${causalRunId}:${detailCode}`,
          versionId: "1",
        },
      },
    });
  }
}

/** C34 读面内部的失败闭合载体：把已定型的模块错误原样带出，不在分派层重新解释。 */
class RiskAssessmentReadFailure extends Error {
  readonly error: ModuleErrorV1;

  constructor(error: ModuleErrorV1) {
    super(`risk-assessment read failed: ${error.code}`);
    this.name = "RiskAssessmentReadFailure";
    this.error = error;
  }
}

interface PendingCandidatePageV1 {
  readonly items: readonly {
    readonly riskInput: RiskInputVersionRefV1;
    readonly riskInputKey: string;
    readonly spatialScopeRefs: SpatialScopeRefV1[];
    readonly evidenceReferences: PendingRiskItemV1["evidenceReferences"];
  }[];
  readonly nextCursor: string | undefined;
}

interface LoadedDecisionV1 {
  readonly decision: AssessmentDecisionArtifactV1;
}

interface LoadedValueSetV1 {
  readonly values: IndicatorActualValueSetV1;
}

async function readArtifactJson(handle: ArtifactReadHandleV1): Promise<unknown | undefined> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of handle.content) {
    byteLength += chunk.byteLength;
    if (byteLength > RISK_ASSESSMENT_MAX_ARTIFACT_BYTES_V1) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown;
  } catch {
    return undefined;
  }
}

type C34RecordCursorV1 = {
  readonly anchor: string;
  readonly afterOccurredAt: string;
  readonly afterEntityId: string;
  readonly afterVersionId: string;
};

const c34RecordCursorAnchor = (
  command: RiskAssessmentReadQueryV1,
  verified: AuthorizationContextV1,
): string =>
  sha256CanonicalJson({
    projectId: command.projectId,
    filters: Object.fromEntries(
      Object.entries(command.payload).filter(
        ([key]) => key !== "cursor" && !key.endsWith("Cursor") && key !== "pageSize",
      ),
    ),
    spatialScopeRefs: verified.spatialScopeRefs.map(refKey).sort(),
    sourceAccessGrantRefs: verified.sourceAccessGrantRefs.map(refKey).sort(),
  });

const encodeC34RecordCursor = (
  row: Selectable<RiskAssessmentRecordRow>,
  command: RiskAssessmentReadQueryV1,
  verified: AuthorizationContextV1,
): string =>
  Buffer.from(
    JSON.stringify({
      anchor: c34RecordCursorAnchor(command, verified),
      afterOccurredAt: asIso(row.occurred_at),
      afterEntityId: row.record_id,
      afterVersionId: row.version_id,
    }),
    "utf8",
  ).toString("base64url");

const decodeC34RecordCursor = (
  cursor: string | undefined,
  command: RiskAssessmentReadQueryV1,
  verified: AuthorizationContextV1,
): C34RecordCursorV1 | undefined | null => {
  if (cursor === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (
      Object.keys(value).length !== 4 ||
      value.anchor !== c34RecordCursorAnchor(command, verified) ||
      typeof value.afterOccurredAt !== "string" ||
      !Number.isFinite(Date.parse(value.afterOccurredAt)) ||
      typeof value.afterEntityId !== "string" ||
      value.afterEntityId.length === 0 ||
      typeof value.afterVersionId !== "string" ||
      value.afterVersionId.length === 0
    )
      return null;
    return value as C34RecordCursorV1;
  } catch {
    return null;
  }
};

/**
 * 运行面的结果引用与复核任务各自独立分页，但公共结果只给一个 `nextCursor`。
 * 这里把两个上游游标编码进同一个不透明字符串：读侧只把它当游标转手，不解释其结构。
 */
const encodeC34RunCursor = (
  resultCursor: string | undefined,
  reviewTaskCursor: string | undefined,
  anchor: string,
): string =>
  Buffer.from(
    JSON.stringify({
      anchor,
      ...(resultCursor === undefined ? {} : { r: resultCursor }),
      ...(reviewTaskCursor === undefined ? {} : { t: reviewTaskCursor }),
    }),
    "utf8",
  ).toString("base64url");

const decodeC34RunCursor = (
  resultCursor: string | undefined,
  reviewTaskCursor: string | undefined,
  anchor: string,
): { readonly resultCursor?: string; readonly reviewTaskCursor?: string } | undefined => {
  const merge = (cursor: string | undefined) => {
    if (cursor === undefined) return {};
    try {
      const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const parsed = value as Record<string, unknown>;
      if (
        parsed.anchor !== anchor ||
        Object.keys(parsed).some((key) => !["anchor", "r", "t"].includes(key)) ||
        [parsed.r, parsed.t].some(
          (offset) =>
            offset !== undefined &&
            (typeof offset !== "string" || !/^(0|[1-9][0-9]*)$/.test(offset)),
        )
      )
        return null;
      return {
        ...(typeof parsed.r === "string" ? { resultCursor: parsed.r } : {}),
        ...(typeof parsed.t === "string" ? { reviewTaskCursor: parsed.t } : {}),
      };
    } catch {
      return null;
    }
  };
  const fromResult = merge(resultCursor);
  const fromReview = merge(reviewTaskCursor);
  if (fromResult === null || fromReview === null) return undefined;
  return { ...fromResult, ...fromReview };
};

export const createPostgresRiskAssessmentEngine = (
  options: PostgresRiskAssessmentEngineOptionsV1,
): PostgresRiskAssessmentEngine => new PostgresRiskAssessmentEngine(options);

export type { RiskAssessmentDatabase };
