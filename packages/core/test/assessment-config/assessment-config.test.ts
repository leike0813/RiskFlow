import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ArtifactStoreV1 } from "../../src/artifacts/index.js";
import type {
  AtomicCommandV1,
  AtomicCommitReceiptV1,
  TransactionContextV1,
  TransactionHandlerV1,
  TransactionUnitV1,
} from "../../src/persistence/index.js";
import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
  ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
  addCanonicalDecimalValues,
  assessmentConfigurationDocumentDigest,
  assessmentConfigurationFailureFrom,
  AssessmentConfigurationResolverV1,
  buildAssessmentConfigurationMemberIdentity,
  canonicalDecimalToString,
  compareCanonicalDecimal,
  isCanonicalDecimal,
  mapRiskMatrixCell,
  multiplyCanonicalDecimalValues,
  parseAssessmentConfigurationDocument,
  parseCanonicalDecimal,
  readPreparedAssessmentConfiguration,
  resolveCanonicalDecimalBandIndex,
  roundCanonicalDecimalValue,
  selectMeasureCandidates,
  summarizeAssessmentConfigurationDocument,
  validateAssessmentConfigurationDocument,
  validateAssessmentConfigurationSet,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
  type AssessmentConfigurationMemberSourceV1,
  type AssessmentConfigurationResolutionV1,
  type AssessmentConfigurationResolverPortsV1,
  type ResolveAssessmentConfigurationSetV1,
} from "../../src/assessment-config/index.js";
import {
  assessmentConfigurationDocumentOf,
  configurationDefinitionTypeOrder,
  documentsWithOverride,
  makeAssessmentConfigurationFixtureSet,
  orderedAssessmentConfigurationDocuments,
  SYNTHETIC_PENDING_CLIENT_REVIEW,
} from "./fixture.js";

const targetRef = ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1;

const expectFailure = (run: () => unknown, reasonCode: string, code = "BUSINESS_BLOCKED"): void => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  const failure = assessmentConfigurationFailureFrom(caught);
  expect(failure?.reasonCode).toBe(reasonCode);
  expect(failure?.code).toBe(code);
};

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sortByBand = (
  cells: readonly { possibilityBandId: string; consequenceBandId: string; riskLevelId: string }[],
) =>
  [...cells].sort((left, right) =>
    left.possibilityBandId === right.possibilityBandId
      ? left.consequenceBandId < right.consequenceBandId
        ? -1
        : 1
      : left.possibilityBandId < right.possibilityBandId
        ? -1
        : 1,
  );

describe("synthetic assessment configuration set", () => {
  it("labels the fixture as pending client review and yields eleven strict documents", () => {
    expect(SYNTHETIC_PENDING_CLIENT_REVIEW).toBe("合成样本、待甲方复核");
    const set = makeAssessmentConfigurationFixtureSet();
    expect(Object.keys(set.documents)).toHaveLength(11);
    expect(configurationDefinitionTypeOrder()).toEqual(
      [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1].sort(),
    );
    for (const document of orderedAssessmentConfigurationDocuments(set)) {
      validateAssessmentConfigurationDocument(document);
    }
    validateAssessmentConfigurationSet(orderedAssessmentConfigurationDocuments(set));
  });

  it("keeps the fixture stable for identical inputs", () => {
    const first = makeAssessmentConfigurationFixtureSet();
    const second = makeAssessmentConfigurationFixtureSet();
    expect(orderedAssessmentConfigurationDocuments(first)).toEqual(
      orderedAssessmentConfigurationDocuments(second),
    );
    expect(assessmentConfigurationDocumentDigest(first.documents["risk-matrix"])).toBe(
      assessmentConfigurationDocumentDigest(second.documents["risk-matrix"]),
    );
  });
});

describe("strict configuration document parsing", () => {
  const set = makeAssessmentConfigurationFixtureSet();
  const indicatorSystem = assessmentConfigurationDocumentOf(set, "indicator-system");
  const weightSet = assessmentConfigurationDocumentOf(set, "weight-set");
  const scoringStrategy = assessmentConfigurationDocumentOf(set, "scoring-strategy");
  const mapping = assessmentConfigurationDocumentOf(set, "indicator-field-mapping");
  const riskMatrix = assessmentConfigurationDocumentOf(set, "risk-matrix");
  const warning = assessmentConfigurationDocumentOf(set, "monitoring-warning-threshold");
  const acceptance = assessmentConfigurationDocumentOf(set, "risk-acceptance-threshold");
  const jointPolicy = assessmentConfigurationDocumentOf(set, "joint-trigger-policy");
  const measureLibrary = assessmentConfigurationDocumentOf(set, "measure-library");
  const deviationPolicy = assessmentConfigurationDocumentOf(set, "deviation-policy");

  it.each([
    ["unknown envelope field", { ...weightSet, formula: "score * 2" }],
    [
      "unknown content field",
      { ...weightSet, content: { ...weightSet.content, formula: "x + y" } },
    ],
    [
      "definition type outside the C18 vocabulary",
      { ...weightSet, definitionType: "process-model" },
    ],
    [
      "non decimal boundary",
      { ...riskMatrix, content: { ...riskMatrix.content, matrixVersion: 1 } },
    ],
    [
      "non finite conversion scale",
      {
        ...mapping,
        content: {
          mappings: [
            {
              ...mapping.content.mappings[0],
              conversion: { kind: "affine", scale: Number.POSITIVE_INFINITY, offset: 0 },
            },
          ],
        },
      },
    ],
    [
      "expression parameters on a closed strategy",
      {
        ...scoringStrategy,
        content: {
          ...scoringStrategy.content,
          consequence: { kind: "maximum", weights: [{ indicatorId: "x", basisPoints: 1 }] },
        },
      },
    ],
    [
      "free path expression",
      {
        ...mapping,
        content: {
          mappings: [
            {
              ...mapping.content.mappings[0],
              origin: { kind: "source-field", documentType: "report", fieldPath: ["$..value"] },
            },
          ],
        },
      },
    ],
    [
      "nested joint rule",
      {
        ...jointPolicy,
        content: {
          rules: [
            {
              ruleId: "nested",
              applicabilityConditions: [],
              operator: "all-of",
              monitoringThresholdIds: ["threshold-anomaly", "threshold-frequency"],
              children: [{ ruleId: "child" }],
            },
          ],
        },
      },
    ],
    [
      "at-least count above the member count",
      {
        ...jointPolicy,
        content: {
          rules: [
            {
              ruleId: "joint-overflow",
              applicabilityConditions: [],
              operator: "at-least",
              count: 3,
              monitoringThresholdIds: ["threshold-anomaly", "threshold-frequency"],
            },
          ],
        },
      },
    ],
    [
      "duplicated weight identity",
      {
        ...weightSet,
        content: {
          ...weightSet.content,
          possibilityWeights: [
            { indicatorId: "indicator-possibility-1", basisPoints: 4000 },
            { indicatorId: "indicator-possibility-1", basisPoints: 6000 },
          ],
        },
      },
    ],
    [
      "unsorted threshold identity collection",
      {
        ...acceptance,
        content: {
          ...acceptance.content,
          thresholds: [
            { ...acceptance.content.thresholds[0], thresholdId: "threshold-zzz" },
            acceptance.content.thresholds[0],
          ],
        },
      },
    ],
    [
      "decimal beyond six fractional digits",
      {
        ...warning,
        content: {
          ...warning.content,
          thresholds: [
            {
              ...warning.content.thresholds[0],
              comparison: { operator: "gte", boundary: "0.1234567" },
            },
          ],
        },
      },
    ],
    [
      "non canonical decimal",
      {
        ...warning,
        content: {
          ...warning.content,
          thresholds: [
            { ...warning.content.thresholds[0], comparison: { operator: "gte", boundary: "5.50" } },
          ],
        },
      },
    ],
    [
      "interval bounds reversed",
      {
        ...warning,
        content: {
          ...warning.content,
          thresholds: [
            {
              ...warning.content.thresholds[1],
              comparison: { operator: "outside", lower: "10", upper: "1" },
            },
          ],
        },
      },
    ],
    [
      "risk level ordinals not increasing",
      {
        ...riskMatrix,
        content: {
          ...riskMatrix.content,
          riskLevels: [
            { levelId: "level-1", ordinal: 2 },
            { levelId: "level-2", ordinal: 1 },
          ],
        },
      },
    ],
    [
      "monitoring threshold carrying acceptance semantics",
      {
        ...warning,
        content: {
          ...warning.content,
          thresholds: [{ ...warning.content.thresholds[0], maximumAcceptedLevelId: "level-1" }],
        },
      },
    ],
    [
      "acceptance threshold carrying monitoring semantics",
      {
        ...acceptance,
        content: {
          ...acceptance.content,
          thresholds: [{ ...acceptance.content.thresholds[0], unit: "mm", metric: "value" }],
        },
      },
    ],
    [
      "relative deviation without positive baseline",
      {
        ...deviationPolicy,
        content: {
          policies: [
            {
              policyId: "deviation-relative",
              basis: "relative",
              threshold: "0.1",
              minimumBaseline: "0",
              evidenceRequirements: ["monitoring-record"],
            },
          ],
        },
      },
    ],
    [
      "risk level step carrying a decimal threshold",
      {
        ...deviationPolicy,
        content: {
          policies: [
            {
              policyId: "deviation-level-step",
              basis: "risk-level-step",
              levelStep: 1,
              threshold: "0.5",
              riskMatrixRef: { entityId: "risk-matrix-synthetic", versionId: "1" },
              evidenceRequirements: ["assessment-record"],
            },
          ],
        },
      },
    ],
    [
      "measure without target indicators",
      {
        ...measureLibrary,
        content: { measures: [{ ...measureLibrary.content.measures[0], targetIndicatorIds: [] }] },
      },
    ],
    [
      "numeric indicator without canonical unit",
      {
        ...indicatorSystem,
        content: {
          indicators: [
            {
              indicatorId: "indicator-consequence-1",
              indicatorType: "后果严重性评估指标",
              group: "监测量测与周边环境",
              valueKind: "numeric",
              applicabilityConditions: [],
              quantizationIntervalRef: {
                entityId: "quantization-interval-synthetic",
                versionId: "1",
              },
            },
          ],
        },
      },
    ],
  ])("rejects %s", (_name, candidate) => {
    expectFailure(
      () => parseAssessmentConfigurationDocument(candidate, targetRef),
      "assessment-configuration-content-invalid",
    );
  });

  it("accepts every fixture branch and keeps the discriminant aligned with the envelope", () => {
    for (const definitionType of ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1) {
      const document = parseAssessmentConfigurationDocument(
        set.documents[definitionType],
        targetRef,
      );
      expect(document.definitionType).toBe(definitionType);
      expect(document.schemaVersion).toBe("1");
    }
  });
});

describe("deterministic decimal arithmetic", () => {
  it("only accepts canonical decimals", () => {
    for (const value of ["0", "-1.5", "12", "0.000001", "999999999999999999"]) {
      expect(isCanonicalDecimal(value)).toBe(true);
    }
    for (const value of ["-0", "01", "1.", ".5", "1.50", "1e3", "+1", "0.1234567", "1,5"]) {
      expect(isCanonicalDecimal(value)).toBe(false);
    }
  });

  it("compares shared boundaries without binary rounding", () => {
    expect(compareCanonicalDecimal("1", "1")).toBe(0);
    expect(compareCanonicalDecimal("0.000001", "0.000002")).toBe(-1);
    expect(compareCanonicalDecimal("0.1", "0.099999")).toBe(1);
    expect(compareCanonicalDecimal("-0.3", "-0.300001")).toBe(1);
    expect(compareCanonicalDecimal("100000000000000000", "99999999999999999")).toBe(1);
  });

  it("adds, multiplies and rounds with bigint arithmetic", () => {
    const sum = addCanonicalDecimalValues(
      parseCanonicalDecimal("0.1"),
      parseCanonicalDecimal("0.2"),
    );
    expect(canonicalDecimalToString(sum)).toBe("0.3");
    const product = multiplyCanonicalDecimalValues(
      parseCanonicalDecimal("0.5"),
      parseCanonicalDecimal("0.02"),
    );
    expect(canonicalDecimalToString(product)).toBe("0.01");
    expect(canonicalDecimalToString(roundCanonicalDecimalValue(product, 1))).toBe("0");
    expect(
      canonicalDecimalToString(roundCanonicalDecimalValue(parseCanonicalDecimal("0.15"), 1)),
    ).toBe("0.2");
    expect(
      canonicalDecimalToString(roundCanonicalDecimalValue(parseCanonicalDecimal("-0.15"), 1)),
    ).toBe("-0.2");
    expect(
      canonicalDecimalToString(roundCanonicalDecimalValue(parseCanonicalDecimal("12"), 3)),
    ).toBe("12");
  });

  it("resolves bands with left-closed, right-open and a closed final band", () => {
    const bands = [
      { lower: "0", upper: "1" },
      { lower: "1", upper: "2" },
      { lower: "2", upper: "5" },
    ] as const;
    expect(resolveCanonicalDecimalBandIndex(bands, "0")).toBe(0);
    expect(resolveCanonicalDecimalBandIndex(bands, "0.999999")).toBe(0);
    expect(resolveCanonicalDecimalBandIndex(bands, "1")).toBe(1);
    expect(resolveCanonicalDecimalBandIndex(bands, "5")).toBe(2);
    expect(resolveCanonicalDecimalBandIndex(bands, "5.000001")).toBe(-1);
    expect(resolveCanonicalDecimalBandIndex(bands, "-1")).toBe(-1);
  });
});

describe("risk matrix mapping", () => {
  const set = makeAssessmentConfigurationFixtureSet();
  const matrix = assessmentConfigurationDocumentOf(set, "risk-matrix").content;

  it("accepts a matrix that is not five by five", () => {
    expect(matrix.possibilityAxis.bands).toHaveLength(3);
    expect(matrix.consequenceAxis.bands).toHaveLength(2);
    expect(matrix.cells).toHaveLength(6);
    expect(
      new Set(matrix.cells.map((cell) => `${cell.possibilityBandId}/${cell.consequenceBandId}`))
        .size,
    ).toBe(6);
  });

  it("assigns a shared boundary only to the following band", () => {
    expect(mapRiskMatrixCell(matrix, "1", "0")).toEqual({
      possibilityBandId: "p-band-2",
      consequenceBandId: "c-band-1",
      riskLevelId: "level-2",
    });
    expect(mapRiskMatrixCell(matrix, "0", "10").consequenceBandId).toBe("c-band-2");
  });

  it("includes the final upper bound and rejects out of range values", () => {
    expect(mapRiskMatrixCell(matrix, "5", "100").riskLevelId).toBe("level-4");
    expectFailure(
      () => mapRiskMatrixCell(matrix, "5.000001", "100"),
      "risk-matrix-value-out-of-range",
    );
    expectFailure(() => mapRiskMatrixCell(matrix, "1", "100.5"), "risk-matrix-value-out-of-range");
  });

  it.each([
    [
      "band gap",
      {
        bands: [
          { bandId: "p-band-1", lower: "0", upper: "1" },
          { bandId: "p-band-2", lower: "1.5", upper: "2" },
        ],
      },
    ],
    [
      "band overlap",
      {
        bands: [
          { bandId: "p-band-1", lower: "0", upper: "1.5" },
          { bandId: "p-band-2", lower: "1", upper: "2" },
        ],
      },
    ],
    [
      "descending bands",
      {
        bands: [
          { bandId: "p-band-2", lower: "1", upper: "2" },
          { bandId: "p-band-1", lower: "0", upper: "1" },
        ],
      },
    ],
    [
      "non canonical shared boundary",
      {
        bands: [
          { bandId: "p-band-1", lower: "0", upper: "1.0" },
          { bandId: "p-band-2", lower: "1.0", upper: "2" },
        ],
      },
    ],
  ])("rejects axis with %s", (_name, axis) => {
    expectFailure(
      () =>
        parseAssessmentConfigurationDocument(
          { ...set.documents["risk-matrix"], content: { ...matrix, possibilityAxis: axis } },
          targetRef,
        ),
      "assessment-configuration-content-invalid",
    );
  });

  it("rejects missing, duplicated, unknown and unlevelled cells", () => {
    const withCells = (cells: readonly (typeof matrix.cells)[number][]) =>
      validateAssessmentConfigurationDocument({
        ...set.documents["risk-matrix"],
        content: { ...matrix, cells: sortByBand(cells) },
      });
    expectFailure(
      () => withCells(matrix.cells.slice(0, 5)),
      "assessment-configuration-matrix-invalid",
    );
    expectFailure(
      () =>
        parseAssessmentConfigurationDocument(
          {
            ...set.documents["risk-matrix"],
            content: {
              ...matrix,
              cells: sortByBand([
                ...matrix.cells,
                {
                  possibilityBandId: "p-band-1",
                  consequenceBandId: "c-band-1",
                  riskLevelId: "level-1",
                },
              ]),
            },
          },
          targetRef,
        ),
      "assessment-configuration-content-invalid",
    );
    expectFailure(
      () =>
        withCells([
          ...matrix.cells.slice(0, 5),
          { possibilityBandId: "p-unknown", consequenceBandId: "c-band-1", riskLevelId: "level-4" },
        ]),
      "assessment-configuration-matrix-invalid",
    );
    expectFailure(
      () =>
        withCells([
          ...matrix.cells.slice(0, 5),
          { possibilityBandId: "p-band-3", consequenceBandId: "c-band-2", riskLevelId: "level-9" },
        ]),
      "assessment-configuration-matrix-invalid",
    );
  });
});

describe("local document validation", () => {
  const set = makeAssessmentConfigurationFixtureSet();

  it("requires both indicator sides and at least two quantitative groups", () => {
    const indicators = assessmentConfigurationDocumentOf(set, "indicator-system").content
      .indicators;
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...set.documents["indicator-system"],
          content: {
            indicators: indicators.filter(
              (indicator) => indicator.indicatorType === "发生可能性评估指标",
            ),
          },
        }),
      "assessment-configuration-indicator-coverage-invalid",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...set.documents["indicator-system"],
          content: {
            indicators: indicators.map((indicator) => ({
              ...indicator,
              group: "地质与围岩条件" as const,
            })),
          },
        }),
      "assessment-configuration-indicator-coverage-invalid",
    );
  });

  it("requires each weight side to total ten thousand basis points", () => {
    const weightSet = assessmentConfigurationDocumentOf(set, "weight-set");
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...weightSet,
          content: {
            ...weightSet.content,
            possibilityWeights: [
              { indicatorId: "indicator-possibility-1", basisPoints: 4000 },
              { indicatorId: "indicator-possibility-2", basisPoints: 5000 },
            ],
          },
        }),
      "assessment-configuration-weight-total-invalid",
    );
  });

  it("rejects undeclared unit conversions and C14 feature unit drift", () => {
    const mapping = assessmentConfigurationDocumentOf(set, "indicator-field-mapping");
    const warning = assessmentConfigurationDocumentOf(set, "monitoring-warning-threshold");
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...mapping,
          content: {
            mappings: [
              {
                ...mapping.content.mappings[1],
                sourceUnit: "cm",
                targetUnit: "mm",
                conversion: { kind: "identity" },
              },
            ],
          },
        }),
      "assessment-configuration-unit-mapping-invalid",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...mapping,
          content: {
            mappings: [
              {
                ...mapping.content.mappings[0],
                origin: {
                  kind: "monitoring-feature",
                  monitoringIndicator: "地表沉降",
                  parameterCode: "ground-settlement",
                  metric: "dominant-frequency",
                },
                sourceUnit: "mm/s",
                targetUnit: "mm",
              },
            ],
          },
        }),
      "assessment-configuration-unit-mapping-invalid",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationDocument({
          ...warning,
          content: {
            ...warning.content,
            thresholds: [{ ...warning.content.thresholds[0], unit: "mm" }],
          },
        }),
      "assessment-configuration-unit-mapping-invalid",
    );
  });
});

describe("cross document validation", () => {
  const set = makeAssessmentConfigurationFixtureSet();
  const documents = orderedAssessmentConfigurationDocuments(set);

  it("rejects an incomplete or mixed configuration set", () => {
    expectFailure(
      () => validateAssessmentConfigurationSet(documents.slice(0, 10)),
      "assessment-configuration-set-incomplete",
    );
    expectFailure(
      () => validateAssessmentConfigurationSet([]),
      "assessment-configuration-set-incomplete",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "forecast-policy", {
            ...set.documents["forecast-policy"],
            configurationSetRef: { entityId: "other-set", versionId: "9" },
          }),
        ),
      "assessment-configuration-set-mismatch",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "measure-library", {
            ...set.documents["measure-library"],
            projectRevisionRef: {
              kind: "project-revision",
              reference: { entityId: "other-revision", versionId: "2" },
            },
          }),
        ),
      "assessment-configuration-set-mismatch",
    );
  });

  it("rejects weights assigned to the wrong axis", () => {
    const weightSet = assessmentConfigurationDocumentOf(set, "weight-set");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "weight-set", {
            ...weightSet,
            content: {
              ...weightSet.content,
              consequenceWeights: [{ indicatorId: "indicator-possibility-1", basisPoints: 10000 }],
            },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
  });

  it("rejects measures, forecasts and joint rules with unknown references", () => {
    const measureLibrary = assessmentConfigurationDocumentOf(set, "measure-library");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "measure-library", {
            ...measureLibrary,
            content: {
              measures: [
                {
                  ...measureLibrary.content.measures[0],
                  targetIndicatorIds: ["indicator-missing"],
                },
              ],
            },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
    const jointPolicy = assessmentConfigurationDocumentOf(set, "joint-trigger-policy");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "joint-trigger-policy", {
            ...jointPolicy,
            content: {
              rules: [
                {
                  ...jointPolicy.content.rules[0],
                  monitoringThresholdIds: ["threshold-anomaly", "threshold-missing"],
                },
              ],
            },
          }),
        ),
      "assessment-configuration-joint-rule-invalid",
    );
    const forecast = assessmentConfigurationDocumentOf(set, "forecast-policy");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "forecast-policy", {
            ...forecast,
            content: { policies: [{ ...forecast.content.policies[0], unit: "cm" }] },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
  });

  it("rejects a threshold unit that contradicts the frozen mapping", () => {
    const warning = assessmentConfigurationDocumentOf(set, "monitoring-warning-threshold");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "monitoring-warning-threshold", {
            ...warning,
            content: {
              riskMatrixRef: warning.content.riskMatrixRef,
              thresholds: [
                { ...warning.content.thresholds[2], unit: "cm/s" },
                ...warning.content.thresholds.filter((_, index) => index !== 2),
              ],
            },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
  });

  it("rejects matrix references that do not match the published matrix", () => {
    const acceptance = assessmentConfigurationDocumentOf(set, "risk-acceptance-threshold");
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "risk-acceptance-threshold", {
            ...acceptance,
            content: {
              riskMatrixRef: { entityId: "risk-matrix-other", versionId: "9" },
              thresholds: acceptance.content.thresholds,
            },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
    expectFailure(
      () =>
        validateAssessmentConfigurationSet(
          documentsWithOverride(set, "risk-acceptance-threshold", {
            ...acceptance,
            content: {
              riskMatrixRef: acceptance.content.riskMatrixRef,
              thresholds: [
                { ...acceptance.content.thresholds[0], maximumAcceptedLevelId: "level-unknown" },
              ],
            },
          }),
        ),
      "assessment-configuration-reference-mismatch",
    );
  });
});

describe("measure candidates", () => {
  const set = makeAssessmentConfigurationFixtureSet();
  const library = assessmentConfigurationDocumentOf(set, "measure-library").content;

  it("only returns measures matching category, applicability and trigger type", () => {
    expect(
      selectMeasureCandidates({
        library,
        riskEventCategory: "渗流突涌",
        applicability: [{ dimension: "地层条件数据", values: ["地层-a"] }],
        triggerType: "监测指标越限",
      }),
    ).toEqual(["measure-grouting"]);
    expect(
      selectMeasureCandidates({
        library,
        riskEventCategory: "渗流突涌",
        applicability: [],
        triggerType: "监测指标越限",
      }),
    ).toEqual([]);
    expect(
      selectMeasureCandidates({
        library,
        riskEventCategory: "过挖与地表沉降",
        applicability: [],
        triggerType: "趋势/加速度/异常评分越限",
      }),
    ).toEqual(["measure-settlement-control"]);
  });

  it("cannot return a measure outside the published library", () => {
    const trimmed = { measures: [library.measures[0]!] };
    expect(
      selectMeasureCandidates({
        library: trimmed,
        riskEventCategory: "过挖与地表沉降",
        applicability: [],
        triggerType: "风险等级超过风险可接受阈值",
      }),
    ).toEqual([]);
    expect(trimmed.measures.map((measure) => measure.measureId)).toEqual(["measure-grouting"]);
  });
});

interface StoredArtifact {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly entityId: string;
  readonly versionId: string;
}

const storedPayload = (
  entityId: string,
  payload: Uint8Array,
  mediaType: string = ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
): StoredArtifact => ({
  entityId,
  bytes: payload,
  mediaType,
  versionId: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
});

const storedDocument = (
  document: AssessmentConfigurationDocumentV1,
  mediaType: string = ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
): StoredArtifact =>
  storedPayload(
    `artifact-${document.definitionType}`,
    new TextEncoder().encode(JSON.stringify(document)),
    mediaType,
  );

const contentArtifactRef = (stored: StoredArtifact) =>
  ({
    kind: "content-artifact",
    reference: { entityId: stored.entityId, versionId: stored.versionId },
  }) as const;

const createStoreFixture = (entries: readonly StoredArtifact[]) => {
  const byKey = new Map(entries.map((entry) => [`${entry.entityId}:${entry.versionId}`, entry]));
  const store = {
    put: async () => {
      throw new Error("put is not part of the C18 read path");
    },
    open: async (request: {
      readonly artifactRef: { reference: { entityId: string; versionId: string } };
    }) => {
      const entry = byKey.get(
        `${request.artifactRef.reference.entityId}:${request.artifactRef.reference.versionId}`,
      );
      if (entry === undefined) {
        throw Object.assign(new Error("artifact unavailable"), {
          code: "ARTIFACT_ACCESS_DENIED",
        });
      }
      const content = {
        hash: { algorithm: "sha256" as const, value: entry.versionId.replace("sha256:", "") },
        byteLength: entry.bytes.byteLength,
      };
      return {
        manifest: { artifactRef: request.artifactRef, mediaType: entry.mediaType, content },
        content: (async function* () {
          yield entry.bytes;
        })(),
        completed: Promise.resolve({ content }),
      };
    },
  } as unknown as ArtifactStoreV1;
  return { store };
};

const transactionUnitFixture = (
  onCommit: (commit: { audit: { auditEntryId: string } }) => void = () => undefined,
): TransactionUnitV1 =>
  ({
    execute: async (
      _command: AtomicCommandV1,
      handler: TransactionHandlerV1,
    ): Promise<AtomicCommitReceiptV1> => {
      const commit = await handler({} as TransactionContextV1);
      onCommit(commit);
      return {
        resultRef: commit.resultRef,
        auditEntryId: commit.audit.auditEntryId,
        eventRefs: [],
        replayed: false,
      };
    },
  }) as TransactionUnitV1;

describe("bounded artifact read and immutable set resolution", () => {
  const set = makeAssessmentConfigurationFixtureSet();
  const authorization = {
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "authorization-read", versionId: "1" },
    },
    actorId: "reader-1",
    projectId: set.projectId,
    grantedCapabilities: ["knowledge-modeling.read", "knowledge-modeling.govern"],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    decidedAt: "2030-01-01T00:00:00.000Z",
    invocation: { kind: "human" as const },
  };
  const fullStore = () =>
    createStoreFixture(
      configurationDefinitionTypeOrder().map((definitionType) =>
        storedDocument(set.documents[definitionType]),
      ),
    ).store;

  const readInput = (
    definitionType: AssessmentConfigurationDefinitionTypeV1,
    store: ArtifactStoreV1,
    overrides: {
      readonly artifactRef?: ReturnType<typeof contentArtifactRef>;
      readonly authorizationProjectId?: string;
    } = {},
  ) => ({
    artifactStore: store,
    artifactRef:
      overrides.artifactRef ?? contentArtifactRef(storedDocument(set.documents[definitionType])),
    definitionType,
    projectId: set.projectId,
    actorId: authorization.actorId,
    requestId: `read-${definitionType}`,
    idempotencyKey: `read-${definitionType}`,
    requestedAt: "2030-01-01T00:00:01.000Z",
    requiredCapability: "knowledge-modeling.read" as const,
    authorization: {
      ...authorization,
      projectId: overrides.authorizationProjectId ?? set.projectId,
    },
  });

  const memberSources = (): readonly AssessmentConfigurationMemberSourceV1[] =>
    configurationDefinitionTypeOrder().map((definitionType) => {
      const document = set.documents[definitionType];
      return {
        definitionType,
        releaseRef: {
          kind: "knowledge-release" as const,
          reference: { entityId: `release-${definitionType}`, versionId: "1" },
        },
        revisionRef: {
          kind: "knowledge-revision" as const,
          reference: { entityId: `revision-${definitionType}`, versionId: "1" },
        },
        artifactRef: contentArtifactRef(storedDocument(document)),
        projectRevisionRef: document.projectRevisionRef,
        configurationSetRef: document.configurationSetRef,
        contentDigest: assessmentConfigurationDocumentDigest(document),
        summary: summarizeAssessmentConfigurationDocument(document),
      };
    });

  const resolveRequest = (suffix: string): ResolveAssessmentConfigurationSetV1 => ({
    requestId: `resolve-${suffix}`,
    idempotencyKey: `resolve-key-${suffix}`,
    projectId: set.projectId,
    actorId: authorization.actorId,
    requestedAt: "2030-01-01T00:00:02.000Z",
    authorization,
    requiredAt: "2030-01-01T00:00:03.000Z",
    asOfRecordedAt: "2030-01-01T00:00:03.000Z",
  });

  it("reads a verified artifact into a prepared value with digest and summary", async () => {
    const prepared = await readPreparedAssessmentConfiguration(
      readInput("risk-matrix", fullStore()),
    );
    expect(prepared.definitionType).toBe("risk-matrix");
    expect(prepared.contentDigest).toBe(
      assessmentConfigurationDocumentDigest(set.documents["risk-matrix"]),
    );
    expect(prepared.summary.itemCount).toBe(6);
    expect(prepared.summary.identityIds).toContain("p-band-1");
  });

  it("rejects a media type mismatch", async () => {
    const stored = storedDocument(set.documents["risk-matrix"], "application/json");
    await expect(
      readPreparedAssessmentConfiguration(
        readInput("risk-matrix", createStoreFixture([stored]).store, {
          artifactRef: contentArtifactRef(stored),
        }),
      ),
    ).rejects.toMatchObject({
      failure: { reasonCode: "assessment-configuration-media-type-invalid" },
    });
  });

  it("rejects a document whose definition type differs from the command", async () => {
    const stored = storedPayload(
      "artifact-risk-matrix",
      new TextEncoder().encode(JSON.stringify(set.documents["indicator-system"])),
    );
    await expect(
      readPreparedAssessmentConfiguration(
        readInput("risk-matrix", createStoreFixture([stored]).store, {
          artifactRef: contentArtifactRef(stored),
        }),
      ),
    ).rejects.toMatchObject({
      failure: { reasonCode: "assessment-configuration-type-mismatch" },
    });
  });

  it("rejects a project mismatch before reading the artifact", async () => {
    await expect(
      readPreparedAssessmentConfiguration(
        readInput("risk-matrix", fullStore(), { authorizationProjectId: "other-project" }),
      ),
    ).rejects.toMatchObject({
      failure: {
        reasonCode: "assessment-configuration-project-mismatch",
        code: "BUSINESS_BLOCKED",
      },
    });
  });

  it("rejects oversized and undecodable artifacts before returning anything", async () => {
    const oversized = storedPayload(
      "artifact-risk-matrix",
      new Uint8Array(1024 * 1024 + 1).fill(0x20),
    );
    await expect(
      readPreparedAssessmentConfiguration(
        readInput("risk-matrix", createStoreFixture([oversized]).store, {
          artifactRef: contentArtifactRef(oversized),
        }),
      ),
    ).rejects.toMatchObject({ failure: { reasonCode: "assessment-configuration-size-exceeded" } });

    const invalidUtf8 = storedPayload(
      "artifact-risk-matrix",
      new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    );
    await expect(
      readPreparedAssessmentConfiguration(
        readInput("risk-matrix", createStoreFixture([invalidUtf8]).store, {
          artifactRef: contentArtifactRef(invalidUtf8),
        }),
      ),
    ).rejects.toMatchObject({
      failure: { reasonCode: "assessment-configuration-content-invalid" },
    });
  });

  it("keeps transient C04 verification failures retryable", async () => {
    const base = fullStore();
    const store = {
      ...base,
      open: async (...args: Parameters<ArtifactStoreV1["open"]>) => ({
        ...(await base.open(...args)),
        completed: Promise.reject(
          Object.assign(new Error("temporary artifact read failure"), {
            code: "ARTIFACT_IO_FAILURE",
          }),
        ),
      }),
    };
    await expect(
      readPreparedAssessmentConfiguration(readInput("risk-matrix", store)),
    ).rejects.toMatchObject({ failure: { code: "TRANSIENT_FAILURE" } });
  });

  it.each([
    { purpose: "assessment" as const, expected: 8 },
    { purpose: "response" as const, expected: 9 },
    { purpose: "forecast" as const, expected: 2 },
    { purpose: "deviation" as const, expected: 2 },
  ])("只解析$purpose阶段实际需要的配置", async ({ purpose, expected }) => {
    const requested: string[][] = [];
    const resolver = new AssessmentConfigurationResolverV1({
      artifactStore: fullStore(),
      transactionUnit: transactionUnitFixture(() => undefined),
      resolveConfigurationMembers: async ({ requiredDefinitionTypes }) => {
        requested.push([...requiredDefinitionTypes]);
        return {
          kind: "succeeded",
          members: memberSources().filter((member) =>
            requiredDefinitionTypes.includes(member.definitionType),
          ),
        };
      },
      appendConfigurationSet: async () => undefined,
    });
    const result = await resolver.resolveConfigurationSet({ ...resolveRequest(purpose), purpose });
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.configurationSet.members).toHaveLength(expected);
    expect(result.configurationSet.purpose).toBe(purpose);
    if (purpose === "assessment") expect(requested.flat()).not.toContain("forecast-policy");
  });

  it("resolves the exact eleven member set with a stable identity", async () => {
    const persisted: string[] = [];
    const resolver = new AssessmentConfigurationResolverV1({
      artifactStore: fullStore(),
      now: () => new Date("2030-01-01T00:00:02.000Z"),
      transactionUnit: transactionUnitFixture((commit) => {
        persisted.push(commit.audit.auditEntryId);
      }),
      resolveConfigurationMembers: async () => ({ kind: "succeeded", members: memberSources() }),
      appendConfigurationSet: async () => undefined,
    });
    const request = resolveRequest("stable");
    const first = await resolver.resolveConfigurationSet(request);
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    expect(first.configurationSet.members).toHaveLength(11);
    expect(first.configurationSet.members.map((member) => member.definitionType)).toEqual(
      configurationDefinitionTypeOrder(),
    );
    expect(first.configurationSet.setRef.reference.entityId).toBe(
      `assessment-configuration-release-set-${first.configurationSet.identityDigest}`,
    );
    expect(persisted).toHaveLength(1);

    const { memberDigest, identityDigest } = buildAssessmentConfigurationMemberIdentity({
      projectId: set.projectId,
      projectRevisionRef: set.projectRevisionRef,
      configurationSetRef: set.configurationSetRef,
      requiredAt: request.requiredAt,
      asOfRecordedAt: request.asOfRecordedAt,
      members: first.configurationSet.members,
    });
    expect(first.configurationSet.memberDigest).toBe(memberDigest);
    expect(first.configurationSet.identityDigest).toBe(identityDigest);

    const replay = await resolver.resolveConfigurationSet(request);
    expect(replay.kind).toBe("succeeded");
    if (replay.kind !== "succeeded") return;
    expect(replay.configurationSet.identityDigest).toBe(identityDigest);
    expect(replay.configurationSet.memberDigest).toBe(memberDigest);
  });

  const portsFor = (
    members: readonly AssessmentConfigurationMemberSourceV1[],
  ): AssessmentConfigurationResolverPortsV1 => ({
    artifactStore: fullStore(),
    transactionUnit: transactionUnitFixture(),
    resolveConfigurationMembers: async () => ({ kind: "succeeded", members }),
    appendConfigurationSet: async () => undefined,
  });

  it("fails closed on incomplete and drifting member lists", async () => {
    const incomplete = new AssessmentConfigurationResolverV1(
      portsFor(memberSources().slice(0, 10)),
    );
    await expect(
      incomplete.resolveConfigurationSet(resolveRequest("incomplete")),
    ).rejects.toMatchObject({ failure: { reasonCode: "assessment-configuration-incompatible" } });

    const drifted = memberSources().map((member) =>
      member.definitionType === "risk-matrix"
        ? { ...member, contentDigest: sha256Hex("other") }
        : member,
    );
    const mismatch = new AssessmentConfigurationResolverV1(portsFor(drifted));
    await expect(mismatch.resolveConfigurationSet(resolveRequest("drifted"))).rejects.toMatchObject(
      {
        failure: { reasonCode: "assessment-configuration-artifact-mismatch" },
      },
    );
  });

  it("returns the C16 blocking failure without a partial set", async () => {
    let appended = 0;
    const resolver = new AssessmentConfigurationResolverV1({
      artifactStore: fullStore(),
      transactionUnit: transactionUnitFixture(),
      resolveConfigurationMembers: async () => ({
        kind: "failed",
        error: {
          code: "BUSINESS_BLOCKED",
          category: "business-blocked",
          retryable: false,
          stageCode: "knowledge-governance.business_blocked",
          occurredAt: "2030-01-01T00:00:03.000Z",
          causalRunId: "resolve-blocked",
          blockerKind: "required-release-unavailable",
          blockerRef: targetRef,
        },
      }),
      appendConfigurationSet: async () => {
        appended += 1;
      },
    });
    const failure: AssessmentConfigurationResolutionV1 = await resolver.resolveConfigurationSet(
      resolveRequest("blocked"),
    );
    expect(failure).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "required-release-unavailable" },
    });
    expect(appended).toBe(0);
  });

  it("denies cross-project and capability-less resolution requests", async () => {
    const resolver = new AssessmentConfigurationResolverV1(portsFor(memberSources()));
    await expect(
      resolver.resolveConfigurationSet({
        ...resolveRequest("cross-project"),
        projectId: "other-project",
      }),
    ).rejects.toMatchObject({
      failure: {
        reasonCode: "assessment-configuration-project-mismatch",
        code: "AUTHORIZATION_DENIED",
      },
    });
    await expect(
      resolver.resolveConfigurationSet({
        ...resolveRequest("capability-less"),
        authorization: { ...authorization, grantedCapabilities: ["knowledge-modeling.govern"] },
      }),
    ).rejects.toMatchObject({
      failure: {
        reasonCode: "assessment-configuration-capability-required",
        code: "AUTHORIZATION_DENIED",
      },
    });
  });

  it("rejects a malformed resolution request before touching any member", async () => {
    let resolved = 0;
    const resolver = new AssessmentConfigurationResolverV1({
      artifactStore: fullStore(),
      transactionUnit: transactionUnitFixture(),
      resolveConfigurationMembers: async () => {
        resolved += 1;
        return { kind: "succeeded", members: memberSources() };
      },
      appendConfigurationSet: async () => undefined,
    });
    await expect(
      resolver.resolveConfigurationSet({
        ...resolveRequest("malformed"),
        requiredAt: "not-a-timestamp",
      }),
    ).rejects.toMatchObject({
      failure: { reasonCode: "assessment-configuration-request-invalid" },
    });
    expect(resolved).toBe(0);
  });
});
