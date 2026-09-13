## 1. 隔离恢复快照用例

- [ ] 1.1 按 D-01 在 `keeps recovery authorization and findings on one database snapshot` 内创建独立临时工件根，复用 `fixture.postgres.app`、`artifactPolicy()` 和 `createContentAddressedArtifactStore`，并将 source、hash manifest、reconcile 与并发 private put 全部切换到局部实例；用 `finally` 关闭实例并删除精确目录。保持 D-02 的全部断言不变，运行 `pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts --testNamePattern="keeps recovery authorization and findings on one database snapshot" --testTimeout=180000`，要求退出码为 0。

## 2. 确定性验证

- [ ] 2.1 按 D-03 串行重复目标用例 5 次：`for run in {1..5}; do pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts --testNamePattern="keeps recovery authorization and findings on one database snapshot" --testTimeout=180000 || break; done`，要求 5 次均通过且不得靠 sleep、重试断言、skip/todo 或宽松期望收口。
- [ ] 2.2 按 D-03 并行运行完整 artifact 文件与相邻 PostgreSQL monitoring 重载套件：`pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts --maxWorkers=2 --minWorkers=2 --testTimeout=180000`，要求两个文件全部通过，目标用例不再受前序孤儿年龄影响。
- [ ] 2.3 运行相关回归：`pnpm exec vitest run packages/core/test/artifacts.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts --testTimeout=180000 && pnpm exec eslint packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts && pnpm exec prettier --check packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`，要求全部退出码为 0；不修改生产代码、主规格、依赖或测试运行器配置。
