# Spec Delta

## ADDED Requirements

### Requirement: 冷启动上下文直接给出调度关注项
协调扩展在新会话建立上下文时 MUST 基于实时状态给出确定性的关注摘要，至少区分可执行 `resumeQueue`、阻断 `violations`、待收口 stale worktree 和非阻断历史 `diagnostics`。摘要 MUST NOT 把 diagnostics 当作当前队列或清理授权，也 MUST NOT 嵌入历史会话标识作为执行事实。

#### Scenario: 同时存在队列和历史诊断
- **WHEN** 状态含可执行工作项与 historical orphan diagnostics，但没有阻断违规
- **THEN** 冷启动上下文明确要求按 resumeQueue 推进，并把 diagnostics 标为非阻断调查信息

#### Scenario: 存在 stale 工作树
- **WHEN** 状态包含 stale worktree
- **THEN** 冷启动上下文列出对应工作项和其当前 nextAction，不建议直接删除或 force 清理

#### Scenario: 新辅助工作树尚未形成检查点
- **WHEN** 辅助 change 的 worktree HEAD 仍等于 main，但已有未提交实现且没有关联任务
- **THEN** 状态将其列为待 adopt 的 recovery，而不是误判为已经 merged

### Requirement: 阻塞状态返回可执行下一动作
状态视图 MUST 为常见阻塞状态返回与当前事实对应的具体下一动作：需要回答消息时指向受控回复，需要重建尝试时指向 reconcile，需要关闭终态残留时指向 cleanup；无法由受控工具安全处理时 MUST 明确升级，而不是只给出“处理 blocker”一类循环提示。

#### Scenario: 失败 worker 留下运行中 checkpoint
- **WHEN** 当前 worker 已失败而 checkpoint 仍显示 running，且无更高优先级冲突
- **THEN** nextActions 指向读取最新 revision 后执行受控 reconcile，而不是要求对 blocked Task 做非法状态转换

#### Scenario: 同一 Task 的旧失败 Dispatch 与当前 live Dispatch 并存
- **WHEN** 同一当前 Task 同时存在历史 failed Dispatch 和非终态 live Dispatch
- **THEN** 状态以 live Dispatch 为当前运行事实，不进入失败恢复

#### Scenario: 已归档 change 留下 terminal
- **WHEN** 工作项只因终态 terminal 残留而 stale
- **THEN** nextActions 指向受控 cleanup，并说明控制器会重验后按完整 worktree ID 回收

## MODIFIED Requirements

### Requirement: 审计未通过必须保持收尾责任
限定审计以 failed、blocked 或 paused 收口时，状态 MUST 保持在收尾阶段但标记为 `paused`，MUST NOT 回退到实现、重新规划、复用旧 session 或生成新 Finalizer / 第二次 audit 的派发动作。下一动作 MUST 明确要求向用户升级。

#### Scenario: 审计任务未闭合
- **WHEN** 当前尝试为 audit 且以 failed、blocked 或 paused 收口
- **THEN** 状态报告 `paused`，下一动作要求向用户升级
- **AND** `resumeQueue` 不提供自动派发新的 Finalizer 或 audit 的路径

#### Scenario: 审计发现缺陷后仍可派发修复
- **WHEN** 当前 audit Task 尚在活动且发现已批准范围内的普通缺陷
- **THEN** 修复在当前 audit Task 内继续，不创建新的修复 Dispatch
- **AND** audit Task 已结束仍未闭合时按 paused 升级，不自动派发

#### Scenario: 实现或收尾的失败语义不变
- **WHEN** 当前尝试为 implementation 或 finalization 且以失败收口
- **THEN** 状态保持既有判定与下一动作

### Requirement: 同一收尾轮次最多一次限定审计
同一收尾轮次内限定审计最多一次。状态视图 MUST 显式给出该轮次是否仍需要审计（`auditRequired`）；一旦本轮已有已收口的 audit 尝试，MUST NOT 再要求第二次审计。成功 audit 直接进入已验收态；未成功 audit 按“审计未通过必须停止自动派发”处理。

#### Scenario: 尚未审计时要求一次审计
- **WHEN** finalization 成功收口、`auditPolicy` 为 `targeted`，且本轮没有已收口 audit
- **THEN** 状态标记 `auditRequired` 为真并给出派发限定审计的下一动作

#### Scenario: audit 在自身任务内闭环成功
- **WHEN** 本轮唯一 audit 在当前 Task 内完成 finding 修复、回归和 verification，并成功收口
- **THEN** 状态标记 `auditRequired` 为假并进入已验收态
- **AND** 下一动作为集成，不派新的 Finalizer 或 audit

#### Scenario: 本轮已审计后不再要求第二次
- **WHEN** 本收尾轮次内已存在成功收口的 audit 尝试
- **THEN** 状态不再要求审计（`auditRequired` 为假）
- **AND** 工作项直接进入已验收态，下一动作为集成

#### Scenario: 判定范围随最新获批边界
- **WHEN** 工作项经过一次获批重开规划进入新的收尾轮次
- **THEN** 边界之前的已收口审计不抑制新轮次审计
