## ADDED Requirements

### Requirement: 专用只读端口加法式暴露校准批准证明

系统 MUST 以 strict Zod Schema 和独立的 `CalibrationSuggestionApprovalProofPortV1` 增加专用校准建议决定证明查询及闭合结果，输入只包含工程、精确 `CalibrationSuggestionRefV1`、精确 `ReviewDecisionRefV1` 和版本化授权上下文；匹配结果必须闭合区分 `approved-for-draft`、`rejected` 和 `returned-for-revision`，且只包含建议、复核任务、决定和决定时间的精确引用，缺失或目标错配结果只包含稳定原因。该加法式端口 MUST 保持现有 `ReviewAuditPortV1`、`requestReview`、`decideReview`、`trace`、知识修订批准证明查询、命令和事件签名不变，并复用既有 `review-audit.read` 能力，不得增加角色、能力或权限枚举。（RA-S7）

#### Scenario: 下游只通过公共端口取得精确决定证明
- **WHEN** 校准领域需要判断一个精确建议被批准、拒绝或退回
- **THEN** 下游通过新增只读查询取得带精确决定类型的闭合证明结果
- **AND** 不直接读取 C07 数据表、复制决定事实或解析审计活动文案

#### Scenario: strict 查询拒绝多余或不精确输入
- **WHEN** 查询缺少建议或决定的精确版本，或携带决定正文、证据正文、数据库定位及任意未声明字段
- **THEN** strict 公共契约拒绝输入
- **AND** 不以 latest、空字符串或自由文本补足

#### Scenario: 既有复核端口保持兼容
- **WHEN** 既有调用方继续使用复核请求、决定、追溯或知识修订批准证明查询
- **THEN** `ReviewAuditPortV1` 及其原输入、结果、状态、决定和事件语义保持不变
- **AND** 新增校准证明查询不扩大任何调用方权限

### Requirement: C25 通过加法式窄读端口证明冻结评估输入

系统 MUST 由 C25 实现独立的 `AssessmentInputSnapshotReaderV1` 类窄读端口，按工程和精确 `AssessmentInputSnapshotRefV1` 返回该快照绑定的工程、空间范围、`AssessmentBasisReleaseSetRefV1` 以及校准目标发布引用与内容摘要。端口 MUST 复用 C25 既有只读能力并在读取正文前验证 C06 授权，不得由 C29 直读 `business.assessment_input_snapshots`、增加能力或角色枚举，或提供列表/latest 查询。（RA-S7）

#### Scenario: 精确快照读取返回最小冻结投影
- **WHEN** 获授权调用方按同一工程和精确版本读取评估输入快照
- **THEN** C25 返回足以核对空间、依据集合和目标发布摘要的最小投影
- **AND** 不返回数据库行、评估正文、其它工程事实或未声明内部字段

#### Scenario: 缺失、陈旧或越权快照失败关闭
- **WHEN** 快照不存在、版本陈旧、工程或空间超出当前授权
- **THEN** 端口在披露冻结投影前返回类型化失败
- **AND** 不回退到 latest、调用方提供的依据集合或 C25 私表旁路
