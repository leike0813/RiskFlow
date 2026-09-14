import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";

import { startRiskAssessmentEngineFixture, type RiskAssessmentEngineFixtureV1 } from "./fixture.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import * as deterministicRiskAssessmentMigration from "../../src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.js";

const AUDIT_FOREIGN_KEYS = [
  "assessment_preparation_snapshots_audit_fk",
  "assessment_input_snapshots_audit_fk",
  "risk_assessment_records_audit_fk",
];

describe("C25 迁移可重入", () => {
  let fixture: RiskAssessmentEngineFixtureV1;
  let runtime: PostgresRuntime;
  let db: Kysely<unknown>;

  const auditForeignKeyCount = async (): Promise<number> => {
    const result = await sql<{ total: number }>`
      SELECT count(*)::int AS total FROM pg_constraint WHERE conname = ANY(${AUDIT_FOREIGN_KEYS})
    `.execute(db);
    return result.rows[0]?.total ?? 0;
  };

  const c25TableCount = async (): Promise<number> => {
    const result = await fixture.postgres.postgres.adminPool.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM information_schema.tables
        WHERE table_schema = 'business'
          AND table_name IN (
            'assessment_preparation_snapshots',
            'assessment_input_snapshots',
            'indicator_actual_value_sets',
            'assessment_decision_artifacts',
            'risk_assessment_records'
          )`,
    );
    return result.rows[0]?.total ?? 0;
  };

  beforeAll(async () => {
    fixture = await startRiskAssessmentEngineFixture();
    runtime = createPostgresRuntime(fixture.postgres.postgres.migrator);
    db = runtime.db as unknown as Kysely<unknown>;
  }, 300_000);

  afterAll(async () => {
    await runtime.close();
    await fixture.postgres.close();
  }, 300_000);

  it("up 与 down 可重复执行且不重复创建审计外键", async () => {
    expect(await c25TableCount()).toBe(5);
    expect(await auditForeignKeyCount()).toBe(3);

    // 第二次 up：全部 DDL 与约束必须幂等。
    await deterministicRiskAssessmentMigration.up(db);
    expect(await auditForeignKeyCount()).toBe(3);

    // 第一次 down 删表与权限，第二次 down 必须在已删表上仍然成功。
    await deterministicRiskAssessmentMigration.down(db);
    expect(await c25TableCount()).toBe(0);
    await deterministicRiskAssessmentMigration.down(db);
    expect(await c25TableCount()).toBe(0);

    // 删净后再次 up 应能完整重建表、约束与授权。
    await deterministicRiskAssessmentMigration.up(db);
    expect(await c25TableCount()).toBe(5);
    expect(await auditForeignKeyCount()).toBe(3);
  }, 300_000);
});
