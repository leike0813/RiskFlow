## Purpose

本能力用确定性阶段转换约束 RiskFlow 多 Agent 交付，使收尾责任、派发、验收、集成和完成声明只能作用于当前产物及当前合法阶段。

## ADDED Requirements

### Requirement: Finalizer 必须持有收尾责任

change 进入 `finalizing` 后，强模型 Finalizer MUST 在已批准语义范围内完成核验、修复、回归和最终报告；普通实现缺陷 MUST 保留在当前 Finalizer 责任链中。只有已批准的新规划版本才能重开 `implementing`。

#### Scenario: 收尾发现普通实现缺陷
- **WHEN** Finalizer 发现实现未满足已批准行为，且修复不改变公共契约、权限、持久化语义、迁移或依赖
- **THEN** 当前 Finalizer MUST 修复并回归受影响行为
- **AND** 调度器 MUST NOT 派发廉价实现任务接管该缺陷

#### Scenario: 收尾发现设计边界变化
- **WHEN** 修复需要改变公共契约、权限、持久化语义、迁移、新依赖或批准范围
- **THEN** 当前工作项 MUST 暂停并进入有界重新规划
- **AND** 收尾责任 MUST 保留到新的已批准规划明确重开实现阶段

#### Scenario: Finalizer 会话无法继续
- **WHEN** Finalizer 因会话崩溃、上下文或预算限制无法继续
- **THEN** 系统 MUST 将当前检查点和证据移交给新的强模型 Finalizer
- **AND** MUST NOT 因会话终止改变责任角色

#### Scenario: 成功收口只提交已审阅改动
- **WHEN** Finalizer 工作树存在未提交改动且主调度请求成功收口
- **THEN** 请求的 `reviewedPaths` MUST 与实时 `dirtyPaths` 完全一致
- **AND** 系统 MUST 只暂存这些路径；不一致时 MUST 在 Git 副作用前拒绝

### Requirement: 受控操作必须执行状态前置校验

派发、结果接收、集成、归档、回收和目标完成 MUST 在执行前校验状态 revision、当前阶段、工作树身份、HEAD、唯一写者及证据；拒绝结果 MUST 返回原因和当前合法下一动作。

#### Scenario: finalizing 后请求廉价实现
- **WHEN** 工作项处于 `finalizing` 且没有新的已批准规划版本
- **THEN** 派发操作 MUST 拒绝廉价实现角色
- **AND** MUST 返回继续或移交 Finalizer 的下一动作

#### Scenario: 获批后显式重新规划
- **WHEN** 工作项已进入 `finalizing` 或 `paused`，且派发请求提供非空 `replanApprovalRef`
- **THEN** 系统 MUST 创建 planning v2 信封并记录该批准引用与被取代的 `attemptGroup`
- **AND** 没有批准引用的请求 MUST NOT 使阶段回退到 planning 或 implementing

#### Scenario: 接收过期验收
- **WHEN** PASS 对应的产物 HEAD 与当前工作树 HEAD 不同
- **THEN** 结果接收操作 MUST 拒绝该 PASS
- **AND** 工作项 MUST 保持未验收状态

#### Scenario: 逐项修复多个过期检查点
- **WHEN** 多个独立工作项同时只有 checkpoint mismatch 或待回收冲突
- **THEN** reconcile MUST 允许按工作项逐个登记当前实际 HEAD
- **AND** 重复 writer、身份冲突或全局违规仍 MUST 阻止该操作

#### Scenario: 目标尚未完成
- **WHEN** 用户目标范围仍有未完成、阻塞、活动责任或缺失证据的工作项
- **THEN** 目标完成操作 MUST 被拒绝
- **AND** MUST 返回恢复队列中的下一项合法工作

### Requirement: 状态转换必须防止重复执行

所有改变编排状态的操作 MUST 使用期望 revision 和幂等键；同一 Git common dir 内的并发状态操作 MUST 串行提交，重复请求 MUST 返回既有结果。

#### Scenario: 两个调度器同时派发
- **WHEN** 两个操作基于同一 revision 尝试派发同一工作项
- **THEN** 最多一个操作 MUST 成功
- **AND** 另一个操作 MUST 收到状态已变化及重新读取状态的指引

#### Scenario: 重放已完成操作
- **WHEN** 相同幂等键和相同输入被再次提交
- **THEN** 系统 MUST 返回第一次提交的结果
- **AND** MUST NOT 创建第二个 Task、Dispatch 或集成动作

#### Scenario: 上次外部执行结果不确定
- **WHEN** 相同幂等键的持久回执仍为 `inflight`
- **THEN** 系统 MUST 以 `uncertain_prior_execution` 拒绝重放外部副作用
- **AND** MUST 指引调用者重新读取实时状态并对账

### Requirement: 高风险最终产物必须限定独立复核

权限、事务、关键状态机或语义性 merge 冲突经过 Finalizer 实质修改后，系统 MUST 要求另一强模型对受影响范围执行独立 audit；普通 change 的 Finalizer 自验 MUST 足以完成收尾。

#### Scenario: Finalizer 修改高风险语义
- **WHEN** Finalizer 实质修改权限、事务、关键状态机或解决语义性 merge 冲突
- **THEN** 工作项 MUST 在限定 audit 通过前保持未集成
- **AND** audit 责任者 MUST 与该 Finalizer 不同

#### Scenario: 普通实现修复
- **WHEN** Finalizer 只修复已批准范围内的普通实现缺陷
- **THEN** 系统 MUST 接受其回归证据作为最终收尾证据
- **AND** MUST NOT 强制启动第二次全量验收

### Requirement: 可复用操作经验必须与动态状态分离

项目 MUST 保存当前有效的 Orca、OMP、Codex 操作与故障恢复步骤，并由协调与执行 Agent 在相关操作前读取；这些步骤 MUST 与稳定策略分开维护，且 MUST NOT 包含当前 frontier、HEAD、Run、Task、terminal 或历史进度。当前接管起点 MUST 只由实时状态生成。

#### Scenario: 新 worktree 首次启动 Codex
- **WHEN** Codex 因当前 worktree 尚未信任而返回 `agent_prompt_blocked`
- **THEN** 操作步骤 MUST 指引先在精确 terminal 完成信任并确认 Agent idle
- **AND** 系统 MUST 复用原 Task 恢复派发，不得把该提示记为实现失败或创建重复 Task

#### Scenario: 新会话读取操作手册
- **WHEN** 新协调 Agent 读取操作与恢复步骤
- **THEN** 文档 MUST 指引其从 `revision`、`resumeQueue` 和 `violations` 接管
- **AND** 文档 MUST NOT 提供带当前指令效力的固定工作项、检查点或 Run/Task 标识
