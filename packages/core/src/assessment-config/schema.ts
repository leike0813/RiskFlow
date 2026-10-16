import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ProjectRevisionRefV1Schema,
  type KnowledgeDefinitionTypeV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import {
  ApplicabilityMetadataDimensionSchema,
  MonitoringIndicatorSchema,
  QuantitativeIndicatorGroupSchema,
  RiskAssessmentIndicatorTypeSchema,
  WarningTriggerTypeSchema,
} from "@riskflow/contracts/vocabulary";

import { MonitoringFeatureTypeV1Schema } from "../engineering-data/monitoring/index.js";
import type { MonitoringFeatureTypeV1 } from "../engineering-data/monitoring/index.js";
import { CanonicalDecimalV1Schema, compareCanonicalDecimalValuesOrUndefined } from "./decimal.js";

export const ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1 = "1" as const;
export const ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.assessment-configuration+json" as const;
export const ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1 = 1024 * 1024;
export const ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1 =
  "assessment-configuration" as const;
export const ASSESSMENT_CONFIGURATION_SET_REF_KIND_V1 = "knowledge-query-result" as const;

export const ASSESSMENT_SCORING_CONFIGURATION_TYPES = [
  "indicator-system",
  "indicator-field-mapping",
  "weight-set",
  "scoring-strategy",
  "risk-matrix",
  "risk-acceptance-threshold",
  "monitoring-warning-threshold",
  "joint-trigger-policy",
] as const satisfies readonly KnowledgeDefinitionTypeV1[];

/** The eleven C18 definition types inside the C02 knowledge definition vocabulary. */
export const ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1 = [
  ...ASSESSMENT_SCORING_CONFIGURATION_TYPES,
  "measure-library",
  "forecast-policy",
  "deviation-policy",
] as const satisfies readonly KnowledgeDefinitionTypeV1[];

export type AssessmentConfigurationDefinitionTypeV1 =
  (typeof ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1)[number];

export const ASSESSMENT_CONFIGURATION_TYPES_BY_PURPOSE = {
  full: ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  assessment: ASSESSMENT_SCORING_CONFIGURATION_TYPES,
  response: [...ASSESSMENT_SCORING_CONFIGURATION_TYPES, "measure-library"],
  forecast: ["indicator-system", "forecast-policy"],
  deviation: ["deviation-policy"],
} as const satisfies Readonly<Record<string, readonly AssessmentConfigurationDefinitionTypeV1[]>>;
export const AssessmentConfigurationPurposeSchema = z.enum([
  "full",
  "assessment",
  "response",
  "forecast",
  "deviation",
]);
export type AssessmentConfigurationPurpose = z.infer<typeof AssessmentConfigurationPurposeSchema>;

export const AssessmentConfigurationDefinitionTypeV1Schema = z.enum(
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
);

const definitionTypeIndex: Readonly<Record<string, true>> = Object.fromEntries(
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map((value) => [value, true]),
);

export const isAssessmentConfigurationDefinitionTypeV1 = (
  value: unknown,
): value is AssessmentConfigurationDefinitionTypeV1 =>
  typeof value === "string" && definitionTypeIndex[value] === true;

const hashValue = z.string().regex(/^[0-9a-f]{64}$/u);
const configurationText = z.string().trim().min(1).max(200);
const configurationUnit = z.string().regex(/^[\x21-\x7e]{1,32}$/u);
const fieldPathSegment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u);
const positiveInteger = z.number().int().positive();
const boundedInteger = (maximum: number) => z.number().int().nonnegative().max(maximum);

const sortedUnique = <T>(
  schema: z.ZodType<T>,
  key: (value: T) => string,
  minimum: number,
  maximum: number,
) =>
  z
    .array(schema)
    .min(minimum)
    .max(maximum)
    .superRefine((values, context) => {
      const keys = values.map(key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
      }
      for (let index = 1; index < keys.length; index += 1) {
        if (keys[index - 1]! >= keys[index]!) {
          context.addIssue({ code: "custom", message: "collection must be sorted" });
          break;
        }
      }
    });

const sortedUniqueIdentity = (minimum: number, maximum: number) =>
  sortedUnique(IdentifierSchema, (value: string) => value, minimum, maximum);

export const ApplicabilityConditionV1Schema = z.strictObject({
  dimension: ApplicabilityMetadataDimensionSchema,
  values: sortedUniqueIdentity(1, 32),
});
export type ApplicabilityConditionV1 = z.infer<typeof ApplicabilityConditionV1Schema>;

const applicabilityConditions = sortedUnique(
  ApplicabilityConditionV1Schema,
  (value: ApplicabilityConditionV1) => value.dimension,
  0,
  32,
);

/* --- indicator system ------------------------------------------------------ */

export const ASSESSMENT_INDICATOR_VALUE_KIND_V1_VALUES = ["numeric", "ordinal", "boolean"] as const;
export const AssessmentIndicatorValueKindV1Schema = z.enum(
  ASSESSMENT_INDICATOR_VALUE_KIND_V1_VALUES,
);
export type AssessmentIndicatorValueKindV1 = z.infer<typeof AssessmentIndicatorValueKindV1Schema>;

const indicatorBase = {
  indicatorId: IdentifierSchema,
  indicatorType: RiskAssessmentIndicatorTypeSchema,
  group: QuantitativeIndicatorGroupSchema,
  applicabilityConditions,
  quantizationIntervalRef: VersionReferenceSchema,
};

const NumericIndicatorV1Schema = z.strictObject({
  ...indicatorBase,
  valueKind: z.literal("numeric"),
  canonicalUnit: configurationUnit,
});
const OrdinalIndicatorV1Schema = z.strictObject({
  ...indicatorBase,
  valueKind: z.literal("ordinal"),
});
const BooleanIndicatorV1Schema = z.strictObject({
  ...indicatorBase,
  valueKind: z.literal("boolean"),
});

export const AssessmentIndicatorV1Schema = z.discriminatedUnion("valueKind", [
  NumericIndicatorV1Schema,
  OrdinalIndicatorV1Schema,
  BooleanIndicatorV1Schema,
]);
export type AssessmentIndicatorV1 = z.infer<typeof AssessmentIndicatorV1Schema>;

export const IndicatorSystemContentV1Schema = z.strictObject({
  indicators: sortedUnique(AssessmentIndicatorV1Schema, (value) => value.indicatorId, 1, 256),
});
export type IndicatorSystemContentV1 = z.infer<typeof IndicatorSystemContentV1Schema>;

/* --- indicator field mapping ---------------------------------------------- */

/* The metric vocabulary closes over C14 frozen values; the `satisfies` clause
 * keeps this list aligned with the C14 feature enum at compile time. */
export const ASSESSMENT_CONFIGURATION_METRIC_V1_VALUES = [
  "value",
  "short-term-slope",
  "acceleration",
  "dominant-frequency",
  "anomaly-score",
] as const satisfies readonly (MonitoringFeatureTypeV1 | "value")[];

export type AssessmentConfigurationMetricV1 =
  (typeof ASSESSMENT_CONFIGURATION_METRIC_V1_VALUES)[number];

export const AssessmentConfigurationMetricV1Schema = z.enum(
  ASSESSMENT_CONFIGURATION_METRIC_V1_VALUES,
);

const SourceFieldOriginV1Schema = z.strictObject({
  kind: z.literal("source-field"),
  documentType: IdentifierSchema,
  fieldPath: z.array(fieldPathSegment).min(1).max(16),
});
const MonitoringValueOriginV1Schema = z.strictObject({
  kind: z.literal("monitoring-value"),
  monitoringIndicator: MonitoringIndicatorSchema,
  parameterCode: configurationText,
  metric: z.literal("value"),
});
const MonitoringFeatureOriginV1Schema = z.strictObject({
  kind: z.literal("monitoring-feature"),
  monitoringIndicator: MonitoringIndicatorSchema,
  parameterCode: configurationText,
  metric: MonitoringFeatureTypeV1Schema,
});

export const FieldMappingOriginV1Schema = z.discriminatedUnion("kind", [
  SourceFieldOriginV1Schema,
  MonitoringValueOriginV1Schema,
  MonitoringFeatureOriginV1Schema,
]);
export type FieldMappingOriginV1 = z.infer<typeof FieldMappingOriginV1Schema>;

const IdentityConversionV1Schema = z.strictObject({ kind: z.literal("identity") });
const AffineConversionV1Schema = z.strictObject({
  kind: z.literal("affine"),
  scale: z
    .number()
    .finite()
    .refine((value) => value !== 0, "scale must be non-zero"),
  offset: z.number().finite(),
});

export const FieldMappingConversionV1Schema = z.discriminatedUnion("kind", [
  IdentityConversionV1Schema,
  AffineConversionV1Schema,
]);
export type FieldMappingConversionV1 = z.infer<typeof FieldMappingConversionV1Schema>;

export const AssessmentFieldMappingV1Schema = z.strictObject({
  mappingId: IdentifierSchema,
  targetIndicatorId: IdentifierSchema,
  origin: FieldMappingOriginV1Schema,
  sourceUnit: configurationUnit,
  targetUnit: configurationUnit,
  conversion: FieldMappingConversionV1Schema,
});
export type AssessmentFieldMappingV1 = z.infer<typeof AssessmentFieldMappingV1Schema>;

export const IndicatorFieldMappingContentV1Schema = z.strictObject({
  mappings: sortedUnique(AssessmentFieldMappingV1Schema, (value) => value.mappingId, 1, 1024),
});
export type IndicatorFieldMappingContentV1 = z.infer<typeof IndicatorFieldMappingContentV1Schema>;

/* --- weight set and scoring strategy -------------------------------------- */

export const WeightEntryV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  basisPoints: boundedInteger(10_000),
});
export type WeightEntryV1 = z.infer<typeof WeightEntryV1Schema>;

export const WEIGHT_SET_TOTAL_BASIS_POINTS_V1 = 10_000;

export const WeightSetContentV1Schema = z.strictObject({
  weightSetId: IdentifierSchema,
  weightSetVersion: IdentifierSchema,
  sourceRef: VersionReferenceSchema,
  possibilityWeights: sortedUnique(WeightEntryV1Schema, (value) => value.indicatorId, 1, 256),
  consequenceWeights: sortedUnique(WeightEntryV1Schema, (value) => value.indicatorId, 1, 256),
});
export type WeightSetContentV1 = z.infer<typeof WeightSetContentV1Schema>;

const RoundingRuleV1Schema = z.strictObject({
  mode: z.literal("half-away-from-zero"),
  decimalScale: boundedInteger(6),
});

const WeightedAverageStrategyV1Schema = z.strictObject({
  kind: z.literal("weighted-average"),
  weightSetRef: VersionReferenceSchema,
  rounding: RoundingRuleV1Schema,
});
const MaximumStrategyV1Schema = z.strictObject({ kind: z.literal("maximum") });

export const AxisScoringStrategyV1Schema = z.discriminatedUnion("kind", [
  WeightedAverageStrategyV1Schema,
  MaximumStrategyV1Schema,
]);
export type AxisScoringStrategyV1 = z.infer<typeof AxisScoringStrategyV1Schema>;

export const ScoringStrategyContentV1Schema = z.strictObject({
  possibility: AxisScoringStrategyV1Schema,
  consequence: AxisScoringStrategyV1Schema,
});
export type ScoringStrategyContentV1 = z.infer<typeof ScoringStrategyContentV1Schema>;

/* --- risk matrix ----------------------------------------------------------- */

export const RiskMatrixBandV1Schema = z
  .strictObject({
    bandId: IdentifierSchema,
    lower: CanonicalDecimalV1Schema,
    upper: CanonicalDecimalV1Schema,
  })
  .superRefine((band, context) => {
    const bounds = compareCanonicalDecimalValuesOrUndefined(band.lower, band.upper);
    if (bounds !== undefined && bounds >= 0) {
      context.addIssue({
        code: "custom",
        path: ["upper"],
        message: "band upper bound must be greater than its lower bound",
      });
    }
  });
export type RiskMatrixBandV1 = z.infer<typeof RiskMatrixBandV1Schema>;

export const RiskMatrixAxisV1Schema = z
  .strictObject({
    bands: z
      .array(RiskMatrixBandV1Schema)
      .min(1)
      .max(32)
      .superRefine((bands, context) => {
        const bandIds = new Set<string>();
        for (const band of bands) {
          if (bandIds.has(band.bandId)) {
            context.addIssue({ code: "custom", message: "band ids must be unique" });
            return;
          }
          bandIds.add(band.bandId);
        }
        for (let index = 1; index < bands.length; index += 1) {
          const previous = bands[index - 1]!;
          const current = bands[index]!;
          if (previous.upper !== current.lower) {
            context.addIssue({
              code: "custom",
              path: [index, "lower"],
              message: "axis bands must share exact adjacent boundaries",
            });
            return;
          }
        }
      }),
  })
  .superRefine((axis, context) => {
    for (let index = 1; index < axis.bands.length; index += 1) {
      const order = compareCanonicalDecimalValuesOrUndefined(
        axis.bands[index - 1]!.lower,
        axis.bands[index]!.lower,
      );
      if (order !== undefined && order >= 0) {
        context.addIssue({
          code: "custom",
          path: ["bands", index],
          message: "axis bands must be ordered by ascending boundary",
        });
        return;
      }
    }
  });
export type RiskMatrixAxisV1 = z.infer<typeof RiskMatrixAxisV1Schema>;

export const RiskLevelV1Schema = z.strictObject({
  levelId: IdentifierSchema,
  ordinal: positiveInteger.max(32),
});
export type RiskLevelV1 = z.infer<typeof RiskLevelV1Schema>;

export const RiskMatrixCellV1Schema = z.strictObject({
  possibilityBandId: IdentifierSchema,
  consequenceBandId: IdentifierSchema,
  riskLevelId: IdentifierSchema,
});
export type RiskMatrixCellV1 = z.infer<typeof RiskMatrixCellV1Schema>;

export const RiskMatrixContentV1Schema = z.strictObject({
  matrixId: IdentifierSchema,
  matrixVersion: IdentifierSchema,
  possibilityAxis: RiskMatrixAxisV1Schema,
  consequenceAxis: RiskMatrixAxisV1Schema,
  riskLevels: z
    .array(RiskLevelV1Schema)
    .min(1)
    .max(32)
    .superRefine((levels, context) => {
      const levelIds = new Set<string>();
      for (const level of levels) {
        if (levelIds.has(level.levelId)) {
          context.addIssue({ code: "custom", message: "risk level ids must be unique" });
          return;
        }
        levelIds.add(level.levelId);
      }
      for (let index = 1; index < levels.length; index += 1) {
        if (levels[index - 1]!.ordinal >= levels[index]!.ordinal) {
          context.addIssue({
            code: "custom",
            path: [index, "ordinal"],
            message: "risk level ordinals must be strictly increasing",
          });
          return;
        }
      }
    }),
  cells: sortedUnique(
    RiskMatrixCellV1Schema,
    (value: RiskMatrixCellV1) => `${value.possibilityBandId}\u0000${value.consequenceBandId}`,
    1,
    1024,
  ),
});
export type RiskMatrixContentV1 = z.infer<typeof RiskMatrixContentV1Schema>;

/* --- thresholds and joint trigger rules ----------------------------------- */

export const RiskAcceptanceThresholdV1Schema = z.strictObject({
  thresholdId: IdentifierSchema,
  applicabilityConditions,
  maximumAcceptedLevelId: IdentifierSchema,
});
export type RiskAcceptanceThresholdV1 = z.infer<typeof RiskAcceptanceThresholdV1Schema>;

export const RiskAcceptanceThresholdContentV1Schema = z.strictObject({
  riskMatrixRef: VersionReferenceSchema,
  thresholds: sortedUnique(RiskAcceptanceThresholdV1Schema, (value) => value.thresholdId, 1, 64),
});
export type RiskAcceptanceThresholdContentV1 = z.infer<
  typeof RiskAcceptanceThresholdContentV1Schema
>;

const singleSidedComparison = <const T extends "gt" | "gte" | "lt" | "lte">(operator: T) =>
  z.strictObject({ operator: z.literal(operator), boundary: CanonicalDecimalV1Schema });

const OutsideComparisonV1Schema = z
  .strictObject({
    operator: z.literal("outside"),
    lower: CanonicalDecimalV1Schema,
    upper: CanonicalDecimalV1Schema,
  })
  .superRefine((comparison, context) => {
    const bounds = compareCanonicalDecimalValuesOrUndefined(comparison.lower, comparison.upper);
    if (bounds !== undefined && bounds >= 0) {
      context.addIssue({
        code: "custom",
        path: ["upper"],
        message: "interval upper bound must be greater than its lower bound",
      });
    }
  });

export const MonitoringWarningComparisonV1Schema = z.discriminatedUnion("operator", [
  singleSidedComparison("gt"),
  singleSidedComparison("gte"),
  singleSidedComparison("lt"),
  singleSidedComparison("lte"),
  OutsideComparisonV1Schema,
]);
export type MonitoringWarningComparisonV1 = z.infer<typeof MonitoringWarningComparisonV1Schema>;

export const MonitoringWarningThresholdV1Schema = z.strictObject({
  thresholdId: IdentifierSchema,
  monitoringIndicator: MonitoringIndicatorSchema,
  parameterCode: configurationText,
  metric: AssessmentConfigurationMetricV1Schema,
  unit: configurationUnit,
  comparison: MonitoringWarningComparisonV1Schema,
  warningLevelId: IdentifierSchema,
});
export type MonitoringWarningThresholdV1 = z.infer<typeof MonitoringWarningThresholdV1Schema>;

export const MonitoringWarningThresholdContentV1Schema = z.strictObject({
  riskMatrixRef: VersionReferenceSchema,
  thresholds: sortedUnique(
    MonitoringWarningThresholdV1Schema,
    (value) => value.thresholdId,
    1,
    512,
  ),
});
export type MonitoringWarningThresholdContentV1 = z.infer<
  typeof MonitoringWarningThresholdContentV1Schema
>;

export const JOINT_TRIGGER_OPERATOR_V1_VALUES = ["all-of", "any-of", "at-least"] as const;
export const JointTriggerOperatorV1Schema = z.enum(JOINT_TRIGGER_OPERATOR_V1_VALUES);
export type JointTriggerOperatorV1 = z.infer<typeof JointTriggerOperatorV1Schema>;

const jointTriggerMetrics = sortedUniqueIdentity(2, 64);

const jointTriggerRuleBase = {
  ruleId: IdentifierSchema,
  applicabilityConditions,
  monitoringThresholdIds: jointTriggerMetrics,
};

const AllOfRuleV1Schema = z.strictObject({
  ...jointTriggerRuleBase,
  operator: z.literal("all-of"),
});
const AnyOfRuleV1Schema = z.strictObject({
  ...jointTriggerRuleBase,
  operator: z.literal("any-of"),
});
const AtLeastRuleV1Schema = z
  .strictObject({
    ...jointTriggerRuleBase,
    operator: z.literal("at-least"),
    count: positiveInteger,
  })
  .superRefine((rule, context) => {
    if (rule.count > rule.monitoringThresholdIds.length) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "at-least count must not exceed the member count",
      });
    }
  });

export const JointTriggerRuleV1Schema = z.discriminatedUnion("operator", [
  AllOfRuleV1Schema,
  AnyOfRuleV1Schema,
  AtLeastRuleV1Schema,
]);
export type JointTriggerRuleV1 = z.infer<typeof JointTriggerRuleV1Schema>;

export const JointTriggerPolicyContentV1Schema = z.strictObject({
  rules: sortedUnique(JointTriggerRuleV1Schema, (value) => value.ruleId, 1, 64),
});
export type JointTriggerPolicyContentV1 = z.infer<typeof JointTriggerPolicyContentV1Schema>;

/* --- measure library ------------------------------------------------------- */

export const MeasureStepV1Schema = z.strictObject({
  stepOrdinal: positiveInteger.max(32),
  instruction: configurationText,
});
export type MeasureStepV1 = z.infer<typeof MeasureStepV1Schema>;

export const AssessmentMeasureV1Schema = z.strictObject({
  measureId: IdentifierSchema,
  riskEventCategory: IdentifierSchema,
  applicabilityConditions,
  triggerTypes: sortedUnique(
    WarningTriggerTypeSchema,
    (value) => value,
    1,
    WarningTriggerTypeSchema.options.length,
  ),
  steps: z
    .array(MeasureStepV1Schema)
    .min(1)
    .max(32)
    .superRefine((steps, context) => {
      for (let index = 1; index < steps.length; index += 1) {
        if (steps[index - 1]!.stepOrdinal >= steps[index]!.stepOrdinal) {
          context.addIssue({
            code: "custom",
            path: [index, "stepOrdinal"],
            message: "measure steps must keep an explicit ascending business order",
          });
          return;
        }
      }
    }),
  resourceRequirements: sortedUniqueIdentity(0, 32),
  targetIndicatorIds: sortedUniqueIdentity(1, 64),
  evidenceRequirements: sortedUniqueIdentity(1, 32),
  contraindications: sortedUniqueIdentity(0, 32),
});
export type AssessmentMeasureV1 = z.infer<typeof AssessmentMeasureV1Schema>;

export const MeasureLibraryContentV1Schema = z.strictObject({
  measures: sortedUnique(AssessmentMeasureV1Schema, (value) => value.measureId, 1, 256),
});
export type MeasureLibraryContentV1 = z.infer<typeof MeasureLibraryContentV1Schema>;

/* --- forecast and deviation policies -------------------------------------- */

export const FORECAST_METHOD_V1_VALUES = [
  "historical-statistics",
  "monitoring-trend",
  "mechanism-model",
] as const;
export const ForecastMethodV1Schema = z.enum(FORECAST_METHOD_V1_VALUES);
export type ForecastMethodV1 = z.infer<typeof ForecastMethodV1Schema>;

export const ForecastPolicyV1Schema = z.strictObject({
  policyId: IdentifierSchema,
  method: ForecastMethodV1Schema,
  inputIndicatorIds: sortedUniqueIdentity(1, 32),
  targetIndicatorId: IdentifierSchema,
  horizonSteps: positiveInteger.max(720),
  unit: configurationUnit,
  requiredRef: VersionReferenceSchema,
});
export type ForecastPolicyV1 = z.infer<typeof ForecastPolicyV1Schema>;

export const ForecastPolicyContentV1Schema = z.strictObject({
  policies: sortedUnique(ForecastPolicyV1Schema, (value) => value.policyId, 1, 64),
});
export type ForecastPolicyContentV1 = z.infer<typeof ForecastPolicyContentV1Schema>;

export const DEVIATION_BASIS_V1_VALUES = ["absolute", "relative", "risk-level-step"] as const;
export const DeviationBasisV1Schema = z.enum(DEVIATION_BASIS_V1_VALUES);
export type DeviationBasisV1 = z.infer<typeof DeviationBasisV1Schema>;

const evidenceRequirements = sortedUniqueIdentity(1, 32);
const deviationPolicyBase = { policyId: IdentifierSchema, evidenceRequirements };

const AbsoluteDeviationPolicyV1Schema = z.strictObject({
  ...deviationPolicyBase,
  basis: z.literal("absolute"),
  threshold: CanonicalDecimalV1Schema,
});
const RelativeDeviationPolicyV1Schema = z
  .strictObject({
    ...deviationPolicyBase,
    basis: z.literal("relative"),
    threshold: CanonicalDecimalV1Schema,
    minimumBaseline: CanonicalDecimalV1Schema,
  })
  .superRefine((policy, context) => {
    const baseline = compareCanonicalDecimalValuesOrUndefined(policy.minimumBaseline, "0");
    if (baseline !== undefined && baseline <= 0) {
      context.addIssue({
        code: "custom",
        path: ["minimumBaseline"],
        message: "relative deviation requires a positive minimum baseline",
      });
    }
  });
const RiskLevelStepDeviationPolicyV1Schema = z.strictObject({
  ...deviationPolicyBase,
  basis: z.literal("risk-level-step"),
  levelStep: positiveInteger.max(32),
  riskMatrixRef: VersionReferenceSchema,
});

export const DeviationPolicyV1Schema = z.discriminatedUnion("basis", [
  AbsoluteDeviationPolicyV1Schema,
  RelativeDeviationPolicyV1Schema,
  RiskLevelStepDeviationPolicyV1Schema,
]);
export type DeviationPolicyV1 = z.infer<typeof DeviationPolicyV1Schema>;

export const DeviationPolicyContentV1Schema = z.strictObject({
  policies: sortedUnique(DeviationPolicyV1Schema, (value) => value.policyId, 1, 64),
});
export type DeviationPolicyContentV1 = z.infer<typeof DeviationPolicyContentV1Schema>;

/* --- configuration documents ---------------------------------------------- */

const configurationDocument = <
  const T extends AssessmentConfigurationDefinitionTypeV1,
  C extends z.ZodType,
>(
  definitionType: T,
  content: C,
) =>
  z.strictObject({
    schemaVersion: z.literal(ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1),
    definitionType: z.literal(definitionType),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    configurationSetRef: VersionReferenceSchema,
    content,
  });

export const IndicatorSystemDocumentV1Schema = configurationDocument(
  "indicator-system",
  IndicatorSystemContentV1Schema,
);
export const IndicatorFieldMappingDocumentV1Schema = configurationDocument(
  "indicator-field-mapping",
  IndicatorFieldMappingContentV1Schema,
);
export const WeightSetDocumentV1Schema = configurationDocument(
  "weight-set",
  WeightSetContentV1Schema,
);
export const ScoringStrategyDocumentV1Schema = configurationDocument(
  "scoring-strategy",
  ScoringStrategyContentV1Schema,
);
export const RiskMatrixDocumentV1Schema = configurationDocument(
  "risk-matrix",
  RiskMatrixContentV1Schema,
);
export const RiskAcceptanceThresholdDocumentV1Schema = configurationDocument(
  "risk-acceptance-threshold",
  RiskAcceptanceThresholdContentV1Schema,
);
export const MonitoringWarningThresholdDocumentV1Schema = configurationDocument(
  "monitoring-warning-threshold",
  MonitoringWarningThresholdContentV1Schema,
);
export const JointTriggerPolicyDocumentV1Schema = configurationDocument(
  "joint-trigger-policy",
  JointTriggerPolicyContentV1Schema,
);
export const MeasureLibraryDocumentV1Schema = configurationDocument(
  "measure-library",
  MeasureLibraryContentV1Schema,
);
export const ForecastPolicyDocumentV1Schema = configurationDocument(
  "forecast-policy",
  ForecastPolicyContentV1Schema,
);
export const DeviationPolicyDocumentV1Schema = configurationDocument(
  "deviation-policy",
  DeviationPolicyContentV1Schema,
);

export const AssessmentConfigurationDocumentV1Schema = z.discriminatedUnion("definitionType", [
  IndicatorSystemDocumentV1Schema,
  IndicatorFieldMappingDocumentV1Schema,
  WeightSetDocumentV1Schema,
  ScoringStrategyDocumentV1Schema,
  RiskMatrixDocumentV1Schema,
  RiskAcceptanceThresholdDocumentV1Schema,
  MonitoringWarningThresholdDocumentV1Schema,
  JointTriggerPolicyDocumentV1Schema,
  MeasureLibraryDocumentV1Schema,
  ForecastPolicyDocumentV1Schema,
  DeviationPolicyDocumentV1Schema,
]);
export type AssessmentConfigurationDocumentV1 = z.infer<
  typeof AssessmentConfigurationDocumentV1Schema
>;

export type AssessmentConfigurationContentV1 =
  | IndicatorSystemContentV1
  | IndicatorFieldMappingContentV1
  | WeightSetContentV1
  | ScoringStrategyContentV1
  | RiskMatrixContentV1
  | RiskAcceptanceThresholdContentV1
  | MonitoringWarningThresholdContentV1
  | JointTriggerPolicyContentV1
  | MeasureLibraryContentV1
  | ForecastPolicyContentV1
  | DeviationPolicyContentV1;

/* --- prepared, metadata, set and request/result values --------------------- */

export const AssessmentConfigurationSummaryV1Schema = z.strictObject({
  itemCount: boundedInteger(1_048_576),
  identityIds: sortedUniqueIdentity(0, 64),
});
export type AssessmentConfigurationSummaryV1 = z.infer<
  typeof AssessmentConfigurationSummaryV1Schema
>;

export const PreparedAssessmentConfigurationV1Schema = z.strictObject({
  definitionType: AssessmentConfigurationDefinitionTypeV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  configurationSetRef: VersionReferenceSchema,
  contentDigest: hashValue,
  summary: AssessmentConfigurationSummaryV1Schema,
  document: AssessmentConfigurationDocumentV1Schema,
});
export type PreparedAssessmentConfigurationV1 = z.infer<
  typeof PreparedAssessmentConfigurationV1Schema
>;

export const AssessmentConfigurationRevisionMetadataV1Schema = z.strictObject({
  revisionRef: KnowledgeRevisionRefV1Schema,
  projectId: IdentifierSchema,
  definitionType: AssessmentConfigurationDefinitionTypeV1Schema,
  artifactRef: ContentArtifactRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  configurationSetRef: VersionReferenceSchema,
  contentDigest: hashValue,
  summary: AssessmentConfigurationSummaryV1Schema,
  commandId: IdentifierSchema,
  auditEntryId: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
});
export type AssessmentConfigurationRevisionMetadataV1 = z.infer<
  typeof AssessmentConfigurationRevisionMetadataV1Schema
>;

export const AssessmentConfigurationMemberV1Schema = z.strictObject({
  definitionType: AssessmentConfigurationDefinitionTypeV1Schema,
  releaseRef: KnowledgeReleaseRefV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
  artifactRef: ContentArtifactRefV1Schema,
  contentDigest: hashValue,
});
export type AssessmentConfigurationMemberV1 = z.infer<typeof AssessmentConfigurationMemberV1Schema>;

const configurationMembers = z
  .array(AssessmentConfigurationMemberV1Schema)
  .min(1)
  .max(ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.length)
  .superRefine((members, context) => {
    const keys = members.map((member) => member.definitionType);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "member types must be unique" });
      return;
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", message: "members must be sorted by definition type" });
        return;
      }
    }
  });

export const AssessmentConfigurationReleaseSetV1Schema = z
  .strictObject({
    setRef: KnowledgeQueryResultRefV1Schema,
    schemaVersion: z.literal(ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    configurationSetRef: VersionReferenceSchema,
    requiredAt: IsoDateTimeSchema,
    asOfRecordedAt: IsoDateTimeSchema,
    memberDigest: hashValue,
    identityDigest: hashValue,
    recordedAt: IsoDateTimeSchema,
    members: configurationMembers,
    purpose: AssessmentConfigurationPurposeSchema.optional(),
  })
  .superRefine((set, context) => {
    const required = ASSESSMENT_CONFIGURATION_TYPES_BY_PURPOSE[set.purpose ?? "full"];
    const actual = set.members.map((member) => member.definitionType);
    if (
      required.some((kind) => !actual.includes(kind)) ||
      actual.some(
        (kind) =>
          !(required as readonly string[]).includes(kind) &&
          !(set.purpose === "deviation" && kind === "risk-matrix"),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "configuration members must match the stage purpose",
      });
  });
export type AssessmentConfigurationReleaseSetV1 = z.infer<
  typeof AssessmentConfigurationReleaseSetV1Schema
>;

const requiredResolutionCapability =
  MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.assessment-basis"];

export const ResolveAssessmentConfigurationSetV1Schema = z
  .strictObject({
    requestId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    requiredAt: IsoDateTimeSchema,
    asOfRecordedAt: IsoDateTimeSchema,
    purpose: AssessmentConfigurationPurposeSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "request project does not match authorization context",
      });
    }
    if (request.actorId !== request.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "request actor does not match authorization context",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(requiredResolutionCapability)) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "required capability is not granted",
      });
    }
  });
export type ResolveAssessmentConfigurationSetV1 = z.infer<
  typeof ResolveAssessmentConfigurationSetV1Schema
>;

export const AssessmentConfigurationSetResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    configurationSet: AssessmentConfigurationReleaseSetV1Schema,
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type AssessmentConfigurationSetResultV1 = z.infer<
  typeof AssessmentConfigurationSetResultV1Schema
>;

/** Private resolution outcome: C16 failures pass through, C18 failures are thrown. */
export type AssessmentConfigurationResolutionV1 =
  | { readonly kind: "succeeded"; readonly configurationSet: AssessmentConfigurationReleaseSetV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };
