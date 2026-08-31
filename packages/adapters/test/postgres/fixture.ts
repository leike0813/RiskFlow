import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

import { bootstrapPostgresFoundation } from "../../src/postgres/bootstrap.js";
import type { PostgresConnectionConfig } from "../../src/postgres/pool.js";

export const POSTGRES_TEST_IMAGE =
  "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af";

const ROOT_PASSWORD = "riskflow-root-password";
const ROLE_PASSWORD = "riskflow-role-password";

const roleNames = [
  ["riskflow_migrator_login", "riskflow_migrator"],
  ["riskflow_app_login", "riskflow_app"],
  ["riskflow_outbox_worker_login", "riskflow_outbox_worker"],
  ["riskflow_checkpointer_login", "riskflow_checkpointer"],
] as const;

export interface PostgresTestFixture {
  readonly container: StartedPostgreSqlContainer;
  readonly admin: PostgresConnectionConfig;
  readonly migrator: PostgresConnectionConfig;
  readonly app: PostgresConnectionConfig;
  readonly worker: PostgresConnectionConfig;
  readonly checkpointer: PostgresConnectionConfig;
  readonly adminPool: Pool;
  readonly productionMigrationRoot: string;
  readonly fixtureMigrationRoot: string;
  close(): Promise<void>;
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const startPostgresFixture = async (): Promise<PostgresTestFixture> => {
  const container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
    .withDatabase("riskflow")
    .withUsername("postgres")
    .withPassword(ROOT_PASSWORD)
    .start();
  const base: PostgresConnectionConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    max: 8,
    connectionTimeoutMillis: 10_000,
  };
  const admin: PostgresConnectionConfig = {
    ...base,
    user: "postgres",
    password: ROOT_PASSWORD,
    applicationName: "riskflow-test-admin",
  };
  const adminPool = new Pool(admin);
  try {
    await bootstrapPostgresFoundation(admin);
    for (const [loginRole, groupRole] of roleNames) {
      await adminPool.query(
        `CREATE ROLE ${quoteIdentifier(loginRole)} LOGIN PASSWORD '${ROLE_PASSWORD}' IN ROLE ${quoteIdentifier(groupRole)}`,
      );
    }
  } catch (error) {
    await adminPool.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
    throw error;
  }

  const roleConfig = (user: string, applicationName: string): PostgresConnectionConfig => ({
    ...base,
    user,
    password: ROLE_PASSWORD,
    applicationName,
  });
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const productionMigrationRoot = resolve(fixtureDir, "../../src/postgres/migrations");
  const fixtureMigrationRoot = resolve(fixtureDir, "fixtures/migrations");

  return {
    container,
    admin,
    migrator: roleConfig("riskflow_migrator_login", "riskflow-test-migrator"),
    app: roleConfig("riskflow_app_login", "riskflow-test-app"),
    worker: roleConfig("riskflow_outbox_worker_login", "riskflow-test-worker"),
    checkpointer: roleConfig("riskflow_checkpointer_login", "riskflow-test-checkpointer"),
    adminPool,
    productionMigrationRoot,
    fixtureMigrationRoot,
    async close() {
      await adminPool.end();
      await container.stop();
    },
  };
};
