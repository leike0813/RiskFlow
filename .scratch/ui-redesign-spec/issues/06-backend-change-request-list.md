# 因 UI 需要的后端变更清单

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

已决定：规格里要显式标出需要的后端变更（查询投影/接口），本 effort 不施工。但清单的内容本身需要定下来，否则规格是空的。

**基于「业务对象 → 页面映射」和「GAP 台账重判」的结论，列出为支撑新界面所必需的后端变更** —— 需要定下来。

具体要回答：

1. 新导航树要求的新入口（如"本工程今日风险""待我处置的预警""在跑的识别评估"）需要哪些**新的查询投影**？现有投影能否通过编排已有数据得到，还是要新增服务端查询？
2. 「追溯」在新结构里是每个业务对象详情内的能力 —— 这要求详情接口返回什么，才能一次渲染出「资料段 → 工序节点 → 机理条目 → 标准化风险记录 → 风险评估记录 → 预警信息 → 处置建议 → 偏差记录 / 校准建议」这条完整链？现有 `EvidenceTracePage` 与各详情接口的差距在哪？
3. 「风险为什么是这个等级」要一眼看懂 —— 需要详情接口额外返回什么？（指标实际取值、规则命中项、权重构成、P/C 推导步骤、矩阵落点）这些现在是否已经在返回体里、还是需要展开？
4. 哪些页面被判定合并或删除后，原有接口是否变成无人调用、可以下线？
5. 每条后端变更归到哪个后续 change（按业务对象切还是按能力层切），以及它的 OpenSpec spec 影响面。

产出是一张可施工的变更清单，每条含：目的、涉及的业务对象、现状差距、预估影响面、归属 change。

## 由票 03 转入本票的输入

来源：`.scratch/riskflow-master-plan/prototypes/gap-ledger-adjudication.md`。台账是历史设计意图；以下区分已核事实、实际缺口与待核字段，不把未核条目统称仍然成立。

**最高优先级（挡住票 02 已定的总览仪表盘）**：

| 台账 | 缺口 | 为何最高优先 |
|---|---|---|
| GAP-050 | `risk-overview` 投影内容形状未入契约 | 票 02 已定总览为多区块仪表盘（态势分布 + 变化时间线 + 待办摘要 + 投料入口），投影形状未定则仪表盘无法施工 |
| GAP-051 | 总览趋势序列选取规则未规格化 | 与 GAP-050 同批；且须遵守票 04 转入的「仪表盘指标口径必须与对应列表页一致」 |

**导航可达性（影响新一级导航）**：

| 台账 | 缺口 |
|---|---|
| GAP-013 | v2断言不能照搬生产；reviewer已有risk-assessment.read/warning-response.read/review-audit.read且无Agent权。B-6核对导航→branch→capability→角色→会话，只修实际缺口 |

**记录 schema 缺口（挡住票 02 已定的处置任务枢纽页）**：

| 台账 | 缺口 | 备注 |
|---|---|---|
| GAP-027 | 预警处置任务无记录 schema 与状态机枚举 | 处置任务详情是新闭环枢纽，七类关系页签依赖此 schema |
| GAP-033 | 已有forecast-read正文与正式记录 | 逐字段映射待核，缺字段才扩既有Schema |
| GAP-034 | 已有execution-read/feedback-read正文与正式记录 | 同上，不新建平行Schema |
| GAP-035 | 已有calibration-read正文与正式记录 | 同上，人工只作整体三类决定 |
| GAP-038 | 批量确认无契约批量决定命令 | 复核进停靠区待办后，批量操作是队列页高频动作 |

**系统管理契约缺口**：

| 台账 | 缺口 |
|---|---|
| GAP-041 | 系统管理六动作无能力位映射，动作级门控缺身份信号 |
| GAP-042 | 数据源适配器与连接定义无契约记录与命令 |
| GAP-043 | 模型部署与提示模板版本登记无契约 schema |
| GAP-044 | 备份策略、恢复点与恢复操作无契约 schema 与命令 |

**Agent 契约缺口**：

| 台账 | 缺口 |
|---|---|
| GAP-045 | Agent 任务的工具行动（含白名单外拦截）无记录 Schema |
| GAP-046 | Agent 增量逐项确定性校验决定无记录 Schema |
| GAP-047 | Agent 任务资源消耗计数与硬预算对比无契约字段 |
| GAP-049 | 交互 Agent 会话消息流无契约 Schema |

**治理状态词汇**：GAP-020 部分解决（`packages/contracts/src/vocabulary/index.ts:131,134` 已有 `pending-review`、`approved-for-draft`），需核对是否覆盖新治理区全部状态。

**后端契约待清项**：GAP-012/014/015/016/017/018/022/023/024/026/028/030/031/036/039/040/052/053 尚未逐项核对，不能记为已解决或已确认缺口；实施前逐字段核对现端口。导航重组不自动消除字段语义或历史深链约束。

**GAP-040待核**：新承载、权限与历史深链验收通过后原子切换，不能因页面重组预先下线接口。

## Answer

产出资产：[因 UI 需要的后端变更清单](../../riskflow-master-plan/prototypes/backend-change-request-list.md)。

**范围决定**：只列因新界面必需变更；未核字段不统称缺口或已解决。聚合服务端按来源原权限裁剪，入口权不扩域权。

**调查确认的三条硬约束**：
1. 所有查询都是**单工程 + 游标分页**，查询信封强制 `projectId` 且与授权上下文一致性校验（`ports/index.ts:1013-1022`）。无跨工程、无服务端跨类型聚合。
2. 投影查询**不返回内容**，只返回 `queryResultRef`，内容经 `projection.result-read` 分页读回，条目只有 4 种通用形状（`ports:3040-3062`）。
3. `ProjectionQueryV1Schema` 声明 7 种 queryType，**C30 适配器只实现 4 种**（`postgres-workflow-projection.ts:352-356`、`:427`），其余走 `default → query-type-unsupported`。

**七项需新增或修复（B-1…B-7）**：

- **B-1 总览仪表盘聚合投影**：现有 `risk-overview` 是逐运行事实展开，不返回新仪表盘所需的聚合字段；不能据此断言底层事实没有采集。复用各域已登记事实在服务端聚合，固定统计范围与列表口径，不另加无需求的数据采集。
- **B-2 跨类型待办聚合查询**：归CH-9，沿四来源真实状态取数，命令必须有 `commandProposalRef`；处置建议成功读取且decision缺省才属未决，故障不变待办。`review-todo.read`仅入口，各来源按原权限逐项裁剪；Agent关联可选且返回前独立授权。风险缺省排后，时间与精确主体引用稳定排序。详情保留 `/review-audit/tasks/:taskId?version=:reviewTaskVersion`，历史用task-detail窄读，不扫描pending。
- **B-3 跨类型全局搜索投影**：全仓无全文检索契约。**关键约束：证据库的混合检索不能复用**——`retrieval-result`（`ports:4174`→`:4100`）入参被识别输入快照 + 工作项 + 策略三引用锁死，只能读识别过程中已登记的结果。唯一现成带 `keyword` 的是 `knowledge list-definitions`（`ports:4001-4003`），只覆盖知识定义。建议自建索引（匹配口径统一），索引归属属施工期决定。
- **B-4 既有正文映射与子记录→处置任务关联**：四个读面已有正文及正式生命周期记录，先逐字段映射票 05，仅实际缺字段才扩既有 Schema，不新建平行记录。复用建议读面的 `taskRef`；其它子记录若不能沿现有精确引用闭合，再由 CH-7 在所属域补授权窄读。此处任务是预警处置任务，不是 Agent 任务；`resolve` 自身版本解析不代表反查已存在。校准逐项查看校验，人工整体三类决定。
- **B-5 处置任务记录 schema 与状态机**（GAP-027）：状态机**不存在**——`WARNING_TASK_CLOSED_STATUS_V1`（`core/src/warning/schema.ts:46`）全仓除定义外零引用，写路径只落 `open`（`postgres-warning-lifecycle-adapter.ts:1443`）。**界面配套决定：列表与详情暂不呈现关闭态**，不把后端还没有的能力画到界面上；票 05 原型的「任务闭环待定」是诚实的，保留到状态机落地。
- **B-6导航授权核对**：生产已有授权复用，逐项核对导航→branch→capability→角色→会话传递；CH-2落实review-todo.read入口授权，不增加域权、不以Agent权阻塞reviewer。
- **B-7 审计查询扩展**（条件）：现有 `activities`（`core/src/review-audit/ui-read.ts:130`）单工程、`sourceType` 是审计来源分类而非业务对象类型、业务实体只能靠 `subjectRef` 单点、**无 `from`/`to` 时间窗**。本票按「只要本工程流水」记（现状够用），需扩展时随票 10 决定。

**明确排除四项（B-8），省一轮返工**：
- **Agent 助手工作既有任务查询面复用**——list/detail/actions/candidates/validation 与预算读面可复用；待办来源到 Agent 的可选关联属 B-2／CH-9，返回前单独授权，不与 B-4 的处置任务关联混淆。
- **追溯链无需变更**——`trace-chain` 投影 + `RiskRecordTraceReadPortV1`（`ports:3107`）已够；票 02 定追溯降为详情内能力是**界面组织变化**。
- **关联图谱无需变更**——`association-graph` 投影已实现（`postgres-workflow-projection.ts:888-1003`）；票 02 定图谱页去掉重复列表卡同样是界面变化。
- **批量决定不做**——前端现有「批量通过」是逐条循环（`ReviewQueuePage.tsx:370-380`），`core/src/review-audit/ui-read.ts:157-158` 明确「不批量、不加新 bulk API」。

**两处悬空能力（不在本票处理，施工前须确认）**：`StructuredDocumentConversionCommandV1Schema`（`ports:1252`）契约有 HTTP 无路由；`WarningResponseTaskVersionV1Schema`（`core/src/warning/schema.ts:326`）与 `WARNING_TASK_CLOSED_STATUS_V1`（`:46`）疑似死代码。若当作「已有后端能力」会误判。

**CH-2授权落点**：落实 `review-todo.read` 的branch→capability→角色授予及会话能力传递；入口不增域读写权，reviewer无Agent权仍可复核。forbidden只隐藏受限页签，不影响有权助手。CH-2只交公共接缝，不提前撤旧承载；各业务CH验收新承载、权限与历史深链后原子切换。四既有web与platform shell用delta，仅新增design-system/dashboard/search-and-dock规格。验收含本域缺权、Agent关联拒绝、同键稳定排序与历史已决定任务直达（票10附件）。
