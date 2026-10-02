import { z, type ZodType } from "zod";

import {
  CommandEnvelopeSchema,
  EvidenceLocatorSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "../common/index.js";
import {
  ApplicabilityConditionsSchema,
  ApplicabilityMetadataSchema,
  CompositeConfidenceSchema,
  DeviationRecordSchema,
  GradeIntervalSchema,
  ResponseRecommendationSchema,
  RiskAssessmentRecordSchema,
  ScalarValueSchema,
  ScoringThresholdSchema,
  StandardizedRiskRecordSchema,
  StructuredScoringRuleSchema,
  WarningRecordSchema,
} from "../records/index.js";
import {
  ApplicabilityMetadataDimensionSchema,
  CalibrationGovernanceDraftOutcomeV1Schema,
  CalibrationReviewOutcomeV1Schema,
  CalibrationSuggestionStatusV1Schema,
  EquipmentComponentSchema,
  MonitoringIndicatorSchema,
  ProcessDependencyRelationTypeSchema,
  ProcessNodeSchema,
  RiskMechanismTypeSchema,
  StateParameterDescriptionSchema,
  StructuralComponentSchema,
  WarningResponseTaskStatusV1Schema,
  WarningTriggerTypeSchema,
  WorkflowReassessmentReasonV1Schema,
  COMPARISON_OPERATOR_VALUES,
} from "../vocabulary/index.js";
export { RiskInputReferenceSchema } from "../records/index.js";
export type { RiskInputReference } from "../records/index.js";

const versionedRef = <const T extends string>(kind: T) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

/** 内容摘要：只用于已登记事实的最小摘要身份，不接受任意文本。 */
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

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

export const IdentificationZeroResultRefV1Schema = versionedRef("identification-zero-result");
export type IdentificationZeroResultRefV1 = z.infer<typeof IdentificationZeroResultRefV1Schema>;

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

export const RuleConflictRefV1Schema = versionedRef("rule-conflict");
export type RuleConflictRefV1 = z.infer<typeof RuleConflictRefV1Schema>;

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
  RuleConflictRefV1Schema,
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
    targetRef: RuleConflictRefV1Schema,
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
  IdentificationZeroResultRefV1Schema,
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
  RuleConflictRefV1Schema,
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
  "agent-task.read",
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
  "risk-assessment.read-input-snapshot": "risk-assessment.read",
  "risk-assessment.read": "risk-assessment.read",
  "warning-response.read": "warning-response.read",
  "warning-response.calibration-review-outcome": "warning-response.record",
  "warning-response.calibration-governance-draft": "warning-response.record",
  "warning-response.open": "warning-response.record",
  "warning-response.create-candidate": "warning-response.recommend",
  "warning-response.validate-and-record": "warning-response.recommend",
  "warning-response.acknowledge": "warning-response.record",
  "warning-response.adopt-recommendation": "warning-response.record",
  "warning-response.record-execution": "warning-response.record",
  "warning-response.record-feedback": "warning-response.record",
  "warning-response.calculate-deviation": "warning-response.record",
  "warning-response.create-calibration-suggestion": "warning-response.record",
  "review-audit.request-review": "review-audit.request",
  "review-audit.decide-review": "review-audit.decide",
  "review-audit.trace": "review-audit.read",
  "review-audit.verify-knowledge-revision-approval": "review-audit.read",
  "review-audit.verify-calibration-suggestion-approval": "review-audit.read",
  "agent-task.read-failure-evidence": "agent-task.read",
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
  "engineering-data.context-read": "engineering-data.read",
  "engineering-data.source-catalog": "engineering-data.read",
  "engineering-data.monitoring-catalog": "engineering-data.read",
  "engineering-data.read-result": "engineering-data.read",
  "knowledge-modeling.governance-read": "knowledge-modeling.read",
  "knowledge-modeling.retrieval-result": "knowledge-modeling.retrieve",
  "projection.result-read": "projection.query",
  "risk-identification.run-list": "risk-identification.read",
  "risk-identification.run-read": "risk-identification.read",
  "risk-identification.record-catalog": "risk-identification.read",
  "risk-identification.record-read": "risk-identification.read",
  "review-audit.queue-read": "review-audit.read",
} as const;
export type ModuleBranchV1 = keyof typeof MODULE_BRANCH_CAPABILITY_V1;

const moduleBranchValuesV1 = Object.keys(MODULE_BRANCH_CAPABILITY_V1) as [
  ModuleBranchV1,
  ...ModuleBranchV1[],
];
/** 模块 branch 名以本目录（C02 分支能力表）为唯一事实源。 */
export const ModuleBranchV1Schema = z.enum(moduleBranchValuesV1);

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
  // 与 `ResumeCauseV1` 的 `agent-task-completed` 成对：同一任务引用即可复原该等待。
  z.strictObject({ kind: z.literal("agent-task"), agentTaskRef: AgentTaskRefV1Schema }),
  // 与 `ResumeCauseV1` 的 `human-decision-committed` 成对：等待中的预测运行只认同一次人工
  // 采纳决定的路由引用，并据此复核建议与空间（C41 接线）。
  z.strictObject({
    kind: z.literal("human-decision"),
    routeDecisionRef: RouteDecisionRefV1Schema,
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
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
      // 等待结果同时携带已登记的真实运行引用：调用方据此按精确运行继续，不必自行派生身份；
      // 只有会真正进入等待态的模块使用该形态（C41 接线）。
      z.strictObject({
        kind: z.literal("waiting"),
        waiting: WaitingRefV1Schema,
        workflowRunRef: WorkflowRunRefV1Schema.optional(),
      }),
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
    "acknowledge",
    z.strictObject({
      warningRecordRef: WarningRecordRefV1Schema,
      warningResponseTaskRef: WarningResponseTaskRefV1Schema,
    }),
    branchCapability("warning-response.acknowledge"),
  ),
  commandSchema(
    "adopt-recommendation",
    z.strictObject({
      responseRecommendationRef: ResponseRecommendationRefV1Schema,
      decision: z.enum(["adopted", "declined"]),
      reasonCode: IdentifierSchema,
      // 可选精确选择器：采纳路径据此确定执行前监测快照；缺省时由服务端在唯一合格候选下选择，
      // 候选不唯一即安全失败，绝不猜测“最新监测”（C41 接线）。
      preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
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
      // 可选精确选择器：正式提交必须提供，服务端据此核对已成立的实际评估；选择器本身不是评估结果，
      // 调用方不得自行提交评估值（C41 接线）。
      actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
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
  // 等待中预测运行的唯一合法恢复原因：只携带已成立的人工采纳决定路由引用，
  // 运行、建议与空间由 C41 的精确采纳证明复核（C41 接线）。
  z.strictObject({
    kind: z.literal("human-decision-committed"),
    routeDecisionRef: RouteDecisionRefV1Schema,
  }),
]);
export type ResumeCauseV1 = z.infer<typeof ResumeCauseV1Schema>;

const workflowStartControlShape = {
  graphVersion: VersionReferenceSchema,
  retryPolicyRef: VersionReferenceSchema,
};

/**
 * `identify-and-assess` 的逐空间配对上下文（C30 design D-01）：每个空间恰一项适用性快照，
 * 监测集合可选；配对完整性由 C30 前置门禁在副作用前判定，Schema 层保持可解析。
 */
const WorkflowAssessmentContextV1Schema = z.strictObject({
  spatialScopeRef: SpatialScopeRefV1Schema,
  applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
});

const StartWorkflowPayloadV1Schema = z.discriminatedUnion("entryMode", [
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("identify-and-assess"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
    sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
    assessmentContexts: z.array(WorkflowAssessmentContextV1Schema).min(1).optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("assess"),
    riskInput: RiskInputVersionRefV1Schema,
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
    spatialScopeRef: SpatialScopeRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema.optional(),
    monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("reassess"),
    previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    reason: WorkflowReassessmentReasonV1Schema,
    changedInputRefs: z.array(ContractReferenceV1Schema).min(1).max(64),
    riskInput: RiskInputVersionRefV1Schema.optional(),
    projectRevisionRef: ProjectRevisionRefV1Schema.optional(),
    spatialScopeRef: SpatialScopeRefV1Schema.optional(),
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema.optional(),
    monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("historical-backfill"),
    riskInput: RiskInputVersionRefV1Schema,
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    effectiveAt: IsoDateTimeSchema,
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema.optional(),
    spatialScopeRef: SpatialScopeRefV1Schema.optional(),
    monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("forecast-response"),
    adoptedRecommendationRef: ResponseRecommendationRefV1Schema,
    preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema.optional(),
    // 可选冻结评估依据（C25 输入快照精确引用）：分段入口不重新准备评估，A0 只按该冻结引用
    // 构造预测/偏差输入；缺省保持原调用方语义（C41 接线）。
    frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema.optional(),
    // 可选闭合等待意图：置位时运行在人工采纳事实成立前停留在等待态、不执行预测；
    // 缺省保持原调用方语义（C41 接线）。
    waitForDecision: z.literal(true).optional(),
  }),
  z.strictObject({
    ...workflowStartControlShape,
    entryMode: z.literal("record-response-feedback"),
    executionRecordRef: ExecutionRecordRefV1Schema,
    feedbackRef: FeedbackRefV1Schema,
    forecastRef: EffectForecastRefV1Schema.optional(),
    assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema.optional(),
    // 可选冻结评估依据：与预测入口同义，偏差阶段只按该精确引用对账（C41 接线）。
    frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema.optional(),
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

/** C36 质量评估：页面查询只暴露有界摘要，正文仍由 C04 工件与拥有方保存。 */
export const QUALITY_EVALUATION_SAMPLE_KINDS_V1 = ["deidentified-real", "synthetic"] as const;
export const QualityEvaluationSampleKindV1Schema = z.enum(QUALITY_EVALUATION_SAMPLE_KINDS_V1);
export type QualityEvaluationSampleKindV1 = z.infer<typeof QualityEvaluationSampleKindV1Schema>;

/** 无甲方真实样例时的固定标记；合成结论不得据此声称真实工程性能。 */
export const QUALITY_EVALUATION_SYNTHETIC_LABEL_V1 = "合成样本，待甲方复核" as const;

export const QUALITY_EVALUATION_METRIC_CODES_V1 = [
  "accuracy",
  "precision",
  "coverage",
  "source-consistency",
  "grade-match",
  "replay-rate",
  "audit-completeness",
] as const;
export const QualityEvaluationMetricCodeV1Schema = z.enum(QUALITY_EVALUATION_METRIC_CODES_V1);
export type QualityEvaluationMetricCodeV1 = z.infer<typeof QualityEvaluationMetricCodeV1Schema>;

export const QUALITY_EVALUATION_METRIC_STATUSES_V1 = ["computed", "not-computable"] as const;
export const QualityEvaluationMetricStatusV1Schema = z.enum(QUALITY_EVALUATION_METRIC_STATUSES_V1);
export type QualityEvaluationMetricStatusV1 = z.infer<typeof QualityEvaluationMetricStatusV1Schema>;

/** 稳定原因码：页面只按码解释不可计算与缺口，不披露领域正文。 */
export const QUALITY_EVALUATION_REASON_CODES_V1 = [
  "quality-dataset-invalid",
  "quality-identification-key-mismatch",
  "quality-identification-key-conflict",
  "quality-identification-evidence-unverified",
  "quality-identification-result-missing",
  "quality-assessment-decision-missing",
  "quality-assessment-record-mismatch",
  "quality-assessment-replay-context-missing",
  "quality-assessment-replay-mismatch",
  "quality-assessment-replay-failed",
  "quality-evidence-artifact-unverified",
  "quality-summary-exceeds-limit",
  "quality-metric-denominator-zero",
] as const;
export const QualityEvaluationReasonCodeV1Schema = z.enum(QUALITY_EVALUATION_REASON_CODES_V1);
export type QualityEvaluationReasonCodeV1 = z.infer<typeof QualityEvaluationReasonCodeV1Schema>;

const qualityMetricBase = {
  metricCode: QualityEvaluationMetricCodeV1Schema,
  numerator: z.number().int().nonnegative().refine(Number.isSafeInteger),
  denominator: z.number().int().nonnegative().refine(Number.isSafeInteger),
  value: z.number().finite().min(0).max(1).nullable(),
  status: QualityEvaluationMetricStatusV1Schema,
  reasonCode: QualityEvaluationReasonCodeV1Schema.optional(),
};

export const QualityEvaluationMetricV1Schema = z
  .strictObject(qualityMetricBase)
  .superRefine((metric, context) => {
    if (metric.numerator > metric.denominator) {
      context.addIssue({
        code: "custom",
        path: ["numerator"],
        message: "numerator must not exceed the denominator",
      });
    }
    if (metric.status === "computed" && (metric.denominator === 0 || metric.value === null)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "computed metrics require a non-zero denominator and a value",
      });
      return;
    }
    if (
      metric.status === "not-computable" &&
      (metric.value !== null || metric.reasonCode === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "not-computable metrics must report a null value and a stable reason code",
      });
    }
  });
export type QualityEvaluationMetricV1 = z.infer<typeof QualityEvaluationMetricV1Schema>;

/**
 * 页面可见的 C36 摘要：只有工程、精确报告/数据集引用、样例类别、指标分子分母与值、
 * 证据定位引用与时间；不含完整数据集、样例标签、配置正文或原始模型响应。
 */
export const QualityEvaluationSummaryV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  reportArtifactRef: ContentArtifactRefV1Schema,
  datasetArtifactRef: ContentArtifactRefV1Schema,
  sampleKind: QualityEvaluationSampleKindV1Schema,
  label: z.string(),
  metrics: z
    .array(QualityEvaluationMetricV1Schema)
    .length(QUALITY_EVALUATION_METRIC_CODES_V1.length),
  evidenceRefs: z.array(EvidenceReferenceSchema).max(16),
  createdAt: IsoDateTimeSchema,
});
export type QualityEvaluationSummaryV1 = z.infer<typeof QualityEvaluationSummaryV1Schema>;

const QUALITY_EVALUATION_PAGE_SIZE_MAX = 50;

/** 闭合选择器：只允许按项目修订的有界列表或按精确报告引用查询，不接受任意过滤。 */
export const QualityEvaluationQuerySelectorV1Schema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("list"),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    pageSize: z.number().int().positive().max(QUALITY_EVALUATION_PAGE_SIZE_MAX),
    cursor: z.string().max(512).optional(),
  }),
  z.strictObject({
    mode: z.literal("exact"),
    reportArtifactRef: ContentArtifactRefV1Schema,
  }),
]);
export type QualityEvaluationQuerySelectorV1 = z.infer<
  typeof QualityEvaluationQuerySelectorV1Schema
>;

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
  z.strictObject({
    queryType: z.literal("quality-evaluation"),
    selector: QualityEvaluationQuerySelectorV1Schema,
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

export const CalibrationSuggestionApprovalProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-calibration-suggestion-approval",
    z.strictObject({
      calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
      reviewDecisionRef: ReviewDecisionRefV1Schema,
    }),
    branchCapability("review-audit.verify-calibration-suggestion-approval"),
  ),
]);
export type CalibrationSuggestionApprovalProofQueryV1 = z.infer<
  typeof CalibrationSuggestionApprovalProofQueryV1Schema
>;

/**
 * C30 只读证明（C41 接线 D5）：按精确建议与运行引用返回已登记的路由/运行/空间事实，
 * 不扩张 `WorkflowPortV1` 写签名，也不写入任何 C30/C28 事实。
 */
export const ResponseWorkflowBindingProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-response-workflow-binding",
    z.strictObject({
      responseRecommendationRef: ResponseRecommendationRefV1Schema,
      workflowRunRef: WorkflowRunRefV1Schema,
    }),
    branchCapability("workflow.start-run"),
  ),
]);
export type ResponseWorkflowBindingProofQueryV1 = z.infer<
  typeof ResponseWorkflowBindingProofQueryV1Schema
>;

export const ResponseWorkflowBindingProofV1Schema = z.strictObject({
  kind: z.literal("bound"),
  projectId: IdentifierSchema,
  responseRecommendationRef: ResponseRecommendationRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  routeDecisionRef: RouteDecisionRefV1Schema,
  workflowRunRef: WorkflowRunRefV1Schema,
  runStatus: WorkflowRunStatusV1Schema,
  frozenDigest: digestSchema,
  auditTrailRef: AuditTrailRefV1Schema,
});
export type ResponseWorkflowBindingProofV1 = z.infer<typeof ResponseWorkflowBindingProofV1Schema>;

export const ResponseWorkflowBindingProofResultV1Schema = moduleResultSchema(
  ResponseWorkflowBindingProofV1Schema,
);
export type ResponseWorkflowBindingProofResultV1 = z.infer<
  typeof ResponseWorkflowBindingProofResultV1Schema
>;

/** C30 按精确子运行与评估记录证明实际评估已经完成。 */
export const WorkflowRunCompletionProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-workflow-run-completion",
    z.strictObject({
      workflowRunRef: WorkflowRunRefV1Schema,
      riskAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    }),
    branchCapability("workflow.start-run"),
  ),
]);
export type WorkflowRunCompletionProofQueryV1 = z.infer<
  typeof WorkflowRunCompletionProofQueryV1Schema
>;

export const WorkflowRunCompletionProofV1Schema = z.strictObject({
  kind: z.literal("completed"),
  projectId: IdentifierSchema,
  workflowRunRef: WorkflowRunRefV1Schema,
  riskAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
});
export type WorkflowRunCompletionProofV1 = z.infer<typeof WorkflowRunCompletionProofV1Schema>;
export const WorkflowRunCompletionProofResultV1Schema = moduleResultSchema(
  WorkflowRunCompletionProofV1Schema,
);
export type WorkflowRunCompletionProofResultV1 = z.infer<
  typeof WorkflowRunCompletionProofResultV1Schema
>;

/**
 * C25 只读证明（C41 接线 D5）：只按精确评估记录引用返回最小投影，不返回正文、latest 或列表，
 * 不重算也不改写历史评估。
 */
export const ActualAssessmentProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-actual-assessment",
    z.strictObject({ riskAssessmentRecordRef: RiskAssessmentRecordRefV1Schema }),
    branchCapability("risk-assessment.read-input-snapshot"),
  ),
]);
export type ActualAssessmentProofQueryV1 = z.infer<typeof ActualAssessmentProofQueryV1Schema>;

export const ActualAssessmentProofV1Schema = z.strictObject({
  kind: z.literal("established"),
  projectId: IdentifierSchema,
  riskAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  riskInputRef: RiskInputVersionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
  assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema),
  deviationPolicyRef: VersionReferenceSchema,
  calibrationAgentPolicyRef: VersionReferenceSchema,
  assessmentRunRef: WorkflowRunRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  recordedAt: IsoDateTimeSchema,
});
export type ActualAssessmentProofV1 = z.infer<typeof ActualAssessmentProofV1Schema>;

export const ActualAssessmentProofResultV1Schema = moduleResultSchema(
  ActualAssessmentProofV1Schema,
);
export type ActualAssessmentProofResultV1 = z.infer<typeof ActualAssessmentProofResultV1Schema>;

/**
 * C41 只读证明（C41 接线 D3）：仅供 C30 等待运行恢复使用；只返回已终局采纳与 C28 决定一致的
 * 最小证明，pending、declined、缺失、越权一律失败，调用方无权据此读取建议正文。
 */
export const HumanDecisionProofQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "verify-human-decision-committed",
    z.strictObject({
      routeDecisionRef: RouteDecisionRefV1Schema,
      workflowRunRef: WorkflowRunRefV1Schema,
      responseRecommendationRef: ResponseRecommendationRefV1Schema,
    }),
    branchCapability("workflow.resume-run"),
  ),
]);
export type HumanDecisionProofQueryV1 = z.infer<typeof HumanDecisionProofQueryV1Schema>;

export const HumanDecisionProofV1Schema = z.strictObject({
  kind: z.literal("adopted"),
  projectId: IdentifierSchema,
  routeDecisionRef: RouteDecisionRefV1Schema,
  workflowRunRef: WorkflowRunRefV1Schema,
  responseRecommendationRef: ResponseRecommendationRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  decidedBy: IdentifierSchema,
  decidedAt: IsoDateTimeSchema,
  auditTrailRef: AuditTrailRefV1Schema,
});
export type HumanDecisionProofV1 = z.infer<typeof HumanDecisionProofV1Schema>;

export const HumanDecisionProofResultV1Schema = moduleResultSchema(HumanDecisionProofV1Schema);
export type HumanDecisionProofResultV1 = z.infer<typeof HumanDecisionProofResultV1Schema>;

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
    kind: z.literal("zero-result"),
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
    zeroResultRef: IdentificationZeroResultRefV1Schema,
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
    kind: z.literal("acknowledgement"),
    status: z.literal("acknowledged"),
    warningRecordRef: WarningRecordRefV1Schema,
    warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("adoption"),
    routeDecisionRef: RouteDecisionRefV1Schema,
    forecastRunRef: WorkflowRunRefV1Schema,
  }),
  // 拒绝是终局事实但不含预测运行：只返回 C41 自有的决定路由引用，不伪造运行绑定（C41 接线）。
  z.strictObject({
    kind: z.literal("decline"),
    routeDecisionRef: RouteDecisionRefV1Schema,
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

export const CalibrationSuggestionApprovalProofV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approved-for-draft"),
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    decidedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    decidedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("returned-for-revision"),
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    decidedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("not-approved"),
    reason: z.enum(["decision-not-found", "target-mismatch"]),
  }),
]);
export type CalibrationSuggestionApprovalProofV1 = z.infer<
  typeof CalibrationSuggestionApprovalProofV1Schema
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

export const ProjectionQuerySuccessV1Schema = z
  .strictObject({
    queryResultRef: QueryResultRefV1Schema,
    qualitySummaries: z
      .array(QualityEvaluationSummaryV1Schema)
      .max(QUALITY_EVALUATION_PAGE_SIZE_MAX)
      .optional(),
    nextCursor: z.string().max(512).optional(),
  })
  .superRefine((success, context) => {
    if (success.nextCursor !== undefined && success.qualitySummaries === undefined) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "a cursor is only meaningful for a bounded quality summary list",
      });
    }
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

/**
 * C30 自有链边关系码（design D-05）：只登记真实成立的相邻关系，未触发的分支登记原因而不写空边。
 * 定义在公共契约中，因为 `ProjectionResultReadPortV1` 的有界读取结果按此闭合取值披露。
 */
export const WORKFLOW_LINK_RELATIONS_V1 = [
  "parent-child",
  "run-stage",
  "segment-process",
  "process-mechanism",
  "mechanism-risk",
  "risk-assessment",
  "assessment-warning",
  "warning-recommendation",
  "recommendation-forecast",
  "forecast-execution",
  "execution-feedback",
  "feedback-deviation",
  "deviation-calibration",
] as const;
export const WorkflowLinkRelationV1Schema = z.enum(WORKFLOW_LINK_RELATIONS_V1);
export type WorkflowLinkRelationV1 = z.infer<typeof WorkflowLinkRelationV1Schema>;

/**
 * C30 缺席链尾类型（C31 design D-01）：只登记未发生分支的类型化原因，不补造链尾事实。
 * 定义在公共契约中，因为 `ProjectionResultReadPortV1` 的报告谓词按此闭合取值披露。
 */
export const WORKFLOW_SKIPPED_TAIL_KINDS_V1 = [
  "warning",
  "recommendation",
  "forecast",
  "feedback",
  "deviation",
  "calibration",
] as const;
export const WorkflowSkippedTailKindV1Schema = z.enum(WORKFLOW_SKIPPED_TAIL_KINDS_V1);
export type WorkflowSkippedTailKindV1 = z.infer<typeof WorkflowSkippedTailKindV1Schema>;

const riskRecordTraceItemV1Base = {
  riskRecordRef: StandardizedRiskRecordRefV1Schema,
};

/**
 * 风险记录追溯窄读请求（design D-06）：一次最多 100 条精确版本，逐项返回最小引用，
 * 不携带风险正文。`invocationId` 与 `branch` 是本次调用的复验身份对（外层调用入口的
 * 领域 `queryId` 与路由 branch），复验按它与签发身份精确配对。
 */
export const RiskRecordTraceReadRequestV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  riskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema).min(1).max(100),
  requestedAt: IsoDateTimeSchema,
  invocationId: IdentifierSchema,
  branch: ModuleBranchV1Schema,
  authorization: AuthorizationContextV1Schema,
});

export const RiskRecordTraceItemV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("found"),
    ...riskRecordTraceItemV1Base,
    processNodeId: IdentifierSchema,
    sourceSegmentIds: z.array(IdentifierSchema).min(1).max(256),
    riskMechanismEntryIds: z.array(IdentifierSchema).max(64),
    evidenceLocator: EvidenceLocatorSchema.optional(),
    auditTrailRef: AuditTrailRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("failed"),
    ...riskRecordTraceItemV1Base,
    error: ModuleErrorV1Schema,
  }),
]);

export const RiskRecordTraceReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), items: z.array(RiskRecordTraceItemV1Schema) }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type RiskRecordTraceReadResultV1 = z.infer<typeof RiskRecordTraceReadResultV1Schema>;

const projectionRunSummaryItemV1Schema = z.strictObject({
  kind: z.literal("run-summary"),
  workflowRunRef: WorkflowRunRefV1Schema,
  parentRunRef: WorkflowRunRefV1Schema.optional(),
  status: WorkflowRunStatusV1Schema,
  /** C30 派生的入口身份：与登记行的 `entryIdentity` 同形，不伪造公共引用 kinds。 */
  entryIdentity: VersionReferenceSchema,
  latestResultRef: ContractReferenceV1Schema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
});

const projectionTraceLinkItemV1Schema = z.strictObject({
  kind: z.literal("trace-link"),
  fromRef: ContractReferenceV1Schema,
  toRef: ContractReferenceV1Schema,
  relation: WorkflowLinkRelationV1Schema,
  stageResultRef: StageResultRefV1Schema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
  evidenceLocator: EvidenceLocatorSchema.optional(),
});

/** 报告可由已成立事实披露的六种版本化引用（C31 design D-01）：不含等级、P/C 或领域正文。 */
export const ProjectionReportFactRefV1Schema = z.discriminatedUnion("kind", [
  StandardizedRiskRecordRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  WarningRecordRefV1Schema,
  ResponseRecommendationRefV1Schema,
  DeviationRecordRefV1Schema,
  CalibrationSuggestionRefV1Schema,
]);
export type ProjectionReportFactRefV1 = z.infer<typeof ProjectionReportFactRefV1Schema>;

const projectionReportFactItemV1Schema = z.strictObject({
  kind: z.literal("report-fact"),
  workflowRunRef: WorkflowRunRefV1Schema,
  factRef: ProjectionReportFactRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
  evidenceLocator: EvidenceLocatorSchema.optional(),
});

const projectionReportAbsenceItemV1Schema = z.strictObject({
  kind: z.literal("report-absence"),
  workflowRunRef: WorkflowRunRefV1Schema,
  tailKind: WorkflowSkippedTailKindV1Schema,
  reasonCode: IdentifierSchema,
  lastEstablishedRef: ContractReferenceV1Schema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
});

export const ProjectionResultItemV1Schema = z.discriminatedUnion("kind", [
  projectionRunSummaryItemV1Schema,
  projectionTraceLinkItemV1Schema,
  projectionReportFactItemV1Schema,
  projectionReportAbsenceItemV1Schema,
]);
export type ProjectionResultItemV1 = z.infer<typeof ProjectionResultItemV1Schema>;

/** 有界页面读取请求（design D-06）：游标、上限与查询引用一同绑定当前授权摘要；
 * `queryId` 是这次读取调用的领域标识，复验按它与签发身份精确配对。 */
export const ProjectionResultReadRequestV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  queryResultRef: QueryResultRefV1Schema,
  requestedAt: IsoDateTimeSchema,
  queryId: IdentifierSchema,
  cursor: IdentifierSchema.optional(),
  limit: z.number().int().min(1).max(100),
  authorization: AuthorizationContextV1Schema,
});
export type ProjectionResultReadRequestV1 = z.infer<typeof ProjectionResultReadRequestV1Schema>;

export const ProjectionResultReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page"),
    queryType: z.enum(["run-view", "trace-chain", "association-graph", "risk-overview"]),
    items: z.array(ProjectionResultItemV1Schema),
    nextCursor: IdentifierSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type ProjectionResultReadResultV1 = z.infer<typeof ProjectionResultReadResultV1Schema>;

export interface RiskRecordTraceReadPortV1 {
  readBatch(
    request: z.infer<typeof RiskRecordTraceReadRequestV1Schema>,
  ): Promise<RiskRecordTraceReadResultV1>;
}

export interface ProjectionResultReadPortV1 {
  readPage(
    request: z.infer<typeof ProjectionResultReadRequestV1Schema>,
  ): Promise<ProjectionResultReadResultV1>;
}

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

export const CalibrationSuggestionApprovalProofResultV1Schema = moduleResultSchema(
  CalibrationSuggestionApprovalProofV1Schema,
);
export type CalibrationSuggestionApprovalProofResultV1 = z.infer<
  typeof CalibrationSuggestionApprovalProofResultV1Schema
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

/** C41 承载的三个人工命令分支：公开命令里其余分支仍属处置模块（C41 接线 D1）。 */
export type HumanDecisionFeedbackCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "adopt-recommendation" | "record-execution" | "record-feedback" }
>;

/**
 * 人工决定与反馈命令端口：只承载上述三分支，与 `WarningResponsePortV1.record` 并列注入，
 * 使同一路由可按分支转发而不改变原端口的其它语义（C41 接线 D1）。
 */
export interface HumanDecisionFeedbackPortV1 {
  record(command: HumanDecisionFeedbackCommandV1): Promise<WarningResponseRecordResultV1>;
}

export interface ReviewAuditPortV1 {
  requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1>;
  decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1>;
  verifyKnowledgeRevisionApproval(
    query: KnowledgeRevisionApprovalProofQueryV1,
  ): Promise<KnowledgeRevisionApprovalProofResultV1>;
  trace(query: TraceQueryV1): Promise<TraceResultV1>;
}

/**
 * 校准建议批准证明的专用只读端口：与知识修订批准证明并列，合法决定集合不同，
 * 因此不并入 `ReviewAuditPortV1`，也不迫使既有实现者增补无关方法。
 */
export interface CalibrationSuggestionApprovalProofPortV1 {
  verifyCalibrationSuggestionApproval(
    query: CalibrationSuggestionApprovalProofQueryV1,
  ): Promise<CalibrationSuggestionApprovalProofResultV1>;
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

/**
 * 工作流绑定只读证明端口：工作流所有者实现，C41 组合使用；与 `WorkflowPortV1` 写命令并列，
 * 不迫使既有实现者增补方法，也不改变原有查询语义。
 */
export interface ResponseWorkflowBindingProofPortV1 {
  verifyResponseWorkflowBinding(
    query: ResponseWorkflowBindingProofQueryV1,
  ): Promise<ResponseWorkflowBindingProofResultV1>;
}

export interface WorkflowRunCompletionProofPortV1 {
  verifyWorkflowRunCompletion(
    query: WorkflowRunCompletionProofQueryV1,
  ): Promise<WorkflowRunCompletionProofResultV1>;
}

/** 实际评估只读证明端口：评估所有者实现，C41 组合使用；不扩张 `RiskAssessmentPortV1` 写签名。 */
export interface ActualAssessmentProofPortV1 {
  verifyActualAssessment(
    query: ActualAssessmentProofQueryV1,
  ): Promise<ActualAssessmentProofResultV1>;
}

/** 人工采纳证明只读端口：C41 实现、C30 等待运行恢复消费；只返回已终局采纳的最小证明。 */
export interface HumanDecisionProofPortV1 {
  verifyHumanDecisionCommitted(
    query: HumanDecisionProofQueryV1,
  ): Promise<HumanDecisionProofResultV1>;
}

/* ===========================================================================
 * C32 只读面（deliver-engineering-and-knowledge-ui）
 * 读取 DTO 只镜像各 owning 模块写路径已校验的字段形状；跨字段领域不变式由
 * 写路径强制，读取侧不重复校验。全部为只读、有界、授权复验契约。
 * ======================================================================== */

const C32_READ_PAGE_SIZE_MAX_V1 = 50;
const c32ReadPageSize = z.number().int().min(1).max(C32_READ_PAGE_SIZE_MAX_V1);
const c32ReadCursor = z.string().min(1).max(512);
const c32ReadText = z.string().trim().min(1).max(500);
const c32FiniteNumber = z.number().finite();
const c32NonNegativeInt = z.number().int().nonnegative();
const c32EvidenceList = z.array(EvidenceReferenceSchema).min(1).max(16);

// ---- engineering-data：工程上下文读 ----

export const EngineeringSpatialScopeNodeV1Schema = z.strictObject({
  spatialScopeRef: SpatialScopeRefV1Schema,
  parentSpatialScopeRef: SpatialScopeRefV1Schema.optional(),
  name: c32ReadText,
  worksiteLocation: c32ReadText.optional(),
});
export type EngineeringSpatialScopeNodeV1 = z.infer<typeof EngineeringSpatialScopeNodeV1Schema>;

export const EngineeringContextReadSuccessV1Schema = z.strictObject({
  kind: z.literal("context-read"),
  projectId: IdentifierSchema,
  contextStatus: z.enum(["preparing", "active"]),
  currentProjectRevisionRef: ProjectRevisionRefV1Schema.optional(),
  applicabilityMetadata: ApplicabilityMetadataSchema.optional(),
  missingApplicabilityDimensions: z.array(ApplicabilityMetadataDimensionSchema).max(8),
  spatialScopes: z.array(EngineeringSpatialScopeNodeV1Schema).max(256),
});
export type EngineeringContextReadSuccessV1 = z.infer<typeof EngineeringContextReadSuccessV1Schema>;

// ---- engineering-data：资料目录 ----

export const SOURCE_CATALOG_PARSE_STATUS_V1_VALUES = [
  "registered",
  "processing",
  "parsed",
  "failed",
] as const;
export const SourceCatalogParseStatusV1Schema = z.enum(SOURCE_CATALOG_PARSE_STATUS_V1_VALUES);
export type SourceCatalogParseStatusV1 = z.infer<typeof SourceCatalogParseStatusV1Schema>;

export const CLEANING_AVAILABILITY_V1_VALUES = ["available", "partial", "unavailable"] as const;
export const CleaningAvailabilityV1Schema = z.enum(CLEANING_AVAILABILITY_V1_VALUES);
export type CleaningAvailabilityV1 = z.infer<typeof CleaningAvailabilityV1Schema>;

export const SourceCatalogItemV1Schema = z.strictObject({
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceId: IdentifierSchema,
  documentType: c32ReadText.optional(),
  formedAt: IsoDateTimeSchema.optional(),
  sourceOrganization: c32ReadText.optional(),
  externalVersion: c32ReadText.optional(),
  parseStatus: SourceCatalogParseStatusV1Schema,
  cleaningAvailability: CleaningAvailabilityV1Schema.optional(),
  cleaningExclusionCount: c32NonNegativeInt.optional(),
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema.optional(),
});
export type SourceCatalogItemV1 = z.infer<typeof SourceCatalogItemV1Schema>;

export const SourceCatalogPageV1Schema = z.strictObject({
  kind: z.literal("source-catalog"),
  items: z.array(SourceCatalogItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
  totalCount: c32NonNegativeInt,
  nextCursor: c32ReadCursor.optional(),
});
export type SourceCatalogPageV1 = z.infer<typeof SourceCatalogPageV1Schema>;

// ---- engineering-data：监测目录 ----

export const MonitoringSeriesCatalogItemV1Schema = z.strictObject({
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  monitoringIndicator: MonitoringIndicatorSchema,
  monitoringObject: c32ReadText,
  canonicalUnit: z.string().trim().min(1).max(64),
  spatialScopeRef: SpatialScopeRefV1Schema,
  batchCount: c32NonNegativeInt,
  latestSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
});
export type MonitoringSeriesCatalogItemV1 = z.infer<typeof MonitoringSeriesCatalogItemV1Schema>;

export const MonitoringCatalogSeriesPageV1Schema = z.strictObject({
  kind: z.literal("monitoring-series-list"),
  items: z.array(MonitoringSeriesCatalogItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
  totalCount: c32NonNegativeInt,
  nextCursor: c32ReadCursor.optional(),
});
export type MonitoringCatalogSeriesPageV1 = z.infer<typeof MonitoringCatalogSeriesPageV1Schema>;

export const MonitoringBatchCatalogItemV1Schema = z.strictObject({
  monitoringBatchRef: MonitoringBatchRefV1Schema,
  relation: z.enum(["original", "correction", "supplement"]),
  window: z.strictObject({ from: IsoDateTimeSchema, to: IsoDateTimeSchema }),
  sampleCount: c32NonNegativeInt,
  occurredAt: IsoDateTimeSchema,
});
export type MonitoringBatchCatalogItemV1 = z.infer<typeof MonitoringBatchCatalogItemV1Schema>;

export const MonitoringSnapshotCatalogItemV1Schema = z.strictObject({
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  cutoff: IsoDateTimeSchema,
  availability: CleaningAvailabilityV1Schema,
  coverageRatio: c32FiniteNumber,
  /** 快照证据触达的来源版本：客户端据此在监测快照查询/再读取时声明授权来源。 */
  evidenceSourceVersionRefs: z.array(SourceVersionRefV1Schema).max(64),
});
export type MonitoringSnapshotCatalogItemV1 = z.infer<typeof MonitoringSnapshotCatalogItemV1Schema>;

export const MonitoringCatalogSeriesDetailV1Schema = z.strictObject({
  kind: z.literal("monitoring-series-detail"),
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  batches: z.array(MonitoringBatchCatalogItemV1Schema).max(100),
  snapshots: z.array(MonitoringSnapshotCatalogItemV1Schema).max(100),
  nextCursor: c32ReadCursor.optional(),
});
export type MonitoringCatalogSeriesDetailV1 = z.infer<typeof MonitoringCatalogSeriesDetailV1Schema>;

// ---- engineering-data：查询结果再读取（read-result）----

export const EngineeringReadSegmentLocatorV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document"),
    pageNumber: z.number().int().positive(),
    headingPath: z.array(c32ReadText).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("table"),
    sheet: c32ReadText,
    table: c32ReadText,
    rowRange: z.strictObject({ start: c32NonNegativeInt, end: c32NonNegativeInt }),
    columnRange: z.strictObject({ start: c32NonNegativeInt, end: c32NonNegativeInt }),
  }),
  z.strictObject({
    kind: z.literal("record"),
    dataset: c32ReadText,
    stableRecordKey: c32ReadText,
  }),
  z.strictObject({
    kind: z.literal("time-window"),
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
  }),
]);
export type EngineeringReadSegmentLocatorV1 = z.infer<typeof EngineeringReadSegmentLocatorV1Schema>;

export const EngineeringReadSourceSegmentV1Schema = z.strictObject({
  sourceSegmentId: z.string().regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+$/u),
  chapterId: IdentifierSchema,
  segmentId: IdentifierSchema,
  kind: z.enum(["chapter", "table", "monitoring-window"]),
  locator: EngineeringReadSegmentLocatorV1Schema,
});
export type EngineeringReadSourceSegmentV1 = z.infer<typeof EngineeringReadSourceSegmentV1Schema>;

export const EngineeringReadSegmentSetSuccessV1Schema = z.strictObject({
  kind: z.literal("source-segments"),
  queryResultRef: QueryResultRefV1Schema,
  segmentSet: z.strictObject({
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
    sourceVersionRef: SourceVersionRefV1Schema,
    sourceId: IdentifierSchema,
    segments: z.array(EngineeringReadSourceSegmentV1Schema).min(1).max(10_000),
    recordedAt: IsoDateTimeSchema,
  }),
  sourceAccessGrantRef: SourceAccessGrantRefV1Schema,
});
export type EngineeringReadSegmentSetSuccessV1 = z.infer<
  typeof EngineeringReadSegmentSetSuccessV1Schema
>;

export const EngineeringReadEvidenceItemV1Schema = z.strictObject({
  evidenceReference: EvidenceReferenceSchema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  sourceAccessGrantRef: SourceAccessGrantRefV1Schema,
  segment: EngineeringReadSourceSegmentV1Schema,
});
export type EngineeringReadEvidenceItemV1 = z.infer<typeof EngineeringReadEvidenceItemV1Schema>;

export const EngineeringReadEvidenceSuccessV1Schema = z.strictObject({
  kind: z.literal("evidence-access"),
  queryResultRef: QueryResultRefV1Schema,
  purposeCode: IdentifierSchema,
  items: z.array(EngineeringReadEvidenceItemV1Schema).min(1).max(256),
});
export type EngineeringReadEvidenceSuccessV1 = z.infer<
  typeof EngineeringReadEvidenceSuccessV1Schema
>;

export const EngineeringReadMonitoringAlignedPointV1Schema = z.strictObject({
  sampledAt: IsoDateTimeSchema,
  value: c32FiniteNumber.nullable(),
  unit: z.string().trim().min(1).max(64),
  status: z.enum(["available", "interpolated", "missing"]),
  reasonCode: IdentifierSchema.optional(),
});
export type EngineeringReadMonitoringAlignedPointV1 = z.infer<
  typeof EngineeringReadMonitoringAlignedPointV1Schema
>;

export const EngineeringReadMonitoringFeatureV1Schema = z.strictObject({
  featureType: z.enum(["short-term-slope", "acceleration", "dominant-frequency", "anomaly-score"]),
  value: c32FiniteNumber.optional(),
  unit: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["available", "unavailable"]),
  reasonCode: IdentifierSchema.optional(),
});
export type EngineeringReadMonitoringFeatureV1 = z.infer<
  typeof EngineeringReadMonitoringFeatureV1Schema
>;

export const EngineeringReadMonitoringSnapshotV1Schema = z.strictObject({
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  cutoff: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  window: z.strictObject({ from: IsoDateTimeSchema, to: IsoDateTimeSchema }),
  availabilityPolicyRef: VersionReferenceSchema,
  availability: CleaningAvailabilityV1Schema,
  coverageRatio: c32FiniteNumber,
  availabilityReasons: z.array(IdentifierSchema).max(32),
  alignedPoints: z.array(EngineeringReadMonitoringAlignedPointV1Schema).max(10_000),
  features: z.strictObject({
    shortTermSlope: EngineeringReadMonitoringFeatureV1Schema,
    acceleration: EngineeringReadMonitoringFeatureV1Schema,
    dominantFrequency: EngineeringReadMonitoringFeatureV1Schema,
    anomalyScore: EngineeringReadMonitoringFeatureV1Schema,
  }),
  monitoringBatchRefs: z.array(MonitoringBatchRefV1Schema).max(100),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
});
export type EngineeringReadMonitoringSnapshotV1 = z.infer<
  typeof EngineeringReadMonitoringSnapshotV1Schema
>;

export const EngineeringReadMonitoringSnapshotSuccessV1Schema = z.strictObject({
  kind: z.literal("monitoring-snapshot"),
  queryResultRef: QueryResultRefV1Schema,
  snapshot: EngineeringReadMonitoringSnapshotV1Schema,
});
export type EngineeringReadMonitoringSnapshotSuccessV1 = z.infer<
  typeof EngineeringReadMonitoringSnapshotSuccessV1Schema
>;

export const EngineeringDataReadResultPayloadV1Schema = z.discriminatedUnion("kind", [
  EngineeringReadSegmentSetSuccessV1Schema,
  EngineeringReadEvidenceSuccessV1Schema,
  EngineeringReadMonitoringSnapshotSuccessV1Schema,
]);
export type EngineeringDataReadResultPayloadV1 = z.infer<
  typeof EngineeringDataReadResultPayloadV1Schema
>;

export const EngineeringDataReadResultSuccessV1Schema = z.strictObject({
  kind: z.literal("read-result"),
  result: EngineeringDataReadResultPayloadV1Schema,
});
export type EngineeringDataReadResultSuccessV1 = z.infer<
  typeof EngineeringDataReadResultSuccessV1Schema
>;

// ---- engineering-data：catalog 查询与结果 ----

export const EngineeringDataCatalogQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "context-read",
    z.strictObject({}),
    branchCapability("engineering-data.context-read"),
  ),
  querySchema(
    "source-catalog",
    z.strictObject({
      cursor: c32ReadCursor.optional(),
      pageSize: c32ReadPageSize.optional(),
      documentType: c32ReadText.optional(),
    }),
    branchCapability("engineering-data.source-catalog"),
  ),
  querySchema(
    "monitoring-catalog",
    z.strictObject({
      monitoringSeriesRef: MonitoringSeriesRefV1Schema.optional(),
      cursor: c32ReadCursor.optional(),
      pageSize: c32ReadPageSize.optional(),
    }),
    branchCapability("engineering-data.monitoring-catalog"),
  ),
  querySchema(
    "read-result",
    z.strictObject({ queryResultRef: QueryResultRefV1Schema }),
    branchCapability("engineering-data.read-result"),
  ),
]);
export type EngineeringDataCatalogQueryV1 = z.infer<typeof EngineeringDataCatalogQueryV1Schema>;

export const EngineeringDataCatalogSuccessV1Schema = z.discriminatedUnion("kind", [
  EngineeringContextReadSuccessV1Schema,
  SourceCatalogPageV1Schema,
  MonitoringCatalogSeriesPageV1Schema,
  MonitoringCatalogSeriesDetailV1Schema,
  EngineeringDataReadResultSuccessV1Schema,
]);
export type EngineeringDataCatalogSuccessV1 = z.infer<typeof EngineeringDataCatalogSuccessV1Schema>;

export const EngineeringDataCatalogResultV1Schema = moduleResultSchema(
  EngineeringDataCatalogSuccessV1Schema,
);
export type EngineeringDataCatalogResultV1 = z.infer<typeof EngineeringDataCatalogResultV1Schema>;

// ---- knowledge-modeling：治理只读 ----

export const KnowledgeDefinitionRefV1Schema = versionedRef("knowledge-definition");
export type KnowledgeDefinitionRefV1 = z.infer<typeof KnowledgeDefinitionRefV1Schema>;

export const KNOWLEDGE_GOVERNANCE_LIFECYCLE_FILTER_V1_VALUES = [
  "draft",
  "in-review",
  "published",
  "deactivated",
] as const;
export const KnowledgeGovernanceLifecycleFilterV1Schema = z.enum(
  KNOWLEDGE_GOVERNANCE_LIFECYCLE_FILTER_V1_VALUES,
);
export type KnowledgeGovernanceLifecycleFilterV1 = z.infer<
  typeof KnowledgeGovernanceLifecycleFilterV1Schema
>;

export const KNOWLEDGE_REVISION_LIFECYCLE_STATUS_V1_VALUES = [
  "draft",
  "in-review",
  "approved",
  "rejected",
  "returned",
  "published",
] as const;
export const KnowledgeRevisionLifecycleStatusV1Schema = z.enum(
  KNOWLEDGE_REVISION_LIFECYCLE_STATUS_V1_VALUES,
);
export type KnowledgeRevisionLifecycleStatusV1 = z.infer<
  typeof KnowledgeRevisionLifecycleStatusV1Schema
>;

export const KnowledgeGovernanceListItemV1Schema = z.strictObject({
  definitionRef: KnowledgeDefinitionRefV1Schema,
  definitionType: KnowledgeDefinitionTypeV1Schema,
  lifecycleStatus: KnowledgeGovernanceLifecycleFilterV1Schema,
  currentRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
  currentReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  updatedAt: IsoDateTimeSchema,
});
export type KnowledgeGovernanceListItemV1 = z.infer<typeof KnowledgeGovernanceListItemV1Schema>;

const governanceApplicabilityConditions = z
  .array(
    z.strictObject({
      dimension: ApplicabilityMetadataDimensionSchema,
      values: z.array(IdentifierSchema).min(1).max(32),
    }),
  )
  .max(32);

export const GovernanceProcessModelNodeV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  inputs: z.array(IdentifierSchema).min(1),
  outputs: z.array(IdentifierSchema).min(1),
  equipmentRefs: z.array(EquipmentComponentSchema),
  structuralComponentRefs: z.array(StructuralComponentSchema),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  evidence: c32EvidenceList,
});
export type GovernanceProcessModelNodeV1 = z.infer<typeof GovernanceProcessModelNodeV1Schema>;

export const GovernanceProcessModelEdgeV1Schema = z.strictObject({
  edgeId: IdentifierSchema,
  fromNodeId: IdentifierSchema,
  toNodeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  evidence: c32EvidenceList,
});
export type GovernanceProcessModelEdgeV1 = z.infer<typeof GovernanceProcessModelEdgeV1Schema>;

export const GovernanceRiskMechanismEntryV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  mechanismType: RiskMechanismTypeSchema,
  nodeIds: z.array(IdentifierSchema).min(1),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  preconditions: z.array(IdentifierSchema).min(1),
  triggeringFactors: z.array(IdentifierSchema).min(1),
  evolutionPath: z.array(IdentifierSchema).min(1),
  consequences: z.array(IdentifierSchema).min(1),
  evidence: c32EvidenceList,
});
export type GovernanceRiskMechanismEntryV1 = z.infer<typeof GovernanceRiskMechanismEntryV1Schema>;

export const GovernanceScoringRuleMemberV1Schema = z.strictObject({
  rule: StructuredScoringRuleSchema,
  binding: z.strictObject({
    sourceVersionRef: SourceVersionRefV1Schema,
    evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(64),
  }),
});
export type GovernanceScoringRuleMemberV1 = z.infer<typeof GovernanceScoringRuleMemberV1Schema>;

export const GovernanceRuleSetIncludedMemberV1Schema = z.strictObject({
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  releaseRef: KnowledgeReleaseRefV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
});
export type GovernanceRuleSetIncludedMemberV1 = z.infer<
  typeof GovernanceRuleSetIncludedMemberV1Schema
>;

export const GovernanceRuleSetDecisionV1Schema = z.strictObject({
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  decision: z.enum(["included", "excluded"]),
  reasonCode: IdentifierSchema,
  matchedDimensions: z.array(ApplicabilityMetadataDimensionSchema).max(3),
  ruleReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  ruleRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
});
export type GovernanceRuleSetDecisionV1 = z.infer<typeof GovernanceRuleSetDecisionV1Schema>;

const governanceDecimal = z.string().regex(/^-?\d+(\.\d{1,6})?$/u);

export const GovernanceRiskMatrixAxisV1Schema = z.strictObject({
  bands: z
    .array(
      z.strictObject({
        bandId: IdentifierSchema,
        lower: governanceDecimal,
        upper: governanceDecimal,
      }),
    )
    .min(1)
    .max(32),
});
export type GovernanceRiskMatrixAxisV1 = z.infer<typeof GovernanceRiskMatrixAxisV1Schema>;

export const GovernanceMeasureEntryV1Schema = z.strictObject({
  measureId: IdentifierSchema,
  riskEventCategory: IdentifierSchema,
  applicabilityConditions: governanceApplicabilityConditions,
  triggerTypes: z.array(WarningTriggerTypeSchema).min(1),
  steps: z
    .array(
      z.strictObject({
        stepOrdinal: z.number().int().positive().max(32),
        instruction: c32ReadText,
      }),
    )
    .min(1)
    .max(32),
  resourceRequirements: z.array(IdentifierSchema).max(32),
  targetIndicatorIds: z.array(IdentifierSchema).min(1).max(64),
  evidenceRequirements: z.array(IdentifierSchema).min(1).max(32),
  contraindications: z.array(IdentifierSchema).max(32),
});
export type GovernanceMeasureEntryV1 = z.infer<typeof GovernanceMeasureEntryV1Schema>;

export const KnowledgeGovernanceReadBodyV1Schema = z.discriminatedUnion("definitionType", [
  z.strictObject({
    definitionType: z.literal("process-model"),
    nodes: z.array(GovernanceProcessModelNodeV1Schema).min(1).max(512),
    dependencyEdges: z.array(GovernanceProcessModelEdgeV1Schema).max(512),
  }),
  z.strictObject({
    definitionType: z.literal("risk-mechanism"),
    processModelReleaseRef: z.strictObject({
      kind: z.literal("process-model-release"),
      reference: VersionReferenceSchema,
    }),
    mechanisms: z.array(GovernanceRiskMechanismEntryV1Schema).min(1).max(512),
  }),
  z.strictObject({
    definitionType: z.literal("structured-scoring-rule"),
    members: z.array(GovernanceScoringRuleMemberV1Schema).min(1).max(512),
  }),
  z.strictObject({
    definitionType: z.literal("applicable-rule-set"),
    applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    applicability: ApplicabilityMetadataSchema,
    requiredAt: IsoDateTimeSchema,
    includedMembers: z.array(GovernanceRuleSetIncludedMemberV1Schema).min(1).max(512),
    decisions: z.array(GovernanceRuleSetDecisionV1Schema).min(1).max(512),
  }),
  z.strictObject({
    definitionType: z.literal("risk-matrix"),
    matrixId: IdentifierSchema,
    matrixVersion: IdentifierSchema,
    possibilityAxis: GovernanceRiskMatrixAxisV1Schema,
    consequenceAxis: GovernanceRiskMatrixAxisV1Schema,
    riskLevels: z
      .array(
        z.strictObject({
          levelId: IdentifierSchema,
          ordinal: z.number().int().positive().max(32),
        }),
      )
      .min(1)
      .max(32),
    cells: z
      .array(
        z.strictObject({
          possibilityBandId: IdentifierSchema,
          consequenceBandId: IdentifierSchema,
          riskLevelId: IdentifierSchema,
        }),
      )
      .min(1)
      .max(1024),
  }),
  z.strictObject({
    definitionType: z.literal("measure-library"),
    measures: z.array(GovernanceMeasureEntryV1Schema).min(1).max(256),
  }),
]);
export type KnowledgeGovernanceReadBodyV1 = z.infer<typeof KnowledgeGovernanceReadBodyV1Schema>;

export const KnowledgeGovernanceReadPayloadV1Schema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("list-definitions"),
    definitionType: KnowledgeDefinitionTypeV1Schema,
    lifecycleStatus: KnowledgeGovernanceLifecycleFilterV1Schema.optional(),
    keyword: z.string().trim().min(1).max(100).optional(),
    cursor: c32ReadCursor.optional(),
    pageSize: c32ReadPageSize.optional(),
  }),
  z.strictObject({
    operation: z.literal("read-definition-revision"),
    knowledgeRevisionRef: KnowledgeRevisionRefV1Schema,
  }),
  z.strictObject({
    operation: z.literal("read-definition-release"),
    knowledgeReleaseRef: KnowledgeReleaseRefV1Schema,
  }),
  z.strictObject({
    operation: z.literal("current-release-set"),
    requiredDefinitionTypes: z.array(KnowledgeDefinitionTypeV1Schema).max(32).optional(),
  }),
]);
export type KnowledgeGovernanceReadPayloadV1 = z.infer<
  typeof KnowledgeGovernanceReadPayloadV1Schema
>;

export const KnowledgeGovernanceReadQueryV1Schema = querySchema(
  "governance-read",
  KnowledgeGovernanceReadPayloadV1Schema,
  branchCapability("knowledge-modeling.governance-read"),
);
export type KnowledgeGovernanceReadQueryV1 = z.infer<typeof KnowledgeGovernanceReadQueryV1Schema>;

export const KnowledgeGovernanceReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("list-definitions"),
    items: z.array(KnowledgeGovernanceListItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
    totalCount: c32NonNegativeInt,
    nextCursor: c32ReadCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("read-definition-revision"),
    revisionRef: KnowledgeRevisionRefV1Schema,
    definitionRef: KnowledgeDefinitionRefV1Schema,
    definitionType: KnowledgeDefinitionTypeV1Schema,
    revisionStatus: KnowledgeRevisionLifecycleStatusV1Schema,
    evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
    body: KnowledgeGovernanceReadBodyV1Schema,
  }),
  z.strictObject({
    kind: z.literal("read-definition-release"),
    releaseRef: KnowledgeReleaseRefV1Schema,
    definitionRef: KnowledgeDefinitionRefV1Schema,
    definitionType: KnowledgeDefinitionTypeV1Schema,
    revisionRef: KnowledgeRevisionRefV1Schema,
    effectiveFrom: IsoDateTimeSchema,
    deactivatedAt: IsoDateTimeSchema.optional(),
    evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
    body: KnowledgeGovernanceReadBodyV1Schema,
  }),
  z.strictObject({
    kind: z.literal("current-release-set"),
    releases: z
      .array(
        z.strictObject({
          definitionType: KnowledgeDefinitionTypeV1Schema,
          releaseRef: KnowledgeReleaseRefV1Schema,
        }),
      )
      .max(32),
  }),
]);
export type KnowledgeGovernanceReadSuccessV1 = z.infer<
  typeof KnowledgeGovernanceReadSuccessV1Schema
>;

export const KnowledgeGovernanceReadResultV1Schema = moduleResultSchema(
  KnowledgeGovernanceReadSuccessV1Schema,
);
export type KnowledgeGovernanceReadResultV1 = z.infer<typeof KnowledgeGovernanceReadResultV1Schema>;

// ---- knowledge-modeling：检索结果再读取 ----

export const RetrievalReadMemberRefV1Schema = z.strictObject({
  kind: z.literal("retrieval-member"),
  reference: VersionReferenceSchema,
});
export type RetrievalReadMemberRefV1 = z.infer<typeof RetrievalReadMemberRefV1Schema>;

export const RetrievalReadHitV1Schema = z.strictObject({
  rank: z.number().int().positive(),
  memberRef: RetrievalReadMemberRefV1Schema,
  sourceKind: z.enum(["risk-mechanism", "standard-library", "case-library"]),
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  denseContribution: c32FiniteNumber.nonnegative(),
  bm25Contribution: c32FiniteNumber.nonnegative(),
  fusionScore: c32FiniteNumber,
  evidenceSourceVersionRefs: z.array(VersionReferenceSchema).max(16),
});
export type RetrievalReadHitV1 = z.infer<typeof RetrievalReadHitV1Schema>;

export const RetrievalReadHybridSuccessV1Schema = z.strictObject({
  kind: z.literal("hybrid-evidence"),
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
  policyRef: VersionReferenceSchema,
  generationRef: z.strictObject({
    kind: z.literal("retrieval-generation"),
    reference: VersionReferenceSchema,
  }),
  topK: z.number().int().positive(),
  hits: z.array(RetrievalReadHitV1Schema).max(100),
});
export type RetrievalReadHybridSuccessV1 = z.infer<typeof RetrievalReadHybridSuccessV1Schema>;

export const RetrievalReadContextNodeV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  inputs: z.array(IdentifierSchema).min(1),
  outputs: z.array(IdentifierSchema).min(1),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  evidence: z.array(EvidenceReferenceSchema).min(1),
});
export type RetrievalReadContextNodeV1 = z.infer<typeof RetrievalReadContextNodeV1Schema>;

export const RetrievalReadNeighborV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  edgeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  upstream: z.boolean(),
  evidence: z.array(EvidenceReferenceSchema).min(1),
});
export type RetrievalReadNeighborV1 = z.infer<typeof RetrievalReadNeighborV1Schema>;

export const RetrievalReadEdgeV1Schema = z.strictObject({
  edgeId: IdentifierSchema,
  fromNodeId: IdentifierSchema,
  toNodeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  evidence: z.array(EvidenceReferenceSchema).min(1),
});
export type RetrievalReadEdgeV1 = z.infer<typeof RetrievalReadEdgeV1Schema>;

export const RetrievalReadMechanismV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  mechanismType: RiskMechanismTypeSchema,
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  evidence: z.array(EvidenceReferenceSchema).min(1),
});
export type RetrievalReadMechanismV1 = z.infer<typeof RetrievalReadMechanismV1Schema>;

export const RetrievalReadRelationshipSuccessV1Schema = z.strictObject({
  kind: z.literal("relationship-context"),
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
  nodeId: IdentifierSchema,
  currentNode: RetrievalReadContextNodeV1Schema,
  neighborNodes: z.array(RetrievalReadNeighborV1Schema).max(64),
  dependencyEdges: z.array(RetrievalReadEdgeV1Schema).max(128),
  mechanisms: z.array(RetrievalReadMechanismV1Schema).max(128),
  excludedMechanisms: z
    .array(z.strictObject({ mechanismId: IdentifierSchema, reasonCode: IdentifierSchema }))
    .max(128),
  releaseBinding: z.strictObject({
    processModelReleaseRef: KnowledgeReleaseRefV1Schema,
    riskMechanismReleaseRef: KnowledgeReleaseRefV1Schema,
    retrievalEvidenceBaseReleaseRef: KnowledgeReleaseRefV1Schema,
  }),
});
export type RetrievalReadRelationshipSuccessV1 = z.infer<
  typeof RetrievalReadRelationshipSuccessV1Schema
>;

export const KnowledgeRetrievalReadQueryV1Schema = querySchema(
  "retrieval-result",
  z.strictObject({ knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema }),
  branchCapability("knowledge-modeling.retrieval-result"),
);
export type KnowledgeRetrievalReadQueryV1 = z.infer<typeof KnowledgeRetrievalReadQueryV1Schema>;

export const KnowledgeRetrievalReadSuccessV1Schema = z.discriminatedUnion("kind", [
  RetrievalReadHybridSuccessV1Schema,
  RetrievalReadRelationshipSuccessV1Schema,
]);
export type KnowledgeRetrievalReadSuccessV1 = z.infer<typeof KnowledgeRetrievalReadSuccessV1Schema>;

export const KnowledgeRetrievalReadResultV1Schema = moduleResultSchema(
  KnowledgeRetrievalReadSuccessV1Schema,
);
export type KnowledgeRetrievalReadResultV1 = z.infer<typeof KnowledgeRetrievalReadResultV1Schema>;

// ---- projection：结果读取 ----

export const ProjectionResultReadPageV1Schema = z.strictObject({
  kind: z.literal("page"),
  queryType: z.enum(["run-view", "trace-chain", "association-graph", "risk-overview"]),
  items: z.array(ProjectionResultItemV1Schema),
  nextCursor: z.string().max(512).optional(),
});
export type ProjectionResultReadPageV1 = z.infer<typeof ProjectionResultReadPageV1Schema>;

export const ProjectionResultReadQueryV1Schema = querySchema(
  "result-read",
  z.strictObject({
    queryResultRef: QueryResultRefV1Schema,
    cursor: c32ReadCursor.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  branchCapability("projection.result-read"),
);
export type ProjectionResultReadQueryV1 = z.infer<typeof ProjectionResultReadQueryV1Schema>;

export const ProjectionResultReadQueryResultV1Schema = moduleResultSchema(
  ProjectionResultReadPageV1Schema,
);
export type ProjectionResultReadQueryResultV1 = z.infer<
  typeof ProjectionResultReadQueryResultV1Schema
>;

// ---- C32 只读端口 ----

export interface EngineeringDataCatalogPortV1 {
  read(query: EngineeringDataCatalogQueryV1): Promise<EngineeringDataCatalogResultV1>;
}

export interface KnowledgeGovernanceReadPortV1 {
  read(query: KnowledgeGovernanceReadQueryV1): Promise<KnowledgeGovernanceReadResultV1>;
}

export interface KnowledgeRetrievalReadPortV1 {
  read(query: KnowledgeRetrievalReadQueryV1): Promise<KnowledgeRetrievalReadResultV1>;
}

// ---- C33：风险识别运行/记录与复核队列只读 ----

/**
 * 识别运行阶段闭合词汇（I0–I9，domain 主规格）：ports 受依赖方向约束不能反向引用
 * workflows 的 `IdentificationStageV1Schema`，取值必须与之一致，UI 不得自造阶段词汇。
 */
export const IDENTIFICATION_RUN_STAGE_V1_VALUES = [
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
] as const;
export const IdentificationRunStageV1Schema = z.enum(IDENTIFICATION_RUN_STAGE_V1_VALUES);
export type IdentificationRunStageV1 = z.infer<typeof IdentificationRunStageV1Schema>;

/** 验收方式：与验收路由种类（自动路线 / 人工复核路线）一一对应。 */
export const IDENTIFICATION_ACCEPTANCE_KIND_V1_VALUES = ["automatic", "review"] as const;
export const IdentificationAcceptanceKindV1Schema = z.enum(
  IDENTIFICATION_ACCEPTANCE_KIND_V1_VALUES,
);
export type IdentificationAcceptanceKindV1 = z.infer<typeof IdentificationAcceptanceKindV1Schema>;

/** 合并组在运行摘要中的归集状态：验收 / 待复核 / 拒收。 */
export const IDENTIFICATION_MERGE_GROUP_STATUS_V1_VALUES = [
  "accepted",
  "pending-review",
  "rejected",
] as const;
export const IdentificationMergeGroupStatusV1Schema = z.enum(
  IDENTIFICATION_MERGE_GROUP_STATUS_V1_VALUES,
);
export type IdentificationMergeGroupStatusV1 = z.infer<
  typeof IdentificationMergeGroupStatusV1Schema
>;

/** 复核队列任务状态：与复核运行时任务生命周期（待决定 / 已决定 / 已取代）一致。 */
export const REVIEW_QUEUE_TASK_STATUS_V1_VALUES = ["pending", "decided", "superseded"] as const;
export const ReviewQueueTaskStatusV1Schema = z.enum(REVIEW_QUEUE_TASK_STATUS_V1_VALUES);
export type ReviewQueueTaskStatusV1 = z.infer<typeof ReviewQueueTaskStatusV1Schema>;

export const RiskIdentificationRunListItemV1Schema = z.strictObject({
  runRef: WorkflowRunRefV1Schema,
  stage: IdentificationRunStageV1Schema,
  status: WorkflowRunStatusV1Schema,
  /** 触发原因仅在有登记事实时输出；识别运行登记行当前不存该字段，不得伪造。 */
  triggerReason: IdentifierSchema.optional(),
  startedBy: IdentifierSchema,
  startedAt: IsoDateTimeSchema,
  acceptedCount: c32NonNegativeInt,
  pendingReviewCount: c32NonNegativeInt,
  rejectedCount: c32NonNegativeInt,
});
export type RiskIdentificationRunListItemV1 = z.infer<typeof RiskIdentificationRunListItemV1Schema>;

export const RiskIdentificationRunListPageV1Schema = z.strictObject({
  kind: z.literal("run-list"),
  items: z.array(RiskIdentificationRunListItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
  nextCursor: c32ReadCursor.optional(),
});
export type RiskIdentificationRunListPageV1 = z.infer<typeof RiskIdentificationRunListPageV1Schema>;

/** I0–I9 阶段进度条目：失败阶段如实携带错误码与可重试标记，不把暂停或失败伪装为完成。 */
export const RiskIdentificationRunStageEntryV1Schema = z.strictObject({
  stage: IdentificationRunStageV1Schema,
  status: WorkflowRunStatusV1Schema,
  failureCode: IdentifierSchema.optional(),
  retryable: z.boolean().optional(),
});
export type RiskIdentificationRunStageEntryV1 = z.infer<
  typeof RiskIdentificationRunStageEntryV1Schema
>;

export const RiskIdentificationWorkItemCoverageV1Schema = z.strictObject({
  workItemRef: IdentificationWorkItemRefV1Schema,
  processNodeId: IdentifierSchema,
  status: WorkflowRunStatusV1Schema,
});
export type RiskIdentificationWorkItemCoverageV1 = z.infer<
  typeof RiskIdentificationWorkItemCoverageV1Schema
>;

export const RiskIdentificationMergeGroupSummaryV1Schema = z.strictObject({
  groupRef: IdentificationGroupRefV1Schema,
  status: IdentificationMergeGroupStatusV1Schema,
  acceptanceKind: IdentificationAcceptanceKindV1Schema.optional(),
});
export type RiskIdentificationMergeGroupSummaryV1 = z.infer<
  typeof RiskIdentificationMergeGroupSummaryV1Schema
>;

/** 运行详情摘要：引用有界集合 + 结果计数，可由精确运行版本重放。 */
export const RiskIdentificationRunReadSuccessV1Schema = z.strictObject({
  kind: z.literal("run-read"),
  runRef: WorkflowRunRefV1Schema,
  stage: IdentificationRunStageV1Schema,
  status: WorkflowRunStatusV1Schema,
  stageEntries: z.array(RiskIdentificationRunStageEntryV1Schema).max(10),
  workItemCoverage: z.array(RiskIdentificationWorkItemCoverageV1Schema).max(256),
  mergeGroups: z.array(RiskIdentificationMergeGroupSummaryV1Schema).max(256),
  agentTaskRefs: z.array(AgentTaskRefV1Schema).max(64),
  reviewTaskRefs: z.array(ReviewTaskRefV1Schema).max(64),
  resultCounts: z.strictObject({
    plannedWorkItemCount: c32NonNegativeInt,
    completedWorkItemCount: c32NonNegativeInt,
    failedWorkItemCount: c32NonNegativeInt,
    zeroResultCount: c32NonNegativeInt,
    acceptedCount: c32NonNegativeInt,
    pendingReviewCount: c32NonNegativeInt,
    rejectedCount: c32NonNegativeInt,
  }),
  acceptedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema).max(500),
  pendingReviewGroupRefs: z.array(IdentificationGroupRefV1Schema).max(256),
  rejectedGroupRefs: z.array(IdentificationGroupRefV1Schema).max(256),
  waitingRef: WaitingRefV1Schema.optional(),
});
export type RiskIdentificationRunReadSuccessV1 = z.infer<
  typeof RiskIdentificationRunReadSuccessV1Schema
>;

/** 记录目录条目：只含摘要与引用，不含七字段正文。 */
export const RiskRecordCatalogItemV1Schema = z.strictObject({
  riskRecordRef: StandardizedRiskRecordRefV1Schema,
  processNodeId: IdentifierSchema,
  riskEventSummary: c32ReadText,
  compositeConfidence: CompositeConfidenceSchema,
  acceptanceKind: IdentificationAcceptanceKindV1Schema,
  supersededBy: StandardizedRiskRecordRefV1Schema.optional(),
});
export type RiskRecordCatalogItemV1 = z.infer<typeof RiskRecordCatalogItemV1Schema>;

export const RiskRecordCatalogPageV1Schema = z.strictObject({
  kind: z.literal("record-catalog"),
  items: z.array(RiskRecordCatalogItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
  nextCursor: c32ReadCursor.optional(),
});
export type RiskRecordCatalogPageV1 = z.infer<typeof RiskRecordCatalogPageV1Schema>;

/** 记录详情：C01 七字段正文原样只读（含 evidenceLocator 与 modelConfidence），不改写识别事实。 */
export const RiskRecordReadSuccessV1Schema = z.strictObject({
  kind: z.literal("record-read"),
  riskRecordRef: StandardizedRiskRecordRefV1Schema,
  record: StandardizedRiskRecordSchema,
  riskMechanismEntryIds: z.array(IdentifierSchema).min(1).max(64),
  sourceSegmentIds: z.array(IdentifierSchema).min(1).max(256),
  compositeConfidence: CompositeConfidenceSchema,
  /** 验收决定引用：自动路线为系统路由决定，人工路线为已成立的复核决定。 */
  acceptanceDecisionRef: z.discriminatedUnion("kind", [
    RouteDecisionRefV1Schema,
    ReviewDecisionRefV1Schema,
  ]),
  identificationRunRef: WorkflowRunRefV1Schema,
  supersededBy: StandardizedRiskRecordRefV1Schema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
});
export type RiskRecordReadSuccessV1 = z.infer<typeof RiskRecordReadSuccessV1Schema>;

export const RiskIdentificationReadQueryV1Schema = z.discriminatedUnion("kind", [
  querySchema(
    "run-list",
    z.strictObject({
      cursor: c32ReadCursor.optional(),
      pageSize: c32ReadPageSize.optional(),
      status: WorkflowRunStatusV1Schema.optional(),
    }),
    branchCapability("risk-identification.run-list"),
  ),
  querySchema(
    "run-read",
    z.strictObject({ runRef: WorkflowRunRefV1Schema }),
    branchCapability("risk-identification.run-read"),
  ),
  querySchema(
    "record-catalog",
    z.strictObject({
      cursor: c32ReadCursor.optional(),
      pageSize: c32ReadPageSize.optional(),
      processNodeId: IdentifierSchema.optional(),
      acceptanceKind: IdentificationAcceptanceKindV1Schema.optional(),
      identificationRunRef: WorkflowRunRefV1Schema.optional(),
    }),
    branchCapability("risk-identification.record-catalog"),
  ),
  querySchema(
    "record-read",
    z.strictObject({ riskRecordRef: StandardizedRiskRecordRefV1Schema }),
    branchCapability("risk-identification.record-read"),
  ),
]);
export type RiskIdentificationReadQueryV1 = z.infer<typeof RiskIdentificationReadQueryV1Schema>;

export const RiskIdentificationReadSuccessV1Schema = z.discriminatedUnion("kind", [
  RiskIdentificationRunListPageV1Schema,
  RiskIdentificationRunReadSuccessV1Schema,
  RiskRecordCatalogPageV1Schema,
  RiskRecordReadSuccessV1Schema,
]);
export type RiskIdentificationReadSuccessV1 = z.infer<typeof RiskIdentificationReadSuccessV1Schema>;

export const RiskIdentificationReadResultV1Schema = moduleResultSchema(
  RiskIdentificationReadSuccessV1Schema,
);
export type RiskIdentificationReadResultV1 = z.infer<typeof RiskIdentificationReadResultV1Schema>;

export interface RiskIdentificationReadPortV1 {
  read(query: RiskIdentificationReadQueryV1): Promise<RiskIdentificationReadResultV1>;
}

// ---- C33：复核队列只读 ----

/** 队列条目携带完整 ReviewTaskRefV1，可直接作为既有 decide-review 命令的 reviewTaskRef。 */
export const ReviewQueueItemV1Schema = z.strictObject({
  reviewTaskRef: ReviewTaskRefV1Schema,
  reviewType: ReviewTypeV1Schema,
  /** 触发原因仅在有登记事实时输出；review_tasks 登记行当前不存该字段，不得伪造。 */
  triggerReason: IdentifierSchema.optional(),
  submittedAt: IsoDateTimeSchema,
  status: ReviewQueueTaskStatusV1Schema,
  /** 目标版本已被取代时由拥有方计算置真，调用方无需自行比对版本。 */
  stale: z.boolean(),
});
export type ReviewQueueItemV1 = z.infer<typeof ReviewQueueItemV1Schema>;

export const ReviewQueuePageV1Schema = z.strictObject({
  kind: z.literal("queue-read"),
  items: z.array(ReviewQueueItemV1Schema).max(C32_READ_PAGE_SIZE_MAX_V1),
  nextCursor: c32ReadCursor.optional(),
});
export type ReviewQueuePageV1 = z.infer<typeof ReviewQueuePageV1Schema>;

export const ReviewQueueReadQueryV1Schema = querySchema(
  "queue-read",
  z.strictObject({
    reviewType: ReviewTypeV1Schema.optional(),
    status: ReviewQueueTaskStatusV1Schema.optional(),
    cursor: c32ReadCursor.optional(),
    pageSize: c32ReadPageSize.optional(),
  }),
  branchCapability("review-audit.queue-read"),
);
export type ReviewQueueReadQueryV1 = z.infer<typeof ReviewQueueReadQueryV1Schema>;

export const ReviewQueueReadResultV1Schema = moduleResultSchema(ReviewQueuePageV1Schema);
export type ReviewQueueReadResultV1 = z.infer<typeof ReviewQueueReadResultV1Schema>;

export interface ReviewQueueReadPortV1 {
  read(query: ReviewQueueReadQueryV1): Promise<ReviewQueueReadResultV1>;
}

/* ========================================================================
 * C34：评估/预警处置只读查询与校准治理（design D-03～D-05、D-08）
 *
 * 两个公共只读端口按 `operation` 判别 payload，顶层查询信封与 moduleResult 沿用既有形状。
 * 解释 view 是只读选取/关联 DTO，不是新业务记录：字段全部投影既有 Schema 或登记列，
 * 映射名集中在本文件，所属模块各自只读自己的表。
 * ======================================================================== */

const C34_READ_PAGE_SIZE_MAX_V1 = C32_READ_PAGE_SIZE_MAX_V1;
const c34ReadPageSize = c32ReadPageSize;
const c34ReadCursor = c32ReadCursor;
const c34ReadText = c32ReadText;
const c34NonNegativeInt = c32NonNegativeInt;

/**
 * 动作可用性（design D-06）：授权检查只产生安全呈现元数据，不执行领域命令。
 * `hidden` 不渲染，`denied` 原生 disabled，`business-unavailable` 显示原因；
 * 不得用单一读 capability 推断所有写能力。
 */
export const READ_ACTION_AVAILABILITY_V1_VALUES = [
  "allowed",
  "denied",
  "business-unavailable",
  "hidden",
] as const;
export const ReadActionAvailabilityV1Schema = z.enum(READ_ACTION_AVAILABILITY_V1_VALUES);
export type ReadActionAvailabilityV1 = z.infer<typeof ReadActionAvailabilityV1Schema>;

export const ReadActionV1Schema = z.strictObject({
  branch: ModuleBranchV1Schema,
  availability: ReadActionAvailabilityV1Schema,
  reasonCode: IdentifierSchema.optional(),
});
export type ReadActionV1 = z.infer<typeof ReadActionV1Schema>;

const readActionsV1 = z.array(ReadActionV1Schema).max(8);

/** 部署注入的精确运行策略（design D-04）：不存在合格部署配置时 unavailable，不替用户补默认引用。 */
const entryRunPolicyV1 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("available"),
    graphVersion: VersionReferenceSchema,
    retryPolicyRef: ContractReferenceV1Schema,
  }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
]);

// ---- C11：评估启动输入候选窄读（design D-04） ----

export const ASSESSMENT_ENTRY_CONTEXT_OPERATIONS_V1 = [
  "applicability-catalog",
  "external-event-catalog",
] as const;
export const AssessmentEntryContextOperationV1Schema = z.enum(
  ASSESSMENT_ENTRY_CONTEXT_OPERATIONS_V1,
);
export type AssessmentEntryContextOperationV1 = z.infer<
  typeof AssessmentEntryContextOperationV1Schema
>;

/** 适用性快照候选：直接复用登记快照引用与适用性元数据正文。 */
export const ApplicabilityCatalogItemV1Schema = z.strictObject({
  snapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  metadata: ApplicabilityMetadataSchema,
});
export type ApplicabilityCatalogItemV1 = z.infer<typeof ApplicabilityCatalogItemV1Schema>;

/** 外部事件候选：只给精确引用与证据，不返回事件工件正文。 */
export const ExternalEventCatalogItemV1Schema = z.strictObject({
  riskInput: ExternalRiskEventRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(256),
});
export type ExternalEventCatalogItemV1 = z.infer<typeof ExternalEventCatalogItemV1Schema>;

export const AssessmentEntryContextReadQueryV1Schema = querySchema(
  "read-assessment-entry-context",
  z.strictObject({
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    operation: AssessmentEntryContextOperationV1Schema,
    pageSize: c34ReadPageSize.optional(),
    cursor: c34ReadCursor.optional(),
  }),
  branchCapability("engineering-data.context-read"),
);
export type AssessmentEntryContextReadQueryV1 = z.infer<
  typeof AssessmentEntryContextReadQueryV1Schema
>;

export const AssessmentEntryContextReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("applicability-catalog"),
    items: z.array(ApplicabilityCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("external-event-catalog"),
    items: z.array(ExternalEventCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
  }),
]);
export type AssessmentEntryContextReadSuccessV1 = z.infer<
  typeof AssessmentEntryContextReadSuccessV1Schema
>;

export const AssessmentEntryContextReadResultV1Schema = moduleResultSchema(
  AssessmentEntryContextReadSuccessV1Schema,
);
export type AssessmentEntryContextReadResultV1 = z.infer<
  typeof AssessmentEntryContextReadResultV1Schema
>;

export interface AssessmentEntryContextReadPortV1 {
  read(query: AssessmentEntryContextReadQueryV1): Promise<AssessmentEntryContextReadResultV1>;
}

// ---- C25：风险评估只读（design D-04） ----

export const RISK_ASSESSMENT_READ_OPERATIONS_V1 = [
  "pending-catalog",
  "entry-context",
  "record-catalog",
  "record-read",
  "reassessment-history",
  "overview",
  "resolve",
  "run-read",
] as const;
export const RiskAssessmentReadOperationV1Schema = z.enum(RISK_ASSESSMENT_READ_OPERATIONS_V1);
export type RiskAssessmentReadOperationV1 = z.infer<typeof RiskAssessmentReadOperationV1Schema>;

/** 评估拥有方按精确 refs 判断是否已有评估；未评估不依赖界面猜测。 */
export const ASSESSMENT_STATE_V1_VALUES = ["unassessed", "assessed"] as const;
export const AssessmentStateV1Schema = z.enum(ASSESSMENT_STATE_V1_VALUES);
export type AssessmentStateV1 = z.infer<typeof AssessmentStateV1Schema>;

export const PendingRiskItemV1Schema = z.strictObject({
  riskInput: RiskInputVersionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  assessmentState: AssessmentStateV1Schema,
  lastAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(256),
});
export type PendingRiskItemV1 = z.infer<typeof PendingRiskItemV1Schema>;

/** 两个独立目录各自游标；不用单一游标同步两类集合。 */
export const AssessmentEntryContextViewV1Schema = z.strictObject({
  actorId: IdentifierSchema,
  projectId: IdentifierSchema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  riskInput: RiskInputVersionRefV1Schema.optional(),
  applicabilityItems: z.array(ApplicabilityCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
  externalEventItems: z.array(ExternalEventCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
  applicabilityNextCursor: c34ReadCursor.optional(),
  externalEventNextCursor: c34ReadCursor.optional(),
  runPolicy: entryRunPolicyV1,
  actions: readActionsV1,
});
export type AssessmentEntryContextViewV1 = z.infer<typeof AssessmentEntryContextViewV1Schema>;

/**
 * 重评原因（design D-03、D-12）：唯一事实源在 vocabulary 的
 * `WorkflowReassessmentReasonV1Schema`，此处只作同一 Schema 的导出别名，
 * 保证工作流 `reassess` 入口与 C34 只读解释不会各写一份枚举。
 */
export const AssessmentReassessmentReasonV1Schema = WorkflowReassessmentReasonV1Schema;
export type AssessmentReassessmentReasonV1 = z.infer<
  typeof AssessmentReassessmentReasonV1Schema
>;

/**
 * 重评入口不可变事实（design D-12）：前驱、原因与变化引用直接保存为入口身份的一部分，
 * 不得从 `frozenRefs` 反推。`StartWorkflowPayloadV1Schema` 的 `reassess` 变体与
 * C30 内部运行元数据（`run-state` 工件的 `reassessmentEntry`）直接复用此 shape。
 * 1..64 项边界在启动前校验，越界拒绝而不截断。
 */
export const WORKFLOW_REASSESSMENT_INPUT_MAX_V1 = 64;
export const WorkflowReassessmentInputV1Schema = z.strictObject({
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  reason: WorkflowReassessmentReasonV1Schema,
  changedInputRefs: z
    .array(ContractReferenceV1Schema)
    .min(1)
    .max(WORKFLOW_REASSESSMENT_INPUT_MAX_V1),
});
export type WorkflowReassessmentInputV1 = z.infer<typeof WorkflowReassessmentInputV1Schema>;

/** 矩阵落点只取保存的决策工件；页面不重算分带、不用当前矩阵解释历史。 */
export const AssessmentMatrixPlotV1Schema = z.strictObject({
  riskMatrixRef: VersionReferenceSchema,
  possibilityBandId: IdentifierSchema,
  consequenceBandId: IdentifierSchema,
  riskLevelId: IdentifierSchema,
  riskLevelOrdinal: z.number().int().positive().max(32),
});
export type AssessmentMatrixPlotV1 = z.infer<typeof AssessmentMatrixPlotV1Schema>;

/** 目录条目只含摘要与冻结落点，正文由 record-read 解释。 */
export const AssessmentRecordCatalogItemV1Schema = z.strictObject({
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  occurredAt: IsoDateTimeSchema,
  likelihoodScore: z.number().finite(),
  consequenceScore: z.number().finite(),
  riskState: IdentifierSchema,
  matrixPlot: AssessmentMatrixPlotV1Schema,
});
export type AssessmentRecordCatalogItemV1 = z.infer<typeof AssessmentRecordCatalogItemV1Schema>;

/** 重评历史条目：原因与变化引用取 C30 保存的入口事实，不返回虚构变化摘要。 */
export const ReassessmentHistoryItemV1Schema = z.strictObject({
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  reason: AssessmentReassessmentReasonV1Schema.optional(),
  changedInputRefs: z.array(ContractReferenceV1Schema).max(64),
  occurredAt: IsoDateTimeSchema,
  likelihoodScore: z.number().finite(),
  consequenceScore: z.number().finite(),
  riskState: IdentifierSchema,
  matrixPlot: AssessmentMatrixPlotV1Schema,
});
export type ReassessmentHistoryItemV1 = z.infer<typeof ReassessmentHistoryItemV1Schema>;

/** 指标解释：实际值来自保存的实际值集，规则/等级/基准分来自同记录的规则引用。 */
export const AssessmentIndicatorExplanationV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  actualValue: ScalarValueSchema,
  canonicalValue: c34ReadText,
  canonicalUnit: c34ReadText.optional(),
  sourceReferences: z.array(ContractReferenceV1Schema).max(16),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  grade: IdentifierSchema,
  baseScore: c34ReadText,
});
export type AssessmentIndicatorExplanationV1 = z.infer<
  typeof AssessmentIndicatorExplanationV1Schema
>;

export const AssessmentAxisContributionV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  baseScore: c34ReadText,
  weightedScore: c34ReadText,
  basisPoints: c34NonNegativeInt.optional(),
});
export type AssessmentAxisContributionV1 = z.infer<typeof AssessmentAxisContributionV1Schema>;

export const AssessmentAxisV1Schema = z.strictObject({
  strategy: z.enum(["weighted-average", "maximum"]),
  score: c34ReadText,
  publicScore: z.number().finite(),
  weightSetRef: VersionReferenceSchema.optional(),
  contributions: z.array(AssessmentAxisContributionV1Schema).max(512),
});
export type AssessmentAxisV1 = z.infer<typeof AssessmentAxisV1Schema>;

/** 触发事实只从保存的 trigger facts 选取，不新增越限方向算法。 */
export const AssessmentTriggerFactExplanationV1Schema = z.strictObject({
  triggerType: WarningTriggerTypeSchema,
  indicatorItem: IdentifierSchema,
  actualValue: ScalarValueSchema.optional(),
  thresholdId: IdentifierSchema.optional(),
  thresholdValue: c34ReadText.optional(),
  jointRuleId: IdentifierSchema.optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
});
export type AssessmentTriggerFactExplanationV1 = z.infer<
  typeof AssessmentTriggerFactExplanationV1Schema
>;

/** 决策工件的七项原引用：规则与权重不是客户端推导。 */
export const AssessmentConfigurationRefsV1Schema = z.strictObject({
  indicatorSystemRef: VersionReferenceSchema,
  indicatorFieldMappingRef: VersionReferenceSchema,
  weightSetRef: VersionReferenceSchema,
  scoringStrategyRef: VersionReferenceSchema,
  riskAcceptanceThresholdRef: VersionReferenceSchema,
  monitoringWarningThresholdRef: VersionReferenceSchema,
  jointTriggerPolicyRef: VersionReferenceSchema,
});
export type AssessmentConfigurationRefsV1 = z.infer<typeof AssessmentConfigurationRefsV1Schema>;

export const AssessmentRecordViewV1Schema = z.strictObject({
  actorId: IdentifierSchema,
  record: RiskAssessmentRecordSchema,
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  preparationSnapshotRef: ContractReferenceV1Schema,
  inputSnapshotRef: ContractReferenceV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
  reassessmentReason: AssessmentReassessmentReasonV1Schema.optional(),
  changedInputRefs: z.array(ContractReferenceV1Schema).max(64),
  applicability: ApplicabilityMetadataSchema,
  configurationRefs: AssessmentConfigurationRefsV1Schema,
  indicators: z.array(AssessmentIndicatorExplanationV1Schema).max(512),
  axes: z.strictObject({
    possibility: AssessmentAxisV1Schema,
    consequence: AssessmentAxisV1Schema,
  }),
  matrixPlot: AssessmentMatrixPlotV1Schema,
  triggerFacts: z.array(AssessmentTriggerFactExplanationV1Schema).max(1024),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
  auditTrailRef: AuditTrailRefV1Schema,
  actions: readActionsV1,
});
export type AssessmentRecordViewV1 = z.infer<typeof AssessmentRecordViewV1Schema>;

/** 总览只按所选工程/空间的已入库评估记录版本统计，不声称识别风险总数。 */
export const AssessmentOverviewViewV1Schema = z.strictObject({
  actorId: IdentifierSchema,
  projectId: IdentifierSchema,
  spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  recordedAssessmentCount: c34NonNegativeInt,
  riskLevelCounts: z
    .array(
      z.strictObject({ riskLevel: IdentifierSchema, count: c34NonNegativeInt }),
    )
    .max(32),
  asOf: IsoDateTimeSchema,
  actions: readActionsV1,
});
export type AssessmentOverviewViewV1 = z.infer<typeof AssessmentOverviewViewV1Schema>;

export const AssessmentRunStageV1Schema = z.strictObject({
  stageCode: IdentifierSchema,
  state: IdentifierSchema,
  stageResultRef: ContractReferenceV1Schema.optional(),
});
export type AssessmentRunStageV1 = z.infer<typeof AssessmentRunStageV1Schema>;

export const AssessmentRunViewV1Schema = z.strictObject({
  actorId: IdentifierSchema,
  runRef: WorkflowRunRefV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  status: WorkflowRunStatusV1Schema,
  stage: IdentifierSchema,
  graphVersion: VersionReferenceSchema,
  actorRef: IdentifierSchema,
  startedAt: IsoDateTimeSchema,
  stateVersion: VersionReferenceSchema,
  stages: z.array(AssessmentRunStageV1Schema).max(10),
  resultRefs: z.array(ContractReferenceV1Schema).max(50),
  reviewTaskRefs: z.array(ReviewTaskRefV1Schema).max(50),
  assessmentRunRefs: z.array(WorkflowRunRefV1Schema).max(50),
  selectedAssessmentRunRef: WorkflowRunRefV1Schema.optional(),
  error: ContractReferenceV1Schema.optional(),
  nextCursor: c34ReadCursor.optional(),
  actions: readActionsV1,
});
export type AssessmentRunViewV1 = z.infer<typeof AssessmentRunViewV1Schema>;

const riskAssessmentReadOperationPayloadV1 = z.discriminatedUnion("operation", [
  z.strictObject({
      operation: z.literal("pending-catalog"),
      riskInputKind: z.enum(["risk-record", "external-risk-event"]),
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
      pageSize: c34ReadPageSize.optional(),
      cursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("entry-context"),
      projectRevisionRef: ProjectRevisionRefV1Schema,
      spatialScopeRef: SpatialScopeRefV1Schema,
      riskInput: RiskInputVersionRefV1Schema.optional(),
      pageSize: c34ReadPageSize.optional(),
      applicabilityCursor: c34ReadCursor.optional(),
      externalEventCursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("record-catalog"),
      riskInput: RiskInputVersionRefV1Schema.optional(),
      entryMode: WorkflowEntryModeV1Schema.optional(),
      riskMatrixVersion: VersionReferenceSchema.optional(),
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
      pageSize: c34ReadPageSize.optional(),
      cursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("record-read"), assessmentRecordRef: RiskAssessmentRecordRefV1Schema }),
  z.strictObject({
      operation: z.literal("reassessment-history"),
      riskInput: RiskInputVersionRefV1Schema,
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
      pageSize: c34ReadPageSize.optional(),
      cursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("overview"),
      projectRevisionRef: ProjectRevisionRefV1Schema,
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
    }),
  z.strictObject({
      operation: z.literal("resolve"),
      entityId: IdentifierSchema,
      targetKind: z.enum(["record", "run"]),
      versionId: IdentifierSchema.optional(),
    }),
  z.strictObject({
      operation: z.literal("run-read"),
      workflowRunRef: WorkflowRunRefV1Schema,
      assessmentRunRef: WorkflowRunRefV1Schema.optional(),
      resultCursor: c34ReadCursor.optional(),
      reviewTaskCursor: c34ReadCursor.optional(),
    }),
]);

export const RiskAssessmentReadQueryV1Schema = querySchema(
  "read",
  riskAssessmentReadOperationPayloadV1,
  branchCapability("risk-assessment.read"),
);;
export type RiskAssessmentReadQueryV1 = z.infer<typeof RiskAssessmentReadQueryV1Schema>;

export const RiskAssessmentReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pending-catalog"),
    actorId: IdentifierSchema,
    items: z.array(PendingRiskItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({ kind: z.literal("entry-context"), ...AssessmentEntryContextViewV1Schema.shape }),
  z.strictObject({
    kind: z.literal("record-catalog"),
    actorId: IdentifierSchema,
    items: z.array(AssessmentRecordCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({ kind: z.literal("record-read"), ...AssessmentRecordViewV1Schema.shape }),
  z.strictObject({
    kind: z.literal("reassessment-history"),
    actorId: IdentifierSchema,
    items: z.array(ReassessmentHistoryItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({ kind: z.literal("overview"), ...AssessmentOverviewViewV1Schema.shape }),
  z.strictObject({
    kind: z.literal("resolve"),
    actorId: IdentifierSchema,
    targetKind: z.enum(["record", "run"]),
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
    workflowRunRef: WorkflowRunRefV1Schema.optional(),
  }),
  z.strictObject({ kind: z.literal("run-read"), ...AssessmentRunViewV1Schema.shape }),
]);
export type RiskAssessmentReadSuccessV1 = z.infer<typeof RiskAssessmentReadSuccessV1Schema>;

export const RiskAssessmentReadResultV1Schema = moduleResultSchema(
  RiskAssessmentReadSuccessV1Schema,
);
export type RiskAssessmentReadResultV1 = z.infer<typeof RiskAssessmentReadResultV1Schema>;

export interface RiskAssessmentReadPortV1 {
  read(query: RiskAssessmentReadQueryV1): Promise<RiskAssessmentReadResultV1>;
}

// ---- C26：预警处置只读（design D-05） ----

export const WARNING_RESPONSE_READ_OPERATIONS_V1 = [
  "warning-catalog",
  "task-catalog",
  "overview",
  "warning-read",
  "task-read",
  "recommendation-read",
  "forecast-read",
  "execution-read",
  "feedback-read",
  "calibration-read",
  "resolve",
] as const;
export const WarningResponseReadOperationV1Schema = z.enum(
  WARNING_RESPONSE_READ_OPERATIONS_V1,
);
export type WarningResponseReadOperationV1 = z.infer<typeof WarningResponseReadOperationV1Schema>;

/**
 * 预测/偏差不可用使用 unavailable+reasonCode；只有 available 分支才允许数值或风险状态。
 * 不伪造趋势曲线，不以当前阈值补齐冻结偏差策略正文。
 */
const forecastAvailabilityV1 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("available"),
    predictedValue: ScalarValueSchema,
    predictedRiskState: IdentifierSchema,
  }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
]);

/** 通知披露最小集：意图与投递分离，投递由已登记 delivered 行证明。 */
export const WarningNotificationDisclosureV1Schema = z.strictObject({
  intentRef: ContractReferenceV1Schema,
  recipientActorId: IdentifierSchema,
  channel: IdentifierSchema,
  recordedAt: IsoDateTimeSchema,
  deliveredAt: IsoDateTimeSchema.optional(),
});
export type WarningNotificationDisclosureV1 = z.infer<
  typeof WarningNotificationDisclosureV1Schema
>;

export const WarningAcknowledgementViewV1Schema = z.strictObject({
  actorId: IdentifierSchema,
  acknowledgedAt: IsoDateTimeSchema,
  auditTrailRef: AuditTrailRefV1Schema,
});
export type WarningAcknowledgementViewV1 = z.infer<typeof WarningAcknowledgementViewV1Schema>;

export const WarningCatalogItemV1Schema = z.strictObject({
  warningRecordRef: WarningRecordRefV1Schema,
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  taskRef: WarningResponseTaskRefV1Schema,
  triggerType: WarningTriggerTypeSchema,
  warningLevel: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  acknowledged: z.boolean(),
});
export type WarningCatalogItemV1 = z.infer<typeof WarningCatalogItemV1Schema>;

export const WarningTaskCatalogItemV1Schema = z.strictObject({
  taskRef: WarningResponseTaskRefV1Schema,
  status: WarningResponseTaskStatusV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  warningCount: c34NonNegativeInt,
  occurredAt: IsoDateTimeSchema,
});
export type WarningTaskCatalogItemV1 = z.infer<typeof WarningTaskCatalogItemV1Schema>;

/** 处置任务关系集合：由各所属接缝分别提供，不跨域反查。 */
export const WarningTaskRelationsV1Schema = z.strictObject({
  warningRefs: z.array(WarningRecordRefV1Schema).max(50),
  recommendationRefs: z.array(ResponseRecommendationRefV1Schema).max(50),
  decisionRefs: z.array(RouteDecisionRefV1Schema).max(50),
  executionRefs: z.array(ExecutionRecordRefV1Schema).max(50),
  forecastRefs: z.array(EffectForecastRefV1Schema).max(50),
  feedbackRefs: z.array(FeedbackRefV1Schema).max(50),
  calibrationRefs: z.array(CalibrationSuggestionRefV1Schema).max(50),
  warningNextCursor: c34ReadCursor.optional(),
  recommendationNextCursor: c34ReadCursor.optional(),
  decisionNextCursor: c34ReadCursor.optional(),
  executionNextCursor: c34ReadCursor.optional(),
  forecastNextCursor: c34ReadCursor.optional(),
  feedbackNextCursor: c34ReadCursor.optional(),
  calibrationNextCursor: c34ReadCursor.optional(),
});
export type WarningTaskRelationsV1 = z.infer<typeof WarningTaskRelationsV1Schema>;

export const RecommendationValidationResultV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  pass: z.boolean(),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
  reasonCode: IdentifierSchema.optional(),
});
export type RecommendationValidationResultV1 = z.infer<
  typeof RecommendationValidationResultV1Schema
>;

/**
 * 偏差只读解释（design D-03、D-05）：C28 私有计算偏差按其原 Schema 解析后映射为此 DTO。
 * 私有计算视图不冒充公共偏差记录，也不把字段写回公共正文；两者只通过精确偏差引用关联。
 * 冻结阈值正文由页面按 `deviationPolicyRef` 独立读取，不在此处补齐。
 */
export const DeviationViewV1Schema = z.strictObject({
  deviationPolicyRef: ContractReferenceV1Schema,
  basis: IdentifierSchema,
  targetIndicatorId: IdentifierSchema,
  unit: c34ReadText,
  predictedValue: ScalarValueSchema,
  actualValue: ScalarValueSchema,
  deviationValue: ScalarValueSchema,
  thresholdExceeded: z.boolean(),
  direction: IdentifierSchema,
  riskMatrixRef: VersionReferenceSchema,
  predictedRiskState: IdentifierSchema,
  actualRiskState: IdentifierSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
  computedAt: IsoDateTimeSchema,
});
export type DeviationViewV1 = z.infer<typeof DeviationViewV1Schema>;

/**
 * 六类类型化校准变化摘要（design D-05）：按 core 操作解析后投影，
 * replacement 直接复用既有 ScoringThresholdSchema / GradeIntervalSchema。
 * 候选工件精确引用提供完整重建入口，摘要不能作为写命令 payload。
 */
/**
 * 比较形状（design D-03）：单边分支取自 vocabulary 比较算子的闭合集减去 `outside`，
 * `outside` 自带 lower/upper，绝不混入单边 boundary 变体。
 */
const singleSidedComparisonOperatorV1 = COMPARISON_OPERATOR_VALUES.filter(
  (operator) => operator !== "outside",
);
const calibrationComparisonV1 = z.discriminatedUnion("operator", [
  z.strictObject({
    operator: z.enum(singleSidedComparisonOperatorV1),
    boundary: c34ReadText,
  }),
  z.strictObject({
    operator: z.literal("outside"),
    lower: c34ReadText,
    upper: c34ReadText,
  }),
]);

export const CalibrationChangeSummaryV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("replace-weight-entry"),
    axis: z.enum(["possibility", "consequence"]),
    indicatorId: IdentifierSchema,
    basisPoints: c34NonNegativeInt,
  }),
  z.strictObject({
    kind: z.literal("replace-risk-matrix-band"),
    axis: z.enum(["possibility", "consequence"]),
    bandId: IdentifierSchema,
    lower: c34ReadText,
    upper: c34ReadText,
  }),
  z.strictObject({
    kind: z.literal("replace-risk-acceptance-threshold"),
    thresholdId: IdentifierSchema,
    maximumAcceptedLevelId: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("replace-monitoring-warning-threshold"),
    thresholdId: IdentifierSchema,
    monitoringIndicator: MonitoringIndicatorSchema,
    parameterCode: c34ReadText.optional(),
    metric: c34ReadText.optional(),
    unit: c34ReadText.optional(),
    comparison: calibrationComparisonV1,
    warningLevelId: IdentifierSchema,
  }),
  z.discriminatedUnion("basis", [
    z.strictObject({
      kind: z.literal("replace-deviation-policy"),
      basis: z.literal("threshold"),
      policyId: IdentifierSchema,
      threshold: c34ReadText,
    }),
    z.strictObject({
      kind: z.literal("replace-deviation-policy"),
      basis: z.literal("minimum-baseline"),
      policyId: IdentifierSchema,
      threshold: c34ReadText,
      minimumBaseline: c34ReadText,
    }),
    z.strictObject({
      kind: z.literal("replace-deviation-policy"),
      basis: z.literal("level-step"),
      policyId: IdentifierSchema,
      levelStep: c34ReadText,
      riskMatrixRef: VersionReferenceSchema,
    }),
  ]),
  z.strictObject({
    kind: z.literal("replace-scoring-rule-interval"),
    ruleId: IdentifierSchema,
    replacement: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("threshold"), threshold: ScoringThresholdSchema }),
      z.strictObject({ kind: z.literal("grade-interval"), interval: GradeIntervalSchema }),
    ]),
  }),
]);
export type CalibrationChangeSummaryV1 = z.infer<typeof CalibrationChangeSummaryV1Schema>;

export const CalibrationOperationValidationV1Schema = z.strictObject({
  operation: CalibrationChangeSummaryV1Schema,
  valid: z.boolean(),
  reasonCode: IdentifierSchema.optional(),
});
export type CalibrationOperationValidationV1 = z.infer<
  typeof CalibrationOperationValidationV1Schema
>;

const warningResponseReadOperationPayloadV1 = z.discriminatedUnion("operation", [
  z.strictObject({
      operation: z.literal("warning-catalog"),
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
      triggerType: WarningTriggerTypeSchema.optional(),
      pageSize: c34ReadPageSize.optional(),
      cursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("task-catalog"),
      spatialScopeRef: SpatialScopeRefV1Schema.optional(),
      status: WarningResponseTaskStatusV1Schema.optional(),
      pageSize: c34ReadPageSize.optional(),
      cursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("overview"), spatialScopeRef: SpatialScopeRefV1Schema.optional() }),
  z.strictObject({
      operation: z.literal("warning-read"),
      warningRecordRef: WarningRecordRefV1Schema,
      notificationCursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("task-read"), warningResponseTaskRef: WarningResponseTaskRefV1Schema, relatedCursor: c34ReadCursor.optional() }),
  z.strictObject({
      operation: z.literal("recommendation-read"), responseRecommendationRef: ResponseRecommendationRefV1Schema }),
  z.strictObject({
      operation: z.literal("forecast-read"), effectForecastRef: EffectForecastRefV1Schema }),
  z.strictObject({
      operation: z.literal("execution-read"),
      executionRecordRef: ExecutionRecordRefV1Schema,
      feedbackCursor: c34ReadCursor.optional(),
    }),
  z.strictObject({
      operation: z.literal("feedback-read"), feedbackRef: FeedbackRefV1Schema, calibrationCursor: c34ReadCursor.optional() }),
  z.strictObject({
      operation: z.literal("calibration-read"), calibrationSuggestionRef: CalibrationSuggestionRefV1Schema }),
  z.strictObject({
      operation: z.literal("resolve"),
      entityId: IdentifierSchema,
      targetKind: z.enum([
        "warning",
        "task",
        "recommendation",
        "forecast",
        "execution",
        "feedback",
        "calibration",
      ]),
      versionId: IdentifierSchema.optional(),
    }),
]);

export const WarningResponseReadQueryV1Schema = querySchema(
  "read",
  warningResponseReadOperationPayloadV1,
  branchCapability("warning-response.read"),
);;
export type WarningResponseReadQueryV1 = z.infer<typeof WarningResponseReadQueryV1Schema>;

export const WarningResponseReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("warning-catalog"),
    actorId: IdentifierSchema,
    items: z.array(WarningCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("task-catalog"),
    actorId: IdentifierSchema,
    items: z.array(WarningTaskCatalogItemV1Schema).max(C34_READ_PAGE_SIZE_MAX_V1),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("overview"),
    actorId: IdentifierSchema,
    openTaskCount: c34NonNegativeInt,
    warningCount: c34NonNegativeInt,
    levelCounts: z
      .array(z.strictObject({ warningLevel: IdentifierSchema, count: c34NonNegativeInt }))
      .max(32),
    asOf: IsoDateTimeSchema,
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("warning-read"),
    actorId: IdentifierSchema,
    warningRecord: WarningRecordSchema,
    warningRecordRef: WarningRecordRefV1Schema,
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    taskRef: WarningResponseTaskRefV1Schema,
    acknowledgement: WarningAcknowledgementViewV1Schema.optional(),
    notifications: z.array(WarningNotificationDisclosureV1Schema).max(50),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("task-read"),
    actorId: IdentifierSchema,
    taskRef: WarningResponseTaskRefV1Schema,
    status: WarningResponseTaskStatusV1Schema,
    riskInput: RiskInputVersionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    occurredAt: IsoDateTimeSchema,
    relations: WarningTaskRelationsV1Schema,
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("recommendation-read"),
    actorId: IdentifierSchema,
    recommendation: ResponseRecommendationSchema,
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
    taskRef: WarningResponseTaskRefV1Schema,
    validationResults: z.array(RecommendationValidationResultV1Schema).max(3),
    generationPolicyRef: ContractReferenceV1Schema,
    validationPolicyRef: ContractReferenceV1Schema,
    measureReleaseRefs: z.array(ContractReferenceV1Schema).max(50),
    decision: z
      .strictObject({
        decisionRef: RouteDecisionRefV1Schema,
        state: z.enum(["adopted", "declined"]),
        actorId: IdentifierSchema,
        decidedAt: IsoDateTimeSchema,
        reasonCode: IdentifierSchema,
        forecastRunRef: WorkflowRunRefV1Schema.optional(),
      })
      .optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("forecast-read"),
    actorId: IdentifierSchema,
    effectForecastRef: EffectForecastRefV1Schema,
    recommendationRef: ResponseRecommendationRefV1Schema,
    routeDecisionRef: RouteDecisionRefV1Schema,
    runRef: WorkflowRunRefV1Schema,
    inputSnapshotRef: ContractReferenceV1Schema,
    frozenAssessmentBasisRef: ContractReferenceV1Schema,
    preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
    baselineAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    forecastPolicyRef: ContractReferenceV1Schema,
    method: IdentifierSchema,
    targetIndicatorId: IdentifierSchema,
    unit: c34ReadText,
    horizonSteps: c34NonNegativeInt,
    availability: forecastAvailabilityV1,
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("execution-read"),
    actorId: IdentifierSchema,
    executionRecordRef: ExecutionRecordRefV1Schema,
    source: z.discriminatedUnion("sourceKind", [
      z.strictObject({
        sourceKind: z.literal("adopted-recommendation"),
        recommendationRef: ResponseRecommendationRefV1Schema,
        routeDecisionRef: RouteDecisionRefV1Schema,
        measureReleaseRefs: z.array(ContractReferenceV1Schema).max(50),
      }),
      z.strictObject({
        sourceKind: z.literal("feedback-entry"),
        feedbackRef: FeedbackRefV1Schema,
      }),
    ]),
    executedByActorId: IdentifierSchema,
    recordedByActorId: IdentifierSchema,
    occurredAt: IsoDateTimeSchema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
    feedbackRefs: z.array(FeedbackRefV1Schema).max(50),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("feedback-read"),
    actorId: IdentifierSchema,
    feedbackRef: FeedbackRefV1Schema,
    executionRef: ExecutionRecordRefV1Schema,
    postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
    feedbackArtifactRef: ContentArtifactRefV1Schema,
    actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    occurredAt: IsoDateTimeSchema,
    forecastAvailability: forecastAvailabilityV1,
    /** 公共偏差记录正文与私有计算偏差解释只在真实成立时提供。 */
    deviationRecord: DeviationRecordSchema.optional(),
    deviation: DeviationViewV1Schema.optional(),
    deviationRecordRef: DeviationRecordRefV1Schema.optional(),
    calibrationRefs: z.array(CalibrationSuggestionRefV1Schema).max(50),
    nextCursor: c34ReadCursor.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("calibration-read"),
    actorId: IdentifierSchema,
    calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
    targetKind: IdentifierSchema,
    targetReleaseRef: ContractReferenceV1Schema,
    inputSnapshotRef: ContractReferenceV1Schema,
    validationPolicyRef: ContractReferenceV1Schema,
    operations: z.array(CalibrationOperationValidationV1Schema).max(64),
    status: CalibrationSuggestionStatusV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema.optional(),
    deviationRecordRef: ContractReferenceV1Schema,
    deviationRecordVersionId: IdentifierSchema,
    reviewDecisionRef: ReviewDecisionRefV1Schema.optional(),
    candidateArtifactRef: ContentArtifactRefV1Schema.optional(),
    knowledgeRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
    actions: readActionsV1,
  }),
  z.strictObject({
    kind: z.literal("resolve"),
    actorId: IdentifierSchema,
    targetKind: z.enum([
      "warning",
      "task",
      "recommendation",
      "forecast",
      "execution",
      "feedback",
      "calibration",
    ]),
    refs: z
      .array(
        z.discriminatedUnion("kind", [
          WarningRecordRefV1Schema,
          WarningResponseTaskRefV1Schema,
          ResponseRecommendationRefV1Schema,
          EffectForecastRefV1Schema,
          ExecutionRecordRefV1Schema,
          FeedbackRefV1Schema,
          CalibrationSuggestionRefV1Schema,
        ]),
      )
      .max(50),
  }),
]);
export type WarningResponseReadSuccessV1 = z.infer<typeof WarningResponseReadSuccessV1Schema>;

export const WarningResponseReadResultV1Schema = moduleResultSchema(
  WarningResponseReadSuccessV1Schema,
);
export type WarningResponseReadResultV1 = z.infer<typeof WarningResponseReadResultV1Schema>;

export interface WarningResponseReadPortV1 {
  read(query: WarningResponseReadQueryV1): Promise<WarningResponseReadResultV1>;
}

// ---- C29：校准公开治理入口（design D-03、D-08） ----

/**
 * 两条治理命令共用精确字段 shape，只由 outcome 区分。错误 outcome 在 HTTP/契约边界拒绝，
 * 不进入领域；core 的私有用例命令信封由本文件的共用 payload 派生，禁止两份 payload 定义。
 */
const calibrationGovernancePayloadBaseV1 = {
  schemaVersion: z.literal("1"),
  calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
  reviewDecisionRef: ReviewDecisionRefV1Schema,
};

export const CalibrationReviewOutcomePayloadV1Schema = z.strictObject({
  ...calibrationGovernancePayloadBaseV1,
  outcome: CalibrationReviewOutcomeV1Schema,
});
export type CalibrationReviewOutcomePayloadV1 = z.infer<
  typeof CalibrationReviewOutcomePayloadV1Schema
>;

export const CalibrationGovernanceDraftPayloadV1Schema = z.strictObject({
  ...calibrationGovernancePayloadBaseV1,
  outcome: CalibrationGovernanceDraftOutcomeV1Schema,
});
export type CalibrationGovernanceDraftPayloadV1 = z.infer<
  typeof CalibrationGovernanceDraftPayloadV1Schema
>;

/** 内部用例命令：三种 outcome 的联合，由两条公共 payload 派生，旧内部调用者形状不变。 */
export const CalibrationGovernanceOutcomeV1Schema = z.union([
  CalibrationReviewOutcomePayloadV1Schema,
  CalibrationGovernanceDraftPayloadV1Schema,
]);
export type CalibrationGovernanceOutcomeV1 = z.infer<
  typeof CalibrationGovernanceOutcomeV1Schema
>;

export const CalibrationReviewOutcomeCommandV1Schema = CommandEnvelopeSchema.extend({
  authorization: AuthorizationContextV1Schema,
  payload: CalibrationGovernanceOutcomeV1Schema,
});
export type CalibrationReviewOutcomeCommandV1 = z.infer<
  typeof CalibrationReviewOutcomeCommandV1Schema
>;

export const CalibrationGovernanceCommandV1Schema = z.discriminatedUnion("kind", [
  commandSchema(
    "record-calibration-review-outcome",
    CalibrationReviewOutcomePayloadV1Schema,
    branchCapability("warning-response.calibration-review-outcome"),
  ),
  commandSchema(
    "create-calibration-governance-draft",
    CalibrationGovernanceDraftPayloadV1Schema,
    branchCapability("warning-response.calibration-governance-draft"),
  ),
]);
export type CalibrationGovernanceCommandV1 = z.infer<
  typeof CalibrationGovernanceCommandV1Schema
>;

/** `recordReviewOutcome`：只推进对应建议版本，不创建草案。 */
export const CalibrationReviewOutcomeSuccessV1Schema = z.strictObject({
  calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
  outcome: z.enum(["rejected", "returned", "approved-for-draft"]),
  deviationRecordRef: DeviationRecordRefV1Schema,
  deviationRecordVersionId: IdentifierSchema,
});
export type CalibrationReviewOutcomeSuccessV1 = z.infer<
  typeof CalibrationReviewOutcomeSuccessV1Schema
>;

/** `createGovernanceDraft`：证明门禁通过后创建一项未发布 C16 修订。 */
export const CalibrationGovernanceDraftSuccessV1Schema = z.strictObject({
  governanceDraftRef: VersionReferenceSchema,
  knowledgeRevisionRef: KnowledgeRevisionRefV1Schema,
  candidateArtifactRef: ContentArtifactRefV1Schema,
  deviationRecordRef: DeviationRecordRefV1Schema,
  deviationRecordVersionId: IdentifierSchema,
});
export type CalibrationGovernanceDraftSuccessV1 = z.infer<
  typeof CalibrationGovernanceDraftSuccessV1Schema
>;

export const CalibrationReviewOutcomeResultV1Schema = moduleResultSchema(
  CalibrationReviewOutcomeSuccessV1Schema,
);
export type CalibrationReviewOutcomeResultV1 = z.infer<
  typeof CalibrationReviewOutcomeResultV1Schema
>;

export const CalibrationGovernanceDraftResultV1Schema = moduleResultSchema(
  CalibrationGovernanceDraftSuccessV1Schema,
);
export type CalibrationGovernanceDraftResultV1 = z.infer<
  typeof CalibrationGovernanceDraftResultV1Schema
>;

/** 两条治理命令的公共结果联合：入口按 kind 分派，成功投影各自用例形成的工件。 */
export const CalibrationGovernanceOutcomeResultV1Schema = z.union([
  CalibrationReviewOutcomeResultV1Schema,
  CalibrationGovernanceDraftResultV1Schema,
]);
export type CalibrationGovernanceOutcomeResultV1 = z.infer<
  typeof CalibrationGovernanceOutcomeResultV1Schema
>;

/**
 * 公共治理端口：薄包装只剥离公共 kind 并还原 C29 原内部 kind，
 * 不改变原业务身份、幂等身份与事务语义。命令入口按自身分支复验单能力授权，
 * 下游复核证明、知识读取与修订提交分别取得自己的用途授权。
 */
export interface CalibrationGovernancePortV1 {
  recordReviewOutcome(
    command: CalibrationGovernanceCommandV1,
  ): Promise<CalibrationReviewOutcomeResultV1>;
  createGovernanceDraft(
    command: CalibrationGovernanceCommandV1,
  ): Promise<CalibrationGovernanceDraftResultV1>;
}
