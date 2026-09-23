import { sql, type Kysely, type SqlBool } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const resultsTable = "business.workflow_graph_results";
const linksTable = "business.workflow_graph_links";
const queriesTable = "business.workflow_query_results";
const resultsReadIndex = "workflow_graph_results_run_read_idx";
const resultsRunStateIndex = "workflow_graph_results_run_state_uidx";
const linksReadIndex = "workflow_graph_links_run_read_idx";

/** D-05 七类 C30 自有运行事实引用，与核心 `WorkflowGraphResultRowV1Schema` 判别一一对应。 */
const resultKinds = [
  "entry-snapshot",
  "stage-result",
  "route-decision",
  "run-state",
  "waiting",
  "workflow-error",
  "run-result",
] as const;

/** D-05 闭合链边关系码：数据库与公共契约 `WORKFLOW_LINK_RELATIONS_V1` 保持同一取值。 */
const linkRelations = [
  "parent-child",
  "run-stage",
  "segment-process",
  "process-mechanism",
  "mechanism-risk",
  "risk-assessment",
  "assessment-warning",
  "warning-recommendation",
  "recommendation-forecast",
  "forecast-execution",
  "execution-feedback",
  "feedback-deviation",
  "deviation-calibration",
] as const;

const objectColumn = (column: string) => sql`jsonb_typeof(${sql.raw(column)}) = 'object'`;
const nullableObjectColumn = (column: string) =>
  sql`(${sql.raw(column)} IS NULL OR jsonb_typeof(${sql.raw(column)}) = 'object')`;

const referenceColumns = [
  "entry_identity",
  "input_snapshot_ref",
  "stage_result_ref",
  "route_decision_ref",
  "waiting_ref",
  "workflow_error_ref",
  "run_result_ref",
] as const;

const objectColumns = ["artifact_ref", "authorization_context_ref"].map(objectColumn);
const nullableObjectColumns = referenceColumns.map(nullableObjectColumn);
const frozenRefsColumn = sql`jsonb_typeof(frozen_refs) = 'array'`;

/**
 * 每类登记行的引用形状由核心判别联合唯一限定：本类专列非空、它类专列为空，
 * 数据库因此拒绝任何核心未声明的引用组合（design D-05）。
 */
const kindPairing = (kind: string, required: readonly string[]) =>
  sql`(result_kind = ${sql.lit(kind)} AND ${sql.join(
    [
      ...required.map((column) => sql`${sql.raw(column)} IS NOT NULL`),
      ...referenceColumns
        .filter((column) => !required.includes(column))
        .map((column) => sql`${sql.raw(column)} IS NULL`),
      ...["route_kind", "stage"]
        .filter((column) => !required.includes(column))
        .map((column) => sql`${sql.raw(column)} IS NULL`),
    ],
    sql` AND `,
  )})`;

const kindPairings = sql`(${sql.join(
  [
    kindPairing("entry-snapshot", ["entry_identity", "stage"]),
    kindPairing("stage-result", ["stage", "stage_result_ref"]),
    kindPairing("route-decision", ["route_decision_ref", "route_kind"]),
    kindPairing("run-state", ["stage"]),
    kindPairing("waiting", ["waiting_ref", "stage"]),
    kindPairing("workflow-error", ["workflow_error_ref", "stage"]),
    kindPairing("run-result", ["run_result_ref", "stage"]),
  ],
  sql` OR `,
)})`;

/**
 * 审计外键必须延迟：C03 事务单元先跑 handler 再由事务写审计行，同一事务内插入顺序不保证。
 * 迁移可重复执行，故 DO 块内按字面量内联（不能使用绑定参数）。
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

/** 先判存在再 REVOKE：表已被删除时 `down` 仍可重复执行。 */
const revokeAllIfExists = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  await sql`
    DO $$
    BEGIN
      IF to_regclass('${sql.raw(tableName)}') IS NOT NULL THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer',
          '${sql.raw(tableName)}'
        );
      END IF;
    END
    $$;
  `.execute(db);
};

/**
 * 表只追加：应用与 Outbox 事务只得到 SELECT/INSERT，明确无 UPDATE/DELETE；
 * checkpointer 与 PUBLIC 不得获得任何权限（design D-05）。
 */
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
 * C30 运行事实登记表（design D-05）：只保存七类自有运行事实的精确引用与最小判别元数据，
 * 正文只在 C04；`(project_id, result_kind, idempotency_key)` 唯一配合 `request_digest`
 * 实现同载荷重放与异载荷冲突；`(project_id, run_id, run_version_id)` 只对 `run-state`
 * 建条件唯一索引，保证同一运行版本只有一个状态。
 */
const upResults = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable(resultsTable)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("result_kind", "text", (column) => column.notNull())
    .addColumn("result_id", "text", (column) => column.notNull())
    .addColumn("result_version_id", "text", (column) => column.notNull())
    .addColumn("run_id", "text", (column) => column.notNull())
    .addColumn("run_version_id", "text", (column) => column.notNull())
    .addColumn("parent_run_id", "text")
    .addColumn("thread_id", "text")
    .addColumn("entry_mode", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb)
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("frozen_refs", jsonb, (column) => column.notNull())
    .addColumn("stage", "text")
    .addColumn("entry_identity", jsonb)
    .addColumn("input_snapshot_ref", jsonb)
    .addColumn("stage_result_ref", jsonb)
    .addColumn("route_decision_ref", jsonb)
    .addColumn("route_kind", "text")
    .addColumn("waiting_ref", jsonb)
    .addColumn("workflow_error_ref", jsonb)
    .addColumn("run_result_ref", jsonb)
    .addColumn("valid_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("workflow_graph_results_pk", [
      "project_id",
      "result_kind",
      "result_id",
      "result_version_id",
    ])
    .addUniqueConstraint("workflow_graph_results_idempotency_uidx", [
      "project_id",
      "result_kind",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "workflow_graph_results_kind_ck",
      sql`result_kind IN (${sql.join(
        resultKinds.map((kind) => sql.lit(kind)),
        sql`, `,
      )}) AND ${kindPairings} AND (result_kind <> 'run-state' OR result_version_id = run_version_id)`,
    )
    .addCheckConstraint(
      "workflow_graph_results_identity_ck",
      sql`project_id <> '' AND result_kind <> '' AND result_id <> '' AND result_version_id <> ''
        AND run_id <> '' AND run_version_id <> '' AND entry_mode <> '' AND command_id <> ''
        AND idempotency_key <> '' AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "workflow_graph_results_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "workflow_graph_results_json_ck",
      sql.join([...objectColumns, ...nullableObjectColumns, frozenRefsColumn], sql` AND `),
    )
    .execute();

  // 回读按 `(project_id, result_kind, result_id)` 定位后再按完整版本过滤；分页按持久化时间与稳定键。
  await db.schema
    .createIndex(resultsReadIndex)
    .ifNotExists()
    .on(resultsTable)
    .columns(["project_id", "run_id", "persisted_at", "result_kind", "result_id"])
    .execute();

  await db.schema
    .createIndex(resultsRunStateIndex)
    .ifNotExists()
    .unique()
    .on(resultsTable)
    .columns(["project_id", "run_id", "run_version_id"])
    .where(sql<SqlBool>`result_kind = 'run-state'`)
    .execute();

  await guardAuditForeignKey(db, resultsTable);
  await grantAppendOnly(db, resultsTable);
};

/**
 * C30 只追加链边表（design D-05）：每条链边由已成立事实重建，未发生的分支不写空边；
 * `link_id` 由核心按运行、两端引用与关系码稳定派生，因此重放命中主键即为同事实重放。
 */
const upLinks = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable(linksTable)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("link_id", "text", (column) => column.notNull())
    .addColumn("run_id", "text", (column) => column.notNull())
    .addColumn("from_ref", jsonb, (column) => column.notNull())
    .addColumn("to_ref", jsonb, (column) => column.notNull())
    .addColumn("relation", "text", (column) => column.notNull())
    .addColumn("source_stage", "text", (column) => column.notNull())
    .addColumn("stage_result_ref", jsonb)
    .addColumn("evidence_locator", jsonb)
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("workflow_graph_links_pk", ["project_id", "link_id"])
    .addCheckConstraint(
      "workflow_graph_links_relation_ck",
      sql`relation IN (${sql.join(
        linkRelations.map((relation) => sql.lit(relation)),
        sql`, `,
      )})`,
    )
    .addCheckConstraint(
      "workflow_graph_links_identity_ck",
      sql`project_id <> '' AND link_id <> '' AND run_id <> '' AND relation <> ''
        AND source_stage <> '' AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "workflow_graph_links_digest_ck",
      sql`authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "workflow_graph_links_json_ck",
      sql.join(
        [
          objectColumn("from_ref"),
          objectColumn("to_ref"),
          objectColumn("authorization_context_ref"),
          nullableObjectColumn("stage_result_ref"),
          nullableObjectColumn("evidence_locator"),
        ],
        sql` AND `,
      ),
    )
    .execute();

  await db.schema
    .createIndex(linksReadIndex)
    .ifNotExists()
    .on(linksTable)
    .columns(["project_id", "run_id", "recorded_at", "link_id"])
    .execute();

  await guardAuditForeignKey(db, linksTable);
  await grantAppendOnly(db, linksTable);
};

/**
 * C30 查询登记表（design D-05/D-06）：`ProjectionPortV1.query` 的精确目标与权限快照只登记一次，
 * 同一查询身份重复登记必须是同一载荷，改写目标由唯一键拒绝。
 */
const upQueries = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable(queriesTable)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("query_result_id", "text", (column) => column.notNull())
    .addColumn("query_result_version_id", "text", (column) => column.notNull())
    .addColumn("query_type", "text", (column) => column.notNull())
    .addColumn("target_ref", jsonb, (column) => column.notNull())
    .addColumn("run_id", "text")
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("requested_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("workflow_query_results_pk", [
      "project_id",
      "query_result_id",
      "query_result_version_id",
    ])
    .addUniqueConstraint("workflow_query_results_identity_uidx", ["project_id", "query_result_id"])
    .addCheckConstraint(
      "workflow_query_results_identity_ck",
      sql`project_id <> '' AND query_result_id <> '' AND query_result_version_id <> ''
        AND query_type <> '' AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "workflow_query_results_digest_ck",
      sql`authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "workflow_query_results_json_ck",
      sql.join([objectColumn("target_ref"), objectColumn("authorization_context_ref")], sql` AND `),
    )
    .execute();

  await guardAuditForeignKey(db, queriesTable);
  await grantAppendOnly(db, queriesTable);
};

/** 迁移号 `000050`：C30 唯一新增迁移，只建自有表，不设跨 change 外键、不改上游历史表。 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await upResults(db);
  await upLinks(db);
  await upQueries(db);
}

/** 逆序只删自有表：先撤查询登记，再撤链边，最后删运行事实；上游领域事实与审计不受影响。 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const [table, indexes] of [
    [queriesTable, [] as readonly string[]],
    [linksTable, [linksReadIndex]],
    [resultsTable, [resultsRunStateIndex, resultsReadIndex]],
  ] as const) {
    await revokeAllIfExists(db, table);
    for (const index of indexes) {
      await db.schema.dropIndex(index).ifExists().execute();
    }
    await db.schema.dropTable(table).ifExists().execute();
  }
}
