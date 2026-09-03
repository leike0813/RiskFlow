import { resolve } from "node:path";

import type { PostgresConnectionConfig } from "../../src/postgres/pool.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import * as artifactManifestsMigration from "../../src/postgres/migrations/platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.js";
import * as foundationMigration from "../../src/postgres/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.js";
import * as authorizationMigration from "../../src/postgres/migrations/platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.js";

export interface AuthPostgresFixture extends PostgresTestFixture {
  runMigrations(): Promise<void>;
}

export const startAuthPostgresFixture = async (): Promise<AuthPostgresFixture> => {
  const base = await startPostgresFixture();
  const migrationModules = new Map<string, unknown>([
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
      await authorizationMigration.down(runtime.db);
      await authorizationMigration.up(runtime.db);
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
