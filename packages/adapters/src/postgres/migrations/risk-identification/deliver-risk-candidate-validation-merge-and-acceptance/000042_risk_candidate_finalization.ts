import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const resultsTable = "business.identification_finalization_results";
const resultsReadIndex = "identification_finalization_results_read_idx";
const recordsTable = "business.standardized_risk_records";

/** D-09 一张追加登记表承载的八类中间结果，与核心判别联合一一对应。 */
const resultKinds = [
  "candidate-set",
  "validated-candidate-set",
  "identification-group",
  "merge-plan",
  "validation-snapshot",
  "evidence-snapshot",
  "route-decision",
  "acceptance-route-set",
] as const;

const objectColumn = (column: string) => sql`jsonb_typeof(${sql.raw(column)}) = 'object'`;
const nullableObjectColumn = (column: string) =>
  sql`(${sql.raw(column)} IS NULL OR jsonb_typeof(${sql.raw(column)}) = 'object')`;
const arrayColumn = (column: string) => sql`jsonb_typeof(${sql.raw(column)}) = 'array'`;

/** 必填 JSONB 只存结构化引用或正式公共记录；中间正文永不入库。 */
const resultObjectColumns = ["artifact_ref", "input_snapshot_ref", "authorization_context_ref"].map(
  objectColumn,
);

const resultNullableObjectColumns = [
  "work_item_ref",
  "model_context_artifact_set_ref",
  "candidate_set_ref",
  "validated_candidate_set_ref",
  "work_plan_ref",
  "group_ref",
  "merge_plan_ref",
  "validation_snapshot_ref",
  "evidence_snapshot_ref",
  "route_decision_ref",
  "acceptance_route_set_ref",
].map(nullableObjectColumn);

/**
 * 八类登记行的完整引用形状由核心 `RiskCandidateFinalizationResultRowV1Schema` 唯一限定，
 * 这里只允许本类专列非空、它类专列为空，使数据库拒绝任何核心未声明的引用组合。
 */
const resultKindPairings = sql`(
  (result_kind = 'candidate-set'
    AND work_item_ref IS NOT NULL AND model_context_artifact_set_ref IS NOT NULL
    AND candidate_set_ref IS NOT NULL
    AND validated_candidate_set_ref IS NULL AND work_plan_ref IS NULL AND group_ref IS NULL
    AND merge_plan_ref IS NULL AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'validated-candidate-set'
    AND work_item_ref IS NOT NULL AND candidate_set_ref IS NOT NULL
    AND validated_candidate_set_ref IS NOT NULL
    AND model_context_artifact_set_ref IS NULL AND work_plan_ref IS NULL AND group_ref IS NULL
    AND merge_plan_ref IS NULL AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'identification-group'
    AND work_plan_ref IS NOT NULL AND group_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL
    AND merge_plan_ref IS NULL AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'merge-plan'
    AND work_plan_ref IS NOT NULL AND merge_plan_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL AND group_ref IS NULL
    AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'validation-snapshot'
    AND work_plan_ref IS NOT NULL AND group_ref IS NOT NULL AND validation_snapshot_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL
    AND merge_plan_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'evidence-snapshot'
    AND work_plan_ref IS NOT NULL AND group_ref IS NOT NULL AND evidence_snapshot_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL
    AND merge_plan_ref IS NULL AND validation_snapshot_ref IS NULL
    AND route_decision_ref IS NULL AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'route-decision'
    AND work_plan_ref IS NOT NULL AND group_ref IS NOT NULL AND route_decision_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL
    AND merge_plan_ref IS NULL AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND acceptance_route_set_ref IS NULL)
  OR (result_kind = 'acceptance-route-set'
    AND work_plan_ref IS NOT NULL AND merge_plan_ref IS NOT NULL
    AND acceptance_route_set_ref IS NOT NULL
    AND work_item_ref IS NULL AND model_context_artifact_set_ref IS NULL
    AND candidate_set_ref IS NULL AND validated_candidate_set_ref IS NULL AND group_ref IS NULL
    AND validation_snapshot_ref IS NULL AND evidence_snapshot_ref IS NULL
    AND route_decision_ref IS NULL)
)`;

const recordObjectColumns = [
  "risk_record_ref",
  "payload",
  "input_snapshot_ref",
  "identification_run_ref",
  "merge_plan_ref",
  "group_ref",
  "authorization_context_ref",
].map(objectColumn);

const recordNullableObjectColumns = ["route_decision_ref", "review_decision_ref"].map(
  nullableObjectColumn,
);

const recordArrayColumns = [
  "representative_candidate_refs",
  "source_segment_ids",
  "mechanism_entry_ids",
].map(arrayColumn);

/**
 * 审计外键必须延迟：C03 事务单元先跑 handler 再由事务写审计行，
 * 同一事务内插入顺序不保证。迁移必须可重复执行，DO 块内不能使用绑定参数，故按字面量内联。
 */
const guardAuditForeignKey = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  const constraint = `${tableName.split(".")[1]}_audit_fk`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(constraint)}'
          AND conrelid = '${sql.raw(tableName)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(tableName)}
          ADD CONSTRAINT ${sql.raw(constraint)}
          FOREIGN KEY (audit_entry_id)
          REFERENCES audit.entries(audit_entry_id)
          DEFERRABLE INITIALLY DEFERRED;
      END IF;
    END
    $$;
  `.execute(db);
};

const revokeAll = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tableName)}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
};

/** 两表都只追加：应用与 Outbox 消费事务只得到 SELECT/INSERT，明确无 UPDATE/DELETE。 */
const grantAppendOnly = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  await revokeAll(db, tableName);
  for (const role of ["riskflow_app", "riskflow_outbox_worker"]) {
    await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tableName)} TO ${sql.raw(role)}`.execute(db);
    await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tableName)} FROM ${sql.raw(role)}`.execute(
      db,
    );
  }
};

/**
 * C22 追加式中间登记与不可变正式记录（design D-09）：
 * `identification_finalization_results` 只保存八类中间结果的精确 C04 引用与确定性结论，
 * 主键为 `(project_id, result_kind, result_id, result_version_id)`，正文永不入库；
 * `standardized_risk_records` 以 `(project_id, risk_record_id)` 唯一保证一条风险记录只成立一次，
 * 载荷为 C01 共享信封且在写入/读取两侧都重新解析。两表都只 INSERT/SELECT。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(resultsTable)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("result_kind", "text", (column) => column.notNull())
    .addColumn("result_id", "text", (column) => column.notNull())
    .addColumn("result_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("work_item_ref", jsonb)
    .addColumn("model_context_artifact_set_ref", jsonb)
    .addColumn("candidate_set_ref", jsonb)
    .addColumn("validated_candidate_set_ref", jsonb)
    .addColumn("work_plan_ref", jsonb)
    .addColumn("group_ref", jsonb)
    .addColumn("merge_plan_ref", jsonb)
    .addColumn("validation_snapshot_ref", jsonb)
    .addColumn("evidence_snapshot_ref", jsonb)
    .addColumn("route_decision_ref", jsonb)
    .addColumn("acceptance_route_set_ref", jsonb)
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("identification_finalization_results_pk", [
      "project_id",
      "result_kind",
      "result_id",
      "result_version_id",
    ])
    .addCheckConstraint(
      "identification_finalization_results_identity_ck",
      sql`project_id <> '' AND result_kind <> '' AND result_id <> '' AND result_version_id <> ''
        AND command_id <> '' AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "identification_finalization_results_kind_ck",
      sql`result_kind IN (${sql.join(
        resultKinds.map((kind) => sql.lit(kind)),
        sql`, `,
      )}) AND ${resultKindPairings}`,
    )
    .addCheckConstraint(
      "identification_finalization_results_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "identification_finalization_results_json_ck",
      sql.join([...resultObjectColumns, ...resultNullableObjectColumns], sql` AND `),
    )
    .execute();

  // 回读按 `(project_id, result_kind, result_id)` 定位后再按完整版本过滤，保持读取路径独立于主键宽度。
  await db.schema
    .createIndex(resultsReadIndex)
    .ifNotExists()
    .on(resultsTable)
    .columns(["project_id", "result_kind", "result_id"])
    .execute();

  await guardAuditForeignKey(db, resultsTable);

  await db.schema
    .createTable(recordsTable)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("risk_record_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("risk_record_ref", jsonb, (column) => column.notNull())
    .addColumn("row_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("payload", jsonb, (column) => column.notNull())
    .addColumn("input_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("identification_run_ref", jsonb, (column) => column.notNull())
    .addColumn("merge_plan_ref", jsonb, (column) => column.notNull())
    .addColumn("route_decision_ref", jsonb)
    .addColumn("review_decision_ref", jsonb)
    .addColumn("group_id", "text", (column) => column.notNull())
    .addColumn("group_version_id", "text", (column) => column.notNull())
    .addColumn("group_ref", jsonb, (column) => column.notNull())
    .addColumn("representative_candidate_refs", jsonb, (column) => column.notNull())
    .addColumn("source_segment_ids", jsonb, (column) => column.notNull())
    .addColumn("mechanism_entry_ids", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("standardized_risk_records_pk", ["project_id", "risk_record_id"])
    .addCheckConstraint(
      "standardized_risk_records_identity_ck",
      sql`project_id <> '' AND risk_record_id <> '' AND version_id <> '' AND row_id <> ''
        AND idempotency_key <> '' AND group_id <> '' AND group_version_id <> ''
        AND actor_ref <> '' AND command_id <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "standardized_risk_records_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    // 一条记录只有一种决定来源：自动路线携带系统决定，人工路线携带已成立的人工决定。
    .addCheckConstraint(
      "standardized_risk_records_decision_ck",
      sql`(route_decision_ref IS NULL) <> (review_decision_ref IS NULL)`,
    )
    .addCheckConstraint(
      "standardized_risk_records_json_ck",
      sql.join(
        [...recordObjectColumns, ...recordNullableObjectColumns, ...recordArrayColumns],
        sql` AND `,
      ),
    )
    .execute();

  await guardAuditForeignKey(db, recordsTable);

  await grantAppendOnly(db, resultsTable);
  await grantAppendOnly(db, recordsTable);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db, resultsTable);
  await db.schema.dropIndex(resultsReadIndex).ifExists().execute();
  await db.schema.dropTable(resultsTable).ifExists().execute();
  await revokeAll(db, recordsTable);
  await db.schema.dropTable(recordsTable).ifExists().execute();
}
