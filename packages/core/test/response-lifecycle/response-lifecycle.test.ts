import { describe, expect, it } from "vitest";

import { AuthorizationContextV1Schema } from "@riskflow/contracts/ports";

import {
  computeResponseDeviation,
  effectForecastRefOf,
  ResponseAdoptionDecisionCommandV1Schema,
  ResponseDeviationFactRefV1Schema,
  ResponseDeviationFactV1Schema,
  ResponseForecastExecutorResultV1Schema,
  ResponseForecastOutcomeV1Schema,
  verifyForecastExecutorResult,
  VerifiedResponseWorkflowBindingV1Schema,
  type ResponseDeviationInputV1,
} from "../../src/response-lifecycle/index.js";

const RISK_LEVEL_ORDINALS = new Map([
  ["level-1", 1],
  ["level-2", 2],
  ["level-3", 3],
  ["level-4", 4],
]);

const deviationInput = (
  overrides: Partial<ResponseDeviationInputV1>,
): ResponseDeviationInputV1 => ({
  basis: "absolute",
  threshold: "2",
  unit: "mm",
  actualUnit: "mm",
  predictedValue: "10",
  actualValue: 12,
  predictedRiskState: { likelihoodScore: 2, consequenceScore: 2, riskLevel: "level-2" },
  actualRiskState: { likelihoodScore: 3, consequenceScore: 3, riskLevel: "level-3" },
  riskLevelOrdinals: RISK_LEVEL_ORDINALS,
  ...overrides,
});

describe("C28 偏差纯计算", () => {
  it.each([
    { actual: 12, threshold: "2", exceeded: false, value: "2", direction: "actual-above" },
    {
      actual: 12.000001,
      threshold: "2",
      exceeded: true,
      value: "2.000001",
      direction: "actual-above",
    },
    // 超过六位小数的差值按 half-away-from-zero 规范化后参与展示与保存。
    { actual: 12.0000001, threshold: "2", exceeded: true, value: "2", direction: "actual-above" },
    { actual: 7, threshold: "2", exceeded: true, value: "3", direction: "actual-below" },
    { actual: 10, threshold: "0", exceeded: false, value: "0", direction: "equal" },
  ])(
    "absolute 按规范十进制比较阈值与方向 $actual",
    ({ actual, threshold, exceeded, value, direction }) => {
      const result = computeResponseDeviation(deviationInput({ actualValue: actual, threshold }));
      expect(result.kind).toBe("computed");
      if (result.kind !== "computed") return;
      expect(result.computation.thresholdExceeded).toBe(exceeded);
      expect(result.computation.direction).toBe(direction);
      expect(result.computation.deviationValue).toBe(value);
      expect(result.computation.basis).toBe("absolute");
    },
  );

  it("absolute 相等阈值视为未超过，实际值等于预测值时方向为 equal", () => {
    const result = computeResponseDeviation(deviationInput({ actualValue: 10, threshold: "0" }));
    expect(result).toEqual({
      kind: "computed",
      computation: {
        basis: "absolute",
        deviationValue: "0",
        deviationValueNumber: 0,
        thresholdExceeded: false,
        direction: "equal",
      },
    });
  });

  it.each([
    { actual: 11, exceeded: false, value: "0.1" },
    { actual: 11.000001, exceeded: true, value: "0.1" },
    { actual: 20, exceeded: true, value: "1" },
    { actual: 10.5, exceeded: false, value: "0.05" },
  ])("relative 用整数交叉乘法判定阈值边界 $actual", ({ actual, exceeded, value }) => {
    const result = computeResponseDeviation(
      deviationInput({
        basis: "relative",
        threshold: "0.1",
        minimumBaseline: "0.01",
        actualValue: actual,
      }),
    );
    expect(result.kind).toBe("computed");
    if (result.kind !== "computed") return;
    expect(result.computation.thresholdExceeded).toBe(exceeded);
    expect(result.computation.deviationValue).toBe(value);
  });

  it("relative 的预测值绝对值小于最小基线时以最小基线为分母", () => {
    const result = computeResponseDeviation(
      deviationInput({
        basis: "relative",
        threshold: "0.1",
        minimumBaseline: "1",
        predictedValue: "0.25",
        actualValue: 1.25,
      }),
    );
    expect(result.kind).toBe("computed");
    if (result.kind !== "computed") return;
    expect(result.computation.deviationValue).toBe("1");
    expect(result.computation.thresholdExceeded).toBe(true);
  });

  it.each([
    { predicted: "3", actual: 1, value: "0.666667" },
    { predicted: "7", actual: 2, value: "0.714286" },
  ])("relative 六位小数按 half-away-from-zero 舍入", ({ predicted, actual, value }) => {
    const result = computeResponseDeviation(
      deviationInput({
        basis: "relative",
        threshold: "10",
        minimumBaseline: "0.01",
        predictedValue: predicted,
        actualValue: actual,
      }),
    );
    expect(result.kind).toBe("computed");
    if (result.kind !== "computed") return;
    expect(result.computation.deviationValue).toBe(value);
  });

  it("relative 的最小基线必须为正，否则类型化不可用", () => {
    const result = computeResponseDeviation(
      deviationInput({
        basis: "relative",
        threshold: "0.1",
        minimumBaseline: "0",
        predictedValue: "0",
        actualValue: 1,
      }),
    );
    expect(result).toEqual({ kind: "unavailable", reasonCode: "basis-incompatible" });
  });

  it.each(["absolute", "relative"] as const)("%s 拒绝负偏差阈值", (basis) => {
    const result = computeResponseDeviation(
      deviationInput({
        basis,
        threshold: "-0.1",
        ...(basis === "relative" ? { minimumBaseline: "0.01" } : {}),
      }),
    );
    expect(result).toEqual({ kind: "unavailable", reasonCode: "basis-incompatible" });
  });

  it.each([
    { actualLevel: "level-4", exceeded: true, value: "2" },
    { actualLevel: "level-3", exceeded: false, value: "1" },
    { actualLevel: "level-2", exceeded: false, value: "0" },
  ])(
    "risk-level-step 只按冻结风险矩阵等级序计步 $actualLevel",
    ({ actualLevel, exceeded, value }) => {
      const result = computeResponseDeviation(
        deviationInput({
          basis: "risk-level-step",
          levelStep: 1,
          predictedValue: "10",
          actualValue: 10,
          actualRiskState: {
            likelihoodScore: 3,
            consequenceScore: 3,
            riskLevel: actualLevel,
          },
        }),
      );
      expect(result.kind).toBe("computed");
      if (result.kind !== "computed") return;
      expect(result.computation.deviationValue).toBe(value);
      expect(result.computation.thresholdExceeded).toBe(exceeded);
    },
  );

  it("等级不在同一冻结风险矩阵时返回不可用，不造替代偏差", () => {
    const result = computeResponseDeviation(
      deviationInput({
        basis: "risk-level-step",
        levelStep: 1,
        actualRiskState: {
          likelihoodScore: 3,
          consequenceScore: 3,
          riskLevel: "level-9",
        },
      }),
    );
    expect(result).toEqual({ kind: "unavailable", reasonCode: "risk-level-ordinal-missing" });
  });

  it.each([
    { overrides: { actualUnit: "m" }, reasonCode: "unit-mismatch" },
    { overrides: { predictedValue: "not-a-decimal" }, reasonCode: "value-not-numeric" },
    { overrides: { actualValue: Number.NaN }, reasonCode: "value-not-numeric" },
    {
      overrides: { basis: "relative" as const, threshold: undefined },
      reasonCode: "basis-incompatible",
    },
  ])("比较口径不一致时不产生偏差事实 $reasonCode", ({ overrides, reasonCode }) => {
    const result = computeResponseDeviation(deviationInput(overrides));
    expect(result).toEqual({ kind: "unavailable", reasonCode });
  });

  it("同一冻结输入重复计算结果一致", () => {
    const input = deviationInput({ actualValue: 11.25 });
    expect(computeResponseDeviation(input)).toEqual(computeResponseDeviation(input));
  });
});

describe("C28 执行器结果复验", () => {
  const request = {
    method: "historical-statistics",
    requiredRef: { entityId: "forecast-statistics-model", versionId: "1" },
    targetIndicatorId: "indicator-consequence-1",
    unit: "mm",
    horizonSteps: 5,
    riskLevelIds: ["level-1", "level-2", "level-3", "level-4"],
  };
  const result = {
    method: "historical-statistics" as const,
    requiredRef: { entityId: "forecast-statistics-model", versionId: "1" },
    targetIndicatorId: "indicator-consequence-1",
    unit: "mm",
    horizonSteps: 5,
    predictedValue: "8.5",
    predictedRiskState: { likelihoodScore: 2, consequenceScore: 2, riskLevel: "level-2" },
    evidenceReferences: [
      {
        locator: { sourceSegmentId: "segment-1" },
        sourceVersion: { entityId: "source-version-1", versionId: "1" },
      },
    ],
    summary: "synthetic-statistics",
  };

  it("完整回显时产生可用执行结果", () => {
    const execution = verifyForecastExecutorResult({ ...request, result });
    expect(execution.kind).toBe("executed");
  });

  it.each([
    { patch: { method: "monitoring-trend" }, reasonCode: "method-mismatch" },
    { patch: { method: "unknown-method" }, reasonCode: "result-unreadable" },
    {
      patch: { requiredRef: { entityId: "forecast-trend-model", versionId: "1" } },
      reasonCode: "required-ref-mismatch",
    },
    {
      patch: { targetIndicatorId: "indicator-possibility-1" },
      reasonCode: "target-indicator-mismatch",
    },
    { patch: { unit: "m" }, reasonCode: "unit-mismatch" },
    { patch: { horizonSteps: 4 }, reasonCode: "horizon-mismatch" },
    { patch: { predictedValue: "Infinity" }, reasonCode: "result-unreadable" },
    { patch: { predictedValue: "not-a-decimal" }, reasonCode: "result-unreadable" },
    {
      patch: {
        predictedRiskState: { likelihoodScore: 2, consequenceScore: 2, riskLevel: "level-9" },
      },
      reasonCode: "risk-state-invalid",
    },
    { patch: { evidenceReferences: [] }, reasonCode: "result-unreadable" },
    { patch: { summary: " " }, reasonCode: "result-unreadable" },
    { patch: { extra: "unknown-field" }, reasonCode: "result-unreadable" },
  ])("执行器结果不合法时失败闭合 $reasonCode", ({ patch, reasonCode }) => {
    const execution = verifyForecastExecutorResult({
      ...request,
      result: { ...result, ...patch },
    });
    expect(execution).toEqual({ kind: "invalid", reasonCode });
  });

  it("执行器结果 Schema 拒绝非有限预测值与未知字段", () => {
    expect(
      ResponseForecastExecutorResultV1Schema.safeParse({ ...result, predictedValue: 1.5 }).success,
    ).toBe(false);
    expect(
      ResponseForecastExecutorResultV1Schema.safeParse({ ...result, extra: true }).success,
    ).toBe(false);
  });
});

describe("C28 私有 Schema 与稳定引用", () => {
  it("workflow binding 缺少路由决定或运行引用时拒绝", () => {
    const binding = {
      schemaVersion: "1",
      projectId: "project-c28",
      responseRecommendationRef: {
        kind: "response-recommendation",
        reference: { entityId: "recommendation-1", versionId: "1" },
      },
      spatialScopeRef: {
        kind: "spatial-scope",
        reference: { entityId: "scope-1", versionId: "1" },
      },
      routeDecisionRef: {
        kind: "route-decision",
        reference: { entityId: "route-decision-1", versionId: "1" },
      },
      forecastRunRef: {
        kind: "workflow-run",
        reference: { entityId: "forecast-run-1", versionId: "1" },
      },
      boundAt: "2029-12-31T22:00:00.000Z",
    };
    expect(VerifiedResponseWorkflowBindingV1Schema.safeParse(binding).success).toBe(true);
    expect(
      VerifiedResponseWorkflowBindingV1Schema.safeParse({ ...binding, routeDecisionRef: undefined })
        .success,
    ).toBe(false);
    expect(
      VerifiedResponseWorkflowBindingV1Schema.safeParse({ ...binding, forecastRunRef: {} }).success,
    ).toBe(false);
  });

  it("采纳决定命令只接受 adopt-recommendation 分支", () => {
    const authorization = AuthorizationContextV1Schema.parse({
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "authorization-c28", versionId: "1" },
      },
      actorId: "actor-c28",
      projectId: "project-c28",
      grantedCapabilities: ["warning-response.record"],
      spatialScopeRefs: [
        { kind: "spatial-scope", reference: { entityId: "scope-1", versionId: "1" } },
      ],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: "2029-12-31T22:00:00.000Z",
      invocation: { kind: "human" },
    });
    const binding = {
      schemaVersion: "1",
      projectId: "project-c28",
      responseRecommendationRef: {
        kind: "response-recommendation",
        reference: { entityId: "recommendation-1", versionId: "1" },
      },
      spatialScopeRef: {
        kind: "spatial-scope",
        reference: { entityId: "scope-1", versionId: "1" },
      },
      routeDecisionRef: {
        kind: "route-decision",
        reference: { entityId: "route-decision-1", versionId: "1" },
      },
      forecastRunRef: {
        kind: "workflow-run",
        reference: { entityId: "forecast-run-1", versionId: "1" },
      },
      boundAt: "2029-12-31T22:00:00.000Z",
    };
    const envelope = {
      commandId: "c28-decision-1",
      idempotencyKey: "c28-decision-1",
      projectId: "project-c28",
      actorId: "actor-c28",
      issuedAt: "2029-12-31T22:00:00.000Z",
      authorization,
    };
    expect(
      ResponseAdoptionDecisionCommandV1Schema.safeParse({
        schemaVersion: "1",
        binding,
        command: {
          ...envelope,
          kind: "adopt-recommendation",
          payload: {
            responseRecommendationRef: binding.responseRecommendationRef,
            decision: "adopted",
            reasonCode: "field-verified",
          },
        },
      }).success,
    ).toBe(true);
    expect(
      ResponseAdoptionDecisionCommandV1Schema.safeParse({
        schemaVersion: "1",
        binding,
        command: {
          ...envelope,
          kind: "record-feedback",
          payload: {
            executionRecordRef: {
              kind: "execution-record",
              reference: { entityId: "execution-1", versionId: "1" },
            },
            postActionMonitoringSnapshotRef: {
              kind: "monitoring-snapshot",
              reference: { entityId: "snapshot-1", versionId: "1" },
            },
            feedbackArtifactRef: {
              kind: "content-artifact",
              reference: { entityId: "artifact-1", versionId: "1" },
            },
            occurredAt: "2029-12-31T22:00:00.000Z",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("可用预测必须携带可用正文，不可用预测不得携带预测值", () => {
    const base = {
      schemaVersion: "1",
      projectId: "project-c28",
      effectForecastRef: effectForecastRefOf("a".repeat(64)),
      responseRecommendationRef: {
        kind: "response-recommendation",
        reference: { entityId: "recommendation-1", versionId: "1" },
      },
      routeDecisionRef: {
        kind: "route-decision",
        reference: { entityId: "route-decision-1", versionId: "1" },
      },
      forecastRunRef: {
        kind: "workflow-run",
        reference: { entityId: "forecast-run-1", versionId: "1" },
      },
      forecastInputSnapshotRef: {
        kind: "response-forecast-input-snapshot",
        reference: { entityId: "forecast-input-1", versionId: "1" },
      },
      frozenAssessmentBasisRef: {
        kind: "assessment-input-snapshot",
        reference: { entityId: "input-snapshot-1", versionId: "1" },
      },
      preActionMonitoringSnapshotRef: {
        kind: "monitoring-snapshot",
        reference: { entityId: "snapshot-1", versionId: "1" },
      },
      baselineAssessmentRecordRef: {
        kind: "risk-assessment-record",
        reference: { entityId: "assessment-1", versionId: "1" },
      },
      forecastPolicyRef: { entityId: "release-forecast-policy", versionId: "1" },
      requiredRef: { entityId: "forecast-statistics-model", versionId: "1" },
      method: "historical-statistics" as const,
      targetIndicatorId: "indicator-consequence-1",
      unit: "mm",
      horizonSteps: 5,
      inputDigest: "b".repeat(64),
      spatialScopeRef: {
        kind: "spatial-scope",
        reference: { entityId: "scope-1", versionId: "1" },
      },
      computedBy: "actor-c28",
      computedAt: "2029-12-31T22:00:00.000Z",
    };
    const projection = {
      kind: "available" as const,
      predictedValue: "8.5",
      predictedRiskState: { likelihoodScore: 2, consequenceScore: 2, riskLevel: "level-2" },
      evidenceReferences: [
        {
          locator: { sourceSegmentId: "segment-1" },
          sourceVersion: { entityId: "source-version-1", versionId: "1" },
        },
      ],
      summary: "synthetic-statistics",
    };
    expect(
      ResponseForecastOutcomeV1Schema.safeParse({
        ...base,
        availability: { kind: "available", effectForecastRef: base.effectForecastRef },
        projected: projection,
      }).success,
    ).toBe(true);
    expect(
      ResponseForecastOutcomeV1Schema.safeParse({
        ...base,
        availability: { kind: "unavailable", reasonCode: "executor-unavailable" },
        projected: projection,
      }).success,
    ).toBe(false);
    expect(
      ResponseForecastOutcomeV1Schema.safeParse({
        ...base,
        availability: { kind: "unavailable", reasonCode: "executor-unavailable" },
        projected: { kind: "unavailable", reasonCode: "executor-unavailable" },
      }).success,
    ).toBe(true);
  });

  it("私有偏差事实不含校准建议或审核状态，引用身份稳定", () => {
    const fact = ResponseDeviationFactV1Schema.parse({
      schemaVersion: "1",
      projectId: "project-c28",
      deviationFactRef: ResponseDeviationFactRefV1Schema.parse({
        kind: "response-deviation-fact",
        reference: { entityId: "response-deviation-1", versionId: "1" },
      }),
      responseRecommendationRef: {
        kind: "response-recommendation",
        reference: { entityId: "recommendation-1", versionId: "1" },
      },
      executionRecordRef: {
        kind: "execution-record",
        reference: { entityId: "execution-1", versionId: "1" },
      },
      effectForecastRef: effectForecastRefOf("c".repeat(64)),
      feedbackRef: { kind: "feedback", reference: { entityId: "feedback-1", versionId: "1" } },
      frozenAssessmentBasisRef: {
        kind: "assessment-input-snapshot",
        reference: { entityId: "input-snapshot-1", versionId: "1" },
      },
      deviationPolicyRef: { entityId: "release-deviation-policy", versionId: "1" },
      basis: "absolute",
      riskMatrixRef: { entityId: "release-risk-matrix", versionId: "1" },
      targetIndicatorId: "indicator-consequence-1",
      unit: "mm",
      predictedValue: "8.5",
      actualValue: "10.5",
      deviationValue: "2",
      deviationValueNumber: 2,
      thresholdExceeded: true,
      direction: "actual-above",
      predictedRiskState: { likelihoodScore: 2, consequenceScore: 2, riskLevel: "level-2" },
      actualRiskState: { likelihoodScore: 3, consequenceScore: 3, riskLevel: "level-3" },
      evidenceReferences: [
        {
          locator: { sourceSegmentId: "segment-1" },
          sourceVersion: { entityId: "source-version-1", versionId: "1" },
        },
      ],
      summary: "absolute:2",
      spatialScopeRef: {
        kind: "spatial-scope",
        reference: { entityId: "scope-1", versionId: "1" },
      },
      computedAt: "2029-12-31T22:00:00.000Z",
    });
    expect(Object.keys(fact)).not.toContain("calibrationRecommendation");
    expect(Object.keys(fact)).not.toContain("reviewStatus");
    expect(
      ResponseDeviationFactV1Schema.safeParse({ ...fact, calibrationRecommendation: "x" }).success,
    ).toBe(false);
    expect(effectForecastRefOf("c".repeat(64))).toEqual(effectForecastRefOf("c".repeat(64)));
  });
});
