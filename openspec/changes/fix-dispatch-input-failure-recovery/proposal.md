# Proposal

## Why

Codex 首次进入新 worktree 时，`worker-start` 可能在 `dispatch_input` 阶段因工作区信任提示失败。控制器当前丢失结构化失败信息，状态视图又把此时尚未生成的本地 OpenSpec change 当作不可恢复冲突，导致原 Task 与 terminal 无法受控复用。

## What Changes

- 从失败命令或同一 `--retry-request` 的重放结果读取 `stage`、`failedStage` 与 `lastError`，仅将 `dispatch_input` 阶段的工作区信任提示归类为 `workspace_trust_required`。
- 在现有尝试信封中记录精确的受控恢复原因，使状态视图可以区分“输入从未被接受”与普通 worker 失败。
- 仅在当前尝试仍 queued、没有 live/ready/succeeded worker 且恢复原因为上述信任提示时，不让 `task_missing_local_openspec` 阻断恢复；worker 接受输入后继续严格失败闭合。
- 回归验证原 Task 与 terminal 被复用，且不创建第二个 Task 或 terminal。

## Capabilities

### New Capabilities

<!-- 无新增能力。 -->

### Modified Capabilities

- `operations/orchestration-controlled-actions`：补足 `worker-start` 输入阶段失败的结构化归因、同一尝试恢复及本地 OpenSpec 瞬态缺失的有界处理。

## Impact

- 代码：`scripts/orchestration/control.mjs`、`scripts/orchestration/status.mjs` 及对应测试。
- 规格：`operations/orchestration-controlled-actions` delta。
- 不新增依赖，不修改全局 Codex 信任配置，不放宽重复写者、身份、检查点等既有失败闭合规则，也不改变 `worker-start` 之外的 Orca 调用语义。
