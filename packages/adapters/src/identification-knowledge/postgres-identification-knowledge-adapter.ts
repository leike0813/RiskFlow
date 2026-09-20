import { randomUUID } from "node:crypto";

import type { Kysely, Selectable, Transaction } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  AgentRuntimeError,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentTaskFailureEvidenceReaderV1,
  type AgentTaskFailureEvidenceV1,
  type AgentValidationResultV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import { KnowledgeLifecycleError } from "@riskflow/core/knowledge-governance";
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
  KnowledgeAuthoringBaselineReadRequestV1Schema,
  KnowledgeAuthoringFailureV1Schema,
  KnowledgeAuthoringManifestV1Schema,
  KnowledgeAuthoringSegmentSliceRequestV1Schema,
  applyKnowledgeAuthoringIncrement,
  createKnowledgeAuthoringTaskDefinition,
  IdentificationKnowledgePackageV1Schema,
  identificationBasisPublishedEvent,
  identificationKnowledgePackageDigest,
  isIdentificationKnowledgeDefinitionTypeV1,
  validateIdentificationKnowledgePackage,
  type IdentificationEvidenceDecisionV1,
  type IdentificationKnowledgeDefinitionTypeV1,
  type IdentificationKnowledgeGovernancePolicyV1,
  type IdentificationKnowledgePackageV1,
  type IdentificationKnowledgeReleaseAppendV1,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationKnowledgeValidationReceiptV1,
  type IdentificationPolicySetProviderV1,
  type IdentificationPreparationExactReadV1,
  type IdentificationPreparationKnowledgeReaderV1,
  type KnowledgeAuthoringManifestV1,
  type KnowledgeAuthoringTaskPortV1,
} from "@riskflow/core/identification-knowledge";
import type {
  EngineeringDataReadResolutionResultV1,
  ResolveEngineeringDataReadQueryV1,
} from "@riskflow/core/engineering-data/context-source";
import type { DomainEventV1 } from "@riskflow/contracts/events";
import {
  AgentTaskRefV1Schema,
  ContentArtifactRefV1Schema as ContractCandidateArtifactRefV1Schema,
  ContentArtifactRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeGovernanceResultV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeRevisionRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  StartAgentTaskCommandV1Schema,
  ProcessModelReleaseRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ContractReferenceV1,
  type EngineeringDataQueryV1,
  type EngineeringDataReadResultV1,
  type KnowledgeDefinitionTypeV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeGovernanceResultForCommandV1,
  type KnowledgeResolutionCommandV1,
  type KnowledgeResolutionResultV1,
  type KnowledgeRevisionRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type AgentTaskPortV1,
  type AgentTaskResultRefV1,
  type AgentTaskRefV1,
  type IdentificationPreparationSnapshotRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewTaskRefV1,
  type SourceSegmentSetRefV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema, type EvidenceReference } from "@riskflow/contracts/common";

import type { DataCleaningResultV1 } from "@riskflow/core/engineering-data/cleaning";

import type { PostgresDataCleaningStore } from "../engineering-data/cleaning/index.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import {
  governedReleaseResolutionInvocationId,
  type PostgresKnowledgeGovernanceAdapter,
} from "../knowledge-governance/index.js";
import type { PostgresScoringRulesAdapter } from "../scoring-rules/index.js";

const SCHEMA_VERSION = "1";
export const IDENTIFICATION_KNOWLEDGE_VALIDATION_PURPOSE_V1 = "identification-knowledge-validation";
export const IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1 =
  "identification-knowledge-candidate-package";
const VALIDATION_PURPOSE = IDENTIFICATION_KNOWLEDGE_VALIDATION_PURPOSE_V1;
const CANDIDATE_PURPOSE = IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1;
export const IDENTIFICATION_KNOWLEDGE_MANIFEST_PURPOSE_V1 =
  "identification-knowledge-authoring-manifest";
export const IDENTIFICATION_KNOWLEDGE_FAILURE_PURPOSE_V1 =
  "identification-knowledge-authoring-failure";
export const IDENTIFICATION_KNOWLEDGE_OBSERVATION_PURPOSE_V1 =
  "identification-knowledge-observation";
const MANIFEST_PURPOSE = IDENTIFICATION_KNOWLEDGE_MANIFEST_PURPOSE_V1;
const FAILURE_PURPOSE = IDENTIFICATION_KNOWLEDGE_FAILURE_PURPOSE_V1;
const OBSERVATION_PURPOSE = IDENTIFICATION_KNOWLEDGE_OBSERVATION_PURPOSE_V1;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

interface ValidationRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  validation_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  package_digest: string;
  validation_policy_ref: JsonValue;
  preparation_snapshot_ref: JsonValue;
  candidate_artifact_ref: JsonValue;
  validation_artifact_ref: JsonValue;
  decisions: JsonValue;
  disposition: string;
  rejection_class: string | null;
  authorization_context_ref: JsonValue;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface RevisionBindingRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  revision_id: string;
  revision_version_id: string;
  project_id: string;
  definition_type: string;
  binding_kind: string;
  validation_id: string | null;
  validation_version_id: string | null;
  package_digest: string | null;
  agent_task_ref: JsonValue | null;
  failure_artifact_ref: JsonValue | null;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface ReleaseBindingRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  release_id: string;
  release_version_id: string;
  project_id: string;
  definition_type: string;
  revision_id: string;
  revision_version_id: string;
  candidate_artifact_ref: JsonValue;
  composite_member_release_refs: JsonValue | null;
  bound_at: Date | string;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface AuthoringAttemptRow {
  schema_version: string;
  attempt_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  manifest_artifact_ref: JsonValue;
  preparation_snapshot_ref: JsonValue;
  manifest_digest: string;
  agent_task_ref: JsonValue;
  stage: string;
  result_revision_ref: JsonValue | null;
  failure_artifact_ref: JsonValue | null;
  review_task_ref: JsonValue | null;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface IdentificationKnowledgeDatabase {
  "business.identification_knowledge_validations": ValidationRow;
  "business.identification_knowledge_revision_bindings": RevisionBindingRow;
  "business.identification_knowledge_release_bindings": ReleaseBindingRow;
  "business.identification_knowledge_authoring_attempts": AuthoringAttemptRow;
}

type IdentificationKnowledgeTransaction = Transaction<IdentificationKnowledgeDatabase>;
type ValidationRowSelect = Selectable<
  IdentificationKnowledgeDatabase["business.identification_knowledge_validations"]
>;

/**
 * D-04 生产窄读的注入面：`readExactPreparation` 直接来自 C15 公开精确窄读，
 * `read`/`resolveReadQuery` 只使用 C02 公共读取分支。
 */
export interface IdentificationPreparationNarrowReadV1 {
  readonly preparationRead: Pick<PostgresDataCleaningStore, "readExactPreparation">;
  readonly engineeringData: {
    read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1>;
    resolveReadQuery(
      query: ResolveEngineeringDataReadQueryV1,
    ): Promise<EngineeringDataReadResolutionResultV1>;
  };
}

/** 组合根的 C06 受信授权来源：只为 exact branch 签发内部控制台上下文。 */
export type IdentificationKnowledgeAuthorizationRequestV1 = {
  readonly taskRef?: AgentTaskRefV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly invocationId: string;
  readonly branch: ModuleBranchV1;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
  readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
};

export interface PostgresIdentificationKnowledgeAdapterOptionsV1 {
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  /**
   * D-13：组合根注入的 C19 评估依据 resolver 窄 delegate。C17 只对 `assessment-basis`
   * 原样转发同一命令与结果，不复制 C19 的授权、准备、解析、双时间、幂等或错误映射。
   */
  readonly assessmentBasisResolver: Pick<PostgresScoringRulesAdapter, "resolve">;
  /** D-04：C15 公开精确窄读与 C02 公共读取端口，禁止读取上游私有表。 */
  readonly narrowRead: IdentificationPreparationNarrowReadV1;
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly policySetProvider?: IdentificationPolicySetProviderV1;
  /** C08 启动接缝：只有编制入口需要。 */
  readonly agentTaskPort?: AgentTaskPortV1;
  /**
   * D-09 失败证据窄读：失败收口只按 C17 attempt 的精确任务引用经该公共读取取证，
   * 不注入 C08 执行存储，也不调用 `getTask()`。
   */
  readonly agentTaskFailureEvidenceReader: AgentTaskFailureEvidenceReaderV1;
  /**
   * 组合根的 C06 授权来源：工具读取、baseline 读取、finalizer 与失败收口只为
   * exact branch 签发新上下文；不接受调用方 capability 或任务信封授权回退。
   */
  readonly authorize: (
    input: IdentificationKnowledgeAuthorizationRequestV1,
  ) => Promise<AuthorizationContextV1>;
  readonly now?: () => Date;
}

const asKnowledgeTransaction = (
  context: TransactionContextV1,
): IdentificationKnowledgeTransaction =>
  getPostgresTransaction(context) as unknown as IdentificationKnowledgeTransaction;

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** jsonb 列使用文本形式写入，避免驱动把对象直接交给 text 通道。 */
const jsonbValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const refKey = (value: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): string => `${value.reference.entityId}:${value.reference.versionId}`;

const asContractReference = (value: unknown): ContractReferenceV1 => value as ContractReferenceV1;

const one = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

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
    | { code: "UNSUPPORTED_CONTRACT"; causalRunId: string }
    | { code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE"; causalRunId: string },
): ModuleErrorV1 => {
  const common = {
    stageCode: `identification-knowledge.${value.code.toLowerCase()}`,
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
  if (value.code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: false,
    } as ModuleErrorV1;
  }
  return {
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: {
        entityId: `identification-knowledge-failure-${value.causalRunId}`,
        versionId: `sha256:${sha256CanonicalJson({ causalRunId: value.causalRunId })}`,
      },
    },
  } as ModuleErrorV1;
};

const atomicCommand =
  (command: {
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): ((input: {
    readonly commandKind: string;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly payload: object;
  }) => AtomicCommandV1) =>
  (input) =>
    AtomicCommandV1Schema.parse({
      projectId: command.projectId,
      commandKind: input.commandKind,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      payload: jsonValue(input.payload) as Record<string, JsonValue>,
      actorRef: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      issuedAt: command.issuedAt,
    });

const auditFor = (input: {
  readonly command: AtomicCommandV1;
  readonly targetRef: ContractReferenceV1;
  readonly action: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly auditEntryId: string;
}): AtomicCommitV1["audit"] => ({
  auditEntryId: input.auditEntryId,
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

const validationReceiptFromRow = (
  row: ValidationRow,
): IdentificationKnowledgeValidationReceiptV1 => {
  const definitionType = isIdentificationKnowledgeDefinitionTypeV1(row.definition_type)
    ? row.definition_type
    : undefined;
  if (definitionType === undefined) {
    throw new Error(`unexpected identification definition type ${row.definition_type}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: row.project_id,
    definitionType,
    packageDigest: row.package_digest,
    validationPolicyRef: row.validation_policy_ref as never,
    preparationSnapshotRef: row.preparation_snapshot_ref as never,
    items: row.decisions as never,
    disposition: row.disposition as "accepted" | "rejected",
    ...(row.rejection_class === null
      ? {}
      : { rejectionClass: row.rejection_class as "repairable" | "terminal" }),
    validationArtifactRef: ContentArtifactRefV1Schema.parse(row.validation_artifact_ref),
    validatedAt: asIso(row.recorded_at),
  };
};

/** C16 generic 发布引用：事件与发布绑定只保存精确引用，不复制正文。 */
type GenericReleaseRefV1 = {
  readonly kind: "knowledge-release";
  readonly reference: { readonly entityId: string; readonly versionId: string };
};

const EVIDENCE_ACCESS_BRANCH = "engineering-data.evidence-access" as const;
const SOURCE_SEGMENTS_BRANCH = "engineering-data.source-segments" as const;
const IDENTIFICATION_BASIS_BRANCH = "knowledge-modeling.identification-basis" as const;

const versionedEquals = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

/** C15 公开窄读的错误已是 C17 领域错误形状；非 strict 形状关闭为终止失败。 */
const preparationReadError = (causalRunId: string, error: unknown): ModuleErrorV1 => {
  const parsed = ModuleErrorV1Schema.safeParse(error);
  return parsed.success ? parsed.data : moduleError({ code: "TERMINAL_FAILURE", causalRunId });
};

/**
 * 失败收口的结构化失败（C08 窄读拒绝、C16 提交/复核失败）：携带原 `ModuleErrorV1` 上抛到
 * 逐 attempt 隔离层，由 `settleAuthoringFailures()` 写入 `failures[]`，不得静默丢弃。
 */
class IdentificationKnowledgeModuleError extends Error {
  readonly error: ModuleErrorV1;

  constructor(error: ModuleErrorV1) {
    super(`identification-knowledge operation failed: ${error.code}`);
    this.name = "IdentificationKnowledgeModuleError";
    this.error = error;
  }
}

/**
 * D-09 失败收口结果：逐 attempt 隔离处理。`settled` 为本次真正收口的尝试数，
 * `failures` 为单个 attempt 的授权/调用失败及其可验原因（其它工程继续处理，不被阻断）。
 */
export interface IdentificationKnowledgeFailureSettlementV1 {
  readonly settled: number;
  readonly failures: readonly {
    readonly taskRef: AgentTaskRefV1;
    readonly error: ModuleErrorV1;
  }[];
}

const excludedSegmentsFor = (result: DataCleaningResultV1): ReadonlySet<string> =>
  new Set(result.inputs.flatMap((input) => input.excludedSegmentIds));

const retainedSegmentsFor = (
  result: DataCleaningResultV1,
  sourceVersionRef: { readonly reference: { readonly entityId: string } },
): readonly string[] =>
  result.inputs.find(
    (input) => input.sourceVersionRef?.reference.entityId === sourceVersionRef.reference.entityId,
  )?.retainedSegmentIds ?? [];

/**
 * 提交命令的证据引用：优先取包内首个条目的证据；组合包没有条目证据时使用清单冻结的
 * 保留资料段，绝不用自由文本或伪造引用占位。
 */
const submissionEvidenceReferences = (
  packageValue: IdentificationKnowledgePackageV1,
  manifest: KnowledgeAuthoringManifestV1,
): readonly EvidenceReference[] => {
  const fromPackage =
    packageValue.definitionType === "process-model"
      ? packageValue.nodes[0]?.evidence[0]
      : packageValue.definitionType === "risk-mechanism"
        ? packageValue.mechanisms[0]?.evidence[0]
        : packageValue.definitionType === "standard-library" ||
            packageValue.definitionType === "case-library"
          ? packageValue.entries[0]?.evidence[0]
          : undefined;
  if (fromPackage !== undefined) return [fromPackage];
  const member = manifest.members[0];
  const segmentId = member?.retainedSegmentIds[0];
  if (member === undefined || segmentId === undefined) {
    throw new Error("the frozen manifest has no retained preparation segment for submission");
  }
  return [
    {
      locator: { sourceSegmentId: segmentId },
      sourceVersion: { ...member.sourceVersionRef.reference },
    },
  ];
};

/**
 * C04 内容读取：读取不是幂等业务动作，每次使用新的访问身份，并按上限关闭有界读取。
 * 需要 C06 上下文与调用身份，正文只经工件存储返回。
 */
const readContentArtifact = async (
  artifactStore: ArtifactStoreV1,
  input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly artifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>;
    readonly purposeCode: string;
  },
): Promise<unknown> => {
  const readId = randomId("c17-read");
  const handle: ArtifactReadHandleV1 = await artifactStore.open(
    ArtifactReadRequestV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      requestId: readId,
      idempotencyKey: readId,
      artifactRef: input.artifactRef,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      purposeCode: input.purposeCode,
      requiredCapability: input.authorization.grantedCapabilities[0],
      authorization: input.authorization,
    }),
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of handle.content) {
    size += chunk.byteLength;
    if (size > MAX_PACKAGE_BYTES) throw new RangeError("artifact exceeds the bounded read limit");
    chunks.push(chunk);
  }
  await handle.verified;
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
};

/**
 * D-04 生产精确准备窄读：只组合 C15 公开 `readExactPreparation`、C02 公共读取分支和
 * 已冻结清洗结果；不读 C15/C11 私有表，也不接受调用方提供的授权上下文。
 */
export interface PostgresIdentificationPreparationKnowledgeReaderOptionsV1 {
  readonly narrowRead: IdentificationPreparationNarrowReadV1;
  readonly authorize: PostgresIdentificationKnowledgeAdapterOptionsV1["authorize"];
}

export class PostgresIdentificationPreparationKnowledgeReader implements IdentificationPreparationKnowledgeReaderV1 {
  readonly #narrowRead: IdentificationPreparationNarrowReadV1;
  readonly #authorize: PostgresIdentificationKnowledgeAdapterOptionsV1["authorize"];

  constructor(options: PostgresIdentificationPreparationKnowledgeReaderOptionsV1) {
    this.#narrowRead = options.narrowRead;
    this.#authorize = options.authorize;
  }

  async readExactPreparation(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationPreparationExactReadV1> {
    const authorization = await this.#authorize({
      ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: input.requestId,
      branch: EVIDENCE_ACCESS_BRANCH,
      requestedAt: input.requestedAt,
    });
    const result = await this.#narrowRead.preparationRead.readExactPreparation({
      projectId: input.projectId,
      actorId: input.actorId,
      requestId: input.requestId,
      requestedAt: input.requestedAt,
      authorization,
      preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema.parse(
        input.preparationSnapshotRef,
      ),
    });
    return result.kind === "ok"
      ? result
      : { kind: "error", error: preparationReadError(input.requestId, result.error) };
  }

  async readSegmentSlice(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
    readonly segmentIds: readonly string[];
    readonly limit: number;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly observation: { readonly [key: string]: unknown } }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const preparation = await this.readExactPreparation({
      ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
      projectId: input.projectId,
      preparationSnapshotRef: input.preparationSnapshotRef,
      actorId: input.actorId,
      requestId: `${input.requestId}:preparation`,
      requestedAt: input.requestedAt,
    });
    if (preparation.kind === "error") return { kind: "failed", error: preparation.error };
    // 只复读该准备保留集合内的请求切片：集合属于准备，资料段属于该集合的保留结果。
    const memberIndex = preparation.snapshot.includedSourceSegmentSetRefs.findIndex((candidate) =>
      versionedEquals(candidate, input.sourceSegmentSetRef),
    );
    if (memberIndex === -1) {
      return {
        kind: "failed",
        error: moduleError({
          code: "AUTHORIZATION_DENIED",
          branch: SOURCE_SEGMENTS_BRANCH,
          causalRunId: input.requestId,
        }),
      };
    }
    const retained = new Set(
      retainedSegmentsFor(preparation.result, preparation.snapshot.sourceVersionRefs[memberIndex]!),
    );
    if (!input.segmentIds.every((segmentId) => retained.has(segmentId))) {
      return {
        kind: "failed",
        error: moduleError({
          code: "AUTHORIZATION_DENIED",
          branch: SOURCE_SEGMENTS_BRANCH,
          causalRunId: input.requestId,
        }),
      };
    }
    const authorization = await this.#authorize({
      ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: input.requestId,
      branch: SOURCE_SEGMENTS_BRANCH,
      requestedAt: input.requestedAt,
      requestedSpatialScopeRefs: [...preparation.snapshot.spatialScopeRefs],
      requestedSourceVersionRefs: [...preparation.snapshot.sourceVersionRefs],
    });
    const read = await this.#narrowRead.engineeringData.read({
      kind: "source-segments",
      queryId: input.requestId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization,
      payload: { sourceSegmentSetRef: input.sourceSegmentSetRef },
    });
    if (read.kind === "waiting") {
      return {
        kind: "failed",
        error: moduleError({
          code: "BUSINESS_BLOCKED",
          blockerKind: "source-segments-waiting",
          blockerRef: asContractReference(input.sourceSegmentSetRef),
          causalRunId: input.requestId,
        }),
      };
    }
    if (read.kind !== "succeeded") return { kind: "failed", error: read.error };
    const resolved = await this.#narrowRead.engineeringData.resolveReadQuery({
      queryResultRef: read.result.queryResultRef,
      invocationId: input.requestId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization,
    });
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "source-segments") {
      return {
        kind: "failed",
        error:
          resolved.kind === "failed"
            ? resolved.error
            : moduleError({ code: "TERMINAL_FAILURE", causalRunId: input.requestId }),
      };
    }
    const requested = new Set(input.segmentIds);
    const excluded = excludedSegmentsFor(preparation.result);
    return {
      kind: "succeeded",
      observation: {
        queryResultRef: resolved.result.queryResultRef,
        sourceSegmentSetRef: resolved.result.segmentSet.sourceSegmentSetRef,
        segments: resolved.result.segmentSet.segments
          .filter((segment) => requested.has(segment.sourceSegmentId))
          .slice(0, input.limit)
          .map((segment) => ({
            sourceSegmentId: segment.sourceSegmentId,
            kind: segment.kind,
            locator: segment.locator,
            excluded: excluded.has(segment.sourceSegmentId),
          })),
      },
    };
  }

  async checkEvidence(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly evidenceReferences: readonly EvidenceReference[];
    readonly purposeCode: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly items: readonly IdentificationEvidenceDecisionV1[];
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const preparation = await this.readExactPreparation({
      ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
      projectId: input.projectId,
      preparationSnapshotRef: input.preparationSnapshotRef,
      actorId: input.actorId,
      requestId: `${input.requestId}:preparation`,
      requestedAt: input.requestedAt,
    });
    if (preparation.kind === "error") return { kind: "failed", error: preparation.error };
    const authorization = await this.#authorize({
      ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: input.requestId,
      branch: EVIDENCE_ACCESS_BRANCH,
      requestedAt: input.requestedAt,
      requestedSpatialScopeRefs: [...preparation.snapshot.spatialScopeRefs],
      requestedSourceVersionRefs: [...preparation.snapshot.sourceVersionRefs],
    });
    const read = await this.#narrowRead.engineeringData.read({
      kind: "evidence-access",
      queryId: input.requestId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization,
      payload: {
        evidenceReferences: [...input.evidenceReferences],
        purposeCode: input.purposeCode,
      },
    });
    const readable = new Set<string>();
    if (read.kind === "succeeded") {
      const resolved = await this.#narrowRead.engineeringData.resolveReadQuery({
        queryResultRef: read.result.queryResultRef,
        invocationId: input.requestId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization,
      });
      if (resolved.kind === "succeeded" && resolved.result.kind === "evidence-access") {
        for (const item of resolved.result.items) {
          readable.add(item.segment.sourceSegmentId);
        }
      }
    }
    const excluded = excludedSegmentsFor(preparation.result);
    return {
      kind: "succeeded",
      items: input.evidenceReferences.map((reference) =>
        excluded.has(reference.locator.sourceSegmentId)
          ? {
              evidenceReference: reference,
              disposition: "rejected" as const,
              reasonCode: "segment-excluded-by-cleaning",
            }
          : readable.has(reference.locator.sourceSegmentId)
            ? {
                evidenceReference: reference,
                disposition: "eligible" as const,
                reasonCode: "eligible",
              }
            : {
                evidenceReference: reference,
                disposition: "rejected" as const,
                reasonCode: "segment-not-readable",
              },
      ),
    };
  }
}

/**
 * C17 发布/回滚治理策略：在 C16 发布事务内复验 validated binding/package，先写
 * `identification_knowledge_release_bindings`，再为组合发布构造唯一识别基础事件（D-05）。
 */
export interface PostgresIdentificationKnowledgeReleasePolicyOptionsV1 {
  readonly db: unknown;
  readonly artifactStore: ArtifactStoreV1;
  /** 组合成员解析复用 C16 公共解析；构造顺序上 C16 晚于本策略，因此按需读取。 */
  readonly governance: () => PostgresKnowledgeGovernanceAdapter;
  readonly authorize: PostgresIdentificationKnowledgeAdapterOptionsV1["authorize"];
}

export class PostgresIdentificationKnowledgeReleasePolicy implements IdentificationKnowledgeGovernancePolicyV1 {
  readonly #db: Kysely<IdentificationKnowledgeDatabase>;
  readonly #options: PostgresIdentificationKnowledgeReleasePolicyOptionsV1;

  constructor(options: PostgresIdentificationKnowledgeReleasePolicyOptionsV1) {
    this.#db = options.db as unknown as Kysely<IdentificationKnowledgeDatabase>;
    this.#options = options;
  }

  async appendRelease(
    context: TransactionContextV1,
    input: IdentificationKnowledgeReleaseAppendV1,
  ): Promise<readonly DomainEventV1[]> {
    const tx = asKnowledgeTransaction(context);
    const revisionRef = input.revision.revisionRef;
    const binding = await tx
      .selectFrom("business.identification_knowledge_revision_bindings")
      .selectAll()
      .where("project_id", "=", input.command.projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("revision_version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    if (binding === undefined || binding.binding_kind !== "validated") {
      throw new KnowledgeLifecycleError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "identification-knowledge-binding-required",
        targetRef: asContractReference(revisionRef),
      });
    }
    const validationRow = await this.#findValidation(
      input.command.projectId,
      binding.validation_id,
      binding.validation_version_id,
    );
    if (validationRow === undefined) {
      throw new KnowledgeLifecycleError({
        code: "ENTITY_NOT_FOUND",
        reasonCode: "identification-knowledge-validation-not-found",
        targetRef: asContractReference(revisionRef),
      });
    }
    const members =
      input.revision.definitionType === "retrieval-evidence-base"
        ? await this.#resolveCompositeMembers(input, validationRow)
        : undefined;
    await tx
      .insertInto("business.identification_knowledge_release_bindings")
      .values({
        release_id: input.releaseRef.reference.entityId,
        release_version_id: input.releaseRef.reference.versionId,
        schema_version: SCHEMA_VERSION,
        project_id: input.command.projectId,
        definition_type: input.revision.definitionType,
        revision_id: revisionRef.reference.entityId,
        revision_version_id: revisionRef.reference.versionId,
        candidate_artifact_ref: jsonbValue(input.revision.candidateArtifactRef),
        composite_member_release_refs:
          members === undefined ? null : jsonbValue(members.bindingMembers),
        bound_at: new Date(input.recordedAt),
        command_id: input.command.commandId,
        idempotency_key: `${input.command.idempotencyKey}:bind-release`,
        actor_ref: input.command.actorId,
        audit_entry_id: input.audit.auditEntryId,
        occurred_at: new Date(input.command.issuedAt),
        recorded_at: new Date(input.recordedAt),
        persisted_at: new Date(input.recordedAt),
      } as never)
      .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
      .execute();
    if (members === undefined) return [];
    return [
      identificationBasisPublishedEvent({
        releaseRef: input.releaseRef,
        compositeMemberReleaseRefs: members.eventMembers,
        command: input.command,
        recordedAt: input.recordedAt,
        auditEntryId: input.audit.auditEntryId,
      }),
    ];
  }

  async #findValidation(
    projectId: string,
    validationId: string | null,
    versionId: string | null,
  ): Promise<ValidationRowSelect | undefined> {
    if (validationId === null || versionId === null) return undefined;
    return await this.#db
      .selectFrom("business.identification_knowledge_validations")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("validation_id", "=", validationId)
      .where("version_id", "=", versionId)
      .executeTakeFirst();
  }

  async #resolveCompositeMembers(
    input: IdentificationKnowledgeReleaseAppendV1,
    validationRow: ValidationRowSelect,
  ): Promise<{
    readonly eventMembers: readonly GenericReleaseRefV1[];
    readonly bindingMembers: readonly GenericReleaseRefV1[];
  }> {
    const projectId = input.command.projectId;
    const blocked: (reasonCode: string) => never = (reasonCode) => {
      throw new KnowledgeLifecycleError({
        code: "BUSINESS_BLOCKED",
        reasonCode,
        targetRef: asContractReference(input.releaseRef),
      });
    };
    const resolutionInvocationId = governedReleaseResolutionInvocationId({
      requiredDefinitionTypes: [
        "process-model",
        "risk-mechanism",
        "standard-library",
        "case-library",
      ],
      requiredAt: input.requiredAt,
      asOfRecordedAt: input.command.issuedAt,
    });
    const authorization = await this.#options.authorize({
      projectId,
      actorId: input.command.actorId,
      invocationId: resolutionInvocationId,
      branch: IDENTIFICATION_BASIS_BRANCH,
      requestedAt: input.command.issuedAt,
    });
    const composite = await readContentArtifact(this.#options.artifactStore, {
      projectId,
      actorId: input.command.actorId,
      requestedAt: input.command.issuedAt,
      authorization,
      artifactRef: ContractCandidateArtifactRefV1Schema.parse(validationRow.candidate_artifact_ref),
      purposeCode: CANDIDATE_PURPOSE,
    });
    const compositeParsed = IdentificationKnowledgePackageV1Schema.safeParse(composite);
    if (!compositeParsed.success) blocked("retrieval-evidence-base-package-invalid");
    const parsedPackage = compositeParsed.data;
    if (parsedPackage.definitionType !== "retrieval-evidence-base") {
      blocked("retrieval-evidence-base-package-invalid");
    }
    const compositePackage = parsedPackage;
    const mechanismRef: GenericReleaseRefV1 = {
      kind: "knowledge-release",
      reference: { ...compositePackage.riskMechanismReleaseRef.reference },
    };
    const mechanismPackage = await this.#readBoundPackage(
      projectId,
      mechanismRef,
      input.command.actorId,
      input.command.issuedAt,
      authorization,
    );
    if (mechanismPackage.definitionType !== "risk-mechanism") {
      blocked("retrieval-evidence-base-mechanism-type-mismatch");
    }
    const processModelRef: GenericReleaseRefV1 = {
      kind: "knowledge-release",
      reference: { ...mechanismPackage.processModelReleaseRef.reference },
    };
    const resolved = await this.#options.governance().resolveGovernedReleases({
      projectId,
      requiredDefinitionTypes: [
        "process-model",
        "risk-mechanism",
        "standard-library",
        "case-library",
      ],
      requiredAt: input.requiredAt,
      asOfRecordedAt: input.command.issuedAt,
      authorization,
    });
    if (resolved.kind !== "succeeded") blocked("retrieval-evidence-base-members-unavailable");
    const effective = new Map(
      resolved.result.members.map((member) => [member.definitionType, member.releaseRef]),
    );
    const standardLibraryRef: GenericReleaseRefV1 = {
      kind: "knowledge-release",
      reference: { ...compositePackage.standardLibraryReleaseRef.reference },
    };
    const caseLibraryRef: GenericReleaseRefV1 = {
      kind: "knowledge-release",
      reference: { ...compositePackage.caseLibraryReleaseRef.reference },
    };
    const expected: readonly (readonly [KnowledgeDefinitionTypeV1, GenericReleaseRefV1])[] = [
      ["process-model", processModelRef],
      ["risk-mechanism", mechanismRef],
      ["standard-library", standardLibraryRef],
      ["case-library", caseLibraryRef],
    ];
    for (const [definitionType, releaseRef] of expected) {
      const actual = effective.get(definitionType);
      if (actual === undefined || !versionedEquals(actual, releaseRef)) {
        blocked("retrieval-evidence-base-members-invalid");
      }
    }
    return {
      eventMembers: [processModelRef, mechanismRef, standardLibraryRef, caseLibraryRef],
      bindingMembers: [mechanismRef, standardLibraryRef, caseLibraryRef],
    };
  }

  async #readBoundPackage(
    projectId: string,
    releaseRef: GenericReleaseRefV1,
    actorId: string,
    requestedAt: string,
    authorization: AuthorizationContextV1,
  ): Promise<IdentificationKnowledgePackageV1> {
    const binding = await this.#db
      .selectFrom("business.identification_knowledge_release_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("release_id", "=", releaseRef.reference.entityId)
      .where("release_version_id", "=", releaseRef.reference.versionId)
      .executeTakeFirst();
    if (binding === undefined) {
      throw new KnowledgeLifecycleError({
        code: "ENTITY_NOT_FOUND",
        reasonCode: "identification-knowledge-release-binding-not-found",
        targetRef: asContractReference(releaseRef),
      });
    }
    return IdentificationKnowledgePackageV1Schema.parse(
      await readContentArtifact(this.#options.artifactStore, {
        projectId,
        actorId,
        requestedAt,
        authorization,
        artifactRef: ContractCandidateArtifactRefV1Schema.parse(binding.candidate_artifact_ref),
        purposeCode: CANDIDATE_PURPOSE,
      }),
    );
  }
}

/**
 * C17 façade：在 C16 生命周期之前设置内容门，发布绑定与事件由注入 C16 的
 * `PostgresIdentificationKnowledgeReleasePolicy` 在同一事务提交；正文始终保存在 C04，
 * 数据库只保存受约束的索引事实（D-05、D-07、D-10、D-12）。
 */
export class PostgresIdentificationKnowledgeAdapter {
  readonly #db: Kysely<IdentificationKnowledgeDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly #governance: PostgresKnowledgeGovernanceAdapter;
  readonly #assessmentBasisResolver: PostgresIdentificationKnowledgeAdapterOptionsV1["assessmentBasisResolver"];
  readonly #preparationReader: IdentificationPreparationKnowledgeReaderV1;
  readonly #policy: IdentificationKnowledgeValidationPolicyV1;
  readonly #policySetProvider: IdentificationPolicySetProviderV1 | undefined;
  readonly #agentTaskPort: AgentTaskPortV1 | undefined;
  readonly #agentTaskFailureEvidenceReader: AgentTaskFailureEvidenceReaderV1;
  readonly #authorize: PostgresIdentificationKnowledgeAdapterOptionsV1["authorize"];
  readonly #now: () => Date;

  constructor(options: PostgresIdentificationKnowledgeAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<IdentificationKnowledgeDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#artifactReferenceGuard = options.artifactReferenceGuard;
    this.#governance = options.governance;
    this.#assessmentBasisResolver = options.assessmentBasisResolver;
    this.#preparationReader = new PostgresIdentificationPreparationKnowledgeReader({
      narrowRead: options.narrowRead,
      authorize: options.authorize,
    });
    this.#policy = options.policy;
    this.#policySetProvider = options.policySetProvider;
    this.#agentTaskPort = options.agentTaskPort;
    this.#agentTaskFailureEvidenceReader = options.agentTaskFailureEvidenceReader;
    this.#authorize = options.authorize;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------ C02 port

  async govern<T extends KnowledgeGovernanceCommandV1>(
    command: T,
  ): Promise<KnowledgeGovernanceResultForCommandV1<T>> {
    const parsed = KnowledgeGovernanceCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "identification-knowledge",
        }),
      } as KnowledgeGovernanceResultForCommandV1<T>;
    }
    const valid = parsed.data;
    const result =
      valid.kind === "submit-revision" &&
      isIdentificationKnowledgeDefinitionTypeV1(valid.payload.definitionType)
        ? await this.#submitIdentificationRevision(valid)
        : await this.#delegateGovern(valid);
    return result as KnowledgeGovernanceResultForCommandV1<T>;
  }

  async resolve(command: KnowledgeResolutionCommandV1): Promise<KnowledgeResolutionResultV1> {
    const parsed = KnowledgeResolutionCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "identification-basis" }),
      };
    }
    const valid = parsed.data;
    if (valid.kind === "assessment-basis") {
      // D-13：同一 strict 命令交给组合根注入的 C19 resolver，只调用一次并原样返回结果；
      // 授权、准备快照、双时间、幂等、审计与错误映射仍全部由 C19 拥有。
      return await this.#assessmentBasisResolver.resolve(valid);
    }
    return await this.#resolveIdentificationBasis(valid);
  }

  async retrieve(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1> {
    return {
      kind: "failed",
      error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: query.queryId }),
    };
  }

  /** D-12：C20/C24 的唯一窄读面，按精确发布引用返回不可变包与治理元数据。 */
  async readExact(input: {
    readonly projectId: string;
    readonly releaseRef: unknown;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId?: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly read: {
          readonly package: IdentificationKnowledgePackageV1;
          readonly validation: IdentificationKnowledgeValidationReceiptV1;
          readonly releaseBinding: {
            readonly schemaVersion: "1";
            readonly projectId: string;
            readonly definitionType: IdentificationKnowledgeDefinitionTypeV1;
            readonly releaseRef: unknown;
            readonly revisionRef: {
              readonly kind: "knowledge-revision";
              readonly reference: { readonly entityId: string; readonly versionId: string };
            };
            readonly candidateArtifactRef: ReturnType<
              typeof ContractCandidateArtifactRefV1Schema.parse
            >;
            readonly compositeMemberReleaseRefs?: readonly unknown[];
            readonly boundAt: string;
          };
        };
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const releaseRef = KnowledgeReleaseRefV1Schema.safeParse(input.releaseRef);
    if (!releaseRef.success) {
      return {
        kind: "failed",
        error: moduleError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "identification-knowledge-read",
        }),
      };
    }
    try {
      const verified = await this.#verifyAuthorization(
        input.authorization,
        input.projectId,
        input.actorId,
        input.invocationId ?? `knowledge-read-${refKey(releaseRef.data)}`,
        "knowledge-modeling.identification-basis",
      );
      const binding = await this.#findReleaseBindingByRef(input.projectId, releaseRef.data);
      const revisionBinding =
        binding === undefined
          ? undefined
          : await this.#findRevisionBinding(
              input.projectId,
              binding.revision_id,
              binding.revision_version_id,
            );
      if (
        binding === undefined ||
        revisionBinding === undefined ||
        revisionBinding.binding_kind !== "validated"
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "ENTITY_NOT_FOUND",
            causalRunId: `knowledge-read-${input.projectId}`,
            targetRef: asContractReference(releaseRef.data),
          }),
        };
      }
      const validationRow = await this.#findValidation(
        input.projectId,
        revisionBinding.validation_id,
        revisionBinding.validation_version_id,
      );
      if (validationRow === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "ENTITY_NOT_FOUND",
            causalRunId: `knowledge-read-${input.projectId}`,
            targetRef: asContractReference(releaseRef.data),
          }),
        };
      }
      const packageValue = (await this.#readArtifact(
        verified,
        ContractCandidateArtifactRefV1Schema.parse(binding.candidate_artifact_ref),
        CANDIDATE_PURPOSE,
      )) as IdentificationKnowledgePackageV1;
      return {
        kind: "succeeded",
        read: {
          package: packageValue,
          validation: validationReceiptFromRow(validationRow),
          releaseBinding: {
            schemaVersion: SCHEMA_VERSION,
            projectId: binding.project_id,
            definitionType: binding.definition_type as IdentificationKnowledgeDefinitionTypeV1,
            releaseRef: releaseRef.data,
            revisionRef: {
              kind: "knowledge-revision",
              reference: {
                entityId: binding.revision_id,
                versionId: binding.revision_version_id,
              },
            },
            candidateArtifactRef: ContractCandidateArtifactRefV1Schema.parse(
              binding.candidate_artifact_ref,
            ),
            ...(binding.composite_member_release_refs === null
              ? {}
              : { compositeMemberReleaseRefs: binding.composite_member_release_refs as never }),
            boundAt: asIso(binding.bound_at),
          },
        },
      };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, input.projectId) };
    }
  }

  // --------------------------------------------------------------- identification

  async #submitIdentificationRevision(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    const definitionType = command.payload.definitionType;
    if (!isIdentificationKnowledgeDefinitionTypeV1(definitionType)) {
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: command.commandId }),
      });
    }
    try {
      const verified = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.actorId,
        command.commandId,
        "knowledge-modeling.submit-revision",
      );
      const verifiedCommand = { ...command, authorization: verified };
      const candidateArtifactRef = ContractCandidateArtifactRefV1Schema.parse(
        command.payload.candidateArtifactRef,
      );
      const rawCandidate = await this.#readArtifact(
        verified,
        candidateArtifactRef,
        CANDIDATE_PURPOSE,
      );
      const preparationSnapshotRef = IdentificationPreparationSnapshotRefV1Schema.safeParse(
        (rawCandidate as { preparationSnapshotRef?: unknown } | undefined)?.preparationSnapshotRef,
      );
      const outcome = await validateIdentificationKnowledgePackage({
        value: rawCandidate,
        expectedDefinitionType: definitionType,
        dependencies: {
          projectId: command.projectId,
          policy: this.#policy,
          checkEvidence: async (input) => {
            if (!preparationSnapshotRef.success) return [];
            const checked = await this.#preparationReader.checkEvidence({
              projectId: command.projectId,
              preparationSnapshotRef: preparationSnapshotRef.data,
              evidenceReferences: input.evidenceReferences,
              purposeCode: input.purposeCode,
              actorId: command.actorId,
              requestedAt: command.issuedAt,
              requestId: `${command.commandId}:evidence`,
            });
            return checked.kind === "succeeded" ? checked.items : [];
          },
          resolveProcessModel: (releaseRef) =>
            this.#resolveProcessModelNodes(command.projectId, releaseRef, {
              actorId: command.actorId,
              issuedAt: command.issuedAt,
              invocationId: `${command.commandId}:process-model`,
            }),
          resolveCompositeMembers: async (members) =>
            await this.#resolveCompositeMembers(command.projectId, members),
        },
      });
      const packageValue = rawCandidate as IdentificationKnowledgePackageV1;
      const packageDigest = identificationKnowledgePackageDigest(packageValue);
      const validationArtifactRef = await this.#putArtifact(verifiedCommand, {
        artifactId: `c17-validation-${packageDigest.slice(0, 40)}`,
        purposeCode: VALIDATION_PURPOSE,
        value: {
          schemaVersion: SCHEMA_VERSION,
          projectId: command.projectId,
          definitionType,
          packageDigest,
          items: outcome.items,
          disposition: outcome.disposition,
        },
        parentArtifactRefs: [candidateArtifactRef],
      });
      const validationId = randomId("c17-validation");
      const validationAuditId = randomId("audit");
      const recordedAt = nowIso(this.#now);
      const buildAtomic = atomicCommand(verifiedCommand);
      const validationAtomic = buildAtomic({
        commandKind: "knowledge.identification-knowledge.validate.v1",
        commandId: `${command.commandId}:validation`,
        idempotencyKey: `${command.idempotencyKey}:validation`,
        payload: { packageDigest, disposition: outcome.disposition },
      });
      await this.#transactionUnit.execute(validationAtomic, async (context) => {
        // 候选工件在形成业务事实前必须由引用守卫按当前授权复验。
        await this.#artifactReferenceGuard.assertUsable(
          context,
          ArtifactReferenceCheckRequestV1Schema.parse({
            schemaVersion: SCHEMA_VERSION,
            artifactRef: candidateArtifactRef,
            projectId: command.projectId,
            purposeCode: CANDIDATE_PURPOSE,
            requiredCapability: verified.grantedCapabilities[0],
            authorization: verified,
          }),
        );
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_validations")
          .values({
            validation_id: validationId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            project_id: command.projectId,
            definition_type: definitionType,
            package_digest: packageDigest,
            validation_policy_ref: jsonbValue(this.#policy.policyRef),
            preparation_snapshot_ref: jsonbValue(
              preparationSnapshotRef.success ? preparationSnapshotRef.data : {},
            ),
            candidate_artifact_ref: jsonbValue(candidateArtifactRef),
            validation_artifact_ref: jsonbValue(validationArtifactRef),
            decisions: jsonbValue(outcome.items),
            disposition: outcome.disposition,
            rejection_class: outcome.rejectionClass ?? null,
            authorization_context_ref: jsonbValue(verified.authorizationContextRef),
            command_id: validationAtomic.commandId,
            idempotency_key: validationAtomic.idempotencyKey,
            actor_ref: validationAtomic.actorRef,
            audit_entry_id: validationAuditId,
            occurred_at: new Date(command.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          })
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: asContractReference(validationArtifactRef),
          audit: auditFor({
            command: validationAtomic,
            targetRef: candidateArtifactRef as never,
            action: "identification-knowledge.validate",
            occurredAt: command.issuedAt,
            recordedAt,
            auditEntryId: validationAuditId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      const persistedValidation = await this.#db
        .selectFrom("business.identification_knowledge_validations")
        .select(["validation_id", "version_id"])
        .where("project_id", "=", command.projectId)
        .where("idempotency_key", "=", validationAtomic.idempotencyKey)
        .executeTakeFirst();
      if (persistedValidation === undefined) {
        throw new KnowledgeLifecycleError({
          code: "ENTITY_NOT_FOUND",
          reasonCode: "identification-knowledge-validation-not-found",
          targetRef: asContractReference(validationArtifactRef),
        });
      }
      if (outcome.disposition === "rejected") {
        return KnowledgeGovernanceResultV1Schema.parse({
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: `identification-knowledge-${outcome.rejectionClass ?? "repairable"}`,
            blockerRef: asContractReference(validationArtifactRef),
          }),
        });
      }
      // C16 校验绑定在命令身份上：原样委派调用方命令，C17 仅用自己的派生键记录本地阶段。
      const submitted = await this.#governance.govern(verifiedCommand);
      if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
        return submitted.kind === "succeeded"
          ? KnowledgeGovernanceResultV1Schema.parse({
              kind: "failed",
              error: moduleError({ code: "TERMINAL_FAILURE", causalRunId: command.commandId }),
            })
          : submitted;
      }
      const revisionRef = submitted.result.knowledgeRevisionRef;
      const bindingAuditId = randomId("audit");
      const bindingAtomic = buildAtomic({
        commandKind: "knowledge.identification-knowledge.bind-revision.v1",
        commandId: `${command.commandId}:bind-revision`,
        idempotencyKey: `${command.idempotencyKey}:bind-revision`,
        payload: { revisionRef },
      });
      await this.#transactionUnit.execute(bindingAtomic, async (context) => {
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_revision_bindings")
          .values({
            revision_id: revisionRef.reference.entityId,
            revision_version_id: revisionRef.reference.versionId,
            schema_version: SCHEMA_VERSION,
            project_id: command.projectId,
            definition_type: definitionType,
            binding_kind: "validated",
            validation_id: persistedValidation.validation_id,
            validation_version_id: persistedValidation.version_id,
            package_digest: packageDigest,
            agent_task_ref: null,
            failure_artifact_ref: null,
            command_id: bindingAtomic.commandId,
            idempotency_key: bindingAtomic.idempotencyKey,
            actor_ref: bindingAtomic.actorRef,
            audit_entry_id: bindingAuditId,
            occurred_at: new Date(command.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          })
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: asContractReference(revisionRef),
          audit: auditFor({
            command: bindingAtomic,
            targetRef: asContractReference(revisionRef),
            action: "identification-knowledge.bind-revision",
            occurredAt: command.issuedAt,
            recordedAt,
            auditEntryId: bindingAuditId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      return submitted;
    } catch (error) {
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, command.commandId),
      });
    }
  }

  async #resolveProcessModelNodes(
    projectId: string,
    releaseRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    },
    command: {
      readonly actorId: string;
      readonly issuedAt: string;
      readonly invocationId: string;
    },
  ): Promise<
    | {
        readonly projectId: string;
        readonly nodes: readonly { readonly nodeId: string; readonly processKind: never }[];
      }
    | undefined
  > {
    const release = KnowledgeReleaseRefV1Schema.parse({
      kind: "knowledge-release",
      reference: releaseRef.reference,
    });
    // 校验期读取同样由组合根签发 identification-basis 上下文，不借用调用方命令能力。
    const authorization = await this.#authorize({
      projectId,
      actorId: command.actorId,
      invocationId: command.invocationId,
      branch: IDENTIFICATION_BASIS_BRANCH,
      requestedAt: command.issuedAt,
    });
    const read = await this.readExact({
      projectId,
      releaseRef: release,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      invocationId: command.invocationId,
      authorization,
    });
    if (read.kind === "failed") return undefined;
    if (read.read.package.definitionType !== "process-model") return undefined;
    return {
      projectId,
      nodes: read.read.package.nodes.map((node) => ({
        nodeId: node.nodeId,
        processKind: node.processKind as never,
      })),
    };
  }

  /**
   * 组合成员确定性校验：三个成员必须是本工程已绑定的精确 C17 发布，且类型与组合槽位一致；
   * 任一项不可解析即拒绝，不在读取正文前替换或补齐成员。
   */
  async #resolveCompositeMembers(
    projectId: string,
    members: {
      readonly riskMechanismReleaseRef: {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly standardLibraryReleaseRef: {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly caseLibraryReleaseRef: {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
    },
  ): Promise<boolean> {
    const expected = [
      ["risk-mechanism", members.riskMechanismReleaseRef],
      ["standard-library", members.standardLibraryReleaseRef],
      ["case-library", members.caseLibraryReleaseRef],
    ] as const;
    for (const [definitionType, releaseRef] of expected) {
      const release = KnowledgeReleaseRefV1Schema.safeParse({
        kind: "knowledge-release",
        reference: releaseRef.reference,
      });
      if (!release.success) return false;
      const binding = await this.#findReleaseBindingByRef(projectId, release.data);
      if (binding === undefined || binding.definition_type !== definitionType) return false;
      const revisionBinding = await this.#findRevisionBinding(
        projectId,
        binding.revision_id,
        binding.revision_version_id,
      );
      if (revisionBinding === undefined || revisionBinding.binding_kind !== "validated") {
        return false;
      }
    }
    return true;
  }

  async #delegateGovern(
    command: KnowledgeGovernanceCommandV1,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      const verified = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.actorId,
        command.commandId,
        `knowledge-modeling.${command.kind}` as ModuleBranchV1,
      );
      const verifiedCommand = {
        ...command,
        authorization: verified,
      } as KnowledgeGovernanceCommandV1;
      if (command.kind === "request-review") {
        const binding = await this.#findRevisionBindingByRef(
          command.projectId,
          command.payload.revisionRef,
        );
        if (binding !== undefined && binding.binding_kind !== "validated") {
          return KnowledgeGovernanceResultV1Schema.parse({
            kind: "failed",
            error: moduleError({
              code: "BUSINESS_BLOCKED",
              causalRunId: command.commandId,
              blockerKind: "failure-review-only",
              blockerRef: asContractReference(command.payload.revisionRef),
            }),
          });
        }
        return await this.#governance.govern(verifiedCommand);
      }
      if (command.kind === "publish-approved-release") {
        const binding = await this.#findRevisionBindingByRef(
          command.projectId,
          command.payload.revisionRef,
        );
        if (binding !== undefined && binding.binding_kind !== "validated") {
          return KnowledgeGovernanceResultV1Schema.parse({
            kind: "failed",
            error: moduleError({
              code: "BUSINESS_BLOCKED",
              causalRunId: command.commandId,
              blockerKind: "identification-knowledge-binding-required",
              blockerRef: asContractReference(command.payload.revisionRef),
            }),
          });
        }
        // 发布绑定与组合事件由注入 C16 的 release policy 在同一事务提交；façade 不补写。
        return await this.#governance.govern(verifiedCommand);
      }
      return await this.#governance.govern(verifiedCommand);
    } catch (error) {
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, command.commandId),
      });
    }
  }

  async #resolveIdentificationBasis(
    command: Extract<KnowledgeResolutionCommandV1, { kind: "identification-basis" }>,
  ): Promise<KnowledgeResolutionResultV1> {
    try {
      await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.actorId,
        command.commandId,
        "knowledge-modeling.identification-basis",
      );
      const preparation = await this.#preparationReader.readExactPreparation({
        projectId: command.projectId,
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        actorId: command.actorId,
        requestId: `${command.commandId}:preparation`,
        requestedAt: command.issuedAt,
      });
      if (preparation.kind === "error") {
        return { kind: "failed", error: preparation.error };
      }
      const requiredAt = command.payload.requiredAt;
      const asOfRecordedAt = command.issuedAt;
      // C16 解析按派生 invocationId 绑定 C06：每次解析都由组合根为同一派生签发上下文。
      const resolveGovernedReleases = async (
        requiredDefinitionTypes: readonly KnowledgeDefinitionTypeV1[],
      ) => {
        const invocationId = governedReleaseResolutionInvocationId({
          requiredDefinitionTypes,
          requiredAt,
          asOfRecordedAt,
        });
        const authorization = await this.#authorize({
          projectId: command.projectId,
          actorId: command.actorId,
          invocationId,
          branch: IDENTIFICATION_BASIS_BRANCH,
          requestedAt: command.issuedAt,
        });
        return await this.#governance.resolveGovernedReleases({
          projectId: command.projectId,
          requiredDefinitionTypes,
          requiredAt,
          asOfRecordedAt,
          authorization,
        });
      };
      const resolved = await resolveGovernedReleases([
        "process-model",
        "risk-mechanism",
        "retrieval-evidence-base",
      ]);
      if (resolved.kind !== "succeeded") return resolved;
      const processModel = resolved.result.members.find(
        (member) => member.definitionType === "process-model",
      );
      const riskMechanism = resolved.result.members.find(
        (member) => member.definitionType === "risk-mechanism",
      );
      const composite = resolved.result.members.find(
        (member) => member.definitionType === "retrieval-evidence-base",
      );
      if (processModel === undefined || riskMechanism === undefined || composite === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "identification-basis-incomplete",
            blockerRef: asContractReference(command.payload.preparationSnapshotRef),
          }),
        };
      }
      const compositeBinding = await this.#findReleaseBindingByRef(
        command.projectId,
        composite.releaseRef,
      );
      if (
        compositeBinding === undefined ||
        compositeBinding.composite_member_release_refs === null
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-unbound",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      const storedMembers = Array.isArray(compositeBinding.composite_member_release_refs)
        ? compositeBinding.composite_member_release_refs
        : [];
      const members = storedMembers.flatMap((value) => {
        const parsed = KnowledgeReleaseRefV1Schema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      });
      if (members.length !== 3) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-unbound",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      const memberResolution = await resolveGovernedReleases(["standard-library", "case-library"]);
      if (memberResolution.kind !== "succeeded") return memberResolution;
      const compositeReadInvocationId = `knowledge-read-${refKey(composite.releaseRef)}`;
      const compositeRead = await this.readExact({
        projectId: command.projectId,
        releaseRef: composite.releaseRef,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        invocationId: compositeReadInvocationId,
        authorization: await this.#authorize({
          projectId: command.projectId,
          actorId: command.actorId,
          invocationId: compositeReadInvocationId,
          branch: IDENTIFICATION_BASIS_BRANCH,
          requestedAt: command.issuedAt,
        }),
      });
      if (compositeRead.kind === "failed") return { kind: "failed", error: compositeRead.error };
      const compositePackage = compositeRead.read.package;
      if (compositePackage.definitionType !== "retrieval-evidence-base") {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-mismatch",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      if (
        !versionedEquals(compositePackage.riskMechanismReleaseRef, riskMechanism.releaseRef) ||
        !memberResolution.result.releaseRefs.every((resolvedMember) =>
          members.some((member) => versionedEquals(member, resolvedMember)),
        )
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-mechanism-mismatch",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      const policySetRef =
        this.#policySetProvider === undefined
          ? undefined
          : await this.#policySetProvider.resolveExact({
              projectId: command.projectId,
              preparationSnapshotRef: command.payload.preparationSnapshotRef,
              requiredAt,
              asOfRecordedAt,
              authorization: command.authorization,
            });
      if (policySetRef === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "identification-policy-set-unavailable",
            blockerRef: asContractReference(command.payload.preparationSnapshotRef),
          }),
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "identification-basis",
          processModelReleaseRef: ProcessModelReleaseRefV1Schema.parse({
            kind: "process-model-release",
            reference: processModel.releaseRef.reference,
          }),
          riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema.parse({
            kind: "risk-mechanism-release",
            reference: riskMechanism.releaseRef.reference,
          }),
          retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema.parse({
            kind: "retrieval-evidence-base-release",
            reference: composite.releaseRef.reference,
          }),
          identificationPolicySetRef: policySetRef,
        },
      };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, command.commandId) };
    }
  }

  // --------------------------------------------------------------- C08 编制面

  /** 组合根用本方法构造 `knowledge-authoring` 的 C08 任务定义（动作、只读工具与收口裁缝）。 */
  createTaskDefinition() {
    const port: KnowledgeAuthoringTaskPortV1 = {
      readSegmentSlice: async (input, context) => await this.#readSegmentSliceTool(input, context),
      readExactKnowledge: async (input, context) =>
        await this.#readExactKnowledgeTool(input, context),
      validateAuthoringCandidate: async ({ task, candidate }) =>
        await this.#validateAuthoringCandidate(task, candidate),
      finalizeAuthoringCandidate: async ({ task, candidate }) =>
        await this.#finalizeAuthoringCandidate(task, candidate),
    };
    return createKnowledgeAuthoringTaskDefinition({ policy: this.#policy, port });
  }

  /** 冻结 manifest 工件后启动（或按同一身份重放）一次 C08 编制任务，并记录 attempt。 */
  async prepareOrReplayAuthoringTask(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly definitionType: IdentificationKnowledgeDefinitionTypeV1;
    readonly preparationSnapshotRef: unknown;
    readonly baseReleaseRef?: unknown;
    readonly parentRunRef: unknown;
    readonly commandId: string;
    readonly idempotencyKey: string;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly agentTaskRef: AgentTaskRefV1;
        readonly manifestArtifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>;
        readonly manifest: KnowledgeAuthoringManifestV1;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    try {
      const authorized = await this.#verifyAuthorization(
        input.authorization,
        input.projectId,
        input.actorId,
        input.commandId,
        "knowledge-modeling.submit-revision",
      );
      const preparationSnapshotRef = IdentificationPreparationSnapshotRefV1Schema.parse(
        input.preparationSnapshotRef,
      );
      const preparation = await this.#preparationReader.readExactPreparation({
        projectId: input.projectId,
        preparationSnapshotRef,
        actorId: input.actorId,
        requestId: `${input.commandId}:preparation`,
        requestedAt: input.issuedAt,
      });
      if (preparation.kind === "error") {
        return { kind: "failed", error: preparation.error };
      }
      // D-08：把 D-04 strict 准备、正式清洗结果与逐来源保留/排除资料段冻结进清单。
      const members = preparation.snapshot.sourceVersionRefs.flatMap((sourceVersionRef, index) => {
        const sourceSegmentSetRef = preparation.snapshot.includedSourceSegmentSetRefs[index];
        if (sourceSegmentSetRef === undefined) return [];
        return [
          {
            sourceVersionRef,
            sourceSegmentSetRef,
            retainedSegmentIds: [...retainedSegmentsFor(preparation.result, sourceVersionRef)],
            excludedSegmentIds: [
              ...new Set(
                preparation.result.inputs
                  .filter(
                    (status) =>
                      status.sourceVersionRef?.reference.entityId ===
                      sourceVersionRef.reference.entityId,
                  )
                  .flatMap((status) => status.excludedSegmentIds),
              ),
            ],
          },
        ];
      });
      if (members.length !== preparation.snapshot.sourceVersionRefs.length) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: input.commandId,
            blockerKind: "identification-preparation-members-incomplete",
            blockerRef: asContractReference(preparationSnapshotRef),
          }),
        };
      }
      const manifest = KnowledgeAuthoringManifestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        manifestId: `${input.commandId}:manifest`,
        projectId: input.projectId,
        targetDefinitionType: input.definitionType,
        preparationSnapshotRef,
        preparation: preparation.snapshot,
        cleaningResultArtifactRef: preparation.resultArtifactRef,
        members,
        validationPolicyRef: this.#policy.policyRef,
        ...(input.baseReleaseRef === undefined
          ? {}
          : { baseReleaseRef: KnowledgeReleaseRefV1Schema.parse(input.baseReleaseRef) }),
        parentRunRef: input.parentRunRef,
        authorizationContextRef: authorized.authorizationContextRef,
        agent: {
          definitionRef: this.#policy.agent.definitionRef,
          modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
          promptTemplateRef: this.#policy.agent.promptTemplateRef,
          toolPolicyRef: this.#policy.agent.toolPolicyRef,
          budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
          incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
          validationPolicyRef: this.#policy.agent.validationPolicyRef,
        },
        createdBy: input.actorId,
        createdAt: input.issuedAt,
      });
      const manifestArtifactRef = await this.#putArtifact(
        {
          projectId: input.projectId,
          actorId: input.actorId,
          issuedAt: input.issuedAt,
          authorization: authorized,
        },
        {
          artifactId: manifest.manifestId,
          purposeCode: MANIFEST_PURPOSE,
          value: manifest,
          parentArtifactRefs: [],
        },
      );
      const taskPort = this.#agentTaskPort;
      if (taskPort === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: input.commandId,
            blockerKind: "agent-task-port-required",
            blockerRef: asContractReference(manifestArtifactRef),
          }),
        };
      }
      // C08 启动需要 `agent-task.start` 能力：由组合根的冻结收窄授权提供，而不是调用方的知识分支上下文。
      // 启动身份必须与调用方命令区分：C06 每个 invocationId 只对应一个分支。
      const startCommandId = `${input.commandId}:start-task`;
      const startAuthorization = await this.#authorize({
        projectId: input.projectId,
        actorId: input.actorId,
        invocationId: startCommandId,
        branch: "agent-task.start-task",
        requestedAt: input.issuedAt,
      });
      const started = await taskPort.startTask(
        StartAgentTaskCommandV1Schema.parse({
          commandId: startCommandId,
          idempotencyKey: `${input.idempotencyKey}:start-task`,
          projectId: input.projectId,
          actorId: input.actorId,
          issuedAt: input.issuedAt,
          authorization: startAuthorization,
          kind: "start-task",
          payload: {
            taskType: "knowledge-authoring",
            triggerMode: "embedded",
            parentRunRef: input.parentRunRef,
            frozenInputRef: manifestArtifactRef,
            modelDeploymentRef: manifest.agent.modelDeploymentRef,
            promptTemplateRef: manifest.agent.promptTemplateRef,
            toolPolicyRef: manifest.agent.toolPolicyRef,
            budgetPolicyRef: manifest.agent.budgetPolicyRef,
            incrementSchemaRef: manifest.agent.incrementSchemaRef,
            validationPolicyRef: manifest.agent.validationPolicyRef,
          },
        }),
      );
      if (started.kind === "failed") {
        return { kind: "failed", error: started.error };
      }
      if (started.kind !== "succeeded") {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: input.commandId,
            blockerKind: "agent-task-not-started",
            blockerRef: asContractReference(manifestArtifactRef),
          }),
        };
      }
      const agentTaskRef = (started.result as { agentTaskRef: AgentTaskRefV1 }).agentTaskRef;
      const attemptId = randomId("c17-attempt");
      const auditEntryId = randomId("audit");
      const recordedAt = nowIso(this.#now);
      const atomic = atomicCommand({
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
      })({
        commandKind: "knowledge.identification-knowledge.prepare-authoring.v1",
        // C03 回执按命令身份唯一：C08 启动已占用调用方命令，本地阶段使用稳定派生键。
        commandId: `${input.commandId}:attempt`,
        idempotencyKey: `${input.idempotencyKey}:attempt`,
        payload: { manifestArtifactRef, agentTaskRef },
      });
      await this.#transactionUnit.execute(atomic, async (context) => {
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_authoring_attempts")
          .values({
            attempt_id: attemptId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            project_id: input.projectId,
            definition_type: input.definitionType,
            manifest_artifact_ref: jsonbValue(manifestArtifactRef),
            preparation_snapshot_ref: jsonbValue(preparationSnapshotRef),
            manifest_digest: sha256CanonicalJson(manifest),
            agent_task_ref: jsonbValue(agentTaskRef),
            stage: "task-started",
            result_revision_ref: null,
            failure_artifact_ref: null,
            review_task_ref: null,
            command_id: atomic.commandId,
            idempotency_key: atomic.idempotencyKey,
            actor_ref: atomic.actorRef,
            audit_entry_id: auditEntryId,
            occurred_at: new Date(input.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          } as never)
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: manifestArtifactRef,
          audit: auditFor({
            command: atomic,
            targetRef: manifestArtifactRef,
            action: "identification-knowledge.prepare-authoring",
            occurredAt: input.issuedAt,
            recordedAt,
            auditEntryId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      return { kind: "succeeded", agentTaskRef, manifestArtifactRef, manifest };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, input.commandId) };
    }
  }

  async #readManifest(task: AgentTaskSnapshotV1): Promise<KnowledgeAuthoringManifestV1> {
    const frozen = task.envelope.frozenInputRef;
    return KnowledgeAuthoringManifestV1Schema.parse(
      await this.#readArtifact(
        task.envelope.authorization,
        ContractCandidateArtifactRefV1Schema.parse(frozen),
        MANIFEST_PURPOSE,
      ),
    );
  }

  /**
   * 工具成员双层校验：C08 已按任务定义校验 tool ref，这里在目标读取前再校验请求对象
   * 属于清单冻结成员，越界请求不触达任何目标端口。
   */
  #assertSliceMember(
    manifest: KnowledgeAuthoringManifestV1,
    request: {
      readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
      readonly sourceSegmentIds: readonly string[];
      readonly limit: number;
    },
    context: AgentDomainToolExecutionContextV1,
  ): void {
    const member = manifest.members.find((candidate) =>
      versionedEquals(candidate.sourceSegmentSetRef, request.sourceSegmentSetRef),
    );
    const retained = new Set(member?.retainedSegmentIds ?? []);
    const withinBudget = request.limit <= this.#policy.agent.budgetPolicy.maxObjects;
    if (
      member === undefined ||
      !withinBudget ||
      !request.sourceSegmentIds.every((segmentId) => retained.has(segmentId))
    ) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.segment-slice.member",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
  }

  async #readSegmentSliceTool(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const request = KnowledgeAuthoringSegmentSliceRequestV1Schema.parse(input);
    const manifest = await this.#readManifest(context.task);
    this.#assertSliceMember(manifest, request, context);
    const read = await this.#preparationReader.readSegmentSlice({
      taskRef: context.taskRef,
      projectId: manifest.projectId,
      preparationSnapshotRef: manifest.preparationSnapshotRef,
      sourceSegmentSetRef: request.sourceSegmentSetRef,
      segmentIds: request.sourceSegmentIds,
      limit: request.limit,
      actorId: context.task.envelope.actorId,
      requestId: `${context.actionId}:segment-slice`,
      requestedAt: context.task.envelope.createdAt,
    });
    if (read.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_FAILURE",
          category: "tool",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.segment-slice",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
    const observationArtifactRef = await this.#putArtifact(
      {
        projectId: manifest.projectId,
        actorId: context.task.envelope.actorId,
        issuedAt: context.task.envelope.createdAt,
        authorization: context.task.envelope.authorization,
      },
      {
        artifactId: `${context.actionId}:segment-slice`,
        purposeCode: OBSERVATION_PURPOSE,
        value: read.observation,
        parentArtifactRefs: [],
      },
    );
    const segments = read.observation.segments;
    return {
      observationArtifactRef,
      effect: "none",
      usage: {
        ...emptyAgentBudgetUsage(),
        objects: Array.isArray(segments) ? segments.length : 0,
      },
    };
  }

  async #readExactKnowledgeTool(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const request = KnowledgeAuthoringBaselineReadRequestV1Schema.parse(input);
    const manifest = await this.#readManifest(context.task);
    const baseline = manifest.baseReleaseRef;
    // 基线读取必须精确等于清单冻结的类型与发布，不把“工具在白名单”当作任意对象读取权。
    if (
      baseline === undefined ||
      request.definitionType !== manifest.targetDefinitionType ||
      !versionedEquals(baseline, request.releaseRef)
    ) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.baseline-read.member",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
    const invocationId = `${context.actionId}:baseline-read`;
    const read = await this.readExact({
      projectId: manifest.projectId,
      releaseRef: request.releaseRef,
      actorId: context.task.envelope.actorId,
      requestedAt: context.task.envelope.createdAt,
      invocationId,
      authorization: await this.#authorize({
        taskRef: context.taskRef,
        projectId: manifest.projectId,
        actorId: context.task.envelope.actorId,
        invocationId,
        branch: IDENTIFICATION_BASIS_BRANCH,
        requestedAt: context.task.envelope.createdAt,
      }),
    });
    if (read.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_FAILURE",
          category: "tool",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.baseline-read",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
    const observationArtifactRef = await this.#putArtifact(
      {
        projectId: manifest.projectId,
        actorId: context.task.envelope.actorId,
        issuedAt: context.task.envelope.createdAt,
        authorization: context.task.envelope.authorization,
      },
      {
        artifactId: `${context.actionId}:baseline-read`,
        purposeCode: OBSERVATION_PURPOSE,
        value: {
          definitionType: read.read.package.definitionType,
          packageDigest: identificationKnowledgePackageDigest(read.read.package),
          validationDisposition: read.read.validation.disposition,
        },
        parentArtifactRefs: [read.read.releaseBinding.candidateArtifactRef],
      },
    );
    return {
      observationArtifactRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: 1 },
    };
  }

  async #applyCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<
    | {
        readonly kind: "applied";
        readonly manifest: KnowledgeAuthoringManifestV1;
        readonly package: IdentificationKnowledgePackageV1;
        readonly packageDigest: string;
      }
    | {
        readonly kind: "rejected";
        readonly items: readonly unknown[];
        readonly rejectionClass: string;
      }
  > {
    const manifest = await this.#readManifest(task);
    const baseline =
      manifest.baseReleaseRef === undefined
        ? undefined
        : await this.#readBaselinePackage(manifest, task);
    const applied = applyKnowledgeAuthoringIncrement({
      projectId: manifest.projectId,
      preparationSnapshotRef: manifest.preparationSnapshotRef,
      baseline: baseline?.package,
      baselineDigest: baseline?.packageDigest,
      increment: candidate as never,
      generatedAt: nowIso(this.#now),
      policy: this.#policy,
    });
    if (applied.kind === "rejected") {
      return {
        kind: "rejected",
        items: applied.outcome.items,
        rejectionClass: applied.outcome.rejectionClass ?? "repairable",
      };
    }
    return {
      kind: "applied",
      manifest,
      package: applied.package,
      packageDigest: applied.packageDigest,
    };
  }

  async #readBaselinePackage(
    manifest: KnowledgeAuthoringManifestV1,
    task: AgentTaskSnapshotV1,
  ): Promise<
    | { readonly package: IdentificationKnowledgePackageV1; readonly packageDigest: string }
    | undefined
  > {
    if (manifest.baseReleaseRef === undefined) return undefined;
    const invocationId = `${task.envelope.commandId}:baseline`;
    const read = await this.readExact({
      projectId: manifest.projectId,
      releaseRef: manifest.baseReleaseRef,
      actorId: task.envelope.actorId,
      requestedAt: task.envelope.createdAt,
      invocationId,
      authorization: await this.#authorize({
        taskRef: task.envelope.agentTaskRef,
        projectId: manifest.projectId,
        actorId: task.envelope.actorId,
        invocationId,
        branch: IDENTIFICATION_BASIS_BRANCH,
        requestedAt: task.envelope.createdAt,
      }),
    });
    if (read.kind === "failed") return undefined;
    return {
      package: read.read.package,
      packageDigest: identificationKnowledgePackageDigest(read.read.package),
    };
  }

  async #validateAuthoringCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<AgentValidationResultV1> {
    const applied = await this.#applyCandidate(task, candidate);
    const outcome =
      applied.kind === "rejected"
        ? {
            items: applied.items,
            disposition: "rejected" as const,
            rejectionClass: applied.rejectionClass as "repairable" | "terminal",
          }
        : await this.#validatePackage(task, applied.package);
    // C08 校验项只接受检查身份/处置/原因/证据；逐项目标以 checkId 后缀保留可定位性。
    const agentItems = (
      outcome.items as readonly {
        readonly checkId: string;
        readonly targetId?: string;
        readonly disposition: "accepted" | "rejected";
        readonly rejectionClass?: "repairable" | "terminal";
        readonly reasonCode: string;
        readonly evidenceReferences?: readonly unknown[];
      }[]
    ).map((item) => ({
      checkId: `${item.checkId}#${item.targetId ?? "package"}`,
      disposition: item.disposition,
      ...(item.rejectionClass === undefined ? {} : { rejectionClass: item.rejectionClass }),
      reasonCode: item.reasonCode,
      evidenceReferences: [...(item.evidenceReferences ?? [])],
    }));
    const validationArtifactRef = await this.#putArtifact(
      {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        issuedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
      },
      {
        artifactId: `${task.envelope.commandId}:validation-${sha256CanonicalJson(candidate).slice(0, 16)}`,
        purposeCode: VALIDATION_PURPOSE,
        value: {
          schemaVersion: SCHEMA_VERSION,
          items: agentItems,
          disposition: outcome.disposition,
          ...(outcome.rejectionClass === undefined
            ? {}
            : { rejectionClass: outcome.rejectionClass }),
        },
        parentArtifactRefs: [],
      },
    );
    return AgentValidationResultV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      items: agentItems,
      disposition: outcome.disposition,
      ...(outcome.rejectionClass === undefined ? {} : { rejectionClass: outcome.rejectionClass }),
      validationArtifactRef,
      validatedAt: nowIso(this.#now),
    });
  }

  async #validatePackage(
    task: AgentTaskSnapshotV1,
    packageValue: IdentificationKnowledgePackageV1,
  ) {
    return await validateIdentificationKnowledgePackage({
      value: packageValue,
      expectedDefinitionType: packageValue.definitionType,
      dependencies: {
        projectId: packageValue.projectId,
        policy: this.#policy,
        checkEvidence: async (input) => {
          const checked = await this.#preparationReader.checkEvidence({
            taskRef: task.envelope.agentTaskRef,
            projectId: packageValue.projectId,
            preparationSnapshotRef: packageValue.preparationSnapshotRef,
            evidenceReferences: input.evidenceReferences,
            purposeCode: input.purposeCode,
            actorId: task.envelope.actorId,
            requestId: `${task.envelope.commandId}:evidence`,
            requestedAt: task.envelope.createdAt,
          });
          return checked.kind === "succeeded" ? checked.items : [];
        },
        resolveProcessModel: async (releaseRef) =>
          await this.#resolveProcessModelNodes(packageValue.projectId, releaseRef, {
            actorId: task.envelope.actorId,
            issuedAt: task.envelope.createdAt,
            invocationId: `${task.envelope.commandId}:process-model`,
          }),
        resolveCompositeMembers: async (members) =>
          await this.#resolveCompositeMembers(packageValue.projectId, members),
      },
    });
  }

  async #finalizeAuthoringCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<AgentTaskResultRefV1> {
    const applied = await this.#applyCandidate(task, candidate);
    if (applied.kind === "rejected") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_VALIDATION_REJECTED",
          category: "validation",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.apply",
          taskRef: task.envelope.agentTaskRef,
          reasonCode: applied.rejectionClass,
        }),
      );
    }
    const outcome = await this.#validatePackage(task, applied.package);
    if (outcome.disposition !== "accepted") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_VALIDATION_REJECTED",
          category: "validation",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.validate",
          taskRef: task.envelope.agentTaskRef,
          reasonCode: outcome.rejectionClass ?? "rejected",
        }),
      );
    }
    const candidateArtifactRef = await this.#putArtifact(
      {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        issuedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
      },
      {
        artifactId: `${task.envelope.agentTaskRef.reference.entityId}:package-${applied.packageDigest.slice(0, 16)}`,
        purposeCode: CANDIDATE_PURPOSE,
        value: applied.package,
        parentArtifactRefs: [],
      },
    );
    const submitCommandId = `${task.envelope.agentTaskRef.reference.entityId}:submit`;
    const authorization = await this.#authorize({
      taskRef: task.envelope.agentTaskRef,
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      invocationId: submitCommandId,
      branch: "knowledge-modeling.submit-revision",
      requestedAt: nowIso(this.#now),
    });
    const submitted = await this.#submitIdentificationRevision(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId: submitCommandId,
        idempotencyKey: submitCommandId,
        projectId: task.envelope.projectId,
        actorId: authorization.actorId,
        issuedAt: nowIso(this.#now),
        authorization,
        payload: {
          definitionType: applied.manifest.targetDefinitionType,
          candidateArtifactRef,
          evidenceReferences: [...submissionEvidenceReferences(applied.package, applied.manifest)],
        },
      }) as Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
    );
    if (submitted.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: submitted.error.retryable,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
          ...((submitted.error as { reasonCode?: string }).reasonCode === undefined
            ? {}
            : { reasonCode: (submitted.error as { reasonCode?: string }).reasonCode }),
        }),
      );
    }
    if (submitted.kind !== "succeeded") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: true,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    if (submitted.result.kind !== "revision") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    await this.#advanceAuthoringAttempt({
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      authorization,
      taskRef: task.envelope.agentTaskRef,
      commandSuffix: "complete-attempt",
      commandKind: "knowledge.identification-knowledge.complete-authoring.v1",
      action: "identification-knowledge.complete-authoring",
      expectedStages: ["task-started"],
      stage: "completed",
      resultRef: asContractReference(submitted.result.knowledgeRevisionRef),
      values: {
        result_revision_ref: jsonbValue(submitted.result.knowledgeRevisionRef),
      },
    });
    // C08 完成结果要求 validation-snapshot 校验引用，而不是候选工件引用。
    return buildCompletedAgentTaskResult(
      task.envelope.agentTaskRef,
      asContractReference(submitted.result.knowledgeRevisionRef),
      asContractReference({
        kind: "validation-snapshot",
        reference: { entityId: `${submitCommandId}:validation`, versionId: "1" },
      }),
      ["knowledge-revision"],
    );
  }

  /**
   * D-09 失败收口：只扫描 C17 未收口的编制尝试，再经 C08 公共窄读取精确任务的终态失败证据。
   * 逐 attempt 隔离：单个 attempt 的授权或调用失败被记录为可验错误并继续处理其余工程，
   * 该 attempt 保留最后已成立阶段（不回滚其它工程的稳定事实），不得静默吞掉。
   */
  async settleAuthoringFailures(): Promise<IdentificationKnowledgeFailureSettlementV1> {
    const rows = await this.#db
      .selectFrom("business.identification_knowledge_authoring_attempts")
      .selectAll()
      // 停在 `failure-revision-bound` 的尝试只补未完成阶段；已成立的事实不会重复创建。
      .where("stage", "in", ["prepared", "task-started", "failure-revision-bound"])
      // 显式顺序：同一批失败不会持续把后面的工程排在异常工程之后。
      .orderBy("project_id", "asc")
      .orderBy("attempt_id", "asc")
      .execute();
    const failures: {
      readonly taskRef: AgentTaskRefV1;
      readonly error: ModuleErrorV1;
    }[] = [];
    let settled = 0;
    for (const row of rows) {
      const parsedTaskRef = AgentTaskRefV1Schema.safeParse(row.agent_task_ref);
      try {
        await this.#settleOneFailure(row);
        settled += 1;
      } catch (error) {
        failures.push({
          // 行由本模块 strict 写入；损坏行的原因仍以原始引用呈现，不伪造 task ref。
          taskRef: parsedTaskRef.success
            ? parsedTaskRef.data
            : (row.agent_task_ref as unknown as AgentTaskRefV1),
          error: await this.#mapError(
            error,
            parsedTaskRef.success ? parsedTaskRef.data.reference.entityId : row.attempt_id,
          ),
        });
      }
    }
    return { settled, failures };
  }

  /**
   * 收口单个 attempt：任何结构化失败（C08 窄读拒绝、C16 提交/复核失败、授权拒绝、CAS 冲突）
   * 都以携带原 `ModuleErrorV1` 的错误上抛，由逐 attempt 隔离层写入 `failures[]`。
   * 只有真正收口完成的 attempt 才返回，不回 `false`/`undefined` 掩盖原因。
   */
  async #settleOneFailure(row: AuthoringAttemptRow): Promise<void> {
    const taskRef = AgentTaskRefV1Schema.parse(row.agent_task_ref);
    // 失败修订绑定是上一步的稳定事实：已有绑定时只补未完成的复核阶段，不重复读取或创建。
    let bound = await this.#findFailureBinding(row.project_id, taskRef);
    if (bound === undefined) {
      const evidence = await this.#readTerminalFailureEvidence(row, taskRef);
      bound = await this.#bindFailureRevision(row, taskRef, evidence);
    } else if (row.stage !== "failure-revision-bound") {
      const failureCommandId = `${taskRef.reference.entityId}:failure-revision`;
      const authorization = await this.#authorize({
        projectId: row.project_id,
        actorId: row.actor_ref,
        invocationId: failureCommandId,
        branch: "knowledge-modeling.submit-revision",
        requestedAt: nowIso(this.#now),
      });
      await this.#recordFailureAttempt(row, taskRef, bound.failureArtifactRef, authorization);
    }
    const reviewCommandId = `${taskRef.reference.entityId}:failure-review`;
    const reviewAuthorization = await this.#authorize({
      projectId: row.project_id,
      actorId: row.actor_ref,
      invocationId: reviewCommandId,
      // C16 复核分支（C07 的评审请求由 C16 内部按其自身接缝签发）。
      branch: "knowledge-modeling.request-review",
      requestedAt: nowIso(this.#now),
    });
    const review = await this.#requestFailureReview(
      row,
      bound.revisionRef,
      reviewCommandId,
      reviewAuthorization,
    );
    // 逐阶段 CAS：授权或复核失败保留上一阶段事实，重放只向前补未完成阶段。
    await this.#advanceAuthoringAttempt({
      projectId: row.project_id,
      actorId: row.actor_ref,
      authorization: reviewAuthorization,
      taskRef,
      commandSuffix: "link-failure-review",
      commandKind: "knowledge.identification-knowledge.link-authoring-review.v1",
      action: "identification-knowledge.link-authoring-review",
      expectedStages: ["failure-revision-bound"],
      stage: "review-linked",
      resultRef: asContractReference(review),
      values: {
        failure_artifact_ref: jsonbValue(bound.failureArtifactRef),
        review_task_ref: jsonbValue(review),
      },
    });
  }

  /**
   * D-09：以 C17 attempt 的精确任务引用和新鲜 C06 授权调用 C08 公共窄读。不存在、跨工程、
   * 错类型、未终态和未授权对 C17 呈现同形拒绝，未终态不收口；其它窄读失败可验上抛，
   * 不得 catch 后当作已收口。
   */
  async #readTerminalFailureEvidence(
    row: AuthoringAttemptRow,
    taskRef: AgentTaskRefV1,
  ): Promise<AgentTaskFailureEvidenceV1> {
    const requestId = `${taskRef.reference.entityId}:failure-evidence`;
    const requestedAt = nowIso(this.#now);
    const authorization = await this.#authorize({
      projectId: row.project_id,
      actorId: row.actor_ref,
      invocationId: requestId,
      branch: "agent-task.read-failure-evidence",
      requestedAt,
    });
    const read = await this.#agentTaskFailureEvidenceReader.readTerminalFailure({
      projectId: row.project_id,
      actorId: authorization.actorId,
      requestId,
      requestedAt,
      taskRef,
      expectedTaskType: "knowledge-authoring",
      authorization,
    });
    if (read.kind === "succeeded") return read.evidence;
    // C08 对不存在、跨工程、错类型、未终态和未授权返回同形拒绝：原因必须可查，
    // 不得在这里转成 undefined 被静默丢弃。
    throw new IdentificationKnowledgeModuleError(read.error);
  }

  /** D-09 第 1、2 步：写不可发布的失败诊断工件，经 C16 提交失败修订并写 failure-review-only 绑定。 */
  async #bindFailureRevision(
    row: AuthoringAttemptRow,
    taskRef: AgentTaskRefV1,
    evidence: AgentTaskFailureEvidenceV1,
  ): Promise<{
    readonly revisionRef: KnowledgeRevisionRefV1;
    readonly failureArtifactRef: ContentArtifactRefV1;
  }> {
    const failureCommandId = `${taskRef.reference.entityId}:failure-revision`;
    const authorization = await this.#authorize({
      projectId: row.project_id,
      actorId: row.actor_ref,
      invocationId: failureCommandId,
      branch: "knowledge-modeling.submit-revision",
      requestedAt: nowIso(this.#now),
    });
    const failureArtifactRef = await this.#putArtifact(
      {
        projectId: row.project_id,
        actorId: authorization.actorId,
        issuedAt: nowIso(this.#now),
        authorization,
      },
      {
        artifactId: `${taskRef.reference.entityId}:failure`,
        purposeCode: FAILURE_PURPOSE,
        value: KnowledgeAuthoringFailureV1Schema.parse({
          schemaVersion: SCHEMA_VERSION,
          projectId: row.project_id,
          targetDefinitionType: row.definition_type,
          preparationSnapshotRef: row.preparation_snapshot_ref,
          manifestArtifactRef: row.manifest_artifact_ref,
          taskRef,
          terminalStatus: evidence.terminalStatus,
          errorCodes: [evidence.error?.code ?? evidence.cancelReasonCode ?? "AGENT_CANCELLED"],
          actionRefs: [...evidence.actionRefs],
          candidateRefs: evidence.candidateArtifactRefs.map((ref) =>
            ContentArtifactRefV1Schema.parse(ref),
          ),
          validationRefs: evidence.validationArtifactRefs.map((ref) => ref.reference),
          usage: evidence.usage,
          diagnosticArtifactRef: {
            kind: "diagnostic-artifact",
            reference: {
              entityId: `identification-knowledge-failure-${taskRef.reference.entityId}`,
              versionId: `sha256:${sha256CanonicalJson({ taskRef })}`,
            },
          },
          occurredAt: nowIso(this.#now),
          recordedAt: nowIso(this.#now),
        }),
        parentArtifactRefs: [],
      },
    );
    const failureCommand: KnowledgeGovernanceCommandV1 = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "submit-revision",
      commandId: failureCommandId,
      idempotencyKey: failureCommandId,
      projectId: row.project_id,
      actorId: authorization.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
      payload: {
        definitionType: row.definition_type,
        candidateArtifactRef: failureArtifactRef,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: "identification-knowledge-failure-diagnostic" },
            sourceVersion: { entityId: "identification-knowledge", versionId: "1" },
          },
        ],
      },
    });
    const submitted = await this.#governance.govern(failureCommand);
    if (submitted.kind !== "succeeded") {
      throw new IdentificationKnowledgeModuleError(submitted.error);
    }
    if (submitted.result.kind !== "revision") {
      throw new IdentificationKnowledgeModuleError(
        moduleError({ code: "TERMINAL_FAILURE", causalRunId: failureCommandId }),
      );
    }
    const revisionRef = submitted.result.knowledgeRevisionRef;
    const bindingAuditId = randomId("audit");
    const bindingAtomic = atomicCommand({
      projectId: row.project_id,
      actorId: authorization.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
    })({
      commandKind: "knowledge.identification-knowledge.bind-failure-revision.v1",
      commandId: `${taskRef.reference.entityId}:bind-failure-revision`,
      idempotencyKey: `${taskRef.reference.entityId}:bind-failure-revision`,
      payload: { revisionRef },
    });
    await this.#transactionUnit.execute(bindingAtomic, async (context) => {
      const tx = asKnowledgeTransaction(context);
      await tx
        .insertInto("business.identification_knowledge_revision_bindings")
        .values({
          revision_id: revisionRef.reference.entityId,
          revision_version_id: revisionRef.reference.versionId,
          schema_version: SCHEMA_VERSION,
          project_id: row.project_id,
          definition_type: row.definition_type,
          binding_kind: "failure-review-only",
          validation_id: null,
          validation_version_id: null,
          package_digest: null,
          agent_task_ref: jsonbValue(taskRef),
          failure_artifact_ref: jsonbValue(failureArtifactRef),
          command_id: bindingAtomic.commandId,
          idempotency_key: bindingAtomic.idempotencyKey,
          actor_ref: bindingAtomic.actorRef,
          audit_entry_id: bindingAuditId,
          occurred_at: new Date(nowIso(this.#now)),
          recorded_at: new Date(nowIso(this.#now)),
          persisted_at: new Date(nowIso(this.#now)),
        } as never)
        .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
        .execute();
      return {
        resultRef: asContractReference(revisionRef),
        audit: auditFor({
          command: bindingAtomic,
          targetRef: asContractReference(revisionRef),
          action: "identification-knowledge.bind-failure-revision",
          occurredAt: bindingAtomic.issuedAt ?? nowIso(this.#now),
          recordedAt: nowIso(this.#now),
          auditEntryId: bindingAuditId,
        }),
        events: [],
      } satisfies AtomicCommitV1;
    });
    // 逐阶段 CAS：失败修订绑定成立后先停到 `failure-revision-bound`，授权或复核失败不回退该事实。
    await this.#recordFailureAttempt(row, taskRef, failureArtifactRef, authorization);
    return { revisionRef, failureArtifactRef };
  }

  async #recordFailureAttempt(
    row: AuthoringAttemptRow,
    taskRef: AgentTaskRefV1,
    failureArtifactRef: ContentArtifactRefV1,
    authorization: AuthorizationContextV1,
  ): Promise<void> {
    await this.#advanceAuthoringAttempt({
      projectId: row.project_id,
      actorId: authorization.actorId,
      authorization,
      taskRef,
      commandSuffix: "record-failure-attempt",
      commandKind: "knowledge.identification-knowledge.record-authoring-failure.v1",
      action: "identification-knowledge.record-authoring-failure",
      expectedStages: ["prepared", "task-started"],
      stage: "failure-revision-bound",
      resultRef: asContractReference(failureArtifactRef),
      values: { failure_artifact_ref: jsonbValue(failureArtifactRef) },
    });
  }

  async #advanceAuthoringAttempt(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly taskRef: AgentTaskRefV1;
    readonly commandSuffix: string;
    readonly commandKind: string;
    readonly action: string;
    readonly expectedStages: readonly string[];
    readonly stage: string;
    readonly resultRef: ContractReferenceV1;
    readonly values: Partial<AuthoringAttemptRow>;
  }): Promise<void> {
    const commandId = `${input.taskRef.reference.entityId}:${input.commandSuffix}`;
    const changedAt = nowIso(this.#now);
    const atomic = atomicCommand({
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: changedAt,
      authorization: input.authorization,
    })({
      commandKind: input.commandKind,
      commandId,
      idempotencyKey: commandId,
      payload: { taskRef: input.taskRef, stage: input.stage, ...input.values },
    });
    await this.#transactionUnit.execute(atomic, async (context) => {
      const updated = await asKnowledgeTransaction(context)
        .updateTable("business.identification_knowledge_authoring_attempts")
        .set({ ...input.values, stage: input.stage, persisted_at: new Date(changedAt) } as never)
        .where("project_id", "=", input.projectId)
        .where("agent_task_ref", "=", jsonbValue(input.taskRef))
        .where("stage", "in", [...input.expectedStages])
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw new KnowledgeLifecycleError({
          code: "STALE_VERSION",
          reasonCode: "identification-authoring-attempt-stage-mismatch",
          targetRef: asContractReference(input.taskRef),
        });
      }
      const auditEntryId = randomId("audit");
      return {
        resultRef: input.resultRef,
        audit: auditFor({
          command: atomic,
          targetRef: input.resultRef,
          action: input.action,
          occurredAt: changedAt,
          recordedAt: changedAt,
          auditEntryId,
        }),
        events: [],
      } satisfies AtomicCommitV1;
    });
  }

  /** D-09：失败修订由 C16 转 C07 复核，绑定 failure-review-only 永不可发布。 */
  async #requestFailureReview(
    row: AuthoringAttemptRow,
    revisionRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
    commandId: string,
    authorization: AuthorizationContextV1,
  ): Promise<ReviewTaskRefV1> {
    const reviewCommand = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "request-review",
      commandId,
      idempotencyKey: commandId,
      projectId: row.project_id,
      actorId: authorization.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
      payload: {
        revisionRef: asContractReference(revisionRef),
        reviewPolicyRef: { entityId: "identification-knowledge-failure-review", versionId: "1" },
      },
    }) as Extract<KnowledgeGovernanceCommandV1, { kind: "request-review" }>;
    const requested = await this.#governance.govern(reviewCommand);
    if (requested.kind !== "succeeded") {
      throw new IdentificationKnowledgeModuleError(requested.error);
    }
    if (requested.result.kind !== "review-task") {
      throw new IdentificationKnowledgeModuleError(
        moduleError({ code: "TERMINAL_FAILURE", causalRunId: commandId }),
      );
    }
    return requested.result.reviewTaskRef;
  }

  // ------------------------------------------------------------------- helpers

  async #verifyAuthorization(
    authorization: AuthorizationContextV1,
    projectId: string,
    actorId: string,
    invocationId: string,
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      authorization.projectId !== projectId ||
      authorization.actorId !== actorId ||
      authorization.grantedCapabilities.length !== 1 ||
      authorization.grantedCapabilities[0] !== capability
    ) {
      throw new IdentificationKnowledgeModuleError(
        moduleError({ code: "AUTHORIZATION_DENIED", branch, causalRunId: invocationId }),
      );
    }
    const decision = await this.#access.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: authorization.decidedAt,
    });
    const verified = decision.context;
    if (
      verified.projectId !== projectId ||
      verified.actorId !== actorId ||
      verified.grantedCapabilities.length !== 1 ||
      verified.grantedCapabilities[0] !== capability
    ) {
      throw new IdentificationKnowledgeModuleError(
        moduleError({ code: "AUTHORIZATION_DENIED", branch, causalRunId: invocationId }),
      );
    }
    return verified;
  }

  async #findValidation(
    projectId: string,
    validationId: string | null,
    versionId: string | null,
  ): Promise<ValidationRowSelect | undefined> {
    if (validationId === null || versionId === null) return undefined;
    return await this.#db
      .selectFrom("business.identification_knowledge_validations")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("validation_id", "=", validationId)
      .where("version_id", "=", versionId)
      .executeTakeFirst();
  }

  async #findRevisionBinding(
    projectId: string,
    revisionId: string,
    versionId: string,
  ): Promise<RevisionBindingRow | undefined> {
    return await this.#db
      .selectFrom("business.identification_knowledge_revision_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionId)
      .where("revision_version_id", "=", versionId)
      .executeTakeFirst();
  }

  async #findRevisionBindingByRef(
    projectId: string,
    revisionRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<RevisionBindingRow | undefined> {
    return await this.#findRevisionBinding(
      projectId,
      revisionRef.reference.entityId,
      revisionRef.reference.versionId,
    );
  }

  /**
   * `failure-revision-bound` 的稳定事实：按精确任务引用取回失败修订绑定，重放不重复读取
   * C08 证据、不创建第二个修订。
   */
  async #findFailureBinding(
    projectId: string,
    taskRef: AgentTaskRefV1,
  ): Promise<
    | {
        readonly revisionRef: KnowledgeRevisionRefV1;
        readonly failureArtifactRef: ContentArtifactRefV1;
      }
    | undefined
  > {
    const row = await this.#db
      .selectFrom("business.identification_knowledge_revision_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("binding_kind", "=", "failure-review-only")
      .where("agent_task_ref", "=", jsonbValue(taskRef))
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return {
      revisionRef: KnowledgeRevisionRefV1Schema.parse({
        kind: "knowledge-revision",
        reference: { entityId: row.revision_id, versionId: row.revision_version_id },
      }),
      failureArtifactRef: ContentArtifactRefV1Schema.parse(row.failure_artifact_ref),
    };
  }

  async #findReleaseBindingByRef(
    projectId: string,
    releaseRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<ReleaseBindingRow | undefined> {
    return await this.#db
      .selectFrom("business.identification_knowledge_release_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("release_id", "=", releaseRef.reference.entityId)
      .where("release_version_id", "=", releaseRef.reference.versionId)
      .executeTakeFirst();
  }

  async #putArtifact(
    command: {
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    spec: {
      readonly artifactId: string;
      readonly purposeCode: string;
      readonly value: unknown;
      readonly parentArtifactRefs: readonly {
        readonly kind: string;
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
    },
  ): Promise<ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>> {
    const bytes = new TextEncoder().encode(JSON.stringify(spec.value));
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: `${spec.artifactId}:put`,
        idempotencyKey: `${spec.artifactId}:put`,
        projectId: command.projectId,
        actorId: command.actorId,
        issuedAt: command.issuedAt,
        authorization: command.authorization,
        requiredCapability: command.authorization.grantedCapabilities[0],
        artifactId: spec.artifactId,
        artifactKind: "content",
        purposeCode: spec.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [...spec.parentArtifactRefs].sort((left, right) =>
          refKey(left) < refKey(right) ? -1 : 1,
        ),
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(bytes),
    );
    return ContractCandidateArtifactRefV1Schema.parse(result.artifactRef);
  }

  async #readArtifact(
    authorization: AuthorizationContextV1,
    artifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>,
    purposeCode: string,
  ): Promise<unknown> {
    return await readContentArtifact(this.#artifactStore, {
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      requestedAt: authorization.decidedAt,
      authorization,
      artifactRef,
      purposeCode,
    });
  }

  async #mapError(error: unknown, causalRunId: string): Promise<ModuleErrorV1> {
    // 收口按 attempt 隔离时必须保留结构化失败的原始原因码，不降级为通用终止失败。
    if (error instanceof IdentificationKnowledgeModuleError) return error.error;
    if (error instanceof AccessServiceError) {
      return moduleError({
        code:
          error.details.code === "IDEMPOTENCY_CONFLICT"
            ? "STALE_VERSION"
            : error.details.code === "AUTHORIZATION_DENIED"
              ? "AUTHORIZATION_DENIED"
              : "TERMINAL_FAILURE",
        branch: "knowledge-modeling.submit-revision",
        causalRunId,
      } as never);
    }
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "ARTIFACT_ACCESS_DENIED") {
      return moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: "knowledge-modeling.submit-revision",
        causalRunId,
      });
    }
    if (code === "ARTIFACT_NOT_FOUND") {
      return moduleError({
        code: "ENTITY_NOT_FOUND",
        causalRunId,
        targetRef: asContractReference({
          kind: "content-artifact",
          reference: { entityId: "unknown-artifact", versionId: "1" },
        }),
      });
    }
    return moduleError({ code: "TERMINAL_FAILURE", causalRunId });
  }
}

export const createPostgresIdentificationKnowledgeAdapter = (
  options: PostgresIdentificationKnowledgeAdapterOptionsV1,
): PostgresIdentificationKnowledgeAdapter => new PostgresIdentificationKnowledgeAdapter(options);
