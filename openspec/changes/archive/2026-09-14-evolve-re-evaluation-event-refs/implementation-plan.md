# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`d9f3722526824323489204b9616bfd1202a3330d`。
- 实际 OpenSpec schema：`riskflow-delivery`；实现前必须读取 `openspec instructions apply --change evolve-re-evaluation-event-refs --json` 返回的全部 `contextFiles`。
- 行为事实源：本 change 的 `specs/domain/module-interfaces-events-workflows/spec.md`；公共 Schema、兼容性和文件所有权分别按 D-01～D-06。
- 直接依赖事实：已归档 `evolve-assessment-preparation-entry-fields` 及当前主 spec；该归档 change 的“两数组必填、允许空数组”被本 change 明确替换，其它评估准备行为保持不变。
- 代码事实源：`packages/contracts/src/events/index.ts` 的 `AssessmentInputChangedPayloadV1Schema` 与 `DomainEventV1Schema`，以及 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的 `domain events: accepts all twelve transactional events and rejects business bodies`。
- 准备门：HEAD、上述符号、测试名称或主 spec 若偏离该基线，停止并升级；不得依据 C25 未合并文件改写本 change 的固定-base 实现范围。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/contracts/src/events/index.ts`：`MonitoringSnapshotRefV1Schema`、`AssessmentInputChangedPayloadV1Schema`、`DomainEventV1Schema` | 复用现有引用 Schema、`strictObject`、`discriminatedUnion` 与 `z.infer`；只为两个字段加非空/可选约束和一条跨字段 refinement | 不新建事件 DTO、引用 Schema、事件版本或平行事件分支 |
| IP-02 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`：现有 domain events 用例、`eventMetadata`、`monitoringSnapshotRef`、`version` | 在现有参数表和拒绝断言中覆盖全部新边界 | 不新增测试文件、完整错误文案断言或大 snapshot |
| IP-03 | `packages/core/src/persistence/schema.ts`：`AtomicCommitV1Schema`；`packages/adapters/src/postgres/{transaction-unit,outbox,idempotent-consumer}.ts`；`packages/core/src/persistence/idempotent-consumer.ts` | 只通过编译与现有测试证明通用链继续消费 `DomainEventV1`，不编辑这些文件 | 不复制事件解析、Outbox、幂等、事务或审计逻辑 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 收紧 monitoring-snapshot 事件 Schema | Requirement“评估准备入口显式冻结入口语义与多序列监测引用”；“事件表达监测序列新增和删除”“事件表达替换”“事件拒绝无变化载荷”“事件拒绝旧单数载荷和监测正文” | `packages/contracts/src/events/index.ts`：`AssessmentInputChangedPayloadV1Schema` | 两数组改为 `z.array(MonitoringSnapshotRefV1Schema).min(1).optional()`；在 payload 上增加仅针对 monitoring-snapshot 的“至少一侧存在”refinement | `eventSchema`、`DomainEventV1Schema` 列表、事件元数据、`reasonCode`、applicability-metadata、其它事件和引用 Schema |
| IP-02 | 更新现有事件契约用例 | 上述 Requirement 的五个事件场景 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`：domain events 用例 | 合法表改为仅 new、仅 previous、两侧非空；参数化拒绝两侧皆缺与四种显式空数组形状；保留未知字段、旧单数和正文拒绝 | 其它 ports/workflows/事件测试语义，不新增夹具层或测试文件 |
| IP-03 | 回归与范围收口 | “调用方显式提交评估入口语义”“缺少必填入口字段时拒绝”“不使用监测输入”“聚合多个已冻结监测序列”“拒绝空监测引用集合和旧输入形状”；以及所有事件场景 | 无生产文件改动；运行 contracts 全文件、workspace typecheck、lint、format、OpenSpec 与 diff 检查 | 证明未修改的评估准备场景继续通过、公开类型对 main 通用调用方无额外适配、改动不越界 | 不为绿色门禁修改 core/adapters/apps/worker、主 specs、依赖、迁移或配置 |

## 4. 调用与副作用顺序

1. `DomainEventV1Schema` 先按 `eventType` 选择现有 `engineering.assessment-input-changed.v1` 事件对象。
2. `AssessmentInputChangedPayloadV1Schema.change` 按 `kind` 选择 monitoring-snapshot；内层 `strictObject` 拒绝未知字段，并逐项校验所有提供的精确快照引用。
3. 每个已提供数组执行 `.min(1)`；任一显式空数组立即解析失败。
4. payload refinement 检查两字段存在性；两侧皆缺时解析失败，仅一侧或两侧存在时通过。applicability-metadata 分支不进入该判断。
5. 解析成功后，现有 `AtomicCommitV1Schema`、transaction unit、Outbox 与幂等消费者照常处理整个事件；本 change 不改变其事务、审计、摘要、重试或至少一次投递顺序。

所有新增失败均发生在公共 Schema 解析边界，不产生业务事实、审计、Outbox 或消费者回执；不新增错误码、日志或诊断格式。

## 5. Schema、状态与持久化落实

- Schema SSOT 仍为 `AssessmentInputChangedPayloadV1Schema`，公开 `DomainEventV1` 继续只由 `DomainEventV1Schema` 的 `z.infer` 派生。
- 静态类型允许两字段各自缺失；实现不新增手写 XOR/至少一侧类型。运行时“至少一侧”只由 D-01 refinement 判定。
- 不改变 LangGraph 状态、应用状态、port、权限能力、事件信封、版本号、幂等键、审计字段或可观测性。
- 不改变 `outbox.events` JSON 存储、摘要、租约、消费者回执或任何表/约束；没有迁移与数据回填。
- C25/C30 适配按 D-04/D-05 在各自所有权内完成，不进入本 change 的任务或文件白名单。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| 调用方显式提交评估入口语义；缺少必填入口字段时拒绝 | IP-03 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 既有 domain ports 参数表 | 原合法/非法评估准备命令结果不变 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` |
| 不使用监测输入；聚合多个已冻结监测序列；拒绝空监测引用集合和旧输入形状 | IP-03 | 同上 | 既有 domain ports 与 strict snapshots 参数表 | 省略、多引用通过；空集合和旧字段继续失败 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` |
| 事件表达监测序列新增和删除（纯新增） | IP-01、IP-02 | 同上 | monitoring change 仅含非空 new | `safeParse(...).success === true`，previous 不存在 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'domain events'` |
| 事件表达监测序列新增和删除（纯删除） | IP-01、IP-02 | 同上 | monitoring change 仅含非空 previous | `safeParse(...).success === true`，new 不存在 | 同上 |
| 事件表达替换 | IP-01、IP-02 | 同上 | monitoring change 两侧均非空 | `safeParse(...).success === true` | 同上 |
| 事件拒绝无变化载荷 | IP-01、IP-02 | 同上 | 两侧皆缺、单侧空、两侧空参数表 | 每个对象 `safeParse(...).success === false` | 同上 |
| 事件拒绝旧单数载荷和监测正文 | IP-01、IP-02 | 同上 | 复用既有旧字段与 `samples` 对象 | strict 解析继续失败 | 同上 |
| 公开推导类型与 main 通用调用方兼容 | IP-01、IP-03 | TypeScript 项目引用 | 不修改通用调用方 | contracts build 与 workspace typecheck 通过 | `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false && pnpm typecheck` |
| 文件质量与 OpenSpec 一致 | IP-03 | 两个代码文件及本 change 工件 | 所有实现 task 完成 | ESLint、Prettier、strict validate、diff whitespace 均通过 | `pnpm exec eslint packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts && pnpm exec prettier --check packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-re-evaluation-event-refs && openspec validate evolve-re-evaluation-event-refs --strict --no-interactive && git diff --check` |

## 7. 文件清单与升级条件

实现阶段修改：

- `packages/contracts/src/events/index.ts`：IP-01。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：IP-02。
- `openspec/changes/evolve-re-evaluation-event-refs/tasks.md`：仅在对应行为与证据完成后勾选 task。

不新增或删除生产/测试文件。保护 `apps/**`、`packages/core/**`、`packages/adapters/**`、`packages/contracts/src/{common,ports,records,vocabulary,workflows}/**`、其它 contracts 测试、`openspec/specs/**`、其它 changes、根 manifest、`pnpm-lock.yaml`、依赖政策、迁移和 `openspec/config.yaml`。

出现以下任一情况必须停止并升级：

- base HEAD、目标 Schema、测试名称或引用形状与本计划不符；
- `z.discriminatedUnion` 与 payload refinement 不能按 D-01 组合，需改用新的公共类型/联合形状；
- 任一 main 生产调用方直接读取两字段并需要非机械语义适配；
- 需要修改 C25 未合并文件、其它事件、主 specs、数据库、迁移、依赖、权限、事务、错误或审计；
- 指定命令不存在，或验证失败表明本计划之外的行为/工作区漂移，而不是当前两文件内可修复问题。
