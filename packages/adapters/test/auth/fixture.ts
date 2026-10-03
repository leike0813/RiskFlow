import { resolve } from "node:path";

import type { PostgresConnectionConfig } from "../../src/postgres/pool.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import * as artifactManifestsMigration from "../../src/postgres/migrations/platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.js";
import * as foundationMigration from "../../src/postgres/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.js";
import * as authorizationMigration from "../../src/postgres/migrations/platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.js";
import * as reviewAuditMigration from "../../src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.js";
import * as agentTaskRuntimeMigration from "../../src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.js";
import * as agentProposalArtifactRefMigration from "../../src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000006_agent_proposal_artifact_ref.js";
import * as governedDefinitionLifecycleMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.js";
import * as engineeringContextSourceMigration from "../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.js";
import * as structuredDocumentConversionMigration from "../../src/postgres/migrations/engineering-data/deliver-structured-document-conversion/000009_structured_document_conversion.js";
import * as monitoringMigration from "../../src/postgres/migrations/engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.js";
import * as assessmentConfigurationMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.js";
import * as identificationKnowledgeGovernanceMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.js";
import * as agentCleaningPartialAvailabilityMigration from "../../src/postgres/migrations/engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.js";
import * as engineeringDataReadQueryResultsMigration from "../../src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.js";
import * as structuredScoringRulesMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.js";
import * as deterministicRiskAssessmentMigration from "../../src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.js";
import * as externalRiskEventRegistrationMigration from "../../src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.js";
import * as versionedHybridRetrievalMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.js";
import * as identificationContextResultsMigration from "../../src/postgres/migrations/risk-identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.js";
import * as riskCandidateFinalizationMigration from "../../src/postgres/migrations/risk-identification/deliver-risk-candidate-validation-merge-and-acceptance/000042_risk_candidate_finalization.js";
import * as identificationGraphMigration from "../../src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.js";
import * as warningTasksMigration from "../../src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.js";
import * as responseRecommendationMigration from "../../src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.js";
import * as executionForecastFeedbackDeviationMigration from "../../src/postgres/migrations/warning-response/deliver-execution-forecast-feedback-and-deviation/000046_execution_forecast_feedback_deviation.js";
import * as calibrationSuggestionGovernanceMigration from "../../src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.js";
import * as calibrationSuggestionLineageMigration from "../../src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000048_calibration_suggestion_lineage.js";
import * as formalZeroResultMigration from "../../src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.js";
import * as assessmentRiskflowGraphsMigration from "../../src/postgres/migrations/workflow/deliver-assessment-and-riskflow-graphs/000050_assessment_riskflow_graphs.js";
import * as graphTraceReportProjectionsMigration from "../../src/postgres/migrations/workflow/deliver-graph-trace-and-report-projections/000051_graph_trace_report_projections.js";
import * as qualityEvaluationReportIndexMigration from "../../src/postgres/migrations/query-projection/deliver-quality-evaluation-module/000052_quality_evaluation_report_index.js";
import * as humanDecisionFeedbackMigration from "../../src/postgres/migrations/warning-response/wire-human-decision-and-feedback-commands/000053_human_decision_feedback.js";
import * as riskRecordAssessmentScopeMigration from "../../src/postgres/migrations/risk-identification/deliver-assessment-warning-and-response-ui/000054_risk_record_assessment_scope.js";
import * as assessmentEntryCatalogCursorKeysMigration from "../../src/postgres/migrations/engineering-data/fix-assessment-entry-read-seam/000055_assessment_entry_catalog_cursor_keys.js";

export interface AuthPostgresFixture extends PostgresTestFixture {
  runMigrations(): Promise<void>;
}

export const startAuthPostgresFixture = async (): Promise<AuthPostgresFixture> => {
  const base = await startPostgresFixture();
  const migrationModules = new Map<string, unknown>([
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.ts",
      ),
      agentCleaningPartialAvailabilityMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.ts",
      ),
      monitoringMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts",
      ),
      assessmentConfigurationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.ts",
      ),
      identificationKnowledgeGovernanceMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.ts",
      ),
      engineeringDataReadQueryResultsMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts",
      ),
      structuredScoringRulesMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts",
      ),
      deterministicRiskAssessmentMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.ts",
      ),
      externalRiskEventRegistrationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.ts",
      ),
      versionedHybridRetrievalMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.ts",
      ),
      identificationContextResultsMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-identification/deliver-risk-candidate-validation-merge-and-acceptance/000042_risk_candidate_finalization.ts",
      ),
      riskCandidateFinalizationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-identification/deliver-identification-graph/000043_identification_graph.ts",
      ),
      identificationGraphMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts",
      ),
      warningTasksMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/deliver-response-recommendation/000045_response_recommendation.ts",
      ),
      responseRecommendationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/deliver-execution-forecast-feedback-and-deviation/000046_execution_forecast_feedback_deviation.ts",
      ),
      executionForecastFeedbackDeviationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.ts",
      ),
      calibrationSuggestionGovernanceMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/deliver-calibration-suggestion-and-governance-loop/000048_calibration_suggestion_lineage.ts",
      ),
      calibrationSuggestionLineageMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.ts",
      ),
      formalZeroResultMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "workflow/deliver-assessment-and-riskflow-graphs/000050_assessment_riskflow_graphs.ts",
      ),
      assessmentRiskflowGraphsMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "workflow/deliver-graph-trace-and-report-projections/000051_graph_trace_report_projections.ts",
      ),
      graphTraceReportProjectionsMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "query-projection/deliver-quality-evaluation-module/000052_quality_evaluation_report_index.ts",
      ),
      qualityEvaluationReportIndexMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "warning-response/wire-human-decision-and-feedback-commands/000053_human_decision_feedback.ts",
      ),
      humanDecisionFeedbackMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "risk-identification/deliver-assessment-warning-and-response-ui/000054_risk_record_assessment_scope.ts",
      ),
      riskRecordAssessmentScopeMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/fix-assessment-entry-read-seam/000055_assessment_entry_catalog_cursor_keys.ts",
      ),
      assessmentEntryCatalogCursorKeysMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.ts",
      ),
      foundationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.ts",
      ),
      artifactManifestsMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.ts",
      ),
      authorizationMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.ts",
      ),
      reviewAuditMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts",
      ),
      agentTaskRuntimeMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "agent-task/deliver-unified-bounded-agent-runtime/000006_agent_proposal_artifact_ref.ts",
      ),
      agentProposalArtifactRefMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts",
      ),
      governedDefinitionLifecycleMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.ts",
      ),
      engineeringContextSourceMigration,
    ],
    [
      resolve(
        base.productionMigrationRoot,
        "engineering-data/deliver-structured-document-conversion/000009_structured_document_conversion.ts",
      ),
      structuredDocumentConversionMigration,
    ],
  ]);
  const loadModule = async (filePath: string): Promise<unknown> => {
    const migration = migrationModules.get(filePath);
    if (migration !== undefined) return migration;
    throw new Error(`unexpected migration: ${filePath}`);
  };
  try {
    await runPostgresMigrations({
      connection: base.migrator,
      migrationRoot: base.productionMigrationRoot,
      loadModule,
    });
    const runtime = createPostgresRuntime(base.migrator, "riskflow_migrator");
    try {
      await reviewAuditMigration.down(runtime.db);
      await authorizationMigration.down(runtime.db);
      await authorizationMigration.up(runtime.db);
      await reviewAuditMigration.up(runtime.db);
    } finally {
      await runtime.close();
    }
  } catch (error) {
    await base.close();
    throw error;
  }
  const app = base.app as PostgresConnectionConfig;
  return {
    ...base,
    app,
    async runMigrations() {
      await runPostgresMigrations({
        connection: base.migrator,
        migrationRoot: base.productionMigrationRoot,
        loadModule,
      });
    },
  };
};
