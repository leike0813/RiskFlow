# Spec Delta

## ADDED Requirements

### Requirement: 任意角色的派发都必须登记运行态

控制器在派发前把尝试登记为 `queued`；worker 接管之后 MUST 把同一尝试登记为 `running`。该要求对全部派发路径一致，MUST NOT 只覆盖其中一种启动方式，否则状态视图会继续声称该尝试待派发并给出重复派发的下一动作。

#### Scenario: 实现派发后状态不再声称待派发
- **WHEN** 控制器通过终端注入方式启动实现 worker 且注入被接受
- **THEN** 台账 MUST 把该尝试登记为 `running`
- **AND** 状态视图 MUST NOT 再给出"派发当前信封指定的受控任务"这类下一动作

#### Scenario: 登记失败不改变已发生的派发
- **WHEN** 运行态登记失败
- **THEN** 控制器 MUST NOT 把该派发报告为失败
- **AND** MUST 以结构化 warning 暴露登记未完成
