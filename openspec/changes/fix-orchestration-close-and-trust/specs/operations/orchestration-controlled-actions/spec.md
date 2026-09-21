# Spec Delta

## MODIFIED Requirements

### Requirement: Codex worker 只在工作区信任完成后启动

Planning、Finalizer 与 Targeted Auditor 的受控派发 MUST 先在目标 worktree 创建使用 Manifest 模型与强度的 Codex terminal，并在该 terminal 达到 `tui-idle` 后才调用 `worker-start --terminal`。若首次启动停在工作区信任提示，控制器 MUST 返回精确 terminal handle 和受控恢复动作，MUST NOT 自动修改全局信任配置、调用 worker-start 或把 queued Task 标为失败；确认信任后 MUST 复用同一 Task 和 terminal。该归因 MUST 同时覆盖 `tui-idle` 等待阶段与 `worker-start` 阶段：任一阶段出现信任提示特征时，结果 MUST 以 `workspace_trust_required` 返回，并携带该 terminal 的精确 handle 与「尚未生成 failed attempt」的事实。

#### Scenario: 首次 Codex 启动需要人工信任
- **WHEN** 新 worktree 的 Codex terminal 返回 `agent_prompt_blocked`
- **THEN** 控制器停止在 worker-start 之前，保留 queued Task，并返回精确 terminal handle 供操作者确认信任

#### Scenario: 确认信任后复用当前尝试
- **WHEN** 操作者在该 terminal 确认工作区信任并以新幂等键、同一 terminal handle 重新派发
- **THEN** 控制器确认 terminal 已 idle，复用当前 queued Task，通过 `worker-start --terminal` 启动且不创建第二个 Task 或 terminal

#### Scenario: worker-start 阶段的信任提示同样归类
- **WHEN** `worker-start` 因 `agent_prompt_blocked` 或工作区信任提示失败
- **THEN** 控制器 MUST 以 `workspace_trust_required` 返回该 terminal 的精确 handle 与受控恢复动作
- **AND** MUST NOT 把它报告为通用控制失败或作为实现、验收失败计入尝试次数

### Requirement: stale 终态残留只能经重验后回收

cleanup 遇到已归档、主线验证通过、工作树干净、当前尝试成功收口且无**其他**阻断违规的 stale 工作项时，MUST 只关闭状态投影列出的精确 terminal handles；随后 MUST 重读状态，并仅在同一工作项变为 `reclaimable` 时按完整 worktree ID 回收。回收就绪标记（`worktree_reclaim_pending`）MUST NOT 被当作阻断违规：它是状态视图对 stale/reclaimable 派生出的「待回收」就绪标记，不是冲突。关闭步骤 MUST 只使用该子命令支持的参数，且 MUST 把「该 handle 已不存在」视为已关闭并继续处理其余 handle。任一其他前提不满足、关闭失败、事实漂移或重读后仍非 reclaimable 时 MUST fail-closed，MUST NOT force 删除。

#### Scenario: 清理精确终态 terminal 后回收
- **WHEN** 已归档成功工作项仅因若干终态 terminal 残留而为 stale，且全局唯一的违规是该工作项的回收就绪标记
- **THEN** 控制器关闭这些精确 handles、重读状态、确认 reclaimable 后按完整 ID 回收工作树

#### Scenario: 活动或脏工作树拒绝自动清理
- **WHEN** 工作树有未提交改动、主线未验证、尝试未成功收口、存在回收就绪标记以外的违规，或关闭后仍非 reclaimable
- **THEN** 控制器停止清理并保留工作树，不使用 force 或路径删除

#### Scenario: 回收就绪标记不阻断任何受控动作
- **WHEN** 全局违规中只含若干工作项的 `worktree_reclaim_pending`
- **THEN** 派发、收口、集成与回收 MUST 按目标工作项自身的合规事实判定，MUST NOT 因这些标记被拒绝
- **AND** 判定 MUST 仍按目标工作项自身是否转为 `reclaimable` 决定是否回收其工作树

#### Scenario: 已消失的 handle 不阻断其余关闭
- **WHEN** 关闭某个 handle 时该 terminal 已不存在
- **THEN** 控制器 MUST 继续关闭同一工作项的其余 handle，并仍按重读后的 reclaimable 事实决定是否回收
- **AND** 权限、运行时不可用或参数错误 MUST 继续 fail-closed
