import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";

import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import * as humanDecisionFeedbackMigration from "../../src/postgres/migrations/warning-response/wire-human-decision-and-feedback-commands/000051_human_decision_feedback.js";

const C41_TABLES = ["human_response_decisions", "human_feedback_input_snapshots"] as const;

/** 终局互斥与唯一索引是 C41 的持久化契约：迁移可重入时必须完整保留。 */
const C41_CONSTRAINTS = [
  "human_response_decisions_audit_fk",
  "human_feedback_input_snapshots_audit_fk",
  "human_response_decisions_recommendation_uidx",
  "human_response_decisions_route_uidx",
  "human_response_decisions_settlement_ck",
  "human_feedback_input_snapshots_command_uidx",
  "human_feedback_input_snapshots_state_ck",
] as const;

describe("C41 迁移可重入", () => {
  let fixture: PostgresTestFixture;
  let runtime: PostgresRuntime;
  let db: Kysely<unknown>;

  const c41TableCount = async (): Promise<number> => {
    const result = await fixture.adminPool.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM information_schema.tables
        WHERE table_schema = 'business'
          AND table_name = ANY($1)`,
      [[...C41_TABLES]],
    );
    return result.rows[0]?.total ?? 0;
  };

  const c41ConstraintCount = async (): Promise<number> => {
    const result = await sql<{ total: number }>`
      SELECT count(*)::int AS total FROM pg_constraint WHERE conname = ANY(${C41_CONSTRAINTS as never})
    `.execute(db);
    return result.rows[0]?.total ?? 0;
  };

  beforeAll(async () => {
    fixture = await startPostgresFixture();
    await runPostgresMigrations({
      ...fixture.migrator,
      migrationRoot: fixture.productionMigrationRoot,
    });
    runtime = createPostgresRuntime(fixture.migrator);
    db = runtime.db as unknown as Kysely<unknown>;
  }, 300_000);

  afterAll(async () => {
    await runtime.close();
    await fixture.close();
  }, 300_000);

  it("up 与 down 可重复执行且保留唯一索引与终局约束", async () => {
    expect(await c41TableCount()).toBe(C41_TABLES.length);
    expect(await c41ConstraintCount()).toBe(C41_CONSTRAINTS.length);

    // 第二次 up：全部 DDL 与约束必须幂等。
    await humanDecisionFeedbackMigration.up(db);
    expect(await c41TableCount()).toBe(C41_TABLES.length);
    expect(await c41ConstraintCount()).toBe(C41_CONSTRAINTS.length);

    // 第一次 down 删表与权限，第二次 down 必须在已删表上仍然成功。
    await humanDecisionFeedbackMigration.down(db);
    expect(await c41TableCount()).toBe(0);
    await humanDecisionFeedbackMigration.down(db);
    expect(await c41TableCount()).toBe(0);

    // 删净后再次 up 应能完整重建表、唯一索引与终局约束。
    await humanDecisionFeedbackMigration.up(db);
    expect(await c41TableCount()).toBe(C41_TABLES.length);
    expect(await c41ConstraintCount()).toBe(C41_CONSTRAINTS.length);
  }, 300_000);
});
