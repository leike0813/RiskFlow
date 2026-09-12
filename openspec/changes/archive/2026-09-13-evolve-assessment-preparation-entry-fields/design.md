## Context

参见 [proposal.md](./proposal.md) 的动因。本设计以 base commit `01b2df23194c6203a1104fa2c898e266109d8365` 为代码事实源，并落实 delta spec 中“评估准备入口显式冻结入口语义与多序列监测引用”的要求。

当前契约存在三处断点：

- `packages/contracts/src/ports/index.ts` 的 `AssessmentPreparationCommandPayloadV1Schema` 没有 A0 快照已经要求的入口/触发字段，且只有可选 `monitoringCutoff`。
- `packages/contracts/src/workflows/index.ts` 的 `AssessmentPreparationSnapshotV1Schema` 只有可选单数 `monitoringSnapshotRef`；C14 `MonitoringSnapshotV1Schema` 的每个快照固定一个 `monitoringSeriesRef`，而 C18 字段映射、监测阈值和联合规则可以涉及多个指标与参数码。
- `packages/contracts/src/events/index.ts` 的 `engineering.assessment-input-changed.v1` monitoring-snapshot 分支只有单数前后引用，不能表达序列新增、删除或多序列同时变化。

仓库内没有构造评估准备命令、保存评估准备快照或生产/专用消费该事件的生产实现。现有运行时引用均为通用边界：API 校验并转发 `EngineeringFreezeCommandV1`，工程数据 adapter 校验该 union 但只实现 monitoring freeze，持久化与 Outbox 只通用处理 `DomainEventV1`。唯一具体对象由 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 构造。

## Goals / Non-Goals

**Goals:**

- 让评估准备命令成为 A0 入口模式、触发原因、前次评估和因果运行的唯一显式输入来源。
- 让命令与准备快照用相同的可选非空监测快照引用数组表达零个或多个已冻结序列输入。
- 让评估输入变化事件用前后引用数组表达监测序列新增、删除和多序列变化，同时只传递精确引用。
- 保持 Zod Schema、派生 TypeScript 类型和公开 union 为单一事实源，并让旧字段由 strict 契约拒绝。

**Non-Goals:**

- 不实现 C25、评估图节点、事件生产者或重评估消费者。
- 不修改 C14 单序列监测快照、C18 配置、`RiskInputVersionRefV1Schema`、`AssessmentInputSnapshotV1Schema`、其它命令/工作流 payload 或应用代码。
- 不增加持久化字段、数据迁移、默认值、字段推导、监测正文复制、依赖或兼容旧载荷的双读分支。

## Decisions

### D-01 评估准备命令显式携带 A0 入口语义

`AssessmentPreparationCommandPayloadV1Schema` 保留现有风险输入、工程修订、空间范围和适用性快照引用，并新增：

```text
entryMode: WorkflowEntryModeV1Schema
triggerReasonCode: IdentifierSchema
previousAssessmentRecordRef?: RiskAssessmentRecordRefV1Schema
causalRunRef?: WorkflowRunRefV1Schema
```

`entryMode` 与 `triggerReasonCode` 必填；C25 将来必须由实际入口显式提供并原样写入准备快照。两个可选引用只在调用方提供时传递，本 change 不增加基于 `entryMode`、`riskInput` 或授权上下文的推导、默认或交叉字段规则。

选择这一方案是因为命令是创建 A0 准备快照的直接输入边界。备选方案“从风险输入种类或工作流上下文推导”会产生第二套隐式规则，无法可靠区分初评、重评和历史补录，故不采用。

### D-02 调用方先逐序列冻结，评估准备只聚合精确引用

删除评估准备 payload 的 `monitoringCutoff`，并在命令与 `AssessmentPreparationSnapshotV1Schema` 中统一使用：

```text
monitoringSnapshotRefs?: z.array(MonitoringSnapshotRefV1Schema).min(1)
```

字段缺失明确表示本次评估不使用监测输入；字段存在时至少有一个精确快照引用。调用方负责先通过既有 `engineering-data.freeze(monitoring-snapshot)` 分支为每个所需序列冻结快照，未来 C25 在创建准备快照前按命令授权上下文校验每个引用，并原样冻结引用数组。Schema 不根据截止点自动选取序列，不读取或复制监测正文。

选择“多个单序列快照引用”是为了复用 C14 既有事实模型和授权/版本边界。备选方案“把 C14 快照改成多序列”会扩大 C14 持久化、算法与查询契约；备选方案“保留截止点并由 C25 查找全部序列”会引入隐式动态输入，两者均超出本 change 且降低可重放性。

### D-03 变化事件保存前后引用数组，不建立变化事实副本

`AssessmentInputChangedPayloadV1Schema` 的 monitoring-snapshot 分支改为：

```text
previousMonitoringSnapshotRefs: MonitoringSnapshotRefV1[]
newMonitoringSnapshotRefs: MonitoringSnapshotRefV1[]
```

两个数组各自允许为空：前空后非空表示新增，前非空后空表示删除，两侧非空可表达替换或多个序列同时变化。事件继续携带既有 `reasonCode`，strict payload 不允许样本、特征、监测序列正文或任意变化明细。未来生产者只从已经成立的 C14 快照引用构造事件，未来重评估消费者以两组引用判断需重评估的输入；事件本身不是新的监测事实。

选择前后完整引用数组，而不是新增 added/removed/changed 三组差异字段，是因为前后集合已经足以表达三类变化，额外差异字段会形成需保持一致的第二套变更事实。

### D-04 前移既有入口枚举定义以保持单一事实源和初始化安全

`WorkflowEntryModeV1Schema` 当前在 `AssessmentPreparationCommandPayloadV1Schema` 之后声明。实现时在同一文件内把 `WorkflowEntryModeV1_VALUES`、`WorkflowEntryModeV1Schema` 与派生类型整体前移到首次使用之前，并删除原位置定义；不复制枚举、不内联第二个 `z.enum`、不使用延迟包装规避声明顺序。

前移不改变公开名称或接受值，只解决新增直接引用的模块初始化顺序。内联或复制定义更短但违反 SSOT，故不采用。

### D-05 契约级不兼容由当前无生产者事实收口

| 契约变化 | 当前具体生产/消费点 | 处理 |
| --- | --- | --- |
| 评估准备命令新增两个必填、两个可选字段并删除 `monitoringCutoff` | 无生产实现；contracts 中一个命令夹具 | 更新夹具；旧形状由 strict Schema 拒绝 |
| 准备快照单数监测引用改为可选非空数组 | 无正文生产/消费实现；contracts 中一个快照夹具 | 扩展同一夹具覆盖无监测、多监测和空数组 |
| 评估输入变化事件单数前后引用改为数组 | 无该分支生产者或专用消费者；contracts 中一个事件夹具 | 更新夹具并覆盖新增、删除、多序列和旧字段拒绝 |
| 公开 union 派生类型变化 | API、工程数据 adapter、持久化、Outbox 与幂等消费者均通用处理 | 依靠同一 Schema/派生类型自动收紧，无需修改这些文件 |

未来 C25 是评估准备命令与快照的首个具体消费方，必须直接面向新契约实现。未来该事件的生产者和重评估消费者必须直接面向复数字段实现。由于仓库内没有旧生产者、旧专用消费者或已持久化该事件的合法来源，不增加版本并存、适配器兼容或数据迁移。

### D-06 只扩展现有契约测试，不新增测试层

复用 `packages/contracts/test/module-interfaces-events-workflows.test.ts`：

- 在现有 domain ports 用例中补齐 `entryMode`、`triggerReasonCode`，并验证可选 `previousAssessmentRecordRef`、`causalRunRef`、多个 `monitoringSnapshotRefs` 可接受；分别删除两个必填字段、提供空数组或旧 `monitoringCutoff` 必须失败。
- 在现有 workflow stages 用例中验证准备快照省略监测数组、提供多个引用均可接受，空数组和旧单数 `monitoringSnapshotRef` 必须失败。
- 在现有 domain events 用例中把夹具改为复数前后引用，并用代表性对象验证新增、删除、多序列变化可接受，旧单数字段和监测正文必须失败。

不新增测试文件，不断言完整错误文案、字段顺序或内部调用。TypeScript 构建验证公开 union 和所有通用消费点仍可编译；现有单文件 Vitest 验证运行时 strict 行为。

### D-07 文件所有权与追踪

生产实现只允许修改：

- `packages/contracts/src/ports/index.ts`：D-01、D-02、D-04。
- `packages/contracts/src/workflows/index.ts`：D-02。
- `packages/contracts/src/events/index.ts`：D-03。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：D-06。

RA-S1 由显式入口、适用性与多序列冻结输入覆盖；RA-S5～RA-S6 由 C18 多指标/参数所需的快照集合和变化事件覆盖；RA-S7 由可重放的输入变化引用覆盖。其它 packages、apps、迁移、workspace 配置、锁文件、依赖政策、`openspec/config.yaml` 和主 specs 不在实现范围。

## Risks / Trade-offs

- [旧 strict 载荷在升级后被拒绝] → 当前没有真实生产者或合法历史事件来源；唯一 fixtures 同步更新，未来 C25 和事件消费者直接以新契约起步。
- [监测快照授权不能仅由引用形状证明] → contracts 只保证精确引用结构；未来 C25 在形成准备快照前对数组逐项执行既有工程、空间和资料授权校验。
- [事件数组一侧为空容易被误读] → delta spec 固定前空为新增、后空为删除；不使用字段缺失表达这两种状态。
- [入口枚举前移造成无意义的大 diff] → 只移动连续的值、Schema 和派生类型三项，不改枚举值或其它应用入口 DTO。

## Migration Plan

1. 先更新 ports、workflows、events 三个公共契约及同一测试夹具。
2. 运行 contracts 编译/测试、根 typecheck、变更文件 lint/Prettier、OpenSpec strict validate 与 Git 范围核对。
3. 后续 C25、事件生产者和重评估消费者只实现新字段，不接入旧单数字段或 `monitoringCutoff`。

本 change 不需要数据迁移。若在 C25 或事件生产者落地前回滚，只需整体回退本 change 的契约和夹具；一旦下游开始生产新载荷，回滚必须与下游契约同步，不允许静默降级为单序列。
