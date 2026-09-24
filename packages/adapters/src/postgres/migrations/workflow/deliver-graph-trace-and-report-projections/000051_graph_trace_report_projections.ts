import { sql, type Kysely } from "kysely";

const queriesTable = "business.workflow_query_results";
const resultsTable = "business.workflow_graph_results";
const linksTable = "business.workflow_graph_links";
const spatialColumn = "spatial_scope_ref";
const spatialConstraint = "workflow_query_results_spatial_scope_ck";
const resultsFrozenRefsIndex = "workflow_graph_results_frozen_refs_gin";
const linksRefsIndex = "workflow_graph_links_refs_gin";

/**
 * C31 design D-05：工程总览按精确工程修订与可选空间选择运行，主题相邻边按精确两端引用选择链边。
 * 两个 GIN 索引都用 `jsonb_path_ops`，与读取谓词的 `@>` 精确包含一致；既有 `(project_id, run_id, …)`
 * 索引无法按工程修订或空间目标选出候选事实。
 */
const createContainmentIndexes = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE INDEX IF NOT EXISTS ${sql.raw(resultsFrozenRefsIndex)}
    ON ${sql.raw(resultsTable)} USING gin (frozen_refs jsonb_path_ops)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS ${sql.raw(linksRefsIndex)}
    ON ${sql.raw(linksTable)} USING gin (from_ref jsonb_path_ops, to_ref jsonb_path_ops)`.execute(
    db,
  );
};

/**
 * 空间目标只对查询登记为空或对象；旧登记行为 `NULL`，仍按原 `run-view`/`trace-chain` 语义读取。
 * 列沿用登记表的追加式权限，不新增写路径；登记回读仍按主键与身份唯一键定位。
 */
const addSpatialScopeColumn = async (db: Kysely<unknown>): Promise<void> => {
  await sql`ALTER TABLE ${sql.raw(queriesTable)}
    ADD COLUMN IF NOT EXISTS ${sql.raw(spatialColumn)} jsonb`.execute(db);
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(spatialConstraint)}'
          AND conrelid = '${sql.raw(queriesTable)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(queriesTable)}
          ADD CONSTRAINT ${sql.raw(spatialConstraint)}
          CHECK (spatial_scope_ref IS NULL OR jsonb_typeof(spatial_scope_ref) = 'object');
      END IF;
    END
    $$;
  `.execute(db);
};

/** 迁移号 `000051`：只加法式扩展 C30 自有表，不改已发布迁移、其它领域表或历史业务事实。 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addSpatialScopeColumn(db);
  await createContainmentIndexes(db);
}

/** 逆序只撤销本迁移新增的结构：先删索引，再删约束与列；旧登记行与其读取语义不受影响。 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS ${sql.raw(linksRefsIndex)}`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(resultsFrozenRefsIndex)}`.execute(db);
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = '${sql.raw(spatialConstraint)}'
          AND conrelid = '${sql.raw(queriesTable)}'::regclass
      ) THEN
        ALTER TABLE ${sql.raw(queriesTable)}
          DROP CONSTRAINT ${sql.raw(spatialConstraint)};
      END IF;
    END
    $$;
  `.execute(db);
  await sql`ALTER TABLE ${sql.raw(queriesTable)}
    DROP COLUMN IF EXISTS ${sql.raw(spatialColumn)}`.execute(db);
}
