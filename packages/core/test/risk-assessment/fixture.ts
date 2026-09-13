/**
 * C25 core fixture：合成样本、待甲方复核。所有取值都通过公共 strict Schema 构造，
 * 只用于确定性边界验证；不进入生产导出，也不构成生产 seed 或内存事实源。
 */
import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AssessmentBasisReleaseSetRefV1,
  AssessmentInputSnapshotRefV1,
  AssessmentPreparationSnapshotRefV1,
  AuthorizationContextRefV1,
  AuditTrailRefV1,
  ContentArtifactRefV1,
  KnowledgeReleaseRefV1,
  KnowledgeRevisionRefV1,
  ProjectRevisionRefV1,
  SpatialScopeRefV1,
  StandardizedRiskRecordRefV1,
} from "@riskflow/contracts/ports";
import {
  AssessmentInputSnapshotV1Schema,
  AssessmentPreparationSnapshotV1Schema,
  type AssessmentInputSnapshotV1,
  type AssessmentPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";
import { ApplicabilityMetadataSchema } from "@riskflow/contracts/records";
import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  AssessmentConfigurationDocumentV1Schema,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
} from "../../src/assessment-config/index.js";
import {
  MonitoringSeriesRevisionReadV1Schema,
  MonitoringSnapshotV1Schema,
  type MonitoringFeatureResultV1,
  type MonitoringSeriesRevisionReadV1,
  type MonitoringSnapshotV1,
} from "../../src/engineering-data/monitoring/index.js";
import { sha256CanonicalJson } from "../../src/persistence/index.js";
import {
  ApplicableRuleSetDocumentV1Schema,
  StructuredScoringRuleDocumentV1Schema,
  type ApplicableRuleSetDocumentV1,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type StructuredScoringRuleDocumentV1,
} from "../../src/scoring-rules/index.js";
import {
  AssessmentRuntimePolicySetV1Schema,
  RiskInputFactsV1Schema,
  type AssessmentRuntimePolicySetV1,
  type RiskInputFactsV1,
} from "../../src/risk-assessment/engine/index.js";
import type {
  AssessmentConfigurationV1,
  AssessmentEngineContextV1,
  AssessmentMonitoringInputV1,
} from "../../src/risk-assessment/engine/index.js";
import { makeAssessmentConfigurationFixtureSet } from "../assessment-config/fixture.js";

export const C25_FIXTURE_PROJECT_ID = "risk-assessment-project";
export const C25_FIXTURE_AT = "2026-09-13T00:00:00.000Z";
export const C25_FIXTURE_CUTOFF = "2026-09-13T01:00:00.000Z";
/** 评估调用的审计主体与记录时间（与准备阶段主体刻意不同，用于双主体/双时间用例）。 */
export const C25_FIXTURE_RECORD_AUDIT = {
  actorId: "actor-c25-evaluate",
  recordedAt: "2026-09-13T02:00:00.000Z",
} as const;

export const C25_FIXTURE_PROJECT_REVISION: ProjectRevisionRefV1 = {
  kind: "project-revision",
  reference: { entityId: "project-revision-c25", versionId: "1" },
};

const versioned = <const K extends string>(kind: K, entityId: string, versionId = "1") => ({
  kind,
  reference: { entityId, versionId },
});

export const c25Version = (entityId: string, versionId = "1"): VersionReference => ({
  entityId,
  versionId,
});

export const c25ReleaseRef = (definitionType: string): KnowledgeReleaseRefV1 =>
  versioned("knowledge-release", `release-${definitionType}`);

export const c25RevisionRef = (definitionType: string): KnowledgeRevisionRefV1 =>
  versioned("knowledge-revision", `revision-${definitionType}`);

export const c25ArtifactRef = (definitionType: string): ContentArtifactRefV1 =>
  versioned("content-artifact", `artifact-${definitionType}`);

export const c25Digest = (value: unknown): string => sha256CanonicalJson(value);

export const c25Evidence = (sourceSegmentId: string, versionId = "1"): EvidenceReference => ({
  locator: { sourceSegmentId },
  sourceVersion: { entityId: `source-version-${sourceSegmentId}`, versionId },
});

export const C25_FIXTURE_RISK_RECORD_REF: StandardizedRiskRecordRefV1 = versioned(
  "standardized-risk-record",
  "risk-record-c25",
);

export const C25_FIXTURE_PREPARATION_REF: AssessmentPreparationSnapshotRefV1 = versioned(
  "assessment-preparation-snapshot",
  "assessment-preparation-c25",
);

export const C25_FIXTURE_INPUT_SNAPSHOT_REF: AssessmentInputSnapshotRefV1 = versioned(
  "assessment-input-snapshot",
  "assessment-input-c25",
);

export const C25_FIXTURE_BASIS_REF: AssessmentBasisReleaseSetRefV1 = versioned(
  "assessment-basis-release-set",
  "assessment-basis-c25",
);

export const C25_FIXTURE_APPLICABILITY_REF: ApplicabilityMetadataSnapshotRefV1 = versioned(
  "applicability-metadata-snapshot",
  "applicability-c25",
);

export const C25_FIXTURE_SPATIAL_SCOPE: SpatialScopeRefV1 = versioned(
  "spatial-scope",
  "spatial-scope-c25",
);

export const C25_FIXTURE_AUTHORIZATION_REF: AuthorizationContextRefV1 = versioned(
  "authorization-context",
  "authorization-c25",
);

export const C25_FIXTURE_AUDIT_REF: AuditTrailRefV1 = versioned("audit-trail", "audit-c25");

export const C25_FIXTURE_APPLICABILITY = ApplicabilityMetadataSchema.parse({
  constructionMethod: "盾构法",
  stratumCondition: "地层-a",
  engineeringStage: "掘进",
});

/**
 * C25 配置正文：C18 合成集合的矩阵、阈值、联合规则、措施库与策略沿用其公共 strict Schema，
 * 指标系统/字段映射/权重/评分策略按 C25 取值管线的“每指标恰好一条映射”要求重新定义。
 * 全部为合成样本、待甲方复核。
 */
const c25ConfigurationContents = (): Readonly<Record<string, unknown>> => {
  const reused = makeAssessmentConfigurationFixtureSet({
    projectId: C25_FIXTURE_PROJECT_ID,
  }).documents;
  return {
    "indicator-system": {
      indicators: [
        {
          indicatorId: "indicator-consequence-1",
          indicatorType: "后果严重性评估指标",
          group: "监测量测与周边环境",
          applicabilityConditions: [],
          quantizationIntervalRef: c25Version("quantization-interval-synthetic"),
          valueKind: "numeric",
          canonicalUnit: "mm",
        },
        {
          indicatorId: "indicator-possibility-1",
          indicatorType: "发生可能性评估指标",
          group: "地质与围岩条件",
          applicabilityConditions: [{ dimension: "地层条件数据", values: ["地层-a"] }],
          quantizationIntervalRef: c25Version("quantization-interval-synthetic"),
          valueKind: "numeric",
          canonicalUnit: "1",
        },
        {
          indicatorId: "indicator-possibility-2",
          indicatorType: "发生可能性评估指标",
          group: "开挖与支护参数",
          applicabilityConditions: [],
          quantizationIntervalRef: c25Version("quantization-interval-synthetic"),
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
          mappingId: "mapping-possibility-document",
          targetIndicatorId: "indicator-possibility-1",
          origin: {
            kind: "source-field",
            documentType: "geology-report",
            fieldPath: ["strata", "layer", "gradeIndex"],
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
      sourceRef: c25Version("weight-source-synthetic"),
      possibilityWeights: [
        { indicatorId: "indicator-possibility-1", basisPoints: 4000 },
        { indicatorId: "indicator-possibility-2", basisPoints: 6000 },
      ],
      consequenceWeights: [{ indicatorId: "indicator-consequence-1", basisPoints: 10000 }],
    },
    "scoring-strategy": {
      possibility: {
        kind: "weighted-average",
        weightSetRef: c25Version("weight-set-synthetic"),
        rounding: { mode: "half-away-from-zero", decimalScale: 2 },
      },
      consequence: { kind: "maximum" },
    },
    "risk-matrix": reused["risk-matrix"].content,
    "risk-acceptance-threshold": reused["risk-acceptance-threshold"].content,
    "monitoring-warning-threshold": reused["monitoring-warning-threshold"].content,
    "joint-trigger-policy": reused["joint-trigger-policy"].content,
    "measure-library": reused["measure-library"].content,
    "forecast-policy": reused["forecast-policy"].content,
    "deviation-policy": reused["deviation-policy"].content,
  };
};

export const c25ConfigurationDocument = (
  definitionType: string,
  content: unknown,
): AssessmentConfigurationDocumentV1 =>
  AssessmentConfigurationDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType,
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    configurationSetRef: c25Version("configuration-set-c25"),
    content,
  });

export const c25ConfigurationDocuments = (): Readonly<
  Record<AssessmentConfigurationDefinitionTypeV1, AssessmentConfigurationDocumentV1>
> =>
  Object.fromEntries(
    ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map((definitionType) => [
      definitionType,
      c25ConfigurationDocument(definitionType, c25ConfigurationContents()[definitionType]),
    ]),
  ) as Readonly<Record<AssessmentConfigurationDefinitionTypeV1, AssessmentConfigurationDocumentV1>>;

/** C25 侧 11 类配置成员投影；摘要只用于身份核对，核心测试不读取正文。 */
export const c25ConfigurationMembers = (): readonly AssessmentBasisConfigurationMemberV1[] =>
  Object.values(c25ConfigurationDocuments())
    .map((document) => ({
      definitionType: document.definitionType,
      releaseRef: c25ReleaseRef(document.definitionType),
      revisionRef: c25RevisionRef(document.definitionType),
      artifactRef: c25ArtifactRef(document.definitionType),
      contentDigest: c25Digest(document),
    }))
    .sort((left, right) => (left.definitionType < right.definitionType ? -1 : 1));

export const c25Configuration = (): AssessmentConfigurationV1 => {
  const documents = c25ConfigurationDocuments();
  return {
    indicatorSystem: documents["indicator-system"].content,
    fieldMapping: documents["indicator-field-mapping"].content,
    weightSet: documents["weight-set"].content,
    scoringStrategy: documents["scoring-strategy"].content,
    riskMatrix: documents["risk-matrix"].content,
    riskAcceptanceThreshold: documents["risk-acceptance-threshold"].content,
    monitoringWarningThreshold: documents["monitoring-warning-threshold"].content,
    jointTriggerPolicy: documents["joint-trigger-policy"].content,
  };
};

/** 覆盖单一定义正文时仍经公共 strict Schema 解析，避免夹具绕过契约。 */
export const c25ConfigurationContent = <T extends AssessmentConfigurationDefinitionTypeV1>(
  definitionType: T,
  content: unknown,
): Extract<AssessmentConfigurationDocumentV1, { definitionType: T }>["content"] =>
  c25ConfigurationDocument(definitionType, content).content as Extract<
    AssessmentConfigurationDocumentV1,
    { definitionType: T }
  >["content"];

export interface ScoringRuleFixtureV1 {
  readonly indicatorId: string;
  readonly ruleId: string;
  readonly thresholds: readonly {
    readonly thresholdId: string;
    readonly operator: "lt" | "lte" | "gt" | "gte" | "between" | "eq";
    readonly value: string | number | boolean;
    readonly upperValue?: number;
    readonly score: number;
  }[];
  readonly grades: readonly {
    readonly grade: string;
    readonly lowerBound?: number;
    readonly upperBound?: number;
  }[];
}

export const C25_FIXTURE_RULES: readonly ScoringRuleFixtureV1[] = [
  {
    indicatorId: "indicator-possibility-1",
    ruleId: "rule-possibility-1",
    thresholds: [
      { thresholdId: "p1-low", operator: "lt", value: 3, score: 2 },
      { thresholdId: "p1-high", operator: "gte", value: 3, score: 4 },
    ],
    grades: [
      { grade: "p1-grade-low", upperBound: 3 },
      { grade: "p1-grade-high", lowerBound: 3 },
    ],
  },
  {
    indicatorId: "indicator-possibility-2",
    ruleId: "rule-possibility-2",
    thresholds: [
      { thresholdId: "p2-low", operator: "lt", value: 2, score: 1 },
      { thresholdId: "p2-mid", operator: "between", value: 2, upperValue: 5, score: 3 },
      { thresholdId: "p2-high", operator: "gte", value: 5, score: 5 },
    ],
    grades: [
      { grade: "p2-grade-low", upperBound: 2 },
      { grade: "p2-grade-mid", lowerBound: 2, upperBound: 5 },
      { grade: "p2-grade-high", lowerBound: 5 },
    ],
  },
  {
    indicatorId: "indicator-consequence-1",
    ruleId: "rule-consequence-1",
    thresholds: [
      { thresholdId: "c1-low", operator: "lt", value: 10, score: 1 },
      { thresholdId: "c1-mid", operator: "between", value: 10, upperValue: 40, score: 3 },
      { thresholdId: "c1-high", operator: "gte", value: 40, score: 5 },
    ],
    grades: [
      { grade: "c1-grade-low", upperBound: 10 },
      { grade: "c1-grade-mid", lowerBound: 10, upperBound: 40 },
      { grade: "c1-grade-high", lowerBound: 40 },
    ],
  },
];

export const c25RuleDocument = (fixture: ScoringRuleFixtureV1): StructuredScoringRuleDocumentV1 =>
  StructuredScoringRuleDocumentV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    configurationSetRef: c25Version("configuration-set-c25"),
    compatibilityRef: c25Version("compatibility-c25"),
    scoringPolicyRef: c25Version("scoring-policy-c25"),
    cleaningResultArtifactRef: c25ArtifactRef("cleaning-result"),
    agentTaskRef: {
      kind: "agent-task",
      reference: { entityId: `agent-task-${fixture.ruleId}`, versionId: "1" },
      taskType: "knowledge-authoring",
      triggerMode: "embedded",
      modelDeploymentRef: c25Version("model-deployment-c25"),
      promptTemplateRef: c25Version("prompt-template-c25"),
      toolPolicyRef: c25Version("tool-policy-c25"),
      budgetPolicyRef: c25Version("budget-policy-c25"),
      incrementSchemaRef: c25Version("increment-schema-c25"),
      validationPolicyRef: c25Version("validation-policy-c25"),
    },
    members: [
      {
        rule: {
          ruleId: fixture.ruleId,
          applicabilityConditions: {
            constructionMethod: [C25_FIXTURE_APPLICABILITY.constructionMethod],
            stratumCondition: [C25_FIXTURE_APPLICABILITY.stratumCondition],
            engineeringStage: [C25_FIXTURE_APPLICABILITY.engineeringStage],
          },
          indicatorItem: fixture.indicatorId,
          scoringThresholds: fixture.thresholds.map((threshold) =>
            threshold.operator === "between"
              ? {
                  thresholdId: threshold.thresholdId,
                  score: threshold.score,
                  operator: "between",
                  value: threshold.value as number,
                  upperValue: threshold.upperValue as number,
                }
              : {
                  thresholdId: threshold.thresholdId,
                  score: threshold.score,
                  operator: threshold.operator,
                  value: threshold.value,
                },
          ),
          gradeIntervals: fixture.grades.map((grade) => ({
            grade: grade.grade,
            ...(grade.lowerBound === undefined ? {} : { lowerBound: grade.lowerBound }),
            ...(grade.upperBound === undefined ? {} : { upperBound: grade.upperBound }),
          })),
          exceptionClauses: [],
          evidenceLocator: { sourceSegmentId: `segment-${fixture.ruleId}` },
          ruleVersion: c25Version(fixture.ruleId),
          reviewStatus: "approved",
        },
        binding: {
          sourceVersionRef: versioned("source-version", `source-version-${fixture.ruleId}`),
          cleaningResultArtifactRef: c25ArtifactRef("cleaning-result"),
          evidenceReferences: [c25Evidence(`segment-${fixture.ruleId}`)],
          agentTaskRef: {
            kind: "agent-task",
            reference: { entityId: `agent-task-${fixture.ruleId}`, versionId: "1" },
            taskType: "knowledge-authoring",
            triggerMode: "embedded",
            modelDeploymentRef: c25Version("model-deployment-c25"),
            promptTemplateRef: c25Version("prompt-template-c25"),
            toolPolicyRef: c25Version("tool-policy-c25"),
            budgetPolicyRef: c25Version("budget-policy-c25"),
            incrementSchemaRef: c25Version("increment-schema-c25"),
            validationPolicyRef: c25Version("validation-policy-c25"),
          },
        },
      },
    ],
  });

export const c25ScoringRuleMembers = (
  rules: readonly ScoringRuleFixtureV1[] = C25_FIXTURE_RULES,
): readonly AssessmentBasisReleaseSetMemberV1[] =>
  [...rules]
    .sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1))
    .map((rule) => ({
      releaseRef: c25ReleaseRef(rule.ruleId),
      revisionRef: c25RevisionRef(rule.ruleId),
      artifactRef: c25ArtifactRef(rule.ruleId),
      contentDigest: c25Digest(c25RuleDocument(rule)),
    }));

export const c25Rules = (
  rules: readonly ScoringRuleFixtureV1[] = C25_FIXTURE_RULES,
): AssessmentEngineContextV1["rules"] =>
  rules.map((rule) => ({
    member: {
      releaseRef: c25ReleaseRef(rule.ruleId),
      revisionRef: c25RevisionRef(rule.ruleId),
      artifactRef: c25ArtifactRef(rule.ruleId),
      contentDigest: c25Digest(c25RuleDocument(rule)),
    },
    document: c25RuleDocument(rule),
  }));

export const c25ApplicableRuleSet = (
  rules: readonly ScoringRuleFixtureV1[] = C25_FIXTURE_RULES,
): ApplicableRuleSetDocumentV1 =>
  ApplicableRuleSetDocumentV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    applicabilitySnapshotRef: C25_FIXTURE_APPLICABILITY_REF,
    applicability: C25_FIXTURE_APPLICABILITY,
    configurationSetRef: c25Version("configuration-set-c25"),
    compatibilityRef: c25Version("compatibility-c25"),
    assemblyPolicyRef: c25Version("assembly-policy-c25"),
    requiredAt: C25_FIXTURE_AT,
    includedMembers: [...rules]
      .sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1))
      .map((rule) => ({
        ruleId: rule.ruleId,
        ruleVersion: c25Version(rule.ruleId),
        releaseRef: c25ReleaseRef(rule.ruleId),
        revisionRef: c25RevisionRef(rule.ruleId),
        artifactRef: c25ArtifactRef(rule.ruleId),
        contentDigest: c25Digest(c25RuleDocument(rule)),
      })),
    decisions: [...rules]
      .sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1))
      .map((rule) => ({
        ruleId: rule.ruleId,
        ruleVersion: c25Version(rule.ruleId),
        decision: "included",
        reasonCode: "three-dimensional-match",
        matchedDimensions: ["施工工法数据", "地层条件数据", "工程阶段数据"],
        ruleReleaseRef: c25ReleaseRef(rule.ruleId),
        ruleRevisionRef: c25RevisionRef(rule.ruleId),
        artifactRef: c25ArtifactRef(rule.ruleId),
        relationRefs: [],
      })),
  });

export const c25RuntimePolicySet = (
  overrides: Partial<AssessmentRuntimePolicySetV1> = {},
): AssessmentRuntimePolicySetV1 =>
  AssessmentRuntimePolicySetV1Schema.parse({
    schemaVersion: "1",
    projectId: C25_FIXTURE_PROJECT_ID,
    warningAggregationPolicyRef: c25Version("warning-aggregation-policy"),
    notificationPolicyRef: c25Version("notification-policy"),
    responseGenerationPolicyRef: c25Version("response-generation-policy"),
    responseValidationPolicyRef: c25Version("response-validation-policy"),
    responseAgentPolicyRef: c25Version("response-agent-policy"),
    calibrationAgentPolicyRef: c25Version("calibration-agent-policy"),
    retryPolicyRef: c25Version("retry-policy"),
    reviewPolicyRef: c25Version("review-policy"),
    modelDeploymentRef: c25Version("model-deployment"),
    promptTemplateRef: c25Version("prompt-template"),
    ...overrides,
  });

export const c25Facts = (overrides: Partial<RiskInputFactsV1> = {}): RiskInputFactsV1 =>
  RiskInputFactsV1Schema.parse({
    schemaVersion: "1",
    projectId: C25_FIXTURE_PROJECT_ID,
    riskInput: C25_FIXTURE_RISK_RECORD_REF,
    fields: [
      {
        documentType: "geology-report",
        fieldPath: ["strata", "layer", "gradeIndex"],
        value: 2,
        evidenceReferences: [c25Evidence("geology-segment")],
      },
      {
        documentType: "design-report",
        fieldPath: ["support", "pressure"],
        value: 30,
        evidenceReferences: [c25Evidence("design-segment")],
      },
    ],
    evidenceReferences: [c25Evidence("geology-segment"), c25Evidence("design-segment")],
    ...overrides,
  });

const UNAVAILABLE_FEATURE = (metric: MonitoringFeatureResultV1["featureType"]) => ({
  featureType: metric,
  windowSize: 3,
  inputCount: 3,
  algorithmVersion: "v1",
  status: "unavailable",
  reasonCode: "insufficient-samples",
});

const monitoringSeriesRevision = (input: {
  readonly entityId: string;
  readonly indicator: string;
  readonly parameterCode: string;
  readonly canonicalUnit: string;
}): MonitoringSeriesRevisionReadV1 =>
  MonitoringSeriesRevisionReadV1Schema.parse({
    monitoringSeriesRef: versioned("monitoring-series", input.entityId),
    seriesId: input.entityId,
    projectId: C25_FIXTURE_PROJECT_ID,
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    spatialScopeRef: C25_FIXTURE_SPATIAL_SCOPE,
    monitoringObject: `${input.indicator}-object`,
    monitoringIndicator: input.indicator,
    parameterCode: input.parameterCode,
    canonicalUnit: input.canonicalUnit,
    unitConversions: [],
    effectivePeriod: { validFrom: "2026-09-01T00:00:00.000Z" },
    recordedAt: "2026-09-01T00:00:00.000Z",
    status: "current",
  });

export const c25MonitoringSeries = {
  settlement: monitoringSeriesRevision({
    entityId: "monitoring-series-settlement",
    indicator: "地表沉降",
    parameterCode: "ground-settlement",
    canonicalUnit: "mm",
  }),
  waterLevel: monitoringSeriesRevision({
    entityId: "monitoring-series-water-level",
    indicator: "地下水位",
    parameterCode: "water-level",
    canonicalUnit: "m",
  }),
  cutterFrequency: monitoringSeriesRevision({
    entityId: "monitoring-series-cutter-frequency",
    indicator: "盾构姿态参数",
    parameterCode: "cutter-frequency",
    canonicalUnit: "Hz",
  }),
} as const;

export const c25Snapshot = (input: {
  readonly entityId: string;
  readonly seriesRevision: MonitoringSeriesRevisionReadV1;
  readonly pointValue?: number;
  readonly features: MonitoringSnapshotV1["features"];
}): MonitoringSnapshotV1 =>
  MonitoringSnapshotV1Schema.parse({
    monitoringSnapshotRef: versioned("monitoring-snapshot", input.entityId),
    projectId: C25_FIXTURE_PROJECT_ID,
    monitoringSeriesRef: input.seriesRevision.monitoringSeriesRef,
    cutoff: C25_FIXTURE_CUTOFF,
    recordedAt: C25_FIXTURE_CUTOFF,
    window: { from: "2026-09-13T00:00:00.000Z", to: C25_FIXTURE_CUTOFF },
    availabilityPolicyRef: c25Version("availability-policy"),
    algorithmVersions: {
      alignment: "v1",
      slope: "v1",
      acceleration: "v1",
      frequency: "v1",
      anomaly: "v1",
    },
    monitoringBatchRefs: [],
    sampleVersionRefs: [],
    members: [],
    alignedPoints:
      input.pointValue === undefined
        ? []
        : [
            {
              sampledAt: C25_FIXTURE_CUTOFF,
              value: input.pointValue,
              unit: input.seriesRevision.canonicalUnit,
              status: "available",
              sourceSampleRefs: [],
            },
          ],
    features: input.features,
    availability: "available",
    coverageRatio: 1,
    availabilityReasons: [],
    evidenceReferences: [c25Evidence(`monitoring-${input.entityId}`)],
    authorizationSnapshot: {
      authorizationContextRef: C25_FIXTURE_AUTHORIZATION_REF,
      spatialScopeRefs: [C25_FIXTURE_SPATIAL_SCOPE],
      sourceAccessGrantRefs: [],
    },
    audit: {
      actorId: "actor-c25",
      action: "engineering-data.monitoring-snapshot",
      recordedAt: C25_FIXTURE_CUTOFF,
    },
  });

const availableFeature = (
  featureType: MonitoringFeatureResultV1["featureType"],
  value: number,
  unit: string,
): MonitoringFeatureResultV1 => ({
  featureType,
  value,
  unit,
  windowSize: 3,
  inputCount: 3,
  algorithmVersion: "v1",
  status: "available",
});

export const c25Monitoring = (overrides?: {
  readonly settlementPoint?: number;
  readonly settlementSlope?: number;
  readonly waterLevelAnomaly?: number;
  readonly cutterFrequency?: number;
  readonly omitSettlementSnapshot?: boolean;
}): readonly AssessmentMonitoringInputV1[] => {
  const settlement = c25Snapshot({
    entityId: "monitoring-snapshot-settlement",
    seriesRevision: c25MonitoringSeries.settlement,
    pointValue: overrides?.settlementPoint ?? 6,
    features: {
      shortTermSlope: availableFeature(
        "short-term-slope",
        overrides?.settlementSlope ?? 0.5,
        "mm/s",
      ),
      acceleration: UNAVAILABLE_FEATURE("acceleration"),
      dominantFrequency: UNAVAILABLE_FEATURE("dominant-frequency"),
      anomalyScore: UNAVAILABLE_FEATURE("anomaly-score"),
    },
  });
  const waterLevel = c25Snapshot({
    entityId: "monitoring-snapshot-water-level",
    seriesRevision: c25MonitoringSeries.waterLevel,
    pointValue: 5,
    features: {
      shortTermSlope: UNAVAILABLE_FEATURE("short-term-slope"),
      acceleration: UNAVAILABLE_FEATURE("acceleration"),
      dominantFrequency: UNAVAILABLE_FEATURE("dominant-frequency"),
      anomalyScore: availableFeature("anomaly-score", overrides?.waterLevelAnomaly ?? 4, "score"),
    },
  });
  const cutter = c25Snapshot({
    entityId: "monitoring-snapshot-cutter-frequency",
    seriesRevision: c25MonitoringSeries.cutterFrequency,
    pointValue: overrides?.cutterFrequency ?? 40,
    features: {
      shortTermSlope: UNAVAILABLE_FEATURE("short-term-slope"),
      acceleration: UNAVAILABLE_FEATURE("acceleration"),
      dominantFrequency: availableFeature(
        "dominant-frequency",
        overrides?.cutterFrequency ?? 40,
        "Hz",
      ),
      anomalyScore: UNAVAILABLE_FEATURE("anomaly-score"),
    },
  });
  const settlementInput = {
    snapshot: settlement,
    seriesRevision: c25MonitoringSeries.settlement,
  };
  return [
    ...(overrides?.omitSettlementSnapshot === true ? [] : [settlementInput]),
    { snapshot: waterLevel, seriesRevision: c25MonitoringSeries.waterLevel },
    { snapshot: cutter, seriesRevision: c25MonitoringSeries.cutterFrequency },
  ];
};

export const c25Preparation = (
  overrides: Partial<AssessmentPreparationSnapshotV1> = {},
): AssessmentPreparationSnapshotV1 =>
  AssessmentPreparationSnapshotV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    spatialScopeRef: C25_FIXTURE_SPATIAL_SCOPE,
    riskInput: C25_FIXTURE_RISK_RECORD_REF,
    applicabilityMetadataSnapshotRef: C25_FIXTURE_APPLICABILITY_REF,
    monitoringSnapshotRefs: c25Monitoring().map((input) => input.snapshot.monitoringSnapshotRef),
    sourceEvidenceReferences: [c25Evidence("geology-segment")],
    entryMode: "assess",
    triggerReasonCode: "manual-assessment",
    authorizationContextRef: C25_FIXTURE_AUTHORIZATION_REF,
    auditTrailRef: C25_FIXTURE_AUDIT_REF,
    createdBy: "actor-c25",
    createdAt: C25_FIXTURE_AT,
    ...overrides,
  });

export const c25InputSnapshot = (
  members: readonly AssessmentBasisConfigurationMemberV1[],
  overrides: Partial<AssessmentInputSnapshotV1> = {},
): AssessmentInputSnapshotV1 => {
  const refOf = (definitionType: string): VersionReference => {
    const member = members.find((candidate) => candidate.definitionType === definitionType);
    if (member === undefined) throw new Error(`missing configuration member ${definitionType}`);
    return member.releaseRef.reference;
  };
  const policies = c25RuntimePolicySet();
  return AssessmentInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    preparationSnapshotRef: C25_FIXTURE_PREPARATION_REF,
    indicatorSystemRef: refOf("indicator-system"),
    indicatorFieldMappingRef: refOf("indicator-field-mapping"),
    applicableRuleSetRef: c25ReleaseRef("set-applicable-rule-set").reference,
    weightSetRef: refOf("weight-set"),
    scoringStrategyRef: refOf("scoring-strategy"),
    riskMatrixRef: refOf("risk-matrix"),
    riskAcceptanceThresholdRef: refOf("risk-acceptance-threshold"),
    monitoringWarningThresholdRef: refOf("monitoring-warning-threshold"),
    jointTriggerPolicyRef: refOf("joint-trigger-policy"),
    measureLibraryReleaseRef: refOf("measure-library"),
    effectForecastPolicyRef: refOf("forecast-policy"),
    deviationPolicyRef: refOf("deviation-policy"),
    warningAggregationPolicyRef: policies.warningAggregationPolicyRef,
    notificationPolicyRef: policies.notificationPolicyRef,
    responseGenerationPolicyRef: policies.responseGenerationPolicyRef,
    responseValidationPolicyRef: policies.responseValidationPolicyRef,
    responseAgentPolicyRef: policies.responseAgentPolicyRef,
    calibrationAgentPolicyRef: policies.calibrationAgentPolicyRef,
    retryPolicyRef: policies.retryPolicyRef,
    reviewPolicyRef: policies.reviewPolicyRef,
    modelDeploymentRef: policies.modelDeploymentRef,
    promptTemplateRef: policies.promptTemplateRef,
    authorizationContextRef: C25_FIXTURE_AUTHORIZATION_REF,
    auditTrailRef: C25_FIXTURE_AUDIT_REF,
    createdBy: "actor-c25",
    createdAt: C25_FIXTURE_AT,
    ...overrides,
  });
};

export interface RiskAssessmentFixtureOverridesV1 {
  readonly applicability?: typeof C25_FIXTURE_APPLICABILITY;
  readonly configuration?: AssessmentConfigurationV1;
  readonly rules?: readonly ScoringRuleFixtureV1[];
  readonly monitoring?: readonly AssessmentMonitoringInputV1[];
  readonly facts?: RiskInputFactsV1;
  readonly preparation?: Partial<AssessmentPreparationSnapshotV1>;
  readonly members?: readonly AssessmentBasisConfigurationMemberV1[];
  readonly inputSnapshot?: Partial<AssessmentInputSnapshotV1>;
}

export const makeRiskAssessmentEngineContext = (
  overrides: RiskAssessmentFixtureOverridesV1 = {},
): AssessmentEngineContextV1 => {
  const rules = overrides.rules ?? C25_FIXTURE_RULES;
  const members = overrides.members ?? c25ConfigurationMembers();
  return {
    projectId: C25_FIXTURE_PROJECT_ID,
    projectRevisionRef: C25_FIXTURE_PROJECT_REVISION,
    preparation: c25Preparation(overrides.preparation ?? {}),
    preparationSnapshotRef: C25_FIXTURE_PREPARATION_REF,
    inputSnapshot: c25InputSnapshot(members, overrides.inputSnapshot ?? {}),
    inputSnapshotRef: C25_FIXTURE_INPUT_SNAPSHOT_REF,
    assessmentBasisReleaseSetRef: C25_FIXTURE_BASIS_REF,
    applicabilitySnapshotRef: C25_FIXTURE_APPLICABILITY_REF,
    applicability: overrides.applicability ?? C25_FIXTURE_APPLICABILITY,
    basis: {
      applicableRuleSetMember: {
        releaseRef: c25ReleaseRef("set-applicable-rule-set"),
        revisionRef: c25RevisionRef("set-applicable-rule-set"),
        artifactRef: c25ArtifactRef("set-applicable-rule-set"),
        contentDigest: c25Digest(c25ApplicableRuleSet(rules)),
      },
      scoringRuleMembers: c25ScoringRuleMembers(rules),
      configurationMembers: members,
    },
    configuration: overrides.configuration ?? c25Configuration(),
    applicableRuleSet: c25ApplicableRuleSet(rules),
    rules: c25Rules(rules),
    facts: overrides.facts ?? c25Facts(),
    monitoring: overrides.monitoring ?? c25Monitoring(),
  };
};
