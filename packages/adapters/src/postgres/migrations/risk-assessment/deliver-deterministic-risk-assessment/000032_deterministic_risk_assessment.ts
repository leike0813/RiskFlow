import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;
const standardizedRiskRecordKind = "standardized-risk-record";
const externalRiskEventKind = "external-risk-event";

const tables = [
  "business.assessment_preparation_snapshots",
  "business.assessment_input_snapshots",
  "business.indicator_actual_value_sets",
  "business.assessment_decision_artifacts",
  "business.risk_assessment_records",
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

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  // 先判存在再 REVOKE：表已被删除时 down 仍可重复执行。
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
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(
    db,
  );
};

/**
 * C25 只追加事实：准备快照、完整输入快照、指标实际取值集、决策工件链接与正式评估记录。
 * 正文（决策工件）仍只存在于 C04；这里保存公共快照/记录 JSON、精确 ref、摘要与三时态。
 * 应用角色仅 SELECT/INSERT，无 UPDATE/DELETE。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.assessment_preparation_snapshots")
    .ifNotExists()
    .addColumn("snapshot_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("payload_hash", "char(64)", (column) => column.notNull())
    .addColumn("risk_input_ref", jsonb, (column) => column.notNull())
    .addColumn("risk_input_kind", "text", (column) => column.notNull())
    .addColumn("risk_input_entity_id", "text", (column) => column.notNull())
    .addColumn("risk_input_version_id", "text", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_ref", jsonb, (column) => column.notNull())
    .addColumn("applicability_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("monitoring_snapshot_refs", jsonb)
    .addColumn("entry_mode", "text", (column) => column.notNull())
    .addColumn("trigger_reason_code", "text", (column) => column.notNull())
    .addColumn("previous_assessment_record_ref", jsonb)
    .addColumn("causal_run_ref", jsonb)
    .addColumn("snapshot_payload", jsonb, (column) => column.notNull())
    .addColumn("applicability_values", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_preparation_snapshots_pk", ["snapshot_id", "version_id"])
    .addForeignKeyConstraint(
      "assessment_preparation_snapshots_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "assessment_preparation_snapshots_identity_ck",
      sql`snapshot_id <> '' AND version_id <> '' AND project_id <> '' AND command_id <> ''
        AND risk_input_entity_id <> '' AND risk_input_version_id <> '' AND actor_ref <> ''
        AND entry_mode <> '' AND trigger_reason_code <> ''
        AND risk_input_kind IN (${sql.lit(standardizedRiskRecordKind)}, ${sql.lit(externalRiskEventKind)})`,
    )
    .addCheckConstraint(
      "assessment_preparation_snapshots_monitoring_ck",
      sql`monitoring_snapshot_refs IS NULL
        OR (jsonb_typeof(monitoring_snapshot_refs) = 'array'
          AND jsonb_array_length(monitoring_snapshot_refs) >= 1)`,
    )
    .addCheckConstraint(
      "assessment_preparation_snapshots_digest_ck",
      sql`payload_hash ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "assessment_preparation_snapshots_json_ck",
      sql`jsonb_typeof(risk_input_ref) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(spatial_scope_ref) = 'object'
        AND jsonb_typeof(applicability_snapshot_ref) = 'object'
        AND jsonb_typeof(snapshot_payload) = 'object'
        AND jsonb_typeof(applicability_values) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.assessment_input_snapshots")
    .ifNotExists()
    .addColumn("input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("payload_hash", "char(64)", (column) => column.notNull())
    .addColumn("preparation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("preparation_snapshot_id", "text", (column) => column.notNull())
    .addColumn("preparation_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("basis_release_set_ref", jsonb, (column) => column.notNull())
    .addColumn("basis_release_set_id", "text", (column) => column.notNull())
    .addColumn("basis_release_set_version_id", "text", (column) => column.notNull())
    .addColumn("previous_assessment_record_ref", jsonb)
    .addColumn("entry_kind", "text", (column) => column.notNull())
    .addColumn("effective_at", timestamptz)
    .addColumn("reference_digest", "char(64)", (column) => column.notNull())
    .addColumn("snapshot_payload", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_input_snapshots_pk", ["input_snapshot_id", "version_id"])
    .addUniqueConstraint("assessment_input_snapshots_reference_uidx", [
      "project_id",
      "reference_digest",
    ])
    .addForeignKeyConstraint(
      "assessment_input_snapshots_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "assessment_input_snapshots_identity_ck",
      sql`input_snapshot_id <> '' AND version_id <> '' AND project_id <> '' AND command_id <> ''
        AND preparation_snapshot_id <> '' AND preparation_snapshot_version_id <> ''
        AND basis_release_set_id <> '' AND basis_release_set_version_id <> ''
        AND actor_ref <> '' AND entry_kind IN ('initial', 'reassessment', 'historical-backfill')
        AND (entry_kind = 'historical-backfill') = (effective_at IS NOT NULL)`,
    )
    .addCheckConstraint(
      "assessment_input_snapshots_digest_ck",
      sql`payload_hash ~ ${digestPattern} AND reference_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "assessment_input_snapshots_json_ck",
      sql`jsonb_typeof(preparation_snapshot_ref) = 'object'
        AND jsonb_typeof(basis_release_set_ref) = 'object'
        AND jsonb_typeof(snapshot_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.indicator_actual_value_sets")
    .ifNotExists()
    .addColumn("value_set_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("evidence_digest", "char(64)", (column) => column.notNull())
    .addColumn("value_set_payload", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("indicator_actual_value_sets_pk", ["value_set_id", "version_id"])
    .addUniqueConstraint("indicator_actual_value_sets_digest_uidx", [
      "project_id",
      "content_digest",
    ])
    .addForeignKeyConstraint(
      "indicator_actual_value_sets_input_fk",
      ["input_snapshot_id", "input_snapshot_version_id"],
      "business.assessment_input_snapshots",
      ["input_snapshot_id", "version_id"],
    )
    .addCheckConstraint(
      "indicator_actual_value_sets_identity_ck",
      sql`value_set_id <> '' AND version_id <> '' AND project_id <> ''
        AND input_snapshot_id <> '' AND input_snapshot_version_id <> ''`,
    )
    .addCheckConstraint(
      "indicator_actual_value_sets_digest_ck",
      sql`content_digest ~ ${digestPattern} AND evidence_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "indicator_actual_value_sets_json_ck",
      sql`jsonb_typeof(input_snapshot_ref) = 'object'
        AND jsonb_typeof(value_set_payload) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.assessment_decision_artifacts")
    .ifNotExists()
    .addColumn("decision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("value_set_id", "text", (column) => column.notNull())
    .addColumn("value_set_version_id", "text", (column) => column.notNull())
    .addColumn("value_set_ref", jsonb, (column) => column.notNull())
    .addColumn("content_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("content_artifact_id", "text", (column) => column.notNull())
    .addColumn("content_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_decision_artifacts_pk", ["decision_id", "version_id"])
    .addUniqueConstraint("assessment_decision_artifacts_digest_uidx", [
      "project_id",
      "content_digest",
    ])
    .addForeignKeyConstraint(
      "assessment_decision_artifacts_input_fk",
      ["input_snapshot_id", "input_snapshot_version_id"],
      "business.assessment_input_snapshots",
      ["input_snapshot_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "assessment_decision_artifacts_value_set_fk",
      ["value_set_id", "value_set_version_id"],
      "business.indicator_actual_value_sets",
      ["value_set_id", "version_id"],
    )
    .addCheckConstraint(
      "assessment_decision_artifacts_identity_ck",
      sql`decision_id <> '' AND version_id <> '' AND project_id <> ''
        AND input_snapshot_id <> '' AND input_snapshot_version_id <> ''
        AND value_set_id <> '' AND value_set_version_id <> ''
        AND content_artifact_id <> '' AND content_artifact_version_id <> ''`,
    )
    .addCheckConstraint(
      "assessment_decision_artifacts_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "assessment_decision_artifacts_json_ck",
      sql`jsonb_typeof(input_snapshot_ref) = 'object'
        AND jsonb_typeof(value_set_ref) = 'object'
        AND jsonb_typeof(content_artifact_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.risk_assessment_records")
    .ifNotExists()
    .addColumn("record_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("risk_input_kind", "text", (column) => column.notNull())
    .addColumn("risk_record_id", "text")
    .addColumn("external_risk_event_id", "text")
    .addColumn("input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("value_set_id", "text", (column) => column.notNull())
    .addColumn("value_set_version_id", "text", (column) => column.notNull())
    .addColumn("decision_id", "text", (column) => column.notNull())
    .addColumn("decision_version_id", "text", (column) => column.notNull())
    .addColumn("record_payload", jsonb, (column) => column.notNull())
    .addColumn("likelihood_score_canonical", "text", (column) => column.notNull())
    .addColumn("consequence_score_canonical", "text", (column) => column.notNull())
    .addColumn("risk_level_id", "text", (column) => column.notNull())
    .addColumn("configuration_digest", "char(64)", (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("identity_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("risk_assessment_records_pk", ["record_id", "version_id"])
    .addUniqueConstraint("risk_assessment_records_identity_uidx", ["project_id", "identity_digest"])
    .addUniqueConstraint("risk_assessment_records_input_uidx", [
      "project_id",
      "input_snapshot_id",
      "input_snapshot_version_id",
    ])
    .addForeignKeyConstraint(
      "risk_assessment_records_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addForeignKeyConstraint(
      "risk_assessment_records_input_fk",
      ["input_snapshot_id", "input_snapshot_version_id"],
      "business.assessment_input_snapshots",
      ["input_snapshot_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "risk_assessment_records_value_set_fk",
      ["value_set_id", "value_set_version_id"],
      "business.indicator_actual_value_sets",
      ["value_set_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "risk_assessment_records_decision_fk",
      ["decision_id", "decision_version_id"],
      "business.assessment_decision_artifacts",
      ["decision_id", "version_id"],
    )
    .addCheckConstraint(
      "risk_assessment_records_xor_ck",
      sql`(risk_input_kind = ${sql.lit(standardizedRiskRecordKind)}
          AND risk_record_id IS NOT NULL AND risk_record_id <> ''
          AND external_risk_event_id IS NULL)
        OR (risk_input_kind = ${sql.lit(externalRiskEventKind)}
          AND external_risk_event_id IS NOT NULL AND external_risk_event_id <> ''
          AND risk_record_id IS NULL)`,
    )
    .addCheckConstraint(
      "risk_assessment_records_identity_ck",
      sql`record_id <> '' AND version_id <> '' AND project_id <> '' AND command_id <> ''
        AND input_snapshot_id <> '' AND input_snapshot_version_id <> ''
        AND value_set_id <> '' AND value_set_version_id <> ''
        AND decision_id <> '' AND decision_version_id <> ''
        AND risk_level_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "risk_assessment_records_digest_ck",
      sql`configuration_digest ~ ${digestPattern}
        AND content_digest ~ ${digestPattern}
        AND identity_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "risk_assessment_records_json_ck",
      sql`jsonb_typeof(input_snapshot_ref) = 'object'
        AND jsonb_typeof(record_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await guardAuditForeignKey(db, "business.assessment_preparation_snapshots");
  await guardAuditForeignKey(db, "business.assessment_input_snapshots");
  await guardAuditForeignKey(db, "business.risk_assessment_records");

  await db.schema
    .createIndex("assessment_preparation_snapshots_project_idx")
    .ifNotExists()
    .on("business.assessment_preparation_snapshots")
    .columns(["project_id", "risk_input_entity_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_input_snapshots_project_idx")
    .ifNotExists()
    .on("business.assessment_input_snapshots")
    .columns(["project_id", "preparation_snapshot_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("indicator_actual_value_sets_input_idx")
    .ifNotExists()
    .on("business.indicator_actual_value_sets")
    .columns(["project_id", "input_snapshot_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_decision_artifacts_input_idx")
    .ifNotExists()
    .on("business.assessment_decision_artifacts")
    .columns(["project_id", "input_snapshot_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("risk_assessment_records_project_idx")
    .ifNotExists()
    .on("business.risk_assessment_records")
    .columns(["project_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("risk_assessment_records_risk_input_idx")
    .ifNotExists()
    .on("business.risk_assessment_records")
    .columns(["project_id", "risk_input_kind", "risk_record_id", "external_risk_event_id"])
    .execute();

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE IF EXISTS business.response_feedback_records
    DROP CONSTRAINT IF EXISTS response_feedback_records_actual_assessment_fk`.execute(db);
  await sql`ALTER TABLE IF EXISTS business.response_forecast_outcomes
    DROP CONSTRAINT IF EXISTS response_forecast_outcomes_frozen_basis_snapshot_fk,
    DROP CONSTRAINT IF EXISTS response_forecast_outcomes_baseline_assessment_fk`.execute(db);
  // 先判存在再 REVOKE：表已被删除时 down 仍可重复执行。
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
  await db.schema.dropIndex("risk_assessment_records_risk_input_idx").ifExists().execute();
  await db.schema.dropIndex("risk_assessment_records_project_idx").ifExists().execute();
  await db.schema.dropIndex("assessment_decision_artifacts_input_idx").ifExists().execute();
  await db.schema.dropIndex("indicator_actual_value_sets_input_idx").ifExists().execute();
  await db.schema.dropIndex("assessment_input_snapshots_project_idx").ifExists().execute();
  await db.schema.dropIndex("assessment_preparation_snapshots_project_idx").ifExists().execute();
  // 后续 change 可能建了指向本表的外键（例如 C26 的
  // warning_records_assessment_fk）。孤立回滚本迁移时必须先解除这类依赖，
  // 否则 PostgreSQL 以 "other objects depend on it" 拒绝删表。
  await sql`ALTER TABLE business.warning_records
    DROP CONSTRAINT IF EXISTS warning_records_assessment_fk,
    DROP CONSTRAINT IF EXISTS warning_records_input_snapshot_fk,
    DROP CONSTRAINT IF EXISTS warning_records_preparation_snapshot_fk`.execute(db);
  await db.schema.dropTable("business.risk_assessment_records").ifExists().execute();
  await db.schema.dropTable("business.assessment_decision_artifacts").ifExists().execute();
  await db.schema.dropTable("business.indicator_actual_value_sets").ifExists().execute();
  await db.schema.dropTable("business.assessment_input_snapshots").ifExists().execute();
  await db.schema.dropTable("business.assessment_preparation_snapshots").ifExists().execute();
}
