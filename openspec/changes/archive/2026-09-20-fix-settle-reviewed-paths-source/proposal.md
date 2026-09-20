# Proposal

## Why

RUNBOOK §6 要求「Finalizer 有未提交修复时，主调度必须先审阅全部 dirty paths；`riskflow_settle` 的 `reviewedPaths` 必须与实时 dirty paths 完全一致；工具只暂存这些路径」。这条规则在当前实现里**完全没有生效**：

- 状态视图给节点的 `worktree` 投影只暴露 `dirty` 与 `dirtyPaths`；
- 而控制器读的是不存在的 `node.worktree.git?.dirty` / `node.worktree.git.dirtyPaths`。

于是 `preflightAction` 的 reviewedPaths 一致性校验（`control.mjs:166`）与收口时的检查点提交（`control.mjs:917`，`git add -- <reviewedPaths>` + commit）都因为条件恒假而被静默跳过。

实测后果：C26 的 Finalizer 留下两处未提交修复，受控收口既不校验 reviewedPaths 也不会提交，settled 信封却会记录 `outputHead = worktree HEAD`——即声称产物在某个并不包含该修复的 HEAD 上，而修复一直悬在工作树里。

## What Changes

- `preflightAction` 与 `riskflowSettle` 改用投影实际提供的 `worktree.dirty` / `worktree.dirtyPaths` 判定与取用路径。
- 成功收口时仍只暂存 `reviewedPaths`，不使用 `git add -A`；不一致时仍在 Git 副作用前拒绝。
- 工作树干净时行为不变；不改变投影字段集合。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 成功收口的已审阅改动校验与检查点提交必须真正生效。

## Impact

- 代码：`scripts/orchestration/control.mjs`、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变信封字段、幂等或 Orca 契约；干净工作树路径行为不变。
