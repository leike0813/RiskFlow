# orchestration/trust-recovery Specification

## Purpose
TBD - created by archiving change fix-orchestration-trust-recovery-state. Update Purpose after archive.

## Requirements

### Requirement: 信任阻断按可恢复状态呈现

当首次派发因 Codex 工作区信任确认被阻断时，状态视图 MUST 把该工作项呈现为可恢复状态，MUST NOT 落在只能人工审阅的 `unknown`，且 MUST 保留「用同一 terminalHandle 重新派发」的受控恢复动作。

#### Scenario: 规划尝试被信任确认阻断

- **WHEN** 某 change 工作树的新建后首次派发已创建 Task，但规划者尚未创建本地 change，且该尝试未成功
- **THEN** 状态视图 MUST NOT 判出「任务存在但本地缺少 change」冲突
- **AND** 下一角色 MUST 为 planning

#### Scenario: 信任失败被识别

- **WHEN** `worker-start` 或 `tui-idle` 等待失败，且该 terminal 屏幕显示工作区信任提示
- **THEN** 控制器 MUST 按 `workspace_trust_required` 收口并给出携带该 terminalHandle 的恢复动作
- **AND** MUST 记录信任恢复，使状态视图不再把该中间态判为冲突

### Requirement: 未完成规划不得派发实现或收尾

规划尝试未成功（失败、排队未启动或被信任确认阻断）时，控制器 MUST 继续派发 planning；`finalization` 回退 MUST 仅用于已采纳的 auxiliary 工作树。

#### Scenario: 未成功规划后的下一次派发

- **WHEN** 工作项当前尝试的 taskKind 为 planning 且 outcome 不是 succeeded
- **THEN** 下一角色 MUST 为 planning

#### Scenario: 已采纳的 auxiliary 工作树保持原语义

- **WHEN** auxiliary 工作树已有本地 change 且没有关联任务
- **THEN** 下一角色 MUST 仍为 finalization
