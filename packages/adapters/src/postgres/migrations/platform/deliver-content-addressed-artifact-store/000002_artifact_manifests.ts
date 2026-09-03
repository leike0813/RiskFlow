import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.artifact_manifests")
    .ifNotExists()
    .addColumn("artifact_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("artifact_kind", "text", (column) => column.notNull())
    .addColumn("content_sha256", "char(64)", (column) => column.notNull())
    .addColumn("byte_length", "bigint", (column) => column.notNull())
    .addColumn("media_type", "text", (column) => column.notNull())
    .addColumn("purpose_code", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("source_access_grant_refs", jsonb, (column) => column.notNull())
    .addColumn("authorization_policy_refs", jsonb, (column) => column.notNull())
    .addColumn("write_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("parent_artifact_refs", jsonb, (column) => column.notNull())
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("producer_command_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("manifest_sha256", "char(64)", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("artifact_manifests_pk", ["artifact_id", "version_id"])
    .addCheckConstraint(
      "artifact_manifests_kind_ck",
      sql`artifact_kind IN ('content', 'diagnostic')`,
    )
    .addCheckConstraint(
      "artifact_manifests_hash_ck",
      sql`content_sha256 ~ '^[0-9a-f]{64}$' AND manifest_sha256 ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "artifact_manifests_version_ck",
      sql`version_id = 'sha256:' || content_sha256`,
    )
    .addCheckConstraint("artifact_manifests_length_ck", sql`byte_length >= 0`)
    .addCheckConstraint(
      "artifact_manifests_json_ck",
      sql`jsonb_typeof(spatial_scope_refs) = 'array'
        AND jsonb_typeof(source_access_grant_refs) = 'array'
        AND jsonb_typeof(authorization_policy_refs) = 'array'
        AND jsonb_array_length(authorization_policy_refs) > 0
        AND jsonb_typeof(write_policy_ref) = 'object'
        AND jsonb_typeof(parent_artifact_refs) = 'array'
        AND jsonb_typeof(evidence_references) = 'array'`,
    )
    .addCheckConstraint("artifact_manifests_media_type_ck", sql`length(trim(media_type)) > 0`)
    .addForeignKeyConstraint(
      "artifact_manifests_command_fk",
      ["producer_command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("artifact_manifests_project_artifact_idx")
    .ifNotExists()
    .on("business.artifact_manifests")
    .columns(["project_id", "artifact_id", "version_id"])
    .execute();

  await db.schema
    .createIndex("artifact_manifests_content_idx")
    .ifNotExists()
    .on("business.artifact_manifests")
    .column("content_sha256")
    .execute();

  await sql`
    ALTER TABLE business.artifact_manifests
      ADD CONSTRAINT artifact_manifests_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await sql`GRANT SELECT, INSERT ON TABLE business.artifact_manifests TO riskflow_app`.execute(db);
  await sql`REVOKE UPDATE, DELETE ON TABLE business.artifact_manifests FROM riskflow_app`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("artifact_manifests_content_idx").ifExists().execute();
  await db.schema.dropIndex("artifact_manifests_project_artifact_idx").ifExists().execute();
  await db.schema.dropTable("business.artifact_manifests").ifExists().execute();
}
