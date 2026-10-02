import { z } from "zod";

import {
  AuditInfoSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import { RiskAssessmentRecordSchema, WarningRecordSchema } from "@riskflow/contracts/records";
import {
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  ModuleErrorV1Schema,
  NotificationIntentRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  WarningRecordRefV1Schema,
  WarningResponseTaskRefV1Schema,
  type ContractReferenceV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import {
  WARNING_TRIGGER_TYPE_VALUES,
  WarningResponseTaskStatusV1Schema,
  WarningTriggerTypeSchema,
  type WarningResponseTaskStatusV1,
  type WarningTriggerType,
} from "@riskflow/contracts/vocabulary";

export { WarningResponseTaskStatusV1Schema } from "@riskflow/contracts/vocabulary";
export type { WarningResponseTaskStatusV1 } from "@riskflow/contracts/vocabulary";

/**
 * C26 自有 schema：只描述预警处置任务的持久化与派生事实，
 * 公共输入/输出/事件仍只从 `@riskflow/contracts` 消费，不复制触发枚举与记录字段。
 */
export const WARNING_LIFECYCLE_SCHEMA_VERSION_V1 = "1" as const;
export const WARNING_IN_APP_NOTIFICATION_CHANNEL_V1 = "in-app" as const;
export const WARNING_NOTIFICATION_STATUS_INTENT_RECORDED_V1 = "intent-recorded" as const;
export const WARNING_MAX_TRIGGER_INDICATORS_V1 = 1024;
export const WARNING_MAX_EVIDENCE_REFERENCES_V1 = 1024;
export const WARNING_MAX_RECIPIENTS_V1 = 256;
export const WARNING_TASK_OPEN_STATUS_V1 = "open" as const;
export const WARNING_TASK_CLOSED_STATUS_V1 = "closed" as const;

export const WARNING_RISK_INPUT_KIND_V1 = [
  "standardized-risk-record",
  "external-risk-event",
] as const;
export const WarningRiskInputKindV1Schema = z.enum(WARNING_RISK_INPUT_KIND_V1);
export type WarningRiskInputKindV1 = z.infer<typeof WarningRiskInputKindV1Schema>;

/* -------------------------------------------------------------------------- */
/* 闭合失败事实源（D-10）                                                      */
/* -------------------------------------------------------------------------- */

export const WARNING_LIFECYCLE_REASON_CODES_V1 = [
  "warning-lifecycle-authorization-required",
  "warning-lifecycle-branch-unsupported",
  "warning-lifecycle-idempotency-conflict",
  "assessment-unavailable",
  "assessment-contract-drift",
  "policy-unavailable",
  "policy-mismatch",
  "trigger-context-invalid",
  "task-version-stale",
  "warning-task-mismatch",
  "already-acknowledged",
  "notification-intent-mismatch",
] as const;
export const WarningLifecycleReasonCodeV1Schema = z.enum(WARNING_LIFECYCLE_REASON_CODES_V1);
export type WarningLifecycleReasonCodeV1 = z.infer<typeof WarningLifecycleReasonCodeV1Schema>;

export const WARNING_LIFECYCLE_FAILURE_CODES_V1 = [
  "AUTHORIZATION_DENIED",
  "UNSUPPORTED_CONTRACT",
  "BUSINESS_BLOCKED",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const WarningLifecycleFailureCodeV1Schema = z.enum(WARNING_LIFECYCLE_FAILURE_CODES_V1);
export type WarningLifecycleFailureCodeV1 = z.infer<typeof WarningLifecycleFailureCodeV1Schema>;

const FAILURE_CODE_BY_REASON_V1: Readonly<
  Record<WarningLifecycleReasonCodeV1, WarningLifecycleFailureCodeV1>
> = Object.freeze({
  "warning-lifecycle-authorization-required": "AUTHORIZATION_DENIED",
  "warning-lifecycle-branch-unsupported": "UNSUPPORTED_CONTRACT",
  "warning-lifecycle-idempotency-conflict": "IDEMPOTENCY_CONFLICT",
  "assessment-unavailable": "BUSINESS_BLOCKED",
  "assessment-contract-drift": "UNSUPPORTED_CONTRACT",
  "policy-unavailable": "BUSINESS_BLOCKED",
  "policy-mismatch": "STALE_VERSION",
  "trigger-context-invalid": "UNSUPPORTED_CONTRACT",
  "task-version-stale": "STALE_VERSION",
  "warning-task-mismatch": "BUSINESS_BLOCKED",
  "already-acknowledged": "BUSINESS_BLOCKED",
  "notification-intent-mismatch": "BUSINESS_BLOCKED",
});

export interface WarningLifecycleFailureV1 {
  readonly code: WarningLifecycleFailureCodeV1;
  readonly reasonCode: WarningLifecycleReasonCodeV1;
  readonly targetRef: ContractReferenceV1;
}

export class WarningLifecycleError extends Error {
  readonly failure: WarningLifecycleFailureV1;

  constructor(failure: WarningLifecycleFailureV1) {
    super(failure.code);
    this.name = "WarningLifecycleError";
    this.failure = failure;
  }
}

export const failWarningLifecycle = (
  reasonCode: WarningLifecycleReasonCodeV1,
  targetRef: ContractReferenceV1,
  code: WarningLifecycleFailureCodeV1 = FAILURE_CODE_BY_REASON_V1[reasonCode],
): never => {
  throw new WarningLifecycleError({ code, reasonCode, targetRef });
};

/** 从原始错误或 adapter 包装错误恢复 C26 失败；非 C26 错误返回 `undefined`。 */
export const warningLifecycleFailureFrom = (
  error: unknown,
): WarningLifecycleFailureV1 | undefined =>
  error instanceof WarningLifecycleError ? error.failure : undefined;

export const toWarningModuleError = (
  failure: WarningLifecycleFailureV1,
  causalRunId: string,
  requiredCapability: ModuleCapabilityV1 = "warning-response.record",
): ModuleErrorV1 => {
  const common = {
    stageCode: "warning-response.lifecycle",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  switch (failure.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability,
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: WARNING_LIFECYCLE_SCHEMA_VERSION_V1,
      });
    case "STALE_VERSION":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "STALE_VERSION",
        category: "concurrency",
        retryable: false,
        targetRef: failure.targetRef,
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: failure.reasonCode,
        blockerRef: failure.targetRef,
      });
    case "IDEMPOTENCY_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: "unknown",
        priorCommandId: "unknown",
      });
    case "TRANSIENT_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: { entityId: "warning-response-retry-policy", versionId: "1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "warning-lifecycle-failure", versionId: "1" },
        },
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "warning-lifecycle-failure", versionId: "1" },
        },
      });
  }
};

/* -------------------------------------------------------------------------- */
/* 运行时策略（D-02）                                                          */
/* -------------------------------------------------------------------------- */

const responseDirectionShape = Object.fromEntries(
  WARNING_TRIGGER_TYPE_VALUES.map((triggerType) => [triggerType, IdentifierSchema]),
) as Record<WarningTriggerType, z.ZodString>;

/** 四类公共触发类型各自唯一的响应方向；归集键是规格固定规则，不做可编程表达式。 */
export const WarningAggregationPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  policyRef: VersionReferenceSchema,
  projectId: IdentifierSchema,
  responseDirectionByTriggerType: z.strictObject(responseDirectionShape),
});
export type WarningAggregationPolicyV1 = z.infer<typeof WarningAggregationPolicyV1Schema>;

const canonicalRecipientIds = z
  .array(IdentifierSchema)
  .min(1)
  .max(WARNING_MAX_RECIPIENTS_V1)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value),
    "recipientActorIds must be unique and canonically sorted",
  );

export const InAppNotificationPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  policyRef: VersionReferenceSchema,
  projectId: IdentifierSchema,
  channel: z.literal(WARNING_IN_APP_NOTIFICATION_CHANNEL_V1),
  recipientActorIds: canonicalRecipientIds,
});
export type InAppNotificationPolicyV1 = z.infer<typeof InAppNotificationPolicyV1Schema>;

export const WarningRuntimePolicySetV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  warningAggregationPolicy: WarningAggregationPolicyV1Schema,
  notificationPolicy: InAppNotificationPolicyV1Schema,
});
export type WarningRuntimePolicySetV1 = z.infer<typeof WarningRuntimePolicySetV1Schema>;

/* -------------------------------------------------------------------------- */
/* 从 C25 精确投影的评估上下文（D-03）                                          */
/* -------------------------------------------------------------------------- */

export const WarningAssessmentContextV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    projectId: IdentifierSchema,
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    assessmentRecord: RiskAssessmentRecordSchema,
    assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
    preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
    warningAggregationPolicyRef: VersionReferenceSchema,
    notificationPolicyRef: VersionReferenceSchema,
    riskInputRef: RiskInputVersionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
  })
  .superRefine((context, refinement) => {
    if (
      context.assessmentRecordRef.reference.entityId !== context.assessmentRecord.assessmentRecordId
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["assessmentRecord"],
        message: "assessment record payload does not match its reference",
      });
    }
    if (context.riskInputRef.kind !== context.assessmentRecord.kind) {
      refinement.addIssue({
        code: "custom",
        path: ["riskInputRef"],
        message: "risk input kind does not match the assessment record discriminant",
      });
    }
    const expectedIdentifier =
      context.assessmentRecord.kind === "standardized-risk-record"
        ? context.assessmentRecord.riskRecordId
        : context.assessmentRecord.externalRiskEventId;
    if (expectedIdentifier !== context.riskInputRef.reference.entityId) {
      refinement.addIssue({
        code: "custom",
        path: ["riskInputRef"],
        message: "risk input reference does not match the assessment record",
      });
    }
  });
export type WarningAssessmentContextV1 = z.infer<typeof WarningAssessmentContextV1Schema>;

/* -------------------------------------------------------------------------- */
/* 处置任务、通知意图、投递与确认（D-05、D-07、D-08）                           */
/* -------------------------------------------------------------------------- */

export const WarningAggregationKeyV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  riskInputKind: WarningRiskInputKindV1Schema,
  riskInputEntityId: IdentifierSchema,
  spatialScopeEntityId: IdentifierSchema,
});
export type WarningAggregationKeyV1 = z.infer<typeof WarningAggregationKeyV1Schema>;

export const WarningResponseTaskVersionV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  taskRef: WarningResponseTaskRefV1Schema,
  aggregationKey: WarningAggregationKeyV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  status: WarningResponseTaskStatusV1Schema,
  warningRecordRefs: z
    .array(WarningRecordRefV1Schema)
    .min(1)
    .max(WARNING_MAX_TRIGGER_INDICATORS_V1),
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  actorId: IdentifierSchema,
});
export type WarningResponseTaskVersionV1 = z.infer<typeof WarningResponseTaskVersionV1Schema>;

export const NotificationIntentV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  notificationIntentRef: NotificationIntentRefV1Schema,
  warningRecordRef: WarningRecordRefV1Schema,
  warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  notificationPolicyRef: VersionReferenceSchema,
  recipientActorId: IdentifierSchema,
  channel: z.literal(WARNING_IN_APP_NOTIFICATION_CHANNEL_V1),
  recordedAt: IsoDateTimeSchema,
});
export type NotificationIntentV1 = z.infer<typeof NotificationIntentV1Schema>;

export const InAppNotificationV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  notificationIntentRef: NotificationIntentRefV1Schema,
  warningRecordRef: WarningRecordRefV1Schema,
  warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  recipientActorId: IdentifierSchema,
  channel: z.literal(WARNING_IN_APP_NOTIFICATION_CHANNEL_V1),
  deliveredAt: IsoDateTimeSchema,
});
export type InAppNotificationV1 = z.infer<typeof InAppNotificationV1Schema>;

export const WarningAcknowledgementV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  warningRecordRef: WarningRecordRefV1Schema,
  warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  acknowledgedByActorId: IdentifierSchema,
  acknowledgedAt: IsoDateTimeSchema,
  audit: AuditInfoSchema,
});
export type WarningAcknowledgementV1 = z.infer<typeof WarningAcknowledgementV1Schema>;

/* -------------------------------------------------------------------------- */
/* 纯计划结果（D-04）                                                          */
/* -------------------------------------------------------------------------- */

export const PlannedWarningV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  triggerType: WarningTriggerTypeSchema,
  warningRef: WarningRecordRefV1Schema,
  record: WarningRecordSchema,
});
export type PlannedWarningV1 = z.infer<typeof PlannedWarningV1Schema>;

export const PlannedNotificationIntentV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  notificationIntentRef: NotificationIntentRefV1Schema,
  warningRef: WarningRecordRefV1Schema,
  notificationPolicyRef: VersionReferenceSchema,
  recipientActorId: IdentifierSchema,
  channel: z.literal(WARNING_IN_APP_NOTIFICATION_CHANNEL_V1),
});
export type PlannedNotificationIntentV1 = z.infer<typeof PlannedNotificationIntentV1Schema>;

export const WarningOpeningPlanV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  aggregationKey: WarningAggregationKeyV1Schema,
  warnings: z.array(PlannedWarningV1Schema).max(WARNING_TRIGGER_TYPE_VALUES.length),
  notificationIntents: z.array(PlannedNotificationIntentV1Schema),
});
export type WarningOpeningPlanV1 = z.infer<typeof WarningOpeningPlanV1Schema>;

/** 稳定引用键：kind 与 entityId/versionId 三元组，用于规范排序与去重。 */
export const warningRefKey = (ref: {
  readonly kind: string;
  readonly reference: VersionReference;
}): string => `${ref.kind}\u0000${ref.reference.entityId}\u0000${ref.reference.versionId}`;

export const versionReferenceKey = (ref: VersionReference): string =>
  `${ref.entityId}\u0000${ref.versionId}`;

export const warningTriggerTypeOrder = (triggerType: WarningTriggerType): number =>
  WARNING_TRIGGER_TYPE_VALUES.indexOf(triggerType);

export const evidenceReferenceKey = (evidence: {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: VersionReference;
}): string =>
  `${evidence.sourceVersion.entityId}\u0000${evidence.sourceVersion.versionId}\u0000${evidence.locator.sourceSegmentId}`;
