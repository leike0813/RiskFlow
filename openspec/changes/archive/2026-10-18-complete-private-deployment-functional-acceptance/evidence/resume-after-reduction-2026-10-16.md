# 减负归档后的现场续办

本轮按原隔离工程继续，合成样本待甲方复核。当前环境已恢复；完整业务、桌面及运维验收尚未通过，不创建 verification。

## 环境与原数据

- 减负 change 已归档到 `2026-10-16-reduce-defensive-design-overhead`。代码基线 `f5b0bc63be30f67788664be0e7c757cfc1cc35af`；D-97、D-100–D-104 是该基线上的未提交修正，不能只用 HEAD 表示运行代码。
- 接管时原 PostgreSQL、Qdrant、MinerU 容器运行，API、Worker、HTTPS 与可见 Chrome 均未运行。数据库为 000058，原 38 个完成任务、15 个终态失败任务均保留，没有活动任务；原资料版本 35 项，监测批次、监测快照、标准化风险记录和评估准备均为零。
- 原 11 个受限秘密文件经现有 loader 核验，未复制到报告。保留原账号、职责登录、资料、知识发布、检索代际与失败记录。
- C04 完整消费 2,882 条登记的哈希清单，保存数据库逻辑导出 19,389,615 字节、工件归档 115,983,339 字节，归档与原目录比对通过。副本 `resume-before-000059-20261016-c` 有 4 条运维审计引用；尚未隔离恢复，不计任务 5.3 通过。
- 显式 `initializeDeploymentV1` 仅应用 `000059_knowledge-modeling_reduce-defensive-design-overhead_derived_knowledge_release_origin`；无新账号或职责登录，首次管理员未重建。

## 当前发布

发布 `functional-workspace-20261016-d103-v109`，配置 `physical-20261016-d103-v109`，迁移 000059，purpose 为 `synthetic-acceptance`。D-99 清洗策略显式选择同模型既有 schema-prompt 承载；数值预算、工具、质量及其它策略和图版本保持。

制品 5,793,268 字节，SHA-256 `c3964d69c96cdfb2978445cf5f058063290016821f335dc6ba016793c23df085`，tar 比对通过。生产源码差异摘要为 `748329c3690b63ed17178a01e7a758c6bd2776169ae3cc44e1d83fe509a47217`，身份记录为 `d103-v109-identity.json`。配置、发布、制品及原始回执在原受限实例目录，普通报告不含秘密、Cookie、原响应或思考内容。

原 v108 API/Worker 正常 SIGTERM、退出 0 后启动 v109；HTTPS 沿原受信证书，未关闭证书检查。在物理显示器 `:0` 的原 Chrome profile 真实登录成功。此前工程总览复读的七个正式查询为 HTTP 200 / succeeded；首次切换时短暂显示失败，复读未再现，未据此修改生产 UI。原会话辅助脚本修正密码读取时的 trim，按受限文件准确字节登录。

## D-97 实际缺陷与验证

旧 v103 清洗诊断在模型前因 `ARTIFACT_ACCESS_DENIED / registry.authorization` 失败。冻结清单保存真实资料授权限制而没有逐段 evidence，原宿主构造空来源授权，错误拒绝有权读取。

修正由 C06 在所属登记中解析稳定 grant 身份，再执行原当前权限及任务冻结范围检查；工件读取只请求目标清单的来源，写入及模型保留输入限制。无 HTTP 字段、角色、依赖或迁移变化。

已有测试先红后绿：无 evidence 的 put/open 两项原失败；C06 对应合法来源映射原得到空授权。修后 C06 25 项及完整宿主 81 项通过，包含未知/跨工程 grant、撤权及任务范围外拒绝；相关 C04、清洗及组合三套 65 项通过。

工程检查：

- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`：通过。
- 变更五个代码/测试文件 ESLint、变更文件 Prettier、`git diff --check`：通过。
- `pnpm deps:check`：696 模块、2352 依赖，无违规；`pnpm deps:policy`：通过。
- 本 change strict 及全仓 strict：通过，后者 44/44。模型 delta 补回主规格已有的三个遗漏场景，没有改变原行为。
- 续办前环境两套 106 项、来源及评分依据四套 79 项、备份/恢复两套 17 项通过；与后续测试有重叠，不累加为全仓结果。
- 先前不带 8 GiB 的局部 tsc 发生内存不足；后续按规定的 8 GiB 重建及类型检查通过。

日志索引：`/tmp/riskflow-acceptance-resume-20261016-*`、`/tmp/riskflow-d97-*`；运行与诊断日志位于受限实例 `logs/*resume-v104*`。本轮未重跑全仓 verify、完整 Electron/Chrome 场景或真实恢复，未提交、归档或宣称完整功能 PASS。

## D-96 / D-98 历史承载诊断

v104原清单读取成功。诊断脚本曾把当前store与旧策略绑定，产生网络前的model-input-binding拒绝；仅修正诊断脚本，不改旧任务或生产策略。

其后唯一真实模型调用使用原MiniMax部署及原预算，输入2612、输出134 tokens。原响应为`model-diagnostic-cleaning-bound-source-350d026b-508c-46d7-8d83-36da55e772ea-model-raw-response@sha256:54ee2f79a9bc535540d33992ad432407fadb84ff494ad4f7f8e8ac013da06386`。网关返回MODEL_STRUCTURE_INVALID/chat.choice，未启动正式清洗任务或执行工具。

经当前C06/C04只读消费该响应：模型身份一致、一个choice、index=0、finish_reason=tool_calls、content为空；存在三个emit_result函数调用，每项arguments为67字节。单结果契约被违反，原拒绝正确，不丢弃多余结果或默认重试。诊断回执`d91-monitoring-inputs/cleaning-function-diagnostic-resume-v104.json`、只读元数据`carrier-metadata-resume-v104.json`保存在受限实例，模型原文未进入普通报告。旧任务账本与终态保持。

D-98 强化串行行动提示后的一次诊断仍返回多次调用（2657 输入 / 135 输出 tokens），未发布该提示或改变生产 runtime。官方对应端点未声明并行关闭或强制具名工具选择参数，不发送猜测参数。

## D-99 正式清洗与 D-100 准备收口

D-99 在新策略中显式选择同一 MiniMax-M3.1-Flash-Preview / low 的既有 schema-prompt 承载。一次诊断通过后，正式任务 `agent-task:synthetic-station-tunnel-project:data-cleaning-task-64657322369a5cb97546e4fe7c42ffe70f8f8b13@1` completed：7 次模型、6 次工具，输入 27063 / 输出 532 tokens，修正与瞬态重试均 0，活动墙钟 14217 ms。三份 D-91 CSV 均留存，真实 Chrome 任务详情已留证；未复活旧终态。

结果工件 `data-cleaning-result-64657322369a5cb97546e4fe7c42ffe70f8f8b13@sha256:8c4bf79bee11ccf8d752ace9f15419b8445d51061ac071110cad4077fd378606`。正式详情、预算和截图在 `d91-monitoring-inputs/cleaning-v105/`。

首次完成准备 HTTP 404 的实际原因为 store 将合法当前授权增量与入口授权整对象比较。任务、清单、结果及策略绑定只读核对均通过；内置 debugger 定位 `#verify`。D-100 仅删除完整快照全等门禁，保留 C06 当前权限、redacted 拒绝、全部输入资格、事务和幂等。原完成用例先红，C15 store 35/35、宿主 81/81、8 GiB build/typecheck、lint/format、change strict 与 diff 检查通过。

v106 重放旧完成命令时，旧命令授权上下文已到期，返回 401；当前登录有效，重新登录不会更新旧命令上下文。保留原失败，以新确认命令 `physical-complete-monitoring-cleaning-d100-v106` 消费同一个已完成任务，HTTP 200 / succeeded。立即重放返回相同 `identification-preparation-64657322369a5cb97546e4fe7c42ffe70f8f8b13@1`。只读数据库核对恰一个快照、一个 `inputs-ready-64657322369a5cb97546e4fe7c42ffe70f8f8b13` 事件；事件 published、投递 1 次、无错误。再次正式查询确认任务预算、账本版本和结果均未变化，无额外模型或工具调用。

监测批次/快照已正式完成并在物理Chrome显示，见[监测证据](monitoring-longitudinal-2026-10-16.md)。完整识别评估链、Electron、恢复与最终报告尚未完成，任务仍 6/19。以上局部成功不作为完整功能验收 PASS。

## D-101 旧知识发布补登记与识别接续

v106新父运行9f35e1be01be5a42204a643d0c56cd8a及其识别子运行在I3终态失败，I0–I2保留；尚无新审阅Agent。诊断在模型、工件写入和领域事务前设置屏障，定位readVisibleEntries将混合检索授权直接传给旧包的identification-basis读取。仅补所属读取授权签发，当前来源可见性仍用原检索授权，未放宽权限。

已有C17用例以隔离数据库模拟旧发布空投影，合法补登记先红（AUTHORIZATION_DENIED）；修后完整C17 25/25、核心检索/组合/宿主三套204/204通过。8GiB build、其后串行typecheck、lint/format、change strict与diff通过；日志为/tmp/riskflow-d101-*。未新增测试文件或依赖。

v107经同一当前主体/工程读取原活动代际68cf5d5e0bd11710dc03a70822675ef34b4ac99a87a7564eb01801de24f79b6e的三份精确成员发布，正式补登记并复读15条批准条目（6机理、3标准、6案例），引用与正文稳定，无模型或任务创建。证据business-chain-v106/visible-entries-backfill-v107.json。原代际、发布及质量阈值未改变。

其后新独立批次physical-functional-20261016-v107使用原五资料准备、25项当前授权来源及原评估上下文。五个retrieval-review任务均completed，各1次模型、0工具/修正/瞬态重试；五个I5校验集均已正式登记、failedWorkItemRefs为空，I6合并和I7路由亦已提交。父运行4a18491ac53a16a3dd298e54208e28fb与子a3102fe289720b90860ad51c198554c9d58677b9377d20490f67b98519a5f63b在I8终态失败，尚无标准化风险记录、评估或预警。日志logs/bounded-driver-v107.log、逐次driver-v107-*及read-v107-after-driver.log保留。

I8所有路线待人工复核，现有图仍将空decisionRefs提交要求至少一项决定的accept-groups，原Schema正确拒绝UNSUPPORTED_CONTRACT。驱动按第一次错误退出，无重复请求或新批次。D-102按已记录设计/IP修复空决定时的等待路径，保留原人工门槛、公开Schema和旧终态；先用生产Schema约束现有测试替身复现，再修唯一调用接缝。

D-102全待定回归先红（terminal-failure而非waiting），修后图runtime、nested-boundary与核心候选收口三套121/121通过；8GiB build、其后typecheck、lint/format、change strict和diff通过，日志/tmp/riskflow-d102-*。v108于14:45 UTC启动独立关联批次physical-functional-20261016-v108，仍用原五资料准备与原策略/预算；父76a2cdee1f2f04f4dc789d8c10369e28已进入准备绑定，后续进度只认business-chain-v108原始回执，不恢复v107终态。

v108首个检索审阅completed，但I5一个候选的candidate.mechanism-applicability不通过，原预算修正一轮后仍为candidate-mechanism-not-applicable；该工作项正式失败，未生成可入库组。只读原候选集重算结果保存在business-chain-v108/i5-diagnosis-*.json及logs/i5-diagnosis-v108.log，2次模型、13018输入/2318输出tokens、repairRounds=1均保留，不扩预算、不重做首项。父子仍waiting并已创建第二项检索审阅。

首个有界驱动按其“任何工作项失败即停”自检退出，这是验收脚本停止，不是父图终态。完成原因核对后，advance-remaining-items-v108.mjs仅继续同一批次余下四项，并逐步断言原failedWorkItemRefs不变；新失败另行核对，日志logs/bounded-remaining-driver-v108.log。不把该批次报告为全部工作项通过。

第二项亦为candidate-mechanism-not-applicable，原修正一轮后仍失败（2模型、12121输入/1642输出）；单独只读重算见logs/i5-diagnosis-v108-item2.log。保留两项失败后继续同一批次，第三至第五项均通过I5；最终在I6 BUSINESS_BLOCKED，父子终态、三份成功和两份失败均保留，日志logs/bounded-remaining3-driver-v108.log及read-v108-after-final-continue.log。

D-103在工作计划生产投影定位：validatedCandidateSetRefsFor收集所有I5，错误包含带failedCandidateSetRef的诊断占位引用，而运行游标只含三份成功。probe-i6-projection-v108.mjs在无模型/业务推进下复现应3实5，C22原完整性校验正确拒绝merge-input-incomplete。已有adapter精确读取用例混入失败I5后先红；只在该共用接缝按结构化失败字段排除。回归与构建结果待真实完成后追加，不恢复v108终态。

D-103修后adapter与核心C22两套82/82通过，8GiB build/typecheck、lint/format、strict及diff通过；原v108数据只读复验应3实3、精确引用相等、失败2保留，日志logs/i6-projection-v108-green.log。不调用模型、不推进旧业务。v109新制品沿原数据/策略继续；驱动按固定五项已处理计数核对进度，分别记录合格、失败和零结果，不再将候选负例等同于技术失败或完整通过。

## D-104 检索审阅版本绑定诊断与修正

v109第四检索审阅任务以AGENT_VALIDATION_REJECTED/candidate-set-mismatch失败，父图仍waiting。受权C04只读对账证明引用、冻结范围与授权、成员和证据均匹配，唯一差异为模型候选版本2、当前集合版本1；原1次模型（14857输入/1120输出tokens）、失败与预算全部保留。详见business-chain-v109/review-binding-diagnosis.json。

仅在C21可信render输出的既有outputSchema中固定当前集合引用/版本，补搜取loader实际当前值；解释、领域校验、权限和预算不变。probe-review-generation-schema-v109.mjs先红后绿：旧dist缺少绑定，新dist接受当前版本、拒绝错误版本，原任务账本不变。C21 context测试7/7、核心20/20及8GiB build、typecheck、定向lint/format通过，日志/tmp/riskflow-d104-*、/tmp/riskflow-review-binding-test.log及logs/review-generation-schema-v109-{red,green}.log。

2026-10-16 15:17:34 UTC一次原冻结输入、同MiniMax模型诊断生成submit-retrieval-review，通过新Schema，15312输入/1154输出/16466总tokens；rawResponseRef为diagnostic-artifact/model-review-generation-schema-c4de4360-236a-4daa-94e5-989c5f2fbf3e-model-raw-response@sha256:15b63a79bc02e5158d4c520c97460f6d3ed9faa6ae79fa3b36ce87a51705b901。未执行工具、候选或工作流写入，原task budgetLedger完全不变。诊断回执business-chain-v109/review-generation-model-diagnostic-*.json及logs/review-generation-model-v109.log；诊断不计正式任务完成或业务PASS。

随后定向lint/format、change strict与diff通过，冻结functional-workspace-20261016-d104-v110：制品6040858字节，sha256 f7b53aee5e918422f4828e99560505c1bd5495307179fd380af074dc8fffe921，源码差异sha256 8d570b6ac2383876c81912d39ab5480f6ad75832e7f1bc0acc47da8d301cb79a，tar比较通过；模型、预算、策略引用与迁移000059不变。原API/Worker正常SIGTERM退出，新API/Worker运行，HTTPS使用原CA验证返回200。精确身份见d104-v110-identity.json，日志logs/{api,worker}-d104-v110.log。

logs/read-preserved-run-v110.log证明原父仍waiting同一第四项任务，runVersionId cfbf7c9e62c71f89cb18271f475bdd43f93e97ec0daa7c798b825161a619d195，16登记行、无父workflow-error；没有新的业务推进。父Agent与scout交叉定位公开失败通知缺口，见[待批准范围提案](failed-review-resume-scope-proposal.md)。该提案未实施，原失败不复活、不伪造结果、不重开整批；任务仍6/19。

## D-105 已批准的失败通知实施

用户随后明确批准失败通知提案，并持续授权后续同类验收修复。D-105设计、施工图及三份delta已同步；公开agent-task-failed仅携内嵌检索任务精确引用，C30匹配识别等待，C24从C08既有getTask核验真实terminal-failure与任务/工程/主体/父子运行，再沿原I3失败收口。没有生成结果引用、替代任务、上下文或新预算，没有依赖/迁移变化。

公开Schema与父转交新用例旧实现2项先红；完整contracts/父图64/64、nested9/9通过。随后补父入口任务等待匹配，四个完成/失败通知及父技术失败恢复参数化用例4/4通过；build、增量build、typecheck、定向lint/format、change strict及diff通过。C24边界补充及完整runtime回归仍在进行。辅助implementer未返回可运行补丁，多次催收后已关闭，父Agent收回单文件并补齐真实终态/原成功项/幂等及拒绝边界；不把未完成辅助工作计为通过。

IP-17任务1.2列出的policies-readers、assessment-composition及risk-flow-composition三套76/76通过，日志/tmp/riskflow-acceptance-ip17-provenance-regression.log；实际错版/异空间/无权及正式来源取证尚未全部闭合，不勾选该任务。D-105其它日志/tmp/riskflow-d105-*，现场当前仍v110、原父等待，无在途业务命令。

D-105最终C24完整回归46项通过，新用例因撤权后仍用无权读口断言登记而失败；修为先断言恢复拒绝、恢复测试读权后核对零写，单用例1/1通过。失败及最终日志/tmp/riskflow-d105-c24-{regression,final}.log保留。父补充匹配检查四参数用例4/4、增量build/typecheck/lint/format/strict/diff通过，不重复完整已通过用例。

v111制品6040868字节、sha256 aea33a2378f58e7bf8c3252d1630a8df534e5ac71e574d8bbfe50904d366763e，源码差异bb5401f57eb20897c8f4f6c9a9af80da8fe042da1771c0b0f7ac23a74a68f631，tar比较通过。原API/Worker正常SIGTERM stopped/count0，新API/Worker运行、原CA校验HTTPS200，模型/预算/策略/000059保持。

15:47:19 UTC正式HTTP失败通知physical-notify-retrieval-failure-d105-v111返回202，原父等待转第五项，子原成功第二三项及I5引用完全不变；首项I5失败与第四检索失败分别保留，pending仅第五项。证据business-chain-v109/failed-task-d105-v111-{request,response}.json、d105-preserved-work-proof.json。C08只读再核对原第四任务仍terminal-failure/taskVersion4/无resultRef/预算用量不变，preserved-failed-task-v111.json。

第五检索审阅正式completed：1模型、15523输入/1083输出、0工具/修正/重试，活跃7789ms；日志logs/task5-d105-v111.log。15:48:49 UTC原任务5公共继续返回202，父进入review等待，当前版本297c4db229d20530b4fc5e4a8428956b2d8d7991cd5b60c4f81aeb7f30c031cd；子I8等待人工复核，3成功/2失败/0pending工作项，3合格校验集、8待审分组。D-102全组pending不提交空决定及D-103混合失败投影已取得实机路径证据，尚无正式风险记录/评估/预警。受权窄读8组及原候选到business-chain-v109/pending-review-groups-v111.json；人工决定未提交，不能据模型/合并分数批量批准。完整业务及任务仍未完成，当前6/19。

## D-106 复核深链与首条正式风险记录

物理Chrome原任务深链因只在首50项队列定位而误报缺席，business-chain-v109/review-deep-link-red-v111.{json,png}留证；原脚本等确认按钮30秒超时，未提交决定。修改所属task-detail窄读以接受精确任务身份，继续单点工程/实体/版本及当前权限验证，完整输入仍复验目标和等待运行；输出仍为原完整引用。两详情页删除队列反查。新增任务身份SSOT，不改变决定命令、依赖或迁移。

既有core/adapter精确定位用例先红，修后三套55/55、既有浏览器识别分组复核1/1、build/typecheck/lint/format/strict/diff通过，日志/tmp/riskflow-d106-*。一次并发core测试早于新contracts dist生成而失败，最终三套已通过，失败日志保留。v112制品5790138字节、sha256 4e42623a205c42eb9037690efd52a904f6f3547860bb4a290ac6b81298a1d2ba、源码diff3e99880dd2b67a998bf9e6b9e44932bcd9bac404eccb58bee92e701ac0d87b5c，tar比较通过。正常SIGTERM切换、原CA HTTPS200；原深链转绿，physical-review-before-v112.png。冗长内部引用、候选语义未呈现及监测页既有显示问题仍属IP-21，不称完整UI通过。

受权读取原15条知识及8组候选，私有逐组决定计划review-ui-decisions-v112/plan.json记录来源与语义理由，限定为合成验收、待甲方复核。当前只执行第0组确认合并，物理Chrome真实确认HTTP200，reviewDecisionRef review-decision-bcfb96e3-66aa-4b47-927e-f6eeece4a300@1，原请求/回执/截图在同目录decision-0.json、confirm-0.png、decided-0.png。C24自动I8收口，首条standardized-risk-record版本dd80709ca51a8fe8c0f2060010179c1990ce3e037872399a3191bcb91b4415a3，实体按原组5785f6dc…派生，pending组7，原3成功/2失败工作项保留。

## D-107 风险记录事件到父运行的权限证明

复核事件published/1，首risk-record-accepted事件却exhausted/10，错误DEPLOYMENT_EVENT_FAILED；父仍waiting/identification、未纳入风险/未创建评估，不能报告RI/RA链通过。安全事件索引business-chain-v109/review-events-*.json及logs/review-events-v112-worker-session.log；原次数与失败保留，不重置重投。诊断使用已配置outbox worker session role对当前工程有界只读；前两次使用基础app角色没有outbox SELECT，未改权限，失败日志保留。

diagnose-accepted-event-v112.mjs以原不可变事件运行真实授权及父消费证明，但在模型/工作流和consumer效果前设置屏障。原实现WORKFLOW_EVENT_PARENT_UNPROVEN，trace显示同一空间、0资料授权，历史链边全scope摘要却包含原资料授权；原exhausted/10不变。D-107仅修共用workflow adapter及既有测试，删除五处历史全scope全等，保留当前C06、工程/主体/调用、redacted拒绝、精确父子/thread、C04及消费事实；空间按同运行preparing阶段唯一正式业务入口limit2验证。

初次实现误用运行状态entryIdentity定位业务入口，真实只读复验越过原拒绝后ENTRY_UNPROVEN；进一步读取两份原入口元数据证明执行批次参与运行身份，业务冻结输入入口与它不同。改为所属preparing阶段唯一入口，并扩既有测试覆盖该差异；不重写旧入口。单点用例原摘要先红，修后adapter/组合44/44、父图42/42，入口差异补充1/1通过，最终构建/真实屏障复验待完成。尚未部署D-107或提交其余7组决定，完整任务仍6/19。
