## Why

RiskFlow 已能登记受权且版本化的工程资料，但尚不能把 DOCX、文本型 PDF、XLSX 或 CSV 转换为可供清洗、知识编制和风险识别使用的统一结构。C12 需要落实 RI-S2 的确定性转换与合规校验，并先建立 C13 可复用的共享转换契约，避免结构化块、坐标、失败段和 JSON-LD 出现两套定义。

## What Changes

- 新增统一结构化文档转换端口与 strict DTO：输入精确资料版本及 DOCX、文本型 PDF、XLSX、CSV 或后续 OCR 版面工件，输出转换记录、JSON-LD 工件、资料段集合和诊断工件等版本化引用；保持既有 `EngineeringDataPortV1` 签名不变。
- 新增 DOCX、文本型 PDF、XLSX 与 UTF-8 CSV 解析适配器，保留可从源文件稳定取得的章节层级、页码、表格关系、单元格或文本坐标、图注、公式及缓存值；扫描件与无可靠文本层 PDF 显式转交 C13，不得空成功。
- 新增共享规范化与合规校验：文本块不超过 512 个 Unicode 码点，按源顺序建立前后指针；统一生成含元数据、文本块、证据片段及适用表格/工法字段的 JSON-LD，并按字段、结构实体、关系与资料段逐项校验。
- 复用 C11 的资料版本、资料段标识与权限，复用 C04 保存不可变输出/诊断工件，使用 C03 幂等事务和 C07 只追加审计持久化转换结果；任何失败都记录原因及可回溯资料段，不注册部分成功集合。
- 新增真实格式样例验收，按关键结构和关键值设置稳定门槛，不断言完整 JSON、字段顺序、空白或解析库内部结构。
- 不实现 OCR/扫描图片、CAD 标注、监测时序特征、数据清洗 Agent、知识抽取或 UI；这些能力分别留给 C13、C14、C15 及后续 change。

## Capabilities

### New Capabilities

- `engineering-data/structured-document-conversion`: 规定统一转换端口、四类结构化文档解析、JSON-LD、结构/坐标保留、512 字符分块、合规校验、失败段、授权幂等和审计行为。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 新增独立 `StructuredDocumentConversionPortV1` 及其闭合命令、查询、结果和引用契约，作为 C12 与 C13 的共享接缝；既有领域端口、工程事件和工作流状态签名不变。

## Impact

- **直接依赖**：C11；同时复用其已归档的 C01～C07 契约与实现。C13 扫描 OCR 是统一转换契约的后续消费者，C15 消费 C12/C13 形成的结构化结果。
- **代码所有权**：新增 `packages/core/src/engineering-data/document-conversion/`、`packages/adapters/src/engineering-data/document-conversion/`、对应 tests/fixtures 和 `000009_structured_document_conversion.ts`；修改 `packages/contracts/src/ports/index.ts` 及其测试、C11 同所有者的窄处理读取接口、三个 package 的必要子路径导出。
- **依赖治理**：计划在主调度的独立 dependency checkpoint 中为 `packages/adapters` 精确锁定 `fflate@0.8.3`（MIT）、`fast-xml-parser@5.11.1`（MIT）、`pdfjs-dist@6.3.289`（Apache-2.0）、`exceljs@4.4.0`（MIT）和 `csv-parse@7.0.2`（MIT），同步 `config/dependency-policy.json` 与 `pnpm-lock.yaml`；离线使用内网 npm 镜像或 `pnpm fetch` store。若任一依赖出现安全问题、Node 24 不兼容、无法保持关键结构/数值或由等价平台能力替代，则退出或更换。
- **运行边界**：完整正文、JSON-LD 和诊断只存 C04 工件；数据库保存精确引用、状态、解析器/策略版本、统计与审计。C12 不发布 `engineering.inputs-ready.v1`，由 C15 在形成真实 preparation 时发布。
