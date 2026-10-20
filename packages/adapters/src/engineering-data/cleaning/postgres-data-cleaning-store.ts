import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";

import type {
  AgentTaskRefV1,
  AgentTaskResultRefV1,
  ContentArtifactRefV1,
  EngineeringFreezeCommandV1,
  EngineeringFreezeResultV1,
  IdentificationPreparationSnapshotRefV1,
  MonitoringSeriesRefV1,
  MonitoringSnapshotRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
  StartAgentTaskCommandV1,
  StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  ContentArtifactRefV1Schema,
  EngineeringFreezeResultV1Schema,
  EngineeringFreezeCommandV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  MonitoringSeriesRefV1Schema,
  RouteDecisionRefV1Schema,
  type RouteDecisionRefV1,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  StartAgentTaskResultV1Schema,
  StructuredDocumentConversionRefV1Schema,
} from "@riskflow/contracts/ports";
import {
  IdentificationPreparationSnapshotV1Schema,
  type IdentificationPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";
import { canonicalJson, sha256CanonicalJson, type JsonValue } from "@riskflow/core/persistence";
import type {
  AtomicCommitV1,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import type {
  AgentDomainToolExecutionContextV1,
  AgentDomainToolResultV1,
  AgentTaskDefinitionV1,
  AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import {
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
} from "@riskflow/core/agent-runtime";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import type {
  ArtifactReadHandleV1,
  ArtifactReferenceGuardV1,
  ArtifactRefV1,
  ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ArtifactReadRequestV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactRefV1Schema,
} from "@riskflow/core/artifacts";
import {
  CleaningPreparationManifestV1Schema,
  DataCleaningAvailabilityV1Schema,
  DataCleaningCandidateV1Schema,
  DataCleaningFrozenInputV1Schema,
  DataCleaningPolicySchema,
  DataCleaningResultV1Schema,
  createDataCleaningTaskDefinition,
  type CleaningPreparationManifestV1,
  type DataCleaningCandidateV1,
  type DataCleaningDocumentSliceRequestV1,
  type DataCleaningFrozenDocumentV1,
  type DataCleaningExclusionDecisionV1,
  type DataCleaningFrozenInputV1,
  type DataCleaningInputStatusV1,
  type DataCleaningFrozenMonitoringV1,
  type DataCleaningFrozenSegmentV1,
  type DataCleaningMonitoringSliceRequestV1,
  type DataCleaningPolicy,
  type DataCleaningPreparationCatalogSliceRequestV1,
  type DataCleaningResultV1,
  type DataCleaningSettlementV1,
  type DataCleaningTaskPortV1,
  type DataCleaningValidationViewV1,
} from "@riskflow/core/engineering-data/cleaning";
import {
  MonitoringSampleVersionRefV1Schema,
  SourceSegmentIdV1Schema,
} from "@riskflow/contracts/engineering-workspace";
import {
  SourceSegmentKindV1Schema,
  SourceSegmentLocatorV1Schema,
} from "@riskflow/core/engineering-data/context-source";
import {
  STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1,
  StructuredDocumentJsonLdV1Schema,
  type StructuredDocumentJsonLdV1,
} from "@riskflow/core/engineering-data/document-conversion";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import { makePersistenceError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import type { PostgresMonitoringStoreV1 } from "../monitoring/postgres-monitoring-store.js";

const SCHEMA_VERSION = "1" as const;
const RESULT_COMMAND_KIND = "engineering-data.data-cleaning-result.v1";
const PREPARATION_COMMAND_KIND = "engineering-data.identification-preparation.v1";
const MANIFEST_PURPOSE = "engineering-data.data-cleaning-preparation-manifest";
/** C04 读取按工件自身的 purposeCode 授权，C12 的 JSON-LD 必须用其写入时的用途码读取。 */
const CONVERSION_PURPOSE = "engineering-data.structured-document-conversion";
const DECISION_PURPOSE = "engineering-data.data-cleaning-decision";
const OBSERVATION_PURPOSE = "engineering-data.data-cleaning-observation";
/** C08 `recordCandidate` 以该用途码复验校验工件，必须与运行时一致。 */
const VALIDATION_PURPOSE = "agent-validation";
const RESULT_PURPOSE = "engineering-data.data-cleaning-result";
const PREPARATION_BRANCH = "engineering-data.identification-preparation" as const;
const EVIDENCE_ACCESS_BRANCH = "engineering-data.evidence-access" as const;
const MONITORING_BRANCH = "engineering-data.monitoring-snapshot" as const;
const FREEZE_CAPABILITY = "engineering-data.freeze" as const;
const MAX_MANIFEST_BYTES = 1_048_576;

const tableImageLookup = (document: StructuredDocumentJsonLdV1) => {
  const fields = document.tableFields ?? [];
  const fieldsById = new Map(fields.map((field) => [field.fieldId, field]));
  const blocksById = new Map(document.textBlocks.map((block) => [block.blockId, block]));
  const imagesByTable = new Map<string, typeof fields>();
  for (const field of fields)
    if (field.unrecognizedImages !== undefined) {
      const images = imagesByTable.get(field.tableId) ?? [];
      images.push(field);
      imagesByTable.set(field.tableId, images);
    }
  return (blockIds: readonly string[]) => {
    const tableIds = new Set(
      blockIds.flatMap((id) => {
        const block = blocksById.get(id);
        const field =
          block === undefined ? undefined : fieldsById.get(`field-${block.sourceBlockId}`);
        return field === undefined ? [] : [field.tableId];
      }),
    );
    return [...tableIds].flatMap((id) => imagesByTable.get(id) ?? []);
  };
};
const MAX_OBSERVATION_BYTES = 4_194_304;

/** 冻结准备命令的稳定身份，读写事实与授权都从它派生。 */
interface CleaningCommandContext {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly authorization: EngineeringFreezeCommandV1["authorization"];
}

interface ConversionRow {
  conversion_id: string;
  version_id: string;
  project_id: string;
  status: string;
  input_kind: string;
  source_version_ref: unknown;
  conversion_policy_ref: unknown;
  quality_policy_ref: unknown;
  converter_deployment_ref: unknown;
  jsonld_artifact_ref: unknown;
  source_segment_set_ref: unknown;
}

interface SegmentRow {
  source_segment_id: string;
  project_id: string;
  source_version_id: string;
  source_segment_set_id: string;
  kind: string;
  locator: unknown;
}

interface SnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  monitoring_series_ref: unknown;
  sample_version_refs: unknown;
  availability: string;
  coverage_ratio: number;
  availability_reasons: unknown;
}

interface SnapshotMemberRow {
  project_id: string;
  snapshot_id: string;
  member_index: number;
  sample_version_id: string;
  selection_reason: string;
}

interface SnapshotPointRow {
  project_id: string;
  snapshot_id: string;
  point_index: number;
  sampled_at: Date | string;
  status: string;
  source_sample_refs: unknown;
}

interface SampleVersionRow {
  project_id: string;
  sample_version_id: string;
  version_id: string;
  source_sample_key: string;
  sampled_at: Date | string;
  value: number;
  unit: string;
  canonical_value: number;
  canonical_unit: string;
  relation_kind: string;
  evidence_references: unknown;
  source_version_ref: unknown;
  source_segment_set_ref: unknown;
}

interface AgentTaskRow {
  agent_task_id: string;
  status: string;
}

interface DataCleaningResultRow {
  result_id: string;
  version_id: string;
  project_id: string;
  agent_task_ref: unknown;
  result_artifact_ref: unknown;
  manifest_artifact_ref: unknown;
  result_payload: unknown;
}

interface PreparationSnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  snapshot_ref: unknown;
  snapshot_payload: unknown;
  agent_task_ref: unknown;
  cleaning_result_artifact_ref: unknown;
}

type CleaningDatabase = PostgresDatabase & {
  "business.structured_document_conversions": ConversionRow;
  "business.source_segments": SegmentRow;
  "business.monitoring_snapshots": SnapshotRow;
  "business.monitoring_snapshot_members": SnapshotMemberRow;
  "business.monitoring_snapshot_points": SnapshotPointRow;
  "business.monitoring_sample_versions": SampleVersionRow;
  "business.agent_tasks": AgentTaskRow;
  "business.data_cleaning_results": DataCleaningResultRow;
  "business.identification_preparation_snapshots": PreparationSnapshotRow;
};

type CleaningTransaction = Transaction<CleaningDatabase>;

/**
 * 启动接缝的输入：C15 只提交缺少 `authorization` 的 C08 启动草案，以及冻结命令的精确
 * 空间/资料范围。授权上下文由组合根经 C06 签发，store 不持有也不能扩写 capability。
 */
export interface DataCleaningAgentTaskStartRequestV1 {
  readonly command: Omit<StartAgentTaskCommandV1, "authorization">;
  readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
}

export interface DataCleaningTaskReaderV1 {
  getTask(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined>;
}

export interface PostgresDataCleaningStoreOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly monitoringStore: PostgresMonitoringStoreV1;
  readonly startAgentTask: (
    request: DataCleaningAgentTaskStartRequestV1,
  ) => Promise<StartAgentTaskResultV1>;
  readonly policy: DataCleaningPolicy;
  readonly now?: () => Date;
}

/**
 * 精确准备读取（D-02）的输入：调用方提交自身命令身份、当前授权上下文与精确准备快照引用。
 * 没有列表、搜索、名称或“最新值”参数，目标只在方法内部按引用定位。
 */
export interface IdentificationPreparationReadRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly authorization: EngineeringFreezeCommandV1["authorization"];
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
}

/**
 * 精确准备读取的结果：成功只含 strict 准备聚合、其绑定任务、strict 清洗结果与结果工件引用；
 * 失败是统一不可枚举的授权拒绝（缺失/跨工程/撤权/未授权/绑定失配同形），瞬时技术失败保留
 * 可重试语义。
 */
export type IdentificationPreparationReadResultV1 =
  | {
      readonly kind: "ok";
      readonly snapshot: IdentificationPreparationSnapshotV1;
      readonly agentTaskRef: AgentTaskRefV1;
      readonly result: DataCleaningResultV1;
      readonly resultArtifactRef: ContentArtifactRefV1;
    }
  | { readonly kind: "error"; readonly error: Record<string, unknown> };

/**
 * 只读接缝输入：调用方提交自身命令身份与授权上下文，C15 按当前事实复验后再读取绑定结果。
 * 无 project/name/“最新”参数，不能枚举目标。
 */
export interface DataCleaningBoundResultReadRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly authorization: EngineeringFreezeCommandV1["authorization"];
  readonly taskRef: AgentTaskRefV1;
}

/**
 * 只读接缝结果：成功只含绑定结果与精确工件引用；失败是统一的不可枚举类型化拒绝
 * （缺失/跨工程/撤权/未授权同一形状），瞬时故障保持可重试语义。
 */
export type DataCleaningBoundResultReadResultV1 =
  | {
      readonly kind: "ok";
      readonly result: DataCleaningResultV1;
      readonly resultArtifactRef: ContentArtifactRefV1;
    }
  | { readonly kind: "error"; readonly error: Record<string, unknown> };

const asTransaction = (context: TransactionContextV1): CleaningTransaction =>
  getPostgresTransaction(context) as unknown as CleaningTransaction;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const referenceKey = (value: { reference: { entityId: string; versionId: string } }): string =>
  `${value.reference.entityId}@${value.reference.versionId}`;

const sameVersion = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

/**
 * C04 工件读写只接受调用方上下文自带的能力。C06 每个上下文只签发一个 capability：冻结准备
 * 用 `engineering-data.freeze`，任务读写用 C06 为 `agent-task.start-task` 签发的
 * `agent-task.start`，因此这里不能再写死冻结能力。
 */
const authorizedCapability = (
  authorization: EngineeringFreezeCommandV1["authorization"],
): EngineeringFreezeCommandV1["authorization"]["grantedCapabilities"][number] =>
  authorization.grantedCapabilities[0]!;

const artifactSortKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}) => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

/** 已知的集合外与工具上限边界定型为非重试错误，避免未知异常缺省分类掩盖拒绝原因。 */
const sliceRejection = (
  task: AgentTaskSnapshotV1,
  stage: string,
  code: "AGENT_INPUT_INVALID" | "AGENT_TOOL_LIMIT_EXCEEDED",
): AgentRuntimeError =>
  new AgentRuntimeError(
    makeAgentError({
      code,
      category: code === "AGENT_TOOL_LIMIT_EXCEEDED" ? "tool" : "input",
      retryable: false,
      stage,
      taskRef: task.envelope.agentTaskRef,
    }),
  );

const one = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

const diagnosticRef = (causalRunId: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: {
    entityId: `data-cleaning-failure-${causalRunId}`,
    versionId: `sha256:${sha256CanonicalJson({ causalRunId })}`,
  },
});

const moduleError = (
  code:
    | "AUTHORIZATION_DENIED"
    | "IDEMPOTENCY_CONFLICT"
    | "BUSINESS_BLOCKED"
    | "UNSUPPORTED_CONTRACT"
    | "TRANSIENT_FAILURE"
    | "TERMINAL_FAILURE",
  causalRunId: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> => {
  const common = {
    stageCode: "engineering-data.data-cleaning",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: FREEZE_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      ...extras,
    };
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return {
      ...common,
      code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: causalRunId,
      priorCommandId: causalRunId,
      ...extras,
    };
  }
  if (code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "data-cleaning-preparation",
      blockerRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    };
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: false,
      schemaVersion: SCHEMA_VERSION,
      ...extras,
    };
  }
  if (code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
      diagnosticRef: diagnosticRef(causalRunId),
      ...extras,
    };
  }
  return {
    ...common,
    code,
    category: "technical",
    retryable: false,
    diagnosticRef: diagnosticRef(causalRunId),
    ...extras,
  };
};

/** C06 在事务内抛出的是裸错误，事务外则被包装；两种情况都必须映射为授权失败。 */
const resolveAccessFailure = (error: unknown): AccessServiceError | undefined => {
  if (error instanceof AccessServiceError) return error;
  if (!(error instanceof Error)) return undefined;
  const wrapped = (error as Error & { accessError?: unknown }).accessError;
  if (wrapped instanceof AccessServiceError) return wrapped;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof AccessServiceError ? cause : undefined;
};

const failed = (error: Record<string, unknown>): EngineeringFreezeResultV1 =>
  EngineeringFreezeResultV1Schema.parse({ kind: "failed", error });

/** 缺失、跨工程、撤权与未授权共用的不可枚举拒绝（D-02 与 C19 读取接缝共用）。 */
function boundResultDenied(causalRunId: string): never {
  throw Object.assign(new Error("data cleaning bound result is unavailable"), {
    dataCleaningError: moduleError("AUTHORIZATION_DENIED", causalRunId),
  });
}

/**
 * C15 数据清洗与识别准备收口的事实存储：组合 C03 事务、C04 工件、C08 任务、
 * C11 资料授权、C12/C13 转换记录与 C14 冻结快照，只在 C15 自有文件内实现。
 */
/**
 * 与某 subject 相关的正式清洗结果投影（design D-06）。
 *
 * 只含所选输入的可用性事实与结果引用；不复制清洗模型，也不展开整体结果正文。
 */
export interface DataCleaningResultForSubjectV1 {
  readonly resultRef: RouteDecisionRefV1;
  readonly policyRef: VersionReference;
  readonly recordedAt: string;
  readonly input: DataCleaningInputStatusV1;
}

const sameRef = (
  left:
    { readonly reference: { readonly entityId: string; readonly versionId: string } } | undefined,
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left !== undefined &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const inputMatchesSubject = (
  input: DataCleaningInputStatusV1,
  subject:
    | { readonly sourceVersionRef: SourceVersionRefV1 }
    | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] },
): boolean => {
  if ("sourceVersionRef" in subject) {
    return sameRef(input.sourceVersionRef, subject.sourceVersionRef);
  }
  return subject.monitoringSnapshotRefs.some((ref) => sameRef(input.monitoringSnapshotRef, ref));
};

const exclusionMatchesSubject = (
  decision: DataCleaningExclusionDecisionV1,
  subject:
    | { readonly sourceVersionRef: SourceVersionRefV1 }
    | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] },
): boolean => {
  if ("sourceVersionRef" in subject) {
    return sameRef(decision.sourceVersionRef, subject.sourceVersionRef);
  }
  return subject.monitoringSnapshotRefs.some((ref) => sameRef(decision.monitoringSnapshotRef, ref));
};

export class PostgresDataCleaningStore implements DataCleaningTaskPortV1 {
  readonly #db: Kysely<CleaningDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #monitoringStore: PostgresMonitoringStoreV1;
  readonly #startAgentTask: (
    request: DataCleaningAgentTaskStartRequestV1,
  ) => Promise<StartAgentTaskResultV1>;
  readonly #policy: DataCleaningPolicy;
  readonly #now: () => Date;

  constructor(options: PostgresDataCleaningStoreOptions) {
    this.#db = options.db as unknown as Kysely<CleaningDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#artifactGuard = options.artifactReferenceGuard;
    this.#monitoringStore = options.monitoringStore;
    this.#startAgentTask = options.startAgentTask;
    this.#policy = DataCleaningPolicySchema.parse(options.policy);
    this.#now = options.now ?? (() => new Date());
  }

  createTaskDefinition(): AgentTaskDefinitionV1 {
    return createDataCleaningTaskDefinition({ policy: this.#policy, port: this, now: this.#now });
  }

  // -------------------------------------------------------- freeze entry point

  async freezeIdentificationPreparation(
    command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>,
  ): Promise<EngineeringFreezeResultV1> {
    const context: CleaningCommandContext = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization: command.authorization,
    };
    try {
      if (!sameVersion(command.payload.dataProcessingPolicyRef, this.#policy.policyRef)) {
        return failed(
          moduleError("UNSUPPORTED_CONTRACT", command.commandId, { schemaVersion: SCHEMA_VERSION }),
        );
      }
      await this.#verify(
        context,
        PREPARATION_BRANCH,
        command.payload.spatialScopeRefs,
        command.payload.sourceVersionRefs,
      );

      const documents = await this.#resolveDocuments(context, command.payload.sourceVersionRefs);
      if (documents.kind === "error") return failed(documents.error);

      const monitoring = await this.#freezeMonitoring(context, command);
      if (monitoring.kind === "error") return failed(monitoring.error);

      const manifest = CleaningPreparationManifestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        projectId: command.projectId,
        actorId: command.actorId,
        projectRevisionRef: command.payload.projectRevisionRef,
        spatialScopeRefs: command.payload.spatialScopeRefs,
        dataProcessingPolicyRef: command.payload.dataProcessingPolicyRef,
        documents: documents.documents,
        ...(monitoring.monitoring === undefined ? {} : { monitoring: monitoring.monitoring }),
      });
      const digest = sha256CanonicalJson({
        schemaVersion: SCHEMA_VERSION,
        projectId: command.projectId,
        idempotencyKey: command.idempotencyKey,
        manifest,
      });
      const manifestArtifactRef = await this.#putContent(context, {
        artifactId: `data-cleaning-manifest-${digest.slice(0, 40)}`,
        purposeCode: MANIFEST_PURPOSE,
        value: manifest,
        parentArtifactRefs: [],
      });
      const started = await this.#startCleaningTask(context, digest, manifest, manifestArtifactRef);
      if (started.kind === "error") return failed(started.error);
      return await this.#finalizePreparation(
        context,
        command,
        digest,
        manifest,
        manifestArtifactRef,
        started.taskRef,
      );
    } catch (error) {
      return failed(this.#mapError(error, command.commandId));
    }
  }

  // -------------------------------------------------------------- task contract

  async completeIdentificationPreparation(
    command: Extract<EngineeringFreezeCommandV1, { kind: "complete-identification-preparation" }>,
    tasks?: DataCleaningTaskReaderV1,
  ): Promise<EngineeringFreezeResultV1> {
    try {
      const parsed = EngineeringFreezeCommandV1Schema.safeParse(command);
      if (!parsed.success || parsed.data.kind !== "complete-identification-preparation") {
        return failed(moduleError("UNSUPPORTED_CONTRACT", command.commandId));
      }
      const prepared = await this.#readCompletedPreparation(
        command,
        command.payload.agentTaskRef,
        tasks,
      );
      return await this.#finalizePreparation(
        command,
        command,
        prepared.digest,
        prepared.manifest,
        prepared.manifestArtifactRef,
        prepared.task.envelope.agentTaskRef,
      );
    } catch (error) {
      return failed(this.#mapError(error, command.commandId));
    }
  }

  /** 事件组合只获得已验证快照的原受理身份，过期身份不提供执行资格。 */
  async readPreparationCompletionOrigin(
    input: IdentificationPreparationReadRequestV1,
    tasks: DataCleaningTaskReaderV1,
  ): Promise<{
    readonly originalCommandId: string;
    readonly manifestArtifactRef: ContentArtifactRefV1;
    readonly taskAuthorization: EngineeringFreezeCommandV1["authorization"];
  }> {
    const context: CleaningCommandContext = {
      ...input,
      commandId: input.requestId,
      idempotencyKey: input.requestId,
      issuedAt: input.requestedAt,
    };
    await this.#verify(context, "engineering-data.complete-identification-preparation", [], []);
    const row = await this.#db
      .selectFrom("business.identification_preparation_snapshots")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("snapshot_id", "=", input.preparationSnapshotRef.reference.entityId)
      .where("version_id", "=", input.preparationSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) boundResultDenied(input.requestId);
    const prepared = await this.#readCompletedPreparation(
      context,
      AgentTaskRefV1Schema.parse(row.agent_task_ref),
      tasks,
    );
    const snapshot = IdentificationPreparationSnapshotV1Schema.parse(row.snapshot_payload);
    if (
      row.snapshot_id !== `identification-preparation-${prepared.digest.slice(0, 40)}` ||
      !sameVersion(
        ContentArtifactRefV1Schema.parse(row.cleaning_result_artifact_ref).reference,
        prepared.resultArtifactRef.reference,
      ) ||
      !sameVersion(
        snapshot.authorizationContextRef.reference,
        input.authorization.authorizationContextRef.reference,
      )
    )
      boundResultDenied(input.requestId);
    return {
      originalCommandId: prepared.manifest.commandId,
      manifestArtifactRef: prepared.manifestArtifactRef,
      taskAuthorization: prepared.task.envelope.authorization,
    };
  }

  async #readCompletedPreparation(
    context: CleaningCommandContext,
    taskRef: AgentTaskRefV1,
    tasks?: DataCleaningTaskReaderV1,
  ) {
    const branch = "engineering-data.complete-identification-preparation" as const;
    if (context.authorization.invocation.kind !== "human") boundResultDenied(context.commandId);
    await this.#verify(context, branch, [], []);
    const task = await tasks?.getTask(taskRef);
    if (
      task === undefined ||
      task.state.status !== "completed" ||
      task.state.cancelRequested ||
      task.envelope.projectId !== context.projectId ||
      task.envelope.actorId !== context.actorId ||
      task.envelope.taskType !== "data-cleaning" ||
      task.envelope.triggerMode !== "embedded" ||
      canonicalJson(task.envelope.agentTaskRef) !== canonicalJson(taskRef)
    )
      boundResultDenied(context.commandId);
    const agent = this.#policy.agent;
    if (canonicalJson(task.budgetPolicy) !== canonicalJson(agent.budgetPolicy))
      boundResultDenied(context.commandId);
    for (const key of [
      "modelDeploymentRef",
      "promptTemplateRef",
      "toolPolicyRef",
      "budgetPolicyRef",
      "incrementSchemaRef",
      "validationPolicyRef",
    ] as const) {
      if (!sameVersion(task.envelope[key], agent[key])) boundResultDenied(context.commandId);
    }
    const row = await this.#db
      .selectFrom("business.data_cleaning_results")
      .selectAll()
      .where("project_id", "=", context.projectId)
      .where(sql<boolean>`agent_task_ref = ${JSON.stringify(taskRef)}::jsonb`)
      .executeTakeFirst();
    if (row === undefined) boundResultDenied(context.commandId);
    const indexedResult = DataCleaningResultV1Schema.parse(row.result_payload);
    const sourceRefs = indexedResult.inputs.flatMap((input) =>
      input.sourceVersionRef === undefined ? [] : [input.sourceVersionRef],
    );
    await this.#verify(context, branch, indexedResult.spatialScopeRefs, sourceRefs);
    const manifestArtifactRef = ContentArtifactRefV1Schema.parse(row.manifest_artifact_ref);
    if (canonicalJson(manifestArtifactRef) !== canonicalJson(task.envelope.frozenInputRef))
      boundResultDenied(context.commandId);
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await this.#readJson(
        taskRef,
        manifestArtifactRef,
        context.authorization,
        MANIFEST_PURPOSE,
        MAX_MANIFEST_BYTES,
        `${context.commandId}:completion-manifest`,
      ),
    );
    if (
      manifest.projectId !== context.projectId ||
      manifest.actorId !== context.actorId ||
      !sameVersion(manifest.dataProcessingPolicyRef, this.#policy.policyRef)
    )
      boundResultDenied(context.commandId);
    await this.#verify(
      context,
      branch,
      manifest.spatialScopeRefs,
      manifest.documents.map((d) => d.sourceVersionRef),
    );
    const digest = sha256CanonicalJson({
      schemaVersion: SCHEMA_VERSION,
      projectId: manifest.projectId,
      idempotencyKey: manifest.idempotencyKey,
      manifest,
    });
    const bound = await this.#readBoundResult(
      context,
      taskRef,
      `${context.commandId}:completion-result`,
    );
    if (bound.kind === "error") boundResultDenied(context.commandId);
    const result = bound.result;
    if (canonicalJson(result) !== canonicalJson(indexedResult))
      boundResultDenied(context.commandId);
    if (
      result.manifestDigest !== digest ||
      canonicalJson(result.manifestArtifactRef) !== canonicalJson(manifestArtifactRef) ||
      task.state.resultRef === undefined ||
      !("incrementRef" in task.state.resultRef) ||
      canonicalJson(task.state.resultRef.incrementRef) !== canonicalJson(bound.resultArtifactRef) ||
      !sameVersion(result.policyRef, this.#policy.policyRef) ||
      canonicalJson(result.projectRevisionRef) !== canonicalJson(manifest.projectRevisionRef) ||
      canonicalJson(result.spatialScopeRefs) !== canonicalJson(manifest.spatialScopeRefs) ||
      canonicalJson(result.documentConversionRefs) !==
        canonicalJson(manifest.documents.map((d) => d.conversionRef)) ||
      canonicalJson(result.sourceSegmentSetRefs) !==
        canonicalJson(manifest.documents.map((d) => d.sourceSegmentSetRef)) ||
      canonicalJson(result.monitoringSnapshotRef ?? null) !==
        canonicalJson(manifest.monitoring?.monitoringSnapshotRef ?? null)
    )
      boundResultDenied(context.commandId);
    return {
      task,
      manifest,
      manifestArtifactRef,
      digest,
      resultArtifactRef: bound.resultArtifactRef,
    };
  }

  async loadFrozenInput(task: AgentTaskSnapshotV1): Promise<DataCleaningFrozenInputV1> {
    const taskRef = task.envelope.agentTaskRef;
    const authorization = task.envelope.authorization;
    const frozenInputRef = task.envelope.frozenInputRef;
    if (frozenInputRef.kind !== "content-artifact") {
      throw new Error("data cleaning task has no frozen preparation manifest");
    }
    const manifestArtifactRef = ContentArtifactRefV1Schema.parse(frozenInputRef);
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await this.#readJson(
        taskRef,
        manifestArtifactRef,
        authorization,
        MANIFEST_PURPOSE,
        MAX_MANIFEST_BYTES,
      ),
    );
    const documents: DataCleaningFrozenDocumentV1[] = [];
    for (const document of manifest.documents) {
      documents.push(await this.#readFrozenDocument(taskRef, document, authorization));
    }
    const monitoring =
      manifest.monitoring === undefined
        ? undefined
        : await this.#readFrozenMonitoring(
            manifest.projectId,
            manifest.monitoring.monitoringSnapshotRef,
          );
    return DataCleaningFrozenInputV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef,
      manifestDigest: sha256CanonicalJson({
        schemaVersion: SCHEMA_VERSION,
        projectId: manifest.projectId,
        idempotencyKey: manifest.idempotencyKey,
        manifest,
      }),
      agentTaskRef: taskRef,
      policyRef: this.#policy.policyRef,
      documents,
      ...(monitoring === undefined ? {} : { monitoring }),
    });
  }

  /** 读取身份按工件隔离，并复验观察自带的清单引用与任务冻结输入一致，拒绝跨任务观察。 */
  async readModelObservation(
    task: AgentTaskSnapshotV1,
    artifactRef: ArtifactRefV1,
  ): Promise<JsonValue> {
    const taskRef = task.envelope.agentTaskRef;
    const observation = await this.#readJson(
      taskRef,
      artifactRef,
      task.envelope.authorization as EngineeringFreezeCommandV1["authorization"],
      OBSERVATION_PURPOSE,
      MAX_OBSERVATION_BYTES,
      `${taskRef.reference.entityId}:${artifactSortKey(artifactRef)}`,
    );
    const manifestArtifactRef =
      typeof observation === "object" && observation !== null
        ? ContentArtifactRefV1Schema.safeParse(
            (observation as { readonly manifestArtifactRef?: unknown }).manifestArtifactRef,
          )
        : undefined;
    const frozenInputRef = ContentArtifactRefV1Schema.safeParse(task.envelope.frozenInputRef);
    if (
      manifestArtifactRef === undefined ||
      !manifestArtifactRef.success ||
      !frozenInputRef.success ||
      artifactSortKey(manifestArtifactRef.data) !== artifactSortKey(frozenInputRef.data)
    )
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          retryable: false,
          stage: "worker.cleaning.model-observation.scope",
          taskRef,
        }),
      );
    return observation as JsonValue;
  }

  async persistValidationArtifact(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly validation: DataCleaningValidationViewV1;
    readonly settlement: DataCleaningSettlementV1;
  }): Promise<ArtifactRefV1> {
    const value = {
      schemaVersion: SCHEMA_VERSION,
      candidateDigest: sha256CanonicalJson(DataCleaningCandidateV1Schema.parse(input.candidate)),
      validation: input.validation,
      settlement: input.settlement,
    };
    return this.#putContent(taskContext(input.task), {
      artifactId: `data-cleaning-validation-${sha256CanonicalJson(value).slice(0, 40)}`,
      purposeCode: VALIDATION_PURPOSE,
      value,
      parentArtifactRefs: [],
    });
  }

  async persistCleaningResult(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly frozen: DataCleaningFrozenInputV1;
    readonly settlement: DataCleaningSettlementV1;
    readonly validationArtifactRef: ArtifactRefV1;
  }): Promise<AgentTaskResultRefV1> {
    const context = taskContext(input.task);
    const frozen = input.frozen;
    const taskRef = input.task.envelope.agentTaskRef;
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await this.#readJson(
        taskRef,
        frozen.manifestArtifactRef,
        context.authorization,
        MANIFEST_PURPOSE,
        MAX_MANIFEST_BYTES,
      ),
    );
    const result = DataCleaningResultV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef: frozen.manifestArtifactRef,
      manifestDigest: frozen.manifestDigest,
      policyRef: this.#policy.policyRef,
      agentTaskRef: taskRef,
      projectRevisionRef: manifest.projectRevisionRef,
      spatialScopeRefs: manifest.spatialScopeRefs,
      documentConversionRefs: frozen.documents.map((document) => document.conversionRef),
      sourceSegmentSetRefs: frozen.documents.map((document) => document.sourceSegmentSetRef),
      ...(frozen.monitoring === undefined
        ? {}
        : { monitoringSnapshotRef: frozen.monitoring.monitoringSnapshotRef }),
      modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
      promptTemplateRef: this.#policy.agent.promptTemplateRef,
      toolPolicyRef: this.#policy.agent.toolPolicyRef,
      budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
      incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
      validationPolicyRef: this.#policy.agent.validationPolicyRef,
      candidateVersion: DataCleaningCandidateV1Schema.parse(input.candidate).candidateVersion,
      validationArtifactRef: ContentArtifactRefV1Schema.parse(input.validationArtifactRef),
      exclusions: input.settlement.exclusions,
      inputs: input.settlement.inputs,
      overallAvailability: input.settlement.overallAvailability,
      overallCoverageRatio: input.settlement.overallCoverageRatio,
      reasonCodes: input.settlement.reasonCodes,
      formedAt: this.#now().toISOString(),
    });
    const resultArtifactRef = await this.#putContent(context, {
      artifactId: `data-cleaning-result-${frozen.manifestDigest.slice(0, 40)}`,
      purposeCode: RESULT_PURPOSE,
      value: result,
      parentArtifactRefs: [
        frozen.manifestArtifactRef,
        ContentArtifactRefV1Schema.parse(input.validationArtifactRef),
      ],
    });
    await this.#persistResultIndex(context, taskRef, frozen, resultArtifactRef, result);
    return {
      kind: "agent-task-result",
      reference: { entityId: `agent-result:${taskRef.reference.entityId}`, versionId: "1" },
      agentTaskRef: taskRef,
      status: "completed",
      incrementRef: resultArtifactRef,
    } as AgentTaskResultRefV1;
  }

  async readDocumentSlice(
    input: DataCleaningDocumentSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const frozen = await this.loadFrozenInput(context.task);
    const key = referenceKey(input.sourceVersionRef);
    const document = frozen.documents.find((item) => referenceKey(item.sourceVersionRef) === key);
    if (document === undefined) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.document-slice.scope",
        "AGENT_INPUT_INVALID",
      );
    }
    if (input.sourceSegmentIds.length > this.#policy.tools.maxSegmentsPerRead) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.document-slice.limit",
        "AGENT_TOOL_LIMIT_EXCEEDED",
      );
    }
    const requested = new Set<string>(input.sourceSegmentIds);
    const selected = document.segments.filter((segment) => requested.has(segment.sourceSegmentId));
    if (selected.length !== requested.size) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.document-slice.segment",
        "AGENT_INPUT_INVALID",
      );
    }
    const jsonLd = StructuredDocumentJsonLdV1Schema.parse(
      JSON.parse(
        await this.#readBytes(
          context.task.envelope.agentTaskRef,
          document.jsonLdArtifactRef,
          context.task.envelope.authorization,
          CONVERSION_PURPOSE,
          STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1,
        ),
      ) as unknown,
    );
    const blocksById = new Map(jsonLd.textBlocks.map((block) => [block.blockId, block]));
    const evidenceBySegment = new Map(
      jsonLd.evidenceFragments.map((fragment) => [fragment.sourceSegmentId, fragment]),
    );
    const protectedKinds = new Set<string>(this.#policy.protectedSegmentKinds);
    let imageObjects = 0;
    const imagesForBlocks = tableImageLookup(jsonLd);
    const tableImages = new Map(
      selected.map((segment) => {
        const fields = imagesForBlocks(segment.textBlockIds);
        imageObjects += fields.reduce(
          (sum, field) => sum + 1 + field.unrecognizedImages!.length,
          0,
        );
        return [segment.sourceSegmentId, fields];
      }),
    );
    if (selected.length + imageObjects > this.#policy.agent.budgetPolicy.maxObjects)
      throw sliceRejection(
        context.task,
        "worker.cleaning.document-slice.limit",
        "AGENT_TOOL_LIMIT_EXCEEDED",
      );
    const observation = {
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef: frozen.manifestArtifactRef,
      sourceVersionRef: document.sourceVersionRef,
      conversionRef: document.conversionRef,
      jsonLdArtifactRef: document.jsonLdArtifactRef,
      sourceSegmentSetRef: document.sourceSegmentSetRef,
      inputKind: document.inputKind,
      segments: selected.map((segment) => {
        const fragment = evidenceBySegment.get(segment.sourceSegmentId);
        const blocks = (fragment?.textBlockIds ?? segment.textBlockIds)
          .map((blockId) => blocksById.get(blockId))
          .flatMap((block) => (block === undefined ? [] : [block]));
        return {
          sourceSegmentId: segment.sourceSegmentId,
          kind: segment.kind,
          locator: segment.locator,
          numericProtection: protectedKinds.has(segment.kind) ? "protected" : "exposable",
          ...((tableImages.get(segment.sourceSegmentId)?.length ?? 0) === 0
            ? {}
            : {
                unrecognizedTableCells: tableImages.get(segment.sourceSegmentId)!.map((field) => ({
                  fieldId: field.fieldId,
                  tableId: field.tableId,
                  sheet: field.sheet,
                  row: field.row,
                  column: field.column,
                  ...(field.mergedRange === undefined ? {} : { mergedRange: field.mergedRange }),
                  unrecognizedImages: field.unrecognizedImages,
                })),
              }),
          textBlocks: blocks.map((block) => ({
            blockId: block.blockId,
            text: block.text,
            ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
          })),
        };
      }),
    };
    const inputBytes = Buffer.byteLength(canonicalJson(input));
    const outputBytes = Buffer.byteLength(canonicalJson(observation));
    if (
      outputBytes >
        Math.min(MAX_OBSERVATION_BYTES, this.#policy.agent.budgetPolicy.maxOutputBytes) ||
      inputBytes > this.#policy.agent.budgetPolicy.maxInputBytes
    )
      throw sliceRejection(
        context.task,
        "worker.cleaning.document-slice.limit",
        "AGENT_TOOL_LIMIT_EXCEEDED",
      );
    const observationRef = await this.#putDiagnostic(taskContext(context.task), {
      artifactId: `${context.actionId}:document-slice`,
      purposeCode: OBSERVATION_PURPOSE,
      value: observation,
      parentArtifactRefs: [frozen.manifestArtifactRef, document.jsonLdArtifactRef],
    });
    return {
      observationArtifactRef: observationRef,
      effect: "none",
      usage: {
        ...emptyAgentBudgetUsage(),
        objects: selected.length + imageObjects,
        inputBytes,
        outputBytes,
      },
    };
  }

  async readMonitoringSlice(
    input: DataCleaningMonitoringSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const frozen = await this.loadFrozenInput(context.task);
    const monitoring = frozen.monitoring;
    if (monitoring === undefined) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.monitoring-slice.scope",
        "AGENT_INPUT_INVALID",
      );
    }
    if (
      referenceKey(input.monitoringSnapshotRef) !== referenceKey(monitoring.monitoringSnapshotRef)
    ) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.monitoring-slice.scope",
        "AGENT_INPUT_INVALID",
      );
    }
    if (input.sampleVersionRefs.length > this.#policy.tools.maxMonitoringItemsPerRead) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.monitoring-slice.limit",
        "AGENT_TOOL_LIMIT_EXCEEDED",
      );
    }
    const requested = new Set(input.sampleVersionRefs.map((ref) => referenceKey(ref)));
    const members = monitoring.members.filter((member) =>
      requested.has(referenceKey(member.sampleVersionRef)),
    );
    if (members.length !== requested.size) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.monitoring-slice.sample",
        "AGENT_INPUT_INVALID",
      );
    }
    const samples = await this.#readSampleVersions(
      context.task.envelope.projectId,
      members.map((member) => member.sampleVersionRef.reference.entityId),
    );
    const observationRef = await this.#putDiagnostic(taskContext(context.task), {
      artifactId: `${context.actionId}:monitoring-slice`,
      purposeCode: OBSERVATION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestArtifactRef: frozen.manifestArtifactRef,
        monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
        availability: monitoring.availability,
        coverageRatio: monitoring.coverageRatio,
        availabilityReasons: monitoring.availabilityReasons,
        members: members.map((member) => ({
          memberIndex: member.memberIndex,
          selectionReason: member.selectionReason,
          sampleVersionRef: member.sampleVersionRef,
        })),
        points: monitoring.pointStatuses.map((point) => ({
          sampledAt: point.sampledAt,
          status: point.status,
          sampleVersionRefs: point.sampleVersionRefs,
        })),
        samples,
      },
      parentArtifactRefs: [frozen.manifestArtifactRef],
    });
    return {
      observationArtifactRef: observationRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: members.length },
    };
  }

  /**
   * 有界定位分页：复用冻结输入，只返回冻结资料内的精确段身份与下一页位置；
   * offset 等于段数时返回空页，越界、集合外或不合法偏移一律按输入边界拒绝。
   */
  async readPreparationCatalogSlice(
    input: DataCleaningPreparationCatalogSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const frozen = await this.loadFrozenInput(context.task);
    const key = referenceKey(input.sourceVersionRef);
    const document = frozen.documents.find((item) => referenceKey(item.sourceVersionRef) === key);
    if (document === undefined) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.preparation-catalog.scope",
        "AGENT_INPUT_INVALID",
      );
    }
    const total = document.segments.length;
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > total) {
      throw sliceRejection(
        context.task,
        "worker.cleaning.preparation-catalog.offset",
        "AGENT_INPUT_INVALID",
      );
    }
    const page = document.segments.slice(
      input.offset,
      input.offset + this.#policy.tools.maxSegmentsPerRead,
    );
    const nextOffset = input.offset + page.length;
    const value = {
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef: frozen.manifestArtifactRef,
      sourceVersionRef: document.sourceVersionRef,
      offset: input.offset,
      totalCount: total,
      segments: page.map((segment) => ({
        sourceSegmentId: segment.sourceSegmentId,
        kind: segment.kind,
      })),
      // 末页不给出 nextOffset，模型据 totalCount 判断该资料已列举完毕。
      ...(nextOffset < total ? { nextOffset } : {}),
    };
    const observationRef = await this.#putDiagnostic(taskContext(context.task), {
      artifactId: `${context.actionId}:preparation-catalog-slice`,
      purposeCode: OBSERVATION_PURPOSE,
      value,
      parentArtifactRefs: [frozen.manifestArtifactRef],
    });
    return {
      observationArtifactRef: observationRef,
      effect: "none",
      usage: {
        ...emptyAgentBudgetUsage(),
        objects: page.length,
        // 与 runner 的通用工具计量同口径：真实输入/输出字节照原预算计账。
        inputBytes: new TextEncoder().encode(canonicalJson(input)).byteLength,
        outputBytes: new TextEncoder().encode(canonicalJson(value)).byteLength,
      },
    };
  }

  // ------------------------------------------------- exact preparation read

  /**
   * 精确准备读取（D-02）：按精确准备引用返回 strict 准备聚合、其绑定任务与清洗结果。结果
   * 索引查询、C04 受权读取与任务—结果绑定复用私有 `#readBoundResult`，不建立第二个结果读取
   * 实现；读取身份按本请求隔离，避免与冻结收口的 C04 访问记录相互占位。
   *
   * 顺序固定：当前授权复验 → 按 project + 准备引用单点读取准备行 → strict parse 准备/
   * 任务/结果引用 → 以快照精确范围复验 C06 → 绑定读取清洗结果 → requestId/规范载荷原子写
   * 完成回执与一条只追加审计（零事件）。缺失、跨工程、撤权、未授权、非 strict payload 与
   * 绑定失配统一为同一不可枚举拒绝；数据库、C04、审计与回执的瞬时故障保持可重试语义。
   */
  async readExactPreparation(
    input: IdentificationPreparationReadRequestV1,
  ): Promise<IdentificationPreparationReadResultV1> {
    const context: CleaningCommandContext = {
      commandId: input.requestId,
      idempotencyKey: `${input.requestId}:read-exact-preparation`,
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: input.requestedAt,
      authorization: input.authorization,
    };
    try {
      const { snapshot, agentTaskRef, preparationResultRef, authorization } =
        await this.#readPreparation(input);
      const bound = await this.#readBoundResult(
        { ...context, authorization },
        agentTaskRef,
        input.requestId,
      );
      if (bound.kind === "error") boundResultDenied(input.requestId);
      if (!sameVersion(preparationResultRef.reference, bound.resultArtifactRef.reference)) {
        boundResultDenied(input.requestId);
      }
      const recordedAt = this.#now().toISOString();
      const accessId = randomUUID();
      await this.#db
        .insertInto("audit.entries")
        .values({
          audit_entry_id: accessId,
          project_id: input.projectId,
          action: "engineering-data.read-identification-preparation",
          target_ref: input.preparationSnapshotRef as unknown as JsonValue,
          actor_ref: input.actorId,
          authorization_context_ref: authorization.authorizationContextRef as unknown as JsonValue,
          occurred_at: input.requestedAt,
          recorded_at: recordedAt,
          persisted_at: sql`clock_timestamp()`,
          version_ref: input.preparationSnapshotRef.reference as unknown as JsonValue,
          command_id: input.requestId,
          idempotency_key: accessId,
          run_id: null,
          thread_id: null,
          reason_ref: null,
        })
        .execute();
      return {
        kind: "ok",
        snapshot,
        agentTaskRef,
        result: bound.result,
        resultArtifactRef: bound.resultArtifactRef,
      };
    } catch (error) {
      const errorCode = (error as Error & { code?: unknown }).code;
      // 工件不可见与行/绑定失配使用相同的拒绝结果。
      if (errorCode === "ARTIFACT_ACCESS_DENIED") {
        return { kind: "error", error: moduleError("AUTHORIZATION_DENIED", input.requestId) };
      }
      return { kind: "error", error: this.#mapError(error, input.requestId) };
    }
  }

  // ----------------------------------------------------------- preparation tail

  async verifyPreparationReference(
    input: IdentificationPreparationReadRequestV1,
  ): Promise<boolean> {
    if (this.#artifactStore.verifyContent === undefined) return false;
    try {
      const { agentTaskRef, preparationResultRef, authorization } = await this.#readPreparation(
        input,
        true,
      );
      const row = await this.#db
        .selectFrom("business.data_cleaning_results")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where(sql<boolean>`agent_task_ref = ${JSON.stringify(agentTaskRef)}::jsonb`)
        .executeTakeFirst();
      if (row === undefined) return false;
      const resultRef = ContentArtifactRefV1Schema.parse(row.result_artifact_ref);
      if (!sameVersion(resultRef.reference, preparationResultRef.reference)) return false;
      return await this.#artifactStore.verifyContent(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: SCHEMA_VERSION,
          requestId: input.requestId,
          idempotencyKey: input.requestId,
          artifactRef: resultRef,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          purposeCode: RESULT_PURPOSE,
          requiredCapability: authorizedCapability(authorization),
          authorization,
        }),
        MAX_MANIFEST_BYTES,
        (bytes) => {
          const result = DataCleaningResultV1Schema.parse(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
          return sameVersion(result.agentTaskRef.reference, agentTaskRef.reference);
        },
      );
    } catch (error) {
      if (
        (error as { dataCleaningError?: { code?: string } }).dataCleaningError?.code ===
        "AUTHORIZATION_DENIED"
      )
        return false;
      if (error instanceof AccessServiceError && error.details.code !== "ACCESS_TRANSIENT_FAILURE")
        return false;
      throw error;
    }
  }

  async #readPreparation(input: IdentificationPreparationReadRequestV1, rejectRedacted = false) {
    if (
      input.projectId !== input.authorization.projectId ||
      input.actorId !== input.authorization.actorId
    ) {
      boundResultDenied(input.requestId);
    }
    // 授权复验先于目标定位：撤销或范围不符时不产生任何可观察的存在性差异。
    await this.#access.verify({
      authorizationContextRef: input.authorization.authorizationContextRef,
      invocationId: input.requestId,
      projectId: input.projectId,
      branch: EVIDENCE_ACCESS_BRANCH,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: input.requestedAt,
    });
    const row = await this.#db
      .selectFrom("business.identification_preparation_snapshots")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("snapshot_id", "=", input.preparationSnapshotRef.reference.entityId)
      .where("version_id", "=", input.preparationSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) boundResultDenied(input.requestId);
    const snapshotRef = IdentificationPreparationSnapshotRefV1Schema.safeParse(row.snapshot_ref);
    const snapshotParsed = IdentificationPreparationSnapshotV1Schema.safeParse(
      row.snapshot_payload,
    );
    const taskRefParsed = AgentTaskRefV1Schema.safeParse(row.agent_task_ref);
    const resultRefParsed = ContentArtifactRefV1Schema.safeParse(row.cleaning_result_artifact_ref);
    if (
      !snapshotRef.success ||
      !sameVersion(snapshotRef.data.reference, input.preparationSnapshotRef.reference) ||
      !snapshotParsed.success ||
      !taskRefParsed.success ||
      !resultRefParsed.success
    ) {
      boundResultDenied(input.requestId);
    }
    const snapshot = snapshotParsed.data;
    const agentTaskRef = taskRefParsed.data;
    const preparationResultRef = resultRefParsed.data;
    // 以快照自身的精确空间/资料范围复验当前授权，拒绝请求范围大于当前授权的读取。
    const exact = await this.#access.verify({
      authorizationContextRef: input.authorization.authorizationContextRef,
      invocationId: input.requestId,
      projectId: input.projectId,
      branch: EVIDENCE_ACCESS_BRANCH,
      requestedSpatialScopeRefs: [...snapshot.spatialScopeRefs],
      requestedSourceVersionRefs: [...snapshot.sourceVersionRefs],
      requestedAt: input.requestedAt,
    });
    if (
      (rejectRedacted && exact.redacted) ||
      exact.context.projectId !== input.projectId ||
      exact.context.actorId !== input.actorId ||
      !sameVersion(
        exact.context.authorizationContextRef.reference,
        input.authorization.authorizationContextRef.reference,
      )
    )
      boundResultDenied(input.requestId);
    return { snapshot, agentTaskRef, preparationResultRef, authorization: exact.context };
  }

  // ------------------------------------------------------ bound result read

  /**
   * 公共只读接缝（IP-11）：固定按 `engineering-data.evidence-access` 复验 C06 后复用私有
   * `#readBoundResult` 的单点查询、strict parse、受权工件读取与任务—结果绑定，再以
   * requestId 关联独立的只追加访问审计。缺失、跨工程、撤权、未授权与绑定
   * 失配统一为同一个不可枚举拒绝；瞬时技术失败保持可重试语义。
   */
  async readBoundResult(
    input: DataCleaningBoundResultReadRequestV1,
  ): Promise<DataCleaningBoundResultReadResultV1> {
    const context: CleaningCommandContext = {
      commandId: input.requestId,
      idempotencyKey: `${input.requestId}:read-bound-result`,
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: input.requestedAt,
      authorization: input.authorization,
    };
    try {
      if (
        input.projectId !== input.authorization.projectId ||
        input.actorId !== input.authorization.actorId
      ) {
        boundResultDenied(input.requestId);
      }
      const decision = await this.#access.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.requestId,
        projectId: input.projectId,
        branch: EVIDENCE_ACCESS_BRANCH,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      const bound = await this.#readBoundResult(
        { ...context, authorization: decision.context },
        input.taskRef,
        input.requestId,
      );
      if (bound.kind === "error") boundResultDenied(input.requestId);
      const accessId = randomUUID();
      await this.#db
        .insertInto("audit.entries")
        .values({
          audit_entry_id: accessId,
          project_id: input.projectId,
          action: "engineering-data.read-data-cleaning-result",
          target_ref: bound.resultArtifactRef as unknown as JsonValue,
          actor_ref: input.actorId,
          authorization_context_ref: decision.context
            .authorizationContextRef as unknown as JsonValue,
          version_ref: bound.resultArtifactRef.reference as unknown as JsonValue,
          occurred_at: input.requestedAt,
          recorded_at: this.#now().toISOString(),
          persisted_at: sql`clock_timestamp()`,
          command_id: input.requestId,
          idempotency_key: accessId,
          run_id: null,
          thread_id: null,
          reason_ref: null,
        })
        .execute();
      return { kind: "ok", result: bound.result, resultArtifactRef: bound.resultArtifactRef };
    } catch (error) {
      return { kind: "error", error: this.#mapError(error, input.requestId) };
    }
  }

  async #finalizePreparation(
    context: CleaningCommandContext,
    command: Extract<
      EngineeringFreezeCommandV1,
      { kind: "identification-preparation" | "complete-identification-preparation" }
    >,
    digest: string,
    manifest: CleaningPreparationManifestV1,
    manifestArtifactRef: ContentArtifactRefV1,
    agentTaskRef: AgentTaskRefV1,
  ): Promise<EngineeringFreezeResultV1> {
    const task = await this.#db
      .selectFrom("business.agent_tasks")
      .select(["status"])
      .where("agent_task_id", "=", agentTaskRef.reference.entityId)
      .executeTakeFirst();
    if (task === undefined) {
      return failed(moduleError("TERMINAL_FAILURE", command.commandId));
    }
    if (task.status !== "completed") {
      return failed(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "data-cleaning-task-incomplete",
          blockerRef: agentTaskRef,
        }),
      );
    }
    const completing = command.kind === "complete-identification-preparation";
    if (completing)
      await this.#verify(
        context,
        "engineering-data.complete-identification-preparation",
        manifest.spatialScopeRefs,
        manifest.documents.map((d) => d.sourceVersionRef),
      );
    const bound = await this.#readBoundResult(
      context,
      agentTaskRef,
      completing ? `${command.commandId}:completion-result` : undefined,
    );
    if (bound.kind === "error") return failed(bound.error);
    const result = bound.result;

    const documentsNonUnavailable = result.inputs.filter(
      (status) =>
        status.inputKind !== "monitoring-snapshot" && status.availability !== "unavailable",
    ).length;
    if (
      documentsNonUnavailable === 0 ||
      documentsNonUnavailable / manifest.documents.length <
        this.#policy.minimumDocumentCoverageRatio
    ) {
      return failed(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "data-cleaning-coverage",
          blockerRef: result.validationArtifactRef,
        }),
      );
    }

    const availabilityByVersion = new Map(
      result.inputs
        .filter((status) => status.sourceVersionRef !== undefined)
        .map((status) => [referenceKey(status.sourceVersionRef!), status.availability] as const),
    );
    const monitoringStatus = result.inputs.find(
      (status) => status.inputKind === "monitoring-snapshot",
    );
    const monitoringSnapshotRef =
      monitoringStatus !== undefined &&
      monitoringStatus.availability !== "unavailable" &&
      manifest.monitoring !== undefined
        ? manifest.monitoring.monitoringSnapshotRef
        : undefined;

    const coverageDecisionArtifactRef = await this.#putContent(context, {
      artifactId: `data-cleaning-coverage-${digest.slice(0, 40)}${completing ? `-${sha256CanonicalJson(command.commandId).slice(0, 24)}` : ""}`,
      purposeCode: DECISION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestDigest: digest,
        cleaningResultArtifactRef: bound.resultArtifactRef,
        overallAvailability: result.overallAvailability,
        overallCoverageRatio: result.overallCoverageRatio,
        documentCoverage: manifest.documents.map((document) => ({
          sourceVersionRef: document.sourceVersionRef,
          availability:
            availabilityByVersion.get(referenceKey(document.sourceVersionRef)) ?? "unavailable",
        })),
        ...(monitoringStatus === undefined
          ? {}
          : {
              monitoring: {
                monitoringSnapshotRef: manifest.monitoring?.monitoringSnapshotRef,
                availability: monitoringStatus.availability,
                reasonCodes: monitoringStatus.reasonCodes,
              },
            }),
        reasonCodes: result.reasonCodes,
      },
      parentArtifactRefs: [manifestArtifactRef, bound.resultArtifactRef],
    });
    const excludedSegmentDecisionArtifactRef = await this.#putContent(context, {
      artifactId: `data-cleaning-exclusions-${digest.slice(0, 40)}${completing ? `-${sha256CanonicalJson(command.commandId).slice(0, 24)}` : ""}`,
      purposeCode: DECISION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestDigest: digest,
        cleaningResultArtifactRef: bound.resultArtifactRef,
        decisions: result.exclusions,
      },
      parentArtifactRefs: [manifestArtifactRef, bound.resultArtifactRef],
    });
    // D-01：C04 内容工件仍是决定内容的唯一正文与精确版本身份；公开快照只保存同版本身份的
    // `route-decision` 投影，因为公共 strict Schema 不接受 `ContentArtifactRefV1` 冒充路由决定。
    const coverageDecisionRef = RouteDecisionRefV1Schema.parse({
      kind: "route-decision",
      reference: coverageDecisionArtifactRef.reference,
    });
    const excludedSegmentDecisionRef = RouteDecisionRefV1Schema.parse({
      kind: "route-decision",
      reference: excludedSegmentDecisionArtifactRef.reference,
    });

    const snapshotRef = {
      kind: "identification-preparation-snapshot" as const,
      reference: { entityId: `identification-preparation-${digest.slice(0, 40)}`, versionId: "1" },
    };
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `audit-${command.commandId}`;
    // 完整快照在进入事务前必须通过公共 strict Schema：route kind、资料段集合、数组等长及
    // 全部既有字段都在这里被校验，不产生无法被下游解析的 `snapshot_payload`。
    const snapshot = IdentificationPreparationSnapshotV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectRevisionRef: manifest.projectRevisionRef,
      spatialScopeRefs: manifest.spatialScopeRefs,
      sourceVersionRefs: manifest.documents.map((document) => document.sourceVersionRef),
      includedSourceSegmentSetRefs: manifest.documents.map(
        (document) => document.sourceSegmentSetRef,
      ),
      excludedSegmentDecisionRefs: [excludedSegmentDecisionRef],
      ...(monitoringSnapshotRef === undefined ? {} : { monitoringSnapshotRef }),
      dataProcessingPolicyRef: this.#policy.policyRef,
      dataProcessingToolRef: this.#policy.agent.toolPolicyRef,
      dataProcessingModelRef: this.#policy.agent.modelDeploymentRef,
      coverageDecisionRef,
      authorizationContextRef: context.authorization.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail" as const,
        reference: { entityId: auditEntryId, versionId: "1" },
      },
      createdBy: context.actorId,
      createdAt: recordedAt,
    });

    await this.#transactionUnit.execute(
      atomicCommandFor(
        context,
        completing
          ? "engineering-data.complete-identification-preparation.v1"
          : PREPARATION_COMMAND_KIND,
        {
          manifestDigest: digest,
          projectRevisionRef: manifest.projectRevisionRef,
          sourceVersionRefs: snapshot.sourceVersionRefs,
        },
      ),
      async (transactionContext) => {
        if (completing)
          await this.#verify(
            context,
            "engineering-data.complete-identification-preparation",
            manifest.spatialScopeRefs,
            manifest.documents.map((d) => d.sourceVersionRef),
          );
        const transaction = asTransaction(transactionContext);
        // 追加表不授予UPDATE；事务锁按精确任务串行化，不修改结果行或隔离级别。
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${context.projectId}:${referenceKey(agentTaskRef)}`}, 0))`.execute(
          transaction,
        );
        await transaction
          .selectFrom("business.data_cleaning_results")
          .select("result_id")
          .where("project_id", "=", context.projectId)
          .where(sql<boolean>`agent_task_ref = ${JSON.stringify(agentTaskRef)}::jsonb`)
          .executeTakeFirstOrThrow();
        const existing = await transaction
          .selectFrom("business.identification_preparation_snapshots")
          .selectAll()
          .where("project_id", "=", context.projectId)
          .where("snapshot_id", "=", snapshotRef.reference.entityId)
          .where("version_id", "=", "1")
          .executeTakeFirst();
        const action = completing
          ? "engineering-data.complete-identification-preparation"
          : "engineering-data.identification-preparation";
        if (existing !== undefined) {
          if (
            canonicalJson(existing.agent_task_ref) !== canonicalJson(agentTaskRef) ||
            canonicalJson(existing.cleaning_result_artifact_ref) !==
              canonicalJson(bound.resultArtifactRef)
          )
            boundResultDenied(command.commandId);
          return {
            resultRef: snapshotRef,
            audit: {
              auditEntryId,
              projectId: context.projectId,
              action,
              targetRef: snapshotRef,
              actorRef: context.actorId,
              authorizationContextRef: context.authorization.authorizationContextRef,
              occurredAt: context.issuedAt,
              recordedAt,
              version: snapshotRef.reference,
              commandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
            },
            events: [],
          } satisfies AtomicCommitV1;
        }
        // 工件 guard 继续校验原 C04 内容工件身份；公开快照只保存上文的 route-decision 投影。
        for (const decisionArtifactRef of [
          coverageDecisionArtifactRef,
          excludedSegmentDecisionArtifactRef,
        ]) {
          await this.#artifactGuard.assertUsable(transactionContext, {
            schemaVersion: SCHEMA_VERSION,
            artifactRef: decisionArtifactRef,
            projectId: context.projectId,
            purposeCode: DECISION_PURPOSE,
            requiredCapability: authorizedCapability(context.authorization),
            authorization: context.authorization,
          });
        }
        const inserted = await transaction
          .insertInto("business.identification_preparation_snapshots")
          .values({
            snapshot_id: snapshotRef.reference.entityId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            command_kind: PREPARATION_COMMAND_KIND,
            project_id: context.projectId,
            command_id: command.commandId,
            idempotency_key: command.idempotencyKey,
            payload_hash: digest,
            agent_task_ref: agentTaskRef,
            cleaning_result_artifact_ref: bound.resultArtifactRef,
            snapshot_ref: snapshotRef,
            snapshot_payload: snapshot,
            audit_entry_id: auditEntryId,
          } as never)
          .onConflict((conflict) => conflict.columns(["snapshot_id", "version_id"]).doNothing())
          .returning("snapshot_id")
          .executeTakeFirst();
        // repeatable-read 中等待锁的并发事务可能看不到首次提交；重投重新读取正式快照。
        if (inserted === undefined)
          throw makePersistenceError("TRANSACTION_FAILED", "preparation.concurrent-commit", true);
        return {
          resultRef: snapshotRef,
          audit: {
            auditEntryId,
            projectId: context.projectId,
            action,
            targetRef: snapshotRef,
            actorRef: context.actorId,
            authorizationContextRef: context.authorization.authorizationContextRef,
            occurredAt: context.issuedAt,
            recordedAt,
            version: { entityId: snapshotRef.reference.entityId, versionId: "1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [
            {
              schemaVersion: SCHEMA_VERSION,
              eventId: `inputs-ready-${digest.slice(0, 40)}`,
              eventVersion: 1,
              eventType: "engineering.inputs-ready.v1",
              projectId: context.projectId,
              aggregateRef: snapshotRef,
              occurredAt: context.issuedAt,
              recordedAt,
              causationId: command.commandId,
              correlationId: `data-cleaning-${digest.slice(0, 40)}`,
              producerCommandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              authorizationContextRef: context.authorization.authorizationContextRef,
              auditTrailRef: snapshot.auditTrailRef,
              payload: {
                preparation: {
                  kind: "identification",
                  identificationPreparationSnapshotRef: snapshotRef,
                },
              },
            },
          ],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );

    return EngineeringFreezeResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "identification-preparation",
        identificationPreparationSnapshotRef: snapshotRef,
      },
    });
  }

  // ------------------------------------------------------------------- helpers

  async #verify(
    context: CleaningCommandContext,
    branch:
      | typeof PREPARATION_BRANCH
      | typeof MONITORING_BRANCH
      | "engineering-data.complete-identification-preparation",
    spatialScopeRefs: readonly { reference: { entityId: string; versionId: string } }[],
    sourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<void> {
    if (
      context.projectId !== context.authorization.projectId ||
      context.actorId !== context.authorization.actorId
    ) {
      throw Object.assign(new Error("authorization denied"), {
        dataCleaningError: moduleError("AUTHORIZATION_DENIED", context.commandId),
      });
    }
    const verified = await this.#access.verify({
      authorizationContextRef: context.authorization.authorizationContextRef,
      invocationId: context.commandId,
      projectId: context.projectId,
      branch,
      requestedSpatialScopeRefs: [...spatialScopeRefs] as never,
      requestedSourceVersionRefs: [...sourceVersionRefs] as never,
      requestedAt: context.authorization.decidedAt,
    });
    if (branch === "engineering-data.complete-identification-preparation" && verified.redacted)
      boundResultDenied(context.commandId);
  }

  async #resolveDocuments(
    context: CleaningCommandContext,
    sourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<
    | { readonly kind: "ok"; readonly documents: CleaningPreparationManifestV1["documents"] }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const rows = await this.#db
      .selectFrom("business.structured_document_conversions")
      .selectAll()
      .where("project_id", "=", context.projectId)
      .where("status", "=", "succeeded")
      .execute();
    const documents: CleaningPreparationManifestV1["documents"] = [];
    for (const sourceVersionRef of sourceVersionRefs) {
      const versionKey = referenceKey(sourceVersionRef);
      const candidates = rows.filter((row) => {
        const parsed = SourceVersionRefV1Schema.safeParse(row.source_version_ref);
        if (!parsed.success || referenceKey(parsed.data) !== versionKey) return false;
        if (this.#policy.schemaVersion === "2")
          return this.#policy.documentRules.some((rule) => rule.inputKind === row.input_kind);
        return (
          this.#policy.allowedConversionPolicyRefs.some((ref) =>
            sameVersion(ref, row.conversion_policy_ref as VersionReference),
          ) &&
          this.#policy.allowedQualityPolicyRefs.some((ref) =>
            sameVersion(ref, row.quality_policy_ref as VersionReference),
          ) &&
          this.#policy.allowedConverterDeploymentRefs.some((ref) =>
            sameVersion(ref, row.converter_deployment_ref as VersionReference),
          )
        );
      });
      if (candidates.length !== 1) {
        return {
          kind: "error",
          error: moduleError("BUSINESS_BLOCKED", context.commandId, {
            blockerKind:
              candidates.length === 0
                ? "document-conversion-missing"
                : "document-conversion-ambiguous",
            blockerRef: sourceVersionRef,
          }),
        };
      }
      const row = candidates[0]!;
      documents.push({
        sourceVersionRef,
        conversionRef: StructuredDocumentConversionRefV1Schema.parse({
          kind: "structured-document-conversion",
          reference: { entityId: row.conversion_id, versionId: row.version_id },
        }),
        jsonLdArtifactRef: ContentArtifactRefV1Schema.parse(row.jsonld_artifact_ref),
        sourceSegmentSetRef: SourceSegmentSetRefV1Schema.parse(row.source_segment_set_ref),
        inputKind:
          row.input_kind as CleaningPreparationManifestV1["documents"][number]["inputKind"],
      });
    }
    return { kind: "ok", documents };
  }

  async #freezeMonitoring(
    context: CleaningCommandContext,
    command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly monitoring: CleaningPreparationManifestV1["monitoring"];
      }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const monitoringPolicy = this.#policy.monitoring;
    if (monitoringPolicy === undefined) return { kind: "ok", monitoring: undefined };
    const cutoff = command.payload.monitoringCutoff;
    if (cutoff === undefined) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "monitoring-cutoff-missing",
          blockerRef: monitoringPolicy.monitoringSeriesRef,
        }),
      };
    }
    const authorization = await this.#deriveMonitoringAuthorization(
      context,
      { sourceVersionRefs: command.payload.sourceVersionRefs },
      monitoringPolicy.monitoringSeriesRef,
    );
    const frozen = await this.#monitoringStore.freezeSnapshot({
      commandId: `${command.commandId}:monitoring`,
      idempotencyKey: `${command.idempotencyKey}:monitoring`,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization,
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: monitoringPolicy.monitoringSeriesRef,
        cutoff,
        availabilityPolicyRef: monitoringPolicy.availabilityPolicyRef,
      },
    });
    if (frozen.kind === "waiting") {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "monitoring-freeze-pending",
          blockerRef: monitoringPolicy.monitoringSeriesRef,
        }),
      };
    }
    if (frozen.kind === "failed") {
      return { kind: "error", error: frozen.error as unknown as Record<string, unknown> };
    }
    if (frozen.result.kind !== "monitoring-snapshot") {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", command.commandId) };
    }
    const availability = await this.#readSnapshotAvailability(
      command.projectId,
      frozen.result.monitoringSnapshotRef,
    );
    if (availability === undefined) {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", command.commandId) };
    }
    return {
      kind: "ok",
      monitoring: {
        monitoringSnapshotRef: frozen.result.monitoringSnapshotRef,
        monitoringSeriesRef: monitoringPolicy.monitoringSeriesRef,
        availability,
      },
    };
  }

  /**
   * C06 授权上下文按 (invocationId, project, branch) 绑定，因此 C14 的冻结必须使用
   * 以本次冻结为父上下文的窄化 system 授权，而不是直接复用 C15 自己的上下文。
   */
  async #deriveMonitoringAuthorization(
    context: CleaningCommandContext,
    request: { readonly sourceVersionRefs: readonly SourceVersionRefV1[] },
    monitoringSeriesRef: MonitoringSeriesRefV1,
  ): Promise<EngineeringFreezeCommandV1["authorization"]> {
    const decision = await this.#access.authorize({
      invocationId: `${context.commandId}:monitoring`,
      projectId: context.projectId,
      branch: MONITORING_BRANCH,
      requestedSpatialScopeRefs: [...context.authorization.spatialScopeRefs] as never,
      // 窄化到本次冻结命令的资料版本；C14 冻结仍会以监测样本的资料版本复验当前授权，
      // 因此监测序列必须引用同一批资料版本，否则准备按授权失败阻断而不是放宽。
      requestedSourceVersionRefs: request.sourceVersionRefs as never,
      requestedAt: context.issuedAt,
      invocation: {
        kind: "system",
        systemActorId: context.actorId,
        reasonCode: "data-cleaning-monitoring-freeze",
      },
      parentContext: context.authorization,
      causalRunRef: {
        kind: "workflow-run",
        reference: {
          entityId: `data-cleaning-${referenceKey(monitoringSeriesRef)}`,
          versionId: "1",
        },
      },
    });
    return decision.context;
  }

  async #startCleaningTask(
    context: CleaningCommandContext,
    digest: string,
    manifest: CleaningPreparationManifestV1,
    manifestArtifactRef: ContentArtifactRefV1,
  ): Promise<
    | { readonly kind: "ok"; readonly taskRef: AgentTaskRefV1 }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const agent = this.#policy.agent;
    const started = StartAgentTaskResultV1Schema.parse(
      await this.#startAgentTask({
        command: {
          commandId: `data-cleaning-start-${digest.slice(0, 40)}`,
          idempotencyKey: `data-cleaning-task-${digest.slice(0, 40)}`,
          projectId: context.projectId,
          actorId: context.actorId,
          issuedAt: context.issuedAt,
          kind: "start-task",
          payload: {
            taskType: "data-cleaning",
            triggerMode: "embedded",
            parentRunRef: {
              kind: "workflow-run",
              reference: { entityId: `data-cleaning-run-${digest.slice(0, 40)}`, versionId: "1" },
            },
            frozenInputRef: manifestArtifactRef,
            modelDeploymentRef: agent.modelDeploymentRef,
            promptTemplateRef: agent.promptTemplateRef,
            toolPolicyRef: agent.toolPolicyRef,
            budgetPolicyRef: agent.budgetPolicyRef,
            incrementSchemaRef: agent.incrementSchemaRef,
            validationPolicyRef: agent.validationPolicyRef,
          },
        },
        // 清单按命令顺序由逐项成功的转换解析而来，其空间范围与资料版本就是命令的精确范围；
        // 组合根用同一批 refs 调用 C06 的 `agent-task.start-task` exact branch。
        requestedSpatialScopeRefs: manifest.spatialScopeRefs,
        requestedSourceVersionRefs: manifest.documents.map((document) => document.sourceVersionRef),
      }),
    );
    if (started.kind === "failed") {
      return { kind: "error", error: started.error as unknown as Record<string, unknown> };
    }
    if (started.kind !== "succeeded") {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", context.commandId) };
    }
    return { kind: "ok", taskRef: AgentTaskRefV1Schema.parse(started.result.agentTaskRef) };
  }

  async #readBoundResult(
    context: CleaningCommandContext,
    taskRef: AgentTaskRefV1,
    /** 关联触发读取的任务或查询，实际文件访问由 C04 分配独立编号。 */
    readScope: string = taskRef.reference.entityId,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly result: DataCleaningResultV1;
        readonly resultArtifactRef: ContentArtifactRefV1;
      }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const row = await this.#db
      .selectFrom("business.data_cleaning_results")
      .selectAll()
      .where("project_id", "=", context.projectId)
      .where(sql<boolean>`agent_task_ref->'reference'->>'entityId' = ${taskRef.reference.entityId}`)
      .executeTakeFirst();
    if (row === undefined) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", context.commandId, {
          blockerKind: "data-cleaning-result-missing",
          blockerRef: taskRef,
        }),
      };
    }
    const resultArtifactRef = ContentArtifactRefV1Schema.parse(row.result_artifact_ref);
    const result = DataCleaningResultV1Schema.parse(
      await this.#readJson(
        taskRef,
        resultArtifactRef,
        context.authorization,
        RESULT_PURPOSE,
        MAX_MANIFEST_BYTES,
        readScope,
      ),
    );
    if (!sameVersion(result.agentTaskRef.reference, taskRef.reference)) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", context.commandId, {
          blockerKind: "data-cleaning-result-mismatch",
          blockerRef: taskRef,
        }),
      };
    }
    return { kind: "ok", result, resultArtifactRef };
  }

  /**
   * 按来源精确版本筛选正式清洗结果（design D-06）。
   *
   * 直接消费 `data_cleaning_results` 已登记结果，不依赖准备快照是否存在；
   * 多来源派生结果按其全部输入登记的事实返回，披露范围由调用方按当前权限交集决定。
   */
  async listResultsForSource(input: {
    readonly projectId: string;
    readonly sourceVersionRef: SourceVersionRefV1;
    readonly limit: number;
  }): Promise<readonly DataCleaningResultForSubjectV1[]> {
    return this.#listResultsForSubject(
      input.projectId,
      { sourceVersionRef: input.sourceVersionRef },
      input.limit,
    );
  }

  /**
   * 按监测快照集合筛选正式清洗结果（design D-06）。
   *
   * 监测 subject 的清洗关联先由所属 store 列出该序列的有界快照关系，
   * 再据此匹配原结果；不把来源标识当作快照标识。
   */
  async listResultsForMonitoringSnapshots(input: {
    readonly projectId: string;
    readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
    readonly limit: number;
  }): Promise<readonly DataCleaningResultForSubjectV1[]> {
    if (input.monitoringSnapshotRefs.length === 0) return [];
    return this.#listResultsForSubject(
      input.projectId,
      { monitoringSnapshotRefs: input.monitoringSnapshotRefs },
      input.limit,
    );
  }

  /**
   * 正式结果的排除项（design D-06）。
   *
   * 只返回属于该 subject 的判定，不返回整份结果正文或其它来源的条目。
   */
  async readResultExclusions(input: {
    readonly projectId: string;
    readonly resultRef: RouteDecisionRefV1;
    readonly subject:
      | { readonly sourceVersionRef: SourceVersionRefV1 }
      | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] };
  }): Promise<readonly DataCleaningExclusionDecisionV1[]> {
    const row = await this.#db
      .selectFrom("business.data_cleaning_results")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("result_id", "=", input.resultRef.reference.entityId)
      .where("version_id", "=", input.resultRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return [];
    const result = DataCleaningResultV1Schema.parse(row.result_payload);
    return result.exclusions.filter((decision) => exclusionMatchesSubject(decision, input.subject));
  }

  async #listResultsForSubject(
    projectId: string,
    subject:
      | { readonly sourceVersionRef: SourceVersionRefV1 }
      | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] },
    limit: number,
  ): Promise<readonly DataCleaningResultForSubjectV1[]> {
    const probes =
      "sourceVersionRef" in subject
        ? [{ sourceVersionRef: subject.sourceVersionRef }]
        : subject.monitoringSnapshotRefs.map((monitoringSnapshotRef) => ({
            monitoringSnapshotRef,
          }));
    const rows = await this.#db
      .selectFrom("business.data_cleaning_results")
      .selectAll()
      .where("project_id", "=", projectId)
      .where(
        sql<boolean>`EXISTS (SELECT 1 FROM jsonb_array_elements(result_payload->'inputs') AS input WHERE ${sql.join(
          probes.map((probe) => sql`input @> ${JSON.stringify(probe)}::jsonb`),
          sql` OR `,
        )})`,
      )
      .limit(limit)
      .execute();
    const results: DataCleaningResultForSubjectV1[] = [];
    for (const row of rows) {
      const result = DataCleaningResultV1Schema.parse(row.result_payload);
      const input = result.inputs.find((item) => inputMatchesSubject(item, subject));
      if (input === undefined) continue;
      results.push({
        resultRef: RouteDecisionRefV1Schema.parse({
          kind: "route-decision",
          reference: { entityId: row.result_id, versionId: row.version_id },
        }),
        policyRef: result.policyRef,
        recordedAt: result.formedAt,
        input,
      });
    }
    return results.sort((left, right) => {
      const byTime = right.recordedAt.localeCompare(left.recordedAt);
      if (byTime !== 0) return byTime;
      return `${left.resultRef.reference.entityId}/${left.resultRef.reference.versionId}`.localeCompare(
        `${right.resultRef.reference.entityId}/${right.resultRef.reference.versionId}`,
      );
    });
  }

  async #persistResultIndex(
    context: CleaningCommandContext,
    taskRef: AgentTaskRefV1,
    frozen: DataCleaningFrozenInputV1,
    resultArtifactRef: ContentArtifactRefV1,
    result: DataCleaningResultV1,
  ): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const resultContext: CleaningCommandContext = {
      ...context,
      commandId: `${taskRef.reference.entityId}:cleaning-result`,
      idempotencyKey: `${taskRef.reference.entityId}:cleaning-result`,
    };
    const auditEntryId = `audit-${resultContext.commandId}`;
    const resultRef = {
      kind: "route-decision" as const,
      reference: {
        entityId: `data-cleaning-result-${frozen.manifestDigest.slice(0, 40)}`,
        versionId: "1",
      },
    };
    await this.#transactionUnit.execute(
      atomicCommandFor(resultContext, RESULT_COMMAND_KIND, {
        manifestDigest: frozen.manifestDigest,
        overallAvailability: result.overallAvailability,
      }),
      async (transactionContext) => {
        const transaction = asTransaction(transactionContext);
        await transaction
          .insertInto("business.data_cleaning_results")
          .values({
            result_id: resultRef.reference.entityId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            command_kind: RESULT_COMMAND_KIND,
            project_id: context.projectId,
            command_id: resultContext.commandId,
            idempotency_key: resultContext.idempotencyKey,
            agent_task_ref: taskRef,
            manifest_artifact_ref: frozen.manifestArtifactRef,
            result_artifact_ref: resultArtifactRef,
            policy_ref: this.#policy.policyRef,
            overall_availability: result.overallAvailability,
            result_payload: result,
            audit_entry_id: auditEntryId,
          } as never)
          .onConflict((conflict) => conflict.columns(["result_id", "version_id"]).doNothing())
          .execute();
        return {
          resultRef,
          audit: {
            auditEntryId,
            projectId: context.projectId,
            action: "engineering-data.data-cleaning-result",
            targetRef: resultRef,
            actorRef: resultContext.actorId,
            authorizationContextRef: resultContext.authorization.authorizationContextRef,
            occurredAt: resultContext.issuedAt,
            recordedAt,
            version: { entityId: resultRef.reference.entityId, versionId: "1" },
            commandId: resultContext.commandId,
            idempotencyKey: resultContext.idempotencyKey,
          },
          events: [],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );
  }

  async #readFrozenDocument(
    taskRef: AgentTaskRefV1,
    document: CleaningPreparationManifestV1["documents"][number],
    authorization: EngineeringFreezeCommandV1["authorization"],
  ): Promise<DataCleaningFrozenDocumentV1> {
    const raw = await this.#readBytes(
      taskRef,
      document.jsonLdArtifactRef,
      authorization,
      CONVERSION_PURPOSE,
      STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1,
    );
    const jsonLd = StructuredDocumentJsonLdV1Schema.parse(JSON.parse(raw) as unknown);
    const rows = await this.#db
      .selectFrom("business.source_segments")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("source_segment_set_id", "=", document.sourceSegmentSetRef.reference.entityId)
      .orderBy("source_segment_id")
      .execute();
    const blocksById = new Map(jsonLd.textBlocks.map((block) => [block.blockId, block]));
    const evidenceBySegment = new Map(
      jsonLd.evidenceFragments.map((fragment) => [fragment.sourceSegmentId, fragment]),
    );
    const imagesForBlocks = tableImageLookup(jsonLd);
    const segments: DataCleaningFrozenSegmentV1[] = rows.map((row) => {
      const sourceSegmentId = SourceSegmentIdV1Schema.parse(row.source_segment_id);
      const textBlockIds = [...(evidenceBySegment.get(sourceSegmentId)?.textBlockIds ?? [])];
      const blocks = textBlockIds
        .map((blockId) => blocksById.get(blockId))
        .flatMap((block) => (block === undefined ? [] : [block]));
      const images = imagesForBlocks(textBlockIds);
      return {
        sourceSegmentId,
        kind: SourceSegmentKindV1Schema.parse(row.kind),
        locator: SourceSegmentLocatorV1Schema.parse(row.locator),
        textBlockIds,
        parsedFingerprint: sha256CanonicalJson({
          segment: sourceSegmentId,
          blocks: blocks.map((block) => ({ blockId: block.blockId, text: block.text })),
          ...(images.length === 0 ? {} : { unrecognizedTableCells: images }),
        }),
      };
    });
    return {
      sourceVersionRef: document.sourceVersionRef,
      conversionRef: document.conversionRef,
      jsonLdArtifactRef: document.jsonLdArtifactRef,
      sourceSegmentSetRef: document.sourceSegmentSetRef,
      inputKind: document.inputKind,
      jsonLdFingerprint: sha256CanonicalJson(raw),
      ...((jsonLd.tableFields ?? []).some((field) => field.unrecognizedImages !== undefined)
        ? {
            unrecognizedTableImageCount: (jsonLd.tableFields ?? []).reduce(
              (sum, field) => sum + (field.unrecognizedImages?.length ?? 0),
              0,
            ),
          }
        : {}),
      segments,
    };
  }

  async #readFrozenMonitoring(
    projectId: string,
    monitoringSnapshotRef: MonitoringSnapshotRefV1,
  ): Promise<DataCleaningFrozenMonitoringV1> {
    const snapshot = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .where("version_id", "=", monitoringSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (snapshot === undefined) {
      throw new TypeError("frozen monitoring snapshot is not available");
    }
    const members = await this.#db
      .selectFrom("business.monitoring_snapshot_members")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .orderBy("member_index")
      .execute();
    const points = await this.#db
      .selectFrom("business.monitoring_snapshot_points")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .orderBy("point_index")
      .execute();
    const sampleRefs = new Map(
      (snapshot.sample_version_refs as unknown[])
        .map((value) => MonitoringSampleVersionRefV1Schema.safeParse(value))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .map((ref) => [ref.reference.entityId, ref] as const),
    );
    return {
      monitoringSnapshotRef,
      monitoringSeriesRef: MonitoringSeriesRefV1Schema.parse(
        snapshot.monitoring_series_ref,
      ) as MonitoringSeriesRefV1,
      availability: DataCleaningAvailabilityV1Schema.parse(snapshot.availability),
      coverageRatio: snapshot.coverage_ratio,
      availabilityReasons: (snapshot.availability_reasons as unknown[])
        .flatMap((value) => (typeof value === "string" ? [value] : []))
        .slice(0, 32),
      members: members.map((member) => ({
        memberIndex: member.member_index,
        sampleVersionRef:
          sampleRefs.get(member.sample_version_id) ??
          MonitoringSampleVersionRefV1Schema.parse({
            kind: "monitoring-sample-version",
            reference: { entityId: member.sample_version_id, versionId: "1" },
          }),
        selectionReason:
          member.selection_reason as DataCleaningFrozenMonitoringV1["members"][number]["selectionReason"],
      })),
      pointStatuses: points.map((point) => ({
        sampledAt: asIso(point.sampled_at),
        status: point.status as DataCleaningFrozenMonitoringV1["pointStatuses"][number]["status"],
        sampleVersionRefs: (point.source_sample_refs as unknown[])
          .map((value) => MonitoringSampleVersionRefV1Schema.safeParse(value))
          .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
          .slice(0, 4),
      })),
      snapshotFingerprint: sha256CanonicalJson({
        snapshot: referenceKey(monitoringSnapshotRef),
        members: members.map((member) => `${member.member_index}:${member.sample_version_id}`),
        points: points.map((point) => `${point.point_index}:${point.status}`),
      }),
    };
  }

  async #readSampleVersions(
    projectId: string,
    sampleVersionIds: readonly string[],
  ): Promise<readonly Record<string, unknown>[]> {
    if (sampleVersionIds.length === 0) return [];
    const rows = await this.#db
      .selectFrom("business.monitoring_sample_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("sample_version_id", "in", [...sampleVersionIds])
      .execute();
    return rows.map((row) => ({
      sampleVersionRef: {
        kind: "monitoring-sample-version",
        reference: { entityId: row.sample_version_id, versionId: row.version_id },
      },
      sourceSampleKey: row.source_sample_key,
      sampledAt: asIso(row.sampled_at),
      value: row.value,
      unit: row.unit,
      canonicalValue: row.canonical_value,
      canonicalUnit: row.canonical_unit,
      relationKind: row.relation_kind,
      evidenceReferences: row.evidence_references,
      sourceVersionRef: row.source_version_ref,
      sourceSegmentSetRef: row.source_segment_set_ref,
    }));
  }

  async #readSnapshotAvailability(
    projectId: string,
    monitoringSnapshotRef: MonitoringSnapshotRefV1,
  ): Promise<DataCleaningFrozenMonitoringV1["availability"] | undefined> {
    const row = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .select(["availability"])
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .where("version_id", "=", monitoringSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return DataCleaningAvailabilityV1Schema.parse(row.availability);
  }

  async #putContent(
    context: CleaningCommandContext,
    spec: Omit<ArtifactSpec, "artifactKind">,
  ): Promise<ContentArtifactRefV1> {
    const result = await this.#put(context, { ...spec, artifactKind: "content" });
    return ContentArtifactRefV1Schema.parse(result);
  }

  async #putDiagnostic(
    context: CleaningCommandContext,
    spec: Omit<ArtifactSpec, "artifactKind">,
  ): Promise<ArtifactRefV1> {
    return ArtifactRefV1Schema.parse(
      await this.#put(context, { ...spec, artifactKind: "diagnostic" }),
    );
  }

  async #put(context: CleaningCommandContext, spec: ArtifactSpec): Promise<ArtifactRefV1> {
    const bytes = new TextEncoder().encode(canonicalJson(spec.value));
    // C04 要求父工件引用按 (kind/entityId/versionId) 规范排序且不重复。
    const parentArtifactRefs = [...spec.parentArtifactRefs]
      .sort((left, right) => (artifactSortKey(left) < artifactSortKey(right) ? -1 : 1))
      .filter(
        (ref, index, all) =>
          index === 0 || artifactSortKey(ref) !== artifactSortKey(all[index - 1]!),
      );
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: `${spec.artifactId}:put`,
        idempotencyKey: `${spec.artifactId}:put`,
        projectId: context.projectId,
        actorId: context.actorId,
        issuedAt: context.issuedAt,
        authorization: context.authorization,
        requiredCapability: authorizedCapability(context.authorization),
        artifactId: spec.artifactId,
        artifactKind: spec.artifactKind,
        purposeCode: spec.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs,
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(bytes),
    );
    return result.artifactRef;
  }

  async #readJson(
    taskRef: AgentTaskRefV1,
    artifactRefValue: ArtifactRefV1,
    authorization: EngineeringFreezeCommandV1["authorization"],
    purposeCode: string,
    maxBytes: number,
    readScope: string = taskRef.reference.entityId,
  ): Promise<unknown> {
    return JSON.parse(
      await this.#readBytes(
        taskRef,
        artifactRefValue,
        authorization,
        purposeCode,
        maxBytes,
        readScope,
      ),
    ) as unknown;
  }

  async #readBytes(
    taskRef: AgentTaskRefV1,
    artifactRefValue: ArtifactRefV1,
    authorization: EngineeringFreezeCommandV1["authorization"],
    purposeCode: string,
    maxBytes: number,
    readScope: string = taskRef.reference.entityId,
  ): Promise<string> {
    const handle: ArtifactReadHandleV1 = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        requestId: `${readScope}:${purposeCode}:read`,
        idempotencyKey: `${readScope}:${purposeCode}:read`,
        artifactRef: artifactRefValue,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: authorization.decidedAt,
        purposeCode,
        requiredCapability: authorizedCapability(authorization),
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw new RangeError("frozen artifact exceeds the bounded read limit");
      }
      chunks.push(chunk);
    }
    await handle.completed;
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(buffer);
  }

  #mapError(error: unknown, causalRunId: string): Record<string, unknown> {
    const accessFailure = resolveAccessFailure(error);
    if (accessFailure !== undefined) {
      if (accessFailure.details.code === "AUTHORIZATION_DENIED") {
        return moduleError("AUTHORIZATION_DENIED", causalRunId);
      }
      if (accessFailure.details.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
      }
      return moduleError(
        accessFailure.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    const declared =
      error instanceof Error
        ? (error as Error & { dataCleaningError?: Record<string, unknown> }).dataCleaningError
        : undefined;
    if (declared !== undefined) return declared;
    const accessError =
      error instanceof Error ? (error as Error & { accessError?: unknown }).accessError : undefined;
    if (accessError instanceof AccessServiceError) {
      if (accessError.details.code === "AUTHORIZATION_DENIED") {
        return moduleError("AUTHORIZATION_DENIED", causalRunId);
      }
      if (accessError.details.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
      }
      return moduleError(
        accessError.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    const persistence = (
      error as Error & { persistenceError?: { retryable?: boolean; code?: string } }
    ).persistenceError;
    const ownCode = (error as Error & { code?: unknown }).code;
    const persistenceCode =
      persistence?.code ?? (typeof ownCode === "string" ? ownCode : undefined);
    const persistenceRetryable =
      persistence?.retryable ?? (error as Error & { retryable?: unknown }).retryable;
    if (persistenceCode === "IDEMPOTENCY_CONFLICT") {
      return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
    }
    if (persistence !== undefined || typeof ownCode === "string") {
      return moduleError(
        persistenceRetryable === true ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    return moduleError("TRANSIENT_FAILURE", causalRunId);
  }
}

interface ArtifactSpec {
  readonly artifactId: string;
  readonly artifactKind: "content" | "diagnostic";
  readonly purposeCode: string;
  readonly value: unknown;
  readonly parentArtifactRefs: readonly ArtifactRefV1[];
}

const taskContext = (task: AgentTaskSnapshotV1): CleaningCommandContext => ({
  commandId: task.envelope.commandId,
  idempotencyKey: task.envelope.idempotencyKey,
  projectId: task.envelope.projectId,
  actorId: task.envelope.actorId,
  issuedAt: task.envelope.createdAt,
  authorization: task.envelope.authorization as EngineeringFreezeCommandV1["authorization"],
});

const atomicCommandFor = (
  context: CleaningCommandContext,
  commandKind: string,
  payload: Record<string, unknown>,
) => ({
  projectId: context.projectId,
  commandKind,
  commandId: context.commandId,
  idempotencyKey: context.idempotencyKey,
  payload: JSON.parse(JSON.stringify(payload)) as never,
  actorRef: context.actorId,
  authorizationContextRef: context.authorization.authorizationContextRef,
  issuedAt: context.issuedAt,
});

export const createPostgresDataCleaningStore = (
  options: PostgresDataCleaningStoreOptions,
): PostgresDataCleaningStore => new PostgresDataCleaningStore(options);
