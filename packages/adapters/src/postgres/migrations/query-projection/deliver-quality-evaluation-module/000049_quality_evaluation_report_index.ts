import { sql, type Kysely } from "kysely";

const table = "business.quality_evaluation_report_index" as const;
const listIndex = "quality_evaluation_report_index_list_idx" as const;
const commandIndex = "quality_evaluation_report_index_command_uidx" as const;
const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

// 迁移必须可重复执行：REVOKE 用 DO 块按表名动态执行，DO 块内不能使用绑定参数，故全部按字面量内联。
const revokeAll = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    DO $$
    BEGIN
      IF to_regclass('${sql.raw(table)}') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(table)}
          FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer;
      END IF;
    END
    $$;
  `.execute(db);
};

/**
 * C36 只追加索引（D-05）：只保存页面查询所需的受限摘要与精确 C04 工件引用，
 * 不含数据集正文、样例标签、配置正文或原始模型响应。
 *
 * 本表按 D-05 决策不设任何外键：C04 工件引用由授权 `open` 与 manifest 守卫验证，
 * 命令身份由本表唯一约束保证，避免与其它 change 的 migration 回滚互相锁定。
 * 仅授权风险应用 SELECT/INSERT，索引本身可由正式 C04 报告与 C03 审计重建。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(table)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("report_artifact_id", "text", (column) => column.notNull())
    .addColumn("report_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("project_revision_id", "text", (column) => column.notNull())
    .addColumn("project_revision_version_id", "text", (column) => column.notNull())
    .addColumn("dataset_artifact_id", "text", (column) => column.notNull())
    .addColumn("dataset_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("sample_kind", "text", (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("summary_digest", "char(64)", (column) => column.notNull())
    .addColumn("report_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("dataset_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("summary_payload", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("quality_evaluation_report_index_pk", [
      "project_id",
      "report_artifact_id",
      "report_artifact_version_id",
    ])
    .addUniqueConstraint(commandIndex, ["project_id", "command_id"])
    .addCheckConstraint(
      "quality_evaluation_report_index_identity_ck",
      sql`project_id <> '' AND report_artifact_id <> '' AND report_artifact_version_id <> ''
        AND project_revision_id <> '' AND project_revision_version_id <> ''
        AND dataset_artifact_id <> '' AND dataset_artifact_version_id <> ''
        AND command_id <> '' AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "quality_evaluation_report_index_sample_kind_ck",
      sql`sample_kind IN ('deidentified-real', 'synthetic')`,
    )
    .addCheckConstraint(
      "quality_evaluation_report_index_spatial_scopes_ck",
      sql`jsonb_typeof(spatial_scope_refs) = 'array' AND jsonb_array_length(spatial_scope_refs) > 0`,
    )
    .addCheckConstraint(
      "quality_evaluation_report_index_summary_digest_ck",
      sql`summary_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "quality_evaluation_report_index_summary_size_ck",
      sql`octet_length(summary_payload::text) <= 65536`,
    )
    .execute();

  // keyset 列表分页需要 (project_id, project_revision_id) 上的 created_at 降序索引；
  // kysely schema builder 不支持 DESC 排序，故按原样 SQL 建索引并保持幂等。
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.raw(listIndex)}
      ON ${sql.raw(table)} (project_id, project_revision_id, created_at DESC, report_artifact_id DESC, report_artifact_version_id DESC)
  `.execute(db);

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(table)} TO riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(listIndex)}`.execute(db);
  await db.schema.dropTable(table).ifExists().execute();
}
