# platform/llamacpp-model-gateway Specification

## Purpose

为 RiskFlow 提供唯一、可配置且可审计的 llama.cpp 模型调用边界，使结构化生成、向量化和会话流在权限、预算、原始响应工件与确定性校验约束下被后续智能推理模块安全复用。

## Requirements

### Requirement: 模型网关只暴露三项版本化能力

系统 MUST 通过一个协议无关的 V1 port 只暴露 `completeStructured`、`embed`、`streamConversation` 三项能力。每项请求 MUST 使用 strict Zod Schema，携带调用身份、业务幂等键、工程、发起主体、C02 冻结授权上下文、所需模块能力、精确模型部署引用、输入/提示或 Schema 版本引用、父工件/证据引用和有界资源预算；`AbortSignal` MUST 仅作为进程内控制参数传入，不得进入 DTO、工件、日志、事件或检查点。业务和领域模块 MUST 只依赖 core port，不得依赖 llama.cpp HTTP/SSE 结构。（RI-S51、RI-S53、RI-S57～RI-S59）

#### Scenario: 三项能力通过同一窄 port 调用
- **WHEN** 获授权调用方提交合法的结构化生成、Embedding 或会话流请求
- **THEN** 网关执行对应能力并返回该能力声明的类型化结果、受控流或结构化错误
- **AND** 调用方无需知道端点、SSE、模型别名或服务器响应格式

#### Scenario: 拒绝开放式模型调用
- **WHEN** 调用方尝试提交任意端点、模型名、URL、请求参数袋、工具定义、文件路径或契约外字段
- **THEN** strict Schema 在发出网络请求前拒绝输入
- **AND** 未声明参数不透传给 llama.cpp

#### Scenario: 取消信号不进入可持久化数据
- **WHEN** 调用方使用 `AbortSignal` 取消一个尚未终结的调用
- **THEN** 网关协作终止剩余网络与解析工作并返回取消错误
- **AND** 信号对象及其原因不进入 DTO、日志、工件元数据、Outbox 或检查点

### Requirement: 模型部署能力和尺寸由配置冻结

系统 MUST 从 composition root 冻结后端类型、网络协议、精确部署/服务身份、模型版本、受控基址、模型标识、能力、上下文、Embedding 维度和调用预算。`ModelGatewayDeploymentConfigV1Schema` 保持 `llamacpp` / `network-api` 后端判别；网络配置由同名 `NetworkApiDeploymentConfigV1Schema` 按 `protocol=openai-chat` / `ollama-embed` 进一步判别。llama.cpp MUST 复验实际构建、健康和运行元数据；网络 API MUST 复验各协议声明的服务与模型身份。不可观测供应商内部构建不得伪造；协议版本引用与证明须可追溯。请求须匹配精确部署，业务不得覆盖端点、模型或尺寸。

#### Scenario: 配置化部署调用成功
- **WHEN** 请求引用的冻结部署支持所需能力，所选后端的模型、协议和尺寸证据与冻结配置一致
- **THEN** adapter 使用配置中的模型别名和端点执行请求
- **AND** 结果只返回精确部署/版本引用与受控元数据，不返回模型路径或服务基址

#### Scenario: 业务不能选择模型名
- **WHEN** 业务请求尝试携带模型名、模型路径、URL 或覆盖部署参数
- **THEN** 请求 Schema 拒绝该字段
- **AND** 发送给所选后端的模型标识只能来自部署配置

#### Scenario: 部署能力或版本不匹配
- **WHEN** 请求部署不存在、能力未声明，或所选后端实际可验证的构建/协议、模型、上下文窗口或 Embedding 元数据与冻结配置不一致
- **THEN** 网关在模型生成前返回不可重试的部署/能力结构化错误
- **AND** 不切换到其它部署、不放宽窗口/维度，也不以配置值冒充实测值
### Requirement: 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验

`completeStructured` MUST 接收已版本化的提示消息、输出 Schema 引用及对应 Zod Schema。adapter MUST 从同一 Zod Schema 生成 JSON Schema。`openai-chat` 的部署 MUST 显式选择 `structuredOutputMode=server-json-schema|schema-prompt` 和 `reasoningEffort=low|medium|high|xhigh|max`；两项均无默认值。`server-json-schema` 仅可用于已有真实证据证明目标服务执行该 JSON Schema 约束的部署。`schema-prompt` MUST 把生成的 JSON Schema 放入 adapter 固定 system 消息。两种模式均须在正常终止后解析单个 JSON 值，并以调用方原 Zod Schema 严格复验；额外字段、非法 JSON、Schema 不符或截断均失败。不得提取局部字段、修补 JSON、重试或静默切换约束模式。C04 MUST 保留可审计的协议证据，但不得持久化或展示 MiniMax `reasoning_content`；原始响应正文受 C04 既有受保护权限范围约束，普通日志、界面和验收报告不得披露正文或思维内容。通过本地复验不替代 RI-S58 或任何领域校验。（RI-S51、RI-S57～RI-S59）

#### Scenario: 双重约束后的结构化结果成功
- **WHEN** `openai-chat` 正常终止并返回满足冻结结构化模式且通过原 Zod Schema 的单个结构化值
- **THEN** 网关返回类型化值、精确部署/提示/Schema 引用、使用量、终止原因和已耐久原始响应引用
- **AND** 下游仍按 RI-S58～RI-S59 执行字段统一、领域规则与仿真约束

#### Scenario: Schema 提示与本地严格复验
- **WHEN** 部署选择 `schema-prompt` 且模型返回单个正常终止 JSON 值
- **THEN** 固定 system 消息包含从同一 Zod Schema 生成的 JSON Schema，原 Zod Schema 决定最终接受或拒绝
- **AND** 不依赖模型遵循提示来替代本地校验

#### Scenario: 非法 JSON 结构失败
- **WHEN** assistant 正文不是单个可解析 JSON 值、含尾随正文、含额外字段或因长度限制被截断
- **THEN** 网关返回不可重试的结构错误并引用已耐久原始响应
- **AND** 不抽取局部字段、不修补 JSON，也不返回空对象作为成功

#### Scenario: Zod 复验失败
- **WHEN** JSON 可解析但不满足调用方原始 Zod Schema，包括缺字段、额外字段、类型、范围或 refinement 失败
- **THEN** 网关返回不可重试的 Schema 错误及受保护诊断/原始响应引用
- **AND** 不把服务端结构约束成功等同于业务输出有效

#### Scenario: 服务端 Schema 约束缺少证据
- **WHEN** 部署请求 `server-json-schema` 但没有真实证据证明目标服务执行该约束
- **THEN** 配置/就绪核验失败
- **AND** 不把服务接受请求或单次合规响应当作严格约束证明

#### Scenario: 输出 Schema 无法安全转换
- **WHEN** 调用方 Zod Schema 无法转换为支持的 JSON Schema 子集
- **THEN** 网关在网络调用前返回不可重试的 Schema 不支持错误
- **AND** 不退化为纯文本生成或依赖不完整提示继续执行

#### Scenario: reasoning 内容不进入持久化或展示
- **WHEN** MiniMax 响应含 `reasoning_content`
- **THEN** 该字段在 C04 持久化、API 返回、日志、界面和验收报告前剔除
- **AND** 可审计的协议证据和普通正文继续受各自原权限及 C04 保护范围约束
### Requirement: Embedding 输出保持顺序、数量和配置维度

`embed` MUST 接收非空、有界的文本序列和精确部署引用，使用配置化 Embedding 部署执行向量化。原始响应耐久保存后，adapter MUST 校验协议对象、输入索引全集、结果顺序、向量数量、每个元素为有限数值且每个向量长度严格等于冻结维度；不得归一化、截断、填充、重排或猜测缺失向量。（RI-S53）

#### Scenario: 有效批次返回确定维度向量
- **WHEN** llama.cpp 为每个输入返回唯一、连续索引和配置维度的有限数值向量
- **THEN** 网关按输入顺序返回向量、维度、部署/模型版本、使用量和原始响应引用
- **AND** 业务调用方不需要知道 Embedding 端点或模型别名

#### Scenario: 向量数量或维度不匹配
- **WHEN** 响应缺少、重复或重排索引，或任一向量的长度/数值不符合冻结配置
- **THEN** 网关返回不可重试的协议或维度错误并引用已耐久原始响应
- **AND** 不丢弃异常向量、不补零，也不返回部分批次成功

#### Scenario: 输入超过部署边界
- **WHEN** 文本数量、字节、token 或上下文需求超过请求预算或冻结部署上限
- **THEN** 网关在生成可消费向量前返回结构化预算/上下文错误
- **AND** 不拆分为未声明的多次模型调用或切换其它部署

### Requirement: 会话流只暴露受控文本增量

`streamConversation` MUST 返回由受控文本增量流和终态 Promise 组成的 handle。增量只能包含单调序号与 assistant 最终回答文本片段；adapter MUST 解析 UTF-8 SSE 边界、单一 choice、终止事件和 `[DONE]`，不得向调用方透传原始 SSE、未知字段、服务器错误正文、`reasoning_content`、内部思维链、工具调用或模型路径。终态 Promise MUST 仅在流协议完整、原始响应已耐久保存且使用量/终止原因校验完成后 resolve。

#### Scenario: 正常流只产生文本增量
- **WHEN** llama.cpp 返回合法 SSE，包含若干 content delta、终止原因和 `[DONE]`
- **THEN** 调用方只观察到有序文本增量，终态收据包含精确部署引用、使用量和已耐久原始响应引用
- **AND** 原始事件与 reasoning 字段仅存在于受权限保护的原始响应工件中

#### Scenario: 思维链字段不外泄
- **WHEN** 上游事件包含 `reasoning_content`、分析块或其它非 content 增量
- **THEN** 网关不把这些字段放入增量、终态、错误正文、日志、指标或审计
- **AND** 最终回答 content 仍只在完整协议与预算内按受控增量处理

#### Scenario: 断流不能伪装完成
- **WHEN** 网络正文异常结束、SSE 事件不完整、缺少终止原因或未收到 `[DONE]`
- **THEN** 增量流和终态 Promise 以结构化断流/协议错误结束，并在可能时引用已耐久的部分原始响应
- **AND** 不合成完成事件、不补写缺失文本，也不把已发出的增量当作正式完整回答

#### Scenario: 消费方提前停止仍需显式收口
- **WHEN** 消费方取消信号或提前关闭增量迭代
- **THEN** 网关停止继续暴露增量，收口已收到的有限原始字节，并使终态 Promise 以取消错误结束
- **AND** 下游不得在终态 Promise 成功前把会话结果提交为正式事实

### Requirement: 原始响应通过 C04 先耐久保存再返回引用

所有模型 HTTP/SSE 原始响应 MUST 作为 C04 受保护诊断工件保存，继承请求的工程、授权、空间、资料访问、父工件和证据限制。同步调用 MUST 在读取、解析或返回业务值前完成 `ArtifactStoreV1.put`，再通过经 EOF 完整性验证的 C04 `open` 读取有限内容；流式调用 MUST 以有界背压同时解析和写入，并且只有工件 `put` 成功后才能通过终态或错误返回其引用。任何持久化失败 MUST 阻止模型调用成功，不得把临时字节、路径、hash 或伪引用交给调用方。

#### Scenario: 同步响应先保存后返回
- **WHEN** llama.cpp 返回结构化生成或 Embedding HTTP 正文
- **THEN** 网关先取得 C04 原始响应诊断工件引用，再从经验证内容解析并构造结果
- **AND** 结果中的引用在返回时已经耐久、获授权且可完整读取

#### Scenario: 流式终态等待工件提交
- **WHEN** SSE 已完整结束但原始响应工件仍在提交
- **THEN** 增量可以已经被消费，但终态 Promise 保持未完成直至 C04 `put` 成功
- **AND** 工件失败会使终态失败而非返回悬空引用

#### Scenario: 失败流保存已接收原文
- **WHEN** 流在收到部分有限字节后取消、超时、断开或协议失败
- **THEN** 网关在可安全完成 C04 写入时保存该部分为同权限诊断工件，并仅在结构化错误中返回引用
- **AND** 日志、指标、Outbox 和检查点不复制部分正文

#### Scenario: 工件存储失败时 fail closed
- **WHEN** C04 无法保存或完整读取原始响应
- **THEN** 网关返回结构化工件持久化失败且不返回模型业务结果或会话成功终态
- **AND** 不以内存正文、临时文件或未登记 hash 绕过 C04

### Requirement: 取消、超时、无服务和协议失败使用闭合错误

系统 MUST 以闭合 ModelGateway 错误代码区分输入/授权、部署或能力、服务不可用、总超时、流空闲超时、调用取消、上下文超限、HTTP、协议、断流、JSON 结构、输出 Schema、Embedding 维度与工件持久化失败。错误 MUST 包含稳定代码、类别、可重试性、阶段、发生时间、调用/部署引用以及可用的诊断/原始响应引用；不得包含自由对象袋、完整上游 message、正文、URL、模型路径、密钥或思维链。映射到 C02 `ModuleErrorV1` 时 MUST 保留授权、幂等、可重试与终止语义，不得要求调用方匹配完整错误文案。

#### Scenario: 无服务返回结构化失败
- **WHEN** 配置端点拒绝连接、DNS/传输不可达或健康检查表明模型未就绪
- **THEN** 网关返回可重试的服务不可用错误和受保护诊断引用
- **AND** 不返回空结果、测试替身结果、缓存外结果或其它部署结果

#### Scenario: 总超时与空闲超时可区分
- **WHEN** 调用超过冻结总时限，或已开始的 SSE 在冻结空闲时限内没有新字节
- **THEN** 网关分别返回总超时或流空闲超时错误并终止相关读取
- **AND** 两者均不自动重发生成请求或扩大调用预算

#### Scenario: 上游错误正文不外泄
- **WHEN** llama.cpp 返回非成功 HTTP 状态或不符合预期的错误包
- **THEN** adapter 依据状态与闭合协议字段映射错误并把原始包保存为受保护工件
- **AND** 公共错误、日志和指标不复制服务器 message 或响应正文

#### Scenario: 上下文超限明确失败
- **WHEN** 精确 token 预检或 llama.cpp 协议证明输入与最大输出超过冻结上下文窗口
- **THEN** 网关返回不可重试的上下文超限错误及受控计数
- **AND** 不静默截断消息、减少证据、改用更大窗口或切换模型

### Requirement: 授权、幂等与预算只能被下游收窄

网关 MUST 在网络与工件副作用前校验请求工程/主体与授权上下文一致，所需 C02 模块能力已授予，父工件可由 C04 继承且部署引用精确。调用身份和业务幂等键 MUST 派生原始响应工件命令身份；网关不得自动重试生成调用。相同业务步骤恢复时，工作流 MUST 优先复用已记录的原始响应/正式结果引用而非再次调用；同键不同原始响应由 C04 幂等冲突阻止静默替换。请求的最大输入、最大输出、deadline 与批量上限 MUST 等于或小于冻结部署和上层任务预算，结果 MUST 返回实际 usage 或明确表示上游未提供。

#### Scenario: 未授权调用在网络前拒绝
- **WHEN** 请求工程/主体不一致、所需能力未授予，或父工件访问范围不能安全继承
- **THEN** 网关在联系 llama.cpp 前返回不可重试授权错误
- **AND** 不产生模型响应、原始响应工件或其它副作用

#### Scenario: 请求预算不能扩大部署预算
- **WHEN** 调用方请求的 deadline、输入、输出或批量规模超过冻结部署或上层任务允许值
- **THEN** 网关在网络前拒绝预算扩大
- **AND** 不采用部署默认无限值或服务器隐式截断

#### Scenario: 不自动重试非幂等生成
- **WHEN** 生成请求发生可重试传输或超时错误
- **THEN** 网关返回原调用身份和结构化错误，由上层冻结重试策略决定后续动作
- **AND** adapter 本身不再次调用、换模型、换部署或改变采样策略

#### Scenario: 已完成调用由上层复用引用
- **WHEN** 工作流恢复时已经持有成功原始响应或正式结果引用
- **THEN** 上层按 C02 阶段/检查点契约复用该引用而不重新调用网关
- **AND** C05 保持调用身份、工件幂等键和版本元数据足以完成追溯

### Requirement: 日志指标和审计不泄露模型正文

网关 MUST 只记录低基数的能力、受保护部署引用、阶段、结果代码、耗时、字节/token 计数和是否存在原始响应引用；不得记录请求消息、提示、assistant 正文、Embedding、原始 SSE/HTTP、错误 message、模型路径、URL、认证头、工件内容或思维链。原始响应和有限诊断只通过 C04 权限继承工件保存；C04 工件登记/读取审计与 C08 后续 Agent 工具行动审计共同构成接缝，C05 不新增第二套审计事实源。

#### Scenario: 成功调用只产生受控遥测
- **WHEN** 任一模型能力成功完成
- **THEN** 指标和日志只包含声明的低基数维度与数值计数
- **AND** 完整协议响应只能通过获授权的 C04 引用读取

#### Scenario: 失败调用不记录上游正文
- **WHEN** 调用因协议、Schema、断流或服务错误失败
- **THEN** 日志只记录稳定错误代码、阶段和受保护引用存在性
- **AND** 诊断正文、部分生成或服务器 message 不出现在日志/指标/Outbox/检查点

### Requirement: 测试替身和真实 llama.cpp smoke 分层验收

系统 MUST 用仅在测试目录的协议与工件替身覆盖请求映射、持久化、结构/向量/流校验、取消、超时、授权、幂等与预算，不导出生产 Mock 或假回退。C37 MUST 显式运行网络三能力 smoke：MiniMax `openai-chat` 完成结构化生成与会话流，Ollama `ollama-embed` 完成 Embedding，并各自满足冻结身份、预算及 C04 证据契约；缺服务或关键 skip 非零失败。真实 llama.cpp smoke MUST 保留，由选择本地后端的验收或 C38 最终部署执行；任一 smoke 均不自行下载模型或启动服务。

#### Scenario: 测试替身不进入生产导出
- **WHEN** 单元与协议测试使用脚本化 fetch、SSE 和工件行为
- **THEN** 替身只位于 `packages/**/test/model/**`，生产 exports 不可导入
- **AND** 测试断言稳定代码、结构、顺序和引用，不锁定完整错误或提示文案

#### Scenario: 真实服务走通三项能力
- **WHEN** 验证者显式提供真实 llama.cpp 构建、聊天部署、Embedding 部署和 C04 测试存储
- **THEN** smoke 实际完成 Zod 结构化输出、配置维度向量和含终态收据的会话流
- **AND** 每次成功均产生可完整读取的 C04 原始响应引用

#### Scenario: 真实服务不可用不会被跳过为成功
- **WHEN** smoke 已显式启用但任一配置服务不可达或部署元数据不匹配
- **THEN** smoke 断言对应结构化失败并以非零测试结果暴露未满足的验收条件
- **AND** 不改用协议替身、其它端点或跳过测试冒充真实验收

#### Scenario: 当前网络 API 形成三能力证据
- **WHEN** 验证者提供 MiniMax 聊天部署与凭据、Ollama Embedding 部署、C04 与明确启用的网络 API smoke
- **THEN** 实际完成结构化输出复验、冻结维度向量及完整流终态，每次成功均有耐久原始响应引用；本地 llama.cpp/GPU 缺席不阻塞该功能验收

### Requirement: 网络 API 必须保持原网关的授权预算与证据契约

网络 API MUST 经同一三能力模型 port 调用，并遵循冻结部署、主体授权、资料资格、C04 响应引用、闭合错误、幂等及硬预算契约。客户端与业务不得覆盖模型、端点或协议；身份或能力不符时拒绝调用，不得自动重试生成、切换模型或放宽校验。使用量与预算依据须如实记录，无可靠依据时不得声明就绪；联网模式不得扩大资料授权。

#### Scenario: 合法联网后端被业务复用
- **WHEN** 冻结部署具备所需能力，当前主体获授权且请求在预算内
- **THEN** 业务取得原类型化结果及精确部署/模型/协议版本和耐久响应引用，P/C、矩阵与阈值仍由原确定性模块执行
- **AND** `openai-chat` 仅访问冻结 HTTPS endpoint，并由服务器按必填 `credentialRef` 加载 Bearer 凭据；`ollama-embed` 不配置凭据，仅访问明确批准的 `http://192.168.13.11:11434`，通过原生 `/api/embed` 且设置 `truncate=false`
- **AND** Ollama 部署固定为 `qwen3-embedding:4b`、版本 `0.40.0`、digest `df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907`、context 40960、维度 2560；必填 `expectedModelDigest` 与 `expectedServerVersion` 分别依据 `/api/tags`、`/api/show` 和 `/api/version` 复验

#### Scenario: 无权资料或秘密进入客户端
- **WHEN** 输入资料不具备联网验收资格，或请求试图携带 API 凭据、任意 URL 或模型覆盖
- **THEN** 在网络副作用前拒绝，秘密不进入 Web、Desktop、日志、DTO 或发布包

#### Scenario: 网络协议失败保持原错误边界
- **WHEN** 上游拒权、限流、超时、断流、结构化约束不支持、向量尺寸或部署身份不符
- **THEN** 返回原闭合模型错误与可用耐久诊断，不补造结果、不透传未授权上游正文、不自动改协议或重发生成

#### Scenario: 后端切换不得复用旧向量空间
- **WHEN** 操作者切换网络 API 与 llama.cpp，或改变 Embedding 模型、版本或维度
- **THEN** 必须形成新部署版本及对应检索代际，按原构建和质量门禁激活，不混用旧向量空间或改写历史结果
