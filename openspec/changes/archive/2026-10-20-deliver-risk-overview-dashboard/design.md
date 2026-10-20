## Context

- 工作包：UI 重做 CH-3／B-1；固定 base commit `292e3aa4d32f5def1b9926fcb5c657d78ea0bb01`，起始工作区 clean。前置 CH-1、CH-2 已于 2026-10-19 归档，当前无其它活动 change。
- 输入：票 07、UI 主文档及页面映射／路由／后端／用语／设计系统／验收附件，本 change proposal 和四份 specs；已归档 `reduce-defensive-design-overhead` 与 `simplify-trusted-business-flows` 的当前入口判权、登记范围与游标设计继续有效。研究原文不在输入范围。
- 当前总览确实消费 CH-2 的有序区域，但数据仍是评估 overview、预警 overview 和原 C31 一页运行摘要。`RunRecordsPage` 还包含独立的识别列表，迁入口不能只搬链运行。
- 评估 `#authorizedRecordQuery` 已在所属模块按空间和可见来源过滤，`overview` 与目录同源。预警 overview 的 openTaskCount、开放任务关联 warningCount 与全部预警 levelCounts 是三种口径，不能互作分母。
- 风险目录按 accepted 记录版本读取，空间／来源／证据登记缺席的旧行不进目录；当前无工序分布接口。复核队列按工程读取，无个人分派，现有实现全工程取行并在内存计算 stale；新摘要不调用该全量路径，不借本 change 重做队列。
- 资料与监测目录有授权后 totalCount，但当前实现仍载入大量目录行；新概况不能只在中央适配器调用目录再累计。风险、评估、预警时间列语义不同，变化页应明确采用登记时序而非伪称现场发生时序。
- CodeGraph 与只读调查提供路径、现有符号和调用方；本轮 `xd://lsp status` 返回 `No language servers configured for this project`。Implementation 修改 exported symbol 前应重新探测 LSP，可用则先查 references。

## Goals / Non-Goals

**Goals:**
- 以一个小的用例级 Interface 交付服务端聚合与有界变化，六个来源独立授权／失败；SQL 和候选定义留在所属 Module。
- `/overview` 承载真实多区块仪表盘与旧运行查询，消费者不补做计数、评分、来源反查或权限决策。
- 固定所有公开 Schema、授权、排序、限额、发布、文件所有权和可执行验收，不让 Implementation 补产品决定。

**Non-Goals:**
- 不做 CH-9 四来源待办明细、命令提案、正式建议待决聚合、搜索、助手组合、六导航启用；`tab=todo` 不冒充可用待办。
- 不改 CH-4～CH-8 各域页面、复核决定、任务关闭、矩阵、P/C、监测阈值、Agent 预算或研究资料；不新建风险／评估／预警事实。
- 不增加依赖、物化索引、数据库表／列／迁移、持久缓存、轮询或通用查询框架。不改 Electron 宿主或安装配置。Planning 不实现、不提交、不创建 verification。

## Decisions

### D-01 所有权与发布单元

新 `web/risk-overview-dashboard` 只收总览新行为；原评估与运行所有权用两份 web delta 修改，跨模块读面由 domain delta 增加。公共 shell 的路由／区域／七态和 design-system 已能表达本包，不再复制其要求或按导航改 capability。

同版交付新读面、生产组合、总览、历史运行承载、两个永久旧地址解析、全部生产内部链接及现有验证调用方。旧 `RunRecordsPage.tsx` 的正文移入总览所属 `OverviewRunsSection.tsx` 后删除旧文件，不留 re-export、别名组件或两份业务实现。原 C31 查询与报告端口不删除。保持当前七导航、复核队列及助手，最终组合由 CH-9 决定；不增加 feature flag、就绪登记表或未来路由占位。

### D-02 唯一公共请求与结果

所有公开 Schema 在 `packages/contracts/src/ports/index.ts` 定义并由 `z.infer` 派生，复用 `createModuleQuerySchemaV1`、`createModuleResultSchemaV1`、现有精确引用、ModuleError、日期和分页基础值。不加新的 package exports 子路径。

- branch：`projection.dashboard-read`；required capability 复用 `projection.query`。现有 `ProjectionPortV1`、`ProjectionQueryV1`、queryType、queryResultRef 与 `projection.result-read` 完全不改。
- `RiskDashboardReadQueryV1Schema`：kind 固定 `read`，payload 为 strict `{spatialScopeRef?, timelinePageSize?, timelineCursor?}`；pageSize 缺省 20，上限 50。不接受 projectRevisionRef、客户端 actor／能力／授权、任意起止时间、source 字段袋或自由 URL。
- `RiskDashboardReadPortV1.read(query)` 返回 `RiskDashboardReadResultV1`：失败沿既有 moduleResult；成功 result 固定 kind `risk-dashboard`，含 `schemaVersion:'1'`、projectId、requested spatialScopeRef（如有）、`summaries` 六来源对象和 `timeline`。一次请求提供完整有限摘要及一页变化；翻页刷新当前摘要，时间线独立沿原上界续页，不把二者称原子快照。
- 六个来源 key：`riskRecords`、`assessments`、`warnings`、`reviews`、`documents`、`monitoring`。每项为 strict `{kind:'ready',asOf,scope,data}` 或 `{kind:'failed',error:ModuleErrorV1}`。scope 只为 `{kind:'project'}` 或 `{kind:'authorized-spaces', spatialScopeRef?}` 的呈现说明，不返回全部来源 grant／角色。ready 的零才是成功空态；拒权、故障、超界不带 data。
- timeline：`{asOf,items,sources:{riskRecords,assessments,warnings},nextCursor?,retryCursor?}`。sources 每项为 ready 或 failed/error；任一应参与来源发生技术故障／超界时不出 nextCursor，但可返回其它来源最多 pageSize 个事件并明确不完整，retryCursor 固定本页原起点。拒权来源不参与合并，不泄露它是否有事件；nextCursor 与 retryCursor 不能同时存在。
- Event 为三分支 strict 联合：source、固定 changeType `risk-record-recorded|assessment-recorded|warning-recorded`、recordedAt、对应精确 `subjectRef`、可选真实 occurredAt。不返回正文、Agent 关联、审计文本或自由生成标题；UI 以类型与对象名构造业务标签，辅助位置显示精确标识。
- count 使用非负 safe integer；任一 count 超 JS 安全范围即该来源 BUSINESS_BLOCKED，不溢出／夹取。工序分组最多 256，矩阵×等级组合最多 256，每一矩阵等级最多 32，状态分组沿现有闭合枚举；用上限+1 检出，溢出整来源失败，不 LIMIT 后宣称完整。

选择独立端口而非扩展旧 risk-overview：后者会登记 workflow 查询并只返回 queryResultRef，且承诺报告重放；改其含义会破坏真实消费者。只返回当前有限组合，不建立新查询物化生命周期。

### D-03 入口资格与来源授权

`projection.dashboard-read` 映射现有 projection.query capability；四个工程角色均已有 projection.query。新 branch 显式加入 reviewer／field-responder／business-viewer 的 branchSet，经理沿 allBranches 获得；纯系统管理员仍无业务分支。策略升 `access-policy/v3`，`ACCESS_POLICY_HISTORY_VERSIONS` 保留 v1／v2 并追加 v3；旧行／历史授权／审计不改写。已归档 CH-2 的当前能力投影无需新字段或客户端角色镜像，新读取也不要求 Agent 或 review-todo.read。

HTTP 沿普通 `runBusiness` 从真实 Cookie 与路径工程取得入口当前授权。聚合 Module 注入现有 C06 `authorizeBusinessAction`，分别以原主体、工程、所选空间（若有）请求以下真实来源分支：

| 来源 | 业务读分支 | 来源统计范围 |
|---|---|---|
| riskRecords | risk-identification.record-catalog | 当前可见风险记录空间与全部来源交集 |
| assessments | risk-assessment.read | 当前可见评估记录／准备空间与全部来源交集 |
| warnings | warning-response.read | 与 warning-catalog／task-catalog 相同的当前空间范围 |
| reviews | review-audit.queue-read | 当前 review-audit.read 允许的工程级队列，明确不受总览空间筛选 |
| documents | engineering-data.source-catalog | 与资料目录相同的当前空间及指定可见资料 |
| monitoring | engineering-data.monitoring-catalog | 与监测目录相同的当前空间范围 |

这是六种不同业务来源的独立当前决定，不是对同一次内部调用逐层重签。传给所属窄读后复用该决定；不提供 skipAuthorization 开关，不拿 projection.query 上下文伪装来源能力。来源元数据可由所属 Module 经 `filterVisibleSources` 批量收窄，复用现有256项来源边界；缺 reader／超界返回该来源不可用，不全工程扫描来补授权。

源码事实决定 reviews 的工程级口径：没有 assignee，也无 queue 的空间筛选字段。只返回 `pendingCount` 和按 reviewType 的计数，不输出目标、关联 Agent 或伪造等级；计数包含 pending 且 stale 的任务，与原 pending 队列一致，stale 不等于已经决定。本包不改变 queue 的可见性／stale 实现、不新增 scope 列／索引。该范围在结果和界面明确为工程级，不能把它当所选区段待办或个人工作量。

### D-04 所属聚合接缝和复用方式

不建立一个可读所有业务表的 PostgreSQL dashboard Adapter。新增纯组合 Module `packages/core/src/risk-dashboard/{service,index}.ts`，导出 `createRiskDashboardReadService({sources,authorizeBusinessAction,now?})`，返回 `RiskDashboardReadPortV1`；通过 contracts 中显式来源 Interface 消费结果。`packages/core/package.json` 依原惯例增加 `./risk-dashboard` 的 dist types/import 公开子路径；无第三方依赖或锁文件变化。生产组合根只注入已有所属 Adapter 的新窄读方法，不内嵌 SQL 或业务判断。

来源 Interface 定义为 `RiskDashboardSourcesV1` 的六个固定成员，各有一个 `read` 方法；请求含当前 source authorization、queryId、projectId、actorId、requestedAt、可选 spatialScopeRef；风险／评估／预警还带 timeline `{asOf,pageSize,after?}`。输入和各自 success 均有唯一 strict Schema。不同来源方法的 DTO 独立定型，不公开 `source:string`／任意 filter／通用执行器。来源 Interface 属 contracts，领域模块不导入 risk-dashboard 应用 Module。

在现有所属 Adapter 增加命名方法并导出类型，不改原 port read 的行为或扩展所有现有 mock 的必需接口：

- 识别：`PostgresRiskIdentificationReadAdapter.readDashboard`，复用／提取 `#recordCatalog` 的 accepted 条件和 `#catalogItem` 必需登记列条件；将 `#recordVisibility` 的范围与全部必需来源交集下推为同一受权候选关系，供目录与聚合消费。旧目录页大小、offset 游标和字段不变，权限判断不放宽；聚合不能先取第一页再计数，也不能为每条候选调用 C06。来源声明以 distinct 元数据有界读取后经 `filterVisibleSources` 批验，SQL 使用全部来源包含及空间覆盖谓词。必要候选关系只在本文件内提取，不另建共享 SQL 仓储。
- 评估：`PostgresRiskAssessmentEngine.readDashboard`，复用 `#authorizedRecordQuery` 的记录／输入／准备 join 和来源过滤，按输入快照 `riskMatrixRef` 的完整精确版本及 r.risk_level_id 分组，并用 r.recorded_at 取变化页。保持原 overview／record-catalog 的公开协议；不重读全体决策工件或重新评分。
- 预警：`PostgresWarningLifecycleAdapter.readDashboard`，复用 `#readableScopeIds` 和目录关系。只读自身 warning_records、task_warnings、tasks、acknowledgements 等原所属表；通过已保存的评估／准备关联得到冻结矩阵引用时，只使用当前 warning Module 已持有的正式关联，不创建通用跨域查询。等级解释仍由原评估精确详情提供。
- 复核：`PostgresReviewQueueReadAdapter.readDashboard`，SQL 直接按工程、status=pending group/count reviewType，不执行原 #queueRead 全量加载或 stale 双循环。
- 工程：`PostgresEngineeringDataCatalogAdapter.readSourceDashboard` 与 `readMonitoringDashboard`，复用 `#coveredScopeEntityIds`、资料可见性和既有解析／清洗选择规则，先由所属候选关系筛可见，再 SQL 聚合；资料目录与概况共享候选定义，不在应用 Module 累计 source-catalog 页或加载全部条目再截断。监测同样共享可见序列关系。

没有原型 DTO、第二套领域记录、重复授权规则或新增采集。现有 factory 的返回类型只在其本身追加具体窄方法（工程 factory 当前返回通用 port，须改为显式扩展类型），调用方无需补假方法；部署与正式测试在装配时要求真实方法存在。

### D-05 统计单位与字段固定

| 来源 data | 字段和唯一统计含义 |
|---|---|
| riskRecords | `recordedVersionCount`；`processCounts[{processNodeId,count}]`。无运行／工序筛选时与整个 record-catalog 的 accepted 版本集合相等；当前目录没有默认只保留最新有效记录的过滤，不加这种过滤。已取代／作废关系不使其历史版本凭空消失，详情仍按原拥有方判断效力。 |
| assessments | `recordedAssessmentCount`；`matrixLevelCounts[{riskMatrixRef:VersionReference,riskLevelId,count}]`。一次初评与一次重评是两个记录版本，不去重成一个风险事件。缺必要冻结矩阵引用则该来源不完整失败，不伪造当前矩阵。 |
| warnings | 保留原 `openTaskCount`、`openTaskWarningCount`（原 overview.warningCount 的明确命名）、`warningLevelCounts`（全部 warning-catalog 等级计数）；新增 `unacknowledgedWarningCount`、`unacknowledgedLevelCounts`，按 NOT EXISTS 精确预警确认事实统计。只有上述未确认预警分组作为按等级待决数量，不将全部预警等级分布当其分母。 |
| reviews | `pendingCount`、`reviewTypeCounts[{reviewType,count}]`；风险等级不适用，不跨域读取复核 target 来凑等级。 |
| documents | `sourceVersionCount`、`parseStatusCounts`、`cleaningStatusCounts`；单位为目录可见资料版本。解析／清洗枚举直接复用原契约，未清洗沿原缺席语义，不伪造已就绪。 |
| monitoring | `seriesCount`、`seriesWithBatchCount`、`seriesWithSnapshotCount`；后两者是至少存在一个真实批次／冻结快照的可见序列数，不冒称监测点数、最新测值、时效或健康状态。 |

全部统计为当前读取时刻的所属快照，各来源独立 `asOf`；不引入跨域全局事务或声称历史定格统计。预警等级沿原 warning level 标识展示文本，不与评估不同矩阵的等级相加；任务 open 无关闭行为推断，不把确认、采纳或执行当关闭。待办区只含三类计数与现有目录链接，不提供待办明细列表，因此没有第二套待办游标；CH-9 才交付四来源列表。

### D-06 时间线是已登记记录变化，不是领域事件总线

三类事件的唯一身份为 `(source,subjectRef.entityId,subjectRef.versionId)`。风险 recordedAt 使用 standardized_risk_records.created_at，评估使用 risk_assessment_records.recorded_at，预警使用 warning_records.recorded_at；后两者可另附已有 occurred_at。changeType 均表示正式记录入库，不增造风险升降、风险解除或监测越限事件。

首页以服务器当前时间为 asOf；所有时间线排序时间规范为 UTC、六位小数的 ISO 字符串。所属 SQL 直接把 timestamp 输出为保留微秒的文本，不先经过 pg/JS Date 丢掉精度；服务器时钟毫秒值补零到六位。每来源按同一可见候选，`recordedAt<=asOf`，以 `(recordedAt DESC,source ASC,entityId ASC,versionId ASC)` 全序返回最多 `pageSize+1`；字符串比较使用同一规范形态，排序／游标／返回项一致。中央仅合并最多 `3*(pageSize+1)` 条，取前 pageSize 与下一位置。查询期间新插入且登记时间超过 asOf 的记录等显式刷新；不对历史业务 occurredAt 回填乱序。

游标沿既有 UTF-8 JSON/base64 编码方式，固定 version=1、projectId、可选 spatialScopeRef、asOf、after 完整排序元组。不另加512字符上限、签名、哈希或持久注册；HTTP 原1MiB请求界限、严格字段和完整位置检查保持。after.source 只允许三来源，时间不得超过 asOf，空／错工程／错空间游标拒绝。每页重查当前权限，游标不是授权凭据；权限收窄可能减少可见项，不泄漏被撤权事实，也不要求完整历史授权摘要一致。

若某有权来源故障或输出超界，返回其它来源有限事件但不给 nextCursor。重试沿同一输入游标和 asOf（首页也需保留首次服务端返回的 asOf 作为 retry 的起始游标位置；内部支持 after 缺省的首屏游标），不能推进成功来源后遗漏失败来源。结果增加 `retryCursor`（与 nextCursor 使用同一闭合游标 Schema）仅在不完整时给出；它固定本页原起点，不代表可继续下一页。全部来源 ready 或按当前拒权排除后才生成 nextCursor。每次页读取都重新取三个来源，最多六来源并发，只有显式用户刷新／续页／重试，无常驻轮询或新重试策略。

### D-07 安全错误、访问记录与事务

外层认证／工程入口失败返回原失败，不执行来源；来源明确 AUTHORIZATION_DENIED 映射 forbidden，不附隐藏数据。BUSINESS_BLOCKED 的 `dashboard-group-limit|dashboard-source-limit|dashboard-source-not-injected|dashboard-reference-incomplete` 作为该来源不可用；未知 DB／I/O 异常按原 `mapPostgresError`／ModuleError 映射 transient／terminal，不 catch 为拒权或成功零。

C06 的业务访问决定和所属已有访问记录继续真实耐久；聚合不使用 TransactionUnit.execute，不写 command_receipts、workflow.queries、Outbox 或业务审计成功事实。任一必需安全审计失败就是对应请求／来源失败，不吞掉错误。跨来源无写事务，读取只复用来源已有一致性规则；不做全局事务、回填或删除。API 结果和 Web 解码都使用同一 strict Schema，不复制手写未知字段解析器；安全摘要不展示 SQL、堆栈、Cookie、来源正文或模型响应。

### D-08 HTTP、部署及全部实际组合根

`ApiPortsV1.riskDashboardRead` 为独立可选注入，`queryRoutes` 注册 POST `/api/v1/projects/:projectId/queries/projection.dashboard-read`，domainKind=read；缺端口则该 route/OpenAPI 不激活，缺内部来源不得返回假空。沿原 JSON 信封、Cookie、同源、no-store、错误和1MiB边界，不改会话 DTO 或建立新 GET 聚合特例。

`createDeploymentApiPortsV1` 在原所属 Adapter 构造后创建同一 risk-dashboard service，并注入六来源与 access.authorizeBusinessAction，将 riskDashboardRead.read 及所需窄方法列入装配期检查；生产缺真实方法即拒绝启动，不能 fallback 到目录遍历。`apps/web/test/browser/business-server.mjs` 与仍活跃的 `demo/test/browser/server.mjs` 同步真实接线；仅接线，不复制生产聚合规则。缺 provider 的部署契约测试同步更新，未知分支／未注入行为沿原 HTTP 测试。

### D-09 前端承载与统计呈现

`operations.ts` 增 `readRiskDashboard`，通过现有 submitQuery 并直接用 contracts success Schema 解码。只保留已经取得的单次响应，不遍历页、不复制 DTO、不在浏览器合并领域统计。`RiskOverviewPage` 消费 CH-2 PageFrame／PageRegions 及独立 PageStateView，主标题与 route 元数据用同一“风险态势总览”。

页面顺序：真实资料入口的页头动作 → 态势（评估等级 donut、工序 hbars）→ 变化 timeline → 三类待办摘要 → 资料／监测概况 → 可定位的运行摘要。评估 donut 一次只展示一个冻结矩阵组，选择器列出真实精确版本，默认按稳定引用顺序第一组；无元数据时保留原等级 ID 与说明，不从字符串推严重度。工序用原 ID／已有正式名称，不拼原型工序表。生产只有 ChartSurface／useChart，尚无 donut／hbars；新增页面所属 `RiskOverviewCharts.tsx` 实现两种呈现，复用 ChartSurface、useChart、useChartTheme、presentRiskLevel，不移植 demo/v2 组件或新增通用图表框架。`charts/echarts.ts` 在已有按需注册中增加 PieChart、BarChart，不引依赖。文字／表格提供同值可访问替代；缺正式 ordinal 的等级中性呈现而不猜色。

时间线复用 `components/Timeline.tsx`，仅将 title 的 string 扩为 ReactNode 以承载精确 Link，原字符串消费者不变；不得在 JSX 外先把事件转成不可点击文本或复制一套 timeline 容器。保留原预警摘要的三种含义，但不将全部预警等级图当评估等级图或待决分母。

六来源错误在本区解释，page 级无工程／入口故障沿七态；重试重新请求同页，旧 response 不越过工程／空间／认证代次。独立 historical runs 不以 dashboard ready 为前置，不能把一个 PageFrame 全局错误包住所有合法历史读取。无空间选择时统计当前授权全部空间，选空间时传其既有精确 ref；本请求不含工程修订，概况不是某历史修订的重放。工序上下文不作为隐式统计过滤，工序分布仍是所选空间全量并明确范围。

资料动作只导航现有 `/projects/documents`，监测动作只导航 `/projects/monitoring`，使用 useProjectPath 保留上下文。现有页面没有正式上传／批次写表单则总览诚实标明可到达的接入承载及真实可用动作，不能贴“上传成功”或新增无 handler 上传按钮；不新增文件提交协议。入口有已知权限且可披露时沿公共 disabled／原因，受限对象完全隐藏。普通 UI 不额外挂合成装饰标记，验收／质量材料保留强制来源与待复核标签。

### D-10 历史运行承接与永久地址

提取原 RunRecordsPage 的 IdentificationRunsSection、ChainRunsSection 到唯一 OverviewRunsSection，保留各自 query、独立 cursor 与精确 run/ref、queryResultRef 和用户续页；`readRiskOverviewRunPage` 仍负责原 C31，`readRiskOverviewRuns` 若迁移后无任何调用则删除并同步 exports，不保留“只取第一页”的死 helper。

历史工程修订优先取当前工程的 URL `revision`：完整 `<projectId>@<versionId>` 必须与所选工程一致，原裸 `<versionId>` 使用既有 project-revision 实体等于 projectId 的身份规则（`main.tsx.projectRevisionRefFor`），不通过读取当前修订拼身份。同工程重复相同值可归一，矛盾、空值、非法多段或只给别的工程的修订显示不可定位，不回落当前。只在 URL 完全未给本次修订选择时消费 Provider 已有 readEngineeringContext 结果取当前修订，不再重复发 context-read。

当前 `EngineeringSelector` 只有 revisionId，且 `engineeringContextValueFrom` 在 context.projectId 非空时把它清空。修复 `api/context.ts.selectorFromSearch` 的工程匹配解析和 `projectPathWithSelector` 的版本保全，`api/engineering.ts.engineeringContextValueFrom` 对同工程保留 revisionId，切工程仍清除旧工程修订；不新增第二个 selector／Provider。完整原 search 在旧地址 replace 中保留，精确历史引用由 OverviewRunsSection 依上述规则解析和 shared Schema 验证。现有 `main.tsx` 的质量页选择行为不在本包改写。该 context 读取的错误不能阻断已给修订的运行；工程／revision变化清除 queryResultRef 和 cursor。识别分组按自己的来源读权独立工作，不强加工程数据或投影资格。

在 `applyWebPathAliasV1` 处理原前缀表之前，显式匹配且仅匹配 `/review-audit/runs` 与 `/review/runs` 两个完整路径；先核对 registry 中 `/overview` 目标，再用 URLSearchParams 保留原 search 并 set tab=runs，返回规范地址。不要将带query的目标塞进现有纯pathname前缀表，不扩为通用转换器。两条旧路径的未知后缀不触发新规则；原 `/review/*` 简单别名和逐段静态优先保持。删旧 runs seed 后仍可由该精确解析到唯一新承载，无别名链或中间闪屏。

`ReviewDetailPage.reviewTabs` 的运行项直接改 `/overview?tab=runs`。它被其它复核／审计页共享，`SectionTabs` 当前把 it.to 整串塞 pathname，会吞掉目标query；在唯一 SectionTabs 中拆分 pathname/search，以当前search为底合并目标query（目标的tab优先），保留project/revision/assessmentSources。六个调用方不复制合并逻辑，普通无query项行为不变。不顺手迁其它 `/review`、`/project` 链接，其对应切换属于后续包。

总览用 `useSearchParams` 读取 tab：runs 使运行区域展开并可聚焦／滚动到标题；缺省呈现仪表盘和有界运行入口。未知导航tab回到默认且不变更精确对象；todo 在本包不作为新聚合承载，原队列继续可用。定位不启动业务、不自动翻页；浏览器back恢复其合法位置，刷新从服务端重读原引用。

### D-11 依赖、持久化与文件所有权

不新增第三方依赖，无许可证／离线包的新治理项；CH-1 的 antd/ECharts／主题继续使用。无新表、列、索引、migration 或历史数据重写；新SQL限定本工程候选，关系／来源元数据和返回有界。若性能实测证明需索引，必须先升级设计批准，不由 Implementation 临时加迁移。

文件按 implementation-plan 的 IP-01～IP-06 列明，共享 ports/index.ts、HTTP、api-ports、operations、browser fixture 均由同一集成 owner 串行编辑。源码已有 accepted／可见候选优先抽取复用，不复制整份目录算法。前置规则文档引用已经足够，本 change 不修改 AGENTS 或编排 Manifest，也不触碰其它活动工件。

### D-12 验证与责任收口

扩展既有 contracts、access、所属 Adapter、HTTP、路由和正式浏览器测试，新增一个聚合 Adapter 消费测试文件，仅测试跨来源语义、稳定分页及失败，不做回显／接线／源文本断言。测试事实由现有真实 PostgreSQL fixtures 形成；新端口的组合根存在性用原 api-ports 测试，不能替代结果行为。删除因旧页面实现被取代而只锁文案／CSS／数量的断言，不重 pin。

实现 smoke 必须从正式 dist 打开 `/overview` 并实际操作：权限隔离、真实聚合超一页、时间线续页／故障重试、资料入口、两个旧运行深链／历史修订、refresh／back、工程竞态和原运行后继详情；无假后端、无关键 skip。复用已存在 native-zoom.mjs 做三窗口×两档原生缩放，更新场景指向总览而不改宿主。性能在隔离库固定 100／1000 条记录规模记录 SQL耗时、页条数和响应字节，证明不按业务总记录条数调用授权或读取正文；不承诺未经实测 SLA。

权限聚合与策略历史需要本轮至多一次限定审计，最终结论补入同一 verification；Finalizer 在固定实现检查点核验并修复范围内缺陷。Planning 仅以 applyRequires 闭合，不创建 verification 或宣称功能 PASS。

## Risks / Trade-offs

- reviews 的工程级口径与其它空间级摘要不同，必须明确呈现；本包不把不存在的个人分派和目标等级当能力。需要改变队列授权语义时另经批准，不能仅为总览顺手重做。
- 各来源读取非同一数据库快照，摘要时点可能不同；选择明示时点而不是引入跨域大事务。翻时间线会重读小型摘要，接受固定六来源查询成本，避免额外操作协议与缓存。
- 原资料目录和风险目录的实现有内存筛选成本；本包只提取本次需要的候选关系，保持原响应／分页，不全仓重构。来源或分组超界显式不可用，不能通过后台遍历掩盖。
- 现有资料／监测页可读不等于有上传写表单。入口只到已交付承载；不在 CH-3 扩大接入写能力，也不把缺动作包装为可上传。用户主路径的真正新接入表单归 CH-4，需要其真实命令与验收。
- 原生200%需桌面显示、Chromium和现有自动化工具；没有此环境时记录阻塞，不以CSS zoom或viewport缩小替代。

## Migration Plan

1. IP-01 固定 Schema／branch／策略 v3 与历史识别，旧 DTO、数据、C31 query 不变。
2. IP-02 在各所属 Adapter 形成受权聚合／变化窄读，IP-03 组合 service／HTTP／部署及实际 harness；生产不发布未实现成功路由。
3. IP-04 交付总览，IP-05 同批迁原运行、永久解析及全部调用点；目标验收前旧入口继续可用，同次发布删除旧正文实现。
4. IP-06 完成真实查询／浏览器／缩放／性能及一次权限限定审计后生成 verification，任务按实际证据勾选；main 门禁／归档仍按后续流程。
5. 无数据库回写和回退迁移。回退使用上一软件构建，历史数据与永久旧地址含义保持；不留并行旧业务页。

## Open Questions

无影响本包 Interface、权限、数据口径、依赖、迁移或施工范围的未决问题。CH-4 新接入写面与 CH-9 四来源待办／六导航是已划定后续包，不作为 Implementation 临时补设计项。
