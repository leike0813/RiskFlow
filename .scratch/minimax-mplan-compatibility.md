# MiniMax M Plan / M3.1 兼容性核验

核验日期：2026-10-11。资料部分依据 MiniMax 官方当前页面；现场部分由主 Agent 使用用户指定的 MiniMax M Plan 与局域网 Ollama 做小型合成协议探测。探测只记录安全元数据，不保存密钥、正文或模型思考内容，也不构成 C37 业务验收证据。

## 结论

- M Plan 的中国区 OpenAI 兼容 Base URL 为 `https://api.minimax.cn/v1`，Chat Completions 路径为 `/chat/completions`；模型 ID 是 `MiniMax-M3.1-Flash-Preview`。官方 M Plan 页面把该模型列为套餐模型，支持 API Key 接入 AI Agent/编程工具。来源：[M Plan](https://platform.minimax.cn/subscribe/coding-plan)、[OpenAI Chat Completions API](https://platform.minimax.cn/docs/api-reference/text-chat-openai)、[M Plan 工具接入说明](https://platform.minimax.cn/docs/m-plan/other-tools)。
- M3.1 官方说明为 1M 上下文。官方 Chat Completions 当前参数文档将 `max_completion_tokens` 的建议值列为 131072（128K）、上限 524288（512K）。这证明接口参数文档声明的输出上限为 512K，不代表 M Plan 每个账户/套餐实际可持续获得该配额，也不等于无思考 token 的用户可见文本长度。来源：[Chat Completions API](https://platform.minimax.cn/docs/api-reference/text-chat-openai)；[OpenAI 兼容 API 参数说明](https://platform.minimax.cn/docs/api-reference/text-openai-api)。
- M3.1 强制开启思考；官方参数说明明确写明旧版 `max_tokens` 上限会计入思考 token，设得过小可能以 `finish_reason=length` 结束且 `content` 为空。文档推荐新接入使用 `max_completion_tokens`，但没有明确说明它是否以相同方式计入思考 token。因此对 D-23 所需的总输出硬预算：旧 `max_tokens` 有官方计入语义，新参数的思考 token 计入语义仍未证实。思考深度仅 M3.1 支持 `low/medium/high/xhigh/max`，默认 `max`；不能关闭 thinking。来源：[OpenAI 兼容 API 参数说明](https://platform.minimax.cn/docs/api-reference/text-openai-api)、[Chat Completions API](https://platform.minimax.cn/docs/api-reference/text-chat-openai)。
- 官方文档声明支持流式 `stream_options.include_usage`，Chat Completions 响应包含 `usage`。这满足协议层有 usage 字段的证据要求；是否每个终止/断流情形都返回可用于预算收口的完整 usage，文档未证实，仍需在获授权的真实服务验收中确认。来源：[OpenAI 兼容 API 参数说明](https://platform.minimax.cn/docs/api-reference/text-openai-api)、[Chat Completions API](https://platform.minimax.cn/docs/api-reference/text-chat-openai)。
- 官方当前检索到的 Chat Completions 与 OpenAI 兼容 API 页面没有明确描述 `response_format: {type: "json_schema", json_schema: {strict: true, ...}}` 的支持范围、`strict` 服务端约束保证或其与 JSON mode 的差异。官方搜索及 Context7 当前文档查询没有命中相关说明。结论是**未证实**，不能据此宣称不支持，也不能满足 D-23 对服务端 strict Schema 能力的证明要求。

## D-23 对照

D-23 要求结构化请求映射 `response_format=json_schema` 并带 `strict=true`；要求 stream usage，并要求预算可硬约束，额外思考 token 等无法受协议预算约束时不得声明支持。MiniMax 的端点、模型身份、M3.1 思考强制开启、usage 字段及 token 上限有官方资料；`json_schema strict` 支持与服务端执行语义未证实。`max_tokens` 明确计入思考 token，但已弃用；推荐参数 `max_completion_tokens` 是否涵盖思考 token 未证实。因此现有第一手资料不足以证明该模型完整满足 D-23，尤其不能据此批准结构化生成正式就绪。

## MiniMax 现场协议探测

目标为 `https://api.minimax.cn/v1/chat/completions`，模型 `MiniMax-M3.1-Flash-Preview`；两次非流请求均使用 `reasoning_effort=low`、`max_tokens=4096`、`response_format.type=json_schema` 和 `strict=true`。这是兼容性前置探测，尚未通过生产 adapter、C04 工件存储或正式业务权限链路。

| 探测 | 实际结果 | 含义 |
| --- | --- | --- |
| 提示与 Schema 一致 | HTTP 200，精确模型身份，`finish_reason=stop`，输出通过简单 Schema；usage 为输入 219、输出 7、合计 226，含 reasoning token 1 | 凭据及聊天端点可用，单次生成符合 Schema；不能由此证明服务端严格约束 |
| 提示与 Schema 冲突 | HTTP 200，`finish_reason=stop`；提示要求 `status=requested`，Schema 仅允许必填 `schemaSentinel=forced-by-schema` 且禁止额外字段；实际输出遵循提示，违反 Schema。usage 为输入 223、输出 7、合计 230 | 此真实响应反驳当前部署对 strict Schema 的强制保证；不能按 D-23 声明结构化能力就绪 |
| SSE 与终态用量 | `stream=true`、`stream_options.include_usage=true`，HTTP 200、精确模型身份、两个正文增量、`finish_reason=stop`、`[DONE]` 与 usage；输入 215、输出 5、合计 220 | 本次正常流真实包含正文和终态用量；尚未证明 adapter、断流处理、硬预算和 C04 持久化 |

未测出原因是服务忽略参数、模型能力限制还是特定接口行为。无需推断原因：违反声明 Schema 的响应已经足以阻止“服务端严格约束”的验收结论。

## Ollama Embedding（主 Agent 实测）

用户指定模型为 `qwen3-embedding:4b`。主 Agent 从 `http://192.168.13.11:11434/api/version` 实际读取版本 0.40.0；`/api/tags` 和 `/api/show` 返回模型 SHA-256 `df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907`、元数据 context 40960 和 embedding 维度 2560。随后使用同一条合成文本调用 `/v1/embeddings` 与 `/api/embed`（`truncate=false`），均为 HTTP 200、一个全为有限数的 2560 维向量；前者 usage 为 `prompt_tokens=12,total_tokens=12`，后者 `prompt_eval_count=12`。

原生接口的 `truncate=false` 拒绝过长输入语义有 [Ollama 官方说明](https://docs.ollama.com/api/embed)；本轮未发送超长文本验证。当前只证实单条向量与用量，尚未证明批处理、检索代际、质量门禁或 C04 持久化。当前 D-23 的 HTTPS 与必填 Bearer 凭据约束不能直接容纳这个指定的无密钥内网 HTTP 后端。

## 已批准的 C37 契约

用户已同意以下接入策略。继续使用指定的两项服务，不引入 SDK 或依赖；同步 proposal、design D-23、模型网关 delta spec、implementation-plan IP-15/IP-16 和 tasks 15.x，不修改 P/C、矩阵、阈值、人工决定或 core 请求/结果字段。

1. 将结构化生成 Requirement 改为“结构化生成必须按冻结 Schema 提交并经本地 Zod 复验”。服务端 strict JSON Schema 作为经证实才可声明的部署能力；当前 MiniMax 条目显式登记为 Schema 提示与本地严格校验。由同一 Zod Schema 生成完整 JSON Schema 并传入固定请求提示，接收正常终止的单个 JSON 值后以原 Zod Schema 严格复验。禁止额外字段、JSON 修补、局部提取、失败当成功、自动重试或静默换策略。所有非法输出仍失败；下游 RI-S58/59 与 Agent 增量的确定性校验照常执行。这是显式批准的网络部署策略，不伪称服务端严格约束。
2. 为指定 Ollama embedding 增加独立协议部署条目。只有受控配置中的精确内网 origin `http://192.168.13.11:11434` 可按无密钥模式接入；公网 MiniMax 仍使用 HTTPS/Bearer。业务及浏览器不能指定 URL、读取秘密或调用内部模型服务。Ollama 使用 `/api/embed` 和 `truncate=false`，冻结上述版本、模型摘要、上下文与 2560 维；预算、C04 响应证据、权限和检索新代际仍成立。用户更换模型后必须形成新部署及检索代际。
3. MiniMax 能力登记为文本结构化生成与会话流，固定 1,000,000 上下文；524288 是供应商参数上限，实际验收任务使用较小的显式预算，`max_tokens` 计入思考 token，核验 usage 总量。正文和思考内容分别处理，普通日志、界面及验收报告不保存或展示思考内容。模型支持图片/视频不自动扩展当前仅文本的 core 消息契约；扫描件仍走真实 OCR 通路。
4. 通过上述 adapter 的协议/失败/预算测试及真实三能力 smoke 后，再装配正式 API/Worker 和数据服务，在 `apps/web` 的真实浏览器界面使用开发集联调及试运行集取证。提交回执、人工等待、静态材料检查均不能作为完整功能 PASS。

## 未核验项

未测试 M Plan 账户的剩余额度、峰值限流、`max_completion_tokens` 的思考 token 截断行为或 Ollama 超长输入行为。官方页面展示模型和套餐权益，不等于对特定订阅 Key 的实时配额承诺。未实现或启动 RiskFlow 业务服务，未在浏览器执行样例验收，未将兼容性探测记为正式业务 PASS。
