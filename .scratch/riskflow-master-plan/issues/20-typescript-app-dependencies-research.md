Type: research
Status: resolved
Blocked by: 13, 14, 18

# 核实 TypeScript 文档解析与前端工程依赖

## Question

基于官方文档、源代码与许可证，哪些 Node.js/TypeScript 组件适合 MVP 的 Word/PDF/表格/监测数据解析、React 应用框架、表单与表格、图表与关系图、流式事件、测试与构建；哪些能力需要外部进程或后续阶段，如何避免引入维护停滞、许可证不合适或无法内网部署的依赖？

## Answer

MVP 采用 Node 24 LTS 与有界格式适配器：Mammoth + parse5 处理 DOCX，PDF.js 处理文本型 PDF，ExcelJS（有条件）与 csv-parse 处理 XLSX/CSV，fft.js 隔离在频域特征接口后。第三方解析对象不得进入领域层；所有适配器统一输出版本化 JSON-LD、资料段、结构坐标、证据定位、质量结果和失败段。

扫描 PDF/PNG/JPEG 的“业务可用”承诺需要 OCR、版面和表格恢复，默认候选为独立内网 PP-StructureV3 进程；纯 Node 的 Tesseract.js 不足以单独满足该契约。OCR 模型许可证、中文工程样例质量，以及与 llama.cpp 共享 4090 的资源隔离均须在 OpenSpec 原型中验证。

应用候选基线为 Fastify + Zod、React + Vite SPA + React Router Data Mode + TanStack Query、Ant Design + React Hook Form、Apache ECharts、原生 SSE，以及 `tsc -b` + Vitest + React Testing Library + Playwright Chromium。WebSocket、Next.js、Cytoscape.js、专用数据网格和第二套构建/测试工具均延后到出现已量化需求时再评估。

依赖必须经适配器边界隔离，并在 OpenSpec 中固定精确版本、用途、许可证、哈希和退出条件；联网构建区镜像 npm、PDF.js、OCR 模型与 Playwright 浏览器制品，内网运行禁止下载，精确锁文件须生成 SBOM 并核对传递许可证。ExcelJS 与 fft.js 因维护节奏必须带真实样例、数值交叉验证和可替换门槛。

完整能力、许可证、候选版本、延后项和验收门槛见：[TypeScript 文档解析与前端工程依赖核查](../research/20-typescript-app-dependencies-research.md)。
