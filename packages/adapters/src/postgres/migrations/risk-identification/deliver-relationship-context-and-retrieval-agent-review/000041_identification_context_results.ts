import { sql, type Kysely, type SqlBool } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const table = "business.identification_context_results";
const relationshipQueryIndex = "identification_context_results_relationship_query_uidx";

const resultKinds = ["relationship", "reviewed-retrieval", "model-context"] as const;

const objectColumn = (column: string) => sql`jsonb_typeof(${sql.raw(column)}) = 'object'`;
const nullableObjectColumn = (column: string) =>
  sql`(${sql.raw(column)} IS NULL OR jsonb_typeof(${sql.raw(column)}) = 'object')`;

/** 必填 JSONB 只存结构化引用；可空引用列出现时同样必须是对象，正文永不入库。 */
const objectColumns = [
  "artifact_ref",
  "input_snapshot_ref",
  "work_item_ref",
  "authorization_context_ref",
].map(objectColumn);

const nullableObjectColumns = [
  "knowledge_query_result_ref",
  "agent_task_ref",
  "baseline_query_result_ref",
  "retrieval_artifact_set_ref",
  "relationship_query_result_ref",
  "model_context_artifact_set_ref",
].map(nullableObjectColumn);

/**
 * 三类结果的完整引用形状由核心严格判别 Schema 唯一限定，这里只允许本类专列非空、
 * 它类专列为空，并保留 `result_kind <> 'relationship' OR query_id IS NOT NULL` 的直达约束。
 */
const kindPairings = sql`(
  (result_kind = 'relationship'
    AND query_id IS NOT NULL AND knowledge_query_result_ref IS NOT NULL
    AND agent_task_ref IS NULL AND baseline_query_result_ref IS NULL
    AND relationship_query_result_ref IS NULL AND model_context_artifact_set_ref IS NULL)
  OR (result_kind = 'reviewed-retrieval'
    AND agent_task_ref IS NOT NULL AND baseline_query_result_ref IS NOT NULL
    AND retrieval_artifact_set_ref IS NOT NULL
    AND query_id IS NULL AND knowledge_query_result_ref IS NULL
    AND relationship_query_result_ref IS NULL AND model_context_artifact_set_ref IS NULL)
  OR (result_kind = 'model-context'
    AND relationship_query_result_ref IS NOT NULL AND retrieval_artifact_set_ref IS NOT NULL
    AND model_context_artifact_set_ref IS NOT NULL
    AND query_id IS NULL AND knowledge_query_result_ref IS NULL
    AND agent_task_ref IS NULL AND baseline_query_result_ref IS NULL)
)`;

/**
 * 审计外键必须延迟：C03 事务单元先跑 handler 再由事务写审计行，
 * 同一事务内插入顺序不保证。迁移必须可重复执行，DO 块内不能使用绑定参数，故按字面量内联。
 */
const guardAuditForeignKey = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  const constraint = `${tableName.split(".")[1]}_audit_fk`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(constraint)}'
          AND conrelid = '${sql.raw(tableName)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(tableName)}
          ADD CONSTRAINT ${sql.raw(constraint)}
          FOREIGN KEY (audit_entry_id)
          REFERENCES audit.entries(audit_entry_id)
          DEFERRABLE INITIALLY DEFERRED;
      END IF;
    END
    $$;
  `.execute(db);
};

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(table)}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  // 正式结果只由项目应用与 Outbox 消费事务登记，且只追加；两者都需要读回对账。
  for (const role of ["riskflow_app", "riskflow_outbox_worker"]) {
    await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(table)} TO ${sql.raw(role)}`.execute(db);
    await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(table)} FROM ${sql.raw(role)}`.execute(db);
  }
};

/**
 * C21 正式结果登记（design D-03）：一张追加表承载关系结果、正式检索工件集与五项上下文的
 * 精确输出引用，键为 `(project_id, result_kind, result_id, result_version_id)`，
 * 关系行另受 `(project_id, query_id)` 条件唯一约束；正文只在 C04，本表不存正文或模型响应。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(table)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("result_kind", "text", (column) => column.notNull())
    .addColumn("result_id", "text", (column) => column.notNull())
    .addColumn("result_version_id", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("work_item_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("query_id", "text")
    .addColumn("knowledge_query_result_ref", jsonb)
    .addColumn("agent_task_ref", jsonb)
    .addColumn("baseline_query_result_ref", jsonb)
    .addColumn("retrieval_artifact_set_ref", jsonb)
    .addColumn("relationship_query_result_ref", jsonb)
    .addColumn("model_context_artifact_set_ref", jsonb)
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("identification_context_results_pk", [
      "project_id",
      "result_kind",
      "result_id",
      "result_version_id",
    ])
    .addCheckConstraint(
      "identification_context_results_identity_ck",
      sql`project_id <> '' AND result_id <> '' AND result_version_id <> ''
        AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "identification_context_results_kind_ck",
      sql`result_kind IN (${sql.join(
        resultKinds.map((kind) => sql.lit(kind)),
        sql`, `,
      )}) AND ${kindPairings}`,
    )
    .addCheckConstraint(
      "identification_context_results_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "identification_context_results_json_ck",
      sql.join([...objectColumns, ...nullableObjectColumns], sql` AND `),
    )
    .execute();

  // 关系结果按稳定 queryId 精确回读；同 queryId 的异载荷登记必须被拦下，不能追加第二行。
  await db.schema
    .createIndex(relationshipQueryIndex)
    .ifNotExists()
    .unique()
    .on(table)
    .columns(["project_id", "query_id"])
    .where(sql<SqlBool>`result_kind = 'relationship'`)
    .execute();

  await guardAuditForeignKey(db, table);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(table)}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema.dropIndex(relationshipQueryIndex).ifExists().execute();
  await db.schema.dropTable(table).ifExists().execute();
}
