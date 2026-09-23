# Tasks

## 1. 信任归因

- [x] 1.1 `scripts/orchestration/control.mjs`：扩展 `WORKSPACE_TRUST_PATTERN` 覆盖 `trust this folder` / `trust and continue`；新增 `terminalShowsWorkspaceTrustPrompt()`（`terminal read --screen` + 同一正则，探测失败返回 false）。
- [x] 1.2 `scripts/orchestration/control.mjs`：在 `startWorker` 的 `tui-idle` 等待失败与 `worker-start` 失败两条路径上，文本判定未命中时追加屏幕探测；命中则 `recordWorkspaceTrustRecovery` + 抛 `workspace_trust_required`。
- 验证：`scripts/orchestration/control.test.mjs`「classifies a stalled worker-start as trust recovery when the terminal shows the prompt」（`lastError=agent_prompt_stalled` + 屏幕显示信任提示 ⇒ `workspace_trust_required`，且确实读取了屏幕）。

## 2. 状态与角色推导

- [x] 2.1 `scripts/orchestration/status.mjs`：`task_missing_local_openspec` 触发条件排除「当前尝试为未成功的 planning」。
- [x] 2.2 `scripts/orchestration/control.mjs`：`nextTaskKind()` 在「存在尝试但规划从未成功」时返回 `planning`；`finalization` 回退仅保留 `phase === "adopt" || status === "untracked"`；导出 `nextTaskKind` 供测试使用。
- [x] 2.3 `scripts/orchestration/control.mjs`：`riskflowReconcile` 的替代尝试角色改为复用派发规则（`deriveReconcileKind`：规划未完成 ⇒ planning，否则 finalization；显式 `phase="planning"` 仍按规划），不再缺省一律 finalization（该缺省会把未规划的工作树派成收尾/verification）。
- 验证：`status.test.mjs`「fails closed for duplicate, missing, and mismatched worktree facts」内的规划待创建分支；`control.test.mjs`「keeps planning as the next role until a planning attempt succeeds」「reconstructs a planning attempt while planning never succeeded」「launches the Codex worker with the startup update check disabled」。

## 2a. worker 启动副作用

- [x] 2a.1 `scripts/orchestration/control.mjs`：`startWorker` 的 `terminal create --command` 增加 `-c check_for_update_on_startup=false`，禁止 worker 启动触发 Codex 自更新（版本由项目集中管理，升级横幅会被误判为 `agent_prompt_stalled`）。
- 验证：`control.test.mjs`「launches the Codex worker with the startup update check disabled」（断言实际下发的启动命令含该覆盖）。

## 3. 验证

- [x] 3.1 `scripts/orchestration/status.test.mjs`：新增「未成功 planning + 任务存在 + 无本地 change」不产生 `task_missing_local_openspec`，且状态可恢复（非 unknown）。
- [x] 3.2 `scripts/orchestration/control.test.mjs`：新增 `nextTaskKind` 用例——未成功 planning ⇒ `planning`（失败与 reconcile 生成的收尾尝试两态）；已采纳 auxiliary ⇒ `finalization`；规划成功 ⇒ 原行为。
- [x] 3.3 运行 `pnpm exec vitest run scripts/orchestration/status.test.mjs scripts/orchestration/control.test.mjs`：100 passed。
- [x] 3.4 以真实状态复核：C39 不再判 `task_missing_local_openspec`；`violations: 0`；实算 `nextTaskKind(C30)=planning`、`nextTaskKind(C39)=planning`、`nextTaskKind(C36)=implementation`（C36 规划已成功）。
