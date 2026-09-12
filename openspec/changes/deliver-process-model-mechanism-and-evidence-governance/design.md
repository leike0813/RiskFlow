## Context

动机见 [proposal.md](./proposal.md#why)，行为边界见 [spec.md](./specs/identification/process-model-mechanism-and-evidence-governance/spec.md)。当前代码已具备 C04 `ArtifactStoreV1`、C07 `ReviewAuditPortV1`、C08 `AgentTaskDefinitionV1`/`AgentRuntimeRunner` 和 C16 `PostgresKnowledgeGovernanceAdapter`；C16 把候选正文视为不透明工件，尚无 C17 内容校验与绑定，`resolveGovernedReleases()` 又把授权分支固定为 `knowledge-modeling.assessment-basis`。API 已有 generic knowledge/agent 路由，不需要新增 HTTP 路径，当前也没有需要接入的 Web 页面。

基线为 `1e51bec508ddad8e2ccdd5af9a9d17b593458af9`。C15 的规划检查点 `ba13a0d6f19609fcb4c6f0f40fc4dd035516effc` 尚未实现；它只作为精确识别准备和已收口清洗结果的接口输入。协调裁决固定了三项前置：`KnowledgeDefinitionTypeV1` 由独立契约演进加入 `standard-library`、`case-library`；`implement-engineering-data-read-branches` 实现 C02 已冻结的 `source-segments`、`evidence-access`；C17 可最小修正 C16 解析能力分支。迁移号段为 `000020`～`000023`，本设计只需要 `000020`。

## Goals / Non-Goals

**Goals:**

- 让五类识别知识共用一套严格包模型、确定性校验、C04 内容事实、C16 生命周期和 C07 人工复核。
- 让审核包导入与 C08 `knowledge-authoring` 结果落到同一修订/发布绑定，且任何失败都可审计、可幂等恢复。
- 为 C20/C24 提供按精确引用读取和解析的窄接口，同时保持工程、资料、双时间和策略版本边界。

**Non-Goals:**

- 不实现 C20 的 Qdrant/BM25、索引代际、RRF 或检索结果，不实现 C21～C24 的上下文审阅、候选识别和识别图。
- 不定义 C21/C24 拥有的识别策略集，不增加知识定义类型，不修改 `packages/contracts`、主 specs、根 workspace、锁文件或现有迁移 provider。
- 不实现第二套治理状态机、Agent 循环、审计表或工件仓库，不给 C17 增加 API 专用路由或 Web 页面。

## Decisions

### D-01：以三个可执行门作为实现前置

实施首项按集成后代码而非 change 名称检查：

1. `KnowledgeDefinitionTypeV1Schema` 能 strict parse `standard-library`、`case-library`，既有类型保持不变；
2. C15 的正式 `readBoundResult` 能按精确 `IdentificationPreparationSnapshotRefV1` 读取已收口结果，且 `implement-engineering-data-read-branches` 已使 C02 `source-segments`、`evidence-access` 返回可经 C04 复读的 `queryResultRef` 并执行当前授权检查；
3. C08、C16 归档能力及复数 `includedSourceSegmentSetRefs` 已集成。

任一门不满足即停止实现并升级；C17 不在本 change 补 contracts 或读取上游表。采用可执行语义门，是因为两个上游修正由调度端另行命名，绑定未确定 change 名会让施工图脆弱。

### D-02：一个严格判别联合是识别知识正文的唯一事实模型

`packages/core/src/identification-knowledge/schema.ts` 定义 `IdentificationKnowledgePackageV1Schema`，以 `definitionType` 判别五个分支：

- `ProcessModelPackageV1`：包头、精确校验策略引用、节点和依赖边；节点使用 contracts 的五类工序、设备/部件、状态参数、监测指标和适用性词汇，另含稳定条目标识、输入/输出和证据；
- `RiskMechanismPackageV1`：包头、所依据的精确 `ProcessModelReleaseRefV1`、机理条目；条目使用六类机理并引用工序条目标识、参数/指标和证据；
- `StandardLibraryPackageV1`：包头及规范条目，条目只允许国家/行业/企业层级、标准身份和版本、条款定位、适用性与证据；
- `CaseLibraryPackageV1`：包头及案例条目，记录受控施工方法、工程条件、过程/事件、结果、处置和证据；
- `RetrievalEvidenceBasePackageV1`：包头以及且仅有 `riskMechanismReleaseRef`、`standardLibraryReleaseRef`、`caseLibraryReleaseRef` 三个成员。

共用包头固定 `schemaVersion: "1"`、`projectId`、`definitionType`、`validationPolicyRef`、来源准备快照和生成时间。所有对象 `z.strictObject`，条目由包内稳定 ID 关联，不发明 C02 公共引用。`IdentificationKnowledgeValidationReceiptV1`、`IdentificationKnowledgeRevisionBindingV1`、`IdentificationKnowledgeReleaseBindingV1`、`KnowledgeAuthoringManifestV1`、`KnowledgeAuthoringIncrementV1` 和 `KnowledgeAuthoringFailureV1` 同处这一模块并复用 contracts 引用 Schema。

备选是给五类内容各建模块和生命周期；这会复制包头、证据和治理逻辑，因此不采用。把规范/案例嵌入检索组合也会耦合发布版本，违反独立演进，已由协调端否决。

### D-03：版本化注入策略驱动确定性校验

`IdentificationKnowledgeValidationPolicyV1` 由组合根以完整对象注入并以 `policyRef` 精确匹配包头，包含关键工序类别、各关键工序最低机理/证据覆盖、允许的规范层级/案例方法、每类条目上限和 C08 编制所需模型/提示/工具/预算/增量/校验引用。五类工序、六类机理和四类关系仍直接复用 contracts 领域枚举；覆盖阈值及关键工序选择不硬编码。

`validateIdentificationKnowledgePackage()` 按固定顺序返回逐项决定：strict/工程/类型 → 唯一 ID 与引用存在 → 五工序或六机理最小集 → 关系端点、自指、重复与时间环 → 适用性 → 证据资格 → 关键工序覆盖 → 组合成员。条目或 Agent 操作各自拥有稳定 `checkId`、`accepted | rejected`、原因码和证据；任何拒绝使整包不可发布。时间环用节点数加边数的普通拓扑遍历即可，无需图框架。

证据校验只调用 D-04 的窄读接口并接收资格决定，不读取资料正文来猜测来源。结构和关系错误可在 C08 同任务剩余修正预算内重试；权限、来源资格、跨工程、版本不兼容和组合冲突标为终止拒绝。

备选是让 Agent 输出“完整合法包”或质量分；这不可重放，也无法逐项说明接受/拒绝，故不采用。

### D-04：上游准备与证据只通过一个窄读接口消费

C17 adapter 以本地结构接口 `IdentificationPreparationKnowledgeReaderV1` 组合 C15 正式 `readBoundResult`、C02 `EngineeringDataPortV1.read` 与 C04；该接口不要求上游新增公共字段：

- `readExactPreparation({ projectId, preparationSnapshotRef, actorId, requestedAt, authorization })`：按精确引用返回 `IdentificationPreparationSnapshotV1`、C15 正式清洗结果工件引用及其可用性/保留范围摘要；必须证明 C08 清洗任务完成、结果双向绑定、`sourceVersionRefs[]` 与 `includedSourceSegmentSetRefs[]` 同序一一对应；读取行为形成上游查询结果/审计引用；
- `readSegmentSlice({ projectId, preparationSnapshotRef, sourceSegmentSetRef, segmentIds, limit, actorId, requestedAt, authorization })`：调用 `source-segments`，取得 `queryResultRef` 后经 C04 只复读该准备保留集合内的请求切片；
- `checkEvidence({ projectId, preparationSnapshotRef, evidenceReferences, purposeCode, actorId, requestedAt, authorization })`：调用 `evidence-access`，取得 `queryResultRef` 后逐项复读 `eligible | rejected`、稳定原因码及上游审计引用，不返回未授权正文。

三方法均要求 `engineering-data.read`、精确工程/空间/来源范围及 C06 当前决定；不存在和未授权对 C17 呈现同形失败。C17 只持有注入的 C15 正式 reader、`EngineeringDataPortV1` 和 `ArtifactStoreV1`，不知道其表或 adapter 私有方法。

### D-05：C17 façade 在 C16 前后设置内容门，不复制生命周期

新增 `PostgresIdentificationKnowledgeAdapter` 作为生产注入的 `KnowledgeModelingPortV1` façade，并持有 C16 adapter：

- `submit-revision` 若是五类 C17 定义，先从 C04 读取候选包、执行 D-03 校验并耐久保存校验收据，再调用 C16 `govern()`，最后绑定返回的 revision；其它定义原样委派 C16；
- `request-review` 对 C17 revision 只允许存在绑定；合格绑定走 C16，失败绑定只允许 D-08 的失败复核路径；未知绑定作为非 C17 定义原样委派；
- `publish-approved-release` 对 C17 revision 要求合格绑定，并在调用 C16 前重验组合成员和当前授权；成功后记录 release 绑定。失败修订永不通过此门；
- `deactivate-release`、`rollback-by-new-release` 对已绑定 C17 release 委派 C16，回滚成功的新 release 绑定到历史 revision；其它发布原样委派；
- `resolve()` 仅对 `identification-basis` 执行 D-09，评估分支原样委派已有解析组合；`retrieve()` 原样委派后续注入的检索实现或返回 C02 既有 `UNSUPPORTED_CONTRACT`，不在 C17生成结果。

生产组合只暴露 façade，不暴露裸 C16 adapter。跨 C03/C16 调用不能成为一个数据库事务，因此采用“先建门、后委派、最后暴露绑定”的可恢复顺序；没有 C17 binding 的 revision/release 不会被 C17 解析或发布。所有阶段使用派生且稳定的 command/idempotency key，重试先读取阶段收据再继续。

备选是修改 C16 解释 C17 正文或另建 C17 生命周期；二者都破坏 C16 的不透明内容边界。给 C16 增加通用插件注册表也只有一个消费者，暂不引入。

### D-06：C16 解析器只修正能力分支映射

在 `PostgresKnowledgeGovernanceAdapter.resolveGovernedReleases()` 内从 `requiredDefinitionTypes` 选择权限分支：全部属于 `process-model | risk-mechanism | retrieval-evidence-base | standard-library | case-library` 时使用 `knowledge-modeling.identification-basis`；全部属于评估知识族时继续使用 `knowledge-modeling.assessment-basis`；混合、空集或未知类型在数据库访问前返回 `UNSUPPORTED_CONTRACT`。其余筛选、双时间、停用和错误映射不变。

这是一处共享根因修正，避免 C17 新建第二个解析器。回归测试使用真实 C06 决定证明识别权限可用、评估权限和逐字段结果不变、交叉权限及混合族被拒绝。

### D-07：一个 `000020` 迁移保存索引事实而非正文

`000020_identification_knowledge_governance.ts` 创建四张只追加业务表：

- `identification_knowledge_validations`：规范化输入摘要、工程/定义类型、候选/校验工件、策略、准备、逐项决定摘要、总 disposition、授权、命令、审计和三时间；
- `identification_knowledge_revision_bindings`：C16 revision、validation、定义类型、`validated | failure-review-only`、可选 Agent task/failure 关联；
- `identification_knowledge_release_bindings`：C16 release、revision、定义类型、候选 artifact 和组合成员引用；
- `identification_knowledge_authoring_attempts`：幂等身份、manifest、task、目标类型/基线、阶段、结果 revision 或 failure/review refs。

唯一约束覆盖 `(project_id, idempotency_key)`、revision、release 和 task；check 约束使 validated/failure 字段组合合法，外键只指 C17 自有表，C16/C08/C04/C07 以完整版本引用和应用层 guard 连接。JSONB 只保存 strict 引用、策略和逐项决定，不保存知识正文、资料正文或原始模型响应。provider 递归发现迁移，不改中央清单；`000021`～`000023` 不创建空迁移。

备选是把包正文拆为节点/边关系表；C20 将建立可重建索引，当前拆表会制造第二正文事实源，因此不采用。

### D-08：复用 C08 定义和 runner，模块只提供编制适配

`createKnowledgeAuthoringTaskDefinition()` 注册现有 `knowledge-authoring` 类型，结果族只允许 `knowledge-revision`。`KnowledgeAuthoringManifestV1` 固定 D-04 读取的准备/清洗引用、目标定义类型、可选精确基线 release/artifact、验证策略、父运行、授权和全部 C08 版本引用；`prepareOrReplayAuthoringTask()` 先写 manifest 工件，再以其引用启动或重放 C08 任务并记录 attempt。

动作/增量是按目标类型判别的封闭操作：声明/退役工序节点与关系、声明/退役机理、引用/退役规范条款、引用/退役案例、选择三个组合成员。每项都带目标 ID、预期基线、证据和简短业务理由；禁止路径补丁、整对象替换和发布动作。两个只读工具分别调用 D-04 的 segment slice 和 D-05 的精确基线/release reader，工具观察仍由 C08 写 C04。

Worker 新增 `withKnowledgeAuthoringModelStep()`/`interpretKnowledgeAuthoringModelStep()`，只在 `taskType === "knowledge-authoring"` 时构造有界结构化消息和解析 `tool-request | candidate`，其它任务委派既有 callbacks。模块级 `KnowledgeAuthoringRunner.runOnce()` 先调用同一个 `AgentRuntimeRunner.runOnce()`，再调用 D-09 失败收口；不复制 claim、租约、预算、模型循环或恢复。

候选通过后 finalizer 把类型化操作应用到冻结基线、执行 D-03 完整包校验、写 C04 包，并走 D-05 submit 路径创建待审 revision；C08 保存每版候选和逐项验证。Agent 不获得 C16 publish/deactivate/rollback 工具。

### D-09：终态失败生成不可发布修订并幂等请求复核

`settleAuthoringFailures()` 只扫描 C17 `authoring_attempts` 中未收口的精确 task refs，再通过 C08 store 读取这些任务，不做全库 Agent 投影。对 `terminal-failure | cancelled` 且无合格 result 的任务，按以下顺序执行：

1. 以 C08 error、动作、候选、validation 和 usage 引用构造 `KnowledgeAuthoringFailureV1`，写 C04 diagnostic artifact；
2. 用稳定派生键直接调用 C16 提交一个目标定义类型的 failure revision，并写 `failure-review-only` binding；该正文是失败诊断，不伪装为有效知识包；
3. 调用 C16 `request-review` 创建 C07 `knowledge-revision` 任务，并把 review ref 绑定回 attempt。

D-05 发布门永久拒绝 `failure-review-only`。复核只用于人决定补资料、重启新 task 或结束处理，不能批准失败正文。`retryable-failure` 留给 C08 在原任务和累计预算内恢复，不提前创建复核；一旦预算或重试耗尽转终态再收口。每一步持久化稳定收据，重启不会重复 revision/review。

备选是直接用 diagnostic artifact 作为 C07 target，但公共复核目标不接受该类型；创建真实且不可发布的失败 revision 可复用现有 `knowledge-revision` 审核链并保持语义明确。

### D-10：识别基础解析组合 C15、C16 与外部策略提供者

`resolveIdentificationBasis()` 的顺序固定为：

1. strict parse C02 命令，以 `issuedAt` 作为 `asOfRecordedAt`；
2. 调用 D-04 `readExactPreparation`，复验工程和当前资料授权；
3. 调用修正后的 C16 resolver 解析 `process-model`、`risk-mechanism`、`retrieval-evidence-base`，再按 composite 绑定精确解析 `standard-library`、`case-library` 并确认 composite 的 risk mechanism 与独立结果一致；
4. 调用注入的 `IdentificationPolicySetProviderV1.resolveExact({ projectId, preparationSnapshotRef, requiredAt, asOfRecordedAt, authorization })` 取得 C21/C24 拥有的 `IdentificationPolicySetRefV1`；
5. 映射 C16 generic release refs 为 C02 已有三个 typed release refs，并返回四字段 success。

provider 不返回精确引用、准备不可读、任一发布/绑定/成员无效或授权失败均返回现有类型化错误，不形成部分成功。C17 不定义策略对象、类型或默认引用；C21/C24 后续若要求完整治理，另开契约演进。解析只按目标工程、类型、精确引用和双时间读取。

### D-11：授权、事务、错误和审计沿既有端口收口

- C17 public govern/resolve 在读取目标存在性前验证命令工程/actor 与 authorization 一致，并使用 C02 声明的 knowledge branch；资料读取另由 D-04 使用 engineering-data branch 复验当前来源范围。
- Agent 工具只持有读能力；finalizer/失败收口是领域模块动作，可使用冻结且收窄的 submit/review 能力；C16 的 human invocation 检查继续独占 publish/deactivate/rollback。
- C04 工件先耐久，随后每个 C17 阶段通过 `TransactionUnitV1` 原子写业务事实、命令回执和一条事实审计；没有 C02 声明的识别知识事件时提交零 Outbox 事件，不伪造事件。
- 内部错误映射到 C02 既有 `AUTHORIZATION_DENIED`、`ENTITY_NOT_FOUND`、`STALE_VERSION`、`BUSINESS_BLOCKED`、`IDEMPOTENCY_CONFLICT`、`UNSUPPORTED_CONTRACT`、`TRANSIENT_FAILURE`、`TERMINAL_FAILURE`。日志和错误只带原因码与引用，不带正文、凭据、模型响应或数据库错误。

### D-12：显式窄读接口是 C20/C24 的唯一消费面

core 导出 `IdentificationKnowledgeReleaseReaderV1.readExact({ projectId, releaseRef, actorId, requestedAt, authorization })`，返回 discriminated strict 包、validation receipt 和 release binding；adapter 实现先校验 C16/C17 binding、工程、定义类型和当前 C06 权限，再打开 C04 artifact。C20 只能用它构建索引，C24 通过 public `resolve()` 冻结识别基础；两者都不能读取 C17/C16 表。

这条接口有两个明确下游且隔离存储实现，符合跨层契约边界。当前不增加列表、全文搜索、批量 projection 或“当前版本”查询。

## Risks / Trade-offs

- [C15/C11 窄读接口或两个定义类型尚未集成] → D-01 作为首个硬门，未满足即停止，不在 C17 临时补契约或跨表读取。
- [C16 调用与 C17 binding 不是单事务] → D-05 以稳定阶段键和不可见未绑定状态恢复；resolver/publish 只接受完成绑定。
- [失败 revision 的正文不是合法知识包] → 独立 `failure-review-only` binding 永久阻断发布，复核界面显示诊断类型；不允许它进入内容解析。
- [一个 `knowledge-authoring` task 可能接近对象预算] → 工具分片、候选对象上限和墙钟由注入策略固定；耗尽后走 D-09，不隐式拆任务或扩容。
- [关系校验在大包上成本上升] → 使用 O(V+E) 拓扑遍历和策略对象上限；只有基准证明不足时再优化。
- [策略 provider 在 C21/C24 上线前无实现] → 组合根必须显式注入；缺失即 `BUSINESS_BLOCKED`，C17 无默认策略，知识治理其它命令仍可独立使用。
- [内容工件成功、后续事务失败产生孤儿] → 内容寻址写入可安全重放，只有 C17 binding 才可消费，孤儿交给 C04 既有保留/清理策略。

## Migration Plan

1. 确认 D-01 三项前置和基线 drift；运行 contracts、C15/C11、C08、C16 定向回归。
2. 运行 provider 自动发现的 `000020_identification_knowledge_governance`，验证 app/worker/checkpointer 权限和 down/up；不占用 `000021`～`000023`。
3. 部署 core Schema/校验、adapter façade 和 C16 branch 修正；生产 API 组合只注入 façade，先以审核夹具导入五类 draft/revision，不自动发布。
4. 部署 Worker 编制组合和失败收口，再由人工完成送审/发布；最后验证双时间解析、历史重放和 C20 窄读夹具。
5. 应用回滚时先停止 C17 新写入并回退 façade/Worker；C16 revision/release 和 C04 工件保留。仅在确认四张 C17 表为空时执行 migration `down`，已有业务事实不得物理删除。
