# UI 设计系统规范（令牌 / 基础组件 / 布局骨架）

本表是「设计系统三层」票（`.scratch/ui-redesign-spec/issues/04-design-system-three-layers.md`）的产出资产，属 UI 重做规格的一部分。

## 基线事实

**令牌输入基线**：前期勘察记录 v2 为 70 个变量、生产为 30 个变量；两者沿用同一套颜色与字体基础，但 `--nav-width` 已存在 `224px` 与 `16rem` 的差异，不能视为全部同名值不变。v2 的间距、字号行高、动效与焦点令牌作为迁移输入，最终采纳范围及覆写以本规范为准。

**生产样式现状**：52 个 CSS 文件共 5033 行，分三套血缘——`theme/tokens.css`（30 变量，注释声明抄自 `report-screenshot-design.md §3`）、`shell/AppShell.css`（C10 老样式 `system-ui` + 硬编码三列网格 `16rem 1fr 22rem`）、约 30 个页面级 CSS 各写各的。`components/AppShell.tsx` 是空壳别名（只输出 `data-page-section`/`data-agent-context`），无生产挂载。

**组件层现状**：`components/` 13 个组件（Card、DataTable、PageStateView、SectionTabs、StatusTag、StageBar、Timeline、ConfirmButton、EvidenceDrawer、KpiCard、WarningBadge、GraphLegend、AssociatedObjects）+ `shared/page-shells/` 5 个骨架 + `PageFrame`。无 UI 库、无状态管理、无 CSS 框架、无图标库（`icons.tsx` 自绘）。

**图表层现状是混合的**：`charts/` 已有 v2 的 `ChartSurface.tsx` 接缝抽象（落地了）、`types.ts` 的 `ChartStatus = "ready"|"empty"|"unavailable"` 三态（落地了）、`DEFAULT_CHART_THEME`；同时 DonutChart/HBars/TrendLine/GraphView 用 echarts 5.6.0，`RiskMatrix5x5.tsx` 用纯 CSS 网格，`RiskMatrixChart.tsx` 不含 echarts。

**已确认的硬编码缺陷**：`RiskMatrix5x5.tsx` 把 5×5 写死——`[5,4,3,2,1].map` 固定五行、`[1,2,3,4,5].map` 固定五列、`hlRow = 5 - highlight.p` 反算索引、`levelClass` 按 `lv` 字面量映射。**当前合成配置是 3 可能性档 × 2 后果档**，此组件会渲染出两行三列全空的错乱网格。

## 令牌层

### 事实源

**本规范是设计系统的 planning 输入**，使用 v2 的语义与初始值，但尺寸和错误色按下文决定覆写。CH-1 将采纳值迁入 `apps/web/src/theme/tokens.css`，该文件成为生产令牌值的唯一来源；对应 OpenSpec 固定语义约束。`demo/v2/src/theme/tokens.css` 与 `DESIGN-SPEC.md` 只作只读参考，不成为生产依赖。

`report-screenshot-design.md` 降级为截图派生文档，只描述汇报图取景与内容。生产 `tokens.css` 头注释改指对应设计系统规格，不再指向截图或原型文件。

### 令牌分组

下表记录 v2 的输入分组，不是生产冻结清单。生产尺寸采用左导航 `152px`／`48px`，右停靠区 `22rem`；不采纳自绘标题栏拖拽区和 CSS 窗口最小尺寸令牌。新增操作错误令牌 `--error: #b42318`、`--error-soft: #fef3f2`，仅表达表单校验和操作失败，不表达风险等级。

| 组 | 变量 | 数量 |
|---|---|---|
| 框架底色 | `--nav-bg` `--topbar-bg` `--page-bg` `--card` `--border` | 5 |
| 文本 | `--text` `--text-2` | 2 |
| 工程蓝 | `--blue` `--blue-soft` | 2 |
| 风险四级 | `--risk-1..4` + `--risk-1-dark` + `--risk-1..4-soft` + `--risk-3-text` | 11 |
| 状态 | `--success(-soft)` `--review(-soft)` `--bluegray(-soft)` | 6 |
| 字体 | `--font` `--font-mono` | 2 |
| 字号行高配对 | `--text-xs..--text-kpi` + 各自 `-lh` | 16 |
| 间距 | `--space-1..7` | 7 |
| 圆角 | `--radius-sm/md/lg/full` + `--card-radius` + `--card-shadow` | 6 |
| 动效 | `--dur-fast/base/slow` + `--ease-standard` | 4 |
| z-index | `--z-nav` `--z-topbar` `--z-dock` `--z-overlay` `--z-review` | 5 |
| 断点 | `--bp-compact` 48rem `--bp-shell` 64rem `--bp-wide` 90rem | 3 |
| 框架尺寸 | `--nav-width` `--nav-width-compact` `--topbar-height` `--dock-width` `--agent-dock-width` `--drag-region-height` `--window-min-*` | 8 |
| 焦点环 | `--focus-ring` | 1 |
| **合计** | | **70** |

**硬约束三条**：

1. **字号行高必须成对使用**（`--text-md` 必配 `--text-md-lh`），不得拆配。理由：拆配是生产页面级 CSS 各写各的直接成因之一。
2. **暗色只保留令牌结构，不做切换 UI**。`[data-theme='dark']` 已给全 42 个变量的暗色值，但本期不提供切换入口。是否落地由生产端后续决定。
3. **工程蓝是唯一强调色**。AntD 主题色必须映射到 `--blue`/`--blue-soft`，不允许 AntD 默认蓝成为第二套蓝。`--bluegray` 是中性/未开始色，不得当强调色用。

### 风险四级色的防退化机制

**风险色只表达等级、越限与预警，并使用同一受控等级配色映射。** `RiskBadge` 与风险图表共用该映射，输入为当前记录所引用配置的等级标识、顺序与显示名，不按格子位置或 `level-1..4` 字面量猜测。徽章带文字；矩阵格、图例和图表落点有对应文字或可访问说明。

页面 CSS 与 AntD 的默认彩色 Tag/Badge/Alert 不直接选择风险色。操作错误使用 `--error`／`--error-soft`，不映射到任一 `--risk-*`；即使颜色接近，也不共用风险等级语义。

## 基础组件层

### 引入 Ant Design

**决定引入 `antd`**，作为基础组件层的主要来源。

**三条必须写死的覆写约束**：

1. **AntD 主题色映射到生产语义令牌**——`ConfigProvider` 的 `token.colorPrimary` 使用 `--blue` 对应值、`colorSuccess` 使用 `--success`、`colorError` 使用独立的 `--error`。不允许保留第二套默认蓝，也不将表单错误映射为风险等级。
2. **风险等级不由 AntD 默认颜色决定**——不用 `Tag.color="red"|"orange"|"yellow"|"green"` 推断等级。徽章与图表经同一受控等级配色映射输出。
3. **视觉类组件不直接用 AntD**——`Card`、`Tag`、`Badge`、`Alert`、`Statistic` 保持自建或用现有实现，只在 AntD 强项处使用（见下）。

**AntD 的使用边界**（强项）：

- `Form` / `Form.Item`——替换 `StartAssessmentPage`、`ExecutionRegisterPage` 等现下手填标识的表单（票 01 要求改为从上下文选取，Form 的受控校验正好承接）
- `Table`——列筛选、排序、固定列
- `DatePicker` / `TimePicker` / `RangePicker`——监测截止点、监测批次时间窗
- `Select` / `Cascader` / `Tree`——工程区段树、工序节点选择
- `Modal` / `Drawer` / `Popconfirm`——受控命令确认
- `Descriptions`——详情页的字段组
- `Empty` / `Spin` / `Skeleton`

**迁移策略：不硬迁移。** 新页面直接用 AntD；现有 13 个组件与 46 个页面组件逐步收拢，不要求一次性替换。这样与其他 change 的施工不冲突。

### 组件清单（基础层）

| 组件 | 来源 | 状态 |
|---|---|---|
| `Button` | AntD | 新 |
| `Form` / `Form.Item` / 受控选择器 | AntD | 新，替换手填 ID 表单 |
| `Table` | AntD | 新 |
| `DatePicker` / `RangePicker` | AntD | 新 |
| `Select` / `Tree` / `Cascader` | AntD | 新 |
| `Modal` / `Drawer` / `Popconfirm` | AntD | 新 |
| `Descriptions` | AntD | 新 |
| `Empty` / `Spin` / `Skeleton` | AntD | 新 |
| `Card` | 自建（现有） | 保留 |
| `DataTable` | 自建，逐步退化为 AntD `Table` 的薄封装 | 保留待收 |
| `PageStateView` | 自建（现有，七态） | **保留，不换**——七态是 v2 冻结契约（票 02 与 `full-product-ui-spec.md` 均已确认） |
| `SectionTabs` | 自建，逐步替换为路由派生 | 保留待收 |
| `StatusTag` | 自建（治理状态） | 保留，但须补 GAP-020 缺失的状态枚举 |
| `StageBar` | 自建（运行阶段） | 保留 |
| `Timeline` | 自建 | 保留 |
| `ConfirmButton` | 自建，保留唯一确认控制器，AntD `Modal` 仅替换呈现 | 保留原精确版本、冻结请求、取消及幂等语义 |
| `EvidenceDrawer` | 自建（证据脱敏两态） | **保留，不换**——脱敏两态是契约要求 |
| `KpiCard` | 自建 | 保留（对应票 02 的仪表盘 KPI 区） |
| `WarningBadge` | 自建 → 合并入 `RiskBadge` | 收拢 |
| `RiskBadge` | 新建，与风险图表共用受控等级配色映射 | 风险文字标签与可访问说明 |
| `GraphLegend` | 自建 | 保留 |
| `AssociatedObjects` | 自建 | 保留 |
| `icons.tsx` | 自绘（1.5px 描边线性，禁 Emoji） | 保留；AntD 自带 `@ant-design/icons` 不引入，保持线性图标统一 |

**清理项**：`components/AppShell.tsx` 空壳别名随本 change 删除。

## 布局骨架层

### 骨架模型：从单值枚举改为区域块数组

台账 GAP-002/003/004 的根因是骨架用单值枚举（A/B/C/D/E），无法表达复合页。**改为区域块数组**：骨架 = 有序区域块列表，每块声明类型。

```ts
type Region =
  | { kind: "list"; ... }
  | { kind: "detail"; ... }
  | { kind: "form"; ... }
  | { kind: "chart"; variant: "donut" | "hbars" | "trend" | "graph" | "matrix"; ... }
  | { kind: "timeline"; ... }
  | { kind: "matrix-grid"; ... }
  | { kind: "tabs"; ... }
  | { kind: "agent"; ... };

type PageSkeleton = readonly Region[];
```

- **A 列表 / B 详情 / C 运行 / D 治理 / E 复核** 成为单块特例（`[{kind:"list"}]` 等），保持既有词汇不丢失；
- **复合骨架 A+C / A+B** 成为两元素数组，不再需要新枚举值（GAP-002 解决）；
- **Agent 专用骨架** 成为 `[{kind:"agent"}]`（GAP-003 解决）；
- **主从复合页 / KPI 横条网格 / 图谱画布** 分别对应多块数组、`[{kind:"chart", variant:...}]` 加 KPI 排布、`{kind:"chart", variant:"graph"}`（GAP-004 解决）。

**P-OV-01 是票 02 定的新多区块仪表盘**，其骨架就是四块数组：态势分布（chart）、变化时间线（timeline）、待办摘要（list）、投料入口（action）。

### 布局网格

**新导航树下的布局**：

- 左导航 `--nav-width: 152px`，由用户折叠为 `--nav-width-compact: 48px`；右停靠区 `--dock-width: 22rem`，可由用户收起，主区占剩余宽度。尺寸定义在生产令牌中，不在页面重复硬编码。
- 不沿用原型的 `64rem` 自动改为 `13rem` 导航、停靠区下沉规则。窗口变窄或缩放时保留桌面信息结构，用户仍可收起两侧面板；表格、矩阵等二维内容在自身区域滚动，正文及表单可折行。
- 不禁用浏览器缩放，不裁掉确认、取消、页签或焦点控件。覆盖层和对话框允许内部滚动，固定工具栏不得遮挡聚焦项。
- 桌面验证覆盖 `1280×720`、`1440×900`、`1920×1080`，各在 `100%` 与 `200%` 缩放下检查导航、待办、表单与确认。允许增加滚动，不要求所有指标在同一物理屏幕内显示；不包含移动端适配。

导航六项（票 02）：风险总览 / 工程 / 识别 / 评估 / 预警与处置 / 治理。

### 图表层

**统一到 echarts，保留 `ChartSurface` 接缝。**

`ChartSurface` 保留的职责：空态（有结构无数据点，显示图表框 + 坐标/图例骨架 + 「暂无可显示内容」）与无数据态（数据源缺失，不渲染图表框，显示不可用说明与原因码，对齐 `PageFrame` 的 `unavailable`）。**这已是 v2 规范且生产已有该组件，直接沿用。**

图表遵循 `DESIGN-SPEC.md §4` 的视觉约定：主数据色一律工程蓝；风险四级色只允许表达等级/越限/预警；五类图表 donut / hbars / trend / graph / matrix。

**数据驱动硬约束**：`RiskMatrix5x5` 的 5×5 硬编码必须消除（当前 `[5,4,3,2,1].map` / `[1,2,3,4,5].map` / `hlRow = 5 - highlight.p` / `levelClass` 字面量映射）。矩阵图的行列数、等级色映射、落点高亮**全部从配置返回的 `possibilityAxis.bands` / `consequenceAxis.bands` / `riskLevels` / `cells` 派生**，不得按格子位置或固定档数假定。真实配置为 3×2 × 4 级，当前组件会渲染出两行三列全空的错乱网格。`charts/` 6 个组件均需逐一核查是否隐含固定维度。

**v2 要求「图表一律 SVG」这条红线作废**——生产已用 echarts 5.6.0 且它是既有依赖，不为满足原型红线而重写全部图表。`DESIGN-SPEC.md §4` 中「实现留给 M4」的前提已不成立，规范升为 `design-system-spec.md` 后删除该条。

### a11y 基线（五项沿用 v2，布局按本规范）

| 项 | 实现 | 验证方式 |
|---|---|---|
| skip-link | 跳到 `#main-content` | Tab 首焦点即跳转链接 |
| focusMainHeading | 路由或上下文 revision 变化后聚焦 `#main-heading`（`tabIndex=-1`） | 翻页后焦点落在主标题 |
| aria-busy | `PageFrame` 在 loading 态置 `aria-busy="true"` | 状态矩阵 loading 格 |
| aria-live | 页面状态与标题以 `role="status" aria-live="polite"` visually-hidden 播报 | 读屏走查 |
| prefers-reduced-motion | 全局关闭动画与过渡 | 系统开启减弱动态效果后骨架屏静止 |
| 桌面缩放 | 左栏 152px／48px，右停靠区可收起；正文折行、二维区局部滚动 | 上述三种桌面窗口在 100%／200% 缩放下完成导航与确认，无焦点遮挡 |

台账 GAP-011 说「无规格依据」是 C32 之前的事实，现已被 `openspec/specs/platform/web-shell-interaction-primitives/spec.md`、`openspec/specs/web/*` 与 `evaluation-and-browser-acceptance/spec.md:126`（要求验收键盘焦点行为）取代。

### 停靠区

右侧停靠区承载待办与助手工作，使用 `--dock-width: 22rem`，不沿用原型中额外的 `480px` 临时宽度。两个页签独立判断权限，隐藏其中一个不得带走另一个；详情可展开全屏。复核全屏覆盖层的精确 URL、刷新、返回和历史读取遵守 [路由契约](route-redirect-contract.md)，不以覆盖层私有状态代替领域身份。

## 依赖治理

**引入 `antd` 需开 OpenSpec change**（`AGENTS.md` §5：新依赖必须先开 change，附版本号、引入原因、移除条件）。本 effort 只做规格，change 另开。

建议 change 内容：

- **依赖**：`antd`（版本由施工期按锁文件确定）、不引入 `@ant-design/icons`（保持自绘线性图标）
- **引入原因**：表单/表格/日期选择/级联选择等表单类组件自建成本高于引入；自建无法覆盖受控校验与键盘可达性
- **主题约束**：`ConfigProvider` token 映射到 v2 令牌，禁止保留 AntD 默认色
- **移除条件**：若施工期评估 AntD 覆写成本超过自建，则退回自建并关闭本 change

## 与 OpenSpec 的关系

**CH-1** 新增 `web/design-system` 规格，固定令牌语义、受控风险配色、操作错误色、图表数据驱动和组件复用约束。**CH-2** 必须对 `platform/web-shell-interaction-primitives` 作 delta：将七项导航、五类单值骨架、旧停靠面板集合更新为六项导航、区域块组合与新停靠结构，并保留七态、权限、统一确认、焦点和上下文所有权边界。

已有四个 `web/*` capability 按其行为所有权更新引用，不因导航移动而整份 superseded。区域块示意只表达页面组合，不新增数据驱动页面引擎或复制业务 Schema。具体 Requirement、Scenario、文件与验证命令在各 change 的 planning 工件中闭合；本轮不改主规格。

## 遗留风险

1. **AntD 覆写成本未被验证。** 本决定基于「表单类组件自建成本更高」的判断，未实测 AntD 主题覆写工作量。若施工期发现覆写 AntD 视觉类组件的成本超过自建，应退回自建——change 的移除条件已写明这一路径。
2. **AntD 默认包体积会增加首屏负载。** 可通过按需引入（`import { Button } from 'antd'` + 构建分包）缓解，但需在施工期实测。
3. **`PageStateView` 七态与 AntD 的 `Empty`/`Spin` 有重叠但不能互换**——七态含 `forbidden` 与 `unavailable` 两个语义态，AntD 无对应，且必须表达权限与能力位原因码。已在组件清单中标注「保留，不换」。
4. **量化标准呈现边界**：在「指标体系与量化标准」中按指标展开其 `quantizationIntervalRef` 精确版本与可读取内容；不另设独立发布按钮。该引用有版本身份，但当前没有独立 `quantization-standard` 治理类型，不能据此承诺独立发布流程。
5. **导航授权按生产事实核对**：v2 的全角色 denied 不能证明当前生产缺少全部读面授予；CH-2 只修实际 branch／角色／会话传递缺口。新增聚合入口不授予领域权限，reviewer 无 Agent 权仍能复核；最终组合启用前由 CH-9 验证。
