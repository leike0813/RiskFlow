# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`603a192a4ac0aabeeefe5f03a62032a0f5c53819`；起始工作区 clean。本轮新增规划工件不构成已提交交接检查点。
- 权威输入：proposal、三份 delta、design D-01～D-09、票07与 UI 主文档/八附件的相关决议；CH-1/CH-2 为已归档直接前置，保留 CH-3/CH-4 已交付入口；两项已归档减负设计约束当前授权、登记范围与有限读取。
- 当前源码、调用方、现有测试和命令已调查。LSP 未配置，符号依据 CodeGraph；附件旧行号不作为施工符号。Implementation 先读 `openspec instructions apply --change redesign-identification-workspace --json` 返回的全部 contextFiles，不提前写 verification。
- 顺序：IP-01 → IP-02 → IP-03 → IP-04/IP-05 → IP-06。共享 contracts、HTTP、operations、route seeds 由同一 owner 串行整合，不安排重叠 writer。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts/ports `querySchema`、`RiskIdentificationReadQueryV1Schema`、`RiskIdentificationRunListItemV1Schema`、`RiskIdentificationRunReadSuccessV1Schema` | 原两种详情 payload 的互斥选择，列表头部字段 pick 派生，原 read/result 联合 | 不新建 resolver branch/能力或风险记录 Schema |
| IP-02 | `PostgresRiskIdentificationReadAdapter.read/#verify/#resourceAuthorization/#recordVisibility/#latestRunStateRow/#runList/#runRead/#recordRead` | 定向定位、入口权限、原正文/阶段与安全错误；列表/详情同一头部；C09自动派生 | 不扫描首页、不全工程枚举、不把登记范围当授权 |
| IP-03 | `identificationShared`、六页面、`usePageQuery/useProjectPath`、`listIdentificationRuns/listRiskRecords/readIdentificationRun/readRiskRecord` | 单标题、四入口、原cursor/筛选、快照与实时读取分开、单在途监控 | 不编造名字/总数/写按钮，不新增通用请求层或事实缓存 |
| IP-04 | `EvidenceTracePage` 链正文、`readTraceChainLinks/readProjectionItems`、EvidenceLink/Drawer、`ReviewDetailPage.reviewTabs` | 一份详情追溯区域、无正文解析页、原内部链接迁移 | 不新增 queryResultRef URL 接口，不误删 AssociatedObjects |
| IP-05 | `AssociationGraphPage.GraphSection/RecordGroupsSection`、`ProcessModelPage/ProcessModelBody`、`PROCESS_NODE_VALUES`、`readKnowledgeRelease` | 图只保正式边；模型精确读取、业务字段与词表 | 不内嵌第二风险列表、不推断模型关系/历史/冻结版本 |
| IP-06 | 原 contracts/adapter/API/Web/browser/deployment 测试与 `native-zoom.mjs` | 真实持久化/HTTP/Cookie/浏览器/缩放与限定审计 | 不重 pin 文案/类名/路由数，不用关键 skip 替代行为 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | C33 只读全部场景；ID-H-S01/S02 | contracts/ports 及 c33 契约测试 | D-02 两个唯一 strict payload union；run-read 头部字段从列表 Schema 派生；原精确引用仍合法，双选择/空/错kind拒绝 | query/read信封、结果kind、原role/branch/能力不变 |
| IP-02 | 2.1/2.2 | C33全部、ID-D-S01～S04；HTTP全部场景 | identification read adapter、API原测试 | D-03 定向候选及完整来源当前授权；run-list/read头部取同一最早登记；公共payload自动派生HTTP/OpenAPI并验证 | 不改API/部署生产代码，不增加表/迁移/策略；旧数据不改写、技术故障不冒充拒权 |
| IP-03 | 3.1/3.2 | 页面事实/假写、ID-S01～S03、精确正文与参数化深链 | identificationShared、business-routes/routes、两目录与两详情、operations | 四入口/单h1；真续页/筛选重置；去四处首页find；run/record精确或裸身份read；链接版本写回；运行结果引用集合补齐、单在途可见性刷新 | 原七字段/置信度/等待/失败、非终态状态、原确认与复核决定不变 |
| IP-04 | 4.1/4.2 | 追溯全部、ID-S04～S07、ID-S01与证据脱敏 | RiskDetailPage、新RiskTraceSection/TraceRedirectPage、EvidenceTracePage、ReviewDetailPage、route seeds | D-07 共享链正文；tab=trace懒读/独立状态；两个旧入口授权解析/replace，迁所有内部trace链接，删旧正文 | 只迁风险subject，保原工程选择器；原复核及AssociatedObjects不动 |
| IP-05 | 5.1/5.2 | 图谱全部、ID-R1/ID-S09/S10、ID-S01 | AssociationGraphPage、ProcessModelPage、identificationShared、operations | 图主体用真实有界选择和精确详情，删RecordGroupsSection；图完整后呈现；显式模型release对/节点，缺省当前，补监测等已有字段和单一词表 | 不裁切图、不推断新关系、不做CH8治理或扩大读权限 |
| IP-06 | 6.1～6.3 | 全部 delta 与继承七态/证据/确认/缩放 | 第7节测试、fixture、native-zoom、UI地图 | 页外对象/精确版本/当前撤权/安全失败/原复核/真实图链、原生缩放、一次限定审计；实施后更新地图 | 规划不预填PASS，不改旧verification或生成实现后证据 |

## 4. 调用与副作用顺序

1. 会话恢复后解析当前工程；页面筛选与 URL 只提供选择输入。注销/切工程/上下文变化清旧值、abort 并使旧响应失效。
2. 风险/运行有精确版本就直接读；风险缺省版本提交裸身份后replace写回唯一版本。运行无版本使用裸ID实时跟踪，不写回版本；显式版本只读状态快照，只有用户“查看最新进展”才去同runId无版本地址。C09 strict校验 → Cookie/路径工程/branch确定主体 → 所属模块D-03定向定位及完整当前授权 → 原read正文，全程不扫描目录。
3. 正文成功后仅在 trace 页签发 `projection.query`，主体为该 riskRecordRef；再按同一 queryResultRef 完整有界分页。模型显式release直接读，缺省才查当前集合。每个来源单独状态，失败不抹其它获权正文。
4. 旧 trace 解析只定位/replace，不写业务、不再开一套链正文；失败同形且保留技术重试。查询登记/工件访问沿原所属审计；不为简单身份查找插业务收据或Outbox。
5. 原复核决定仍由原详情/队列经唯一确认提交，不在本包迁移其状态机；取消、同身份重试、陈旧版本与事务审计沿现有契约，仅做回归。

## 5. Schema、状态与持久化落实

- contracts 为 payload/结果 SSOT；公共 union 无客户端授权字段，原结果中的 VersionReference/七字段/证据/ModuleError 不复制。HTTP 直接引用，不做新分支或新传输信封。
- 标准化风险记录与运行登记继续是事实源，无 DDL、索引、迁移、历史回填或外部数据操作。只解析原行和C04已登记正文，不重新证明系统外篡改。
- 原目录页大小固定不超50；Web保留当前页/cursor/筛选，不建客户端全表。图/链沿现有每页50/最多1000完整有界读取，不重造页协议。
- 只使用原七态，正文/trace/模型各独立；URL只有业务选择/精确引用，模型`release/releaseVersion`成套。错误沿原安全类别，目标隐藏/不存在同形，I/O技术故障保留可重试性。
- 运行URL版本是状态正文哈希，显式版本只读历史快照；无版本监控每次用裸runId解析最新获权状态，快照不自动切最新。列表与详情启动头部用最早同一状态登记，不把后续恢复者字典序当启动者。不新增模型/预算/人工决定策略。

## 6. 验收证据矩阵

命令从仓库根执行；本规划只核实命令和既有路径，不声称已运行这些业务验证。测试覆盖消费者可观察的权限、身份、状态、分页和错误；多个场景共用代表性用例，不逐条写文案测试。

### Requirement / Scenario 全量归属

| Requirement | Scenario（原名或本delta稳定ID） | D-ID | IP-ID |
|---|---|---|---|
| 识别与复核页面必须只经既有 HTTP 面取得业务事实 | 页面渲染当前工程的真实事实；假写入口不存在；ID-S01 | D-01、D-04～D-06 | IP-02/03/04/05/06 |
| 识别运行列表与详情必须呈现真实运行事实 | 列表分页与详情联动；等待复核如实呈现；Agent失败无跳过入口；ID-S02 | D-02/03/05/06 | IP-01/02/03/06 |
| 风险记录列表与详情必须呈现识别侧记录事实 | 记录详情呈现精确版本正文；评估域内容缺席不编造；ID-S03 | D-02/03/05/06 | IP-01/02/03/06 |
| 关联图页必须只呈现可证明的投影边 | 可证明关联正常呈现；不可证明时失败闭合 | D-07/08 | IP-03/05/06 |
| 证据追溯页必须呈现固定追溯链并可穿透 | 沿链穿透到详情；无权限节点只显定位摘要；ID-S04、ID-S05、ID-S06 | D-03/05/07 | IP-02/03/04/06 |
| 跨页深链必须使用领域标识 | 参数化深链可直达；ID-S07 | D-05/07/08 | IP-03/04/05/06 |
| 浏览器验收必须使用真实浏览器与正式接缝 | 真实浏览器完成识别与复核链路；环境不可用明确失败；ID-S08 | D-09 | IP-06 |
| ID-R1 识别工作区必须使用单一业务标题与只读工序模型 | ID-S09、ID-S10 | D-05/08 | IP-03/05/06 |
| C33 识别运行与风险记录只读必须有界且复验当前授权 | 获授权调用方读取运行与记录；越权或跨工程不可枚举；等待复核与失败状态如实呈现；ID-D-S01、ID-D-S02、ID-D-S03、ID-D-S04 | D-02/03 | IP-01/02/06 |
| C33 只读分支必须复用既有传输信封与失败形态 | 客户端提交越权字段被拒；无权与不存在不可区分；ID-H-S01、ID-H-S02 | D-02/03/04 | IP-01/02/06 |

继承而未修改的区域七态、证据抽屉、复核决定要求分别由下表拒权/竞态、脱敏、原复核回归证明；未在本包重新实现其领域命令。

### 真实测试与断言

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| C33 / ID-H-S01/S02；ID-D-S01 | IP-01/02/06 | contracts c33-identification-review-read；API http-shell | 原精确ref、裸ID、双选择、空选择、错kind、客户端actor/authorization | 两种合法输入；strict拒绝冲突；原read结果精确ref与头部，不新建branch | `pnpm exec vitest run packages/contracts/test/c33-identification-review-read.test.ts apps/api/test/http-shell.test.ts` |
| C33全部，ID-D-S01～S04 | IP-02/06 | adapters identification/postgres-risk-identification-read | 真实PostgreSQL/C04，>50条目录；单记录唯一版本、同运行多个状态/后续由字典序更小账号恢复、跨工程/错版、多来源撤权、SQL/I/O故障 | 页外目标直接读；精确状态不变、裸ID取最新；启动者/时间同一最早登记；故障非假拒权/空；零业务写 | `pnpm exec vitest run packages/adapters/test/identification/postgres-risk-identification-read.test.ts` |
| ID-H-S01/S02、正式接缝 | IP-02/06 | API http-shell；browser servers | 两合法选择、双选择/额外授权、真实Cookie、原provider已注入 | HTTP自动继承公共union与结果，非法输入拒绝；真实浏览器使用原所属port | `pnpm exec vitest run apps/api/test/http-shell.test.ts`；上述/后述浏览器命令 |
| 真实事实、两目录续页/筛选、精确正文、ID-S01/02/03 | IP-03/06 | browser identification-review | 真实登录/DB/迁移/dist；超过50任务与风险；页外精确目标、失败/等待/终态；单域角色 | 实际后续页可达且ref版本不丢；过滤重置；结果引用集合可穿透；正文不被无投影/Agent权挡住 | `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts` |
| ID-S02/S06与七态 | IP-03/04/06 | 同一browser | 同runId多状态推进；显式历史快照、无版本监控、slow read>5秒、隐藏/终态、切工程/注销/切版本、来源故障 | 快照不轮询且固定版本；实时监控取得新版本而非首帧；单在途不覆盖新对象，trace失败不抹正文 | 同上浏览器命令 |
| 追溯全部、ID-S04/S05/S07、参数化深链 | IP-04/06 | routing-context-actions/business-routes；同一browser | 两旧trace、alias未知后缀、页外对象、给定/缺版本/无subject/重复冲突、project/revision/assessmentSources | replace规范URL、版本保真无循环；无subject才去列表；目标拒绝同形；无任意result引用入口 | `pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts`；上述浏览器命令 |
| 沿链穿透、图谱两场景、脱敏及ID-S01 | IP-04/05/06 | 原workflow投影测试；同一browser | >50链边、无权段、真实缺席链尾、后页技术故障/越界、图主体页外 | 同一query完整有界；不伪完整；图无重复风险列表但真实节点/边可读；只显定位无正文 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`；上述浏览器命令 |
| ID-R1/ID-S09/S10 | IP-05/06 | 同一browser、read-only | 非当前精确process-model发布/节点；当前集合失败、错类型/缺一参数；实际monitoringIndicators | 显式版本不读当前替代；错误不选首项；监测字段/最小覆盖按实际词表；无假治理/关系/历史 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/read-only.spec.ts` |
| 原复核决定/幂等、证据两态、ID-S07 | IP-04/06 | identification-review；agent-audit-operations | 原pending/历史复核、真实决定/审计、取消/同键、无Agent权 | 原队列/两类详情和合法决定不回归，确认取消零写；新trace链接不绑任意任务 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts` |
| ID-S08、环境不可用 | IP-06 | native-zoom.mjs | DISPLAY/真实Chromium/xdotool、真实DB/API；三种外窗口×100/200%，识别任务/风险trace/图/模型 | 导航、页签、分页、错误、局部滚动与焦点实际可达；无CSS zoom，缺环境非PASS | `node apps/web/test/browser/native-zoom.mjs`（本IP替换为本change证据根与识别场景后运行） |
| 全部静态/工件集成 | IP-01～06 | 类型、lint、格式、依赖边界、OpenSpec | 已安装锁定依赖；无新依赖 | 无跨层import/不闭合协议；任务与D/IP覆盖完整 | `pnpm typecheck`；`pnpm lint`；`pnpm format:check`；`pnpm deps:check`；`openspec validate redesign-identification-workspace --strict --no-interactive` |

## 7. 文件清单与升级条件

### 修改（现有）

- IP-01：`packages/contracts/src/ports/index.ts`；`packages/contracts/test/c33-identification-review-read.test.ts`。只新增D-02两payload导出及原结果字段；无需新package export。
- IP-02：`packages/adapters/src/identification/read/postgres-risk-identification-read.ts` 的 `#runList/#runRead/#recordRead`、`read/#recordVisibility/#resourceAuthorization` 与现有 `#dashboardError` 分类复用；`packages/adapters/test/identification/postgres-risk-identification-read.test.ts`；`apps/api/test/http-shell.test.ts`。同文件原readDashboard消费者随私有错误分类命名更新，回归已有dashboard行为，不改聚合口径。`apps/api/src/http.ts`与 `scripts/deployment/composition/{identification,api-ports}.mjs` 自动消费公共Schema及同一port，保持不改；不新增部署接线断言。
- IP-03：`apps/web/src/pages/identificationShared.tsx`；`apps/web/src/pages/{IdentificationRunsPage,IdentificationRunPage,RiskRecordListPage,RiskDetailPage}.tsx` 及各自同名CSS；`apps/web/src/api/operations.ts`；`apps/web/src/app/{business-routes,routes}.ts`。两read helper签名/解码与实际消费者同批迁；API来源恢复复用原client，不修改通用HTTP/授权机制。
- IP-04：`apps/web/src/pages/RiskDetailPage.tsx`、`RiskDetailPage.css`、`ReviewDetailPage.tsx`；`apps/web/src/app/business-routes.ts`；`apps/web/src/api/operations.ts` 只复用原trace helper/解码，不新增历史query URL能力。旧`EvidenceTracePage.tsx/.css`作为提取来源后删除；原AssociatedObjects保持。
- IP-05：`apps/web/src/pages/{AssociationGraphPage,ProcessModelPage}.tsx` 与各自同名CSS；`apps/web/src/pages/identificationShared.tsx`。图谱主体选择用原目录真实选项及续页，不从第一页证明目标；模型直接复用原知识release读。
- IP-06：`apps/web/test/{api-client-openapi,business-routes,routing-context-actions}.test.ts`、`apps/web/test/{design-system,ssr-shells}.test.tsx`；`apps/web/test/browser/{identification-review,read-only,agent-audit-operations}.spec.ts`、`{business-server,server}.mjs`、`native-zoom.mjs`；前述contracts/adapter/API测试及 `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` 的必要夹具/行为用例。browser server只扩事实/故障/延迟数据，不改既有provider；`confirmation.test.ts`可原样回归，不重写确认机制。
- IP-06文档：`.scratch/riskflow-master-plan/prototypes/ui-redesign-spec.md`、`.scratch/ui-redesign-spec/issues/07-change-slicing-and-spec-landing.md`，实施后记录真实证据及CH5状态，不宣称CH9组合完成。Planning本轮仅可标记起草位置和apply-ready，不能标已实施。

### 新增

- IP-04：`apps/web/src/pages/RiskTraceSection.tsx`、`RiskTraceSection.css`（从原追溯页搬活正文/样式），`apps/web/src/pages/TraceRedirectPage.tsx`（仅原旧地址定位与安全状态，不复制链正文）。优先页面文件内局部实现，不为单一选择另建通用hook/框架。
- IP-06：实现后的 `evidence/` 图/trace/缩放记录，以及 Finalizer 才创建的 `verification.md`。本规划不增加永久新测试文件；在已有业务测试内增加高价值边界。

### 删除与保护

删除旧 `apps/web/src/pages/EvidenceTracePage.tsx`、`EvidenceTracePage.css` 正文实现、重复 `RecordGroupsSection`、本域重复tabs/五节点常量和只解释技术机制的文字。此删除属于规范承载切换，不删除旧URL、既有数据库记录或原归档证据。保护 `AssociatedObjects`、原复核队列与类型化详情/决定、其它域页面、shell七导航/停靠、领域算法、依赖/锁文件、DDL/migrations、编排配置/运行台账、研究原件、demo及旧verification。

### 升级条件

固定基线后符号/语义漂移；需要新公开契约、来源权限/角色变更、依赖/迁移/索引、新文件超白名单；原登记无法提供设计中的身份与版本；必须新增冻结模型或工程使用关系读面；指定命令不存在或必要外部环境不可达——由当前责任方升级，不以空数据、假回退、额外无限扫描或压缩验收范围解决。一般范围内代码/fixture/测试失败在活动Implementation/Finalizer任务自修，不回派已结束角色。

## 8. 验收 Agent 授权与限定审计

Finalizer 以最终实现HEAD、三份delta、D-01～D-09和IP-01～IP-06为输入，在第7节范围内核验—修复—回归后填写verification。一次限定审计覆盖：裸身份/精确版本、当前全来源/空间权限、无权与不存在同形、原查询主体与新详情一致、跨工程/撤权及技术错误区分；不新增事务或全量重复审计。审计发现的已批准范围普通缺陷在该活动Task闭合，结论并入同一verification。关键路径或原生缩放缺证据、必要审计待执行时不得PASS；规划CLI就绪不等于功能/现场/甲方验收。
