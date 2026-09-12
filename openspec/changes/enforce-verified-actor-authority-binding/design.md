## Context

见 [proposal.md](./proposal.md) 与本 change 的两个 delta spec。规划基线为 `b78a599ddc67005ddeb99010b152dc0ebf02c9c6`，schema 为 `spec-driven`。

C06 `LocalIdentityAccessV1.verify` 已返回 `AuthorizationDecisionV1`，其中 `context.actorId` 来自服务端保存并按当前事实复验的授权上下文。C11、C14 的命令和查询 Schema 同时携带外层 `actorId` 与 `AuthorizationContextV1.actorId`；现有适配器会比较这两个调用方声明值，却大多丢弃 C06 返回值。C14 `readSeriesRevision` 已局部实现“比对验证结果并用验证主体写审计”，说明所需事实和错误类型均已存在。

当前所有写入通过 C03 `TransactionUnitV1` 形成业务事实、命令收据和 C07 审计。C11 的来源权限收口在首个领域事务后调用 C06；C14 `freezeSnapshot` 的精确空间/资料复验位于 repeatable-read handler 内。设计必须保持这些既有事务、幂等、分支和不可枚举语义。

## Goals / Non-Goals

**Goals:**

- 在 C11、C14 既有私有验证入口一次性建立“声明主体 = C06 已验证主体”的硬边界。
- 让进入领域写入、查询记录、C03 收据/审计及 C11 权限收口的命令对象只携带已验证主体。
- 保证伪造主体在 C03 幂等结果解析前被拒绝；合规重放和精确目标复验保持现状。
- 用两份现有真实 PostgreSQL 测试覆盖所有受影响的写、读和 resolve 入口及可观察零副作用。

**Non-Goals:**

- 不改变 `packages/contracts/**`、core 命令/查询 Schema、公共端口、分支、成功形状或错误联合。
- 不改变数据库表、迁移、权限、索引、事务实现、幂等键/摘要、Outbox 或历史数据。
- 不修复其它模块，不建立共享授权框架，不新增依赖、配置或日志。
- 不追溯改写可能已存在的历史主体行；若后续需要数据核查或修复，必须另立受审计 change。

## Decisions

### D-01 在既有私有验证入口比对 C06 决定

C14 `PostgresMonitoringStoreV1.#verify` 保持返回 `AuthorizationDecisionV1`：先执行已有声明工程/主体/能力检查，再调用 C06 `verify`，随后比较 `decision.context.actorId` 与输入 `actorId`；不一致抛出既有 `domainFailure(moduleError("AUTHORIZATION_DENIED", causalId))`，成功返回 decision。

C11 `PostgresEngineeringContextSourceRegistry.#verify` 与 `#verifyRead` 改为返回 `AuthorizationDecisionV1`，并在各自现有 C06 调用后执行同一主体比对。写路径继续用 `preserveDomainError` 包装既有不可枚举授权错误；读路径继续携带既有 `requiredCapability`，不增加目标、主体或授权上下文细节。

C14 `readSeriesRevision` 中现有调用点局部比对随之删除，仅保留从 `#verify` 返回的验证主体。两个文件不抽取第三个共享 helper：三个入口已经分别拥有正确的分支、错误包装和空间投影语义，跨文件抽象会扩大所有权且形成第二套授权层。

**备选：**只在每个调用点加条件。拒绝该方案，因为容易漏掉新调用点并重复错误映射。修改 C06 或公共 contracts 也被拒绝，因为 C06 已返回权威主体，缺陷在 C11/C14 未消费返回值。

### D-02 验证后只向副作用传递 verified command/query

每个会产生副作用的入口取得 decision 后，以原 strict 输入浅复制出局部 `verifiedCommand` 或 `verifiedQuery`，只把 `actorId` 设为 `decision.context.actorId`。由于 D-01 已证明三个主体值相同，这不会改变命令载荷语义或 C03 摘要，但使下游唯一主体来源可直接审计：

- C14：`reviseSeries`、`registerAvailabilityPolicy`、`registerBatch`、`freezeSnapshot`、`readSnapshot`、`readSeriesRevision` 将 verified 对象传给 `atomicCommand`、事务 handler、领域 `audit.actorId`、`actor_id`、`requested_by` 与 `commit`；`resolveSnapshotQuery` 只做当前复验，不改已保存请求者。
- C11：`reviseContext`、`registerSegments`、`createApplicabilitySnapshot`、`#registerSourceDelivery` 将 verified 对象传给 `atomicCommand`、事务 handler和 `#ensureSourceAccess`；因此工程/空间修订、资料段集合、适用性快照、资料项/交付/版本、收据、审计、`allowedAccountIds` 与 `registeredByAccountId` 都来自验证主体。`#readSourceSegments`、`#readEvidenceAccess` 将 verified query 传给 `#registerReadQuery`，从而固定 `requested_by`、收据与审计主体。

纯读取入口 `resolveSourceProcessingInput`、`resolveSourceVersionForRead`、`resolveReadQuery` 及 `#projectReadQuery` 不新增写入，但仍必须通过返回 decision 的 `#verifyRead`；任何调用点都不得绕过 D-01。多次精确复验可继续使用 verified 对象，其主体保持不变。

**备选：**验证相等后仍到处使用原 `command.actorId`。这能阻止伪造写入，但审计主体仍在代码上来自调用方声明，不满足唯一来源要求，故不采用。

### D-03 授权拒绝先于幂等，精确范围复验保持原位

所有主体比对必须发生在 `TransactionUnitV1.execute` 前，使伪造主体不能借已存在的命令收据获得成功结果或 `IDEMPOTENCY_CONFLICT`。现有大多数入口已按此顺序执行 C06。

C14 `freezeSnapshot` 是例外：其精确来源集合只能在 repeatable-read 事务内按冻结记录时点解析。该入口先以相同 `engineering-data.freeze` 分支和空的请求范围调用一次 `#verify`，完成主体绑定并生成 verified command，再进入 C03；handler 内继续按实际序列空间和选中样本来源执行既有精确 `#verify`。前置检查不替代精确检查，也不读取目标或改变快照事务隔离。

C14 `registerBatch` 保留“序列范围前置验证 → C04 样本工件读取 → 精确来源复验”的两段授权，第二次验证继续在业务事务前。C11 `#registerSourceDelivery` 保留首次事务前验证和事务后权限收口前复验；首次验证已经阻止伪造主体产生领域事实，第二次验证继续保护当前授权变化下的收口。

合规同键同载荷重放继续返回原结果，同键不同载荷只在当前主体通过验证后返回 `IDEMPOTENCY_CONFLICT`。主体不一致始终折叠为 `AUTHORIZATION_DENIED`，不泄露收据或目标存在性。

### D-04 错误、Schema 与公共契约不变

外层主体与所携授权快照主体不一致仍由现有 strict Schema/适配器前置检查处理；本 change 新增的是二者共同伪造但与 C06 服务端决定不一致的情形。该情形复用现有 `AUTHORIZATION_DENIED`、category、retryable 与 `requiredCapability` 语义，不返回声明主体、验证主体、目标引用或差异原因。

`AuthorizationContextV1`、工程数据命令/查询、C11/C14 私有命令 Schema 已包含完成比对所需字段，`AuthorizationDecisionV1` 已包含权威 context；因此不新增字段、不改变版本、不增加第二套授权上下文或公共验证接口。

### D-05 持久化、迁移与回滚

现有 `actor_id`、`requested_by`、C03 `actor_ref` 和 C11 权限命令字段已能保存 verified actor，不需要数据库变化。禁止修改既有 migration、provider/runner、中央注册与测试清单；也不申请 `000040` 号段。若实现发现任何 Schema、表或迁移需求，立即停止并向主调度 escalation，不得自行扩展范围。

部署仅替换两个 adapter 的应用代码。回滚为回退该代码变更；无数据迁移或双写阶段。回滚会重新暴露伪造风险，只能用于隔离环境或由主调度明确接受风险的紧急处置。

### D-06 真实 PostgreSQL 回归覆盖可观察行为

只扩展现有：

- `packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts`
- `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`

每个文件增加或扩展一个表格驱动的主体绑定场景，复用现有 Testcontainers fixture、真实 C06 `authorize/verify`、C03 收据/审计和当前领域数据。每个受影响入口使用真实授权 context，然后只在提交副本中把外层与快照 `actorId` 同时改为伪造值；断言固定为：

1. 返回 `AUTHORIZATION_DENIED`，且与既有无权/不可解析类别一致；
2. 对应领域表、查询结果、命令收据、业务审计、Outbox 和 C11 权限收口均无新增或修改，且不存在伪造主体行；
3. 使用原 verified actor 的同类控制命令/查询成功，相关 `actor_id`/`requested_by`/`actor_ref` 等于真实主体。

C14 覆盖序列修订、策略、批次、快照冻结、快照读取、快照 resolve 和序列修订读取；复用现有 `keeps authorization ahead of idempotency and writes only the verified actor` 场景，避免再建 fixture。C11 覆盖工程/空间修订、资料段集合、适用性快照、来源交付、两个资料输入解析入口、`source-segments`/`evidence-access` 读取及两类 resolve。断言面向结果码和数据库行，不断言完整文案、私有调用次数或 SQL 顺序；容器不可用时测试失败，不得 skip 或回退 mock。

### D-07 文件所有权与依赖治理

待实现仅修改：

```text
packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts
packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts
packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts
packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts
openspec/changes/enforce-verified-actor-authority-binding/**
```

不新增、删除或升级依赖，不修改 package manifest、lockfile、依赖政策、应用、contracts、core、迁移、主 specs 或其它 change。

### D-08 RI/RA 追踪

| 来源 | 设计收口 | 可运行证据 |
| --- | --- | --- |
| RI-S14 | C11/C14 每次业务写入、受保护读取与 resolve 都绑定 C06 当前已验证主体；拒绝不可枚举 | 两份真实 PostgreSQL 测试的伪造拒绝、零副作用与合规控制 |
| RI-S21 | 监测序列、批次、样本与快照不接受伪造主体写入 | C14 领域表、收据与审计行核对 |
| RA-S1 | 工程、空间、适用性及监测输入的主体与工程授权上下文一致 | C11/C14 写入与读取场景 |
| RA-S7 | 监测更正、快照和审计链中的主体唯一来自当前验证 | C14 批次/快照与审计主体核对 |

## Risks / Trade-offs

- [某个调用点仍把原始命令传给副作用] → 逐项核对 proposal 调用点清单，并以目标表和 C03 审计的伪造主体查询覆盖所有入口。
- [C14 冻结前置验证增加一次 C06 读取] → 仅为该特殊幂等路径增加最小无范围验证；事务内精确验证保持不变，正确性优先于一次低频调用成本。
- [两次验证之间授权被撤销] → 后续精确验证继续读取当前 C06 事实并拒绝，不缓存或复用前置决定放宽范围。
- [测试因共享数据产生假阳性] → 每个伪造调用使用唯一 command/query id，并同时核对该身份、伪造 actor 与目标表计数。

## Migration Plan

1. 在两个 adapter 私有入口与调用点实现 D-01～D-03，不触碰迁移或公共 Schema。
2. 运行两份真实 PostgreSQL 定向测试及静态、依赖和 OpenSpec 校验。
3. 部署应用代码；无需 schema migration、回填或双写。
4. 若上线前需回退，回退 adapter 代码与测试；任何历史伪造数据核查另行受审计处理。

## Open Questions

无。主体权威来源、错误、幂等顺序、事务边界、测试范围、文件所有权和迁移边界均已固定。
