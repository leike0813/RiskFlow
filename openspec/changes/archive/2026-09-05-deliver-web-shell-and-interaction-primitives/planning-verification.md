# C10 OpenSpec 规划验证报告

## 检查点身份

- Change：`deliver-web-shell-and-interaction-primitives`（C10）
- Task / Dispatch：`task_65ad43ad42b0` / `ctx_d8fd3a1ebfdf`
- Worktree ID：`d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c10-web-shell`
- Worktree / Branch：`/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c10-web-shell` / `leike0813/c10-web-shell`
- Base HEAD / planning HEAD：`488aed0a1278711dd01e503f7d072155ee0e99e3`
- Task kind / phase / outcome：`planning` / `planning` / `succeeded`
- Main verification：`pending`；本 worker 未提交、合并、归档或改动 main。

## 已读事实源

- 项目 `AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 与 OpenSpec proposal/specs/design/tasks 动态 instructions。
- C01 主 spec `openspec/specs/domain/contract-kernel/spec.md`；项目 AGENTS.md §2 的 RI/RA 字段、证据、版本、审计和 Agent-native 约束作为本 UI 壳层的领域边界，C10 未增加或重命名领域字段。
- C09 已归档主 spec `openspec/specs/platform/http-command-query-sse-shell/spec.md`、proposal/design/tasks/planning verification，以及生产导出 `apps/api/src/index.ts`、`HTTP_ROUTE_CATALOG_V1`、`HTTP_SYSTEM_ROUTE_CATALOG_V1`、会话/安全错误 Schema、OpenAPI 3.1 和 SSE 事件/游标实现。
- 当前 `apps/web` 的 `package.json`、`tsconfig.json`、Vite 配置、空 `main.tsx`/barrel，以及根依赖政策、锁文件和 dependency-cruiser 的 app-to-app 禁止规则。
- `.scratch/riskflow-master-plan/prototypes/full-product-ui-spec.md` 的全局 shell、五类页面骨架、证据、Agent、确认、权限、角色矩阵和验收条款；`openspec-delivery-roadmap.md` 的 C10 条目、C09→C10 依赖、目录所有权和 C32～C35 下游分工。
- 前一规划 worker 已完成的输入探索结论已复核：`apps/web` 是无 router/state/page/test 的 React 19 空壳，C09 是唯一 HTTP/OpenAPI/SSE 边界，C10 不拥有业务事实、后端、生产 Mock、私有缓存或通用 RPC。

`.codegraph/` 目录存在，但当前任务明确要求直接读取指定事实源并完成缺失工件，且系统层禁止本 worker 另行委派；本 worker 只做了指定文件与精确符号读取，没有调用会把大量源码带入主上下文的 CodeGraph explore 工具。

## 规划结论

本 change 新增单一 capability：`platform/web-shell-interaction-primitives`。边界冻结为：

- 七项且仅七项业务导航，固定根路径为 `/overview`、`/projects`、`/identification`、`/assessment`、`/warnings`、`/knowledge`、`/review-audit`；会话路径仅 `/login`、`/change-password`，Agent 只保留右侧 contribution slot。
- `WebContextV1` 只保存工程标识、空间精确引用、工序节点标识和 revision；切换使旧请求/结果失效、清理从属选择与越界证据，不复制工程或工序事实。
- A～E 五类 PageShell 统一使用七态 `idle | loading | ready | empty | error | forbidden | unavailable`，加载、空、技术错误、权限和业务不可用相互分离。
- `WebActionAvailabilityV1` 与类型化确认 plan 分离权限、业务阻断、route 缺失和核验中；C10 保留 owning feature 提供的命令身份与幂等键，不生成业务幂等规则。
- 右侧停靠区只拥有 `closed | context | agent` 的短期 UI 状态；证据 full/redacted/error 由授权投影提供，Agent 由 C35 注入，不形成第二套会话、任务、结果或思维链显示。
- C09 client 仅使用同源 Cookie Fetch、当前 OpenAPI 与品牌化闭合 operation contribution 的交集，以及浏览器原生 EventSource；不导入 `apps/api`，不暴露任意 method/path/URL/branch，不管理私有 cursor/重连协议或事实缓存。
- 键盘、焦点、landmark、live region、dialog/tablist 和 reduced-motion 纳入共享交互契约；高频 SSE 事件只在一个渲染周期触发一次投影刷新。
- 没有领域页面、领域数据、后端、投影、生产 Mock、客户端持久化缓存、通用 RPC、图表实现或领域 Schema 增量；RI/RA 只保留工程隔离、版本、证据、审计与确认的 UI 交付通道。

## 依赖与文件所有权

本规划不新增任何第三方包或版本。实现只复用已锁定的 React 19.2.8、React DOM 19.2.8、TypeScript 5.9.3、Vite 8.2.2、Vitest 4.1.11 与浏览器原生 History/Fetch/EventSource/CSS；不增加 router、state、cache、SSE、DOM testing wrapper 或 ECharts。主调度在实现前只需将既有内部 `@riskflow/contracts@workspace:*`（本地版本 0.0.0、来源 `packages/contracts`、随共享契约替代而退出）加入 Web importer，并冻结验证 lockfile。

Roadmap 的 C10 摘要曾包含 ECharts adapter，但当前 Dispatch 锁定范围未包含图表且正式 workspace 未锁定 ECharts。为避免无消费者 seam 和额外依赖，C10 不建立图表适配；C34 首个真实图表必须由主调度按依赖门决定精确版本、用途、许可证、官方来源、离线方式和退出条件。

本 worker 只创建或修正以下 change 工件：

- `.openspec.yaml`
- `proposal.md`
- `specs/platform/web-shell-interaction-primitives/spec.md`
- `design.md`
- `tasks.md`
- `planning-verification.md`

实施所有权限于 `apps/web/src/{app,shell,shared,api}/**`、`apps/web/test/**`、`apps/web/src/main.tsx` 和 `apps/web/src/index.ts`。API/Worker、`packages/**`、Demo、根配置/锁文件、主 specs、其它 change 和 Git 历史均为禁止修改区。

## 测试层次与依赖检查点

- 纯逻辑 Vitest 覆盖 route/context/action/confirmation/OpenAPI/C09 error/SSE 状态和资源清理。
- `react-dom/server` 结构测试覆盖七项导航、landmarks、五类 PageShell、状态/权限/停靠/确认语义，不锁完整 HTML、文案、CSS 或 snapshot。
- 键盘映射和 focus target 用纯 helper 测试；production build 以真实浏览器人工检查 Tab/Shift+Tab、Enter/Space、方向键、Escape、History、返回焦点和 reduced-motion。C36 再承担跨能力浏览器自动化设施。
- 实施定向门为 Web tests、typecheck、Web production build、lint/format、dependency checks 与 strict OpenSpec；不启动开发服务器，project-wide `pnpm test`/`pnpm verify` 由主调度决定。
- 除已批准的内部 `@riskflow/contracts@workspace:*` 外，若实现需要新 manifest dependency、共享 HTTP DTO、`apps/api` import、C09 协议变更或任何新包，必须停止并升级主调度建立 dependency/contract checkpoint。

## 自检结果

本报告落盘后已执行以下检查：

| 检查 | 结果 |
| --- | --- |
| `openspec status --change deliver-web-shell-and-interaction-primitives` | 通过；4/4 planning artifacts complete |
| `openspec validate deliver-web-shell-and-interaction-primitives --strict --no-interactive` | 通过；change valid |
| C10 六个规划文件 `pnpm exec prettier --check ...` | 通过；全部符合 Prettier |
| `git diff --check` | 通过；无空白错误 |
| 路径范围 | 通过；`git status --short` 只显示 C10 change 目录 |
| Git 身份 | 通过；HEAD 与 base 均为 `488aed0a1278711dd01e503f7d072155ee0e99e3`，无 commit/merge/archive |
| 结构审阅 | 通过；proposal、1 个 delta spec、design、19 个未完成实施 task、planning verification 齐全，无会改变任务拆分的 Open Questions |

## 剩余主调度动作

1. 审阅本规划和当前 Dispatch 的结构化 execution envelope，形成 `docs(openspec): 定义 C10 Web 壳层与交互原语` planning checkpoint。
2. 单独加入 `@riskflow/contracts@workspace:*` Web importer 并完成 frozen install、依赖政策/边界检查，形成 dependency checkpoint。
3. 派发新的 Luna max 使用 `openspec-apply-change`，只实现 tasks 的 `apps/web` 范围，不启动开发服务器、不提交、不归档。
4. implementation checkpoint 后派发新的 Sol high 独立验证；最终 dependency 判断、commit、merge、main verification、sync/archive 与 worktree 回收仍由主调度负责。
