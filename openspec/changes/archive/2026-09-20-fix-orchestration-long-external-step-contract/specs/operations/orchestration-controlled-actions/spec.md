# Spec Delta

## ADDED Requirements

### Requirement: 长外部步骤必须让出运行时锁并事后重新校验

控制器的部分受控操作需要在锁内执行耗时外部命令（集成的主线复验最长 30 分钟）。此类步骤 MUST 在锁外执行并立即重新取锁，且 MUST NOT 用陈旧事实写入状态。

#### Scenario: 长步骤执行期间其他受控操作仍可提交
- **WHEN** 某个操作正在执行长外部步骤并已让出运行时锁
- **THEN** 其他受控操作 MUST 能正常获取锁并完成提交
- **AND** MUST NOT 因该长步骤而以 `control_busy` 失败

#### Scenario: 让出期间事实变化则拒绝写入
- **WHEN** 长外部步骤执行期间编排事实集发生变化，使该操作起始时的 `expectedRevision` 不再成立
- **THEN** 重新取锁后 MUST fail-closed，报告状态已变化并指引重新读取状态
- **AND** MUST NOT 把该步骤的结果写入任务信封、台账或回执的成功分支

#### Scenario: 长步骤失败仍保持回执不确定
- **WHEN** 长外部步骤自身失败
- **THEN** 控制器 MUST 以既有不确定语义处置该次幂等执行
- **AND** MUST NOT 声称已完成该步骤

#### Scenario: 产生编排副作用的短操作继续全程持锁
- **WHEN** 操作会在 Orca 上创建或改写 Run、Task、Dispatch，或写入尝试台账
- **THEN** 该操作 MUST 全程持有运行时锁
- **AND** 并发提交 MUST 至多有一个成功

### Requirement: 外部验证步骤必须在不继承协调者身份的环境下执行

协调终端会设置 `ORCA_TERMINAL_HANDLE`，而 `resolveOrcaInvocation` 依据它把 CLI 从 `orca-ide` 切换为 `orca`。外部验证命令 MUST 在不继承该身份的环境下执行，使验证结论与发起终端无关。

#### Scenario: 从 Orca 终端发起的主线复验
- **WHEN** 控制器在已设置 `ORCA_TERMINAL_HANDLE` 的协调终端中执行外部验证命令
- **THEN** 该命令 MUST NOT 继承 `ORCA_TERMINAL_HANDLE` 与 `ORCA_CLI_COMMAND`
- **AND** 编排测试 MUST 与在干净 shell 中执行时得到相同结论

#### Scenario: 编排测试与调用方环境隔离
- **WHEN** 编排测试套件在已设置 ambient 编排身份的进程中运行
- **THEN** 用例 MUST 自行界定该环境并保持可重复
- **AND** 验证结论 MUST NOT 取决于调用方终端
