/**
 * C37 D-21：SSE `runEvents` 的真实读取端口。
 *
 * 只 SELECT 只追加的运行引用登记 `business.workflow_run_events`：先按原 queryId 复验订阅者当前
 * 授权，再按精确游标 keyset 取至多一批 64 条。每条返回前以登记的原 `authorizationContextRef`
 * 经 C06 读回真实来源范围，再复验该事件的空间与来源版本：`subscribe` 用订阅者原授权与原
 * queryId 收窄（保守路径，不自行扩权）；`subscribeWithSourceAuthorization` 由调用方按当前
 * human session 就该事件真实范围签发唯一新授权，再以返回的 queryId 与授权引用复验。
 * 不读 Outbox 正文、不读私授权表、不写任何事实；批内任一事件不可读即整批拒绝，不推进游标。
 */
import { sql, type Kysely } from "kysely";

import {
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  RunSubscriptionRequestV1Schema,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type ModuleErrorV1,
  type ProjectionSubscriptionResultV1,
  type RunSubscriptionRequestV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type AccessErrorV1,
} from "@riskflow/core/access";

import type { PostgresLocalIdentityAccess } from "../auth/postgres-local-identity-access.js";
import { mapPostgresError } from "../postgres/pool.js";
import type { PostgresDatabase } from "../postgres/types.js";

/** 单批固定上限（D-21）：SSE 背压策略之外的读取自身边界，不随部署配置浮动。 */
const SUBSCRIBE_BATCH_LIMIT_V1 = 64;
const SUBSCRIBE_CAPABILITY_V1 = "projection.subscribe";
const SUBSCRIBE_STAGE_CODE_V1 = "projection.subscribe";
const SUBSCRIBE_CAUSAL_RUN_ID_V1 = "c37-run-event-reader";

export interface PostgresRunEventReaderOptionsV1 {
  /** 传 `runtime.db` 即可；读取身份必须对该表只有 SELECT 权限。 */
  readonly db: unknown;
  /** C06 当前授权复验与已签发来源窄读；来源不存在、工程不符或引用不符一律 undefined。 */
  readonly access: Pick<
    PostgresLocalIdentityAccess,
    "verify" | "readDeploymentAuthorizationSource"
  >;
  readonly now?: () => Date;
}

export interface PostgresRunEventReaderV1 {
  subscribe(request: RunSubscriptionRequestV1): Promise<ProjectionSubscriptionResultV1>;
  subscribeWithSourceAuthorization(
    request: RunSubscriptionRequestV1,
    authorizeEvent: RunEventSourceAuthorizerV1,
  ): Promise<ProjectionSubscriptionResultV1>;
}

/** 事件来源的真实范围：调用方据此为当前 human session 签发该事件专用的窄授权。 */
export interface RunEventSourceAuthorizationRequestV1 {
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
}

/** 调用方签发的窄授权：身份必须仍是订阅者本人，回调无权替换用户。 */
export interface RunEventSourceAuthorizationV1 {
  readonly queryId: string;
  readonly authorization: AuthorizationContextV1;
}

export type RunEventSourceAuthorizerV1 = (
  request: RunEventSourceAuthorizationRequestV1,
) => Promise<RunEventSourceAuthorizationV1>;

interface RunEventRowV1 {
  readonly event_id: unknown;
  readonly event_version: unknown;
  readonly event_order: unknown;
  readonly authorization_context_ref: unknown;
}

const failed = (error: ModuleErrorV1): ProjectionSubscriptionResultV1 => ({
  kind: "failed",
  error,
});

const sameRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

class PostgresRunEventReader implements PostgresRunEventReaderV1 {
  readonly #db: Kysely<PostgresDatabase>;
  readonly #access: PostgresRunEventReaderOptionsV1["access"];
  readonly #now: () => Date;

  constructor(options: PostgresRunEventReaderOptionsV1) {
    this.#db = options.db as Kysely<PostgresDatabase>;
    this.#access = options.access;
    this.#now = options.now ?? (() => new Date());
  }

  subscribe(request: RunSubscriptionRequestV1): Promise<ProjectionSubscriptionResultV1> {
    return this.#run(request, undefined);
  }

  subscribeWithSourceAuthorization(
    request: RunSubscriptionRequestV1,
    authorizeEvent: RunEventSourceAuthorizerV1,
  ): Promise<ProjectionSubscriptionResultV1> {
    return this.#run(request, authorizeEvent);
  }

  async #run(
    request: RunSubscriptionRequestV1,
    authorizer: RunEventSourceAuthorizerV1 | undefined,
  ): Promise<ProjectionSubscriptionResultV1> {
    const parsed = RunSubscriptionRequestV1Schema.safeParse(request);
    if (!parsed.success) return failed(this.#unsupported());
    const query = parsed.data;
    const subscriberFailure = await this.#verifySubscriber(query);
    if (subscriberFailure !== undefined) return failed(subscriberFailure);

    let batch: readonly RunEventRowV1[];
    try {
      const afterEventId = query.payload.afterEventId;
      if (afterEventId === undefined) {
        // 无游标即从当前最小序号开始；无事件时返回空批等待，空批不证明业务完成。
        batch = await this.#batch(query, undefined);
      } else {
        // 游标必须精确定位同工程、同运行同版本的已登记事件；未知或跨范围不重置，按无权同形失败。
        const cursorRow = await this.#rowAt(query, afterEventId);
        if (cursorRow === undefined || typeof cursorRow.event_order !== "string") {
          return failed(this.#denied());
        }
        // 当前调用方读不到游标事件即无权续读：不得跳过它从更早位置重放。
        const cursorFailure = await this.#verifyEvent(query, cursorRow, authorizer);
        if (cursorFailure !== undefined) return failed(cursorFailure);
        batch = await this.#batch(query, cursorRow.event_order);
      }
    } catch (error) {
      return failed(this.#technical(error));
    }

    // 逐条复验后才返回：批内任一事件不可读整批拒绝，不返回部分引用、不推进内存游标。
    const eventRefs: { kind: "domain-event"; eventId: string; eventVersion: 1 }[] = [];
    for (const row of batch) {
      const eventFailure = await this.#verifyEvent(query, row, authorizer);
      if (eventFailure !== undefined) return failed(eventFailure);
      const eventRef = this.#eventRef(row);
      if (eventRef === undefined) return failed(this.#unsupported());
      eventRefs.push(eventRef);
    }
    return { kind: "succeeded", result: { eventRefs } };
  }

  #runPredicate(query: RunSubscriptionRequestV1) {
    return sql`project_id = ${query.projectId}
      AND run_id = ${query.payload.workflowRunRef.reference.entityId}
      AND run_version_id = ${query.payload.workflowRunRef.reference.versionId}`;
  }

  #batch(query: RunSubscriptionRequestV1, cursorOrder: string | undefined) {
    // bigint 游标保持字符串比较，不经 number 转换，避免大序号精度丢失或回绕。
    const keyset =
      cursorOrder === undefined ? sql`` : sql` AND event_order > ${cursorOrder}::bigint`;
    return sql<RunEventRowV1>`
      SELECT event_id, event_version, event_order, authorization_context_ref
      FROM business.workflow_run_events
      WHERE ${this.#runPredicate(query)}${keyset}
      ORDER BY event_order ASC
      LIMIT ${SUBSCRIBE_BATCH_LIMIT_V1}`
      .execute(this.#db)
      .then((result) => result.rows);
  }

  #rowAt(query: RunSubscriptionRequestV1, eventId: string) {
    return sql<RunEventRowV1>`
      SELECT event_id, event_version, event_order, authorization_context_ref
      FROM business.workflow_run_events
      WHERE ${this.#runPredicate(query)}
        AND event_id = ${eventId}
      LIMIT 1`
      .execute(this.#db)
      .then((result) => result.rows[0]);
  }

  /** 订阅者当前授权：工程、主体与单能力按原 queryId 复验；无权与技术故障不混同。 */
  async #verifySubscriber(query: RunSubscriptionRequestV1): Promise<ModuleErrorV1 | undefined> {
    if (
      query.authorization.projectId !== query.projectId ||
      query.authorization.actorId !== query.actorId ||
      query.authorization.grantedCapabilities.length !== 1 ||
      query.authorization.grantedCapabilities[0] !== SUBSCRIBE_CAPABILITY_V1
    ) {
      return this.#denied();
    }
    try {
      const decision = await this.#access.verify({
        authorizationContextRef: query.authorization.authorizationContextRef,
        invocationId: query.queryId,
        projectId: query.projectId,
        branch: "projection.subscribe",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: query.requestedAt,
      });
      return this.#grantedToSubscriber(decision.context, query) ? undefined : this.#denied();
    } catch (error) {
      return this.#technical(error);
    }
  }

  /** 单条事件：以登记引用读回真实来源范围，再用订阅者原 queryId 复验该事件的空间与来源版本。 */
  async #verifyEvent(
    query: RunSubscriptionRequestV1,
    row: RunEventRowV1,
    authorizer: RunEventSourceAuthorizerV1 | undefined,
  ): Promise<ModuleErrorV1 | undefined> {
    const contextRef = AuthorizationContextRefV1Schema.safeParse(row.authorization_context_ref);
    if (!contextRef.success) return this.#unsupported();
    let source: Awaited<
      ReturnType<PostgresRunEventReaderOptionsV1["access"]["readDeploymentAuthorizationSource"]>
    >;
    try {
      source = await this.#access.readDeploymentAuthorizationSource({
        authorizationContextRef: contextRef.data,
        projectId: query.projectId,
      });
    } catch (error) {
      return this.#technical(error);
    }
    if (source === undefined) return this.#denied();
    if (
      source.context.projectId !== query.projectId ||
      !sameRef(source.context.authorizationContextRef.reference, contextRef.data.reference)
    ) {
      return this.#denied();
    }
    const scopes = [...source.context.spatialScopeRefs];
    const versions = [...source.sourceVersionRefs];
    let authorizationContextRef: AuthorizationContextRefV1 =
      query.authorization.authorizationContextRef;
    let invocationId = query.queryId;
    if (authorizer !== undefined) {
      // 窄授权由调用方按当前 human session 签发；reader 只核对身份仍是订阅者本人，不替代授权判断。
      let issued: RunEventSourceAuthorizationV1;
      try {
        issued = await authorizer({ spatialScopeRefs: scopes, sourceVersionRefs: versions });
      } catch (error) {
        return this.#technical(error);
      }
      const authorization = AuthorizationContextV1Schema.safeParse(issued?.authorization);
      if (
        !authorization.success ||
        typeof issued.queryId !== "string" ||
        issued.queryId.length === 0 ||
        !this.#grantedToSubscriber(authorization.data, query)
      ) {
        return this.#denied();
      }
      authorizationContextRef = authorization.data.authorizationContextRef;
      invocationId = issued.queryId;
    }
    try {
      const decision = await this.#access.verify({
        authorizationContextRef,
        invocationId,
        projectId: query.projectId,
        branch: "projection.subscribe",
        requestedSpatialScopeRefs: scopes,
        requestedSourceVersionRefs: versions,
        requestedAt: query.requestedAt,
      });
      // 来源无正文权限时 C06 仍可复验但判为 redacted：此时事件来源不可读，整批拒绝。
      return this.#grantedToSubscriber(decision.context, query) && decision.redacted === false
        ? undefined
        : this.#denied();
    } catch (error) {
      // 来源收窄不成立即无权；技术故障保留原类别，不折算成无权。
      return this.#technical(error);
    }
  }

  #grantedToSubscriber(
    context: RunSubscriptionRequestV1["authorization"],
    query: RunSubscriptionRequestV1,
  ): boolean {
    return (
      context.projectId === query.projectId &&
      context.actorId === query.actorId &&
      context.grantedCapabilities.length === 1 &&
      context.grantedCapabilities[0] === SUBSCRIBE_CAPABILITY_V1
    );
  }

  #eventRef(
    row: RunEventRowV1,
  ): { kind: "domain-event"; eventId: string; eventVersion: 1 } | undefined {
    if (row.event_version !== 1 || typeof row.event_id !== "string" || row.event_id.length === 0) {
      return undefined;
    }
    return { kind: "domain-event", eventId: row.event_id, eventVersion: 1 };
  }

  #denied(): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: SUBSCRIBE_CAPABILITY_V1,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      stageCode: SUBSCRIBE_STAGE_CODE_V1,
      occurredAt: this.#now().toISOString(),
      causalRunId: SUBSCRIBE_CAUSAL_RUN_ID_V1,
    });
  }

  #unsupported(): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "UNSUPPORTED_CONTRACT",
      category: "technical",
      retryable: false,
      schemaVersion: "1",
      stageCode: SUBSCRIBE_STAGE_CODE_V1,
      occurredAt: this.#now().toISOString(),
      causalRunId: SUBSCRIBE_CAUSAL_RUN_ID_V1,
    });
  }

  #technical(error: unknown): ModuleErrorV1 {
    const common = {
      stageCode: SUBSCRIBE_STAGE_CODE_V1,
      occurredAt: this.#now().toISOString(),
      causalRunId: SUBSCRIBE_CAUSAL_RUN_ID_V1,
      diagnosticRef: {
        kind: "diagnostic-artifact" as const,
        reference: { entityId: "run-event-reader-read-failure", versionId: "1" },
      },
    };
    let retryable: boolean;
    if (error instanceof AccessServiceError) {
      if (accessDenied(error.details)) return this.#denied();
      retryable = error.details.retryable;
    } else {
      retryable = mapPostgresError(error, SUBSCRIBE_STAGE_CODE_V1).retryable;
    }
    return ModuleErrorV1Schema.parse({
      code: retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
      category: "technical",
      retryable,
      ...(retryable
        ? {
            attempt: 1,
            retryPolicyRef: { entityId: "run-event-reader-retry-policy", versionId: "1" },
          }
        : {}),
      ...common,
    });
  }
}

/** C06 拒绝与数据库故障分道：只有真正的授权拒绝才收口为无权。 */
const accessDenied = (details: AccessErrorV1): boolean =>
  details.code === "AUTHORIZATION_DENIED" ||
  details.code === "SESSION_EXPIRED" ||
  details.code === "SESSION_REVOKED" ||
  details.code === "AUTHENTICATION_REJECTED" ||
  details.code === "PASSWORD_CHANGE_REQUIRED" ||
  details.code === "STALE_ACCESS_VERSION";

export const createPostgresRunEventReaderV1 = (
  options: PostgresRunEventReaderOptionsV1,
): PostgresRunEventReaderV1 => new PostgresRunEventReader(options);
