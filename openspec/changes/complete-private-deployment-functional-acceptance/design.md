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

### D-97：工件来源限制不能依赖逐段证据是否存在

减负后续办的v103诊断在模型前复现registry.authorization：清洗冻结清单带三项真实资料授权限制，但没有逐段evidence，宿主只从evidence构造当前来源，因而取得空资料授权并错误拒绝。历史任务和原工件不修改，诊断不计业务通过。

C06内部业务授权输入及部署复验增加可选requestedSourceAccessGrantRefs，仅由可信工件清单或当前模型输入授权提供，不进入HTTP/Agent契约。C06在本工程资料授权登记中按稳定grant身份解析真实来源版本，与显式来源去重后执行原当前账号、资料、空间及任务冻结上界检查；未知或跨工程grant拒绝。历史grant修订只用于追溯，当前资格仍取现行授权。工件读取仅提交目标清单限制；写入同时保留调用输入及显式附加限制，模型调用保留实际输入授权限制。源正文、角色、能力、撤权、任务终态和预算语义不变，不新增表、依赖或通用读取入口。

文件限core/access/authorization.ts、adapters/auth/postgres-local-identity-access.ts、scripts/deployment/start.mjs及既有auth与entrypoints测试。先复现无evidence的受限工件拒绝，再验证合法读取/写入、错工程/未知grant/撤权与任务越界拒绝、模型输入限制保留；构建与定向回归后冻结新制品，正式读取原清单并执行D-96诊断，不复活旧任务或替换原结果。

### D-98：清洗提示明确串行状态循环

v104真实D-96诊断返回三个并行emit_result，各针对一个资料选项，违反原每步唯一动作契约。官方`text-chat-openai`及其`openapi-chat-openai.json`明确对应api.minimax.cn/v1/chat/completions，但未声明parallel_tool_calls或强制具名tool_choice；不依赖未知参数，也不丢弃多余调用。

先以同一冻结三资料输入、当前短选项outputSchema、原模型/数值预算做一次新提示诊断：明确每次只选择一个资料动作，等待宿主观察后才进入下一状态，多个资料不可并行提议。诊断只保存C04响应和用量，不执行工具、创建候选或修改原任务。成功输出按当前模型Schema解析并核对sourceOption映射的真实冻结来源，不误用内部领域动作Schema解析短选项。

诊断通过后仅在`apps/worker/src/engineering-data/cleaning/runtime.ts`固定指令加入该串行说明；隔离实例新建清洗policy/prompt/budget引用，预算正文除绑定引用外不变。复用既有清洗runtime测试，不断言提示文案。工程检查后冻结新制品并以新命令正式清洗；诊断再次失败则保留失败，不继续重试或放宽单结果契约。无HTTP、领域Schema、工具、权限、依赖或迁移变化。

### D-99：清洗新策略固定既有Schema提示承载

D-98串行说明诊断仍以MODEL_STRUCTURE_INVALID/chat.choice失败（2657输入/135输出tokens），不进入生产，也不再重试该候选。官方同源OpenAPI未声明串行函数开关。清洗本次采用已实现且原已批准的schema-prompt承载，固定同一MiniMax-M3.1-Flash-Preview/low部署`minimax-chat-acceptance@v1`，当前短sourceOption模型Schema与原Zod确定性校验保持；风险候选生成仍用原function-call部署。无运行中模式切换，旧响应、任务及预算保留。

先在当前冻结三资料输入上以新诊断提示引用调用一次该既有部署，按当前模型outputSchema验证单JSON动作及短选项范围，不执行工具或候选写入。通过后仅新建隔离实例清洗policy/prompt/budget及catalog/发布版本，除模型承载和关联精确引用外深比较数值预算、业务约束及工具不变；以正式新任务取证。没有生产代码、公共Schema、迁移或依赖变化，不使用未声明参数，不从不合法函数响应提取结果。

### D-100：完成清洗准备复验当前权限，不比较完整授权快照

v105正式三资料清洗完成（7模型/6工具、27063输入/532输出tokens、无纠错或瞬态重试），完成准备却返回404。原结果/清单/策略/任务绑定只读逐项均成立；对同一所属端口的异常断点定位到C15 `#verify`，其额外比较完整授权对象，而宿主当前业务复验对首次空资料范围返回的授权增量与入口不同，触发旧全等门禁。

仅删除完成分支的完整授权canonicalJson全等要求，保留当前C06 verify、redacted拒绝、主体/工程、完成任务、精确策略/清单/结果、后续全部资料和空间复验及原事务幂等。符合减负D-02的当前权限语义，不放宽任何角色或资料资格。文件限`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`及其既有测试；成功完成用例覆盖有效当前授权增量，旧撤权/错任务/幂等/并发继续回归。通过后新制品消费原v105完成任务，不重跑模型、不修改旧结果或终态。无公共Schema、依赖、迁移或新事实来源。

### D-101：旧发布条目补登记使用所属读取授权

v106独立批次绑定原五资料准备后，I0–I2已提交，I3在创建审阅任务前终态失败。带模型/工件/领域写入屏障的原prepareReview路径复现：C20调用C17 readVisibleEntries，旧发布尚无000059条目投影，内部readExact收到hybrid-evidence授权而要求identification-basis，返回AUTHORIZATION_DENIED并抛IdentificationKnowledgeModuleError。旧父子终态和全部原阶段保留，诊断不发起模型或新批次。

依验收必要修正持续授权，仅在C17已有旧发布补登记分支通过原#authorize取得同主体/工程的identification-basis授权，带精确发布派生invocationId调用原readExact；Agent来源保留taskRef。当前读取、C04完整消费、原包与发布绑定及现有条目登记逻辑保持；返回条目仍由原hybrid-evidence授权执行filterVisibleSources，不交换两种能力、不增加角色或来源。无新Schema、接口、依赖或迁移。

文件限`packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`及其既有测试，扩展已有精确发布/合法空集用例：仅隔离测试数据库清空该发布条目投影模拟旧发布，当前读取授权拒绝时不得补登记，合法读取重建同一批准条目并复用，再保留未知发布与撤权覆盖。先红后绿，相关C17/C20及宿主回归、8GiB构建/类型检查和strict后冻结新制品；先有界验证真实旧发布补登记，旧v106终态不恢复。

### D-102：全部候选待人工复核时不提交空决定

v107五个检索审阅任务及I5、I6、I7均已正式完成，I8将所有待复核组的空decisionRefs提交accept-groups；公开Schema要求至少一个真实决定，正确拒绝UNSUPPORTED_CONTRACT。父子终态及已提交候选、合并、路由、复核任务与预算保留。该失败不通过放宽决定Schema或伪造人工决定解决。

依持续授权，仅在C24唯一submitGroupAcceptance接缝对decisionRefs为空返回本轮零记录/事件/跳过组，让原I8登记pendingGroupRefs、I9形成human-review等待；当前路线读取及逐组决定核验仍完整执行。有自动决定或人工已决时继续原整集提交与事务幂等。文件限apps/worker/src/identification/graph/graph.ts及已有runtime.test.ts/fixture.ts；既有端口替身按生产IdentificationFinalizationCommandV1Schema解析，以真实契约复现全待定缺陷，新增一个全待定等待/零正式记录用例，原混合组、决定后继续、并发及取消回归保持。无新公共契约、状态、依赖或迁移；旧终态不恢复，先工程回归再新制品实机继续。

### D-103：工作计划只投影成功I5的已验证候选

v108两项候选因机理适用性修正耗尽失败，另三项通过I5；原批次继续后I6以BUSINESS_BLOCKED终态。C24 validatedCandidateSetRefsFor未区分成功/失败I5，将failedCandidateSetRef存在的诊断占位validatedCandidateSetRef也收进C22工作计划，导致expected五项与游标提交的三份合格校验集不一致。合并完整性拒绝应保留，错误在投影资格。

依持续授权，仅在该共用收集接缝按已有failedCandidateSetRef字段跳过失败I5；无前缀判断、不删历史阶段或把失败当合格，原C04完整读取、运行/工作计划范围及C22整集完整性校验保持。文件限packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts及已有对应测试；扩展原C21/C22精确读取用例混入同运行同工作计划的失败I5，仍只返回成功校验集，先红后绿。现场只读投影须与v108三份已登记成功引用相等，零模型、零业务推进；旧父子终态与两项失败、三项成功及预算保留。回归/构建后再继续实机验收，无新公共契约、依赖或迁移。

### D-104：检索审阅生成绑定当前集合版本

v109首项I5失败、第二三项I5通过，第四项必经检索审阅因candidate-set-mismatch终态；父图仍waiting，驱动已停。正式候选与原冻结集合经C04只读对账：精确candidateSetRef、冻结授权摘要/引用、所有操作成员与证据均匹配，唯一差异为increment.candidateVersion=2而集合当前版本=1。原拒绝和模型预算保留，不伪造completed或复活终态任务。

依持续授权，在apps/worker/src/identification/context/runtime.ts复用D-96已存在的可信outputSchema接缝，从loadModelInput经原受权读取的当前candidateSetRef/candidateSet.candidateVersion构造原RetrievalReviewActionV1Schema的子集：两种工具动作的集合引用固定当前值，提交增量固定当前集合引用和版本。补搜后的绑定取实际当前集合，不能固定初始task.frozenInputRef；操作、成员、证据、工具白名单和原确定性校验不变。仅限制生成值，不在解释或提交时覆盖模型错误，不新增公开字段、依赖、迁移或预算。

辅助implementer仅扩展已有apps/worker/test/identification/context/runtime.test.ts，父Agent持有生产实现及最终验收：更新loader模拟为生产当前绑定形状，检验合法提交/工具动作、错引用/错版本拒绝及补搜后新版本。先红后绿，相关C21回归、build/typecheck/lint/format及strict后冻结制品，再以原冻结输入执行一次诊断证明输出绑定。旧v109终态任务和父等待保持，后续正式任务须另按明确输入/策略关联，不自动重开批次碰运气。

### D-105：以精确任务失败通知收口原识别等待

用户已批准公开失败通知提案，并持续授权同类验收必要修正。workflow.resume-run新增strict原因agent-task-failed，仅携retrieval-review/embedded的精确agentTaskRef；C30原样转交C24，不构造AgentTaskResultRef。C24复用C08既有getTask精确读取，核验任务引用、工程/原主体、父子运行绑定、真实terminal-failure与当前retrieval-review-agent等待，再由原stageI3分支把该项计入失败、继续剩余工作项。当前权限、范围、原状态版本、命令收据与阶段事务仍由既有入口复验；原终态、预算、成功/失败项及审计均保留，不创建替代任务或上下文。

仅支持通知终态失败；pending/running/retryable-failure/completed/cancelled、错任务/父运行/工程、撤权及等待不匹配均拒绝。父先技术失败且子仍等待时，与原完成通知一样从父失败阶段retry后转交原原因，不重置重试预算。无新任务状态、持久化字段、迁移或依赖。

范围限packages/contracts/src/ports/index.ts及test/contract-kernel.test.ts、packages/core/src/identification/graph/ports.ts、apps/worker/src/risk-flow/{graph,runtime}.ts及既有runtime.test.ts、apps/worker/src/identification/graph/{graph,runtime}.ts及既有runtime/nested-boundary测试；fixture仅按真实任务形状补齐。复用既有agentTaskReader，不新增部署端口。先红后绿覆盖载荷边界、父转交、真实失败/非终态/错任务/父版本/撤权、原成功项保留与重复命令；相关回归与构建后切新制品，正式HTTP仅续原v109第四项失败并继续第五项，不重开整批。具体前置事实与已批准提案见evidence/failed-review-resume-scope-proposal.md。

### D-106：复核深链按精确身份窄读

v111物理Chrome打开真实待审任务深链，页面以队列第一页50项定位任务；当前8项在页外，错误呈现缺席且无法确认。C35详情已有工程/任务实体/身份版本的单点查询，但输入要求调用方预知目标与父运行等完整任务事实，导致UI依赖队列反查。

按用户持续授权，在contracts导出唯一ReviewTaskIdentityRefV1（kind与VersionReference），完整ReviewTaskRefV1复用该身份。C35 task-detail请求接受精确身份或原完整引用；所属adapter按当前权限、工程、实体及版本单点读取，完整引用传入时继续验证额外绑定，输出仍为原完整ReviewTaskRef/详情。UI两种详情页直接窄读，再从受权详情恢复决定所需完整引用；不扫描队列、不枚举历史、不依赖队列页或放宽决定命令。未知/错版/错工程/撤权仍同形拒绝，原存储事实完整性检查不变。

文件限packages/contracts/src/ports/index.ts、packages/core/src/review-audit/ui-read.ts及既有review-audit.test.ts、packages/adapters/src/review-audit/postgres-review-audit-read.ts及既有postgres-review-audit-adapter.test.ts、apps/web/src/api/agentAuditOperations.ts、pages/ReviewDetailPage.tsx和IdentificationReviewPage.tsx。前端waitingRunRef读取与已存在的必填输出契约对齐，不加新输出字段、迁移或依赖。扩现有核心/adapter精确定位测试覆盖最小身份及错误版本，保留完整引用错配/跨工程/撤权测试；真实UI原页外任务为红灯，再跑现有相关浏览器复核场景和物理Chrome深链确认。同步platform/review-and-audit-runtime及web/agent-audit-and-operations-ui delta，IP-21关联。后续类似必要修正按本轮持续授权推进。

### D-107：父事件证明按真实运行与当前空间权限核验

v112第一组物理Chrome确认合并已正式入库标准化风险记录，复核事件published/1；随后risk-record-accepted事件exhausted/10，原父仍等待且无评估子运行。设置业务效果屏障的原事件只读诊断确认C30 readEventParentRun以历史链边授权摘要与本次事件授权摘要不相等抛WORKFLOW_EVENT_PARENT_UNPROVEN；本次授权覆盖同一空间，但不携识别输入资料授权。原事件及预算/投递次数保持，不能重置或冒充已消费。

在packages/adapters/src/workflow/postgres-workflow-adapter.ts唯一事件证明路径去除历史链边、运行状态、阶段与消费事实的完整授权摘要全等。当前C06授权、工程/主体/调用身份、redacted拒绝、精确父子链边、run/thread正式绑定、C04完整性、同版本状态与正式风险/准备消费事实保持。#eventState按同工程/运行preparing阶段精确匹配唯一正式入口登记，有界limit2；当前空间必须覆盖该入口冻结空间集合，不能把删除整份授权相等变成绕过空间权限。来源资格在后续所属资料/工件入口按实际输入独立验证，事件不要求携整批历史资料授权。

仅修改该adapter与其既有postgres-workflow-adapter.test.ts；已有事件证明用例补真实根入口/空间，验证当前来源授权不同仍能读取父与证明消费，错空间/撤权/错主体/错引用/假消费仍拒绝且零写。同步domain/module-interfaces-events-workflows delta及IP-19/IP-21。原v112 exhausted事件不复活；修后先以原事件只读屏障证明可到达业务效果前，再由同批次余下复核决定的新正常事件取证；需要原父补进度时只用已有真实reviewDecisionRef及当前状态的正式恢复入口。没有新公共字段、状态、依赖或迁移。

### D-108：分批复核按实际新增记录原子收口

v113第二组人工决定已正式成立，但I8整集提交包含首条旧记录与新合格记录，C22将同摘要的部分重叠误判冲突，C03映射回滚哨兵后表现为TRANSACTION_FAILED。第一条记录、两条人工决定和原exhausted事件保持；不提交其余决定直到恢复本阶段。

依用户持续授权，内部StandardizedRiskRecordStoreV1.insertRecords的inserted结果增加insertedRiskRecordIds。PostgreSQL在原ambient事务内以RETURNING取得实际新增身份；已有身份仍逐项核对摘要，同摘要混合批次合法，全旧返回replayed，异摘要整体回滚。C22只为实际新增记录构造事件，完整合格记录与既有确定性事件引用继续返回；事件数量校验按本次新增数，同命令回执重放不要求重新执行插入回调。已设置的可信回滚结果在C03映射异常后仍按replayed/conflict处理，未知技术失败继续抛出。C24按精确实体和版本累积记录，不能重复旧引用。

文件限core/identification/candidate-finalization/{ports,service}.ts、adapter对应postgres-risk-candidate-adapter.ts、worker identification/graph/graph.ts及对应既有核心/adapter/runtime测试和fixture。夹具必须返回全部合格记录以暴露真实增量行为；拒绝组取本轮完整路线中语义已封闭集合，不累加旧引用，也不把C22的待定跳过误计为拒绝。验证合法旧新混合只插新身份、异摘要回滚、真实C03映射下重放/冲突、事件仅新记录与同命令重放、C24汇总无重复；不新增公开DTO、依赖或迁移。通过工程验证后冻结新制品，沿原失败阶段正式恢复，保留原重试策略、预算与已成功阶段，不重开批次或重置旧事件。

### D-109：正式风险的来源范围包含已登记证据来源

v114公开恢复原父时，已接受首风险进入空间配对，父以spatial-pairing-missing终态。带当前C06的精确只读证明：原记录source_version_refs仅含五工程输入，evidence_references真实引用已发布mechanism-01来源s_baa06323b7398504401063b4888945a4@1；reader在范围复验前按子集要求拒绝。原记录/人工决定/证据不修改，父终态不复活；连接中断不等于零业务效果，已提交状态为准，不重放原恢复命令。

正式记录来源范围由所属C22统一为成员工作项来源与实际合并证据来源的精确并集；同实体不同版本均保留。读取已有记录时，同样只由该条已登记来源与已登记证据构造受权范围，不能从其它记录、当前最新知识或候选补造。缺失或不合法的来源/空间/证据登记继续拒绝；并集沿原64来源上限，超限拒绝。C06按该真实并集复验当前权限，redacted或撤权拒绝；不再要求知识库证据来源必须属于工程输入子集。新写入保持原记录身份/摘要/事件幂等，不回填或覆盖旧记录，无新表/迁移/公开DTO/依赖。

范围限core候选收口service.ts与既有核心测试、adapters/identification/read/postgres-standardized-risk-input-facts-reader.ts与既有risk-assessment/postgres-risk-input-facts-reader.test.ts。测试覆盖已登记第二证据来源参与范围复验、未知/撤权拒绝、缺登记/错版/工程/预算仍拒绝，并复验C30空间配对。工程通过后先只读原首记录的事实/空间配对应通过，零模型或工作流写；再由原C24的当前授权、状态版本及正式runtime.resume恢复尚未终态的I8，不复活终态父。后续评估用既有assess-existing-risk入口引用正式记录，保持原识别来源和旧父失败证据；未重新取得完整C30链路证据前不勾业务总任务。

### D-110：评估按实际输入当前权限收口，不比较不同请求的授权增量

v115以公开assess入口引用原首风险及D-91更正快照，A0正式准备、A1确定性C19派生依据和A2输入快照均成立，A3 AUTHORIZATION_DENIED终态，尚无评估记录或预警。原父子终态及已成立准备/依据/输入保持。效果屏障诊断定位唯一额外门禁：身份检查无显式资料返回0项当前增量，准备范围复验返回1项，evaluate把后者强制包含于前者而拒绝；两次当前权限均通过。诊断没有模型、评估或工作流写。

按持续授权，仅删除C25 evaluate这处“准备范围上下文必须包含于无显式请求上下文”的集合门禁与过时的宽上下文说明。评估继续用按真实准备空间/证据来源复验后的当前上下文；C06主体/工程/分支/调用身份、真实风险/监测/C19/C04逐项读取、快照版本、提交前复验和事务保持，redacted结果明确拒绝。C04父工件所需来源由D-97已存在的所属入口按真实清单独立复验，不依赖历史整个授权集合。无公共字段、依赖或迁移。

源码限packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts及既有对应test/risk-assessment/postgres-risk-assessment-engine.test.ts。扩一个当前身份读取不携资料增量、准备仍有真实来源的可复现行为用例，保留撤权/错范围/事务/幂等。先红后绿及engine/风险事实/assessment组合回归、build/typecheck/lint/format/deps/strict/diff；原冻结输入效果屏障探针应越过此门禁并停在写入前。原终态不恢复；修后正式评估通过既有入口引用已完成识别记录，不能重复识别任务或重置预算。

### D-111：补齐原阈值要求的其余五类真实合成监测序列

D-110修后同冻结输入探针越过授权门禁，确定性评估以risk-assessment-monitoring-snapshot-coverage阻断。实际C19成员受权读取证明原阈值要求地表沉降、地下水位、注浆压力、支护结构变形、盾构姿态、泥水压力六类，原评估仅绑定D-91地表沉降；拒绝正确，不删阈值或把缺项视为正常。

依持续授权，在原SYN-PHYSICAL-LONGITUDINAL-001情景、工程/空间新增五个独立合成序列与一份原生CSV：同2026-10-16T00:00:00Z起16个秒点，地下水位/groundwater-level值2m，注浆压力/grouting-pressure值400kPa，支护变形/lining-deformation值4mm，盾构姿态/shield-attitude-frequency值0.05+0.01*sin(2π*i/4)deg（按6位小数），泥水压力/slurry-chamber-pressure值300kPa。每格带情景、对象、指标/参数、采样键/时刻、真实值/单位、合成标记/生成规则，待甲方复核，不伪装实测。姿态频谱16点只使用原确定性算法，输出不足/越限按原结果处理。

五序列与五可用性策略使用与D-91相同16秒/1秒/不插值/窗口/算法数值，序列/策略身份各自独立；cutoff同00:00:15Z。复用D-89受控provision的C04/C11来源登记、原生CSV转换、序列/策略登记，样本NDJSON只由已核对CSV和实际转换段派生，再通过正式HTTP登记batch/freeze/read/replay留证。原地表沉降三份快照保留，评估输入将引用更正快照与新增五份精确快照。业务字段映射、规则/矩阵/权重/阈值和模型/预算不变。

仅当前change设计/IP/handoff/证据与受限实例新输入、预置和回执；不改生产代码、主规格、依赖或迁移。先自检5×16唯一时刻/值/单位、原生转换与段逐格一致、Schema和原监测回放/快照行为，再正式登记；缺项/不可用不算通过。施工日志/围岩字段的事实通路另按真实代码调查，不将监测补齐等同完整评估通过。

### D-112：评估准备显式冻结带证据的资料字段，评估入口消费精确准备

实机与源码调查确认：RiskInputFactFieldV1、C18 source-field映射及C25取值已实现，但标准化风险reader只拥有六个风险标量，没有施工日志压力和地质等级的事实生产者。不得改成外部风险事件、拿置信度冒充压力、修改原映射/阈值或向标准化风险记录添加工程字段。

按验收必要修复持续授权，在现有C11 assessment-preparation载荷及共享AssessmentPreparationSnapshotV1增加可选sourceFieldFacts，复用唯一RiskInputFactFieldV1。它是调用方显式提供的类型化资料值，必须引用本工程真实已登记资料版本/段，当前空间/来源权限与原证据定位校验通过才冻结；不由模型推断或从全库/最新资料补齐。字段键documentType+fieldPath唯一，拒绝标准化风险自身字段覆盖，字段数量沿1024上限、唯一证据合计不超过256；原标量类型与来源定位不变。值和证据作为准备不可变正文保存并纳入既有摘要；同键异载荷冲突，原准备不补写。

C25读取正式风险六标量后，只合并该准备显式冻结的sourceFieldFacts及证据，继续现有总量/重复/值类型/单位/映射/规则检查，不覆盖风险字段。C11在冻结及回读按实际补充证据来源重新复验，当前撤权/错段/错工程/错版本/无效空间拒绝。

公开workflow.start-run的assess载荷增加可选assessmentPreparationSnapshotRef。C30将其纳入原冻结引用/入口身份；A0有此精确引用时经C11既有readAssessmentPreparationContext窄口当前读取，核对工程修订、风险、空间、适用性、entryMode、发起人及完整监测集合与显式入口一致后复用，不再冻结另一份准备；不允许有旧父因果的准备被改绑新父。A0未提供此引用时沿原冻结路径。缺口仅增加可选所属读取接缝，不新增状态/迁移/依赖。

源范围：contracts/src/ports/index.ts、workflows/index.ts；core/src/workflow/service.ts；adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts、risk-assessment/engine/postgres-risk-assessment-engine.ts；worker/src/assessment/{graph,composition}.ts（仅必要类型/接线）；既有contracts契约、core workflow、C11 assessment-preparation、C25 engine与worker assessment/risk-flow测试及其必要fixture。C11新准备通过当前正式freeze命令冻结真实资料字段；合成实例只使用经原转换逐项读到的压力/围岩字段和定位，待甲方复核，不使用expected标签填值。

实机合成字段选择原资料段005：施工日志表1第2行第5列126.0kPa、地质报告p1_b8粉质黏土。日志里程DK12+300与地质该行DK12+380不一致，原资料不修改；该组合仅作为同合成编号的显式验收输入，待甲方复核，不证明真实现场同位置。值、原始定位及差异保存在实例d112-assessment-inputs/source-field-selection.json；正式准备仍由当前登记段和空间权限核验，不绕过C11。

先红后绿覆盖新字段Schema/保留旧输入、重复键/覆盖/超限/错证据/撤权拒绝、准备同键冲突与历史稳定、C25确实使用资料值而非风险分数、C30入口身份及A0复用/错绑定零下游效果。最小相关回归和build/typecheck/lint/format/deps/strict/diff后先效果屏障预检，再正式冻结新准备与assess取证；原识别结果、失败父子、预算及历史准备均保留，不重开识别批次。

### D-113：独立评估准备经所属冻结绑定本次运行因果

v117的D-112入口精确读取与匹配均通过，A0/A1/A2正式成立，A3以risk-assessment-assessment-run-required终态。C25写入和后续正式评估证明都沿准备causalRunRef保持追溯，独立准备没有该引用；不得伪造授权、改写准备、复活终态或去掉运行要求。

按持续授权修正D-112的直接复用决定：A0保留当前窄读与全部入口匹配，再经既有C11 freeze，以原精确风险/修订/空间/适用性/监测集合和sourceFieldFacts冻结带本次运行因果的准备。C11重新核验当前证据，原独立准备不变。动作沿本次A0既有幂等身份，causalRunRef沿原parentRunRef或runRef规则；普通入口不变。C30根入口保存独立准备，A0入口保存绑定准备，两者经同一正式运行追溯；C25只消费绑定准备，无新因果DTO、依赖、迁移或规则。

范围仅worker/src/assessment/graph.ts和既有runtime.test.ts，同步本change design/IP/domain delta与证据。测试匹配输入仅冻结一次、原字段与本次因果透传，错绑定零冻结/下游效果，原普通路线保持。工程通过后以新正式C11准备命令形成新输入引用再assess；原v117父子终态、独立准备、C19/A2与预算保持，不重复识别。

### D-114：合成评分配置按现有实际值求值契约修正等级区间

v118完成因果绑定后A3以risk-assessment-rule-coverage终态；受权只读精确C19/C04证明原三条正式规则与原合成来源均把gradeIntervals设为0–12分数尺度。既有C19统一求值按实际值落等级区间，126kPa超界；地层字符串则要求一个无界等级。代码与已归档边界场景一致，不修改求值算法或规避拒绝。

持续授权下，仅新增独立合成来源及新规则版本：压力等级为grade-a(-∞,80)、grade-b[80,120)、grade-c[120,160)、grade-d[160,+∞)；沉降等级grade-a(-∞,5)、grade-b[5,10)、grade-c[10,20)、grade-d[20,30)、grade-e[30,+∞)；离散地层使用无上下界的grade-discrete，六种等值评分仍由原阈值确定。三规则ruleVersion提升2，评分阈值/分值、适用性、指标、权重、矩阵、预警阈值和模型/预算均保持。合成、待甲方复核，不冒称真实业务规则。

新增实例CSV逐行保存完整修正规则及说明，经C04/C11登记和确定性CSV转换取真实段，重建配置包/规则文档证据，再沿原C19提交、真实可见复核及批准发布；不修改旧来源/发布版本。源与新候选逐项深比较，只允许等级区间、规则版本和真实证据改变；现有求值器自检数值共享端点、代表值及全部离散值均唯一。当前change设计/IP/handoff/证据与实例新增工件，不改源码/主规格/依赖/迁移。新规则正式发布后新准备+assess取证，原v118父759ec70c…与子c0f2b0b4…终态保留。

### D-115：共享等级Schema允许现有离散求值器要求的全域区间

D-114新来源和CSV转换已正式成立，包在Schema阶段拒绝离散grade-discrete，因为GradeIntervalSchema要求至少一个界，而现有evaluateScoringRule对字符串/布尔等值规则只接受lower和upper均空。二者矛盾导致所有合法离散规则不可求值，不能以换工程值或绕过Schema解决。

持续授权下删除共享GradeIntervalSchema的“至少一个界”检查，双缺省表示全域；保留非有限数、倒序/相等双界拒绝，C19统一归一/重叠/空洞检查不变。全域与其它区间并列仍因重叠拒绝；离散阈值只匹配同类型同值，未声明值仍拒绝。只改contracts/src/records/index.ts、既有contract-kernel.test.ts与core/test/scoring-rules/scoring-rules.test.ts；同步本change评分delta/IP/证据，不新增字段、依赖、迁移或改变阈值/分值。先共享Schema及离散规则红绿，数值端点/冲突/区间回归，再工程构建、严格验证和新制品；D-114包走正式审核发布后才再次业务取证。

### D-116：配置包基线修订接通冲突复核并保留明确替换候选

v119新包无基线提交409，补原正式baseReleaseRef与包baseRuleReleaseRef后修订dead48d0…正式登记，但request-review以BUSINESS_BLOCKED拒绝。精确只读12条关系含10条conflict、0条C07链接；#ensureConflictReviewLinks只在Agent finalize调用，配置包直导路径永远无法进入人工复核。并且同一ruleId的v1/v2关系按来源标识字典序保留旧版、排除候选，后续组装必然把候选排除；不可通过造来源ID或批准错误保留方案绕过。

按持续授权，C19 assertRevisionMetadata进入正式审核前调用原幂等#ensureConflictReviewLinks，再沿原关系/摘要/基线/决定门禁；只补缺失链接，不修改关系事实，不在只读组装创建任务。同一ruleId且一端是明确候选、一端是声明基线时，关系保留候选版本、排除被替换基线，不按不透明版本号猜新旧；候选内部不同规则与其它来源冲突沿原优先级。冲突仍必须逐项C07人工批准，之后才可发布。该优先选择由当前冲突策略实现版本与新修订关系快照固定，旧修订/决定不回填。

范围core/src/scoring-rules/validation.ts及既有core/test/scoring-rules/scoring-rules.test.ts；adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts及既有test/scoring-rules/postgres-scoring-rules-adapter.test.ts；本change规格/IP/证据。复用原C07 linker和事务/审计幂等，不新增依赖/迁移/公开DTO；失败修订保持。测试候选来源排序相反仍保留明确替换候选、不同规则优先不变；配置包提交后复核任务可达、未批准门禁保持、重复补链不重复。工程后新修订重新固定关系，逐项可见批准再发布/组装；原失败与预算不动。

生产宿主尚缺conflictReview装配，纳入scripts/deployment/start.mjs及既有entrypoints.test.mjs。linker按原动作身份和review-audit.request-review分支签发当前授权，调用原C07 requestReview；target、validation/evidence快照均精确投影同一已登记不可变rule-relation，等待引用为该关系的复核过程身份，reviewPolicyRef使用当前冻结conflictPriorityPolicyRef，不造模型/工作流运行。任务创建失败原样返回，成功由原C19追加link审计；当前工程/主体不符拒绝，已存在任务按C07原幂等重放。

决定读取同样必须由宿主按原invocationId签发review-audit.trace上下文，再调用原C07精确readRuleConflictDecision，不能直传knowledge-modeling.govern上下文。创建/读取各自当前核验，同一宿主接缝覆盖二者，不扩权限或改历史授权。

### D-117：配置包当前配置读取身份绑定本次调用

v120原候选及新候选提交均409/IDEMPOTENCY_CONFLICT，定向prepareRevision诊断（不提交修订）证明两命令无回执、新候选无修订；失败来自#prepareConfigurationPackage的C18 resolveConfigurationSet。其requestId/idempotencyKey只含包引用，却以本次authorization.decidedAt作为请求/有效/记录时刻；后续当前调用撞原读回执的异载荷检查。不是候选内容或C16业务幂等可绕过的问题。

按持续授权，唯一requestId由包精确引用、本次authorizationContextRef和decidedAt派生，沿既有sha256CanonicalJson形成有界身份；下游签发/复验/C18 request及idempotencyKey共用。相同调用仍重放，不同当前调用独立读，原包/配置/审批/回执不改；不扩大来源或时限。只改adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts及既有test同名文件，扩配置包用例以另一当前授权/时刻重复准备，仍消费原包且不建新修订或Agent任务。无新DTO/依赖/迁移/业务规则。工程后新制品先原候选prepare诊断越过该处，再用新的正式提交命令生成新关系；旧失败不重投。

### D-118：评估读面按目标真实来源检查当前可见性

v121正式评估完成并形成P=3.6、C=2、level-3及四条预警；A7因measure-category-unbound跳过建议，不能计完整业务通过。C34 record-read误把合法空来源授权增量当完整可读清单，返回不可枚举404。原记录及终态保持，不重跑评分。

按持续授权复用C06 filterVisibleSources，支持显式risk-assessment.read分支，默认检索分支保持；当前账号、成员、空间、资料正文权限和任务冻结范围继续核验。C34共享查询仅从本工程、当前空间及请求筛选的评估准备提取真实来源引用，复用既有256来源上限（多取一项识别越界），不枚举全资料库；精确读取先约束记录身份，目录/历史/摘要在SQL分页或聚合前使用可见来源过滤。缺证据或当前无权保持不可枚举拒绝，不把历史授权包含关系当权限。内部工件/投影读取不再要求来源增量为旧上下文子集，C04按工件登记来源执行当前检查。

范围：core/access/service.ts、adapters/auth/postgres-local-identity-access.ts、adapters/risk-assessment/engine/postgres-risk-assessment-engine.ts及既有auth/engine测试；本change design/IP/risk-assessment delta/handoff/evidence同步。无新依赖、迁移或评分规则。复用既有记录解释及5001可见/5001隐藏记录分页用例，补空增量仍可读及错能力拒绝，保留真实撤权、异工程和隐藏行过滤。工程检查后新制品只读取原正式评估核验。

### D-119：C30区分评估运行入口身份与A0准备引用

D-118新dist实机只读已越过权限误拒，抵达C30 assessment-entry-identity-mismatch。正式A0 entry-snapshot.entryIdentity保存绑定准备引用，run-state.entryIdentity保存workflowEntryIdentityFor生成的运行入口摘要，二者领域含义不同。用原登记frozenRefs和入口方式计算所得摘要与原运行完全一致，无事实漂移，不改历史行或终态。

C30以原workflowEntryIdentityFor和entry-snapshot.frozenRefs、state.reassessmentEntry验证运行身份；entry-snapshot存在inputSnapshotRef时，单独核对其引用与entryIdentity。保留工程、runId、状态版本、入口方式、评估归属、前驱及原因校验。复用既有C30入口元数据用例和C25 fixture，改成真实两种身份，并覆盖引用错配/运行摘要错配拒绝。范围adapters/src/workflow/postgres-workflow-adapter.ts及既有workflow测试、risk-assessment/fixture.ts，同步本change design/IP/domain delta/evidence。无新DTO/依赖/迁移，不重新评分。

### D-120：原预警任务绑定明确合成类别并沿公开入口接续建议

v122已取得原评估正式HTTP200和物理Chrome截图。原任务实体ID为2b3e1d45-2f73-4158-812c-4c575a50684b（kind为warning-response-task，entityId不带kind前缀）。C27原正式上下文确认风险为掌子面稳定性失效，措施库knowledge-release-2340f951-f50b-4105-bb20-330b85a98c72@1的measure-01具有同类别及当前适用性；生成策略bindings为空是原配置缺项。

仅新增实例response-generation不可变版本，精确riskInputRef绑定掌子面稳定性失效；新catalog及release/config绑定此版本，旧目录/策略/来源保留。模型、预算、三项校验、评分及原任务均不变，不新增生产代码/DTO/依赖/迁移。通过公开measure-candidates→agent-task.start-task（原评估子运行作为parent）→create-candidate→validate-and-record接续；不伪造run或复活终态。全部输入/查询/任务/模型/结果按原正式审计取证。

原四预警中联合规则地下水位与姿态主频在冻结字段映射中未解析，原measure-01也仅声明联合/指标越限触发；该事实保持，不改为有覆盖或删除预警。三项校验若拒绝，保存真实失败及零正式建议结果，再以明确的新配置/输入单独准备后续合法场景，不能把当前链计通过。现场/规范依据仍按已有正式引用读取，缺项明确失败，不从预期输出造依据。证据范围实例d120-response-inputs与本change handoff/evidence/IP。

### D-121：公开措施候选分支接入现有C27

v123公开knowledge-modeling.measure-candidates返回426/UNSUPPORTED_CONTRACT，尚无候选或Agent。生产API组合根将所有knowledgeModeling.retrieve直接交给只支持识别检索的C17 adapter，遗漏已注入C27的measureCandidates分派；非HTTP内部A7此前可正确调用C27，因此工程测试未覆盖此公开缺口。

在既有scripts/deployment/composition/api-ports.mjs的knowledgeModeling端口按原kind分派：measure-candidates交现有recommendation.measureCandidates，其余govern/resolve/retrieve保留原receiver和模块。将measureCandidates纳入既有必需provider方法清单，缺失时沿原装配错误收口。扩scripts/deployment/api-ports.test.mjs原装配行为用例，验证原查询对象和结果原样传递、其它知识行为不变；无新DTO/路由/依赖/迁移/权限。同步design/IP/handoff/evidence，正式新制品后继续原任务查询，原426记录保留，未重投任何已写业务。

### D-122：建议模型步骤消费当前授权决定，不比较历史完整快照

v124公开措施候选200，query=measure-candidates-1801710793fc7f94844d8b9134cdf84b@1，原子运行parent上的建议Agent已正式创建。该任务在模型调用前以AGENT_INPUT_INVALID/deployment.response-model.authorization终态，model/tool用量均0，原任务保留不重开。生产response-model-step仍比较当前C06决定与历史授权完整JSON及空间版本集合；与减负D-02当前业务动作授权语义冲突。

删除source.context/当前decision与历史授权的完整JSON相等及空间集合全等门禁。来源读取仍须存在、同主体同工程；当前decision仍须非redacted、同主体同工程并含实际能力；请求继续携原任务空间和冻结来源，由C06检查当前权限与任务上界。下游候选集/偏差的工程、主体、实际空间及精确引用/模型/预算/Schema核验保持。仅scripts/deployment/composition/response-model-step.mjs及既有response-model-step.test.mjs；扩原C27/C29用例覆盖当前时间/空增量变化仍可读和错主体/缺能力/脱敏拒绝。无DTO/权限扩大/依赖/迁移，检查后新制品、新任务身份消费原冻结查询，原零调用失败不复活。

### D-123：处置Agent写授权提供者按原接口映射任务身份

v125任务冻结原候选与8实际来源，模型1次、7571输入/23输出token后以AGENT_TOOL_FAILURE终态，零正式建议。只读诊断证明C27 TaskAuthorization.authorize接收{task,purpose}，生产却直接传入通用authorizeDownstream，缺projectId/actorId/branch，得到DEPLOYMENT_AUTHORIZATION_SCOPE_MISSING。终态任务runTask探针也正确拒绝无租约，未重新执行或改写任务；另用当前人工读授权验证参数不匹配，无业务写。

在既有assessment组合加入小型task授权映射，受信envelope提供工程、发起人、空间，固定warning-response.create-candidate分支，invocationId沿taskId:purpose；来源继续由活动任务作用域携原冻结上界，不给客户端/模型扩权。生产start.mjs注入该提供者；reviewAuthorization原完整请求保持。范围composition/assessment.mjs、start.mjs及既有assessment-composition.test.mjs，扩两种purpose映射与原scope/current权限回归。无DTO/依赖/迁移/预算变化；新制品后新任务消费原候选，原v125模型及终态保留。

### D-124：现场绑定使用正式用途与真实工序来源的新版本

v126建议Agent completed，1模型/7571输入/23输出token、0纠错/工具/重试，正式候选recommendation-candidate-e2a4d1da101809a967f4b00e938dd3f6@1及公开create-candidate绑定200。validate-and-record500经C04只读诊断证明site binding仍指向用途synthetic-site-context-candidate的旧预置工件，正式reader要求recommendation-site-context；空间/权限并非该次原因。旧候选现场正文还含未登记synthetic-knowledge-evidence-v1引用，不可改用途冒充合格正文。

仅新增实例合成现场上下文版本和C04正式用途工件，保留旧候选及配置。工序取原正式风险node-02-变径空间扩挖；从C17已发布process-model f3bda4af…@1所属窄读取得节点、真实来源段及版本，processNodeRef使用节点ID/发布版本，精确发布与候选工件一并留证。场景沿原提供site-context-node-02-resourced的工序状态、资源、约束及观察时刻，显式合成、待甲方复核；不为通过校验增加资源。新正文使用实际空间/工序与已登记证据，原正式来源权限检查和C04审计保持。

新release/config只更新siteContextBindings到新精确ref；模型/预算/评分/生成/校验策略均不变，复用v126制品，无生产代码/DTO/依赖/迁移。新校验命令消费同一正式候选与新现场引用，先查原命令真实回执/校验/建议/复核效果，不盲重投；三项失败如实留证，不人工覆盖。之后另行准备满足专业契约的新输入场景，不能把原候选当正式建议通过。

### D-125：三项失败沿现有C07复核端口登记

v127正式现场reader成立，原候选三项校验实际全部失败：水位/姿态未映射及风险等级措施未覆盖、规范证据/禁忌不合格、缺inspection-crew和synthetic-material-kit。C04已耐久保存三项快照99e292…；正式建议/校验行/命令回执均0，HTTP422。不得修改这些失败或直接人工批准。

定位生产assessment组合已要求并注入同一C07 review，却遗漏C27构造选项reviewAudit，导致其适用复核路径提前recommendation-validation-rejected。只在scripts/deployment/composition/assessment.mjs向现有C27注入reviewAudit: review；复用既有C27三失败、独立C07、事务失败复用同reviewRef测试及部署组合/宿主回归，不增加新的抽象、DTO、路由、依赖或迁移。新制品后查原422零业务效果，以新命令消费原候选/现场重新接受原三项校验，登记失败快照与适用复核。原模型、输入、失败结论与终态保持；不复活父/子或通过人工绕过三约束。

### D-126：独立单风险等级预警合成处置场景

原D-125三失败候选经物理Chrome拒绝，C07决定0f6384bc…@1、校验行及两条审计成立，正式建议0。v128失败快照的实际C04摘要为17b16bbf…；v127的99e292…是原失败尝试，不混用。原已完成评估与所有历史输入保持。

沿持续授权新增SYN-PHYSICAL-RISK-LEVEL-ONLY-002，覆盖主规格已有“单独风险等级预警可形成正式建议”场景。六类监测均从新CSV来源登记：16个100ms等间隔样本；沉降2mm、水位2m、注浆300kPa、支护2mm、泥水200kPa恒定，姿态0.05+0.01*sin(2*pi*i/8)deg。使用新序列/可用性策略的真实100ms采样率，姿态主频预期1.25Hz；原八项阈值、联合规则、矩阵、评分、压力126kPa和粉质黏土来源不变。常量无主频如实partial，不填造频率；正式评估结果才决定是否仅风险等级触发，不按预期删预警。

新增合成措施measure-risk-level-review-d126：对掌子面稳定性风险等级越限暂停作业、复核压力与沉降记录后按原流程处置；目标仅为已存在的沉降指标，目标2mm；资源限原现场已登记的小盾构和扩径模块，不新增现场资源。措施及其synthetic-monitoring-ledger、synthetic-response-procedure依据写入独立合成CSV，经C11原生转换逐格核对，纳入新措施配置修订并走C07可见人工审核/C16发布；不伪称真实规范条款或甲方已审核。

新response-validation版本只为该措施登记上述真实合成依据许可；unverified-trigger-indicator禁忌保留在监测、特征、联合类型，风险等级使用原矩阵/风险可接受阈值的确定性身份与严格越限校验，不以无条件禁忌替代该校验。原措施/策略/候选不变，新措施仍声明该禁忌，现场约束与资源检查不变。新候选必须在新评估/预警任务、发布和策略引用下冻结，再由同模型、原预算Agent选择，三项全部通过才可正式入库。任一输入或正式结果不符即留存失败，不能把原四预警减少为一条。

首次v130独立评估形成P=3.6、C=1、level-3及一条风险等级预警，但原风险输入的C26任务按风险/空间正确累积到版本2，含旧四预警和新预警；新旧依据不同，C27按原相容性检查拒绝。该运行completed/A9、A7未形成建议，保留原任务与两次评估。后续采用原六条正式识别结果中另一条mechanism-01/node-03-刀盘扩径风险（aa612e79…@a86c05ed…）作为独立输入，精确绑定同类别生成策略，并从原已提供node03-resourced场景及正式C17工序来源建立新现场引用；不关闭旧任务、删除旧预警、改合并策略或复活终态。原物理参数与新六监测继续复用，新增现场资源仍为0。

范围仅实例d126-risk-level-inputs的新来源、策略、序列、配置/发布/命令/证据与本change工件；不改生产源码、公共DTO、迁移、依赖或权限。先输入生成自检、C04/C11登记和逐格校验，再复核发布、独立准备/评估及处置；后续人工采纳、执行、反馈保持独立边界。

### D-127：复核恢复消费者按任务类型限定识别动作

D-125拒绝事件event-868c8468…已exhausted/10、TRANSACTION_FAILED，父子评估仍completed。C07所有五类决定共用review-resolved事件，而C24 consumeRecoveryEvent对每类都签发risk-identification.plan并读取C24运行；response-candidate的resumeRunRef实际是C25运行，不能在C24找到。知识/规则/校准决定同样不属于识别恢复，不应要求识别权限或读取C24运行。

仅在C24既有幂等消费者内部按结构化reviewTaskRef.reviewType分流：identification-group保持原当前授权、精确C24运行和resume行为；其它四类返回原reviewDecisionRef作为无识别动作的耐久消费结果。生产runEvent原始事件Schema、来源和当前权限复验保持；不向其它模块添加恢复动作，不复活终态。消费回执沿原consumerName/eventId去重，未知事件仍拒绝，原exhausted/10保留且不重投。

范围apps/worker/src/identification/graph/composition.ts及既有composition.test.ts，本change识别delta/IP/证据。参数化验证四类非识别决定不读取/恢复识别、返回正式决定引用，识别事件仍必须满足原恢复授权，相关运行/部署回归、构建及新制品后新合法决定取证。无公共字段、依赖、迁移或权限变化。

### D-128：多个父工件按精确引用合并空间集合

D-126新措施工件的两个合法父工件属于同一空间和两个已授权来源，正式put被ARTIFACT_ACCESS_DENIED拒绝，零清单。带写屏障的真实C06诊断证明原包装器flatMap重复空间时普通verifyDeploymentContext报ACCESS_CONTRACT_INVALID；仅去重空间后当前复验成功。API请求作用域诊断可接受重复，不能替代普通预置入口验证。

scripts/deployment/start.mjs的createDeploymentAuthorizedArtifactStoreV1仅对父工件空间并集按kind/entityId/versionId去重，沿现有Map模式保留不同精确引用；无父工件继续使用原请求空间。来源/当前权限、各父工件用途/访问与完整性、正文和审计校验保持。扩既有entrypoints.test.mjs多父工件共享空间用例，不改变C06接受的契约或绕过拒权。无DTO、迁移、依赖或权限变化；原失败保留，新制品后新预置命令消费原候选正文。

### D-129：A0入口引用恢复按当前C04访问读取

v131独立风险已正式评估并只生成风险等级预警，A7已创建原处置Agent并完成（1模型、2930输入/26输出token、无工具/纠错/重试，候选7e613994…@1）。C25实际等待A7，但返回父运行时stateOfCursor因entrySnapshotRef缺失抛ZodError，C30记录retryable-failure且尚未补父子引用。按确定性子身份查到A0–A7登记，parent_run_id空不等于子运行不存在；不重复评估或新建Agent。

写屏障只读重放证明readAssessmentEntrySnapshot仍要求当前authorizationScopeDigest与A0历史完整授权摘要相等，合法的当前来源增量变化导致undefined。只改workflow adapter该窄读：保留当前授权及精确工程/运行、唯一A0行和合法inputSnapshotRef，按该行精确artifactRef经现有#openBody执行当前C04来源/空间读取，并核对正文工程/运行；缺正文、损坏、撤权、错目标或多义继续拒绝。删除历史完整授权摘要全等，不改变原登记/指针。既有A0窄读夹具补真实C04正文，扩其当前额外来源授权仍可读取及原拒绝边界；workflow adapter与assessment/runtime回归后新制品只接续当前retryable父和原completed任务，不改预算、公共DTO、依赖或迁移。

### D-130：预置回执保留真实工件引用类型

D-129恢复诊断C04实际写入diagnostic，但provision.mjs executeStep将所有artifactRef硬投影为content-artifact，恢复脚本在提交前正确断言失败。原工件和报告保持；以当前C04读取核验真实diagnostic引用并另存证明后可继续使用原工件。

仅将预置结果原样使用所属C04返回的artifactRef，扩既有provision.test.mjs的content/diagnostic两类回执参数化测试，内容字节使用真实临时文件消费。无新字段、权限、依赖、迁移或业务动作；新报告及恢复配置引用真实类型，不覆盖旧错误报告。文件归IP-19原provision接缝。

### D-131：公开Agent完成通知恢复原评估子运行

v132父运行已按D-129恢复到原A7等待，原Agent为completed/version4；公开agent-task-completed返回202但父子版本及等待未变。C30仅为识别设置恢复上下文，评估聚合仅转交business-preparation-ready，故没有调用C25 resume，不能据202认定恢复成功。

复用原评估子运行聚合恢复通路，将评估恢复上下文统一承载既有business-preparation-ready或agent-task-completed。仅对当前waiting且等待引用与通知精确匹配的子运行调用原assessmentRuntime.resume，沿原冻结输入重建同一子身份，使用当前子版本，原样转交完整agentTaskResultRef后回读正式状态。父处于评估等待时拒绝错任务通知；其它兄弟等待不推进，已终态子不重开。C25继续核验原任务真实结果，不新建评估、Agent或模型额度。识别通知及配置准备恢复语义保持。

范围apps/worker/src/risk-flow/{graph,runtime}.ts及既有runtime.test.ts、本change领域delta/IP与证据。验证公共完成通知只转交匹配子运行、完整结果及当前恢复授权/版本保持、错任务拒绝；既有识别/配置恢复回归与build/typecheck/lint/strict/diff后冻结新制品，以新命令继续原completed任务。无公共DTO、迁移、依赖、权限或预算变化。

### D-132：评估独立运行隔离父检查点上下文

v133已进入原C25恢复但checkpoint-unavailable；只读证明原子线程仍有10条检查点，唯一命名空间assessment:8c9ec984-b945-58b9-b40a-ce005d596176，根命名空间为空。C25图包装器未隔离LangGraph父节点隐式上下文，而C24已有executableConfig固定自身saver/根命名空间并清空继承checkpoint_id/map/scratchpad。同类边界复用一个实现：将C24既有函数移至worker内部graph-execution.ts，识别与评估全部invoke/resume/retry/recover/getState均使用，C30及公开DTO不变。复用既有评估runtime真实PG夹具，父MemorySaver节点内启动并恢复评估子运行，独立读回同一PG根检查点，原C24嵌套回归保持。

锁定LangGraph版本以checkpoint_id键存在性判定历史重放；共享边界仅在当前父上下文实际携带该标识时显式屏蔽，独立调用保留缺省无键语义，避免重新执行已完成pendingWrites。既有A1业务提交领先检查点用例与新增嵌套用例均须通过。

原A7检查点不得删改或重新评估。一次受控恢复先按已观察的唯一精确线程/命名空间，通过现有checkpointer.getTuple及当前权限/引用校验读取原状态，核对工程、父子身份、图版本、A7等待、原Agent及正式评估/预警与最新C03登记完全一致，保留原检查点引用及读取证据。确认根无状态后，用原graph.recover在同一线程的根命名空间登记原等待状态；业务事务与模型设写屏障，只允许同步检查点写入及等待中断，不创建任务、候选或业务事实。新根可正常独立读取后，再按当前父版本与冻结重试策略公开通知原completed任务。不扫描其它运行、不复制/更新数据库行、不建立运行时自动猜测命名空间的回退。任何不一致停止该恢复，保留失败。

范围worker内部新共享执行配置、C24/C25图包装器、既有assessment/runtime及identification/nested-boundary回归、当前change delta/IP及实例恢复证据。无依赖、迁移、权限、预算或公开接口变化。

### D-133：已登记内嵌任务恢复只观察原任务

v134原父子已completed，A7按真实IDEMPOTENCY_CONFLICT跳过建议，正式建议0。startEmbeddedTask每次ensureTask都先重新startTask，当前恢复授权已变化，不能把新授权塞入原启动命令再要求整请求幂等；原C08拒绝同键异载荷正确，原终态和失败保留。

复用core/agent-runtime的agentTaskRefFor，从原合法启动输入派生唯一任务身份。保留现有当前授权检查，先getTask精确读取；已有则直接用同一observeAgentTask验证工程、主体、原command/idempotency、父运行、冻结输入及全部模型/策略引用，再按真实终态返回，禁止再次startTask。缺任务才沿原startTask路径并校验返回身份、读取正式快照。两条路径共用同一观察校验且不重复读取已取得快照；失败/取消不重开，当前拒权和错身份仍拒绝。适用于既有C27及C29共享接缝，不增加新任务种类、权限或预算。

仅scripts/deployment/composition/assessment.mjs及既有assessment-composition.test.mjs，扩原先两次start的测试为首次缺任务启动、当前授权变化后只观察原完成结果，补原失败/错冻结/父/主体/策略及缺任务启动边界。部署前运行相关组合/entrypoints、lint/format/strict/diff。原v134终态不复活；既有候选通过公开create-candidate/validate-and-record继续，未新增模型。无DTO、依赖或迁移。

### D-134：预测等待绑定已有正式发布

v134原候选已公开绑定并三项true，正式建议fcfc67fb…@1；可见Chrome二次确认采纳200，预测父0217dc68…waiting/A0，missingKinds=forecast-configuration。当前config.forecastPolicyReleaseRef仍是physical-forecast-awaiting-formal-release，而governance-publication-v14/forecast-policy/release-result.json已有正式knowledge-release-050053b0-0e5f-45cd-b1b9-237278b1bfe9@1。仅新增不可变config/release绑定该实际发布，先当前权限窄读确认发布类型与工程，再按原父版本及精确business-preparation-ready继续原预测等待。评分、原建议/采纳、策略正文、模型/预算不变；不复活原评估终态。预测策略引用的参数模型若不存在须明确不可用或等待，不能填零或以基线代替正式预测。后续模型或执行反馈资料需另列合成输入方案及真实来源证据。

范围实例config/release/证据，无生产代码/DTO/依赖/迁移变化；D-133新制品可同时携带此绑定，旧引用和失败保持。

### D-135：可重放合成预测、执行与反馈输入

已有预测策略引用早期语义模型标识，尚无可执行C04参数工件；trend策略声明两指标也不符合既有趋势模型仅取目标指标的契约。不得临时装默认模型。新增独立synthetic-acceptance资料，待甲方复核：模型声明CSV、合成执行/反馈记录CSV及执行后六类96点监测CSV。模拟执行时刻为生成时刻前3秒（晚于真实采纳），监测从执行后1秒开始、16点100ms间隔；沉降6.8mm，其余五类沿D126（含姿态1.25Hz），不改变评分、阈值、矩阵和已冻结基线。

预测参数明确声明为monitoring-trend，仅indicator-consequence-settlement/mm，windowPoints=16、stepMs=100、maxHorizonSteps=3、calculationScale=8，绑定本次已发布措施库7f2851e8…@1及measure-risk-level-review-d126。复核动作无定量效果依据，offset="0"、perStep="0"是新合成场景的显式参数，不是运行时默认或改善承诺；模型sampleOrigin=synthetic、reviewStatus=pending-client-review。正式C11转换逐格核对后，以真实证据段及来源作为模型C04父工件/证据，验证原16点基线预测为2mm。新forecast-policy仅该方法/目标/时域，requiredRef使用实际C04内容引用，经C18/C16/C07正式批准发布，不保留未满足的统计模型分支冒充可用。

新合成政策的业务有效时刻显式为2026-10-17T00:00:00.000Z，系统登记/人工批准/发布时间均为实际当前时刻。只以当前asOf解析供尚未冻结配置的原A0等待；不宣称政策当时已发布，不改原冻结评分、策略或历史解析结果。新config/release绑定新正式发布后，按原预测父当前版本和精确准备引用恢复，不重开原已完成评估或重采纳。若当前组合不能选择此明确双时间范围则保持阻断，不能偷换冻结时刻。

合成执行来源写明模拟暂停变径/复核、原建议与当前参与者；C11登记后，人工执行命令只引用新证据。后监测经既有C14正式登记/快照，再以同一风险、原依据/规则/矩阵及新监测形成真实确定性评估；反馈C04使用warning-response.feedback-artifact用途和新来源父工件。实际预测与评估决定偏差是否超限，C29只在正式超限事实成立后创建原预算内建议候选并人工复核，不修改已发布配置。无生产源码、依赖、迁移或预算变更；实例材料生成留断言及完整输入/回执/来源证明，不能提前计业务链通过。

### D-136：人工采纳历史等待不阻断后续配置恢复

v135新正式预测发布已绑定，原预测business-preparation-ready返回422，状态和版本不变。C30 assertResumeReferences将任意历史human-decision等待行视为当前仍待采纳，即使正式采纳路由已登记且当前等待是A0配置。仅将“其它恢复原因被人工决定阻断”的判断绑定cursor.lastWaitingRef.kind=human-decision及当前waiting；首次采纳仍要求唯一原等待行、当前版本及C41精确证明，后续配置恢复仍匹配当前精确preparationRef，历史行/审计不删。扩原C41/S2测试：真实采纳后子转配置等待，再用配置完成恢复只调用原子，不重新采纳、不增子运行；未采纳与错引用仍拒绝。范围risk-flow/runtime.ts及既有runtime.test.ts、当前delta/IP，相关回归/build/typecheck后新制品继续原预测。无DTO/依赖/迁移/权限/预算变化。

### D-137：阶段配置查询身份包含当前调用上下文

D136实机已越过历史人工等待门禁，但原A0仍等待配置。所属provider诊断明确resolveConfigurationSet返回IDEMPOTENCY_CONFLICT，被映射forecast-policy-unavailable；assessment-policy请求ID只含冻结依据/动作/requiredAt，却每次带不同当前授权与asOfRecordedAt。同键异查询拒绝正确，不能重置旧解析。

仅createDeploymentAssessmentGraphPoliciesV1请求身份摘要补入指定releaseRef和本次入口authorizationContextRef/decidedAt，先确定身份再按该requestId签发当前下游授权，原配置查询的requestId/idempotencyKey及签发配对保持。固定requiredAt沿原业务时间，当前asOf依旧当前，既有已成立A0不重新解析。扩现有“专用配置集合”用例，用真实摘要比较器模拟幂等：同一当前调用重放一致，当前上下文变化新身份且不冲突，仍只取指定发布；现有历史时刻/拒权/错成员测试保持。范围composition/assessment.mjs及原assessment-composition.test.mjs；相关部署回归/格式/strict/diff后新制品，原等待新命令继续，无DTO/依赖/迁移/预算变化。

### D-138：预测精度约束复用规范十进制上限

D135原模型calculationScale=8通过Schema但computeEffectForecast抛decimal scale is outside the supported range。模型Schema单独允许32，而既有规范十进制输出及roundCanonicalDecimalValue唯一上限为6，不能扩大算法精度或静默夹取。

仅response-lifecycle/schema.ts的模型calculationScale上限复用assessment-config已导出的CANONICAL_DECIMAL_MAX_FRACTION_DIGITS_V1；非法精度在模型解析边界拒绝，computeEffectForecast沿原model-unreadable结果，不抛底层RangeError。扩原forecast.test.ts非法模型表，保留六位内算术与舍入，相关core/adapter模型读取回归/build/typecheck/lint/strict/diff。同步本change处置预测delta/IP。

D135已登记8位声明与工件保持为失败证据，不用于正式预测。新合成模型声明CSV v2显式calculationScale=6，其他参数/资料/模型预算均不变，经新C11正式转换、真实证据绑定及新C04模型ref后再生成预测政策来源CSV（含该实际模型ref及完整候选JSON），原始三份CSV不覆盖。新政策真实审核发布及双时间按D135处理。无依赖、迁移或其它数值域变更。

### D-139：执行后评估按冻结成员判断依据相容

D135执行后六监测已登记，物理Chrome二次确认执行200。新assess可沿正式C11准备保留126kPa及地层来源，但C19依据集合身份包含准备引用与requiredAt，因此新准备即使使用相同规则/配置也产生新集合。C28反馈将“相容”实现为集合ref全等，错误拒绝正常新评估；historical-backfill还缺正式准备字段入口，不用历史回填冒充执行后评估。

复用C19精确当前受权读取，将C28 reader既有成员读取的授权/Schema/失败处理集中复用；readBasisMembers继续消费原结果。反馈先保留原风险、空间和后监测校验，再按原建议与实际评估的两次集合读取其冻结成员。评分规则成员及assessment用途配置成员必须完全一致；独立预测/偏差阶段政策不参与评分依据比较。自动组装适用规则集本身也按准备派生新引用；因此经当前C04、原用途及contentDigest校验读取两份ApplicableRuleSetDocumentV1正文，比较除requiredAt外全部结构（工程版本、适用性快照及正文、配置/兼容/组装策略、入选成员和全部决定），不能仅比较引用或只比入选数量。评分/配置成员使用原严格Schema的排序及完整release/revision/artifact/contentDigest，不另设摘要门禁、不查latest。集合、适用集身份、两次准备、输入、业务时间和审计均独立保留。任一当前读取拒绝、评分成员或适用决定变化、风险不符仍拒绝；不得修改原集合或评估事实。

范围core/response-lifecycle/service.ts内部reader契约、adapters/response-lifecycle/postgres-response-lifecycle-adapter.ts及既有response-lifecycle测试/夹具、本delta/IP。验证不同集合同成员反馈成功、评分/矩阵/权重变化或不可读取拒绝且无部分写，原反馈/偏差/权限回归及build/typecheck/lint/strict/diff。无HTTP字段、依赖、迁移或预算变更。新制品后新C11正式准备与正常assess生成实际评估，再以正式执行/反馈工件继续；原失败保持。

### D-140：偏差阶段显式选择原绝对偏差政策并绑定正式校准目标

当前C18精确读取证明旧deviation-policy正式7ee6af0f…@1含三条政策，C28入口只接受唯一政策，不能随意取第一条或混算。新增独立synthetic-acceptance CSV来源，候选明确只保留旧deviation-absolute规则及其threshold="2"、monitoring-record证据要求，其余不改；按C11正式转换逐格核对、真实C04父/来源、C18/C16/C07审核发布新版本，保留旧三政策正文和发布。新版本按当前实际时刻生效/发布，在首次反馈前由现有purpose=deviation解析并冻结，不能改已成立反馈的政策引用；预测与两次评分不受影响。

当前calibrationTargetReleaseRef仍为awaiting占位。新不可变config/release仅将其绑定两次实际C19依据均包含的正式monitoring-warning-threshold发布de2a8b10…@1；其正文及阈值不变，先当前受权窄读证明。以实际偏差结果决定是否创建C29任务，Agent只给候选和理由、沿原预算/校验/人工复核，不自动调阈值或保证通过。绑定不构成业务采纳或校准生效。范围实例新资料/候选/正式治理/配置/证据，无生产代码、公共字段、依赖、迁移或预算变化。

### D-141：运行读面不按历史授权摘要拆散同一运行

原预测父子completed、专属forecast-read200，run-read404。当前projection.query身份诊断证明精确父子链边存在且from/to与请求全同；链边摘要fe2126…、最新状态7d071f…因合法恢复的当前来源上下文变化而不同。readAssessmentRun的childLinkFor及阶段/引用查询仍以最新状态的历史摘要过滤旧事实，导致误拒及历史阶段缺失。

仅workflow adapter所属读接缝删除这些历史摘要相等条件及不再使用的scopeDigest参数。入口当前C06复验、精确工程/运行的最新C04状态读取、父状态声明的子引用、完整from/to父子链边及子状态当前C04读取保持；阶段/结果只在已受权的精确运行内有界分页，只有引用、状态等既有公开投影，不读其它运行正文。摘要保留原登记审计，不决定当前可见性；缺关系、错父子版本、当前撤权/正文不可读仍拒绝。无新接口或自动关系补写。

范围adapters/workflow/postgres-workflow-adapter.ts及既有workflow测试、当前领域delta/IP。扩原唯一子运行用例：阶段、父子链边、最新状态合法不同历史摘要时仍完整呈现，原错归属/缺链边/错版/撤权回归保持；workflow、C25读面及相关runtime/build/typecheck/lint/strict/diff后冻结新制品，只读原completed预测验证200，不重算预测或改历史。

### D-142：反馈分段固定原预测基线并按真实载荷派生启动身份

v139物理Chrome反馈返回500，但当前精确查询证明唯一feedback-ebf42566…@1已正式C28提交、C41快照committed，原预测及新实际评估引用和新偏差政策beb608e7…@1保持。失败来自新分段父62a987f7…/子d7ede78e…在A2终态response-deviation-value-incompatible：C41把实际评估输入当作预测冻结基线传入，C28正确拒绝与原效果预测的基线不一致。原失败父子不复活，不能重登记反馈。

新增C28内部context reader精确readForecastBasis：按当前已受权工程/空间读取正式预测行，复用parseForecastOutcome核验原内容及引用，以其真实frozenAssessmentBasisRef沿既有窄读取原basis集合，返回两个精确引用。C41有正式effectForecastRef时只用此原基线启动反馈分段；无预测时保留实际评估输入及既有跳过语义。实际反馈仍固定新实际评估及新监测，不改变C28偏差同基线检查或D139相容校验。

启动commandId/幂等身份以原反馈命令身份加固定分段载荷的摘要派生，当前授权签发使用同一身份；载荷包括原反馈/执行/预测/基线及图/重试引用。同载荷重试相同，新修正载荷不碰旧终态启动命令。已标记segmentStartedAt的快照不再启动；未标记时原反馈命令重放仅消费已提交快照并启动正确新分段，完成后标记原快照，零新增反馈。摘要仅承担命令身份，不作为权限门禁。

范围core/response-lifecycle/service.ts内部reader契约、core/human-decision-feedback/service.ts、adapters/response-lifecycle所属reader及既有C41测试；不改HTTP字段/迁移/依赖/预算。扩既有反馈重试测试加入真实可用预测和独立实际评估，断言分段使用原预测基线、原反馈唯一及重复提交不重启；C28/C41相关回归/build/typecheck/lint/strict/diff后新制品，原命令原载荷重放，不手写状态或新反馈。

### D-143：部署人员请求入口使用已批准当前业务授权

v140 D142工程回归及原预测基线窄读已绿，原信封重放两次401，重新可见登录仍401。入口HTTP已按服务器当前时刻授权，实际部署authorizationScope.access.authorize首个请求仍调用旧localAccess.authorize：按原invocationId命中五分钟历史context后authorize.context抛SESSION_EXPIRED，新登录也不能改变同命令的过期记录。这不是实际业务拒权，也不能改commandId重登记反馈或扩大TTL绕过。

按已归档减负D-02的现有readSession与authorizeBusinessAction接通部署首个人员入口：先用真实sessionToken验证当前会话得到accountRef主体，再以原project/branch/capability/空间/来源及调用日志编号检查当前业务权限；返回当前决定后沿既有sourceOf捕获请求作用域。内部当前业务动作复验保持；非人员入口的已批准任务/事件路径不变。删除对人员请求的旧invocationId授权有效性配对依赖，不更新旧context/TTL、不信任客户端actor、不降低撤权或资料范围检查。

范围scripts/deployment/start.mjs的授权作用域包装器及既有entrypoints.test.mjs；不改C06历史authorize、HTTP字段、依赖、迁移或预算。扩原请求作用域测试：旧authorize显式不可用、当前会话导出主体且重复原调用仍通过当前权限、当前会话失效/业务拒权无下游或业务动作。定向宿主回归/lint/format/deps/strict/diff后新制品，第三次重放仍原信封；保留两次401、原500、唯一已提交反馈及旧终态分段。

### D-144：校准整体策略与Agent校验策略分别绑定

v141原反馈信封已越过当前授权及原预测基线校验，形成唯一正式response-deviation-a431c31d…@1：预测2mm、实际6.8mm、绝对4.8mm、threshold2mm超限。新父a653e333…/子237c43cb…在A3以UNSUPPORTED_CONTRACT终止；旧A2终态保持。C29正确要求calibrationValidationPolicyRef匹配CalibrationValidationPolicyV1.policyRef，部署provider错误返回其validationPolicyRef；后者是C08候选校验身份，不是整体bundle身份。

assessment组合provider和calibration Agent入口统一使用外层policyRef，C08启动继续使用内层validationPolicyRef。calibration-task注入既有policyCatalog，按snapshot工程、calibration类型及外层精确ref解析共享Schema bundle，核验工程/外层ref和内层ref与任务信封分别对应；保留当前C06/C04、模型/提示/工具/预算及冻结输入绑定。不得删除校验或改C29正确比较，不新增公共字段、依赖或迁移。

范围scripts/deployment/composition/{assessment,calibration-task}.mjs、start.mjs及既有assessment-composition/calibration-task测试。fixture外层和内层使用不同身份，验证合法对应及错工程/外层/内层拒绝且零部分写，保留既有校验和宿主回归。验证后冻结新制品及配置，riskFlow/assessment图定义发布physical-20261017-d144-v1；其余模型、策略、预算和业务输入不变。真实修复图版本沿既有workflowRunIdentityFor派生新运行，不重开两个旧terminal运行。原反馈信封重放消费唯一反馈及已正式计算偏差，不新登记反馈、不重算预测/实际评估/偏差；新任务和预算按真实结果记录，人工审核仍为生效前置。

### D-145：恒值频谱不得把浮点均值残差作为主峰

D135正式16点/100ms恒定6.8mm快照报告0.625Hz；频谱去均值时重复加法舍入产生常数残差，经Hann窗后非零，零frequencyPowerFloor误选k=1。主规格排除直流，恒值本来无主峰；现有测试仅整数7未覆盖。

在core/engineering-data/monitoring/features.ts所属calculateDominantFrequency中保留连续点数及有限数值检查，确定原窗口全部数值精确相同时返回既有no-dominant-frequency；不引入epsilon、功率阈值或修改其它特征。扩既有monitoring.test.ts恒值用例，覆盖16点/100ms/6.8/零功率下限和原整数；保留真实周期、并列、缺样及溢出边界。无新依赖、字段或迁移。新制品后以新明确频谱算法版本的可用性策略创建独立快照，复用原样本/截止点并逐值核对；原正式快照、评估、反馈及偏差不修改、不以新快照替换原引用。该修复不代表原校准任务成功。

### D-146：校准输入继承真实来源并在任务启动前冻结

v142原反馈重放200，唯一反馈已标记segmentStarted，新父6f295018…/子eb61261b…等待A4真实校准任务；任务在模型前以AGENT_AUTHORIZATION_DENIED/deployment-context终止，模型/工具/重试均零。精确读取证明任务来源集合为空，输入工件也无证据/父工件，基准阈值正文要求原配置来源s_09d7266…@1；C06正确拒绝任务读取未冻结来源。

C29 prepareInput保存工件时以target.artifactRef为真实父工件、fact.evidenceReferences为直接证据，复用C04既有父来源/访问并集与当前权限检查；治理候选同样继承原baseArtifactRef和真实候选证据。仅私有put helper增加必填父/证据参数，不改快照Schema。部署校准provider在start前通过已注入的C04精确manifest reader取得该输入的工程、用途、完整ref及继承来源/访问授权；只有绑定正确、证据非空才把证据来源去重和sourceAccessGrantRefs交原authorizeBusinessAction，签发当前人员权限并冻结到新任务启动授权。空来源、缺清单、错工程/ref/用途均零任务启动，当前拒权继续失败。共享startEmbeddedTask只接可选内部来源参数，C27保持原调用。

范围adapters/calibration/postgres-calibration-adapter.ts及既有C29测试、scripts/deployment/composition/assessment.mjs和start.mjs及既有assessment-composition测试。验证C04正式清单父/证据继承、合法非空来源冻结和缺失/错绑/当前拒权零启动；相关回归/build/typecheck/lint/deps/strict/diff后新制品。v142任务真实失败，agent-task-failed只支持retrieval-review，实际通知400保留，不伪造完成结果。沿公开workflow.cancel-run取消原等待父及子运行，保留任务failed和零用量；原segment_started_at保持，不能重放原反馈产生第二分段。使用已有公开workflow.start-run record-response-feedback入口，以原唯一反馈/执行/预测/基线及修复图版本发布新独立后续运行，原反馈/偏差不重算、不复活旧终态、不修改旧冻结来源或预算。新图版本physical-20261017-d146-v1，模型/阈值/预算不变。

### D-147：可修复模型候选使用新的行动身份

v143任务来源四版本已正确冻结并通过输入/基准读取。首个模型输出Schema不合法，真实usage9493输入/1569输出已保存；后续纠错沿同action:1，带validationFeedback的新输入写同agent-model-input命令键，C04正确报ARTIFACT_IDEMPOTENCY_CONFLICT/registry.register，任务terminal-failure。账本modelInvocations=2、corrections=1，其中第二次在输入工件写入前已预留并按失败行动结算、未再次到达模型；不得把账本次数冒称两次外部调用或改旧账。

Worker从行动序号1沿既有有界恢复路径读行动，已完成工具/模型仍按原证据重建；已失败且errorCode=AGENT_VALIDATION_REJECTED的model-invocation保留原记录/工件，推进到下一行动序号，并把原验证反馈交新模型输入。新的模型输入、响应与候选使用新行动身份，仍是同任务、同冻结输入/模型/预算；当前租约、来源、权限和不确定行动拒绝不变。真正可安全重试的技术失败继续原行动恢复。新纠错行动预留至少一次corrections，在外部调用前由累计预算拒绝不足；已完成行动后清除纠错反馈，不传播到无关后续模型。候选版本继续只计候选，不能当行动游标。

范围apps/worker/src/agent-runtime/runner.ts及既有runner.test.ts、当前runtime delta/IP。扩既有模型Schema失败/用量用例为连续两次claim：第一次失败记录不改，第二次新行动携带验证反馈并正常完成，验证工件键不冲突、用量累计及预算不足不调用模型；工具恢复/租约/取消/预算相关回归保持。build/typecheck/lint/strict/diff及真实新图版本physical-20261017-d147-v1后新独立后续运行消费原反馈/偏差。原v143任务及账本不复活，旧等待运行受控取消；不重登记原业务，不增依赖/字段/迁移或预算。

### D-148：校准生成Schema固定可信任务及完成结果绑定

v144已验证新action:1、2、3独立，未再发生工件键冲突；前两次模型响应均未给completed结果任何primary output，按共享Schema在resultRef.status拒绝。第三行动在request.input-quota调用前拒绝，原预算不扩容；任务version7终态，账本modelInvocations3/corrections2，真实两响应usage19003输入/2857输出。受保护原响应仅在内存解析并输出Schema路径/码及操作kind，不展示/复制思考内容。

response-model-step在C29 render时复用原definition.actionSchema，用safeExtend仅将taskRef、inputSnapshotRef及完整resultRef缩为本任务真实值的生成Schema；模型无权声明其它任务/输入或漏掉完成结果primary output。候选身份由当前任务和下一候选版本确定，使用已有buildCompletedAgentTaskResult构造完整绑定，加入实际模型输入；rationale、evidenceReferences和operations继续由模型产生并经过原候选/领域校验。生成Schema复用原精确ref结构与所有预算/候选约束，不修改公共Candidate DTO、正式建议身份或解释器校验，不删除正确的completed主输出约束。去掉生成时无关结果联合分支减少输入Schema规模，预算与专业规则保持。

仅scripts/deployment/composition/response-model-step.mjs及既有response-model-step.test.mjs、当前delta/IP。扩C29真实输入用例核验生成绑定合法、缺primary/错任务/错输入拒绝及原字段校验；相关模型步/校准/宿主回归/lint/format/deps/strict/diff后新制品及真实图版本physical-20261017-d148-v1。取消旧等待运行，以原反馈/偏差开启独立后续取证，保留旧失败/原响应及预算，不复活旧任务。

### D-149：校准检查点按当前权限及真实结果身份读取

v145原校准Agent completed/version4，1模型5922输入/1209输出、1操作/1候选、零纠错/重试，正式建议calibration-suggestion-1b088599…@1、pending偏差记录及C07复核均已提交。完成通知在后续readCreatedDeviationRecordRef返回空，父3cf536bb…/子dea644cb…A4 calibration-created-record-missing终态。独立当前读取证明正式view成功；authorizationFullEqual=false、candidateResultFullEqual=false，但taskRefFullEqual/resultIdentityEqual=true。模型提交的候选结果与finalize后的正式结果合法有不同primary candidateRef及validationRef，不是另一个任务或结果。

仅C29 verifyCheckpointReference去掉当前C06决定与入口完整授权对象相等，继续以所属#verifyRead当前工程/主体/能力/空间决定读取；精确父运行/版本、候选/验证/复核/记录摘要保持。存储的Agent结果按共享AgentTaskResultRefV1Schema解析并要求completed，核验候选完整taskRef与正式结果agentTaskRef一致、两结果reference一致，候选仍completed且其taskRef匹配行task身份；允许finalize添加校验引用和正式候选身份。不得只检查状态、忽略完整任务绑定或修改旧候选/结果来通过。

范围adapters/calibration/postgres-calibration-adapter.ts及既有C29 test/fixture，fixture在原真实C06复验后投影新当前时刻，并让候选暂存结果与正式结果分别保存，扩原检查点用例覆盖合法差异及错任务/结果身份拒绝，原错工程/父/版本/撤权零写保持。相关C29/graph回归/build/typecheck/lint/deps/strict/diff后新制品，只读原正式建议/偏差及物理Chrome复核，消费原completed任务，不调用新模型、不复活原terminal图或重登记建议。当前原图失败如实保留，不以正式view成功宣称整图completed。

### D-150：桌面测试不固定历史后端迁移号

IP-18预检仍要求manifest.finalMigrationVersion等于000058，而已批准减负迁移及当前正式宿主均为000059；这会在启动Electron前误拒合法同源发布。桌面只负责客户端/服务器发布兼容，实际数据库迁移由正式服务器启动沿当前清单验证，测试不维护第二个后端迁移事实源。

仅删除apps/desktop/test/e2e/acceptance.mjs该历史常量判断，保留严格清单Schema、当前release/config/code/origin、客户端兼容、功能报告/任务/资料/下载精确绑定、秘密及拒绝目标检查。既有client.spec.ts预检夹具改用000059，先红后绿核验合法新清单；错发布/工程/报告和不合格输入仍拒绝。同步施工图当前迁移事实为000059，不改生产迁移/依赖/桌面功能。预检通过不替代真实完整Electron场景。

### D-151：验收宿主识别真实异步受理及Agent执行等待

生产工作流合法返回202/waiting及精确workflowRunRef/agentTaskRef，synthetic运行器虽通过正式结果Schema，仍只接受kind=succeeded，导致真实受理被误记失败。桌面关窗场景只允许pending/running，忽略LangGraph等待正在执行内嵌Agent的正常waiting；不得把人审等待、失败或完成冒称在途任务。

仅scripts/acceptance/synthetic.mjs及既有synthetic.test.mjs、apps/desktop/test/e2e/acceptance.mjs及client.spec.ts。运行器只对正式Schema已验证的异步命令接受waiting，仍记submitted；从真实waiting回执的workflowRunRef/agent-task等待引用形成私有统一result引用投影，沿原captures验证/保存，不推断状态或引用。非异步waiting、失败、坏Schema和缺引用仍拒绝，submitted不等于completed。

桌面同次绑定可携正式启动回执中的精确agentTaskRef。关窗前若运行waiting，必须通过同会话当前正式agent-task.detail证明同次该任务queued/running；否则拒绝。pending/running仍按原语义，关窗后仍必须同一运行completed，不放宽终态或复用别的任务。扩现有synthetic异步用例及桌面预检夹具检查；预检/工程检查通过不计真实Electron场景完成，无生产DTO/预算/依赖/迁移变更。

### D-152：知识编制模型读取冻结定位与所属观察

C17生产模型步只收到frozenManifestArtifactRef和previousObservationArtifactRef，未注入任何读取能力；两个领域工具又要求准确的清单成员定位，模型无法从不透明引用取得定位或工具正文。现有脚本化网关测试预置工具请求与候选，掩盖这一生产缺口。

仅在C17 adapter、Worker identification-knowledge runtime/composition及既有测试补模型前窄读：沿当前受权C04完整读取冻结manifest并核验工程、发起者、父运行及策略版本，模型只投影目标类型、真实准备/成员、可选基线、类型质量约束及下一候选版本。资料正文继续只经两个既有白名单工具；观察工件保存完整taskRef和冻结manifest引用，读取时按用途/上限及两绑定校验，再把所属观察正文交模型。基线观察提供已有精确读回的包和摘要，不另读全库。模型请求保留正式actionSchema和累计预算，以有界单次输出额度预留，错任务/清单及当前拒权在模型前失败。不新增HTTP、工具、依赖、迁移或放宽内容校验；结果仍是待审修订。

扩既有Worker模型步测试证明冻结成员/真实观察进入模型、未完成工具观察不得进入消息、错绑定零模型；扩既有C17生产工具测试证明观察可读及异任务拒绝。相关C17/组合根/runtime回归、build/typecheck/lint/deps/strict/diff后冻结新制品，使用现有生产prepare入口和真实所属父引用取证；不把历史终态运行复活或虚构C30状态。

### D-153：C17提交使用当前真实来源范围并透传基线

D152 v148真实案例编制完成8模型/7工具，usage81635输入/3361输出，形成通过领域校验的候选；提交在本地validation事务前失败。候选包与validation工件已耐久，尚无validation事务回执/正式修订。独立C06/C04证明原授权25个grant可读候选，verify请求空来源后grant为0，静态引用守卫正确拒绝。失败任务及原预算保持；原父仍真实knowledge-preparation等待，不把候选当正式结果。旧缺基线诊断只证明C16既有base-release-required门禁，不是该次首个失败位置。

C17保留入口授权的主体/工程/能力及原上下文当前复验，随后通过已注入#authorize和可信来源解析器，按同主体/工程/原空间与真实声明来源签发当前所属分支上下文供C04/C03使用；拒绝redacted或真实撤权，不拼装授权对象、不复制旧grant、不扩大来源。编制finalizer把manifest可选baseReleaseRef原样传入C16；已有定义必须由新任务显式冻结实际基线，C16原精确/当前版本门禁不改。新取证应使用该基线包所属真实C15准备与来源，不以不含基线证据的五资料准备冒充合格更新。

范围C17 adapter及既有fixture/test：fixture模拟生产当前verify的空来源返回，先复现C04拒绝，再验证当前来源恢复和真实撤权拒绝；扩既有编制链用同项目已发布基线形成新待审修订。相关C17/宿主回归/build/typecheck/lint/deps/strict/diff后新制品，原失败任务不复活；失败人工复核按既有所属接缝继续取证，不将未收口attempt记为通过。无新HTTP/字段/工具/依赖/迁移/预算。

### D-154：桌面分别绑定同次运行观察与可导出查询

桌面预检从sharedObjectUrl对应projection.query的payload.workflowRunRef推导运行，但正式报告导出只接受risk-overview，只有run-view才有workflowRunRef；旧夹具省略queryType而误通过。预检应从同份functional配置明确观察的唯一workflow.start-run正式回执取得运行，从共享URL精确定位同次risk-overview查询，分别核验各自身份。下载artifact还必须由同次export请求的sourceRef精确绑定该risk-overview回执，不能只匹配返回artifact。

仅apps/desktop/test/e2e/acceptance.mjs及既有client.spec.ts夹具/边界测试。夹具显式区分run-view观察查询和risk-overview导出查询，并以真实模板关联启动、查询与导出。旧错工程/发布/来源/秘密边界保持，异查询导出及非risk-overview共享源拒绝。预检回归不代表Electron实跑，无生产HTTP/Schema/依赖/迁移变化。

### D-155：知识编制的C08候选校验工件使用既有用途

v149新任务正确读基线及案例资料，3模型/2工具、85449输入/2566输出。模型对已存在case-entry-01直接cite-case，所属领域按increment-target-exists正确返回repairable；校验工件也已保存。后续C08 recordCandidate按既有agent-validation用途核验，而C17该工件误用identification-knowledge-validation，C04用途拒绝被外层映射为AGENT_TOOL_FAILURE，原任务version3终态、候选尚未登记。candidate-diagnosis-v149.json证明基线摘要一致、纯领域拒绝及校验Schema合法，不是模型/工具读取失败。

仅C17 #validateAuthoringCandidate的工件用途改为agent-validation；C17包提交自己的validation用途保持。扩既有C17测试直接经正式manifest reader核验可接受和repairable校验工件的C08用途，保留原C08严格用途门禁。Worker知识编制指令说明已有标识的声明须先用同一候选的对应retire操作；不改领域操作/候选Schema或把重复声明放宽为覆盖。原纠错在新任务累计预算内运行，原v149终态/真实消耗不重置。相关C17/C08/runtime及宿主回归/build/typecheck/lint/deps/strict/diff后新制品和同活动父下的新独立任务；旧失败仍须按原失败复核契约闭合。

### D-156：知识模型清单无损压缩并限定目标生成Schema

v150已越过C08用途守卫并登记repairable候选version1（increment-target-exists），新行动纠错正常开始；原预算在action8/request.input-quota外部调用前拒绝。账本5模型包含该次零用量尝试，真实4响应116672输入/2849输出，3工具/1纠错，taskVersion6终态。清单16成员/595保留标识的JSON为45049字节，每步重复长来源前缀，冻结预算保持196608输入/262144上下文。catalog-compression-proof-v150.json证明沿C15既有公共前缀模式可完整还原全部标识，定位JSON降至24976字节，不减少来源/资料段或截断正文。

仅Worker identification-knowledge/runtime.ts及既有runtime.test.ts：模型定位投影改为每成员真实sourceVersion/sourceSegmentSet、资料段公共前缀与全部后缀，明确按拼接还原原工具所需标识；C17原manifest和领域工具DTO完全保持。生成Schema复用正式Action及Candidate Schema，只保留当前manifest目标定义的候选分支并固定下一候选版本，两个原工具动作保持；解释器和原确定性校验继续验证完整正式契约。实际观察仍完整保留，累计预算和模型不扩大。测试验证全定位往返、长重复定位确实缩小、合法工具/当前目标候选接受及异目标/版本拒绝，相关回归/build/typecheck/lint/deps/strict/diff后新制品新任务；原v150失败/用量不改。

同步既有composition.test.ts的C06夹具：按请求分支返回正式映射能力，目标读取测试只核对相应分支及冻结范围/任务绑定，不把D153新增当前范围签发视为能力错配或固定内部调用次数。错主体、拒权、越界零读取的原断言保持。

### D-157：共享部署复验保留原上下文自己的范围

v151原risk-overview查询200、报告policy读取200，preview/export均422。report-scope-proof-v151.json证明同一调用原25grant，经部署verify变0，配对result-read又按真实范围签发25，C35按父范围子集正确拒绝source-page-unreadable。C17先前相同缺口由D153额外authorize补偿；继续逐模块补签会重复同一规则。C06原生verify已经定义空资源复验使用原context自己的空间及来源；部署actionDecision(reuseSnapshot=true)直接重授权却漏掉该语义。

仅共享部署actionDecision在复用审计上下文时，从请求authorizationContextRef的C06持久来源元数据取得原范围；当前作用域本身同ref时复用其已读元数据，其它ref按当前主体/工程精确读取。空/未提供资源集合按该原上下文范围复验，显式非空仍用实际请求；新authorize继续保持显式空集合，不用环境更宽范围补位。未知来源关闭失败，当前C06 authorizeBusinessAction、taskRef/租约/冻结范围、真实撤权及原审计快照不变，不复制旧grant或恢复TTL门禁。

删除C17 D153的重复current-scope签发及其专用窄verify夹具，保留入口与当前决定主体/工程/能力/redacted检查、基线透传、C08用途和原领域校验。范围scripts/deployment/start.mjs及既有entrypoints.test.mjs、C17 adapter与既有fixture。根回归覆盖原上下文小于环境范围、普通verify/工件verify共用语义、显式空新授权、显式非空复验、未知ref、当前拒权；C17/C35/宿主回归、build/typecheck/lint/deps/strict/diff后新制品，仅重读原报告查询，不伪造导出或复活旧任务。

### D-158：纠错模型恢复最新拒绝候选与完整校验

v151真实行动证明模型已读正确基线，却三版重复increment-target-exists。通用Runner只附错误码，缺前一候选及逐项校验，并在中间成功工具行动后丢反馈。沿既有C04 agent-action-result用途以独立稳定子身份保存candidate-feedback，包含真实actionId、完整taskRef、原行动证据引用及耐久候选元数据，保留原响应链。恢复时经当前授权、用途和字节限制读取，核验完整任务/行动绑定、rejected及validation，只加载等于当前latestCandidateVersion的候选；通过正式候选解析器恢复原agent-candidate内容。后续模型数据上下文保留该候选与完整校验，跨工具调用及重新claim均有效；旧无候选反馈行动保留原错误码处理。

范围apps/worker/src/agent-runtime/runner.ts与既有runner.test.ts，及本change工件。通用渲染后附结构化反馈，各任务复用同一机制，不堆C17专用提示或重复读取。原不可重试校验、纠错/输入/输出/墙钟预算、受限工具及正式结果确定性验证保持；不读取模型内部思考、不改旧终态、不新增DB/公共Schema/依赖。验证拒绝候选保存、原行动证据链、下一模型完整候选/校验、跨工具与恢复，以及错任务反馈在模型前拒绝；相关回归及工程检查后与D157合并新不可变制品取证。

### D-159：报告预览接受所属分页端口的真实游标

D157后v152真实原查询的登记摘要等于零来源摘要，与当前25grant不同，按原历史范围拒绝，不改登记。新正式risk-overview查询读取成功，但真实C31游标超过512字符，C35 preview nextCursor的任意512上限导致HTTP Schema返回500。C31请求/结果以IdentifierSchema表达游标，C35预览复用相同Schema；不改变游标编码、精确查询/范围绑定或分页预算。C35自身history游标仍按其原契约。范围packages/core/src/workflow/report.ts及既有C35数据库测试，覆盖真实长引用产生游标、源端续页与预览Schema往返；工程验证后新制品，旧查询及失败回执保留。

### D-160：失败复核逐attempt恢复控制来源并使用当前治理基线

正式Worker在退出任务租约作用域后调用C17失败收口，当前无调用来源，四旧失败始终未送审。C17 settleAuthoringFailures增加仅供组合根的逐attempt操作回调，传精确projectId/actorId/taskRef；宿主从C08真实任务只读取信封来源，完整核验任务/主体/工程，再以既有authorizationScope.run和原parentRunRef建立独立控制来源，不借终态任务租约。当前C06逐分支重授权，C08 readTerminalFailure继续独立核验终态并提供唯一失败证据；不把getTask当失败证据，不改变旧终态和用量。

失败修订只为人工诊断，不是旧模型候选提交。提交前以当前C06 identification-basis授权通过C16 resolveGovernedReleases读取该定义在处理时点的真实有效基线，带入C16 submit；仅其明确missing发布的结构化业务拒绝允许省略基线，让C16继续区分首版/已有未发布定义。拒权、冲突、缺修订及技术错误原样失败。原manifest不变，failure-review-only永不可发布，逐阶段CAS/断点续作保持。范围C17 adapter及既有测试、scripts/deployment/start.mjs和entrypoints.test.mjs；覆盖逐attempt绑定/拒权零写/已有发布后失败送审/原始失败和预算不变，相关回归及全部工程检查后实机读取旧失败正式修订/复核引用。无新DB/依赖/公共DTO/预算变化。

### D-161：知识编制切片工具返回真实转换正文

v152模型输入包含完整纠错候选和校验，下一调用因累计输入不足正式失败；五次segment工具只返回C02段标识/kind/locator/excluded，未返回正文，模型无法据原材料编制。复用C17 checkStandardRetrievalText已实现的C15清洗manifest→精确JSON-LD→证据片段→文本块读取，提取为该准备读取器的一个私有方法，校验工程、冻结sourceVersion/segmentSet、保留段、片段唯一性、每块的真实版本与段绑定，保持已有字节上限和当前授权。规范检索文本仍按同一真实块顺序逐字核验；segment工具在原定位外补该精确段的textBlocks及sourceVersionRef，保留真实坐标/置信度，不编造、截断或把基线当正文。

范围packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts及既有adapter测试；复用已安装Schema与C04，不增加工具、通用文件读、私表读取、依赖、迁移或预算。既有正式切片用例断言返回原JSON-LD精确块，保留错版本/异集合/排除段/无权/损坏与规范正文回归。完成工程验证后新制品和独立新任务，五旧失败、原manifest、基线、消耗均保持。

### D-162：风险追溯按实际登记来源检查当前权限

v153报告第15页原df1a…运行的状态/结果可读，正式风险记录仍在且有000054登记的五份来源/空间；其历史授权摘要为零来源，C22 trace-reader却要求与当前25grant摘要全等，返回ENTITY_NOT_FOUND并使整份报告失败。按已批准减负D-02，历史摘要保留审计，不作为读取可见性的替代。

C22保持一次有界SQL取本批精确工程/版本记录及自身登记的source_version_refs/spatial_scope_refs，在披露各条最小引用前经C06既有authorizeBusinessAction按真实目标检查当前主体、工程、branch能力、实际空间/来源和必要任务上界。相同资源组在同一次读取内复用当前决定，不另建缓存/持久票据。元数据缺失或非法、无权/撤权、跨工程、错版本同形不可读；不扩大正文披露或改旧记录。真实来源权限与范围由C06判断，不用字符串空间比较或复制历史grant。

范围packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts、既有adapter测试与apps/worker/test/risk-flow/acceptance.test.ts的C06夹具；真实组合根已有C06业务动作接口。更新旧仅靠摘要差异模拟隐藏的夹具为真实目标空间拒绝，覆盖额外无关授权/旧摘要不挡原可见记录、撤权/越界/错版零披露和原批量上限。C22/完整报告/Worker回归、工程检查及新制品后从原真实查询完整取证；不跳过报告第15页，不追改历史数据，无依赖/迁移/领域Schema变化。

### D-163：模型输入仅投影编制所需正文与真实剩余额度

v154真实读取正文后，3次响应84049输入/4670输出、3工具/149对象，下一模型请求在input-quota拒绝，尚无候选。原工具观察完整textBlocks反复包含源版本/段/块链、重复请求段ID与内部相邻块标识；模型提交操作仅引用精确来源段，不使用块链。Worker渲染对segment工具的当前受权观察按正式TextBlock Schema解析，仅投影blockId、完整text、headingPath、已有coordinate/confidence，父segment与sourceVersionRef保持；工具输入在模型视图保留类型/集合/limit及请求段数量，完整请求ID仍在原行动与观察中，不改工具输出/持久证据。基线包不压缩或代替正文，不删实际段和正文字符。

渲染同时提供任务账本计算的剩余输入token、模型/工具调用和纠错次数，提示按剩余额度选择小范围真实材料、证据充足即提交。实际硬门禁/模型/任务预算保持，不由提示决定权限或扩容。范围Worker identification-knowledge/runtime.ts及既有runtime.test.ts；验证原正文/坐标/置信度保留、原对象不变、重复输入减少、实际剩余额度准确。用原v154不可变输入离线投影量化后再新制品/独立任务，不把模型前拒绝算真实响应，无依赖/迁移/公共DTO变化。

### D-164：公共报告浏览器夹具只引用其账号可见的资料

D162实际权限修复后，浏览器公共夹具启动的C35正向导出失败：operator无权读取资料B，chain-a/b公共报告却同时引用含B的recordReview；此前仅比摘要的C22误放行掩盖该矛盾。apps/web及demo同构business-server.mjs的公共报告运行只引用真实可读recordAuto/A，原受限B、跨A/B的人工复核记录和对应识别/证据权限场景完整保留。只修合成夹具，不扩大operator权限、不修改生产拒权或跳过用例。完整90项浏览器回归重跑，初次2失败/1中断/87未运行留存，不冒称通过。

### D-165：新知识编制任务在原总额度内重分配输入/输出

按用户持续批准的必要修复授权及evidence/knowledge-input-output-budget-rebalance-proposal.md，将新独立任务的输入/输出上限从196608/65536调整为229376/32768，总和与context总上限均保持262144。v155真实下一纠错输入89197字节超过剩余输入77735，网络网关保守预检正确拒绝；不修改预检或旧任务。只追加新knowledge-budget与所属knowledge-validation策略版本，原模型/提示/工具、调用24/48、纠错2/重试2及其它硬上限不变。

范围为隔离宿主新不可变catalog/config及本change证据，不改公共Schema/算法/依赖/迁移。新catalog保留全部旧条目，项目绑定精确新策略；正式Schema/预算总和/其它字段不变自检后新制品重启，只对新任务生效。旧七失败与候选/消耗/失败复核保留，实际终态仍独立核验。该版本仅适用于synthetic-acceptance，不能包装为甲方正式资源定额。

### D-166：评估决定工件按自身行动取得当前来源授权

完整browser回归的初评在A3确定性结果提交失败。独立真实夹具复现表明C04的registry.parent-access拒绝：C19真实规则/适用规则集父工件登记两份来源，C25准备只包含风险资料A，evaluate复验按准备收窄后所得上下文不能访问另一规则来源。确定性计算已完成，事务回滚，无正式评估事实；不能删除父工件或扩大账号权限来通过。

C25的私有putDecisionArtifact沿已有authorizeFor/authorizeDownstream接缝，使用实际decision写行动身份与已验证空间取得当前risk-assessment.evaluate授权，来源范围仍由部署受控调用来源限定，C04逐项校验全部父工件；同一授权用于并发回读。准备、风险事实、监测及提交前复验保持现有范围与当前拒权。范围仅生产C25 adapter与既有engine/browser回归，复用原端口，不改公共DTO/依赖/迁移或历史记录。先定向初评及现有C25权限回归，再全量browser。

### D-167：验收CLI遵守服务端同源POST契约

v158真实functional首次执行在登录即CONTRACT_INVALID/400，业务步骤未发送。API对所有POST校验Origin等于部署publicOrigin；synthetic共享requestJson未发送该头，登录/命令/观察查询均不能通过。共享请求函数从既有受限目标URL取origin并作为请求头发送，保持manual重定向、TLS校验、Cookie和请求信封/身份不变。现有synthetic测试替身按服务端同源规则拒绝缺失/不等Origin，先红后绿；复用functional回归与真实CLI验证。无服务端/公开Schema/依赖/迁移变化，原失败报告保留，不手造run.json或装填历史回执。

### D-168：评估终态观察使用所属C34运行详情

真实CLI已受理并完成新评估，但原观察用C31 run-view，其run-summary.workflowRunRef携当前状态版本，不能匹配启动回执的稳定运行引用，故观察器正确拒绝。既有C34 risk-assessment.read/run-read明确分别返回原runRef和stateVersion，resultRefs含正式run-result。功能观察器追加支持这一既有DTO：operation=run-read、result.kind=run-read、runRef与同次启动回执逐字段精确一致才读取顶层status；只有resultRefs中assessment-run-result或risk-flow-run-result可证明正式结果，stage/review/audit等辅助引用不算完成证明。C31原严格匹配保持，不更改服务端/记录/公共Schema。范围functional.mjs及既有functional.test.mjs，验证状态版本独立、异运行/错版本拒绝和辅助引用不能通过，再真实CLI完整执行并观察。

### D-169：C34内部工件读取不显式清空调用来源

D166后浏览器初评已正式完成，启动向导跳到运行页却显示无权。C34共享artifactReadAuthorization显式requestedSourceVersionRefs=[]，使真实C06夹具按空集合签发，而运行/决定工件登记了原两份来源。删除这一显式空值，既有下游接缝按受控人员调用来源继承当前来源；主体、工程、分支及已验证空间仍显式限定，C04继续按已登记父工件来源逐项检查。复用共享读取方法，不恢复全工程来源扫描或增加比对门禁。范围C25 adapter原方法及既有权限/浏览器运行详情回归，无公共DTO/依赖/迁移变化。

### D-170：校准工件使用既有证据集合规范化

真实browser反馈后的A3校准准备失败，独立Node复现捕获ArtifactPutCommandV1Schema的evidenceReferences重复/未排序错误。C28偏差事实合法合并预测和实际评估证据，同一来源可重复，领域ResponseDeviationFact允许此表示；C29直接透传到C04规范集合契约而拒绝。C29共享putArtifact复用已有normalizeEvidenceReferences，排序去重后写工件元数据，不改原偏差事实、证据定位、原校验或预算。扩已有越限准备/幂等/证据继承用例，输入重复证据、验证工件仍保留原证据且原事实不被修改，再真实browser反馈/校准回归。无新helper、公共DTO/依赖/迁移。

### D-171：Electron任务继续观察复用所属运行详情

桌面readRunStatus使用两次HTTP（登记C31 run-view、再读页），仍把当前状态版本与启动引用全对象字符串比较，重复了D168已实机确认的身份混用。改为一次既有C34 risk-assessment.read/run-read，核验原runRef的kind/entityId/versionId后只读顶层status，与functional使用相同所属DTO。删除额外投影登记和JSON.stringify身份比较，不改关窗前仍在执行、原任务引用及关窗后同运行completed的原验收条件。范围client.spec.ts私有helper及原真实Electron场景，无产品代码/公共Schema/依赖/迁移。

### D-172：桌面测试从应用已声明依赖解析Electron

当前pnpm根workspace没有声明electron，只有apps/desktop声明该依赖。真实桌面测试从根目录执行，不能假定Playwright能从根目录解析应用局部依赖。启动helper沿apps/desktop/package.json用Node已有createRequire解析其正式electron路径，显式传入executablePath；复用当前版本，不安装或新增依赖，不修改产品启动/TLS/sandbox策略。范围仅client.spec.ts的import与共享launchClientV1，验证仍为原14项真实Electron场景。

### D-173：桌面连接失败页只处理主框架真实加载失败

原生Electron复现捕获首屏loadURL被后续同源导航取代，did-fail-load报告-3/ERR_ABORTED，后续页面已200却被连接页覆盖。main.ts的did-fail-load忽略-3和非主框架失败；首屏loadURL拒绝处理同样忽略errno=-3。真实网络/证书加载失败仍进入原连接状态页，越界导航/新窗口/iframe/TLS/sandbox策略保持。复用已有真实越界导航与TLS拒绝用例及原生最小复现，不新增同实现的单元测试或公共契约。允许文件main.ts和client.spec.ts，证据只记录事件码/URL和结果。

### D-174：报告窄读透传既有用户来源选择

实机报告已由正式CLI生成，C35页面却显示空历史。client.ts的postQuery只为risk-assessment.read转发既有assessmentSources选择，projection.report-read始终发空来源，即使用户已声明也被丢弃。复用现有解析与工程/修订绑定，将报告窄读纳入同一默认来源透传；显式sourceVersionRefs仍优先。扩既有真实报告browser用例核对history/preview/artifact三种请求的来源，原下载及URL释放断言保留。不改服务器授权、历史摘要、角色或来源资格，也不自动枚举全工程来源。范围client.ts、原agent-audit-operations.spec.ts、桌面acceptance.mjs和client.spec.ts；桌面预检从同次已匹配overview回执保留reportSourceVersionRefs，登录后沿现有来源选择UI声明该精确范围，不误用可能更宽的启动来源或把资料列表塞入受512字符限制的测试共享URL。导航断言轮询既有locator.isVisible，避免被拒绝的导航让Playwright自动等待永不提交的导航；仍核对页面可见、原origin及拒绝新窗口。

### D-175：HTTP路由参数上限复用已有运行引用契约

正式SSE返回414/FST_ERR_MAX_PARAM_LENGTH，当前人员直接调用所属事件reader成功且来源35/35、redacted=false。Fastify默认参数上限100小于合法base64url运行引用，真实编码约280字符，HTTP入口因此先于公开Schema拒绝。http.ts以同一常量保持既有EncodedWorkflowRunIdV1Schema最大2048，app.ts的routerOptions.maxParamLength引用它；其它路径及严格解码仍由原Schema验证，不新增旁路或放宽引用身份。扩原逐事件当前会话/来源/独立调用身份测试，使用真实长运行标识和64字符版本，先红414后绿200。范围app.ts、http.ts及既有http-shell.test.ts，实机再核验SSE握手/游标。

### D-176：桌面撤权用例按报告自身范围读取并正确恢复

原撤权用例在前置读取时误用启动的36份来源，而同次overview只有35份。原finally即使没有修订成员也尝试恢复，未登录的管理窗口再失败，掩盖首个错误。queryV1允许调用方显式提供既有来源范围，撤权前后通过页面实际使用的projection.report-read/artifact读取同一正式导出工件，并传入reportSourceVersionRefs；其它读保持原默认。C31直接读的500另留未解决证据，不冒称该问题已修复。成员修订helper使用产品已有“管理动作确认”组及“确认执行”，以确认组关闭及目录状态确认成功，不再等不存在的对话框和确认标记；只有真实执行removed成功后才登记需恢复，恢复成功清除。复用原真实撤权场景，仍核对200→404/NOT_FOUND、页面不泄露工件及原成员恢复，不改产品授权。范围仅client.spec.ts。

## Migration Plan

1. 固定并核对前置实现和本规划基线；正式模块/主规格按前置 change 归档同步顺序消费。
2. 完成 IP-17 的来源和环境、IP-18 Electron 场景；依赖合格转换后运行 IP-19–IP-21。
3. IP-22 完成报告、门禁、检查点、Finalizer 和一次必要限定审计；最后才归档。
4. C38 消费 F-01–F-05 和两个 change 的真实证据，按最终制品重新取证。

## Open Questions

公开失败通知缺口已按D-105及用户批准闭合设计；实施及实机证据尚待完成。实际环境、秘密、资料资格和人工批准仍是执行输入；缺项记录BLOCKED，不填默认值。
