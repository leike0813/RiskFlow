# RiskFlow 当前功能验收

C37 使用真实 API、Worker、PostgreSQL、Qdrant、工件存储和获批准的推理服务，验收识别、复核、评估、预警、处置、执行反馈及审计追溯。当前样本为 `references/acceptance/synthetic-v1`，标记为“合成样本，待甲方复核”。报告只证明功能，不证明真实工程准确率。

## 当前接入

聊天使用中国区 MiniMax M Plan：`https://api.minimax.cn/v1`、`MiniMax-M3.1-Flash-Preview`。部署显式选择 `schema-prompt` 和 `reasoningEffort=low`，由调用方的同一 Zod Schema 生成 JSON Schema 提示，再严格验证完整输出。非法 JSON、额外字段、截断或验证失败均拒绝，不修补、不重试生成。当前服务不声明服务端 strict JSON Schema 能力。

Embedding 使用 `http://192.168.13.11:11434` 的 `qwen3-embedding:4b`，原生 `/api/embed`、`truncate=false`，无需密钥。启动核验 Ollama 0.40.0、模型摘要、40960 上下文和 2560 维。模型身份变化必须新建部署及检索代际。

[model-gateway-config.example.json](model-gateway-config.example.json) 展示两项部署结构。引用名和预算是配置示例；实际运行必须固定本次批准配置，不能把示例当作协议资格或业务版本的证据。MiniMax 的 1M 上下文及供应商 512Ki 输出上限不等于单项 RiskFlow 任务预算。密钥只经服务端受限文件加载，不能放入公开 JSON、浏览器或命令参数。

## 运行前置

1. 检查合成包：`pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1`。
2. 完成显式初始化及迁移，准备真实授权工程、空间、原始资料及元信息工件。正式资料登记消费已存在的工件；当前 HTTP 没有上传/转换入口，不能把登记回执当作资料已完成转换。
3. 按原 Schema 导入并审核业务定义及运行策略。模型只接收有资格的资料正文，`expected.json`、场景标签和验收报告不得作为模型输入。
4. 为 PDF、扫描 PDF、PNG/JPEG 与 DOCX 提供 MinerU 官网精准 v4 配置和专用 token；MiniMax key 不能用于 MinerU。XLSX/CSV 使用原生解析。官网实际 ZIP 必须核验后冻结消费字段，未知结构严格拒绝。
5. 装配完整生产 provider 后启动 API、独立 Worker 与同源 HTTPS Web。依赖缺失或策略漂移时不得声明就绪。

`scripts/deployment/start.mjs` 已包含资料预置所需的基础宿主与迁移检查，API/Worker 的完整业务装配仍在补齐。基础宿主使用 `RISKFLOW_RELEASE_MANIFEST` 指定的发布清单核对发布及迁移身份，不能作为生产就绪证据。这些前置完成后才进入完整浏览器验收。

## 证据与命令

| 证据 | 命令或入口 | 能证明什么 |
| --- | --- | --- |
| 材料静态检查 | `pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1` | 材料契约、文件和引用完整性 |
| 模型协议测试 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts` | 映射、校验、预算和失败边界 |
| 真实模型 adapter smoke | `RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts` | 真实结构化生成、Embedding、会话流及 C04 响应证据；不等于生产业务验收 |
| 正式业务终态 | `node scripts/acceptance/functional.mjs --pack references/acceptance/synthetic-v1 --config <functional-config.json> --output <新证据目录> [--resume]` | 同次运行的正式只读终态和必需引用；等待人审、超时或缺引用不能 PASS |
| 可见浏览器 | 当前桌面 Chrome，连接上述生产 HTTPS | 登录、业务页面、正式人工确认、权限、重试与跨页追溯的实际行为 |

网络 smoke 的公开配置路径使用 `RISKFLOW_MODEL_GATEWAY_CONFIG`，受限秘密定位文件使用 `RISKFLOW_MODEL_GATEWAY_SECRETS`。报告保存部署、模型、配置、正式对象、审计及 C04 引用和命令，不记录密码、Cookie、密钥、正文或模型内部思考。模型 smoke 使用隔离测试存储时必须明确这一边界。

可用 `RISKFLOW_NETWORK_API_SMOKE_REPORT=<新报告路径>` 将真实 smoke 报告写入新文件，已有文件不会覆盖。2026-10-11 的三能力检查已通过：结构化生成 303 token、Embedding 29 输入 token／2560 维、会话流 26 个增量／288 token。该次使用隔离 PostgreSQL/C04 测试存储，未验证生产授权；报告中的测试工件引用不作为生产业务追溯证据。

2026-10-11 的隔离功能实例已完成 000056 初始化、checkpointer setup、职责角色登录及初始化重放；通过正式 C06/C11/C04 入口登记工程、空间、适用性快照，并完成 10 份 DOCX 与 12 份 CSV 的来源登记和转换。第一份 DOCX 的 JSON-LD 已完整读取、核验 `verified` 并通过原 Schema，共 3 个资料段。证据暂存于 `/tmp/riskflow-functional-runtime-OuUmoX/`：`initialization-report.json`、`initialization-replay-report.json`、`role-login-report.json`、`context-exact-receipts.json`、`non-ocr-material-preparation.json`、`docx-preparation-evidence.json`。这些临时证据需在正式收口时保存到交付证据目录。

上述旧 DOCX/PDF 准备证据来自原转换器，不能改标签作为 MinerU PASS。采用 MinerU 的资料通过正式新资料版本重新准备，并重建清洗、知识和检索输入。已用环境中的 MinerU token 取得五类官网探针结果包：官网布局为 3.4.4，独立于自托管 4.0.12 的 Middle 2.0；探针仅证明协议和字段，尚不能代替生产 C04/资料段/质量与完整业务验收。完整策略及 API/Worker 装配的完成情况由 C37 独立核验，资料准备不能计为浏览器业务验收通过。

2026-10-11 的 MinerU parser smoke 使用真实官网API和隔离受限文件存储回读：文本PDF、PNG、JPEG、DOCX通过转换检查。以最终代码回读真实响应并经共享JSON-LD/资料段生成与合规校验，分别得到22、4、5、3个资料段；回读证据目录为 `/tmp/riskflow-mineru-final-replay-8VLkFA`（临时隔离存储，非发布工件）。扫描PDF返回13页，只有10页有正文，按非空页比例1的策略拒绝。核对原件可见被遗漏页面有正文，不能剔除页面或降低门槛来标记通过。本次示例配置的关键字段清单为空，不计作完整内容质量验收；服务原始证据和规范化结果分别保存在权限受限的临时目录，尚无生产资料版本/数据库登记引用。

同日按原配置重试扫描 PDF，新批次仍返回 13 页、10 页有正文，第 2、3、9 页的 `para_blocks` 无文本；两次 `layout.json` 内容完全一致，重试证据为 `/tmp/riskflow-mineru-smoke-VNnk0C`。第 3、9 页的 `preproc_blocks` 有文字，`para_blocks` 带 `lines_deleted`，相邻前页含 `cross_page` 文本；应区分跨页合并与实际漏识别，不能把空正文页统一解释为物理缺页。官方 CLI 使用同一 VLM/OCR 单独请求第 2 页也未得到 Markdown。进一步无重采样提取第 2 页内嵌原图，以同一生产 parser 和端点独立转换：返回标题但未识别图中可见的 `SYN-DEV-SEG-001-GEO`、`SYN-DEV-SEG-002-GEO` 资料行，原始 Markdown 也缺失这两行。原图及响应分别保存在 `/tmp/riskflow-mineru-image-retry-syMgom`、`/tmp/riskflow-mineru-smoke-tKlDs4`。该图片因关键字段清单为空而通过非空检查，不计完整内容验收；扫描 PDF 仍未通过，质量门槛保持不变。

进一步检查发现合成生成器 `_text_page` 将 `insert_textbox()` 的正返回值误判为溢出；[PyMuPDF 官方说明](https://pymupdf.readthedocs.io/en/latest/shape.html#Shape.insert_textbox)明确非负值表示成功及剩余空间，负值才表示放不下。本地短行实测返回 `28.98046875` 且文本已写入，旧生成器因而把 12 条记录排成 13 页并重复写行。未覆盖旧样本，仅用相同内容、字体、150 DPI 和服务参数生成正常分页的临时一页对照件 `/tmp/riskflow-mineru-pagination-probe-i1d0l8tb/geology-report-correct-pagination.pdf`。其真实响应 `/tmp/riskflow-mineru-smoke-fX6tjI` 中的 13 个 `interline_equation` 块覆盖表头和 12 条记录，去空白后的原始公式文本包含全部 12 个资料段 ID；当前官网映射未覆盖该块类型，返回 `MINERU_PROTOCOL_INVALID`。关闭公式识别的独立 CLI 对照仍返回 LaTeX，不能作为修复结论。后续须分别修正样例生成、补齐实际输出映射、验证原页定位及关键字段，不能以该临时对照替代原件验收或声明生产通过。

真实检查命令为 `MINERU_REAL_SMOKE=1 pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts`；通过 `MINERU_SMOKE_CONFIG`、`MINERU_SMOKE_INPUT`、`MINERU_SMOKE_MEDIA_TYPE`、`MINERU_SMOKE_INPUT_KIND` 显式选择配置和资料。token从环境中的 `MINERU_TOKEN` 读取，不写入命令参数。默认测试跳过真实调用，skip不计外部验收通过。

分页和官网原页映射修复后，五格式源字段验收命令为：

```sh
MINERU_REAL_SMOKE=1 MINERU_SMOKE_SUITE=references/acceptance/mineru-v2/manifest.json pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts
```

2026-10-11 此命令5/5通过。清单版本2只从已有场景与源模板产生预期；文本PDF和扫描PDF采用新投影，PNG/JPEG/DOCX仍使用未改变的V1文件。每项冻结非空页比例1、关键字段覆盖率1及独立质量策略引用；记录关联与原页校验、共享JSON-LD合规完成后才记录completed。文本PDF、扫描PDF、PNG、JPEG、DOCX分别得到8/15/4/5/3段，记录检查分别6/12/2/3/2条。官网公式以原始LaTeX保留，去空白比较仅用于验收，不改写正文。原始响应与结果仍在受限临时目录，汇总见 [新投影验收报告](../references/acceptance/mineru-v2/acceptance-report.json)。

补充同源试运行扫描件的5页/60条记录真实检查，127个关键字段、全部记录关联及原页定位通过，共72段、JSON-LD合规；受限证据 `/tmp/riskflow-mineru-smoke-Lp9925`，诊断清单 `/tmp/riskflow-mineru-trial-suite-rsaiw7y3/manifest.json`。旧扫描样例响应使用最终映射重放为12/13非空页，仍缺SEG-002-GEO，被质量门拒绝。上述证据证明隔离parser和JSON-LD功能；不代表生产C04/C11登记、完整业务终态、可见浏览器或本地硬件验收完成。

终态观察目前支持 Agent 任务详情、识别运行详情和运行总览投影三种正式结果。观察必须与同次提交的精确任务或运行引用匹配，并取得必需的正式结果引用；其他查询 DTO、零结果缺少所需引用、人工等待和超时均保留 BLOCKED。配置示例见 [functional-run-config.example.json](functional-run-config.example.json)。

可见浏览器必须打开在用户正在观看的桌面会话中。无界面模式和虚拟 X 屏幕不能替代观看要求；浏览器可以通过 CDP 操作，但业务请求仍走原 HTTPS/会话/确认契约。

`pnpm test:browser` 的工程 harness 测试保留为回归证据，完整样例验收需另有上述生产宿主、网络推理和正式业务结果。现有 `deployment:smoke`、`deployment:benchmark` 只校验配置，不能计作场景或性能通过。

## 最终交付

签名、多平台正式安装包、禁网三 VM、本地模型/MinerU 介质与许可、4090/128GB 加辅助 NVIDIA GPU 的实测由 C38 独立取证。主卡运行 Qwen3.8-27B，辅助卡运行 MinerU 专用模型；embedding 默认保持独立 Ollama 主机。C38 必须比较同一标注样例的云端/本地转换质量、关键字段和后续结果，并测量双服务同时运行时的峰值显存/RAM、吞吐、延迟、排队和取消；官网功能 PASS 不证明本地质量、资源隔离或离线交付通过。C37 只有全部当前功能义务和必要审计完成后才可 PASS；当前业务缺项仍保留 BLOCKED。
# MinerU change 的验收范围

`adopt-mineru-document-ingestion`以转换器真实功能与受影响回归验收：五格式源字段/记录关联/页码、JSON-LD、质量阻断、权限/幂等/取消及耐久证据。本机CPU/Vulkan GPU基准为补充报告；完整浏览器业务和目标4090/Qwen双卡交付分别归C37/C38，不作为本change产品验收前置。全仓16项lint错误已修复。2026-10-11已部署MinerU 4.0.12固定服务并完成CPU/P4 Vulkan实测：两轮五格式的预热及各3次重复全部通过，五页扫描件亦完成各3次暖请求，127字段/60记录/原页/JSON-LD均正确。扫描件GPU加速约2.24–2.48倍，服务进程峰值显存1886 MiB；重启后真实PNG转换通过。GPU服务健康运行于127.0.0.1:18000，CPU实例已停止，模型与证据保留。操作见[服务说明](mineru/README.md)，计量与边界见[本机报告](../references/acceptance/mineru-v2/local-benchmark-report.md)。本change正式独立verification仍待最终Git检查点，未提交或归档。

