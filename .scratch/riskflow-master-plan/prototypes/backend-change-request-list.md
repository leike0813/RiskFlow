# 因 UI 需要的后端变更清单

本表是「因 UI 需要的后端变更清单」票（`.scratch/ui-redesign-spec/issues/06-backend-change-request-list.md`）的产出资产，属 UI 重做规格的一部分。

## 范围

只列新界面必需变更。历史字段区分已核与待核，不将未核统称能力缺口或已解决；批量决定不新增。

**聚合一律放服务端**。待办要跨复核/预警/治理三类对象、全局搜索要跨 8 类对象，靠前端编排会把权限复验与裁剪逻辑重写一遍，并泄露无权条目的存在性。

**本表只列变更，不改现有 spec 文本**。需要同步修改哪一条 spec，由施工期各 change 自行处理（`AGENTS.md` §3：以代码为准，开 drift 修正 change）。

## 现有查询面的三条硬约束

调查确认（`packages/contracts/src/ports/index.ts` + `packages/adapters`）：

1. **所有查询都是单工程 + 游标分页**。查询信封强制 `projectId` 且与授权上下文一致性校验（`ports/index.ts:1013-1022`）。**无跨工程、无服务端跨类型聚合。**
2. **投影查询不返回内容**，只返回 `queryResultRef`，内容一律经 `projection.result-read` 分页读回，条目只有 4 种通用形状（`run-summary` / `trace-link` / `report-fact` / `report-absence`，`ports:3040-3062`）。
3. **`ProjectionQueryV1Schema` 声明 7 种 queryType，C30 适配器只实现 4 种**（`postgres-workflow-projection.ts:352-356`、`:427`），其余走 `default → query-type-unsupported`。

## 变更清单

### B-1 总览仪表盘聚合投影（新增，最高优先）

**为什么必需**：新总览需要分布、变化时间线、待办摘要与接入概况；现有 `risk-overview` 是逐运行事实及缺席原因的报告展开，不提供这些聚合字段。这只证明该查询不足，不代表各域底层事实未采集。B-1 应复用已有评估、预警、复核等正式事实聚合，不新增无业务依据的数据采集。

**变更**：新增仪表盘专用聚合投影，一次返回：

| 区块 | 需要的数据 |
|---|---|
| 态势分布 | 风险等级分布、工序节点分布 |
| 变化时间线 | 风险/评估/预警的时序事件流 |
| 待办摘要 | 待复核数、待确认预警数、待处置任务数、按风险等级分组的待决事项 |
| 投料入口 | 资料与监测接入概况 |

**约束**：
- 各区块的指标口径**必须与对应列表页一致**（票 02 已定），避免同一数字两处不同——这是新增聚合投影存在的理由，不能又走前端编排。
- 聚合必须在服务端完成权限复验与裁剪，无权条目同形失败且不可枚举。
- 分页：趋势时间线与待办列表需要游标，分布统计一次性返回。

**归属 change**：新建，capability `projection.query` 扩展或新增仪表盘专用能力位。

### B-2 跨类型待办聚合查询（新增）

**为什么必需**：现有复核队列与warning overview不能替代四来源聚合；B-2归CH-9。生产来源为pending复核任务、未确认预警、真实待确认命令提案、成功读取且decision缺省的正式处置建议，不以fixture字段证明接口能力。

**变更**：服务端逐来源沿原域权限裁剪后计数/分页，`review-todo.read`仅入口权，不要求四域权限交集。命令必须返回 `commandProposalRef` 与真实可确认状态；服务故障不得视为未决。风险等级可选，缺省排有等级后，再以提交时间及精确主体引用稳定排序。Agent关联可选，返回前独立授权 `agent-task.read`，无权不披露标记/引用/存在性；reviewer无Agent权仍可复核。详情沿 `/review-audit/tasks/:taskId?version=:reviewTaskVersion` 精确task-detail，历史不依赖pending队列。七态、覆盖层与验收沿票10附件。

**归属 change**：CH-9；CH-2先交付入口授权与公共接缝，不提前撤旧承载。

### B-3 跨类型全局搜索投影（新增）

**为什么必需**：票 02 定全局搜索为主入口之一，票 05 原型已实现 ⌘K 面板。**全仓无全文检索契约**。

**关键约束**：**证据库的混合检索不能复用**。`KnowledgeRetrievalReadPortV1` 的 `retrieval-result`（`ports:4174`→`:4100`）入参被识别输入快照 + 工作项 + 策略三个引用锁死，只能读识别过程中已登记的检索结果，做不了任意关键词搜索。唯一现成带 `keyword` 过滤的是 `knowledge list-definitions`（`ports:4001-4003`），只覆盖知识定义。

**变更**：新增跨类型搜索投影，按关键词 + 对象类型搜索风险记录 / 资料 / 处置任务 / 复核任务 / 评估记录。

**需要决策的**：自建索引 vs 复用现有各域 catalog 的前缀匹配。前者能力完整但要建索引；后者成本低但匹配口径不一、无权条目存在性难处理。按票 02 的服务对象（管理员日常找得准），建议自建索引——但索引归属哪个模块、是否与知识库检索共用向量设施，属施工期决定。

**归属 change**：新建。

### B-4 处置闭环正文逐字段映射与关联任务反查（复用优先，GAP-033/034/035）

**已核事实**：`packages/contracts/src/ports/index.ts:5384-5471` 的 `forecast-read` / `execution-read` / `feedback-read` / `calibration-read` 均已有正文，不是只有引用。正式生命周期记录见 `packages/core/src/response-lifecycle/schema.ts:223-273,299-329`。关系页的引用列表不能据此推导正文不存在。

| 原读面 | 必须核对的界面映射 | 处置 |
|---|---|---|
| forecast-read | 预测内容、关联建议与精确版本、预测展示字段 | 复用既有正文与正式记录，逐字段对照票05 |
| execution-read | 执行内容、任务/建议关联、执行事实 | 同上 |
| feedback-read | 反馈内容、执行关联、实际值及偏差展示所需字段 | 同上 |
| calibration-read | 建议内容、偏差关联、确定性校验及整体决定 | 同上；不引入人工部分接受 |

**变更**：先形成既有读结果→界面字段映射；只有实际缺字段才扩既有Schema/读结果，禁止另建平行记录Schema。GAP-033/034/035原「无Schema/无正文」结论已纠正；具体展示字段覆盖度仍待核，不把未核当已解决。

依票 09，B-4 必须保全旧处置子记录到所属**预警处置任务**的精确关联。建议读面已有 `taskRef` 则直接复用；预测、反馈、校准及独立执行若不能沿现有公开精确引用闭合，才在所属域补窄读。通用 `resolve` 能解析对象自身不等于能反查所属任务；不能把此处任务误作 Agent 任务。任务与子记录各自授权，失败同形拒绝，不泄露解绑、跨工程或跨任务原因。

独立行动及其后续反馈／校准沿原精确读和命令保留独立视图；无任务关联不作为强制建任务或隐藏合法记录的理由。只有进入任务页签才需要完整父任务关联，原独立视图复用同一子记录组件，不新增业务状态机。

校准人工命令仅整体 `approve-draft-creation` / `reject` / `return-for-revision`（`ports:2329-2338`），逐项校验只供查看。沿精确子记录引用读取，父任务URL与记录参数分离（票07/09）。

**归属 change**：CH-7，复用所属域读面并只补实际关联缺口；待办来源到 Agent 的可选关联另归 B-2／CH-9，不与处置任务反查混为一项。

### B-5 处置任务记录 schema 与状态机（新增，GAP-027）

**为什么必需**：票 02 定处置任务详情是全站闭环枢纽，票 05 原型把它做成八环时间轴的承载页。现状：

- 公开面只有 `WarningResponseTaskRefV1Schema`（`ports:223`）一个引用
- 状态枚举 `WARNING_RESPONSE_TASK_STATUS_VALUES = ["open","closed"]`（`vocabulary:126-128`）只有两值
- 读视图有 `WarningTaskCatalogItemV1Schema`（`ports:5076`）与 `task-read`（`ports:5358`）
- **状态机不存在**：`WARNING_TASK_CLOSED_STATUS_V1`（`core/src/warning/schema.ts:46`）全仓除定义外零引用，写路径只落 `open`（`postgres-warning-lifecycle-adapter.ts:1443`），无任何关闭/流转命令

**变更**：① 建立处置任务的正式记录 schema；② 定义状态机与关闭命令。

**界面侧的配套决定**：**列表与详情暂不呈现关闭态**。不把后端还没有的能力画到界面上。票 05 原型显示的「任务闭环待定」是诚实的，保留该表述直到状态机落地。

**归属 change**：新建。

### B-6 导航授权链路核对（GAP-013）

v2全部denied不代表生产无授予；`core/access/policy.ts:22-44` reviewer已有risk-assessment.read、warning-response.read及review-audit.read，刻意无Agent权。

**变更**：核对导航→branch→capability→角色→会话，只修实际缺口。CH-2落实review-todo.read的branch/能力/角色与会话入口授权；不增域读写，Agent关联独立授权。

CH-2只交公共接缝，不提前撤旧承载；业务CH新承载、权限、历史深链验收后原子切换。两页签独立门控。

**归属**：CH-2；四既有web及platform shell用delta，不按导航重划能力。

### B-7 审计查询的跨类型与时间窗能力

**为什么必需**：票 02 定审计日志为面向合规查询的独立页，归治理。现有能力（`core/src/review-audit/ui-read.ts:130` 的 `activities`）：

- 单工程（信封 `projectId`）
- `sourceType` 是**审计来源分类**（business-audit / review-task / review-rejection / security-audit），不是业务对象类型
- 业务实体只能靠 `subjectRef` 单点定位
- **无 `from`/`to` 时间窗**，只有 `asOfRecordedAt` 上界

**变更**：明确审计页要什么。若只要「本工程的审计流水」，现状够用（前端 `AuditLogPage.tsx:92-95` 即如此用）；若要跨业务对象聚合或时间窗，需新增查询。**本票按"只要本工程流水"记，需扩展时随票 10 一并决定。**

**归属 change**：仅在需要扩展时新建。

### B-8 无需变更（明确排除，省一轮返工）

| 能力 | 结论 |
|---|---|
| **Agent 助手工作页签的四段数据** | **查询面齐备**。`AgentTaskReadQueryV1Schema` 的 `list`（按工程聚合，可过滤 taskType/status）、`detail`、`actions`、`candidates`、`validation`、`launch-context` 全部已实现（`core/src/agent-runtime/ui-read.ts:263`），`AgentTaskBudgetViewV1` 含策略上限与已用/已预留/墙钟。票 05 原型要的「工具行动 → 逐项校验决定 → 资源预算 → 正式结果」四段都能取到 |
| **追溯链** | `projection.query{trace-chain}` + `RiskRecordTraceReadPortV1`（`ports:3107`，最多 100 条精确 ref）已够。票 02 定追溯从独立页降为各详情页内能力，是**界面组织变化**，不需要新后端能力 |
| **关联图谱** | `association-graph` 投影已实现（`postgres-workflow-projection.ts:888-1003`），有明确上限 `MAX_GRAPH_LINKS_V1` / `MAX_GRAPH_PAGE_SIZE_V1`。票 02 定图谱页去掉重复列表卡，是界面变化 |
| **批量决定** | 不做。前端现有「批量通过」是逐条循环（`ReviewQueuePage.tsx:370-380`），`core/src/review-audit/ui-read.ts:157-158` 明确「不批量、不加新 bulk API」。待办若要做批量需另开 change——**本票不排** |

## 两处悬空能力（不在本票处理，但施工前须确认）

1. **`StructuredDocumentConversionCommandV1Schema`（`ports:1252`）契约有、HTTP 无路由**——`apps/api` 无引用。
2. **`WarningResponseTaskVersionV1Schema`（`core/src/warning/schema.ts:326`）与 `WARNING_TASK_CLOSED_STATUS_V1`（`:46`）疑似死代码**——后者确认零引用；前者需确认是否被组合根间接引用。

若把它们当作「已有后端能力」会误判。

## 汇总

| 编号 | 变更 | 类型 | 阻塞什么 |
|---|---|---|---|
| B-1 | 总览仪表盘聚合投影 | 新增 | 总览页（票 02 核心页面） |
| B-2 | 跨类型待办聚合查询 | 新增 | 停靠区待办（票 10） |
| B-3 | 跨类型全局搜索投影 | 新增 | ⌘K 主入口（票 02 核心入口） |
| B-4 | 四类正文映射及子记录→处置任务精确关联 | 复用／按实际缺口扩展 | 历史处置深链与详情 |
| B-5 | 处置任务记录 schema 与状态机 | 新增 | 处置任务详情为闭环枢纽 |
| B-6 | 导航与聚合入口授权链核对 | 只修实际缺口 | 原角色可达性，不扩大域权限 |
| B-7 | 审计查询扩展 | 条件 | 审计页是否需要时间窗/跨类型 |
| B-8 | 四项复用或不新增的边界 | 排除 | 避免重复建设 |

七项为候选变更包（B-7条件触发），不代表七项全须新增接口；B-4逐字段待核，只扩实际缺口。CH-2只交公共接缝及授权，各业务CH完成新承载、权限与历史深链验收后原子切换；保留既有四web能力与platform shell做delta，只新增design-system/dashboard/search-and-dock规格。
