## ADDED Requirements

### Requirement: 公共引用必须闭合覆盖规则冲突复核目标

系统 MUST 在公共契约引用中提供 `rule-conflict` 分支。该分支 MUST 只包含固定 kind、规则冲突实体标识和精确版本标识，并与 `reviewType=rule-conflict` 的复核目标、复核任务和决定使用同一引用语义；不得携带冲突正文、规则正文、自由字段或第二套冲突身份。新增分支 MUST 不改变既有公共引用 kind 的字段与语义，公共引用仍须拒绝未知 kind 和契约外字段。（RA-S3、RA-S4）

#### Scenario: 规则冲突进入引用式复核链

- **WHEN** 调用方以 `rule-conflict` kind、非空实体标识和精确版本标识提交规则冲突复核目标
- **THEN** 公共引用、`reviewType=rule-conflict` 的复核请求与复核任务 Schema 接受同一目标引用
- **AND** 复核请求事务事件、审计和追溯链可以保存该精确目标引用而不复制冲突正文

#### Scenario: 拒绝不精确或夹带正文的规则冲突引用

- **WHEN** 规则冲突引用缺少实体标识或版本标识，或附带冲突详情、规则内容及任意未声明字段
- **THEN** 公共引用与复核契约拒绝该输入
- **AND** 系统不得以自由字段、空字符串或可变“当前版本”补足引用

#### Scenario: 既有闭合引用保持兼容

- **WHEN** 调用方提交任一既有公共引用 kind 或未声明的新 kind
- **THEN** 既有 kind 仍按原字段与语义完成校验，未声明 kind 仍被拒绝
- **AND** 新增 `rule-conflict` 分支不放宽其它判别联合或枚举
