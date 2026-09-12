## ADDED Requirements

### Requirement: 精确监测序列修订可按当前授权狭窄读取

系统 MUST 提供 C14 所有的狭窄只读能力，以精确 `MonitoringSeriesRefV1`、工程、调用身份、读取身份、请求时间和 C06 授权上下文读取一个监测序列修订。系统 MUST 在返回前重新校验当前 `engineering-data.read` 工程和空间权限；成功结果 MUST 只包含 `monitoringSeriesRef`、`seriesId`、`projectId`、`projectRevisionRef`、`spatialScopeRef`、`monitoringObject`、`monitoringIndicator`、`parameterCode`、`canonicalUnit`、显式 `unitConversions`、`effectivePeriod`、`recordedAt`、可选 `previousRevisionRef` 和 `current | superseded` 修订状态。结果 MUST 使用 strict Schema，不得包含原始或规范监测值、批次、样本、快照对齐点、特征、来源正文、自由字段或列表查询能力。每次成功读取 MUST 通过既有原子幂等语义只追加命令收据和审计，不得复制或修改序列注册事实。（RI-S14、RI-S21、RI-S43；RA-S1、RA-S5、RA-S6）

#### Scenario: 获授权读取精确序列修订元数据
- **WHEN** 调用方提交属于目标工程的精确序列修订引用，并持有覆盖该序列空间区段的当前 C06 读取授权
- **THEN** 系统返回该精确修订的身份、指标、参数码、规范单位、显式换算、版本引用、有效期和 `current | superseded` 状态
- **AND** 调用方可用 `monitoringIndicator + parameterCode` 和单位字段核对 C18 的监测字段映射

#### Scenario: 序列元数据读取不泄露监测数据
- **WHEN** 获授权调用方读取一个精确序列修订
- **THEN** strict 结果不含原始或规范监测值、批次、样本、对齐点、快照特征、来源正文或未声明字段
- **AND** 监测值和特征仍只能通过既有获授权快照查询路径读取

#### Scenario: 目标或授权异常不可枚举
- **WHEN** 精确序列修订在请求工程中缺失、不存在、版本不匹配或属于其它工程，或者调用方的工程或空间授权已撤销
- **THEN** 系统统一返回 `AUTHORIZATION_DENIED`
- **AND** 错误不泄露序列是否存在、所属工程、当前版本、指标、单位或其它修订信息

#### Scenario: 重复读取只记录一次审计
- **WHEN** 调用方以相同读取身份重试完全相同的精确序列修订读取
- **THEN** 系统返回同一精确修订的有界结果并复用既有成功收据
- **AND** 不重复追加审计或任何序列事实

#### Scenario: 相同读取身份不能改换目标
- **WHEN** 调用方复用已完成的读取身份但改变工程、序列修订引用、调用身份、请求时间或授权上下文
- **THEN** 系统返回 `IDEMPOTENCY_CONFLICT`
- **AND** 原收据、审计和序列事实保持不变
