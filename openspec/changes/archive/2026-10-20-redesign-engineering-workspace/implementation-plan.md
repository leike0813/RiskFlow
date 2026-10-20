# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`ab6c89de31621256326bef15dcd901c8a2f14a8d`。起始工作区 clean；本轮仅规划工件未提交，不创建角色交接检查点。
- 权威来源：本 change proposal、四份 delta specs、design D-01～D-09；UI 主文档及票07链接附件。直接前置 `establish-web-design-system`、`prepare-web-shell-route-and-access-seams` 已归档；CH-3 `deliver-risk-overview-dashboard` 的目录入口需保留。
- 当前源码、调用方与测试为施工基线，不从附件旧行号推测当前符号。CodeGraph与只读调查确认原领域能力，部署CLI不作为HTTP已存在证据。Implementation先完整读取apply返回的contextFiles；不得提前生成verification。
- 顺序：IP-01 → IP-02/IP-03 → IP-04 → IP-05/IP-06 → IP-07。同一所有者串行整合共享contracts、HTTP目录、route seeds和正式组合；逻辑可独立不代表允许重叠writer。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts/ports 精确引用及 ModuleError；core/context-source EngineeringContextRevisionCommandV1Schema、Project/SpatialBusinessRevisionV1Schema；core/access ProjectAccessCommandV1Schema | 纯payload/读取DTO移至唯一公共模块，内部命令扩展原信封 | 角色、权限、上下文三维度和里程校验不能双定义 |
| IP-02 | PostgresEngineeringContextSourceRegistry.reviseContext、PostgresEngineeringDataCatalogAdapter、StructuredDocumentConversionAdapter、PostgresDataCleaningStore、PostgresMonitoringStoreV1 | workspace窄接缝解析登记范围，调用原修订/精确读取/处理结果 | 不造接入任务表、任务状态机或从ID猜因果 |
| IP-03 | createPostgresLocalIdentityAccess、administerProject、currentProjectManagerActor、systemAdministration | 新增经理作用域目录，经理四类访问动作复用原C02上下文；系统开通/成员原路径不变 | 不调用强制管理员的deployment入口、不镜像角色、不泄露全局账号 |
| IP-04 | apps/api http 路由/OpenAPI/安全错误；createDeploymentApiPortsV1；Web http/client API | 四个严格专用操作，正式装配，冻结请求 | 不把新操作塞进任意branch或跑部署脚本 |
| IP-05 | business routes、useEngineering/useProjectPath、AccessPage、ConfirmButton、PageRegions | 本域标题导航统一、新增四类承载、共享现有管理表单 | 不复制确认控制器、工程Provider、开通命令 |
| IP-06 | 五个现有工程路由、readEngineeringContext/listSourceCatalog/readMonitoringSeriesDetail/readMonitoringSnapshot、原件读取 | 独立来源状态、精确页外读取、接入事实区域 | 不从目录首页/当前阈值替换历史目标 |
| IP-07 | read-only/agent-audit-operations browser、native-zoom、现有HTTP/adapter回归 | 真正HTTP/DB/浏览器及桌面取证 | 不以静态文字断言、原型或关键skip替代 |

## 3. 代码变更映射

以下明确每项计划文件和动作，目录简写以第7节完整路径为准；没有新增公共语义留给实现者。

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | PJ-D-R1/R2、PJ-A-R1、PJ-H-R1全部场景 | contracts新engineering-workspace、vocabulary、package exports；core/context-source schema/service/index；core/access schema/administration/authorization/policy/service/index；core/cleaning schema | 按D-03～D-06固定公共payload/投影/枚举；内部Schema派生，移走纯值的实际导入全迁；policy只改枚举import，不改映射 | 原命令身份、事务、角色策略及原端口不变 |
| IP-02 | 2.1/2.2 | PJ-D-S01～S05；PJ-S03～S06/S10/S11及目录/快照原场景 | context-source registry/index、catalog adapter/index、StructuredDocumentConversionAdapter及其index、cleaning store/index、monitoring store/index；新workspace adapter | 新C11当前/历史窄读、C12转换及安全失败摘要窄读、C15独立正式结果/排除项窄读、监测精确解析；分所属reader组合 | 不扫描全库、不把无准备快照误当无清洗、不泄露多来源结果或Agent关联 |
| IP-03 | 3.1 | PJ-A-S01～S03、PJ-S07～S09 | auth postgres-local-identity-access/index；core access公共port | 新增经理成员/空间/单来源授权/成员选择目录，四类命令复用administerProject；source registeredBy服务端解析，子范围必须有父且none预期 | 不增角色/branch/策略；systemAdministration六动作不改变；单页至多50 |
| IP-04 | 4.1/4.2 | PJ-H-S01～S03、PJ-D-S02、PJ-A-S01 | apps/api http/app/operations；deployment api-ports/start；Web api http/operations及新engineeringWorkspace API | D-05四个有限HTTP操作，严格payload/Cookie注入/OpenAPI激活；正式provider必需检查；纯prepare/发送和响应Schema | 原session元数据、Cookie/错误/体积/同源规则不变 |
| IP-05 | 5.1/5.2 | PJ-R1/R2/R4；PJ-S01/S04～S09/S12/S13 | business-routes/routes、工程新页/共享导航、AccessPage抽取的开通/成员表单 | D-02新路由；open无工程门禁；共享标题/二级入口；上下文结构化表单；访问选择器；统一确认 | 系统六动作仍可用、不复制旧表单、不发布六导航 |
| IP-06 | 6.1/6.2 | 原真实事实/上下文/缺项/分页/清洗/快照/无快照场景，PJ-S02/S03/S09～S12 | ProjectOverviewPage、DocumentListPage、DocumentDetailPage、MonitoringDetailPage与CSS；新接入页/共享处理区域；api operations/context | Promise.all拆来源；直接精确资料/监测及历史快照；原件默认；接入有界读取；业务用语及本页统计口径 | 原件字节/下载/证据脱敏、服务端分页、原规范URL与版本语义 |
| IP-07 | 7.1～7.3 | 全部Requirement/Scenario及继承壳层/原件契约 | 现有contracts/core/adapter/API/Web/browser/deployment测试、native-zoom、UI地图 | 路由调用方原子迁移、实际权限/写入/失败/历史/缩放回归，更新已实施文档；Finalizer最终verification | 不重pin文案/路由数量，不写假PASS，不改旧验收证据 |

## 4. 调用与副作用顺序

1. 页面入口恢复真实会话；开通只检查当前system identity，其它页面解析当前工程并各自读取获准来源。切工程/注销即清旧内容、取消在途；迟到结果受已有revision guard限制。
2. Web专用请求构造器只生成有限HTTP operation，读带queryId/requestedAt、写带commandId/idempotencyKey/issuedAt；打开确认时冻结完整request。更改输入或上下文使旧计划失效。
3. C09 strict校验/同源/Cookie → 所属C06或C11 workspace端口 → 按登记目标解析工程、来源与空间 → 原当前权限检查 → 内部消费同次决定。禁止客户端actor/authorization或任意路径。
4. C06开通/成员或空间/来源访问、C11业务修订各自原本地事务提交事实/指针/收据/审计/必要事件。审计失败回滚，重试原身份；不同模块分步回执，不用补偿删除或重复前一步。
5. 接入读取从资料或监测精确subject取得真实登记关联，单页至多50。Agent关联独立检查；无权则完全裁剪，技术故障不伪装absent。正式结果由所属reader提供，UI不计算可用性。
6. 成功只刷新受影响当前来源，不覆盖历史URL或全站刷新；陈旧版本需重新读取、形成新确认。页面不启动模型、增加解析或清洗执行流程。

## 5. Schema、状态与持久化落实

- 浏览器strict载荷/成功投影/HTTP信封归contracts `engineering-workspace`；原ports引用/ModuleError不变。内部含sessionToken的port/request分别归core/context-source/service与core/access/service，C06错误仍沿AccessError并由C09映射，不让contracts反向依赖core。core命令类型名与信封保持，从公共payload派生。
- UI七态/确认/权限呈现沿CH-1/2；接入只呈现原所有者状态，缺席表示没有可披露登记关系，不落新状态。原C11 lifecycle、C06状态与C15终态分别保留；C06 scope版本和C11业务修订不混用，清洗结果保持原RouteDecisionRefV1身份。
- 原 `engineering_project_revisions`、`engineering_spatial_segment_revisions`、来源版本、转换、清洗准备/结果、监测批次/快照、成员/scope/source grants和command receipts/audit是事实源。无DDL、迁移、索引变更或历史回填；现有where/精确引用及limit保证有界读取。
- 新端口不改ModuleBranch、role policy或session metadata；正式部署缺port即装配失败。HTTP空成功、临时mock、静默缺字段和新授权快照配对均不接受。
- 新Schema受strict额外字段/成套参数/集合上限校验；新建ID生成一次并冻结，既有版本从授权读面选择；游标沿已有编码与当前subject/筛选绑定，不加任意512上限或全授权摘要全等。

## 6. 验收证据矩阵

命令从根目录执行。新增测试文件先在对应IP创建后运行；不是声称它们在基线已存在。测试只断言消费者可观察行为，多个场景可用同一有意义用例覆盖，不为每条文案建测试。

Requirement/Scenario全量归属索引（后表证据组提供测试、fixture、断言及命令）：

| Requirement | Scenario | D-ID | IP-ID |
|---|---|---|---|
| 页面必须只经既有 HTTP 只读面取得业务事实 | 页面渲染当前工程的真实事实；写操作入口不存在；PJ-S01 | D-01、D-05、D-08 | IP-01、IP-04、IP-05、IP-07 |
| 工程概览页必须呈现当前上下文与发布集合 | 上下文完整时呈现概览；适用性维度缺失逐项标出；PJ-S02 | D-02、D-07 | IP-05、IP-06、IP-07 |
| 资料目录与资料详情必须呈现登记、解析与清洗事实 | 目录分页与详情联动；清洗可用性如实呈现 | D-06、D-07 | IP-02、IP-06、IP-07 |
| 监测序列详情必须呈现快照与越限事实 | 快照统计与阈值同屏；无快照空态；PJ-S03 | D-02、D-06、D-07 | IP-02、IP-06、IP-07 |
| PJ-R1 工程上下文维护必须追加原领域修订 | PJ-S04、PJ-S05、PJ-S06 | D-03、D-08 | IP-01、IP-02、IP-05、IP-07 |
| PJ-R2 工程开通及成员资料访问必须沿当前授权 | PJ-S07、PJ-S08、PJ-S09 | D-04、D-08 | IP-03、IP-05、IP-06、IP-07 |
| PJ-R3 接入任务必须展示已有精确处理事实 | PJ-S10、PJ-S11 | D-06、D-07 | IP-02、IP-06、IP-07 |
| PJ-R4 工程切换发布必须保全正式深链和可访问性 | PJ-S12、PJ-S13 | D-02、D-09 | IP-05、IP-06、IP-07 |
| PJ-D-R1 工程工作区只能公开所属类型化修订和精确读取 | PJ-D-S01、PJ-D-S02 | D-03、D-08 | IP-01、IP-02、IP-04、IP-07 |
| PJ-D-R2 接入读取必须从登记来源解析真实处理关系 | PJ-D-S03、PJ-D-S04、PJ-D-S05 | D-06 | IP-01、IP-02、IP-06、IP-07 |
| PJ-A-R1 工程访问维护必须复用原管理权限和版本 | PJ-A-S01、PJ-A-S02、PJ-A-S03 | D-04、D-08 | IP-01、IP-03、IP-05、IP-07 |
| PJ-H-R1 工程工作区接缝必须闭合且正式装配 | PJ-H-S01、PJ-H-S02、PJ-H-S03 | D-05、D-09 | IP-01、IP-04、IP-07 |

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 页面真实事实、PJ-S01；PJ-H-S02 | IP-01/04/07 | contracts/test/engineering-workspace.test.ts（新）；apps/api/test/http-shell.test.ts | 合法payload/额外actor/开放patch/错kind | strict联合、额外字段拒绝；旧port不变、无隐式写入 | `pnpm exec vitest run packages/contracts/test/engineering-workspace.test.ts apps/api/test/http-shell.test.ts` |
| PJ-D-S01/S02；PJ-S04/S05 | IP-02/07 | context-source原registry测试及新workspace adapter测试 | 首修订、历史版本、合法/非法空间及里程、陈旧expectedVersion、审计故障 | 真正追加与原回执；历史不变；冲突零新事实；审计失败无部分写 | `pnpm exec vitest run packages/adapters/test/engineering-data/context-source packages/adapters/test/engineering-data/engineering-workspace.test.ts` |
| PJ-D-S03～S05；PJ-S10/S11；清洗场景 | IP-02/06/07 | 新workspace adapter测试，既有cleaning/monitoring测试 | 超50来源/准备、历史页外来源、failed转换、partial正式清洗、无Agent权、来源撤权、读取故障 | 固定页、精确版本、缺席/失败区分、裁剪关联、领域结果不被Agent门禁挡住 | `pnpm exec vitest run packages/adapters/test/engineering-data` |
| PJ-A-S01～S03；PJ-S07～S09 | IP-03/05/07 | auth/local-identity-project-authorization.test.ts；agent-audit-operations.spec.ts | 纯system、经理、viewer/reviewer；成员移除/来源撤权；并发/幂等/审计故障 | 原权限、无管理员业务权、无全局目录泄漏、单胜出及原子回滚 | `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`；浏览器命令见下 |
| PJ-H-S01/S03 | IP-04/07 | API http-shell；deployment/api-ports.test.mjs；browser servers | 有/无真实port、正式组合、OpenAPI | 路由与文档同时激活；缺provider失败；浏览器使用真实实例 | `pnpm exec vitest run apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs` |
| 上下文完整/缺项、PJ-S02/S09 | IP-05/06/07 | read-only.spec.ts；新engineering-workspace.spec.ts | 工程读权无知识/Agent/管理权；单来源技术失败 | 独立区域状态，合法正文不受其它域失败影响，非假零 | `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/engineering-workspace.spec.ts apps/web/test/browser/read-only.spec.ts` |
| 目录分页/清洗/快照/无快照，PJ-S03/S10/S11及原件五格式/权限变化 | IP-02/06/07 | 新engineering-workspace.spec.ts；read-only.spec.ts；原context-source/monitoring回归 | 历史资料、序列在首页外、非最新快照、当前阈值已改变、五格式原件、跨工程/撤权 | 历史引用不改写、可见字节一致、无首项回退/假曲线，原件不依赖解析成功 | 同上浏览器命令；`pnpm exec vitest run packages/adapters/test/engineering-data` |
| PJ-S06；PJ-S08 | IP-05/07 | 新engineering-workspace.spec.ts；confirmation.test.ts | 取消、输入/工程/认证变化、迟到回执、同键网络重试、陈旧版本 | 取消零写、同身份重试一次事实、旧回执不复活、新输入重新确认 | `pnpm exec vitest run apps/web/test/confirmation.test.ts`；上述工程浏览器命令 |
| PJ-S12；五别名/规范入口 | IP-05/06/07 | business-routes/routing-context-actions；新engineering-workspace.spec.ts | 五个已知别名、未知后缀、总览/证据入口、search含历史版本和段定位 | canonical同页、query不丢、无循环、未知仍拒绝；非固定路由数量断言 | `pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts`；上述工程浏览器命令 |
| PJ-S13；键盘缩放 | IP-07 | native-zoom.mjs；工程browser | DISPLAY/Chromium/xdotool、三种真实外窗口×两档原生缩放、真实DB/API | 操作/错误/确认/焦点实际可达，溢出实际可滚动，取消零写 | `node apps/web/test/browser/native-zoom.mjs`（按IP-07改用本change证据根和工程场景后运行） |
| 系统开通原六动作不回归、PJ-S07/S08 | IP-05/07 | agent-audit-operations.spec.ts | 真实system session，无当前工程 | 原管理六动作仍入库，抽取共享后不重复写 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts` |
| 全部工件/静态契约/工程集成 | IP-01～07 | 类型、lint、格式、依赖边界、strict | 已安装锁定依赖；无需新增依赖 | 不引新跨层import或未闭合公共协议 | `pnpm typecheck`；`pnpm lint`；`pnpm format:check`；`pnpm deps:check`；`openspec validate redesign-engineering-workspace --strict --no-interactive` |

## 7. 文件清单与升级条件

### 修改文件（现有）

- IP-01：`packages/contracts/package.json`、`packages/contracts/src/vocabulary/index.ts`；`packages/core/src/engineering-data/context-source/{schema,service,index}.ts`；`packages/core/src/access/{schema,administration,authorization,policy,service,index}.ts`；`packages/core/src/engineering-data/cleaning/{schema,index}.ts`。纯DTO/枚举导入迁移的基线消费者为上述service/authorization/policy/administration、context-source registry、auth adapter、`packages/core/test/access.test.ts`、`packages/core/test/engineering-data/cleaning.test.ts`；只改import，不改权限/算法。`scripts/deployment/provision.mjs`的原内部命令名继续保留，不因纯值迁移改部署协议。
- IP-02：`packages/adapters/src/engineering-data/context-source/{postgres-engineering-context-source-registry,index}.ts`；`packages/adapters/src/engineering-data/catalog/{postgres-engineering-data-catalog-adapter,index}.ts`；`packages/adapters/src/engineering-data/document-conversion/{structured-document-converter,index}.ts`；`packages/adapters/src/engineering-data/cleaning/{postgres-data-cleaning-store,index}.ts`；`packages/adapters/src/engineering-data/monitoring/{postgres-monitoring-store,index}.ts`；`packages/core/src/engineering-data/context-source/service.ts`的所属read契约。仅新增D-03/D-06窄读和公共DTO导入，不改变转换/清洗算法。
- IP-03：`packages/adapters/src/auth/{postgres-local-identity-access,index}.ts`；core access在IP-01定义接口后由本IP接线。
- IP-04：`apps/api/src/{http,app,operations}.ts`；`scripts/deployment/composition/api-ports.mjs`、`scripts/deployment/start.mjs`；`apps/web/src/api/operations.ts`用于补实际服务端分页参数，专用新请求由engineeringWorkspace.ts通过已有client.postRaw发送；`apps/web/test/browser/{server,business-server}.mjs`的真实provider接线。`api/http.ts`的branch注册约束保持，不增加任意operation。
- IP-05：`apps/web/src/app/{business-routes,routes}.ts`；`apps/web/src/pages/ops/AccessPage.tsx`；`apps/web/src/main.tsx`仅确保新开通页不受工程上下文读取门禁阻断。原五routeId保留：projects.root、business.projects.documents、business.projects.documentsparam、business.projects.monitoring、business.projects.monitoringparam；根base/business regions统一；原ops.css不改，新增工程样式归ProjectWorkspace.css。
- IP-06：`apps/web/src/pages/{ProjectOverviewPage,DocumentListPage,DocumentDetailPage,MonitoringDetailPage}.tsx`及各自同名CSS；`apps/web/src/api/operations.ts`真实cursor传递，`apps/web/src/api/context.ts`只在新增成套选择参数需要时同步精确查询保留。生产旧/project内部链接实际仅前三页Tabs，统一删除旧常量；EvidenceDrawer、RiskOverviewPage已使用规范/projects地址，保持代码不变，在浏览器验证其调用方不回归；ReportExportPage不在本包改造。
- IP-07：`packages/contracts/test/{c32-read-surface,module-interfaces-events-workflows}.test.ts`；`packages/adapters/test/engineering-data/context-source/{postgres-engineering-context-source-registry.test,fixture}.ts`；`packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`；`packages/adapters/test/engineering-data/{cleaning,monitoring}`原测试/fixture；`packages/adapters/test/auth/{local-identity-project-authorization.test,fixture}.ts`；`apps/api/test/http-shell.test.ts`；`scripts/deployment/api-ports.test.mjs`；`apps/web/test/{api-client-openapi,business-routes,routing-context-actions,confirmation}.test.ts`、`apps/web/test/ssr-shells.test.tsx`；`apps/web/test/browser/{read-only,agent-audit-operations}.spec.ts`、`native-zoom.mjs`及两server；`.scratch/riskflow-master-plan/prototypes/ui-redesign-spec.md`、`.scratch/ui-redesign-spec/issues/07-change-slicing-and-spec-landing.md`只记录CH-4已实施与实际verification引用，不把旧CH-3悬空链接当本change已完成。
- IP-07补充固定文件：`packages/adapters/test/engineering-data/document-conversion.test.ts`覆盖安全失败摘要；`packages/core/test/access.test.ts`、`packages/core/test/engineering-data/{context-source,cleaning}.test.ts`覆盖Schema迁移和原领域边界；`scripts/deployment/provision.test.mjs`只检查原部署入口未回归；`apps/web/test/browser/assessment-warning-response.spec.ts`只保留并回归CH-3已有资料/监测导航行为，不改总览聚合。

### 新增文件

- IP-01：`packages/contracts/src/engineering-workspace/index.ts`、`packages/contracts/test/engineering-workspace.test.ts`；core仅在原service/schema中新增端口，无另建空模块。
- IP-02：`packages/adapters/src/engineering-data/workspace/{postgres-engineering-workspace-adapter,index}.ts`、`packages/adapters/test/engineering-data/engineering-workspace.test.ts`。adapter只组合本域窄reader，不跨层读其它所有者内部行。
- IP-04：`apps/web/src/api/engineeringWorkspace.ts`，集中专用请求/解码，不在页面拼HTTP。
- IP-05：`apps/web/src/pages/project/{projectNavigation.ts,ProjectContextPage.tsx,ProjectMembersPage.tsx,ProjectOpeningPage.tsx,ProjectOpeningForm.tsx,ProjectMembershipForm.tsx,ProjectWorkspace.css}`。共享表单由新页与原AccessPage共同消费，删除原重复局部实现。
- IP-06：`apps/web/src/pages/project/{IngestionPage.tsx,IngestionFacts.tsx}`；一个A+C复合页面同时呈现列表/URL选定详情，资料页复用同一Facts，不再新增独立详情路由或业务事实模型。
- IP-07：`apps/web/test/browser/engineering-workspace.spec.ts`，覆盖第6节工程特有边界；运行截图/trace/缩放证据置本change `evidence/`。`verification.md`仅由Finalizer在实现完成后创建。

### 删除及保护

不预删既有文件；被共享表单替代的旧局部实现和重复工程Tabs/标题常量删除，不保留兼容wrapper。保留全部五条规范地址与旧别名解析、原件/脱敏组件、系统管理其它四动作及未改造的知识/识别/评估/复核/Agent/处置入口。禁止修改依赖锁、orchestration执行图/运行台账、DDL/migrations、研究资料原件、demo/v2原型和旧verification。

### 升级

固定基线后符号/行为漂移、新公开契约/角色授权/依赖/迁移、现有登记不能提供计划内精确关系、性能必须新增索引或缺少指定命令时升级。一般范围内测试/fixture失败由活动实现/Finalizer修复，不回派前一角色；不得用空结果或自由JSON兜底。允许同语义导入/fixture接线修复；新增文件或语义超出上述清单须补规划。

## 8. 验收 Agent 授权与限定审计

Finalizer读最终实现HEAD、四份delta、D-ID和全部IP；在第7节文件范围核验、修复、回归并记录实际命令/版本/场景/证据。不能用规划CLI通过代替行为通过。权限、Cookie主体、成员/来源撤权、系统/工程管理隔离、事务/并发与清洗关联属于一次限定审计；审计在同轮活动Task中修复普通缺陷并把结论并入同一verification，不派第二次全量审计。未跑关键真实路径、缺少原生缩放或待执行必要审计不得写PASS。
