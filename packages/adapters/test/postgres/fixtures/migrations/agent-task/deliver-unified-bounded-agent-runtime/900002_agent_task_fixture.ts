import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS business.agent_task_fixture (
    fixture_id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`.execute(db);
  await sql`GRANT SELECT ON TABLE business.agent_task_fixture TO riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS business.agent_task_fixture`.execute(db);
}
