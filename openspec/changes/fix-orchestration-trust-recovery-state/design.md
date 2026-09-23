# Design：信任阻断后的状态与角色推导

## 决策

1. **信任归因以 terminal 屏幕为证据**。失败文本在不同 Orca/Codex 版本里并不稳定（实测为 `agent_prompt_stalled`），而信任提示在屏幕上形态固定。因此在 `worker-start` 与 `tui-idle` 失败路径上增加一次 `terminal read --screen` 探测：命中 `/trust this folder|trust and continue|workspace trust/i` 即按信任失败收口。探测本身失败（terminal 已释放等）不改判，仍按原始错误上抛。
2. **违规判定区分「尚未创建」与「缺失」**。`task_missing_local_openspec` 的语义是「该工作项已有非规划阶段的任务，但工作树里没有对应 change」。规划尝试未成功时本地 change 尚不存在属正常中间态，因此把该违规的触发条件收紧为「当前尝试不是未成功的 planning」。
3. **角色推导以尝试事实为准**。`nextTaskKind()` 首先判断当前尝试是否为未成功的 planning：是则继续 planning；其余分支不变。`finalization` 回退只对 `phase === "adopt" || status === "untracked"`（即已采纳且有本地 change、无关联任务的 auxiliary 工作树）生效。

## 取舍

- 探测屏幕比解析错误文本更贴近事实，但引入一次额外 CLI 调用：仅在失败路径上发生，且失败本身已是非正常路径，成本可接受。
- 未成功的 planning 继续 planning 会让「规划者反复失败」的情形重复派发，因此仍需保留 `noProgressLimit` 与违规检查作为外圈刹车。
