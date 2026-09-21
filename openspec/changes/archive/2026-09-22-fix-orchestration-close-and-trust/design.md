# Design

## Context

- `orcaJson` 对每次调用都附加 `--retry-request`；实测 `orca terminal close --retry-request <id>` 返回 `invalid_argument: Unknown flag --retry-request`，而 `orca orchestration *` 写命令接受该标志（`task-create`、`worker-start` 等帮助中列出）。
- `riskflowIntegrate` 的 stale 分支逐个关闭状态投影列出的 handle，任一失败即抛出，导致受控回收不可达；`orca terminal close` 对已消失 handle 返回 `terminal_handle_stale`。
- Codex 分支在 `terminal wait --for tui-idle` 阶段已能把 `agent_prompt_blocked`/`workspace trust` 归类为 `workspace_trust_required`，但 `worker-start` 阶段的同类失败仍以通用 `control_failure` 抛出（实测两次）。

## Goals / Non-Goals

**Goals:**

- 让受控回收在真实状态下可达且幂等。
- 让工作区信任提示在受控层可辨识，操作者按 runbook 的精确 handle 流程恢复。

**Non-Goals:**

- 不自动确认或修改全局 Codex 信任配置。
- 不放宽回收的任何合规前提（归档、主线验证、工作树 clean、尝试成功收口、重读 reclaimable、完整 worktree ID 未变）。
- 不改变 Orca 契约、阶段顺序或尝试组语义。

## Decisions

### D-01：`--retry-request` 只发给接受它的命令族

追加条件由「调用方是否提供 retryRequest」改为「调用方提供 retryRequest 且 `args[0] === "orchestration"`」。理由：该标志只在 orchestration 写命令上实现，其他命令族会直接拒绝；幂等回执只对 controller 自己的写命令有意义。

替代方案（逐个命令维护白名单）被否决：命令族边界已由 `withOrcaSender` 用同一判据表达，重复维护会再次漂移。

### D-02：关闭精确 terminal 幂等

关闭循环捕获 `terminal_handle_stale`（以及等价的「已不存在」文案）并视为成功继续；其他错误（权限、运行时不可用）仍 fail-closed 抛出。理由：状态投影列出的是曾经记录的 handle，terminate 过程本身可能已被上一次尝试完成；把「已经不在」当失败会让回收不可达。

### D-03：`worker-start` 失败按信任提示归因

Codex 分支调用 `worker-start` 时包裹错误归类：消息匹配 `agent_prompt_blocked` 或 `workspace trust` 时抛出 `ControlError("workspace_trust_required")`，携带该 terminal handle、下一步动作（在精确 terminal 确认信任并以该 handle 重新派发）与「尚未生成 failed attempt / 保留 queued Task」的事实；其他错误原样冒泡。理由：spec 与 runbook 已规定该归因与恢复路径，实现必须与之一致。

## Risks / Trade-offs

- **[掩盖真实失败]** → 只对 `terminal_handle_stale` 这一类「目标已不存在」放宽；权限、运行时不可用、参数错误继续抛出。
- **[把非信任失败误判为信任]** → 归类仅匹配信任提示的稳定特征字符串，其余错误保持原样；归类不改变 worker-start 是否真的发生，操作者仍需按 handle 复核。

## Migration Plan

无状态迁移：修复只影响后续调用。合并后 stale 工作项可重新走受控 cleanup；历史 break-glass 回收记录不受影响。
