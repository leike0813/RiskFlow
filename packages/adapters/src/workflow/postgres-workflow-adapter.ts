/**
 * C30 自有运行事实的 PostgreSQL 适配器（design D-05/D-06/D-07）。
 *
 * 只写入/回读本 change 的三张追加表与 C04 正文，不读其它模块私表，不复制领域事实；
 * 运行事实登记只接受调用方已持有的 ambient C03 事务（登记、审计与命令回执同事务提交），
 * 查询登记与正文读写自行完成当前授权复验并留下审计/收据。
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { Kysely, Transaction, SqlBool } from "kysely";
import { sql } from "kysely";

import type { VersionReference } from "@riskflow/contracts/common";
import type {
  AuthorizationContextV1,
  ContentArtifactRefV1,
  ContractReferenceV1,
  ModuleBranchV1,
  ModuleCapabilityV1,
  ModuleErrorV1,
  ResponseWorkflowBindingProofPortV1,
  ResponseWorkflowBindingProofQueryV1,
  ResponseWorkflowBindingProofResultV1,
  ReviewTaskRefV1,
  RiskAssessmentRecordRefV1,
  WorkflowRunCompletionProofPortV1,
  WorkflowRunCompletionProofQueryV1,
  WorkflowRunCompletionProofResultV1,
  WorkflowRunRefV1,
  IdentificationPreparationSnapshotRefV1,
  StandardizedRiskRecordRefV1,
  WaitingRefV1,
} from "@riskflow/contracts/ports";
import {
  AuthorizationContextV1Schema,
  ContractReferenceV1Schema,
  ModuleErrorV1Schema,
  ReviewTaskRefV1Schema,
  WaitingRefV1Schema,
  StageResultRefV1Schema,
  ResponseWorkflowBindingProofQueryV1Schema,
  ResponseWorkflowBindingProofResultV1Schema,
  WorkflowRunCompletionProofQueryV1Schema,
  WorkflowRunCompletionProofResultV1Schema,
  WorkflowRunRefV1Schema,
} from "@riskflow/contracts/ports";
import { ACCESS_POLICY_REF_V1, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  AssessmentEntrySnapshotRefV1Schema,
  type AssessmentEntrySnapshotRefV1,
} from "@riskflow/contracts/workflows";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  sha256CanonicalJson,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  WorkflowGraphArtifactBodyV1Schema,
  WorkflowGraphLinkV1Schema,
  WorkflowGraphResultRowV1Schema,
  WorkflowGraphRunStateV1Schema,
  WorkflowQueryRegistrationV1Schema,
  WorkflowRunStageV1Schema,
  AssessmentRunProjectionV1Schema,
  workflowGraphInvocationIdV1,
  workflowEntryIdentityFor,
  type AssessmentEntryMetadataV1,
  type AssessmentEntriesReadPortV1,
  type AssessmentRunProjectionV1,
  type AssessmentRunReadPortV1,
  type AssessmentRunStageV1,
  type WorkflowGraphArtifactBodyV1,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphLinkV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
  type WorkflowQueryRegistrationV1,
  type WorkflowRegisterOutcomeV1,
} from "@riskflow/core/workflow";

import { makePersistenceError, mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";
import type { PostgresTransactionUnit } from "../postgres/transaction-unit.js";

const RESULTS_TABLE = "business.workflow_graph_results";
const LINKS_TABLE = "business.workflow_graph_links";
const QUERIES_TABLE = "business.workflow_query_results";
const MAX_BODY_BYTES_V1 = 16 * 1024 * 1024;
/** 入口元数据窄读的单批上限：与 C34 目录页大小同量级，避免把整段历史一次读入内存。 */
const ASSESSMENT_ENTRIES_MAX_V1 = 50;
/** 每个运行在一次批量定位中最多取回的入口/状态登记行数。 */
const ASSESSMENT_RUN_FACTS_MAX_V1 = 16;
/** 产出评估记录的正式链边关系；定位只用这一条，不做全表扫描。 */
const ASSESSMENT_LINK_RELATION_V1 = "risk-assessment" as const;
/** 父子归属只认 `parent-child` 链边，不看运行 id 前缀或父字段自证。 */
const RUN_READ_STAGE_CODE_V1 = "workflow.assessment-run-read";
const ASSESSMENT_RUN_STAGE_SCAN_V1 = 32;
const ASSESSMENT_RUN_RESULT_SCAN_V1 = 50;

const DEFAULT_ROW_LIMIT_V1 = 500;

const sameVersion = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

/** 跨 kind 的精确引用比较：只对带 `reference` 的版本化引用判等，其余按 kind+事件身份。 */
const sameRef = (left: ContractReferenceV1, right: ContractReferenceV1): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "domain-event" && right.kind === "domain-event") {
    return left.eventId === right.eventId && left.eventVersion === right.eventVersion;
  }
  return (
    "reference" in left && "reference" in right && sameVersion(left.reference, right.reference)
  );
};

/** 每类 C04 正文的用途码（design D-05）：写入与读取共用同一张表，旁路写入在读取时显式拒绝。 */
export const WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1 = {
  "run-state": "workflow-graph-run-state",
  "run-result": "workflow-graph-run-result",
} as const;
export type WorkflowGraphBodyKindV1 = keyof typeof WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1;

/**
 * design D-07：C30 不新增 capability，只复用既有 `workflow.*`、`projection.query` 与领域分支。
 * 复验分支由授权实际持有的 capability 唯一决定；未列出的 capability 一律拒绝。
 */
const BRANCH_BY_CAPABILITY_V1: Partial<Record<ModuleCapabilityV1, ModuleBranchV1>> = {
  "workflow.start": "workflow.start-run",
  "workflow.resume": "workflow.resume-run",
  "workflow.cancel": "workflow.cancel-run",
  "projection.query": "projection.query",
  "risk-assessment.prepare": "risk-assessment.initial",
  "risk-assessment.evaluate": "risk-assessment.evaluate",
  "warning-response.record": "warning-response.open",
  "warning-response.recommend": "warning-response.create-candidate",
  "review-audit.request": "review-audit.request-review",
  "agent-task.start": "agent-task.start-task",
};

/** 受保护读写的调用身份：签发方必须用同一函数派生，否则复验按拒绝收口（fail closed）。 */
export const workflowGraphReadInvocationIdV1 = workflowGraphInvocationIdV1;

/** C30 授权拒绝：只带稳定 detailCode，不携带正文与受限目标存在性。 */
export class WorkflowGraphDeniedErrorV1 extends Error {
  readonly detailCode: string;

  constructor(detailCode: string) {
    super(`workflow-graph authorization denied: ${detailCode}`);
    this.name = "WorkflowGraphDeniedErrorV1";
    this.detailCode = detailCode;
  }
}

/** jsonb 列以文本形式写入，避免驱动二次编码。 */
const jsonValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

const nullableJson = (value: unknown): JsonValue | null =>
  value === undefined ? null : jsonValue(value);

const isoOf = (value: Date | string): string =>
  typeof value === "string" ? new Date(value).toISOString() : value.toISOString();

export interface WorkflowGraphResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  run_id: string;
  run_version_id: string;
  parent_run_id: string | null;
  thread_id: string | null;
  entry_mode: string;
  command_id: string;
  idempotency_key: string;
  request_digest: string;
  artifact_ref: JsonValue | null;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  frozen_refs: JsonValue;
  stage: string | null;
  entry_identity: JsonValue | null;
  input_snapshot_ref: JsonValue | null;
  stage_result_ref: JsonValue | null;
  route_decision_ref: JsonValue | null;
  route_kind: string | null;
  waiting_ref: JsonValue | null;
  workflow_error_ref: JsonValue | null;
  run_result_ref: JsonValue | null;
  valid_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

export interface WorkflowGraphLinkDbRow {
  project_id: string;
  link_id: string;
  run_id: string;
  from_ref: JsonValue;
  to_ref: JsonValue;
  relation: string;
  source_stage: string;
  stage_result_ref: JsonValue | null;
  evidence_locator: JsonValue | null;
  authorization_context_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  recorded_at: Date | string;
  audit_entry_id: string;
}

interface WorkflowGraphQueryDbRow {
  project_id: string;
  query_result_id: string;
  query_result_version_id: string;
  query_type: string;
  target_ref: JsonValue;
  run_id: string | null;
  spatial_scope_ref: JsonValue | null;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  authorization_scope_digest: string;
  requested_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface WorkflowGraphDatabaseV1 {
  "business.workflow_graph_results": WorkflowGraphResultDbRow;
  "business.workflow_graph_links": WorkflowGraphLinkDbRow;
  "business.workflow_query_results": WorkflowGraphQueryDbRow;
}

type WorkflowGraphDatabase = PostgresDatabase & WorkflowGraphDatabaseV1;
type WorkflowGraphQueryExecutorV1 = Kysely<WorkflowGraphDatabase>;
type WorkflowGraphTransactionV1 = Transaction<WorkflowGraphDatabase>;

const insertColumnsForRow = (row: WorkflowGraphResultRowV1): Record<string, unknown> => ({
  project_id: row.projectId,
  result_kind: row.resultKind,
  result_id: row.resultId,
  result_version_id: row.resultVersionId,
  run_id: row.runId,
  run_version_id: row.runVersionId,
  parent_run_id: row.parentRunId ?? null,
  thread_id: row.threadId ?? null,
  entry_mode: row.entryMode,
  command_id: row.commandId,
  idempotency_key: row.idempotencyKey,
  request_digest: row.requestDigest,
  artifact_ref: nullableJson(row.artifactRef),
  authorization_scope_digest: row.authorizationScopeDigest,
  actor_ref: row.actorRef,
  authorization_context_ref: jsonValue(row.authorizationContextRef),
  frozen_refs: jsonValue(row.frozenRefs),
  stage: row.stage ?? null,
  entry_identity: nullableJson(row.entryIdentity),
  input_snapshot_ref: nullableJson(row.inputSnapshotRef),
  stage_result_ref: nullableJson(row.stageResultRef),
  route_decision_ref: nullableJson(row.routeDecisionRef),
  route_kind: row.routeKind ?? null,
  waiting_ref: nullableJson(row.waitingRef),
  workflow_error_ref: nullableJson(row.workflowErrorRef),
  run_result_ref: nullableJson(row.runResultRef),
  valid_at: row.validAt,
  recorded_at: row.recordedAt,
  audit_entry_id: row.auditEntryId,
});

export const workflowGraphResultRowFromDb = (
  row: WorkflowGraphResultDbRow,
): WorkflowGraphResultRowV1 =>
  WorkflowGraphResultRowV1Schema.parse({
    schemaVersion: "1",
    projectId: row.project_id,
    resultKind: row.result_kind,
    resultId: row.result_id,
    resultVersionId: row.result_version_id,
    runId: row.run_id,
    runVersionId: row.run_version_id,
    ...(row.parent_run_id === null ? {} : { parentRunId: row.parent_run_id }),
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    entryMode: row.entry_mode,
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    ...(row.artifact_ref === null ? {} : { artifactRef: row.artifact_ref }),
    authorizationScopeDigest: row.authorization_scope_digest,
    actorRef: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    frozenRefs: row.frozen_refs,
    ...(row.stage === null ? {} : { stage: row.stage }),
    ...(row.entry_identity === null ? {} : { entryIdentity: row.entry_identity }),
    ...(row.input_snapshot_ref === null ? {} : { inputSnapshotRef: row.input_snapshot_ref }),
    ...(row.stage_result_ref === null ? {} : { stageResultRef: row.stage_result_ref }),
    ...(row.route_decision_ref === null ? {} : { routeDecisionRef: row.route_decision_ref }),
    ...(row.route_kind === null ? {} : { routeKind: row.route_kind }),
    ...(row.waiting_ref === null ? {} : { waitingRef: row.waiting_ref }),
    ...(row.workflow_error_ref === null ? {} : { workflowErrorRef: row.workflow_error_ref }),
    ...(row.run_result_ref === null ? {} : { runResultRef: row.run_result_ref }),
    validAt: isoOf(row.valid_at),
    recordedAt: isoOf(row.recorded_at),
    persistedAt: isoOf(row.persisted_at),
    auditEntryId: row.audit_entry_id,
  });

const insertColumnsForLink = (link: WorkflowGraphLinkV1): Record<string, unknown> => ({
  project_id: link.projectId,
  link_id: link.linkId,
  run_id: link.runId,
  from_ref: jsonValue(link.fromRef),
  to_ref: jsonValue(link.toRef),
  relation: link.relation,
  source_stage: link.sourceStage,
  stage_result_ref: nullableJson(link.stageResultRef),
  evidence_locator: nullableJson(link.evidenceLocator),
  authorization_context_ref: jsonValue(link.authorizationContextRef),
  authorization_scope_digest: link.authorizationScopeDigest,
  actor_ref: link.actorRef,
  recorded_at: link.recordedAt,
  audit_entry_id: link.auditEntryId,
});

export const workflowGraphLinkFromDb = (row: WorkflowGraphLinkDbRow): WorkflowGraphLinkV1 =>
  WorkflowGraphLinkV1Schema.parse({
    schemaVersion: "1",
    projectId: row.project_id,
    linkId: row.link_id,
    runId: row.run_id,
    fromRef: row.from_ref,
    toRef: row.to_ref,
    relation: row.relation,
    sourceStage: row.source_stage,
    ...(row.stage_result_ref === null ? {} : { stageResultRef: row.stage_result_ref }),
    ...(row.evidence_locator === null ? {} : { evidenceLocator: row.evidence_locator }),
    authorizationContextRef: row.authorization_context_ref,
    authorizationScopeDigest: row.authorization_scope_digest,
    actorRef: row.actor_ref,
    recordedAt: isoOf(row.recorded_at),
    auditEntryId: row.audit_entry_id,
  });

const insertColumnsForQuery = (query: WorkflowQueryRegistrationV1): Record<string, unknown> => ({
  project_id: query.projectId,
  query_result_id: query.queryResultId,
  query_result_version_id: query.queryResultVersionId,
  query_type: query.queryType,
  target_ref: jsonValue(query.targetRef),
  run_id: query.runId ?? null,
  spatial_scope_ref: nullableJson(query.spatialScopeRef),
  actor_ref: query.actorRef,
  authorization_context_ref: jsonValue(query.authorizationContextRef),
  authorization_scope_digest: query.authorizationScopeDigest,
  requested_at: query.requestedAt,
  recorded_at: query.recordedAt,
  audit_entry_id: query.auditEntryId,
});

const queryFromDb = (row: WorkflowGraphQueryDbRow): WorkflowQueryRegistrationV1 =>
  WorkflowQueryRegistrationV1Schema.parse({
    schemaVersion: "1",
    projectId: row.project_id,
    queryResultId: row.query_result_id,
    queryResultVersionId: row.query_result_version_id,
    queryType: row.query_type,
    targetRef: row.target_ref,
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    ...(row.spatial_scope_ref === null ? {} : { spatialScopeRef: row.spatial_scope_ref }),
    actorRef: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    authorizationScopeDigest: row.authorization_scope_digest,
    requestedAt: isoOf(row.requested_at),
    recordedAt: isoOf(row.recorded_at),
    persistedAt: isoOf(row.persisted_at),
    auditEntryId: row.audit_entry_id,
  });

const boundedContent = async (
  content: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of content) {
    total += chunk.byteLength;
    if (total > limit) throw makePersistenceError("TRANSACTION_FAILED", "workflow-graph.body-size");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export interface PostgresWorkflowAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & WorkflowGraphDatabaseV1>`。 */
  readonly db: unknown;
  /** C03 事务单元：查询登记用它自行开启事务并留下收据、审计与（可选的）领域事件。 */
  readonly transactionUnit: TransactionUnitV1;
  /** C04 工件存储：正文只入 C04，登记行只保存精确引用。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 当前授权复验端口：每次受保护读写前按当前 actor/工程/空间/资料范围复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly runBindingProof?: Pick<PostgresTransactionUnit, "readWorkflowRunBinding">;
  readonly now?: () => Date;
}

interface WorkflowEventReadV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly invocationId: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
}

export interface PostgresWorkflowAdapterV1 {
  readEventParentRun(
    input: WorkflowEventReadV1 &
      ({ readonly runRef: WorkflowRunRefV1 } | { readonly identificationRunRef: WorkflowRunRefV1 }),
  ): Promise<WorkflowRunRefV1 | undefined>;
  verifyEventConsumption(
    input: WorkflowEventReadV1 & {
      readonly runRef: WorkflowRunRefV1;
      readonly cause:
        | {
            readonly kind: "inputs-ready";
            readonly identificationPreparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
          }
        | {
            readonly kind: "risk-record-accepted";
            readonly identificationRunRef: WorkflowRunRefV1;
            readonly riskRecordRef: StandardizedRiskRecordRefV1;
          };
    },
  ): Promise<boolean>;
  verifyCheckpointDomainReference(
    input: Parameters<PostgresWorkflowAdapterV1["verifyCheckpointReference"]>[0],
  ): Promise<boolean>;
  verifyCheckpointWaitingReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly runRef: WorkflowRunRefV1;
    readonly waitingRef: WaitingRefV1;
  }): Promise<boolean>;
  verifyCheckpointReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly runRef: WorkflowRunRefV1;
    readonly reference: ContractReferenceV1;
  }): Promise<boolean>;
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  readonly bodies: WorkflowGraphBodyPortV1;
  /** C30 只读绑定证明（design D5）：按精确建议与运行返回已登记路由/运行/冻结事实，不写任何事实。 */
  readonly bindingProof: ResponseWorkflowBindingProofPortV1;
  readonly runCompletionProof: WorkflowRunCompletionProofPortV1;
  /** C30 入口元数据窄读（design D-12）：从已登记运行工件读出显式重评入口事实。 */
  readonly entriesRead: AssessmentEntriesReadPortV1;
  /** C30 运行投影窄读（design D-04）：按精确运行返回已登记身份、阶段与结果引用。 */
  readonly runRead: AssessmentRunReadPortV1;
}

/** 入口路由原因码：与运行图登记值一致；适配器只读该值，不解释其它原因码。 */
const ENTRY_ROUTE_KIND_V1 = "entry-accepted" as const;

const PROOF_STAGE_CODE_V1 = "workflow.binding-proof";

/** 证明失败：只给稳定类型化错误，不含正文、latest 或目标存在性。 */
const bindingProofError = (input: {
  readonly code:
    "AUTHORIZATION_DENIED" | "TERMINAL_FAILURE" | "UNSUPPORTED_CONTRACT" | "BUSINESS_BLOCKED";
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly requiredCapability: ModuleCapabilityV1;
  readonly detailCode: string;
  readonly stageCode?: string;
}): ModuleErrorV1 => {
  const common = {
    stageCode: input.stageCode ?? PROOF_STAGE_CODE_V1,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
  };
  switch (input.code) {
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: input.code,
        category: "business-blocked",
        retryable: false,
        blockerKind: "workflow-entry-fact",
        blockerRef: {
          kind: "workflow-run",
          // 只带稳定内部 detailCode，便于定位失败分支；不携带正文与目标存在性。
          reference: { entityId: `${input.causalRunId}:${input.detailCode}`, versionId: "1" },
        },
      });
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: input.code,
        category: "authorization",
        retryable: false,
        requiredCapability: input.requiredCapability,
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      });
    case "TERMINAL_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: input.code,
        category: "technical",
        retryable: false,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: {
            entityId: `workflow-binding-proof:${input.detailCode}`,
            versionId: sha256CanonicalJson({
              detailCode: input.detailCode,
              runId: input.causalRunId,
            }),
          },
        },
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: input.code,
        category: "technical",
        retryable: false,
        schemaVersion: "1",
      });
  }
};

class WorkflowGraphPersistence {
  readonly #db: WorkflowGraphQueryExecutorV1;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #runBindingProof: PostgresWorkflowAdapterOptionsV1["runBindingProof"];
  readonly #now: () => Date;

  constructor(options: PostgresWorkflowAdapterOptionsV1) {
    this.#db = options.db as unknown as WorkflowGraphQueryExecutorV1;
    this.#transactionUnit = options.transactionUnit;
    this.#artifactStore = options.artifactStore;
    this.#authorization = options.authorization;
    this.#runBindingProof = options.runBindingProof;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * 当前授权复验（design D-07）：`authorization` 提供复验身份，`verify` 返回当前收窄上下文；
   * 冻结引用不能替代它。任何形状不符或异常都按拒绝收口。
   */
  async verifyAuthorization(
    input: {
      readonly authorization: AuthorizationContextV1;
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt?: string;
    },
    rejectRedacted = false,
  ): Promise<AuthorizationContextV1 | undefined> {
    if (input.authorization.projectId !== input.projectId) return undefined;
    if (input.authorization.actorId !== input.actorId) return undefined;
    if (input.authorization.grantedCapabilities.length !== 1) return undefined;
    const capability = input.authorization.grantedCapabilities[0];
    if (capability === undefined) return undefined;
    const branch = BRANCH_BY_CAPABILITY_V1[capability];
    if (branch === undefined) return undefined;
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt ?? this.#now().toISOString(),
      });
      const verified = AuthorizationContextV1Schema.safeParse(decision.context);
      if (!verified.success || (rejectRedacted && decision.redacted)) return undefined;
      if (
        verified.data.projectId !== input.projectId ||
        verified.data.actorId !== input.actorId ||
        verified.data.grantedCapabilities.length !== 1 ||
        verified.data.grantedCapabilities[0] !== capability
      ) {
        return undefined;
      }
      return verified.data;
    } catch {
      return undefined;
    }
  }

  /**
   * 运行状态版本断言（design D-08）：同一运行的运行状态追加前取运行级事务锁，锁后读取最新版本；
   * 与预期不符即拒绝，不猜测“最新”。
   */
  async assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context: unknown,
  ): Promise<void> {
    const transaction = this.#ambientTransaction(context);
    const latest = await transaction
      .selectFrom(RESULTS_TABLE)
      .select("run_version_id")
      .where("project_id", "=", input.projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", input.runId)
      .orderBy("persisted_at", "desc")
      .orderBy("run_version_id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (latest?.run_version_id !== input.expectedRunVersionId) {
      throw makePersistenceError("IDEMPOTENCY_CONFLICT", "workflow-graph.run-version");
    }
  }

  /** 同键同摘要不覆盖首次行；同键异摘要返回首次命令身份（不可重试冲突）。 */
  async registerRow(
    input: { readonly row: WorkflowGraphResultRowV1; readonly occurredAt: string },
    context?: unknown,
  ): Promise<WorkflowRegisterOutcomeV1> {
    const row = WorkflowGraphResultRowV1Schema.parse(input.row);
    try {
      return await this.#registerRowInTransaction(row, this.#ambientTransaction(context));
    } catch (error) {
      throw mapPostgresError(error, "workflow-graph.result-register");
    }
  }

  async registerLink(
    input: { readonly link: WorkflowGraphLinkV1 },
    context?: unknown,
  ): Promise<WorkflowRegisterOutcomeV1> {
    const link = WorkflowGraphLinkV1Schema.parse(input.link);
    try {
      const transaction = this.#ambientTransaction(context);
      const inserted = await transaction
        .insertInto(LINKS_TABLE)
        .values(insertColumnsForLink(link) as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      if (Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0) {
        return { kind: "registered", replayed: false };
      }
      const stored = await transaction
        .selectFrom(LINKS_TABLE)
        .selectAll()
        .where("project_id", "=", link.projectId)
        .where("link_id", "=", link.linkId)
        .executeTakeFirst();
      if (stored === undefined) {
        throw makePersistenceError("TRANSACTION_FAILED", "workflow-graph.link-register-missing");
      }
      return { kind: "registered", replayed: true };
    } catch (error) {
      throw mapPostgresError(error, "workflow-graph.link-register");
    }
  }

  /**
   * 查询登记（design D-06）：`ProjectionPortV1.query` 的登记是独立命令，自行开启 C03 事务，
   * 收据、审计与登记行同事务提交；同一查询身份重复登记必须是同一载荷。
   */
  async registerQuery(input: {
    readonly registration: WorkflowQueryRegistrationV1;
  }): Promise<WorkflowRegisterOutcomeV1> {
    const registration = WorkflowQueryRegistrationV1Schema.parse(input.registration);
    const existing = await this.#selectQuery(registration.projectId, registration.queryResultId);
    if (existing !== undefined) {
      return existing.query_result_version_id === registration.queryResultVersionId
        ? { kind: "registered", replayed: true }
        : { kind: "idempotency-conflict", priorCommandId: existing.query_result_id };
    }
    const commandId = `${registration.queryResultId}:command`;
    try {
      const receipt = await this.#transactionUnit.execute(
        {
          projectId: registration.projectId,
          commandKind: "workflow.projection-query",
          commandId,
          idempotencyKey: registration.queryResultId,
          payload: {
            queryType: registration.queryType,
            targetRef: jsonValue(registration.targetRef),
            authorizationScopeDigest: registration.authorizationScopeDigest,
            ...(registration.queryType === "risk-overview"
              ? {
                  queryResultVersionId: registration.queryResultVersionId,
                  spatialScopeRef: jsonValue(registration.spatialScopeRef ?? null),
                }
              : {}),
          },
          actorRef: registration.actorRef,
          authorizationContextRef: registration.authorizationContextRef,
          issuedAt: registration.recordedAt,
          ...(registration.runId === undefined ? {} : { runId: registration.runId }),
        },
        async (context) => {
          const transaction = this.#ambientTransaction(context);
          const inserted = await transaction
            .insertInto(QUERIES_TABLE)
            .values(insertColumnsForQuery(registration) as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          if (Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n) === 0) {
            const stored = await transaction
              .selectFrom(QUERIES_TABLE)
              .select("query_result_version_id")
              .where("project_id", "=", registration.projectId)
              .where("query_result_id", "=", registration.queryResultId)
              .executeTakeFirst();
            if (stored?.query_result_version_id !== registration.queryResultVersionId) {
              throw makePersistenceError("IDEMPOTENCY_CONFLICT", "workflow-graph.query-identity");
            }
          }
          const reference = {
            entityId: registration.queryResultId,
            versionId: registration.queryResultVersionId,
          };
          return {
            resultRef: { kind: "query-result" as const, reference },
            audit: {
              auditEntryId: registration.auditEntryId,
              projectId: registration.projectId,
              action: "workflow.projection-query",
              targetRef: { kind: "query-result" as const, reference },
              actorRef: registration.actorRef,
              authorizationContextRef: registration.authorizationContextRef,
              occurredAt: registration.recordedAt,
              recordedAt: registration.recordedAt,
              version: reference,
              commandId,
              idempotencyKey: registration.queryResultId,
              ...(registration.runId === undefined ? {} : { runId: registration.runId }),
            },
            events: [],
          };
        },
      );
      const stored = await this.#selectQuery(registration.projectId, registration.queryResultId);
      return stored?.query_result_version_id === registration.queryResultVersionId
        ? { kind: "registered", replayed: receipt.replayed }
        : { kind: "idempotency-conflict", priorCommandId: registration.queryResultId };
    } catch (error) {
      const mapped = mapPostgresError(error, "workflow-graph.query-register");
      if (mapped.code === "IDEMPOTENCY_CONFLICT") {
        return { kind: "idempotency-conflict", priorCommandId: registration.queryResultId };
      }
      // 同一身份的并发登记，输的那一方不一定走到 `doNothing` 分支：事务可能在
      // 插入之前就被数据库按序列化/死锁失败拒绝，此时抛出去的是 TRANSACTION_FAILED，
      // 而不是契约要求的幂等冲突。判定权在最终落库的那一行上，所以回读一次再定性：
      // 别人的载荷已经占住身份就是幂等冲突，自己那份已经落库就是已登记，
      // 两种都不是才继续上抛。
      if (mapped.code === "TRANSACTION_FAILED") {
        const settled = await this.#selectQuery(registration.projectId, registration.queryResultId);
        if (settled !== undefined) {
          return settled.query_result_version_id === registration.queryResultVersionId
            ? { kind: "registered", replayed: true }
            : { kind: "idempotency-conflict", priorCommandId: registration.queryResultId };
        }
      }
      throw mapped;
    }
  }

  async readRow(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly resultKind: WorkflowGraphResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<WorkflowGraphResultRowV1 | undefined> {
    const row = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .where("result_kind", "=", input.resultKind)
      .where("result_id", "=", input.resultId)
      .where("result_version_id", "=", input.resultVersionId)
      .executeTakeFirst();
    return row === undefined ? undefined : workflowGraphResultRowFromDb(row);
  }

  async verifyCheckpointWaitingReference(
    input: Parameters<PostgresWorkflowAdapterV1["verifyCheckpointWaitingReference"]>[0],
  ): Promise<boolean> {
    const verified = await this.verifyAuthorization(input, true);
    if (verified === undefined) return false;
    const waitingRef = WaitingRefV1Schema.parse(input.waitingRef);
    const row = await this.#db
      .selectFrom(RESULTS_TABLE)
      .select("waiting_ref")
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runRef.reference.entityId)
      .where("result_kind", "=", "waiting")
      .where("actor_ref", "=", input.actorId)
      .where("authorization_scope_digest", "=", authorizationScopeDigest(verified))
      .where("waiting_ref", "=", sql<JsonValue>`${JSON.stringify(waitingRef)}::jsonb`)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async #eventAuthorization(input: WorkflowEventReadV1): Promise<AuthorizationContextV1> {
    const verified = await this.verifyAuthorization(input, true);
    if (
      verified === undefined ||
      authorizationScopeDigest(verified) !== authorizationScopeDigest(input.authorization)
    )
      throw new TypeError("WORKFLOW_EVENT_AUTHORIZATION_DENIED");
    return verified;
  }

  async #eventState(
    input: WorkflowEventReadV1,
    runRef: WorkflowRunRefV1,
    verified: AuthorizationContextV1,
  ): Promise<WorkflowGraphRunStateV1 | undefined> {
    const row = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", runRef.reference.entityId)
      .where("result_kind", "=", "run-state")
      .orderBy("persisted_at", "desc")
      .orderBy("run_version_id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const parsed = workflowGraphResultRowFromDb(row);
    if (
      parsed.actorRef !== input.actorId ||
      parsed.artifactRef === undefined ||
      parsed.threadId === undefined ||
      this.#runBindingProof === undefined ||
      this.#artifactStore.verifyContent === undefined ||
      !(await this.#runBindingProof.readWorkflowRunBinding({
        projectId: input.projectId,
        actorId: input.actorId,
        runRef,
        threadId: parsed.threadId,
      }))
    )
      throw new TypeError("WORKFLOW_EVENT_RUN_UNPROVEN");
    let state: WorkflowGraphRunStateV1 | undefined;
    const valid = await this.#artifactStore.verifyContent(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        projectId: input.projectId,
        actorId: input.actorId,
        requestId: input.invocationId,
        idempotencyKey: input.invocationId,
        requestedAt: input.requestedAt,
        artifactRef: parsed.artifactRef,
        purposeCode: WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1["run-state"],
        requiredCapability: verified.grantedCapabilities[0],
        authorization: verified,
      }),
      MAX_BODY_BYTES_V1,
      (bytes) => {
        const body = WorkflowGraphArtifactBodyV1Schema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        if (
          body.bodyKind !== "run-state" ||
          body.runState.projectId !== input.projectId ||
          body.runState.runId !== runRef.reference.entityId ||
          body.runState.runVersionId !== parsed.runVersionId ||
          body.runState.stage !== parsed.stage ||
          body.runState.entryMode !== "identify-and-assess" ||
          body.runState.entryMode !== parsed.entryMode
        )
          return false;
        state = body.runState;
        return true;
      },
    );
    if (!valid) throw new TypeError("WORKFLOW_EVENT_STATE_UNPROVEN");
    if (state === undefined) throw new TypeError("WORKFLOW_EVENT_STATE_UNPROVEN");
    // 执行批次参与运行身份；空间事实来自 preparing 阶段冻结的业务入口。
    const entries = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", runRef.reference.entityId)
      .where("result_kind", "=", "entry-snapshot")
      .where("stage", "=", "preparing")
      .limit(2)
      .execute();
    if (entries.length !== 1) throw new TypeError("WORKFLOW_EVENT_ENTRY_UNPROVEN");
    const entry = workflowGraphResultRowFromDb(entries[0]!);
    const scopes = entry.frozenRefs.filter((ref) => ref.kind === "spatial-scope");
    if (
      entry.actorRef !== input.actorId ||
      entry.threadId !== parsed.threadId ||
      entry.entryMode !== state.entryMode ||
      scopes.length === 0 ||
      !scopes.every((scope) =>
        verified.spatialScopeRefs.some((ref) => isDeepStrictEqual(ref, scope)),
      )
    )
      throw new TypeError("WORKFLOW_EVENT_SCOPE_UNPROVEN");
    return state;
  }

  async readEventParentRun(
    input: Parameters<PostgresWorkflowAdapterV1["readEventParentRun"]>[0],
  ): Promise<WorkflowRunRefV1 | undefined> {
    const verified = await this.#eventAuthorization(input);
    let runRef: WorkflowRunRefV1;
    if ("runRef" in input) runRef = WorkflowRunRefV1Schema.parse(input.runRef);
    else {
      const child = WorkflowRunRefV1Schema.parse(input.identificationRunRef);
      const rows = await this.#db
        .selectFrom(LINKS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("relation", "=", "parent-child")
        .where(sql<SqlBool>`to_ref = ${JSON.stringify(child)}::jsonb`)
        .limit(2)
        .execute();
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new TypeError("WORKFLOW_EVENT_PARENT_AMBIGUOUS");
      const link = workflowGraphLinkFromDb(rows[0]!);
      runRef = WorkflowRunRefV1Schema.parse(link.fromRef);
      if (
        link.runId !== runRef.reference.entityId ||
        link.actorRef !== input.actorId ||
        link.sourceStage !== "identification"
      )
        throw new TypeError("WORKFLOW_EVENT_PARENT_UNPROVEN");
    }
    const state = await this.#eventState(input, runRef, verified);
    if (state === undefined) return undefined;
    if (
      "identificationRunRef" in input &&
      !isDeepStrictEqual(state.identificationRunRef, input.identificationRunRef)
    )
      throw new TypeError("WORKFLOW_EVENT_CHILD_UNPROVEN");
    return runRef;
  }

  async verifyEventConsumption(
    input: Parameters<PostgresWorkflowAdapterV1["verifyEventConsumption"]>[0],
  ): Promise<boolean> {
    const verified = await this.#eventAuthorization(input);
    const state = await this.#eventState(input, input.runRef, verified);
    if (
      state === undefined ||
      state.status === "running" ||
      state.status === "cancelled" ||
      state.identificationRunRef === undefined ||
      state.lastStageResultRef === undefined
    )
      return false;
    const parent = await this.readEventParentRun({
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: input.invocationId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      identificationRunRef: state.identificationRunRef,
    });
    if (parent === undefined || !sameRef(parent, input.runRef)) return false;
    const stageResult = await this.readRow({
      projectId: input.projectId,
      runId: state.runId,
      resultKind: "stage-result",
      resultId: state.lastStageResultRef.reference.entityId,
      resultVersionId: state.lastStageResultRef.reference.versionId,
    });
    if (
      stageResult?.actorRef !== input.actorId ||
      !isDeepStrictEqual(stageResult.stageResultRef, state.lastStageResultRef)
    )
      return false;
    const progressedAfter = async (fact: WorkflowGraphResultRowV1) =>
      (await this.#db
        .selectFrom(`${RESULTS_TABLE} as progress`)
        .innerJoin(`${RESULTS_TABLE} as fact`, (join) =>
          join
            .onRef("progress.project_id", "=", "fact.project_id")
            .onRef("progress.run_id", "=", "fact.run_id"),
        )
        .select("progress.result_id")
        .where("progress.project_id", "=", input.projectId)
        .where("progress.run_id", "=", state.runId)
        .where("progress.result_kind", "=", "stage-result")
        .where("progress.result_id", "=", stageResult.resultId)
        .where("progress.result_version_id", "=", stageResult.resultVersionId)
        .where("fact.result_kind", "=", fact.resultKind)
        .where("fact.result_id", "=", fact.resultId)
        .where("fact.result_version_id", "=", fact.resultVersionId)
        .whereRef("progress.persisted_at", ">", "fact.persisted_at")
        .limit(1)
        .executeTakeFirst()) !== undefined;
    if (input.cause.kind === "inputs-ready") {
      const rows = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("run_id", "=", state.runId)
        .where("result_kind", "=", "entry-snapshot")
        .where("stage", "=", "identification")
        .where(
          sql<SqlBool>`frozen_refs @> ${JSON.stringify([input.cause.identificationPreparationSnapshotRef])}::jsonb`,
        )
        .limit(2)
        .execute();
      if (rows.length !== 1) return false;
      const entry = workflowGraphResultRowFromDb(rows[0]!);
      return (
        entry.actorRef === input.actorId &&
        (await progressedAfter(entry)) &&
        isDeepStrictEqual(entry.frozenRefs, [input.cause.identificationPreparationSnapshotRef])
      );
    }
    const cause = input.cause;
    if (
      !isDeepStrictEqual(state.identificationRunRef, cause.identificationRunRef) ||
      !state.acceptedRiskRecordRefs.some((ref) => isDeepStrictEqual(ref, cause.riskRecordRef))
    )
      return false;
    const route = await this.readRow({
      projectId: input.projectId,
      runId: state.runId,
      resultKind: "route-decision",
      resultId: `risk-flow-risk-accepted:${state.runId}:${sha256CanonicalJson(input.cause.riskRecordRef).slice(0, 32)}`,
      resultVersionId: sha256CanonicalJson({
        riskRecordRef: input.cause.riskRecordRef,
        identificationRunRef: input.cause.identificationRunRef,
      }),
    });
    // 子图返回时父图可能已纳入该风险；正式状态与精确链边同样证明输入已消费。
    if (route === undefined) return true;
    return route.actorRef === input.actorId && route.routeKind === "risk-record-accepted";
  }

  async verifyCheckpointDomainReference(
    input: Parameters<PostgresWorkflowAdapterV1["verifyCheckpointDomainReference"]>[0],
  ): Promise<boolean> {
    const verified = await this.verifyAuthorization(input, true);
    if (verified === undefined || !isDeepStrictEqual(verified, input.authorization)) return false;
    const relations = {
      "risk-assessment-record": ["risk-assessment", "to_ref"],
      "warning-record": ["assessment-warning", "to_ref"],
      "warning-response-task": ["warning-recommendation", "from_ref"],
      "response-recommendation": ["warning-recommendation", "to_ref"],
      "effect-forecast": ["recommendation-forecast", "to_ref"],
      feedback: ["feedback-deviation", "from_ref"],
      "deviation-record": ["feedback-deviation", "to_ref"],
      "calibration-suggestion": ["deviation-calibration", "to_ref"],
    } as const;
    if (
      !(input.reference.kind in relations) &&
      input.reference.kind !== "execution-record" &&
      input.reference.kind !== "assessment-input-snapshot"
    )
      return false;
    const digest = authorizationScopeDigest(verified);
    const entries = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runRef.reference.entityId)
      .where("result_kind", "=", "entry-snapshot")
      .limit(2)
      .execute();
    if (entries.length === 1) {
      const entry = workflowGraphResultRowFromDb(entries[0]!);
      if (
        entry.stage === "A0" &&
        entry.actorRef === input.actorId &&
        entry.authorizationScopeDigest === digest &&
        entry.frozenRefs.some((ref) => isDeepStrictEqual(ref, input.reference))
      )
        return true;
    }
    if (!(input.reference.kind in relations)) return false;
    const [relation, column] = relations[input.reference.kind as keyof typeof relations];
    const row = await this.#db
      .selectFrom(LINKS_TABLE)
      .select("link_id")
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runRef.reference.entityId)
      .where("actor_ref", "=", input.actorId)
      .where("authorization_scope_digest", "=", digest)
      .where("relation", "=", relation)
      .where(sql<SqlBool>`${sql.ref(column)} = ${JSON.stringify(input.reference)}::jsonb`)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async verifyCheckpointReference(
    input: Parameters<PostgresWorkflowAdapterV1["verifyCheckpointReference"]>[0],
  ): Promise<boolean> {
    const verified = await this.verifyAuthorization(input, true);
    if (verified === undefined) return false;
    const reference = input.reference;
    if (
      reference.kind !== "stage-result" &&
      reference.kind !== "route-decision" &&
      reference.kind !== "workflow-error" &&
      reference.kind !== "assessment-run-result" &&
      reference.kind !== "risk-flow-run-result"
    )
      return false;
    const resultKind =
      reference.kind === "assessment-run-result" || reference.kind === "risk-flow-run-result"
        ? "run-result"
        : reference.kind;
    const row = await this.readRow({
      projectId: input.projectId,
      runId: input.runRef.reference.entityId,
      resultKind,
      resultId: reference.reference.entityId,
      resultVersionId: reference.reference.versionId,
    });
    if (row === undefined || row.authorizationScopeDigest !== authorizationScopeDigest(verified))
      return false;
    const rowRef =
      resultKind === "stage-result"
        ? row.stageResultRef
        : resultKind === "route-decision"
          ? row.routeDecisionRef
          : resultKind === "workflow-error"
            ? row.workflowErrorRef
            : row.runResultRef;
    if (rowRef === undefined || !sameRef(rowRef, reference)) return false;
    if (resultKind !== "run-result") return true;
    if (row.artifactRef === undefined || this.#artifactStore.verifyContent === undefined)
      return false;
    return this.#artifactStore.verifyContent(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        projectId: input.projectId,
        actorId: input.actorId,
        requestId: input.invocationId,
        idempotencyKey: input.invocationId,
        requestedAt: input.requestedAt,
        artifactRef: row.artifactRef,
        purposeCode: WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1["run-result"],
        requiredCapability: verified.grantedCapabilities[0],
        authorization: verified,
      }),
      MAX_BODY_BYTES_V1,
      (bytes) => {
        const body = WorkflowGraphArtifactBodyV1Schema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        return (
          body.bodyKind === "run-result" &&
          body.runResult.projectId === input.projectId &&
          sameRef(body.runResult.runRef, input.runRef)
        );
      },
    );
  }

  /** 已登记事实按持久化时间与稳定键排序，分页读取不改变顺序。 */
  async listRunRows(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowGraphResultRowV1[]> {
    const rows = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .orderBy("persisted_at", "asc")
      .orderBy("result_kind", "asc")
      .orderBy("result_id", "asc")
      .limit(input.limit ?? DEFAULT_ROW_LIMIT_V1)
      .execute();
    return rows.map((row) => workflowGraphResultRowFromDb(row));
  }

  /**
   * 最新运行状态（design D-08）：先按当前授权复验再读登记行与其 C04 正文；
   * 无权与不存在对调用方同形，正文不可读时返回 `undefined`，绝不据 checkpoint 猜测状态。
   */
  async readLatestRunState(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly row: WorkflowGraphResultRowV1 & { readonly resultKind: "run-state" };
        readonly state: WorkflowGraphRunStateV1;
      }
    | undefined
  > {
    const verified = await this.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      // 身份由调用方给出（运行/命令身份），端口不派生无签发方的字符串。
      invocationId: input.invocationId,
      requestedAt: input.requestedAt,
    });
    if (verified === undefined) return undefined;
    return await this.#latestRunStateWith({
      projectId: input.projectId,
      runId: input.runId,
      requestedAt: input.requestedAt,
      verified,
    });
  }

  async readAssessmentEntrySnapshot(
    input: Parameters<WorkflowGraphRegistrationStoreV1["readAssessmentEntrySnapshot"]>[0],
  ): Promise<AssessmentEntrySnapshotRefV1 | undefined> {
    const verified = await this.verifyAuthorization(input);
    if (verified === undefined) return undefined;
    const rows = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .where("result_kind", "=", "entry-snapshot")
      .limit(2)
      .execute();
    if (rows.length !== 1) return undefined;
    const row = workflowGraphResultRowFromDb(rows[0]!);
    if (row.artifactRef === undefined) return undefined;
    const body = await this.#openBody({
      projectId: input.projectId,
      artifactRef: row.artifactRef,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: verified,
    });
    if (
      body?.bodyKind !== "run-state" ||
      body.runState.projectId !== input.projectId ||
      body.runState.runId !== input.runId
    )
      return undefined;
    const ref = row.inputSnapshotRef;
    const entry =
      ref?.kind === "assessment-preparation-snapshot"
        ? { kind: "assessment-preparation", assessmentPreparationSnapshotRef: ref }
        : ref?.kind === "response-forecast-input-snapshot"
          ? { kind: "forecast-input", responseForecastInputSnapshotRef: ref }
          : ref?.kind === "response-feedback-input-snapshot"
            ? { kind: "feedback-input", responseFeedbackInputSnapshotRef: ref }
            : undefined;
    const parsed = AssessmentEntrySnapshotRefV1Schema.safeParse(entry);
    return row.stage === "A0" && parsed.success ? parsed.data : undefined;
  }

  /**
   * 已复验上下文的运行状态窄读：C05 要求一个授权上下文只对应一个 `invocation_id`，因此证明类
   * 调用方只复验一次，这里复用同一次复验结果，不再派生第二个复验身份。
   */
  async #latestRunStateWith(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly requestedAt: string;
    readonly verified: AuthorizationContextV1;
  }): Promise<
    | {
        readonly row: WorkflowGraphResultRowV1 & { readonly resultKind: "run-state" };
        readonly state: WorkflowGraphRunStateV1;
      }
    | undefined
  > {
    const row = await this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", input.runId)
      .orderBy("persisted_at", "desc")
      .orderBy("run_version_id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row === undefined || row.artifact_ref === null) return undefined;
    const parsedRow = workflowGraphResultRowFromDb(row);
    if (parsedRow.resultKind !== "run-state" || parsedRow.artifactRef === undefined) {
      return undefined;
    }
    // C04 按该精确工件登记的工程、空间和来源集合复验覆盖；摘要只保留为写入审计事实。
    const body = await this.#openBody({
      projectId: input.projectId,
      artifactRef: parsedRow.artifactRef,
      actorId: input.verified.actorId,
      requestedAt: input.requestedAt,
      authorization: input.verified,
    });
    if (body === undefined || body.bodyKind !== "run-state") return undefined;
    const state = WorkflowGraphRunStateV1Schema.safeParse(body.runState);
    if (!state.success) return undefined;
    return { row: parsedRow as typeof parsedRow & { resultKind: "run-state" }, state: state.data };
  }

  async listRunLinks(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowGraphLinkV1[]> {
    const rows = await this.#db
      .selectFrom(LINKS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .orderBy("recorded_at", "asc")
      .orderBy("link_id", "asc")
      .limit(input.limit ?? DEFAULT_ROW_LIMIT_V1)
      .execute();
    return rows.map((row) => workflowGraphLinkFromDb(row));
  }

  /**
   * C30 只读绑定证明（design D5）：先按当前授权复验工程/主体/能力与登记行的授权范围摘要，
   * 再按精确运行与建议读取本运行的人工决定等待行、入口路由行与最新运行状态，返回最小绑定事实。
   * 缺失与越权同型失败（`AUTHORIZATION_DENIED`），登记行存在但正文/引用不一致按 `TERMINAL_FAILURE`
   * 稳定收口；不返回正文、latest 或列表，也不写任何 C30/C28 事实。
   */
  async verifyResponseWorkflowBinding(
    query: ResponseWorkflowBindingProofQueryV1,
  ): Promise<ResponseWorkflowBindingProofResultV1> {
    const occurredAt = this.#now().toISOString();
    const parsed = ResponseWorkflowBindingProofQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: bindingProofError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "workflow-binding-proof",
          occurredAt,
          requiredCapability: "workflow.start",
          detailCode: "query-invalid",
        }),
      };
    }
    const valid = parsed.data;
    const runId = valid.payload.workflowRunRef.reference.entityId;
    const denied = (detailCode: string, capability: ModuleCapabilityV1) => ({
      kind: "failed" as const,
      error: bindingProofError({
        code: "AUTHORIZATION_DENIED",
        causalRunId: runId,
        occurredAt,
        requiredCapability: capability,
        detailCode,
      }),
    });
    try {
      // C05 要求一个授权上下文只对应一个 `invocation_id`：C41 以 `queryId` 签发该上下文，
      // 因此整条证明只按 `queryId` 复验一次，内部窄读复用同一复验结果（不派生第二个身份）。
      const verified = await this.verifyAuthorization({
        authorization: valid.authorization,
        projectId: valid.projectId,
        actorId: valid.actorId,
        invocationId: valid.queryId,
        requestedAt: valid.requestedAt,
      });
      const requiredCapability = verified?.grantedCapabilities[0] ?? "workflow.start";
      if (verified === undefined) return denied("binding-proof-denied", requiredCapability);

      // 先由同一 C04 窄读证明工程、空间和来源覆盖，再组合本运行登记事实。
      const latest = await this.#latestRunStateWith({
        projectId: valid.projectId,
        runId,
        requestedAt: valid.requestedAt,
        verified,
      });
      if (latest === undefined) return denied("binding-not-established", requiredCapability);
      const scoped = await this.listRunRows({
        projectId: valid.projectId,
        runId,
        limit: DEFAULT_ROW_LIMIT_V1 + 1,
      });
      if (scoped.length > DEFAULT_ROW_LIMIT_V1)
        return denied("binding-not-established", requiredCapability);
      const humanDecisionWaitings = scoped.filter(
        (row) => row.resultKind === "waiting" && row.waitingRef?.kind === "human-decision",
      );
      const waiting =
        humanDecisionWaitings.length === 1
          ? (humanDecisionWaitings[0]?.waitingRef as
              Extract<WaitingRefV1, { readonly kind: "human-decision" }> | undefined)
          : undefined;
      // 入口路由行取本运行持久化顺序中的第一条 `entry-accepted`：它是创建时登记的入口事实。
      const entryRoute = scoped
        .filter(
          (row) => row.resultKind === "route-decision" && row.routeKind === ENTRY_ROUTE_KIND_V1,
        )
        .at(0);
      const recommendationMatches =
        waiting !== undefined &&
        waiting.responseRecommendationRef.reference.entityId ===
          valid.payload.responseRecommendationRef.reference.entityId &&
        waiting.responseRecommendationRef.reference.versionId ===
          valid.payload.responseRecommendationRef.reference.versionId;
      if (
        waiting === undefined ||
        entryRoute === undefined ||
        scoped.every((row) => row.resultKind !== "run-state") ||
        !recommendationMatches
      ) {
        return denied("binding-not-established", requiredCapability);
      }

      // 等待行与运行状态行同事务写入：运行状态行在而正文不可读，或正文自称的工程/运行/版本与
      // 登记行不符，只能是持久事实损坏——稳定类型化失败，绝不返回部分或外来绑定。
      if (
        latest === undefined ||
        latest.state.projectId !== valid.projectId ||
        latest.state.runId !== runId ||
        latest.state.runVersionId !== latest.row.resultVersionId
      ) {
        return {
          kind: "failed",
          error: bindingProofError({
            code: "TERMINAL_FAILURE",
            causalRunId: runId,
            occurredAt,
            requiredCapability,
            detailCode: "run-state-unreadable",
          }),
        };
      }
      // 冻结引用并集按稳定键去重后排序取摘要（`domain-event` 引用没有 `reference`，按事件身份取值）。
      const frozenKeys = new Set<string>();
      for (const row of scoped) {
        for (const ref of row.frozenRefs) {
          frozenKeys.add(
            "reference" in ref
              ? `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`
              : `${ref.kind}/${ref.eventId}/${ref.eventVersion}`,
          );
        }
      }
      const frozenDigest = sha256CanonicalJson([...frozenKeys].sort());
      return ResponseWorkflowBindingProofResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "bound",
          projectId: valid.projectId,
          responseRecommendationRef: waiting.responseRecommendationRef,
          spatialScopeRef: waiting.spatialScopeRef,
          routeDecisionRef: waiting.routeDecisionRef,
          workflowRunRef: valid.payload.workflowRunRef,
          runStatus: latest.state.status,
          runStateVersion: latest.state.runVersionId,
          frozenDigest,
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: entryRoute.auditEntryId, versionId: "v1" },
          },
        },
      });
    } catch {
      // 登记行/正文损坏或无法按精确引用解析：稳定类型化失败，绝不返回部分绑定。
      return {
        kind: "failed",
        error: bindingProofError({
          code: "TERMINAL_FAILURE",
          causalRunId: runId,
          occurredAt,
          requiredCapability: "workflow.start",
          detailCode: "binding-facts-inconsistent",
        }),
      };
    }
  }

  /** 精确子运行与评估记录必须同时出现在已完成的 C30 持久运行状态中。 */
  async verifyWorkflowRunCompletion(
    query: WorkflowRunCompletionProofQueryV1,
  ): Promise<WorkflowRunCompletionProofResultV1> {
    const occurredAt = this.#now().toISOString();
    const parsed = WorkflowRunCompletionProofQueryV1Schema.safeParse(query);
    const runId = parsed.success
      ? parsed.data.payload.workflowRunRef.reference.entityId
      : "workflow-run";
    const failed = (
      code: "AUTHORIZATION_DENIED" | "TERMINAL_FAILURE" | "UNSUPPORTED_CONTRACT",
      detailCode: string,
    ) => {
      return {
        kind: "failed" as const,
        error: bindingProofError({
          code,
          causalRunId: runId,
          occurredAt,
          requiredCapability: "workflow.start",
          detailCode,
          stageCode: "workflow.run-completion-proof",
        }),
      } as const;
    };
    if (!parsed.success) return failed("UNSUPPORTED_CONTRACT", "query-invalid");
    const valid = parsed.data;
    try {
      const verified = await this.verifyAuthorization({
        authorization: valid.authorization,
        projectId: valid.projectId,
        actorId: valid.actorId,
        invocationId: valid.queryId,
        requestedAt: valid.requestedAt,
      });
      if (verified === undefined) return failed("AUTHORIZATION_DENIED", "completion-proof-denied");
      const latest = await this.#latestRunStateWith({
        projectId: valid.projectId,
        runId,
        requestedAt: valid.requestedAt,
        verified,
      });
      if (latest === undefined) return failed("AUTHORIZATION_DENIED", "completion-not-established");
      const { row, state } = latest;
      if (
        state.projectId !== valid.projectId ||
        state.runId !== runId ||
        state.runVersionId !== row.resultVersionId
      )
        return failed("TERMINAL_FAILURE", "run-state-inconsistent");
      if (
        state.status !== "completed" ||
        !state.assessmentRecordRefs.some(
          (ref) =>
            ref.reference.entityId === valid.payload.riskAssessmentRecordRef.reference.entityId &&
            ref.reference.versionId === valid.payload.riskAssessmentRecordRef.reference.versionId,
        )
      )
        return failed("AUTHORIZATION_DENIED", "completion-not-established");
      const resultRows = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("run_id", "=", runId)
        .where("run_version_id", "=", row.runVersionId)
        .where("result_kind", "=", "run-result")
        .limit(2)
        .execute();
      if (resultRows.length !== 1) return failed("TERMINAL_FAILURE", "run-result-inconsistent");
      const resultRow = workflowGraphResultRowFromDb(resultRows[0]!);
      if (resultRow.resultKind !== "run-result" || resultRow.artifactRef === undefined)
        return failed("TERMINAL_FAILURE", "run-result-inconsistent");
      const resultBody = await this.#openBody({
        projectId: valid.projectId,
        artifactRef: resultRow.artifactRef,
        actorId: valid.actorId,
        requestedAt: valid.requestedAt,
        authorization: verified,
      });
      if (resultBody === undefined)
        return failed("AUTHORIZATION_DENIED", "completion-not-established");
      if (
        resultBody?.bodyKind !== "run-result" ||
        resultBody.runResult.projectId !== valid.projectId ||
        resultBody.runResult.runRef.reference.entityId !== runId ||
        resultBody.runResult.runRef.reference.versionId !==
          valid.payload.workflowRunRef.reference.versionId ||
        state.resultRef?.kind !== "risk-flow-run-result" ||
        state.resultRef.reference.versionId !==
          resultBody.runResult.auditTrailRef.reference.versionId ||
        !resultBody.runResult.assessmentRecordRefs.some(
          (ref) =>
            ref.reference.entityId === valid.payload.riskAssessmentRecordRef.reference.entityId &&
            ref.reference.versionId === valid.payload.riskAssessmentRecordRef.reference.versionId,
        )
      )
        return failed("TERMINAL_FAILURE", "run-result-inconsistent");
      return WorkflowRunCompletionProofResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "completed",
          projectId: valid.projectId,
          workflowRunRef: valid.payload.workflowRunRef,
          riskAssessmentRecordRef: valid.payload.riskAssessmentRecordRef,
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: row.auditEntryId, versionId: "v1" },
          },
        },
      });
    } catch {
      return failed("TERMINAL_FAILURE", "completion-facts-inconsistent");
    }
  }

  /**
   * 入口元数据窄读（design D-12）：先沿 `risk-assessment` 链边批量定位产出该评估记录的精确运行，
   * 再沿该运行的正式 `entry-snapshot` 登记行与精确 `run-state` 工件复验工程、运行、入口与前驱关联。
   * 重评运行缺 `reassessmentEntry`、入口身份与登记行不符、或前驱指向自身时整体失败闭合；
   * 不从 `frozenRefs`、`triggerReasonCode` 或阶段事实反推原因与变化集合。
   */
  async readAssessmentEntriesForRecords(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRefs: readonly RiskAssessmentRecordRefV1[];
  }): Promise<
    | { readonly kind: "succeeded"; readonly entries: readonly AssessmentEntryMetadataV1[] }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const occurredAt = this.#now().toISOString();
    const failed = (detailCode: string) => ({
      kind: "failed" as const,
      error: bindingProofError({
        code: "BUSINESS_BLOCKED",
        causalRunId: "c30-assessment-entries",
        occurredAt,
        requiredCapability: "projection.query",
        detailCode,
        stageCode: "workflow.assessment-entries-read",
      }),
    });
    const denied = () => ({
      kind: "failed" as const,
      error: bindingProofError({
        code: "AUTHORIZATION_DENIED",
        causalRunId: "c30-assessment-entries",
        occurredAt,
        requiredCapability: "projection.query",
        detailCode: "assessment-entries-denied",
        stageCode: "workflow.assessment-entries-read",
      }),
    });
    if (input.assessmentRecordRefs.length === 0) return failed("assessment-records-empty");
    if (input.assessmentRecordRefs.length > ASSESSMENT_ENTRIES_MAX_V1) {
      return failed("assessment-records-over-limit");
    }
    const verified = await this.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: workflowGraphReadInvocationIdV1({
        operation: "assessment-entries",
        projectId: input.projectId,
        targetId: input.assessmentRecordRefs[0]!.reference.entityId,
      }),
      requestedAt: input.requestedAt,
    });
    if (verified === undefined) return denied();
    try {
      // 一次批量定位：按 `risk-assessment` 链边把每条评估记录映射到唯一产出运行。
      const toRef = (ref: RiskAssessmentRecordRefV1) => sql`${JSON.stringify(ref)}::jsonb`;
      const linkRows = await this.#db
        .selectFrom(LINKS_TABLE)
        .select(["run_id", "to_ref"])
        .distinct()
        .where("project_id", "=", input.projectId)
        .where("relation", "=", ASSESSMENT_LINK_RELATION_V1)
        .where(sql<SqlBool>`to_ref IN (${sql.join(input.assessmentRecordRefs.map(toRef))})`)
        .orderBy("run_id", "asc")
        .limit(ASSESSMENT_ENTRIES_MAX_V1 * 2 + 1)
        .execute();
      if (linkRows.length > ASSESSMENT_ENTRIES_MAX_V1 * 2) return denied();
      const runByRecord = new Map<string, string>();
      for (const row of linkRows) {
        const key = JSON.stringify(row.to_ref);
        if (runByRecord.has(key)) continue;
        runByRecord.set(key, row.run_id);
      }
      const runIds = [...new Set(linkRows.map((row) => row.run_id))].sort();
      if (runIds.length === 0) return denied();
      // 入口登记行与最新状态行一并批量取回；每运行最多一条入口行与最新一条状态行。
      const rows = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("run_id", "in", runIds)
        .where("result_kind", "in", ["run-state", "entry-snapshot"])
        .orderBy("run_id", "asc")
        .orderBy("recorded_at", "asc")
        .orderBy("run_version_id", "asc")
        .limit(runIds.length * ASSESSMENT_RUN_FACTS_MAX_V1 + 1)
        .execute();
      if (rows.length > runIds.length * ASSESSMENT_RUN_FACTS_MAX_V1) return denied();
      const latestStateByRun = new Map<string, WorkflowGraphResultRowV1>();
      const entryRowByRun = new Map<string, WorkflowGraphResultRowV1>();
      for (const row of rows) {
        const parsed = workflowGraphResultRowFromDb(row);
        if (parsed.resultKind === "entry-snapshot") {
          if (entryRowByRun.has(parsed.runId)) continue;
          entryRowByRun.set(parsed.runId, parsed);
          continue;
        }
        latestStateByRun.set(parsed.runId, parsed);
      }
      const entries: AssessmentEntryMetadataV1[] = [];
      // 有界工件读：每个运行至多读一次精确 run-state 工件。
      for (const assessmentRecordRef of input.assessmentRecordRefs) {
        const runId = runByRecord.get(JSON.stringify(assessmentRecordRef));
        if (runId === undefined) return denied();
        const stateRow = latestStateByRun.get(runId);
        const entryRow = entryRowByRun.get(runId);
        if (
          stateRow === undefined ||
          stateRow.resultKind !== "run-state" ||
          stateRow.artifactRef === undefined
        ) {
          return denied();
        }
        const body = await this.#openBody({
          projectId: input.projectId,
          artifactRef: stateRow.artifactRef,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          authorization: verified,
        });
        if (body?.bodyKind !== "run-state") return denied();
        if (
          entryRow === undefined ||
          entryRow.resultKind !== "entry-snapshot" ||
          entryRow.entryIdentity === undefined
        )
          return failed("assessment-entry-not-established");
        const state = body.runState;
        if (state.projectId !== input.projectId || state.runId !== runId) {
          return failed("assessment-run-state-foreign");
        }
        if (state.runVersionId !== stateRow.resultVersionId) {
          return failed("assessment-run-state-version-mismatch");
        }
        if (state.entryMode !== entryRow.entryMode) {
          return failed("assessment-entry-mode-mismatch");
        }
        if (
          !sameVersion(
            state.entryIdentity,
            workflowEntryIdentityFor({
              projectId: input.projectId,
              entryMode: entryRow.entryMode,
              frozenRefs: entryRow.frozenRefs,
              reassessmentEntry: state.reassessmentEntry,
            }),
          ) ||
          (entryRow.inputSnapshotRef !== undefined &&
            (!("reference" in entryRow.inputSnapshotRef) ||
              !sameVersion(entryRow.entryIdentity, entryRow.inputSnapshotRef.reference)))
        ) {
          return failed("assessment-entry-identity-mismatch");
        }
        if (!state.assessmentRecordRefs.some((ref) => sameRef(ref, assessmentRecordRef))) {
          return failed("assessment-record-not-in-run");
        }
        if (state.entryMode !== "reassess") {
          // 非重评运行没有入口变化事实；带该字段说明登记与正文错配，同样失败闭合。
          if (state.reassessmentEntry !== undefined) {
            return failed("assessment-entry-inconsistent");
          }
          entries.push({
            assessmentRecordRef,
            runRef: {
              kind: "workflow-run",
              reference: { entityId: runId, versionId: state.runVersionId },
            },
            entryMode: state.entryMode,
            changedInputRefs: [],
          });
          continue;
        }
        const entry = state.reassessmentEntry;
        if (entry === undefined) return failed("reassessment-entry-missing");
        if (sameRef(entry.previousAssessmentRecordRef, assessmentRecordRef)) {
          return failed("reassessment-predecessor-inconsistent");
        }
        entries.push({
          assessmentRecordRef,
          runRef: {
            kind: "workflow-run",
            reference: { entityId: runId, versionId: state.runVersionId },
          },
          entryMode: state.entryMode,
          previousAssessmentRecordRef: entry.previousAssessmentRecordRef,
          reason: entry.reason,
          changedInputRefs: entry.changedInputRefs,
        });
      }
      return { kind: "succeeded", entries };
    } catch {
      return failed("assessment-entries-inconsistent");
    }
  }

  /**
   * 运行投影窄读（design D-04）：先按精确运行引用读该运行已登记的精确 run-state 工件，
   * 再按 `parent-child` 链边验证子运行确属该精确父运行，最后有界读取选中子运行的阶段行。
   * 多个子运行且未选中时 `stages` 为空并给出选择，不合成一条阶段轨迹；读不到即失败，
   * 不用 checkpoint 或推断补齐。
   */
  async readAssessmentRun(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly workflowRunRef: WorkflowRunRefV1;
    readonly assessmentRunRef?: WorkflowRunRefV1;
    readonly resultCursor?: string;
    readonly reviewTaskCursor?: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly projection: AssessmentRunProjectionV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const occurredAt = this.#now().toISOString();
    const failed = (detailCode: string) => ({
      kind: "failed" as const,
      error: bindingProofError({
        code: "BUSINESS_BLOCKED",
        causalRunId: input.workflowRunRef.reference.entityId,
        occurredAt,
        requiredCapability: "projection.query",
        detailCode,
        stageCode: RUN_READ_STAGE_CODE_V1,
      }),
    });
    const denied = () => ({
      kind: "failed" as const,
      error: bindingProofError({
        code: "AUTHORIZATION_DENIED",
        causalRunId: input.workflowRunRef.reference.entityId,
        occurredAt,
        requiredCapability: "projection.query",
        detailCode: "assessment-run-denied",
        stageCode: RUN_READ_STAGE_CODE_V1,
      }),
    });
    const verified = await this.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: workflowGraphReadInvocationIdV1({
        operation: "run-read",
        projectId: input.projectId,
        targetId: input.workflowRunRef.reference.entityId,
      }),
      requestedAt: input.requestedAt,
    });
    if (verified === undefined) return denied();
    const runId = input.workflowRunRef.reference.entityId;
    try {
      const latest = await this.#latestRunStateWith({
        projectId: input.projectId,
        runId,
        requestedAt: input.requestedAt,
        verified,
      });
      if (latest === undefined) return denied();
      const { row, state } = latest;
      if (
        state.projectId !== input.projectId ||
        state.runId !== runId ||
        state.runVersionId !== row.resultVersionId
      ) {
        return denied();
      }
      // 图版本是已登记的启动事实：历史工件缺席时失败闭合，不用入口身份反推或编造。
      if (state.graphVersion === undefined) return failed("assessment-run-graph-version-missing");
      const target = await this.#selectedAssessmentRun({
        projectId: input.projectId,
        parentRunId: runId,
        parentRunRef: input.workflowRunRef,
        parentState: state,
        requested: input.assessmentRunRef,
        verified,
        requestedAt: input.requestedAt,
      });
      if (target.kind === "denied") return denied();
      if (target.kind === "failed") return failed(target.detailCode);
      const stages =
        target.stages === undefined
          ? await this.#runStages({
              projectId: input.projectId,
              runId,
            })
          : target.stages;
      const references = await this.#runReferences({
        projectId: input.projectId,
        runId: target.runId,
        resultCursor: input.resultCursor,
        reviewTaskCursor: input.reviewTaskCursor,
      });
      if (references === undefined) return failed("assessment-run-references-unreadable");
      return {
        kind: "succeeded",
        projection: AssessmentRunProjectionV1Schema.parse({
          runRef: input.workflowRunRef,
          entryMode: state.entryMode,
          status: state.status,
          stage: state.stage,
          ...(state.status === "waiting" && state.lastWaitingRef !== undefined
            ? { waitingRef: state.lastWaitingRef }
            : {}),
          graphVersion: state.graphVersion,
          actorRef: row.actorRef,
          startedAt: state.recordedAt,
          stateVersion: { entityId: runId, versionId: state.runVersionId },
          stages,
          resultRefs: references.resultRefs,
          reviewTaskRefs: references.reviewTaskRefs,
          assessmentRunRefs: state.assessmentRunRefs,
          ...(target.selectedAssessmentRunRef === undefined
            ? {}
            : { selectedAssessmentRunRef: target.selectedAssessmentRunRef }),
          ...(state.lastErrorRef === undefined ? {} : { error: state.lastErrorRef }),
          ...(input.resultCursor === undefined ? {} : { resultCursor: input.resultCursor }),
          ...(references.nextResultCursor === undefined
            ? {}
            : { nextResultCursor: references.nextResultCursor }),
          ...(references.nextReviewTaskCursor === undefined
            ? {}
            : { nextReviewTaskCursor: references.nextReviewTaskCursor }),
        }),
      };
    } catch {
      return failed("assessment-run-inconsistent");
    }
  }

  /**
   * 子运行选择：请求的子运行先经 `parent-child` 链边验证确属该精确父运行。
   * 未请求时只在**唯一**子运行时自动选中；多子运行不选，`stages` 留空交页面引导选择。
   */
  async #selectedAssessmentRun(input: {
    readonly projectId: string;
    readonly parentRunId: string;
    readonly parentRunRef: WorkflowRunRefV1;
    readonly parentState: WorkflowGraphRunStateV1;
    readonly requested: WorkflowRunRefV1 | undefined;
    readonly verified: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "denied" }
    | { readonly kind: "failed"; readonly detailCode: string }
    | {
        readonly kind: "ok";
        readonly runId: string;
        readonly selectedAssessmentRunRef: WorkflowRunRefV1 | undefined;
        readonly stages: readonly AssessmentRunStageV1[] | undefined;
      }
  > {
    const declared = input.parentState.assessmentRunRefs;
    const requested = input.requested;
    if (requested !== undefined) {
      if (!declared.some((ref) => sameRef(ref, requested))) return { kind: "denied" };
      const childLink = await this.#childLinkFor({
        projectId: input.projectId,
        parentRunId: input.parentRunId,
        childRunId: requested.reference.entityId,
        parentRunRef: input.parentRunRef,
        childRunRef: requested,
      });
      if (childLink !== true) return { kind: "denied" };
      const child = await this.#latestRunStateWith({
        projectId: input.projectId,
        runId: requested.reference.entityId,
        verified: input.verified,
        requestedAt: input.requestedAt,
      });
      if (child === undefined) return { kind: "denied" };
      return {
        kind: "ok",
        runId: requested.reference.entityId,
        selectedAssessmentRunRef: requested,
        stages: await this.#runStages({
          projectId: input.projectId,
          runId: requested.reference.entityId,
        }),
      };
    }
    if (declared.length !== 1) {
      // 父运行自身即呈现目标：保留父阶段，子运行阶段留空引导选择，不合成一条轨迹。
      return {
        kind: "ok",
        runId: input.parentRunId,
        selectedAssessmentRunRef: undefined,
        stages: undefined,
      };
    }
    const only = declared[0]!;
    const childLink = await this.#childLinkFor({
      projectId: input.projectId,
      parentRunId: input.parentRunId,
      childRunId: only.reference.entityId,
      parentRunRef: input.parentRunRef,
      childRunRef: only,
    });
    if (childLink !== true) return { kind: "denied" };
    const child = await this.#latestRunStateWith({
      projectId: input.projectId,
      runId: only.reference.entityId,
      verified: input.verified,
      requestedAt: input.requestedAt,
    });
    if (child === undefined) return { kind: "denied" };
    return {
      kind: "ok",
      runId: only.reference.entityId,
      selectedAssessmentRunRef: only,
      stages: await this.#runStages({
        projectId: input.projectId,
        runId: only.reference.entityId,
      }),
    };
  }

  /** 子运行归属证明：只认该精确父运行的 `parent-child` 链边，不看运行 id 前缀或父字段。 */
  async #childLinkFor(input: {
    readonly projectId: string;
    readonly parentRunId: string;
    readonly childRunId: string;
    readonly parentRunRef: WorkflowRunRefV1;
    readonly childRunRef: WorkflowRunRefV1;
  }): Promise<boolean> {
    const rows = await this.#db
      .selectFrom(LINKS_TABLE)
      .select("link_id")
      .where("project_id", "=", input.projectId)
      .where("run_id", "in", [input.parentRunId, input.childRunId])
      .where("relation", "=", "parent-child")
      .where(sql<SqlBool>`from_ref = ${JSON.stringify(input.parentRunRef)}::jsonb`)
      .where(sql<SqlBool>`to_ref = ${JSON.stringify(input.childRunRef)}::jsonb`)
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /** 阶段轨迹只由已登记的阶段结果行构成；未发生的阶段不补默认值。 */
  async #runStages(input: {
    readonly projectId: string;
    readonly runId: string;
  }): Promise<readonly AssessmentRunStageV1[]> {
    const rows = await this.#db
      .selectFrom(RESULTS_TABLE)
      .select(["stage", "stage_result_ref"])
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .where("result_kind", "=", "stage-result")
      .distinctOn("stage")
      .orderBy("stage", "asc")
      .orderBy("recorded_at", "desc")
      .orderBy("result_id", "asc")
      .limit(ASSESSMENT_RUN_STAGE_SCAN_V1)
      .execute();
    return rows.flatMap((row) => {
      const stageCode = WorkflowRunStageV1Schema.safeParse(row.stage);
      // 阶段码不是已登记的闭合取值时不猜测：跳过该行，不合成阶段轨迹。
      if (!stageCode.success) return [];
      const stageResultRef = StageResultRefV1Schema.safeParse(row.stage_result_ref);
      return [
        {
          stageCode: stageCode.data,
          state: stageCode.data,
          ...(stageResultRef.success ? { stageResultRef: stageResultRef.data } : {}),
        },
      ];
    });
  }

  /** 当前受权精确运行的结果与复核任务引用有界分页。 */
  async #runReferences(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly resultCursor: string | undefined;
    readonly reviewTaskCursor: string | undefined;
  }): Promise<
    | {
        readonly resultRefs: readonly ContractReferenceV1[];
        readonly reviewTaskRefs: readonly ReviewTaskRefV1[];
        readonly nextResultCursor?: string | undefined;
        readonly nextReviewTaskCursor?: string | undefined;
      }
    | undefined
  > {
    const offsetOf = (cursor: string | undefined): number => {
      if (cursor === undefined) return 0;
      if (!/^(0|[1-9][0-9]*)$/.test(cursor)) return Number.NaN;
      const parsed = Number.parseInt(cursor, 10);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
    };
    const resultOffset = offsetOf(input.resultCursor);
    const taskOffset = offsetOf(input.reviewTaskCursor);
    if (Number.isNaN(resultOffset) || Number.isNaN(taskOffset)) return undefined;
    const ordered = () =>
      this.#db
        .selectFrom(RESULTS_TABLE)
        .select(["result_kind", "run_result_ref", "stage_result_ref", "waiting_ref"])
        .where("project_id", "=", input.projectId)
        .where("run_id", "=", input.runId)
        .orderBy("recorded_at", "asc")
        .orderBy("result_id", "asc");
    const resultRows = await ordered()
      .where("result_kind", "in", ["run-result", "stage-result", "route-decision"])
      .limit(ASSESSMENT_RUN_RESULT_SCAN_V1 + 1)
      .offset(resultOffset)
      .execute();
    const taskRows = await ordered()
      .where("result_kind", "=", "waiting")
      .limit(ASSESSMENT_RUN_RESULT_SCAN_V1 + 1)
      .offset(taskOffset)
      .execute();
    const resultRefs: ContractReferenceV1[] = [];
    for (const row of resultRows.slice(0, ASSESSMENT_RUN_RESULT_SCAN_V1)) {
      const candidate =
        row.result_kind === "run-result"
          ? row.run_result_ref
          : row.result_kind === "stage-result"
            ? row.stage_result_ref
            : undefined;
      const parsed = ContractReferenceV1Schema.safeParse(candidate);
      if (parsed.success) resultRefs.push(parsed.data);
    }
    const reviewTaskRefs: ReviewTaskRefV1[] = [];
    for (const row of taskRows.slice(0, ASSESSMENT_RUN_RESULT_SCAN_V1)) {
      const waiting = WaitingRefV1Schema.safeParse(row.waiting_ref);
      const parsed = ReviewTaskRefV1Schema.safeParse(
        waiting.success && waiting.data.kind === "review" ? waiting.data.reviewTaskRef : undefined,
      );
      if (parsed.success) reviewTaskRefs.push(parsed.data);
    }
    return {
      resultRefs,
      reviewTaskRefs,
      ...(resultRows.length > ASSESSMENT_RUN_RESULT_SCAN_V1 ||
      taskRows.length > ASSESSMENT_RUN_RESULT_SCAN_V1
        ? {
            nextResultCursor: String(
              resultOffset + Math.min(resultRows.length, ASSESSMENT_RUN_RESULT_SCAN_V1),
            ),
          }
        : {}),
      ...(resultRows.length > ASSESSMENT_RUN_RESULT_SCAN_V1 ||
      taskRows.length > ASSESSMENT_RUN_RESULT_SCAN_V1
        ? {
            nextReviewTaskCursor: String(
              taskOffset + Math.min(taskRows.length, ASSESSMENT_RUN_RESULT_SCAN_V1),
            ),
          }
        : {}),
    };
  }

  async readQuery(input: {
    readonly projectId: string;
    readonly queryResultId: string;
    readonly queryResultVersionId: string;
  }): Promise<WorkflowQueryRegistrationV1 | undefined> {
    const row = await this.#selectQuery(input.projectId, input.queryResultId);
    if (row === undefined || row.query_result_version_id !== input.queryResultVersionId) {
      return undefined;
    }
    return queryFromDb(row);
  }

  async #selectQuery(
    projectId: string,
    queryResultId: string,
  ): Promise<WorkflowGraphQueryDbRow | undefined> {
    return await this.#db
      .selectFrom(QUERIES_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("query_result_id", "=", queryResultId)
      .executeTakeFirst();
  }

  async #registerRowInTransaction(
    row: WorkflowGraphResultRowV1,
    transaction: WorkflowGraphTransactionV1,
  ): Promise<WorkflowRegisterOutcomeV1> {
    const inserted = await transaction
      .insertInto(RESULTS_TABLE)
      .values(insertColumnsForRow(row) as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    if (Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0) {
      return { kind: "registered", replayed: false };
    }
    // `doNothing` 同时覆盖主键与 `(project_id, result_kind, idempotency_key)` 唯一键，
    // 因此逐个身份回查：主键命中是同身份重放，幂等键命中且摘要不同是异载荷登记。
    const byIdentity = await transaction
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", row.projectId)
      .where("result_kind", "=", row.resultKind)
      .where("result_id", "=", row.resultId)
      .where("result_version_id", "=", row.resultVersionId)
      .executeTakeFirst();
    const stored =
      byIdentity ??
      (await transaction
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", row.projectId)
        .where("result_kind", "=", row.resultKind)
        .where("idempotency_key", "=", row.idempotencyKey)
        .executeTakeFirst());
    if (stored === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "workflow-graph.result-register-missing");
    }
    if (stored.request_digest !== row.requestDigest) {
      return { kind: "idempotency-conflict", priorCommandId: stored.command_id };
    }
    return { kind: "registered", replayed: true };
  }

  async putBody(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly commandId: string;
    readonly issuedAt: string;
    readonly artifactId: string;
    readonly body: WorkflowGraphArtifactBodyV1;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ContentArtifactRefV1> {
    const body = WorkflowGraphArtifactBodyV1Schema.parse(input.body);
    const verified = await this.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      // 身份由调用方给出：它必须是 `authorization` 实际签发时的 invocationId（运行/命令身份）。
      // 端口内固定派生会让真实签发方提供的上下文永远对不上，复验必然拒结（design D1/D2）。
      invocationId: input.invocationId,
      requestedAt: input.issuedAt,
    });
    if (verified === undefined) throw new WorkflowGraphDeniedErrorV1("body-write-denied");
    const requiredCapability = verified.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new WorkflowGraphDeniedErrorV1("body-write-capability-not-granted");
    }
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: verified,
        requiredCapability,
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1[body.bodyKind],
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(body));
      })(),
    );
    if (result.artifactRef.kind !== "content-artifact") {
      throw makePersistenceError("TRANSACTION_FAILED", "workflow-graph.body-kind");
    }
    return result.artifactRef;
  }

  /** 同次业务入口已授权，按精确引用读取 C04 正文。 */
  async readBody(input: {
    readonly projectId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphArtifactBodyV1 | undefined> {
    if (
      input.authorization.projectId !== input.projectId ||
      input.authorization.actorId !== input.actorId
    )
      return undefined;
    return await this.#openBody(input);
  }

  async #openBody(input: {
    readonly projectId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphArtifactBodyV1 | undefined> {
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) return undefined;
    for (const purposeCode of Object.values(WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1)) {
      try {
        const handle = await this.#artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `c30-graph-read-${randomUUID()}`,
            idempotencyKey: `c30-graph-read-${randomUUID()}`,
            artifactRef: input.artifactRef,
            projectId: input.projectId,
            actorId: input.actorId,
            requestedAt: input.requestedAt,
            purposeCode,
            requiredCapability,
            authorization: input.authorization,
          }),
        );
        const bytes = await boundedContent(handle.content, MAX_BODY_BYTES_V1);
        await handle.completed;
        const decoded: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        const parsed = WorkflowGraphArtifactBodyV1Schema.safeParse(decoded);
        if (
          parsed.success &&
          WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1[parsed.data.bodyKind] === purposeCode
        ) {
          return parsed.data;
        }
      } catch {
        // 用途码与登记不符时换下一个候选；全部不符即视为不可读正文，不做部分接受。
        continue;
      }
    }
    return undefined;
  }

  #ambientTransaction(context: unknown): WorkflowGraphTransactionV1 {
    if (typeof context !== "object" || context === null) {
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "workflow-graph.result-register-transaction",
      );
    }
    return getPostgresTransaction(
      context as TransactionContextV1,
    ) as unknown as WorkflowGraphTransactionV1;
  }
}

export const createPostgresWorkflowAdapter = (
  options: PostgresWorkflowAdapterOptionsV1,
): PostgresWorkflowAdapterV1 => {
  const persistence = new WorkflowGraphPersistence(options);
  const registrationStore: WorkflowGraphRegistrationStoreV1 = {
    readAssessmentEntrySnapshot: (input) => persistence.readAssessmentEntrySnapshot(input),
    assertCurrentRunVersion: (input, context) =>
      persistence.assertCurrentRunVersion(input, context),
    registerRow: (input, context) => persistence.registerRow(input, context),
    readRow: (input) => persistence.readRow(input),
    listRunRows: (input) => persistence.listRunRows(input),
    readLatestRunState: (input) => persistence.readLatestRunState(input),
    registerLink: (input, context) => persistence.registerLink(input, context),
    listRunLinks: (input) => persistence.listRunLinks(input),
    registerQuery: (input) => persistence.registerQuery(input),
    readQuery: (input) => persistence.readQuery(input),
  };
  return {
    readEventParentRun: (input) => persistence.readEventParentRun(input),
    verifyEventConsumption: (input) => persistence.verifyEventConsumption(input),
    verifyCheckpointDomainReference: (input) => persistence.verifyCheckpointDomainReference(input),
    verifyCheckpointWaitingReference: (input) =>
      persistence.verifyCheckpointWaitingReference(input),
    verifyCheckpointReference: (input) => persistence.verifyCheckpointReference(input),
    registrationStore,
    bodies: {
      putBody: (input) => persistence.putBody(input),
      readBody: (input) => persistence.readBody(input),
    },
    bindingProof: {
      verifyResponseWorkflowBinding: (query) => persistence.verifyResponseWorkflowBinding(query),
    },
    runCompletionProof: {
      verifyWorkflowRunCompletion: (query) => persistence.verifyWorkflowRunCompletion(query),
    },
    entriesRead: {
      readAssessmentEntriesForRecords: (input) =>
        persistence.readAssessmentEntriesForRecords(input),
    },
    runRead: {
      readAssessmentRun: (input) => persistence.readAssessmentRun(input),
    },
  };
};
