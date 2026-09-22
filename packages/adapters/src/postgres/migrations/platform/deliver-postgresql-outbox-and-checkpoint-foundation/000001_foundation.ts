import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.command_receipts")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_kind", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull().unique())
    .addColumn("payload_sha256", "char(64)", (column) => column.notNull())
    .addColumn("result_ref", jsonb)
    .addColumn("audit_entry_id", "text")
    .addColumn("event_ids", sql`text[]`, (column) =>
      column.notNull().defaultTo(sql`ARRAY[]::text[]`),
    )
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("run_id", "text")
    .addColumn("thread_id", "text")
    .addColumn("completed_at", timestamptz)
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("command_receipts_pk", [
      "project_id",
      "command_kind",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "command_receipts_completion_ck",
      sql`(completed_at IS NULL AND result_ref IS NULL AND audit_entry_id IS NULL)
        OR (completed_at IS NOT NULL AND result_ref IS NOT NULL AND audit_entry_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .createTable("audit.entries")
    .ifNotExists()
    .addColumn("audit_entry_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("target_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("version_ref", jsonb, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("run_id", "text")
    .addColumn("thread_id", "text")
    .addColumn("reason_ref", jsonb)
    .execute();

  await db.schema
    .createTable("outbox.events")
    .ifNotExists()
    .addColumn("event_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("event_type", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("event_version", "integer", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("aggregate_ref", jsonb, (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("causation_id", "text", (column) => column.notNull())
    .addColumn("correlation_id", "text", (column) => column.notNull())
    .addColumn("producer_command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_trail_ref", jsonb, (column) => column.notNull())
    .addColumn("event_json", jsonb, (column) => column.notNull())
    .addColumn("payload_sha256", "char(64)", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("pending"))
    .addColumn("lease_owner", "text")
    .addColumn("lease_token", "text")
    .addColumn("lease_until", timestamptz)
    .addColumn("attempt_count", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("delivery_policy_ref", jsonb)
    .addColumn("delivery_policy_snapshot", jsonb)
    .addColumn("delivery_policy_sha256", "char(64)")
    .addColumn("next_attempt_at", timestamptz, (column) => column.defaultTo(sql`clock_timestamp()`))
    .addColumn("published_at", timestamptz)
    .addColumn("last_error_code", "text")
    .addColumn("last_diagnostic_ref", jsonb)
    .addColumn("updated_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addCheckConstraint(
      "events_status_ck",
      sql`status IN ('pending', 'leased', 'published', 'exhausted')`,
    )
    .addCheckConstraint(
      "events_lease_ck",
      sql`(status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
        OR (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)`,
    )
    .addCheckConstraint(
      "events_published_ck",
      sql`(status = 'published' AND published_at IS NOT NULL) OR (status <> 'published' AND published_at IS NULL)`,
    )
    .addCheckConstraint("events_attempt_ck", sql`attempt_count >= 0`)
    .addCheckConstraint(
      "events_delivery_policy_ck",
      sql`(delivery_policy_ref IS NULL AND delivery_policy_snapshot IS NULL AND delivery_policy_sha256 IS NULL)
        OR (delivery_policy_ref IS NOT NULL AND delivery_policy_snapshot IS NOT NULL AND delivery_policy_sha256 IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .createIndex("outbox_events_dispatch_idx")
    .ifNotExists()
    .on("outbox.events")
    .columns(["status", "next_attempt_at", "persisted_at"])
    .execute();

  await db.schema
    .createTable("outbox.consumer_receipts")
    .ifNotExists()
    .addColumn("consumer_name", "text", (column) => column.notNull())
    .addColumn("event_id", "text", (column) => column.notNull())
    .addColumn("event_sha256", "char(64)", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("pending"))
    .addColumn("result_ref", jsonb)
    .addColumn("attempt_count", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("next_retry_at", timestamptz)
    .addColumn("last_error_code", "text")
    .addColumn("last_diagnostic_ref", jsonb)
    .addColumn("first_attempt_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("last_attempt_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("completed_at", timestamptz)
    .addColumn("updated_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("consumer_receipts_pk", ["consumer_name", "event_id"])
    .addCheckConstraint("consumer_receipts_status_ck", sql`status IN ('pending', 'completed')`)
    .addCheckConstraint(
      "consumer_receipts_completion_ck",
      sql`(status = 'completed' AND result_ref IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'pending' AND result_ref IS NULL AND completed_at IS NULL)`,
    )
    .addCheckConstraint("consumer_receipts_attempt_ck", sql`attempt_count >= 0`)
    .execute();

  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.command_receipts TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE audit.entries TO riskflow_app`.execute(db);
  await sql`GRANT INSERT ON TABLE outbox.events TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, UPDATE ON TABLE outbox.events TO riskflow_outbox_worker`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE outbox.consumer_receipts TO riskflow_outbox_worker`.execute(
    db,
  );
  await sql`REVOKE INSERT ON TABLE outbox.events FROM riskflow_outbox_worker`.execute(db);
  await sql`REVOKE DELETE ON TABLE business.command_receipts FROM riskflow_app`.execute(db);
  await sql`REVOKE UPDATE, DELETE ON TABLE audit.entries FROM riskflow_app, riskflow_outbox_worker`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 后续 change 建了指向 present 表的外键：C27 的四张表指向 business.command_receipts 与
  // audit.entries，C21 的 identification_context_results 指向 audit.entries，C28 的五张表
  // （采纳决定/预测结果/执行/反馈/偏差事实）指向 audit.entries。孤立回滚本迁移
  // MUST 先解除这类依赖，否则 PostgreSQL 以 "other objects depend on it" 拒绝删表。
  // 依赖表可能尚未建立，因此按表存在性守卫。
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'measure_candidate_queries') THEN
        ALTER TABLE business.measure_candidate_queries
          DROP CONSTRAINT IF EXISTS measure_candidate_queries_command_fk,
          DROP CONSTRAINT IF EXISTS measure_candidate_queries_audit_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'recommendation_candidates') THEN
        ALTER TABLE business.recommendation_candidates
          DROP CONSTRAINT IF EXISTS recommendation_candidates_command_fk,
          DROP CONSTRAINT IF EXISTS recommendation_candidates_audit_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'recommendation_validations') THEN
        ALTER TABLE business.recommendation_validations
          DROP CONSTRAINT IF EXISTS recommendation_validations_command_fk,
          DROP CONSTRAINT IF EXISTS recommendation_validations_audit_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_recommendations') THEN
        ALTER TABLE business.response_recommendations
          DROP CONSTRAINT IF EXISTS response_recommendations_command_fk,
          DROP CONSTRAINT IF EXISTS response_recommendations_audit_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'identification_context_results') THEN
        ALTER TABLE business.identification_context_results
          DROP CONSTRAINT IF EXISTS identification_context_results_audit_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_adoption_decisions') THEN
        ALTER TABLE business.response_adoption_decisions
          DROP CONSTRAINT IF EXISTS response_adoption_decisions_audit_fk,
          DROP CONSTRAINT IF EXISTS response_adoption_decisions_command_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_forecast_outcomes') THEN
        ALTER TABLE business.response_forecast_outcomes
          DROP CONSTRAINT IF EXISTS response_forecast_outcomes_audit_fk,
          DROP CONSTRAINT IF EXISTS response_forecast_outcomes_command_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_execution_records') THEN
        ALTER TABLE business.response_execution_records
          DROP CONSTRAINT IF EXISTS response_execution_records_audit_fk,
          DROP CONSTRAINT IF EXISTS response_execution_records_command_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_feedback_records') THEN
        ALTER TABLE business.response_feedback_records
          DROP CONSTRAINT IF EXISTS response_feedback_records_audit_fk,
          DROP CONSTRAINT IF EXISTS response_feedback_records_command_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_deviation_facts') THEN
        ALTER TABLE business.response_deviation_facts
          DROP CONSTRAINT IF EXISTS response_deviation_facts_audit_fk,
          DROP CONSTRAINT IF EXISTS response_deviation_facts_command_fk;
      END IF;
    END
    $$;
  `.execute(db);
  await db.schema.dropTable("outbox.consumer_receipts").ifExists().execute();
  await db.schema.dropIndex("outbox_events_dispatch_idx").ifExists().execute();
  await db.schema.dropTable("outbox.events").ifExists().execute();
  await db.schema.dropTable("audit.entries").ifExists().execute();
  await db.schema.dropTable("business.command_receipts").ifExists().execute();
}
