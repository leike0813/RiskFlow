## Context

- 工作包：UI 重做 CH-2。固定 base commit：`f2561cdcc0a5f9b6bfa5fec4302382e9421575ae`，起始工作区 clean；前置 CH-1 已归档为 `2026-10-19-establish-web-design-system`。
- 输入：票 07、UI 主文档、design-system、business-object-page-mapping、route-redirect、backend-change-request、dock-todo 附件；七份相关主规格及本 change delta。减负设计及施工图 `reduce-defensive-design-overhead`、`simplify-trusted-business-flows` 的当前业务入口授权／登记来源解析约束继续有效。
- `routes.ts` 实际按参数个数排序，不是附件提到的三键；`/warnings/tasks` 与 `/warnings/:warningId` 是当前真实交集。完整逐段匹配已有，只修优先级、形状冲突与别名范围。不得根据旧行号重新发明路由器。
- `components/AppShell.tsx` 是活的页面分区容器，CH-1 已纠正附件“无人使用”的判断；真正根壳为 `shell/AppShell.tsx`。本 change 保留前者。
- 单值 `shellKind` 用于门禁骨架；五个 wrapper 中 QualityPage 实际消费 ListPageShell。多数业务页自行布局。区域模型必须在现有 RiskOverviewPage 实际消费，不交付无人使用的预制组件。
- `main.tsx` 不传 capabilities；会话自省严格不含此字段。已有导航能力均有 branch，不能把“前端未知”误当“服务端未授予”。真实授予缺口是 reviewer／viewer 的 `engineering-data.source-original-read`，不是整个风险、评估或预警读面。
- 生产 ConfirmButton 使用本地状态；shared/confirmation 与 CommandConfirmationDialog 只有测试消费者。AccessPage 另有内联管理确认。ReportExportPage 当前只有预览／历史／下载，AgentProposalPanel 当前只读，本次不借统一确认新增其生成／提案执行按钮。
- 语言服务未配置（本轮 `xd://lsp status` 返回 No language servers configured）；文件／符号依据 CodeGraph 当前源码、精确搜索与只读调查。研究原文不在输入范围。

## Goals / Non-Goals

**Goals:**
- 先交付可用的目标布局、区域组合、精确路由、当前工程入口能力传递及唯一确认；运行时保留现有业务入口。
- B-6 闭合 branch→capability→角色策略→服务端投影→生产壳层，不扩大来源授权或 reviewer 的 Agent 权限。
- 业务 change 可直接复用这些接缝，接口／迁移／权限／确认决定不留给 Implementation。

**Non-Goals:**
- 不实现仪表盘新聚合、四来源待办、搜索、处置关闭状态机、子记录→任务反查及复核覆盖层，不发布六导航组合或 CH-3～CH-8 业务地址转换。
- 不新建领域记录、改评分／阈值／预算、全站换表单或清理全部页面样式；不改 Electron 宿主、依赖、锁文件、移动端和暗色切换。
- 不操作现场数据库、服务、模型或研究原件；Planning 不创建 verification、不提交／切分支。

## Decisions

### D-01 规格所有权与发布单元

七份 delta 按行为所有权：shell 拥有导航／路由／布局／确认，C06 拥有能力及角色，C09 拥有独立 HTTP 出口，四 web 仅更新横切引用；不新增近义 capability。最终六项名称、根路由和 CH-3～CH-9 切换责任写在 shell spec，不另建第二套未来导航数组、feature flag、就绪注册库或启用端点。CH-2 的生产 `WEB_NAVIGATION_V1` 仍是原七项；删除仅为固定数量服务的 `hasExactlySevenBusinessNavigation` 及其实现细节断言，不删可达性验收。

本 change 同一交付单元覆盖新能力投影、角色策略、Web 消费和确认调用方；公共接缝只有在真实生产消费与回归通过后完成。后续 change 各自在目标可用时改其 route contribution、内部链接与正文组件，并保留永久旧地址解析。SH-S02／SH-S10 是本次确立的后续发布约束，不要求本 change 实现未来正文或转换器；本次以“未提前切换”验证其边界，后续 owning change 提供正向转换证据。

### D-02 目标桌面布局直接消费 CH-1 令牌

`shell/AppShell.css` 网格列改为 `var(--nav-width)`／`var(--nav-width-compact)`、`minmax(0,1fr)` 与打开时 `var(--dock-width)`；关闭右栏时移除该列占位。AppShell 增加左栏折叠按钮，保持七项链接、可访问名称和当前项标识。折叠仅改变宽度与文字视觉呈现，不卸载导航或丢失焦点。用既有线性 Icon，不引图标依赖。

移除现有 max-width:64rem 改 13rem／右栏下沉规则。导航、主区与右栏按各自区域滚动，`min-width:0`，正文折行；对话框限制可用高度并内部滚动。只在组件短生命周期内保存左右开合，不存正文或新持久偏好。原生三种桌面外窗口与两档浏览器缩放逐项取证；不以 viewport 缩小、CSS zoom 或 deviceScaleFactor 代替真实 200%。

### D-03 有序区域组合是 JSX 结构，不是页面引擎

在现有 `shared/page-shells/PageFrame.tsx` 定义并由 index 导出：

- `PageRegionDescriptorV1`：稳定 `key` 与 `kind`；kind 为 `list|detail|form|chart|timeline|matrix-grid|tabs|run|governance|review|agent|action`，chart 必带 `variant: donut|hbars|trend|graph|matrix`，其它 kind 不带该字段。
- `PageRegionV1<T>`：descriptor 加 `content: ReactNode | ((value:T)=>ReactNode)`。没有 URL、端口、数据选择器、领域 DTO 或动作配置。
- `WebRouteContributionV1.shellKind` 替换为 `regions: readonly PageRegionDescriptorV1[]`；base、business、质量 contribution 及所有测试夹具同批迁移，不接受旧值／双类型。
- PageFrame 以 `regions: readonly PageRegionV1<T>[]` 替代 `variant/content`，保持页面唯一 h1、七态与 live region；ready 时只按序输出 owning page 提供的 JSX。页面级失败不显示旧区域；独立取数区域仍由原 PageStateView／所属状态控制。
- 五个现有 `*PageShell` 是单区域快捷组合：保留名称与单内容的便捷用途，内部输出对应单块；不是旧枚举适配器。移除 PageFrameVariantV1、WebShellKindV1、App.shellVariant 及旧 variant CSS 选择器，迁移其全部实际调用方与 exports。

`RiskOverviewPage.tsx` 用当前真实摘要／分布表格／历史投影组织 detail、list 多个区域，原取数、当前页范围、独立失败、用户续页和字段不变；不把表格为展示新枚举而换图，不引入 CH-3 的统计和新内容。QualityPage 改消费新 ListPageShell。其余自行布局页本次只迁 route 元数据，不全量套新 Frame，避免重复 h1 与跨页 DOM 依赖。

### D-04 路由注册一次计算，解析只比较已匹配候选

复用 `createWebRouteRegistry`、`matchTemplate` 与现有 resolution 联合，不新增路由库。注册时预解析段数组并检查相同静态形状（参数段规范化为同一占位）；只允许已有同 routeId、同 path 的 base contribution 精确替换。未知重复 ID／路径及形状冲突都拒绝。

resolve 完整逐段匹配候选后，首个差异段 static 胜 parameter；不以总参数数、字典序或注册顺序裁决实际交集。不每次导航重新复制排序整个注册表。现有 `/warnings/tasks` 必须到任务列表；附件 `/warnings/:warningId/actions` 仅作独立注册表边界用例，不向生产添加该路由。

保留三条简单别名前缀接缝，但只在转换后的完整路径匹配当前注册模板、且源前缀在已知模板清单内时产生 redirect；未知旧后缀直接 not-found。目标未注入（例如独立测试注册表缺 quality contribution）不先重定向到不存在页面。根 `/` 保留 search 并 replace 至 overview；简单别名保留 search 和编码后的路径身份，禁止别名链／循环。`applyWebPathAliasV1` 若需 registry 参数即更新所有调用方，不保留无验证旧签名。CH-2 不增加对象转换或双版本解析 helper；任务／子记录／复核版本与独立行动规则由 shell spec 给后续 change 约束。

### D-05 聚合入口授予与已证实读面缺口

`packages/contracts/src/ports/index.ts` 新增 capability `review-todo.read` 和同名 ModuleBranch 映射。它是聚合入口的资格，不是可执行查询 DTO；CH-2 不登记 HTTP 聚合 route、OpenAPI 操作、返回空列表或 no-op port。CH-9 才提供真实聚合端口及 handler。现有 `agent-task.read` 保持。

| 角色 | review-todo.read | source-original-read 的变化 | 其他变化 |
|---|---|---|---|
| system-administrator | 无，分支集仍空 | 无 | 独立管理身份不变 |
| project-risk-manager | 由 allBranches 取得 | 已有，不改 | 原全部业务能力 |
| reviewer | 新授予 | 补齐现有资料读能力下的原件分支 | 不增任何 agent-task 分支 |
| field-responder | 新授予 | 不新增：无资料目录入口，不借 UI 补授资料路径 | 原执行／反馈写权不变 |
| business-viewer | 新授予 | 补齐现有资料读能力下的原件分支 | 不新增任何写权 |

资料原件仍逐次检查空间和 source grant；目录可见不等于来源可见。`projection.report-read` 不给 reviewer（不是本次缺口），`knowledge-modeling.retrieval-result` 的 viewer 既有 branch 不改；浏览器拒绝由真实来源权限判断，不从旧用例标题推翻策略。不得加入更多“为导航方便”的写权或检索权。

### D-06 策略升版保全历史，不重写旧数据

新授予使用 `access-policy/v2`、`{entityId:'access-policy',versionId:'v2'}`；现有 `ACCESS_POLICY_VERSION`／`ACCESS_POLICY_REF_V1` 的后缀 V1 表示现有引用接口，调用方结构不改。策略不能在相同身份下静默加权限。旧 v1 行、授权快照与审计完全不改。

`currentProjectManagerActor` 和 `readDeploymentAuthorizationSource` 的“必须等于当前版本”检查改成识别已登记 v1／v2 策略身份，用于解析旧主体／资源范围；管理动作仍按当前账号、成员与 `isBranchAllowed` 检查，历史范围仍走当前 `authorizeBusinessAction`，不能把旧策略身份当放行。未知策略身份拒绝。`authorizeBusinessAction` 复用旧快照只用于登记关联，不以旧 grantedCapabilities 扩权；新独立决定记录 v2，原快照不原地刷新。

无新角色、表、数据库枚举或迁移；现有角色和 authorization_contexts 能保存新引用。必须增加旧 v1 历史来源读取、新 v2 授予、当前撤权及旧管理引用的集成行为验证。比起迁移改写全库或让旧报告全部失效，保留受控历史策略身份解析符合原登记事实契约；这不是旧接口 shim。

### D-07 独立当前工程入口能力读面

不改 `SessionMetadataV1`、登录／改密／自省响应；不从授权上下文单元素 grantedCapabilities 拼全量能力，不逐 branch 探测，不读取他人管理目录。

公共响应 `ProjectAccessPresentationV1Schema` 定义于 contracts/ports 唯一导出：严格对象 `{schemaVersion:'1', projectId: Identifier, capabilities: readonly ModuleCapabilityV1[], authorizationPolicyRef: VersionReference}`；能力去重排序、长度上限为当前闭合枚举长度，无 scopes、source grants、roles、token 或 AuthorizationContext。此集合表示角色级入口资格，不表示任何具体对象可读。

C06 schema/service 增加独立 `ProjectAccessPresentationPortV1.read`，内部请求 `{requestId,requestedAt,sessionToken,projectId}`；token 只由 HTTP 从 Cookie 注入。adapter 在短事务中复用 `authenticateSession`／当前账号、工程和当前成员查询及现有 `branchesForRoles/capabilitiesForBranches`，拒绝 restricted／暂停／非成员，按既有会话规则 touch 和记录安全访问；不新建业务命令收据或授权上下文。失败用原 AccessServiceError，审计失败不成功。
该独立 port 由 `PostgresLocalIdentityAccess.projectAccessPresentation` 返回，复用同一连接／时钟；不在 LocalIdentityAccessV1 强加新方法令全部既有 mock 补假实现。部署 `createDeploymentApiPortsV1` 从 options.access.projectAccessPresentation 注入，并把其 read 纳入现有装配期必需项；缺真实实现就拒绝生产装配，不降级为空能力。

C09 `ApiPortsV1.projectAccessPresentation` 独立可选注入，注册 `GET /api/v1/projects/:projectId/access`、operationId `project-access.read`；没有 query/body 参数，未知查询参数／伪造字段失败。没有注入则 route/OpenAPI 均不激活，客户端显示接缝不可用而非假空能力。不是六领域业务 branch，不要求先有某个域读能力；活跃工程成员即能读取自身入口资格。响应直接按 contracts schema 校验，HTTP 复用原 Cookie、错误、头与禁止缓存策略。

部署组合 `scripts/deployment/composition/api-ports.mjs` 与正式浏览器 server 注入真实 C06 实现；C09 client 在现有 http.ts 增加专用读取方法，不注册成通用任意 URL 查询器。

### D-08 能力到壳层及停靠的有界传递

`main.tsx` 在有效非受限会话且选择工程时，按 session identity／工程／context revision 发一个能力读取；复用 request revision guard，切工程／注销清空并 abort。路由切换与页面重新获得前台焦点时更新一次（合并同代在途请求），不周期性轮询、不阻塞会话恢复、不要求 project revision 才能读取入口资格。

状态为 `checking|ready|failed` 的短生命周期呈现，只有 ready 传 Set 给 App.capabilities；失败显式安全原因及重试，能力未知不得被当空能力或管理员。当前已有业务 contribution 不增加跨域组合门禁：不把所有 requiredViewCapability:null 改为域权交集，也不因投影故障关闭原合法深链；业务页仍由原查询授权。无工程清空业务资格，但系统管理读取仍独立。

RightDock 复用原状态与渲染，改为有序且按入口资格筛选的贡献列表：现阶段仅 context 与 agent；允许已登记 todo key 的所属贡献由 CH-9 注入，但本次不提供其正文、按钮或计数。共用独立权限判定：todo→review-todo.read、agent→agent-task.read，context 仍沿获准证据槽。未取得能力时不启动 Agent 读取／刷新，ready 且被拒绝不展示该 Agent 页签或关联；有权但技术不可用保留原因。当前 context 证据不因 agent 被拒绝而丢失，最终仅 todo／agent 组合由 CH-9 替换贡献集合。

`AgentTaskProvider` 由同一资格驱动是否发起 list/detail 等新读取，保持一个 provider 与原任务选择；业务页切换不复制会话，权限被拒／工程变化／注销清除相应任务事实。reviewer 的旧复核入口、精确详情与原动作不依赖 Agent provider 成功。管理辅助入口在 CH-9 组合启用前不另新增用户菜单；当前管理深链和业务权限继续分离。

### D-09 唯一确认控制器与触发组件

采用已存在 `createConfirmationController` 和 `CommandConfirmationDialog`，不在每个调用处复制控制器，也不新增全局命令中心。`ConfirmButton` 保留为真实“触发按钮＋现有控制器＋唯一 Dialog”组合组件，删除其本地确认／提交／错误／焦点状态及重复四值 availability 类型。**接口一次切换**，不保留 summary/resetKey/onConfirm 旧协议：

- props：`label`、可选 `tone`、`availability: WebActionAvailabilityV1`、`createPlan(): CommandConfirmationPlanV1<TRequest>`、`submit(plan): Promise<CommandConfirmationResultV1>`、`scope`（当前 project 或 system）、`intentRevision`（调用方在输入变更时更新）、可选 `onSucceeded(result)`。
- 点击仅在 allowed 时构造计划一次；计划保存原完整传输信封。scope、当前 pathname 和 intentRevision 变化使计划失效。组件仅桥接 React 刷新，控制器仍是唯一状态机。
- `CommandConfirmationPlanV1` 删除独立必填 projectId（与 scope 重复且会让系统管理伪造工程）；scope 为 `{kind:'project',projectId,contextRevision,sessionRef}` 或 `{kind:'system',accountRef,sessionRef}`，引用均使用原 VersionReference。project/contextRevision 从既有 useEngineering.context 取，session/account 从 useSession.metadata 取，checking／匿名／受限时 scope 无效；system 还要求原 readSystemIdentity.isSystemAdministrator。未选择工程不影响 system scope，不伪造服务端管理授权引用。
- `invalidateConfirmation` 和 controller.invalidate 一次改为只接受 `currentScope: CommandConfirmationScopeV1 | undefined` 并比较相应判别字段；pathname／intentRevision 变化由触发组件取消未提交计划或明确失效在途计划，不再重复传 context 与 project 摘要。不新增会话／工程 Provider，也不生成第二套认证代次。
- operationId 继续用已有 HTTP 有限操作标识；所需能力不局限 ModuleCapability：改为判别 `permission: {kind:'business',capability}|{kind:'system',action}`，系统 action 引用原六项值。Dialog 不把系统权限显示为 agent-task.read。管理 action 不是新业务能力。
- `shared/actions.ts` 为权限描述定义唯一 `WebActionPermissionV1`（上述 business/system 联合）。WebActionAvailabilityV1 增加 `hidden`；forbidden 的 requiredCapability 改为 requiredPermission。deriveActionAvailability 的参数同步改为 requiredPermission，permission 状态增加 hidden 且优先返回 hidden；其余 checking／blocked／unavailable／allowed 行为保持。actionDisabledReason 按业务 capability 或系统 action 给出安全说明。PageFrame／ConfirmButton 对 hidden 完全不渲染，不以 disabled 透露目标；七态 PageLoadState 的 requiredCapability 是页面读取契约，不作此重命名。
- request 是所属调用方构造的已定型对象，确认时一次 `structuredClone` 拍快照并递归冻结 plain JSON；targets/inputVersions 等同时快照，避免现有浅 Object.freeze 让嵌套请求可变。控制器不调用任意字段转换或重新算 payload。

控制器修复既有三个缺口：retryable-failure 也参加 invalidation；所有 async 完成按本次计划 generation 校验，cancel/invalidate/unmount 后迟到成功不得覆盖后来状态；提交中双击与重试共用单 in-flight，失效后不能在旧请求仍在途时交错发第二条。取消未提交零请求，已提交不能宣称撤销后端事实。STALE_VERSION／幂等冲突终止原计划，不换版本重试。

Dialog 保留原生模态、取消首焦点、focus trap、Escape、触发点恢复；删除 showModal 异常时仅 setAttribute(open) 的非模态回退，真实浏览器失败必须暴露，不把焦点约束绕掉。错误保留独立 --error 令牌、role=alert 和 aria-describedby；只展示安全摘要。若触发点卸载，恢复合法主标题，不把焦点落在隐藏控件。ConfirmButton.css 删除重复 overlay/dialog 样式，保留按钮；新增 shared/CommandConfirmationDialog.css 承接唯一弹窗视觉，不改确认 payload 为了采用 AntD。

### D-10 全部实际写入口同批迁移

业务请求必须由所属 API 层公开构造完整信封／调用身份，并由 submit 消费冻结 request；不能在 onConfirm 闭包里重新读表单或生成 commandId。复用 `api/client.ts` 既有 submitCommand 的 envelope 组装，提取其纯请求构造步骤用于打开确认时调用，提交只发送该对象；管理命令同理复用原 C37 客户端。

唯一业务请求接缝固定为 `prepareCommand({projectId,branch,payload,commandId?,spatialScopeRefs?,sourceVersionRefs?}) -> PreparedCommandV1` 与 `sendPreparedCommand(prepared, signal?) -> Promise<unknown>`。PreparedCommandV1 只含原 projectId／branch 和原 CommandEnvelope；prepare 在打开确认时生成 issuedAt、commandId／幂等键并解析当时 assessmentSources，send 只发送已冻结 envelope。原 postCommand／submitCommand／freezeCommandEnvelope／discardFrozenCommand 及 frozenCommands 全局缓存移除，迁移所有消费者，不留双协议；错误映射与 unwrapQueryResult 复用。operations.ts 中原写 helper 分离纯 prepare 与原 result decoder，页面不复制 DTO／payload 字段。管理 API 复用其原 administrationCommand 构造规则，在打开确认时完成 request；六个现有提交函数只消费该冻结 request，不重新读取页面字段。

批量确认结果在现有 CommandConfirmationResultV1 增加本地 `batch-result` 分支，含逐 commandId 的原成功引用或安全错误，不作为 HTTP DTO；全部完成返回各项结果，部分失败只重试失败项的原 envelope，不再提交已成功项。不改变服务端单条决定、幂等或事务边界。

| 调用组 | 固定处理 |
|---|---|
| WarningDetailPage | 精确预警／任务，原确认分支；不关闭任务 |
| StartAssessmentPage／AssessmentRunPage | 启动／继续准备的原冻结引用与 state version；不启动新运行替代重试 |
| RecommendationDetailPage／ExecutionRegisterPage／CalibrationDetailPage | 采纳／拒绝、两种执行来源、反馈、整体校准；原精确引用及副作用不变 |
| ReviewDetailPage／ReviewQueuePage | 每类原联合决定、识别修正候选、陈旧状态；批量仍逐项独立命令和身份，high-impact 确认覆盖明确选择集合，不新增 bulk API |
| agent/agentShared.AgentLaunchPanel | 原冻结启动定义；任务／提案正文仍由原拥有方；不把只读 AgentProposalPanel 变成新写入口 |
| ReportExportPage | 已核实只有预览／历史／下载：本次保护原只读行为，不新建报告生成命令或确认 UI |
| ops/AccessPage | 删除 Intent 确认／acknowledged／submitting／retryIntent 第二套状态，六项原管理命令都用 system scope 和原回执；普通表单 draft／目录状态继续属于页面 |

上述表按实际文件逐项排查，所有已存在写入口都迁，不能仅统计 ConfirmButton 标签。没有真实 handler 的动作不因本 change 新增 handler。高影响为原管理停用／重置／暂停及现有批量复核；其余既有业务操作 standard，不能因 danger 色推断影响级别。

管理创建／重置密码不进入摘要、目标、inputVersions、日志或持久缓存。仅在提交所需的非渲染请求快照中暂存原输入，重试原快照不要求重输新密码；关闭、失效或成功释放快照并清空输入，不把密码列入 fingerprint 或可见失败。批量复核只冻结所选完整命令数组，各项按原幂等和事务执行；部分失败保留原逐项结果，不把成功项重造身份重提。

### D-11 状态、审计与事务不另建机制

不增加数据库状态机、表、迁移、后台动作、遥测或缓存。能力查询复用 C06 真实访问日志／会话事务；新授权记录用 v2，旧数据不改。确认层短生命周期计划不持久化；领域命令、幂等收据、安全／业务审计与 Outbox 继续由原模块事务完成。任何 UI 能力集合、历史 snapshot、URL 或 Agent 引用都不是新的授权凭证。

当前身份查询、能力投影的失败与业务查询失败分别呈现，不用空数组吞异常；未知错误沿现有安全 C09 error，不显示原始 request、秘密或模型正文。RI-S6／RI-S14、RA-S1～RA-S7 的证据、精确版本、人工边界保持。

### D-12 文件所有权、验证与升级

全部允许文件按 implementation-plan 的 IP-01～IP-07 固定；同一文件仅由集成 owner 串行编辑。新依赖／新表／新领域命令／改来源授权或业务目标转换需升级，不由 Implementation 补设计。只读调查不是实现证据。

扩展既有 routing、confirmation、SSR、core/access、auth adapter、HTTP 和正式浏览器用例，测试实际权限、深链、旧快照、嵌套载荷、状态转换和取消／重试；删除只锁定七个标签／五枚举／类名／完整文案的断言，不重新 pin。浏览器必须跑正式 dist＋真实 HTTP／PostgreSQL，不接受关键 skip。原生桌面缩放取证复用 CH-1 方法，不建永久截图基准或 source-text 静态测试。

权限变更、策略历史及确认状态机触发本轮最多一次限定审计，结论进入同一 verification。最终 main 全量门禁／归档由后续角色按项目流程执行，本轮只到 apply-ready。

## Risks / Trade-offs

- 统一确认跨多个既有领域页面，但只改变确认承载与请求冻结时点；若遗漏管理路径，唯一确认不成立。报告页目前只读，不借本次扩大写能力。文件清单与真实写请求回归必须逐项完成。
- 入口能力是角色级资格，不能证明资料／对象权限；前端不得用它替代来源裁剪或交叉域资格，也不能因投影故障撤掉原合法业务页。
- v1 历史策略只准恢复登记范围，不代表当前授权；升 v2 若只改常量会误伤历史报告，故历史解析及撤权必须一起验证。
- 152px 左栏可能增加标签折行，200% 时内容需更多滚动；接受滚动，不压缩字体或隐藏原入口。
- 设计附件部分代码描述已经漂移；本 design 的已核实事实优先，不修改一次性原型来凑验收。

## Migration Plan

1. IP-01 先冻结能力／投影 DTO 与 v2 策略，IP-02 贯通真实 adapter／HTTP／部署和 Web；无数据库迁移。
2. IP-03／IP-04 分别改路由与区域、布局及停靠贡献，保持现有七入口和业务地址。
3. IP-05 修复唯一确认控制器／Dialog；IP-06 同批迁移全部实际调用方和 API 请求构造，删除旧协议及重复确认状态。
4. IP-07 完成相关回归、原生缩放、一次限定审计和真实证据，再由 Finalizer 创建 verification。不得修改旧 CH-1 verification 来掩盖新承接。
5. 发布回退使用上一软件构建与原部署流程；本 change 无数据回写／销毁或降级迁移。CH-3～CH-9 后续依照 D-01 逐项原子切换，不保留第二套业务页面。

## Open Questions

无影响接口、权限、依赖、状态或施工范围的未决问题。后续业务 change 的具体数据投影和地址解析实现按其所有权另行规划，不是本 change 的实施空白。
