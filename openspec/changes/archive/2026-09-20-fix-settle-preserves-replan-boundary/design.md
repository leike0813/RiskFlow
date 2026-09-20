# Design

## Context

- `currentTaskWindow`（`status.mjs`）以「存在获批 replan 任务」为条件计算边界：replan 任务的 `approvalRef` 非空、且存在 `attemptGroup === supersedesAttemptGroup` 的、已进入 finalizing 或更后阶段的旧尝试时，窗口才收窄到该 replan 任务创建之后的尝试。
- `riskflowSettle` 构造 settled 信封时逐字段复制检查点内容，未包含 `approvalRef` / `supersedesAttemptGroup`；`createTask` 只在获批重开时成对写入这两个字段。
- 信封校验（`parseTaskEnvelope`）对「带边界」的信封要求 `taskKind === "planning"` 且两个字段都非空，否则判 `invalid_replan_boundary`。

## Goals / Non-Goals

**Goals:**

- 收口不改变边界语义：settled 信封与收口前的尝试属于同一个边界。
- 不引入不完整边界导致的校验失败。

**Non-Goals:**

- 不改变边界的定义、选择规则或 `currentTaskWindow` 的实现。
- 不改变 `approvalRef` 的产生时机（仍只在 `createTask` 的获批重开路径）。
- 不修复「边界之外的陈旧尝试仍留在 Orca」这一现象：它们被正确排除即可，回收属于独立议题。

## Decisions

**D1：成对保留，而不是各自保留。**
校验把这对字段视为一个整体（`hasReplanBoundary` 只要任一存在就必须两者皆非空）。逐字段复制会造出半个边界并让信封直接失效；沿用 `createTask` 的成对语义最一致。

**D2：在 settled 信封构造处修复，而不是在状态侧补偿。**
状态侧补偿意味着 `currentTaskWindow` 需要从别处推断边界，等于给同一概念再造一个事实源。边界是被收口动作抹掉的，就应在收口动作里保住。

## Risks / Trade-offs

- 保留边界后，边界之前的陈旧尝试在该工作项上不再参与判定，但仍在 Orca 中保持 `ready` 状态（本轮实测已存在一个）。这是既有设计取舍，不属于本 change 的范围。
- 若未来出现「同一 planning 尝试既携带边界又需要收口为其他阶段」的用法，成对保留仍符合校验；当前无此用法。
