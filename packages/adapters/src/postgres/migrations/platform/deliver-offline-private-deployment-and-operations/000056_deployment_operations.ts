import { sql, type Kysely } from "kysely";

/**
 * C37 D-19：宿主运维状态、因果授权关联与只追加运维审计。
 *
 * 集群级角色由 bootstrapPostgresFoundation 创建（需要 CREATEROLE 的管理连接），
 * 本迁移只负责表、索引、授权与追加语义触发器；业务运行主体
 * （riskflow_app / riskflow_outbox_worker）没有运维状态或运维审计的写权限。
 */

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

/** 与 bootstrap 声明同名；迁移只消费，不在此创建集群级角色。 */
const DEPLOYMENT_OPERATOR_ROLE = "riskflow_deployment_operator";

const grantPrivileges = async (db: Kysely<unknown>): Promise<void> => {
  // GRANT 的对象是标识符而非绑定参数；角色名来自本模块常量，不是外部输入。
  const operator = sql.raw(DEPLOYMENT_OPERATOR_ROLE);

  // 运维表对业务主体先整体收回，再逐项授予。
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.deployment_operations,
    business.deployment_causal_authorizations,
    business.deployment_operation_audit
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  // 因果授权关联由 C06 签发适配读写；关联行本身不产生新权限。
  await sql`GRANT SELECT, INSERT ON TABLE business.deployment_causal_authorizations
    TO riskflow_app`.execute(db);
  await sql`GRANT SELECT ON TABLE business.deployment_causal_authorizations
    TO riskflow_outbox_worker`.execute(db);

  // 运维状态与运维审计只归部署运维角色；审计仅追加。
  await sql`GRANT SELECT, INSERT, UPDATE ON TABLE business.deployment_operations
    TO ${operator}`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.deployment_operation_audit
    TO ${operator}`.execute(db);

  // 追加语义由数据库强制，不依赖调用方自律。
  await sql`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE business.deployment_operation_audit
    FROM PUBLIC, ${operator}, riskflow_app, riskflow_outbox_worker,
    riskflow_checkpointer`.execute(db);
  await sql`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
    business.deployment_causal_authorizations
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`GRANT USAGE ON SCHEMA business TO ${operator}`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.deployment_operations")
    .ifNotExists()
    .addColumn("instance_id", "text", (column) => column.notNull())
    .addColumn("operation_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("payload_digest", "text", (column) => column.notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("revision", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("stage", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("input_refs", jsonb, (column) => column.notNull())
    .addColumn("result_refs", jsonb, (column) => column.notNull())
    .addColumn("lease_owner", "text")
    .addColumn("lease_until", timestamptz)
    .addColumn("created_at", timestamptz, (column) => column.notNull())
    .addColumn("updated_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("deployment_operations_pkey", ["instance_id", "operation_id"])
    .addUniqueConstraint("deployment_operations_instance_id_idempotency_key_key", [
      "instance_id",
      "idempotency_key",
    ])
    .execute();

  await db.schema
    .createIndex("deployment_operations_status_index")
    .on("business.deployment_operations")
    .columns(["instance_id", "status"])
    .execute();

  await db.schema
    .createTable("business.deployment_causal_authorizations")
    .ifNotExists()
    .addColumn("root_context_ref", jsonb, (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("branch", "text", (column) => column.notNull())
    .addColumn("child_context_ref", "text", (column) => column.notNull())
    .addColumn("invocation_id", "text", (column) => column.notNull())
    .addColumn("policy_ref", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addPrimaryKeyConstraint("deployment_causal_authorizations_pkey", [
      "root_context_ref",
      "project_id",
      "actor_id",
      "branch",
    ])
    .addUniqueConstraint("deployment_causal_authorizations_child_context_ref_key", [
      "child_context_ref",
    ])
    .execute();

  await db.schema
    .createTable("business.deployment_operation_audit")
    .ifNotExists()
    .addColumn("event_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("operation_id", "text", (column) => column.notNull())
    .addColumn("instance_id", "text", (column) => column.notNull())
    .addColumn("revision", "integer", (column) => column.notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("stage", "text", (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("context_refs", jsonb, (column) => column.notNull())
    .addColumn("release_refs", jsonb, (column) => column.notNull())
    .addColumn("backup_ref", "text")
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("deployment_operation_audit_operation_id_index")
    .on("business.deployment_operation_audit")
    .columns(["instance_id", "operation_id"])
    .execute();

  // 审计只追加：UPDATE/DELETE 由触发器直接拒绝，即使未来新增角色或超级用户旁路。
  // 函数必须建在 business（public 已按 C03 bootstrap 收回 CREATE）。
  await sql`CREATE OR REPLACE FUNCTION business.reject_deployment_operation_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'deployment_operation_audit is append-only';
    END;
    $$`.execute(db);

  await sql`CREATE TRIGGER deployment_operation_audit_append_only
  BEFORE UPDATE OR DELETE ON business.deployment_operation_audit
  FOR EACH ROW EXECUTE FUNCTION business.reject_deployment_operation_audit_mutation()`.execute(db);

  await grantPrivileges(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS deployment_operation_audit_append_only
    ON business.deployment_operation_audit`.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.reject_deployment_operation_audit_mutation()`.execute(
    db,
  );
  // 表名必须带 schema；无限定名会落到已收回 CREATE 的 public。
  for (const table of [
    "deployment_operation_audit",
    "deployment_causal_authorizations",
    "deployment_operations",
  ]) {
    await sql`DROP TABLE IF EXISTS business.${sql.raw(table)}`.execute(db);
  }
}
