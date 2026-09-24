import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

/** C41 自有事实：人工决定终局索引与反馈冻结输入；两表只追加，不持有 C28/C30/C25 的第二套正文。 */
const tables = [
  "business.human_response_decisions",
  "business.human_feedback_input_snapshots",
] as const;

const revokeAll = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    DO $$
    DECLARE target text;
    BEGIN
      FOREACH target IN ARRAY ${sql.raw(`ARRAY['${tables.join("','")}']`)} LOOP
        IF to_regclass(target) IS NOT NULL THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer',
            target
          );
        END IF;
      END LOOP;
    END
    $$;
  `.execute(db);
};

/**
 * C41 最小持久化模型（design D3/D4）：人工决定只允许一条终局事实（pending→adopted 或 declined），
 * 反馈冻结输入按命令种类与幂等键唯一。两表同样只保存精确引用与最小判别列，正文列只存 C41 自己的
 * 规范 DTO；命令回执、审计与 Outbox 事件全部复用 C03 既有事实。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.human_response_decisions")
    .ifNotExists()
    .addColumn("decision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("recommendation_id", "text", (column) => column.notNull())
    .addColumn("recommendation_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("decided_by", "text", (column) => column.notNull())
    .addColumn("decided_at", timestamptz, (column) => column.notNull())
    .addColumn("route_decision_id", "text")
    .addColumn("route_decision_version_id", "text")
    .addColumn("forecast_run_id", "text")
    .addColumn("forecast_run_version_id", "text")
    .addColumn("resumed_at", timestamptz)
    .addColumn("decision_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("human_response_decisions_pk", ["decision_id", "version_id"])
    .addUniqueConstraint("human_response_decisions_recommendation_uidx", [
      "project_id",
      "recommendation_id",
      "recommendation_version_id",
    ])
    .addUniqueConstraint("human_response_decisions_route_uidx", [
      "project_id",
      "route_decision_id",
      "route_decision_version_id",
    ])
    .addCheckConstraint(
      "human_response_decisions_identity_ck",
      sql`decision_id <> '' AND version_id <> '' AND project_id <> ''
        AND recommendation_id <> '' AND recommendation_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND state IN ('pending-adoption', 'adopted', 'declined')
        AND reason_code <> '' AND decided_by <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    // 终局互斥：只有 `adopted` 携带真实 C30 运行与 C28 决定引用，`declined` 绝不携带运行绑定。
    .addCheckConstraint(
      "human_response_decisions_settlement_ck",
      sql`(state = 'adopted'
          AND route_decision_id IS NOT NULL AND route_decision_version_id IS NOT NULL
          AND forecast_run_id IS NOT NULL AND forecast_run_version_id IS NOT NULL)
        OR (state <> 'adopted'
          AND route_decision_id IS NULL AND route_decision_version_id IS NULL
          AND forecast_run_id IS NULL AND forecast_run_version_id IS NULL
          AND resumed_at IS NULL)`,
    )
    .addCheckConstraint(
      "human_response_decisions_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "human_response_decisions_json_ck",
      sql`jsonb_typeof(decision_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.human_feedback_input_snapshots")
    .ifNotExists()
    .addColumn("snapshot_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("command_kind", "text", (column) => column.notNull())
    .addColumn("execution_id", "text", (column) => column.notNull())
    .addColumn("execution_version_id", "text", (column) => column.notNull())
    .addColumn("actual_assessment_record_id", "text", (column) => column.notNull())
    .addColumn("actual_assessment_record_version_id", "text", (column) => column.notNull())
    .addColumn("feedback_id", "text", (column) => column.notNull())
    .addColumn("feedback_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("input_digest", "char(64)", (column) => column.notNull())
    .addColumn("snapshot_payload", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("prepared_at", timestamptz, (column) => column.notNull())
    .addColumn("committed_at", timestamptz)
    .addColumn("segment_started_at", timestamptz)
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("human_feedback_input_snapshots_pk", ["snapshot_id", "version_id"])
    .addUniqueConstraint("human_feedback_input_snapshots_command_uidx", [
      "project_id",
      "command_kind",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "human_feedback_input_snapshots_identity_ck",
      sql`snapshot_id <> '' AND version_id <> '' AND project_id <> ''
        AND command_kind = 'warning-response.record-feedback'
        AND execution_id <> '' AND execution_version_id <> ''
        AND actual_assessment_record_id <> '' AND actual_assessment_record_version_id <> ''
        AND feedback_id <> '' AND feedback_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND state IN ('prepared', 'committed')
        AND command_id <> '' AND actor_ref <> ''`,
    )
    // 冻结输入不可原地改正文：`committed` 必须有正式反馈成立时点，分段只能在正式反馈之后启动。
    .addCheckConstraint(
      "human_feedback_input_snapshots_state_ck",
      sql`(state = 'committed' AND committed_at IS NOT NULL)
        OR (state = 'prepared' AND committed_at IS NULL AND segment_started_at IS NULL)`,
    )
    .addCheckConstraint(
      "human_feedback_input_snapshots_digest_ck",
      sql`input_digest ~ ${digestPattern} AND content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "human_feedback_input_snapshots_json_ck",
      sql`jsonb_typeof(snapshot_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  for (const table of tables) {
    const constraint = `${table.split(".")[1]}_audit_fk`;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = '${sql.raw(constraint)}'
            AND conrelid = '${sql.raw(table)}'::regclass
        ) THEN
          ALTER TABLE ${sql.raw(table)}
            ADD CONSTRAINT ${sql.raw(constraint)}
            FOREIGN KEY (audit_entry_id)
            REFERENCES audit.entries(audit_entry_id)
            DEFERRABLE INITIALLY DEFERRED;
        END IF;
      END
      $$;
    `.execute(db);
  }

  await db.schema
    .createIndex("human_response_decisions_recommendation_idx")
    .ifNotExists()
    .on("business.human_response_decisions")
    .columns(["project_id", "recommendation_id", "recommendation_version_id"])
    .execute();
  await db.schema
    .createIndex("human_feedback_input_snapshots_execution_idx")
    .ifNotExists()
    .on("business.human_feedback_input_snapshots")
    .columns(["project_id", "execution_id", "execution_version_id"])
    .execute();

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  await db.schema.dropIndex("human_feedback_input_snapshots_execution_idx").ifExists().execute();
  await db.schema.dropIndex("human_response_decisions_recommendation_idx").ifExists().execute();
  await db.schema.dropTable("business.human_feedback_input_snapshots").ifExists().execute();
  await db.schema.dropTable("business.human_response_decisions").ifExists().execute();
}
