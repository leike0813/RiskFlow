# C09 实现独立验证报告

## 检查点身份

- Change：`deliver-http-command-query-and-sse-shell`（C09）
- 被验证任务：`task_1f7b68cb081b`
- 验证任务：`task_0713dee5d847`
- Worktree ID：`d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c09-http-shell`
- Base / current HEAD：`800acf000e462d35c50b0347e993fc0b6e247921`
- 结论：**独立验证通过，无 WARNING**。本轮两个验证 WARNING 均已在批准范围内收口；主线验证仍由主调度执行。

## 验证摘要

| 维度 | 状态 |
| --- | --- |
| 完整性 | 17/17 tasks 已完成；11 requirements、40 scenarios 已逐项核对 |
| 正确性 | HTTP/SSE 主路径通过；5 个实现/契约缺陷已修复 |
| 一致性 | 四层边界、闭合 port、精确运行引用、无监听工厂和禁止旁路符合设计 |

## 本次局部修复

1. `apps/api/src/app.ts`：空白 `x-request-id` 原会使安全错误信封的 Zod 校验再次抛错，最终落入 Fastify 默认错误正文并泄露内部校验详情。现统一规范化入站/生成标识，无法使用时回退安全 UUID。
2. `apps/api/src/app.ts`：非法空白 `Last-Event-ID` 原在 SSE headers 打开后才由下游请求 Schema 拒绝，返回 `200 text/event-stream` 而非流前 `400`。现按公共 `IdentifierSchema` 在授权和订阅前拒绝。
3. `apps/api/src/http.ts`：派生 OpenAPI 原同时为注销声明 `200` 和 `204`，且遗漏标准 `Last-Event-ID` header。现注销只声明实际的 `204`，SSE 同时声明标准 header 与显式 query 游标。
4. `apps/api/package.json`、`pnpm-lock.yaml`：按协调者确认补齐源码实际使用且锁文件已有的 `@riskflow/contracts`、`@riskflow/core` 与 `zod@4.5.4`，未引入新包或版本。
5. `apps/api/src/http.ts`、`apps/api/src/app.ts` 与 C09 design/spec：将 SSE `runId` 收口为无填充 canonical `base64url(JSON.stringify({entityId,versionId}))`，解码后 strict 校验并重新编码对比；不再合成默认版本或按合法 Identifier 分隔符猜测。
6. `apps/api/test/http-shell.test.ts`：新增 5 个稳定行为回归；覆盖安全请求标识、非法游标流前拒绝、OpenAPI 状态/header、精确运行引用无损往返和非 canonical 编码早拒绝，不锁定完整文案、字段顺序或内部调用顺序。
7. `apps/api/src/http.ts`、`apps/api/src/app.ts`：增加可选注入式 `HttpAccessLogV1`，未注入时默认关闭；响应完成后只提交 route、request/command/query/run 标识、project、结果类别、HTTP status、耗时和安全 error code，拒绝 payload、正文、token、stack，日志同步或异步异常均不影响响应。
8. `apps/api/test/http-shell.test.ts`：新增访问日志字段/异常隔离和重复 Cookie 零授权/下游调用的稳定行为回归。

## 本轮 WARNING 收口

### 1. 测试证据

定向测试由 15 个增至 17 个，新增重复 Cookie 在授权与下游 port 前拒绝的代表性边界，以及 accessLog 白名单字段/异常隔离回归。其余改密/注销撤销、空间与资料拒绝、C02/C03 幂等、C07/C08 真实组合和 SSE 长连接资源边界仍由所属领域端口或组合验收负责；C09 保留静态闭合边界核对，不复制领域测试。

该选择满足本轮最小代表性测试要求，并保持 C09 的 HTTP/SSE 传输测试边界。

### 2. 请求日志契约

`buildApi` 保持 `logger: false`，并支持可选注入式 `HttpAccessLogV1`。日志对象只包含白名单字段，默认不产生访问日志；回调抛出同步异常或返回拒绝 Promise 时均被安全吞掉。

新增回归验证了成功响应、命令/工程/请求标识和日志异常隔离，未启用 Fastify 默认请求 dump。

## 关键行为核对

- 会话：固定 `__Host-riskflow_session`，具备 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/` 且无 `Domain`；所有 POST 同源校验发生在 body parser 前。
- Strict 边界：transport 与 C02/C06 DTO 均经 Zod strict Schema；未知 branch 不能进入活动 catalog，客户端 actor/project/capability/authorization 字段不能透传。
- 授权隔离：每个业务请求和每次 SSE 拉取前调用 C06 `authorize`；路径工程与所需 capability 再次核对，下游仍只收到服务端签发上下文。C06 Postgres 实现按当前成员、空间、资料和策略版本求交，所属 port 的 `verify` 责任未被 C09 旁路。
- 幂等与错误：HTTP 层不建缓存、锁或收据，原命令身份和幂等键交给 C02/C03；闭合 ModuleError/AccessError 映射为安全状态与信封，未知结果/异常不返回原正文。
- C07/C08：catalog 仅绑定 `ReviewAuditPortV1` 与 `AgentTaskPortV1` 的类型化方法；未发现通用状态修改、通用 patch、任意 handler 或数据库后门。
- SSE：只调用 `ProjectionPortV1.subscribe`，canonical `runId` 无损还原精确运行与版本，使用领域 `eventId`、注释心跳、无 id 的安全错误帧；每批重授权，断开/onClose 使用 AbortController，批量、帧/缓冲和连接时长有上限。
- OpenAPI：由活动 catalog 派生，局部修复后注销状态和标准恢复 header 与运行时一致；无上传、multipart、数据库、Web UI、监听或后台 Worker。
- 敏感信息：访问日志默认关闭；启用注入式 accessLog 时仅记录白名单标识、结果类别、状态、耗时和安全 error code。错误/SSE/OpenAPI 仍不包含 token、payload、证据正文、模型响应、SQL、stack 或思维链；本次修复消除了非法 request id 触发的默认错误正文。

## 验证证据

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/api/test/sse.test.ts` | 通过；2 files、17 tests |
| `pnpm test` | 通过；19 files passed、1 skipped；209 tests passed、1 skipped |
| `pnpm install --frozen-lockfile --lockfile-only --offline` | 通过；lockfile 已同步，未安装或解析新版本 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm format:check` | 通过 |
| `pnpm deps:check` | 通过；115 modules、260 dependencies |
| `pnpm deps:policy` | 通过 |
| `openspec validate deliver-http-command-query-and-sse-shell --strict --no-interactive` | 通过 |
| `git diff --check` | 通过 |
| `openspec-verify-change` executable | 环境无此命令；已按项目本地 Skill 的 completeness/correctness/coherence 流程人工替代验证 |
| 变更范围 | 协调者追加授权后为 `apps/api/src/**`、`apps/api/test/**`、API manifest/lock importer 和 C09 change artifacts；未修改 packages、主 specs 或其它 change |
| 临时 `.js` | `apps/api/dist/` 生成物已清除；最终扫描无结果 |

## 最终判断

无 CRITICAL 或 WARNING。已批准范围内的局部缺陷、依赖门、运行引用、访问日志契约和代表性安全边界均已修复并通过回归；C09 独立验证通过，主线验证保持 `pending`，归档仍由主调度决定。
