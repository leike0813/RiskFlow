# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`292e3aa4d32f5def1b9926fcb5c657d78ea0bb01`，规划开始工作区 clean。不是拿未来 main 或本 change 未提交文档冒充实现检查点。
- 前置：已归档 CH-1 `establish-web-design-system` 与 CH-2 `prepare-web-shell-route-and-access-seams`；读本 change proposal、四份 delta、新 design D-01～D-12，以及 apply 返回全部 contextFiles。UI 票 07 与主文档／附件是规划输入，不替代本施工图。
- 已查代码、生产调用方、现有测试与根 package.json／Playwright／Vitest 配置；本轮未执行产品测试，下面命令是实施／验收义务，不是已有 PASS 证据。
- 分包顺序：IP-01 → IP-02 → IP-03 → IP-04／IP-05 → IP-06。后两项共享 operations、route 和页面，由同一 owner 串行整合；不得并行写同一文件。无依赖安装、锁文件更新或现场迁移。
- Language server 当前未配置，CodeGraph 与精确引用搜索用于调查；实施时 exported symbol 变更前重新探测并在可用时先用 LSP references。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts/ports 的 createModuleQuerySchemaV1、createModuleResultSchemaV1、ModuleErrorV1Schema、各精确引用；access/policy 的 roleBranches、ACCESS_POLICY_HISTORY_VERSIONS | strict DTO、独立 dashboard branch、原投影能力及策略 v3 | 领域记录、角色镜像、授权信封 |
| IP-02 | PostgresRiskIdentificationReadAdapter.#recordCatalog/#catalogItem/#recordVisibility；PostgresRiskAssessmentEngine.#authorizedRecordQuery；PostgresWarningLifecycleAdapter.#readableScopeIds；PostgresReviewQueueReadAdapter；PostgresEngineeringDataCatalogAdapter.#coveredScopeEntityIds | 原所属候选关系与当前可见性，新增所属窄读，SQL 聚合／keyset 变化 | 私表跨域查询、目录页累计、个人分派、评分／阈值 |
| IP-03 | C06 authorizeBusinessAction；http.ts queryRoutes、ApiPortsV1；createDeploymentApiPortsV1、REQUIRED_API_PORT_METHODS_V1 | 六来源独立当前授权、纯组合 Module、同一生产装配 | 第二套权限策略、工作流查询物化、假空端口 |
| IP-04 | submitQuery、usePageQuery、PageRegions、PageStateView、ChartSurface、useChart、useChartTheme、presentRiskLevel、Timeline、useProjectPath | 唯一解码、复合区域、局部图表与真实链接 | 客户端聚合、原型 fixture、第二套设计系统 |
| IP-05 | RunRecordsPage 两个 Section；readRiskOverviewRunPage、listIdentificationRuns；resolveWebRoute/applyWebPathAliasV1；SectionTabs；selectorFromSearch/projectPathWithSelector/engineeringContextValueFrom | 搬到同一运行承载，精确旧地址优先解析、共享页签合并目标query、修订保全，用户续页 | 第二套运行正文、当前修订替换历史、目录扫描解析 |
| IP-06 | 真实 PostgreSQL fixtures；startBusinessBrowserServer；原 browser specs；native-zoom.mjs | 原行为用例扩展、真实读链与原生缩放，限定审计 | 静态文案／CSS／源文本测试、关键 skip |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1～1.3 | OV-D1、OV-D2；OV-R1～R4 的公共输入／输出边界 | packages/contracts/src/ports/index.ts；packages/core/src/access/policy.ts | D-02 strict Schema／六固定来源接口／事件／游标／safe counts；dashboard-read→projection.query；四工程角色分支与 v3，历史 v1/v2 保持 | C31 旧请求／结果、ModuleCapability 集合、现有领域授予与来源资格 |
| IP-02 | 2.1～2.5 | OV-R2～R5；OV-D1-S03、OV-D2-S01；OV-A-S01 | 五个既有所属 Adapter 与其 index 导出 | D-04/05：共用候选；分布完整；未确认与open任务分开；工程级pending；资料／监测真实概况；三路登记时间变化页 | 目录公开筛选／分页／精确对象语义；人工状态、旧业务行 |
| IP-03 | 3.1～3.3 | OV-R1、R3；OV-D1、D2 全场景 | 新 core/risk-dashboard/{service,index}.ts；core/package.json；http.ts；api-ports.mjs；两个活跃 browser server | D-03/06/07/08：六来源独立授权／并发；最多153候选合并；partial禁止继续、retry原位置；HTTP注册和生产必需接线 | 无跨域SQL，无queryResultRef物化，无新业务写／模型／缓存 |
| IP-04 | 4.1～4.3 | OV-R1～R5；OV-A全部场景 | RiskOverviewPage.tsx/css；新 RiskOverviewCharts.tsx；operations.ts；charts/echarts.ts；Timeline.tsx；business-routes.ts | D-09 唯一schema解码、六来源状态、同矩阵donut、工序bars、精确timeline链接、三类计数与真实接入入口；单标题及区域元数据 | 不以读权生成写权、不造上传／关闭动作、不启用六导航 |
| IP-05 | 5.1～5.3 | OV-R6；OV-O全部场景；原投影引用按页追溯 | 新 OverviewRunsSection.tsx；原RunRecordsPage及CSS；routes.ts；business-routes.ts；ReviewDetailPage.reviewTabs；SectionTabs.tsx；api/context.ts、engineering.ts、operations.ts | D-10：两组承接，独立游标，URL修订优先，精确旧路径永久replace并覆盖tab，目标query合并，生产旧运行链接归零，删除重复实现与死helper | 原复核队列／审计／报告、C31历史查询范围／重放、未知路径拒绝 |
| IP-06 | 6.1～6.5 | 所有场景最终证据，OV-R7 全部 | 下列测试／fixture／native-zoom与本change最终verification | 真实SQL／HTTP／浏览器；超页／微秒／多矩阵／权限切片／故障／历史；规模基准、六缩放组合及一次限定审计 | 不以规划校验代替功能验收，不提前勾选实现任务 |

## 4. 调用与副作用顺序

1. 正式 Cookie 会话、路径工程与 strict transport → C06 原 runBusiness 当前 projection.query 资格 → RiskDashboardReadQueryV1Schema。入口失败时无来源读取。
2. 聚合 service 解析本页游标／固定 asOf；以当前主体／工程对六来源各做一次对应业务动作授权。来源无权只产生安全失败，不扩大其它来源或全局要求交集。
3. 所属 Adapter 消费本次来源决定，读取有限来源元数据并复用当前可见性；数据库先筛授权候选，再 GROUP BY／COUNT 及三路有界时间页。中央不查业务表、不拉全页、不读全体正文。
4. 各源形成独立结果／asOf，按 D-06 全序合并最多 `3*(50+1)` 条；超过分组／来源边界显式失败。任何技术缺席无 nextCursor，retryCursor 指向原起点；拒权来源不参与可见集合。
5. 结果 strict parse → 原 no-store 安全HTTP → Web用同一success Schema解码 → 独立区域／有限图表。改变上下文先清状态与分页，abort并忽略迟到请求；用户显式重试／续页，无周期轮询。
6. 历史运行区绕开新聚合成功门禁；只在其来源有权时沿原识别列表或C31读面请求一页。已给历史修订不读当前版本覆盖；旧URL replace不执行命令。
7. 仅原 C06／读取访问记录追加；审计失败相应来源／请求失败，不生成无留痕成功。没有业务写事务、回执、Outbox、工作流查询登记或补造模型请求；无需回滚业务事实。

## 5. Schema、状态与持久化落实

- SSOT：contracts ports 内一个 RiskDashboardReadQueryV1／Result／Success 与六来源请求／结果；source接口仅由所属 Adapter实现。Web直接引用其 infer 类型，不建立dashboard手写镜像。
- 请求：单工程、可选精确空间、timelinePageSize 1～50（默认20）、可选timelineCursor。响应 summaries 六固定key，来源 ready/data/asOf/scope 或 failed/error；timeline含三来源状态、精确事件及互斥 nextCursor/retryCursor。
- 稳定身份：source + subjectRef.kind/entityId/versionId；排序 recordedAt 为UTC六位小数，SQL输出保留微秒、字符串全序与SQL一致。游标绑定工程／空间／asOf／after，不绑定完整授权摘要。首页重试也保留首次上界；无任意512字符限制或新签名。
- 统计：riskRecords accepted版本全量；assessments矩阵精确版本×等级；warnings三种原摘要与未确认分组分开；reviews工程级pending（含stale）；documents资料版本与原解析／清洗状态；monitoring可见序列与真实批次／快照存在事实。数量不跨口径相加。
- 权限：原projection.query能力不变，新增branch授予使用v3；旧v1/v2仍能恢复登记资源而非获得旧权限。reviewer零Agent要求，field-responder无资料目录仍可读预警；纯系统管理员不获得工程资格。
- 数据：无新migration／表／列／索引；不改历史风险、评估、预警、授权、报告正文；不把新摘要用于重放旧报告。无服务端／浏览器业务缓存。
- 页面：独立七态，失败不为零，历史区不被全局dashboard失败遮住。页面统计用当前空间范围；历史运行用原修订。工程／空间／认证／修订变化分别使对应请求失效。
- 全部公共语义归 design；若此节与其冲突，先修规划，不在实施时任选一处。

## 6. 验收证据矩阵

命令编号在本节后展开；测试文件均为已存在者，唯一新增聚合行为文件标“新增”。所有 fixture 合成样本、待甲方复核。用例扩展只锁稳定可观察结果，旧文案／字段顺序／CSS断言删除，不改成另一组文案。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| OV-R1：OV-S01、OV-S02 | IP-03/04/06 | apps/web/test/browser/assessment-warning-response.spec.ts | 真实业务server、一个来源技术故障、工程A/B、迟到请求 | 故障区域非零值；其它实际统计不变；切工程无旧内容 | V-04 |
| OV-R2：OV-S03、OV-S04、OV-S05 | IP-01/02/04/06 | packages/adapters/test/identification/postgres-risk-identification-read.test.ts；packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts | >50可见版本，隐藏空间/来源，重评／历史风险，多矩阵同等级ID，257工序分组 | 与同筛选目录完整集合一致；原矩阵分组；超界非截断成功 | V-01/V-02/V-04 |
| OV-R3：OV-S06、OV-S07、OV-S08 | IP-02/03/04/06 | packages/adapters/test/workflow/postgres-risk-dashboard.test.ts（新增）；assessment-warning-response.spec.ts | 三路>50、同毫秒不同微秒与同刻不同ref、首屏/续页来源故障、新增及撤权 | 无重漏、原asOf、不推进失败位置、重试可找回；错工程/空间拒绝 | V-02/V-04 |
| OV-R4：OV-S09、OV-S10 | IP-02/03/04/06 | packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts；packages/adapters/test/review-audit/postgres-review-queue-read.test.ts；assessment-warning-response.spec.ts | open任务+未确认warning、重复关联、已确认warning、knowledge pending、stale pending；viewer/field角色 | 三种计数各自正确且不求总和；无伪等级/个人分派；读不变写权 | V-01/V-02/V-04 |
| OV-R5：OV-S11、OV-S12 | IP-02/04/06 | packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts；apps/web/test/browser/read-only.spec.ts | 共享/指定可见资料、多版本、未清洗、监测无/有批次及快照、无资料权角色 | 只计同目录可见集合；点击到真实同工程承载；零命令／模型 | V-02/V-04 |
| OV-R6：OV-S13、OV-S14 | IP-05/06 | routing-context-actions.test.ts；business-routes.test.ts；ssr-shells.test.tsx；identification-review.spec.ts；assessment-warning-response.spec.ts | 两旧地址、完整和裸历史revision、当前revision不同、其它来源失败；两组>一页、共享页签含目标tab | 精确replace且保留上下文；旧未知后缀不重定向；内部页签保全project/revision/assessmentSources并覆盖tab；历史精确查询；两组独立续页；刷新/back不改目标 | V-03/V-04 |
| OV-R7：OV-S15、OV-S16 | IP-06 | 原browser specs、native-zoom.mjs、新聚合集成测试规模case | 真实dist/PG/Cookie；100/1000记录；三窗口×两缩放；缺必需环境 | 全关键路径执行；页/候选有界；真实耗时与响应大小；环境缺失非零 | V-02/V-04/V-05/V-06 |
| OV-D1：OV-D1-S01、OV-D1-S02、OV-D1-S03 | IP-01/02/03/06 | postgres-risk-dashboard.test.ts（新增）；http-shell.test.ts；auth/local-identity-project-authorization.test.ts | 真实source adapters/C06，多角色/工程/来源、v1/v2历史、v3新请求 | 无领域写/收据/模型；来源互不挡；聚合前裁剪；旧query/report可重放 | V-01/V-02/V-03/V-04 |
| OV-D2：OV-D2-S01、OV-D2-S02 | IP-01/03/06 | contracts/test/c34-assessment-response-read.test.ts；postgres-risk-dashboard.test.ts（新增）；http-shell.test.ts | 合法/非法游标、page=0/51、额外字段、非法下游响应、审计失败 | strict拒绝；unsafe count/超界不可成功；无无审计成功；当前撤权 | V-01/V-02/V-03 |
| 原风险态势：摘要失败与范围切换；原投影引用按页追溯；OV-A-S01 | IP-02/04/05/06 | assessment-warning-response.spec.ts；原workflow投影/报告集成测试 | 原C31首页／queryRef／下一页、多矩阵、摘要时点变化 | 原查询范围与ref不变，不全量翻页；原冻结评分不重算 | V-02/V-04 |
| 原运行审计：独立来源与续页；历史与无正文权限；OV-O-S01 | IP-05/06 | identification-review.spec.ts；agent-audit-operations.spec.ts | 原运行与审计独立分页、无资料正文权、旧运行链接、旧review队列 | 两组独立；不泄露正文；审计／复核／报告没有被总览替代 | V-04 |

### 可运行命令与顺序

**V-01 契约与策略**

```sh
pnpm exec vitest run packages/contracts/test packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts
```

**V-02 所属事实、聚合、历史与规模基准**

```sh
pnpm exec vitest run packages/adapters/test/identification/postgres-risk-identification-read.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts packages/adapters/test/review-audit/postgres-review-queue-read.test.ts packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts packages/adapters/test/workflow
```

新增 `postgres-risk-dashboard.test.ts` 位于已存在 workflow 测试目录，由该命令自动发现。复用 startPostgresFixture、正式 migrationRoot 与既有 C06／工件／风险／评估／预警 fixture，不新建模拟数据库；来源故障可在真实Adapter外注入失败分支，不使用回显数据作为统计证明。规模测试记录100/1000条的真实duration、page/candidate/bytes，验证授权元数据批量有界；不加入没有批准的任意延迟SLA。

**V-03 HTTP、部署与前端接缝**

```sh
pnpm exec vitest run apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs apps/web/test/routing-context-actions.test.ts apps/web/test/business-routes.test.ts apps/web/test/api-client-openapi.test.ts apps/web/test/ssr-shells.test.tsx
```

**V-04 正式生产面 smoke 与原链路回归**

```sh
NODE_OPTIONS=--max-old-space-size=8192 pnpm build
pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts
```

复用真实 `startBusinessBrowserServer`，不得起Vite开发服务器。扩展已存在总览用例，不再保留逐来源HTTP拦截旧 risk-assessment.read 的失效测试；失败由真实source wrapper在harness内注入并通过正式dashboard HTTP观察，其余来源仍真实读。既有精确C31投影、报告和五类复核用例继续运行，删除仅因旧页面文案改变失败的断言。

**V-05 原生缩放证据**

```sh
DISPLAY=:109 node apps/web/test/browser/native-zoom.mjs
```

`:109` 须为当前会话可用的专用X显示，由操作者／验收环境提供，不能借用未知桌面。现有脚本使用 xdotool／真实Chromium；本包把输出根改到本change的 evidence，保留真实外窗口／viewport／DPR断言和六组合，增加总览分布／时间线／分页可达，不覆盖已归档CH-2证据。缺DISPLAY、xdotool或Chromium明确阻塞，不安装工具或用CSS zoom替代。

**V-06 工程与规格门禁**

```sh
NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck
pnpm lint
pnpm format:check
pnpm deps:check
pnpm deps:policy
openspec validate deliver-risk-overview-dashboard --strict --no-interactive
```

不得将这些命令的存在性当运行通过。Finalizer 在实际最终检查点记录每条命令、实际结果、skip／失败／未运行和证据路径；主线 `pnpm verify` 属后续集成门禁，本轮规划不运行。

## 7. 文件清单与升级条件

以下是完整允许实现集合；新增文件在本节明确标注。行内花括号仅为列举同目录的已核实文件，不授权任意新文件。一个文件关联多个IP时由同一writer串行处理。

### IP-01：契约、角色与历史

- 修改 `packages/contracts/src/ports/index.ts`。
- 修改 `packages/core/src/access/policy.ts`；既有 auth Adapter 已消费 isRegisteredAccessPolicyVersion，不为v3复制分支或重写旧行。
- 修改 `packages/contracts/test/c34-assessment-response-read.test.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/core/test/access.test.ts`、`packages/adapters/test/auth/local-identity-project-authorization.test.ts`：消费新契约、历史／当前权限行为；非机械重pin策略字符串。

### IP-02：所属窄读

- 修改 `packages/adapters/src/identification/read/postgres-risk-identification-read.ts`、`packages/adapters/src/identification/read/index.ts`。
- 修改 `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`、`packages/adapters/src/risk-assessment/engine/index.ts`。
- 修改 `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`、`packages/adapters/src/warning/index.ts`。
- 修改 `packages/adapters/src/review-audit/postgres-review-queue-read.ts`、`packages/adapters/src/review-audit/index.ts`。
- 修改 `packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`、`packages/adapters/src/engineering-data/catalog/index.ts`。
- 修改对应五份既有测试：`packages/adapters/test/identification/postgres-risk-identification-read.test.ts`、`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`、`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`、`packages/adapters/test/review-audit/postgres-review-queue-read.test.ts`、`packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`。
- 范围内fixture仅可调整 `packages/adapters/test/warning/fixture.ts`、`packages/adapters/test/review-audit/fixture.ts`、`packages/adapters/test/auth/fixture.ts` 的同一契约接线，不改既有迁移链或添加假服务。

### IP-03：组合与HTTP

- 新增 `packages/core/src/risk-dashboard/service.ts`、`packages/core/src/risk-dashboard/index.ts`；修改 `packages/core/package.json` 的公开导出项，不加依赖。
- 修改 `apps/api/src/http.ts`、`scripts/deployment/composition/api-ports.mjs`、`apps/api/test/http-shell.test.ts`、`scripts/deployment/api-ports.test.mjs`。
- 修改 `apps/web/test/browser/business-server.mjs`、`demo/test/browser/server.mjs` 的真实组合与固定合成样本；前者按IP-06提供来源故障控制与超页样本，不创建新的生产故障开关。
- 新增 `packages/adapters/test/workflow/postgres-risk-dashboard.test.ts`，消费纯组合service＋真实所属Adapter；测试夹具复用已存在者，不另增fixture层。

### IP-04：新总览

- 修改 `apps/web/src/pages/RiskOverviewPage.tsx`、`apps/web/src/pages/RiskOverviewPage.css`、`apps/web/src/api/operations.ts`、`apps/web/src/app/business-routes.ts`。
- 新增 `apps/web/src/pages/RiskOverviewCharts.tsx`；修改 `apps/web/src/charts/echarts.ts` 注册两个已装series。
- 修改 `apps/web/src/components/Timeline.tsx` 的title类型以承载精确链接；现有ChartSurface、useChart、主题、KpiCard、PageRegions仅复用，不另建ChartFrame或通用dashboard组件层。
- 既有SSR与API行为测试归IP-06；不为ECharts option形状、图例文字、类名或固定DOM数量新增断言。

### IP-05：运行迁移和调用方

- 新增 `apps/web/src/pages/OverviewRunsSection.tsx`；删除 `apps/web/src/pages/RunRecordsPage.tsx` 与 `apps/web/src/pages/RunRecordsPage.css`，必要局部样式并入本页RiskOverviewPage.css，不删除其它业务文件。
- 修改 `apps/web/src/app/routes.ts`、`apps/web/src/app/business-routes.ts`、`apps/web/src/pages/ReviewDetailPage.tsx` 的reviewTabs旧运行链接，以及 `apps/web/src/components/SectionTabs.tsx` 的pathname/search拆分与目标query优先合并。旧运行精确规则在前缀别名之前执行，不将query目标塞进纯pathname表；六个共享页签消费者直接复用，无需分别编辑。其它旧 `/review`、`/project` 链接不属于本次运行迁移。
- 修改 `apps/web/src/api/context.ts`、`apps/web/src/api/engineering.ts`，按D-10保全当前工程revision；operations.ts删除迁移后无人调用的readRiskOverviewRuns，保留唯一readRiskOverviewRunPage。
- 修改 `apps/web/test/routing-context-actions.test.ts`、`apps/web/test/business-routes.test.ts`、`apps/web/test/ssr-shells.test.tsx`、`apps/web/test/api-client-openapi.test.ts` 的受影响契约／可达性；不把旧页面数量或旧路由render实现锁为新期望。
- 实施前对 `/review-audit/runs`、`/review/runs`、RunRecordsPage、readRiskOverviewRuns 作全仓精确引用检查；已核实生产调用点如上。demo原型页／历史归档中的同名字符串不迁移；活跃HTTP harness保留旧路径作为永久入口验收。

### IP-06：真实验收与文档

- 修改 `apps/web/test/browser/{read-only,identification-review,assessment-warning-response,agent-audit-operations}.spec.ts`，复用各自原场景并加入本节矩阵，不新建重复总览浏览器套件。
- 修改 `apps/web/test/browser/native-zoom.mjs` 的当前change输出根及总览操作，保留原外窗口/原生缩放验证。
- 本change `proposal.md`、四份 `specs/**/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md` 是规划事实，Implementation只按已实现行为勾tasks；Finalizer按指令新增 `verification.md` 与实际需要的 `evidence/`，不预写PASS。
- 修改 `.scratch/riskflow-master-plan/prototypes/ui-redesign-spec.md` 的CH-3落地引用／实际口径说明；仅在实现验收后写“已交付”，不重写九包责任，不改原已归档证据。该既有文档承担交付说明，不另建changelog。

### 受保护与升级

不得改 `pnpm-lock.yaml`、生产依赖、迁移目录、领域写入／评分／阈值／Agent策略、桌面宿主、编排Manifest、AGENTS、研究原件或已归档verification。原C31投影／报告只运行回归，不为总览变更其实现。

以下必须升级并先修design/IP：基线漂移导致符号／公开关系不存在；新迁移或索引；需要新资料写入／上传协议；队列空间授权语义变化；超出上述文件；新capability／角色权限扩大；无法用已登记矩阵／来源形成明确统计；验证命令或必需环境缺失。范围内普通类型／测试失败在当前角色内修复，不用假回退或缩小统计集合通过。

## 8. 验收 Agent 授权与限定审计

Finalizer 接收固定 implementation checkpoint，完整核对 apply context、上述IP／场景、真实生产消费和所有受影响回归；在已批准文件及语义内可修复缺陷，不回派首轮实现角色、不改变公共决定。最终verification记录实际HEAD（有dirty须如实说明）、原生／浏览器／查询／性能证据和未运行项。

本轮最多一次限定审计：`DASHBOARD-SOURCE-AUTHZ`（聚合前可见性、六来源隔离、review工程级口径不冒充空间、无Agent扩权）、`POLICY-HISTORY`（v1/v2来源可读、v3当前撤权、不重写旧行）、`CURSOR-COMPLETENESS`（微秒全序、partial不推进、重试不遗漏、当前撤权）。Auditor在自己的活动Task修复范围内普通缺陷并回归，结论写同一verification；不能用审计待做作为PASS注意事项。规划阶段不派发实现／Finalizer、不创建verification，也不操作Git检查点。
