import {
  ReviewDecisionCommandV1Schema,
  ReviewRequestV1Schema,
  type ReviewDecisionCommandV1,
  type ReviewRequestV1,
  type ReviewTaskRefV1,
  type ReviewTargetRefV1,
} from "@riskflow/contracts/ports";
import { IsoDateTimeSchema, IdentifierSchema } from "@riskflow/contracts/common";

import {
  ReviewActivityDisplayV1Schema,
  ReviewActivityProjectionV1Schema,
  ReviewTaskStateV1Schema,
  type ReviewActivityDisplayV1,
  type ReviewActivityProjectionV1,
  type ReviewTaskStateV1,
} from "./schema.js";

export const reviewTargetEquals = (left: ReviewTargetRefV1, right: ReviewTargetRefV1): boolean =>
  left.kind === right.kind &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

export const reviewTaskRefEquals = (left: ReviewTaskRefV1, right: ReviewTaskRefV1): boolean =>
  left.reviewType === right.reviewType &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId &&
  left.waitingRunRef.reference.entityId === right.waitingRunRef.reference.entityId &&
  left.waitingRunRef.reference.versionId === right.waitingRunRef.reference.versionId &&
  reviewTargetEquals(left.targetRef, right.targetRef);

export const reviewTargetEntityKey = (target: ReviewTargetRefV1): string =>
  `${target.kind}\u0000${target.reference.entityId}`;

export const reviewTaskIdentityKey = (input: {
  readonly projectId: string;
  readonly reviewType: ReviewTaskRefV1["reviewType"];
  readonly targetRef: ReviewTargetRefV1;
  readonly waitingRunRef: ReviewTaskRefV1["waitingRunRef"];
}): string =>
  [
    input.projectId,
    input.waitingRunRef.reference.entityId,
    input.waitingRunRef.reference.versionId,
    input.reviewType,
    input.targetRef.kind,
    input.targetRef.reference.entityId,
  ].join("\u0000");

export const createPendingReviewTask = (input: {
  readonly request: ReviewRequestV1;
  readonly reviewTaskRef: ReviewTaskRefV1;
  readonly requestedAt: string;
  readonly recordedAt?: string;
  readonly persistedAt?: string;
}): ReviewTaskStateV1 => {
  const request = ReviewRequestV1Schema.parse(input.request);
  return ReviewTaskStateV1Schema.parse({
    reviewTaskRef: input.reviewTaskRef,
    projectId: request.projectId,
    validationSnapshotRef: request.payload.validationSnapshotRef,
    evidenceSnapshotRef: request.payload.evidenceSnapshotRef,
    reviewPolicyRef: request.payload.reviewPolicyRef,
    status: "pending",
    requestedBy: request.actorId,
    requestedAuthorizationContextRef: request.authorization.authorizationContextRef,
    requestedAt: IsoDateTimeSchema.parse(input.requestedAt),
    ...(input.recordedAt === undefined
      ? {}
      : { recordedAt: IsoDateTimeSchema.parse(input.recordedAt) }),
    ...(input.persistedAt === undefined
      ? {}
      : { persistedAt: IsoDateTimeSchema.parse(input.persistedAt) }),
  });
};

export const supersedeReviewTask = (
  task: ReviewTaskStateV1,
  input: { readonly at: string; readonly commandId: string; readonly actorRef: string },
): ReviewTaskStateV1 => {
  if (task.status !== "pending") return task;
  return ReviewTaskStateV1Schema.parse({
    ...task,
    status: "superseded",
    supersededAt: IsoDateTimeSchema.parse(input.at),
    supersededByCommandId: IdentifierSchema.parse(input.commandId),
    supersededByActor: IdentifierSchema.parse(input.actorRef),
  });
};

export type ReviewDecisionValidationV1 =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly resultCode: "STALE_VERSION" | "ENTITY_NOT_FOUND";
      readonly reasonCode: string;
    };

export const validateReviewDecision = (
  task: ReviewTaskStateV1,
  command: ReviewDecisionCommandV1,
): ReviewDecisionValidationV1 => {
  const valid = ReviewDecisionCommandV1Schema.parse(command);
  if (task.projectId !== valid.projectId) {
    return { ok: false, resultCode: "STALE_VERSION", reasonCode: "review-task-project-mismatch" };
  }
  if (!reviewTaskRefEquals(task.reviewTaskRef, valid.payload.reviewTaskRef)) {
    return { ok: false, resultCode: "STALE_VERSION", reasonCode: "review-task-version-mismatch" };
  }
  if (!reviewTargetEquals(task.reviewTaskRef.targetRef, valid.payload.targetRef)) {
    return { ok: false, resultCode: "STALE_VERSION", reasonCode: "review-task-target-mismatch" };
  }
  if (task.reviewTaskRef.reviewType !== valid.payload.decision.reviewType) {
    return { ok: false, resultCode: "STALE_VERSION", reasonCode: "review-decision-type-mismatch" };
  }
  if (task.status !== "pending") {
    return { ok: false, resultCode: "STALE_VERSION", reasonCode: "review-task-not-pending" };
  }
  return { ok: true };
};

const REVIEW_ACTIVITY_DISPLAY_TEXT: Record<string, string> = {
  "review.requested": "已发起人工复核",
  "review.superseded": "旧版本复核任务已替代",
  "review.decided": "已提交人工复核决定",
  "review.decision-rejected": "复核决定因状态或版本冲突被拒绝",
  "security.authorization-allowed": "授权校验通过",
  "security.authorization-rejected": "授权校验拒绝",
};

export const reviewActivityDisplayText = (activityCode: string): string =>
  REVIEW_ACTIVITY_DISPLAY_TEXT[activityCode] ?? "复核审计活动";

export const mapReviewActivityToDisplay = (
  activity:
    | ReviewActivityProjectionV1
    | (Omit<ReviewActivityProjectionV1, "activityCode"> & { activityCode: string }),
): ReviewActivityDisplayV1 =>
  ReviewActivityDisplayV1Schema.parse({
    activityId: activity.activityId,
    projectId: activity.projectId,
    activityCode: activity.activityCode,
    displayText: reviewActivityDisplayText(activity.activityCode),
    ...(activity.resultCode === undefined ? {} : { resultCode: activity.resultCode }),
    ...(activity.reasonCode === undefined ? {} : { reasonCode: activity.reasonCode }),
  });

export const parseReviewActivityProjection = (value: unknown): ReviewActivityProjectionV1 =>
  ReviewActivityProjectionV1Schema.parse(value);
