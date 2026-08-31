# C03 复验与收口报告

## 结论

**PASS — 当前 change 满足实现与验证门槛，可以交回主调度 Agent 收口。**

复验输入为依赖检查点 `1135a8d`、规划检查点 `be398c1`、首次实现检查点 `3f97e7e`、复核修复检查点 `be971db` 及其后的工作树。独立 Sol 复验先发现权限、状态校验和官方 saver 契约问题；在同一连续复验上下文完成批准范围内的局部修复并升级一个 checkpointer 接口问题后，主协调者完成最小架构修复、审阅 diff 和全量门禁。依据当前用户约定，不重复派发第二次 Sol 复检。

| 维度 | 结果 | 摘要 |
|---|---|---|
| Completeness | PASS | 任务 1.1～6.2 已完成；四 schema/角色、事务原子性、Outbox、消费者幂等、checkpointer 隔离与恢复均有证据。 |
| Correctness | PASS | 真实 Testcontainers PostgreSQL 回归、官方 saver 继承/类型契约检查和全仓门禁通过。 |
| Coherence | PASS | 迁移命名规则与夹具统一；权限按迁移显式授予；包装器保持官方 `PostgresSaver` / `BaseCheckpointSaver` 公开契约。 |

## 首次复验发现与收口

### 已解决：官方 LangGraph saver 契约

`PostgresCheckpointer` 现在直接继承官方 `PostgresSaver`，因此保留 `BaseCheckpointSaver` 的 `get`、`getDeltaChannelHistory`、`getNextVersion`、`serde` 和 `toJSON` 等公开能力；RiskFlow 仍只在 `put`、`putWrites`、`getTuple`、`list` 等边界加入确定性校验和引用验证。测试以官方 `PostgresSaver` 类型接收实例，并覆盖 `__pregel_tasks`、`__interrupt__` 协议通道的保存/恢复。

C03 的明确 non-goal 不包含真实 LangGraph 图；本 change 以官方 saver 继承契约和真实 PostgreSQL 持久化验收其装配边界，真实图的暂停/恢复流程由后续 workflow change 验收。

### 已解决：权限、状态与迁移契约

- 删除会将未来表权限宽泛授予运行角色的默认权限，由各 migration 对所属表显式授予最小权限。
- 业务事务与 Outbox 工厂显式设置对应会话角色；多角色 LOGIN 不再无意合并权限。
- checkpoint envelope、metadata counter、pending writes、图状态族和引用在写入与读取路径统一校验。
- 迁移名称段统一为小写字母/数字及 `-` 或 `_` 分隔，消除设计文档与 `900001_fixture_fact.ts` 夹具的冲突。

## Requirement 核对

| Requirement | 结果 | 证据 |
|---|---|---|
| PostgreSQL schema 与角色边界 | PASS | 四 schema、四 NOLOGIN 角色、跨面拒绝、审计只追加、PUBLIC CREATE 撤销和未来表默认权限回归。 |
| 领域/change 迁移自动发现 | PASS | 递归发现、编译 sidecar 排除、路径/导出/序号校验、并发 migration lock 和无中央注册表通过。 |
| 事实、审计、收据与 Outbox 原子提交 | PASS | 成功、零/多事件、故障回滚和事件引用一致性由真实数据库覆盖。 |
| 命令幂等 | PASS | 串行/并发重放及同键不同载荷冲突通过，事实回调不重复执行。 |
| Outbox 至少一次投递 | PASS | `SKIP LOCKED`、租约、确认、退避、旧租约、确认前崩溃重投、冻结策略和 exhausted 保留通过。 |
| 消费者幂等收口 | PASS | 成功重放、并发重复、handler 失败回滚和 payload 冲突通过。 |
| LangGraph checkpointer 隔离与恢复 | PASS | 官方 saver 公开契约、setup、put/get/list、协议写入、重建恢复、引用一致性、越权拒绝和线程清理通过。 |
| 错误、时间与审计 | PASS | 闭合错误类别、可重试性、时间语义、诊断引用及历史身份保持通过。 |

## 剩余非阻塞观察

Outbox 在领取时把已经达到最大尝试次数的过期租约标为 `exhausted`，当前不会额外写入 crash exhaustion 的最后诊断；它不破坏至少一次、终止保留或其它事件继续投递的契约，后续如需更细诊断再单独规划。

## 变更范围

- `packages/adapters/src/postgres/bootstrap.ts`：移除宽泛默认权限。
- `packages/adapters/src/postgres/pool.ts`：支持业务、Outbox Worker 和 checkpointer 会话角色。
- `packages/adapters/src/postgres/index.ts`：按运行职责收窄业务与 Outbox 工厂，删除无调用方的聚合工厂。
- `packages/adapters/src/postgres/checkpointer.ts`：保留官方 saver 完整契约，加入严格 envelope/状态/引用校验并兼容官方协议通道。
- `packages/adapters/test/postgres/postgres-foundation.test.ts`：增加权限、角色、官方 saver 契约及协议通道回归，并消除定向测试的顺序依赖。
- C03 `design.md` / `tasks.md`：记录实际权限、迁移命名和复验收口规则。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts --testNamePattern="checkpoint" --testTimeout=120000` | PASS，1/1，真实 Testcontainers PostgreSQL。 |
| `pnpm exec vitest run packages/core/test/persistence.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts --testTimeout=120000` | PASS，2 files / 28 tests。 |
| `pnpm verify` | PASS：build、typecheck、lint、format、5 files / 61 tests、deps:check、deps:policy、OpenSpec strict 全部通过。 |
| `git diff --check` | PASS。 |
| `openspec validate --all --strict --no-interactive` | PASS，4 items。 |

无 C01/C02、manifest、lock、主 specs、`AGENTS.md` 或 handbook 的实现越界修改。
