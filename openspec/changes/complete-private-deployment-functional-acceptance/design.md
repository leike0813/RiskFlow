## Context

当前接续：减负语义由 [reduce-defensive-design-overhead/design.md](../reduce-defensive-design-overhead/design.md) D-01～D-16承接。原D-39、D-48、D-54、D-66、D-70/D-72/D-78、D-86等涉及重复审核、逐层授权、摘要全等和检查点举证的部分保留为历史，活动 delta 已移交或对齐。代码尚待新 change 实施，原5/19任务与证据不因此改变。

前置 change 的网络模型、API/Worker、三图、五类 Agent、正式权限与有界报告程序已有实现。当前 HEAD 为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`，仍有前置实现的 dirty 改动；这不是固定 implementation checkpoint。原施工基线及 IP-01–IP-16 保留于前置工件，本 change 从 IP-17 开始，具体交接见 handoff.md。

当前宿主仅接受 synthetic-acceptance 的合置本地 C04。mTLS put/open adapter 已实现，但 remote verifyContent 和完整跨 VM 宿主未开放。Electron e2e 只有两条基础用例。functional.mjs 已有正式只读终态观察与安全报告，尚无完整真实业务报告。MinerU V2 五格式及本机基准已有独立报告；V1 扫描失败不能改标签计通过，V2 parser 证据仍不等于生产 C04/C11 登记。

## Goals / Non-Goals

**Goals**：闭合剩余功能实现、正式来源、当前平台 Electron、真实模型业务、可见浏览器、恢复/重启适用场景与安全追溯报告，最后按固定检查点完成验收。

**Non-Goals**：重复宿主、第二套 catalog/reader/报告器，未批准字段/迁移/依赖，C19 Agent 评分编制，跨 VM 正式宿主和远程正文证明扩展，签名/三平台正式安装、禁网/模型介质/4090 取证、HA/PITR/RPO/RTO/SLA、移动端。D-36–D-38为用户批准补充范围。最终义务按 handoff.md 的 F-01–F-05 交 C38。

## Decisions

### D-86. 合并检查点证明复用C22身份与逐工件读取身份

v90b五项I5完成、I6已正式登记，子游标I7/running但图检查点仍I6，父503可重试。只读检查点put引用验证见logs/merge-checkpoint-v90b-3.log及-4.log：候选检查点证明对不同工件复用同一invocationId作为C04读取身份，先触发ARTIFACT_IDEMPOTENCY_CONFLICT；以独立诊断读身份隔离后，实际MergePlan严格Schema通过，却被其identificationRunRef与C24实际运行的错误比较拒绝。C22生产者唯一identificationRunRefFor按工作计划生成稳定汇总身份，C24实际运行另由父运行/准备/图派生；C24已先证明该运行的精确输入及工作计划，二者不能混比。

仅修部署candidateProof：C04 requestId/idempotencyKey从原调用身份加精确工件身份/版本派生，跨工件隔离、同工件重读仍幂等；MergePlan正文身份复用C22唯一identificationRunRefFor按已核验工作计划重算。继续所有C24运行归属证明、当前C06权限、工程/主体、登记行/正文/输入/工作计划版本、授权范围、内容完整性及mergePlanRef重算；不修改C22生产正文、公共Schema或旧事实，不把无运行归属的工件放入检查点。既有组合夹具改用真实C22构造函数，保留错计划/错身份/撤权拒绝；新增同调用多工件及重读回归。

进一步读取方核对发现，C22路由、复核waitingRunRef及标准化记录继续沿用合并计划中的汇总身份，而正式run-read/record-read需要实际C24运行。C22新合并及路由统一以已核验工作计划的冻结inputSnapshot.identificationRunRef为运行事实源；缺省仍沿原汇总构造。新合并摘要及路由摘要纳入该运行身份。路由阶段经既有workPlanReader精确复验输入/工作计划，再为新路由、复核等待和后续记录固定该身份；v90b已有合并正文不改写。检查点在上层C24运行归属证明之后接受精确C24身份或原工作计划汇总构造身份，两者均不得由自由值替代。复用既有字段及读取端口，无新公共Schema。

父子均未终态，修后先只读证明原I6引用，再以新发布和同策略/图版本从公共transient-recovered恢复同一批次。复用C24既有businessAheadOfCheckpoint/recoverCommittedBusiness从已登记I6重建检查点，避免重新推理或合并；禁止手改检查点或旧运行状态，原失败/审计及所有预算保持。

### D-85. 合并专用嵌入批量与正文预算语义

D-83真实网关入口诊断在任何上游HTTP调用前发现request.input-budget：原检索Embedding部署maxBatchItems=2，而v88合并有18条短风险事件。该限制属于原冻结部署，不能通过扩大请求或原地改配置绕过。隔离验收新发布保留原检索部署，另以`ollama-risk-event-embedding-acceptance@physical-20261016-d85-v1`声明同一服务器/权重/版本/2560维的合并专用部署，只将maxBatchItems设为32，覆盖五工作项各最多4条的20条上界；maxInputBytes=16384、context40960、超时、响应字节及其它限额保持。只让新候选合并策略引用它，原检索模型引用、代际、语料与质量门保持。新risk-candidate/identification-graph目录版本及精确policySetRef/mergePolicyRef联动，旧策略/运行不变。

独立代码缺陷：network-api网关的embed将完整序列化请求长度作为正文长度交给共享预算检查，C22按真实UTF-8正文总量声明maxInputBytes时会因JSON封装被误拒。仅改为正文使用共享inputBytesForTexts，serializedBytes继续用于保守token上界；共享网关检查另保留完整序列化请求不超过冻结部署maxInputBytes的检查，因此不放宽实际网络载荷上限。llama.cpp已有正文语义不变。扩既有Ollama嵌入用例证明恰好正文预算成功，正文超限、完整请求超部署字节及批量超限仍在网络前拒绝。无依赖、公共DTO、模型权重或维度变化。

源码及测试限network-api-model-gateway.ts与其既有测试。诊断旧日志i6-real-embedding-d83.log/ -2.log分别保留映射缺少诊断引用及原稳定MODEL_INPUT_INVALID/request.input-budget，不当成上游故障或实际模型消耗；修后独立诊断只调用一次原18条短文本并在向量/领域写入前停止，不计正式合并PASS。先闭合真实网关边界，再启动新业务批次。

### D-84. 有界修正绑定失败候选及精确替换数量

v89第二工序I4产生两条候选，一条仅风险事件表达需修正；I5正式修正模型返回四条，服务按repair-output-arity拒绝。只读原候选重算和C04原响应核对见logs/i5-diagnosis-v89-2.log及node02-repair-v89.log；JSON合法、修正6539 tokens、2398字节，未触及原预算。运行时只向模型给出全部父候选身份和失败码，缺少待修六字段正文、待替换数量，实际Schema也只限制通用maxCandidates=4。

仅调整C22运行时的修正投影：按失败清单匹配candidateId/version，沿原父候选顺序投影待修候选的身份和既有六字段output，排除已接受候选；显式提供requiredCandidateCount，并以同一待修集合长度收紧原输出Schema为精确长度，同时保留原maxCandidates约束。服务仍按既有repairParents顺序映射，错误数量不得截断或拼接补齐。只提供正式候选输出，不读取原始思考或新增资料；原五项上下文、模型、固定系统指令、提示/输出Schema引用、权限及全部预算保持。原风险事件与来源/因素不同等确定性校验不变，不重写失败候选或恢复已失效工作项。扩既有运行时修正用例覆盖混合接受/失败父候选、数量恰好/少一条/多一条。旧v89通过公共取消收口后独立新批次。

临时验收驱动必须在每次正式进度读取后检查failedWorkItemRefs为空；HTTP 202不能代表I5通过。v89发现第二项失效时第三请求已发出，先冻结驱动，待在途请求正常结束后终止；第三项I5通过，未发第四次继续。该操作缺口单独保留，不冒充生产缺陷。

### D-83. 合并嵌入沿正式finalize能力

v88五工序I5通过后，I6在模型调用前终止。`logs/i6-embedding-entry-v88.log`用原五份校验集和当前正式合并授权、无模型或业务写入屏障复现：嵌入运行时误用生成能力risk-identification.run，实际授权只有risk-identification.finalize，请求Schema因此拒绝。仅将嵌入请求、向量工件put及其网关错误映射绑定既有risk-identification.finalize；生成请求及其错误映射仍绑定risk-identification.run。能力按固定操作选定，不从授权列表择取、不扩大C06签发或忽略Schema。复用现有运行时测试，使用仅含finalize能力的真实形态授权并通过网关请求Schema，检查向量保存及权限错误的能力一致；仅run授权仍拒绝嵌入。无公共Schema、端口、依赖、迁移、预算或历史事实变更；先以原五份候选做无模型入口预检，再用新制品和独立业务批次取证，旧v88终态保留。

### D-82. RI-S57模型请求显式携带冻结候选数量预算

v87前三工序I5均通过；node-04在I4因模型返回5条、冻结maxCandidates=4被正确阻断。logs/node04-model-budget-v87-2.log核实JSON合法、tokens9566、输出3501字节，均低于原预算。C22运行时却只投影五项上下文，并将通用最大候选Schema交给网关，模型看不到本次数量上限。仅把同一冻结budget.maxCandidates加入用户消息的模型输入约束，并以该值收紧既有输出Schema的candidates.max；不更改六字段契约、输出Schema/提示模板引用、模型、数量/Token/字节/墙钟/修正预算，不截断输出、替换历史候选或复活v87。该值属于本次冻结输入，固定通用指令不变；实际Schema由冻结预算与原Schema确定，仍须通过全部确定性校验。扩既有运行时投影用例与参数化边界，核对模型可见上限、恰好上限及超出一条的拒绝，并保留合法零结果。

### D-81. 校验读取已生成候选，不以新命令重复登记

v86的I4候选与检查点均通过，I5在persistCandidates初始调用中以新命令重写同一候选工件；C04不可变登记键冲突，被收口为ARTIFACT_REGISTRY_FAILURE/registry.register（logs/i5-service-v86.log）。该诊断未调用模型，重复登记失败、原工件保留。仅将I5初始候选映射改为读取：复用C22原工件命名及同一JSON字节序列化，按C04既有SHA256内容地址定位每条已保存候选，在当前权限和既有字节上限下完整读取并核验后交确定性校验；缺失、损坏或内容不同即拒绝。不重放旧授权/旧生产命令，不改C04幂等和不可变规则。初生、修正和人工修订的新候选仍各写一次。扩既有生成后校验用例，夹具拒绝重复工件登记；手工种入候选集的测试同时种入对应候选正文。无公共Schema、端口或依赖变化，旧v86父子终态不复活。

### D-80. 候选生产正文遵守唯一严格Schema

v85b真实I4已生成三条候选并登记候选集，C24业务游标I5而检查点停I4。只读逐引用证明只有候选集拒绝；C04读取Schema报三条candidates的retrievalArtifactSetRef为额外字段（logs/i4-candidate-proof-v85b-3.log）。C22的buildCandidates错误重复写入候选集层才有的检索引用，类型结构兼容未阻止运行时额外字段。仅删除该冗余字段、构造参数及初生/修正调用参数；候选与候选集构造通过既有RiskCandidateV1Schema/RiskCandidateSetV1Schema校验后才写C04。集合层精确检索/上下文、模型、证据、预算和权限保持。扩既有正常生成及有界修正测试核对实际写入正文严格可读，不新增公共字段或容错读取。v85b旧候选、原响应与错误不改写，通过公共取消收口父后在同配置新制品发起独立批次；不以工程测试替代I5及后续业务取证。

### D-79. 父图保留子运行异常的稳定错误分类

v85b完成I3并提交I4候选后，父公共继续返回503，父只登记unclassified-failure；C24运行异常将稳定错误放在.error，C30分类器仅读取顶层code。依据用户持续授权，分类器在没有顶层code时只解包一层.error，再交给既有classifyWorkflowGraphFailure；不递归搜索cause、不匹配文案，不修改C24契约或重试预算。当前父阶段与错误时刻由本次C30保持；权限、冲突、检查点及其它不可重试错误不得变为技术重试。扩既有C30运行时测试，以实际IdentificationGraphRunErrorV1覆盖不可重试和技术失败。该项只修可观察分类，不宣称已闭合I4检查点失败，也不改写旧错误记录。

### D-78. C22复用本次已签发逻辑授权的精确范围

D-76/D-77只读I4预检在模型屏障前发现：C22 verifyCurrent经通用runtime把已签发逻辑别名误认为新下游行动，按requestedSourceVersionRefs=[]再次签发而改变原来源范围；同控制作用域后续C21读取因此可能出现身份冲突或范围不符。仅把C21已有的“原来源复验→同分支逻辑/精确引用配对→当前范围核验”提取为共享内部核验，C22优先复用该结果，未取得此结果时仍走原通用派生路径。已签发本次授权及其范围原样保留，未配对/错引用/撤权不被该路径放行；不改C06、TTL/权限、领域幂等或预算。扩既有真实宿主多引用配对用例，核验C22不再替换已合法签发的上下文；实际预检以模型/领域写入屏障收口，不能计业务PASS。验证后v85合并D-76～D-78，不复活v84。

### D-77. 完整上下文实体身份与版本长度分别处理

D-76实际只读已成功返回v84正式五项上下文，领域行/任务账本不变。接续核对发现C22 modelContextResultIdFor把完整组合entityId错误套用了仅名为version长度的200字符常量；当前正常工序/任务复合身份超出此值，将在模型前被误拒绝。契约Identifier无此实体长度限制。仅移除这个孤立误限，保留已声明retrieval-review前缀与非空任务证明，并复用C21共享modelContextArtifactSetEntityIdFor生成同一身份，不截断、不另造hash或放宽版本/引用/权限。扩既有C22核心身份用例，用真实形态复合ID与错前缀/空任务覆盖；无运行预算、HTTP/Schema或已发布知识变化。

### D-76. C21已登记模型上下文的精确只读接缝

v84已完成I3并进入I4，随后unrecognized-port-failure终止。部署把context.service作为C22 ModelContextReaderV1，但该service没有readExact方法，真实端口未接线。仅为C21提供显式modelContextReader，遵循已有C22窄读契约，不改HTTP或DTO。读取前核对主体/工程并签发本次relationship-context授权；按精确retrievalArtifactSet读取C21自有审阅行，核对版本/工作项/主体，再由原输入读取器核对冻结快照和当前空间/资料权限。读取对应原completed任务和同次已登记model-context行，核对精确任务/检索/工作项/输入/关系/范围与已核验C04正文，返回既有payloadDigest及正式上下文引用；返回前再次核验权限。缺结果、错版/错归属、撤权或完整性失败拒绝；不创建上下文、补登记、调用模型或改预算。模型上下文entityId复用单一schema helper，消除读写重复拼接。Worker C21组合导出该窄读，部署传给C22；C22组合在构造时检查readExact可调用，缺接线当场拒绝。扩既有核心组装/只读边界、组合与宿主测试；v84终态和任务保留，验证后新批次。

### D-75. 上下文登记审计身份使用实际工件引用

v83首次公共继续已直接进入I3，未再出现先前503，机理覆盖校验也已通过；随后model-context-persistence使父子终止。只读登记核对证实C04工件已耐久（21232字节，sha256:64e15392bffd96bb7c68144f71545d7e21a0330b3d25999628cfd2a1094df07a），只有put收据，无C21注册收据。核心以包含workItem与task的实际artifactId生成register/audit身份，适配器却按旧workItem公式生成外键，提交无法配对。仅让C21登记行的audit_entry_id由row.artifactRef.reference.entityId沿既有:register:audit规则生成，删除重复的三类身份switch；核心是实际工件身份事实源，不改业务/工件ID、端口/Schema、迁移或审计约束。扩既有真实PG三类回读用例，model-context使用带任务身份的实际工件ID，保留幂等、外键、原子回滚和无权拒绝。旧v83终态/失败及已写C04工件保留，不手工补注册或复活运行；新制品后新独立批次。

### D-74. 独立子运行不继承父恢复节点的临时调度计数

真实父StateGraph自身等待中断后，再在识别节点执行C24.start幂等读取和C24.resume，已复现CHECKPOINT_INCONSISTENT/checkpointer.graph-state（/tmp/riskflow-d74-red-final.log）。测试限定取证显示子调用继承父节点__pregel_scratchpad，LangGraph按subgraphCounter把固定根命名空间派生成|1，读不到原子检查点后尝试写空业务状态，C03严格拒绝。仅在C24唯一executableConfig接缝显式清除继承的父scratchpad，保持原线程、根namespace、saver和sync durability；子节点继续由LangGraph生成自己的临时调度状态。不修改C03 Schema/空状态拒绝、持久化格式、业务游标、权限、预算或原终态，不绕过父自身interrupt。扩既有真实嵌套夹具覆盖父wait→resume→子继续，并核对原子线程仅根namespace、同一任务与原预算。调试观测只在测试内，完成后删除。C30丢失上游嵌套错误分类是另一个已发现缺口，本项先解决已复现的恢复根因。

### D-73. 风险机理适用范围覆盖当前工序

v81正式恢复通过授权后因mechanism-missing终止。当前已发布机理03/05/06均显式连接node-01，其工法/地层与工序一致，engineeringStage覆盖五工序；当前节点仅扩径准备。C21的applicabilityCovers反向比较为“机理所有值均在节点中”，错误排除了宽范围机理。正确方向为三个维度分别要求当前节点的全部值都在机理适用集合内；相等或机理超集可用，缺少节点任一值仍排除，nodeIds、同工程/精确发布/证据及权限约束保持。仅修唯一共享筛选helper并扩既有关系检索用例为相等/超集/部分覆盖；不改已发布知识、查询/相关性标签、阈值或预算。保留v81父子终态和completed任务，新批次前以正式读取核对覆盖及工程回归，不复活旧运行。首次父图恢复的独立瞬时失败仍保留，需另行定位，不把本修正当作该故障已闭合。

### D-72. Worker受理命令与实际授权身份配对

v80首个检索审阅任务在worker.step失败，模型/工具/资源消耗为零。D-70将真实受理授权身份与冻结业务commandId分开后，runTask未登记该任务自己的受理命令配对，verifyWorker仍以冻结commandId核验，从而在租约复验前被宿主拒绝。仅在可信任务租约作用域内，将任务原commandId与sourceOf精确读取的原受理上下文按原分支配对；该映射只使已有access.verify进入C06任务租约与当前权限核验，不能自行签发或跳过C08任务/租约、主体、范围和预算验证。保留冻结信封/命令和真实实际授权身份，不修改TTL、C06权限策略或旧任务终态。扩既有租约作用域测试，使实际受理ID与业务commandId不同，覆盖Worker入口及未签发ID、撤权和取消拒绝；修复通过后另建独立批次，v80失败保留。

### D-71. 新独立批次的候选生成预算

当前C22策略把4096同时作为整次maxTotalTokens与首轮maxOutputTokens，实际输入/输出累计及修正轮仍计总量。沿用户提高不现实预算的持续授权，仅隔离验收工程的新策略版本将maxTotalTokens设为32768，与现有模型部署maxOutputTokens上限一致；候选4条、输出131072字节、600000毫秒、修正1轮以及模型/提示/工具/检索质量不变。新risk-candidate和identification-graph策略精确引用联动，其余正文保持；不修改已冻结任务、旧失败或运行预算，不宣称此前已发生C22预算失败。新批次开始前strict Schema与部署装配校验必须通过，实际消耗仍按原规则记录并超限拒绝。

### D-70. C24逻辑业务行动与本次授权身份分离

D-69正式恢复已越过父失败接缝，原子运行在I3终止。当前只读复现确认C24的identificationAuthorizationFor仍用原逻辑业务动作ID签发授权，原上下文过期后新的控制调用也被SESSION_EXPIRED拒绝；D-67仅修复C21读取，未覆盖C24逐阶段行动。修正共享C24 helper：以已核验run.issuedInvocationId和逻辑行动ID形成实际授权身份，同时在内部authorizeDownstream输入携可选logicalInvocationId；业务命令/任务/幂等身份保持。宿主仅为本控制作用域真实签发的精确授权记录逻辑/实际配对，C06仍核验实际身份、能力与原范围。人类配对键包含完整授权引用，防止同逻辑读取/行动相互覆盖；任务租约仍沿既有证明。运行执行授权本身不带逻辑别名，继续D-53精确实际身份契约。

I3等待恢复不再申请未使用的start-task授权；仅首次候选/任务创建路径签发该能力。扩真实C06宿主测试，以同一逻辑行动、不同控制调用和过期上下文证明新授权可用、旧引用/未签发行动仍拒绝，并验证同一逻辑行动的两份已签发引用均按各自配对复验。保持TTL/角色/权限策略、冻结输入/预算及终态；v78原父/子终态保留，验证后新独立批次。

### D-69. 父运行技术失败后保留叶任务完成证明

v78原父在公开完成任务恢复时出现可重试技术失败，父版本0323b76386ef4e0549b2b2dae598a7e865c87d84ed0d8b1b0a00610c79a48325，子运行仍在原I3等待、任务completed。只读且禁止检查点/领域写入的独立/嵌套诊断已证明当前权限下的读取、完整结果及增量引用合法，尚未最终定位原瞬时错误。恢复契约需覆盖父retryable-failure而子仍waiting的接缝：携原完整Agent完成结果的公共恢复按原父失败阶段重试，保留该完成原因传给精确等待中的C24，不把它改成子技术恢复，不重启子运行或任务。原状态版本、任务/父子/权限及重试预算继续校验；已终止运行仍不可恢复，旧错误与预算不变。

扩既有C30公开任务恢复用例，注入一次子恢复调用在叶状态改变前的技术异常，核对原父retryable、子等待保持，再以原完成结果恢复成功。仅调整父执行入口选择，不修改公共Schema、C24冻结输入或任务预算，也不把本诊断作为业务通过。

### D-68. 合成工序验收资料的受力依赖完整性补充

正式只读核对当前五节点工序发布仅有node-03→node-04一条受力依赖，node-01/02/05缺项，C21按既有五项上下文要求正确拒绝。依据持续授权，新增明确标注“合成样本、待甲方复核、仅隔离验收”的补充资料；保持原五节点及现有关系，补两条合成场景依赖node-01→node-02、node-04→node-05，使各节点具备受力上下文。该补充是新编制的验收输入，不声称来自真实工程资料或旧证据。

保存独立合成候选JSON及资料生成说明，经新来源原件导入、正式C11转换/清洗、精确资料段重新绑定、C17确定性校验/人工审核/独立发布产生新版本。依赖工序发布的机理及检索组合按既有治理产生新版本并保留原发布；知识来源授权范围增加仅本次新资料，当前角色/权限仍独立核验。新检索代际必须重新通过原质量门，预算、模型、质量阈值和原五业务资料保持。新输入准备/发布闭合前不创建模型批次，不改旧运行事实；全程使用既有公共契约，不新增依赖或放宽Schema。

新DOCX已正式转换，来源s_918587f01a80cd2e1080d447ea727325@1；准备因cleaning策略尚未列入该来源的新质量策略而正确拒绝。仅为隔离实例创建cleaning新版本，在allowedQualityPolicyRefs追加physical-governance-source-quality-process-model-d68@1（非空页/关键字段均要求1，12个条目键），联动部署目录与工程引用；其余策略正文、模型、工具、清洗/检索预算、阈值和图版本深比较保持。拒绝回执保留，采用新准备命令身份，不修改原失败。

### D-67. 当前控制调用下的C21读取与等待任务复用

v74公共恢复已越过完整结果检查点，但原父/子在I3终止，旧completed任务不变。只读诊断用同一生产C21组装与当前会话、禁止工件/事务写入，得到AccessServiceError/SESSION_EXPIRED/authorize.context：读取复用了原任务逻辑ID对应的旧授权上下文。不得延长TTL或刷新旧上下文。C21宿主读取在当前控制调用作用域内派生独立实际调用身份，记录仅本作用域的逻辑行动/精确授权配对，复验只翻译已签发且引用严格一致的配对，仍由原C06验证实际身份、当前权限及范围；任务租约路径保持。没有本轮配对时继续原严格核验。

C24恢复已登记I3任务等待时复用原冻结候选和任务，不再重做候选冻结与start-task；先核对原等待、任务完整引用、工程/主体及精确父运行，再以当前授权读取、组装上下文。错配或缺失拒绝，不重置预算、不复活终态。首次启动保持原路径。扩既有宿主真实C06用例覆盖旧读取上下文过期后新控制调用读取、旧上下文继续拒绝和未签发行动拒绝；扩C24既有等待恢复用例覆盖冻结输入不重写、任务不重建及原归属边界。旧v73原父/子终态保留，修复验证后才开启新的独立验收批次。

### D-66. 检查点证明正式Agent完成结果

v73首个检索审阅已正式completed且父绑定正常202；携带完整TaskResult的公共恢复在图入口返回503，父/子游标与任务不变。C03通用ContractReference不含完整AgentTaskResult，收集器会递归进入其成员，宿主无法证明整份完成结果。依据持续授权，C03自有CheckpointReferenceV1联合复用原ContractReference与既有AgentTaskResultRef，不改通用C02引用；收集器对合法完整结果作为原子引用，错误结果形状拒绝。宿主将该种类并入现有任务证明：从结果内取精确agentTaskRef，沿当前授权、父子入口及原C08任务reader证明归属；再经既有C08 getTask窄读核对持久化completed状态、任务及完整state.resultRef与待证明结果严格一致。未完成、异结果/任务/父运行/工程或撤权拒绝，不放宽其它C03或控制通道，不从通知创建完成事实。

扩既有宿主参数化任务证明和真实PG检查点用例覆盖原子完成结果、错误形状/状态/结果拒绝；原ContractReference校验fixture显式接受新CheckpointReference联合。工程回归后冻结新制品，仅从公共workflow.resume-run继续v73原运行、原TaskResult和当前游标，不重跑已完成审阅或复活旧失败。

### D-64. 父图增量写回按已登记子运行证明任务

v72故障元数据确认HTTP503来自putWrites/checkpointer.reference；完整检查点回读和正式父子/任务证明随后通过。putWrites校验的是上一检查点与本轮新引用，此时旧state尚无刚登记的identificationRunRef，现有任务证明只能尝试父运行而拒绝合法子任务。依据持续授权，仅在riskFlow/put-writes任务证明时，经现有workflow.registrationStore窄读本父当前已登记状态，核对工程/运行后补充其中的子运行引用；每个子运行仍须readWorkflowRunBinding精确证明后再由原任务reader证明，不从待写通道或自由引用建立父子关系。其余操作和C03严格校验不变。扩宿主旧检查点/新业务等待/错父零放行回归，移除D-63临时日志。

### D-65. C21校验工件采用C08正式用途

v72正式C21检索工件集已经C04耐久并登记C03，但C08候选列表为空、任务终止。真实工件元数据显示校验用途为identification-context-observation，而C08 recordCandidate按既有契约要求agent-validation，严格拒绝正确。依据持续授权，C21校验工件使用agent-validation；模型读取通过同一确定性校验工件身份选择该用途，工具观察仍用原observation用途，均验证类型化taskRef及候选配对，不尝试其它用途或自由工件。复用唯一validationArtifactIdFor同时用于产生与读取，保留旧错误工件及失败；不改C08/C04校验或复活任务。补既有核心用途回归及模型观察续读验证。

### D-63. 检索审阅预算来自不可变配置

v70任务完成受权模型输入加载，但请求在发送前以request.input-quota失败，模型响应token为0。C21任务定义仍硬编码maxContextTokens=16384，review策略只配置budgetPolicyRef而无预算正文。按用户此前提高Agent预算及当前持续修正授权，消除该硬编码，RetrievalReviewPolicyV1增加必填既有AgentTaskBudgetPolicyV1正文，校验预算、模型、提示和工具引用与策略一致；候选规模/补搜上限不得超过该硬预算。C08直接消费该配置，不设置隐式默认值。

隔离验收创建新不可变review策略、预算和提示模板引用，输入/输出/上下文总预算分别131072/32768/196608 token，保留4次模型、8次工具、1次补搜、32成员/对象、2次修正/瞬态重试、单并发和600秒，以及512000/128000字节上限；每次输出仍4096。同步新identification-graph策略版本及其policySetRef，risk-candidate成员按既有精确配对约束仅联动新策略集引用及自身版本，正文中的校验/置信度/合并/审核约束不变。C17知识成员、检索策略/数据集/代际、来源与质量不变。v70旧任务和用量不复活、不重置；新批次固定新预算，模型网关保守估算与硬拒绝继续执行。v71暂存被原策略集成员配对预检拒绝，未部署；失败工件保留，修正引用的新暂存使用独立v72路径。

### D-62. 检索审阅模型读取受控候选与观察

v69任务越过D-61授权检查后在resupplement.policy终止。现有renderer只传工件引用，没有提供allowedSupplementIntentCodes、候选条目正文或前轮观察，模型无法据正式内容进行审阅。不能通过扩工具代码、预算或假完成绕过。

依据持续授权，C21增加窄readReviewModelInput：按原冻结任务、候选工件、当前授权和既有8MiB读取边界读取本轮候选，按策略maxCandidateMembers约束规模，经C17精确发布读取且只投影命中条目；复用条目定位事实源，不读取研究原件。模型步改为异步，显式提供允许补搜意图、原候选/补搜上限及受权模型输入；权限/知识条目内容均作为数据，不作为指令。

C21工具观察统一既有observation用途下的类型化结果/校验联合，包含精确taskRef及候选引用；补搜返回新候选及同任务观察，不以candidate-set用途冒充观察。校验观察携带已核实候选引用，模型加载器验证观察任务、候选工作项/输入快照、版本和冻结范围一致；不同任务/错引用/撤权拒绝。模型仅能看本任务冻结候选、命中正式知识与前轮已记录观察，不读自由工件；原结果引用、工具策略、预算、事务及人工边界保持。旧失败和观察保留，新任务取证，不复活旧任务。

### D-61. 检索审阅当前授权使用精确行动配对

v68新批次已完成I0–I2并创建I3真实任务，父已登记任务等待，HTTP返回可重试技术失败；只读状态优先于该HTTP错误，正式父检查点及引用证明可读。任务消耗1次模型/1次工具后以worker.retrieval-review.authorization终止。任务租约作用域沿D-48返回冻结分支授权，并在当前执行内保存已签发逻辑行动与该授权的精确映射；C21部署接缝却要求逻辑行动等于历史签发ID，拒绝了合法任务行动。不得放宽普通人类调用身份或原权限。

依据持续授权，C21部署verifyCurrent保留来源/分支验证，使用现有access.verify对实际invocationId证明配对：普通调用继续精确ID，任务内仅接受当前租约作用域已签发映射。C21当前候选读取的queryId与validate行动ID统一，签发/读取/复验引用同一逻辑行动。扩现有entrypoints任务租约回归和C21当前授权回归，验证合法任务行动、错ID及撤权拒绝。不改C06、角色/分支/TTL、预算或任务终态，保留v68失败并在新批次取证。

### D-60. 正文预写重试与业务提交身份分离

v67公开恢复不再崩溃，但原v64子运行在I0以ARTIFACT_IDEMPOTENCY_CONFLICT终止，父运行随后正式terminal-failure；没有新增Agent任务。首次I0已成功写C04正文，随后C03登记回滚；恢复用新的记录时刻和当前授权重建正文，却沿相同存储命令身份提交。C04同键异载荷的拒绝正确，不能删除旧工件、复活终态或放宽幂等校验。

依据持续授权，C24自有putBody在验证当前授权及正文Schema后，复用sha256CanonicalJson对实际正文写入输入（含实际授权及原调用身份）派生存储commandId/idempotencyKey；相同物理输入保持同键，不同正文或授权的预写使用不同键。C03业务动作身份、版本并发、唯一登记和审计保持，正文仍先写、业务事务仍原子提交；新预写不等于新业务事实，未被登记引用的旧正文保留。无公共字段、迁移、依赖、权限或预算改变。扩既有真实PG/C04夹具，注入I0正文写完后的登记事务回滚，跨时刻恢复到I3等待并验证仅一条I0成功登记、重放无新增业务事实。修复并验证后使用独立显式新批次继续验收，v64终态和全部失败保留。

### D-59. 嵌套恢复清除父检查点标识

v66公开恢复触发API进程的未处理检查点写回拒绝，API已重启恢复可访问，原请求/崩溃日志保留，未重发。隔离真实父/子StateGraph及PG测试同形复现。只记录线程/命名空间/检查点调用元数据后确认：子线程一次putWrites带了从未由子saver写入的父checkpoint_id，随后子图才创建自己的检查点，现有严格校验正确拒绝不存在的目标。

依据持续授权，C24唯一executableConfig除已有本线程、根命名空间和所属saver外，显式清空继承的checkpoint_id与其后备checkpoint_map，让LangGraph按子线程读取当前检查点。仅修调用边界，不放宽C03、控制通道、引用、命名空间或持久化校验，不捕获并忽略失败、不新建状态机、迁移或依赖。扩展既有nested-boundary测试在真实父节点内恢复同一retryable子运行至正常I3任务等待，要求无未处理错误、子检查点仍归本线程；原等待/重放/撤权/取消测试保持。临时观察钩子清理后完成所属回归及工程验证，冻结新制品再从公共入口继续原批次。

### D-58. 按正式工作流错误引用证明历史检查点

v65公开恢复仍返回技术失败，C24游标和任务数未推进。禁止新业务写入的既有启动回执诊断定位到put-writes校验workflow-error失败：错误登记行以承载状态工件为主键，workflowErrorRef是独立判别列；adapter误将错误引用当主键。既有测试人为把主键改成错误引用，未覆盖生产形状。依据持续授权，C24自有读取器对workflow-error按projectId、runId、resultKind和精确workflow_error_ref查询，至多读取2行且只接受唯一匹配；继续现有当前授权、主体、范围摘要及引用配对，缺失、错版本、错运行、重复歧义或撤权均拒绝。其它引用的读取不变，无历史数据修写、迁移或权限放宽。

纠正原真实PG测试夹具使错误行沿生产工件主键，先取得同形红态，再验证精确错误证明、错引用/主体/工程/运行和零补写。诊断临时DEBUG-d58日志已移除；新制品仅在回归和工程检查通过后冻结，先按既有已提交启动回执核验历史失败检查点可读，再继续公开恢复，不以内部resume取代业务入口。

### D-57. 识别运行的登记与输入快照隔离

同一红态测试在登记键修正后继续暴露I1的快照身份冲突：快照正文含本次授权、审计及创建时刻，原引用却只包含准备和发布版本，不含所属识别运行。按同一根因补齐可选IdentificationInputSnapshotV1.identificationRunRef（既有WorkflowRunRefV1），C24新建快照必须固定本次runRef；唯一identificationInputSnapshotRefFor及构建工作计划的复验都纳入该引用，进而使计划/工作项与C21查询身份自然按运行隔离。缺省字段保留原快照身份，既有历史正文和引用不改写。复用原Schema与构造函数，无新表或迁移；施工图补contracts/workflows与core identification graph service及既有测试/fixture，不增加其它业务字段。

v64新批次在I0登记失败，未创建新Agent任务。现有真实PG/C03/C04测试已复现：同一准备及图版本的第一个父运行完成，第二个父运行在I0返回TRANSACTION_FAILED。根因是C24统一rowBase的登记幂等键只有resultKind与阶段后缀，缺少运行身份；工程级唯一键把第二个运行的I0误判为第一次登记的异载荷。依据持续授权，在唯一rowBase处复用已有actionIdFor（精确运行版本及后缀）构成登记幂等键，覆盖全部阶段、等待和结果登记，不新增摘要算法、迁移或特殊批次分支。

既有结果引用、正文、业务命令身份、原历史行和失败保持；同运行重投继续幂等，跨运行登记分区独立。扩展现有C24真实测试在同一数据库、同一准备/图下执行两个精确不同父运行，并保留原运行重放、并发恢复/取消与检查点回归。工程验证后冻结新制品继续v64的正式可恢复路径，不在未定位错误时消耗剩余重试额度。

该恢复复用公共transient-recovered原因：C30保留类型并仅在C24明确retryable-failure时转交其既有resume，等待型任务/复核原因仍仅恢复waiting。精确子运行、当前版本、父控制身份、原输入时刻、原预算及退避约束保持，不以重发start代替恢复，不创建替代状态机或重置次数。

### D-56. Agent正式身份与等待检查点只读接线

v63新批次真实到达I3，输入快照、工作计划和等待已登记；C08检索审阅任务因候选集引用的任务身份不匹配而terminal-failure。C24自行派生retrieval-review-task身份，C08按工程及启动幂等键派生agent-task身份，二者不相等；不能放宽C21的精确引用校验。依据持续授权，导出并复用C08已有纯身份函数agentTaskRefFor，输入仅工程、幂等键及任务类型/触发方式/策略引用，不依赖尚未写入的冻结候选工件。C08自身启动继续用同一函数，实际身份算法不变；C24在冻结候选集前按随后实际启动幂等键取得相同任务引用。旧任务/候选/失败及预算不改，不复活终止任务。

I3等待检查点还需agent-task.read及review-audit.read两个既有只读分支，当前隔离策略的workflow.start-run、workflow.resume-run、engineering-data.complete-identification-preparation和review-audit.decide-review根缺少该声明。新不可变策略版本仅补这些分支，C06继续逐项核验当前角色能力、主体/工程、资源与精确父子运行；checkpoint validator继续调用原正式reader证明，不能以本地存在替代。无角色/账号/成员/来源授权、TTL、事务或迁移变化。

代码与真实回归通过后冻结新制品，以显式新批次沿原五资料准备继续实机；保留v63失败批次，不把旧任务失败算成新任务通过。新批次读取当前已激活的同一v15检索代际，模型、预算、质量门槛与发布内容不变。

### D-55. 同输入的显式识别验收批次

v62实机证实：更换公开start-run命令和输入时刻仍复用旧父，因为唯一运行身份仅由业务冻结引用、入口及图版本构成。该命令仅新增启动绑定，原父游标、旧输入时刻、任务和重试计数未推进；503回执保留。依据持续授权，identify-and-assess启动载荷增加可选IdentifierSchema字段executionBatchId，用于明确发起同输入的独立执行批次。批次标识通过core唯一workflowEntryIdentityFor进入入口摘要，再由原workflowRunIdentityFor生成运行与线程；缺省时原身份算法不变。批次不是业务来源，不混入frozenRefs，不改变准备匹配、模型、预算或权限。

同批次同载荷重投仍指向同运行；不同批次产生不同运行和线程；同幂等键更换批次仍按异载荷拒绝。公开命令回执保存完整载荷，后续恢复沿已登记entryIdentity/runRef，不重新推断批次。只修改contracts启动Schema、core身份构造、C30公开启动调用及既有契约/core/worker回归，HTTP自动复用原Schema；无新路由、数据库字段、依赖或迁移。工程验证通过后冻结新制品，在新批次绑定原五资料准备并继续实机。

### D-54. 显式验收批次、新发布检索代际与所属读取契约

现场接线核对发现：公共`workflow.resume-run`的Agent完成结果此前被降为重新判断，C30只重读C24启动回执，不能唤醒其I3等待。依据用户持续授权，本轮直接补齐该路径：父恢复保留完整AgentTaskResultRefV1或ReviewDecisionRefV1，识别阶段以实际父控制身份、子运行精确引用及当前子游标调用既有C24.resume；不引入新事件或后台状态机。完整Agent结果须与任务快照的completed状态、任务引用、主体/工程、创建任务时的精确子运行父引用及resultRef逐项一致，拒绝时不得推进子运行或模型效果。旧内部只带任务引用的调用保留原等待配对及读取完成事实的校验；不改变冻结业务输入时刻、原任务、预算或权限。源码与既有回归补充范围见IP-21。

用户已批准[evidence/identification-batch-scope-and-read-context-proposal.md](evidence/identification-batch-scope-and-read-context-proposal.md)全部范围，并给出持续授权原文「以后遇到需要修正的地方我都批准，不用每次都停下来问我了」；按当前验收任务后续必要修正预先授权解释，仍先记录事实、设计/施工图与验证，不逐项重复询问，不提交、不归档、不放松权限、不伪造验收，范围外的公共字段、权限、文件、事务或迁移仍凭实际证据升级。D-53的旧父、旧游标、旧失败、唯一准备绑定、重试预算与全部报告保留，不重试旧父去触发已知拒绝。

新批次通过既有正式工作流入口发起，现场业务载荷仍为原五份来源、原工程修订和空间；外层授权显式声明原父21来源与已发布知识19来源的并集24项，逐项经当前账号权限验证。原五份准备可按既有严格条件正式绑定，无法匹配时拒绝，不用19资料知识准备冒充五份现场准备；不读取24项以外的来源，也不把现场五份来源误作全部知识权限。同成员、同知识内容的新检索组合必须走既有提交、人工审核、独立发布，再在该批次精确的授权摘要下重建双索引和激活代际；发布完成后固定真实输入时刻解析到该发布，不改旧发布effectiveFrom/recordedAt、不把新发布回填旧父、不预造发布或运行标识。检索数据集仅为新发布引用及新批次建立新版本，原问题、预期标签、来源证据和七项门槛不变，模型、TopK、工具/Agent预算与质量要求不变；旧v55 PASS只属于其原发布/范围，新组合重新实测，失败不得降标。

创建新不可变下游策略版本，仅为workflow.start-run、workflow.resume-run、engineering-data.complete-identification-preparation增加既有分支knowledge-modeling.hybrid-evidence、risk-identification.assemble-and-infer、risk-identification.repair-and-validate、risk-identification.merge-run-candidates、risk-identification.route-acceptance、risk-identification.accept-groups、review-audit.trace、review-audit.request-review；已有复核恢复需由review-audit.decide-review真实来源推进时，只为该根声明同一C24调用链所需的上述八项及已存在的risk-identification.plan、risk-identification.run-read、knowledge-modeling.identification-basis、knowledge-modeling.relationship-context、engineering-data.evidence-access、agent-task.start-task。仍由C06逐分支检查当前主体既有角色能力，不借策略关联赋予角色原本没有的权限，不借复核者身份代替原运行主体；不修改应用角色权限、账号、成员、资料授权、TTL、事务或迁移，未批准工程和生产配置不变；来源无法按原主体/精确任务/等待/父子运行证明时保持拒绝并升级，不新建通用服务账号、通用事件或工作流状态机。

C21知识逐发布读取、候选事实读取、基线与有界补搜的签发身份必须与随后实际queryId/invocationId一致，签发只来自本次真实控制/任务来源；窄授权输入补充原AuthorizationContextV1，组合根复验其真实签发来源、资源范围及当前资格后再按精确用途签发，知识读取、关系查询与hybrid-evidence分别使用既有分支。原完整授权范围摘要贯穿候选集、任务冻结、检索输入和结果对账；新代际按同一摘要建立，保留C20现有严格相等检查，不改成宽松匹配或跨范围复用。对C17→C16的内部解析允许显式传入精确invocationId：C17按当前可信调用与既有解析目标派生，C16原样复验；未显式提供的既有调用者仍按原派生严格验证；该字段只属于内部正式读取，不新增外部HTTP。C24逐操作签发回调允许返回真实invocationId与authorization，使用可信来源身份区分不同控制调用及主体；adapter继续独立验证返回的精确身份、单能力和范围。相同业务目标不应迫使新合法调用借用另一个控制调用的过期授权；禁止延长旧TTL、复活已失效上下文或绕过C06。

先定位v59原时刻依据复读的技术错误，再按上述读取契约修复；错误码保留其真实类别，不用终止失败包装成通过。文件范围、无新依赖/迁移/UI及验证以提案为准；实施中不宣称通过、不勾tasks（保持5/19）、不建verification、不提交或归档。

### D-53. C24 控制与领域执行逐操作授权接线

实施与v59现场预检见[evidence/identification-domain-authorization-2026-10-15.md](evidence/identification-domain-authorization-2026-10-15.md)。源码及工程门禁已通过，原父未重试；I0–I3和完整业务仍未通过。新策略、完整冻结来源/代际与所属读取接缝见已批准并正在实施的D-54，不属于D-53的白名单或旧输入例外。

用户已批准[evidence/identification-domain-authorization-scope-proposal.md](evidence/identification-domain-authorization-scope-proposal.md)全部范围，纳入IP-19/IP-21补充。C24在进入领域效果前，经注入的窄authorizeDownstream接缝取得已有risk-identification.plan分支的真实执行授权，把实际签发身份固定到运行上下文和启动回执/检查点；来源必须为当前会话或已有合法任务/事件，且同工程、同主体、冻结空间/资料与精确父运行一致，缺少能力即拒绝。业务commandId/幂等键、父子身份、准备、图版本、输入时刻和预算不变，不延长或复活旧控制授权。

C24 adapter公共读写接缝增加窄issueReadContext：复用已有operation→invocationId和capability→branch事实源，先证明原上下文当前有效，再为该精确调用签发/验证对应分支；工程、主体、空间/资料、单能力和当前资格一致才返回，不把签名引用和其它invocationId混用，不接受任意权限/查询正文。部署组合必须接入该签发；其它已有调用者未注入时继续原严格复验，不提供伪上下文或放行兜底。C24图用同一authorizeDownstream为其主动发起的I1依据、I2知识读取、I3检索上下文/任务及I4–I9确定性校验/合并/验收调用签发已有用途分支，签发invocationId与随后commandId/requestId一致；已由C21/C22内部接缝签发的行动保持原归属。I2准备窄读在部署组合复用既有PostgresIdentificationPreparationKnowledgeReader，按真实requestId和当前来源委托C15/C04，不暴露C15私表或任意读取。

C24当前恢复、取消和已有复核恢复接缝统一使用可证明的控制来源再取得领域执行授权；必要内部resume/cancel命令与恢复授权回调补齐D-52同形的真实issuedInvocationId/authorizationBranch元数据，回调返回其核验过的授权及对应元数据，不从字符串猜身份；原等待、Agent任务、复核决定与父子运行引用精确配对，不创建新事件或工作流状态机。生产签发继续经createDeploymentAuthorizationScopeV1及C06原方法；执行上下文及下游关联必须能由原批准策略、真实会话/任务来源和C03父子绑定证明，检查点对真实执行授权及精确工件继续逐项核验。不得把workflow.resume直接加入C24领域能力表，不改分支白名单、角色、TTL、事务隔离、迁移或权限语义。authorizeDownstream类型化输入固定为当前工程/主体、既有ModuleBranchV1、精确invocationId、请求时间与受信冻结范围，输出真实AuthorizationContextV1；issueReadContext输入固定为原上下文及同一逐操作目标/用途，无外部HTTP或通用重授权能力。文件范围及验证以提案为准；源码已部署v59且工程验证通过，正式业务仍未通过，接续以D-53记录及已批准D-54为准，不提交、归档或创建verification。

### D-52. 识别子运行启动复验真实父调用身份

用户已批准[evidence/identification-start-authorization-scope-proposal.md](evidence/identification-start-authorization-scope-proposal.md)。内部IdentificationGraphStartCommandV1增加必填issuedInvocationId和authorizationBranch，后者复用ModuleBranchV1；C30传实际run.commandId/run.authorizationBranch，C24启动复验及本次运行上下文使用相同真实签发身份。不把父恢复授权改作workflow.start-run，不猜测或失败换分支；C06当前来源、主体、工程、空间/资料和精确分支仍必须成立。

子运行commandId/幂等键、父运行/准备/图版本、业务输入时刻及C03原子启动回执载荷不变，授权来源字段不改变业务身份。当前撤权、错主体/工程/身份/分支在子运行登记和模型效果前拒绝；其它行动仍经原受限下游授权。原五资料绑定、失败、重试计数和预算保留，不重跑清洗或改分支白名单/TTL。所属回归及工程检查通过后冻结新制品，以正式当前会话、当前游标和错误/诊断引用恢复原retryable-failure父流程，按真实RI/RA结果留证，不预判通过。

### D-51. 当前权限下显式绑定原运行的匹配识别准备

用户已批准[evidence/workflow-identification-preparation-binding-scope-proposal.md](evidence/workflow-identification-preparation-binding-scope-proposal.md)，纳入IP-19/IP-21。公共`workflow.resume-run`的strict恢复原因增加`identification-preparation-ready`，仅携带现有类型的`identificationPreparationSnapshotRef`，保留运行引用、expectedStateVersion、HTTP路由、WorkflowPort和workflow.resume能力。缺少reader时拒绝该原因，不退回未核验的内部恢复。

C30复验当前主体和权限、原运行识别准备等待/状态版本，再经C15 `readExactPreparation`及C04完整verified读取正式快照和绑定完成结果。工程修订、完整空间及来源集合必须匹配原冻结事实，原发起人与准备创建者相同；快照中的监测引用若存在须属原冻结范围，原监测和原图版本不替换。错版、范围、主体、撤权、损坏、未完成、取消/终态或错误等待均拒绝，不创建识别子运行。

本次命令建立新绑定，不把独立清洗伪装成原父任务。复用C03事务以父运行级幂等身份固定唯一准备引用并审计真实命令/操作者/当前授权；在事务内复验预期游标，异准备竞争冲突，回执失败重投保持同一引用。已有登记事实不覆盖，原清洗事件、任务、预算和结果不变；公开恢复沿原乐观版本规则，陈旧游标须拒绝。核验后沿已有inputs-ready、入口快照和LangGraph检查点续接，不产生假事件或新状态机。

生产LangGraph恢复控制写会先于识别节点检查准备引用。因而在核验及唯一绑定成立后，先用既有appendEntryFacts登记该父运行的精确准备入口快照；宿主检查点只对identify-and-assess父图识别阶段、同主体已登记的该引用继续经C15/C04证明，不接受任意准备或仅凭恢复载荷放行。v56失败保留，v57实际通过该检查点边界；后续C24授权分支缺口另见待批准D-52提案，不算RI/RA通过。

组合根从既有C15注入窄读取，经真实恢复命令的当前会话派生既有engineering-data.evidence-access，权限、TTL、事务隔离和迁移保持。工程验证后冻结新制品，在物理Chrome执行正式命令并留证原五资料准备、绑定审计、原父/识别子运行；检索7/7不替代RI/RA及其它任务完成。文件边界及回归要求以提案和施工图为准，不增加依赖或UI。

### D-25. 从当前公共接缝接续，不重复实现

完整读取前置 change 的 D-20–D-24 和本 change apply contextFiles。复用 createDeploymentGraphsV1、createDeploymentApiV1、createDeploymentWorkerV1、mainDeploymentV1、runProvisionV1 和 runFunctionalAcceptance。

C19 正式成员通过既有 scoring governance/basis resolver 及各所属模块正文读取；C24 通过 createDeploymentAcceptanceRoutesV1 读取精确登记及 C04；C30 使用 createDeploymentRiskSpatialPairingV1 和 riskInputFacts.readDeploymentRiskScopes。没有调用者的泛化 reader 不构成新增接线义务，也不为让名称出现而绕过现有通路。IP-17 用正式来源验证实际路径；不满足原契约时在该路径修复，不增加第二套来源。对原 4.3 的义务按行为和来源判断。

所有 task 保持既有权限、原版本、一次绑定环与五类 registry。常规确定性评估不创建必经 Agent；RI-S57 候选直接确定性校验；C19 本轮仅配置包治理分支。

### D-26. 当前功能实例固定为隔离合置部署

实例用严格 DeploymentConfigV1、ReleaseManifestV1、DeploymentPolicyCatalogV1 与 FunctionalAcceptanceConfigV1。公开配置只保存精确版本、端点、预算和秘密文件引用；秘密由受限文件加载，不能写入 Git、命令参数、日志或报告。配置 purpose 保持 synthetic-acceptance，本地 C04 和同库 referenceGuard 复用原工厂。

按显式 initialize → 正式授权/资料预置 → 审核发布业务配置 → 精确检索构建和门禁 → API/Worker → HTTPS Web 顺序运行。start 不执行迁移/引导；provision 的原身份重放保留已有密码、回执与事实。原容器和数据不覆盖、不批量清理；新隔离实例输入必须具备实际身份，不用示例值冒充批准值。

模型配置继续前置 D-23 的 MiniMax schema-prompt/low 与指定 Ollama 原生 Embedding；预算不能因为模型失败增加。服务/资料无资格或必需 OCR 缺失记 BLOCKED。mTLS adapter 工程测试不证明正式远程宿主 ready，相关实施与实机义务登记为 C38 F-03。

### D-27. 资料转换资格作为真实前置

以 adopt-mineru-document-ingestion 的官方协议、真实 C04 原响应、新资料版本、来源定位和关键字段质量为输入。读取 references/acceptance/mineru-v2/manifest.json、acceptance-report.json 和 local-benchmark-report.md：V2 五格式及试运行扫描已有源字段/关联/页码合格证据，复用该资格后仍需在本次宿主完成正式资料登记及新转换。官网和自托管证据分开；XLSX/CSV 保持原生解析。V1 扫描缺字段与原分页错误不通过改标签解决。

可先独立验证合格文本/结构化链路，本次正式扫描转换缺项仍记录 BLOCKED，完整范围不能 PASS。expected/scenarios/相关性标签和报告不进入模型。合成现场及检索材料固定五工序、六类机理及已批准约束，本地标识只经真实回执替换，不直接 SQL 播种业务结果。

### D-28. Electron 证据复用同一 HTTPS 和业务身份

当前可用平台以已构建主进程启动 Electron，复用应用 HTTPS 与正式 API，不要求正式安装包或签名。扩展 client.spec.ts 与其 acceptance 预检，使共享对象/独立会话、登录、授权上传下载、撤权、证书拒绝、越界导航、SSE 游标重连和窗口关闭后任务继续均有真实断言及失败 trace。

上传按原页面可用性及正式 provision/C04/C11 入口建立前置，不新增上传 HTTP 或假按钮；文件选择/上传仍受服务端权限。测试不能注入 Cookie/业务结果替代真实登录，不允许 ignoreHTTPSErrors、关闭 sandbox 或 Node 集成。重连不自动重发写命令，原人工确认和幂等身份不变。断网/证书/撤权测试只影响隔离实例和当前 Electron session。

桌面验收 JSON 是测试宿主输入，在 acceptance.mjs 以已有 Zod 定义 strict 结构：schemaVersion="1"、releaseId、projectId、loginName、passwordSecretFile、administratorLoginName、administratorPasswordSecretFile、functionalConfigFile、sharedObjectUrl、downloadArtifactRef、invalidCertificateOrigin、unapprovedOrigin。downloadArtifactRef 复用原 ArtifactRefV1Schema，URL 只限隔离验收目标；sharedObjectUrl 必须属于批准 HTTPS origin，两个拒绝目标须与批准 origin 不同。密码按前置受限文件加载规则读取，报告仅保留引用；不以此配置改变桌面产品或授权契约。任务/运行引用只从 functionalConfigFile 对应的同次正式回执读取。预检拒绝缺项、错工程/发布、非法链接/秘密和非 HTTPS 输入，不增加可任意执行的步骤或 HTTP 操作。

### D-29. 正式终态和可见交互各自取证

复用 synthetic.mjs 的 check/run、固定命令和 checkpoint；functional.mjs 只用 query 模式、显式 maxQueries/pollInterval/timeout 和同次 run 回执。expectedTerminalStatus 与 requiredReferences 不能通过缩减范围避开关键场景。报告保存正式对象、模型/策略/审计/C04 引用、输入身份、命令和失败类别，不保存秘密、Cookie、原始资料正文或思考内容。

覆盖资料/知识/检索 → RI-S57 → 确定性收口/人工复核 → 标准化风险 → 评估/预警 → 建议/人工决定 → 执行反馈，补会话流、拒权、错版本/空间、原身份重试、任务失败与预算耗尽。submitted、awaiting-human、超时、缺引用不能通过；人工发布、采纳与校准由正式确认完成，Agent 不代批。

可见外部 Chrome 访问实际同源 HTTPS，记录真实人工确认、页面和跨页精确追溯；可用 CDP 驱动可见窗口。headless browser harness 仅工程回归。服务重启、回执失败重投、损坏拒绝和索引重建在隔离环境按原契约取证；恢复必须新根、完整核验、确认后切换，不能覆盖原实例。不会把同机副本称为独立备份。

本次工程 browser 的慢读/工程切换场景复验在“切工程须中止在途读取”断言失败（aborted=0），已重试仍失败；测试用固定 26 秒等待后切工程，未先证明切换瞬间存在在途请求。此回归缺口由 IP-21 接续：先核对前置是否成立，测试以可观察在途请求建立场景，再按原单在途/上下文取消契约判断实现。不删除取消断言或放宽并发峰值，也不在没有复现依据时宣称产品缺陷。

同次重评启动场景也在确认按钮点击处失败，trace 显示按钮在视口之外。IP-21 在原确认组件与样式边界内核对长信封/有限视口下的实际可操作性，以自然点击、滚动和键盘完成原确认；不使用 force 点击或增大超时绕过。复用该场景及现有焦点/取消断言，不锁定 CSS 或布局细节。

### D-30. 验收与交付分阶段，不放宽门禁

IP-22 汇总每个 Requirement/Scenario/IP 的工程与实跑证据，必要限定审计为 security、persistence、integration，性能审查只覆盖流/轮询及原硬预算。主调度在已有授权下形成真实 Git 检查点后由 Finalizer 核验及修复，随后写本 change verification；每项实际缺陷、缺证据或待审计阻止 PASS。

当前工程命令为 pnpm verify、pnpm test:browser、pnpm test:deployment；API/Worker 编译保留 8 GiB NODE_OPTIONS。已归档规格严格校验的旧失败属于前置工程门禁，不自动去掉 strict 或顺手改写他人规格。执行时以实际结果分类，并由对应规格责任范围修复后才能声明全仓门禁通过。

正式 signing、安装矩阵、禁网三 VM、远程 host、真实 smoke/benchmark、4090/MinerU GPU 和合同材料由 C38 F-ID 独立规划取证。后续功能 delta 在前置工程 change 已同步后归档，避免重复 ADD 或提前替换不存在的主规格。

### D-31. 模型父工件按清单真实用途预检

用户于2026-10-14授权 C04 接口补充并继续实机验收。合置本地 `ContentAddressedArtifactStoreHandleV1` 增加 `readManifest: ArtifactManifestReaderV1`，绑定既有 registry 的工程与精确工件清单读取；该接缝仅供可信组合根取得受权正文读取参数，不提供 HTTP 清单查询、全库枚举、路径或最新版本选择。

`createDeploymentFoundationV1` 将此接缝交给 `createDeploymentModelGatewayV1`。模型请求先沿当前 C06 复验；每个父引用必须在本工程精确解析清单，再按其真实 `purposeCode` 经现有受权 `artifactStore.open` 完整消费并等待 `verified`。未知清单、撤权、用途/范围不符或摘要失败阻止网络推理；清单及正文不得因预检暴露给无权调用方。模型响应仍使用 `model-raw-response`，父限制和证据仍沿原 C04 继承契约保存。

不更改模型 HTTP DTO、Agent 契约、权限、任务预算或迁移。原失败清洗任务不可续接，修复后用明确的新验收调用取证，保留原失败引用。C04、部署预检回归及正式清洗终态共同构成 IP-19 证据，不把工程通过计作业务终态。

### D-32. 实机目录与 Agent 页面读取

用户于2026-10-14批准 evidence/visible-read-scope-proposal.md。Agent Provider 清空旧工程内容时同步当前代际，保留单在途、取消与迟到响应丢弃。C32 在当前 C06 复验之后，以 C11 登记的稳定 grant identity 关联精确资料版本，校验工程、登记行与引用身份及一对一关联，不将登记时的数值修订身份与当前授权修订 UUID 混用；C06 的修订校验不变。

资料目录首先读取原有分页元数据，再仅对当前页至多50个精确资料引用声明资格并读取清洗摘要。第二次读取不沿用全库游标，客户端保留第一次的总数和游标，只合并精确引用相同的清洗状态。C32 仅消费当前返回页相关清洗工件，按原清洗结果用途完整读取并等待 verified，保持4MiB上限；缺权、缺失、损坏或无正式结果时不投影可用状态。不新增 HTTP 字段、权限策略、迁移、依赖或预算，也不改写实例既有事实。

### D-33. DOCX 标准字符引用保持正文语义

用户于2026-10-14批准 evidence/docx-entities-scope-proposal.md。既有XML库不能在保持HTML实体关闭的同时解码数字字符引用，因此在文本读取边界只还原XML预定义及合法数字字符引用；CDATA通过库的cdataPropName保留身份并按字面读取，不重复解码。所有XML解析前继续拒绝DOCTYPE/ENTITY并执行现有包与文本资源上限，不引入外部实体、HTML实体或依赖。官网规范化继续严格比较原DOCX结构正文和服务正文，不关闭一致性或质量门槛。以原资料、质量、模型及预算发起新转换身份，保留旧失败。

### D-34. 清洗模型上下文与失败恢复

用户批准 evidence/cleaning-model-context-and-recovery-scope-proposal.md。可信组合根通过原C15 loadFrozenInput提供冻结集合内的真实资料/段及样本定位，清洗模型仅从原两种领域工具选择有界切片。上一轮观察经精确C04用途、当前授权、完整消费与verified读取，且必须绑定同一冻结清单，再进入受原字节/token预算约束的模型消息。任务信封继续只存引用，不新增模型通用工件工具、HTTP字段或依赖。

集合外输入和权限/工件失败保留正确错误分类；不可重试失败必须终止并留证，不能泛化为模型临时故障。可安全重试的失败行动沿同动作、原冻结输入与累计预算恢复；失败恢复读、重放或预算不足不得反复claim空转。原失败任务/attempt不改写。技术恢复只按原契约续接；模型输入或提示策略身份变更时，使用新版本及明确的新任务取证，不能把新运行计作旧任务通过。

### D-35. 有界定位分页、行动剩余额度与实际失败结算

用户批准定位分页/预算提案，并授权提高新任务预算。清洗工具增加strict动作`read-cleaning-preparation-catalog-slice`，指定冻结sourceVersionRef和非负offset，每页最多原maxSegmentsPerRead，返回精确段标识/种类及nextOffset；越界和撤权拒绝。清洗toolPolicy可声明preparationCatalogToolRef，只有明确登记该引用的版本提供此工具，不增加通用工件读取。初始模型消息提供全部资料身份、种类、段数及可选监测身份；正文和段定位分别经原受权切片和新有界定位工具读取，冻结清单完整保存，不截断或拆分任务。

StructuredCompletionRequestV1增加可选maxInputTokens/maxContextTokens。Agent请求必填，由本次已预留行动的额度给出；无预留调用按已使用及已预留台账计算。网关以请求额度与部署上限较小值约束保守上界或实际tokenize，联网前拒绝不足；响应usage继续按相同额度核验。maxOutputTokens继续使用原字段并受剩余输出及上下文额度限制。模型响应后解释/校验/结算失败时，Worker保留实际usage、原响应与行动回执。core settleAgentBudget仅在预算失败终态允许记入实际超额usage，C08 failAction记录后不可重试；正常完成、reserve、恢复和权限约束不放宽。

按16份/595段及两次实际输入7,793/8,635定额。新清洗版本累计input128K/output32K/context192K、模型40/工具64、inputBytes2MiB/outputBytes1MiB、对象2048、候选8、修正2、瞬态重试2、并发1、墙钟30分钟。知识编制input192K/output64K/context256K、模型24/工具48；处置input64K/output32K/context128K、模型16/工具24；校准input64K/output16K/context96K、模型12/工具16。各类型的字节/对象及既有业务规模分别冻结到实例策略；网关结构化单次输出上限32K，模型身份及部署context1,000,000保持。技术预算不替代质量门禁；新任务按新精确策略启动，旧上限和失败事实保留。

### D-36. 原件窄读与默认原件视图

用户批准original-document-and-agent-ui-correction-plan.md并要求实施。新增engineering-data.source-original-read，复用engineering-data.read能力。JSON strict请求只含精确sourceVersionRef；元数据DTO为kind=source-original、sourceVersionRef、sourceName、registeredBy、registeredAt、deliveryKind、originalFileName?、fileName（安全下载名）、mediaType、byteLength、previewKind(pdf/image/text/download)。登记者和时间取C11版本登记事实；快照与上传原件按真实deliveryKind区分。file-upload descriptor增加可选originalFileName，旧记录不造原文件名；目录投影真实sourceName。reader复用C11 resolveSourceVersionForRead的历史窄口、C04精确清单及真实用途，不用只允许当前工程修订的processing入口。

同源GET /api/v1/projects/:projectId/sources/:sourceId/versions/:versionId/original接独立当前会话/精确资料授权，disposition仅inline/attachment，不接受artifactId/路径/外链。C04完整消费及verified成功后才发送成功二进制；临时根受控、0700/0600、随机名，每进程并发2/原件100MiB/暂存200MiB/读取传输120秒，断连异常finally清理。响应no-store/nosniff/正确媒体与安全Content-Disposition；不支持Range。读取不依赖转换、清洗或Worker，当前拒权/损坏/缺失零正文，已有保存文件不承诺撤回。

资料详情默认原件页签：PDF使用pdfjs-dist@6.3.289在Canvas/文本层显示原件，按页有界；位图原图、TXT/CSV纯文本、DOCX/XLSX原件下载后用户本机软件打开。解析清洗为辅助页签。Web显式同版本PDF依赖，官方mozilla/pdf.js、Apache-2.0，本地worker离线随包，不用CDN/unsafe-eval；移除PDF预览时删除Web直接依赖。Electron挂同源批准路径下载并由用户选择保存，不放宽iframe/窗口/Node/IPC或自动打开文件。

### D-37. 唯一外壳的Agent贡献

Electron实机发现既有certificateVerifyProc固定回调-2，拒绝所有证书；删除该覆盖并使用Chromium默认受信链验证。保持无效证书失败，不添加忽略错误、放行回调或新的CA配置字段。

RightDock注册真实AgentTaskProvider贡献，普通页能选任务并进入工作台；未选任务有真实空态，侧栏/工作台/详情共享精确任务、安全行动工具引用、预算与结果。无证据时不触发过期effect自动关闭；跨页保持面板，切工程/注销清空，单在途/有界分页/终态停止保持。旧独立AgentDock开关复用或删除，不能保留两套面板状态。候选404按实际strict投影修复，真正无权继续失败；不暴露原响应/思维链或通用工件下载。

### D-38. C17证据身份和复核动作

两份knowledge-evidence-scope-proposal/review-action-availability-scope-proposal一并批准。受信调用来源携带已声明scope/source元数据，composition仅对未声明范围继承冻结声明，显式范围继续C06复验。每组证据用独立可重放身份，验证工件按提交命令隔离，保留包摘要及旧验证。pending复核的actions由可信宿主对当前真实会话签发独立decide分支只读判定；终态/撤权/无权关闭，不写决定或改角色权限。人工批准保留确认及独立发布。

## Risks / Trade-offs

### D-39. 正式适用规则集组装入口及隔离合成来源策略

用户已批准[evidence/applicable-rule-set-entry-scope-proposal.md](evidence/applicable-rule-set-entry-scope-proposal.md)。增加`knowledge-modeling.assemble-applicable-rule-set`命令、`ApplicableRuleSetAssemblyPortV1.assemble`及同名HTTP command路径，复用现有`knowledge-modeling.govern`能力。strict payload只含精确评估准备引用、requiredAt、评分/组装策略、兼容及配置集合引用。工程/actor取信封，工程修订及适用性引用/值取C11生产准备投影，记录边界取issuedAt。成功只返回待审修订及候选工件，不自动审核发布。

当前治理权限先复验；受信组合根另签同来源assessment-basis读取授权及submit-revision治理授权。复用C19组装、C18配置解析、C04及C03/C16，不复制算法。复验准备、工程修订、适用性值及精确策略/配置绑定；错配在候选成功写入前拒绝。同键同载荷沿原回执、异载荷冲突，当前撤权不重放成功。部署SingleBinding接真实C16提交，保留评分Agent编制不可用边界。无新依赖、表或迁移。

当前隔离工程的新策略`physical-scoring-rules-policy@physical-20261015-v2`在原来源集合增加`synthetic-scoring-rule-values`，保留合成标记与待甲方复核；不修改生产通用允许集合或原业务规则。冻结新目录/配置/发布身份后切换宿主，旧策略/失败保留。完整接口、文件边界与验收要求按上述批准提案。

### D-40. 检索投影窄授权与父图冻结版本

用户已批准[evidence/projection-authorization-and-graph-version-scope-proposal.md](evidence/projection-authorization-and-graph-version-scope-proposal.md)。C06发布命令因果授权只允许identification-basis与hybrid-evidence两个明确分支，后者使用已有retrieve能力；保持真实人工发布根、工程/主体、当前发布权限、原有效期、资料/空间范围及目标分支精确派生关联检查。其它分支、未关联、错命令或过期继续拒绝，不重绑旧上下文或重置投递次数。

C30的graphStateOf使用已登记cursor.graphVersion，缺省使用同运行run.graphVersion；入口摘要不作为图版本，恢复不选择当前最新图。复用既有状态Schema、检查点校验及业务登记；真实检查点回归要求启动图版本。无新增依赖、迁移、表或HTTP字段；文件范围和验证按批准提案。

同文件内恢复缺陷沿既有部署主规格“当前授权独立于历史状态”修复：恢复将业务阶段映射到原LangGraph节点名；节点更新保留检查点的启动授权引用，当前恢复授权仍由runtime context独立复验，业务提交仍记录当前授权。不得删除启动收据的授权匹配条件或借过期上下文执行当前动作。

### D-41. 检索质量门沿原消费者事务窄读

用户已批准[evidence/retrieval-quality-transaction-scope-proposal.md](evidence/retrieval-quality-transaction-scope-proposal.md)。HybridRetrievalBuildQualityGateV1.evaluate(input, context?)增加可选既有TransactionContextV1，投影handler传入当前C03消费者事务，部署质量门将其原样交给generationStore.readGeneration。独立测量已提交代际仍可不传上下文；不暴露数据库句柄、不新增或拆分事务。

质量门继续精确核对正式代际、工程、发布、策略、成员、模型、清单及当前权限，独立测量双路、融合、对账、泄漏与p95；报告耐久保存后才允许ready/激活。事务外不得读到未提交代际，失败保持非活动，旧失败不重写。真实后续证据使用新人工发布及精确新发布绑定的同阈值数据集，不改标签、预算或投递次数。无新依赖、HTTP字段、表或迁移。

实跑范围内接线核对：质量门沿D-40已批准的hybrid-evidence/retrieve上下文复验及请求Embedding，不能把同一上下文误作read能力。C06角色、能力映射、因果关联及当前复验不变，只有read能力仍拒绝。隔离策略的projectionCompatibilityRef按真实Qdrant服务与原向量配置的既有函数冻结为新版本，保留旧手工标签及失败，不改变兼容算法或质量阈值。

### D-42. 标准库检索正文与稠密查询指令

用户已批准[evidence/retrieval-semantic-content-scope-proposal.md](evidence/retrieval-semantic-content-scope-proposal.md)。C17 `StandardLibraryEntryV1` 增加可选 `retrievalText`，只由条目已有 evidence 在精确 preparation snapshot 和当前权限下读取的真实 C11 资料段正文按既定顺序及统一换行拼接；无正文不造摘要，超预算拒绝且不截断。验证只通过窄 `checkStandardRetrievalText` 接缝，拒绝缺读取能力、错版、越界、撤权、损坏或正文不符，复用既有 preparation knowledge reader 与 C04/C11 读取。

共享 `retrievalMemberText` 将已验证正文纳入标准库成员文本，并供投影摘要、构建和事实回查共用。`HybridRetrievalPolicyV1` 增加可选非空 `queryInstruction`；同一 core 渲染函数生成 `Instruct: {instruction}\nQuery:{queryText}`，仅作用于稠密查询，文档 Embedding 与 BM25 仍使用原文，不设置时保持原查询。质量门每次实际模型调用使用同一独立invocationId/idempotencyKey，避免不同策略或测量轮次复用旧响应工件。原 C16 人工审核、独立发布、权限、预算、标签和质量阈值不变；正文、新检索组合和策略以新发布/代际承载，不改旧事实，也不预判质量通过。

### D-43. 标准原文输入补充

用户已批准[evidence/standard-source-ingestion-scope-proposal.md](evidence/standard-source-ingestion-scope-proposal.md)。本次验收输入在原16份治理资料之外补充STD-001/002/003标准真实原文，形成新的正式准备版本；来源身份、取得渠道、许可及文件摘要先固定，复用`references/acceptance/synthetic-v1/sources.json`登记的标准号、定位、适用性与已废止限制。既有C04/C11正式登记、MinerU转换与质量门、C15清洗与准备冻结及C17真实证据正文与窄校验不变；新标准条目的evidence与retrievalText只从新准备中的相关真实段确定性构造，保留原entryId、标准版本、条款时间状态和适用范围，经物理Chrome人工批准并独立发布，形成新的检索组合、精确引用策略与新代际。

实现Agent不读取研究原件；受保护原文只经受权资料入口交给正式转换服务，Agent只消费C11/C04受权产物。原query、relevance grade、TopK、质量阈值、模型、预算、权限及旧失败不变；新输入仍按既有清洗预算执行，不足如实失败并另行决定，不自动扩容，也不保证补足原文后必然通过。不新增生产代码、公共契约、依赖、迁移或HTTP字段；真实资料或读取资格缺失时如实停止，不合成条款或改标签，不伪造inputs-ready或复用无关运行；与后续业务只在正式父运行接缝允许时绑定，必须改变运行因果或公开契约时另以实际证据升级。

### D-44. C04 读取块字节稳定性

用户已批准[evidence/c04-stable-read-chunks-scope-proposal.md](evidence/c04-stable-read-chunks-scope-proposal.md)。`filesystem-artifact-store.ts` 的 C04 文件流仅在原输出边界把 `yield chunk` 改为 `yield Uint8Array.from(chunk)`，每块交付独立字节；消费者保留块并在 EOF 后拼接或继续读取时，先前块不再被复用的 1MiB 缓冲区改写。保留原 1MiB 分块、有界读取、EOF 长度/摘要、当前授权、审计、取消与 `verified` 时机；不新增第二摘要、整文件缓存、Schema 或 HTTP。

既有 `content-addressed-artifact-store.test.ts` 的大文件用例改为多块不同内容并继续保留块后拼接，核对首次读取、重放、完整消费及取消，复用原大文件性能/资源基准；两个文件纳入 IP-19。新转换身份复验保留旧失败，原件与磁盘工件不变。

### D-45. 官网图表结构映射与来源专用空白页策略

用户已批准[evidence/mineru-layout-and-source-quality-scope-proposal.md](evidence/mineru-layout-and-source-quality-scope-proposal.md)。实机边界（v37）与画布复核见[evidence/mineru-standard-conversion-v37-2026-10-15.md](evidence/mineru-standard-conversion-v37-2026-10-15.md)：STD-001第9、51页无正文，STD-002官方布局含chart结构，STD-003耐久ZIP中所有`eq`均无属性。

IP-19生产代码限`packages/adapters/src/engineering-data/document-conversion/mineru/official-normalization.ts`与`normalization.ts`，测试限对应`packages/adapters/test/engineering-data/document-conversion/mineru/official-normalization.test.ts`与`normalization.test.ts`。官网规范化仅扩展已观察结构：span增加`chart`；块增加`chart`、`chart_body`、`chart_caption`、`chart_footnote`；`chart`容器沿既有递归映射，`chart_body`在验证`chart` span后映射为共享结构要求的惰性图像载荷；图注与脚注保留真实文本及源坐标。图像内容不推断为文本、指标值或公式值，原图路径与完整响应仍可从原始工件追溯；未知类型、协议版本、越界坐标与资源超限继续拒绝。共享表格HTML文本在既有`INLINE_TAGS`增加`eq`：沿既有递归读取字面公式文本，不渲染、不求值；`eq`属性、DOCTYPE/ENTITY、危险/未知标签、表格结构与资源上限检查保持不变，不新增HTML渲染或公式引擎。

实例仅对精确STD-001原件摘要`5fe30dfae8d3cc5cb658980220c4e9fcd98163e8e067cfa4542cbe80f531df6f`建立来源专用质量策略引用，`minNonEmptyPageRatio`由1调整为`97/99`，`minKeyFieldCoverage=1`及原keyFields不变；正式转换后、下游清洗前必须核对完整99页映射、非空97页、无正文页恰为`{9,51}`及原件摘要/策略精确匹配，任一不符停止并保留结果。该精确页集合只属本次来源验收断言，不进入公共Schema或运行时字符串门禁。STD-002/003及既有16份资料保持原策略；模型、服务通道、权限、资源预算、检索query/grade/TopK与七项检索质量阈值不变。冻结新本地发布制品与`converterDeploymentRef`，按既有C11正式入口建立新source-version并固定原件、来源限制与新转换身份；保留v36/v37失败、原响应、历史资料版本与旧下游引用，不直接SQL写入业务事实。真实重转完成前不声明通过。

### D-46. 表格图片载荷及清洗观察

用户已批准[evidence/table-image-payload-scope-proposal.md](evidence/table-image-payload-scope-proposal.md)，纳入IP-19。文档转换SSOT新增strict `UnrecognizedTableImageRefV1Schema`，字段为kind=unrecognized-image、rawResponseArtifactRef和安全规范化packageEntryPath。cell及TableField可带有界非空unrecognizedImages，图文保留真实文字，纯图value=null并保留逻辑行列/合并关系；图片及路径不进入textBlocks或质量文字覆盖。官网仅在完整性通过的本次耐久ZIP中唯一解析已实测的自闭合img/唯一src，对JPG/PNG沿既有预检核验；外链、data URL、包外/绝对路径、缺失/歧义条目、额外属性和活动内容拒绝。自托管不猜测图片来源。资源、协议和权限沿原约束。

C15冻结文档可带实际unrecognizedTableImageCount，初始消息显示；受选表格观察包含同表纯图单元格的未识别引用和行列，复用索引有界读取，不投影全库。相关段parsedFingerprint纳入同表图片引用，无图片沿原指纹；jsonLdFingerprint保持完整结构。观察引用、对象和字节计入原预算，超限失败，不截断、不新增通用工件或视觉工具。原部分可用规则、人工发布及C17真实文字拼接不变。新发布与converterDeploymentRef下只对STD-002经C11新source-version重转，STD-001/003保留已合格v38引用；三份合格后再推进19资料清洗准备及原检索质量门。

### D-47. 正式 JSON-LD 读取边界

用户已批准[evidence/jsonld-read-bound-scope-proposal.md](evidence/jsonld-read-bound-scope-proposal.md)。文档转换Schema导出共享`STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1=16*1024*1024`，C15复用既有16MiB文档边界；内部reader仅执行调用者上限，观察与清单保持原限额。C17仅在`checkStandardRetrievalText`读取精确证据涉及的转换JSON-LD时使用16MiB，单条标准核验的累计工件读取也限16MiB；其清洗清单、候选包及其它读取仍限4MiB。超限拒绝，不截断，当前授权、准备绑定、保留资格、完整消费与verified及证据顺序/正文精确匹配不变。此上限用于确定性读取，不扩大模型、工具输出、正文、候选包、检索query/grade/TopK或七项质量预算。

### D-48. 长时Agent任务的当前授权

用户已批准[evidence/agent-task-current-authorization-scope-proposal.md](evidence/agent-task-current-authorization-scope-proposal.md)。C08通过唯一内部`readExecutionAuthority`窄读从精确任务和当前Worker租约核实可执行状态、取消标记与原预算；C06显式注入该端口，按真实任务启动上下文及原部署分支关联读取受理依据。仅真实可执行任务可把原启动授权用作不可变范围上界，每次行动前重新核对当前账号/安全版本、成员、角色、空间、资料和策略，再用既有agent-task身份签发原5分钟短效授权，保存任务/父运行及动作因果审计。普通授权期限、撤权与人工确认保持，任意过期上下文不能续用。

Worker作用域携带精确任务和可信租约，统一接模型、C04和领域工具。执行授权不替换冻结信封或原工件/命令身份：当前授权复验及签发成功后，既有领域参数继续引用原受理身份以保持幂等；该身份本身不再是长任务执行资格。范围不符、取消/终止、租约失效、预算耗尽、安全版本变化和审计失败在受保护行动前拒绝。部署之外的普通verify保持原到期拒绝，不保存会话token、不扩大分支白名单、模型额度或检索门槛。

### D-49. 已完成清洗任务以当前授权收口准备

用户已批准[evidence/cleaning-preparation-completion-scope-proposal.md](evidence/cleaning-preparation-completion-scope-proposal.md)。既有freeze新增complete-identification-preparation分支与同名HTTP命令，payload仅完整agentTaskRef，复用engineering-data.freeze能力及原成功DTO。新命令使用当前真实会话与新身份；C15精确读取自有结果索引，并经注入C08核对原任务completed、主体/工程/冻结输入/策略及结果。当前空间/资料权限、C04清单/结果完整性与覆盖校验完成后，复用原摘要生成唯一准备快照，不重跑Agent。原已存在快照在当前复验后返回，命令独立留审计；C15结果行在原C03事务内串行核对，快照和inputs-ready只提交一次，决定工件按本次完成命令隔离写入身份。

结果表只授予SELECT/INSERT；串行收口在既有事务内按精确工程/任务取得advisory lock，不新增UPDATE权限或修改结果行。原repeatable-read的竞争事务若看不到首次快照，沿可重试事务失败重投，不重复事件。新事件使用真实完成命令因果；组合根从受权清单工件清单的真实授权引用定位原准备命令，从C08冻结输入与C06原任务来源/父关联证明同一因果，原父图再经既有事件消费者的C03运行绑定证明；独立准备不会绑定父图。过期原授权只作来源证据，不提供执行资格。普通TTL、D-48租约、旧失败、冻结输入/策略/预算及事件DTO保持；无迁移、依赖或新状态机。具体失败/幂等/并发/因果验证及文件范围以提案为准。

### D-50. 检索相关性按精确证据复核

用户已同意[evidence/retrieval-acceptance-target-decision.md](evidence/retrieval-acceptance-target-decision.md)第一条路线。冻结v51组合和其15个正式成员，通过当前C06人类授权、C17精确发布及C04完整读取核对语料；仅准备新的验收数据集候选，不改生产检索实现。旧6个查询文本保留，逐一核对全部15成员，并补独立规范查询，覆盖风险分级/接受、监测依据/限制、警情报送及已废止条款的历史技术内容。

评分按“是否直接回答所问”统一：3为核心问题有明确匹配，2为核心问题的直接部分且限制明确，1为明确次要子问题的直接答案，0为无直接依据或仅共享背景/未询问的监测与后续行动。所有正标签须有条目字段和正式源证据；相关性不改变条款效力或业务适用性。没有对应证据不得因同属一份规范推断相关；不能以漏召回为理由删标签。辅助复核仅提供冻结语料、查询和规则，不提供旧标签或历史排名；主Agent保留自己的初稿及分歧裁定，不冒充未看过历史结果。

候选沿DeploymentRetrievalDatasetV1Schema、原正式成员引用和合成样本标记；文档侧保存全矩阵、理由、差异及未决项，不扩展运行时Schema。用户已明确确认v13具体候选：原6查询文本保持、原13正标签保持、移除8项无直接回答依据的标签并新增4个规范查询/正标签。冻结为正式测量输入后只允许随真实新组合发布重绑组合引用，成员、query及grade保持。旧数据集及v52 FAIL不覆盖，模型、TopK、预取、权重、七项门槛、权限和资源预算保持。没有迁移、依赖、HTTP、原文重转或已发布定义修改。

### 2026-10-14 执行输入补充（用户已批准）

D-28 的桌面测试输入增加必填 `functionalReportFile`，指向本次 `functional.json`。预检沿该文件所在目录读取 `synthetic/run.json`，复用功能观察器的配置摘要核验，要求两个报告的 `runId` 一致；运行、查询及资料引用只从对应的正式回执取得。共享报告页的精确查询引用须匹配回执，发布身份须与 `RISKFLOW_DEPLOYMENT_CONFIG`、`RISKFLOW_RELEASE_MANIFEST` 的原 strict Schema 及报告代码身份一致。该字段仅属于测试宿主，不改变产品 DTO、业务权限或任务预算。

IP-22 纳入用户批准的两项机械修订：12 份主规格长 Requirement 的无损精简；5 个既有 adapter/测试文件的 Prettier 格式修复。保留全部行为约束、Requirement 与已有 Scenario，不改归档历史、公共契约或依赖。具体文件见施工图补充。

本次物理桌面执行中，用户明确授权接受 Ollama 的微小版本不符并生成合成验收运行策略。当前实例按实测 Ollama 0.40.3 记录 `expectedServerVersion`、服务契约和新的部署版本引用；模型名称、权重摘要、2560 维及既有网关预算保持不变，不全局关闭版本核验。十六类策略按原 core Schema 编制，限定 synthetic-acceptance；技术配置授权不代替业务知识/配置的正式审核发布。安全副本与校验结果见 evidence/runtime-policy-catalog.json、runtime-policy-validation.json；未取得的正式风险、现场、预测/校准及规范审核引用保持待绑定，不计作功能 PASS。

IP-21 的物理窗口发现生产入口未加载已存在的主题令牌和全局样式。用户已授权在 `apps/web/src/main.tsx` 增加两条导入，按既有样式复验真实布局、确认和切工程行为；不改变业务契约或引入页面副本。

- 当前真实环境和批准输入未齐，规划 apply-ready 不表示可以直接声明业务 PASS。
- 扫描质量前置失败会阻塞完整功能报告，不能把局部文本运行当作完整通过。
- V2 parser 合格仍需本次正式 C04/C11 新版本，不能沿用临时报告中的工件身份。
- 网络服务版本、使用量与可用性必须按本次事实复验，旧 smoke 不能证明当前业务运行。
- dirty 前置实现需要独立检查点；本轮不提交、不修改编排状态。

### D-87：从同次业务登记恢复已提交阶段增量

依用户持续授权修正C24恢复接缝。阶段结果与游标同属C03原子提交，游标的可选lastStageResultRef不能作为唯一恢复来源；恢复从本工程、本运行且runVersionId等于当前游标的唯一stage-result登记读取精确C04正文，核对原阶段与完整运行身份后补齐mergePlanRef等既有增量。缺失必需结果、多义或引用/正文错配均封闭，不按时间选择结果，不重跑已提交合并或补写业务事实。没有显式指针的正常等待/终态游标不因与检查点指针不同而被判为领先；运行中断及阶段/状态差异仍触发对账，已能读取pendingWrites的中断也须继续原运行。无候选的既有I6直达I9路径保留，不构造空合并计划。

v90b父子已经终态，保留五份校验结果、原I6及错误证据，不恢复或改写终态。先用既有检查点故障夹具复现I6丢失，再验证恢复到正式后续阶段及合并仅调用一次；工程验证后再进行新的正式验收批次。无公共Schema、事务语义、依赖、迁移、权限或模型预算改变。

### D-88：并发取消后阶段不得重新推进终态

D-87全量回归暴露取消与恢复竞争：恢复已经通过入口版本检查，但取消在下一阶段读取游标前提交时，阶段读取到cancelled游标仍继续，并以该终态版本作为新提交前置。依持续授权在C24唯一阶段游标读取处识别已提交终态，停止尚未开始动作，以既有VERSION_CONFLICT拒绝推进；错误收口也须保留并发终态，不追加失败覆盖。原C03锁及预期版本核验保持，已开始的动作仍沿原提交冲突收口，不复活或回滚既有事实。正常终态重放仍由runtime返回原回执，不声明新的取消或推进。

仅扩现有恢复/取消竞争测试的确定性调度分支：先让恢复经过入口检查，再让取消提交，最后释放恢复的下一效果，验证只有取消成功、无后续分析/合并或运行结果。无公共DTO、依赖、迁移、预算或权限变化。

### D-89：受控预置支持监测序列与可用性策略

实例只读核对确认监测序列修订、可用性策略均为0，既有批次/快照入口因此缺少前置。依持续授权，在既有provision命令新增monitoring-series-revision与monitoring-availability-policy两种步骤，直接复用MonitoringRegistryV1已有reviseSeries/registerAvailabilityPolicy、strict命令Schema及foundation.monitoringStore。步骤只提供领域payload，命令身份、工程、主体和当前授权继续由宿主注入；沿原engineering-data.write授权、C03事务/幂等和审计，不直写表，不改HTTP/能力位或领域规则。

报告按既有结果结构保存精确MonitoringSeriesRef或裸availabilityPolicyRef版本引用，供后续模板绑定；序列结果必须优先于其内部spatialScopeRef投影。失败步骤保留结构化错误并停止，已完成步骤恢复不重复写入。实际初始化须重绑当前正式工程/空间引用，使用原合成监测值和已声明算法要求，不改旧快照、来源或样本。策略正文另以显式新版本配置，不设隐式默认。该入口属于运维预置，不新增业务页面。

### D-90：显式单函数参数结构化输出

v95合法JSON仍违反嵌套关系Schema，不能继续靠重复批次碰运气。依用户持续授权新增openai-chat部署的显式structuredOutputMode=function-call；同一Zod Schema生成唯一emit_result函数parameters，固定适配器system消息要求只通过该函数输出。仅发送官方声明的tools，不发送未在M3.1规范中声明的tool_choice或strict，不执行任何函数或领域工具。不隐式切换模式、模型或重试。

线协议仅接受相同模型、单choice/index0、finish_reason为tool_calls或stop、恰一type=function且name=emit_result并携非空arguments字符串的调用；两种正常终止取自官方规范与测试的交集语义，仍须存在唯一函数结果。content允许缺省/null/空白，非空结果正文、额外调用、错名、缺调用或截断拒绝。arguments须为完整JSON，仍经原额外字段检查及原Zod refinement，失败保留C04原响应和真实消耗。成功映射为既有completeStructured已完成stop语义，原终止事实可从耐久原响应重建；会话流终止枚举不变。旧两种模式的线协议与拒绝语义保持。

先扩既有网关测试证明新模式及拒绝边界，再在隔离实例新建同模型/low/预算/上下文的部署和精确策略引用。先一次真实小Schema诊断及真实第三工序冻结输入的有界预检，不直接重跑全链；预检止于候选/合并领域写入前，记录调用/消耗，不计业务PASS。v95终态不复活，后续正式批次独立记录。当前部署仍v95；新模式未经真实证据前不宣称可靠。

v96预检发现部署秘密唯一性把同一模型凭据的重复引用也纳入主体秘密冲突。仅将模型credentialRef按集合列为所需秘密，允许同服务不同精确部署共用受限凭据文件；HMAC、各数据库登录主体、OCR及模型凭据之间的重复仍拒绝，secretFileRefs自身身份必须唯一且所有引用必须已声明。不复制或修改密钥；失败v96工件保留，下一暂存使用新身份。

### D-91：独立合成纵向监测输入

依用户对验收必要修正的持续授权，按evidence/monitoring-input-correction-plan.md补齐输入，不把原72个case当作单测点历史。原CSV及派生monitoring.json均保留。本次增加独立情景SYN-PHYSICAL-LONGITUDINAL-001，监测对象标注“合成情景、待甲方复核”，只绑定当前正式工程/空间，不推断真实测点或几何。

输入限同一新地表沉降序列（ground-settlement，mm）的三份独立CSV：2026-10-16T00:00:00Z起每秒一条共16个预定采样点，值为1+0.4*i；初始资料缺i=7、保留其余15点，补录资料仅含i=7，更正资料仅将i=15的7.0更正为6.8并记录原值和原因。每行显式保存情景、对象、采样键、采样时刻、指标/参数、值/单位、合成标记和生成规则；初始、补录、更正各自成为C04/C11新来源，正式资料段引用只能从实际转换取得。生成器自检时间唯一/有序、成员集合、原值和更正范围，不能把预期数值当作正式业务证据。

序列可用性策略使用新版本：16秒窗口、1秒间隔、不插值，斜率/加速度各5点、频谱16点、异常基线5点，异常尺度下限0.1、频谱能量下限0、最小覆盖率0.9、频谱最大样本32；算法版本沿既有alignment-v1/slope-v1/acceleration-v1/frequency-v1/anomaly-v1。缺点、补录和更正通过原批次/快照语义取证，旧快照必须稳定；预测仍须满足其自身前置，不据时序存在就宣称预测通过。指标映射、预警阈值、评分/权重/矩阵、质量门、模型和预算不变。

复用原CSV确定性转换、C15清洗与准备、D-89受控预置、既有批次/快照公共入口，保留当前授权、C03幂等与审计。仅增加本change文档与实例新输入/配置/脚本/回执，不改生产代码、公共契约、依赖、迁移或旧发布。当前正式识别驱动在途时只准备文件，不导航或发送新控制请求。

### D-92：置信度策略区分必需依据与未参与依据

v97五个I5及I6已正式提交，I7因required-basis-unavailable:multi-source-merge终态。只读原合并计划重放确认策略/工作计划/五份校验集/目标组均可读；第一个未合并组不存在多来源合并贡献，当前实例requiredBasis却将其设为必需，同时missingBasisBehavior=block也会阻断未声明的零权重仿真。该拒绝符合核心与主规格，是本轮生成策略的适用性错误，不修改计算算法或伪造合并/仿真证据。

依持续授权建立隔离验收新策略版本：requiredBasis仅model-confidence与rule-consistency，missingBasisBehavior=exclude-and-renormalize。原权重0.3/0.4/0/0.3、舍入4位、自动阈值1、forced-review-policy-flag和merge-ambiguity均保持；缺少任何必需依据仍阻断。未参与的依据保留available=false及零贡献，实际合并存在时继续纳入其真实贡献，不伪造通过或降低候选确定性校验。强制人工复核不会因归一计分取消。

先通过当前C06/C04读取v97已提交的全部分组与校验集，以原核心纯函数验证所有组在新显式策略下可计算、未参与依据零贡献、所有组仍须人工复核；再严格解析新部署/目录并深比较除缺项规则及关联精确引用之外的正文不变，冻结新发布。旧v97父子终态、合并、模型原响应、预算和失败保持；后续正式运行使用独立批次，不复活或改写旧状态。此项仅修改当前change文档和实例新策略/部署/制品/诊断工件，无源码、公共Schema、依赖、迁移或权限变化。

### D-93：原生CSV清洗的显式输入策略

D-91三份新来源已正式登记及原生转换，C04完整读取与C11精确段登记证明各一条table段；原清洗策略只允许已列来源质量引用且要求chapter，因此新的identification-preparation在启动任务前正确返回BUSINESS_BLOCKED。两次读取脚本误用JSON-LD段字段的失败只属诊断脚本，原工件不变。

依持续授权对隔离实例下一清洗策略明确纳入该三份原生转换实际使用的mineru-synthetic-quality@2026-10-11引用，并将requiredSegmentKinds从chapter改为table，以对应本次确定性CSV结构。protectedSegmentKinds仍为chapter/table/monitoring-window，全部留存、样本留存和资料覆盖门槛均1；允许转换策略/部署、工具、模型/提示、Agent定义/预算及其它规则保持。清洗策略目录/正文/工程绑定使用新精确版本，旧策略及失败保留。该宿主只对新增CSV发起新的清洗任务；原五资料与治理准备继续按自身冻结快照读取，不重清洗或把表格要求应用到旧结果。

先通过真实C04/C11核对新三来源均有唯一成功转换、所需质量引用及非空表格段，再用新策略现有Schema及确定性清洗判定自检保留类型和100%门槛；冻结新配置/发布后仅以新命令发起这批CSV准备。未生成任务的旧422回执保留，不复用旧issuedAt/命令身份冒充新策略执行。无源码、公共接口、依赖、迁移或领域算法修改。

### D-94：监测预置使用所属操作授权分支

D-89实机序列预置被当前授权复验拒绝，未写入序列/策略。provision统一签engineering-data.register-source-delivery，而既有MonitoringStore.reviseSeries/registerAvailabilityPolicy按engineering-data.register-monitoring-batch复验同一调用身份，能力虽相同仍不能互换分支。依持续授权仅在provision的这两种监测步骤选择已有register-monitoring-batch分支，其它步骤保持原分支；不修改C06、能力、store或事务。

在既有参数化监测步骤测试核对完整宿主授权的所属分支，先证明旧实现两例失败再修复；保留原严格字段、失败停止及幂等恢复测试。实际失败报告保留，新配置使用新runId/回执继续相同尚未登记的序列与策略。源码范围仅scripts/deployment/provision.mjs及provision.test.mjs，无公共DTO、依赖、迁移或权限变化。

### D-95：有界清洗保留已完成读取事实

v99三来源清洗任务终态AGENT_INPUT_INVALID，原26次模型/26次工具、88,224输入/3,851输出tokens保持。C04原行动记录只读抽取确认26个请求仅9种不同载荷，反复目录0/末页和已读正文；最后以baseline来源请求三来源段ID，C15正确拒绝。runner只把最近观察交给下一模型步，先前成功读取事实被丢弃；不能通过重开任务碰运气、放宽资料边界或扩大预算解决。

依持续授权扩Worker内部AgentModelStepContextV1，增加可选completedToolCalls，元素仅含toolRef、已通过strict解析并完成的input和observationArtifactRef。runner在工具成功登记后追加；恢复时从同一任务已完成模型/工具行动的原C04证据与pendingTool配对重建，失败、未完成及其它任务不入列。数组由原任务硬工具预算约束，不增加数据库、持久化状态或第二套记忆，不保存模型思考，不改动作执行、取消、租约、幂等或预算流程。

C15渲染增加结构化completedReads：对每个成功的清洗工具调用复用唯一DataCleaningAgentActionV1Schema解析，按当前同任务frozen输入核对精确来源/段/样本。目录页的真实已列段与分页状态由冻结段集合和原分页上限确定性重建；正文读取保留精确来源和已读段ID，监测读取保留已读样本引用，均附原观察引用。只呈现定位与进度，不重新读取全部历史正文；最近一次正文观察继续沿原C04 reader。未知工具、错源/段或超出冻结工具调用数拒绝，不静默丢弃；原模型输入/上下文/工具/资源预算照常计量与拒绝。每份资料的正文工具仍只接受该来源自己的段ID，不跨源拼接。

源码范围限apps/worker/src/agent-runtime/runner.ts、src/engineering-data/cleaning/runtime.ts；测试限既有test/agent-runtime/runner.test.ts及test/engineering-data/cleaning/runtime.test.ts。验证两次读取后仍保留首次事实、从已登记行动恢复无重执行、来源/分页/监测边界及超预算拒绝。新隔离清洗policy/prompt/budget策略引用升版，数值预算、模型、工具、保护类型和100%留存/覆盖保持。旧任务终态及消耗不变，工程通过后新命令正式清洗原三来源。无公共HTTP/core领域Schema、依赖、迁移、权限或业务事实变更。

### D-96：清洗生成Schema绑定实际资料与快照身份

v101新任务首次模型调用把data-cleaning-manifest工件身份填入sourceVersionRef，目录工具正确拒绝且任务终态；1模型/1工具、2122输入/127输出tokens保持，未进入多轮读取，不能据此否定或宣称D-95实机通过。原行动证据见logs/cleaning-action-history-v101.log；不能反复新建任务碰运气。

依持续授权在Worker内部AgentModelStepRequestV1增加可选outputSchema，只供可信任务渲染器收紧本次结构化生成；runner传给原completeAgentStructured，生成后继续执行registry原actionSchema解析与原领域工具校验。C15从同任务frozen.documents构建原动作Schema的子集：每份资料的sourceVersionRef必须为该精确kind/entity/version，正文读取数量沿原maxSegmentsPerRead，目录offset限定0..实际段数；只有登记了目录工具才提供分页动作。监测动作只在有冻结监测时提供并绑定精确snapshot及原单次样本上限；候选提交复用原唯一Schema。资料段、样本成员、权限与当前授权仍由既有工具复验，不向模型公布尚未分页读取的全量段ID，不增加工具/任务字段或更换预算。

新隔离清洗策略显式绑定已验证的同MiniMax模型/low/function-call部署，保留旧部署；仅更新清洗policy/model/prompt/budget的精确引用，原上下文、工具、资源数值、质量和100%留存/覆盖保持。先以原失败任务冻结首步做一次诊断，严格核对实际source引用及原Zod，禁止执行工具、创建候选或改原任务台账；通过后才新任务正式取证。不自动重试、换模式、补默认引用或将失败转人工PASS。源码及既有测试仍限D-95四文件，无core/HTTP公共字段、依赖、迁移或权限变化。

## Migration Plan

1. 固定并核对前置实现和本规划基线；正式模块/主规格按前置 change 归档同步顺序消费。
2. 完成 IP-17 的来源和环境、IP-18 Electron 场景；依赖合格转换后运行 IP-19–IP-21。
3. IP-22 完成报告、门禁、检查点、Finalizer 和一次必要限定审计；最后才归档。
4. C38 消费 F-01–F-05 和两个 change 的真实证据，按最终制品重新取证。

## Open Questions

无影响实现契约的开放技术问题。实际环境、秘密、资料资格和人工批准是执行输入；缺项记录 BLOCKED，不填默认值。
