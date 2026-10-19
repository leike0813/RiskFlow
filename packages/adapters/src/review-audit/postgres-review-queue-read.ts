import type { Kysely } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import type { JsonValue } from "@riskflow/core/persistence";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewQueueReadQueryV1Schema,
  ReviewTaskRefV1Schema,
  ReviewTypeV1Schema,
  RiskDashboardReviewsSourceRequestV1Schema,
  RiskDashboardReviewsSourceResultV1Schema,
  type AuthorizationContextV1,
  type ModuleErrorV1,
  type ReviewQueueItemV1,
  type ReviewQueueReadPortV1,
  type ReviewQueueReadQueryV1,
  type ReviewQueueReadResultV1,
  type RiskDashboardReviewsSourceRequestV1,
  type RiskDashboardReviewsSourceResultV1,
} from "@riskflow/contracts/ports";

import type { PostgresDatabase } from "../postgres/types.js";

const REVIEW_TASKS_TABLE = "business.review_tasks";
const STAGE_CODE_V1 = "review-audit.queue-read";
const CAPABILITY_V1 = "review-audit.read";
const BRANCH_V1 = "review-audit.queue-read";
const DEFAULT_PAGE_SIZE_V1 = 50;
/** 仪表盘复核分组上限：复核类型是闭合枚举，超出即为登记事实异常。 */
const DASHBOARD_REVIEW_TYPE_LIMIT_V1 = 16;

type TimestampColumn = Date | string;

interface ReviewTaskQueueDbRow {
  project_id: string;
  review_task_id: string;
  version_id: string;
  review_type: string;
  target_kind: string;
  target_entity_id: string;
  target_version_id: string;
  review_task_ref: JsonValue;
  status: "pending" | "decided" | "superseded";
  requested_at: TimestampColumn;
}

/** 局部交集扩展 Kysely 类型，不改动既有 `PostgresDatabase` 定义。 */
type ReviewQueueReadDatabaseV1 = PostgresDatabase & {
  "business.review_tasks": ReviewTaskQueueDbRow;
};

const asIso = (value: TimestampColumn): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const asTime = (value: TimestampColumn): number => new Date(value).getTime();

const decodeCursor = (cursor: string | undefined): number | "invalid" => {
  if (cursor === undefined) return 0;
  if (!/^offset-\d+$/u.test(cursor)) return "invalid";
  return Number.parseInt(cursor.slice("offset-".length), 10);
};

const encodeCursor = (offset: number): string => `offset-${offset}`;

const readError = (value: {
  readonly code: "AUTHORIZATION_DENIED" | "UNSUPPORTED_CONTRACT";
  readonly causalRunId: string;
  readonly occurredAt: string;
}): ModuleErrorV1 => {
  if (value.code === "AUTHORIZATION_DENIED") {
    return ModuleErrorV1Schema.parse({
      stageCode: STAGE_CODE_V1,
      occurredAt: value.occurredAt,
      causalRunId: value.causalRunId,
      code: value.code,
      category: "authorization",
      retryable: false,
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1[BRANCH_V1],
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    });
  }
  return ModuleErrorV1Schema.parse({
    stageCode: STAGE_CODE_V1,
    occurredAt: value.occurredAt,
    causalRunId: value.causalRunId,
    code: value.code,
    category: "technical",
    retryable: false,
    schemaVersion: "1",
  });
};

const failed = (error: ModuleErrorV1): ReviewQueueReadResultV1 => ({ kind: "failed", error });

/** 仪表盘分组超界：整来源失败，不截断后宣称完整。 */
const dashboardBlocked = (queryId: string, blockerKind: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind,
    blockerRef: { kind: "query-result", reference: { entityId: queryId, versionId: "1" } },
    stageCode: STAGE_CODE_V1,
    occurredAt: new Date().toISOString(),
    causalRunId: queryId,
  });

/** 授权不符：C06 的授权失败形状，让调用方能区分拒权与技术故障。 */
const deniedError = (): AccessServiceError =>
  new AccessServiceError({
    code: "AUTHORIZATION_DENIED",
    stage: "verify",
    occurredAt: new Date().toISOString(),
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "review-queue-dashboard-denied", versionId: "1" },
    },
    contextRefs: [],
    retryable: false,
    requiredCapability: MODULE_BRANCH_CAPABILITY_V1[BRANCH_V1],
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
  });

/**
 * 仪表盘来源的技术故障：按 transient 收口，不折算成权限拒绝（design D-07）。
 * 拒权与技术失败对调用方的含义不同：前者不可重试，后者可重试。
 */
const dashboardFailed = (queryId: string, occurredAt: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "TRANSIENT_FAILURE",
    category: "technical",
    retryable: true,
    attempt: 1,
    retryPolicyRef: { entityId: "read-retry-policy", versionId: "v1" },
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "review-queue-dashboard-failure", versionId: "1" },
    },
    stageCode: STAGE_CODE_V1,
    occurredAt,
    causalRunId: queryId,
  });

/**
 * 指向其它工程、其它操作者或未持复核读能力的请求先按授权失败收口，伪造请求无法探出差异
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

export interface PostgresReviewQueueReadAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & 本模块只读行形状>`。 */
  readonly db: unknown;
  /** C05 当前授权复验端口：每条受保护读取在披露任何事实前按当前 actor/工程复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly now?: () => Date;
}

/**
 * C33 复核队列只读适配器（design D3，IP-04）：在 review-audit 所有权域内组合既有
 * `business.review_tasks` 登记行，不读其它模块私表、不新建表、不反写任务状态。
 * 每条查询先经 C05 `verify` 复验当前授权；无权、跨工程、游标非法统一收口为逐字相同的
 * AUTHORIZATION_DENIED（不提供存在性 oracle）。
 *
 * `stale` 由拥有方计算：任务已被取代（`superseded`），或同复核类型同目标实体存在更新
 * 目标版本的更晚任务。`triggerReason` 只在登记行存在触发原因事实时输出；复核任务登记行
 * 当前不存该字段，因此本适配器永不输出它（design D3：不得伪造）。
 */
export class PostgresReviewQueueReadAdapter implements ReviewQueueReadPortV1 {
  readonly #db: Kysely<ReviewQueueReadDatabaseV1>;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #now: () => Date;

  constructor(options: PostgresReviewQueueReadAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<ReviewQueueReadDatabaseV1>;
    this.#authorization = options.authorization;
    this.#now = options.now ?? (() => new Date());
  }

  async read(query: ReviewQueueReadQueryV1): Promise<ReviewQueueReadResultV1> {
    const parsed = ReviewQueueReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      const queryId =
        typeof (query as { queryId?: unknown } | null)?.queryId === "string"
          ? (query as { queryId: string }).queryId
          : STAGE_CODE_V1;
      const occurredAt = this.#now().toISOString();
      if (readRequestDenied(query)) {
        return failed(
          readError({ code: "AUTHORIZATION_DENIED", causalRunId: queryId, occurredAt }),
        );
      }
      return failed(readError({ code: "UNSUPPORTED_CONTRACT", causalRunId: queryId, occurredAt }));
    }
    const valid = parsed.data;
    try {
      await this.#verify(valid);
      return await this.#queueRead(valid);
    } catch {
      return failed(
        readError({
          code: "AUTHORIZATION_DENIED",
          causalRunId: valid.queryId,
          occurredAt: this.#now().toISOString(),
        }),
      );
    }
  }

  /** 当前授权复验（C32 目录读同形）：冻结上下文不替代当前收窄上下文；任何不符按拒绝收口。 */
  async #verify(query: ReviewQueueReadQueryV1): Promise<AuthorizationContextV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(CAPABILITY_V1)
    ) {
      throw new Error("review queue read authorization denied");
    }
    const decision = await this.#authorization.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch: BRANCH_V1,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: query.authorization.decidedAt,
    });
    if (decision.context.actorId !== query.actorId) {
      throw new Error("review queue read authorization denied");
    }
    return decision.context;
  }

  /**
   * CH-3 仪表盘复核摘要（design D-04、D-05）。
   *
   * 复核摘要是工程级口径：不受总览空间筛选影响，只统计当前工程仍为 pending 的复核任务，
   * 并按复核类型分组。stale pending 仍计入——过期只表示目标版本已被取代，不等于已决定。
   * 这里不复用 #queueRead 的全量加载与 stale 双循环：SQL 直接按工程与状态分组计数。
   */
  async readDashboard(
    request: RiskDashboardReviewsSourceRequestV1,
  ): Promise<RiskDashboardReviewsSourceResultV1> {
    const parsed = RiskDashboardReviewsSourceRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: readError({
          code: "AUTHORIZATION_DENIED",
          causalRunId: request.queryId,
          occurredAt: this.#now().toISOString(),
        }),
      };
    }
    const valid = parsed.data;
    try {
      // 复核摘要是工程级口径：只按当前授权复验，不按空间筛选。
      await this.#verifyDashboard(valid);
      const rows = await this.#db
        .selectFrom(REVIEW_TASKS_TABLE)
        .select(["review_type"])
        .where("project_id", "=", valid.projectId)
        .where("status", "=", "pending")
        .execute();
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.review_type, (counts.get(row.review_type) ?? 0) + 1);
      }
      if (counts.size > DASHBOARD_REVIEW_TYPE_LIMIT_V1) {
        return {
          kind: "failed",
          error: dashboardBlocked(valid.queryId, "dashboard-group-limit"),
        };
      }
      const reviewTypeCounts = [...counts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([reviewType, count]) => {
          const parsedType = ReviewTypeV1Schema.safeParse(reviewType);
          if (!parsedType.success) {
            throw new Error("review task type is not a known review type");
          }
          return { reviewType: parsedType.data, count };
        });
      return RiskDashboardReviewsSourceResultV1Schema.parse({
        kind: "ready",
        asOf: this.#now().toISOString(),
        data: {
          pendingCount: rows.length,
          reviewTypeCounts,
        },
      });
    } catch (error) {
      // 授权不符按拒权；未知 DB／I/O 异常按 transient 收口，不折算成权限拒绝。
      if (error instanceof AccessServiceError) {
        return {
          kind: "failed",
          error: readError({
            code: "AUTHORIZATION_DENIED",
            causalRunId: valid.queryId,
            occurredAt: this.#now().toISOString(),
          }),
        };
      }
      return {
        kind: "failed",
        error: dashboardFailed(valid.queryId, this.#now().toISOString()),
      };
    }
  }

  /** 当前授权复验：按复核队列分支重新判定当前权限。 */
  async #verifyDashboard(
    request: RiskDashboardReviewsSourceRequestV1,
  ): Promise<AuthorizationContextV1> {
    if (
      request.projectId !== request.authorization.projectId ||
      request.actorId !== request.authorization.actorId ||
      !request.authorization.grantedCapabilities.includes(CAPABILITY_V1)
    ) {
      throw deniedError();
    }
    const decision = await this.#authorization.verify({
      authorizationContextRef: request.authorization.authorizationContextRef,
      invocationId: request.queryId,
      projectId: request.projectId,
      branch: BRANCH_V1,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: request.authorization.decidedAt,
    });
    if (
      decision.context.actorId !== request.actorId ||
      !decision.context.grantedCapabilities.includes(CAPABILITY_V1)
    ) {
      throw deniedError();
    }
    return decision.context;
  }

  async #queueRead(query: ReviewQueueReadQueryV1): Promise<ReviewQueueReadResultV1> {
    const cursor = decodeCursor(query.payload.cursor);
    if (cursor === "invalid") throw new Error("review queue read cursor is not provable");
    const pageSize = query.payload.pageSize ?? DEFAULT_PAGE_SIZE_V1;

    const rows = await this.#db
      .selectFrom(REVIEW_TASKS_TABLE)
      .selectAll()
      .where("project_id", "=", query.projectId)
      .orderBy("requested_at", "asc")
      .orderBy("review_task_id", "asc")
      .execute();

    // 过期判定按全工程行计算（含筛选外任务）：目标版本是否被取代与调用方的筛选条件无关。
    const newerTargetVersionExists = new Set<string>();
    for (const row of rows) {
      for (const other of rows) {
        if (
          other.review_type === row.review_type &&
          other.target_kind === row.target_kind &&
          other.target_entity_id === row.target_entity_id &&
          other.target_version_id !== row.target_version_id &&
          asTime(other.requested_at) > asTime(row.requested_at)
        ) {
          newerTargetVersionExists.add(row.review_task_id);
          break;
        }
      }
    }

    const items: ReviewQueueItemV1[] = [];
    for (const row of rows) {
      if (query.payload.reviewType !== undefined && row.review_type !== query.payload.reviewType) {
        continue;
      }
      if (query.payload.status !== undefined && row.status !== query.payload.status) continue;
      // 登记行由本模块写路径经 ReviewTaskRefV1Schema 构造；不可解析的行不进入队列（不伪造引用）。
      const reviewTaskRef = ReviewTaskRefV1Schema.safeParse(row.review_task_ref);
      if (!reviewTaskRef.success) continue;
      items.push({
        reviewTaskRef: reviewTaskRef.data,
        reviewType: reviewTaskRef.data.reviewType,
        submittedAt: asIso(row.requested_at),
        status: row.status,
        stale: row.status === "superseded" || newerTargetVersionExists.has(row.review_task_id),
      });
    }

    const page = items.slice(cursor, cursor + pageSize);
    const next = cursor + pageSize < items.length ? encodeCursor(cursor + pageSize) : undefined;
    return {
      kind: "succeeded",
      result: {
        kind: "queue-read",
        items: page,
        ...(next === undefined ? {} : { nextCursor: next }),
      },
    };
  }
}

export const createPostgresReviewQueueReadAdapter = (
  options: PostgresReviewQueueReadAdapterOptionsV1,
): PostgresReviewQueueReadAdapter => new PostgresReviewQueueReadAdapter(options);
