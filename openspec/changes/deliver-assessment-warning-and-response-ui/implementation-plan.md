# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`d1ad73a005b08cd8fb2718c597ba0ae1af2b7019`，main。首先核对当前 HEAD、dirty paths 与实际符号；不得覆盖已有改动。基线已有 IP-01/02/08 的基础实现，按当前设计补正和复验，不重写已成立接线。
- 权威输入：本 change proposal、全部 delta specs、design D-01～D-13；主规格及归档 C10、C25～C31；实现复用已归档 C32/C33/C41。v2 仅设计输入。
- 范围：P-OV-01 + C34 16 页；初评/重评、预警确认、采纳/拒绝、两类执行、反馈、校准收口/草案。历史回填只读；报告导出、关闭任务、质疑预警、线下通知与运维不交付。
- 本 change 无新依赖/锁文件或自有迁移；C22/C33 登记补全已形成 `000054`，C11 候选读取依赖修复 change `fix-assessment-entry-read-seam` 的 `000055` 内部定位列与索引。D-13 补齐 C27 分类型触发一致性；不变更业务评分、预测、偏差、Agent 增量/预算和配置发布语义。
- Planning 只闭合 applyRequires，不创建 verification。实施前完整读取 apply instructions 的 contextFiles。

实施完成状态以 tasks 和可运行证据为准；D-13 的 IP-13 未完成，基线回归或其它 IP 的通过不代替新增 Scenario 的证据。主调度审阅补充规划并形成固定 Git 检查点后才向其它 Agent 交接；Git 权限仍按本 session 授权，未提交工件不复制给另一个 Agent。派发和收口按实时 resumeQueue 与当前阶段责任处理，部分实现不以 succeeded 收口。本文件不预填 Task/Run/Dispatch 或后续角色。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | contracts ports 的 querySchema/commandSchema/moduleResultSchema/MODULE_BRANCH_CAPABILITY_V1；records 四类记录；workflows 风险输入与快照 | 两 read+两治理命令、C11 候选窄读及所属窄读类型，按 D-03～05 | 不新建第二套记录，不让 contracts import core |
| IP-02 | core access PRESET_ROLE_BRANCHES_V1；各 adapter 现有 authorize/verify 依赖 | 当前分支签发、只读角色加法和 actions 投影 | 不伪造三能力上下文，不使用客户端角色镜像 |
| IP-03 | C11 PostgresEngineeringContextSourceRegistry；C33 PostgresRiskIdentificationReadAdapter.#recordCatalog | 所属输入快照/外部事件窄读，标准记录 SQL 分页 | 不跨域读工程/识别私表，不读全库后截断 |
| IP-04 | C25 PostgresRiskAssessmentEngine 与 AssessmentDecisionArtifactV1Schema/IndicatorActualValueSetV1Schema | 自表记录/解释/历史/摘要，注入 IP-03/05 | 不重新评分，不复制风险事件或指标 Schema |
| IP-05 | C30 createPostgresWorkflowAdapter/WorkflowGraphArtifactBodyV1Schema/WorkflowGraphRunStateV1Schema；core evaluateWorkflowEntryGate；Worker createRiskFlowGraphRuntime、runStateBody、cursorBody、segmentedAssessmentStartCommandFor | D-12 显式重评入口保存/传递/恢复与唯一原因映射，运行窄读、阶段/结果投影 | 不从冻结并集推导变化，不复制原因算法，不添加状态机或迁移 |
| IP-06 | C26/27/28/41 现有 adapters 与 core schema | 各自窄读，通过 C26 factory 组合 | 不让聚合器读其它拥有方表，不伪造任务状态 |
| IP-07 | C29 createPostgresCalibrationAdapter、#verify/#authorizeFor、recordReviewOutcome/createGovernanceDraft | 校准窄读、真实单分支治理命令包装 | 不绕批准证明，不发布配置，不改变原幂等子身份 |
| IP-08 | API HTTP_ROUTE_CATALOG_V1/ApiPortsV1/invoke/commandRoutes/queryRoutes | 3 注入位、4 分支，自动 OpenAPI | 不改会话签发模型、错误信封或创建专用 handler |
| IP-09 | demo api client postCommand/submitCommand、operations asRecord/readKnowledgeRelease/readRiskOverviewRuns、context usePageQuery/useProjectPath；ConfirmButton/PageStateView | 新 typed operations、C31 单页读取、冻结信封、状态竞态/权限/确认 | 不在页面拼 HTTP，不从 accountRef 猜 actorId，不循环读尽投影 |
| IP-10 | demo 评估/概览页；v2 assessment/overview 页面、RiskMatrixVersionChart | 布局移植、真实 operations、单轮询、版本化矩阵 | 不搬 fixture、全套图表、状态注入或镜像 |
| IP-11 | demo WarningCenter/WarningDetail/ResponseTasks；v2 warning/response 页面 | 真实预警、正式建议、人工表单、校准治理 | 不用采纳代替执行，不在 UI 算偏差 |
| IP-12 | demo/test/browser/server.mjs.startDemoBrowserServer、C25～C29/C41 fixtures、worker createAssessmentGraphComposition/createRiskFlowGraphComposition/runtime.workflowPort、Playwright demo-chromium | 单数据库真实领域/Worker/授权/C16/C07 组合、回归、测量与证据 | 不以 stub/Mock HTTP 命令包装完工，不 skip 关键场景，不复制运行映射 |
| IP-13 | core recommendation resolveTriggerIndicators/selectFrozenMeasures/validateRecommendationCandidate/RecommendationFrozenWarningV1Schema/buildRecommendationValidationEvidence；PostgresRecommendationContextReader.readFrozenContext/#loadWarning/readMember；既有 recommendation tests/fixture | D-13 类型化解析、风险等级最小冻结依据、对应措施及有效目标校验；IP-12 复用 postBranch/startRealAssessmentAndReadWarnings/postResultRead/makeDemoAssessmentConfigurationDocuments | 不把阈值 ID 当指标，不跳过失败，不重算 P/C，不要求覆盖全部评分指标，不重写旧候选 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1 | domain 两 read Requirements及重评入口 Requirement、engineering-context 候选 Requirement、http 两 Requirements、calibration Requirement | contracts ports/vocabulary；core warning/calibration/assessment-config schema | D-03/04/05 DTO；resolve actions；runPolicy VersionReference；WorkflowReassessmentInputV1Schema；workflow/read 原因SSOT；收口结果窄化；比较/操作枚举复用；共用治理 payload | 既有记录字段、C25 原因码集合、能力值、无 kind 内部调用形状 |
| IP-02 | 1.2 | web 所有写入/权限；domain 安全失败 | core access policy、test/access.test.ts；各 factory options | D-06 固定角色授予；动作列表仅按合法 branch 当前授权产生 | 不扩写权，不扩大空间/来源 |
| IP-03 | 2.1 | engineering-context 候选读取两 Scenario；domain 评估有界候选；web 启动前置 | C11 registry、C33 read adapter | 复用已实现 readAssessmentEntryContext 与修复 change 的操作判别/耐久有界游标；#recordCatalog SQL 筛选/limit/offset，保持既有 offset 游标与结果 | 原 C33 public signature、其它 run-list、事件登记语义 |
| IP-04 | 2.3 | web 评估/矩阵/历史/概览，domain 评估两 Scenario | C25 engine、index；risk-assessment tests | 候选接缝先复用 fix-assessment-entry-read-seam 的逐次身份/权限与输入修复，再完成 read/组合 factory：页级候选评估状态、entry-context、record catalog/read、history、overview、resolve、run-read；读保存工件/校验关联，完整接线验收仍由本任务负责 | P/C、阈值、正文 SSOT、只追加历史 |
| IP-05 | 2.2/2.9/2.10/2.11 | web 运行/历史，domain 重评入口与精确版本 | core workflow schema/service；Worker risk-flow graph/runtime、assessment graph/runtime；C30 workflow adapter/index；core/Worker/workflow tests | D-12 保存 reassessmentEntry；入口身份包含显式元数据；父子启动/恢复共用；assessmentReasonForWorkflowReassessmentV1；去除启发式；无监测门禁修复；readAssessmentRun 与 readAssessmentEntriesForRecords 从获准登记工件读取 | P/C、阶段路由、Agent 门、表/bodyKind/checkpoint形状、授权上下限、既有非重评运行身份 |
| IP-06 | 2.4/2.5/2.7 | web 预警/建议/执行/反馈/预测/概览；domain 预警读 | C26 warning、C27 recommendation、C28 response-lifecycle、C41 human-decision-feedback adapters/index | 自表窄读、精确关系页、保存 Schema 解析；C26 组合 WarningResponseReadPortV1；开放任务统计及通知最小披露 | 原命令、通知投递、任务 open/closed、拒绝/采纳互斥 |
| IP-07 | 2.6/2.7 | calibration 三 Scenario；web 校准批准 | C29 adapter；core schema/service；calibration fixture/test | readCalibrationView 解析行/冻结工件；治理 port 包装；#verify branch 参数；逐用途证明/治理授权替代三能力断言，原业务事务不变 | 后继预留、真实证明、单草案、未发布边界 |
| IP-08 | 2.8 | http 全部 Scenario | apps/api/src/http.ts、test/http-shell.test.ts | 复验 3 注入位和4分支；两治理路由分别绑定窄结果Schema；读stub按Schema构造，覆盖resolve actions与错误分支响应 | 既有 HTTP 信封/路由，app.ts 的签发逻辑 |
| IP-09 | 3.1 | web 页面状态/写确认/权限/重试；domain C31/C34 独立口径 | demo client/operations/context；ConfirmButton/PageStateView | 所有 D-04/05 queries 白名单解码；新增 readRiskOverviewRunPage 复用原投影单页解码；D-07/08 命令封装；冻结完整信封、精确深链、动作门控、七态、迟到响应抑制 | 既有 C32/C33 成功读取/决定操作，不泄露正文 |
| IP-10 | 3.2/3.3 | web 前四 Requirement、风险态势 Requirement；domain C31/C34 独立口径 | demo App、7 评估页、RiskOverview/RiskMatrix 页、SVG chart | D-02 路由，v2 分区；轴贡献/触发/版本解释；矩阵分组/落点；单轮询；概览双摘要+原投影分页区的独立状态；移除假导出 | 不新增导航，不硬编码矩阵，历史回填只读，不改原历史投影 |
| IP-11 | 3.4/3.5 | web 预警/建议/执行/预测偏差/校准 Requirement | demo 4 预警/5 处置页、shared | D-05 数据投影，D-07/08 真提交；任务事实时间线、采纳/拒绝、两类执行+反馈表单、校准决定/草案链接 | 候选不能被采纳，确认不关闭任务，发布仍在治理 |
| IP-12 | 1.1/1.2、2.1～2.13、4.1～4.4 | 全部验收/性能/真实接缝 | contracts 新 read test；各所属现有 tests/fixtures；demo harness+新 browser spec | D-11 单库装配 C25～C29/C41/C16/C07 与 worker 两组合根/真实checkpointer/runtime.workflowPort；场景集、真实授权/命令/事务、17 页、响应丢失/迟到/版本/撤权、有限性能记录；与 IP-13 共用等级预警及混合触发验收 | 不新增测试框架，不断言整段文本/CSS或模型随机结果 |
| IP-13 | 2.12/2.13 | response-recommendation「三项处置约束由确定性模块逐项校验」的六个 Scenario | packages/core/src/recommendation/service.ts/schema.ts；packages/adapters/src/recommendation/postgres-recommendation-adapter.ts；既有 core/adapter recommendation tests 与 fixture | D-13 完整 TriggerIndicator 输入、riskAcceptanceBasis strict 私有摘要；#loadWarning 精确解析 record_payload，readMember 受权读取阈值/矩阵并核对相容/适用/等级；validateRecommendationCandidate 分类型且逐预警检查，diagnostics 留证；真实入库/待复核/原键重放回归 | 公共记录/命令/枚举、P/C、阈值配置、Agent 门、候选身份算法、权限/事务、旧工件 |
| IP-13/IP-12 | 4.4 | response-recommendation 单独风险等级预警可形成正式建议、混合触发逐条校验且不部分通过；web 人工采纳与预测偏差校准 Scenario | demo/test/browser/assessment-warning-response.spec.ts 的现有 helper/闭环场景；server.mjs.startDemoBrowserServer；deploymentPolicies.mjs.makeDemoAssessmentConfigurationDocuments | 单独等级场景使用独立版本化配置，混合场景保存四类真实触发；HTTP→C27 三项→正式建议→人工采纳→真实 forecastRun→执行/反馈→偏差/校准；与原 4.2 证据一起收口 | 不代写正式建议，不提高默认风险接受阈值避错，不改变生产阈值与图路由，不 skip 关键路径 |

## 4. 调用与副作用顺序

1. IP-01/02 基线补正→IP-05 的 2.9/2.10/2.11→IP-03/05 的所属读取→已批准修复 fix-assessment-entry-read-seam→IP-04→IP-06/07→IP-08 补正→IP-09→IP-10/11→IP-12（所属测试随各 IP 完成，最终装配与浏览器证据在 4.1～4.3 收口）；契约与拥有方实现之前不接假 UI。IP-ID 保持稳定，候选接缝修复通过不替代原 IP-04 完整验收。
2. 读：真实会话/路径工程签发 read 分支 → owning adapter 当前复验 → SQL 范围/limit → 本模块 Schema 解析 → 精确下游用途授权 → 所属端口读 → DTO/边界复验 → 安全 HTTP 结果。下游失败不转 absent，不从缓存或最新版本替代。
3. UI 写：页面精确读及 actions → 用户输入/Schema 形状检查 → 冻结完整信封和确认摘要 → 确认 → C09 当前权限 → 原领域用例 → 事实/回执/审计/Outbox → 精确结果引用回读。取消/工程变化/版本变化废弃确认；响应丢失仅重放原请求。
4. C41 采纳创建真实等待运行后再提交人工决定，只有决定成立才允许恢复；执行/反馈是独立人类操作。拒绝不启动预测。
5. C29 治理单入口分支复验 → C07 专用证明/C16 提交用途授权 → 精确建议/决定与基准核对 → 原用例收口或未发布修订 → 尾事务。失败沿 D-08 原子或可恢复边界，C16 成功+C29 失败不重复修订。
6. C30：公开 startRunPort 解析/入口检查与当前授权复验 → workflowEntryIdentityFor（重评含 reassessmentEntry）→ D-12 的 workflow.start-run 短绑定事务，原键/完整载荷与workflowRunRef回执 → 事务外调用原父 start → preparing run-state 工件及登记事务 → 唯一子运行/A0登记 → A2唯一原因映射。绑定失败不调用图；绑定成功但尚无运行登记时原键重试继续启动，不能仅凭绑定回执报告业务成功。resume/cancel保留其原动作键，恢复从已登记state读取元数据。
7. IP-13 在 4.2/4.4 正式采纳与校准验收前完成：按当前 C06 授权读取精确 task/warning/record/input/preparation → C19 原集合成员与 C04 正文/来源复验 → core 分类型解析，风险等级分支核对阈值/矩阵/适用性/已保存等级并形成 riskAcceptanceBasis → 原候选集登记 → 原 Agent 组合排序与候选登记 → validate-and-record 读取已冻结候选，逐条校验对应措施及目标 → 三项全过才沿原事务入库，否则保存失败快照并走 C07。匹配旧冻结集不补写新字段；新版本依据只能通过合法新冻结集表达。技术或权限失败先按原 reader 错误关闭，不拿成功基线代替。

## 5. Schema、状态与持久化落实

- 公共 payload/结果/域枚举以 contracts 为 SSOT，core 完整配置/算法 Schema 保持原所有权，只读摘要不成为写 DTO。
- 窄所属 read 接口均取公共查询/结果的 Extract 类型，统一单一 branch verify。C11 输入与 C30 run 的内部接口仍声明明确 payload/结果，不接受通用 SQL、field path 或文件。
- 所属表：C11 工程/空间/适用性/外部事件；C33 standardized_risk_records；C25 preparation/input/actual_values/decision_artifacts/risk_assessment_records；C26 warning/task/notification/acknowledgement；C27 recommendation；C28 forecast/execution/feedback/deviation；C29 suggestion/deviation/lineage/draft；C41 human_response_decisions。聚合器不直接访问其它域。
- 新读 DTO 无持久化，不创建业务事实。已有 artifact digest 复验沿原模块要求，不额外添加字符串/哈希门禁。任务与工作流状态沿既有枚举。
- 读取范围/分页及统计按 D-10；C33 既有 offset 游标保留，SQL 先 where 所有可查询筛选再 limit+offset；新 C34 自有目录 keyset。非法保存 payload 返回完整性失败，不跳过后冒充完整页。
- 原子与幂等沿 D-07/08/12，业务副作用必须有真实回执/审计；不添加迁移或异步审计队列。
- D-12 的 WorkflowReassessmentInputV1Schema 位于 contracts ports；core WorkflowGraphRunStateV1Schema 增可选 reassessmentEntry，Worker 上下文直接引用派生类型。runStateBody/cursorBody 保留不可变值；父 entrySnapshotsFor 与子 stageA0 的登记引用同批 run-state 工件。readAssessmentEntriesForRecords 只按精确关联批量读取，不将 listRunRows 全量扫描搬入 C34 目录。
- workflowEntryIdentityFor 的同一可选输入用于公开父入口与子 runtime 的 entryIdentityConsistent；删除 startRunPort 自行拼同义摘要的路径。原非重评身份保持不变。startRunPort 的短绑定事务使用原 commandId/idempotencyKey，绑定审计与实际运行事务分开；图调用不在handler内。重放先验回执再回读/启动，不从阶段receipt推断公共键幂等。
- core service 导出 assessmentReasonForWorkflowReassessmentV1；Worker 的 reassessmentReasonV1 删除，A2 从已保存 reason 映射。workflow/read 共享原因 Schema，C25 仅边界码转换，不改变评分算法。
- evaluateWorkflowEntryGate 两监测字段均缺席按无监测输入通过；显式空/冲突继续拒绝。扩展现有 service.test.ts 的边界用例，不新建测试框架。
- 日志与错误沿 API 已有安全信封；数据层额外只记录请求/操作/耗时/数量。模型正文、来源正文不进页面或错误。
- D-13 的 riskAcceptanceBasis 只属于 RecommendationFrozenWarningV1Schema，字段/边界以 design 为准；快照摘要和 artifact refs 沿既有候选 payload 保存，不增加关系表或第二套可变配置。validate-and-record 读取该候选而不重新读取当前发布补值；旧等级候选缺依据保持可读且校验失败。诊断复用既有 evidence Schema/ContractReference 类型，失败待复核及正式建议事务/回执/审计保持原语义。

## 6. 验收证据矩阵

表中列出每个 delta Requirement 的所有 Scenario，名称与规格一致；不使用“全部覆盖”替代逐项证据。命令指定的新增测试文件由相应 IP 创建后运行，不能跳过或改用不存在命令。

| Requirement / Scenario | IP-ID | 测试文件 / Fixture | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- |
| 评估启动候选必须从所属登记事实有界读取 / 已登记候选可分别续页；撤权错配或游标越界失败闭合 | IP-01/03/12 | C11 context-source fixture/test；contracts c34 read test | 两目录独立游标、精确修订、50/51边界、撤来源权、错目录游标、无预览写入 | `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/adapters/test/engineering-data/context-source` |
| C34 评估只读端口必须解释精确版本并提供有界候选 / 预览策略可原样启动 | IP-01/04/09/12 | contracts c34 read test、C25 existing tests、browser spec | runPolicy 两ref与 start-run 同形；所有成功read含actorId/actions，包括resolve | `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/adapters/test/risk-assessment`；browser同下 |
| C34 重评入口事实必须原样保存并可恢复 / 重评原因和变化引用经过恢复仍一致 | IP-01/05/12 | core workflow service.test.ts；Worker risk-flow/assessment runtime.test.ts；workflow adapter test；browser spec | 五种原因逐项映射；weight-strategy→weight-or-strategy；risk-matrix保持；变化集合与全部冻结refs区分；恢复新runtime仍取原元数据 | `pnpm exec vitest run packages/core/test/workflow/service.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts packages/adapters/test/workflow` |
| C34 重评入口事实必须原样保存并可恢复 / 原因或前驱变化不会复用旧入口 | IP-01/05/12 | 同上；Worker composition tests | 不同前驱/原因/变化子集区分身份；同键异载荷无第二运行；绑定后启动前中断、响应丢失或登记失败沿原身份恢复；绑定/登记审计各一次；已有运行不绕过键判异 | 同上 + `pnpm exec vitest run apps/worker/test/risk-flow/composition.test.ts apps/worker/test/assessment/composition.test.ts` |
| C34 重评入口事实必须原样保存并可恢复 / 缺失历史重评事实时失败闭合 | IP-04/05/12 | C25/workflow existing tests、旧工件fixture | 旧工件仍可解析；解释缺失BUSINESS_BLOCKED；父子错配/跨工程/不可读同形失败；不从checkpoint/引用数量补齐 | `pnpm exec vitest run packages/adapters/test/risk-assessment packages/adapters/test/workflow` |
| C34 重评入口事实必须原样保存并可恢复 / 不使用监测输入时仍可冻结入口 | IP-05/12 | core workflow service.test.ts；Worker existing runtime tests | assess/reassess/historical-backfill缺席通过；空集合/冲突拒绝，分段入口原必需输入不变 | `pnpm exec vitest run packages/core/test/workflow/service.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts` |
| C34 态势摘要与 C31 历史投影必须保持独立口径 / 当前摘要与历史引用同时可读；独立来源失败不冒充完整态势 | IP-04/06/09/10/12 | 新 browser spec 与原 workflow projection tests | 原 queryResultRef/时点不变、单页≤50、用户续页、摘要各自asOf、一个来源失败不替代 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts` |
| C34 评估只读端口必须解释精确版本并提供有界候选 / 有界目录与精确解释；版本权限或解释不完整 | IP-01/03/04/05 | `packages/contracts/test/c34-assessment-response-read.test.ts`；C11/C25/C33/workflow 现有 tests 与版本化 fixtures | 50/51 边界、SQL 返回行有界、作用域游标、跨工程同形失败、精确版本/缺失工件、真实规则/轴/落点一致 | `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/adapters/test/engineering-data/context-source packages/adapters/test/risk-assessment packages/adapters/test/identification packages/adapters/test/workflow` |
| C34 预警处置只读端口必须组合所属事实 / 所属事实经公开接缝组合；非法读取不泄露存在性 | IP-01/06/07 | C26/C27/C28/C29/C41 各 existing adapter tests | 正式结果/关联分页、confirm≠close、declined无预测、无预测/未越限、缺失引用/撤权、不泄露 notification recipients | `pnpm exec vitest run packages/adapters/test/warning packages/adapters/test/recommendation packages/adapters/test/response-lifecycle packages/adapters/test/calibration packages/adapters/test/human-decision-feedback` |
| 校准公开治理入口必须使用单分支授权和精确决定 / 单能力上下文下形成未发布草案；拒绝退回与错误决定分离；下游撤权或尾事务失败 | IP-01/02/07/08 | calibration fixture/test 使用真实 C06、C07、C16；至少真实 Cookie HTTP 案例 | 四分支准确签发、错 outcome 被拒绝、尾事务同身份恢复、单草案、撤治理权无副作用、approved只draft | `pnpm exec vitest run packages/adapters/test/calibration apps/api/test/http-shell.test.ts` |
| 校准公开治理入口必须使用单分支授权和精确决定 / 收口成功不能返回草案批准；C34 校准治理命令必须复用唯一命令路由目录 / 两条治理分支分别校验成功结果 | IP-01/07/08/12 | contracts c34 read test、http-shell.test.ts | 收口成功仅rejected/returned；两条路由拒绝对方成功形状；公共包装不放宽内部结果 | `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts apps/api/test/http-shell.test.ts` |
| C34 只读分支必须进入唯一 HTTP 路由目录 / 注入与未注入保持一致；契约越界或无权 | IP-01/02/08 | contracts c34 + http-shell + access tests | runtime/OpenAPI 一致、unwired404、400 strict、跨工程404、读不调写 | `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/core/test/access.test.ts apps/api/test/http-shell.test.ts` |
| C34 校准治理命令必须复用唯一命令路由目录 / 目录与单分支签发一致 | IP-01/07/08 | http-shell + calibration 实际接缝 | 自身 branch 签发、未注入不激活，不以 create-suggestion代签 | 同上 + `pnpm exec vitest run packages/adapters/test/calibration` |
| C34 页面必须复用 v2 设计并只展示真实事实 / 真实数据与页面可达；工程切换与失败 | IP-09/10/11/12 | `demo/test/browser/assessment-warning-response.spec.ts`，真实登录/工程 A/B | 17 页可达、精确 refs、七态、迟到响应不能污染工程/路由、无fixture审阅控制 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts` |
| 评估候选与启动向导必须提交有限工作流 / 确认后启动初评或重评；缺失前置或响应丢失 | IP-03/04/05/09/10/12 | 同 browser spec，C30真实 riskFlow runtime+PostgresSaver；C25 deterministic fixtures | 两类入口、风险 XOR、前驱/原因/变化引用、无输入/策略不得启动、response丢失重放同运行 | 同上 |
| 运行与重评历史必须保持已成立事实 / 运行等待或失败仍可追溯 | IP-05/09/10/12 | 同 browser spec + workflow test，completed/waiting/retryable运行 | 已入库refs仍可达、终态停止刷新、5秒单轮询、前驱不变 | 同上 + `pnpm exec vitest run packages/adapters/test/workflow` |
| 运行与重评历史必须保持已成立事实 / 重评历史保留显式入口事实 | IP-05/09/10/12 | 同 browser spec，真实重评/恢复与缺元数据历史样本 | 页面原因/前驱/变化ref与已保存入口一致；缺失解释显示失败，不展示默认原因或假空集合 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts` |
| 评估记录与矩阵必须解释冻结评分依据 / 历史记录按原矩阵解释；缺失解释不补造 | IP-04/09/10/12 | 同 browser spec，旧新矩阵/非5×5/两个axis策略 | 冻结band/贡献/等级一致、分版本绘图、无权/缺artifact失败、空网格，historical-backfill记录可读 | browser 同上 + `pnpm exec vitest run packages/adapters/test/risk-assessment` |
| 预警与任务必须区分确认和闭环 / 确认只形成确认事实；触发与通知忠实于冻结事实 | IP-06/09/11/12 | 同 browser spec + warning existing test；intent-only/delivered、multi-trigger | 单值trigger、旧阈值解释、站内通知、确认幂等且task仍open，无假六步状态 | browser 同上 + `pnpm exec vitest run packages/adapters/test/warning` |
| 正式建议必须经过人工采纳或拒绝 / 采纳与拒绝分离；候选失败或目标陈旧 | IP-06/09/11/12 | 同 browser spec + C41 existing tests | adopted有真实forecastRun、declined无forecast/执行、无正式候选不得采纳、陈旧失败 | browser 同上 + `pnpm exec vitest run packages/adapters/test/human-decision-feedback` |
| 执行与反馈表单必须登记人工事实 / 两种来源登记与正式反馈；实际评估或证据缺失 | IP-06/09/11/12 | 同 browser spec + C28/C41 tests；真实措施/证据/反馈工件 | 两来源、当前actor、独立行动无建议、正式反馈引用、缺失输入不部分写入 | browser 同上 + `pnpm exec vitest run packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback` |
| 预测偏差与校准必须按真实结果只读解释 / 无预测或未越限；校准批准只生成草案 | IP-06/07/09/11/12 | 同 browser spec + C28/C29 tests | 不造zero/校准占位、保存decimal偏差、操作/validation/Agent refs、批准/draft≠publish | browser 同上 + `pnpm exec vitest run packages/adapters/test/response-lifecycle packages/adapters/test/calibration` |
| 所有写入必须确认并保持授权幂等 / 取消无副作用且重试幂等；权限撤销与证据脱敏 | IP-02/07/09/12 | 同 browser spec，confirmation/commit hooks、真实Cookie | cancel=0请求、重试原信封、同键异载荷冲突、撤权失败、键盘焦点、定位两态且无正文 | browser 同上 |
| C34 必须以真实浏览器验收业务接缝 / 真实闭环与失败边界验收 | IP-12 | 同 browser spec/harness，真实PostgreSQL与生产demo build | 公共HTTP→真实领域→持久回读；缺服务非零；版本化合成样本与trace | `pnpm --dir demo build` 后 browser 同上 |
| 风险态势必须按有界所属摘要呈现 / 摘要失败与范围切换；原投影引用按页追溯 | IP-04/06/09/10/12 | 同 browser spec，空间A/B和单摘要故障 | 统计口径/asOf与授权相符，原投影精确版本/下一页不变，单源失败独立显示，不全量翻页/假趋势/导出 | browser 同上 |
| 三项处置约束由确定性模块逐项校验 / 三项均通过 | IP-13 | core recommendation.test.ts；adapter postgres-recommendation-adapter.test.ts/fixture.ts | 等级或监测分支均有依据；三项独立 true，正式建议非空且 pending；原命令重放只有一条建议/校验/成功审计 | `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 三项处置约束由确定性模块逐项校验 / 任一项失败或依据缺失 | IP-13 | 同上，复用已有规范/资源/工序失败参数化用例 | 任一 false 保留诊断、waiting-review 且正式建议为零；不能人工强制入库；已有审计写入回滚/原键重试仍成立 | 同上 |
| 三项处置约束由确定性模块逐项校验 / 单独风险等级预警可形成正式建议 | IP-13/IP-12 | core/adapter recommendation tests/fixture；browser spec 独立配置集 | 只有等级预警，无监测映射也可通过；有效措施目标只是评分指标子集仍通过；阈值 ID 不冒充目标，三项证据与精确配置 refs 可重建；浏览器采纳成立真实 forecastRun | 上述 vitest 命令；`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts` |
| 三项处置约束由确定性模块逐项校验 / 混合触发逐条校验且不部分通过 | IP-13/IP-12 | 同上，四类混合触发及现有 missing-mapping/uncovered-target 变体 | 四类实际预警均存在且按类型验证；同名阈值/规则身份不跨类型解析；全部通过才入库，任一监测缺失/歧义/未覆盖仍失败；浏览器从正式建议到执行/反馈/偏差/校准保存完整精确链 | 同上 |
| 三项处置约束由确定性模块逐项校验 / 风险等级依据或对应措施不足时失败 | IP-13 | core/adapter recommendation tests/fixture，参数化边界 | 缺失/多个适用阈值、triggerType/actualValue错配、错误矩阵/评估/配置集合、未知等级、等于或低于接受上限、无对应已选措施、目标不在评估或缺审核值；业务校验失败待复核无正式建议，权限/损坏正文沿reader失败；诊断有精确预警/评估引用 | 上述 vitest 命令；`pnpm exec vitest run packages/adapters/test/warning packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback` |
| 三项处置约束由确定性模块逐项校验 / 冻结依据不随发布变化且历史缺失不补造 | IP-13 | core/adapter recommendation tests/fixture，旧冻结集及后续配置发布 | 原候选按原版本得到同一结果；旧等级候选缺 riskAcceptanceBasis 不补造、不通过、不覆盖；旧监测候选仍可校验；当前撤权不重放成功，同键异载荷拒绝 | 上述 vitest 命令 |

IP-12 同时回归既有 `demo/test/browser/read-only.spec.ts` 与 `identification-review.spec.ts`，命令 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`。harness 的写 command 必须调用真实 C25/26/28/29/30/41，读取真实工件/登记，不能只在 SQL 中播种“已写成功”来替代命令执行；只读历史/失败夹具允许按已有测试模式播种并通过所属 Schema 解析。Agent 可以使用冻结且已确定性收口的合成结果，不接真实随机模型推理作为硬期望。

IP-13 测试优先扩展上述现有用例，不新建测试框架或文本静态门禁。adapter/浏览器关键路径必须实际连接真实 PostgreSQL、C06 与生产工厂；关键 skip 不算通过。单独等级场景复用 `makeDemoAssessmentConfigurationDocuments` 的类型化合成配置正文，在发布前按已有 fixture 模式选择监测不越限的独立版本，走真实提交/审核/发布；默认混合场景保留风险接受阈值及四类触发。复用 `postBranch`、`startRealAssessmentAndReadWarnings`、`postResultRead` 和现有采纳校准场景，保存 task/每类 warning/assessment/recommendation/validation/forecastRun/execution/feedback/deviation/calibration 精确引用。共享 harness 或合成配置改动需回归 read-only/identification-review，不能把源码中有场景当作通过证据。

性能记录附于最终 verification：新目录 50项+额外大量不可见行、32×32矩阵/50落点，测量 SQL返回行数、解释工件读取次数、耗时、可见DOM规模；确认无全库读取和随总库大小增加的UI工作量。不新增静态工件文本测试或性能框架。

最终检查：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm --dir demo build`、`openspec validate deliver-assessment-warning-and-response-ui --strict --no-interactive`。修改TS/CSS后对改动文件运行既有格式工具，禁止临时安装；基线已有格式失败也在其获准文件内收口。内存不足时以 `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` 执行同一检查，记录实际命令；不修改 package scripts 或锁文件。

## 7. 文件清单与升级条件

以下为允许改动的精确清单。现有文件 M、新建 N；index 的改动仅导出所属新增读方法/类型/工厂。新增页面共享一份 `assessment-response.css`，不机械新增每页 CSS。

| IP-ID | 类型 | 文件 |
| --- | --- | --- |
| IP-01 | M | `packages/contracts/src/ports/index.ts`、`packages/contracts/src/vocabulary/index.ts`、`packages/core/src/warning/schema.ts`、`packages/core/src/calibration/schema.ts`、`packages/core/src/calibration/service.ts`、`packages/core/src/assessment-config/schema.ts` |
| IP-04 | M | `packages/core/src/scoring-rules/schema.ts`（4.1 真实装配暴露：适用规则集的 `includedMembers` 唯一性被按**释放**判定，而一次评分规则发布承载的是一份累积规则集，同一释放下的多条入选规则因此被判非法；唯一键改为规则身份，释放级去重下移到依据集合投影）、`packages/core/src/scoring-rules/validation.ts`（同因：D-06 要求依据成员装的是规则释放，同一释放下的多条入选规则在依据投影时合并为一个成员，合并要求 `revisionRef`/`artifactRef`/`contentDigest` 逐字一致，冲突整体失败而不保留第一项）、`packages/core/test/scoring-rules/scoring-rules.test.ts`（补该合并规则的回归：同一释放下两条不同规则合并为一个依据成员，摘要不一致时整体失败） |
| IP-02 | M | `packages/core/src/access/policy.ts`、`packages/core/test/access.test.ts` |
| IP-03 | M | `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`、`packages/adapters/src/engineering-data/context-source/index.ts`、`packages/adapters/src/identification/read/postgres-risk-identification-read.ts` |
| IP-04 | M | `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`、`packages/adapters/src/risk-assessment/engine/index.ts` |
| IP-05 | M | `packages/adapters/src/workflow/postgres-workflow-adapter.ts`、`packages/adapters/src/workflow/index.ts` |
| IP-05 | M | `packages/core/src/workflow/schema.ts`、`packages/core/src/workflow/service.ts`、`apps/worker/src/risk-flow/graph.ts`、`apps/worker/src/risk-flow/runtime.ts`、`apps/worker/src/assessment/graph.ts`、`apps/worker/src/assessment/runtime.ts` |
| IP-06 | M | `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`（4.1 真实装配暴露：`read()` switch 缺 `feedback-read` 分支，公共读契约已声明该操作却落到 `default` 抛 `owning-read-seam-not-injected`；按 D-05/D-06 所有权分层补齐——C28 反馈事实与私有偏差解释、C29 公共偏差记录与校准引用，以 C28 交出的私有偏差事实为唯一锚点；关系页失败原因码按发起操作命名）、`packages/adapters/src/warning/index.ts`、`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts`、`packages/adapters/src/recommendation/index.ts`、`packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts`（4.1 真实装配暴露：`readFeedbackView` 只投影私有偏差正文、不交出其精确版本锚点，组合方无从向 C29 换公共偏差记录与校准引用）、`packages/adapters/src/response-lifecycle/index.ts`、`packages/adapters/src/human-decision-feedback/postgres-human-decision-feedback-adapter.ts`、`packages/adapters/src/human-decision-feedback/index.ts` |
| IP-07 | M | `packages/adapters/src/calibration/postgres-calibration-adapter.ts`、`packages/adapters/src/calibration/index.ts` |
| IP-08 | M | `apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts` |
| IP-09 | M | `demo/src/api/client.ts`、`demo/src/api/context.ts`、`demo/src/api/operations.ts`、`demo/src/components/ConfirmButton.tsx`、`demo/src/components/ConfirmButton.css`、`demo/src/components/PageStateView.tsx` |
| IP-10 | M | `demo/src/App.tsx`、`demo/src/components/AppShell.tsx`、`demo/src/pages/RiskOverviewPage.tsx`、`demo/src/pages/PendingAssessmentPage.tsx`、`demo/src/pages/AssessmentRecordsPage.tsx`、`demo/src/pages/AssessmentRecordPage.tsx`、`demo/src/pages/RiskMatrixPage.tsx`、`demo/src/pages/EvidenceTracePage.tsx` |
| IP-10 | N | `demo/src/pages/StartAssessmentPage.tsx`、`demo/src/pages/AssessmentRunPage.tsx`、`demo/src/pages/AssessmentMatrixPage.tsx`、`demo/src/pages/ReassessmentsPage.tsx`、`demo/src/pages/assessmentResponseShared.tsx`、`demo/src/pages/assessment-response.css`、`demo/src/charts/RiskMatrixChart.tsx`、`demo/src/charts/ChartSurface.tsx`、`demo/src/charts/types.ts` |
| IP-11 | M | `demo/src/pages/WarningCenterPage.tsx`、`demo/src/pages/WarningDetailPage.tsx`、`demo/src/pages/ResponseTasksPage.tsx` |
| IP-11 | N | `demo/src/pages/WarningTaskPage.tsx`、`demo/src/pages/RecommendationDetailPage.tsx`、`demo/src/pages/ExecutionRegisterPage.tsx`、`demo/src/pages/PredictionDetailPage.tsx`、`demo/src/pages/FeedbackDetailPage.tsx`、`demo/src/pages/CalibrationDetailPage.tsx` |
| IP-12 | N | `packages/contracts/test/c34-assessment-response-read.test.ts`、`demo/test/browser/assessment-warning-response.spec.ts` |
| IP-05/IP-12 | M | `packages/core/test/workflow/service.test.ts`、`apps/worker/test/risk-flow/runtime.test.ts`、`apps/worker/test/risk-flow/composition.test.ts`、`apps/worker/test/assessment/runtime.test.ts`、`apps/worker/test/assessment/composition.test.ts` |
| IP-12 | M | `packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/engineering-data/context-source/fixture.ts`、`packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`、`packages/adapters/test/risk-assessment/fixture.ts`、`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`、`packages/adapters/test/identification/postgres-risk-identification-read.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/test/warning/fixture.ts`、`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`、`packages/adapters/test/recommendation/fixture.ts`、`packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`、`packages/adapters/test/response-lifecycle/fixture.ts`、`packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`、`packages/adapters/test/human-decision-feedback/fixture.ts`、`packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts`、`packages/adapters/test/calibration/fixture.ts`、`packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`、`demo/test/browser/server.mjs`、`demo/test/browser/read-only.spec.ts`、`demo/test/browser/identification-review.spec.ts` |
| IP-12 | M | `packages/core/src/human-decision-feedback/service.ts`（4.1 真实装配暴露：C41 三处 hand-off 二次签发与 C06 同调用身份幂等冲突，改交命令自身已复验的上下文；`workflow.resume-run` 签发身份必须等于 C30 运行时实际使用的 `<commandId>:resume`；反馈分段签发身份必须等于 C30 实际调用的 `<commandId>:feedback-segment`；分段入口冻结的效果预测取自 C28 记录反馈时解析出的真实预测并随冻结行落库） |
| IP-12 | M | `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-read.ts`、`packages/adapters/test/knowledge-governance/postgres-knowledge-governance-read.test.ts`、`demo/test/browser/deploymentPolicies.mjs` |
| IP-13 | M | `packages/core/src/recommendation/service.ts`、`packages/core/src/recommendation/schema.ts`、`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts`、`packages/core/test/recommendation/recommendation.test.ts`、`packages/adapters/test/recommendation/fixture.ts`、`packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| IP-13/IP-12 | M | `demo/test/browser/server.mjs`、`demo/test/browser/deploymentPolicies.mjs`、`demo/test/browser/assessment-warning-response.spec.ts` |

静态内容：不删除仍被 C35 页面使用的 `demo/src/content/assessment.ts/response.ts/risks.ts` 等共享原件；IP-10/11 清除 C34 页 import 与假按钮即可。模板中非C34页面、apps/web、研究原件、execution-graph、lockfiles、package manifests、migration目录均受保护。v2 原件只读；不用静态文本门禁检测其 import。

治理读的批准范围只到本次交付必需的路径：`postgres-knowledge-governance-read.ts` 按各定义类型**已有**的用途码常量读取正文（C04 的 `purposeCode` 必须与工件 manifest 一致，单一硬编码用途码会让所有类型关闭失败），并补齐交付页面实际读取的定义类型。保留 C04 全部权限校验与既有 `knowledge-modeling.governance-read` 分支；不新增清单读取入口，不先读 manifest 再照抄其 `purposeCode` 绕过用途约束。C18 11 类正文的完整扩展不属本 change，未覆盖的类型继续按既有语义返回不可用，不在本轮扩表。

升级条件：基线符号不存在或 HEAD 漂移影响计划、上游读契约无法安全表达输入、需新增公共枚举/字段超出 D-03～05/D-12、需新增表/索引/迁移/依赖、授权需扩大、需改变 D-08/D-12 之外的事务/原幂等或页面范围、验证命令不可用。D-12 已批准的入口元数据、identity摘要、原因映射和登记恢复属于IP-05范围；普通范围内失败、参数/fixture调整与已定设计的跨文件修复由当前任务自修。

D-13 已批准的分类型触发语义、完整 TriggerIndicator 参数、riskAcceptanceBasis 私有 payload 字段、诊断与上述 IP-13 文件属于范围内实现，不再以这项语义缺口重复升级。权限、公共记录/命令、事务/幂等协议、评分/预测、已发布配置和旧不可变工件仍受保护；若需要改变这些边界或改动本清单外文件，先升级。不得以清空 unresolvedTriggerItems、删除等级预警、抬高默认风险接受阈值、全评分指标覆盖门禁或成功 stub 代替 D-13。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在上述文件与 D-ID/IP-ID 批准范围内核验、修复、回归；禁止以收尾修改需求/持久化/权限/新依赖。最终 HEAD 上按全部矩阵逐项记录 PASS/FAIL/BLOCKED，并填 verification；未运行关键路径不能 PASS。

风险标签 permission、transaction、critical-state-machine：一次 Targeted Auditor 聚焦四新分支的真实 C06绑定/下游收窄、C29证明/基准/尾事务、C41等待采纳/互斥决定、D-12重评入口身份/原键重试/登记失败恢复、精确历史读取与不可枚举失败。Auditor在自己的活动任务内修复普通缺陷并回归同一证据，不为同一收尾再次派 Finalizer 或第二次审计。未批准公共语义变化升级给用户。
