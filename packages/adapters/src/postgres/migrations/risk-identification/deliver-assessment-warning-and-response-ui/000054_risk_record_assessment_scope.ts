import { sql, type Kysely } from "kysely";

/**
 * C34 待评估目录的登记事实（用户已批准扩出本 change 白名单）：
 * 标准化风险记录此前只登记资料段与机理条目，既无空间范围也无来源版本，下游评估启动上下文
 * 无据可依。这里把接受分组时按成员工作项从已登记工作计划取出的三项事实落到记录行上。
 *
 * 三列都必须可空：`standardized_risk_records` 只授予 SELECT/INSERT，应用角色没有 UPDATE，
 * 历史行无法回填。可空同时让 CHECK 表达「新行必须带齐、旧行原样保留」：读侧对缺登记事实的
 * 记录按 blocked 关闭，而不是把无据的范围当作空范围。
 */
const recordsTable = "business.standardized_risk_records";
const scopeColumns = ["spatial_scope_refs", "source_version_refs", "evidence_references"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const column of scopeColumns) {
    await sql`ALTER TABLE ${sql.raw(recordsTable)}
      ADD COLUMN IF NOT EXISTS ${sql.raw(column)} jsonb`.execute(db);
  }
  // 三列要么整体缺席（历史行），要么都是非空 JSON 数组（登记即定型，禁止半份事实）。
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'standardized_risk_records_assessment_scope_ck'
      ) THEN
        ALTER TABLE ${sql.raw(recordsTable)}
          ADD CONSTRAINT standardized_risk_records_assessment_scope_ck
          CHECK (
            (spatial_scope_refs IS NULL AND source_version_refs IS NULL
              AND evidence_references IS NULL)
            OR (jsonb_typeof(spatial_scope_refs) = 'array'
              AND jsonb_typeof(source_version_refs) = 'array'
              AND jsonb_typeof(evidence_references) = 'array'
              AND jsonb_array_length(spatial_scope_refs) > 0
              AND jsonb_array_length(source_version_refs) > 0)
          );
      END IF;
    END
    $$;
  `.execute(db);
  // 读侧按「已登记空间范围」过滤待评估候选，这是一次有界扫描，不建索引：
  // 记录表规模等于已接受的风险组数量，且目录已有 created_at 排序与授权摘要有界过滤。
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE ${sql.raw(recordsTable)}
      DROP CONSTRAINT IF EXISTS standardized_risk_records_assessment_scope_ck
  `.execute(db);
  for (const column of scopeColumns) {
    await sql`ALTER TABLE ${sql.raw(recordsTable)}
      DROP COLUMN IF EXISTS ${sql.raw(column)}`.execute(db);
  }
}
