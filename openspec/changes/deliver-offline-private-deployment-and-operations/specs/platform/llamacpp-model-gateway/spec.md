## RENAMED Requirements

- FROM: `### Requirement: 结构化生成必须经服务约束和本地 Zod 复验`
- TO: `### Requirement: 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验`

## MODIFIED Requirements

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

## ADDED Requirements

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
