import { sql, type Kysely, type SqlBool } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;

const table = "business.identification_graph_results";
const readIndex = "identification_graph_results_read_idx";
const runStateIndex = "identification_graph_results_run_state_uidx";

/** D-06 一张追加登记表承载的八类 C24 自有工件引用，与核心判别联合一一对应。 */
const resultKinds = [
  "input-snapshot",
  "work-plan",
  "stage-result",
  "waiting",
  "workflow-error",
  "run-state",
  "run-result",
  "cancellation",
] as const;

/** D-06 判别专列：每类只允许本类列非空，其它专列必须为空。 */
const kindColumns = [
  "parent_run_ref",
  "preparation_snapshot_ref",
  "input_snapshot_ref",
  "work_plan_ref",
  "stage_result_ref",
  "waiting_ref",
  "workflow_error_ref",
  "run_result_ref",
] as const;

const objectColumn = (column: string) => sql`jsonb_typeof(${sql.raw(column)}) = 'object'`;
const nullableObjectColumn = (column: string) =>
  sql`(${sql.raw(column)} IS NULL OR jsonb_typeof(${sql.raw(column)}) = 'object')`;

/** 必填 JSONB 只存结构化引用；登记行永不保存正文、模型响应或 LangGraph state。 */
const objectColumns = ["artifact_ref", "authorization_context_ref"].map(objectColumn);

const nullableObjectColumns = kindColumns.map(nullableObjectColumn);

/**
 * 各类登记行的完整引用形状由核心 `IdentificationGraphResultRowV1Schema` 唯一限定；
 * 这里按同一判别联合逐类生成“本类专列非空、它类专列为空”，
 * 使数据库拒绝任何核心未声明的引用组合。`waiting` 的 `stage_result_ref` 与
 * `stage-result` 的 `work_plan_ref`（D-15：工作计划形成前的 I0/I1 阶段结果）为核心允许的可选项。
 */
const kindPairing = (kind: string, required: readonly string[], optional: readonly string[] = []) =>
  sql`(result_kind = ${sql.lit(kind)} AND ${sql.join(
    [
      ...required.map((column) => sql`${sql.raw(column)} IS NOT NULL`),
      ...kindColumns
        .filter((column) => !required.includes(column) && !optional.includes(column))
        .map((column) => sql`${sql.raw(column)} IS NULL`),
    ],
    sql` AND `,
  )})`;

const kindPairings = sql`(${sql.join(
  [
    kindPairing("input-snapshot", [
      "parent_run_ref",
      "preparation_snapshot_ref",
      "input_snapshot_ref",
    ]),
    kindPairing("work-plan", ["parent_run_ref", "input_snapshot_ref", "work_plan_ref"]),
    kindPairing("stage-result", ["stage_result_ref"], ["work_plan_ref"]),
    kindPairing("waiting", ["waiting_ref"], ["stage_result_ref"]),
    kindPairing("workflow-error", ["workflow_error_ref"]),
    kindPairing("run-state", []),
    kindPairing("run-result", ["work_plan_ref", "run_result_ref"]),
    kindPairing("cancellation", []),
  ],
  sql` OR `,
)})`;

const kindCheckConstraint = "identification_graph_results_kind_ck";

/** 判别约束正文：新建表与重入既有表必须收敛到同一允许组合（D-15）。 */
const kindCheckDefinition = sql`result_kind IN (${sql.join(
  resultKinds.map((kind) => sql.lit(kind)),
  sql`, `,
)}) AND ${kindPairings}`;

/**
 * 同名判别约束在「新建 C24 表」与「重入已有 C24 表」两条路径上收敛为同一允许组合：
 * 单条 DO 语句先删后建，`ADD CONSTRAINT` 在同一语句内立即校验既有行，任一行越界即整体回滚，
 * 不留无约束的已提交状态；重复执行得到相同约束。
 */
const convergeKindCheck = async (db: Kysely<unknown>, tableName: string): Promise<void> => {
  await sql`
    DO $$
    BEGIN
      ALTER TABLE ${sql.raw(tableName)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(kindCheckConstraint)};
      ALTER TABLE ${sql.raw(tableName)}
        ADD CONSTRAINT ${sql.raw(kindCheckConstraint)} CHECK (${kindCheckDefinition});
    END
    $$;
  `.execute(db);
};

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

/** 先判存在再 REVOKE：表已被删除时 down 仍可重复执行。 */
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
 * 表只追加：应用与 Outbox 消费事务只得到 SELECT/INSERT，明确无 UPDATE/DELETE；
 * checkpointer 与 PUBLIC 不得获得任何权限（design D-06）。
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
 * C24 追加式业务事实登记（design D-06）：只保存八类 C24 工件的精确 C04 引用与最小判别元数据，
 * 主键为 `(project_id, result_kind, result_id, result_version_id)`，正文永不入库；
 * `(project_id, result_kind, idempotency_key)` 唯一，配合 `request_digest` 实现同载荷重放/异载荷冲突；
 * `(project_id, run_id, run_version_id)` 只对 `run-state` 建条件唯一索引，保证同一运行版本只有一个状态。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(table)
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("result_kind", "text", (column) => column.notNull())
    .addColumn("result_id", "text", (column) => column.notNull())
    .addColumn("result_version_id", "text", (column) => column.notNull())
    .addColumn("run_id", "text", (column) => column.notNull())
    .addColumn("run_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("request_digest", "char(64)", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("authorization_scope_digest", "char(64)", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("parent_run_ref", jsonb)
    .addColumn("preparation_snapshot_ref", jsonb)
    .addColumn("input_snapshot_ref", jsonb)
    .addColumn("work_plan_ref", jsonb)
    .addColumn("stage_result_ref", jsonb)
    .addColumn("waiting_ref", jsonb)
    .addColumn("workflow_error_ref", jsonb)
    .addColumn("run_result_ref", jsonb)
    .addColumn("valid_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("identification_graph_results_pk", [
      "project_id",
      "result_kind",
      "result_id",
      "result_version_id",
    ])
    .addUniqueConstraint("identification_graph_results_idempotency_uidx", [
      "project_id",
      "result_kind",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "identification_graph_results_identity_ck",
      sql`project_id <> '' AND result_kind <> '' AND result_id <> '' AND result_version_id <> ''
        AND run_id <> '' AND run_version_id <> '' AND command_id <> '' AND idempotency_key <> ''
        AND actor_ref <> '' AND audit_entry_id <> ''`,
    )
    .addCheckConstraint(
      "identification_graph_results_digest_ck",
      sql`request_digest ~ ${digestPattern} AND authorization_scope_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "identification_graph_results_json_ck",
      sql.join([...objectColumns, ...nullableObjectColumns], sql` AND `),
    )
    .execute();

  // 判别约束对新建与既有 C24 表收敛到同一允许组合（D-15），重入 `up` 不改变其它约束、索引与授权。
  await convergeKindCheck(db, table);

  // 回读按 `(project_id, result_kind, result_id)` 定位后再按完整版本过滤，保持读取路径独立于主键宽度。
  await db.schema
    .createIndex(readIndex)
    .ifNotExists()
    .on(table)
    .columns(["project_id", "result_kind", "result_id"])
    .execute();

  await db.schema
    .createIndex(runStateIndex)
    .ifNotExists()
    .unique()
    .on(table)
    .columns(["project_id", "run_id", "run_version_id"])
    .where(sql<SqlBool>`result_kind = 'run-state'`)
    .execute();

  await guardAuditForeignKey(db, table);
  await grantAppendOnly(db, table);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAllIfExists(db, table);
  await db.schema.dropIndex(runStateIndex).ifExists().execute();
  await db.schema.dropIndex(readIndex).ifExists().execute();
  await db.schema.dropTable(table).ifExists().execute();
}
