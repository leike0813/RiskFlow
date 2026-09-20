# Spec Delta

## MODIFIED Requirements

### Requirement: 长外部步骤必须让出运行时锁并事后重新校验

控制器的部分受控操作需要在锁内执行耗时外部命令（集成的主线复验最长 30 分钟）。此类步骤 MUST 在锁外执行并立即重新取锁，且 MUST NOT 用陈旧事实写入状态。事后校验 MUST 只比对该步骤真正依赖的事实——工作项状态、当前尝试身份、主线 HEAD 与是否存在状态违规——MUST NOT 比对全量事实集哈希，否则步骤自身的构建/测试产物会被误判为并发写者。

#### Scenario: 长步骤执行期间其他受控操作仍可提交
- **WHEN** 某个操作正在执行长外部步骤并已让出运行时锁
- **THEN** 其他受控操作 MUST 能正常获取锁并完成提交
- **AND** MUST NOT 因该长步骤而以 `control_busy` 失败

#### Scenario: 长步骤自身的瞬时副作用不丢弃结果
- **WHEN** 长外部步骤执行期间只有该步骤自身产生的瞬时文件变化（工作项状态、当前尝试、主线 HEAD 与违规集合均未变）
- **THEN** 控制器 MUST 继续按该步骤的结果写入状态
- **AND** MUST NOT 以 `stale_revision` 拒绝

#### Scenario: 让出期间事实变化则拒绝写入
- **WHEN** 长外部步骤执行期间工作项状态、当前尝试身份、主线 HEAD 或违规集合发生变化
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
