## Context

固定基线为 `79ffb524279c901be4f01e2911a5592c7460d888`，实际 schema 为 `orchestrated-delivery`。C26 已保存 `business.warning_records`、处置任务及其不可变版本与预警关联；C25 保存评估记录、输入和准备快照；C19 提供 `AssessmentBasisReleaseSetReaderV1` 精确成员读取；C18 提供 strict `MeasureLibraryContentV1Schema` 与 `selectMeasureCandidates`。C08 已有 `AgentTaskDefinitionV1`/registry、预算和任务事实，C03/C06/C07 已有事务、授权和审计。公共 `RecommendationCommandV1`、`RecommendationSuccessV1`、`ResponseRecommendationSchema`、C07 `response-candidate` 复核类型及 C09 路由均已声明，但没有 C27 生产实现；C17 的 `retrieve` 目前对所有查询返回 `UNSUPPORTED_CONTRACT`。

研究输入仅为 `references/风险识别与评估规划事实源摘要.md`。本 change 覆盖 RA-S7 的措施候选、建议生成与三项校验；评估事实和预警事实只按精确引用消费。

## Goals / Non-Goals

**Goals:**

- 在 C27 自有模块内闭合措施候选、C08 处置任务定义、建议候选、确定性校验和正式建议入库。
- 候选、校验、正式建议均能回到 C26 预警、C25 评估、C19/C18 已发布措施依据、C08 任务及 C07 审计。
- 只使用已归档公共 DTO、分支能力与现有基础设施；提供以后由 C30 图和应用组合根接入的真实窄接口。

**Non-Goals:**

- 不实现 C28 采纳/执行/预测/反馈、C29 校准、C30 LangGraph 或 C34 页面；正式建议不关闭任务。
- 不修改 C17、C18、C25、C26、C03、C06、C07、C08、C09 的生产模块或公共 `packages/contracts`；不以不完整 `WarningResponsePortV1` 激活未实现的 `record` 分支。
- 不引入依赖、默认甲方措施、提示词硬期望或第二套 Agent/审计/幂等基础设施。

## Decisions

### D-01：C27 只拥有 `recommendation` 业务边界

`packages/core/src/recommendation` 导出 strict 私有 DTO、候选选择与三项校验纯逻辑、`RecommendationServiceV1`（`measureCandidates`、`createCandidate`、`validateAndRecord`）及 `createResponseRecommendationTaskDefinition`。`packages/adapters/src/recommendation` 实现只读上下文、C04 读写、PostgreSQL 命令和 C08 `finalizeCandidate` 接缝。公共命令、结果、记录和引用直接从 `@riskflow/contracts` 导入；`create-candidate`/`validate-and-record` 以 `Extract<RecommendationCommandV1, ...>` 收窄。`measureCandidates` 接受既有 `KnowledgeRetrievalQueryV1` 的同名分支并返回 `KnowledgeRetrievalResultV1`；由 C27 adapter 提供该真实分支，组合根今后按 `kind` 委派，不改 C17。

替代：在 C17 `retrieve` 中加特例会跨越其所有权；新增公共 port/字段会改已归档契约；仅返回未实现错误会留下 C27 断链。

### D-02：精确上下文通过现有公开窄读与 C04 获取

`RecommendationContextReaderV1` 由 adapter 实现：先按当前 C06 授权和获准空间筛选 C26 的精确任务版本及完整预警关联，再按预警的精确评估引用读取 C25 评估、输入和准备快照并解析公共 Schema。以输入快照中的 `basis_release_set_ref` 调用 C19 `AssessmentBasisReleaseSetReaderV1`；在其 `configurationMembers` 中只接受 `measure-library` 成员，确认其发布引用与输入快照的 `measureLibraryReleaseRef` 相等，通过 C04 授权读取成员工件并以 C18 strict Schema 解析措施库。跨预警若工程修订、兼容集合、措施发布或适用性身份不同则失败闭合；不选最新发布、不直读 C18/C19 私有表、不修改 C25/C26 事实。

任务的风险事件类别由 D-06 正式处置生成策略按 C25 准备快照中的精确 `RiskInputVersionRefV1` 查唯一绑定；识别记录与外部事件均走同一绑定规则。缺少绑定或类别不在同版本 C18 措施库中时阻塞，不从自由 `riskEvent` 文本、外部事件键、预警方向或模型输出猜测类别。任一上游窄读缺失、摘要不符或调用方无权时，不枚举目标详情。

替代：复制评估/措施表会产生第二事实源；直接依赖 C19 表列或从当前发布解析会破坏重放。

### D-03：冻结候选与 `knowledge-query-result` 由 C27 自有事实承载

私有 `MeasureCandidateSetV1` 为 strict、有界 DTO：`schemaVersion`、工程、精确处置任务、预警和评估引用、D-06 类别绑定及生成策略版本、适用性/措施发布与兼容集合引用、候选措施快照（措施 ID、C18 原内容、匹配预警与证据）、输入摘要、创建人/时间。调用 C18 `selectMeasureCandidates` 逐个预警触发类型求集合，再按措施 ID 合并与排序；一个措施可关联多条预警，不丢掉触发关系。集合为空返回 `BUSINESS_BLOCKED`。冻结结果以 `KnowledgeQueryResultRefV1` 标识，在 C27 表中保存精确引用与 C04 内容工件、摘要；相同工程/任务版本/措施发布/输入摘要对应同一逻辑结果。公开 `measure-candidates` 查询只返回引用，C27 内部按精确引用且授权读取正文。

替代：让 Agent 即时查询措施库会使候选边界随发布变化；只存 ID 会失去可重建的措施内容和证据。

### D-04：C08 定义只接受选择和顺序增量

`ResponseRecommendationIncrementV1` 为 `{schemaVersion:"1", selections:[{measureId, order}]}`，数量有界、身份唯一、顺序从 1 连续；没有任意 `patch`、脚本或措施正文。`AgentTaskDefinitionV1` 仅支持 `response-recommendation`、`embedded`，白名单为空或仅包含冻结候选的授权只读工具，固定 C08 现有策略/预算字段；`frozenInputRef` 指向 D-03 工件。`validateCandidate` 检查每项身份属于冻结候选并逐项记录接受/拒绝；字段、格式、候选越界可按 C08 原预算内修正。`finalizeCandidate` 仅在合法增量后保存不可变 `RecommendationCandidateRefV1` 与任务/查询/生成策略引用，并作为 C08 `AgentTaskResultRefV1.candidateRef` 返回。C08 保留原始模型响应、工具行动、候选版本和预算；C27 不重复存思维链或模型循环。

替代：Agent 直接给措施正文或正式建议会绕过 C18 和三项确定性校验。

### D-05：公共 `create-candidate` 绑定既有 C08 结果

此命令解析公共 Schema，复验 `warning-response.create-candidate` 当前授权，按精确引用读取 D-03 查询结果和 D-04 已持久化候选，校验 `agentTaskResultRef.status=completed`、`taskType=response-recommendation`、主输出恰为同一候选、候选所属工程/任务/查询/生成策略全匹配。C08 完成候选时已有不可变实体，因此此命令不复制候选正文，只在 C03 原子命令中把该精确绑定作为命令载荷与结果写入回执和审计，并返回 `kind=candidate`。任务失败由 C08 失败证据窄读取证，返回公共类型化失败，不造正式建议。

替代：再次调用模型或从 Agent 结果直接信任 ref 会让冻结输入失效；复制第二份候选增加冲突。

### D-06：版本化校验策略与现场上下文由部署注入

`ResponseGenerationPolicyV1` 私有 strict DTO 固定工程、精确策略 ref，以及按完整 `RiskInputVersionRefV1` 唯一键排序的有界 `{riskInputRef,riskEventCategory}` 绑定；类别只能取该工程已审核 C18 措施库声明的类别身份，不能由 C27 改写风险输入事实。`ResponseValidationPolicyV1` 私有 strict DTO 固定工程、精确策略 ref、每项目标指标的甲方审核目标值、措施/规范许可关系、禁忌对应条件以及校验所需证据种类；`RecommendationSiteContextV1` 固定工程、精确 `siteContextRef`、空间与工序版本、可用资源、现场有效约束和证据引用。`RecommendationPolicyProviderV1` 只按 C25 输入快照冻结的 `responseGenerationPolicyRef`、`responseValidationPolicyRef`、`responseAgentPolicyRef` 与命令精确引用解析已批准版本；现场上下文由可信提供者按精确 ref 和时间取得，不接受命令内联规则或资源。类别未绑定、缺失、未审核、版本不合和空目标值失败闭合；甲方未提供正式包时使用标明“合成样本、待甲方复核”的测试输入，生产不生效。

替代：把策略常量写在业务代码或使用 `latest` 会违反配置版本契约。此处只解释既有策略引用，不扩充 C18 的闭合 11 类配置。

### D-07：三项校验为纯确定性顺序计算

`validateRecommendationCandidate` 先核对候选措施对每条关联预警的触发指标覆盖和目标值来源，再核对已发布措施的规范证据需求、禁忌与 D-06 已审核规范许可，最后核对现场可用资源、空间和工序状态；每步生成 `ValidationResultSchema` 加 C04 证据/原因快照，三步都执行以留下完整诊断。任何失败不生成正式记录。候选在 D-04 完成时固定 C08 `AgentTaskSnapshotV1.envelope.parentRunRef`，校验失败以该真实运行、`response-candidate` 目标和验证/证据快照向 C07 请求复核并返回 `kind=waiting-review`；复核的 `submit-revised-candidate` 必须形成新候选版本并重跑全部三项，`return-upstream/reject` 不发布建议。若源任务没有可验证的 parent run，候选生成即失败，不能伪造 review ref。

公共 `ResponseRecommendation.warningRecordId` 只能单值：规范选择精确预警引用排序后的首条作为主引用；全部预警的精确引用及校验关联保存在 C27 追溯关系中。`implementationOrder` 是选中措施 ID 的顺序，`measureItems.content` 从 C18 冻结步骤按业务序号组成，资源需求为去重并集，目标指标值只取 D-06 审核策略。资源并集为空、无目标值或公共 Schema 不通过即失败，不补伪值。正式记录 `reviewStatus=pending` 表示尚待人工采纳/审阅，三项通过状态另由各 `ValidationResult` 明确；C28 才可记录采纳或拒绝。

替代：只检查 Agent 自述合规或把人工复核当强制放行均不满足 RA-S7；为多预警改公共记录字段超出 C27 范围。

### D-08：命令、授权、事务与错误沿用 C03/C06/C07

读取/写入顺序为公共 Schema parse → C06 当前 actor/project/branch/空间与来源授权复验 → 精确上下文读取 → 策略/来源版本复验 → C03 `TransactionUnitV1.execute`。C27 的候选冻结、结果绑定、校验事实和正式入库各按自身命令身份写一份回执及 C07 审计；与其业务事实同事务提交，且不发明新的事件类型。校验失败时，先使 C04 快照耐久，再以稳定幂等键调用 C07 的独立原子复核请求，取得精确 review ref 后由 C27 事务保存失败校验事实、该 ref、审计和回执；C07 成功而 C27 事务失败时，同键重试复用同一 review ref，不能产生正式建议。C08 候选完成依 C08 原有事务/审计；C07 复核依其原子端口，不在 C27 再建复核表。数据库唯一键同时防不同命令并发产生重复正式建议。授权/跨空间/来源失败统一 `AUTHORIZATION_DENIED` 且不可枚举；版本冲突 `STALE_VERSION`，无合格候选 `BUSINESS_BLOCKED`，三项失败返回 `waiting-review`，同键异载荷 `IDEMPOTENCY_CONFLICT`，短暂数据库/工件失败 `TRANSIENT_FAILURE`，契约漂移 `UNSUPPORTED_CONTRACT` 或 `TERMINAL_FAILURE`。日志和错误只含代码与公开引用，不含措施正文、授权快照或 SQL。

替代：独立 receipt、审计表或进程锁重复基础设施；先查询目标再授权会泄露目标存在性。

### D-09：`000045` 建 C27 最小持久化与回滚

新增一条 `packages/adapters/src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.ts`；实施前复验该序号空闲。建 `business.measure_candidate_queries`（工程/任务/精确发布/输入摘要/工件引用）、`business.recommendation_candidates`（候选版本、Agent/查询绑定、内容工件）、`business.recommendation_validations`（候选/策略/现场精确版本、三项结果和 C04 快照）、`business.response_recommendations`（公共记录正文、主预警、候选/验证/任务/评估链与版本）。`create-candidate` 的命令到已完成结果绑定由 C03 回执和既有候选行表达，不再建重复关系表。不可变事实只允许 INSERT/SELECT；所有表约束工程、精确版本、摘要、非空、同输入唯一性、C26 外键和 C03/C07 审计关系；数据库约束负责同候选/验证策略/现场版本最多一条正式建议。迁移提供逆序 `down`，不修改 `000044` 或更早迁移。中央迁移发现清单、授权测试夹具如需登记，由主调度在集成检查点串行处理，实施 Agent 先报告精确位置，不自行越界。

替代：单 JSON 大表无法用 FK/唯一约束保证候选、校验与正式记录关系；拆多个迁移增加部署接缝。

### D-10：文件所有权、接线与最小验证

新增 `packages/core/src/recommendation/{schema,service,index}.ts`、`packages/adapters/src/recommendation/{postgres-recommendation-adapter,index}.ts`、D-09 migration 与各自对应测试；修改两个 package manifest 仅增加 `./recommendation` 导出。C27 不改 API route catalog、Web、C17/C18/C25/C26 或公共 contracts。`apps/api/src/http.ts` 已登记 `warning-response.create-candidate`、`validate-and-record`，但 `warningResponse` port presence 会同时暴露尚未实现的 C28/C29 `record` 分支，因此当前只导出真实 C27 分支处理器；完整 `WarningResponsePortV1` 由后续组合根在所有分支齐备时组装。

核心测试覆盖冻结候选、多预警、越界 Agent 增量、三项失败/通过、主预警选择；PostgreSQL 纵向测试用 C25/C26 正式事实、C19/C18 已发布措施与 C08 实际任务结果，检查授权、幂等、并发、回滚及完整引用链。运行相关 TS、lint、format、依赖边界、OpenSpec strict 校验；不写仅断言提示词或文案的测试。

## Risks / Trade-offs

- C19 公共窄读返回措施成员工件引用，C27 需经 C04 授权读取正文；若该工件无法按现有能力合法读出，实施须升级，不能直读 C18 私有表。
- C25/C11 公共记录没有稳定的风险事件类别字段；D-06 以已审核、精确风险输入版本绑定类别，未绑定输入不能生成建议。这属于 C27 私有策略数据，不修改风险输入或措施库的公共字段。
- C26 任务可关联多预警而公共正式建议只有一个 `warningRecordId`；D-07 固定主引用并以 C27 关系保存全部关联，避免改公共契约。若消费者要求公共 DTO 原生多预警，需另开契约 change。
- C07 复核任务要求有效等待运行；D-04 固定 C08 源任务的真实 `parentRunRef` 并供 C07 使用。C07 与 C27 分属独立原子端口，D-08 用稳定幂等键消除复核请求与校验事实之间的重试重复。

## Migration Plan

先确认 base HEAD、C25/C26/C19 表与窄读接口、`000045` 空闲；再追加 D-09 迁移及 core/adapter。测试真实 up/down、角色 grant、旧数据保留、原子回滚和重复部署；不回填旧预警为建议。主调度在集成时登记中央迁移清单并运行 PostgreSQL foundation 回归。

## Open Questions

无影响本 change 施工的未决公共语义；若 D-02 的公开窄读无法交付精确已发布措施正文，必须升级并停止对应 IP。
