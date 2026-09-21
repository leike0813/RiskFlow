# Proposal

## Why

回收 `AUX:fix-orchestration-legality-gaps` 时又暴露两个控制器缺陷，都是「规格已写的行为在实现里不可达/不可辨识」：

- **受控回收仍然不可达**：`riskflow_integrate` 关闭 stale 工作项的精确 terminal 时把 `--retry-request` 附在 `orca terminal close` 上，而该子命令不接受这个标志（实测 `invalid_argument: Unknown flag --retry-request for command: terminal close`）。关闭循环 fail-fast，于是第一个 handle 失败即中止；同时「handle 已经消失」被当成失败（实测 `terminal_handle_stale`），与「只关闭残留 terminal」的幂等语义冲突。
- **工作区信任提示不可辨识**：新 worktree 首次派发 Codex 时，`worker-start` 因信任提示失败（实测 C21 与本次 AUX），控制器把它当作通用 `control_failure` 抛出，而 runbook 与 spec 都要求以 `workspace_trust_required` 返回精确 terminal handle 与受控恢复动作。操作者只能靠观察 terminal 屏幕判断，绕过受控路径。

两者都属「合法动作在真实状态上不可达」，且每次收口都会重现。

## What Changes

- **`--retry-request` 只发给接受它的子命令**：只有 `orchestration` 写命令携带该标志；`worktree`/`terminal` 子命令不再附加。
- **关闭精确 terminal 变为幂等**：`terminal_handle_stale`（或等价的「已不存在」）MUST 视为已关闭并继续处理该工作项的其余 handle。
- **信任提示归类**：Codex 分支的 `worker-start` 失败若匹配信任提示特征，MUST 以 `workspace_trust_required` 返回该 terminal 的精确 handle、下一步动作与「尚未生成 failed attempt」的事实，保留 queued Task 供确认后复用。
- **回归**：两个测试文件补代表性用例（关闭循环对 stale handle 继续、关闭命令不带 `--retry-request`、worker-start 信任失败归类）。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`：回收关闭步骤要求使用子命令支持的参数并把「已不存在」视为已关闭；Codex 信任提示导致的启动失败必须以 `workspace_trust_required` 归因并携带精确 handle。

## Impact

- 代码：`scripts/orchestration/control.mjs` 及其测试。
- 规格：`operations/orchestration-controlled-actions` 的 delta。
- 不新增依赖；不改变阶段顺序、尝试组编号、活动写者判定、回收合规前提或 Orca 契约。
