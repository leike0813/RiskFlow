## 1. 能力与当前策略契约

- [x] 1.1 [IP-01] 在唯一 contracts/core 接缝声明 review-todo.read、ProjectAccessPresentationV1Schema 和独立 port／内部请求，保持会话自省形状；完成检查：`pnpm exec vitest run packages/contracts/test`。
- [x] 1.2 [IP-01] 落实 design D-05 角色增量及 v2 策略，保留历史策略身份解析所需契约，不扩大来源／写权或 reviewer Agent 权；完成检查：`pnpm exec vitest run packages/core/test/access.test.ts`。

## 2. 服务端能力读取与生产传递

- [x] 2.1 [IP-02] 实现真实 C06 工程能力读取、访问审计与 v1 历史来源解析的当前权限检查，不重写旧行；完成检查：`pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`。
- [x] 2.2 [IP-02] 接通 Cookie 保护的独立 access HTTP／OpenAPI／部署端口，未注入不激活，不增加假待办聚合；完成检查：`pnpm exec vitest run apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs`。
- [x] 2.3 [IP-02] 将当前工程能力经唯一 C09 客户端传入生产 App，清理工程／会话变化与迟到响应，失败可重试而不伪空能力；完成检查：`pnpm exec vitest run apps/web/test/api-client-openapi.test.ts apps/web/test/routing-context-actions.test.ts`，并在第 7 组验证真实工程切换。

## 3. 精确路由与区域组合

- [x] 3.1 [IP-03] 实施注册期形状冲突、首差异段静态优先及已知完整模板别名，保全查询和编码身份，不提前切业务目标；完成检查：`pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts`。
- [x] 3.2 [IP-03] 以有序区域一次迁移 routes／business／App／质量贡献、PageFrame／五个 PageShell 与 exports，删除旧 shellKind／variant 双协议；完成检查：`pnpm exec vitest run apps/web/test/ssr-shells.test.tsx apps/web/test/quality.test.tsx`。
- [x] 3.3 [IP-03] 在 RiskOverviewPage 实际消费多区域，保持原摘要、表格、独立来源状态与历史投影有界续页；完成检查：第 7 组正式浏览器 `assessment-warning-response.spec.ts` 的原态势／失败／精确引用场景，不以新聚合或新图表替代。

## 4. 布局与独立停靠授权

- [x] 4.1 [IP-04] 启用 152px／48px 左栏与 22rem 可收起右栏，移除自动下沉，保留当前七入口、旧深链及证据；完成检查：`pnpm exec vitest run apps/web/test/ssr-shells.test.tsx apps/web/test/focus.test.ts`，原生六组合操作证据见第 7 组。
- [x] 4.2 [IP-04] 接通按资格筛选的贡献列表和唯一 Agent provider，待办／助手独立判定，未知／拒绝停止相应 Agent 读取；不交付假待办；完成检查：第 7 组真实 reviewer 无 Agent 仍可复核、manager 跨页共享任务与证据脱敏，命令为既有 Playwright 三域回归。

## 5. 唯一确认状态与呈现

- [x] 5.1 [IP-05] 收拢 permission／hidden、计划深快照、scope 失效和异步 generation，retryable-failure 不保留过期计划，批量结果保留逐项语义；完成检查：`pnpm exec vitest run apps/web/test/confirmation.test.ts apps/web/test/routing-context-actions.test.ts`。
- [x] 5.2 [IP-05] ConfirmButton 改为已有控制器与唯一原生 Dialog 的触发组合，移除旧 props／本地第二状态；承接独立错误色、模态、取消首焦点及恢复；完成检查：`pnpm exec vitest run apps/web/test/design-system.test.tsx apps/web/test/ssr-shells.test.tsx apps/web/test/focus.test.ts`。

## 6. 全部调用方干净切换

- [x] 6.1 [IP-06] 在原 API 层改为 prepareCommand／sendPreparedCommand，所有原写 helper 的 payload 构造和 decoder 同批迁移，删除旧 postCommand／submitCommand、全局冻结缓存及无消费者导出；完成检查：`pnpm typecheck`，真实原 envelope 重试证据由第 7 组取得。
- [x] 6.2 [IP-06] 迁移施工图列出的全部业务与 Agent 启动确认，保全各类决定、输入编辑新身份、取消零写、逐项批量部分失败；完成检查：第 7 组 `identification-review.spec.ts` 与 `assessment-warning-response.spec.ts` 真实命令结果／幂等回归。
- [x] 6.3 [IP-06] 六项管理动作使用 system scope 和同一确认，移除 AccessPage 的重复 Intent／retryIntent 状态及孤立样式，口令不入摘要／日志／缓存；保护报告与提案现有只读行为；完成检查：第 7 组 `agent-audit-operations.spec.ts` 的无工程管理、二次确认、原身份重试和普通用户拒绝。

## 7. 合流验证与最终验收

- [x] 7.1 [IP-07] 完成后统一运行施工图 C-01～C-04 相关回归、`pnpm build`、`pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy` 及 `openspec validate prepare-web-shell-route-and-access-seams --strict --no-interactive`；删除脆弱文案／枚举计数测试，记录真实失败及修复，不降低门禁。
- [ ] 7.2 [IP-07]（原生缩放取证 BLOCKED，其余已通过）运行施工图 C-06 五份正式 Playwright 规格，使用真实 HTTP／PostgreSQL／Cookie／生产构建覆盖当前权限、原件来源、旧策略、深链、取消／重试／部分失败；按施工图原生三窗口×两缩放完成左右折叠与确认焦点取证；环境缺失明确失败，不以关键 skip／原型或旧截图通过。
  - C-06 五份规格已用真实 HTTP／PostgreSQL／Cookie／生产构建全绿：read-only 22、identification-review 14、assessment-warning-response 40、agent-audit-operations 13、quality 8。
  - 原生三窗口×两缩放取证未完成并按 BLOCKED 记录：本机 Xvfb 无窗口管理器，xdotool 的 XTEST 键盘与 CDP `Input.dispatchKeyEvent` 都无法送达 Chromium（探针实测输入框收不到按键、窗口 innerWidth 恒为 1050），因此无法产生真实 Ctrl+plus 的 200%。已交付 `apps/web/test/browser/native-zoom.mjs`：它用 CDP `Browser.setWindowBounds` 设真实外窗口、用原生缩放键、并逐项断言折叠、焦点、取消与实际滚动，缺少可用显示环境时以 `NATIVE_ZOOM_FAILED` 非零退出，不退化为 viewport 近似，也不写入伪造证据。
- [ ] 7.3 [IP-07] Finalizer 对最终实现检查点闭合全部 Requirement／Scenario／IP 证据，完成本轮唯一 AUTHZ／POLICY-HISTORY／CONFIRMATION-STATE 限定审计及范围内修复回归，再按 `openspec instructions verification --change prepare-web-shell-route-and-access-seams --json` 创建 verification；完成检查：最终报告对应真实检查点、每项证据可复核、无未解决必需场景。Planning 不执行或预填该任务。
