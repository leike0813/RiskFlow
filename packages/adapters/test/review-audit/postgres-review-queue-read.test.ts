/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、命令身份与复核目标均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  AuthorizationContextV1Schema,
  ReviewQueueReadQueryV1Schema,
  ReviewRequestV1Schema,
  RiskDashboardReviewsSourceRequestV1Schema,
  type AuthorizationContextV1,
  type ReviewQueueReadQueryV1,
  type ReviewRequestV1,
  type ReviewTargetRefV1,
  type RiskDashboardReviewsSourceRequestV1,
  type RiskDashboardReviewsSourceResultV1,
} from "@riskflow/contracts/ports";

import {
  PostgresReviewAuditAdapter,
  PostgresReviewQueueReadAdapter,
} from "../../src/review-audit/index.js";
import {
  startReviewAuditFixture,
  REVIEW_TEST_TIMESTAMP,
  type ReviewAuditPostgresFixture,
} from "./fixture.js";

const nextId = (() => {
  let count = 0;
  return (prefix: string): string => `${prefix}-${++count}`;
})();

const authorizationFor = (
  projectId: string,
  options: { readonly actorId?: string; readonly capabilities?: readonly string[] } = {},
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `authorization-${projectId}`, versionId: "1" },
    },
    actorId: options.actorId ?? "actor-1",
    projectId,
    grantedCapabilities: options.capabilities ?? [
      "review-audit.request",
      "review-audit.decide",
      "review-audit.read",
    ],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    decidedAt: REVIEW_TEST_TIMESTAMP,
    invocation: { kind: "human" },
  });

const requestFor = (options: {
  readonly suffix: string;
  readonly projectId?: string;
  readonly issuedAt?: string;
  readonly reviewType?: "identification-group" | "knowledge-revision";
  readonly targetEntityId?: string;
  readonly targetVersionId?: string;
  readonly waitingRunEntityId?: string;
  readonly authorization?: AuthorizationContextV1;
}): ReviewRequestV1 => {
  const projectId = options.projectId ?? options.authorization?.projectId ?? "project-1";
  const reviewType = options.reviewType ?? "identification-group";
  const targetRef = {
    kind: reviewType,
    reference: {
      entityId: options.targetEntityId ?? `target-${options.suffix}`,
      versionId: options.targetVersionId ?? "1",
    },
  } as ReviewTargetRefV1;
  return ReviewRequestV1Schema.parse({
    kind: "request-review",
    commandId: nextId(`request-${options.suffix}`),
    idempotencyKey: nextId(`idempotency-${options.suffix}`),
    projectId,
    actorId: options.authorization?.actorId ?? "actor-1",
    issuedAt: options.issuedAt ?? REVIEW_TEST_TIMESTAMP,
    authorization: options.authorization ?? authorizationFor(projectId),
    payload: {
      reviewType,
      targetRef,
      validationSnapshotRef: {
        kind: "validation-snapshot",
        reference: { entityId: `validation-${options.suffix}`, versionId: "1" },
      },
      evidenceSnapshotRef: {
        kind: "evidence-snapshot",
        reference: { entityId: `evidence-${options.suffix}`, versionId: "1" },
      },
      waitingRunRef: {
        kind: "workflow-run",
        reference: {
          entityId: options.waitingRunEntityId ?? `run-${options.suffix}`,
          versionId: "1",
        },
      },
      reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    },
  });
};

const queueQueryFor = (
  projectId: string,
  authorization: AuthorizationContextV1,
  payload: ReviewQueueReadQueryV1["payload"] = {},
): ReviewQueueReadQueryV1 =>
  ReviewQueueReadQueryV1Schema.parse({
    queryId: nextId("queue-query"),
    projectId,
    actorId: authorization.actorId,
    requestedAt: REVIEW_TEST_TIMESTAMP,
    authorization,
    kind: "queue-read",
    payload,
  });

const makeAccess = (authorization: AuthorizationContextV1) => {
  const verify = vi.fn(async () => ({
    context: authorization,
    contextRef: authorization.authorizationContextRef,
    redacted: false,
  }));
  return { verify, access: { verify } as unknown as LocalIdentityAccessV1 };
};

describe.sequential("PostgreSQL review queue read adapter (C33)", () => {
  let fixture: ReviewAuditPostgresFixture | undefined;

  beforeAll(async () => {
    fixture = await startReviewAuditFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close();
  });

  const requireFixture = (): ReviewAuditPostgresFixture => {
    if (fixture === undefined) throw new TypeError("fixture not started");
    return fixture;
  };

  const writeAdapterFor = (authorization: AuthorizationContextV1): PostgresReviewAuditAdapter =>
    new PostgresReviewAuditAdapter({
      db: requireFixture().runtime.db,
      transactionUnit: requireFixture().transactionUnit,
      access: makeAccess(authorization).access,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    });

  const readAdapterFor = (
    authorization: AuthorizationContextV1,
    verify?: ReturnType<typeof vi.fn>,
  ): PostgresReviewQueueReadAdapter =>
    new PostgresReviewQueueReadAdapter({
      db: requireFixture().runtime.db,
      authorization: { verify: verify ?? makeAccess(authorization).verify },
    });

  const requestTask = async (
    authorization: AuthorizationContextV1,
    options: Parameters<typeof requestFor>[0],
  ) => {
    const request = requestFor({ ...options, authorization });
    const result = await writeAdapterFor(authorization).requestReview(request);
    if (result.kind !== "succeeded") throw new TypeError("requestReview seeding failed");
    return { request, reviewTaskRef: result.result.reviewTaskRef };
  };

  it("返回携带完整任务引用的有界分页条目，游标稳定且不伪造触发原因", async () => {
    const projectId = "queue-project-page";
    const authorization = authorizationFor(projectId);
    const seeded = [
      await requestTask(authorization, { suffix: "page-a", issuedAt: "2030-01-01T00:00:01.000Z" }),
      await requestTask(authorization, { suffix: "page-b", issuedAt: "2030-01-01T00:00:02.000Z" }),
      await requestTask(authorization, { suffix: "page-c", issuedAt: "2030-01-01T00:00:03.000Z" }),
    ];
    const reader = readAdapterFor(authorization);

    const first = await reader.read(queueQueryFor(projectId, authorization, { pageSize: 2 }));
    if (first.kind !== "succeeded") throw new TypeError("first page read failed");
    expect(first.result.items.map((item) => item.reviewTaskRef)).toEqual(
      seeded.slice(0, 2).map((task) => task.reviewTaskRef),
    );
    expect(first.result.nextCursor).toBe("offset-2");
    const firstItem = first.result.items[0]!;
    expect(firstItem.reviewType).toBe("identification-group");
    expect(firstItem.submittedAt).toBe("2030-01-01T00:00:01.000Z");
    expect(firstItem.status).toBe("pending");
    expect(firstItem.stale).toBe(false);
    expect("triggerReason" in firstItem).toBe(false);

    const second = await reader.read(
      queueQueryFor(projectId, authorization, {
        pageSize: 2,
        cursor: first.result.nextCursor,
      }),
    );
    if (second.kind !== "succeeded") throw new TypeError("second page read failed");
    expect(second.result.items.map((item) => item.reviewTaskRef)).toEqual([
      seeded[2]!.reviewTaskRef,
    ]);
    expect(second.result.nextCursor).toBeUndefined();

    // 重复读取同一游标得到同一内容，不追加业务事实。
    const replay = await reader.read(
      queueQueryFor(projectId, authorization, {
        pageSize: 2,
        cursor: first.result.nextCursor,
      }),
    );
    expect(replay).toEqual(second);
  });

  it("按复核类型与状态筛选，队列条目可直接构造 decide-review 命令", async () => {
    const projectId = "queue-project-filter";
    const authorization = authorizationFor(projectId);
    const writer = writeAdapterFor(authorization);
    const group = await requestTask(authorization, { suffix: "filter-group" });
    const knowledge = await requestTask(authorization, {
      suffix: "filter-knowledge",
      reviewType: "knowledge-revision",
    });
    const decision = await writer.decideReview({
      kind: "decide-review",
      commandId: nextId("decide-filter"),
      idempotencyKey: nextId("idempotency-decide-filter"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      payload: {
        reviewTaskRef: knowledge.reviewTaskRef,
        targetRef: knowledge.request.payload.targetRef,
        decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
        reasonCode: "reviewed",
      },
    });
    if (decision.kind !== "succeeded") throw new TypeError("decideReview seeding failed");

    const reader = readAdapterFor(authorization);
    const byType = await reader.read(
      queueQueryFor(projectId, authorization, { reviewType: "knowledge-revision" }),
    );
    if (byType.kind !== "succeeded") throw new TypeError("reviewType filter read failed");
    expect(byType.result.items.map((item) => item.reviewTaskRef)).toEqual([
      knowledge.reviewTaskRef,
    ]);
    expect(byType.result.items[0]!.status).toBe("decided");

    const pending = await reader.read(
      queueQueryFor(projectId, authorization, { status: "pending" }),
    );
    if (pending.kind !== "succeeded") throw new TypeError("status filter read failed");
    expect(pending.result.items.map((item) => item.reviewTaskRef)).toEqual([group.reviewTaskRef]);
  });

  it("目标版本被取代或任务被替代时由拥有方计算过期标记", async () => {
    const projectId = "queue-project-stale";
    const authorization = authorizationFor(projectId);
    const writer = writeAdapterFor(authorization);

    // 已决定任务：目标实体随后出现更新目标版本的更晚任务 → 过期。
    const decidedV1 = await requestTask(authorization, {
      suffix: "stale-decided",
      targetEntityId: "group-stale-decided",
      targetVersionId: "1",
      waitingRunEntityId: "run-stale-decided-1",
      issuedAt: "2030-01-01T00:00:01.000Z",
    });
    const decision = await writer.decideReview({
      kind: "decide-review",
      commandId: nextId("decide-stale"),
      idempotencyKey: nextId("idempotency-decide-stale"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      payload: {
        reviewTaskRef: decidedV1.reviewTaskRef,
        targetRef: decidedV1.request.payload.targetRef,
        decision: { reviewType: "identification-group", kind: "approve-unchanged" },
        reasonCode: "reviewed",
      },
    });
    if (decision.kind !== "succeeded") throw new TypeError("decideReview seeding failed");
    const newerV2 = await requestTask(authorization, {
      suffix: "stale-decided-v2",
      targetEntityId: "group-stale-decided",
      targetVersionId: "2",
      waitingRunEntityId: "run-stale-decided-2",
      issuedAt: "2030-01-01T00:00:02.000Z",
    });

    // 待处理任务被同目标更新版本的请求取代 → status superseded，过期。
    const supersededV1 = await requestTask(authorization, {
      suffix: "stale-pending",
      targetEntityId: "group-stale-pending",
      targetVersionId: "1",
      waitingRunEntityId: "run-stale-pending",
      issuedAt: "2030-01-01T00:00:03.000Z",
    });
    const replacementV2 = await requestTask(authorization, {
      suffix: "stale-pending-v2",
      targetEntityId: "group-stale-pending",
      targetVersionId: "2",
      waitingRunEntityId: "run-stale-pending",
      issuedAt: "2030-01-01T00:00:04.000Z",
    });

    const reader = readAdapterFor(authorization);
    const result = await reader.read(queueQueryFor(projectId, authorization));
    if (result.kind !== "succeeded") throw new TypeError("queue read failed");
    const byTaskId = new Map(
      result.result.items.map((item) => [item.reviewTaskRef.reference.entityId, item]),
    );
    expect(byTaskId.get(decidedV1.reviewTaskRef.reference.entityId)).toMatchObject({
      status: "decided",
      stale: true,
    });
    expect(byTaskId.get(newerV2.reviewTaskRef.reference.entityId)).toMatchObject({
      status: "pending",
      stale: false,
    });
    expect(byTaskId.get(supersededV1.reviewTaskRef.reference.entityId)).toMatchObject({
      status: "superseded",
      stale: true,
    });
    expect(byTaskId.get(replacementV2.reviewTaskRef.reference.entityId)).toMatchObject({
      status: "pending",
      stale: false,
    });
  });

  it("无权、伪造上下文、复验失败与游标篡改同形失败，跨工程返回空页", async () => {
    const projectId = "queue-project-denied";
    const authorization = authorizationFor(projectId);
    await requestTask(authorization, { suffix: "denied-seed" });
    const reader = readAdapterFor(authorization);

    const expectDenied = (result: Awaited<ReturnType<typeof reader.read>>): void => {
      if (result.kind !== "failed") throw new TypeError("expected a failed result");
      expect(result.error.code).toBe("AUTHORIZATION_DENIED");
      expect(result.error.category).toBe("authorization");
      expect(result.error.stageCode).toBe("review-audit.queue-read");
      expect(result.error).toMatchObject({
        retryable: false,
        requiredCapability: "review-audit.read",
        // 拒权错误引用当前授权策略版本；随策略升版变化，不在此钉死具体版本号。
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      });
    };

    // 冻结上下文不持复核读能力：契约解析失败且呈伪造形状 → 同形授权失败。
    const noCapability = authorizationFor(projectId, {
      capabilities: ["review-audit.request"],
    });
    expectDenied(
      await reader.read({
        queryId: nextId("queue-query"),
        projectId,
        actorId: noCapability.actorId,
        requestedAt: REVIEW_TEST_TIMESTAMP,
        authorization: noCapability,
        kind: "queue-read",
        payload: {},
      } as ReviewQueueReadQueryV1),
    );

    // 冻结上下文指向其它工程 → 同形授权失败。
    const crossProject = authorizationFor("queue-project-other");
    expectDenied(
      await reader.read({
        queryId: nextId("queue-query"),
        projectId,
        actorId: crossProject.actorId,
        requestedAt: REVIEW_TEST_TIMESTAMP,
        authorization: crossProject,
        kind: "queue-read",
        payload: {},
      } as ReviewQueueReadQueryV1),
    );

    // 当前授权复验拒绝（撤权后）→ 同形授权失败。
    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-queue-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const revokedReader = readAdapterFor(
      authorization,
      vi.fn(async () => {
        throw denial;
      }),
    );
    expectDenied(await revokedReader.read(queueQueryFor(projectId, authorization)));

    // 游标篡改 → 同形授权失败，不披露区段可见性。
    expectDenied(
      await reader.read(queueQueryFor(projectId, authorization, { cursor: "cursor-9" })),
    );

    // 合法但无可见行的工程 → 空页而非失败。
    const emptyAuthorization = authorizationFor("queue-project-empty");
    const empty = await readAdapterFor(emptyAuthorization).read(
      queueQueryFor("queue-project-empty", emptyAuthorization),
    );
    if (empty.kind !== "succeeded") throw new TypeError("empty project read failed");
    expect(empty.result.items).toEqual([]);
    expect(empty.result.nextCursor).toBeUndefined();
  });

  const dashboardRequestFor = (
    projectId: string,
    authorization: AuthorizationContextV1,
    spatialScopeRef?: RiskDashboardReviewsSourceRequestV1["spatialScopeRef"],
  ): RiskDashboardReviewsSourceRequestV1 =>
    RiskDashboardReviewsSourceRequestV1Schema.parse({
      queryId: nextId("dashboard-query"),
      projectId,
      actorId: authorization.actorId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      ...(spatialScopeRef === undefined ? {} : { spatialScopeRef }),
    });

  const readDashboardData = async (
    projectId: string,
    authorization: AuthorizationContextV1,
    spatialScopeRef?: RiskDashboardReviewsSourceRequestV1["spatialScopeRef"],
  ) => {
    const result = await readAdapterFor(authorization).readDashboard(
      dashboardRequestFor(projectId, authorization, spatialScopeRef),
    );
    if (result.kind !== "ready") throw new TypeError("review dashboard read failed");
    return result.data;
  };

  it("仪表盘复核摘要是工程级口径并按复核类型分组计数", async () => {
    const projectId = "queue-project-dashboard";
    const authorization = authorizationFor(projectId);
    await requestTask(authorization, { suffix: "dashboard-group-a" });
    await requestTask(authorization, { suffix: "dashboard-group-b" });
    await requestTask(authorization, {
      suffix: "dashboard-knowledge",
      reviewType: "knowledge-revision",
    });

    const data = await readDashboardData(projectId, authorization);
    expect(data.pendingCount).toBe(3);
    expect(data.reviewTypeCounts).toEqual([
      { reviewType: "identification-group", count: 2 },
      { reviewType: "knowledge-revision", count: 1 },
    ]);
  });

  it("目标版本被取代的 stale pending 仍计入工程待决定复核", async () => {
    const projectId = "queue-project-dashboard-stale";
    const authorization = authorizationFor(projectId);
    const staleV1 = await requestTask(authorization, {
      suffix: "dashboard-stale-v1",
      targetEntityId: "group-dashboard-stale",
      targetVersionId: "1",
      waitingRunEntityId: "run-dashboard-stale-1",
      issuedAt: "2030-01-01T00:00:01.000Z",
    });
    await requestTask(authorization, {
      suffix: "dashboard-stale-v2",
      targetEntityId: "group-dashboard-stale",
      targetVersionId: "2",
      waitingRunEntityId: "run-dashboard-stale-2",
      issuedAt: "2030-01-01T00:00:02.000Z",
    });

    // 队列口径确认被取代的目标版本仍是 pending 且 stale。
    const queue = await readAdapterFor(authorization).read(queueQueryFor(projectId, authorization));
    if (queue.kind !== "succeeded") throw new TypeError("queue read failed");
    expect(
      queue.result.items.find(
        (item) =>
          item.reviewTaskRef.reference.entityId === staleV1.reviewTaskRef.reference.entityId,
      ),
    ).toMatchObject({ status: "pending", stale: true });

    // stale 不等于已决定：仪表盘仍把两条 pending 都算入工程口径。
    const data = await readDashboardData(projectId, authorization);
    expect(data.pendingCount).toBe(2);
    expect(data.reviewTypeCounts).toEqual([{ reviewType: "identification-group", count: 2 }]);
  });

  it("已决定的复核不再计入待决定数与类型分组", async () => {
    const projectId = "queue-project-dashboard-decided";
    const authorization = authorizationFor(projectId);
    await requestTask(authorization, { suffix: "dashboard-decided-group" });
    const knowledge = await requestTask(authorization, {
      suffix: "dashboard-decided-knowledge",
      reviewType: "knowledge-revision",
    });
    const decision = await writeAdapterFor(authorization).decideReview({
      kind: "decide-review",
      commandId: nextId("decide-dashboard"),
      idempotencyKey: nextId("idempotency-decide-dashboard"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      payload: {
        reviewTaskRef: knowledge.reviewTaskRef,
        targetRef: knowledge.request.payload.targetRef,
        decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
        reasonCode: "reviewed",
      },
    });
    if (decision.kind !== "succeeded") throw new TypeError("decideReview seeding failed");

    const data = await readDashboardData(projectId, authorization);
    expect(data.pendingCount).toBe(1);
    expect(data.reviewTypeCounts).toEqual([{ reviewType: "identification-group", count: 1 }]);
  });

  it("复核摘要是工程级，不受总览空间选择影响", async () => {
    const projectId = "queue-project-dashboard-spatial";
    const authorization = authorizationFor(projectId);
    await requestTask(authorization, { suffix: "dashboard-spatial-a" });
    await requestTask(authorization, { suffix: "dashboard-spatial-b" });

    const engineering = await readDashboardData(projectId, authorization);
    const spatial = await readDashboardData(projectId, authorization, {
      kind: "spatial-scope",
      reference: { entityId: "scope-not-in-this-project", versionId: "1" },
    });
    expect(engineering).toEqual(spatial);
    expect(spatial.pendingCount).toBe(2);
  });

  it("仪表盘复核摘要无权同形失败且不返回计数", async () => {
    const projectId = "queue-project-dashboard-denied";
    const authorization = authorizationFor(projectId);
    await requestTask(authorization, { suffix: "dashboard-denied-seed" });
    const reader = readAdapterFor(authorization);

    const expectDenied = (result: RiskDashboardReviewsSourceResultV1): void => {
      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") return;
      expect(result.error.code).toBe("AUTHORIZATION_DENIED");
      expect("data" in result).toBe(false);
    };

    // 冻结上下文不持复核读能力 → 同形授权失败。
    expectDenied(
      await reader.readDashboard(
        dashboardRequestFor(
          projectId,
          authorizationFor(projectId, { capabilities: ["review-audit.request"] }),
        ),
      ),
    );

    // 冻结上下文指向其它工程 → 同形授权失败。
    expectDenied(
      await reader.readDashboard(
        dashboardRequestFor(projectId, authorizationFor("queue-project-dashboard-other")),
      ),
    );
  });
});
