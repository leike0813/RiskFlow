import { describe, expect, it } from "vitest";

import {
  ReviewDecisionCommandV1Schema,
  ReviewDecisionV1Schema,
  ReviewRequestV1Schema,
  type ReviewRequestV1,
  type ReviewTargetRefV1,
} from "@riskflow/contracts/ports";
import {
  createPendingReviewTask,
  mapReviewActivityToDisplay,
  ReviewActivityPageV1Schema,
  ReviewActivityProjectionV1Schema,
  ReviewAuditReadQueryV1Schema,
  ReviewAuditReadResultV1Schema,
  ReviewTaskDetailV1Schema,
  ReviewTaskStateV1Schema,
  reviewActivityDisplayText,
  supersedeReviewTask,
  validateReviewDecision,
} from "../../src/review-audit/index.js";

const timestamp = "2030-01-01T00:00:00.000Z";

const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "authorization-1", versionId: "1" },
  },
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: [
    "review-audit.request" as const,
    "review-audit.decide" as const,
    "review-audit.read" as const,
  ],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: timestamp,
  invocation: { kind: "human" as const },
};

const target = (kind: ReviewTargetRefV1["kind"], entityId: string): ReviewTargetRefV1 =>
  ({
    kind,
    reference: { entityId, versionId: "1" },
  }) as ReviewTargetRefV1;

const requestFor = (
  reviewType: ReviewRequestV1["payload"]["reviewType"],
  targetRef: ReviewTargetRefV1,
  suffix = reviewType,
): ReviewRequestV1 =>
  ReviewRequestV1Schema.parse({
    kind: "request-review",
    commandId: `request-${suffix}`,
    idempotencyKey: `request-${suffix}`,
    projectId: "project-1",
    actorId: "actor-1",
    issuedAt: timestamp,
    authorization,
    payload: {
      reviewType,
      targetRef,
      validationSnapshotRef: {
        kind: "validation-snapshot",
        reference: { entityId: `validation-${suffix}`, versionId: "1" },
      },
      evidenceSnapshotRef: {
        kind: "evidence-snapshot",
        reference: { entityId: `evidence-${suffix}`, versionId: "1" },
      },
      waitingRunRef: {
        kind: "workflow-run",
        reference: { entityId: `run-${suffix}`, versionId: "1" },
      },
      reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    },
  });

const taskRefFor = (request: ReviewRequestV1, suffix: string) => ({
  kind: "review-task" as const,
  reference: { entityId: `task-${suffix}`, versionId: "1" },
  reviewType: request.payload.reviewType,
  targetRef: request.payload.targetRef,
  waitingRunRef: request.payload.waitingRunRef,
});

const decisionFor = (request: ReviewRequestV1, taskRef: ReturnType<typeof taskRefFor>) =>
  ReviewDecisionCommandV1Schema.parse({
    kind: "decide-review",
    commandId: `decide-${request.payload.reviewType}`,
    idempotencyKey: `decide-${request.payload.reviewType}`,
    projectId: request.projectId,
    actorId: request.actorId,
    issuedAt: timestamp,
    authorization,
    payload: {
      reviewTaskRef: taskRef,
      targetRef: request.payload.targetRef,
      decision: {
        reviewType: request.payload.reviewType,
        ...(request.payload.reviewType === "identification-group"
          ? { kind: "approve-unchanged" as const }
          : request.payload.reviewType === "knowledge-revision" ||
              request.payload.reviewType === "rule-conflict"
            ? { kind: "approve-publication" as const }
            : request.payload.reviewType === "response-candidate"
              ? { kind: "return-upstream" as const }
              : { kind: "approve-draft-creation" as const }),
      },
      reasonCode: "reviewed",
    },
  });

describe("review-audit core", () => {
  const cases = [
    ["identification-group", target("identification-group", "group-1")],
    ["knowledge-revision", target("knowledge-revision", "knowledge-1")],
    ["rule-conflict", target("rule-conflict", "conflict-1")],
    ["response-candidate", target("response-candidate", "candidate-1")],
    ["calibration-suggestion", target("calibration-suggestion", "calibration-1")],
  ] as const;

  it("schema and reference state stays strict", () => {
    const request = requestFor(cases[0][0], cases[0][1]);
    expect(ReviewRequestV1Schema.safeParse(request).success).toBe(true);
    expect(ReviewRequestV1Schema.safeParse({ ...request, unexpected: true }).success).toBe(false);
    const task = createPendingReviewTask({
      request,
      reviewTaskRef: taskRefFor(request, "identification"),
      requestedAt: timestamp,
      recordedAt: timestamp,
    });
    expect(ReviewTaskStateV1Schema.safeParse(task).success).toBe(true);
    expect(task.status).toBe("pending");
    expect(
      ReviewTaskStateV1Schema.safeParse({ ...task, supersededByActor: "actor-2" }).success,
    ).toBe(false);
  });

  it("accepts representative decision types", () => {
    for (const [reviewType, targetRef] of cases) {
      const request = requestFor(reviewType, targetRef);
      const taskRef = taskRefFor(request, reviewType);
      const command = decisionFor(request, taskRef);
      expect(ReviewDecisionV1Schema.safeParse(command.payload.decision).success).toBe(true);
      expect(ReviewDecisionCommandV1Schema.safeParse(command).success).toBe(true);
      const task = createPendingReviewTask({
        request,
        reviewTaskRef: taskRef,
        requestedAt: timestamp,
      });
      expect(validateReviewDecision(task, command)).toEqual({ ok: true });
    }
  });

  it("rejects stale and mismatched decision state", () => {
    const request = requestFor(cases[0][0], cases[0][1]);
    const taskRef = taskRefFor(request, "stale");
    const task = createPendingReviewTask({
      request,
      reviewTaskRef: taskRef,
      requestedAt: timestamp,
    });
    const command = decisionFor(request, taskRef);
    const superseded = supersedeReviewTask(task, {
      at: "2030-01-01T00:00:01.000Z",
      commandId: "request-new-version",
      actorRef: "actor-1",
    });
    expect(superseded.status).toBe("superseded");
    expect(validateReviewDecision(superseded, command)).toMatchObject({
      ok: false,
      resultCode: "STALE_VERSION",
    });
    expect(
      ReviewDecisionCommandV1Schema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          decision: { reviewType: "knowledge-revision", kind: "reject" },
        },
      }).success,
    ).toBe(false);
  });

  it("maps stable activity codes without storing prose as fact", () => {
    const activity = ReviewActivityProjectionV1Schema.parse({
      activityId: "activity-1",
      sourceType: "review-rejection",
      activityCode: "review.decision-rejected",
      projectId: "project-1",
      occurredAt: timestamp,
      recordedAt: timestamp,
      persistedAt: timestamp,
      resultCode: "STALE_VERSION",
      reasonCode: "review-task-not-pending",
    });
    const display = mapReviewActivityToDisplay(activity);
    expect(display.activityCode).toBe(activity.activityCode);
    expect(display.displayText.length).toBeGreaterThan(0);
    expect(reviewActivityDisplayText("unknown.activity").length).toBeGreaterThan(0);
  });
});

describe("C35 统一复核详情与活动读取契约", () => {
  const identificationRequest = requestFor(
    "identification-group",
    target("identification-group", "group-1"),
    "id",
  );
  const identificationTaskRef = taskRefFor(identificationRequest, "id");
  const readAuthorization = {
    ...authorization,
    grantedCapabilities: ["review-audit.read" as const],
  };
  const readQueryBase = {
    queryId: "query-1",
    projectId: "project-1",
    actorId: "actor-1",
    requestedAt: timestamp,
    authorization: readAuthorization,
  };

  it("任务详情只按精确实体与身份版本定位，并剔除请求方授权引用", () => {
    const task = createPendingReviewTask({
      request: identificationRequest,
      reviewTaskRef: identificationTaskRef,
      requestedAt: timestamp,
    });
    const detail = {
      kind: "task-detail",
      reviewTaskRef: identificationTaskRef,
      projectId: task.projectId,
      reviewType: task.reviewTaskRef.reviewType,
      status: task.status,
      targetRef: task.reviewTaskRef.targetRef,
      validationSnapshotRef: task.validationSnapshotRef,
      evidenceSnapshotRef: task.evidenceSnapshotRef,
      reviewPolicyRef: task.reviewPolicyRef,
      waitingRunRef: task.reviewTaskRef.waitingRunRef,
      requestedBy: task.requestedBy,
      requestedAt: task.requestedAt,
      actions: [],
    };
    expect(ReviewTaskDetailV1Schema.safeParse(detail).success).toBe(true);
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "task-detail",
        payload: {
          reviewTaskRef: { kind: "review-task", reference: identificationTaskRef.reference },
        },
      }).success,
    ).toBe(true);
    // 原任务状态里的请求方授权引用不得进入详情：出现即失败关闭。
    expect(
      ReviewTaskDetailV1Schema.safeParse({
        ...detail,
        requestedAuthorizationContextRef: task.requestedAuthorizationContextRef,
      }).success,
    ).toBe(false);
    // 详情不足以替代精确身份：用错版本定位必须失败。
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "task-detail",
        payload: {
          reviewTaskRef: {
            ...identificationTaskRef,
            reference: { entityId: "task-id", versionId: "2" },
          },
        },
      }).success,
    ).toBe(true);
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "task-detail",
        payload: { reviewTaskRef: "task-id" },
      }).success,
    ).toBe(false);
  });

  it("五类决定沿原联合原样通过，详情不归并决定种类", () => {
    // 五类复核任务各自只有一条原联合允许的通过路径，详情不得把它们统称为"原样通过"。
    const ownDecisionByReviewType = {
      "identification-group": "approve-unchanged",
      "knowledge-revision": "approve-publication",
      "rule-conflict": "approve-publication",
      "response-candidate": "return-upstream",
      "calibration-suggestion": "approve-draft-creation",
    } as const;
    for (const [reviewType, kind] of Object.entries(ownDecisionByReviewType)) {
      expect(ReviewDecisionV1Schema.safeParse({ reviewType, kind }).success).toBe(true);
    }
    // 归并式"原样通过"不是合法决定：识别任务不能直接用知识发布决定。
    expect(
      ReviewDecisionV1Schema.safeParse({
        reviewType: "identification-group",
        kind: "approve-publication",
      }).success,
    ).toBe(false);
  });

  it("活动读取按页上限与固定记录时点收口，超界输入失败关闭", () => {
    const entry = {
      activityId: "activity-1",
      sourceType: "business-audit",
      activityCode: "business.recorded",
      actionCode: "workflow.resume-run",
      actorRef: "actor-1",
      subjectRef: identificationTaskRef,
      commandId: "command-1",
      resultCode: "SUCCESS",
      reasonCode: "REASON-1",
      occurredAt: timestamp,
      recordedAt: timestamp,
      persistedAt: timestamp,
    };
    const page = {
      kind: "activities",
      items: [entry],
      asOfRecordedAt: timestamp,
    };
    expect(ReviewActivityPageV1Schema.safeParse(page).success).toBe(true);
    expect(ReviewActivityPageV1Schema.safeParse({ ...page, nextCursor: "cursor-1" }).success).toBe(
      true,
    );
    expect(
      ReviewActivityPageV1Schema.safeParse({
        ...page,
        items: Array.from({ length: 51 }, (_unused, index) => ({
          ...entry,
          activityId: `a-${index}`,
        })),
      }).success,
    ).toBe(false);

    for (const pageSize of [1, 50]) {
      expect(
        ReviewAuditReadQueryV1Schema.safeParse({
          ...readQueryBase,
          kind: "activities",
          payload: { pageSize },
        }).success,
      ).toBe(true);
    }
    for (const pageSize of [0, 51]) {
      expect(
        ReviewAuditReadQueryV1Schema.safeParse({
          ...readQueryBase,
          kind: "activities",
          payload: { pageSize },
        }).success,
      ).toBe(false);
    }
    // 未知操作与多余字段在解析期即被拒绝。
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "replay",
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "activities",
        payload: { rawPayloadDump: "anything" },
      }).success,
    ).toBe(false);
  });

  it("窄读必须携带 review-audit.read 能力，缺权信封一律失败", () => {
    expect(
      ReviewAuditReadQueryV1Schema.safeParse({
        ...readQueryBase,
        authorization: { ...readAuthorization, grantedCapabilities: ["review-audit.decide"] },
        kind: "activities",
        payload: {},
      }).success,
    ).toBe(false);
    // 结果联合不引入第三族：审计引用不能冒充活动明细。
    expect(
      ReviewAuditReadResultV1Schema.safeParse({
        kind: "succeeded",
        result: { kind: "activities", traceRefs: ["audit-1"] },
      }).success,
    ).toBe(false);
  });
});
