import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const commandKind = "engineering-data.structured-document-conversion.v1";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.structured_document_conversions")
    .ifNotExists()
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("conversion_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_kind", "text", (column) => column.notNull().defaultTo(commandKind))
    .addColumn("source_version_ref", jsonb, (column) => column.notNull())
    .addColumn("source_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("input_kind", "text", (column) => column.notNull())
    .addColumn("media_type", "text", (column) => column.notNull())
    .addColumn("conversion_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("quality_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("converter_deployment_ref", jsonb, (column) => column.notNull())
    .addColumn("parser_set_version", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("jsonld_artifact_ref", jsonb)
    .addColumn("source_segment_set_ref", jsonb)
    .addColumn("diagnostic_ref", jsonb)
    .addColumn("authorization_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("run_id", "text", (column) => column.notNull())
    .addColumn("thread_id", "text", (column) => column.notNull())
    .addColumn("statistics", jsonb, (column) => column.notNull())
    .addColumn("started_at", timestamptz, (column) => column.notNull())
    .addColumn("completed_at", timestamptz, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("structured_document_conversions_pk", ["conversion_id", "version_id"])
    .addUniqueConstraint("structured_document_conversions_idempotency_unique", [
      "project_id",
      "command_kind",
      "idempotency_key",
    ])
    .addCheckConstraint("structured_document_conversions_schema_ck", sql`schema_version = '1'`)
    .addCheckConstraint(
      "structured_document_conversions_input_ck",
      sql`input_kind IN ('docx', 'text-pdf', 'xlsx', 'csv', 'ocr-layout')`,
    )
    .addCheckConstraint(
      "structured_document_conversions_status_ck",
      sql`status IN ('succeeded', 'failed')`,
    )
    .addCheckConstraint(
      "structured_document_conversions_result_ck",
      sql`(
        (status = 'succeeded'
          AND jsonld_artifact_ref IS NOT NULL
          AND source_segment_set_ref IS NOT NULL
          AND diagnostic_ref IS NULL)
        OR
        (status = 'failed' AND diagnostic_ref IS NOT NULL)
      )`,
    )
    .addCheckConstraint(
      "structured_document_conversions_json_ck",
      sql`jsonb_typeof(source_version_ref) = 'object'
        AND jsonb_typeof(source_artifact_ref) = 'object'
        AND jsonb_typeof(conversion_policy_ref) = 'object'
        AND jsonb_typeof(quality_policy_ref) = 'object'
        AND jsonb_typeof(converter_deployment_ref) = 'object'
        AND jsonb_typeof(authorization_policy_ref) = 'object'
        AND jsonb_typeof(statistics) = 'object'
        AND (jsonld_artifact_ref IS NULL OR jsonb_typeof(jsonld_artifact_ref) = 'object')
        AND (source_segment_set_ref IS NULL OR jsonb_typeof(source_segment_set_ref) = 'object')
        AND (diagnostic_ref IS NULL OR jsonb_typeof(diagnostic_ref) = 'object')`,
    )
    .addCheckConstraint(
      "structured_document_conversions_identity_ck",
      sql`length(trim(conversion_id)) > 0
        AND length(trim(version_id)) > 0
        AND length(trim(project_id)) > 0
        AND command_kind = ${sql.lit(commandKind)}
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0
        AND length(trim(actor_id)) > 0
        AND length(trim(run_id)) > 0
        AND length(trim(thread_id)) > 0
        AND length(trim(media_type)) > 0
        AND length(trim(parser_set_version)) > 0`,
    )
    .addForeignKeyConstraint(
      "structured_document_conversions_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("structured_document_conversions_project_ref_idx")
    .ifNotExists()
    .on("business.structured_document_conversions")
    .columns(["project_id", "conversion_id", "version_id"])
    .execute();

  await sql`
    ALTER TABLE business.structured_document_conversions
      ADD CONSTRAINT structured_document_conversions_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await sql`
    REVOKE ALL PRIVILEGES ON TABLE business.structured_document_conversions
      FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer;
    GRANT SELECT, INSERT ON TABLE business.structured_document_conversions TO riskflow_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    REVOKE ALL PRIVILEGES ON TABLE business.structured_document_conversions
      FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer
  `.execute(db);
  await db.schema.dropIndex("structured_document_conversions_project_ref_idx").ifExists().execute();
  await db.schema.dropTable("business.structured_document_conversions").ifExists().execute();
}
