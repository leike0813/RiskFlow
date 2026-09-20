# Spec Delta

## ADDED Requirements

### Requirement: 派发收尾与审计任务时必须写明本轮协议

规则必须随任务说明送达执行者，而不是靠协调端口头传达。派发收尾/审计任务时，任务说明 MUST 写明该尝试在本收尾轮次中的位置与义务，MUST 使执行者无需猜测即可闭合本轮。

#### Scenario: 首个收尾尝试
- **WHEN** 派发的 finalization 尝试是本收尾轮次的第一个尝试
- **THEN** 任务说明 MUST 写明本轮最多一次限定审计、由协调端在需要时触发
- **AND** MUST 要求该尝试的 verification 为审计结论留出位置

#### Scenario: 审计 finding 的修复尝试
- **WHEN** 本轮已存在已收口的失败 audit 尝试，随后派发修复用的 finalization 尝试
- **THEN** 任务说明 MUST 直接列出该审计的 task id、`issueRefs` 与 `evidenceRefs`，并要求逐项闭合
- **AND** MUST NOT 只让执行者自行到工件中寻找 finding

#### Scenario: 限定审计任务
- **WHEN** 派发本轮唯一一次限定审计
- **THEN** 任务说明 MUST 写明它是本轮唯一审计、只报告 finding 与证据、不改产品代码
- **AND** MUST 说明其结论将写入同一 verification 并由本轮修复尝试逐项闭合

#### Scenario: 禁止期待第二轮
- **WHEN** 派发任意收尾或审计任务
- **THEN** 任务说明 MUST 写明禁止请求或期待第二次审计或新的 Finalizer
- **AND** MUST 说明机制上无法在会话内完成时必须 escalation
