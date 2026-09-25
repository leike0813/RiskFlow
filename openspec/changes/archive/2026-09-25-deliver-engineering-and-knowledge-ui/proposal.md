# Proposal: deliver-engineering-and-knowledge-ui

## Why

上游 C03–C41 已交付全部领域能力、HTTP 命令/查询/SSE 外壳与投影只读契约，但业务用户没有任何界面消费这些事实：`demo/`（riskflow-demo）的工程项目与知识与规则页面全部渲染静态内容模型，与 `apps/api` 零通信。同时，既有 HTTP 查询成功响应只回引用（`queryResultRef` 等），服务端已有的结果再读取端口（`ProjectionResultReadPortV1.readPage`、`resolveReadQuery`、`resolveSnapshotQuery`、检索结果读取）没有任何 HTTP 通路——"引用 → 正文"的最后一环缺失，任何真实界面都无法落地。

本 change 以最小加法式只读扩展闭合该缺口（沿袭 C31 公共投影契约与 C36 `qualitySummaries` 的批准模式），并在既有 demo 应用上交付"工程项目"与"知识与规则"两块业务导航的真实数据界面。

## What Changes

- **只读契约加法（packages/contracts）**：新增有界内联只读 Schema 与端口——工程上下文读、资料目录读、监测目录读、查询结果再读取（engineering-data 三类）、知识治理只读（列表/精确读取/当前发布集合）、检索结果再读取（hybrid-evidence / relationship-context）；既有 `ProjectionResultReadPortV1` 获得 HTTP 通路。全部为只读、有界分页、授权复验、无权与不存在同形失败；既有查询、命令、端口语义与形状不变。
- **HTTP 路由加法（apps/api）**：在既有闭合路由清单与传输信封上新增 7 条 query branch：`engineering-data.context-read`、`engineering-data.source-catalog`、`engineering-data.monitoring-catalog`、`engineering-data.read-result`、`knowledge-modeling.governance-read`、`knowledge-modeling.retrieval-result`、`projection.result-read`。所需能力全部映射到既有能力位（`engineering-data.read`、`knowledge-modeling.read`、`knowledge-modeling.retrieve`、`projection.query`），不新增能力枚举；`packages/core/src/access/policy.ts` 按角色×界面差异矩阵为 reviewer / field-responder / business-viewer 补充只读 branch 授予（project-risk-manager 经 `allBranches` 自动获得）。
- **适配器实现（packages/adapters）**：新只读由各 owning 模块既有适配器内部实现（工程上下文/资料/监测 registry、知识治理、检索结果、投影结果读取），不跨所有权直读私表，不新增表与迁移。
- **demo 界面接线（demo/）**：新增 `demo/src/api/` 数据接入层（会话登录、查询提交、错误脱敏映射，零新依赖）；9 个既有页面接真实只读数据——`ProjectOverviewPage`、`DocumentListPage`、`DocumentDetailPage`、`MonitoringDetailPage`、`ProcessModelPage`、`MechanismLibraryPage`、`RuleSetsPage`、`RiskMatrixPage`、`MeasureLibraryPage`；新增 1 个检索结果查看页（hybrid/relationship 结果深链目标）；`EvidenceDrawer` 改经 `evidence-access` 读取并呈现脱敏两态；移除静态内容模型驱动的假写操作入口（"登记资料""新建机理条目"等），本 change 全部页面只读。
- **浏览器验收链路（demo/test/browser/ + playwright.config.ts）**：复用 C36 server.mjs 模式（testcontainers PostgreSQL + 真实迁移 + 夹具 + 真实 buildApi + 同源静态托管 demo 构建产物），新增 Playwright chromium project 验证登录、导航、权限降级、证据脱敏与跨页跳转。
- 不新增生产运行时依赖；不需要数据库迁移（实施第一步复核当时 main 最大迁移序号确认）。

## Capabilities

### New Capabilities

- `web/engineering-and-knowledge-ui`: 工程项目与知识与规则两块业务导航的只读界面——9 个既有 demo 页面接真实只读事实、1 个检索结果查看页、证据抽屉脱敏两态、空/加载/异常/权限四类骨架行为与跨页深链。

### Modified Capabilities

- `platform/http-command-query-sse-shell`: 闭合路由清单新增 7 条只读 query branch，复用既有传输信封、错误形态与能力位映射。
- `domain/module-interfaces-events-workflows`: 模块接口加法——查询结果再读取、工程上下文/资料/监测目录只读、知识治理只读与检索结果再读取的端口与行为契约。

## Impact

- **代码**：`packages/contracts`（新 Schema/端口）、`packages/adapters`（engineering-data、knowledge-governance、retrieval、projection 适配器的只读实现）、`apps/api`（端口注入位、路由目录、能力映射）、`packages/core/src/access/policy.ts`（角色 branch 授予）、`demo/`（api 接入层、9+1 页面、EvidenceDrawer、路由、vite 同源代理）、`demo/test/browser/`（新验收 harness 与 specs）、`playwright.config.ts`（新增 project）。
- **API**：新增 7 条只读 query branch（加法，无破坏）；OpenAPI 由同一活动路由元数据派生。
- **依赖**：无新增生产运行时依赖；浏览器验收复用既有 `@testcontainers/postgresql` 与 `@playwright/test`。
- **迁移**：无（只读实现全部落在既有表与登记行上；实施时复核 main 最大迁移序号，预期维持 `000053`）。
- **范围外（Non-goals）**：治理与登记写命令的界面接线（送审/发布/回滚/登记资料/新建条目等）、资料上传通路、风险识别/评估/预警处置/复核审计/Agent 界面（C33/C34/C35）、`measure-candidates` 结果读取（C34 处置建议链）。
