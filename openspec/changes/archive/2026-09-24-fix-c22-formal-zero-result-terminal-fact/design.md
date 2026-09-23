## Context

固定规划基线为 `2d470d2ffece7ba8cbf288ecdd022f33b9c6a684`。C22 主规格和 `RiskCandidateModelOutputV1Schema` 当前把空候选判为错误，C22 `#assembleAndInfer` 只登记非空 `candidate-set`；C02 `IdentificationAnalysisSuccessV1Schema` 与 I4 阶段 DTO 均强制携带 `candidateSetRef`。C24 的 I4 只有候选成功路径，I6 在没有已校验集时直接去 I9；I9 的 `IdentificationGraphRunResultV1` 尚无正式零结果引用。C22 `000042` 的追加登记 CHECK 只接受八类结果。已归档 C22/C24 与主规格是现状依据；本 change 是有意改变“合法空输出为失败”的既有语义。

批准引用 `approval://riskflow/C39/scope-2026-09-23-zero-result-semantics-and-consumer` 明确允许本 change 有意改变已归档 C22 的“合法空输出为失败”语义，并闭合 C36 消费面。本设计选择**仅合法、可解析、预算内的初次零候选**作为正式终态。解析、权限、来源、版本、预算及修正输出的失败仍按原闭合语义处理。

## Goals / Non-Goals

**Goals:**

- 给 RI-S57 的合法零候选一次独立、不可变、可授权回读的业务终态，保留 C10 原始响应到 C04 正文、C03 登记和审计的追溯链。
- 使 C24 I4/I9 可区分零结果、候选通过、候选失败和跳过；混合工作项仍只合并实际已校验候选。
- 保持既有非空路径、风险记录和事件行为。

**Non-Goals:**

- 判断工程“无风险”、引入阈值或模型自评来证明零风险；给零结果制造风险记录、评估事件、人工复核或空合并组。
- 把校验后全部候选拒绝、修正轮次空输出、I3 检索失败或资料不足归为正式零结果。
- 增加能力权限、外部 API 路由、第三方依赖或修改历史 `000042` / C24 `000043` 迁移。

## Decisions

### D-01. 零结果是独立事实，只有初次合法空输出可到达

`RiskCandidateModelOutputV1Schema` 的 `candidates` 改为允许 0～现有上限；C10 仍负责结构化解析与原始响应证据。`RiskCandidateFinalizationService.#assembleAndInfer` 在当前权限、五项上下文、冻结模型/提示/策略及预算检查之后按输出数量分支：大于零保持原路径，等于零形成 `RiskCandidateZeroResultV1`。修正轮次仍要求输出与待修正父候选数量一致，空修正输出失败。这里不接受空字符串、JSON `null`、缺 `candidates`、格式错或截断响应；它们沿 C10/C22 原错误路径，不因解析后候选数“看起来为零”转正。选择独立事实而非把 `RiskCandidateSetV1.candidates` 的下限改成 0，是为了让 C22/C24 下游不能把零结果当作已校验候选集或可合并成员。

### D-02. 公共分析结果和 I4 阶段 DTO 用精确引用区分路线

在 `packages/contracts/src/ports/index.ts` 定义 `IdentificationZeroResultRefV1Schema = versionedRef("identification-zero-result")` 并纳入现有类型导出。`IdentificationAnalysisSuccessV1Schema` 增加 `kind: "zero-result"` 分支，恰含 `modelContextArtifactSetRef` 与 `zeroResultRef`；既有 `assemble-and-infer` 和 `repair-and-validate` 分支字段不变。结果以 `kind` 分流，技术失败仍是原 `ModuleResult` 失败分支。`IdentificationStageResultV1Schema` 的 I4 分支允许原 `candidateSetRef`，或同时携带 `zeroResultRef` 与 `workItemRef` 的零结果；在同一个 schema 事实源上约束两形态恰有其一，旧 I4 正文仍可解析。I5 DTO 不变，零路线从 I4 直接跳过该工作项的 I5。`IdentificationGraphStateV1` 不增加新的大对象或冗余候选字段；零结果属于 C24 阶段与运行事实。

### D-03. C22 正文、追加登记与精确回读

在 C22 私有 `schema.ts` 定义严格 `RiskCandidateZeroResultV1Schema`：schema 版本、`outcome: "zero-candidates"`、`candidateCount: 0`、工程、输入快照、工作项、节点、正式五项上下文与检索工件集引用及上下文摘要、策略集/生成策略、模型/提示/输出 Schema/预算策略精确版本、C10 原始响应引用与调用身份、资源消耗、授权范围摘要和授权上下文、actor、命令身份、形成时间。内容只入 C04，使用新 purpose `risk-candidate-zero-result`；事实 `entityId` 由工程与工作项确定，`versionId` 由命令/幂等身份和冻结输入、模型、策略及授权范围的规范请求摘要确定，不取墙钟或模型文本作为幂等身份。C04 正文摘要另由内容寻址工件保证，重放同 ref 异正文必须冲突。`RiskCandidateFinalizationResultRowV1Schema` 增加 `resultKind: "zero-result"` 判别，携带 `workItemRef`、`modelContextArtifactSetRef`、`zeroResultRef`；基行已拥有工程、输入、C04 工件引用、摘要、actor 和授权。C22 adapter 增加该判别的列映射和精确回读，禁止整表扫描或从旧 `candidate-set` 猜零结果。

### D-04. 零结果登记使用原 C03 原子命令边界

先写 C04 正文，再在原 `#persistRows` / `TransactionUnitV1.execute` 单元提交 C22 追加登记、命令回执与审计；零结果与非空候选集注册**共用**既有 `identification.candidate-set.register` 命令类型及 `${command.commandId}:candidate-set` 回执/幂等身份，结果引用按分支不同。C04 失败无数据库登记，事务任一步失败无正式引用，事务前孤儿工件沿 C04 原回收约束处理。零结果没有 `identification.risk-record-accepted.v1` 事件。模型调用前，按工程、命令身份和当前授权精确回读既有零结果及其冻结请求摘要；同载荷返回原引用而不再次调用模型，同键异载荷稳定冲突；若命令已有非空候选结果则仍以原 C03/C10 幂等边界处理，不改写为零结果。并发零/非零竞争由共享 C03 回执身份阻断，不能同时成立两个正式结果。C22 对外提供最窄 `readZeroResult`，按当前 C05 `risk-identification.assemble-and-infer` 精确分支及其 `risk-identification.run` 能力和父授权收窄范围复验后，读取登记与 C04 正文、解析 D-03 Schema 并核对工程、输入、工作项、摘要和 ref；C24 只依此接口确认正式零结果，不能直接查询 C22 表。读取前及返回前均复验，撤权和跨工程引用不披露存在性。

### D-05. C24 逐项游标、恢复和汇总只记事实引用

I4 收到 `zero-result` 后以 D-04 窄读证明同工程、同输入、同工作项，再追加 I4 阶段事实，清除图状态中上一工作项可能留下的 `candidateSetRef`，推进当前工作项游标到下一个 I3；末项则去 I6，I6 在没有已校验候选集时沿既有路径直达 I9。清除是 C24 `advance` 的内部状态动作，不改公开图字段；恢复读到零结果 I4 阶段也不得从旧 checkpoint 复活候选引用。C24 `IdentificationGraphRunStateV1` 与 `IdentificationGraphRunResultV1` 增加与工作项逐项配对的 `zeroResults: { workItemRef, zeroResultRef }[]`，写新事实时显式填写；解析既有历史正文时缺省为空数组，不重写历史。`IdentificationGraphWorkItemOutcomeV1` 增加 `zero-result` 判别并要求对应精确事实引用；`summarizeIdentificationRun` 校验一工作项一终态、零结果属于计划内且不与失败/跳过/已验收重复。I4 阶段事实和运行状态以现有 C03 事务、审计及 C04 正文成立，checkpoint 仅缓存引用。恢复按 C24 已登记阶段/运行事实重建游标，并经 D-04 窄读复验每个零结果；缺失、错工程、错输入或摘要不符按现有 `CHECKPOINT_INCONSISTENT` / 契约错误失败闭合。I9 汇总中的 `zeroResults` 与已验收、失败、跳过分别计数，零结果不进入 `skippedWorkItemRefs` 或 `failedWorkItemRefs`；不以零结果宣称项目无风险。现有 C24 工作计划 reader 的 `validatedCandidateSetRefsFor` 仍只收集 I5 正式校验集，零结果不被合并覆盖检查误算为缺失。

为 C36 的 TN/覆盖证明，在 C24 `IdentificationGraphRegistrationStoreV1` 增加精确只读 `readCompletedRunResult({ projectId, runResultRef, actorId, authorization, requestedAt })`，返回 `IdentificationGraphRunResultV1 | undefined`，由现有 PostgreSQL adapter 实现：沿既有 `risk-identification.run`/C05 身份校验，按引用读取 `run-result` 登记、C04 正文和最新 `run-state`，核对工程、运行版本、`resultRef`、`status: completed`、正文 Schema 与工件摘要；返回前再次复验当前授权。缺失或无权统一不披露，引用/正文/状态不一致与工件故障均失败闭合，不能给 C36 空数组冒充证明。C36 只消费该 C24 公开端口、C24 现有 `IdentificationWorkPlanReaderV1.readExact` 和 D-04 C22 `readZeroResult`：要求非空计划内每项恰有一条 `zeroResults[]`，各条绑定同一工程、输入和工作项且可授权精确回读，并要求 `acceptedRiskRecordRefs`、`acceptedEventRefs`、失败、跳过、待复核、拒绝及取消集合均为空，才得出“**该完成运行在其冻结工作计划范围内没有 accepted 记录**”。任何混合、旧运行、未完成、撤权或缺证据都不得给出该证明；此结论不等于工程无风险。不开放 C24 数据库或 C04 原始正文给 C36，也不改 C24 D-07 的两步对账及 D-15 的阶段判别/`000043` 约束。

### D-06. 增量迁移只扩展 C22 结果类别和列组合

新增 `packages/adapters/src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.ts`。在同一事务中替换 `business.identification_finalization_results` 的 `identification_finalization_results_kind_ck`（它同时约束结果类别和列组合）：增加 `zero-result`，要求工作项、正式五项上下文及 `zero_result_ref` 非空，所有其它类别专列仍为空；给既有表新增可空 JSONB `zero_result_ref` 并替换 `identification_finalization_results_json_ck` 的对象类型 CHECK。新增仅对零结果生效的 `(project_id, command_id)` 唯一索引，支撑 D-04 重放预读并拒绝并发重复身份。原八类列组合、主键、摘要、外键、授权和 `business.standardized_risk_records` 保持不变。对已部署表 `up` 必须原子收敛并验证，不使用 `NOT VALID` 或重建表；重复应用保持同一约束。`down` 仅在没有零结果行时撤销该类别、索引与列，否则明确失败以保护已成立事实。`riskflow_app` 保持原表的最小 SELECT/INSERT，无 UPDATE/DELETE/PUBLIC 权限；新依赖为零。迁移发现清单和 auth fixture 仅同步 `000049` 的机械条目；`000043` 现仅引用 C03 审计，不对 C22 登记表建外键，本 change 不改旧迁移。若实施时发现新的跨 change 外键，须升级，不可悄悄改写旧迁移。

### D-07. 错误、审计和观测保持闭合

合法零候选是成功终态，不使用 `BUSINESS_BLOCKED`/`TERMINAL_FAILURE` 包装；模型不可解析、越预算、权限撤销、引用漂移、C04/C03 失败依旧映射原稳定错误码与 retryable 语义。日志/审计可记录 `zero-result` 结果 ref、命令、输入/工作项、策略版本、资源消耗和摘要，不记录五项上下文正文或原始模型响应。正常非空候选路径与 I5～I8 的错误、复核、风险记录和事件保持原样。

### D-08. 文件所有权与验证边界

`packages/contracts/src/{ports,workflows}/index.ts` 拥有 D-02；`packages/core/src/identification/candidate-finalization/{schema,service,ports}.ts` 与 `apps/worker/src/identification/candidate-finalization/runtime.ts` 拥有 D-01/D-03/D-04；C22 PostgreSQL adapter 与 D-06 迁移拥有追加登记；`apps/worker/src/identification/graph/{graph,runtime,composition}.ts`、`packages/core/src/identification/graph/{schema,service,ports}.ts`、`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` 拥有 D-05，包括 C36 可消费的只读端口。仅修改相应现有行为测试、迁移发现测试及 auth fixture。验证以一组有固定原始响应的合成样本覆盖非空、合法零候选、解析失败、预算越界、撤权、幂等重放/异载荷、事务回滚、C24 零/非零混合、完成结果精确回读和检查点恢复；合成样本待甲方复核。实际测试文件及命令以实施图的 IP-ID 固定。

## Risks / Trade-offs

- 新结果分支和增量迁移增加契约面，但比把空候选塞入非空候选集更容易证明终态、回放和不产生风险记录。
- 增量迁移修改已部署表 CHECK，需真实 PostgreSQL 检查已有八类行仍有效、零类别的权限/回滚/重复应用；生产 rollback 有零结果事实时必须拒绝删除列。
- 旧 I4/I9 C04 正文须能按默认空 `zeroResults` 解析；新事实只使用新分支，不回填历史失败为零结果。

## Migration Plan

先以 `000049` 原子扩展表约束并核对旧八类，再部署 C22/C02/C24 代码。旧运行和旧工件保持原语义；仅新命令在完整部署后产生零结果。若部署次序无法保证读写端同时理解新分支，暂停新 RI-S57 流量直至各端同版本，不把新事实退化为错误或候选。回滚应用代码前须确认不存在新零结果行；有行时保留可读版本并使用前向修复。

## Open Questions

无影响本次接口、迁移或实施文件范围的待决问题。
