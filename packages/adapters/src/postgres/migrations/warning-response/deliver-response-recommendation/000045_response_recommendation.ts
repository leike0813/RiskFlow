import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;
const positiveVersionPattern = sql`'^[1-9][0-9]*$'`;

const tables = [
  "business.measure_candidate_queries",
  "business.recommendation_candidates",
  "business.recommendation_validations",
  "business.response_recommendations",
] as const;

const auditTables = [
  "business.measure_candidate_queries",
  "business.recommendation_candidates",
  "business.recommendation_validations",
  "business.response_recommendations",
] as const;

// 迁移必须可重复执行：DO 块内不能使用绑定参数，故全部按字面量内联。
const guardAuditForeignKey = async (db: Kysely<unknown>, table: string): Promise<void> => {
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
};

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
 * C27 最小持久化模型（D-09）：冻结措施候选查询、建议候选、三项校验快照与正式建议。
 * 四表全部只追加；命令回执与审计复用 C03 既有事实，不建重复关系表。
 * 跨 change 外键（C26 任务/预警、C07 复核任务）由被引用迁移的孤立 `down()` 按 C25 先例先解除。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.measure_candidate_queries")
    .ifNotExists()
    .addColumn("query_result_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_version_id", "text", (column) => column.notNull())
    .addColumn("risk_input_kind", "text", (column) => column.notNull())
    .addColumn("risk_input_entity_id", "text", (column) => column.notNull())
    .addColumn("risk_input_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("risk_event_category", "text", (column) => column.notNull())
    .addColumn("generation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("generation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("basis_release_set_id", "text", (column) => column.notNull())
    .addColumn("basis_release_set_version_id", "text", (column) => column.notNull())
    .addColumn("measure_library_release_id", "text", (column) => column.notNull())
    .addColumn("measure_library_release_version_id", "text", (column) => column.notNull())
    .addColumn("measure_artifact_id", "text", (column) => column.notNull())
    .addColumn("measure_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("measure_content_digest", "char(64)", (column) => column.notNull())
    .addColumn("input_digest", "char(64)", (column) => column.notNull())
    .addColumn("candidate_count", "integer", (column) => column.notNull())
    .addColumn("candidate_set_artifact_id", "text", (column) => column.notNull())
    .addColumn("candidate_set_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_set_digest", "char(64)", (column) => column.notNull())
    .addColumn("candidate_set_payload", jsonb, (column) => column.notNull())
    .addColumn("warning_links", jsonb, (column) => column.notNull())
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
    .addPrimaryKeyConstraint("measure_candidate_queries_pk", ["query_result_id", "version_id"])
    .addForeignKeyConstraint(
      "measure_candidate_queries_task_fk",
      ["warning_response_task_id"],
      "business.warning_response_tasks",
      ["task_id"],
    )
    .addForeignKeyConstraint(
      "measure_candidate_queries_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "measure_candidate_queries_identity_ck",
      sql`query_result_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND warning_response_task_id <> '' AND warning_response_task_version_id ~ ${positiveVersionPattern}
        AND risk_input_kind IN ('standardized-risk-record', 'external-risk-event')
        AND risk_input_entity_id <> '' AND risk_input_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND risk_event_category <> ''
        AND generation_policy_entity_id <> '' AND generation_policy_version_id <> ''
        AND basis_release_set_id <> '' AND basis_release_set_version_id <> ''
        AND measure_library_release_id <> '' AND measure_library_release_version_id <> ''
        AND measure_artifact_id <> '' AND measure_artifact_version_id <> ''
        AND candidate_set_artifact_id <> '' AND candidate_set_artifact_version_id <> ''
        AND candidate_count >= 1 AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "measure_candidate_queries_digest_ck",
      sql`measure_content_digest ~ ${digestPattern} AND input_digest ~ ${digestPattern}
        AND candidate_set_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "measure_candidate_queries_json_ck",
      sql`jsonb_typeof(candidate_set_payload) = 'object'
        AND jsonb_typeof(warning_links) = 'array'
        AND jsonb_array_length(warning_links) >= 1
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.recommendation_candidates")
    .ifNotExists()
    .addColumn("candidate_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_version_id", "text", (column) => column.notNull())
    .addColumn("query_result_id", "text", (column) => column.notNull())
    .addColumn("query_result_version_id", "text", (column) => column.notNull())
    .addColumn("generation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("generation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("risk_event_category", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("agent_task_type", "text", (column) => column.notNull())
    .addColumn("agent_result_id", "text", (column) => column.notNull())
    .addColumn("agent_result_version_id", "text", (column) => column.notNull())
    .addColumn("parent_run_id", "text", (column) => column.notNull())
    .addColumn("parent_run_version_id", "text", (column) => column.notNull())
    .addColumn("primary_warning_record_id", "text", (column) => column.notNull())
    .addColumn("primary_warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_payload", jsonb, (column) => column.notNull())
    .addColumn("candidate_artifact_id", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_version_id", "text", (column) => column.notNull())
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
    .addPrimaryKeyConstraint("recommendation_candidates_pk", ["candidate_id", "version_id"])
    .addForeignKeyConstraint(
      "recommendation_candidates_task_fk",
      ["warning_response_task_id"],
      "business.warning_response_tasks",
      ["task_id"],
    )
    .addForeignKeyConstraint(
      "recommendation_candidates_query_fk",
      ["query_result_id", "query_result_version_id"],
      "business.measure_candidate_queries",
      ["query_result_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "recommendation_candidates_agent_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
    )
    .addForeignKeyConstraint(
      "recommendation_candidates_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "recommendation_candidates_identity_ck",
      sql`candidate_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND warning_response_task_id <> '' AND warning_response_task_version_id ~ ${positiveVersionPattern}
        AND query_result_id <> '' AND query_result_version_id ~ ${positiveVersionPattern}
        AND generation_policy_entity_id <> '' AND generation_policy_version_id <> ''
        AND risk_event_category <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND agent_task_id <> '' AND agent_task_type = 'response-recommendation'
        AND agent_result_id <> '' AND agent_result_version_id <> ''
        AND parent_run_id <> '' AND parent_run_version_id <> ''
        AND primary_warning_record_id <> '' AND primary_warning_record_version_id <> ''
        AND candidate_artifact_id <> '' AND candidate_artifact_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "recommendation_candidates_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "recommendation_candidates_json_ck",
      sql`jsonb_typeof(candidate_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.recommendation_validations")
    .ifNotExists()
    .addColumn("validation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("candidate_id", "text", (column) => column.notNull())
    .addColumn("candidate_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_content_digest", "char(64)", (column) => column.notNull())
    .addColumn("validation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("validation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("site_context_entity_id", "text", (column) => column.notNull())
    .addColumn("site_context_version_id", "text", (column) => column.notNull())
    .addColumn("trigger_consistency_passed", "boolean", (column) => column.notNull())
    .addColumn("standards_compliance_passed", "boolean", (column) => column.notNull())
    .addColumn("site_feasibility_passed", "boolean", (column) => column.notNull())
    .addColumn("validation_payload", jsonb, (column) => column.notNull())
    .addColumn("evidence_artifact_id", "text", (column) => column.notNull())
    .addColumn("evidence_artifact_version_id", "text", (column) => column.notNull())
    .addColumn("evidence_digest", "char(64)", (column) => column.notNull())
    .addColumn("review_task_id", "text")
    .addColumn("review_task_version_id", "text")
    .addColumn("review_task_status", "text")
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
    .addPrimaryKeyConstraint("recommendation_validations_pk", ["validation_id", "version_id"])
    .addForeignKeyConstraint(
      "recommendation_validations_candidate_fk",
      ["candidate_id", "candidate_version_id"],
      "business.recommendation_candidates",
      ["candidate_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "recommendation_validations_review_fk",
      ["review_task_id"],
      "business.review_tasks",
      ["review_task_id"],
    )
    .addForeignKeyConstraint(
      "recommendation_validations_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "recommendation_validations_identity_ck",
      sql`validation_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND candidate_id <> '' AND candidate_version_id ~ ${positiveVersionPattern}
        AND validation_policy_entity_id <> '' AND validation_policy_version_id <> ''
        AND site_context_entity_id <> '' AND site_context_version_id <> ''
        AND evidence_artifact_id <> '' AND evidence_artifact_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''
        AND (review_task_id IS NULL) = (review_task_version_id IS NULL)
        AND (review_task_id IS NULL) = (review_task_status IS NULL)
        AND (review_task_status IS NULL OR review_task_status IN ('pending', 'decided', 'superseded'))`,
    )
    .addCheckConstraint(
      "recommendation_validations_digest_ck",
      sql`candidate_content_digest ~ ${digestPattern} AND evidence_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "recommendation_validations_json_ck",
      sql`jsonb_typeof(validation_payload) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await db.schema
    .createTable("business.response_recommendations")
    .ifNotExists()
    .addColumn("recommendation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("candidate_id", "text", (column) => column.notNull())
    .addColumn("candidate_version_id", "text", (column) => column.notNull())
    .addColumn("validation_id", "text", (column) => column.notNull())
    .addColumn("validation_version_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_id", "text", (column) => column.notNull())
    .addColumn("warning_response_task_version_id", "text", (column) => column.notNull())
    .addColumn("warning_record_id", "text", (column) => column.notNull())
    .addColumn("warning_record_version_id", "text", (column) => column.notNull())
    .addColumn("assessment_record_id", "text", (column) => column.notNull())
    .addColumn("assessment_record_version_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_entity_id", "text", (column) => column.notNull())
    .addColumn("spatial_scope_version_id", "text", (column) => column.notNull())
    .addColumn("measure_library_release_id", "text", (column) => column.notNull())
    .addColumn("measure_library_release_version_id", "text", (column) => column.notNull())
    .addColumn("generation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("generation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("validation_policy_entity_id", "text", (column) => column.notNull())
    .addColumn("validation_policy_version_id", "text", (column) => column.notNull())
    .addColumn("site_context_entity_id", "text", (column) => column.notNull())
    .addColumn("site_context_version_id", "text", (column) => column.notNull())
    .addColumn("agent_task_id", "text", (column) => column.notNull())
    .addColumn("agent_result_id", "text", (column) => column.notNull())
    .addColumn("agent_result_version_id", "text", (column) => column.notNull())
    .addColumn("review_status", "text", (column) => column.notNull())
    .addColumn("record_payload", jsonb, (column) => column.notNull())
    .addColumn("warning_links", jsonb, (column) => column.notNull())
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
    .addPrimaryKeyConstraint("response_recommendations_pk", ["recommendation_id", "version_id"])
    .addUniqueConstraint("response_recommendations_binding_uidx", [
      "project_id",
      "candidate_id",
      "candidate_version_id",
      "validation_policy_entity_id",
      "validation_policy_version_id",
      "site_context_entity_id",
      "site_context_version_id",
    ])
    .addForeignKeyConstraint(
      "response_recommendations_candidate_fk",
      ["candidate_id", "candidate_version_id"],
      "business.recommendation_candidates",
      ["candidate_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_recommendations_validation_fk",
      ["validation_id", "validation_version_id"],
      "business.recommendation_validations",
      ["validation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_recommendations_task_fk",
      ["warning_response_task_id"],
      "business.warning_response_tasks",
      ["task_id"],
    )
    .addForeignKeyConstraint(
      "response_recommendations_warning_fk",
      ["warning_record_id", "warning_record_version_id"],
      "business.warning_records",
      ["warning_record_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "response_recommendations_agent_task_fk",
      ["agent_task_id"],
      "business.agent_tasks",
      ["agent_task_id"],
    )
    .addForeignKeyConstraint(
      "response_recommendations_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "response_recommendations_identity_ck",
      sql`recommendation_id <> '' AND version_id ~ ${positiveVersionPattern} AND project_id <> ''
        AND candidate_id <> '' AND candidate_version_id ~ ${positiveVersionPattern}
        AND validation_id <> '' AND validation_version_id ~ ${positiveVersionPattern}
        AND warning_response_task_id <> '' AND warning_response_task_version_id ~ ${positiveVersionPattern}
        AND warning_record_id <> '' AND warning_record_version_id <> ''
        AND assessment_record_id <> '' AND assessment_record_version_id <> ''
        AND spatial_scope_entity_id <> '' AND spatial_scope_version_id <> ''
        AND measure_library_release_id <> '' AND measure_library_release_version_id <> ''
        AND generation_policy_entity_id <> '' AND generation_policy_version_id <> ''
        AND validation_policy_entity_id <> '' AND validation_policy_version_id <> ''
        AND site_context_entity_id <> '' AND site_context_version_id <> ''
        AND agent_task_id <> '' AND agent_result_id <> '' AND agent_result_version_id <> ''
        AND review_status = 'pending' AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "response_recommendations_digest_ck",
      sql`content_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "response_recommendations_json_ck",
      sql`jsonb_typeof(record_payload) = 'object'
        AND jsonb_typeof(warning_links) = 'array'
        AND jsonb_array_length(warning_links) >= 1
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  for (const table of auditTables) await guardAuditForeignKey(db, table);

  await db.schema
    .createIndex("measure_candidate_queries_input_uidx")
    .ifNotExists()
    .unique()
    .on("business.measure_candidate_queries")
    .columns([
      "project_id",
      "warning_response_task_id",
      "warning_response_task_version_id",
      "measure_library_release_id",
      "measure_library_release_version_id",
      "input_digest",
    ])
    .execute();
  await db.schema
    .createIndex("recommendation_candidates_task_idx")
    .ifNotExists()
    .on("business.recommendation_candidates")
    .columns(["project_id", "warning_response_task_id", "warning_response_task_version_id"])
    .execute();
  await db.schema
    .createIndex("recommendation_candidates_content_uidx")
    .ifNotExists()
    .unique()
    .on("business.recommendation_candidates")
    .columns([
      "project_id",
      "warning_response_task_id",
      "warning_response_task_version_id",
      "content_digest",
    ])
    .execute();
  await db.schema
    .createIndex("recommendation_validations_binding_uidx")
    .ifNotExists()
    .unique()
    .on("business.recommendation_validations")
    .columns([
      "project_id",
      "candidate_id",
      "candidate_version_id",
      "validation_policy_entity_id",
      "validation_policy_version_id",
      "site_context_entity_id",
      "site_context_version_id",
    ])
    .execute();
  await db.schema
    .createIndex("response_recommendations_warning_idx")
    .ifNotExists()
    .on("business.response_recommendations")
    .columns(["project_id", "warning_record_id", "warning_record_version_id"])
    .execute();

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 后续 change（C28）的采纳决定、预测结果、执行记录与偏差事实表建了指向本迁移
  // business.response_recommendations 的外键；孤立回滚本迁移 MUST 先解除这些依赖，
  // 否则 PostgreSQL 以 "other objects depend on it" 拒绝删表。依赖表可能尚未建立，
  // 因此按表存在性守卫。
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_adoption_decisions') THEN
        ALTER TABLE business.response_adoption_decisions
          DROP CONSTRAINT IF EXISTS response_adoption_decisions_recommendation_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_forecast_outcomes') THEN
        ALTER TABLE business.response_forecast_outcomes
          DROP CONSTRAINT IF EXISTS response_forecast_outcomes_recommendation_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_execution_records') THEN
        ALTER TABLE business.response_execution_records
          DROP CONSTRAINT IF EXISTS response_execution_records_recommendation_fk;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'business' AND table_name = 'response_deviation_facts') THEN
        ALTER TABLE business.response_deviation_facts
          DROP CONSTRAINT IF EXISTS response_deviation_facts_recommendation_fk;
      END IF;
    END
    $$;
  `.execute(db);
  await revokeAll(db);
  await db.schema.dropIndex("response_recommendations_warning_idx").ifExists().execute();
  await db.schema.dropIndex("recommendation_validations_binding_uidx").ifExists().execute();
  await db.schema.dropIndex("recommendation_candidates_content_uidx").ifExists().execute();
  await db.schema.dropIndex("recommendation_candidates_task_idx").ifExists().execute();
  await db.schema.dropIndex("measure_candidate_queries_input_uidx").ifExists().execute();
  await db.schema.dropTable("business.response_recommendations").ifExists().execute();
  await db.schema.dropTable("business.recommendation_validations").ifExists().execute();
  await db.schema.dropTable("business.recommendation_candidates").ifExists().execute();
  await db.schema.dropTable("business.measure_candidate_queries").ifExists().execute();
}
