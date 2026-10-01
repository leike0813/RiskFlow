# Design: deliver-identification-and-review-ui

## Context

- 输入 HEAD：`71465787d50e669ad7317fbb0b7e474130ad7b2c`（main，C32 归档后；提示词文件的固定基线 `6cd2e0a` 已被 C32 合并推进，按路线已知坑"以合并后 main 为准"取值）。实际 schema：`orchestrated-delivery`。
- 上游事实：C24 识别图三命令（plan/assemble-and-infer/repair-and-validate 等）已在 HTTP；识别运行事实存于 `business.identification_graph_results`（`PostgresIdentificationGraphAdapter`），运行状态 Schema 为 `IdentificationGraphRunStateV1Schema`/`IdentificationGraphRunResultV1Schema`；标准化风险记录正文只有 C22 写路径与进程内窄读 `RiskRecordTraceReadPortV1.readBatch`（只回追溯字段、不含正文、未上 HTTP）；复核域 `ReviewAuditPortV1`（requestReview/decideReview/trace）已在 HTTP，`business.review_tasks` 无队列列表读；C23 的 `IdentificationPendingReviewReaderV1.readPendingIdentificationReview` 为进程内精确窄读；C31 交付 `association-graph`/`trace-chain`/`risk-overview` 投影查询，C32 已把 `ProjectionResultReadPortV1.readPage` 接上 HTTP（`projection.result-read`）。
- C32 已建立并合入 main 的全部前端模式：`demo/src/api/`（client/session/context/operations）、`PageStateView` 五态、`demo/test/browser/` harness、`demo-chromium` project；C32 design D5 把"`business-viewer` 是否授予 `knowledge-modeling.retrieval-result`"明确留给本 change 裁决。
- 界面事实源：`.scratch/riskflow-master-plan/prototypes/full-product-ui-spec.md`（P-RI-01/03/05/06/07、P-RV-01/04/05、骨架 A/B/C/E、证据抽屉、角色矩阵、跳转矩阵与验收要点）。

## Goals / Non-Goals

**Goals:**

- 新增 5 条只读 query branch 与两个只读端口（识别只读、复核队列只读），全部有界、授权复验、同形失败、可重放；既有端口、查询、命令语义与形状不变。
- demo 识别域四页（运行列表/详情、记录列表/详情）、关联图、证据追溯、复核队列、运行记录共 8 页接真实事实；路由参数化；四态骨架逐页一致。
- 复核队列的"原样通过/拒绝"经既有 `review-audit.decide-review` 命令真实接线（确认四要素、幂等、陈旧版本失败闭合）。
- 闭合 C32 留下的 `retrieval-result` 授予裁决；移除本域假写入口。
- 浏览器验收扩展覆盖八页与决定提交。

**Non-Goals:**

- P-RI-02 启动识别向导与输入快照装配界面：`risk-identification.plan` 要求预先登记的 `inputSnapshotRef`/`work-plan`，装配无既有 HTTP 通路，本 change 不为此前移写路径；静态"启动识别"按钮移除。
- P-RV-02 复核详情页与 P-RV-03"修正并通过"一站式页（含候选修正表单）；队列仅支持"原样通过/拒绝"。
- 运行恢复/重试/审计重放入口（C35 运行运维域）；Agent 界面（C35）；评估/预警/处置内容与记录详情评估域区块（C34）。
- 关联图识别侧链边（`segment-process`/`process-mechanism`/`mechanism-risk`）生产者补登：属 C24/C30 写路径语义，本 change 只读消费投影，不可证明即失败闭合。
- 新迁移、新生产运行时依赖、新能力枚举值。

## Decisions

### D1: 只读扩展总原则

沿袭 C31/C32 批准的最小加法式扩展模式：只读不反写；有界分页（列表 ≤50、投影条目 ≤100）；服务端按当前会话签发授权并在返回前复验；无权、跨工程与不存在同形失败不可枚举；结果可由精确版本重放；新读由各 owning 模块适配器内部实现，不跨所有权直读私表。既有 `ProjectionQueryV1`、各查询/命令联合、端口签名与结果形状全部不变。

### D2: 新 query branch 与端口清单

五条 branch 全部走既有 `queryRoutes` 形态与传输信封，能力位全部复用既有枚举：

| Branch | Query kind | 能力位 | 新 ApiPortsV1 key |
|---|---|---|---|
| `risk-identification.run-list` | `run-list` | `risk-identification.read` | `riskIdentificationRead` |
| `risk-identification.run-read` | `run-read` | `risk-identification.read` | `riskIdentificationRead` |
| `risk-identification.record-catalog` | `record-catalog` | `risk-identification.read` | `riskIdentificationRead` |
| `risk-identification.record-read` | `record-read` | `risk-identification.read` | `riskIdentificationRead` |
| `review-audit.queue-read` | `queue-read` | `review-audit.read` | `reviewQueueRead` |

备选方案（否决）：实现投影契约预留的 `review-queue` queryType——复核任务不在投影表，投影适配器读取 `business.review_tasks` 属跨所有权直读私表，违背 D1；故由 review-audit 拥有方自行实现队列读。

### D3: 新契约 Schema（packages/contracts/src/ports/，全部 strict）

- `RiskIdentificationReadQueryV1Schema`：判别联合（by kind）——`run-list`（`{ cursor?, pageSize≤50, status? }`）；`run-read`（`{ runRef: WorkflowRunRefV1 }`）；`record-catalog`（`{ cursor?, pageSize≤50, processNodeId?, acceptanceKind?, identificationRunRef? }`）；`record-read`（`{ riskRecordRef: RiskRecordRefV1 }`，精确版本引用）。
- `RiskIdentificationReadResultV1Schema`：按 kind 判别——`run-list` → `items: { runRef, stage, status, triggerReason?, startedBy, startedAt, acceptedCount, pendingReviewCount, rejectedCount }[]` + `nextCursor?`（`triggerReason` 仅在有登记事实时输出：识别运行登记行当前不存触发原因，不得伪造，UI 缺省呈现"—"）；`run-read` → 运行状态摘要（`runRef`、I0–I9 阶段条目 `{ stage, status, failureCode?, retryable? }`、工序工作项覆盖条目、合并组摘要、Agent/复核任务引用集合、结果计数与验收/待复核/拒收引用集合，引用有界）；`record-catalog` → `items: { riskRecordRef, processNodeId, riskEventSummary, compositeConfidence, acceptanceKind, supersededBy? }[]` + `nextCursor?`；`record-read` → 记录信封（`riskRecordRef`、七字段正文、`riskMechanismEntryIds`、`sourceSegmentIds`、`evidenceLocator`、`modelConfidence`、`compositeConfidence` 及形成依据摘要、验收决定引用、`identificationRunRef`、`supersededBy?`、`auditTrailRef`）。列表项不含正文；`modelConfidence` 原样只读输出。
- `ReviewQueueReadQueryV1Schema`：kind `queue-read`，payload `{ reviewType?, status?, cursor?, pageSize≤50 }`；结果 `ReviewQueueReadResultV1Schema`：`items: { reviewTaskRef: ReviewTaskRefV1（完整，含 waitingRunRef 与 targetRef）, reviewType, triggerReason?, submittedAt, status, stale: boolean }[]` + `nextCursor?`。复核对象标签由调用方从 `targetRef`（kind + entityId + versionId）确定性渲染，契约不另设摘要字段（review_tasks 无摘要事实来源）；`triggerReason` 仅在有登记事实时输出；`stale` 由拥有方按目标引用版本与当前已成立版本比对计算。
- 新端口 interface：`RiskIdentificationReadPortV1.read`、`ReviewQueueReadPortV1.read`；`MODULE_BRANCH_CAPABILITY_V1` 增 D2 表 5 条目。
- 复用既有符号：`WorkflowRunRefV1Schema`、`RiskRecordRefV1Schema`、`ReviewTaskRefV1Schema`、`ReviewTypeV1Schema`、`querySchema`/`moduleResultSchema`/`branchCapability` helper。运行状态词汇复用既有运行状态枚举，不在 UI 层自造词汇。

### D4: 拥有方实现落点

- `RiskIdentificationReadPortV1` → 新增 `packages/adapters/src/identification/read/postgres-risk-identification-read.ts`：组合同模块既有 `PostgresIdentificationGraphAdapter` 的运行登记读取（`identification_graph_results`，其 `listRunRows` 目前只按精确 runId，模块内补按工程分页列举）与候选收口模块的标准化风险记录存储（`business.standardized_risk_records` 既有登记行）。同属 identification 所有权域内组合，不读其它模块私表，不新建表。
- `ReviewQueueReadPortV1` → 新增 `packages/adapters/src/review-audit/postgres-review-queue-read.ts`：读同模块 `business.review_tasks`/`review_decisions` 登记行；`stale` 由适配器按目标引用与当前版本比对计算；复用既有授权复验与同形失败形态。

### D5: 角色 branch 授予（packages/core/src/access/policy.ts）

`project-risk-manager` 经 `allBranches` 自动获得全部新 branch。按角色×界面差异矩阵加法授予：

- `reviewer`：+5 条新 branch（识别只读 4 + 队列读 1）；`retrieval-result` 已于 C32 授予，不变。
- `field-responder`：+4 条识别只读（风险识别区域只读）；不授予 `review-audit.queue-read`（复核区域不可见）。
- `business-viewer`：+4 条识别只读 + `review-audit.queue-read`（只读审计按授权）+ `knowledge-modeling.retrieval-result`（**闭合 C32 裁决**：检索结果作为识别运行详情的只读组成开放，证据原文仍由 evidence-access 独立把关）。

`system-administrator` 维持空集。既有 branch 授予不变。

### D6: demo 数据接入层扩展（零新依赖）

- `client.ts`：新增 `postCommand()`（与 `postQuery()` 同一信封/脱敏/取消语义，POST `/commands/:branch`，`commandId` 作幂等键可重放）；`KNOWN_CODES` 不动。
- `operations.ts`：新增识别域段落——`listIdentificationRuns`/`readIdentificationRun`/`listRiskRecords`/`readRiskRecord`/`readReviewQueue`（请求构造 + kind 校验 + 解码白名单，沿用 `asRecord/asArray/asString` 与 `drift()` 形态）；`submitReviewDecision`（decide-review 命令提交）；关联图 `readAssociationGraph` 与记录域 `readTraceChain`（复用既有投影两段读形态：projection.query → projection.result-read）。
- `context.ts`/`session.ts`：零改动复用；页面统一 `usePageQuery` + `PageStateView` + `useProjectPath`。

### D7: 页面映射与路由

| 页面 | 路由（参数化） | 数据来源 | 关键降级/边界 |
|---|---|---|---|
| IdentificationRunsPage | `/identification` | run-list | 移除假"启动识别"；空态引导 |
| IdentificationRunPage | `/identification/runs/:runId` | run-read（运行中定间隔轮询、终态停刷） | 等待复核/Agent 失败如实呈现；无跳过入口 |
| RiskRecordListPage | `/identification/records` | record-catalog | 等级 I–IV 筛列移除（评估域事实） |
| RiskDetailPage | `/identification/records/:recordId`（自 `/risks/...` 迁位，归识别导航） | record-read + evidence-access | 移除评估/预警/处置静态区块（C34 域）；modelConfidence 只读并列 |
| AssociationGraphPage | `/identification/graph` | projection.query(association-graph)+result-read | 不可证明即结构化失败/空态；分组列表降级视图用 record-catalog |
| EvidenceTracePage | `/review/trace?subject=<领域标识>` | projection.query(trace-chain)+result-read + evidence-access | 无主体引导空态；链尾缺席如实；无权限节点只显定位摘要 |
| ReviewQueuePage | `/review` | queue-read + decide-review 命令 | 过期任务禁决定；确认四要素；幂等重放 |
| RunRecordsPage | `/review/runs` | run-list + risk-overview 投影 run-summary | 移除假"审计重放"；单源失败不冒充完整 |

跳转矩阵中指向 C34/C35 域页面的链接（评估记录、预警、Agent 工作台）本 change 不新增；既有静态残留链接一并移除。`demo/src/content/` 中本 change 页面用到的静态业务数据（risks/review/evidence 业务字段、agent 运行摘要等）在接线后删除，界面配置保留。

### D8: 复核决定命令接线

队列条目自带完整 `ReviewTaskRefV1`，行内/批量"原样通过/拒绝"直接构造 `decide-review` 命令（decision 为对应 reviewType 的原样通过/拒绝形态 + `reasonCode`）：确认对话框列工程/对象/精确版本/预计结果/副作用五要素；`commandId` 作为幂等键，同一决定重放不重复生效；`stale` 任务按钮禁用并提示重新领取；命令失败（含陈旧版本、无权）呈现结构化原因，不伪造成功。批量提交前给确认摘要，逐项串行提交并汇总每项结果。决定按钮仅对具备复核决定能力的角色呈现，最终 enforcement 在服务端失败闭合。

### D9: 关联图与追溯链的失败闭合

关联图/追溯链只消费 C31 投影语义：主体可见性不可证明、边集合越界（>32 运行/1000 边）、来源资格不能证明、授权不足 → 呈现投影返回的结构化原因，不裁切、不编造、不降级为假完整图。识别侧链边无生产者时关联图对相关主体呈空态原因（预期行为，非缺陷）；本 change 不补写路径。图渲染复用 `demo/src/charts/GraphView.tsx` 与 `GraphLegend`。

### D10: 测试策略

- contracts：新 Schema/端口 strict 形状与判别联合测试（packages/contracts/test）。
- adapters：两个新读实现的 Postgres 测试（授权复验、有界分页、stale 计算、同形失败、可重放；复用既有 testcontainers fixture 模式）。
- apps/api：路由目录/OpenAPI/能力映射一致性、越权字段拒绝、未注入端口不激活。
- core：`access.test.ts` 扩展角色授予断言（恰为 D5 清单）。
- demo：浏览器验收（D11）为行为测试主体；demo 不引入单元测试框架。

### D11: 浏览器验收 harness 扩展

扩展 `demo/test/browser/server.mjs`：沿用既有 testcontainers PostgreSQL + 真实迁移 + 真实会话 + `buildApi` 模式，新注入两个只读端口；识别/复核夹具经 C32 已建立的 `putJson` 工件 + SQL 行播种惯例写入识别运行行、标准化风险记录行、复核任务行（含一条过期任务与一条待决定任务），投影夹具补 trace-chain/association-graph 可证明链边（沿 assessment/riskflow 图既有 link 写入者播种）。specs 并列新增（如 `identification-review.spec.ts`），覆盖：登录 → 八页可达与真实事实渲染 → 四态骨架 → viewer/responder 权限降级 → 证据脱敏 → 复核决定提交与重复提交幂等 → 深链直达与无权直达。`demo-chromium` project 配置不动。夹具角色沿用既有 operator/viewer/responder 三账号。

### D12: 依赖与迁移

不新增生产运行时依赖；不需要数据库迁移（新读全部落在既有表：identification_graph_results、standardized_risk_records、review_tasks/review_decisions、投影登记）。实施第一步复核当时 main 最大迁移序号（当前 `000053`），若被占用与本 change 无关（本 change 不新增迁移）。

### D13: RI/RA 追踪

识别运行/记录页 ← RI-S5～RI-S6；关联图与证据追溯 ← RI-S6（投影契约沿 RA-S5～RA-S7 链路）；复核队列 ← RI-S6 入库前人工复核与 C23 复核语义；证据抽屉 ← RI-S1～RI-S2。可追溯链（资料段 → 工序 → 机理 → 记录 → 评估/预警/处置）经 trace-chain 投影呈现，缺席链尾按投影缺席事实如实呈现。

## Risks / Trade-offs

- **读面形状首次公开**：新 Schema 一经发布即受 SSOT 约束。缓解：字段最小化、引用优先于正文、strict；列表项不含正文。
- **关联图对识别主体多为空态**：识别侧链边无生产者，页面价值受限。取舍：补生产者属写路径变更（C24/C30 域），留待后续 change；本 change 保证失败闭合与降级视图正确。
- **运行记录页双源聚合**：两个有界只读面前端并列呈现，跨来源排序只在各自分组内，不伪造统一时间序。
- **demo 独立 npm 项目**：请求/解码形状双写漂移风险，沿用 C32 缓解（显式白名单解码 + 真实接缝浏览器验收）。

## Migration Plan

无迁移。既有数据（识别运行登记、风险记录、复核任务、投影登记）即可被新读面消费。

## Open Questions

无。范围（启动向导/复核详情页 Non-goal）、取数路径（加法只读 + 既有决定命令）、`retrieval-result` 授予裁决与浏览器链路均已在本设计闭合。
