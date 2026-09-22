## Context

固定 base commit：`251af7e7c6ec55865092e6aa1ba1a4c839d8d495`。C02 已冻结 `identification-group` 的六类 `ReviewDecisionV1`、`ReviewDecisionCommandV1`、`ReviewAuditPortV1` 和 `review.review-resolved.v1`；C07 已实现任务状态、授权、逐项事务、审计、幂等和恢复事件；C22 已实现候选/校验/分组/路线工件、确定性校验、决定窄读及标准化风险记录入库。

当前缺口位于两者之间：通用 C07 只保存引用，不读取或修正候选正文；C22 对 `approve-revised-candidate` 和 `keep-separate` 只返回重路由语义，且没有供复核者形成受控修订候选的入口。C24 的 I0～I9 识别图和事件消费、C31 的投影、C33 的 Web 交互尚未实施，C23 只能建立可被这些后续模块组合的后端复核深模块，不得提前实现它们。

## Goals / Non-Goals

**Goals:**

- 在一个识别复核操作中完成精确任务校验、允许字段修正、冻结证据校验、候选/校验工件登记和 C07 类型化决定提交。
- 保证 `modelConfidence`、工序绑定、模型输入与原始响应只读，人工修正不能绕过 C22 确定性校验。
- 复用 C07 的事务事件作为唯一恢复信号，并让批量原样通过/拒绝保持逐项授权、幂等、事务和审计。
- 在响应丢失、阶段性工件已写入或任务变陈旧时可以按既有命令与内容身份安全对账。

**Non-Goals:**

- 修改 `packages/contracts/**` 的公共 DTO/端口/事件、C05/C06 角色能力矩阵、C07/C22 数据库表或迁移。
- 实现 C24 识别图、工作流恢复消费者、C31 查询投影/报告、C33 API/Web 页面或批量 HTTP DTO。
- 允许人工修改模型置信度、工序节点、冻结来源资格、合并算法、综合置信度或正式记录字段。
- 引入新依赖、第二套复核任务/决定状态机或跨任务批量事务。

## Decisions

### D-01. C23 是组合 C07 与 C22 的单一深模块

新增 `packages/core/src/identification/human-review/{schema,ports,service,index}.ts`。`IdentificationHumanReviewService` 只公开 `decide` 与 `decideBatch`：前者处理一个识别复核动作，后者只接受原样通过/拒绝并逐项调用前者。服务依赖现有 `ReviewAuditPortV1.decideReview`、C07 的待处理任务窄读和 C22 新增的窄 `IdentificationReviewRevisionPortV1`，不直接读取 C07/C22 数据库，也不建立通用工作流状态。

`apps/worker/src/identification/human-review/{composition,index}.ts` 只把 C07 决定端口与 C22 候选收口实例组合为 C23 服务；C24/C33 后续消费该组合。选择独立深模块而不是把语义塞进 C07，是因为 C07 必须保持候选正文无关；也不把它塞进 C22 的公共 `RiskIdentificationPortV1`，避免扩张 C02 公共契约。

### D-02. 私有复核 Schema 嵌入既有 SSOT，不复制公共决定

C23 私有 strict Schema 以现有 `ReviewTaskRefV1Schema`、`IdentificationGroupRefV1Schema`、`ReviewDecisionV1Schema`、`RiskElementRelationSchema` 和 `EvidenceLocatorSchema` 为字段来源。单项动作固定公共命令身份、工程、主体、授权上下文、精确任务/目标、原因码和以下判别分支：

- `approve-unchanged`、`confirm-merge`、`keep-separate`、`reject`、`return-upstream`：不增加正文；
- `approve-revised-candidate`：携带精确来源候选集、来源已校验候选集、组内候选工件和一个 strict partial 修订；修订只允许 `riskSource`、`riskFactor`、`riskEvent`、`riskElementRelations`、`evidenceLocator`。

修订输入不包含 `modelConfidence`、`processNodeId/nodeId`、模型/提示/预算、来源、原始响应或综合置信度字段；未知字段直接失败。至少一个允许字段必须发生真实变化。来源候选集中的其它成员原样保留，目标候选增加版本并引用父候选；稳定排序防止相同语义因输入顺序产生不同身份。一次决定只修订一个候选，正好对应公共决定中的单个 `revisedCandidateRef`；多个候选应分别形成任务/决定，不在一个决定中发明多目标语义。

单项成功结果只返回精确 `ReviewDecisionRefV1`、`waitingRunRef`，修订分支再返回新 `IdentificationCandidateSetRefV1` 与 `ValidatedCandidateSetRefV1`。批量结果保持输入顺序并为每项返回自己的成功/失败结果，不创造公共批量 DTO。

### D-03. C07/C22 分别提供最窄任务读取与候选修订接缝

在 `packages/core/src/identification/human-review/ports.ts` 定义 `IdentificationPendingReviewReaderV1`，由 `PostgresReviewAuditAdapter.readPendingIdentificationReview` 实现。它先按 `review-audit.decide-review` 验证当前授权，再按工程和完整任务版本读取 C07 自有事实，只返回精确任务、目标、状态、验证快照、证据快照、复核策略和等待运行；不返回决定正文、证据正文或数据库行。非 `pending`、事实错配、跨工程和读取失败折叠为闭合失败。

在 `packages/core/src/identification/candidate-finalization/ports.ts` 定义内部 `IdentificationReviewRevisionPortV1`，由现有 `RiskCandidateFinalizationService` 在 `service.ts` 实现 `prepareReviewRevision`。该方法按精确工程、任务目标组、来源候选集、来源已校验候选集和候选工件读取 C22 追加登记与 C04 工件，证明候选属于当前组与两个来源集合，且全部事实属于同一输入、工作项、上下文和策略集；C23 不复制 C22 的工件定位、摘要、身份或登记规则。

方法基于原候选构造不可变后继：只替换 D-02 允许字段，保留 `modelConfidence`、`nodeId`、冻结输入、模型/提示/输出 Schema/预算、原始响应和模型生成时间，并写入 `parentCandidateRef`。新候选集保留父候选集和原始响应链，使用现有 `RiskCandidateSetV1Schema`、确定性身份函数和 C04 purpose code；不添加“人工候选”第二套 Schema。

备选方案是在 C23 中直接操作 `RiskCandidateFinalizationResultStoreV1`，但会复制 C22 的身份、C04/C03 接缝和登记规则，因此否决。

### D-04. 人工修订只走确定性重校验，不调用模型修复

`prepareReviewRevision` 从精确来源 `CandidateValidationSetV1` 复用其 `validationPolicyRef`、`ruleValidationPolicyRef` 和可选 `simulationConstraintPolicyRef`，并核对任务验证快照、候选集、已校验集、分组和策略集属于同一路线。随后复用 C22 `buildVisibleEvidenceIndex`、`evaluateCandidateSet` 对后继候选集逐项校验，不接受调用方另选策略，不使用 latest 或默认策略。

任何 entry 为 `repairable` 或 `terminal` 都返回结构化业务阻断，保持 C07 任务 `pending`。人工修订不调用 RI-S57 模型做自动补写：复核者提交的内容要么按原样通过确定性门禁，要么明确失败。全部 entry 为 `accepted` 时才保存 `CandidateValidationSetV1` 并返回候选集/已校验候选集引用。

### D-05. 冻结证据与当前权限共同约束证据调整

候选证据定位必须同时存在于任务的 `EvidenceSnapshotRefV1`、原 C22 五项上下文的可见证据索引和当前授权仍允许的来源范围。C22 窄端口先以调用者提交的 `review-audit.decide-review` 上下文通过现有 `RiskCandidateFinalizationAuthorizationPortV1.verifyCurrent` 复验，再读取组、候选和证据工件；它不请求 `risk-identification.run/finalize`，因此不扩大 reviewer 的能力，也不修改 C05/C06 策略。

修订只保存资料段定位和精确来源版本，不接收证据正文。跨工程、快照外、上下文外或撤权证据统一在正文披露前失败，日志与错误只保留安全的 ref/reason code。

### D-06. 决定提交只委托 C07，恢复只认既有事件

修订分支在 D-04 成功后构造现有 `ReviewDecisionCommandV1`，决定为 `approve-revised-candidate` 且 `revisedCandidateRef` 指向新候选集；其它分支直接映射同名公共决定。所有分支最终只调用一次 `ReviewAuditPortV1.decideReview`，由 C07 完成任务行锁、陈旧性、授权、决定、命令回执、审计和 `review.review-resolved.v1` 原子事务。

C23 不直接调用 `WorkflowPortV1.resumeRun`：C07 事件已携带任务冻结的 `resumeRunRef`，C24 后续是唯一消费和恢复识别图的位置。这样 reviewer 不需要 `workflow.resume` 或 `risk-identification.run` 权限，也避免决定提交后再发第二个非原子恢复命令。C23 单项成功只在 C07 返回成功后成立。

### D-07. 批量使用顺序逐项提交并预先拒绝结构问题

`decideBatch` 只接受 `approve-unchanged` 或 `reject`，批量长度上限复用 C22 的候选上限常量，且任务完整引用不得重复。服务先解析完整批量并检查上限/重复；结构失败时一项也不执行。通过后按输入顺序逐项调用 `decide`，每项保留自己的命令标识、幂等键、授权、C07 事务、结果、审计和事件；一项业务失败不阻断后续项。

选择顺序执行而非自建并发池，因为 MVP 批量有明确上限、数据库决定本就逐项锁行，顺序路径更易保持结果顺序和故障隔离；只有基准证明吞吐不足时才在不改变逐项语义的前提下增加有界并发。

### D-08. 修订工件登记与决定采用可对账的两阶段幂等

C04 工件写入先于 C03 登记，沿用 C22 的内容寻址孤儿回收语义。候选集与已校验候选集使用外层决定命令身份派生的稳定内部命令/幂等标识和 strict payload 摘要，在一个现有 `TransactionUnitV1` 事务中登记引用、命令回执和 `identification.review-revision-validated` 审计；不产生新领域事件。随后 C07 使用调用方原 `commandId/idempotencyKey` 提交决定事务。

若第一阶段成功、第二阶段陈旧或失败，修订工件与登记保持不可变但没有决定引用，不能进入 C22 验收；相同载荷重试复用既有引用并重新对账 C07 回执。若决定已提交但响应丢失，C07 重放返回原决定且不重复事件。同键异载荷由 C03/C07 现有摘要保护返回 `IDEMPOTENCY_CONFLICT`。不尝试跨 C04 与 PostgreSQL 制造分布式事务。

### D-09. 错误和可观测性沿用闭合结构

私有结果把结构非法映射为 `UNSUPPORTED_CONTRACT`，无权/不可枚举映射为 `AUTHORIZATION_DENIED`，陈旧任务/目标映射为 `STALE_VERSION`，修订或确定性校验失败映射为 `BUSINESS_BLOCKED`，同键异载荷映射为 `IDEMPOTENCY_CONFLICT`，C04/PostgreSQL 暂态故障沿用现有技术错误与诊断引用。调用方不得匹配完整文案。

审计只记录工程、命令、任务/目标/候选/校验引用、修正字段名集合、结果/reason code、主体、授权上下文和三类时间；不记录修改前后正文、证据正文、模型响应或思维链。C07 决定审计保持唯一正式人工决定事实，C23 的第一阶段审计只证明修订候选通过确定性门禁。

### D-10. 文件所有权、测试和导出保持最小

新增 C23 core 四文件、Worker 组合两文件及各自聚焦测试；修改 C22 `ports.ts`/`service.ts` 增加窄修订能力，修改 `PostgresReviewAuditAdapter` 及其现有测试增加待处理任务窄读，修改 `packages/core/package.json`、C22 Worker 组合和 `apps/worker/src/index.ts` 暴露模块。扩展现有 `packages/core/test/identification/candidate-finalization.test.ts` 验证 C22 窄端口，新增 `packages/core/test/identification/human-review.test.ts` 验证 C23 语义，新增 `apps/worker/test/identification/human-review/composition.test.ts` 验证生产组合。

除 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 及其测试外，不修改 `packages/adapters/**`；不修改 `packages/contracts/**`、`apps/api/**`、`apps/web/**`、锁文件和迁移。测试只断言稳定行为、类型化结果、引用、事件/审计计数和幂等，不锁定 SQL 顺序、完整错误文案或内部调用顺序；资料与候选使用“合成样本、待甲方复核”。

### D-11. 无公共契约、权限、持久化、迁移或依赖变化

C23 的动作/结果 Schema 是 `@riskflow/core/identification/human-review` 内部模块接口，不进入 C02 或 HTTP；后续 C33 若需要新增传输 DTO，必须另行 OpenSpec 规划。现有 C22 两类 result kind、C04 工件、C03 审计/回执、C07 任务/决定/事件已覆盖全部事实，因此不新增表、列、事件、角色能力或第三方包。

## Risks / Trade-offs

- 候选工件登记和 C07 决定是两个本地事务，中间失败可能留下不可消费的修订工件；稳定身份、回执对账和 C04 既有孤儿回收比跨存储伪原子事务更可靠。
- C24 尚未实现时，成功决定只保证可靠产生精确恢复事件，不宣称识别图已经恢复；C24 必须消费同一事件且不得重复模型调用或记录入库。
- 顺序批量牺牲少量吞吐以换取结果顺序和故障隔离；上限内无需额外并发抽象。
- C23 增加 C22 的内部窄端口，但不扩张 C02；若后续出现第二个候选修订消费者，再评估是否提升为更通用的候选版本服务。

## Migration Plan

本 change 无数据库或数据迁移。上线按“C22 窄修订端口 → C23 核心服务 → Worker 组合与导出”顺序启用；任一步缺少依赖时组合构造失败，不提供内存或默认回退。回退只停止 C23 组合并保留已成立的内容工件、C03 登记、C07 决定、审计和事件，不删除或改写历史。

## Open Questions

无影响本 change 规格、接口或施工范围的待决问题。HTTP/Web 交互由 C33、识别图事件消费与恢复由 C24、查询投影由 C31 按各自 change 规划。
