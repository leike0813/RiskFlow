## Why

C02 已冻结模型调用方使用的授权、精确版本、工作流与结果引用，但未定义 `ModelGatewayPortV1` 或模型协议 DTO；C04 已提供受权限保护的不可变工件存储。C05 需要在不修改公共 contracts 的前提下建立唯一 llama.cpp 模型边界，使后续 Agent、检索和 RI-S57 专用推理不直接依赖 HTTP/SSE 协议、模型名或未校验的模型输出。

## What Changes

- 在 `packages/core` 新增基础设施无关的模型网关 V1 Schema、错误与窄 port，只暴露 `completeStructured`、`embed`、`streamConversation` 三项能力；所有 TypeScript 数据类型从 Zod Schema 派生，`AbortSignal` 作为进程内控制参数而非 DTO。
- 在 `packages/adapters` 新增 llama.cpp adapter；模型部署引用、服务构建版本、模型版本、模型别名、能力集合、实际上下文窗口、Embedding 维度、超时与响应上限全部由 composition root 注入并冻结，业务代码只传精确 `modelDeploymentRef`，不得出现模型名或服务 URL。
- 结构化生成使用 llama.cpp schema-constrained JSON，同时必须在本地解析 JSON 并通过调用方提供的 Zod Schema 复验；模型约束不能代替 RI-S58/C22 的领域 Schema、字段补全、规则或仿真校验。
- Embedding 结果校验条目顺序、数量、有限数值和配置维度；流式会话只输出受控文本增量及终态收据，不透传 `reasoning_content`、工具调用、未知事件、原始 SSE 或服务器正文。
- 使用 Node.js 24 原生 `fetch`、Web Streams、`AbortController`、`TextDecoder` 与现有 Zod，不引入 OpenAI SDK、SSE 库或 HTTP 客户端。adapter 关闭重定向，不做内部模型切换或生成重试。
- 模型原始 HTTP/SSE 响应以受保护诊断工件交给 C04：同步调用先耐久保存再解析并返回引用；流式调用在受控增量旁路中背压保存，只有 C04 `put` 完成后终态收据才返回引用；中止、超时或断流保存已收到的有限原始字节后返回结构化失败。
- 将取消、总超时、流空闲超时、无服务、HTTP、协议、部署能力/版本、上下文、JSON 结构、Zod Schema、向量维度、断流和工件持久化失败映射为闭合错误；无服务不得返回空成功、假结果或替代模型结果。
- 固定授权、审计、幂等与预算接缝：请求复用 C02 授权上下文/能力/版本引用，工件写入复用 C04 权限继承与审计；调用身份与幂等键贯穿工件命令；请求预算只能收窄部署上限，使用量与终止原因进入结果元数据。
- 增加测试专用协议替身和工件替身，覆盖稳定可观察行为；另设显式启用的真实 llama.cpp smoke，连接已由操作者启动的聊天与 Embedding 部署，C05 测试不得自行启动服务。

### Non-goals

- 不实现或启动 llama.cpp 服务，不下载、量化、微调、路由、热切换或管理 GGUF；C37 冻结离线二进制、模型制品、启动参数和目标硬件部署，LoRA 仍按路线条件另开 change。
- 不实现 OpenAI/Anthropic 通用 SDK、函数调用、工具调用、视觉/音频、多模型负载均衡、自动降级、自动重试、持久会话或生产聊天 UI。
- 不修改 C01/C02 contracts，不新增业务领域事件、数据库表或 migration；C08/C21/C22 仍分别拥有 Agent 预算、RI-S56 上下文和 RI-S58～RI-S59 领域收口。
- 不把提示、模型响应、Embedding、思维链、服务路径、密钥或协议错误正文写入日志、审计行、Outbox 或 LangGraph checkpoint。

## Capabilities

### New Capabilities

- `platform/llamacpp-model-gateway`: 规定 llama.cpp 的结构化生成、Embedding、受控会话流、部署能力验证、C04 原始响应工件、取消/超时/断流与闭合错误行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：C02 `domain/module-interfaces-events-workflows` 与 C04 `platform/content-addressed-artifact-store`。C02 当前不存在 `ModelGatewayPortV1`/模型 DTO，因此 C05 在 `packages/core` 新增 adapter port，并只复用 `AuthorizationContextV1Schema`、`ModuleCapabilityV1Schema`、`ModuleErrorV1`、版本/工件/证据引用；禁止修改 `packages/contracts/**`。C04 当前实现已合入基线 `3d193e9`，但其 change 尚未归档；C05 实现前必须先归档 C04 并以主 spec 复核接口。
- **下游消费者**：C08、C19、C20、C22、C27、C29 通过 core port 调用；它们不能导入 llama.cpp adapter 内部协议 Schema、模型别名或 URL。C21/C22 负责把 RI-S51 提示模板、RI-S56 五项上下文与 `ModelOutputResultSchema` 交给网关并继续 RI-S58～RI-S59 确定性收口。
- **RI/RA 追踪**：直接支撑 RI-S51 的配置化模型/提示入口、RI-S53 的向量化调用、RI-S57 的受约束结构化推理，并为 RI-S58～RI-S59 保存原始响应与提供严格 Zod 复验/错误边界；RA-S3、RA-S7 后续只能复用相同网关，不由 C05 实现规则或处置业务语义。
- **代码所有权**：`packages/core/src/model/**` 拥有协议无关 DTO/port/错误映射；`packages/adapters/src/model/**` 独占 llama.cpp HTTP/SSE/config adapter；测试位于对应 `test/model/**`。两个 `./model` package exports 由主调度 Agent在 planning checkpoint 后串行加入 package manifests。
- **依赖治理**：无 npm、系统或服务安装变化；复用 Node.js `>=24.12.0 <25` 原生网络/流 API、`zod@4.5.4` 和 C04。llama.cpp 是外部预置服务，具体构建与模型制品由配置精确引用并在 smoke 记录；C37 才负责 MIT 来源、离线制品哈希、SBOM、许可证和部署冻结。
- **禁止修改**：`packages/contracts/**`、C03/C04 生产文件和 migrations、`apps/**`、`demo/**`、根清单/配置、`config/dependency-policy.json`、`pnpm-lock.yaml`、`openspec/config.yaml`、`openspec/specs/**`、归档 change 与其它活动 change。

若实现发现必须修改 C02 DTO/能力枚举、C04 port、增加持久化表、引入 SDK、由业务代码选择模型名，或无法在无服务/断流时 fail closed，必须停止并交回主调度 Agent重新规划。
