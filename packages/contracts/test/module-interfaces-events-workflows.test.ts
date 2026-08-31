import { describe, expect, it } from "vitest";

import {
  AgentTaskResultRefV1Schema,
  AgentTaskTypeV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentEvaluationCommandV1Schema,
  AssessmentEvaluationResultV1Schema,
  AssessmentPreparationCommandV1Schema,
  AssessmentPreparationResultV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AssessmentRunResultRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  CancelAgentTaskCommandV1Schema,
  CancelWorkflowRunCommandV1Schema,
  ConfirmAgentCommandV1Schema,
  ContractReferenceV1Schema,
  DomainEventRefV1Schema,
  EngineeringDataCommandV1Schema,
  EngineeringDataApplySuccessV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringFreezeCommandV1Schema,
  ExternalRiskEventRefV1Schema,
  IdentificationAnalysisCommandV1Schema,
  IdentificationAnalysisSuccessV1Schema,
  IdentificationFinalizationCommandV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPlanCommandV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeResolutionSuccessV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  ModuleCapabilityV1Schema,
  ModuleErrorV1Schema,
  OpenWarningCommandV1Schema,
  ProjectionExportRequestV1Schema,
  ProjectionQueryV1Schema,
  RecommendationCommandV1Schema,
  ResumeAgentTaskCommandV1Schema,
  ResumeWorkflowRunCommandV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewDecisionV1Schema,
  ReviewRequestV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  RunSubscriptionRequestV1Schema,
  StartAgentTaskCommandV1Schema,
  StartWorkflowRunCommandV1Schema,
  TraceQueryV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordSuccessV1Schema,
  WorkflowRunStatusV1Schema,
} from "../src/ports/index.js";
import { APPLICABILITY_METADATA_DIMENSION_VALUES } from "../src/vocabulary/index.js";
import { DomainEventMetadataV1Schema, DomainEventV1Schema } from "../src/events/index.js";
import {
  AssessmentGraphStateV1Schema,
  AssessmentInputSnapshotV1Schema,
  AssessmentPreparationSnapshotV1Schema,
  AssessmentStageResultV1Schema,
  AssessmentStageV1Schema,
  IdentificationGraphStateV1Schema,
  IdentificationInputSnapshotV1Schema,
  IdentificationPreparationSnapshotV1Schema,
  IdentificationStageResultV1Schema,
  RiskFlowStageV1Schema,
  RiskFlowGraphStateV1Schema,
} from "../src/workflows/index.js";

const now = "2026-08-31T00:00:00Z";
const later = "2026-08-31T01:00:00Z";

const version = (kind: string, entityId = kind) => ({
  kind,
  reference: { entityId, versionId: "v1" },
});

const authorizationContextRef = version("authorization-context");
const workflowRunRef = version("workflow-run");
const projectRevisionRef = version("project-revision");
const spatialScopeRef = version("spatial-scope");
const sourceVersionRef = version("source-version");
const monitoringSnapshotRef = version("monitoring-snapshot");
const applicabilityMetadataSnapshotRef = version("applicability-metadata-snapshot");
const policyRef = { entityId: "policy", versionId: "v1" };

const agentTaskRef = {
  ...version("agent-task"),
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: { entityId: "model", versionId: "v1" },
  promptTemplateRef: { entityId: "prompt", versionId: "v1" },
  toolPolicyRef: { entityId: "tools", versionId: "v1" },
  budgetPolicyRef: { entityId: "budget", versionId: "v1" },
  incrementSchemaRef: { entityId: "increment", versionId: "v1" },
  validationPolicyRef: { entityId: "validation", versionId: "v1" },
};
const interactiveAgentTaskRef = { ...agentTaskRef, triggerMode: "interactive" };

const agentTaskResultRef = {
  ...version("agent-task-result"),
  agentTaskRef,
  status: "completed",
  incrementRef: version("retrieval-artifact-set"),
};

const reviewTaskRef = {
  ...version("review-task"),
  reviewType: "identification-group",
  targetRef: { kind: "identification-group", reference: { entityId: "group", versionId: "v1" } },
  waitingRunRef: workflowRunRef,
};

const authorization = {
  schemaVersion: "1",
  authorizationContextRef,
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: [
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
  ],
  spatialScopeRefs: [spatialScopeRef],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: policyRef,
  decidedAt: now,
  invocation: { kind: "human" },
};

const command = (kind: string, payload: object) => ({
  commandId: `command-${kind}`,
  idempotencyKey: `idempotency-${kind}`,
  projectId: "project-1",
  actorId: "actor-1",
  issuedAt: now,
  kind,
  authorization,
  payload,
});

const query = (kind: string, payload: object) => ({
  queryId: `query-${kind}`,
  projectId: "project-1",
  actorId: "actor-1",
  requestedAt: now,
  kind,
  authorization,
  payload,
});

const riskInput = version("standardized-risk-record", "risk-record-1");
const externalRiskInput = version("external-risk-event", "external-risk-1");

const identificationPreparationRef = version("identification-preparation-snapshot");
const identificationInputRef = version("identification-input-snapshot");
const assessmentPreparationRef = version("assessment-preparation-snapshot");
const assessmentInputRef = version("assessment-input-snapshot");
const assessmentRecordRef = version("risk-assessment-record");
const warningRecordRef = version("warning-record");
const warningResponseTaskRef = version("warning-response-task");
const auditTrailRef = version("audit-trail");
const runResultRef = version("risk-flow-run-result");

const eventMetadata = {
  schemaVersion: "1",
  eventId: "event-1",
  eventVersion: 1,
  projectId: "project-1",
  aggregateRef: version("risk-assessment-record"),
  occurredAt: now,
  recordedAt: later,
  causationId: "cause-1",
  correlationId: "correlation-1",
  producerCommandId: "command-1",
  idempotencyKey: "event-idempotency-1",
  authorizationContextRef,
  auditTrailRef,
};

const stageResult = (stage: string, output: object) => ({
  schemaVersion: "1",
  stage,
  runRef: workflowRunRef,
  recordedAt: now,
  ...output,
});

describe("module interface contracts", () => {
  it("keeps vocabulary and capabilities closed", () => {
    expect(APPLICABILITY_METADATA_DIMENSION_VALUES).toHaveLength(3);
    expect(ModuleCapabilityV1Schema.safeParse("workflow.start").success).toBe(true);
    expect(ModuleCapabilityV1Schema.safeParse("database.query").success).toBe(false);
    expect(AgentTaskTypeV1Schema.safeParse("retrieval-review").success).toBe(true);
    expect(AgentTaskTypeV1Schema.safeParse("free-form").success).toBe(false);
  });

  it("domain ports: accepts every declared branch and rejects open actions", () => {
    const domainCases = [
      [
        EngineeringDataCommandV1Schema,
        command("register-source-delivery", {
          sourceConnectionRef: { entityId: "connection-1", versionId: "v1" },
          deliveryKey: "delivery-1",
          sourceArtifactRef: version("content-artifact", "source-artifact"),
          metadataArtifactRef: version("content-artifact", "metadata-artifact"),
          occurredAt: now,
        }),
      ],
      [
        EngineeringDataCommandV1Schema,
        command("register-monitoring-batch", {
          monitoringSeriesRef: version("monitoring-series"),
          deliveryKey: "delivery-2",
          sampleArtifactRef: version("content-artifact", "sample-artifact"),
          window: { from: now, to: later },
          relation: { kind: "original" },
        }),
      ],
      [
        EngineeringDataCommandV1Schema,
        command("register-external-risk-event", {
          externalSourceRef: { entityId: "source-1", versionId: "v1" },
          externalEventKey: "external-event-1",
          eventArtifactRef: version("content-artifact", "event-artifact"),
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "资料ID-章节ID-资料段ID" },
              sourceVersion: { entityId: "source", versionId: "v1" },
            },
          ],
          occurredAt: now,
        }),
      ],
      [
        EngineeringFreezeCommandV1Schema,
        command("identification-preparation", {
          projectRevisionRef,
          spatialScopeRefs: [spatialScopeRef],
          sourceVersionRefs: [sourceVersionRef],
          dataProcessingPolicyRef: policyRef,
        }),
      ],
      [
        EngineeringFreezeCommandV1Schema,
        command("assessment-preparation", {
          riskInput,
          projectRevisionRef,
          spatialScopeRef,
          applicabilityMetadataSnapshotRef,
        }),
      ],
      [
        EngineeringFreezeCommandV1Schema,
        command("monitoring-snapshot", {
          monitoringSeriesRef: version("monitoring-series"),
          cutoff: now,
          availabilityPolicyRef: policyRef,
        }),
      ],
      [
        EngineeringDataQueryV1Schema,
        query("source-segments", {
          sourceSegmentSetRef: version("source-segment-set"),
        }),
      ],
      [
        EngineeringDataQueryV1Schema,
        query("monitoring-snapshot", {
          monitoringSnapshotRef,
        }),
      ],
      [
        EngineeringDataQueryV1Schema,
        query("evidence-access", {
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "资料ID-章节ID-资料段ID" },
              sourceVersion: { entityId: "source", versionId: "v1" },
            },
          ],
          purposeCode: "review",
        }),
      ],
      [
        KnowledgeGovernanceCommandV1Schema,
        command("submit-revision", {
          definitionType: "risk-mechanism",
          candidateArtifactRef: version("content-artifact", "candidate"),
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "资料ID-章节ID-资料段ID" },
              sourceVersion: { entityId: "source", versionId: "v1" },
            },
          ],
        }),
      ],
      [
        KnowledgeGovernanceCommandV1Schema,
        command("request-review", {
          revisionRef: version("knowledge-revision"),
          reviewPolicyRef: policyRef,
        }),
      ],
      [
        KnowledgeGovernanceCommandV1Schema,
        command("publish-approved-release", {
          revisionRef: version("knowledge-revision"),
          reviewDecisionRef: version("review-decision"),
          effectiveFrom: now,
        }),
      ],
      [
        KnowledgeGovernanceCommandV1Schema,
        command("deactivate-release", {
          releaseRef: version("knowledge-release"),
          reasonCode: "superseded",
        }),
      ],
      [
        KnowledgeGovernanceCommandV1Schema,
        command("rollback-by-new-release", {
          historicalReleaseRef: version("knowledge-release", "historical"),
          reviewDecisionRef: version("review-decision"),
          reasonCode: "rollback",
        }),
      ],
      [
        KnowledgeResolutionCommandV1Schema,
        command("identification-basis", {
          preparationSnapshotRef: identificationPreparationRef,
          requiredAt: now,
        }),
      ],
      [
        KnowledgeResolutionCommandV1Schema,
        command("assessment-basis", {
          preparationSnapshotRef: assessmentPreparationRef,
          requiredAt: now,
        }),
      ],
      [
        KnowledgeRetrievalQueryV1Schema,
        query("hybrid-evidence", {
          inputSnapshotRef: identificationInputRef,
          workItemRef: version("identification-work-item"),
          retrievalPolicyRef: policyRef,
        }),
      ],
      [
        KnowledgeRetrievalQueryV1Schema,
        query("relationship-context", {
          inputSnapshotRef: identificationInputRef,
          workItemRef: version("identification-work-item"),
        }),
      ],
      [
        KnowledgeRetrievalQueryV1Schema,
        query("measure-candidates", {
          assessmentRecordRef,
          warningResponseTaskRef,
          measureLibraryReleaseRef: version("measure-library-release"),
        }),
      ],
      [
        IdentificationPlanCommandV1Schema,
        command("plan", {
          inputSnapshotRef: identificationInputRef,
        }),
      ],
      [
        IdentificationAnalysisCommandV1Schema,
        command("assemble-and-infer", {
          workItemRef: version("identification-work-item"),
          retrievalArtifactSetRef: version("retrieval-artifact-set"),
          modelDeploymentRef: policyRef,
          promptTemplateRef: policyRef,
        }),
      ],
      [
        IdentificationAnalysisCommandV1Schema,
        command("repair-and-validate", {
          candidateSetRef: version("identification-candidate-set"),
          repairPolicyRef: policyRef,
          ruleValidationPolicyRef: policyRef,
        }),
      ],
      [
        IdentificationFinalizationCommandV1Schema,
        command("merge-run-candidates", {
          workPlanRef: version("identification-work-plan"),
          validatedCandidateSetRefs: [version("validated-candidate-set")],
          mergePolicyRef: policyRef,
        }),
      ],
      [
        IdentificationFinalizationCommandV1Schema,
        command("route-acceptance", {
          mergePlanRef: version("merge-plan"),
          confidencePolicyRef: policyRef,
          forcedReviewPolicyRef: policyRef,
        }),
      ],
      [
        IdentificationFinalizationCommandV1Schema,
        command("accept-groups", {
          acceptanceRouteSetRef: version("acceptance-route-set"),
          acceptedGroupRefs: [version("identification-group")],
          decisionRefs: [version("route-decision")],
        }),
      ],
      [
        AssessmentPreparationCommandV1Schema,
        command("initial", {
          preparationSnapshotRef: assessmentPreparationRef,
          assessmentBasisReleaseSetRef: version("assessment-basis-release-set"),
        }),
      ],
      [
        AssessmentPreparationCommandV1Schema,
        command("reassessment", {
          preparationSnapshotRef: assessmentPreparationRef,
          assessmentBasisReleaseSetRef: version("assessment-basis-release-set"),
          previousAssessmentRecordRef: assessmentRecordRef,
          reason: "monitoring-snapshot",
        }),
      ],
      [
        AssessmentPreparationCommandV1Schema,
        command("historical-backfill", {
          preparationSnapshotRef: assessmentPreparationRef,
          assessmentBasisReleaseSetRef: version("assessment-basis-release-set"),
          effectiveAt: now,
        }),
      ],
      [
        AssessmentEvaluationCommandV1Schema,
        command("evaluate", {
          assessmentInputSnapshotRef: assessmentInputRef,
        }),
      ],
      [
        OpenWarningCommandV1Schema,
        command("open", {
          assessmentRecordRef,
          warningAggregationPolicyRef: policyRef,
          notificationPolicyRef: policyRef,
        }),
      ],
      [
        RecommendationCommandV1Schema,
        command("create-candidate", {
          warningResponseTaskRef,
          measureCandidateQueryResultRef: version("knowledge-query-result"),
          agentTaskResultRef,
          responseGenerationPolicyRef: policyRef,
        }),
      ],
      [
        RecommendationCommandV1Schema,
        command("validate-and-record", {
          recommendationCandidateRef: version("recommendation-candidate"),
          responseValidationPolicyRef: policyRef,
          siteContextRef: policyRef,
        }),
      ],
      [
        WarningResponseRecordCommandV1Schema,
        command("adopt-recommendation", {
          responseRecommendationRef: version("response-recommendation"),
          decision: "adopted",
          reasonCode: "approved",
        }),
      ],
      [
        WarningResponseRecordCommandV1Schema,
        command("record-execution", {
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: version("response-recommendation"),
          },
          executedByActorId: "executor-1",
          recordedByActorId: "actor-1",
          occurredAt: now,
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "资料ID-章节ID-资料段ID" },
              sourceVersion: { entityId: "source", versionId: "v1" },
            },
          ],
        }),
      ],
      [
        WarningResponseRecordCommandV1Schema,
        command("record-feedback", {
          executionRecordRef: version("execution-record"),
          postActionMonitoringSnapshotRef: monitoringSnapshotRef,
          feedbackArtifactRef: version("content-artifact", "feedback"),
          occurredAt: now,
        }),
      ],
      [
        WarningResponseRecordCommandV1Schema,
        command("calculate-deviation", {
          effectForecastRef: version("effect-forecast"),
          feedbackRef: version("feedback"),
          frozenAssessmentBasisRef: version("assessment-input-snapshot"),
        }),
      ],
      [
        WarningResponseRecordCommandV1Schema,
        command("create-calibration-suggestion", {
          deviationRecordRef: version("deviation-record"),
          agentTaskResultRef,
          calibrationValidationPolicyRef: policyRef,
        }),
      ],
      [
        ReviewRequestV1Schema,
        command("request-review", {
          reviewType: "identification-group",
          targetRef: reviewTaskRef.targetRef,
          validationSnapshotRef: version("validation-snapshot"),
          evidenceSnapshotRef: version("evidence-snapshot"),
          waitingRunRef: workflowRunRef,
          reviewPolicyRef: policyRef,
        }),
      ],
      [
        TraceQueryV1Schema,
        query("trace", {
          subjectRef: version("standardized-risk-record"),
          includeEvidenceSummary: true,
        }),
      ],
    ] as const;

    for (const [schema, input] of domainCases) {
      expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(true);
    }

    expect(
      EngineeringDataCommandV1Schema.safeParse(command("execute", { arbitrary: true })).success,
    ).toBe(false);
    expect(
      EngineeringDataCommandV1Schema.safeParse({
        ...command("register-source-delivery", {
          sourceConnectionRef: { entityId: "connection-1", versionId: "v1" },
          deliveryKey: "delivery-1",
          sourceArtifactRef: version("content-artifact", "source-artifact"),
          metadataArtifactRef: version("content-artifact", "metadata-artifact"),
          occurredAt: now,
          extra: "reject",
        }),
      }).success,
    ).toBe(false);
  });

  it("keeps method success results aligned with every declared branch", () => {
    const applyResults = [
      {
        kind: "register-source-delivery",
        sourceDeliveryRef: version("source-delivery"),
        sourceVersionRef: version("source-version"),
      },
      {
        kind: "register-monitoring-batch",
        monitoringBatchRef: version("monitoring-batch"),
      },
      {
        kind: "register-external-risk-event",
        externalRiskEventRef: version("external-risk-event"),
      },
    ];
    for (const result of applyResults) {
      expect(EngineeringDataApplySuccessV1Schema.safeParse(result).success).toBe(true);
    }
    expect(
      EngineeringDataApplySuccessV1Schema.safeParse({
        kind: "register-monitoring-batch",
        sourceDeliveryRef: version("source-delivery"),
        sourceVersionRef: version("source-version"),
      }).success,
    ).toBe(false);

    expect(
      KnowledgeResolutionSuccessV1Schema.safeParse({
        kind: "identification-basis",
        processModelReleaseRef: version("process-model-release"),
        riskMechanismReleaseRef: version("risk-mechanism-release"),
        retrievalEvidenceBaseReleaseRef: version("retrieval-evidence-base-release"),
        identificationPolicySetRef: version("identification-policy-set"),
      }).success,
    ).toBe(true);
    expect(
      KnowledgeResolutionSuccessV1Schema.safeParse({
        kind: "assessment-basis",
        assessmentBasisReleaseSetRef: version("assessment-basis-release-set"),
      }).success,
    ).toBe(true);
    expect(
      KnowledgeResolutionSuccessV1Schema.safeParse({
        kind: "assessment-basis",
        processModelReleaseRef: version("process-model-release"),
      }).success,
    ).toBe(false);

    expect(
      IdentificationAnalysisSuccessV1Schema.safeParse({
        kind: "assemble-and-infer",
        modelContextArtifactSetRef: version("model-context-artifact-set"),
        candidateSetRef: version("identification-candidate-set"),
      }).success,
    ).toBe(true);
    expect(
      IdentificationAnalysisSuccessV1Schema.safeParse({
        kind: "repair-and-validate",
        validatedCandidateSetRef: version("validated-candidate-set"),
      }).success,
    ).toBe(true);
    expect(
      IdentificationAnalysisSuccessV1Schema.safeParse({
        kind: "repair-and-validate",
        candidateSetRef: version("identification-candidate-set"),
      }).success,
    ).toBe(false);

    expect(
      WarningResponseRecordSuccessV1Schema.safeParse({
        kind: "deviation",
        deviationRecordRef: version("deviation-record"),
      }).success,
    ).toBe(true);
    expect(
      WarningResponseRecordSuccessV1Schema.safeParse({
        kind: "unavailable",
        reasonCode: "forecast-not-created",
      }).success,
    ).toBe(true);
    expect(
      WarningResponseRecordSuccessV1Schema.safeParse({
        kind: "unavailable",
      }).success,
    ).toBe(false);

    expect(
      AssessmentPreparationResultV1Schema.safeParse({
        kind: "succeeded",
        result: { assessmentInputSnapshotRef: assessmentInputRef },
      }).success,
    ).toBe(true);
    expect(
      AssessmentEvaluationResultV1Schema.safeParse({
        kind: "succeeded",
        result: {
          indicatorActualValueSetRef: version("indicator-actual-value-set"),
          assessmentDecisionArtifactRef: version("assessment-decision-artifact"),
          assessmentRecordRef,
        },
      }).success,
    ).toBe(true);
  });

  it("application ports: keeps lifecycle inputs closed and returns references only", () => {
    const startTask = command("start-task", {
      taskType: "retrieval-review",
      triggerMode: "embedded",
      parentRunRef: workflowRunRef,
      frozenInputRef: identificationInputRef,
      modelDeploymentRef: policyRef,
      promptTemplateRef: policyRef,
      toolPolicyRef: policyRef,
      budgetPolicyRef: policyRef,
      incrementSchemaRef: policyRef,
      validationPolicyRef: policyRef,
    });
    expect(StartAgentTaskCommandV1Schema.safeParse(startTask).success).toBe(true);
    expect(
      StartAgentTaskCommandV1Schema.safeParse({
        ...startTask,
        payload: { ...startTask.payload, modelResponse: "forbidden" },
      }).success,
    ).toBe(false);
    expect(
      ResumeAgentTaskCommandV1Schema.safeParse(
        command("resume-task", {
          agentTaskRef,
          resumeReason: "user-confirmed",
          resumeEvidenceRef: version("diagnostic-artifact"),
        }),
      ).success,
    ).toBe(true);
    expect(
      CancelAgentTaskCommandV1Schema.safeParse(
        command("cancel-task", {
          agentTaskRef,
          reasonCode: "user-cancelled",
        }),
      ).success,
    ).toBe(true);
    expect(
      ConfirmAgentCommandV1Schema.safeParse(
        command("confirm-command", {
          agentTaskRef: interactiveAgentTaskRef,
          commandProposalRef: version("command-proposal"),
          confirmation: "confirmed",
        }),
      ).success,
    ).toBe(true);

    const assessStart = command("start-run", {
      entryMode: "assess",
      graphVersion: policyRef,
      retryPolicyRef: policyRef,
      riskInput: externalRiskInput,
      applicabilityMetadataSnapshotRef,
      spatialScopeRef,
    });
    expect(StartWorkflowRunCommandV1Schema.safeParse(assessStart).success).toBe(true);
    expect(
      StartWorkflowRunCommandV1Schema.safeParse({
        ...assessStart,
        payload: { ...assessStart.payload, applicabilityMetadataSnapshotRef: undefined },
      }).success,
    ).toBe(false);
    expect(
      ResumeWorkflowRunCommandV1Schema.safeParse(
        command("resume-run", {
          workflowRunRef,
          expectedStateVersion: "state-v1",
          resumeCause: {
            kind: "knowledge-ready",
            knowledgePreparationTaskRef: version("knowledge-preparation-task"),
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      CancelWorkflowRunCommandV1Schema.safeParse(
        command("cancel-run", {
          workflowRunRef,
          expectedStateVersion: "state-v1",
          reasonCode: "user-cancelled",
        }),
      ).success,
    ).toBe(true);

    expect(
      ProjectionQueryV1Schema.safeParse(
        query("query", {
          queryType: "trace-chain",
          subjectRef: riskInput,
        }),
      ).success,
    ).toBe(true);
    expect(
      RunSubscriptionRequestV1Schema.safeParse(
        query("subscribe", {
          workflowRunRef,
        }),
      ).success,
    ).toBe(true);
    expect(
      ProjectionExportRequestV1Schema.safeParse(
        query("export", {
          sourceRef: version("query-result"),
          exportPolicyRef: policyRef,
        }),
      ).success,
    ).toBe(true);

    const sourceCommand = command("register-source-delivery", {
      sourceConnectionRef: { entityId: "connection-1", versionId: "v1" },
      deliveryKey: "delivery-1",
      sourceArtifactRef: version("content-artifact", "source-artifact"),
      metadataArtifactRef: version("content-artifact", "metadata-artifact"),
      occurredAt: now,
    });
    expect(
      EngineeringDataCommandV1Schema.safeParse({
        ...sourceCommand,
        authorization: {
          ...authorization,
          grantedCapabilities: authorization.grantedCapabilities.filter(
            (capability) => capability !== "engineering-data.write",
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      EngineeringDataCommandV1Schema.safeParse({
        ...sourceCommand,
        actorId: "different-actor",
      }).success,
    ).toBe(false);
  });

  it("uses three invocation forms and an eight-branch closed error", () => {
    for (const invocation of [
      { kind: "human" },
      {
        kind: "system",
        systemActorId: "system-1",
        reasonCode: "event-trigger",
        causalRunRef: workflowRunRef,
      },
      { kind: "agent-task", agentTaskRef, causalRunRef: workflowRunRef },
    ]) {
      const { causalRunRef, ...invocationValue } = invocation;
      expect(
        AuthorizationContextV1Schema.safeParse({
          ...authorization,
          ...(causalRunRef === undefined ? {} : { causalRunRef }),
          invocation: invocationValue,
        }).success,
      ).toBe(true);
    }
    expect(
      AuthorizationContextV1Schema.safeParse({
        ...authorization,
        invocation: { kind: "system", systemActorId: "system-1", reasonCode: "event-trigger" },
      }).success,
    ).toBe(false);
    expect(
      AuthorizationContextV1Schema.safeParse({
        ...authorization,
        invocation: { kind: "human", extra: "reject" },
      }).success,
    ).toBe(false);
    expect(AuthorizationContextRefV1Schema.safeParse(authorizationContextRef).success).toBe(true);

    const common = {
      stageCode: "I5",
      occurredAt: now,
      causalRunId: "run-1",
    };
    const errors = [
      {
        ...common,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "risk-identification.run",
        authorizationPolicyRef: policyRef,
      },
      {
        ...common,
        code: "ENTITY_NOT_FOUND",
        category: "not-found",
        retryable: false,
        targetRef: version("source-version"),
      },
      {
        ...common,
        code: "STALE_VERSION",
        category: "concurrency",
        retryable: false,
        targetRef: version("standardized-risk-record"),
      },
      {
        ...common,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: "idempotency-1",
        priorCommandId: "command-1",
      },
      {
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: "review",
        blockerRef: reviewTaskRef,
      },
      {
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: policyRef,
        diagnosticRef: version("diagnostic-artifact"),
      },
      {
        ...common,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef: version("diagnostic-artifact"),
      },
      {
        ...common,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: "2",
      },
    ];
    for (const error of errors) {
      expect(ModuleErrorV1Schema.safeParse(error).success).toBe(true);
    }
    expect(
      ModuleErrorV1Schema.safeParse({
        ...errors[0],
        code: "UNKNOWN_ERROR",
      }).success,
    ).toBe(false);
    expect(
      ModuleErrorV1Schema.safeParse({ ...errors[0], details: { secret: "reject" } }).success,
    ).toBe(false);
  });

  it("closes review decisions by subject and keeps agent results non-empty", () => {
    const reviewDecisions = [
      { reviewType: "identification-group", kind: "approve-unchanged" },
      {
        reviewType: "identification-group",
        kind: "approve-revised-candidate",
        revisedCandidateRef: version("identification-candidate-set"),
      },
      { reviewType: "identification-group", kind: "confirm-merge" },
      { reviewType: "identification-group", kind: "keep-separate" },
      { reviewType: "identification-group", kind: "reject" },
      { reviewType: "identification-group", kind: "return-upstream" },
      { reviewType: "knowledge-revision", kind: "approve-publication" },
      { reviewType: "knowledge-revision", kind: "reject" },
      { reviewType: "knowledge-revision", kind: "return-for-revision" },
      { reviewType: "rule-conflict", kind: "approve-publication" },
      { reviewType: "rule-conflict", kind: "reject" },
      { reviewType: "rule-conflict", kind: "return-for-revision" },
      {
        reviewType: "response-candidate",
        kind: "submit-revised-candidate",
        revisedCandidateRef: version("recommendation-candidate"),
      },
      { reviewType: "response-candidate", kind: "return-upstream" },
      { reviewType: "response-candidate", kind: "reject" },
      { reviewType: "calibration-suggestion", kind: "approve-draft-creation" },
      { reviewType: "calibration-suggestion", kind: "reject" },
      { reviewType: "calibration-suggestion", kind: "return-for-revision" },
    ];
    for (const decision of reviewDecisions) {
      expect(ReviewDecisionV1Schema.safeParse(decision).success).toBe(true);
    }

    const validReviewDecision = command("decide-review", {
      reviewTaskRef,
      targetRef: reviewTaskRef.targetRef,
      decision: { reviewType: "identification-group", kind: "reject" },
      reasonCode: "reviewed",
    });
    expect(ReviewDecisionCommandV1Schema.safeParse(validReviewDecision).success).toBe(true);
    expect(
      ReviewDecisionCommandV1Schema.safeParse({
        ...validReviewDecision,
        payload: {
          ...validReviewDecision.payload,
          decision: { reviewType: "knowledge-revision", kind: "reject" },
        },
      }).success,
    ).toBe(false);
    expect(
      ReviewDecisionCommandV1Schema.safeParse({
        ...validReviewDecision,
        payload: {
          ...validReviewDecision.payload,
          targetRef: version("knowledge-revision"),
        },
      }).success,
    ).toBe(false);
    expect(
      ReviewRequestV1Schema.safeParse(
        command("request-review", {
          reviewType: "knowledge-revision",
          targetRef: reviewTaskRef.targetRef,
          validationSnapshotRef: version("validation-snapshot"),
          evidenceSnapshotRef: version("evidence-snapshot"),
          waitingRunRef: workflowRunRef,
          reviewPolicyRef: policyRef,
        }),
      ).success,
    ).toBe(false);

    expect(AgentTaskResultRefV1Schema.safeParse(agentTaskResultRef).success).toBe(true);
    expect(
      AgentTaskResultRefV1Schema.safeParse({
        ...agentTaskResultRef,
        incrementRef: undefined,
      }).success,
    ).toBe(false);
    expect(
      AgentTaskResultRefV1Schema.safeParse({
        ...agentTaskResultRef,
        candidateRef: version("recommendation-candidate"),
      }).success,
    ).toBe(false);
    expect(
      AgentTaskResultRefV1Schema.safeParse({
        ...agentTaskResultRef,
        status: "failed",
      }).success,
    ).toBe(false);
    const responseAgentTaskRef = { ...agentTaskRef, taskType: "response-recommendation" };
    expect(
      AgentTaskResultRefV1Schema.safeParse({
        ...agentTaskResultRef,
        agentTaskRef: responseAgentTaskRef,
        incrementRef: undefined,
        candidateRef: version("recommendation-candidate"),
      }).success,
    ).toBe(true);
    expect(
      AgentTaskResultRefV1Schema.safeParse({
        ...agentTaskResultRef,
        agentTaskRef: responseAgentTaskRef,
        incrementRef: undefined,
        candidateRef: version("calibration-suggestion"),
      }).success,
    ).toBe(false);
  });

  it("enforces versioned risk input XOR", () => {
    expect(RiskInputVersionRefV1Schema.safeParse(riskInput).success).toBe(true);
    expect(RiskInputVersionRefV1Schema.safeParse(externalRiskInput).success).toBe(true);
    expect(
      RiskInputVersionRefV1Schema.safeParse({
        kind: "standardized-risk-record",
        reference: riskInput.reference,
        riskRecordId: "risk-1",
      }).success,
    ).toBe(false);
    expect(
      RiskInputVersionRefV1Schema.safeParse({
        kind: "standardized-risk-record",
        reference: riskInput.reference,
        externalRiskEventId: "external-1",
      }).success,
    ).toBe(false);
    expect(ExternalRiskEventRefV1Schema.safeParse(externalRiskInput).success).toBe(true);
    expect(ContractReferenceV1Schema.safeParse(riskInput).success).toBe(true);
    expect(RiskAssessmentRecordRefV1Schema.safeParse(assessmentRecordRef).success).toBe(true);
  });

  it("domain events: accepts all ten transactional events and rejects business bodies", () => {
    const events = [
      {
        eventType: "engineering.inputs-ready.v1",
        payload: {
          preparation: {
            kind: "identification",
            identificationPreparationSnapshotRef: identificationPreparationRef,
          },
        },
      },
      {
        eventType: "identification.risk-record-accepted.v1",
        payload: {
          standardizedRiskRecordRef: version("standardized-risk-record"),
          identificationInputSnapshotRef: identificationInputRef,
          identificationRunRef: workflowRunRef,
        },
      },
      {
        eventType: "engineering.assessment-input-changed.v1",
        payload: {
          change: {
            kind: "monitoring-snapshot",
            previousMonitoringSnapshotRef: version("monitoring-snapshot", "old"),
            newMonitoringSnapshotRef: monitoringSnapshotRef,
          },
          reasonCode: "new-monitoring-data",
        },
      },
      {
        eventType: "knowledge.assessment-basis-published.v1",
        payload: {
          basisKind: "assessment-basis",
          newKnowledgeReleaseRef: version("knowledge-release"),
          affectedProjectRevisionRef: projectRevisionRef,
        },
      },
      {
        eventType: "assessment.recorded.v1",
        payload: {
          riskInputRef: riskInput,
          assessmentInputSnapshotRef: assessmentInputRef,
          assessmentRecordRef,
          assessmentRunRef: workflowRunRef,
        },
      },
      {
        eventType: "warning.warning-recorded.v1",
        payload: {
          assessmentRecordRef,
          warningRecordRef,
          warningResponseTaskRef,
          notificationIntentRefs: [version("notification-intent")],
        },
      },
      {
        eventType: "warning.feedback-recorded.v1",
        payload: {
          executionRecordRef: version("execution-record"),
          feedbackRef: version("feedback"),
          forecast: { kind: "unavailable", reasonCode: "not-created" },
        },
      },
      {
        eventType: "warning.calibration-suggestion-created.v1",
        payload: {
          deviationRecordRef: version("deviation-record"),
          calibrationSuggestionRef: version("calibration-suggestion"),
          reviewTaskRef,
        },
      },
      {
        eventType: "review.review-requested.v1",
        payload: {
          reviewTaskRef,
          targetRef: reviewTaskRef.targetRef,
          waitingRunRef: workflowRunRef,
        },
      },
      {
        eventType: "review.review-resolved.v1",
        payload: {
          reviewTaskRef,
          reviewDecisionRef: version("review-decision"),
          resumeRunRef: workflowRunRef,
        },
      },
    ];
    expect(DomainEventMetadataV1Schema.safeParse(eventMetadata).success).toBe(true);
    for (const event of events) {
      expect(DomainEventV1Schema.safeParse({ ...eventMetadata, ...event }).success).toBe(true);
    }
    expect(
      DomainEventV1Schema.safeParse({
        ...eventMetadata,
        ...events[1],
        payload: {
          ...events[1].payload,
          identificationRunRef: version("identification-run-result"),
        },
      }).success,
    ).toBe(false);
    expect(
      DomainEventV1Schema.safeParse({
        ...eventMetadata,
        ...events[4],
        payload: {
          ...events[4].payload,
          assessmentRunRef: version("assessment-run-result"),
        },
      }).success,
    ).toBe(false);
    expect(
      DomainEventRefV1Schema.safeParse({
        kind: "domain-event",
        eventId: "event-1",
        eventVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      DomainEventV1Schema.safeParse({
        ...eventMetadata,
        ...events[4],
        payload: { ...events[4].payload, assessmentRecord: { riskEvent: "正文" } },
      }).success,
    ).toBe(false);
    expect(
      DomainEventV1Schema.safeParse({
        ...eventMetadata,
        ...events[4],
        extra: "reject",
      }).success,
    ).toBe(false);
  });

  it("workflow stages, graph state and lifecycle: covers I0-I9 and A0-A9", () => {
    const identificationStages = ["I0", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9"];
    const assessmentStages = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
    expect(new Set(identificationStages).size).toBe(10);
    expect(new Set(assessmentStages).size).toBe(10);
    const identificationStageOutputs = [
      { preparationSnapshotRef: identificationPreparationRef },
      { resultKind: "ready", inputSnapshotRef: identificationInputRef },
      {
        workPlanRef: version("identification-work-plan"),
        plannedWorkItemCount: 1,
        excludedWorkItemCount: 0,
      },
      { retrievalArtifactSetRefs: [], agentTaskRefs: [], failedWorkItemRefs: [] },
      { modelContextArtifactSetRefs: [], candidateSetRef: version("identification-candidate-set") },
      { validatedCandidateSetRef: version("validated-candidate-set"), reviewTaskRefs: [] },
      { mergePlanRef: version("merge-plan"), skippedMergeGroupRefs: [] },
      { acceptanceRouteSetRef: version("acceptance-route-set"), reviewTaskRefs: [] },
      { standardizedRiskRecordRefs: [], eventRefs: [] },
      { identificationRunResultRef: version("identification-run-result") },
    ];
    for (const [index, stage] of identificationStages.entries()) {
      expect(
        IdentificationStageResultV1Schema.safeParse(
          stageResult(stage, identificationStageOutputs[index]),
        ).success,
      ).toBe(true);
    }
    const assessmentStageOutputs = [
      { preparationSnapshotRef: assessmentPreparationRef },
      {
        resultKind: "ready",
        assessmentBasisReleaseSetRef: version("assessment-basis-release-set"),
      },
      { assessmentInputSnapshotRef: assessmentInputRef },
      { indicatorActualValueSetRef: version("indicator-actual-value-set") },
      { assessmentDecisionArtifactRef: version("assessment-decision-artifact") },
      { assessmentRecordRef },
      { warningRecordRefs: [], warningResponseTaskRefs: [], notificationIntentRefs: [] },
      {
        measureQueryResultRef: version("knowledge-query-result"),
        agentTaskRefs: [],
        recommendationCandidateRefs: [],
      },
      {
        resultKind: "recorded",
        responseRecommendationRef: version("response-recommendation"),
      },
      { assessmentRunResultRef: version("assessment-run-result") },
    ];
    for (const [index, stage] of assessmentStages.entries()) {
      expect(AssessmentStageV1Schema.safeParse(stage).success).toBe(true);
      expect(
        AssessmentStageResultV1Schema.safeParse(stageResult(stage, assessmentStageOutputs[index]))
          .success,
      ).toBe(true);
    }
    expect(
      IdentificationStageResultV1Schema.safeParse(
        stageResult("I1", {
          resultKind: "waiting",
          waitingRef: { kind: "review", reviewTaskRef },
        }),
      ).success,
    ).toBe(true);
    expect(
      IdentificationStageResultV1Schema.safeParse(
        stageResult("I1", { inputSnapshotRef: identificationInputRef }),
      ).success,
    ).toBe(false);
    expect(
      AssessmentStageResultV1Schema.safeParse(
        stageResult("A1", {
          resultKind: "waiting",
          waitingRef: {
            kind: "knowledge-preparation",
            knowledgePreparationTaskRef: version("knowledge-preparation-task"),
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      AssessmentStageResultV1Schema.safeParse(stageResult("A1", { resultKind: "ready" })).success,
    ).toBe(false);
    expect(
      AssessmentStageResultV1Schema.safeParse(
        stageResult("A8", {
          resultKind: "recorded",
          responseRecommendationRef: version("response-recommendation"),
          reviewTaskRef,
        }),
      ).success,
    ).toBe(false);
    expect(
      AssessmentStageResultV1Schema.safeParse(
        stageResult("A4", {
          assessmentDecisionArtifactRef: version("assessment-decision-artifact"),
          agentTaskRefs: [agentTaskRef],
        }),
      ).success,
    ).toBe(false);
    expect(IdentificationInputSnapshotRefV1Schema.safeParse(identificationInputRef).success).toBe(
      true,
    );
    expect(
      IdentificationPreparationSnapshotRefV1Schema.safeParse(identificationPreparationRef).success,
    ).toBe(true);
    expect(
      AssessmentPreparationSnapshotRefV1Schema.safeParse(assessmentPreparationRef).success,
    ).toBe(true);
    expect(
      AssessmentBasisReleaseSetRefV1Schema.safeParse(version("assessment-basis-release-set"))
        .success,
    ).toBe(true);
    expect(AssessmentRunResultRefV1Schema.safeParse(version("assessment-run-result")).success).toBe(
      true,
    );
    expect(WorkflowRunStatusV1Schema.safeParse("waiting").success).toBe(true);
    expect(WorkflowRunStatusV1Schema.safeParse("unknown").success).toBe(false);

    const identificationState = {
      schemaVersion: "1",
      graphVersion: policyRef,
      parentRiskFlowRunRef: workflowRunRef,
      runRef: workflowRunRef,
      threadId: "thread-1",
      triggerType: "manual",
      triggerReasonCode: "user-started",
      authorizationContextRef,
      preparationSnapshotRef: identificationPreparationRef,
      inputSnapshotRef: identificationInputRef,
      status: "waiting",
      stage: "I7",
      waitingRef: { kind: "review", reviewTaskRef },
      agentTaskRefs: [agentTaskRef],
      acceptedRiskRecordRefs: [version("standardized-risk-record")],
      reviewTaskRefs: [reviewTaskRef],
      rejectedGroupRefs: [],
      failedWorkItemRefs: [],
    };
    expect(IdentificationGraphStateV1Schema.safeParse(identificationState).success).toBe(true);
    expect(
      IdentificationGraphStateV1Schema.safeParse({
        ...identificationState,
        waitingRef: undefined,
      }).success,
    ).toBe(false);
    expect(
      IdentificationGraphStateV1Schema.safeParse({
        ...identificationState,
        standardizedRiskRecord: {
          processNodeId: "node-1",
          riskEvent: "正文",
        },
      }).success,
    ).toBe(false);

    const assessmentState = {
      schemaVersion: "1",
      graphVersion: policyRef,
      parentRiskFlowRunRef: workflowRunRef,
      runRef: workflowRunRef,
      threadId: "thread-1",
      entryMode: "assess",
      authorizationContextRef,
      entrySnapshotRef: {
        kind: "assessment-preparation",
        assessmentPreparationSnapshotRef: assessmentPreparationRef,
      },
      status: "completed",
      stage: "A9",
      warningRecordRefs: [warningRecordRef],
      warningResponseTaskRefs: [warningResponseTaskRef],
      agentTaskRefs: [],
      reviewTaskRefs: [],
      resultRef: version("assessment-run-result"),
    };
    expect(AssessmentGraphStateV1Schema.safeParse(assessmentState).success).toBe(true);
    expect(
      AssessmentGraphStateV1Schema.safeParse({
        ...assessmentState,
        retrievalSnippet: "forbidden",
      }).success,
    ).toBe(false);

    const topState = {
      schemaVersion: "1",
      graphVersion: policyRef,
      runRef: workflowRunRef,
      threadId: "thread-1",
      entryMode: "identify-and-assess",
      authorizationContextRef,
      status: "completed",
      stage: "result-summary",
      identificationRunRef: workflowRunRef,
      assessmentRunRefs: [workflowRunRef],
      waitingRefs: [],
      resultRef: runResultRef,
    };
    expect(RiskFlowStageV1Schema.safeParse("result-summary").success).toBe(true);
    expect(RiskFlowGraphStateV1Schema.safeParse(topState).success).toBe(true);
    expect(
      RiskFlowGraphStateV1Schema.safeParse({
        ...topState,
        status: "waiting",
        resultRef: undefined,
        waitingRefs: [],
      }).success,
    ).toBe(false);
    expect(
      RiskFlowGraphStateV1Schema.safeParse({
        ...topState,
        jsonLd: { "@context": "forbidden" },
      }).success,
    ).toBe(false);
  });

  it("uses strict snapshots and allows only resumable references", () => {
    expect(
      IdentificationPreparationSnapshotV1Schema.safeParse({
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRefs: [spatialScopeRef],
        sourceVersionRefs: [sourceVersionRef],
        includedSourceSegmentSetRef: version("source-segment-set"),
        excludedSegmentDecisionRefs: [],
        dataProcessingPolicyRef: policyRef,
        dataProcessingToolRef: policyRef,
        dataProcessingModelRef: policyRef,
        coverageDecisionRef: version("route-decision"),
        authorizationContextRef,
        auditTrailRef,
        createdBy: "actor-1",
        createdAt: now,
      }).success,
    ).toBe(true);
    expect(
      IdentificationInputSnapshotV1Schema.safeParse({
        schemaVersion: "1",
        preparationSnapshotRef: identificationPreparationRef,
        processModelReleaseRef: version("process-model-release"),
        riskMechanismReleaseRef: version("risk-mechanism-release"),
        retrievalEvidenceBaseReleaseRef: version("retrieval-evidence-base-release"),
        identificationPolicySetRef: version("identification-policy-set"),
        retrievalPolicyRef: policyRef,
        retrievalReviewAgentPolicyRef: policyRef,
        repairPolicyRef: policyRef,
        confidencePolicyRef: policyRef,
        forcedReviewPolicyRef: policyRef,
        retryPolicyRef: policyRef,
        modelDeploymentRef: policyRef,
        promptTemplateRef: policyRef,
        authorizationContextRef,
        auditTrailRef,
        createdBy: "actor-1",
        createdAt: now,
      }).success,
    ).toBe(true);
    expect(
      AssessmentPreparationSnapshotV1Schema.safeParse({
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRef,
        riskInput,
        applicabilityMetadataSnapshotRef,
        sourceEvidenceReferences: [
          {
            locator: { sourceSegmentId: "资料ID-章节ID-资料段ID" },
            sourceVersion: { entityId: "source", versionId: "v1" },
          },
        ],
        entryMode: "assess",
        triggerReasonCode: "manual",
        authorizationContextRef,
        auditTrailRef,
        createdBy: "actor-1",
        createdAt: now,
      }).success,
    ).toBe(true);
    expect(
      AssessmentInputSnapshotV1Schema.safeParse({
        schemaVersion: "1",
        preparationSnapshotRef: assessmentPreparationRef,
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
        authorizationContextRef,
        auditTrailRef,
        createdBy: "actor-1",
        createdAt: now,
      }).success,
    ).toBe(true);
  });
});
