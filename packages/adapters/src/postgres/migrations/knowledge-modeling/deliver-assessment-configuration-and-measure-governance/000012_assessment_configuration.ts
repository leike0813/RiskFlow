import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

/**
 * C18 stores only configuration associations and immutable release sets.
 * Configuration bodies stay in C04; Zod remains the content fact source.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.assessment_config_revision_metadata")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("artifact_entity_id", "text", (column) => column.notNull())
    .addColumn("artifact_version_id", "text", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("configuration_set_ref", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("summary", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_config_revision_metadata_pk", [
      "revision_id",
      "version_id",
    ])
    .addForeignKeyConstraint(
      "assessment_config_revision_metadata_revision_fk",
      ["revision_id", "version_id"],
      "business.knowledge_revisions",
      ["revision_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "assessment_config_revision_metadata_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "assessment_config_revision_metadata_identity_ck",
      sql`revision_id <> '' AND version_id <> '' AND project_id <> ''
        AND definition_type <> '' AND artifact_entity_id <> '' AND artifact_version_id <> ''
        AND command_id <> ''`,
    )
    .addCheckConstraint(
      "assessment_config_revision_metadata_json_ck",
      sql`jsonb_typeof(artifact_ref) = 'object'
        AND jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(configuration_set_ref) = 'object'
        AND jsonb_typeof(summary) = 'object'`,
    )
    .addCheckConstraint(
      "assessment_config_revision_metadata_digest_ck",
      sql`content_digest ~ '^[0-9a-f]{64}$'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.assessment_config_revision_metadata
      ADD CONSTRAINT assessment_config_revision_metadata_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.assessment_configuration_release_sets")
    .ifNotExists()
    .addColumn("set_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("configuration_set_ref", jsonb, (column) => column.notNull())
    .addColumn("required_at", timestamptz, (column) => column.notNull())
    .addColumn("as_of_recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("member_digest", "char(64)", (column) => column.notNull())
    .addColumn("identity_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_configuration_release_sets_pk", ["set_id", "version_id"])
    .addUniqueConstraint("assessment_configuration_release_sets_identity_uidx", ["identity_digest"])
    .addForeignKeyConstraint(
      "assessment_configuration_release_sets_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "assessment_configuration_release_sets_identity_ck",
      sql`set_id <> '' AND version_id <> '' AND project_id <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_sets_time_ck",
      sql`as_of_recorded_at >= required_at`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_sets_digest_ck",
      sql`member_digest ~ '^[0-9a-f]{64}$' AND identity_digest ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_sets_json_ck",
      sql`jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(configuration_set_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.assessment_configuration_release_sets
      ADD CONSTRAINT assessment_configuration_release_sets_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.assessment_configuration_release_set_members")
    .ifNotExists()
    .addColumn("set_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("ordinal", "integer", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("release_id", "text", (column) => column.notNull())
    .addColumn("release_version_id", "text", (column) => column.notNull())
    .addColumn("release_ref", jsonb, (column) => column.notNull())
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("revision_ref", jsonb, (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_configuration_release_set_members_pk", [
      "set_id",
      "version_id",
      "definition_type",
    ])
    .addUniqueConstraint("assessment_configuration_release_set_members_ordinal_uidx", [
      "set_id",
      "version_id",
      "ordinal",
    ])
    .addForeignKeyConstraint(
      "assessment_configuration_release_set_members_set_fk",
      ["set_id", "version_id"],
      "business.assessment_configuration_release_sets",
      ["set_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "assessment_configuration_release_set_members_release_fk",
      ["release_id", "release_version_id"],
      "business.knowledge_releases",
      ["release_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "assessment_configuration_release_set_members_metadata_fk",
      ["revision_id", "revision_version_id"],
      "business.assessment_config_revision_metadata",
      ["revision_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "assessment_configuration_release_set_members_identity_ck",
      sql`set_id <> '' AND version_id <> '' AND definition_type <> ''
        AND release_id <> '' AND release_version_id <> ''
        AND revision_id <> '' AND revision_version_id <> ''`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_set_members_ordinal_ck",
      sql`ordinal >= 0`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_set_members_digest_ck",
      sql`content_digest ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "assessment_configuration_release_set_members_json_ck",
      sql`jsonb_typeof(release_ref) = 'object'
        AND jsonb_typeof(revision_ref) = 'object'
        AND jsonb_typeof(artifact_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createIndex("assessment_config_revision_metadata_project_idx")
    .ifNotExists()
    .on("business.assessment_config_revision_metadata")
    .columns(["project_id", "definition_type", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_configuration_release_sets_project_idx")
    .ifNotExists()
    .on("business.assessment_configuration_release_sets")
    .columns(["project_id", "required_at", "as_of_recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_configuration_release_set_members_revision_idx")
    .ifNotExists()
    .on("business.assessment_configuration_release_set_members")
    .columns(["revision_id", "revision_version_id"])
    .execute();

  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.assessment_config_revision_metadata,
    business.assessment_configuration_release_sets,
    business.assessment_configuration_release_set_members
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE
    business.assessment_config_revision_metadata,
    business.assessment_configuration_release_sets,
    business.assessment_configuration_release_set_members
    TO riskflow_app`.execute(db);
  await sql`REVOKE UPDATE, DELETE ON TABLE
    business.assessment_config_revision_metadata,
    business.assessment_configuration_release_sets,
    business.assessment_configuration_release_set_members
    FROM riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.assessment_configuration_release_set_members,
    business.assessment_configuration_release_sets,
    business.assessment_config_revision_metadata
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema
    .dropIndex("assessment_configuration_release_set_members_revision_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("assessment_configuration_release_sets_project_idx")
    .ifExists()
    .execute();
  await db.schema.dropIndex("assessment_config_revision_metadata_project_idx").ifExists().execute();
  await db.schema
    .dropTable("business.assessment_configuration_release_set_members")
    .ifExists()
    .execute();
  await db.schema.dropTable("business.assessment_configuration_release_sets").ifExists().execute();
  await db.schema.dropTable("business.assessment_config_revision_metadata").ifExists().execute();
}
