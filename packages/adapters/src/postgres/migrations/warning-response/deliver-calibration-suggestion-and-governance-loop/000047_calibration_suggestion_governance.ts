import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const tables = [
  "business.calibration_suggestions",
  "business.calibration_deviation_records",
  "business.calibration_governance_drafts",
] as const;

// 迁移必须可重复执行：DO 块内不能使用绑定参数，故全部按字面量内联。
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

const foreignKeys = [
  {
    table: "business.calibration_suggestions",
    constraint: "calibration_suggestions_frozen_input_fk",
    columns: "frozen_input_artifact_id, frozen_input_artifact_version_id",
    target: "business.artifact_manifests",
    targetColumns: "artifact_id, version_id",
  },
  {
    table: "business.calibration_suggestions",
    constraint: "calibration_suggestions_base_artifact_fk",
    columns: "base_artifact_id, base_artifact_version_id",
    target: "business.artifact_manifests",
    targetColumns: "artifact_id, version_id",
  },
  {
    table: "business.calibration_governance_drafts",
    constraint: "calibration_governance_drafts_base_artifact_fk",
    columns: "base_artifact_id, base_artifact_version_id",
    target: "business.artifact_manifests",
    targetColumns: "artifact_id, version_id",
  },
  {
    table: "business.calibration_governance_drafts",
    constraint: "calibration_governance_drafts_candidate_artifact_fk",
    columns: "candidate_artifact_id, candidate_artifact_version_id",
    target: "business.artifact_manifests",
    targetColumns: "artifact_id, version_id",
  },
] as const;

const guardForeignKey = async (
  db: Kysely<unknown>,
  foreignKey: (typeof foreignKeys)[number],
): Promise<void> => {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(foreignKey.constraint)}'
          AND conrelid = '${sql.raw(foreignKey.table)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(foreignKey.table)}
          ADD CONSTRAINT ${sql.raw(foreignKey.constraint)}
          FOREIGN KEY (${sql.raw(foreignKey.columns)})
          REFERENCES ${sql.raw(foreignKey.target)} (${sql.raw(foreignKey.targetColumns)})
          DEFERRABLE INITIALLY DEFERRED;
      END IF;
    END
    $$;
  `.execute(db);
};

const revokeAll = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    DO $$
    DECLARE target text;
    BEGIN
      FOREACH target IN ARRAY ${sql.raw(`ARRAY['${tables.join("','")}']`)} LOOP
        IF to_regclass(target) IS NOT NULL THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer',
            target
          );
        END IF;
      END LOOP;
    END
    $$;
  `.execute(db);
};

/**
 * C29 最小持久化模型（D-11）：校准建议、公共偏差记录与治理草案。
 * 三表全部只追加，以精确版本引用 C28 偏差事实、C08 任务结果、C07 复核与审计、C16 修订和 C03 命令回执；
 * 不修改既有迁移、不回填历史偏差，仅授予风险应用 SELECT/INSERT。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.calibration_suggestions")
    .ifNotExists()
    .addColumn("suggestion_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("deviation_id", "text", (column) => column.notNull())
    .addColumn("deviation_version_id", "text", (column) => column.notNull())
    .addColumn("deviation_fact_id", "text", (column) => column.notNull())
    .addColumn("deviation_fact_version_id", "text", (column) => column.notNull())
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("agent_task_version_id", "text", (column) => column.notNull())
    .addColumn("agent_task_result_ref", jsonb, (column) => column.notNull())
    .addColumn("validation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("validation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("frozen_input_artifact_id", "text", (column) => column.notNull())
    .addColumn("frozen_input_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("target_definition_type", "text", (column) => column.notNull())
    .addColumn("target_release_entity_id", "text", (column) => column.notNull())
    .addColumn("target_release_version_id", "text", (column) => column.notNull())
    .addColumn("base_artifact_id", "text", (column) => column.notNull())
    .addColumn("base_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("base_content_digest", "char(64)", (column) => column.notNull())
    .addColumn("candidate_digest", "char(64)", (column) => column.notNull())
    .addColumn("candidate_payload", jsonb, (column) => column.notNull())
    .addColumn("validation_payload", jsonb, (column) => column.notNull())
    .addColumn("review_task_id", "text", (column) => column.notNull())
    .addColumn("review_task_version_id", "text", (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("parent_run_id", "text", (column) => column.notNull())
    .addColumn("parent_run_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("returned_decision_ref", jsonb)
    .addColumn("approved_decision_ref", jsonb)
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("calibration_suggestions_pk", ["suggestion_id", "version_id"])
    .addUniqueConstraint("calibration_suggestions_candidate_uidx", [
      "project_id",
      "candidate_digest",
    ])
    .addForeignKeyConstraint(
      "calibration_suggestions_agent_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
    )
    .addForeignKeyConstraint(
      "calibration_suggestions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "calibration_suggestions_identity_ck",
      sql`suggestion_id <> '' AND version_id <> '' AND schema_version <> ''
        AND project_id <> '' AND deviation_id <> '' AND deviation_version_id <> ''
        AND deviation_fact_id <> '' AND deviation_fact_version_id <> ''
        AND agent_task_id <> '' AND agent_task_version_id <> ''
        AND validation_policy_entity_id <> '' AND validation_policy_version_id <> ''
        AND frozen_input_artifact_id <> '' AND frozen_input_artifact_version_id <> ''
        AND target_definition_type IN ('weight-set', 'risk-matrix',
          'risk-acceptance-threshold', 'monitoring-warning-threshold',
          'deviation-policy', 'structured-scoring-rule')
        AND target_release_entity_id <> '' AND target_release_version_id <> ''
        AND base_artifact_id <> '' AND base_artifact_version_id <> ''
        AND review_task_id <> '' AND review_task_version_id <> ''
        AND parent_run_id <> '' AND parent_run_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND status IN ('pending-review', 'returned', 'rejected', 'approved-for-draft')
        AND command_id <> '' AND idempotency_key <> '' AND actor_ref <> ''
        AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "calibration_suggestions_decision_ck",
      sql`(status = 'returned'
          AND returned_decision_ref IS NOT NULL AND approved_decision_ref IS NULL)
        OR (status = 'approved-for-draft'
          AND approved_decision_ref IS NOT NULL AND returned_decision_ref IS NULL)
        OR (status IN ('pending-review', 'rejected')
          AND returned_decision_ref IS NULL AND approved_decision_ref IS NULL)`,
    )
    .addCheckConstraint(
      "calibration_suggestions_digest_ck",
      sql`base_content_digest ~ ${digestPattern} AND candidate_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "calibration_suggestions_json_ck",
      sql`jsonb_typeof(candidate_payload) = 'object'
        AND jsonb_typeof(validation_payload) = 'object'
        AND jsonb_typeof(agent_task_result_ref) = 'object'
        AND jsonb_typeof(review_task_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.calibration_deviation_records")
    .ifNotExists()
    .addColumn("deviation_record_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("version_number", "integer", (column) => column.notNull())
    .addColumn("deviation_fact_id", "text", (column) => column.notNull())
    .addColumn("deviation_fact_version_id", "text", (column) => column.notNull())
    .addColumn("suggestion_id", "text", (column) => column.notNull())
    .addColumn("suggestion_version_id", "text", (column) => column.notNull())
    .addColumn("review_status", "text", (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("review_decision_ref", jsonb)
    .addColumn("record_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("calibration_deviation_records_pk", [
      "deviation_record_id",
      "version_id",
    ])
    .addUniqueConstraint("calibration_deviation_records_entity_version_uidx", [
      "project_id",
      "deviation_record_id",
      "version_number",
    ])
    .addForeignKeyConstraint(
      "calibration_deviation_records_suggestion_fk",
      ["suggestion_id", "suggestion_version_id"],
      "business.calibration_suggestions",
      ["suggestion_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "calibration_deviation_records_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "calibration_deviation_records_identity_ck",
      sql`deviation_record_id <> '' AND version_id <> '' AND schema_version <> ''
        AND project_id <> '' AND version_number > 0
        AND deviation_fact_id <> '' AND deviation_fact_version_id <> ''
        AND suggestion_id <> '' AND suggestion_version_id <> ''
        AND review_status IN ('pending', 'rejected', 'approved')
        AND command_id <> '' AND idempotency_key <> '' AND actor_ref <> ''
        AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "calibration_deviation_records_status_ck",
      sql`(review_status = 'pending' AND review_decision_ref IS NULL)
        OR (review_status IN ('rejected', 'approved') AND review_decision_ref IS NOT NULL)`,
    )
    .addCheckConstraint(
      "calibration_deviation_records_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "calibration_deviation_records_json_ck",
      sql`jsonb_typeof(record_payload) = 'object'
        AND jsonb_typeof(review_task_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.calibration_governance_drafts")
    .ifNotExists()
    .addColumn("draft_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("suggestion_id", "text", (column) => column.notNull())
    .addColumn("suggestion_version_id", "text", (column) => column.notNull())
    .addColumn("review_task_id", "text", (column) => column.notNull())
    .addColumn("review_task_version_id", "text", (column) => column.notNull())
    .addColumn("review_decision_id", "text", (column) => column.notNull())
    .addColumn("review_decision_version_id", "text", (column) => column.notNull())
    .addColumn("decided_at", timestamptz, (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("base_release_entity_id", "text", (column) => column.notNull())
    .addColumn("base_release_version_id", "text", (column) => column.notNull())
    .addColumn("base_artifact_id", "text", (column) => column.notNull())
    .addColumn("base_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("base_content_digest", "char(64)", (column) => column.notNull())
    .addColumn("candidate_artifact_id", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_digest", "char(64)", (column) => column.notNull())
    .addColumn("knowledge_revision_id", "text", (column) => column.notNull())
    .addColumn("knowledge_revision_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("calibration_governance_drafts_pk", ["draft_id", "version_id"])
    .addUniqueConstraint("calibration_governance_drafts_decision_uidx", [
      "project_id",
      "suggestion_id",
      "suggestion_version_id",
      "review_decision_id",
      "review_decision_version_id",
    ])
    .addForeignKeyConstraint(
      "calibration_governance_drafts_suggestion_fk",
      ["suggestion_id", "suggestion_version_id"],
      "business.calibration_suggestions",
      ["suggestion_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "calibration_governance_drafts_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "calibration_governance_drafts_identity_ck",
      sql`draft_id <> '' AND version_id <> '' AND schema_version <> ''
        AND project_id <> ''
        AND suggestion_id <> '' AND suggestion_version_id <> ''
        AND review_task_id <> '' AND review_task_version_id <> ''
        AND review_decision_id <> '' AND review_decision_version_id <> ''
        AND definition_type IN ('weight-set', 'risk-matrix',
          'risk-acceptance-threshold', 'monitoring-warning-threshold',
          'deviation-policy', 'structured-scoring-rule')
        AND base_release_entity_id <> '' AND base_release_version_id <> ''
        AND base_artifact_id <> '' AND base_artifact_version_id <> ''
        AND candidate_artifact_id <> '' AND candidate_artifact_version_id <> ''
        AND knowledge_revision_id <> '' AND knowledge_revision_version_id <> ''
        AND command_id <> '' AND idempotency_key <> '' AND actor_ref <> ''
        AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "calibration_governance_drafts_digest_ck",
      sql`base_content_digest ~ ${digestPattern} AND candidate_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "calibration_governance_drafts_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  for (const foreignKey of foreignKeys) await guardForeignKey(db, foreignKey);
  for (const table of tables) await guardAuditForeignKey(db, table);

  await db.schema
    .createIndex("calibration_suggestions_task_idx")
    .ifNotExists()
    .on("business.calibration_suggestions")
    .columns(["project_id", "agent_task_id"])
    .execute();
  await db.schema
    .createIndex("calibration_deviation_records_suggestion_idx")
    .ifNotExists()
    .on("business.calibration_deviation_records")
    .columns(["project_id", "suggestion_id", "suggestion_version_id"])
    .execute();
  await db.schema
    .createIndex("calibration_governance_drafts_suggestion_idx")
    .ifNotExists()
    .on("business.calibration_governance_drafts")
    .columns(["project_id", "suggestion_id", "suggestion_version_id"])
    .execute();

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  await db.schema.dropIndex("calibration_governance_drafts_suggestion_idx").ifExists().execute();
  await db.schema.dropIndex("calibration_deviation_records_suggestion_idx").ifExists().execute();
  await db.schema.dropIndex("calibration_suggestions_task_idx").ifExists().execute();
  await db.schema.dropTable("business.calibration_governance_drafts").ifExists().execute();
  await db.schema.dropTable("business.calibration_deviation_records").ifExists().execute();
  await db.schema.dropTable("business.calibration_suggestions").ifExists().execute();
}
