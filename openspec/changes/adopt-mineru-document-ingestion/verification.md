# Verification

## 验收对象

- Change：`adopt-mineru-document-ingestion`（`orchestrated-delivery`）。
- 规划 base：`0a25b6a469ade4bcc6a21c4514195d1f7c19ff31`。
- 输入实现 HEAD：`1d29de9c6c6a8302f790cab252147d602b812809`。
- 当前 HEAD：`1d29de9c6c6a8302f790cab252147d602b812809`；V-01 修复位于其后的未提交工作区，最终验收 HEAD 尚未固定。
- 验收 Agent：Codex 当前会话；限定审计由独立 Agent Boyle（`gpt-6-luna`，任务 `01a12b0e-b0b8-70d3-b95f-f906ade621cb`）执行，主验收 Agent 核对发现并完成复现。
- 日期：首次验收 2026-10-11；工作区修复与复验 2026-10-12。首次验收起点工作区干净；修复前保留已有 tasks 和本报告的未提交内容。

读取了 OpenSpec CLI 返回的全部 contextFiles、相关主规格、最终转换实现、受影响装配与测试，以及官网和本机实测报告。该提交同时包含 C37 增量，本结论只覆盖本 change 的 D-01–D-12、IP-01–IP-11 及受影响回归。

## 结论

**BLOCKED**

MinerU 五格式真实转换功能、源字段与定位、共享 JSON-LD、质量阻断、本机固定服务和 CPU/P4 Vulkan 基准均有先前通过证据。首次限定审计发现 V-01：parser 成功返回后，取消或超时仍可登记资料段并返回成功，导致原检查点验收失败。2026-10-12 已在工作区修复并通过受影响回归；当前阻塞仅为尚未形成修复后的固定 Git 检查点，task 4.3 仍未闭合，不能将旧 HEAD 的结论替换为最终 PASS。

V-01 对应 `platform/mineru-service-integration / 远端任务在原预算内耐久收口 / 取消与预算耗尽` 和 `data/scanned-document-ocr / OCR 与 llama.cpp 的运行资源相互隔离 / 单个 OCR 取消保持故障域`。收尾回归现已覆盖 parser 返回后的取消与 deadline，修复及命令结果见下方工作区复验记录；首次审计与失败复现保留为证据。

| 维度 | 核验结果 |
| --- | --- |
| 完整性 | 15 个 Requirement、41 个 Scenario 和 IP-01–IP-11 已在首次验收核对；tasks 保持 15/16，4.3 待新固定检查点 |
| 正确性 | 先前真实内容/定位/JSON-LD 证据保留；V-01 四项工作区回归与受影响测试通过 |
| 一致性 | D-04 收尾取消/截止时间约束已补齐，公共 Schema、权限、原事务和分层验收边界保持一致 |

本 change 的产品验收边界为 MinerU 转换器功能及受影响回归，本机 CPU/GPU 为补充硬件基准。C37 完整业务与可见浏览器流程、C38 4090/Qwen 共驻、离线介质与商业许可交付均按已批准设计留给对应 change，不构成本次失败原因。

## 核验与修复证据

### 证据索引

- T1：`packages/core/test/engineering-data/document-conversion.test.ts` 与 `packages/adapters/test/engineering-data/document-conversion.test.ts`，共享 Schema、分块/JSON-LD、源结构、原生格式与转换端口回归。
- T2：`packages/adapters/test/engineering-data/document-conversion/mineru/protocol.test.ts`，协议、授权、耐久回读、幂等、预算及传输/收尾取消。
- T3：同目录 `normalization.test.ts`，Middle2.0、点/像素、表格跨度、DOCX 源关联、质量与输入结构。
- T4：同目录 `official-normalization.test.ts`，官网 3.4.4、原页块、跨页标记、公式和几何拒绝。
- T5：同目录 `acceptance.test.ts`、`smoke.test.ts`，源字段/逐记录关联和显式真实服务验收。
- T6：`scripts/acceptance/mineru-benchmark.test.mjs`、`scripts/acceptance/generate-materials.test.py`，统计口径及源投影修正。
- T7：`pnpm test:deployment`，配置、装配、预置入口及部署回归。
- T8：`packages/contracts/test/module-interfaces-events-workflows.test.ts`，闭合公共命令/结果契约。
- E1：[官网真实转换报告](../../../references/acceptance/mineru-v2/acceptance-report.json)、[源真值清单](../../../references/acceptance/mineru-v2/manifest.json)、[验收记录](../../../deployment/ACCEPTANCE.md)。
- E2：[本机基准报告](../../../references/acceptance/mineru-v2/local-benchmark-report.md)及[完整 JSON 计量](../../../references/acceptance/mineru-v2/local-benchmark-report.json)；受限原始目录 `/home/joshua/.local/share/riskflow-mineru/evidence`。

以下按 delta spec 全部 Requirement 列出其全部 Scenario；未受修复影响的行沿用首次验收证据，V-01 相关行补充工作区复验。最终判定仍受新固定检查点缺口约束。

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| structured-document-conversion：统一转换契约只传递精确引用；结构化文档转换成功、OCR 消费共享契约、未声明输入被拒绝；IP-01/IP-07 | T1/T2/T8；`structured-document-converter.ts` 的服务格式路由，XLSX/CSV 保持原生；公共端口严格 Schema | 通过；无内联正文或第二个公共 OCR 入口 |
| structured-document-conversion：转换保留源文件可证明的结构与坐标；DOCX 结构可追溯、表格坐标可追溯、无可靠文本层的 PDF 使用 MinerU、无可靠文本层的 PDF 失败；IP-01/IP-02/IP-04 | T1/T3/T4、E1/E2；`source.ts`、`normalization.ts`、`official-normalization.ts` | 通过；源 DOCX 元信息、合并跨度、公式缓存保留，PDF 点与图片像素分开，空/不合格结果拒绝 |
| structured-document-conversion：不可信文档在版本化资源边界内处理；恶意压缩包被拒绝、CSV 编码不受支持、合法 XLSX 包内绝对关系；IP-02/IP-03 | T1/T2/T3；`parsers.ts` 安全 OOXML/关系解析、源预检与响应/ZIP预算 | 通过；合法 /xl/ 关系可读，外部/越界关系、非法编码与有害结构拒绝，公式不执行 |
| scanned-document-ocr：扫描资料只经受权的统一转换入口处理；获授权扫描资料进入 OCR、未授权与不存在不可枚举、非扫描输入不被错误接管；IP-01/IP-03 | T1/T2/T8；转换器先 C11 授权再 C04 读取；类型/媒体映射有界 | 通过；授权拒绝不联系服务，DOCX/文本 PDF 使用声明的服务分支，XLSX/CSV 不交给 OCR |
| scanned-document-ocr：OCR 结果保留页码版面阅读顺序与表格坐标；中文扫描 PDF 保留页面与版面、表格单元格可以回到原页、非法结构整体拒绝、跨页段落不改变源页定位、公式原文保留可追溯定位；IP-01/IP-04 | T3/T4/T5、E1/E2；原页 preproc 块、闭合块类别、页尺寸/顺序、表格跨度与 LaTeX 映射 | 通过；缺页、越界、重复顺序/重叠跨度拒绝，不补造 confidence 或逐单元格几何 |
| scanned-document-ocr：服务模型管线与资源版本完整可追溯；精确部署生成可重放结果、部署身份无法由冻结证据证明时拒绝调用结果、OCR 响应违反冻结协议；IP-03/IP-04/IP-10 | T2/T3/T4、E1/E2；配置引用匹配、producer/tier 校验、模型/镜像制品证据 | 通过；官网未知 serviceBuild/modelRevision 明示 null，未冒充本地身份 |
| scanned-document-ocr：原始响应和规范化结果先耐久后成立；成功结果具有完整工件链、工件持久化失败不返回成功；IP-03/IP-04 | T2；`#persistRawResponse`、`#persistServiceNormalizationDiagnostic` 及原 JSON-LD 工件接缝 | 通过；原始响应先写 C04 并受权回读/复验，失败不采纳内存响应或登记部分段 |
| scanned-document-ocr：版本化质量门拒绝空成功和有害结构；中文样例达到全部质量门、关键字段或页面覆盖不足；IP-03/IP-04/IP-07 | T3/T4/T5、E1/E2；旧 V1 响应重放拒绝记录 | 通过；新清单非空页/字段门均为 1，旧缺页/缺 SEG-002-GEO 结果仍被拒绝 |
| scanned-document-ocr：幂等重试与结构化失败保持一致；成功请求幂等重放、可重试服务失败保持冻结输入、同键载荷冲突；IP-03/IP-07 | T1/T2/T8；终态幂等及稳定 MINERU 错误、部署/策略引用校验 | 通过；成功重放不再调用服务或登记，失败不自动换后端/扩预算/提交新远端任务 |
| scanned-document-ocr：OCR 与 llama.cpp 的运行资源相互隔离；OCR 饱和不阻断模型调用、单个 OCR 取消保持故障域；IP-01/IP-03/IP-06/IP-07/IP-10 | T2 独立 slots/controller、模型/部署配置与回归、E2；V-01 工作区复验 | 收尾取消/deadline 回归通过；已耐久工件保留，物理双卡共驻归 C38 |
| scanned-document-ocr：协议替身与真实内网服务分层验收；默认测试无需外部 OCR 服务、显式 smoke 验证真实服务、修正样例以新投影和字段清单验收；IP-07/IP-08/IP-11 | T2–T6、E1/E2；生产包不导出测试替身；V1 保留、新投影按源 cases/模板生成 | 通过；默认真实 smoke 明确跳过，实测来源单列，不由服务输出生成期望 |
| mineru-service-integration：服务协议显式选择且网络边界受限；官网受控上传、自托管异步任务；IP-03/IP-05 | T2/T7、E1/E2；endpoint/transfer allowlist、禁止 redirect、关联身份和真实 raw upload 头 | 通过；签名上传无 Bearer，本地 partial/未知结构/丢失任务不可成功 |
| mineru-service-integration：远端任务在原预算内耐久收口；取消与预算耗尽、结果耐久失败；IP-01/IP-03/IP-07 | T2、C04 回读接缝；V-01 工作区复验 | parser 后取消/deadline 均阻止 C11 登记，返回失败并保存稳定诊断；同键重放不重复服务或登记 |
| mineru-service-integration：新转换版本与分层验收保留历史证据；历史版本不覆写、外部证据缺失；IP-05/IP-06/IP-07 | T7；`provision.mjs` 正式资料登记引用与 C11 单版本段集合接缝、操作手册；T5/E1/E2 | 通过；新转换按正式新资料版本处理，真实证据独立记录；未宣称已完成生产库下游重建验收 |
| mineru-service-integration：本机固定服务与性能基准可复用；服务在验收后继续可用、CPU与GPU记录同一质量口径；IP-10/IP-11 | T5/T6、E2、Compose校验、当前 health/容器状态、重启后 PNG 实测 | 通过；同镜像/模型/配额，VLM 实际 Vulkan/P4，小模型 CPU，固定回环服务健康 |

IP-05/IP-06 的生产库下游重建和 C38 目标双卡部分按 D-06/D-08 保留既有入口、配置及移交要求；此处核验其接缝和装配，不以隔离 parser smoke 宣称 C37 业务数据库验收通过。其余 IP 对应关系：IP-08 为新投影与真值，IP-09 为六个已授权文件中的 lint/格式机械收口，IP-10/IP-11 为独立固定服务及实测。D-01–D-03、D-05–D-12 沿用首次验收结论；D-04 的 V-01 已完成工作区修复与复验。

### 首次验收执行的验证（2026-10-11）

下列命令于固定实现 HEAD 上执行。测试集合有重叠，不累计宣称独立测试总数。

| 命令 | 结果 |
| --- | --- |
| `openspec instructions apply --change adopt-mineru-document-ingestion --json`；`openspec instructions verification --change adopt-mineru-document-ingestion --json` | 返回 orchestrated-delivery、全部 contextFiles、15/16 tasks 和 ready 的 verification 工件路径；ready 不等于验收通过 |
| `pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion/mineru scripts/acceptance/mineru-benchmark.test.mjs` | 7 文件、71 项通过；1 个真实 smoke 默认跳过，未计外部验收 |
| `pnpm test:deployment` | 19 文件、258 项通过 |
| `pnpm exec vitest run packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/adapters/test/model/network-api-model-gateway.test.ts scripts/deployment/api-ports.test.mjs scripts/deployment/composition.test.mjs` | 4 文件、47 项通过 |
| `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` | 1 文件、31 项通过 |
| `uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.test.py` | 4 项通过，未重新生成/覆盖历史样例 |
| `pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1` | ok=true，problems=[] |
| `pnpm lint` | 全仓通过 |
| `pnpm deps:check`；`pnpm deps:policy` | 679 模块、2264 依赖，无边界违规；依赖策略通过 |
| `docker compose -f deployment/mineru/compose.yaml config --quiet` | 通过；未构建或重启服务 |
| `curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18000/v1/health`；`docker ps -a --filter name=riskflow-mineru` | health 200、status=ok、version=4.0.12；GPU healthy、仅映射 127.0.0.1:18000，CPU实例停止 |
| `pnpm exec prettier --check openspec/changes/adopt-mineru-document-ingestion deployment/mineru references/acceptance/mineru-v2` | 通过；新增本报告后复验 |
| `openspec validate adopt-mineru-document-ingestion --strict --no-interactive`；`git diff --check` | 通过；工件落稿后复验 |
| `rg -n 'Paddle|createPaddle|PaddleOcr' packages/adapters/src scripts/deployment` | 无生产调用命中；MinerU依赖中的Paddle模型文件不等同于旧独立通道 |
| `pnpm exec vitest run .scratch/mineru-verification-cancellation.test.ts`（本轮临时复现） | 2 项失败；cancel/deadline 均 result=succeeded、registrations=1，确认 V-01；复现源码如下，临时文件已移除 |

### 沿用的先前实测与回归

2026-10-11 的实施阶段已执行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、同配置 `pnpm typecheck`、受影响文件 Prettier 及本 change strict，均通过，记录在 tasks 和 E2.validation。本轮仅新增验收文档，未重跑构建/类型检查或昂贵硬件基准；这些通过记录不覆盖 V-01。

官网以专用凭据执行显式五格式 smoke，并补充 5 页扫描件。E1 保留六份完成记录及旧失败样例重放：DEV 五项分别核验 12/31/3/3/8 个关键字段和 6/12/2/3/2 条关联记录，TRIAL 扫描核验 127 字段、60 记录、5 页，均通过共享 JSON-LD 合规。官网实际协议为 v4，布局为 hybrid/office 3.4.4，构建与模型 revision 未提供。

本机 E2 记录同一镜像 `sha256:75b37762034fa50e6dafee8f3ad3c383dcc760e7f58e4c2f52e429a8d556daf8`，MinerU 4.0.12、DocVortex 0.5.16、mineru-llama-cpp 0.1.3、onnxruntime 1.20.1；CPU/GPU 共用冻结的 ONNX 与 Q8_0 专用 VLM/mmproj。模型 HF revisions 分别为 `358310b4f64b95f9fefc372ad899356e4111f376` 和 `9185688a0495e1577d521a757c7c0b62dd38ca48`。

本轮核对了全部 48 个不同任务的证据目录仍存在、记录均 completed/compliant、五格式与长件输入摘要匹配，并抽查原始响应/规范化/转换/验收文件。原生日志明确 `selected Vulkan0 (Tesla P4), backend=Vulkan`，既有进程与采样证据证明 GPU 实际参与。另有重启后 PNG 转换，当前服务健康复查通过。

| 输入 | CPU 暖中位数 | P4 Vulkan 暖中位数 | CPU耗时/GPU耗时 |
| --- | --- | --- | --- |
| 文本 PDF，1页 | 2.52秒 | 2.53秒 | 1.00倍 |
| 扫描 PDF，1页 | 36.16秒 | 16.14秒 | 2.24倍 |
| PNG | 8.07秒 | 4.07秒 | 1.98倍 |
| JPEG | 6.05秒 | 4.07秒 | 1.49倍 |
| DOCX | 2.24秒 | 2.26秒 | 0.99倍 |
| 扫描 PDF，5页 | 180.99秒 | 72.85秒 | 2.48倍 |

基准每样例至少三次暖请求；CPU 长件首请求 185.1 秒单列，暖统计使用原第2/3次及重新预热后的补测。并发1，CPU配额16、cpuset 0–15、内存24 GiB，小模型均 CPU。长件吞吐 CPU/GPU 约 1.66/4.12 页每分钟；容器采样峰值内存 2.67/1.82 GiB，GPU服务进程显存峰值1886 MiB。启动到模型预加载健康 CPU/GPU 7.12/7.68秒，另一次重启7.00秒；这些启动值基于温热 OS 缓存。正文/签名 URL/秘密没有复制进本报告。

首次验收阶段生产修复：无。首次验收只新增 verification，并更新 tasks 的收口状态；以下工作区修复记录给出其后的当前状态。

### V-01 工作区修复与复验（2026-10-12）

用户批准方案后，在 IP-01 的 `structured-document-converter.ts` 将已有调用控制传入 `#finalizeParsedDocument`，复用 IP-03 的 `MINERU_ERROR_CODES_V1`，在收尾入口、JSON-LD 写入前和 C11 登记前检查取消与原 deadline。失败沿 `#finishFailure` 保存原始响应父引用、服务诊断及失败转换记录；已耐久工件不删除，同键重放保持原失败终态。检查限定于既有服务格式，原生 XLSX/CSV 路由不新增 MinerU 控制语义。

IP-07 的 `protocol.test.ts` 复用生产 parser 与现有 `makeServiceHarness`，以取消/超时 × 规范化诊断/JSON-LD 持久化后两处边界组成四项回归。修复前四项均得到 `succeeded` 并失败；修复后均返回 `failed`、不登记 C11 段集合，诊断分别为 `MINERU_ABORTED`（不可重试）/`MINERU_TIMEOUT`（可重试），原始响应及触发点工件保留。同键重放不再联系服务、写工件或登记。

检查在发起 C11 登记之前执行；未改 C11 权限、段集合原子性、转换记录事务或公共取消契约。既有 C11 登记与转换记录仍顺序调用，本修复不声称能撤销已经开始的登记或回滚既有耐久工件。未重新派发限定审计，测试辅助 Agent 仅补充回归用例，主线程核验和运行受影响回归。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/protocol.test.ts` | 修复前 4 项失败、18 项通过；修复后 22 项通过 |
| `pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion/mineru scripts/acceptance/mineru-benchmark.test.mjs packages/contracts/test/module-interfaces-events-workflows.test.ts` | 8 文件、106 项通过，1 个真实 smoke 默认跳过；未计为新的外部验收 |
| `pnpm test:deployment` | 19 文件、258 项通过 |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` | 通过 |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 通过；Vite 提示现有大于 500 kB 的产物块，未影响构建完成 |
| `pnpm lint`；受影响两份 TypeScript 的 ESLint/Prettier 检查 | 通过 |
| `pnpm deps:check`；`pnpm deps:policy` | 679 模块、2265 依赖，无边界违规；依赖策略通过 |
| `pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1` | ok=true，problems=[] |
| `pnpm exec prettier --check`（转换器、协议回归、tasks、本报告） | 通过 |
| `openspec validate adopt-mineru-document-ingestion --strict --no-interactive`；`git diff --check` | 通过 |

本轮修改仅含转换器、协议回归、tasks 和本报告，没有新增依赖或公共字段，未修改历史输入、部署服务、主规格或 Git 历史。本修复未提交，task 4.3 在新固定检查点形成并核对前保持未完成。

## 限定审计

依施工图 §8，首次验收执行了一次独立限定审计，范围为权限/网络/凭据、C04耐久、预算/取消和原转换/入库事务接缝。以下审计位置与失败复现均对应输入实现 HEAD；V-01 当前修复证据见上节。未派发第二次审计。

| 审计项 | 证据 | 结论 |
| --- | --- | --- |
| 授权、allowlist、凭据 | `structured-document-converter.ts:514,924`；`mineru/schema.ts:99`；`mineru-document-parser.ts:113,224,363`；T2缺凭据、不安全URL和不可枚举拒绝测试 | 未发现缺陷；受权读取先于服务访问，签名地址不带 Bearer、fetch 拒绝重定向 |
| 原始工件先耐久并受权回读 | `structured-document-converter.ts:985,1035`；`mineru-document-parser.ts:255`；T2 raw store/readback失败测试 | 未发现缺陷；只消费 C04 回读的已验证字节 |
| 传输阶段预算与远端取消 | `mineru-document-parser.ts:193,228,399,547`；T2并发、timeout、轮询、当前task取消测试 | 阶段内有效；不能据此宣称整个转换已受取消/deadline约束 |
| 转换收尾取消/deadline | `structured-document-converter.ts:591,659,756,836`；`mineru-document-parser.ts:647`及下方复现 | **V-01：中等严重度、阻止通过** |
| 原事务接缝 | `structured-document-converter.ts:622,1311`、提交diff、T1/T2/T7 | 既有接缝保持；C11段集合登记与转换记录事务仍顺序调用，未宣称跨二者新建单一事务 |

### V-01：parser 后取消与截止时间未约束资料段登记

parser 在自己的 finally 中清除 deadline timer 并释放 slots。转换器随后调用 `#finalizeParsedDocument`，该方法未接收调用控制，也未重新检查 `signal.aborted` 或 `command.deadlineAt`；继续持久化规范化诊断/JSON-LD，执行 `registerSegments` 和成功记录提交。

复现使用既有 `makeServiceHarness`、真实生产 parser 与协议替身，在 JSON-LD put 完成、C11登记尚未开始的精确边界触发取消或模拟时钟越过 deadline。两项均实际返回成功、登记一次；预期“不登记、返回失败”的断言失败。这是可观察的转换结果和资料段副作用，非内部调用顺序断言。

复现方法：将下列临时测试保存为项目根目录下 `.scratch/mineru-verification-cancellation.test.ts`，执行上述 Vitest 命令；本轮运行后已删除临时文件，未将其加入默认测试集。

```typescript
import { expect, it, vi } from "vitest";
import { makeServiceHarness, middle } from "../packages/adapters/test/engineering-data/document-conversion/mineru/fixture.js";

it.each(["cancel", "deadline"])("refuses segment registration after %s during finalization", async (mode) => {
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    const body = url.includes("/v1/tasks?")
      ? { task_id: "finalization", status: "queued" }
      : url.endsWith("/v1/tasks/finalization")
        ? { task_id: "finalization", status: "completed" }
        : { task_id: "finalization", status: "completed",
            files: [{ status: "completed", content: { middle_json: middle } }] };
    return new Response(JSON.stringify(body));
  });
  const h = makeServiceHarness({ fetch });
  const put = h.artifactStore.put.bind(h.artifactStore);
  h.artifactStore.put = async (command, content) => {
    const result = await put(command, content);
    if (command.mediaType === "application/ld+json") {
      if (mode === "cancel") controller.abort();
      else vi.spyOn(Date, "now").mockReturnValue(Date.parse(h.command.deadlineAt) + 1);
    }
    return result;
  };
  try {
    const result = await h.adapter.convert(h.command, { signal: controller.signal });
    console.log(JSON.stringify({ mode, result: result.kind, registrations: h.registered.length }));
    expect(h.registered).toHaveLength(0);
    expect(result.kind).toBe("failed");
  } finally {
    vi.restoreAllMocks();
  }
});
```

修复与复验要求：在既有转换接缝中使取消/截止时间覆盖 parser 返回后的收尾，至少在尚未登记 C11段集合时阻止新业务副作用，形成稳定失败诊断并保留已耐久证据；不通过清理历史资料段或更换远端任务伪装取消成功。复用该边界场景补齐有价值的回归，完成受影响检查，再固定新的实现 HEAD 更新本 verification。若修复需改变 C11授权/事务或公共取消契约，应按项目规则先闭合设计，不在报告中凭空承诺事务能力。

## 后续注意事项

以下均为已批准边界或后续交付事项；新固定检查点缺口仍属于当前收口条件，不归入此处。

- 样例为“合成样本，待甲方复核”。云端/本地在源字段与定位上通过，但资料段划分有少量差异，未证明下游识别/评估输出完全一致。
- 本机结论只适用于双 Xeon、125 GiB 可见内存、P4 8 GiB、该量化专用 VLM 与 Vulkan组合。耗时含预检、上传、轮询、耐久/规范化与合规检查；DOCX Flash不计VLM收益。三次重复只支持中位数，不报告p95，不外推4090/Qwen共驻。
- 未重启整台主机，未验证冷盘开机；容器重启可能丢失远端任务索引，业务耐久结果不得依赖旧task存活。
- 原始实测证据在本机受限目录，官网部分仍在报告指向的 /tmp 目录；交接时应连同源清单保存，不能只移交汇总JSON。
- C37继续验收生产资料登记、下游重建及可见浏览器完整流程；C38核验目标双GPU并发、离线制品和全部依赖/模型商业许可。当前许可证metadata不能作为商业许可承诺。
- 未运行或宣称全仓 `pnpm verify` 通过。先前其它change格式漂移及11项主规格超长Requirement警告与本change strict结果分开记录。
- 本轮未提交、同步主规格或归档；V-01 已通过工作区复验，新固定检查点闭合前仍不应以本工件归档该 change。

