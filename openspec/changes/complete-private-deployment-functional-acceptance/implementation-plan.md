# Implementation Plan

当前接续：先实施 [reduce-defensive-design-overhead](../reduce-defensive-design-overhead/implementation-plan.md)，再继续本施工图的真实功能验收。原IP-17～IP-22继续追踪成果和实机证据；逐操作授权、完整授权摘要、检查点正文证明及确定性组合再次审核的历史补充按新设计和整理后的活动 delta 执行。本清单不预勾选剩余任务。

## 1. 实施基线与权威来源

固定规划 base commit：`b6e39eb41e9cc8b0c9840f6f58057155eb37de54`。前置 `deliver-offline-private-deployment-and-operations` 的 IP-01–IP-16 已有工作区实现，尚未全部提交；handoff.md 登记来源与实时状态。apply-ready 表示设计和施工图闭合，不表示已形成角色交接检查点。实施前审阅前置 dirty paths 并按授权形成实际检查点，若语义漂移回到 design 处理。

权威输入：本 change proposal、两个 delta、design D-25–D-30、tasks、handoff；前置 D-20–D-24/施工图/verification、相关已归档规格；MinerU V2 的真实合格样例与独立报告。模块 DTO、权限和事务沿既有事实源，不重新解释研究原文。

IP-17–IP-22 不与前置 IP 混淆。顺序为 IP-17 → IP-18/IP-19 → IP-20 → IP-21 → IP-22。C38 F-01–F-05 为阶段移交，非当前功能 task；其场景也映射到具体移交和原 IP，未执行不计通过。

## D-50：已选标注复核路线（IP-19）

用户同意先复核标注和条款依据。设计事实源为design D-50及`evidence/retrieval-acceptance-target-decision.md`。复用C06当前人类授权、C17 `readExact`、C04完整读取和`DeploymentRetrievalDatasetV1Schema`；不修改这些生产符号或新增依赖。实例`retrieval-relevance-review-v53/`保存冻结语料/正式绑定、预先定义的rubric和查询、主Agent独立初稿、未提供排名/旧标签的辅助复核、分歧裁定及候选自检。

文件范围限当前change的proposal/design/implementation-plan/handoff、上述决定稿、新增`evidence/retrieval-relevance-review-2026-10-15.md`、`evidence/retrieval-dataset-v13-candidate.json`、`evidence/retrieval-relevance-review-v13.json`及实例新增工件。旧6个queryText不变；逐查询复核所有15成员，以证据说明每个正标签和0分项，补4个独立规范查询。用户现已确认v13具体候选用于正式门禁；沿原正式C17审核/独立发布流程产生同成员新组合，冻结新配置/策略及重绑组合引用的数据集，深比较query/grade、成员和原门槛/模型/预算不变后才启动Worker。保留旧输入/失败/发布，不改历史事件或授权期限。候选完成不等于3.1或其它未满足任务通过。

验证采用现有Schema解析、正式成员引用/证据存在性、10×15覆盖、理由及字段定位、正标签唯一、旧查询文本/旧文件保持、无悬而未决候选项、预期标签不进入模型输入的自检；不能用Schema通过代替语义正确或正式质量PASS。文档format、OpenSpec strict和diff检查通过。该阶段不改源码，不重复全仓构建或测试。

## 2. 复用与接缝

D-96纳入IP-19/IP-21，沿D-95四文件：runner内部模型步可选outputSchema交给原网关且保留registry复验，C15用冻结资料/快照精确引用收紧原动作Schema。测试验证真实资料引用通过、清单工件/其它来源/错版本/越界offset/未登记工具与无快照动作拒绝，以及runner使用收紧Schema而不跳过原解析。同步design/清洗delta/进度证据/handoff，实例清洗策略显式绑定同模型的function-call部署并升精确引用，数值预算/工具/质量不变。工程回归通过后先一次原冻结首步诊断止于工具/领域写入前，再正式新任务；旧v101失败保持。

D-95纳入IP-19/IP-21：Worker agent-runtime/runner.ts的内部模型步上下文和已完成工具事实重建，engineering-data/cleaning/runtime.ts的有界completedReads投影；仅扩对应既有两份runtime/runner测试。同步design、当前清洗与Agent局部delta、handoff及新增evidence/cleaning-read-progress-2026-10-16.md；实例新清洗policy/prompt/budget精确引用数值不变。先证明两个读取事实保留和恢复不重执行，再验证三来源精确分页/段/样本边界、未知/超限拒绝及原预算计量，运行两套/关联回归、build/typecheck/lint/format/deps/strict/diff。旧失败不恢复，原来源新任务另记正式证据，不新增依赖/HTTP/迁移或第二记忆。

D-94纳入IP-17/IP-19：源码仅provision.mjs的监测两步骤授权分支选择和provision.test.mjs既有参数化成功用例的所属分支断言。同步design/handoff及监测证据。先红后绿，运行provision全套、两文件lint/format及strict/diff；不改store、C06、公共字段或预算。旧AUTHORIZATION_DENIED预置回执保留，后续新runId/报告重试尚未写入的事实。

D-93纳入IP-17/IP-19输入配置范围：仅当前design/proposal/handoff、evidence/monitoring-longitudinal-2026-10-16.md和实例新策略目录/部署/发布/制品/清洗脚本与回执。新清洗版本补三份原生CSV实际质量引用、requiredSegmentKinds=table，保护类型和三个100%门槛、工具/模型/预算不变，精确差异按design。复用现有DataCleaningPolicyV1Schema及清洗纯函数/已有测试，原五资料快照不重复清洗。核对真实转换和段、Schema/确定性自检/strict/diff、同制品比较后以新命令发起新CSV任务；旧422保留。不改源码、主规格或用户资料。

D-92纳入IP-17/IP-19/IP-21实例配置范围：同步design/proposal/handoff、evidence/minimax-function-call-2026-10-16.md及新增evidence/confidence-policy-2026-10-16.md。实例新增置信度缺项策略及精确关联策略版本、目录/部署/发布/制品，正文差异限design D-92；复用原核心calculateCompositeConfidence/forcedReviewReasonFor与当前授权的C04读取，不改源码或主规格。先只读原v97全部分组/校验集并证明新策略可计算、未参与依据不伪造、强制人工复核保持；旧策略同输入仍应阻断。既有Schema自检、相关核心置信度回归、strict/diff、制品身份比较后切换正常生产宿主。独立新批次正式继续，旧终态/预算不重写，不自动连续重开运行。

D-91纳入IP-17/IP-19/IP-21输入范围：同步当前design、proposal、handoff及evidence/monitoring-input-correction-plan.md，新增evidence/monitoring-longitudinal-2026-10-16.md；实例d91-monitoring-inputs/保存新合成情景的baseline.csv（15点）、supplement.csv（缺失第7点）、correction.csv（第15点7.0到6.8）、生成清单及独立源配置/正式回执。具体时间、规则、策略数值以design D-91为唯一事实源。复用现有CSV转换/C15、provision及公开监测批次/快照入口，不修改源码或原资料包。自检唯一时间、15+1成员、更正范围及现有strict Schema；沿正式来源/清洗回执再登记序列和策略，验证重复不增事实、旧快照稳定、更正/补录追加和当前权限拒绝。不启动第二驱动，不在当前请求在途时导航或另发控制；未取得正式回执不得勾选任务。文档strict/diff检查即可，不因输入文档变更重复全仓构建。

D-90预检补充：纳入packages/adapters/src/deployment/schema.ts的requiredSecretIds，只对模型部署credentialRef集合去重，保留主体/类别秘密隔离及文件清单唯一/齐全；扩已列config-operations.test.ts验证同服务部署共享模型凭据可通过，DB/HMAC冲突或缺失仍拒绝。v96失败不覆盖、不部署，必要验证后另建v97。

D-90纳入IP-17/IP-19/IP-21：修改packages/adapters/src/model/config.ts显式模式枚举，network-api-model-gateway.ts的结构化请求/响应适配及唯一Schema复验；扩既有packages/adapters/test/model/network-api-model-gateway.test.ts，不改core模型DTO/会话流或领域工具契约。同步design、模型网关delta、deployment/ACCEPTANCE.md、候选失败证据及新增evidence/minimax-function-call-2026-10-16.md。验证单carrier合法结果、缺/多/错名/正文/截断/非法arguments/Schema错误、原模式拒绝与真实计数保留；网关及配置/宿主回归、build/typecheck/lint/format/deps/strict/diff后实例冻结新部署/策略精确引用，预算不变。一次真实诊断先于新业务批次，保留旧终态及失败，不自动反复生成。

D-89纳入IP-17/IP-19：限scripts/deployment/provision.mjs与既有provision.test.mjs，复用core/engineering-data/monitoring已导出的ReviseMonitoringSeriesCommandV1Schema、RegisterMonitoringAvailabilityPolicyCommandV1Schema与foundation.monitoringStore；增加两种受控步骤、精确回执引用投影及既有步骤恢复。同步design、offline-private-deployment-and-operations delta、监测入口证据/handoff；使用原真实工程/空间引用和静态合成包生成实例新配置及正式预置回执。验证参数化序列/策略步骤成功、模板身份/宿主字段、严格命令拒绝/领域拒绝停止、报告恢复不重写；复用已有监测store测试，不新增依赖/迁移/HTTP或权限。源代码可准备，但当前v93模型业务在途时不重建或切换运行制品。

D-88纳入IP-19/IP-21：修改apps/worker/src/identification/graph/graph.ts共享阶段游标读取、节点/错误收口，以既有VERSION_CONFLICT停止已登记终态后的未开始动作。复用runtime.test.ts现有并发取消用例并增加确定性取消先提交分支，验证无终态复活/后续效果。同步design、graph delta、handoff及D-87证据内回归发现说明；必要回归与工程门禁通过后冻结新制品，未部署v92保留不覆盖。无事务、公开Schema、权限或预算变更。

D-87纳入IP-19/IP-21：修改apps/worker/src/identification/graph/runtime.ts的rebuildCommittedState与businessAheadOfCheckpoint，从同运行/同游标版本唯一阶段登记精确恢复已提交增量，避免缺省指针误判；扩既有apps/worker/test/identification/graph/runtime.test.ts中途检查点失败场景，必要夹具限同目录fixture.ts。同步本design、graph delta、handoff及新增evidence/committed-stage-recovery-2026-10-16.md。先红后绿覆盖I5/I6业务已提交恢复、合并不重复、缺失/错配拒绝及正常等待重放，再运行C24恢复/控制/嵌套和父图回归、必要工程检查。保留v90b终态，修后不复活；新正式批次另记实际证据。

D-86纳入IP-19/IP-21：源码为scripts/deployment/composition/identification.mjs的createDeploymentCandidateCheckpointProofV1及packages/core/src/identification/candidate-finalization/service.ts的合并/路由运行绑定；测试为既有scripts/deployment/composition.test.mjs与packages/core/test/identification/candidate-finalization.test.ts。复用冻结inputSnapshot.identificationRunRef、identificationRunRefFor及精确工件引用派生读身份，不改核心Schema/旧数据或权限。新合并与路由使用实际运行，旧v90b合并仅在原C24精确归属证明下读取，新路由补齐实际运行及复核等待。扩候选证明夹具/拒绝表、同调用跨工件重读、核心路由有/无冻结实际运行与正文绑定。同步当前design/implementation-plan/候选delta/handoff与evidence/merge-checkpoint-proof-2026-10-16.md。运行core/composition/entrypoints及C24恢复边界定向回归、必要工程检查；实际v90b原I6引用只读证明通过后新发布公共恢复同一未终态父运行，不重跑已提交模型或重置重试/预算。

D-85纳入IP-17/IP-19/IP-21：源码限packages/adapters/src/model/network-api-model-gateway.ts的embed预算调用及#assertBudget完整请求上限，测试限packages/adapters/test/model/network-api-model-gateway.test.ts的既有Ollama成功及预算拒绝用例。复用inputBytesForTexts/共享预算与token估算，不改C10请求Schema。实例新部署/catalog/release脚本保留旧检索部署，新增合并专用32批条目别名、同权重/维度/16KiB/超时并联动新candidate/graph策略引用，冻结前Schema和模型/预算差异自检。文档同步design/implementation-plan/模型网关delta/handoff及evidence/merge-embedding-budget-2026-10-16.md。运行网关与候选定向回归、build/typecheck/lint/format/deps/strict/diff；独立18条真实文本诊断止于向量写前，记录实际模型原响应/消耗；正式新批次另计。

D-84纳入IP-19/IP-21：源码限apps/worker/src/identification/candidate-finalization/runtime.ts，测试限既有apps/worker/test/identification/candidate-finalization/runtime.test.ts。projectRepairFeedback按失败身份过滤并携既有output，显式数量由同一集合推导并用于Schema精确长度；生成数量仍沿冻结预算。扩原修正用例及边界，不新增公共字段、依赖、策略或预算。文档限当前design/implementation-plan/候选delta/handoff/tasks状态说明与evidence/repair-cardinality-2026-10-16.md。临时驱动补failedWorkItemRefs停止断言；旧v89公共取消，新制品和独立批次前运行所属候选/图/宿主定向回归及工程检查，保留所有旧结果。

D-83纳入IP-19/IP-21：源码限apps/worker/src/identification/candidate-finalization/runtime.ts，测试限既有apps/worker/test/identification/candidate-finalization/runtime.test.ts；生成固定run、嵌入/向量固定finalize，错误映射显式接收同一操作能力。现有嵌入成功用例改用仅finalize授权并执行真实EmbeddingRequestV1Schema；核对向量保存、权限错误及只有run时拒绝。同步本change design/implementation-plan/候选delta/handoff与evidence/i6-embedding-capability-2026-10-16.md。运行候选运行时、核心、组合、父子图及宿主关联回归和build/typecheck/lint/format/deps/strict/diff；原五份候选入口屏障预检通过后新制品/独立批次。不扩大授权、预算、Schema或复活v88。

D-82纳入IP-19/IP-21：仅修改apps/worker/src/identification/candidate-finalization/runtime.ts及其既有apps/worker/test/identification/candidate-finalization/runtime.test.ts。模型上下文投影增加来自本次冻结budget的maxCandidates，调用网关时复用原RiskCandidateModelOutputV1Schema并将数组上限收紧为同一值；固定系统指令、六字段与原预算不变。同步设计、候选delta、handoff和实际预算证据。现有投影用例改断言语义字段，新增参数化数量边界，运行核心/运行时/组合/宿主关联回归和工程门禁后新制品/批次；v87父子终态及前三工作项事实保持，不复活。

D-81纳入IP-19/IP-21：仅修改packages/core/src/identification/candidate-finalization/service.ts的工件序列化、候选工件身份/读取及repairAndValidate初始映射；复用原C04读取、完整性和有界规则，不调整存储契约。扩packages/core/test/identification/candidate-finalization.test.ts原生成→校验用例及seedRow夹具，证明不重复登记且缺失/损坏候选不能通过。同步design、当前候选delta、handoff与批次证据。核心、Worker候选/图/宿主关联回归及build/typecheck/lint/format/deps/strict/diff后新制品实跑，不改旧v86终态。

D-80纳入IP-19/IP-21：仅修改packages/core/src/identification/candidate-finalization/service.ts的buildCandidates/assembleCandidateSet及初生、修正两个调用，删除候选冗余检索引用，复用唯一严格Schema于生产正文构造；扩packages/core/test/identification/candidate-finalization.test.ts既有生成/修正用例核对实际落盘工件。同步当前change设计、候选delta、handoff及批次证据，无新依赖/Schema/迁移。验证核心候选、Worker候选组合、识别父子图、部署候选证明及宿主，build/typecheck/lint/format/deps/strict/diff后冻结v86；保留v85b事实，通过公共取消后新批次，不修补历史工件。

D-79纳入IP-21：仅修改apps/worker/src/risk-flow/graph.ts的toRiskFlowGraphError及apps/worker/test/risk-flow/runtime.test.ts，复用classifyWorkflowGraphFailure，实际C24运行异常只解包一层.error，顶层code优先。扩既有公共父恢复测试，核对权限/检查点错误不可重试、技术错误保持原分类和详情；未知异常保持原处理。同步design、当前domain/module-interfaces-events-workflows delta、handoff及批次证据，无新依赖、公共Schema、迁移或预算。验证父图回归、build/typecheck、lint/format/strict/diff；独立定位I4检查点失败，旧运行历史不覆盖。

D-52已获批准并纳入IP-19/IP-21。复用评估子运行的真实父调用身份模式，在packages/core/src/identification/graph/ports.ts增加必填issuedInvocationId/authorizationBranch，apps/worker/src/risk-flow/graph.ts的identificationStartCommandFor传run.commandId/run.authorizationBranch，apps/worker/src/identification/graph/runtime.ts/start消费并用于复验及运行上下文。子运行稳定身份、业务时刻、输入版本、C03回执及C06权限语义不改。测试范围限worker identification/graph既有fixture/runtime/nested-boundary、risk-flow/runtime和deployment entrypoints；文档范围限当前change proposal/design/implementation-plan/handoff、D-52提案、安全证据及domain/module-interfaces-events-workflows和identification/graph局部delta。验证真实父恢复身份、错身份/分支/主体/工程/撤权零效果、同身份重投与父子检查点，所属回归和8GiB build/typecheck/lint/format/strict/diff通过后实机恢复原父流程。不提交、归档或创建verification，不扩大权限或修改预算。

D-51实施取证补记：先用现有appendEntryFacts提交已核验的精确准备入口快照，使生产checkpointer的恢复控制写可按原父登记事实及C15/C04取证。校验仅接受identify-and-assess父图识别阶段的同主体精确已登记准备，未绑定/错引用/撤权拒绝；所属entrypoints两项先失败后通过，runtime/entrypoints最终161项通过，v57实际越过此边界。C24真实父调用授权字段属于待批准D-52，不纳入D-51实施结果或通过声明。

D-51已获用户批准，作为IP-19/IP-21补充：按[evidence/workflow-identification-preparation-binding-scope-proposal.md](evidence/workflow-identification-preparation-binding-scope-proposal.md)扩展`ResumeCauseV1Schema`，在C30 `resumeRunPort`映射既有inputs-ready并触发当前权限下精确准备核验。复用C15 `readExactPreparation`、C04 verified、C03事务/入口快照及LangGraph恢复；父运行级幂等绑定保留真实新命令审计及原独立清洗因果，原冻结工程修订/完整空间/资料/监测和图版本不替换。运行状态版本及事务内游标检查保持，陈旧/错误等待、异准备竞争、错范围/主体、撤权/缺失/损坏/取消均拒绝。

批准文件：`packages/contracts/src/ports/index.ts`及既有契约测试；`apps/worker/src/risk-flow/runtime.ts`、`composition.ts`，其既有runtime/composition测试及同目录fixture（如需）；`scripts/deployment/composition/risk-flow.mjs`、`start.mjs`及既有risk-flow-composition/entrypoints测试；`apps/api/test/http-shell.test.ts`；当前change proposal/design/implementation-plan/handoff、domain/module-interfaces-events-workflows及platform/http-command-query-sse-shell局部delta和安全证据。无新增生产HTTP路由、依赖、迁移、权限映射或UI。定向contract/HTTP/runtime/组合测试及8GiB build/typecheck、lint/format、全仓strict/diff通过后冻结新制品，物理Chrome正式绑定原五资料准备再继续RI/RA，不以工程结果勾选业务task。

| IP-ID        | 现有文件与符号                                                                                                                                                                                                                                                                               | 复用方式                                                                                                                         | 禁止复制的事实                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| IP-17        | scripts/deployment/start.mjs 的 loadDeploymentFoundationInputV1、initializeDeploymentV1 所在 initialization.ts、createDeploymentScoringGovernanceV1；composition/identification.mjs 的 createDeploymentAcceptanceRoutesV1；composition/risk-flow.mjs 的 createDeploymentRiskSpatialPairingV1 | 正式初始化、配置/权限/来源准备及精确读取；runtime 创建前使用已冻结策略                                                           | 不直接写 SQL、第二来源目录或默认版本                           |
| IP-18        | apps/desktop/test/e2e/client.spec.ts、acceptance.mjs；playwright.desktop.config.ts；apps/desktop/src/main.ts                                                                                                                                                                                 | 扩展测试宿主预检和真实 Electron 场景，复用批准 HTTPS                                                                             | 不复制业务 UI、授权、Cookie 或任务状态                         |
| IP-19        | start.mjs 的 createDeploymentGraphsV1/createDeploymentApiV1/createDeploymentWorkerV1/mainDeploymentV1；provision.mjs 的 runProvisionV1；synthetic.mjs 的 checkPack/runPack                                                                                                                   | 真实业务运行、正式人工确认、五类共享任务与原版本/预算                                                                            | 不重写组合、不增加任务定义                                     |
| IP-19 / D-42 | packages/core/src/identification-knowledge/schema.ts、service.ts；packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts；packages/core/src/retrieval/schema.ts、service.ts；既有检索 adapter、worker projection handler 与部署 quality gate            | 复用精确 preparation/C04/C11 读取，校验真实规范证据正文；共享成员文本摘要/回查与queryInstruction渲染；通过新审核发布及新代际实测 | 不改旧发布、标签、阈值、模型、预算、权限或事务，不承诺质量通过 |
| IP-20        | functional.mjs 的 FunctionalAcceptanceConfigV1Schema、runFunctionalAcceptance、terminalStatusOfV1、requiredReferencesOfV1、synthetic.mjs 的 createReadOnlyQuerySession                                                                                                                       | 现有三类正式观察及同次结果身份核验，安全报告引用完整链；其他领域事实用既有正式查询留证                                           | 不用任意查询终态猜测或重新计算预期结果                         |
| IP-21        | apps/web/test/browser 既有真实 HTTP/PostgreSQL harness；workflow adapter 的 readEventParentRun/verifyEventConsumption；risk-flow/runtime.ts；backup.mjs/restore.mjs                                                                                                                          | 工程回归与可见 Chrome 分开；实跑原身份重试、重启及隔离恢复                                                                       | 不把单独输入/路由、running/cancelled 或空查询当消费成功        |
| IP-22        | deployment/ACCEPTANCE.md、OPERATIONS.md；前置与本 change 证据                                                                                                                                                                                                                                | 最终索引、主仓库门禁、检查点及 Finalizer/一次限定审计                                                                            | 不修改执行图或通过文档掩盖失败                                 |

## 3. 代码变更映射

| IP-ID        | Task                                | Requirement/Scenario                                                                                                                                                      | 文件与符号                                                                                                                                                                        | 精确变化                                                                                          | 不得改变                                                                          |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| IP-17        | 1.1–1.2                             | 功能验收必须证明正式来源与完整宿主                                                                                                                                        | start.mjs、三个 composition 文件、所属评分/风险输入 adapter；§7 精确清单                                                                                                          | 原真实来源补证，配置/清单/目录/工程绑定核对；只在现有路径修复范围内缺陷                           | D-25/D-26：公共 DTO、最小权限、真实发布成员                                       |
| IP-18        | 2.1–2.2                             | 桌面功能验收与正式离线发布分阶段的当前功能部分                                                                                                                            | desktop e2e 两文件、Playwright 配置                                                                                                                                               | D-28 测试输入 strict 校验；实现八类真实场景和失败 trace；实跑当前平台                             | 产品主进程安全、会话、TLS 和服务端授权                                            |
| IP-19        | 3.1–3.2                             | 联网推理完成业务链路；三类正式来源贯通原业务链                                                                                                                            | provision/synthetic/start、批准配置及安全运行工件                                                                                                                                 | 同次正式资料、配置审核/发布、检索、识别/复核、评估/预警、处置/决定、执行反馈；旧工件不能改标签    | D-27/D-29：原权限、预算、人工确认、版本和链路                                     |
| IP-19 / D-42 | 已发布检索成员与策略的输入/输出语义 | C17 `识别知识包使用独立稳定定义身份`、`规范与案例条目保留原始依据和适用性`；C20 `每个合格成员必须同时存在稠密与 BM25 表示`、`混合查询必须独立召回双路并按版本化 RRF 融合` | `specs/identification/process-model-mechanism-and-evidence-governance/spec.md`、`specs/identification/versioned-dual-index-hybrid-retrieval/spec.md`及核心/adapter/worker既有文件 | C17局部delta约束正文真实来源和候选校验；C20局部delta约束共享 `retrievalMemberText` 与策略指令渲染 | preparation、当前权限、预算、BM25/文档Embedding原文、原标签/阈值/模型及旧发布不变 |
| IP-20        | 4.1–4.2                             | 功能报告必须对应同次正式终态与可见交互                                                                                                                                    | functional/synthetic 及测试、functional-run-config.example.json、evidence/                                                                                                        | 完整实际观察配置和结果链报告；保留等待/超时/缺引用/取消/拒权失败；仅必要时修原观察器              | 原 submitted 语义、查询白名单与安全报告                                           |
| IP-21        | 5.1–5.3                             | 可见业务交互；重启与回执故障重投；兼容回退/损坏拒绝                                                                                                                       | Web 生产 HTTPS、原 runtime/消费/恢复程序及对应测试                                                                                                                                | 可见 Chrome 业务与当前 Electron 结果对齐；隔离故障注入和正式恢复证据                              | D-29：确认/幂等、取消零写、保留原实例与双根                                       |
| IP-22        | 6.1–6.3                             | 当前功能与最终交付分阶段；目标环境未齐时工程检查                                                                                                                          | 手册、证据索引、tasks；verification 仅 Finalizer                                                                                                                                  | 全仓门禁、固定检查点、逐场景报告和限定审计；保持 F-01–F-05                                        | D-30：没有待审计/缺证据的 PASS                                                    |

## 4. 调用与副作用顺序

1. 核验基线、release/code/migration/purpose、秘密文件、批准服务与策略；任何缺项在业务监听/写入前失败。保留旧容器、数据和账号，采用新的隔离实例。
2. 显式初始化 → C06 登录及管理授权 → 原 C04/C11 预置 → 新转换/资料段 → 业务配置待审 → 正式 C07/C16 发布 → 按真实回执绑定知识及检索代际。
3. 完成全部 provider/一次绑定环/五类 registry，启动独立 API/Worker、Caddy 静态生产构建和同源 HTTPS；真实模型/检索门禁不能被空轮询代替。
4. 原冻结命令及 task 预算推进图；模型候选进入确定性校验。按原人工确认提交复核/发布/采纳，不用配置自述的审核状态代替。
5. 原 query 会话观察精确同次任务/运行；业务、C04、审计和端到端链逐项核对。超时和人审保持原身份续接，取消不补造终态。
6. 可见 Chrome 和 Electron 从真实会话读取同一对象；断网/重连不重发写命令；关闭窗口不改变服务端已受理任务。
7. 故障仅在隔离实例：事实提交后回执失败重投 → 当前授权和已提交阶段事实复验 → 原短事务回执；备份全停写/全授权 → 新根恢复/完整核验 → 人工确认切换。失败不删除原根。
8. 安全报告与引用索引耐久保存，工程检查完成后按授权形成固定检查点，再由 Finalizer/必要 Auditor 形成 verification。

## 5. Schema、状态与持久化落实

生产 Schema、错误码、图状态、C03/C04/C06/C08/C19 事务和版本沿既有事实源，数据库最终迁移仍为 000058。本 change 不增加生产迁移、表或第二引用登记；公开契约补充仅按已批准D-36/D-39落实。三类终态观察：Agent 任务详情、识别运行详情、运行总览投影；Unsupported DTO 保持 BLOCKED。全链其他引用从正式所属查询与已登记关系逐项证明，不给任意 query 添加通用 status 判定。

唯一新增测试宿主 Schema 按 D-28，位于 desktop e2e acceptance.mjs，不进入产品 DTO。只读配置/报告及新证据写入新文件；秘密文件不提交，模型/资料原始响应继续 C04 权限保护，不复制进普通 Markdown/JSON。

阶段终态仍为 PASS/FAIL/BLOCKED，原 submitted/awaiting-human 未通过语义保持。上游准备、A3 冻结或仅路由登记不能证明正式业务成立；C29 使用建议创建时精确偏差版本，当前/历史空间与权限逐读核对。

## 6. 验收证据矩阵

下表列出全部新 delta 场景；同一 Requirement 在每行以“Requirement / Scenario”识别。当前可运行证据命令编号见表后；C38 移交场景不列作本 change 完成项。

| Requirement / Scenario                                                    | IP-ID                                   | 测试文件/前置                                           | 关键断言                                   | 可运行证据                                      |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| 当前功能验收与最终部署交付必须分开收口 / 无目标硬件完成当前功能验收       | IP-22                                   | 当前功能全部真实报告                                    | 仅功能 PASS，F-ID 未计通过                 | V5、V6                                          |
| 同上 / 网络 API 或真实业务证据缺失                                        | IP-19/IP-20                             | functional.test.mjs；真实服务                           | 缺证据非零、无替身                         | V2、V4                                          |
| 模型与 OCR 必须离线预置并隔离资源 / 联网推理完成业务链路                  | IP-19                                   | network-api smoke；MinerU V2/new C11                    | 精确后端、预算、C04/正式结果               | V3、V4                                          |
| 同上 / 预置服务身份与真实协议匹配                                         | IP-22 → C38 F-03/F-04（原 IP-10/IP-14） | C38 最终模型/OCR介质                                    | 真实离线协议与资源证据，未执行             | 当前仅 V6 移交核对；实际执行命令须 C38 规划闭合 |
| 同上 / OCR 饱和或崩溃                                                     | IP-19/IP-21；本地 GPU 影响交 F-04       | 真实功能 OCR；原预算                                    | 原任务失败，其他模型任务不改身份/预算      | V4；按原服务控制在隔离实例注入故障              |
| 同上 / 模型制品或资源证明缺失                                             | IP-22 → C38 F-03/F-04                   | 精确介质与宿主                                          | 缺项不称最终交付                           | V6；真实制品取证留 C38                          |
| 发布回退与目标环境验收必须有真实证据 / 兼容版本回退                       | IP-21                                   | backup/restore tests；隔离实例                          | 原精确确认、保留事实/根                    | V1、按 OPERATIONS.md 的原回退命令实跑           |
| 同上 / 不兼容回退或缺少真实证据                                           | IP-20/IP-21                             | restore.test.mjs、functional.test.mjs                   | 不换旧镜像补数据，不用 skip                | V1、V2、V4                                      |
| 同上 / 在批准目标硬件形成基准                                             | IP-22 → C38 F-04                        | 4090/128GB与辅助 GPU                                    | 实测资源/性能，未执行                      | V6；真实 benchmark 先由 C38 实现                |
| 同上 / 目标环境未齐时完成工程检查                                         | IP-22                                   | 全仓工程及当前功能报告                                  | 最终硬件不阻塞已完整功能；当前缺证据仍阻塞 | V5、V6                                          |
| 功能验收必须证明正式来源与完整宿主 / 三类正式来源贯通原业务链             | IP-17/IP-19                             | policies-readers/assessment/risk-flow tests；正式来源   | 精确 C19/C24/C30 和两阶段授权              | V1、V4                                          |
| 同上 / 错来源或关键服务缺失                                               | IP-17/IP-19                             | 相同套件及拒权场景                                      | 无权/错版/异空间失败、无默认值             | V1、V4                                          |
| 功能报告必须对应同次正式终态与可见交互 / 同次业务与可见浏览器具有完整证据 | IP-20/IP-21                             | functional + 可见 Chrome                                | 同次链路、正式确认、安全双向追踪           | V4、V5 中 browser；另实际可见窗口证据           |
| 同上 / 人审等待或观察证据不完整                                           | IP-20                                   | functional.test.mjs；真实等待                           | 非零且原身份续接、不代批                   | V2、V4                                          |
| 同上 / 重启与回执故障重投                                                 | IP-21                                   | workflow/risk-flow runtime/consumer tests；实际隔离故障 | 复验当前权限和已提交事实，效果不重复       | V1、V4；SIGTERM 后同发布原身份启动              |
| 桌面功能验收与正式离线发布分阶段 / C38 无公网环境安装正式客户端           | IP-22 → C38 F-01/F-02                   | 三平台正式包/签名                                       | 逐平台真实安装，未执行                     | V6；最终 package/e2e 命令由 C38 规划            |
| 同上 / 当前功能验收与 C38 平台证据缺失                                    | IP-18/IP-22                             | 当前平台完整 Electron                                   | 当前桌面特有行为实跑，未来不冒称通过       | V7、V6                                          |
| 同上 / 兼容界面更新与正式平台证据                                         | IP-18/IP-22 → F-01/F-02                 | 同 HTTPS 界面更新                                       | 无 UI 副本/自动升级，缺签名不制正式包      | V7、V6                                          |

- **V1**：`pnpm test:deployment`，以及 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts`。
- **V2**：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`。
- **V3**：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`；完整 MinerU 资格按其 V2 真实 smoke 配置与 manifest，不复用 V1 失败件。
- **V4**：`node scripts/deployment/start.mjs --role api|worker --config <实际部署配置> --manifest <同发布清单>`（role 实际逐个选）；`node scripts/deployment/provision.mjs --config <真实预置配置> --output <新预置报告>`，部署配置与同发布清单分别由 RISKFLOW_DEPLOYMENT_CONFIG/RISKFLOW_RELEASE_MANIFEST 传路径；`node scripts/acceptance/functional.mjs --pack <批准包> --config <真实functional配置> --output <新证据目录> [--resume]`。秘密只走文件。
- **V5**：`NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`；工程命令不等于 V4/可见交互通过。
- **V6**：核对 handoff.md 原任务/IP/F-ID、实际 Git 检查点、全部场景报告与必要审计，`pnpm exec openspec validate complete-private-deployment-functional-acceptance --strict --no-interactive`。
- **V7**：`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm exec playwright test -c playwright.desktop.config.ts`；无签名包亦必须有真实 Electron、受信任 HTTPS 与完整场景，关键 skip 不通过。

## 7. 文件清单与升级条件

### D-54已批准施工补充

IP-19/IP-21依持续授权纳入D-78：在`scripts/deployment/start.mjs`提取C21原精确逻辑授权核验函数供C22优先复用；扩`scripts/deployment/entrypoints.test.mjs`既有真实宿主授权配对，断言同分支C22核验保留原上下文/范围。同步design/graph delta/evidence/handoff；不改C06/TTL/权限、领域身份或预算，不复活v84，不把模型屏障预检算PASS。

IP-19依持续授权纳入D-77：修改`packages/core/src/identification/candidate-finalization/schema.ts`的modelContextResultIdFor去除错误实体长度门槛、调用C21共享身份helper；扩`packages/core/test/identification/candidate-finalization.test.ts`既有身份测试。同步design/关系上下文delta/evidence/handoff；保持声明前缀/任务资格、引用/权限/版本与预算，不截断或hash替换ID。

IP-19/IP-21依持续授权纳入D-76：修改`packages/core/src/identification/context/schema.ts`共享模型上下文entityId helper及`service.ts`只读reader；扩`packages/core/test/identification/context.test.ts`既有组装用例的缺失、精确读取、错版/工作项/主体、撤权与零新事实。修改`apps/worker/src/identification/context/composition.ts`导出reader、`apps/worker/src/identification/candidate-finalization/composition.ts`检查readExact可调用、`scripts/deployment/composition/identification.mjs`接入窄读。扩既有Worker context/candidate composition测试和`scripts/deployment/entrypoints.test.mjs`真实宿主接缝核验；同步design/关系上下文delta/evidence/handoff。不改C22既有端口、HTTP/DTO/迁移/依赖、权限/预算或旧终态。

IP-19/IP-21依持续授权纳入D-75：修改`packages/adapters/src/identification/context/postgres-identification-context-adapter.ts`，从实际artifactRef沿既有规则取得登记审计身份并删除重复switch；扩其既有`packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`的带任务工件身份与三类回读。同步design/关系上下文delta/evidence/handoff；不改公共端口/Schema/迁移、事实ID、外键/事务/权限/预算，不复活v83或手工补注册。

IP-21的D-74已定位补充：在`apps/worker/src/identification/graph/graph.ts`的唯一executableConfig显式清除父scratchpad继承，沿原根namespace/saver/sync运行；回归文件为既有nested-boundary.test.ts。同步design/graph delta/evidence/handoff，不改C03校验/格式、业务游标、权限/预算或旧终态；临时测试DEBUG取证完成即删除。

IP-21依持续授权纳入D-74诊断：扩`apps/worker/test/identification/graph/nested-boundary.test.ts`，用已有真实父/子StateGraph及C03夹具，覆盖父自身interrupt后携同一已完成检索任务结果恢复子图，而不是只在新父节点中调用resume。先复现并读取内层cause，定位前不更改生产恢复语义；必要修复仍先同步design/graph delta。保留真实旧终态和预算，不新增依赖或替代状态机。

IP-19/IP-21依持续授权纳入D-73：修改`packages/core/src/identification/context/service.ts`唯一applicabilityCovers集合覆盖方向，并扩`packages/core/test/identification/context.test.ts`既有关系查询的相等/机理超集/部分覆盖用例；新增当前change的`specs/identification/relationship-context-and-retrieval-agent-review/spec.md`明确覆盖方向。同步design/evidence/handoff；不修改已发布知识、标签、检索门槛、权限/预算或旧终态，另行定位首次父恢复瞬时失败。

IP-19/IP-21依持续授权纳入D-72：仅`scripts/deployment/start.mjs`的runTask初始化受理命令配对，并扩`scripts/deployment/entrypoints.test.mjs`既有租约作用域用例，实际受理授权ID与冻结业务commandId不同仍须经原C06租约/权限复验。同步design/graph delta/evidence/handoff。保持冻结任务/旧失败、D-71预算、TTL/权限、公共契约/依赖；不复活v80任务。

IP-17/IP-19依持续授权纳入D-71：仅私有隔离实例新建risk-candidate/identification-graph策略与部署目录版本，generation.budget.maxTotalTokens从4096到32768并联动精确策略引用；其余预算/模型/提示/工具/检索门槛保持，strict Schema与真实装配校验后用于新批次。同步design/handoff及证据，保留旧策略/终态/冻结预算，不修改生产公共契约或依赖。

IP-19/IP-21依持续授权纳入D-70：修改`packages/core/src/identification/graph/ports.ts`内部签发输入的可选logicalInvocationId；修改`apps/worker/src/identification/graph/graph.ts`共享行动授权helper使用已核验执行身份并传逻辑配对，I3仅创建路径签发start-task；修改`scripts/deployment/start.mjs`当前作用域精确授权配对键/authorizeCurrent与verify；扩`scripts/deployment/entrypoints.test.mjs`真实过期行动和多引用配对，既有C24运行/嵌套用例按实际断言同步（仅runtime.test.ts/fixture.ts必要时）。同步design/graph delta/证据/handoff；不改HTTP Schema、TTL/权限/业务身份、任务或模型预算，不复活v78终态。

IP-19/IP-21依持续授权纳入D-69：修改`apps/worker/src/risk-flow/runtime.ts`在父retryable-failure时按原阶段retry并保留已校验的Agent完成原因；扩`apps/worker/test/risk-flow/runtime.test.ts`既有公共任务恢复用例的一次技术异常分支。同步graph delta、design、handoff与证据；不改Schema/权限/原预算/终态。当前v78原父保留，不新建批次，验证后从公共接口以当前版本及原完整完成结果续接。

IP-17/IP-19依持续授权纳入D-68合成输入补充：新增本change的`evidence/synthetic-process-model-completeness-supplement.json`（独立合成候选，原fixture/归档输入保持）；同步design/handoff/本证据。私有隔离实例用新建脚本复用既有DOCX生成、source-delivery、document-convert、cleaning、C17提交/审核/发布与检索质量流程，重新绑定正式证据；必要依赖知识及组合仅创建新版本。核验五节点受力覆盖、原节点/关系保持、Schema、正式转换/清洗/发布/七项质量回执及当前来源授权后才新业务批次。无新增公共契约/依赖或生产代码修改，不更改既有质量门。

IP-19/IP-21依持续授权纳入D-67：修改`scripts/deployment/start.mjs`的C21读取签发及当前作用域精确逻辑/实际行动映射，保持C06/任务租约/旧TTL；扩既有`scripts/deployment/entrypoints.test.mjs`真实当前控制/过期读取/错配拒绝。修改`apps/worker/src/identification/graph/graph.ts`的I3已登记等待任务恢复，核对原任务归属后复用，不重冻候选或重启任务；扩`apps/worker/test/identification/graph/runtime.test.ts`既有等待恢复行为（必要夹具仅`fixture.ts`）。同步graph delta、design、handoff和证据，无新依赖、迁移或业务权限；保留v73终态和completed任务，工程通过后新独立验收批次。

IP-19/IP-21依持续授权纳入D-66：修改`packages/core/src/persistence/checkpoint.ts`新增自有CheckpointReference联合（原ContractReference及既有AgentTaskResultRef）；修改`packages/adapters/src/postgres/checkpointer.ts`收集器及回调类型，对合法完整结果原子证明、错误形状拒绝；扩`packages/adapters/test/postgres/postgres-foundation.test.ts`真实PG验证并更新原引用fixture类型，同时将`apps/worker/test/identification/graph/control-channels.test.ts`既有validator参数同步为新类型。修改`scripts/deployment/start.mjs`支持该联合，复用C08任务reader/getTask与已有父子入口证明；扩`scripts/deployment/entrypoints.test.mjs`完成结果/未完成/错结果拒绝。同步design/graph delta/证据/handoff，保持其它C03/控制通道/权限/预算，工程通过后恢复v73原批次，不创建替代审阅任务。

IP-19/IP-21依持续授权纳入D-64/D-65：修改`scripts/deployment/start.mjs`的riskFlow/put-writes任务引用证明，现有workflow.registrationStore窄读补已登记子运行并保留精确入口证明；扩`scripts/deployment/entrypoints.test.mjs`旧检查点下新子任务与错父拒绝。修改`packages/core/src/identification/context/service.ts`校验工件正式用途及唯一身份派生；扩既有`packages/core/test/identification/context.test.ts`工件用途与模型观察验证，不改C08/C04。移除`apps/worker/src/risk-flow/runtime.ts`临时DEBUG。同步设计/graph delta/证据/handoff，相关回归及工程检查后冻结新制品；旧任务、正式C21结果、错误工件和预算保持。

D-63私有配置补充：新graph policySetRef必须与risk-candidate所有成员精确配对，因此新risk-candidate目录版本和成员版本仅联动policySetRef/自身policyRef，graph对这些成员的引用对应同步；成员其余约束逐项深比较保持。v71预检拒绝保留、未部署，下一暂存用v72，不改既有生产校验或历史catalog。

IP-19/IP-21依持续授权及既有预算授权纳入D-63：修改`packages/core/src/identification/context/{schema,service}.ts`，review策略必填既有AgentTaskBudgetPolicyV1并核对引用/候选及补搜边界，任务定义直接消费预算；更新既有`packages/core/test/identification/context.test.ts`、`apps/worker/test/identification/context/fixture.ts`及`scripts/deployment/entrypoints.test.mjs`夹具与预算拒绝/配置消费回归。在私有实例冻结新review/预算/提示引用和identification-graph策略引用，保留旧发布和失败，不修改历史证据catalog。为定位已登记父等待后的HTTP503，将`apps/worker/src/risk-flow/runtime.ts`纳入仅临时故障元数据诊断范围：只记错误种类/代码/阶段及无消息的堆栈位置，不改行为，最终制品前移除；现有C30运行时回归保持。同步design/delta/证据/handoff，工程检查后用新批次取证；无新依赖、迁移、权限或检索质量放宽。

IP-19/IP-21依持续授权纳入D-62：修改`packages/core/src/identification/context/{schema,service}.ts`，新增窄类型化工具观察及受权模型输入读取，统一既有条目定位，保留原范围和8MiB读取边界；修改`apps/worker/src/identification/context/{runtime,composition}.ts`异步加载受权候选/观察与既有策略，修改既有`packages/core/test/identification/context.test.ts`及`apps/worker/test/identification/context/{runtime,composition}.test.ts`验证模型可见内容、补搜后候选/校验观察、跨任务与撤权。依实际调用方补`fixture.ts`仅用于原测试端口。同步设计/delta/证据/handoff，工程门禁后冻结新制品，旧失败保持；无新依赖或预算扩张。

IP-19/IP-21依持续授权纳入D-61：修改`scripts/deployment/start.mjs`的identificationContext.verifyCurrent，复用access.verify按实际逻辑行动证明当前租约映射；修改`packages/core/src/identification/context/service.ts`当前候选读取的queryId与签发/复验ID一致。扩既有`scripts/deployment/entrypoints.test.mjs`与`packages/core/test/identification/context.test.ts`；同步design/graph delta/证据/handoff。保持普通身份、撤权、当前租约、冻结范围、C06与预算，先红后绿，不复活v68失败任务。

IP-19/IP-21依持续授权纳入D-60：修改`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`唯一putBody，当前授权核验后按实际写入输入派生存储命令身份，复用既有sha256CanonicalJson；扩展`apps/worker/test/identification/graph/fixture.ts`的一次阶段事务回滚注入及既有`runtime.test.ts`跨时刻恢复回归。C03动作键、登记唯一性、审计、历史工件及C04严格校验保持。同步design/graph delta/证据/handoff，先红后绿并完成相关adapter、C24及工程验证后冻结新制品，以独立批次继续，不复活v64终态。

IP-19/IP-21依持续授权纳入D-59：修改`apps/worker/src/identification/graph/graph.ts`唯一executableConfig清除父checkpoint_id及其后备checkpoint_map；扩展既有`apps/worker/test/identification/graph/nested-boundary.test.ts`真实嵌套技术恢复用例。测试已复现子线程写入外来checkpoint_id及未处理拒绝；清理临时fixture观察字段，不改C03校验、协议通道、依赖、迁移或预算。同步本change graph delta及安全证据，验证无未处理错误后冻结并恢复原运行。

IP-19/IP-21依持续授权纳入D-58：修改`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`的错误引用精确读取与检查点证明，复用既有生产判别列；纠正`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`的错误行主键夹具并扩展错运行拒绝。只读查询限定工程、运行、种类和完整错误引用，最多2行；不改登记、C03、历史数据、迁移或权限。移除start.mjs临时诊断；同步本change graph delta及安全证据。真实历史回执预检通过后才走公开恢复。

IP-19/IP-21依持续授权纳入D-57：修改`apps/worker/src/identification/graph/graph.ts`统一rowBase的幂等键并在I1固定运行归属，复用已有actionIdFor按运行分区；扩展既有`apps/worker/test/identification/graph/runtime.test.ts`同数据库双父运行场景，已红态复现第二父I0/I1失败。保留现有运行重放、并发和检查点验证，不改C03、adapter、迁移、历史行、模型或预算。同步本change graph delta及安全证据，完成门禁后再走正式公开恢复。

同一回归继续定位I1快照身份，D-57补`packages/contracts/src/workflows/index.ts`的可选identificationRunRef、`packages/core/src/identification/graph/service.ts`的快照构造/唯一身份及工作计划复验，C24在I1传本次运行；既有core graph测试和C24 fixture按实际运行计算预期计划/工作项，不锁定旧固定版本。更新本change graph及domain delta；不变更HTTP路由、准备匹配、模型、权限或预算。

IP-19/IP-21依持续授权纳入D-56：`packages/core/src/agent-runtime/runtime.ts`导出已有纯agentTaskRefFor并由prepareAgentTaskStart复用，既有index.ts星号导出自动接线；`apps/worker/src/identification/graph/graph.ts`在冻结候选前按实际启动幂等键复用该函数。扩展`packages/core/test/agent-runtime/agent-runtime.test.ts`及既有C24 runtime/fixture回归，证明预先冻结与实际启动身份一致、跨批次隔离，保留错引用拒绝。隔离实例新策略只补四个已批准根的agent-task.read/review-audit.read，复用entrypoints真实C06/检查点回归；同步当前change Agent/graph/domain delta及安全证据。无依赖、迁移或公共HTTP字段变化；不复活v63终止任务、不改旧失败或预算。

IP-19/IP-21依持续授权纳入D-55显式识别批次修正：`packages/contracts/src/ports/index.ts`的identify-and-assess启动载荷增加可选executionBatchId；`packages/core/src/workflow/service.ts`唯一workflowEntryIdentityFor接受并纳入摘要；`apps/worker/src/risk-flow/runtime.ts`公开启动传递批次，不变更其余入口或冻结资料。复用`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/core/test/workflow/service.test.ts`、`apps/worker/test/risk-flow/runtime.test.ts`验证缺省身份保持、同批次重投、异批次分区及同键换批次拒绝；既有HTTP套件验证Schema自动接线。同步当前change相关delta和现场证据，不改主规格、迁移或依赖。

IP-21依持续授权补齐公共恢复接线：`apps/worker/src/risk-flow/graph.ts`、`runtime.ts`保留完整Agent结果/复核决定并以真实父恢复身份恢复精确C24等待；`packages/core/src/identification/graph/ports.ts`内部恢复原因可携带完整结果；`apps/worker/src/identification/graph/runtime.ts`核验completed快照、任务/结果与精确子运行归属。复用`apps/worker/test/risk-flow/runtime.test.ts`、`apps/worker/test/identification/graph/runtime.test.ts`及其既有fixture，验证公共路径完整转交、正确结果沿原任务恢复，错误任务/结果/父运行版本零子运行推进。不增加公共HTTP字段、事件、迁移、状态机或依赖，不改变原冻结时刻和预算；没有现场结果前不计通过。

用户已批准[evidence/identification-batch-scope-and-read-context-proposal.md](evidence/identification-batch-scope-and-read-context-proposal.md)全部范围（含持续授权：当前验收任务后续必要修正预先授权，仍先记录事实、设计/施工图与验证，不提交、不归档、不放松权限、不伪造验收），正在实施；tasks保持5/19，不预勾选、不建verification。

IP-19承担：新显式验收批次（业务载荷仍原五来源、外层授权为原父21与知识发布19的并集24并逐项按当前账号权限核验、原五份准备按既有严格条件绑定，不用19资料知识准备冒充）、同成员新发布重建双索引与激活代际（数据集仅按新发布引用建新版本，原query/标签/证据/七门槛/模型/TopK/预算不变）、C21/C16/C24所属读取身份契约修复（C21原上下文精确身份与完整授权摘要对账、C17→C16内部解析显式invocationId、C24逐操作签发回调实际identity）及真实PG/C06/C04复现与回归。IP-21承担：隔离实例新策略版本、候选包与正式命令接线（仅workflow.start-run、workflow.resume-run、engineering-data.complete-identification-preparation的八个既有分支及复核root，仍由C06逐分支检查当前主体既有角色能力，不改角色/账号/成员/资料授权/TTL/事务/迁移），原启动/恢复/绑定/重投语义不变。IP-22承担：真实回执、发布/授权/代际摘要一致性与安全证据索引，未成立不勾任务。

源码范围：`packages/core/src/identification/context/ports.ts`、`service.ts`（原上下文、精确用途/调用身份及完整冻结授权摘要对账，复用既有reader、校验和摘要；`schema.ts`仅在既有摘要字段语义必须同步时调整）；`packages/core/src/knowledge-governance/schema.ts`、`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`（内部解析invocationId）；`packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`（调用方精确身份传递与已确认读取错误）；`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`apps/worker/src/identification/graph/composition.ts`（逐操作真实签发身份回调，不改业务登记/事务）；`apps/worker/src/identification/context/composition.ts`、`scripts/deployment/start.mjs`、`scripts/deployment/composition/identification.mjs`（真实签发与既有模块接线，原模型与预算配置不动）。测试范围：上述模块既有core/adapter/worker测试及`scripts/deployment/entrypoints.test.mjs`、`composition.test.mjs`，复用既有夹具补真实PG/C06/C04集成回归；文档同步限本change proposal/design/implementation-plan/handoff、D-54提案状态、identification/graph、domain/module-interfaces-events-workflows、identification/process-model-mechanism-and-evidence-governance局部delta与安全证据，不动主规格与AGENTS。

验证：先在真实PG/C06/C04测试设施复现逐发布身份错配、完整冻结范围与现场来源混用、跨调用身份碰撞/过期复读，再验证同一合法范围可读、错主体/来源/范围/分支/过期/撤权仍拒绝、任务只读原冻结输入；先闭合v59原时刻依据复读的技术错误并保留真实错误类别，再冻结新策略/发布/索引/数据集制品；真实读取链与新批次的发布/授权/代际摘要全部一致后才发正式新运行，不拿原父预算探路；任何等待、失败或缺失都不算通过，旧父/旧游标/旧失败/v55范围/重试预算全部保留。无新依赖、迁移、通用数据库/文件/网络工具、UI范围或模型预算变更；不直接SQL写业务事实、不覆盖历史对象。

### D-53已批准施工补充

D-53源码与接线已部署v59，工程验证和现场授权/准备窄读证据见[evidence/identification-domain-authorization-2026-10-15.md](evidence/identification-domain-authorization-2026-10-15.md)。完整业务仍未通过；D-54新批次/策略/读取契约已获批准并正在实施，范围见本change D-54施工补充，不预勾选任务。

IP-19/IP-21按用户已批准[evidence/identification-domain-authorization-scope-proposal.md](evidence/identification-domain-authorization-scope-proposal.md)实施：C24进入领域效果前经窄authorizeDownstream取得既有risk-identification.plan分支真实执行授权并固定到运行上下文、启动回执与检查点；adapter公共读写接缝增加窄issueReadContext逐操作签发；I1依据、I2知识读取、I3检索上下文/任务及I4–I9调用使用同一接缝并使invocationId与commandId/requestId一致；I2准备窄读在部署组合复用既有PostgresIdentificationPreparationKnowledgeReader按真实requestId委托C15/C04；恢复、取消及已有复核恢复接缝统一可证明控制来源并补D-52同形issuedInvocationId/authorizationBranch元数据。不改业务算法、分支白名单、角色、TTL、事务隔离、迁移或权限语义，不把workflow.resume加入领域能力表。

源码范围：packages/core/src/identification/graph/ports.ts（共用窄授权类型及必要内部恢复/取消来源元数据，复用现有分支/引用Schema）；apps/worker/src/identification/graph/runtime.ts、graph.ts、composition.ts及既有index.ts仅必要类型导出（控制与领域授权接线、统一逐操作签发、已有恢复回调元数据）；packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts（逐目标受限issueReadContext接缝，保留单能力/主体/范围、摘要、C04 verified和错版拒绝）；scripts/deployment/start.mjs、composition/identification.mjs（真实C06签发、执行上下文/下游关联、既有准备窄读复用及检查点接线，不调整授权策略）。测试范围：packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts、wiring.ts，apps/worker/test/identification/graph既有fixture、runtime、composition、nested-boundary、control-channels测试，scripts/deployment/composition.test.mjs、entrypoints.test.mjs、apps/worker/test/risk-flow/runtime.test.ts；按实际受影响的既有用例调整，现有调用者无需注入时保留原严格复验，不为新签发增加测试专用放行。

验证：先以现有真实PG/C06/C04测试设施在C24公开接缝复现“父控制授权进入领域读写”和“上下文引用/逐操作身份不匹配”，再验证当前合法父恢复可取得既有领域能力、精确逐操作身份在真实C06下可读写，错主体/工程/范围/分支/签发身份、撤权、损坏及超限继续拒绝；“任意输入都返回同一context”的替身不能作为这条授权链的通过证据。覆盖I0登记、I1正式依据、I2完整工作计划、I3受限任务启动及已有I4–I9接口的用途/身份配对，确认不扩大资料范围、无重复任务/记录；恢复/取消/回执重投和检查点沿原父子事实，缺少合法来源即零新效果。所属回归、8GiB build/typecheck、lint/format、全仓strict/diff通过后才冻结新制品，再以当前游标/错误/诊断引用恢复原父流程并逐项记录真实结果；tasks不预勾选，不提交、归档或创建verification。

### D-49已批准施工补充

IP-19/IP-21按[evidence/cleaning-preparation-completion-scope-proposal.md](evidence/cleaning-preparation-completion-scope-proposal.md)实施：contracts ports及既有契约测试新增strict完成分支/branch映射；API http及既有http-shell测试接同名正式命令；C15 postgres-data-cleaning-store及既有store测试/fixture/必要同目录index接精确C08任务读取、当前权限/C04验证、复用收口/幂等并发及原因果窄读；C11 context-source registry及既有测试/fixture路由freeze；start.mjs、composition/api-ports.mjs、composition/risk-flow.mjs及既有entrypoints/risk-flow-composition测试接当前完成命令与原父运行证明。同步proposal/design/handoff、C15/C11/HTTP局部delta与安全证据。不改C06普通TTL、事件DTO、迁移、依赖或历史事实。验证旧到期拒绝、新授权消费同任务、错版/撤权/取消/损坏/超限拒绝、同键冲突/并发/单次事件/重投及真父运行；工程通过后用原v46已完成任务正式取证，不再建任务冒充复用，tasks不预勾选。

### D-48已批准施工补充

IP-19按[evidence/agent-task-current-authorization-scope-proposal.md](evidence/agent-task-current-authorization-scope-proposal.md)实施。源码限core agent-runtime/runtime.ts及必要index导出、adapters agent-runtime/postgres-agent-task-adapter.ts、auth/postgres-local-identity-access.ts和deployment-authorization.ts、Worker agent-runtime/runner.ts、scripts/deployment/start.mjs及必要composition/identification.mjs；复用任务/租约/预算、原C06当前权限与分支关联，普通TTL仍5分钟。测试扩展既有C06/C08、runner、deployment entrypoints/composition，涵盖到期续跑与错任务/租约/范围、撤权、安全版本、取消/终止、预算和审计失败；现有幂等与恢复保持。同步本change相关delta和状态，不改主规格、依赖、迁移、HTTP或历史记录。回归及build/typecheck/lint/format/strict/diff通过后冻结新发布/策略/命令，新19资料任务越过5分钟节点实测，三份标准不重转、旧失败不复活。不提交/归档/创建verification。

### D-47已批准施工补充

IP-19按[evidence/jsonld-read-bound-scope-proposal.md](evidence/jsonld-read-bound-scope-proposal.md)实施。源码限`packages/core/src/engineering-data/document-conversion/schema.ts`导出共享16MiB常量，`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`复用它，`packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`仅对精确JSON-LD读取及单标准条目累计工件读取使用16MiB；其它4MiB读取不变。测试仅扩展既有C15/C17 adapter测试，大于4MiB小于16MiB的合法文档通过、单次/累计超限拒绝，原错版/撤权/损坏及候选包限额保持。同步当前change相关局部delta、proposal/design/handoff与证据，无新依赖、HTTP、迁移或权限。运行定向测试、build/typecheck/lint/format/全仓strict/diff后冻结新发布，保留三份合格转换和v39失败，以新策略/命令恢复19资料准备、C17人审发布和原检索质量门；不改模型或业务预算，不提交、归档或创建verification。

### D-46已批准施工补充

IP-19按[evidence/table-image-payload-scope-proposal.md](evidence/table-image-payload-scope-proposal.md)实施。源码清单：packages/core/src/engineering-data/document-conversion/schema.ts、service.ts；packages/adapters/src/engineering-data/document-conversion/mineru/mineru-document-parser.ts、official-normalization.ts、normalization.ts；packages/core/src/engineering-data/cleaning/schema.ts；packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts；apps/worker/src/engineering-data/cleaning/runtime.ts。复用单一图片引用Schema、既有包/图片预检、cell/tableField映射与C15工具，禁止图形推断、路径正文、外链或静默空值；不加依赖、HTTP、迁移、权限、工具或预算。

测试清单：packages/core/test/engineering-data/document-conversion.test.ts、cleaning.test.ts；packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts、official-normalization.test.ts、protocol.test.ts及必要fixture.ts；packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts；apps/worker/test/engineering-data/cleaning/runtime.test.ts。先合法图单元格红灯，验证图文/纯图/空值区分、包内唯一来源和危险拒绝、C15源计数/同表观察/指纹及原预算，再build/typecheck/lint/format/全仓strict/diff；冻结新制品和解析部署，只为STD-002正式新资料版本重转，保持原质量1/1并核对189页及全部图片。STD-001/003不重复重转，三项真实合格才继续清洗及发布。结果未成立不勾任务或写verification。

### D-45已批准施工补充

IP-19纳入用户已批准的[evidence/mineru-layout-and-source-quality-scope-proposal.md](evidence/mineru-layout-and-source-quality-scope-proposal.md)，生产代码限`packages/adapters/src/engineering-data/document-conversion/mineru/official-normalization.ts`（span增加`chart`；块增加`chart`、`chart_body`、`chart_caption`、`chart_footnote`；`chart`容器沿既有递归映射，`chart_body`验证`chart` span后映射为共享结构要求的惰性图像载荷；图注/脚注保留真实文本与源坐标；图像内容不推断为文本、指标或公式值）与`normalization.ts`（既有`INLINE_TAGS`增加`eq`，沿既有递归读取字面公式文本，不渲染、不求值；`eq`属性、DOCTYPE/ENTITY、危险/未知标签、表格结构与资源上限保持拒绝）；测试限对应两个既有`.test.ts`，复用既有fixture与用例组织；未知类型、版本、越界坐标与资源超限继续拒绝。

实例仅对精确STD-001原件摘要`5fe30dfae8d3cc5cb658980220c4e9fcd98163e8e067cfa4542cbe80f531df6f`建立来源专用质量策略引用，`minNonEmptyPageRatio`由1调整为`97/99`，`minKeyFieldCoverage=1`及原keyFields不变；正式转换后、下游清洗前核对完整99页映射、非空97页、无正文页恰为`{9,51}`及原件摘要/策略精确匹配，任一不符停止并保留结果；该页集合仅属本次来源验收断言，不进入公共Schema或运行时门禁。STD-002/003及既有16份资料保持原策略；模型、服务通道、权限、资源预算、检索query/grade/TopK与七项检索质量阈值不变；冻结新本地发布制品及`converterDeploymentRef`，按既有C11正式入口建立新source-version并固定原件、来源限制与新转换身份，保留v36/v37失败、原响应、历史资料版本与旧下游引用，不直接SQL写入业务事实。

验证：先用合成的同结构输入取得红灯，再运行`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/official-normalization.test.ts packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts`、`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm exec openspec validate --all --strict --no-interactive`、`git diff --check`；工程通过后才部署新制品并执行正式重转，三份来源满足结构、关键字段及来源页核验后才继续原16份加三份标准的新清洗/准备、C17真实条款证据、物理Chrome审核/独立发布和七项检索质量门槛。原五资料父运行仍使用其自身正式准备及因果入口。实施结果由父Agent实机取证后补录，本节点不预填结论。

### D-44已批准施工补充

IP-19纳入用户已批准的[evidence/c04-stable-read-chunks-scope-proposal.md](evidence/c04-stable-read-chunks-scope-proposal.md)：`packages/adapters/src/artifacts/filesystem-artifact-store.ts`仅在C04文件流输出边界把`yield chunk`改为`yield Uint8Array.from(chunk)`，每块交付独立字节副本；`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`的`read only resolves verified after complete streaming reads`改为多块不同内容并保留块后拼接，核对首次读取、重放、完整消费及取消，复用原大文件性能/资源基准。保留原1MiB分块、有界读取、EOF长度/摘要、当前授权、审计、取消与`verified`时机；不新增第二摘要、整文件缓存、Schema、HTTP、依赖、迁移或预算；新转换身份复验保留旧失败。验证：`pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`、相关build/typecheck/lint/format及strict/diff，随后按D-43续验新转换身份。

### D-43已批准输入补充

IP-19按用户已批准[evidence/standard-source-ingestion-scope-proposal.md](evidence/standard-source-ingestion-scope-proposal.md)纳入标准原文输入补充：本次验收输入在原16份治理资料之外补充STD-001/002/003标准真实原文，形成新的正式准备版本。复用既有C04/C11正式登记、MinerU转换与质量门、C15清洗与准备冻结及C17真实证据正文与窄校验，不新增生产代码、HTTP、Schema、依赖、迁移或通用读取工具；新标准条目的evidence与retrievalText只从新准备中的相关真实段确定性构造，保留原entryId、标准版本、条款时间状态与适用范围，经物理Chrome人工批准并独立发布，形成新的检索组合、精确引用策略与新代际。原query、relevance grade、TopK、质量阈值、模型、预算、权限及旧失败不变；新输入按既有清洗预算执行，不足如实失败，不自动扩容、不预判质量通过。实现Agent不读取研究原件，原文经受权资料入口交正式转换并只消费C11/C04受权产物；资料缺失或无资格如实BLOCKED，不合成条款、不改标签、不伪造inputs-ready或复用无关运行；与后续业务只在正式父运行接缝允许时绑定，必须改变运行因果或公开契约时另以实际证据升级。验证：实际来源/许可/摘要、原件C04与转换质量、正式清洗与准备引用、Chrome人工批准与独立发布证据，以及真实全部7项质量门和精确活动代际；任何失败保持非活动，不以报告HTTP200或已提交代替通过。

### D-42实跑补充

上述已批准quality-gate文件内修正查询工件调用身份：每次实际调用固定独立invocationId及同值idempotencyKey，避免新指令/新测量复用旧工件身份；不改模型或C04契约。既有quality-gate测试覆盖跨测量不复用，C17既有真实PG测试核验正文来源和错误分支。七套件355项、调用身份修复后三套件156项、最终两套件39项分批通过，批次不累加。真实报告、安全引用和未完成项见evidence/retrieval-semantic-content-2026-10-15.md；三项召回未达标，保持非活动。新增标准原文输入已按D-43批准并纳入IP-19执行范围。

### D-41已批准施工补充

IP-19纳入apps/worker/src/retrieval/projection-handler.ts及既有test/retrieval/projection-handler.test.ts、scripts/deployment/composition/quality-gate.mjs及既有quality-gate.test.mjs。evaluate增加可选TransactionContextV1，handler和质量门依次把同一上下文传至既有readGeneration，不改事务语义。新增当前change的identification/versioned-dual-index-hybrid-retrieval局部delta；同步design/proposal/handoff及安全证据。复用现有PG夹具验证同事务building可读、事务外不可见及提交后可读，验证质量失败不激活和原身份/权限/耐久报告拒绝；运行两处既有测试、PG retrieval回归、build/typecheck/lint/format/strict/diff后冻结新制品，继续新正式发布及质量测量。范围按已批准evidence/retrieval-quality-transaction-scope-proposal.md，不改归档主规格、迁移、依赖或旧业务事实。

### D-39已批准施工补充

IP-17/IP-19纳入contracts/src/ports/index.ts及既有module-interfaces-events-workflows/c32-read-surface测试；core/src/scoring-rules/schema.ts、service.ts及既有scoring-rules测试；adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts及既有adapter测试；apps/api/src/http.ts、app.ts及既有http-shell测试；scripts/deployment/start.mjs、composition/api-ports.mjs及既有entrypoints/api-ports测试。新增正式组装窄命令/结果/端口、当前权限分离和真实准备/配置/策略核验，SingleBinding接C16原提交。同步本change的domain/module-interfaces-events-workflows、knowledge/structured-scoring-rules-and-applicable-rule-sets和既有HTTP delta；受控实例新策略/发布配置与回执沿批准提案。按提案执行最小测试、build/lint/format/strict/diff及物理Chrome正式组装/审核/发布，仍不改UI、不增依赖/迁移、不提交。批准范围见evidence/applicable-rule-set-entry-scope-proposal.md，取代本施工图对该窄公共入口的原禁止。

### D-36–D-38已批准施工补充

用户要求开始实施原件/Agent方案，一并批准其中两份治理修复；原14项义务保留，7.1–7.4作为该补充的明确子任务。D-36公开接口/依赖/资源预算归design；当前HEAD31ad1a2c47a377f20179e0008241034c14a3bec5加已记录dirty，不提交或覆盖已有改动。

- IP-19原件：packages/contracts/src/ports/index.ts；packages/core/src/engineering-data/context-source/schema.ts；packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts、index.ts及新增source-original-reader.ts；catalog/postgres-engineering-data-catalog-adapter.ts；deployment/schema.ts、deployment/config.example.json；apps/api/src/http.ts、app.ts；scripts/deployment/composition/api-ports.mjs、start.mjs及对应既有http-shell/context-source/catalog/config/api-ports/entrypoints测试，新增原件reader测试。C11历史身份、C04用途/完整性、C06复验及二进制媒体边界。
- IP-21资料UI：apps/web/src/api/client.ts、http.ts、operations.ts；pages/DocumentListPage.tsx、DocumentDetailPage.tsx及同名CSS；新增DocumentOriginalView.tsx及必要同名CSS；components/EvidenceDrawer.tsx按已批准资料段定位场景携带精确版本与真实页码，不读取正文；apps/web/package.json、pnpm-lock.yaml同版本PDF依赖；既有read-only.spec.ts、business-server.mjs及必要viewer测试。
- IP-21Agent：apps/web/src/main.tsx、app/App.tsx、shell/AppShell.tsx、shell/dock/RightDock.tsx；agent/AgentDock.tsx、agentDockStore.ts及必要AgentDock.css；pages/AgentTaskDetailPage.tsx、AgentWorkbenchPage.tsx、agent/AgentTaskProvider.tsx、api/agentAuditOperations.ts；既有ssr-shells/agent-audit-operations及必要交互测试。C08候选投影限packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts及既有测试。
- IP-19C17：apps/worker/src/identification-knowledge/composition.ts及既有composition测试；packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts及既有测试；start.mjs/entrypoints.test.mjs。受信声明、逐组读取身份及提交验证隔离。
- IP-19/IP-21复核：packages/adapters/src/review-audit/postgres-review-audit-read.ts及既有读面测试；api-ports.mjs、start.mjs及既有测试。现有actions字段映射当前会话，不放宽拒权。
- IP-18桌面：apps/desktop/src/main.ts、security.ts、test/security.test.ts、test/e2e/acceptance.mjs、client.spec.ts；批准同源下载路径/PDF/Agent真实交互，不新增本机IPC。
- IP-22：本change工件、相关六能力delta及evidence；deployment/ACCEPTANCE.md、OPERATIONS.md。子任务对应原件/Agent/治理/Electron场景，必要定向测试、build/lint/format/strict后新构建在物理Chrome/Electron取证，旧失败/来源不改写。归档主规格本轮不直接改变。

物理PDF复验发现中文字体需要本地CMap；IP-21追加apps/web/vite.config.ts的构建资源发射，随批准pdfjs-dist提供cmaps/standard_fonts/wasm及许可，无新依赖。Viewer只使用同源随包资源，保持原离线显示义务。

删除旧面板开关前核对所有调用者；PDF声明/锁文件由父串行处理。实际不存在的计划文件及技术决策按范围升级规则处理。

| IP-ID       | 新增/修改文件                                                                                                                                                                                                                                                                                  | 动作                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| IP-17       | deployment/config.example.json、model-gateway-config.example.json；start.mjs；composition/identification.mjs、assessment.mjs、risk-flow.mjs；entrypoints.test.mjs、assessment-composition.test.mjs、risk-flow-composition.test.mjs；packages/adapters/test/deployment/policies-readers.test.ts | 示例维持真实结构；核对来源/装配并修范围内行为，不写实际秘密或生产策略进示例                                               |
| IP-17/IP-19 | scripts/deployment/provision.mjs、provision.test.mjs；packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts、src/identification/read/postgres-standardized-risk-input-facts-reader.ts 及对应既有 tests                                                                         | 沿原 C19/C30 接缝修来源缺陷（仅出现可复现缺陷时），不新增公开契约                                                         |
| IP-18       | apps/desktop/test/e2e/acceptance.mjs、client.spec.ts；playwright.desktop.config.ts                                                                                                                                                                                                             | D-28 输入与完整场景、trace；已有测试扩展，不增加产品 UI                                                                   |
| IP-19/IP-20 | scripts/acceptance/synthetic.mjs、synthetic.test.mjs、functional.mjs、functional.test.mjs；deployment/functional-run-config.example.json                                                                                                                                                       | 复用正式操作与三类观察，补必要程序缺陷及完整配置示例                                                                      |
| IP-21       | scripts/deployment/composition/risk-flow.mjs、risk-flow-composition.test.mjs；packages/adapters/src/workflow/postgres-workflow-adapter.ts、test/workflow/postgres-workflow-adapter.test.ts；apps/worker/src/risk-flow/runtime.ts、test/risk-flow/runtime.test.ts                               | 原因果定位/消费证明/短事务回执的范围内缺陷与回归                                                                          |
| IP-21       | scripts/deployment/backup.mjs、backup.test.mjs、restore.mjs、restore.test.mjs、lifecycle.mjs、lifecycle.test.mjs                                                                                                                                                                               | 有界停写/重启/恢复的范围内缺陷，保留原权限/事务/双根                                                                      |
| IP-21       | apps/web/test/browser/agent-audit-operations.spec.ts；apps/web/src/pages/AgentWorkbenchPage.tsx                                                                                                                                                                                                | 闭合本次慢读/切工程回归缺口；先修测试前置确定性，只有证实原取消/单在途契约缺陷时才修既有 owning 页面                      |
| IP-21       | apps/web/test/browser/assessment-warning-response.spec.ts；apps/web/src/shared/CommandConfirmationDialog.tsx；apps/web/src/components/ConfirmButton.css                                                                                                                                        | 闭合重评长信封确认按钮视口外不可点击的回归缺口；核对原组件/样式的有界滚动与自然操作，保留原确认、焦点、取消及冻结信封契约 |
| IP-22       | deployment/ACCEPTANCE.md、OPERATIONS.md；本 change tasks.md、handoff.md；新增本 change evidence/ 下安全报告和证据索引；verification.md 仅 Finalizer                                                                                                                                            | 只记录真实命令、终态/引用、失败和阶段移交；受保护原响应仍 C04                                                             |

实际部署/运行/秘密配置位于受控实例目录，不提交真实秘密。删除文件：无。保护：AGENTS 关键约束、全部归档规格/历史迁移、锁文件、执行图/Orca、研究原件、用户 dirty 改动、发布定义/预算/人工决定、前置 change 工程验收范围、MinerU 独立责任边界。

新公共字段、迁移、权限、事务、依赖、范围外文件、前置语义漂移或 CLI 不存在须升级并补 design；现有批准路径内普通缺陷在当前任务修复。没有对应修复需要时不为文案、提示词、DOM/CSS 或实现顺序补测试。实际环境缺项保留 BLOCKED，不删除关键断言或增加默认值。

## 8. 验收 Agent 授权与限定审计

### 本次批准的施工图补充（2026-10-14）

- IP-19/IP-21 / D-35：用户已批准定位分页、模型行动额度、失败实际结算，并授权提高新任务预算。纳入`packages/core/src/engineering-data/cleaning/schema.ts`、`service.ts`及既有`test/engineering-data/cleaning.test.ts`；D-34的cleaning runtime/store及既有测试、必要同目录fixture；纳入`packages/core/src/model/schema.ts`、`packages/core/src/agent-runtime/runtime.ts`及既有`test/model.test.ts`、`test/agent-runtime/agent-runtime.test.ts`；D-34的runner/C08 adapter及既有测试；纳入`packages/adapters/src/model/model-gateway-runtime.ts`、`network-api-model-gateway.ts`、`llamacpp-model-gateway.ts`及对应既有网关测试；start.mjs及entrypoints测试。同步本change清洗/Agent/模型网关delta与证据，在实例生成新冻结策略及发布配置。验证分页集合/上限/撤权/恢复、联网前额度拒绝、正常超限拒绝、失败超额真实记账及不再领取，再按新预算正式清洗16份原来源。没有依赖、迁移、业务HTTP字段、权限或质量策略变化；旧失败和预算不改写。

- IP-19/IP-21 / D-34：用户已批准清洗模型输入与失败恢复提案。修改 `apps/worker/src/engineering-data/cleaning/runtime.ts`、其既有runtime测试及必要的 `composition.ts`；修改 `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` 及既有store测试；在 `scripts/deployment/start.mjs` 和既有entrypoints测试装配可信定位/观察reader；修改 `apps/worker/src/agent-runtime/runner.ts` 及既有runner测试，必要时修 `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 及其既有测试。复用冻结输入和受权C04，不改公开DTO/HTTP、迁移、权限、依赖、白名单或预算。验证真实定位、同清单观察、集合外与撤权拒绝、消息超预算、失败重放及重复claim在原预算内收口，再恢复隔离Worker实跑；旧失败保留。

- IP-17/IP-19 / D-33：用户已批准 DOCX 标准XML字符引用修复。纳入 `packages/adapters/src/engineering-data/document-conversion/parsers.ts`、既有 `packages/adapters/test/engineering-data/document-conversion.test.ts` 与 `document-conversion/mineru/normalization.test.ts`；同步文档转换delta。复用XML库、保留DTD/ENTITY拒绝、包预算和源一致性。验证标准引用及数字引用正文、DOCX/MinerU匹配与不匹配拒绝、共享XLSX回归；再对原实机来源新转换取证。

- IP-21 / D-32：用户已批准 evidence/visible-read-scope-proposal.md。纳入 `apps/web/src/agent/AgentTaskProvider.tsx`、既有 `apps/web/test/browser/agent-audit-operations.spec.ts`；纳入 `packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`、既有 `packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`；必要的当前页二阶段声明在 `apps/web/src/api/operations.ts`。验证真实C06/C11/C04目录与正式清洗摘要、错误身份/撤权/损坏不泄露、单在途/切工程取消，再重建宿主并于原物理Chrome取证。只修当前读取接缝，不修改授权策略或既有业务事实。

- IP-19 / D-31：用户已批准模型父工件预检的 C04 接缝补充。新增当前 change 的 `specs/platform/content-addressed-artifact-store/spec.md`；修改 `packages/adapters/src/artifacts/index.ts` 的 `ContentAddressedArtifactStoreHandleV1/createContentAddressedArtifactStore`，暴露既有精确 `ArtifactManifestReaderV1`；扩展 `packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 的真实集成覆盖。修改 `scripts/deployment/start.mjs` 的基础宿主与模型工厂，父引用按本工程精确清单用途经原受权 open/verified 预检；扩展 `scripts/deployment/entrypoints.test.mjs` 覆盖用途不同、缺失、拒权、完整性失败阻止联网。验证：`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`、相关 build/typecheck/lint/format、strict/diff，以及隔离实例的新正式清洗调用。保留原失败、预算、权限、摘要和父继承；不增加依赖、迁移或远程宿主能力。范围提案与实际证据分别见 evidence/model-parent-preflight-scope-proposal.md、physical-documents-2026-10-14.md。

- IP-21：用户已授权将 `apps/web/src/main.tsx` 纳入文件清单，在生产入口导入已有 `theme/tokens.css` 与 `theme/global.css`，修复实机发现的主题令牌缺失和标题/指标卡重叠。复用现有样式，不改页面业务逻辑；重建 Web 并在同一物理 Chrome 窗口验证宽/窄视口和关键确认、切工程回归，记录实际证据。

- IP-18/IP-20：`functionalReportFile` 属桌面测试输入；在 `scripts/acceptance/functional.mjs` 复用现有摘要与有界读取核验同次报告，`apps/desktop/test/e2e/acceptance.mjs` 只消费正式回执中的精确引用。桌面预检读取原部署/发布环境路径，不凭兼容区间排序推断当前发布。
- IP-22：用户已批准仅精简 `openspec/specs/` 下 data/agent-cleaning-and-partial-availability、domain/module-interfaces-events-workflows、domain/monitoring-batches-snapshots-features、domain/response-recommendation、knowledge/structured-scoring-rules-and-applicable-rule-sets、operations/orchestration-controlled-actions、platform/content-addressed-artifact-store、platform/http-command-query-sse-shell、platform/llamacpp-model-gateway、platform/unified-bounded-agent-runtime、quality/evaluation-and-browser-acceptance、risk-assessment/engine 的 `spec.md`；全部原行为约束、Requirement 名称与既有场景保留。
- IP-22：用户已批准仅格式化 `packages/adapters/src/assessment-config/postgres-assessment-configuration-adapter.ts`、`packages/adapters/src/model/config.ts`、`packages/adapters/src/model/model-gateway-runtime.ts`、`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`、`packages/adapters/test/model/network-api-model-gateway.test.ts`。无行为改动，不增加测试。

全部当前 tasks 的行为和工程/真实证据均完成后，主调度按授权形成真实检查点，再交 Finalizer。Finalizer 基于本矩阵核验、范围内修复、回归及创建 verification，不改规格掩盖缺陷。security（秘密/联网资格/TLS/Electron）、persistence（原始响应/审计/检查点/恢复）、integration（来源/五任务/终态/人工确认）与必要的有界 performance 审计在同一收尾最多一次；发现普通缺陷由该活动 Task 闭合，不重复派发新审计。

- IP-21：用户已批准 `evidence/checkpoint-start-binding-scope-proposal.md`，纳入 `packages/adapters/src/postgres/transaction-unit.ts` 及既有 `test/postgres/postgres-foundation.test.ts`。启动绑定读取按生产命令/审计动作精确配对，保留完整引用、线程、主体、授权、父运行与提交证明；补真实配对和错配拒绝回归，继续原命令实机复验。不改公共契约、权限、事务、迁移或历史记录。

- IP-19/IP-21 / D-40：用户已批准检索投影与图版本提案。纳入 `packages/adapters/src/auth/postgres-local-identity-access.ts`、既有 `test/auth/local-identity-project-authorization.test.ts`，发布命令因果授权仅补hybrid-evidence精确分支并保持当前权限/有效期/关联；纳入 `apps/worker/src/risk-flow/graph.ts`，graphStateOf使用同运行冻结图版本，既有runtime测试校验真实检查点图版本。新增本change的local-identity-project-authorization delta；复用已列部署回归。先红后绿、build/lint/format/strict/diff后冻结新制品切换，继续真实检索及工作流，不改历史事实或投递次数。

未通过当前证据、待审计或主仓库门禁失败不得 PASS。C38 的未来物理平台/介质/硬件场景只登记移交状态，不能当作本 change 已通过任务，也不能用其缺项掩盖当前功能缺陷。
