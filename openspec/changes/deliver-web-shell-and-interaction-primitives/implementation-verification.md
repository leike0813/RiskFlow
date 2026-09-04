# C10 独立实现验证报告

## 验证身份

- Change：`deliver-web-shell-and-interaction-primitives`（C10）
- Task / Dispatch：`task_b218589c75bb` / `ctx_e09d67e6a493`
- Worktree ID：`d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c10-web-shell`
- 分支：`leike0813/c10-web-shell`
- 固定 implementation checkpoint / 当前 Git HEAD：`03e335a53659c1fb7cfed161ea2e19e1b350d54a`
- Task kind / phase / outcome：`verification` / `verification` / `succeeded`
- Main：尚未合并、复验或归档；本报告不授权这些动作。

## 方法与范围

项目内未找到 `openspec-verify-change` 的 `SKILL.md`，`command -v openspec-verify-change` 也没有返回可执行文件。因此本次以以下组合完成等价验证：

1. 逐条对照 C10 的 9 条 requirement、29 个 scenario、proposal、design 和 tasks；
2. 对账 C09 已归档主规格，以及 `apps/api/src/http.ts`、`apps/api/src/sse.ts`、`apps/api/src/index.ts` 的公共契约；
3. 审阅 checkpoint 相对基线的路径、依赖、公开导出、生产代码和测试；
4. 运行定向 Web 测试、typecheck、lint、production build、依赖政策/边界、OpenSpec strict 与空白检查。

未启动开发服务器，未运行 project-wide `pnpm test` / `pnpm verify`，未修改 manifest、lockfile、根配置、主 specs、其它 change、API、Worker 或共享包，也未提交、合并或归档。

## 逐条契约结论

| Requirement | 结论 | 主要证据 |
| --- | --- | --- |
| 七项业务导航与闭合路由 | 通过 | `app/routes.ts` 与 `shell/navigation.ts` 固定七个根入口和两个会话入口；未知路径统一 `not-found`；`routing-context-actions.test.ts` 验证顺序、对应关系、History、危险路径与直接 renderer contribution。 |
| 工程/空间/工序上下文原子切换 | 修复后通过 | `app/state.ts` 的 reducer 级联清理并单调增加 revision，revision guard 会 abort 旧请求并拒绝迟到结果；验证中补上 `replace` 不得产生“无工程但有工序”的状态，并使路由内容按 pathname + revision 重挂载以清除旧页面内存态。 |
| 五类页面壳与七种视图状态 | 通过 | 五个 PageShell 共用 `PageFrame` 和 `idle/loading/ready/empty/error/forbidden/unavailable`；参数化 SSR 覆盖全部 35 个组合，加载不闪空态、空态只显示 allowed 动作、安全错误不渲染内部正文。 |
| 权限、业务阻断、route 缺失与隐匿分离 | 通过 | `deriveActionAvailability` 分离 checking/forbidden/blocked/unavailable；不可用动作统一在 handler 再次拒绝；会话门和 route 页面分别表现未认证、restricted、权限不足、上下文空与未登记 route。 |
| 证据与 Agent 右侧停靠 | 修复后通过 | 证据使用 full/redacted/error 联合，redacted 无正文；修复后有界上下文中的证据必须携带匹配 revision，缺失或陈旧 revision 不显示；C35 ready contribution 只保留精确 task ref 与单一命名 slot，删除可绕过 slot 的任意 `content` 通道。 |
| 类型化命令确认 | 修复后通过 | 确认摘要覆盖工程、目标、精确版本、预计事实、外部副作用、能力、command id 和 idempotency key；高影响命令必须确认且提交锁防重复；修复高影响 retry 保留原 plan/身份，以及 stale/idempotency conflict 以无 plan 的结构化终止错误要求重新读取。 |
| 键盘、焦点与 reduced motion | 通过（结构/逻辑层） | skip link、landmarks、`aria-current`、live region、tablist、原生 dialog/focus trap、Escape 和 opener 恢复均已实现；focus helper 测试通过，CSS 含 `:focus-visible` 和 `prefers-reduced-motion`。按任务禁止启动服务器，本 worker 未做运行中浏览器人工 Tab/Shift+Tab 验收。 |
| 只消费 C09 HTTP/OpenAPI/SSE | 修复后通过 | 同源 Fetch 使用 Cookie、`cache=no-store`、JSON 与 AbortSignal，无 Authorization；operation 以 registry 对象身份闭合；OpenAPI 只派生 method/path 可用性；EventSource 只监听引用/安全错误并交给浏览器重连，同帧刷新合并、单订阅清理。 |
| 业务和状态所有权边界 | 通过 | 生产文件中无 local/session storage、IndexedDB、Service Worker、WebSocket、通用 RPC、动态 URL/branch、生产 Mock、领域事实、模型思维链或 P/C Agent 决策；公开 barrel 只导出 C10 contribution、shell、交互原语与 C09 client seam。 |

## C09 对账与修复

C09 的 `HttpCommandRequestV1Schema` / `HttpQueryRequestV1Schema` 是 strict envelope：正文含 `schemaVersion`、空间/资料引用、command/query 身份、时间和 payload，`projectId` 只位于 `/api/v1/projects/:projectId/...` 路径。checkpoint 中 Web client 的本地 request 同时把 `projectId` 发送进 JSON，真实 C09 会把该额外字段判为 `CONTRACT_INVALID`；测试 transport 没有执行 C09 strict Schema，所以原测试未发现此问题。

修复保留本地 request 中用于安全组装 URL 的 `projectId`，在验证它与路由工程一致后，从 wire envelope 删除该字段，并增加回归断言。其余对账结果一致：

- 会话 route、Cookie 名、JSON/SSE media type 和 `HTTP_SCHEMA_VERSION_V1` 一致；
- project command/query path 由闭合 `ModuleBranchV1` 与能力映射生成，不接受任意 branch；
- 200/202 结果语义与 204 logout 由既有 client 路径处理；
- canonical run id 为无 padding base64url JSON `{entityId,versionId}`；
- 事件名固定为 `domain-event-ref.v1` / `error.v1`，事件正文仅含运行和领域事件引用；
- 稳定错误 code、retryable、request id、时间、获准引用和 retry 元数据与 C09 对齐。

## 验证中完成的局部修复

1. `apps/web/src/api/http.ts`：不再把 path-owned `projectId` 发进 C09 strict JSON envelope。
2. `apps/web/src/app/state.ts`：拒绝通过 `replace` 构造孤立工序上下文。
3. `apps/web/src/app/App.tsx`：pathname 或 context revision 改变时重挂载 route content，清除旧页面内存态。
4. `apps/web/src/shell/dock/RightDock.tsx`：证据 revision 缺失时安全隐藏；收紧 C35 ready contribution 为精确 task ref + 唯一 slot。
5. `apps/web/src/shared/confirmation.ts`：高影响 retry 保留已完成的显式确认和原身份；stale/idempotency conflict 保留安全错误但丢弃陈旧 plan。
6. `apps/web/src/shared/CommandConfirmationDialog.tsx`：所需能力改为必填的 `ModuleCapabilityV1`，确认摘要不会遗漏权限要求。
7. 相应 Web 测试补充 C09 wire body、孤立上下文、高影响 retry、结构化 stale 错误、无 revision 证据和 C35 slot 回归覆盖。

## 验证命令

| 命令 | 最终结果 |
| --- | --- |
| `pnpm exec vitest run apps/web/test` | 通过：6 files，22 tests |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm exec vite build apps/web` | 通过：Vite 8.2.2，124 modules |
| `pnpm deps:check` | 通过：146 modules，366 dependencies，无边界违规 |
| `pnpm deps:policy` | 通过：`dependency policy: OK` |
| `openspec validate deliver-web-shell-and-interaction-primitives --strict --no-interactive` | 通过：change valid |
| C10 改动文件 `pnpm exec prettier --check ...` | 通过 |
| `git diff --check` | 通过 |

首次并发运行定向测试时，`@riskflow/contracts/ports` 的 workspace dist 尚未由 typecheck 生成，4 个 suite 在 import 阶段失败；同轮 typecheck 生成已锁定 workspace 包产物后，定向测试重跑稳定通过。该过程没有安装或变更依赖，最终 production build、依赖边界和工作树状态均以修复后的结果为准。

## 剩余主调度动作

- 审阅本报告与 10 个未提交的 C10 局部修复/测试文件，形成新的 implementation / verification checkpoint。
- 由主调度决定是否补做 production build 上的真实浏览器键盘验收以及根级 `pnpm verify`。
- 合并到 main 后执行冻结安装和 main verification；通过后再同步、归档并回收 worktree。
