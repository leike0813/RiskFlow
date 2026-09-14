## Why

RiskFlow 的事务领域事件目前只声明评估依据发布，C17 因缺少识别知识发布事件只能按已批准 D-11 写入零 Outbox，C20 也就没有可靠、幂等的双索引构建触发。需要先以最小 contracts 演进补齐这个跨模块事实边界，使完整识别知识基础经 C16 治理发布后能由 C20 按精确版本消费。

## What Changes

- 向 `DomainEventV1` 增量加入 `knowledge.identification-basis-published.v1`，保持既有事件信封、版本、审计、命令与幂等语义不变。
- 事件只在 `retrieval-evidence-base` 发布或历史版本重新发布形成完整识别知识基础时表达发布事实；载荷固定五类识别知识的定义类型及精确 `KnowledgeReleaseRefV1`，并携带精确 `RetrievalEvidenceBaseReleaseRefV1`，不含知识正文、证据正文、检索片段或自由字段。
- 扩展 contracts 事件行为测试，证明新分支可解析、五类发布集合闭合且唯一、组合引用一致，并拒绝缺项、重复、错类型、正文和未知字段。
- 明确 C17 后续须在 C16 发布事务内将该事件与发布事实、审计、命令回执原子写入 Outbox；C20 以至少一次、幂等方式消费该事件并构建双索引，但两端生产实现均不属于本 change。

### Non-goals

- 不修改其它 `DomainEventV1` 分支、ports、workflows 或既有 payload。
- 不修改 C16 生命周期实现，不在本 change 实现 C17 事件发出或 C20 索引投影。
- 不修改 core、adapters、apps、迁移、根 workspace、锁文件、依赖政策、`openspec/config.yaml`、主 specs 正文或其它 change；不新增依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 在既有事务领域事件边界中补充受治理识别知识基础已发布事实，并保持只传精确引用、原子 Outbox 与幂等消费约束。

## Impact

- **公共契约与测试**：后续实现仅修改 `packages/contracts/src/events/index.ts` 的 `DomainEventV1Schema` 分支及 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的事件表驱动夹具和拒绝场景；`DomainEventV1` 派生类型将增加一个成员。
- **既有消费者**：`packages/core/src/persistence/schema.ts`、`packages/core/src/persistence/idempotent-consumer.ts`、`packages/adapters/src/postgres/outbox.ts` 与 `packages/adapters/src/postgres/idempotent-consumer.ts` 通用校验、持久化或转交整个联合；现有 knowledge-governance、assessment-config、review-audit、engineering-data 生产者和相关 fixture 只构造其它分支。仓库内没有按该新事件专门分支的消费者或穷举 switch，预期无需修改；workspace typecheck 负责发现漂移。
- **出站路径**：C17 后续发布策略须复用 C18 已采用的 C16 事务内 `appendRelease` 模式，在 `publish-approved-release` 与 `rollback-by-new-release` 成功事务中返回该事件，由 C03 `AtomicCommitV1.events` 写入 Outbox；任何事件构造、审计或 Outbox 失败都使发布事务失败或回滚。
- **依赖关系**：本契约演进解除 C17 D-11 的零 Outbox 决策前提，并成为 C20 `deliver-versioned-dual-index-hybrid-retrieval` 的实现前置；C17 仍拥有知识发布事实与精确读取，C20 只拥有可重建索引投影。
- **兼容性**：这是联合合法输入集合的增量扩展，既有事件 wire shape 不变；旧版 strict 消费者会拒绝新事件，因此部署顺序必须先升级共享 contracts 与通用消费边界，再启用 C17 生产者和 C20 消费者。
