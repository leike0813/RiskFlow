import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("business.agent_tasks")
    .addColumn("current_proposal_artifact_ref", jsonb)
    .execute();
  await db.schema
    .alterTable("business.agent_command_confirmations")
    .addColumn("command_result_ref", jsonb)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("business.agent_command_confirmations")
    .dropColumn("command_result_ref")
    .execute();
  await db.schema
    .alterTable("business.agent_tasks")
    .dropColumn("current_proposal_artifact_ref")
    .execute();
}
