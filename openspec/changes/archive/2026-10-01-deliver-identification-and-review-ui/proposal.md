# Proposal: deliver-identification-and-review-ui

## Why

上游 C24 已交付识别图（含 C40 修复的嵌套中断/跨图检查点边界）、C23 已交付复核端口、C31 已交付关联图/追溯链/报告投影与结果再读取契约，C32 已为投影结果读取接通 HTTP 通路；但 demo 的"风险识别"与"复核"两块业务导航共 8 个页面仍全部渲染 `demo/src/content/` 静态模型，与真实事实零连接。识别运行/标准化风险记录/复核队列至今没有任何 HTTP 只读通路：识别运行事实在 `business.identification_graph_results`、记录正文在 `business.standardized_risk_records`、复核任务在 `business.review_tasks`，均只有写路径或进程内窄读。本 change 以最小加法式只读扩展闭合该缺口，并交付这两块导航的真实数据界面。

## What Changes

- **只读契约加法（packages/contracts）**：新增两个有界只读端口与 Schema——识别只读（`RiskIdentificationReadPortV1`：运行列表 `run-list`、运行详情 `run-read`、风险记录目录 `record-catalog`、记录详情 `record-read`）与复核队列只读（`ReviewQueueReadPortV1`：`queue-read`，条目携带完整 `ReviewTaskRefV1` 以支撑既有决定命令）；`MODULE_BRANCH_CAPABILITY_V1` 增 5 条目，能力位复用既有枚举（`risk-identification.read` 当前无 branch 映射、`review-audit.read` 已存在），不新增能力枚举值。
- **HTTP 路由加法（apps/api）**：闭合路由清单新增 5 条 query branch：`risk-identification.run-list`、`risk-identification.run-read`、`risk-identification.record-catalog`、`risk-identification.record-read`、`review-audit.queue-read`；复用既有传输信封、错误形态与同形失败；未注入端口不激活。
- **角色授予加法（packages/core/src/access/policy.ts）**：按角色×界面差异矩阵授予；同时闭合 C32 留下的裁决——`business-viewer` 补授 `knowledge-modeling.retrieval-result`（检索结果作为识别运行详情的只读组成对其开放）。
- **适配器实现（packages/adapters）**：识别只读由 identification 模块内新适配器组合既有图运行登记与候选收口存储实现；复核队列只读由 review-audit 模块内实现；均不跨所有权直读私表、不新建表、无迁移。
- **demo 界面接线（demo/）**：8 个既有页面接真实数据——`IdentificationRunsPage`、`IdentificationRunPage`、`RiskRecordListPage`、`RiskDetailPage`、`AssociationGraphPage`、`EvidenceTracePage`、`ReviewQueuePage`、`RunRecordsPage`；路由参数化（`/identification/runs/:runId`、`/identification/records/:recordId`）；`RiskDetailPage` 归位识别导航并移除评估/预警/处置静态假内容（C34 域）；复核队列的行内/批量"原样通过·拒绝"经既有 `review-audit.decide-review` 命令真实接线（确认四要素、幂等键、失败闭合）；移除假写入口（启动识别、审计重放、确认处置方案等）；关联图/证据追溯经 C31 投影查询 + C32 结果再读取，不可证明时失败闭合不编造。
- **浏览器验收扩展（demo/test/browser/）**：复用 C32 harness 模式补识别/复核夹具与 specs，覆盖登录、八页可达、四态骨架、权限降级、证据脱敏、复核决定真实提交与跨页深链。
- 不新增生产运行时依赖；不需要数据库迁移（实施第一步复核当时 main 最大迁移序号）。

## Capabilities

### New Capabilities

- `web/identification-and-review-ui`: 风险识别与复核两块业务导航的真实数据界面——识别运行列表/详情、风险记录列表/详情、关联图、证据追溯、复核队列（含经既有命令的原样通过/拒绝）与运行记录共 8 页，统一空/加载/异常/权限骨架、证据脱敏两态与领域标识深链。

### Modified Capabilities

- `platform/http-command-query-sse-shell`: 闭合路由清单新增 5 条只读 query branch，复用既有传输信封、错误形态与能力位映射。
- `domain/module-interfaces-events-workflows`: 模块接口加法——识别运行/风险记录只读与复核队列只读的端口与行为契约（有界分页、授权复验、同形失败、可重放）。

## Impact

- **代码**：`packages/contracts`（新 Schema/端口/能力映射）、`packages/core/src/access/policy.ts`（角色授予）、`packages/adapters`（identification 与 review-audit 各一个新只读实现 + 测试）、`apps/api/src/http.ts`（端口注入位与 5 条目录条目）、`demo/`（api 接入层扩展、8 页面、路由参数化、静态内容清理）、`demo/test/browser/`（夹具与 specs 扩展）。
- **API**：新增 5 条只读 query branch（加法，无破坏）；复核决定复用既有 `review-audit.decide-review` command（形状不变）。
- **依赖**：无新增生产运行时依赖；浏览器验收复用既有 `@testcontainers/postgresql` 与 `@playwright/test`。
- **迁移**：无（新读全部落在既有表与登记行；实施时复核 main 最大迁移序号，预期维持 `000053`）。
- **范围外（Non-goals）**：P-RI-02 启动识别向导与输入快照装配界面（无既有 HTTP 装配通路）；P-RV-02 复核详情页与 P-RV-03"修正并通过"一站式页；运行恢复/重试/审计重放入口（C35 运行运维域）；评估/预警/处置内容与 `measure-candidates` 读取（C34）；Agent 界面（C35）；关联图识别侧链边生产者补登（写路径，属 C24/C30 域）；系统管理页。
