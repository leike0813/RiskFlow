# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`f2561cdcc0a5f9b6bfa5fec4302382e9421575ae`。规划开始时主工作区 clean；本 change 不包含继承生产叠加层。apply 前核对基线及实际源码漂移，不能把后续 main 新内容当同一施工图。
- change：`prepare-web-shell-route-and-access-seams`；实际 schema `orchestrated-delivery`；applyRequires 为 proposal、specs、design、implementation-plan、tasks。Planning 只完成此闭包，verification 留给实现后验收。
- 权威输入：本 proposal、七份 delta、design D-01～D-12、已归档 CH-1 与主规格；票 07 和其附件仅为已裁决 planning 输入。代码已核实事实见 design Context，不复制附件旧代码结论。
- 直接依赖：已归档 `establish-web-design-system`；AntD／ECharts／React Router 与现有运行依赖版本均不变。没有 install、锁文件、数据库迁移或 Electron 宿主修改。
- 执行顺序：IP-01 → IP-02；IP-03／IP-04 在共同 route 类型处串行整合；IP-05 → IP-06；IP-07 最终合流。IP-02／IP-04 共改 main／App／dock 时由同一集成 writer 串行编辑。
- 不提交 Git、不启动开发服务器、不接现场服务。真实浏览器 harness 启动的是既有正式构建及隔离测试 API／数据库，不是开发服务。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts/ports 的 ModuleCapabilityV1_VALUES、MODULE_BRANCH_CAPABILITY_V1；core/access/policy 的 branchesForRoles、capabilitiesForBranches、ACCESS_POLICY_REF_V1 | 新入口位及 v2 当前策略；独立入口投影 DTO 和服务 port | 不复制角色镜像、领域 schema 或来源权限 |
| IP-02 | auth adapter 的 authenticateSession、touchSession、queryProject、currentProjectManagerActor、readDeploymentAuthorizationSource；ApiPortsV1、buildApi、createC09Client、createDeploymentApiPortsV1 | 当前工程能力读取、历史策略解析、正式 HTTP 和主入口消费 | 不把历史快照或能力呈现当授权；不改 session shape |
| IP-03 | createWebRouteRegistry、matchTemplate、resolveWebRoute、applyWebPathAliasV1、PageFrame、五个 PageShell、RiskOverviewPage、QualityPage | 注册期段描述／形状冲突、精确匹配；区域数组取代单值元数据并真实消费 | 不新增路由器、业务转换器、页面引擎或仪表盘聚合 |
| IP-04 | shell/AppShell、WEB_NAVIGATION_V1、RightDock、AgentTaskProvider、useAgentDockContribution、生产尺寸令牌 | 折叠布局、独立贡献判权、复用唯一 Agent provider | 不复制任务／会话／证据；不提前移除七入口 |
| IP-05 | shared/actions、createConfirmationController、invalidateConfirmation、CommandConfirmationDialog、ConfirmButton | 唯一可用性、冻结计划、原生模态与触发组件 | 不保留本地第二确认状态机，不生成领域命令 |
| IP-06 | api/client 的 CommandEnvelope／postRaw／unwrapQueryResult；operations 写 helper；agentAuditOperations.administrationCommand；原业务／管理页 | 在确认打开时构造完整请求，提交只发快照；所有既有写入口同批迁移 | 不重复 DTO、临时生成授权／引用或新增报告／提案写入口 |
| IP-07 | 现有 Vitest／Playwright／PostgreSQL harness、CH-1 原生缩放证据方法 | 稳定行为回归、真实表面操作、一次限定审计 | 不把原型、截图非空、跳过或旧证据计为本次通过 |

上表短路径分别以 `packages/` 或 `apps/web/src/` 为上下文；第 7 节给出精确文件集合。

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1～1.2 | AC-R1／AC-R2；AC-S01～08 | contracts/ports、core/access/schema/service/policy/index | 增 review-todo.read 枚举／同名分支、唯一 ProjectAccessPresentationV1Schema、独立 ProjectAccessPresentationPortV1；四工程角色入口权、reviewer/viewer 原件分支；当前 v2 策略与历史识别 | sysadmin 空业务权、reviewer 无 Agent、域写权、source grants、session DTO |
| IP-02 | 2.1～2.3 | AC-R2、HT-R1；AC-S04～08、HT-S01～02 | postgres-local-identity-access、auth/index；api/app/http；deployment composition；web/http/main/App | 真实 `.projectAccessPresentation.read`，GET access 和 OpenAPI 条件登记，部署必需接线；v1 快照可解析但仍检查当前权限；有界前端请求与 Set 传递 | token 不出服务端、无能力伪回退、无新业务授权上下文、旧审计不改 |
| IP-03 | 3.1～3.3 | shell 精确路由／区域组合；SH-S03／07～10；四 web 区域引用 | routes、business-routes、App、PageFrame／PageShells、QualityPage、RiskOverviewPage | 逐段静态优先／形状拒绝；别名完整模板验证；shellKind/variant 清除；生产多区域组合 | 现有路径、查询、七态、原分布表、独立失败与投影续页 |
| IP-04 | 4.1～4.2 | shell 导航／上下文／停靠／焦点；SH-S01～02／04／06、UI-S01～03 | navigation、AppShell TSX/CSS、RightDock、AgentTaskProvider、AgentDock、main/App | 152/48/22rem、显式折叠、当前七入口；贡献列表独立判权，未知能力不启动 Agent 读取，已有证据不丢失 | 不发布新 todo 正文、不撤旧复核、不加六导航 flag；唯一任务、确认和来源权 |
| IP-05 | 5.1～5.2 | shell 统一确认／权限态／焦点；SH-S05、原确认全部场景 | actions、confirmation、CommandConfirmationDialog TSX/新 CSS、ConfirmButton TSX/CSS、index | 无旧协议的统一权限描述、hidden、唯一状态机与 Dialog；快照／失效／迟到响应和安全错误 | 精确请求、无权不提交、取消零命令、原生模态、system 不伪造工程 |
| IP-06 | 6.1～6.3 | 同统一确认；UI-S01～03；原命令行为 | client、operations、agentAuditOperations、9 个业务页、agentShared、ops/AccessPage | prepareCommand/sendPreparedCommand；原 result decoder；输入变化新身份；六管理及逐项批量确认同源；删旧全局 frozenCommands／双协议 | 原业务 branch、幂等、事务、结果／部分失败、原风险／校准决定，不新增写能力 |
| IP-07 | 7.1～7.3 | 全部 delta 与原行为回归 | 第 6／7 节测试、当前 change 工件及 evidence | 跑有界回归、正式 browser、原生缩放、记录失败／未执行；实现后 verification 与一次限定审计 | 不提前写 PASS、主规格同步／归档不由 Planning 执行 |

## 4. 调用与副作用顺序

### 4.1 当前能力与历史授权（IP-01／02／04）

Cookie 会话 → 原账号／restricted 检查 → 目标工程 active 与当前 membership → 服务端角色并集／capability 映射 → 只读投影严格 Schema → 原安全访问审计／会话 touch 提交 → HTTP 响应 → 当前 request revision 接受 → App／dock 入口呈现。无权不列角色／来源／对象；技术失败结束 loading 并可重试。审计失败事务失败，不生成 command receipt。能力请求单在途，切工程／注销中止且忽略迟到响应。

旧结果精确引用 → 原登记授权快照解析 v1／v2 身份及冻结来源 → 既有当前 authorizeBusinessAction → 原有界正文读取。拒绝未知策略、撤权与来源越界；不靠旧 grantedCapabilities 直接返回正文。新独立决定标记 v2；不更新历史行。管理旧引用通过当前账号／成员／动作检查，不因版本读取变化失去合法管理能力。

### 4.2 路由与区域（IP-03／04）

注册 contribution → base 精确替换判定 → 相同静态形状冲突检测 → 保存段描述。解析安全完整路径 → 已知别名完整目标核对／必要 replace → 完整逐段匹配 → 真实相交候选首差异段静态优先 → 原工程与路由门禁 → PageFrame 七态／按序区域 JSX。未知后缀、未注入目标及非法路径统一 not-found。仅简单别名透传 search；后续对象转换本次不执行。

左／右折叠只改变布局和可聚焦集合。context revision 切换仍由原 reducer 原子清空页面；Agent 资格失效停止原轮询并清事实，普通路由变化仍共享原任务。reviewer 复核不等 Agent 读取成功。

### 4.3 确认与命令（IP-05／06）

所属页当前输入与真实 availability → allowed 点击 → prepare 原命令身份／精确版本／完整 envelope → 创建结构化计划并快照 → 取消首焦点的唯一 Dialog → 必要 high-impact acknowledge → 提交冻结 envelope → 原 HTTP／当前授权／领域事务／收据／审计／Outbox → 原 result decoder → 仅当前计划 generation 接受结果。取消前零命令，重复点击最多一条在途，响应丢失只发原字节载荷；改输入新身份并重新确认。路由／scope／认证／intent 变化失效 reviewing 和 retryable-failure；已发送事实不能被 UI 宣称撤销，迟到结果不得刷新新页面。

batch 冻结逐项 command 数组，沿原逐项事务执行，保留成功／失败；重试只发送失败项原 envelope，不重造成功项身份。不新增服务器 bulk 事务。system 只用 account/session 身份和六项原 action，口令只在非渲染请求快照内，关闭／失效／成功释放；不缓存到全局 Map、日志或摘要。

## 5. Schema、状态与持久化落实

| 项目 | IP-ID | 落实位置／边界 |
|---|---|---|
| 能力／分支／响应 SSOT | IP-01 | contracts/ports；新响应用原 Identifier／VersionReference／ModuleCapability Schema，数组有界且去重排序 |
| 当前入口请求与服务 port | IP-01／02 | core/access/schema/service；adapter 独立属性返回 port，不改变所有 LocalIdentityAccessV1 mock 的必需接口 |
| 策略版本 | IP-01／02 | 当前 v2；历史 v1／v2 只作已登记主体／范围解析，所有新动作当前判权；不改旧 authorization_contexts 或审计 |
| HTTP | IP-02 | GET `/api/v1/projects/:projectId/access`，`project-access.read`；单独注入、无业务分支前置、无 body/query、Cookie／同源／no-store／原错误 |
| 前端能力 | IP-02／04 | 短生命周期 checking/ready/failed，不保存 token 或角色镜像；Set 只在 ready 传递，不因失败注入空 Set |
| 区域模型 | IP-03 | PageRegionDescriptorV1／PageRegionV1；直接 JSX，无 DTO／路由／查询解释器；移除旧 shellKind／variant 兼容字段 |
| 确认状态 | IP-05 | 原六态复用；retryable-failure 纳入失效，计划 generation 与 in-flight 互斥，permission business/system 与 hidden 完整 |
| 请求身份 | IP-06 | 打开确认一次 prepare；重试原 request，输入改变新 request；移除旧全局 frozenCommands 及 postCommand/submitCommand 协议 |
| 数据库／事务／迁移 | IP-02／06 | 无新表或迁移；投影只读事务＋原安全审计；领域命令完全沿原事务和幂等收据，历史不改写 |
| 依赖／宿主 | IP-07 | 无新增直接或传递依赖、lock 变化或 Electron 入口变更 |

## 6. 验收证据矩阵

命令编号只是下表复用缩写，不是新增脚本或未实现命令。均在仓库根执行。先完成全部变更再统一运行；不得实施中反复跑整仓 build/lint/format。

| 编号 | 已存在可运行命令 |
|---|---|
| C-01 | `pnpm exec vitest run packages/contracts/test packages/core/test/access.test.ts` |
| C-02 | `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs` |
| C-03 | `pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/business-routes.test.ts apps/web/test/ssr-shells.test.tsx apps/web/test/quality.test.tsx` |
| C-04 | `pnpm exec vitest run apps/web/test/confirmation.test.ts apps/web/test/design-system.test.tsx apps/web/test/api-client-openapi.test.ts apps/web/test/focus.test.ts` |
| C-05 | `pnpm build` |
| C-06 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts apps/web/test/browser/quality.spec.ts` |
| C-07 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy` |
| C-08 | `openspec validate prepare-web-shell-route-and-access-seams --strict --no-interactive`；`openspec instructions apply --change prepare-web-shell-route-and-access-seams --json` |

C-02／06 需已有容器运行环境、真实 PostgreSQL／Chromium；环境缺失明确失败，不能关键 skip。构建内存若重现 CH-1 的默认堆 OOM，可以原记录方式仅对该次命令设 `NODE_OPTIONS=--max-old-space-size=8192`，不改 package script 或降低门禁。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| shell「按承载就绪分阶段启用六导航」全部：SH-S01／02、七项导航与路由一一对应、未交付根页面不伪装业务能力、未登记路径安全失败 | IP-03／04／07 | business-routes、routing-context-actions；browser 五份 | 生产当前七入口，base 缺贡献测试；已登记历史正文 | 旧队列／矩阵／处置深链仍读原对象，未知路径不转对象；CH-2 无未来业务重定向。SH-S02 正向组合归 CH-9，不以本次 PASS 代替 | C-03／05／06／08 |
| shell「工程空间工序上下文必须原子切换」全部：切换工程清除旧内容、切换空间或工序保持页面、无工程上下文时阻止业务页面读取 | IP-02／04／07 | routing-context-actions；browser read-only／assessment-warning-response／agent-audit-operations | 两工程、延迟旧响应、无工程会话 | 清页面／能力／Agent 事实，pathname 与新 revision 正确，无空工程请求或旧正文闪现；管理员无工程仍可管理 | C-03／06 |
| shell「页面区域组合必须共享有限视图状态」全部：SH-S03、加载不闪烁为空态、空态只给真实下一步、技术异常只显示安全摘要 | IP-03／07 | ssr-shells、quality；browser assessment-warning-response／quality | RiskOverviewPage 的原三来源各自成功／空／失败；原历史查询引用 | 页面多区域次序／单 h1、七态；独立失败不冒充总量、续页只用户触发，原记录身份与历史版本不变 | C-03／06 |
| shell「右侧停靠区必须按独立权限组合所属贡献」全部：SH-S04、跨页面保持停靠状态、无资料正文权限的证据脱敏、未接入 Agent 功能、Agent 只展示获准的可审计内容；既有空证据下打开Agent回归 | IP-02／04／07 | ssr-shells；browser read-only／agent-audit-operations／identification-review | 有 todo 无 Agent、有 Agent 无 todo 的受控能力输入；真实 reviewer／manager；受限 source | 单位入口权不成交集；当前只 context/agent 正文，未交付 todo 无按钮计数；reviewer 复核正常且无 Agent 引用；原共享任务／脱敏保持 | C-03／06 |
| shell「写命令必须经过统一确认原语」全部：普通命令确认后提交一次、高影响命令要求显式二次确认、无权限确认卡不可提交、陈旧版本确认失败、无工程的系统管理确认、SH-S05 | IP-05／06／07 | confirmation、design-system；browser identification-review／assessment-warning-response／agent-audit-operations | 嵌套 payload、真正丢失 HTTP 响应、迟到 deferred、批量部分成功、六项管理与真实旧版本 | 原 envelope 字节重试；取消零写、嵌套源对象修改不改快照、失效后不可重试、迟到不改新状态；高影响多一步；部分批量不重提成功项；系统无伪工程／假能力，口令不出摘要 | C-04／06 |
| shell「键盘和焦点行为必须可预测」全部：键盘完成导航、停靠区键盘操作、确认对话框焦点收口、SH-S06 | IP-04／05／07 | focus、ssr-shells；browser agent-audit-operations；本 change evidence/native-zoom | 正式 dist，原生 1280×720、1440×900、1920×1080 × 100%/200% | Tab/Enter/方向键/Home/End/Escape；左右栏手动折叠，实际横向滚动、焦点可见、取消恢复；非模态回退不当成功 | C-04／05／06＋下文原生操作 |
| SH-R1 全部：SH-S07／08／09／10 | IP-03／07 | business-routes、routing-context-actions；browser assessment-warning-response | 生产 tasks 静态交集；两种注册顺序；参数异名同形；已知别名查询、未注入 quality、编码 ID | abc/actions 与 tasks/actions 各有正确解释，注册歧义拒绝，base 替换可用；未知旧后缀不 redirect；查询与已有独立版本保留。SH-S10 新业务转换的正向证据属 CH-7，CH-2 保留旧行为 | C-03／06／08 |
| AC-R1 全部：AC-S01／02／03／07／08 | IP-01／02／07 | core/access；auth adapter；browser read-only／identification-review／assessment-warning-response | 五角色＋叠加、两工程、原件共享/指定、原 v1 快照与 v2 新决定 | role 能力精确增量符合 D-05；无 Agent／业务写扩权；聚合无 HTTP 成功假接口；原件字节对应精确版本，来源拒权；历史范围可解析而当前撤权拒绝 | C-01／02／06 |
| AC-R2 全部：AC-S04／05／06 | IP-02／04／07 | auth adapter、HTTP shell、api-client-openapi；browser read-only／agent-audit-operations | 有效／restricted／失效 Cookie、暂停／移除成员、延迟工程 A 响应、技术失败 | 当前工程返回真实能力／策略；session 原 shape；新请求拒权，迟到无效；500 不当空能力／匿名／管理员，失败可重试 | C-02／04／06 |
| HT-R1 全部：HT-S01／02 | IP-01／02／07 | HTTP shell、api-client-openapi、deployment api-ports | 真实 port／未注入、伪 actor/能力 query、坏结果、无 Cookie、他工程 | 路由与 OpenAPI 只随真实注入出现；严格请求／结果、no-store，伪造被拒、无 token/授权上下文，服务不可用不伪成功 | C-01／02／04／06 |
| engineering「空、加载、异常、权限四类骨架行为必须逐页一致」全部：无权访问知识页面、查询失败可重试；「浏览器验收必须使用真实浏览器与正式接缝」全部：真实浏览器完成只读链路、环境不可用明确失败 | IP-03／04／07 | ssr-shells；browser read-only | 正式环境／当前 source grants | 原工程／知识事实、真实重试、定位脱敏和链接不变；不以导航更名取消路径，环境错误非零 | C-03／05／06 |
| identification「空、加载、异常、权限四类骨架行为必须逐页一致」全部：无权访问识别页面、查询失败可重试、UI-S01 | IP-03／04／06／07 | browser identification-review；ssr-shells | reviewer 无 Agent，历史精确复核、原五类决定夹具 | 旧队列及直接详情可读，原联合决定／修正候选／幂等保持，技术错误可重试 | C-03／04／06 |
| assessment「C34 页面必须复用 v2 设计并只展示真实事实」全部：真实数据与页面可达、工程切换与失败、UI-S02 | IP-03／04／06／07 | browser assessment-warning-response | 历史矩阵、原执行及独立行动、角色源权限 | P/C／矩阵精确配置与原命令不改，全部旧入口保留，迟到不污染，无假统计／闭环状态 | C-03／04／06 |
| operations「C35 页面必须复用 v2 设计并保持既有应用接线」全部：已接通页面与 v2 分区一致、刷新切换与服务异常、UI-S03 | IP-02／04／05／06／07 | browser agent-audit-operations | 真实身份、已有任务／复核、历史报告与 sysadmin 无工程 | Agent 仍单 provider；reviewer 无 Agent 可复核；管理员六动作当前校验；报告仍只读预览下载，不新增生成按钮 | C-02／04／06 |

原生缩放不是新项目脚本：IP-07 在已有可用原生浏览器／独立显示环境打开 C-05 正式构建及真实 harness，使用 Ctrl+0 和浏览器原生 Ctrl+plus 到 200%，读取实际 viewport／DPR 并保存每个组合截图与操作结果到本 change `evidence/native-zoom/` 和 `evidence/native-zoom.json`。逐组合实际完成导航、左右折叠、已有确认／取消及焦点恢复；有二维溢出则实际改变 scrollLeft。记录窗口外尺寸和 CSS 视口，不把 1920 的无溢出记成发生滚动。复用 CH-1 `evidence/native-zoom.json` 的记录形态与取证方法，不复用旧通过结果。工具不可用时明确 BLOCKED，不靠 viewport 近似。

## 7. 文件清单与升级条件

每行均为文件所有权 allowlist。花括号仅表示此行列出的有限精确文件名展开，不授权递归目录任意改动。相同文件可有多个 IP，但集成 writer 串行修改。未列新公共契约／领域文件必须先升级。

| IP-ID | 操作 | 精确文件集合 | 作用 |
|---|---|---|---|
| IP-01 | 修改 | `packages/contracts/src/ports/index.ts`；`packages/core/src/access/{schema,service,policy,index}.ts` | 能力、branch、投影 DTO／内部请求／独立 port／v2 策略与导出 |
| IP-01／07 | 修改 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`；`packages/core/test/access.test.ts` | 契约及角色增量／边界行为；不新增纯常量拷贝断言 |
| IP-02 | 修改 | `packages/adapters/src/auth/{postgres-local-identity-access,index}.ts` | 独立 projectAccessPresentation 属性／真实当前查询、历史策略解析；复用原 DB 结构 |
| IP-02／07 | 修改 | `packages/adapters/test/auth/{local-identity-project-authorization.test,fixture}.ts` | 五角色、历史策略、原件当前 source grants 和真实事务证据 |
| IP-02 | 修改 | `apps/api/src/{app,http,index}.ts` | 新能力读取 route／Cookie／port／strict schema／OpenAPI 接缝 |
| IP-02／07 | 修改 | `apps/api/test/http-shell.test.ts`；`scripts/deployment/{composition/api-ports.mjs,api-ports.test.mjs}` | 请求失败边界、真实端口装配与缺口拒绝 |
| IP-02／04 | 修改 | `apps/web/src/{main.tsx,app/App.tsx,api/http.ts}` | 当前工程能力单在途、生命周期、壳层 Set；session 形状不改 |
| IP-02／07 | 修改 | `apps/web/test/{api-client-openapi.test.ts,routing-context-actions.test.ts}`；`apps/web/test/browser/{server,business-server}.mjs` | DTO／客户端错误与竞态行为、正式服务注入；不用 mock role mirror |
| IP-03 | 修改 | `apps/web/src/app/{routes,business-routes}.ts`；`apps/web/src/quality/QualityPage.tsx`；`apps/web/src/pages/RiskOverviewPage.tsx` | 模板匹配与别名；元数据和真实区域消费者 |
| IP-03 | 修改 | `apps/web/src/shared/page-shells/{PageFrame,ListPageShell,DetailPageShell,RunPageShell,GovernancePageShell,ReviewWorkbenchShell}.tsx`；`apps/web/src/shared/page-shells/index.ts`；`apps/web/src/index.ts` | descriptor/content 组合、五单区便利组件与 exports 一次 cutover |
| IP-03／04 | 修改 | `apps/web/src/theme/global.css`；`apps/web/src/shell/{navigation.ts,AppShell.tsx,AppShell.css}`；`apps/web/src/shell/dock/RightDock.tsx`；`apps/web/src/agent/{AgentTaskProvider,AgentDock}.tsx` | 区域／折叠样式、贡献列表与资格；仅修改实际需要段落，不重写全样式 |
| IP-03／04／07 | 修改 | `apps/web/test/{business-routes.test.ts,ssr-shells.test.tsx,quality.test.tsx,focus.test.ts}` | 精确路由、区域七态、实际焦点与独立贡献授权 |
| IP-05 | 修改 | `apps/web/src/shared/{actions.ts,confirmation.ts,CommandConfirmationDialog.tsx}`；`apps/web/src/components/{ConfirmButton.tsx,ConfirmButton.css}`；`apps/web/src/index.ts` | 统一权限／控制器、触发组合与释放口令所需的可选 onClosed 通知；删除本地重复状态和 overlay 样式 |
| IP-05 | 新增 | `apps/web/src/shared/CommandConfirmationDialog.css` | 唯一 Dialog 令牌、错误与缩放样式；不加独立 UI 库 |
| IP-05／07 | 修改 | `apps/web/test/{confirmation.test.ts,design-system.test.tsx,routing-context-actions.test.ts,ssr-shells.test.tsx}` | 嵌套快照／迟到／失效／高影响／system／hidden 的稳定行为 |
| IP-06 | 修改 | `apps/web/src/api/{client,operations,agentAuditOperations}.ts`；`apps/web/src/agent/agentShared.tsx` | prepare/send 协议、原结果 decoder 和 Agent 真实启动迁移，旧全局 frozenCommands／无消费者导出删除 |
| IP-06 | 修改 | `apps/web/src/pages/{AssessmentRunPage,CalibrationDetailPage,ExecutionRegisterPage,RecommendationDetailPage,ReviewDetailPage,ReviewQueuePage,StartAssessmentPage,WarningDetailPage}.tsx` | 原写入口全部消费冻结计划，不更换领域语义或正文布局 |
| IP-06 | 修改 | `apps/web/src/pages/ops/{AccessPage.tsx,ops.css}` | 六项真实管理确认迁移，删 Intent／retryIntent／内联确认与其孤立样式；普通输入／目录保持 |
| IP-07 | 修改 | `apps/web/test/browser/{read-only,identification-review,assessment-warning-response,agent-audit-operations,quality}.spec.ts`；既有 `apps/web/test/browser/native-zoom.mjs` | 正式浏览器行为回归与原生缩放取证；删除旧文字／CSS／骨架精确数量测试，不改为新文案快照 |
| IP-07 | 修改 | 本 change 的 `proposal.md`、`design.md`、`implementation-plan.md`、`tasks.md` 与 `specs/**/*.md` | 仅按已批准语义修正事实／完成状态；新增语义先升级 |
| IP-07 | 实现后新增 | 本 change `verification.md`、`evidence/native-zoom.json`、`evidence/native-zoom/*`、`evidence/browser-failures/*` | Finalizer 最终证据、一次限定审计、原生交互取证及验收失败 trace／截图；Planning 不预建 |

**受保护且不改：** `apps/web/src/components/AppShell.tsx`、`apps/web/src/components/EvidenceDrawer.tsx`、`apps/web/src/pages/ReportExportPage.tsx`、`apps/web/src/theme/tokens.css`、AgentProposalPanel 的只读语义、所有 `demo/**`、已归档 CH-1 工件／证据、领域评分／预算／状态机、迁移目录、依赖与锁文件、`apps/desktop/**`、研究资料和编排执行图。原组件里的可见标题／注释不为本次机械重排。

**删除范围：** 不删上述活文件；只删已经被本次干净切换替代的旧类型、旧导出、全局请求缓存、重复本地确认状态／样式，以及绑定固定文案／枚举个数的脆弱断言。无大批文件删除命令。

**明确升级：** 基线漂移致目标 symbol／权限不符；现有登记不足以当前授权；需要新增依赖／角色／数据库迁移／领域命令；目标业务重定向或 CH-9 聚合被提前要求；指定验证命令不存在／真实环境不可达。普通类型错误、测试失败、范围内 fixture 调整和实现缺口由当前责任方修复，不回派或绕过。无授权不安装、提交、改历史、切分支或操作现场。

## 8. 验收 Agent 授权与限定审计

Finalizer 在固定实现检查点完整读取 proposal、七份 delta、design、implementation-plan、tasks，核验本矩阵并可在第 7 节允许文件内直接修复已批准缺陷，完成最小回归和真实表面烟测，再按 CLI verification 指令创建工件。普通缺陷不得回派首轮实现者；公共契约／权限／迁移／Non-goals 改变才升级。

本轮限定审计标签：**AUTHZ**（入口不替代来源授权、reviewer 无 Agent、跨工程与撤权）、**POLICY-HISTORY**（v1 只恢复范围、新动作 v2 当前判权、历史不重写）、**CONFIRMATION-STATE**（请求冻结、迟到响应、失效后重试、批量部分失败、密码释放、system scope 无伪工程）。最多一次审计，审计发现的范围内普通缺陷在其活动任务内修复和回归，最终结论补入同一 verification。

本轮 Planning 的严格校验和 apply state 只证明工件就绪，不证明以上实现／浏览器／审计已通过。主规格同步、main 全量 `pnpm verify`、Git 检查点与归档仍按后续角色及用户授权执行，不在本次规划中宣称已完成。
