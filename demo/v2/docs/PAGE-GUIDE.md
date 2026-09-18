# 页面实现约定（PAGE GUIDE）

> 读者：M4 页面铺量的 11 个并行批次。每页交付前逐条对照本文件。
> 配套：`docs/DESIGN-SPEC.md`（设计系统）、`docs/page-manifest.json`（页面事实源）、`docs/GAP-LEDGER.md`（缺口台账）。

---

## 1. 页面注册与事实源

- `docs/page-manifest.json` 是 57 页的**单一事实源**：pageId / routeId / path / samplePath / title / domain / skeleton / change / branch / capability 全在其中。改页面元数据只改它。
- 路由由各域 `src/pages/<domain>/routes.tsx` 经 `routesForDomain('<domain>')` 程序化生成；M4 替换真实页面时，在对应域文件里把该页的 `render` 从 `PageScaffold` 换成真实组件，**不得**改 routeId / path。
- 参数化路径风格对齐生产（如 `/identification/runs/:runId`）；静态段优先于参数段，新增同级静态路径不存在的冲突由 `resolveRoute` 的参数计数排序兜底。
- `npm run check` 校验：57 条、ID/路径唯一、branch ∈ 53 个取值、capability ∈ 29 个取值、11 个域模块齐备。改完 manifest 必须跑。

## 2. 骨架选用规则

| 骨架 | 适用 | 必备区域（M4 按此铺） |
|---|---|---|
| A 列表 | 记录枚举、队列 | 上下文副标题 + 筛选栏 + 独立主操作区（右上）+ 表格 |
| B 详情 | 单对象查看/表单 | 标题区 + 字段分组卡 + 底部业务事件时间线；上下文走外壳停靠区 |
| C 运行 | 运行监控 | 运行头部七字段（运行标识/状态/阶段/触发原因/操作者/启动时间/幂等键）+ 阶段条（I0–I9 或 A0–A9）+ 子任务表 + 结果汇总 |
| D 治理 | 知识/规则版本治理 | 左：对象列表（审核状态筛选 chips）；右：修订表单（字段 diff + 提交说明）+ 版本列表 |
| E 复核 | 复核队列与决定 | 批量确认摘要条 + 证据对照区 + 决定表单（通过/修正并通过/退回 + 理由）+ 历史决定 |
| AG | Agent 页面 | 任务摘要头部 + 消息流 + 输入与待确认命令区 |
| A+C / A+B | 复合页 | 主从布局，两半各按 A/C 或 A/B 的必备区域 |
| 叠加形态 | 主从复合页 / KPI 横条网格 / 图谱画布 | 见 DESIGN-SPEC §5.3；KPI 网格固定页面顶部，图谱画布全宽 |

选骨架拿不准时：看 manifest 里同域同 change 的相邻页；仍拿不准，在缺口台账登记（G2 类），不要自行发明第七种骨架。

## 3. fixture 组织

- 位置：`src/content/<domain>.ts`（每域一个文件），命名导出；外壳上下文样例已在 `src/content/shell-context.ts`，参照其写法。
- 字段形状**以 `packages/contracts` 为准**，禁止沿用 v1 fixture 的字段形状。重点校正（G2 类）：
  - 关系三元组：契约字段为 `sourceElement / relation / targetElement`（RiskElementRelationSchema），引用齐备；页面列头用「源要素 / 关系 / 目标要素」；
  - 综合置信度：`compositeConfidence: { value, basis }` 对象，不是裸数字；
  - P/C 与等级：P、C 分值与风险等级分列，等级由矩阵版本映射得出，不预存等级文案；
  - 风险记录标识：`riskRecordId` 与 `externalRiskEventId` 二选一且仅一个；
  - 评估记录：必须含 `weightVersion`、`indicatorResults`、`kind`；
  - 预警触发：`triggerType` 为**单值**枚举（契约 `WarningRecordSchema.triggerType`）；多类触发经多条触发记录或 `triggerIndicators` 逐项的 `triggerType` 结构化表达；
  - 证据与审计：`evidenceReferences`、`audit` 字段按契约补齐。
- 风险矩阵与等级**数据驱动**：行/列刻度、等级文案、落点全部来自矩阵版本 fixture，禁止硬编码 5×5 或 I–IV。
- fixture 文案即页面可见文案，受文案红线约束（§7）。

## 4. 能力门控做法

- 页面级：manifest.capability 即 `requiredViewCapability`，框架层自动门控（denied → forbidden 态置灰，unknown → unavailable「权限检查中」）。页面组件**不写**能力判断分支，也不读取 `?roles`。
- 动作级：页内按钮按当前能力集三态渲染——allowed 可点；denied 置灰 + `aria-disabled` + visually-hidden 原因「需要能力 ×」；unknown 显示「权限检查中」。动作所需能力位从该动作对应 branch 在 `contract-mirror.data.json` 的映射取（例：发布新版本 → `knowledge-modeling.publish-approved-release` → `knowledge-modeling.govern`）。
- 动作名不得自行发明：P-OP-01 用 `SYSTEM_ACCESS_ACTIONS`（6 项），P-PJ-03/04 用 `PROJECT_MANAGER_ACCESS_ACTIONS`（4 项），见 `src/app/contract-mirror.ts`。
- `system-administrator` 是空能力集：任何「管理员可见全部」的写法都是错的。

## 5. 版本引用呈现（versionedRef）

- 评估、预警、处置相关页面必须显式呈现所引用的版本：适用规则集 / 风险矩阵 / 权重 / 机理库 / 提示模板 / 量化标准。
- 呈现格式：`<类别名> <entityId> · <versionId>`，用 `--font-mono`，例如「适用规则集 RS-001 · v2026.09」。版本引用构造用 `versionedRef(kind, entityId, versionId)`（`src/app/contract-mirror.ts`）。
- 版本引用是不可变快照语义：页面上不得出现「最新版」这类浮动引用文案。

## 6. 七态要求

每页七个状态都必须有设计且可经状态矩阵直达。除 ready 外各态统一由 PageFrame 承载：

| 态 | 要求 |
|---|---|
| idle | 「等待加载」提示（默认实现即可） |
| loading | 按页面骨架渲染骨架屏；`aria-busy="true"` |
| ready | 真实内容 |
| empty | 空态说明 + 如有时主操作（如「登记第一份资料」）；不给空表格 |
| error | **只显示** code / retryable（可重试|不可重试）/ requestId / references.kind；不得出现堆栈、内部信息或自造错误文案 |
| forbidden | 整页置灰 + 「需要能力 ×」；不显示任何业务数据 |
| unavailable | 区分「路由未接入」（route-not-integrated）与「权限检查中」（capability-check-pending），列原因码 |

M4 页面组合自身数据状态时，以 `input.pageState` 为框架层覆盖（强制态 > 门控 > 页面自然态），页面自然 ready 才能渲染自有内容。

## 7. 跳转矩阵与深链

- 页内跳转一律用 hash 深链 `href="#<path>"`；参数化目标用具体标识（如 `#/identification/runs/RUN-001`）。
- 追溯链入口（每页至少要回答自己落在哪一环）：资料段标识 → 工序节点 → 风险机理条目 → 标准化风险记录 → 风险评估记录 → 预警信息 → 处置建议 → 偏差记录/校准建议。详情页之间按此链互链：风险记录详情 → 评估记录详情（如已评估）；评估记录详情 → 预警详情（如触发）；预警详情 → 处置建议详情 → 执行登记 → 反馈与偏差 → 校准建议。
- 证据入口：涉及资料段的内容给「证据」链接，打开右侧停靠区 context 面板（M4 实现 EvidenceDrawer 等价物前先链接到 P-RV-04 证据追溯）。
- 禁止 `window.open` 与 `target="_blank"`（Electron 约束 #6）。

## 8. 文案红线（check-redlines 硬校验，含注释）

- 页面可见文案与代码注释中禁止出现：`identificationGraph`、`assessmentGraph`、`riskFlowGraph`、`TODO`、`FIXME`、`Mock`、`占位`、`兼容性说明`。
- 禁 Emoji；图标用 `src/components/icons.tsx` 的 1.5px 描边线性 SVG。
- 风险四级色只用于等级 / 越限 / 预警；等级必须带文字标签（颜色不作唯一信息载体）。
- 不放开发思路、内部说明；缺口与内部信息只出现在 `?gaps=on` 覆盖层与 `#/__review`（默认关闭）。

## 9. 批次划分（11 批，按域）

overview(1) → project(10) → knowledge(8) → identification(7) → assessment(7) → warning(4) → response(5) → agent(3) → review(6) → report(1) → ops(5)。每批完成标准：

1. 该域每页七态在状态矩阵逐格可审；
2. 该域 fixture 字段形状经 `packages/contracts` 核对；
3. 该域涉及的 GAP 条目在台账中更新（闭合或补充依据）；
4. `npm run build && npm run check` 全绿。

## 10. 图表使用约定（`src/charts`，M5 已交付）

- 一律从 `src/charts`（经 `index.ts`）import 五类图表与 `ChartSurface`；页面**不得自绘 SVG 图表**。
- 颜色只用组件默认 theme（全部走 `var(--*)` 令牌）；仅允许覆盖未显式传入的 color 字段，且覆盖值必须是令牌变量，禁写字面量 hex/rgb。
- 风险色只经三个受控通道进入图表：Donut/HBars 的 `exceeded`、GraphView 节点 `riskLevel`、矩阵 `tone: 'risk'`；不得自行拼风险色样式。
- 状态映射页面七态：数据为空 → `emptyMessage`（图表给专属空态，不是白板）；数据不可用 → `status="unavailable"` + `unavailableReasons` 原因码列表；组件内 `resolveChartStatus` 统一裁决，页面不重复实现。
- 矩阵必须用 `RiskMatrixVersionChart` + 版本化 config（`RiskMatrixVersionConfig`，来自 fixture，含 `entityId/versionId`）；**禁止在页面里写字面量矩阵定义**。`plots` 为空也要照常渲染空格阵，不可条件跳过。
- GraphView 的 `seed` 固定并写进 fixture，保证同种子同布局、评审可复现；`tone: 'risk'` 的边必须给 `label`（越限依据入图例）。
- 图例超过 6 项由 `ChartSurface` 自动折叠为「更多」，页面不做截断逻辑。
- 图例 marker：越限项用菱形（Donut/HBars），阈值用虚线（Trend），与 DESIGN-SPEC §4 图例规范一致。
