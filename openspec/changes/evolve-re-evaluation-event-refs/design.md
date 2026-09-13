## Context

参见 [proposal.md](proposal.md) 的动因。本设计以 base commit `d9f3722526824323489204b9616bfd1202a3330d` 为代码事实源，并落实 [delta spec](specs/domain/module-interfaces-events-workflows/spec.md) 对 `engineering.assessment-input-changed.v1` monitoring-snapshot 分支的收紧。

当前 `packages/contracts/src/events/index.ts` 的私有 `AssessmentInputChangedPayloadV1Schema` 使用 `z.strictObject` 和按 `kind` 判别的联合，要求 `previousMonitoringSnapshotRefs`、`newMonitoringSnapshotRefs` 同时存在，但两个数组均可为空。当前主 spec 同样规定两数组存在、任一侧可为空。C25 未合并实现的 `PostgresRiskAssessmentEngineV1.#reassessmentChangeEvent` 则按其 design D-02 把两侧定义为可选非空数组、至少一侧存在；现有实现尚未落实该约定，而是无条件发出完整前后集合。

引用核实结果如下：

- 当前 main 只有 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 具体构造该事件，没有生产发出方或专用消费方。
- `packages/core/src/persistence/schema.ts` 的 `AtomicCommitV1Schema`、`packages/adapters/src/postgres/transaction-unit.ts`、`packages/adapters/src/postgres/outbox.ts`、`packages/core/src/persistence/idempotent-consumer.ts` 和 `packages/adapters/src/postgres/idempotent-consumer.ts` 只按 `DomainEventV1Schema` 通用解析、保存、租约或转交，不读取两侧字段。
- `apps/api` 与 `apps/web` 的 SSE 只处理工作流订阅/传输帧，`apps/worker` 当前只消费其它专用事件；仓库没有该事件的 JSON-LD 或 SSE 业务投影。
- C25 是首个真实生产者；C26 明确只消费 `assessment.recorded.v1`。C28 路线只消费处置前后冻结快照与反馈事实。C30 将成为该事件的重评估消费者。

## Goals / Non-Goals

**Goals:**

- 用最小公共 Schema 改动让字段存在性表达引用差集：离开评估输入的引用只出现在 previous，进入评估输入的引用只出现在 new。
- 让 Zod 运行时校验拒绝两侧皆缺、显式空数组和未知字段，并由同一 Schema 继续派生公开 TypeScript 类型。
- 让现有通用事件链零代码适配，并给 C25/C30 固定机械兼容方式。

**Non-Goals:**

- 不演进 applicability-metadata 分支、事件信封、其它事件、评估准备快照或任何 port/workflow DTO。
- 不在公共 Schema 中增加排序、去重、集合相等或跨引用业务校验；C25 生产者继续负责确认输入确实变化并形成规范差集。
- 不修改 C25 未合并 worktree、C26/C28、应用、JSON-LD/SSE、数据库、迁移、依赖或锁文件。

## Decisions

### D-01：两个引用数组可选且非空，payload 层校验至少一侧存在

旧 Schema 为：

```ts
const AssessmentInputChangedPayloadV1Schema = z.strictObject({
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("monitoring-snapshot"),
      previousMonitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema),
      newMonitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema),
    }),
    // applicability-metadata 分支保持不变
  ]),
  reasonCode: IdentifierSchema,
});
```

新 Schema 固定为：

```ts
const AssessmentInputChangedPayloadV1Schema = z
  .strictObject({
    change: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("monitoring-snapshot"),
        previousMonitoringSnapshotRefs: z
          .array(MonitoringSnapshotRefV1Schema)
          .min(1)
          .optional(),
        newMonitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional(),
      }),
      // applicability-metadata 分支保持不变
    ]),
    reasonCode: IdentifierSchema,
  })
  .superRefine((payload, context) => {
    if (
      payload.change.kind === "monitoring-snapshot" &&
      payload.change.previousMonitoringSnapshotRefs === undefined &&
      payload.change.newMonitoringSnapshotRefs === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["change"],
        message: "monitoring snapshot change requires previous or new references",
      });
    }
  });
```

由 `DomainEventV1Schema` 推导出的 monitoring-snapshot change 静态形状为：

```ts
{
  kind: "monitoring-snapshot";
  previousMonitoringSnapshotRefs?: MonitoringSnapshotRefV1[];
  newMonitoringSnapshotRefs?: MonitoringSnapshotRefV1[];
}
```

静态类型反映字段可选性；“至少一侧存在”由同一 Zod Schema 的运行时 refinement 收口。已有内层 `strictObject` 继续拒绝未知 change 字段，外层 `strictObject` 继续拒绝未知 payload 字段；`.min(1)` 拒绝显式空数组。测试不锁定 refinement 文案。

选择在 payload 层 refinement，是因为它保留现有按 `kind` 判别的联合，只增加一条跨字段约束。备选的三个同 kind 严格对象普通联合能把“至少一侧”编码进静态类型，但会重复字段定义、放弃现有 `discriminatedUnion`，收益不足以抵消维护面。

### D-02：数组表达变化差集，空侧省略

语义固定为：

| 变化 | `previousMonitoringSnapshotRefs` | `newMonitoringSnapshotRefs` |
| --- | --- | --- |
| 纯新增 | 省略 | 新进入输入的非空引用差集 |
| 纯删除 | 离开输入的非空引用差集 | 省略 |
| 替换/同时增删 | 离开输入的非空引用差集 | 新进入输入的非空引用差集 |

两侧都缺不表示“无变化”；生产者不得发布该事件。两侧都存在时，公共 Schema 只校验引用形状与非空性，不重复执行生产者已经完成的差集、去重和变化判断。

三种方案比较：

| 方案 | Schema 与语义 | 调用方影响 | 结论 |
| --- | --- | --- | --- |
| 空侧省略 | 两字段可选非空，至少一侧存在 | C25 机械改为输出差集并条件展开；未来消费者对缺失侧使用空集合 | 选用；与 C25 已批准设计和目标语义一致，载荷没有空数组哨兵 |
| 显式空数组 | 两字段必填，并增加“至少一侧非空”约束 | C25 当前字段形状可保留，但仍须改为差集；与其 design 的空侧省略冲突 | 不选；不能闭合本次工件冲突 |
| 保持现状 | 两字段必填且允许同时为空 | 现有通用代码零改动 | 不选；无变化载荷仍合法，C25 继续无法按批准设计实现 |

不新增 `addedMonitoringSnapshotRefs` / `removedMonitoringSnapshotRefs`，因为现有字段足以承载相同差集，新增字段会扩大事件版本与消费面。

### D-03：本 change 只修改公共 Schema 和现有契约测试

实现文件白名单：

- `packages/contracts/src/events/index.ts`：只修改 `AssessmentInputChangedPayloadV1Schema` 的 monitoring-snapshot 两字段，并在该 payload Schema 上增加 D-01 refinement。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：只修改现有 `domain events` 用例中的事件夹具与参数表；覆盖纯新增、纯删除、替换、两侧皆缺、显式空数组和未知字段。

`DomainEventV1Schema` 的事件列表、`eventSchema`、applicability-metadata 分支和其它事件无需改动。通用 core/adapters、apps、worker、JSON-LD/SSE 均不读取字段，不做“兼容性”机械改动。没有新接口、状态、权限、错误码、事务、审计、可观测性、依赖或持久化决定。

### D-04：C25 生产者在前置 change 归档后输出规范差集

C25 自有 `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 的 `PostgresRiskAssessmentEngineV1.#reassessmentChangeEvent` 需要在其原 change 内完成下列机械适配：

1. 本地 `event` 参数类型把两个 monitoring 数组改为可选。
2. 复用已有 `previousKeys` / `currentKeys`，分别计算 `previousRefs` 中不在 current 的删除差集和 `currentRefs` 中不在 previous 的新增差集。
3. 构造 change 时仅在对应差集非空时展开 `previousMonitoringSnapshotRefs` / `newMonitoringSnapshotRefs`；已有 unchanged 判断继续阻止两侧皆缺事件。

C25 的 `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` 现有用例“重评变更事件：纯删除、替换、纯新增与策略单独变化”无需新夹具：当前真子集、替换、真超集输入恰好可分别断言只有 previous 删除差集、两侧差集、只有 new 新增差集，并用 `not.toHaveProperty` 证明空侧被省略。该文件与符号不在 base `d9f3722`，因此不是本 change 的实现 task 或文件白名单；主调度应在本 change 归档并进入 C25 收口时应用。

### D-05：现有与计划消费方兼容规则

- 通用 `AtomicCommitV1Schema`、transaction unit、Outbox 和幂等消费者继续解析整个 `DomainEventV1`，无需字段级代码。
- C26 只消费 `assessment.recorded.v1`，其已规划 core/adapter/Worker 不受影响。
- C28 的执行、预测、反馈与偏差入口消费冻结快照/记录引用，不直接消费本事件，不受影响。
- C30 规划中的 workflow 重评估消费方必须把缺失侧规范化为只读空集合后比较或路由，例如 `const previousRefs = change.previousMonitoringSnapshotRefs ?? []`；不得要求两字段同时存在，也不得把缺失解释为未知数据。
- C31/C34 后续若投影该事件，只展示已存在的差集引用；不得补造空数组后反写领域事实。

### D-06：契约测试是唯一新增验证面

复用 contracts 单文件测试，验证稳定解析行为：

- 纯新增：仅 new 非空，通过；纯删除：仅 previous 非空，通过；替换：两侧非空，通过。
- 两侧皆缺、previous/new 任一显式空数组、两侧均空，均失败。
- 旧单数字段、监测正文及任意未知字段继续失败；applicability-metadata 和其它事件原夹具继续通过。

运行 contracts TypeScript build 证明公开推导类型与当前所有 main 消费点可编译；运行该 contracts 测试文件证明运行时约束。无需新增 core/adapters/apps/worker 测试，因为这些路径没有字段级分支。

## Risks / Trade-offs

- [既有显式空数组载荷升级后无法解析] → 当前 main 没有生产者或合法历史事件来源，C25 尚未合并；先归档本 change，再适配并验证 C25。
- [可选静态字段不能证明至少一侧存在] → 所有信任边界必须先通过 `DomainEventV1Schema`；未来消费者仍以 `?? []` 处理两侧，不自行断言必填。
- [生产者错误地发送完整前后集合而非差集] → C25 现有三个集合关系用例改为断言精确差集和字段缺失；公共 Schema 只负责结构，不复制集合算法。
- [同名 `v1` 行为收紧] → 无存量生产事件可迁移；保持事件类型/version 可避免为尚未正式启用的分支引入并行版本。

## Migration Plan

1. 实现并验证 D-01、D-03，归档后让主 spec 成为新的公共契约事实源。
2. C25 在继续独立验证前按 D-04 适配生产者和现有集成测试；不得以显式空数组兼容旧行为。
3. 后续 C30 直接按 D-05 消费；C26/C28 无需同步代码。

本 change 不需要数据库迁移或数据回填。若在 C25 适配前回滚，只需整体回退 Schema 与测试；C25 开始生产新载荷后，回滚必须与 C25 同步，不能把缺失侧静默补为空数组写回历史事件。
