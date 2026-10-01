import { TextDecoder } from "node:util";
import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { ACCESS_POLICY_REF_V1, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AcceptanceRouteSetV1Schema,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
} from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  toWaitingRef,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphRunStateV1,
} from "@riskflow/core/identification/graph";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { JsonValue } from "@riskflow/core/persistence";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  RiskIdentificationReadQueryV1Schema,
  RouteDecisionRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WorkflowRunRefV1Schema,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
  type IdentificationRunStageV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
  type RiskIdentificationMergeGroupSummaryV1,
  type RiskIdentificationReadPortV1,
  type RiskIdentificationReadQueryV1,
  type RiskIdentificationReadResultV1,
  type RiskIdentificationReadSuccessV1,
  type RiskIdentificationRunListItemV1,
  type RiskIdentificationRunStageEntryV1,
  type RiskIdentificationWorkItemCoverageV1,
  type RiskRecordCatalogItemV1,
  type RouteDecisionRefV1,
  type WaitingRefV1,
  type WorkflowRunStatusV1,
} from "@riskflow/contracts/ports";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";

import { IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1 } from "../graph/index.js";
import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

const GRAPH_TABLE = "business.identification_graph_results";
const FINALIZATION_TABLE = "business.identification_finalization_results";
const RECORDS_TABLE = "business.standardized_risk_records";
const STAGE_CODE_V1 = "risk-identification.read";
const CAPABILITY_V1 = "risk-identification.read";

/** 与 C24 读侧一致的有界正文读取上限：超出即视为不可信来源，不做部分解析。 */
const MAX_BODY_BYTES_V1 = 16 * 1024 * 1024;

/** D3 引用集合上界：与契约 `RiskIdentificationRunReadSuccessV1Schema` 的 max 一致。 */
const RUN_READ_BOUNDS_V1 = {
  workItemCoverage: 256,
  mergeGroups: 256,
  agentTaskRefs: 64,
  reviewTaskRefs: 64,
  acceptedRiskRecordRefs: 500,
  groupRefs: 256,
} as const;

/** 识别工作流错误引用身份前缀（apps/worker 识别图写侧的确定性派生格式），只用于解析失败阶段事实。 */
const WORKFLOW_ERROR_ENTITY_PREFIX_V1 = "identification-graph-workflow-error:" as const;

const IDENTIFICATION_STAGE_ORDER_V1: readonly IdentificationRunStageV1[] = [
  "I0",
  "I1",
  "I2",
  "I3",
  "I4",
  "I5",
  "I6",
  "I7",
  "I8",
  "I9",
];

type TimestampColumn = Date | string;

interface IdentificationGraphResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  run_id: string;
  run_version_id: string;
  command_id: string;
  idempotency_key: string;
  request_digest: string;
  artifact_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  parent_run_ref: JsonValue | null;
  preparation_snapshot_ref: JsonValue | null;
  input_snapshot_ref: JsonValue | null;
  work_plan_ref: JsonValue | null;
  stage_result_ref: JsonValue | null;
  waiting_ref: JsonValue | null;
  workflow_error_ref: JsonValue | null;
  run_result_ref: JsonValue | null;
  valid_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface AcceptanceRouteSetDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  artifact_ref: JsonValue;
  authorization_scope_digest: string;
}

interface StandardizedRiskRecordDbRow {
  project_id: string;
  risk_record_id: string;
  version_id: string;
  risk_record_ref: JsonValue;
  payload: JsonValue;
  identification_run_ref: JsonValue;
  route_decision_ref: JsonValue | null;
  review_decision_ref: JsonValue | null;
  source_segment_ids: JsonValue;
  mechanism_entry_ids: JsonValue;
  authorization_scope_digest: string;
  created_at: TimestampColumn;
  audit_entry_id: string;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type RiskIdentificationReadDatabaseV1 = PostgresDatabase & {
  "business.identification_graph_results": IdentificationGraphResultDbRow;
  "business.identification_finalization_results": AcceptanceRouteSetDbRow;
  "business.standardized_risk_records": StandardizedRiskRecordDbRow;
};

const asIso = (value: TimestampColumn): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const asTime = (value: TimestampColumn): number => new Date(value).getTime();

const refKey = (reference: { readonly entityId: string; readonly versionId: string }): string =>
  `${reference.entityId}@${reference.versionId}`;

const asVersionedRef = (
  value: unknown,
):
  | {
      readonly kind: string;
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }
  | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { kind?: unknown; reference?: unknown };
  if (typeof candidate.kind !== "string") return undefined;
  const reference = candidate.reference as { entityId?: unknown; versionId?: unknown } | undefined;
  if (
    reference === undefined ||
    typeof reference.entityId !== "string" ||
    typeof reference.versionId !== "string"
  ) {
    return undefined;
  }
  return {
    kind: candidate.kind,
    reference: { entityId: reference.entityId, versionId: reference.versionId },
  };
};

/** 标识符列表事实：含非字符串或空串即视为不可信来源（fail closed，不部分披露）。 */
const identifierList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? (value as readonly string[])
    : undefined;

const decodeCursor = (cursor: string | undefined): number | "invalid" => {
  if (cursor === undefined) return 0;
  if (!/^offset-\d+$/u.test(cursor)) return "invalid";
  return Number.parseInt(cursor.slice("offset-".length), 10);
};

const encodeCursor = (offset: number): string => `offset-${offset}`;

const boundedContent = async (
  content: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new RangeError("artifact exceeds the bounded read limit");
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

const READ_BRANCH_V1 = {
  "run-list": "risk-identification.run-list",
  "run-read": "risk-identification.run-read",
  "record-catalog": "risk-identification.record-catalog",
  "record-read": "risk-identification.record-read",
} as const satisfies Record<RiskIdentificationReadQueryV1["kind"], ModuleBranchV1>;

const readError = (
  value:
    | {
        readonly code: "AUTHORIZATION_DENIED";
        readonly branch: ModuleBranchV1;
        readonly causalRunId: string;
        readonly occurredAt: string;
      }
    | {
        readonly code: "UNSUPPORTED_CONTRACT";
        readonly causalRunId: string;
        readonly occurredAt: string;
      }
    | {
        readonly code: "BUSINESS_BLOCKED";
        readonly blockerKind: string;
        readonly causalRunId: string;
        readonly occurredAt: string;
      },
): ModuleErrorV1 => {
  const common = {
    stageCode: STAGE_CODE_V1,
    occurredAt: value.occurredAt,
    causalRunId: value.causalRunId,
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
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: false,
        schemaVersion: "1",
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "business-blocked",
        retryable: false,
        blockerKind: value.blockerKind,
        // 只标识本读接缝自身的边界，不指向任何受限目标。
        blockerRef: {
          kind: "content-artifact",
          reference: { entityId: "risk-identification-read-bound", versionId: "v1" },
        },
      });
  }
};

const failed = (error: ModuleErrorV1): RiskIdentificationReadResultV1 => ({
  kind: "failed",
  error,
});

const succeeded = (result: RiskIdentificationReadSuccessV1): RiskIdentificationReadResultV1 => ({
  kind: "succeeded",
  result,
});

/**
 * 指向其它工程、其它操作者或未持识别读能力的请求先按授权失败收口，伪造请求无法探出差异
 * （与 C32 `catalogRequestDenied` 同形）。
 */
const readRequestDenied = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const authorization = request.authorization;
  if (typeof authorization !== "object" || authorization === null) return false;
  const context = authorization as Record<string, unknown>;
  if (
    typeof request.projectId === "string" &&
    typeof context.projectId === "string" &&
    request.projectId !== context.projectId
  ) {
    return true;
  }
  if (
    typeof request.actorId === "string" &&
    typeof context.actorId === "string" &&
    request.actorId !== context.actorId
  ) {
    return true;
  }
  const capabilities = context.grantedCapabilities;
  return Array.isArray(capabilities) && !capabilities.includes(CAPABILITY_V1);
};

export interface PostgresRiskIdentificationReadAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & 本模块只读行形状>`。 */
  readonly db: unknown;
  /** C04 工件存储：run-state/work-plan/acceptance-route-set 正文只经 C04 有界读取。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 当前授权复验端口：每条受保护读取在披露任何事实前按当前 actor/工程复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly now?: () => Date;
}

/**
 * C33 识别运行与风险记录只读适配器（design D3/D4，IP-03）：在 identification 所有权域内组合
 * `business.identification_graph_results` 运行登记行（+C04 正文）与
 * `business.standardized_risk_records` 既有登记行，不读其它模块私表、不新建表、不反写事实。
 * 每条查询先经 C05 `verify` 复验当前授权，再按记录冻结的范围摘要逐条对账；无权、跨工程、
 * 不存在、版本不符与事实不一致统一收口为逐字相同的 AUTHORIZATION_DENIED（不提供存在性
 * oracle），输出引用集合超界收口为 BUSINESS_BLOCKED 与稳定 blockerKind，不静默截断。
 *
 * `triggerReason` 只在登记行存在触发原因事实时输出；识别运行登记行当前不存该字段，因此本
 * 适配器永不输出它（design D3：不得伪造）。
 */
export class PostgresRiskIdentificationReadAdapter implements RiskIdentificationReadPortV1 {
  readonly #db: Kysely<RiskIdentificationReadDatabaseV1>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #now: () => Date;

  constructor(options: PostgresRiskIdentificationReadAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<RiskIdentificationReadDatabaseV1>;
    this.#artifactStore = options.artifactStore;
    this.#authorization = options.authorization;
    this.#now = options.now ?? (() => new Date());
  }

  async read(query: RiskIdentificationReadQueryV1): Promise<RiskIdentificationReadResultV1> {
    const parsed = RiskIdentificationReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      const queryId =
        typeof (query as { queryId?: unknown } | null)?.queryId === "string"
          ? (query as { queryId: string }).queryId
          : STAGE_CODE_V1;
      const occurredAt = this.#now().toISOString();
      if (readRequestDenied(query)) {
        return failed(
          readError({
            code: "AUTHORIZATION_DENIED",
            branch: "risk-identification.run-list",
            causalRunId: queryId,
            occurredAt,
          }),
        );
      }
      return failed(readError({ code: "UNSUPPORTED_CONTRACT", causalRunId: queryId, occurredAt }));
    }
    const valid = parsed.data;
    const branch = READ_BRANCH_V1[valid.kind];
    try {
      const verified = await this.#verify(valid, branch);
      switch (valid.kind) {
        case "run-list":
          return await this.#runList(valid, verified);
        case "run-read":
          return await this.#runRead(valid, verified);
        case "record-catalog":
          return await this.#recordCatalog(valid, verified);
        case "record-read":
          return await this.#recordRead(valid, verified);
      }
    } catch {
      return failed(this.#denied(valid.queryId, branch));
    }
  }

  /** 当前授权复验（C32 目录读同形）：冻结上下文不替代当前收窄上下文；任何不符按拒绝收口。 */
  async #verify(
    query: RiskIdentificationReadQueryV1,
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw new Error("risk-identification read authorization denied");
    }
    const decision = await this.#authorization.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: query.authorization.decidedAt,
    });
    if (decision.context.actorId !== query.actorId) {
      throw new Error("risk-identification read authorization denied");
    }
    return decision.context;
  }

  #denied(causalRunId: string, branch: ModuleBranchV1): ModuleErrorV1 {
    return readError({
      code: "AUTHORIZATION_DENIED",
      branch,
      causalRunId,
      occurredAt: this.#now().toISOString(),
    });
  }

  #blocked(blockerKind: string, causalRunId: string): ModuleErrorV1 {
    return readError({
      code: "BUSINESS_BLOCKED",
      blockerKind,
      causalRunId,
      occurredAt: this.#now().toISOString(),
    });
  }

  /**
   * 读 C04 正文（C24 同形）：按登记行的精确 `artifactRef` 打开，`handle.verified` 保证字节与
   * 引用摘要一致；purposeCode 与写入清单不一致时工件注册表直接拒绝。
   */
  async #readBody(input: {
    readonly artifactRef: IdentificationGraphResultRowV1["artifactRef"];
    readonly purposeCode: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<unknown> {
    // 每次正文读取都是一次独立的受保护访问登记（C24 同形）：请求身份随机派生，重复读取同一
    // 工件不与历史访问记录冲突，重放同一性由输出内容保证而非读取请求身份。
    const requestId = `c33-read-${randomUUID()}`;
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId,
        idempotencyKey: requestId,
        artifactRef: input.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: input.purposeCode,
        requiredCapability: CAPABILITY_V1,
        authorization: input.authorization,
      }),
    );
    const bytes = await boundedContent(handle.content, MAX_BODY_BYTES_V1);
    await handle.verified;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  /** 回读一律经核心严格判别 Schema 复验，避免数据库补足核心未声明的形状。 */
  #graphRow(row: IdentificationGraphResultDbRow): IdentificationGraphResultRowV1 {
    return IdentificationGraphResultRowV1Schema.parse({
      schemaVersion: "1",
      projectId: row.project_id,
      resultId: row.result_id,
      resultVersionId: row.result_version_id,
      runId: row.run_id,
      runVersionId: row.run_version_id,
      commandId: row.command_id,
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
      artifactRef: row.artifact_ref,
      authorizationScopeDigest: row.authorization_scope_digest,
      actorRef: row.actor_ref,
      authorizationContextRef: row.authorization_context_ref,
      validAt: asIso(row.valid_at),
      recordedAt: asIso(row.recorded_at),
      persistedAt: asIso(row.persisted_at),
      auditEntryId: row.audit_entry_id,
      ...this.#graphKindColumns(row),
    });
  }

  #graphKindColumns(row: IdentificationGraphResultDbRow): Record<string, unknown> {
    switch (row.result_kind) {
      case "input-snapshot":
        return {
          resultKind: "input-snapshot",
          parentRunRef: row.parent_run_ref,
          preparationSnapshotRef: row.preparation_snapshot_ref,
          inputSnapshotRef: row.input_snapshot_ref,
        };
      case "work-plan":
        return {
          resultKind: "work-plan",
          parentRunRef: row.parent_run_ref,
          inputSnapshotRef: row.input_snapshot_ref,
          workPlanRef: row.work_plan_ref,
        };
      case "stage-result":
        return {
          resultKind: "stage-result",
          workPlanRef: row.work_plan_ref,
          stageResultRef: row.stage_result_ref,
        };
      case "waiting":
        return {
          resultKind: "waiting",
          waitingRef: row.waiting_ref,
          ...(row.stage_result_ref === null ? {} : { stageResultRef: row.stage_result_ref }),
        };
      case "workflow-error":
        return { resultKind: "workflow-error", workflowErrorRef: row.workflow_error_ref };
      case "run-state":
        return { resultKind: "run-state" };
      case "run-result":
        return {
          resultKind: "run-result",
          workPlanRef: row.work_plan_ref,
          runResultRef: row.run_result_ref,
        };
      case "cancellation":
        return { resultKind: "cancellation" };
      default:
        throw new TypeError("unknown identification graph result kind");
    }
  }

  /** 指定运行的最新 run-state 登记行；不存在即该运行在当前工程不可证明。 */
  async #latestRunStateRow(
    projectId: string,
    runId: string,
  ): Promise<IdentificationGraphResultRowV1 | undefined> {
    const row = await this.#db
      .selectFrom(GRAPH_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", runId)
      .orderBy("persisted_at", "desc")
      .orderBy("run_version_id", "desc")
      .limit(1)
      .executeTakeFirst();
    return row === undefined ? undefined : this.#graphRow(row);
  }

  /** 读 run-state 正文并核对运行身份逐字一致；不一致即不是同一状态版本。 */
  async #runStateOf(
    row: IdentificationGraphResultRowV1,
    query: { readonly projectId: string; readonly actorId: string; readonly requestedAt: string },
    verified: AuthorizationContextV1,
  ): Promise<IdentificationGraphRunStateV1 | undefined> {
    const decoded = await this.#readBody({
      artifactRef: row.artifactRef,
      purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["run-state"],
      projectId: query.projectId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      authorization: verified,
    });
    const body = IdentificationGraphArtifactBodyV1Schema.safeParse(decoded);
    if (!body.success || body.data.bodyKind !== "run-state") return undefined;
    const runState = body.data.runState;
    if (runState.runId !== row.runId || runState.runVersionId !== row.runVersionId) {
      return undefined;
    }
    return runState;
  }

  async #runList(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "run-list" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const cursor = decodeCursor(query.payload.cursor);
    if (cursor === "invalid")
      return failed(this.#denied(query.queryId, READ_BRANCH_V1["run-list"]));
    const pageSize = query.payload.pageSize ?? 50;
    const scopeDigest = authorizationScopeDigest(verified);

    // 同一运行的全部登记行共享 actorRef/validAt 与范围摘要；按工程 + 范围摘要聚合出可见运行。
    const groups = await this.#db
      .selectFrom(GRAPH_TABLE)
      .select((eb) => [
        "run_id",
        eb.fn.min("actor_ref").as("started_by"),
        eb.fn.min("valid_at").as("started_at"),
      ])
      .where("project_id", "=", query.projectId)
      .where("result_kind", "=", "run-state")
      .where("authorization_scope_digest", "=", scopeDigest)
      .groupBy("run_id")
      .orderBy("started_at", "desc")
      .orderBy("run_id", "asc")
      .execute();

    const itemFor = async (group: {
      run_id: string;
      started_by: string;
      started_at: TimestampColumn;
    }): Promise<RiskIdentificationRunListItemV1 | undefined> => {
      const row = await this.#latestRunStateRow(query.projectId, group.run_id);
      if (row === undefined || row.authorizationScopeDigest !== scopeDigest) return undefined;
      const runState = await this.#runStateOf(row, query, verified);
      if (runState === undefined) return undefined;
      return {
        runRef: {
          kind: "workflow-run",
          reference: { entityId: group.run_id, versionId: row.runVersionId },
        },
        stage: runState.stage,
        status: runState.status,
        startedBy: group.started_by,
        startedAt: asIso(group.started_at),
        acceptedCount: runState.acceptedRiskRecordRefs.length,
        pendingReviewCount: runState.pendingGroupRefs.length,
        rejectedCount: runState.rejectedGroupRefs.length,
      };
    };

    // 无状态筛选时只读本页正文；有筛选时必须按全部运行的事实过滤后再分页（游标基于过滤后序列）。
    const pageGroups =
      query.payload.status === undefined ? groups.slice(cursor, cursor + pageSize) : groups;
    const items: RiskIdentificationRunListItemV1[] = [];
    for (const group of pageGroups) {
      const item = await itemFor(group);
      if (item === undefined) continue;
      if (query.payload.status !== undefined && item.status !== query.payload.status) continue;
      items.push(item);
    }
    const visible =
      query.payload.status === undefined ? items : items.slice(cursor, cursor + pageSize);
    const total = query.payload.status === undefined ? groups.length : items.length;
    const consumed = cursor + pageSize;
    const next = consumed < total ? encodeCursor(consumed) : undefined;
    return succeeded({
      kind: "run-list",
      items: visible,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  async #runRead(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "run-read" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const branch = READ_BRANCH_V1["run-read"];
    const denied = () => failed(this.#denied(query.queryId, branch));
    const scopeDigest = authorizationScopeDigest(verified);
    const runId = query.payload.runRef.reference.entityId;
    const runVersionId = query.payload.runRef.reference.versionId;

    // 精确版本重放：只命中该 runVersionId 的 run-state 版本，不回落到"最新"。
    const stateRowRaw = await this.#db
      .selectFrom(GRAPH_TABLE)
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", runId)
      .where("run_version_id", "=", runVersionId)
      .executeTakeFirst();
    if (stateRowRaw === undefined) return denied();
    const stateRow = this.#graphRow(stateRowRaw);
    if (stateRow.authorizationScopeDigest !== scopeDigest) return denied();
    const runState = await this.#runStateOf(stateRow, query, verified);
    if (runState === undefined) return denied();

    // 精确版本快照：只组合不晚于该 run-state 版本落库的登记事实，保证同一 runRef 重放同形。
    const bound = asTime(stateRowRaw.persisted_at);
    const withinBound = (row: IdentificationGraphResultDbRow): boolean =>
      asTime(row.persisted_at) <= bound;
    const runRows = (
      await this.#db
        .selectFrom(GRAPH_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("run_id", "=", runId)
        .orderBy("persisted_at", "asc")
        .orderBy("result_id", "asc")
        .execute()
    ).filter((row) => row.authorization_scope_digest === scopeDigest && withinBound(row));

    // 阶段进度：已登记 stage-result 的阶段为完成（I1 的 waiting 判别不算完成）；
    // 当前阶段未完成时以 run-state 状态如实呈现，失败阶段携带错误码与可重试标记。
    const completedStages = new Set<IdentificationRunStageV1>();
    const agentTaskRefs = new Map<string, AgentTaskRefV1>();
    const reviewTaskRefs = new Map<string, ReviewTaskRefV1>();
    for (const raw of runRows) {
      if (raw.result_kind !== "stage-result") continue;
      const row = this.#graphRow(raw);
      const decoded = await this.#readBody({
        artifactRef: row.artifactRef,
        purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["stage-result"],
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        authorization: verified,
      });
      const body = IdentificationGraphArtifactBodyV1Schema.safeParse(decoded);
      if (!body.success || body.data.bodyKind !== "stage-result") return denied();
      const stageResult = body.data.stageResult;
      if (stageResult.runRef.reference.entityId !== runId) return denied();
      if (stageResult.stage !== "I1" || stageResult.resultKind === "ready") {
        completedStages.add(stageResult.stage);
      }
      if (stageResult.stage === "I3") {
        for (const ref of stageResult.agentTaskRefs) {
          agentTaskRefs.set(refKey(ref.reference), ref);
        }
      }
      if (stageResult.stage === "I5" || stageResult.stage === "I7") {
        for (const ref of stageResult.reviewTaskRefs) {
          reviewTaskRefs.set(refKey(ref.reference), ref);
        }
      }
    }

    const stageEntries: RiskIdentificationRunStageEntryV1[] = [];
    for (const stage of IDENTIFICATION_STAGE_ORDER_V1) {
      if (completedStages.has(stage)) {
        stageEntries.push({ stage, status: "completed" });
        continue;
      }
      if (stage !== runState.stage) continue;
      const entry: {
        stage: IdentificationRunStageV1;
        status: WorkflowRunStatusV1;
        failureCode?: string;
        retryable?: boolean;
      } = { stage, status: runState.status };
      if (
        (runState.status === "retryable-failure" || runState.status === "terminal-failure") &&
        runState.lastErrorRef !== undefined
      ) {
        const prefix = `${WORKFLOW_ERROR_ENTITY_PREFIX_V1}${stage}:`;
        const entityId = runState.lastErrorRef.reference.entityId;
        if (entityId.startsWith(prefix) && entityId.length > prefix.length) {
          entry.failureCode = entityId.slice(prefix.length);
          entry.retryable = runState.status === "retryable-failure";
        }
      }
      stageEntries.push(entry);
    }

    // 工序工作项覆盖：最新工作计划（不晚于本状态版本）× run-state 三个工作项游标。
    const workPlanRowRaw = [...runRows].reverse().find((row) => row.result_kind === "work-plan");
    let workItems: readonly {
      readonly workItemRef: RiskIdentificationWorkItemCoverageV1["workItemRef"];
      readonly nodeId: string;
    }[] = [];
    if (workPlanRowRaw !== undefined) {
      const workPlanRow = this.#graphRow(workPlanRowRaw);
      const decoded = await this.#readBody({
        artifactRef: workPlanRow.artifactRef,
        purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["work-plan"],
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        authorization: verified,
      });
      const body = IdentificationGraphArtifactBodyV1Schema.safeParse(decoded);
      if (!body.success || body.data.bodyKind !== "work-plan") return denied();
      workItems = body.data.workPlan.workItems;
    }
    const workItemStatus = new Map<string, WorkflowRunStatusV1>();
    for (const ref of runState.pendingWorkItemRefs)
      workItemStatus.set(refKey(ref.reference), "pending");
    for (const ref of runState.failedWorkItemRefs) {
      workItemStatus.set(refKey(ref.reference), "terminal-failure");
    }
    for (const ref of runState.completedWorkItemRefs) {
      workItemStatus.set(refKey(ref.reference), "completed");
    }
    const workItemCoverage: RiskIdentificationWorkItemCoverageV1[] = workItems.map((item) => ({
      workItemRef: item.workItemRef,
      processNodeId: item.nodeId,
      status: workItemStatus.get(refKey(item.workItemRef.reference)) ?? "pending",
    }));

    // 合并组摘要：验收路由集（同所有权域 C22 登记 + C04 正文）× run-state 分组游标。
    const mergeGroups: RiskIdentificationMergeGroupSummaryV1[] = [];
    const groupedRefs = new Set<string>();
    if (runState.acceptedRouteSetRef !== undefined) {
      const routeSetRow = await this.#db
        .selectFrom(FINALIZATION_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("result_kind", "=", "acceptance-route-set")
        .where("result_id", "=", runState.acceptedRouteSetRef.reference.entityId)
        .where("result_version_id", "=", runState.acceptedRouteSetRef.reference.versionId)
        .executeTakeFirst();
      if (routeSetRow === undefined || routeSetRow.authorization_scope_digest !== scopeDigest) {
        return denied();
      }
      const decoded = await this.#readBody({
        artifactRef: routeSetRow.artifact_ref as IdentificationGraphResultRowV1["artifactRef"],
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        authorization: verified,
      });
      const routeSet = AcceptanceRouteSetV1Schema.safeParse(decoded);
      if (!routeSet.success) return denied();
      if (routeSet.data.identificationRunRef.reference.entityId !== runId) return denied();
      const groupStatus = new Map<string, RiskIdentificationMergeGroupSummaryV1["status"]>();
      for (const ref of runState.pendingGroupRefs) {
        groupStatus.set(refKey(ref.reference), "pending-review");
      }
      for (const ref of runState.rejectedGroupRefs) {
        groupStatus.set(refKey(ref.reference), "rejected");
      }
      for (const route of routeSet.data.routes) {
        const key = refKey(route.groupRef.reference);
        groupedRefs.add(key);
        mergeGroups.push({
          groupRef: route.groupRef,
          status: groupStatus.get(key) ?? "accepted",
          acceptanceKind: route.routeKind,
        });
      }
    }
    for (const ref of runState.pendingGroupRefs) {
      const key = refKey(ref.reference);
      if (groupedRefs.has(key)) continue;
      groupedRefs.add(key);
      mergeGroups.push({ groupRef: ref, status: "pending-review" });
    }
    for (const ref of runState.rejectedGroupRefs) {
      const key = refKey(ref.reference);
      if (groupedRefs.has(key)) continue;
      groupedRefs.add(key);
      mergeGroups.push({ groupRef: ref, status: "rejected" });
    }

    // 等待中的 Agent/复核任务引用并入关联集合（与既有 stage-result 引用去重）。
    if (runState.lastWaitingRef?.kind === "retrieval-review-agent") {
      const ref = runState.lastWaitingRef.agentTaskRef;
      agentTaskRefs.set(refKey(ref.reference), ref);
    }
    if (runState.lastWaitingRef?.kind === "human-review") {
      const ref = runState.lastWaitingRef.reviewTaskRef;
      reviewTaskRefs.set(refKey(ref.reference), ref);
    }

    let waitingRef: WaitingRefV1 | undefined;
    if (runState.lastWaitingRef !== undefined) {
      waitingRef = toWaitingRef({ waiting: runState.lastWaitingRef });
    }

    // D3 引用有界：任一集合超出契约上界即整读失败，不截断冒充完整。
    if (
      workItemCoverage.length > RUN_READ_BOUNDS_V1.workItemCoverage ||
      mergeGroups.length > RUN_READ_BOUNDS_V1.mergeGroups ||
      agentTaskRefs.size > RUN_READ_BOUNDS_V1.agentTaskRefs ||
      reviewTaskRefs.size > RUN_READ_BOUNDS_V1.reviewTaskRefs ||
      runState.acceptedRiskRecordRefs.length > RUN_READ_BOUNDS_V1.acceptedRiskRecordRefs ||
      runState.pendingGroupRefs.length > RUN_READ_BOUNDS_V1.groupRefs ||
      runState.rejectedGroupRefs.length > RUN_READ_BOUNDS_V1.groupRefs
    ) {
      return failed(this.#blocked("run-read-reference-overflow", query.queryId));
    }

    return succeeded({
      kind: "run-read",
      runRef: query.payload.runRef,
      stage: runState.stage,
      status: runState.status,
      stageEntries,
      workItemCoverage,
      mergeGroups,
      agentTaskRefs: [...agentTaskRefs.values()],
      reviewTaskRefs: [...reviewTaskRefs.values()],
      resultCounts: {
        plannedWorkItemCount: workItems.length,
        completedWorkItemCount: runState.completedWorkItemRefs.length,
        failedWorkItemCount: runState.failedWorkItemRefs.length,
        zeroResultCount: runState.zeroResults.length,
        acceptedCount: runState.acceptedRiskRecordRefs.length,
        pendingReviewCount: runState.pendingGroupRefs.length,
        rejectedCount: runState.rejectedGroupRefs.length,
      },
      acceptedRiskRecordRefs: [...runState.acceptedRiskRecordRefs],
      pendingReviewGroupRefs: [...runState.pendingGroupRefs],
      rejectedGroupRefs: [...runState.rejectedGroupRefs],
      ...(waitingRef === undefined ? {} : { waitingRef }),
    });
  }

  /** 记录行 → 目录条目；正文不可信或验收事实缺席的记录不进入目录（不伪造验收方式）。 */
  #catalogItem(row: StandardizedRiskRecordDbRow): RiskRecordCatalogItemV1 | undefined {
    const envelope = StandardizedRiskRecordEnvelopeSchema.safeParse(row.payload);
    if (!envelope.success || envelope.data.riskRecordId !== row.risk_record_id) return undefined;
    const riskRecordRef = StandardizedRiskRecordRefV1Schema.safeParse(row.risk_record_ref);
    if (!riskRecordRef.success) return undefined;
    const acceptanceKind =
      row.route_decision_ref !== null
        ? ("automatic" as const)
        : row.review_decision_ref !== null
          ? ("review" as const)
          : undefined;
    if (acceptanceKind === undefined) return undefined;
    return {
      riskRecordRef: riskRecordRef.data,
      processNodeId: envelope.data.record.processNodeId,
      riskEventSummary: envelope.data.record.riskEvent,
      compositeConfidence: envelope.data.compositeConfidence,
      acceptanceKind,
    };
  }

  async #recordCatalog(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "record-catalog" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const branch = READ_BRANCH_V1["record-catalog"];
    const cursor = decodeCursor(query.payload.cursor);
    if (cursor === "invalid") return failed(this.#denied(query.queryId, branch));
    const pageSize = query.payload.pageSize ?? 50;
    const scopeDigest = authorizationScopeDigest(verified);

    let rows: StandardizedRiskRecordDbRow[];
    try {
      rows = await this.#db
        .selectFrom(RECORDS_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .orderBy("created_at", "desc")
        .orderBy("risk_record_id", "asc")
        .execute();
    } catch (error) {
      throw mapPostgresError(error, `${STAGE_CODE_V1}.record-catalog`);
    }
    const runFilter = query.payload.identificationRunRef;
    const items = rows
      .filter((row) => row.authorization_scope_digest === scopeDigest)
      .map((row) => ({ row, item: this.#catalogItem(row) }))
      .flatMap(({ row, item }) => {
        if (item === undefined) return [];
        if (
          query.payload.processNodeId !== undefined &&
          item.processNodeId !== query.payload.processNodeId
        ) {
          return [];
        }
        if (
          query.payload.acceptanceKind !== undefined &&
          item.acceptanceKind !== query.payload.acceptanceKind
        ) {
          return [];
        }
        if (runFilter !== undefined) {
          const runRef = asVersionedRef(row.identification_run_ref);
          if (
            runRef === undefined ||
            runRef.reference.entityId !== runFilter.reference.entityId ||
            runRef.reference.versionId !== runFilter.reference.versionId
          ) {
            return [];
          }
        }
        return [item];
      });
    const page = items.slice(cursor, cursor + pageSize);
    const next = cursor + pageSize < items.length ? encodeCursor(cursor + pageSize) : undefined;
    return succeeded({
      kind: "record-catalog",
      items: page,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  async #recordRead(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "record-read" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const branch = READ_BRANCH_V1["record-read"];
    const denied = () => failed(this.#denied(query.queryId, branch));
    const scopeDigest = authorizationScopeDigest(verified);
    const recordRef = query.payload.riskRecordRef;

    let row: StandardizedRiskRecordDbRow | undefined;
    try {
      row = await this.#db
        .selectFrom(RECORDS_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("risk_record_id", "=", recordRef.reference.entityId)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, `${STAGE_CODE_V1}.record-read`);
    }
    // 不存在、跨工程（SQL 已按工程过滤）、版本不符与当前授权看不到范围：逐字同形，不提供 oracle。
    if (
      row === undefined ||
      row.version_id !== recordRef.reference.versionId ||
      row.authorization_scope_digest !== scopeDigest
    ) {
      return denied();
    }
    const envelope = StandardizedRiskRecordEnvelopeSchema.safeParse(row.payload);
    if (!envelope.success || envelope.data.riskRecordId !== row.risk_record_id) return denied();
    const riskRecordRef = StandardizedRiskRecordRefV1Schema.safeParse(row.risk_record_ref);
    const identificationRunRef = WorkflowRunRefV1Schema.safeParse(row.identification_run_ref);
    if (!riskRecordRef.success || !identificationRunRef.success) return denied();
    const riskMechanismEntryIds = identifierList(row.mechanism_entry_ids);
    const sourceSegmentIds = identifierList(row.source_segment_ids);
    if (
      riskMechanismEntryIds === undefined ||
      riskMechanismEntryIds.length === 0 ||
      sourceSegmentIds === undefined ||
      sourceSegmentIds.length === 0
    ) {
      return denied();
    }
    if (riskMechanismEntryIds.length > 64 || sourceSegmentIds.length > 256) {
      return failed(this.#blocked("record-read-reference-overflow", query.queryId));
    }
    const acceptanceDecisionRef = this.#acceptanceDecisionRef(row);
    if (acceptanceDecisionRef === undefined) return denied();

    return succeeded({
      kind: "record-read",
      riskRecordRef: riskRecordRef.data,
      record: envelope.data.record,
      riskMechanismEntryIds: [...riskMechanismEntryIds],
      sourceSegmentIds: [...sourceSegmentIds],
      compositeConfidence: envelope.data.compositeConfidence,
      acceptanceDecisionRef,
      identificationRunRef: identificationRunRef.data,
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: row.audit_entry_id, versionId: "v1" },
      },
    });
  }

  /** 验收决定引用：自动路线为路由决定，人工路线为已成立的复核决定；两者必居其一。 */
  #acceptanceDecisionRef(
    row: StandardizedRiskRecordDbRow,
  ): RouteDecisionRefV1 | ReviewDecisionRefV1 | undefined {
    if (row.route_decision_ref !== null) {
      const parsed = RouteDecisionRefV1Schema.safeParse(row.route_decision_ref);
      return parsed.success ? parsed.data : undefined;
    }
    if (row.review_decision_ref !== null) {
      const parsed = ReviewDecisionRefV1Schema.safeParse(row.review_decision_ref);
      return parsed.success ? parsed.data : undefined;
    }
    return undefined;
  }
}

export const createPostgresRiskIdentificationReadAdapter = (
  options: PostgresRiskIdentificationReadAdapterOptionsV1,
): PostgresRiskIdentificationReadAdapter => new PostgresRiskIdentificationReadAdapter(options);
