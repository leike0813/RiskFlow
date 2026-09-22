# Spec Delta

## MODIFIED Requirements

### Requirement: Codex worker 只在工作区信任完成后启动

Planning、Finalizer 与 Targeted Auditor 的受控派发 MUST 先在目标 worktree 创建使用 Manifest 模型与强度的 Codex terminal，并在该 terminal 达到 `tui-idle` 后才调用 `worker-start --terminal`。若首次启动停在工作区信任提示，控制器 MUST 从失败结果或同一 retry-request 的结构化重放结果读取失败阶段与错误，返回精确 terminal handle 和受控恢复动作，MUST NOT 自动修改全局信任配置、把该失败计为新的失败尝试或创建第二个 Task/terminal；确认信任后 MUST 复用同一 queued Task 和 terminal。该归因 MUST 同时覆盖 `tui-idle` 等待阶段与 `worker-start` 的 `dispatch_input` 阶段。仅当当前尝试仍为 queued、没有 live/ready/succeeded worker 且结构化失败确认为上述输入阶段信任提示时，本地 OpenSpec change 尚未生成 MUST NOT 阻断 reconcile 或携带原 terminal handle 的重新派发；worker 接受输入后缺少本地 change 仍 MUST 失败闭合。

#### Scenario: 首次 Codex 启动需要人工信任
- **WHEN** 新 worktree 的 Codex terminal 返回 `agent_prompt_blocked`
- **THEN** 控制器停止在 worker 接受任务输入之前，保留 queued 尝试，并返回精确 terminal handle 供操作者确认信任

#### Scenario: 确认信任后复用当前尝试
- **WHEN** 操作者在该 terminal 确认工作区信任并以新幂等键、同一 terminal handle 重新派发
- **THEN** 控制器确认 terminal 已 idle，复用当前 Task，通过 `worker-start --terminal` 启动且不创建第二个 Task 或 terminal

#### Scenario: worker-start 阶段的信任提示同样归类
- **WHEN** `worker-start` 首次调用失败，而同一 retry-request 的结果给出 `stage=dispatch_input` 与 `lastError=agent_prompt_blocked` 或等价工作区信任提示
- **THEN** 控制器 MUST 以 `workspace_trust_required` 返回该 terminal 的精确 handle、受控恢复动作与尚未生成失败尝试的事实
- **AND** MUST NOT 把它报告为通用控制失败或作为实现、验收失败计入尝试次数

#### Scenario: 输入尚未接受时本地 change 缺失不阻断恢复
- **WHEN** 当前 queued 尝试已记录 `dispatch_input` 信任恢复原因、没有 live/ready/succeeded worker，且新 worktree 尚无对应本地 OpenSpec change
- **THEN** `task_missing_local_openspec` MUST NOT 阻断 reconcile 或携带原 terminal handle 的重新派发

#### Scenario: worker 接受输入后继续失败闭合
- **WHEN** 当前 worker 已 live、ready 或 succeeded，或尝试已经进入 running，而对应本地 OpenSpec change 缺失
- **THEN** 状态视图 MUST 报告 `task_missing_local_openspec` 并拒绝绕过该冲突
