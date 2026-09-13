## ADDED Requirements

### Requirement: 预警确认必须以独立的已读接管命令表达

系统 MUST 在既有预警处置 `record` interface 中提供 `acknowledge` 写命令分支。该分支的 strict payload MUST 且只能包含 `warningRecordRef` 与 `warningResponseTaskRef` 两个精确版本引用，并 MUST 沿用公共命令信封的命令标识、业务幂等键、工程、操作者、发起时间和版本化授权上下文；两个引用 MUST 属于同一获授权工程和空间，且任务精确版本 MUST 归集该预警精确版本。成功结果 MUST 是 `{ kind: "acknowledgement", status: "acknowledged", warningRecordRef, warningResponseTaskRef }` 的 strict 分支，只返回已确认配对的精确引用与确认状态。（RA-S6、RA-S7）

预警确认只表示工程风险管理员已读并接管已入库生效的预警。系统 MUST NOT 因确认而解除风险、关闭预警处置任务、改变风险等级或触发状态、改写预警信息或风险评估记录，也 MUST NOT 把确认解释为处置建议采纳、现场执行、处置反馈、偏差结论或校准生效。建议采纳、执行、反馈、偏差和校准 MUST 继续使用各自既有 `record` 分支；`open` 与通知投递语义保持不变。

系统 MUST 在确认事实、审计和待发布事件原子成立时产生 `warning.warning-acknowledged.v1`。事件信封 MUST 沿用既有版本、工程、时间、因果、生产命令、幂等、授权和审计字段，`aggregateRef` MUST 是结果中的精确 `warningResponseTaskRef`；事件 payload MUST 且只能包含结果中的 `warningRecordRef` 与 `warningResponseTaskRef`，不得复制预警、评估、任务、通知或处置正文。

#### Scenario: 获授权管理员确认精确预警任务配对
- **WHEN** 工程风险管理员以具备 `warning-response.record` 能力的授权上下文、唯一命令标识和业务幂等键，提交同一工程内仍可确认且相互关联的预警与处置任务精确引用
- **THEN** `record` interface 返回 `kind=acknowledgement`、`status=acknowledged` 及该预警和任务的精确引用
- **AND** 系统原子保存确认事实、只追加审计和 `warning.warning-acknowledged.v1` 待发布事件

#### Scenario: 确认不改变风险与处置结论
- **WHEN** 一个已入库生效的预警被成功确认
- **THEN** 预警事实、其风险评估记录、风险等级和触发依据保持原精确版本与内容
- **AND** 任务不因确认而关闭，也不产生建议采纳、执行、反馈、偏差、校准或风险解除结果

#### Scenario: 不可枚举地拒绝无权或不匹配目标
- **WHEN** 调用方无确认能力、引用跨工程或越出获准空间，或者预警/任务任一不存在、精确版本不再可确认或任务未归集该预警
- **THEN** 系统在任何确认事实、审计成功记录或事件副作用前拒绝命令
- **AND** 对无权调用方使用与目标不存在不可区分的安全失败，不泄露预警、任务或关联关系是否存在

#### Scenario: 相同确认命令幂等重放
- **WHEN** 调用方以相同工程、`acknowledge` kind、业务幂等键和完全相同的精确引用 payload 重试已成功命令
- **THEN** 系统返回首次提交的同一逻辑确认结果
- **AND** 不重复保存确认事实、审计或事件

#### Scenario: 冲突重放与并发接管不覆盖原决定
- **WHEN** 调用方复用同一业务幂等键但改变任一精确引用，或多个不同命令竞争确认同一尚未确认的任务精确版本
- **THEN** 同键异载荷返回不可重试的幂等冲突，并发竞争只有一个命令可建立确认事实，其余命令返回类型化陈旧版本或业务冲突
- **AND** 系统不覆盖首次确认及其操作者、审计或事件

#### Scenario: strict 契约拒绝确认越权字段和伪处置状态
- **WHEN** 确认命令、结果或事件携带风险解除、任务关闭、处置结论、客户端操作者/授权覆盖、业务正文或其它契约外字段
- **THEN** 对应 strict 公共 Schema 拒绝该对象
- **AND** 既有建议采纳、执行、反馈、偏差、不可用和校准结果分支仍按原字段与语义通过校验
