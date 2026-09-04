## Context

基线 `488aed0a1278711dd01e503f7d072155ee0e99e3` 已归档 C01 和 C09。`apps/web` 只有 React 19 根节点、Vite 配置和空 barrel；没有应用 shell、路由、状态、样式、API client 或测试。C09 已公开以下浏览器边界：

- `POST /api/v1/session/login|change-password|logout`，会话只存在于 `Secure`、`HttpOnly`、`SameSite=Strict` 的 `__Host-riskflow_session` Cookie；
- `POST /api/v1/projects/:projectId/commands/:branch` 与 `queries/:branch`，branch、请求和结果来自闭合 catalog；
- `GET /api/v1/projects/:projectId/runs/:runId/events`，运行引用使用 canonical base64url，业务事件为 `domain-event-ref.v1`，安全流错误为 `error.v1`；
- `GET /api/v1/openapi.json`，文档由运行时同一 route catalog 派生，缺失 port 的 route 不登记；
- `HttpErrorV1` 只公开稳定 code、`retryable`、request id 和允许披露的引用。

依赖边界禁止 `apps/web` 导入 `apps/api`。因此 C10 在运行时消费 C09 网络契约，不从 API 应用深导入实现；领域 payload/result 仍由后续 feature 使用共享 `@riskflow/contracts` Schema 解码。C10 本身不拥有领域页面或领域字段。

路线表曾把 ECharts adapter 列入 C10，但当前 Dispatch 锁定的范围不含图表，正式 workspace 也未锁定 ECharts。按当前明确范围与 YAGNI 原则，本 change 不建立无消费者的 chart seam；首个真实图表由 C34 或其已批准前置 change 走依赖门。

## Goals / Non-Goals

**Goals:**

- 让匿名、强制改密、已认证、会话失效四条应用入口可预测且不泄露 token/旧数据。
- 固定七项导航、白名单路由、三级上下文和五类页面壳，使后续 UI 只贡献领域页面。
- 固定页面异步状态、动作可用性、证据/Agent 停靠、命令确认、键盘与焦点契约。
- 提供最薄的 C09 client seam：同源 Fetch、OpenAPI route availability、闭合 operation descriptor、标准 EventSource。
- 用现有依赖完成实现和分层验证，不启动开发服务器，不建立生产 Mock。

**Non-Goals:**

- 不实现 C32～C35 的领域列表、详情、运行、治理、复核内容及任何图表或统计口径。
- 不定义领域 DTO、权限策略、业务状态机、投影、运行、复核、Agent 或审计事实。
- 不改 C09 route/Cookie/SSE，不增加 BFF、WebSocket、数据库读取、上传或后台 Worker。
- 不使用 localStorage、sessionStorage、IndexedDB、Service Worker 或进程外游标作为业务缓存。
- 不建立任意 URL、任意 branch、`execute(any)`、JSON Patch、通用仓储或通用 RPC。
- 不迁移 Demo 的 React 18、npm lockfile、路由、Mock 数据和依赖；视觉 token 只有在与正式 CSS 变量兼容时才可人工迁入。

## Decisions

### 1. 用浏览器原生 History API 固定小型路由表

C10 的生产路由是闭合表，不引入路由依赖。`routeId`、固定 path template、所需上下文、页面壳和查看能力形成只读定义；匹配器拒绝未知路径、重复解码、任意 redirect 和动态 module URL。基础表为：

| Route ID | Path | 导航 | 页面壳 / 用途 |
| --- | --- | --- | --- |
| `session.login` | `/login` | 否 | 会话登录页 |
| `session.change-password` | `/change-password` | 否 | 强制改密页 |
| `overview.root` | `/overview` | 风险态势 | 对象详情页壳 |
| `projects.root` | `/projects` | 工程项目 | 列表页壳 |
| `identification.root` | `/identification` | 风险识别 | 运行监控页壳 |
| `assessment.root` | `/assessment` | 风险评估 | 列表页壳 |
| `warnings.root` | `/warnings` | 预警处置 | 列表页壳 |
| `knowledge.root` | `/knowledge` | 知识与规则 | 治理与版本页壳 |
| `review-audit.root` | `/review-audit` | 复核与审计 | 复核工作台壳 |

未找到和不可用是解析结果，不是可导航 route。后续 C32～C35 通过 `WebRouteContributionV1` 提供固定深链；组合根对 route id 与 path template 去重后生成最终白名单。定义只接受直接组件引用，不接受字符串组件名或远程模块地址。

```ts
type WebShellKindV1 = "list" | "detail" | "run" | "governance" | "review" | "custom";

type WebRouteContributionV1 = Readonly<{
  routeId: WebRouteIdV1;
  path: WebPathTemplateV1;
  section: WebNavigationIdV1 | null;
  shellKind: WebShellKindV1;
  contextRequirement: "none" | "project" | "spatial" | "process";
  requiredViewCapability: ModuleCapabilityV1 | null;
  render: WebRouteRendererV1;
}>;
```

备选 `react-router-dom` 会新增依赖和 lockfile 工作，而 C10 只有少量静态路径；原生 History、`popstate` 和 URL 已覆盖当前行为。若后续嵌套/数据路由复杂度使自有匹配器出现重复或缺陷，再以独立依赖 change 替换，`routeId` 与 contribution 契约保持不变。

### 2. shell 状态拆为有限子状态，不引入全局状态库

React 根组合以下版本化 UI DTO。状态只保存在当前页面内存，领域内容由页面 loader 持有；不把可变业务对象复制进全局 store。

```ts
type SessionStateV1 =
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "restricted"; metadata: SessionMetadataViewV1 }
  | { kind: "authenticated"; metadata: SessionMetadataViewV1 }
  | { kind: "failed"; error: SafeHttpErrorV1 };

type WebContextV1 = Readonly<{
  revision: number;
  projectId: string | null;
  spatialScopeRef: VersionReferenceV1 | null;
  processNodeId: string | null;
}>;

type PageLoadStateV1<T> =
  | { kind: "idle" }
  | { kind: "loading"; previous: T | null }
  | { kind: "ready"; value: T }
  | { kind: "empty" }
  | { kind: "error"; error: SafeHttpErrorV1 }
  | { kind: "forbidden"; requiredCapability: ModuleCapabilityV1 }
  | { kind: "unavailable"; reasons: readonly SafeReasonV1[] };
```

每次上下文改变递增 `revision`，同时 abort 当前读取。结果只有同时匹配 `revision`、request id 和 route id 才可提交。工程改变后子引用必须由新工程的获准 options 重新证明；证明前置 `null`。已有运行/Agent 任务只存引用及冻结上下文摘要，不被当前 `WebContextV1` 覆写。

备选 Redux/Zustand 会为少量正交状态增加依赖和第二套生命周期；React state/reducer 足够。若后续实测跨多个并行窗口需要离线共享，再以独立 change 评估，当前不预留持久化 store。

### 3. 七项导航是 SSOT，路由和可访问标签由其派生

`WEB_NAVIGATION_V1` 只包含七个固定定义：`overview`、`projects`、`identification`、`assessment`、`warnings`、`knowledge`、`reviews`。每项绑定唯一根 route id、中文标签和可选查看能力。渲染器从该集合产生导航、`aria-current` 和移动布局，不维护第二份菜单数组。

权限快照为 `unknown | allowed | denied`。`unknown/denied` 入口使用不可激活且可聚焦的元素提供说明；直接深链仍以服务器结果为准。C09 的 `NOT_FOUND` 同时覆盖无权和不存在，客户端必须映射为统一不可用页面，不能反推出 `denied`。

### 4. 五类页面壳只组织结构，不持有领域事实

五个组件复用 `PageFrameV1`、`PageLoadStateV1<T>`、`WebActionV1` 和停靠 slot：

- `ListPageShell`：标题/上下文、主操作、筛选 slot、表格 slot、分页 slot；
- `DetailPageShell`：身份/状态/版本 slot、至多三个主操作、分节内容、关联/审计和时间线 slot；
- `RunPageShell`：运行头、阶段进度、子任务、错误/恢复、结果 slot；
- `GovernancePageShell`：列表、修订、差异、送审/发布/停用/回滚 slot；
- `ReviewWorkbenchShell`：队列、精确版本快照、证据/校验、类型化决定、批量确认 slot。

```ts
type WebActionAvailabilityV1 =
  | { kind: "checking" }
  | { kind: "allowed" }
  | { kind: "forbidden"; requiredCapability: ModuleCapabilityV1 }
  | { kind: "blocked"; reasons: readonly SafeReasonV1[] }
  | { kind: "unavailable"; reason: "route-missing" | "context-incomplete" };

type WebActionV1 = Readonly<{
  actionId: WebActionIdV1;
  label: string;
  availability: WebActionAvailabilityV1;
  impact: "standard" | "high";
  invoke: () => void;
}>;
```

页面壳负责一致状态和语义；feature 负责具体 projection、Schema、表格列、表单和动作。加载时保留布局并 `aria-busy`；只有显式 empty 才出现空态。`error` 只显示 `SafeHttpErrorV1`，业务状态不可用使用 `unavailable` 的结构化原因。

### 5. 权限、业务阻断和 route availability 三者不合并

动作允许条件为：显式人类权限允许、业务状态允许、上下文完整、C09 OpenAPI 含所需固定 endpoint。任一来源为 unknown 时动作不可提交。`OpenApiAvailabilityV1` 只记录 `{method, normalizedPath}` 集合，不缓存 Schema 或动态生成表单；刷新会话/部署版本后重新读取。

权限快照必须来自获授权的 C09 projection 或当前命令结果，客户端不根据角色名硬编码能力。无权动作不创建 command identity。系统管理员不会因为角色名称自动获得业务数据可见性。

### 6. 右侧停靠区是证据和 Agent 的唯一横切容器

停靠状态为 `closed | context | agent`；上下文面板按 `EvidenceDockContentV1 | VersionAuditContentV1 | RelatedObjectContentV1` 的可辨识联合显示。证据内容只接收服务端授权投影：`full` 含正文/监测摘要，`redacted` 仅含资料名称、章节路径、资料段标识和固定脱敏标志，`failed` 含安全错误。

Agent 面板由 C35 通过 slot 注入会话/任务引用、冻结上下文摘要和页面深链；C10 不创建 Agent store、对话输入或全屏 route。可见字段限于任务状态、策略/模型/提示版本引用、工具白名单、预算/消耗、工具行动摘要、原始输出工件引用、类型化增量、确定性校验和领域结果引用；模型正文与思维链没有组件 slot。

打开停靠区保存触发元素引用并聚焦 panel heading；关闭或路由失效后返回仍存在的触发元素，否则聚焦主标题。上下文切换时越界证据关闭；已运行 Agent 任务保留冻结上下文并显示差异提示。

### 7. 命令确认冻结展示摘要和提交身份

确认原语只接受由 feature 的类型化 command builder 产生的计划，不接收任意 patch/URL。确认计划在打开时冻结；目标版本或上下文 revision 改变即失效并关闭。

```ts
type CommandConfirmationPlanV1<TRequest> = Readonly<{
  confirmationId: string;
  operationId: C09CommandOperationIdV1;
  projectId: string;
  targets: readonly ContractReferenceV1[];
  inputVersions: readonly VersionReferenceV1[];
  expectedFacts: readonly string[];
  externalEffects: readonly string[];
  impact: "standard" | "high";
  commandId: string;
  idempotencyKey: string;
  request: TRequest;
}>;

type ConfirmationStateV1<TRequest> =
  | { kind: "closed" }
  | { kind: "reviewing"; plan: CommandConfirmationPlanV1<TRequest>; acknowledged: boolean }
  | { kind: "submitting"; plan: CommandConfirmationPlanV1<TRequest> }
  | { kind: "retryable-failure"; plan: CommandConfirmationPlanV1<TRequest>; error: SafeHttpErrorV1 }
  | { kind: "terminal-failure"; error: SafeHttpErrorV1 }
  | { kind: "succeeded"; resultRef: ContractReferenceV1 };
```

命令 identity 和 payload 由 owning feature 的类型化 builder 提供，C10 只冻结并保留，不生成业务幂等规则。提交中所有关闭/重复入口禁用。retryable failure 原样复用 plan；`STALE_VERSION`/`IDEMPOTENCY_CONFLICT` 关闭 plan 并要求重新读取。高影响 plan 的 `acknowledged` 必须为真。确认成功后按 `succeeded|waiting` 的结果引用跳到详情/运行页，不在客户端制造业务结果。

### 8. C09 client 由闭合 operation contribution 驱动，任意网络调用不外露

客户端内部 `fetchC09` 接受已注册 operation object，外部没有 `fetch(url)`/`execute(kind)` API。C10 自带会话、OpenAPI 和 SSE operation；C32～C35 各自贡献固定 command/query operation，必须给出 method、C09 path template、branch、request encoder、result decoder、所需能力和结果类别。组合时对 `operationId + method + path + branch` 去重并与当前 OpenAPI 求交集。

```ts
type C09OperationV1<TRequest, TResult> = Readonly<{
  operationId: C09OperationIdV1;
  mode: "session" | "command" | "query";
  method: "POST";
  path: C09PathTemplateV1;
  branch: ModuleBranchV1 | null;
  encode: (request: TRequest) => unknown;
  decode: (response: unknown) => TResult;
}>;

interface C09ClientV1 {
  loadOpenApi(signal: AbortSignal): Promise<OpenApiAvailabilityV1>;
  login(request: SessionLoginInputV1, signal: AbortSignal): Promise<SessionMetadataViewV1>;
  changePassword(
    request: SessionChangePasswordInputV1,
    signal: AbortSignal,
  ): Promise<SessionMetadataViewV1>;
  logout(signal: AbortSignal): Promise<void>;
  submit<TRequest, TResult>(
    operation: RegisteredC09OperationV1<TRequest, TResult>,
    request: TRequest,
    signal: AbortSignal,
  ): Promise<C09ResultV1<TResult>>;
  subscribe(input: C09RunSubscriptionV1): C09RunSubscriptionHandleV1;
}
```

`submit` 只接受注册后品牌化 descriptor；无法从用户输入构造 descriptor。URL 固定同源 `/api/v1`，Fetch 使用 `credentials: "same-origin"`、JSON content type、`cache: "no-store"` 与 AbortSignal；不设置 Authorization，不读 Cookie。会话 DTO 和安全错误只解码 C09 公开字段；领域结果 decoder 由拥有它的 feature 引用共享 Schema。

备选从 `apps/api` 导入会形成应用间依赖，违反依赖检查。运行时生成通用 OpenAPI client 会引入代码生成/动态 RPC 与第二套 Schema，故不采用。

### 9. EventSource 只承载引用失效通知

运行引用按 C09 canonical 规则编码：UTF-8 JSON `{entityId,versionId}` 后无填充 base64url。订阅使用同源 EventSource；同一页面/运行最多一个实例。只监听：

- `domain-event-ref.v1`：解码 `schemaVersion=1`、精确 `workflowRunRef` 和 `domainEventRef`，使用 `requestAnimationFrame` 合并当前帧内的投影刷新；
- `error.v1`：解码 `SafeHttpErrorV1`，关闭实例且不推进业务 cursor；
- 原生 `error`：保持实例交给浏览器标准重连，UI 显示 recovering；不创建自定义退避 timer。

Event payload 不含正文，因此客户端永远重新查询获授权 projection，不把 event ref 解释为事实。浏览器负责标准重连和 `Last-Event-ID`，C10 不读写或持久化私有 cursor，也不建立自有重连器。卸载、工程改变或 run ref 改变时 close EventSource、cancel 已排队刷新并 abort 查询；这不取消服务端任务。

### 10. 可访问性由结构与小型 focus helpers 保证

根结构固定 skip link、header、业务 nav、唯一 main 和可选 aside。route/context commit 后把 main heading 设为程序化焦点目标；停靠 tab 使用 `role=tablist/tab/tabpanel` 与左右方向键；dialog 使用原生 `<dialog>` 可用时的 modal/focus 行为和小型 fallback focus trap，不引入组件库。Escape 只在非提交状态关闭，关闭返回 opener。禁用入口使用原生 `disabled` 或 `aria-disabled` 且 handler 早返回；风险和状态同时有文字/图标，CSS 尊重 `prefers-reduced-motion`。

状态 live region 只播报 page-state 汇总；SSE 多事件经渲染帧合并，避免高频 DOM 与读屏刷屏。实现不加全局单字符快捷键。

### 11. 文件所有权和 contribution 边界固定

实现允许文件：

| 路径 | 所有权 |
| --- | --- |
| `apps/web/src/app/**` | React 根、会话门、路由组合、顶层状态 |
| `apps/web/src/shell/**` | 七项导航、顶栏、上下文选择器、停靠/全屏布局 |
| `apps/web/src/shared/**` | 五类页面壳、动作、确认、focus、状态、CSS token |
| `apps/web/src/api/**` | C09 operation registry、HTTP/OpenAPI/SSE client 与安全解码 |
| `apps/web/test/**` | 纯状态/路由/client/component SSR 测试及浏览器验收记录 |
| `apps/web/src/main.tsx`、`apps/web/src/index.ts` | 唯一挂载与公开 Web contribution/export |

实施 Agent 禁止修改 `apps/api/**`、`apps/worker/**`、`packages/**`、`demo/**`、根配置/锁文件、主 specs 和其它 change。实现前由主调度单独把既有内部 `@riskflow/contracts@workspace:*`（本地版本 0.0.0）加入 `apps/web/package.json` 与 lockfile importer：用途是复用 C01/C02 的标识、版本、branch、能力和领域结果 Schema；来源为本仓库 `packages/contracts`，不涉及第三方许可证或外部下载，只有共享契约包被批准替代时才退出。若实现发现还需共享新的 HTTP DTO、增加 app-to-app import、更改 C09 SSE 或引入任何第三方包，停止并升级主调度重新规划。

### 12. 测试分层复用现有工具

- **纯逻辑 Vitest**：route 白名单/未知路径、context reducer/迟到响应、permission/action 状态、confirmation identity 保留与 retry、canonical run id、OpenAPI 交集、safe error/SSE 解码、单订阅清理。
- **React SSR 结构测试**：使用已安装 `react-dom/server` 验证七项导航、landmarks、五类 shell 的状态输出、无领域 Mock、禁用动作标签和停靠/对话框语义；不锁定完整 HTML、文案、空白或 CSS。
- **组件回调测试**：把键盘方向与焦点目标计算保持为纯 helper，验证按键到动作和 focus target 的稳定映射；不造自有 DOM 实现。
- **真实浏览器检查点**：在生产构建产物上人工验证 Tab/Shift+Tab、Enter/Space、方向键、Escape、浏览器前进后退、停靠/对话框返回焦点、reduced-motion、EventSource 恢复。C10 无现成 DOM/browser 测试依赖，故不在本 change 增加 jsdom/Testing Library/Playwright；C36 的跨能力验收再引入已批准的真实浏览器设施。
- **边界验证**：定向 Web 测试、`pnpm typecheck`、Web production build、lint/format、dependency checks、严格 OpenSpec 验证；实现任务不启动开发服务器。project-wide `pnpm test` 与 `pnpm verify` 由主调度在检查点按门禁决定。

## Risks / Trade-offs

- **[原生路由随深链增长可能变复杂]** → contribution 只接受固定模板并集中匹配；出现多层数据路由的可测复杂度后再替换路由实现，不改变 route id。
- **[没有 DOM 测试库使焦点自动化覆盖有限]** → focus 决策保持纯逻辑测试，生产构建做真实浏览器检查；C36 负责跨页面自动化，避免 C10 为一次测试引入三项依赖。
- **[C09 OpenAPI 表示 route 可用性而非人类权限]** → 两者使用不同状态源，unknown 默认不可提交，不从 `NOT_FOUND` 推断权限。
- **[EventSource 原生重连状态信息有限]** → 只区分 open/recovering/terminal error，服务端 `error.v1` 明确终止；不叠加容易重复连接的私有重连器。
- **[刷新后不能依赖旧 EventSource 的浏览器游标]** → 页面先从获授权投影读取当前状态，再建立新订阅；事件只是失效通知，正确性不依赖客户端游标持久化。
- **[后续 feature 可能试图复制 shell]** → 文件所有权、route/operation contribution 和 PageShell 契约写入 tasks 与依赖检查；主组合入口由 C10 单一维护。
- **[路线中的 ECharts adapter 暂不落地]** → 当前没有真实图表消费者且依赖未锁定；C34 首个图表任务必须走明确的 dependency checkpoint，而非在 C10 留空接口。

## Migration Plan

1. 主调度审阅并提交 C10 planning checkpoint；本阶段不改 manifest 或锁文件。
2. 实施 Agent 先落地纯 route/context/state/operation DTO 与最小测试，再实现 shell、五类 PageShell、停靠、确认和 C09 client，最后替换 `main.tsx` 的空挂载。
3. 使用测试注入的 C09 transport 与 fixtures 验证行为；生产入口只连接同源 C09，缺失 route/data 时显示真实空/不可用状态。
4. 运行定向测试、类型检查、Web production build、lint/format、依赖边界和严格 OpenSpec 验证；在生产构建做真实浏览器键盘/焦点检查，不启动开发服务器。
5. 主调度形成 implementation checkpoint 后派独立 Sol 验证；实现/验证通过再合并与归档，C32～C35 才可基于 contribution 接缝接入。

回滚只恢复 `apps/web` 原空挂载并删除 C10 拥有的 Web 文件；没有数据库、Cookie、领域事实、迁移或服务端协议需要回滚。任何已由 C09/领域模块提交的命令结果保持不变。
