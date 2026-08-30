# TypeScript LangGraph 与 llama.cpp 能力边界核查

核查日期：2026-08-27  
核查范围：TypeScript `@langchain/langgraph`、`llama-server`、Qwen3.8-27B、Qwen3.8-Flash-Next。  
资料口径：仅使用 LangChain/LangGraph 官方文档、`ggml-org/llama.cpp` 官方仓库、Qwen 官方仓库与官方模型卡。本报告核查 llama.cpp 时固定参考提交 [`cb300598`](https://github.com/ggml-org/llama.cpp/tree/cb300598d5f90189cb69d2702f4930aaf99d32a2)，以免后续 `master` 变化使结论失去上下文。

## 结论

TypeScript LangGraph 在框架能力层面可以完整承担 RiskFlow 的流程编排：显式状态图、条件路由与循环、子图组合、持久化检查点、暂停/恢复、人工复核以及图和子图事件流都有官方支持。它适合成为唯一编排核心。

llama.cpp 可以作为默认的私有化 LLM 服务实现：`llama-server` 提供同步/流式 Chat Completions、JSON/JSON Schema 约束和 OpenAI 风格工具调用。但这些能力不能被概括为“与 OpenAI 完全兼容”。官方明确不作完整兼容承诺；JSON Schema 默认实现只覆盖规范子集；工具调用依赖 Jinja 聊天模板与解析器。RiskFlow 必须在 llama.cpp 前设置自己的模型网关，并以 Zod 复验所有结构化结果和工具参数。

模型层面要区分两项结论：

- **Qwen3.8-27B 可进入 llama.cpp 验收候选。** 其官方配置仍使用 `Qwen3_5ForConditionalGeneration` / `qwen3_5` 架构，而当前 llama.cpp 转换器已注册该模型类并实现 `QWEN35` 执行架构。不过，Qwen 官方模型卡没有提供 Qwen3.8 的 llama.cpp/GGUF 部署配方，官方仓库的 llama.cpp 段落仍只明示 Qwen3.5。因此它是“源码路径存在、必须实机验收”，还不是可无条件承诺的生产组合。
- **Qwen3.8-Flash-Next 暂不能进入 llama.cpp 基线。** 它使用新的 `Qwen4ExpForConditionalGeneration` / `qwen4_exp` 架构；当前 llama.cpp 架构枚举和转换注册没有对应实现。Qwen 官方将其称为实验性预览，并推荐 SGLang、KTransformers 或 vLLM。它只能作为后续兼容性研究候选。

## 能力矩阵

| 所需能力 | 官方依据 | 判定 | 必须保留的边界 |
|---|---|---|---|
| `StateGraph`、条件分支、循环 | `StateGraph` 以 State、Node、Edge 建模，并支持条件边与循环；节点返回部分状态更新。[Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) | 覆盖 | 图负责编排；评分、矩阵、阈值和 Schema 校验仍放在确定性领域模块。循环必须有明确终止条件与递归上限。 |
| 结构化图状态 | `StateSchema` 接受 Zod 等 Standard Schema，并提供 `ReducedValue`、`MessagesValue`、独立输入/输出 Schema 和 `UntrackedValue`。[Graph API：State](https://docs.langchain.com/oss/javascript/langgraph/graph-api#state) | 覆盖 | reducer 是并发写入语义的一部分；默认更新会覆盖旧值。不可把连接、缓存或大对象写入检查点。领域 DTO 仍应由共享 Zod SSOT 显式解析。 |
| 子图组合 | 父子图共享状态键时可直接把编译后的子图加入节点；Schema 不同时可在包装节点中转换输入/输出。[Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs) | 覆盖 | `identificationGraph` 与 `assessmentGraph` 应各有私有状态，通过显式 DTO 适配；不要依靠同名字段偶然耦合。 |
| 子图持久化 | 子图支持 per-invocation、per-thread、stateless 三种模式；父图必须配置 checkpointer 才能获得中断、持久执行和状态检查。[Subgraph persistence](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs#subgraph-persistence) | 覆盖，有约束 | 默认使用 per-invocation；只有真正需要跨调用记忆时才启用 per-thread。同一个持久子图实例在同一节点内多次调用会产生命名空间冲突，需纳入设计检查。 |
| 检查点与故障恢复 | 编译图时配置 checkpointer 后，每个 super-step 保存检查点；支持线程状态、历史、time travel、故障恢复和 pending writes。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | 覆盖 | `MemorySaver` 只用于测试；生产用数据库型 checkpointer。每次运行必须提供稳定、唯一的 `thread_id`。检查点不是业务入库，二者分别保存并关联。 |
| TypeScript 生产持久化 | 官方列出独立的 SQLite、Postgres、MongoDB、Redis checkpointer；Postgres 被标为生产实现。[Checkpointer libraries](https://docs.langchain.com/oss/javascript/langgraph/persistence#checkpointer-libraries) | 覆盖 | 首选 `@langchain/langgraph-checkpoint-postgres`；迁移作为部署步骤，设置备份、保留期限与清理策略。 |
| `interrupt` / HITL | `interrupt()` 会把 JSON 可序列化负载暴露给调用方；以相同 `thread_id` 和 `Command({ resume })` 恢复。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | 覆盖 | 生产必须使用持久 checkpointer。复核请求、复核决定和操作者审计由业务库保存，不能只存在检查点中。 |
| 暂停后恢复 | 官方明确恢复时会从发生 `interrupt` 的节点开头重新执行，`interrupt` 前的代码会再次运行。[Resume key points](https://docs.langchain.com/oss/javascript/langgraph/interrupts#pause-using-interrupt) | 覆盖，有关键语义 | 所有节点和外部写入必须幂等；在 `interrupt` 前避免不可重复副作用，或拆为独立节点并使用业务幂等键。不要宣称“从源码行原地继续”。 |
| 并行人工复核 | 多个并行分支同时中断时，可以按 interrupt ID 提交多个恢复值。[Handling multiple interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts#handling-multiple-interrupts) | 覆盖 | 复核 API 必须使用 interrupt ID，而非依赖数组顺序或节点名称。 |
| 图/子图事件流 | `streamEvents(..., { version: "v3" })` 提供 messages、values、subgraphs、output、interrupts 等独立 typed projections；低层流还支持 updates、values、messages、custom、tools、debug。[Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)、[Streaming modes](https://docs.langchain.com/oss/javascript/langgraph/streaming#stream-modes) | 覆盖 | UI 消费 RiskFlow 自有事件 DTO；不得把 LangGraph 内部事件结构直接作为长期前端契约。llama.cpp 不是 LangChain 原生集成时，可用 `custom` 模式转发 token/进度。 |
| llama.cpp OpenAI 风格服务 | `llama-server` 提供 `/v1/completions`、`/v1/chat/completions`，Chat Completions 支持同步与流式。[Server API](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/tools/server/README.md#post-v1chatcompletions-openai-compatible-chat-completions-api) | 覆盖基本接口 | 官方明确“不作强兼容承诺”，且只有受支持聊天模板的模型能得到最佳行为。模型网关只能依赖已通过契约测试的字段。 |
| LangChain TS 连接 llama.cpp | `ChatOpenAI` 可通过自定义 `baseURL` 连接 OpenAI Chat Completions 兼容端点；官方同时提醒第三方端点的非标准字段不会被保留，扩展能力可能不完整。[Providers and models](https://docs.langchain.com/oss/javascript/concepts/providers-and-models#openai-compatible-endpoints) | 覆盖基本接入 | 独立封装 `LlmGateway`；不要让图节点散落 `ChatOpenAI` 实例和 llama.cpp 私有参数。需要 reasoning 等扩展字段时在适配器内显式映射。 |
| JSON / Schema 约束 | `/v1/chat/completions` 的 `response_format` 支持 `json_object` 和 schema-constrained JSON。[Server API](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/tools/server/README.md#post-v1chatcompletions-openai-compatible-chat-completions-api) | 部分覆盖 | 默认 JSON Schema → GBNF 只支持规范子集，且某些不支持特性会被静默跳过；Schema 也不会自动注入提示词。[JSON Schema → GBNF 限制](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/grammars/README.md#json-schemas--gbnf) 因此必须在应用侧再次执行 Zod `safeParse`，失败重试或进入人工复核。 |
| 更完整的 JSON Schema | llama.cpp 可选 LLGuidance，官方称其更贴近 JSON Schema、遇到不支持 Schema 会报错，但构建需要 Rust，当前错误只写 `stderr` 且生成继续。[LLGuidance](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/docs/llguidance.md) | 可选增强，不是默认保证 | 若启用，必须纳入自建镜像、日志监控和失败检测；仍不取消 Zod 复验。首版优先约束 RiskFlow Schema 只使用已验证的 JSON Schema 子集。 |
| 工具调用 | `llama-server --jinja` 支持 OpenAI 风格 function calling；未识别模板会使用 generic handler；部分模型支持并行工具调用。[Function Calling](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/docs/function-calling.md) | 部分覆盖，需按模型验收 | 当前原生格式清单没有 Qwen3.8。必须固定 GGUF 内嵌/外置聊天模板及其哈希，并验收单工具、多轮工具结果、无工具、错误参数和（若使用）并行工具调用。工具参数先过 Zod，再执行工具。 |
| Qwen3.8-27B 加载路径 | 官方模型配置为 `Qwen3_5ForConditionalGeneration` / `qwen3_5`。[Qwen3.8-27B config](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/config.json) llama.cpp 当前转换器注册该类并映射到 `QWEN35`。[qwen.py](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/conversion/qwen.py#L614-L639) | 有实现基础，待实机验收 | Qwen 官方模型卡列出的兼容框架和生产推荐不包含 llama.cpp，[模型卡](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/README.md)；Qwen 官方仓库也只明示 llama.cpp 支持 Qwen3.5。[Qwen3.8 仓库：Local Use](https://github.com/QwenLM/Qwen3.8#llamacpp) 不得跳过 GGUF、CUDA、长上下文、结构化输出和工具调用验收。 |
| Qwen3.8-Flash-Next | 官方配置为新的 `Qwen4ExpForConditionalGeneration` / `qwen4_exp`。[Flash-Next config](https://huggingface.co/Qwen/Qwen3.8-Flash-Next/blob/main/config.json)；当前 llama.cpp 架构枚举只有 QWEN35/QWEN35MOE 等，没有 QWEN4_EXP。[llama-arch.h](https://github.com/ggml-org/llama.cpp/blob/cb300598d5f90189cb69d2702f4930aaf99d32a2/src/llama-arch.h) | 当前不覆盖 | 不作为最低配置或首发模型。等待 llama.cpp 合并明确架构、转换和运行支持后，再开独立验证票。 |

## 对 Qwen3.8 两个候选的补充边界

### Qwen3.8-27B

Qwen 官方说明该模型为 27B 稠密模型，原生上下文 262,144 token，可扩展到 1,000,000 token，并默认开启 thinking；官方公开权重仓库约 55.6 GB（BF16 safetensors）。这些是模型上限与原始权重规模，不等于单卡 4090 上 llama.cpp 量化模型的可用上下文、并发数或时延。[Qwen3.8-27B 模型卡](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/README.md)

因此宏观架构只能把它定为**默认验收目标**。最终部署基线必须固定：llama.cpp 提交/镜像、GGUF 文件与哈希、量化格式、是否包含视觉投影/MTP、聊天模板、上下文长度、GPU offload 参数和采样参数。具体性能由硬件专项票决定。

### Qwen3.8-Flash-Next

Qwen 将它定义为面向下一代架构的实验性预览。主干为 125B 参数、每 token 激活 6B，另有 51B N-gram embedding 和 4B MTP；原始仓库约 360 GB，采用 QSA、Gated DeltaNet、MoE 和新的 `qwen4_exp` 模型类。官方针对生产/高吞吐场景推荐 SGLang、KTransformers 或 vLLM，没有 llama.cpp 路线。[Qwen3.8-Flash-Next 模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next/blob/main/README.md)、[Qwen 官方发布说明](https://qwen.ai/blog?id=qwen3.8-flash-next)

“激活 6B”只说明每 token 的计算稀疏度，不能把它当作 6B 权重模型做内存规划。其开源权重还使用 `qwen-community-1.0` 许可，与 Qwen3.8-27B 的 Apache-2.0 不同；如果未来纳入交付，还需单独完成许可审查。[Flash-Next LICENSE](https://huggingface.co/Qwen/Qwen3.8-Flash-Next/blob/main/LICENSE)

## 应进入宏观架构的约束

1. **LangGraph 是编排内核，不是业务事实源。** `riskFlowGraph` 组合 `identificationGraph` 与 `assessmentGraph`；状态只携带版本化 DTO、实体标识和结果引用。P/C、风险矩阵、阈值判断与最终 Schema 校验由独立确定性模块执行。
2. **检查点与业务记录分离。** PostgreSQL checkpointer 保存执行恢复状态；业务库保存不可变的风险记录、评估记录、预警、复核与审计。二者通过 `runId`、`threadId`、`checkpointId` 关联。
3. **节点按至少一次执行设计。** `interrupt` 恢复、失败重试和进程故障都可能导致代码再次运行；每个外部写入必须有业务幂等键，通知采用 outbox/已发送状态，不能靠“节点只执行一次”的假设。
4. **LLM 服务通过模型网关隔离。** LangGraph 节点只依赖 RiskFlow 的 `LlmGateway` 接口。llama.cpp 是默认私有实现，但其 OpenAI 兼容字段、聊天模板、reasoning、结构化输出和工具调用细节不能渗入领域层。
5. **结构化生成是两层约束。** 第一层用 llama.cpp `response_format`/grammar 限制生成；第二层用共享 Zod Schema 解析与语义校验。第二层失败后按错误类型有限重试，仍失败进入人工复核，禁止自动补成合格记录。
6. **工具调用是受控能力。** LLM 只能选择白名单工具并生成候选参数；权限校验、Zod 参数校验、幂等、超时、审计和实际执行都在模型之外完成。风险评分与规则发布不暴露为可由 LLM 自由调用并更改结果的工具。
7. **事件流经应用协议转换。** 后端把 LangGraph typed projections 转成稳定的 RiskFlow 事件，如 `run.started`、`node.progress`、`review.required`、`record.created`、`run.failed`；前端不绑定 LangGraph 的 checkpoint 或命名空间内部格式。
8. **版本必须冻结。** 首次实施时固定 `@langchain/langgraph`、checkpointer、`@langchain/openai`、llama.cpp 镜像/提交、GGUF、聊天模板和模型配置版本；升级必须重复契约与性能测试。

## 最小验收清单

### LangGraph 编排

- 顶层图可分别调用识别与评估子图；两者使用不同状态 Schema，经显式 DTO 适配后组合。
- 进程在任一节点后终止并重启，使用同一 `thread_id` 可从持久检查点继续；已成功的同一 super-step 并行节点不会无故重复。
- 低置信度记录、规则冲突和处置建议审核均能 `interrupt`；隔夜/重启后仍可恢复；错误 `thread_id` 不能串接其它任务。
- 恢复导致节点重跑时，业务写入、审计、通知均不重复；用同一幂等键可安全重放。
- 单个与并行 interrupt 均按 interrupt ID 恢复，复核修改后的 DTO 再过 Zod 与业务规则。
- 事件流可区分顶层图/子图/节点，提供增量状态、token/自定义进度、人工复核和终态；断线重连可由持久状态补齐最终结果。

### llama.cpp 与 Qwen3.8-27B

- 固定 llama.cpp 提交或镜像、GGUF/聊天模板哈希；在 RTX 4090 24GB + 128GB 主机内存上完成启动、健康检查、关停和故障恢复。
- `/v1/chat/completions` 的同步、SSE 流式、超时、取消、上下文溢出、服务不可用和并发请求行为符合模型网关契约；不得依赖未验证的 OpenAI 字段。
- 用所有 RiskFlow LLM 输出 Schema 跑 JSON 约束测试；生成结果必须 100% 通过 JSON 解析，随后通过 Zod。对 JSON Schema 子集以外的关键约束，明确由 Zod/领域规则承担。
- 在 thinking 开/关以及采用的 `reasoning_effort` 设置下分别验收；内部 reasoning 不写入用户可见界面，也不作为风险结论证据。
- 工具测试至少覆盖：不调用工具、单工具、连续多轮工具、非法工具名、缺失/多余/错误类型参数、工具异常、超时和重试。若产品需要并行工具调用，再单独验收 `parallel_tool_calls`。
- 以真实 RiskFlow 长度分布测量首 token 时延、生成速率、峰值显存/内存、最大稳定上下文和并发数；官方 262K/1M 上限不能直接作为本机 SLA。
- Qwen3.8-Flash-Next 不参与首发通过条件；只有在 llama.cpp 官方源码出现对应模型转换与执行实现，并完成同一套契约/硬件测试后才能升级为候选。

## 最终判定

宏观架构可以锁定“**TypeScript 全栈 + LangGraph 唯一编排核心 + llama.cpp 默认私有 LLM 服务 + Qwen3.8-27B 默认验收目标**”。这条路线没有框架级阻塞，但 llama.cpp/Qwen3.8-27B 是一个需要实测关闭的兼容性风险，不能只依据 OpenAI 风格端点和相同模型架构宣布完成。Qwen3.8-Flash-Next 当前明确排在该基线之外。
