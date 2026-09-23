## Context

C15 已把清洗后的工程输入冻结为 `IdentificationPreparationSnapshotV1` 并发布 `engineering.inputs-ready.v1`；C17、C21、C22、C23 分别拥有识别基础、五项上下文、候选收口和人工复核。当前 `packages/contracts` 已冻结 `IdentificationInputSnapshotV1`、I0～I9 `IdentificationStageResultV1`、`IdentificationGraphStateV1`、`RiskIdentificationPortV1` 与 `WorkflowPortV1`，C03 已提供独立 PostgreSQL LangGraph checkpointer 和业务事务单元。缺口只在把这些公开接口组合成生产识别子图，并为子图自有的输入、计划、阶段与运行事实建立可审计登记。

`engineering.inputs-ready.v1` 不携带 `parentRiskFlowRunRef`；因此它只能证明准备已就绪，不能独自构造合法的识别子运行。C30 顶层 `riskFlowGraph` 后续负责从该信号建立父运行并调用本 change 的内部启动入口。C24 直接消费的恢复信号仅包括已经携带精确 `resumeRunRef` 的 Agent 完成和 `review.review-resolved.v1`，避免从关联字符串猜测运行身份。

协调者已批准 C24 新增直接依赖 `@langchain/langgraph@1.4.17` 与序号 `000043` 的业务迁移。registry 元数据表明该版本要求 `@langchain/core@^1.1.48` 和 `@langchain/langgraph-checkpoint@^1.1.5`，与仓库现有 `@langchain/core@1.2.9`、`@langchain/langgraph-checkpoint@1.1.5` 及 `@langchain/langgraph-checkpoint-postgres@1.0.5` 兼容。

## Goals / Non-Goals

**Goals:**

- 用唯一 LangGraph `identificationGraph` 串联 I0～I9，复用 C15/C17/C21/C22/C23 的公开窄接口，不复制领域算法。
- 冻结一个可重放输入快照和完整工序工作计划；逐工作项保留上下文、候选与失败，逐合并组独立验收。
- 用追加式业务事实和既有 C03 检查点分别承载可审计结果与执行游标，支持幂等启动、暂停、恢复、重试、取消。
- 让 C30 能以父运行精确调用子图，并让 C21/C22 通过其既有 reader 接口读取 C24 产出的精确输入和工作计划。

**Non-Goals:**

- 不修改 `packages/contracts` 的 DTO、事件、端口、错误码或权限枚举。**例外（协调者已批准，仅加法）**：`WaitingRefV1Schema` 增加 `agent-task` 变体（见 D-05 的等待映射），既有三个变体不得改动；该新增使 `packages/contracts` 成为本 change 的允许文件。
- 不实现 C30 顶层 `riskFlowGraph`，不让 C24 独自把 `engineering.inputs-ready.v1` 推断成父运行。
- 不改写 C17/C21/C22/C23 已有知识、检索、候选、合并、置信度、复核或验收入库逻辑。
- 不实现评估图、API、Web、查询投影、策略发布后台或检查点清理策略。
- 不预先实现并发扇出；逐工作项顺序推进即可满足当前规格，并减少 reducer、竞态和重复副作用面。

## Decisions

### D-01：C24 暴露一个内部识别子图运行时，不新增公共契约

在 `apps/worker/src/identification/graph/` 定义 Worker 内部的 `IdentificationGraphRuntimeV1`，包含 `start`、`resume`、`cancel` 三个命令。`start` 必须接收现有 `WorkflowRunRefV1` 形状的 `parentRiskFlowRunRef`、C15 准备快照引用、actor、授权上下文、业务时刻、命令 ID、幂等键和执行配置版本；`resume`/`cancel` 必须接收精确子运行引用和预期运行状态版本。实现返回现有运行引用、状态、等待/错误/结果引用，不引入 contracts 导出。

C30 后续拥有公开 `WorkflowPortV1.startRun` 和 `identify-and-assess` 父运行；C24 只提供可组合的子图入口。C24 的 `RiskIdentificationPortV1.plan/analyze/finalize` 适配器复用同一应用服务和持久化，不建立第二套路径。选择内部入口而非扩展公共 DTO，是因为既有事件与端口已足够，新增公共契约会扩大批准范围。

### D-02：I0～I9 使用单一 StateGraph，节点只做编排

`apps/worker` 使用 `@langchain/langgraph@1.4.17` 的 `StateGraph`，以现有严格 `IdentificationGraphStateV1Schema` 在入口、每次恢复和输出处解析状态，并用 C03 `createPostgresCheckpointer` 编译。固定拓扑为：

1. I0 校验父运行、准备引用和触发上下文并登记准备结果；
2. I1 解析 C17 识别基础和策略组合，冻结 `IdentificationInputSnapshotV1`；
3. I2 从精确工序发布与资料范围生成一次不可变工作计划；
4. I3～I5 逐工作项调用 C21 `IdentificationContextService` 和 C22 `RiskCandidateFinalizationService.analyze`；
5. 所有可处理工作项达到 I5 终态后，I6～I7 调用 C22 `finalize` 形成全运行合并与验收路线；
6. I8 逐组复用 C22 验收/人工重路由能力；
7. 所有工作项与分组均达到稳定终态后，I9 保存运行汇总。

条件边只读取类型化状态与错误代码，分流到继续、等待、有限技术重试、拒绝、失败或取消。节点不得读取其它模块私表、Qdrant、文件路径或完整错误文案。逐工作项和逐分组都使用状态中的稳定游标顺序推进；以后只有在基准证明吞吐不足且能保持每项独立幂等时，才用 LangGraph `Send` 做有界扇出。

### D-03：输入快照与工作计划由核心纯函数构造，策略只解析精确版本

在 `packages/core/src/identification/graph/` 提供最小纯函数和严格内部 Schema：

- `resolveIdentificationInputSnapshot` 组合 C15 准备快照、C17 `IdentificationBasisResolutionV1` 与精确识别策略集；
- `buildIdentificationWorkPlan` 从同一工序模型发布、空间范围、资料版本和段集合生成稳定排序的工作项；
- `summarizeIdentificationRun` 仅在所有工作项和组具有允许终态时生成 I9；
- `classifyIdentificationGraphOutcome` 根据稳定错误代码和 `retryable` 分类路由。

工作项 ID、查询依据和版本 ID 使用仓库现有规范 JSON 摘要工具从冻结输入确定性派生，数组按稳定标识排序后再摘要。调用方正文、当前时间或“最新版”不得参与这些身份。

一个由 Worker 组合根注入的不可变策略目录同时实现 C17 `IdentificationPolicySetProviderV1`、C21 `HybridRetrievalPolicyReaderV1` 和 C22 `RiskCandidatePolicyProviderV1`；目录必须按精确引用读取已审核配置且保留历史版本，没有内置业务默认值。C24 只把策略成员引用冻结进 `IdentificationInputSnapshotV1`，不拥有策略发布生命周期。

### D-04：C21/C22 通过已有 reader 接口读取 C24 工件

C24 adapter 实现 C21 `IdentificationContextInputReaderV1` 与 C22 `IdentificationWorkPlanReaderV1`。读取顺序固定为：校验当前授权和工程范围，按业务登记表精确定位 C04 工件引用，通过既有 `ArtifactStoreV1` 读取正文，再用 C01/C24 Schema 解析并核对摘要、工程、输入快照和版本。失败返回稳定的不存在、权限拒绝、摘要不一致或契约不一致错误；任何拒绝都不泄露对象是否存在。

这两个 reader 是 C21/C22 已预留的集成缝，不再定义等价接口。C24 也不复制其 PostgreSQL 结果表。

### D-05：暂停与恢复只沿原线程、任务和业务幂等身份

Agent 等待由 C08 精确任务引用表示；人工等待由 C23 精确 `ReviewTaskRefV1` 和 `WaitingRefV1` 表示。图在外部效果未知、任务未终结或人工决定未成立时登记等待业务事实，并通过 LangGraph interrupt 暂停。**等待映射（协调者已批准，仅加法）**：`WaitingRefV1` 增加 `agent-task` 变体（引用 `AgentTaskRefV1`），与既有 `ResumeCauseV1.agent-task-completed` 成对——同一任务引用即可复原该等待；C24 自有的三种等待（知识/策略未就绪、C08 Agent 任务未终结、人工决定未成立）到 `WaitingRefV1` 的投影只由 `packages/core/src/identification/graph/service.ts` 的单一 `toWaitingRef` 承担，`human-review` 用既有 `review` 变体，`knowledge-preparation` 用既有同名变体。恢复消费者必须先以事件 ID 和 producer 幂等身份去重，再校验项目、子运行、线程、任务/组版本、当前状态版本与当前授权，最后用原 thread ID 恢复。

Agent 完成恢复仍读取原 C08 任务事实和预算；`review.review-resolved.v1` 只恢复 payload 中 `resumeRunRef` 指向的等待组。重复或迟到信号返回原回执，不重复恢复、审计或副作用。无法确认外部效果时保持等待，不新建替代任务。

技术重试次数和退避来自冻结 `retryPolicyRef`，动作 ID 与首次尝试相同、attempt 单调增加；权限、版本、来源资格、规则冲突、确定性约束和幂等冲突不可重试。取消以预期状态版本做协作式登记，仅阻止未开始动作，不能撤销已提交事实。

### D-06：一张追加式登记表保存 C24 业务事实，正文继续归 C04

迁移 `000043_identification_graph.ts` 新建 `business.identification_graph_results`。该表只保存 C24 自有工件的精确引用和最小判别元数据，不保存文档正文、模型响应或 LangGraph state。固定 `result_kind` 为：

- `input-snapshot`
- `work-plan`
- `stage-result`
- `waiting`
- `workflow-error`
- `run-state`
- `run-result`
- `cancellation`

通用必填列为 `project_id`、`result_kind`、`result_id`、`result_version_id`、`run_id`、`run_version_id`、`command_id`、`idempotency_key`、`request_digest`、`artifact_ref`、`authorization_scope_digest`、`actor_ref`、`authorization_context_ref`、`valid_at`、`recorded_at`、`persisted_at`、`audit_entry_id`。判别专列为 `parent_run_ref`、`preparation_snapshot_ref`、`input_snapshot_ref`、`work_plan_ref`、`stage_result_ref`、`waiting_ref`、`workflow_error_ref`、`run_result_ref`；取消原因保存在 cancellation 工件正文并由 `artifact_ref` 精确引用。数据库 check constraint 保证每类只出现允许组合；I0/I1 的 `stage-result` 例外见 D-15。

主键为 `(project_id, result_kind, result_id, result_version_id)`；每个转换为其 stage-result、run-state 或其它登记派生独立稳定 `idempotency_key`，`(project_id, result_kind, idempotency_key)` 唯一并配合 `request_digest` 实现同载荷重放/异载荷冲突；`command_id` 关联同一外部命令下的多条登记。`(project_id, run_id, run_version_id)` 对 `run-state` 建条件唯一索引。表只有 `SELECT/INSERT` 权限，`riskflow_checkpointer` 无权访问；`audit_entry_id` 使用延迟外键到 C06 审计表。所有正文先写 C04，只有登记行与审计在 C03 事务单元提交后才成为正式业务事实。

现有 C21/C22/C23 结果仍由各自表拥有；C24 的阶段结果只引用它们，不复制正文或结论。读取时必须先读登记、再读 C04 并核对 digest；仅有工件或仅有未提交登记都不构成正式结果。

### D-07：业务提交与 checkpoint 明确采用可对账的两步顺序

每个节点按以下顺序执行：

1. 通过 C03 `TransactionUnitV1` 以当前命令/动作幂等身份提交 C24 登记、审计和需要的既有领域写入/Outbox；
2. 返回已提交业务引用并让 LangGraph 写独立 checkpoint；
3. checkpoint 失败时返回可重试基础设施错误，恢复先按业务幂等键回读首次提交，再重建仅含引用的小型状态。

图节点不得把 checkpoint 写入纳入业务事务，也不得从 checkpoint 生成数据库事实。恢复时 adapter 对状态内每个 C24/C21/C22/C23 引用执行当前授权下的精确业务回读；任一引用缺失、跨工程或摘要不一致即返回不可重试 `CHECKPOINT_INCONSISTENT`。C03 checkpointer 的 schema、表和权限保持不变。

### D-08：每个分组是 I8 的原子收口和幂等单位

I6 在全部可处理工作项达到 I5 稳定终态后只调用一次 C22 全运行 `finalize`。I7 保存每个组的自动或人工路线。I8 以 `(projectId, runId, groupId, groupVersionId, routeDecision/reviewDecision version)` 规范摘要派生稳定命令和幂等键，并逐组调用 C22 既有验收入口。

自动组可立即提交；人工组进入等待但游标继续处理其它组，最终再回到未解决组。修正并通过或保持分立使用 C23/C22 已定义的重路由结果重新进入对应确定性步骤；拒绝或退回只封闭当前组。标准化风险记录、命令回执、审计和 `identification.risk-record-accepted.v1` 的原子性继续由 C22 负责，图不做第二次写入。

### D-09：授权只复用现有 capability，并在每次效果前复验

启动、恢复和取消分别使用既有 `workflow.start`、`workflow.resume`、`workflow.cancel`；I0～I9 业务动作复用 `risk-identification.plan`、`risk-identification.run`、`risk-identification.finalize`，并由 C17/C21/C22/C23 各自复验知识、资料、Agent 与复核 capability。C24 不新增 capability、角色、API 路由或权限映射。

每个受保护读、Agent/模型提交和事务写之前均以当前 actor、project、空间、资料范围重新授权。冻结的 `authorizationContextRef` 只用于审计与可重建输入，不能替代当前授权。权限失败记录最小诊断引用，不保存无权正文，且不可通过重试或人工路线绕过。

### D-10：错误、审计和可观测性沿用稳定结构

C24 内部错误联合至少区分：`INPUT_NOT_READY`、`POLICY_NOT_READY`、`WORK_PLAN_INVALID`、`UPSTREAM_WAITING`、`RETRYABLE_INFRASTRUCTURE_FAILURE`、`AUTHORIZATION_DENIED`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`CHECKPOINT_INCONSISTENT`、`CONTRACT_INVALID`、`CANCELLED`。对外映射到现有端口错误信封，不改公共错误码；路由只读 code、retryable 和诊断引用。

每个状态转换记录 run/stage/work-item/group、前后版本、命令/幂等身份、actor、授权上下文、双时间、上游引用、结果或失败引用和 trace/correlation；不保存思维链。指标至少覆盖各阶段耗时与终态、等待时长、恢复去重、技术重试、checkpoint 对账、工作项/分组分类和授权拒绝，标签不得含正文或无限基数 ID。

### D-11：依赖精确锁定并纳入现有供应链门禁

只在 `apps/worker/package.json` 新增 `"@langchain/langgraph": "1.4.17"`，不改变现有 core/checkpoint 版本。同步 `pnpm-lock.yaml` 和 `config/dependency-policy.json`，记录 runtime 用途、MIT 许可证、移除条件（仓库现有已批准组件能提供等价 StateGraph）及直接依赖归属。`pnpm-workspace.yaml` 中的 `minimumReleaseAgeExclude: ["@langchain/langgraph@1.4.17"]` 是本 change 已批准精确版本的安装门禁例外，纳入文件所有权；它只影响该版本的发布时间等待，不引入或改变依赖版本，不能扩展为通配排除。实现阶段用仓库 pnpm 安装流程更新锁文件，并运行既有依赖策略、锁文件一致性、许可证/供应链检查；任一 peer 解析改变现有三项版本时必须停止并升级，不以 override 绕过。

选择正式 LangGraph 依赖而非自研状态机，是因为项目约束指定 LangGraph 为唯一编排核心，且仅 checkpoint 包不能编译 StateGraph。

### D-12：文件所有权与最小验证边界

- `packages/core/src/identification/graph/`：D-03 的纯函数、内部 Schema、错误分类和单元测试；`packages/core/package.json` 仅增加该子路径导出。
- `packages/adapters/src/identification/graph/`：D-04/D-06/D-07 的 PostgreSQL 登记、精确 reader 与恢复对账；`packages/adapters/package.json` 仅增加该子路径导出。
- `packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts`：唯一 C24 业务迁移；中央迁移/权限测试只做机械登记。
- `apps/worker/src/identification/graph/`：D-01/D-02/D-05/D-08 的 graph、runtime、恢复消费者和组合根；`apps/worker/src/index.ts` 导出内部组合入口。
- `apps/worker/package.json`、`pnpm-lock.yaml`、`config/dependency-policy.json`、`pnpm-workspace.yaml`：D-11 精确依赖治理与单版本安装门禁例外；后者已在本次重开批准范围内。

最小验证包括：核心快照/计划/汇总与错误路由；真实 PostgreSQL 下登记幂等、追加权限、reader 授权与 digest 对账、业务提交后 checkpoint 失败恢复；真实 LangGraph I0～I9 的成功、部分失败、Agent/人工等待恢复、迟到重复信号、协作取消和 checkpoint 不一致；现有 C21/C22/C23 回归；类型检查、格式、依赖治理和 OpenSpec 严格验证。测试断言稳定引用、终态、错误码和事务结果，不锁定节点内部调用顺序或完整文案。

### D-13：C22 整集验收的处置语义修正（drift，协调者已批准）

已归档 C22 的 `RiskCandidateFinalizationService.#acceptGroups` 原本把 `decisionDispositionFor(...) === "blocked"`（`reject` / `return-upstream`）的组处理为整条命令抛错，且任一被跳过组存在时整集返回 `skipped` 而**丢弃全部合格组的入库**。这与本 change 已批准的 I6～I8 规格（「一个等待、拒绝或失败组不得阻止其它已合格组入库」）和 D-08（「拒绝或退回只封闭当前组」）冲突，故按「代码为事实源、drift 用 change 修正」在本 change 内最小修正：

- 整集提交集校验**保持不变**：`acceptedGroupRefs` 必须恰等于该验收路线集的全部 routes，且每条决定必须重复检查、不得跨集引用；缺项只在「review 型且本轮无决定」这一种情形下按待定跳过，其余缺项仍失败闭合。
- 处置语义修正：`blocked`（`reject` / `return-upstream`）与既有 `reroute` 同形——只把该组记入 `skippedGroupRefs` 并继续处理其余组，被封闭组不产生任何标准化风险记录、审计或事件。
- 决定集校验收窄（仅此一处放宽）：提交集仍必须恰等于该验收路线集的全部 routes，每条决定不得重复；唯一允许的缺项是「review 型且 C07 窄读尚无决定」的 route——它按本轮待定跳过。未知/多余键与其它缺项仍在遍历 route 集后逐键失败闭合。授权依据是 spec「一个等待组不得阻止其它已合格组入库」与「自动组和人工组并存」，原实现会整条命令抛错导致无一入库。
- 收口语义修正：仅当**全部**组都被封闭或待定时返回 `skipped` 幂等空结果；只要存在合格组，就必须在同一 C03 事务单元内提交它们的记录、审计与 `identification.risk-record-accepted.v1`，不得因同集内有被封闭组或待定组而丢弃。
- 混合情形下 `skipped` 不再回传被封闭组引用，由 C24 依验收路线集与自身提交的决定推导并登记；公共成功联合的字段与既有校验未放宽。
- `packages/core/src/identification/candidate-finalization/service.ts` 及其测试因此纳入本 change 允许清单；C22 全量回归为必跑证据。

### D-14：C03 checkpointer 控制通道豁免（drift，协调者已批准）

已归档 C03 的 `PostgresCheckpointer` 校验层只把 `__error__`/`__scheduled__`/`__interrupt__`/`__resume__`/`__pregel_tasks` 视为协议通道，其余键必须命中 `IdentificationGraphStateV1Schema.shape`。真实 `@langchain/langgraph` 的行为使这一假设不成立：首个输入检查点把整份输入先写入 `__start__` 通道，条件边与屏障聚合会派生 `branch:to:<node>` / `join:<a>+<b>:<node>` 控制通道，因此任何真实 `StateGraph` 的每一次 `put`/`putWrites` 都会被拒绝（`CHECKPOINT_INCONSISTENT`）。C03 自身测试手写 `channel_values = { ...graphState, __pregel_tasks: [] }`，从未覆盖真实控制通道。

本 change 的最小修正（只在校验层）：把 `__start__` 并入协议通道白名单，并按 `branch:` / `join:` 前缀豁免动态控制通道；`withoutProtocolChannels` 与 `validateGraphStateWrites` 共用同一判定。输入检查点在状态物化前剔除控制通道后为空对象，此时 `parseGraphState` 改为把 `channel_values.__start__` 的值交给同一批 GraphState Schema 严格解析——真实 LangGraph 把调用方输入先写入 START 通道，C24 的 `invoke(state)` 下该值即完整状态，因此这只是增加一个取值位置，**不放宽任何校验**：两处解析都失败仍以 `checkpointer.graph-state` 拒绝。表结构、SQL、迁移、权限、角色与 schema 语义不变；剔除控制通道后 `channel_values` 仍必须严格解析为 `IdentificationGraphStateV1`，非控制通道的未知键、非法写入类型与越权写入仍以既有 `CHECKPOINT_INCONSISTENT` 失败闭合。`packages/adapters/src/postgres/checkpointer.ts` 及其测试因此纳入本 change 允许清单。

### D-15：I0/I1 的阶段结果在工作计划形成前独立登记（本次重开批准）

`IdentificationGraphResultRowV1Schema` 的 `stage-result` 判别固定要求 `stageResultRef`，仅将该判别的 `workPlanRef` 改为可缺省（数据库列可空，读回时同一事实表现为空值，两者都不写正文或伪造引用）；`000043` 的 `identification_graph_results_kind_ck` 对应固定 `stage_result_ref IS NOT NULL`、`work_plan_ref` 可空，其它七类判别及列组合保持原样。I0 和成功的 I1 先写 C04 阶段结果正文，再与 `run-state`（I1 另含 `input-snapshot`）在同一 C03 业务事务中登记阶段结果引用、审计和稳定幂等身份；其 `workPlanRef` 缺省。I2 形成工作计划后，图的 `advance` 对 I2～I9 仍必须携带该冻结引用，缺失时封闭失败。I1 未就绪时沿既有 `waiting` / `workflow-error` 路线，不伪造工作计划或成功阶段结果。

只修改 C24 内部 Schema、自有 `000043` 迁移 check、图登记和对应测试；不新增列、类别、迁移文件、权限或跨 change 契约，不复制 C21/C22/C23 正文。迁移 `up` 必须在新表和已存在的 C24 表上均把同名判别约束收敛为新允许组合：若表已存在，在迁移事务内替换该 check 并立即验证，不留无约束的已提交状态；重复执行保持相同约束、索引和最小授权。不得通过 `NOT VALID`、绕过约束或放宽其它类别实现。C24 尚未集成到主线，若发现已部署且不能安全收敛的旧表或需要额外迁移，应停止并升级。

## Risks / Trade-offs

- 顺序处理工作项降低首版吞吐，但显著缩小 reducer、并发授权撤销和重复副作用的状态面；性能基准证明不足后再通过新 change 引入有界并发。
- C04 工件写入与业务登记是有意的两步；可能留下未登记孤儿工件，但不会形成伪业务事实。后续可由 C04 生命周期治理回收，C24 不另建清理器。
- 业务提交与 checkpoint 不能跨库原子提交；D-07 的先业务后 checkpoint 与幂等对账保证最多重复执行编排、不重复领域副作用。
- C30 尚未实现时只能通过内部 runtime 和集成测试启动识别子图；这保持父子运行身份正确，避免临时事件推断路径日后成为第二套生产入口。

## Migration Plan

1. 新增精确依赖并更新锁文件与依赖策略，先运行 peer、许可证和供应链门禁。
2. 应用 `000043_identification_graph.ts`，创建追加登记表、约束、索引、延迟审计外键和最小角色授权；迁移前无历史 C24 业务数据，因此无需回填。
3. 部署 core/adapters 后部署 Worker graph；在 C30 接线前仅内部集成测试调用，不消费输入就绪事件自主建父运行。
4. 回滚时先停止新 C24 调度，再回滚 Worker/core/adapters；只有确认无须保留的 C24 数据后才执行迁移 `down`。C21/C22/C23 正式事实和 C03 checkpoint 表不随 C24 回滚删除。

## Open Questions

无。会改变公共契约、权限、迁移、依赖或范围的决定均已闭合。
