# 设计系统三层：令牌 / 基础组件 / 布局骨架

Type: grilling
Status: resolved
Blocked by: 02

## Question

生产样式现在是三套血缘：`theme/tokens.css`（30 变量，抄自 `report-screenshot-design.md §3`）、`shell/AppShell.css`（C10 老样式 `system-ui` + `#17202a/#f7f9fb` + 硬编码三列网格 `16rem 1fr 22rem`）、约 30 个页面级 CSS 各写各的。`demo/v2` 里有一套已冻结但从未进生产的完整设计系统（`--space-1..7`、字号行高配对、`--radius-*`、`--dur-*`/`--ease-standard`、`--z-*`、断点 `--bp-shell 64rem`、暗色结构、焦点环）。

**以 demo/v2 为基线收敛出一份可用于生产的、三层完整的 UI 设计系统规范** —— 需要定下来。

三层分别要解决：

1. **令牌层**：语义化命名（而非 `tokens.css` 现在这种从截图抄来的具体值）、色板与语义映射、字号行高配对、间距刻度、圆角、动效时长与缓动、z-index 层级、断点、焦点环。工程蓝 `#2166d1` 为唯一强调色、风险四级色只表达等级/越限/预警且必带文字标签 —— 这两条硬约束在令牌层怎么落地、怎么防止退化？暗色是本期要做的还是只留结构位？
2. **基础组件层**：`apps/web` 目前**没有 UI 组件库**。要引入 shadcn/ui 之类的，还是在 React 上自建一套？决定哪些组件进这套库（按钮、对话框、表格、抽屉、标签页、Toast、空状态、骨架屏…），每个组件的行为契约是什么。已存在的 5 个 `page-shells`（A 列表 / B 详情 / C 运行 / D 治理 / E 复核）算不算这一层的骨架部分？`components/AppShell.tsx` 这个空壳别名要不要一并清掉？
3. **布局骨架层**：新导航树下的布局网格（现状是硬编码三列 `16rem 1fr 22rem`）、七态视图状态（`idle|loading|ready|empty|error|forbidden|unavailable`）的组件化表达、Agent 停靠栏与全屏工作台、证据抽屉的脱敏两态、命令确认原语、响应式/断点行为。

**图表组件必须由数据驱动，不得硬编码档位。** 当前合成配置的矩阵是 3 可能性档 × 2 后果档 × 4 等级，真实配置到位后会变成 5×5，风险等级名称（当前只有 `levelId`/`ordinal`，无名称）也会从标识变成业务词。矩阵图、等级标签、色阶映射必须全部从配置返回的档位与等级数组派生，不得按格子位置、按固定档数或按 `level-1..4` 假定维度与取值。`demo/` v1 有过硬编码 5×5 矩阵的反面案例（把 I–IV 直接写死）。同理，`charts/` 现有 6 个 ECharts 组件需逐一核查是否隐含固定维度。

具体要回答：

- 新规范是否取代 `report-screenshot-design.md §3` 作为令牌事实源？两份文档的存废关系。
- 组件层引入新依赖需要走 OpenSpec change（`AGENTS.md` §5）—— 规格里如何表达这个待办而不违反流程？
- 哪些必须同步进 `openspec/specs/web/*`？现有 spec 里哪些条款与新系统冲突、需要标为 drift？

**不要**在这一票里逐页设计内容。

## 由票 03 转入本票的输入

来源：`.scratch/riskflow-master-plan/prototypes/gap-ledger-adjudication.md`（demo/v2 GAP 台账 54 条重判结论）。

**必须解决的骨架缺口**（台账 G1 四条，仍成立）：

- GAP-001：C10 五类骨架缺 15 处结构 slot。v2 `DESIGN-SPEC.md` §3 已给骨架扩展方案。
- GAP-002：复合骨架 A+C / A+B 无法由单值枚举表达。需决定骨架类型如何表达多区。
- GAP-003：Agent 专用骨架无枚举值。
- GAP-004：主从复合页 / KPI 横条网格 / 图谱画布三种形态无骨架承载。**P-OV-01 是票 02 定的新多区块仪表盘，这条直接决定它的骨架**。

**可直接复用的 a11y 基线**（台账 GAP-011 说"无规格依据"是当时事实，现已被 `openspec/specs/platform/web-shell-interaction-primitives/spec.md`、`openspec/specs/web/*` 与 `evaluation-and-browser-acceptance/spec.md:126` 取代；且 v2 自己已给出逐项可验的基线表）：skip-link 跳 `#main-content`；路由或上下文 revision 变化后聚焦 `#main-heading`（`tabIndex=-1`）；PageFrame loading 态置 `aria-busy="true"`；页面状态与标题以 `role="status" aria-live="polite"` visually-hidden 播报；`prefers-reduced-motion` 全局关闭动画与过渡；≤64rem 外壳塌两列（导航 13rem + 主区，停靠区下沉通栏）。

**必须裁决的实现路线冲突**（台账 GAP-008 已由 `echarts 5.6.0` 事实性关闭，但路线本身未统一）：

- v2 `DESIGN-SPEC.md` §4 约定五类图表（donut / hbars / trend / graph / matrix）统一走 `ChartSurface` 抽象接缝，**实现用纯 SVG + CSS**，红线第 8 条要求「图表一律 SVG」；
- 生产用 `echarts 5.6.0`，`apps/web/charts/` 6 个组件。

需决定：统一到 echarts，还是在生产按 v2 规范重写 SVG 图表。后者涉及是否接受双轨，并需核查 `charts/` 6 个组件是否隐含固定维度。

**治理区的一个契约约束**（台账 GAP-019 部分解决）：`ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1` 11 类枚举已定（`packages/core/src/assessment-config/schema.ts:40-58`），但**没有独立的 `quantization-standard` 类型**——量化标准通过指标体系内的 `quantizationIntervalRef`（`schema.ts:150`）表达，是指标的附属引用而非独立治理对象。而票 02 的新治理区含「指标体系与量化标准」页面。**界面不得承诺后端不支持的独立发布/版本化能力**，须明确量化标准在界面上如何呈现。

## Answer

产出资产：[UI 设计系统规范](../../riskflow-master-plan/prototypes/design-system-spec.md)。

**输入基线**：v2 为 70 个令牌、生产为 30 个令牌，沿用同一套颜色与字体基础，但导航宽度已有不同值，不能视为同名值全部不变。生产样式来自令牌、外壳与页面三层；图表已混用 echarts 与 CSS 网格。最终采纳值按附件统一，不把原型文件当生产依赖。

**实证硬编码缺陷**：`RiskMatrix5x5.tsx` 把 5×5 写死（`[5,4,3,2,1].map` 五行、`[1,2,3,4,5].map` 五列、`hlRow = 5 - highlight.p` 反算、`levelClass` 字面量映射）。**当前合成配置是 3×2**，该组件会渲染出两行三列全空的错乱网格。

**令牌层**：v2 只提供初始值；本规范固定语义和尺寸，CH-1 迁入 `apps/web/src/theme/tokens.css` 后由该文件唯一提供运行值，对应 OpenSpec 固定约束。截图文档降为派生；字号行高成对使用、暗色本期不提供切换、工程蓝为唯一交互强调色。独立操作错误色 `--error: #b42318`／`--error-soft: #fef3f2` 不承担风险等级语义。

**风险色防退化**：风险徽章和矩阵、图表共用一套受控等级配色映射；按记录引用的配置确定等级与名称，均提供文字或可访问说明。页面 CSS 与 AntD 默认彩色组件不自行选择等级色，不要求所有风险颜色都经徽章组件输出。

**基础组件层：引入 Ant Design**。`ConfigProvider` 将主题蓝映射为 `--blue`、成功色为 `--success`、错误色为独立 `--error`；表单错误不引用 `--risk-1`。AntD 默认彩色 Tag 不决定风险等级，Card/Tag/Badge/Alert/Statistic 不直接替换业务组件。

**AntD 使用边界**：Form / Form.Item（替换现下手填标识的表单）、Table、DatePicker/RangePicker、Select/Tree/Cascader、Modal/Drawer/Popconfirm、Descriptions、Empty/Spin/Skeleton。**不引入 `@ant-design/icons`**，保持 `icons.tsx` 自绘 1.5px 描边线性图标。

**迁移策略：不硬迁移**——新页面直接用 AntD，现有 13 组件与 46 页面组件逐步收拢，避免与其他 change 施工冲突。

**组件清单**已逐个标注来源与去留。其中 **`PageStateView`（七态）与 `EvidenceDrawer`（脱敏两态）标注为"保留，不换"**——七态含 `forbidden` 与 `unavailable` 两个语义态且必须表达能力位原因码，`EvidenceDrawer` 的脱敏两态是契约要求，AntD 均无对应。`components/AppShell.tsx` 空壳别名随本 change 删除。

**布局骨架层：骨架模型从单值枚举改为区域块数组**。`PageSkeleton = readonly Region[]`，每块声明类型（list / detail / form / chart / timeline / matrix-grid / tabs / agent）。A/B/C/D/E 成为单块特例保持词汇不丢；复合骨架 A+C、A+B 成为两元素数组（**GAP-002 解决**）；Agent 骨架成为 `[{kind:"agent"}]`（**GAP-003 解决**）；主从复合页 / KPI 横条 / 图谱画布各有对应块型（**GAP-004 解决**）。P-OV-01 新仪表盘的骨架就是四块数组。

**布局网格**：左导航 `152px ↔ 48px`，右停靠区 `22rem` 可收起；不沿用 `64rem` 自动改 `13rem` 导航或停靠区下沉。保持桌面结构，正文折行、二维区域局部滚动；验证三种桌面窗口在 100%／200% 缩放下仍能完成导航、待办和确认。尺寸与用例见附件。

**图表统一到 echarts，保留 `ChartSurface` 接缝**。`ChartSurface` 保留空态与无数据态职责（v2 规范且生产已落地该组件）。**v2 红线第 8 条「图表一律 SVG」作废**——生产已用 echarts，不为满足原型红线重写全部图表；`DESIGN-SPEC.md §4` 中"实现留给 M4"的前提已不成立，规范升为 `design-system-spec.md` 后删除该条。数据驱动硬约束保留：矩阵行列数、等级色映射、落点高亮全部从配置的 `possibilityAxis.bands` / `consequenceAxis.bands` / `riskLevels` / `cells` 派生。

**a11y 基线**：沿用 skip-link、主标题焦点、aria-busy、aria-live、prefers-reduced-motion；布局采用已确认的 152px／48px 外壳，并补桌面缩放、覆盖层滚动与焦点不被遮挡的验收。复核覆盖层仍保留精确 URL。

**依赖治理**：引入 `antd` 需开 OpenSpec change（`AGENTS.md` §5）。change 内容已写好：依赖、引入原因（表单类自建成本更高、自建无法覆盖受控校验与键盘可达性）、主题约束、**移除条件（若施工期评估覆写成本超过自建则退回自建并关闭 change）**。

**OpenSpec 关系**：CH-1 新增设计系统规格，CH-2 修改 `platform/web-shell-interaction-primitives` 的导航、骨架及停靠区条款并保留原权限与确认边界；已有四个 `web/*` 按行为所有权作 delta，不按导航强制重划或整份 superseded。本轮只修 planning 输入，不改主规格。

**遗留风险**：

1. **AntD 覆写成本未被验证**——本决定基于"表单类自建成本更高"的判断，未实测。若施工期发现覆写视觉类组件成本超过自建，走 change 的移除条件退回自建。
2. **AntD 默认包体积增加首屏负载**——需按需引入 + 构建分包缓解，施工期实测。
3. `PageStateView` 与 AntD `Empty`/`Spin` 有重叠但不可互换，已在组件清单标注。
4. **量化标准呈现已定**：按指标展示 `quantizationIntervalRef` 的精确版本及可读取内容；没有独立治理类型，不提供独立发布按钮，但不把有版本引用误说成无版本能力。
5. **导航授权按生产核对**：v2 的 denied 不等于当前无授予。CH-2 修实际授权传递缺口，不扩大原角色域权限；CH-9 在组合启用前验证 reviewer 无 Agent 权仍可复核。
