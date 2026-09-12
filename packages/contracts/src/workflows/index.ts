import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "../common/index.js";
import {
  AcceptanceRouteSetRefV1Schema,
  AgentTaskRefV1Schema,
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentDecisionArtifactRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AssessmentRunResultRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuditTrailRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  DeviationRecordRefV1Schema,
  DomainEventRefV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  FeedbackRefV1Schema,
  IdentificationCandidateSetRefV1Schema,
  IdentificationGroupRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  IdentificationRunResultRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  IdentificationWorkPlanRefV1Schema,
  IdentificationPolicySetRefV1Schema,
  IndicatorActualValueSetRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  MergePlanRefV1Schema,
  ModelContextArtifactSetRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  NotificationIntentRefV1Schema,
  ProcessModelReleaseRefV1Schema,
  ProjectRevisionRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  ResponseFeedbackInputSnapshotRefV1Schema,
  ResponseForecastInputSnapshotRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  RecommendationCandidateRefV1Schema,
  RetrievalArtifactSetRefV1Schema,
  ResponseRecommendationRefV1Schema,
  ReviewTaskRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  RiskFlowRunResultRefV1Schema,
  RouteDecisionRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  StageResultRefV1Schema,
  ValidatedCandidateSetRefV1Schema,
  WarningRecordRefV1Schema,
  WarningResponseTaskRefV1Schema,
  WaitingRefV1Schema,
  WorkflowErrorRefV1Schema,
  WorkflowRunRefV1Schema,
  WorkflowRunStatusV1Schema,
  WorkflowRunTriggerTypeV1Schema,
  WorkflowEntryModeV1Schema,
} from "../ports/index.js";

const policyRef = VersionReferenceSchema;

export const IdentificationPreparationSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
    sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
    includedSourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1),
    excludedSegmentDecisionRefs: z.array(RouteDecisionRefV1Schema),
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
    dataProcessingPolicyRef: policyRef,
    dataProcessingToolRef: policyRef,
    dataProcessingModelRef: policyRef,
    coverageDecisionRef: RouteDecisionRefV1Schema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    auditTrailRef: AuditTrailRefV1Schema,
    createdBy: IdentifierSchema,
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((snapshot, context) => {
    if (snapshot.includedSourceSegmentSetRefs.length !== snapshot.sourceVersionRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["includedSourceSegmentSetRefs"],
        message: "includedSourceSegmentSetRefs must have one reference per source version",
      });
    }
  });
export type IdentificationPreparationSnapshotV1 = z.infer<
  typeof IdentificationPreparationSnapshotV1Schema
>;

export const IdentificationInputSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  processModelReleaseRef: ProcessModelReleaseRefV1Schema,
  riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema,
  retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  identificationPolicySetRef: IdentificationPolicySetRefV1Schema,
  retrievalPolicyRef: policyRef,
  retrievalReviewAgentPolicyRef: policyRef,
  repairPolicyRef: policyRef,
  confidencePolicyRef: policyRef,
  forcedReviewPolicyRef: policyRef,
  retryPolicyRef: policyRef,
  modelDeploymentRef: policyRef,
  promptTemplateRef: policyRef,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type IdentificationInputSnapshotV1 = z.infer<typeof IdentificationInputSnapshotV1Schema>;

export const AssessmentPreparationSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
  applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
  sourceEvidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  entryMode: WorkflowEntryModeV1Schema,
  triggerReasonCode: IdentifierSchema,
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  causalRunRef: WorkflowRunRefV1Schema.optional(),
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type AssessmentPreparationSnapshotV1 = z.infer<typeof AssessmentPreparationSnapshotV1Schema>;

export const AssessmentInputSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  indicatorSystemRef: policyRef,
  indicatorFieldMappingRef: policyRef,
  applicableRuleSetRef: policyRef,
  weightSetRef: policyRef,
  scoringStrategyRef: policyRef,
  riskMatrixRef: policyRef,
  riskAcceptanceThresholdRef: policyRef,
  monitoringWarningThresholdRef: policyRef,
  jointTriggerPolicyRef: policyRef,
  measureLibraryReleaseRef: policyRef,
  warningAggregationPolicyRef: policyRef,
  notificationPolicyRef: policyRef,
  responseGenerationPolicyRef: policyRef,
  responseValidationPolicyRef: policyRef,
  responseAgentPolicyRef: policyRef,
  effectForecastPolicyRef: policyRef,
  deviationPolicyRef: policyRef,
  calibrationAgentPolicyRef: policyRef,
  retryPolicyRef: policyRef,
  reviewPolicyRef: policyRef,
  modelDeploymentRef: policyRef,
  promptTemplateRef: policyRef,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type AssessmentInputSnapshotV1 = z.infer<typeof AssessmentInputSnapshotV1Schema>;

export const ResponseForecastInputSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  responseRecommendationRef: ResponseRecommendationRefV1Schema,
  adoptionDecisionRef: RouteDecisionRefV1Schema,
  preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
  forecastPolicyRef: policyRef,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type ResponseForecastInputSnapshotV1 = z.infer<typeof ResponseForecastInputSnapshotV1Schema>;

export const ResponseFeedbackInputSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  executionRecordRef: ExecutionRecordRefV1Schema,
  feedbackRef: FeedbackRefV1Schema,
  effectForecastRef: EffectForecastRefV1Schema.optional(),
  deviationPolicyRef: policyRef,
  calibrationAgentPolicyRef: policyRef,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type ResponseFeedbackInputSnapshotV1 = z.infer<typeof ResponseFeedbackInputSnapshotV1Schema>;

export const AssessmentEntrySnapshotRefV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("assessment-preparation"),
    assessmentPreparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("forecast-input"),
    responseForecastInputSnapshotRef: ResponseForecastInputSnapshotRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("feedback-input"),
    responseFeedbackInputSnapshotRef: ResponseFeedbackInputSnapshotRefV1Schema,
  }),
]);
export type AssessmentEntrySnapshotRefV1 = z.infer<typeof AssessmentEntrySnapshotRefV1Schema>;

export const IdentificationStageV1Schema = z.enum([
  "I0",
  "I1",
  "I2",
  "I3",
  "I4",
  "I5",
  "I6",
  "I7",
  "I8",
  "I9",
]);
export type IdentificationStageV1 = z.infer<typeof IdentificationStageV1Schema>;

export const AssessmentStageV1Schema = z.enum([
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
]);
export type AssessmentStageV1 = z.infer<typeof AssessmentStageV1Schema>;

const identificationStageBase = {
  schemaVersion: z.literal("1"),
  runRef: WorkflowRunRefV1Schema,
  recordedAt: IsoDateTimeSchema,
};

const IdentificationI1StageResultV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I1"),
    resultKind: z.literal("ready"),
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I1"),
    resultKind: z.literal("waiting"),
    waitingRef: WaitingRefV1Schema,
  }),
]);

export const IdentificationStageResultV1Schema = z.discriminatedUnion("stage", [
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I0"),
    preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
    workflowErrorRef: WorkflowErrorRefV1Schema.optional(),
  }),
  IdentificationI1StageResultV1Schema,
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I2"),
    workPlanRef: IdentificationWorkPlanRefV1Schema,
    plannedWorkItemCount: z.number().int().nonnegative(),
    excludedWorkItemCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I3"),
    retrievalArtifactSetRefs: z.array(RetrievalArtifactSetRefV1Schema),
    agentTaskRefs: z.array(AgentTaskRefV1Schema),
    failedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I4"),
    modelContextArtifactSetRefs: z.array(ModelContextArtifactSetRefV1Schema),
    candidateSetRef: IdentificationCandidateSetRefV1Schema,
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I5"),
    validatedCandidateSetRef: ValidatedCandidateSetRefV1Schema,
    failedCandidateSetRef: IdentificationCandidateSetRefV1Schema.optional(),
    reviewTaskRefs: z.array(ReviewTaskRefV1Schema),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I6"),
    mergePlanRef: MergePlanRefV1Schema,
    skippedMergeGroupRefs: z.array(IdentificationGroupRefV1Schema),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I7"),
    acceptanceRouteSetRef: AcceptanceRouteSetRefV1Schema,
    reviewTaskRefs: z.array(ReviewTaskRefV1Schema),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I8"),
    standardizedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema),
    eventRefs: z.array(DomainEventRefV1Schema),
  }),
  z.strictObject({
    ...identificationStageBase,
    stage: z.literal("I9"),
    identificationRunResultRef: IdentificationRunResultRefV1Schema,
  }),
]);
export type IdentificationStageResultV1 = z.infer<typeof IdentificationStageResultV1Schema>;

const assessmentStageBase = {
  schemaVersion: z.literal("1"),
  runRef: WorkflowRunRefV1Schema,
  recordedAt: IsoDateTimeSchema,
};

const AssessmentA1StageResultV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A1"),
    resultKind: z.literal("ready"),
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A1"),
    resultKind: z.literal("waiting"),
    waitingRef: WaitingRefV1Schema,
  }),
]);

const AssessmentA8StageResultV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A8"),
    resultKind: z.literal("recorded"),
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A8"),
    resultKind: z.literal("waiting-review"),
    reviewTaskRef: ReviewTaskRefV1Schema,
  }),
]);

export const AssessmentStageResultV1Schema = z.discriminatedUnion("stage", [
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A0"),
    preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  }),
  AssessmentA1StageResultV1Schema,
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A2"),
    assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A3"),
    indicatorActualValueSetRef: IndicatorActualValueSetRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A4"),
    assessmentDecisionArtifactRef: AssessmentDecisionArtifactRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A5"),
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A6"),
    warningRecordRefs: z.array(WarningRecordRefV1Schema),
    warningResponseTaskRefs: z.array(WarningResponseTaskRefV1Schema),
    notificationIntentRefs: z.array(NotificationIntentRefV1Schema),
  }),
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A7"),
    measureQueryResultRef: KnowledgeQueryResultRefV1Schema,
    agentTaskRefs: z.array(AgentTaskRefV1Schema),
    recommendationCandidateRefs: z.array(RecommendationCandidateRefV1Schema),
  }),
  AssessmentA8StageResultV1Schema,
  z.strictObject({
    ...assessmentStageBase,
    stage: z.literal("A9"),
    assessmentRunResultRef: AssessmentRunResultRefV1Schema,
  }),
]);
export type AssessmentStageResultV1 = z.infer<typeof AssessmentStageResultV1Schema>;

const lifecycleStateRefine = (
  state: {
    status: string;
    resultRef?: unknown;
    lastErrorRef?: unknown;
    waitingRef?: unknown;
    waitingRefs?: unknown[];
  },
  context: z.RefinementCtx,
) => {
  const hasWaitingRef =
    state.waitingRef !== undefined ||
    (state.waitingRefs !== undefined && state.waitingRefs.length > 0);
  if (state.status === "waiting") {
    if (!hasWaitingRef) {
      context.addIssue({
        code: "custom",
        path: ["waitingRef"],
        message: "waiting state requires a waiting reference",
      });
    }
    if (state.resultRef !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["resultRef"],
        message: "waiting state cannot have a result",
      });
    }
  } else if (hasWaitingRef) {
    context.addIssue({
      code: "custom",
      path: ["waitingRef"],
      message: "only waiting state can have a waiting reference",
    });
  }
  if (
    (state.status === "completed" || state.status === "cancelled") &&
    state.resultRef === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["resultRef"],
      message: "terminal state requires a result",
    });
  }
  if (
    (state.status === "retryable-failure" || state.status === "terminal-failure") &&
    state.lastErrorRef === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["lastErrorRef"],
      message: "failure state requires an error",
    });
  }
  if (
    state.status !== "completed" &&
    state.status !== "cancelled" &&
    state.resultRef !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["resultRef"],
      message: "non-terminal state cannot have a result",
    });
  }
};

export const IdentificationGraphStateV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    graphVersion: VersionReferenceSchema,
    parentRiskFlowRunRef: WorkflowRunRefV1Schema,
    runRef: WorkflowRunRefV1Schema,
    threadId: IdentifierSchema,
    triggerType: WorkflowRunTriggerTypeV1Schema,
    triggerReasonCode: IdentifierSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema.optional(),
    status: WorkflowRunStatusV1Schema,
    stage: IdentificationStageV1Schema,
    workPlanRef: IdentificationWorkPlanRefV1Schema.optional(),
    candidateSetRef: IdentificationCandidateSetRefV1Schema.optional(),
    mergePlanRef: MergePlanRefV1Schema.optional(),
    waitingRef: WaitingRefV1Schema.optional(),
    agentTaskRefs: z.array(AgentTaskRefV1Schema),
    acceptedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema),
    reviewTaskRefs: z.array(ReviewTaskRefV1Schema),
    rejectedGroupRefs: z.array(IdentificationGroupRefV1Schema),
    failedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
    lastStageResultRef: StageResultRefV1Schema.optional(),
    lastRouteDecisionRef: RouteDecisionRefV1Schema.optional(),
    lastErrorRef: WorkflowErrorRefV1Schema.optional(),
    resultRef: IdentificationRunResultRefV1Schema.optional(),
  })
  .superRefine(lifecycleStateRefine);
export type IdentificationGraphStateV1 = z.infer<typeof IdentificationGraphStateV1Schema>;

export const AssessmentGraphStateV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    graphVersion: VersionReferenceSchema,
    parentRiskFlowRunRef: WorkflowRunRefV1Schema,
    runRef: WorkflowRunRefV1Schema,
    threadId: IdentifierSchema,
    entryMode: WorkflowEntryModeV1Schema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    entrySnapshotRef: AssessmentEntrySnapshotRefV1Schema,
    status: WorkflowRunStatusV1Schema,
    stage: AssessmentStageV1Schema,
    assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema.optional(),
    waitingRef: WaitingRefV1Schema.optional(),
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
    warningRecordRefs: z.array(WarningRecordRefV1Schema),
    warningResponseTaskRefs: z.array(WarningResponseTaskRefV1Schema),
    recommendationCandidateRef: RecommendationCandidateRefV1Schema.optional(),
    agentTaskRefs: z.array(AgentTaskRefV1Schema),
    responseRecommendationRef: ResponseRecommendationRefV1Schema.optional(),
    effectForecastRef: EffectForecastRefV1Schema.optional(),
    executionRecordRef: ExecutionRecordRefV1Schema.optional(),
    feedbackRef: FeedbackRefV1Schema.optional(),
    deviationRecordRef: DeviationRecordRefV1Schema.optional(),
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema.optional(),
    reviewTaskRefs: z.array(ReviewTaskRefV1Schema),
    lastStageResultRef: StageResultRefV1Schema.optional(),
    lastRouteDecisionRef: RouteDecisionRefV1Schema.optional(),
    lastErrorRef: WorkflowErrorRefV1Schema.optional(),
    resultRef: AssessmentRunResultRefV1Schema.optional(),
  })
  .superRefine(lifecycleStateRefine);
export type AssessmentGraphStateV1 = z.infer<typeof AssessmentGraphStateV1Schema>;

export const RiskFlowStageV1Schema = z.enum([
  "preparing",
  "identification",
  "assessment",
  "result-summary",
]);
export type RiskFlowStageV1 = z.infer<typeof RiskFlowStageV1Schema>;

export const RiskFlowGraphStateV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    graphVersion: VersionReferenceSchema,
    runRef: WorkflowRunRefV1Schema,
    threadId: IdentifierSchema,
    entryMode: WorkflowEntryModeV1Schema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    status: WorkflowRunStatusV1Schema,
    stage: RiskFlowStageV1Schema,
    identificationRunRef: WorkflowRunRefV1Schema.optional(),
    assessmentRunRefs: z.array(WorkflowRunRefV1Schema),
    waitingRefs: z.array(WaitingRefV1Schema),
    lastStageResultRef: StageResultRefV1Schema.optional(),
    lastRouteDecisionRef: RouteDecisionRefV1Schema.optional(),
    lastErrorRef: WorkflowErrorRefV1Schema.optional(),
    resultRef: RiskFlowRunResultRefV1Schema.optional(),
  })
  .superRefine((state, context) => {
    lifecycleStateRefine(state, context);
    if (state.status === "waiting" && state.waitingRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["waitingRefs"],
        message: "waiting state requires at least one waiting reference",
      });
    }
    if (state.entryMode !== "identify-and-assess" && state.identificationRunRef !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["identificationRunRef"],
        message: "assessment-only entry cannot have an identification run",
      });
    }
  });
export type RiskFlowGraphStateV1 = z.infer<typeof RiskFlowGraphStateV1Schema>;
