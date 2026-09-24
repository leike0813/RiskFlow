## ADDED Requirements

### Requirement: 受控 Codex 派发必须明确当前工作树的信任阻断

Planning、Finalizer 与 Targeted Auditor 的 Codex terminal 在 `worker-start` 前需要当前受管工作树的信任时，控制器 MUST 返回既有类型化 `workspace_trust_required` 结果，包含完整工作树路径、精确 terminalHandle 和修复指引。指引 MUST 允许协调端或人在该 Orca terminal 手动完成信任，或只为该路径设置用户级 `[projects."<path>"]` 下的 `trust_level = "trusted"`；控制器 MUST NOT 自动改写用户级配置或其他路径的信任决定。恢复 MUST 复用已归档 `orchestration/trust-recovery` 的 queued Task 与同 terminalHandle 语义。

#### Scenario: 当前受管工作树需要信任
- **WHEN** 控制器在等待 Codex idle 或 `worker-start` 输入阶段识别到当前工作树的信任提示
- **THEN** 控制器 MUST 返回含该工作树完整绝对路径、精确 terminalHandle 和上述修复指引的 `workspace_trust_required`
- **AND** MUST 保留 queued Task，并提供同 terminalHandle 的恢复动作，不创建替代 Task

#### Scenario: 当前受管工作树已信任
- **WHEN** Codex terminal 已完成当前工作树的信任并达到 idle
- **THEN** 控制器 MUST 正常提交 worker 任务，不得报告信任阻断

#### Scenario: 信任探测不可用或配置不可读
- **WHEN** Codex 未能达到 idle，且 terminal 信任提示无法探测或配置不可读
- **THEN** 控制器 MUST 失败闭合，不得推断为已信任或提交 worker 任务

#### Scenario: 非目标工作树与非 Codex worker
- **WHEN** 受管工作树身份与路径不一致，或本次启动的是 Implementation 的非 Codex terminal
- **THEN** 控制器 MUST 在身份不一致时拒绝 Codex 启动，且 MUST NOT 为非 Codex terminal 添加信任操作
