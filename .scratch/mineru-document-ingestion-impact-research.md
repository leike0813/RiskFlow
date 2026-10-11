# MinerU 作为文档入库主转换器的设计影响调研

核查日期：2026-10-11。范围：RiskFlow 当前工作区、已归档 C12/C13/C15/C11 规格与当前 C37。用户已明确交付版使用本机部署的 MinerU 服务；本报告只形成研究结论和建议，不批准或实施契约变更。

## 结论与推荐边界

可采用自托管 MinerU 作为 PDF、扫描件、图片及 DOCX 的主要文档解析服务，复用 RiskFlow 的统一转换入口、JSON-LD、资料段、授权、工件和审计。不能把工作量理解为替换一个 OCR URL：主要转换器覆盖文本型输入，现有可注入解析口却只支持 `ocr-layout` 分支，必须补齐解析接缝和服务配置。

推荐第一步保留 XLSX/CSV 的确定性结构解析，作为显式的格式路由，以保证工程数值、原始行列、公式与缓存值。这不妨碍 MinerU 成为非结构化文档的主转换器。若要求全部支持格式都经 MinerU，需额外从原始 Office/CSV 工件补齐证据元数据；应只补缺失事实，避免维护两套完整文档正文。

扫描表格单元格几何与 OCR 置信度是待闭合设计项。当前 MinerU 公开结构化输出不足以直接满足原扫描规格；不能用表格整体框冒充每个单元格框，不能给缺失置信度填 1。需要真实输出验证后选择补充可信证据，或显式修改定位粒度和质量策略，并说明对工程验收的影响。

交付版自托管，不依赖 MinerU 云端。当前功能阶段仍可通过内网访问真实 MinerU 服务；运行在同一宿主时可用回环地址。最终离线介质、资源分配和实机性能继续归 C38，当前功能验收无需先准备 4090。

## 一手资料与版本口径

GitHub 最新正式 release 为 **4.0.12**，发布于 2026-10-11。本报告直接读取该 tag 下官方文档与源码；这是研究基线，不代表项目已批准依赖版本。DocVortex `v0.5.16` 对应 commit `fb59f89dcb4f76dd1adbb3c84bd8dfd51a982c16`，与本次读取其 main 时的 tree SHA 一致。MinerU pyproject 声明 `docvortex>=0.5.16,<1`，部署时仍应精确冻结解析依赖，不能把版本区间当精确发布身份。[release](https://github.com/opendatalab/MinerU/releases/tag/mineru-4.0.12-released)、[pyproject](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/pyproject.toml)、[DocVortex tag](https://github.com/myhloli/DocVortex/tree/v0.5.16)

官方 3.x 文档、当前 4.x、MinerU-Ecosystem 云 CLI 与第三方 API 包不能混用。本机安装的 MinerU skill 描述的是云 CLI，不是 RiskFlow 自托管集成契约；其“零幻觉”宣传不作为工程质量保证。本次没有执行云端转换或上传项目样例。

### 本地 API

- 入口为 `mineru-kit api-server`。4.0.12 提供 `POST /v1/file_parse` 同步包装和 `POST /v1/tasks` 异步任务；根路径旧 `/file_parse` 不提供。
- 支持 multipart、原始字节及 V1 JSON 来源；RiskFlow 应固定用 C04 读取的受权字节上传，不接受业务输入指定任意 URL、模型路径或服务文件路径。
- 同步等待默认 300 秒，可配置 1–3600 秒，未完成返回 HTTP 202 和任务引用，任务继续执行。HTTP 超时、取消请求并不等于服务端任务已取消。
- 异步查询 `GET /v1/tasks/{task_id}`，结果 `GET /v1/tasks/{task_id}/result`，取消 `DELETE /v1/tasks/{task_id}`。终态包括 `completed/partial/failed/canceled`；HTTP 200 和 `partial` 不能直接映射为 RiskFlow 转换成功。
- 本地 API 输出 `markdown/middle_json/structured_content/zip`。优先消费 `middle_json` JSON，Markdown 仅作为展示或辅助工件。若因模型原始输出/图片证据需要 ZIP，须有界解包并校验路径、成员、大小和关联身份。
- 配置 `--api-key` 时业务请求使用 Bearer；匿名回环访问可省略。服务返回的 URL 应限制在批准同源，不自由跟随外网重定向或把凭据发送到其他源。
- 上传单文件上限 200 MiB、每任务最多 100 文件是服务上限，RiskFlow 的批准资源策略可以更小。建议一个转换身份只提交一个源工件，保持逐资料原子收口。

来源：[固定版本 HTTP API 文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/http_api.md)、[task API 源码](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/mineru/parser/task_api.py)

### 输出协议与支持格式

当前 `middle_json` 使用 `schema="docvortex.middle"`、`schema_version="2.0"`；实际 MinerU 版本在 `metadata.producer.version`，档位及最终解析模式在 `extensions.mineru`。页索引 `page_idx` 从 0 起，块 `index` 严格有序。PDF 几何通过 `extensions.docvortex_layout.pages` 提供源页号及 `width_pt/height_pt`；块 bbox 为 0–1 归一化坐标。旧 `_backend/pdf_info/_version_name` 不是当前协议。[输出文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/reference/output_files.md)、[DocVortex Schema 类型](https://github.com/myhloli/DocVortex/blob/v0.5.16/src/docvortex/schema.py)

自托管支持 Office 和 CSV/TSV：这些格式固定走本地 Flash，整本解析；PDF/图片可选 Flash、Basic、Standard、Advanced。支持更多格式不等于 RiskFlow 本轮自动开放 DOC/PPT/HTML/OFD 等新输入类型。[档位文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/tiers.md)、[Office 分派](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/mineru/backend/analysis/office.py)

## 与 RiskFlow 现有契约的差异

| 事项 | 已核实事实 | 对设计的影响 |
| --- | --- | --- |
| 统一入库结果 | C12 返回转换、JSON-LD 和资料段集合精确引用，不返回解析器正文 | 复用公共结果和核心规范化，MinerU 原始协议留在 adapters |
| 可注入解析口 | `#parseDocument` 只有 `ocr-layout` 分支消费 `OcrLayoutParserV1`；其它格式调用本地 parsers | 仅新增 MinerU OCR adapter 不能实现“主要转换器”；需统一的内部解析接缝和明确格式路由 |
| PDF 定位 | MinerU 为 0 基页号、0–1 bbox、PDF point 页面尺寸；RiskFlow OCR 页面固定 `pixel-top-left` | 一基页号、页面旋转及坐标系须确定转换；可冻结 DPI 形成可证明的像素映射，或修改共享坐标契约。不能把 point 当 pixel |
| 文档类别 | MinerU 还包含公式、列表、页眉页脚、代码、索引、图片等；RiskFlow 只有闭合规范化块类型 | 明确类别映射和无正文/图片处理；不得静默丢弃工程正文或把生成内容当源事实 |
| 分块 | RiskFlow 由核心模块按结构确定性生成最多 512 Unicode 码点的文本块及前后指针 | 继续复用核心分块，不采用第三方默认 RAG chunk 作为第二事实源 |
| 扫描表格 | DocVortex `TableBodyBlock.content` 为 HTML；公开 Middle Schema 有表格 bbox，没有标准逐单元格像素 bbox | HTML 可恢复逻辑行列和 span，不能证明每个单元格的原页几何；补证据或变更定位要求 |
| OCR 置信度 | 当前公开 Middle Schema 没有统一文字 `confidence/score` 字段 | 原 `minimumMeanServiceConfidence` 等质量门不能原样保留；可用原始模型证据时需确认分数含义，版面检测分数不能代替文字置信度 |
| XLSX | 原生转换 `load_workbook(data_only=True)`，表格 HTML 主要输出值和 rowspan/colspan；内部源行列未在该 HTML 中标准输出 | 不能证明原始地址、公式与缓存值完整保留；隐藏表、空白区域和表格检测也会改变数据覆盖 |
| DOCX | 原生解析可输出结构，但“支持 DOCX”不证明其保留现有规格的显式分页、原段落次序和定位 | 用当前合成 DOCX 逐项验证；不能把逻辑页面误记为物理页，必要时只补原始结构元数据 |
| 重放 | 模型参与转换不保证重新推理字节一致 | 原始响应耐久保存后做确定性映射重放；实际再推理记录新结果身份，不承诺同权重必然同正文 |

源代码证据：[Middle JSON Schema](https://github.com/myhloli/DocVortex/blob/v0.5.16/schemas/middle-2.0.json)、[XLSX 读取实现](https://github.com/myhloli/DocVortex/blob/v0.5.16/src/docvortex/analyzers/native/office/xlsx/xlsx_converter.py)、[表格 HTML 输出](https://github.com/myhloli/DocVortex/blob/v0.5.16/src/docvortex/analyzers/native/office/spreadsheet/html.py)、[工作表投影](https://github.com/myhloli/DocVortex/blob/v0.5.16/src/docvortex/analyzers/native/office/spreadsheet/projector.py)

本地事实源：`openspec/specs/engineering-data/structured-document-conversion/spec.md`、`openspec/specs/data/scanned-document-ocr/spec.md`；`packages/core/src/engineering-data/document-conversion/{schema,service}.ts`；`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:619`。

扫描契约中的文字置信度和单元格坐标是现有验收要求，不因 core Schema 部分字段可选而自动变成可省略。MinerU 未提供某项证据时，应明确“未提供/不可验证”，由批准的质量策略决定是否阻断。

## 运行、持久化和故障恢复

官方明确：文件字节可保存在 upload-dir，但上传、文件和任务索引在进程内；重启后旧 ID 不保证可用。4.0.12 默认 24 小时回收过期资源，可配置保留期。这意味着服务端任务不是 RiskFlow 的耐久工作流，服务文件 ID 也不能代替 C04 工件引用。[HTTP 生产说明](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/http_api.md)、[4.0.12 release](https://github.com/opendatalab/MinerU/releases/tag/mineru-4.0.12-released)

推荐部署边界：

```text
浏览器 → RiskFlow API/Worker → C04 受权读取原始工件
                              ↓
                     本机/内网 MinerU V1 API
                              ↓
              原始响应与素材 C04 耐久保存、版本绑定
                              ↓
             确定性规范化 → 质量/合规校验 → JSON-LD
                              ↓
             C11 资料段登记 → C15 清洗 → 知识/识别
```

由现有转换/工作流拥有业务身份和终态，不新增替代 LangGraph 的流程状态机。异步采用现有持久化基础保存转换 attempt 与服务任务关联，还是在一个有界 attempt 内完成同步包装及 202 轮询，须在 design 中明确；不能假设当前转换器已经具有耐久 MinerU 任务恢复。服务重启丢失 ID 后只能按原输入和预算形成可追踪重试，防止重复资料段登记。

权限在联系服务前校验。原始响应、图片和诊断继承源资料权限；HTML/图片引用作为不可信数据处理，不运行脚本、加载外部资源或执行公式。RiskFlow 浏览器继续访问自己的 API，不直接上传到 MinerU；既有证据页面通过统一资料段定位消费结果。

## 历史资料与当前合成验收

**不能只换新的 conversionId 对已成功资料原地重跑。** C11 adapter 在 `postgres-engineering-context-source-registry.ts:3032` 按工程和 `source_version_id` 查询已有集合，存在即阻断；迁移 `000008_engineering_context_source_registry.ts:408` 有对应唯一约束。资料段 ID 又以资料、章节、段身份组成，当前没有并存解析代际的公共契约。

最小功能验收路径是通过正式来源登记形成新的资料版本身份，复用获授权原始工件，建立 MinerU 专属输入清单和回执；具体 sourceId、版本链和授权由正式 C11 结果决定，不构造假 ID。若要求同一精确资料版本保留多套转换/资料段并切换当前结果，则涉及 C11/C12 公共契约、数据库迁移和下游引用，须另作明确设计。

当前 22 份 DOCX/CSV 成功转换仍是原转换器的历史证据，不能改标签计入 MinerU 验收；需要重新验证采用 MinerU 的那些输入。2 份中文文本 PDF 和 2 份 XLSX 的解析缺陷也不会因引入 MinerU 自动消失：PDF 可转为验证新路径；若保留原生 XLSX 路由，原 OOXML 内部关系缺陷仍需修复。扫描 PDF/PNG/JPEG 尚未有真实服务证据。

重新转换改变正文、标题、资料段或表格结构后，需重新冻结 C15 准备、知识编制和检索投影输入，重跑相应检索质量测试。已发布历史知识与评估结果保留原引用，不能原地改写。确定性评分、矩阵和预警规则本身不需要因更换解析器重写。

## 预计变更面

以下为调查后的拟议文件范围，尚未修改规格或实现。

| 层级 | 文件或目录 | 预计动作 |
| --- | --- | --- |
| OpenSpec | C37 proposal/design/implementation-plan/tasks；新增 delta `engineering-data/structured-document-conversion`、`data/scanned-document-ocr`、必要的 C15 清洗规格；现有部署 delta | 闭合主转换路由、服务身份、结构协议、质量指标缺失、恢复与资源边界；写 IP-ID 和验证映射 |
| 核心契约 | `packages/core/src/engineering-data/document-conversion/schema.ts`；必要时 contracts 及 context-source | 优先保持公开 DTO；仅在坐标、置信度证据或解析代际决定需要时修改 SSOT |
| 转换 adapter | `packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts`、parsers、拟新增 mineru 协议/配置/映射实现 | 提供支持批准格式的内部解析接缝；复用工件、规范化、事务、审计和失败收口 |
| 当前 Paddle 实现 | `.../document-conversion/ocr/*` 与 adapters 导出、package exports | 批准替换后删除无调用实现或缩减为实际保留能力；避免永久双实现和自动服务回退 |
| 部署 | `packages/adapters/src/deployment/schema.ts`、`scripts/deployment/start.mjs`、`provision.mjs`、运行/发布/健康检查脚本、`deployment/*.json` 和说明 | 移除生产配置对 Paddle strict Schema 的绑定；注入 MinerU 地址、受限秘密、协议、档位、模型/依赖版本、资源与请求预算 |
| 服务制品 | MinerU 独立 Python 服务的镜像/配置/离线模型清单 | 精确锁定服务和依赖，不将 Python OCR 栈装入 Node 应用；依赖理由、版本和移除条件进入设计；安装仍须授权 |
| 测试 | 现有 conversion/core/cleaning 测试、OCR protocol/smoke、deployment/provision、synthetic/functional | 调整协议替身并增加关键回归边界，复用稳定结果测试；真实服务另外取证 |
| 验收 | `references/acceptance/synthetic-v1` 的输入清单/报告、`deployment/ACCEPTANCE.md` | 保留合成标记；按实际新回执生成结果证据，不修改预期样例来迁就解析错误 |
| 下游 | C15/C17/检索/文档与证据 UI | 保持共享 JSON-LD/资料段契约时预计复用；需重验输入冻结、索引重建和追溯，不据此直接宣告无需修改 |

当前 C37 的 D-23 装配仍指向 `createPaddleOcrLayoutParser`，部署配置的 `documentConversion.ocr` 直接使用 `PaddleOcrLayoutConfigV1Schema`。这是已批准设计的改动，应先在 C37 补齐规格和施工图，不能作为启动脚本的一次 URL 修正。归档主规格保持不变，后续按批准 change 同步。

## 本机服务、资源与离线交付

Basic 可用 CPU/ONNX，不需要 VLM；Standard/Advanced 需小模型与 VLM，后两档共用模型但计算投入不同。Office/CSV 为原生 Flash。可在当前功能环境以 CPU Basic 或已部署的内网 Standard 实测，不把 Flash 预览质量当正式扫描质量，也不以档位名称代替样例验收。[档位与资源](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/tiers.md)

离线应在构建环境下载并验证批准模型，目标配置使用 `MINERU_MODEL_SOURCE=local`；缺模型明确失败，不运行时补下载。固定 small_backend、VLM engine、档位和模型，避免自动设备选择导致发布环境改变。Standard 的本地 VLM 与业务 MiniMax 推理是两条独立链路，当前提供的 MiniMax key 不构成 MinerU VLM 兼容或离线能力证明。LLM 辅助后处理另有配置，默认关闭；不能未经设计把其接到现有业务推理 API。[模型源与三类连接](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/model_source.md)

健康读取 `/v1/health` 的服务版本和输出/来源能力，并通过 `/v1/tiers` 核对可用档位；`/v1/models` 的虚拟模型名不证明实际权重集合。健康响应不能代替真实中文扫描 smoke。最终吞吐、峰值内存/显存、取消/饱和隔离和与业务 LLM 共享硬件的影响在 C38 实测，不提前承诺。[API 实现](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/mineru/parser/api_server.py)

## 许可证对交付的实质影响

4.0.12 不是纯 Apache-2.0，而是 Apache-2.0 加 MinerU 附加条款：使用方及关联方按合并口径，月活超过 1 亿或月总收入超过 2000 万美元时，继续使用前须取得单独商业许可；向第三方提供基于 MinerU 的在线服务还有显著标识义务。相关违约可导致许可自动终止。[固定版本许可原文](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/LICENSE.md)

RiskFlow 的甲乙方均涉及企业主体，不能以“本机部署”“只有少量用户”推定不触发收入门槛。正式依赖冻结前，应按实际使用方及关联范围确认许可；本报告不判定哪个主体已触发门槛。代码、DocVortex 依赖、各 OCR/版面/表格模型和 VLM 权重的许可证须分别纳入交付清单，不把服务代码许可当全部模型许可。

## 最小必要验证与待决事项

协议测试覆盖批准 V1 请求、202/终态、超时取消、任务丢失、鉴权、返回字段不合法、受限下载、原始响应与工件失败，以及原预算重试。业务测试复用 JSON-LD/schema、页完整性、坐标、阅读顺序、表格 rowspan/colspan、关键数值单位、资料段原子登记、幂等和历史引用；不精确断言完整 OCR 正文。

真实服务使用 synthetic-v1 中文文本 PDF、扫描 PDF、PNG、JPEG、DOCX；若走 MinerU XLSX/CSV 再加公式/缓存、偏移行列、空值、隐藏表、合并区域和引号多行等代表样例。提供预先标注的页/字段/单元格真值，不能用 MinerU 输出自己充当标准答案。测试报告区分结构合规、识别质量、端到端追溯和运行资源结果。

实施前须闭合：

1. 实际可提供服务的 MinerU 版本、V1 OpenAPI、可用档位及精确模型/依赖版本；4.0.12 是候选，不自动升级现有服务。
2. 主转换器的格式路由；是否保留原生 XLSX/CSV，DOCX 元数据是否需要补取。
3. 单元格页内几何与文字置信度缺失的处理；保留原要求时如何取得真实证据，或经批准修改质量/定位契约。
4. PDF point/归一化坐标与当前 pixel-top-left 的明确映射。
5. 按正式来源新版本重验，还是引入同一资料版本多解析代际；后者范围明显更大。
6. 企业商业许可门槛和模型再分发条款。

本轮验证仅为固定版本官方源码/文档和本地调用链核查；未安装依赖、下载模型、启动 MinerU、上传样例或运行性能测试。没有修改 OpenSpec、业务代码、已有证据或任何任务勾选。
