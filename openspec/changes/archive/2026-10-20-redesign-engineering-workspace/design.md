## Context

- 工作包：UI 重做 CH-4。固定 base commit：`ab6c89de31621256326bef15dcd901c8a2f14a8d`，起始工作区 clean；OpenSpec 1.14.3 创建结果的 schema 为 `orchestrated-delivery`，applyRequires 为 proposal/specs/design/implementation-plan/tasks。Planning 不创建 verification。
- 前置 CH-1/CH-2/CH-3 已归档。输入为票07、UI主文档及页面映射、路由、设计系统、用语、GAP重判、后端清单和演示叙事；原型只提供已批准视觉方向，不是业务数据或后端能力。
- `ProjectOverviewPage` 将资料、监测和知识版本放入同一 Promise.all，任一拒权会抹掉全部概况。`MonitoringDetailPage` 先在目录首页找序列，再选择第一个快照，并读取当前阈值；这不能满足目录页外精确读取和历史快照语义。
- C11 `reviseContext`、C06 `ProjectAccessCommandV1Schema` 及 deployment `context-revise/project-access` 已有实现；Web 的闭合接口并未因此自动具备这些动作。系统管理 `AccessPage` 已能真实开通工程和修订成员，不重复实现。
- 沿已归档减负设计：入口检查当前权限，内部消费登记事实；详情直接精确读；不新增逐层签发、调用编号配对、全库权限证明或文件哈希复验。语言服务状态为 No language servers configured，符号依据 CodeGraph 和只读调查。

## Goals / Non-Goals

**Goals:**
- 五条现有工程路由完整保留，补 P-PJ-02/03/04/08 的真实承载，形成工程内部可用工作区。
- 固定缺失窄接缝的 Schema、权限、结果、失败和正式装配，不让 Implementation 自行设计公共语义。
- 工程读面不被知识、Agent 或系统管理权限捆绑；历史资料原件、精确监测与修订保持可读。

**Non-Goals:**
- 不实现 CH-5～CH-9，不启用六导航/搜索/新停靠，不改知识治理、工序业务模型或处置。
- 不新建浏览器上传、解析启动、监测导入、外部数据库/API连接或模型调用流程；本包接入承载展示现有登记事实，不把这些后端内部能力宣传为 Web 已可操作。
- 不增加依赖、锁文件、角色、业务能力、策略版本、表、迁移或平行任务状态机；不修改现场数据、模型、Electron宿主、移动端或暗色切换。

## Decisions

### D-01 规格与所有权

只修改 proposal 中四个既有 capability 的 Requirement；工程界面行为归 `web/engineering-and-knowledge-ui`，修订与接入投影归 C11，访问维护归 C06，传输归 C09。不按导航重组 capability。已归档主规格不在 Planning 直接改写；同文件的后续 CH-8 delta 按 Requirement 合并。

### D-02 页面与URL合同

| 规范路径 | routeId／标题 | 上下文与内容 |
|---|---|---|
| `/projects` | 原 project 根 ID／工程概览 | 保留工程身份、适用性、区段；资料/监测/知识版本独立状态 |
| `/projects/documents` | 原资料目录 ID／资料目录 | 原服务端分页；资料与监测二级组中的资料位置 |
| `/projects/documents/:docId` | 原资料详情 ID／资料详情 | `version` 精确版本；原件默认，解析清洗/分段/访问区域 |
| `/projects/monitoring` | 原监测根 ID／监测数据 | 分页目录，不默认打开首页首条 |
| `/projects/monitoring/:seriesId` | 原监测详情 ID／监测序列详情 | `version` 为序列版本；`snapshot`、`snapshotVersion` 成套选择快照 |
| `/projects/spatial-scopes` | `projects.spatial-scopes`／工程上下文 | 当前工程与空间业务修订；`revision`选择历史工程版本，`scope`/`scopeVersion`选择空间精确版本 |
| `/projects/members` | `projects.members`／成员与资料访问 | 原成员/空间/来源访问目录及所属动作 |
| `/projects/opening` | `projects.opening`／工程开通 | contextRequirement:none；当前system identity，不要求业务工程 |
| `/projects/ingestion-tasks` | `projects.ingestion-tasks`／接入任务 | 列表+详情复合区域；`kind=document|monitoring`两个独立来源页；`source`+`version`成套选择精确资料/序列，不另造taskId或详情路由 |

工程二级入口为资料与监测、工程上下文、成员、开通。工程概览作为根摘要；接入任务从资料与监测组进入。现有规范 URL 不删除；`/project` 及原五模板继续沿 CH-2 的已知模板别名接缝，不为新增页面扩大旧模板集合。所有跳转沿 `useProjectPath/projectPathWithSelector` 保留工程、修订、assessmentSources 与对象/段定位，新增参数不得覆盖 `version` 的原对象语义。无版本旧序列地址由所属目录窄解析该实体的当前可见引用后 replace 写回 URL，不扫描目录页；无快照参数时只展示有界快照选择，不擅自改成最新。成套快照参数缺项/错配拒绝，不回落其它对象。

在 `pages/project/projectNavigation.ts` 定义工程页共享入口和标题，由 route seeds 与页面导入；只做本域元数据，不建全站页面配置引擎。系统开通链接即使无工程仍可达；本域无权状态不改变其它域入口。单一 h1，标题不含技术ID。

### D-03 当前与历史上下文

保留原 `engineering-data.context-read` 空载荷及主机工程读取；新增 workspace 精确读而不改变宿主语义。当前上下文维护先读服务端 current，显式历史 `revision` 或空间引用永不换当前。历史模式只读；新命令只能基于当前版本，业务生命周期按原 `preparing|active|ended|archived`，不把 C06 工程 active 与 C11 lifecycle 混成同一状态。

公开业务 DTO 在 `packages/contracts/src/engineering-workspace/index.ts` 唯一定义并由 package exports 暴露：将 C11 已有纯值 Schema（ProjectBusinessLifecycle、SpatialBusinessStatus、ChainageRange、EffectivePeriod、SystemTime、SpatialApplicabilityOverrides、ProjectBusinessRevision、SpatialBusinessRevision）及修订 payload 提到该模块；C11 内部命令从 payload 扩展 `commandId/idempotencyKey/projectId/actorId/issuedAt/authorization`。迁移实际消费者导入，不在 core 保留旧纯 Schema re-export/shim，不复制字段校验。已有 `EngineeringContextRevisionCommandV1` 名称及内部事务保持。core/context-source/service和registry均改从公共模块导入纯值。

`EngineeringWorkspaceCommandPayloadV1` 是 `kind:project|spatial` 联合，字段逐项沿现有 command 去除拥有者信封：
- project：`expectedVersion: VersionReference|'none'`、name、lifecycle、applicabilityMetadata（三维）、effectivePeriod。
- spatial：spatialScopeRef、projectRevisionRef、expectedVersion、可选 parentScopeRef、name、worksiteLocation、可选 chainage、applicabilityOverrides、status、effectivePeriod。

新 `EngineeringWorkspacePortV1.revise(command)` 返回原 `ContextSourceResultV1` 的 project-revision/spatial-revision 成功分支投影或原 ModuleError。read的context payload为`{kind:'context',projectRevisionRef?,scopeId?,spatialScopeRef?}`，scopeId（读该稳定身份当前业务修订）与spatialScopeRef（精确历史业务修订）互斥；返回`{kind:'context',projectId,project:ProjectBusinessRevision|null,spatial:SpatialBusinessRevision|null}`。表单从C06 scope选择器取稳定scopeId，再读C11当前业务修订，expectedVersion来自返回的C11引用，不能把C06授权版本当业务版本。URL沿原`revision=工程ID@版本`；scope+scopeVersion表示精确历史，无scopeVersion的scope选择当前。此为新增C11窄read：复用registry原行解码，原context-read不变；无业务首修订返回null，不等同不存在工程。只读不创建修订、收据或Outbox。

分层固定：contracts/engineering-workspace只拥有浏览器可见strict载荷、成功投影及其HTTP信封，不依赖core。`EngineeringWorkspacePortV1`及含sessionToken的内部请求定义在core/context-source/service，`ProjectWorkspaceAccessPortV1`定义在core/access/service；C06仍返回本模块AccessError，C11仍返回ModuleError，C09沿原mapAccessError/mapModuleError转换为既有安全HTTP错误，不把AccessError从core复制到contracts。Web只导入contracts成功DTO并消费现有C09HttpError；core内部Token类型、授权快照及实现不进入Web依赖。

### D-04 C06访问维护与系统开通共享

工程开通页直接使用从 `ops/AccessPage.tsx` 抽取的 `ProjectOpeningForm`，`/ops/access` 继续消费同组件。原 create-account/disable/reset/suspend 等系统动作不迁移、不扩展；只有开通与工程成员维护部分共享，不能复制整页第二套确认。开通的初始账号来自现有系统账号目录，projectId 是新身份，由表单新建时一次生成并作为辅助可复制值，禁止让用户手输既有账号引用。`includeAdministrator` 仍是原显式选项，不默认授予。

访问维护使用独立 `ProjectWorkspaceAccessPortV1`，由 C06 所有，Cookie请求，与 systemAdministration 并列。经理路径复用 `administerProject` + `currentProjectManagerActor`，签发既有 `engineering-data.register-source-delivery` C02上下文；不能调用强制系统管理员的 `executeDeploymentProjectAccess`。原经理可执行revise-membership/create-spatial-scope/revise-spatial-scope/revise-source-access；systemAdministration的六动作及管理员成员修改原路径继续保留。

公开request/result定义于contracts workspace模块。C06原命令的公共payload从唯一字段Schema扩展回授权信封；原PresetRole/SourceVisibility值从contracts vocabulary单一导出，迁移core/access/schema及消费者，不维护两份枚举。新增经理作用域目录是本包新增读能力，不是假定系统管理目录可供经理复用：
- 读联合 `memberships|spatial-scopes|source-access|member-options`，各带queryId/requestedAt/projectId；memberships、spatial-scopes、member-options带pageSize(1..50,默认25)、可选cursor，source-access是必带sourceVersionRef的单对象读取，不接受cursor。member-options只返回本工程有效成员accountRef/displayName，供资料指定账号选择，不开放全局账号。
- memberships仅当前工程风险管理员或原系统管理员路径可读；经理投影返回membershipRef/accountRef/displayName/roles/spatialScopeRefs/status，join原账号显示身份，不返回密码、登录凭据或全局账号。经理可修改/移除现有成员；向工程添加尚无成员关系账号仍从原systemAdministration表单和账号目录执行，不凭任意账号ID扩张目录。
- spatial-scopes、source-access、member-options要求当前工程风险管理员；分别返回scopeRef/parentScopeRef/status及sourceGrantRef/visibility/allowedAccountIds/spatialScopeRefs/registeredByAccountId。若该精确来源仍未完成授权绑定，返回原领域不可用状态而不是伪共享。仅系统管理员而非工程成员没有这些业务读取权。
- 写联合 `revise-membership|create-spatial-scope|revise-spatial-scope|revise-source-access`；从原C06命令去除commandId/idempotencyKey/projectId/authorizationContextRef得到payload，source-access另外去除registeredByAccountId，由来源登记事实填回。成员更新只绑定已读当前membershipRef/accountRef；系统成员表单继续经原systemAdministration提交。
- 创建子空间必须expectedVersion='none'且parentScopeRef必填；根空间只能由open-project创建。新scopeId和新增membershipId在新建表单生成一次UUID；父范围、账号、角色、来源和全部已有版本从真实授权选择器取得。权限修订和业务区段修订分别确认，失败不伪装跨模块回滚。

公开端口失败用现有 AccessError；管理动作和安全审计沿原 C06 原子事务。只读目录不新增业务收据，当前身份和会话限制逐请求生效。策略版本不变：只公开原已允许动作，不给任何角色增授 branch。

### D-05 工程命令的HTTP接缝

C09 注册新的有限专用 route，不改原 EngineeringDataPortV1、ModuleBranch、角色策略或能力枚举。workspace端口的内部请求含由HTTP从Cookie注入的sessionToken；C11修订沿既有 `engineering-data.register-source-delivery` 的 engineering-data.write 入口资格，工程精确读沿 `engineering-data.context-read`，资料/监测接入读沿原source-catalog/monitoring-catalog及目标来源权限。复用这些现有动作资格，不给读角色增授任何写权，也不通过新branch静默改不可变策略。

| HTTP | operationId | 拥有者与授权 |
|---|---|---|
| POST `/api/v1/projects/:projectId/engineering-workspace/commands` | `engineering-workspace.revise` | workspace.revise，Cookie及原C11写授权，冻结commandId/idempotencyKey/issuedAt/payload |
| POST `/api/v1/projects/:projectId/engineering-workspace/queries` | `engineering-workspace.read` | workspace.read，Cookie及原C11读授权，queryId/requestedAt/payload |
| POST `/api/v1/projects/:projectId/access/queries` | `project-workspace-access.read` | C06 workspaceAccess.read，Cookie及原管理身份；严格有限目录联合 |
| POST `/api/v1/projects/:projectId/access/commands` | `project-workspace-access.execute` | C06 workspaceAccess.execute，Cookie及原经理身份；严格四类命令联合 |

专用端口不使用ModuleBranch伪造系统/工程权限，沿原安全Cookie与同源要求。公开HTTP载荷排除sessionToken、actor、authorization，路径projectId唯一；拥有方从目标登记解析空间及来源再执行当前权限检查，客户端引用只是选择输入。Web `engineeringWorkspace.ts` 直接复用现有 `client.ts` 的postRaw/unwrapQueryResult及原administration prepare模式，四个有限路径封装不进入强制branch/path对应的createC09OperationRegistry；不放宽assertOperation，不增加通用URL执行器。确认operationId只标识这四个固定操作，请求按同一ConfirmButton冻结。

`ApiPortsV1` 新增可选 engineeringWorkspace/projectWorkspaceAccess，缺注入不激活对应HTTP/OpenAPI；正式部署 `createDeploymentApiPortsV1` 要求真实实例，缺失装配失败，不降级成功空数据。HTTP错误、禁止缓存、体积上限与CORS沿现有机制。所有新读使用已有工程数据可读范围，入口检查一次，内部不重复签发。

### D-06 接入任务投影不建立新工作流

接入列表复用资料、监测两个有界目录，kind切换清空本页游标，不合并totalCount或造混合游标。另在有agent-task.read时使用原任务列表的taskType=data-cleaning独立分页展示进行中/历史清洗任务，链接原精确Agent详情；不能由这页任务列表推断任意资料的阶段。无Agent权不发这条请求，也不披露计数/标记。

workspace.read除context外有五种严格payload：`{kind:'ingestion',subject:SourceVersionRef|MonitoringSeriesRef,cursor?,pageSize?}`；`{kind:'resolve-monitoring',seriesId}`用于无版本旧地址；`{kind:'monitoring-snapshots',monitoringSeriesRef,cursor?,pageSize?}`供精确序列快照选择；`{kind:'cleaning-exclusions',resultRef,subject,cursor?,pageSize?}`用于正式排除项；conversion-failure见下。页大小默认25、最大50；游标绑定工程、subject、记录类型和最后排序位置，不绑定完整授权摘要。resolve-monitoring成功返回原MonitoringSeriesCatalogItemV1；monitoring-snapshots返回`{kind:'monitoring-snapshots',items:MonitoringSnapshotCatalogItemV1[],nextCursor?}`；既有精确序列详情继续复用MonitoringCatalogSeriesDetailV1。

ingestion成功为 `{kind:'ingestion',projectId,subject,items,nextCursor?}`；items是分阶段严格联合，每页最多50。共有stage、recordRef、recordedAt；conversion条目从StructuredDocumentConversionRecordV1Schema.pick派生conversionRef/status/statistics/sourceSegmentSetRef?/diagnosticRef?/completedAt，recordedAt映射completedAt，不公开原始模型或诊断正文；segments含sourceSegmentSetRef及段总数；cleaning含正式resultRef、policyRef、所选input的availability/baselineAvailability/totalCount/retainedCount/retainedRatio/reasonCodes；monitoring-batch/snapshot分别复用MonitoringBatchCatalogItemV1/MonitoringSnapshotCatalogItemV1。清洗排除响应items每页最多50，只含该subject的decisionId/targetKind/reasonCode/disposition/rejectionClass?/sourceSegmentId?/sampleVersionRef?/evidenceReferences，不返回其它来源或整份result_payload。stage absence由成功空items表示，只说明“当前未登记可读取的处理关系”，不等于“未清洗”。

新增`{kind:'conversion-failure',conversionRef}`按原失败记录定位诊断，成功只返回`{kind:'conversion-failure',conversionRef,reasonCode,sourceSegmentId?}`。转换所有者在现有C04受权读取内按1MiB上限读取本记录登记的diagnosticRef，只投影持久detail.reasonCode/sourceSegmentId；不存在定位就缺省，不能生成locator，不返回serviceDiagnostic、原响应或任何完整诊断。原件不受诊断读取失败影响。

转换所有者新增按source精确引用分页及按conversionRef读取安全失败摘要的窄方法，复用StructuredDocumentConversionAdapter原rowToRecord/#readByRef解码；C15 store新增按result_payload.inputs的精确sourceVersionRef或monitoringSnapshotRef筛选正式结果，直接消费data_cleaning_results，不依赖identification_preparation_snapshots是否存在。监测subject的清洗关联先由所属store按精确series列出有界snapshot关系，再匹配原结果，不将来源ID当快照ID。workspace只调用这些所有者窄方法，不跨模块直读表。

公开投影DTO是小于正式记录的视图，字段与值来自原解析结果，不重建领域规则。conversion复用现有contracts统计/状态Schema；清洗availability复用contracts的CleaningAvailabilityV1Schema，disposition/rejectionClass的原两组值迁到contracts vocabulary唯一导出并由core清洗Schema消费；其它输入/结果/校验正式Schema保持原所有者，不搬整套清洗模型或复制任务Schema。

已有准备通过identification_preparation_snapshots的真实snapshot_payload成员返回精确准备引用；没有准备但已有正式result仍展示该result，不伪造准备。相同来源多个转换/结果均按recordedAt降序、recordRef实体及版本升序稳定分页。AgentTaskRef只在能证明该记录关联且当前Agent读取授权成功后出现，不返回hasAgent；预算/校验从原Agent详情读取，不复制Schema。原件I/O、坏记录或所有者读失败是技术失败，不折叠为absent；无Agent权不挡来源领域事实，不启动模型或加假重试。

清洗resultRef沿现有data_cleaning_results登记的RouteDecisionRefV1，不发明data-cleaning-result近义引用；recordedAt使用原登记recorded_at，结果正文按原DataCleaningResultV1解析。每个结果披露前检查其全部冻结空间与来源的当前权限交集，不能凭所选一个source权拆出多来源派生结果；排除项同样检查全结果范围，再只返回该subject条目。结果来源不足不披露引用、总数或关联存在性，不以历史任务授权替代当前权限。验收须包含资料可读但多来源清洗结果另一个来源已撤权的拒绝场景。

### D-07 页面呈现与读取修复

- 工程概览拆成上下文、资料、监测、知识版本四个独立取数区域，复用 usePageQuery/PageStateView，不加第二套跨页缓存。资料/监测目录的 totalCount 才是总量；当前页 parsed/partial 等计数标明本页或删除，绝不装成工程总计。
- 资料目录保留服务端分页、原件名称首列与精确版本链接；DocumentDetail 保留原件默认、对象URL释放、下载、证据脱敏。解析清洗页签连到同一接入读取组件，不复制正文、另造“处理成功”规则。
- 监测列表和精确详情拆成同一文件内明确分支或共享局部组件；详情不依赖list.items.find，直接用参数调用 readMonitoringSeriesDetail。无版本只经所属实体窄解析，给了版本不可改写。`snapshot/snapshotVersion`明确选择，快照来源由服务端登记恢复，客户端不要求从目录首页组装来源。没有选择时呈现快照目录，用户选择后读所给版本，最多现有页大小；当前阈值独立可选且标为当前配置，历史越限只显示原事实，特征不可用保留reason。
- 用现有Card作低强调区域，主要靠标题/分隔线/对齐组织，复用DataTable/SectionTabs/PageRegions、生产令牌和唯一确认，表单使用已装antd Form/Select/Tree/Descriptions，不新增组件库或图标。
- 表单控件有可见标签、字段错误和错误摘要；既有对象引用用选择器，新建身份系统生成，不用JSON编辑器/技术ID输入充当业务表单。变更影响说明仅明确“新版本用于后续业务，历史引用保留”，不虚构影响对象计数或新的全库影响分析。

### D-08 确认、状态、审计及事务

写入统一沿CH-2 createPlan冻结完整请求、scope/intentRevision失效、同身份重试；源访问/空间停用和移除成员采用high-impact，新增业务修订和开通采用原风险级别。取消未送出零请求，已送出不能声称撤销后端。页面状态只用七态；各来源error与forbidden分别显示，旧工程在途abort加revision guard。系统开通不伪造工程scope。

C06访问、C11修订每条命令沿原事务与审计，HTTP与页面不尝试跨模块事务或补偿删除。先开通、后工程业务修订、后空间身份及区段修订分步回执，失败重试当前步，不重做成功步。当前指针和expectedVersion均服务端事实；陈旧版本必须刷新再确认，禁止自动改版提交。无新增表、迁移、背景轮询、telemetry或本地持久业务缓存。

### D-09 发布、文件所有权与验证

精确文件清单和IP-ID见implementation-plan；所有共享exports、route seeds、HTTP catalog和正式组合由一个集成owner串行修改。保留已有五个规范路由，迁内部/project链接并保留外部别名；只抽取活的共享开通/成员表单，不保留重复旧实现。一次性demo和原型不修改。

真实验收沿已有生产dist+HTTPS Cookie+PostgreSQL的browser harness，扩展既有read-only/agent-audit-operations用例及新增工程域行为用例；不为文案/类名/路由数建静态测试。验证新读写、来源独立故障、无其它域权、成员/来源撤权、页外历史对象、陈旧并发、重放与审计故障，并覆盖原件五格式。桌面1280×720/1440×900/1920×1080各100%/200%原生缩放，复用native-zoom.mjs，不用CSS zoom替代。可选Agent预算无需模型硬期望，使用已登记的确定性夹具结果；验收材料标明合成样本待甲方复核。

## Risks / Trade-offs

- 切片表曾将CH-4标为无后端变更，但P-PJ-03/04/08所需Web窄接缝实际缺失；本包只公开原领域动作和读面，不能以CLI存在当已完成，也不扩成新投料平台。
- 管理系统身份与工程业务身份不同；复用表单优于复制页面，但必须防止无工程门禁误挡开通，以及全局账号目录泄露给工程成员。
- 接入事实跨C11/C15和监测所有者；只以明确登记关系读取，多准备有界分页，不建立第二状态机。预算校验只在获准Agent详情查看，接受一次额外合法跳转。
- 原件/历史与当前知识版本可能不同，宁可明确不可用，也不能用当前阈值补旧判定。

## Migration Plan

1. IP-01 固定公共payload/只读DTO与原Schema复用，IP-02/03补C11/C06窄接缝，IP-04贯通HTTP及正式组合。
2. IP-05统一工程导航、抽取系统开通共享表单并新增上下文/访问承载；IP-06改五页读取与接入区域，IP-07完成调用方迁移与回归取证。
3. 同版发布API/Web及组合，不重写历史、不改变部署投料。回退上一兼容软件构建，无数据降级迁移或批量清理。
4. 实现形成最终检查点后，Finalizer按实际HEAD核验和范围内修复，针对权限/事务/身份接缝最多一次限定审计，写verification；Planning止于apply-ready。

## Open Questions

无需要Implementation决定的产品或公共契约问题。现场硬件、最终合同验收及CH-9组合发布不在本包验收结论内。
