## Why

`content-addressed-artifact-store.test.ts` 的恢复快照用例复用文件级工件目录；前序幂等冲突用例按既有生产契约留下未登记对象后，满载运行会使该对象跨过 10 秒宽限期，从而被目标用例的全局孤儿扫描计入并偶发令 `summary.passed` 为 `false`。该失败与恢复授权和 findings 的 PostgreSQL 一致快照无关，却使同一代码在不同机器负载下得到不同测试结论。

## What Changes

- 让恢复快照用例使用独立临时工件根，继续复用现有 PostgreSQL fixture 和公开 composition root，并在用例结束时可靠关闭和删除精确临时目录。
- 保留当前关于首个 finding、并发写入和恢复通过的全部断言，不增加 sleep、重试、跳过或宽松分支。
- 增加串行重复、与相邻 PostgreSQL 重载套件并行、相关工件套件三层验证，证明测试结论不再依赖前序孤儿的年龄或主机调度速度。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本 change 只修正测试隔离，不改变 `platform/content-addressed-artifact-store` 的需求、场景或生产行为，因此在 `.openspec.yaml` 中设置 `skip_specs: true`。

## Impact

- 计划修改：`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 中 `keeps recovery authorization and findings on one database snapshot` 用例。
- 不修改：`packages/adapters/src/**`、主规格、公开 API、Schema、数据库事务/隔离级别、工件维护策略和依赖清单。
- 依赖治理：复用 Node.js 标准库临时目录 API、现有 `createContentAddressedArtifactStore` 与当前测试依赖；不新增或升级依赖。
- RI/RA 追踪：既有 RI-S14、RI-S42、RI-S44、RI-S61～RI-S65 与 RA-S3～RA-S7 行为不变；本 change 只恢复其现有验收证据的确定性。
