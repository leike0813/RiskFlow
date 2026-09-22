## Context

固定输入 HEAD 为 `15ddd1ad40782574fb67351a68955fcc852762a8`，实际 change schema 为 `orchestrated-delivery`。C28 已提供 `ResponseDeviationFactReaderV1`，可以按当前授权读取精确、不可变的私有偏差事实；公共 `DeviationRecordSchema` 则要求真实 `calibrationRecommendation` 和 `reviewStatus`，因此必须由 C29 在真实建议形成后组合。C08 已声明 `calibration-suggestion` 任务及结果引用，C07 已声明校准复核类型和三种决定，C16/C18/C19 已提供版本化定义、严格配置 Schema、内容工件和 `submit-revision` 治理入口。

现有 `create-calibration-suggestion` 命令先要求 `DeviationRecordRefV1`，而公共记录又要求真实建议标识；解决方式是在调用命令前由 C28 不可变事实确定性派生记录引用，待建议实际生成后把两者原子写入。C07 当前只有知识修订批准证明窄读，不能合法证明 `approve-draft-creation`；协调者已批准只做加法式校准批准证明查询，禁止改现有命令/端口方法签名、直接读 C07 表或增加权限枚举。研究输入仅为 `references/风险识别与评估规划事实源摘要.md`。

## Goals / Non-Goals

**Goals:**

- 闭合已越限 C28 偏差事实 → C08 校准候选 → C29 建议与公共偏差记录 → C07 人工复核 → C16 未发布修订草案。
- 让 Agent 只产生单一目标定义上的类型化操作，由确定性代码验证精确基准、完整候选文档、权限、证据和幂等。
- 保留偏差、建议、复核决定、草案及后续知识治理的精确版本与审计链，并让失败可安全重试。

**Non-Goals:**

- 不自动发布、停用或回滚 C18/C19 定义，不把校准批准等同于知识修订发布批准。
- 不修改现有公共命令、事件或端口方法的输入输出，不增加角色、能力或权限枚举。
- 不实现 C30 LangGraph、API composition root、UI、通知、通用配置编辑器、多定义原子校准或自由 JSON Patch。
- 不引入依赖，不回填历史偏差，不修改 C28 私有事实或历史评估/P/C/矩阵结果。

## Decisions

### D-01：新增 `calibration` 深模块并只暴露四个窄用例

新增 `packages/core/src/calibration`，集中私有 strict Schema、候选收口、`createCalibrationSuggestionTaskDefinition` 和 `CalibrationGovernanceServiceV1`；新增 `packages/adapters/src/calibration`，组合 C28/C08/C07/C04/C16 公开接缝和 C03 PostgreSQL 事务。服务只有 `prepareInput`、`createSuggestion`、`recordReviewOutcome`、`createGovernanceDraft` 四个用例：`prepareInput` 接受当前授权、精确 C28 偏差事实 ref、冻结依据内的目标 release 和校验策略 ref，形成 C08 冻结输入工件；`createSuggestion` 消费既有 `create-calibration-suggestion` 公共命令并绑定已完成 C08 结果；后两者消费精确建议/决定引用及公共命令身份、授权和幂等信封。

`createSuggestion` 返回既有 `WarningResponseRecordResultV1` 的 calibration 分支，使 C30 后续可以直接组合到 `WarningResponsePortV1.record`；C30 使用 `prepareInput` 的工件和真实 `parentRunRef` 调 C08，本 change 不在 `apps/**` 激活路由。四个用例避免扩张 C28 `response-lifecycle`、C07 `review-audit` 或 C16 `knowledge-governance` 的领域所有权，也不建立一个开放动作分派器。

替代方案是直接实现完整 `WarningResponsePortV1`，但它会提前占有 C30 的应用编排；把校准写入 C28 则会让确定性偏差事实依赖 Agent 和人工复核。

### D-02：由偏差事实确定性派生公共记录和建议身份

`CalibrationContextReaderV1` 首先使用 C28 `ResponseDeviationFactReaderV1` 读取精确事实并验证 `thresholdExceeded=true`、工程、空间、处置建议、预测/实际状态、阈值版本和证据。采用项目已有 canonical digest/标识 helper 对 `{projectId, deviationFactRef}` 计算稳定 `deviationRecordId`，首版 `DeviationRecordRefV1.reference` 固定为该实体和 `pending` 状态版本；不得由时间、随机数或数据库序列决定业务身份。

每个合格候选以 `{deviationRecordRef, agentTaskResultRef, validationPolicyRef, candidateDigest}` 确定性派生 `CalibrationSuggestionRefV1`。C29 可在正式写入前用该精确引用请求 C07 复核，随后在 C03 事务内保存真实建议和公共记录，使 `calibrationRecommendation` 等于建议实体标识。建议退回后由新的 C08 任务和候选摘要派生后继建议版本；偏差记录实体不变，状态变化追加新的 `VersionedRecordInfo`，不覆盖旧版本。

替代方案是先写占位记录再补建议，但违反公共 Schema 和“无占位”约束；修改既有命令去掉偏差引用则不是加法式演进。

### D-03：每个建议只校准一个精确基准定义

`prepareInput` 的调用方显式提交一个目标 `KnowledgeReleaseRefV1`，C29 只在它属于偏差事实所引用的冻结评估依据时接受。形成的 `CalibrationInputSnapshotV1` 固定 C28 偏差事实、派生公共记录引用、C25 冻结评估输入、C19 评估依据 release set、目标 release、定义类型、基准内容工件与摘要、校验策略、C08 模型/提示/工具/预算策略和 C06 授权。目标只允许 C18/C19 中可受校准影响的类型：`weight-set`、`risk-matrix`、`risk-acceptance-threshold`、`monitoring-warning-threshold`、`deviation-policy` 或 `structured-scoring-rule`。

一次建议只包含一个目标定义，因而批准后只调用一次 C16 `submit-revision`，避免跨多个 C16 事务制造部分草案。需要同时调整多个定义时必须形成相互独立的任务、建议和人工决定；它们不共享批准。

目标和基准从冻结评估依据解析，禁止读取 latest。若业务以后要求跨定义一致性校准，应单独设计批量治理协议，不在 C29 预留通用事务抽象。

### D-04：Agent 增量是闭合领域操作，不是文档替换

`CalibrationCandidateV1` 保存任务/结果引用、D-03 输入快照引用、非空理由、证据和 `CalibrationOperationV1[]`。联合操作只允许：替换权重条目、替换风险矩阵轴区间、替换风险可接受阈值、替换监测预警阈值、替换偏差策略阈值，以及替换结构化评分规则中的阈值或等级区间。每个分支使用对应 C18/C19 项目 Schema 作为 replacement，并以稳定业务标识选择原项目；禁止自由路径、通用键值、JSON Patch、删除整个定义或提交完整对象作为 Agent 增量。

`validateCalibrationCandidate` 逐项验证操作种类与目标定义相容、选择器唯一存在、值/单位/区间/总权重约束、证据与原任务绑定；`applyCalibrationOperations` 按稳定顺序应用到精确基准，再用对应 C18/C19 完整文档 Schema parse，并计算 canonical digest。校验保存每项接受/拒绝理由。只有字段、格式、引用或候选越界等可修复错误可在原 C08 预算内返回同一任务；权限、来源资格、基准版本、规则冲突和预算失败直接关闭。

### D-05：复用 C08 任务定义并增加私有精确结果读取

C29 导出 `createCalibrationSuggestionTaskDefinition`，其任务类型固定为 `calibration-suggestion`，输入只接受 D-03 内容工件，工具和预算按版本化策略冻结，`finalizeCandidate` 只生成 D-04 增量结果。C30 后续以真实 `parentRunRef` 通过既有 `AgentTaskPortV1.startTask/resumeTask` 驱动任务；C29 不实现第二套 Agent 状态机，也不生成 workflow run。向 C08 core 增加私有 `AgentTaskCompletedResultReaderV1`，由 `PostgresAgentTaskAdapter` 按工程、精确任务/结果引用和当前授权读取冻结输入 ref、真实 `parentRunRef`、结果工件、预算、工具行动与候选版本；它不进入公共 contracts，不提供列表/latest 查询，也不暴露模型思维链。

`createSuggestion` 从公共命令的 `agentTaskResultRef` 经上述窄读反查任务，要求任务为 `calibration-suggestion`、冻结输入精确等于 D-03 工件、`parentRunRef` 真实存在，且结果主输出绑定 D-04 候选。`candidateRef` 可以指向确定性派生的建议引用，但正式建议只有 D-04 校验通过且 D-07 事务提交后才成立。任务失败或预算耗尽显式失败，不以基线文档或空操作冒充候选。

### D-06：C07 只增加校准批准证明窄读

在 `packages/contracts/src/ports/index.ts` 增加 strict `CalibrationSuggestionApprovalProofQueryV1Schema`、闭合 proof/result Schema 与类型，以及只有 `verifyCalibrationSuggestionApproval` 方法的独立 `CalibrationSuggestionApprovalProofPortV1`；现有 `ReviewAuditPortV1`、方法、命令、结果和事件签名完全不变。新增查询分支 `review-audit.verify-calibration-suggestion-approval` 只映射到既有 `review-audit.read`，不增加能力值。输入固定工程、精确 `CalibrationSuggestionRefV1`、`ReviewDecisionRefV1` 和 `AuthorizationContextRefV1`；已批准结果只返回建议、任务、决定和时间，未批准原因沿用知识修订证明的稳定集合 `decision-not-found | target-mismatch | decision-not-approval`。

`PostgresReviewAuditAdapter` 复用现有知识修订证明的授权先行和按工程/决定精确查询路径，只把合法决定收窄为 `approve-draft-creation`。查询映射既有 `review-audit.read`，无权/跨工程不可枚举，不写业务审计、拒绝审计、回执或 Outbox；任务非 `decided`、保存决定引用不一致等不可能状态返回既有技术完整性错误。C29 只能调用该公共端口，禁止读取 C07 表或复制决定事实。

采用独立单方法端口而非修改 `ReviewAuditPortV1` 或引入通用 `verifyApproval(target, decision)`，因为两类批准的合法决定和值域不同；专用端口不迫使既有调用者和 mock 增补无关方法。

### D-07：建议创建使用 C07 前置幂等请求与 C03 原子提交

D-04 收口后，C29 以 D-02 派生的建议精确引用和现有 `ReviewRequestV1` 请求 C07 `calibration-suggestion` 复核，`waitingRunRef` 必须使用 D-05 C08 源任务冻结的真实 `parentRunRef`，缺失即失败，禁止伪造。C07 拥有独立事务，因此沿用项目既有稳定 saga：先用确定性业务幂等键创建/重放复核任务，再在 C29 `TransactionUnitV1` 内原子插入建议、`pending` 公共 `DeviationRecord`、复核关联、C03 回执、C07 audit entry 和既有 `warning.calibration-suggestion-created.v1` Outbox 事件。

若 C29 事务失败，重试复用同一 C07 任务；未完成关联的任务不能作为 C29 成功结果。相同键同载荷返回首次逻辑结果，同键异载荷返回 `IDEMPOTENCY_CONFLICT`；唯一约束收口并发。事件严格复用现有 payload，不增加候选正文或配置内容。

### D-08：三种复核决定有不同的确定性收口

`recordReviewOutcome` 读取建议和 C07 精确决定：

- `reject`：追加 `reviewStatus=rejected` 的公共偏差记录版本和审计，不创建工件或 C16 修订。
- `return-for-revision`：保存不可变退回关联，原公开记录保持原版本；调用方只能以新的 C08 任务形成后继建议版本和新的 C07 任务。
- `approve-draft-creation`：仅记录待创建草案的批准关联；公共偏差记录仍为 `pending`，直到 D-09 的 C16 修订和 C29 关联均成功。

决定只适用于精确建议版本。后继建议、重新生成候选或目标基准变化均需要新的复核任务和决定，不转移人工批准。

### D-09：草案创建通过证明门禁和 C16 幂等 saga 完成

`createGovernanceDraft` 先复验当前主体同时具备现有 `warning-response.record`、`review-audit.read` 与 `knowledge-modeling.govern` 所需授权，再调用 D-06 证明查询。证明缺失、不是批准、错建议/任务/决定或 C07 完整性失败时立即返回失败，且不写内容工件、修订或 approved 记录。

证明有效后，C29 重新读取建议固定的基准 release/artifact 和校验策略，按 D-04 重建完整候选并核对 digest；随后以内容寻址方式保存候选工件，并用确定性命令标识/幂等键调用既有 `KnowledgeModelingPortV1.govern({kind: "submit-revision"})`。payload 只含目标 definition type、精确 `baseReleaseRef`、候选工件和证据。C16 成功后，C29 事务原子写入草案关联、`reviewStatus=approved` 的新公共偏差记录版本、回执和审计。

若 C16 已成功而 C29 尾事务失败，重试相同 C16 幂等身份返回原修订再完成关联；不得创建第二项修订。基准失效或内容摘要漂移返回 `STALE_VERSION`，不改套 latest。C29 不调用 `request-review`、`publish-approved-release`、`deactivate-release` 或 `rollback-by-new-release`；后续发布仍需独立知识修订批准证明。

### D-10：错误、审计与可观测性复用现有契约

公共结果沿用现有 `ModuleErrorV1`：权限为 `AUTHORIZATION_DENIED`，基准/决定陈旧为 `STALE_VERSION`，规则或前置阻断为 `BUSINESS_BLOCKED`，相同键异载荷为 `IDEMPOTENCY_CONFLICT`，存储/完整性故障使用现有技术错误。无权、跨工程/空间、事实不存在对调用方不可枚举；错误、日志、审计和事件不泄露配置正文、模型响应正文、SQL 或其它工程存在性。

任务审计保留 C08 可重建输入、原始响应工件引用、工具行动、候选版本、预算与逐项校验；C29 审计保留偏差事实、基准、建议、复核证明、候选工件、C16 修订和幂等身份。只保存工件引用及必要摘要，不保存模型内部思维链。

### D-11：`000047` 只追加三张 C29 事实表

新增 `packages/adapters/src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.ts`，实施前复验序号空闲：

1. `business.calibration_suggestions`：偏差事实/公开记录、C08 任务结果、目标基准、类型化操作、候选摘要、逐项校验、C07 任务和审计；建议精确版本唯一。
2. `business.calibration_deviation_records`：完整 `DeviationRecord` strict payload、状态版本、建议与决定关联、摘要和审计；实体/版本唯一，只追加。
3. `business.calibration_governance_drafts`：建议、批准证明引用、候选工件、C16 修订、基准发布、命令幂等和审计；建议精确版本与决定组合唯一。

三表以精确引用连接 C28/C08/C07/C16/C03 事实，使用 JSONB strict payload、digest、工程、命令/幂等、授权、三时态列和必要唯一/外键约束；只允许 INSERT/SELECT，提供最小 role grant 和逆序 `down`。不修改 `000046` 或更早迁移，不回填旧偏差。中央 foundation/auth fixture 如需登记，由主调度在集成检查点串行处理，Implementation 只报告精确位置。

### D-12：文件所有权和最小验证固定

新增 core/adapters `calibration` 子路径、D-11 迁移及各一组测试；修改两个 package manifest 只增加新子路径导出。修改 contracts ports 及 `module-interfaces-events-workflows.test.ts` 只覆盖 D-06 加法式契约；修改 C07 PostgreSQL 适配器及现有测试实现证明查询，并按 D-05 向 C08 core/adapter 增加私有精确结果读取。C29 不修改 records/events/workflows Schema，因为所需公共记录、事件、任务类型、复核类型和命令已存在；不改 `apps/**`、C28/C16 生产实现、旧迁移、中央 fixture、依赖或锁文件。

core 表格测试覆盖入口资格、稳定派生、类型化操作、完整 C18/C19 Schema 校验、三种决定和无证明阻断；PostgreSQL 纵向测试复用真实 C28/C08/C07/C04/C16/C03/C06 前置，覆盖成功建议、事件、拒绝/退回/批准、C16 草案、权限、幂等、并发和事务失败。C07 测试覆盖批准、非批准、错目标、决定不存在、技术完整性、授权先行和只读无副作用；测试不锁定错误文案、SQL 顺序或内部调用顺序。

## Risks / Trade-offs

- C08 尚无公共结果读取方法，因此 D-05 使用模块内私有窄读；它避免扩张公共契约，但实现必须复用 C08 自有存储与授权，不能在 C29 复制 Agent 事实。
- C07、C16 与 C29 各自拥有事务，无法组成一个 PostgreSQL 调用栈内事务；确定性身份、幂等命令和“最后才标记 approved”使中断可收敛，不宣称分布式原子性。
- 单建议单定义会让关联调整产生多个复核项，但显著降低部分修订和权限混合风险；真实跨定义原子需求出现前不引入批量协议。
- `DeviationRecord.reviewStatus` 没有 returned 状态，因此退回决定保存在建议治理事实中，公开记录保持原版本；新候选形成新的 pending 版本，历史决定仍可追溯。

## Migration Plan

先确认输入 HEAD、`000047` 空闲、C28 精确读取和 C08/C07/C16 接缝仍与设计一致；再追加 contracts 的加法式证明查询、C07 实现、calibration core/adapters 和 D-11 迁移。运行 strict OpenSpec/TypeScript/边界检查、相关单元与 PostgreSQL 纵向测试，并验证真实 up/down、重复 up、旧数据保留、最小授权、幂等重放、并发唯一及事务回滚。部署后不回填历史事实、不激活 C30 路由；回滚先停用尚未接线的 C29 服务，再逆序删除三张无历史回填表，既有 C07/C16/C28 事实不变。

## Open Questions

无影响本 change 施工的未决语义。若实现需要改变现有公共命令/事件/端口方法签名、增加权限枚举、跨多个定义原子提交、绕过 C07 证明、由 C29 自动发布配置，或无法通过现有 C08/C28/C16 公开/窄化接缝完成，必须升级并停止对应实施项。
