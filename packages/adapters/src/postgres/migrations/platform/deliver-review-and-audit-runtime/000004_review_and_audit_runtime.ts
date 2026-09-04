import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.review_tasks,
    business.review_decisions,
    audit.review_rejections
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON TABLE audit.review_activity_v1
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`GRANT SELECT, INSERT ON TABLE business.review_tasks TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (status, decision_ref, decided_at, superseded_at,
    superseded_by_command_id, superseded_by_actor)
    ON TABLE business.review_tasks TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.review_decisions TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE audit.review_rejections TO riskflow_app`.execute(db);
  await sql`GRANT SELECT ON TABLE audit.review_activity_v1 TO riskflow_app`.execute(db);

  await sql`DO $$
  BEGIN
    IF NOT has_table_privilege('riskflow_app', 'audit.entries', 'SELECT')
      OR NOT has_table_privilege('riskflow_app', 'audit.entries', 'INSERT')
    THEN
      RAISE EXCEPTION 'C03 audit.entries privileges are not available to riskflow_app';
    END IF;
    IF NOT has_table_privilege('riskflow_app', 'business.security_audit_events', 'SELECT')
    THEN
      RAISE EXCEPTION 'C06 security_audit_events SELECT privilege is not available to riskflow_app';
    END IF;
  END $$`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.review_tasks")
    .ifNotExists()
    .addColumn("review_task_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("review_type", "text", (column) => column.notNull())
    .addColumn("target_kind", "text", (column) => column.notNull())
    .addColumn("target_entity_id", "text", (column) => column.notNull())
    .addColumn("target_version_id", "text", (column) => column.notNull())
    .addColumn("target_ref", jsonb, (column) => column.notNull())
    .addColumn("waiting_run_entity_id", "text", (column) => column.notNull())
    .addColumn("waiting_run_version_id", "text", (column) => column.notNull())
    .addColumn("waiting_run_ref", jsonb, (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("validation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("evidence_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("review_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("pending"))
    .addColumn("decision_ref", jsonb)
    .addColumn("requested_by", "text", (column) => column.notNull())
    .addColumn("requested_authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("requested_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("decided_at", timestamptz)
    .addColumn("superseded_at", timestamptz)
    .addColumn("superseded_by_command_id", "text")
    .addColumn("superseded_by_actor", "text")
    .addCheckConstraint(
      "review_tasks_status_ck",
      sql`status IN ('pending', 'decided', 'superseded')`,
    )
    .addCheckConstraint(
      "review_tasks_state_ck",
      sql`(status = 'pending' AND decision_ref IS NULL AND decided_at IS NULL AND superseded_at IS NULL)
        OR (status = 'decided' AND decision_ref IS NOT NULL AND decided_at IS NOT NULL AND superseded_at IS NULL)
        OR (status = 'superseded' AND decision_ref IS NULL AND decided_at IS NULL AND superseded_at IS NOT NULL)`,
    )
    .addCheckConstraint(
      "review_tasks_supersede_metadata_ck",
      sql`(superseded_at IS NULL AND superseded_by_command_id IS NULL AND superseded_by_actor IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by_command_id IS NOT NULL AND superseded_by_actor IS NOT NULL)`,
    )
    .addCheckConstraint(
      "review_tasks_identity_ck",
      sql`version_id <> '' AND project_id <> '' AND review_type <> ''
        AND target_kind <> '' AND target_entity_id <> '' AND target_version_id <> ''
        AND waiting_run_entity_id <> '' AND waiting_run_version_id <> ''`,
    )
    .execute();

  await db.schema
    .createTable("business.review_decisions")
    .ifNotExists()
    .addColumn("review_decision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("review_task_id", "text", (column) => column.notNull())
    .addColumn("review_decision_ref", jsonb, (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("review_type", "text", (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("target_ref", jsonb, (column) => column.notNull())
    .addColumn("decision", jsonb, (column) => column.notNull())
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("validation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("evidence_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("waiting_run_ref", jsonb, (column) => column.notNull())
    .addColumn("review_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("decided_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("review_decisions_task_unique", ["review_task_id"])
    .addCheckConstraint("review_decisions_identity_ck", sql`version_id <> '' AND reason_code <> ''`)
    .addForeignKeyConstraint(
      "review_decisions_task_fk",
      ["review_task_id"],
      "business.review_tasks",
      ["review_task_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("audit.review_rejections")
    .ifNotExists()
    .addColumn("rejection_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("target_ref", jsonb, (column) => column.notNull())
    .addColumn("waiting_run_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("result_code", "text", (column) => column.notNull())
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("review_rejections_command_result_unique", [
      "project_id",
      "command_id",
      "result_code",
    ])
    .addUniqueConstraint("review_rejections_idempotency_result_unique", [
      "project_id",
      "idempotency_key",
      "result_code",
    ])
    .addCheckConstraint(
      "review_rejections_result_ck",
      sql`result_code IN ('STALE_VERSION', 'ENTITY_NOT_FOUND')`,
    )
    .execute();

  await db.schema
    .createIndex("review_tasks_pending_identity_idx")
    .ifNotExists()
    .on("business.review_tasks")
    .columns([
      "project_id",
      "waiting_run_entity_id",
      "waiting_run_version_id",
      "review_type",
      "target_kind",
      "target_entity_id",
      "status",
    ])
    .execute();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_pending_stable_target_uidx
    ON business.review_tasks
      (project_id, waiting_run_entity_id, waiting_run_version_id, review_type, target_kind, target_entity_id)
    WHERE status = 'pending'`.execute(db);
  await db.schema
    .createIndex("review_tasks_project_status_idx")
    .ifNotExists()
    .on("business.review_tasks")
    .columns(["project_id", "status", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("review_decisions_project_task_idx")
    .ifNotExists()
    .on("business.review_decisions")
    .columns(["project_id", "review_task_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("review_rejections_project_recorded_idx")
    .ifNotExists()
    .on("audit.review_rejections")
    .columns(["project_id", "recorded_at"])
    .execute();

  await sql`CREATE OR REPLACE FUNCTION business.reject_review_task_terminal_rewrite()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'terminal review task is immutable';
      END IF;
      RETURN NEW;
    END;
    $$`.execute(db);
  await sql`DROP TRIGGER IF EXISTS review_tasks_terminal_immutable
    ON business.review_tasks`.execute(db);
  await sql`CREATE TRIGGER review_tasks_terminal_immutable
    BEFORE UPDATE ON business.review_tasks
    FOR EACH ROW
    EXECUTE FUNCTION business.reject_review_task_terminal_rewrite()`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON FUNCTION business.reject_review_task_terminal_rewrite()
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`CREATE OR REPLACE VIEW audit.review_activity_v1 AS
    SELECT
      a.audit_entry_id AS activity_id,
      'business-audit'::text AS source_type,
      CASE a.action
        WHEN 'review.request-review' THEN 'review.requested'::text
        WHEN 'review.decide-review' THEN 'review.decided'::text
      END AS activity_code,
      a.project_id,
      a.target_ref AS subject_ref,
      a.target_ref ->> 'kind' AS subject_kind,
      a.target_ref -> 'reference' ->> 'entityId' AS subject_entity_id,
      a.target_ref -> 'reference' ->> 'versionId' AS subject_version_id,
      a.actor_ref,
      a.authorization_context_ref,
      a.command_id,
      a.idempotency_key,
      a.target_ref AS review_task_ref,
      t.target_ref,
      CASE WHEN a.action = 'review.decide-review' THEN d.review_decision_ref END AS review_decision_ref,
      t.waiting_run_ref,
      t.validation_snapshot_ref,
      t.evidence_snapshot_ref,
      t.review_policy_ref,
      NULL::text AS result_code,
      CASE WHEN a.action = 'review.decide-review' THEN d.reason_code END AS reason_code,
      a.occurred_at,
      a.recorded_at,
      a.persisted_at
    FROM audit.entries a
    LEFT JOIN business.review_tasks t
      ON t.project_id = a.project_id
      AND t.review_task_id = a.target_ref -> 'reference' ->> 'entityId'
    LEFT JOIN business.review_decisions d
      ON d.project_id = a.project_id
      AND d.review_task_id = t.review_task_id
    WHERE a.action IN ('review.request-review', 'review.decide-review')
    UNION ALL
    SELECT
      t.review_task_id || ':superseded:' || t.superseded_by_command_id AS activity_id,
      'review-task'::text AS source_type,
      'review.superseded'::text AS activity_code,
      t.project_id,
      t.review_task_ref AS subject_ref,
      'review-task'::text AS subject_kind,
      t.review_task_id AS subject_entity_id,
      t.version_id AS subject_version_id,
      t.superseded_by_actor AS actor_ref,
      t.requested_authorization_context_ref AS authorization_context_ref,
      t.superseded_by_command_id AS command_id,
      NULL::text AS idempotency_key,
      t.review_task_ref,
      t.target_ref,
      NULL::jsonb AS review_decision_ref,
      t.waiting_run_ref,
      t.validation_snapshot_ref,
      t.evidence_snapshot_ref,
      t.review_policy_ref,
      NULL::text AS result_code,
      NULL::text AS reason_code,
      t.superseded_at AS occurred_at,
      t.superseded_at AS recorded_at,
      t.persisted_at
    FROM business.review_tasks t
    WHERE t.status = 'superseded'
    UNION ALL
    SELECT
      s.event_id AS activity_id,
      'security-audit'::text AS source_type,
      CASE WHEN s.outcome = 'success'
        THEN 'security.authorization-allowed'::text
        ELSE 'security.authorization-rejected'::text
      END AS activity_code,
      s.project_ref AS project_id,
      s.context_ref AS subject_ref,
      s.context_ref ->> 'kind' AS subject_kind,
      s.context_ref -> 'reference' ->> 'entityId' AS subject_entity_id,
      s.context_ref -> 'reference' ->> 'versionId' AS subject_version_id,
      s.subject_ref AS actor_ref,
      s.context_ref AS authorization_context_ref,
      s.request_ref AS command_id,
      NULL::text AS idempotency_key,
      NULL::jsonb AS review_task_ref,
      NULL::jsonb AS target_ref,
      NULL::jsonb AS review_decision_ref,
      NULL::jsonb AS waiting_run_ref,
      NULL::jsonb AS validation_snapshot_ref,
      NULL::jsonb AS evidence_snapshot_ref,
      NULL::jsonb AS review_policy_ref,
      s.outcome AS result_code,
      s.reason_code,
      s.occurred_at,
      s.recorded_at,
      s.recorded_at AS persisted_at
    FROM business.security_audit_events s
    WHERE s.event_kind IN ('authorize', 'verify')
      AND s.project_ref IS NOT NULL
    UNION ALL
    SELECT
      r.rejection_id AS activity_id,
      'review-rejection'::text AS source_type,
      'review.decision-rejected'::text AS activity_code,
      r.project_id,
      r.review_task_ref AS subject_ref,
      'review-task'::text AS subject_kind,
      r.review_task_ref -> 'reference' ->> 'entityId' AS subject_entity_id,
      r.review_task_ref -> 'reference' ->> 'versionId' AS subject_version_id,
      r.actor_ref,
      r.authorization_context_ref,
      r.command_id,
      r.idempotency_key,
      r.review_task_ref,
      r.target_ref,
      NULL::jsonb AS review_decision_ref,
      r.waiting_run_ref,
      NULL::jsonb AS validation_snapshot_ref,
      NULL::jsonb AS evidence_snapshot_ref,
      NULL::jsonb AS review_policy_ref,
      r.result_code,
      r.reason_code,
      r.occurred_at,
      r.recorded_at,
      r.persisted_at
    FROM audit.review_rejections r`.execute(db);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE audit.review_activity_v1
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`DROP VIEW IF EXISTS audit.review_activity_v1`.execute(db);
  await sql`DROP INDEX IF EXISTS review_rejections_project_recorded_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS review_decisions_project_task_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS review_tasks_project_status_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS review_tasks_pending_stable_target_uidx`.execute(db);
  await sql`DROP INDEX IF EXISTS review_tasks_pending_identity_idx`.execute(db);
  await sql`DROP TRIGGER IF EXISTS review_tasks_terminal_immutable
    ON business.review_tasks`.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.reject_review_task_terminal_rewrite()`.execute(db);
  await db.schema.dropTable("audit.review_rejections").ifExists().execute();
  await db.schema.dropTable("business.review_decisions").ifExists().execute();
  await db.schema.dropTable("business.review_tasks").ifExists().execute();
}
