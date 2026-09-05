import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

const tables = [
  "business.engineering_projects",
  "business.engineering_project_revisions",
  "business.engineering_spatial_segments",
  "business.engineering_spatial_segment_revisions",
  "business.source_items",
  "business.source_deliveries",
  "business.source_versions",
  "business.source_segment_sets",
  "business.source_segments",
  "business.applicability_metadata_snapshots",
] as const;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`GRANT SELECT, INSERT ON TABLE
    business.engineering_projects,
    business.engineering_project_revisions,
    business.engineering_spatial_segments,
    business.engineering_spatial_segment_revisions,
    business.source_items,
    business.source_deliveries,
    business.source_versions,
    business.source_segment_sets,
    business.source_segments,
    business.applicability_metadata_snapshots
    TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (current_revision_id) ON TABLE
    business.engineering_projects,
    business.engineering_spatial_segments
    TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (source_access_grant_ref, access_status)
    ON TABLE business.source_versions TO riskflow_app`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.engineering_projects")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("current_revision_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addCheckConstraint(
      "engineering_projects_identity_ck",
      sql`project_id <> '' AND current_revision_id <> ''`,
    )
    .execute();

  await db.schema
    .createTable("business.engineering_project_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("revision_no", "integer", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("lifecycle", "text", (column) => column.notNull())
    .addColumn("applicability_metadata", jsonb, (column) => column.notNull())
    .addColumn("effective_period", jsonb, (column) => column.notNull())
    .addColumn("system_time", jsonb, (column) => column.notNull())
    .addColumn("previous_revision_id", "text")
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("engineering_project_revisions_identity_unique", [
      "project_id",
      "revision_no",
    ])
    .addUniqueConstraint("engineering_project_revisions_ref_unique", ["revision_id", "project_id"])
    .addForeignKeyConstraint(
      "engineering_project_revisions_project_fk",
      ["project_id"],
      "business.engineering_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "engineering_project_revisions_previous_fk",
      ["previous_revision_id", "project_id"],
      "business.engineering_project_revisions",
      ["revision_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("engineering_project_revisions_no_ck", sql`revision_no > 0`)
    .addCheckConstraint(
      "engineering_project_revisions_lifecycle_ck",
      sql`lifecycle IN ('preparing', 'active', 'ended', 'archived')`,
    )
    .addCheckConstraint(
      "engineering_project_revisions_json_ck",
      sql`jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(applicability_metadata) = 'object'
        AND jsonb_typeof(effective_period) = 'object'
        AND jsonb_typeof(system_time) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .addCheckConstraint(
      "engineering_project_revisions_name_ck",
      sql`length(trim(name)) BETWEEN 1 AND 200`,
    )
    .execute();

  await db.schema
    .createTable("business.engineering_spatial_segments")
    .ifNotExists()
    .addColumn("scope_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("current_revision_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("engineering_spatial_segments_identity_unique", ["scope_id", "project_id"])
    .addForeignKeyConstraint(
      "engineering_spatial_segments_project_fk",
      ["project_id"],
      "business.engineering_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "engineering_spatial_segments_identity_ck",
      sql`scope_id <> '' AND current_revision_id <> ''`,
    )
    .execute();

  await db.schema
    .createTable("business.engineering_spatial_segment_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("scope_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("revision_no", "integer", (column) => column.notNull())
    .addColumn("spatial_scope_ref", jsonb, (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("parent_scope_ref", jsonb)
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("worksite_location", "text", (column) => column.notNull())
    .addColumn("chainage", jsonb)
    .addColumn("applicability_overrides", jsonb, (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("effective_period", jsonb, (column) => column.notNull())
    .addColumn("system_time", jsonb, (column) => column.notNull())
    .addColumn("previous_revision_id", "text")
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("engineering_spatial_segment_revisions_identity_unique", [
      "scope_id",
      "revision_no",
    ])
    .addUniqueConstraint("engineering_spatial_segment_revisions_ref_unique", [
      "revision_id",
      "project_id",
    ])
    .addUniqueConstraint("engineering_spatial_segment_revisions_scope_ref_unique", [
      "revision_id",
      "scope_id",
    ])
    .addForeignKeyConstraint(
      "engineering_spatial_segment_revisions_scope_fk",
      ["scope_id", "project_id"],
      "business.engineering_spatial_segments",
      ["scope_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "engineering_spatial_segment_revisions_previous_fk",
      ["previous_revision_id", "scope_id"],
      "business.engineering_spatial_segment_revisions",
      ["revision_id", "scope_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("engineering_spatial_segment_revisions_no_ck", sql`revision_no > 0`)
    .addCheckConstraint(
      "engineering_spatial_segment_revisions_status_ck",
      sql`status IN ('active', 'inactive')`,
    )
    .addCheckConstraint(
      "engineering_spatial_segment_revisions_json_ck",
      sql`jsonb_typeof(spatial_scope_ref) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND (parent_scope_ref IS NULL OR jsonb_typeof(parent_scope_ref) = 'object')
        AND (chainage IS NULL OR jsonb_typeof(chainage) = 'object')
        AND jsonb_typeof(applicability_overrides) = 'object'
        AND jsonb_typeof(effective_period) = 'object'
        AND jsonb_typeof(system_time) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .addCheckConstraint(
      "engineering_spatial_segment_revisions_name_ck",
      sql`length(trim(name)) BETWEEN 1 AND 200`,
    )
    .addCheckConstraint(
      "engineering_spatial_segment_revisions_location_ck",
      sql`length(trim(worksite_location)) BETWEEN 1 AND 500`,
    )
    .execute();

  await db.schema
    .createTable("business.source_items")
    .ifNotExists()
    .addColumn("source_item_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("category", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("source_items_project_identity_unique", ["project_id", "source_item_id"])
    .addForeignKeyConstraint(
      "source_items_project_fk",
      ["project_id"],
      "business.engineering_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("source_items_identity_ck", sql`source_item_id <> '' AND project_id <> ''`)
    .addCheckConstraint("source_items_name_ck", sql`length(trim(name)) BETWEEN 1 AND 200`)
    .addCheckConstraint("source_items_category_ck", sql`length(trim(category)) BETWEEN 1 AND 200`)
    .addCheckConstraint(
      "source_items_auth_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.source_deliveries")
    .ifNotExists()
    .addColumn("source_delivery_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_item_id", "text", (column) => column.notNull())
    .addColumn("delivery_key", "text", (column) => column.notNull())
    .addColumn("source_delivery_ref", jsonb, (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("descriptor", jsonb, (column) => column.notNull())
    .addColumn("source_metadata", jsonb, (column) => column.notNull())
    .addColumn("source_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("metadata_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("applicability_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("registered_by", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addUniqueConstraint("source_deliveries_project_delivery_unique", [
      "project_id",
      "delivery_key",
    ])
    .addUniqueConstraint("source_deliveries_ref_unique", ["source_delivery_id", "version_id"])
    .addUniqueConstraint("source_deliveries_project_identity_unique", [
      "source_delivery_id",
      "project_id",
    ])
    .addForeignKeyConstraint(
      "source_deliveries_item_fk",
      ["source_item_id"],
      "business.source_items",
      ["source_item_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "source_deliveries_identity_ck",
      sql`project_id <> '' AND delivery_key <> ''`,
    )
    .addCheckConstraint(
      "source_deliveries_json_ck",
      sql`jsonb_typeof(source_delivery_ref) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(spatial_scope_refs) = 'array'
        AND jsonb_array_length(spatial_scope_refs) > 0
        AND jsonb_typeof(descriptor) = 'object'
        AND jsonb_typeof(source_metadata) = 'object'
        AND jsonb_typeof(source_artifact_ref) = 'object'
        AND jsonb_typeof(metadata_artifact_ref) = 'object'
        AND jsonb_typeof(applicability_snapshot_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.source_versions")
    .ifNotExists()
    .addColumn("source_version_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("source_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_item_id", "text", (column) => column.notNull())
    .addColumn("source_delivery_id", "text", (column) => column.notNull())
    .addColumn("source_delivery_ref", jsonb, (column) => column.notNull())
    .addColumn("source_version_ref", jsonb, (column) => column.notNull())
    .addColumn("source_version_sequence", "integer", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("source_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("metadata_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("source_access_grant_ref", jsonb)
    .addColumn("access_status", "text", (column) => column.notNull().defaultTo("pending-access"))
    .addColumn("applicability_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("previous_source_version_id", "text")
    .addColumn("registered_by", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addUniqueConstraint("source_versions_source_unique", ["project_id", "source_id"])
    .addUniqueConstraint("source_versions_item_sequence_unique", [
      "source_item_id",
      "source_version_sequence",
    ])
    .addUniqueConstraint("source_versions_ref_unique", ["source_version_id", "version_id"])
    .addUniqueConstraint("source_versions_project_ref_unique", ["source_version_id", "project_id"])
    .addForeignKeyConstraint(
      "source_versions_delivery_fk",
      ["source_delivery_id", "project_id"],
      "business.source_deliveries",
      ["source_delivery_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_versions_item_fk",
      ["source_item_id"],
      "business.source_items",
      ["source_item_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_versions_previous_fk",
      ["previous_source_version_id"],
      "business.source_versions",
      ["source_version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("source_versions_sequence_ck", sql`source_version_sequence > 0`)
    .addCheckConstraint(
      "source_versions_access_status_ck",
      sql`access_status IN ('pending-access', 'ready')`,
    )
    .addCheckConstraint(
      "source_versions_json_ck",
      sql`jsonb_typeof(source_delivery_ref) = 'object'
        AND jsonb_typeof(source_version_ref) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(spatial_scope_refs) = 'array'
        AND jsonb_array_length(spatial_scope_refs) > 0
        AND jsonb_typeof(source_artifact_ref) = 'object'
        AND jsonb_typeof(metadata_artifact_ref) = 'object'
        AND (source_access_grant_ref IS NULL OR jsonb_typeof(source_access_grant_ref) = 'object')
        AND jsonb_typeof(applicability_snapshot_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.source_segment_sets")
    .ifNotExists()
    .addColumn("source_segment_set_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_version_id", "text", (column) => column.notNull())
    .addColumn("source_id", "text", (column) => column.notNull())
    .addColumn("source_segment_set_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addUniqueConstraint("source_segment_sets_version_unique", ["project_id", "source_version_id"])
    .addUniqueConstraint("source_segment_sets_ref_unique", ["source_segment_set_id", "version_id"])
    .addForeignKeyConstraint(
      "source_segment_sets_version_fk",
      ["source_version_id", "project_id"],
      "business.source_versions",
      ["source_version_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "source_segment_sets_json_ck",
      sql`jsonb_typeof(source_segment_set_ref) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.source_segments")
    .ifNotExists()
    .addColumn("source_segment_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_version_id", "text", (column) => column.notNull())
    .addColumn("source_segment_set_id", "text", (column) => column.notNull())
    .addColumn("chapter_id", "text", (column) => column.notNull())
    .addColumn("segment_id", "text", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("locator", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("source_segments_version_identity_unique", [
      "project_id",
      "source_version_id",
      "chapter_id",
      "segment_id",
    ])
    .addForeignKeyConstraint(
      "source_segments_set_fk",
      ["source_segment_set_id"],
      "business.source_segment_sets",
      ["source_segment_set_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_segments_version_fk",
      ["source_version_id", "project_id"],
      "business.source_versions",
      ["source_version_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "source_segments_identity_ck",
      sql`source_segment_id ~ '^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+$' AND chapter_id ~ '^[A-Za-z0-9_]+$' AND segment_id ~ '^[A-Za-z0-9_]+$'`,
    )
    .addCheckConstraint(
      "source_segments_kind_ck",
      sql`kind IN ('chapter', 'table', 'monitoring-window')`,
    )
    .addCheckConstraint(
      "source_segments_json_ck",
      sql`jsonb_typeof(spatial_scope_refs) = 'array' AND jsonb_array_length(spatial_scope_refs) > 0 AND jsonb_typeof(locator) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.applicability_metadata_snapshots")
    .ifNotExists()
    .addColumn("snapshot_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("applicability_metadata", jsonb, (column) => column.notNull())
    .addColumn("provenance", jsonb, (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_ref", jsonb, (column) => column.notNull())
    .addColumn("formed_at", timestamptz, (column) => column.notNull())
    .addColumn("worksite_location", "text")
    .addColumn("chainage", jsonb)
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addUniqueConstraint("applicability_metadata_snapshots_ref_unique", [
      "snapshot_id",
      "version_id",
    ])
    .addForeignKeyConstraint(
      "applicability_metadata_snapshots_project_fk",
      ["project_id"],
      "business.engineering_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "applicability_metadata_snapshots_json_ck",
      sql`jsonb_typeof(snapshot_ref) = 'object'
        AND jsonb_typeof(applicability_metadata) = 'object'
        AND jsonb_typeof(provenance) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(spatial_scope_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'
        AND (chainage IS NULL OR jsonb_typeof(chainage) = 'object')`,
    )
    .execute();

  await sql`
    ALTER TABLE business.engineering_projects
      ADD CONSTRAINT engineering_projects_current_revision_fk
      FOREIGN KEY (current_revision_id, project_id)
      REFERENCES business.engineering_project_revisions(revision_id, project_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.engineering_spatial_segments
      ADD CONSTRAINT engineering_spatial_segments_current_revision_fk
      FOREIGN KEY (current_revision_id, scope_id)
      REFERENCES business.engineering_spatial_segment_revisions(revision_id, scope_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex("engineering_project_revisions_project_recorded_idx")
    .ifNotExists()
    .on("business.engineering_project_revisions")
    .columns(["project_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("engineering_spatial_segment_revisions_project_recorded_idx")
    .ifNotExists()
    .on("business.engineering_spatial_segment_revisions")
    .columns(["project_id", "scope_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("source_versions_project_recorded_idx")
    .ifNotExists()
    .on("business.source_versions")
    .columns(["project_id", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("source_segments_version_idx")
    .ifNotExists()
    .on("business.source_segments")
    .columns(["project_id", "source_version_id"])
    .execute();

  await sql`CREATE OR REPLACE FUNCTION business.bind_source_access_ready()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.access_status <> 'pending-access'
        OR NEW.access_status <> 'ready'
        OR NEW.source_access_grant_ref IS NULL
      THEN
        RAISE EXCEPTION 'source access can only transition pending-access to ready with a grant';
      END IF;
      RETURN NEW;
    END;
    $$`.execute(db);
  await sql`DROP TRIGGER IF EXISTS source_versions_access_transition
    ON business.source_versions`.execute(db);
  await sql`CREATE TRIGGER source_versions_access_transition
    BEFORE UPDATE OF access_status, source_access_grant_ref
    ON business.source_versions
    FOR EACH ROW
    EXECUTE FUNCTION business.bind_source_access_ready()`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON FUNCTION business.bind_source_access_ready()
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`
    ALTER TABLE business.engineering_project_revisions
      ADD CONSTRAINT engineering_project_revisions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.engineering_spatial_segment_revisions
      ADD CONSTRAINT engineering_spatial_segment_revisions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.source_items
      ADD CONSTRAINT source_items_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.source_deliveries
      ADD CONSTRAINT source_deliveries_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.source_versions
      ADD CONSTRAINT source_versions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.source_segment_sets
      ADD CONSTRAINT source_segment_sets_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE business.applicability_metadata_snapshots
      ADD CONSTRAINT applicability_metadata_snapshots_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE IF EXISTS business.engineering_spatial_segments
      DROP CONSTRAINT IF EXISTS engineering_spatial_segments_current_revision_fk;
    ALTER TABLE IF EXISTS business.engineering_projects
      DROP CONSTRAINT IF EXISTS engineering_projects_current_revision_fk
  `.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON FUNCTION business.bind_source_access_ready()
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`DROP TRIGGER IF EXISTS source_versions_access_transition
    ON business.source_versions`.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.bind_source_access_ready()`.execute(db);
  await db.schema.dropIndex("source_segments_version_idx").ifExists().execute();
  await db.schema.dropIndex("source_versions_project_recorded_idx").ifExists().execute();
  await db.schema
    .dropIndex("engineering_spatial_segment_revisions_project_recorded_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("engineering_project_revisions_project_recorded_idx")
    .ifExists()
    .execute();
  for (const table of [
    "business.applicability_metadata_snapshots",
    "business.source_segments",
    "business.source_segment_sets",
    "business.source_versions",
    "business.source_deliveries",
    "business.source_items",
    "business.engineering_spatial_segment_revisions",
    "business.engineering_spatial_segments",
    "business.engineering_project_revisions",
    "business.engineering_projects",
  ] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
