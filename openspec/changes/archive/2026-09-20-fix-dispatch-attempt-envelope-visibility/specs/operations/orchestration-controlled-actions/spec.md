# Spec Delta

## ADDED Requirements

### Requirement: 当前尝试必须由控制器自持台账登记

监督派发起步与 worker 报告收口都会整体覆盖 Orca Task 的 `result`，而该字段历史上承载 v2 执行信封。控制器 MUST 把当前尝试的完整信封另外持久化在 git common dir 的自有台账中，并在尝试进入新状态时更新；台账 MUST NOT 位于仓库工作树内。

#### Scenario: 派发前登记尝试
- **WHEN** 控制器准备派发一个工作项
- **THEN** 控制器 MUST 在启动任何 worker 之前把该尝试以 `runState = queued` 登记入台账
- **AND** 台账不可写时 MUST NOT 启动 worker

#### Scenario: worker 启动成功后登记运行态
- **WHEN** 监督 worker 成功启动
- **THEN** 控制器 MUST 把同一尝试以 `runState = running` 更新入台账
- **AND** `attempt`、`attemptGroup`、`auditPolicy`、`owner`、`issueRefs`、`evidenceRefs` 与阶段 MUST 与派发信封一致
- **AND** MUST NOT 预填 `outcome`、`outputHead` 或任何质量结论

#### Scenario: 台账登记失败不得伪造派发结果
- **WHEN** 派发已成功启动 worker，但运行态登记失败
- **THEN** 控制器 MUST NOT 把该派发报告为失败或要求重新派发
- **AND** MUST 以结构化 warning 暴露登记未完成

#### Scenario: 受控收口后台账与本地产物一致
- **WHEN** 受控收口接受一次终态结果
- **THEN** 控制器 MUST 以同一终态信封更新台账
- **AND** 台账记录的产物 HEAD MUST 与该次收口的实际 HEAD 一致
