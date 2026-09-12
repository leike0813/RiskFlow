import { z, type ZodType } from "zod";

import {
  CommandEnvelopeSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "../common/index.js";
export { RiskInputReferenceSchema } from "../records/index.js";
export type { RiskInputReference } from "../records/index.js";

const versionedRef = <const T extends string>(kind: T) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

export const AuthorizationContextRefV1Schema = versionedRef("authorization-context");
export type AuthorizationContextRefV1 = z.infer<typeof AuthorizationContextRefV1Schema>;

export const ProjectRevisionRefV1Schema = versionedRef("project-revision");
export type ProjectRevisionRefV1 = z.infer<typeof ProjectRevisionRefV1Schema>;

export const SpatialScopeRefV1Schema = versionedRef("spatial-scope");
export type SpatialScopeRefV1 = z.infer<typeof SpatialScopeRefV1Schema>;

export const SourceAccessGrantRefV1Schema = versionedRef("source-access-grant");
export type SourceAccessGrantRefV1 = z.infer<typeof SourceAccessGrantRefV1Schema>;

export const ContentArtifactRefV1Schema = versionedRef("content-artifact");
export type ContentArtifactRefV1 = z.infer<typeof ContentArtifactRefV1Schema>;

export const DiagnosticArtifactRefV1Schema = versionedRef("diagnostic-artifact");
export type DiagnosticArtifactRefV1 = z.infer<typeof DiagnosticArtifactRefV1Schema>;

export const SourceDeliveryRefV1Schema = versionedRef("source-delivery");
export type SourceDeliveryRefV1 = z.infer<typeof SourceDeliveryRefV1Schema>;

export const SourceVersionRefV1Schema = versionedRef("source-version");
export type SourceVersionRefV1 = z.infer<typeof SourceVersionRefV1Schema>;

export const SourceSegmentSetRefV1Schema = versionedRef("source-segment-set");
export type SourceSegmentSetRefV1 = z.infer<typeof SourceSegmentSetRefV1Schema>;

export const StructuredDocumentConversionRefV1Schema = versionedRef(
  "structured-document-conversion",
);
export type StructuredDocumentConversionRefV1 = z.infer<
  typeof StructuredDocumentConversionRefV1Schema
>;

export const MonitoringSeriesRefV1Schema = versionedRef("monitoring-series");
export type MonitoringSeriesRefV1 = z.infer<typeof MonitoringSeriesRefV1Schema>;

export const MonitoringBatchRefV1Schema = versionedRef("monitoring-batch");
export type MonitoringBatchRefV1 = z.infer<typeof MonitoringBatchRefV1Schema>;

export const MonitoringSnapshotRefV1Schema = versionedRef("monitoring-snapshot");
export type MonitoringSnapshotRefV1 = z.infer<typeof MonitoringSnapshotRefV1Schema>;

export const ApplicabilityMetadataSnapshotRefV1Schema = versionedRef(
  "applicability-metadata-snapshot",
);
export type ApplicabilityMetadataSnapshotRefV1 = z.infer<
  typeof ApplicabilityMetadataSnapshotRefV1Schema
>;

export const ExternalRiskEventRefV1Schema = versionedRef("external-risk-event");
export type ExternalRiskEventRefV1 = z.infer<typeof ExternalRiskEventRefV1Schema>;

export const KnowledgeRevisionRefV1Schema = versionedRef("knowledge-revision");
export type KnowledgeRevisionRefV1 = z.infer<typeof KnowledgeRevisionRefV1Schema>;

export const KnowledgeReleaseRefV1Schema = versionedRef("knowledge-release");
export type KnowledgeReleaseRefV1 = z.infer<typeof KnowledgeReleaseRefV1Schema>;

export const KnowledgePreparationTaskRefV1Schema = versionedRef("knowledge-preparation-task");
export type KnowledgePreparationTaskRefV1 = z.infer<typeof KnowledgePreparationTaskRefV1Schema>;

export const ProcessModelReleaseRefV1Schema = versionedRef("process-model-release");
export type ProcessModelReleaseRefV1 = z.infer<typeof ProcessModelReleaseRefV1Schema>;

export const RiskMechanismReleaseRefV1Schema = versionedRef("risk-mechanism-release");
export type RiskMechanismReleaseRefV1 = z.infer<typeof RiskMechanismReleaseRefV1Schema>;

export const RetrievalEvidenceBaseReleaseRefV1Schema = versionedRef(
  "retrieval-evidence-base-release",
);
export type RetrievalEvidenceBaseReleaseRefV1 = z.infer<
  typeof RetrievalEvidenceBaseReleaseRefV1Schema
>;

export const IdentificationPolicySetRefV1Schema = versionedRef("identification-policy-set");
export type IdentificationPolicySetRefV1 = z.infer<typeof IdentificationPolicySetRefV1Schema>;

export const AssessmentBasisReleaseSetRefV1Schema = versionedRef("assessment-basis-release-set");
export type AssessmentBasisReleaseSetRefV1 = z.infer<typeof AssessmentBasisReleaseSetRefV1Schema>;

export const MeasureLibraryReleaseRefV1Schema = versionedRef("measure-library-release");
export type MeasureLibraryReleaseRefV1 = z.infer<typeof MeasureLibraryReleaseRefV1Schema>;

export const KnowledgeQueryResultRefV1Schema = versionedRef("knowledge-query-result");
export type KnowledgeQueryResultRefV1 = z.infer<typeof KnowledgeQueryResultRefV1Schema>;

export const IdentificationPreparationSnapshotRefV1Schema = versionedRef(
  "identification-preparation-snapshot",
);
export type IdentificationPreparationSnapshotRefV1 = z.infer<
  typeof IdentificationPreparationSnapshotRefV1Schema
>;

export const IdentificationInputSnapshotRefV1Schema = versionedRef("identification-input-snapshot");
export type IdentificationInputSnapshotRefV1 = z.infer<
  typeof IdentificationInputSnapshotRefV1Schema
>;

export const IdentificationWorkPlanRefV1Schema = versionedRef("identification-work-plan");
export type IdentificationWorkPlanRefV1 = z.infer<typeof IdentificationWorkPlanRefV1Schema>;

export const IdentificationWorkItemRefV1Schema = versionedRef("identification-work-item");
export type IdentificationWorkItemRefV1 = z.infer<typeof IdentificationWorkItemRefV1Schema>;

export const RetrievalArtifactSetRefV1Schema = versionedRef("retrieval-artifact-set");
export type RetrievalArtifactSetRefV1 = z.infer<typeof RetrievalArtifactSetRefV1Schema>;

export const ModelContextArtifactSetRefV1Schema = versionedRef("model-context-artifact-set");
export type ModelContextArtifactSetRefV1 = z.infer<typeof ModelContextArtifactSetRefV1Schema>;

export const IdentificationCandidateSetRefV1Schema = versionedRef("identification-candidate-set");
export type IdentificationCandidateSetRefV1 = z.infer<typeof IdentificationCandidateSetRefV1Schema>;

export const IdentificationGroupRefV1Schema = versionedRef("identification-group");
export type IdentificationGroupRefV1 = z.infer<typeof IdentificationGroupRefV1Schema>;

export const ValidatedCandidateSetRefV1Schema = versionedRef("validated-candidate-set");
export type ValidatedCandidateSetRefV1 = z.infer<typeof ValidatedCandidateSetRefV1Schema>;

export const MergePlanRefV1Schema = versionedRef("merge-plan");
export type MergePlanRefV1 = z.infer<typeof MergePlanRefV1Schema>;

export const AcceptanceRouteSetRefV1Schema = versionedRef("acceptance-route-set");
export type AcceptanceRouteSetRefV1 = z.infer<typeof AcceptanceRouteSetRefV1Schema>;

export const StandardizedRiskRecordRefV1Schema = versionedRef("standardized-risk-record");
export type StandardizedRiskRecordRefV1 = z.infer<typeof StandardizedRiskRecordRefV1Schema>;

export const IdentificationRunResultRefV1Schema = versionedRef("identification-run-result");
export type IdentificationRunResultRefV1 = z.infer<typeof IdentificationRunResultRefV1Schema>;

export const AssessmentPreparationSnapshotRefV1Schema = versionedRef(
  "assessment-preparation-snapshot",
);
export type AssessmentPreparationSnapshotRefV1 = z.infer<
  typeof AssessmentPreparationSnapshotRefV1Schema
>;

export const AssessmentInputSnapshotRefV1Schema = versionedRef("assessment-input-snapshot");
export type AssessmentInputSnapshotRefV1 = z.infer<typeof AssessmentInputSnapshotRefV1Schema>;

export const ResponseForecastInputSnapshotRefV1Schema = versionedRef(
  "response-forecast-input-snapshot",
);
export type ResponseForecastInputSnapshotRefV1 = z.infer<
  typeof ResponseForecastInputSnapshotRefV1Schema
>;

export const ResponseFeedbackInputSnapshotRefV1Schema = versionedRef(
  "response-feedback-input-snapshot",
);
export type ResponseFeedbackInputSnapshotRefV1 = z.infer<
  typeof ResponseFeedbackInputSnapshotRefV1Schema
>;

export const IndicatorActualValueSetRefV1Schema = versionedRef("indicator-actual-value-set");
export type IndicatorActualValueSetRefV1 = z.infer<typeof IndicatorActualValueSetRefV1Schema>;

export const AssessmentDecisionArtifactRefV1Schema = versionedRef("assessment-decision-artifact");
export type AssessmentDecisionArtifactRefV1 = z.infer<typeof AssessmentDecisionArtifactRefV1Schema>;

export const RiskAssessmentRecordRefV1Schema = versionedRef("risk-assessment-record");
export type RiskAssessmentRecordRefV1 = z.infer<typeof RiskAssessmentRecordRefV1Schema>;

export const WarningRecordRefV1Schema = versionedRef("warning-record");
export type WarningRecordRefV1 = z.infer<typeof WarningRecordRefV1Schema>;

export const WarningResponseTaskRefV1Schema = versionedRef("warning-response-task");
export type WarningResponseTaskRefV1 = z.infer<typeof WarningResponseTaskRefV1Schema>;

export const NotificationIntentRefV1Schema = versionedRef("notification-intent");
export type NotificationIntentRefV1 = z.infer<typeof NotificationIntentRefV1Schema>;

export const RecommendationCandidateRefV1Schema = versionedRef("recommendation-candidate");
export type RecommendationCandidateRefV1 = z.infer<typeof RecommendationCandidateRefV1Schema>;

export const ResponseRecommendationRefV1Schema = versionedRef("response-recommendation");
export type ResponseRecommendationRefV1 = z.infer<typeof ResponseRecommendationRefV1Schema>;

export const EffectForecastRefV1Schema = versionedRef("effect-forecast");
export type EffectForecastRefV1 = z.infer<typeof EffectForecastRefV1Schema>;

export const ExecutionRecordRefV1Schema = versionedRef("execution-record");
export type ExecutionRecordRefV1 = z.infer<typeof ExecutionRecordRefV1Schema>;

export const FeedbackRefV1Schema = versionedRef("feedback");
export type FeedbackRefV1 = z.infer<typeof FeedbackRefV1Schema>;

export const DeviationRecordRefV1Schema = versionedRef("deviation-record");
export type DeviationRecordRefV1 = z.infer<typeof DeviationRecordRefV1Schema>;

export const CalibrationSuggestionRefV1Schema = versionedRef("calibration-suggestion");
export type CalibrationSuggestionRefV1 = z.infer<typeof CalibrationSuggestionRefV1Schema>;

export const AssessmentRunResultRefV1Schema = versionedRef("assessment-run-result");
export type AssessmentRunResultRefV1 = z.infer<typeof AssessmentRunResultRefV1Schema>;

export const ReviewDecisionRefV1Schema = versionedRef("review-decision");
export type ReviewDecisionRefV1 = z.infer<typeof ReviewDecisionRefV1Schema>;

export const AuditTrailRefV1Schema = versionedRef("audit-trail");
export type AuditTrailRefV1 = z.infer<typeof AuditTrailRefV1Schema>;

export const ValidationSnapshotRefV1Schema = versionedRef("validation-snapshot");
export type ValidationSnapshotRefV1 = z.infer<typeof ValidationSnapshotRefV1Schema>;

export const EvidenceSnapshotRefV1Schema = versionedRef("evidence-snapshot");
export type EvidenceSnapshotRefV1 = z.infer<typeof EvidenceSnapshotRefV1Schema>;

export const CommandProposalRefV1Schema = versionedRef("command-proposal");
export type CommandProposalRefV1 = z.infer<typeof CommandProposalRefV1Schema>;

export const UserConfirmationRefV1Schema = versionedRef("user-confirmation");
export type UserConfirmationRefV1 = z.infer<typeof UserConfirmationRefV1Schema>;

export const WorkflowRunRefV1Schema = versionedRef("workflow-run");
export type WorkflowRunRefV1 = z.infer<typeof WorkflowRunRefV1Schema>;

export const StageResultRefV1Schema = versionedRef("stage-result");
export type StageResultRefV1 = z.infer<typeof StageResultRefV1Schema>;

export const RouteDecisionRefV1Schema = versionedRef("route-decision");
export type RouteDecisionRefV1 = z.infer<typeof RouteDecisionRefV1Schema>;

export const WorkflowErrorRefV1Schema = versionedRef("workflow-error");
export type WorkflowErrorRefV1 = z.infer<typeof WorkflowErrorRefV1Schema>;

export const RiskFlowRunResultRefV1Schema = versionedRef("risk-flow-run-result");
export type RiskFlowRunResultRefV1 = z.infer<typeof RiskFlowRunResultRefV1Schema>;

export const QueryResultRefV1Schema = versionedRef("query-result");
export type QueryResultRefV1 = z.infer<typeof QueryResultRefV1Schema>;

export const ExportArtifactRefV1Schema = versionedRef("export-artifact");
export type ExportArtifactRefV1 = z.infer<typeof ExportArtifactRefV1Schema>;

export const DomainEventRefV1Schema = z.strictObject({
  kind: z.literal("domain-event"),
  eventId: IdentifierSchema,
  eventVersion: z.literal(1),
});
export type DomainEventRefV1 = z.infer<typeof DomainEventRefV1Schema>;

export const AgentTaskTypeV1Schema = z.enum([
  "data-cleaning",
  "knowledge-authoring",
  "retrieval-review",
  "response-recommendation",
  "calibration-suggestion",
]);
export type AgentTaskTypeV1 = z.infer<typeof AgentTaskTypeV1Schema>;

export const AgentTriggerModeV1Schema = z.enum(["embedded", "interactive"]);
export type AgentTriggerModeV1 = z.infer<typeof AgentTriggerModeV1Schema>;

export const AgentTaskStatusV1Schema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentTaskStatusV1 = z.infer<typeof AgentTaskStatusV1Schema>;

export const ReviewTypeV1Schema = z.enum([
  "identification-group",
  "knowledge-revision",
  "rule-conflict",
  "response-candidate",
  "calibration-suggestion",
]);
export type ReviewTypeV1 = z.infer<typeof ReviewTypeV1Schema>;

export const ReviewTargetRefV1Schema = z.discriminatedUnion("kind", [
  IdentificationCandidateSetRefV1Schema,
  IdentificationGroupRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  z.strictObject({ kind: z.literal("rule-conflict"), reference: VersionReferenceSchema }),
  z.strictObject({ kind: z.literal("response-candidate"), reference: VersionReferenceSchema }),
  RecommendationCandidateRefV1Schema,
  CalibrationSuggestionRefV1Schema,
]);
export type ReviewTargetRefV1 = z.infer<typeof ReviewTargetRefV1Schema>;

const IdentificationReviewTargetRefV1Schema = z.discriminatedUnion("kind", [
  IdentificationCandidateSetRefV1Schema,
  IdentificationGroupRefV1Schema,
]);
const KnowledgeReviewTargetRefV1Schema = KnowledgeRevisionRefV1Schema;
const RuleConflictReviewTargetRefV1Schema = z.strictObject({
  kind: z.literal("rule-conflict"),
  reference: VersionReferenceSchema,
});
const ResponseReviewTargetRefV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("response-candidate"), reference: VersionReferenceSchema }),
  RecommendationCandidateRefV1Schema,
]);
const CalibrationReviewTargetRefV1Schema = CalibrationSuggestionRefV1Schema;

export const AgentTaskRefV1Schema = z.strictObject({
  kind: z.literal("agent-task"),
  reference: VersionReferenceSchema,
  taskType: AgentTaskTypeV1Schema,
  triggerMode: AgentTriggerModeV1Schema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  toolPolicyRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  incrementSchemaRef: VersionReferenceSchema,
  validationPolicyRef: VersionReferenceSchema,
});
export type AgentTaskRefV1 = z.infer<typeof AgentTaskRefV1Schema>;

const reviewTaskBase = {
  kind: z.literal("review-task"),
  reference: VersionReferenceSchema,
  waitingRunRef: WorkflowRunRefV1Schema,
};

export const ReviewTaskRefV1Schema = z.discriminatedUnion("reviewType", [
  z.strictObject({
    ...reviewTaskBase,
    reviewType: z.literal("identification-group"),
    targetRef: IdentificationReviewTargetRefV1Schema,
  }),
  z.strictObject({
    ...reviewTaskBase,
    reviewType: z.literal("knowledge-revision"),
    targetRef: KnowledgeReviewTargetRefV1Schema,
  }),
  z.strictObject({
    ...reviewTaskBase,
    reviewType: z.literal("rule-conflict"),
    targetRef: RuleConflictReviewTargetRefV1Schema,
  }),
  z.strictObject({
    ...reviewTaskBase,
    reviewType: z.literal("response-candidate"),
    targetRef: ResponseReviewTargetRefV1Schema,
  }),
  z.strictObject({
    ...reviewTaskBase,
    reviewType: z.literal("calibration-suggestion"),
    targetRef: CalibrationReviewTargetRefV1Schema,
  }),
]);
export type ReviewTaskRefV1 = z.infer<typeof ReviewTaskRefV1Schema>;

export const RiskInputVersionRefV1Schema = z.discriminatedUnion("kind", [
  StandardizedRiskRecordRefV1Schema,
  ExternalRiskEventRefV1Schema,
]);
export type RiskInputVersionRefV1 = z.infer<typeof RiskInputVersionRefV1Schema>;

export const ContractReferenceV1Schema = z.discriminatedUnion("kind", [
  AuthorizationContextRefV1Schema,
  ProjectRevisionRefV1Schema,
  SpatialScopeRefV1Schema,
  SourceAccessGrantRefV1Schema,
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
  SourceDeliveryRefV1Schema,
  SourceVersionRefV1Schema,
  SourceSegmentSetRefV1Schema,
  StructuredDocumentConversionRefV1Schema,
  MonitoringSeriesRefV1Schema,
  MonitoringBatchRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  ApplicabilityMetadataSnapshotRefV1Schema,
  ExternalRiskEventRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgePreparationTaskRefV1Schema,
  ProcessModelReleaseRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  IdentificationPolicySetRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  MeasureLibraryReleaseRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationWorkPlanRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  RetrievalArtifactSetRefV1Schema,
  ModelContextArtifactSetRefV1Schema,
  IdentificationCandidateSetRefV1Schema,
  IdentificationGroupRefV1Schema,
  ValidatedCandidateSetRefV1Schema,
  MergePlanRefV1Schema,
  AcceptanceRouteSetRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  IdentificationRunResultRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  ResponseForecastInputSnapshotRefV1Schema,
  ResponseFeedbackInputSnapshotRefV1Schema,
  IndicatorActualValueSetRefV1Schema,
  AssessmentDecisionArtifactRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  WarningRecordRefV1Schema,
  WarningResponseTaskRefV1Schema,
  NotificationIntentRefV1Schema,
  RecommendationCandidateRefV1Schema,
  ResponseRecommendationRefV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  FeedbackRefV1Schema,
  DeviationRecordRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  AssessmentRunResultRefV1Schema,
  ReviewDecisionRefV1Schema,
  AuditTrailRefV1Schema,
  ValidationSnapshotRefV1Schema,
  EvidenceSnapshotRefV1Schema,
  CommandProposalRefV1Schema,
  UserConfirmationRefV1Schema,
  WorkflowRunRefV1Schema,
  StageResultRefV1Schema,
  RouteDecisionRefV1Schema,
  WorkflowErrorRefV1Schema,
  DomainEventRefV1Schema,
  RiskFlowRunResultRefV1Schema,
  QueryResultRefV1Schema,
  ExportArtifactRefV1Schema,
  AgentTaskRefV1Schema,
  ReviewTaskRefV1Schema,
]);
export type ContractReferenceV1 = z.infer<typeof ContractReferenceV1Schema>;

export const ModuleCapabilityV1_VALUES = [
  "engineering-data.read",
  "engineering-data.write",
  "engineering-data.freeze",
  "knowledge-modeling.read",
  "knowledge-modeling.govern",
  "knowledge-modeling.retrieve",
  "risk-identification.read",
  "risk-identification.run",
  "risk-identification.finalize",
  "risk-assessment.read",
  "risk-assessment.prepare",
  "risk-assessment.evaluate",
  "warning-response.read",
  "warning-response.recommend",
  "warning-response.record",
  "review-audit.read",
  "review-audit.request",
  "review-audit.decide",
  "agent-task.start",
  "agent-task.resume",
  "agent-task.cancel",
  "agent-task.confirm",
  "workflow.start",
  "workflow.resume",
  "workflow.cancel",
  "projection.query",
  "projection.subscribe",
  "projection.export",
] as const;
export const ModuleCapabilityV1Schema = z.enum(ModuleCapabilityV1_VALUES);
export type ModuleCapabilityV1 = z.infer<typeof ModuleCapabilityV1Schema>;

export const MODULE_BRANCH_CAPABILITY_V1 = {
  "engineering-data.register-source-delivery": "engineering-data.write",
  "engineering-data.register-monitoring-batch": "engineering-data.write",
  "engineering-data.register-external-risk-event": "engineering-data.write",
  "engineering-data.identification-preparation": "engineering-data.freeze",
  "engineering-data.assessment-preparation": "engineering-data.freeze",
  "engineering-data.monitoring-snapshot": "engineering-data.freeze",
  "engineering-data.source-segments": "engineering-data.read",
  "engineering-data.monitoring-snapshot-query": "engineering-data.read",
  "engineering-data.evidence-access": "engineering-data.read",
  "knowledge-modeling.submit-revision": "knowledge-modeling.govern",
  "knowledge-modeling.request-review": "knowledge-modeling.govern",
  "knowledge-modeling.publish-approved-release": "knowledge-modeling.govern",
  "knowledge-modeling.deactivate-release": "knowledge-modeling.govern",
  "knowledge-modeling.rollback-by-new-release": "knowledge-modeling.govern",
  "knowledge-modeling.identification-basis": "knowledge-modeling.read",
  "knowledge-modeling.assessment-basis": "knowledge-modeling.read",
  "knowledge-modeling.hybrid-evidence": "knowledge-modeling.retrieve",
  "knowledge-modeling.relationship-context": "knowledge-modeling.retrieve",
  "knowledge-modeling.measure-candidates": "knowledge-modeling.retrieve",
  "risk-identification.plan": "risk-identification.run",
  "risk-identification.assemble-and-infer": "risk-identification.run",
  "risk-identification.repair-and-validate": "risk-identification.run",
  "risk-identification.merge-run-candidates": "risk-identification.finalize",
  "risk-identification.route-acceptance": "risk-identification.finalize",
  "risk-identification.accept-groups": "risk-identification.finalize",
  "risk-assessment.initial": "risk-assessment.prepare",
  "risk-assessment.reassessment": "risk-assessment.prepare",
  "risk-assessment.historical-backfill": "risk-assessment.prepare",
  "risk-assessment.evaluate": "risk-assessment.evaluate",
  "warning-response.open": "warning-response.record",
  "warning-response.create-candidate": "warning-response.recommend",
  "warning-response.validate-and-record": "warning-response.recommend",
  "warning-response.adopt-recommendation": "warning-response.record",
  "warning-response.record-execution": "warning-response.record",
  "warning-response.record-feedback": "warning-response.record",
  "warning-response.calculate-deviation": "warning-response.record",
  "warning-response.create-calibration-suggestion": "warning-response.record",
  "review-audit.request-review": "review-audit.request",
  "review-audit.decide-review": "review-audit.decide",
  "review-audit.trace": "review-audit.read",
  "review-audit.verify-knowledge-revision-approval": "review-audit.read",
  "agent-task.start-task": "agent-task.start",
  "agent-task.resume-task": "agent-task.resume",
  "agent-task.cancel-task": "agent-task.cancel",
  "agent-task.confirm-command": "agent-task.confirm",
  "workflow.start-run": "workflow.start",
  "workflow.resume-run": "workflow.resume",
  "workflow.cancel-run": "workflow.cancel",
  "projection.query": "projection.query",
  "projection.subscribe": "projection.subscribe",
  "projection.export": "projection.export",
} as const;
export type ModuleBranchV1 = keyof typeof MODULE_BRANCH_CAPABILITY_V1;

const branchCapability = <T extends ModuleBranchV1>(branch: T) =>
  MODULE_BRANCH_CAPABILITY_V1[branch];

const uniqueArray = <T extends ZodType>(schema: T) =>
  z
    .array(schema)
    .min(1)
    .refine((values) => new Set(values).size === values.length);

const HumanAuthorizationInvocationV1Schema = z.strictObject({ kind: z.literal("human") });
const SystemAuthorizationInvocationV1Schema = z.strictObject({
  kind: z.literal("system"),
  systemActorId: IdentifierSchema,
  reasonCode: IdentifierSchema,
});
const AgentAuthorizationInvocationV1Schema = z.strictObject({
  kind: z.literal("agent-task"),
  agentTaskRef: AgentTaskRefV1Schema,
});

export const AuthorizationInvocationV1Schema = z.discriminatedUnion("kind", [
  HumanAuthorizationInvocationV1Schema,
  SystemAuthorizationInvocationV1Schema,
  AgentAuthorizationInvocationV1Schema,
]);
export type AuthorizationInvocationV1 = z.infer<typeof AuthorizationInvocationV1Schema>;

const authorizationContextBase = {
  schemaVersion: z.literal("1"),
  authorizationContextRef: AuthorizationContextRefV1Schema,
  actorId: IdentifierSchema,
  projectId: IdentifierSchema,
  grantedCapabilities: uniqueArray(ModuleCapabilityV1Schema),
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema),
  sourceAccessGrantRefs: z.array(SourceAccessGrantRefV1Schema),
  authorizationPolicyRef: VersionReferenceSchema,
  decidedAt: IsoDateTimeSchema,
};

export const AuthorizationContextV1Schema = z.union([
  z.strictObject({
    ...authorizationContextBase,
    causalRunRef: WorkflowRunRefV1Schema.optional(),
    invocation: HumanAuthorizationInvocationV1Schema,
  }),
  z.strictObject({
    ...authorizationContextBase,
    causalRunRef: WorkflowRunRefV1Schema,
    invocation: SystemAuthorizationInvocationV1Schema,
  }),
  z.strictObject({
    ...authorizationContextBase,
    causalRunRef: WorkflowRunRefV1Schema,
    invocation: AgentAuthorizationInvocationV1Schema,
  }),
]);
export type AuthorizationContextV1 = z.infer<typeof AuthorizationContextV1Schema>;

export const WaitingRefV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("knowledge-preparation"),
    knowledgePreparationTaskRef: KnowledgePreparationTaskRefV1Schema,
  }),
  z.strictObject({ kind: z.literal("review"), reviewTaskRef: ReviewTaskRefV1Schema }),
  z.strictObject({
    kind: z.literal("user-confirmation"),
    userConfirmationRef: UserConfirmationRefV1Schema,
  }),
]);
export type WaitingRefV1 = z.infer<typeof WaitingRefV1Schema>;

const moduleErrorCommon = {
  stageCode: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  causalRunId: IdentifierSchema,
};

export const ModuleErrorV1Schema = z.discriminatedUnion("code", [
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("AUTHORIZATION_DENIED"),
    category: z.literal("authorization"),
    retryable: z.literal(false),
    requiredCapability: ModuleCapabilityV1Schema,
    authorizationPolicyRef: VersionReferenceSchema,
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("ENTITY_NOT_FOUND"),
    category: z.literal("not-found"),
    retryable: z.literal(false),
    targetRef: ContractReferenceV1Schema,
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("STALE_VERSION"),
    category: z.literal("concurrency"),
    retryable: z.literal(false),
    targetRef: ContractReferenceV1Schema,
    currentRef: ContractReferenceV1Schema.optional(),
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("IDEMPOTENCY_CONFLICT"),
    category: z.literal("idempotency"),
    retryable: z.literal(false),
    idempotencyKey: IdentifierSchema,
    priorCommandId: IdentifierSchema,
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("BUSINESS_BLOCKED"),
    category: z.literal("business-blocked"),
    retryable: z.literal(false),
    blockerKind: IdentifierSchema,
    blockerRef: ContractReferenceV1Schema,
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("TRANSIENT_FAILURE"),
    category: z.literal("technical"),
    retryable: z.literal(true),
    attempt: z.number().int().positive(),
    retryPolicyRef: VersionReferenceSchema,
    diagnosticRef: DiagnosticArtifactRefV1Schema,
    retryAt: IsoDateTimeSchema.optional(),
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("TERMINAL_FAILURE"),
    category: z.literal("technical"),
    retryable: z.literal(false),
    diagnosticRef: DiagnosticArtifactRefV1Schema,
  }),
  z.strictObject({
    ...moduleErrorCommon,
    code: z.literal("UNSUPPORTED_CONTRACT"),
    category: z.literal("technical"),
    retryable: z.literal(false),
    schemaVersion: IdentifierSchema,
    graphVersion: VersionReferenceSchema.optional(),
  }),
]);
export type ModuleErrorV1 = z.infer<typeof ModuleErrorV1Schema>;

const agentTaskResultBase = {
  kind: z.literal("agent-task-result"),
  reference: VersionReferenceSchema,
};

const agentTaskRefForType = <const T extends AgentTaskTypeV1>(taskType: T) =>
  AgentTaskRefV1Schema.extend({ taskType: z.literal(taskType) });

const refineAgentTaskCompletedResult = (
  result: {
    incrementRef?: unknown;
    candidateRef?: unknown;
    validationRef?: unknown;
    formalResultRef?: unknown;
  },
  context: z.RefinementCtx,
) => {
  const primaryOutputCount = [
    result.incrementRef,
    result.candidateRef,
    result.formalResultRef,
  ].filter((ref) => ref !== undefined).length;
  if (primaryOutputCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "completed agent task requires a primary output reference",
    });
  }
  if (primaryOutputCount > 1) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "completed agent task cannot combine primary output families",
    });
  }
};

const AgentTaskCompletedResultV1Schema = z.union([
  z
    .strictObject({
      ...agentTaskResultBase,
      status: z.literal("completed"),
      agentTaskRef: agentTaskRefForType("data-cleaning"),
      incrementRef: ContentArtifactRefV1Schema.optional(),
      validationRef: ValidationSnapshotRefV1Schema.optional(),
    })
    .superRefine(refineAgentTaskCompletedResult),
  z
    .strictObject({
      ...agentTaskResultBase,
      status: z.literal("completed"),
      agentTaskRef: agentTaskRefForType("knowledge-authoring"),
      incrementRef: ContentArtifactRefV1Schema.optional(),
      candidateRef: KnowledgeRevisionRefV1Schema.optional(),
      validationRef: ValidationSnapshotRefV1Schema.optional(),
    })
    .superRefine(refineAgentTaskCompletedResult),
  z
    .strictObject({
      ...agentTaskResultBase,
      status: z.literal("completed"),
      agentTaskRef: agentTaskRefForType("retrieval-review"),
      incrementRef: RetrievalArtifactSetRefV1Schema.optional(),
      validationRef: ValidationSnapshotRefV1Schema.optional(),
    })
    .superRefine(refineAgentTaskCompletedResult),
  z
    .strictObject({
      ...agentTaskResultBase,
      status: z.literal("completed"),
      agentTaskRef: agentTaskRefForType("response-recommendation"),
      candidateRef: RecommendationCandidateRefV1Schema.optional(),
      validationRef: ValidationSnapshotRefV1Schema.optional(),
      formalResultRef: ResponseRecommendationRefV1Schema.optional(),
    })
    .superRefine(refineAgentTaskCompletedResult),
  z
    .strictObject({
      ...agentTaskResultBase,
      status: z.literal("completed"),
      agentTaskRef: agentTaskRefForType("calibration-suggestion"),
      candidateRef: CalibrationSuggestionRefV1Schema.optional(),
      validationRef: ValidationSnapshotRefV1Schema.optional(),
      formalResultRef: CalibrationSuggestionRefV1Schema.optional(),
    })
    .superRefine(refineAgentTaskCompletedResult),
]);

const AgentTaskFailedResultV1Schema = z.strictObject({
  ...agentTaskResultBase,
  agentTaskRef: AgentTaskRefV1Schema,
  status: z.literal("failed"),
  errorRef: WorkflowErrorRefV1Schema,
});

const AgentTaskCancelledResultV1Schema = z.strictObject({
  ...agentTaskResultBase,
  agentTaskRef: AgentTaskRefV1Schema,
  status: z.literal("cancelled"),
});

export const AgentTaskResultRefV1Schema = z.union([
  AgentTaskCompletedResultV1Schema,
  AgentTaskFailedResultV1Schema,
  AgentTaskCancelledResultV1Schema,
]);
export type AgentTaskResultRefV1 = z.infer<typeof AgentTaskResultRefV1Schema>;

const commandSchema = <const T extends string, const P extends ZodType>(
  kind: T,
  payload: P,
  requiredCapability: ModuleCapabilityV1,
) =>
  CommandEnvelopeSchema.extend({
    kind: z.literal(kind),
    authorization: AuthorizationContextV1Schema,
    payload,
  }).superRefine((command, context) => {
    if (command.projectId !== command.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "command project does not match authorization context",
      });
    }
    if (command.actorId !== command.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "command actor does not match authorization context",
      });
    }
    if (!command.authorization.grantedCapabilities.includes(requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "required capability is not granted",
      });
    }
  });

const querySchema = <const T extends string, const P extends ZodType>(
  kind: T,
  payload: P,
  requiredCapability: ModuleCapabilityV1,
) =>
  z
    .strictObject({
      queryId: IdentifierSchema,
      projectId: IdentifierSchema,
      actorId: IdentifierSchema,
      requestedAt: IsoDateTimeSchema,
      authorization: AuthorizationContextV1Schema,
      kind: z.literal(kind),
      payload,
    })
    .superRefine((query, context) => {
      if (query.projectId !== query.authorization.projectId) {
        context.addIssue({
          code: "custom",
          path: ["projectId"],
          message: "query project does not match authorization context",
        });
      }
      if (query.actorId !== query.authorization.actorId) {
        context.addIssue({
          code: "custom",
          path: ["actorId"],
          message: "query actor does not match authorization context",
        });
      }
      if (!query.authorization.grantedCapabilities.includes(requiredCapability)) {
        context.addIssue({
          code: "custom",
          path: ["authorization", "grantedCapabilities"],
          message: "required capability is not granted",
        });
      }
    });

const moduleResultSchema = <const T extends ZodType>(result: T, allowWaiting = false) => {
  const succeeded = z.strictObject({ kind: z.literal("succeeded"), result });
  const failed = z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema });
  if (allowWaiting) {
    return z.discriminatedUnion("kind", [
      succeeded,
      z.strictObject({ kind: z.literal("waiting"), waiting: WaitingRefV1Schema }),
      failed,
    ]);
  }
  return z.discriminatedUnion("kind", [succeeded, failed]);
};

const QueryResultShapeV1Schema = z.strictObject({ queryResultRef: QueryResultRefV1Schema });

const SourceWindowV1Schema = z
  .strictObject({ from: IsoDateTimeSchema, to: IsoDateTimeSchema })
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({ code: "custom", path: ["to"], message: "to must be later than from" });
    }
  });

const MonitoringBatchRelationV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("original") }),
  z.strictObject({ kind: z.literal("correction"), priorBatchRef: MonitoringBatchRefV1Schema }),
  z.strictObject({ kind: z.literal("supplement"), priorBatchRef: MonitoringBatchRefV1Schema }),
]);

const RegisterSourceDeliveryPayloadV1Schema = z.strictObject({
  sourceConnectionRef: VersionReferenceSchema,
  deliveryKey: IdentifierSchema,
  sourceArtifactRef: ContentArtifactRefV1Schema,
  metadataArtifactRef: ContentArtifactRefV1Schema,
  occurredAt: IsoDateTimeSchema,
});

const RegisterMonitoringBatchPayloadV1Schema = z.strictObject({
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  deliveryKey: IdentifierSchema,
  sampleArtifactRef: ContentArtifactRefV1Schema,
  window: SourceWindowV1Schema,
  relation: MonitoringBatchRelationV1Schema,
});

const RegisterExternalRiskEventPayloadV1Schema = z.strictObject({
  externalSourceRef: VersionReferenceSchema,
  externalEventKey: IdentifierSchema,
  eventArtifactRef: ContentArtifactRefV1Schema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  occurredAt: IsoDateTimeSchema,
});

export const EngineeringDataCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "register-source-delivery",
    RegisterSourceDeliveryPayloadV1Schema,
    branchCapability("engineering-data.register-source-delivery"),
  ),
  commandSchema(
    "register-monitoring-batch",
    RegisterMonitoringBatchPayloadV1Schema,
    branchCapability("engineering-data.register-monitoring-batch"),
  ),
  commandSchema(
    "register-external-risk-event",
    RegisterExternalRiskEventPayloadV1Schema,
    branchCapability("engineering-data.register-external-risk-event"),
  ),
]);
export type EngineeringDataCommandV1 = z.infer<typeof EngineeringDataCommandV1Schema>;

const IdentificationPreparationCommandPayloadV1Schema = z.strictObject({
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
  sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
  monitoringCutoff: IsoDateTimeSchema.optional(),
  dataProcessingPolicyRef: VersionReferenceSchema,
});

export const WorkflowEntryModeV1_VALUES = [
  "identify-and-assess",
  "assess",
  "reassess",
  "historical-backfill",
  "forecast-response",
  "record-response-feedback",
] as const;
export const WorkflowEntryModeV1Schema = z.enum(WorkflowEntryModeV1_VALUES);
export type WorkflowEntryModeV1 = z.infer<typeof WorkflowEntryModeV1Schema>;

const AssessmentPreparationCommandPayloadV1Schema = z.strictObject({
  riskInput: RiskInputVersionRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  triggerReasonCode: IdentifierSchema,
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  causalRunRef: WorkflowRunRefV1Schema.optional(),
  monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
});

const MonitoringSnapshotCommandPayloadV1Schema = z.strictObject({
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  cutoff: IsoDateTimeSchema,
  availabilityPolicyRef: VersionReferenceSchema,
});

export const EngineeringFreezeCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "identification-preparation",
    IdentificationPreparationCommandPayloadV1Schema,
    branchCapability("engineering-data.identification-preparation"),
  ),
  commandSchema(
    "assessment-preparation",
    AssessmentPreparationCommandPayloadV1Schema,
    branchCapability("engineering-data.assessment-preparation"),
  ),
  commandSchema(
    "monitoring-snapshot",
    MonitoringSnapshotCommandPayloadV1Schema,
    branchCapability("engineering-data.monitoring-snapshot"),
  ),
]);
export type EngineeringFreezeCommandV1 = z.infer<typeof EngineeringFreezeCommandV1Schema>;

export const EngineeringDataQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "source-segments",
    z.strictObject({ sourceSegmentSetRef: SourceSegmentSetRefV1Schema }),
    branchCapability("engineering-data.source-segments"),
  ),
  querySchema(
    "monitoring-snapshot",
    z.strictObject({ monitoringSnapshotRef: MonitoringSnapshotRefV1Schema }),
    branchCapability("engineering-data.monitoring-snapshot-query"),
  ),
  querySchema(
    "evidence-access",
    z.strictObject({
      evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
      purposeCode: IdentifierSchema,
    }),
    branchCapability("engineering-data.evidence-access"),
  ),
]);
export type EngineeringDataQueryV1 = z.infer<typeof EngineeringDataQueryV1Schema>;

export const STRUCTURED_DOCUMENT_CONVERSION_SCHEMA_VERSION_V1 = "1" as const;
export const StructuredDocumentInputV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("docx") }),
  z.strictObject({ kind: z.literal("text-pdf") }),
  z.strictObject({ kind: z.literal("xlsx") }),
  z.strictObject({ kind: z.literal("csv") }),
  z.strictObject({ kind: z.literal("ocr-layout") }),
]);
export type StructuredDocumentInputV1 = z.infer<typeof StructuredDocumentInputV1Schema>;
export const StructuredDocumentConversionInputV1Schema = StructuredDocumentInputV1Schema;
export type StructuredDocumentConversionInputV1 = StructuredDocumentInputV1;

const conversionMediaType = z.string().trim().min(1).max(200);
const conversionCommandBase = {
  schemaVersion: z.literal(STRUCTURED_DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
  conversionId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  runId: IdentifierSchema,
  threadId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  deadlineAt: IsoDateTimeSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  authorization: AuthorizationContextV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceArtifactRef: ContentArtifactRefV1Schema,
  mediaType: conversionMediaType,
  input: StructuredDocumentInputV1Schema,
  conversionPolicyRef: VersionReferenceSchema,
  qualityPolicyRef: VersionReferenceSchema,
  converterDeploymentRef: VersionReferenceSchema,
};

export const StructuredDocumentConversionCommandV1Schema = z
  .strictObject(conversionCommandBase)
  .superRefine((command, context) => {
    if (Date.parse(command.deadlineAt) <= Date.parse(command.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["deadlineAt"],
        message: "deadlineAt must be later than issuedAt",
      });
    }
    if (command.projectId !== command.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "conversion project does not match authorization",
      });
    }
    if (command.actorId !== command.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "conversion actor does not match authorization",
      });
    }
    if (!command.authorization.grantedCapabilities.includes("engineering-data.write")) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "structured conversion requires engineering-data.write",
      });
    }
  });
export type StructuredDocumentConversionCommandV1 = z.infer<
  typeof StructuredDocumentConversionCommandV1Schema
>;
export const StructuredDocumentConversionRequestV1Schema =
  StructuredDocumentConversionCommandV1Schema;
export type StructuredDocumentConversionRequestV1 = StructuredDocumentConversionCommandV1;

export const StructuredDocumentConversionQueryV1Schema = z
  .strictObject({
    schemaVersion: z.literal(STRUCTURED_DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
    queryId: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    conversionRef: StructuredDocumentConversionRefV1Schema,
  })
  .superRefine((query, context) => {
    if (query.projectId !== query.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "conversion query project does not match authorization",
      });
    }
    if (query.actorId !== query.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "conversion query actor does not match authorization",
      });
    }
    if (!query.authorization.grantedCapabilities.includes("engineering-data.read")) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "structured conversion query requires engineering-data.read",
      });
    }
  });
export type StructuredDocumentConversionQueryV1 = z.infer<
  typeof StructuredDocumentConversionQueryV1Schema
>;

export const StructuredDocumentConversionStatisticsV1Schema = z.strictObject({
  inputBytes: z.number().int().nonnegative().safe(),
  outputBytes: z.number().int().nonnegative().safe(),
  textBlockCount: z.number().int().nonnegative().safe(),
  sourceSegmentCount: z.number().int().nonnegative().safe(),
  pageCount: z.number().int().nonnegative().safe(),
  tableCount: z.number().int().nonnegative().safe(),
  cellCount: z.number().int().nonnegative().safe(),
  durationMs: z.number().int().nonnegative().safe(),
  limitCode: IdentifierSchema.optional(),
});
export type StructuredDocumentConversionStatisticsV1 = z.infer<
  typeof StructuredDocumentConversionStatisticsV1Schema
>;

export const StructuredDocumentConversionStatusV1Schema = z.enum(["succeeded", "failed"]);
export type StructuredDocumentConversionStatusV1 = z.infer<
  typeof StructuredDocumentConversionStatusV1Schema
>;

export const StructuredDocumentConversionRecordV1Schema = z
  .strictObject({
    schemaVersion: z.literal(STRUCTURED_DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
    conversionRef: StructuredDocumentConversionRefV1Schema,
    projectId: IdentifierSchema,
    sourceVersionRef: SourceVersionRefV1Schema,
    sourceArtifactRef: ContentArtifactRefV1Schema,
    input: StructuredDocumentInputV1Schema,
    mediaType: conversionMediaType,
    conversionPolicyRef: VersionReferenceSchema,
    qualityPolicyRef: VersionReferenceSchema,
    converterDeploymentRef: VersionReferenceSchema,
    status: StructuredDocumentConversionStatusV1Schema,
    statistics: StructuredDocumentConversionStatisticsV1Schema,
    jsonLdArtifactRef: ContentArtifactRefV1Schema.optional(),
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema.optional(),
    diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
    authorizationPolicyRef: VersionReferenceSchema,
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    runId: IdentifierSchema,
    threadId: IdentifierSchema,
    actorId: IdentifierSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    auditTrailRef: AuditTrailRefV1Schema,
  })
  .superRefine((record, context) => {
    if (record.status === "succeeded") {
      if (record.jsonLdArtifactRef === undefined) {
        context.addIssue({
          code: "custom",
          path: ["jsonLdArtifactRef"],
          message: "successful conversion requires a JSON-LD artifact",
        });
      }
      if (record.sourceSegmentSetRef === undefined) {
        context.addIssue({
          code: "custom",
          path: ["sourceSegmentSetRef"],
          message: "successful conversion requires a source segment set",
        });
      }
      if (record.diagnosticRef !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["diagnosticRef"],
          message: "successful conversion cannot have a diagnostic artifact",
        });
      }
    } else if (record.diagnosticRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["diagnosticRef"],
        message: "failed conversion requires a diagnostic artifact",
      });
    }
  });
export type StructuredDocumentConversionRecordV1 = z.infer<
  typeof StructuredDocumentConversionRecordV1Schema
>;

export const StructuredDocumentConversionSuccessV1Schema = z.strictObject({
  conversionRef: StructuredDocumentConversionRefV1Schema,
  jsonLdArtifactRef: ContentArtifactRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
});
export type StructuredDocumentConversionSuccessV1 = z.infer<
  typeof StructuredDocumentConversionSuccessV1Schema
>;

export const StructuredDocumentConversionResultV1Schema = moduleResultSchema(
  StructuredDocumentConversionSuccessV1Schema,
);
export type StructuredDocumentConversionResultV1 = z.infer<
  typeof StructuredDocumentConversionResultV1Schema
>;

export const StructuredDocumentConversionReadSuccessV1Schema = z.strictObject({
  conversion: StructuredDocumentConversionRecordV1Schema,
});
export type StructuredDocumentConversionReadSuccessV1 = z.infer<
  typeof StructuredDocumentConversionReadSuccessV1Schema
>;

export const StructuredDocumentConversionReadResultV1Schema = moduleResultSchema(
  StructuredDocumentConversionReadSuccessV1Schema,
);
export type StructuredDocumentConversionReadResultV1 = z.infer<
  typeof StructuredDocumentConversionReadResultV1Schema
>;

export interface StructuredDocumentConversionPortV1 {
  convert(
    request: StructuredDocumentConversionCommandV1,
  ): Promise<StructuredDocumentConversionResultV1>;
  read(
    query: StructuredDocumentConversionQueryV1,
  ): Promise<StructuredDocumentConversionReadResultV1>;
}

const KnowledgeDefinitionTypeValues = [
  "process-model",
  "risk-mechanism",
  "standard-library",
  "case-library",
  "retrieval-evidence-base",
  "indicator-system",
  "indicator-field-mapping",
  "structured-scoring-rule",
  "applicable-rule-set",
  "weight-set",
  "scoring-strategy",
  "risk-matrix",
  "risk-acceptance-threshold",
  "monitoring-warning-threshold",
  "joint-trigger-policy",
  "measure-library",
  "forecast-policy",
  "deviation-policy",
] as const;
export const KnowledgeDefinitionTypeV1Schema = z.enum(KnowledgeDefinitionTypeValues);
export type KnowledgeDefinitionTypeV1 = z.infer<typeof KnowledgeDefinitionTypeV1Schema>;

const SubmitRevisionPayloadV1Schema = z.strictObject({
  definitionType: KnowledgeDefinitionTypeV1Schema,
  baseReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  candidateArtifactRef: ContentArtifactRefV1Schema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
});

export const KnowledgeGovernanceCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "submit-revision",
    SubmitRevisionPayloadV1Schema,
    branchCapability("knowledge-modeling.submit-revision"),
  ),
  commandSchema(
    "request-review",
    z.strictObject({
      revisionRef: KnowledgeRevisionRefV1Schema,
      reviewPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("knowledge-modeling.request-review"),
  ),
  commandSchema(
    "publish-approved-release",
    z.strictObject({
      revisionRef: KnowledgeRevisionRefV1Schema,
      reviewDecisionRef: ReviewDecisionRefV1Schema,
      effectiveFrom: IsoDateTimeSchema,
    }),
    branchCapability("knowledge-modeling.publish-approved-release"),
  ),
  commandSchema(
    "deactivate-release",
    z.strictObject({ releaseRef: KnowledgeReleaseRefV1Schema, reasonCode: IdentifierSchema }),
    branchCapability("knowledge-modeling.deactivate-release"),
  ),
  commandSchema(
    "rollback-by-new-release",
    z.strictObject({
      historicalReleaseRef: KnowledgeReleaseRefV1Schema,
      reviewDecisionRef: ReviewDecisionRefV1Schema,
      reasonCode: IdentifierSchema,
    }),
    branchCapability("knowledge-modeling.rollback-by-new-release"),
  ),
]);
export type KnowledgeGovernanceCommandV1 = z.infer<typeof KnowledgeGovernanceCommandV1Schema>;

export const KnowledgeResolutionCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "identification-basis",
    z.strictObject({
      preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
      requiredAt: IsoDateTimeSchema,
    }),
    branchCapability("knowledge-modeling.identification-basis"),
  ),
  commandSchema(
    "assessment-basis",
    z.strictObject({
      preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
      requiredAt: IsoDateTimeSchema,
    }),
    branchCapability("knowledge-modeling.assessment-basis"),
  ),
]);
export type KnowledgeResolutionCommandV1 = z.infer<typeof KnowledgeResolutionCommandV1Schema>;

export const KnowledgeRetrievalQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "hybrid-evidence",
    z.strictObject({
      inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
      workItemRef: IdentificationWorkItemRefV1Schema,
      retrievalPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("knowledge-modeling.hybrid-evidence"),
  ),
  querySchema(
    "relationship-context",
    z.strictObject({
      inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
      workItemRef: IdentificationWorkItemRefV1Schema,
    }),
    branchCapability("knowledge-modeling.relationship-context"),
  ),
  querySchema(
    "measure-candidates",
    z.strictObject({
      assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
      warningResponseTaskRef: WarningResponseTaskRefV1Schema,
      measureLibraryReleaseRef: MeasureLibraryReleaseRefV1Schema,
    }),
    branchCapability("knowledge-modeling.measure-candidates"),
  ),
]);
export type KnowledgeRetrievalQueryV1 = z.infer<typeof KnowledgeRetrievalQueryV1Schema>;

export const IdentificationPlanCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "plan",
    z.strictObject({ inputSnapshotRef: IdentificationInputSnapshotRefV1Schema }),
    branchCapability("risk-identification.plan"),
  ),
]);
export type IdentificationPlanCommandV1 = z.infer<typeof IdentificationPlanCommandV1Schema>;

export const IdentificationAnalysisCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "assemble-and-infer",
    z.strictObject({
      workItemRef: IdentificationWorkItemRefV1Schema,
      retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
      modelDeploymentRef: VersionReferenceSchema,
      promptTemplateRef: VersionReferenceSchema,
    }),
    branchCapability("risk-identification.assemble-and-infer"),
  ),
  commandSchema(
    "repair-and-validate",
    z.strictObject({
      candidateSetRef: IdentificationCandidateSetRefV1Schema,
      repairPolicyRef: VersionReferenceSchema,
      ruleValidationPolicyRef: VersionReferenceSchema,
      simulationConstraintPolicyRef: VersionReferenceSchema.optional(),
    }),
    branchCapability("risk-identification.repair-and-validate"),
  ),
]);
export type IdentificationAnalysisCommandV1 = z.infer<typeof IdentificationAnalysisCommandV1Schema>;

export const IdentificationFinalizationCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "merge-run-candidates",
    z.strictObject({
      workPlanRef: IdentificationWorkPlanRefV1Schema,
      validatedCandidateSetRefs: z.array(ValidatedCandidateSetRefV1Schema).min(1),
      mergePolicyRef: VersionReferenceSchema,
    }),
    branchCapability("risk-identification.merge-run-candidates"),
  ),
  commandSchema(
    "route-acceptance",
    z.strictObject({
      mergePlanRef: MergePlanRefV1Schema,
      confidencePolicyRef: VersionReferenceSchema,
      forcedReviewPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("risk-identification.route-acceptance"),
  ),
  commandSchema(
    "accept-groups",
    z.strictObject({
      acceptanceRouteSetRef: AcceptanceRouteSetRefV1Schema,
      acceptedGroupRefs: z.array(IdentificationGroupRefV1Schema).min(1),
      decisionRefs: z.array(z.union([RouteDecisionRefV1Schema, ReviewDecisionRefV1Schema])).min(1),
    }),
    branchCapability("risk-identification.accept-groups"),
  ),
]);
export type IdentificationFinalizationCommandV1 = z.infer<
  typeof IdentificationFinalizationCommandV1Schema
>;

export const AssessmentPreparationCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "initial",
    z.strictObject({
      preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
      assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
    }),
    branchCapability("risk-assessment.initial"),
  ),
  commandSchema(
    "reassessment",
    z.strictObject({
      preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
      assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
      previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
      reason: z.enum([
        "monitoring-snapshot",
        "applicability-metadata",
        "applicable-rule-set",
        "weight-or-strategy",
        "risk-matrix",
      ]),
    }),
    branchCapability("risk-assessment.reassessment"),
  ),
  commandSchema(
    "historical-backfill",
    z.strictObject({
      preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
      assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
      effectiveAt: IsoDateTimeSchema,
    }),
    branchCapability("risk-assessment.historical-backfill"),
  ),
]);
export type AssessmentPreparationCommandV1 = z.infer<typeof AssessmentPreparationCommandV1Schema>;

export const AssessmentEvaluationCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "evaluate",
    z.strictObject({ assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema }),
    branchCapability("risk-assessment.evaluate"),
  ),
]);
export type AssessmentEvaluationCommandV1 = z.infer<typeof AssessmentEvaluationCommandV1Schema>;

export const OpenWarningCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "open",
    z.strictObject({
      assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
      warningAggregationPolicyRef: VersionReferenceSchema,
      notificationPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("warning-response.open"),
  ),
]);
export type OpenWarningCommandV1 = z.infer<typeof OpenWarningCommandV1Schema>;

export const RecommendationCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "create-candidate",
    z.strictObject({
      warningResponseTaskRef: WarningResponseTaskRefV1Schema,
      measureCandidateQueryResultRef: KnowledgeQueryResultRefV1Schema,
      agentTaskResultRef: AgentTaskResultRefV1Schema,
      responseGenerationPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("warning-response.create-candidate"),
  ),
  commandSchema(
    "validate-and-record",
    z.strictObject({
      recommendationCandidateRef: RecommendationCandidateRefV1Schema,
      responseValidationPolicyRef: VersionReferenceSchema,
      siteContextRef: VersionReferenceSchema,
    }),
    branchCapability("warning-response.validate-and-record"),
  ),
]);
export type RecommendationCommandV1 = z.infer<typeof RecommendationCommandV1Schema>;

const ActionSourceV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("adopted-recommendation"),
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("independent-action"),
    measureReleaseRefs: z.array(MeasureLibraryReleaseRefV1Schema).min(1),
  }),
]);

export const WarningResponseRecordCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "adopt-recommendation",
    z.strictObject({
      responseRecommendationRef: ResponseRecommendationRefV1Schema,
      decision: z.enum(["adopted", "declined"]),
      reasonCode: IdentifierSchema,
    }),
    branchCapability("warning-response.adopt-recommendation"),
  ),
  commandSchema(
    "record-execution",
    z.strictObject({
      actionSource: ActionSourceV1Schema,
      executedByActorId: IdentifierSchema,
      recordedByActorId: IdentifierSchema,
      occurredAt: IsoDateTimeSchema,
      evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
    }),
    branchCapability("warning-response.record-execution"),
  ),
  commandSchema(
    "record-feedback",
    z.strictObject({
      executionRecordRef: ExecutionRecordRefV1Schema,
      postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
      feedbackArtifactRef: ContentArtifactRefV1Schema,
      occurredAt: IsoDateTimeSchema,
    }),
    branchCapability("warning-response.record-feedback"),
  ),
  commandSchema(
    "calculate-deviation",
    z.strictObject({
      effectForecastRef: EffectForecastRefV1Schema,
      feedbackRef: FeedbackRefV1Schema,
      frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
    }),
    branchCapability("warning-response.calculate-deviation"),
  ),
  commandSchema(
    "create-calibration-suggestion",
    z.strictObject({
      deviationRecordRef: DeviationRecordRefV1Schema,
      agentTaskResultRef: AgentTaskResultRefV1Schema,
      calibrationValidationPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("warning-response.create-calibration-suggestion"),
  ),
]);
export type WarningResponseRecordCommandV1 = z.infer<typeof WarningResponseRecordCommandV1Schema>;

export const WorkflowRunStatusV1_VALUES = [
  "pending",
  "running",
  "waiting",
  "retryable-failure",
  "completed",
  "terminal-failure",
  "cancelled",
] as const;
export const WorkflowRunStatusV1Schema = z.enum(WorkflowRunStatusV1_VALUES);
export type WorkflowRunStatusV1 = z.infer<typeof WorkflowRunStatusV1Schema>;

export const WorkflowRunTriggerTypeV1Schema = z.enum([
  "manual",
  "domain-event",
  "scheduled",
  "resume",
]);
export type WorkflowRunTriggerTypeV1 = z.infer<typeof WorkflowRunTriggerTypeV1Schema>;

export const ResumeCauseV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("review-resolved"),
    reviewDecisionRef: ReviewDecisionRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("knowledge-ready"),
    knowledgePreparationTaskRef: KnowledgePreparationTaskRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("agent-task-completed"),
    agentTaskResultRef: AgentTaskResultRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("command-confirmed"),
    commandProposalRef: CommandProposalRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("transient-recovered"),
    workflowErrorRef: WorkflowErrorRefV1Schema,
    diagnosticArtifactRef: DiagnosticArtifactRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("user-confirmed"),
    userConfirmationRef: UserConfirmationRefV1Schema,
  }),
]);
export type ResumeCauseV1 = z.infer<typeof ResumeCauseV1Schema>;

const workflowStartControlShape = {
  graphVersion: VersionReferenceSchema,
  retryPolicyRef: VersionReferenceSchema,
};

const StartWorkflowPayloadV1Schema = z.discriminatedUnion("entryMode", [
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("identify-and-assess"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
    sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("assess"),
    riskInput: RiskInputVersionRefV1Schema,
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
    spatialScopeRef: SpatialScopeRefV1Schema,
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("reassess"),
    previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    reason: z.enum([
      "monitoring-snapshot",
      "applicability-metadata",
      "applicable-rule-set",
      "weight-strategy",
      "risk-matrix",
    ]),
    changedInputRefs: z.array(ContractReferenceV1Schema).min(1),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("historical-backfill"),
    riskInput: RiskInputVersionRefV1Schema,
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    effectiveAt: IsoDateTimeSchema,
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("forecast-response"),
    adoptedRecommendationRef: ResponseRecommendationRefV1Schema,
    preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("record-response-feedback"),
    executionRecordRef: ExecutionRecordRefV1Schema,
    feedbackRef: FeedbackRefV1Schema,
    forecastRef: EffectForecastRefV1Schema.optional(),
  }),
]);

export const StartWorkflowRunCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema("start-run", StartWorkflowPayloadV1Schema, branchCapability("workflow.start-run")),
]);
export type StartWorkflowRunCommandV1 = z.infer<typeof StartWorkflowRunCommandV1Schema>;

export const ResumeWorkflowRunCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "resume-run",
    z.strictObject({
      workflowRunRef: WorkflowRunRefV1Schema,
      expectedStateVersion: IdentifierSchema,
      resumeCause: ResumeCauseV1Schema,
    }),
    branchCapability("workflow.resume-run"),
  ),
]);
export type ResumeWorkflowRunCommandV1 = z.infer<typeof ResumeWorkflowRunCommandV1Schema>;

export const CancelWorkflowRunCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "cancel-run",
    z.strictObject({
      workflowRunRef: WorkflowRunRefV1Schema,
      expectedStateVersion: IdentifierSchema,
      reasonCode: IdentifierSchema,
    }),
    branchCapability("workflow.cancel-run"),
  ),
]);
export type CancelWorkflowRunCommandV1 = z.infer<typeof CancelWorkflowRunCommandV1Schema>;

export const StartAgentTaskCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "start-task",
    z.strictObject({
      taskType: AgentTaskTypeV1Schema,
      triggerMode: AgentTriggerModeV1Schema,
      parentRunRef: WorkflowRunRefV1Schema,
      frozenInputRef: ContractReferenceV1Schema,
      modelDeploymentRef: VersionReferenceSchema,
      promptTemplateRef: VersionReferenceSchema,
      toolPolicyRef: VersionReferenceSchema,
      budgetPolicyRef: VersionReferenceSchema,
      incrementSchemaRef: VersionReferenceSchema,
      validationPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("agent-task.start-task"),
  ),
]);
export type StartAgentTaskCommandV1 = z.infer<typeof StartAgentTaskCommandV1Schema>;

export const ResumeAgentTaskCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "resume-task",
    z.strictObject({
      agentTaskRef: AgentTaskRefV1Schema,
      resumeReason: z.enum(["transient-recovered", "user-confirmed"]),
      resumeEvidenceRef: DiagnosticArtifactRefV1Schema,
    }),
    branchCapability("agent-task.resume-task"),
  ),
]);
export type ResumeAgentTaskCommandV1 = z.infer<typeof ResumeAgentTaskCommandV1Schema>;

export const CancelAgentTaskCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "cancel-task",
    z.strictObject({ agentTaskRef: AgentTaskRefV1Schema, reasonCode: IdentifierSchema }),
    branchCapability("agent-task.cancel-task"),
  ),
]);
export type CancelAgentTaskCommandV1 = z.infer<typeof CancelAgentTaskCommandV1Schema>;

export const ConfirmAgentCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "confirm-command",
    z
      .strictObject({
        agentTaskRef: AgentTaskRefV1Schema,
        commandProposalRef: CommandProposalRefV1Schema,
        confirmation: z.enum(["confirmed", "rejected"]),
      })
      .superRefine((command, context) => {
        if (command.agentTaskRef.triggerMode !== "interactive") {
          context.addIssue({
            code: "custom",
            path: ["agentTaskRef", "triggerMode"],
            message: "only interactive agent tasks can confirm commands",
          });
        }
      }),
    branchCapability("agent-task.confirm-command"),
  ),
]);
export type ConfirmAgentCommandV1 = z.infer<typeof ConfirmAgentCommandV1Schema>;

const ProjectionQueryPayloadV1Schema = z.discriminatedUnion("queryType", [
  z.strictObject({
    queryType: z.literal("risk-overview"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  }),
  z.strictObject({
    queryType: z.literal("trace-chain"),
    subjectRef: ContractReferenceV1Schema,
  }),
  z.strictObject({
    queryType: z.literal("association-graph"),
    subjectRef: ContractReferenceV1Schema,
  }),
  z.strictObject({
    queryType: z.literal("run-view"),
    workflowRunRef: WorkflowRunRefV1Schema,
  }),
  z.strictObject({
    queryType: z.literal("agent-task-view"),
    agentTaskRef: AgentTaskRefV1Schema,
  }),
  z.strictObject({
    queryType: z.literal("review-queue"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  }),
]);

export const ProjectionQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema("query", ProjectionQueryPayloadV1Schema, branchCapability("projection.query")),
]);
export type ProjectionQueryV1 = z.infer<typeof ProjectionQueryV1Schema>;

export const RunSubscriptionRequestV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "subscribe",
    z.strictObject({
      workflowRunRef: WorkflowRunRefV1Schema,
      afterEventId: IdentifierSchema.optional(),
    }),
    branchCapability("projection.subscribe"),
  ),
]);
export type RunSubscriptionRequestV1 = z.infer<typeof RunSubscriptionRequestV1Schema>;

export const ProjectionExportRequestV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "export",
    z.strictObject({
      sourceRef: z.union([QueryResultRefV1Schema, ContractReferenceV1Schema]),
      exportPolicyRef: VersionReferenceSchema,
    }),
    branchCapability("projection.export"),
  ),
]);
export type ProjectionExportRequestV1 = z.infer<typeof ProjectionExportRequestV1Schema>;

const IdentificationReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    reviewType: z.literal("identification-group"),
    kind: z.literal("approve-unchanged"),
  }),
  z.strictObject({
    reviewType: z.literal("identification-group"),
    kind: z.literal("approve-revised-candidate"),
    revisedCandidateRef: IdentificationCandidateSetRefV1Schema,
  }),
  z.strictObject({
    reviewType: z.literal("identification-group"),
    kind: z.literal("confirm-merge"),
  }),
  z.strictObject({
    reviewType: z.literal("identification-group"),
    kind: z.literal("keep-separate"),
  }),
  z.strictObject({ reviewType: z.literal("identification-group"), kind: z.literal("reject") }),
  z.strictObject({
    reviewType: z.literal("identification-group"),
    kind: z.literal("return-upstream"),
  }),
]);

const KnowledgeReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    reviewType: z.literal("knowledge-revision"),
    kind: z.literal("approve-publication"),
  }),
  z.strictObject({ reviewType: z.literal("knowledge-revision"), kind: z.literal("reject") }),
  z.strictObject({
    reviewType: z.literal("knowledge-revision"),
    kind: z.literal("return-for-revision"),
  }),
]);

const RuleConflictReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    reviewType: z.literal("rule-conflict"),
    kind: z.literal("approve-publication"),
  }),
  z.strictObject({ reviewType: z.literal("rule-conflict"), kind: z.literal("reject") }),
  z.strictObject({
    reviewType: z.literal("rule-conflict"),
    kind: z.literal("return-for-revision"),
  }),
]);

const ResponseReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    reviewType: z.literal("response-candidate"),
    kind: z.literal("submit-revised-candidate"),
    revisedCandidateRef: RecommendationCandidateRefV1Schema,
  }),
  z.strictObject({
    reviewType: z.literal("response-candidate"),
    kind: z.literal("return-upstream"),
  }),
  z.strictObject({ reviewType: z.literal("response-candidate"), kind: z.literal("reject") }),
]);

const CalibrationReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    reviewType: z.literal("calibration-suggestion"),
    kind: z.literal("approve-draft-creation"),
  }),
  z.strictObject({ reviewType: z.literal("calibration-suggestion"), kind: z.literal("reject") }),
  z.strictObject({
    reviewType: z.literal("calibration-suggestion"),
    kind: z.literal("return-for-revision"),
  }),
]);

export const ReviewDecisionV1Schema = z.discriminatedUnion("reviewType", [
  IdentificationReviewDecisionV1Schema,
  KnowledgeReviewDecisionV1Schema,
  RuleConflictReviewDecisionV1Schema,
  ResponseReviewDecisionV1Schema,
  CalibrationReviewDecisionV1Schema,
]);
export type ReviewDecisionV1 = z.infer<typeof ReviewDecisionV1Schema>;

const reviewTargetMatchesType = (reviewType: ReviewTypeV1, targetKind: string) => {
  switch (reviewType) {
    case "identification-group":
      return targetKind === "identification-candidate-set" || targetKind === "identification-group";
    case "knowledge-revision":
      return targetKind === "knowledge-revision";
    case "rule-conflict":
      return targetKind === "rule-conflict";
    case "response-candidate":
      return targetKind === "response-candidate" || targetKind === "recommendation-candidate";
    case "calibration-suggestion":
      return targetKind === "calibration-suggestion";
  }
};

const matchingReviewTarget = (left: ReviewTargetRefV1, right: ReviewTargetRefV1) =>
  left.kind === right.kind &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const ReviewRequestPayloadV1Schema = z
  .strictObject({
    reviewType: ReviewTypeV1Schema,
    targetRef: ReviewTargetRefV1Schema,
    validationSnapshotRef: ContractReferenceV1Schema,
    evidenceSnapshotRef: ContractReferenceV1Schema,
    waitingRunRef: WorkflowRunRefV1Schema,
    reviewPolicyRef: VersionReferenceSchema,
  })
  .superRefine((request, context) => {
    if (!reviewTargetMatchesType(request.reviewType, request.targetRef.kind)) {
      context.addIssue({
        code: "custom",
        path: ["targetRef"],
        message: "review target does not match review type",
      });
    }
  });

export const ReviewRequestV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "request-review",
    ReviewRequestPayloadV1Schema,
    branchCapability("review-audit.request-review"),
  ),
]);
export type ReviewRequestV1 = z.infer<typeof ReviewRequestV1Schema>;

const ReviewDecisionCommandPayloadV1Schema = z
  .strictObject({
    reviewTaskRef: ReviewTaskRefV1Schema,
    targetRef: ReviewTargetRefV1Schema,
    decision: ReviewDecisionV1Schema,
    reasonCode: IdentifierSchema,
  })
  .superRefine((command, context) => {
    if (command.reviewTaskRef.reviewType !== command.decision.reviewType) {
      context.addIssue({
        code: "custom",
        path: ["decision", "reviewType"],
        message: "review decision does not match review task",
      });
    }
    if (!reviewTargetMatchesType(command.decision.reviewType, command.targetRef.kind)) {
      context.addIssue({
        code: "custom",
        path: ["targetRef"],
        message: "review decision target does not match review type",
      });
    }
    if (!matchingReviewTarget(command.reviewTaskRef.targetRef, command.targetRef)) {
      context.addIssue({
        code: "custom",
        path: ["targetRef"],
        message: "review decision target does not match review task target",
      });
    }
  });

export const ReviewDecisionCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "decide-review",
    ReviewDecisionCommandPayloadV1Schema,
    branchCapability("review-audit.decide-review"),
  ),
]);
export type ReviewDecisionCommandV1 = z.infer<typeof ReviewDecisionCommandV1Schema>;

export const TraceQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "trace",
    z.strictObject({
      subjectRef: ContractReferenceV1Schema,
      asOfRecordedAt: IsoDateTimeSchema.optional(),
      includeEvidenceSummary: z.boolean(),
    }),
    branchCapability("review-audit.trace"),
  ),
]);
export type TraceQueryV1 = z.infer<typeof TraceQueryV1Schema>;

export const KnowledgeRevisionApprovalProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-knowledge-revision-approval",
    z.strictObject({
      revisionRef: KnowledgeRevisionRefV1Schema,
      reviewDecisionRef: ReviewDecisionRefV1Schema,
    }),
    branchCapability("review-audit.verify-knowledge-revision-approval"),
  ),
]);
export type KnowledgeRevisionApprovalProofQueryV1 = z.infer<
  typeof KnowledgeRevisionApprovalProofQueryV1Schema
>;

export const EngineeringDataApplySuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("register-source-delivery"),
    sourceDeliveryRef: SourceDeliveryRefV1Schema,
    sourceVersionRef: SourceVersionRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("register-monitoring-batch"),
    monitoringBatchRef: MonitoringBatchRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("register-external-risk-event"),
    externalRiskEventRef: ExternalRiskEventRefV1Schema,
  }),
]);
export type EngineeringDataApplySuccessV1 = z.infer<typeof EngineeringDataApplySuccessV1Schema>;

export const EngineeringFreezeSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("identification-preparation"),
    identificationPreparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("assessment-preparation"),
    assessmentPreparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("monitoring-snapshot"),
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  }),
]);
export type EngineeringFreezeSuccessV1 = z.infer<typeof EngineeringFreezeSuccessV1Schema>;

export const EngineeringDataReadSuccessV1Schema = QueryResultShapeV1Schema;
export type EngineeringDataReadSuccessV1 = z.infer<typeof EngineeringDataReadSuccessV1Schema>;

export const KnowledgeGovernanceSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("revision"),
    knowledgeRevisionRef: KnowledgeRevisionRefV1Schema,
  }),
  z.strictObject({ kind: z.literal("release"), knowledgeReleaseRef: KnowledgeReleaseRefV1Schema }),
  z.strictObject({
    kind: z.literal("review-task"),
    reviewTaskRef: ReviewTaskRefV1Schema,
  }),
]);
export type KnowledgeGovernanceSuccessV1 = z.infer<typeof KnowledgeGovernanceSuccessV1Schema>;

const KNOWLEDGE_GOVERNANCE_SUCCESS_KIND_BY_COMMAND = {
  "submit-revision": "revision",
  "request-review": "review-task",
  "publish-approved-release": "release",
  "deactivate-release": "release",
  "rollback-by-new-release": "release",
} as const satisfies Record<
  KnowledgeGovernanceCommandV1["kind"],
  KnowledgeGovernanceSuccessV1["kind"]
>;

type KnowledgeGovernanceResultForSuccessKindV1<T extends KnowledgeGovernanceSuccessV1["kind"]> =
  | { kind: "succeeded"; result: Extract<KnowledgeGovernanceSuccessV1, { kind: T }> }
  | { kind: "failed"; error: ModuleErrorV1 };

export type KnowledgeGovernanceResultForCommandV1<T extends KnowledgeGovernanceCommandV1> =
  T extends { kind: infer K extends keyof typeof KNOWLEDGE_GOVERNANCE_SUCCESS_KIND_BY_COMMAND }
    ? KnowledgeGovernanceResultForSuccessKindV1<
        (typeof KNOWLEDGE_GOVERNANCE_SUCCESS_KIND_BY_COMMAND)[K]
      >
    : never;

export const KnowledgeResolutionSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("identification-basis"),
    processModelReleaseRef: ProcessModelReleaseRefV1Schema,
    riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema,
    retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
    identificationPolicySetRef: IdentificationPolicySetRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("assessment-basis"),
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  }),
]);
export type KnowledgeResolutionSuccessV1 = z.infer<typeof KnowledgeResolutionSuccessV1Schema>;

export const KnowledgeRetrievalSuccessV1Schema = z.strictObject({
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
});
export type KnowledgeRetrievalSuccessV1 = z.infer<typeof KnowledgeRetrievalSuccessV1Schema>;

export const IdentificationPlanSuccessV1Schema = z.strictObject({
  workPlanRef: IdentificationWorkPlanRefV1Schema,
});
export type IdentificationPlanSuccessV1 = z.infer<typeof IdentificationPlanSuccessV1Schema>;

export const IdentificationAnalysisSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("assemble-and-infer"),
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
    candidateSetRef: IdentificationCandidateSetRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("repair-and-validate"),
    validatedCandidateSetRef: ValidatedCandidateSetRefV1Schema,
  }),
]);
export type IdentificationAnalysisSuccessV1 = z.infer<typeof IdentificationAnalysisSuccessV1Schema>;

export const IdentificationFinalizationSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("merge"), mergePlanRef: MergePlanRefV1Schema }),
  z.strictObject({
    kind: z.literal("route"),
    acceptanceRouteSetRef: AcceptanceRouteSetRefV1Schema,
    reviewTaskRefs: z.array(ReviewTaskRefV1Schema),
  }),
  z.strictObject({
    kind: z.literal("accepted"),
    standardizedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema).min(1),
    assessmentEventRefs: z.array(DomainEventRefV1Schema).min(1),
  }),
  z.strictObject({
    kind: z.literal("skipped"),
    skippedGroupRefs: z.array(IdentificationGroupRefV1Schema),
  }),
]);
export type IdentificationFinalizationSuccessV1 = z.infer<
  typeof IdentificationFinalizationSuccessV1Schema
>;

export const AssessmentPreparationSuccessV1Schema = z.strictObject({
  assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
});
export type AssessmentPreparationSuccessV1 = z.infer<typeof AssessmentPreparationSuccessV1Schema>;

export const AssessmentEvaluationSuccessV1Schema = z.strictObject({
  indicatorActualValueSetRef: IndicatorActualValueSetRefV1Schema,
  assessmentDecisionArtifactRef: AssessmentDecisionArtifactRefV1Schema,
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
});
export type AssessmentEvaluationSuccessV1 = z.infer<typeof AssessmentEvaluationSuccessV1Schema>;

export const OpenWarningSuccessV1Schema = z.strictObject({
  warningRecordRefs: z.array(WarningRecordRefV1Schema),
  warningResponseTaskRefs: z.array(WarningResponseTaskRefV1Schema),
  notificationIntentRefs: z.array(NotificationIntentRefV1Schema),
});
export type OpenWarningSuccessV1 = z.infer<typeof OpenWarningSuccessV1Schema>;

export const RecommendationSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("candidate"),
    recommendationCandidateRef: RecommendationCandidateRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("recorded"),
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
  }),
  z.strictObject({ kind: z.literal("waiting-review"), reviewTaskRef: ReviewTaskRefV1Schema }),
]);
export type RecommendationSuccessV1 = z.infer<typeof RecommendationSuccessV1Schema>;

export const WarningResponseRecordSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("adoption"),
    routeDecisionRef: RouteDecisionRefV1Schema,
    forecastRunRef: WorkflowRunRefV1Schema,
  }),
  z.strictObject({ kind: z.literal("execution"), executionRecordRef: ExecutionRecordRefV1Schema }),
  z.strictObject({ kind: z.literal("feedback"), feedbackRef: FeedbackRefV1Schema }),
  z.strictObject({ kind: z.literal("deviation"), deviationRecordRef: DeviationRecordRefV1Schema }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
  z.strictObject({
    kind: z.literal("calibration"),
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
  }),
]);
export type WarningResponseRecordSuccessV1 = z.infer<typeof WarningResponseRecordSuccessV1Schema>;

export const ReviewRequestSuccessV1Schema = z.strictObject({
  reviewTaskRef: ReviewTaskRefV1Schema,
});
export type ReviewRequestSuccessV1 = z.infer<typeof ReviewRequestSuccessV1Schema>;

export const ReviewDecisionSuccessV1Schema = z.strictObject({
  reviewDecisionRef: ReviewDecisionRefV1Schema,
});
export type ReviewDecisionSuccessV1 = z.infer<typeof ReviewDecisionSuccessV1Schema>;

export const KnowledgeRevisionApprovalProofV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approved"),
    revisionRef: KnowledgeRevisionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    decidedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("not-approved"),
    reason: z.enum(["decision-not-found", "target-mismatch", "decision-not-approval"]),
  }),
]);
export type KnowledgeRevisionApprovalProofV1 = z.infer<
  typeof KnowledgeRevisionApprovalProofV1Schema
>;

export const TraceSuccessV1Schema = z.union([
  z.strictObject({ auditTrailRef: AuditTrailRefV1Schema }),
  z.strictObject({ queryResultRef: QueryResultRefV1Schema }),
]);
export type TraceSuccessV1 = z.infer<typeof TraceSuccessV1Schema>;

export const AgentTaskStartSuccessV1Schema = z.strictObject({ agentTaskRef: AgentTaskRefV1Schema });
export type AgentTaskStartSuccessV1 = z.infer<typeof AgentTaskStartSuccessV1Schema>;

export const AgentTaskResumeSuccessV1Schema = z.strictObject({
  agentTaskResultRef: AgentTaskResultRefV1Schema,
});
export type AgentTaskResumeSuccessV1 = z.infer<typeof AgentTaskResumeSuccessV1Schema>;

export const AgentTaskCancelSuccessV1Schema = z.strictObject({
  agentTaskRef: AgentTaskRefV1Schema,
});
export type AgentTaskCancelSuccessV1 = z.infer<typeof AgentTaskCancelSuccessV1Schema>;

export const AgentTaskConfirmSuccessV1Schema = z.strictObject({
  commandProposalRef: CommandProposalRefV1Schema,
});
export type AgentTaskConfirmSuccessV1 = z.infer<typeof AgentTaskConfirmSuccessV1Schema>;

export const WorkflowRunSuccessV1Schema = z.strictObject({
  workflowRunRef: WorkflowRunRefV1Schema,
  disposition: z.enum(["created", "existing"]),
});
export type WorkflowRunSuccessV1 = z.infer<typeof WorkflowRunSuccessV1Schema>;

export const WorkflowRunCancellationSuccessV1Schema = z.strictObject({
  workflowRunRef: WorkflowRunRefV1Schema,
  disposition: z.enum(["cancellation-recorded", "already-cancelled"]),
});
export type WorkflowRunCancellationSuccessV1 = z.infer<
  typeof WorkflowRunCancellationSuccessV1Schema
>;

export const ProjectionQuerySuccessV1Schema = z.strictObject({
  queryResultRef: QueryResultRefV1Schema,
});
export type ProjectionQuerySuccessV1 = z.infer<typeof ProjectionQuerySuccessV1Schema>;

export const ProjectionSubscriptionSuccessV1Schema = z.strictObject({
  eventRefs: z.array(DomainEventRefV1Schema),
});
export type ProjectionSubscriptionSuccessV1 = z.infer<typeof ProjectionSubscriptionSuccessV1Schema>;

export const ProjectionExportSuccessV1Schema = z.strictObject({
  exportArtifactRef: ExportArtifactRefV1Schema,
});
export type ProjectionExportSuccessV1 = z.infer<typeof ProjectionExportSuccessV1Schema>;

export const EngineeringDataApplyResultV1Schema = moduleResultSchema(
  EngineeringDataApplySuccessV1Schema,
);
export type EngineeringDataApplyResultV1 = z.infer<typeof EngineeringDataApplyResultV1Schema>;

export const EngineeringFreezeResultV1Schema = moduleResultSchema(
  EngineeringFreezeSuccessV1Schema,
  true,
);
export type EngineeringFreezeResultV1 = z.infer<typeof EngineeringFreezeResultV1Schema>;

export const EngineeringDataReadResultV1Schema = moduleResultSchema(
  EngineeringDataReadSuccessV1Schema,
);
export type EngineeringDataReadResultV1 = z.infer<typeof EngineeringDataReadResultV1Schema>;

export const KnowledgeGovernanceResultV1Schema = moduleResultSchema(
  KnowledgeGovernanceSuccessV1Schema,
);
export type KnowledgeGovernanceResultV1 = z.infer<typeof KnowledgeGovernanceResultV1Schema>;

export const KnowledgeGovernanceCommandResultV1Schema = z
  .strictObject({
    command: KnowledgeGovernanceCommandV1Schema,
    result: KnowledgeGovernanceResultV1Schema,
  })
  .superRefine((pair, context) => {
    if (
      pair.result.kind === "succeeded" &&
      pair.result.result.kind !== KNOWLEDGE_GOVERNANCE_SUCCESS_KIND_BY_COMMAND[pair.command.kind]
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "result", "kind"],
        message: "knowledge governance result does not match command",
      });
    }
  });
export type KnowledgeGovernanceCommandResultV1 = z.infer<
  typeof KnowledgeGovernanceCommandResultV1Schema
>;

export const KnowledgeResolutionResultV1Schema = moduleResultSchema(
  KnowledgeResolutionSuccessV1Schema,
  true,
);
export type KnowledgeResolutionResultV1 = z.infer<typeof KnowledgeResolutionResultV1Schema>;

export const KnowledgeRetrievalResultV1Schema = moduleResultSchema(
  KnowledgeRetrievalSuccessV1Schema,
);
export type KnowledgeRetrievalResultV1 = z.infer<typeof KnowledgeRetrievalResultV1Schema>;

export const IdentificationPlanResultV1Schema = moduleResultSchema(
  IdentificationPlanSuccessV1Schema,
);
export type IdentificationPlanResultV1 = z.infer<typeof IdentificationPlanResultV1Schema>;

export const IdentificationAnalysisResultV1Schema = moduleResultSchema(
  IdentificationAnalysisSuccessV1Schema,
);
export type IdentificationAnalysisResultV1 = z.infer<typeof IdentificationAnalysisResultV1Schema>;

export const IdentificationFinalizationResultV1Schema = moduleResultSchema(
  IdentificationFinalizationSuccessV1Schema,
);
export type IdentificationFinalizationResultV1 = z.infer<
  typeof IdentificationFinalizationResultV1Schema
>;

export const AssessmentPreparationResultV1Schema = moduleResultSchema(
  AssessmentPreparationSuccessV1Schema,
  true,
);
export type AssessmentPreparationResultV1 = z.infer<typeof AssessmentPreparationResultV1Schema>;

export const AssessmentEvaluationResultV1Schema = moduleResultSchema(
  AssessmentEvaluationSuccessV1Schema,
);
export type AssessmentEvaluationResultV1 = z.infer<typeof AssessmentEvaluationResultV1Schema>;

export const OpenWarningResultV1Schema = moduleResultSchema(OpenWarningSuccessV1Schema);
export type OpenWarningResultV1 = z.infer<typeof OpenWarningResultV1Schema>;

export const RecommendationResultV1Schema = moduleResultSchema(RecommendationSuccessV1Schema);
export type RecommendationResultV1 = z.infer<typeof RecommendationResultV1Schema>;

export const WarningResponseRecordResultV1Schema = moduleResultSchema(
  WarningResponseRecordSuccessV1Schema,
);
export type WarningResponseRecordResultV1 = z.infer<typeof WarningResponseRecordResultV1Schema>;

export const ReviewRequestResultV1Schema = moduleResultSchema(ReviewRequestSuccessV1Schema);
export type ReviewRequestResultV1 = z.infer<typeof ReviewRequestResultV1Schema>;

export const ReviewDecisionResultV1Schema = moduleResultSchema(ReviewDecisionSuccessV1Schema);
export type ReviewDecisionResultV1 = z.infer<typeof ReviewDecisionResultV1Schema>;

export const KnowledgeRevisionApprovalProofResultV1Schema = moduleResultSchema(
  KnowledgeRevisionApprovalProofV1Schema,
);
export type KnowledgeRevisionApprovalProofResultV1 = z.infer<
  typeof KnowledgeRevisionApprovalProofResultV1Schema
>;

export const TraceResultV1Schema = moduleResultSchema(TraceSuccessV1Schema);
export type TraceResultV1 = z.infer<typeof TraceResultV1Schema>;

export const StartAgentTaskResultV1Schema = moduleResultSchema(AgentTaskStartSuccessV1Schema);
export type StartAgentTaskResultV1 = z.infer<typeof StartAgentTaskResultV1Schema>;

export const ResumeAgentTaskResultV1Schema = moduleResultSchema(AgentTaskResumeSuccessV1Schema);
export type ResumeAgentTaskResultV1 = z.infer<typeof ResumeAgentTaskResultV1Schema>;

export const CancelAgentTaskResultV1Schema = moduleResultSchema(AgentTaskCancelSuccessV1Schema);
export type CancelAgentTaskResultV1 = z.infer<typeof CancelAgentTaskResultV1Schema>;

export const ConfirmAgentCommandResultV1Schema = moduleResultSchema(
  AgentTaskConfirmSuccessV1Schema,
);
export type ConfirmAgentCommandResultV1 = z.infer<typeof ConfirmAgentCommandResultV1Schema>;

export const StartWorkflowRunResultV1Schema = moduleResultSchema(WorkflowRunSuccessV1Schema, true);
export type StartWorkflowRunResultV1 = z.infer<typeof StartWorkflowRunResultV1Schema>;

export const ResumeWorkflowRunResultV1Schema = moduleResultSchema(WorkflowRunSuccessV1Schema, true);
export type ResumeWorkflowRunResultV1 = z.infer<typeof ResumeWorkflowRunResultV1Schema>;

export const CancelWorkflowRunResultV1Schema = moduleResultSchema(
  WorkflowRunCancellationSuccessV1Schema,
);
export type CancelWorkflowRunResultV1 = z.infer<typeof CancelWorkflowRunResultV1Schema>;

export const ProjectionQueryResultV1Schema = moduleResultSchema(ProjectionQuerySuccessV1Schema);
export type ProjectionQueryResultV1 = z.infer<typeof ProjectionQueryResultV1Schema>;

export const ProjectionSubscriptionResultV1Schema = moduleResultSchema(
  ProjectionSubscriptionSuccessV1Schema,
);
export type ProjectionSubscriptionResultV1 = z.infer<typeof ProjectionSubscriptionResultV1Schema>;

export const ProjectionExportResultV1Schema = moduleResultSchema(ProjectionExportSuccessV1Schema);
export type ProjectionExportResultV1 = z.infer<typeof ProjectionExportResultV1Schema>;

export interface EngineeringDataPortV1 {
  apply(command: EngineeringDataCommandV1): Promise<EngineeringDataApplyResultV1>;
  freeze(command: EngineeringFreezeCommandV1): Promise<EngineeringFreezeResultV1>;
  read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1>;
}

export interface KnowledgeModelingPortV1 {
  govern<T extends KnowledgeGovernanceCommandV1>(
    command: T,
  ): Promise<KnowledgeGovernanceResultForCommandV1<T>>;
  resolve(command: KnowledgeResolutionCommandV1): Promise<KnowledgeResolutionResultV1>;
  retrieve(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1>;
}

export interface RiskIdentificationPortV1 {
  plan(command: IdentificationPlanCommandV1): Promise<IdentificationPlanResultV1>;
  analyze(command: IdentificationAnalysisCommandV1): Promise<IdentificationAnalysisResultV1>;
  finalize(
    command: IdentificationFinalizationCommandV1,
  ): Promise<IdentificationFinalizationResultV1>;
}

export interface RiskAssessmentPortV1 {
  prepare(command: AssessmentPreparationCommandV1): Promise<AssessmentPreparationResultV1>;
  evaluate(command: AssessmentEvaluationCommandV1): Promise<AssessmentEvaluationResultV1>;
}

export interface WarningResponsePortV1 {
  open(command: OpenWarningCommandV1): Promise<OpenWarningResultV1>;
  recommend(command: RecommendationCommandV1): Promise<RecommendationResultV1>;
  record(command: WarningResponseRecordCommandV1): Promise<WarningResponseRecordResultV1>;
}

export interface ReviewAuditPortV1 {
  requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1>;
  decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1>;
  verifyKnowledgeRevisionApproval(
    query: KnowledgeRevisionApprovalProofQueryV1,
  ): Promise<KnowledgeRevisionApprovalProofResultV1>;
  trace(query: TraceQueryV1): Promise<TraceResultV1>;
}

export interface AgentTaskPortV1 {
  startTask(command: StartAgentTaskCommandV1): Promise<StartAgentTaskResultV1>;
  resumeTask(command: ResumeAgentTaskCommandV1): Promise<ResumeAgentTaskResultV1>;
  cancelTask(command: CancelAgentTaskCommandV1): Promise<CancelAgentTaskResultV1>;
  confirmCommand(command: ConfirmAgentCommandV1): Promise<ConfirmAgentCommandResultV1>;
}

export interface WorkflowPortV1 {
  startRun(command: StartWorkflowRunCommandV1): Promise<StartWorkflowRunResultV1>;
  resumeRun(command: ResumeWorkflowRunCommandV1): Promise<ResumeWorkflowRunResultV1>;
  cancelRun(command: CancelWorkflowRunCommandV1): Promise<CancelWorkflowRunResultV1>;
}

export interface ProjectionPortV1 {
  query(request: ProjectionQueryV1): Promise<ProjectionQueryResultV1>;
  subscribe(request: RunSubscriptionRequestV1): Promise<ProjectionSubscriptionResultV1>;
  export(request: ProjectionExportRequestV1): Promise<ProjectionExportResultV1>;
}
