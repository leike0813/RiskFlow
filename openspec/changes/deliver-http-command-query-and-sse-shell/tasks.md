## 1. 依赖与实现边界检查点

- [x] 1.1 主调度 Agent 在实现派发前仅为 `apps/api/package.json` 声明锁文件中已有的 `@riskflow/contracts`、`@riskflow/core` 与 `zod@4.5.4`（按实际 import 删除未使用项），更新 `pnpm-lock.yaml` importer 并形成 dependency checkpoint；以 `pnpm install --frozen-lockfile && pnpm deps:policy` 验证未引入新包或版本，Luna 不运行安装或修改清单。
- [x] 1.2 实施 Agent 核对基线、planning/dependency checkpoint 和 `apps/api` 现状，确认写入范围只有 `apps/api/src/**`、`apps/api/test/**`；以 `git status --short` 保存前置证据，禁止修改 contracts、core、adapters、数据库、Web/Worker、主 specs、其它 change、根配置和锁文件。

## 2. 闭合 HTTP 契约与错误映射

- [x] 2.1 在 `apps/api/src/http.ts` 定义 strict v1 会话/command/query/安全错误/SSE 传输 Schema，并从 C02/C06 Schema 组合客户端可提交字段；用 `apps/api/test/http-shell.test.ts` 的参数化反例验证未知 branch、未知字段、客户端 actor/project/capability/授权上下文、开放 patch/URL/路径在调用 port 前失败。
- [x] 2.2 在 `apps/api/src/http.ts` 建立只读 `HTTP_ROUTE_CATALOG_V1`，逐 branch 绑定 C02 精确 request/result Schema 与唯一公共 port 方法，覆盖六领域、workflow、projection、C07 review-audit 和 C08 agent-task 分支；测试验证登记集合与 `MODULE_BRANCH_CAPABILITY_V1` 对账且不存在 `execute(any)` 或动态 handler。
- [x] 2.3 在 `apps/api/src/http.ts` 实现 C02 `ModuleErrorV1`、C06 `AccessErrorV1`、校验/媒体类型和未知异常到 `HttpErrorV1` 的确定性映射；测试只断言稳定 code/status/retryable/获准引用，并验证认证与无权目标不泄露存在性、响应不含 stack/message/token/payload/证据或模型正文。
- [x] 2.4 在 `apps/api/src/http.ts` 从同一 catalog 与 Zod 4 `toJSONSchema` 派生 OpenAPI 3.1 文档；测试按集合比较文档与运行时的方法/路径/媒体类型/安全方案/状态族，验证示例不含真实工程、凭据或正文，不新增 Swagger 等依赖。

## 3. 会话、授权与 command/query 路由

- [x] 3.1 在 `apps/api/src/app.ts` 建立显式依赖注入且无监听副作用的 `buildApi`，用 Node/Fastify 原生 header 实现固定 `__Host-riskflow_session` Cookie 的读取、设置、轮换与清除，并在业务 body 处理前拒绝重复 Cookie、header/query/body token、跨站 `Origin` 和不支持媒体类型；以 Fastify `inject` 测试固定 Cookie 属性、登录幂等、改密后旧会话失效、注销和零临时文件。
- [x] 3.2 在 `apps/api/src/app.ts` 为每个受保护 route 从 Cookie、路径、branch 与已验证引用调用 C06 `authorize`，只请求 `MODULE_BRANCH_CAPABILITY_V1[branch]` 的单一能力并用服务端决定组装 C02 DTO；测试覆盖最小授权、路径/上下文工程不一致、空间/资料越权、密码变更限制和撤权，断言失败时下游 port 未调用。
- [x] 3.3 在 `apps/api/src/app.ts` 注册 v1 command/query route，调用 catalog 中唯一 port 并校验下游结果，保持 `succeeded=200`、`waiting=202`、`failed=映射错误`；测试覆盖 C02/C03 同命令重试同结果、同键异载荷冲突、并发重复只一次副作用、陈旧版本不改写及查询零写入，HTTP 层不增加缓存、锁或收据。
- [x] 3.4 用 C07/C08 的真实公共 DTO 和脚本化 port 在 `apps/api/test/http-shell.test.ts` 验证复核决定只经 `ReviewAuditPortV1.decideReview`、Agent 写提案只经 `AgentTaskPortV1.confirmCommand`，陈旧复核、未确认提案、预算/模型/工具越界均不能通过通用 route 绕过版本、权限、确定性校验或审计。

## 4. 可恢复且有界的 SSE

- [x] 4.1 在 `apps/api/src/sse.ts` 实现标准 `domain-event-ref.v1`、注释心跳和无游标 `error.v1` 帧，拒绝 CR/LF 注入与超限帧；测试验证业务 `id` 精确等于 `DomainEventRefV1.eventId`，流中只有运行/事件引用和安全错误，不含 Outbox 行、正文、token、模型响应或思维链。
- [x] 4.2 在 `apps/api/src/app.ts` 注册运行 SSE route，把 canonical base64url `runId`、`Last-Event-ID`/一致的显式 `afterEventId` 和服务端授权组装成精确 `RunSubscriptionRequestV1`，每批只调用 `ProjectionPortV1.subscribe` 且校验 `ProjectionSubscriptionResultV1Schema`；测试验证运行引用无损往返、非 canonical 编码早拒绝、首次订阅、重连只取下一事件、冲突/未知/跨工程游标拒绝、API 重建后恢复，并断言没有数据库直读或进程内序号。
- [x] 4.3 在 `apps/api/src/sse.ts` 按注入的正整数策略限制批量、帧、轮询、心跳、缓冲和连接时长，每次拉取前重新授权；用可控时钟/流测试验证空闲心跳不推进游标、撤权后零新增帧、背压/断开/Fastify 关闭清理计时器且不取消运行或回滚事实。

## 5. 导出、范围审计与交付验证

- [x] 5.1 在 `apps/api/src/index.ts` 只导出 `buildApi`、闭合 catalog、传输 Schema/类型与 OpenAPI 构建器；以 `pnpm typecheck` 和 `pnpm deps:check` 验证 API 仅依赖公开 contracts/core 子路径，不导出 Fastify 内部、数据库、Cookie token 或未版本化对象。
- [x] 5.2 运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/api/test/sse.test.ts`，确认会话、授权/工程隔离、strict round-trip、幂等/错误、C07/C08 禁止旁路、SSE 恢复/资源收口、OpenAPI 一致性和默认关闭/注入式安全 accessLog 全部通过；至少保留一条重复 Cookie 在授权与下游调用前拒绝的代表性边界测试，且测试不得锁定完整文案、字段顺序、完整 OpenAPI snapshot 或内部调用顺序。
- [x] 5.3 运行 `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm deps:check && pnpm deps:policy`，随后运行 `openspec validate deliver-http-command-query-and-sse-shell --strict --no-interactive` 与 `openspec-verify-change`；记录命令、结果和未运行原因，任何失败不得以跳过、放宽 Schema 或增加依赖收口。
- [x] 5.4 用 `git diff --check`、`git status --short` 和变更路径清单确认只包含已批准 API 文件、测试及主调度 dependency checkpoint；明确没有 Web UI、开发服务器、生产监听、数据库迁移、共享契约修改、通用 RPC/上传/旁路，并把验证证据交给主调度审阅后再形成 implementation checkpoint。
