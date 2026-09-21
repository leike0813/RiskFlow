# Spec Delta

## ADDED Requirements

### Requirement: 受控调度工具具有单一完整清单
控制器 MUST 以单一工具清单注册并自检 `riskflow_status`、`riskflow_dispatch`、`riskflow_wait`、`riskflow_reply`、`riskflow_settle`、`riskflow_integrate` 和 `riskflow_reconcile`。doctor MUST 拒绝缺少任一工具的扩展，文档与冷启动上下文 MUST 使用同一组名称。

#### Scenario: 冷启动前验证工具面
- **WHEN** 协调者运行调度 doctor
- **THEN** 输出列出全部七个受控工具，且任一注册缺失都会使 doctor 失败

### Requirement: 协调者可以受控回复当前 Run 消息
`riskflow_reply` MUST 校验期望 revision、幂等键、当前工作项、当前未收口 Run、消息标识和非空正文，再向该 Run 回复目标消息。重复请求 MUST 返回既有结果；目标不属于当前 Run 或尝试已收口时 MUST fail-closed。

#### Scenario: 回复当前 Finalizer 的问题
- **WHEN** 当前 Run 收到带消息标识的问题或升级，协调者提交匹配 revision、幂等键和非空正文
- **THEN** 控制器向该消息发送一次回复，并把结果作为可重放幂等回执返回

#### Scenario: 拒绝过期回复
- **WHEN** 工作项 revision 已变化、当前 Run 已收口或消息不属于当前 Run
- **THEN** 控制器拒绝回复并返回重新读取状态的合法下一动作

### Requirement: wait 在读取下一批消息前确认已处理 Delivery
`riskflow_wait` MUST 接受可选的 `ackDeliveryId`，并在同一次 Orca check 中先确认该 Delivery、再等待下一批 worker 事件。控制器 MUST NOT 自动确认尚未交给协调者处理的当前批次；协调者处理完整批次后 MUST 把返回的 Delivery 标识传给下一次 wait，避免同一批消息重复重放。

#### Scenario: 处理完成后读取下一批消息
- **WHEN** 协调者已处理一次 wait 返回的完整 Delivery，并在下一次 wait 传入该 Delivery 标识
- **THEN** 控制器先确认前一批，再返回后续消息或正常超时，不重复返回已确认批次

### Requirement: Codex worker 只在工作区信任完成后启动
Planning、Finalizer 与 Targeted Auditor 的受控派发 MUST 先在目标 worktree 创建使用 Manifest 模型与强度的 Codex terminal，并在该 terminal 达到 `tui-idle` 后才调用 `worker-start --terminal`。若首次启动停在工作区信任提示，控制器 MUST 返回精确 terminal handle 和受控恢复动作，MUST NOT 自动修改全局信任配置、调用 worker-start 或把 queued Task 标为失败；确认信任后 MUST 复用同一 Task 和 terminal。

#### Scenario: 首次 Codex 启动需要人工信任
- **WHEN** 新 worktree 的 Codex terminal 返回 `agent_prompt_blocked`
- **THEN** 控制器停止在 worker-start 之前，保留 queued Task，并返回精确 terminal handle 供操作者确认信任

#### Scenario: 确认信任后复用当前尝试
- **WHEN** 操作者在该 terminal 确认工作区信任并以新幂等键、同一 terminal handle 重新派发
- **THEN** 控制器确认 terminal 已 idle，复用当前 queued Task，通过 `worker-start --terminal` 启动且不创建第二个 Task 或 terminal

### Requirement: reconcile 只豁免可恢复漂移
`riskflow_reconcile` MUST 只在全局违规均属于 `checkpoint_mismatch` 或 `worktree_reclaim_pending` 时允许创建替代尝试。目标节点归属本身 MUST NOT 豁免重复写者、身份冲突或其他全局违规。

#### Scenario: 修复 checkpoint 漂移
- **WHEN** 目标工作项具有真实工作树和 HEAD，且唯一阻断违规为 checkpoint mismatch
- **THEN** 控制器可按 revision 和幂等键创建新的 planning 或 finalization 尝试

#### Scenario: 重复写者阻止 reconcile
- **WHEN** 目标工作项存在 duplicate writer、身份冲突或不在安全集合中的违规
- **THEN** 控制器拒绝 reconcile，且不创建 Run 或 Task

### Requirement: stale 终态残留只能经重验后回收
cleanup 遇到已归档、主线验证通过、工作树干净、当前尝试成功收口且无状态违规的 stale 工作项时，MUST 只关闭状态投影列出的精确 terminal handles；随后 MUST 重读状态，并仅在同一工作项变为 `reclaimable` 时按完整 worktree ID 回收。任一前提不满足、关闭失败、事实漂移或重读后仍非 reclaimable 时 MUST fail-closed，MUST NOT force 删除。

#### Scenario: 清理精确终态 terminal 后回收
- **WHEN** 已归档成功工作项仅因若干终态 terminal 残留而为 stale
- **THEN** 控制器关闭这些精确 handles、重读状态、确认 reclaimable 后按完整 ID 回收工作树

#### Scenario: 活动或脏工作树拒绝自动清理
- **WHEN** 工作树有未提交改动、主线未验证、尝试未成功收口、存在违规或关闭后仍非 reclaimable
- **THEN** 控制器停止清理并保留工作树，不使用 force 或路径删除
