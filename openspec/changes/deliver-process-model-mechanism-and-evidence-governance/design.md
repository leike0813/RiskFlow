## Context

动机见 [proposal.md](./proposal.md#why)，行为边界见 [spec.md](./specs/identification/process-model-mechanism-and-evidence-governance/spec.md)。当前实现已包含 C17 Schema、校验、PostgreSQL façade、Worker 生产组合、C08 失败证据公共窄读和 C16 发布/授权接缝；API 已有 generic knowledge/agent 路由，也没有需要接入的 Web 页面。核对 `645a9352c1b1ef731556dea22196a95b2c14fc85` 的真实代码后，剩余 drift 是 `PostgresIdentificationKnowledgeAdapter.resolve()` 对 `assessment-basis` 直接返回 `UNSUPPORTED_CONTRACT`，而已集成的 C19 `PostgresScoringRulesAdapter.resolve()` 已拥有正式评估依据解析。

本次重开规划以 `approval://riskflow/C17/replan-2026-09-20` 为批准凭据，只闭合 C19 delegate 注入、C17 adapter allowlist 和对应验证。C15/C08/C11 所有权、既有 Non-Goals、公共 contracts、C19 解析规则、C17 四表迁移和 C16 生命周期语义均不变；迁移号段仍为 `000020`～`000023`，只使用 `000020`。

## Goals / Non-Goals

**Goals:**

- 让五类识别知识共用一套严格包模型、确定性校验、C04 内容事实、C16 生命周期和 C07 人工复核。
- 让审核包导入与 C08 `knowledge-authoring` 结果落到同一修订/发布绑定，且任何失败都可审计、可幂等恢复。
- 为 C20/C24 提供按精确引用读取和解析的窄接口，同时保持工程、资料、双时间和策略版本边界。
- 让 C17 façade 的 `assessment-basis` 分支经组合根注入的既有 C19 resolver 原样委派，保持 C02 `KnowledgeModelingPortV1` 的两类解析能力均可用。

**Non-Goals:**

- 不实现 C20 的 Qdrant/BM25、索引代际、RRF 或检索结果，不实现 C21～C24 的上下文审阅、候选识别和识别图。
- 不定义 C21/C24 拥有的识别策略集，不增加知识定义类型，不修改 `packages/contracts`、主 specs、根 workspace、锁文件或现有迁移 provider。
- 不实现第二套治理状态机、Agent 循环、审计表或工件仓库，不给 C17 增加 API 专用路由或 Web 页面。
- 不在 C17 修复“唯一发布停用后 `currentRelease` 为空且 `validateRevisionBase` 要求 base=current，导致该定义类型可能无法再提交新修订”的 C16 生命周期语义；建议另开 C16 change，不在本 change 增加特判。
- 不在 C17 修改 C08 私表、执行存储或 contracts；C08 失败证据公共窄读由独立前置 change 交付。
- 不在 C17 复制、包装或改写 C19 的评估依据解析规则，不在 C17 组合根新建第二个 `PostgresScoringRulesAdapter`，也不修改 C19 生产文件或持久化。

## Decisions

### D-01：以三个可执行门作为实现前置

实施首项按集成后代码而非 change 名称检查：

1. `KnowledgeDefinitionTypeV1Schema` 能 strict parse `standard-library`、`case-library`，既有类型保持不变；
2. 独立 C15 drift change 已归档：公开 `PostgresDataCleaningStore.readExactPreparation(input: IdentificationPreparationReadRequestV1): Promise<IdentificationPreparationReadResultV1>` 按精确 `preparationSnapshotRef` 返回 `kind: "ok"` 的 strict `snapshot`、`agentTaskRef`、`result`、`resultArtifactRef`，且快照中的 `coverageDecisionRef`、`excludedSegmentDecisionRefs[]` 均是 `route-decision`；`implement-engineering-data-read-branches` 已使 C02 `EngineeringDataPortV1.read()` 与 adapter 的 `resolveReadQuery()` 对 `source-segments`、`evidence-access` 返回可经 C04 复读的 `queryResultRef` 并执行当前授权检查；
3. 独立 C08 失败证据窄读 change 已归档并提供 D-09 所列 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()`；C16 归档能力及复数 `includedSourceSegmentSetRefs` 已集成。

任一门不满足即停止实现并升级；C17 不在本 change 修复 C15/C08、补 contracts 或读取上游表。C08 前置 change 若因当前没有 task read branch/capability 而必须演进 contracts，由该 change 单独完成；C17 只注入 reader。

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

C17 adapter 以 `IdentificationPreparationNarrowReadV1` 注入 C15 正式 `preparationRead: Pick<PostgresDataCleaningStore, "readExactPreparation">` 和 C02 `engineeringData.read/resolveReadQuery`，再由 `PostgresIdentificationPreparationKnowledgeReader` 实现 core `IdentificationPreparationKnowledgeReaderV1`；该接口不要求上游新增公共字段：

- `readExactPreparation({ taskRef?, projectId, preparationSnapshotRef, actorId, requestId, requestedAt }): Promise<IdentificationPreparationExactReadV1>`：内部用 `requestId` 签发 `engineering-data.evidence-access` 授权后调用 C15 `readExactPreparation()`；成功返回 `snapshot`、`agentTaskRef`、`result`、`resultArtifactRef`，并证明 C08 清洗任务完成、结果双向绑定及 `sourceVersionRefs[]` 与 `includedSourceSegmentSetRefs[]` 同序；
- `readSegmentSlice({ taskRef?, projectId, preparationSnapshotRef, sourceSegmentSetRef, segmentIds, limit, actorId, requestId, requestedAt })`：调用 C02 `EngineeringDataPortV1.read({ kind: "source-segments", ... })`，再以 adapter `resolveReadQuery()` 取得 `queryResultRef` 并只返回该准备保留集合内的请求切片；
- `checkEvidence({ taskRef?, projectId, preparationSnapshotRef, evidenceReferences, purposeCode, actorId, requestId, requestedAt })`：调用 `EngineeringDataPortV1.read({ kind: "evidence-access", ... })` 及 `resolveReadQuery()`，逐项返回 `eligible | rejected` 和稳定原因码，不返回未授权正文。

三方法的授权由 `PostgresIdentificationPreparationKnowledgeReader` 经注入的 `authorize(IdentificationKnowledgeAuthorizationRequestV1)` 为精确 branch 签发，不从调用方接收 `authorization` 字段；不存在和未授权对 C17 呈现同形失败。C17 只持有 `IdentificationPreparationNarrowReadV1`，不知道 C15/C02 的表或 adapter 私有方法。

### D-05：C17 façade 设置内容门，发布绑定与事件由 C16 同一事务提交

新增 `PostgresIdentificationKnowledgeAdapter` 作为生产注入的 `KnowledgeModelingPortV1` façade，并持有 C16 adapter：

- `submit-revision` 若是五类 C17 定义，先从 C04 读取候选包、执行 D-03 校验并耐久保存校验收据，再调用 C16 `govern()`，最后绑定返回的 revision；其它定义原样委派 C16；
- `request-review` 对 C17 revision 只允许存在绑定；合格绑定走 C16，失败绑定只允许 D-08 的失败复核路径；未知绑定作为非 C17 定义原样委派；
- `publish-approved-release` 对 C17 revision 要求合格绑定；失败修订永不通过此门。随后只调用已注入 C17 governance policy 的 C16，不在 façade 返回后另开 binding 事务；
- `deactivate-release` 对已绑定 C17 release 委派 C16；`rollback-by-new-release` 同样只调用已注入 policy 的 C16，使新 release 在 C16 回滚事务内绑定到历史 revision；其它发布原样委派；
- `resolve()` 对 `identification-basis` 执行 D-10，对 `assessment-basis` 按 D-13 原样委派注入的 C19 resolver；`retrieve()` 原样委派后续注入的检索实现或返回 C02 既有 `UNSUPPORTED_CONTRACT`，不在 C17 生成结果。

发布和回滚严格遵循已归档 `evolve-identification-basis-published-event` D-04。C16 在自己的 `TransactionUnitV1` 回调内先写 C16 release，再调用 `IdentificationKnowledgeGovernancePolicyV1.appendRelease(context, input)`；policy 对所有五类 C17 发布读取并复验 validated revision binding/package，在同一 `TransactionContextV1` 写 C17 release binding。四类成员发布返回空事件；`retrieval-evidence-base` 继续解析三个组合成员及机理包固定的工序模型，复验五项同工程、类型、版本和双时间有效后，以 `DomainEventV1Schema.parse` 构造唯一事件。C16 随后把同一 `AtomicCommitV1` 的事实审计、命令回执和 Outbox 与 release/binding 一起提交。任一步失败整体回滚；policy 缺失对 C17 发布关闭失败。发布身份稳定派生，重放返回原 release/binding/event，不重复事实。

生产组合只暴露 façade，不暴露裸 C16 adapter，也不保留内存 recorder 或发布后 `#bindRelease` 补写路径。修订导入仍因 C04 工件与 C16 修订跨阶段而使用稳定收据恢复；发布路径则是单个数据库事务。

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

`createKnowledgeAuthoringTaskDefinition()` 注册现有 `knowledge-authoring` 类型，结果族只允许 `knowledge-revision`。`KnowledgeAuthoringManifestV1` 固定 D-04 读取的 strict 准备快照、正式清洗结果工件、同序来源版本/保留资料段集合、排除决定、目标定义类型、可选精确基线 release/artifact、验证策略、父运行、授权和全部 C08 版本引用；`prepareOrReplayAuthoringTask()` 先写 manifest 工件，再以其引用启动或重放 C08 任务并记录 attempt。

动作/增量是按目标类型判别的封闭操作：声明/退役工序节点与关系、声明/退役机理、引用/退役规范条款、引用/退役案例、选择三个组合成员。每项都带目标 ID、预期基线、证据和简短业务理由；禁止路径补丁、整对象替换和发布动作。C08 先校验请求 tool ref 属于任务定义白名单；C17 再在读取前校验资料段集合属于 manifest 的保留成员、资料段属于该集合、limit 不超过冻结策略，或基线 release/type 精确等于 manifest 固定成员。工具已注册不扩大对象范围。两个工具分别使用组合根经 C06 为 exact branch 签发的 `engineering-data.read` 或 `knowledge-modeling.read` 上下文调用 D-04/`readExact`，观察仍由 C08 写 C04。

Worker 新增 `withKnowledgeAuthoringModelStep()`/`interpretKnowledgeAuthoringModelStep()`，只在 `taskType === "knowledge-authoring"` 时构造有界结构化消息和解析 `tool-request | candidate`，其它任务委派既有 callbacks。模块级 `KnowledgeAuthoringRunner.runOnce()` 先调用同一个 `AgentRuntimeRunner.runOnce()`，再调用 D-09 失败收口；不复制 claim、租约、预算、模型循环或恢复。

候选通过后 finalizer 把类型化操作应用到冻结基线、执行 D-03 完整包校验、写 C04 包，并走 D-05 submit 路径创建待审 revision；C08 保存每版候选和逐项验证。Agent 不获得 C16 publish/deactivate/rollback 工具。

### D-09：终态失败经 C08 公共窄读生成不可发布修订并幂等请求复核

独立 C08 前置 change 必须新增下列公共窄接缝；名称和签名是 C17 集成事实，不得再用 `AgentTaskStoreV1.getTask()` 或 `PostgresAgentTaskAdapter.getTask()` 代替：

```ts
export interface AgentTaskFailureEvidenceReaderV1 {
  readTerminalFailure(
    input: AgentTaskFailureEvidenceReadRequestV1,
  ): Promise<AgentTaskFailureEvidenceReadResultV1>;
}

export interface AgentTaskFailureEvidenceReadRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly taskRef: AgentTaskRefV1;
  readonly expectedTaskType: AgentTaskTypeV1;
  readonly authorization: AuthorizationContextV1;
}

export type AgentTaskFailureEvidenceReadResultV1 =
  | { readonly kind: "succeeded"; readonly evidence: AgentTaskFailureEvidenceV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

export interface AgentTaskFailureEvidenceV1 {
  readonly taskRef: AgentTaskRefV1;
  readonly taskType: AgentTaskTypeV1;
  readonly terminalStatus: "terminal-failure" | "cancelled";
  readonly error?: AgentStructuredErrorV1;
  readonly cancelReasonCode?: string;
  readonly usage: AgentBudgetUsageV1;
  readonly actionRefs: readonly VersionReference[];
  readonly candidateArtifactRefs: readonly ArtifactRefV1[];
  readonly validationArtifactRefs: readonly ArtifactRefV1[];
}
```

C08 reader 只按 `(projectId, taskRef)` 单点查询任务及其动作/候选表，先复验当前 `agent-task.read-failure-evidence` 授权，再定位目标；不存在、跨工程、错类型、非终态和未授权返回同形 `AUTHORIZATION_DENIED`，不返回 envelope、模型响应、正文或列表。当前 contracts 没有该分支和读取能力，C08 前置 change 必须最小新增 branch `agent-task.read-failure-evidence` 及 capability `agent-task.read`，并由 C06 精确映射；C17 不修改 contracts 或 C08 表且不需要迁移。

返回投影不新增持久化：`actionRefs` 按动作 `sequence` 升序，以 `actionId` 为 `entityId`、`String(sequence)` 为 `versionId` 确定性映射 `VersionReference`；`candidateArtifactRefs` 直接取候选工件引用并按候选版本升序；`validationArtifactRefs` 取校验工件引用并按首次出现去重。成功读取以 `requestId` 幂等追加 C03 命令回执和事实审计，同键异目标冲突；授权拒绝由 C06 留下授权决定审计，且所有失败形状均不泄露目标是否存在。

`settleAuthoringFailures()` 只扫描 C17 `business.identification_knowledge_authoring_attempts` 中未收口的精确 task refs，再调用注入的 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()`，不做全库 Agent 投影。对成功返回的终态失败证据，每个阶段先由组合根取得 C06 为目标工程、actor、调用身份和 exact branch 签发的独立上下文，再按以下顺序执行：

1. 以 `evidence.error/cancelReasonCode/actionRefs/candidateArtifactRefs/validationArtifactRefs/usage` 构造 `KnowledgeAuthoringFailureV1`：候选引用须 strict parse 为 `ContentArtifactRefV1`，校验引用映射为各工件的 `reference`；随后写 C04 diagnostic artifact。窄读失败必须返回可验错误，不得 catch 后静默跳过；
2. 用 `knowledge-modeling.submit-revision` 上下文和稳定派生键直接调用 C16 提交一个目标定义类型的 failure revision，并写 `failure-review-only` binding；该正文是失败诊断，不伪装为有效知识包；
3. 用独立 `knowledge-modeling.request-review` 上下文调用 C16；C16 再用组合根提供的 `review-audit.request-review` 上下文创建 C07 `knowledge-revision` 任务，并把 review ref 绑定回 attempt。

D-05 发布门永久拒绝 `failure-review-only`。复核只用于人决定补资料、重启新 task 或结束处理，不能批准失败正文。`retryable-failure` 留给 C08 在原任务和累计预算内恢复，不提前创建复核；一旦预算或重试耗尽转终态再收口。授权解析或 C07/C16 调用失败时停在最后已成立阶段并保存原因，重放只补下一阶段。不得回退到任务信封授权、调用方 capability 或默认 review policy。

备选是直接用 diagnostic artifact 作为 C07 target，但公共复核目标不接受该类型；创建真实且不可发布的失败 revision 可复用现有 `knowledge-revision` 审核链并保持语义明确。

### D-10：识别基础解析组合 C15、C16 与外部策略提供者

`#resolveIdentificationBasis()` 的顺序固定为：

1. strict parse C02 命令，以 `issuedAt` 作为 `asOfRecordedAt`；
2. 调用 D-04 `readExactPreparation`，复验工程和当前资料授权；
3. 调用修正后的 C16 resolver 解析 `process-model`、`risk-mechanism`、`retrieval-evidence-base`，再按 composite 绑定精确解析 `standard-library`、`case-library` 并确认 composite 的 risk mechanism 与独立结果一致；
4. 调用注入的 `IdentificationPolicySetProviderV1.resolveExact({ projectId, preparationSnapshotRef, requiredAt, asOfRecordedAt, authorization })` 取得 C21/C24 拥有的 `IdentificationPolicySetRefV1`；
5. 映射 C16 generic release refs 为 C02 已有三个 typed release refs，并返回四字段 success。

provider 不返回精确引用、准备不可读、任一发布/绑定/成员无效或授权失败均返回现有类型化错误，不形成部分成功。C17 不定义策略对象、类型或默认引用；C21/C24 后续若要求完整治理，另开契约演进。解析只按目标工程、类型、精确引用和双时间读取。

### D-11：授权、事务、错误和审计沿既有端口收口

- C17 public govern/resolve 在读取目标存在性前验证命令工程/actor 与 authorization 一致，并使用 C02 声明的 knowledge branch；资料读取另由 D-04 使用 engineering-data branch 复验当前来源范围。
- `apps/worker/src/identification-knowledge/composition.ts` 是唯一生产组合根。它必须注入同一 `db`/`TransactionUnitV1`、C04 store/guard、C06 access、C07 review port、C08 adapter/store/registry、C15 正式 reader、C02 engineering-data port、完整 validation policy、既有 C19 assessment-basis resolver、C21/C24 policy provider 接缝、shared runner/model callbacks 和受信授权来源解析器；工厂先以这些共享依赖构造 `PostgresIdentificationKnowledgeReleasePolicy` 并注入 C16，再把同一个 C16 adapter 与 C19 resolver 注入 C17 façade。除尚未上线的 C21/C24 provider 缺失时只阻断 `identification-basis` 外，其它必需项不得 optional；缺失时工厂拒绝构造。
- 受信来源只允许请求作用域 `human-session`，或携带 C06 已签发父上下文和同一 causal run 的 `system` 调用。组合根按操作分别请求 `agent-task.start-task`、`engineering-data.source-segments`/`engineering-data.evidence-access`、`knowledge-modeling.identification-basis`、`knowledge-modeling.submit-revision`、`knowledge-modeling.request-review` 和 `review-audit.request-review`，并复验返回上下文的 actor/project、exact capability、空间/来源范围和调用身份。Agent 工具只持有读能力；finalizer/失败收口只取得对应 submit/review 能力；C16 的 human invocation 检查继续独占 publish/deactivate/rollback。
- C16 adapter 新增并导出以下本地公共接缝，`PostgresKnowledgeGovernanceAdapterOptionsV1` 以 `reviewAuthorizationProvider?: KnowledgeGovernanceReviewAuthorizationProviderV1` 替换 `reviewAuthorization`/`approvalAuthorization`；C17 生产组合必须注入 provider，不能使用命令 authorization fallback：

```ts
export type KnowledgeGovernanceReviewAuthorizationRequestV1 =
  | {
      readonly task: "request-review";
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt: string;
      readonly branch: "review-audit.request-review";
      readonly reviewAttemptId: string;
      readonly revisionRef: KnowledgeRevisionRefV1;
    }
  | {
      readonly task: "verify-knowledge-revision-approval";
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt: string;
      readonly branch: "review-audit.verify-knowledge-revision-approval";
      readonly revisionRef: KnowledgeRevisionRefV1;
      readonly reviewDecisionRef: ReviewDecisionRefV1;
    };

export interface KnowledgeGovernanceReviewAuthorizationProviderV1 {
  authorize(
    input: KnowledgeGovernanceReviewAuthorizationRequestV1,
  ): Promise<AuthorizationContextV1>;
}
```

C16 自己派生 request-review 的 `${reviewAttemptId}:review` 和 publish/rollback 的 `${command.commandId}:approval`，填入精确 branch/目标引用；provider 只把结构化请求交给受信来源与 C06。C16 在调用 `ReviewAuditPortV1.requestReview()` 或 `verifyKnowledgeRevisionApproval()` 前复验返回上下文的 project、actor、invocation 和唯一能力分别为 `review-audit.request`/`review-audit.read`。授权失败不触达 C07，发布/回滚仍由 C16 先验证 human invocation。
- C04 工件先耐久，随后每个非发布 C17 阶段通过 `TransactionUnitV1` 原子写业务事实、命令回执和一条事实审计；普通修订和四类成员发布提交零识别基础事件。D-05 的组合发布/回滚在 C16 同一事务提交 release、binding、审计、回执和唯一 Outbox 事件。
- 内部错误映射到 C02 既有 `AUTHORIZATION_DENIED`、`ENTITY_NOT_FOUND`、`STALE_VERSION`、`BUSINESS_BLOCKED`、`IDEMPOTENCY_CONFLICT`、`UNSUPPORTED_CONTRACT`、`TRANSIENT_FAILURE`、`TERMINAL_FAILURE`。日志和错误只带原因码与引用，不带正文、凭据、模型响应或数据库错误。

### D-12：显式窄读接口是 C20/C24 的唯一消费面

core 导出 `IdentificationKnowledgeReleaseReaderV1.readExact({ projectId, releaseRef, actorId, requestedAt, invocationId?, authorization })`，返回 discriminated strict 包、validation receipt 和 release binding；adapter 实现先校验 C16/C17 binding、工程、定义类型和当前 C06 权限，再打开 C04 artifact。C20 只能用它构建索引，C24 通过 public `resolve()` 冻结识别基础；两者都不能读取 C17/C16 表。

这条接口有两个明确下游且隔离存储实现，符合跨层契约边界。当前不增加列表、全文搜索、批量 projection 或“当前版本”查询。

### D-13：assessment-basis 只原样委派组合根注入的 C19 resolver

`PostgresIdentificationKnowledgeAdapterOptionsV1` 新增必需的 `assessmentBasisResolver: Pick<PostgresScoringRulesAdapter, "resolve">`。C17 façade strict parse `KnowledgeResolutionCommandV1` 后，`identification-basis` 继续执行 D-10；`assessment-basis` 则把同一个已解析命令对象传给 `assessmentBasisResolver.resolve()` 并原样返回其 `KnowledgeResolutionResultV1`。C17 不重复 C19 的授权、准备快照、适用规则集、C18 配置集合、双时间、幂等、审计、持久化或错误映射，也不把 C19 失败改写为 C17 错误。

`PostgresIdentificationKnowledgeCompositionOptionsV1` 同样把该 resolver 设为必需项，在构造检查中缺失即失败，并只把调用方已组装的 C19 adapter 窄化后传给 C17；组合根不得自行创建第二个 C19 adapter。直接构造 C17 adapter 的测试 fixture 注入可观测 delegate，证明 success/failure 结果和命令逐字段不变；Worker 组合测试证明缺失依赖关闭失败及注入对象确实被调用。C19 自身测试继续独占解析规则的行为证据，C17 不修改其生产或测试文件。

备选是在 C17 重新调用 C16/C18 拼装评估依据，或让调用方绕过 façade 分别选择 C17/C19；前者复制 C19 事实与持久化，后者破坏生产只暴露统一 knowledge façade 的组合边界，因此均不采用。

## Risks / Trade-offs

- [C15 正式窄读/route-decision drift 或两个定义类型尚未集成] → D-01 作为首个硬门，未满足即停止，不在 C17 临时补契约、容忍视图或跨表读取。
- [C16 识别 policy 未注入或仍在发布后绑定] → D-05 对 C17 发布关闭失败；只有 release、binding、审计、回执和事件同事务成立才返回成功。
- [失败 revision 的正文不是合法知识包] → 独立 `failure-review-only` binding 永久阻断发布，复核界面显示诊断类型；不允许它进入内容解析。
- [一个 `knowledge-authoring` task 可能接近对象预算] → 工具分片、候选对象上限和墙钟由注入策略固定；耗尽后走 D-09，不隐式拆任务或扩容。
- [关系校验在大包上成本上升] → 使用 O(V+E) 拓扑遍历和策略对象上限；只有基准证明不足时再优化。
- [策略 provider 在 C21/C24 上线前无实现] → 组合根可以明确标记该能力未就绪，但 `identification-basis` 必须 `BUSINESS_BLOCKED`；C17 无默认策略，知识治理其它命令仍可独立使用。
- [工具白名单存在但成员范围未校验] → D-08 以 manifest 精确成员做第二层确定性校验；越界在目标读取前失败。
- [终态失败没有独立 submit/review/C07 授权] → D-09/D-11 停在最后成立阶段并可幂等恢复，不借用任务信封能力。
- [C08 无公共失败证据读取] → 独立 C08 change 先交付 D-09 的 reader、不可枚举授权和审计；未归档时 C17 失败收口不得使用 `getTask()` 或私有 SQL。
- [C16 唯一发布停用后无法建立新修订基线] → 建议另开 C16 change 修复 `currentRelease`/`validateRevisionBase` 生命周期语义；本 change 将其列为 Non-goal，不特判。
- [内容工件成功、后续事务失败产生孤儿] → 内容寻址写入可安全重放，只有 C17 binding 才可消费，孤儿交给 C04 既有保留/清理策略。
- [生产组合未注入 C19 resolver 或误建第二个 C19 adapter] → D-13 将 delegate 设为必需窄依赖并在构造期拒绝缺失；组合测试核对对象透传，文件保护区禁止修改或复制 C19 实现。

## Migration Plan

1. 先由独立 C15 drift change 交付 `PostgresDataCleaningStore.readExactPreparation()` 和 `route-decision` 契约修正，并由独立 C08 change 交付 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()`；两者归档后确认 D-01 其余前置和基线 drift，运行 contracts、C15/C11、C08、C16 定向回归。
2. 运行 provider 自动发现的 `000020_identification_knowledge_governance`，验证 app/worker/checkpointer 权限和 down/up；不占用 `000021`～`000023`。
3. 部署 core Schema/校验、C17 release policy、adapter façade 和 C16 branch/事务接缝；生产组合把已组装的 C19 resolver 作为必需 delegate 注入并只暴露 façade。先验证两类 resolve 分支，再以审核夹具导入五类 draft/revision，验证四类成员发布零事件、组合发布/回滚的 release-binding-event 原子性及失败回滚。
4. 部署 Worker 生产组合、工具成员校验和失败收口；逐项验证 C06 exact branch、授权缺失关闭失败，再由人工完成送审/发布。最后验证双时间解析、历史重放和 C20 窄读夹具。
5. 应用回滚时先停止 C17 新写入并回退 façade/Worker；C16 revision/release 和 C04 工件保留。仅在确认四张 C17 表为空时执行 migration `down`，已有业务事实不得物理删除。
