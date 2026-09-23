/**
 * C24 跨包测试接线（测试侧边界模块）：把 adapters 包内 `src` 的构造器暴露给其它包的测试夹具。
 *
 * 跨包只能使用公开入口（`no-adapters-deep-import`），而这些构造器与运行时句柄不在 `src` 的公开
 * 子路径索引里；该模块位于 adapters 包自己的测试树内，因此包内引用 `src` 合法，其它包的测试
 * 只引用本模块，从而在不动生产导出面的前提下复用真实实现。
 */
export { createFilesystemArtifactStore } from "../../../src/artifacts/filesystem-artifact-store.js";
export { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
export {
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "../../../src/postgres/checkpointer.js";
export { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
export { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
export { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
export {
  createPostgresIdentificationGraphAdapter,
  type PostgresIdentificationGraphAdapterV1,
} from "../../../src/identification/graph/index.js";
