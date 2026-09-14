## Context

见 [proposal.md](./proposal.md) 的 Why。当前测试文件由 `beforeAll` 创建一个 PostgreSQL Testcontainer、一个 `PostgresArtifactRegistry` 和一个工件根目录，26 个用例共享这些对象。前序 `put persists, de-duplicates, and replays immutable manifests` 用例用已完成命令提交 `different bytes`，生产契约允许摘要 `538a741c622733afe147819e939d82cc071edfbeb3eb49ed701a55975ac288b3` 的新对象在幂等冲突后作为未登记孤儿保留。

目标用例的恢复路径先在同一个专用 `REPEATABLE READ READ ONLY` reader 上完成工程授权扫描和清单 findings，关闭该 reader 后再扫描工件根中的孤儿。主机满载使前序孤儿的文件年龄超过 `orphanGracePeriodMs = 10_000` 时，目标用例会额外得到 `orphan-object`，因此 `summary.passed` 为 `false`；这不表示 PostgreSQL 快照分裂。测试文件间各自启动容器，不存在跨文件共享数据库。

## Goals / Non-Goals

**Goals:**

- 使目标用例的文件系统输入只来自该用例，同时仍通过真实 PostgreSQL、真实文件系统和公开 composition root 验证恢复快照语义。
- 保留现有断言强度和并发插入窗口，并保证成功、失败和断言异常时都释放连接与临时目录。

**Non-Goals:**

- 不改变生产工件写入、幂等冲突、孤儿宽限期、恢复核对、授权或 PostgreSQL 隔离语义。
- 不清理或隐藏前序用例有意产生的孤儿，不修改主规格、Schema、migration、依赖或测试运行器配置。

## Decisions

### D-01 目标用例使用独立临时工件根

在 `keeps recovery authorization and findings on one database snapshot` 内用现有 `mkdtemp` 创建精确临时目录，并用已有 `createContentAddressedArtifactStore`、`fixture.postgres.app` 和 `artifactPolicy()` 组装局部 store/maintenance。该用例的 source、hash manifest、reconcile 与并发 private put 全部通过局部实例执行；`finally` 先 `close()`，再 `rm(..., { recursive: true, force: true })`。

选择该方案是因为它只隔离会污染结论的文件系统状态，同时保留真实数据库连接和生产装配路径。直接删除前序 `different bytes` 会让目标用例继续依赖其它用例的清理纪律；冻结时钟会改变本用例实际覆盖的 orphan eligibility；新增 fixture helper 对单一调用点没有收益。

### D-02 保持测试契约不变

继续断言首个 finding 存在，在其后提交受限 private manifest，耗尽同一 findings iterator，并精确要求 recovery summary `passed: true`。不得增加 sleep、轮询重试、`skip`/`todo`、二选一结果或删除断言。

这项变更不修改接口、Schema、状态、持久化、权限、错误、事务或可观测性契约。RI-S14、RI-S42、RI-S44、RI-S61～RI-S65 与 RA-S3～RA-S7 的主规格追踪保持不变。

### D-03 以负载组合验证隔离

先将目标用例串行重复 5 次；再并行运行完整 artifact 文件与相邻 `postgres-monitoring-store.test.ts`，要求两者均通过；最后联合运行 core artifact 与 adapter artifact 套件。验证直接观察退出码和原断言，不引入等待或自动重试脚本。

## Risks / Trade-offs

- [局部 composition root 新增一个连接池，会略增该用例资源占用] → 复用现有 Testcontainer，不再启动容器，并在 `finally` 中先关闭局部实例。
- [清理异常可能遮蔽原断言错误] → 保持 `close()` 与精确临时目录删除为标准资源收口；不吞掉业务断言失败。
- [只隔离文件系统，数据库仍与文件内其它用例共享] → 使用现有唯一 `snapshotProjectId`、命令 ID 和工件 ID；该用例需要真实共享 PostgreSQL 负载，但不读取其它工程清单。

## Migration Plan

无数据迁移或部署步骤。实现仅修改测试用例；回滚时还原该用例的局部 composition root 即可，生产数据和接口不受影响。

## File Ownership

- 修改：`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 的 `keeps recovery authorization and findings on one database snapshot`。
- 新增生产文件、删除文件、新依赖：均无。
