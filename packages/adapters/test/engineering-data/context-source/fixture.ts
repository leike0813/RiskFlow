import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import {
  createFilesystemArtifactStore,
  type FilesystemArtifactStore,
} from "../../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
import { artifactPolicy } from "../../artifacts/fixture.js";
import {
  createPostgresLocalIdentityAccess,
  type PostgresLocalIdentityAccess,
} from "../../../src/auth/postgres-local-identity-access.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
import { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
import { startPostgresFixture, type PostgresTestFixture } from "../../postgres/fixture.js";
import {
  PostgresEngineeringContextSourceRegistry,
  type PostgresEngineeringContextSourceRegistryOptions,
} from "../../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";

export const CONTEXT_SOURCE_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

export interface EngineeringContextSourcePostgresFixture {
  readonly postgres: PostgresTestFixture;
  readonly rootDirectory: string;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly artifactRegistry: PostgresArtifactRegistry;
  readonly artifactStore: FilesystemArtifactStore;
  readonly access: PostgresLocalIdentityAccess;
  readonly registry: PostgresEngineeringContextSourceRegistry;
  close(): Promise<void>;
}

export const contextSourcePolicy = (
  overrides: Partial<ArtifactStorePolicyV1> = {},
): ArtifactStorePolicyV1 => artifactPolicy(overrides);

export const startEngineeringContextSourceFixture = async (
  options: {
    readonly now?: () => Date;
    readonly policy?: ArtifactStorePolicyV1;
    readonly registryOptions?: Partial<
      Omit<
        PostgresEngineeringContextSourceRegistryOptions,
        "db" | "transactionUnit" | "access" | "artifactStore" | "artifactReferenceGuard"
      >
    >;
  } = {},
): Promise<EngineeringContextSourcePostgresFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c11-context-source-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const artifactRegistry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const policy = options.policy ?? contextSourcePolicy();
    try {
      const artifactStore = await createFilesystemArtifactStore({
        rootDirectory,
        policy,
        registry: artifactRegistry,
        transactionUnit,
        now: options.now,
      });
      const access = createPostgresLocalIdentityAccess({
        ...postgres.app,
        hmacKey: new Uint8Array(32).fill(7),
        keyVersion: "test-key-v1",
        now: options.now,
      });
      const registry = new PostgresEngineeringContextSourceRegistry({
        db: runtime.db,
        transactionUnit,
        access,
        artifactStore,
        artifactReferenceGuard: artifactRegistry,
        now: options.now,
        ...options.registryOptions,
      });
      return {
        postgres,
        rootDirectory,
        runtime,
        transactionUnit,
        artifactRegistry,
        artifactStore,
        access,
        registry,
        async close() {
          await artifactStore.close();
          await access.close();
          await runtime.close();
          await rm(rootDirectory, { recursive: true, force: true });
          await postgres.close();
        },
      };
    } catch (error) {
      await artifactRegistry.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
