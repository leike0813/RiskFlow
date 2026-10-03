import { sql, type Kysely } from "kysely";

/**
 * 评估入口候选目录的耐久定位键。
 *
 * C11 两个登记目录原先只能按文本主键稳定分页，合法长标识会把不透明游标顶过 512 字符契约上限。
 * 这里给两张登记表各加一列由数据库生成的 uuid 定位键与唯一索引：加列时按行回填历史行，
 * 新行沿用同一默认值，游标只携带该 uuid 锚点而不嵌入任意长度领域标识。迁移只增列与索引，
 * 不新增登记事实、不改变领域引用，也不触碰表权限与角色授权。
 */
const catalogCursorTables = [
  {
    table: "business.applicability_metadata_snapshots",
    index: "applicability_metadata_snapshots_catalog_cursor_uidx",
  },
  {
    table: "business.external_risk_events",
    index: "external_risk_events_catalog_cursor_uidx",
  },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const { table, index } of catalogCursorTables) {
    await sql`ALTER TABLE ${sql.raw(table)}
      ADD COLUMN IF NOT EXISTS catalog_cursor_key uuid NOT NULL DEFAULT gen_random_uuid()`.execute(
      db,
    );
    await db.schema
      .createIndex(index)
      .ifNotExists()
      .unique()
      .on(table)
      .column("catalog_cursor_key")
      .execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const { table, index } of catalogCursorTables) {
    await db.schema.dropIndex(`business.${index}`).ifExists().execute();
    await sql`ALTER TABLE ${sql.raw(table)}
      DROP COLUMN IF EXISTS catalog_cursor_key`.execute(db);
  }
}
