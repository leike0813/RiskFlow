import {
  RiskAssessmentRecordSchema,
  type ApplicabilityMetadata,
  type RiskAssessmentRecord,
  type ScalarValue,
  type StructuredScoringRule,
} from "@riskflow/contracts/records";
import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AssessmentBasisReleaseSetRefV1,
  AssessmentDecisionArtifactRefV1,
  AssessmentInputSnapshotRefV1,
  AssessmentPreparationSnapshotRefV1,
  ContractReferenceV1,
  ProjectRevisionRefV1,
  RiskAssessmentRecordRefV1,
} from "@riskflow/contracts/ports";
import type {
  AssessmentInputSnapshotV1,
  AssessmentPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";

import {
  AssessmentIndicatorV1Schema,
  mapRiskMatrixCell,
  parseCanonicalDecimal,
  type ApplicabilityConditionV1,
  type CanonicalDecimalValueV1,
  type AssessmentConfigurationMetricV1,
  type IndicatorFieldMappingContentV1,
  type IndicatorSystemContentV1,
  type JointTriggerPolicyContentV1,
  type MonitoringWarningComparisonV1,
  type MonitoringWarningThresholdContentV1,
  type RiskAcceptanceThresholdContentV1,
  type RiskMatrixContentV1,
  type ScoringStrategyContentV1,
  type WeightSetContentV1,
} from "../../assessment-config/index.js";
import type {
  MonitoringSeriesRevisionReadV1,
  MonitoringSnapshotV1,
} from "../../engineering-data/monitoring/index.js";
import { sha256CanonicalJson } from "../../persistence/index.js";
import {
  evaluateScoringRule,
  type ApplicableRuleSetDocumentV1,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type StructuredScoringRuleDocumentV1,
} from "../../scoring-rules/index.js";
import {
  addDecimals,
  canonicalDecimalStringOf,
  compareDecimals,
  decimalFromFiniteNumber,
  decimalToExactNumber,
  decimalToNearestNumber,
  decimalToString,
  multiplyDecimals,
  roundDecimal,
  weightByBasisPoints,
} from "./decimal.js";
import {
  AssessmentDecisionArtifactV1Schema,
  IndicatorActualValueSetV1Schema,
  IndicatorActualValueV1Schema,
  RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
  failRiskAssessment,
  type AssessmentDecisionArtifactV1,
  type AssessmentTriggerFactV1,
  type AxisScoreV1,
  type IndicatorActualValueSetV1,
  type IndicatorActualValueV1,
  type RiskAssessmentReasonCodeV1,
  type RiskInputFactsV1,
} from "./schema.js";

/* -------------------------------------------------------------------------- */
/* 输入契约：全部为已解析且相容的正文；本模块不做任何 I/O 或 Agent 调用         */
/* -------------------------------------------------------------------------- */

export interface AssessmentMonitoringInputV1 {
  readonly snapshot: MonitoringSnapshotV1;
  readonly seriesRevision: MonitoringSeriesRevisionReadV1;
}

export interface AssessmentConfigurationV1 {
  readonly indicatorSystem: IndicatorSystemContentV1;
  readonly fieldMapping: IndicatorFieldMappingContentV1;
  readonly weightSet: WeightSetContentV1;
  readonly scoringStrategy: ScoringStrategyContentV1;
  readonly riskMatrix: RiskMatrixContentV1;
  readonly riskAcceptanceThreshold: RiskAcceptanceThresholdContentV1;
  readonly monitoringWarningThreshold: MonitoringWarningThresholdContentV1;
  readonly jointTriggerPolicy: JointTriggerPolicyContentV1;
}

export interface AssessmentEngineContextV1 {
  readonly projectId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly preparation: AssessmentPreparationSnapshotV1;
  readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
  readonly inputSnapshot: AssessmentInputSnapshotV1;
  readonly inputSnapshotRef: AssessmentInputSnapshotRefV1;
  readonly assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
  readonly applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1;
  readonly applicability: ApplicabilityMetadata;
  readonly basis: {
    readonly applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1;
    readonly scoringRuleMembers: readonly AssessmentBasisReleaseSetMemberV1[];
    readonly configurationMembers: readonly AssessmentBasisConfigurationMemberV1[];
  };
  readonly configuration: AssessmentConfigurationV1;
  readonly applicableRuleSet: ApplicableRuleSetDocumentV1;
  readonly rules: readonly {
    readonly member: AssessmentBasisReleaseSetMemberV1;
    readonly document: StructuredScoringRuleDocumentV1;
  }[];
  readonly facts: RiskInputFactsV1;
  readonly monitoring: readonly AssessmentMonitoringInputV1[];
}

/** 正式记录的审计元数据：主体与记录时间来自本次评估调用，而非准备阶段。 */
export interface RiskAssessmentAuditV1 {
  readonly actorId: string;
  readonly recordedAt: string;
}

export interface ScoredIndicatorV1 {
  readonly indicatorId: string;
  readonly indicatorType: "发生可能性评估指标" | "后果严重性评估指标";
  readonly actualValue: ScalarValue;
  readonly baseScore: CanonicalDecimalValueV1;
  readonly weightedScore: CanonicalDecimalValueV1;
  readonly basisPoints: number;
  readonly publicWeightedScore: number;
  readonly rule: StructuredScoringRule;
  readonly member: AssessmentBasisReleaseSetMemberV1;
  readonly thresholdId: string;
  readonly grade: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

export interface AxisScoreResultV1 {
  readonly axis: AxisScoreV1;
  /** 精确轴分：矩阵映射与后续比较只消费该表示，不读公共 number。 */
  readonly scoreValue: CanonicalDecimalValueV1;
  readonly perIndicator: readonly ScoredIndicatorV1[];
}

export interface AssessmentScoreV1 {
  readonly possibility: AxisScoreResultV1;
  readonly consequence: AxisScoreResultV1;
}

export interface MatrixMappingV1 {
  readonly possibilityBandId: string;
  readonly consequenceBandId: string;
  readonly riskLevelId: string;
  readonly riskLevelOrdinal: number;
}

export interface DeterministicAssessmentV1 {
  readonly valueSet: IndicatorActualValueSetV1;
  readonly decision: AssessmentDecisionArtifactV1;
  readonly decisionRef: AssessmentDecisionArtifactRefV1;
  readonly decisionDigest: string;
  readonly record: RiskAssessmentRecord;
  readonly recordRef: RiskAssessmentRecordRefV1;
  readonly recordDigest: string;
}

/* -------------------------------------------------------------------------- */
/* 稳定身份与失败目标                                                          */
/* -------------------------------------------------------------------------- */

const refKey = (value: { kind: string; reference: { entityId: string; versionId: string } }) =>
  `${value.kind}\u0000${value.reference.entityId}\u0000${value.reference.versionId}`;

const evidenceKeyOf = (evidence: EvidenceReference) =>
  `${evidence.sourceVersion.entityId}\u0000${evidence.sourceVersion.versionId}\u0000${evidence.locator.sourceSegmentId}`;

const monitoringSeriesKey = (indicator: string, parameterCode: string) =>
  `${indicator}\u0000${parameterCode}`;

type TargetRef = ContractReferenceV1;

const configurationMemberFor = (
  context: AssessmentEngineContextV1,
  definitionType: string,
): AssessmentBasisConfigurationMemberV1 | undefined =>
  context.basis.configurationMembers.find((member) => member.definitionType === definitionType);

const configurationTargetRef = (
  context: AssessmentEngineContextV1,
  definitionType: string,
): TargetRef => {
  const member = configurationMemberFor(context, definitionType);
  if (member === undefined) {
    failRiskAssessment(
      "risk-assessment-snapshot-incomplete",
      context.basis.applicableRuleSetMember.releaseRef,
    );
  }
  return member.releaseRef;
};

function fail(reasonCode: RiskAssessmentReasonCodeV1, targetRef: TargetRef): never {
  return failRiskAssessment(reasonCode, targetRef);
}

/* -------------------------------------------------------------------------- */
/* 适用性匹配与监测需求                                                        */
/* -------------------------------------------------------------------------- */

const conditionMatches = (
  condition: ApplicabilityConditionV1,
  applicability: ApplicabilityMetadata,
): boolean => {
  const actual =
    condition.dimension === "施工工法数据"
      ? applicability.constructionMethod
      : condition.dimension === "地层条件数据"
        ? applicability.stratumCondition
        : applicability.engineeringStage;
  return condition.values.includes(actual);
};

const conditionsMatch = (
  conditions: readonly ApplicabilityConditionV1[],
  applicability: ApplicabilityMetadata,
): boolean => conditions.every((condition) => conditionMatches(condition, applicability));

const metricFieldOf = (
  metric: Exclude<AssessmentConfigurationMetricV1, "value">,
): "shortTermSlope" | "acceleration" | "dominantFrequency" | "anomalyScore" =>
  metric === "short-term-slope"
    ? "shortTermSlope"
    : metric === "acceleration"
      ? "acceleration"
      : metric === "dominant-frequency"
        ? "dominantFrequency"
        : "anomalyScore";

/** C18 字段映射、监测阈值共同要求的 `monitoringIndicator + parameterCode` 集合。 */
const requiredMonitoringKeys = (context: AssessmentEngineContextV1): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const mapping of context.configuration.fieldMapping.mappings) {
    if (mapping.origin.kind !== "source-field") {
      keys.add(
        monitoringSeriesKey(mapping.origin.monitoringIndicator, mapping.origin.parameterCode),
      );
    }
  }
  for (const threshold of context.configuration.monitoringWarningThreshold.thresholds) {
    keys.add(monitoringSeriesKey(threshold.monitoringIndicator, threshold.parameterCode));
  }
  return keys;
};

const assertMonitoringCoverage = (context: AssessmentEngineContextV1): void => {
  const frozen = new Set(
    (context.preparation.monitoringSnapshotRefs ?? []).map((ref) => refKey(ref)),
  );
  const provided = new Map(
    context.monitoring.map((input) => [refKey(input.snapshot.monitoringSnapshotRef), input]),
  );
  if (frozen.size !== provided.size || [...frozen].some((key) => !provided.has(key))) {
    fail("risk-assessment-snapshot-incomplete", context.preparation.riskInput);
  }
  const bySeries = new Set<string>();
  for (const input of context.monitoring) {
    const { snapshot, seriesRevision } = input;
    if (
      snapshot.projectId !== context.projectId ||
      seriesRevision.projectId !== context.projectId ||
      refKey(snapshot.monitoringSeriesRef) !== refKey(seriesRevision.monitoringSeriesRef)
    ) {
      fail("risk-assessment-series-unavailable", snapshot.monitoringSnapshotRef);
    }
    const key = monitoringSeriesKey(
      seriesRevision.monitoringIndicator,
      seriesRevision.parameterCode,
    );
    if (bySeries.has(key)) {
      fail("risk-assessment-monitoring-snapshot-coverage", seriesRevision.monitoringSeriesRef);
    }
    bySeries.add(key);
  }
  for (const key of requiredMonitoringKeys(context)) {
    if (!bySeries.has(key)) {
      fail("risk-assessment-monitoring-snapshot-coverage", context.preparation.riskInput);
    }
  }
};

const monitoringInputFor = (
  context: AssessmentEngineContextV1,
  indicator: string,
  parameterCode: string,
): AssessmentMonitoringInputV1 => {
  const key = monitoringSeriesKey(indicator, parameterCode);
  const match = context.monitoring.find(
    (input) =>
      monitoringSeriesKey(
        input.seriesRevision.monitoringIndicator,
        input.seriesRevision.parameterCode,
      ) === key,
  );
  if (match === undefined) {
    fail("risk-assessment-monitoring-snapshot-coverage", context.preparation.riskInput);
  }
  return match;
};

/** 快照 cutoff 网格点必须是 available/interpolated 且带值；不回退较早值。 */
const cutoffPoint = (
  snapshot: MonitoringSnapshotV1,
): { readonly value: number; readonly unit: string } => {
  const point = snapshot.alignedPoints.find((candidate) => candidate.sampledAt === snapshot.cutoff);
  if (
    point === undefined ||
    (point.status !== "available" && point.status !== "interpolated") ||
    point.value === null
  ) {
    fail("risk-assessment-series-unavailable", snapshot.monitoringSnapshotRef);
  }
  return { value: point.value, unit: point.unit };
};

/* -------------------------------------------------------------------------- */
/* 指标取值（D-05）                                                            */
/* -------------------------------------------------------------------------- */

const indicatorDefinition = (context: AssessmentEngineContextV1, indicatorId: string) => {
  const indicator = context.configuration.indicatorSystem.indicators.find(
    (candidate) => candidate.indicatorId === indicatorId,
  );
  if (indicator === undefined) {
    fail("risk-assessment-indicator-missing", configurationTargetRef(context, "indicator-system"));
  }
  return AssessmentIndicatorV1Schema.parse(indicator);
};

const factField = (
  context: AssessmentEngineContextV1,
  documentType: string,
  fieldPath: readonly string[],
) => {
  const key = `${documentType}\u0000${fieldPath.join("\u0000")}`;
  const match = context.facts.fields.find(
    (field) => `${field.documentType}\u0000${field.fieldPath.join("\u0000")}` === key,
  );
  if (match === undefined) {
    fail("risk-assessment-indicator-missing", context.preparation.riskInput);
  }
  return match;
};

const assertValueKind = (
  context: AssessmentEngineContextV1,
  valueKind: "numeric" | "ordinal" | "boolean",
  value: ScalarValue,
): void => {
  const matches =
    (valueKind === "numeric" && typeof value === "number") ||
    (valueKind === "ordinal" && typeof value === "string") ||
    (valueKind === "boolean" && typeof value === "boolean");
  if (!matches) {
    fail(
      "risk-assessment-input-invalid",
      configurationTargetRef(context, "indicator-field-mapping"),
    );
  }
};

const publicNumber = (
  context: AssessmentEngineContextV1,
  value: CanonicalDecimalValueV1,
  definitionType: string,
): number => {
  try {
    return decimalToExactNumber(value);
  } catch {
    return fail(
      "risk-assessment-numeric-unrepresentable",
      configurationTargetRef(context, definitionType),
    );
  }
};

const applyConversion = (
  context: AssessmentEngineContextV1,
  mapping: IndicatorFieldMappingContentV1["mappings"][number],
  raw: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => {
  if (mapping.conversion.kind === "identity") {
    if (mapping.sourceUnit !== mapping.targetUnit) {
      fail(
        "risk-assessment-unit-conflict",
        configurationTargetRef(context, "indicator-field-mapping"),
      );
    }
    return raw;
  }
  return addDecimals(
    multiplyDecimals(raw, decimalFromFiniteNumber(mapping.conversion.scale)),
    decimalFromFiniteNumber(mapping.conversion.offset),
  );
};

export const materializeIndicatorActualValues = (
  context: AssessmentEngineContextV1,
): IndicatorActualValueSetV1 => {
  assertMonitoringCoverage(context);
  const mappingByIndicator = new Map<
    string,
    IndicatorFieldMappingContentV1["mappings"][number][]
  >();
  for (const mapping of context.configuration.fieldMapping.mappings) {
    mappingByIndicator.set(mapping.targetIndicatorId, [
      ...(mappingByIndicator.get(mapping.targetIndicatorId) ?? []),
      mapping,
    ]);
  }

  const values: IndicatorActualValueV1[] = [];
  for (const indicatorId of [...ruleByIndicator(context).keys()].sort()) {
    const indicator = indicatorDefinition(context, indicatorId);
    const candidates = mappingByIndicator.get(indicatorId) ?? [];
    if (candidates.length === 0) {
      fail(
        "risk-assessment-indicator-missing",
        configurationTargetRef(context, "indicator-field-mapping"),
      );
    }
    if (candidates.length > 1) {
      fail(
        "risk-assessment-indicator-ambiguous",
        configurationTargetRef(context, "indicator-field-mapping"),
      );
    }
    const mapping = candidates[0]!;
    if (indicator.valueKind !== "numeric" && mapping.origin.kind !== "source-field") {
      fail(
        "risk-assessment-input-invalid",
        configurationTargetRef(context, "indicator-field-mapping"),
      );
    }

    if (mapping.origin.kind === "source-field") {
      const field = factField(context, mapping.origin.documentType, mapping.origin.fieldPath);
      assertValueKind(context, indicator.valueKind, field.value);
      if (indicator.valueKind !== "numeric") {
        values.push(
          IndicatorActualValueV1Schema.parse({
            indicatorId,
            indicatorType: indicator.indicatorType,
            valueKind: indicator.valueKind,
            mappingId: mapping.mappingId,
            source: {
              kind: "risk-input",
              riskInput: context.facts.riskInput,
              documentType: mapping.origin.documentType,
              fieldPath: [...mapping.origin.fieldPath],
            },
            rawValue: field.value,
            actualValue: field.value,
            canonicalValue: typeof field.value === "string" ? field.value : String(field.value),
            evidenceReferences: field.evidenceReferences,
          }),
        );
        continue;
      }
      const raw = field.value as number;
      const converted = applyConversion(context, mapping, decimalFromFiniteNumber(raw));
      values.push(
        IndicatorActualValueV1Schema.parse({
          indicatorId,
          indicatorType: indicator.indicatorType,
          valueKind: "numeric",
          mappingId: mapping.mappingId,
          source: {
            kind: "risk-input",
            riskInput: context.facts.riskInput,
            documentType: mapping.origin.documentType,
            fieldPath: [...mapping.origin.fieldPath],
          },
          rawValue: raw,
          actualValue: publicNumber(context, converted, "indicator-field-mapping"),
          canonicalValue: decimalToString(converted),
          canonicalUnit: mapping.targetUnit,
          evidenceReferences: field.evidenceReferences,
        }),
      );
      continue;
    }

    const monitoring = monitoringInputFor(
      context,
      mapping.origin.monitoringIndicator,
      mapping.origin.parameterCode,
    );
    const { snapshot, seriesRevision } = monitoring;
    if (snapshot.evidenceReferences.length === 0) {
      fail("risk-assessment-snapshot-incomplete", snapshot.monitoringSnapshotRef);
    }
    const source =
      mapping.origin.kind === "monitoring-value"
        ? (() => {
            const point = cutoffPoint(snapshot);
            if (
              point.unit !== mapping.sourceUnit ||
              seriesRevision.canonicalUnit !== mapping.sourceUnit
            ) {
              fail("risk-assessment-unit-conflict", seriesRevision.monitoringSeriesRef);
            }
            return {
              origin: {
                kind: "monitoring-value" as const,
                monitoringSnapshotRef: snapshot.monitoringSnapshotRef,
                monitoringSeriesRef: snapshot.monitoringSeriesRef,
                sampledAt: snapshot.cutoff,
              },
              rawValue: point.value,
              rawUnit: point.unit,
            };
          })()
        : (() => {
            const feature = snapshot.features[metricFieldOf(mapping.origin.metric)];
            if (feature.status !== "available" || feature.value === undefined) {
              fail("risk-assessment-series-unavailable", snapshot.monitoringSnapshotRef);
            }
            if (feature.unit === undefined || feature.unit !== mapping.sourceUnit) {
              fail("risk-assessment-unit-conflict", seriesRevision.monitoringSeriesRef);
            }
            return {
              origin: {
                kind: "monitoring-feature" as const,
                monitoringSnapshotRef: snapshot.monitoringSnapshotRef,
                monitoringSeriesRef: snapshot.monitoringSeriesRef,
                featureType: mapping.origin.metric,
              },
              rawValue: feature.value,
              rawUnit: feature.unit,
            };
          })();
    const converted = applyConversion(context, mapping, decimalFromFiniteNumber(source.rawValue));
    values.push(
      IndicatorActualValueV1Schema.parse({
        indicatorId,
        indicatorType: indicator.indicatorType,
        valueKind: "numeric",
        mappingId: mapping.mappingId,
        source: source.origin,
        rawValue: source.rawValue,
        rawUnit: source.rawUnit,
        actualValue: publicNumber(context, converted, "indicator-field-mapping"),
        canonicalValue: decimalToString(converted),
        canonicalUnit: mapping.targetUnit,
        evidenceReferences: snapshot.evidenceReferences,
      }),
    );
  }

  const content = {
    schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
    projectId: context.projectId,
    inputSnapshotRef: context.inputSnapshotRef,
    values,
  };
  const digest = sha256CanonicalJson(content);
  return IndicatorActualValueSetV1Schema.parse({
    schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
    indicatorActualValueSetRef: {
      kind: "indicator-actual-value-set",
      reference: { entityId: `indicator-actual-value-set-${digest}`, versionId: "1" },
    },
    projectId: context.projectId,
    inputSnapshotRef: context.inputSnapshotRef,
    values,
    contentDigest: digest,
  });
};

/* -------------------------------------------------------------------------- */
/* 评分（D-06）                                                                */
/* -------------------------------------------------------------------------- */

const ruleByIndicator = (
  context: AssessmentEngineContextV1,
): ReadonlyMap<
  string,
  { rule: StructuredScoringRule; member: AssessmentBasisReleaseSetMemberV1 }
> => {
  const rules = new Map<
    string,
    { rule: StructuredScoringRule; member: AssessmentBasisReleaseSetMemberV1 }
  >();
  for (const entry of context.rules) {
    for (const documentMember of entry.document.members) {
      const indicatorId = documentMember.rule.indicatorItem;
      if (rules.has(indicatorId)) fail("risk-assessment-rule-coverage", entry.member.releaseRef);
      rules.set(indicatorId, { rule: documentMember.rule, member: entry.member });
    }
  }
  return rules;
};

const scoreAxis = (
  context: AssessmentEngineContextV1,
  axis: "possibility" | "consequence",
  values: IndicatorActualValueSetV1,
): AxisScoreResultV1 => {
  const indicatorType = axis === "possibility" ? "发生可能性评估指标" : "后果严重性评估指标";
  const weights =
    axis === "possibility"
      ? context.configuration.weightSet.possibilityWeights
      : context.configuration.weightSet.consequenceWeights;
  const strategy = context.configuration.scoringStrategy[axis];
  const rulesByIndicator = ruleByIndicator(context);
  const perIndicator: ScoredIndicatorV1[] = [];

  for (const weightEntry of weights) {
    const indicator = indicatorDefinition(context, weightEntry.indicatorId);
    const score = values.values.find((value) => value.indicatorId === weightEntry.indicatorId);
    const ruleEntry = rulesByIndicator.get(weightEntry.indicatorId);
    if (
      indicator.indicatorType !== indicatorType ||
      score === undefined ||
      ruleEntry === undefined
    ) {
      fail("risk-assessment-rule-coverage", configurationTargetRef(context, "weight-set"));
    }
    const evaluation = evaluateScoringRule(ruleEntry.rule, score.actualValue);
    if (evaluation.kind !== "evaluated") {
      fail("risk-assessment-rule-coverage", ruleEntry.member.releaseRef);
    }
    const baseScore = decimalFromFiniteNumber(evaluation.score);
    const weightedScore =
      strategy.kind === "weighted-average"
        ? weightByBasisPoints(baseScore, weightEntry.basisPoints)
        : baseScore;
    perIndicator.push({
      indicatorId: weightEntry.indicatorId,
      indicatorType,
      actualValue: score.actualValue,
      baseScore,
      weightedScore,
      basisPoints: weightEntry.basisPoints,
      publicWeightedScore: decimalToNearestNumber(weightedScore),
      rule: ruleEntry.rule,
      member: ruleEntry.member,
      thresholdId: evaluation.thresholdId,
      grade: evaluation.grade,
      evidenceReferences: score.evidenceReferences,
    });
  }
  if (perIndicator.length === 0) {
    fail("risk-assessment-rule-coverage", configurationTargetRef(context, "weight-set"));
  }

  if (strategy.kind === "maximum") {
    const exact = perIndicator
      .map((item) => item.baseScore)
      .reduce((best, candidate) => (compareDecimals(candidate, best) > 0 ? candidate : best));
    return {
      scoreValue: exact,
      axis: {
        kind: "maximum",
        score: decimalToString(exact),
        publicScore: publicNumber(context, exact, "scoring-strategy"),
        contributions: perIndicator.map((item) => ({
          indicatorId: item.indicatorId,
          baseScore: decimalToString(item.baseScore),
          weightedScore: decimalToString(item.weightedScore),
        })),
      },
      perIndicator,
    };
  }

  const exact = perIndicator
    .map((item) => item.weightedScore)
    .reduce(addDecimals, { units: 0n, scale: 0 } satisfies CanonicalDecimalValueV1);
  const rounded = roundDecimal(exact, strategy.rounding.decimalScale);
  return {
    scoreValue: rounded,
    axis: {
      kind: "weighted-average",
      decimalScale: strategy.rounding.decimalScale,
      weightSetRef: context.inputSnapshot.weightSetRef,
      score: decimalToString(rounded),
      publicScore: publicNumber(context, rounded, "scoring-strategy"),
      contributions: perIndicator.map((item) => ({
        indicatorId: item.indicatorId,
        baseScore: decimalToString(item.baseScore),
        basisPoints: item.basisPoints,
        weightedScore: decimalToString(item.weightedScore),
      })),
    },
    perIndicator,
  };
};

export const scoreAssessmentAxes = (
  context: AssessmentEngineContextV1,
  values: IndicatorActualValueSetV1,
): AssessmentScoreV1 => ({
  possibility: scoreAxis(context, "possibility", values),
  consequence: scoreAxis(context, "consequence", values),
});

/* -------------------------------------------------------------------------- */
/* 矩阵映射（D-07）                                                            */
/* -------------------------------------------------------------------------- */

const bandIndex = (
  bands: RiskMatrixContentV1["possibilityAxis"]["bands"],
  value: CanonicalDecimalValueV1,
): number => {
  const lastIndex = bands.length - 1;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index]!;
    const aboveLower = compareDecimals(value, parseCanonicalDecimal(band.lower)) >= 0;
    const belowUpper =
      index === lastIndex
        ? compareDecimals(value, parseCanonicalDecimal(band.upper)) <= 0
        : compareDecimals(value, parseCanonicalDecimal(band.upper)) < 0;
    if (aboveLower && belowUpper) return index;
  }
  return -1;
};

export const mapAssessmentRiskLevel = (
  context: AssessmentEngineContextV1,
  possibility: CanonicalDecimalValueV1,
  consequence: CanonicalDecimalValueV1,
): MatrixMappingV1 => {
  const matrix = context.configuration.riskMatrix;
  const targetRef = configurationTargetRef(context, "risk-matrix");
  const possibilityText = canonicalDecimalStringOf(possibility);
  const consequenceText = canonicalDecimalStringOf(consequence);
  let possibilityBandId: string;
  let consequenceBandId: string;
  if (possibilityText !== undefined && consequenceText !== undefined) {
    const cell = ((): { possibilityBandId: string; consequenceBandId: string } => {
      try {
        return mapRiskMatrixCell(matrix, possibilityText, consequenceText);
      } catch {
        return fail("risk-assessment-matrix-out-of-range", targetRef);
      }
    })();
    possibilityBandId = cell.possibilityBandId;
    consequenceBandId = cell.consequenceBandId;
  } else {
    const possibilityBand =
      matrix.possibilityAxis.bands[bandIndex(matrix.possibilityAxis.bands, possibility)];
    const consequenceBand =
      matrix.consequenceAxis.bands[bandIndex(matrix.consequenceAxis.bands, consequence)];
    if (possibilityBand === undefined || consequenceBand === undefined) {
      fail("risk-assessment-matrix-out-of-range", targetRef);
    }
    possibilityBandId = possibilityBand.bandId;
    consequenceBandId = consequenceBand.bandId;
  }
  const cell = matrix.cells.find(
    (candidate) =>
      candidate.possibilityBandId === possibilityBandId &&
      candidate.consequenceBandId === consequenceBandId,
  );
  if (cell === undefined) fail("risk-assessment-matrix-out-of-range", targetRef);
  const level = matrix.riskLevels.find((candidate) => candidate.levelId === cell.riskLevelId);
  if (level === undefined) fail("risk-assessment-matrix-out-of-range", targetRef);
  return {
    possibilityBandId,
    consequenceBandId,
    riskLevelId: level.levelId,
    riskLevelOrdinal: level.ordinal,
  };
};

/* -------------------------------------------------------------------------- */
/* 四类触发（D-07）                                                            */
/* -------------------------------------------------------------------------- */

const comparisonMatches = (
  comparison: MonitoringWarningComparisonV1,
  actual: CanonicalDecimalValueV1,
): { readonly hit: boolean; readonly thresholdValue: string } => {
  if (comparison.operator === "outside") {
    const inside =
      compareDecimals(actual, parseCanonicalDecimal(comparison.lower)) >= 0 &&
      compareDecimals(actual, parseCanonicalDecimal(comparison.upper)) <= 0;
    return { hit: !inside, thresholdValue: `${comparison.lower}..${comparison.upper}` };
  }
  const order = compareDecimals(actual, parseCanonicalDecimal(comparison.boundary));
  const hit =
    comparison.operator === "gt"
      ? order > 0
      : comparison.operator === "gte"
        ? order >= 0
        : comparison.operator === "lt"
          ? order < 0
          : order <= 0;
  return { hit, thresholdValue: `${comparison.operator}:${comparison.boundary}` };
};

const thresholdActualValue = (
  context: AssessmentEngineContextV1,
  threshold: MonitoringWarningThresholdContentV1["thresholds"][number],
): { readonly value: CanonicalDecimalValueV1; readonly evidence: readonly EvidenceReference[] } => {
  const { snapshot, seriesRevision } = monitoringInputFor(
    context,
    threshold.monitoringIndicator,
    threshold.parameterCode,
  );
  if (threshold.metric === "value") {
    if (threshold.unit !== seriesRevision.canonicalUnit) {
      fail("risk-assessment-unit-conflict", seriesRevision.monitoringSeriesRef);
    }
    const point = cutoffPoint(snapshot);
    return { value: decimalFromFiniteNumber(point.value), evidence: snapshot.evidenceReferences };
  }
  const feature = snapshot.features[metricFieldOf(threshold.metric)];
  if (feature.status !== "available" || feature.value === undefined) {
    fail("risk-assessment-series-unavailable", snapshot.monitoringSnapshotRef);
  }
  if (feature.unit === undefined || feature.unit !== threshold.unit) {
    fail("risk-assessment-unit-conflict", seriesRevision.monitoringSeriesRef);
  }
  return { value: decimalFromFiniteNumber(feature.value), evidence: snapshot.evidenceReferences };
};

export const evaluateAssessmentTriggers = (
  context: AssessmentEngineContextV1,
  matrix: MatrixMappingV1,
): readonly AssessmentTriggerFactV1[] => {
  const facts: AssessmentTriggerFactV1[] = [];
  const acceptances = context.configuration.riskAcceptanceThreshold.thresholds.filter((threshold) =>
    conditionsMatch(threshold.applicabilityConditions, context.applicability),
  );
  if (acceptances.length !== 1) {
    fail(
      "risk-assessment-threshold-ambiguous",
      configurationTargetRef(context, "risk-acceptance-threshold"),
    );
  }
  const acceptance = acceptances[0]!;
  const acceptedLevel = context.configuration.riskMatrix.riskLevels.find(
    (level) => level.levelId === acceptance.maximumAcceptedLevelId,
  );
  if (acceptedLevel === undefined) {
    fail(
      "risk-assessment-threshold-ambiguous",
      configurationTargetRef(context, "risk-acceptance-threshold"),
    );
  }
  if (matrix.riskLevelOrdinal > acceptedLevel.ordinal) {
    facts.push({
      triggerType: "风险等级超过风险可接受阈值",
      identity: acceptance.thresholdId,
      indicatorItem: acceptance.thresholdId,
      actualValue: matrix.riskLevelId,
      thresholdValue: String(acceptedLevel.ordinal),
      evidenceReferences: context.facts.evidenceReferences,
    });
  }

  const hitThresholdIds = new Set<string>();
  for (const threshold of context.configuration.monitoringWarningThreshold.thresholds) {
    const actual = thresholdActualValue(context, threshold);
    const comparison = comparisonMatches(threshold.comparison, actual.value);
    if (!comparison.hit) continue;
    hitThresholdIds.add(threshold.thresholdId);
    facts.push({
      triggerType: threshold.metric === "value" ? "监测指标越限" : "趋势/加速度/异常评分越限",
      identity: threshold.thresholdId,
      indicatorItem: threshold.thresholdId,
      thresholdId: threshold.thresholdId,
      monitoringIndicator: threshold.monitoringIndicator,
      parameterCode: threshold.parameterCode,
      metric: threshold.metric,
      actualValue: decimalToNearestNumber(actual.value),
      thresholdValue: comparison.thresholdValue,
      evidenceReferences: [...actual.evidence],
    });
  }

  const thresholdsById = new Map(
    context.configuration.monitoringWarningThreshold.thresholds.map((threshold) => [
      threshold.thresholdId,
      threshold,
    ]),
  );
  for (const rule of context.configuration.jointTriggerPolicy.rules) {
    if (!conditionsMatch(rule.applicabilityConditions, context.applicability)) continue;
    for (const thresholdId of rule.monitoringThresholdIds) {
      if (!thresholdsById.has(thresholdId)) {
        fail(
          "risk-assessment-threshold-ambiguous",
          configurationTargetRef(context, "joint-trigger-policy"),
        );
      }
    }
    const matched = rule.monitoringThresholdIds.filter((thresholdId) =>
      hitThresholdIds.has(thresholdId),
    );
    const hit =
      rule.operator === "all-of"
        ? matched.length === rule.monitoringThresholdIds.length
        : rule.operator === "any-of"
          ? matched.length >= 1
          : matched.length >= rule.count;
    if (!hit) continue;
    const evidence = new Map<string, EvidenceReference>();
    for (const fact of facts) {
      if (fact.triggerType === "风险等级超过风险可接受阈值") continue;
      if (!rule.monitoringThresholdIds.includes(fact.identity)) continue;
      for (const evidenceRef of fact.evidenceReferences) {
        evidence.set(evidenceKeyOf(evidenceRef), evidenceRef);
      }
    }
    facts.push({
      triggerType: "多指标联合规则命中",
      identity: rule.ruleId,
      indicatorItem: rule.ruleId,
      jointRuleId: rule.ruleId,
      actualValue: matched.length,
      thresholdValue: `${rule.operator}:${matched.length}`,
      evidenceReferences: [...evidence.values()],
    });
  }

  const deduped = new Map<string, AssessmentTriggerFactV1>();
  for (const fact of facts) deduped.set(`${fact.triggerType}\u0000${fact.identity}`, fact);
  return [...deduped.values()].sort((left, right) => {
    const leftKey = `${left.triggerType}\u0000${left.identity}`;
    const rightKey = `${right.triggerType}\u0000${right.identity}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
};

/* -------------------------------------------------------------------------- */
/* 记录装配与总入口（D-08）                                                    */
/* -------------------------------------------------------------------------- */

export const buildRiskAssessmentRecord = (
  context: AssessmentEngineContextV1,
  input: {
    readonly score: AssessmentScoreV1;
    readonly matrix: MatrixMappingV1;
    readonly triggers: readonly AssessmentTriggerFactV1[];
    readonly recordId: string;
    readonly audit: RiskAssessmentAuditV1;
  },
): RiskAssessmentRecord => {
  const evidence = new Map<string, EvidenceReference>();
  for (const item of [
    ...input.score.possibility.perIndicator,
    ...input.score.consequence.perIndicator,
  ]) {
    for (const evidenceRef of item.evidenceReferences) {
      evidence.set(evidenceKeyOf(evidenceRef), evidenceRef);
    }
  }
  for (const trigger of input.triggers) {
    for (const evidenceRef of trigger.evidenceReferences) {
      evidence.set(evidenceKeyOf(evidenceRef), evidenceRef);
    }
  }
  if (evidence.size === 0) {
    fail("risk-assessment-indicator-missing", context.preparation.riskInput);
  }
  const riskInput = context.facts.riskInput;
  const base = {
    assessmentRecordId: input.recordId,
    applicabilityMetadataSnapshot: {
      constructionMethod: context.applicability.constructionMethod,
      stratumCondition: context.applicability.stratumCondition,
      engineeringStage: context.applicability.engineeringStage,
    },
    likelihoodScore: input.score.possibility.axis.publicScore,
    consequenceScore: input.score.consequence.axis.publicScore,
    riskLevel: input.matrix.riskLevelId,
    indicatorResults: [
      ...input.score.possibility.perIndicator,
      ...input.score.consequence.perIndicator,
    ]
      .sort((left, right) => (left.indicatorId < right.indicatorId ? -1 : 1))
      .map((item) => ({
        indicatorItem: item.indicatorId,
        actualValue: item.actualValue,
        baseScore: decimalToNearestNumber(item.baseScore),
        weightedScore: item.publicWeightedScore,
        ruleVersion: item.rule.ruleVersion,
        evidenceReferences: [...item.evidenceReferences],
      })),
    triggerIndicators: input.triggers.map((trigger) => ({
      indicatorItem: trigger.indicatorItem,
      triggerType: trigger.triggerType,
      ...(trigger.actualValue === undefined ? {} : { actualValue: trigger.actualValue }),
    })),
    evidenceReferences: [...evidence.values()],
    applicableRuleSetVersion: context.basis.applicableRuleSetMember.releaseRef.reference,
    weightVersion: context.inputSnapshot.weightSetRef,
    riskMatrixVersion: context.inputSnapshot.riskMatrixRef,
    audit: {
      actorId: input.audit.actorId,
      action: "risk-assessment.record",
      recordedAt: input.audit.recordedAt,
    },
  };
  return RiskAssessmentRecordSchema.parse(
    riskInput.kind === "standardized-risk-record"
      ? {
          ...base,
          kind: "standardized-risk-record" as const,
          riskRecordId: riskInput.reference.entityId,
        }
      : {
          ...base,
          kind: "external-risk-event" as const,
          externalRiskEventId: riskInput.reference.entityId,
        },
  );
};

const configurationRef = (
  context: AssessmentEngineContextV1,
  definitionType: string,
): VersionReference => {
  const member = configurationMemberFor(context, definitionType);
  if (member === undefined) {
    return failRiskAssessment(
      "risk-assessment-snapshot-incomplete",
      context.basis.applicableRuleSetMember.releaseRef,
    );
  }
  return member.releaseRef.reference;
};

export const evaluateDeterministicAssessment = (
  context: AssessmentEngineContextV1,
  audit: RiskAssessmentAuditV1,
): DeterministicAssessmentV1 => {
  const valueSet = materializeIndicatorActualValues(context);
  const score = scoreAssessmentAxes(context, valueSet);
  const matrix = mapAssessmentRiskLevel(
    context,
    score.possibility.scoreValue,
    score.consequence.scoreValue,
  );
  const triggers = evaluateAssessmentTriggers(context, matrix);
  const recordId = `risk-assessment-record-${sha256CanonicalJson({
    projectId: context.projectId,
    inputSnapshotRef: context.inputSnapshotRef,
    valueSetDigest: valueSet.contentDigest,
  })}`;
  const decisionContent = {
    schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
    projectId: context.projectId,
    preparationSnapshotRef: context.preparationSnapshotRef,
    inputSnapshotRef: context.inputSnapshotRef,
    assessmentBasisReleaseSetRef: context.assessmentBasisReleaseSetRef,
    riskInput: context.facts.riskInput,
    applicability: context.applicability,
    indicatorActualValueSetDigest: valueSet.contentDigest,
    axisScores: { possibility: score.possibility.axis, consequence: score.consequence.axis },
    matrix: { riskMatrixRef: context.inputSnapshot.riskMatrixRef, ...matrix },
    rules: [...score.possibility.perIndicator, ...score.consequence.perIndicator]
      .sort((left, right) => (left.indicatorId < right.indicatorId ? -1 : 1))
      .map((item) => ({
        indicatorId: item.indicatorId,
        ruleId: item.rule.ruleId,
        ruleVersion: item.rule.ruleVersion,
        releaseRef: item.member.releaseRef,
        revisionRef: item.member.revisionRef,
        artifactRef: item.member.artifactRef,
        contentDigest: item.member.contentDigest,
        thresholdId: item.thresholdId,
        grade: item.grade,
        baseScore: decimalToString(item.baseScore),
      })),
    triggers: [...triggers],
    configurationRefs: {
      indicatorSystemRef: configurationRef(context, "indicator-system"),
      indicatorFieldMappingRef: configurationRef(context, "indicator-field-mapping"),
      weightSetRef: configurationRef(context, "weight-set"),
      scoringStrategyRef: configurationRef(context, "scoring-strategy"),
      riskAcceptanceThresholdRef: configurationRef(context, "risk-acceptance-threshold"),
      monitoringWarningThresholdRef: configurationRef(context, "monitoring-warning-threshold"),
      jointTriggerPolicyRef: configurationRef(context, "joint-trigger-policy"),
    },
  } satisfies Record<string, unknown>;
  const decision = AssessmentDecisionArtifactV1Schema.parse(decisionContent);
  const decisionDigest = sha256CanonicalJson(decision);
  const record = buildRiskAssessmentRecord(context, { score, matrix, triggers, recordId, audit });
  const recordDigest = sha256CanonicalJson(
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== "audit")),
  );
  return {
    valueSet,
    decision,
    decisionRef: {
      kind: "assessment-decision-artifact",
      reference: { entityId: `assessment-decision-artifact-${decisionDigest}`, versionId: "1" },
    },
    decisionDigest,
    record,
    recordRef: {
      kind: "risk-assessment-record",
      reference: { entityId: recordId, versionId: "1" },
    },
    recordDigest,
  };
};
