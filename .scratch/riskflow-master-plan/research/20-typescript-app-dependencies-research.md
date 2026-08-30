# TypeScript 文档解析与前端工程依赖核查

> 核查日期：2026-08-28  
> 研究票：**核实 TypeScript 文档解析与前端工程依赖**  
> 来源范围：官方文档、官方源代码仓库、npm 官方元数据及许可证。本文不把博客、聚合榜单或第三方测评作为事实来源。

## 1. 结论

MVP 可以保持 TypeScript 模块化单体，但不能把“TypeScript 全栈”误解为所有文档能力都必须塞进 Node.js 进程。可落地的组合是：

- 统一运行基线采用 **Node.js 24 LTS**。截至核查日，Node.js 官方将 v24 标为 LTS，而 v26 仍为 Current；生产应用应使用 Active/Maintenance LTS。Node 24 同时覆盖当前 `pdfjs-dist`、React Router、Vite 等候选的 Node 引擎要求。[Node.js 发布状态](https://nodejs.org/en/about/previous-releases)
- API 采用 **Fastify + `@fastify/multipart` + `@fastify/type-provider-zod`**，领域与 HTTP 边界共用 Zod 4 Schema；文件上传按流写入不可变原件目录，不先整体读入内存。Fastify 官方文档覆盖 TypeScript、校验与序列化；官方 multipart 插件支持流式读取和大小限制。[Fastify Reference](https://fastify.dev/docs/latest/Reference/) · [Fastify Zod Type Provider](https://fastify.dev/docs/latest/Reference/Type-Providers/#zod) · [`@fastify/multipart` 文档](https://github.com/fastify/fastify-multipart/blob/main/README.md)
- 文档解析采用格式适配器：**Mammoth + parse5** 处理 DOCX，**PDF.js (`pdfjs-dist`)** 处理文本型 PDF，**ExcelJS** 有条件处理 XLSX，**`csv-parse`** 处理 CSV。所有适配器只输出同一版本化 JSON-LD DTO，不让第三方库对象进入领域层。
- 扫描 PDF/PNG/JPEG 的“OCR + 版面 + 表格”若仍是 MVP 业务可用承诺，就需要一个**内网本地的外部解析进程**。默认候选为 PaddleOCR 3 的 **PP-StructureV3**；Node 只通过有版本的适配器提交不可变原件并接收结构化结果。纯 Node 的 Tesseract.js 不能直接处理 PDF，也不提供本票所需的完整表格/版面恢复，因此不能单独满足既定 MVP 契约。[PP-StructureV3 使用文档](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PP-StructureV3.html) · [Tesseract.js PDF 边界](https://github.com/naptha/tesseract.js/blob/master/docs/faq.md#are-pdf-files-supported)
- React 前端采用 **React + Vite SPA + React Router Data Mode + TanStack Query**。RiskFlow 已有独立 Node API，不需要为 SSR、Server Actions 或另一套服务端路由引入 Next.js/React Router Framework Mode。React Router 官方将 Data Mode 定位为保留 bundler 和 server abstraction 控制、同时提供 loader/action/pending 等数据能力的模式。[React Router 模式选择](https://reactrouter.com/start/modes)
- 页面组件采用 **Ant Design**；表单使用 **React Hook Form + Zod resolver**，表格先使用 Ant Design Table；图表和 MVP 只读关系图统一使用 **Apache ECharts**。不在 MVP 同时引入 MUI、AG Grid、TanStack Table、D3 和 Cytoscape.js。
- 浏览器流式更新采用 **SSE**：命令仍走普通 POST，运行进度、Agent 输出和应用内事件走 GET 事件流；同源会话优先使用浏览器原生 `EventSource`，无需默认增加客户端包。若后续确需 POST 流或自定义认证头，再加入 `eventsource-parser`。SSE 的事件 `id` 与 `Last-Event-ID` 必须对应可重放的任务事件序列，而不是仅存在于 API 内存中。[WHATWG SSE 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) · [`eventsource-parser` 文档](https://github.com/rexxars/eventsource-parser)
- 构建与测试采用 **TypeScript project references / `tsc -b` + Vite + Vitest + React Testing Library + Playwright Chromium**。后端不再加一层 tsup/esbuild bundler；Playwright 浏览器必须在联网构建区下载并镜像到内网制品库，运行环境不得访问公网 CDN。[TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references) · [Vitest 指南](https://vitest.dev/guide/) · [Playwright 浏览器制品镜像](https://playwright.dev/docs/browsers#download-from-artifact-repository)

这套组合的关键不在“库能打开文件”，而在四个约束：原件不可变、解析配置与模型可追溯、输出 DTO 唯一、任何解析结果都能回到页码/单元格/版面坐标和资料段标识。

## 2. 核查时的候选版本与许可证

以下是 2026-08-28 从 npm 官方元数据核得的 `latest`。它们是 OpenSpec 原型的起始候选，不等于允许直接写入锁文件；正式引入仍须固定精确版本、完整性哈希和传递依赖。

| 领域 | 候选版本 | 直接许可证 | 状态判断 |
|---|---:|---|---|
| DOCX | [`mammoth@1.12.1`](https://registry.npmjs.org/mammoth/1.12.1) | BSD-2-Clause | 2026-08 有发布，可进入原型 |
| HTML 结构读取 | [`parse5@8.0.1`](https://registry.npmjs.org/parse5/8.0.1) | MIT | 2026-04 有发布，可进入原型 |
| PDF | [`pdfjs-dist@6.2.108`](https://registry.npmjs.org/pdfjs-dist/6.2.108) | Apache-2.0 | Mozilla 官方构建；要求 Node `>=22.13 || >=24` |
| XLSX | [`exceljs@4.4.0`](https://registry.npmjs.org/exceljs/4.4.0) | MIT | npm 正式版停在 2023-10，只能带退出条件试用 |
| CSV | [`csv-parse@7.0.2`](https://registry.npmjs.org/csv-parse/7.0.2) | MIT | 2026-08 有发布，且解析器无外部依赖 |
| 频域特征 | [`fft.js@4.0.4`](https://registry.npmjs.org/fft.js/4.0.4) | MIT | 正式版停在 2021-01；算法小而稳定，但必须封装并准备替换 |
| API / 上传 | [`fastify@5.12.1`](https://registry.npmjs.org/fastify/5.12.1) / [`@fastify/multipart@10.1.1`](https://registry.npmjs.org/%40fastify%2Fmultipart/10.1.1) | MIT / MIT | 活跃；multipart 不得低于已修复的 10.1.1 |
| Schema | [`zod@4.4.3`](https://registry.npmjs.org/zod/4.4.3) / [`@fastify/type-provider-zod@1.0.0`](https://registry.npmjs.org/%40fastify%2Ftype-provider-zod/1.0.0) | MIT / MIT | 作为 DTO、领域与传输边界的唯一 Schema 工具 |
| React 应用 | [`react@19.2.8`](https://registry.npmjs.org/react/19.2.8) / [`react-router@8.3.0`](https://registry.npmjs.org/react-router/8.3.0) | MIT / MIT | 当前版本活跃；Router 要求 Node `>=22.22` |
| 服务端状态 | [`@tanstack/react-query@5.102.8`](https://registry.npmjs.org/%40tanstack%2Freact-query/5.102.8) | MIT | 当前版本活跃；只管理查询缓存，不拥有业务事实 |
| 表单 / 组件 | [`react-hook-form@7.86.0`](https://registry.npmjs.org/react-hook-form/7.86.0) / [`@hookform/resolvers@5.9.1`](https://registry.npmjs.org/%40hookform%2Fresolvers/5.9.1) / [`antd@6.6.2`](https://registry.npmjs.org/antd/6.6.2) | MIT | 当前版本活跃；AntD 负责视图，Zod 负责约束 |
| 图表 / 关系图 | [`echarts@6.1.0`](https://registry.npmjs.org/echarts/6.1.0) | Apache-2.0 | 当前版本活跃；已有 Demo 也采用 ECharts |
| 条件 SSE 解析 | [`eventsource-parser@4.1.0`](https://registry.npmjs.org/eventsource-parser/4.1.0) | MIT | 仅在原生 EventSource 不满足协议时加入 |
| 构建 | [`typescript@7.0.2`](https://registry.npmjs.org/typescript/7.0.2) / [`vite@8.2.2`](https://registry.npmjs.org/vite/8.2.2) / [`@vitejs/plugin-react@6.1.1`](https://registry.npmjs.org/%40vitejs%2Fplugin-react/6.1.1) | Apache-2.0 / MIT / MIT | Vite 要求 Node `^20.19 || >=22.12`；Node 24 满足 |
| 测试 | [`vitest@4.1.11`](https://registry.npmjs.org/vitest/4.1.11) / [`@testing-library/react@16.3.3`](https://registry.npmjs.org/%40testing-library%2Freact/16.3.3) / [`@playwright/test@1.62.1`](https://registry.npmjs.org/%40playwright%2Ftest/1.62.1) | MIT / MIT / Apache-2.0 | 当前版本活跃；Playwright 浏览器是另行管理的大制品 |

上表的直接依赖均是 MIT、BSD 或 Apache-2.0 许可，没有把 AGPL、SSPL、BSL 或商业双许可组件放入默认组合。Apache-2.0 组件在分发时仍须保留许可证、版权和适用的 NOTICE；最终结论必须覆盖精确锁文件的全部传递依赖，而不能只看直接包的 `license` 字段。

## 3. 文档与监测解析

### 3.1 DOCX：Mammoth + parse5，有界使用

Mammoth 支持标题、列表、表格、脚注、图片、链接和自定义 style map；它明确以语义 HTML 为目标，忽略大量版式细节，复杂 DOCX 转换也可能不完美。[Mammoth 支持范围](https://github.com/mwilliamson/mammoth.js#readme) Mammoth 还明确声明**不会清洗源文档输出**。[Mammoth 安全警告](https://github.com/mwilliamson/mammoth.js/blob/master/README.md#usage)

因此适配器必须这样使用：

1. 用固定、版本化的 style map 将甲方常见标题和题注样式映射到语义元素；
2. 用 parse5 把生成的 HTML 解析为内部节点，再映射到章节、段落、表格、图片说明与证据定位；parse5 是 WHATWG HTML 兼容解析器。[parse5 官方仓库](https://github.com/inikulin/parse5)
3. 不把 Mammoth HTML 直接写库或渲染到浏览器，不允许 `dangerouslySetInnerHTML`；
4. 原始图片单独形成不可变工件，图注与图片关系在样例不可靠时进入资料段复核；
5. 不承诺还原字体、边框、浮动对象、Word 页码或复杂文本框版式。

退出条件：样例中的标题树、表格合并关系或图注关联不能稳定通过验收，或安全问题长期无修复时，保留 `DocxParser` 契约，替换为外部文档解析进程；不得在各用例中散补 OOXML 特例。

### 3.2 文本型 PDF：PDF.js 提取事实，结构由适配器恢复

PDF.js 是 Mozilla 的 PDF 解析与渲染实现，官方发布 `pdfjs-dist`，许可证 Apache-2.0。[PDF.js Getting Started](https://mozilla.github.io/pdf.js/getting_started/) `PDFPageProxy.getTextContent()` 提供逐页文本内容；PDF.js 官方仓库也提供 Node 示例。[PDFPageProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#getTextContent) · [Node 示例目录](https://github.com/mozilla/pdf.js/tree/master/examples/node)

PDF 本身不是标题/表格语义格式。PDF.js 能给出页、文本项、字体与变换坐标，但这不等于可靠的章节、阅读顺序和表格。MVP 应先保存逐页原始文本项和坐标，再用版本化规则/Agent 形成章节、表格与图注候选；证据定位始终保留页码和包围框。复杂多栏、跨页表格、无文本层页面或质量未达门槛时，路由到 PP-StructureV3，而不是悄悄拼接出错误顺序。

PDF.js 的 worker、CMap、标准字体等运行工件必须随离线部署包本地提供并固定哈希，不从 CDN 动态加载。

### 3.3 扫描件：PP-StructureV3 是独立本地解析进程

PP-StructureV3 官方文档说明其接收图片或 PDF，输出按阅读顺序排列的版面块、块类型、内容、包围框、OCR 结果，并可启用表格识别；它还提供服务部署路径和多语言调用方式。[PP-StructureV3 输出契约](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PP-StructureV3.html) PaddleOCR 源代码采用 Apache-2.0。[PaddleOCR 官方仓库与许可证](https://github.com/PaddlePaddle/PaddleOCR)

它不应成为第二套业务服务：

- Node 工程数据模块拥有文件登记、权限、版本、任务、资料段和审计；
- OCR 进程只接受工件引用、解析配置版本和幂等键，返回带页码/坐标的候选结构；
- 模型、字典、字体与 Python/wheel 依赖必须预下载到内网镜像，启动时禁止联网；
- 记录 PaddleOCR、PaddlePaddle、模型权重、配置及容器镜像的精确版本与哈希；源代码 Apache-2.0 不能替代对每个下载模型工件许可证的核查；
- 在单卡 4090 基线上与 llama.cpp 分时或限额运行，不能让 OCR 抢占模型网关导致主流程不可用。

Tesseract.js 7 是 Apache-2.0、可在 Node worker 中本地 OCR 图片，但官方 FAQ 明确说明不支持 PDF，PDF 必须先由 PDF.js 等渲染为图片。[Tesseract.js README/许可证](https://github.com/naptha/tesseract.js/blob/master/README.md) · [PDF 限制](https://github.com/naptha/tesseract.js/blob/master/docs/faq.md#are-pdf-files-supported) 它可作为“只有清晰单页图片、无需表格/版面”的降级候选，不能作为本 MVP 默认扫描解析器。

### 3.4 XLSX/CSV 与监测特征

ExcelJS 可读取工作簿、工作表、单元格、公式/结果、合并单元格，并提供流式 XLSX reader；许可证 MIT。[ExcelJS README](https://github.com/exceljs/exceljs#readme) · [ExcelJS LICENSE](https://github.com/exceljs/exceljs/blob/master/LICENSE) 但 npm 最新正式版仍是 2023-10 的 4.4.0，这是一项维护风险，不能无条件锁定。

原型中允许 ExcelJS，条件是：

- 只接受 XLSX；拒绝宏、外部链接的主动解析和公式执行；公式单元格只读取已保存结果或标记为“不具备可用缓存值”；
- 同时保留工作表、单元格地址、表头、合并范围和原始值，生成稳定行组资料段；
- 对 ZIP 展开总量、条目数、压缩比、工作表数、行列数和解析时间设置硬上限；
- 用甲方样例覆盖日期系统、空白行、合并表头、数值/文本混合、公式缓存和多个工作表。

不默认采用 npm 上的 `xlsx`。SheetJS 官方文档明确说公共 npm registry 的包已过期，官方分发源是自有 CDN，并建议 vendoring；这会给只依赖内网 npm 镜像和标准锁文件的供应链增加例外。[SheetJS Node 安装说明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)

`csv-parse` 实现 Node stream/async iterator，支持 BOM、列映射、原始记录、行信息、记录大小限制，并且官方说明没有外部依赖。[CSV Parse API](https://csv.js.org/parse/api/) · [CSV Parse options](https://csv.js.org/parse/options/) CSV 适配器应保留原始行号/字节片段，显式配置编码、分隔符、时区、单位和重复采样策略，禁止默默猜测后覆盖原值。

短期斜率、加速度和异常评分是 RiskFlow 确定性领域算法，不引入 DataFrame/统计大包。频域主峰可把 `fft.js` 封装在单一 `FrequencyPeakCalculator` 后；其官方实现提供 real FFT，许可证 MIT。[fft.js README/许可证](https://github.com/indutny/fft.js) 由于正式版长期未更新，OpenSpec 必须固定补零、窗函数、采样间隔、缺失值和主峰选择规则，并用朴素 DFT 参考实现做交叉测试。只要它无法通过 Node 24/TS 7、数值误差或安全门槛，就替换实现而不改变领域接口。

## 4. React 应用、表单、表格与可视化

### 4.1 应用骨架

- **React Router Data Mode**：约 45 个页面需要深链、嵌套路由、错误边界、按路由懒加载和离开未保存表单提示；Data Mode 提供 loaders/actions/pending/useBlocker，同时保留 Vite 和独立 API 的边界。[Data Mode 自定义框架](https://reactrouter.com/start/data/custom)
- **TanStack Query**：只缓存 API 查询、分页和任务状态；query key 必须包含工程、对象标识、精确版本和筛选条件，SSE 到达后按对象事件失效或精确更新缓存。官方文档将其定位为获取、缓存、同步 server state，并说明 key 驱动缓存。[TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview) · [Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- 当前工程/区段/工序、停靠栏开关等短期界面状态用 React context/reducer 即可；不先引入 Redux/Zustand。正式业务事实、Agent 任务和会话不能只存在于浏览器 store。

### 4.2 组件与表单

Ant Design 已提供 Layout、Table、Form 控件、Drawer、Modal、Tree、Upload、Skeleton 等构件，适合五类全局骨架和右侧证据/Agent 停靠区；Drawer 官方定义正适合不离开当前上下文查看信息或处理子任务。[Ant Design Drawer](https://ant.design/components/drawer/) · [Table](https://ant.design/components/table/) · [Form](https://ant.design/components/form/) Ant Design 采用 MIT。[Ant Design LICENSE](https://github.com/ant-design/ant-design/blob/master/LICENSE)

表单约束仍由共享 Zod Schema 拥有：React Hook Form 负责脏状态、字段订阅和提交，`@hookform/resolvers/zod` 直接消费 Zod；不再在 AntD `rules` 中复制一套领域必填、联合类型或数值区间。[React Hook Form](https://react-hook-form.com/get-started) · [Resolvers 官方仓库](https://github.com/react-hook-form/resolvers#readme) AntD Form 仅承担布局、标签和错误展示。

Ant Design Table 先覆盖服务端分页、筛选、固定列、展开行和有限虚拟滚动。客户端不得 projection 全库后再分页；高频监测更新只刷新可见序列和摘要。若实测出现以下任一情况，再评估 TanStack Table/专用网格：单页需要持续编辑数千行、列级虚拟化、复杂透视/分组，或 AntD virtual 模式无法达到交互门槛。

### 4.3 图表与工序风险关联图谱

Apache ECharts 同时提供折线、柱状、饼图、heatmap 和 graph series，支持 Canvas/SVG 渲染与事件交互，采用 Apache-2.0。[ECharts Handbook](https://echarts.apache.org/handbook/en/get-started/) · [Graph series 配置](https://echarts.apache.org/en/option.html#series-graph) · [LICENSE](https://github.com/apache/echarts/blob/master/LICENSE.txt)

MVP 用一个内部 React adapter 管理 ECharts 实例、resize、dispose、主题和事件，不额外引入长期维护不确定的 React wrapper。工序风险关联图谱当前是只读的节点聚焦和沿边下钻，ECharts graph 足够；图加载失败仍按既定界面契约降级为列表。

只有在完整产品出现大图增量布局、复合节点、路径交互编辑、图算法或 ECharts 无法稳定承载的规模时，才引入 Cytoscape.js。其当前 npm 包是 MIT，但在 MVP 同时维护两套图渲染与交互抽象没有收益。[Cytoscape.js 文档](https://js.cytoscape.org/) · [npm 元数据](https://registry.npmjs.org/cytoscape/3.34.2)

## 5. 流式事件、API 与上传边界

Fastify 保留为薄传输层：路由只做认证、Zod 输入输出、幂等键、上传限额和领域命令调用；不得在 route handler 中定义第二套风险字段或 P/C 规则。Fastify 官方推荐以 Schema 校验请求和序列化响应，并警告 Schema 会编译为函数，因此只能使用代码库受信 Schema，不能执行用户提交的 Schema。[Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

上传必须流式计算内容哈希并写入受控临时目录，完成大小、类型与内容校验后原子登记为不可变工件。`@fastify/multipart` 的 `saveRequestFiles()` 曾存在“超限后客户端中止导致挂起与临时文件不清理”的高危 DoS；官方公告标明 `<10.1.1` 受影响，10.1.1 修复。[GHSA-vmph-573x-85f6](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-vmph-573x-85f6) 因此原型最低只能用 10.1.1，且仍须验证中止上传、超限、慢速上传和临时文件回收。

SSE 契约：

- 事件至少含 `eventId`、`taskId/runId`、`objectRef/version`、`eventType`、`occurredAt` 和结构化 payload；
- API 从持久化任务/Outbox 投影读取，断线后按 `Last-Event-ID` 重放；客户端按 `eventId` 幂等去重；
- 只推送“阶段、工具调用、正式对象引用、错误/阻断”等可审计事件，不推送思维链；
- 代理层关闭不合适的响应缓冲并发送心跳，断线显示“正在重连”，不能把陈旧状态伪装为实时；
- 命令、复核、确认与上传继续使用普通 HTTP，不经 SSE 反向写入。

若原生 `EventSource` 因必须使用 POST、读取 fetch stream 或设置自定义认证头而不满足契约，`eventsource-parser` 可解析任意来源的分块 SSE，并提供 TransformStream 与 buffer 上限；许可证 MIT。[eventsource-parser README](https://github.com/rexxars/eventsource-parser#readme) WebSocket 延后到完整产品确实出现双向实时协作或实时监测控制；MVP 已明确没有数据库/API/实时监测流入口，不能为想象中的实时能力提前维护另一套连接协议。

## 6. 构建与测试

- **TypeScript `tsc -b`**：用 project references 表达 `domain -> application -> adapters -> api/worker/web` 的依赖方向；API/Worker 编译为 Node ESM，不 bundle 第三方原生/动态资产，减少 PDF/OCR/数据库包的打包陷阱。[TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references)
- **Vite**：只负责 React SPA 开发与生产静态资产；内网部署由 Node/API 或反向代理提供本地静态文件，不加载 CDN。[Vite Guide](https://vite.dev/guide/) · [Vite LICENSE](https://github.com/vitejs/vite/blob/main/LICENSE)
- **Vitest**：领域、解析适配器、API 和 React 组件共用 runner；它复用 Vite 配置、支持 TypeScript/JSX，但运行测试不会替代 `tsc` 类型检查。[Vitest Getting Started](https://vitest.dev/guide/) · [Vitest TypeScript 注意事项](https://vitest.dev/guide/learn/writing-tests#testing-typescript)
- **React Testing Library**：验证用户可观察的标签、表单、权限置灰、加载/异常/复核行为；不锁定组件树、完整文案、CSS 和大 snapshot。官方原则同样强调按软件实际使用方式测试，避免实现细节。[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- **Playwright**：只保留高价值端到端链路和五类全局骨架的关键行为。MVP 以 Chromium/1920×1080 为必测，其他浏览器在完整产品兼容性范围确认后再扩展。Playwright 每个版本绑定特定浏览器二进制；官方支持内部下载镜像与 hermetic install。[Playwright Browsers](https://playwright.dev/docs/browsers)

解析测试使用脱敏甲方样例或明确标记的合成工件，断言稳定结构、证据定位、错误分类与重处理行为；不把完整 HTML、整段 OCR 文本、字段顺序或第三方库内部 AST 做快照。扫描件识别质量必须另有按文档块/表格/定位的验收集，不能用“命令成功退出”代替。

## 7. 明确延后、拒绝与替换条件

| 项目 | MVP 处理 | 何时重新评估 |
|---|---|---|
| DOC/XLS/PPT/PPTX/TIFF 深度解析 | 延后；只做已决 MVP 格式 | 完整产品输入票进入实施，且有甲方样例与验收定义 |
| DWG/DXF | 仅登记，不引入 CAD SDK | 甲方给出图层/标注样例和业务可用验收 |
| 数据库/API/实时监测流/MCP | 不建入口，不建空 connector | 对应集成票明确来源、快照、时效和凭据契约 |
| SheetJS CE | 不默认采用 | ExcelJS 样例失败，且可以接受 vendored tarball、独立来源/哈希/升级流程 |
| Tesseract.js | 不作为默认扫描解析器 | 只需单页清晰图片 OCR，且中文样例、版面和资源测试通过 |
| Cytoscape.js / 专用 data grid | 不进入 MVP | ECharts/AntD Table 达不到已量化的图规模或表格交互门槛 |
| WebSocket | 不进入 MVP | 出现经规格确认的双向实时协作/控制，SSE + POST 不能表达 |
| Next.js / React Router Framework Mode | 不进入 MVP | 出现 SSR/SSG、服务端路由或公开站点首屏需求，并愿意调整独立 API 边界 |
| tsup/webpack/第二套测试 runner | 不进入 MVP | `tsc -b`/Vite/Vitest 有经复现的产物或性能阻塞 |
| LoRA、CAD 深解析、生产 HA | 按地图延后 | MVP 实测与甲方部署条件给出升级理由 |

依赖的通用退出条件：出现未修复高危漏洞；不再支持选定 Node LTS；许可证变为非允许项；运行时要求公网；无法固定模型/worker/浏览器等工件；连续维护停滞并已影响兼容或缺陷修复；或真实样例未达到 OpenSpec 门槛。替换只能发生在适配器/组件边界内，不能把兼容分支散落到业务用例。

## 8. 内网供应链与许可证规则

1. OpenSpec 为每个新直接依赖记录精确版本、用途、许可证、上游 URL、引入原因、移除/替换条件；生产锁文件禁止宽松漂移，安装使用 frozen/immutable lockfile。
2. 在联网构建区镜像 npm tarball、Node 镜像、PDF.js worker/CMap/font、PaddleOCR wheel/模型、Playwright Chromium；记录 SHA-256。运行部署做断网启动与全链路测试，任何运行时下载都视为失败。
3. 由精确锁文件生成 SBOM，核对全部传递许可证与安全公告。默认允许 MIT、ISC、BSD-2/3-Clause、Apache-2.0；MPL/LGPL/EPL 需逐项确认分发义务；GPL/AGPL/SSPL/BSL/Commons Clause/商业组件未经书面批准不得进入默认部署包。
4. Apache-2.0 组件保留 LICENSE/NOTICE；前端静态产物、Node 产物、OCR 容器和测试浏览器分别生成第三方清单。模型权重作为独立制品核查，不能从代码仓库许可证推定其授权。
5. 每次依赖升级重新跑输入语料、JSON-LD、页面、SSE 恢复、离线安装与许可证门槛；不自动合并 major upgrade。
6. 解析器始终运行在受限 Worker/外部进程：文件大小、解压量、页数/工作表数、内存、CPU 时间、并发和输出大小均有上限。原件只读；失败只产生结构化失败与可重处理记录。

## 9. OpenSpec 必须验证的门槛

### 9.1 依赖与架构门槛

- 建立单一 `DocumentParser` / `MonitoringBatchParser` 接口：输入为原件工件标识、格式、解析配置版本和幂等键；输出为版本化 JSON-LD、资料段、证据定位、质量结果与失败段。Mammoth/PDF.js/ExcelJS/PaddleOCR 只能在适配器内部出现。
- Zod Schema 是 DTO、API、LangGraph 状态和表单约束的 SSOT；验证 `riskRecordId | externalRiskEventId` 等联合类型不会在 AntD/RHF 层重新定义。
- Fastify、Worker 和 Web 可独立构建/启动，API 与 Worker 只复用领域包与契约，不相互经内部 REST 调用。

### 9.2 真实样例门槛

- DOCX：标题树、正文、表格、图片说明和章节证据定位可回到原件；复杂对象的排除范围明确。
- 文本 PDF：逐页文本/坐标、章节候选、表格/图注和页码定位可回放；多栏、跨页表格不能静默错序。
- 扫描 PDF/PNG/JPEG：简体中文、旋转/倾斜、表格、图注和版面顺序在甲方认可样例上达标；输出坐标可在原图叠加复核。
- XLSX/CSV：合并表头、多 sheet、日期/时区、公式缓存、空值、重复/更正/迟到采样、编码与大批量流式导入均有代表样例。
- 每种格式都验证损坏文件、伪造扩展名、压缩炸弹、超限、中止、超时、部分资料段失败和只重处理失败段。

### 9.3 性能与离线门槛

- 在 4090/128GB 单机上记录 API、Node Worker、PaddleOCR 与 llama.cpp 的 CPU/GPU/内存峰值、并发、耗时和失败恢复；制定 OCR 与 LLM 的资源隔离/排队策略。
- 监测批次验证目标规模下的流式内存上限；斜率、加速度、异常评分和频域主峰能按冻结快照确定性重放。
- 前端在 1920×1080 下验证约 45 页的共享骨架、服务端分页、可见区图表更新、Agent 停靠栏和证据抽屉；浏览器长任务、DOM 数和内存应形成基准。
- 从空白内网环境仅使用内部制品完成安装、构建、Playwright 浏览器准备、PaddleOCR 模型加载和端到端运行；抓包确认无公网请求。

### 9.4 安全、流式与验收门槛

- `@fastify/multipart >=10.1.1`，验证上传超限/中止/慢速连接后请求、流、临时文件和任务均被释放；MIME/OOXML 内部结构双重校验，不信任文件名。
- SSE 验证断线、重连、`Last-Event-ID` 重放、重复/乱序、代理超时、API 重启和权限撤销；客户端不得漏掉正式对象状态，也不得重复提交命令。
- 组件测试只验证稳定可观察行为；Playwright 至少覆盖“上传并解析样例 → 识别/评估任务进度 → 复核 → 预警处置 → 证据追溯”的可操作路径和五类全局异常/权限态。
- 输出精确依赖清单、SBOM、许可证/NOTICE、漏洞扫描、离线制品清单和恢复说明。任一未知许可证、运行时下载或未固定模型工件都会阻止发布。

## 10. 给后续决策票的输入

“确定 MVP 工程工具链与关键依赖”可以直接以如下集合为候选基线：

```text
Node 24 LTS
Fastify + @fastify/multipart + @fastify/type-provider-zod + Zod
Mammoth + parse5 + pdfjs-dist + ExcelJS(有条件) + csv-parse + fft.js(封装)
PaddleOCR 3 / PP-StructureV3（独立内网解析进程）
React + React Router Data Mode + TanStack Query
Ant Design + React Hook Form + @hookform/resolvers
Apache ECharts
原生 SSE；eventsource-parser 仅条件引入
TypeScript project references + Vite + Vitest + React Testing Library + Playwright Chromium
```

版本应在对应 OpenSpec change 创建时重新核对并固定，不能照抄当日 `latest`。其中 ExcelJS、fft.js 和 PP-StructureV3 是必须先做真实语料/资源原型再决定的三项；扫描件业务可用承诺则决定了“外部 OCR/版面解析进程”不是可省略的后续增强。
