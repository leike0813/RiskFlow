# Design: deliver-engineering-and-knowledge-ui

## Context

上游 C03–C41 已交付领域能力与 HTTP 外壳，但存在两个缺口：

1. **引用→正文缺口**：既有 7 条 HTTP 查询分支成功响应只回引用（`QueryResultShapeV1Schema = { queryResultRef }` 等）。服务端已有的结果再读取实现——`ProjectionResultReadPortV1.readPage`（packages/adapters/src/workflow/postgres-workflow-projection.ts）、`PostgresEngineeringContextSourceRegistry.resolveReadQuery`、`PostgresMonitoringStoreV1.resolveSnapshotQuery`、`PostgresOfficialHybridResultReader`、`IdentificationContextResultStoreV1.readRelationshipResult`——全部没有 HTTP 通路。唯一例外是 C36 为 `quality-evaluation` 加的内联 `qualitySummaries`。
2. **目录/列表缺口**：知识治理 18 类定义没有任何列表端口（只有精确引用窄读 `readExact` / `resolveGovernedReleases`）；工程上下文、资料版本、监测序列也没有目录读取。C05 不提供"列出可见工程"，apps/web 目前经 URL 参数选择工程。

demo/（riskflow-demo）是独立 npm 项目（不在 pnpm workspace），27 路由 25 页全部渲染 `demo/src/content/` 静态模型，与 apps/api 零通信；既有 15 个 UI 组件 + icons.tsx、主题 tokens、图表组件齐备。C36 已建立浏览器验收模式（apps/web/test/browser/server.mjs：testcontainers PostgreSQL + 真实迁移 + 夹具 + buildApi + Playwright chromium）。

用户已批准：以最小加法式只读契约扩展闭合取数缺口（沿袭 C31/C36 批准模式），并声明真实浏览器验收链路。

## Goals / Non-Goals

**Goals:**

- 新增 7 条只读 query branch 与对应契约/端口，全部只读、有界、授权复验、无权与不存在同形失败；既有端口、查询、命令语义与形状不变。
- demo 的工程项目四页（概览/资料目录/资料详情/监测详情）、知识与规则五页（工序模型/机理库/规则集/风险矩阵/措施库）接真实只读事实；新增检索结果查看页（深链目标）。
- 证据抽屉经 evidence-access 呈现脱敏两态；空/加载/异常/权限骨架逐页一致；跨页深链用领域标识。
- 真实 Chromium 验收链路覆盖登录、导航、工程切换、权限降级、证据脱敏与深链。

**Non-Goals:**

- 治理与登记写命令的界面接线（修订/送审/发布/停用/回滚/登记资料/新建条目）；资料上传通路（既有 HTTP 只认 application/json，无上传通道）。
- 风险识别/评估/预警处置/复核审计/Agent 界面（C33/C34/C35）；`measure-candidates` 结果读取（C34）。
- 自由文本检索或脱离识别运行的临时检索入口（既有检索查询绑定 inputSnapshotRef/workItemRef）。
- demo/src/content 中属于 C33/C34/C35 域的静态模型（assessment/response/review/agent/risks）的替换。
- 新迁移、新生产运行时依赖、新能力枚举值。

## Decisions

### D1: 只读扩展总原则

所有新读面满足：只读不反写；有界分页（目录页 ≤50、投影条目 ≤100）；服务端按当前会话签发授权并在返回前复验（含登记查询的授权摘要比对）；无权、跨工程与不存在同形失败不可枚举；结果可由精确版本重放。新读由各 owning 模块适配器内部实现，不跨所有权直读私表。沿袭 C31 批准的最小加法式扩展模式：既有 `ProjectionQueryV1`、各查询/命令联合、端口签名与结果形状全部不变，新增独立 Schema 与端口。

### D2: 新 query branch 与端口清单

七条 branch 全部走既有 `queryRoutes` 形态与传输信封，1:1 映射 query kind，能力位全部复用既有枚举：

| Branch | Query kind | 能力位 | 新 ApiPortsV1 key |
|---|---|---|---|
| `engineering-data.context-read` | `context-read` | `engineering-data.read` | `engineeringDataCatalog` |
| `engineering-data.source-catalog` | `source-catalog` | `engineering-data.read` | `engineeringDataCatalog` |
| `engineering-data.monitoring-catalog` | `monitoring-catalog` | `engineering-data.read` | `engineeringDataCatalog` |
| `engineering-data.read-result` | `read-result` | `engineering-data.read` | `engineeringDataCatalog` |
| `knowledge-modeling.governance-read` | `governance-read` | `knowledge-modeling.read` | `knowledgeGovernanceRead` |
| `knowledge-modeling.retrieval-result` | `retrieval-result` | `knowledge-modeling.retrieve` | `knowledgeRetrievalRead` |
| `projection.result-read` | `result-read` | `projection.query` | `projectionResultRead` |

### D3: 新契约 Schema（packages/contracts/src/ports/，全部 strict）

- `EngineeringDataCatalogQueryV1Schema`：判别联合 `context-read`（空 payload）/ `source-catalog`（`{ cursor?, pageSize≤50, sourceKind? }`）/ `monitoring-catalog`（`{ monitoringSeriesRef?, cursor?, pageSize≤50 }`：不带序列引用列序列，带序列引用列其批次与快照）/ `read-result`（`{ queryResultRef }`）。结果 `EngineeringDataCatalogSuccessV1Schema` 按 kind 判别：上下文（工程身份、当前 `ProjectRevisionRefV1`、适用性元数据、空间区段树节点有界列表）；资料目录（`items: { sourceVersionRef, sourceKind, formedAt, sourceUnit, versionLabel, parseStatus, cleaningAvailability?, cleaningExclusionCount?, segmentSetRef? }[]` + `nextCursor?` + `totalCount`）；监测目录（序列条目或批次/快照条目 + `nextCursor?`；快照条目含 `evidenceSourceVersionRefs`，供客户端声明监测快照查询/再读取的授权来源）；结果再读取（判别联合：`source-segments` → 段集+`sourceAccessGrantRef`；`evidence-access` → `EvidenceAccessItemV1[]` 有界；`monitoring-snapshot` → 快照监测结果）。
- `KnowledgeGovernanceReadQueryV1Schema`：kind `governance-read`，payload 判别联合 `list-definitions`（`{ definitionType: KnowledgeDefinitionTypeV1, lifecycleStatus?, keyword?, cursor?, pageSize≤50 }`）/ `read-definition-revision`（`{ knowledgeRevisionRef }`）/ `read-definition-release`（`{ knowledgeReleaseRef }`）/ `current-release-set`（`{ requiredDefinitionTypes? }`）。结果按操作判别：列表项（定义标识、当前修订/发布引用、审核状态、版本摘要，无正文）+ `nextCursor?`；精确读取（该版本条目正文，形态与既有治理载荷一致）；发布集合（`KnowledgeReleaseRefV1[]`）。
- `KnowledgeRetrievalReadQueryV1Schema`：kind `retrieval-result`，payload `{ knowledgeQueryResultRef }`；结果判别联合：hybrid → 有界命中（条目引用、融合得分、证据定位）+ 策略/代引用；relationship-context → 邻接节点、依赖边、入选/筛除机理条目及原因。
- `ProjectionResultReadQueryV1Schema`：kind `result-read`，payload `{ queryResultRef, cursor?, limit≤100 }`；结果直接复用既有 `ProjectionResultReadResultV1Schema`（不新造形状）。
- 新端口 interface：`EngineeringDataCatalogPortV1.read`、`KnowledgeGovernanceReadPortV1.read`、`KnowledgeRetrievalReadPortV1.read`；`ProjectionResultReadPortV1` 为既有符号直接上 HTTP。

### D4: 拥有方实现落点

- `EngineeringDataCatalogPortV1` → `PostgresEngineeringContextSourceRegistry` 扩展（组合既有 context-source 行与 `PostgresMonitoringStoreV1`；`read-result` 直接委派既有 `resolveReadQuery`/`resolveSnapshotQuery`）。清洗可用性摘要来自既有 `PostgresDataCleaningStore` 已登记结果，由同一适配器组合，不新建表。
- `KnowledgeGovernanceReadPortV1` → `PostgresKnowledgeGovernanceAdapter` 扩展（治理定义/修订/发布为同模块私有表，列表与精确读取在模块内部实现；精确读取复用既有 `readExact` 窄读语义）。
- `KnowledgeRetrievalReadPortV1` → `PostgresIdentificationContextAdapter` 组合既有 `PostgresOfficialHybridResultReader` 与 `IdentificationContextResultStoreV1.readRelationshipResult`。
- `projectionResultRead` → 既有 `createPostgresWorkflowProjection` 返回的 `resultRead` 直接注入。

### D5: 角色 branch 授予（packages/core/src/access/policy.ts）

`project-risk-manager` 经 `allBranches` 自动获得全部新 branch。按角色×界面差异矩阵加法授予：

- `reviewer`：+全部 7 条（工程项目只读+证据、知识与规则查看、检索审阅相关）。
- `field-responder`：+`engineering-data.context-read`、`engineering-data.monitoring-catalog`、`engineering-data.read-result`（只读监测）。
- `business-viewer`：+`engineering-data.context-read`、`source-catalog`、`monitoring-catalog`、`read-result`、`knowledge-modeling.governance-read`、`projection.result-read`（不授予 `retrieval-result`：检索结果属识别运行事实，其界面归属在 C33 裁决）。

`system-administrator` 维持空集。既有 branch 授予不变。

### D6: demo 数据接入层（demo/src/api/，零新依赖）

新增模块：`client.ts`（查询提交：信封组装、same-origin fetch、credentials、AbortSignal、错误映射为脱敏 `SafeHttpError`，模式对齐 apps/web/src/api/http.ts 但不跨包引用——demo 是独立 npm 项目，按既有契约形状重写最小实现）；`session.ts`（login/logout/会话状态）；`operations.ts`（七条只读 operation 的请求/解码）；`context.ts`（URL `?project=<id>&revision=<versionId>` 选择器）。页面状态机统一 `{ kind: loading | ready | empty | error | forbidden }`，`NOT_FOUND`/`AUTHENTICATION_REQUIRED` 映射 forbidden/会话语义。

实施期确认的两条授权接缝规则：(a) C06 `verify` 把授权上下文与签发时的 `invocationId` 绑定，HTTP 外壳签发时必须以领域 `commandId`/`queryId` 为 invocationId（而非传输 requestId），否则下游 port 复验必拒；(b) 触达资料正文的查询（source-segments、evidence-access、monitoring-snapshot 登记与 read-result）必须在信封 `requestedSourceVersionRefs` 声明来源版本，使父上下文携带相应 grant——C06 对 requireBody=false 的 branch 在全声明中含不可读来源时会返回零 grant 的 redacted 上下文，子上下文收窄失败，因此客户端只声明查询真正触达的来源；监测快照的证据来源客户端事先不可知，由 monitoring-catalog 序列详情按快照条目暴露 `evidenceSourceVersionRefs` 供声明。

### D7: 同源策略

服务端只认 cookie 会话（`__Host-riskflow_session`，Secure+SameSite=Strict）并强制 same-origin Origin。开发态：`demo/vite.config.ts` 增加 `/api` 代理到本地 API（配置改动，无新依赖）。验收/预览态：浏览器 harness 在同一 Fastify 实例上挂载 demo `dist/` 静态资源，页面与 `/api` 同源。localhost 属 secure context，Secure cookie 可用。

### D8: 登录与工程上下文

新增 `/login` 路由与登录页（经 `session/login`，成功后回原目标页）。AppShell 顶栏工程显示改由 `context-read` 驱动；工程切换写回 URL 参数并停留当前页重新加载；无 `?project=` 时呈现引导空态。C05 无"列出可见工程"，验收环境固定单一工程，工程输入经 URL/引导页手输工程标识（与 apps/web 同一模式）。

### D9: 页面数据映射

| 页面 | 数据来源 | 关键降级 |
|---|---|---|
| ProjectOverviewPage | context-read + governance-read(current-release-set) + 目录 totalCount | 适用性缺维度逐项标出 |
| DocumentListPage | source-catalog | 清洗可用性摘要/未清洗标注 |
| DocumentDetailPage | source-catalog 条目 + source-segments 查询 + read-result | 段级证据入口接 EvidenceDrawer |
| MonitoringDetailPage | monitoring-catalog + monitoring-snapshot 查询 + read-result | 快照载荷外原始点序列不编造；无快照空态；快照来源声明取自目录条目 `evidenceSourceVersionRefs` |
| ProcessModelPage | governance-read(process-model release 精确读) | 未发布 → 治理空态 |
| MechanismLibraryPage / RuleSetsPage / RiskMatrixPage / MeasureLibraryPage | governance-read(list + 精确读) | 审核状态筛选；只读 |
| RetrievalResultPage（新，`/knowledge/retrieval-result`） | retrieval-result | 仅深链目标，无检索输入框 |

跨页关联（治理条目 → 引用它的记录）经既有 `projection.query`(trace-chain) + `projection.result-read`。移除页面上的假写操作按钮（登记资料、新建机理条目）。`demo/src/content/` 中仅本 change 页面用到的业务数据（evidence/knowledge/context 的业务字段、ProjectOverview 依赖的 assessmentVersions 等）被真实数据替换；navItems 等界面配置保留；其它域静态模型留给 C33–C35。

### D10: 证据抽屉接线

`EvidenceDrawer`/`EvidenceLink` 改按 `EvidenceReference` 经 `evidence-access` 查询 + `read-result` 取回：抽屉只呈现定位摘要与引用业务对象清单（C04 工件无 HTTP 通路，任何授权状态下都不呈现段正文原文）；无 grant 时显示定位摘要+固定脱敏提示。Provider 保持现有组件签名形态（新增异步加载态），不引入第二套抽屉。

### D11: 测试策略

- contracts：新 Schema/端口的 strict 形状与判别联合测试（packages/contracts/test）。
- adapters：四个新读实现的 Postgres 测试（授权复验、分页有界、同形失败、可重放；复用既有 testcontainers fixture 模式）。
- apps/api：路由目录/OpenAPI 一致性、能力位映射、越权字段拒绝、未注入端口不激活。
- demo：浏览器验收（D12）为行为测试主体；demo 不引入单元测试框架。

### D12: 浏览器验收 harness

新增 `demo/test/browser/`：`server.mjs` 复用 C36 模式（PostgreSqlContainer + 全量迁移 + 角色登录 + 夹具：工程上下文/空间区段/适用性快照/资料交付与段集/监测序列与快照/治理发布的机理-规则集-矩阵-措施-工序模型/一组投影事实），同一 Fastify 实例挂载 demo `dist/`；`*.spec.ts` 覆盖登录→工程概览→资料目录/详情→监测详情→治理四页→证据脱敏→无权角色→深链。根 `playwright.config.ts` 增加 `demo` project（testDir `demo/test/browser`）。夹具账户含 project-risk-manager 与 business-viewer 两角。

### D13: 依赖与迁移

不新增生产运行时依赖（demo 仍 react/react-dom/react-router-dom/echarts；API 读取用原生 fetch）。不需要数据库迁移：新读全部落在既有表与登记行（context-source、monitoring、治理、查询登记、投影登记）。实施第一步复核当时 main 最大迁移序号（当前 `000053`），若被占用与本 change 无关（本 change 不新增迁移）。

### D14: RI/RA 追踪

工程上下文/资料/监测页 ← RI-S1～RI-S2、RA-S1；工序模型页 ← RI-S3；机理库页 ← RI-S4；检索结果页 ← RI-S5；证据抽屉与跨页追溯 ← RI-S6；规则集/矩阵/措施页 ← RA-S2～RA-S4、RA-S7；阈值呈现 ← RA-S6。可追溯链（资料段→工序→机理→记录）经证据定位与 trace-chain 投影保持。

## Risks / Trade-offs

- **读面形状首次公开**：新 Schema 一经发布即受 SSOT 约束。缓解：字段最小化、引用优先于正文、严格 strict；列表项不含正文。
- **demo 独立 npm 项目**：无法引用 packages/contracts 类型，请求/解码形状存在双写漂移风险。缓解：解码只取契约字段显式白名单；浏览器验收在真实接缝上跑，漂移会直接失败。
- **治理列表是首个列表端口**：关键字筛选只在模块内做有界匹配，不引入搜索引擎语义。
- **监测原始点序列无契约载体**：页面只呈现快照载荷内统计，曲线图按快照/批次粒度，不插值。

## Migration Plan

无迁移。既有数据（已登记资料、监测、治理发布、查询登记、投影登记）即可被新读面消费；历史查询登记的授权摘要比对沿用既有实现。

## Open Questions

无。范围（只读定位、写命令 Non-goal）、取数路径（加法只读扩展）与浏览器链路均已在本设计闭合或经用户裁决。
