## ADDED Requirements

### Requirement: HTTP 提供安全 Cookie 当前会话查询

系统 MUST 在系统路由目录和 OpenAPI 中提供 `GET /api/v1/session`，通过既有安全 Cookie 查询当前会话并返回既有会话元数据 Schema。该路由无请求体，不接受客户端会话身份或 Authorization header；所有响应必须禁止缓存，不能返回 token 或下发新 Cookie。无有效会话 MUST 返回既有认证失败类别，畸形或重复 Cookie MUST 返回既有契约失败类别，服务端故障保留原技术错误语义。（F-AG-01/02）

#### Scenario: 有效 Cookie 返回正式元数据
- **WHEN** GET 携带有效会话 Cookie
- **THEN** 返回 200 和正式会话元数据，响应禁止缓存且不含 token 或 Set-Cookie

#### Scenario: 无有效会话或 Cookie 形状非法
- **WHEN** Cookie 缺失、对应会话失效，或 Cookie 畸形/重复
- **THEN** 缺失及失效会话返回 401 认证失败，非法 Cookie 返回 400 契约失败

#### Scenario: 自省服务故障保持技术错误
- **WHEN** 服务端会话读取出现暂时存储故障或未知技术错误
- **THEN** 返回既有 503 或 500 错误信封，不冒充匿名或认证成功

#### Scenario: OpenAPI 与实际会话路由一致
- **WHEN** 调用方读取 OpenAPI 并调用会话自省
- **THEN** 描述包含相同 GET 路径、Cookie 安全要求和正式响应 Schema，且不声明请求体

