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
  ReviewActivityProjectionV1Schema,
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
