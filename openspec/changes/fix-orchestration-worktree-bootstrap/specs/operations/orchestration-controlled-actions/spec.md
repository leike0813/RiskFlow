## ADDED Requirements

### Requirement: 受控 Codex 派发必须限定当前工作树信任

Planning、Finalizer 与 Targeted Auditor 的 Codex terminal 启动命令 MUST 只针对本次受管工作树的精确路径提供信任配置，并在向 worker 提交任务前生效。该配置 MUST 可重复使用、随该 terminal 结束而撤销，MUST NOT 修改用户的其他 Codex 配置、其他路径的信任决定或 Orca 的工作树身份。若信任仍被阻断，现有 `workspace_trust_required` 屏幕探测、queued Task 和同 terminalHandle 恢复语义 MUST 保留。

#### Scenario: 新受管工作树首次启动 Codex
- **WHEN** 控制器为当前已核验身份的受管工作树创建 Planning、Finalizer 或 Targeted Auditor 的新 Codex terminal
- **THEN** 启动配置 MUST 只将该工作树的精确绝对路径标记为 trusted，并在 `worker-start` 前生效
- **AND** worker 可在该 terminal 达到 idle 后接收任务，不需要手工修改用户级配置

#### Scenario: 重复派发或信任已存在
- **WHEN** 同一受管工作树再次创建独立 Codex terminal，或目标路径已有信任配置
- **THEN** 本次启动 MUST 仍只作用于目标路径，不产生重复持久配置，也不改变其他项目设置

#### Scenario: 非目标工作树与非 Codex worker
- **WHEN** 派发目标并非当前受管工作树，或本次启动的是 Implementation 的非 Codex terminal
- **THEN** 控制器 MUST NOT 对其注入当前工作树的信任配置
- **AND** 不得借此改动用户级配置或其他工作树的信任状态

#### Scenario: 启动后仍出现信任提示
- **WHEN** 受控 Codex terminal 在等待 idle 或 `worker-start` 输入阶段仍显示工作区信任提示
- **THEN** 控制器 MUST 按既有屏幕探测归类为 `workspace_trust_required`，保留 queued Task 并返回同 terminalHandle 的恢复动作
- **AND** MUST NOT 静默扩大信任范围、创建替代 Task 或把提示计为实现失败
