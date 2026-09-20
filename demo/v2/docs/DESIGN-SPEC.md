# RiskFlow v2 设计规格（DESIGN SPEC）

> 状态：M1 冻结。本文件是 v2 设计系统的成文规范，供 M4 页面铺量批次与将来 C32–C35 设计引用。
> 配套：`docs/PAGE-GUIDE.md`（页面实现约定）、`docs/GAP-LEDGER.md`（缺口台账）。

---

## 1. 令牌冻结清单

事实源文件：`src/theme/tokens.css`。下列令牌为冻结集合，新增令牌必须先改本清单。

### 1.1 颜色

| 令牌 | 值 | 语义约束 |
|---|---|---|
| `--nav-bg` | `#0e2238` | 左侧导航底（深海军蓝框架） |
| `--topbar-bg` | `#15324d` | 顶部通栏底 |
| `--page-bg` | `#f3f6fa` | 主区浅灰蓝底 |
| `--card` | `#ffffff` | 卡片底 |
| `--border` | `#dce4ee` | 卡片与分隔描边（1px） |
| `--text` / `--text-2` | `#172b4d` / `#63758a` | 主文本 / 次文本 |
| `--blue` / `--blue-soft` | `#2166d1` / `#e8f0fc` | 工程蓝：**唯一强调色**（当前导航、主按钮、运行中状态、主图表） |
| `--risk-1..4` | `#d9363e` / `#f97316` / `#e7ac08` / `#20a464` | 风险四级色：**仅用于风险等级 / 越限 / 预警** |
| `--risk-1-dark` | `#a61e24` | 一级深阶（悬停、强调文本） |
| `--risk-1..4-soft` | `#fdebec` / `#fef1e7` / `#fdf6e0` / `#e6f5ee` | 四级浅底（徽章、矩阵格底） |
| `--risk-3-text` | `#8a6604` | 三级浅底上的文本色（对比度） |
| `--success` / `--success-soft` | `#1b9a6c` / `#e6f5f0` | 成功 / 完成 |
| `--review` / `--review-soft` | `#7e7390` / `#efecf3` | 复核中 |
| `--bluegray` / `--bluegray-soft` | `#8fa6c0` / `#eef2f7` | 中性 / 未开始 |

### 1.2 字体与排版刻度

- `--font`：`Inter, 'Noto Sans SC', 'Microsoft YaHei', sans-serif`
- `--font-mono`：`'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`（资料段标识、运行标识、版本号；配 `tabular-nums`）
- 字号与行高**配对**刻度（不得拆配）：

| 令牌 | 字号/行高 | 用途 |
|---|---|---|
| `--text-xs` + `--text-xs-lh` | 12/18 | 徽章、辅助说明 |
| `--text-sm` + `--text-sm-lh` | 13/20 | 表格次级信息、上下文栏 |
| `--text-md` + `--text-md-lh` | 14/22 | 正文基准 |
| `--text-lg` + `--text-lg-lh` | 16/24 | 卡片标题 |
| `--text-xl` + `--text-xl-lh` | 20/28 | 页面框架标题 |
| `--text-2xl` + `--text-2xl-lh` | 24/32 | 页面主标题 |
| `--text-kpi` + `--text-kpi-lh` | 34/40 | KPI 数值（配 `tabular-nums`） |

### 1.3 间距 / 圆角 / 卡片

- 间距刻度：`--space-1..7` = 4 / 8 / 12 / 16 / 24 / 32 / 48px，禁止刻度外硬编码间距。
- 圆角刻度：`--radius-sm` 4px（徽章）、`--radius-md` 6px（按钮、输入）、`--radius-lg` 8px（卡片）、`--radius-full` 999px（胶囊）。
- 卡片：`--card-radius`（= `--radius-lg`）、`--card-shadow` `0 2px 8px rgba(18,45,72,0.06)`。

### 1.4 动效 / 层级 / 断点 / 框架尺寸

- 动效：`--dur-fast` 120ms / `--dur-base` 200ms / `--dur-slow` 320ms；缓动 `--ease-standard` `cubic-bezier(0.2, 0, 0.38, 1)`。
- z-index：`--z-nav` 30、`--z-topbar` 30、`--z-dock` 40、`--z-overlay` 50、`--z-review` 60（v1 散落的 30/40/50/60 已令牌化）。
- 断点：`--bp-compact` 48rem、`--bp-shell` **64rem**（外壳塌列断点，对齐生产）、`--bp-wide` 90rem。媒体查询写字面量，令牌供文档与叠加层对齐。
- 框架尺寸：`--nav-width` 16rem、`--nav-width-compact` 13rem、`--topbar-height` 68px、`--dock-width` 22rem、`--agent-dock-width` 480px、`--drag-region-height` 28px、`--window-min-width` 64rem、`--window-min-height` 40rem。
- 焦点环：`--focus-ring`（= `--blue`）。

### 1.5 暗色结构

`[data-theme='dark']` 下提供全部颜色令牌的双套取值（含卡片阴影与焦点环）。**只做令牌结构，不做切换 UI**；是否落地由生产端决定（GAP 台账 G5 类相关决策不含暗色，登记为设计预留）。

---

## 2. 可访问性基线

规格无 a11y 章节，本基线**以生产 C10 实现为准**（GAP-011），逐项可验：

| 项 | 实现 | 验证方式 |
|---|---|---|
| skip-link | `.skip-link` 跳到 `#main-content`（AppShell） | Tab 首焦点即跳转链接 |
| focusMainHeading | 路由或上下文 revision 变化后聚焦 `#main-heading`（`tabIndex=-1`） | 翻页后焦点落在主标题 |
| aria-busy | PageFrame 在 loading 态置 `aria-busy="true"` | 状态矩阵 loading 格 |
| aria-live | 页面状态与标题以 `role="status" aria-live="polite"`  visually-hidden 播报 | 读屏走查 |
| prefers-reduced-motion | global.css 全局关闭动画与过渡 | 系统开启减弱动态效果后骨架屏静止 |
| 64rem 断点 | ≤64rem 外壳塌两列（导航 13rem + 主区，停靠区下沉通栏） | 视口预设 64rem |

扩展到 57 页的要求（M4 逐页落实）：

1. 键盘可完整走通主要流程；对话框 / 抽屉有 `role="dialog"`、`aria-modal`、Esc 关闭与焦点归位（v1 `ConfirmButton` 缺这些，不复制该缺陷）。
2. 颜色不作为唯一信息载体：风险等级必须带文字标签（徽章文案 I/II/III/IV + 等级名）。
3. 表单控件有显式 `<label>`，错误提示经 `aria-describedby` 关联。
4. 右停靠区：context/agent 互斥标签 roving tabindex（方向键切换），Esc 关闭后焦点回到触发按钮。

---

## 3. Electron 前瞻约束（九条）

设计层面预留，不做 Electron 工程。九条逐条对应指导性方案 §6：

| # | 约束 | v2 设计要求 | 落点 |
|---|---|---|---|
| 1 | 窗口可缩放 | 以 64rem 为响应式下限，声明最小窗口 64rem × 40rem；禁止 v1 的 `viewport width=1920` 硬钉 | `index.html` viewport meta、`--window-min-*` |
| 2 | 自绘标题栏 | 顶部通栏预留可拖拽安全区（`data-drag-region` + `app-region: drag` 样式钩子），交互控件标 `no-drag`；品牌与上下文信息在通栏左右两端 | `AppShell.css` `.app-header` |
| 3 | 无浏览器外框 | 页面内自带导航可视线索：左导航当前项高亮、页面主标题即位置指示；M4 详情页补面包屑与返回链接 | AppShell 导航态 |
| 4 | 路由模式 | hash / memory / history 三模式可切换，默认 hash（`file://` 可用） | `src/app/history.ts` |
| 5 | 资源路径 | 全部相对路径，构建 `base: './'`，不假设站点根 | `vite.config.ts` |
| 6 | 不依赖弹窗 | 禁止 `window.open` 与 `target="_blank"`；外部跳转走显式处理位 | check-redlines 人工复查项 |
| 7 | 导出即一等公民 | P-AU-01 报告导出设计为独立界面，不依赖浏览器打印对话框 | manifest + M4 页面 |
| 8 | 分辨率无关 | 图表一律 SVG（见 §4）；位图仅用于图标且需多倍图 | §4 图表规范 |
| 9 | 离线 | 原型本身即离线，天然满足；fixture 全部本地 | `src/content/` |

---

## 4. 图表视觉规范

五类图表（donut / hbars / trend / graph / matrix）统一走 `ChartSurface` 抽象接缝：输入数据形状 + 尺寸 + 主题令牌；实现用纯 SVG + CSS，零运行时依赖。**本节约定视觉规范，实现留给 M4**；生产图表库选型属 C34 dependency checkpoint（GAP-008）。

通用约定：

- 主数据色一律工程蓝 `--blue`；风险四级色只允许表达等级 / 越限 / 预警，不得用作普通系列色。
- 空态（有结构、无数据点）：显示图表框 + 坐标/图例骨架 + 文案「暂无可显示内容」。
- 无数据态（数据源缺失）：不渲染图表框，显示不可用说明与原因码（对齐 PageFrame unavailable）。
- 图例固定在图表下方一行，色块 12×12px 圆角 2px + 文字标签；超过 6 项折叠为「更多」。
- 所有数值用 `--font-mono` + `tabular-nums`。

### 4.1 donut（占比环）

- 环宽为半径的 22%；中心显示总量（`--text-kpi`）与单位。
- 阈值线：不适用。越限标注：超阈值扇区改用对应风险色并在图例追加「越限」标记（菱形符号，不单独依赖颜色）。
- 空态：灰环（`--bluegray-soft`）一整圈。

### 4.2 hbars（横向条形）

- 条高 20px、间距 12px；标签左置、数值右置。
- 阈值线：竖直虚线 1.5px `--risk-2`，右侧标注阈值名与数值。
- 越限标注：越限条形改对应风险色，数值加粗并附「越限」文字徽标。
- 空态：保留三条灰条骨架。

### 4.3 trend（趋势折线）

- 主线 2px `--blue`，节点圆点半径 3px；对比线 1.5px `--bluegray` 虚线。
- 阈值线：水平虚线 1.5px `--risk-2`，右端标注阈值名；多级阈值按风险级色区分并全部入图例。
- 越限标注：越限区间背景铺对应风险色 soft 底（透明度 60%），越限节点改风险色实心点。
- 空态：坐标系 + 灰虚线骨架一条。

### 4.4 graph（关系图谱）

- 节点：圆角矩形白底 1px `--border` 描边；选中 / 当前节点 1.5px `--blue`。
- 边：1.5px `--bluegray`，方向箭头实心；高风险关联边可用风险色，但须配文字标签。
- 画布：平移缩放控件左下角；空态显示居中提示「暂无关联数据」。

### 4.5 matrix（P/C 风险矩阵）

- **由版本化配置驱动渲染**（AGENTS.md §4.3 硬要求）：行/列刻度、等级文案、格底色、当前落点全部来自风险矩阵版本数据，禁止 v1 式的 I–IV 与 5×5 硬编码。
- 格底色用风险四级 soft 色；落点用 8px 实心圆 + 记录数徽标。
- 阈值与可接受区边界：1.5px 实线 `--risk-1-dark`，边界外侧标注「可接受阈值」与阈值版本号。
- 空态：按矩阵版本渲染空格阵 + 「暂无评估记录」。

### 4.6 实现接口速查（`src/charts/`）

所有组件：`import { ... } from '../charts'`（或对应相对深度）。共享入参（`ChartStateProps`）：`status?: 'ready'|'empty'|'unavailable'`（缺省按数据有无推导）、`unavailableReasons?: {code}[]`、`emptyMessage?: string`。共享主题：`theme?: ChartTheme`，默认 `DEFAULT_CHART_THEME`（全部映射 tokens.css 变量）。

**ChartSurface**（通用接缝，一般不直接用，五类组件内部已封装）

```ts
interface ChartSurfaceProps {
  title?: string; status: ChartStatus; unavailableReasons?: {code}[];
  emptyMessage?: string; legend?: ChartLegendItem[]; maxWidth?: number;
  skeleton?: ReactNode; children?: ReactNode;
}
// ChartLegendItem = { key; label; color; marker?: 'square'|'diamond'|'line'|'dashed-line'|'dot' }
```

**DonutChart**

```ts
interface DonutSlice { key; label; value; color?; exceeded?: boolean; riskLevel?: 1|2|3|4 }
interface DonutChartProps extends ChartStateProps {
  data: DonutSlice[]; size?: number /* 外径，默认 180 */;
  centerValue?: string /* 缺省合计 */; centerLabel?: string;
  title?: string; theme?: ChartTheme; showLegend?: boolean;
}
// 例：<DonutChart centerLabel="风险记录" data={[{key:'i',label:'一级',value:3,exceeded:true,riskLevel:1},{key:'iv',label:'四级',value:12}]} />
```

**HBarsChart**

```ts
interface HBarItem { key; label; value; displayValue?; color?; exceeded?; riskLevel? }
interface HBarsChartProps extends ChartStateProps {
  data: HBarItem[]; width?: number /* viewBox，默认 640 */; barHeight?; barGap?;
  maxValue?: number; threshold?: { value; label; color? }; unit?: string; title?; theme?;
}
// 例：<HBarsChart unit="mm" threshold={{value:30,label:'预警阈值'}} data={[{key:'s1',label:'沉降',value:42,exceeded:true}]} />
```

**TrendChart**

```ts
interface TrendPoint { x: string; y: number; exceeded?; riskLevel? }
interface TrendSeries { key; label; kind?: 'main'|'compare'; points: TrendPoint[] }
interface TrendChartProps extends ChartStateProps {
  series: TrendSeries[]; width?; height? /* 默认 640×240 */;
  thresholds?: { value; label; riskLevel? }[]; yUnit?; title?; theme?;
}
// 例：<TrendChart yUnit="mm" thresholds={[{value:30,label:'黄色阈值',riskLevel:3}]}
//      series={[{key:'cur',label:'本期',points:[{x:'09-01',y:12},{x:'09-02',y:33,exceeded:true}]},
//               {key:'ref',label:'类比工程',kind:'compare',points:[...]}]} />
```

**GraphView**

```ts
interface GraphNodeData { id; label; tone?: 'default'|'active'|'risk'; riskLevel? }
interface GraphEdgeData { source; target; label?; tone?: 'default'|'risk'; riskLevel? }
interface GraphViewProps extends ChartStateProps {
  nodes: GraphNodeData[]; edges: GraphEdgeData[]; width?; height? /* 默认 720×420 */;
  seed?: number /* 布局确定性种子 */; selectedNodeId?: string; title?; theme?;
}
// risk 边必须给 label（颜色不作唯一信息载体）。布局为固定 250 迭代力导向，同 nodes+seed 同布局。
```

**RiskMatrixChart / RiskMatrixVersionChart**（完全数据驱动，无矩阵维度与等级字面量）

```ts
interface RiskMatrixLevel { key; label; color; softColor }
interface RiskMatrixAxis { label; ticks: string[] }
interface RiskMatrixDefinition {
  probability: RiskMatrixAxis;   // 纵轴，ticks[0] 渲染在底部
  consequence: RiskMatrixAxis;   // 横轴
  levels: RiskMatrixLevel[];
  cellLevels: string[][];        // cellLevels[pIdx][cIdx] = level.key
  acceptable?: boolean[][];      // 可接受区掩码，维度同上；给出才绘制边界
  thresholdVersion?: string;     // 呈现于边界标注「可接受阈值 · X」
}
interface RiskMatrixPlot { id; p: string; c: string; count?: number } // p/c 取 ticks 值，同格合并
interface RiskMatrixChartProps extends ChartStateProps {
  definition: RiskMatrixDefinition; plots?: RiskMatrixPlot[]; cellSize?: number; title?; theme?;
}
// 版本化封装：config = RiskMatrixDefinition & { entityId; versionId }
<RiskMatrixVersionChart config={matrixV2026} plots={[{id:'AR-001',p:'P3',c:'C4'}]} />
```

plots 为空时矩阵仍按版本渲染空格阵并在格阵中心提示（默认「暂无评估记录」），这是 matrix 的空态约定；definition 缺轴/等级时才落入 ChartSurface 的 empty/unavailable。

---

## 5. 骨架扩展方案

C10 五类骨架（list / detail / run / governance / review）表达不了规格要求的形态（GAP-001~004）。v2 预设如下扩展，待将来契约演进裁决。

### 5.1 复合骨架

| 记法 | 含义 | 页面 | 布局 |
|---|---|---|---|
| A+C | 列表 + 运行 | P-PJ-08、P-RV-05 | 主从：左 2fr 列表，右 3fr 运行区（运行头部 + 阶段条 + 子任务表） |
| A+B | 列表 + 详情 | P-OP-02 | 主从：左 2fr 连接列表，右 3fr 连接详情/表单 |

`shellKind` 映射主骨架（list），组合记法保存在 `manifest.skeleton`；loading 骨架屏按主从布局渲染两半（`SkeletonView` 已实现）。

### 5.2 Agent 专用骨架（AG）

会话式结构：任务摘要头部 + 消息流（用户/Agent 交替）+ 底部输入与待确认命令区。`shellKind=custom`。P-AG-01（停靠栏内嵌形态）与 P-AG-02（全屏工作台）共用同一骨架，仅容器宽度不同。

### 5.3 三种页面形态（叠加在基础骨架上的 PageForm）

| 形态 | 结构 | 典型页面 |
|---|---|---|
| 主从复合页 `master-detail` | 左列表（可筛选）+ 右详情，选择联动 | P-PJ-08、P-OP-02、P-RV-01 |
| KPI 横条网格 `kpi-grid` | 页面顶部一排 KpiCard（数值 + 单位 + 状态角标），下接主内容 | P-OV-01、P-PJ-01、P-OP-03 |
| 图谱画布 `graph-canvas` | 全宽画布区 + 图例 + 左下角缩放控件 | P-RI-07、P-RV-04 |

### 5.4 15 处 slot 缺口的预设（对应 GAP-001）

| 骨架 | 缺口 slot | v2 预设 |
|---|---|---|
| B 详情 | 右侧「上下文」停靠区 | 复用外壳 RightDock 的 context 面板，页面不再自绘右侧栏 |
| B 详情 | 底部业务事件时间线 | 页面主体底部固定时间线区（版本发布 / 修订 / 审批事件） |
| C 运行 | 运行头部 | 运行标识 / 状态 / 阶段 / 触发原因 / 操作者 / 启动时间 / 幂等键，七字段一行两列 |
| C 运行 | 子任务表 | 阶段条下方子任务表格（阶段 I0–I9 / A0–A9、状态、耗时、错误码） |
| C 运行 | 结果汇总 | 子任务表下方汇总卡（产出计数、成功率、输出引用） |
| A 列表 | 上下文副标题 | 标题下一行上下文副标题（工程 / 区段 / 工序 + 数据时点） |
| A 列表 | 独立主操作区 | 列表右上主操作按钮组（与筛选栏分离） |
| D 治理 | 对象列表（审核状态筛选） | 左侧对象列表 + 审核状态筛选 chips |
| D 治理 | 修订表单 | 右侧修订表单区（字段 diff + 提交说明） |
| E 复核 | 批量确认摘要 | 队列页顶部批量操作摘要条（已选 n 项 / 可批量通过条件） |
| E 复核 | 历史决定 | 详情页底部历史决定列表（决定人 / 时间 / 结论 / 理由） |

（B/C/A/D/E 各 slot 计数合计 15：B×2、C×3、A×2、D×2、E×2，另含复合与三形态的整体性缺口 4 处见 GAP-002~004。）

### 5.5 组合视图机制

拆页规则（决策 6）后，跨页汇报图不再合并页面：用**专用组合路由**（`pages/compose/routes.tsx`）把 2–3 个页面以只读、无重复事实并置。约定：

- 组合路由以 `/compose/<名>` 注册，`shellKind=custom`，不进导航、不计入 57 页。
- 被组合页各自保持独立 URL 与页面契约；组合视图只读引用，不提供额外交互入口。
- 当前两个组合视图：`/compose/identification`（P-RI-03 + P-RI-05 + P-RI-07）、`/compose/assessment`（P-RA-03 + P-RA-06 + P-WR-01），供第 4、5 张汇报图。
