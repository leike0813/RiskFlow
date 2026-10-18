# 业务对象 → 页面映射与新导航结构

本表是「业务对象 → 现有页面映射与新导航结构」票（`.scratch/ui-redesign-spec/issues/02-business-object-to-page-mapping.md`）的产出资产，属 UI 重做规格的一部分。用语一律遵守 `ui-vocabulary-mapping.md`。

## 诊断：现有导航为什么是七项

七项导航（`apps/web/src/shell/navigation.ts:15-65`）对应的是**七种页面类型**，不是七件事。`/overview` 是只读汇总、`/projects` 是资料与监测容器、`/identification` `/assessment` 是运行队列、`/knowledge` 是治理、`/review-audit` 是复核。管理员打开系统站在七项前，第一件事是判断"我该点哪个"——这正是"操作逻辑不满足期望"的来源。

**结构性缺陷（非观感问题）**：

1. **主入口不存在。** `/ops/*` 五页全站零链接（仅深链可达）；`/agent` 仅从右侧停靠栏进入；`/assessment/quality` 无导航无 Tab。
2. **`/knowledge` 是死的。** base contribution 的 `render` 为 `null`，且 `main.tsx` 未向 `App` 传 `capabilities`，导致它恒渲染「当前不可用 / permission-checking」（`App.tsx:241-247`）。知识区没有可用的 section 根页。
3. **二级导航不是路由树，是 5 份手写 Tab 常量**（识别 4 项、知识 4 项、复核 4 项、工程 3 项、评估 3 项、预警 2 项、系统管理 5 项），其中 `reviewTabs`、工程 Tab、`ReportExportPage` 仍指向旧前缀 `/review*`、`/project`，靠 `routes.ts:234-245` 的别名重定向兜着。同一份 `ASSESSMENT_TABS` 在三个文件各写一份。
4. **两套路由注册表元数据分歧**：同一 path 在 base 与 business 两处值不同（`/projects` base `list` → business `detail`；`/identification` base `run` → business `list`）。
5. **21 个页面双标题不一致**（见 `ui-vocabulary-mapping.md`）。

## 新导航树

**一级六项**（比现有七项少一项，但含工程）：

```
风险总览 · 工程 · 识别 · 评估 · 预警与处置 · 治理
```

**辅助入口**（不占一级）：

- **全局搜索** —— 主入口之一，搜风险/资料/处置任务/复核任务
- **停靠区（右侧）** —— 待办（复核任务）+ 智能助手
- **用户菜单** —— 系统管理（`/ops/*` 五页）

**工程占一级位的理由**：日常动线起点是投料，而资料与监测按原设计住在 `/projects/documents`、`/projects/monitoring`；若工程不作一级位，投料入口只能藏进工具区。工程本就是权限与数据归属的顶层边界（`CONTEXT.md`），占一位合理。

### 二级结构（最多两层）

| 一级 | 二级 | 归属 |
|---|---|---|
| 风险总览 | — | 多区块仪表盘，见下 |
| 工程 | 资料与监测 · 工程上下文（适用性/区段/修订）· 成员 · 开通 | 复用 `/projects/*` 5 条 + ui-spec 已规划未建的 P-PJ-02/03/04 |
| 识别 | 识别任务 · 风险记录 · 关联图谱 · 工序模型 | 复用 `/identification/*` 6 条 |
| 评估 | 待评估风险 · 评估记录（含重评估筛选）· 质量 | 复用评估规范承载；矩阵只读视图保留深链但不作导航项 |
| 预警与处置 | 预警 · 处置任务 | 复用 `/warnings` 4 条；吸收原 5 条 `/response/*` 的视觉承载，不删除子记录 URL 身份 |
| 治理 | 风险源清单 · 评分规则 · 指标体系与量化标准 · 措施库 · 风险矩阵 · 工序模型治理 · 规范标准库 · 类比工程案例库 · 检索结果 | 复用 `/knowledge/*` 5 条 + ui-spec 已规划未建的 P-KM-02/03/04/05 |

### 日常主路径

```
风险总览 → 上传资料 → 启动识别 → 风险记录 → 评估 → 预警 → 处置任务
```

投料入口做在总览仪表盘里（一个显眼的「上传资料」动作），不必先点进工程页。

## 风险总览仪表盘

**决定：完整仪表盘（多区块），接受与列表页的内容重复。** 重复本身可接受，前提是它是**聚合**（一眼看总体分布）而非**并列跳转**（把列表页搬上来）。

区块：

1. **态势分布** —— 风险等级分布、工序节点分布
2. **变化时间线** —— 最近发生的风险、评估、预警变化
3. **待办摘要** —— 待我复核的、待我确认的预警、待我处置的任务
4. **投料入口** —— 「上传资料」动作，接上主路径第一跳

现状评估/运行摘要由这些聚合区块组织；旧运行页落到 `/overview?tab=runs` 的有界运行摘要，旧复核队列根落到 `/overview?tab=todo`。CH3 承接运行摘要原有查询能力，CH9 承接待办，不能仅用无对应数据的锚点替代旧能力。总览聚合需要的查询变更见票 06，指标与对应列表同口径。

## 归位原则

### 原则 1：纯表单取消独立页面实现，从上下文就地发起

`/assessment/start` 永久解析到 `/assessment` 的就地发起动作，仍需显式选择完整风险输入与其他冻结引用，不擅自提交。`/response/executions/register` 合并入任务 `execution` 页签，旧地址继续精确解析任务与执行引用，不保留第二套登记页。

### 原则 2：处置闭环五条路由合并视觉，保留精确子记录身份

规范地址：

```
/warnings/tasks/:taskId?version=:taskVersion&tab=:tab&recordKind=:kind&recordId=:id&recordVersion=:recordVersion
```

另保留工程选择器 `project/revision/assessmentSources`。`version` 是任务版本，`recordVersion` 是子记录版本；路径任务引用与子记录 `kind/id/version` 分开授权。`WarningTaskPage.tsx:93-107` 已使用任务 `version`；旧子记录详情也各使用自己的 `version`，不能整串盲透传覆盖任务版本。

| 原路由及精确参数 | 新页签 | 所选 `recordKind` | 版本迁移 |
|---|---|---|---|
| `/response/recommendations/:recommendationId?version=RV` | `recommendation` | `response-recommendation` | 旧 ID/RV → `recordId/recordVersion`；任务 ID/版本取授权反查 |
| `/response/executions/register?task=T&taskVersion=TV&execution=E&version=EV` | `execution` | `execution-record` | T/TV → 路径/`version`；E/EV → `recordId/recordVersion` |
| `/response/predictions/:predictionId?version=RV` | `prediction` | `effect-forecast` | 旧 ID/RV → `recordId/recordVersion`；任务 ID/版本取授权反查 |
| `/response/feedback/:feedbackId?version=RV` | `feedback` | `feedback`（沿 FeedbackRefV1Schema） | 同上 |
| `/response/calibrations/:suggestionId?version=RV` | `calibration` | `calibration-suggestion` | 同上 |

纯登记只有任务引用时不带 `record*`，不得伪造执行。只有 execution 引用的旧地址，有任务关联则授权解析父任务，无任务但属合法独立行动则保留共享独立视图。缺版本旧链接只经所属域解析自身可见版本；已给版本不改成最新，保留原动作上下文，不把参数当授权。

新页签按所选 `record*` 直接精确读取，关系列表仅供浏览。已有建议返回 `taskRef`，其它上游引用只证明部分关联，`resolve` 自身版本解析不等于所属任务反查；进入任务页签所需的实际缺口由 CH7 补所属域窄读。合法独立行动不能被强制绑定任务：所属域证明执行或其反馈／校准可独立读取且无任务关联时，原精确 URL 用同一子记录组件呈现独立形态，保全原操作，不另建任务、不复制旧实现。

任务与子记录均保持原权限及工程/范围约束；拒权、反查失败或关系不可验证都显示同形拒绝/不存在，不透露解绑、跨工程或跨任务原因，不改读列表首条或任意当前对象。`CalibrationDetailPage` 的复核决定改为从上下文选择精确引用，不手输拼接。

### 原则 3：评估/业务视图入业务页，定义治理入治理页

| 对象 | 现状两视图 | 新归属 |
|---|---|---|
| 风险矩阵 | `/assessment/matrix`（冻结矩阵分组与落点）+ `/knowledge/matrix`（治理定义） | 业务落点进评估详情；`/assessment/matrix` 保留无导航共享只读视图，有精确评估记录上下文时进入详情矩阵区，否则保留冻结矩阵/输入引用及空网格能力，不跳任意当前记录；不新造列表矩阵浏览器，不复制旧实现。定义与版本仍归治理 |
| 评估记录 | `/assessment/records` + `/assessment/reassessments`（按风险输入组织同一批记录） | 合并为「评估记录」列表，按风险输入分组；重评估历史作为该列表的筛选维度 |
| 风险记录 | `/identification/records` + `/identification/graph` 内「按工序分组的风险记录」卡（`:146-166`） | 列表唯一在「识别 > 风险记录」；图谱页只保留图，去掉重复列表卡 |
| 运行 | `/identification` + `/review-audit/runs` + 总览运行摘要 | 业务运行分别归识别、评估、处置；旧跨类型运行入口解析至 `/overview?tab=runs` 的有界摘要，CH3 接住原有查询能力后才移除旧页面 |

### 原则 4：复核、追溯、审计的重新安置

| 现状 | 处置 |
|---|---|
| `/review-audit`（复核队列） | 归待办；永久解析入口最终落 `/overview?tab=todo`。CH9 未就绪前保留旧队列，不提前切断 |
| `/review-audit/tasks/:taskId?version=RV`（通用复核详情） | 精确 URL 保留。待办内为全屏覆盖层，直达/刷新为同视图全屏；返回/取消恢复合法短生命周期背景 URL，否则 `/overview`；仅留背景 URL，不缓存正文 |
| `/review-audit/identification/:taskId?version=RV`（识别候选复核） | 永久解析至同 taskId/RV 的通用复核 URL；保留识别六分支及全部其他类型合法决定，不压平为通用标签 |
| `/review-audit/trace?subject=:recordId` | 旧 `subject` 实际为风险记录 ID；经所属域授权窄解析精确版本后到 `/identification/records/:recordId?version=RV&tab=trace`。不扫描目录首页，不发明通用对象类型分流 |
| `/review-audit/audit` | 地址不改，保留独立审计页，归治理 |
| `/report/export` | 地址不改，保留报告导出承载，归治理 |

生产 `ReviewDetailPage.tsx:447-474` 已由 `useLocatedReviewTask` 直接按 taskId/version 调用 `readReviewTaskDetail`。历史已决定/已取代任务不依赖 pending 队列；完整任务引用与决定权限取详情返回，不能由 URL 拼出写权限。七态、失败恢复与类型分支仍须完整。

### 原则 5：ui-spec 已规划但生产无路由的 8 页全部列入新结构，标记待建

| 页面 ID | 名称 | 新归属 |
|---|---|---|
| P-PJ-02 | 工程开通与业务上下文表单 | 工程 > 开通 |
| P-PJ-03 | 空间区段与上下文修订 | 工程 > 工程上下文 |
| P-PJ-04 | 工程成员与资料访问 | 工程 > 成员 |
| P-PJ-08 | 接入任务 | 工程 > 资料与监测 |
| P-KM-02 | 工序模型治理 | 治理 > 工序模型治理 |
| P-KM-03 | 规范标准库 | 治理 > 规范标准库 |
| P-KM-04 | 类比工程案例库 | 治理 > 类比工程案例库 |
| P-KM-05 | 指标体系与量化标准 | 治理 > 指标体系与量化标准 |

另需修复 `/knowledge` 根页接线，保留该地址为可用治理根承载，不以 `render: null` 充当完成。

## 现有地址逐条清单与统计

来源：`apps/web/src/app/business-routes.ts` 的 49 条 seed **包含** `/login` 与 `/change-password`；base 另有 `/knowledge`，质量 contribution 另注入 `/assessment/quality`，共 **51 条现有模板**。下表每行恰列一个现有模板，`保留`表示规范承载，`解析`表示旧地址永久保留但不保留旧页面实现；工程选择器及对象版本不因表中省写查询串而删除。

| # | 现有模板 | 新承载/地址 | 类型 / 所属 CH |
|---|---|---|---|
| 1 | `/login` | 同址会话门禁 | 保留 / CH2 接缝不改认证 |
| 2 | `/change-password` | 同址会话门禁 | 保留 / CH2 接缝不改认证 |
| 3 | `/overview` | 同址总览，含 `tab=runs/todo` 定位 | 保留 / CH3；todo 由 CH9 |
| 4 | `/projects` | 同址工程概览 | 保留 / CH4 |
| 5 | `/projects/documents` | 同址资料列表 | 保留 / CH4 |
| 6 | `/projects/documents/:docId` | 同址精确资料详情 | 保留 / CH4 |
| 7 | `/projects/monitoring` | 同址监测入口 | 保留 / CH4 |
| 8 | `/projects/monitoring/:seriesId` | 同址精确监测序列 | 保留 / CH4 |
| 9 | `/identification` | 同址识别任务 | 保留 / CH5 |
| 10 | `/identification/runs/:runId` | 同址识别运行 | 保留 / CH5 |
| 11 | `/identification/records` | 同址风险记录列表 | 保留 / CH5 |
| 12 | `/identification/records/:recordId` | 同址风险详情，支持精确版本与 `tab=trace` | 保留 / CH5 |
| 13 | `/identification/graph` | 同址图谱，去重复列表卡 | 保留 / CH5 |
| 14 | `/identification/process-model` | 同址工序业务视图 | 保留 / CH5 |
| 15 | `/assessment` | 同址待评估与就地发起 | 保留 / CH6 |
| 16 | `/assessment/start` | `/assessment` 就地发起，不自动提交 | 解析 / CH6 |
| 17 | `/assessment/runs/:runId` | 同址评估运行 | 保留 / CH6 |
| 18 | `/assessment/records` | 同址评估记录，含重评估筛选 | 保留 / CH6 |
| 19 | `/assessment/records/:recordId` | 同址精确详情与矩阵区 | 保留 / CH6 |
| 20 | `/assessment/matrix` | 同址无导航共享只读矩阵；有精确记录时定位详情矩阵区 | 保留 / CH6 |
| 21 | `/assessment/reassessments` | `/assessment/records`，保留风险输入筛选与历史引用 | 解析 / CH6 |
| 22 | `/warnings` | 同址预警列表 | 保留 / CH7 |
| 23 | `/warnings/tasks` | 同址处置任务列表 | 保留 / CH7 |
| 24 | `/warnings/tasks/:taskId` | 同址任务精确引用，子记录用独立 `record*` | 保留 / CH7 |
| 25 | `/warnings/:warningId` | 同址精确预警详情 | 保留 / CH7 |
| 26 | `/response/recommendations/:recommendationId` | 任务 `tab=recommendation` + 建议精确 `record*` | 解析 / CH7 |
| 27 | `/response/executions/register` | 任务 `tab=execution` + 可选执行精确 `record*` | 解析 / CH7 |
| 28 | `/response/predictions/:predictionId` | 任务 `tab=prediction` + 预测精确 `record*` | 解析 / CH7 |
| 29 | `/response/feedback/:feedbackId` | 任务 `tab=feedback` + 反馈精确 `record*` | 解析 / CH7 |
| 30 | `/response/calibrations/:suggestionId` | 任务 `tab=calibration` + 校准精确 `record*` | 解析 / CH7 |
| 31 | `/knowledge/mechanisms` | 同址风险源清单 | 保留 / CH8 |
| 32 | `/knowledge/rules` | 同址评分规则 | 保留 / CH8 |
| 33 | `/knowledge/matrix` | 同址矩阵定义治理 | 保留 / CH8 |
| 34 | `/knowledge/measures` | 同址措施库 | 保留 / CH8 |
| 35 | `/knowledge/retrieval-result` | 同址精确检索结果 | 保留 / CH8 |
| 36 | `/review-audit` | `/overview?tab=todo`；CH9 前原队列仍服务 | 解析 / CH9 |
| 37 | `/review-audit/tasks/:taskId` | 同址 `?version=RV`，覆盖层/直达共享视图 | 保留 / CH9 |
| 38 | `/review-audit/identification/:taskId` | `/review-audit/tasks/:taskId?version=RV` | 解析 / CH9 |
| 39 | `/review-audit/audit` | 同址审计日志，归治理 | 保留 / CH8 |
| 40 | `/review-audit/trace` | 风险精确详情 `?version=RV&tab=trace` | 解析 / CH5 |
| 41 | `/review-audit/runs` | `/overview?tab=runs`，有界运行摘要 | 解析 / CH3 |
| 42 | `/report/export` | 同址报告导出，归治理 | 保留 / CH8 |
| 43 | `/agent` | 同址助手工作台，辅助入口 | 保留 / CH9 |
| 44 | `/agent/tasks/:taskId` | 同址 Agent 精确任务详情，原版本参数不改 | 保留 / CH9 |
| 45 | `/ops/access` | 同址用户菜单入口 | 保留 / CH9 |
| 46 | `/ops/data-sources` | 同址用户菜单入口 | 保留 / CH9 |
| 47 | `/ops/health` | 同址用户菜单入口 | 保留 / CH9 |
| 48 | `/ops/model-versions` | 同址用户菜单入口 | 保留 / CH9 |
| 49 | `/ops/backup` | 同址用户菜单入口 | 保留 / CH9 |
| 50 | `/knowledge` | 同址可用治理根，修复接线 | 保留 / CH8 |
| 51 | `/assessment/quality` | 同址质量视图 | 保留 / CH6 |

**统计分开计算**：40 个规范承载（含 2 个会话门禁）+ 11 个永久旧解析入口 = 51 条现有模板身份全部可达。8 个规划未建页面另见上表，不混入现有模板或假定已有规范路径。既有 `/project/*`、`/review/*`、quality 旧名的精确别名清单见路由附件，亦不混入 seed 数。六导航是入口数，不是 URL 数；不再以“约 24 条正式可达路由”为验收断言。

## 切换与规格分工

保留九个 CH 工作包及既有四个 web capability 的 delta，公共壳层/路由沿 `platform/web-shell-interaction-primitives` delta；设计系统/总览/搜索与停靠区新规格只收新行为，不按导航重划或 supersede 旧 capability。CH2 准备公共导航/路由接缝与能力授权，不发布删旧入口的六导航。CH3–8 在各自新承载、权限和历史深链验收后原子启用对应重定向并移除旧页面实现；共享图表/详情只保留一套。CH9 可并行开发，最终六导航、待办与停靠区组合启用依赖 CH3–8 就绪；之前原复核队列必须可用。构建顺序不等于发布顺序。

## 遗留风险

1. 进入任务页签所需的子记录关联不能靠目录首页推断，实际窄读缺口由 CH7 闭合；合法独立行动及后续反馈／校准保留原精确 URL 与共享详情形态，不因无父任务丢失原能力。旧 trace 的 `subject` 解析由 CH5 闭合。
2. 复核合并须保全识别六分支及其他复核类型分支，历史任务精确读取、失败恢复和原权限不变。
3. 总览与列表须共用统计口径；运行摘要/矩阵/追溯不能只换入口而丢原能力或冻结版本。
4. 匹配契约是逐段精确匹配及交集的静态段优先，相同具体度交集注册时拒绝；`/warnings/abc/actions` 不是误匹配依据，真正交集 `/warnings/tasks/actions` 归 tasks。不得用三键排序替代这一可观察行为。
5. 旧地址是永久解析入口，不绑定 C38 移除，不保留第二套旧页面；原查询投影能否下线须核查真实调用者，不能由入口减少推断。
