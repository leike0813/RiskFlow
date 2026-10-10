Type: grilling
Status: resolved
Blocked by: 20, 26

# 确定 MVP 工程工具链与关键依赖

## Question

在技术研究、完整功能和界面规格明确后，MVP 应选择怎样的 monorepo、Node.js 服务端框架、React 构建方式、组件/表格/图表/关系图库、测试工具、Schema 共享与版本锁定策略；每项新依赖的用途、替换条件和私有部署约束是什么？

## Comments

- 已确认 monorepo 采用 pnpm workspace、TypeScript project references 与单一 `pnpm-lock.yaml`；MVP 不引入 Turborepo 或 Nx。现有 `demo` 在正式实施时迁入 workspace，不保留第二套包管理与构建基线。
- 已确认 workspace 采用 `apps/web`、`apps/api`、`apps/worker` 三个可部署应用，以及 `packages/contracts`、`packages/core`、`packages/adapters` 三个深层共享模块。Fastify API 保持薄传输层；LangGraph、Outbox 投影和异步任务归 Worker；API 与 Worker直接复用领域模块与契约，不通过内部 REST 或 MCP 互调。六个领域模块保留在 `core` 内，以公开接口隔离，不拆成一组浅包。
- 已确认正式前端采用 React 19、Vite SPA、React Router Data Mode、TanStack Query、Ant Design、React Hook Form + Zod resolver 和 Apache ECharts。Ant Design Table 与 ECharts graph 先覆盖表格和只读关系图；ECharts 通过项目自有适配模块使用。MVP 不引入 AG Grid、TanStack Table、Cytoscape.js、Redux、Zustand、MUI 或第二套前端框架；现有 `demo` 只迁移可复用的视觉语言与业务页面。
- 已确认 `packages/contracts` 以 Zod 4 运行时 Schema 作为跨应用契约的单一事实源，并通过 `z.infer` 派生 TypeScript 类型，禁止重复手写 DTO。Web、API、Worker 共用同一套 Schema；OpenAPI 与 JSON Schema 仅作为派生产物。持久化记录、领域事件和 LangGraph DTO 必须携带显式 `schemaVersion`；不兼容变更新增契约版本并在系统边界提供迁移适配器，不改写历史记录。前端表单状态可以独立存在，但领域约束只在共享契约与 `core` 中定义。
- 已确认使用 `tsc -b` 执行跨 workspace 类型与构建检查，Vitest 统一承担领域逻辑、适配器和前端单元测试；React Testing Library 只验证用户可观察行为；Playwright 仅以 Chromium 覆盖少量关键端到端闭环。PostgreSQL、Qdrant、Outbox 等适配器集成测试使用 Testcontainers 启动一次性真实服务，不以内存 Mock 模拟基础设施语义。MVP 不并行引入 Jest、Cypress 或第二套测试框架，不新增大段快照、完整文案及内部调用顺序测试。
- 已确认统一使用 Node.js 24 LTS、Fastify 5、Zod 4 与 Pino。PostgreSQL 访问采用 `pg + Kysely`；Kysely 仅存在于 `adapters` 内，用于类型安全查询和版本化迁移，其表行类型不得泄漏为领域 DTO。Qdrant 使用官方 JavaScript REST 客户端，LangGraph Worker 使用官方 JS 包及 PostgreSQL checkpointer。长任务状态更新优先使用 SSE；异步执行依靠 PostgreSQL 同事务 Outbox 与 Worker。MVP 不增加 Redis、BullMQ、Kafka、WebSocket、Socket.IO，也不并行引入 Express、NestJS 或其他服务端框架。
- 已确认所有资料解析器统一封装在 `packages/adapters` 的资料转换接口后：DOCX 使用 Mammoth 提取结构化 HTML并由 parse5 受控解析，PDF 使用 PDF.js 提取文本、页码与位置，XLSX/CSV 使用 ExcelJS 与 `csv-parse`，监测时序频域特征使用 `fft.js`，斜率、加速度等普通统计量由 `core` 中的确定性算法计算。扫描件 OCR、复杂表格和 CAD 标注提取作为独立、版本化的外部处理服务接入，首选 PP-StructureV3 等可私有部署能力，不把 Python 运行时嵌入 Node 进程。解析结果保留解析器名称、版本、配置和原始资料哈希；真实样本不达结构保真或准确率门槛时，只替换对应适配器，不修改领域契约。
- 已确认采用 ESLint Flat Config + typescript-eslint 负责静态规则，Prettier 只负责格式化；使用 dependency-cruiser 检查 `apps → packages` 的依赖方向、禁止跨包深层导入，并阻止 `contracts/core` 反向依赖 `adapters` 或具体应用。各包只通过 `package.json#exports` 暴露公开接口。所有检查由 pnpm workspace 脚本和 CI 统一执行；MVP 不引入 Husky、lint-staged、Biome 或第二套 lint/格式化工具，也不依赖本地 Git Hook 才能保证质量。
- 已确认在根目录固定 Node.js 24、pnpm 精确版本和统一的 `packageManager` / `engines`，生产与开发依赖均使用精确版本，由单一 `pnpm-lock.yaml` 锁定；CI 和交付构建只允许 `pnpm install --frozen-lockfile`，依赖升级单独评审，流水线不得自动改写锁文件。私有部署包包含许可证清单与允许列表、CycloneDX SBOM、npm 私有镜像或离线包缓存、按 digest 固定的容器镜像，以及 Playwright 浏览器、OCR 服务和模型等非 npm 工件的版本、哈希与来源记录。高危漏洞、许可证冲突、离线不可取得、维护停滞或无法达到性能/准确率门槛时触发升级或替换；替换必须保持既有适配器与领域契约。
- 已确认可观测性基线：Pino 输出结构化 JSON 并统一携带请求标识、流程运行标识和 Agent 任务标识；`prom-client` 暴露 API、Worker、Outbox、检索与模型调用的基础指标；OpenTelemetry Node SDK + OTLP exporter 串联 API、Worker、LangGraph 和外部服务调用。遥测数据只发送到私有部署组件，未配置 Collector 时可关闭链路导出且不得影响业务流程；PostgreSQL 中的业务审计记录不由普通日志或链路追踪替代。
- 面向用户的“日志”采用结构化事件的派生活动视图：底层保存稳定事件代码、结构化参数、级别、状态、业务对象引用、发生时间和消息模板版本，前端或查询适配器将其渲染为易懂的中文人类语言。派生视图不得直接展示 Pino 原始日志，不得暴露堆栈、提示词、密钥、模型内部过程或内部异常细节；模板文案调整不改变底层事实与审计链。

## 当前客户端设计

2026-10-08 用户确认采用 Electron 加载内网 HTTPS 页面。目标工作区增加 `apps/desktop`，形成四个应用与三个共享包；当前六成员实现由 C37 更新，仍使用根 pnpm 单一锁文件与依赖治理，不保留独立 Electron npm 工程。完整 UI 归 `apps/web`，Desktop 不导入 Web 源码或复制业务逻辑。客户端与服务器工具链、运行时及发布身份分别核验；C37 冻结 Electron 44.7.0、electron-builder 26.15.3，目标为 Windows 11 x64、Ubuntu 24.04 x64 与 macOS 14+ arm64，分别验证真实安装、信任与运行。本记录 Comments 保留原确认过程，当前客户端边界以[桌面客户端与多终端架构](../prototypes/desktop-client-architecture.md)为准。

## Answer

MVP 采用一个 TypeScript monorepo：pnpm workspace、TypeScript project references、单一精确锁文件；目标目录包含 `apps/web`、`apps/desktop`、`apps/api`、`apps/worker` 四个应用，以及 `packages/contracts`、`packages/core`、`packages/adapters` 三个深层共享模块。Desktop 只加载内网 HTTPS，业务 UI 统一由 Web 提供。Fastify API 只承担传输与权限入口，LangGraph、Outbox 投影和异步任务由 Worker 执行；API 与 Worker 直接复用领域模块和契约，不经内部 REST 或 MCP 互调。六个领域模块保留在 `core` 内，通过公开接口隔离。

前端沿已归档规格与现有实现复用 React 19、Vite SPA、页面壳、统一 HTTP/SSE 客户端和确认交互；原规划列出的 Router、表单、组件和图表候选不等于已经安装的生产依赖。C37 迁移复用 React Router 6.30.6 与 ECharts 5.6.0，逐项冻结版本、用途和退出条件，不为迁移补装整套候选框架。现有 `demo` 只迁移真实业务接线与可复用视觉语言，不保留第二套生产包管理、构建或运行基线。专用数据网格、额外状态库或服务端渲染框架只在出现已量化且现有基线无法满足的需求时评估。

服务端统一采用 Node.js 24 LTS、Fastify 5、Zod 4 与 Pino。`packages/contracts` 的 Zod Schema 是 Web、API、Worker 之间的运行时契约 SSOT，TypeScript 类型通过 `z.infer` 派生；OpenAPI 与 JSON Schema 只作为派生产物。持久化记录、领域事件和 LangGraph DTO 携带显式 `schemaVersion`，不兼容变更通过新增版本和边界迁移适配器处理，不改写历史记录。

PostgreSQL 访问使用 `pg + Kysely`，且 Kysely 与表行类型只存在于 `adapters`；Qdrant 使用官方 JavaScript REST 客户端；LangGraph 使用官方 JS 包及 PostgreSQL checkpointer。异步处理采用 PostgreSQL 同事务 Outbox + Worker，长任务状态更新采用 SSE。Redis、BullMQ、Kafka、Socket.IO、Express、NestJS 等延后到单机 Outbox 的吞吐、延迟或隔离能力经实测不达标时再评估。

资料接入使用有界适配器：Mammoth + parse5 处理 DOCX，PDF.js 处理文本型 PDF，ExcelJS 与 `csv-parse` 处理 XLSX/CSV，`fft.js` 只用于频域特征。扫描件 OCR、复杂表格和 CAD 标注提取通过独立、版本化、可私有部署的外部服务接入，默认候选为 PP-StructureV3，不在 Node 进程内嵌 Python。每次解析保存解析器版本、配置、原始资料哈希与质量结果；真实中文工程样例的结构保真、数值交叉验证、资源占用或维护状态不达门槛时，只替换相应适配器。

工程检查采用 `tsc -b`、ESLint Flat Config + typescript-eslint、Prettier 与 dependency-cruiser；依赖方向和公开接口由 project references、`package.json#exports` 与 dependency-cruiser 共同约束。测试采用 Vitest、React Testing Library、Playwright Chromium 和 Testcontainers：领域稳定行为优先，UI 只测用户可观察行为，少量关键闭环做端到端验证，PostgreSQL/Qdrant/Outbox 适配器使用一次性真实服务。MVP 不并行引入 Jest、Cypress、Biome、Husky、lint-staged 或脆弱的大段快照/完整文案测试。

可观测性分为三类：Pino 结构化 JSON 日志、`prom-client` 指标、OpenTelemetry + OTLP 链路；均只对接私有部署组件，遥测出口不可用不得阻断业务。业务审计继续可靠写入 PostgreSQL。面向用户的日志是结构化业务事件的派生活动视图，以稳定事件代码、参数和模板版本渲染易懂的中文，不直接暴露运维日志、堆栈、提示词、密钥、模型内部过程或内部异常细节。

实现 OpenSpec 必须在实施时固定 pnpm 和全部依赖的精确版本、用途、许可证、哈希及退出条件，并用 `pnpm install --frozen-lockfile` 构建。私有交付物包含许可证允许列表、CycloneDX SBOM、npm 离线缓存或内网镜像、按 digest 固定的容器镜像，以及 Playwright 浏览器、OCR 服务和模型等非 npm 工件的版本与哈希。高危漏洞、许可证冲突、维护停滞、离线不可取得或验收门槛不达标会触发受控升级或适配器替换；任何替换不得破坏领域契约和历史可重放性。
