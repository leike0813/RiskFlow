import type { PostgresRuntime } from "../../src/postgres/pool.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import { PostgresRetrievalAdapter } from "../../src/retrieval/postgres-retrieval-adapter.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

export interface RetrievalTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly adapter: PostgresRetrievalAdapter;
  close(): Promise<void>;
}

/**
 * C20 夹具：跑完整生产迁移链（000040 依赖 audit/command_receipts 等既有 schema），
 * 以 riskflow_app 会话构造适配器，另以 riskflow_migrator 会话验证迁移 up/down。
 */
export const startRetrievalFixture = async (): Promise<RetrievalTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const migratorRuntime = createPostgresRuntime(postgres.migrator, "riskflow_migrator");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const adapter = new PostgresRetrievalAdapter({ db: runtime.db, transactionUnit });
    return {
      postgres,
      runtime,
      migratorRuntime,
      transactionUnit,
      adapter,
      async close() {
        await runtime.close().catch(() => undefined);
        await migratorRuntime.close().catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
