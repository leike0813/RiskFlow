import { randomUUID } from "node:crypto";

import { sha256CanonicalJson, type TransactionContextV1 } from "../persistence/index.js";
import type {
  AuthorizationContextV1,
  NotificationIntentRefV1,
  OpenWarningCommandV1,
  OpenWarningResultV1,
  RiskAssessmentRecordRefV1,
  WarningRecordRefV1,
  WarningResponseRecordCommandV1,
  WarningResponseRecordResultV1,
  WarningResponseTaskRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";
import type { TriggerIndicator } from "@riskflow/contracts/records";
import {
  WARNING_TRIGGER_TYPE_VALUES,
  type WarningTriggerType,
} from "@riskflow/contracts/vocabulary";

import {
  WARNING_IN_APP_NOTIFICATION_CHANNEL_V1,
  WARNING_NOTIFICATION_STATUS_INTENT_RECORDED_V1,
  WarningAssessmentContextV1Schema,
  WarningOpeningPlanV1Schema,
  WarningRuntimePolicySetV1Schema,
  evidenceReferenceKey,
  failWarningLifecycle,
  versionReferenceKey,
  warningTriggerTypeOrder,
  type InAppNotificationV1,
  type WarningAssessmentContextV1,
  type WarningOpeningPlanV1,
  type WarningRuntimePolicySetV1,
} from "./schema.js";

/** C26 通过两个窄接缝消费其它模块拥有的正式事实，并从部署组合根取得精确策略。 */
export interface WarningAssessmentContextReaderV1 {
  read(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): Promise<WarningAssessmentContextV1>;
}

export interface WarningRuntimePolicyProviderV1 {
  read(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly warningAggregationPolicyRef: VersionReference;
    readonly notificationPolicyRef: VersionReference;
  }): Promise<WarningRuntimePolicySetV1>;
}

/**
 * 事务绑定投递写入器：只接受幂等消费者自有事务上下文，由 Worker handler 调用。
 * 事件载荷只带精确意图引用，写入器按引用复验关联后再追加投递事实。
 */
export interface WarningInAppNotificationWriterV1 {
  deliverInAppNotifications(
    context: TransactionContextV1,
    input: {
      readonly projectId: string;
      readonly warningRecordRef: WarningRecordRefV1;
      readonly warningResponseTaskRef: WarningResponseTaskRefV1;
      readonly notificationIntentRefs: readonly NotificationIntentRefV1[];
    },
  ): Promise<{ readonly notifications: readonly InAppNotificationV1[] }>;
}

/** 确认命令只使用已归档公共契约的 `acknowledge` 分支。 */
export type WarningAcknowledgementCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { kind: "acknowledge" }
>;

/**
 * C26 用例接口：实现方是 `packages/adapters` 的 PostgreSQL adapter，
 * 只暴露 C26 拥有的 `open` 与 `acknowledge` 分支，不宣称完整 `WarningResponsePortV1`。
 */
export interface WarningLifecycleServiceV1 {
  open(command: OpenWarningCommandV1): Promise<OpenWarningResultV1>;
  acknowledge(command: WarningAcknowledgementCommandV1): Promise<WarningResponseRecordResultV1>;
}

export interface PlanWarningOpeningInputV1 {
  readonly context: WarningAssessmentContextV1;
  readonly policies: WarningRuntimePolicySetV1;
  readonly actorId: string;
  readonly recordedAt: string;
  /** 预警标识来源：生产使用 `crypto.randomUUID`，测试可注入确定性来源。 */
  readonly newWarningRecordId?: () => string;
}

const assertPolicyCompatibility = (
  context: WarningAssessmentContextV1,
  policies: WarningRuntimePolicySetV1,
): void => {
  const aggregation = policies.warningAggregationPolicy;
  const notification = policies.notificationPolicy;
  if (aggregation.projectId !== context.projectId || notification.projectId !== context.projectId) {
    failWarningLifecycle("policy-mismatch", context.assessmentRecordRef);
  }
  if (
    versionReferenceKey(aggregation.policyRef) !==
      versionReferenceKey(context.warningAggregationPolicyRef) ||
    versionReferenceKey(notification.policyRef) !==
      versionReferenceKey(context.notificationPolicyRef)
  ) {
    failWarningLifecycle("policy-mismatch", context.assessmentRecordRef);
  }
};

const canonicalIndicators = (
  indicators: readonly TriggerIndicator[],
  triggerType: WarningTriggerType,
): readonly TriggerIndicator[] => {
  const unique = new Map<string, TriggerIndicator>();
  for (const indicator of indicators) {
    if (indicator.triggerType !== triggerType) continue;
    unique.set(JSON.stringify(indicator), indicator);
  }
  return [...unique.entries()]
    .sort(([leftKey, left], [rightKey, right]) =>
      left.indicatorItem === right.indicatorItem
        ? leftKey < rightKey
          ? -1
          : 1
        : left.indicatorItem < right.indicatorItem
          ? -1
          : 1,
    )
    .map(([, indicator]) => indicator);
};

const canonicalEvidence = (
  evidence: readonly EvidenceReference[],
): readonly EvidenceReference[] => {
  const unique = new Map<string, EvidenceReference>();
  for (const reference of evidence) unique.set(evidenceReferenceKey(reference), reference);
  return [...unique.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, reference]) => reference);
};

/**
 * 纯规划：按公共触发类型规范分组去重，形成每类一条预警与每个接收人一条通知意图。
 * 不执行阈值判断、不生成数据库标识（预警标识由注入的来源给出）、不产生事件与审计。
 */
export const planWarningOpening = (input: PlanWarningOpeningInputV1): WarningOpeningPlanV1 => {
  const context = WarningAssessmentContextV1Schema.parse(input.context);
  const policies = WarningRuntimePolicySetV1Schema.parse(input.policies);
  assertPolicyCompatibility(context, policies);
  const newWarningRecordId = input.newWarningRecordId ?? (() => randomUUID());
  const directionByTrigger = policies.warningAggregationPolicy.responseDirectionByTriggerType;
  const warnings: WarningOpeningPlanV1["warnings"] = [];
  const notificationIntents: WarningOpeningPlanV1["notificationIntents"] = [];

  for (const triggerType of [...WARNING_TRIGGER_TYPE_VALUES].sort(
    (left, right) => warningTriggerTypeOrder(left) - warningTriggerTypeOrder(right),
  )) {
    const triggerIndicators = canonicalIndicators(
      context.assessmentRecord.triggerIndicators,
      triggerType,
    );
    if (triggerIndicators.length === 0) continue;
    const indicatorItems = new Set(triggerIndicators.map((indicator) => indicator.indicatorItem));
    const evidenceReferences = canonicalEvidence([
      ...context.assessmentRecord.evidenceReferences,
      ...context.assessmentRecord.indicatorResults
        .filter((result) => indicatorItems.has(result.indicatorItem))
        .flatMap((result) => result.evidenceReferences),
    ]);
    if (evidenceReferences.length === 0) {
      failWarningLifecycle("trigger-context-invalid", context.assessmentRecordRef);
    }
    const warningRecordId = newWarningRecordId();
    const warningRef: WarningRecordRefV1 = {
      kind: "warning-record",
      reference: { entityId: warningRecordId, versionId: "1" },
    };
    warnings.push({
      schemaVersion: "1",
      triggerType,
      warningRef,
      record: {
        warningRecordId,
        assessmentRecordId: context.assessmentRecordRef.reference.entityId,
        warningLevel: context.assessmentRecord.riskLevel,
        triggerType,
        triggerIndicators: [...triggerIndicators],
        evidenceReferences: [...evidenceReferences],
        recommendedResponseDirection: directionByTrigger[triggerType],
        notificationStatus: WARNING_NOTIFICATION_STATUS_INTENT_RECORDED_V1,
        audit: {
          actorId: input.actorId,
          action: "warning-response.open",
          recordedAt: input.recordedAt,
        },
      },
    });
    for (const recipientActorId of policies.notificationPolicy.recipientActorIds) {
      notificationIntents.push({
        schemaVersion: "1",
        notificationIntentRef: {
          kind: "notification-intent",
          reference: {
            entityId: `in-app-notification-intent-${sha256CanonicalJson({
              warningRef,
              policyRef: policies.notificationPolicy.policyRef,
              recipientActorId,
            }).slice(0, 32)}`,
            versionId: "1",
          },
        },
        warningRef,
        notificationPolicyRef: policies.notificationPolicy.policyRef,
        recipientActorId,
        channel: WARNING_IN_APP_NOTIFICATION_CHANNEL_V1,
      });
    }
  }

  return WarningOpeningPlanV1Schema.parse({
    schemaVersion: "1",
    aggregationKey: {
      schemaVersion: "1",
      projectId: context.projectId,
      riskInputKind: context.riskInputRef.kind,
      riskInputEntityId: context.riskInputRef.reference.entityId,
      spatialScopeEntityId: context.spatialScopeRef.reference.entityId,
    },
    warnings,
    notificationIntents,
  });
};
