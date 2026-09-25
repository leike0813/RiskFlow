# Implementation Plan: deliver-engineering-and-knowledge-ui

## 1. 实施基线与权威来源

- **Base commit**：`6cd2e0adadc4469f30b5cc6d2b64541c27edf19d`（main，C41 归档后）。
- **直接依赖（均已归档）**：C03 事务/审计、C04 工件、C05 身份授权、C09 HTTP 外壳、C10 Web 外壳、C15 清洗、C17–C20 检索、C22 候选收口、C23 复核、C30 图与投影、C31 图追踪与报告投影、C36 质量评估。
- **权威输入**：本 change 的 `proposal.md`、`design.md`（D1–D14）、`specs/` 三份 delta；`.scratch/riskflow-master-plan/prototypes/full-product-ui-spec.md` §8/§13/§4/§16/§17/§20 只作页面语义参照，不作字段事实源。
- **就绪判断**：不需要新迁移（实施第一步运行 `ls packages/adapters/src/*/migrations 2>/dev/null; git log --oneline -1` 复核当时 main 最大迁移序号仍为 `000053` 且本 change 不占用新序号）；不需要新依赖；上游端口与适配器实现均已存在于 base。
- **用户硬约束**：复用 `demo/` 既有应用、组件（AppShell/Card/ConfirmButton/DataTable/EvidenceDrawer/EvidenceLink/GraphLegend/KpiCard/RiskBadge/SectionTabs/StageBar/StatusTag/Timeline/VersionTag/WarningBadge）与主题；不另起脚手架、不引入第二套组件库；只经 `apps/api` 既有 HTTP 命令/查询/SSE 形态与 `packages/contracts` 端口交互；不为前端便利发明后端写路径或私读私有表。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts`：`QueryResultRefV1Schema`、`KnowledgeQueryResultRefV1Schema`、`ProjectionResultReadResultV1Schema`、`KnowledgeDefinitionTypeV1Schema`、`KnowledgeRevisionRefV1Schema`、`KnowledgeReleaseRefV1Schema`、`ProjectRevisionRefV1Schema`、`SpatialScopeRefV1Schema`、`ApplicabilityMetadataSchema`（records/）、`MODULE_BRANCH_CAPABILITY_V1`、`querySchema`/`moduleResultSchema` | 在同一文件加法式新增 Schema/端口/映射条目 | 不改既有联合、端口签名与结果形状 |
| IP-02 | `packages/core/src/access/policy.ts`：`roleBranches`、`branchSet` | 加法授予新 branch | 不撤既有授予；`system-administrator` 保持空集 |
| IP-03 | `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`：`resolveReadQuery`；`packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts`：`resolveSnapshotQuery`；`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` 已登记清洗结果 | 新适配器文件组合三者；`read-result` 直接委派既有再读取 | 不重写授权/脱敏校验；不新建表 |
| IP-04 | `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：`resolveGovernedReleases`、治理私有表、`readExact` 语义（`PostgresIdentificationKnowledgeAdapter`） | 同模块内扩展列表/精确读取 | 不经 API 或其它模块直读治理表 |
| IP-05 | `packages/adapters/src/identification/context/postgres-identification-context-adapter.ts`：`PostgresOfficialHybridResultReader`、`IdentificationContextResultStoreV1.readRelationshipResult` | 组合为单一检索结果读取端口 | 不触发新检索；不读候选正文 |
| IP-06 | `apps/api/src/http.ts`：`HTTP_ROUTE_CATALOG_V1`、`queryRoutes`、`ApiPortsV1`、`payloadSchemaFor`；`packages/adapters/src/workflow/postgres-workflow-projection.ts`：`createPostgresWorkflowProjection` 返回的 `resultRead` | 四条新端口注入位 + 七条 branch 目录条目 | 不加新错误码/信封；不引入专用 handler |
| IP-07 | apps/web 的 C09 模式（`apps/web/src/api/http.ts` 形态）、`demo/src/components/AppShell`、`demo/vite.config.ts` | demo 内按契约形状重写最小 client（demo 为独立 npm 项目，不跨包引用） | 不从 apps/web/packages import；不引入新依赖 |
| IP-08/09 | demo 既有 9 页与 15 组件、`demo/src/theme/tokens.css`、`demo/src/charts/` | 页面改数据驱动，组件签名保持稳定 | 不新写等价组件；删静态业务数据而非保留双份 |
| IP-10 | `apps/web/test/browser/server.mjs`（testcontainers + 迁移 + 夹具 + buildApi 模式）、根 `playwright.config.ts` | 同模式新 harness，同源挂载 demo dist | 不用 Mock 后端/浏览器 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | domain delta「C32 查询结果再读取…」「工程上下文与资料监测目录…」「知识治理只读…」「检索结果再读取…」「投影结果读取…」；http delta「…闭合路由清单」 | `packages/contracts/src/ports/index.ts`：新增 `EngineeringDataCatalogQueryV1Schema/Success/Result/PortV1`、`KnowledgeGovernanceReadQueryV1Schema/Success/Result/PortV1`、`KnowledgeRetrievalReadQueryV1Schema/Success/Result/PortV1`、`ProjectionResultReadQueryV1Schema/Result/Port`（复用既有 `ProjectionResultReadResultV1Schema`）；`MODULE_BRANCH_CAPABILITY_V1` 增 7 条目（D2 表） | 加法式定义 D3 全部形状；`ModuleBranchV1` 由映射自动扩展 | 既有 Schema/联合/端口/能力枚举值 |
| IP-02 | 1.2 | http delta「…复用既有传输信封…」授权场景 | `packages/core/src/access/policy.ts`：`roleBranches` | reviewer +7；field-responder +3；business-viewer +6（D5 清单） | 既有 branch 授予与 `allBranches` 语义 |
| IP-03 | 2.1 | domain delta「工程上下文与资料监测目录…」「查询结果再读取…」全部 Scenario | 新增 `packages/adapters/src/engineering-data/postgres-engineering-data-catalog-adapter.ts`（`createPostgresEngineeringDataCatalogAdapter`） | 实现 `EngineeringDataCatalogPortV1.read` 四分支；清洗摘要组合 `PostgresDataCleaningStore` 登记结果；`read-result` 委派 `resolveReadQuery`/`resolveSnapshotQuery` | 既有 registry/store 公开方法签名与表结构 |
| IP-04 | 2.2 | domain delta「知识治理只读…」全部 Scenario | `packages/adapters/src/knowledge-governance/`（扩展既有适配器或同目录新文件 `postgres-knowledge-governance-read.ts`） | 实现 `KnowledgeGovernanceReadPortV1.read`：list-definitions（类型/状态/关键字/游标）、read-definition-revision、read-definition-release、current-release-set | 治理写路径、发布不可变性、既有窄读语义 |
| IP-05 | 2.3 | domain delta「检索结果再读取…」全部 Scenario | 新增 `packages/adapters/src/identification/context/postgres-knowledge-retrieval-read.ts` | 实现 `KnowledgeRetrievalReadPortV1.read`：按登记类型分发既有 hybrid/relationship 读取 | 不触发检索；不暴露白名单外字段 |
| IP-06 | 2.4 | http delta 两条 Requirement 全部 Scenario | `apps/api/src/http.ts`：`ApiPortsV1` +`engineeringDataCatalog/knowledgeGovernanceRead/knowledgeRetrievalRead/projectionResultRead`；`HTTP_ROUTE_CATALOG_V1` +7 条 queryRoutes 条目与 invoke 函数 | 路由、能力映射、OpenAPI 由同一目录派生；未注入不激活 | 既有路由行为；`HTTP_BRANCHES_V1` 既有成员 |
| IP-07 | 3.1 | web spec「页面必须只经既有 HTTP 只读面…」「会话与工程上下文…」「空、加载、异常、权限…」 | 新增 `demo/src/api/`（`client.ts`、`session.ts`、`operations.ts`、`context.ts`）；`demo/vite.config.ts` 加 `/api` 代理；新增 `demo/src/pages/LoginPage.tsx`(+`.css`)；`demo/src/App.tsx` 加 `/login` 路由与鉴权门；`demo/src/components/AppShell.tsx` 接会话/工程上下文 | 统一页面状态机与错误脱敏映射 | 既有组件 props 形态与主题 tokens |
| IP-08 | 3.2 | web spec「工程概览页…」「资料目录与资料详情…」「监测序列详情…」 | `demo/src/pages/ProjectOverviewPage.tsx`、`DocumentListPage.tsx`、`DocumentDetailPage.tsx`、`MonitoringDetailPage.tsx`（+各自 `.css` 如需） | 四页改由 IP-07 operations 驱动；移除假"登记资料"按钮 | 组件复用优先；不新增等价组件 |
| IP-09 | 3.3 | web spec「工序模型页…」「知识治理四页…」「检索结果查看页…」「证据抽屉…」「跨页深链…」 | `demo/src/pages/ProcessModelPage.tsx`、`MechanismLibraryPage.tsx`、`RuleSetsPage.tsx`、`RiskMatrixPage.tsx`、`MeasureLibraryPage.tsx`；新增 `RetrievalResultPage.tsx`(+`.css`) 与路由；`demo/src/components/EvidenceDrawer.tsx`、`EvidenceLink.tsx`；各页关联对象区 | 五页接 governance-read；检索页接 retrieval-result；抽屉接 evidence-access+read-result；trace-chain 关联对象；移除假"新建机理条目"等按钮 | EvidenceProvider 组件形态；不引入第二套抽屉 |
| IP-10 | 4.1 | web spec「浏览器验收必须…」两个 Scenario | 新增 `demo/test/browser/server.mjs`、`demo/test/browser/*.spec.ts`；`playwright.config.ts` 加 `demo-chromium` project | 真实 PG/迁移/夹具/会话/同源静态；覆盖登录→导航→切换→脱敏→深链→无权 | 不改既有 `chromium` project 与 apps/web 验收 |
| IP-11 | 4.2 | 全部（收口） | `demo/src/content/`：仅删除本 change 页面已替换的业务数据导出（evidence/knowledge/context 业务字段等），保留界面配置与 C33–C35 域数据 | 删除即漂移源；保留项显式标注归属后续 change | 不触动 C33–C35 域静态模型 |

## 4. 调用与副作用顺序

1. IP-01（契约）→ IP-02（授予）→ IP-03/04/05（适配器实现，可并行）→ IP-06（HTTP 接线）。每步：`pnpm typecheck` + 对应测试。
2. IP-07（demo 数据层与门）→ IP-08/09（页面，可并行）→ IP-11（静态内容清理）。
3. IP-10（浏览器 harness）在 IP-06/08/09 就绪后：先起 harness 手工冒烟（登录 200、首页渲染），再写 specs。
4. 全部读路径副作用：仅既有查询登记行为（source-segments/evidence-access/monitoring-snapshot/projection.query 的登记与审计）——新 branch 自身为纯读取，除既有端口内部的受保护读取审计外不产生新业务事实。
5. 失败处理：查询登记失败 → 既有失败形态；再读取授权摘要漂移 → 同形安全失败；翻页游标篡改 → 同形安全失败；均无回滚需求（无写入）。

## 5. Schema、状态与持久化落实

- 新 Schema 全部 strictObject、判别联合（D3 清单），SSOT 位于 `packages/contracts/src/ports/index.ts`；demo 侧只维护请求白名单与解码白名单，不定义第二套字段。
- 状态：无新状态机；治理生命周期词汇沿用既有 `KnowledgeDefinitionTypeV1` 与治理状态枚举（草稿/待审核/已发布/已停用）。
- 持久化：无新表、无迁移；读取落既有表（context-source、monitoring、cleaning、治理、查询登记、投影登记）。
- 权限：branch→能力位走 `MODULE_BRANCH_CAPABILITY_V1`（既有枚举值）；角色授予仅 `policy.ts` 加法；服务端逐请求签发 + 端口复验不变。
- 审计：新 branch 的受保护读取沿用各 owning 端口既有审计语义；HTTP 层不新增审计旁路。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| domain delta「查询结果再读取」两 Scenario | IP-01/03 | `packages/adapters/test/engineering-data/`（新增 catalog 测试） | testcontainers PG + 已登记 source-segments/evidence-access/monitoring-snapshot 查询 | 授权一致返回正文；漂移/越权/类型不符同形失败；重放一致 | `pnpm vitest run packages/adapters/test/engineering-data` |
| domain delta「工程上下文与资料监测目录」三 Scenario | IP-03 | 同上 | 夹具：工程上下文+空间区段+资料交付+清洗结果+监测序列 | 有界分页/游标稳定；清洗摘要如实；越权不可枚举 | 同上 |
| domain delta「知识治理只读」三 Scenario | IP-04 | `packages/adapters/test/knowledge-governance/`（扩展） | 夹具：18 类中 6 类定义的草稿/已发布/已停用版本 | 列表无正文；精确版本可重放；同形失败 | `pnpm vitest run packages/adapters/test/knowledge-governance` |
| domain delta「检索结果再读取」两 Scenario | IP-05 | `packages/adapters/test/identification/`（新增） | 夹具：已登记 hybrid/relationship 结果 | 载荷一致；类型不符/越权同形失败 | `pnpm vitest run packages/adapters/test/identification` |
| domain delta「投影结果读取」两 Scenario | IP-06 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts`（扩展） | 已登记 projection.query | readPage 经 HTTP 端口语义一致 | `pnpm vitest run packages/adapters/test/workflow` |
| http delta 两 Requirement 全部 Scenario | IP-01/02/06 | `apps/api/test/http-shell.test.ts`（扩展）或新增 `apps/api/test/read-surface.test.ts` | buildApi 注入/不注入新端口 | 目录-能力-OpenAPI 一致；越权字段 400；无权/不存在同形 404；未注入不激活 | `pnpm vitest run apps/api` |
| contracts 形状 | IP-01 | `packages/contracts/test/`（新增 read-surface 测试） | — | strict 拒绝契约外字段；判别联合闭合 | `pnpm vitest run packages/contracts` |
| 角色授予 | IP-02 | `packages/core/test/access.test.ts`（扩展） | — | 各角色新 branch 授予恰为 D5 清单 | `pnpm vitest run packages/core/test/access.test.ts` |
| web spec 各页面 Requirement | IP-07/08/09/11 | `demo/test/browser/*.spec.ts` | IP-10 harness 夹具 | 真实事实渲染；四骨架；脱敏两态；深链；无写入口 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` |
| web spec「浏览器验收」Scenario 2 | IP-10 | 同上 | 停掉依赖服务 | 非零退出并保留证据 | 同上（手动故障注入一次，记录于 verification） |
| 全部 | 全部 | — | — | 类型/lint/格式/构建/规格 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate deliver-engineering-and-knowledge-ui --strict --no-interactive` |

## 7. 文件清单与升级条件

**新增**：`packages/adapters/src/engineering-data/postgres-engineering-data-catalog-adapter.ts`、`packages/adapters/src/identification/context/postgres-knowledge-retrieval-read.ts`、`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-read.ts`（如评审认为应并入既有适配器文件则并入，语义不变）、`demo/src/api/{client,session,operations,context}.ts`、`demo/src/pages/LoginPage.tsx(+css)`、`demo/src/pages/RetrievalResultPage.tsx(+css)`、`demo/test/browser/{server.mjs,*.spec.ts}`、各级新增/扩展测试文件。

**修改**：`packages/contracts/src/ports/index.ts`、`packages/core/src/access/policy.ts`、`apps/api/src/http.ts`、`demo/vite.config.ts`、`demo/src/App.tsx`、`demo/src/components/{AppShell,EvidenceDrawer,EvidenceLink}.tsx`、demo 九个页面文件（+必要时同名 `.css`）、`demo/src/content/`（仅 IP-11 的删除）、`playwright.config.ts`、`apps/api/test/http-shell.test.ts`、`packages/core/test/access.test.ts`、`packages/adapters/test/` 相关测试。

**保护（不得改）**：已归档 specs、既有写路径与迁移、`demo/src/content/` 中 C33–C35 域数据、`demo/v2/`、编排脚本与执行图。

**升级条件**：计划外公共契约/依赖/迁移/文件；工具链不存在的验证命令；需要越权或跨所有权直读私表；发现必须改变已批准范围或语义；base 漂移使本计划符号失效。

## 8. 验收 Agent 授权与限定审计

- **授权验收范围**：本 plan 第 3 节全部 IP-ID 与第 6 节证据矩阵；Finalizer 可在已批准语义内修复普通缺陷（实现不完整、测试失败、范围内 fixture 调整）。
- **保护语义边界**：既有查询/命令/端口形状；授权与脱敏同形失败语义；发布版本不可变性；只读定位（任何写命令界面接线都越界）；不新增依赖与迁移。
- **限定审计标记**：本 change 触及权限（新 branch 授予与同形失败）——若协调端判定需要，按"同一收尾轮次最多一次"触发一次 Targeted Auditor，重点核对 D2/D5 能力位映射与 D3 失败语义；审计结论补入同一 `verification.md`。
