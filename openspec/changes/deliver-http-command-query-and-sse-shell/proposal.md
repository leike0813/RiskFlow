## Why

RiskFlow 已有闭合的模块命令、查询、事件、持久化幂等和本地授权契约，但 `apps/api` 仍只有空 Fastify 工厂，浏览器和受控客户端无法通过统一 HTTP 边界安全调用这些能力，也无法在断线后恢复运行事件。C09 需要补齐最薄的 API platform，使后续 C10 Web shell 只消费稳定、服务端授权且可追溯的命令、查询与 SSE 契约。

## What Changes

- 建立版本化 HTTP command/query 外壳：登录、改密、注销由 C06 `LocalIdentityAccessV1` 执行；业务命令与查询按闭合路由表映射到 C02 六个领域 port、`WorkflowPortV1`、`ReviewAuditPortV1`、`AgentTaskPortV1` 与 `ProjectionPortV1`，未知分支和契约外字段在调用下游前失败。
- 每个受保护请求只从安全会话 Cookie 取得 opaque token，由服务端调用 C06 `authorize` 签发最小 `AuthorizationContextV1`；strict HTTP Schema 拒绝客户端提交的 actor、capability、工程外 scope/source grant 或授权上下文，下游仍在副作用或正文读取前复验当前授权。
- HTTP 写命令要求明确幂等键并复用 C02/C03 的 `(projectId, commandKind, idempotencyKey)` 语义；重复同载荷返回原逻辑结果，同键异载荷返回稳定冲突，不在 route handler 建立第二套收据或内存幂等表。
- 建立只读 SSE 运行流：从 `ProjectionPortV1.subscribe` 返回的耐久事件引用序列发送类型化事件，使用 SSE `id` 与 `Last-Event-ID`/显式游标恢复，支持有界心跳与断开清理；命令、复核决定、Agent 确认和上传不经 SSE 反向写入。
- 统一把 C02 `ModuleErrorV1` 和 C06 `AccessErrorV1` 映射为有限 HTTP 状态与安全错误信封，只暴露稳定代码、可重试性和获准引用，不返回数据库/驱动/模型错误正文、凭据、资料/证据正文、原始 SSE 或思维链。
- 提供由同一闭合路由元数据派生的 OpenAPI 文档对象与契约验证，避免手写第二套 route/Schema 清单；不引入 Swagger、SSE、Cookie 或 multipart 插件。
- 明确上传边界：本 change 只拒绝尚无 C11/C04 所属持久化接缝的上传入口，不接收、缓冲或暂存业务文件；真实上传在所属事实与工件 change 后另行接入。
- 保留 C07 复核/审计与 C08 bounded Agent 的边界：HTTP 只转发其现有类型化命令/查询和引用；交互 Agent 写命令必须走 C08 用户确认，人工复核必须走 C07 决定，二者均不能借通用 HTTP route 绕过原领域权限、版本、确定性校验或审计。
- Non-goals：不实现 C10 React Web UI、业务页面或客户端缓存；不实现 C11 以后领域能力、真实文件上传、通知渠道、WebSocket、外部身份、通用 RPC、数据库直读、投影事实、第二套工作流/审计/Agent runtime，也不修改 C01/C02/C03/C06 公共契约。

## Capabilities

### New Capabilities

- `platform/http-command-query-sse-shell`: 定义 RiskFlow HTTP 会话、闭合 command/query 路由、服务端授权、错误与幂等映射、可恢复 SSE 运行事件和 OpenAPI 派生边界。

### Modified Capabilities

无。C09 仅消费并实现 C02、C03、C06 已归档契约；C07/C08 通过既有公共 port 接入，不改变其稳定 requirements。

## Impact

- **直接依赖**：C02 `domain/module-interfaces-events-workflows`、C03 `platform/postgresql-outbox-checkpoint-foundation`、C06 `platform/local-identity-project-authorization`；规划同时核对已归档 C07/C08 公共 port 的受控接入语义。
- **下游消费者**：C10 只消费本 change 的 HTTP/SSE 客户端边界并实现 Web shell；C26 复用可靠事件/通知出口；C31 提供真实查询投影内容；C37 负责 TLS、反向代理和离线部署。C09 不提前实现这些下游事实或 UI。
- **事实所有权**：C09 只拥有 HTTP route、传输信封、路由元数据、SSE 连接与序列化；账号/会话/授权属于 C06，命令结果/Outbox/消费收据属于 C03，复核审计属于 C07，Agent 任务属于 C08，领域事实与投影仍属于各自模块。
- **专利与功能追踪**：本 change 不新增 RI/RA 领域判断；它为 RI-S14、RI-S61～RI-S65 与 RA-S4～RA-S7 提供权限、幂等、版本、证据和审计引用不丢失的交付通道，并确保预警/处置不能绕过已入库风险评估记录。对应功能为 F-AG-01/02、F-PJ-01～03、F-AU-01/02 的服务端入口支撑；页面追踪属于 C10/C32～C35。
- **代码与验证范围**：后续实现限于 `apps/api/src/**`、`apps/api/test/**` 及必要的 API workspace 内部依赖声明；不得改共享 contracts、领域实现、数据库 schema/adapter、根配置、主 specs 或 Web/Worker 业务实现。
- **依赖治理**：不引入任何新包或版本；只使用锁文件中已有的 Fastify 5.12.1、Zod 4.5.4、现有 RiskFlow workspace 包与 Node.js 24 标准能力。API importer 所需的既有 workspace/Zod 声明及锁文件 importer 更新由主调度在依赖检查点单独审阅，实施 Agent 不得私自安装、升级或替换依赖。
