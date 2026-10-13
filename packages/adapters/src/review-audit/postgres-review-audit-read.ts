import { isDeepStrictEqual } from "node:util";

import { sql, type Kysely } from "kysely";

import { ACCESS_POLICY_REF_V1, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import { sha256CanonicalJson, type JsonValue } from "@riskflow/core/persistence";
import {
  ReviewActivityEntryV1Schema,
  REVIEW_UI_READ_PAGE_SIZE_DEFAULT_V1,
  ReviewAuditReadQueryV1Schema,
  ReviewTaskDetailV1Schema,
  ReviewTaskStateV1Schema,
  type ReviewActivityEntryV1,
  type ReviewAuditReadPortV1,
  type ReviewAuditReadQueryV1,
  type ReviewAuditReadResultV1,
  type ReviewTaskDetailV1,
  type ReviewTaskStateV1,
} from "@riskflow/core/review-audit";
import {
  ContractReferenceV1Schema,
  AuthorizationContextV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewDecisionV1Schema,
  ReviewTargetRefV1Schema,
  ReviewTaskRefV1Schema,
  WorkflowRunRefV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ModuleErrorV1,
  type ReviewTaskRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import type { PostgresDatabase } from "../postgres/types.js";

const REVIEW_TASKS_TABLE = "business.review_tasks";
const REVIEW_DECISIONS_TABLE = "business.review_decisions";
const ACTIVITY_VIEW_TABLE = "audit.review_activity_v1";
const AUDIT_ENTRIES_TABLE = "audit.entries";
const STAGE_CODE_V1 = "review-audit.ui-read";
const BRANCH_V1 = "review-audit.read";
const CAPABILITY_V1 = "review-audit.read";
const DECIDE_BRANCH_V1 = "review-audit.decide-review";

/** C07 复核动作只经这一条分支提交；读面不发明第二个决定分支。 */
type DecideBranch = typeof DECIDE_BRANCH_V1;

type JsonColumn = JsonValue;
type ReadTimestamp = Date | string;

interface ReviewTaskDetailRow {
  review_task_id: string;
  version_id: string;
  project_id: string;
  review_type: string;
  target_kind: string;
  target_entity_id: string;
  target_version_id: string;
  target_ref: JsonColumn;
  waiting_run_ref: JsonColumn;
  waiting_run_entity_id: string;
  waiting_run_version_id: string;
  review_task_ref: JsonColumn;
  validation_snapshot_ref: JsonColumn;
  evidence_snapshot_ref: JsonColumn;
  review_policy_ref: JsonColumn;
  status: string;
  decision_ref: JsonColumn | null;
  requested_by: string;
  requested_authorization_context_ref: JsonColumn;
  requested_at: ReadTimestamp;
  recorded_at: ReadTimestamp;
  persisted_at: ReadTimestamp;
  decided_at: ReadTimestamp | null;
  superseded_at: ReadTimestamp | null;
  superseded_by_command_id: string | null;
  superseded_by_actor: string | null;
}

interface ReviewDecisionDetailRow {
  review_decision_id: string;
  review_task_id: string;
  project_id: string;
  review_decision_ref: JsonColumn;
  decision: JsonColumn;
  reason_code: string;
  actor_ref: string;
  decided_at: ReadTimestamp;
}

interface ActivityViewRow {
  activity_id: string;
  project_id: string;
  source_type: string;
  activity_code: string | null;
  subject_ref: JsonColumn;
  actor_ref: string | null;
  command_id: string | null;
  review_task_ref: JsonColumn | null;
  target_ref: JsonColumn | null;
  review_decision_ref: JsonColumn | null;
  waiting_run_ref: JsonColumn | null;
  result_code: string | null;
  reason_code: string | null;
  occurred_at: ReadTimestamp;
  recorded_at: ReadTimestamp;
  persisted_at: ReadTimestamp;
}

interface AuditEntryRow {
  audit_entry_id: string;
  project_id: string;
  action: string;
  target_ref: JsonColumn;
  actor_ref: string;
  command_id: string;
  occurred_at: ReadTimestamp;
  recorded_at: ReadTimestamp;
  persisted_at: ReadTimestamp;
}

/** 局部交集扩展 Kysely 类型，不改动既有 `PostgresDatabase` 定义。 */
type ReviewAuditReadDatabaseV1 = PostgresDatabase & {
  "business.review_tasks": ReviewTaskDetailRow;
  "business.review_decisions": ReviewDecisionDetailRow;
  "audit.review_activity_v1": ActivityViewRow;
};

const asIso = (value: ReadTimestamp): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** 读面永不闭合；任何定位、解析或绑定失败都收敛为这一种失败。 */
class ReviewAuditReadClosed extends Error {}

const closed = (stage: string): ReviewAuditReadClosed =>
  new ReviewAuditReadClosed(`review audit read closed: ${stage}`);

const refEquals = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

/** 契约引用里事件引用用 `eventId/eventVersion`，取键时与原 C07 trace 读取一致归一。 */
const referenceKey = (reference: ContractReferenceV1): VersionReference =>
  "reference" in reference
    ? reference.reference
    : { entityId: reference.eventId, versionId: String(reference.eventVersion) };

/** 任务引用是判别联合：整体比对，任何漂移都不进入详情。 */
const taskRefEquals = (left: ReviewTaskRefV1, right: ReviewTaskRefV1): boolean =>
  left.reviewType === right.reviewType &&
  refEquals(left, right) &&
  refEquals(left.waitingRunRef, right.waitingRunRef) &&
  left.targetRef.kind === right.targetRef.kind &&
  refEquals(left.targetRef, right.targetRef);

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

const failed = (error: ModuleErrorV1): ReviewAuditReadResultV1 => ({ kind: "failed", error });

/**
 * 请求看起来被拒时按授权失败收口，其余未知输入按稳定的契约失败收口：
 * 解析失败不得先触达存储，也不能被用来区分任务是否存在。
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
 * 活动游标是不透明绑定令牌：固定排序键 `(recordedAt, sourceType, activityId)` 与
 * 工程、actor、当前授权判定、筛选条件、固定记录时点和精确主题的联合摘要。
 * 摘要另覆盖排序键本身，因此改写排序键无法把窗口挪到别处；未知字段、伪造或摘要
 * 不匹配一律失败关闭，游标不能跨工程、跨筛选或换时点复用。
 */
interface ActivityCursorBinding {
  readonly v: "1";
  readonly binding: string;
  readonly asOfRecordedAt: string;
  readonly keyA: string;
  readonly keyB: string;
  readonly keyC: string;
}

const ACTIVITY_CURSOR_FIELDS_V1 = [
  "v",
  "binding",
  "keyDigest",
  "asOfRecordedAt",
  "keyA",
  "keyB",
  "keyC",
] as const;

/** 排序键自身的摘要：位置不可被改写，只能由本适配器签发。 */
const activityKeyDigest = (binding: ActivityCursorBinding): string =>
  sha256CanonicalJson({
    binding: binding.binding,
    asOfRecordedAt: binding.asOfRecordedAt,
    keyA: binding.keyA,
    keyB: binding.keyB,
    keyC: binding.keyC,
  });

/** 解码后的游标：请求绑定 + 排序键 + 排序键摘要。 */
type DecodedActivityCursor = ActivityCursorBinding & { readonly keyDigest: string };

const encodeActivityCursor = (binding: ActivityCursorBinding): string =>
  Buffer.from(
    JSON.stringify({ ...binding, keyDigest: activityKeyDigest(binding) }),
    "utf8",
  ).toString("base64url");

/** 严格字段与类型校验：未知字段、缺字段或被改写的游标一律失败关闭。 */
const decodeActivityCursor = (cursor: string): DecodedActivityCursor => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw closed("cursor-decode");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw closed("cursor-shape");
  const record = parsed as Record<string, unknown>;
  if (record.v !== "1") throw closed("cursor-version");
  if (
    !Object.keys(record).every((field) =>
      (ACTIVITY_CURSOR_FIELDS_V1 as readonly string[]).includes(field),
    ) ||
    !ACTIVITY_CURSOR_FIELDS_V1.every((field) => typeof record[field] === "string")
  ) {
    throw closed("cursor-shape");
  }
  return {
    v: "1",
    binding: record.binding as string,
    keyDigest: record.keyDigest as string,
    asOfRecordedAt: record.asOfRecordedAt as string,
    keyA: record.keyA as string,
    keyB: record.keyB as string,
    keyC: record.keyC as string,
  };
};

export interface PostgresReviewAuditReadOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & 本模块只读行形状>`。 */
  readonly db: unknown;
  /** C05 当前授权复验端口：披露任何事实之前按当前 actor/工程复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly now?: () => Date;
}

/**
 * C35 复核详情与活动只读适配器（design D-06/D-07）。
 *
 * 任务详情按实体 + 身份版本精确定位当前工程内的任务，不使用队列索引也不回落到最新版本；
 * 返回原 `ReviewTaskStateV1` 的一次安全 pick（剔除 `requestedAuthorizationContextRef`）、
 * 原五类决定联合与只报告业务状态的动作可用性。已决定与被替代任务只读。
 *
 * 活动读复用既有 `audit.review_activity_v1` view 与 `audit.entries`，不新增视图或迁移：
 * view 承载复核请求/决定、被替代、安全授权与复核拒绝事实，`audit.entries` 只补齐
 * view 未覆盖的其它业务动作（闭合码 `business.recorded` + 原已登记 `actionCode`），
 * 因此同一条复核请求/决定只来自 view 一个来源，不会重复出现。
 *
 * 两条来源各自 `LIMIT pageSize+1` 后按固定排序有界归并；游标固定本轮记录时点，
 * 后续新增活动不会污染本次历史分页。任何越界、错配或无法安全披露的事实都失败关闭。
 */
export class PostgresReviewAuditRead implements ReviewAuditReadPortV1 {
  readonly #db: Kysely<ReviewAuditReadDatabaseV1>;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #now: () => Date;

  constructor(options: PostgresReviewAuditReadOptionsV1) {
    this.#db = options.db as unknown as Kysely<ReviewAuditReadDatabaseV1>;
    this.#authorization = options.authorization;
    this.#now = options.now ?? (() => new Date());
  }

  async verifyCheckpointReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly taskRef: ReviewTaskRefV1;
    readonly parentRunRef: WorkflowRunRefV1;
  }): Promise<boolean> {
    const authorization = AuthorizationContextV1Schema.parse(input.authorization);
    const taskRef = ReviewTaskRefV1Schema.parse(input.taskRef);
    const parentRunRef = WorkflowRunRefV1Schema.parse(input.parentRunRef);
    if (
      authorization.projectId !== input.projectId ||
      authorization.actorId !== input.actorId ||
      authorization.grantedCapabilities.length !== 1 ||
      authorization.grantedCapabilities[0] !== CAPABILITY_V1 ||
      !refEquals(taskRef.waitingRunRef, parentRunRef)
    )
      return false;
    const decision = await this.#authorization.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId: input.invocationId,
      projectId: input.projectId,
      branch: BRANCH_V1,
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
      requestedAt: input.requestedAt,
    });
    if (decision.redacted || !isDeepStrictEqual(decision.context, authorization)) return false;
    const { state } = await this.#taskState(input.projectId, taskRef);
    return state.requestedBy === input.actorId;
  }

  async read(query: ReviewAuditReadQueryV1): Promise<ReviewAuditReadResultV1> {
    const parsed = ReviewAuditReadQueryV1Schema.safeParse(query);
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
      switch (valid.kind) {
        case "task-detail":
          return { kind: "succeeded", result: await this.#taskDetail(valid) };
        case "activities":
          return { kind: "succeeded", result: await this.#activities(valid) };
      }
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

  /** 当前授权复验：冻结上下文不替代当前收窄上下文；任何不符按拒绝收口。 */
  async #verify(query: ReviewAuditReadQueryV1): Promise<AuthorizationContextV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(CAPABILITY_V1)
    ) {
      throw closed("authorization-context");
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
    if (decision.redacted || decision.context.actorId !== query.actorId) {
      throw closed("authorization-decision");
    }
    return decision.context;
  }

  /**
   * 精确任务详情：实体 + 身份版本 + 工程三重定位后只做安全 pick。
   * 定位不到、事实错配与无权同形失败，不提供存在性 oracle。
   */
  async #taskDetail(
    query: Extract<ReviewAuditReadQueryV1, { readonly kind: "task-detail" }>,
  ): Promise<ReviewTaskDetailV1> {
    const { state, row } = await this.#taskState(query.projectId, query.payload.reviewTaskRef);
    const decision =
      state.status === "decided" ? await this.#taskDecision(query.projectId, row) : undefined;

    return ReviewTaskDetailV1Schema.parse({
      kind: "task-detail",
      reviewTaskRef: state.reviewTaskRef,
      projectId: state.projectId,
      reviewType: state.reviewTaskRef.reviewType,
      status: state.status,
      targetRef: state.reviewTaskRef.targetRef,
      validationSnapshotRef: state.validationSnapshotRef,
      evidenceSnapshotRef: state.evidenceSnapshotRef,
      reviewPolicyRef: state.reviewPolicyRef,
      waitingRunRef: state.reviewTaskRef.waitingRunRef,
      requestedBy: state.requestedBy,
      requestedAt: state.requestedAt,
      ...(state.decidedAt === undefined ? {} : { decidedAt: state.decidedAt }),
      ...(state.supersededAt === undefined ? {} : { supersededAt: state.supersededAt }),
      ...(decision === undefined ? {} : { decision }),
      actions: this.#taskActions(state.status),
    });
  }

  async #taskState(
    projectId: string,
    requested: ReviewTaskRefV1,
  ): Promise<{ readonly row: ReviewTaskDetailRow; readonly state: ReviewTaskStateV1 }> {
    const row = await this.#db
      .selectFrom(REVIEW_TASKS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("review_task_id", "=", requested.reference.entityId)
      .where("version_id", "=", requested.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) throw closed("task-detail-not-found");

    const storedRef = ReviewTaskRefV1Schema.safeParse(row.review_task_ref);
    const storedTarget = ReviewTargetRefV1Schema.safeParse(row.target_ref);
    const storedWaitingRun = WorkflowRunRefV1Schema.safeParse(row.waiting_run_ref);
    if (!storedRef.success || !storedTarget.success || !storedWaitingRun.success) {
      throw closed("task-detail-fact-mismatch");
    }
    if (
      !taskRefEquals(storedRef.data, requested) ||
      storedRef.data.reference.entityId !== row.review_task_id ||
      storedRef.data.reference.versionId !== row.version_id ||
      storedRef.data.reviewType !== row.review_type ||
      storedRef.data.targetRef.kind !== row.target_kind ||
      !isDeepStrictEqual(storedRef.data.targetRef, storedTarget.data) ||
      storedTarget.data.reference.entityId !== row.target_entity_id ||
      storedTarget.data.reference.versionId !== row.target_version_id ||
      !refEquals(storedRef.data.waitingRunRef, storedWaitingRun.data) ||
      storedWaitingRun.data.reference.entityId !== row.waiting_run_entity_id ||
      storedWaitingRun.data.reference.versionId !== row.waiting_run_version_id
    ) {
      throw closed("task-detail-fact-mismatch");
    }

    // 复用原状态 Schema：完整任务事实在同一处校验，再安全 pick 出读面允许的字段。
    const state = ReviewTaskStateV1Schema.parse({
      reviewTaskRef: storedRef.data,
      projectId: row.project_id,
      validationSnapshotRef: row.validation_snapshot_ref,
      evidenceSnapshotRef: row.evidence_snapshot_ref,
      reviewPolicyRef: row.review_policy_ref,
      status: row.status,
      ...(row.decision_ref === null ? {} : { decisionRef: row.decision_ref }),
      requestedBy: row.requested_by,
      requestedAuthorizationContextRef: row.requested_authorization_context_ref,
      requestedAt: asIso(row.requested_at),
      recordedAt: asIso(row.recorded_at),
      persistedAt: asIso(row.persisted_at),
      ...(row.decided_at === null ? {} : { decidedAt: asIso(row.decided_at) }),
      ...(row.superseded_at === null ? {} : { supersededAt: asIso(row.superseded_at) }),
      ...(row.superseded_by_command_id === null
        ? {}
        : { supersededByCommandId: row.superseded_by_command_id }),
      ...(row.superseded_by_actor === null ? {} : { supersededByActor: row.superseded_by_actor }),
    });
    if (state.projectId !== projectId) throw closed("task-detail-scope");
    return { row, state };
  }

  /** 原决定原样返回：五类联合不归并、不新增第六类，判定权仍在 C07 事务。 */
  async #taskDecision(
    projectId: string,
    task: ReviewTaskDetailRow,
  ): Promise<NonNullable<ReviewTaskDetailV1["decision"]>> {
    const row = await this.#db
      .selectFrom(REVIEW_DECISIONS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("review_task_id", "=", task.review_task_id)
      .executeTakeFirst();
    if (row === undefined) throw closed("task-detail-decision-missing");
    const reviewDecisionRef = ReviewDecisionRefV1Schema.safeParse(row.review_decision_ref);
    if (!reviewDecisionRef.success || task.decision_ref === null) {
      throw closed("task-detail-decision-mismatch");
    }
    const storedDecisionRef = ReviewDecisionRefV1Schema.safeParse(task.decision_ref);
    if (!storedDecisionRef.success || !refEquals(storedDecisionRef.data, reviewDecisionRef.data)) {
      throw closed("task-detail-decision-mismatch");
    }
    const decision = ReviewDecisionV1Schema.safeParse(row.decision);
    if (!decision.success || decision.data.reviewType !== task.review_type) {
      throw closed("task-detail-decision-mismatch");
    }
    return {
      reviewDecisionRef: reviewDecisionRef.data,
      decision: decision.data,
      reasonCode: row.reason_code,
      actorRef: row.actor_ref,
      decidedAt: asIso(row.decided_at),
    };
  }

  /**
   * 动作可用性只反映业务状态：终态任务无法再决定。
   * 授权层面的允许/拒绝不在读面推断——`review-audit.read` 不等于写权，
   * 未被业务状态阻断的分支不进入清单，因此不存在"全部允许"的列表。
   */
  #taskActions(
    status: string,
  ): { branch: DecideBranch; availability: "business-unavailable"; reasonCode: string }[] {
    if (status === "decided")
      return [
        {
          branch: DECIDE_BRANCH_V1,
          availability: "business-unavailable",
          reasonCode: "TASK_ALREADY_DECIDED",
        },
      ];
    if (status === "superseded")
      return [
        {
          branch: DECIDE_BRANCH_V1,
          availability: "business-unavailable",
          reasonCode: "TASK_SUPERSEDED",
        },
      ];
    return [];
  }

  /**
   * 多源有界活动：view + `audit.entries` 未覆盖的业务动作，按固定排序归并。
   * 每来源先取 `pageSize+1`，因此单次读取的行数始终有界。
   */
  async #activities(
    query: Extract<ReviewAuditReadQueryV1, { readonly kind: "activities" }>,
  ): Promise<Extract<ReviewAuditReadResultV1, { kind: "succeeded" }>["result"]> {
    const payload = query.payload;
    const pageSize = payload.pageSize ?? REVIEW_UI_READ_PAGE_SIZE_DEFAULT_V1;
    const requestedAsOf = payload.asOfRecordedAt ?? query.requestedAt;
    const cursor = payload.cursor === undefined ? undefined : decodeActivityCursor(payload.cursor);
    // 排序键摘要不匹配即位置被改写：失败关闭而不是从被挪动的窗口继续。
    if (cursor !== undefined && cursor.keyDigest !== activityKeyDigest(cursor)) {
      throw closed("cursor-keys");
    }
    if (cursor !== undefined && cursor.asOfRecordedAt !== requestedAsOf) {
      throw closed("cursor-as-of");
    }
    const asOfRecordedAt = cursor?.asOfRecordedAt ?? requestedAsOf;

    const binding = sha256CanonicalJson({
      projectId: query.projectId,
      actorId: query.actorId,
      // 只摘要"授权判定"本身：能力、空间范围、来源授权与策略版本。
      // 刻意不含 invocation 与 authorizationContextRef——它们按每次调用重新签发，
      // 纳入摘要会让同一读者在同一轮翻页里必然错配。
      grantedCapabilities: query.authorization.grantedCapabilities,
      spatialScopeRefs: query.authorization.spatialScopeRefs,
      sourceAccessGrantRefs: query.authorization.sourceAccessGrantRefs,
      authorizationPolicyRef: query.authorization.authorizationPolicyRef,
      subject: payload.subjectRef ?? null,
      filters: {
        sourceType: payload.sourceType ?? null,
        resultCode: payload.resultCode ?? null,
      },
      pageSize,
      asOfRecordedAt,
    });
    if (cursor !== undefined && cursor.binding !== binding) throw closed("cursor-binding");

    const fromView = await this.#viewActivities(query, cursor, pageSize, asOfRecordedAt);
    const fromAuditEntries = await this.#auditEntryActivities(query, pageSize, asOfRecordedAt);
    const merged = [...fromView, ...fromAuditEntries]
      .sort((left, right) => compareActivityOrder(left, right))
      .slice(0, pageSize + 1);
    const page = merged.slice(0, pageSize);
    const last = page.at(-1);

    return {
      kind: "activities",
      items: page,
      asOfRecordedAt,
      ...(merged.length > pageSize && last !== undefined
        ? {
            nextCursor: encodeActivityCursor({
              v: "1",
              binding,
              asOfRecordedAt,
              keyA: last.recordedAt,
              keyB: last.sourceType,
              keyC: last.activityId,
            }),
          }
        : {}),
    };
  }

  async #viewActivities(
    query: Extract<ReviewAuditReadQueryV1, { readonly kind: "activities" }>,
    cursor: ActivityCursorBinding | undefined,
    pageSize: number,
    asOfRecordedAt: string,
  ): Promise<ReviewActivityEntryV1[]> {
    const payload = query.payload;
    // view 自带来源类型与结果码列：筛选直接落到列上，无结果码的来源自然不匹配。
    let builder = this.#db
      .selectFrom(ACTIVITY_VIEW_TABLE)
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("recorded_at", "<=", new Date(asOfRecordedAt));
    if (payload.sourceType !== undefined)
      builder = builder.where("source_type", "=", payload.sourceType);
    if (payload.resultCode !== undefined)
      builder = builder.where("result_code", "=", payload.resultCode);
    const subject = payload.subjectRef;
    if (subject !== undefined) {
      const reference = referenceKey(subject);
      builder = builder.where(sql<boolean>`
        (
          (subject_kind = ${subject.kind}
            AND subject_entity_id = ${reference.entityId}
            AND subject_version_id = ${reference.versionId})
          OR (review_task_ref -> 'reference' ->> 'entityId' = ${reference.entityId}
            AND review_task_ref -> 'reference' ->> 'versionId' = ${reference.versionId})
          OR (target_ref ->> 'kind' = ${subject.kind}
            AND target_ref -> 'reference' ->> 'entityId' = ${reference.entityId}
            AND target_ref -> 'reference' ->> 'versionId' = ${reference.versionId})
          OR (review_decision_ref ->> 'kind' = ${subject.kind}
            AND review_decision_ref -> 'reference' ->> 'entityId' = ${reference.entityId}
            AND review_decision_ref -> 'reference' ->> 'versionId' = ${reference.versionId})
          OR (waiting_run_ref ->> 'kind' = ${subject.kind}
            AND waiting_run_ref -> 'reference' ->> 'entityId' = ${reference.entityId}
            AND waiting_run_ref -> 'reference' ->> 'versionId' = ${reference.versionId})
        )
      `);
    }
    if (cursor !== undefined)
      builder = builder.where((expression) =>
        expression.or([
          expression("recorded_at", "<", new Date(cursor.keyA)),
          expression.and([
            expression("recorded_at", "=", new Date(cursor.keyA)),
            expression("source_type", "<", cursor.keyB),
          ]),
          expression.and([
            expression("recorded_at", "=", new Date(cursor.keyA)),
            expression("source_type", "=", cursor.keyB),
            expression("activity_id", "<", cursor.keyC),
          ]),
        ]),
      );
    const rows = await builder
      .orderBy("recorded_at", "desc")
      .orderBy("source_type", "desc")
      .orderBy("activity_id", "desc")
      .limit(pageSize + 1)
      .execute();
    return rows.map((row) => entryFromViewRow(row));
  }

  /**
   * C03 `audit.entries` 只补齐 view 未覆盖的其它业务动作：以闭合码 `business.recorded`
   * 呈现并携带原已登记 `actionCode`。复核请求/决定不在此来源出现，避免与 view 重复。
   */
  async #auditEntryActivities(
    query: Extract<ReviewAuditReadQueryV1, { readonly kind: "activities" }>,
    pageSize: number,
    asOfRecordedAt: string,
  ): Promise<ReviewActivityEntryV1[]> {
    const payload = query.payload;
    // 该来源只呈现 `business-audit`，且不带结果码：指定其它来源或结果码时不参与本次读取。
    if (payload.sourceType !== undefined && payload.sourceType !== "business-audit") return [];
    if (payload.resultCode !== undefined) return [];
    let builder = this.#db
      .selectFrom(AUDIT_ENTRIES_TABLE)
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("recorded_at", "<=", new Date(asOfRecordedAt))
      .where("action", "not in", ["review.request-review", "review.decide-review"]);
    const subject = payload.subjectRef;
    if (subject !== undefined) {
      const reference = referenceKey(subject);
      builder = builder.where(sql<boolean>`
        (target_ref ->> 'kind' = ${subject.kind}
          AND target_ref -> 'reference' ->> 'entityId' = ${reference.entityId}
          AND target_ref -> 'reference' ->> 'versionId' = ${reference.versionId})
      `);
    }
    const rows = await builder
      .orderBy("recorded_at", "desc")
      .orderBy("audit_entry_id", "desc")
      .limit(pageSize + 1)
      .execute();
    return rows.map((row) => entryFromAuditRow(row));
  }
}

/** 固定排序：记录时点降序，其次来源类型降序，最后活动标识降序——全序且稳定。 */
const compareActivityOrder = (
  left: ReviewActivityEntryV1,
  right: ReviewActivityEntryV1,
): number => {
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? 1 : -1;
  if (left.sourceType !== right.sourceType) return left.sourceType < right.sourceType ? 1 : -1;
  if (left.activityId !== right.activityId) return left.activityId < right.activityId ? 1 : -1;
  return 0;
};

const optionalRef = <T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T | undefined => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** view 行 → 活动条目：只保留读面允许的类型化安全参数，不导出审计 payload。 */
const entryFromViewRow = (row: ActivityViewRow): ReviewActivityEntryV1 => {
  if (row.activity_code === null) throw closed("activity-code-missing");
  const reviewTaskRef = optionalRef(ReviewTaskRefV1Schema, row.review_task_ref);
  const reviewDecisionRef = optionalRef(ReviewDecisionRefV1Schema, row.review_decision_ref);
  return ReviewActivityEntryV1Schema.parse({
    activityId: row.activity_id,
    sourceType: row.source_type,
    activityCode: row.activity_code,
    actorRef: row.actor_ref ?? undefined,
    subjectRef: optionalRef(ContractReferenceV1Schema, row.subject_ref),
    reviewTaskRef,
    reviewDecisionRef,
    targetRef: optionalRef(ContractReferenceV1Schema, row.target_ref),
    waitingRunRef: optionalRef(WorkflowRunRefV1Schema, row.waiting_run_ref),
    commandId: row.command_id ?? undefined,
    resultCode: row.result_code ?? undefined,
    reasonCode: row.reason_code ?? undefined,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });
};

/** C03 其它业务动作 → 活动条目：`business.recorded` + 原已登记 actionCode。 */
const entryFromAuditRow = (row: AuditEntryRow): ReviewActivityEntryV1 =>
  ReviewActivityEntryV1Schema.parse({
    activityId: row.audit_entry_id,
    sourceType: "business-audit",
    activityCode: "business.recorded",
    actionCode: row.action,
    actorRef: row.actor_ref,
    subjectRef: optionalRef(ContractReferenceV1Schema, row.target_ref),
    commandId: row.command_id,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

export const createPostgresReviewAuditRead = (
  options: PostgresReviewAuditReadOptionsV1,
): PostgresReviewAuditRead => new PostgresReviewAuditRead(options);
