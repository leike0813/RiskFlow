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

export interface AuthPostgresFixture extends PostgresTestFixture {
  runMigrations(): Promise<void>;
}

export const startAuthPostgresFixture = async (): Promise<AuthPostgresFixture> => {
  const base = await startPostgresFixture();
  const migrationModules = new Map<string, unknown>([
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
