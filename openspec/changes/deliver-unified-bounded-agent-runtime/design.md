## Context

C02 已发布 `AgentTaskPortV1`、`AgentTaskRefV1`、`AgentTaskResultRefV1`、五类任务类型和两种触发模式；C03–C07 分别提供事务/Outbox/checkpoint、内容寻址工件、llama.cpp 模型网关、本地身份授权、人工审阅与审计投影。缺少的是把这些端口组合成统一、有界、可恢复执行语义的 C08。

C08 是平台运行时，不拥有下游领域事实。它接受冻结任务定义，编排 C05 结构化模型调用和版本化领域工具，将候选交给下游提供的确定性校验器，并以 C02 公共结果引用结束。它不解释业务规则、不发布知识、不计算风险分值，也不替代 C07 人工决定。

## Goals / Non-Goals

**Goals**

- 让内嵌与交互 Agent 使用同一任务信封、状态、预算、授权、工件、审计和恢复机制。
- 固定五类 MVP 必经任务及其类型化扩展点，避免下游各造一套 Agent 循环。
- 在每个外部动作前执行最小授权、严格 Schema、版本和原子预算校验。
- 在 Worker 崩溃、租约过期、暂停、恢复、取消和重复消息下避免重复业务效果。
- 保留可重建输入、原始响应引用、工具行动、候选、增量、校验、资源消耗和失败，同时不保存或展示模型思维链。

**Non-goals**

- 通用 Agent SDK、任意工具插件、动态代码或提示模板编辑器。
- 更改 C02 公共 DTO，或在 C08 定义下游领域对象的第二套 Schema。
- 为 Agent 状态新增领域事件、审计数据库、checkpoint 或消息基础设施。
- 下游任务实现、业务 UI、通知、知识发布、建议采纳、校准生效。
- 模型 fallback、自动换模、预算弹性扩容或跨任务共享剩余额度。

## Decisions

### 1. C02 公共契约保持不变，C08 增加内部严格 DTO

C08 不修改 `packages/contracts/**`。公共调用继续使用 C02 `AgentTaskPortV1`；内部 DTO 位于 `packages/core/src/agent-runtime/schema.ts`，全部使用已安装的 Zod 并采用 `.strict()`：

- `AgentTaskEnvelopeV1`：包含 C02 start command 的精确任务/模式/父运行/冻结输入/模型/提示/工具/预算/增量/校验引用，加上生成的任务引用、发起者、工程、冻结授权范围、幂等命令引用、契约版本和时间。
- `AgentTaskDefinitionV1`：按五类任务之一注册严格 action/increment/candidate Schema、领域工具处理器、确定性校验器和结果收口器。任务定义在代码中注册；数据库策略只能引用版本，不能注入处理代码。
- `AgentTaskBudgetPolicyV1`：精确允许的 model/prompt/tool policy refs 及模型、工具、上下文、输入输出、候选、对象、补搜轮次、并发、墙钟、修正和瞬态重试上限。
- `AgentBudgetLedgerV1`：累计 reserved/used 计数、活动墙钟、当前并发和最后变更版本。
- `AgentTaskActionV1`：`model-invocation | domain-tool | deterministic-validation | command-proposal | command-confirmation` 的封闭辨识联合；正文通过 C04 引用。
- `AgentCandidateVersionV1`：候选、父候选、类型化增量、逐项校验和终止分类的不可变引用集合。
- `AgentCommandProposalV1`：工程、目标对象、预期目标版本、类型化命令引用、预期效果和外部副作用。

`AgentTaskDefinitionV1` 是下游唯一扩展点。它已经满足五个消费者提供不同领域 Schema 与校验器的需要，因此不增加单实现接口工厂、动态插件系统或另一个公共 contracts 包。

### 2. 五类任务共用一个状态机

内部状态如下，公共读取时映射到 C02 状态：

| 内部状态 | C02 状态 | 可进入 | 可离开 |
|---|---|---|---|
| `pending` | `pending` | 创建、可重试恢复 | `running`、`cancelled` |
| `running` | `running` | Worker claim | `waiting-user-confirmation`、`retryable-failure`、`completed`、`terminal-failure`、`cancelled` |
| `waiting-user-confirmation` | `waiting` | 交互写提案 | `pending`、`completed`、`terminal-failure`、`cancelled` |
| `retryable-failure` | `failed` | 明确可安全重试的瞬态失败、效果不确定待处置 | `pending`、`terminal-failure`、`cancelled` |
| `completed` | `completed` | 合格结果或已确认命令完成 | 无 |
| `terminal-failure` | `failed` | 预算耗尽、不可修正拒绝、重试耗尽 | 无 |
| `cancelled` | `cancelled` | 已授权取消 | 无 |

所有转换携带 `taskVersion` 并 compare-and-set。`resumeTask` 只能从允许恢复的状态继续，并沿用原信封与累计预算；`cancelTask` 先耐久记录请求，再通过 `AbortSignal` 传播到当前 C05/工具调用。终态不可逆。

### 3. 运行循环由严格结构化响应驱动

C05 只提供 `completeStructured`、`embed`、`streamConversation`，没有工具调用协议。C08 因此将每次模型响应约束为当前任务注册的辨识联合：请求一个类型化领域工具动作、提交候选/增量，或为交互模式提交命令提案。运行时先用严格 Zod 解析，再执行授权、版本和预算检查。

领域工具返回观察工件引用；下一次 `completeStructured` 以新渲染输入继续。循环受同一任务硬预算约束。C08 不为 C05 增加隐式函数调用、不解析自由文本工具名，也不实现模型切换。

### 4. 权限由 C06 校验，Worker 只能继承并收窄

用户命令按 C02 能力映射校验：

| 操作 | C06 分支 / capability |
|---|---|
| start | `agent-task.start-task` / `agent-task.start` |
| resume | `agent-task.resume-task` / `agent-task.resume` |
| cancel | `agent-task.cancel-task` / `agent-task.cancel` |
| confirm | `agent-task.confirm-command` / `agent-task.confirm` |

创建任务时保存父运行的工程、资料空间、来源 grant refs 和策略范围。Worker 每个动作都以该冻结上限与 C06 当前有效授权求交集；撤销立即生效，新 grant 不能扩大旧任务。工具还要验证目标实体版本和来源资格。`business-viewer` 等只读身份不能借 Agent 获得写能力。

交互确认使用确认者的新鲜授权，但仍受冻结上限约束。最终写命令由原领域接口执行，因此该接口的授权、Schema、版本、幂等和业务规则仍然生效。

### 5. 硬预算在外部调用前原子预留

预算不是提示建议。每个动作先在数据库事务中：

1. 锁定任务版本并确认非终态、未取消、租约有效。
2. 验证精确模型、提示、工具和任务策略引用。
3. 计算动作最大资源申请，检查累计预算、任务并发和墙钟。
4. 原子增加 reserved 计数并写动作意图与审计。
5. 事务提交后才调用 C05 或领域工具。
6. 结果工件耐久后，以新事务把 reservation 结算为实际 usage、写结果引用和下一状态。

模型 token/上下文按 C05 可验证用量结算；候选、对象、补搜、修正和重试在相应状态转换时结算。未使用 reservation 可释放，但已经发起且结果不确定的额度不返还。任务墙钟记录活跃执行区间，暂停等待用户确认的时间不计入；任何恢复都读取同一 ledger。

### 6. C04 是大内容和执行证据的事实源

以下数据保存为受保护的 C04 不可变工件：渲染模型输入、C05 原始响应工件引用、工具请求与观察、候选、类型化增量、逐项校验结果、命令提案、公开错误详情和正式输出。PostgreSQL 只保存内容哈希/ArtifactRef、最小索引字段、状态、计数和版本。

顺序固定为“工件先耐久，数据库后引用”。C05 已负责原始 HTTP/SSE 响应的诊断工件；C08 保存该引用及解析后候选，不复制原始正文。任务 Schema 不定义 chain-of-thought 字段，运行时不请求、提取、展示或另存思维链。

### 7. 候选以类型化增量进入确定性收口

模型只能返回任务注册的领域操作。例如检索审阅可表达“接受证据引用/请求限定补搜”，措施组合可表达“选择措施引用/排序/资源目标”，不能表达路径式 patch 或完整实体替换。

确定性校验器逐项输出 `accepted | rejected`、稳定原因码和证据引用：

- 可修复：字段、格式、引用、冻结候选集越界、增量不完整。若仍有同一预算，可把结构化原因加入下一次模型输入并生成新候选版本。
- 终止拒绝：权限、来源资格、版本不兼容、规则冲突、处置建议的触发指标一致性/规范合规性/现场资源与工序约束可执行性失败。这些失败不进入修正循环。

只有确定性结果收口器可以通过下游原领域端口形成正式结果。被拒候选继续作为审计工件，绝不成为业务事实。

### 8. PostgreSQL 只保存运行时所需事实

迁移归属 `agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts` 与 `000006_agent_proposal_artifact_ref.ts`，在现有 `business` schema 中建立最小表集：

| 表 | 用途与关键约束 |
|---|---|
| `business.agent_tasks` | 信封引用、内部状态、`task_version`、累计预算、取消标记、当前结果/提案引用；任务 ID 唯一，终态受约束 |
| `business.agent_task_attempts` | Worker attempt、lease owner/token/until、起止时间、失败分类；一个任务至多一个有效租约 |
| `business.agent_task_actions` | 稳定 action ID、attempt/sequence、类型、意图/结果工件引用、reservation/usage、状态；task+action 唯一 |
| `business.agent_task_candidates` | 不可变候选版本、父候选、增量/校验/结果引用和分类；task+candidate version 唯一 |
| `business.agent_command_confirmations` | 提案版本、确认/拒绝、用户与授权引用、目标版本、时间；同一提案版本一次决定 |

不新增 Agent 审计表，事实审计写 C03 `audit.entries`。不新增 Outbox 事件；只有下游原领域接口产生 C02 已声明事件时，才由该领域事务写 Outbox。任务表不是 checkpoint，checkpoint 也不能替代任务表。

数据库权限复用现有应用与 Worker 角色，只授予这些表的必要 DML；不新增通用角色或 schema。迁移测试沿用 C03 fixture 与 RLS/权限检查方式。

### 9. Worker 使用有界数据库队列与租约

`apps/worker/src/agent-runtime/runner.ts` 实现单一循环：按稳定顺序以 `FOR UPDATE SKIP LOCKED` claim 配置上限内的任务，执行一步或一个受限批次，续租，随后释放或提交终态。并发上限取部署配置与任务预算的较小值，不在运行时动态放大。

恢复规则：

- 已完成 action：复用结果工件和 usage，不重发。
- 已记录 intent、确认未发出：安全重试并沿用 action ID。
- 已提交幂等领域命令：按同一 command idempotency key 查询或重放，获得相同结果。
- 外部效果不确定且无法核对：记录 `AGENT_ACTION_UNCERTAIN`，停止自动重试。
- 确认前写提案：停在 `waiting-user-confirmation`，Worker 不占租约等待。
- 租约过期：新 Worker compare-and-set 获取新 attempt；预算和既有动作不重置。

C03 命令幂等键覆盖 start/resume/cancel/confirm；动作使用由 task ID、候选版本和 sequence 派生的稳定 ID。相同键不同 payload 返回 idempotency conflict。

### 10. 错误使用稳定代码而非脆弱文案

C08 内部错误至少覆盖：

`AGENT_INPUT_INVALID`、`AGENT_AUTHORIZATION_DENIED`、`AGENT_TASK_NOT_FOUND`、`AGENT_STALE_VERSION`、`AGENT_IDEMPOTENCY_CONFLICT`、`AGENT_POLICY_NOT_FOUND`、`AGENT_POLICY_MISMATCH`、`AGENT_TOOL_NOT_ALLOWED`、`AGENT_TOOL_LIMIT_EXCEEDED`、`AGENT_BUDGET_EXHAUSTED`、`AGENT_CONTEXT_LIMIT_EXCEEDED`、`AGENT_CANDIDATE_LIMIT_EXCEEDED`、`AGENT_CONCURRENCY_LIMIT_EXCEEDED`、`AGENT_WALL_CLOCK_EXCEEDED`、`AGENT_MODEL_FAILURE`、`AGENT_TOOL_FAILURE`、`AGENT_VALIDATION_REJECTED`、`AGENT_CONFIRMATION_REQUIRED`、`AGENT_CONFIRMATION_STALE`、`AGENT_ACTION_UNCERTAIN`、`AGENT_ARTIFACT_FAILURE`、`AGENT_PERSISTENCE_FAILURE`、`AGENT_CANCELLED`、`AGENT_UNSUPPORTED_VERSION`。

公共端口按 C02 `ModuleErrorV1` 分类映射授权拒绝、幂等冲突、过期版本、瞬态失败、终止失败和不支持契约。测试断言错误码、状态和引用，不锁定完整文案。

## Ownership and integration

### Core

- `packages/core/src/agent-runtime/schema.ts`
- `packages/core/src/agent-runtime/state.ts`
- `packages/core/src/agent-runtime/runtime.ts`
- `packages/core/src/agent-runtime/index.ts`
- `packages/core/test/agent-runtime/agent-runtime.test.ts`

Core 只依赖 contracts、Zod 和传入端口，不依赖 PostgreSQL、C05 HTTP 或 Worker。

### Adapter

- `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`
- `packages/adapters/src/agent-runtime/index.ts`
- `packages/adapters/src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts`
- `packages/adapters/src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000006_agent_proposal_artifact_ref.ts`
- `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`
- 对应迁移 fixture

Adapter 组合 C03 `TransactionUnitV1`、C04 `ArtifactStoreV1`、C05 model gateway 和 C06 authorization；不复制它们的实现。

### Worker

- `apps/worker/src/agent-runtime/runner.ts`
- `apps/worker/src/agent-runtime/index.ts`
- `apps/worker/test/agent-runtime/runner.test.ts`

Worker 只负责 claim/lease/execute/cancel/recovery，不包含下游业务 Schema 或 UI。

### Shared files

实现阶段由主调度统一修改 `packages/core/package.json`、`packages/adapters/package.json`、`apps/worker/package.json` 及 Worker 中央注册。只添加现有 workspace 包引用和导出；不新增外部依赖，不应修改锁文件。

## Downstream contracts

| Change | 任务类型 | 注册内容 | 输出 |
|---|---|---|---|
| C15 | `data-cleaning` | 清洗动作、部分可用判断、确定性格式/来源校验 | `ContentArtifactRef` |
| C17/C19 | `knowledge-authoring` | 知识候选增量、领域引用、发布前校验 | `ContentArtifactRef` 或 `KnowledgeRevisionRef` |
| C21 | `retrieval-review` | 证据接受/拒绝、有界补搜动作、候选范围校验 | `RetrievalArtifactSetRef` |
| C27 | `response-recommendation` | 候选措施选择/排序、三项确定性约束 | `RecommendationCandidateRef` 或 `ResponseRecommendationRef` |
| C29 | `calibration-suggestion` | 校准建议候选、偏差证据与人工发布前校验 | `CalibrationSuggestionRef` |

下游只能通过注册定义和 C02 端口接入。需人工审阅时，下游用候选/校验引用创建 C07 任务；C08 不拥有知识发布、处置采纳或校准发布决定。

## Patent and Agent-native traceability

- RI-S21–RI-S23：C15 `data-cleaning` 的清洗、部分可用与回溯候选。
- RI-S31–RI-S45、RA-S3：C17/C19 `knowledge-authoring` 的工序、机理与标准条文知识编制。
- RI-S52–RI-S56：C21 `retrieval-review` 的检索审阅、有界补搜和冻结上下文；RI-S57 保持专用 LLM 节点并直接进入确定性校验。
- RA-S7：C27 `response-recommendation` 只组合/排序候选措施并接受三项确定性校验；C29 `calibration-suggestion` 只生成偏差超限后的建议候选，生效需人工确认。
- Agent-native 横切契约：五类必经任务、统一信封、最小工具、硬预算、类型化增量、确定性收口、交互确认、工件审计、无思维链和失败不降级均由本 capability 固定。

## Testing strategy

只新增能保护稳定行为边界的测试，不断言完整提示、错误文案、SQL 格式或内部调用顺序：

- Core 表格驱动测试：五类信封、状态转换、策略匹配、预算原子预留、可修正/终止拒绝、错误码和结果族。
- Adapter 集成测试：迁移约束、claim/lease、compare-and-set、幂等 start/confirm、C04 先于引用、C03 审计原子性、零 Outbox 事件和权限。
- Worker 测试：崩溃恢复复用完成动作、效果不确定不重发、取消传播、租约接管不重置预算、并发不超额。
- 安全回归：未列工具、跨工程/资料、模型切换、预算扩容、JSON Patch/整对象覆盖、无确认写入、必经失败降级均被拒绝。
- 全仓验证沿用 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；规划工件先运行 OpenSpec strict validate 和 `git diff --check`。

## Risks / Trade-offs

- **数据库轮询而非新消息系统**：复用 C03 PostgreSQL 可减少基础设施和双写一致性问题；任务吞吐超过数据库队列能力时再单独立项，不在 C08 预建消息抽象。
- **任务定义为代码注册**：牺牲运行时任意扩展，换取可审计 Schema、工具与校验边界；新增任务类型必须走 OpenSpec 和发布流程。
- **不确定外部效果停止自动重试**：可能需要人工恢复，但避免重复业务副作用。只有目标端口提供稳定查询/幂等保证后才允许自动恢复。
- **C02 公共状态较粗**：内部 `retryable-failure` 和 `terminal-failure` 都映射为公共 `failed`，细分通过结构化错误引用读取；避免在 C08 越权改公共契约。

## Migration plan

1. 前置确认 C03–C07 已归档，C05/C06 公共接口与迁移 `000001`–`000004` 保持一致。
2. 主调度确认 `000005`、`000006` 迁移号和共享包文件所有权。
3. 先实现 Core DTO、状态、预算和任务定义注册，再实现 migration/adapter，最后接入 Worker。
4. 下游 C15/C17/C19/C21/C27/C29 分别注册自己的定义；在此之前 C08 可以独立完成合同和恢复测试，但不会创建模拟业务定义作为生产默认值。
5. 完成相关 package 测试和全仓验证后，使用项目 OpenSpec apply/verify/archive 流程；本规划 change 不执行实现、归档或提交。

## Open questions

None. 若 C03–C07 归档结果改变公共端口、授权表达或迁移顺序，按 replan condition 返回主调度重新规划。
