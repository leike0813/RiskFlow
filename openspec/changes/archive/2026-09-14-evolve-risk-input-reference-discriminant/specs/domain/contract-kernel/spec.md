## MODIFIED Requirements

### Requirement: 风险评估记录只引用一个风险事件来源

共享风险输入引用与风险评估记录 MUST 通过同一个 `kind` 可辨识联合表达风险来源：识别结果分支必须为 `{ kind: "standardized-risk-record", riskRecordId }`，甲方外部风险事件分支必须为 `{ kind: "external-risk-event", externalRiskEventId }`。运行时 Schema 与由其推导的 TypeScript 类型 MUST 同时保证两种分支二选一且仅一个，并拒绝缺少判别、判别与标识不匹配、同时携带两个标识或包含未声明字段的对象。记录 MUST 保存适用性元数据快照、P/C 分值、风险等级、指标评分明细、触发指标、证据、适用规则集版本、权重版本、风险矩阵版本和审计信息；所有版本引用均为精确版本。（RA-S1、RA-S5）

#### Scenario: 接受识别结果作为评估输入

- **WHEN** 共享风险输入引用或风险评估记录提供 `kind: "standardized-risk-record"`、仅提供 `riskRecordId`，且评估记录包含完整快照、计算结果、证据和版本引用
- **THEN** 对应共享 Schema 接受该对象
- **AND** 推导类型将该对象收窄为识别结果分支

#### Scenario: 接受外部风险事件作为评估输入

- **WHEN** 共享风险输入引用或风险评估记录提供 `kind: "external-risk-event"`、仅提供 `externalRiskEventId`，且评估记录包含完整快照、计算结果、证据和版本引用
- **THEN** 对应共享 Schema 接受该对象
- **AND** 推导类型将该对象收窄为外部风险事件分支

#### Scenario: 拒绝含糊的风险输入

- **WHEN** 风险输入缺少 `kind`、使用未知 `kind`、判别与标识不匹配、同时提供两个风险事件标识、两个标识都未提供或夹带未声明字段
- **THEN** `RiskInputReferenceSchema` 与 `RiskAssessmentRecordSchema` 拒绝对应对象
- **AND** 不通过空字符串、字段存在性或兼容别名选择输入来源

#### Scenario: 类型层拒绝同时携带两个标识

- **WHEN** TypeScript 调用方尝试把同时含 `riskRecordId` 与 `externalRiskEventId` 的对象赋给共享风险输入引用类型
- **THEN** 类型检查失败
- **AND** 调用方不能绕过 `kind` 形成含糊的合法静态类型

#### Scenario: 历史评估保持可重放

- **WHEN** 适用规则集、权重或风险矩阵后来发布新版本
- **THEN** 已校验的历史风险评估记录仍保留原风险输入分支、精确版本引用和适用性元数据快照
- **AND** 共享契约不把引用改写为新版本
