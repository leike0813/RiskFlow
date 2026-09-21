# Spec Delta

## MODIFIED Requirements

### Requirement: 受控操作必须执行状态前置校验

派发、结果接收、集成、归档、回收和目标完成 MUST 在执行前校验状态 revision、当前阶段、工作树身份、HEAD、唯一写者、当前 schema 要求的验收工件及证据；拒绝结果 MUST 返回原因和当前合法下一动作。

#### Scenario: finalizing 后请求廉价实现
- **WHEN** 工作项处于 `finalizing` 且没有新的已批准规划版本
- **THEN** 派发操作 MUST 拒绝廉价实现角色
- **AND** MUST 返回继续或移交 Finalizer 的下一动作

#### Scenario: 获批后显式重新规划
- **WHEN** 工作项已进入 `finalizing` 或 `paused`，且派发请求提供非空 `replanApprovalRef`
- **THEN** 系统 MUST 创建 planning v2 信封并记录该批准引用与被取代的 `attemptGroup`
- **AND** 没有批准引用的请求 MUST NOT 使阶段回退到 planning 或 implementing

#### Scenario: 重开规划要求当前尝试可被取代
- **WHEN** 派发请求携带非空 `replanApprovalRef`，但当前尝试仍在活动（`queued`/`running`/`waiting`）或其结局为 `succeeded`
- **THEN** 派发操作 MUST 拒绝该请求，且 MUST NOT 创建 planning v2 边界
- **AND** MUST 返回与状态视图一致的下一动作（等待收口、集成或按批准另开一轮）

#### Scenario: 接收过期验收
- **WHEN** PASS 对应的产物 HEAD 与当前工作树 HEAD 不同
- **THEN** 结果接收操作 MUST 拒绝该 PASS
- **AND** 工作项 MUST 保持未验收状态

#### Scenario: 缺少 schema 声明的验收工件
- **WHEN** finalization 或 audit 请求成功收口，且当前 schema 声明的 verification 工件未完成
- **THEN** 结果接收操作 MUST 在暂存或提交前拒绝该请求
- **AND** 必须指引验收责任者按 schema 指令完成 verification

#### Scenario: 兼容不含验收工件的旧 schema
- **WHEN** 既有 change 的实际 schema 未声明 verification 工件
- **THEN** 结果接收操作 MUST 继续使用既有证据门禁
- **AND** MUST NOT 为兼容检查伪造或要求额外工件

#### Scenario: 逐项修复多个过期检查点
- **WHEN** 多个独立工作项同时只有 checkpoint mismatch 或待回收冲突
- **THEN** reconcile MUST 允许按工作项逐个登记当前实际 HEAD
- **AND** 重复 writer、身份冲突或全局违规仍 MUST 阻止该操作

#### Scenario: 协调命令需要 sender 身份
- **WHEN** 控制器从 Orca terminal 运行会改变 Run、Task 或 Dispatch 的命令
- **THEN** 所有相关写命令 MUST 携带该协调 terminal 的精确 `--from` 身份
- **AND** 状态读取命令 MUST NOT 伪造 sender

#### Scenario: 对账历史任务
- **WHEN** reconcile 为历史检查点创建新的结构化责任任务
- **THEN** 控制器 MUST 创建由当前协调 terminal 持有的新 Run
- **AND** MUST NOT 复用绑定到旧协调会话的 Run

#### Scenario: 目标尚未完成
- **WHEN** 用户目标范围仍有未完成、阻塞、活动责任或缺失证据的工作项
- **THEN** 目标完成操作 MUST 被拒绝
- **AND** MUST 返回恢复队列中的下一项合法工作

### Requirement: stale 终态残留只能经重验后回收

cleanup 遇到已归档、主线验证通过、工作树干净、当前尝试成功收口且无**其他**阻断违规的 stale 工作项时，MUST 只关闭状态投影列出的精确 terminal handles；随后 MUST 重读状态，并仅在同一工作项变为 `reclaimable` 时按完整 worktree ID 回收。回收就绪标记（`worktree_reclaim_pending`）MUST NOT 被当作阻断违规：它是状态视图对 stale/reclaimable 派生出的「待回收」就绪标记，不是冲突。任一其他前提不满足、关闭失败、事实漂移或重读后仍非 reclaimable 时 MUST fail-closed，MUST NOT force 删除。

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
