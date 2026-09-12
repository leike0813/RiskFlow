## Context

见 [proposal.md](./proposal.md) 与 [扫描文档 OCR delta spec](./specs/data/scanned-document-ocr/spec.md)。C02 已冻结授权上下文、闭合错误、幂等和应用边界；C04 提供受权限保护的不可变内容/诊断工件；C05 的 llama.cpp 网关提供可参照但不可复用的部署、预算和协议隔离模式；C06 负责当前工程、空间和资料正文授权；C11 提供不可变资料版本、`SourceSegmentSetV1` 和 `registerSegments` 窄能力。

固定实现范围基线 `e0c928105de371668f7619145eb87a2272854b12` 已包含归档 C12 `deliver-structured-document-conversion`：`StructuredDocumentConversionPortV1` 已声明 `ocr-layout` 输入，`StructuredDocumentConversionAdapter.convert` 集中完成 C11 授权解析、C04 原始资料读取、业务幂等、JSON-LD/≤512 字符分块、结果工件写入、C11 `registerSegments`、事务、审计和结果重放。实现检查点 `66809f56d9e57428d0dd09c9b181643e9f409459` 已补入 OCR 私有 parser/finalizer 接缝，独立验证者的批准范围修复检查点为 `49ddda7b34a26569beae505153d72bcda3179fe7`；当前剩余缺口是 OCR 前授权归一、成功诊断耐久化和像素级中文样例证据。

协调裁决允许 C13 在本 change 内对 C12 adapter 做最小非公共重构；进一步核对发现 C12 `NormalizedBlockV1`/`TextBlockV1`/JSON-LD 没有文本置信度，空 page-break 也无法把页面尺寸穿透到 JSON-LD，不能满足本 delta 已有 Scenario。协调随后裁决在本 change 内对 core DTO 增加向后兼容的可选 `confidence` 与 `pageExtents` 并由既有转换函数透传，不拆新 change；不得伪造正文，`packages/contracts/**` 与数据库仍不变。

OCR 外部基线采用预置内网 PaddleOCR/PaddleX 3.7.0 的 `PP-StructureV3` 基础服务，固定 `POST /layout-parsing` 协议。官方文档说明该端点支持图像和 PDF、逐页 `layoutParsingResults`、版面/OCR/表格结果及坐标；PaddleOCR 3.7.0 使用 Apache-2.0。C13 不安装 Python 包、不下载模型、不管理服务进程；生产制品、SBOM、模型哈希、容器与设备分配由 C37 冻结。

## Goals / Non-Goals

**Goals:**

- 以一个注入 C12 adapter 的 OCR parser 实现扫描输入分支，把 PaddleX 私有协议收敛为 C12 规范化页、块和表格结构，再进入 C12 唯一 finalizer。
- 对输入、服务响应、坐标、质量和输出工件执行确定性校验；服务端成功码不是业务成功。
- 每次结果固定资料、授权、OCR 部署/构建/管线/模型、转换/质量策略和资源分配引用，并先耐久保存原始响应与规范化结果。
- 保持 OCR 与 llama.cpp 的配置、并发、超时、取消、资源引用和失败域独立，留下真实服务与目标环境验证入口。

**Non-Goals:**

- 不修改 `packages/contracts/**`、C02 公共端口、C11 Schema/数据库或其它 change；不新增数据库 migration。除本设计列明的 C12 adapter 私有接缝和 core 可选页面范围/置信度透传外，不改变 C12 统一接口、持久化记录或非 OCR 行为。
- 不解析 DOCX、文本 PDF、XLSX/CSV，不负责 JSON-LD 序列化、≤512 字符语义分块、前后指针或资料段集合算法；这些由 C12 唯一实现。
- 不执行数据清洗、错字修复、关键数值改写、部分可用判定、人工复核或 Agent 任务；C15 处理 OCR 证据上的语义判断。
- 不实现 OCR 调度平台、GPU 资源管理器、自动模型选择、云端回退、任意 URL 抓取或第二种 OCR 引擎。
- 不承诺 C37 目标硬件 SLA，也不把测试协议替身当作真实识别准确率证据。

## Decisions

### D-01. C12 保持唯一公共入口与最终收口所有者

C13 不实现第二个 `StructuredDocumentConversionPortV1`。composition root 仍只构造并暴露 `StructuredDocumentConversionAdapter`；新增 OCR 模块只提供给该具体 adapter 的 parser。外部调用继续使用同一个 `convert(request)`，命令、成功联合、失败联合和读取端口均不改变。

`StructuredDocumentConversionAdapter.convert` 的既有顺序保持：严格解析和版本引用核对 → C11 `resolveSourceProcessingInput` 授权解析 → 资料/工件精确引用核对 → `#readExisting` 幂等预检与重放 → `#readInput` 受权读取并等待 C04 `verified`。只有完成这些步骤且 `input.kind === "ocr-layout"` 后才调用注入 parser；其它格式继续走 `parseStructuredDocument`，不得经过 OCR 网络、并发或质量逻辑。

该顺序内增加一个只对 `ocr-layout` 生效的私有 `ocrAuthorizationDenied(command)` 拒绝归一：C11 返回的 `AUTHORIZATION_DENIED` 保持原类别；C11 已返回 source 后发现 command 与 source 的 source/version/artifact 精确引用不符、`ArtifactStore.open` 返回 `ARTIFACT_REFERENCE_NOT_FOUND`/`ARTIFACT_ACCESS_DENIED`，或打开后的 manifest artifact ref 不等于已授权 source artifact ref 时，均在 OCR 调用前返回同一不可重试 `AUTHORIZATION_DENIED` 公共类别，不写包含存在性细节的诊断。其它 `ArtifactStoreError` 继续按其可重试性和工件失败语义收口，media 不匹配仍是输入失败，非 OCR 格式完全保持 C12 既有错误行为。实现只复用现有 `ModuleErrorV1` 授权分支与 `ArtifactStoreError` 闭合码，不修改公共错误联合。

**选项：**（A）C12/C13 各自定义转换接口；（B）C13 修改公共 contracts；（C）C12 唯一拥有入口和收口，C13 仅注入 parser。
**决定：** C。它让新增代码停在协议边界，并保留一套授权、幂等、审计和持久化事实。

### D-02. 增加 adapter 私有 parser→finalizer 接缝，不复制收口流程

只在 `structured-document-converter.ts` 的具体 adapter options 增加 `ocrLayoutParser`，并让具体类方法接受可选的进程内 `convert(request, control?)`；额外可选参数仍满足既有单参数 `StructuredDocumentConversionPortV1`，不进入 `packages/contracts/**`。parser 类型通过 `StructuredDocumentConversionAdapterOptionsV1["ocrLayoutParser"]` 供同包 OCR 模块使用，不新增第二个公共 port。接缝固定为：

```text
OCR parser input
  command + 已授权 SourceProcessingInputV1 + 已验证原始 bytes
  resource policy + caller AbortSignal
  persistRawResponse(raw bytes, safe trace) -> 已验证 diagnostic ref + bytes

OCR parser output
  ParsedDocumentV1
  additionalParentArtifactRefs = 本次调用全部已成立 raw OCR diagnostic refs
  additionalEvidenceReferences = 已规范化资料段 evidence
  safeDiagnostic = 版本引用、计数、质量逐项结果

C12 finalizer（唯一实现）
  convertParsedDocument -> maxOutputBlocks
  -> OCR normalization diagnostic put/open/verified
  -> JSON-LD content put（parents 含 normalization diagnostic）
  -> C11 registerSegments -> conversion record/audit transaction -> result/replay
```

`persistRawResponse` 是 C12 绑定当前 command/source/artifactStore 的闭包：它对每个收到的 HTTP 响应（含可重试服务错误）使用当前授权构造 C04 diagnostic put，parent 为原始 content 工件；写入成功后再以相同工程、主体与授权 `open`，在响应上限内读取并等待 `verified`，只把重读字节交给 OCR 私有 Schema。raw 工件使用 `ocr-raw-response-<conversionId>-attempt-<n>`，command/idempotency 后缀固定为 `:ocr-raw:<n>`，不得与最终失败诊断的 `:diagnostic` 键冲突。为让 JSON-LD/失败诊断引用全部已成立 raw 工件，现有 `artifactCommand` 的 parent 参数只从 `ContentArtifactRefV1[]` 最小放宽为 C04 已支持的 `ArtifactRefV1[]`；Schema、排序和去重仍由 C04 处理。C13 不自行拼 C04 命令、不直接调用 C11，也不持久化转换记录。

现有 post-parse 代码只抽成 adapter 私有 `#finalizeParsedDocument`，接收 parser output 并继续使用 `convertParsedDocument`、`artifactCommand`、`toEvidenceReferences`、`toSourceSegments`、`#persist`。仅当 `input.kind === "ocr-layout"` 时，finalizer 通过新私有 `#persistOcrNormalizationDiagnostic` 把 command 的 converter deployment/quality policy 引用和 parser 的 `safeDiagnostic` 原样封装为既有 C04 `diagnostic` 工件 `ocr-normalization-diagnostic-<conversionId>`，command/idempotency 后缀固定为 `:ocr-normalization-diagnostic`；页/区域/表格/单元格计数和质量逐项结果来自现有 `parsed.diagnostic`，完整 service/pipeline/model/resource 引用继续由 raw diagnostic parents 提供。该工件的 parents 为原始 content 与全部 raw diagnostics，并必须经新私有 `#readVerifiedDiagnostic` 以相同授权 `open`、有界读取和 `verified` 后，才能与原始 content、raw diagnostics 一起成为 JSON-LD parents；持久化或复验失败按 `OCR_ARTIFACT_PERSISTENCE_FAILED` 收口，不发布 JSON-LD 或登记资料段。非 OCR parser 的内存 diagnostic 不新增工件，保持 C12 行为。

evidence 合并 finalizer 从 source segments 派生的引用和 parser 额外引用，parents/evidence 均复用 C04 的排序去重函数。parser 完成但 finalizer 失败时，C12 最终失败诊断继承全部已成立 raw/normalization diagnostic 和 content 工件；不能把这些 diagnostic 填进成功记录的 `diagnosticRef`，因为该闭合联合明确禁止成功记录携带失败诊断。成功诊断只由 JSON-LD parent 链到达，不新增成功记录字段、JSON-LD 字段、工件种类、数据库列或第二事实源。

parser 抛出的错误只允许携带闭合 `code`、`retryable`、安全阶段、可选 `sourceSegmentId`、已成立 parent/evidence 和经过白名单的版本/计数/质量字段。`#finishFailure` 读取这些字段并生成唯一对外诊断；原始 HTTP 消息、响应正文和堆栈只留在 raw diagnostic。若 raw response 尚未耐久成立，则失败诊断只指向原始 content；若已成立，则 raw diagnostic 必须成为 parent。取消不回滚任何已成立工件。

**选项：**（A）C13 复制 `convert` 后半段；（B）让 OCR parser 直接写 C11/数据库；（C）注入 parser 并调用 C12 私有 finalizer。
**决定：** C。改动集中在一个既有 adapter 文件，且任何格式最终只走一套 JSON-LD、登记、审计和幂等路径。

### D-03. core 只增加可选页面范围与置信度透传

新增闭合 `DocumentPageExtentV1Schema`：`pageNumber` 为一基正整数，`width/height` 为有限正数，`coordinateSystem` 固定为 `pixel-top-left`。`ParsedDocumentV1Schema`、`NormalizedDocumentV1Schema` 与 `StructuredDocumentJsonLdV1Schema` 增加可选、按页码升序且页码唯一的 `pageExtents`；`convertParsedDocument` 原样透传。OCR parser 必须提供并覆盖全部输入页，非 OCR parser 可省略；不得用 page-break 的伪造文本承载页面尺寸。

在 `NormalizedBlockV1Schema` 与 `TextBlockV1Schema` 增加可选有限数值 `confidence`，范围 `[0,1]`；`chunkNormalizedBlocks` 把来源 block 的同一置信度复制到其所有 ≤512 字符片段，`StructuredDocumentJsonLdV1Schema` 因复用 `TextBlockV1Schema` 自然保留。非 OCR parser 不设置该字段，现有 JSON-LD 与调用方保持兼容；不增加 OCR engine、质量策略或其它泛化字段。

文本/标题/图注 block 使用已有 page coordinate 表达区域边界，阅读顺序由 parser 的确定 block 顺序进入 C12 `sequence`/`follows`。OCR cell block 的 `coordinate` 使用 page coordinate 保留页内矩形，已有 `tableId/sheet/row/column/rowSpan/columnSpan` 同时保留表格身份；下游无需重读 Paddle 响应。core 测试只增加“页面范围原样进入 JSON-LD、置信度经分块保留、重复/乱序页或越界置信度拒绝”的稳定行为断言。

**选项：**（A）把页面尺寸/置信度只留在诊断工件；（B）在 core 增加两个可选字段并透传；（C）扩展公共 port/数据库或伪造正文。
**决定：** B。协调裁决认定诊断链和伪造文本都不能满足 Scenario，而可选 core 字段是最小兼容改动，无需改 contracts 或 migration。

### D-04. PaddleX 协议 Schema 留在 adapter，业务只看 C12 DTO

新增 adapter 私有 Schema：

| Schema | 关键内容 |
| --- | --- |
| `PaddleOcrDeploymentConfigV1Schema` | `deploymentRef`、`serviceBuildRef`、`pipelineRef`、非空且排序去重的 `modelVersionRefs`、`resourceAllocationRef`、`retryPolicyRef`、`baseUrl`、固定 `protocolVersion`、`maxInputBytes`、`maxResponseBytes`、`maxPages`、`maxConcurrentRequests`、`maxQueuedRequests`、`requestTimeoutMs`、`maxAttempts`、`retryDelayMs` |
| `PaddleLayoutRequestV1Schema` | Base64 `file`、由媒体类型确定的 `fileType`、固定关闭返回图片/Markdown 图片的受控参数；禁止 URL、路径、设备和模型参数 |
| `PaddleLayoutResponseV1Schema` | `logId`、`errorCode`、`errorMsg`、`result.layoutParsingResults`、`dataInfo` 的所需闭合视图 |
| `OcrTraceV1Schema` | conversion/input refs、deployment/service/pipeline/model/resource/policy refs、字节/页/区域/单元格计数、开始结束时间、原始响应与规范化结果工件 refs |

部署配置由 composition root 注入后深冻结。`baseUrl` 只允许无用户信息、query 或 fragment 的 `http:`/`https:` 内网 origin；adapter 只追加 `/layout-parsing`，使用 `redirect: "error"`。模型路径、服务 URL 和请求细节不得来自业务输入。重复部署引用、空模型集合、非正整数预算、超时晚于业务 deadline 或配置上限矛盾在构造/网络前失败。

PaddleX 响应包含大量非业务字段。adapter 使用 Zod 解析所需字段并显式丢弃未消费字段，不把服务对象透传给 C12；`errorCode !== 0`、缺少逐页结果或结构不符均失败。原始字节仍完整保存为受保护诊断工件，便于精确服务版本复现。

**选项：**（A）把 PaddleX JSON 暴露为统一 DTO；（B）只保存 Markdown；（C）adapter 私有协议 Schema + C12 规范化 DTO。  
**决定：** C。PaddleX 升级只影响一个 adapter，且下游仍能使用页码、阅读顺序和表格坐标。

### D-05. 服务基线固定为 PaddleOCR/PaddleX 3.7.0 PP-StructureV3

服务依赖记录如下：

| 项 | 当前基线 |
| --- | --- |
| 软件 | `paddleocr==3.7.0`、`paddlex==3.7.0`，`PP-StructureV3` |
| 用途 | 中文扫描 PDF/PNG/JPEG 的文字、版面、阅读顺序与表格结构识别 |
| 许可证 | Apache-2.0 |
| 官方来源 | `https://github.com/PaddlePaddle/PaddleOCR/tree/v3.7.0`、`https://github.com/PaddlePaddle/PaddleX/tree/release/3.7` |
| 协议 | 官方基础服务 `POST /layout-parsing`；JSON 请求/响应，文件以 Base64 传入 |
| 离线方式 | C37 固定 wheel/OCI/模型制品与哈希并预置内网，不允许服务运行时下载 |
| 退出条件 | 许可证不允许交付、固定协议无法返回逐页版面/单元格坐标、目标硬件无法达成 C37 基准或安全维护停止 |

C13 仓库不增加 Python/npm 依赖。TypeScript adapter 使用 Node.js 24 原生 `fetch`、`AbortSignal.timeout`/组合信号、`Buffer` 和流 API；不会为了官方 Node 示例引入 Axios。服务未提供可靠运行时版本探测，因此 adapter 不伪造探测接口：精确版本以 C37 生成并签入受控配置的服务/管线/模型/资源引用为事实，真实 smoke 必须由操作者证明预置服务与配置匹配，结果记录这些引用。若后续服务提供受版本约束的官方元数据端点，再通过独立变更增加主动探测。

### D-06. 有界缓冲匹配官方 Base64 协议，避免自造上传服务

C12 `#readInput` 已先校验来源工件与授权。官方 `/layout-parsing` 要求 JSON 内 Base64 文件，因此 OCR parser 只接收该方法在 `maxInputBytes` 内完成并等待 C04 `verified` 的字节，然后编码一次；超限在网络前失败。响应同样在 `maxResponseBytes` 内读取，立即交给 D-02 的 `persistRawResponse`，待 C12 写入并受权重读成功后才解析；规范化 C12 结果另存 content 工件、登记资料段并提交记录后才返回成功。

默认请求按 PaddleX 3.7 serving 请求 Schema 设置 `visualize: false` 与 `returnMarkdownImages: false`，关闭 C13 不消费的大型图片返回，只请求结构化结果。`outputImages` 是响应字段，不是请求开关，禁止发送。PDF 页数在服务结果返回后必须小于等于 `maxPages` 并与 `dataInfo`/输入页数证据一致；无法证明完整页数时质量门失败。

**选项：**（A）新增自定义 multipart 代理；（B）无上限读入内存；（C）遵循官方 Base64 协议并设置严格输入/响应上限。  
**决定：** C。已有官方服务即可满足目标；有界内存是明确上限，真实样例超过上限时再评估分片协议，不预建代理。

### D-07. 坐标归一化只做无损确定性映射

每页必须得到一基 `pageNumber`、正整数 `width/height` 和固定坐标系 `pixel-top-left`。服务坐标接受四点多边形或矩形，先验证点位于 `[0,width] × [0,height]`，再无损转换为 C12 的 page coordinate 矩形；非轴对齐且无法无损表达的多边形整体失败，禁止取整、裁剪越界或猜测缺失尺寸。

区域按服务阅读顺序排序并生成稳定页内 identity；重复/缺失阅读顺序、重复页、缺页、空区域 identity 均失败。版面标签通过本地闭合映射表转换为 C12 类别；未知标签进入显式 `unknown`（仅当 C12 契约允许）或输出校验失败，不以字符串相似度猜测。

表格以页内表格区域为父对象。每个单元格必须提供零/一基规则明确的行列范围、`rowSpan/columnSpan`、页内坐标和 OCR 文本；行列范围正序，单元格多边形包含于表格边界。C13 不根据空白或文本排列推测合并单元格。服务只返回 HTML 而没有单元格坐标时，表格结构质量门失败，HTML 不作为结构事实。

### D-08. 质量门由版本化策略驱动，固定样例只验证稳定语义

`OcrQualityPolicyV1` 作为 adapter 注入配置提供，并带有必须精确等于 command `qualityPolicyRef` 的 `policyRef`；不新增策略解析端口。C13 只消费：

- `requiredPageCoverage`：输入页完整性必须为 100%；
- `minimumNonEmptyPageRatio`、`minimumValidRegionRatio`、`minimumReadingOrderRatio`；
- `minimumMeanServiceConfidence` 与可选页面/区域最低置信度；
- `requireCompleteTableCells`；
- 验收清单专用 `minimumKeyFieldCoverage`。

实现不硬编码业务阈值。生产通用门只评估结构、置信度与非空覆盖；关键字段覆盖由验收 fixture 的版本化清单提供，清单项包含稳定字段 identity、规范化期望值和页/区域定位。比较只做 Unicode NFKC、首尾/连续空白规范化与全角半角归一，不做模糊猜词、LLM 修复或数值改写。每项输出 `passed/failed`、观测值、阈值和页/区域引用；失败保持原始响应/规范化候选工件，供 C15 后续判断，但不返回业务可用结果。

真实脱敏样例优先。仓库暂缺甲方样例时，测试内以手写 16×16 CJK 位图数据确定性绘制至少“扫描”两个汉字，并让 PDF、PNG、JPEG 三个构造器消费同一 320×200 灰度/RGB 扫描栅格；现有最小 baseline JPEG 只扩展为编码 8×8 常量灰度块的 DC 差值与 EOB，不引入字体、图像库或外部下载。验收清单固定字形集版本、文字、像素区域和三媒体尺寸，并把 JPEG 尺寸从占位的 16×16 校正为 320×200；fixture 测试同时断言字形笔画/留白像素、三个构造器确实消费该栅格、已提交文件逐字节等于构造结果，并继续标注“合成样例、待甲方复核”。甲方样例到达后通过新的 fixture/策略版本补充，不覆盖旧证据。

### D-09. 错误闭合映射到 C12，技术诊断只进工件

C13 adapter 内部错误码固定为：

| code | retryable | 阶段 |
| --- | ---: | --- |
| `OCR_AUTHORIZATION_DENIED` | false | `authorization` |
| `OCR_INPUT_INVALID` / `OCR_MEDIA_TYPE_UNSUPPORTED` | false | `input` |
| `OCR_DEPLOYMENT_NOT_FOUND` | false | `deployment` |
| `OCR_DEPLOYMENT_MISMATCH` | false | `deployment` |
| `OCR_BUDGET_EXCEEDED` | false | `budget` |
| `OCR_SERVICE_UNAVAILABLE` / `OCR_SERVICE_RATE_LIMITED` / `OCR_TIMEOUT` | true | `service` |
| `OCR_PROTOCOL_INVALID` | false | `protocol` |
| `OCR_OUTPUT_INVALID` | false | `normalize` |
| `OCR_QUALITY_BLOCKED` | false | `quality` |
| `OCR_ARTIFACT_PERSISTENCE_FAILED` | true | `artifact` |
| `OCR_CANCELLED` | false | `control` |

它们确定性映射为 C12 闭合转换错误；请求引用与冻结 deployment/quality 配置不匹配，或 C37 smoke 证据不能证明预置服务身份时，使用 `OCR_DEPLOYMENT_MISMATCH → deployment → false`。身份已匹配但 HTTP/JSON/响应 Schema 或服务协议级成功码违反冻结协议时，使用 `OCR_PROTOCOL_INVALID → protocol → false`；结构可以解析但页、区域、坐标、阅读顺序或表格不满足规范化不变量时，使用 `OCR_OUTPUT_INVALID → normalize → false`。HTTP 状态、服务 `errorCode`、堆栈和原始消息只写受保护诊断工件。授权/不存在按 D-01 对外不可区分。相同 `(projectId, conversionKind, idempotencyKey)` 与规范化 strict payload 哈希重放原结果；同键异载荷冲突。服务不可用、限流与超时只在单次 `convert` 内按冻结 `retryPolicyRef/maxAttempts/retryDelayMs` 重试，且每次保持原资料、部署、模型、策略、deadline 与资源引用；预算耗尽后由 C12 持久化最终失败，同键重放不再次联网。取消不重试，也不回滚已耐久工件。

### D-10. OCR 与 llama.cpp 使用独立实例级并发状态

每个 OCR parser 实例按 OCR `deploymentRef` 拥有自己的有界 semaphore、等待队列、超时和请求控制器，不读取或复用 C05 网关的部署 Map、probe cache、AbortSignal、token 预算或并发状态。达到 `maxConcurrentRequests` 后只允许进入 `maxQueuedRequests` 有界队列，队列满立即 `OCR_SERVICE_RATE_LIMITED`；等待期间仍受 caller/deadline 控制，不创建跨服务全局队列。

`resourceAllocationRef` 只引用 C37 管理的容器/CPU/内存/GPU 配额事实；C13 不解释或动态修改物理设备。确定性隔离测试同时启动 OCR 协议替身和 C05 llama.cpp 协议替身，令 OCR 饱和、超时、取消和崩溃，并证明 llama.cpp 调用仍只受自身配置影响。真实 smoke 在预置环境核对两种 deployment/resource refs 不相同；物理显存/容器配额与目标硬件压力证据在 C37 收口。

### D-11. 工件、权限、日志和指标不形成第二套事实

原始响应使用 `diagnostic` 工件，body 是含版本引用、attempt、计数与原始响应的闭合 envelope，parent 为原始 content 工件；通过协议、结构和质量门后的 parser diagnostic 另写为 D-02 的 normalization `diagnostic` 工件，parents 为原始 content 与全部 raw diagnostics。C12 JSON-LD `content` 工件的 parents 为原始 content、全部 raw diagnostics 与 normalization diagnostic，evidence 为规范化后可成立的资料段引用。最终失败诊断把全部已成立 raw/normalization diagnostics、JSON-LD content 等额外 parent/evidence 继续穿透。写入命令继承请求授权中的空间与资料 grant，不允许扩大。C04 清单、哈希与访问审计是耐久事实，C13 不增加工件种类、数据库表、审计表或事件。

允许低基数观测：按部署引用规范化标签、阶段、结果码的请求数与耗时，以及输入/响应字节、页、区域、单元格、质量指标和并发拒绝计数。禁止记录文件名、base64、OCR 文本、表格内容、原始服务消息、模型路径、完整 URL 或高基数工件 identity。日志失败不能把业务失败变成功；C04 工件/审计失败必须阻断成功。

### D-12. 文件所有权与测试层次

实现基线已归档 C12 且 `packages/adapters` 已存在统一文档转换出口。新增文件为：

```text
packages/adapters/src/engineering-data/document-conversion/ocr/
  config.ts
  schema.ts
  paddle-ocr-document-converter.ts
  index.ts
packages/adapters/test/engineering-data/document-conversion/ocr/
  fixture.ts
  paddle-ocr-document-converter.test.ts
  paddle-ocr-document-converter.smoke.test.ts
  fixtures/
    synthetic-scanned.pdf
    synthetic-scanned.png
    synthetic-scanned.jpeg
    acceptance-manifest.v1.json
```

允许修改的既有文件仅为：

```text
packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts
packages/adapters/src/engineering-data/document-conversion/index.ts
packages/adapters/test/engineering-data/document-conversion.test.ts
packages/core/src/engineering-data/document-conversion/schema.ts
packages/core/src/engineering-data/document-conversion/service.ts
packages/core/test/engineering-data/document-conversion.test.ts
```

前两类 adapter 修改仅实现 D-02 接缝与 OCR 导出；core 三处仅实现 D-03 可选页面范围/置信度。禁止修改 `packages/contracts/**`、`apps/**`、C11 实现、数据库 migration、根/包 manifest、依赖政策、`pnpm-lock.yaml`、`openspec/config.yaml`、主 specs、归档或其它活动 change。现有 package export 已覆盖目录，不改 manifest。

测试分三层：纯 Schema/映射表格测试；使用本地 HTTP 协议替身与 C04 临时工件存储的 adapter 行为测试；`RISKFLOW_OCR_SMOKE=1` 显式开启的真实服务 smoke。默认测试不启动服务，显式 smoke 缺少完整冻结配置、样例或服务时必须失败而非 skip/替身回退。

## Risks / Trade-offs

- [C12 adapter 没有 OCR 注入点] → 只增加 D-02 parser→finalizer 私有接缝，非 OCR parser 和公共端口不变；现有 C12 adapter/PostgreSQL 测试继续作为回归门。
- [C12 core 不保留页面尺寸与文本置信度] → 按协调裁决实施 D-03 两个可选字段透传并增加 core 行为测试；若实现发现还必须改变 contracts、持久化 Schema 或 migration，立即停止并升级。
- [官方 Base64 协议放大内存与请求体] → 配置严格输入/响应上限并关闭图片返回；只有真实扫描资料超过上限时再评估服务侧分片，不预建代理。
- [服务版本无法由官方端点主动证明] → C13 保留显式启用且缺证据即失败的 smoke；C37 的受控部署清单和真实 smoke 提供精确版本、三媒体实测与资源隔离证据，该证据缺口不阻塞 C13；服务将来提供稳定元数据端点时另行演进。
- [PP-StructureV3 多模型组合可能随发行版变化] → 配置固定非空模型引用集合与管线配置摘要，任何升级形成新部署版本并重新 smoke，不使用“最新版”。
- [合成中文样例不能证明现场准确率] → 只用于结构、关键字段与错误回归，明确待甲方复核；C36/C37/C38 使用真实脱敏样例与目标硬件证据。
- [OCR 与 llama.cpp 可能共享同一物理 GPU] → C13 隔离软件状态并记录资源引用，C37 负责容器/设备配额和压力基准；未取得物理隔离证据时不宣称硬件隔离完成。

## Migration Plan

1. 在固定基线复验 C12 当前符号与全部调用方；先完成 D-03 可选页面范围/置信度和 D-02 私有接缝，并以既有 core/adapter/PostgreSQL 测试证明非 OCR 行为、审计、事务与幂等未变。
2. 完成 PaddleOCR/PaddleX 3.7.0 的依赖/许可证审阅并登记服务制品责任边界；C13 不修改 Node manifest 或 lockfile。
3. 实现 adapter 私有 Schema、配置、协议映射与协议替身测试，再在 C12 既有出口汇总；默认配置不启用任何服务，不提供云端地址或自动回退。
4. C13 交付 fail-closed 的真实 smoke 入口并验证显式启用但配置/服务/证据缺失时失败；C37 预置内网服务、全部模型和资源清单后运行三媒体 smoke，保存精确引用、指标、工件与资源隔离证据。
5. 部署回滚只移除 OCR parser 注入或切回已验证的旧部署配置版本；可选 core 字段不会改变无该字段的旧文档。既有 C04 工件、资料版本和段集合不删除、不覆盖，未知 OCR 版本的历史工件不得由旧 adapter 重新解释为新成功结果。

## Open Questions

无。统一接口所有权、D-02 私有接缝、D-03 可选页面范围/置信度、OCR 服务基线、协议、Schema/工件/权限/错误/资源边界、文件范围和验证层次均已固定；若实现必须越过列明文件、修改 contracts 或 migration，属于规划外公共契约缺口，立即升级主调度。
