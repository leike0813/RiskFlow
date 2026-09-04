## Context

基线 `800acf000e462d35c50b0347e993fc0b6e247921` 已归档 C02、C03、C06；C07/C08 的公共 port 也已存在，但它们不是 C09 的静态直接依赖。当前 `apps/api` 只有返回 `Fastify()` 的空工厂，尚无 route、传输 Schema、错误映射或流式出口。C03 已提供与业务提交同事务写入的 `outbox.events`，C02 已冻结全部 module command/query/result、`ProjectionPortV1.subscribe` 和 `DomainEventRefV1`，C06 已冻结会话与逐请求授权接口。

C09 是 API platform，不拥有领域事实、投影正文、会话、复核、Agent、工作流或 Outbox 投递状态。设计必须让 C10 能只依赖 HTTP/SSE 契约；耐久订阅由注入的 `ProjectionPortV1` 实现，C09 不为 C31 预先建立投影或直接读取 C03 表。实现不得启动网络监听或后台 Worker。

## Goals / Non-Goals

**Goals**

- 提供 `/api/v1` 下的会话、闭合命令、闭合查询、运行 SSE 和 OpenAPI 路径。
- 在 trust boundary 使用 strict Zod Schema；由服务端从 Cookie、路径与获准引用构造 C06/C02 请求。
- 复用 C02/C03 的命令身份、幂等和错误语义，不在 HTTP 层建立第二套业务状态。
- 通过 C02 `ProjectionPortV1.subscribe` 交付 C03 耐久事件引用，使断线恢复保持工程/运行隔离且不越过投影边界。
- 让 C07 复核/审计与 C08 bounded Agent 只能经现有公共 port 调用，不出现旁路。
- 只用现有 Fastify、Zod、workspace 包和 Node.js 标准能力。

**Non-Goals**

- 不实现 C10 React Web shell、客户端 SDK、`EventSource` 生命周期、页面路由、缓存或 UI 权限态。
- 不实现 C11 业务文件上传、C26 通知、C31 业务投影、WebSocket、外部身份或通用 RPC。
- 不修改 C02/C03/C06 公共 DTO、任何领域事实或工作流状态机。
- 不让 API 读取证据/资料正文、任意数据库表、检查点或 Agent/模型原始响应。

## Decisions

### 1. 单一闭合 route catalog 同时驱动运行时和 OpenAPI

`apps/api/src/http.ts` 导出一个只读 `HTTP_ROUTE_CATALOG_V1`。每个业务条目固定：

```ts
type HttpRouteEntryV1 = Readonly<{
  method: "POST";
  path: `/api/v1/projects/:projectId/${"commands" | "queries"}/${ModuleBranchV1}`;
  branch: ModuleBranchV1;
  mode: "command" | "query";
  requestSchema: ZodType;
  resultSchema: ZodType;
  invoke(ports: ApiPortsV1, request: unknown): Promise<unknown>;
}>;
```

catalog 只登记 C02 已有 branch，并为每个 branch 绑定精确 C02 Schema、结果 Schema 和所属 port 方法。`invoke` 是 transport 到公共 port 的唯一分派点；没有 `execute(any)`、动态方法名、用户提供 handler、通用 patch 或通用仓储。C07 的 `request-review`、`decide-review`、`trace` 和 C08 的 `start-task`、`resume-task`、`cancel-task`、`confirm-command` 只是 catalog 中绑定既有 port 的条目，不复制它们的规则。

`buildApi` 只注册已有所属 port 的 catalog 条目，并从同一活动条目集合派生 OpenAPI；缺失 port 不生成空 handler、501 route 或虚假文档。后续领域 change 只导出自己的公共 port 实现，由组合根注入，无需修改 C09；若确需 C02 未定义的新 branch，必须先走独立契约演进 change。

### 2. HTTP 路径与传输信封固定为 v1

外部路径为：

| 方法 | 路径 | 语义 |
|---|---|---|
| `POST` | `/api/v1/session/login` | C06 登录并设置安全 Cookie |
| `POST` | `/api/v1/session/change-password` | C06 改密并轮换 Cookie |
| `POST` | `/api/v1/session/logout` | C06 注销并清除 Cookie |
| `POST` | `/api/v1/projects/:projectId/commands/:branch` | 闭合 C02 写命令 |
| `POST` | `/api/v1/projects/:projectId/queries/:branch` | 闭合 C02 查询 |
| `GET` | `/api/v1/projects/:projectId/runs/:runId/events` | 运行事件引用 SSE |
| `GET` | `/api/v1/openapi.json` | 派生 OpenAPI 3.1 文档 |

SSE 路径中的 `runId` 是精确 `WorkflowRunRefV1.reference` 的 canonical 编码：`base64url(JSON.stringify({entityId,versionId}))`，使用 UTF-8、无 `=` padding，JSON 属性顺序固定为 `entityId` 后 `versionId`。服务端必须解码后通过 strict `VersionReferenceSchema` 校验，再以相同规则重新编码并逐字节对比；原始 JSON、非 URL-safe 字符、padding、非 canonical 属性顺序、缺失/额外字段和无法解码的值均在授权或订阅前失败。不得从裸实体 ID 合成默认版本，也不得借 `@`、`:` 等 Identifier 允许的字符拆分引用。

HTTP command body 只包含 `schemaVersion`、`commandId`、`idempotencyKey`、`issuedAt`、`requestedSpatialScopeRefs`、`requestedSourceVersionRefs` 与 C02 `payload`；query body 只包含 `schemaVersion`、`queryId`、`requestedAt`、相同两类请求引用与 `payload`。路径决定 `projectId` 与 branch；服务端决定 `kind`、`actorId`、`authorization` 和该 branch 的唯一 capability。上述服务端字段若出现在客户端 body，strict schema 直接失败，不执行“删掉再继续”。

传输 Schema 不复制领域 payload：实现从精确 C02 request Schema 取得对应 branch，使用 Zod 的对象组合能力构成只含客户端字段的 strict schema；组装完整 C02 DTO 后再次由原 request Schema 校验。响应也必须先过原 result Schema。Zod 4 的 `toJSONSchema` 从同一传输/结果 Schema 生成 OpenAPI JSON Schema，不维护手写字段镜像。

登录、改密请求直接复用 C06 strict input 的客户端可提交字段；服务端补齐或覆盖命令身份、时间和 session token。会话响应投影固定移除 `sessionToken`，仅返回 session/account 引用、限制状态和过期时间。

### 3. 工厂只接收现有公共 port 与操作配置

`buildApi(options: BuildApiOptionsV1): FastifyInstance` 是唯一应用工厂。`BuildApiOptionsV1` 包含必需的 `LocalIdentityAccessV1`、按所属接口键名提供的 `Partial<ApiPortsV1>`、`publicOrigin`、时钟/标识生成器、可选注入式 `HttpAccessLogV1`（未提供时默认关闭）和以下有界 SSE 配置：

```ts
type SsePolicyV1 = Readonly<{
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  batchSize: number;
  maxConnectionMs: number;
  maxBufferedBytes: number;
}>;
```

配置在建厂时一次校验为正整数并限制合理最大值；无效配置阻止启动。工厂不连接数据库、不运行迁移、不创建 Worker、不监听端口。`apps/api/src/index.ts` 仅导出工厂、route catalog、传输类型与安全错误类型。

这不是为单实现建立抽象：这些 port 已由 C02/C06 冻结，工厂注入让 Fastify `inject` 可无监听验收，也让部署组合根选择 Postgres 或测试实现。

### 4. Cookie、同源与逐请求工程授权在一个 pre-handler 收口

会话 Cookie 名固定为 `__Host-riskflow_session`。使用 Node/Fastify 原生 header 读写，拒绝重复同名 Cookie、空 token 和 header/query/body token 替代物；序列化固定 `Secure; HttpOnly; SameSite=Strict; Path=/` 且不设置 `Domain`。注销使用相同属性并令 `Max-Age=0`。不引入 Cookie 或 CSRF 插件。

所有 `POST` 必须有与配置 `publicOrigin` 完全一致的 `Origin`。缺失、多值、解析失败或不匹配均在读取 body 之外的业务数据和调用 port 前以安全契约错误终止；反向代理/TLS 信任属于 C37。

每个受保护请求执行：

1. 从唯一 Cookie 取 opaque token；
2. 从闭合 route、路径 `projectId` 和经 strict schema 验证的请求引用构造 C06 `AuthorizationRequestV1`；
3. 只请求 `MODULE_BRANCH_CAPABILITY_V1[branch]` 对应的单一 capability；
4. 用 `authorize` 返回的 actor、project、scope/source grants 和 policy ref 组装 C02 DTO；
5. 调用所属 port。所属实现仍按 C06 `verify` 执行最终复验。

路径工程与 C06 决定不一致、请求引用不能限定到同一工程、授权拒绝或目标不存在均对无权调用方返回同一 404 族安全响应。SSE 每次拉取新批次前重复 authorize；撤权后不再拉取或发送事件。API 不缓存授权上下文跨请求使用。

### 5. HTTP 只映射结果，不拥有幂等状态

命令的 `(projectId, kind, idempotencyKey)`、payload hash、并发收据和原结果均由 C02/C03 所属 port 处理。HTTP 层原样传递 `commandId`、`idempotencyKey`、版本和 payload；不得添加进程内锁、缓存或第二张收据表。相同结果在 transport 上保持：

- `succeeded`：`200`；
- `waiting`：`202`；
- `failed`：按错误表映射；
- 会话登录/改密：`200` 且设置 Cookie；注销：`204`。

稳定错误信封为 strict 对象：

```ts
type HttpErrorV1 = Readonly<{
  schemaVersion: "1";
  requestId: string;
  code: HttpErrorCodeV1;
  retryable: boolean;
  occurredAt: string;
  references: readonly ContractReferenceV1[];
}>;
```

映射固定为：输入/同源/游标冲突 `400`；认证/会话失效 `401`；强制改密 `403`；授权拒绝和对无权调用方的未找到 `404`；陈旧版本、访问版本与幂等冲突 `409`；不支持媒体类型 `415`；业务阻断 `422`；不支持契约版本 `426`；瞬态失败 `503`；终止、非法下游结果或未知异常 `500`。`retryable` 取自已知错误；未知错误固定 false。只从允许字段挑选诊断、当前版本、目标或原命令引用；不得转发异常 message、stack 或 payload。日志同样只写低基数 route、身份引用、状态、耗时和安全错误 code。

选择稳定信封而不透传 C02/C06 错误对象，是为了同时隐藏无权目标和内部 stage；领域错误仍是映射事实源。

### 6. 耐久恢复只依赖 `ProjectionPortV1.subscribe`

C09 不实现 PostgreSQL subscriber、不读取 `outbox.events`、不建立游标表，也不推断 `correlationId` 与运行标识的数据库关系。每一批只调用注入的 `ProjectionPortV1.subscribe(RunSubscriptionRequestV1)`；请求包含服务端授权上下文、精确 `workflowRunRef` 和可选 `afterEventId`，结果必须通过 `ProjectionSubscriptionResultV1Schema` 后才可发送。

由投影实现保证：事件已经耐久提交、只属于请求工程与运行、顺序稳定、`afterEventId` 可恢复且单批有界。C09 只把成功结果中的 `DomainEventRefV1[]` 序列化；`failed` 走稳定错误映射，`waiting` 不被伪装成空成功。C03 提供耐久 Outbox/幂等基础，C31 以后拥有业务查询投影；两者均不因 C09 增加 API 直读后门。

实现测试注入一个遵守同一 port 的确定性测试实现，验证 HTTP/SSE 协议、授权与游标传递，而不在 C09 重测 C03/C31 的存储算法。真实组合验收必须使用已归档投影实现；缺少 `ProjectionPortV1` 时 SSE route 不得注册或降级为内存序号。

### 7. SSE 使用标准帧和请求生命周期，不增加流插件

连接成功响应 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform` 与 `Connection: keep-alive`。业务帧固定：

```text
id: <DomainEventRefV1.eventId>
event: domain-event-ref.v1
data: {"schemaVersion":"1","workflowRunRef":{...},"domainEventRef":{...}}

```

心跳只写 `: heartbeat` 注释且不带 `id`。流后错误只发送 `event: error.v1` 与安全 `HttpErrorV1`，不带 `id`，随后关闭。

服务端先把 canonical `runId` 无损还原为精确 `WorkflowRunRefV1`，再处理游标。起始游标优先规则只有三种：仅有 `Last-Event-ID` 就使用它；仅有 `afterEventId` 查询参数就使用它；二者相同也使用该值。二者不同在写 headers 前返回 400。每批调用 `ProjectionPortV1.subscribe`，发送成功后把最后一个 `eventId` 作为下次游标；空批等待 `pollIntervalMs`，到点心跳。客户端断开、达到 `maxConnectionMs`、Fastify 关闭、写入返回背压且缓存达到 `maxBufferedBytes` 时，取消定时器、停止拉取并结束响应。API 不确认、删除或重排耐久事件，客户端凭最后已处理 ID 重连。

### 8. C07/C08 及领域操作没有旁路

闭合 catalog 中：

- 复核请求、决定、追溯仅绑定 `ReviewAuditPortV1.requestReview/decideReview/trace`；
- Agent 任务仅绑定 `AgentTaskPortV1.startTask/resumeTask/cancelTask/confirmCommand`；
- 工作流仅绑定 `WorkflowPortV1.startRun/resumeRun/cancelRun`；
- 投影仅绑定 `ProjectionPortV1.query/subscribe/export`。

HTTP 不出现“改状态”“发布”“直接执行 Agent 提案”“改预算/模型/工具”“写审计”“改检查点”等 transport payload。C08 `confirm-command` 的现有 Schema 是交互写命令唯一确认入口；C07 `decide-review` 的目标版本与类型化决定仍由 C07 验证。风险评估、预警和处置只通过将来所属 port 的闭合 branch 接入，HTTP 不从请求正文构造或覆盖它们的事实。

### 9. OpenAPI 是 catalog 的纯派生物

`buildOpenApiDocument(activeRoutes)` 只用原生对象构建 OpenAPI 3.1：路径、方法、媒体类型、Cookie 安全方案、幂等字段、SSE 响应和错误族来自实际注册的同一 route 元数据，JSON Schema 来自 Zod 4 `toJSONSchema`。文档只含合成占位引用，不含真实凭据、工程、证据或业务示例。

测试把 catalog 路径/方法集合与 Fastify 注册表、OpenAPI `paths` 做集合相等比较；不精确断言整份 JSON 或文案。若 Zod 无法表达某个 OpenAPI 元数据，最小 route 元数据可以补充媒体类型/状态族，不能复制业务字段。

### 10. 上传与不支持媒体类型在解析前拒绝

C09 不注册上传路径。已有 route 只接受声明的 JSON、空 body 或 SSE GET；Fastify content-type hook 在 multipart、octet-stream 或未登记媒体类型进入 body parser 前返回 415，并设置有限 body 大小。不得创建临时文件、artifact ref 或来源事实。C11/C04 交付并明确上传事务后，由其独立 change 增加 route contribution。

### 11. 追踪和审计引用只传递，不复制

request id 由合法入站值或注入的标识生成器得到，只用于诊断关联。HTTP/SSE 原样保留 C02 结果中的工程、实体、版本、运行、复核、Agent、证据和审计引用；不把当前版本替换历史引用。API access log 不是业务审计，C03/C06/C07/C08 的原子审计仍由所属实现负责。

追踪对照：

| 专利/横切步骤 | C09 接缝 | 所属持久化/校验 |
|---|---|---|
| RI-S14 | 服务端身份、request id、授权策略引用 | C06 授权与所属模块审计 |
| RI-S61～RI-S65 | 标准化风险记录、证据、机理、综合置信度引用原样往返 | 识别模块/C03；C09 不读正文 |
| RA-S4～RA-S5 | 规则集、矩阵、元数据快照与评估记录精确版本 | 评估模块；C09 只验证 C02 DTO |
| RA-S6～RA-S7 | 预警、触发指标、处置、偏差与审核引用；禁止绕过评估记录 | 预警处置模块/C07；C09 只走闭合 port |
| Agent 横切 | 任务、预算、工具策略、确认和正式结果引用 | C08；C09 不执行工具或解析思维链 |

### 12. 文件所有权与测试层次

后续实现的预期文件：

| 操作 | 文件 | 作用 |
|---|---|---|
| 修改 | `apps/api/src/app.ts` | 组合工厂、hook 与 route 注册 |
| 修改 | `apps/api/src/index.ts` | 导出稳定 API platform 表面 |
| 新增 | `apps/api/src/http.ts` | 传输 Schema、闭合 catalog、授权组装、错误映射与 OpenAPI |
| 新增 | `apps/api/src/sse.ts` | SSE 帧、游标和有界连接循环 |
| 新增 | `apps/api/test/http-shell.test.ts` | Fastify inject 的会话、route、权限、错误、幂等、OpenAPI 契约测试 |
| 新增 | `apps/api/test/sse.test.ts` | 恢复、心跳、撤权、断开与背压测试 |
| 主调度检查点 | `apps/api/package.json`、`pnpm-lock.yaml` | 仅声明现有 contracts/core 与 Zod，不引入包或版本 |

不修改 `packages/contracts`、`packages/core` 领域/访问实现、`packages/adapters`、主 specs、Web/Worker、根配置或其它 change。主调度在依赖检查点据实删去多余清单改动。

测试只断言稳定行为：结构化 code/status/ref、相同幂等结果、下游调用次数、工程隔离、事件 ID/顺序/恢复与资源停止。不锁定完整错误文案、字段顺序、完整 OpenAPI snapshot 或定时器内部调用顺序。

## Risks / Trade-offs

- **通用 URL 形状可能被误解为通用 RPC**：catalog 是编译期闭合并逐项绑定 Schema/port；任何未知 branch 在调用前失败。若未来 branch 需要专门 HTTP 语义，由其 contribution 使用独立路径，不扩张为动态 handler。
- **短轮询比数据库通知多一次延迟**：C09 只按注入策略重复调用既有订阅 port，不增加 LISTEN/NOTIFY 或依赖；投影实现负责有界批次。只有实测连接量使轮询负载越过运营门槛时再开性能 change，游标契约不变。
- **SSE 在已发送帧后不能改 HTTP 状态**：流前错误用 HTTP 信封，流后错误用不带游标的 `error.v1` 后关闭；客户端总能从最后业务 `id` 恢复。
- **C07/C08 并非 C09 静态直接依赖**：C09 只依赖 C02 冻结 port 类型，运行组合在 C07/C08 可用时注入实现；缺失 port 时对应 route 不登记，而不是提供降级旁路。
- **手工 Cookie/SSE 代码有边界风险**：逻辑限于一个固定 Cookie 和标准行格式，并以注入测试覆盖重复 Cookie、分隔字符、换行、背压和清理；若标准需求扩展到签名 Cookie 或多种 Cookie，再单独评估现有依赖，当前不加插件。

## Migration Plan

1. 主调度审阅并提交本 change 的 planning checkpoint。
2. 主调度只为 `apps/api`/adapter 声明现有 workspace 与 Zod 子路径，更新 lockfile importer/exports（如确有需要），执行 frozen install 与依赖政策检查后形成 dependency checkpoint；不得安装新包。
3. 实施 Agent先落地纯 HTTP catalog/错误/OpenAPI，再接入会话和 SSE；全部依赖以公共 port 注入。
4. 用 Fastify `inject`/受控 stream 和确定性 port 替身验证 route、工程隔离、游标顺序/恢复与资源收口，不启动服务器。
5. 执行 API 定向测试、类型检查、lint/format、依赖边界、`openspec validate --strict` 与 `openspec-verify-change`。
6. 主调度审阅实现范围后才形成 implementation checkpoint；归档和 C10 派发仍按独立门禁进行。

回滚只撤销 C09 route 组合与 API 文件；没有迁移、业务表或事实需要数据搬迁。已写入的 C03 Outbox 与 C06/C07/C08/领域事实保持不变。

## Open Questions

无。若实施发现 C02 Schema 不能无损派生客户端传输 Schema、现有 package exports 无法满足 API importer，或 SSE 需要绕过 `ProjectionPortV1` 才能恢复，必须停止并退回主调度更新设计，不能在实现中变更共享契约、直读数据库或增加依赖。
