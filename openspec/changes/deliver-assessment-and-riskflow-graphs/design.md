## Context

固定输入 HEAD：`f8920b4254a4d638356678d5a6a82d801a86d6af`；schema：`orchestrated-delivery`；批准引用：`approval://riskflow/C30/scope-2026-09-23-assessment-and-riskflow-graphs`。C24 已导出 `IdentificationGraphRuntimeV1.start/resume/cancel`，C25～C29 已导出评估、预警、建议、反馈/偏差和校准窄用例；C03 提供事务、审计、Outbox 与 PostgreSQL checkpointer。公共 `WorkflowPortV1`、`ProjectionPortV1` 及三个图的状态 Schema 已存在，但无父/评估图生产实现和 C30 运行/路由存储。当前 `start-run` 的评估入口只接收单数监测快照，历史补算缺适用性/工程修订；投影查询只返回 `QueryResultRefV1`，正式风险记录的现有窄读只返回身份与摘要。

本设计只使用已归档 C03/C07/C24～C29 及其必要的 C11/C14/C18/C19 公开接缝。研究资料仅取 `references/风险识别与评估规划事实源摘要.md`。协调端已批准 C30 的最小加法公共输入、只读追溯端口与自有只追加迁移；这些决定不改变上游领域写入语义。

## Goals / Non-Goals

**Goals:** 完成 A0～A9 和有限 RA-S7 入口的已成立切片；建立父子运行、冻结版本、检查点、只追加运行/路由/追踪事实；让 `run-view`/`trace-chain` 有可读取的有界内容。真实 C24 多风险同容器链路和两个分段入口的成功路径按 D-10 转由后续 change 证明。

**Non-Goals:** 不复制 C18/C19/C25～C29 的计算或发布规则；不建立第二套流程状态机；不改 C10/C14 或 C24～C29 的既有写语义；不做 C31 的关联图/报告、C34 的完整前端页面、C36 的监测展示；不新增角色、能力值或生产运行时依赖。

## Decisions

### D-01：公共启动只补精确冻结引用，现有字段保持可解析

仅修改 `StartWorkflowRunCommandV1Schema` 的现有 payload 分支，在 `packages/contracts/src/ports/index.ts` 由 strict Zod Schema 派生类型：

| 分支 | 加法字段 | C30 正式运行门禁 |
| --- | --- | --- |
| `identify-and-assess` | `assessmentContexts?: {spatialScopeRef: SpatialScopeRefV1, applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1, monitoringSnapshotRefs?: MonitoringSnapshotRefV1[]}[]`（非空、每个空间恰一项） | C30 为每条验收风险按其精确空间使用配对上下文；缺少配对项阻断该风险的评估，不从其它空间推断 |
| `assess` | `projectRevisionRef?: ProjectRevisionRefV1`、`monitoringSnapshotRefs?: MonitoringSnapshotRefV1[]`（非空） | 工程修订必须显式存在；单数与集合规则同上 |
| `reassess` | `riskInput?: RiskInputVersionRefV1`、`projectRevisionRef?: ProjectRevisionRefV1`、`spatialScopeRef?: SpatialScopeRefV1`、`applicabilityMetadataSnapshotRef?: ApplicabilityMetadataSnapshotRefV1`、`monitoringSnapshotRefs?: MonitoringSnapshotRefV1[]`（非空） | 显式风险身份和上下文经 C25 `prepare` 与前次冻结输入及 `changedInputRefs` 核对；缺项拒绝 |
| `historical-backfill` | `projectRevisionRef?: ProjectRevisionRefV1`、`spatialScopeRef?: SpatialScopeRefV1`、`applicabilityMetadataSnapshotRef?: ApplicabilityMetadataSnapshotRefV1`、`monitoringSnapshotRefs?: MonitoringSnapshotRefV1[]`（非空） | 工程修订、空间、适用性与依据必须显式提供，按 `effectiveAt` 复验；缺少时拒绝 |
| `forecast-response` | `assessmentBasisReleaseSetRef?: AssessmentBasisReleaseSetRefV1` | 缺少精确依据集合时在父运行副作用前按入口引用不完整语义拒绝；公共结果为 `BUSINESS_BLOCKED` |
| `record-response-feedback` | `assessmentBasisReleaseSetRef?: AssessmentBasisReleaseSetRefV1` | 缺少精确依据集合时在父运行副作用前按入口引用不完整语义拒绝；公共结果为 `BUSINESS_BLOCKED` |

可选是传输解析兼容性；C30 运行时不默认缺失值。`assess` 的既有 `spatialScopeRef`/`applicabilityMetadataSnapshotRef` 原样使用。`identify-and-assess` 的配对上下文由调用方显式提供，与 C11 准备快照的空间集合逐项相等；每条风险按其精确空间取对应上下文，缺失时该风险的评估子运行阻断。既有顶层单数监测快照只在唯一空间且与该上下文同一单项时使用，否则拒绝。多监测集合规范去重并逐序列验证，不能从单数、当前流或 `changedInputRefs` 猜出遗漏序列。历史补算存在本 change 的正式入口，故同时兑现 C02 design §10 的适用性要求；字段缺失在 Schema 层仍可解析，在 C30 前置门禁安全失败。公共其它分支、结果、能力和现有签名不变。选择加法而非更名/删除旧字段，以免破坏现有传输解析。

### D-02：父运行拥有身份，识别子图只作为子运行

`apps/worker` 组合根以公共 `WorkflowPortV1.startRun/resumeRun/cancelRun` 为唯一对外工作流入口。`identify-and-assess` 先经 C06 当前授权校验，登记父 `WorkflowRunRefV1`/线程/命令回执，再使用 C11 正式识别准备快照调用 C24 `IdentificationGraphRuntimeV1.start`，传入真实 `parentRiskFlowRunRef`。父、识别子、各评估子运行身份按工程、父 ref、入口及精确输入的规范摘要稳定派生；同一已验收风险版本只启动一个评估子运行，排序与去重均按精确 ref。C24 的 I0～I9 保持其自身状态和持久化，父图仅保存子运行与结果引用。重复 `identification.risk-record-accepted.v1` 由 C03 consumer receipt 和业务唯一约束双重收口；等待复核不阻断已验收记录，无合格记录不生成空评估。外部 `engineering.inputs-ready.v1` 只能提供准备引用，父身份由 C30 从事件身份确定并登记，不传给 C24 让其自行猜父运行。

### D-03：评估图只编排领域窄用例

`assessmentGraph` 使用现有 `AssessmentGraphStateV1Schema` 的 `A0`～`A9`，节点只持精确 ref 和闭合状态。A0 通过 C11 `EngineeringDataPortV1.freeze(assessment-preparation)` 冻结显式入口/适用性/监测；A1 用 C19 正式依据集合及 C18 版本化策略；A2 调 C25 `RiskAssessmentPortV1.prepare`；A3～A5 调 C25 `evaluate`（C25 内部完成指标、P/C、矩阵、触发、评估记录原子提交）；A6 调 C26 `WarningLifecycleServiceV1.open`，空触发直接 A9；A7 用 C27 `RecommendationServiceV1.measureCandidates/createCandidate` 和 C08 有界任务；A8 调 C27 `validateAndRecord`，只在三项校验通过后保存正式建议；A9 汇总精确 refs、等待、失败与审计。图不得重算 P/C、阈值或三项约束，不为 A3～A6 创建 Agent。每步使用收窄的当前授权、固定命令/业务幂等身份；C25、C26、C27 各自的事务原子性保持不变，跨模块通过正式结果/事件引用衔接。

### D-04：预测、执行、反馈与校准是分段有限运行

建议采纳/拒绝只接受人工 `warning-response.adopt-recommendation` 决定。C30 先登记真实 `RouteDecisionRefV1` 与独立 `forecast-response` run，再把 `VerifiedResponseWorkflowBindingV1` 交 C28 `ResponseLifecycleServiceV1.recordDecision`；拒绝分支收口终态，不创建预测。采纳后 C30 冻结公共 `ResponseForecastInputSnapshotV1` 并调用 C28 `forecastResponse`；预测 `unavailable` 保留正式原因，不用模型或默认值。现场执行由现有 `record-execution` 命令独立发生。执行后 C30 依据精确 C14 快照和原风险输入新开评估，取得真实 C25 记录后才调用 C28 `recordFeedback`；正式反馈已成立时，公共 `record-response-feedback` 入口以 `feedbackRef` 创建独立有限运行，按 C28 `calculateDeviation` 与 C29 `CalibrationServiceV1.prepareInput/createSuggestion` 推进。偏差未越限或不可计算不伪造校准，越限后的 Agent 候选只形成待人工审核建议；C29 发布仍走其既有复核/治理端口。每段的跨日现场动作由人发起新命令，不让图长期等待现场行为。C28/C29 私有读接缝只在其所属服务内部使用。

### D-05：C30 持久化只追加最小运行事实

单个 C30 迁移 `000049_assessment_riskflow_graphs.ts` 建立三张自有表：`business.workflow_graph_results`（`entry-snapshot|stage-result|route-decision|run-state|waiting|workflow-error|run-result` 闭合 kind、工程/父子 run/thread、精确版本、输入/结果/工件 ref、命令/幂等/actor/授权摘要、业务/记录/持久化时间、审计 ref）；`business.workflow_graph_links`（同运行内 `fromRef`、`toRef`、闭合关系码、来源阶段与审计 ref 的可重建只读链边）；`business.workflow_query_results`（查询 ref、精确目标/运行、查询类型、冻结记录时间、actor/授权摘要、审计 ref）。关系码闭合为 `parent-child|run-stage|segment-process|process-mechanism|mechanism-risk|risk-assessment|assessment-warning|warning-recommendation|recommendation-forecast|forecast-execution|execution-feedback|feedback-deviation|deviation-calibration`，未发生的分支只登记阶段原因，不虚构链边。所有历史只 INSERT，新状态追加版本；唯一键覆盖工程+kind+精确结果版本、工程+run+命令/动作、链边身份和查询身份。正文只放 C04 受权工件，登记行只存引用；checkpointer 仍使用 C03 独立存储。阶段/路由/状态登记、C03 收据和 C07 审计同一个本模块事务提交，必要的领域事件遵守各自产生者事务；检查点可以滞后，但恢复必须精确对账已登记事实。查询链边为可重建投影，不是领域事实或审计替代。数据库不对其它 change 表设跨所有权外键，关联靠公开端口复验；角色仅授予最小 SELECT/INSERT，不授 UPDATE/DELETE。

### D-06：补两项公开只读接缝，投影按页构建

在 `packages/contracts/src/ports/index.ts` 增加独立 strict `RiskRecordTraceReadPortV1.readBatch`：输入 `{projectId, riskRecordRefs: StandardizedRiskRecordRefV1[1..100], requestedAt, authorization}`；结果按输入顺序逐项返回 `found` `{riskRecordRef, processNodeId, sourceSegmentIds[≤256], riskMechanismEntryIds[≤64], evidenceLocator?, auditTrailRef}` 或 `failed` `{riskRecordRef, error: ModuleErrorV1}`，其中边界超出以 `BUSINESS_BLOCKED` 和稳定 `blockerKind` 表示，不得携带风险正文。C22 所有者模块新增独立只读适配器 `PostgresRiskRecordTraceReader`，构造时必需注入 C06 当前授权校验，按工程+精确版本批量读取自有 `business.standardized_risk_records`，先用当前 actor、空间/资料可见性和已有 `projection.query` 分支复验，逐项过滤/拒绝越界；现有 C22 写适配器构造、写入与 `readRecord` 签名均不变。

另增独立 strict `ProjectionResultReadPortV1.readPage`：输入 `{projectId, queryResultRef, requestedAt, authorization, cursor?, limit: 1..100}`；成功结果 `{kind: page, queryType: run-view|trace-chain, items, nextCursor?}`，失败结果 `{kind: failed, error: ModuleErrorV1}`。`items` 是判别联合：`run-summary` 含 `workflowRunRef, parentRunRef?, status, entrySnapshotRef, latestResultRef?, auditTrailRef`；`trace-link` 含 `fromRef, toRef, relation, stageResultRef, auditTrailRef, evidenceLocator?`；所有 ref 使用既有公共版本引用，`relation` 只取设计 D-05 的闭合链边关系码。授权/不存在对调用方同形；版本过期使用 `STALE_VERSION`，游标失效、边界超出、链路不完整用 `BUSINESS_BLOCKED` 的稳定 `blockerKind`，技术瞬态用 `TRANSIENT_FAILURE`，均不携带正文。C30 投影 adapter 先以现有 `ProjectionPortV1.query` 登记精确目标和权限快照，再用该端口按查询登记的记录时点截取 C30 自有事实、按持久化时间及稳定键分页；最多一批 C22 `readBatch` 补齐来源边，绝不按每行跨模块查询。`cursor` 绑定 query ref、排序键和授权摘要，重读复验当前 actor/工程/空间/资料权限；失效、伪造、越权或目标不存在统一安全失败。单页 100 项、一次来源批 100 条、每条来源上限 256/64；超过上限返回显式有界失败或下一页，不截断成伪完整链。既有 `ProjectionPortV1` 和 HTTP query 结果签名不变；C30 的只读结果通过此独立端口供页面/后续 C34 使用。`risk-overview`、`association-graph`、报告导出和完整页面布局归 C31/C34，C30 不冒充其实现。

### D-07：权限、错误和人工边界

入口/每次恢复/每次受保护读及业务副作用前复验 C06 当前 actor、工程、空间、资料和现有 `workflow.start|resume|cancel`、`projection.query` 或相应领域 branch；下游授权只能收窄。无权与不存在对调用方同形，错误用公共 `ModuleErrorV1` 的稳定 code、阶段和诊断引用，不含正文/SQL/模型响应。审计失败阻断 C30 业务成功；普通日志只记 ref、code、耗时。Agent 仅用于已归档的建议组合与校准候选；人工采纳、执行、复核、校准发布均由既有领域命令/决定完成，图不能越权代替。

### D-08：恢复、失败与重放按事实源收口

`startRun` 同工程/命令 kind/幂等键同载荷返回原 run，异载荷冲突；`resumeRun`/`cancelRun` 必须匹配 `expectedStateVersion` 与精确等待/运行引用，事件消费再按 eventId 去重。检查点只有小型公共 graph state；恢复先读 C30 最新只追加 `run-state`、阶段结果与 C24/C25～C29 正式 ref，再与 checkpoint 对账；业务领先 checkpoint 时只从已登记结果补一个可证明增量，无法证明则 `CHECKPOINT_INCONSISTENT` 并零补写。瞬态失败只在冻结重试预算内以原动作身份重试；权限、来源、版本、规则冲突和处置约束失败不重试绕过。取消阻止未开始节点，保留所有已成立事实、事件、审计和可查询链边。

### D-09：可重现验收与 RI/RA 证据

使用“合成样本、待甲方复核”的识别/监测输入及标明版本的正式配置，在真实 PostgreSQL、C04、C03 checkpoint/Outbox 和公开端口下执行：RI-S1～RI-S6 由 C24 I0～I9 给出资料段/工序/机理/标准化记录；RA-S1～RA-S5 由 C25 冻结/评估，RA-S6 由 C26，RA-S7 由 C27/C28/C29。测试记录命令、输入/配置版本、各阶段/事件/审计 ref、`run-view`/`trace-chain` 分页结果，并从 C25 的冻结输入独立核对 P/C、矩阵与预警触发。还必须运行无预警、待复核、三项校验失败、偏差不可计算、重复事件、检查点落后/伪引用、越权、事务回滚与迁移重入路径。可重复命令在实施计划逐场景列出；证据为测试断言与持久化引用，不依赖模型输出硬期望。

### D-10：本轮交付边界及后续归属

按 `approval://riskflow/C30/finalization-2026-09-23-narrow-scope-and-archive`，D-02 的真实 C24 多风险父图扇出与 D-09 的真实同容器完整链路因 C24 `GraphInterrupt` 跨图检查点边界未闭合，交 C40 `fix-c24-nested-graph-interrupt-checkpoint-boundary`；不得在 C30 侧用 catch/retry 或伪检查点代替。D-01/D-04 中两个分段入口的依据缺失前置拒绝保留为 C30 已成立行为；携带完整合法引用后的预测和反馈成功路径、C28 人工决定及正式反馈命令输入交 C41 `wire-human-decision-and-feedback-commands`。C30 不修改 C24/C28 契约或写路径，也不扩大能力、权限、迁移和依赖。已成立的分段链与缺席原因可以验收，不能据此报告 R2/S1、R6/S1 或两个入口成功场景通过；`verification.md` 由收尾角色保留 BLOCKED 证据并标明 C40/C41 归属。

## Risks / Trade-offs

- 公共启动字段保持传输可选以兼容既有调用，C30 正式运行严格要求完整冻结引用；错误必须在副作用前暴露。单数与多项同时提交只接受等价单项。
- 查询投影只保留精确引用和有界摘要；同一读请求依赖当前授权，后续撤权会使历史查询不可见，但历史业务事实和审计不变。
- 没有跨 change 外键可降低迁移耦合，引用有效性靠运行时公开端口和重放验证。任何链边无法由登记结果或获权来源读取证明时返回不完整失败，不猜测链接。

## Migration Plan

迁移号以本固定 HEAD 的现有最大号 `000048` 后续 `000049` 为 C30 唯一新号；若并行集成占用该号，实施前升级，由主调度串行改号。`up` 在 C03 已有 schema 内以 `ifNotExists` 建表、收敛同名约束/索引与最小角色 SELECT/INSERT 授权，重复 `up` 结果相同；`down` 先撤 C30 自有查询/链边，再删运行结果，不修改上游历史表。无旧事实回填、无跨 change 外键；迁移测试侧清单只登记 `000049`。部署先迁移，再部署 C30 adapter/Worker/只读接缝；回滚先停 C30 消费与入口，再逆序执行 `down`，上游领域事实和审计不受影响。

## Open Questions

无影响本 change 规格或施工范围的待决决定。若实施发现上述公开批读无法在 C22 自有事实与 C06 授权下证明资料段→工序→机理，或其它任一跳只能直读非所有者私表，立即按批准记录升级，不以空摘要、Mock 或范围缩减收口。
