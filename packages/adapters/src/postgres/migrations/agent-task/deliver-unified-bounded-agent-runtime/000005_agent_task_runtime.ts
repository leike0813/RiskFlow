import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.agent_tasks")
    .ifNotExists()
    .addColumn("agent_task_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("task_type", "text", (column) => column.notNull())
    .addColumn("trigger_mode", "text", (column) => column.notNull())
    .addColumn("agent_task_ref", jsonb, (column) => column.notNull())
    .addColumn("envelope", jsonb, (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("pending"))
    .addColumn("task_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("cancel_requested", "boolean", (column) => column.notNull().defaultTo(false))
    .addColumn("cancel_reason_code", "text")
    .addColumn("result_ref", jsonb)
    .addColumn("error", jsonb)
    .addColumn("current_proposal_ref", jsonb)
    .addColumn("latest_candidate_version", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("budget_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("budget_policy", jsonb, (column) => column.notNull())
    .addColumn("budget_ledger", jsonb, (column) => column.notNull())
    .addColumn("parent_run_ref", jsonb, (column) => column.notNull())
    .addColumn("frozen_input_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("frozen_authorization", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("updated_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addCheckConstraint(
      "agent_tasks_status_ck",
      sql`status IN ('pending', 'running', 'waiting-user-confirmation', 'retryable-failure', 'completed', 'terminal-failure', 'cancelled')`,
    )
    .addCheckConstraint("agent_tasks_task_version_ck", sql`task_version > 0`)
    .addCheckConstraint("agent_tasks_candidate_version_ck", sql`latest_candidate_version >= 0`)
    .addCheckConstraint(
      "agent_tasks_state_ck",
      sql`(status = 'completed' AND result_ref IS NOT NULL AND error IS NULL)
        OR (status = 'terminal-failure' AND result_ref IS NULL AND error IS NOT NULL)
        OR (status = 'cancelled' AND cancel_requested = true)
        OR (status NOT IN ('completed', 'terminal-failure', 'cancelled'))`,
    )
    .addCheckConstraint(
      "agent_tasks_json_ck",
      sql`jsonb_typeof(agent_task_ref) = 'object'
        AND jsonb_typeof(envelope) = 'object'
        AND jsonb_typeof(budget_policy_ref) = 'object'
        AND jsonb_typeof(budget_policy) = 'object'
        AND jsonb_typeof(budget_ledger) = 'object'
        AND jsonb_typeof(parent_run_ref) = 'object'
        AND jsonb_typeof(frozen_input_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(frozen_authorization) = 'object'`,
    )
    .addCheckConstraint(
      "agent_tasks_identity_ck",
      sql`version_id <> '' AND project_id <> '' AND task_type <> '' AND trigger_mode <> ''
        AND command_id <> '' AND idempotency_key <> ''`,
    )
    .execute();

  await db.schema
    .createTable("business.agent_task_attempts")
    .ifNotExists()
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("attempt_number", "integer", (column) => column.notNull())
    .addColumn("worker_id", "text", (column) => column.notNull())
    .addColumn("lease_token", "text", (column) => column.notNull())
    .addColumn("lease_until", timestamptz, (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("started_at", timestamptz, (column) => column.notNull())
    .addColumn("heartbeat_at", timestamptz, (column) => column.notNull())
    .addColumn("finished_at", timestamptz)
    .addColumn("failure", jsonb)
    .addPrimaryKeyConstraint("agent_task_attempts_pk", ["agent_task_id", "attempt_number"])
    .addForeignKeyConstraint(
      "agent_task_attempts_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("agent_task_attempts_number_ck", sql`attempt_number > 0`)
    .addCheckConstraint(
      "agent_task_attempts_status_ck",
      sql`status IN ('active', 'released', 'expired', 'completed', 'cancelled')`,
    )
    .addCheckConstraint(
      "agent_task_attempts_lease_ck",
      sql`worker_id <> '' AND lease_token <> '' AND lease_until >= started_at`,
    )
    .execute();

  await db.schema
    .createTable("business.agent_task_actions")
    .ifNotExists()
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("action_id", "text", (column) => column.notNull())
    .addColumn("attempt_number", "integer", (column) => column.notNull())
    .addColumn("sequence", "integer", (column) => column.notNull())
    .addColumn("action_type", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("reserved"))
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("intent_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("result_ref", jsonb)
    .addColumn("result_artifact_ref", jsonb)
    .addColumn("reservation", jsonb, (column) => column.notNull())
    .addColumn("usage", jsonb, (column) => column.notNull())
    .addColumn("error_code", "text")
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("completed_at", timestamptz)
    .addPrimaryKeyConstraint("agent_task_actions_pk", ["agent_task_id", "action_id"])
    .addUniqueConstraint("agent_task_actions_sequence_uidx", ["agent_task_id", "sequence"])
    .addForeignKeyConstraint(
      "agent_task_actions_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("agent_task_actions_attempt_ck", sql`attempt_number > 0 AND sequence >= 0`)
    .addCheckConstraint(
      "agent_task_actions_type_ck",
      sql`action_type IN ('model-invocation', 'domain-tool', 'deterministic-validation', 'command-proposal', 'command-confirmation')`,
    )
    .addCheckConstraint(
      "agent_task_actions_status_ck",
      sql`status IN ('reserved', 'started', 'completed', 'failed', 'uncertain')`,
    )
    .addCheckConstraint(
      "agent_task_actions_json_ck",
      sql`jsonb_typeof(intent_artifact_ref) = 'object'
        AND jsonb_typeof(reservation) = 'object'
        AND jsonb_typeof(usage) = 'object'
        AND (result_ref IS NULL OR jsonb_typeof(result_ref) = 'object')
        AND (result_artifact_ref IS NULL OR jsonb_typeof(result_artifact_ref) = 'object')`,
    )
    .execute();

  await db.schema
    .createTable("business.agent_task_candidates")
    .ifNotExists()
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("candidate_version", "integer", (column) => column.notNull())
    .addColumn("parent_candidate_version", "integer")
    .addColumn("candidate_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("increment_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("validation", jsonb)
    .addColumn("result_ref", jsonb)
    .addColumn("disposition", "text", (column) => column.notNull().defaultTo("pending"))
    .addColumn("rejection_class", "text")
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("agent_task_candidates_pk", ["agent_task_id", "candidate_version"])
    .addForeignKeyConstraint(
      "agent_task_candidates_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("agent_task_candidates_version_ck", sql`candidate_version > 0`)
    .addCheckConstraint(
      "agent_task_candidates_disposition_ck",
      sql`disposition IN ('pending', 'accepted', 'rejected', 'completed')`,
    )
    .addCheckConstraint(
      "agent_task_candidates_json_ck",
      sql`jsonb_typeof(candidate_artifact_ref) = 'object'
        AND jsonb_typeof(increment_artifact_ref) = 'object'
        AND (validation IS NULL OR jsonb_typeof(validation) = 'object')
        AND (result_ref IS NULL OR jsonb_typeof(result_ref) = 'object')`,
    )
    .execute();

  await db.schema
    .createTable("business.agent_command_confirmations")
    .ifNotExists()
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("proposal_entity_id", "text", (column) => column.notNull())
    .addColumn("proposal_version_id", "text", (column) => column.notNull())
    .addColumn("proposal_ref", jsonb, (column) => column.notNull())
    .addColumn("decision", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("target_version_ref", jsonb, (column) => column.notNull())
    .addColumn("command_idempotency_key", "text", (column) => column.notNull())
    .addColumn("decided_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("agent_command_confirmations_pk", [
      "agent_task_id",
      "proposal_entity_id",
      "proposal_version_id",
    ])
    .addForeignKeyConstraint(
      "agent_command_confirmations_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "agent_command_confirmations_decision_ck",
      sql`decision IN ('confirmed', 'rejected')`,
    )
    .addCheckConstraint(
      "agent_command_confirmations_json_ck",
      sql`jsonb_typeof(proposal_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(target_version_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createIndex("agent_tasks_project_status_idx")
    .ifNotExists()
    .on("business.agent_tasks")
    .columns(["project_id", "status", "updated_at"])
    .execute();
  await db.schema
    .createIndex("agent_task_attempts_lease_idx")
    .ifNotExists()
    .on("business.agent_task_attempts")
    .columns(["agent_task_id", "lease_until", "status"])
    .execute();
  await db.schema
    .createIndex("agent_task_actions_task_sequence_idx")
    .ifNotExists()
    .on("business.agent_task_actions")
    .columns(["agent_task_id", "sequence"])
    .execute();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_task_attempts_active_uidx
    ON business.agent_task_attempts (agent_task_id)
    WHERE status = 'active'`.execute(db);

  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.agent_tasks,
    business.agent_task_attempts,
    business.agent_task_actions,
    business.agent_task_candidates,
    business.agent_command_confirmations
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.agent_tasks TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, UPDATE ON TABLE business.agent_tasks TO riskflow_outbox_worker`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.agent_task_attempts TO riskflow_app, riskflow_outbox_worker`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.agent_task_actions TO riskflow_app, riskflow_outbox_worker`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.agent_task_candidates TO riskflow_app, riskflow_outbox_worker`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.agent_command_confirmations TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE DELETE ON TABLE
    business.agent_tasks,
    business.agent_task_attempts,
    business.agent_task_actions,
    business.agent_task_candidates,
    business.agent_command_confirmations
    FROM riskflow_app, riskflow_outbox_worker`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.agent_tasks,
    business.agent_task_attempts,
    business.agent_task_actions,
    business.agent_task_candidates,
    business.agent_command_confirmations
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_task_attempts_active_uidx`.execute(db);
  await db.schema.dropIndex("agent_task_actions_task_sequence_idx").ifExists().execute();
  await db.schema.dropIndex("agent_task_attempts_lease_idx").ifExists().execute();
  await db.schema.dropIndex("agent_tasks_project_status_idx").ifExists().execute();
  await db.schema.dropTable("business.agent_command_confirmations").ifExists().execute();
  await db.schema.dropTable("business.agent_task_candidates").ifExists().execute();
  await db.schema.dropTable("business.agent_task_actions").ifExists().execute();
  await db.schema.dropTable("business.agent_task_attempts").ifExists().execute();
  await db.schema.dropTable("business.agent_tasks").ifExists().execute();
}
