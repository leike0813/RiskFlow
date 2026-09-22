import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const tables = [
  "business.response_adoption_decisions",
  "business.response_forecast_outcomes",
  "business.response_execution_records",
  "business.response_feedback_records",
  "business.response_deviation_facts",
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
 * C28 最小持久化模型（D-09）：采纳决定、效果预测结果、现场执行、反馈与私有偏差事实。
 * 五表全部只追加，命令回执、审计与 Outbox 事件复用 C03 既有事实；不建第二套回执/审计/事件表。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.response_adoption_decisions")
    .ifNotExists()
    .addColumn("decision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("recommendation_id", "text", (column) => column.notNull())
    .addColumn("recommendation_version_id", "text", (column) => column.notNull())
    .addColumn("decision", "text", (column) => column.notNull())
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("forecast_run_id", "text", (column) => column.notNull())
    .addColumn("forecast_run_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("decided_by", "text", (column) => column.notNull())
    .addColumn("decision_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("response_adoption_decisions_pk", ["decision_id", "version_id"])
    .addUniqueConstraint("response_adoption_decisions_recommendation_uidx", [
      "project_id",
      "recommendation_id",
      "recommendation_version_id",
    ])
    .addForeignKeyConstraint(
      "response_adoption_decisions_recommendation_fk",
      ["recommendation_id", "recommendation_version_id"],
      "business.response_recommendations",
      ["recommendation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_adoption_decisions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_adoption_decisions_identity_ck",
      sql`decision_id <> '' AND version_id <> '' AND project_id <> ''
        AND recommendation_id <> '' AND recommendation_version_id <> ''
        AND decision IN ('adopted', 'declined') AND reason_code <> ''
        AND forecast_run_id <> '' AND forecast_run_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND decided_by <> '' AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "response_adoption_decisions_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_adoption_decisions_json_ck",
      sql`jsonb_typeof(decision_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.response_forecast_outcomes")
    .ifNotExists()
    .addColumn("forecast_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("recommendation_id", "text", (column) => column.notNull())
    .addColumn("recommendation_version_id", "text", (column) => column.notNull())
    .addColumn("route_decision_id", "text", (column) => column.notNull())
    .addColumn("route_decision_version_id", "text", (column) => column.notNull())
    .addColumn("forecast_run_id", "text", (column) => column.notNull())
    .addColumn("forecast_run_version_id", "text", (column) => column.notNull())
    .addColumn("forecast_input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("forecast_input_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("frozen_basis_snapshot_id", "text", (column) => column.notNull())
    .addColumn("frozen_basis_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("pre_action_snapshot_id", "text", (column) => column.notNull())
    .addColumn("pre_action_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("baseline_assessment_record_id", "text", (column) => column.notNull())
    .addColumn("baseline_assessment_record_version_id", "text", (column) => column.notNull())
    .addColumn("forecast_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("forecast_policy_version_id", "text", (column) => column.notNull())
    .addColumn("method", "text")
    .addColumn("required_ref_entity_id", "text")
    .addColumn("required_ref_version_id", "text")
    .addColumn("target_indicator_id", "text")
    .addColumn("unit", "text")
    .addColumn("horizon_steps", "integer")
    .addColumn("availability", "text", (column) => column.notNull())
    .addColumn("unavailable_reason", "text")
    .addColumn("predicted_value_canonical", "text")
    .addColumn("predicted_risk_state", jsonb)
    .addColumn("evidence_references", jsonb)
    .addColumn("summary", "text")
    .addColumn("input_digest", "char(64)", (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("forecast_payload", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("computed_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("response_forecast_outcomes_pk", ["forecast_id", "version_id"])
    .addUniqueConstraint("response_forecast_outcomes_input_uidx", ["project_id", "input_digest"])
    .addForeignKeyConstraint(
      "response_forecast_outcomes_recommendation_fk",
      ["recommendation_id", "recommendation_version_id"],
      "business.response_recommendations",
      ["recommendation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_forecast_outcomes_decision_fk",
      ["route_decision_id", "route_decision_version_id"],
      "business.response_adoption_decisions",
      ["decision_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_forecast_outcomes_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_forecast_outcomes_identity_ck",
      sql`forecast_id <> '' AND version_id <> '' AND project_id <> ''
        AND recommendation_id <> '' AND recommendation_version_id <> ''
        AND route_decision_id <> '' AND route_decision_version_id <> ''
        AND forecast_run_id <> '' AND forecast_run_version_id <> ''
        AND forecast_input_snapshot_id <> '' AND forecast_input_snapshot_version_id <> ''
        AND frozen_basis_snapshot_id <> '' AND frozen_basis_snapshot_version_id <> ''
        AND pre_action_snapshot_id <> '' AND pre_action_snapshot_version_id <> ''
        AND baseline_assessment_record_id <> '' AND baseline_assessment_record_version_id <> ''
        AND forecast_policy_entity_id <> '' AND forecast_policy_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''
        AND availability IN ('available', 'unavailable')`,
    )
    .addCheckConstraint(
      "response_forecast_outcomes_availability_ck",
      sql`(availability = 'available'
          AND method IN ('historical-statistics', 'monitoring-trend', 'mechanism-model')
          AND required_ref_entity_id IS NOT NULL AND required_ref_version_id IS NOT NULL
          AND target_indicator_id IS NOT NULL AND unit IS NOT NULL
          AND horizon_steps IS NOT NULL AND horizon_steps BETWEEN 1 AND 720
          AND predicted_value_canonical IS NOT NULL AND predicted_risk_state IS NOT NULL
          AND jsonb_typeof(predicted_risk_state) = 'object'
          AND evidence_references IS NOT NULL
          AND jsonb_typeof(evidence_references) = 'array'
          AND jsonb_array_length(evidence_references) >= 1
          AND summary IS NOT NULL AND unavailable_reason IS NULL)
        OR (availability = 'unavailable'
          AND predicted_value_canonical IS NULL AND predicted_risk_state IS NULL
          AND evidence_references IS NULL AND summary IS NULL
          AND unavailable_reason IS NOT NULL)`,
    )
    .addCheckConstraint(
      "response_forecast_outcomes_digest_ck",
      sql`input_digest ~ ${digestPattern} AND content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_forecast_outcomes_json_ck",
      sql`jsonb_typeof(forecast_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.response_execution_records")
    .ifNotExists()
    .addColumn("execution_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_kind", "text", (column) => column.notNull())
    .addColumn("recommendation_id", "text")
    .addColumn("recommendation_version_id", "text")
    .addColumn("route_decision_id", "text")
    .addColumn("route_decision_version_id", "text")
    .addColumn("measure_release_refs", jsonb)
    .addColumn("executed_by_actor_id", "text", (column) => column.notNull())
    .addColumn("recorded_by_actor_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("execution_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("response_execution_records_pk", ["execution_id", "version_id"])
    .addUniqueConstraint("response_execution_records_content_uidx", ["project_id", "content_digest"])
    .addForeignKeyConstraint(
      "response_execution_records_recommendation_fk",
      ["recommendation_id", "recommendation_version_id"],
      "business.response_recommendations",
      ["recommendation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_execution_records_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_execution_records_identity_ck",
      sql`execution_id <> '' AND version_id <> '' AND project_id <> ''
        AND executed_by_actor_id <> '' AND recorded_by_actor_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND evidence_references IS NOT NULL
        AND jsonb_typeof(evidence_references) = 'array'
        AND jsonb_array_length(evidence_references) >= 1
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "response_execution_records_source_ck",
      sql`(source_kind = 'adopted-recommendation'
          AND recommendation_id IS NOT NULL AND recommendation_version_id IS NOT NULL
          AND route_decision_id IS NOT NULL AND route_decision_version_id IS NOT NULL
          AND measure_release_refs IS NULL)
        OR (source_kind = 'independent-action'
          AND recommendation_id IS NULL AND recommendation_version_id IS NULL
          AND route_decision_id IS NULL AND route_decision_version_id IS NULL
          AND measure_release_refs IS NOT NULL
          AND jsonb_typeof(measure_release_refs) = 'array'
          AND jsonb_array_length(measure_release_refs) >= 1)`,
    )
    .addCheckConstraint(
      "response_execution_records_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_execution_records_json_ck",
      sql`jsonb_typeof(execution_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.response_feedback_records")
    .ifNotExists()
    .addColumn("feedback_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("execution_id", "text", (column) => column.notNull())
    .addColumn("execution_version_id", "text", (column) => column.notNull())
    .addColumn("post_action_snapshot_id", "text", (column) => column.notNull())
    .addColumn("post_action_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("feedback_artifact_id", "text", (column) => column.notNull())
    .addColumn("feedback_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("actual_assessment_record_id", "text", (column) => column.notNull())
    .addColumn("actual_assessment_record_version_id", "text", (column) => column.notNull())
    .addColumn("forecast_availability", "text", (column) => column.notNull())
    .addColumn("effect_forecast_id", "text")
    .addColumn("effect_forecast_version_id", "text")
    .addColumn("forecast_unavailable_reason", "text")
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("feedback_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("response_feedback_records_pk", ["feedback_id", "version_id"])
    .addUniqueConstraint("response_feedback_records_content_uidx", ["project_id", "content_digest"])
    .addForeignKeyConstraint(
      "response_feedback_records_execution_fk",
      ["execution_id", "execution_version_id"],
      "business.response_execution_records",
      ["execution_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_feedback_records_forecast_fk",
      ["effect_forecast_id", "effect_forecast_version_id"],
      "business.response_forecast_outcomes",
      ["forecast_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_feedback_records_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_feedback_records_identity_ck",
      sql`feedback_id <> '' AND version_id <> '' AND project_id <> ''
        AND execution_id <> '' AND execution_version_id <> ''
        AND post_action_snapshot_id <> '' AND post_action_snapshot_version_id <> ''
        AND feedback_artifact_id <> '' AND feedback_artifact_version_id <> ''
        AND actual_assessment_record_id <> '' AND actual_assessment_record_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''
        AND forecast_availability IN ('available', 'unavailable')`,
    )
    .addCheckConstraint(
      "response_feedback_records_forecast_ck",
      sql`(forecast_availability = 'available'
          AND effect_forecast_id IS NOT NULL AND effect_forecast_version_id IS NOT NULL
          AND forecast_unavailable_reason IS NULL)
        OR (forecast_availability = 'unavailable'
          AND effect_forecast_id IS NULL AND effect_forecast_version_id IS NULL
          AND forecast_unavailable_reason IS NOT NULL)`,
    )
    .addCheckConstraint(
      "response_feedback_records_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_feedback_records_json_ck",
      sql`jsonb_typeof(feedback_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.response_deviation_facts")
    .ifNotExists()
    .addColumn("deviation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("recommendation_id", "text", (column) => column.notNull())
    .addColumn("recommendation_version_id", "text", (column) => column.notNull())
    .addColumn("execution_id", "text", (column) => column.notNull())
    .addColumn("execution_version_id", "text", (column) => column.notNull())
    .addColumn("effect_forecast_id", "text", (column) => column.notNull())
    .addColumn("effect_forecast_version_id", "text", (column) => column.notNull())
    .addColumn("feedback_id", "text", (column) => column.notNull())
    .addColumn("feedback_version_id", "text", (column) => column.notNull())
    .addColumn("frozen_basis_snapshot_id", "text", (column) => column.notNull())
    .addColumn("frozen_basis_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("deviation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("deviation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("basis", "text", (column) => column.notNull())
    .addColumn("risk_matrix_entity_id", "text", (column) => column.notNull())
    .addColumn("risk_matrix_version_id", "text", (column) => column.notNull())
    .addColumn("target_indicator_id", "text", (column) => column.notNull())
    .addColumn("unit", "text", (column) => column.notNull())
    .addColumn("predicted_value_canonical", "text", (column) => column.notNull())
    .addColumn("actual_value_canonical", "text", (column) => column.notNull())
    .addColumn("deviation_value_canonical", "text", (column) => column.notNull())
    .addColumn("deviation_value_number", "double precision", (column) => column.notNull())
    .addColumn("threshold_exceeded", "boolean", (column) => column.notNull())
    .addColumn("direction", "text", (column) => column.notNull())
    .addColumn("predicted_risk_state", jsonb, (column) => column.notNull())
    .addColumn("actual_risk_state", jsonb, (column) => column.notNull())
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("deviation_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("computed_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("response_deviation_facts_pk", ["deviation_id", "version_id"])
    .addUniqueConstraint("response_deviation_facts_binding_uidx", [
      "project_id",
      "effect_forecast_id",
      "effect_forecast_version_id",
      "feedback_id",
      "feedback_version_id",
      "deviation_policy_entity_id",
      "deviation_policy_version_id",
    ])
    .addForeignKeyConstraint(
      "response_deviation_facts_recommendation_fk",
      ["recommendation_id", "recommendation_version_id"],
      "business.response_recommendations",
      ["recommendation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_deviation_facts_execution_fk",
      ["execution_id", "execution_version_id"],
      "business.response_execution_records",
      ["execution_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_deviation_facts_forecast_fk",
      ["effect_forecast_id", "effect_forecast_version_id"],
      "business.response_forecast_outcomes",
      ["forecast_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_deviation_facts_feedback_fk",
      ["feedback_id", "feedback_version_id"],
      "business.response_feedback_records",
      ["feedback_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_deviation_facts_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_deviation_facts_identity_ck",
      sql`deviation_id <> '' AND version_id <> '' AND project_id <> ''
        AND recommendation_id <> '' AND recommendation_version_id <> ''
        AND execution_id <> '' AND execution_version_id <> ''
        AND effect_forecast_id <> '' AND effect_forecast_version_id <> ''
        AND feedback_id <> '' AND feedback_version_id <> ''
        AND frozen_basis_snapshot_id <> '' AND frozen_basis_snapshot_version_id <> ''
        AND deviation_policy_entity_id <> '' AND deviation_policy_version_id <> ''
        AND basis IN ('absolute', 'relative', 'risk-level-step')
        AND risk_matrix_entity_id <> '' AND risk_matrix_version_id <> ''
        AND target_indicator_id <> '' AND unit <> ''
        AND direction IN ('actual-above', 'actual-below', 'equal')
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "response_deviation_facts_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_deviation_facts_json_ck",
      sql`jsonb_typeof(predicted_risk_state) = 'object'
        AND jsonb_typeof(actual_risk_state) = 'object'
        AND jsonb_typeof(evidence_references) = 'array'
        AND jsonb_array_length(evidence_references) >= 1
        AND jsonb_typeof(deviation_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  for (const table of tables) await guardAuditForeignKey(db, table);

  await db.schema
    .createIndex("response_forecast_outcomes_recommendation_idx")
    .ifNotExists()
    .on("business.response_forecast_outcomes")
    .columns(["project_id", "recommendation_id", "recommendation_version_id"])
    .execute();
  await db.schema
    .createIndex("response_execution_records_source_idx")
    .ifNotExists()
    .on("business.response_execution_records")
    .columns(["project_id", "source_kind", "recommendation_id"])
    .execute();
  await db.schema
    .createIndex("response_feedback_records_execution_idx")
    .ifNotExists()
    .on("business.response_feedback_records")
    .columns(["project_id", "execution_id", "execution_version_id"])
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
  await db.schema.dropIndex("response_feedback_records_execution_idx").ifExists().execute();
  await db.schema.dropIndex("response_execution_records_source_idx").ifExists().execute();
  await db.schema.dropIndex("response_forecast_outcomes_recommendation_idx").ifExists().execute();
  await db.schema.dropTable("business.response_deviation_facts").ifExists().execute();
  await db.schema.dropTable("business.response_feedback_records").ifExists().execute();
  await db.schema.dropTable("business.response_execution_records").ifExists().execute();
  await db.schema.dropTable("business.response_forecast_outcomes").ifExists().execute();
  await db.schema.dropTable("business.response_adoption_decisions").ifExists().execute();
}
