/**
 * 合成样本、待甲方复核：本文件工程、运行、事件、授权上下文与主体均为合成夹具。
 *
 * C37 D-21 行为验证：真实 Testcontainers PostgreSQL + 完整生产迁移链（含 000057 关联表与触发器），
 * 真实 app 身份只读登记；C06 复验与来源窄读用可控替身定向放行或撤权。
 * 触发器并发、回滚与 grants 断言归迁移基础测试，本文件不重复。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import {
  AuthorizationContextV1Schema,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type RunSubscriptionRequestV1,
} from "@riskflow/contracts/ports";
import {
  AccessServiceError,
  type AccessErrorV1,
  type AuthorizationDecisionV1,
} from "@riskflow/core/access";

import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import {
  createPostgresRunEventReaderV1,
  type PostgresRunEventReaderOptionsV1,
  type RunEventSourceAuthorizationRequestV1,
  type RunEventSourceAuthorizerV1,
} from "../../src/workflow/index.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const PROJECT_ID = "project-c37-run-events";
const OTHER_PROJECT_ID = "project-c37-run-events-other";
const ACTOR_ID = "actor-c37-run-events";
const RUN_ID = "risk-flow-run:c37-run-events";
const OTHER_RUN_ID = "assessment-run:c37-run-events-other";
const RUN_VERSION_ID = "v-run-1";
const OTHER_RUN_VERSION_ID = "v-run-2";
const MIXED_RUN_ID = "risk-flow-run:mixed-batch";
const EMPTY_RUN_ID = "risk-flow-run:empty-batch";
const MISSING_SOURCE_RUN_ID = "risk-flow-run:missing-source";
const SOURCE_VERSION_RUN_ID = "risk-flow-run:source-version";
const SCOPE_ENTITY_ID = "scope-c37-run-events";
const TIMESTAMP = "2030-04-01T00:00:00.000Z";
const SCOPE_REF = {
  kind: "spatial-scope" as const,
  reference: { entityId: SCOPE_ENTITY_ID, versionId: "1" },
};
const SUBSCRIBER_REF: AuthorizationContextRefV1 = {
  kind: "authorization-context",
  reference: { entityId: "authorization-c37-sse", versionId: "1" },
};
const contextRef = (contextId: string): AuthorizationContextRefV1 => ({
  kind: "authorization-context",
  reference: { entityId: contextId, versionId: "1" },
});
const READABLE_SOURCE = contextRef("authorization-c37-event-source");
const RESTRICTED_SOURCE = contextRef("authorization-c37-restricted-source");
const ABSENT_SOURCE = contextRef("authorization-c37-absent-source");
const CROSS_PROJECT_SOURCE = contextRef("authorization-c37-cross-project-source");
const NARROW_REF = contextRef("authorization-c37-narrow");

const SUBSCRIBER_CONTEXT = AuthorizationContextV1Schema.parse({
  schemaVersion: "1",
  authorizationContextRef: SUBSCRIBER_REF,
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: ["projection.subscribe"],
  spatialScopeRefs: [SCOPE_REF],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

const stubError = (code: AccessErrorV1["code"]): AccessServiceError =>
  new AccessServiceError(
    code === "AUTHORIZATION_DENIED"
      ? {
          code,
          retryable: false,
          stage: "verify.stub",
          occurredAt: TIMESTAMP,
          diagnosticRef: {
            kind: "audit-trail",
            reference: { entityId: "c37-stub-denial", versionId: "1" },
          },
          contextRefs: [],
          requiredCapability: "projection.subscribe",
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
        }
      : {
          code,
          retryable: code === "ACCESS_TRANSIENT_FAILURE",
          stage: "verify.stub",
          occurredAt: TIMESTAMP,
          diagnosticRef: {
            kind: "audit-trail",
            reference: { entityId: "c37-stub-failure", versionId: "1" },
          },
          contextRefs: [],
        },
  );

interface StubSourceV1 {
  readonly projectId: string;
  readonly spatialScopeRefs: readonly string[];
  readonly sourceVersionRefs: readonly string[];
}

interface StubAccessInputV1 {
  /** 登记里出现过的来源上下文；缺项即来源不存在，读取必须拒绝而不是退回登记行。 */
  readonly sources: Readonly<Record<string, StubSourceV1>>;
  /** 按签发身份给出的当前可读范围；未列出的身份按 C06 收窄规则拒绝其一切范围。 */
  readonly grants?: Readonly<Record<string, StubGrantV1>>;
  readonly failWith?: AccessServiceError;
  /** C06 对无正文权限的来源判为 redacted：复验成功但事件来源不可读。 */
  readonly redacted?: boolean;
}

interface StubGrantV1 {
  readonly scopes: readonly string[];
  readonly versions: readonly string[];
}

const SUBSCRIBER_GRANT_V1: StubGrantV1 = { scopes: [SCOPE_ENTITY_ID], versions: [] };

const stubAccess = (input: StubAccessInputV1): PostgresRunEventReaderOptionsV1["access"] => {
  const decision = (context: AuthorizationContextV1): AuthorizationDecisionV1 => ({
    context,
    contextRef: context.authorizationContextRef,
    redacted: input.redacted === true,
  });
  const access = {
    async verify(request: {
      readonly authorizationContextRef: AuthorizationContextRefV1;
      readonly projectId: string;
      readonly branch: string;
      readonly requestedSpatialScopeRefs: readonly {
        readonly reference: { readonly entityId: string };
      }[];
      readonly requestedSourceVersionRefs: readonly {
        readonly reference: { readonly entityId: string };
      }[];
    }): Promise<AuthorizationDecisionV1> {
      if (input.failWith !== undefined) throw input.failWith;
      const contextId = request.authorizationContextRef.reference.entityId;
      const granted =
        input.grants === undefined
          ? contextId === SUBSCRIBER_REF.reference.entityId
            ? SUBSCRIBER_GRANT_V1
            : undefined
          : input.grants[contextId];
      const allowed =
        request.branch === "projection.subscribe" &&
        request.projectId === PROJECT_ID &&
        granted !== undefined;
      const scopeOk = request.requestedSpatialScopeRefs.every(
        (ref) => granted?.scopes.includes(ref.reference.entityId) === true,
      );
      const versionOk = request.requestedSourceVersionRefs.every(
        (ref) => granted?.versions.includes(ref.reference.entityId) === true,
      );
      if (!allowed || !scopeOk || !versionOk) {
        throw stubError("AUTHORIZATION_DENIED");
      }
      return decision(SUBSCRIBER_CONTEXT);
    },
    async readDeploymentAuthorizationSource(read: {
      readonly authorizationContextRef: AuthorizationContextRefV1;
      readonly projectId: string;
    }) {
      const source = input.sources[read.authorizationContextRef.reference.entityId];
      if (source === undefined || source.projectId !== read.projectId) return undefined;
      const contextId = read.authorizationContextRef.reference.entityId;
      return {
        context: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: read.authorizationContextRef,
          actorId: ACTOR_ID,
          projectId: source.projectId,
          grantedCapabilities: ["projection.subscribe"],
          spatialScopeRefs: source.spatialScopeRefs.map((entityId) => ({
            kind: "spatial-scope",
            reference: { entityId, versionId: "1" },
          })),
          sourceAccessGrantRefs: [],
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          decidedAt: TIMESTAMP,
          causalRunRef: {
            kind: "workflow-run",
            reference: { entityId: RUN_ID, versionId: RUN_VERSION_ID },
          },
          invocation: { kind: "system", systemActorId: "system-c37", reasonCode: "event-source" },
        }),
        invocationId: "invocation:" + contextId,
        branch: "projection.subscribe",
        parentContextRef: undefined,
        causalRunRef: undefined,
        causalCommandRef: undefined,
        sourceVersionRefs: source.sourceVersionRefs.map((entityId) => ({
          kind: "source-version",
          reference: { entityId, versionId: "1" },
        })),
      };
    },
  };
  return access as unknown as PostgresRunEventReaderOptionsV1["access"];
};

const SOURCES: Readonly<Record<string, StubSourceV1>> = {
  [READABLE_SOURCE.reference.entityId]: {
    projectId: PROJECT_ID,
    spatialScopeRefs: [SCOPE_ENTITY_ID],
    sourceVersionRefs: [],
  },
  [RESTRICTED_SOURCE.reference.entityId]: {
    projectId: PROJECT_ID,
    spatialScopeRefs: ["scope-c37-outside"],
    sourceVersionRefs: ["source-version-c37-denied"],
  },
  [CROSS_PROJECT_SOURCE.reference.entityId]: {
    projectId: OTHER_PROJECT_ID,
    spatialScopeRefs: [SCOPE_ENTITY_ID],
    sourceVersionRefs: [],
  },
};

/** 受控回调：按事件真实范围为订阅者本人签发窄授权，每条事件一个唯一 queryId。 */
const narrowAuthorizer = (
  contextId: string,
  input?: { readonly actorId?: string },
): {
  readonly authorize: RunEventSourceAuthorizerV1;
  readonly seen: RunEventSourceAuthorizationRequestV1[];
} => {
  const seen: RunEventSourceAuthorizationRequestV1[] = [];
  let issued = 0;
  return {
    seen,
    authorize: async (request) => {
      seen.push(request);
      issued += 1;
      return {
        queryId: "query-c37-narrow-" + issued,
        authorization: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: contextRef(contextId),
          actorId: input?.actorId ?? ACTOR_ID,
          projectId: PROJECT_ID,
          grantedCapabilities: ["projection.subscribe"],
          spatialScopeRefs: request.spatialScopeRefs,
          sourceAccessGrantRefs: request.sourceVersionRefs.map((ref) => ({
            kind: "source-access-grant",
            reference: ref.reference,
          })),
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          decidedAt: TIMESTAMP,
          invocation: { kind: "human" },
        }),
      };
    },
  };
};

const subscribeRequest = (
  input: {
    readonly afterEventId?: string;
    readonly runId?: string;
    readonly runVersionId?: string;
    readonly actorId?: string;
    readonly context?: AuthorizationContextV1;
  } = {},
): RunSubscriptionRequestV1 =>
  ({
    queryId: "query-c37-sse-1",
    projectId: PROJECT_ID,
    actorId: input.actorId ?? ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization: input.context ?? SUBSCRIBER_CONTEXT,
    kind: "subscribe",
    payload: {
      workflowRunRef: {
        kind: "workflow-run",
        reference: {
          entityId: input.runId ?? RUN_ID,
          versionId: input.runVersionId ?? RUN_VERSION_ID,
        },
      },
      ...(input.afterEventId === undefined ? {} : { afterEventId: input.afterEventId }),
    },
  }) as RunSubscriptionRequestV1;

let postgres: PostgresTestFixture | undefined;
let runtime: PostgresRuntime | undefined;

const PG_TIMEOUT_MS = 240_000;
const pgIt = (name: string, body: () => Promise<unknown>): void => {
  void it(name, body, PG_TIMEOUT_MS);
};

const readerFor = (access: StubAccessInputV1): ReturnType<typeof createPostgresRunEventReaderV1> =>
  createPostgresRunEventReaderV1({ db: runtime!.db, access: stubAccess(access) });

const eventIdsOf = async (
  reader: ReturnType<typeof createPostgresRunEventReaderV1>,
  request: RunSubscriptionRequestV1,
): Promise<string[]> => {
  const result = await reader.subscribe(request);
  if (result.kind !== "succeeded") throw new Error("subscribe failed: " + result.error.code);
  return result.result.eventRefs.map((ref) => ref.eventId);
};

const failureOf = async (
  reader: ReturnType<typeof createPostgresRunEventReaderV1>,
  request: RunSubscriptionRequestV1,
  authorizeEvent?: RunEventSourceAuthorizerV1,
): Promise<{ code: string; retryable: boolean }> => {
  const result =
    authorizeEvent === undefined
      ? await reader.subscribe(request)
      : await reader.subscribeWithSourceAuthorization(request, authorizeEvent);
  if (result.kind !== "failed") throw new Error("subscribe unexpectedly succeeded");
  return { code: result.error.code, retryable: result.error.retryable };
};

/** 登记一行事件：Outbox 正文由 admin 写入但不带运行引用，关联行由 admin 直接控制序号。 */
const registerRunEvent = async (input: {
  readonly eventId: string;
  readonly eventOrder: number;
  readonly authorizationContextRef: AuthorizationContextRefV1;
  readonly runId?: string;
  readonly runVersionId?: string;
}): Promise<void> => {
  const eventJson = {
    eventId: input.eventId,
    eventVersion: 1,
    projectId: PROJECT_ID,
    aggregateRef: {
      kind: "standardized-risk-record",
      reference: { entityId: "record-" + input.eventId, versionId: "1" },
    },
    authorizationContextRef: input.authorizationContextRef,
  };
  await postgres!.adminPool.query(
    `INSERT INTO outbox.events (event_id, event_type, schema_version, event_version, project_id,
       aggregate_ref, occurred_at, recorded_at, causation_id, correlation_id,
       producer_command_id, idempotency_key, authorization_context_ref, audit_trail_ref,
       event_json, payload_sha256)
     VALUES ($1, 'c37.fixture.event.v1', '1', 1, $2, $3::jsonb, $4, $4, 'causation-c37',
       'correlation-c37', 'command-c37', $5, $3::jsonb, $6::jsonb, $7::jsonb, repeat('a', 64))`,
    [
      input.eventId,
      PROJECT_ID,
      JSON.stringify(eventJson.aggregateRef),
      TIMESTAMP,
      "idempotency-" + input.eventId,
      JSON.stringify({ kind: "audit-trail", reference: { entityId: "audit-c37", versionId: "1" } }),
      JSON.stringify(eventJson),
    ],
  );
  await postgres!.adminPool.query(
    `INSERT INTO business.workflow_run_events (project_id, run_id, run_version_id, event_id,
       event_version, event_order, authorization_context_ref)
     VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb)`,
    [
      PROJECT_ID,
      input.runId ?? RUN_ID,
      input.runVersionId ?? RUN_VERSION_ID,
      input.eventId,
      input.eventOrder,
      JSON.stringify(input.authorizationContextRef),
    ],
  );
};

beforeAll(async () => {
  postgres = await startPostgresFixture();
  await runPostgresMigrations({
    connection: postgres.migrator,
    migrationRoot: postgres.productionMigrationRoot,
    additionalMigrationRoots: [postgres.fixtureMigrationRoot],
  });
  runtime = createPostgresRuntime(postgres.app, "riskflow_app");
  // 序号自 10 起步长 2：读取只按升序 keyset，不依赖连续或从 1 开始的序号。
  for (let index = 0; index < 65; index += 1) {
    await registerRunEvent({
      eventId: "event-c37-" + String(index).padStart(3, "0"),
      eventOrder: 10 + index * 2,
      authorizationContextRef: READABLE_SOURCE,
    });
  }
  await registerRunEvent({
    eventId: "event-c37-other-run",
    eventOrder: 12,
    authorizationContextRef: READABLE_SOURCE,
    runId: OTHER_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-other-version",
    eventOrder: 13,
    authorizationContextRef: READABLE_SOURCE,
    runVersionId: OTHER_RUN_VERSION_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-mixed-ok-1",
    eventOrder: 500,
    authorizationContextRef: READABLE_SOURCE,
    runId: MIXED_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-mixed-blocked",
    eventOrder: 510,
    authorizationContextRef: RESTRICTED_SOURCE,
    runId: MIXED_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-mixed-ok-2",
    eventOrder: 520,
    authorizationContextRef: READABLE_SOURCE,
    runId: MIXED_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-absent-source",
    eventOrder: 600,
    authorizationContextRef: ABSENT_SOURCE,
    runId: MISSING_SOURCE_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-cross-project-source",
    eventOrder: 610,
    authorizationContextRef: CROSS_PROJECT_SOURCE,
    runId: MISSING_SOURCE_RUN_ID,
  });
  await registerRunEvent({
    eventId: "event-c37-source-version",
    eventOrder: 700,
    authorizationContextRef: RESTRICTED_SOURCE,
    runId: SOURCE_VERSION_RUN_ID,
  });
}, PG_TIMEOUT_MS);

afterAll(async () => {
  await runtime?.close();
  await postgres?.close();
});

describe("C37 D-21 runEvents 读取", () => {
  pgIt("按登记序号升序返回事件引用，不返回内部序号或授权记录", async () => {
    const result = await readerFor({ sources: SOURCES }).subscribe(
      subscribeRequest({ afterEventId: "event-c37-062" }),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.result.eventRefs).toEqual([
      { kind: "domain-event", eventId: "event-c37-063", eventVersion: 1 },
      { kind: "domain-event", eventId: "event-c37-064", eventVersion: 1 },
    ]);
  });

  pgIt("单批至多 64 条，重建 reader 后同一游标续读同一后继批", async () => {
    const ids = await eventIdsOf(readerFor({ sources: SOURCES }), subscribeRequest());
    expect(ids).toHaveLength(64);
    expect(ids[0]).toBe("event-c37-000");
    const rest = await eventIdsOf(
      readerFor({ sources: SOURCES }),
      subscribeRequest({ afterEventId: ids[63]! }),
    );
    expect(rest).toEqual(["event-c37-064"]);
  });

  pgIt("游标耗尽与无登记都返回空批等待，不回退重放", async () => {
    expect(
      await eventIdsOf(
        readerFor({ sources: SOURCES }),
        subscribeRequest({ afterEventId: "event-c37-064" }),
      ),
    ).toEqual([]);
    expect(
      await eventIdsOf(readerFor({ sources: SOURCES }), subscribeRequest({ runId: EMPTY_RUN_ID })),
    ).toEqual([]);
  });

  pgIt("未知游标与跨运行、版本游标一律无权失败，不重置", async () => {
    const reader = readerFor({ sources: SOURCES });
    for (const cursor of ["event-c37-unknown", "event-c37-other-run", "event-c37-other-version"]) {
      expect(await failureOf(reader, subscribeRequest({ afterEventId: cursor }))).toEqual({
        code: "AUTHORIZATION_DENIED",
        retryable: false,
      });
    }
  });

  pgIt("游标事件当前不可读时拒绝续读，不跳过他从更早位置重放", async () => {
    const reader = readerFor({ sources: SOURCES });
    expect(await eventIdsOf(reader, subscribeRequest({ afterEventId: "event-c37-000" }))).toContain(
      "event-c37-001",
    );
    const revoked = readerFor({
      sources: SOURCES,
      grants: { [SUBSCRIBER_REF.reference.entityId]: { scopes: [], versions: [] } },
    });
    expect(await failureOf(revoked, subscribeRequest({ afterEventId: "event-c37-000" }))).toEqual({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
    });
  });

  pgIt("批内任一事件不可读即整批拒绝，不返回部分引用", async () => {
    expect(
      await failureOf(readerFor({ sources: SOURCES }), subscribeRequest({ runId: MIXED_RUN_ID })),
    ).toEqual({ code: "AUTHORIZATION_DENIED", retryable: false });
  });

  pgIt("来源不存在或来源工程不符时拒绝，不以登记行代替来源事实", async () => {
    expect(
      await failureOf(
        readerFor({ sources: SOURCES }),
        subscribeRequest({ runId: MISSING_SOURCE_RUN_ID }),
      ),
    ).toEqual({ code: "AUTHORIZATION_DENIED", retryable: false });
  });

  pgIt("来源版本无法在订阅者原授权内收窄时整批拒绝", async () => {
    expect(
      await failureOf(
        readerFor({ sources: SOURCES }),
        subscribeRequest({ runId: SOURCE_VERSION_RUN_ID }),
      ),
    ).toEqual({ code: "AUTHORIZATION_DENIED", retryable: false });
  });

  pgIt("来源复验判为 redacted 时整批拒绝；基础复验不因 redacted 单独拒绝", async () => {
    const redacted = readerFor({ sources: SOURCES, redacted: true });
    expect(await failureOf(redacted, subscribeRequest({ afterEventId: "event-c37-000" }))).toEqual({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
    });
    expect(await eventIdsOf(redacted, subscribeRequest({ runId: EMPTY_RUN_ID }))).toEqual([]);
  });

  pgIt("两阶段授权：回调按事件真实范围签发窄授权后同一事件可读，保守路径仍拒绝", async () => {
    const request = subscribeRequest({ runId: SOURCE_VERSION_RUN_ID });
    const narrow = narrowAuthorizer(NARROW_REF.reference.entityId, {
      scopes: ["scope-c37-outside"],
      versions: ["source-version-c37-denied"],
    });
    // 原授权不含来源版本：保守路径不得自行扩权，必须拒绝。
    expect(await failureOf(readerFor({ sources: SOURCES }), request)).toEqual({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
    });
    const reader = readerFor({
      sources: SOURCES,
      grants: {
        [SUBSCRIBER_REF.reference.entityId]: { scopes: [SCOPE_ENTITY_ID], versions: [] },
        [NARROW_REF.reference.entityId]: {
          scopes: ["scope-c37-outside"],
          versions: ["source-version-c37-denied"],
        },
      },
    });
    const result = await reader.subscribeWithSourceAuthorization(request, narrow.authorize);
    expect(result).toEqual({
      kind: "succeeded",
      result: {
        eventRefs: [{ kind: "domain-event", eventId: "event-c37-source-version", eventVersion: 1 }],
      },
    });
    // 回调必须按事件真实范围签发，且每条事件一个唯一 queryId。
    expect(narrow.seen).toHaveLength(1);
    expect(narrow.seen[0]).toEqual({
      spatialScopeRefs: [
        { kind: "spatial-scope", reference: { entityId: "scope-c37-outside", versionId: "1" } },
      ],
      sourceVersionRefs: [
        {
          kind: "source-version",
          reference: { entityId: "source-version-c37-denied", versionId: "1" },
        },
      ],
    });
  });

  pgIt("两阶段授权：回调替换用户身份时无权失败，不返回部分引用", async () => {
    const reader = readerFor({ sources: SOURCES });
    const foreign = narrowAuthorizer(NARROW_REF.reference.entityId, { actorId: "actor-c37-other" });
    expect(
      await failureOf(
        reader,
        subscribeRequest({ runId: SOURCE_VERSION_RUN_ID }),
        foreign.authorize,
      ),
    ).toEqual({ code: "AUTHORIZATION_DENIED", retryable: false });
  });

  pgIt("两阶段授权：回调技术故障保留可重试类别", async () => {
    const reader = readerFor({ sources: SOURCES });
    expect(
      await failureOf(reader, subscribeRequest({ runId: SOURCE_VERSION_RUN_ID }), () =>
        Promise.reject(stubError("ACCESS_TRANSIENT_FAILURE")),
      ),
    ).toEqual({ code: "TRANSIENT_FAILURE", retryable: true });
  });

  pgIt("订阅者主体不符时无权失败；能力不符在请求契约层即被拒绝", async () => {
    const foreignActor = AuthorizationContextV1Schema.parse({
      ...SUBSCRIBER_CONTEXT,
      actorId: "actor-c37-other",
    });
    const wrongCapability = AuthorizationContextV1Schema.parse({
      ...SUBSCRIBER_CONTEXT,
      grantedCapabilities: ["projection.query"],
    });
    expect(
      await failureOf(
        readerFor({ sources: SOURCES }),
        subscribeRequest({ actorId: "actor-c37-other", context: foreignActor }),
      ),
    ).toEqual({ code: "AUTHORIZATION_DENIED", retryable: false });
    expect(
      await failureOf(
        readerFor({ sources: SOURCES }),
        subscribeRequest({ context: wrongCapability }),
      ),
    ).toEqual({ code: "UNSUPPORTED_CONTRACT", retryable: false });
  });

  pgIt("技术故障保留可重试类别，不收口成无权", async () => {
    expect(
      await failureOf(
        readerFor({ sources: SOURCES, failWith: stubError("ACCESS_TRANSIENT_FAILURE") }),
        subscribeRequest(),
      ),
    ).toEqual({ code: "TRANSIENT_FAILURE", retryable: true });
  });

  pgIt("契约不成立的订阅请求显式失败，不返回空批冒充等待", async () => {
    await expect(
      readerFor({ sources: SOURCES }).subscribe({
        kind: "subscribe",
      } as unknown as RunSubscriptionRequestV1),
    ).resolves.toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
  });

  pgIt("读取身份对关联表只有 SELECT，普通 app 写入被拒绝", async () => {
    await expect(
      sql`INSERT INTO business.workflow_run_events (project_id, run_id, run_version_id, event_id,
        event_version, event_order, authorization_context_ref)
        VALUES ('p', 'r', 'v', 'event-c37-app-write', 1, 1, '{}'::jsonb)`.execute(runtime!.db),
    ).rejects.toThrow(/permission denied/i);
  });
});
