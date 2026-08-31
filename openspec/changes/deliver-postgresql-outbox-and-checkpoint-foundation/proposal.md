## Why

C02 已冻结模块调用、事务领域事件与工作流引用契约，但 PostgreSQL 业务事实源、原子提交、可靠事件投递和 LangGraph 恢复状态仍没有可运行实现。C03 需要先建立这一最小持久化地基，使后续领域模块可以在真实 PostgreSQL 上证明“业务事实 + 审计 + Outbox”原子性，并在至少一次投递和流程恢复下不产生重复事实。

## What Changes

- 建立 PostgreSQL 18.6 基线与 `business`、`audit`、`outbox`、`langgraph_checkpoint` 四个隔离 schema，使用迁移、应用、Worker、checkpointer 四类最小权限 NOLOGIN 角色；部署 change 再绑定真实 LOGIN 主体与秘密。
- 在 `packages/core` 定义不暴露 SQL/Kysely/仓储的事务作用域、原子提交、Outbox 投递状态与幂等消费协议；业务事实、审计和 C02 `DomainEventV1` 待发布事件必须在同一事务提交。
- 在 `packages/adapters` 提供 PostgreSQL 连接、Kysely 迁移、事务单元、表式 Outbox、租约领取/失败退避/确认、消费者收件箱和官方 LangGraph `PostgresSaver` adapter。
- 固定模块迁移发现约定：迁移位于 `packages/adapters/src/postgres/migrations/<领域目录>/<change-id>/<全局序号>_<名称>.ts`，运行时递归发现、校验并按全局序号排序；新增迁移不修改中央索引，序号由主调度 Agent 预分配。
- 使用固定 `postgres:18.6-bookworm` Testcontainers 镜像验证：事实/审计/Outbox 原子提交与回滚、同命令幂等重放和冲突、至少一次重投与消费者幂等、租约到期恢复、并发领取，以及 checkpointer 与业务事实的角色、schema、事务和清理隔离。
- 明确 C03 只提供 PostgreSQL 基础 adapter 和测试迁移夹具。后续领域 change 拥有各自事实表；checkpointer 不代替业务入库，Outbox 不拥有领域事实，任何跨模块 interface 都不暴露 SQL、Kysely、表行或通用仓储。

### Non-goals

- 不实现六个领域模块的业务表、领域规则、API/SSE、真实 LangGraph 图、Qdrant 投影、通知渠道、外部 broker、CDC、备份/灾备或部署秘密。
- 不修改 C01/C02 的 vocabulary、common、records、ports、events、workflows 及其公开字段；不新增内存事实源、生产 Mock、生产 seed API 或第二套工作流状态机。
- 不引入 `kysely-ctl`、消息队列、ORM 仓储框架或自研 checkpointer；吞吐数据证明表式 Outbox 不足前，不增加 CDC。

## Capabilities

### New Capabilities

- `platform/postgresql-outbox-checkpoint-foundation`: 规定 PostgreSQL schema/role、模块迁移发现、事务与命令幂等、Outbox 至少一次投递、消费者幂等和独立 LangGraph checkpointer 的稳定行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：仅已归档 C02 `domain/module-interfaces-events-workflows`；复用其 `DomainEventV1Schema`、命令幂等字段、精确引用、双时间、授权、审计和工作流 run/thread 语义，不修改共享契约。
- **四层归属与事实所有权**：本 change 是横切基础设施。`packages/core` 只拥有事务/投递协议；`packages/adapters` 拥有 PostgreSQL 实现与 checkpointer 装配。数据接入、知识建模、智能推理、应用输出层仍由各领域模块拥有业务事实；C03 只原子保存其提交，不解释或改写 RI/RA 内容。
- **RI/RA 追踪**：为 RI-S14、RI-S44、RI-S62～RI-S65 与 RA-S4～RA-S7 提供版本、审计、事务事件和重放基础；I0～I9、A0～A9 只通过 `runId/threadId/commandId/eventId/checkpointId` 关联检查点，检查点不存在时不影响已入库事实，检查点存在时也不能伪造事实。
- **下游消费者**：C04、C06～C09、C11、C16、C20、C24～C31 复用基础 adapter、模块迁移目录和 Outbox/幂等语义；后续 change 只能在自己的领域目录增加迁移。
- **计划代码范围**：新增 `packages/core/src/persistence/**`、`packages/adapters/src/postgres/**` 与 `packages/adapters/test/postgres/**`；清单/exports/依赖策略和锁文件由主调度 Agent 在依赖门串行修改。删除文件为零。
- **禁止修改**：`packages/contracts/**`、`apps/**`、`demo/**`、根工具链配置、`openspec/config.yaml`、`openspec/specs/**`、其它 change/归档工件；worker 不修改任何 manifest、依赖策略或锁文件。

### 依赖门（由主调度 Agent 执行）

| 依赖 | 精确版本 | 用途 | 许可证 | 官方来源 | 离线获取 | 退出条件 |
| --- | --- | --- | --- | --- | --- | --- |
| `kysely` | `0.29.5` | PostgreSQL 类型化查询、事务与内置 Migrator | MIT | `https://www.npmjs.com/package/kysely` | 内网 npm 镜像或 `pnpm fetch` store | Node 24/PG18 不兼容，或迁移/事务验收失败 |
| `pg` | `8.23.0` | Kysely 与 checkpointer 共用的 PostgreSQL TCP 驱动/连接池 | MIT | `https://www.npmjs.com/package/pg` | 同上 | Node 24/PG18 不兼容或连接池/事务语义验收失败 |
| `@types/pg` | `8.23.1` | `pg` TypeScript 类型（仅开发） | MIT | `https://www.npmjs.com/package/@types/pg` | 同上 | `pg` 内置等价类型或版本不再匹配 |
| `@langchain/langgraph-checkpoint-postgres` | `1.0.5` | 官方 PostgreSQL `PostgresSaver` | MIT | `https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres` | 同上 | 官方包不再兼容冻结 LangGraph/PG 基线，或隔离/恢复验收失败 |
| `@testcontainers/postgresql` | `12.1.0` | 真实 PostgreSQL 行为测试（仅开发） | MIT | `https://www.npmjs.com/package/@testcontainers/postgresql` | 同上，并预拉取/导入固定 OCI 镜像 | 容器运行时不可用且有同等真实、可重复的隔离数据库测试设施 |

测试镜像固定为 Docker Official Image `postgres:18.6-bookworm`，manifest digest `sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`；离线环境通过批准的 OCI tar/内网 registry 导入。主调度 Agent 必须先修改 `packages/core/package.json`、`packages/adapters/package.json`、根 `package.json`、`config/dependency-policy.json` 与 `pnpm-lock.yaml`，执行冻结安装和依赖政策检查并形成独立 dependency checkpoint；worker 不安装或修改这些文件。

若实现要求改变 C01/C02 Schema、增加通用仓储/任意 SQL port、让 checkpointer 参与领域事务、增加中央迁移索引，或引入表外 broker/CDC，必须停止并由主调度 Agent 重新规划；不得在 C03 内临时扩张。
