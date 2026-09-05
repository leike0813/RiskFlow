## 1. 监测领域 Schema 与纯算法

- [x] 1.1 在 `packages/core/src/engineering-data/monitoring/schema.ts` 定义并导出 strict Zod Schema 与推导类型，覆盖序列修订、单位换算、NDJSON envelope/样本、批次/样本版本、不可变可用性策略、快照成员/对齐点/四项特征/算法可计算性、查询结果以及 C14 窄命令/结果；复用 C01/C02 引用与固定监测指标，不修改 `packages/contracts/**`，并以 `pnpm exec vitest run packages/core/test/engineering-data/monitoring.test.ts` 验证未知字段、非有限数值、非法单位/时间/窗口/状态和结构上限均被拒绝。
- [x] 1.2 在 `packages/core/src/engineering-data/monitoring/features.ts` 实现纯函数：仿射单位换算、以 cutoff 为锚的等间隔网格、受限线性插值、OLS 短期斜率、相邻斜率 OLS 加速度、去均值+Hann 窗+有界朴素 DFT 频域主峰、median/MAD 异常评分及逐项原因；不得外推、零填充或产生 NaN/Infinity，以 `pnpm exec vitest run packages/core/test/engineering-data/monitoring.test.ts` 验证相同输入/版本确定性重放和缺样逐项不可计算。
- [x] 1.3 在 `packages/core/test/engineering-data/monitoring.test.ts` 用一个地表沉降参数化样例对四项特征做独立直接公式交叉验证，并覆盖单位换算、插值跨度、常量序列、频域并列选最低频率、MAD 尺度下限和 `available|partial|unavailable`；测试只断言稳定数值/状态/原因码，不锁定文案、实现顺序或大段快照，并以同一 vitest 命令通过。
- [x] 1.4 在 `packages/core/src/engineering-data/monitoring/service.ts` 与 `index.ts` 组合 `MonitoringRegistryV1`、策略注册/解析和错误映射，保持算法无存储/Agent/LLM 依赖；在 `packages/core/package.json` 与 `packages/core/src/index.ts` 仅增加 `./engineering-data/monitoring` 子路径/根导出，并以 `pnpm --filter @riskflow/core build && pnpm --filter @riskflow/core typecheck` 验证公共导出。

## 2. PostgreSQL 只追加持久化与迁移

- [x] 2.1 新增 `packages/adapters/src/postgres/migrations/engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.ts`，按 design 建立序列 identity/revision、批次、样本版本、策略、快照、成员、对齐点、特征和查询结果表，配置 FK/check/unique、current pointer 单向更新与最小角色权限；在 `packages/adapters/test/postgres/postgres-foundation.test.ts` 的生产迁移 manifest 登记该模块，并在 `packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts` 使用真实 migrator 验证 `up/down/up`、`riskflow_app` 仅需 SELECT/INSERT/受限 pointer UPDATE、其它运行角色无业务表权限；迁移号固定 `000011`，不得自行改号。
- [x] 2.2 在 `packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts` 与 `index.ts` 实现 `PostgresMonitoringStoreV1` 的序列修订和不可变策略登记，复用 C03 `TransactionUnitV1`、C06 当前授权及 C11 工程/空间精确修订验证；以 `pnpm exec vitest run packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts` 验证版本链、current CAS、策略内容摘要/精确 ref、跨工程/陈旧/无权失败和审计原子性。
- [x] 2.3 在同一 store 实现 C04 NDJSON 流式读取：先核对 manifest/media type/工程/空间/source grants，再逐行限制 64 KiB envelope、16 KiB 样本行、100,000 样本与 C04 总字节上限，等待 `verified` 后形成 canonical SHA-256；以集成测试验证无效 UTF-8、未知字段、乱序/重复/窗外时间、非法单位/数值、来源证据或引用不一致、超限和中途读取失败均整批回滚且不泄露正文。
- [x] 2.4 实现批次/样本只追加事务和确定性 identity/fingerprint，指纹纳入规范化样本、窗口、关系、精确来源和逐样本证据，按序列事务锁收口 `original|correction|supplement`、前序同序列、有效时间点和并发语义；以同一集成测试验证同幂等键同载荷、同 fingerprint 不同命令、并发重复均返回一个 batch ref，同键异载荷为 `IDEMPOTENCY_CONFLICT`，相同数值的不同来源保留独立批次，更正/补录保留旧值与证据，不合法关系无部分事实，普通批次 `events: []`。

## 3. 双时间快照、特征物化与查询

- [x] 3.1 在 `PostgresMonitoringStoreV1` 实现 `monitoring-snapshot` freeze：在一个 C03 `REPEATABLE READ` 事务内冻结 cutoff、数据库 record time、精确序列/策略、当时有效批次与样本版本，调用 core 纯函数并只追加快照/成员/点/特征/可计算性/审计；以集成测试验证原始、更正、补录的 bitemporal 选择、空窗口 `unavailable`、幂等重放和后续数据/策略/序列修订不改变旧快照。
- [x] 3.2 实现 `monitoring-snapshot` read：重新执行 C06 工程/空间/全部 source grants 当前授权，原子登记仅指向精确 snapshot 的 query result 和读取审计，返回既有 `QueryResultRefV1`；通过 `MonitoringRegistryV1.resolveSnapshotQuery` 只读取获准冻结成员、点、特征、可计算性和证据摘要，以集成测试验证获授权读取、跨工程/不存在不可枚举、权限撤销后正文不可读且历史事实不变。
- [x] 3.3 在 `packages/adapters/test/engineering-data/monitoring/{fixture,postgres-monitoring-store.test}.ts` 复用现有 C11 fixture 与真实 C03/C04/C06/C07/C11 migrations，建立一个完整地表沉降流：序列/策略 → 原始批次 → 快照 A → 更正/历史补录 → 快照 B → query；验证精确来源资料段、单位/四项数值、batch/sample/snapshot/audit 链、快照 A 不变、快照 B 使用新增事实、零 C14 领域事件及失败回滚，运行 `pnpm exec vitest run packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts`。

## 4. 现有工程数据端口组合与导出

- [x] 4.1 修改 `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`，通过必需 `PostgresMonitoringStoreV1` 注入/委派补齐既有 `apply(register-monitoring-batch)`、`freeze(monitoring-snapshot)`、`read(monitoring-snapshot)`，保留 `register-source-delivery`、C11 窄能力和其它未实现分支行为；不得把监测 Schema、算法或 SQL 复制进 C11 文件，并以 C11 与 C14 两个 adapter 测试文件共同验证路由。
- [x] 4.2 修改 `packages/adapters/test/engineering-data/context-source/fixture.ts` 和 `postgres-engineering-context-source-registry.test.ts`，由共享 fixture 注入真实 monitoring store，把三个 C14 分支从 `UNSUPPORTED_CONTRACT` 断言改为成功路由，同时保留 `register-external-risk-event`、其它 freeze/read 分支仍关闭的代表性断言；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts`。
- [x] 4.3 在 `packages/adapters/package.json`、`packages/adapters/src/index.ts` 与新增 monitoring `index.ts` 仅增加 `./engineering-data/monitoring` 子路径/根导出，不修改 contracts、apps、根 manifest 或 lockfile；运行 `pnpm --filter @riskflow/adapters build && pnpm --filter @riskflow/adapters typecheck` 验证导出与依赖方向 `contracts ← core ← adapters`。

## 5. 变更级验证与边界复核

- [x] 5.1 运行 `pnpm exec vitest run packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`，确认纯算法、C11 组合、C14 PostgreSQL 行为与迁移发现/全局序号均通过；无容器时报告失败，不回退内存 adapter。
- [x] 5.2 运行 `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy`，再运行 `git diff --check` 与 `openspec validate deliver-monitoring-batches-snapshots-and-features --strict`；确认没有修改 `packages/contracts/**`、`apps/**`、既有 migrations、`pnpm-lock.yaml`、`openspec/specs/**`、归档或其它活动 change，且没有新增依赖、Agent/LLM、阈值/P/C/预警/UI 行为。
