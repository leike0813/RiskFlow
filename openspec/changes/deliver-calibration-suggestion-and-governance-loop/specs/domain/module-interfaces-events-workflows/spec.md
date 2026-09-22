## ADDED Requirements

### Requirement: 专用只读端口加法式暴露校准批准证明

系统 MUST 以 strict Zod Schema 和独立的 `CalibrationSuggestionApprovalProofPortV1` 增加专用校准建议批准证明查询及闭合结果，输入只包含工程、精确 `CalibrationSuggestionRefV1`、精确 `ReviewDecisionRefV1` 和版本化授权上下文；已批准结果只包含建议、复核任务、决定和决定时间的精确引用，未批准结果只包含稳定原因。该加法式端口 MUST 保持现有 `ReviewAuditPortV1`、`requestReview`、`decideReview`、`trace`、知识修订批准证明查询、命令和事件签名不变，并复用既有 `review-audit.read` 能力，不得增加角色、能力或权限枚举。（RA-S7）

#### Scenario: 下游只通过公共端口取得证明
- **WHEN** 校准领域需要判断一个精确建议是否获准创建配置草案
- **THEN** 下游通过新增只读查询取得闭合证明结果
- **AND** 不直接读取 C07 数据表、复制决定事实或解析审计活动文案

#### Scenario: strict 查询拒绝多余或不精确输入
- **WHEN** 查询缺少建议或决定的精确版本，或携带决定正文、证据正文、数据库定位及任意未声明字段
- **THEN** strict 公共契约拒绝输入
- **AND** 不以 latest、空字符串或自由文本补足

#### Scenario: 既有复核端口保持兼容
- **WHEN** 既有调用方继续使用复核请求、决定、追溯或知识修订批准证明查询
- **THEN** `ReviewAuditPortV1` 及其原输入、结果、状态、决定和事件语义保持不变
- **AND** 新增校准证明查询不扩大任何调用方权限
