# Design

## Context

- `createV2Envelope` 由 `node.checkpoints`（当前尝试）与 `taskKind` 推导 `attemptGroup` 与 `attempt`。
- 尝试组命名：常规为 `<id>:<phase>`，audit 为 `<id>:audit`，获批 replan 为 `<id>:planning:<hash>`。
- 状态视图在同一阶段内先按尝试组边界定界，再在组内取最大 `attempt`。
- 节点快照已经携带 `orca.attempts`（每个尝试的 `attemptGroup`/`attempt`），因此组历史在控制器侧可得。

## Goals / Non-Goals

**Goals:**

- 同一尝试组内的代次连续递增，不因职责切换而撞号。
- 保持 replan 边界与"组内无历史则从 1 开始"的既有语义。

**Non-Goals:**

- 不改变尝试组命名规则或组边界定界。
- 不回溯修正历史信封中的编号（它们已收口，仅作记录）。

## Decisions

**D1：用组历史的最大值 + 1，而不是"当前检查点同类则加一"。**
代次的定义域是尝试组，不是"当前检查点是不是同类"。用组历史表达这一定义，既修掉撞号，也让"不同职责先后进入同一组"这种正常序列得到连续编号。

**D2：信息缺失时回退到既有判断。**
若节点快照没有 `orca.attempts`（例如单元测试或早期信封），退回原来的 `sameAttemptGroup` 逻辑，保持向后兼容。

## Risks / Trade-offs

- 组内编号会因历史缺失而回退，可能再次撞号；这种情况只在快照不完整时出现，且此时状态视图本身也无法可靠选择当前尝试。
- 编号只影响选择与展示，不影响已收口信封的内容。
