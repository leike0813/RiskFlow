# Implementation Plan: deliver-identification-and-review-ui

## 1. 实施基线与权威来源

- **Base commit**：`71465787d50e669ad7317fbb0b7e474130ad7b2c`（main，C32 归档后，当前工作树即 main 检出）。
- **直接依赖（均已归档）**：C05 身份授权、C09 HTTP 外壳、C10 Web 外壳、C23 复核、C24 识别图（含 C40 修复）、C30 图与投影、C31 图追踪与报告投影、C32 工程项目/知识界面（demo 接入层与浏览器 harness 模式来源）。
- **权威输入**：本 change 的 `proposal.md`、`design.md`（D1–D13）、`specs/` 三份 delta；`.scratch/riskflow-master-plan/prototypes/full-product-ui-spec.md` 只作页面语义参照，不作字段事实源。
- **就绪判断**：不需要新迁移（实施第一步运行 `git log --oneline -1` 与迁移目录列举复核当时 main 最大迁移序号仍为 `000053` 且本 change 不占用新序号）；不需要新依赖；上游端口与适配器均已存在于 base。
- **用户硬约束**：复用 `demo/` 既有应用、组件（重点 `GraphLegend`/`StageBar`/`RiskBadge`/`EvidenceDrawer`/`EvidenceLink`/`Timeline`/`DataTable`/`PageStateView`）与主题；不另起脚手架、不引入第二套组件库；只经 `apps/api` 既有 HTTP 命令/查询/SSE 形态与 `packages/contracts` 端口交互；不直读私有表、不发明后端写路径。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts`：`WorkflowRunRefV1Schema`、`RiskRecordRefV1Schema`、`ReviewTaskRefV1Schema`、`ReviewTypeV1Schema`、`MODULE_BRANCH_CAPABILITY_V1`、`querySchema`/`moduleResultSchema`/`branchCapability` | 同文件加法式新增 Schema/端口/映射条目 | 不改既有联合、端口签名与结果形状 |
| IP-02 | `packages/core/src/access/policy.ts`：`roleBranches`、`branchSet` | 加法授予新 branch | 不撤既有授予；`system-administrator` 保持空集 |
| IP-03 | `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`（运行登记行与读取 helper）；`packages/adapters/src/identification/candidate-finalization/`（标准化风险记录存储与 `postgres-risk-record-trace-reader.ts` 的读取惯例） | identification 所有权域内新适配器组合二者 | 不读其它模块私表；不新建表；不重写授权校验 |
| IP-04 | `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`（`review_tasks`/`review_decisions` 登记行、既有精确读与失败形态） | review-audit 模块内新增队列只读 | 不经投影适配器跨所有权读 review_tasks |
| IP-05 | `apps/api/src/http.ts`：`HTTP_ROUTE_CATALOG_V1`、`queryRoutes`、`ApiPortsV1`、`MODULE_BRANCH_CAPABILITY_V1` 派生 | 两个端口注入位 + 五条 queryRoutes 条目 | 不加新错误码/信封；不引入专用 handler |
| IP-06 | `demo/src/api/client.ts`（`postQuery`/`ApiError`/`KNOWN_CODES`）、`operations.ts`（`asRecord` 等白名单解码、`readTraceChain` 两段读形态）、`context.ts`（`usePageQuery`/`PageState`/`useProjectPath`） | 同文件扩展：postCommand + 五个新查询 operation + decide 命令 operation | 不从 apps/web/packages import；不引入新依赖 |
| IP-07/08/09 | demo 既有 8 页与组件（GraphLegend/StageBar/RiskBadge/EvidenceDrawer/EvidenceLink/Timeline/DataTable/PageStateView/StatusTag/VersionTag）、`demo/src/charts/GraphView.tsx`、`demo/src/theme/` | 页面改数据驱动，组件签名保持稳定 | 不新写等价组件；删静态业务数据而非保留双份 |
| IP-10 | `demo/test/browser/server.mjs`（testcontainers + 迁移 + 夹具 + buildApi + 同源静态）、`read-only.spec.ts`、根 `playwright.config.ts` 的 `demo-chromium` project | 同 harness 扩展夹具与并列新 spec 文件 | 不用 Mock 后端/浏览器；不动既有 project 配置 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | domain delta 两条 Requirement；http delta「…闭合路由清单」 | `packages/contracts/src/ports/index.ts`：新增 `RiskIdentificationReadQueryV1Schema/Result/PortV1`、`ReviewQueueReadQueryV1Schema/Result/PortV1`（D3 全部形状）；`MODULE_BRANCH_CAPABILITY_V1` 增 5 条目（D2 表） | 加法式定义；`ModuleBranchV1` 由映射自动扩展 | 既有 Schema/联合/端口/能力枚举值 |
| IP-02 | 1.2 | http delta「…复用既有传输信封…」授权场景 | `packages/core/src/access/policy.ts`：`roleBranches` | reviewer +5；field-responder +4；business-viewer +6（含 `knowledge-modeling.retrieval-result`，D5 清单） | 既有 branch 授予与 `allBranches` 语义 |
| IP-03 | 2.1 | domain delta「识别运行与风险记录只读…」全部 Scenario | 新增 `packages/adapters/src/identification/read/postgres-risk-identification-read.ts`（`createPostgresRiskIdentificationReadAdapter`） | 实现 `RiskIdentificationReadPortV1.read` 四分支：run-list/run-read 组合图运行登记读取；record-catalog/record-read 读标准化风险记录存储 | 既有图适配器/候选收口公开方法签名与表结构 |
| IP-04 | 2.2 | domain delta「复核队列只读…」全部 Scenario | 新增 `packages/adapters/src/review-audit/postgres-review-queue-read.ts` | 实现 `ReviewQueueReadPortV1.read`：筛选/游标/stale 计算/同形失败 | 复核写路径与既有窄读语义 |
| IP-05 | 2.3 | http delta 两条 Requirement 全部 Scenario | `apps/api/src/http.ts`：`ApiPortsV1` +`riskIdentificationRead/reviewQueueRead`；`HTTP_ROUTE_CATALOG_V1` +5 条 queryRoutes 条目与 invoke 函数 | 路由、能力映射、OpenAPI 由同一目录派生；未注入不激活 | 既有路由行为与信封 |
| IP-06 | 3.1 | web spec「…只经既有 HTTP 面…」「空、加载、异常、权限…」 | `demo/src/api/client.ts` +`postCommand`；`demo/src/api/operations.ts` +`listIdentificationRuns`/`readIdentificationRun`/`listRiskRecords`/`readRiskRecord`/`readReviewQueue`/`submitReviewDecision`/`readAssociationGraph` | 统一页面状态机与错误脱敏沿用既有实现 | 既有 operation 形状与 KNOWN_CODES |
| IP-07 | 3.2 | web spec「识别运行列表与详情…」「风险记录列表与详情…」 | `demo/src/pages/IdentificationRunsPage.tsx`、`IdentificationRunPage.tsx`、`RiskRecordListPage.tsx`、`RiskDetailPage.tsx`（+各自 `.css` 如需）；`demo/src/App.tsx` 路由参数化（`/identification/runs/:runId`、`/identification/records/:recordId`），RiskDetailPage 归识别导航 | 四页接 IP-06 operations；移除假写按钮与评估域静态区块；运行中轮询终态停刷 | 组件复用优先；不新增等价组件 |
| IP-08 | 3.3 | web spec「关联图页…」「证据追溯页…」「证据抽屉…」 | `demo/src/pages/AssociationGraphPage.tsx`、`EvidenceTracePage.tsx`；必要时 `demo/src/components/EvidenceDrawer.tsx` | 投影两段读接线；失败闭合与分组降级视图；抽屉脱敏两态沿用 | EvidenceProvider 形态；不引入第二套抽屉 |
| IP-09 | 3.4 | web spec「复核队列…」「运行记录页…」「跨页深链…」 | `demo/src/pages/ReviewQueuePage.tsx`、`RunRecordsPage.tsx`；`demo/src/App.tsx` 深链接线 | 队列接 queue-read + decide-review（D8）；运行记录双源聚合；移除假"审计重放" | 决定命令语义在服务端；不造第二套确认框 |
| IP-10 | 4.1 | web spec「浏览器验收必须…」两个 Scenario | `demo/test/browser/server.mjs` 扩展夹具与新端口注入；新增 `demo/test/browser/identification-review.spec.ts` | 识别/复核夹具（含过期任务、待决定任务、投影链边）；覆盖八页/四态/脱敏/决定幂等/深链 | 不改既有 read-only.spec.ts 语义与 project 配置 |
| IP-11 | 4.2 | 全部（收口） | `demo/src/content/`：删除本 change 页面已替换的静态业务数据导出（risks/review/evidence 业务字段、agent 运行摘要等） | 删除即漂移源；保留界面配置与 C34/C35 域数据并显式标注归属 | 不触动 C34/C35 域静态模型 |

## 4. 调用与副作用顺序

1. IP-01（契约）→ IP-02（授予）→ IP-03/04（适配器实现，可并行）→ IP-05（HTTP 接线）。每步：`pnpm typecheck` + 对应测试。
2. IP-06（demo 数据层扩展）→ IP-07/08/09（页面，可按 IP 序）→ IP-11（静态内容清理）。
3. IP-10（浏览器验收扩展）在 IP-05/07/08/09 就绪后：先起 harness 冒烟（登录 200、运行列表渲染），再写 specs。
4. 副作用：新 branch 自身为纯读取；唯一写副作用是复核决定经既有 `decide-review` 命令（D8 幂等与失败闭合）；查询登记类读取（projection.query）沿用既有登记/审计语义。
5. 失败处理：越权/不存在/游标篡改 → 同形安全失败；陈旧版本决定 → 结构化失败闭合；投影越界 → 结构化原因；均无回滚需求（读取无写入，决定命令幂等）。

## 5. Schema、状态与持久化落实

- 新 Schema 全部 strictObject、判别联合（D3 清单），SSOT 位于 `packages/contracts/src/ports/index.ts`；demo 侧只维护请求/解码白名单。
- 状态：无新状态机；运行状态词汇沿用既有运行状态枚举；复核任务状态与过期标记由拥有方计算。
- 持久化：无新表、无迁移；读取落既有表（identification_graph_results、standardized_risk_records、review_tasks/review_decisions、投影登记）。
- 权限：branch→能力位走 `MODULE_BRANCH_CAPABILITY_V1`（既有枚举值）；角色授予仅 `policy.ts` 加法；服务端逐请求签发 + 端口复验不变。
- 审计：新 branch 的受保护读取沿用各 owning 端口既有审计语义；复核决定沿用既有决定审计；HTTP 层不新增审计旁路。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| domain delta「识别运行与风险记录只读」全部 Scenario | IP-01/03 | `packages/adapters/test/identification/`（新增 read 测试） | testcontainers PG + 播种识别运行/记录行 | 有界分页/游标稳定；精确版本可重放；越权/跨工程同形失败 | `pnpm vitest run packages/adapters/test/identification` |
| domain delta「复核队列只读」全部 Scenario | IP-01/04 | `packages/adapters/test/review-audit/`（扩展或新增） | 播种复核任务（含过期与待决定） | 条目携完整任务引用；stale 计算正确；同形失败 | `pnpm vitest run packages/adapters/test/review-audit` |
| http delta 两 Requirement 全部 Scenario | IP-01/02/05 | `apps/api/test/`（扩展 read-surface/http-shell 测试） | buildApi 注入/不注入新端口 | 目录-能力-OpenAPI 一致；越权字段 400；无权/不存在同形 404；未注入不激活 | `pnpm vitest run apps/api` |
| contracts 形状 | IP-01 | `packages/contracts/test/`（新增） | — | strict 拒绝契约外字段；判别联合闭合 | `pnpm vitest run packages/contracts` |
| 角色授予 | IP-02 | `packages/core/test/access.test.ts`（扩展） | — | 各角色新 branch 授予恰为 D5 清单 | `pnpm vitest run packages/core/test/access.test.ts` |
| web spec 识别/记录/关联图/追溯 Requirement | IP-06/07/08 | `demo/test/browser/identification-review.spec.ts` | IP-10 夹具 | 真实事实渲染；四态骨架；图/链失败闭合；脱敏两态；深链直达 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` |
| web spec 复核队列/运行记录 Requirement | IP-06/09 | 同上 | 同上（含待决定/过期任务） | 决定确认四要素；提交成功与重复提交幂等；过期禁决定；双源聚合与单源失败 | 同上 |
| web spec「浏览器验收」Scenario 2 | IP-10 | 同上 | 停掉依赖服务 | 非零退出并保留证据 | 同上（手动故障注入一次，记录于 verification） |
| 全部 | 全部 | — | — | 类型/lint/格式/构建/规格 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate deliver-identification-and-review-ui --strict --no-interactive` |

## 7. 文件清单与升级条件

**新增**：`packages/adapters/src/identification/read/postgres-risk-identification-read.ts`、`packages/adapters/src/review-audit/postgres-review-queue-read.ts`、`demo/test/browser/identification-review.spec.ts`、各级新增/扩展测试文件。

**修改**：`packages/contracts/src/ports/index.ts`、`packages/core/src/access/policy.ts`、`apps/api/src/http.ts`、`demo/src/api/client.ts`、`demo/src/api/operations.ts`、`demo/src/App.tsx`、demo 八个页面文件（+必要时同名 `.css`）、`demo/src/content/`（仅 IP-11 的删除）、`demo/test/browser/server.mjs`、`apps/api/test/` 与 `packages/core/test/access.test.ts`、`packages/contracts/test/`、`packages/adapters/test/` 相关测试。

**保护（不得改）**：已归档 specs、既有写路径与迁移、`demo/src/content/` 中 C34/C35 域数据、`demo/v2/`、编排脚本与执行图、C32 已接线页面的既有行为。

**升级条件**：计划外公共契约/依赖/迁移/文件；工具链不存在的验证命令；需要越权或跨所有权直读私表；发现必须改变已批准范围或语义；base 漂移使本计划符号失效。

## 8. 验收 Agent 授权与限定审计

- **授权验收范围**：本 plan 第 3 节全部 IP-ID 与第 6 节证据矩阵；Finalizer 可在已批准语义内修复普通缺陷（实现不完整、测试失败、范围内 fixture 调整）。
- **保护语义边界**：既有查询/命令/端口形状；授权与脱敏同形失败语义；发布版本不可变性；除 decide-review 接线外的只读定位；不新增依赖与迁移。
- **限定审计标记**：本 change 触及权限（新 branch 授予与同形失败）与写命令接线（decide-review 幂等/陈旧闭合）——若协调端判定需要，按"同一收尾轮次最多一次"触发一次 Targeted Auditor，重点核对 D2/D5 能力位映射、D3 失败语义与 D8 幂等接线；审计结论补入同一 `verification.md`。
