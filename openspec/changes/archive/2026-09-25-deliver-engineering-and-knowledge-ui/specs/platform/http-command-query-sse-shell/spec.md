## ADDED Requirements

### Requirement: C32 只读查询分支必须登记在闭合路由清单

系统 MUST 在既有闭合业务路由清单中以 `POST /api/v1/projects/:projectId/queries/<branch>` 形态登记七条只读 query branch：`engineering-data.context-read`、`engineering-data.source-catalog`、`engineering-data.monitoring-catalog`、`engineering-data.read-result`、`knowledge-modeling.governance-read`、`knowledge-modeling.retrieval-result`、`projection.result-read`。每条 branch MUST 映射到精确请求 Schema、结果 Schema、唯一 port 方法和既有能力位（`engineering-data.read`、`knowledge-modeling.read`、`knowledge-modeling.retrieve`、`projection.query`），不得新增能力枚举值。运行时注册与 OpenAPI MUST 继续由同一活动路由元数据派生；对应端口未注入时该 branch MUST 不激活且不出现于 OpenAPI。（横切 RI-S1～RI-S6；RA-S1～RA-S7）

#### Scenario: 路由目录、能力映射与 OpenAPI 一致

- **WHEN** 验证者检查活动路由清单、branch-capability 映射与生成的 OpenAPI
- **THEN** 七条 branch 的路径、请求/结果 Schema、能力位与激活状态三者一致，不存在清单外查询入口

#### Scenario: 端口未注入时 branch 不激活

- **WHEN** 某只读端口未注入 API 装配
- **THEN** 对应 branch 返回与未知路由相同的失败，且不出现在 OpenAPI 中

### Requirement: C32 只读分支必须复用既有传输信封与失败形态

七条只读 branch 的 HTTP 请求 MUST 只接受既有 v1 查询传输信封字段（schemaVersion、requestedSpatialScopeRefs、requestedSourceVersionRefs、queryId、requestedAt 与 strict payload）；操作者、工程与授权上下文 MUST 由会话 Cookie、路径工程与闭合 branch 在服务端组装，客户端不得提交 actor、capability 或授权字段。成功响应原样返回公共结果联合；失败 MUST 使用既有 `HttpErrorV1` 形态，授权失败与目标不存在对无权调用方保持不可区分，不得因新分支引入新的错误码、第二套信封或正文旁路（如文件下载、任意 URL 取数）。（横切 RI-S14、RI-S61～RI-S65）

#### Scenario: 客户端提交越权字段被拒

- **WHEN** 请求包含 actorId、authorization、capability 或契约外字段
- **THEN** HTTP 层在调用下游前以契约无效失败，不触达端口

#### Scenario: 无权与不存在不可区分

- **WHEN** 无权调用方与目标不存在两种情形分别请求同一 branch
- **THEN** 两者得到相同状态码与同形错误体，响应差异不可用于枚举工程内对象
