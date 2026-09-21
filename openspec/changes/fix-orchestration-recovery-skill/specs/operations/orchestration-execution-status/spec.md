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

#### Scenario: 已归档 change 留下 terminal
- **WHEN** 工作项只因终态 terminal 残留而 stale
- **THEN** nextActions 指向受控 cleanup，并说明控制器会重验后按完整 worktree ID 回收
