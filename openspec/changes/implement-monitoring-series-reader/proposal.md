## Why

C18 已用 `monitoringIndicator + parameterCode` 和 `canonicalUnit` 固定监测字段映射，但 C14 目前只公开快照正文解析，序列修订正文仍由 PostgreSQL adapter 私有读取。后续 C25 因而无法在当前授权约束下核对快照所引用序列的身份、指标和单位，必须在 C14 所有权内补一个精确、有界且可审计的序列修订读取入口。

## What Changes

- 在 C14 core 导出独立的 `MonitoringSeriesReaderV1` 窄接口及 strict 查询、投影和结果 Schema；输入固定精确 `MonitoringSeriesRefV1`、工程/调用身份、请求时间与 C06 授权上下文。
- 由现有 `PostgresMonitoringStoreV1` 实现该接口，复用私有精确修订读取、C06 当前授权、C03 幂等收据和 C07 只追加审计，不复制 `monitoring_series_revisions` 事实或建立第二套序列注册。
- 成功投影只返回序列/修订身份、工程与空间版本引用、监测对象、`monitoringIndicator`、`parameterCode`、`canonicalUnit`、显式单位换算、有效期、记录时间、前序版本和 `current | superseded` 状态；不返回样本值、对齐点、特征、来源正文或自由字段。
- 对结构合法但缺失、撤权、跨工程、不存在或版本不匹配的目标统一返回不可枚举的 `AUTHORIZATION_DENIED`；同一读取身份同载荷重试只产生一份收据和审计，同键异载荷保持既有 `IDEMPOTENCY_CONFLICT`。

### Non-goals

- 不修改 `MonitoringSnapshotV1`、既有 C14 Schema 的快照字段或任何 `packages/contracts/**` 公共 DTO、引用、端口、分支和记录。
- 不修改既有 `000011` migration，也不新增 migration、迁移 provider/runner、中央迁移注册或测试清单。
- 不修改 C18/C25 生产代码、`apps/**`、根 workspace、锁文件、依赖政策、`openspec/config.yaml`、主 specs 正文、归档 change 或其它活动 change。
- 不增加依赖，不提供原始监测序列值、快照值、特征查询、列表/模糊查找、通用 repository 或第二套序列注册。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/monitoring-batches-snapshots-features`: 增加按精确序列修订引用执行当前授权校验并返回有界身份/指标/单位投影的只读能力，以及不可枚举失败、幂等收据和只追加审计要求。

## Impact

- **现有公开入口**：保留 `EngineeringDataPortV1.read(monitoring-snapshot)` 与 `MonitoringRegistryV1.resolveSnapshotQuery` 的快照值/特征职责；新增 reader 与它们并列，不改变返回的 `MonitoringSnapshotV1`，也不进入 C02 公共端口。
- **真实调用方**：base commit `01b2df23194c6203a1104fa2c898e266109d8365` 中，C18 仅在 `packages/core/src/assessment-config/` 定义和校验字段映射，尚无 C25 生产实现；预定首个消费者是 C25 的监测指标取值流程。C26 应消费 C25 已核验的指标/预警输入，不需要第二个序列读取入口。
- **计划代码范围**：修改 `packages/core/src/engineering-data/monitoring/{schema,service}.ts`、`packages/core/test/engineering-data/monitoring.test.ts`、`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts`、`packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts`。现有 monitoring `index.ts`、package exports 和 fixture 已可复用，无需修改。
- **依赖与追踪**：复用 C03、C06、C07、C14 及现有 Zod/Kysely/PostgreSQL；不新增依赖。该读取能力保持 RI-S14、RI-S21、RI-S43 与 RA-S1、RA-S5、RA-S6 所需的精确版本、权限、指标和单位追溯。
