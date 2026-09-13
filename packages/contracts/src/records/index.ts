import { z } from "zod";

import {
  AuditInfoSchema,
  EvidenceLocatorSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  ReviewStatusSchema,
  ValidationResultSchema,
  VersionReferenceSchema,
  VersionedRecordInfoSchema,
} from "../common/index.js";
import { WarningTriggerTypeSchema } from "../vocabulary/index.js";

const FiniteNumberSchema = z.number().finite();

const RiskElementRelationShape = {
  sourceElement: IdentifierSchema,
  relation: IdentifierSchema,
  targetElement: IdentifierSchema,
};

export const RiskElementRelationSchema = z.strictObject(RiskElementRelationShape);
export type RiskElementRelation = z.infer<typeof RiskElementRelationSchema>;

const ModelOutputResultShape = {
  riskSource: IdentifierSchema,
  riskFactor: IdentifierSchema,
  riskEvent: IdentifierSchema,
  riskElementRelations: z.array(RiskElementRelationSchema).min(1),
  evidenceLocator: EvidenceLocatorSchema,
  modelConfidence: FiniteNumberSchema.min(0).max(1),
};

export const ModelOutputResultSchema = z.strictObject(ModelOutputResultShape);
export type ModelOutputResult = z.infer<typeof ModelOutputResultSchema>;

export const StandardizedRiskRecordSchema = z.strictObject({
  processNodeId: IdentifierSchema,
  ...ModelOutputResultShape,
});
export type StandardizedRiskRecord = z.infer<typeof StandardizedRiskRecordSchema>;

export const CompositeConfidenceSchema = z.strictObject({
  value: FiniteNumberSchema.min(0).max(1),
  basis: z.array(IdentifierSchema).min(1),
});
export type CompositeConfidence = z.infer<typeof CompositeConfidenceSchema>;

export const StandardizedRiskRecordEnvelopeSchema = z.strictObject({
  riskRecordId: IdentifierSchema,
  record: StandardizedRiskRecordSchema,
  riskMechanismEntryIds: z.array(IdentifierSchema).min(1),
  sourceIds: z.array(IdentifierSchema).min(1),
  compositeConfidence: CompositeConfidenceSchema,
  version: VersionedRecordInfoSchema,
  audit: AuditInfoSchema,
});
export type StandardizedRiskRecordEnvelope = z.infer<typeof StandardizedRiskRecordEnvelopeSchema>;

export const ApplicabilityMetadataSchema = z.strictObject({
  constructionMethod: IdentifierSchema,
  stratumCondition: IdentifierSchema,
  engineeringStage: IdentifierSchema,
});
export type ApplicabilityMetadata = z.infer<typeof ApplicabilityMetadataSchema>;

export const ApplicabilityConditionsSchema = z.strictObject({
  constructionMethod: z.array(IdentifierSchema).min(1),
  stratumCondition: z.array(IdentifierSchema).min(1),
  engineeringStage: z.array(IdentifierSchema).min(1),
});
export type ApplicabilityConditions = z.infer<typeof ApplicabilityConditionsSchema>;

export const ScalarValueSchema = z.union([IdentifierSchema, FiniteNumberSchema, z.boolean()]);
export type ScalarValue = z.infer<typeof ScalarValueSchema>;

const ScoringOperatorSchema = z.enum(["lt", "lte", "eq", "gte", "gt"]);
const ScoringThresholdBaseShape = {
  thresholdId: IdentifierSchema,
  score: FiniteNumberSchema,
};

const NonRangeScoringThresholdSchema = z.strictObject({
  ...ScoringThresholdBaseShape,
  value: ScalarValueSchema,
  operator: ScoringOperatorSchema,
});

const RangeScoringThresholdSchema = z
  .strictObject({
    ...ScoringThresholdBaseShape,
    operator: z.literal("between"),
    value: FiniteNumberSchema,
    upperValue: FiniteNumberSchema,
  })
  .superRefine((threshold, context) => {
    if (threshold.upperValue <= threshold.value) {
      context.addIssue({
        code: "custom",
        path: ["upperValue"],
        message: "upperValue must be greater than value",
      });
    }
  });

export const ScoringThresholdSchema = z.union([
  NonRangeScoringThresholdSchema,
  RangeScoringThresholdSchema,
]);
export type ScoringThreshold = z.infer<typeof ScoringThresholdSchema>;

export const GradeIntervalSchema = z
  .strictObject({
    grade: IdentifierSchema,
    lowerBound: FiniteNumberSchema.optional(),
    upperBound: FiniteNumberSchema.optional(),
  })
  .superRefine((interval, context) => {
    if (interval.lowerBound === undefined && interval.upperBound === undefined) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "at least one interval bound is required",
      });
      return;
    }

    if (
      interval.lowerBound !== undefined &&
      interval.upperBound !== undefined &&
      interval.upperBound <= interval.lowerBound
    ) {
      context.addIssue({
        code: "custom",
        path: ["upperBound"],
        message: "upperBound must be greater than lowerBound",
      });
    }
  });
export type GradeInterval = z.infer<typeof GradeIntervalSchema>;

export const StructuredScoringRuleSchema = z.strictObject({
  ruleId: IdentifierSchema,
  applicabilityConditions: ApplicabilityConditionsSchema,
  indicatorItem: IdentifierSchema,
  scoringThresholds: z.array(ScoringThresholdSchema).min(1),
  gradeIntervals: z.array(GradeIntervalSchema).min(1),
  exceptionClauses: z.array(IdentifierSchema),
  evidenceLocator: EvidenceLocatorSchema,
  ruleVersion: VersionReferenceSchema,
  reviewStatus: ReviewStatusSchema,
});
export type StructuredScoringRule = z.infer<typeof StructuredScoringRuleSchema>;

const rejectPresentOppositeRiskInputField = (
  input: { kind: "standardized-risk-record" | "external-risk-event" },
  context: z.core.$RefinementCtx,
) => {
  const oppositeField =
    input.kind === "standardized-risk-record" ? "externalRiskEventId" : "riskRecordId";
  if (Object.hasOwn(input, oppositeField)) {
    context.addIssue({ code: "custom", path: [oppositeField], message: "conflicting risk input" });
  }
};

const RiskRecordInputSchema = z.strictObject({
  kind: z.literal("standardized-risk-record"),
  riskRecordId: IdentifierSchema,
  externalRiskEventId: z.never().optional(),
});
const ExternalRiskEventInputSchema = z.strictObject({
  kind: z.literal("external-risk-event"),
  externalRiskEventId: IdentifierSchema,
  riskRecordId: z.never().optional(),
});

export const RiskInputReferenceSchema = z
  .discriminatedUnion("kind", [RiskRecordInputSchema, ExternalRiskEventInputSchema])
  .superRefine(rejectPresentOppositeRiskInputField);
export type RiskInputReference = z.infer<typeof RiskInputReferenceSchema>;

export const IndicatorResultSchema = z.strictObject({
  indicatorItem: IdentifierSchema,
  actualValue: ScalarValueSchema,
  baseScore: FiniteNumberSchema,
  weightedScore: FiniteNumberSchema,
  ruleVersion: VersionReferenceSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
});
export type IndicatorResult = z.infer<typeof IndicatorResultSchema>;

export const TriggerIndicatorSchema = z.strictObject({
  indicatorItem: IdentifierSchema,
  triggerType: WarningTriggerTypeSchema,
  actualValue: ScalarValueSchema.optional(),
});
export type TriggerIndicator = z.infer<typeof TriggerIndicatorSchema>;

const RiskAssessmentRecordBaseShape = {
  assessmentRecordId: IdentifierSchema,
  applicabilityMetadataSnapshot: ApplicabilityMetadataSchema,
  likelihoodScore: FiniteNumberSchema,
  consequenceScore: FiniteNumberSchema,
  riskLevel: IdentifierSchema,
  indicatorResults: z.array(IndicatorResultSchema).min(1),
  triggerIndicators: z.array(TriggerIndicatorSchema),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  applicableRuleSetVersion: VersionReferenceSchema,
  weightVersion: VersionReferenceSchema,
  riskMatrixVersion: VersionReferenceSchema,
  audit: AuditInfoSchema,
};

export const RiskAssessmentRecordSchema = z
  .discriminatedUnion("kind", [
    RiskRecordInputSchema.extend(RiskAssessmentRecordBaseShape).strict(),
    ExternalRiskEventInputSchema.extend(RiskAssessmentRecordBaseShape).strict(),
  ])
  .superRefine(rejectPresentOppositeRiskInputField);
export type RiskAssessmentRecord = z.infer<typeof RiskAssessmentRecordSchema>;

export const WarningRecordSchema = z.strictObject({
  warningRecordId: IdentifierSchema,
  assessmentRecordId: IdentifierSchema,
  warningLevel: IdentifierSchema,
  triggerType: WarningTriggerTypeSchema,
  triggerIndicators: z.array(TriggerIndicatorSchema).min(1),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  recommendedResponseDirection: IdentifierSchema,
  notificationStatus: IdentifierSchema,
  audit: AuditInfoSchema,
});
export type WarningRecord = z.infer<typeof WarningRecordSchema>;

export const MeasureItemSchema = z.strictObject({
  measureId: IdentifierSchema,
  content: IdentifierSchema,
});
export type MeasureItem = z.infer<typeof MeasureItemSchema>;

export const TargetIndicatorSchema = z.strictObject({
  indicatorItem: IdentifierSchema,
  targetValue: ScalarValueSchema,
});
export type TargetIndicator = z.infer<typeof TargetIndicatorSchema>;

export const ResponseRecommendationSchema = z.strictObject({
  responseRecommendationId: IdentifierSchema,
  warningRecordId: IdentifierSchema,
  measureItems: z.array(MeasureItemSchema).min(1),
  implementationOrder: z.array(IdentifierSchema).min(1),
  resourceRequirements: z.array(IdentifierSchema).min(1),
  targetIndicators: z.array(TargetIndicatorSchema).min(1),
  triggerConsistencyValidation: ValidationResultSchema,
  standardsComplianceValidation: ValidationResultSchema,
  siteFeasibilityValidation: ValidationResultSchema,
  reviewStatus: ReviewStatusSchema,
  version: VersionedRecordInfoSchema,
  audit: AuditInfoSchema,
});
export type ResponseRecommendation = z.infer<typeof ResponseRecommendationSchema>;

export const RiskStateSchema = z.strictObject({
  likelihoodScore: FiniteNumberSchema,
  consequenceScore: FiniteNumberSchema,
  riskLevel: IdentifierSchema,
});
export type RiskState = z.infer<typeof RiskStateSchema>;

export const DeviationRecordSchema = z.strictObject({
  deviationRecordId: IdentifierSchema,
  responseRecommendationId: IdentifierSchema,
  predictedRiskChange: RiskStateSchema,
  actualRiskChange: RiskStateSchema,
  deviationValue: FiniteNumberSchema,
  deviationThresholdVersion: VersionReferenceSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  calibrationRecommendation: IdentifierSchema,
  reviewStatus: ReviewStatusSchema,
  version: VersionedRecordInfoSchema,
  audit: AuditInfoSchema,
});
export type DeviationRecord = z.infer<typeof DeviationRecordSchema>;
