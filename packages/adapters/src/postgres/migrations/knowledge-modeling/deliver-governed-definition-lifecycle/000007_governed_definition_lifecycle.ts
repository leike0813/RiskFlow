import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.knowledge_definitions")
    .ifNotExists()
    .addColumn("definition_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("created_by", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("knowledge_definitions_pk", ["definition_id", "version_id"])
    .addUniqueConstraint("knowledge_definitions_identity_uidx", ["project_id", "definition_type"])
    .addForeignKeyConstraint(
      "knowledge_definitions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "knowledge_definitions_identity_ck",
      sql`definition_id <> '' AND version_id <> '' AND project_id <> ''
        AND definition_type <> '' AND created_by <> '' AND command_id <> ''`,
    )
    .addCheckConstraint(
      "knowledge_definitions_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.knowledge_definitions
      ADD CONSTRAINT knowledge_definitions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.knowledge_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("definition_id", "text", (column) => column.notNull())
    .addColumn("definition_version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_entity_id", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("base_release_ref", jsonb)
    .addColumn("base_revision_ref", jsonb)
    .addColumn("artifact_identity_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("knowledge_revisions_pk", ["revision_id", "version_id"])
    .addUniqueConstraint("knowledge_revisions_artifact_uidx", [
      "project_id",
      "candidate_artifact_entity_id",
      "candidate_artifact_version_id",
    ])
    .addForeignKeyConstraint(
      "knowledge_revisions_definition_fk",
      ["definition_id", "definition_version_id"],
      "business.knowledge_definitions",
      ["definition_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "knowledge_revisions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "knowledge_revisions_identity_ck",
      sql`revision_id <> '' AND version_id <> '' AND definition_id <> ''
        AND definition_version_id <> '' AND project_id <> '' AND definition_type <> ''
        AND candidate_artifact_entity_id <> '' AND candidate_artifact_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "knowledge_revisions_json_ck",
      sql`jsonb_typeof(candidate_artifact_ref) = 'object'
        AND jsonb_typeof(evidence_references) = 'array'
        AND jsonb_array_length(evidence_references) > 0
        AND (base_release_ref IS NULL OR jsonb_typeof(base_release_ref) = 'object')
        AND (base_revision_ref IS NULL OR jsonb_typeof(base_revision_ref) = 'object')
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .addCheckConstraint(
      "knowledge_revisions_base_pair_ck",
      sql`(base_release_ref IS NULL AND base_revision_ref IS NULL)
        OR (base_release_ref IS NOT NULL AND base_revision_ref IS NOT NULL)`,
    )
    .addCheckConstraint(
      "knowledge_revisions_digest_ck",
      sql`artifact_identity_digest ~ '^[0-9a-f]{64}$'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.knowledge_revisions
      ADD CONSTRAINT knowledge_revisions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.knowledge_review_links")
    .ifNotExists()
    .addColumn("review_attempt_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("revision_ref", jsonb, (column) => column.notNull())
    .addColumn("review_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("review_policy_version_id", "text", (column) => column.notNull())
    .addColumn("review_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("validation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("evidence_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("waiting_run_ref", jsonb, (column) => column.notNull())
    .addColumn("review_task_ref", jsonb)
    .addColumn("review_decision_ref", jsonb)
    .addColumn("state", "text", (column) => column.notNull().defaultTo("waiting"))
    .addColumn("requested_by", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("requested_at", timestamptz, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addForeignKeyConstraint(
      "knowledge_review_links_revision_fk",
      ["revision_id", "revision_version_id"],
      "business.knowledge_revisions",
      ["revision_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "knowledge_review_links_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "knowledge_review_links_identity_ck",
      sql`review_attempt_id <> '' AND version_id <> '' AND project_id <> ''
        AND revision_id <> '' AND revision_version_id <> ''
        AND review_policy_entity_id <> '' AND review_policy_version_id <> ''
        AND requested_by <> '' AND command_id <> ''`,
    )
    .addCheckConstraint(
      "knowledge_review_links_state_ck",
      sql`state IN ('waiting', 'linked')
        AND ((state = 'waiting' AND review_task_ref IS NULL)
          OR (state = 'linked' AND review_task_ref IS NOT NULL))`,
    )
    .addCheckConstraint(
      "knowledge_review_links_json_ck",
      sql`jsonb_typeof(revision_ref) = 'object'
        AND jsonb_typeof(review_policy_ref) = 'object'
        AND jsonb_typeof(validation_snapshot_ref) = 'object'
        AND jsonb_typeof(evidence_snapshot_ref) = 'object'
        AND jsonb_typeof(waiting_run_ref) = 'object'
        AND (review_task_ref IS NULL OR jsonb_typeof(review_task_ref) = 'object')
        AND (review_decision_ref IS NULL OR jsonb_typeof(review_decision_ref) = 'object')
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.knowledge_review_links
      ADD CONSTRAINT knowledge_review_links_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await sql`CREATE OR REPLACE FUNCTION business.guard_knowledge_review_link_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.review_task_ref IS NOT NULL
        AND NEW.review_task_ref IS DISTINCT FROM OLD.review_task_ref
      THEN
        RAISE EXCEPTION 'knowledge review task reference is immutable';
      END IF;
      IF OLD.review_decision_ref IS NOT NULL
        AND NEW.review_decision_ref IS DISTINCT FROM OLD.review_decision_ref
      THEN
        RAISE EXCEPTION 'knowledge review decision reference is immutable';
      END IF;
      IF OLD.state = 'linked' AND NEW.state <> 'linked' THEN
        RAISE EXCEPTION 'linked knowledge review cannot return to waiting';
      END IF;
      IF OLD.state = 'waiting'
        AND (NEW.state <> 'linked' OR NEW.review_task_ref IS NULL)
      THEN
        RAISE EXCEPTION 'knowledge review link must transition to linked with a task';
      END IF;
      IF NEW.review_task_ref IS NOT NULL
        AND (
          NEW.review_task_ref ->> 'kind' IS DISTINCT FROM 'review-task'
          OR NEW.review_task_ref ->> 'reviewType' IS DISTINCT FROM 'knowledge-revision'
          OR NEW.review_task_ref -> 'targetRef' -> 'reference' ->> 'entityId'
            IS DISTINCT FROM NEW.revision_id
          OR NEW.review_task_ref -> 'targetRef' -> 'reference' ->> 'versionId'
            IS DISTINCT FROM NEW.revision_version_id
          OR NEW.review_task_ref -> 'waitingRunRef' -> 'reference' ->> 'entityId'
            IS DISTINCT FROM NEW.waiting_run_ref -> 'reference' ->> 'entityId'
          OR NEW.review_task_ref -> 'waitingRunRef' -> 'reference' ->> 'versionId'
            IS DISTINCT FROM NEW.waiting_run_ref -> 'reference' ->> 'versionId'
        )
      THEN
        RAISE EXCEPTION 'knowledge review task target is inconsistent';
      END IF;
      IF OLD.state = 'linked'
        AND OLD.review_decision_ref IS NULL
        AND NEW.review_decision_ref IS NOT NULL
        AND NEW.review_task_ref IS NULL
      THEN
        RAISE EXCEPTION 'knowledge review decision requires a task';
      END IF;
      RETURN NEW;
    END;
    $$`.execute(db);
  await sql`DROP TRIGGER IF EXISTS knowledge_review_links_transition_guard
    ON business.knowledge_review_links`.execute(db);
  await sql`CREATE TRIGGER knowledge_review_links_transition_guard
    BEFORE UPDATE ON business.knowledge_review_links
    FOR EACH ROW
    EXECUTE FUNCTION business.guard_knowledge_review_link_transition()`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON FUNCTION business.guard_knowledge_review_link_transition()
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await db.schema
    .createTable("business.knowledge_releases")
    .ifNotExists()
    .addColumn("release_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("definition_id", "text", (column) => column.notNull())
    .addColumn("definition_version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("revision_ref", jsonb, (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("review_decision_ref", jsonb, (column) => column.notNull())
    .addColumn("effective_from", timestamptz, (column) => column.notNull())
    .addColumn("restored_from_release_ref", jsonb)
    .addColumn("reason_code", "text")
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("knowledge_releases_pk", ["release_id", "version_id"])
    .addUniqueConstraint("knowledge_releases_effective_uidx", ["definition_id", "effective_from"])
    .addForeignKeyConstraint(
      "knowledge_releases_definition_fk",
      ["definition_id", "definition_version_id"],
      "business.knowledge_definitions",
      ["definition_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "knowledge_releases_revision_fk",
      ["revision_id", "revision_version_id"],
      "business.knowledge_revisions",
      ["revision_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "knowledge_releases_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "knowledge_releases_identity_ck",
      sql`release_id <> '' AND version_id <> '' AND definition_id <> ''
        AND definition_version_id <> '' AND project_id <> '' AND definition_type <> ''
        AND revision_id <> '' AND revision_version_id <> '' AND command_id <> ''
        AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "knowledge_releases_json_ck",
      sql`jsonb_typeof(revision_ref) = 'object'
        AND jsonb_typeof(review_task_ref) = 'object'
        AND jsonb_typeof(review_decision_ref) = 'object'
        AND (restored_from_release_ref IS NULL OR jsonb_typeof(restored_from_release_ref) = 'object')
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .addCheckConstraint(
      "knowledge_releases_rollback_ck",
      sql`(restored_from_release_ref IS NULL AND reason_code IS NULL)
        OR (restored_from_release_ref IS NOT NULL AND reason_code IS NOT NULL AND reason_code <> '')`,
    )
    .execute();

  await sql`
    ALTER TABLE business.knowledge_releases
      ADD CONSTRAINT knowledge_releases_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.knowledge_release_decisions")
    .ifNotExists()
    .addColumn("decision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("release_id", "text", (column) => column.notNull())
    .addColumn("release_version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_id", "text", (column) => column.notNull())
    .addColumn("release_ref", jsonb, (column) => column.notNull())
    .addColumn("decision", "text", (column) => column.notNull().defaultTo("deactivated"))
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("knowledge_release_decisions_pk", ["decision_id", "version_id"])
    .addUniqueConstraint("knowledge_release_decisions_release_uidx", [
      "release_id",
      "release_version_id",
      "decision",
    ])
    .addForeignKeyConstraint(
      "knowledge_release_decisions_release_fk",
      ["release_id", "release_version_id"],
      "business.knowledge_releases",
      ["release_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "knowledge_release_decisions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "knowledge_release_decisions_identity_ck",
      sql`decision_id <> '' AND version_id <> '' AND release_id <> ''
        AND release_version_id <> '' AND project_id <> '' AND definition_id <> ''
        AND reason_code <> '' AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint("knowledge_release_decisions_state_ck", sql`decision = 'deactivated'`)
    .addCheckConstraint(
      "knowledge_release_decisions_json_ck",
      sql`jsonb_typeof(release_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.knowledge_release_decisions
      ADD CONSTRAINT knowledge_release_decisions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex("knowledge_revisions_project_definition_idx")
    .ifNotExists()
    .on("business.knowledge_revisions")
    .columns(["project_id", "definition_type", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("knowledge_review_links_revision_idx")
    .ifNotExists()
    .on("business.knowledge_review_links")
    .columns(["project_id", "revision_id", "revision_version_id", "state"])
    .execute();
  await db.schema
    .createIndex("knowledge_releases_project_definition_time_idx")
    .ifNotExists()
    .on("business.knowledge_releases")
    .columns(["project_id", "definition_type", "effective_from", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("knowledge_releases_definition_time_idx")
    .ifNotExists()
    .on("business.knowledge_releases")
    .columns(["definition_id", "effective_from", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("knowledge_release_decisions_project_release_idx")
    .ifNotExists()
    .on("business.knowledge_release_decisions")
    .columns(["project_id", "release_id", "release_version_id", "recorded_at"])
    .execute();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS knowledge_review_links_waiting_uidx
      ON business.knowledge_review_links
        (project_id, revision_id, revision_version_id,
         review_policy_entity_id, review_policy_version_id)
      WHERE state = 'waiting'
  `.execute(db);

  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.knowledge_definitions,
    business.knowledge_revisions,
    business.knowledge_review_links,
    business.knowledge_releases,
    business.knowledge_release_decisions
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE
    business.knowledge_definitions,
    business.knowledge_revisions,
    business.knowledge_releases,
    business.knowledge_release_decisions
    TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.knowledge_review_links TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT UPDATE (review_task_ref, review_decision_ref, state)
    ON TABLE business.knowledge_review_links TO riskflow_app`.execute(db);
  await sql`REVOKE DELETE ON TABLE
    business.knowledge_definitions,
    business.knowledge_revisions,
    business.knowledge_review_links,
    business.knowledge_releases,
    business.knowledge_release_decisions
    FROM riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.knowledge_release_decisions,
    business.knowledge_releases,
    business.knowledge_review_links,
    business.knowledge_revisions,
    business.knowledge_definitions
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`DROP TRIGGER IF EXISTS knowledge_review_links_transition_guard
    ON business.knowledge_review_links`.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.guard_knowledge_review_link_transition()`.execute(db);
  await sql`DROP INDEX IF EXISTS knowledge_review_links_waiting_uidx`.execute(db);
  await db.schema.dropIndex("knowledge_release_decisions_project_release_idx").ifExists().execute();
  await db.schema.dropIndex("knowledge_releases_definition_time_idx").ifExists().execute();
  await db.schema.dropIndex("knowledge_releases_project_definition_time_idx").ifExists().execute();
  await db.schema.dropIndex("knowledge_review_links_revision_idx").ifExists().execute();
  await db.schema.dropIndex("knowledge_revisions_project_definition_idx").ifExists().execute();
  await db.schema.dropTable("business.knowledge_release_decisions").ifExists().execute();
  await db.schema.dropTable("business.knowledge_releases").ifExists().execute();
  await db.schema.dropTable("business.knowledge_review_links").ifExists().execute();
  await db.schema.dropTable("business.knowledge_revisions").ifExists().execute();
  await db.schema.dropTable("business.knowledge_definitions").ifExists().execute();
}
