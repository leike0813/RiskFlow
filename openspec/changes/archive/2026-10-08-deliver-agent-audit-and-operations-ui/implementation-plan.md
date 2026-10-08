# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`08a3fed121635895dd4edb2f8c51cf689936d912`。所有生产符号基于此 HEAD；apply 开始核对，重要漂移先升级。起草分支非 main，不切分支或操作编排。
- 权威输入：proposal、六个 delta specs、design D-01～D-13；主规格 platform 的 C06/C07/C08/C09/C10、domain/module-interfaces-events-workflows 的 C30/C31 和当前 C32–C34 web 规格；直接依赖 C07/C08/C10/C31 均已归档。
- 已核实命令：根 package.json 的 build/typecheck/lint/deps:check/test；`pnpm --dir demo build`；playwright.config.ts 的 `demo-chromium`；OpenSpec 实际 schema 为 orchestrated-delivery，applyRequires 为五个前置工件。
- v2 设计依据：`demo/v2/docs/page-manifest.json` 和 `src/pages/{agent,review,report,ops}`；只复用布局、样式和交互，数据事实及 gap 裁决见 D-01～D-13。本 change 不修改 v2。
- 每个新文件在下列 IP-ID 下明确创建；既有文件只在列出的接缝内修改。审批后按任务顺序 apply，未批准前不实现。Planning 不写 verification。
- **续接基线（认领轮次）**：IP-01～IP-10 与 IP-11 主体已实现并经协调端审阅，以补丁形式存放在主仓库 `.scratch/c35-transport/`（`c35-artifacts.patch` 为规划工件，`c35-code.patch` 为全部代码）。实现 worker 的第一步是在本工作树 `git apply` 代码补丁，随后运行 T1～T6 基线核对；补丁内容与 §7 白名单或本计划符号不符时不得修补迁就，必须 escalation。基线核对通过后继续完成 IP-11 余量与 tasks 4.1～4.3。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts/ports 的 querySchema/moduleResultSchema、MODULE_BRANCH_CAPABILITY_V1；C08 Budget/Action/Validation/Proposal Schema；C07 State/Activity Schema | D-02 原构造导出、唯一安全 read Schema | 原型 AgentMessage、BudgetConsumption、空能力管理员推断 |
| IP-02 | PostgresAgentTaskAdapter 的 getTask、readTerminalFailure/readCompletedResult、C04 受保护读、mapAgentInternalStatus | D-03/04 只读投影和 launch-context | 私有完整任务快照、失败读审计重放、模型正文 |
| IP-03 | PostgresReviewAuditAdapter.trace；ReviewQueueRead；ReviewDecisionV1；risk-identification run-read | D-06/07 精确任务、候选引用、活动分页 | 用审计引用当正文、UI 改正式记录 |
| IP-04 | C06 currentAdminActor、insertSystemAdministrationContext、administerIdentity/Project、SYSTEM_ACCESS_ACTIONS_V1 | D-10 独立 Cookie 管理面 | 客户端授权引用、密码缓存、业务超管 |
| IP-05 | PostgresWorkflowProjection.export/readPage；TransactionUnitV1；ArtifactStoreV1；sha256CanonicalJson | D-08/09 真实 JSON 工件和双事务边界 | 新报告数据库/任意工件下载/重新计算评分 |
| IP-06 | HTTP_ROUTE_CATALOG_V1、HTTP_SYSTEM_ROUTE_CATALOG_V1、runBusiness、OpenAPI；部署 Model Config | D-11/12 唯一闭合目录、可选 provider | 第二路由表、内部日志、任意探测 |
| IP-07 | demo api/client/context、usePageQuery、agentDockStore、ConfirmButton | D-05/12 查询与命令唯一接线、共享任务请求 | 两套轮询、业务持久化缓存 |
| IP-08 | v2 agent 三页/agent-shared/agent.css；demo AgentDock/AgentWorkbench | D-01/03/04/05 布局替换为真实事实 | 自由聊天、假回答/预算/风险结果 |
| IP-09 | v2 review/report 页面；demo ReviewQueue/EvidenceTrace/RunRecords | D-06～09 分区复用、精确决定/审计/报告 | 审计重放、假导出、latest 历史 |
| IP-10 | v2 ops 五页/ops.css；demo AppShell/RequireSession | D-01/10/11 系统路由和六项管理 | fixture 连接/恢复/模型生命周期 |
| IP-11 | demo/test/browser/server.mjs、deploymentPolicies.mjs、已有 browser specs | D-13 同库真实装配与证据 | 第二数据库引用拼接、SQL 成功代写 |

## 3. 代码变更映射

下表的短 capability 名：W=`web/agent-audit-and-operations-ui`，A=`platform/unified-bounded-agent-runtime`，R=`platform/review-and-audit-runtime`，I=`platform/local-identity-project-authorization`，H=`platform/http-command-query-sse-shell`，M=`domain/module-interfaces-events-workflows`；仅用于映射，Requirement/Scenario 全名见 §6。

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | M 两项；H 业务窄读；A/R/I 全部契约 | contracts/ports/index、core agent/review/access/workflow 的新 Schema 与 index | D-02 六类唯一 DTO、三 branch、原 Schema pick；C06 roleBranches按明确角色增加读 branch；既有识别/来源摘要可选字段 | 原能力/角色枚举、五类决定、旧信封、预算/验证规则 |
| IP-02 | 1.2 | A 两项；W Agent 两项 | PostgresAgentTaskAdapter及core/ui-read | 当前授权→限工程/范围→列表/精确详情/行动/候选/校验分页；真实提案读取；launch-context 核验；原动作可用性 | 原 C08 状态机、Worker、预算、定义支持模式、私有读 |
| IP-03 | 1.3 | R；W 复核/运行审计 | 新 PostgresReviewAuditRead；既有识别/工程所属只读 adapter | 任务/决定 safe read、活动多源有界归并；识别run-read增加合法修正候选引用；source-catalog增加实际delivery/connection引用 | 不查其它模块内部表、无新审计 view/迁移、原验收/决定语义 |
| IP-04 | 1.4 | I；W 系统管理 | C06 adapter、core administration、auth index | 新 SystemAdministrationPort facade；每次当前Cookie管理员证明；目录；内部注入管理引用并转原六动作 | 原 LocalIdentityAccess 接口、密码、撤销/审计、管理员无业务特权 |
| IP-05 | 2.1 | M 导出；W 报告 | core/workflow/report；新 PostgresReportExport；原 projection export/factory | 配置策略、精确预览；绑定事务→有限页→C04→尾收据/审计；artifact/history安全读 | C31原投影、Worker bodyKind、评分、任何任意工件读取 |
| IP-06 | 2.2 | H 两项；W系统管理缺席 | api app/http/index、新 operations | 三query与四系统route同源；可选注入；健康32项/2秒；安全部署/定义pick | 会话自省原shape、SSE/subscribe、不新增后台/监听 |
| IP-07 | 3.1 | W共享任务/真实接线/刷新 | demo api与AgentTaskProvider、App/ConfirmButton | 三read适配、六管理命令及专用密码信封；准确动作构造；一Provider/5秒单在途；路由生命周期 | 原会话恢复/工程清理、原命令重放，不把密码放frozenCommands |
| IP-08 | 3.2 | W Agent三种视图/操作 | demo AgentDock/Workbench/TaskDetail/agent shared+CSS | 逐页移植v2分区；真实上下文/预算/行动/校验/提案；精确深链；定义支持入口 | 不新增聊天事实、无工具自由执行/扩预算 |
| IP-09 | 3.3 | W复核/运行审计/报告 | demo ReviewQueue/ReviewDetail/IdentificationReview/AuditLog/RunRecords/EvidenceTrace/ReportExport | 统一决定builder；精确候选选择；有界独立查询；JSON真实下载与URL清理；v2布局 | 旧C33/C34可达路径、证据只定位、五类决定 |
| IP-10 | 3.4 | W系统管理/视觉复用 | demo五ops页、ops.css、AppShell/App | 无工程系统路由、六动作、管理员身份；数据来源/部署只读；未接备份真实unavailable | 七导航、无工程超管、不假造连接/健康/恢复事实 |
| IP-11 | 4.1/4.2 | W真实验收；全部跨页行为 | browser server/policies/new agent-audit-operations.spec | 同库正式端口装配；任务/复核/报告/管理员合成输入；真实故障/撤权/下载/焦点/慢读 | 生产端口和真实事务不能被stub替换 |

## 4. 调用与副作用顺序

1. **业务读（IP-02/03/05/06）**：strict HTTP输入→Cookie会话→原分支最小授权(queryId)→所属port再次verify→工程/精确目标/范围过滤→有限SQL/C04→strict安全结果。未知输入不得触达port；无资格不能先查存在性。
2. **Agent 操作（IP-02/07/08）**：合法launch-context/当前detail→冻结命令及确认摘要→确认后原 AgentTaskPort→原Schema/版本/当前授权/预算→原C04/C03/领域端口→真实结果。提案拒绝/陈旧无领域写；cancel协作式保留已提交事实；resume必须真实诊断引用。
3. **复核（IP-03/07/09）**：精确task-detail/合法候选→既有ReviewDecision联合→原确认→decideReview→C07行锁/版本/权限→单项事实+审计+回执+原事件同事务。批量逐项，不另加大事务或领取协议。
4. **系统管理（IP-04/06/07/10）**：strict系统输入→Cookie→当前C06会话/管理员/安全修订证明→服务端管理context→原administerIdentity/Project→原幂等/expectedVersion/凭据/安全审计事务。身份接口普通会话仅返回false，目录/写入不能先查目标。密码只在输入/单次请求，复用身份但不缓存载荷。
5. **导出（IP-05/06/09）**：export分支授权→登记查询/策略证明→短绑定收据及requested审计→有限全部页和当前授权→C04 put/verified→completed收据+generated审计同事务→ExportArtifactRef。绑定成功不等于导出成功；尾失败原身份重试；不发Outbox或领域变更。
6. **下载（IP-05/09）**：精确completed receipt/audit→原binding sourceRef→当前export/来源权限→登记C04引用→open+verified+JSON Schema/字节上限→安全正文→Blob下载/revoke。history至多本页50个受保护摘要读，不建立第二套持久化历史。
7. **上下文（IP-07/11）**：切工程/注销先清内容并取消在途/计时→新授权查询→代际匹配才接收。浏览器关闭仅停止UI请求，不取消耐久任务。任何失败不换模型、不扩预算、不移决定到新版本。

## 5. Schema、状态与持久化落实

- IP-01 新core DTO复用原strict引用与Schema，ports只导出现有两个构造和新增branch映射；前端数据映射是只读视图，不变成第二套领域事实。
- IP-02 新读能力不改变pending/running/waiting-user-confirmation/retryable-failure/终态，task身份与可变state版本分别使用原定义；used/reserved/墙钟原样呈现。
- IP-03 决定仍原五类联合，识别修正输出是 `revisedCandidateRef` + `approve-revised-candidate`；新candidate refs只能由识别拥有方有界读。activities新增 `business.recorded` 安全展示码及原actionCode，不修改audit原文。
- IP-04 管理上下文保留system-administration语义，不伪装AuthorizationContextV1业务载荷；所有修订、收据与安全审计沿原C06。账号历史不删，权限立刻复验。
- IP-05 内容正文独立 `riskflow-report`，不用WorkflowGraphArtifactBodyV1；回执resultRef只存既有允许的精确引用，mapping用completed审计targetRef与C04正文，不增收据字段/表。generated审计ID复用稳定身份算法，并同时作为正文与尾事务的引用。
- 不新增数据库表/索引/迁移、依赖、锁文件或配置发布协议。查到性能/关系资格需新索引或持久化结构时先升级D-ID和specs。

## 6. 验收证据矩阵

命令别名仅为阅读简写；执行使用完整命令：

| 标识 | 完整可运行命令 |
|---|---|
| T1 | `pnpm exec vitest run packages/core/test/agent-runtime/agent-runtime.test.ts packages/core/test/review-audit/review-audit.test.ts packages/core/test/access.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/contracts/test/c33-identification-review-read.test.ts` |
| T2 | `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` |
| T3 | `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/review-audit/postgres-review-queue-read.test.ts packages/adapters/test/identification/postgres-risk-identification-read.test.ts packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts` |
| T4 | `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts` |
| T5 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-report-export.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| T6 | `pnpm exec vitest run apps/api/test/http-shell.test.ts` |
| B1 | `pnpm build && pnpm --dir demo build && pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/agent-audit-operations.spec.ts` |
| B2 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/read-only.spec.ts demo/test/browser/identification-review.spec.ts demo/test/browser/assessment-warning-response.spec.ts`（B1已构建后执行） |
| S1 | `pnpm typecheck && pnpm lint && pnpm deps:check` |
| P1 | `openspec validate deliver-agent-audit-and-operations-ui --strict --no-interactive` |

T5/B1新增测试文件在IP-05/IP-11明确创建后执行，其他路径与命令均已存在。扩展既有fixtures，不复制另一套登录/数据库装配。新逻辑至少一项真实可运行行为检查，不写静态指令文本测试。

| Requirement / 所有 Scenario（精确名称） | IP-ID | 测试文件 / 命令 | Fixture/前置条件 | 关键断言 |
|---|---|---|---|---|
| W:C35 页面必须复用 v2 设计并保持既有应用接线 / 已接通页面与 v2 分区一致；刷新切换与服务异常 | IP-07/08/09/10/11 | browser agent-audit-operations / B1、B2 | v2 manifest、正式登录、工程A/B、exact URL | 页面分区截图人工对照；七态、深链、会话恢复、旧页回归；无fixture事实 |
| W:Agent 三种视图必须共享同一任务及有界刷新 / 停靠与全屏共享任务；预算或确定性拒绝 | IP-02/07/08/11 | agent adapter与browser / T2、B1 | 正式Task与预算/被拒候选、慢5秒以上读 | 同任务/预算、单在途、关闭/终态停止、无扩预算写 |
| W:Agent 操作必须使用真实类型化入口与提案确认 / 启动入口如实反映定义支持；确认与重放；提案陈旧 | IP-01/02/07/08/11 | core/agent adapter/browser / T1、T2、B1 | registered interactive与embedded定义、C04真实提案、目标版本变化 | unsupported无启动；确认前零效果；confirmed/rejected/同键重放；陈旧不转移 |
| W:统一复核详情必须保持五类决定的原语义 / 五类任务按类型决定；修正并通过使用候选；陈旧任务与部分批量失败 | IP-01/03/07/09/11 | review/identification/browser / T1、T3、B1 | 五类真实pending+decided/superseded、合法revisedCandidateRef | 合法决定联合、候选引用、旧记录/置信度不变、每项隔离/唯一决定 |
| W:运行审计与证据必须按所属事实分别分页 / 独立来源与续页；历史与无正文权限 | IP-03/09/11 | review/browser / T3、B1 | 两类运行/活动>50、单源失败、正文无权 | 各游标/错误独立、历史时间/版本、定位脱敏、无伪完整/原始日志 |
| W:报告必须导出可审计的完整有界工件 / 正式报告可重放下载；超限或权限收窄 | IP-05/09/11 | report/browser / T5、B1 | 多页C31查询、JSON策略、生成后撤权 | 真Export/Content/Audit链、下载可解码、同源重放、超限零成功引用 |
| W:最小系统管理必须使用当前服务端身份 / 无工程的管理员管理账号；角色判断不可用能力集合替代；管理变更影响当前会话；运维能力缺席 | IP-04/06/07/10/11 | auth/http/browser / T4、T6、B1 | 纯系统管理员、空业务用户、六动作对象、缺失provider | 无工程可管理/业务仍拒绝、当前身份、不缓存密码、撤销立即生效、备份零写 |
| W:C35 验收必须覆盖真实接缝和可访问性 / 真实浏览器完成 C35 链路；慢读和环境缺失 | IP-11 | browser / B1 | Chromium/PG/真实迁移/合成任务/正式port | 真实事务与下载、Tab/Escape焦点、慢请求单在途，缺环境非零 |
| A:C35 Agent 任务只读投影必须有界并保留冻结契约 / 当前任务有界读取；无权或引用错配 | IP-01/02 | core及agent adapter / T1、T2 | task/actions/candidates/checks>50、其它工程、错游标/引用 | 有界稳定页、逐项校验、原预算；不可枚举、无授权/正文泄露 |
| A:C35 交互提案摘要必须可确认且不得扩展工具权 / 可启动上下文由所属事实证明；精确提案确认 | IP-01/02 | core及agent adapter / T1、T2 | input/definition/策略真实；终态失败源与提案错版 | launch-context无猜测/预算补回；精准confirm/ref拒绝 |
| R:C35 复核详情与活动读取必须有界且不复制上游正文 / 任务详情足以提交精确决定；业务安全和拒绝活动续页；脱敏与独立失败 | IP-01/03 | review adapter / T1、T3 | C03/C06/C07多源同时间排序、历史、新增活动、资格失败 | 精确task、无重复漏页、每来源<=51行、固定asOf、失败关闭 |
| I:C35 系统管理必须从当前会话取得独立管理授权 / 当前管理员无工程身份；旧管理授权与普通用户 | IP-04 | auth / T4 | 真Cookie会话、管理员/普通、改密限制、过期/撤权 | 新鲜独立证明、客户端无授权输入、旧授权不能通过 |
| I:C35 管理目录与六项写入必须保持版本和敏感数据边界 / 管理命令重试与冲突；安全审计失败与密码处理 | IP-04/07/10 | auth/browser / T4、B1 | 六动作、并发expectedVersion、故障注入 | 原引用/单赢家、全部回滚、密码不入回执日志/确认缓存 |
| H:C35 业务窄读必须进入唯一闭合路由目录 / 注入与路由文档同源；无权或不存在同形 | IP-01/06 | HTTP / T6 | ports分别有/无、错误联合、越界字段、撤权 | runtime/OpenAPI一一对应、未注入不激活、单端口、400/同形安全错误 |
| H:C35 管理与健康路由必须保持系统授权和业务授权分离 / 原管理命令真实执行；越权与缺少提供者 | IP-04/06 | auth/HTTP / T4、T6 | 当前管理员、普通人、operations可选 | 原port六动作/idem、no-store/同源、无通用route/伪health |
| M:C35 只读端口必须复用 Schema 事实源和所属模块 / 各拥有方实现自己的事实读面；超界或错误结果族 | IP-01/02/03/04/05/06 | Schema/各adapter/HTTP / T1～T6、S1 | 边界/未知payload/错误结果 | SSOT编译、strict拒绝、单所属读、无截断成功 |
| M:C35 报告导出必须沿 C31 与 C04 形成可重放结果 / 同源同策略形成同一逻辑报告；工件或审计失败；报告再读取权限收窄 | IP-05 | report export / T5 | C04真实verified、绑定后/put后/尾事务故障、并发、撤权 | requested不能冒充generated、同一ref/审计、未知效果不重复、读取重新授权 |

边界数据使用表格驱动的代表性用例：pageSize=1/50/51、候选/活动跨页、相同recordedAt稳定次序、游标错工程/错筛选、三项报告预算恰好上限与超限。性能随上述功能测试记录真实行数、工件读取数和单在途/DOM边界，不另建性能框架。

## 7. 文件清单与升级条件

下列路径以 repo root 为基准，新增/修改构成实现白名单；小范围 CSS/DTO 细节可以在同一列出文件中调整，不准新造平行模块。每行与 IP-ID 一一归属，交叉依赖顺序见 tasks，不允许并行 writer 重叠。

| IP-ID | 新增 | 修改 |
|---|---|---|
| IP-01 | `packages/core/src/agent-runtime/ui-read.ts`、`packages/core/src/review-audit/ui-read.ts`、`packages/core/src/access/administration.ts`、`packages/core/src/workflow/report.ts` | `packages/contracts/src/ports/index.ts`、`packages/core/src/access/policy.ts`、`packages/core/src/access/schema.ts`（仅导出既有六命令 Schema）、`packages/core/src/agent-runtime/state.ts`（仅新增公共→内部状态映射）、`packages/core/src/review-audit/schema.ts`、各上述core域现有`index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/contracts/test/c33-identification-review-read.test.ts`、`packages/core/test/agent-runtime/agent-runtime.test.ts`、`packages/core/test/review-audit/review-audit.test.ts`、`packages/core/test/access.test.ts` |
| IP-02 | 无 | `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`、其`index.ts`、`packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` |
| IP-03 | `packages/adapters/src/review-audit/postgres-review-audit-read.ts` | `packages/adapters/src/review-audit/index.ts`、`packages/adapters/src/identification/read/postgres-risk-identification-read.ts`、`packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`、`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`、`packages/adapters/test/review-audit/postgres-review-queue-read.test.ts`、`packages/adapters/test/review-audit/fixture.ts`、`packages/adapters/test/identification/postgres-risk-identification-read.test.ts`、`packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`、其`fixture.ts` |
| IP-04 | 无 | `packages/adapters/src/auth/postgres-local-identity-access.ts`、`packages/adapters/src/auth/index.ts`、`packages/adapters/test/auth/local-identity-project-authorization.test.ts`、其`fixture.ts` |
| IP-05 | `packages/adapters/src/workflow/postgres-report-export.ts`、`packages/adapters/test/workflow/postgres-report-export.test.ts` | `packages/adapters/src/workflow/postgres-workflow-projection.ts`、其`index.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| IP-06 | `apps/api/src/operations.ts` | `apps/api/src/http.ts`、`apps/api/src/app.ts`、`apps/api/src/index.ts`、`apps/api/test/http-shell.test.ts` |
| IP-07 | `demo/src/api/agentAuditOperations.ts`、`demo/src/agent/AgentTaskProvider.tsx` | `demo/src/api/client.ts`、`demo/src/api/operations.ts`、`demo/src/agent/agentDockStore.ts`、`demo/src/App.tsx`、`demo/src/components/ConfirmButton.tsx` |
| IP-08 | `demo/src/pages/AgentTaskDetailPage.tsx`、`demo/src/agent/agentShared.tsx` | `demo/src/agent/AgentDock.tsx`、`demo/src/agent/AgentDock.css`、`demo/src/pages/AgentWorkbenchPage.tsx`、`demo/src/pages/AgentWorkbenchPage.css` |
| IP-09 | `demo/src/pages/ReviewDetailPage.tsx`、`demo/src/pages/IdentificationReviewPage.tsx`、`demo/src/pages/AuditLogPage.tsx`、`demo/src/pages/ReportExportPage.tsx`、`demo/src/pages/ReviewDetailPage.css`、`demo/src/pages/ReportExportPage.css` | `demo/src/pages/ReviewQueuePage.tsx`、`demo/src/pages/ReviewQueuePage.css`、`demo/src/pages/RunRecordsPage.tsx`、`demo/src/pages/EvidenceTracePage.tsx` |
| IP-10 | `demo/src/pages/ops/AccessPage.tsx`、`demo/src/pages/ops/DataSourcesPage.tsx`、`demo/src/pages/ops/HealthPage.tsx`、`demo/src/pages/ops/ModelVersionsPage.tsx`、`demo/src/pages/ops/BackupPage.tsx`、`demo/src/pages/ops/ops.css` | `demo/src/components/AppShell.tsx`、`demo/src/components/AppShell.css` |
| IP-11 | `demo/test/browser/agent-audit-operations.spec.ts` | `demo/test/browser/server.mjs`、`demo/test/browser/deploymentPolicies.mjs`；现有browser spec仅在合法新数据改变其前置时调整，不删断言绕过失败 |

删除文件：无。原静态 `demo/src/content/agent.ts` 的业务 import 从已替换页清除，只有确认零调用且另经用户授权才删原件；其它 content、v2 全部保留。UI fixture不改成“成功默认结果”。

保护：`demo/v2/**`、`apps/web/**`、`apps/worker/**`、研究原件、执行图/编排脚本、`openspec/config.yaml`、package manifests/lockfiles、所有migration、原C08定义/模型策略、原评分/预警/处置算法、用户未提交改动。正常本轮不改项目AGENTS约束。

升级条件：公开DTO/分支/权限/事务与D-ID不符；依赖或迁移；必须支持PDF/时间窗/自由聊天/新恢复协议；计划符号或指定命令失效；现有数据不能证明范围或修正候选；原AtomicCommit无法保存既有引用；需新增白名单外文件。已批准范围内普通测试失败由当前实现或收尾角色自修，不回派前一角色。新依赖/锁文件仅主调度在新设计批准后串行处理。

## 8. 验收 Agent 授权与限定审计

Finalizer 固定最终 implementation checkpoint，读取 apply全部contextFiles，按§6核对Scenario/IP-ID并运行T1～T6、B1/B2及S1；能证明不受影响的已通过检查不重复全仓运行。它可在§7白名单内修复已批准语义并回归，不能改D-ID/范围/权限/持久化或制造配置回退。归档与Git检查点另按用户授权和受控编排流程执行。

权限、交互提案和报告尾事务触发一次Targeted Auditor：检查Cookie当前管理员证明、密码边界、任务/活动/报告工程/来源权限、确认版本/幂等、C04→completed事务、审计引用及撤权后再读取。Auditor在同一活动Task内修复批准范围普通缺陷并回归，将结论补入同一verification；不再派第二轮Finalizer/审计。

verification由实现后验收角色创建，记录最终HEAD、PASS/FAIL/BLOCKED、实际命令与环境/失败trace、修复和限定审计结论。缺Docker/Chromium/策略/真实端口、关键skip、PDF/备份未实现的边界都必须如实记录；不能把范围内缺口或待审计包装成PASS。
