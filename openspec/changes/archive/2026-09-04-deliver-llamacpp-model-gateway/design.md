## Context

见 `proposal.md` 的动机和 `specs/platform/llamacpp-model-gateway/spec.md` 的行为契约。当前基线为 Node.js 24、TypeScript 5.9、Zod 4.5.4；C02 已冻结授权上下文、模块能力、版本引用、工件引用和 `ModuleErrorV1`，但代码与归档规格中均不存在 `ModelGatewayPortV1` 或模型协议 DTO。C04 实现提供 `ArtifactStoreV1.put/open`：文件字节先耐久、清单/审计后提交，读取必须消费到 EOF 并等待 `verified`。

路线固定 C05 拥有 model adapter，只提供 `completeStructured`、`embed`、`streamConversation`。后续 C08/C19/C20/C22/C27/C29 依赖这条边界；C05 不能把 llama.cpp 协议、模型名或原始正文扩散到业务模块，也不能替代 RI-S56 上下文组装、RI-S58 修复/领域 Schema 或 RI-S59 规则/仿真校验。

llama.cpp 官方 server 文档声明 `/health`、`/props`、`/v1/models`、`/v1/chat/completions`、`/v1/chat/completions/input_tokens` 与 `/v1/embeddings`，聊天端点支持 SSE 和 schema-constrained JSON；官方同时明确其 OpenAI 兼容性不是强保证。C05 因此按配置的精确 `build_info` 绑定一个受控协议子集，不依赖第三方 OpenAI SDK。[llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

C04 change 已通过实现合并进入本分支 base `3d193e9`，但仍未归档。规划可以引用当前代码和 change；C05 实现门必须等待 C04 归档并按新建主 spec 复核，防止以下游活动 change 代替正式依赖。

## Goals / Non-Goals

**Goals:**

- 建立单一、深层且协议无关的 core 模型 port，调用方只有三项能力和稳定错误。
- 用配置化、精确版本的 llama.cpp adapter 承担协议、部署、上下文、流、取消和输出校验。
- 让任一返回的原始响应引用都已由 C04 耐久登记，并继承输入权限与证据。
- 将模型调用结果限定为可由后续领域模块确定性复验、审计和恢复的最小数据。
- 使用现有依赖与 Node 原生能力完成；测试替身只服务确定性协议测试，真实 smoke 证明实际服务路径。

**Non-Goals:**

- 不拥有模型部署生命周期、制品下载、GPU/slot、量化、LoRA 或离线安装。
- 不拥有 Agent 任务、RI-S56 上下文、提示模板正文、标准化风险记录、规则/仿真校验或正式结果持久化。
- 不支持任意 OpenAI 参数、tools/function calling、多模态、rerank、外部 URL 内容或自动兼容不同 server build。
- 不新增数据库、Outbox 事件、审计表、HTTP API、Worker 装配或 UI。
- 不提供生产 Mock、模型回退、缓存回答或“无服务成功”。

## Decisions

### 1. C02 无模型 port，C05 在 core 定义 adapter port

仓库搜索确认 C02 只冻结六领域模块、Agent、工作流和投影 interface；没有 `ModelGatewayPortV1`、`completeStructured`、`embed` 或 `streamConversation`。C05 新增：

```text
packages/core/src/model/schema.ts
packages/core/src/model/gateway.ts
packages/core/src/model/index.ts
```

`packages/contracts/**` 保持不变。core 复用 `@riskflow/contracts/common` 与 `@riskflow/contracts/ports` 的版本、授权、能力、工件、证据及错误类型；adapter 只通过 `@riskflow/core/model` 和 `@riskflow/core/artifacts` 公共子路径依赖 core。

被否决：把基础设施 port 放进 contracts。C02 的 contracts 是跨领域稳定契约，C05 只需要可替换的进程内 adapter seam；改 contracts 会违反 G0 契约闸门并迫使无关业务理解模型协议。

### 2. port 固定三个方法，AbortSignal 与 Zod Schema 是进程内参数

目标形态：

```ts
interface ModelGatewayPortV1 {
  completeStructured<T>(
    request: StructuredCompletionRequestV1,
    outputSchema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>>;
  embed(request: EmbeddingRequestV1, signal?: AbortSignal): Promise<EmbeddingResultV1>;
  streamConversation(
    request: ConversationRequestV1,
    signal?: AbortSignal,
  ): ConversationStreamHandleV1;
}
```

`ConversationStreamHandleV1` 只含 `deltas: AsyncIterable<ConversationTextDeltaV1>` 与 `completed: Promise<ConversationReceiptV1>`。消费方必须等待 `completed` 成功后才能把完整会话用于正式事实。公开请求/结果/错误为 strict Zod；泛型结构化结果通过 `structuredCompletionResultSchema(outputSchema)` 工厂保持运行时与静态类型同源。

`AbortSignal` 和 `ZodType` 不是可序列化 DTO，不进入工件、事件或检查点。Zod Schema 同时配有 `outputSchemaRef`；ref 用于重放/审计，实际 Schema 用于当前进程校验。两者一致性由拥有 Schema 的后续模块负责，C05 不建立第二套 Schema registry。

被否决：通用 `invoke`/`request` 方法或任意参数袋。三项能力的输入、输出、失败和资源形态不同，开放接口会把模型厂商协议扩散到业务层。

### 3. 公共请求以一个严格调用基座复用 C02 值对象

`ModelInvocationBaseV1Schema` 包含：

- `schemaVersion: "1"`、`invocationId`、`idempotencyKey`、`issuedAt`；
- `projectId`、`actorId`、完整 `AuthorizationContextV1`、`requiredCapability`；
- `modelDeploymentRef`、`budgetPolicyRef`、`deadlineAt`；
- 排序去重的 `parentArtifactRefs` 与 `evidenceReferences`。

结构化请求增加 `promptTemplateRef`、`outputSchemaRef`、受控 `system/user/assistant` 文本消息、`maxOutputTokens`；Embedding 请求增加非空文本数组和批量/输入上限；会话请求增加版本化会话/提示引用、消息与 `maxOutputTokens`。不接受 URL、模型、temperature、top-p、grammar、tools、文件路径或自由 metadata。采样策略固定在部署配置；将来确有多策略需求时另开版本化策略 change。

所有请求先验证：请求 project/actor 等于 authorization；授权包含 requiredCapability；deadline 尚未过期且不扩大部署/上层预算；父引用交给 C04 继承验证。C05 不解释角色，也不增加模型专用 capability 枚举。

### 4. llama.cpp 部署配置留在 adapter，业务只传 deployment ref

`packages/adapters/src/model/config.ts` 定义 strict `LlamaCppDeploymentConfigV1Schema`。每项至少固定：

```text
deploymentRef
serverBuildRef + expectedBuildInfo
modelVersionRef + modelAlias
baseUrl
capabilities[]
contextWindowTokens
embeddingDimensions?       # embed capability 时必填，其他部署不得伪造
requestTimeoutMs
streamIdleTimeoutMs
maxResponseBytes
maxInputBytes / maxBatchItems / maxOutputTokens
samplingPolicy             # 仅允许设计中列出的闭合字段和值
```

`baseUrl` 只允许 composition root 注入的 `http:`/`https:` origin，禁止凭业务输入拼接；adapter 使用固定相对端点且 `redirect: "error"`。`modelAlias` 必须是 `--alias` 暴露的非路径标识，防止 `/v1/models` 默认返回宿主模型路径。配置解析后深冻结并按 `deploymentRef` 建只读 Map；重复 ref 或能力与尺寸不一致在构造时失败。

首次调用某部署时，adapter 用 `/health`、`/props`、`/v1/models` 校验 ready、`build_info`、别名、运行 `n_ctx` 与 `n_embd`。验证成功可在当前 adapter 生命周期缓存；任一传输/协议失败使缓存失效，下次调用重新验证。完整 `/props` 不记录、不返回，尤其丢弃 `model_path`、chat template 和 slot 内容。

被否决：模型名常量、环境变量自读取或业务请求模型字段。部署装配属于应用/运维边界；C05 adapter 只执行已注入配置。

### 5. 使用 Node 24 原生 fetch 和流，不增加 SDK

adapter 使用全局 `fetch`、`ReadableStream`、`AbortController`/`AbortSignal`、`TextDecoder` 与 `URL`。factory 接受可选 `fetchImpl` 仅用于测试注入；生产默认全局 fetch。`AbortSignal.any` 组合调用方取消、请求 deadline 和配置总超时；独立 idle controller 在流每次收到字节时重置，因而能区分总超时与流空闲超时。

不使用 OpenAI SDK：它会增加依赖、隐藏原始字节/错误/SSE 边界，并不能消除 llama.cpp 非强兼容性。不使用 EventSource：浏览器接口不支持所需 POST body/控制，也不利于精确保存响应字节。

adapter 不对生成请求自动重试。连接失败、503、超时或断流返回带原 invocation 的错误；C08 后续在冻结 retry/budget 下决定是否新尝试，且工作流已有成功引用时直接复用，不再调用。

### 6. 每次聊天请求先做精确 token 预检

结构化与会话请求先调用固定 `/v1/chat/completions/input_tokens`，对与实际生成相同的 messages/model payload 计数；`input_tokens + maxOutputTokens` 必须不超过 deployment `contextWindowTokens`。Embedding 使用 llama.cpp tokenizer/Embedding 协议提供的计数能力逐项验证，受 `maxBatchItems` 与总输入字节限制；若配置 build 不支持可靠计数则该部署不能声明对应能力，禁止用字符数近似后继续。

token 预检与生成共享同一总 deadline，不另行扩容。预检响应只含计数，不作为模型原始生成响应；其错误仍经过闭合协议映射。若上游生成阶段仍报告上下文错误，映射同一 `MODEL_CONTEXT_EXCEEDED`，不依赖完整 message 字符串决定路由。

被否决：静默截断、自动删证据或字符/4 估算。RI-S56 五项上下文不能由基础设施 adapter擅自改变。

### 7. completeStructured 以 Zod 为最终事实源

调用顺序：

1. strict 请求、授权、能力、预算、部署和 token 预检；
2. `z.toJSONSchema(outputSchema)` 生成约束；不可转换或包含 server build 不支持的结构则在网络前 `MODEL_SCHEMA_UNSUPPORTED`；
3. POST `/v1/chat/completions`，模型别名来自部署配置，`stream=false`，`response_format` 使用 schema-constrained JSON，并显式关闭 reasoning；
4. 把 HTTP body 原始字节直接作为 C04 `artifactKind=diagnostic`、`purposeCode=model-raw-response` 保存；
5. `ArtifactStoreV1.open` 重新读取该 ref，在 `maxResponseBytes` 内收集，消费 EOF 并等待 `verified`；
6. 以内部外部协议 Zod 校验 response/error envelope；成功必须恰有一个 choice，finish reason 为完整终止；
7. 对 `message.content` 做单个 JSON 值解析，拒绝 markdown fence、前后正文和截断；
8. 用原 `outputSchema.parse` 复验；成功结果包含已解析值、deployment/prompt/schema refs、usage、finish reason 和 raw ref。

llama.cpp 的 JSON Schema/grammar 负责约束采样，Zod 负责本地信任边界。它们不取代 C22 对 `ModelOutputResultSchema`、证据、规则和仿真约束的确定性收口。

### 8. embed 必须整批闭合校验

adapter POST `/v1/embeddings`，固定 `encoding_format=float`，模型别名来自配置。原始 HTTP body按 decision 7 先保存、再从 C04 经验证读取。内部协议校验只消费所需字段并允许 pinned build 的文档化附加字段；data 必须覆盖 `0..n-1` 且无重复，排序后按输入顺序返回。每个 vector 长度等于 `embeddingDimensions`，全部值 `Number.isFinite`。

任一条目失败则整批 `MODEL_EMBEDDING_INVALID`；不返回部分向量。C05 不归一化或量化，C20 负责索引代际和向量投影。

### 9. streamConversation 使用有界背压扇出和双完成信号

adapter POST `/v1/chat/completions`，`stream=true`、`stream_options.include_usage=true`，显式关闭 reasoning。网络每个 `Uint8Array` 只经过一个有界单槽扇出：一端进入 C04 `put` 的 async iterable，另一端由增量 SSE parser 消费；生产速度受更慢一端背压，不能无界缓存整流。

SSE parser 使用增量 `TextDecoder`，限制单事件和累计响应字节，只接受 UTF-8 `data:` 事件、单 choice、单调 chunk、允许的 `delta.content`、终止 reason、usage 和精确 `[DONE]`。它输出 `ConversationTextDeltaV1 { schemaVersion, sequence, text }`；空文本、reasoning、tool calls、未知对象不向调用方输出。若 pinned 协议出现不允许的改变，返回协议失败而非透传。

`completed` 只有在以下都成立时 resolve：parser 见到合法 finish reason 和 `[DONE]`；网络正常 EOF；C04 `put` 已提交；usage/字节预算合法。消费方提前取消时，停止 delta、关闭网络，终态 reject。断流或取消时，把已经进入单槽扇出的字节流正常封口为同权限诊断工件；若 C04 也失败，则主错误升级为 `MODEL_ARTIFACT_PERSISTENCE_FAILED` 并保留原稳定阶段代码作为诊断元数据，不返回伪 ref。

增量已经展示不等于业务成功。正式会话/Agent 结果只能在 `completed` 成功后引用。

### 10. C04 统一保存原始响应和有限诊断

所有原始响应使用 diagnostic artifact，避免被误当作领域内容；ref 仍为 C02 `DiagnosticArtifactRefV1`。C04 command 使用：

- `commandId`/`idempotencyKey` 从 invocation 精确派生；
- `projectId`、`actorId`、authorization、requiredCapability 原样复用；
- `artifactId` 由调用 identity 与响应类别确定，不含模型名或正文；
- `parentArtifactRefs`、`evidenceReferences` 原样传给 C04，附加范围不得扩大；
- `mediaType=application/json` 或 `text/event-stream`；
- `purposeCode` 为闭合的 raw-response/partial-response/diagnostic 用途。

同步响应绝不先解析再决定是否保存；这保证非法 JSON/Schema 也有原始证据。服务完全不可达时没有原始响应，adapter 保存一个不含 URL/message/凭据/正文的有限诊断 JSON；授权在调用前失败时不尝试以未授予能力写工件，直接映射 C02 `AUTHORIZATION_DENIED`。

C05 不新增审计表：C04 已对 put/open 形成不可变审计；C08 后续记录 Agent 工具行动和预算。结果与错误的 invocation/deployment/raw/diagnostic refs 连接两者。

### 11. 闭合错误与 C02 映射

`ModelGatewayErrorV1Schema` 固定：`code`、`category`、`retryable`、`stage`、`occurredAt`、`invocationId`、`modelDeploymentRef`，以及可选 `rawResponseRef`、`diagnosticRef`、有限计数。首版错误族：

```text
MODEL_INPUT_INVALID                 terminal
MODEL_AUTHORIZATION_DENIED          authorization
MODEL_DEPLOYMENT_NOT_FOUND          terminal
MODEL_CAPABILITY_UNAVAILABLE        terminal
MODEL_DEPLOYMENT_MISMATCH           terminal
MODEL_SCHEMA_UNSUPPORTED            terminal
MODEL_CONTEXT_EXCEEDED              terminal
MODEL_SERVICE_UNAVAILABLE           transient
MODEL_REQUEST_TIMEOUT               transient
MODEL_STREAM_IDLE_TIMEOUT           transient
MODEL_ABORTED                       cancelled/terminal
MODEL_HTTP_ERROR                    transient only for configured status class
MODEL_PROTOCOL_ERROR                terminal
MODEL_STREAM_INTERRUPTED            transient
MODEL_STRUCTURE_INVALID             terminal
MODEL_OUTPUT_SCHEMA_INVALID         terminal
MODEL_EMBEDDING_INVALID             terminal
MODEL_ARTIFACT_PERSISTENCE_FAILED   follows C04 retryability
MODEL_IDEMPOTENCY_CONFLICT          idempotency/terminal
```

不把上游 message 放入 error。HTTP retryability 仅按状态/传输类别映射，例如 408/429/502/503/504 可重试，其它 4xx 终止；未知/非法错误包为 protocol terminal。上下文由预检计数确定，不以脆弱 message 字符串匹配。

`mapModelGatewayErrorToModuleError` 复用 C02：授权→`AUTHORIZATION_DENIED`；C04 幂等→`IDEMPOTENCY_CONFLICT`；可重试技术错误→`TRANSIENT_FAILURE`（由上层提供 attempt/retryPolicyRef）；其它运行失败→`TERMINAL_FAILURE`；未知 schema version→`UNSUPPORTED_CONTRACT`。取消不伪装可重试故障。

### 12. 测试分三层，不把 Mock 做进生产

1. `packages/core/test/model.test.ts`：表驱动验证 strict 请求/配置无关结果/错误、授权一致性、预算收窄、泛型 Schema 工厂和 C02 错误映射。
2. `packages/adapters/test/model/llamacpp-model-gateway.test.ts`：使用 test-only scripted `fetch` 与 test-only `ArtifactStoreV1` 替身，能用 latch 证明 `put` resolve 前同步结果/流终态不 resolve；覆盖配置、探测、token 预检、原始字节、JSON/Zod、Embedding、SSE UTF-8 分块、reasoning 隔离、取消/超时/断流、无服务与无内部重试。替身不进入 production exports。
3. `packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts`：仅在 `RISKFLOW_LLAMACPP_SMOKE=1` 时读取测试专用配置，连接操作者已启动的真实 chat 与 embedding llama.cpp（可为一个 router 或两个服务），并使用 C04 真实临时目录/PostgreSQL fixture 保存响应。显式启用后缺配置、服务不可达、build/alias/尺寸不符必须失败；测试自身不启动、下载或停止服务。

smoke 固定执行：一个简单 Zod strict object；一个至少双输入的 Embedding 批次；一个包含多 delta 与成功终态的会话；一个明确不可达端点的 `MODEL_SERVICE_UNAVAILABLE`。报告记录 build/deployment/model version refs、context、dimension、usage 和 artifact refs，不记录模型名、提示或正文。

### 13. 可观测性只保留低基数元数据

允许指标：按 capability/stage/result 的请求数、耗时、输入/输出 token、响应字节、delta 数、取消/总超时/idle 超时、Schema/协议/维度/工件失败。部署使用受保护 deployment ref 或规范化低基数标签，模型名、URL、hash、artifact id 不做高基数指标。

日志只记录 invocation、受保护部署 ref、阶段、稳定 code、计数和 raw/diagnostic ref 是否存在；不得记录提示、messages、content、vector、原始响应、上游 error message、model_path、baseUrl、headers 或 Abort reason。C05 不保存或展示模型内部思维链。

### 14. 文件所有权和禁止区

实现允许新增：

```text
packages/core/src/model/schema.ts
packages/core/src/model/gateway.ts
packages/core/src/model/index.ts
packages/core/test/model.test.ts

packages/adapters/src/model/config.ts
packages/adapters/src/model/llamacpp-model-gateway.ts
packages/adapters/src/model/index.ts
packages/adapters/test/model/fixture.ts
packages/adapters/test/model/llamacpp-model-gateway.test.ts
packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts
```

主调度 Agent在 planning checkpoint 后串行修改：

- `packages/core/package.json`：新增 `./model` export；
- `packages/adapters/package.json`：新增 `./model` export。

删除文件为零。实现 worker 禁止修改 package manifests、`packages/contracts/**`、`packages/core/src/{persistence,access,artifacts}/**`、`packages/adapters/src/{postgres,auth,artifacts}/**`、所有 C03/C04 migration、`apps/**`、`demo/**`、根配置/清单、依赖政策、锁文件、主 specs、归档 change 和其它活动 change。

### 15. RI/RA 与责任边界追踪

| 来源 | C05 提供 | 下游仍负责 |
| --- | --- | --- |
| RI-S51 | deployment/prompt refs、配置化模型、结构化调用 | C21/C22 的实际提示模板及五项上下文指令 |
| RI-S53 | `embed` 与精确 model/dimension refs | C20 双索引、向量代际与相似度 |
| RI-S57 | `completeStructured`、原始响应、usage、Zod 复验 | C22 绑定工序、形成模型输出候选 |
| RI-S58 | JSON/Zod 技术边界、结构化失败 | C22 缺失字段补全、字段统一、领域 Schema、复核路由 |
| RI-S59 | 保留原始响应和确定性校验接缝 | C22 风险机理/规范/仿真校验与置信度修正 |
| RA-S3/RA-S7 | 后续可复用结构化生成 | C19 评分规则语义与 C27 处置候选/三项校验 |
| C02 | auth/version/artifact/module error refs | 模块命令、工作流阶段、成功引用和恢复判断 |
| C04 | raw/partial/diagnostic bytes 与权限审计 | 原子文件/清单、完整性、读取授权 |

## Risks / Trade-offs

- **llama.cpp OpenAI 兼容接口会变化** → 绑定精确 build、首次探测、内部协议 Schema 与真实 smoke；不承诺跨 build 兼容，升级另开 change 或更新配置+验证。
- **同步调用先保存后重读增加一次本地 I/O** → 换取非法响应也可追溯且严格满足先耐久；C04 为本地内容寻址存储，只有实测成为瓶颈才优化为同时持久化/有界解析。
- **流式增量在终态持久化前已可见** → 以双完成信号区分“展示中的增量”和“可提交的完整结果”，下游只在 `completed` 成功后形成正式事实。
- **消费者取消时只持久化部分上游响应** → 明确标为 diagnostic/partial，错误而非成功引用；不尝试补全或恢复正文。
- **精确 token 预检增加一次请求** → 避免基础设施静默截断 RI-S56 上下文；单槽 MVP 优先正确性，性能由后续真实基准决定。
- **无自动重试降低瞬时成功率** → 生成副作用非天然幂等；把重试决定留给 C08 冻结预算/策略，并通过已完成引用避免重复模型步骤。
- **测试 smoke 依赖外部已启动服务** → 显式 opt-in 且启用后 fail closed；C05 不越权安装或启动服务，协调者在验证门提供精确部署。

## Migration Plan

1. 主调度 Agent先完成并归档 C04，确认主 spec 与 `ArtifactStoreV1.put/open` 仍符合本设计；有漂移则停止 C05 实现并重规划。
2. 主调度 Agent审阅并提交 C05 planning checkpoint；随后只增加两个 package 的 `./model` exports，确认锁文件与依赖政策不变。
3. 代码 Agent按 tasks 实现 core Schema/port/错误与单元测试，再实现 adapter 配置、探测、同步能力、SSE/原始工件和协议测试。
4. 运行定向测试、类型/格式/依赖边界；由验证者连接预置真实 llama.cpp 和 C04 fixture 执行显式 smoke，不启动服务。
5. Sol high 独立对照 requirement、错误、权限、预算、先耐久、无日志泄露及 RI 追踪；主调度 Agent完成门禁、提交、合并和后续归档。

C05 无数据库 migration 和数据回填。代码回滚只移除 adapter 装配/exports，不删除 C04 原始响应工件；已经保存的诊断工件仍按 C04 权限与生命周期处理。若回退版本不认识某 deployment/schema version，必须结构化失败，不能重新调用或删除证据。

## Open Questions

无。具体生产 llama.cpp build、GGUF 制品哈希与启动参数属于 C37 部署配置；它们必须在各次 smoke/部署中以精确引用提供，但不改变 C05 port、错误或任务拆分。
