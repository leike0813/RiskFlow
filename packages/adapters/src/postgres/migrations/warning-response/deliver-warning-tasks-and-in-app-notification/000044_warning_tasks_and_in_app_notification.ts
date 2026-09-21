import { sql, type Kysely, type SqlBool } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;
const positiveVersionPattern = sql`'^[1-9][0-9]*$'`;
const standardizedRiskRecordKind = "standardized-risk-record";
const externalRiskEventKind = "external-risk-event";
const openStatus = "open";
const closedStatus = "closed";
const inAppChannel = "in-app";
const triggerTypes = [
  "风险等级超过风险可接受阈值",
  "监测指标越限",
  "趋势/加速度/异常评分越限",
  "多指标联合规则命中",
] as const;

const tables = [
  "business.warning_records",
  "business.warning_response_tasks",
  "business.warning_response_task_versions",
  "business.warning_response_task_warnings",
  "business.notification_intents",
  "business.in_app_notifications",
  "business.warning_acknowledgements",
] as const;

const auditTables = [
  "business.warning_records",
  "business.warning_response_task_versions",
  "business.notification_intents",
  "business.warning_acknowledgements",
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
 * C26 最小持久化模型（D-09）：预警事实、稳定处置任务与只追加版本/关联、
 * 应用内通知意图与投递事实、独立确认事实，全部只追加。
 * 应用角色仅获得 SELECT/INSERT，以及任务当前指针所需的窄 UPDATE。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.warning_records")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("assessment_record_id", "text", (column) => column.notNull())
    .addColumn("assessment_record_version_id", "text", (column) => column.notNull())
    .addColumn("assessment_input_snapshot_id", "text", (column) => column.notNull())
    .addColumn("assessment_input_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("preparation_snapshot_id", "text", (column) => column.notNull())
    .addColumn("preparation_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("risk_input_kind", "text", (column) => column.notNull())
    .addColumn("risk_input_entity_id", "text", (column) => column.notNull())
    .addColumn("risk_input_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("trigger_type", "text", (column) => column.notNull())
    .addColumn("risk_level_id", "text", (column) => column.notNull())
    .addColumn("warning_aggregation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("warning_aggregation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("notification_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("notification_policy_version_id", "text", (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("warning_payload", jsonb, (column) => column.notNull())
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
    .addPrimaryKeyConstraint("warning_records_pk", ["warning_record_id", "version_id"])
    .addUniqueConstraint("warning_records_identity_uidx", [
      "project_id",
      "assessment_record_id",
      "assessment_record_version_id",
      "trigger_type",
    ])
    .addForeignKeyConstraint(
      "warning_records_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addForeignKeyConstraint(
      "warning_records_assessment_fk",
      ["assessment_record_id", "assessment_record_version_id"],
      "business.risk_assessment_records",
      ["record_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "warning_records_input_snapshot_fk",
      ["assessment_input_snapshot_id", "assessment_input_snapshot_version_id"],
      "business.assessment_input_snapshots",
      ["input_snapshot_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "warning_records_preparation_snapshot_fk",
      ["preparation_snapshot_id", "preparation_snapshot_version_id"],
      "business.assessment_preparation_snapshots",
      ["snapshot_id", "version_id"],
    )
    .addCheckConstraint(
      "warning_records_identity_ck",
      sql`warning_record_id <> '' AND version_id ~ ${positiveVersionPattern}
        AND project_id <> '' AND command_id <> '' AND actor_ref <> ''
        AND assessment_record_id <> '' AND assessment_record_version_id <> ''
        AND assessment_input_snapshot_id <> '' AND assessment_input_snapshot_version_id <> ''
        AND preparation_snapshot_id <> '' AND preparation_snapshot_version_id <> ''
        AND risk_input_entity_id <> '' AND risk_input_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND risk_level_id <> ''
        AND warning_aggregation_policy_entity_id <> ''
        AND warning_aggregation_policy_version_id <> ''
        AND notification_policy_entity_id <> '' AND notification_policy_version_id <> ''
        AND risk_input_kind IN (${sql.lit(standardizedRiskRecordKind)}, ${sql.lit(externalRiskEventKind)})
        AND trigger_type IN (${sql.join(
          triggerTypes.map((value) => sql.lit(value)),
          sql`, `,
        )})`,
    )
    .addCheckConstraint("warning_records_digest_ck", sql`content_digest ~ ${digestPattern}`)
    .addCheckConstraint(
      "warning_records_json_ck",
      sql`jsonb_typeof(warning_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.warning_response_tasks")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("risk_input_kind", "text", (column) => column.notNull())
    .addColumn("risk_input_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("aggregation_key", jsonb, (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("current_version_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("updated_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("warning_response_tasks_pk", ["task_id"])
    .addCheckConstraint(
      "warning_response_tasks_identity_ck",
      sql`task_id <> '' AND project_id <> ''
        AND risk_input_entity_id <> '' AND spatial_scope_entity_id <> ''
        AND risk_input_kind IN (${sql.lit(standardizedRiskRecordKind)}, ${sql.lit(externalRiskEventKind)})
        AND status IN (${sql.lit(openStatus)}, ${sql.lit(closedStatus)})
        AND current_version_id ~ ${positiveVersionPattern}`,
    )
    .addCheckConstraint(
      "warning_response_tasks_json_ck",
      sql`jsonb_typeof(aggregation_key) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.warning_response_task_versions")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("aggregation_key", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_ref", jsonb, (column) => column.notNull())
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
    .addPrimaryKeyConstraint("warning_response_task_versions_pk", ["task_id", "version_id"])
    .addForeignKeyConstraint(
      "warning_response_task_versions_task_fk",
      ["task_id"],
      "business.warning_response_tasks",
      ["task_id"],
    )
    .addForeignKeyConstraint(
      "warning_response_task_versions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "warning_response_task_versions_identity_ck",
      sql`task_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND command_id <> '' AND actor_ref <> ''
        AND status IN (${sql.lit(openStatus)}, ${sql.lit(closedStatus)})`,
    )
    .addCheckConstraint(
      "warning_response_task_versions_json_ck",
      sql`jsonb_typeof(aggregation_key) = 'object'
        AND jsonb_typeof(spatial_scope_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.warning_response_task_warnings")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("first_included_version_id", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("warning_response_task_warnings_pk", [
      "task_id",
      "warning_record_id",
      "warning_record_version_id",
    ])
    .addForeignKeyConstraint(
      "warning_response_task_warnings_task_fk",
      ["task_id"],
      "business.warning_response_tasks",
      ["task_id"],
    )
    .addForeignKeyConstraint(
      "warning_response_task_warnings_version_fk",
      ["task_id", "first_included_version_id"],
      "business.warning_response_task_versions",
      ["task_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "warning_response_task_warnings_warning_fk",
      ["warning_record_id", "warning_record_version_id"],
      "business.warning_records",
      ["warning_record_id", "version_id"],
    )
    .addCheckConstraint(
      "warning_response_task_warnings_identity_ck",
      sql`task_id <> '' AND project_id <> ''
        AND warning_record_id <> '' AND warning_record_version_id <> ''
        AND first_included_version_id ~ ${positiveVersionPattern}`,
    )
    .execute();

  await db.schema
    .createTable("business.notification_intents")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("intent_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("task_version_id", "text", (column) => column.notNull())
    .addColumn("notification_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("notification_policy_version_id", "text", (column) => column.notNull())
    .addColumn("recipient_actor_id", "text", (column) => column.notNull())
    .addColumn("channel", "text", (column) => column.notNull())
    .addColumn("intent_payload", jsonb, (column) => column.notNull())
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
    .addPrimaryKeyConstraint("notification_intents_pk", ["intent_id", "version_id"])
    .addUniqueConstraint("notification_intents_identity_uidx", [
      "project_id",
      "warning_record_id",
      "warning_record_version_id",
      "recipient_actor_id",
      "notification_policy_entity_id",
      "notification_policy_version_id",
    ])
    .addForeignKeyConstraint(
      "notification_intents_warning_fk",
      ["warning_record_id", "warning_record_version_id"],
      "business.warning_records",
      ["warning_record_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "notification_intents_task_version_fk",
      ["task_id", "task_version_id"],
      "business.warning_response_task_versions",
      ["task_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "notification_intents_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "notification_intents_identity_ck",
      sql`intent_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND command_id <> '' AND actor_ref <> '' AND recipient_actor_id <> ''
        AND warning_record_id <> '' AND warning_record_version_id <> ''
        AND task_id <> '' AND task_version_id ~ ${positiveVersionPattern}
        AND notification_policy_entity_id <> '' AND notification_policy_version_id <> ''
        AND channel = ${sql.lit(inAppChannel)}`,
    )
    .addCheckConstraint(
      "notification_intents_json_ck",
      sql`jsonb_typeof(intent_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.in_app_notifications")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("notification_intent_id", "text", (column) => column.notNull())
    .addColumn("notification_intent_version_id", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("task_version_id", "text", (column) => column.notNull())
    .addColumn("recipient_actor_id", "text", (column) => column.notNull())
    .addColumn("channel", "text", (column) => column.notNull())
    .addColumn("delivered_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("in_app_notifications_pk", [
      "project_id",
      "notification_intent_id",
      "notification_intent_version_id",
    ])
    .addForeignKeyConstraint(
      "in_app_notifications_intent_fk",
      ["notification_intent_id", "notification_intent_version_id"],
      "business.notification_intents",
      ["intent_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "in_app_notifications_warning_fk",
      ["warning_record_id", "warning_record_version_id"],
      "business.warning_records",
      ["warning_record_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "in_app_notifications_task_version_fk",
      ["task_id", "task_version_id"],
      "business.warning_response_task_versions",
      ["task_id", "version_id"],
    )
    .addCheckConstraint(
      "in_app_notifications_identity_ck",
      sql`project_id <> '' AND notification_intent_id <> ''
        AND notification_intent_version_id ~ ${positiveVersionPattern}
        AND warning_record_id <> '' AND warning_record_version_id <> ''
        AND task_id <> '' AND task_version_id ~ ${positiveVersionPattern}
        AND recipient_actor_id <> '' AND channel = ${sql.lit(inAppChannel)}`,
    )
    .execute();

  await db.schema
    .createTable("business.warning_acknowledgements")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("task_id", "text", (column) => column.notNull())
    .addColumn("task_version_id", "text", (column) => column.notNull())
    .addColumn("acknowledged_by_actor_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("acknowledged_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("warning_acknowledgements_pk", [
      "project_id",
      "warning_record_id",
      "warning_record_version_id",
      "task_id",
      "task_version_id",
    ])
    .addForeignKeyConstraint(
      "warning_acknowledgements_warning_fk",
      ["warning_record_id", "warning_record_version_id"],
      "business.warning_records",
      ["warning_record_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "warning_acknowledgements_task_version_fk",
      ["task_id", "task_version_id"],
      "business.warning_response_task_versions",
      ["task_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "warning_acknowledgements_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "warning_acknowledgements_identity_ck",
      sql`project_id <> '' AND warning_record_id <> '' AND warning_record_version_id <> ''
        AND task_id <> '' AND task_version_id ~ ${positiveVersionPattern}
        AND acknowledged_by_actor_id <> '' AND command_id <> ''`,
    )
    .addCheckConstraint(
      "warning_acknowledgements_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  for (const table of auditTables) await guardAuditForeignKey(db, table);

  await db.schema
    .createIndex("warning_records_assessment_idx")
    .ifNotExists()
    .on("business.warning_records")
    .columns(["project_id", "assessment_record_id", "assessment_record_version_id"])
    .execute();
  await db.schema
    .createIndex("warning_response_tasks_open_uidx")
    .ifNotExists()
    .unique()
    .on("business.warning_response_tasks")
    .columns(["project_id", "risk_input_kind", "risk_input_entity_id", "spatial_scope_entity_id"])
    .where(sql<SqlBool>`status = ${sql.lit(openStatus)}`)
    .execute();
  await db.schema
    .createIndex("warning_response_task_warnings_warning_idx")
    .ifNotExists()
    .on("business.warning_response_task_warnings")
    .columns(["project_id", "warning_record_id", "warning_record_version_id"])
    .execute();
  await db.schema
    .createIndex("notification_intents_warning_idx")
    .ifNotExists()
    .on("business.notification_intents")
    .columns(["project_id", "warning_record_id", "warning_record_version_id"])
    .execute();

  await sql`
    CREATE OR REPLACE FUNCTION business.guard_warning_response_task_reopen()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.status = 'closed' AND NEW.status = 'open' THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'warning_response_tasks_no_reopen_ck';
      END IF;
      RETURN NEW;
    END;
    $$;
  `.execute(db);
  await sql`DROP TRIGGER IF EXISTS warning_response_tasks_no_reopen_trg
    ON business.warning_response_tasks`.execute(db);
  await sql`CREATE TRIGGER warning_response_tasks_no_reopen_trg
    BEFORE UPDATE OF status ON business.warning_response_tasks
    FOR EACH ROW EXECUTE FUNCTION business.guard_warning_response_task_reopen()`.execute(db);

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(
    db,
  );
  // 任务当前指针与状态是唯一需要原地更新的列，其余事实只追加。
  await sql`GRANT UPDATE (current_version_id, status, updated_at)
    ON TABLE business.warning_response_tasks TO riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  // 后续 change（C27）建了指向 business.warning_records 与 business.warning_response_tasks
  // 的外键；孤立回滚本迁移 MUST 先解除这类依赖，否则 PostgreSQL 以 "other objects depend
  // on it" 拒绝删表。依赖表可能尚未建立，因此按表存在性守卫。
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'measure_candidate_queries') THEN
        ALTER TABLE business.measure_candidate_queries
          DROP CONSTRAINT IF EXISTS measure_candidate_queries_task_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'recommendation_candidates') THEN
        ALTER TABLE business.recommendation_candidates
          DROP CONSTRAINT IF EXISTS recommendation_candidates_task_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_recommendations') THEN
        ALTER TABLE business.response_recommendations
          DROP CONSTRAINT IF EXISTS response_recommendations_task_fk,
          DROP CONSTRAINT IF EXISTS response_recommendations_warning_fk;
      END IF;
    END
    $$;
  `.execute(db);
  await db.schema.dropIndex("notification_intents_warning_idx").ifExists().execute();
  await db.schema.dropIndex("warning_response_task_warnings_warning_idx").ifExists().execute();
  await db.schema.dropIndex("warning_response_tasks_open_uidx").ifExists().execute();
  await db.schema.dropIndex("warning_records_assessment_idx").ifExists().execute();
  await db.schema.dropTable("business.warning_acknowledgements").ifExists().execute();
  await db.schema.dropTable("business.in_app_notifications").ifExists().execute();
  await db.schema.dropTable("business.notification_intents").ifExists().execute();
  await db.schema.dropTable("business.warning_response_task_warnings").ifExists().execute();
  await db.schema.dropTable("business.warning_response_task_versions").ifExists().execute();
  await db.schema.dropTable("business.warning_response_tasks").ifExists().execute();
  await sql`DROP FUNCTION IF EXISTS business.guard_warning_response_task_reopen()`.execute(db);
  await db.schema.dropTable("business.warning_records").ifExists().execute();
}
