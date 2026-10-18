# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`88dce423806dfc34585803ec3f727f8d0d0550cb`。实施前由主调度在获得 Git 授权后形成包含已批准 planning 工件的可交接检查点；不得自动提交、覆盖或回滚当前 `.scratch/`、`CONTEXT.md`、`demo/v2/` 改动。
- 输入：本 change 的 proposal、`specs/web/design-system/spec.md`、design D-01～D-08，以及 `.scratch/riskflow-master-plan/prototypes/ui-redesign-spec.md`、`design-system-spec.md`。冲突或代码漂移须升级，不按原型覆盖生产事实。
- 继承主规格：`platform/engineering-baseline`、`platform/web-shell-interaction-primitives`、`web/assessment-warning-and-response-ui`、`web/agent-audit-and-operations-ui`、`quality/evaluation-and-browser-acceptance`。只新增 `web/design-system`，不替换旧能力或导航条款。
- 当前源码已核对：DataTable 原生渲染全部 rows；PageStateView 缺 unavailable 分支；动态矩阵已存在；`components/AppShell.tsx` 有生产消费者；ConfirmButton 与公开共享确认机制存在既有接缝差异。后两项不是本 change 的删除/状态机重构任务。
- 唯一新增直接依赖 `antd@6.6.6`，治理七字段、传递依赖与离线方式见 D-02。IP-01 依赖准备由有授权的主调度负责，Implementation 不运行改变锁文件的安装命令；其余 IP 在依赖检查点后实施。
- 当前为 planning，不勾选实现任务、不创建 verification、不执行安装、生产构建或浏览器验收。下文命令是后续实施和验收义务，不是已通过证据。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `apps/web/package.json`；`config/dependency-policy.json`；`pnpm-lock.yaml`；`scripts/check-dependency-policy.mjs` | 精确版本与七字段登记按现有政策形成同一依赖检查点；检查脚本只读 | 不另建依赖注册表、不放宽构建脚本/许可证/发布年龄政策 |
| IP-02 | `theme/tokens.css`、`theme/global.css`；`main.tsx` 的 AppRoot；`charts/types.ts` 的 ChartTheme/DEFAULT_CHART_THEME | 生产令牌唯一；入口接 ConfigProvider，稳定主题供图表共享，SSR 显式注入 | 不复制 demo 运行文件、hex 或根主题；不新增 DOM 轮询、远程字体、暗色开关 |
| IP-03 | `components/DataTable.tsx` 的 DataTable/DataTableColumn；`components/PageStateView.tsx`；`app/state.ts` 的 PageLoadStateV1 | 原 props 与服务端分页所有权不变，内部接 AntD Table；补原七态的不可用显示 | 不新建表格 API、七态枚举、业务请求或默认分页 |
| IP-04 | `charts/RiskMatrixChart.tsx` 的 RiskMatrixVersionChart/RiskMatrixLevel；`AssessmentMatrixPage.definitionOf`；`WarningDetailPage` 已有 matrixPlot；TrendLine/GraphView/useChart | 共用 presentRiskLevel，保留精确配置投影和 SVG；Canvas 使用解析主题 | 不复制矩阵、重算 P/C、补读全库/阈值、用类别或标识后缀推断风险 |
| IP-05 | 无生产消费者的 RiskMatrix5x5、DonutChart、HBars、GraphLegend；`charts/echarts.ts` | 删除死代码与仅由其消费的按需注册 | 不删除在用 components/AppShell、动态矩阵或原生治理矩阵 |
| IP-06 | `test/ssr-shells.test.tsx`、既有 read-only/assessment-warning-response 浏览器接缝、`playwright.config.ts` | 复用真实 PostgreSQL、生产 HTTP、冻结矩阵和证据权限用例；新增一个聚焦行为测试文件 | 不新增假后端、演示路由、测试框架、源码/CSS 字符串断言或截图快照门禁 |

本表中的生产相对路径均以 `apps/web/src/` 为根；测试路径以 `apps/web/` 为根。下文文件清单给出完整路径。

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1～1.2 | DS-R6 / DS-S13、DS-S14 | web manifest、依赖政策、锁文件 | 有授权者固定 AntD，登记 D-02，取得冻结传递依赖离线材料；执行政策检查 | 既有 workspace、Node/React 版本与策略；不加直接 icons/dayjs |
| IP-02 | 2.1～2.3 | DS-R1 / DS-S01、DS-S02；DS-R2 / DS-S04；DS-R5 / DS-S11、DS-S12；DS-R6 / DS-S13 | tokens/global、DesignSystemProvider、main、ChartTheme、shell CSS、错误色消费者 | 迁入 D-03 选定令牌与 error 色；一处解析和 Provider；移除第二根主题，修正非风险失败色及 reduced-motion/折行/局部滚动 | 七导航、当前 grid、停靠内容、路由、业务动作、风险告警的真实风险语义 |
| IP-03 | 3.1～3.2 | DS-R4 / DS-S09、DS-S10；DS-R3 / DS-S08；DS-R5 / DS-S11 | DataTable、PageStateView 及 CSS | Table pagination=false，不启用其他数据变换；保留 render(row)、列宽/对齐/行操作及输入顺序；补 unavailable 原因与原重试；键盘触发不与子操作重复 | 当前页 rows、链接身份、请求所有权；不迁移确认或证据状态机 |
| IP-04 | 4.1～4.3 | DS-R2 / DS-S03、DS-S05；DS-R3 / DS-S06、DS-S07、DS-S08 | riskPresentation、RiskBadge、WarningCenter/Detail、RiskMatrixVersionChart、definitionOf、TrendLine/GraphView | D-05 ordinal 投影与未知级中性呈现；确认状态改用 StatusTag；消除取模；Canvas 使用实际主题；类别不用风险等级色 | 已授权字段、冻结版本分组与 readKnowledgeRelease 范围、bandId、已保存落点/计数、空/不可用、现有 ECharts 生命周期 |
| IP-05 | 5.1 | DS-R3 / DS-S06；DS-R6 / DS-S13 | 删除清单及 echarts 注册 | 完成消费者核对后删无调用方固定矩阵/旧图表；删除其专属样式与 Pie/Bar 注册 | 不借删除重写活矩阵、MatrixGrid 或页面容器；若出现新消费者先升级 |
| IP-06 | 6.1～6.4 | DS-R1～DS-R6 / DS-S01～DS-S14 | 新行为测试、既有两份浏览器测试；本 change 的 tasks 与最终 verification | 按 §6 取得分层证据，正式构建与六窗口/缩放组合；记录资源、离线材料及不能执行的项；仅在实施完成后由 Finalizer 创建 verification | 不用静态检查冒充运行，不降级甲方来源资格、不提前勾选任务 |

## 4. 调用与副作用顺序

1. **依赖准备（IP-01）**：主调度核对授权、版本与 D-02 七字段 → 串行更新 manifest/政策/锁文件 → 冻结安装与离线材料检查 → 交给 Implementation。失败时停止依赖切换并报告真实错误，不自动改版本、改镜像策略或放开脚本。当前 planning 不执行此步骤。
2. **入口主题（IP-02）**：保持 tokens→global→shell 导入顺序 → DesignSystemProvider 包住现有 AppRoot → 挂载一次解析明确令牌集合 → 稳定 ConfigProvider/图表主题就绪 → 呈现原业务宿主。图表不在主题就绪前用 CSS var 字面量初始化 Canvas；SSR 使用 D-03 注入，不在模块加载时访问 document。
3. **普通读页面（IP-03）**：既有会话/工程/能力检查 → 原有有界读 → 原 PageLoadStateV1 → DataTable 原 rows/列 render → 链接或显式行操作。表格不请求、不裁切成默认十行、不拥有下一页。键盘行操作忽略来自内嵌链接/按钮的重复冒泡；原生链接保留自身导航。
4. **风险呈现（IP-04）**：已有授权结果/精确发布读取 → definitionOf 保留轴、格子、levelId 并传 ordinal → presentRiskLevel 只做标签/颜色投影 → SVG/徽章/图例一致显示。ordinal 未知或超出已定义四级调色板时保留实际标识和中性安全说明；不重新读取配置、不取模、不夹取、不假装已得最高风险。历史记录不切到当前发布。
5. **写操作与证据（IP-02、IP-03、IP-06）**：仍由原 ConfirmButton/所属域确认后提交；取消不提交、重试沿原冻结请求，上下文失效行为不变。EvidenceProvider 继续执行原定位、权限和脱敏边界。设计层不产生幂等身份、审计或额外写入。
6. **清理与证据（IP-05、IP-06）**：迁完真实徽章消费者才删除 WarningBadge；确认死图表无消费者后删除，保留动态图及按需 ECharts。运行相关检查一次，修复范围内问题；完成后由 Finalizer 记录实际实现 HEAD 的 verification。不得回滚用户无关改动或自动提交。

没有新增持久化副作用或重试策略。主题、表格或图表异常不得通过零值、静态示例、扩大查询范围或隐藏控件处理。

## 5. Schema、状态与持久化落实

- **领域 Schema/HTTP**：无变更，`packages/contracts`、core/adapters、API/Worker 均受保护。RiskMatrixLevel 的 ordinal 是由现有发布事实派生的前端显示字段，不是新的配置、DTO 或后端接口。
- **前端接缝**：D-03 固定 Provider、useChartTheme、presentRiskLevel 与 ChartTheme 的前景/背景数组；D-04 固定 DataTable 原 props，不新增全站参数迁移或兼容导出。矩阵既有可选 theme 参数保留。
- **七态**：使用 `PageLoadStateV1`，unavailable 的输入是 `reasons: readonly { code: string }[]`，仅显示安全原因；不得把 forbidden、error、empty 混为 ready 或渲染旧数据。原组件 onRetry 存在时沿原回调，样式层不自行重试。
- **权限/工程/版本**：沿既有 SessionProvider、EngineeringProvider、EvidenceProvider、AgentTaskProvider 及原有页面读边界；不创建 capability 授予、不改当前工程选择/上下文 revision，不增加权限查询。
- **状态机/事务/审计/幂等**：无新增；不改变确认、风险、预警、处置决定和 Agent 状态，不改原 command identity、请求序列、数据库事务、事件/SSE 或同步审计。
- **迁移/回填/发布与回滚**：无数据库或 URL 迁移、无业务数据回填。前端主题与所有直接消费者同批切换，旧 WarningBadge 与死图表移除；不能保留双主题或并行徽章导出。
- **观测与性能**：记录正式构建产物/初始请求资源，不引入遥测或任意体积门槛。根令牌只在挂载时解析；不在轮询/每格渲染中读 DOM，保留 useChart 的 resize/dispose。质量与验收证据保留“合成样本，待甲方复核”。

## 6. 验收证据矩阵

### 6.1 命令与前置条件

以下均在仓库根执行，命令为已存在工具入口；实现测试文件创建后才运行 A。不得把命令清单当作执行结果。

- **A**：`pnpm exec vitest run apps/web/test/design-system.test.tsx apps/web/test/ssr-shells.test.tsx`。新增测试使用现有 Vitest/React SSR 与显式注入主题；精确颜色的计算、事件与焦点只在浏览器证明，不靠 SSR 字符串猜测。
- **B**：`pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts`。沿现有 startBusinessBrowserServer，要求可用容器引擎、已锁定 PostgreSQL 18.6 镜像、Chromium 和真实生产 dist；不启动开发服务器，不跳过基础设施失败。
- **C**：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy`。依赖登记、类型与边界共用现有命令；不改检查器使结果通过。
- **D**：联网交付机执行 `pnpm fetch --frozen-lockfile`，在可丢弃的隔离验收副本执行 `pnpm install --offline --frozen-lockfile`，再执行 B；使用冻结 store/镜像，不在用户工作区删 node_modules 或断网。依赖变更、容器及离线环境操作需相应授权。记录锁文件、版本、来源和运行资源请求，无外部 CDN/原型请求。
- **E**：`openspec validate establish-web-design-system --strict --no-interactive`；规划和收尾都执行，但 E 不证明业务行为。

### 6.2 Requirement/Scenario 到运行证据

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| DS-R1 / DS-S01 | IP-01、IP-02、IP-03、IP-06 | read-only.spec.ts | 原正式列表与已接通 AntD Table；生产 dist | 计算后文字/表面/焦点与根主题一致，真实行和原查询不变，无额外默认蓝 | B、C |
| DS-R1 / DS-S02 | IP-02、IP-06 | ssr-shells.test.tsx；read-only.spec.ts | 原会话、七导航与精确深链 | 所有旧入口继续可达；不因尺寸令牌变成六导航、改变 grid 或隐藏停靠内容 | A、B |
| DS-R2 / DS-S03 | IP-04、IP-06 | design-system.test.tsx；assessment-warning-response.spec.ts | 非 level-N 标识，ordinal 1～4，名称有/无两组 | 返回实际标签，徽章/格子/图例同语义配色；不从 ID 猜级 | A、B |
| DS-R2 / DS-S04 | IP-02、IP-06 | read-only.spec.ts；assessment-warning-response.spec.ts | 真实失败/校验分支，不成功提交数据 | 可读错误、独立 error 色且不带风险徽章；真实预警风险语义不被改掉 | B |
| DS-R2 / DS-S05 | IP-04、IP-06 | design-system.test.tsx | 缺 ordinal、超出四级及非约定标识 | 保留原 ID/名称，中性 foreground/background，mapped=false，安全说明可访问；无取模/夹取 | A |
| DS-R3 / DS-S06 | IP-04、IP-05、IP-06 | design-system.test.tsx；assessment-warning-response.spec.ts | 测试内 3×2/5×5 精确配置及稀疏 bandId；已有真实 3×2 发布 fixture | 轴标签、配置单元格/落点与等级一致，没有固定额外行列；不按 ID 数字反算 | A、B |
| DS-R3 / DS-S07 | IP-04、IP-06 | assessment-warning-response.spec.ts | 沿既有 publishNextRiskMatrix 与历史两个冻结版本用例 | 新发布不改变历史网格/落点/引用，缺解释显示不可用 | B |
| DS-R3 / DS-S08 | IP-03、IP-04、IP-06 | design-system.test.tsx；既有两份浏览器测试 | empty/unavailable/forbidden/读失败；现有权限账号 | 安全原因与原重试可用；不生成示例点、不披露无权对象、不扩大查询 | A、B |
| DS-R4 / DS-S09 | IP-03、IP-06 | design-system.test.tsx；read-only.spec.ts | 组件内至少 12 条独立 ID/链接的当前页 rows；真实生产列表 | 第 11/12 个对象仍可达，各行链接身份正确；组件不再分页；既有下一页仍由原查询负责 | A、B |
| DS-R4 / DS-S10 | IP-02、IP-03、IP-06 | read-only.spec.ts；assessment-warning-response.spec.ts | 原取消/关闭入口、原只获定位权限账号及原重试用例 | 取消零 command 请求、冻结请求身份未改、证据正文不泄露 | B |
| DS-R5 / DS-S11 | IP-02、IP-03、IP-06 | 既有两份浏览器测试 | 1280×720、1440×900、1920×1080，各 100%/200%；原列表和确认入口 | Tab/Enter/Space 可操作，二维区域局部滚动，控件与错误未被固定层遮挡，关闭返回合法焦点 | B；真实浏览器人工缩放复核 |
| DS-R5 / DS-S12 | IP-02、IP-06 | read-only.spec.ts | reduced-motion: reduce；加载/错误原分支 | 非必要动画停用，状态仍可读、下一步可操作、不靠动画完成提交 | B |
| DS-R6 / DS-S13 | IP-01～IP-06 | 既有两份浏览器测试；构建/资源记录 | 正式 dist、真实 HTTP 与冻结离线材料 | 非演示路线实际消费主题/表格；无 demo、原型或 CDN 请求；保留版本与治理证据 | B、C、D |
| DS-R6 / DS-S14 | IP-01、IP-06 | Finalizer 的实际 verification | 工具/服务/离线材料真实可用性 | 缺失项明确失败/阻塞并附错误，不 skip、不以静态结果替代；质量材料保留合成资格 | B、D、E及实际日志 |

缩放口径：Playwright 的 deviceScaleFactor 只是像素密度，CSS zoom 也不单独作为浏览器 200% 缩放证据；在真实 Chromium 通过浏览器缩放操作复核六组合，保留窗口、缩放值、焦点/滚动实际操作和截图。自动化可以补充等效 CSS 视口回归，但不能替代该记录。截图用于证据，不建立像素快照断言。

最小永久行为测试边界：在新文件中表驱动覆盖风险映射与未知级、两种矩阵维度/稀疏轴、超过默认分页容量的独立对象链接、unavailable 安全状态。复用已有浏览器真实链路覆盖颜色/事件/权限与历史冻结，不新增转发/包装/非空结果测试。若直接修改的旧测试只断言文案、实现或样式文本，删除这类断言，不重新固定它们。

## 7. 文件清单与升级条件

下面是实施 allowlist，不是当前已修改清单；每个文件均归属稳定 IP。未列出的生产文件不得顺手改动。

### IP-01：依赖准备（仅授权主调度）
- 修改：`apps/web/package.json`、`config/dependency-policy.json`、`pnpm-lock.yaml`。
- 只读：`scripts/check-dependency-policy.mjs`、`pnpm-workspace.yaml`、根 `package.json`，保留其现有安装/构建/许可证策略。

### IP-02：令牌、唯一 Provider 与非风险错误语义
- 新增：`apps/web/src/theme/DesignSystemProvider.tsx`。
- 修改：`apps/web/src/theme/tokens.css`、`apps/web/src/theme/global.css`、`apps/web/src/main.tsx`、`apps/web/src/charts/types.ts`、`apps/web/src/shell/AppShell.css`。
- 修改明确的非风险错误/失败或危险操作颜色消费者：`apps/web/src/components/ConfirmButton.css`、`apps/web/src/components/StatusTag.css`、`apps/web/src/components/StageBar.css`、`apps/web/src/agent/AgentDock.css`、`apps/web/src/pages/ops/ops.css`、`apps/web/src/pages/ReviewDetailPage.css`、`apps/web/src/pages/IdentificationRunPage.css`、`apps/web/src/charts/ChartSurface.css`；只替换相应语义，不把业务预警风险色一并改成 error。
- 修改：`apps/web/src/pages/LoginPage.css` 的普通说明色为中性。
- shell CSS 只调整根字体/颜色覆盖、焦点、滚动及折行，不切换布局列宽/导航结构。

### IP-03：共享基础消费
- 修改：`apps/web/src/components/DataTable.tsx`、`apps/web/src/components/DataTable.css`、`apps/web/src/components/PageStateView.tsx`、`apps/web/src/components/PageStateView.css`。
- DataTable.css 仍有原生 `table.data-table` 消费者；新 AntD 覆写必须限定于其共享组件范围，不破坏原生表格规则或要求全站一次迁移。

### IP-04：等级与图表实际消费者
- 新增：`apps/web/src/theme/riskPresentation.ts`、`apps/web/src/components/RiskBadge.tsx`、`apps/web/src/components/RiskBadge.css`。
- 修改：`apps/web/src/pages/WarningCenterPage.tsx`、`apps/web/src/pages/WarningDetailPage.tsx`、`apps/web/src/pages/AssessmentMatrixPage.tsx`、`apps/web/src/charts/RiskMatrixChart.tsx`、`apps/web/src/charts/TrendLine.tsx`、`apps/web/src/charts/GraphView.tsx`。
- 删除：`apps/web/src/components/WarningBadge.tsx`、`apps/web/src/components/WarningBadge.css`，在真实消费者迁移后删除，不保留导出别名。

### IP-05：确定过时实现
- 删除：`apps/web/src/charts/RiskMatrix5x5.tsx`、`apps/web/src/charts/RiskMatrix5x5.css`、`apps/web/src/charts/DonutChart.tsx`、`apps/web/src/charts/HBars.tsx`、`apps/web/src/components/GraphLegend.tsx`、`apps/web/src/components/GraphLegend.css`。
- 修改：`apps/web/src/pages/AssessmentRecordPage.css`，仅移除旧 `.arp-matrix*` 专属死样式；`apps/web/src/charts/echarts.ts` 移除仅由被删 DonutChart/HBars 使用的 PieChart/BarChart 注册，保留 Line/Graph 与活组件。

### IP-06：测试与交付记录
- 新增：`apps/web/test/design-system.test.tsx`。
- 修改：`apps/web/test/browser/read-only.spec.ts`、`apps/web/test/browser/assessment-warning-response.spec.ts`；`apps/web/test/ssr-shells.test.tsx` 仅在受影响现有断言需要调整时修改，不改七导航基线。
- 既有 `business-server.mjs`、`deploymentPolicies.mjs`、`server.mjs` 与 `playwright.config.ts` 只读复用，不为换皮扩张假 fixture/服务或切换测试项目。
- 实施过程中按证据更新本 change 的 `tasks.md`；实施完成后的 Finalizer 新增同目录 `verification.md`，记录规范实现、命令、真实浏览器和离线证据。说明与变更事实由本 change 工件和后续归档主规格承载，不新建平行设计说明或 changelog。

### 受保护边界及升级

- `apps/web/src/components/AppShell.tsx` 不删；`shell/AppShell.tsx`、navigation、routes、app/state、api、EvidenceProvider/EvidenceDrawer、ConfirmButton.tsx、shared/confirmation.ts、CommandConfirmationDialog.tsx 不改行为。
- 原生 `RiskMatrixPage`/MatrixGrid、RiskOverview 的真实预警计数、其他领域页面、后端、contracts、数据库、desktop、worker、demo、原型及编排图均不在修改范围。
- 以下情形停止相应切片并升级：依赖版本或政策不允许/未获安装授权；需要新增直接依赖或改脚本许可；基线外出现死组件的新消费者；必须修改公共接口、查询范围、确认/权限/状态机、冻结版本或受保护文件；需新增 allowlist 之外文件；现有命令/真实数据接缝不能支撑 §6 证据。
- 普通样式、类型与已批准行为的实现缺陷在本 change 内修复；不得以静默扩范围、换框架、删关键测试、伪造成功或隐藏操作收口。

## 8. 验收 Agent 授权与限定审计

- 本轮不派发 Implementation/Finalizer，不操作执行图。进入实施时主调度按项目流程与实时 revision 分派；每个独立 Task 使用新 session。
- Finalizer 被授权在 IP-02～IP-06 的 allowlist 内修复普通实现缺陷、运行 §6、记录实际实现 HEAD 并创建 verification；依赖切片 IP-01 仍由获授权主调度处理。缺少权限、环境或需要改变 D-01～D-08 时升级，不自行补设计。
- 验收必须逐条闭合 DS-S01～DS-S14；测试通过不能替代正式页面实际消费和真实浏览器/离线证据。未完成项不勾选，不归档。
- 若按项目规则触发限定审计，标签固定为：风险等级与错误语义、冻结矩阵不变性、键盘/焦点/缩放、证据脱敏与零额外提交、依赖/离线可重放。只审已批准范围；同一收尾最多一次限定审计，审计者在自己的活动 Task 内完成普通修复与回归。
