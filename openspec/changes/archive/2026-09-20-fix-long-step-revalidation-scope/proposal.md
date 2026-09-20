# Proposal

## Why

长外部步骤（集成的主线复验）在锁外执行后按起始 `expectedRevision` 重新校验事实集——而 `expectedRevision` 是**整个事实集**的哈希。`pnpm verify` 自身的构建与测试会产生瞬时未跟踪文件，`git status` 因此短暂变脏，于是长步骤**把自己的副作用误判为并发写者**，以 `stale_revision` 丢弃结果：实测 C17 的主线复验通过后仍被拒绝（main 与两个 worktree 事后都干净，说明变化是瞬时的），C26 那次只是侥幸没落在采样点上。

## What Changes

- 事后校验只比对该步骤真正依赖的事实：工作项状态、当前尝试身份（`checkpoints.taskId`）、`main.head`，以及是否存在状态违规；不再比对全量事实集哈希。
- 拒绝时仍返回 `stale_revision` 并给出同样的下一步指引。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 长外部步骤的事后校验范围收窄到该步骤依赖的事实。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`assertFactsUnchanged`）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖；不放松真正的并发保护：阶段、当前尝试、主线 HEAD 或违规集合变化仍会拒绝。
