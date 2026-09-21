# Spec Delta

## ADDED Requirements

### Requirement: 工作树供给必须能从无法确认的外部副作用中恢复

`ready` 节点的 feature 工作树由控制器供给。Orca CLI 的创建调用 MUST 作为首选路径；该调用因运行时不可用或响应丢失而失败时，控制器 MUST 依据仓库公开元数据（`worktreeBasePath`、`worktreeBaseRef`、`hookSettings.scripts.setup`）在 Orca 同一布局下自行确认或建立工作树，并从 `orca worktree list` 取回受管身份。取回的身份 MUST 经核验唯一且与请求的工作项一致；无法确认时 MUST fail-closed 并保留原始错误，MUST NOT 以猜测的身份继续派发，也 MUST NOT 因响应丢失而中止一次副作用已经发生的派发。

#### Scenario: Orca CLI 正常返回
- **WHEN** `orca worktree create` 成功返回受管工作树身份
- **THEN** 控制器 MUST 继续使用该身份
- **AND** MUST NOT 触发自持建立路径或改动其语义

#### Scenario: 响应丢失但副作用已发生
- **WHEN** Orca 创建调用以运行时不可用或响应丢失失败，且期望路径上已存在本仓库的 git 工作树且 HEAD 等于请求的基线
- **THEN** 控制器 MUST 取回该工作树的受管身份并继续派发
- **AND** MUST NOT 再次建立工作树或中止派发

#### Scenario: 副作用未发生
- **WHEN** Orca 创建调用以运行时不可用或响应丢失失败，且期望路径上不存在可用的工作树
- **THEN** 控制器 MUST 在期望路径建立工作树、执行仓库 setup 脚本并取回身份
- **AND** 建立后取不到唯一身份时 MUST fail-closed，保留原始错误并提示 `externalWorktreeVisibility`

#### Scenario: 业务错误仍然致命
- **WHEN** Orca 创建调用以参数、命名或权限类业务错误失败
- **THEN** 控制器 MUST 直接冒泡该错误
- **AND** MUST NOT 以自持建立掩盖该错误

#### Scenario: 身份取回不唯一或不完整
- **WHEN** 匹配到多个工作树，或记录缺少 `id`/`path`/`head`，或 HEAD 与请求基线不一致
- **THEN** 控制器 MUST 以结构化错误拒绝该次派发
- **AND** MUST NOT 写入任务信封、台账或回执的成功分支

#### Scenario: setup 脚本失败
- **WHEN** 仓库 setup 脚本任一行非零退出或超时
- **THEN** 控制器 MUST 以结构化 warning 暴露该事实
- **AND** MUST NOT 把它报告为成功的供给，也 MUST NOT 因此丢弃已经确认的工作树身份

### Requirement: 复用已排队尝试必须保持尝试自身的角色身份

调度器复用"已排队但尚未启动"的尝试时，所派发的角色、阶段与任务说明 MUST 全部取自该尝试自身的 `taskKind`。MUST NOT 用工作项当前阶段重新推导出与该尝试不同的角色，否则不同的任务说明与模型会组合成一次身份不一致的运行。

#### Scenario: 排队中的规划尝试
- **WHEN** 检查点是 `taskKind` 为 `planning` 的排队尝试
- **THEN** 控制器 MUST 以规划角色与规划任务说明启动该尝试
- **AND** MUST NOT 派发实现角色或把该尝试记成实现尝试

#### Scenario: 无排队尝试
- **WHEN** 工作项没有可复用的排队尝试
- **THEN** 控制器 MUST 保持既有的下一角色推导语义

#### Scenario: 尝试的角色未知
- **WHEN** 排队尝试的 `taskKind` 在 Manifest 角色表中不存在
- **THEN** 控制器 MUST 以结构化错误拒绝派发
- **AND** MUST NOT 以其它角色代替启动
