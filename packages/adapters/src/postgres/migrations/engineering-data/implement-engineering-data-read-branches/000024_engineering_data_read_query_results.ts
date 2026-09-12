import { sql, type Kysely } from "kysely";

const table = "business.engineering_data_read_query_results";

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(table)}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(table)} TO riskflow_app`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS business.engineering_data_read_query_results (
      query_result_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      branch text NOT NULL,
      query_result_ref jsonb NOT NULL,
      query_payload jsonb NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      requested_by text NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      audit_entry_id text NOT NULL,
      CONSTRAINT engineering_data_read_query_results_branch_ck CHECK (branch IN ('source-segments', 'evidence-access')),
      CONSTRAINT engineering_data_read_query_results_identity_ck CHECK (query_result_id <> '' AND version_id <> '' AND project_id <> '' AND requested_by <> ''),
      CONSTRAINT engineering_data_read_query_results_ref_unique UNIQUE (project_id, query_result_ref),
      CONSTRAINT engineering_data_read_query_results_json_ck CHECK (jsonb_typeof(query_result_ref) = 'object' AND jsonb_typeof(query_payload) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT engineering_data_read_query_results_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("business.engineering_data_read_query_results").ifExists().execute();
}
