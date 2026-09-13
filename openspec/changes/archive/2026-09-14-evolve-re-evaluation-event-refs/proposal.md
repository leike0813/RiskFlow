## Why

当前 `engineering.assessment-input-changed.v1` 的 monitoring-snapshot 分支要求前后两个数组同时出现，并允许空数组；C25 已批准设计却要求空侧省略，公共 Schema 因而无法表达其约定的纯新增和纯删除载荷。该冲突已阻塞 C25 独立验证，需在 C25 归档前以独立公共契约 change 收口。

## What Changes

- **BREAKING**：把 `previousMonitoringSnapshotRefs` 与 `newMonitoringSnapshotRefs` 改为可选非空精确引用数组；纯新增只提供 `newMonitoringSnapshotRefs`，纯删除只提供 `previousMonitoringSnapshotRefs`，替换同时提供两侧。
- 要求 monitoring-snapshot 分支至少提供一侧；拒绝两侧均缺及任何显式空数组，不把“没有变化”编码为领域事件。
- 保持 `AssessmentInputChangedPayloadV1Schema`、`DomainEventV1Schema`、事件元数据、`reasonCode`、applicability-metadata 分支和其它事件不变，并继续使用 strict 对象拒绝未知字段。
- 扩展现有 contracts 事件测试，覆盖纯新增、纯删除、替换、两侧皆缺和未知字段；不新增测试文件。
- C25 在本 change 归档后按既有批准设计机械适配：生产者省略空侧，集成测试使用真正的空集合边界。未来重评估消费者把缺失侧解释为空集合。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：收紧评估输入变化事件的 monitoring-snapshot 分支，使字段存在性直接表达新增、删除和替换，并拒绝无变化载荷。

## Impact

- **公共契约**：`packages/contracts/src/events/index.ts` 的私有 `AssessmentInputChangedPayloadV1Schema` 及由 `DomainEventV1Schema` 推导的公开 `DomainEventV1` 类型。
- **契约测试**：`packages/contracts/test/module-interfaces-events-workflows.test.ts` 的 `domain events` 用例；复用现有事件元数据和监测快照引用夹具。
- **现有通用链路**：`packages/core/src/persistence/schema.ts`、`packages/core/src/persistence/idempotent-consumer.ts`、`packages/adapters/src/postgres/transaction-unit.ts`、`packages/adapters/src/postgres/outbox.ts` 与 `packages/adapters/src/postgres/idempotent-consumer.ts` 只解析、持久化或转交完整 `DomainEventV1`，不读取两字段，无需改动。当前 apps/api SSE、apps/web SSE、apps/worker 和 JSON-LD 路径均不投影或消费该事件载荷。
- **C25 适配**：尚未合并的 `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 是首个生产者，需让 `event` 的 monitoring-snapshot 类型允许两字段可选，并在构造 change 时仅展开非空侧；其 `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` 需把“纯新增/纯删除”改为一侧监测集合真正为空并断言空侧字段不存在。该适配属于 C25 自有文件，不纳入本 change 的固定-base 实现范围。
- **后续 change**：C26 只消费 `assessment.recorded.v1`，C28 只消费处置前后冻结快照与反馈事实，均无直接改动；C30 规划中的重评估事件消费者必须按 `previousMonitoringSnapshotRefs ?? []` / `newMonitoringSnapshotRefs ?? []` 读取缺失侧。
- **依赖与数据**：不新增、升级或删除依赖，不新增迁移，不回填历史数据，不修改其它事件、应用或部署配置。
