## 1. 前置边界与纯契约

- [x] 1.1 主调度 Agent 在实现派发前只把既有内部 `@riskflow/contracts@workspace:*` 加入 `apps/web/package.json` 和 `pnpm-lock.yaml` importer，执行 `pnpm install --frozen-lockfile && pnpm deps:policy && pnpm deps:check` 后形成 dependency checkpoint；不得新增第三方包、版本、ECharts、router、state、cache、SSE 或 DOM testing wrapper，实施 Agent 不修改 manifest/lock。
- [x] 1.2 实施 Agent 核对基线 `488aed0a1278711dd01e503f7d072155ee0e99e3`、C01/C09 主 specs、C09 `apps/api/src/index.ts` 导出和本 change，保存 `git status --short` 证据；确认只写 `apps/web/src/{app,shell,shared,api}/**`、`apps/web/test/**`、`apps/web/src/main.tsx`、`apps/web/src/index.ts`，不得修改 API/Worker、`packages/**`、Demo、根配置/锁文件、主 specs 或其它 change。
- [x] 1.3 在 `apps/web/src/app/routes.ts` 和 `apps/web/src/shell/navigation.ts` 定义闭合基础 route/navigation contribution、固定七项导航、未知路径结果及 History/popstate 适配；用 `apps/web/test/routes.test.ts` 验证七项一一对应、前进后退、未知/非法路径拒绝、无任意 redirect/module URL，并确认 Agent 不进入业务导航。
- [x] 1.4 在 `apps/web/src/app/state.ts` 定义 `SessionStateV1`、`WebContextV1`、`PageLoadStateV1`、上下文 reducer 与 request revision guard；用 `apps/web/test/state.test.ts` 验证工程/空间/工序级联清理、旧请求取消/迟到结果丢弃、冻结运行上下文不改写和会话失效清空敏感内存态。
- [x] 1.5 在 `apps/web/src/shared/actions.ts` 和 `apps/web/src/shared/confirmation.ts` 定义闭合动作可用性与类型化确认状态；测试验证 checking/forbidden/blocked/unavailable 零请求、高影响显式确认、提交防重复、retryable 保留 owning feature 提供的原身份、陈旧版本终止并刷新。

## 2. C09 HTTP、OpenAPI 与 SSE 客户端

- [x] 2.1 在 `apps/web/src/api/http.ts` 定义品牌化闭合 operation registry 和同源 C09 Fetch client，会话方法固定到 login/change-password/logout，command/query 只能接收已注册 descriptor；用 `apps/web/test/http-client.test.ts` 验证 `credentials=same-origin`、`cache=no-store`、AbortSignal、禁止 Authorization/token/任意 URL/未知 branch，并按稳定 code/retryable 解析安全错误。
- [x] 2.2 在 `apps/web/src/api/openapi.ts` 读取 `/api/v1/openapi.json` 并只派生 method+normalized path availability，与本地 operation contribution 求交集；测试验证 OpenAPI 缺 route 时动作 unavailable、文档不能生成动态 RPC/权限或领域 Schema、非法/跨源 path 被拒绝。
- [x] 2.3 在 `apps/web/src/api/sse.ts` 使用原生 EventSource 实现单运行订阅、canonical run id、`domain-event-ref.v1`/`error.v1` 安全解码、浏览器标准重连与 `requestAnimationFrame` 刷新合并；测试使用注入 EventSource/调度器验证同帧多事件一次刷新、业务事件不充当正文、error.v1 终止、无私有 cursor/重连器、卸载/切换只关闭唯一连接。
- [x] 2.4 用 C09 归档 spec 和实现导出的 `HTTP_SYSTEM_ROUTE_CATALOG_V1`、HTTP error/session/SSE 字段作人工对账，记录同源 Cookie、200/202/204、canonical run id、事件名与安全错误一致；若需要导入 `apps/api`、共享新 DTO、改 C09 或新增依赖，停止并通过 Orca 升级主调度，不得复制第二套协议继续实现。

## 3. Shell、页面壳与横切交互

- [x] 3.1 在 `apps/web/src/app/App.tsx`、`apps/web/src/shell/AppShell.tsx` 与同目录 CSS 实现匿名/强制改密/已认证会话门、skip link、header、七项 nav、唯一 main、上下文选择器和右侧 aside；用 `react-dom/server` 的 `apps/web/test/app-shell.test.tsx` 检查 landmarks、七项导航、restricted 零业务工作区和未知/无权入口语义，不断言完整文案/HTML/CSS。
- [x] 3.2 在 `apps/web/src/shared/page-shells/**` 实现列表、对象详情、运行监控、治理与版本、复核工作台五类壳，共用 `idle|loading|ready|empty|error|forbidden|unavailable`；参数化 SSR 测试验证 loading 不闪 empty、空态只给 allowed+route-available 动作、错误只显示安全字段、业务不可用与技术失败分开且没有领域 Mock。
- [x] 3.3 在 `apps/web/src/shell/dock/**` 实现 context/Agent 两页签停靠、证据 full/redacted/error 内容和 C35 Agent contribution slot；测试验证脱敏不显示正文、跨页面保持停靠状态、上下文越界关闭证据、未接入时零伪会话，以及组件无思维链/原始模型正文/P/C Agent 结论入口。
- [x] 3.4 在 `apps/web/src/shared/CommandConfirmationDialog.tsx` 实现类型化确认摘要、高影响显式勾选、提交锁与安全结果/错误状态；测试验证工程、对象、精确版本、预计事实、外部副作用均可见，forbidden/blocked/unavailable 不开确认，retry 保持同一 plan。
- [x] 3.5 在 `apps/web/src/shared/focus.ts` 和 shell/dialog/dock 组件落实 route/context 后主标题焦点、停靠/tablist 方向键、dialog Tab 边界、Escape 条件与返回 opener，CSS 落实可见焦点、文字状态和 reduced-motion；纯 helper 测试验证按键映射和 focus target，人工浏览器检查覆盖真实 Tab/Shift+Tab、Enter/Space、方向键、Escape 与返回焦点。
- [x] 3.6 在 `apps/web/src/main.tsx` 挂载唯一 `App`，在 `apps/web/src/index.ts` 仅导出 route/operation contribution、PageShell、动作/确认、停靠上下文和 C09 client 公共接缝；`pnpm deps:check` 验证 Web 不导入 API 应用、Demo、数据库或共享包深路径，不导出任意 fetch/RPC、Cookie/token 或领域事实。

## 4. 定向验证与范围审计

- [x] 4.1 运行 `pnpm exec vitest run apps/web/test`，确认路由/上下文/权限/确认/C09 client/SSE/SSR 稳定行为通过；fixture 只在测试中注入，不锁定完整文案、DOM snapshot、字段顺序、CSS 或内部调用顺序。
- [x] 4.2 运行 `pnpm typecheck`、`pnpm exec vite build apps/web`、`pnpm lint`、C10 文件 `pnpm exec prettier --check ...`、`pnpm deps:check` 与 `pnpm deps:policy`；不启动开发服务器，project-wide `pnpm test`/`pnpm verify` 是否执行由主调度按检查点决定。
- [x] 4.3 对 production build 执行浏览器验收清单：七项导航/前进后退、登录与 restricted、三级上下文、五类壳七状态、权限置灰、证据/Agent 停靠、确认 dialog、键盘/焦点/reduced-motion、SSE recovering/terminal error；已在 production preview 实测匿名登录壳、Tab 首焦点和匿名访问 `/overview` 的 `/login` 门禁，认证态与后端驱动状态由 SSR/行为测试覆盖，未启动开发服务器。
- [x] 4.4 运行 `openspec validate deliver-web-shell-and-interaction-primitives --strict --no-interactive`、`git diff --check`、`git status --short` 和精确路径清单；确认没有领域页面/事实、后端、私有缓存、私有 EventSource 协议、生产 Mock、通用 RPC、新依赖、ECharts 空 seam、提交/归档或范围外修改，再交主调度形成 implementation checkpoint 和独立验证任务。
