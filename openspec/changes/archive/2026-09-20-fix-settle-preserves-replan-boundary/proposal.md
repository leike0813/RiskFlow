# Proposal

## Why

受控收口构造 settled 信封时只复制 `attemptGroup`/`attempt`/`auditPolicy` 等字段，**丢掉了 `approvalRef` 与 `supersedesAttemptGroup`**。这两个字段正是获批重开规划在状态视图里的边界标记：`currentTaskWindow` 依据它们把边界之前的尝试排除在判定之外。

实测后果：C17 的重开规划尝试以 `paused` 收口后，边界随之消失，被取代的旧收尾尝试重新参与选择，节点从 `paused` 回退成 `unknown`（checkpoints 指向 attempt 3 的陈旧 finalizing 任务，并报出 `checkpoint_mismatch: ec97787 → 645a935`）。

## What Changes

- 收口时若检查点携带完整的重开规划边界（`approvalRef` 与 `supersedesAttemptGroup` 均非空），settled 信封 MUST 原样保留这两个字段。
- 边界不完整（缺任一项）时不写入，避免产生 `invalid_replan_boundary`；这与 `createTask` 只在获批重开时成对写入的既有约定一致。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 收口必须保留获批重开规划边界。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`riskflowSettle` 的 settled 信封构造）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变信封字段集合（只保留既有字段）、阶段转换、幂等或 Orca 契约；常规（非重开）收口不受影响。
