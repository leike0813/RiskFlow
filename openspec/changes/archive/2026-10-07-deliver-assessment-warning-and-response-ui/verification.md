# Verification

## 验收对象

- Change：`deliver-assessment-warning-and-response-ui`
- 核验日期：2026-10-07
- 输入实现 HEAD：`c54e3dc995e2500c2408cfd7450a571819b1750b`
- 最终验收 HEAD：`c54e3dc995e2500c2408cfd7450a571819b1750b`（固定产品实现检查点；后续规格同步、任务勾选和归档提交不改变产品实现）
- 验收 Agent：Codex，当前连续收尾任务的 Finalizer
- 验收依据：本 change 的全部 proposal、delta specs、design、implementation-plan、tasks，以及固定产品实现和现有可运行证据。

## 结论

**PASS**。22 项 Requirement、62 项 Scenario 与 IP-01～IP-13 已核对；任务 24/24 完成。真实接缝、权限、事务、版本、人工确认、历史解释与完整闭环均有证据，无未修复的范围内缺陷、必需证据缺口或待执行审计。

两个实现期修复 change 已先完成正式验收、主规格同步和归档，本 change 按其任务 7.2 的顺序重新核对并勾选 4.1/4.2/4.4：

- [运行完成证明授权覆盖](../2026-10-07-fix-workflow-run-completion-proof-authorization-coverage/verification.md)：PASS。
- [预测恢复等待点版本绑定](../2026-10-07-fix-forecast-response-resume-run-version-binding/verification.md)：PASS。

| 维度 | 验收结果 |
| --- | --- |
| 完整性 | 24/24 任务，22 项要求、62 项场景均有实现和证据映射；依赖修复已归档。 |
| 正确性 | 最终完整浏览器 68/0，最新所属 adapter 回归通过；后端失败与版本边界不由页面猜测。 |
| 一致性 | 复用所属窄读、C04/C06/C07/C16 和统一 Schema，保留 D-06 授权上限与 D-12 入口事实；无新依赖或迁移。 |

## 核验与修复证据

### 核验期修复

| IP-ID / 所属文件 | 问题与修复 |
| --- | --- |
| IP-01：contracts ports、C25 options | 启动预览的 retryPolicyRef 使用错误包装 Schema；统一为实际启动接受的精确裸版本引用，扩展现有契约用例。 |
| IP-04：C25 engine | 目录先取固定数量再过滤会漏记录、漏统计；改为授权、空间、来源、风险输入版本与筛选先进入 SQL，keyset 查询最多取 pageSize+1，摘要由 SQL 聚合。缺失与无权精确记录统一拒绝；pending 状态按唯一风险输入批量查登记事实。 |
| IP-04/IP-05：C25/C30 | 下游读取混用分支上下文并隐式扩大来源；改为按每条实际读分支独立签验，维持原空间与来源上限。入口/运行读取移除上下文摘要等值门禁，复用 C04 工件覆盖证明。 |
| IP-05：C30 workflow adapter | 父子链查询猜父版本为 1，并只查子运行登记分区；改用调用方的真实父、子精确引用，在实际父/子登记分区查归属。修正原夹具中同样写死的版本和链边所属。 |
| IP-05：assessment runtime/graph、现有 runtime test | 子运行运行时入口与 A0 两处身份复验均漏传 reassessmentEntry，合法重评被 entry-identity-mismatch 拒绝；与父运行共用完整入口身份输入，并修正原测试夹具。 |
| IP-06：C26 warning adapter、WarningTaskPage | task-read 没有登记执行的 action，页面按钮始终禁用；复用所属分支清单返回动作及精确任务深链。所属窄读和动作签发使用 C06 复验后的上下文，显式保留空间、来源为空，签后复用范围包含检查，避免组合根默认来源扩大授权。 |
| IP-06/IP-12：C28 adapter、browser server | 独立行动的措施读取原先直接抛错；透传已有核心读取输入，用当前调用者的原空间/来源上限签发真实 C16/C04 精确发布读取。不存在或错版措施失败闭合。独立反馈没有预测引用时保持已登记的 unavailable 原因，不再把合法事实误判为漂移。 |
| IP-05/IP-10：C30、C25 run-read、AssessmentRunPage | 修正审阅引用联合解析、每组 50 项截断、耗尽组游标保留和按阶段读取最新状态；游标绑定精确运行/筛选/授权。终态使用契约中的 terminal-failure，停止轮询。 |
| IP-07：C29 calibration adapter | 公开治理分支错误要求多项能力、下游调用身份与用途不一致；按实际单分支签验，复用已有配置/规则草案用途，与真实 C16 submit-revision 接缝收口。 |
| IP-09：client/context/AppShell/ConfirmButton | 缺少来源声明入口；加入用户显式选择的精确来源版本，绑定工程与修订，下游保留或收窄。工程、来源及路由切换使旧查询失效；修正相对深链，确认上下文变化清除 pending 并阻止迟到提交结果。 |
| IP-10：启动、历史、运行、矩阵与概览页 | 启动解码读不存在的 entryMode 且拒绝合法 waiting 结果；由输入确定模式、支持真实等待运行深链。补精确监测/变化输入、前驱分页、稳定命令身份；运行单轮询与独立结果游标；矩阵按各记录的冻结发布版本分组，不猜阈值或分带。 |
| IP-11：建议、执行与校准页 | 表单缺精确版本、依赖选择跨上下文保留、成功状态按错误返回字段猜测；改用完整精确引用、真实当前主体和结果判别式。执行与反馈独立确认，改载荷生成新命令，同载荷重试沿用完整信封。 |
| IP-12：browser response-loss 用例 | HTTP 状态先于异步正文读取完成被观察，偶发空正文断言失败；正文解析完成后才交出状态，改按 succeeded/result.status 确认真实响应，不截取文本判断。 |
| IP-12/IP-13：browser server/spec | 补真实 C16 草案命令接线、单独风险等级场景及页面执行/反馈闭环。时间输入按浏览器本地时区填写；重评使用另一个真实登记沉降快照并保留压力指标，避免将无变化或缺指标样本当作完整重评。 |

来源入口采用精确版本输入而不是自动读取来源全目录；C11 现有 source-catalog 存在全库读取后切页行为，不能借它扩大授权。此处仅声明既有来源，不创建来源或改变 C06 空来源语义。design D-06、D-10 已同步记录入口与不透明游标的实际形状，没有修改领域 delta 的验收条件。

### Requirement / Scenario 证据

下列测试组是可运行证据入口，不能将组内通过机械等同于每个浏览器边界已覆盖。

| 规格与场景 | IP-ID / 实现及验证入口 | 结论边界 |
| --- | --- | --- |
| web：真实数据与页面可达；工程切换与失败 | IP-09～12；assessment-warning-response.spec 的页面深链、角色、来源选择、迟到响应和撤权场景 | 真实 PostgreSQL、C06、HTTP 与生产 demo build；详情无事实时安全失败。 |
| web：确认后启动初评或重评；缺失前置或响应丢失 | IP-05/09/10/12；启动向导五场景，worker assessment/runtime、risk-flow/runtime | 完整精确载荷、取消零写入、同身份重试；重评身份缺陷已修。 |
| web：运行等待或失败仍可追溯；重评历史保留显式入口事实 | IP-05/10；C30 adapter 的运行/入口投影、C25 重评历史、worker runtime | 后端覆盖已登记引用、重评原因与变化集、缺元数据失败；慢响应、隐藏/恢复、终态与卸载均有浏览器证据；分页 55 个结果及 105 个审阅任务无重复或遗漏。 |
| web：历史记录按原矩阵解释；缺失解释不补造 | IP-04/10；C25 精确解释与历史用例、矩阵来源失败 browser、生产 SVG 规模测量 | 真实发布第二版矩阵及对应接受/监测阈值，另一次真实评估后同页按两个冻结发布版本分组；原记录引用保留。 |
| web：确认只形成确认事实；触发与通知忠实于冻结事实 | IP-06/11/12；warning adapter、browser 确认重试/取消、真实闭环 | 确认与任务闭环分离；不伪造通知渠道或风险解除。 |
| web：采纳与拒绝分离；候选失败或目标陈旧 | IP-06/11；human-decision-feedback、response-lifecycle、recommendation tests；真实采纳 browser | 正式决定与真实预测成立；拒绝、陈旧和失败边界由领域回归覆盖，浏览器未逐一验证。 |
| web：两种来源登记与正式反馈；实际评估或证据缺失 | IP-06/11/12；页面执行/反馈闭环及 C28/C41 adapter 回归 | 已采纳建议与独立行动两种来源均经真实 UI 执行/反馈；独立措施错版拒绝，迟到提交响应不污染切换后的工程。 |
| web：无预测或未越限；校准批准只生成草案 | IP-07/11/12；response-lifecycle/calibration 回归，真实 C07 批准→页面 C29→C16 未发布草案 | 越限闭环与草案可读；独立行动反馈为 no-effect-forecast，不生成偏差事实、公共偏差或校准建议。 |
| web：取消无副作用且重试幂等；权限撤销与证据脱敏 | IP-02/09/11；确认取消、Escape、信封逐字重试、撤权、C32/C33 证据抽屉 browser | 工程/来源变化清除旧结果和确认；独立执行注入提交后的迟到响应，工程切换后不应用旧成功状态；表单共享确认守卫。 |
| web：真实闭环与失败边界验收 | IP-12/13；真实混合触发闭环、risk-level-response-verification.spec | 单独风险等级与混合触发均完成三项校验、正式建议、采纳、预测、UI 执行/反馈、偏差/校准及真实批准后的未发布草案。 |
| web：摘要失败与范围切换；原投影引用按页追溯 | IP-04/09/10；C25 SQL 摘要、C31 分页/父子/陈旧游标 browser | 当前摘要与历史投影分开呈现；对评估摘要、预警摘要与 C31 追溯三个来源分别注入失败，验证其它来源保留独立时点、范围和工程切换清空。 |
| domain/module-interfaces：有界目录与精确解释；版本权限或解释不完整；预览策略可原样启动 | IP-01/04；contracts c34 test、C25 adapter 记录/入口回归 | 50/51 边界、精确风险版本、授权先过滤、缺解释失败及启动预览裸版本契约。 |
| domain/module-interfaces：重评原因和变化引用经过恢复仍一致；原因或前驱变化不会复用旧入口；缺失历史重评事实时失败闭合；不使用监测输入时仍可冻结入口 | IP-05；core workflow、worker runtime/composition、C30 入口与 C25 历史用例 | 共用入口身份与已登记元数据；不从 frozenRefs 猜变化。 |
| domain/module-interfaces：所属事实经公开接缝组合；非法读取不泄露存在性；当前摘要与历史引用同时可读；独立来源失败不冒充完整态势 | IP-04/06；C25、C26、C27、C28、C29、C41 回归及 C31 browser | 所属读面与独立失败保留；界面组合故障证据范围见 web 行。 |
| domain/engineering-context：已登记候选可分别续页；撤权错配或游标越界失败闭合 | IP-03；engineering-data/context-source 与 C25 entry-context adapter tests | 同工程、精确修订、空间及来源授权约束，独立候选游标。 |
| knowledge：RA-S3/S4 形成适用规则集；同次发布多规则入选；配置/冲突不完整整体失败 | IP-04；core/scoring-rules、adapters/scoring-rules 与 assessment-config tests | 真实发布/依据集合与原规范规则校验。 |
| knowledge：精确集合、不可枚举、固定成员、摘要复验、无正文、重放/撤权、不可用重放、瞬时失败、历史矛盾、后续发布、同释放冲突 | IP-04；scoring-rules adapter 的成员读取与发布回归 | 领域只读成员清单、不可变引用及失败闭合，未由页面重算或复制正文。 |
| domain/response-recommendation：三项均通过；任一失败/依据缺失；单独风险等级；混合触发；依据/措施不足；冻结依据不随发布变化且历史缺失不补造 | IP-13；core/recommendation、adapters/recommendation，两个真实 browser 场景 | 保留类型化触发与冻结矩阵/接受阈值；不改共享默认风险接受阈值避错。 |
| domain/calibration：单能力草案；拒绝退回/错误决定；收口不能返回草案批准；下游撤权/尾事务失败 | IP-07；calibration adapter 回归，真实 C07/C16 browser | 单分支用途签验、真实批准证明、原幂等子身份及未发布草案；仅撤销下游批准证明时零新增，恢复权限后同命令形成一个草案修订。 |
| platform/http：注入/未注入；契约越界/无权；目录/单分支签发；分别校验治理结果 | IP-01/08；apps/api/http-shell、contracts c34 与 module-interfaces tests | 沿唯一 HTTP route catalog；未增加专用 handler。 |

### 可运行检查与测量

最终命令与结果（测试组存在重叠，不相加为独立总数）：

- `NODE_OPTIONS=--max-old-space-size=12288 pnpm exec playwright test -c playwright.config.ts --project=demo-chromium --retries=0 --output=/tmp/riskflow-plan-browser-final-complete`：68 通过、0 失败（零重试，8.2m）。真实 PostgreSQL、生产迁移、C06/C07/C16、Worker 与生产 demo build，包含既有 read-only/identification-review 和新增单独风险等级闭环。
- `pnpm exec vitest run packages/adapters/test/workflow packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts --maxWorkers=2`：3 文件、74 通过。
- `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`：最终 C26 授权修复后 18 通过。
- `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`：31 通过，包含独立反馈回读 unavailable。
- `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`：21 通过，包含下游批准证明撤权后零写入、恢复后同命令重试。
- `NODE_OPTIONS=--max-old-space-size=12288 pnpm build`、同 heap 的 `pnpm typecheck`、`pnpm --dir demo build` 通过；最终生产代码构建已完成。未安装依赖或修改构建脚本。
- `pnpm lint`、`pnpm format:check`、`git diff --check` 通过。`pnpm deps:check`：482 模块、1441 依赖无违规；`pnpm deps:policy` 通过。三个 change 的 `openspec validate <change> --strict --no-interactive` 通过。

本轮此前的相关回归：18 文件核心/适配器/Worker 322 通过；重评身份修复后 `apps/worker/test/assessment` 两文件 35 通过、risk-flow runtime 14 通过；HTTP/C34 契约/能力/建议 5 文件 102 通过；评分规则与配置 3 文件 52 通过。随后修改的拥有方已按上列最终命令复跑；没有重新宣称全库单测全绿。

压力与页面测量均为本机合成样本，不作为固定延迟门禁：

- C25：5001 条获准记录与 5001 条无权记录混合，无权记录按时间排在目录最前；未加权限的前 51 行均为无权记录。首页与续页各 50 条，实际分页 SQL 各返回 51 条，只读 2 份去重决策工件，摘要排除无权记录。最终定向场景墙钟 1346ms，测量保存在 `/tmp/riskflow-c25-bounded-read-metrics.json`。
- 生产矩阵组件在 Chromium 渲染 32×32 网格、50 落点：1202 DOM、1190 SVG、1024 单元；先前组件测量服务端渲染 31.93ms、浏览器装载 57.80ms。最终真实双历史版本整页测量：两个冻结发布分组、309 DOM，页面加载 1068ms（包含当前工程上下文与真实读分支往返）。
- C30/C25 运行结果按页返回 50/5/0，审阅任务 50/50/5；跨运行游标拒绝。慢响应超过轮询间隔时最多一个在途请求，隐藏、终态和卸载后停止请求，恢复可见后恢复读取。

此前浏览器 59/2 的实现失败已修复。新增场景后的首轮完整浏览器 68 通过（8.3m）。最终 C26 授权修复后的一轮完整回归为 66 通过、2 失败（9.5m）：混合闭环校准页静态资源出现 ERR_NETWORK_CHANGED，页面未挂载；历史矩阵初次启动返回可重试 TRANSIENT_FAILURE。失败 trace 保留在 `/tmp/riskflow-plan-browser-verified/`，未把后者未经诊断归因于网络。

随后隔离运行发现响应丢失用例的 HTTP 状态/异步正文观察竞态，已在既有用例中修复。该轮主动中止以装载修复，结果为 26 通过、1 失败、1 中断、40 未运行，trace 保留在 `/tmp/riskflow-plan-browser-isolated-final/`，不计为完整通过。最终以同一生产代码、修正后的用例、零重试且不并行运行数据库测试重跑全部场景，上列 final-complete 命令记录最终结果：68 通过、0 失败（8.2m），混合闭环与历史矩阵均通过，前一轮两项失败未复现。

以上检查执行于同一最终产品实现，随后提交为固定检查点 `c54e3dc995e2500c2408cfd7450a571819b1750b`；`git diff --exit-code c54e3dc995e2500c2408cfd7450a571819b1750b -- apps packages demo` 通过，确认提交后没有产品变更。主规格同步保留三个 change 的所有约束及已有未修改场景；归档前运行全部 specs/change 严格校验。最终文档与任务收口不替代上述业务证据。

## 规格同步与归档检查

8 份受影响主规格已同步；84 条 delta 场景逐项核对，310 条未修改的既有场景保留，共享生命周期同时保留授权覆盖和等待点状态版本规则。`openspec validate --specs --strict --no-interactive` 为 38 通过、0 失败。三个本轮归档 change 均通过严格校验，任务分别为 24/24、9/9、9/9，正式证据链接可解析。

额外执行 `openspec validate --all --archived --strict --no-interactive --json`：历史归档合计 92 项，88 通过、4 失败；失败仅为下列既有归档任务未勾选，本轮没有修改这些工件，不把该扫描宣称为全库通过。

| 既有归档 change | 未完成任务 |
| --- | --- |
| `2026-09-14-deliver-deterministic-risk-assessment` | 2 项（15/17） |
| `2026-09-20-fix-attempt-numbering-by-group` | 1 项（7/8） |
| `2026-09-21-fix-dispatch-provisioning-recovery` | 1 项（19/20） |
| `2026-09-24-deliver-assessment-and-riskflow-graphs` | 5 项（8/13） |

## 限定审计

本收尾轮次唯一一次 Targeted Auditor（Erdos）已经完成。范围为四个新分支的真实 C06 绑定及下游收窄、C29 证明/基准/尾事务、C41 等待采纳与互斥决定、D-12 重评入口身份/原键重试/登记恢复、精确历史读取及不可枚举失败。

发现已由当前 Finalizer 在批准范围内修复，修复详情见上表；对应证据为最终 C25/C30 74、C26 18、C28 31、C29 21 项适配器回归、Worker 重评身份回归及 68 项完整浏览器。审计涉及的权限、事务和关键状态边界通过，无待解决发现或待执行审计。沿用同一收尾任务，没有再次派发审计；主规格同步由当前 Finalizer 完成。

## 后续注意事项

输入为版本化合成样本，待甲方复核。延迟及 DOM 测量是本机观测值，不作为无依据的性能硬门禁。旧失败与中断记录及 trace 保留，最终零重试完整回归为 68/0；没有重新宣称全库单测全部通过。
