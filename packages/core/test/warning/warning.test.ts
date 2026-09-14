import { describe, expect, it } from "vitest";

import { WarningResponseRecordCommandV1Schema } from "@riskflow/contracts/ports";

import {
  WarningAcknowledgementV1Schema,
  planWarningOpening,
  warningLifecycleFailureFrom,
  warningRefKey,
} from "../../src/warning/index.js";
import {
  C26_FIXTURE_RECIPIENTS,
  c26AssessmentRecord,
  c26AcknowledgeWarningCommand,
  c26TriggerIndicator,
  c26WarningAggregationPolicy,
  c26WarningAssessmentContext,
  c26WarningRuntimePolicies,
} from "./fixture.js";

const planFor = (record = c26AssessmentRecord(), policies = c26WarningRuntimePolicies()) =>
  planWarningOpening({
    context: c26WarningAssessmentContext({ assessmentRecord: record }),
    policies,
    actorId: "actor-c26-manager",
    recordedAt: "2031-03-04T05:06:07.000Z",
    newWarningRecordId: (() => {
      let sequence = 0;
      return () => `warning-record-c26-${++sequence}`;
    })(),
  });

describe("C26 预警规划", () => {
  it("空触发事实产出空计划且不伪造预警", () => {
    const plan = planFor(c26AssessmentRecord({ triggerIndicators: [] }));
    expect(plan.warnings).toEqual([]);
    expect(plan.notificationIntents).toEqual([]);
    expect(plan.aggregationKey).toMatchObject({
      projectId: "project-c26-warning",
      riskInputEntityId: "risk-record-c26",
      spatialScopeEntityId: "spatial-scope-c26",
    });
  });

  it("四类触发各形成一条规范预警且指标按类型隔离", () => {
    const plan = planFor();
    expect(plan.warnings.map((warning) => warning.triggerType)).toEqual([
      "风险等级超过风险可接受阈值",
      "监测指标越限",
      "趋势/加速度/异常评分越限",
      "多指标联合规则命中",
    ]);
    expect(plan.warnings).toHaveLength(4);
    for (const warning of plan.warnings) {
      expect(warning.record.assessmentRecordId).toBe("assessment-record-risk-record-c26");
      expect(warning.record.warningLevel).toBe("level-3");
      expect(warning.record.notificationStatus).toBe("intent-recorded");
      expect(warning.record.triggerIndicators.length).toBeGreaterThan(0);
      for (const indicator of warning.record.triggerIndicators) {
        expect(indicator.triggerType).toBe(warning.triggerType);
      }
    }
    const monitorWarning = plan.warnings.find((warning) => warning.triggerType === "监测指标越限");
    expect(monitorWarning?.record.triggerIndicators).toEqual([
      c26TriggerIndicator("indicator-consequence-1", "监测指标越限", 7.5),
    ]);
    expect(monitorWarning?.record.recommendedResponseDirection).toBe("加密监测并复核处置范围");
  });

  it("同一触发类型的重复指标与乱序证据收敛为同一规范计划", () => {
    const duplicated = c26AssessmentRecord({
      triggerIndicators: [
        c26TriggerIndicator("indicator-possibility-1", "监测指标越限", 1),
        c26TriggerIndicator("indicator-possibility-1", "监测指标越限", 1),
        c26TriggerIndicator("indicator-possibility-1", "风险等级超过风险可接受阈值", 3.2),
      ],
      evidenceReferences: [
        {
          locator: { sourceSegmentId: "segment-b" },
          sourceVersion: { entityId: "source-b", versionId: "1" },
        },
        {
          locator: { sourceSegmentId: "segment-a" },
          sourceVersion: { entityId: "source-a", versionId: "1" },
        },
        {
          locator: { sourceSegmentId: "segment-a" },
          sourceVersion: { entityId: "source-a", versionId: "1" },
        },
      ],
    });
    const reordered = c26AssessmentRecord({
      triggerIndicators: [
        c26TriggerIndicator("indicator-possibility-1", "风险等级超过风险可接受阈值", 3.2),
        c26TriggerIndicator("indicator-possibility-1", "监测指标越限", 1),
      ],
      evidenceReferences: [
        {
          locator: { sourceSegmentId: "segment-a" },
          sourceVersion: { entityId: "source-a", versionId: "1" },
        },
        {
          locator: { sourceSegmentId: "segment-b" },
          sourceVersion: { entityId: "source-b", versionId: "1" },
        },
      ],
    });
    const first = planFor(duplicated);
    const second = planFor(reordered);
    expect(JSON.stringify(first.warnings)).toBe(JSON.stringify(second.warnings));
    expect(first.warnings).toHaveLength(2);
    for (const warning of first.warnings) {
      expect(warning.record.triggerIndicators).toHaveLength(1);
      expect(
        warning.record.evidenceReferences.map((entry) => entry.locator.sourceSegmentId),
      ).toEqual(["segment-geology", "segment-a", "segment-b"]);
    }
  });

  it("每类预警证据是该类型指标证据与评估证据的规范并集", () => {
    const plan = planFor();
    const monitorWarning = plan.warnings.find((warning) => warning.triggerType === "监测指标越限");
    expect(
      monitorWarning?.record.evidenceReferences.map((entry) => entry.locator.sourceSegmentId),
    ).toEqual(["segment-geology", "segment-monitoring"]);
  });

  it("同一风险输入与空间的后续评估版本共用稳定归集键", () => {
    const first = planFor();
    const laterAssessment = c26AssessmentRecord({
      assessmentRecordId: "assessment-record-risk-record-c26",
      triggerIndicators: [c26TriggerIndicator("indicator-consequence-1", "监测指标越限", 8.1)],
    });
    const later = planFor(laterAssessment);
    expect(later.aggregationKey).toEqual(first.aggregationKey);
    expect(later.warnings[0]?.record.assessmentRecordId).toBe("assessment-record-risk-record-c26");
  });

  it("每个预警与接收人只有一条意图且标识可重放", () => {
    const plan = planFor();
    const keys = plan.notificationIntents.map(
      (intent) => `${warningRefKey(intent.warningRef)}${intent.recipientActorId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.notificationIntents).toHaveLength(4 * C26_FIXTURE_RECIPIENTS.length);
    expect(planFor().notificationIntents.map((intent) => intent.notificationIntentRef)).toEqual(
      plan.notificationIntents.map((intent) => intent.notificationIntentRef),
    );
    expect(
      [...new Set(plan.notificationIntents.map((intent) => intent.recipientActorId))].sort(),
    ).toEqual([...C26_FIXTURE_RECIPIENTS].sort());
  });

  it("策略引用与冻结快照不一致时失败闭合", () => {
    const mismatchedPolicy = c26WarningAggregationPolicy({
      policyRef: { entityId: "warning-aggregation-policy-other", versionId: "9" },
    });
    const failure = (() => {
      try {
        planFor(
          c26AssessmentRecord(),
          c26WarningRuntimePolicies({ warningAggregationPolicy: mismatchedPolicy }),
        );
        return undefined;
      } catch (error: unknown) {
        return warningLifecycleFailureFrom(error);
      }
    })();
    expect(failure).toMatchObject({ code: "STALE_VERSION", reasonCode: "policy-mismatch" });

    const foreignProjectPolicy = c26WarningAggregationPolicy({ projectId: "project-other" });
    const projectFailure = (() => {
      try {
        planFor(
          c26AssessmentRecord(),
          c26WarningRuntimePolicies({ warningAggregationPolicy: foreignProjectPolicy }),
        );
        return undefined;
      } catch (error: unknown) {
        return warningLifecycleFailureFrom(error);
      }
    })();
    expect(projectFailure).toMatchObject({ reasonCode: "policy-mismatch" });
  });

  it("策略缺少任一触发类型响应方向时拒绝解析", () => {
    expect(() =>
      c26WarningAggregationPolicy({
        responseDirectionByTriggerType: {
          监测指标越限: "加密监测并复核处置范围",
        } as never,
      }),
    ).toThrow();
  });
});

describe("C26 确认契约", () => {
  it("确认命令与确认事实都不携带风险解除字段", () => {
    const command = c26AcknowledgeWarningCommand();
    expect(WarningResponseRecordCommandV1Schema.parse(command).kind).toBe("acknowledge");
    const withResolution = {
      ...command,
      payload: { ...command.payload, status: "acknowledged", riskLevel: "level-1" },
    };
    expect(WarningResponseRecordCommandV1Schema.safeParse(withResolution).success).toBe(false);

    expect(
      WarningAcknowledgementV1Schema.safeParse({
        schemaVersion: "1",
        projectId: "project-c26-warning",
        warningRecordRef: command.payload.warningRecordRef,
        warningResponseTaskRef: command.payload.warningResponseTaskRef,
        acknowledgedByActorId: "actor-c26-manager",
        acknowledgedAt: "2031-03-04T05:06:07.000Z",
        audit: {
          actorId: "actor-c26-manager",
          action: "warning-response.acknowledge",
          recordedAt: "2031-03-04T05:06:07.000Z",
        },
        riskLevel: "level-1",
      }).success,
    ).toBe(false);
  });

  it("确认不改变预警记录内容", () => {
    const plan = planFor();
    const before = JSON.stringify(plan.warnings[0]?.record);
    const planAgain = planFor();
    expect(JSON.stringify(planAgain.warnings[0]?.record)).toBe(before);
    expect(planAgain.warnings[0]?.record.warningLevel).toBe("level-3");
    expect(planAgain.warnings[0]?.record.notificationStatus).toBe("intent-recorded");
  });
});
