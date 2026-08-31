## Context

C01 已冻结跨进程引用、双时间、授权与审计语义，C02 已冻结六个领域模块的 ports、十类 `DomainEventV1`、命令幂等键和工作流引用，但 `packages/core` 与 `packages/adapters` 尚无持久化实现。当前仓库包含 `apps/api`、`apps/web`、`apps/worker` 和 `packages/contracts`、`packages/core`、`packages/adapters`；C03 只补齐三个应用可复用的 PostgreSQL 基础设施，不创建任何领域事实表。

本 change 是四层架构的横切底座：数据接入层、知识建模层、智能推理层和应用输出层继续拥有各自事实、审核和版本，C03 只提供原子保存、事件投递、幂等消费和流程恢复能力。它为 RI-S14、RI-S44、RI-S62～RI-S65 与 RA-S4～RA-S7 提供事务、审计、版本和重放基础；检查点仅以 I0～I9、A0～A9 的 `runId/threadId/commandId/eventId` 引用关联事实。

直接依赖只有已归档 C02 `domain/module-interfaces-events-workflows`。C03 不修改 C01/C02 契约，任何需要新增共享字段、通用仓储、任意 SQL port、中央迁移索引或让 checkpointer 参与业务事务的实现请求都必须停止并重新规划。

## Goals / Non-Goals

**Goals:**

- 固定 PostgreSQL 18.6 的 schema、角色、迁移与部署边界。
- 用一个 PostgreSQL 本地事务保存模块事实、只追加审计、命令结果和零到多个 C02 领域事件。
- 提供可恢复的表式 Outbox、命令幂等和消费者幂等语义。
- 使用官方 `PostgresSaver`，并证明它与业务事实的角色、schema、事务和生命周期隔离。
- 用真实 PostgreSQL Testcontainers 对上述行为做独立验收。

**Non-Goals:**

- 不实现领域表、领域规则、API/SSE、真实 LangGraph 图、Qdrant 投影、通知渠道、外部 broker、CDC、备份、灾备、登录角色或部署秘密。
- 不提供内存事实源、生产 Mock、生产 seed API、通用仓储、任意查询器、自研 checkpointer 或第二套工作流状态机。
- 不引入 `kysely-ctl`、重试库、锁库、消息队列或额外 ORM；Kysely `Migrator`、PostgreSQL 约束/锁和少量确定性 TypeScript 足够覆盖 C03。

## Decisions

### 1. 模块边界与公开入口

`packages/core/src/persistence/` 保存与数据库产品无关的原子提交、Outbox 和消费者协议；它只依赖 `@riskflow/contracts` 与现有 Zod。`packages/adapters/src/postgres/` 保存 Kysely/pg/PostgresSaver 实现。应用只从 `@riskflow/adapters/postgres` 装配具体 adapter，领域模块仍经 C02 ports 调用，不直接获得数据库对象。

计划文件如下：

```text
packages/core/src/persistence/
  schema.ts
  transaction.ts
  outbox.ts
  idempotent-consumer.ts
  canonical-json.ts
  index.ts
packages/core/test/persistence.test.ts

packages/adapters/src/postgres/
  bootstrap.ts
  pool.ts
  types.ts
  transaction-unit.ts
  outbox.ts
  idempotent-consumer.ts
  checkpointer.ts
  index.ts
  migrations/provider.ts
  migrations/run.ts
  migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.ts
packages/adapters/test/postgres/
  fixture.ts
  postgres-foundation.test.ts
  fixtures/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/900001_fixture_fact.ts
```

`types.ts`、Kysely `Database`、表行类型、原始 SQL 和迁移实现均为 adapter 私有内容，不从 package barrel 导出。公开入口只导出显式配置、部署动作、事务单元、Outbox、幂等消费者和 checkpointer 装配；不导出 `Kysely`、`Pool`、`Transaction`、表行或通用 repository。

选择这一边界的原因是 C02 已给出稳定业务端口，新增跨模块持久化接口只会形成第二套契约。领域 adapter 可以在自己的模块内部接受不透明事务上下文，并自行写入所属表；调用方不能借此越过领域边界。

### 2. 依赖与主调度依赖门

实现使用 proposal 中冻结的精确版本：`kysely@0.29.5`、`pg@8.23.0`、`@types/pg@8.23.1`、`@langchain/langgraph-checkpoint-postgres@1.0.5`、`@testcontainers/postgresql@12.1.0`，许可证均为 MIT。官方来源分别为 npm 包页面与官方文档：

- `https://kysely.dev/docs/migrations`
- `https://node-postgres.com/`
- `https://docs.langchain.com/oss/javascript/langgraph/add-memory#use-in-production`
- `https://node.testcontainers.org/modules/postgresql/`
- `https://hub.docker.com/_/postgres`

离线环境使用批准的内网 npm 镜像或预热 `pnpm fetch` store；测试镜像使用内网 registry 或批准 OCI tar 导入。退出条件沿用 proposal：任一包与 Node 24/PostgreSQL 18 或冻结契约不兼容、官方 checkpointer 无法通过隔离/恢复验收，或 Testcontainers 无法提供同等真实测试时，停止实现并由主调度 Agent重新选型。

依赖门是实现前置条件，不是 worker 任务：主调度 Agent 串行修改 `packages/core/package.json`、`packages/adapters/package.json`、根 `package.json`、`config/dependency-policy.json`、`pnpm-lock.yaml`，执行冻结安装和依赖政策检查并形成 Git checkpoint。C03 worker 不安装依赖，不修改上述文件；门未完成不得开始生产代码。

### 3. PostgreSQL bootstrap、schema 与角色

固定四个 schema：

| schema | 所有者 | 内容 |
| --- | --- | --- |
| `business` | `riskflow_migrator` | 命令收据以及后续领域 change 的事实表 |
| `audit` | `riskflow_migrator` | 只追加审计 |
| `outbox` | `riskflow_migrator` | 待发布事件、租约和消费者收件箱 |
| `langgraph_checkpoint` | `riskflow_checkpointer` | 官方 PostgresSaver 内部表 |

固定四个 NOLOGIN group role：

| 角色 | 最小权限 |
| --- | --- |
| `riskflow_migrator` | 拥有前三个 schema；可执行 Kysely DDL/DML；无 checkpointer 数据权限 |
| `riskflow_app` | `business` 的所需 DML，`audit` 的 `SELECT/INSERT`，`outbox.events` 的 `INSERT`；无 DDL、审计更新/删除或 checkpointer 权限 |
| `riskflow_outbox_worker` | Outbox 领取/确认/失败和消费者收件箱 DML；无审计修改或 checkpointer 权限 |
| `riskflow_checkpointer` | 只拥有并使用 `langgraph_checkpoint`；无前三个 schema 的访问权 |

管理员运行幂等的 `bootstrapPostgresFoundation`，创建 NOLOGIN 角色和 schema、撤销 `PUBLIC CREATE`，不设置会把未来表权限宽泛授予运行角色的默认权限；每个迁移在创建所属表后显式授予最小权限。它不创建 LOGIN 主体、不接收或保存凭据；C37 再绑定真实部署/运行主体。需要在消费事务中写下游事实的运行主体同时加入 `riskflow_app` 与 `riskflow_outbox_worker`，不新建拥有额外权限的超级角色；纯投递主体只加入 Worker 角色。测试可以创建对应的容器内临时 LOGIN 主体，测试结束随容器销毁。

bootstrap 是受控部署入口，先于 Kysely 迁移；Kysely 历史表 `_riskflow_migration` 与 `_riskflow_migration_lock` 放在已 bootstrap 的 `business` schema 中。API、Worker 和 checkpointer 工厂都不得隐式 bootstrap、迁移或 setup。未部署完成时返回结构化错误，不以运行身份临时建表。

所有业务、审计、Outbox 与 checkpointer 表使用带时区时间。数据库持久化时间由 PostgreSQL `clock_timestamp()`/默认值形成；调用方提供的业务发生时间和 C02 事件系统记录时间必须原样保留。

### 4. 模块迁移发现与执行

生产迁移根固定为 `packages/adapters/src/postgres/migrations`。合法路径为：

```text
<领域目录>/<change-id>/<6位全局序号>_<小写名称>.ts
```

合法领域目录固定为 `platform`、`engineering-data`、`knowledge-modeling`、`risk-identification`、`risk-assessment`、`warning-response`、`review-audit`、`agent-task`、`workflow`、`query-projection`。`change-id` 必须匹配 OpenSpec kebab-case；序号由主调度 Agent 在路线滚动图中分配，跨全部目录唯一且只增不改。C03 使用 `platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.ts`。

一个小型自定义 Kysely `MigrationProvider` 递归读取显式传入的根目录，排序并一次性校验：路径层级、领域目录、change ID、文件名（名称段由小写字母/数字及 `-` 或 `_` 分隔）、全局序号唯一、迁移名唯一，以及模块具有 `up` 和 `down` 导出。任何非法项在创建 `Migrator` 前整体失败，因此不会执行部分待处理迁移。Provider 生成稳定 Kysely key：`<序号>_<领域目录>_<change-id>_<名称>`，不维护中央数组、barrel 或注册表。

Provider 接受显式模块加载函数：部署从已编译 `.js` 目录使用标准 `import(fileURL)`；Vitest 从测试配置传入可加载 `.ts` 的函数。生产入口不扫描测试迁移。测试仅在第二个显式 root 中发现 `900001_fixture_fact.ts`，用于证明原子性；它不是生产事实源。

`runPostgresMigrations` 使用专用迁移连接和 Kysely `Migrator.migrateToLatest()`。Kysely/PostgreSQL migration lock 串行化并发执行；迁移失败返回结构化错误并保留 Kysely 历史。迁移执行是部署动作，不在应用启动、请求处理、Worker polling 或 checkpointer 创建时运行。

迁移 `down` 只服务开发/测试或经批准的部署回滚。已有生产 migration 文件一经归档不得修改；修正必须分配新序号。涉及数据丢失的 `down` 不自动执行。

### 5. core 协议与不透明事务能力

`schema.ts` 复用 C01/C02 strict Schema，定义最小 C03 DTO：

- `AtomicCommandV1`：`projectId`、`commandKind`、`commandId`、`idempotencyKey`、strict `payload`、`actorRef`、`authorizationContextRef`、可选 `runId/threadId`。
- `AuditAppendV1`：`auditEntryId`、`projectId`、动作、目标 `ContractReference`、操作者/授权引用、业务发生时间、版本和可选原因引用；不允许正文或秘密。
- `AtomicCommitV1`：`resultRef`、一条审计和 `DomainEventV1[]`；事件可以为空。
- `OutboxDeliveryPolicyV1`：`policyRef`、`batchSize`、`leaseDurationMs`、`baseDelayMs`、`maxDelayMs`、`maxAttempts`，均严格校验并在每次领取时冻结引用。
- 领取、租约结果、消费者结果和闭合 `PersistenceErrorV1`。

`canonical-json.ts` 只实现 C02 幂等所需的确定性规范化：递归按键排序、保持数组顺序、拒绝 `undefined`/非 JSON 值，再用 Node `crypto.createHash('sha256')`。不增加 canonicalization 依赖；测试用一个向量锁定对象键顺序不影响摘要、数组顺序会影响摘要。

`TransactionContextV1` 是带私有 symbol 的不透明值，只能由 PostgreSQL adapter 创建。`TransactionUnitV1.execute(command, handler)` 的 handler 获得该上下文，并返回 `AtomicCommitV1`；领域 adapter 的模块私有写方法可接收该上下文，但跨模块公开 interface 不接收 SQL、Kysely、表名、通用查询或任意仓储。

不为一个实现再建立通用 Unit of Work 容器、service locator 或 repository registry。事务单元只协调一次命令提交所需的稳定步骤。

### 6. 基础表与约束

#### `business.command_receipts`

主键为 `(project_id, command_kind, idempotency_key)`；保存 `command_id`、规范 payload SHA-256、`result_ref`、`audit_entry_id`、事件 ID 数组、`actor_ref`、`authorization_context_ref`、可选 `run_id/thread_id`、`completed_at`。`command_id` 唯一。表只保存完成结果，因为创建、事实、审计、事件和收据在同一事务中，失败会整体回滚。

#### `audit.entries`

保存 `audit_entry_id` 主键、`project_id`、动作、目标引用、操作者/授权引用、版本、业务发生时间、数据库记录时间、`command_id`、幂等身份、可选 `run_id/thread_id` 和原因引用。数据库权限拒绝应用/Worker 的更新和删除；C03 不增加包含工程正文、模型响应或凭据的自由文本列。

#### `outbox.events`

保存完整且已经 C02 strict Schema 校验的 `event_json`，同时投影不可变调度/审计列：`event_id` 主键、事件类型/契约版本/事件版本、工程和聚合引用、发生/系统记录/数据库持久化时间、因果/关联/生产命令/幂等/授权/审计引用、payload 摘要。调度列为 `status`（`pending|leased|published|exhausted`）、`lease_owner`、`lease_token`、`lease_until`、`attempt_count`、`next_attempt_at`、`published_at`、最后错误类别/诊断引用和更新时间。

数据库约束保证租约字段与状态一致，索引覆盖 `(status, next_attempt_at, persisted_at)`。事件 JSON 的语义由写入前 strict Schema 保证；数据库不复制一套易漂移的业务 JSON Schema。

#### `outbox.consumer_receipts`

主键为 `(consumer_name, event_id)`；保存事件摘要、状态（`pending|completed`）、结果引用、尝试次数、下次重试、最后错误类别/诊断引用、首次/最近尝试和完成时间。完成结果不可被不同 payload 覆盖。

#### 测试夹具事实表

`business.fixture_facts` 只由 `packages/adapters/test/postgres/fixtures/migrations/**` 创建，仅保存测试事实 ID、工程、值和时间，用于证明事务提交/回滚与消费者幂等。生产 migration 和公开 API 不包含该表或 seed 能力。

### 7. 命令幂等与原子提交算法

`PostgresTransactionUnit.execute` 按以下固定次序运行：

1. 在进入事务前 strict 校验命令，规范化 payload 并计算摘要。
2. 开启一个 Kysely/PostgreSQL 本地事务，尝试为 `(projectId, commandKind, idempotencyKey)` 建立/锁定命令身份；唯一约束收口并发。
3. 若已完成：摘要一致则返回原 `resultRef/audit/eventRefs`，不调用 handler；摘要不同则返回 `IDEMPOTENCY_CONFLICT`。
4. 若为首次命令：调用一次领域 handler，让其通过模块私有 adapter 和同一不透明上下文写事实。
5. strict 校验 `AtomicCommitV1` 和每个 C02 `DomainEventV1`；校验事件的 project、producer command、idempotency、actor/authorization、audit 和 causation 引用均属于当前命令。
6. 追加审计、插入全部 Outbox 行、写完成命令收据，然后提交。

任一校验、事实写入、审计、Outbox 或收据失败都抛出并回滚。数据库断连或事务序列化失败可以用同一命令重试；重试不得更换命令、幂等键、事件 ID、业务发生时间、系统记录时间或审计 ID。

不支持跨数据库分布式事务。C03 的原子能力仅覆盖同一 PostgreSQL 实例；将来外部副作用必须从已提交 Outbox 驱动。

### 8. Outbox 领取、投递与恢复

`PostgresOutbox` 提供 `claimBatch`、`acknowledge`、`recordFailure` 三个窄操作。Worker 循环由 `apps/worker` 的后续 change 编排，C03 不创建常驻进程。

`claimBatch` 在短事务中选择 `pending` 或租约已过期且到期可重试的行，使用 `FOR UPDATE SKIP LOCKED`、稳定排序和 `LIMIT batchSize`；它生成随机 lease token、写 owner/until、增加尝试次数并返回事件。事务提交后才调用投递 callback，避免网络等待占用行锁。

成功后 `acknowledge` 仅在 `eventId + leaseOwner + leaseToken` 匹配且租约未过期时将行改为 `published`。投递成功但确认前崩溃会留下租约；到期后新 Worker 领取同一 `eventId`，形成至少一次而非恰好一次。

临时失败使用冻结策略的确定性封顶指数退避：`min(maxDelayMs, baseDelayMs * 2^(attemptCount-1))`。不加抖动或第三方重试库；如果实际负载证明同步重试形成尖峰，再由后续 change 加入可复现抖动。达到 `maxAttempts` 后保存为 `exhausted`，仍可审计和人工处理，不删除、不伪装成功，也不阻塞其它行。

所有确认/失败更新都带当前租约条件。过期或已被接管的 Worker 得到 `OUTBOX_LEASE_LOST`，不能覆盖新租约。Outbox 只做数据库 polling；C03 不加 LISTEN/NOTIFY、broker 或 CDC。

### 9. 消费者幂等与失败收口

`PostgresIdempotentConsumer.consume(consumerName, event, handler)` 先 strict 校验 `DomainEventV1` 并计算规范摘要，再以 `(consumerName,eventId)` 唯一键收口：

1. 在短事务中以 `INSERT ... ON CONFLICT` 建立持久 `pending` 收件箱行；摘要不同立即冲突，已完成且摘要一致时返回原结果。
2. 在业务事务中锁定该行并再次检查状态；并发调用在行锁后若看到 `completed`，返回原结果而不调用 handler。
3. 首个可处理调用让 handler 使用同一个不透明事务上下文写自己的领域事实并返回 `resultRef`；完成收据与事实同事务提交。
4. handler 失败或进程终止则事实和完成状态一起回滚，持久 `pending` 行仍可重试；随后用独立短事务只更新尝试/错误/下次重试元数据。该元数据失败不会假装消费完成。

并发重复由唯一约束与行锁串行化。消费者产生的新领域事件仍必须通过同一原子提交/Outbox 路径，不得在 callback 中直接调用外部系统。跨 PostgreSQL 的外部副作用不在 C03 的幂等保证内，后续 adapter 必须使用接收方幂等键。

### 10. LangGraph checkpointer 隔离

`checkpointer.ts` 是官方 `PostgresSaver` 的薄装配；RiskFlow 包装器直接继承官方 saver，保留 `BaseCheckpointSaver` 的完整公开契约，不复制其表结构或序列化逻辑：

- `setupPostgresCheckpointer` 是单独部署动作，以专用 `riskflow_checkpointer` 连接和固定 `langgraph_checkpoint` schema 调用官方 setup。
- `createPostgresCheckpointer` 只创建运行时 saver，不隐式 setup；缺表时映射 `CHECKPOINTER_SETUP_REQUIRED`。
- checkpointer 使用独立连接池/身份，不共享 `riskflow_app` 的 Kysely transaction。
- graph state 的业务通道必须通过 C02 strict Schema 校验；官方 `__error__`、`__scheduled__`、`__interrupt__`、`__resume__`、`__pregel_tasks` 协议通道保留给 LangGraph，不被误判为业务字段。
- checkpoint metadata 只保存 C02 允许的小型 graph state 与 `runId/threadId/commandId/eventId` 引用；不放标准化风险记录、风险评估记录、证据正文、模型响应或秘密。

恢复方必须通过领域 port 核对检查点引用的业务结果。引用不存在或已回滚时返回 `CHECKPOINT_INCONSISTENT`，不能从 checkpoint payload 补造事实。业务事务先提交、随后 checkpoint 写入失败时，业务结果保持有效；恢复使用原幂等键查询既有结果后继续。清理线程或重建 checkpointer schema 不级联、触发或调用前三个 schema。

### 11. 错误、审计、时间与敏感数据

内部闭合错误类别固定为：

```text
MIGRATION_INVALID
MIGRATION_SEQUENCE_CONFLICT
MIGRATION_FAILED
CONNECTION_FAILED
TRANSACTION_FAILED
IDEMPOTENCY_CONFLICT
EVENT_CONTRACT_INVALID
OUTBOX_LEASE_LOST
OUTBOX_DELIVERY_FAILED
OUTBOX_EXHAUSTED
CONSUMER_CONFLICT
CHECKPOINTER_SETUP_REQUIRED
CHECKPOINT_INCONSISTENT
```

每个 `PersistenceErrorV1` 包含 `code`、`retryable`、`stage`、`occurredAt`、`diagnosticRef` 和受限 `contextRefs`，不向调用方暴露 SQL、连接串、凭据、原始驱动错误或完整业务正文。上层确定性映射到 C02 `ModuleErrorV1`：幂等/消费者 payload 冲突映射 `IDEMPOTENCY_CONFLICT`；临时连接、事务或租约失败映射 `TRANSIENT_FAILURE`；事件版本不支持映射 `UNSUPPORTED_CONTRACT`；非法迁移和检查点事实不一致映射 `TERMINAL_FAILURE`。不依赖错误文案匹配。

日志和审计只记录身份、版本、时间、阶段、尝试、租约和诊断引用。连接配置由 composition root 显式注入；adapter 不自行读取环境变量。原资料、证据、监测正文、模型响应、思维链、token、密码和连接串不得进入命令收据、Outbox 调度列、consumer receipt、checkpoint metadata 或错误上下文。

时间语义固定为：事件 `occurredAt` 是业务发生时间，`recordedAt` 是事件系统记录时间，数据库 `persisted_at` 是事务保存时间；租约、重试、尝试和完成另用独立时间列。重试只能追加尝试时间，不能改写前三类历史时间或版本/引用。

### 12. Testcontainers 验收与容器生命周期

集成测试固定镜像为 `postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`。`postgres-foundation.test.ts` 每个测试文件在 `beforeAll` 启动一个容器，依次执行 bootstrap、生产 migration、测试 fixture migration 和 checkpointer setup；每个场景清理自身数据或使用独立 project/command/thread ID，不重复启动容器。`afterAll` 先关闭 Kysely、角色池和 checkpointer 连接，再停止容器。容器不可用时测试明确失败，不静默 skip 或退回内存实现。

同一集成文件验证：

- schema、NOLOGIN group role、默认权限、业务/Worker/checkpointer 越权拒绝和审计不可修改；
- 合法迁移发现、新目录无需中央注册、重复序号/非法导出执行前失败、并发 migration lock；
- 测试事实 + 审计 + 命令收据 + Outbox 同时提交，审计/Outbox 故障时全部回滚；
- 相同命令串行/并发重放只形成一个结果，同键不同 payload 冲突；
- Outbox 并发领取、确认、失败退避、旧租约拒绝、确认前崩溃后的重投和 exhausted 保留；
- 消费者成功重放、并发重复、handler 失败回滚和相同 eventId 不同 payload 冲突；
- PostgresSaver put/get/list、关闭连接后恢复、检查点角色隔离、缺失事实引用拒绝、检查点清理不删除业务事实。

`packages/core/test/persistence.test.ts` 只验证无需数据库的稳定边界：strict DTO、canonical JSON/SHA-256、确定性退避和错误映射。不要为完整错误文案、SQL 形状、调用顺序或内部表字段增加脆弱断言。

### 13. RI/RA 与 C02 对接追踪

| 来源 | C03 落点 |
| --- | --- |
| C02 commands / ports | 原命令身份和 strict payload 驱动事务单元；不新增第二套领域端口 |
| C02 `DomainEventV1` | strict 校验后原样进入 Outbox；`eventId` 驱动投递和消费者幂等 |
| C02 workflows | 仅保存 `runId/threadId/commandId/eventId` 和小型引用；checkpoint 不保存事实 |
| RI-S14、RI-S44 | 只追加审计、来源/版本/更新追踪的原子持久化基础 |
| RI-S62～RI-S65 | 标准化风险记录、综合置信度依据、版本与领域事件同事务提交的基础 |
| RA-S4～RA-S5 | 适用规则集/风险评估版本、元数据快照与评分审计的事实提交基础 |
| RA-S6～RA-S7 | 预警先可靠入库再通知、处置/偏差/校准建议追加和事件投递基础 |

C03 不解释风险字段，不计算 P/C，不改变风险矩阵、阈值、审核或发布状态。后续领域 change 在自己的 schema migration 目录定义表，并通过模块私有 adapter 接入本事务能力。

### 14. 实现和验证边界

实现允许新增/修改的代码范围只有 `packages/core/src/persistence/**`、`packages/core/test/persistence.test.ts`、`packages/adapters/src/postgres/**`、`packages/adapters/test/postgres/**`，以及依赖门已批准的 package export 行。禁止修改 `packages/contracts/**`、`apps/**`、`demo/**`、`openspec/specs/**`、C01/C02 归档、其它 change、根工具链配置和 OpenSpec 配置；禁止创建内存/Mock 生产 adapter。

最小验证顺序：core 定向单测与类型检查、adapter 类型检查、Testcontainers 单文件行为测试、受影响文件 ESLint/Prettier、依赖政策/循环检查、全仓最小门禁、`openspec-verify-change` 独立验证。实现期间不启动开发服务器。

### 15. 待决决策的选项与条件结论

| 决策 | 选项 | 推荐与条件结论 |
| --- | --- | --- |
| 可靠投递 | 表式 Outbox / CDC / 外部 broker | 采用表式 Outbox；只有基准证明 polling 无法满足吞吐或延迟目标时另开 change 评估 CDC/broker |
| 迁移发现 | 中央索引 / 文件系统约定 / `kysely-ctl` | 采用文件系统约定和小型 Provider；中央索引违反模块贡献要求，`kysely-ctl` 是不必要依赖 |
| 并发迁移 | 自研锁 / Kysely + PostgreSQL lock | 采用 Kysely 内置迁移锁；只有官方锁无法跨部署实例串行化的真实失败才更换 |
| checkpointer | 官方 PostgresSaver / 自研表 / 业务表复用 | 采用官方 PostgresSaver 独立 schema/role；若冻结版本不能支持 schema/恢复验收则停止并由主调度重新选型 |
| 重试退避 | 确定性指数 / 带抖动 / 重试库 | 采用确定性封顶指数；观测到重试尖峰后再新增可复现抖动，不引入库 |
| 测试数据库 | Testcontainers / 外部共享库 / 内存替身 | 采用固定真实容器；只有 CI 禁止容器且提供同等隔离的临时 PostgreSQL 服务时才替换，绝不退回内存事实源 |
| LOGIN 角色 | C03 创建 / 部署 change 创建 | C03 只创建 NOLOGIN group role；C37/部署环境拥有 LOGIN、秘密和成员关系 |
| 领域测试事实 | 生产 fixture 表 / 测试 migration | 仅测试 migration；首个领域 change 到来后用其真实表补充领域级验收，不污染生产基础 |

上述条件结论不会改变 C03 的能力拆分；触发任一退出条件时停止实现并重新规划，而非在 worker 内选择替代架构。

## Risks / Trade-offs

- 表式 Outbox 是至少一次，发布后确认前崩溃会重复投递；消费者收件箱和 C02 event ID 是必要收口，不能宣称恰好一次。
- 单实例 PostgreSQL 本地事务不覆盖外部服务；Outbox 保证先入库后投递，外部接收方仍需幂等。
- 文件系统发现依赖部署产物保留 migration 目录；构建/打包门必须验证 `.js` migration 被包含，测试则使用显式 `.ts` loader。
- checkpointer 官方包拥有内部表结构；C03 只冻结装配、权限和行为，不复制表 schema。升级该包必须重新运行隔离与恢复验收。
- 四个 schema 同实例降低早期运维成本，但权限隔离不是物理隔离；若后续合规要求独立数据库，再以不改变 C02 引用的 adapter change 迁移。

## Migration Plan

1. 主调度 Agent 完成依赖门和 Git checkpoint。
2. 实现 core DTO/协议和迁移发现测试夹具。
3. 以管理员部署入口 bootstrap 角色/schema。
4. 以迁移身份执行生产 Kysely migration；测试环境再执行 fixture migration。
5. 以 checkpointer 身份单独执行官方 setup。
6. 运行 core、adapter、Testcontainers 和最小全仓门禁；由独立 Agent 运行 `openspec-verify-change`。

部署失败时不启动应用。bootstrap 可重复执行；Kysely 保留已完成历史，修复后继续执行未完成迁移。应用数据尚未接入前，C03 回滚可在非生产环境按反向依赖顺序清理 checkpointer、fixture 和基础表；生产环境不自动执行破坏性 down，需批准的数据迁移/恢复方案。

## Open Questions

无。所有会改变能力拆分、依赖或事实所有权的选择均已在上表给出推荐和退出条件；命中退出条件时必须停止并重新规划。
