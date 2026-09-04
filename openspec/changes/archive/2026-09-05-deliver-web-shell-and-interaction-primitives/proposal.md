## Why

RiskFlow 已具备 C09 的安全 HTTP/OpenAPI/SSE 边界，但 `apps/web` 仍只挂载空 React 根节点，用户无法在一致的工程上下文、权限和可访问交互中进入后续业务能力。C10 需要先冻结最薄的 Web shell 与共享交互原语，使 C32～C35 可以在不复制路由、状态、权限、证据、Agent 或传输逻辑的前提下接入真实领域页面。

## What Changes

- 建立 React 19 应用 shell：安全会话门、顶栏、七项业务导航、主工作区、通知/用户入口和右侧停靠区；七项导航固定为风险态势、工程项目、风险识别、风险评估、预警处置、知识与规则、复核与审计，Agent 不成为第八项业务导航。
- 建立闭合 Web 路由白名单及浏览器历史行为：登录、强制改密、七项业务入口和安全的未找到/不可用页；未知路径不回退到总览，不允许任意字符串注册生产路由。
- 建立工程、空间区段、工序节点三级上下文与切换规则；上下文变化保留当前合法页面、取消旧读取、清理失效子选择和越界证据，并触发当前页面按新上下文重新加载。
- 建立列表页、对象详情页、运行监控页、治理与版本页、复核工作台五类页面壳，以及一致的空、加载、就绪、异常、权限不足和业务阻断表现；本 change 不填充领域页面或领域事实。
- 建立权限态与动作可用性契约，区分权限不足、业务状态阻断、服务端 route 未启用和权限核验中；无权或不可用动作不提交请求，空状态不显示无法执行的虚假下一步入口。
- 建立右侧“上下文 / Agent”停靠区与证据定位/脱敏展示壳；Agent 业务内容由 C35 通过共享 slot 接入，C10 不预建会话、任务或结果。
- 建立类型化命令确认卡和确认状态：固定展示工程、目标对象、精确输入版本、预计事实与外部副作用；高影响命令显式确认，提交中防重复，安全重试保持原命令标识与幂等键。
- 建立键盘、焦点、语义 landmarks、状态播报和 reduced-motion 基线，覆盖路由切换、停靠区、页签、对话框和返回焦点。
- 建立 C09 消费边界：只使用同源 Cookie 的 Fetch、`/api/v1/openapi.json` 的 route availability、闭合 command/query 描述符和标准 EventSource 事件；保留 C09 稳定错误、版本/证据/审计引用和 SSE 游标语义。
- Non-goals：不实现 C32～C35 的领域页面、图表或领域查询投影，不创建领域事实、后端 route、私有持久化缓存、私有 EventSource 协议、生产 Mock 数据源、通用 RPC、任意 URL/branch 执行器或第二套路由/状态系统。

## Capabilities

### New Capabilities

- `platform/web-shell-interaction-primitives`: 定义 RiskFlow Web shell、闭合导航与上下文、五类页面壳、权限/证据/Agent/命令确认原语、可访问交互及 C09 HTTP/OpenAPI/SSE 消费边界。

### Modified Capabilities

无。

## Impact

- **直接依赖**：C01 `domain/contract-kernel` 的版本、证据与领域引用语义；C09 `platform/http-command-query-sse-shell` 的会话 Cookie、闭合 command/query、稳定错误、OpenAPI 与可恢复 SSE 契约。
- **下游消费者**：C32 工程与知识页面、C33 识别与复核页面、C34 评估预警处置页面、C35 Agent/审计/运维页面必须复用本 change 的 shell、route contribution、页面状态、动作、停靠和传输接缝，不建立第二套。
- **代码所有权**：后续实现限于 `apps/web/src/app/**`、`apps/web/src/shell/**`、`apps/web/src/shared/**`、`apps/web/src/api/**`、`apps/web/test/**` 及 `apps/web/src/main.tsx`、`apps/web/src/index.ts`；不得修改 API/Worker、共享 contracts/core/adapters、Demo、主 specs、其它 change 或领域实现。
- **依赖治理**：不新增第三方包或版本，只复用已锁定的 React 19.2.8、React DOM 19.2.8、TypeScript 5.9.3、Vite 8.2.2、Vitest 4.1.11 与浏览器原生 History/Fetch/EventSource/CSS；主调度在实现前只需把既有内部 `@riskflow/contracts@workspace:*`（本地版本 0.0.0）加入 Web importer，以复用 C01/C02 Schema/类型。路线中的 ECharts adapter 不在本次明确范围内，也不为尚无真实图表的 C10 建空 seam；首个真实图表 change 必须按依赖门固定版本、许可证、来源、离线方式和退出条件。
- **RI/RA 追踪**：本 change 不产生 RI/RA 领域判断；它为 RI-S14、RI-S61～RI-S65、RA-S4～RA-S7 的工程隔离、权限、版本、证据、审计和人工确认提供一致界面交付壳，字段与事实仍由 C01 及后续领域 change 拥有。
