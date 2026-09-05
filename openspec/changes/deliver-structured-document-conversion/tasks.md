## 1. 依赖与公共契约

- [ ] 1.1 【主调度 dependency checkpoint】在生产实现开始前精确加入 `fflate@0.8.3`、`fast-xml-parser@5.11.1`、`pdfjs-dist@6.3.289`、`exceljs@4.4.0`、`csv-parse@7.0.2`，只修改 `packages/adapters/package.json`、`pnpm-lock.yaml` 与 `config/dependency-policy.json`；记录 registry、许可证、安全审计、Node 24 兼容、离线来源和退出条件，并以 `pnpm install --lockfile-only`、`pnpm licenses:check`、`pnpm security:check` 验证。生产实现 Agent 禁止安装依赖或并发修改这三个事实源。
- [ ] 1.2 在 `packages/contracts/src/ports/index.ts` 及必要子路径导出中新增 `StructuredDocumentConversionRefV1`、闭合输入/命令/查询/结果 DTO 和 `StructuredDocumentConversionPortV1`，把新引用纳入 `ContractReferenceV1`，复用 C01/C02/C04/C11 的命令、授权、错误、工件、资料版本与资料段 Schema；以 contracts 类型检查及现有契约测试验证 strict 未知字段拒绝、五类输入联合和 ref-only 结果，禁止修改 `EngineeringDataPortV1` 既有签名或复制 DTO。
- [ ] 1.3 扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的表格驱动契约用例，验证 DOCX/文本 PDF/XLSX/CSV/OCR 输入、同键不同载荷错误边界及正文/完整 JSON-LD/URL 不能进入结果；运行该测试文件并确认断言只锁定结构化字段和稳定错误代码，不锁定完整错误文案或字段顺序。

## 2. C11 受权资料读取接缝

- [ ] 2.1 在 `packages/core/src/engineering-data/context-source/` 为 `EngineeringContextSourceRegistryV1` 增加按精确资料版本解析处理输入的窄查询，返回资料、版本、内容工件和元数据引用，并在返回前校验工程、正文处理权限和当前精确版本；扩展现有 C11 测试验证获权成功、跨工程、无正文权限和陈旧版本，禁止向 C12 暴露仓储、SQL 或通用查询器。
- [ ] 2.2 在 C11 PostgreSQL 适配器实现同一窄查询并接入现有授权/错误映射；运行对应 adapter 集成测试，证明权限失败发生在 C04 内容读取前且查询不复制资料正文。

## 3. 规范化、分块与 JSON-LD 核心

- [ ] 3.1 在 `packages/core/src/engineering-data/document-conversion/` 实现 strict 规范化块、结构实体/关系、坐标、资料段草稿、转换统计和合规结果 Schema，复用 C11 定位联合且不新增开放字段袋；运行 core 类型检查和模块测试验证非法实体、关系、悬空引用、跨版本指针及远程 `@context` 被拒绝。
- [ ] 3.2 实现按 Unicode 码点计数的确定性分块与相邻前后指针，优先结构/稳定文本边界并仅对超长单片段硬切；用一个参数化 core 测试覆盖 BMP、代理对、边界 512、超长段落和多块，验证每块 ≤512、拼接无丢失/重复、标识和指针可重放。
- [ ] 3.3 实现受控本地 JSON-LD 构造及字段/实体/关系/资料段全量合规校验，只在全部通过时产出完整资料段集合；扩展同一 core 测试验证必需元数据、文本块、证据片段、可选表格/工法字段以及单段失败导致整批拒绝，禁止推断风险知识或产生部分成功。

## 4. 四类格式适配器

- [ ] 4.1 在 `packages/adapters/src/engineering-data/document-conversion/` 实现受资源策略约束的 DOCX OOXML 解析，保留标题/段落/表格/图注顺序与显式分页，拒绝 DTD、外部实体、损坏关系、加密包和 ZIP 超限；以真实 DOCX fixture 验证关键标题、表格值、图注和可证明页码，禁止锁定完整 XML/JSON 或解析库内部顺序。
- [ ] 4.2 实现文本型 PDF 解析，保留页码、文本顺序与坐标；以真实文本 PDF fixture 验证跨页关键文本和坐标，以扫描/空文本层 fixture 验证返回 C13 路由诊断且不生成空成功，并验证页数/文本项上限。
- [ ] 4.3 实现 XLSX 与 UTF-8 CSV 解析，保留工作表、单元格/行列坐标、合并区域、公式及缓存值和引用/多行字段语义；以真实 XLSX/CSV fixtures 验证关键值、公式与缓存值可区分、BOM/引用/空值/多行字段，并验证非 UTF-8、表格规模超限和宏/公式不执行。

## 5. 编排、持久化与审计

- [ ] 5.1 实现 `StructuredDocumentConversionPortV1.convert` 的固定顺序：C11 授权解析 → C04 `open` 并校验读取完整性 → 格式解析 → core 规范化/分块/合规 → C04 幂等输出或诊断 → C11 整批资料段登记 → C03 转换终态与 C07 审计；用服务测试验证任一步失败不登记部分资料段、日志不含正文、无可靠文本 PDF 只产生诊断，禁止创建 C07 不存在的复核类型或发布 `engineering.inputs-ready.v1`。
- [ ] 5.2 新增 `packages/adapters/src/postgres/migrations/engineering-data/deliver-structured-document-conversion/000009_structured_document_conversion.ts` 及迁移注册，创建只追加 `structured_document_conversions` 表和状态/输入种类/唯一幂等约束，仅保存精确引用、冻结版本、统计与审计字段；运行迁移测试与 schema 检查，确认不存资料正文、完整 JSON-LD 或诊断详情，并在合并前核对 `000009` 未被其他 change 占用。
- [ ] 5.3 实现 PostgreSQL 转换存储及 `read` 查询、事务回执和审计映射；用 adapter 集成测试验证成功/失败终态、同载荷重试返回原引用、同键异载荷冲突、第五步成功第六步暂时失败后的幂等恢复，以及 read 的跨工程/无权拒绝。

## 6. 真实样例验收与导出边界

- [ ] 6.1 在 adapters 测试 fixtures 中加入最小真实 DOCX、文本 PDF、XLSX、CSV 与必要恶意/失败样例，登记来源与可再生成方式；运行单一表格驱动验收测试验证四类格式的关键结构、关键值、坐标、≤512 码点、双向指针和 JSON-LD 合规，禁止大段 snapshot、完整文案、空白和字段顺序断言。
- [ ] 6.2 更新 `packages/core`、`packages/adapters` 和必要根导出，运行 `pnpm typecheck`、相关 contracts/core/adapters 测试、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm licenses:check`、`pnpm security:check` 与 `pnpm openspec:validate`；确认 C12 未修改 apps、C13/C14/C15 实现、`EngineeringDataPortV1` 既有签名或迁移 `000010`/`000011`，并记录任何无法执行的验证及原因。

## 7. 规格一致性验收

- [ ] 7.1 按 `engineering-data/structured-document-conversion` 和 `domain/module-interfaces-events-workflows` 两份 delta 逐项核对实现，确认 RI-S21～RI-S23、权限、幂等、失败资料段、资源限制、审计、C13 共享接缝和 C15 事件边界均有代码与稳定行为证据；运行 `openspec validate deliver-structured-document-conversion --strict --no-interactive` 和 OpenSpec verify，未解决差异不得勾选完成。
