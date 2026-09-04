## Why

RiskFlow 已有 Agent 任务引用与公共端口，但尚无统一运行时把内嵌 Agent 和交互 Agent 约束在同一套任务信封、领域工具、资源预算、状态恢复和审计规则内。C15、C17、C19、C21、C27、C29 如果各自实现模型循环和工具调用，将重复权限、预算、幂等与恢复逻辑，并可能绕过确定性领域规则。

本 change 交付 C08 `deliver-unified-bounded-agent-runtime` 的实现规格，为五类 MVP 必经 Agent 任务提供一个有界、可恢复、可追溯的执行内核和 Worker 驱动方式。运行时复用 C03–C07 已确定的事务、工件、模型、授权和审计边界，不扩展为通用 Agent 平台。

## What Changes

- 新增统一的版本化 Agent 任务信封；内嵌与交互模式共享任务身份、冻结输入、策略引用、授权边界、预算台账、状态和结果引用。
- 将 MVP 必经任务固定为 `data-cleaning`、`knowledge-authoring`、`retrieval-review`、`response-recommendation`、`calibration-suggestion`；其它任务类型必须先通过后续 OpenSpec change 引入。
- 新增按任务类型注册的领域工具与严格 Zod Schema 扩展点。运行时只接受类型化领域操作和类型化增量，拒绝通用 JSON Patch、整对象覆盖、Shell、文件系统、SQL、自由联网及任意外部系统工具。
- 强制用户、工程、资料空间和来源授权收窄，以及模型、提示模板、工具、上下文、输入输出、候选、并发、修正/重试次数和墙钟时间硬预算；任何恢复、重试或修正都沿用原预算，不得扩容、换模型或替换策略。
- 新增任务状态、Worker 租约、暂停/恢复、取消和失败语义；用稳定幂等键、动作意图记录和已完成结果复用保证恢复不重复业务效果。
- 规定 C04 工件先耐久化：渲染输入、C05 原始响应引用、工具观察、候选版本、类型化增量、确定性校验结果、交互命令提案与失败证据先形成不可变工件，再在 C03 事务中写入任务引用和审计。
- 规定确定性模块逐项接受或拒绝 Agent 增量。字段、格式、引用和候选范围错误可在同一预算内回馈修正；权限、来源资格、版本兼容、规则冲突及处置三项约束失败直接拒绝，不得通过循环尝试绕过。
- 交互 Agent 的写命令只生成版本化提案；用户确认后，由原领域接口在新鲜且不扩大的授权上下文中执行。Agent 自身不获得发布、审批或业务写入权限。
- 明确 core、adapter、worker 所有权、PostgreSQL 迁移 `000005`、C03 事务/Outbox/checkpoint 边界以及 C15/C17/C19/C21/C27/C29 的消费接口。

### Non-goals

- 不修改 C02 已发布的 `AgentTaskPortV1`、`AgentTaskRefV1`、`AgentTaskResultRefV1` 或五类任务字段契约。
- 不实现 RI-S57 风险候选生成，也不让 Agent 参与 P/C 计算、风险矩阵映射、阈值判定、Schema 校验、业务入库、版本发布或回滚。
- 不实现任意工具市场、动态代码执行、Shell、通用数据库/文件系统访问、自由联网、模型回退或自动扩容。
- 不建立第二套审计库、业务事件类型或 LangGraph checkpoint；不把 Agent 候选工件当作已生效业务事实。
- 不实现下游任务的具体提示、领域工具、确定性校验器、业务 UI、人工审阅界面或外部通知。
- 不新增外部依赖，不提交、归档或启动服务。

## Capabilities

### New Capabilities

- `unified-bounded-agent-runtime`: 定义统一 Agent 任务信封、五类任务注册、领域工具白名单、硬预算、类型化增量、确定性校验、交互确认、持久化、审计和 Worker 恢复执行规则。

### Modified Capabilities

- None.

## Impact

### Dependencies and boundaries

- **C03 PostgreSQL / Outbox / checkpoint**：任务业务事实和一条命令审计通过 `TransactionUnitV1` 原子写入；没有已声明领域事件时不伪造 Outbox 事件。Worker 轮询 C08 耐久队列。LangGraph checkpoint 只保存 `AgentTaskRefV1`、版本和结果引用，不能代替或重建任务事实。
- **C04 工件库**：模型输入、原始响应引用、工具观察、候选、增量、校验和命令提案以受保护的不可变工件保存；数据库不保存大正文、路径或可下载 URL。
- **C05 llama.cpp 网关**：运行时只调用精确部署和提示模板引用的 `completeStructured`；工具循环由 C08 通过严格结构化响应编排，C05 不自动重试、换模型或扩预算。
- **C06 本地身份与项目授权**：用户命令先校验准确 `agent-task.*` 分支；Worker 从冻结的父运行授权中继承并收窄工程、资料空间和来源范围，并在动作执行时检查当前撤销状态。
- **C07 审阅与审计**：C08 通过 C03 写事实审计并提供完整证据引用；需人工审阅的候选由下游领域模块创建 C07 审阅任务，C08 不复制审阅决定或通用审计投影。

### Ownership

- `packages/core/src/agent-runtime/**`：Zod DTO、任务定义注册、状态转换、预算预留、确定性校验编排和运行时服务。
- `packages/adapters/src/agent-runtime/**`：`AgentTaskPortV1` 适配、PostgreSQL 任务仓储、Worker claim/lease 与 C03/C04/C05/C06 组合边界。
- `packages/adapters/src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts`：仅 C08 任务事实表、动作/候选/确认记录和最小权限。
- `apps/worker/src/agent-runtime/**`：有界 claim、租约续期、动作执行、取消传播和恢复循环。
- 共享包导出、workspace 依赖和 Worker 中央注册由主调度在实现检查点统一修改，避免并行 change 冲突。

### Downstream consumers and traceability

- C15 消费 `data-cleaning`，对应 RI-S21–RI-S23 的数据清洗与部分可用判断。
- C17/C19 消费 `knowledge-authoring`，对应 RI-S31–RI-S45 施工工序模型、风险机理库及 RA-S3 标准条文结构化中的非结构化知识编制。
- C21 消费 `retrieval-review`，对应 RI-S52–RI-S56 的识别检索审阅与有界补搜；RI-S57 仍是独立 LLM 节点。
- C27 消费 `response-recommendation`，对应 RA-S7 候选措施组合排序及三项确定性约束前置。
- C29 消费 `calibration-suggestion`，对应 RA-S7 偏差超限后的校准建议候选；发布仍需人工确认。
- `AgentTaskRefV1` 与 `AgentTaskResultRefV1` 是全部下游的唯一公共衔接；下游注册任务专用 Schema、领域工具处理器和确定性校验器，不绕过运行时自行调用模型或工具。

### Replan conditions

- C03–C07 的已发布端口或迁移号与本设计不一致。
- 下游要求第六类必经任务、通用工具调用或 Agent 直接修改已发布业务事实。
- C05 无法提供严格结构化输出、稳定用量或原始响应工件引用。
- C06 无法表达父运行授权的冻结、收窄及撤销检查。
