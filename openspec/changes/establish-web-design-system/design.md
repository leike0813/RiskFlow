## Context

本 change 是修订后 UI 主规格的 CH-1。代码基线为 `88dce423806dfc34585803ec3f727f8d0d0550cb`；planning 输入是当前工作区的主规格与设计系统附件，不将用户未提交原型当作该 commit 的生产实现。

已读主规格：`platform/engineering-baseline`、`platform/web-shell-interaction-primitives`、`web/assessment-warning-and-response-ui`、`web/agent-audit-and-operations-ui`、`quality/evaluation-and-browser-acceptance`。现有导航、确认、证据、HTTP、权限和历史版本行为继续由这些能力拥有，仅新增 `web/design-system`。

源码核对纠正两项前提：

- `components/AppShell.tsx` 是页面分区容器，不是无人使用的根壳别名；业务页及 ops 共享层仍使用其 `data-page-section/data-agent-context`。真正根壳是 `shell/AppShell.tsx`。不能按“死代码”删除前者。
- 活的矩阵是 `RiskMatrixVersionChart`，由 `AssessmentMatrixPage.definitionOf` 投影精确发布配置；已经动态处理维度。`RiskMatrix5x5` 无生产消费者，只需删除。现有四级调色板的取模复用、预警状态/等级混用及非风险错误色才是实际待修部分。

语言服务器未配置；符号与消费者依据 CodeGraph 当前源码及仓库精确搜索核对。当前仅创建规划工件，未执行依赖安装、实现或业务验收。

## Goals / Non-Goals

**Goals:**
- 生产令牌唯一生效，主题和图表不在 JS/CSS 各自抄录色值。
- 在现有入口及共享 DataTable 上实际消费 AntD，不新建演示路由或未消费组件库。
- 风险等级、确认状态和普通失败的语义分离；保全冻结矩阵和原命令/权限行为。
- 给后续 CH 提供已闭合的主题、组件使用和验收约束。

**Non-Goals:**
- 不实现六导航、152px/48px 壳层切换、区域块注册模型、新停靠区、路由迁移或业务聚合。
- 不改后端、领域 Schema、权限、审计、P/C、矩阵阈值或处置状态。
- 不把所有原生表单/表格全量迁移，不增加日期库直接使用、暗色切换、移动端或远程字体。
- 不以设计层顺手重构确认状态机、不移除仍有消费者的页面容器，不迁移一次性原型。

## Decisions

### D-01 能力所有权与实施边界

新增 `web/design-system` 的 DS-R1～DS-R6；已有主规格不搬迁、不 supersede。CH-1 提供目标尺寸令牌，但 `shell/AppShell.css` 的现有网格尺寸、导航数量及停靠内容保持原行为；CH-2 才闭合壳层公共契约并实施目标布局。允许调整该 CSS 的字体、表面、焦点及滚动，不借主题修改切换导航。

RI/RA 为横切呈现：RI-S6 的证据与决定边界、RA-S3～RA-S6 的冻结矩阵解释必须保留，不重新宣称模型或甲方配置验收通过。

### D-02 精确依赖、治理和离线取得

唯一新增直接运行依赖为 `apps/web` 的 **antd 6.6.6，MIT**。当前 registry 的 peer 要求 React/React DOM >=18，与仓库 19.2.8 匹配；6.x 无需 React 19 补丁包。本次实际消费 ConfigProvider 与 Table，暂不直接使用日期组件，所以不新增 dayjs 直接依赖。后续若直接导入日期库，须由对应 change 固定版本和治理记录，不能依赖隐式 hoist。

| 登记字段 | 固定内容 |
|---|---|
| name / version | antd / 6.6.6，精确字符串，不用范围或 latest |
| purpose | 生产基础表格与后续已限定表单、选择器、日期及对话框；不拥有业务状态 |
| license | MIT |
| source | https://www.npmjs.com/package/antd/v/6.6.6 ；https://registry.npmjs.org/antd/6.6.6 ；https://github.com/ant-design/ant-design/tree/6.6.6 |
| offline | 由联网构建方按冻结锁文件准备内网 npm 镜像或 `pnpm fetch` store，连同锁文件交付；隔离环境使用 `pnpm install --offline --frozen-lockfile`，Web 运行不访问 CDN |
| exitCondition | 与冻结 React/Node/构建不兼容、漏洞无法在允许版本修复，或达到同等功能/可访问性所需覆写抵消引入收益；撤回前重新批准方案，不由实现者另建并行组件体系 |

`apps/web/package.json`、`config/dependency-policy.json` 与 `pnpm-lock.yaml` 必须在主调度获得用户依赖变更授权后串行形成同一机械检查点；Implementation 不运行改锁安装命令。准备材料须覆盖传递依赖及既有构建脚本策略，不放宽 license、release-age 或默认脚本拒绝政策。`@ant-design/icons` 会作为 AntD 内部传递依赖进入锁文件；本项目不增加其直接依赖、不在业务源码导入，继续使用既有 icons.tsx，不承诺“零传递 icons”。

官方主题/React 19依据：https://github.com/ant-design/ant-design/blob/6.5.0/docs/react/migration-v6.en-US.md 、https://github.com/ant-design/ant-design/blob/6.5.0/docs/react/customize-theme.en-US.md 。实际冻结版本以 6.6.6 包元数据为准。

### D-03 生产令牌与一次解析主题

`theme/tokens.css` 唯一提供运行值。逐项采纳 v2 的字体/行高、间距、圆角、动效、焦点及层级输入，不依赖 demo 文件。保留现有颜色名和顶栏 68px，新增目标 `--nav-width:152px`、`--nav-width-compact:48px`、`--dock-width:22rem`；不采用拖拽区/CSS 窗口下限，也不因新增尺寸变量改变现有壳层网格。

独立错误色固定 `--error:#b42318`、`--error-soft:#fef3f2`；现有错误/失败/危险操作的视觉消费者改用这两个令牌，不再借用风险色。风险文本采用 `--risk-1-dark`，并采纳/增加 `--risk-2-text:#9a3412`、`--risk-3-text:#8a6604`、`--risk-4-text:#12633d`，与既有 soft 底色配对；色值只在 CSS 声明。`LoginPage.css` 普通说明文字改为中性文字色，不再用 risk-4 装饰。

`global.css` 用成对字号/行高和焦点令牌；`shell/AppShell.css` 移除覆盖颜色/字体的第二套根定义，保留网格与导航行为。reduced-motion 同时影响自有样式与第三方非必要动画，不改业务完成时序。不新增暗色切换或颜色监听器。

新增 `theme/DesignSystemProvider.tsx`：在 main.tsx 唯一入口包住现有 AppRoot，CSS 导入保持 tokens→global→shell 的顺序。挂载时一次读取根元素计算后的明确令牌集合，生成稳定的 AntD ThemeConfig 与复用既有 ChartTheme 的图表主题。SSR 可注入显式主题值；不得在 import 时访问 document，不以另抄一套 hex 作为 SSR 默认值。图表通过同模块的 `useChartTheme` 消费稳定主题；不在轮询、单元格或每次 render 读取 DOM。

ConfigProvider 使用 zh_CN，映射 primary/success/error、字体、字号/行高、圆角与表面。颜色算法消费已解析的实际颜色，不把 `var(...)` 当作需运算的 seed color。Drawer/Modal 若后续采用必须受该主题管辖；不使用绕过 Provider 的静态业务对话框。

前端接缝固定为 `DesignSystemProvider`、`useChartTheme` 和 `presentRiskLevel`，不新增 barrel 或业务命令包装。沿用 `ChartTheme.levelPalette` 作为 ordinal 升序的背景色，并增加同序 `levelForegroundPalette`；两者的默认值只引用生产 CSS 变量。Provider 可接收显式 `{ antd: ThemeConfig, chart: ChartTheme }` 主题供 SSR/隔离行为测试使用；生产默认在浏览器挂载时解析，图表初始化不得早于实际颜色就绪。`presentRiskLevel({ levelId, ordinal?, displayName? }, theme)` 返回 `{ label, foreground, background, mapped }`；未知级使用 theme.text/theme.neutralSoft，安全说明由消费组件以可访问文本呈现。已有矩阵可选 theme 参数保留，默认消费统一主题；不为呈现层修改领域 DTO。

### D-04 真实共享消费点为既有 DataTable

仅将 `components/DataTable.tsx` 的内部呈现替换为 AntD Table，保留 columns/rows/onRowClick Interface。显式关闭内置分页，不开启默认排序、筛选、选择或虚拟化；直接消费原 rows，不在组件发请求或切出第二份数据。列的 render 继续收到原 row，默认列值按原 ReactNode 语义显示；列宽、对齐、行点击和内部链接保持原义。

现有组件按输入顺序使用行索引 key 且不拥有选择/编辑状态，本次保留这一行为，不猜测某个业务 id 字段，不新增兼容别名或让所有调用方机械补参数。若点击行没有等价键盘目标，补 Enter/Space 的可访问触发，避免从子按钮/链接的键盘事件重复触发行操作。DataTable.css 仅负责该共享表格的令牌与有界横向滚动，后续页面按既有接口直接受益。

保留 PageStateView 与 EvidenceDrawer 的原领域语义；不把它们替换为第三方 Empty/Drawer。共享 PageStateView 当前缺少 unavailable 分支，在原 PageLoadStateV1 七态联合内补安全原因与既有重试，不新增枚举或权限判定。共享确认机制见 D-06，不为证明采用 AntD 而更换确认。

### D-05 受控风险呈现与矩阵复用

新增 `theme/riskPresentation.ts`，只接受公开结果的 levelId、可选 ordinal/显示名与生产主题，返回标签、前景、背景和是否可映射。它是前端呈现投影，不是新的领域 Schema。沿当前矩阵约定，已知 ordinal 1→绿色 risk-4、2→黄色 risk-3、3→橙色 risk-2、4→红色 risk-1；不从 levelId 的数字或中文名推断。未知/缺少 ordinal、超出四个已定义语义色时保留实际标签/标识并用中性色和“等级配色未定义”的可访问说明，不取模、截断或重新计算等级。

`components/RiskBadge.tsx/.css` 与矩阵图例/格子共用该函数。WarningCenter 目前只有 warningLevel 标识，不能补默认红色或新增后端查询，显示中性原始标识；WarningDetail 已有 matrixPlot.riskLevelOrdinal 时可使用该元数据。待确认/已确认只用 StatusTag，不混进等级徽章。迁移这两个真实消费者后删除 WarningBadge.tsx/.css，不保留 re-export。

`RiskMatrixVersionChart` 保留既有动态轴、bandId 落点、计数、空/不可用和精确版本；`RiskMatrixLevel` 增加由原发布 riskLevels.ordinal 传入的呈现元数据，删除 colorOf 的取模配色。`AssessmentMatrixPage.definitionOf` 只增加该字段传递，不改冻结版本分组、readKnowledgeRelease 或请求范围。治理页 MatrixGrid 保持自身的可访问只读表格，不为去掉两种不同阅读形态而改写其数据读取。

TrendLine/GraphView 仍用现有按需 ECharts；颜色改从稳定主题取得，不把 CSS var 字面量交给 Canvas。活动的版本化矩阵保留现有轻量 SVG，不为“统一库”重写成第二套矩阵实现。该选择落实现有 ChartSurface 和数据语义，不恢复“图表一律 SVG”红线。不得在未实测前声称 SVG fill/stroke 属性不支持 var()，也不为该猜测列补丁。

GraphView 的 risk-event 是对象类别，不代表风险等级；类别配色采用工程蓝/中性色并保留形状和名称，不因类别名称含 risk 而渲染最高风险红色。TrendLine 已有正式预警边界的语义可以保留，不能把普通序列着色解释为新等级计算。

不新增可接受阈值读取、边界推测或名称编造。删除无消费者的固定 5×5 矩阵、DonutChart、HBars 及 GraphLegend 副本；未来仪表盘按其 change 消费现有 ECharts 接缝，不保留未消费预制页面。具体文件在施工图列明。

### D-06 保留实际确认、容器与安全状态行为

`components/AppShell.tsx` 在用，作为受保护文件保留，不按附件错误前提删除。`shared/confirmation.ts` 和 CommandConfirmationDialog 是既有公开确认机制，而生产 ConfirmButton 当前另有本地状态；两者可用性模型不同。本 change 不宣称该既有 drift 已消除，也不将确认迁移隐藏在换皮任务中；仅改错误色与滚动/焦点样式，ConfirmButton 的请求回调、取消、原载荷重试和上下文失效逻辑保持不变。后续 CH-2 规划须据该事实单独闭合统一确认，不沿用“已经只有一套生产状态机”的前提。

证据读取仍由 EvidenceProvider/原接口拥有；主题层不创建会话、权限、查询、幂等键、缓存或审计。没有数据与无权继续安全区分，数据过期不能由视觉层填充。

### D-07 可访问性、性能与验收

迁移组件覆盖三种桌面窗口、100%/200% 缩放、键盘与减弱动态效果。旧壳层网格尚未切换，必要时只增加既有区域滚动与正文折行，不能以隐藏操作通过缩放验收。单位/组件行为测试只覆盖风险未知级、不同矩阵维度/非连续 bandId、表格大于默认页容量及链接身份、七态 unavailable 等用户可见边界；不测试源码字符串、令牌文件文本、CSS 类名、完整文案、包装转发或默认值快照。

真实浏览器扩展现有 read-only 与 assessment-warning-response 接缝，核对计算后的颜色、所有当前页行可达、历史两个矩阵版本、确认取消零提交/焦点恢复及证据脱敏。浏览器未取得的事实不能由 SSR 的 fill 属性字符串推断。构建记录产物分包与初始加载资源，主题仅引用实际使用的组件，不全量引入 AntD dist 包或远程字体；不添加任意包体积硬阈值或新性能框架。

### D-08 迁移、交接与越界处理

本轮只创建五个 planning 工件，tasks 均未勾选；不安装依赖、不生成 verification、不修改主规格或编排图。实施按依赖准备→令牌/Provider→共享表格→风险/图表→范围内回归执行，均在同一 change 收口后才交 CH-2。无数据库迁移、回填、发布策略或旧 URL 切换。

在进入 apply 前由主调度固定可交接 Git 检查点；不得为此自动提交当前 .scratch/CONTEXT/demo 改动。若实现时版本、消费者、接口或依赖与基线不同，按实际偏差升级，不新增业务接口或改动受保护边界。

## Risks / Trade-offs

- AntD 有包体与传递依赖成本，固定 Table 消费面和真实构建资源证据；不通过安装额外插件掩盖覆写成本。
- 四级主题不能为任意 ordinal 编造官方配色；中性标签保留真实等级，后续扩色需明确语义。配置维度和全部等级仍照实显示，不限制为四个数据项。
- 页面容器与确认 drift 已按源码记录，本 change 不删除在用容器、不更换状态机；后续壳层规划不能声称这些工作已在 CH-1 完成。
- 首次确认桌面表格/焦点/颜色仍需真实浏览器环境。本轮的静态规划校验不是这些行为的通过证据。

## Migration Plan

不做业务数据或公共接口 cutover。新主题、原共享表格和徽章/图表消费者在同一实现检查点更新，删除确定过时实现与所有原引用。对应行为与真实浏览器证据完成后，Finalizer 才在实际实现 HEAD 创建 verification；未完成不得以“基础层已搭好”收口。

## Open Questions

无阻塞设计选择。依赖变更授权、实际冻结安装、浏览器与正式服务可用性是实施前置事实，不授权以放宽策略、跳过关键验收或更换方案绕过。
