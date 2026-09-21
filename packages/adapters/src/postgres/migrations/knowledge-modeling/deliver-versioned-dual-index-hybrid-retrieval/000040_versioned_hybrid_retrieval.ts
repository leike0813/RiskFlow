import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const tables = [
  "business.retrieval_generations",
  "business.retrieval_generation_transitions",
  "business.retrieval_activations",
  "business.retrieval_query_results",
] as const;

const generationStatuses = ["building", "ready", "active", "superseded", "failed"] as const;

// 代际身份输入：除 generation 自身引用外的全部规范化输入。版本摘要即这些输入的
// 规范哈希，因此这里再设唯一约束可拦下“相同发布、不同摘要”的手写行。
const identityColumns = [
  "project_id",
  "source_event_id",
  "evidence_base_release_entity_id",
  "evidence_base_release_version_id",
  "risk_mechanism_release_entity_id",
  "risk_mechanism_release_version_id",
  "standard_library_release_entity_id",
  "standard_library_release_version_id",
  "case_library_release_entity_id",
  "case_library_release_version_id",
  "policy_entity_id",
  "policy_version_id",
  "model_deployment_entity_id",
  "model_deployment_version_id",
  "projection_compatibility_entity_id",
  "projection_compatibility_version_id",
] as const;

const releasePairs = [
  ["evidence_base_release_entity_id", "evidence_base_release_version_id"],
  ["risk_mechanism_release_entity_id", "risk_mechanism_release_version_id"],
  ["standard_library_release_entity_id", "standard_library_release_version_id"],
  ["case_library_release_entity_id", "case_library_release_version_id"],
  ["policy_entity_id", "policy_version_id"],
  ["model_deployment_entity_id", "model_deployment_version_id"],
  ["projection_compatibility_entity_id", "projection_compatibility_version_id"],
] as const;

const nonEmptyReleasePairs = sql.join(
  releasePairs.map(
    ([entityColumn, versionColumn]) =>
      sql`${sql.raw(entityColumn)} <> '' AND ${sql.raw(versionColumn)} <> ''`,
  ),
  sql` AND `,
);

/**
 * 审计外键必须延迟：C03 事务单元先跑 handler 再由事务写审计行，
 * 同一事务内插入顺序不保证。迁移必须可重复执行，DO 块内不能使用绑定参数，故按字面量内联。
 */
const guardAuditForeignKey = async (db: Kysely<unknown>, table: string): Promise<void> => {
  const constraint = `${table.split(".")[1]}_audit_fk`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(constraint)}'
          AND conrelid = '${sql.raw(table)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(table)}
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
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  // 只有项目应用与 Outbox 消费事务写入这些事实，且只追加；两者都需要读回对账。
  for (const role of ["riskflow_app", "riskflow_outbox_worker"]) {
    await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO ${sql.raw(role)}`.execute(
      db,
    );
    await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM ${sql.raw(role)}`.execute(
      db,
    );
  }
};

/**
 * C20 检索事实模型（design D8）：代际身份、只追加状态、只追加激活与查询结果登记。
 * 正文永不入库：只保存受约束的引用、摘要、成员数与对账清单摘要。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.retrieval_generations")
    .ifNotExists()
    .addColumn("generation_id", "text", (column) => column.notNull())
    .addColumn("generation_version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("source_event_id", "text", (column) => column.notNull())
    .addColumn("evidence_base_release_entity_id", "text", (column) => column.notNull())
    .addColumn("evidence_base_release_version_id", "text", (column) => column.notNull())
    .addColumn("risk_mechanism_release_entity_id", "text", (column) => column.notNull())
    .addColumn("risk_mechanism_release_version_id", "text", (column) => column.notNull())
    .addColumn("standard_library_release_entity_id", "text", (column) => column.notNull())
    .addColumn("standard_library_release_version_id", "text", (column) => column.notNull())
    .addColumn("case_library_release_entity_id", "text", (column) => column.notNull())
    .addColumn("case_library_release_version_id", "text", (column) => column.notNull())
    .addColumn("policy_entity_id", "text", (column) => column.notNull())
    .addColumn("policy_version_id", "text", (column) => column.notNull())
    .addColumn("model_deployment_entity_id", "text", (column) => column.notNull())
    .addColumn("model_deployment_version_id", "text", (column) => column.notNull())
    .addColumn("projection_compatibility_entity_id", "text", (column) => column.notNull())
    .addColumn("projection_compatibility_version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("expected_member_count", "integer", (column) => column.notNull())
    .addColumn("manifest_sha256", "char(64)", (column) => column.notNull())
    .addColumn("collection_name", "text", (column) => column.notNull())
    .addColumn("created_by", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("retrieval_generations_pk", ["generation_id", "generation_version_id"])
    .addUniqueConstraint("retrieval_generations_identity_uidx", [...identityColumns])
    .addCheckConstraint(
      "retrieval_generations_identity_ck",
      sql`generation_id <> '' AND generation_version_id <> '' AND schema_version <> ''
        AND source_event_id <> '' AND project_id <> '' AND collection_name <> ''
        AND created_by <> '' AND expected_member_count >= 0
        AND ${nonEmptyReleasePairs}`,
    )
    .addCheckConstraint(
      "retrieval_generations_digest_ck",
      sql`authorization_scope_digest ~ ${digestPattern}
        AND manifest_sha256 ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "retrieval_generations_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();
  // 审计外键在四张表建好后统一以延迟约束补齐（见 guardAuditForeignKey）。

  await db.schema
    .createTable("business.retrieval_generation_transitions")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("generation_id", "text", (column) => column.notNull())
    .addColumn("generation_version_id", "text", (column) => column.notNull())
    .addColumn("ordinal", "integer", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("manifest_sha256", "char(64)")
    .addColumn("failure_code", "text")
    .addColumn("note_code", "text")
    .addColumn("transition_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("context_refs", jsonb, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("retrieval_generation_transitions_pk", [
      "generation_id",
      "generation_version_id",
      "ordinal",
    ])
    .addForeignKeyConstraint(
      "retrieval_generation_transitions_generation_fk",
      ["generation_id", "generation_version_id"],
      "business.retrieval_generations",
      ["generation_id", "generation_version_id"],
    )
    .addCheckConstraint(
      "retrieval_generation_transitions_identity_ck",
      sql`project_id <> '' AND generation_id <> '' AND generation_version_id <> ''
        AND ordinal > 0 AND actor_ref <> ''
        AND status IN (${sql.join(
          generationStatuses.map((status) => sql.lit(status)),
          sql`, `,
        )})
        AND (status <> 'ready' OR manifest_sha256 IS NOT NULL)
        AND (status <> 'failed' OR failure_code IS NOT NULL)`,
    )
    .addCheckConstraint(
      "retrieval_generation_transitions_digest_ck",
      sql`manifest_sha256 IS NULL OR manifest_sha256 ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "retrieval_generation_transitions_json_ck",
      sql`jsonb_typeof(transition_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(context_refs) = 'array'`,
    )
    .execute();

  await db.schema
    .createTable("business.retrieval_activations")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("evidence_base_release_entity_id", "text", (column) => column.notNull())
    .addColumn("evidence_base_release_version_id", "text", (column) => column.notNull())
    .addColumn("activation_ordinal", "integer", (column) => column.notNull())
    .addColumn("generation_id", "text", (column) => column.notNull())
    .addColumn("generation_version_id", "text", (column) => column.notNull())
    .addColumn("previous_generation_id", "text")
    .addColumn("previous_generation_version_id", "text")
    .addColumn("policy_entity_id", "text", (column) => column.notNull())
    .addColumn("policy_version_id", "text", (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("context_refs", jsonb, (column) => column.notNull())
    .addColumn("activated_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("retrieval_activations_pk", [
      "project_id",
      "evidence_base_release_entity_id",
      "evidence_base_release_version_id",
      "activation_ordinal",
    ])
    .addForeignKeyConstraint(
      "retrieval_activations_generation_fk",
      ["generation_id", "generation_version_id"],
      "business.retrieval_generations",
      ["generation_id", "generation_version_id"],
    )
    .addCheckConstraint(
      "retrieval_activations_identity_ck",
      sql`project_id <> '' AND evidence_base_release_entity_id <> ''
        AND evidence_base_release_version_id <> '' AND activation_ordinal > 0
        AND generation_id <> '' AND generation_version_id <> '' AND actor_ref <> ''
        AND policy_entity_id <> '' AND policy_version_id <> ''
        AND ((previous_generation_id IS NULL) = (previous_generation_version_id IS NULL))`,
    )
    .addCheckConstraint(
      "retrieval_activations_digest_ck",
      sql`authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "retrieval_activations_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(context_refs) = 'array'`,
    )
    .execute();

  await db.schema
    .createTable("business.retrieval_query_results")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("query_id", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("generation_id", "text", (column) => column.notNull())
    .addColumn("generation_version_id", "text", (column) => column.notNull())
    .addColumn("policy_entity_id", "text", (column) => column.notNull())
    .addColumn("policy_version_id", "text", (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("result_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("knowledge_query_result_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("retrieval_query_results_pk", ["project_id", "query_id"])
    .addForeignKeyConstraint(
      "retrieval_query_results_generation_fk",
      ["generation_id", "generation_version_id"],
      "business.retrieval_generations",
      ["generation_id", "generation_version_id"],
    )
    .addCheckConstraint(
      "retrieval_query_results_identity_ck",
      sql`project_id <> '' AND query_id <> '' AND generation_id <> ''
        AND generation_version_id <> '' AND actor_ref <> ''
        AND policy_entity_id <> '' AND policy_version_id <> ''`,
    )
    .addCheckConstraint(
      "retrieval_query_results_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "retrieval_query_results_json_ck",
      sql`jsonb_typeof(result_artifact_ref) = 'object'
        AND jsonb_typeof(knowledge_query_result_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  // 激活行按代际回读（readActivation）需要，其余访问路径均由主键前缀覆盖。
  await db.schema
    .createIndex("retrieval_activations_generation_idx")
    .ifNotExists()
    .on("business.retrieval_activations")
    .columns(["generation_id", "generation_version_id"])
    .execute();

  for (const table of tables) await guardAuditForeignKey(db, table);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema.dropIndex("retrieval_activations_generation_idx").ifExists().execute();
  await db.schema.dropTable("business.retrieval_query_results").ifExists().execute();
  await db.schema.dropTable("business.retrieval_activations").ifExists().execute();
  await db.schema.dropTable("business.retrieval_generation_transitions").ifExists().execute();
  await db.schema.dropTable("business.retrieval_generations").ifExists().execute();
}
