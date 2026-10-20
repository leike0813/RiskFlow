import { TextDecoder } from "node:util";
import { randomUUID } from "node:crypto";

import { sql, type Kysely, type RawBuilder, type SqlBool } from "kysely";

import { ACCESS_POLICY_REF_V1, AccessServiceError } from "@riskflow/core/access";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AcceptanceRouteSetV1Schema,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RiskCandidateSetV1Schema,
  riskRecordSourceVersionsFor,
} from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  toWaitingRef,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphRunStateV1,
} from "@riskflow/core/identification/graph";
import type { JsonValue } from "@riskflow/core/persistence";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  IdentificationCandidateSetRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  RISK_DASHBOARD_GROUP_LIMIT_V1,
  riskDashboardTimelineResumeV1,
  RiskIdentificationReadQueryV1Schema,
  RouteDecisionRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WorkflowRunRefV1Schema,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
  type AuthorizationContextRefV1,
  type IdentificationCandidateSetRefV1,
  type IdentificationRunStageV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
  type RiskDashboardProcessCountV1,
  type RiskDashboardRiskRecordsSourceRequestV1,
  type RiskDashboardRiskRecordsSourceResultV1,
  type RiskDashboardTimelineEventV1,
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
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
  type WaitingRefV1,
  type WorkflowRunStatusV1,
} from "@riskflow/contracts/ports";
import { EvidenceReferenceSchema } from "@riskflow/contracts/common";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";

import { IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1 } from "../graph/index.js";
import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import { createRegisteredResourceAuthorizerV1 } from "../../auth/deployment-authorization.js";
import type { PostgresLocalIdentityAccess } from "../../auth/postgres-local-identity-access.js";

const GRAPH_TABLE = "business.identification_graph_results";
const FINALIZATION_TABLE = "business.identification_finalization_results";
const RECORDS_TABLE = "business.standardized_risk_records";
const STAGE_CODE_V1 = "risk-identification.read";
const CAPABILITY_V1 = "risk-identification.read";

/** 仪表盘来源集合上界：与既有 256 项来源边界一致，溢出即该来源不可用（不部分披露）。 */
const DASHBOARD_SOURCE_LIMIT_V1 = 256;

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
  revisedCandidateRefs: 256,
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

/** C22 追加登记表的只读行形状：同一张表承载八类中间结果，本读接缝只消费其中两类。 */
interface FinalizationResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  artifact_ref: JsonValue;
  authorization_scope_digest: string;
  authorization_context_ref: JsonValue;
  input_snapshot_ref: JsonValue;
  work_item_ref: JsonValue | null;
  candidate_set_ref: JsonValue | null;
  persisted_at: TimestampColumn;
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
  spatial_scope_refs: JsonValue | null;
  source_version_refs: JsonValue | null;
  evidence_references: JsonValue | null;
  authorization_scope_digest: string;
  created_at: TimestampColumn;
  audit_entry_id: string;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type RiskIdentificationReadDatabaseV1 = PostgresDatabase & {
  "business.identification_graph_results": IdentificationGraphResultDbRow;
  "business.identification_finalization_results": FinalizationResultDbRow;
  "business.standardized_risk_records": StandardizedRiskRecordDbRow;
};

type ResourceAuthorization = (ref: AuthorizationContextRefV1) => Promise<AuthorizationContextV1>;

const asIso = (value: TimestampColumn): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const refKey = (reference: { readonly entityId: string; readonly versionId: string }): string =>
  `${reference.entityId}@${reference.versionId}`;

/** 标识符列表事实：含非字符串或空串即视为不可信来源（fail closed，不部分披露）。 */
const identifierList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? (value as readonly string[])
    : undefined;

/** SQL count 以 bigint 文本返回：只接受非负安全整数，越界由调用方判为来源溢出。 */
const safeCount = (value: unknown): number | undefined => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

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
      }
    | {
        readonly code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE";
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
    case "TRANSIENT_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: { entityId: "read-retry-policy", versionId: "v1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "risk-identification-read-failure", versionId: "v1" },
        },
      });
    case "TERMINAL_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: false,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "risk-identification-read-failure", versionId: "v1" },
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

/**
 * 拒权类别（design D-03）：真正的权限拒绝与 SQL／I/O 故障必须可分辨。
 * 拒权按原 AUTHORIZATION_DENIED 同形收口；技术故障保留 transient／terminal 语义，
 * 不被 catch 成拒权或不存在。
 */
class ReadDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadDeniedError";
  }
}

/** 只把真正的权限拒绝归入同形拒绝；其余故障按原技术映射传播。 */
const isDeniedError = (error: unknown): boolean =>
  error instanceof ReadDeniedError ||
  (error instanceof AccessServiceError &&
    error.details.code !== "ACCESS_TRANSIENT_FAILURE" &&
    error.details.code !== "ACCESS_TERMINAL_FAILURE");

export interface PostgresRiskIdentificationReadAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & 本模块只读行形状>`。 */
  readonly db: unknown;
  /** C04 工件存储：run-state/work-plan/acceptance-route-set 正文只经 C04 有界读取。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 当前授权复验端口：每条受保护读取在披露任何事实前按当前 actor/工程复验。 */
  readonly authorization: Pick<
    PostgresLocalIdentityAccess,
    "verify" | "readDeploymentAuthorizationSource" | "authorizeBusinessAction"
  > & {
    /**
     * 仪表盘来源可见性批验：缺失即无法判定可见集合，来源按不可用失败闭合。
     * C06 实现把分支原样交给现行策略判定，支持任意模块分支；这里按真实能力声明分支类型。
     */
    filterVisibleSources?(input: {
      readonly branch: ModuleBranchV1;
      readonly authorization: AuthorizationContextV1;
      readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    }): Promise<readonly SourceVersionRefV1[]>;
  };
  readonly now?: () => Date;
}

/**
 * C33 识别运行与风险记录只读适配器（design D3/D4，IP-03）：在 identification 所有权域内组合
 * `business.identification_graph_results` 运行登记行（+C04 正文）与
 * `business.standardized_risk_records` 既有登记行，不读其它模块私表、不新建表、不反写事实。
 * 每条查询先经 C06 `verify` 复验当前授权，再按登记资源的真实范围检查当前权限；无权、跨工程、
 * 不存在、版本不符与事实不一致统一收口为逐字相同的 AUTHORIZATION_DENIED（不提供存在性
 * oracle），输出引用集合超界收口为 BUSINESS_BLOCKED 与稳定 blockerKind，不静默截断。
 *
 * `triggerReason` 只在登记行存在触发原因事实时输出；识别运行登记行当前不存该字段，因此本
 * 适配器永不输出它（design D3：不得伪造）。
 */
export class PostgresRiskIdentificationReadAdapter implements RiskIdentificationReadPortV1 {
  readonly #db: Kysely<RiskIdentificationReadDatabaseV1>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #authorization: PostgresRiskIdentificationReadAdapterOptionsV1["authorization"];
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
    } catch (error) {
      return failed(this.#technicalError(error, valid.queryId, branch));
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
      throw new ReadDeniedError("risk-identification read authorization denied");
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
    if (
      decision.redacted ||
      decision.context.actorId !== query.actorId ||
      decision.context.projectId !== query.projectId ||
      !decision.context.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw new ReadDeniedError("risk-identification read authorization denied");
    }
    return decision.context;
  }

  #resourceAuthorization(
    query: RiskIdentificationReadQueryV1,
    verified: AuthorizationContextV1,
  ): ResourceAuthorization {
    const authorize = createRegisteredResourceAuthorizerV1(this.#authorization);
    const decisions = new Map<string, Promise<AuthorizationContextV1>>();
    return (ref) => {
      const key = refKey(ref.reference);
      let decision = decisions.get(key);
      if (decision === undefined) {
        decision = authorize({
          authorization: verified,
          resourceAuthorizationContextRef: ref,
          branch: READ_BRANCH_V1[query.kind],
          invocationId: query.queryId,
        }).then((context) => {
          if (context === undefined) throw new ReadDeniedError("registered resource unavailable");
          return context;
        });
        decisions.set(key, decision);
      }
      return decision;
    };
  }

  #recordVisibility(query: RiskIdentificationReadQueryV1, verified: AuthorizationContextV1) {
    const decisions = new Map<string, Promise<boolean>>();
    return (item: RiskRecordCatalogItemV1): Promise<boolean> => {
      const sources = SourceVersionRefV1Schema.array()
        .min(1)
        .max(64)
        .safeParse(riskRecordSourceVersionsFor(item.sourceVersionRefs, item.evidenceReferences));
      if (!sources.success) return Promise.resolve(false);
      const key = JSON.stringify([item.spatialScopeRefs, sources.data]);
      let decision = decisions.get(key);
      if (decision === undefined) {
        decision = this.#authorization
          .authorizeBusinessAction({
            projectId: query.projectId,
            actorId: query.actorId,
            capability: CAPABILITY_V1,
            branch: READ_BRANCH_V1[query.kind],
            invocationId: query.queryId,
            authorizationContextRef: verified.authorizationContextRef,
            requestedSpatialScopeRefs: item.spatialScopeRefs,
            requestedSourceVersionRefs: sources.data,
          })
          .then(
            (result) =>
              !result.redacted &&
              result.context.actorId === query.actorId &&
              result.context.projectId === query.projectId &&
              result.context.grantedCapabilities.includes(CAPABILITY_V1),
          )
          .catch((error: unknown) => {
            // 只把真正的权限拒绝当作不可见；技术故障按原映射传播，不伪装成"没有这条记录"。
            if (isDeniedError(error)) return false;
            throw error;
          });
        decisions.set(key, decision);
      }
      return decision;
    };
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
   * 本读模块的通用失败收口（design D-07/D-03）：授权不符按拒权收口，未知 DB／I/O 异常按
   * transient／terminal 映射，不 catch 成拒权——两者对调用方的含义完全不同。
   */
  #technicalError(error: unknown, causalRunId: string, branch: ModuleBranchV1): ModuleErrorV1 {
    if (isDeniedError(error)) {
      return this.#denied(causalRunId, branch);
    }
    const mapped =
      error instanceof AccessServiceError
        ? { code: error.details.code, retryable: error.details.retryable }
        : mapPostgresError(error, `${STAGE_CODE_V1}.read`);
    return readError({
      code: mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
      causalRunId,
      occurredAt: this.#now().toISOString(),
    });
  }

  /**
   * 读 C04 正文（C24 同形）：按登记行的精确 `artifactRef` 打开，`handle.completed` 保证字节与
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
    const [bytes] = await Promise.all([
      boundedContent(handle.content, MAX_BODY_BYTES_V1),
      handle.completed,
    ]);
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

  /** 指定运行的某个状态版本登记行；不存在即该版本在当前工程不可证明。 */
  async #runStateRowOfVersion(
    projectId: string,
    runId: string,
    runVersionId: string,
  ): Promise<IdentificationGraphResultRowV1 | undefined> {
    const row = await this.#db
      .selectFrom(GRAPH_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", runId)
      .where("run_version_id", "=", runVersionId)
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
    const resourceAuthorization = this.#resourceAuthorization(query, verified);

    // SQL 只扫描当前页；当前资格与状态筛选均在这份有界页上求值。
    const groups = await this.#db
      .selectFrom(GRAPH_TABLE)
      .select((eb) => [
        "run_id",
        // 头部取同一条最早 run-state 登记（design D-03）：启动者不能再用 actor_ref 的字典序
        // 最小值，否则后续由更小账号恢复时会冒充发起人。started_at 与同一行的 valid_at 一致。
        sql<string>`(array_agg(actor_ref ORDER BY valid_at ASC, persisted_at ASC, run_version_id ASC))[1]`.as(
          "started_by",
        ),
        eb.fn.min("valid_at").as("started_at"),
      ])
      .where("project_id", "=", query.projectId)
      .where("result_kind", "=", "run-state")
      .groupBy("run_id")
      .orderBy("started_at", "desc")
      .orderBy("run_id", "asc")
      .offset(cursor)
      .limit(pageSize + 1)
      .execute();

    const itemFor = async (group: {
      run_id: string;
      started_by: string;
      started_at: TimestampColumn;
    }): Promise<RiskIdentificationRunListItemV1 | undefined> => {
      const row = await this.#latestRunStateRow(query.projectId, group.run_id);
      if (row === undefined) return undefined;
      const runState = await this.#runStateOf(
        row,
        query,
        await resourceAuthorization(row.authorizationContextRef),
      );
      if (runState === undefined) return undefined;
      const plan = await this.#db
        .selectFrom(GRAPH_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("run_id", "=", group.run_id)
        .where("result_kind", "=", "work-plan")
        .where("persisted_at", "<=", this.#stateBound(row))
        .orderBy("persisted_at", "desc")
        .orderBy("result_id", "desc")
        .limit(1)
        .executeTakeFirst();
      if (plan !== undefined)
        await this.#workPlanOf(this.#graphRow(plan), query, resourceAuthorization);
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

    const items: RiskIdentificationRunListItemV1[] = [];
    for (const group of groups.slice(0, pageSize)) {
      try {
        const item = await itemFor(group);
        if (item === undefined) continue;
        if (query.payload.status !== undefined && item.status !== query.payload.status) continue;
        items.push(item);
      } catch (error) {
        // 权限拒绝只表现为本页不可见；技术故障按原映射传播，不伪装成"没有这条运行"。
        if (!isDeniedError(error)) throw error;
      }
    }
    const next = groups.length > pageSize ? encodeCursor(cursor + pageSize) : undefined;
    return succeeded({
      kind: "run-list",
      items,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  #stateBound(row: IdentificationGraphResultRowV1) {
    // 在数据库内保留微秒精度，避免 Date 的毫秒截断排除同次提交的阶段。
    return this.#db
      .selectFrom(GRAPH_TABLE)
      .select("persisted_at")
      .where("result_kind", "=", "run-state")
      .where("project_id", "=", row.projectId)
      .where("result_id", "=", row.resultId)
      .where("result_version_id", "=", row.resultVersionId);
  }

  async #workPlanOf(
    row: IdentificationGraphResultRowV1,
    query: RiskIdentificationReadQueryV1,
    resourceAuthorization: ResourceAuthorization,
  ) {
    const decoded = await this.#readBody({
      artifactRef: row.artifactRef,
      purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["work-plan"],
      projectId: query.projectId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      authorization: await resourceAuthorization(row.authorizationContextRef),
    });
    const body = IdentificationGraphArtifactBodyV1Schema.parse(decoded);
    if (
      row.resultKind !== "work-plan" ||
      body.bodyKind !== "work-plan" ||
      body.workPlan.projectId !== query.projectId ||
      refKey(body.workPlan.workPlanRef.reference) !== refKey(row.workPlanRef.reference) ||
      refKey(body.workPlan.inputSnapshotRef.reference) !== refKey(row.inputSnapshotRef.reference) ||
      (body.workPlan.inputSnapshot.identificationRunRef !== undefined &&
        body.workPlan.inputSnapshot.identificationRunRef.reference.entityId !== row.runId)
    ) {
      throw new Error("work plan binding mismatch");
    }
    return body.workPlan;
  }

  async #runRead(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "run-read" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const branch = READ_BRANCH_V1["run-read"];
    const denied = () => failed(this.#denied(query.queryId, branch));
    const resourceAuthorization = this.#resourceAuthorization(query, verified);
    const payload = query.payload;
    // 两种互斥身份（design D-03）：精确引用直接命中该状态版本；裸身份按同一口径定向取
    // 本工程该运行的最新登记状态，不扫描目录首页，也不回落到更早状态。
    const runId = "runRef" in payload ? payload.runRef.reference.entityId : payload.runId;
    const requestedVersionId = "runRef" in payload ? payload.runRef.reference.versionId : undefined;

    // 精确版本重放：只命中该 runVersionId 的 run-state 版本，不回落到"最新"。
    const stateRow =
      requestedVersionId === undefined
        ? await this.#latestRunStateRow(query.projectId, runId)
        : await this.#runStateRowOfVersion(query.projectId, runId, requestedVersionId);
    if (stateRow === undefined) return denied();
    const bound = this.#stateBound(stateRow);
    const runState = await this.#runStateOf(
      stateRow,
      query,
      await resourceAuthorization(stateRow.authorizationContextRef),
    );
    if (runState === undefined) return denied();

    // 运行头部：取同一条最早 run-state 登记（valid_at ASC, persisted_at ASC, run_version_id ASC）的
    // 启动者与启动时间，与目录列表同一口径；后续恢复不改启动者，早期精确详情也不混入其时间
    // 边界之后的登记（design D-03）。
    const headerRow = await this.#db
      .selectFrom(GRAPH_TABLE)
      .select(["actor_ref", "valid_at"])
      .where("project_id", "=", query.projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", runId)
      .where("persisted_at", "<=", bound)
      .orderBy("valid_at", "asc")
      .orderBy("persisted_at", "asc")
      .orderBy("run_version_id", "asc")
      .limit(1)
      .executeTakeFirst();
    if (headerRow === undefined) return denied();

    // 精确版本快照：只组合不晚于该 run-state 版本落库的登记事实，保证同一 runRef 重放同形。
    const runRows = await this.#db
      .selectFrom(GRAPH_TABLE)
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("run_id", "=", runId)
      .where("persisted_at", "<=", bound)
      .orderBy("persisted_at", "asc")
      .orderBy("result_id", "asc")
      .execute();

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
        authorization: await resourceAuthorization(row.authorizationContextRef),
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
    const workPlan =
      workPlanRowRaw === undefined
        ? undefined
        : await this.#workPlanOf(this.#graphRow(workPlanRowRaw), query, resourceAuthorization);
    let workItems: readonly {
      readonly workItemRef: RiskIdentificationWorkItemCoverageV1["workItemRef"];
      readonly nodeId: string;
    }[] = [];
    if (workPlan !== undefined) workItems = workPlan.workItems;
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
        .where("persisted_at", "<=", bound)
        .executeTakeFirst();
      if (routeSetRow === undefined) {
        return denied();
      }
      const decoded = await this.#readBody({
        artifactRef: routeSetRow.artifact_ref as IdentificationGraphResultRowV1["artifactRef"],
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        authorization: await resourceAuthorization(
          routeSetRow.authorization_context_ref as AuthorizationContextRefV1,
        ),
      });
      const routeSet = AcceptanceRouteSetV1Schema.safeParse(decoded);
      if (!routeSet.success) return denied();
      if (
        routeSet.data.projectId !== query.projectId ||
        routeSet.data.identificationRunRef.reference.entityId !== runId ||
        workPlan === undefined ||
        refKey(routeSet.data.workPlanRef.reference) !== refKey(workPlan.workPlanRef.reference) ||
        refKey(routeSet.data.inputSnapshotRef.reference) !==
          refKey(workPlan.inputSnapshotRef.reference)
      )
        return denied();
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

    // 已登记修正候选集引用：只取本运行工作计划下 C22 登记的 candidate-set 行，引用逐字取自行内
    // candidate_set_ref（实体 + 身份版本），不从 result_id/result_version_id 反解或重算版本。
    // 同一工作项的后续修正登记是新版本行，因此原候选集与修正候选集都在这一集合里。
    const revisedCandidateRefs = new Map<string, IdentificationCandidateSetRefV1>();
    if (workItems.length > 0) {
      const candidateRows = await this.#db
        .selectFrom(FINALIZATION_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("result_kind", "=", "candidate-set")
        .where("persisted_at", "<=", bound)
        .where(
          "work_item_ref",
          "in",
          workItems.map((item) => item.workItemRef as unknown as JsonValue),
        )
        .orderBy("persisted_at", "asc")
        .orderBy("result_id", "asc")
        .limit(RUN_READ_BOUNDS_V1.revisedCandidateRefs + 1)
        .execute();
      for (const row of candidateRows) {
        const stored = IdentificationCandidateSetRefV1Schema.safeParse(row.candidate_set_ref);
        // 登记行自称候选集引用却解析不出合法形状时不披露任何引用，交给调用方按不可信来源收口。
        if (!stored.success) return denied();
        const decoded = await this.#readBody({
          artifactRef: row.artifact_ref as IdentificationGraphResultRowV1["artifactRef"],
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
          projectId: query.projectId,
          actorId: query.actorId,
          requestedAt: query.requestedAt,
          authorization: await resourceAuthorization(
            row.authorization_context_ref as AuthorizationContextRefV1,
          ),
        });
        const body = RiskCandidateSetV1Schema.safeParse(decoded);
        const workItem = IdentificationWorkItemRefV1Schema.safeParse(row.work_item_ref);
        if (
          !body.success ||
          body.data.projectId !== query.projectId ||
          workPlan === undefined ||
          refKey(body.data.inputSnapshotRef.reference) !==
            refKey(workPlan.inputSnapshotRef.reference) ||
          !workItem.success ||
          refKey(body.data.workItemRef.reference) !== refKey(workItem.data.reference) ||
          row.result_id !== stored.data.reference.entityId ||
          row.result_version_id !== stored.data.reference.versionId
        )
          return denied();
        revisedCandidateRefs.set(refKey(stored.data.reference), stored.data);
      }
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
      runState.rejectedGroupRefs.length > RUN_READ_BOUNDS_V1.groupRefs ||
      revisedCandidateRefs.size > RUN_READ_BOUNDS_V1.revisedCandidateRefs
    ) {
      return failed(this.#blocked("run-read-reference-overflow", query.queryId));
    }

    return succeeded({
      kind: "run-read",
      runRef: {
        kind: "workflow-run",
        reference: { entityId: runId, versionId: stateRow.runVersionId },
      },
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
      ...(revisedCandidateRefs.size === 0
        ? {}
        : { revisedCandidateRefs: [...revisedCandidateRefs.values()] }),
      ...(waitingRef === undefined ? {} : { waitingRef }),
      startedBy: headerRow.actor_ref,
      startedAt: asIso(headerRow.valid_at),
    });
  }

  /**
   * 目录与仪表盘共享的 accepted 候选片段（design D-04）：同工程、正文为对象、三项登记列
   * 非空且已成立自动或人工验收。只表达登记列事实，不解析正文。
   */
  #candidateRecordPredicate(projectId: string): RawBuilder<SqlBool> {
    return sql<SqlBool>`project_id = ${projectId}
      AND jsonb_typeof(payload) = 'object'
      AND spatial_scope_refs IS NOT NULL
      AND source_version_refs IS NOT NULL
      AND evidence_references IS NOT NULL
      AND jsonb_array_length(spatial_scope_refs) > 0
      AND jsonb_array_length(source_version_refs) > 0
      AND jsonb_array_length(evidence_references) > 0
      AND (route_decision_ref IS NOT NULL OR review_decision_ref IS NOT NULL)`;
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
    // 评估启动上下文依赖记录已登记的空间范围与来源版本；缺失即没有可投影的事实，按不进入
    // 目录处理，绝不用空集合冒充「无范围」。
    const spatialScopeRefs =
      row.spatial_scope_refs === null
        ? undefined
        : SpatialScopeRefV1Schema.array().min(1).max(64).safeParse(row.spatial_scope_refs).data;
    const sourceVersionRefs =
      row.source_version_refs === null
        ? undefined
        : SourceVersionRefV1Schema.array().min(1).max(64).safeParse(row.source_version_refs).data;
    const evidenceReferences =
      row.evidence_references === null
        ? undefined
        : EvidenceReferenceSchema.array().min(1).max(256).safeParse(row.evidence_references).data;
    if (
      spatialScopeRefs === undefined ||
      sourceVersionRefs === undefined ||
      evidenceReferences === undefined
    ) {
      return undefined;
    }
    return {
      riskRecordRef: riskRecordRef.data,
      processNodeId: envelope.data.record.processNodeId,
      riskEventSummary: envelope.data.record.riskEvent,
      compositeConfidence: envelope.data.compositeConfidence,
      acceptanceKind,
      spatialScopeRefs,
      sourceVersionRefs,
      evidenceReferences,
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
    const visible = this.#recordVisibility(query, verified);
    const runFilter = query.payload.identificationRunRef;

    // 业务过滤下推为数据库谓词，当前资源权限在有界页逐项判断：验收路线、
    // 运行引用与工序节点都在 SQL 侧求值，不再「读全量可见行再在内存截断」。工序节点与
    // 标识在登记正文的 `record` 对象内，用 jsonb 路径取值即可，无需新增列或索引。
    let rows: StandardizedRiskRecordDbRow[];
    try {
      const scoped = this.#db
        .selectFrom(RECORDS_TABLE)
        .selectAll()
        // 目录与仪表盘共用同一 accepted 候选；验收方式再按请求收窄。
        .where(this.#candidateRecordPredicate(query.projectId))
        .where(
          query.payload.acceptanceKind === "automatic"
            ? sql<SqlBool>`route_decision_ref IS NOT NULL`
            : query.payload.acceptanceKind === "review"
              ? sql<SqlBool>`route_decision_ref IS NULL AND review_decision_ref IS NOT NULL`
              : // 未指定验收路线时只纳入已成立自动或人工验收的记录，与 #catalogItem 的判定一致
                sql<SqlBool>`(route_decision_ref IS NOT NULL OR review_decision_ref IS NOT NULL)`,
        );
      const withProcessNode =
        query.payload.processNodeId === undefined
          ? scoped
          : scoped.where(
              sql<SqlBool>`payload -> 'record' ->> 'processNodeId' = ${query.payload.processNodeId}`,
            );
      const withRun =
        runFilter === undefined
          ? withProcessNode
          : withProcessNode.where(sql<SqlBool>`identification_run_ref -> 'reference' ->> 'entityId' = ${runFilter.reference.entityId}
              AND identification_run_ref -> 'reference' ->> 'versionId' = ${runFilter.reference.versionId}`);
      // 多取一行判断是否还有下一页，游标语义与既有 offset 游标保持一致。
      rows = await withRun
        .orderBy("created_at", "desc")
        .orderBy("risk_record_id", "asc")
        .offset(cursor)
        .limit(pageSize + 1)
        .execute();
    } catch (error) {
      throw mapPostgresError(error, `${STAGE_CODE_V1}.record-catalog`);
    }

    const items: RiskRecordCatalogItemV1[] = [];
    for (const row of rows.slice(0, pageSize)) {
      const item = this.#catalogItem(row);
      if (item !== undefined && (await visible(item))) items.push(item);
    }
    const next = rows.length > pageSize ? encodeCursor(cursor + pageSize) : undefined;
    return succeeded({
      kind: "record-catalog",
      items,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  async #recordRead(
    query: Extract<RiskIdentificationReadQueryV1, { kind: "record-read" }>,
    verified: AuthorizationContextV1,
  ): Promise<RiskIdentificationReadResultV1> {
    const branch = READ_BRANCH_V1["record-read"];
    const denied = () => failed(this.#denied(query.queryId, branch));
    const payload = query.payload;
    // 两种互斥身份（design D-03）：精确引用按登记版本命中；裸身份按 (project_id,risk_record_id)
    // 主键取该记录唯一登记版本，不扫目录、不引入"最新风险"概念。
    const requestedRef = "riskRecordRef" in payload ? payload.riskRecordRef : undefined;
    const recordId =
      "riskRecordId" in payload ? payload.riskRecordId : payload.riskRecordRef.reference.entityId;

    let row: StandardizedRiskRecordDbRow | undefined;
    try {
      row = await this.#db
        .selectFrom(RECORDS_TABLE)
        .selectAll()
        .where("project_id", "=", query.projectId)
        .where("risk_record_id", "=", recordId)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, `${STAGE_CODE_V1}.record-read`);
    }
    // 不存在、跨工程（SQL 已按工程过滤）、版本不符与当前授权看不到范围：逐字同形，不提供 oracle。
    if (row === undefined) {
      return denied();
    }
    if (requestedRef !== undefined && row.version_id !== requestedRef.reference.versionId) {
      return denied();
    }
    const item = this.#catalogItem(row);
    if (item === undefined || !(await this.#recordVisibility(query, verified)(item)))
      return denied();
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

  /**
   * 仪表盘风险记录来源（design D-04～D-06）：与目录共享 accepted 候选，按当前授权批量判定
   * 可见来源与空间范围，在 SQL 内聚合计数并输出微秒登记变化页。
   *
   * 登记来源与证据来源共同参与批量可见性判定，与目录的全部必需来源交集一致。
   */
  async readDashboard(
    request: RiskDashboardRiskRecordsSourceRequestV1,
  ): Promise<RiskDashboardRiskRecordsSourceResultV1> {
    const branch = READ_BRANCH_V1["record-catalog"];
    const denied = (): RiskDashboardRiskRecordsSourceResultV1 => ({
      kind: "failed",
      error: this.#denied(request.queryId, branch),
    });
    try {
      if (
        request.projectId !== request.authorization.projectId ||
        request.actorId !== request.authorization.actorId ||
        !request.authorization.grantedCapabilities.includes(CAPABILITY_V1)
      ) {
        return denied();
      }
      const decision = await this.#authorization.verify({
        authorizationContextRef: request.authorization.authorizationContextRef,
        invocationId: request.queryId,
        projectId: request.projectId,
        branch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: request.requestedAt,
      });
      const verified = decision.context;
      if (
        decision.redacted ||
        verified.actorId !== request.actorId ||
        verified.projectId !== request.projectId ||
        !verified.grantedCapabilities.includes(CAPABILITY_V1)
      ) {
        return denied();
      }

      const scopeEntityIds = verified.spatialScopeRefs.map((ref) => ref.reference.entityId);
      const spatialScopeRef = request.spatialScopeRef;
      if (
        spatialScopeRef !== undefined &&
        !scopeEntityIds.includes(spatialScopeRef.reference.entityId)
      ) {
        return denied();
      }
      const visibilityReader = this.#authorization.filterVisibleSources;
      if (visibilityReader === undefined) return denied();

      // 先取候选记录的登记来源去重集合（上限+1 检出溢出），再一次性批验当前可见子集。
      const declared = await this.#db
        .selectFrom(RECORDS_TABLE)
        .select(
          sql<unknown>`jsonb_array_elements(${this.#dashboardRequiredSources()})`.as("source"),
        )
        .where(this.#candidateRecordPredicate(request.projectId))
        .where(this.#dashboardSpatialPredicate(scopeEntityIds, spatialScopeRef))
        .distinct()
        .limit(DASHBOARD_SOURCE_LIMIT_V1 + 1)
        .execute();
      if (declared.length > DASHBOARD_SOURCE_LIMIT_V1) {
        return { kind: "failed", error: this.#blocked("dashboard-source-limit", request.queryId) };
      }
      const sources: SourceVersionRefV1[] = [];
      for (const row of declared) {
        const parsed = SourceVersionRefV1Schema.safeParse(row.source);
        if (!parsed.success) return denied();
        sources.push(parsed.data);
      }
      const visibleSources = await visibilityReader.call(this.#authorization, {
        branch,
        authorization: verified,
        sourceVersionRefs: sources,
      });

      const scoped = this.#dashboardRecordQuery({
        projectId: request.projectId,
        scopeEntityIds,
        visibleSources,
        ...(spatialScopeRef === undefined ? {} : { spatialScopeRef }),
      });

      const countRow = await scoped.select(sql<string>`count(*)`.as("count")).executeTakeFirst();
      const recordedVersionCount = safeCount(countRow?.count);
      // 计数越界与分组越界同为「有界聚合无法完整表达」，沿用同一不可用类别。
      if (recordedVersionCount === undefined) {
        return { kind: "failed", error: this.#blocked("dashboard-group-limit", request.queryId) };
      }

      const processNode = sql`payload -> 'record' ->> 'processNodeId'`;
      const groupRows = await scoped
        .select([
          sql<string | null>`${processNode}`.as("process_node_id"),
          sql<string>`count(*)`.as("count"),
        ])
        .where(sql<SqlBool>`${processNode} IS NOT NULL AND ${processNode} <> ''`)
        .groupBy(processNode)
        .orderBy(processNode, "asc")
        .limit(RISK_DASHBOARD_GROUP_LIMIT_V1 + 1)
        .execute();
      if (groupRows.length > RISK_DASHBOARD_GROUP_LIMIT_V1) {
        return { kind: "failed", error: this.#blocked("dashboard-group-limit", request.queryId) };
      }
      const processCounts: RiskDashboardProcessCountV1[] = [];
      for (const row of groupRows) {
        const count = safeCount(row.count);
        if (count === undefined || row.process_node_id === null) {
          return { kind: "failed", error: this.#blocked("dashboard-group-limit", request.queryId) };
        }
        processCounts.push({ processNodeId: row.process_node_id, count });
      }

      // 变化页：登记时间按 UTC 微秒文本直接输出，不经过 JS Date 的毫秒截断。
      let eventsQuery = scoped
        .select([
          "risk_record_id",
          "version_id",
          sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            "recorded_at_text",
          ),
        ])
        .where(sql<SqlBool>`created_at <= ${request.timeline.asOf}::timestamptz`);
      const after = request.timeline.after;
      if (after !== undefined) {
        const resume = riskDashboardTimelineResumeV1("riskRecords", after);
        if (resume.kind === "before") {
          eventsQuery = eventsQuery.where(
            sql<SqlBool>`created_at < ${resume.recordedAt}::timestamptz`,
          );
        } else if (resume.kind === "at-or-before") {
          eventsQuery = eventsQuery.where(
            sql<SqlBool>`created_at <= ${resume.recordedAt}::timestamptz`,
          );
        } else {
          eventsQuery = eventsQuery.where(
            sql<SqlBool>`(created_at < ${resume.recordedAt}::timestamptz
              OR (created_at = ${resume.recordedAt}::timestamptz
                AND (risk_record_id COLLATE "C", version_id COLLATE "C") > (${resume.entityId}, ${resume.versionId})))`,
          );
        }
      }
      const eventRows = await eventsQuery
        .orderBy("created_at", "desc")
        .orderBy(sql`risk_record_id COLLATE "C"`, "asc")
        .orderBy(sql`version_id COLLATE "C"`, "asc")
        .limit(request.timeline.pageSize + 1)
        .execute();
      const events: RiskDashboardTimelineEventV1[] = eventRows.map((row) => ({
        source: "riskRecords" as const,
        changeType: "risk-record-recorded" as const,
        recordedAt: row.recorded_at_text,
        subjectRef: StandardizedRiskRecordRefV1Schema.parse({
          kind: "standardized-risk-record",
          reference: { entityId: row.risk_record_id, versionId: row.version_id },
        }),
      }));

      return {
        kind: "ready",
        asOf: this.#now().toISOString(),
        data: { recordedVersionCount, processCounts },
        events,
      };
    } catch (error) {
      // D-07：授权不符按拒权，未知 DB／I/O 异常按 transient／terminal 映射，
      // 不把技术故障 catch 成拒权或成功零值。
      return { kind: "failed", error: this.#technicalError(error, request.queryId, branch) };
    }
  }

  #dashboardRequiredSources() {
    return sql`source_version_refs || COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', 'source-version', 'reference', evidence -> 'sourceVersion'))
      FROM jsonb_array_elements(evidence_references) AS evidence
    ), '[]'::jsonb)`;
  }

  #dashboardSpatialPredicate(scopeEntityIds: readonly string[], scope?: SpatialScopeRefV1) {
    return sql<SqlBool>`NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(spatial_scope_refs) AS record_scope
      WHERE record_scope -> 'reference' ->> 'entityId' IS NULL
         OR NOT (record_scope -> 'reference' ->> 'entityId' = ANY(${scopeEntityIds}))
    ) AND ${
      scope === undefined
        ? sql`true`
        : sql`spatial_scope_refs @> jsonb_build_array(${JSON.stringify(scope)}::jsonb)`
    }`;
  }

  /** 仪表盘可见记录关系：共享候选 + 全部登记来源可见 + 全部空间范围在现行授权内。 */
  #dashboardRecordQuery(input: {
    readonly projectId: string;
    readonly scopeEntityIds: readonly string[];
    readonly visibleSources: readonly SourceVersionRefV1[];
    readonly spatialScopeRef?: SpatialScopeRefV1;
  }) {
    const query = this.#db
      .selectFrom(RECORDS_TABLE)
      .where(this.#candidateRecordPredicate(input.projectId))
      .where(
        sql<SqlBool>`NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${this.#dashboardRequiredSources()}) AS declared
          WHERE NOT ${JSON.stringify(input.visibleSources)}::jsonb @> jsonb_build_array(declared)
        )`,
      )
      .where(this.#dashboardSpatialPredicate(input.scopeEntityIds, input.spatialScopeRef));
    return query;
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
