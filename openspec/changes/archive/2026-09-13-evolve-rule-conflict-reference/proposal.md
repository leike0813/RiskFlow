## Why

C02 已允许以 `reviewType=rule-conflict` 对规则冲突精确版本发起复核，但同一目标不属于 `ContractReferenceV1` 的闭合集合。C19 因而能检测并保存未决冲突，却无法让 C07 为该目标完成事件、审计与复核链接落库，唯一缺失的验收断言只能暂时期待链接数为 `0`。

## What Changes

- 在 C02 公共引用中增加命名的规则冲突引用，形状只含 `kind: "rule-conflict"` 与现有 `VersionReference`，不携带冲突正文、规则正文或自由字段。
- 让 `ReviewTargetRefV1`、`reviewType=rule-conflict` 的 `ReviewTaskRefV1` 与 `ContractReferenceV1` 复用同一规则冲突引用 Schema，消除当前两处内联重复，同时保持既有复核决定和目标匹配语义不变。
- 扩展既有 contracts 行为测试，验证规则冲突引用可进入公共引用、复核请求和复核事件，并继续拒绝缺失版本或附带正文/未知字段的输入。
- 为 C19 恢复“冲突审阅链接以 `status=pending` 落库”的断言提供明确下游指引；本 change 不修改或实现 C19。

### Non-goals

- 不实现或修改 C19 的冲突检测、关系记录、复核任务创建或链接持久化逻辑。
- 不修改 C07 复核运行时、事件适配器、审计、事务或数据库结构。
- 不修改 `ReviewTypeV1`、`KnowledgeDefinitionTypeV1` 或其它既有枚举，也不改变任何既有 `ContractReferenceV1` kind 的语义。
- 不新增第二套规则冲突模型，不修改 records DTO、apps、迁移、根 workspace、锁文件、依赖政策、依赖或 `openspec/config.yaml`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 明确闭合公共引用必须接纳与既有 `reviewType=rule-conflict` 一致的规则冲突精确版本，使复核请求、事务事件与审计持久化可以引用同一目标。

## Impact

- **公共契约与测试**：修改 `packages/contracts/src/ports/index.ts` 和 `packages/contracts/test/module-interfaces-events-workflows.test.ts`；`packages/contracts/src/common/index.ts` 的 `VersionReferenceSchema` 及 `packages/contracts/src/records/index.ts` 保持不变。
- **`ContractReferenceV1` 直接消费面**：公共端口和事件中的错误目标/阻断引用、Agent 输入输出、工作流状态、投影/导出、复核请求/追溯与事务事件；core 的 access、agent-runtime、artifacts、assessment-config、context-source、knowledge-governance、persistence、review-audit；adapters 的 agent-runtime、artifacts、assessment-config、auth、context-source、monitoring、knowledge-governance、checkpointer、review-audit；API/Web 的 HTTP 解码、安全错误、确认交互和引用展示，以及相应现有测试。新增分支与既有引用具有相同 `{ kind, reference }` 结构，消费者无需新增字段或迁移；类型检查负责发现任何遗漏的闭合分支处理。
- **C07 使用方式**：`ReviewAuditPortV1.requestReview` 已接受规则冲突目标，C07 在 `review.review-requested.v1.payload.targetRef`、审计/拒绝记录和追溯投影中把目标作为 `ContractReferenceV1` 保存；新增 kind 使这些既有路径通过 Schema 校验，不改运行时实现。
- **C19 使用方式**：`ScoringRulesConflictReviewLinkerV1.ensureConflictReviewTask` 以 `rule-relation:<relationId>@1` 发起 `rule-conflict` 复核；契约闭合后，既有 `PostgresScoringRulesAdapter.#ensureConflictReviewLinks` 可继续执行 `#appendReviewLink` 并保存 `status=pending`。
- **依赖、所有权与追踪**：不新增或升级依赖；只演进 C02 contracts 所有权，不侵入 C07/C19 所有权。该引用闭合支撑 RA-S3/RA-S4 的规则冲突人工复核与不可变版本追踪，不改变发布决定归属。
