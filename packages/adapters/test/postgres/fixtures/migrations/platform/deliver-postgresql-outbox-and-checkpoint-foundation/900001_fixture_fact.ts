import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.fixture_facts")
    .ifNotExists()
    .addColumn("fact_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("value", "integer", (column) => column.notNull())
    .addColumn("occurred_at", sql`timestamp with time zone`, (column) => column.notNull())
    .addColumn("persisted_at", sql`timestamp with time zone`, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .execute();
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE business.fixture_facts TO riskflow_app, riskflow_outbox_worker`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("business.fixture_facts").ifExists().execute();
}
