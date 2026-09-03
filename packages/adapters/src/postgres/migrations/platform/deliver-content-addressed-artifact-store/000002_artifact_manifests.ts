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

  await db.schema
    .createTable("business.artifact_access_records")
    .ifNotExists()
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("request_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("purpose_code", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("stage", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("diagnostic_ref", jsonb)
    .addPrimaryKeyConstraint("artifact_access_records_pk", ["project_id", "request_id", "outcome"])
    .addCheckConstraint("artifact_access_records_schema_ck", sql`schema_version = '1'`)
    .addCheckConstraint(
      "artifact_access_records_outcome_ck",
      sql`outcome IN ('authorized', 'succeeded', 'denied', 'cancelled', 'integrity-failed')`,
    )
    .addCheckConstraint(
      "artifact_access_records_json_ck",
      sql`jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(authorization_policy_ref) = 'object'
        AND (diagnostic_ref IS NULL OR jsonb_typeof(diagnostic_ref) = 'object')`,
    )
    .execute();

  await sql`
    ALTER TABLE business.artifact_access_records
      ADD CONSTRAINT artifact_access_records_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex("artifact_access_records_request_idx")
    .ifNotExists()
    .on("business.artifact_access_records")
    .columns(["project_id", "request_id"])
    .execute();

  await db.schema
    .createTable("business.artifact_maintenance_batches")
    .ifNotExists()
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("run_id", "text", (column) => column.notNull())
    .addColumn("batch_number", "integer", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("operation", "text", (column) => column.notNull())
    .addColumn("policy_ref", jsonb, (column) => column.notNull())
    .addColumn("policy_sha256", "char(64)", (column) => column.notNull())
    .addColumn("run_started_at", timestamptz, (column) => column.notNull())
    .addColumn("cutoff", timestamptz, (column) => column.notNull())
    .addColumn("dry_run", "boolean", (column) => column.notNull())
    .addColumn("candidate_hashes", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("artifact_maintenance_batches_pk", ["run_id", "batch_number"])
    .addCheckConstraint("artifact_maintenance_batches_schema_ck", sql`schema_version = '1'`)
    .addCheckConstraint("artifact_maintenance_batches_number_ck", sql`batch_number > 0`)
    .addCheckConstraint(
      "artifact_maintenance_batches_operation_ck",
      sql`operation IN ('orphan-sweep', 'quarantine-recovery')`,
    )
    .addCheckConstraint(
      "artifact_maintenance_batches_policy_hash_ck",
      sql`policy_sha256 ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "artifact_maintenance_batches_json_ck",
      sql`jsonb_typeof(policy_ref) = 'object'
        AND jsonb_typeof(candidate_hashes) = 'array'`,
    )
    .addForeignKeyConstraint(
      "artifact_maintenance_batches_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await sql`
    ALTER TABLE business.artifact_maintenance_batches
      ADD CONSTRAINT artifact_maintenance_batches_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex("artifact_maintenance_batches_project_run_idx")
    .ifNotExists()
    .on("business.artifact_maintenance_batches")
    .columns(["project_id", "run_id"])
    .execute();

  await sql`GRANT SELECT, INSERT ON TABLE business.artifact_manifests TO riskflow_app`.execute(db);
  await sql`REVOKE UPDATE, DELETE ON TABLE business.artifact_manifests FROM riskflow_app`.execute(
    db,
  );
  await sql`
    GRANT SELECT, INSERT ON TABLE business.artifact_access_records TO riskflow_app;
    GRANT SELECT, INSERT ON TABLE business.artifact_maintenance_batches TO riskflow_app;
    REVOKE UPDATE, DELETE ON TABLE business.artifact_access_records FROM riskflow_app;
    REVOKE UPDATE, DELETE ON TABLE business.artifact_maintenance_batches FROM riskflow_app;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("artifact_maintenance_batches_project_run_idx").ifExists().execute();
  await db.schema.dropTable("business.artifact_maintenance_batches").ifExists().execute();
  await db.schema.dropIndex("artifact_access_records_request_idx").ifExists().execute();
  await db.schema.dropTable("business.artifact_access_records").ifExists().execute();
  await db.schema.dropIndex("artifact_manifests_content_idx").ifExists().execute();
  await db.schema.dropIndex("artifact_manifests_project_artifact_idx").ifExists().execute();
  await db.schema.dropTable("business.artifact_manifests").ifExists().execute();
}
