import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const cleaningResultCommandKind = "engineering-data.data-cleaning-result.v1";
const identificationPreparationCommandKind = "engineering-data.identification-preparation.v1";

const tables = [
  "business.data_cleaning_results",
  "business.identification_preparation_snapshots",
] as const;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.data_cleaning_results")
    .ifNotExists()
    .addColumn("result_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("command_kind", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("agent_task_ref", jsonb, (column) => column.notNull())
    .addColumn("manifest_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("result_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("policy_ref", jsonb, (column) => column.notNull())
    .addColumn("overall_availability", "text", (column) => column.notNull())
    .addColumn("result_payload", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("data_cleaning_results_pk", ["result_id", "version_id"])
    .addUniqueConstraint("data_cleaning_results_task_unique", ["project_id", "agent_task_ref"])
    .addUniqueConstraint("data_cleaning_results_result_unique", [
      "project_id",
      "result_artifact_ref",
    ])
    .addUniqueConstraint("data_cleaning_results_manifest_unique", [
      "project_id",
      "manifest_artifact_ref",
    ])
    .addUniqueConstraint("data_cleaning_results_command_unique", [
      "project_id",
      "command_kind",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "data_cleaning_results_availability_ck",
      sql`overall_availability IN ('available', 'partial', 'unavailable')`,
    )
    .addCheckConstraint(
      "data_cleaning_results_identity_ck",
      sql`schema_version = '1'
        AND command_kind = ${sql.lit(cleaningResultCommandKind)}
        AND length(trim(result_id)) > 0
        AND length(trim(version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0`,
    )
    .addCheckConstraint(
      "data_cleaning_results_json_ck",
      sql`jsonb_typeof(agent_task_ref) = 'object'
        AND jsonb_typeof(manifest_artifact_ref) = 'object'
        AND jsonb_typeof(result_artifact_ref) = 'object'
        AND jsonb_typeof(policy_ref) = 'object'
        AND jsonb_typeof(result_payload) = 'object'`,
    )
    .addForeignKeyConstraint(
      "data_cleaning_results_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("data_cleaning_results_project_task_idx")
    .ifNotExists()
    .on("business.data_cleaning_results")
    .columns(["project_id", "result_id", "version_id"])
    .execute();

  await sql`
    ALTER TABLE business.data_cleaning_results
      ADD CONSTRAINT data_cleaning_results_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.identification_preparation_snapshots")
    .ifNotExists()
    .addColumn("snapshot_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("command_kind", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("payload_hash", "text", (column) => column.notNull())
    .addColumn("agent_task_ref", jsonb, (column) => column.notNull())
    .addColumn("cleaning_result_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("snapshot_payload", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("identification_preparation_snapshots_pk", [
      "snapshot_id",
      "version_id",
    ])
    .addUniqueConstraint("identification_preparation_snapshots_command_unique", [
      "project_id",
      "command_id",
    ])
    .addUniqueConstraint("identification_preparation_snapshots_idempotency_unique", [
      "project_id",
      "idempotency_key",
    ])
    .addUniqueConstraint("identification_preparation_snapshots_ref_unique", [
      "project_id",
      "snapshot_ref",
    ])
    .addCheckConstraint(
      "identification_preparation_snapshots_hash_ck",
      sql`payload_hash ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "identification_preparation_snapshots_identity_ck",
      sql`schema_version = '1'
        AND command_kind = ${sql.lit(identificationPreparationCommandKind)}
        AND length(trim(snapshot_id)) > 0
        AND length(trim(version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0`,
    )
    .addCheckConstraint(
      "identification_preparation_snapshots_json_ck",
      sql`jsonb_typeof(agent_task_ref) = 'object'
        AND jsonb_typeof(cleaning_result_artifact_ref) = 'object'
        AND jsonb_typeof(snapshot_ref) = 'object'
        AND jsonb_typeof(snapshot_payload) = 'object'`,
    )
    .addForeignKeyConstraint(
      "identification_preparation_snapshots_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("identification_preparation_snapshots_project_idx")
    .ifNotExists()
    .on("business.identification_preparation_snapshots")
    .columns(["project_id", "snapshot_id", "version_id"])
    .execute();

  await sql`
    ALTER TABLE business.identification_preparation_snapshots
      ADD CONSTRAINT identification_preparation_snapshots_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema
    .dropIndex("identification_preparation_snapshots_project_idx")
    .ifExists()
    .execute();
  await db.schema.dropIndex("data_cleaning_results_project_task_idx").ifExists().execute();
  await db.schema.dropTable("business.identification_preparation_snapshots").ifExists().execute();
  await db.schema.dropTable("business.data_cleaning_results").ifExists().execute();
}
