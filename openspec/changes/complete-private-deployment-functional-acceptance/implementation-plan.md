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

D-117纳入IP-19/IP-21：adapters scoring-rules/postgres-scoring-rules-adapter.ts及既有同名test，包配置读取ID按本次授权/时刻与包引用共同派生，既有C18当前读/幂等不变；扩当前不同调用重复准备回归。工程后先无修订写诊断、再新正式命令，不改旧回执/版本/预算。

D-116生产装配补充：scripts/deployment/start.mjs及entrypoints.test.mjs新增原C07冲突review linker，当前分支/调用身份签发、精确关系投影与原策略引用，失败无link、重投幂等。无新增模块/依赖/迁移。

D-116纳入IP-19/IP-21：core scoring-rules/validation.ts及既有scoring-rules.test.ts，adapters scoring-rules/postgres-scoring-rules-adapter.ts及既有同名test，配置包审核前幂等补冲突链接；同ruleId明确候选替换声明基线时保留候选，仍强制C07逐项批准。不同规则原优先级保持，旧关系/修订不改。无公开DTO/依赖/迁移，工程后新修订和真实复核发布。

D-115纳入IP-19/IP-21：contracts/src/records/index.ts删除全域等级拒绝，既有contract-kernel及core/test/scoring-rules/scoring-rules.test.ts覆盖Schema、离散等值/未声明值/类型及全域重叠；复用原统一求值，不改评分阈值/分值。同步评分delta，工程验证及新制品后续D-114审核发布。

D-114纳入IP-17/IP-19合成输入修正：仅design/IP/handoff/证据及实例新规则CSV、登记/转换/包/候选/复核/发布与新准备回执。等级区间按design D-114，原阈值/分值及配置保持，复用C11/C19及统一求值器自检；无源码/依赖/迁移。正式新版本发布后再assess，旧失败与规则版本不变。

D-113纳入IP-19/IP-21：worker/src/assessment/graph.ts及既有runtime.test.ts，修正D-112直接复用为当前核验后经C11幂等冻结本次带运行因果的准备。复用同一冻结路径及完整原字段/证据/监测；不新增公开字段、依赖、迁移。匹配只冻结一次、错绑定零效果、原路线回归，工程检查后新制品和新正式输入再assess，保留旧终态/预算。

D-112纳入IP-17/IP-19/IP-21：文件范围与公开契约/边界见design D-112。contracts统一sourceFieldFacts数组与可选正式准备引用，core workflow门禁将准备纳入入口；C11冻结和回读真实字段/证据，C25合并准备输入而不扩风险记录，A0当前核验精确准备并复用。复用RiskInputFactFieldV1、C11证据/权限/C04/幂等、C25确定性取值；无新依赖/迁移。对应工程资料实际取值、评估准备重放/当前授权及精确入口场景。先契约/所属模块红绿及最小关联回归，再工程门禁、效果屏障和正式原资料值输入，原失败/预算/记录不改，不重复识别。

D-111纳入IP-17/IP-19输入范围：仅当前design/IP/handoff/证据与实例d111-monitoring-inputs新CSV/manifest、metadata/source/conversion/样本工件、五序列/策略及正式batch/snapshot回执。实际数值以design D-111为准，复用D-89/D-91原生产入口与原生解析/监测Schema；无源码/依赖/迁移/主规格变化。验证80格来源一致、五series/策略Schema、正式回执重放与快照稳定，原D-91快照及评分阈值不改；六类齐备仍不替代source-field事实与正式评估终态。

D-110纳入IP-19/IP-21：仅packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts和既有同名测试。evaluate复用准备范围当前C06上下文，删除与空资料身份增量的包含比较，明确拒绝redacted，保留所属输入/工件/提交前校验。对应确定性评估当前授权及事务场景。先红后绿，engine/风险事实/部署assessment-composition回归、build/typecheck/lint/format/deps/strict/diff，原冻结输入效果屏障探针先于正式新assess入口；原父子终态/准备/依据/输入和识别结果不改，不重开识别批次，无新依赖/迁移/公开DTO。

D-109纳入IP-17/IP-19/IP-21：仅packages/core/src/identification/candidate-finalization/service.ts与既有core候选测试、packages/adapters/src/identification/read/postgres-standardized-risk-input-facts-reader.ts与既有test/risk-assessment/postgres-risk-input-facts-reader.test.ts。C22登记来源与真实证据精确并集，reader由同条不可变登记推导并集、沿64项原上限并复验C06非redacted当前权限。对应正式风险事实投影/权限与追溯场景。先红后绿，运行核心候选、风险事实reader、部署配对测试，build/typecheck/lint/format/strict/diff；原首记录窄读和配对验证零业务写后，原C24正式resume，父终态保持，评估仅引用原正式记录的新assess-existing-risk入口。无新依赖/迁移/公开DTO。

D-108纳入IP-19/IP-21：修改packages/core/src/identification/candidate-finalization/{ports,service}.ts、packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts、apps/worker/src/identification/graph/graph.ts及既有core/test/identification/candidate-finalization.test.ts、adapter对应测试、worker graph fixture.ts/runtime.test.ts。内部写入结果携实际新增ID，混合批次校验旧摘要后只发新事件，回滚语义不依赖C03保留异常类，C24按精确引用去重；对应标准化风险记录与评估事件原子成立及分批复核场景。先红后绿，运行上述三套测试和nested-boundary、build/typecheck/lint/format/strict/diff，再原批次正式恢复并核对两条决定/首条记录不变、事件与记录各一次。无新依赖、迁移或公开DTO。

D-96纳入IP-19/IP-21，沿D-95四文件：runner内部模型步可选outputSchema交给原网关且保留registry复验，C15用冻结资料/快照精确引用收紧原动作Schema。测试验证真实资料引用通过、清单工件/其它来源/错版本/越界offset/未登记工具与无快照动作拒绝，以及runner使用收紧Schema而不跳过原解析。同步design/清洗delta/进度证据/handoff，实例清洗策略显式绑定同模型的function-call部署并升精确引用，数值预算/工具/质量不变。工程回归通过后先一次原冻结首步诊断止于工具/领域写入前，再正式新任务；旧v101失败保持。

D-95纳入IP-19/IP-21：Worker agent-runtime/runner.ts的内部模型步上下文和已完成工具事实重建，engineering-data/cleaning/runtime.ts的有界completedReads投影；仅扩对应既有两份runtime/runner测试。同步design、当前清洗与Agent局部delta、handoff及新增evidence/cleaning-read-progress-2026-10-16.md；实例新清洗policy/prompt/budget精确引用数值不变。先证明两个读取事实保留和恢复不重执行，再验证三来源精确分页/段/样本边界、未知/超限拒绝及原预算计量，运行两套/关联回归、build/typecheck/lint/format/deps/strict/diff。旧失败不恢复，原来源新任务另记正式证据，不新增依赖/HTTP/迁移或第二记忆。

D-94纳入IP-17/IP-19：源码仅provision.mjs的监测两步骤授权分支选择和provision.test.mjs既有参数化成功用例的所属分支断言。同步design/handoff及监测证据。先红后绿，运行provision全套、两文件lint/format及strict/diff；不改store、C06、公共字段或预算。旧AUTHORIZATION_DENIED预置回执保留，后续新runId/报告重试尚未写入的事实。

D-93纳入IP-17/IP-19输入配置范围：仅当前design/proposal/handoff、evidence/monitoring-longitudinal-2026-10-16.md和实例新策略目录/部署/发布/制品/清洗脚本与回执。新清洗版本补三份原生CSV实际质量引用、requiredSegmentKinds=table，保护类型和三个100%门槛、工具/模型/预算不变，精确差异按design。复用现有DataCleaningPolicyV1Schema及清洗纯函数/已有测试，原五资料快照不重复清洗。核对真实转换和段、Schema/确定性自检/strict/diff、同制品比较后以新命令发起新CSV任务；旧422保留。不改源码、主规格或用户资料。

D-92纳入IP-17/IP-19/IP-21实例配置范围：同步design/proposal/handoff、evidence/minimax-function-call-2026-10-16.md及新增evidence/confidence-policy-2026-10-16.md。实例新增置信度缺项策略及精确关联策略版本、目录/部署/发布/制品，正文差异限design D-92；复用原核心calculateCompositeConfidence/forcedReviewReasonFor与当前授权的C04读取，不改源码或主规格。先只读原v97全部分组/校验集并证明新策略可计算、未参与依据不伪造、强制人工复核保持；旧策略同输入仍应阻断。既有Schema自检、相关核心置信度回归、strict/diff、制品身份比较后切换正常生产宿主。独立新批次正式继续，旧终态/预算不重写，不自动连续重开运行。

D-101纳入IP-19原C17文件范围：只改identification-knowledge/postgres-identification-knowledge-adapter.ts及其既有测试。旧发布条目补登记分支通过原#authorize签发identification-basis，精确调用原readExact，原hybrid授权保留给可见来源过滤。已有用例模拟旧发布空投影，先验证拒权零登记，再验证合法重建/重复读取和原批准正文一致；保留未知发布/撤权覆盖。新制品先对真实旧发布有界取证，不恢复v106父子终态，不把工程回归计完整业务PASS。与design D-101及减负D-05旧发布条目语义对应，无公共契约、依赖或迁移变化。

D-102纳入IP-19原C24图与runtime测试/fixture范围：submitGroupAcceptance无已决引用时本轮零收口，沿现有pendingGroupRefs与human-review等待。fixture的finalize按生产Schema解析，新全待定用例先红，再回归完整runtime与nested-boundary、C22候选收口。对应主规格识别仍有待复核组不得完成的Scenario，不改公开accept-groups契约或人工决定。保留v107五项I5、I6、I7与复核任务及终态，原模型预算不改。

D-103纳入IP-19已有C24 adapter及测试范围：validatedCandidateSetRefsFor以I5.failedCandidateSetRef判别失败资格，只返回成功结果；不按引用前缀判断。扩展原精确C21/C22读用例混合成功/失败I5，先红后绿，并回归adapter与C22合并契约。真实v108工作计划投影与游标三份成功集合只读对账，保留两个失败项、原终态和严格整集校验。与主规格失败工作项不阻止其它合格工作项处理的行为对齐，无公共契约或依赖/迁移变化。

D-104纳入IP-19已有C21 runtime及其既有runtime.test.ts范围：只在可信渲染的outputSchema中以受权当前集合引用/版本收紧原动作生成Schema；补搜后取当前版本，不改interpret、registry动作Schema或成员/证据/权限校验。父Agent实现，辅助implementer只持有单测试文件，覆盖当前值合法、错绑定拒绝与补搜版本；生产回归后原v109冻结输入一次诊断，不推进旧任务。关联design D-104和检索审阅有界输入要求，不增加公开字段/依赖/迁移或模型预算。

D-105经用户批准纳入IP-19：packages/contracts/src/ports/index.ts与test/contract-kernel.test.ts新增strict agent-task-failed原因（仅retrieval-review/embedded精确taskRef）；packages/core/src/identification/graph/ports.ts、apps/worker/src/identification/graph/{graph,runtime}.ts与risk-flow/{graph,runtime}.ts接C30转交和C24精确终态/身份/等待绑定，复用既有C08 getTask及I3失败收口，不新增部署接缝。既有C24 runtime.test.ts/必要fixture及nested-boundary、C30 runtime.test.ts覆盖真实失败、非终态/错绑定/撤权拒绝、父技术重试转交、原成功项和命令幂等；辅助implementer仅持有C24测试。验证pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts apps/worker/test/identification/graph/runtime.test.ts apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/risk-flow/runtime.test.ts，及build/typecheck/定向lint/format/change strict/diff。关联domain/module-interfaces-events-workflows、identification/graph、relationship-context-and-retrieval-agent-review新增失败通知场景。新制品仅沿原v109父等待正式HTTP通知第四项失败、处理原第五项；不伪造结果、不复活终态、不重开整批，无依赖/迁移变化。

D-106纳入IP-21，源范围见design D-106：contracts统一任务身份引用，core/review-audit/ui-read.ts的taskDetailPayload接受精确身份，adapter #taskState复用单点查询和原事实/完整引用绑定，前端useLocatedReviewTask直接readReviewTaskDetail，移除队列反查及页外缺席状态，两页沿受权完整详情构造原决定引用。现有核心review-audit.test.ts和adapter既有精确定位测试加最小身份/错版本，真实Chrome页外任务已红。验证pnpm exec vitest run packages/core/test/review-audit/review-audit.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts、pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts -g '识别分组复核'，以及build/typecheck/lint/format/strict/diff与v109原8组物理深链/决定。无全库/队列扫描、迁移或依赖变化。当前C19 resolver已具备减负后的自动确定性组装，旧交接里需提前人工派生发布的说明仅作历史；以当前代码/实际回执继续验收。

D-107纳入IP-19/IP-21，文件限packages/adapters/src/workflow/postgres-workflow-adapter.ts及其既有test/workflow/postgres-workflow-adapter.test.ts。readEventParentRun/#eventState/verifyEventConsumption以当前权限与真实父子/运行/消费事实取代历史全scope摘要相等，#eventState按原preparing阶段精确根入口登记limit2验证当前空间覆盖。现有事件测试加来源授权变化与真实错空间拒绝，并保留所有现有拒权/错版/零写；验证pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts scripts/deployment/risk-flow-composition.test.mjs及build/typecheck/lint/format/change strict/diff。真实原事件diagnose-accepted-event-v112.mjs使用effects屏障，旧实现WORKFLOW_EVENT_PARENT_UNPROVEN为红，修后到DIAGNOSTIC_NO_BUSINESS_EFFECTS为绿，原exhausted/10不变。新制品以原批次其余7组真实决定事件继续，不重开运行/重放旧exhausted，不把读证明计业务通过。

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

生产 Schema、错误码、图状态、C03/C04/C06/C08/C19 事务和版本沿既有事实源，数据库最终迁移为已归档减负change的000059。本 change 不增加生产迁移、表或第二引用登记；公开契约补充按已批准D-ID落实。三类终态观察：Agent 任务详情、识别运行详情、运行总览投影；Unsupported DTO 保持 BLOCKED。全链其他引用从正式所属查询与已登记关系逐项证明，不给任意 query 添加通用 status 判定。

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

### D-97已批准施工补充

IP-19/IP-21依必要修正持续授权，补无逐段evidence工件的资料授权解析：修改`packages/core/src/access/authorization.ts`内部业务输入、`packages/adapters/src/auth/postgres-local-identity-access.ts`所属grant到来源映射及当前/任务范围检查、`scripts/deployment/start.mjs`工件与模型接缝；仅扩既有`packages/adapters/test/auth/local-identity-project-authorization.test.ts`和`scripts/deployment/entrypoints.test.mjs`。验证无evidence受限工件、写入/模型限制保留，未知/跨工程grant、撤权与任务越界拒绝；定向回归、build/typecheck/lint/format/strict通过后新制品取证。无HTTP/core领域Schema、依赖、迁移、角色或预算变化，v103失败及旧终态保留。

## 8. 验收 Agent 授权与限定审计

IP-19/IP-21依持续授权纳入D-100，仅修改`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`完成准备的当前权限复验，删除完整授权快照全等，保留脱敏/权限/绑定及事务；扩既有`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`完成用例验证有效增量及原拒绝/并发。定向回归与工程检查后新制品沿原v105 completed任务收口，不新增模型任务、依赖、迁移或公共契约。

IP-19的D-98串行提示诊断失败，未修改生产runtime，也不发布该提示。D-99仅增加隔离实例新清洗policy/prompt/budget、catalog及发布身份：固定既有同模型schema-prompt部署，当前短选项Schema、Zod、工具与数值预算保持。先一次冻结输入诊断，通过后新配置按原Schema及预算深比较、冻结新制品并正式新任务取证。无生产源码或新测试文件、HTTP/领域Schema、依赖、迁移或权限变化，旧失败与实际用量保留。

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

- IP-19/IP-21 / D-118：C06既有filterVisibleSources增加可选risk-assessment.read分支并按当前事实判断；C34共享查询从请求实际记录准备取得有界来源，在分页/聚合前过滤。精确查询先绑定目标，删除工件读取的旧增量子集门禁，C04当前来源检查保持。范围core/access/service.ts、adapters/src/auth/postgres-local-identity-access.ts、adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts及既有auth/engine测试。本change评估delta与证据同步，无依赖/迁移。复用既有正式解释、5001可见/隐藏分页和撤权测试，补空增量；部署后只读原v121记录，不重跑评分。A7建议缺类别绑定另行处理，不计通过。

- IP-19/IP-21 / D-119：C30入口元数据读区分workflow运行摘要和A0准备引用；用原workflowEntryIdentityFor及登记frozenRefs复核运行，inputSnapshotRef与准备身份单独核对。仅adapters/src/workflow/postgres-workflow-adapter.ts、既有workflow测试和risk-assessment/fixture.ts。扩既有入口元数据用例覆盖真实两身份及错配拒绝，保留全部历史记录和终态，新制品只读原记录取证，无DTO/依赖/迁移。

- IP-19 / D-120：只新增实例response-generation精确类别绑定及不可变catalog/config/release；使用已发布measure-01，不改模型预算或三项校验。原评估/预警任务沿公开measure-candidates、start-task、create-candidate、validate-and-record接续并记录正式结果。真实未解析触发项/覆盖/现场或规范缺项必须拒绝，拒绝不计完整链通过；不重跑原评分。无生产源码/DTO/依赖/迁移，证据在d120-response-inputs及本change evidence/handoff。

- IP-17/IP-19 / D-121：scripts/deployment/composition/api-ports.mjs将公开measure-candidates查询交C27既有方法，保留其它知识端口receiver；既有必需方法清单补measureCandidates。扩scripts/deployment/api-ports.test.mjs原分派回归，对象/结果原样传递和缺方法拒绝；无DTO/路由/依赖/迁移。新制品后原预警任务查询接续，原426无Agent或候选，不算通过。

- IP-19 / D-122：response-model-step.mjs删除历史授权完整JSON/空间版本集合全等，保留来源存在/主体/工程、当前C06能力和redacted及任务冻结范围；原所属数据精确绑定检查保持。扩response-model-step.test.mjs已有C27/C29用例，覆盖新时间/空来源增量仍正常及错主体/缺权拒绝。新制品只以新任务身份消费原冻结措施查询，原v124零模型调用终态保留；无DTO/依赖/迁移。

- IP-19 / D-123：composition/assessment.mjs将C27 {task,purpose}写授权请求映射到原受信envelope工程/主体/空间和固定create-candidate分支、taskId:purpose；start.mjs注入，原活动任务来源上界保持。既有assessment-composition.test.mjs扩两purpose映射回归并保留宿主检查。新任务消费原候选，v125一模型失败与终态保持；无DTO/依赖/迁移/预算变化。

- IP-19 / D-124：实例新增正式recommendation-site-context用途工件，原风险node02/C17正式process-model来源和原提供node02合成现场场景绑定真实空间、资料段；不添加通关资源。只更新新config/release的siteContextBindings，复用v126制品，旧候选/现场保留，策略/模型/预算不改。查原校验效果后以新命令及新现场引用继续原正式候选校验，专业失败如实记录，无源码/DTO/依赖/迁移。

- IP-19 / D-125：composition/assessment.mjs仅补C27 reviewAudit: review，使用原已要求的C07端口。复用adapters/test/recommendation/postgres-recommendation-adapter.test.ts及assessment-composition/entrypoints测试，覆盖失败快照、待复核、事务回滚与同reviewRef重放。新命令仍原候选/现场及原三项校验，不调用模型、不修改失败或正式评分；旧422零业务行证据保留，无DTO/依赖/迁移。

- IP-19 / D-126：实例新增独立单风险等级预警合成场景来源、六监测序列/可用性策略、新措施配置修订及正式审核发布、新校验策略和新评估/处置命令。原八阈值/联合规则/矩阵/评分/126kPa与地层事实、模型预算和原现场资源不变。使用原C04/C11原生CSV、C18/C16/C07和现有公开处置入口；逐格证明新措施、许可及监测值来自已登记合成来源，姿态按100ms真实采样计算频率。原四预警/失败/拒绝保持，不复活原评估。无生产源码/DTO/迁移/依赖；输入生成留assert自检，正式每步保留精确回执和实际结果。覆盖主规格“单独风险等级预警可形成正式建议”，不能提前勾选3.2。

- IP-19/IP-21 / D-127：apps/worker/src/identification/graph/composition.ts及既有composition.test.ts，既有幂等消费中仅identification-group进入C24授权/恢复；其它四类C07决定以原reviewDecisionRef形成无识别动作耐久回执。未知事件、当前来源复验和识别授权失败保持拒绝；原response事件exhausted/10不重置。参数化既有测试先红后绿，再识别runtime/部署回归与build/typecheck/lint/strict/diff，新制品的新合法事件取证，无DTO/迁移/依赖/权限变化。

- IP-19 / D-128：scripts/deployment/start.mjs的C04包装器按精确kind/entityId/versionId合并多父工件空间并集，扩既有entrypoints.test.mjs共享空间回归；当前C06/资料及各父访问检查保持。先红后绿、build/typecheck/lint/strict/diff，再新制品/新put命令核验原D126候选，不改旧失败、Schema、依赖、迁移或权限。

- IP-19/IP-21 / D-129：packages/adapters/src/workflow/postgres-workflow-adapter.ts的readAssessmentEntrySnapshot复用现有#openBody当前C04读取，保留唯一A0及精确正文归属，去掉历史scope摘要全等；扩既有workflow测试的A0夹具为正式C04正文及当前来源增量变化回归。验证错工程/阶段/缺正文/多义/撤权拒绝，workflow与assessment runtime回归及build/typecheck/lint/strict/diff；部署后以原completed Agent及原retryable父/等待子继续，禁止新评估/Agent替代，无DTO/依赖/迁移。

- IP-19 / D-130：scripts/deployment/provision.mjs及既有provision.test.mjs，原样投影C04真实artifactRef，参数化content/diagnostic临时文件回执，相关provision测试/lint/format/strict/diff；保留旧错误报告，恢复另取当前C04正式引用，无DTO/权限/依赖/迁移变化。

- IP-19/IP-21 / D-131：apps/worker/src/risk-flow/{graph,runtime}.ts及既有runtime.test.ts，统一评估恢复上下文并复用原聚合恢复通路，将公开agent-task-completed完整引用转交给等待同一任务的原评估子运行，按冻结身份、当前版本及当前权限恢复后回读。错任务拒绝，兄弟及终态不推进；配置/识别恢复保持。先红后绿、相关runtime回归/build/typecheck/lint/strict/diff，新制品后仅以新命令消费原completed任务，无新模型/预算/DTO/依赖/迁移。

- IP-19/IP-21 / D-132：将C24已有executableConfig移至apps/worker/src/graph-execution.ts，C24/C25图包装器复用，全部执行/回读固定本图saver及根命名空间、清空父checkpoint_id/map/scratchpad。既有assessment/runtime测试新增真实父MemorySaver调用真实PG子图的等待/独立回读/恢复回归，并跑C24 nested-boundary与相关runtime/build/typecheck/lint/deps/strict/diff。原A7旧命名空间检查点按design逐项核验，经原getTuple和graph.recover受控接续同一等待状态，业务/模型写屏障、保留旧记录，禁止自动猜测或重评。新制品只继续原completed任务，无DTO/依赖/迁移/权限/预算变化。

- IP-19/IP-21 / D-133：scripts/deployment/composition/assessment.mjs及既有assessment-composition.test.mjs，复用core/agent-runtime.agentTaskRefFor先精确观察已有任务，当前授权检查保持，仅缺任务才start；共享observe验证原冻结身份/策略/主体/父及真实终态，不重复读已取得快照。先红后绿验证当前授权变化不重启原completed、错身份/失败/缺任务边界，组合/entrypoints/lint/format/strict/diff后新制品。原v134终态保留，父沿公开入口消费已成立候选，不新评估/Agent，无DTO/依赖/迁移/预算变化。

- IP-19/IP-21 / D-134：实例新config/release将forecastPolicyReleaseRef绑定已实际发布的050053b0…@1，当前权限窄读证明工程/类型，沿原预测0217dc68…当前版本business-preparation-ready恢复，不改策略正文/评分/建议/决定/模型/预算。参数模型不存在如实不可用，保留旧引用及等待；无源码/DTO/依赖/迁移。

- IP-19/IP-21 / D-135：实例d135-response-followup新增模型声明、合成执行/反馈和执行后监测CSV；C11正式转换逐格核对、C04真实父/来源生成显式零措施效果趋势模型与反馈工件，C18/C16/C07发布精确requiredRef的新单目标预测政策，业务有效时刻与真实系统时刻分别保存。新config绑定后只恢复原A0等待；执行后六监测正式快照及同风险原规则确定性评估，再反馈/偏差/原预算C29候选与人工复核。原评分/阈值/资源/终态不改，无代码/依赖/迁移/预算变化，所有合成样本待甲方复核并保留失败。

- IP-19/IP-21 / D-136：apps/worker/src/risk-flow/runtime.ts及原runtime.test.ts C41/S2，仅当前human-decision等待阻断其它原因，历史采纳等待不拦后续精确business-preparation恢复；保留首次C41证明与唯一等待/版本/权限检查。扩原采纳后配置等待接续测试，相关runtime/build/typecheck/lint/strict/diff后新制品续原预测，无DTO/依赖/迁移/预算变化。

- IP-19/IP-21 / D-137：scripts/deployment/composition/assessment.mjs及原assessment-composition.test.mjs，阶段查询ID摘要包含指定发布及当前入口授权context/time，保留requestId=幂等键=签发身份、冻结requiredAt/当前asOf。扩既有专用预测配置用例同调用重放和新当前上下文不冲突，部署回归/lint/format/strict/diff后新制品续原A0，无DTO/依赖/迁移/预算变化。

- IP-19/IP-21 / D-138：packages/core/src/response-lifecycle/schema.ts模型精度上限复用既有规范十进制6位常量，扩原core/test/response-lifecycle/forecast.test.ts非法模型表，相关core/adapter模型回归及build/typecheck/lint/strict/diff。实例新6位声明来源及模型C04、新政策来源含实际requiredRef，保留8位输入/工件和失败；无依赖/迁移/预算或其它数值域变化。

- IP-19/IP-21 / D-139：core/response-lifecycle/service.ts及adapters/response-lifecycle/postgres-response-lifecycle-adapter.ts集中C19当前受权精确集合读取，反馈按评分规则/assessment配置完整冻结成员及适用集正文除requiredAt外全部结构判断相容；适用集经当前C04原用途及原摘要校验，保留不同准备/集合/适用集/时间与原风险空间监测校验。扩既有response-lifecycle测试/fixture同成员异集合成功、配置/适用决定变化或不可读拒绝及零部分写；相关反馈/偏差回归/build/typecheck/lint/strict/diff后新制品，新正式C11准备/正常assess形成实际评估，不通过历史回填绕过。无HTTP字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-140：实例新增单一绝对偏差政策CSV及候选，原threshold2mm不改，C11逐格核验/C04/C18/C16/C07正式审核发布，新反馈首次按purpose=deviation冻结；新config/release校准目标仅绑定原依据已包含的monitoring-warning-threshold de2a8b10…@1。先当前受权窄读、保留旧三政策/占位/失败，实际偏差决定C29及人工复核，不提前宣称生效。无生产代码/字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-141：adapters/src/workflow/postgres-workflow-adapter.ts及既有workflow测试，运行读面在当前C06/C04及精确父子链边通过后，按精确运行有界读取历史阶段/结果，删除历史scopeDigest过滤及闲置参数。扩原唯一子运行夹具覆盖阶段/链边/最新状态不同摘要，缺链/错归属/错版/撤权仍拒绝。相关workflow/C25/runtime/build/typecheck/lint/strict/diff后新制品，只读原completed预测公开200及完整阶段，不重算或补写历史。无字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-142：core/response-lifecycle/service.ts、core/human-decision-feedback/service.ts、adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts及既有C41测试，增加当前受权正式预测基线窄读，反馈分段固定原预测输入/依据，实际反馈仍新实际评估；启动身份按原命令及固定载荷派生，原committed快照重放后仅启动新正确分段，旧终态及唯一反馈保持。扩真实预测/独立后评估/重放零重复回归，相关C28/C41/build/typecheck/lint/strict/diff后新制品原载荷重放；无HTTP字段/迁移/依赖/预算变化。

- IP-19/IP-21 / D-143：scripts/deployment/start.mjs及既有entrypoints.test.mjs，部署首个人员入口以readSession确定当前主体，再authorizeBusinessAction当前业务权限，捕获原作用域；不复用旧authorize的invocationId五分钟记录。验证旧authorize不可用下原调用重放、失效会话/真实拒权零下游，定向宿主/lint/format/deps/strict/diff及新制品后原信封重放，旧context/TTL/失败/唯一反馈保持。无字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-144：scripts/deployment/composition/{assessment,calibration-task}.mjs、start.mjs及既有assessment-composition/calibration-task测试，外层policyRef传C29与Agent入口，内层validationPolicyRef留C08信封；task port注入精确policyCatalog解析共享Schema并核验两身份及工程对应，当前权限/输入/预算校验保持。定向assessment-composition/calibration-task/response-model-step/entrypoints、lint/format/deps/strict/diff后新制品及riskFlow/assessment真实新图版本physical-20261017-d144-v1，以原反馈信封消费唯一反馈和偏差，旧两个terminal运行不重开。不改公共字段/依赖/迁移/预算，不重算原业务事实。

- IP-19 / D-145：packages/core/src/engineering-data/monitoring/features.ts及既有packages/core/test/engineering-data/monitoring.test.ts，恒值频谱返回no-dominant-frequency，先红后绿覆盖16点6.8/100ms/零功率与原整数。保留原非恒值算法及数值/连续性检查，相关core/monitoring adapter回归/build/typecheck/lint/strict/diff后新制品，以新频谱算法策略创建独立快照复用原样本核验，保留旧快照/业务引用。无字段/依赖/迁移/阈值变化。

- IP-19/IP-21 / D-146：adapters/src/calibration/postgres-calibration-adapter.ts及既有C29测试、scripts/deployment/composition/assessment.mjs、start.mjs及assessment-composition测试；冻结输入/治理候选继承真实基准父工件和事实/候选证据，任务前精确输入manifest绑定并通过当前C06冻结实际来源及grant。保留任务来源上界，空/错清单或当前拒权零启动。C29/部署相关回归/build/typecheck/lint/deps/strict/diff后新制品及d146图版本；原失败任务不支持retrieval专用通知，400保留，公开取消原等待运行，再沿公开record-response-feedback工作流启动新独立后续运行，原唯一反馈/偏差和旧终态保持。无公共字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-147：apps/worker/src/agent-runtime/runner.ts及既有runner.test.ts，可修复模型校验失败推进新行动身份、保留原失败及工件，行动游标从序号1重建，不由候选版本代替；新纠错预留原累计corrections预算并保留验证反馈，技术失败原行动重试不变。连续claim既有测试扩展、runner/adapter相关回归/build/typecheck/lint/deps/strict/diff后新制品/真实新图版本，取消旧等待运行并以原反馈/偏差新独立后续运行取证。无字段/依赖/迁移/预算变化。

- IP-19/IP-21 / D-148：scripts/deployment/composition/response-model-step.mjs及既有response-model-step.test.mjs，C29生成Schema沿原actionSchema.safeExtend固定taskRef/inputSnapshotRef/可信完整completed结果，将确定性候选身份及绑定明确提供模型。专业字段仍由模型及原校验决定，原DTO/解释器/预算不变。扩原输入测试验证合法生成、缺主输出及错绑定拒绝，相关模型步/校准/宿主/lint/format/deps/strict/diff后新制品/新图版本，取消旧等待运行后原反馈/偏差独立后续取证。

- IP-19/IP-21 / D-149：adapters/src/calibration/postgres-calibration-adapter.ts及既有calibration测试/fixture，检查点信任所属当前C06决定，结果以共享Schema/completed/完整task绑定及精确result引用核验，允许候选提交与finalize主输出/校验元数据差异。扩原检查点合法差异/错任务/错结果及原拒权/归属零写边界，C29/graph/build/typecheck/lint/deps/strict/diff后新制品，只读原正式建议及偏差并继续人工复核，零新模型/重复建议；原terminal图保持且不冒称completed。

- IP-18 / D-150：apps/desktop/test/e2e/acceptance.mjs删除历史后端迁移号常量，client.spec.ts原预检夹具使用000059先红后绿，保留当前清单/release/config/code/origin/正式报告与输入边界，数据库由正式服务器按清单验证；同步本施工图当前迁移事实。不改生产代码/依赖/迁移，预检不替代完整Electron实跑。

- IP-18/IP-20 / D-151：scripts/acceptance/synthetic.mjs及既有synthetic.test.mjs、apps/desktop/test/e2e/{acceptance.mjs,client.spec.ts}，正式Schema验证后的异步waiting记submitted并从真实回执统一捕获引用，非异步/缺ref/失败仍拒绝。桌面可绑定同次agentTaskRef，运行waiting时仅当前正式任务queued/running才可验证关窗继续，最终仍要求原运行completed。既有异步/桌面边界回归、lint/format/strict/diff及真实场景取证，无生产契约/预算/依赖/迁移变化。

- IP-19 / D-152：adapters/identification-knowledge/postgres-identification-knowledge-adapter.ts、Worker identification-knowledge/{runtime,composition}.ts及既有测试，沿当前C04读取冻结清单定位与所属工具观察；核验完整任务/清单绑定，正文仅来自原白名单工具，模型消费真实观察及目标质量约束。基线观察提供原精确包/摘要，单次输出有界而累计预算保持。相关C17/runtime/组合根、build/typecheck/lint/deps/strict/diff及新制品后真实取证，不新增HTTP/工具/依赖/迁移，不复活旧图或伪造父引用。

- IP-19 / D-153：C17 adapter及既有fixture/test保留当前入口复验，再沿注入authorize按真实声明范围取得当前分支上下文，拒绝redacted/撤权；finalizer透传manifest基线给C16。fixture模拟空来源verify先红后绿，扩已有发布基线的同项目编制提交；相关C17/宿主/build/typecheck/lint/deps/strict/diff后新制品及真实新任务，原失败与预算不改，无HTTP/字段/依赖/迁移变化。

- IP-18/IP-20 / D-154：apps/desktop/test/e2e/{acceptance.mjs,client.spec.ts}以同份functional配置观察的唯一正式启动回执绑定运行，sharedObjectUrl独立绑定同次risk-overview查询，下载回执核验export请求sourceRef等于该查询。原夹具补真实run-view/overview双查询及引用模板，边界回归/格式/strict/diff后真实Electron取证；无生产契约/依赖/迁移变化。

- IP-19 / D-155：C17 #validateAuthoringCandidate仅把C08校验工件用途改为agent-validation，保留C17包校验用途及C08严格用途守卫；Worker runtime说明已有目标须先退役再声明。既有C17测试核验accepted/repairable两类工件manifest用途，相关C08/runtime/宿主回归、build/typecheck/lint/deps/strict/diff后新制品新任务，旧终态与预算保持，无Schema/依赖/迁移/预算变化。

- IP-19 / D-156：Worker identification-knowledge/runtime.ts及既有runtime.test.ts对模型成员定位使用公共前缀/全部后缀无损投影，复用正式Schema限定当前目标与下一候选版本，保持两工具/解释器/原manifest/DTO及预算；同步composition.test.ts按正式分支能力签发的C06夹具及目标读取断言，不固定内部当前授权调用次数。验证完整往返、重复定位缩小、异目标/版本拒绝，相关回归/build/typecheck/lint/deps/strict/diff后新制品新任务；原v150用量/终态不改，无依赖/迁移/公共Schema变化。

- IP-19/IP-20 / D-157：共享start.mjs/actionDecision复用上下文时从C06精确元数据按原上下文自己的空间/来源复验，显式非空/新授权空集合保持，未知ref和当前撤权拒绝，task/租约及审计不变；删除C17重复current-scope补签及其专用fixture，保留所有绑定/基线/用途约束。根入口、C17/C35/宿主回归及build/typecheck/lint/deps/strict/diff后新制品重读原报告来源；无公共Schema/依赖/迁移/预算变化。

- IP-19 / D-158：apps/worker/src/agent-runtime/runner.ts及既有runner.test.ts使用独立稳定agent-action-result反馈工件保留原证据链，当前受权恢复精确任务/行动绑定的最新拒绝候选和完整校验，通用模型上下文跨工具/claim保持；旧reason-only行动保持。覆盖证据保存/恢复/错任务拒绝及原预算边界，相关回归/build/typecheck/lint/format/deps/strict/diff后新制品；无依赖/迁移/公共Schema变化，旧失败与预算不改。

- IP-20 / D-159：packages/core/src/workflow/report.ts预览nextCursor复用C31的IdentifierSchema，既有packages/adapters/test/workflow/postgres-report-export.test.ts验证真实长引用游标/续页与预览Schema往返，不改历史登记/分页预算/编码；工程检查后新制品实机重新登记真实查询并预览/导出/下载。

- IP-19 / D-160：C17 adapter的逐attempt运行回调和真实当前C16基线，既有adapter测试扩已发布定义失败送审；scripts/deployment/start.mjs从精确任务信封核验主体/工程/任务建立独立控制来源，既有entrypoints.test.mjs覆盖绑定与拒绝。当前重授权/C08公共失败窄读/不可发布绑定/CAS保持；回归/build/typecheck/lint/format/deps/strict/diff后实机收口原失败，不复活任务、不改manifest或预算，无依赖/迁移/公共DTO。

- IP-19 / D-161：C17 adapter准备读取器抽取既有规范正文核验的精确JSON-LD/证据片段/文本块读，segment工具返回原textBlocks/sourceVersionRef；既有adapter测试核验真实块/定位/置信度及错版/排除/无权，规范正文检查共用同一实现。回归/build/typecheck/lint/format/deps/strict/diff后新制品/独立任务，无新工具/依赖/迁移/预算，旧终态保持。

- IP-19/IP-20 / D-162：C22 postgres-risk-record-trace-reader.ts按既有000054登记空间/来源经C06业务动作检查当前权限，移除历史完整授权摘要全等前置，同批相同资源复用决定；既有C22 adapter测试和Worker risk-flow acceptance夹具覆盖真实当前可见性/撤权/缺元数据/错版/额外授权及原批量边界。C22/报告/Worker及工程验证后新制品重读原第15页和完整报告，不改旧数据，无依赖/迁移/领域Schema变化。

- IP-19 / D-163：apps/worker/src/identification-knowledge/runtime.ts及既有runtime.test.ts对已受权segment观察按正式TextBlock Schema投影完整text/真实坐标置信度/块与段引用，模型输入去掉重复请求段ID与内部块链，完整原证据不变；提供真实剩余额度。回归/原v154输入离线大小和正文一致性证明、工程验证后新制品/独立任务，不扩预算，无依赖/迁移/公共DTO。

- IP-21 / D-164：apps/web/test/browser/business-server.mjs、demo/test/browser/server.mjs公共报告chain-a/b仅引用实际可读recordAuto/A，受限B及原人工复核识别/证据夹具不变；不更改权限或生产代码，不删场景，先重跑公共初始化及完整90项browser后记录真实结果。

- IP-17/IP-19 / D-165：按已批准预算重分配提案，新建隔离宿主catalog/config，追加knowledge-budget与knowledge-validation@physical-20261017-d165-v1，输入229376/输出32768，总和及context262144、其它上限/模型/工具不变，保留旧catalog条目与七失败。正式Schema与配置差异自检、工程strict/diff后新制品/新独立任务，实机核验终态与预算；无代码/依赖/迁移/公共Schema变化。

- IP-19/IP-21 / D-166：packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts私有putDecisionArtifact按decision行动签发当前evaluate上下文，使用已验证空间和部署受控来源，C04继续核验全部规则父工件；并发回读复用该授权。既有C25权限/幂等用例及browser真实初评先定向回归，再完整browser；无公共DTO/依赖/迁移变化。

- IP-20 / D-167：scripts/acceptance/synthetic.mjs私有requestJson按受限目标URL发送同源Origin；现有synthetic.test.mjs替身遵守API的Origin检查，synthetic/functional既有回归及真实functional CLI验证，保留首次登录400零业务写的报告。无公开Schema/依赖/迁移变化。

- IP-20 / D-168：scripts/acceptance/functional.mjs追加既有risk-assessment.read/run-read观察，严格同次runRef与正式run-result引用白名单，stateVersion独立；functional.test.mjs覆盖错运行/错版本/辅助引用拒绝及真实CLI。保留原C31严格观察，无生产DTO/依赖/迁移变化。

- IP-19/IP-21 / D-169：C25 adapter共享artifactReadAuthorization删除显式空requestedSourceVersionRefs，沿部署原调用来源签发当前读取授权，保持已验证空间与C04来源核验；现有C25权限回归及browser启动运行详情验证，不添加全库来源查找或重复完整快照比对。

- IP-19/IP-21 / D-170：C29 adapter共享putArtifact复用core/artifacts.normalizeEvidenceReferences，适配合法重复领域证据到C04规范集合；扩已有校准准备/幂等/继承测试，并重跑真实反馈校准browser，不改原事实/Schema/依赖/迁移。

- IP-18 / D-171：apps/desktop/test/e2e/client.spec.ts私有readRunStatusV1复用C34所属run-read，原运行引用精确匹配后读顶层status，删除两次C31登记/读页及JSON.stringify身份比对；原关窗继续/SSE等真实Electron场景验证，不放宽在途与终态要求。

- IP-18 / D-172：client.spec.ts共享launchClientV1通过Node createRequire从apps/desktop/package.json解析已声明electron并传给executablePath；不依赖根workspace的未声明依赖，不改产品、不安装依赖，沿原14项真实Electron场景验证。

- IP-18 / D-173：apps/desktop/src/main.ts的did-fail-load仅对主框架非-3失败展示连接页，首屏loadURL拒绝同样忽略ERR_ABORTED的errno=-3。沿既有真实导航/TLS场景及原生复现验证，不放宽导航、证书、子框架或权限边界。

- IP-18/IP-21 / D-174：apps/web/src/api/client.ts的postQuery复用现有来源选择，向projection.report-read转发用户声明；原agent-audit-operations.spec.ts报告用例验证history/preview/artifact请求来源；acceptance.mjs从已匹配overview回执保留reportSourceVersionRefs，client.spec.ts登录后通过产品选择UI声明该同次来源，导航断言用原isVisible避免等待已取消的导航；保留真实下载和权限边界。

- IP-18/IP-21 / D-175：apps/api/src/http.ts集中既有运行编码上限2048，app.ts路由参数上限复用该值；扩原http-shell.test.ts逐事件授权用例为真实长引用，验证入口不先于公开契约拒绝，原解码/权限/游标边界保留。

- IP-18 / D-176：client.spec.ts的queryV1允许显式来源，撤权用例读取同次报告时使用reportSourceVersionRefs；修订helper按真实“确认执行”及目录结果等待，仅已执行撤权才在finally恢复。沿原用例验证，不改产品权限或添加恢复分支。

未通过当前证据、待审计或主仓库门禁失败不得 PASS。C38 的未来物理平台/介质/硬件场景只登记移交状态，不能当作本 change 已通过任务，也不能用其缺项掩盖当前功能缺陷。
