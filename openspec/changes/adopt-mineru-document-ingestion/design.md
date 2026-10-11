## Context

基线 HEAD 为 0a25b6a469ade4bcc6a21c4514195d1f7c19ff31。当前工作区包含尚未提交的 C37 宿主、授权和配置包增量；本 change 保留这些增量，只修改转换接缝与宿主装配。上游依据为 MinerU 官网精准 API 文档和 mineru-4.0.12-released 的 task_api.py、output_files.md；官网消费字段以D-09的五类真实结果包冻结。

## Goals / Non-Goals

**Goals:** MinerU 作为 PDF/图片/DOCX 主转换器；保留 XLSX/CSV、权限与版本、原始证据、确定性规范化和审计；通过转换器真实功能及受影响回归收口，提供本机可复用服务和 CPU/GPU 补充基准。

**Non-Goals:** 通用 Qwen 替代 MinerU 专用 VLM、自动后端切换、额外业务 SDK、数据库迁移、自由 URL、修改共享 Python/npm 环境、GPU 采购、C37 全部业务验收、C38 最终交付硬件验收、提交或归档。

## Decisions

### D-01 接缝与格式所有权

公共转换 command/result/ref 保持不变。内部 OcrLayoutParser 接缝泛化为 DocumentServiceParserV1（request/outcome/raw-response/error 同组改名），options 使用 documentServiceParser。PDF/扫描 PNG/JPEG/DOCX 必须经过该接缝，缺配置明确失败；XLSX/CSV 只走现有 parser。服务 outcome 仍为 ParsedDocument、附加 C04 parents/evidence 和 JSON 诊断；不新增业务 DTO 或状态机。成功诊断对所有服务转换持久化，不再仅检查 ocr-layout。

### D-02 配置与身份

新增 mineru/schema.ts 定义 MineruConfigV1，schemaVersion=1、deploymentRef、qualityPolicyRef、resourceAllocationRef、protocol（official-v4/self-hosted-v1）、endpoint、credentialRef（官网必填，本地可 null）、allowedTransferOrigins、requestTimeoutMs、pollIntervalMs、maxPolls、maxConcurrentRequests、maxResponseBytes、qualityPolicy。qualityPolicy 包含 minNonEmptyPageRatio、minKeyFieldCoverage、keyFields（版本化配置内的字符串清单）；无 meanConfidence 硬门。三个引用与转换命令精确匹配。自托管 expectedProducerVersion 固定 4.0.12，模型/服务/资源精确证据由部署引用及 C38 清单冻结；云未披露构建/模型 revision 在诊断中 null。秘密注入 credentials map，配置只保存 secretId；现有受限 secret loader 读取，不复制到客户端/日志/响应。

DeploymentConfig documentConversion.ocr 替换为 mineru（可 null，用于尚未提供服务的配置预检，不代表业务就绪）。除 http localhost/内网自托管外，官网与 transfer URL 必须 HTTPS；地址无用户信息/fragment，origin allowlist 不接受路径。禁止 redirect、业务URL、自由参数和回调。

### D-03 官网与本地协议

官网 POST /api/v4/file-urls/batch，单文件 name 为受控转换ID加确定扩展名，data_id 为 conversionId，is_ocr 按扫描分支，model_version=vlm，table/formula开启，language=ch。要求 code=0、单 file_urls、非空 batch_id；PUT 字节到 allowlist 内签名URL，不带Bearer。GET /api/v4/extract-results/batch/{id}，精确核对 data_id/文件名和单条结果；waiting-file/pending/running/converting继续，failed失败，done仅在 full_zip_url 安全并完整下载后成立。

本地 POST /v1/tasks?filename=...&tier=standard|flash&ocr_mode=auto|ocr&output_formats=middle_json，raw bytes Content-Type 必须使用官方字节上传要求的application/octet-stream，Content-Length为实际输入长度；文件扩展名按已预检源类型固定，领域命令仍保留真实源媒体类型。GET /v1/tasks/{id}，completed 后 GET /result?response_format=json，必须单文件 completed 且 content.middle_json 存在；partial/failed/canceled/404/任务ID不符均失败。只消费 DocVortex Middle schema=docvortex.middle、schema_version=2.0、metadata.producer.version=4.0.12、is_full_document=true 和实际 tier。不得用服务提供的 status_url/result_url 绕过端点限制。

官网 ZIP 按冻结资源策略展开，安全包内路径、条目数量、压缩比/展开字节受限；只接受唯一 layout.json（或实测冻结的 Middle 文件），不靠相似文件名猜测格式。消费真实已确认的 Middle 格式；尚未被一手证据或实测证明的云输出格式必须严格失败并保持真实验收 task 未完成。官网支持字段冻结是独立证据 task，不以本地协议替身代替。

### D-04 资源、错误与耐久

现有 command.deadline 与独立 AbortController 合并控制全流程；每次请求也受 requestTimeoutMs，轮询受 maxPolls/maxConcurrentRequests、输入上限、输出流字节上限和转换页数/块数约束。输入格式/页数在上传前有界预检：PDF 使用现有 pdfjs 仅读取页数，不读取文字；PNG/JPEG 读取真实尺寸并防损坏，DOCX 复用安全 OOXML 检查；native spreadsheet 路由保留。

原始 HTTP 响应/ZIP 使用既有 persistRawResponse 保存受权 C04 envelope，并只解析回读字节；终态结果的服务身份、任务ID、统计、时间、质量指标与 missing confidence/cell geometry 的事实进入 normalization diagnostic。签名URL/token不进入trace。错误通过 DocumentServiceParserError 保存稳定 MINERU_* code、stage、retryable；429/5xx/网络/timeout可重试，结构/输入/部署/质量/取消/任务丢失不可重试。既有转换端口终态幂等保持：失败不自动再发任务；新的业务重试必须显式使用原输入/部署/预算，不制造远端恢复保证。

自托管取消/超时/失败在取得taskId后尝试DELETE当前task（独立有界清理timeout）；清理结果如实诊断，失败不伪装远端取消成功。官网终止等待，remoteCancellationConfirmed=false。不持久化第三套远端运行状态；重启/丢失明确失败，既有成功证据无需远端继续存在。

### D-05 规范化与实际证据粒度

内部施工接缝固定为 `preflightMineruSource(request): Promise<MineruSourceInfoV1>`，返回 `{pageCount?: number, pageExtents?: DocumentPageExtentV1[], docx?: ParsedDocumentV1}`；PDF预检只固定pageCount，结果PDF点尺寸从Middle取得，图片预检给出真实像素pageExtents。规范化入口 `normalizeMineruMiddle(middle: unknown, request, config, sourceInfo): {parsedDocument: ParsedDocumentV1, diagnostic: JsonValue}`。错误类复用 DocumentServiceParserError，无新公开业务字段。

共用 ParsedDocument SSOT 和 convertParsedDocument。DocumentPageExtent.coordinateSystem 扩展为 pixel-top-left/point-top-left。0基page_idx转1基；本地PDF从 extensions.docvortex_layout.pages 的 width_pt/height_pt 取得尺寸，normalized bbox缩放且检查有限/正向/0..1。图片从源字节真实像素取得尺寸，允许缺页尺寸元数据但不得伪造。禁止把归一化坐标直接当像素、忽略缺页/重复顺序/未知块格式。

有序 text/title/caption/formula 等块按闭合映射输出 paragraph/heading/caption，保留可提供文本；无正文的图片不冒充文字成功，未知有内容类别拒绝。table HTML 用已有 fast-xml-parser 的有界保序解析，禁止DTD/entity/script/外部访问；只接收已确认 table/tr/td/th 与文本/安全行内标记，验证 rowspan/colspan 正整数、有限行列、无重叠。table保存整体page coordinate，cell仅逻辑行列/span及table locator，服务未提供的confidence和percell bbox均省略并记 unavailable。

质量门：输入页完整性、page bbox与阅读顺序/表格结构的硬校验，非空页比例和版本化关键字段覆盖率阈值。关键字段不改写、不猜数值。默认样例标记“合成样本、待甲方复核”。

DOCX 使用源OOXML补结构元信息：复用有界解析获得段落/表格顺序、标题层级、图注、显式分页，把源结构与服务正文确定性关联。不得保存第二份正文事实；无法可靠关联则类型化失败。清除服务渲染page coordinate/pageExtents；源未给分页时不生成页号。保留源表格合并语义，以服务正文和逻辑cell填充。

### D-06 历史、事务、审计

复用C04/C06/C11及既有原子登记/转换记录，不新增迁移。新部署策略的转换使用C11正式资料新版本；单版本已登记段集合不原地替换。预置入口不得只是换conversionId重跑旧版本；操作者通过现有资料登记/版本入口后生成新的清洗/知识/双索引输入，旧转换、评估和工件保持不变。权限失败在打开原始工件/联系服务前收口，取消/质量失败不登记部分段。

### D-07 依赖、删除与所有权

不新增npm依赖：复用fetch/Zod、fflate、fast-xml-parser及pdfjs。替换后删除ocr目录Paddle生产文件与仅覆盖Paddle协议的测试；保留可复用扫描样本生成和权限/C04 latch（移至MinerU测试fixture），不得保留永久双后端。父负责schema/seam/部署/文档；有界实现worker可负责mineru新目录与对应测试、XLSX路径及原生解析测试，写集合不重叠。完整路径映射见施工图。

### D-08 分层验收和GPU部署

本 change 的产品验收为 MinerU 转换器：五格式真实内容/结构/定位/JSON-LD、冻结字段清单、质量失败、权限/幂等/取消/工件耐久与受影响回归。补充本机 CPU/GPU 实测报告，测量结果及限制，不预设性能数值。全仓 lint 修复纳入 IP-09；其它 change 的业务或全仓文档格式漂移单独报告，不作为转换器功能失败。最终检查点与独立 verification 仍按项目流程进行，功能 PASS 不代表已归档。

C37继续使用官网文档服务和MiniMax等已批准网络推理端点验完整功能/流程及可见界面，报告记录各服务实际身份和缺失值。C38交付主4090 24GiB/128GB RAM运行Qwen3.8-27B，辅助NVIDIA GPU运行MinerU专用模型。按服务明确设备UUID、CUDA/Vulkan实际backend和并发预算；CUDA_VISIBLE_DEVICES不证明Vulkan隔离。embedding保持独立192.168.13.11 Ollama qwen3-embedding:4b，迁移需另闭合资源预算。双服务共驻、目标卡性能、离线介质和许可由C38实测冻结；本机P4基准不替代这些证据。

## Risks / Trade-offs

官网布局与自托管2.0使用独立映射，供应商改变版本或结构时会明确失败。服务文字可能与DOCX原文不一致，结构补元信息必须可靠关联而不悄悄双正文。双卡资源隔离只能经目标机器取证证明；公开模型文件大小不等于显存。MinerU商业许可适用条件和所有制品许可由C38核查，不能凭本地部署宣称已获许可。

## Migration Plan

配置将ocr替换mineru；C37只替换文档装配引用和C38移交，不更改其它未提交增量。操作手册要求正式新资料版本，重新完成清洗/知识审核发布与双索引；历史结果原样可读。无数据库迁移；没有自动后端或历史正文重写。

## Open Questions

### D-09 官网实测结果格式（实施证据补全）

2026-10-11 使用环境中既有 MINERU_TOKEN 对 SYN-DEV/method-statement.pdf 发起单文件官网批次，POST/PUT/GET/download 均 HTTP200，code0，得到 layout.json；任务 batchId=f7519baf-dc19-4f4d-a527-dce57f25bf0b。实测布局版本 _version_name=3.4.4、_backend=hybrid，pdf_info[].page_idx/page_size/para_blocks[].bbox/index/type/lines[].spans[].content/score。官网消费分支只接受该冻结版本与结构，坐标是对应page_size单位的绝对值，不能按Middle2.0归一化坐标缩放；由单独 official-normalization.ts 校验并映射到共享 ParsedDocument 规范化。保持原始服务身份，不声称官网协议是DocVortex2.0。上传origin为https://mineru.oss-cn-shanghai.aliyuncs.com，下载为https://cdn-mineru.openxlab.org.cn；二者纳入示例allowlist。

同次对SYN-DEV扫描PDF、PNG、JPEG、DOCX取得done结果包：扫描PDF为13页hybrid布局，部分para_blocks或lines为空，保留全部页并按原质量策略判定；PNG/JPEG使用hybrid，源图片坐标按实际返回page_size与源像素比例缩放为pixel-top-left。image容器的blocks包含image_body（image span）及图注文本。DOCX的_backend=office，未给page_size/bbox，title可给level，table.blocks中的table_body通过lines.spans[type=table].html提供正文。只消费已确认的安全HTML和文本字段；DOCX渲染页不得用作源页，按D-05可靠源结构关联。未知结构拒绝；span score只记录是否存在，不推导块置信度。

真实云转换仍须经生产parser的耐久回读与质量门；直接HTTP探测不充当完整入库验收。C38实机、模型制品和许可输入为后续本地验收前置。

### D-10 原页输出与公式映射

官网 hybrid 的 `preproc_blocks` 是段落合并前的逐页块，存在时作为该页唯一规范化输入；不再并入同页 `para_blocks`，以免重复文字或把后页文字归到前页坐标。没有预处理块时仅允许不含跨页标记的 `para_blocks`；`lines_deleted` 或 span `cross_page` 出现而缺少原页块时以 `MINERU_PROTOCOL_INVALID` 拒绝，不能猜源页。保留空预处理页供质量门判断，不以段落块补造正文。DOCX 继续采用 office 段落及源 OOXML 结构，不生成渲染页。

冻结官网块 `interline_equation`、span `inline_equation/interline_equation` 的 content 字段，分别映射共享 `equation/equation_inline` 内容并保存原始 LaTeX。公式不执行、不计算、不剥除命令，也不推断成表格。复用已有去空白/忽略大小写的关键字段比较，仅比较识别出的原文，不改写正文、数值或 ID。未知有内容类别、非法几何、重复顺序和超过原预算仍拒绝。诊断注明所用逐页表示。

### D-11 文档投影修正与真实字段验收

修正 `_text_page`：非负 `insert_textbox` 返回值表示成功，按剩余页面空间在写行前分页；负值明确失败，不重复写已成功的行，也不丢弃最后一行。`write_scan_pdf` 从内存源页渲染，保持 150 DPI、无文本层。既有 synthetic-v1 文件不重生成；新增 `references/acceptance/mineru-v2/`，通过生成器 `--mineru-revisions <新目录>` 仅生成开发/试运行两组修正的文本 PDF 和扫描 PDF，以及文档修订清单。目录须新建，既有目标拒绝覆盖。

修订清单 `schemaVersion=1/versionId=2/label=合成样本，待甲方复核` 固定 sourcePack 和来源 cases，列出修订文件、源文档和历史文件路径。五格式 `samples` 每项包含 id、repo 相对 inputPath、inputKind、mediaType、expectedPageCount（DOCX 为 null）、非空 keyFields 和 recordChecks（fields 字符串列表、expectedPageNumber 或 null）。期望只来自既有 scenarios、生成器显式表格与源 DOCX/图片输入，禁止用 MinerU 输出生成答案。DEV/试运行修订 PDF 分别按真实源页记录全部地质行；五格式清单采用 DEV 修订 PDF、扫描 PDF 和既有 PNG/JPEG/DOCX，不复制未改变文件。旧 V1 扫描自检只验证容器、无文本层及墨迹，不用修正后的生成器重排旧文件作像素比较。

真实 smoke 可显式选择 `MINERU_SMOKE_SUITE=<清单>`；五项顺序运行同一生产 parser，各项冻结新 qualityPolicyRef、非空页比例1及关键字段覆盖率1。逐条检查同一块/同一表格记录的关联字段和源页、页数及共享 JSON-LD 合规；仅内容齐全、定位正确和合规均通过才记录 completed。报告保存受限原始响应、规范化与转换结果及验收计数，不输出正文/秘密，不充当生产数据库/C11验收。旧失败样本通过重放继续证明漏正文会被拒绝；修正样例不覆盖历史证据。

### D-12 本机固定服务与公平基准

本机基准为双路 Xeon E5-2697A v4（32核64线程）、125GiB可见内存和Tesla P4 8GiB；Docker/NVIDIA容器访问已检查。共享PyTorch 2.12.0+cu130未包含sm_61，不修改或复用该环境。固定服务采用MinerU 4.0.12、DocVortex 0.5.16、mineru-llama-cpp 0.1.3，保持现有V1 tasks/Middle2.0协议、PDF/图片Standard及DOCX Flash。运行依赖安装在独立Docker镜像，模型/配置/日志/上传数据保存在专属持久化目录，服务默认127.0.0.1:18000、restart unless-stopped、并发1，保留健康检查和明确启停/重启命令。CPU补充实例使用18001及独立上传目录，日常GPU服务可以暂停后顺序测量以减少干扰，验后恢复。

ONNX小模型两轮均明确CPU；专用VLM两轮使用同一MinerU2.5-Pro-2605-1.2B Q8_0 GGUF及mmproj，CPU轮明确MINERU_LLAMA_CPP_BACKEND=cpu且不暴露GPU，GPU轮明确vulkan并只暴露P4。0.1.3官方Linux wheel提供CPU/Vulkan、不提供CUDA；不引入vLLM/Torch或换Basic档位比较。显式GPU不可用/初始化失败应记失败，不自动CPU回退计GPU结果。记录native backend/offload日志、实际GPU进程/显存和ONNX providers；服务模型检查通过后以local源运行，测试过程中不自动下载或启动服务。

本地模型管理器读取已完成模型时仍写仓库锁，故模型目录只读、`.locks`子目录单独可写；锁不保存模型正文。NVIDIA Vulkan驱动通过容器运行时注入，镜像同时提供libvulkan1、libgl1和libegl1，避免仅能执行nvidia-smi而无法初始化Vulkan。两轮使用包含同一运行库的最终镜像。

基准复用V2五格式及同源5页扫描件真值，先校验质量再报告耗时；失败请求也保存耗时及错误码。模型下载/初始化与首请求独立于暖请求，固定并发1、同CPU配额/线程和输入，每个样例暖请求至少3次，报告逐次时间、中位数、页/分钟、峰值容器RAM/显存与CPU/GPU实际参与，保留镜像ID、依赖清单、模型来源/文件证据、硬件与资源设置。DOCX原生Flash不计VLM加速收益。性能结果仅代表本机P4和该组合，不外推4090、Qwen共驻或纯GPU全管线。

运行依赖用途、官方来源与退出条件：MinerU4.0.12负责本地文档V1服务（MinerU专有开源许可证）；DocVortex0.5.16负责Middle2.0转换结构（以发布制品LICENSE为准）；mineru-llama-cpp0.1.3负责专用VLM CPU/Vulkan引擎（以发布制品LICENSE及固定llama.cpp许可证为准）。官方源码来源分别为opendatalab/MinerU的mineru-4.0.12-released、myhloli/DocVortex的v0.5.16和opendatalab/mineru-llama-cpp的v0.1.3。安装前固化镜像/依赖解析证据，下载后固化模型证据并使用local源。移除本机服务时停其容器，不删除模型/历史结果；替换版本需新部署引用和重新验收。许可证核验结果如实记录，本机验证不作最终商业许可交付声明。
