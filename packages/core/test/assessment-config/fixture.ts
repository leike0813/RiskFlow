/**
 * Minimal complete synthetic configuration set used by C18 tests.
 *
 * 合成样本、待甲方复核 — these eleven documents are structurally complete and
 * mutually compatible, but the numeric content is synthetic. Client-reviewed
 * configuration must be imported through the governed C16 commands.
 */
import type { ProjectRevisionRefV1 } from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  AssessmentConfigurationDocumentV1Schema,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
} from "../../src/assessment-config/index.js";

export const SYNTHETIC_PENDING_CLIENT_REVIEW = "合成样本、待甲方复核" as const;

export const ASSESSMENT_CONFIGURATION_FIXTURE_PROJECT_ID = "assessment-configuration-project";
export const ASSESSMENT_CONFIGURATION_FIXTURE_PROJECT_REVISION: ProjectRevisionRefV1 = {
  kind: "project-revision",
  reference: { entityId: "project-revision-synthetic", versionId: "1" },
};
export const ASSESSMENT_CONFIGURATION_FIXTURE_SET_REF: VersionReference = {
  entityId: "configuration-set-synthetic",
  versionId: "1",
};

export interface AssessmentConfigurationFixtureSetV1 {
  readonly projectId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly configurationSetRef: VersionReference;
  readonly documents: Readonly<
    Record<AssessmentConfigurationDefinitionTypeV1, AssessmentConfigurationDocumentV1>
  >;
}

const document = (
  definitionType: AssessmentConfigurationDefinitionTypeV1,
  content: unknown,
  set: {
    readonly projectRevisionRef: ProjectRevisionRefV1;
    readonly configurationSetRef: VersionReference;
  },
): AssessmentConfigurationDocumentV1 =>
  AssessmentConfigurationDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType,
    projectRevisionRef: set.projectRevisionRef,
    configurationSetRef: set.configurationSetRef,
    content,
  });

const indicatorBase = {
  applicabilityConditions: [],
  quantizationIntervalRef: { entityId: "quantization-interval-synthetic", versionId: "1" },
} as const;

export const makeAssessmentConfigurationFixtureSet = (overrides?: {
  readonly projectId?: string;
  readonly projectRevisionRef?: ProjectRevisionRefV1;
  readonly configurationSetRef?: VersionReference;
}): AssessmentConfigurationFixtureSetV1 => {
  const projectId = overrides?.projectId ?? ASSESSMENT_CONFIGURATION_FIXTURE_PROJECT_ID;
  const projectRevisionRef =
    overrides?.projectRevisionRef ?? ASSESSMENT_CONFIGURATION_FIXTURE_PROJECT_REVISION;
  const configurationSetRef =
    overrides?.configurationSetRef ?? ASSESSMENT_CONFIGURATION_FIXTURE_SET_REF;
  const envelope = { projectRevisionRef, configurationSetRef };
  const contents: Record<AssessmentConfigurationDefinitionTypeV1, unknown> = {
    "indicator-system": {
      indicators: [
        {
          ...indicatorBase,
          indicatorId: "indicator-consequence-1",
          indicatorType: "后果严重性评估指标",
          group: "监测量测与周边环境",
          valueKind: "numeric",
          canonicalUnit: "mm",
        },
        {
          ...indicatorBase,
          indicatorId: "indicator-possibility-1",
          indicatorType: "发生可能性评估指标",
          group: "地质与围岩条件",
          valueKind: "ordinal",
          applicabilityConditions: [{ dimension: "地层条件数据", values: ["地层-a"] }],
        },
        {
          ...indicatorBase,
          indicatorId: "indicator-possibility-2",
          indicatorType: "发生可能性评估指标",
          group: "开挖与支护参数",
          valueKind: "numeric",
          canonicalUnit: "1",
        },
      ],
    },
    "indicator-field-mapping": {
      mappings: [
        {
          mappingId: "mapping-consequence-slope",
          targetIndicatorId: "indicator-consequence-1",
          origin: {
            kind: "monitoring-feature",
            monitoringIndicator: "地表沉降",
            parameterCode: "ground-settlement",
            metric: "short-term-slope",
          },
          sourceUnit: "mm/s",
          targetUnit: "mm",
          conversion: { kind: "affine", scale: 60, offset: 0 },
        },
        {
          mappingId: "mapping-consequence-value",
          targetIndicatorId: "indicator-consequence-1",
          origin: {
            kind: "monitoring-value",
            monitoringIndicator: "地表沉降",
            parameterCode: "ground-settlement",
            metric: "value",
          },
          sourceUnit: "mm",
          targetUnit: "mm",
          conversion: { kind: "identity" },
        },
        {
          mappingId: "mapping-possibility-field",
          targetIndicatorId: "indicator-possibility-1",
          origin: {
            kind: "source-field",
            documentType: "geology-report",
            fieldPath: ["strata", "layer", "grade"],
          },
          sourceUnit: "1",
          targetUnit: "1",
          conversion: { kind: "identity" },
        },
        {
          mappingId: "mapping-possibility-numeric",
          targetIndicatorId: "indicator-possibility-2",
          origin: {
            kind: "source-field",
            documentType: "design-report",
            fieldPath: ["support", "pressure"],
          },
          sourceUnit: "kPa",
          targetUnit: "1",
          conversion: { kind: "affine", scale: 0.001, offset: 0 },
        },
      ],
    },
    "weight-set": {
      weightSetId: "weight-set-synthetic",
      weightSetVersion: "1",
      sourceRef: { entityId: "weight-source-synthetic", versionId: "1" },
      possibilityWeights: [
        { indicatorId: "indicator-possibility-1", basisPoints: 4000 },
        { indicatorId: "indicator-possibility-2", basisPoints: 6000 },
      ],
      consequenceWeights: [{ indicatorId: "indicator-consequence-1", basisPoints: 10000 }],
    },
    "scoring-strategy": {
      possibility: {
        kind: "weighted-average",
        weightSetRef: { entityId: "weight-set-synthetic", versionId: "1" },
        rounding: { mode: "half-away-from-zero", decimalScale: 2 },
      },
      consequence: { kind: "maximum" },
    },
    "risk-matrix": {
      matrixId: "risk-matrix-synthetic",
      matrixVersion: "1",
      possibilityAxis: {
        bands: [
          { bandId: "p-band-1", lower: "0", upper: "1" },
          { bandId: "p-band-2", lower: "1", upper: "2" },
          { bandId: "p-band-3", lower: "2", upper: "5" },
        ],
      },
      consequenceAxis: {
        bands: [
          { bandId: "c-band-1", lower: "0", upper: "10" },
          { bandId: "c-band-2", lower: "10", upper: "100" },
        ],
      },
      riskLevels: [
        { levelId: "level-1", ordinal: 1 },
        { levelId: "level-2", ordinal: 2 },
        { levelId: "level-3", ordinal: 3 },
        { levelId: "level-4", ordinal: 4 },
      ],
      cells: [
        { possibilityBandId: "p-band-1", consequenceBandId: "c-band-1", riskLevelId: "level-1" },
        { possibilityBandId: "p-band-1", consequenceBandId: "c-band-2", riskLevelId: "level-2" },
        { possibilityBandId: "p-band-2", consequenceBandId: "c-band-1", riskLevelId: "level-2" },
        { possibilityBandId: "p-band-2", consequenceBandId: "c-band-2", riskLevelId: "level-3" },
        { possibilityBandId: "p-band-3", consequenceBandId: "c-band-1", riskLevelId: "level-3" },
        { possibilityBandId: "p-band-3", consequenceBandId: "c-band-2", riskLevelId: "level-4" },
      ],
    },
    "risk-acceptance-threshold": {
      riskMatrixRef: { entityId: "risk-matrix-synthetic", versionId: "1" },
      thresholds: [
        {
          thresholdId: "acceptance-default",
          applicabilityConditions: [{ dimension: "工程阶段数据", values: ["掘进"] }],
          maximumAcceptedLevelId: "level-2",
        },
      ],
    },
    "monitoring-warning-threshold": {
      riskMatrixRef: { entityId: "risk-matrix-synthetic", versionId: "1" },
      thresholds: [
        {
          thresholdId: "threshold-anomaly",
          monitoringIndicator: "地下水位",
          parameterCode: "water-level",
          metric: "anomaly-score",
          unit: "score",
          comparison: { operator: "gte", boundary: "3" },
          warningLevelId: "level-3",
        },
        {
          thresholdId: "threshold-frequency",
          monitoringIndicator: "盾构姿态参数",
          parameterCode: "cutter-frequency",
          metric: "dominant-frequency",
          unit: "Hz",
          comparison: { operator: "outside", lower: "1", upper: "80" },
          warningLevelId: "level-2",
        },
        {
          thresholdId: "threshold-settlement-slope",
          monitoringIndicator: "地表沉降",
          parameterCode: "ground-settlement",
          metric: "short-term-slope",
          unit: "mm/s",
          comparison: { operator: "gte", boundary: "0.5" },
          warningLevelId: "level-4",
        },
        {
          thresholdId: "threshold-settlement-value",
          monitoringIndicator: "地表沉降",
          parameterCode: "ground-settlement",
          metric: "value",
          unit: "mm",
          comparison: { operator: "gte", boundary: "5" },
          warningLevelId: "level-3",
        },
      ],
    },
    "joint-trigger-policy": {
      rules: [
        {
          ruleId: "joint-settlement",
          applicabilityConditions: [{ dimension: "工程阶段数据", values: ["掘进"] }],
          operator: "at-least",
          count: 2,
          monitoringThresholdIds: ["threshold-anomaly", "threshold-settlement-slope"],
        },
        {
          ruleId: "joint-trend",
          applicabilityConditions: [],
          operator: "any-of",
          monitoringThresholdIds: ["threshold-frequency", "threshold-settlement-slope"],
        },
      ],
    },
    "measure-library": {
      measures: [
        {
          measureId: "measure-grouting",
          riskEventCategory: "渗流突涌",
          applicabilityConditions: [{ dimension: "地层条件数据", values: ["地层-a"] }],
          triggerTypes: ["多指标联合规则命中", "监测指标越限"],
          steps: [
            { stepOrdinal: 1, instruction: "closed-loop grouting at the inflow section" },
            { stepOrdinal: 2, instruction: "density verification before reopening the face" },
          ],
          resourceRequirements: ["grouting-materials"],
          targetIndicatorIds: ["indicator-consequence-1"],
          evidenceRequirements: ["grouting-record"],
          contraindications: ["rapid-water-inflow"],
        },
        {
          measureId: "measure-settlement-control",
          riskEventCategory: "过挖与地表沉降",
          applicabilityConditions: [],
          triggerTypes: ["趋势/加速度/异常评分越限", "风险等级超过风险可接受阈值"],
          steps: [
            { stepOrdinal: 1, instruction: "reduce the advance rate and re-align the tail shield" },
          ],
          resourceRequirements: [],
          targetIndicatorIds: ["indicator-consequence-1", "indicator-possibility-2"],
          evidenceRequirements: ["monitoring-record"],
          contraindications: [],
        },
      ],
    },
    "forecast-policy": {
      policies: [
        {
          policyId: "forecast-monitoring-trend",
          method: "monitoring-trend",
          inputIndicatorIds: ["indicator-possibility-1"],
          targetIndicatorId: "indicator-consequence-1",
          horizonSteps: 3,
          unit: "mm",
          requiredRef: { entityId: "forecast-trend-model", versionId: "1" },
        },
        {
          policyId: "forecast-statistics",
          method: "historical-statistics",
          inputIndicatorIds: ["indicator-possibility-1", "indicator-possibility-2"],
          targetIndicatorId: "indicator-consequence-1",
          horizonSteps: 5,
          unit: "mm",
          requiredRef: { entityId: "forecast-statistics-model", versionId: "1" },
        },
      ],
    },
    "deviation-policy": {
      policies: [
        {
          policyId: "deviation-absolute",
          basis: "absolute",
          threshold: "2",
          evidenceRequirements: ["monitoring-record"],
        },
        {
          policyId: "deviation-level-step",
          basis: "risk-level-step",
          levelStep: 1,
          riskMatrixRef: { entityId: "risk-matrix-synthetic", versionId: "1" },
          evidenceRequirements: ["assessment-record"],
        },
        {
          policyId: "deviation-relative",
          basis: "relative",
          threshold: "0.1",
          minimumBaseline: "0.01",
          evidenceRequirements: ["monitoring-record"],
        },
      ],
    },
  };

  const documents = Object.fromEntries(
    ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map((definitionType) => [
      definitionType,
      document(definitionType, contents[definitionType], envelope),
    ]),
  ) as AssessmentConfigurationFixtureSetV1["documents"];

  return { projectId, projectRevisionRef, configurationSetRef, documents };
};

export const assessmentConfigurationDocumentOf = <
  T extends AssessmentConfigurationDefinitionTypeV1,
>(
  set: AssessmentConfigurationFixtureSetV1,
  definitionType: T,
): Extract<AssessmentConfigurationDocumentV1, { definitionType: T }> =>
  set.documents[definitionType] as Extract<
    AssessmentConfigurationDocumentV1,
    { definitionType: T }
  >;

/** Canonical member order: ascending definition type, the order the set enforces. */
export const configurationDefinitionTypeOrder =
  (): readonly AssessmentConfigurationDefinitionTypeV1[] =>
    [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );

export const orderedAssessmentConfigurationDocuments = (
  set: AssessmentConfigurationFixtureSetV1,
): readonly AssessmentConfigurationDocumentV1[] =>
  configurationDefinitionTypeOrder().map((definitionType) => set.documents[definitionType]);

/** Replace exactly one document; the replacement may be structurally invalid on purpose. */
export const documentsWithOverride = (
  set: AssessmentConfigurationFixtureSetV1,
  definitionType: AssessmentConfigurationDefinitionTypeV1,
  replacement: unknown,
): readonly unknown[] =>
  configurationDefinitionTypeOrder().map((candidate) =>
    candidate === definitionType ? replacement : set.documents[candidate],
  );

export const documentWithOverride = <T extends AssessmentConfigurationDefinitionTypeV1>(
  set: AssessmentConfigurationFixtureSetV1,
  definitionType: T,
  overrides: Partial<Extract<AssessmentConfigurationDocumentV1, { definitionType: T }>>,
): Extract<AssessmentConfigurationDocumentV1, { definitionType: T }> =>
  ({ ...assessmentConfigurationDocumentOf(set, definitionType), ...overrides }) as Extract<
    AssessmentConfigurationDocumentV1,
    { definitionType: T }
  >;
