import { z } from "zod";

import { IdentifierSchema, IsoDateTimeSchema, VersionReferenceSchema } from "../common/index.js";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuditTrailRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  ContractReferenceV1Schema,
  DeviationRecordRefV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  FeedbackRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  NotificationIntentRefV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewTaskRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WarningRecordRefV1Schema,
  WarningResponseTaskRefV1Schema,
  WorkflowRunRefV1Schema,
} from "../ports/index.js";

export { DomainEventRefV1Schema } from "../ports/index.js";
export type { DomainEventRefV1 } from "../ports/index.js";

export const DomainEventMetadataV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  eventId: IdentifierSchema,
  eventVersion: z.literal(1),
  projectId: IdentifierSchema,
  aggregateRef: ContractReferenceV1Schema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  causationId: IdentifierSchema,
  correlationId: IdentifierSchema,
  producerCommandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  auditTrailRef: AuditTrailRefV1Schema,
});
export type DomainEventMetadataV1 = z.infer<typeof DomainEventMetadataV1Schema>;

const eventSchema = <const T extends string, const P extends z.ZodType>(eventType: T, payload: P) =>
  DomainEventMetadataV1Schema.extend({ eventType: z.literal(eventType), payload });

const InputsReadyPayloadV1Schema = z.strictObject({
  preparation: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("identification"),
      identificationPreparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
    }),
    z.strictObject({
      kind: z.literal("assessment"),
      assessmentPreparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
    }),
  ]),
});

const AssessmentInputChangedPayloadV1Schema = z.strictObject({
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("monitoring-snapshot"),
      previousMonitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema),
      newMonitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema),
    }),
    z.strictObject({
      kind: z.literal("applicability-metadata"),
      previousApplicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
      newApplicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    }),
  ]),
  reasonCode: IdentifierSchema,
});

const ForecastAvailabilityV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("available"), effectForecastRef: EffectForecastRefV1Schema }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
]);

const IdentificationBasisPublishedReleasesV1Schema = z.tuple([
  z.strictObject({
    definitionType: z.literal("process-model"),
    releaseRef: KnowledgeReleaseRefV1Schema,
  }),
  z.strictObject({
    definitionType: z.literal("risk-mechanism"),
    releaseRef: KnowledgeReleaseRefV1Schema,
  }),
  z.strictObject({
    definitionType: z.literal("standard-library"),
    releaseRef: KnowledgeReleaseRefV1Schema,
  }),
  z.strictObject({
    definitionType: z.literal("case-library"),
    releaseRef: KnowledgeReleaseRefV1Schema,
  }),
  z.strictObject({
    definitionType: z.literal("retrieval-evidence-base"),
    releaseRef: KnowledgeReleaseRefV1Schema,
  }),
]);

const IdentificationBasisPublishedPayloadV1Schema = z
  .strictObject({
    basisKind: z.literal("identification-basis"),
    publishedReleases: IdentificationBasisPublishedReleasesV1Schema,
    retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  })
  .superRefine((payload, context) => {
    const compositeRelease = payload.publishedReleases[4];
    if (
      compositeRelease.releaseRef.reference.entityId !==
        payload.retrievalEvidenceBaseReleaseRef.reference.entityId ||
      compositeRelease.releaseRef.reference.versionId !==
        payload.retrievalEvidenceBaseReleaseRef.reference.versionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["retrievalEvidenceBaseReleaseRef"],
        message:
          "retrievalEvidenceBaseReleaseRef must match the published retrieval evidence base release",
      });
    }
  });

export const DomainEventV1Schema = z.discriminatedUnion("eventType", [
  eventSchema("engineering.inputs-ready.v1", InputsReadyPayloadV1Schema),
  eventSchema(
    "identification.risk-record-accepted.v1",
    z.strictObject({
      standardizedRiskRecordRef: StandardizedRiskRecordRefV1Schema,
      identificationInputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
      identificationRunRef: WorkflowRunRefV1Schema,
    }),
  ),
  eventSchema("engineering.assessment-input-changed.v1", AssessmentInputChangedPayloadV1Schema),
  eventSchema(
    "knowledge.assessment-basis-published.v1",
    z.strictObject({
      basisKind: z.literal("assessment-basis"),
      newKnowledgeReleaseRef: KnowledgeReleaseRefV1Schema,
      affectedProjectRevisionRef: z.strictObject({
        kind: z.literal("project-revision"),
        reference: VersionReferenceSchema,
      }),
    }),
  ),
  eventSchema(
    "knowledge.identification-basis-published.v1",
    IdentificationBasisPublishedPayloadV1Schema,
  ),
  eventSchema(
    "assessment.recorded.v1",
    z.strictObject({
      riskInputRef: RiskInputVersionRefV1Schema,
      assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
      assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
      assessmentRunRef: WorkflowRunRefV1Schema,
    }),
  ),
  eventSchema(
    "warning.warning-recorded.v1",
    z.strictObject({
      assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
      warningRecordRef: WarningRecordRefV1Schema,
      warningResponseTaskRef: WarningResponseTaskRefV1Schema,
      notificationIntentRefs: z.array(NotificationIntentRefV1Schema),
    }),
  ),
  eventSchema(
    "warning.feedback-recorded.v1",
    z.strictObject({
      executionRecordRef: ExecutionRecordRefV1Schema,
      feedbackRef: FeedbackRefV1Schema,
      forecast: ForecastAvailabilityV1Schema,
    }),
  ),
  eventSchema(
    "warning.calibration-suggestion-created.v1",
    z.strictObject({
      deviationRecordRef: DeviationRecordRefV1Schema,
      calibrationSuggestionRef: CalibrationSuggestionRefV1Schema,
      reviewTaskRef: ReviewTaskRefV1Schema,
    }),
  ),
  eventSchema(
    "review.review-requested.v1",
    z.strictObject({
      reviewTaskRef: ReviewTaskRefV1Schema,
      targetRef: ContractReferenceV1Schema,
      waitingRunRef: WorkflowRunRefV1Schema,
    }),
  ),
  eventSchema(
    "review.review-resolved.v1",
    z.strictObject({
      reviewTaskRef: ReviewTaskRefV1Schema,
      reviewDecisionRef: ReviewDecisionRefV1Schema,
      resumeRunRef: WorkflowRunRefV1Schema,
    }),
  ),
]);
export type DomainEventV1 = z.infer<typeof DomainEventV1Schema>;
