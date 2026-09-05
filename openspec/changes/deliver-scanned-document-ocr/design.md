## Context

见 [proposal.md](./proposal.md) 与 [扫描文档 OCR delta spec](./specs/data/scanned-document-ocr/spec.md)。C02 已冻结授权上下文、闭合错误、幂等和应用边界；C04 提供受权限保护的不可变内容/诊断工件；C05 的 llama.cpp 网关提供可参照但不可复用的部署、预算和协议隔离模式；C06 负责当前工程、空间和资料正文授权；C11 提供不可变资料版本、`SourceSegmentSetV1` 和 `registerSegments` 窄能力。

当前代码没有文档转换 interface。协调裁决指定 C12 `deliver-structured-document-conversion` 唯一拥有统一文档转换 interface、规范化块、JSON-LD 和资料段组装；C13 只拥有 OCR 特殊输入通道。C13 规划可以完成，但生产实现必须以已归档 C12 契约为输入；实现首项只做契约对账，若语义或文件所有权与本文接缝不一致即升级主调度，不在 C13 增设临时接口。

OCR 外部基线采用预置内网 PaddleOCR/PaddleX 3.7.0 的 `PP-StructureV3` 基础服务，固定 `POST /layout-parsing` 协议。官方文档说明该端点支持图像和 PDF、逐页 `layoutParsingResults`、版面/OCR/表格结果及坐标；PaddleOCR 3.7.0 使用 Apache-2.0。C13 不安装 Python 包、不下载模型、不管理服务进程；生产制品、SBOM、模型哈希、容器与设备分配由 C37 冻结。

## Goals / Non-Goals

**Goals:**

- 以一个 adapter 实现 C12 统一转换 interface 的扫描输入分支，把 PaddleX 私有协议收敛为 C12 规范化页、块和表格结构。
- 对输入、服务响应、坐标、质量和输出工件执行确定性校验；服务端成功码不是业务成功。
- 每次结果固定资料、授权、OCR 部署/构建/管线/模型、转换/质量策略和资源分配引用，并先耐久保存原始响应与规范化结果。
- 保持 OCR 与 llama.cpp 的配置、并发、超时、取消、资源引用和失败域独立，留下真实服务与目标环境验证入口。

**Non-Goals:**

- 不修改 `packages/contracts/**`、C02 公共端口、C11 Schema/数据库、C12 统一接口或其它 change；不新增数据库 migration。
- 不解析 DOCX、文本 PDF、XLSX/CSV，不负责 JSON-LD 序列化、≤512 字符语义分块、前后指针或资料段集合算法；这些由 C12 唯一实现。
- 不执行数据清洗、错字修复、关键数值改写、部分可用判定、人工复核或 Agent 任务；C15 处理 OCR 证据上的语义判断。
- 不实现 OCR 调度平台、GPU 资源管理器、自动模型选择、云端回退、任意 URL 抓取或第二种 OCR 引擎。
- 不承诺 C37 目标硬件 SLA，也不把测试协议替身当作真实识别准确率证据。

## Decisions

### 1. C12 拥有统一转换 interface，C13 只实现扫描 adapter

C13 在 `packages/adapters/src/engineering-data/document-conversion/ocr/` 实现 C12 归档后导出的统一转换 interface。接缝语义固定为：

```text
convert(request, control?)

request:
  schemaVersion / conversionId / idempotencyKey / issuedAt / deadlineAt
  projectId / actorId / authorization
  sourceVersionRef / sourceArtifactRef / mediaType
  conversionPolicyRef / qualityPolicyRef / converterDeploymentRef
control:
  AbortSignal（仅进程内，不进入 DTO、工件或审计）
result:
  succeeded -> C12 规范化转换结果/JSON-LD/资料段集合引用
  failed    -> C12 闭合转换错误及诊断/中间工件引用
```

C13 adapter 只接受 C12 分派的 `application/pdf`、`image/png`、`image/jpeg` 扫描分支。它把 OCR 页、区域和单元格映射为 C12 的规范化中间结构，再调用 C12 唯一收口逻辑完成 JSON-LD、≤512 字符分块、相邻指针和 C11 `registerSegments`；C13 不复制这些 Schema 或算法。C12 若采用不同符号名，任务 1.1 只按归档出口机械导入，但上述字段、结果与所有权不得变化。

**选项：**（A）C12/C13 各自定义转换接口；（B）C13 修改公共 contracts；（C）C12 唯一拥有接口，C13 实现 adapter。  
**决定：** C。它保持 C12/C13 可分别拥有协议实现，同时让 JSON-LD、资料段和失败语义只有一个事实源。

### 2. PaddleX 协议 Schema 留在 adapter，业务只看 C12 DTO

新增 adapter 私有 Schema：

| Schema | 关键内容 |
| --- | --- |
| `PaddleOcrDeploymentConfigV1Schema` | `deploymentRef`、`serviceBuildRef`、`pipelineRef`、非空且排序去重的 `modelVersionRefs`、`resourceAllocationRef`、`baseUrl`、固定 `protocolVersion`、`maxInputBytes`、`maxResponseBytes`、`maxPages`、`maxConcurrentRequests`、`requestTimeoutMs` |
| `PaddleLayoutRequestV1Schema` | Base64 `file`、由媒体类型确定的 `fileType`、固定关闭返回图片/Markdown 图片的受控参数；禁止 URL、路径、设备和模型参数 |
| `PaddleLayoutResponseV1Schema` | `logId`、`errorCode`、`errorMsg`、`result.layoutParsingResults`、`dataInfo` 的所需闭合视图 |
| `OcrTraceV1Schema` | conversion/input refs、deployment/service/pipeline/model/resource/policy refs、字节/页/区域/单元格计数、开始结束时间、原始响应与规范化结果工件 refs |

部署配置由 composition root 注入后深冻结。`baseUrl` 只允许无用户信息、query 或 fragment 的 `http:`/`https:` 内网 origin；adapter 只追加 `/layout-parsing`，使用 `redirect: "error"`。模型路径、服务 URL 和请求细节不得来自业务输入。重复部署引用、空模型集合、非正整数预算、超时晚于业务 deadline 或配置上限矛盾在构造/网络前失败。

PaddleX 响应包含大量非业务字段。adapter 使用 Zod 解析所需字段并显式丢弃未消费字段，不把服务对象透传给 C12；`errorCode !== 0`、缺少逐页结果或结构不符均失败。原始字节仍完整保存为受保护诊断工件，便于精确服务版本复现。

**选项：**（A）把 PaddleX JSON 暴露为统一 DTO；（B）只保存 Markdown；（C）adapter 私有协议 Schema + C12 规范化 DTO。  
**决定：** C。PaddleX 升级只影响一个 adapter，且下游仍能使用页码、阅读顺序和表格坐标。

### 3. 服务基线固定为 PaddleOCR/PaddleX 3.7.0 PP-StructureV3

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

### 4. 有界缓冲匹配官方 Base64 协议，避免自造上传服务

C04 `open` 先校验来源工件与授权。官方 `/layout-parsing` 要求 JSON 内 Base64 文件，因此 adapter 在 `maxInputBytes` 内完整读取并等待 C04 `verified`，然后编码一次；超限在网络前失败。响应同样在 `maxResponseBytes` 内读取，先以原始字节写入 C04 诊断工件，待 `put` 成功后再从该工件受权重读并解析；规范化 C12 结果另存内容工件后才返回成功。

默认请求关闭 `outputImages`、Markdown 图片等 C13 不消费的大型返回物，只请求结构化结果。PDF 页数在服务结果返回后必须小于等于 `maxPages` 并与 `dataInfo`/输入页数证据一致；无法证明完整页数时质量门失败。

**选项：**（A）新增自定义 multipart 代理；（B）无上限读入内存；（C）遵循官方 Base64 协议并设置严格输入/响应上限。  
**决定：** C。已有官方服务即可满足目标；有界内存是明确上限，真实样例超过上限时再评估分片协议，不预建代理。

### 5. 坐标归一化只做无损确定性映射

每页必须得到一基 `pageNumber`、正整数 `width/height` 和固定坐标系 `pixel-top-left`。服务坐标接受四点多边形或矩形，统一转换为 C12 声明的有限数值多边形；验证点位于 `[0,width] × [0,height]`，禁止取整修正、裁剪越界或猜测缺失尺寸。

区域按服务阅读顺序排序并生成稳定页内 identity；重复/缺失阅读顺序、重复页、缺页、空区域 identity 均失败。版面标签通过本地闭合映射表转换为 C12 类别；未知标签进入显式 `unknown`（仅当 C12 契约允许）或输出校验失败，不以字符串相似度猜测。

表格以页内表格区域为父对象。每个单元格必须提供零/一基规则明确的行列范围、`rowSpan/columnSpan`、页内坐标和 OCR 文本；行列范围正序，单元格多边形包含于表格边界。C13 不根据空白或文本排列推测合并单元格。服务只返回 HTML 而没有单元格坐标时，表格结构质量门失败，HTML 不作为结构事实。

### 6. 质量门由版本化策略驱动，固定样例只验证稳定语义

`OcrQualityPolicyV1` 作为 C12 转换策略的一部分或由其精确引用，C13 只消费：

- `requiredPageCoverage`：输入页完整性必须为 100%；
- `minimumNonEmptyPageRatio`、`minimumValidRegionRatio`、`minimumReadingOrderRatio`；
- `minimumMeanServiceConfidence` 与可选页面/区域最低置信度；
- `requireCompleteTableCells`；
- 验收清单专用 `minimumKeyFieldCoverage`。

实现不硬编码业务阈值。生产通用门只评估结构、置信度与非空覆盖；关键字段覆盖由验收 fixture 的版本化清单提供，清单项包含稳定字段 identity、规范化期望值和页/区域定位。比较只做 Unicode NFKC、首尾/连续空白规范化与全角半角归一，不做模糊猜词、LLM 修复或数值改写。每项输出 `passed/failed`、观测值、阈值和页/区域引用；失败保持原始响应/规范化候选工件，供 C15 后续判断，但不返回业务可用结果。

真实脱敏样例优先。仓库暂缺甲方样例时，提交最小合成中文 PDF、PNG、JPEG 和同一份机器可读验收清单，并标注“合成样例、待甲方复核”；甲方样例到达后通过新的 fixture/策略版本补充，不覆盖旧证据。

### 7. 错误闭合映射到 C12，技术诊断只进工件

C13 adapter 内部错误码固定为：

| code | retryable | 阶段 |
| --- | ---: | --- |
| `OCR_AUTHORIZATION_DENIED` | false | `authorization` |
| `OCR_INPUT_INVALID` / `OCR_MEDIA_TYPE_UNSUPPORTED` | false | `input` |
| `OCR_DEPLOYMENT_NOT_FOUND` / `OCR_DEPLOYMENT_MISMATCH` | false | `deployment` |
| `OCR_BUDGET_EXCEEDED` | false | `budget` |
| `OCR_SERVICE_UNAVAILABLE` / `OCR_SERVICE_RATE_LIMITED` / `OCR_TIMEOUT` | true | `service` |
| `OCR_PROTOCOL_INVALID` / `OCR_OUTPUT_INVALID` | false | `protocol` / `normalize` |
| `OCR_QUALITY_BLOCKED` | false | `quality` |
| `OCR_ARTIFACT_PERSISTENCE_FAILED` | true | `artifact` |
| `OCR_CANCELLED` | false | `control` |

它们确定性映射为 C12 闭合转换错误；HTTP 状态、服务 `errorCode`、堆栈和原始消息只写诊断工件。授权/不存在对外不可区分。相同 `(projectId, conversionKind, idempotencyKey)` 与规范化 strict payload 哈希重放原结果；同键异载荷冲突。可重试错误只能在原资料、部署、模型、策略、deadline 与资源引用内重试；取消不回滚已耐久工件。

### 8. OCR 与 llama.cpp 使用独立实例级并发状态

每个 OCR adapter 实例按 OCR `deploymentRef` 拥有自己的有界 semaphore、超时和请求控制器，不读取或复用 C05 网关的部署 Map、probe cache、AbortSignal、token 预算或并发状态。达到 OCR 并发上限时按 C12 策略返回限流/等待结果，不创建跨服务全局队列。

`resourceAllocationRef` 只引用 C37 管理的容器/CPU/内存/GPU 配额事实；C13 不解释或动态修改物理设备。确定性隔离测试同时启动 OCR 协议替身和 C05 llama.cpp 协议替身，令 OCR 饱和、超时、取消和崩溃，并证明 llama.cpp 调用仍只受自身配置影响。真实 smoke 在预置环境核对两种 deployment/resource refs 不相同；物理显存/容器配额与目标硬件压力证据在 C37 收口。

### 9. 工件、权限、日志和指标不形成第二套事实

原始响应使用 `diagnostic` 工件，C12 规范化候选/结果使用 `content` 工件；二者 parent refs 包含原始内容工件，evidence refs 关联资料版本/资料段能力允许的定位。写入命令继承请求授权中的空间与资料 grant，不允许扩大。C04 清单、哈希与访问审计是耐久事实，C13 不增加数据库表、审计表或事件。

允许低基数观测：按部署引用规范化标签、阶段、结果码的请求数与耗时，以及输入/响应字节、页、区域、单元格、质量指标和并发拒绝计数。禁止记录文件名、base64、OCR 文本、表格内容、原始服务消息、模型路径、完整 URL 或高基数工件 identity。日志失败不能把业务失败变成功；C04 工件/审计失败必须阻断成功。

### 10. 文件所有权与测试层次

实现前提是 C12 已归档且 `packages/adapters` 已存在统一文档转换出口。C13 只新增：

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

只在 C12 已有的 `packages/adapters/src/engineering-data/document-conversion/index.ts` 增加 OCR 导出；若 C12 package export 已覆盖目录则不改 manifest。禁止修改 `packages/contracts/**`、`packages/core/**`、`apps/**`、C11/C12 实现、数据库 migration、根 manifest、依赖政策、`pnpm-lock.yaml`、`openspec/config.yaml`、主 specs、归档或其它活动 change。

测试分三层：纯 Schema/映射表格测试；使用本地 HTTP 协议替身与 C04 临时工件存储的 adapter 行为测试；`RISKFLOW_OCR_SMOKE=1` 显式开启的真实服务 smoke。默认测试不启动服务，显式 smoke 缺少完整冻结配置、样例或服务时必须失败而非 skip/替身回退。

## Risks / Trade-offs

- [C12 接口尚未归档] → C13 实现任务以 C12 归档为硬前置，只消费其唯一接口；字段/所有权不一致立即升级，不创建兼容层或复制 Schema。
- [官方 Base64 协议放大内存与请求体] → 配置严格输入/响应上限并关闭图片返回；只有真实扫描资料超过上限时再评估服务侧分片，不预建代理。
- [服务版本无法由官方端点主动证明] → 由 C37 的受控部署清单和真实 smoke 提供精确版本证据，C13 记录引用且不声称自动探测；服务将来提供稳定元数据端点时另行演进。
- [PP-StructureV3 多模型组合可能随发行版变化] → 配置固定非空模型引用集合与管线配置摘要，任何升级形成新部署版本并重新 smoke，不使用“最新版”。
- [合成中文样例不能证明现场准确率] → 只用于结构、关键字段与错误回归，明确待甲方复核；C36/C37/C38 使用真实脱敏样例与目标硬件证据。
- [OCR 与 llama.cpp 可能共享同一物理 GPU] → C13 隔离软件状态并记录资源引用，C37 负责容器/设备配额和压力基准；未取得物理隔离证据时不宣称硬件隔离完成。

## Migration Plan

1. 主调度等待 C12 归档，确认统一转换 interface、规范化 DTO、错误联合、quality policy 与 adapter 出口符合 decision 1/6；不一致则先协调 C12/C13 规划，不进入生产实现。
2. 主调度完成 PaddleOCR/PaddleX 3.7.0 的依赖/许可证审阅并登记服务制品责任边界；C13 不修改 Node manifest 或 lockfile。
3. 实现 adapter 私有 Schema、配置、协议映射与协议替身测试，再接入 C12 出口；默认配置不启用任何服务，不提供云端地址或自动回退。
4. 由操作者预置内网服务、全部模型和资源清单后显式运行真实 smoke；结果只记录精确引用、指标和工件证据。
5. 部署回滚只移除 C13 adapter 装配或切回已验证的旧部署配置版本；既有 C04 工件、资料版本和段集合不删除、不覆盖。未知 OCR 版本的历史工件仍可按引用读取，但不得由旧 adapter 重新解释为新成功结果。

## Open Questions

无。统一接口所有权、OCR 服务基线、协议、Schema/工件/权限/错误/资源边界、文件范围和验证层次均已固定；C12 实际归档接口若与协调接缝冲突属于实现前置失败，由主调度协调而非实现 Agent 自行选择。
