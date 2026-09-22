## Context

固定 base commit：`07d1a599ae91be781c490090dad2e8a77dc2f625`。C02 已冻结 `RiskIdentificationPortV1` 的 `assemble-and-infer`、`repair-and-validate`、`merge-run-candidates`、`route-acceptance`、`accept-groups` 命令及结果引用，C01 已提供模型六字段结果和标准化风险记录七字段的唯一 Schema，C03/C04/C05/C07/C10 分别提供事务审计、内容寻址工件、授权、人工复核和结构化模型网关。C21 已把正式五项上下文登记为 `model-context` 结果并保存到 C04，但 C22 尚无候选、校验、合并、验收或标准化记录实现；C24 的工作计划生产者、I0～I9 图和生产接线仍是后续范围。

规划调查确认 HTTP 已暴露现有 C02 分支，权限映射也已包含 `risk-identification.run/finalize`；本 change 不需要公共契约、事件、权限或依赖变化。协调端已批准 C22 自有追加式持久化与 `000042` 迁移，并要求中间正文留在 C04、标准化记录只复用现有共享 Schema、C03 原子提交记录/审计/回执/事件、C07 只拥有复核任务和决定。

## Goals / Non-Goals

**Goals:**

- 用一个 C22 深模块闭合 RI-S57～RI-S65：冻结上下文生成候选、确定性校验与有界修正、全运行合并、综合置信度、验收路由和正式记录入库。
- 让每个正式引用都能回放到输入快照、工作项、五项上下文、模型/提示、策略、原始响应、校验、合并、决定、审计和事件。
- 复用现有模型网关、工件、事务、授权和复核运行时，不创建第二套任务系统、记录字段或事件。

**Non-Goals:**

- C24 的识别工作计划生产者、I0～I9 LangGraph、检查点和阶段接线；C23 的人工复核页面/交互；C31 的查询投影和报告。
- 修改 C02 contracts、C05 权限矩阵、C07 公共端口、C10 模型协议、领域事件或引入第三方依赖。
- 风险评估、P/C、风险矩阵、预警、处置，以及用模型或人工决定绕过确定性校验。

## Decisions

### D-01. C22 是一个候选收口深模块，C24 只负责图接线

新增 `packages/core/src/identification/candidate-finalization/{schema,ports,service,index}.ts`，集中定义 C22 私有严格 Schema、纯校验/合并/置信度算法和窄端口；新增 `packages/adapters/src/identification/candidate-finalization/{postgres-risk-candidate-adapter,index}.ts`，实现 C03/C04/C05/PostgreSQL/C07 接缝；新增 `apps/worker/src/identification/candidate-finalization/{runtime,composition,index}.ts`，组合 C10 模型调用、有界修正和公开 `analyze/finalize` 分支。C24 后续把其工作计划 reader、识别运行和图状态接到该组合，不在 C22 建平行图或伪造生产工作计划。

选择一个模块而非按候选、合并、验收拆包，是因为五阶段共享同一冻结身份、策略、工件登记、权限和幂等边界；拆包会复制读取与一致性检查。`packages/core/package.json`、`packages/adapters/package.json` 增加同名子路径导出，`apps/worker/src/index.ts` 只增加模块导出；无新依赖。

### D-02. 私有 Schema 引用 C01 SSOT，不复制标准化记录字段

核心层定义以下严格、版本化内部对象：`RiskCandidateSetV1`、`CandidateValidationSetV1`、`IdentificationGroupV1`、`MergePlanV1`、`AcceptanceRouteSetV1`、`AutomaticAcceptanceDecisionV1`、验证/证据快照以及生成、修正、合并、置信度、强制复核策略。`RiskCandidateSetV1` 的每项模型内容直接嵌入并解析 `ModelOutputResultSchema`；正式记录直接用 `StandardizedRiskRecordSchema` 和 `StandardizedRiskRecordEnvelopeSchema` 构造，不定义形状相同的私有 Schema。

候选额外信封固定 `candidateId/versionId`、工程、输入/工作项/上下文引用、工序节点、模型/提示/输出 Schema/预算策略、原始响应、父候选版本和生成时间。合并组固定全部候选成员、来源资料段、机理条目、三类相似性证据和是否跳过；验收路线固定组、综合置信度、阈值/强制策略、自动决定或人工任务引用。集合去重并稳定排序，摘要使用现有 canonical JSON + SHA-256 基础工具，只用于不可变身份和幂等，不作为业务相似性或安全门禁。

### D-03. 所有输入与策略都按精确引用窄读，无 latest 和默认值

C22 需要四个必需窄读接口：

- `ModelContextReaderV1`：用 C21 `IdentificationContextResultStoreV1.readResult` 找到同工程 `model-context` 登记，再通过 C04 读取并解析实际 `ModelContextPayloadV1`；返回前复核 ref、输入、工作项、工程、授权摘要和五项内容。
- `IdentificationWorkPlanReaderV1`：由 C24 后续注入，按 `IdentificationWorkPlanRefV1` 返回精确识别运行、输入快照、完整工作项和应收集的已校验候选集合；缺失时生产组合拒绝构造，测试夹具不得成为生产 fallback。
- `RiskCandidatePolicyProviderV1`：按命令引用读取生成/修正、规则、仿真、合并、置信度、强制复核与模型预算精确版本，并校验其属于输入冻结的 `IdentificationPolicySetRefV1`；不提供默认策略。
- `IdentificationReviewDecisionReaderV1`：从 C07 当前事实读取精确 `identification-group` 任务和决定，返回 pending/decided/blocked 闭合结果，不返回自由正文。

每个公开命令先解析 C02 Schema，再由 C05 按命令自带精确分支验证当前授权；读取 C21/C07 等下游事实时，由组合根的授权 provider 以同一 actor、工程、运行和不扩大的空间/资料范围签发对应现有读分支。目标存在性查询前及正式结果返回/写入前再次验证；撤权、跨工程和范围扩大统一安全失败。

### D-04. RI-S57 是直接使用 C10 的专用模型节点，不进入 C08 Agent

`assemble-and-infer` 由 Worker runtime 完整读取 D-03 的五项上下文和生成策略，把五项依据作为受保护模型输入，以命令指定的 `modelDeploymentRef`、`promptTemplateRef` 和策略中的预算/期限调用现有 `ModelGatewayPortV1.completeStructured`。输出 Schema 是非空、有上限的 `ModelOutputResultSchema` 集合；C10 已保存原始响应和调用证据，C22 再把模型结果、上下文引用与调用回执组成候选工件并登记。返回的 `modelContextArtifactSetRef` 必须与命令输入完全相同。

该节点不注册新的 `AgentTaskTypeV1`、不创建 C08 任务，也不让同一模型以“审阅 Agent”再次判断自己的结果。选择直接 C10 调用，是因为项目契约明确把 RI-S57 定义为专用 LLM 节点，而 C08 的五类必经任务不包含风险候选生成。模型超时、长度终止、解析失败或预算越界保留 C10 诊断并映射为现有结构化模块错误，不以旧结果或部分候选成功收口。

### D-05. `repair-and-validate` 只允许同节点有界修正，决定性校验不交给模型

核心纯函数逐候选执行：共享六字段 Schema；候选工序与上下文 `nodeId` 一致；风险要素关系端点非空；证据 `sourceSegmentId/sourceVersion` 必须存在于五项上下文可见集合；机理引用来自同一发布且适用于节点；规则一致性策略；可选仿真/试验策略。每项生成结构化 check id、passed、reason code 和证据引用，汇总为 `CandidateValidationSetV1`。

策略把错误分为 `repairable` 与 `terminal`。只有字段、格式或冻结集合内引用问题可由 Worker 在原上下文、模型、提示、总 token/次数/墙钟预算内调用 D-04 同一节点生成子候选版本；每轮保留父版本、原始响应和校验。权限、来源资格、版本兼容、规则冲突、仿真约束失败或预算耗尽直接终止。全部候选通过后才登记 `ValidatedCandidateSetRefV1`；不合格候选保留失败证据并按现有结果/错误语义阻断，不创建同 Agent 复审。

### D-06. 合并使用冻结嵌入与确定性三信号，不使用纯字符串门禁

`merge-run-candidates` 先由 D-03 工作计划 reader 证明命令提供了本次运行全部应处理的已校验集合。Worker 按合并策略冻结的现有 C10 embedding 部署为候选 `riskEvent` 生成向量，保存模型/代际、原始响应和向量工件引用；核心层再确定性计算：工序一致性（同节点或策略显式允许的相关节点）、风险事件余弦相似度、资料段集合相似度。三项阈值、权重、聚类顺序和平局规则全部来自 `mergePolicyRef`，输入稳定排序，结果可重放；不得用纯字符串相等、首项或模型自由判断代替。

满足策略的候选形成 `IdentificationGroupV1` 工件；不满足者各自形成独立组并记录 `no-duplicate`。组保留每个成员和三信号证据，原候选不变。任何集合缺失、跨运行/工程、策略/嵌入部署错配或向量失败都拒绝整个 merge plan，不对部分集合先路由。

### D-07. 综合置信度和验收路由完全由版本化策略确定

核心层对每组按 `confidencePolicyRef` 组合模型置信度、规则一致性、可选仿真约束和多来源合并贡献；策略规定精确权重、归一化、缺项行为与小数舍入，输出 `[0,1]` 值和逐项 basis。检索 RRF 分数不得进入该公式。缺少策略要求的依据时阻断，不把模型置信度直接当综合置信度。

`route-acceptance` 对每组同时应用置信度阈值和 `forcedReviewPolicyRef`。高于阈值且无强制条件的组生成 C04 `AutomaticAcceptanceDecisionV1` 并登记 `RouteDecisionRefV1`；低置信、合并歧义或强制规则命中的组通过现有 C07 `requestReview` 创建 `identification-group` 任务，验证/证据快照也作为 C04 工件登记。复核请求使用 C07 现有授权、事务和事件，不在 C22 建任务表。技术失败保持失败，不能降级为自动验收。

### D-08. 人工决定通过 C07 窄读验证，不能直接覆盖确定性结果

在 `PostgresReviewAuditAdapter` 增加与现有 `readRuleConflictDecision` 同形的内部窄读 `readIdentificationGroupDecision`，按工程、完整任务 ref、目标组 ref 和 `review-audit.trace` 当前授权读取 C07 自有表；它校验任务 `decided`、任务/目标/决定引用完全一致及决定联合合法，仅返回决定 kind、可选 revised candidate ref、决定 ref 与时间。该方法不是 C02 公共端口，不增加权限或事件；对应 C07 adapter 测试覆盖 pending、错目标、撤权和事实不一致。

`accept-groups` 逐组验证路线和决定：自动组只接受登记在同一路由集的系统决定；人工组只接受 D-08 返回的同版本决定。`approve-unchanged` 和 `confirm-merge` 可继续入库；`approve-revised-candidate` 重新进入 D-05，`keep-separate` 重新进入 D-06/D-07，二者本次返回业务阻断供 C24 路由而不直接入库；`reject` 和 `return-upstream` 阻断。命令中组与决定必须一一对应，任一缺失、重复、陈旧或错配时整条命令失败，不部分验收。

### D-09. 一个追加式中间登记表和一个不可变正式记录表

迁移固定为 `packages/adapters/src/postgres/migrations/risk-identification/deliver-risk-candidate-validation-merge-and-acceptance/000042_risk_candidate_finalization.ts`，创建：

1. `business.identification_finalization_results`：追加登记 `candidate-set | validated-candidate-set | identification-group | merge-plan | validation-snapshot | evidence-snapshot | route-decision | acceptance-route-set`。主键为 `(project_id,result_kind,result_id,result_version_id)`，保存 `content_digest`、C04 `artifact_ref`、输入/工作项/工作计划/运行引用、策略引用、确定性 disposition/conclusion、授权范围摘要、actor、授权上下文、审计引用和三类时间；CHECK 约束每种 kind 的必需引用组合。相同完整 ref + digest 返回既有登记，同 ref 异 digest 冲突；只 INSERT/SELECT，不 UPDATE/DELETE。
2. `business.standardized_risk_records`：以 `(project_id,risk_record_id)` 唯一保证同一风险记录只能成立一次，另保存精确 `version_id`、共享 `StandardizedRiskRecordEnvelopeSchema` payload、输入快照、运行、组、路由、决定、候选/来源工件引用、授权上下文、审计引用和三类时间。相同 `riskRecordId` 与同 payload 重放返回原记录，任一内容变化冲突，不产生新版本或覆盖历史。

中间正文只在 C04；登记表只保存引用与确定性结论。正式记录 payload 可以保存，因为它是识别域业务事实，且每次写入/读取都以 C01 共享 Schema 解析。`riskflow_app` 和需要消费事件的既有 worker 角色仅获得必要 SELECT/INSERT，PUBLIC 撤权，无 UPDATE/DELETE；审计外键 `DEFERRABLE INITIALLY DEFERRED` 适配 C03 写入顺序。当前没有后续外键时不预建未来表或解除块；后续 change 如建立外键，再按既有迁移 `down()` 顺序解除。

### D-10. 正式记录、审计、回执和事件在一个 C03 事务成立

候选、校验、合并和路由先把正文写入 C04，再通过 `TransactionUnitV1.execute` 原子登记引用、命令回执和一条事实审计；C04 写失败不登记，数据库/审计失败不返回正式 ref，事务前孤儿工件沿 C04 既有回收规则处理。`accept-groups` 在一个 C03 事务内插入全部本命令标准化记录、命令回执、每记录审计与每记录一个既有 `identification.risk-record-accepted.v1` Outbox 事件；任一步失败整体回滚。

事件 `aggregateRef` 与 payload 的标准化记录 ref 完全一致，payload 只含记录、输入快照和识别运行 ref。相同命令由 C03 回执重放；竞争命令由记录唯一键收口为原逻辑结果或稳定冲突。C07 任务/决定保持其自己的事务，不与 C22 业务事务跨库合并；C22 只在入库前通过 D-08 重新读取已成立决定。

### D-11. 错误、可观测性与恢复使用现有闭合语义

所有外部结果使用 C02 `ModuleErrorV1`：结构/契约不符为 `UNSUPPORTED_CONTRACT`，授权/不可枚举拒绝为 `AUTHORIZATION_DENIED`，同键异载荷为 `IDEMPOTENCY_CONFLICT`，陈旧组/决定为 `STALE_VERSION`，业务校验/待重新路由为 `BUSINESS_BLOCKED`，模型/工件/数据库暂态失败映射现有技术错误并携带耐久诊断 ref。调用方不得匹配完整文案。

日志和审计只记录命令、ref、check/reason code、摘要、预算用量和三类时间；模型原始响应、五项正文和证据正文只通过有权 C04 读取，不进入错误或事件。重试沿用命令身份、冻结上下文、模型/提示、策略和已成立中间 ref；不能证明外部效果时先按登记/模型幂等身份对账，不盲目重发。

### D-12. 文件所有权与验证只覆盖稳定行为

新增 C22 core、adapter、worker 三组模块及 `packages/core/test/identification/candidate-finalization.test.ts`、`packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`、`apps/worker/test/identification/candidate-finalization/{runtime,composition}.test.ts` 和 D-09 迁移。修改 `PostgresReviewAuditAdapter` 及其现有测试补 D-08 窄读；修改两个 package manifest 和 Worker index 暴露正式子路径。

按协调裁决同步修改 `packages/adapters/test/postgres/postgres-foundation.test.ts` 的迁移 manifest 和 `packages/adapters/test/auth/fixture.ts` 的测试迁移白名单；这是 `000042` 的机械接缝，不改变迁移 provider。保持不动：公共 contracts、C05 权限、C07 公共端口、C21 实现/迁移、C24 图、API/Web、锁文件。

测试锁定稳定行为：严格 Schema/引用、可修正与终止错误、完整工作计划、三信号合并与显式 skip、置信度重放、自动/人工路由、撤权、C07 决定错配、同 `riskRecordId` 重放/冲突、真实 PostgreSQL 角色和 C03 审计/Outbox 回滚。模型通过固定结构化 gateway stub 断言输入/输出 ref 与预算，不断言提示全文或随机自然语言；合成样本标记“合成样本、待甲方复核”。

## Risks / Trade-offs

- 风险事件嵌入比纯字符串相等多一次模型调用，但避免脆弱匹配；冻结部署、向量工件和策略后可重放。若未来需要其它相似性，只新增策略版本，不改公共命令。
- C04 写入先于 C03 登记，事务失败可能留下不可消费孤儿工件；沿用 C04 现有回收语义，避免跨存储伪原子事务。
- C24 尚未提供生产工作计划 reader，因此 C22 可独立验收模块与窄端口，但不宣称识别图端到端可运行。
- 人工修订或保持分离需要回到 I5/I6/I7，增加一次图往返；这比在 `accept-groups` 内隐式重做并绕过阶段证据更安全且更清晰。

## Migration Plan

先运行 `000042` up/down/up、角色权限、追加式冲突和 C03 回滚测试，再接入 C21/C07/C10 窄端口与 Worker 组合。上线前确认 `000040`、`000041` 已应用且 `000042` 未占用，同步两个中央测试 manifest；应用回退只停用 C22 组合，不自动删除已成立候选工件、复核事实、标准化记录、审计或事件。生产历史表不做数据回填；C24 接线后才产生正式识别运行流量。

## Open Questions

无影响本 change 契约、迁移或施工范围的待决问题；C23/C24/C31 的交互、图和投影是已明确的后续所有权。
