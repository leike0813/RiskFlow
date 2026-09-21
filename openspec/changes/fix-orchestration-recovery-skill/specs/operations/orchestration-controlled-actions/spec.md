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
`riskflow_wait` MUST 接受可选的 `ackDeliveryId`，并在同一次 Orca check 中先确认该 Delivery、再等待下一批 worker 事件。控制器 MUST NOT 自动确认尚未交给协调者处理的当前批次；协调者处理完整批次后 MUST 把返回的 Delivery 标识传给下一次 wait，避免同一批消息重复重放。由于 ack 会持久修改 Delivery 状态，该工具整体 MUST 使用 write approval，MUST NOT 登记为 read tier。

#### Scenario: 处理完成后读取下一批消息
- **WHEN** 协调者已处理一次 wait 返回的完整 Delivery，并在下一次 wait 传入该 Delivery 标识
- **THEN** 控制器先确认前一批，再返回后续消息或正常超时，不重复返回已确认批次

#### Scenario: 无 ack 的等待仍按写工具审查
- **WHEN** 协调者调用未携带 `ackDeliveryId` 的 `riskflow_wait`
- **THEN** OMP 仍按 write approval 审查该工具，避免同一工具因可选参数产生不一致权限

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

### Requirement: 独立 Task 隔离 Agent session
每个独立 Task MUST 使用新的 Agent session。已结束、失败、暂停、释放或长时间闲置的 terminal、Run、Dispatch 和上下文 MUST NOT 用于后续 Task；只有同一仍活动 Task 内的修复与回归可以连续执行。工作区信任恢复发生在 worker-start 前，MAY 复用当前 queued Task 的预热 terminal。活动 Agent 除 question、escalation、连接或进程故障及用户指令外 MUST NOT 接收额外终端输入、被停止或被释放。

#### Scenario: 新的独立任务不复用旧上下文
- **WHEN** 前一 Task 已 worker_done、失败、暂停、释放或长时间闲置，且调度器需要创建后续 Task
- **THEN** 后续 Task 使用新的 Agent session、terminal、Run 和 Dispatch
- **AND** 调度器不得依据旧 context window 或缓存仍可用作出复用决定

#### Scenario: 信任恢复保留尚未启动的当前尝试
- **WHEN** Codex 在 worker-start 前停在当前 queued Task 的工作区信任提示
- **THEN** 操作者确认后复用该 queued Task 与预热 terminal
- **AND** 该操作不创建新 Task，也不视为跨 Task session 复用

## MODIFIED Requirements

### Requirement: 同一收尾轮次禁止重复派发
同一收尾轮次内，控制器 MUST NOT 为审计 finding 派发新的 Finalizer，也 MUST NOT 派发第二次限定审计。Targeted Auditor 发现已批准范围内的普通缺陷时 MUST 在自己的活动 audit Task 内直接修复、回归并更新同一 verification；改变公共契约、权限、事务、持久化、迁移、依赖或批准范围时 MUST escalation。audit Task 结束仍未闭合时，协调端 MUST 停止自动推进并升级给用户。

#### Scenario: 审计在自身活动任务内闭环
- **WHEN** 限定审计发现已批准范围内的普通实现缺陷
- **THEN** Auditor 在当前 audit Task 内完成修复、受影响回归和 verification 更新
- **AND** 协调端不得把 finding 回灌旧 Finalizer session 或创建新的 Finalizer Task

#### Scenario: 审计发现回灌同一会话
- **WHEN** 限定审计得出 finding，且旧 Finalizer 会话仍可见
- **THEN** 协调端不得把 finding 回灌该 Finalizer 会话
- **AND** finding 由当前仍活动的 audit Task 按边界修复，或在无法闭合时升级

#### Scenario: 审计结束时仍未闭合
- **WHEN** audit Task 以 failed、blocked 或 paused 收口且 finding 尚未闭合
- **THEN** 协调端停止自动推进并升级给用户
- **AND** 不复用任何旧 session，不派新的 Finalizer 或第二次审计

#### Scenario: 会话已结束时不重复派发
- **WHEN** audit Task 已结束且 finding 尚未闭合
- **THEN** 协调端停止自动推进并升级给用户
- **AND** 不通过复用旧 session、新建 Finalizer 或第二次审计继续

#### Scenario: 首轮收尾仍按一次审计
- **WHEN** 工作项首次进入收尾且修改触及权限、事务、关键状态机或语义 merge 冲突
- **THEN** 该轮次 MUST 恰好触发一次限定审计
- **AND** 审计结论与任务内修复证据 MUST 进入同一 verification

### Requirement: 派发收尾与审计任务时必须写明本轮协议
规则必须随任务说明送达执行者，而不是靠协调端口头传达。派发 Finalizer 或 Targeted Auditor 时，任务说明 MUST 写明独立 Task 的 session 隔离、本轮最多一次限定审计及各自闭环责任。

#### Scenario: 首个收尾尝试
- **WHEN** 派发本收尾轮次的 Finalizer
- **THEN** 任务说明写明本轮最多一次限定审计、由协调端在需要时触发
- **AND** 要求 verification 为审计结论留出位置

#### Scenario: 限定审计任务
- **WHEN** 派发本轮唯一一次限定审计
- **THEN** 任务说明写明这是新的独立 session，且 Auditor 必须在当前 Task 内修复已批准范围的普通 finding 并回归
- **AND** 超出边界或无法闭合时必须 escalation，不得期待旧 Finalizer 或第二次审计

#### Scenario: 审计 finding 的修复尝试
- **WHEN** 限定审计在当前 audit Task 内发现已批准范围的普通缺陷
- **THEN** 同一任务说明已要求 Auditor 逐项修复、回归并更新 verification
- **AND** 不创建后续修复用 Finalizer Task

#### Scenario: 禁止期待第二轮
- **WHEN** 派发任意 Finalizer 或 Targeted Auditor
- **THEN** 任务说明禁止复用已结束 session、重复 Finalizer 和第二次审计
