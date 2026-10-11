## Why

当前原生 PDF/DOCX 与 Paddle 扫描通道分散，真实功能验收受本地 OCR 部署阻碍。采用 MinerU 作为主要文档转换器，使云端功能验收和本地 GPU 交付共用资料规范化、权限和证据链，同时按真实服务粒度保存定位。

## What Changes

- PDF、扫描 PDF、PNG/JPEG、DOCX 通过 MinerU；XLSX/CSV 保持原生确定性解析，修复合法 XLSX 包内绝对关系路径。
- **BREAKING**：替换 Paddle 专属配置与实现，配置显式选择官网精准 v4 API 或自托管 MinerU 4.0.12 V1 tasks，不自动切换后端。
- **BREAKING**：扫描质量契约接受页/表格整体区域、逻辑行列和合并跨度；置信度和逐单元格坐标仅在真实提供时保存。PDF 点坐标与图片像素显式区分。
- 原始响应先写受保护 C04 工件，再共用 ParsedDocument、分块、JSON-LD、C11 原子资料段与审计。新转换通过正式新资料版本重建下游输入，保留历史证据。
- 本 change 的最终验收聚焦 MinerU 转换器功能：五格式真实内容、定位、JSON-LD、质量阻断、权限和耐久契约及受影响回归。本机双路 Xeon、128GB 内存、Tesla P4 8GB 作为补充 CPU/GPU 性能基准；完整浏览器业务由 C37 验收，最终 Qwen 双卡共驻和离线制品仍由 C38 验收。
- 本机部署为可复用的固定 Docker Compose 服务，独立持久化模型/配置/日志与服务数据，默认仅监听回环；CPU/GPU 两轮使用同版本、同档位和同模型，GPU 采用专用 VLM Vulkan 加速，小模型保持 ONNX/CPU。

## Capabilities

### New Capabilities

- `platform/mineru-service-integration`：受控官网/自托管协议、资源预算、耐久证据和分层验收。

### Modified Capabilities

- `engineering-data/structured-document-conversion`：统一转换路由、可靠源结构、坐标单位和安全预检。
- `data/scanned-document-ocr`：实际证据粒度、无伪造 confidence 的质量门及独立 GPU 交付。

## Impact

覆盖 RI-S14、RI-S21–RI-S23 与 RI-S51；RA 计算、规则和历史评估不改变。依赖已归档 C04/C06/C11/C12/C13/C15，不以未归档 C37 增量作为新领域契约。当前工作区 C37 overlay 仅用于宿主接线，同步其 Paddle 引用和 C38 移交表，不接管 C37 全部业务验收。

影响 core 转换 Schema、adapters 转换与部署、scripts/deployment 装配/预置、测试、配置、运维手册及 AGENTS。复用已有 fetch/Zod/fflate/fast-xml-parser，不新增 npm 依赖、迁移或工作流状态机。新增本机服务部署与基准方案，安装/下载限于独立容器和专属模型目录；不更改共享 Python 环境，不采购 GPU、签名、提交或归档。
