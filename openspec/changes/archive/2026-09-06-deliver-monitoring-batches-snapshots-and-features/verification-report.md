# C14 独立验证报告

验证对象：`deliver-monitoring-batches-snapshots-and-features`  
实现提交：`37cebbd51e0418592098fdc190b866544731c153`

## 结论

| 维度 | 状态 |
| --- | --- |
| 完整性 | 16/16 tasks 已勾选；10 项 requirement 均有实现对应物，但测试证据与勾选不一致 |
| 正确性 | 未通过；发现 4 项归档前必须修复的问题 |
| 一致性 | 未通过；事务隔离、查询授权和测试范围偏离已批准 design |

最终判断：**存在 4 项 CRITICAL，不可归档。** 当前实现能通过现有测试和工程门禁，但现有测试没有覆盖 change 声称已经验收的大部分关键场景。

## CRITICAL

### 1. 快照冻结没有在 `REPEATABLE READ` 事务内完成授权取数与事实冻结

- 规格要求冻结在一个 C03 `REPEATABLE READ` 写事务中完成，并以数据库 `clock_timestamp()` 固定记录时点（`design.md:85`、`tasks.md:17`）。
- 实现先在事务外读取序列、策略和样本来源，再使用应用时钟生成 `freezeRecordedAt`（`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts:737-788`）。C03 `TransactionUnitV1` 只调用默认的 `db.transaction()`，没有设置 `REPEATABLE READ`（`packages/adapters/src/postgres/transaction-unit.ts:121`）。
- 事务内随后重新读取批次和样本（`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts:1455-1479`），因此授权校验看到的来源集合与真正冻结的集合可能在并发写入下不一致。

建议：把精确序列、策略、数据库记录时点、样本选择和来源授权所依据的集合统一放入同一个 `REPEATABLE READ` 事务；不要用可注入应用时钟代替数据库记录时点。

### 2. 同一 `recordedAt` 的更正版本选择与登记先后不一致

- 快照必须采用冻结记录时点可见的有效更正，并保留完整前序链（`spec.md:92-95`）。
- 通用 `latestSample` 使用 `recorded_at`、`persisted_at`、ID 依次决胜（`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts:552-564`），但真正冻结时只比较 `recorded_at`，并在相同时按哈希派生的 `sample_version_id` 字典序选择（同文件 `1480-1493`）。固定时钟、批量导入或时间精度碰撞时，后登记的 correction 可能输给 original。

建议：冻结选择复用唯一的版本顺序事实源，至少与登记/预授权路径采用相同的 `recorded_at + persisted_at + stable tie-break` 规则，并增加同记录时点更正回归用例。

### 3. `resolveSnapshotQuery` 可绕过当前授权直接返回快照正文

- 规格要求读取前重新校验当前工程、空间和全部来源权限，权限撤销后旧快照正文不可读（`spec.md:156-169`、`tasks.md:18`）。
- `readSnapshot` 会执行当前授权检查（`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts:813-869`），但返回引用之后，公开的 `resolveSnapshotQuery` 只凭 `QueryResultRefV1` 查询并返回完整快照，没有调用 C06，也没有调用者/授权上下文输入（同文件 `873-923`；`packages/core/src/engineering-data/monitoring/service.ts:23-29`）。旧 query ref 因而可在权限撤销后继续解析正文。

建议：让解析操作携带并验证当前调用身份/授权上下文，或把正文解析限制在完成当前授权校验的同一受控读取操作内；补充“先成功查询、撤销任一来源 grant、旧 query ref 不再可解析”的集成测试。

### 4. C14 PostgreSQL 测试没有覆盖已勾选的核心验收场景

- `tasks.md` 声明已验证 migration `up/down/up`、最小角色权限、NDJSON 全部失败边界、幂等/并发、original/correction/supplement、双时间快照、旧快照不变、权限撤销和审计失败回滚（`tasks.md:10-19`）。
- 实际 C14 store 测试只有一个 happy-path 用例（`packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts:287-490`），只登记 1 个 original 批次和 1 个快照；没有 correction、supplement、并发、重放、非法 NDJSON、回滚、撤权、旧快照或 C14 表权限断言。核心测试也只有 3 个用例（`packages/core/test/engineering-data/monitoring.test.ts:59-122`），没有独立公式交叉验证、频域并列、常量序列、MAD 尺度下限或 `partial`。

建议：先把任务勾选恢复为真实进度，再用少量表格驱动用例覆盖这些稳定业务边界；现有通用 C03 事务测试不能替代 C14 领域关系和冻结语义测试。

## WARNING

### 1. correction 没有验证 `priorBatchRef` 包含被更正时间点

实现只校验 prior batch 属于同一序列，并根据全序列当前值判断 correction（`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts:1233-1303`）。这允许 correction 指向同序列中不包含原值的任意批次，偏离 `spec.md:49-52` 的明确前序关系。建议按每个更正样本验证 prior batch 或其被允许的前序链确实包含目标样本版本。

### 2. 数据库未约束 current pointer 只能单向前进

迁移授予应用角色 `monitoring_series.current_revision_id` 的列级 UPDATE（`000011_monitoring_batches_snapshots_features.ts:16-24`），但数据库没有触发器或等价约束阻止直接回指旧 revision。应用 CAS 能防并发丢写，不能兑现 design 所述的“current pointer 单向更新”。建议增加最小数据库约束并用 `riskflow_app` 角色验证回退失败。

### 3. 特征策略 Schema 接受算法必然不可计算的窗口

`slopeWindowSize`、`accelerationWindowSize` 和 `frequencyWindowSize` 目前只要求正整数（`packages/core/src/engineering-data/monitoring/schema.ts:241-251`），但 OLS 斜率至少需要 2 点、相邻斜率 OLS 加速度至少需要 3 点。建议在策略 Schema 拒绝这些非法窗口，保持错误在配置边界暴露。

## 已执行验证

- `openspec validate deliver-monitoring-batches-snapshots-and-features --strict`：通过。
- `pnpm exec vitest run packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：4 个文件、29 项测试通过。
- `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy`：通过。
- `git diff --check 84e2af7..37cebbd`：通过。
- 实现提交未修改 `packages/contracts/**`、`apps/**`、既有 migration、根 manifest、lockfile、主 specs 或归档；工作树在验证前为 clean。

## 备注

仓库根目录存在 `.codegraph/`，但 CodeGraph 服务无法识别该索引；本次按工具提示降级为 `rg`、精确行号读取、Git 差异和可运行测试核验。未启动开发服务器，未修改生产代码、测试或任务状态。
