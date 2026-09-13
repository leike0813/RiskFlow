import { describe, expect, it } from "vitest";

import { evaluateScoringRule, type StructuredScoringRule } from "../../src/scoring-rules/index.js";
import type { AssessmentConfigurationContentV1 } from "../../src/assessment-config/index.js";
import { parseCanonicalDecimal } from "../../src/assessment-config/index.js";
import {
  evaluateDeterministicAssessment,
  mapAssessmentRiskLevel,
  materializeIndicatorActualValues,
  riskAssessmentFailureFrom,
  type AssessmentEngineContextV1,
  type RiskAssessmentReasonCodeV1,
} from "../../src/risk-assessment/engine/index.js";
import {
  C25_FIXTURE_APPLICABILITY,
  C25_FIXTURE_RECORD_AUDIT,
  c25Configuration,
  c25ConfigurationContent,
  c25Facts,
  c25Monitoring,
  c25RuleDocument,
  c25Version,
  makeRiskAssessmentEngineContext,
  type RiskAssessmentFixtureOverridesV1,
  type ScoringRuleFixtureV1,
} from "./fixture.js";

const p1Rule = (score: number): ScoringRuleFixtureV1 => ({
  indicatorId: "indicator-possibility-1",
  ruleId: "rule-possibility-1",
  thresholds: [
    { thresholdId: "p1-low", operator: "lt", value: 3, score },
    { thresholdId: "p1-high", operator: "gte", value: 3, score },
  ],
  grades: [
    { grade: "p1-grade-low", upperBound: 3 },
    { grade: "p1-grade-high", lowerBound: 3 },
  ],
});

const p2Rule = (
  score: number,
  thresholds?: ScoringRuleFixtureV1["thresholds"],
): ScoringRuleFixtureV1 => ({
  indicatorId: "indicator-possibility-2",
  ruleId: "rule-possibility-2",
  thresholds: thresholds ?? [
    { thresholdId: "p2-low", operator: "lt", value: 2, score: 1 },
    { thresholdId: "p2-mid", operator: "between", value: 2, upperValue: 5, score: 3 },
    { thresholdId: "p2-high", operator: "gte", value: 5, score: 5 },
  ],
  grades:
    thresholds === undefined
      ? [
          { grade: "p2-grade-low", upperBound: 2 },
          { grade: "p2-grade-mid", lowerBound: 2, upperBound: 5 },
          { grade: "p2-grade-high", lowerBound: 5 },
        ]
      : [
          { grade: "p2-grade-low", upperBound: 0 },
          { grade: "p2-grade-high", lowerBound: 0 },
        ],
});

const c1Rule = (
  score: number,
  thresholds?: ScoringRuleFixtureV1["thresholds"],
): ScoringRuleFixtureV1 => ({
  indicatorId: "indicator-consequence-1",
  ruleId: "rule-consequence-1",
  thresholds: thresholds ?? [
    { thresholdId: "c1-low", operator: "lt", value: 10, score: 1 },
    { thresholdId: "c1-mid", operator: "between", value: 10, upperValue: 40, score: 3 },
    { thresholdId: "c1-high", operator: "gte", value: 40, score: 5 },
  ],
  grades:
    thresholds === undefined
      ? [
          { grade: "c1-grade-low", upperBound: 10 },
          { grade: "c1-grade-mid", lowerBound: 10, upperBound: 40 },
          { grade: "c1-grade-high", lowerBound: 40 },
        ]
      : [
          { grade: "c1-grade-low", upperBound: 0 },
          { grade: "c1-grade-high", lowerBound: 0 },
        ],
});

interface ConfigurationOverridesV1 {
  readonly maximumAcceptedLevelId?: string;
  readonly thresholds?: readonly unknown[];
  readonly jointRules?: readonly unknown[];
  readonly mappings?: readonly unknown[];
  readonly possibilityWeights?: readonly {
    readonly indicatorId: string;
    readonly basisPoints: number;
  }[];
  readonly possibilityStrategy?: unknown;
  readonly consequenceStrategy?: unknown;
}

const configurationWith = (
  overrides: ConfigurationOverridesV1 = {},
): AssessmentEngineContextV1["configuration"] => {
  const base = c25Configuration();
  return {
    indicatorSystem: base.indicatorSystem,
    fieldMapping:
      overrides.mappings === undefined
        ? base.fieldMapping
        : c25ConfigurationContent("indicator-field-mapping", { mappings: overrides.mappings }),
    weightSet:
      overrides.possibilityWeights === undefined
        ? base.weightSet
        : c25ConfigurationContent("weight-set", {
            weightSetId: "weight-set-synthetic",
            weightSetVersion: "1",
            sourceRef: c25Version("weight-source-synthetic"),
            possibilityWeights: overrides.possibilityWeights,
            consequenceWeights: [{ indicatorId: "indicator-consequence-1", basisPoints: 10_000 }],
          }),
    scoringStrategy:
      overrides.possibilityStrategy === undefined && overrides.consequenceStrategy === undefined
        ? base.scoringStrategy
        : c25ConfigurationContent("scoring-strategy", {
            possibility:
              overrides.possibilityStrategy ??
              (overrides.possibilityWeights === undefined
                ? base.scoringStrategy.possibility
                : {
                    kind: "weighted-average",
                    weightSetRef: c25Version("weight-set-synthetic"),
                    rounding: { mode: "half-away-from-zero", decimalScale: 2 },
                  }),
            consequence: overrides.consequenceStrategy ?? base.scoringStrategy.consequence,
          }),
    riskMatrix: base.riskMatrix,
    riskAcceptanceThreshold:
      overrides.maximumAcceptedLevelId === undefined
        ? base.riskAcceptanceThreshold
        : c25ConfigurationContent("risk-acceptance-threshold", {
            riskMatrixRef: c25Version("risk-matrix-synthetic"),
            thresholds: [
              {
                thresholdId: "acceptance-default",
                applicabilityConditions: [{ dimension: "工程阶段数据", values: ["掘进"] }],
                maximumAcceptedLevelId: overrides.maximumAcceptedLevelId,
              },
            ],
          }),
    monitoringWarningThreshold:
      overrides.thresholds === undefined
        ? base.monitoringWarningThreshold
        : c25ConfigurationContent("monitoring-warning-threshold", {
            riskMatrixRef: c25Version("risk-matrix-synthetic"),
            thresholds: overrides.thresholds,
          }),
    jointTriggerPolicy:
      overrides.jointRules === undefined
        ? base.jointTriggerPolicy
        : c25ConfigurationContent("joint-trigger-policy", { rules: overrides.jointRules }),
  };
};

const contextWith = (overrides: RiskAssessmentFixtureOverridesV1 = {}): AssessmentEngineContextV1 =>
  makeRiskAssessmentEngineContext(overrides);

/** 评估调用审计：核心测试固定使用夹具主体与记录时间。 */
const evaluateWithFixtureAudit = (context: AssessmentEngineContextV1) =>
  evaluateDeterministicAssessment(context, C25_FIXTURE_RECORD_AUDIT);

const expectFailure = (run: () => unknown, reasonCode: RiskAssessmentReasonCodeV1): void => {
  let failure: ReturnType<typeof riskAssessmentFailureFrom> = undefined;
  try {
    run();
  } catch (error) {
    failure = riskAssessmentFailureFrom(error);
  }
  expect(failure?.reasonCode).toBe(reasonCode);
};

const triggersFor = (
  threshold: {
    readonly operator: "gt" | "gte" | "lt" | "lte" | "outside";
    readonly boundary?: string;
    readonly lower?: string;
    readonly upper?: string;
  },
  monitoring = c25Monitoring({ settlementPoint: 6 }),
): readonly string[] => {
  const base = c25Configuration();
  const thresholds = base.monitoringWarningThreshold.thresholds.map((candidate) =>
    candidate.thresholdId === "threshold-settlement-value"
      ? {
          ...candidate,
          comparison:
            threshold.operator === "outside"
              ? { operator: "outside", lower: threshold.lower!, upper: threshold.upper! }
              : { operator: threshold.operator, boundary: threshold.boundary! },
        }
      : candidate,
  );
  return evaluateWithFixtureAudit(
    contextWith({
      configuration: configurationWith({ thresholds }),
      monitoring,
    }),
  )
    .decision.triggers.filter((trigger) => trigger.identity === "threshold-settlement-value")
    .map((trigger) => trigger.identity);
};

describe("C25 指标取值、评分与触发总链", () => {
  it("完整评估：全量取值、P/C、矩阵与四类触发同时命中", () => {
    const result = evaluateWithFixtureAudit(
      contextWith({ configuration: configurationWith({ maximumAcceptedLevelId: "level-1" }) }),
    );

    expect(result.valueSet.values.map((value) => value.indicatorId)).toEqual([
      "indicator-consequence-1",
      "indicator-possibility-1",
      "indicator-possibility-2",
    ]);
    expect(
      result.valueSet.values.find((value) => value.indicatorId === "indicator-consequence-1"),
    ).toMatchObject({
      valueKind: "numeric",
      actualValue: 30,
      canonicalUnit: "mm",
      source: { kind: "monitoring-feature", featureType: "short-term-slope" },
    });
    expect(
      result.valueSet.values.find((value) => value.indicatorId === "indicator-possibility-2"),
    ).toMatchObject({ actualValue: 0.03, rawValue: 30 });

    expect(result.decision.axisScores.possibility).toMatchObject({
      kind: "weighted-average",
      score: "1.4",
      publicScore: 1.4,
    });
    expect(result.decision.axisScores.consequence).toMatchObject({ kind: "maximum", score: "3" });
    expect(result.decision.matrix).toMatchObject({
      possibilityBandId: "p-band-2",
      consequenceBandId: "c-band-1",
      riskLevelId: "level-2",
      riskLevelOrdinal: 2,
    });
    expect(
      [...new Set(result.decision.triggers.map((trigger) => trigger.triggerType))].sort(),
    ).toEqual([
      "多指标联合规则命中",
      "监测指标越限",
      "趋势/加速度/异常评分越限",
      "风险等级超过风险可接受阈值",
    ]);
    expect(result.record.riskLevel).toBe("level-2");
    expect(result.record.riskRecordId).toBe("risk-record-c25");
    expect(result.record.indicatorResults).toHaveLength(3);
    expect(result.record.likelihoodScore).toBe(1.4);
    expect(result.record.consequenceScore).toBe(3);
    expect(result.record.triggerIndicators).toHaveLength(result.decision.triggers.length);
    expect(new Set(result.record.triggerIndicators.map((item) => item.indicatorItem)).size).toBe(
      result.record.triggerIndicators.length,
    );
  });

  it("不满足触发时保留完整评估且触发集合为空", () => {
    const result = evaluateWithFixtureAudit(
      contextWith({
        configuration: configurationWith({ maximumAcceptedLevelId: "level-4" }),
        monitoring: c25Monitoring({
          settlementPoint: 1,
          settlementSlope: 0.1,
          waterLevelAnomaly: 1,
          cutterFrequency: 40,
        }),
      }),
    );
    expect(result.decision.triggers).toEqual([]);
    expect(result.record.triggerIndicators).toEqual([]);
    expect(result.record.indicatorResults).toHaveLength(3);
  });

  it("XOR：外部风险事件分支只写 externalRiskEventId", () => {
    const result = evaluateWithFixtureAudit(
      contextWith({
        facts: c25Facts({
          riskInput: {
            kind: "external-risk-event",
            reference: { entityId: "event-c25", versionId: "1" },
          },
        }),
      }),
    );
    expect(result.record).toMatchObject({ externalRiskEventId: "event-c25" });
    expect("riskRecordId" in result.record).toBe(false);
  });

  it("缺值与映射歧义不被忽略或补齐", () => {
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({ facts: c25Facts({ fields: [c25Facts().fields[0]!] }) }),
        ),
      "risk-assessment-indicator-missing",
    );
    const base = c25Configuration();
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            configuration: configurationWith({
              mappings: [
                {
                  mappingId: "mapping-consequence-duplicate",
                  targetIndicatorId: "indicator-consequence-1",
                  origin: {
                    kind: "source-field",
                    documentType: "geology-report",
                    fieldPath: ["strata", "layer", "gradeIndex"],
                  },
                  sourceUnit: "1",
                  targetUnit: "mm",
                  conversion: { kind: "affine", scale: 1, offset: 0 },
                },
                ...base.fieldMapping.mappings,
              ],
            }),
          }),
        ),
      "risk-assessment-indicator-ambiguous",
    );
  });

  it("单位冲突与类型不符取值不产生部分结果", () => {
    const base = c25Configuration();
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            configuration: configurationWith({
              mappings: base.fieldMapping.mappings.map((mapping) =>
                mapping.mappingId === "mapping-consequence-slope"
                  ? { ...mapping, sourceUnit: "cm/s" }
                  : mapping,
              ),
            }),
          }),
        ),
      "risk-assessment-unit-conflict",
    );

    const facts = c25Facts();
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            facts: c25Facts({
              fields: [{ ...facts.fields[0]!, value: "grade-a" }, facts.fields[1]!],
            }),
          }),
        ),
      "risk-assessment-input-invalid",
    );
  });

  it("所需监测序列覆盖不完整、cutoff 缺值与序列身份不符都关闭失败", () => {
    const withoutSettlement = c25Monitoring({ omitSettlementSnapshot: true });
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            monitoring: withoutSettlement,
            preparation: {
              monitoringSnapshotRefs: withoutSettlement.map(
                (input) => input.snapshot.monitoringSnapshotRef,
              ),
            },
          }),
        ),
      "risk-assessment-monitoring-snapshot-coverage",
    );
    expectFailure(
      () => materializeIndicatorActualValues(contextWith({ monitoring: withoutSettlement })),
      "risk-assessment-snapshot-incomplete",
    );

    const monitoring = c25Monitoring();
    const settlement = monitoring[0]!;
    expectFailure(
      () =>
        evaluateWithFixtureAudit(
          contextWith({
            monitoring: [
              { ...settlement, snapshot: { ...settlement.snapshot, alignedPoints: [] } },
              ...monitoring.slice(1),
            ],
          }),
        ),
      "risk-assessment-series-unavailable",
    );

    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            monitoring: [
              {
                ...settlement,
                seriesRevision: {
                  ...settlement.seriesRevision,
                  monitoringSeriesRef: {
                    kind: "monitoring-series",
                    reference: { entityId: "other-series", versionId: "1" },
                  },
                },
              },
              ...monitoring.slice(1),
            ],
          }),
        ),
      "risk-assessment-series-unavailable",
    );
  });

  it("快照证据缺失整体失败", () => {
    const monitoring = c25Monitoring();
    const settlement = monitoring[0]!;
    expectFailure(
      () =>
        materializeIndicatorActualValues(
          contextWith({
            monitoring: [
              { ...settlement, snapshot: { ...settlement.snapshot, evidenceReferences: [] } },
              ...monitoring.slice(1),
            ],
          }),
        ),
      "risk-assessment-snapshot-incomplete",
    );
  });
});

describe("C25 规则边界与 P/C", () => {
  const possibilityRule = (): StructuredScoringRule => c25RuleDocument(p2Rule(0)).members[0]!.rule;

  it("端点与无穷边界与 C19 纯 helper 一致", () => {
    const rule = possibilityRule();
    const expected: readonly {
      readonly value: number;
      readonly score: number;
      readonly grade: string;
    }[] = [
      { value: 1.999, score: 1, grade: "p2-grade-low" },
      { value: 2, score: 3, grade: "p2-grade-mid" },
      { value: 4.999, score: 3, grade: "p2-grade-mid" },
      { value: 5, score: 5, grade: "p2-grade-high" },
      { value: 400, score: 5, grade: "p2-grade-high" },
    ];
    for (const testCase of expected) {
      const helper = evaluateScoringRule(rule, testCase.value);
      expect(helper.kind).toBe("evaluated");
      if (helper.kind === "evaluated") {
        expect({ score: helper.score, grade: helper.grade }).toEqual({
          score: testCase.score,
          grade: testCase.grade,
        });
      }
    }
  });

  it("规则区间外与规则覆盖不完整都不产生 P/C", () => {
    expectFailure(
      () =>
        evaluateWithFixtureAudit(
          contextWith({
            rules: [
              p1Rule(2),
              p2Rule(1),
              {
                indicatorId: "indicator-consequence-1",
                ruleId: "rule-consequence-1",
                thresholds: [
                  { thresholdId: "c-bounded-low", operator: "lt", value: 10, score: 1 },
                  {
                    thresholdId: "c-bounded-mid",
                    operator: "between",
                    value: 10,
                    upperValue: 20,
                    score: 3,
                  },
                ],
                grades: [
                  { grade: "c-bounded-a", upperBound: 10 },
                  { grade: "c-bounded-b", lowerBound: 10, upperBound: 20 },
                ],
              },
            ],
          }),
        ),
      "risk-assessment-rule-coverage",
    );

    expectFailure(
      () => evaluateWithFixtureAudit(contextWith({ rules: [p1Rule(2)] })),
      "risk-assessment-rule-coverage",
    );
  });

  it("正负半单位边界都按 half-away-from-zero 收口", () => {
    const evenWeights = [
      { indicatorId: "indicator-possibility-1", basisPoints: 5000 },
      { indicatorId: "indicator-possibility-2", basisPoints: 5000 },
    ];
    const zeroScale = {
      kind: "weighted-average",
      weightSetRef: c25Version("weight-set-synthetic"),
      rounding: { mode: "half-away-from-zero", decimalScale: 0 },
    };
    const configuration = (): AssessmentEngineContextV1["configuration"] => {
      const base = configurationWith({
        possibilityWeights: evenWeights,
        possibilityStrategy: zeroScale,
      });
      const matrix = c25ConfigurationContent("risk-matrix", {
        matrixId: "risk-matrix-synthetic",
        matrixVersion: "1",
        possibilityAxis: {
          bands: [
            { bandId: "p-band-1", lower: "-5", upper: "1" },
            { bandId: "p-band-2", lower: "1", upper: "2" },
            { bandId: "p-band-3", lower: "2", upper: "5" },
          ],
        },
        consequenceAxis: base.riskMatrix.consequenceAxis,
        riskLevels: base.riskMatrix.riskLevels,
        cells: base.riskMatrix.cells,
      });
      return { ...base, riskMatrix: matrix };
    };
    const positive = evaluateWithFixtureAudit(
      contextWith({
        rules: [
          p1Rule(2),
          p2Rule(1, [{ thresholdId: "p2-single", operator: "gte", value: 0, score: 1 }]),
          c1Rule(3),
        ],
        configuration: configuration(),
      }),
    );
    expect(positive.decision.axisScores.possibility.score).toBe("2");

    const negative = evaluateWithFixtureAudit(
      contextWith({
        rules: [
          p1Rule(-2),
          p2Rule(-1, [{ thresholdId: "p2-single", operator: "gte", value: 0, score: -1 }]),
          c1Rule(3),
        ],
        configuration: configuration(),
      }),
    );
    expect(negative.decision.axisScores.possibility.score).toBe("-2");
    expect(negative.decision.matrix.possibilityBandId).toBe("p-band-1");
  });

  it("maximum 与输入顺序无关且不读取权重", () => {
    const rules = [
      p1Rule(2),
      p2Rule(1, [{ thresholdId: "p2-single", operator: "gte", value: 0, score: 1 }]),
      c1Rule(3),
    ];
    const context = contextWith({ rules });
    const first = evaluateWithFixtureAudit(context);
    const reordered = evaluateWithFixtureAudit({
      ...context,
      rules: [...context.rules].reverse(),
      monitoring: [...context.monitoring].reverse(),
      facts: { ...context.facts, fields: [...context.facts.fields].reverse() },
    });
    expect(first.decision.axisScores.consequence).toMatchObject({ kind: "maximum", score: "3" });
    expect(
      first.decision.axisScores.consequence.contributions.every(
        (item) => item.basisPoints === undefined,
      ),
    ).toBe(true);
    expect(reordered.decisionDigest).toBe(first.decisionDigest);
    expect(reordered.recordRef.reference.entityId).toBe(first.recordRef.reference.entityId);
  });

  it("maximum 超过六位小数的分值仍按同一规范尺度映射矩阵", () => {
    const result = evaluateWithFixtureAudit(
      contextWith({
        rules: [
          p1Rule(2),
          p2Rule(0, [{ thresholdId: "p2-zero", operator: "gte", value: 0, score: 0 }]),
          c1Rule(0.3333333, [
            { thresholdId: "c1-long", operator: "gte", value: 0, score: 0.3333333 },
          ]),
        ],
      }),
    );
    expect(result.decision.axisScores.consequence.score).toBe("0.3333333");
    expect(result.decision.matrix.consequenceBandId).toBe("c-band-1");
    expect(result.record.consequenceScore).toBe(0.3333333);
  });
});

describe("C25 矩阵边界", () => {
  const scaledContext = (
    possibilityScore: number,
    consequenceScore: number,
  ): AssessmentEngineContextV1 =>
    contextWith({
      rules: [
        p1Rule(possibilityScore),
        p2Rule(0, [{ thresholdId: "p2-zero", operator: "gte", value: 0, score: 0 }]),
        c1Rule(consequenceScore, [
          { thresholdId: "c1-single", operator: "gte", value: 0, score: consequenceScore },
        ]),
      ],
      configuration: configurationWith({
        possibilityWeights: [
          { indicatorId: "indicator-possibility-1", basisPoints: 10_000 },
          { indicatorId: "indicator-possibility-2", basisPoints: 0 },
        ],
      }),
    });

  it("共享边界进入后一带、末带上界闭合、越界失败", () => {
    const context = scaledContext(1, 3);
    expect(
      mapAssessmentRiskLevel(context, parseCanonicalDecimal("0"), parseCanonicalDecimal("3")),
    ).toMatchObject({ possibilityBandId: "p-band-1" });
    expect(
      mapAssessmentRiskLevel(context, parseCanonicalDecimal("1"), parseCanonicalDecimal("3")),
    ).toMatchObject({ possibilityBandId: "p-band-2" });
    expect(
      mapAssessmentRiskLevel(context, parseCanonicalDecimal("5"), parseCanonicalDecimal("100")),
    ).toMatchObject({
      possibilityBandId: "p-band-3",
      consequenceBandId: "c-band-2",
      riskLevelId: "level-4",
    });
    expect(
      mapAssessmentRiskLevel(
        context,
        parseCanonicalDecimal("4.999999"),
        parseCanonicalDecimal("9.999999"),
      ),
    ).toMatchObject({ possibilityBandId: "p-band-3", consequenceBandId: "c-band-1" });
    expectFailure(
      () =>
        mapAssessmentRiskLevel(context, parseCanonicalDecimal("5.5"), parseCanonicalDecimal("3")),
      "risk-assessment-matrix-out-of-range",
    );
    expectFailure(
      () =>
        mapAssessmentRiskLevel(context, parseCanonicalDecimal("2"), parseCanonicalDecimal("100.5")),
      "risk-assessment-matrix-out-of-range",
    );
  });

  it("越界 P/C 使整次评估失败且不保存等级", () => {
    expectFailure(
      () => evaluateWithFixtureAudit(scaledContext(6, 3)),
      "risk-assessment-matrix-out-of-range",
    );
  });
});

describe("C25 触发运算符与适用性", () => {
  it("gt/gte/lt/lte/outside 的等号边界精确", () => {
    expect(triggersFor({ operator: "gte", boundary: "6" })).toEqual(["threshold-settlement-value"]);
    expect(triggersFor({ operator: "gt", boundary: "6" })).toEqual([]);
    expect(triggersFor({ operator: "lt", boundary: "7" })).toEqual(["threshold-settlement-value"]);
    expect(triggersFor({ operator: "lte", boundary: "6" })).toEqual(["threshold-settlement-value"]);
    expect(triggersFor({ operator: "outside", lower: "6", upper: "10" })).toEqual([]);
    expect(triggersFor({ operator: "outside", lower: "6.1", upper: "10" })).toEqual([
      "threshold-settlement-value",
    ]);
  });

  it("阈值适用性不唯一时失败而不猜测优先级", () => {
    const base = c25Configuration();
    const context = contextWith({
      configuration: {
        ...base,
        riskAcceptanceThreshold: c25ConfigurationContent("risk-acceptance-threshold", {
          riskMatrixRef: c25Version("risk-matrix-synthetic"),
          thresholds: [
            {
              thresholdId: "acceptance-a",
              applicabilityConditions: [{ dimension: "工程阶段数据", values: ["掘进"] }],
              maximumAcceptedLevelId: "level-2",
            },
            {
              thresholdId: "acceptance-b",
              applicabilityConditions: [],
              maximumAcceptedLevelId: "level-3",
            },
          ],
        }),
      },
    });
    expect(materializeIndicatorActualValues(context).values).toHaveLength(3);
    expectFailure(() => evaluateWithFixtureAudit(context), "risk-assessment-threshold-ambiguous");
  });

  it("适用性不匹配的联合规则不参与判定", () => {
    const result = evaluateWithFixtureAudit(
      contextWith({
        configuration: configurationWith({
          jointRules: [
            {
              ruleId: "joint-other-stage",
              applicabilityConditions: [{ dimension: "工程阶段数据", values: ["接收"] }],
              operator: "any-of",
              monitoringThresholdIds: ["threshold-anomaly", "threshold-settlement-slope"],
            },
            {
              ruleId: "joint-settlement",
              applicabilityConditions: [],
              operator: "all-of",
              monitoringThresholdIds: ["threshold-settlement-slope", "threshold-settlement-value"],
            },
          ],
        }),
      }),
    );
    const identities = result.decision.triggers.map((trigger) => trigger.identity);
    expect(identities).not.toContain("joint-other-stage");
    expect(identities).toContain("joint-settlement");
    expect(C25_FIXTURE_APPLICABILITY.engineeringStage).toBe("掘进");
  });
});

describe("C25 重放与无 Agent 计算链", () => {
  it("同一冻结输入重复评估得到同一引用与内容摘要", () => {
    const first = evaluateWithFixtureAudit(contextWith());
    const second = evaluateWithFixtureAudit(contextWith());
    expect(second.decisionDigest).toBe(first.decisionDigest);
    expect(second.recordDigest).toBe(first.recordDigest);
    expect(second.valueSet.contentDigest).toBe(first.valueSet.contentDigest);
    expect(second.recordRef.reference.entityId).toBe(first.recordRef.reference.entityId);
    expect(second.decisionRef.reference.entityId).toBe(first.decisionRef.reference.entityId);
  });

  it("记录审计主体与时间取自本次评估调用，且不参与业务身份", () => {
    const context = contextWith();
    const first = evaluateDeterministicAssessment(context, {
      actorId: "actor-evaluate-a",
      recordedAt: "2030-05-01T00:00:00.000Z",
    });
    const second = evaluateDeterministicAssessment(context, {
      actorId: "actor-evaluate-b",
      recordedAt: "2030-06-01T00:00:00.000Z",
    });
    expect(first.record.audit).toEqual({
      actorId: "actor-evaluate-a",
      action: "risk-assessment.record",
      recordedAt: "2030-05-01T00:00:00.000Z",
    });
    expect(second.record.audit).toEqual({
      actorId: "actor-evaluate-b",
      action: "risk-assessment.record",
      recordedAt: "2030-06-01T00:00:00.000Z",
    });
    // 准备阶段主体与调用阶段主体不同：记录只带调用主体。
    expect(context.preparation.createdBy).not.toBe("actor-evaluate-a");
    expect(first.recordDigest).toBe(second.recordDigest);
    expect(second.recordRef.reference.entityId).toBe(first.recordRef.reference.entityId);
  });

  it("缺少推理运行时也能得到相同结果：输入只有普通领域对象", () => {
    const context = contextWith();
    expect(Object.keys(context)).not.toContain("agent");
    expect(Object.keys(context)).not.toContain("runtime");
    const result = evaluateWithFixtureAudit(context);
    expect(result.record.indicatorResults).toHaveLength(3);
    expect(result.valueSet.projectId).toBe("risk-assessment-project");
    expect(result.record.applicableRuleSetVersion.entityId).toBe("release-set-applicable-rule-set");
  });
});

export type { AssessmentConfigurationContentV1 };
