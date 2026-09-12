## Why

C02 已声明 `EngineeringDataPortV1.apply(register-external-risk-event)`，但 C11 PostgreSQL composition 仍将该分支落入 `UNSUPPORTED_CONTRACT`；C25 因而无法取得可授权、可追溯的 `ExternalRiskEventRefV1` 来满足风险输入 XOR 的 external 分支。现在需要在 C11 既有所有权内补齐这一遗漏，而不演进公共契约。

## What Changes

- 在 `PostgresEngineeringContextSourceRegistry.apply` 中实现既有 `register-external-risk-event` 分支，保留 `register-source-delivery`、监测委派和其它 unsupported 兜底行为。
- 将外部风险事件登记为 C11 单一、不可变事实，固定外部来源精确版本、工程、由证据资料段确定的空间范围与来源资料版本、事件工件引用、证据引用及双时间信息；正文只保存在 C04 工件中，不增加自由 metadata。
- 在读取任何证据目标前按精确公共分支复验 C06 工程、空间和资料授权；缺失、跨工程、越权、非就绪资料或不匹配资料段统一返回不可枚举的类型化拒绝。
- 复用 C03 `(projectId, commandKind, idempotencyKey)`、strict 规范载荷摘要、命令收据和 C07/C03 只追加审计，在一个 PostgreSQL 事务内提交事件事实、收据和审计。同键同载荷重放原引用，同键异载荷冲突；当前没有适用的既有外部事件登记 Domain Event，因此事务不产生 Outbox 事件。
- 新增 C11 PostgreSQL migration 与真实 PostgreSQL 回归覆盖；不增加依赖。

## Non-Goals

- 不修改其它 `apply`、`freeze` 或 `read` 分支，不改变其委派或 unsupported 行为。
- 不修改 `packages/contracts/**`、C25/C19/C15 生产代码、应用层、既有 migration、migration provider/runner、根 workspace、锁文件、依赖政策或 `openspec/config.yaml`。
- 不实现 C25 的评估准备/评分、C19 的知识能力、C15 的清洗能力、外部系统连接器、查询投影、第二套外部事件注册表或 fixture 驱动的生产数据来源。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/engineering-context-source-registry`: 在既有 C11 授权、幂等、不可变事实和原子审计边界内，补充 C02 已声明的外部风险事件登记行为。

## Impact

- **公共分支与兜底**：`packages/contracts/src/ports/index.ts` 已定义 `RegisterExternalRiskEventPayloadV1Schema`、`EngineeringDataApplySuccessV1Schema`、`ExternalRiskEventRefV1Schema` 及 `engineering-data.register-external-risk-event → engineering-data.write`；`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` 的 `apply` 当前仅委派监测批次、处理来源交付，其余分支统一返回 `UNSUPPORTED_CONTRACT`。
- **C25 消费接缝**：同一 contracts 文件的 `RiskInputVersionRefV1Schema` 和 `assessment-preparation` freeze 载荷、`packages/contracts/src/workflows/index.ts` 的 assess/historical-backfill 与 `AssessmentPreparationSnapshotV1Schema` 已接受 `ExternalRiskEventRefV1`；后续 C25 只消费本 change 返回的精确引用，不读取 C11 表或复制事件字段。
- **待实现代码**：仅修改 C11 PostgreSQL composition 及其真实 PostgreSQL 测试、原样复用现有 fixture，并新增预留号段内的 C11 migration；中央递归迁移发现无需生产注册，`packages/adapters/test/postgres/postgres-foundation.test.ts` 的测试 manifest 登记由主调度追加。
- **依赖与事件**：沿用已安装的 Kysely、PostgreSQL、Zod、C03/C04/C06/C07 能力；不新增、升级或删除依赖，不新增 Domain Event 类型。
