# 逐任务验收收口（2026-10-17）

最新进度 **17/19**，当前以[D189/D190批量收口](batch-closeout-d189-d190-2026-10-17.md)及[逐场景索引](scenario-index-2026-10-17.md)为准。下文12/19及10/19保留历史批次状态，原报告不改写。

## D-182/D-183批量补证

恢复索引使用`batch-restored-v166-20261017-clean/deployment-isolated-d182-v169.json`与同发布清单，原代际15成员从正式发布事实重取，经真实Embedding与独立Qdrant19634重建。`generation-rebuild-result-d182-v169-a.json`为REBUILT/completed，运维审计3条。`generation-preservation-v169.json`证明源与恢复库全部消费回执及激活记录一致；原激活ordinal1保持。质量报告`logs/retrieval-quality/487f8aa5-9ff8-4780-8dd1-46b1efa46c0d.json`七门全部通过，dense Recall@5=0.9667、BM25/RRF Recall@5=1、RRF nDCG@5=0.9605、双索引对账15/15、权限泄漏0、Qdrant p95=49.84ms；这是合成样本测量，不作硬件/SLA承诺。D-182 handler/restore回归27项通过。恢复配置数据集路径、审计ID生成器等接线失败均保留，无消费回执删除或重新发布。源仍v166，v169仅恢复执行制品，5.3尚缺人工回退。

只读观察命令：`NODE_EXTRA_CA_CERTS=<实例CA> node scripts/acceptance/functional.mjs --pack references/acceptance/synthetic-v1 --config <实例>/d183-formal-observation/functional-config-b.json --output <实例>/d183-formal-observation/observation-b`。结果PASS/queryCount7，识别子运行、评估及五类任务均按精确引用成功终态与主结果核验；显式`existing-formal-references`来源，不产生启动回执。首轮错误的C33请求kind被正式Schema拒绝，保留observation-a；修为实际runRef请求并同步观察器后通过。

当前正式查询结果`query-identification/baseline/actual/warning/recommendation/forecast/forecast-parent/execution/feedback/calibration.json`均200/succeeded，`query-reference-index.json`含10查询、99版本引用、RI/RA映射。核实10识别阶段、5工作项、6接受/2拒绝/0待定；识别/基线/实际评估/预警同风险，处置3项校验和人工采纳，预测父子精确关联、执行反馈/偏差/校准引用闭合，预测2/实际6.8/偏差4.8及校准approved-for-draft保持。旧取证脚本把预测子引用与父引用判等、并读取不存在的execution.source.responseRecommendationRef，现按C34父assessmentRunRefs及正式source.recommendationRef检查；不再允许undefined等于undefined冒充关联通过。第一次共享页查询中途发生导航导致Failed to fetch，已保存前3份；独立可见Chrome页读取余6份和正式parent窄读完成，无业务写。

synthetic/functional回归69项通过（`/tmp/riskflow-d183-regression-final2.log`），包括既有只读不发命令、等待/缺引用/拒权非PASS，原异运行/超时/不支持DTO，以及混入辅助路径整组拒绝。相关lint/格式和change strict通过；完整browser另在运行，不计整体门禁已过。秘密、Cookie、正文及原trace仍只在受限实例。4.1/4.2完成不代表桌面在途、实际回退或最终verification完成。

合成样本，待甲方复核。当前 **10/19**；本轮关闭 1.2、3.1、3.2、8.1，保持原任务标准。1.2、3.1、3.2在[v163](resume-v163-2026-10-17.md)核对，D-177代码修复已部署v164并通过物理Chrome原命令复验。HEAD仍`e2dfe433a54d042d09d2ea2e31dc6c3e5c0adc43`，D-177源码/测试为未提交增量；模型、策略和历史失败未改动。

最新运行v166，包含D-178当前授权与完整历史、D-179清单统一排序修复；D-180只纠正浏览器测试。三项均已完成相关回归，尚未新增完整任务勾选。下文v163/v164为各阶段证据，最新缺项以本轮批量验收段为准。

此前长期显示 6/19，既有完整场景尚未闭合的原因，也有证据未及时按任务整理的问题。本轮将正式来源读取和资料预置独立收口；不再让它们等待 Electron 或整条业务报告。不同升级轮次的不可变事实按精确引用复用，当前读取另行核验。

受限实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。下列实例路径均相对此根。秘密、会话、资料正文和 trace 不复制到仓库。

## 1.2：正式来源与拒绝，完成

指定命令 `pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs`：3 套件、94 项通过，日志 `/tmp/riskflow-closeout-17-readers.log`。

当前 v163 的 `closeout-20261017/source-v2/source-report.json` 八项全部 PASS：正式 C19 成员、错版 C19 拒绝、正式 C24 八组路线、错版路线拒绝、正式 C30 风险/运行/空间配对、异空间拒绝、错风险版本拒绝，以及新探针会话注销后 `SESSION_REVOKED`。探针只注销自己的新会话，未改成员或浏览器会话。

C19 正式依据 `assessment-basis-473fe988815fe22ed886f16a110f4791cea5078d6b9aff23f78d487891e22c31@1` 绑定一项评分发布和八类配置，派生成员为 `derived-release:b6631ade0afb7391e0a7f88f1a812e9cc90b866d1ea9181fc7d35d0c1f21e7a2@1`，评分发布 `knowledge-release-b33aa6a1-7f83-4c88-bdf5-38710647b673@1`。C24/C30 复用 `business-chain-v109` 原正式识别：6 条风险、2 项拒绝、0 项待定。

探针首次误将领域异常按返回值处理，失败记录保留于 `closeout-20261017/partial-source-report.json`；修正临时探针判定后八项通过。未修改产品行为。该证据只关闭来源通路，不代表 8.1 公共组装入口通过。

## 3.1：正式资料、配置与检索，完成

`pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1` 返回 `ok:true, problems:[]`，日志 `/tmp/riskflow-closeout-17-pack.log`。

三份标准原件均有真实正式预置报告，而非临时转换响应：`standard-originals-v38/STD-001/`、`standard-originals-v38/STD-003/`、`standard-originals-v39/STD-002/` 下的 `register-report.json`、`convert-report.json` 共六份。逐份以原 `ProvisionConfigV1Schema` 解析配置并核对 `inputDigest`、`runId` 和完成步骤，全部一致且 `COMPLETED`；各 `qualified-conversion.json` 均 `QUALIFIED`。安全索引见 `closeout-20261017/provision-evidence-index.json`。本轮没有重复登记或转换来制造新报告。原件和 MinerU V2 资格见 [原件登记](standard-originals-ingestion-2026-10-15.md)、[正式转换](mineru-standard-conversion-v38-2026-10-15.md)。

人工审核发布、检索质量证据沿 [相关性复核](retrieval-relevance-review-2026-10-15.md) 及 handoff 的 D-68。后续正式组合 `knowledge-release-8403fe1e-ee6b-423f-bdce-6ee2f6ab04d8@1`、机理 `knowledge-release-66c09941-91f9-4c20-80cc-dabd8d8a08fd@1` 与工序 `knowledge-release-f3bda4af-736b-4efd-8c10-b78638480dd5@1` 有正式审核发布回执；对应质量报告 `logs/retrieval-quality/babb6946-0dec-4094-ad66-bbaa5097e48a.json` 七门全部通过。当前来源、现场和评分依据可由本轮 1.2 的 C19/C24/C30 正式读取配对，不用完整 3.2 替代本项判断。

本轮当前代际只读核验保存于 `closeout-20261017/retrieval-current-v163.json`：代际版本 `sha256:68cf5d5e0bd11710dc03a70822675ef34b4ac99a87a7564eb01801de24f79b6e` 仍 `active`，激活序号 1，策略 `physical-hybrid-retrieval-policy@physical-20261016-d68-v3`，来源摘要 `e60deea8cee9ffc961e609791cb1b6a87edde9b74d41ba8b7d7838d50682a70c` 与原 15 成员、25 来源报告一致。未重建、重新激活或调用模型。小型合成开发集通过不代表真实工程准确率。

## 3.2：正式业务事实、五类任务与会话流，完成

本轮进一步通过当前v163的正式HTTP查询读取五类Agent原任务，均为completed，完整任务引用与resultRef.agentTaskRef一致，预算无剩余预留。`closeout-20261017/five-task-current-report.json`及各`five-*-current.json`保存原回执；这里只列实际token和调用计数：

| 类型 | 输入token | 输出token | 模型次数 | 工具次数 | 纠错次数 |
| --- | --- | --- | --- | --- | --- |
| 清洗 | 27063 | 532 | 7 | 6 | 0 |
| 检索审阅 | 15523 | 1083 | 1 | 0 | 0 |
| 处置建议 | 2930 | 26 | 1 | 0 | 0 |
| 校准建议 | 5922 | 1209 | 1 | 0 | 0 |
| 知识编制 | 78442 | 9725 | 5 | 3 | 1 |

评估记录、建议、预测、执行、反馈与校准六个正式读面均200/succeeded，证据`chain-*-current.json`。建议三项校验通过且已人工采纳；预测2mm、实际6.8mm、偏差4.8mm；校准approved-for-draft并引用原未发布治理修订。基准评估另于`chain-baseline-assessment-linked.json`读回，与实际评估引用同一正式风险。当前读取没有发起业务写命令或新模型调用。

识别探针首次多带kind字段400，修正后原启动引用404；沿原可见证据的精确状态版本及25来源范围再读仍404，保留`chain-identification-exact-snapshot.json`。建议所关联任务的旧第1版详情422/BUSINESS_BLOCKED；沿正式resolve取得当前第5版后，`chain-warning-task-current-version.json`为200/succeeded，风险及预警/建议/执行/反馈/校准关系可读。422属于旧版本探针，不判为产品缺陷，原`chain-warning-task-linked.json`保留；汇总`business-closeout-summary.json`是当时探针结果，保持overallFunctionalPass=false。

观察工具既有回归本轮2套件63项通过，日志`closeout-20261017/checks/functional-tools.log`；完整观察配置尚未完成，因此4.1仍未勾选。

识别详情进一步定位：`identification-meta-current.json`证明同一原25来源当前授权及复验摘要均为`e60deea8…`，最终状态登记的摘要为`fe21267d…`；`identification-meta-with-source.json`核对该状态登记授权确为空来源。对同一精确状态使用空来源请求，`chain-identification-empty-scope.json`返回200/completed、6接受/2拒绝/0待定，但plannedWorkItemCount=0、workItemCoverage为空、stageEntries仅2项。当前reader按历史完整摘要相等拼接阶段，故完整范围请求拒绝、空范围请求丢失其它范围的历史阶段。该对照证明现有正式终态，并暴露完整观察缺陷；不能用空范围200把4.1/4.2判通过。此处未修改reader或历史数据。

最终逐边核对保存为`business-chain-linkage-current.json`，scope为formal-business-facts-and-five-task-results、status=PASS：同一识别风险在基准/实际评估及预警任务中一致；建议三项校验通过并人工采纳；预测所属子运行由正式父运行详情精确列出，父completed；执行绑定同一建议及预测入口决定，反馈绑定执行和实际评估，校准绑定反馈所列建议及偏差第2版，状态approved-for-draft。辅助探针曾将人工决定与工作流入口决定、父运行与子运行当成同一引用，按所属公开DTO纠正后逐边核对通过，没有改业务对象。

原C05正式宿主会话流见[会话流证据](model-stream-and-functional-2026-10-17.md)：6增量、224输入/36输出、真实C06与C04完整读取；网络adapter smoke见实例`network-model-smoke-v159.json`及当轮日志，真实聊天/embedding/会话均PASS且与当前精确模型版本一致，不能替代以上业务事实。知识编制及人工发布见[知识编制证据](knowledge-authoring-2026-10-17.md)和`d152-knowledge-authoring/normal-release-and-old-failures-proof-v157.json`；正式新修订/发布及七旧失败保持有据。预算耗尽、错误、拒权与人工决定沿各轮原回执及本轮1.2保留。

3.2按已执行的正式业务与结果收口；当前C33历史阶段拼装缺陷归4.1/4.2，完整观察和RI/RA报告继续未通过。原失败父图终态不重开，不把上述各阶段事实说成原失败父图成功。

## 其余任务与具体缺项

| 任务 | 当前证据或结果 | 关闭前缺项 |
| --- | --- | --- |
| 1.1、2.1、7.1–7.4 | 已完成，原任务证据保留 | 无新增缺项 |
| 2.2 | 原Electron 13项为12过/1失败；本轮原识别运行22事件的真实Electron独立SSE通过 | 活动任务关窗后继续；当前发布绑定的完整14项实跑；TLS19444需恢复真实不可信HTTPS |
| 3.2 | 已完成，正式业务引用链及五类任务终态/预算核对通过 | 无新增业务事实缺项；完整观察缺陷归4.1/4.2 |
| 4.1 | 评估所属详情观察已有；D-178已修复C33完整历史，12实机读探针通过 | 完整业务观察配置及正式查询引用索引；证明启动身份与精确状态快照关联 |
| 4.2 | 部分评估 functional PASS | 完整正式终态报告、RI/RA 双向追踪及安全检查 |
| 5.1 | 本轮browser原86过/3失败/1 flaky，D-180纠正权限旧断言后Web/demo6/6；v166可见Chrome正式人工风险记录成功 | 当前完整场景的可见确认、拒权、跨页追溯及桌面对齐；最终完整browser通过 |
| 5.2 | 工程回归及正常重启已有；v166准备等待取消后原启动重放/重复取消均无新增业务或图事实 | 事实提交后回执失败重投、同发布在途重启及原身份续接的完整隔离实证；当前取消仅覆盖准备等待边界 |
| 5.3 | 实际停写、副本B/C完成；授权后三个孤儿仅在新clean副本清理，4259项恢复核验及业务回读通过，原根/备份/失败根保留 | 双索引重建和人工兼容/不兼容回退实证；迁移兼容门已有实际正负例，未代替切换 |
| 6.1–6.3 | 未完成 | 全场景证据索引、最终门禁、授权检查点和最终核验；此时不创建 verification |
| 8.1 | 已完成，D-177已部署v164，物理Chrome原命令及负例通过，正式引用及领域数量保持 | 首次跨调用并发创建的既有间隙未在本轮额外验证 |

8.1 原命令 `closeout-20261017-c19-assembly` 的请求、首响应和诊断分别为 `closeout-20261017/assembly-request.json`、`assembly-first.json`、`assembly-debug.json`。原失败得到 `TERMINAL_FAILURE`，内部异常为 `IDEMPOTENCY_CONFLICT` → `ARTIFACT_IDEMPOTENCY_CONFLICT`，触发 C04 命令载荷摘要检查。进一步调试保存于 `assembly-payload-comparison-restricted.json`：新旧工件正文均为 5066 字节、摘要 `1763bec480045d79abcf13cd630124cbaaa7e85eacb065752e7cf5d5090fc726`；仅将当前载荷的 issuedAt 从 `2026-10-17T08:53:06.137Z` 换为旧值 `2026-10-17T02:22:05.618Z`，规范摘要即与旧回执精确一致。根因是已有相同结果仍进入固定键的再次写入；原失败、请求与C04回执保持。

## 8.1：C19原命令修复与正式复验，完成

D-177仅修改原scoring-rules adapter及其既有测试。当前权限、C11准备、C18配置、父规则与冲突检查和确定性计算后，沿C16所属正式解析匹配期望工件精确引用与C19元数据，复用原release/revision/artifact；其余查询错误原样传播。未修改C04、HTTP、模型、依赖、迁移或事务。

原单项筛选因缺前序fixture失败，不计产品红态；整文件真实红态30过/1失败，修后31/31通过。部署assessment/risk-flow两套63项、8GiB `pnpm build`、定向ESLint/格式、change strict及diff检查通过。原日志在`closeout-20261017/checks/`，辅助实现完成全部apply contextFiles读取，最终代码与实机判断由主Agent负责。

新发布`functional-workspace-20261017-d177-v164`，配置`deployment-d177-v164.json`、清单`release-d177-v164.json`。制品5,803,006字节、SHA-256 `eebc14f2d37bc20b53c62565c9e5a0443a8d042c6a9b915339640176ec20c83c`，源码/测试diff摘要`9dbc63c6951d08f5234f61656ccefaabb5782efa0906a54283e63774df8d7aa8`，tar比较及正式预检通过。原v163 API/Worker均SIGTERM后stopped/count0；v164 API PID2666728、Worker PID2666729运行，原Caddy/CA、数据库、C04、migration000059、模型/策略/图及现场绑定保持，原CA验证HTTPS登录200。身份见`d177-v164-identity.json`。

物理显示器`:0`的Chrome155.0.8059.39通过正式会话重放原失败命令，200/succeeded，四引用均保持：原派生修订/发布`b6631ade…@1`、原工件`applicable-rule-set-8c3d7bb7…@sha256:1763bec…`、原依据`assessment-basis-473fe988…@1`。原命令再重放结果一致；同键异载荷409/IDEMPOTENCY_CONFLICT、错配置422/BUSINESS_BLOCKED、错准备404/NOT_FOUND、无会话401。错准备首探针错误预期422，公开入口实际按不存在隐藏返回404；保留该失败，只纠正探针，未修改产品拒绝行为。

`closeout-20261017/assembly-v164/`保存原命令回执、重放、全部负例、可见截图和`report.json`。`assembly-domain-counts-before.json`与该目录`domain-counts-after.json`核对：适用规则集修订12、发布12、目标工件版本1，前后相同。原人工审核的评分内容未变；C19通过自动派生复用返回正式发布及评估依据，不重复写入、审核或发布。首次并发创建跨调用的既有间隙未额外验证，本轮未改其事务边界。

## 本轮批量验收：D-178至D-180

当前`functional-workspace-20261017-d179-v166`，API/Worker/Caddy为3036503/3036504/3036505。制品6,052,930字节，SHA256 `b0b18cfcb30db76d58db99b02679f5a9b820c4b650b4ea1d37ff93abd6dda470`，migration000059。配置、清单、冻结身份分别为`deployment-d179-v166.json`、`release-d179-v166.json`、`d179-v166-identity.json`；冻结源码/测试diff为`84d3a4c7942c3f7501837584d4b8a75cafe21814cfe8e3607ead0e2173252ce0`，之后只有D-180测试继续变化，不能声称当前全量diff仍相同。原模型/预算/策略/图/现场/CA保持，v164/v165 API/Worker均正常SIGTERM并stopped/count0。

| 批次 | 已验证行为 | 证据 |
| --- | --- | --- |
| D-178 / DD-01 | C33四读面按当前资源权限，精确状态及完整历史；先红后绿13项，真实C06来源/证据来源撤权、错版/异空间、分页/快照边界 | `batch-recheck-v165/summary.json`、`negative-and-replay-report.json`；空/25/35来源12探针均200且结果相等，I0–I9共10阶段、5工作项、6接受/2拒绝/0待定 |
| 可见Chrome | 原识别运行详情及正式review-decision风险记录可见，零业务写；旧失败保留 | `batch-recheck-v165/visible-identification-report.json`、`visible-manual-record-v166.json`及对应截图；后者正常重试1次成功，未认定首次TRANSIENT_FAILURE根因 |
| 真实Electron SSE | 原识别运行22事件，首读2条、同游标重连再读2条，无重放、HTTPS200/event-stream、零写 | `batch-discovery-v164/run-event-inventory.json`、`electron-sse-v164.json`及截图；独立场景不等于全14项通过 |
| D-179 / DD-11 | locale排序引发17处恢复冲突；两个清单迭代器及恢复器统一UTF-8排序，先红后绿47项，含万条/非BMP/分页 | `batch-discovery-v164/restore-manifest-order-diagnosis.json`；副本C已无排序冲突，恢复仍因孤儿失败 |
| D-180 | 原完整browser86过/3失败/1 flaky，三失败为operator读取受限B的过时断言；保留权限与夹具，纠正Web/demo后6/6无重试 | 原`browser-full-traces/`和`browser-d180-final-traces/`位于`batch-discovery-v164/`；UI目录隐藏B，独立正式HTTP精确读404，不等待不存在的页面详情请求 |
| 统一工程回归 | 8GiB完整build/typecheck、部署413项、关联151项、依赖边界/策略通过；D-179之后adapters增量编译通过 | `batch-discovery-v164/checks/`保存原日志；原修前9文件204项全绿仅说明覆盖缺口，不能当修后证据 |

本轮不再为每个失败重跑完整90项；保留原全套结果，按影响补13、47、6项回归。尚未得到当前最终单次全套browser通过，也未运行完整`pnpm verify`。

### 维护、副本和恢复的实际结果

首副本权限失败：旧调用方枚举53来源，含未获资格资料；改按C04实际49个grant经当前C06解析，49/49且redacted=false，未扩权。失败操作通过正式CAS结算failed/revision2，3条审计，见`batch-discovery-v164/failed-backup-settlement.json`。

副本B `batch-maintenance-v164-20261017-b/`为4258项、dump24,882,586字节、archive119,264,597字节；新根`batch-restored-v164-20261017/`、新库`riskflow_acceptance_restore_20261017_v164`保留17处排序失败。修后副本C `batch-maintenance-v165-20261017-c/`为4259项，包含旧B清单，dump25,123,280字节（SHA256 `4a69a69717052c48b16aa0ec65aedc5bc3361f0e6de07ae889e917f8fd10ff9a`）、archive119,722,917字节（`165eaef65929850f47f31984c115ec76e2aa3324d1cd73a960c5175171b514aa`）；`pg_restore --single-transaction --exit-on-error`、解压及tar compare已完成，新根`batch-restored-v166-20261017/`、新库`riskflow_acceptance_restore_20261017_v166`保留。

恢复器与C04 summary字段不同，临时取证调用方补显式结果适配后，正式核验报`RESTORE_RECONCILE_FAILED`：3个超过24小时宽限期的真实孤儿；第一次核验已登记的新诊断又导致同根第二次核验的manifest-conflict。不能反复复验同根、补旧清单或删除诊断来取得PASS。新根恢复不等于恢复核验成功。

源只读预检与失败新根的正式dry-run证明：4孤儿、其中3个过期、全库登记引用0，待清理合计65,449字节；非过期1个保留。完整摘要、年龄、字节数及正式零删除/隔离/暂存清理回执见`batch-discovery-v164/orphan-maintenance-dryrun-v166.json`。首次dry-run后的临时自检漏二级哈希目录而失败，保留日志；纠正脚本自检后复跑通过，产品未改、对象未删。正式端口非dry-run会永久删除，清理需明确授权，限定备份C新建恢复副本并保留源/备份/旧失败根。双索引及人工回退尚未实跑，5.3不勾选。

C38 的签名、多平台、跨 VM、禁网和硬件移交保持原范围。当前没有整体功能 PASS，也没有提交或归档。

## 后续批量补证：D-181与恢复准备

D-181修复`ArtifactMaintenance.#sweepLocked`对隔离恢复的无条件调用；dry-run原来也可能还原或删除旧隔离对象。扩原四处真实SIGKILL恢复用例，在正式恢复前证明隔离字节不变、原objects路径仍不存在、删除/隔离/暂存清理数均0。原实现真实红态1失败；一行条件修复后C04/backup/restore47项通过（`/tmp/riskflow-d181-green.log`，66.29s），adapters无输出类型检查、ESLint和Prettier通过。首次tsc误用`--incremental false`被composite配置拒绝，修正为`--noEmit --tsBuildInfoFile /tmp/riskflow-d181-typecheck.tsbuildinfo`通过，不是产品类型错误。源码尚未构建或部署，v166仍运行D-179制品；本轮不逐修复重启。此修复不等于已获孤儿删除授权。

补充84份日志/脚本及当前源码diff身份保存在`batch-discovery-v164/after-d181/archive-and-source-identity.json`。最终全包tar比较仅有adapters的tsconfig.tsbuildinfo时间/长度变化；排除此编译元数据后运行产物一致。不还原该生成文件，不把全包比较标为通过，也不把D-181源码当成v166已生效。

v166真实Electron独立SSE复验仍通过，2+2事件、无重放、两次HTTPS200/event-stream、零业务写，`batch-discovery-v164/electron-sse-v166.json`。当前`desktop-build-v166.json`已准备，但全14项所需同次在途回执及functional报告仍缺；只读`batch-readiness-v166.json`记录当时无queued/running Agent，不拿completed运行冒充。

原副本C再次恢复到全新`batch-restored-v166-20261017-clean/`及库`riskflow_acceptance_restore_20261017_v166_clean`，完整哈希与tar compare通过，原根/副本/失败根均保留；只准备维护计划，未清理或复验原冻结清单。`prepared-maintenance-plan.json`固定三摘要及65,449字节，删除数0。

`batch-discovery-v164/restored-compatibility-v166.json`通过实际恢复库调用原`assertCompatibleMigrationVersion`：真实旧v164要求000059并相容，真实旧v5要求000058而当前000059，按`DEPLOYMENT_INITIALIZATION_COMPATIBILITY_FAILED`拒绝。没有启动旧发布、切换或回退，不把迁移门实证当成5.3完成。首次临时探针用业务连接读取consumer_receipts被42501拒绝，保留日志，随后复用运维只读查询；恢复库有12 completed/3 pending投影回执，未改权限、消费记录或事件。

仓库调用图确认`restore.mjs`的`rebuildIndexesV1`、`activateTargetV1`、`planRollbackV1`只有测试调用方，OPERATIONS仅描述步骤；正常投影handler对已completed事件复用原结果，不等于恢复Qdrant/BM25。新恢复目标的独立索引与正式事实重建/质量门接线仍缺，不能共用旧collection、删除消费回执、伪造新事件或重复审核冒充完成。临时descriptor与部署Schema属于不同层，字段不同本身未认定为产品缺陷。待删除的精确三个文件授权不包括消费回执或发布事实。

### v166取消边界实证

`batch-cancellation-v166/`保存新独立批次`physical-batch-cancel-v166-20261017`原请求、202知识准备等待、当前精确状态、200取消和正式cancelled读回。没有绑定准备或发起新模型任务。取消后原启动信封两次重放均422/BUSINESS_BLOCKED，原取消信封重放200/already-cancelled；workflow/identification图行、标准风险记录、Agent数量及全部任务状态/预算摘要均不变，最终取消状态版本保持，`report.json`为该边界PASS、`fullTask52Passed:false`。

首临时探针错误期待HTTP直接返回领域CANCELLED，实际公开HTTP按契约映射BUSINESS_BLOCKED；原失败保留，仅纠正探针后沿原取消运行补证，未新开运行或改产品映射。该证据覆盖知识准备等待后的取消与重放，不代替模型在途取消、事实提交后丢回执及同发布在途重启续接。原业务父运行另经当前C34实读仍terminal-failure，见`batch-discovery-v164/identification-parent-owner-read-v166.json`；原失败不复活。

## 授权后三对象维护与新根恢复核验，已通过

用户在精确三对象、65,449字节、新clean副本及保留原根的确认请求后明确回复“授权”。授权范围只包括该三文件，不包括消费回执、事件、发布事实、旧失败根或原实例。

执行前再次核对全库登记引用、宽限期、候选摘要、空staging/quarantine及精确集合。临时脚本原本把绝对计划路径再次拼上实例根，执行前经审阅修正为直接读取绝对路径；未因此发起清理或产生失败维护。正式`ArtifactMaintenance.sweepOrphans(dryRun:false)`于新根`batch-restored-v166-20261017-clean/`、新库`riskflow_acceptance_restore_20261017_v166_clean`执行，`authorized-sweep-result.json`记录发现3、隔离3、删除3、暂存清理0、retained0和正式审计引用。

随后`verifyIsolatedRestoreV1`完整消费原冻结清单4259项，C04 summary的complete=4259，其余missingObject/contentMismatch/manifestConflict/orphanObject/staleStaging/quarantinedObject均0、passed=true。`restore-report.json`记录恢复后的正式C33读取completed、I0–I9共10阶段、5工作项、6接受/2拒绝/0待定；没有重新运行业务或模型。

`post-clean-preservation-and-audit.json`再次核对：原实例和两个失败恢复根中三个对象原字节及摘要保持，副本C仍在；新clean根仅该三个对象缺席、未过期孤儿9,924字节保持。实际数据库中1条非dry-run维护批次的candidateHashes与授权集合精确相同，批次审计、维护完成审计和恢复核验审计共3条存在。源API/Worker/Caddy的原PID及配置身份不变，未重启或切换。

受限证据均在新clean根：`deletion-authorization.json`、`authorized-sweep-result.json`、`restore-report.json`、`risk-run-read.json`及`post-clean-preservation-and-audit.json`。授权前计划、B/C副本和旧失败均保持，不改旧清单，不删除诊断。5.3的维护/副本/新根恢复分项通过；正式双索引重建、人工兼容/不兼容回退及该任务对4.2的依赖仍未闭合，因此总体保持10/19，不把恢复分项PASS写成完整5.3或整体功能PASS。D-181仍仅源码修复，未构建部署。
