# Proposal

## Why

`createV2Envelope` 用「当前检查点的 `taskKind` 是否与本次相同」来决定尝试编号：

```js
const sameAttemptGroup = checkpoint?.taskKind === taskKind;
attempt: replan ? 1 : sameAttemptGroup ? Number(checkpoint?.attempt ?? 0) + 1 : 1,
```

当同一尝试组里先后出现不同责任时这个判断会撞号：C26 的限定审计（`C26:audit`）以 `failed` 收口后，修复尝试回到 `C26:finalizing` 组，却因为检查点是 audit 而重新从 **attempt 1** 起算——与组内既有的 attempt 1、2 撞号。当前尝试选择在同一组内取最大 attempt，于是状态视图又指向早已收口的 attempt 2，正在运行的修复无法被收口。

实测：C26 修复任务派发成功（`task_93d0aebeec09`，worker 已在运行），但 `checkpoints` 仍指向 `task_b820445621d0`（旧 attempt 2，settled）。

## What Changes

- 尝试编号按**组历史**递增：目标尝试组内已有尝试时取「组内最大 attempt + 1」，而不是只看当前检查点是否为同类。
- 组内没有任何历史尝试时保持从 1 开始；获批重开规划的 planning 边界仍从 1 开始。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 尝试编号必须按目标尝试组的历史递增。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`createV2Envelope`）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变尝试组命名、阶段顺序或 Orca 契约。
