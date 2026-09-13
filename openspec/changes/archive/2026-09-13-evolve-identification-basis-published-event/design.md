## Context

动机见 [proposal.md](./proposal.md#why)，行为边界见 [delta spec](./specs/domain/module-interfaces-events-workflows/spec.md)。规划基线为 `8fe4c1f07dd469ed15b7b6da6c4c98292dd476f5`。

当前 `packages/contracts/src/events/index.ts` 以 `eventSchema()` 和 `DomainEventMetadataV1Schema` 组成十个 strict `DomainEventV1` 分支，其中 `knowledge.assessment-basis-published.v1` 已证明知识发布事件的信封与最小引用风格。C03 的 `AtomicCommitV1Schema`、`PostgresOutbox` 和 `PostgresIdempotentConsumer` 通用处理整个事件联合；仓库内没有对事件类型作穷举分派的生产消费者。

C16 每次只发布一个定义类型的一个 `KnowledgeReleaseRefV1`，发布/历史版本重新发布事务可原子保存发布、审计、命令回执和 Outbox。C17 已批准设计把 `process-model`、`risk-mechanism`、`standard-library`、`case-library` 与 `retrieval-evidence-base` 作为五类识别知识，其中检索证据库组合固定机理、规范和案例发布，机理发布再固定工序模型发布。C17 D-11 因 C02 没有识别发布事件而明确提交零 Outbox；C20 当前 proposal 则以该事件作为双索引代际的唯一发布触发。

## Goals / Non-Goals

**Goals:**

- 用一个新 `DomainEventV1` strict 分支表达完整识别知识基础的发布事实，并让 C20 能从事件取得全部精确版本入口。
- 保持 C02 既有事件 envelope、Zod SSOT、C03 原子 Outbox 与至少一次幂等消费语义。
- 固定 C17 后续补充事件发出的事务接缝，避免事件先于可读发布绑定成立。

**Non-Goals:**

- 本 change 不实现事件生产、投递分派、C20 索引或 C17/C16 代码调整。
- 不改变任何既有事件、port、workflow、数据库结构、依赖或导出路径。
- 不为未来知识类型、批量发布或通用事件插件预留抽象。

## Decisions

### D-01：事件名与载荷使用一个闭合发布集合

新增事件名固定为 `knowledge.identification-basis-published.v1`。它复用 `DomainEventMetadataV1Schema`；待新增私有 Schema 固定命名为 `IdentificationBasisPublishedReleasesV1Schema` 与 `IdentificationBasisPublishedPayloadV1Schema`，形状为：

```ts
{
  basisKind: "identification-basis";
  publishedReleases: [
    { definitionType: "process-model"; releaseRef: KnowledgeReleaseRefV1 },
    { definitionType: "risk-mechanism"; releaseRef: KnowledgeReleaseRefV1 },
    { definitionType: "standard-library"; releaseRef: KnowledgeReleaseRefV1 },
    { definitionType: "case-library"; releaseRef: KnowledgeReleaseRefV1 },
    { definitionType: "retrieval-evidence-base"; releaseRef: KnowledgeReleaseRefV1 },
  ];
  retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
}
```

`publishedReleases` 使用固定顺序的五项 tuple，而不是两个按索引对应的数组或开放 map：Schema 本身即可证明类型完整、唯一和规范顺序，每项又保留 C16 可读取的 generic `KnowledgeReleaseRefV1`。payload 追加一次 refinement，要求 `retrievalEvidenceBaseReleaseRef.reference` 与 tuple 中 `retrieval-evidence-base` 的 generic release 使用相同 `entityId/versionId`。所有对象保持 strict。

事件 envelope 固定 `schemaVersion: "1"`、`eventVersion: 1`、`projectId`、`aggregateRef`、双时间、因果/关联、生产命令、业务幂等、授权与 `auditTrailRef`；`aggregateRef` 必须指向 tuple 中新发布的 `retrieval-evidence-base` generic release。工程、审计和契约版本不在 payload 重复。发布引用本身已携带精确版本，不增加裸 `version` 字段。

备选是只发送新组合 release，迫使消费者再次猜测五类成员；或发送正文来减少回查。前者不能在事件边界证明完整发布集合，后者违反最小披露与可重建事实所有权，因此不采用。

### D-02：只有完整检索证据库组合发布才产生事件

`publish-approved-release` 或 `rollback-by-new-release` 成功发布 `retrieval-evidence-base`，且 C17 能沿组合成员与机理包解析出同工程、类型匹配、完整唯一的五类精确发布时，才产生该事件。单独发布工序、机理、规范或案例只更新各自不可变时间线；在新的检索证据库组合获批发布前，不触发 C20 重建。

这与 C20 的投影单位一致：C20 为一个精确检索证据库发布构建代际，不能把尚未由组合选中的成员新版本当作新索引基础。事件中的工序模型引用供识别基础完整追踪；C20 仍只按其职责投影检索成员。

备选是五类任一发布都发送事件并让 C20判断是否可用。这会制造无效重试和“当前组合”选择，破坏精确发布语义，因此不采用。

### D-03：新分支沿用 assessment-basis 事件风格，不改其它事件

实现只在 `DomainEventV1Schema` 的 discriminated union 中追加一个 `eventSchema(...)` 分支，并复用 ports 已有的 `KnowledgeReleaseRefV1Schema` 与 `RetrievalEvidenceBaseReleaseRefV1Schema`。私有 payload/member Schema 不新增公共导出；公开 `DomainEventV1` 继续由联合 Schema 推导。

现有 `knowledge.assessment-basis-published.v1` 及其它九个分支的字段、顺序和校验完全不动。新事件使用相同的 knowledge 命名空间、`basisKind` 判别、generic C16 release 引用、严格对象与 envelope 元数据；差异只来自识别基础是一个闭合组合，而评估事件当前表达单个配置发布。

### D-04：C17 后续必须把发布绑定与事件放入 C16 同一事务

本 change 只建立契约。随后调度端对 C17 做有界补充时，必须沿 C18 已有 release policy 接缝，在 C16 `PostgresKnowledgeGovernanceAdapter.#publish` 和 `#rollback` 的 `TransactionUnitV1` 回调内完成以下动作：

1. 对非 C17 定义返回空事件；对四类成员发布也返回空事件。
2. 对 `retrieval-evidence-base` 读取已验证 revision/package binding，解析三个组合成员及风险机理所引用的工序模型，复验五项同工程、类型、版本和发布有效性。
3. 使用当前 `TransactionContextV1` 先写 `identification_knowledge_release_bindings`，再构造并以 `DomainEventV1Schema.parse` 校验事件，返回给 C16 的 `AtomicCommitV1.events`。
4. 事件 `eventId` 由工程与新 composite release 精确引用稳定派生；其它 envelope 字段直接使用 C16 当前 command、audit、authorization 和双时间。

这一步必须替代 `PostgresIdentificationKnowledgeAdapter.#delegateGovern` 在 C16 成功后另启事务调用 `#bindRelease` 的现状；否则 Outbox 可能先于 C17 `readExact` 所需绑定成立。无需分布式事务、补偿队列或第二个 Outbox。

有界补充的准确落点为：在 `packages/core/src/identification-knowledge/service.ts` 增加 `IdentificationKnowledgeGovernancePolicyV1` 的 release append 输入/方法；在 `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts` 增加实现该方法的 `PostgresIdentificationKnowledgeReleasePolicy`，并复用现有 release binding、package read 与校验 helper；在 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` 的 `PostgresKnowledgeGovernanceAdapterOptionsV1` 增加 `identificationKnowledgePolicy`，由私有 `#appendIdentificationKnowledgeRelease` 在 `#publish`/`#rollback` 中与现有 `#appendAssessmentConfigurationRelease` 合并事件。C17 façade 的 `#delegateGovern` 删除发布成功后的独立 `#bindRelease` 路径；不增加迁移或第二套持久化。

若发布集合、事件 Schema、C17 binding、审计、命令回执或 Outbox 任一步失败，C16 发布事务整体失败或回滚，不返回成功 release。不得保存发布后静默省略事件，也不得以后补发伪装原子提交。

### D-05：至少一次投递由 C03/C20 幂等边界收口

C03 继续按 `eventId` 保存与投递完整事件，`PostgresIdempotentConsumer` 继续按 `(consumerName, eventId)` 和规范摘要处理重复投递。C20 后续以事件身份和业务幂等键收口同一索引代际；同事件同 payload 返回原结果，同 eventId 不同 payload 按现有冲突语义拒绝。

本 change 不增加 broker topic、消费者 registry、轮询或专用 transport。C20 必须通过事件的精确 generic composite release 调用 C17 `IdentificationKnowledgeReleaseReaderV1.readExact`，Qdrant/检索正文不进入事件。

### D-06：兼容性是加法，但生产者必须最后启用

现有十类事件的运行时和 wire shape 不变，新版通用消费者可透明校验、保存和转交新成员。`DomainEventV1` 的静态联合扩大可能暴露下游穷举遗漏，因此运行 contracts 定向编译和根 `pnpm typecheck`；若发现穷举消费者，必须停止并升级范围，不在本 change 修改 contracts 之外的代码。

旧版 strict Schema 会拒绝新事件。部署顺序固定为：先发布并部署新版 contracts 到 Outbox/消费边界，再补充并启用 C17 生产者，最后启用 C20 消费者。回滚 C17/C20 时停止生产/消费新事件并保留已写 Outbox 与发布事实；不回退到无法解析已持久化事件的旧 contracts。

### D-07：两个既有文件完成实现与回归证明

- `packages/contracts/src/events/index.ts`：导入 `RetrievalEvidenceBaseReleaseRefV1Schema`，增加私有 `IdentificationBasisPublishedReleasesV1Schema`、`IdentificationBasisPublishedPayloadV1Schema` 与一个 `DomainEventV1Schema` 分支。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：把“十类事件”表驱动场景扩为十一类；加入合法新事件，以及缺少类型、重复/错位类型、generic/typed composite 引用不一致、正文和未知字段的代表性拒绝断言。测试稳定结构语义，不断言完整错误文案或字段序列化顺序。

不新增测试文件。`packages/contracts/src/ports/index.ts` 和 `packages/contracts/src/workflows/index.ts` 的既有引用已经足够，不修改它们。

## Risks / Trade-offs

- [旧部署仍使用十分支 strict Schema] → 先部署 contracts/通用消费边界，最后启用生产者；不得回退解析能力直到新事件清空或所有消费者升级。
- [C17 当前发布绑定晚于 C16 事务] → 后续 C17 补充把 binding 与事件构造移入同一 release policy 回调，事件成立时 `readExact` 所需事实已经可见。
- [组合成员或机理到工序引用不一致] → 在发布事务内封闭失败，不发送部分集合、不选择最新版、不让 C20 自行修复。
- [固定五项 tuple 将来需要第六类识别知识] → 另开契约演进并升级事件版本；当前不预留开放数组或自由类型。
- [C20 工件在本次规划期间并行生成] → 已读取其当前 proposal；该工件只确认事件作为前置和 composite 发布为投影单位，未对 payload 作冲突规定。

## Migration Plan

1. 先交付本 change 的 contracts 分支与测试，执行 contracts 编译/事件测试、workspace typecheck 和 strict OpenSpec 校验。
2. 调度端对 C17 的设计/施工图/任务做有界补充，再按 D-04 把 composite release binding 与事件加入 C16 发布/回滚事务；用真实 PostgreSQL 断言 Outbox 原子性和失败回滚。
3. C17 事件生产验收后，C20 才能实现幂等消费、双索引旁路构建与代际切换。
4. 回滚应用时先停 C17 新事件生产与 C20 消费，保留不可变发布、绑定、审计和 Outbox；不需要数据库迁移或数据回填。
