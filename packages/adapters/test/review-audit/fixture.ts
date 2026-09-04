import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

export const REVIEW_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

export interface ReviewAuditPostgresFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  close(): Promise<void>;
}

export const startReviewAuditFixture = async (): Promise<ReviewAuditPostgresFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
    });
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    return {
      postgres,
      runtime,
      transactionUnit,
      async close() {
        await runtime.close();
        await postgres.close();
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
