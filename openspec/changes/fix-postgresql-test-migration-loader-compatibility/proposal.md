## Why

C03 的 PostgreSQL 集成测试把测试迁移 loader 和生产迁移断言固定在首个 `000001` 迁移上；生产迁移根目录加入合法的后续 platform migration 后，提供器会正确发现它们，但测试 loader 以 `MIGRATION_INVALID` 失败，根 Vitest 因而无法验证既有迁移契约。

## What Changes

- 调整 C03 PostgreSQL 集成测试的迁移夹具：显式声明并加载当前参与测试的合法 platform migration modules，同时继续拒绝未声明或非法模块。
- 让生产迁移提供器断言覆盖已声明的合法迁移集合，不再假定生产根目录永远只有 C03 的一项迁移。
- 保留重复全局序号、非法路径、非法导出和迁移执行前完整校验的既有测试边界。
- 不修改生产迁移提供器、迁移执行器或任何生产 migration。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/postgresql-outbox-checkpoint-foundation`：补充生产迁移兼容性测试随合法 platform migration 贡献扩展、同时保持闭合 loader 与迁移校验边界的要求。

## Impact

- **代码所有权**：后续实现只允许修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`。
- **OpenSpec 工件**：只新增本 change 的 proposal、delta spec、design 和 tasks；不直接修改主 specs、其它活动或归档 change。
- **生产边界**：不修改 `packages/adapters/src/postgres/migrations/provider.ts`、`run.ts`、任何生产 migration、package exports、根配置或锁文件。
- **依赖治理**：不新增、升级或删除依赖，不修改 manifest、依赖策略或锁文件。
- **RI/RA 追踪**：不改变 C03 对 RI-S14、RI-S44、RI-S62～RI-S65 与 RA-S4～RA-S7 的持久化基础追踪；本 change 只恢复这些既有迁移契约的测试可验证性。
