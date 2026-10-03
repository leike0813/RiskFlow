## Context

基线为 `d1ad73a005b08cd8fb2718c597ba0ae1af2b7019`。C34 公共契约、角色授予与 HTTP 目录接线已有实现，拥有方读取、页面和真实验收尚未完成。C32/C33 的真实业务页面、会话、工程选择、证据和浏览器 harness 位于 `demo/`；`apps/web` 仍主要是 C10 外壳与质量页。v2 独立应用是设计参照，不属于真实接入点。C25 的实际值集/决策工件、C26 的任务/通知/确认、C27 的三项校验、C28 的预测/执行/反馈/私有偏差、C29 的校准与草案、C41 的终局人工决定已存在。

代码与原型缺口台账有漂移：矩阵分带、轴贡献、阈值、预测与执行事实已有确定性 Schema；不能依据旧 GAP 新建同名业务记录。C29 内部治理入口却固定复验建议创建分支，并要求同一上下文含三项能力；C06 实际每次只签发一项分支能力。该接缝必须在真实授权测试中闭合。

C30 当前只把 changedInputRefs 混入去重 frozenRefs，未保存独立变化集合和显式 reason；Worker 按引用类别推导原因，无法原样解释入口。D-12 在既有 C04 运行工件中保存明确重评元数据，闭合启动、父子传递、恢复与读取；这是本 change 的范围内根因修复。

## Goals / Non-Goals

**Goals**：既有应用中的风险态势 P-OV-01 与 C34 的 16 页形成真实可解释链路，复用 v2 视觉与既有组件；初评/重评、预警确认、采纳/拒绝、执行、反馈与校准治理均使用窄公共命令及精确引用。

**Non-Goals**：新前端应用、整套 v2 Harness 移植、通用读库、P/C 或偏差重算、任务关闭/预警质疑/线下通知登记、报告导出、Agent/审计/运维工作台、历史回填写入口、依赖升级、数据库迁移。历史回填产生的记录仍可读。校准发布由既有知识治理继续负责。

## Decisions

### D-01 落地位置与复用范围

业务界面落在 `demo/src`，领域接缝与验收装配按 D-03～D-11 修改，不在 `apps/web` 平行实现。沿用 Card、DataTable、Timeline、StageBar、StatusTag、VersionTag、EvidenceDrawer、PageStateView、ConfirmButton 与 C32/C33 api 层。从 v2 提取各页分区和 `RiskMatrixChart.tsx` 的 `RiskMatrixVersionChart`、必要 `ChartSurface.tsx/types.ts`；其余图表优先复用现有实现，不搬全部图表/图标/主题。v2 `widgets` 和各 `*-shared` 中与既有组件相同的部分合并到现有组件；只增加一份轻量 `assessmentResponseShared.tsx` 表达表单与精确引用。

保留 `demo/v2` 原型原件，其 gap 裁决记在本 change。v2 `content`、`contract-mirror`、审阅工具和强制角色/状态参数不导入交付应用。这样继续使用已接通的真实应用，避免重新建立会话和工程上下文。

### D-02 页面和深链

| 页面 | 路由 | 目标文件/来源 |
| --- | --- | --- |
| P-OV-01 | `/overview` | `RiskOverviewPage`，复用 v2 overview 分区 |
| P-RA-01 | `/assessment` | `PendingAssessmentPage` ← v2 PendingRisksPage |
| P-RA-02 | `/assessment/start` | 新 StartAssessmentPage |
| P-RA-03 | `/assessment/runs/:runId` | 新 AssessmentRunPage ← v2 RunDetailPage |
| P-RA-04 | `/assessment/records` | AssessmentRecordsPage |
| P-RA-05 | `/assessment/records/:recordId` | AssessmentRecordPage |
| P-RA-06 | `/assessment/matrix` | 新 AssessmentMatrixPage |
| P-RA-07 | `/assessment/reassessments` | 新 ReassessmentsPage |
| P-WR-01/02 | `/warnings`、`/warnings/:warningId` | WarningCenterPage、WarningDetailPage |
| P-WR-03/04 | `/warnings/tasks`、`/warnings/tasks/:taskId` | ResponseTasksPage、新 WarningTaskPage |
| P-RS-01/02 | `/response/recommendations/:recommendationId`、`/response/executions/register` | 新 RecommendationDetailPage、ExecutionRegisterPage |
| P-RS-03/04/05 | `/response/predictions/:predictionId`、`/response/feedback/:feedbackId`、`/response/calibrations/:suggestionId` | 新 PredictionDetailPage、FeedbackDetailPage、CalibrationDetailPage |

详情链接携带 `version` 与现有 project/revision 参数；有完整引用时不能丢弃 version。首次只含实体 ID 的书签可以经目录/显式 resolve 查询取得可见版本，随后替换 URL；带 version 的读取绝不换到 latest。任务关联、执行引用及反馈表单使用查询参数携完整精确引用并严格解析，不用组件状态搬运事实。响应采纳/执行/反馈分离；反馈表单放在 P-RS-02 的“登记反馈”区段，不增加第 18 页。`/warnings/tasks` 静态路由优先于 `:warningId`。

P-OV-01 属 C34，导出按钮移除，报告域属于 C35。概览的计数注明评估记录/开放任务等统计口径，不继续展示原型固定 I～IV 等级。

新增 `/overview` 使用现有 overview 导航位，既有 `/` 保留为同页入口；不创建第二套导航。父运行可能对应多个空间评估子运行，运行深链可以带精确 `assessmentRun` 参数，由同一运行页列出并选择，不能把父图 R 阶段改称 A 阶段。

### D-03 公共分支与 SSOT

公共 Schema 加在 `packages/contracts/src/ports/index.ts`，复用 `querySchema`、`commandSchema`、`moduleResultSchema` 以及 records/workflows/common/vocabulary。新增字段用 strictObject 与闭合判别联合；TypeScript 类型统一 `z.infer`。

| branch | kind / port | capability |
| --- | --- | --- |
| `risk-assessment.read` | `read` / `RiskAssessmentReadPortV1.read` | `risk-assessment.read` |
| `warning-response.read` | `read` / `WarningResponseReadPortV1.read` | `warning-response.read` |
| `warning-response.calibration-review-outcome` | `record-calibration-review-outcome` / `CalibrationGovernancePortV1.recordReviewOutcome` | `warning-response.record` |
| `warning-response.calibration-governance-draft` | `create-calibration-governance-draft` / `CalibrationGovernancePortV1.createGovernanceDraft` | `warning-response.record` |

两个 read payload 按 `operation` 判别，顶层查询信封与 moduleResult 不变。Schema 导出 `RiskAssessmentReadQueryV1Schema/ResultV1Schema`、`WarningResponseReadQueryV1Schema/ResultV1Schema`。两条治理命令共用精确字段 shape：`schemaVersion:'1', calibrationSuggestionRef, reviewDecisionRef`，分别导出 strict `CalibrationReviewOutcomePayloadV1Schema`（`outcome:reject|return-for-revision`）与 `CalibrationGovernanceDraftPayloadV1Schema`（`outcome:approve-draft-creation`）；错误 outcome 在 HTTP/契约边界拒绝。core 现有命令 Schema 移为 contracts 的共用 payload/内部信封导出，core re-export；保持旧内部调用者的无 kind 信封，通过薄端口包装移除公共 kind，禁止两份 payload 定义。四个新 branch 一并加入 `MODULE_BRANCH_CAPABILITY_V1`，沿表中既有能力取值，不新增 capability。

公共业务记录直接引用 `RiskAssessmentRecordSchema`、`WarningRecordSchema`、`ResponseRecommendationSchema`；公开偏差记录正文使用 `DeviationRecordSchema`，C28 私有计算偏差按其原 Schema 解析后映射为 D-05 的只读解释，二者通过精确偏差引用关联。私有计算视图不冒充公共偏差记录，也不将其字段写回公共正文。解释 view 是只读选取/关联 DTO，不是新业务记录，也不反写。UI 暴露的任务状态、校准状态、操作 kind 及其校验枚举从原 core 定义移至 contracts vocabulary，core 消费/re-export；同一领域枚举只定义一次。比较算子和操作 kind 的判别分支从对应 vocabulary Schema 提取字面值或子集，保持原闭合集，不将 outside 放入单边 boundary 变体。完整 CalibrationOperationV1Schema 仍在 core 引用 C18/C19 replacement Schema；公共视图只暴露下述六类类型化变化摘要，避免把整个配置 Schema 上移或复制。

在 ports 导出 `WorkflowReassessmentInputV1Schema` 与派生类型，字段为 previousAssessmentRecordRef、reason（既有 workflow 原因枚举）、changedInputRefs（1..64 项精确引用）；`StartWorkflowPayloadV1Schema` 的 reassess 变体与 C30 内部运行元数据直接复用该 shape。`AssessmentReassessmentReasonV1Schema` 引用 vocabulary 中的唯一原因常量，是 workflow 输入与 C34 解释的同一原因 Schema，不再分别内联枚举。C25 原因码仍沿已有公开契约，由 D-12 的唯一映射连接。

### D-04 风险评估查询闭合集

共同输入：工程在信封，空间使用精确 `spatialScopeRef`；外部事件候选与 entry-context 必填空间，风险记录候选和其它目录按各分支声明可选空间。目录 `pageSize:1..50`、`cursor?:string<=512`。详情 `reference` 用具体领域 ref；显式 resolve 仅接受规定 kind 的 `entityId`，不支持任意 ContractReference 查询。

| operation | payload | 成功结果（kind 与 operation 相同） |
| --- | --- | --- |
| `pending-catalog` | riskInputKind、空间（外部事件必填，风险记录可选）、分页；不接受 projectRevisionRef | items≤50：riskInput、spatialScopeRefs、评估状态 unassessed/assessed、lastAssessmentRecordRef?、证据引用；nextCursor? |
| `entry-context` | projectRevisionRef、spatialScopeRef、riskInput?、分页 | actorId、精确工程/空间；适用性候选≤50（snapshotRef+metadata）；外部事件候选≤50（riskInput+证据）；graphVersion/retryPolicyRef 或 unavailable+reasonCode；nextCursor? |
| `record-catalog` | riskInput?、entryMode?、riskMatrixVersion?、空间、分页 | items≤50：assessmentRecordRef、riskInput、entryMode、前驱?、occurredAt、likelihoodScore、consequenceScore、riskState、matrixPlot；nextCursor? |
| `record-read` | assessmentRecordRef | record、preparationSnapshotRef、inputSnapshotRef、entryMode、前驱/重评原因?、applicability、configurationRefs、indicators、axes、matrixPlot、triggerFacts、evidenceReferences、auditTrailRef |
| `reassessment-history` | riskInput、空间、分页 | 同 record-catalog 条目，增加 previousAssessmentRecordRef、reason、changedInputRefs；不返回虚构变化摘要 |
| `overview` | projectRevisionRef、空间 | recordedAssessmentCount、riskLevelCounts≤32、asOf；按所选工程/空间的已入库评估记录版本统计，不声称识别风险总数 |
| `resolve` | entityId、targetKind:record/run | 获准的精确 assessmentRecordRef/workflowRunRef；多版本只在未指定版本时解析当前登记版本 |
| `run-read` | workflowRunRef | runRef、entryMode、status、stage、graphVersion、actorId、startedAt、stateVersion、stages≤10（stageCode+state+stageResultRef?）、resultRefs≤50、reviewTaskRefs≤50、error?、nextCursor? |

`run-read` 补充 `assessmentRunRef?` 与相关页 cursor 输入，返回 `assessmentRunRefs≤50` 和实际选中 `assessmentRunRef?`。目标为评估子运行时直接呈现其 A0～A9；目标为父运行时保留父 status/stage/R 阶段和真实子运行引用，仅在显式选中或唯一子运行时读取该子运行的 A0～A9。多子运行尚未选中时 stages 为空并引导选择，不合成一条阶段轨迹。所有子引用先验证确属该精确父运行，再有界读取同属 C30 的登记事实；错误不能用 checkpoint 替代。

重评 reason/changedInputRefs 取 D-12 保存的原入口元数据。C30 增加内部 `readAssessmentEntriesForRecords` 窄方法，输入当前获准的 assessmentRecordRefs≤50，输出逐项精确 runRef/entryMode/previousAssessmentRecordRef?/reason?/changedInputRefs；沿自己的正式结果登记/链边定位入口登记行及其精确 run-state 工件，复验工程、运行、入口和前驱关联，每页 SQL 批量定位后有界读工件。C25 record-read/history 经单独 projection.query 用途授权注入该方法。重评元数据缺失、错配或不可读时返回 BUSINESS_BLOCKED，不能用 frozenRefs、triggerReasonCode 或启发式补齐；历史回填沿原 entryMode 展示，非重评的 changedInputRefs 为空。

`indicators`≤512，每项是 indicatorId、actualValue（ScalarValue）、canonicalValue/unit?、sourceReferences≤16、evidenceReferences≤256、ruleId/ruleVersion、grade/baseScore；`axes`恰 possibility/consequence 两项，strategy、score、publicScore、weightSetRef?、contributions≤512（indicatorId/baseScore/weightedScore/basisPoints?）。`matrixPlot` 只含 riskMatrixRef、possibilityBandId、consequenceBandId、riskLevelId、riskLevelOrdinal。`triggerFacts`≤1024，从保存的 trigger facts 选取 triggerType/indicatorItem/actualValue?/thresholdId?/thresholdValue?/jointRuleId?/evidenceReferences；不新增越限方向算法。

`configurationRefs` 按决策工件的七项原引用输出，规则与权重不是客户端推导。记录版本/正文/准备/输入/实际值/决策工件的关联必须一致；正文可以读取而解释不完整时整项 record-read 返回 BUSINESS_BLOCKED，不返回伪完整成功。artifact 按原模块大小上限读取和解析，不扫描 artifact 库。目录附录不读全部正文。

候选由 C33 风险记录目录与 C11 外部事件目录各自有界提供，riskInputKind 是必选来源分组（默认标准记录）；评估拥有方仅按这一页候选的精确 refs 批量判断已有评估，未评估不依赖界面猜测。分页沿上游游标推进，已评估项可标记而不循环补满页面。

C11 已实现 `readAssessmentEntryContext`；其候选接缝依赖修复 change `fix-assessment-entry-read-seam`。`AssessmentEntryContextReadPortV1.read` 使用 strict 操作判别：kind=`read-assessment-entry-context`，applicability-catalog 要求 projectRevisionRef 与 spatialScopeRef，external-event-catalog 只要求 spatialScopeRef 且拒绝 projectRevisionRef；两者均可提供 pageSize/cursor。快照项复用 ApplicabilityMetadataSnapshotRefV1 与 ApplicabilityMetadataSchema，外部事件项为 ExternalRiskEventRefV1、空间/来源精确 refs 与 EvidenceReference 列表，不返回事件工件正文。C11 registry 读取自有两张登记表：快照按精确工程/空间修订过滤，事件按登记空间 refs 和当前来源授权过滤。两目录各自 LIMIT=pageSize+1，按 recorded_at DESC/稳定ID ASC/version ASC keyset 推进；游标绑定目录、工程、其实际精确筛选和当前授权摘要，以耐久 UUID 定位键解析微秒精确锚点，保持 512 字符上限。迁移与定位列由修复 change 拥有。保存字段损坏返回类型化失败。授权分支仍为 `engineering-data.context-read`，C25 每次目录读取以实际 queryId 独立签发；请求空间从当前已验证 C06 范围归一到同一空间身份的授权修订，业务精确修订只用于事实筛选。

`entry-context` 组合结果将两个独立目录的游标明确命名为 applicabilityNextCursor/externalEventNextCursor；输入对应 applicabilityCursor/externalEventCursor。每次最多各取一页，不用单一游标同步两类集合。`pending-catalog` 选外部事件时只调用 external-event-catalog 并透传其游标。复用 C11 原登记行与解析器，范围契约由 engineering-context-source-registry delta 固定。

来源范围经修复 change 的 C11 `readAuthorizedSourceVersions` 窄接缝继承：使用 C25 原 queryId 与当前 risk-assessment.read 验证上下文，只定位其中至多 256 项来源授权身份对应的就绪来源版本。C25 以所得版本逐次签发目录授权并核对空间/来源范围没有扩大；不在 fixture 或页面补造资料权限，不增加页面来源版本必填项。

`entry-context` 的运行 graphVersion/retryPolicyRef 均使用 `VersionReferenceSchema`，与既有 start-run 的字段同形，由部署在组合根显式注入精确配置，不新增“当前策略”表或默认值。输入适用性/外部事件由 C11 的窄读接缝 `AssessmentEntryContextReadPortV1.read` 按各操作事实范围提供，使用逐次配对签发的授权；只读已登记快照，预览不冻结输入。C30 在 start-run 时重新验证所选精确版本并执行原 A0～A2 冻结。不存在合格快照、部署配置或风险输入则 unavailable，不能替用户填写默认引用。

### D-05 预警处置查询与字段投影

`warning-catalog`：空间、triggerType?、分页；items≤50 包含 warningRecordRef、assessmentRecordRef、taskRef、triggerType、warningLevel、occurredAt、acknowledged:boolean。`task-catalog`：空间、status:open|closed?、分页；items≤50 包含 taskRef、status、riskInput、spatialScopeRef、warningCount、occurredAt。`overview` 输出 openTaskCount、warningCount（只算开放任务关联的去重预警）、levelCounts≤32、asOf；只聚合已授权空间内拥有方的表，不返回全库结果给 UI 计数。

其余操作均为精确单对象，成功结果 kind=operation；各关系集合≤50 且有 `nextCursor`，payload 支持 `relatedCursor`。无法证明完整的对象集合不静默裁切；关系分页缺席标为 absent，不把失败伪装为 absent。

| operation / 精确输入 | 必含读取字段与来源 |
| --- | --- |
| `warning-read` / warningRecordRef | 原 WarningRecord、taskRef、确认 actorId/time/audit；通知 intentRef/recipientActorId/channel/recordedAt/deliveredAt?；触发阈值解释由对应 C25 record-read 得到，不引用当前配置 |
| `task-read` / warningResponseTaskRef | C26 taskRef/status/riskInput/spatialScopeRef/occurredAt、预警精确引用页；C27 正式 recommendationRefs；C41 decisionRefs；C28 execution/forecast/feedbackRefs；C29 calibrationRefs，由各所属接缝提供 |
| `recommendation-read` / responseRecommendationRef | 原 ResponseRecommendation、冻结 taskRef、C27 三项 validationResults（checkId/pass/evidenceReferences/reasonCode?）、generation/validationPolicyRef、正式措施发布 refs；C41 终局 decision 状态/actor/time/reason/ref/forecastRunRef? |
| `forecast-read` / effectForecastRef | C28 forecastRef/recommendationRef/routeDecisionRef/runRef/inputSnapshotRef/frozenAssessmentBasisRef/preActionMonitoringSnapshotRef/baselineAssessmentRecordRef/forecastPolicyRef/method/targetIndicatorId/unit/horizonSteps；available 的 predictedValue/predictedRiskState 或 unavailable+reasonCode；不伪造趋势曲线 |
| `execution-read` / executionRecordRef | C28 source 判别联合、actor IDs、occurredAt、spatialScopeRef、evidenceReferences、feedbackRefs 分页 |
| `feedback-read` / feedbackRef | C28 executionRef/postActionMonitoringSnapshotRef/feedbackArtifactRef/actualAssessmentRecordRef/time/actor、forecast 可用性；偏差可用时为策略ref/basis/targetIndicatorId/unit/predictedValue/actualValue/deviationValue/thresholdExceeded/direction/riskMatrixRef/两端riskState/证据/计算时刻；C29 公共偏差 ref 与校准 refs 只在真实成立时提供 |
| `calibration-read` / calibrationSuggestionRef | C29 目标类型/targetReleaseRef/冻结输入ref/validationPolicyRef、类型化 operations≤64、逐项 validation、状态、reviewTaskRef、deviationRecordRef/versionId、reviewDecisionRef?、candidateArtifactRef?、knowledgeRevisionRef?；冻结输入中的 Agent task/model/prompt/tool/budget 引用 |
| `resolve` / entityId+targetKind | warning/task/recommendation/forecast/execution/feedback/calibration 七种闭合集，返回精确可见 ref；指定版本不调用 resolve |

表中字段均投影已有 Schema/登记列，映射名集中在 contracts，不复制整套 C28 业务记录。预测/偏差不可用使用 `{kind:'unavailable',reasonCode}`；available 分支才允许数值/风险状态。偏差阈值正文按其冻结 deviationPolicyRef 经知识窄读取得，取得失败显示版本引用与不可用原因，不以当前阈值补齐。

校准变化摘要按 core 操作解析后投影：replace-weight-entry 为 axis/indicatorId/basisPoints；replace-risk-matrix-band 为 axis/bandId/lower/upper；replace-risk-acceptance-threshold 为 thresholdId/maximumAcceptedLevelId；replace-monitoring-warning-threshold 为 thresholdId/monitoringIndicator/parameterCode/metric/unit/comparison/warningLevelId；replace-deviation-policy 按 basis 分为 policyId+threshold、policyId+threshold+minimumBaseline、policyId+levelStep+riskMatrixRef；replace-scoring-rule-interval 为 ruleId+replacement，replacement 直接复用 contracts 既有 ScoringThresholdSchema 或 GradeIntervalSchema。comparison 按 gt/gte/lt/lte+boundary 或 outside+lower/upper 的已存形状投影，公共比较枚举从 core 上移 vocabulary；无新比较逻辑。候选工件精确引用提供完整重建入口，摘要不能作为写命令 payload。

### D-06 所有权、组合与权限

解释的跨域读取分两层：`warning-read` 返回精确 assessmentRecordRef，页面独立调用 C25 `record-read` 获取冻结触发阈值；`feedback-read` 返回冻结 deviationPolicyRef，页面通过既有 `readKnowledgeRelease` 获取获准偏差阈值正文。C26 不投影这两类正文，不增加对 C25/知识私表的访问；页面分别呈现各读取的失败与精确版本。所属 C27/C28/C29/C41 窄读仍由 C26 显式注入。

新只读方法在各现有 adapter 内实现并复用其解析/授权/事务依赖；不创建通用只读数据库服务。C25/C26/C27/C28/C29/C41 各只读自己的表。风险评估端口在 C25 factory 组合注入的识别目录、C11 输入读与 C30 运行读；预警处置端口在 C26 factory 组合注入的 C27/C28/C29/C41 窄读方法。注入接口使用 contracts 中按 operation 提取的入出类型，不透传任意对象。

每次下游读以当前主体/工程和已有请求空间/来源上限，按所属现有 branch 与唯一 invocationId 独立签发、再复验；不把入口读授权改写成其它分支，不复用错误 branch 的上下文。C30 run-read 用单独 projection.query 授权，由 workflow adapter 读取自己的登记行及精确 state/stage 工件；既有 run-view/result-read 继续用于追溯，不扩大 ProjectionResultItemV1 为业务正文。

新两个 read branch 授予 reviewer、field-responder、business-viewer；经理仍由 allBranches 自动拥有，system-administrator 不获工程业务权限。field-responder 补 `projection.result-read`、`knowledge-modeling.governance-read`，使已有公开矩阵/措施与投影可读；不授予经理的启动/采纳/确认/校准治理写权。校准两个写 branch 仅经理。复核专家在 C07 作决定，经理在 C29 推进；不自动将专家读/决定权限变为配置治理权限。

两个公开 read 的所有成功变体（包括 resolve）统一带 `actorId`（本次 verified actor）与 `actions≤8`：branch、availability=allowed/denied/business-unavailable/hidden、reasonCode?；无适用动作返回空数组。可用性由服务端对规定动作分别检查当前权限和已读事实，不能用单一读 capability 推断所有写能力；不同用途使用独立请求身份。授权检查只产生安全呈现元数据，不执行领域命令；实际提交重新签发/复验。hidden 动作不渲染，denied 原生 disabled，业务缺失显示原因。客户端不硬编码角色镜像，也不从 accountRef 推断 actorId。

### D-07 人工写命令与确认

| 入口 | 公共 branch 与固定 payload |
| --- | --- |
| 初评 | workflow.start-run：entryMode=assess，graphVersion/retryPolicyRef、riskInput、projectRevisionRef/spatialScopeRef、applicabilityMetadataSnapshotRef、monitoringSnapshotRefs? |
| 重评 | 同 branch：entryMode=reassess，previousAssessmentRecordRef、reason 使用 workflow 枚举（weight-strategy）、changedInputRefs、明确变化后的空间/适用性/监测；不改前驱 |
| 预警确认 | warning-response.acknowledge：warningRecordRef+warningResponseTaskRef |
| 采纳/拒绝 | warning-response.adopt-recommendation：正式建议ref、decision、reasonCode；采纳含明确 preActionMonitoringSnapshotRef，由 C41 建立真实等待运行与绑定 |
| 执行 | warning-response.record-execution：原 actionSource、executedByActorId/recordedByActorId（当前 verified actor）、occurredAt、非空 EvidenceReference；身份不提供自由编辑 |
| 反馈 | warning-response.record-feedback：executionRecordRef、postActionMonitoringSnapshotRef、反馈工件完整 ref、occurredAt、必填 actualAssessmentRecordRef；不提交 P/C |

动作确认冻结整个信封（含 issuedAt/commandId/idempotencyKey/空间/来源）和 payload。网络异常保留同一冻结请求；payload、版本或工程变化必须废弃确认并创建新身份，不能只保留 commandId 再更新时间。补全 `postCommand` 的可选空间/来源范围与冻结信封输入；普通既有调用保持签名可用。陈旧版本要求刷新并再次确认，不自动改引用。

ConfirmButton 支持动作 availability、必须绑定真实 handler 才可提交、默认取消焦点、Escape、焦点约束与恢复、pending 禁重复提交、关联原因。未接线静态按钮移除。反馈工件与 EvidenceReference 使用已登记精确引用输入和已有证据入口；本轮不引入上传/自由 URL。形式检查不能代替服务端读取授权与业务判断。

### D-08 校准治理授权和事务

两条窄命令复用 C29 `recordReviewOutcome/createGovernanceDraft`。公共包装只剥离 kind，不改变原业务身份。`#verify` 接受实际入口 branch；prepare/createSuggestion 仍用原分支，两条治理用自身 branch。在读取建议或决定正文前，移除不可达的“上下文同时三能力”断言，改为分别取得 C07 专用校准证明和 C16 submit-revision 的真实用途授权；原 `#authorizeFor` 保持当前主体/工程/空间边界检查。下游知识读取同样单独授权。

`#verify` 返回的当前 C06 decision.context 必须沿用到后续身份/范围判断，不能丢弃后改信调用方能力数组。两个公开命令的 outcome 各自闭合；原内部 `CalibrationReviewOutcomeCommandV1Schema` 保持三种 outcome 的联合以服务两既有方法，联合由上述两个 payload Schema 派生，公共包装的 kind/outcome 配对不能放宽为该内部联合。原内部无 kind 入口沿用原分支，公开包装明确传递本次已验证 branch，不从任意客户端字段选择。

收口成功输出 suggestionRef、outcome=rejected|returned、deviationRecordRef/versionId。草案输出 governanceDraftRef、knowledgeRevisionRef、candidateArtifactRef、deviationRecordRef/versionId；approved-for-draft 不是收口分支的成功 outcome。真实 C07 证明必须与 task、suggestion 及 decision 精确匹配，不能相信 payload 声明。校准页读取到决定后允许经理确认“记录拒绝/退回”或“创建草案”，不代作决定。

两条 HTTP 路由分别使用 `CalibrationReviewOutcomeResultV1Schema` 与 `CalibrationGovernanceDraftResultV1Schema` 校验结果，不能用两者宽联合代替分支结果。内部 C29 用例保留其现有结果集合；公共包装仅返回本次分支允许的形状，遇到错误 outcome 安全失败。stub 测试也按实际公共结果 Schema 构造，不用类型强转掩盖缺字段。

读取无新业务写入/事务；各业务命令事实、回执、审计、Outbox 沿原事务成立。C41 采纳等待运行和 C29→C16 草案为既有多阶段可恢复流程，不声称跨服务大事务。C16 已创建修订而 C29 尾事务失败时沿原 `:submit-revision` 子身份重试，取得同一修订再收口，不能创建第二份修订或宣称发布。退回预留/后继、基准漂移及拒绝规则均沿原 C29，UI 不创建后继候选。

### D-09 原型 GAP 裁决与矩阵呈现

| 原型缺口 | 本轮处理 |
| --- | --- |
| RA-01 入口类别 | 从 preparation.entryMode 读，不改 record.kind |
| RA-02 指标轴 | 从保存的 axisScores.contributions 关联指标，不加 side 字段 |
| RA-03 分带 | 保存的 matrixPlot+冻结 C18 band/cell 定义；不由前端评分 |
| WR-01/02 | triggerType 单值；阈值取保存 trigger fact；方向仅有原冻结定义可证明时显示 |
| WR-03 | task.status 仍 open/closed；独立确认/决定/执行/反馈事件列表替代六步状态 |
| WR-04 | recipientActorId 与 in-app 真实 intent/delivery，缺席 delivery 不等于送达 |
| RS-01/02 | 用 C28 实际 Schema 解析后投影；执行措施子集/未执行说明无保存事实则不展示 |
| RS-03/04/05 | 目标操作/逐项校验/草案来自 C29；排序只展示保存的 implementationOrder；所有域读取同一真实引用链 |
| GAP-005/007 | 概览本轮落地，报告导出归 C35 |

矩阵适配函数只映射 bandId→轴刻度、cell→等级、等级 ordinal→主题色；等级名称缺席则显示领域 levelId。按冻结 acceptance threshold 可证明的可接受区绘制，缺失不画可接受阴影。每轴≤32、cells≤1024，每页 plots≤50；多版本分组，不能把一页坐标贴到另一矩阵。知识页现有 RiskMatrixPage 同时复用新版 SVG，消除固定 5×5；不升级/删除 ECharts。

### D-10 状态、性能、错误与可观测性

P-OV-01 保留 C31 的 `risk-overview` 运行引用区，使用现有 projection.query 登记与 projection.result-read 分页，一次只读取一页（≤50），续页由用户请求，不调用现有 `readRiskOverviewRuns` 的读尽循环。IP-09 新增同文件 `readRiskOverviewRunPage` 复用其 query/result 解码。C31 区保留 queryResultRef、查询时点与精确运行/证据引用，失败独立呈现。C34 两个 overview 只提供当前获准空间的评估记录版本数、开放任务/预警摘要，各标 asOf 与口径；它们不改 C31 历史查询内容、不为报告提供另一份重放输入，也不从链边计算 P/C。页面不能将三个来源相加为风险总数。选择补充所属摘要是因为 C31 返回事实引用，不承诺全库评估/任务统计；C31 有界历史投影语义保持原样，由新增 delta 明确此关系。

demo PageState 补齐 idle/loading/ready/empty/error/forbidden/unavailable。usePageQuery 增请求修订检查，AbortController 加上下文标识共同阻止迟到结果。活动运行每 5 秒、单一在途读取，页面不可见暂停，终态/卸载停止；不依赖跨 DOM 扫描或全量 projection 翻页。

目录 keyset 游标绑定 project、operation、筛选、空间/来源授权与排序键；每次读取重新检查当前权限。采用 base64url 编码的 strict 游标对象（不是权限凭证），键为 schemaVersion/projectId/operation/filterDigest/scopeDigest/afterOccurredAt/afterEntityId/afterVersionId；排序为 occurredAt DESC、entityId ASC、versionId ASC，SQL limit=pageSize+1。同工程等效新查询可续页，作用域改变/格式篡改拒绝；游标不能决定目标所属或扩大范围。统计由拥有方 SQL 聚合，按有界等级/任务分类返回；不泄露未授权总量。复杂关系显式分页，明示当前页分布，关系读取不逐项跨域补查；C25 在单页精确记录集合上批量读取自有登记行，矩阵落点从各自保存的决策工件投影，最多读取 50 份去重决策工件、并发不超过现有 C04 上限 4，不为目录加载实际值/全部正文；单个工件关联或权限错误使该查询失败闭合。上游 C33 目录目前读取全部可见记录再截断，不能直接用于此路径：将该所属 record-catalog 读取改为 SQL 分页后保留原公开结果形状，并回归 C33；不改识别 run-list 的范围。

错误沿 ModuleError/HttpError，ApiError 保留 STALE_VERSION、BUSINESS_BLOCKED 与稳定原因/关联标识；不新增错误码，不展示 SQL/堆栈/payload/模型响应。授予撤销、目标不存在与跨工程对无权用户同形。审计沿所属命令实现同步写入；读操作沿已有所属读取审计语义，HTTP 只记录原安全元数据。任何 Agent 来源只展示公开任务/模型/提示/工具/预算引用，不展示思维链。

### D-11 文件所有权、依赖与验收

验收组合根明确落在现有 `demo/test/browser/server.mjs`，由 IP-12 扩展其 `startDemoBrowserServer` 装配。当前 harness 只有 C32/C33 所需读取端口，不能当作已有 C34 装配。复用同一 appRuntime、transactionUnit、artifactStore、access、registry、monitoringStore、reviewAudit 与 workflow 的生产工厂，在同一工程数据库上创建 C25 engine、C26 warning、C27 recommendation、C28 responseLifecycle、C29 calibration、C41 humanDecisionFeedback 及 C16 knowledgeGovernance；下游 authorize/verify 通过同一真实 C06 access 按用途签发和复验，不导入 fixture 中的伪上下文或 SQL 成功代写。

工作流复用 `apps/worker/dist/assessment/index.js` 的 `createAssessmentGraphComposition` 与 `apps/worker/dist/risk-flow/index.js` 的 `createRiskFlowGraphComposition`，真实 PostgreSQL checkpointer 与版本化重试配置按 C30 的 composition tests 装配；Worker 的改动限于 D-12 的入口保存、传递、身份与命令绑定、原因映射及恢复，不更改阶段路由、评分算法或 Agent 门。父图、评估子图及 C41 人工决定证明在 setup 阶段完成相互引用绑定，开始接收 HTTP 前核对必需端口。HTTP 直接注入父 runtime 的既有 `workflowPort`（startRun/resumeRun/cancelRun），C41 使用同一 runtime 与真实 reviewAudit 证明读，不再写一层运行映射。评估图注入 C11/C19/C25/C26/C27/C28/C29 既有公开用例；预测的确定性执行器使用版本化合成统计输入，Agent 使用真实任务契约和已收口合成候选，不以成功 stub 代替三项校验、任务预算或记录事务。

`buildApi` 在上述组合根注入原有命令端口 riskAssessment、warningResponse、humanDecisionFeedback、workflow，以及新增 riskAssessmentRead、warningResponseRead、calibrationGovernance；同时保留 C32/C33 的所有端口。矩阵与措施读取沿现有 knowledgeGovernanceRead；校准提交沿 C16 真实端口。新增 runtime/checkpointer 的清理加入现有 closeables。复用各领域 test fixture 的样本形状和政策文档，在同一数据库登记真实输入与工件；不启动多套 fixture 容器再拼异库引用。

本 change 的交付是 demo 前端、公开端口实现与上述可运行验收组合。仓库现有 API 是可注入库，C34 不新增部署服务入口；其它宿主按相同必需注入契约接线，未注入则原路由保持关闭。缺少 Docker/Chromium/策略/必需领域端口时验收非零退出，不能以现有只读 harness 或未接命令的页面通过。

文件闭合集与 IP-ID 在 implementation-plan。实现若需额外公共契约、迁移、依赖或跨域文件必须升级；普通范围内测试失败自行修复。无需新 dependency、package exports 子路径、表、索引或迁移；现有 index 仅导出新窄读方法/工厂。

复用既有 testcontainers fixtures 与真实浏览器 harness，只新增有价值的读契约边界/浏览器闭环测试；校准测试改用单分支上下文并至少一例真实 C06，不用拼接三能力伪证明。合成版本化工程样本标记待甲方复核，确定性校验后的 Agent 候选可作为测试输入，模型随机输出不成为硬期望。性能以固定 50 项分页、32×32 矩阵、带大量无权行的查询作代表性测量，记录行数/工件读取数/耗时与 DOM 节点上限；不制定无依据的硬延迟门禁。

RA-S1/S2→候选、适用性与冻结版本；RA-S3/S4→实际值、规则、轴贡献、矩阵；RA-S5/S6→正式评估、触发、预警及通知；RA-S7→建议、决定、执行、预测、反馈、偏差、校准与草案；RI-S6→标准风险与证据精确引用。所有追溯沿资料段→工序→机理→风险→评估→预警→建议→偏差/校准，不向识别 record-read 填第二套评估字段。

### D-12 重评入口保存、身份与恢复

`WorkflowGraphRunStateV1Schema` 增加可选 `reassessmentEntry`，直接引用 D-03 的 `WorkflowReassessmentInputV1Schema`。新 reassess 启动必须完整提供该对象；其它入口不携带。历史工件允许字段缺席以保持原版本可读，但缺字段的重评解释和继续评估均失败闭合。此字段是不可变的入口事实，不是新的图状态；不修改公共 LangGraph 状态、阶段枚举、表、索引或 bodyKind。

公开 start-run 解析后把前驱、reason、changedInputRefs 原样组成 reassessmentEntry，沿父运行上下文、`segmentedAssessmentStartCommandFor`、`WorkflowGraphRunCommandV1`、评估 runtime 与 `AssessmentGraphRunContextV1` 传递。原 previousAssessmentRecordRef 接缝从该对象取值，不保留可独立改变的第二套前驱。frozenRefs 仍作为全部获准输入集合；变化引用与其相交或重复不改变 reassessmentEntry 的内容。1..64 边界在启动前校验，越界拒绝而不截断。

父图 `runStateBody` 和子图 `cursorBody` 每次形成 run-state 工件均保留同一 reassessmentEntry；后续推进先取已登记值并核对传入值。父 preparing 与子 A0 的 entry-snapshot 登记行均引用本次同批写入的 run-state 工件，在原登记/审计/回执事务中收口。C04 正文先按现有方式落不可变工件，再事务登记引用；登记失败不产生已成立入口事实，重试复用同一工件。恢复、重试和取消从当前获准的精确已登记 run-state 取该对象，核对入口身份和父子关联后交给 runtime，不依赖 checkpoint 的临时 config 或调用方重填。

`workflowEntryIdentityFor` 作为父子入口身份的唯一构造函数，增加可选 reassessmentEntry 输入，父公开 startRunPort 与子 runtime 的 entryIdentityConsistent 均调用它；非重评不带该字段，保持其原身份。父入口身份摘要包含现有冻结输入及完整 reassessmentEntry，子入口沿父精确身份派生；不同前驱、原因或变化引用不可共享一个运行分区。重评输入摘要使用现有 canonical JSON，不引入额外哈希门禁，也不要求把前驱伪装成变化引用加入 frozenRefs。

公开 startRunPort 在 Schema/入口检查和当前 workflow.start-run 授权复验后、任何图调用前，以现有 TransactionUnit 执行一个短的命令身份绑定事务。AtomicCommand 的 commandKind 固定为 `workflow.start-run`，commandId/idempotencyKey 使用原公开命令值，payload 固定为 `{commandId, actorId, issuedAt, payload}`（payload 为解析后的完整 StartWorkflowPayloadV1）；projectId 沿原命令。授权签名不进入载荷摘要，重试仍重新复验当前授权。handler 只返回确定性 workflowRunRef 并按 `workflow.start-run-bound` 写一次绑定审计，不调用图、不登记业务成功、不发业务事件。现有 command_receipts 的 payload_sha256 和唯一键负责同键异载荷冲突，不新增回执表或通用协议。

绑定事务结束后才调用原 start；原 preparing/A0 及后续阶段继续使用运行/动作身份的原登记事务，不把图调用包在 TransactionUnit handler 中，也不把阶段动作键换成当次 resume 键。receipt 重放先核对其 workflowRunRef 与本次确定性入口一致，再按当前授权启动尚未登记的同一运行或回读已成立运行。绑定完成后进程中断、C04 写成功而登记失败、或响应丢失时，原命令可沿此路径重试；只有真实运行登记成立后才返回业务成功或等待。绑定审计与运行登记审计分别描述其事实，同一重放均不重复。异载荷在绑定阶段失败，不进入第二个图/评估运行；已有运行命中路径也必须先完成绑定判异，不能通过提前返回 existing 绕过。

core workflow 导出唯一 `assessmentReasonForWorkflowReassessmentV1`，输入 workflow 原因 Schema，输出 C25 reassessment 原因类型：仅 weight-strategy 映射为 weight-or-strategy，其余四码原样；Worker A2 直接使用它，移除按 frozenRefs 数量推导原因的函数。C34 解释保留原 workflow reason；A0 的 triggerReasonCode 沿原 entryMode 语义，不用它恢复重评原因。

`evaluateWorkflowEntryGate` 区分监测字段缺席与显式空集合：assess/reassess/historical-backfill 两字段均缺席时按无监测输入继续；显式空集合、两字段冲突或非法引用仍拒绝。复用现有 normalizeMonitoringInputs 检查，不增加默认监测或改变其它入口的必需输入。

选择既有 run-state 工件是因为它已经由拥有方读端和恢复路径解析，并能在原登记事务中关联入口；独立入口表需要迁移，新增工件类型会扩展存储策略与解析面，从冻结集合猜测则无法恢复用户事实。D-12 不回填或改写历史工件。

## Risks / Trade-offs

- 读取接缝涉及多个拥有方，采用已有 adapter 的窄方法和显式注入，不以通用聚合读库缩短表面代码。C29 真实权限/尾事务为本轮限定审计重点。
- 无已登记监测、反馈工件、适用性快照或实际评估时表单不能完成正式写入；页面给出真实前置入口，不临时造数据。不存在配置的环境明确 unavailable。
- v2 布局可复用，示例字段并非全部能落地；没有正式事实的展示项省略，图表以单点/可用性结果呈现，不编造预测序列。
- 历史重评可能没有显式入口元数据；保留原记录与版本，精确解释返回 BUSINESS_BLOCKED。新输入的保存与恢复必须经真实事务和父子运行验收，不能由 adapter 自行补猜。

## Migration Plan

先落公共契约、授权与拥有方读方法，再接 HTTP，最后替换页面和清理其 fixture 引用。无数据库迁移或数据回填；不修改旧记录。现有可读页面保持原 HTTP 语义。验证后才由 Finalizer 建 verification；Planning 完成不表示实现完成，不提前归档。

## Open Questions

无实现阻塞决定。甲方样本复核与部署策略配置属于后续交付输入，不影响本轮 Schema、范围或测试设计。
