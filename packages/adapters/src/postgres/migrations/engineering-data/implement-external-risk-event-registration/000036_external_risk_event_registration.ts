import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

const table = "business.external_risk_events";
const indexName = "external_risk_events_project_occurred_idx";

const revokeAll = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE business.external_risk_events
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
};

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.external_risk_events
    TO riskflow_app`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(table)
    .ifNotExists()
    .addColumn("external_risk_event_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("external_risk_event_ref", jsonb, (column) => column.notNull())
    .addColumn("external_source_entity_id", "text", (column) => column.notNull())
    .addColumn("external_source_version_id", "text", (column) => column.notNull())
    .addColumn("external_source_ref", jsonb, (column) => column.notNull())
    .addColumn("external_event_key", "text", (column) => column.notNull())
    .addColumn("event_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("source_version_refs", jsonb, (column) => column.notNull())
    .addColumn("spatial_scope_refs", jsonb, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addUniqueConstraint("external_risk_events_ref_unique", [
      "external_risk_event_id",
      "version_id",
    ])
    .addUniqueConstraint("external_risk_events_identity_unique", [
      "external_risk_event_id",
      "project_id",
    ])
    .addUniqueConstraint("external_risk_events_source_key_unique", [
      "project_id",
      "external_source_entity_id",
      "external_source_version_id",
      "external_event_key",
    ])
    .addForeignKeyConstraint(
      "external_risk_events_project_fk",
      ["project_id"],
      "business.engineering_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "external_risk_events_identity_ck",
      sql`external_risk_event_id <> ''
        AND version_id <> ''
        AND project_id <> ''
        AND external_source_entity_id <> ''
        AND external_source_version_id <> ''
        AND external_event_key <> ''`,
    )
    .addCheckConstraint(
      "external_risk_events_json_ck",
      sql`jsonb_typeof(external_risk_event_ref) = 'object'
        AND jsonb_typeof(external_source_ref) = 'object'
        AND jsonb_typeof(event_artifact_ref) = 'object'
        AND jsonb_typeof(evidence_references) = 'array'
        AND jsonb_array_length(evidence_references) > 0
        AND jsonb_typeof(source_version_refs) = 'array'
        AND jsonb_array_length(source_version_refs) > 0
        AND jsonb_typeof(spatial_scope_refs) = 'array'
        AND jsonb_array_length(spatial_scope_refs) > 0
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.external_risk_events
      ADD CONSTRAINT external_risk_events_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex(indexName)
    .ifNotExists()
    .on(table)
    .columns(["project_id", "occurred_at"])
    .execute();

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  await db.schema.dropIndex(indexName).ifExists().execute();
  await db.schema.dropTable(table).ifExists().execute();
}
