import { Migrator } from "kysely/migration";

import type { PostgresConnectionConfig, PostgresPersistenceError } from "../pool.js";
import { createPostgresRuntime, mapPostgresError } from "../pool.js";
import {
  createPostgresMigrationProvider,
  type PostgresMigrationProviderOptions,
} from "./provider.js";

export interface PostgresMigrationRunConfig extends PostgresConnectionConfig {
  migrationRoot: string;
  additionalMigrationRoots?: readonly string[];
  migrationRoots?: readonly string[];
  connection?: PostgresConnectionConfig;
  loadModule?: PostgresMigrationProviderOptions["loadModule"];
  moduleLoader?: PostgresMigrationProviderOptions["moduleLoader"];
}

export interface PostgresMigrationRunResult {
  readonly applied: readonly string[];
}

export const runPostgresMigrations = async (
  config: PostgresMigrationRunConfig,
): Promise<PostgresMigrationRunResult> => {
  const connection = config.connection ?? config;
  const runtime = createPostgresRuntime(connection);
  try {
    const providerOptions = {
      migrationRoot: config.migrationRoot,
    } as PostgresMigrationProviderOptions;
    if (config.additionalMigrationRoots !== undefined) {
      providerOptions.additionalMigrationRoots = config.additionalMigrationRoots;
    }
    if (config.migrationRoots !== undefined) providerOptions.migrationRoots = config.migrationRoots;
    if (config.loadModule !== undefined) providerOptions.loadModule = config.loadModule;
    else if (config.moduleLoader !== undefined) providerOptions.moduleLoader = config.moduleLoader;
    const provider = createPostgresMigrationProvider(providerOptions);
    await provider.getMigrations();
    const migrator = new Migrator({
      db: runtime.db,
      provider,
      migrationTableName: "_riskflow_migration",
      migrationLockTableName: "_riskflow_migration_lock",
      migrationTableSchema: "business",
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
    return {
      applied: (result.results ?? [])
        .filter((item) => item.status === "Success")
        .map((item) => item.migrationName),
    };
  } catch (error) {
    if (isPostgresPersistenceError(error)) throw error;
    throw mapPostgresError(error, "migration.run", "MIGRATION_FAILED");
  } finally {
    await runtime.close();
  }
};

const isPostgresPersistenceError = (error: unknown): error is PostgresPersistenceError =>
  typeof error === "object" && error !== null && "code" in error && "retryable" in error;
