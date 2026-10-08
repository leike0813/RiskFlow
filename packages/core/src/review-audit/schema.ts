import { z } from "zod";

import {
  AuthorizationContextRefV1Schema,
  ContractReferenceV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewDecisionV1Schema,
  ReviewTaskRefV1Schema,
  ReviewTargetRefV1Schema,
  WorkflowRunRefV1Schema,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

export const REVIEW_TASK_STATUS_V1_VALUES = ["pending", "decided", "superseded"] as const;
export const ReviewTaskStatusV1Schema = z.enum(REVIEW_TASK_STATUS_V1_VALUES);
export type ReviewTaskStatusV1 = z.infer<typeof ReviewTaskStatusV1Schema>;

export const ReviewTaskStateV1Schema = z
  .strictObject({
    reviewTaskRef: ReviewTaskRefV1Schema,
    projectId: IdentifierSchema,
    validationSnapshotRef: ContractReferenceV1Schema,
    evidenceSnapshotRef: ContractReferenceV1Schema,
    reviewPolicyRef: VersionReferenceSchema,
    status: ReviewTaskStatusV1Schema,
    decisionRef: ReviewDecisionRefV1Schema.optional(),
    requestedBy: IdentifierSchema,
    requestedAuthorizationContextRef: AuthorizationContextRefV1Schema,
    requestedAt: IsoDateTimeSchema,
    recordedAt: IsoDateTimeSchema.optional(),
    persistedAt: IsoDateTimeSchema.optional(),
    decidedAt: IsoDateTimeSchema.optional(),
    supersededAt: IsoDateTimeSchema.optional(),
    supersededByCommandId: IdentifierSchema.optional(),
    supersededByActor: IdentifierSchema.optional(),
  })
  .superRefine((task, context) => {
    if (task.status === "pending") {
      if (task.decisionRef !== undefined || task.decidedAt !== undefined) {
        context.addIssue({ code: "custom", path: ["status"], message: "pending task is decided" });
      }
      if (
        task.supersededAt !== undefined ||
        task.supersededByCommandId !== undefined ||
        task.supersededByActor !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "pending task is superseded",
        });
      }
    }
    if (task.status === "decided") {
      if (task.decisionRef === undefined || task.decidedAt === undefined) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "decided task lacks decision",
        });
      }
      if (
        task.supersededAt !== undefined ||
        task.supersededByCommandId !== undefined ||
        task.supersededByActor !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "decided task is superseded",
        });
      }
    }
    if (task.status === "superseded") {
      if (
        task.supersededAt === undefined ||
        task.supersededByCommandId === undefined ||
        task.supersededByActor === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "superseded task lacks timestamp",
        });
      }
      if (task.decisionRef !== undefined || task.decidedAt !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "superseded task is decided",
        });
      }
    }
  });
export type ReviewTaskStateV1 = z.infer<typeof ReviewTaskStateV1Schema>;

export const ReviewDecisionStateV1Schema = z.strictObject({
  reviewDecisionRef: ReviewDecisionRefV1Schema,
  reviewTaskRef: ReviewTaskRefV1Schema,
  projectId: IdentifierSchema,
  targetRef: ReviewTargetRefV1Schema,
  decision: ReviewDecisionV1Schema,
  reasonCode: IdentifierSchema,
  validationSnapshotRef: ContractReferenceV1Schema,
  evidenceSnapshotRef: ContractReferenceV1Schema,
  waitingRunRef: WorkflowRunRefV1Schema,
  reviewPolicyRef: VersionReferenceSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  decidedAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema.optional(),
});
export type ReviewDecisionStateV1 = z.infer<typeof ReviewDecisionStateV1Schema>;

export const ReviewRejectionResultCodeV1Schema = z.enum(["STALE_VERSION", "ENTITY_NOT_FOUND"]);
export type ReviewRejectionResultCodeV1 = z.infer<typeof ReviewRejectionResultCodeV1Schema>;

export const ReviewRejectionAuditV1Schema = z.strictObject({
  rejectionId: IdentifierSchema,
  projectId: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  reviewTaskRef: ReviewTaskRefV1Schema,
  targetRef: ContractReferenceV1Schema,
  waitingRunRef: WorkflowRunRefV1Schema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  resultCode: ReviewRejectionResultCodeV1Schema,
  reasonCode: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema.optional(),
});
export type ReviewRejectionAuditV1 = z.infer<typeof ReviewRejectionAuditV1Schema>;

/**
 * `business.recorded` 是 C35 起的闭合业务活动码（design D-07）：C03 审计里的其它动作
 * 以这一个码呈现，具体动作由 `actionCode` 承载——只作为已登记标识符使用，
 * 不把其自由文本当展示内容。
 */
export const REVIEW_ACTIVITY_CODE_V1_VALUES = [
  "review.requested",
  "review.superseded",
  "review.decided",
  "review.decision-rejected",
  "security.authorization-allowed",
  "security.authorization-rejected",
  "business.recorded",
] as const;
export const ReviewActivityCodeV1Schema = z.enum(REVIEW_ACTIVITY_CODE_V1_VALUES);
export type ReviewActivityCodeV1 = z.infer<typeof ReviewActivityCodeV1Schema>;

export const ReviewActivitySourceTypeV1Schema = z.enum([
  "business-audit",
  "review-task",
  "review-rejection",
  "security-audit",
]);
export type ReviewActivitySourceTypeV1 = z.infer<typeof ReviewActivitySourceTypeV1Schema>;

export const ReviewActivityProjectionV1Schema = z.strictObject({
  activityId: IdentifierSchema,
  sourceType: ReviewActivitySourceTypeV1Schema,
  activityCode: ReviewActivityCodeV1Schema,
  /** 仅 `business.recorded` 使用：原已登记动作标识符，不承载自由文本。 */
  actionCode: IdentifierSchema.optional(),
  projectId: IdentifierSchema,
  subjectRef: ContractReferenceV1Schema.optional(),
  actorRef: IdentifierSchema.optional(),
  authorizationContextRef: AuthorizationContextRefV1Schema.optional(),
  commandId: IdentifierSchema.optional(),
  idempotencyKey: IdentifierSchema.optional(),
  reviewTaskRef: ReviewTaskRefV1Schema.optional(),
  targetRef: ContractReferenceV1Schema.optional(),
  reviewDecisionRef: ReviewDecisionRefV1Schema.optional(),
  waitingRunRef: WorkflowRunRefV1Schema.optional(),
  validationSnapshotRef: ContractReferenceV1Schema.optional(),
  evidenceSnapshotRef: ContractReferenceV1Schema.optional(),
  reviewPolicyRef: VersionReferenceSchema.optional(),
  resultCode: IdentifierSchema.optional(),
  reasonCode: IdentifierSchema.optional(),
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
});
export type ReviewActivityProjectionV1 = z.infer<typeof ReviewActivityProjectionV1Schema>;

export const ReviewActivityDisplayV1Schema = z.strictObject({
  activityId: IdentifierSchema,
  projectId: IdentifierSchema,
  activityCode: z.string().trim().min(1),
  displayText: z.string().trim().min(1),
  resultCode: IdentifierSchema.optional(),
  reasonCode: IdentifierSchema.optional(),
});
export type ReviewActivityDisplayV1 = z.infer<typeof ReviewActivityDisplayV1Schema>;
