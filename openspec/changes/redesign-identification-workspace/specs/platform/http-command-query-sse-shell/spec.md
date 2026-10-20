## MODIFIED Requirements

### Requirement: C33 只读分支必须复用既有传输信封与失败形态

C33 五条只读 branch MUST 使用既有 v1 查询信封（schemaVersion、requestedSpatialScopeRefs、requestedSourceVersionRefs、queryId、requestedAt、strict payload）和原路由/能力映射。运行与风险详情允许精确对象引用或无版本实体身份的互斥选择，其身份解析仅限识别所属对象，不开放任意 kind/路径/SQL/工件读取；成功继续使用所属公共结果并保全精确版本与已登记头部。操作者、工程和授权由安全 Cookie、路径工程及闭合 branch 在服务端组装，客户端不得提供主体、能力或授权。所有者从登记恢复完整目标空间与来源，客户端选择器不是授权或补齐历史范围的前置。失败继续沿 `HttpErrorV1`，无权与不存在保持同形，不新增错误码或第二套信封。运行时与 OpenAPI MUST 消费同一严格输入/结果 Schema，正式部署和浏览器组合使用真实所属读实例；原五条 branch 激活规则不变，不增分支、角色或能力。（RI-S14、RI-S5～RI-S6）

#### Scenario: 客户端提交越权字段被拒
- **WHEN** 请求含 actorId、authorization、capability、任意对象类型、选择冲突或其它契约外字段
- **THEN** HTTP 在调用下游前以既有契约失败拒绝，不触达端口

#### Scenario: 无权与不存在不可区分
- **WHEN** 无权调用方与目标不存在两种情形分别请求同一 branch
- **THEN** 得到同形安全错误，不可据响应枚举工程内目标；真实技术故障保留其错误语义

#### Scenario: ID-H-S01 两种合法选择贯通正式接缝
- **WHEN** 真实会话分别按精确引用与单实体身份请求运行/风险详情，未提供历史来源选择器
- **THEN** 原 branch、所属读面与 OpenAPI 允许对应互斥输入，服务端按登记范围执行当前权限，成功响应携精确引用；浏览器和正式部署不使用临时 resolver 或空实现

#### Scenario: ID-H-S02 身份与工程只能由边界确定
- **WHEN** 请求试图同时提交两种目标、替换路径工程、伪造主体/授权或给未知 HTTP branch
- **THEN** 输入无效或所属当前授权失败，不改读另一个对象、不激活清单外路径，不增加业务事实
