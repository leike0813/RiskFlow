import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import type { PostgresRuntime } from "../../src/postgres/pool.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import { ArtifactMaintenance } from "../../src/artifacts/maintenance.js";
import {
  createFilesystemArtifactStore,
  type ArtifactFailpointV1,
} from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

export const ARTIFACT_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

export const artifactPolicy = (
  overrides: Partial<ArtifactStorePolicyV1> = {},
): ArtifactStorePolicyV1 => ({
  schemaVersion: "1",
  policyRef: { entityId: "artifact-policy", versionId: "v1" },
  maxArtifactBytes: 512 * 1024 * 1024,
  maxConcurrentWrites: 4,
  maxConcurrentReads: 4,
  stagingMaxBytes: 768 * 1024 * 1024,
  orphanGracePeriodMs: 10_000,
  registrationTimeoutMs: 1_000,
  maintenanceBatchSize: 250,
  ...overrides,
});

export interface ArtifactTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly rootDirectory: string;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly registry: PostgresArtifactRegistry;
  readonly store: Awaited<ReturnType<typeof createFilesystemArtifactStore>>;
  readonly maintenance: ArtifactMaintenance;
  close(): Promise<void>;
}

export const startArtifactFixture = async (
  options: {
    readonly policy?: ArtifactStorePolicyV1;
    readonly now?: () => Date;
    readonly failpoint?: (point: ArtifactFailpointV1) => void | Promise<void>;
  } = {},
): Promise<ArtifactTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c04-artifacts-"));
    const policy = options.policy ?? artifactPolicy();
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
      failpoint: options.failpoint,
    });
    try {
      const store = await createFilesystemArtifactStore({
        rootDirectory,
        policy,
        registry,
        transactionUnit,
        now: options.now,
        failpoint: options.failpoint,
      });
      const maintenance = new ArtifactMaintenance({
        rootDirectory,
        policy,
        store,
        registry,
        now: options.now,
        failpoint: options.failpoint,
      });
      return {
        postgres,
        rootDirectory,
        runtime,
        transactionUnit,
        registry,
        store,
        maintenance,
        async close() {
          await store.close();
          await runtime.close();
          await rm(rootDirectory, { recursive: true, force: true });
          await postgres.close();
        },
      };
    } catch (error) {
      await runtime.close().catch(() => undefined);
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
