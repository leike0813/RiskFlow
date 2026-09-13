## Why

`AssessmentPreparationSnapshotV1Schema` 已要求保存入口模式、触发原因以及可选的前次评估和因果运行引用，但创建该快照的 `assessment-preparation` 命令 payload 没有这些字段，C25 无法从唯一合法来源构造可重放的 A0 快照。同时，命令只有可选截止点、快照和评估输入变化事件都只容纳单个监测快照，无法覆盖 C18 字段映射、监测阈值和联合规则可能涉及的多个监测序列。C25 与该事件的生产者尚未实现，当前修正可以在首个生产者出现前闭合三处契约缺口。

## What Changes

- **BREAKING**：为 strict `AssessmentPreparationCommandPayloadV1Schema` 增加必填 `entryMode: WorkflowEntryModeV1Schema` 与 `triggerReasonCode: IdentifierSchema`，并增加可选 `previousAssessmentRecordRef: RiskAssessmentRecordRefV1Schema` 与 `causalRunRef: WorkflowRunRefV1Schema`。
- 要求未来 C25 调用方显式传入入口模式和触发原因；不得从 `riskInput` 分支或其它上下文推导，也不得设置默认值。
- **BREAKING**：将该 payload 的可选 `monitoringCutoff` 替换为 `monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional()`，并将 `AssessmentPreparationSnapshotV1Schema.monitoringSnapshotRef` 替换为同形状的 `monitoringSnapshotRefs`。
- 未提供 `monitoringSnapshotRefs` 表示本次评估不使用监测输入；提供时必须非空，并由调用方预先通过 `engineering-data.freeze(monitoring-snapshot)` 为每个序列形成已授权精确快照。C14 的单序列快照事实模型保持不变。
- **BREAKING**：将 `engineering.assessment-input-changed.v1` 的 monitoring-snapshot 分支改为 `previousMonitoringSnapshotRefs` 与 `newMonitoringSnapshotRefs` 两个精确引用数组；两侧均允许为空，以表达新增、删除或多个序列同时变化。
- 事件只传递前后精确快照引用和既有原因码，不携带监测正文，也不创建平行于 C14 快照的第二套变更事实。
- 复用现有四个 Schema 作为字段唯一事实源；为满足模块初始化顺序，只前移既有 `WorkflowEntryModeV1` 值、Schema 与派生类型，不复制定义。
- 更新现有 contracts 参数化测试夹具，验证新增必填字段、两个可选引用、多监测快照集合、事件新增/删除/多序列变化形状与 strict 拒绝行为。
- 不修改其它 payload、`RiskInputVersionRefV1Schema`、`AssessmentInputSnapshotV1Schema`、C14/C18 事实模型或应用代码，不新增依赖或迁移。

## Capabilities

### New Capabilities

无。本变更收紧已有评估准备入口契约，不引入新的领域能力。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：补充评估准备命令与 A0 快照必须显式保存入口/触发语义，以可选非空集合引用多个按序列冻结的监测快照，并由评估输入变化事件用前后引用集合表达多序列增删改。`domain/contract-kernel` 只规定风险输入 XOR 与公共 Schema SSOT，不需要修改。

## Impact

- **契约所有权与追踪**：变更属于 `packages/contracts` 的工程数据 freeze 命令契约，闭合 C25/A0 的 RA-S1 输入追踪；未来 C25 是首个真实 `assessment-preparation` payload 生产者。
- **直接定义与类型引用**：`packages/contracts/src/ports/index.ts` 中的 `AssessmentPreparationCommandPayloadV1Schema`、`EngineeringFreezeCommandV1Schema`、派生 `EngineeringFreezeCommandV1` 以及 `EngineeringDataPortV1.freeze` 会反映新增字段。
- **快照定义与引用**：`packages/contracts/src/workflows/index.ts` 中 `AssessmentPreparationSnapshotV1Schema` 的单数监测引用改为可选非空集合；`AssessmentInputSnapshotV1Schema` 仍只引用准备快照，无需改动。仓库内没有其它代码直接消费 `AssessmentPreparationSnapshotV1` 正文。
- **现有测试生产者/消费者**：`packages/contracts/test/module-interfaces-events-workflows.test.ts` 当前构造唯一的 `assessment-preparation` 命令夹具和唯一的评估准备快照夹具，必须显式补齐必填字段，并覆盖无监测、多监测、空集合和旧字段拒绝行为。
- **运行时通用消费点**：`apps/api/src/http.ts` 使用 `EngineeringFreezeCommandV1Schema` 校验并把该分支透传给 `EngineeringDataPortV1.freeze`；无需改动。`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` 校验整个 union，但尚未实现评估准备分支；无需改动。`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts` 只消费 monitoring 分支；其测试与 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 均不构造评估准备 payload，无需改动。
- **事件定义与消费点**：`packages/contracts/src/events/index.ts` 的私有 `AssessmentInputChangedPayloadV1Schema` 和公开 `DomainEventV1Schema` 派生类型会反映复数字段；现有 contracts 事件夹具必须更新。仓库内没有该事件的专用生产者或消费者；`packages/core/src/persistence/schema.ts`、`packages/core/src/persistence/idempotent-consumer.ts`、`packages/adapters/src/postgres/outbox.ts` 与 `packages/adapters/src/postgres/idempotent-consumer.ts` 仅通用校验、保存或转交 `DomainEventV1`，无需改动。其它 adapter 只生产该联合的不同事件分支。
- **C14/C18 边界**：`MonitoringSnapshotV1Schema` 继续让每个快照固定一个 `monitoringSeriesRef`；C18 的字段映射、监测阈值与多指标联合规则保持不变。评估准备只聚合多个精确快照引用，不复制监测事实。
- **兼容性结论**：新增必填字段、删除 `monitoringCutoff`、快照字段由单数改为多数，以及事件字段复数化均属于契约级不兼容；仓库内没有已实现的评估准备生产者、快照正文消费者、该事件生产者/专用消费者或迁移范围，唯一现有命令、快照和事件夹具随变更更新，因此当前交付影响可控。
