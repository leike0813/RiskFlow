## Why

C11 与 C14 目前只校验命令/查询声明主体和其携带的授权快照主体相同，多数路径没有把该声明主体与 C06 `verify` 返回的已验证主体比对。调用方因此可以同时伪造载荷与快照中的 `actorId`，把伪造主体写入领域事实、查询结果、命令收据和审计；本 change 在既有模块所有权内封闭这条越权路径。

## What Changes

- 在 C11、C14 既有私有授权验证入口中，将命令或查询声明主体与 C06 返回的 `AuthorizationDecisionV1.context.actorId` 比对；不一致统一返回既有不可枚举 `AUTHORIZATION_DENIED`，且发生在任何领域事实、查询结果、命令收据或业务审计写入前。
- 让获准写入及审计只使用已验证授权决定中的主体；命令/查询 `actorId` 与 `authorization.actorId` 继续作为必须一致的声明，不成为第二个主体事实源。
- 将 C14 `readSeriesRevision` 已有的调用点局部比对收口到共享 `#verify`，使同模块全部写、读和 resolve 路径使用同一规则，不新增授权层。
- 扩展两份既有真实 PostgreSQL 测试，证明伪造主体得到同类授权拒绝且不产生事实、查询结果、收据或业务审计，合规主体仍成功并记录已验证主体。
- 不修改公共 contracts、现有迁移、migration provider/runner、中央迁移注册与测试清单、应用层、依赖、根 workspace 或锁文件。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/engineering-context-source-registry`: 明确 C11 的命令、查询及 resolve 声明主体必须等于 C06 当前验证结果主体，拒绝不可枚举，持久化与审计主体只来自验证结果。
- `domain/monitoring-batches-snapshots-features`: 明确 C14 的序列、策略、批次、快照、查询及 resolve 声明主体必须等于 C06 当前验证结果主体，拒绝不可枚举，持久化与审计主体只来自验证结果。

## Impact

### C14 调用点与写入证据

`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts` 的全部 `#verify` 调用点如下：

- `reviseSeries`：写入 `monitoring_series_revisions.actor_id`，并经 `commit` 写命令收据与审计。
- `registerAvailabilityPolicy`：写入 `monitoring_availability_policies.actor_id`，并经 `commit` 写命令收据与审计。
- `registerBatch`：目标序列校验后、样本来源解析后各调用一次；写入 `MonitoringBatchV1.audit.actorId`、`monitoring_batches.actor_id`、命令收据与审计。
- `freezeSnapshot`：在 repeatable-read 事务内按已选样本来源调用；写入 `MonitoringSnapshotV1.audit.actorId`、`monitoring_snapshots.actor_id`、命令收据与审计。
- `readSnapshot`：写入 `monitoring_snapshot_query_results.requested_by`，并经 `commit` 写命令收据与审计。
- `resolveSnapshotQuery`：在返回已保存的 `requested_by` 与审计投影前复验当前主体，无新增写入。
- `readSeriesRevision`：当前已在调用点比对 `verified.context.actorId` 并以该值提交收据与审计；本 change 将其并入 `#verify`，作为其它路径复用的既有证据。

### C11 调用点与写入证据

`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` 的全部验证调用点如下：

- `#verify` 写路径：`reviseContext`；`registerSegments`；`createApplicabilitySnapshot`；`#registerSourceDelivery` 在读取元数据前和首次领域事务后各一次。它们分别可到达工程/空间修订、资料段集合、适用性快照、资料项/交付/资料版本与权限收口，并通过共享 `atomicCommand`/`commit` 把 `command.actorId` 写入收据和审计；具体行还包括各修订/集合/快照/资料项的 `actor_id` 及来源权限命令的 `registeredByAccountId`。
- `#verifyRead` 读取路径：`resolveSourceProcessingInput`、`resolveSourceVersionForRead`；`#readSourceSegments` 的存在性前置与精确目标复验；`#readEvidenceAccess` 的来源声明前置与精确目标复验；`resolveReadQuery` 的结果引用前置复验；`#projectReadQuery` 对 `source-segments` 或 `evidence-access` 精确目标的分支复验。
- `#readSourceSegments` 与 `#readEvidenceAccess` 成功后会由 `#registerReadQuery` 写入 `engineering_data_read_query_results.requested_by`，并经共享 `atomicCommand`/`commit` 写命令收据与审计；resolve 只返回投影，不新增事实。

影响限于既有 C11/C14 adapter 私有控制流及两份既有 PostgreSQL 测试。RI-S14 与 RA-S1 的授权和审计追踪被收紧；公共 API、Schema、持久化结构、幂等键、事务边界与依赖图不变。
