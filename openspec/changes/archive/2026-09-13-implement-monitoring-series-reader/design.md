## Context

见 [proposal.md](./proposal.md) 与 [监测批次、快照和特征 delta spec](./specs/domain/monitoring-batches-snapshots-features/spec.md)。基线固定为 `01b2df23194c6203a1104fa2c898e266109d8365`。

C14 已在 `@riskflow/core/engineering-data/monitoring` 导出 `MonitoringRegistryV1`、`MonitoringSeriesRevisionV1Schema`、`MonitoringSnapshotV1Schema` 和单位换算算法；`PostgresMonitoringStoreV1` 通过私有 `#readSeriesRevision` 精确读取 `business.monitoring_series_revisions`，并通过 `readSnapshot`/`resolveSnapshotQuery` 执行快照查询、当前授权和正文解析。`MonitoringSnapshotV1` 只携带 `monitoringSeriesRef`，不重复序列的指标、参数码和单位事实。

C18 的 `indicator-field-mapping` 已把监测来源固定为 `monitoringIndicator + parameterCode + metric`，并声明 `sourceUnit`、`targetUnit` 与受控转换；它只校验配置内部一致性，不读取 C14 序列。当前基线尚无 C25 生产实现。提示中所称 `MonitoringSeriesRevisionV1` 与 `MonitoringSnapshotV1` 实际位于 C14 core schema，不在 `packages/contracts/src/records/index.ts`；本 change 以代码现状为准，且不修改 contracts。

## Goals / Non-Goals

**Goals:**

- 为未来 C25 提供只依赖所需读取能力的 C14 core 接口，并由既有 PostgreSQL store 实现。
- 固定 strict 输入、strict 输出、当前权限、不可枚举错误、状态、幂等和审计语义，使实现 Agent 无需补公共契约。
- 复用现有序列事实、C03/C06/C07 与 package 子路径，不新增表、依赖、barrel 或 composition。

**Non-Goals:**

- 不把该读取能力扩张为序列列表、搜索、值/特征读取、通用 repository 或 C02 分支。
- 不让 C18、C25、C26 或应用层拥有/复制序列注册事实；本 change 也不实现这些下游模块。
- 不改变快照冻结、`readSnapshot`、`resolveSnapshotQuery`、单位换算算法或既有数据模型。

## Decisions

### D-01：core 导出独立的狭窄 reader，不扩张 `MonitoringRegistryV1`

在 `packages/core/src/engineering-data/monitoring/schema.ts` 定义并导出以下 strict Schema 和推导类型；字段名固定如下：

```ts
ReadMonitoringSeriesRevisionQueryV1 {
  queryId;
  projectId;
  actorId;
  requestedAt;
  authorization: AuthorizationContextV1;
  monitoringSeriesRef: MonitoringSeriesRefV1;
}

MonitoringSeriesRevisionReadV1 {
  monitoringSeriesRef;
  seriesId;
  projectId;
  projectRevisionRef;
  spatialScopeRef;
  monitoringObject;
  monitoringIndicator;
  parameterCode;
  canonicalUnit;
  unitConversions;
  effectivePeriod;
  recordedAt;
  previousRevisionRef?;
  status: "current" | "superseded";
}

MonitoringSeriesReadResultV1 =
  | { kind: "succeeded"; result: MonitoringSeriesRevisionReadV1 }
  | { kind: "failed"; error: ModuleErrorV1 };
```

查询 Schema 复用 `IdentifierSchema`、`IsoDateTimeSchema`、`AuthorizationContextV1Schema` 和 `MonitoringSeriesRefV1Schema`，并校验查询的工程/调用者与授权上下文一致且含 `engineering-data.read`。投影 Schema 与现有 `MonitoringSeriesRevisionV1Schema` 共享字段 shape、单位换算规则和修订关系校验，避免形成第二套字段约束；它明确删除原修订的 `audit`，只增加 `status`，unknown key 一律拒绝。

在 `service.ts` 导出：

```ts
interface MonitoringSeriesReaderV1 {
  readSeriesRevision(
    query: ReadMonitoringSeriesRevisionQueryV1,
  ): Promise<MonitoringSeriesReadResultV1>;
}
```

`MonitoringRegistryV1` 保持原样。未来 C25 依赖 `MonitoringSeriesReaderV1`，无需获得序列修订写入口和策略登记入口。现有 monitoring `index.ts` 已通配导出 schema/service，package manifest 也已有 `./engineering-data/monitoring` 子路径，因此不增加导出文件。

备选方案是把方法加到 `MonitoringRegistryV1` 或新增 C02 公共端口。前者把只读消费者耦合到 C14 写服务，后者需要修改冻结的 contracts、授权分支和所有实现；当前只有一个明确下游用例，两者都扩大了范围。

### D-02：PostgreSQL 实现只投影既有精确修订

`PostgresMonitoringStoreV1` 增加公开 `readSeriesRevision` 并满足 `MonitoringSeriesReaderV1`。它必须按 `(project_id, series_id, version_id)` 调用/复用 `#readSeriesRevision` 的精确修订读取，不得读取 current 后回退到“最新版”，也不得复制修订到新表。成功后仅从已通过 `MonitoringSeriesRevisionV1Schema` 的对象挑选 D-01 白名单字段。

`status` 只描述读取时的序列 current pointer：当 `business.monitoring_series.current_revision_id` 等于该精确修订的 `revision_id` 时为 `current`，否则为 `superseded`。它不改写 `effectivePeriod`，也不把旧修订视为不存在。状态查询同样同时限定 `project_id` 和 `series_id`；缺少 identity 或无法与精确修订对应时按 D-04 拒绝。

备选方案是把指标和单位复制进 `MonitoringSnapshotV1`。这会修改快照公共 Schema、复制序列事实并使旧快照/调用方迁移，违反本 change 的边界。

### D-03：复用 C06 现有监测读取授权分支

strict 查询通过且精确修订存在后，调用现有 `#verify`：要求 `engineering-data.read`，requested scopes 只含修订的 `spatialScopeRef`，requested source versions 为空。底层继续使用 C06 已有 `engineering-data.monitoring-snapshot-query` 分支做当前 session、工程、成员关系和空间授权复核；这是 contracts 中唯一既有的监测读取分支。

序列修订没有来源版本或监测值，故该入口不请求 source grants。需要样本、证据或特征的消费者仍必须走 `readSnapshot`/`resolveSnapshotQuery`，由该路径校验快照全部空间和来源权限。授权上下文不能由 adapter 扩权或替换。

备选方案是新增 `engineering-data.monitoring-series-query` 分支。它必须修改 C02/C06 contracts 与授权实现，且没有新增能力边界，故不采用。

### D-04：失败保持闭合且不可枚举

处理顺序固定为 strict parse → 精确工程/修订读取 → 当前授权 → 幂等审计 → 返回投影：

- strict query 失败返回 `UNSUPPORTED_CONTRACT`，不进入数据库读取；
- 结构合法但目标缺失、identity 缺失、版本不匹配、跨工程或不存在，统一返回不带目标引用的 `AUTHORIZATION_DENIED`；
- C06 拒绝、session 过期或撤权仍通过既有映射返回 `AUTHORIZATION_DENIED`；
- 同一读取身份异载荷返回 `IDEMPOTENCY_CONFLICT`；
- 数据库瞬态/终态故障沿用 `#mapError`，普通错误不包含指标、单位、修订存在性或 SQL 内容。

不能先返回修订再补授权或审计。错误路径不创建序列、修订、查询投影或领域事件。

### D-05：读取只追加一份 C03 收据和 C07 审计

授权通过后，复用现有 `atomicCommand`、`commit` 和 `TransactionUnitV1.execute`。原子命令固定：

- `commandKind = "engineering-data.monitoring-series-read.v1"`；
- `commandId = queryId`、`idempotencyKey = queryId`；
- canonical payload 包含完整已解析查询，使同键异载荷由 C03 拒绝；
- commit 的 `targetRef`/`resultRef` 均为请求的精确 `MonitoringSeriesRefV1`，`version` 为其精确 reference；
- audit action 为 `engineering-data.monitoring-series-read`，关联 actor、授权上下文、请求时间和读取身份；`events: []`。

事务 handler 不写 C14 领域表。成功返回必须等待收据/审计事务完成；审计失败时事务回滚且读取失败。同载荷重试复用 completed receipt，因而不重复审计。`status` 是每次实际读取时观察到的 current/superseded 状态；幂等保证的是读取身份的收据与审计唯一性，不冻结可变化的 current pointer。

备选方案是新增 series query result 表。直接结果不需要后续解析引用，C03 已持久化足够的读取身份、目标、版本和审计；新表和 migration 只会复制事实。

### D-06：reader 与快照查询各自保持单一职责

一次后续 C25 读取先通过既有快照路径取得 `MonitoringSnapshotV1.monitoringSeriesRef` 及冻结值/特征，再把该精确引用交给 `MonitoringSeriesReaderV1`，核对 C18 mapping 的 `monitoringIndicator + parameterCode`：

- `metric = value` 时 mapping `sourceUnit` 必须与序列 `canonicalUnit` 对齐；
- 特征仍取自快照并使用快照特征的显式单位；reader 不重新计算或返回特征；
- mapping 的 target 转换继续由 C18/C25 所有，不复用或改写 C14 样本入库用的 `unitConversions`。

本 change 不实现上述 C25 组合，只保证合法输入可得。C18 配置治理不需要查询工程实例，C26 应消费 C25 的确定性输出，故没有第二处生产调用方需要接入。

### D-07：文件所有权收敛为五个既有文件

实现只允许修改：

```text
packages/core/src/engineering-data/monitoring/schema.ts
packages/core/src/engineering-data/monitoring/service.ts
packages/core/test/engineering-data/monitoring.test.ts
packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts
packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts
```

core 测试只验证新 strict 查询/投影/结果契约的代表性边界。adapter 测试复用现有真实 PostgreSQL fixture，覆盖精确读取、字段白名单、current/superseded、不可枚举失败、撤权、同载荷重放和同键异载荷；不新增 fixture 或独立测试族。

无需修改 monitoring `index.ts`、package exports、C11 composition、migration、migration 清单、C18/C25 或 contracts。实现若证明必须新增表或 migration，必须停止并向主调度 escalation 申请 `000036` 起的号段，不能自行选号。

### D-08：验证使用仓库现有命令

定向 core Vitest、真实 PostgreSQL adapter Vitest、根 typecheck、改动文件 Prettier、`deps:check`、`deps:policy`、OpenSpec strict validate 和基于固定 base 的 Git 范围核对共同作为完成条件。不得以内存 adapter、Mock 数据库或跳过容器替代 PostgreSQL 证据。

## Risks / Trade-offs

- [复用名为 snapshot-query 的 C06 branch，命名比用途更窄] → 它已是唯一监测读取授权分支且能力仍为 `engineering-data.read`；若未来出现两个以上不同监测读取政策，再单独演进 contracts，不在 C14 旁路授权。
- [`current | superseded` 会随新修订登记变化] → 明确其为读取时状态，精确修订字段和版本引用保持不可变；调用方不得用状态替代精确引用。
- [先读取目标才能取得待校验空间] → 查询始终按工程和精确版本限定，任何缺失/跨工程/无权结果统一拒绝且不返回目标引用；集成测试核对错误结构相同。
- [在读操作上写收据和审计增加一次短事务] → 这是合同要求的追溯成本；事务只写 C03/C07 两张既有表，不新增 projection 或事件。

## Migration Plan

1. 部署包含 core 契约和同一 PostgreSQL store 方法的应用版本；数据库结构与既有数据保持不变，无回填步骤。
2. 用现有 C14 fixture 对一个 current 修订和一个 superseded 修订完成授权、字段白名单、幂等与撤权验收。
3. 后续 C25 通过依赖注入消费 `MonitoringSeriesReaderV1`；本 change 不修改 C25。
4. 回滚只需回退应用代码；新增的通用命令收据和审计仍作为历史事实保留，不删除、不回写。
