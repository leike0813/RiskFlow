/**
 * C26 core 测试夹具：只构造公共合法值与固定策略/授权/时点，不建立生产 seed，
 * 也不提供任何默认策略或宽松 DTO 旁路。
 */
import type {
  AuthorizationContextV1,
  OpenWarningCommandV1,
  RiskAssessmentRecordRefV1,
  WarningResponseRecordCommandV1,
} from "@riskflow/contracts/ports";
import { AuthorizationContextV1Schema } from "@riskflow/contracts/ports";
import {
  RiskAssessmentRecordSchema,
  type EvidenceReference,
  type RiskAssessmentRecord,
} from "@riskflow/contracts/records";
import type { WarningTriggerType } from "@riskflow/contracts/vocabulary";

import {
  InAppNotificationPolicyV1Schema,
  WarningAggregationPolicyV1Schema,
  WarningAssessmentContextV1Schema,
  WarningRuntimePolicySetV1Schema,
  type InAppNotificationPolicyV1,
  type WarningAggregationPolicyV1,
  type WarningAssessmentContextV1,
  type WarningRuntimePolicySetV1,
} from "../../src/warning/index.js";

export const C26_FIXTURE_PROJECT_ID = "project-c26-warning";
export const C26_FIXTURE_ACTOR_ID = "actor-c26-manager";
export const C26_FIXTURE_RECIPIENTS = ["actor-c26-field-a", "actor-c26-field-b"] as const;
export const C26_FIXTURE_AT = "2031-03-04T05:06:07.000Z";
export const C26_FIXTURE_RISK_RECORD_ID = "risk-record-c26";
export const C26_FIXTURE_ASSESSMENT_RECORD_VERSION = "2";
export const C26_FIXTURE_SPATIAL_SCOPE_ID = "spatial-scope-c26";
export const C26_FIXTURE_AGGREGATION_POLICY_REF = {
  entityId: "warning-aggregation-policy-c26",
  versionId: "1",
};
export const C26_FIXTURE_NOTIFICATION_POLICY_REF = {
  entityId: "notification-policy-c26",
  versionId: "1",
};

export const c26Evidence = (sourceSegmentId: string, versionId = "1"): EvidenceReference => ({
  locator: { sourceSegmentId },
  sourceVersion: { entityId: `${sourceSegmentId}-source`, versionId },
});

export const c26AssessmentRecordRef = (
  overrides: Partial<RiskAssessmentRecordRefV1["reference"]> = {},
): RiskAssessmentRecordRefV1 => ({
  kind: "risk-assessment-record",
  reference: {
    entityId: `assessment-record-${C26_FIXTURE_RISK_RECORD_ID}`,
    versionId: C26_FIXTURE_ASSESSMENT_RECORD_VERSION,
    ...overrides,
  },
});

export const c26TriggerIndicator = (
  indicatorItem: string,
  triggerType: WarningTriggerType,
  actualValue: number,
) => ({ indicatorItem, triggerType, actualValue });

const indicatorResult = (indicatorItem: string, segment: string) => ({
  indicatorItem,
  actualValue: 7,
  baseScore: 3,
  weightedScore: 3,
  ruleVersion: { entityId: `${indicatorItem}-rule`, versionId: "1" },
  evidenceReferences: [c26Evidence(segment)],
});

export const c26AssessmentRecord = (
  overrides: Partial<RiskAssessmentRecord> = {},
): RiskAssessmentRecord =>
  RiskAssessmentRecordSchema.parse({
    kind: "standardized-risk-record",
    riskRecordId: C26_FIXTURE_RISK_RECORD_ID,
    assessmentRecordId: `assessment-record-${C26_FIXTURE_RISK_RECORD_ID}`,
    applicabilityMetadataSnapshot: {
      constructionMethod: "盾构法",
      stratumCondition: "地层-a",
      engineeringStage: "掘进",
    },
    likelihoodScore: 3.2,
    consequenceScore: 30,
    riskLevel: "level-3",
    indicatorResults: [
      indicatorResult("indicator-possibility-1", "segment-geology"),
      indicatorResult("indicator-consequence-1", "segment-monitoring"),
    ],
    triggerIndicators: [
      c26TriggerIndicator("indicator-consequence-1", "监测指标越限", 7.5),
      c26TriggerIndicator("indicator-possibility-1", "风险等级超过风险可接受阈值", 3.2),
      c26TriggerIndicator("indicator-consequence-1", "多指标联合规则命中", 7.5),
      c26TriggerIndicator("indicator-possibility-1", "趋势/加速度/异常评分越限", 0.7),
    ],
    evidenceReferences: [c26Evidence("segment-monitoring"), c26Evidence("segment-geology")],
    applicableRuleSetVersion: { entityId: "applicable-rule-set-c26", versionId: "1" },
    weightVersion: { entityId: "weight-set-c26", versionId: "1" },
    riskMatrixVersion: { entityId: "risk-matrix-c26", versionId: "1" },
    audit: {
      actorId: C26_FIXTURE_ACTOR_ID,
      action: "risk-assessment.record",
      recordedAt: C26_FIXTURE_AT,
    },
    ...overrides,
  });

export const c26WarningAssessmentContext = (
  overrides: Partial<WarningAssessmentContextV1> = {},
): WarningAssessmentContextV1 => {
  const assessmentRecord = overrides.assessmentRecord ?? c26AssessmentRecord();
  return WarningAssessmentContextV1Schema.parse({
    schemaVersion: "1",
    projectId: C26_FIXTURE_PROJECT_ID,
    assessmentRecordRef: c26AssessmentRecordRef(),
    assessmentRecord,
    assessmentInputSnapshotRef: {
      kind: "assessment-input-snapshot",
      reference: {
        entityId: `assessment-input-snapshot-${C26_FIXTURE_RISK_RECORD_ID}`,
        versionId: "1",
      },
    },
    preparationSnapshotRef: {
      kind: "assessment-preparation-snapshot",
      reference: {
        entityId: `assessment-preparation-snapshot-${C26_FIXTURE_RISK_RECORD_ID}`,
        versionId: "1",
      },
    },
    warningAggregationPolicyRef: C26_FIXTURE_AGGREGATION_POLICY_REF,
    notificationPolicyRef: C26_FIXTURE_NOTIFICATION_POLICY_REF,
    riskInputRef: {
      kind: "standardized-risk-record",
      reference: { entityId: C26_FIXTURE_RISK_RECORD_ID, versionId: "1" },
    },
    spatialScopeRef: {
      kind: "spatial-scope",
      reference: { entityId: C26_FIXTURE_SPATIAL_SCOPE_ID, versionId: "1" },
    },
    ...overrides,
  });
};

export const c26WarningAggregationPolicy = (
  overrides: Partial<WarningAggregationPolicyV1> = {},
): WarningAggregationPolicyV1 =>
  WarningAggregationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: C26_FIXTURE_AGGREGATION_POLICY_REF,
    projectId: C26_FIXTURE_PROJECT_ID,
    responseDirectionByTriggerType: {
      风险等级超过风险可接受阈值: "评估并制定处置方案",
      监测指标越限: "加密监测并复核处置范围",
      "趋势/加速度/异常评分越限": "趋势复核与现场核查",
      多指标联合规则命中: "联合规则专项处置",
    },
    ...overrides,
  });

export const c26NotificationPolicy = (
  overrides: Partial<InAppNotificationPolicyV1> = {},
): InAppNotificationPolicyV1 =>
  InAppNotificationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: C26_FIXTURE_NOTIFICATION_POLICY_REF,
    projectId: C26_FIXTURE_PROJECT_ID,
    channel: "in-app",
    recipientActorIds: [...C26_FIXTURE_RECIPIENTS],
    ...overrides,
  });

export const c26WarningRuntimePolicies = (
  overrides: Partial<WarningRuntimePolicySetV1> = {},
): WarningRuntimePolicySetV1 =>
  WarningRuntimePolicySetV1Schema.parse({
    schemaVersion: "1",
    projectId: C26_FIXTURE_PROJECT_ID,
    warningAggregationPolicy: c26WarningAggregationPolicy(),
    notificationPolicy: c26NotificationPolicy(),
    ...overrides,
  });

export const c26Authorization = (
  overrides: Partial<AuthorizationContextV1> = {},
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "authorization-c26-manager", versionId: "1" },
    },
    actorId: C26_FIXTURE_ACTOR_ID,
    projectId: C26_FIXTURE_PROJECT_ID,
    grantedCapabilities: ["warning-response.record"],
    spatialScopeRefs: [
      {
        kind: "spatial-scope",
        reference: { entityId: C26_FIXTURE_SPATIAL_SCOPE_ID, versionId: "1" },
      },
    ],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    decidedAt: C26_FIXTURE_AT,
    invocation: { kind: "human" },
    ...overrides,
  });

export const c26OpenWarningCommand = (
  overrides: {
    readonly commandId?: string;
    readonly idempotencyKey?: string;
    readonly assessmentRecordRef?: RiskAssessmentRecordRefV1;
  } = {},
): OpenWarningCommandV1 =>
  ({
    kind: "open",
    commandId: overrides.commandId ?? "c26-open-command",
    idempotencyKey: overrides.idempotencyKey ?? "c26-open-key",
    projectId: C26_FIXTURE_PROJECT_ID,
    actorId: C26_FIXTURE_ACTOR_ID,
    issuedAt: C26_FIXTURE_AT,
    authorization: c26Authorization(),
    payload: {
      assessmentRecordRef: overrides.assessmentRecordRef ?? c26AssessmentRecordRef(),
    },
  }) as OpenWarningCommandV1;

export const c26AcknowledgeWarningCommand = (
  overrides: { readonly commandId?: string; readonly idempotencyKey?: string } = {},
): Extract<WarningResponseRecordCommandV1, { kind: "acknowledge" }> =>
  ({
    kind: "acknowledge",
    commandId: overrides.commandId ?? "c26-acknowledge-command",
    idempotencyKey: overrides.idempotencyKey ?? "c26-acknowledge-key",
    projectId: C26_FIXTURE_PROJECT_ID,
    actorId: C26_FIXTURE_ACTOR_ID,
    issuedAt: C26_FIXTURE_AT,
    authorization: c26Authorization(),
    payload: {
      warningRecordRef: {
        kind: "warning-record",
        reference: { entityId: "warning-record-c26", versionId: "1" },
      },
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: { entityId: "warning-response-task-c26", versionId: "1" },
      },
    },
  }) as Extract<WarningResponseRecordCommandV1, { kind: "acknowledge" }>;
