## ADDED Requirements

### Requirement: C34 只读分支必须进入唯一 HTTP 路由目录

系统 MUST 登记 `POST /api/v1/projects/:projectId/queries/risk-assessment.read` 与 `POST /api/v1/projects/:projectId/queries/warning-response.read`，分别映射独立只读端口、strict 请求/结果与既有同名能力。运行路由与 OpenAPI MUST 从同一目录派生，未注入端口时不激活。客户端只提交既有查询传输信封及闭合 payload，工程/主体/授权由服务端组装；不增加能力枚举、错误码、通用执行入口或传输信封。（RA-S1～RA-S7）

#### Scenario: 注入与未注入保持一致
- **WHEN** API 分别注入或未注入两个只读端口
- **THEN** 运行路由及 OpenAPI 同步出现或缺席，对应操作只调用声明端口

#### Scenario: 契约越界或无权
- **WHEN** 请求包含客户端授权/主体字段、未知操作、超界分页或跨工程引用
- **THEN** 返回既有 400 或不可枚举授权/不存在失败
- **AND** 不读取正文或调用写端口

### Requirement: C34 校准治理命令必须复用唯一命令路由目录

系统 MUST 登记 `warning-response.calibration-review-outcome` 与 `warning-response.calibration-governance-draft` 两条命令分支，映射独立校准治理端口与既有 `warning-response.record` 能力。端口未注入时路由与 OpenAPI 不激活；客户端只提交既有命令信封和精确建议/决定载荷，服务端签发单分支授权，领域所属模块分别核对下游权限与真实决定。（RA-S7）

#### Scenario: 目录与单分支签发一致
- **WHEN** 两条命令经真实会话请求
- **THEN** 请求只调用对应校准用例，入口授权精确绑定本次命令和分支
- **AND** 不使用建议创建分支代签、不改变会话签发模型

#### Scenario: 两条治理分支分别校验成功结果
- **WHEN** 所属端口返回与本次治理分支不匹配的成功结果
- **THEN** HTTP 结果边界按该分支的闭合结果 Schema 安全失败
- **AND** 不以包含两类结果的宽联合放行错误分支结果
