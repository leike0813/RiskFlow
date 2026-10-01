import { describe, expect, it } from "vitest";

import {
  MODULE_BRANCH_CAPABILITY_V1,
  ReviewQueuePageV1Schema,
  ReviewQueueReadQueryV1Schema,
  ReviewQueueReadResultV1Schema,
  RiskIdentificationReadQueryV1Schema,
  RiskIdentificationReadResultV1Schema,
  RiskIdentificationReadSuccessV1Schema,
} from "../src/ports/index.js";

const versionRef = (kind: string, entityId = "entity-1", versionId = "v1") => ({
  kind,
  reference: { entityId, versionId },
});

const authorization = {
  schemaVersion: "1",
  authorizationContextRef: versionRef("authorization-context", "auth-1"),
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: ["risk-identification.read", "review-audit.read"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "policy-1", versionId: "v1" },
  decidedAt: "2026-09-25T00:00:00.000Z",
  invocation: { kind: "human" },
};

const queryBase = {
  queryId: "query-1",
  projectId: "project-1",
  actorId: "actor-1",
  requestedAt: "2026-09-25T00:00:00.000Z",
  authorization,
};

const runRef = versionRef("workflow-run", "run-1");

const reviewTaskRef = {
  kind: "review-task",
  reference: { entityId: "task-1", versionId: "v1" },
  waitingRunRef: runRef,
  reviewType: "identification-group",
  targetRef: versionRef("identification-group", "group-1"),
};

const riskRecordRef = versionRef("standardized-risk-record", "record-1");

const recordBody = {
  processNodeId: "NODE-1",
  riskSource: "RS-1",
  riskFactor: "RF-1",
  riskEvent: "RE-1",
  riskElementRelations: [{ sourceElement: "RS-1", relation: "causes", targetElement: "RE-1" }],
  evidenceLocator: { sourceSegmentId: "DOC1-S1-SEG1" },
  modelConfidence: 0.7,
};

const compositeConfidence = { value: 0.8, basis: ["basis-1"] };

describe("C33 branch-capability 映射", () => {
  it("五条新 branch 全部映射到既有能力位", () => {
    expect(MODULE_BRANCH_CAPABILITY_V1["risk-identification.run-list"]).toBe(
      "risk-identification.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["risk-identification.run-read"]).toBe(
      "risk-identification.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["risk-identification.record-catalog"]).toBe(
      "risk-identification.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["risk-identification.record-read"]).toBe(
      "risk-identification.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["review-audit.queue-read"]).toBe("review-audit.read");
  });
});

describe("RiskIdentificationReadQueryV1Schema", () => {
  it("接受四种查询形态", () => {
    for (const [kind, payload] of [
      ["run-list", { status: "running", pageSize: 20 }],
      ["run-read", { runRef }],
      [
        "record-catalog",
        { processNodeId: "NODE-1", acceptanceKind: "review", identificationRunRef: runRef },
      ],
      ["record-read", { riskRecordRef }],
    ] as const) {
      const parsed = RiskIdentificationReadQueryV1Schema.safeParse({ ...queryBase, kind, payload });
      expect(parsed.success).toBe(true);
    }
  });

  it("拒绝契约外字段与超限页大小", () => {
    expect(
      RiskIdentificationReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "run-list",
        payload: { pageSize: 20, surprise: true },
      }).success,
    ).toBe(false);
    expect(
      RiskIdentificationReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "record-catalog",
        payload: { pageSize: 51 },
      }).success,
    ).toBe(false);
  });

  it("判别联合闭合：kind 与 payload 错配被拒绝", () => {
    expect(
      RiskIdentificationReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "run-list",
        payload: { runRef },
      }).success,
    ).toBe(false);
    expect(
      RiskIdentificationReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "record-read",
        payload: { runRef },
      }).success,
    ).toBe(false);
  });

  it("缺少识别读能力时失败", () => {
    const parsed = RiskIdentificationReadQueryV1Schema.safeParse({
      ...queryBase,
      authorization: { ...authorization, grantedCapabilities: ["review-audit.read"] },
      kind: "run-read",
      payload: { runRef },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("C33 识别只读成功结果判别联合", () => {
  it("运行列表页形状且条目不含正文", () => {
    const page = {
      kind: "run-list",
      items: [
        {
          runRef,
          stage: "I7",
          status: "waiting",
          triggerReason: "operator-request",
          startedBy: "actor-1",
          startedAt: "2026-09-25T00:00:00.000Z",
          acceptedCount: 3,
          pendingReviewCount: 1,
          rejectedCount: 0,
        },
      ],
      nextCursor: "cursor-1",
    };
    expect(RiskIdentificationReadSuccessV1Schema.safeParse(page).success).toBe(true);
    expect(
      RiskIdentificationReadSuccessV1Schema.safeParse({
        ...page,
        items: [{ ...page.items[0], record: recordBody }],
      }).success,
    ).toBe(false);
  });

  it("运行详情摘要携带阶段进度与有界引用集合", () => {
    const detail = {
      kind: "run-read",
      runRef,
      stage: "I5",
      status: "retryable-failure",
      stageEntries: [
        { stage: "I0", status: "completed" },
        {
          stage: "I5",
          status: "retryable-failure",
          failureCode: "RETRYABLE_INFRASTRUCTURE_FAILURE",
          retryable: true,
        },
      ],
      workItemCoverage: [
        {
          workItemRef: versionRef("identification-work-item", "wi-1"),
          processNodeId: "NODE-1",
          status: "completed",
        },
      ],
      mergeGroups: [
        {
          groupRef: versionRef("identification-group", "group-1"),
          status: "pending-review",
          acceptanceKind: "review",
        },
      ],
      agentTaskRefs: [],
      reviewTaskRefs: [reviewTaskRef],
      resultCounts: {
        plannedWorkItemCount: 2,
        completedWorkItemCount: 1,
        failedWorkItemCount: 1,
        zeroResultCount: 0,
        acceptedCount: 3,
        pendingReviewCount: 1,
        rejectedCount: 0,
      },
      acceptedRiskRecordRefs: [riskRecordRef],
      pendingReviewGroupRefs: [versionRef("identification-group", "group-1")],
      rejectedGroupRefs: [],
      waitingRef: { kind: "review", reviewTaskRef },
    };
    expect(RiskIdentificationReadSuccessV1Schema.safeParse(detail).success).toBe(true);
    expect(
      RiskIdentificationReadSuccessV1Schema.safeParse({ ...detail, stage: "I10" }).success,
    ).toBe(false);
    expect(RiskIdentificationReadSuccessV1Schema.safeParse({ ...detail, extra: 1 }).success).toBe(
      false,
    );
  });

  it("记录目录页与记录详情信封形状", () => {
    const catalog = {
      kind: "record-catalog",
      items: [
        {
          riskRecordRef,
          processNodeId: "NODE-1",
          riskEventSummary: "盾构姿态超限引发地表沉降",
          compositeConfidence,
          acceptanceKind: "automatic",
          supersededBy: versionRef("standardized-risk-record", "record-1", "v2"),
        },
      ],
    };
    expect(RiskIdentificationReadSuccessV1Schema.safeParse(catalog).success).toBe(true);

    const detail = {
      kind: "record-read",
      riskRecordRef,
      record: recordBody,
      riskMechanismEntryIds: ["MEC-1"],
      sourceSegmentIds: ["DOC1-S1-SEG1"],
      compositeConfidence,
      acceptanceDecisionRef: versionRef("route-decision", "route-1"),
      identificationRunRef: runRef,
      auditTrailRef: versionRef("audit-trail", "audit-1"),
    };
    expect(RiskIdentificationReadSuccessV1Schema.safeParse(detail).success).toBe(true);
    expect(
      RiskIdentificationReadSuccessV1Schema.safeParse({
        ...detail,
        acceptanceDecisionRef: versionRef("workflow-run", "run-9"),
      }).success,
    ).toBe(false);
    expect(
      RiskIdentificationReadSuccessV1Schema.safeParse({ ...detail, modelConfidence: 0.9 }).success,
    ).toBe(false);
  });

  it("结果联合 succeeded/failed 判别闭合", () => {
    expect(
      RiskIdentificationReadResultV1Schema.safeParse({
        kind: "succeeded",
        result: { kind: "record-catalog", items: [] },
      }).success,
    ).toBe(true);
    expect(
      RiskIdentificationReadResultV1Schema.safeParse({ kind: "waiting", waiting: {} }).success,
    ).toBe(false);
  });
});

describe("ReviewQueueReadQueryV1Schema", () => {
  it("接受复核类型与状态筛选", () => {
    for (const payload of [
      {},
      { reviewType: "identification-group", status: "pending" },
      { status: "superseded", cursor: "cursor-1", pageSize: 50 },
    ]) {
      const parsed = ReviewQueueReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "queue-read",
        payload,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("拒绝契约外字段、超限页大小与未知状态", () => {
    expect(
      ReviewQueueReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "queue-read",
        payload: { status: "pending", actorId: "attacker" },
      }).success,
    ).toBe(false);
    expect(
      ReviewQueueReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "queue-read",
        payload: { pageSize: 51 },
      }).success,
    ).toBe(false);
    expect(
      ReviewQueueReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "queue-read",
        payload: { status: "archived" },
      }).success,
    ).toBe(false);
  });

  it("缺少复核读能力时失败", () => {
    const parsed = ReviewQueueReadQueryV1Schema.safeParse({
      ...queryBase,
      authorization: { ...authorization, grantedCapabilities: ["risk-identification.read"] },
      kind: "queue-read",
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ReviewQueuePageV1Schema", () => {
  const queueItem = {
    reviewTaskRef,
    reviewType: "identification-group",
    triggerReason: "confidence-below-threshold",
    submittedAt: "2026-09-25T00:00:00.000Z",
    status: "pending",
    stale: false,
  };

  it("队列条目携带完整任务引用与过期标记", () => {
    expect(
      ReviewQueuePageV1Schema.safeParse({
        kind: "queue-read",
        items: [queueItem, { ...queueItem, status: "superseded", stale: true }],
        nextCursor: "cursor-2",
      }).success,
    ).toBe(true);
  });

  it("strict 拒绝契约外字段与残缺任务引用", () => {
    expect(
      ReviewQueuePageV1Schema.safeParse({
        kind: "queue-read",
        items: [{ ...queueItem, decisionHint: "approve" }],
      }).success,
    ).toBe(false);
    expect(
      ReviewQueuePageV1Schema.safeParse({
        kind: "queue-read",
        items: [{ ...queueItem, reviewTaskRef: versionRef("review-task", "task-1") }],
      }).success,
    ).toBe(false);
  });

  it("结果联合携带同形失败", () => {
    expect(
      ReviewQueueReadResultV1Schema.safeParse({
        kind: "succeeded",
        result: { kind: "queue-read", items: [queueItem] },
      }).success,
    ).toBe(true);
    expect(
      ReviewQueueReadResultV1Schema.safeParse({
        kind: "failed",
        error: {
          code: "ENTITY_NOT_FOUND",
          category: "not-found",
          retryable: false,
          stageCode: "queue-read",
          occurredAt: "2026-09-25T00:00:00.000Z",
          causalRunId: "run-1",
          targetRef: runRef,
        },
      }).success,
    ).toBe(true);
  });
});
