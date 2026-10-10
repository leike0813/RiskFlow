# RiskFlow 原型 v2 指导性方案

> 状态：指导性方案，不含实现。已按 2026-09-18 的八项决策定稿（落点 `demo/v2/`，新增审阅 Harness）。
> 事实源：`openspec/specs/`（已归档主规格）、`packages/contracts/`（冻结契约）、`packages/core/src/access/policy.ts`（角色权限策略）、`apps/web/`（C10 生产外壳）、`config/orchestration/execution-graph.json`（路线与依赖）。
> 非事实源：`.scratch/` 全部草稿（含本文件与 `full-product-ui-spec.md`）。

---

## 1. 为什么做

三件事同时成立，才使 v2 成为当下唯一可推进的方向。

**C32–C35 的实施被卡在 9 层依赖之外。** 四个 UI change 共用一个门 C31，而 C31 的关键路径是 `C17 → C20 → C21 → C22 → C23 → C24 → C30 → C31`，其中 C20 目前 `blocked`，C17/C26 卡在 finalizing 等 Finalizer。控制面对 C32–C35 的判定一律是 `pending / 等待依赖归档`，dispatch 会被直接拒绝。`openspec/config.yaml:25` 明令「仅使用已归档 change 的直接依赖」，「提前实施」这条路是封死的。

**生产端的设计层确实一片空白。** `apps/web` 自 2026-09-05 起未再改动，只有一个样式文件 `src/shell/AppShell.css`（291 行），`:root` 用的是 `#17202a` / `#f7f9fb` / `system-ui`；九条基础路由 `render` 全为 `null`，认证态下统一渲染「当前不可用」。没有设计令牌、没有组件、没有业务页面。C10 刻意只冻结了外壳结构与接缝（`design.md:273`），把视觉与页面内容留给 C32–C35。

**现有原型不能直接充当设计基线。** `demo/` 做于 2026-08-28，此后 C11–C25 陆续归档。它的视觉语言成熟，但契约对齐只停在语义层：fixture 与 `packages/contracts` 零 import，字段形状普遍不符，缺 31 个规格页面，缺 11 类状态与语义，还有两处直接违规（5×5 矩阵硬编码违反 `AGENTS.md` §4.3；`content/agent.ts:45-46` 把 `identificationGraph`/`assessmentGraph` 写进用户可见文案，违反 `AGENTS.md` §8）。

结论：**在原型里把设计定形，比在规格里空想便宜得多**。这也是唯一不触碰执行图、不需要 OpenSpec change、不阻塞任何路线节点的推进方式。

---

## 2. 边界

### 2.1 做什么

- 在 `demo/v2/` 沙盘中产出覆盖规格全部 57 个页面 ID 的可点击设计原型。
- 把冻结契约（字段、阶段、状态、权限、版本、审计）落到页面设计上。
- 把设计系统从「五张汇报图的早期草案」提升为覆盖全量页面的产品级规范。
- 把 C10 外壳契约的结构性缺口探明并固化成可用于将来契约演进 change 的输入。
- 提供一个可直接部署启动的**审阅 Harness**，供逐页、逐状态、逐角色审阅。

### 2.2 不做什么（红线）

| 禁止 | 依据 |
|---|---|
| 修改 `apps/web`、`packages/*`、`apps/api`、`apps/worker` 的任何文件 | `AGENTS.md` §3：无 OpenSpec change 不得改被规格覆盖的代码 |
| 新建任何 OpenSpec change | 原型不属能力/接口/模块级变更 |
| 修改 `config/orchestration/execution-graph.json` 或任何编排状态 | 用户明示「不动执行图」；`HANDBOOK:16` 禁止从外部推测 frontier |
| 修改 `openspec/config.yaml`、`openspec/specs/` | 它们是事实源 |
| 修改任何根配置文件（eslint / prettier / depcruise / vitest / tsconfig / workspace） | 落点选择的目的就是零根配置改动 |
| 把 v2 或其 harness 接入生产路径、或声明已实现 C32–C35 的任何能力 | `openspec-delivery-roadmap.md:592`、`:198` |
| 用 Mock 后端冒充交付、把 v2 作为验收依据 | `AGENTS.md:125`；roadmap:186 |
| 修改 v1（`demo/` 顶层）的任何文件 | 决策 2：v1 冻结为零件目录 |
| 在本原型中做 Electron 工程（主进程、preload、IPC、打包） | 正式客户端由 C37 在 apps/desktop 交付 |
| 让审阅设施依赖泄漏进 `src/` | 见 §5.7 依赖边界 |

交付说明中必须显式标注这是阶段性设计原型。

---

## 3. 落点与隔离

### 3.1 落点：`demo/v2/`（已定）

选它是因为在**零根配置改动**的前提下已获得四重隔离：

| 机制 | 现状 | 对 `demo/v2/` 的效果 |
|---|---|---|
| `eslint.config.js:11` | ignores 含 `demo/**` | `pnpm lint` 跳过 |
| `.prettierignore:5` | 含 `demo/**` | `pnpm format:check` 跳过 |
| `dependency-cruiser.config.cjs` | `doNotFollow` 含 `demo`，且规则 `no-production-to-demo` 覆盖 `^demo/` | 依赖分析跳过；生产代码无法依赖 |
| `pnpm-workspace.yaml` | 只列 `apps/*`、`packages/*` | `pnpm install` 与 `pnpm typecheck`（`tsconfig.json` references 仅 6 项）不纳入 |

唯一残留风险是 `vitest.config.ts` 未设 `include`/`exclude`，默认 glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` 会扫到 `demo/**`。规避方式见 §5.8。

**已否决的备选**：另建 `demo-v2/`。它会落入 lint / format / 依赖分析 / vitest 四条门禁的扫描范围，需要改 4 个根文件，而它们正是 roadmap §7.3 定义的「中央注册文件，由主调度 Agent 串行更新」。为一个设计沙盘付这个代价不划算。

### 3.2 v1 的角色

`demo/` 顶层原样冻结，作为**零件目录**：`src/components/`（20 个）、`src/charts/`（7 文件）、`src/theme/tokens.css`、`content/`（8 个 fixture）。v2 **复制**而非导入所需零件，然后自行演进。复制是有意为之——v1 一旦被引用就不再是冻结参照物。

v1 同时保留为审阅对照物：其预览服务（`capture.sh` 用 5319 端口）可与 v2 并排查看 22 个重叠页面的演进差异。

---

## 4. 技术底座：生产可移植子集

目标是让 v2 的设计成果在迁入生产时不需要重新发明结构。原则是：**结构对齐生产，依赖降到生产可接受的下限**。

### 4.1 必须对齐生产的结构与命名

| 领域 | 生产事实源 | v2 要求 |
|---|---|---|
| 路由 | `apps/web/src/app/routes.ts:43` `WebRouteContributionV1` | 同形状的 contribution 注册表：`routeId` / path template / title / section / shellKind / contextRequirement / requiredViewCapability / render |
| 页面状态 | `apps/web/src/app/state.ts:21-28` | 七态联合 `idle \| loading \| ready \| empty \| error \| forbidden \| unavailable`，逐页覆盖 |
| 能力位 | `packages/contracts/src/ports/index.ts:448-478` | 29 个取值原样引用；导航按 allowed / denied / unknown 三态渲染 |
| 领域分支 | 同文件 `:482-535` | 53 个 branch 名与能力映射，作为页面「数据来源」标注的词汇表 |
| 角色策略 | `packages/core/src/access/policy.ts:19-42` `PRESET_ROLE_BRANCHES_V1` | 五个预设角色的分支集合原样镜像；并集语义见 `branchesForRoles`（`:62-69`） |
| 导航 | `apps/web/src/shell/navigation.ts:15-65` | 七项导航，标签逐字一致 |
| 上下文 | `apps/web/src/app/state.ts:12-18` | `projectId` / `spatialScopeRef` / `processNodeId` + 单调递增 `revision` |
| 阶段枚举 | `packages/contracts/src/workflows/index.ts:220-245` | `I0–I9` 与 `A0–A9` 各 10 阶，用于运行监控页 |
| 版本引用 | `packages/contracts/src/ports/index.ts` 各 `versionedRef` | 适用规则集 / 风险矩阵 / 权重 / 机理库 / 提示模板 / 量化标准版本，逐页显式呈现 |

### 4.2 禁止引入的依赖

`react-router-dom`（C10 `design.md:68` 否决）、Redux/Zustand（`design.md:101` 否决）、任何 UI 组件库或 CSS 框架、`echarts`（对 `apps/web` 属新依赖，须走 C34 的 dependency checkpoint）。v2 的 `src/` 也不应引入这些，否则「可移植」名不副实。

### 4.3 路由必须可换实现

生产 `WebHistoryAdapterV1`（`routes.ts:296-351`）已把历史适配抽象出来。v2 沿用该形状，并提供 **memory / hash / history** 三种模式，支持原型 `file://` 浏览和审阅 Harness 深链。正式 Electron 加载 HTTPS，沿 Web 路由运行；原型的多模式适配不成为生产迁移要求。

### 4.4 图表的处理

图表是设计核心（donut / hbars / trend / graph / matrix 五类），但生产无图表库。做法是把图表收敛到一个抽象接缝：

- 定义 `ChartSurface` 契约（输入数据形状 + 尺寸 + 主题令牌），实现用纯 SVG + CSS，零运行时依赖。
- 五类图表各自的**视觉规范**（含阈值线、越限标注、图例、空态、无数据态）写成设计规格，与实现解耦。
- 在缺口台账中登记：生产图表库选型属于 C34 的 dependency checkpoint，v2 不预设库。

`RiskMatrix5x5` 在 v1 里是纯 CSS，但把 I–IV 与 5×5 格硬编码了。v2 必须把矩阵改为**由版本化配置驱动的渲染**（行/列刻度、等级文案、当前落点全部来自数据），这是 `AGENTS.md` §4.3 的硬要求。

### 4.5 React 版本与类型

v2 用 React 19 与生产对齐。特别注意 v1 的 `icons.tsx:23` 用了 `Record<IconName, JSX.Element>`，React 19 已移除全局 `JSX` 命名空间，复制时必须改成 `React.JSX.Element`。

---

## 5. 审阅 Harness

### 5.1 目标与形态

一条命令构建并启动，绑定 `0.0.0.0:5320` 并打印可访问 URL；你在浏览器里逐页、逐状态、逐角色审阅设计效果。三层交付：

| 层 | 内容 | 用途 |
|---|---|---|
| L1 静态产物 | `demo/v2/dist/` | 可丢任意静态托管或内网 Nginx |
| L2 启动脚本 | `npm run review` = 构建 + 起静态服务 + 打印 URL | 本机一键启动 |
| L3 审阅控制台 | 应用内 `#/__review` 预留路由 | 页面总览 / 状态矩阵 / 角色切换 / 缺口台账 |

可选 `Dockerfile`（nginx 承载 `dist/`）供异机部署。默认绑 `0.0.0.0` 便于你从桌面浏览器访问；若希望更保守，可绑 `127.0.0.1` 配合 SSH 隧道（你现有工作方式已具备该条件）。原型无鉴权、无真实数据，内网暴露的风险可接受。

### 5.2 审阅控制台的四块

**页面总览台** —— 57 张卡片网格，每张显示 页面 ID / 中文名 / 域 / 骨架 / 归属 change / 已登记 `GAP-*`。点开直达对应页。

**状态矩阵** —— 57 × 7 的矩阵，单元格直接以强制状态打开该页。这是审阅设计完整性的主力工具：mock 数据只会让页面停在 `ready`，其余六态（`idle` / `loading` / `empty` / `error` / `forbidden` / `unavailable`）否则无从检验。

**角色切换** —— 五个预设角色可单选或多选，多选按并集。能力集**镜像既有策略而非手写**：`PRESET_ROLE_BRANCHES_V1`（`packages/core/src/access/policy.ts:19-42`）给出每个角色的分支集合，`branchesForRoles`（同文件 `:62-69`）定义并集语义，`capabilitiesForBranches`（`:71-76`）推导能力位。切换后导航可达性、动作可用性、字段可见性实时重算，用于逐项验证规格 §17 的角色 × 界面矩阵。

有一处最容易做错，审阅时要专门验：`system-administrator` 的分支集是**空集**，与 §17「系统管理员不自动可见业务数据」一致。实现时不要顺手写成「管理员看全部」。

**缺口台账面板** —— 浏览 `GAP-*` 的依据 / 预设 / 待确认 / 风险，并可跳到相关页面。

### 5.3 审阅态必须可寻址

所有审阅参数走 URL：

```
#/__review                                            审阅控制台
#/identification/runs/RUN-001?state=empty             强制空态
#/knowledge/mechanisms?roles=reviewer,field-responder&gaps=on
```

你可以把任一视图存成书签或原样发给我，我能精确定位你看到的那一屏。否则反馈会停在「某页看着不对」，来回成本很高。

### 5.4 强制状态的实现位置

强制状态与角色注入一律在**框架层**完成，覆盖 `PageLoadState` 与能力集。页面组件不得为审阅需求添加任何分支或标记。理由很实在：页面代码是这次唯一可迁移的资产，让审阅工具污染它，等于用工具需求绑架设计产物。

### 5.5 视口与 Electron 安全区

控制台提供宽度预设（1920 / 1440 / 1280 / 64rem 响应式下限 / 声明的最小窗口尺寸），用于审阅 §6 的窗口约束。原型可保留自绘标题栏安全区叠加工具，C37 首期使用系统标题栏，不依赖该审阅设施。

### 5.6 截图与 v1 对照

- `npm run capture`：产出 5 张汇报图（1920×1080）与可选的逐页图。默认驱动 Playwright chromium（本机已缓存 `chromium-1223`），可回退系统 `google-chrome`（`/usr/bin/google-chrome` 已确认存在）。
- 截取范围只含产品路由；`#/__review` 与设计说明覆盖层**必须不出现在产物中**，脚本对此做断言。
- v1 对照：22 个重叠页面给出 v1 深链（v1 预览占 5319），并排看演进差异。

### 5.7 依赖边界（保住可移植性的关键）

harness 必须把依赖分成两层，否则「生产可移植子集」立刻破功：

| 层 | 目录 | 依赖约束 | 是否迁移 |
|---|---|---|---|
| 设计产物 | `src/` | 零第三方运行时依赖（仅 `react` / `react-dom`） | 是，唯一要迁移的部分 |
| 审阅设施 | `tools/`、根脚本、`Dockerfile` | 可用 Playwright 等原型专用依赖 | 否，永不迁移 |

### 5.8 与根门禁的关系

- `demo/**` 已被 `eslint.config.js:11` 与 `.prettierignore:5` 忽略，`dependency-cruiser` 的 `doNotFollow` 与 `no-production-to-demo` 覆盖它 —— **零根配置改动**。
- 唯一残留：`vitest.config.ts` 无 `include`/`exclude`，默认 glob 会扫到 `demo/**`。因此 harness 的校验脚本**不得**使用 `.test.` 或 `.spec.` 中缀，统一命名 `*.check.ts`，由 `npm run check` 驱动。这样无需触碰根配置。
- 依赖安装：`demo/v2/` 是独立 npm 项目，需单独 `npm install`。这属「安装依赖」类操作，**需要你的授权**（v1 已有先例）。若希望零新增依赖，可只用 `react` / `react-dom` / `vite` / `@vitejs/plugin-react` / `typescript`，截图退回系统 `google-chrome`。

### 5.9 启动纪律

实现阶段只验证 harness「能起、能探活、能停」，不留常驻进程 —— 沿用项目对开发服务器的既有约束。是否长期运行由你决定。

---

## 6. Electron 前瞻约束

Electron 客户端已纳入 C37，采用加载内网 HTTPS 的薄客户端方案，完整 UI 归 `apps/web`。原型本身不实现 Electron；正式交付遵循[桌面客户端与多终端架构](desktop-client-architecture.md)，下列约束用于界面迁移。

| 约束 | 设计要求 |
|---|---|
| 窗口可缩放 | 放弃 v1 的 `viewport width=1920` 硬钉做法；以 64rem 为响应式下限（对齐生产 `AppShell.css:270`），并声明最小窗口尺寸 |
| 标题栏 | 首期使用系统原生标题栏；若以后选择自绘，另行验证拖拽安全区和平台可访问性 |
| 无浏览器外框 | 页面内必须自带前进/后退/面包屑等导航可视线索，不依赖浏览器按钮 |
| 路由模式 | 复用 Web 的 HTTPS 路由和深链刷新，不因 Electron 引入本地 file 页面或强制 hash / memory |
| 资源路径 | 页面、静态资源、API 与 SSE 使用部署的同一 origin，不加载公网 CDN；无需为本地安装包修改 Web base |
| 不依赖弹窗 | 禁止 `window.open` 与 `target="_blank"`；外部跳转走显式处理位 |
| 导出即一等公民 | P-AU-01 报告导出设计成独立界面，不依赖浏览器打印对话框 |
| 分辨率无关 | 图表适应窗口与缩放，沿已批准图表实现验证，不因桌面交付强制更换渲染器 |
| 离线 | 服务端与安装包可在无公网环境交付；客户端仍须连接内网服务，原型可离线不证明正式业务可脱离服务器 |

这些约束进入 C37 的 Web 迁移和桌面验收；移动端仍需单独适配与验收。

---

## 7. 设计系统基线

v1 的视觉方向保留，但它从未被规格化到产品级：令牌只有 48 行、30 个变量，缺间距刻度、字号行高、圆角刻度、动效时长、z-index；**没有任何 `@media`、没有 `prefers-reduced-motion`、没有暗色**（全目录 grep 零命中）。v2 要补齐的清单：

**令牌层**
- 保留（连同 v1 的语义约束）：框架底色 5、文本 2、工程蓝 2、风险四级 11、状态色 6、字体栈、卡片圆角与阴影、框架尺寸 3。
- 新增：间距刻度（建议 4/8/12/16/24/32/48）、字号与行高配对刻度、圆角刻度、动效时长与缓动、z-index 层级（v1 靠散落的 30/40/50/60，应令牌化）、断点。
- 把 v1 里硬编码的 hex 收回令牌：`AppShell.css` 6 处、`RiskMatrix5x5.css` 5 处、`RiskBadge.css` 4 处、`StageBar.css` 3 处、`ConfirmButton.css` 3 处。

**可访问性**（决策 5：对齐生产 C10 已有实现）
- skip-link、`focusMainHeading`、`aria-busy`、`aria-live`、`prefers-reduced-motion`、64rem 断点，全部照搬 `apps/web/src/shell/AppShell.tsx` 与 `AppShell.css`。
- 扩展到 57 页：键盘可达、对话框/抽屉的焦点陷阱与归位（v1 的 `ConfirmButton` 连 `role="dialog"` / `aria-modal` / Esc 都没有）、颜色不作为唯一信息载体（风险等级必须带文字标签，v1 已做对，需保持）、表单标签与错误关联。
- **注意**：`full-product-ui-spec.md` 完全没有可访问性章节，`product-information-architecture.md:101` 把它列为开放项而承接票未覆盖。这是规格空白，v2 的 a11y 基线**没有文档依据，只能以生产 C10 实现为准**，并在缺口台账中登记。

**视觉语言**（延续 v1，不改方向）
深海军蓝框架 `#0e2238`/`#15324d` + 浅灰蓝底 `#f3f6fa` + 白卡片（1px `#dce4ee` 描边、8px 圆角、6% 阴影）；工程蓝 `#2166d1` 是唯一强调色，承担导航/主按钮/主图表；风险四级色严格限定于等级/越限/预警；1.5px 描边线性图标，禁 Emoji/3D/照片。

**暗色模式**：v1 无。v2 需给出设计，但**不要求实现** —— 是否落地由生产端决定，先把令牌结构设计成可切换即可。

---

## 8. 页面铺法：57 页

### 8.1 清单与分组

按域分 11 组，共 57 页。骨架记为 A 列表 / B 详情 / C 运行 / D 治理 / E 复核 / AG Agent 专用。

| 域 | 页数 | 页面 ID | 骨架分布 | 归属 |
|---|---|---|---|---|
| P-OV | 1 | P-OV-01 风险态势总览 | B | C34/C35 待定 |
| P-PJ | 10 | P-PJ-01 工程概览、P-PJ-02 工程开通与业务上下文表单、P-PJ-03 空间区段与上下文修订、P-PJ-04 工程成员与资料访问、P-PJ-05 资料目录、P-PJ-06 资料登记表单、P-PJ-07 资料详情、P-PJ-08 接入任务列表/详情、P-PJ-09 监测概览、P-PJ-10 监测序列详情 | B/B/D/A/A/B/B/**A+C**/A/B | C32 |
| P-KM | 8 | P-KM-01 风险机理库、P-KM-02 项目工序模型治理、P-KM-03 规范标准库、P-KM-04 类比工程案例库、P-KM-05 指标体系与量化标准、P-KM-06 结构化评分规则与适用规则集、P-KM-07 风险矩阵、P-KM-08 措施库 | 全部 D | C32 |
| P-RI | 7 | P-RI-01 识别任务列表、P-RI-02 启动识别向导、P-RI-03 识别运行详情、P-RI-04 项目工序模型视图、P-RI-05 标准化风险记录列表、P-RI-06 标准化风险记录详情、P-RI-07 工序风险关联图谱 | A/B/C/B/A/B/B | C33 |
| P-RA | 7 | P-RA-01 待评估风险、P-RA-02 启动评估向导、P-RA-03 评估运行详情、P-RA-04 风险评估记录列表、P-RA-05 风险评估记录详情、P-RA-06 P/C 风险矩阵视图、P-RA-07 重新评估历史 | A/B/C/A/B/B/A | C34 |
| P-WR | 4 | P-WR-01 预警中心、P-WR-02 预警详情、P-WR-03 预警处置任务列表、P-WR-04 预警处置任务详情 | A/B/A/B | C34 |
| P-RS | 5 | P-RS-01 处置建议详情、P-RS-02 现场处置执行登记表单、P-RS-03 处置效果预测详情、P-RS-04 反馈与偏差记录详情、P-RS-05 校准建议详情 | 全部 B | C34 |
| P-AG | 3 | P-AG-01 Agent 停靠栏、P-AG-02 Agent 全屏工作台、P-AG-03 Agent 任务详情 | **AG/AG**/C | C35 |
| P-RV | 6 | P-RV-01 待复核队列、P-RV-02 复核详情、P-RV-03 识别复核·修正并通过、P-RV-04 证据追溯、P-RV-05 运行记录、P-RV-06 版本与操作审计 | E/E/E/B/**A+C**/A | P-RV-01/02 待定，其余 C33/C35 |
| P-AU | 1 | P-AU-01 报告导出 | B | C34/C35 待定 |
| P-OP | 5 | P-OP-01 账号与工程开通、P-OP-02 数据源与适配器连接、P-OP-03 运行与设施健康、P-OP-04 模型与提示模板版本、P-OP-05 备份与恢复 | A/**A+B**/A/D/B | C35 |

归属双写的 4 页（P-OV-01、P-RV-01、P-RV-02、P-AU-01）按决策 7 不裁决，在缺口台账登记为待定，页面照做。

页面设计另有两处既有事实源可用：P-OP-01「账号与工程开通」的动作集合取自 `SYSTEM_ACCESS_ACTIONS_V1`（`policy.ts:44-51`，6 项）；P-PJ-03/P-PJ-04 的成员与空间区段动作取自 `PROJECT_MANAGER_ACCESS_ACTIONS_V1`（`:53-58`，4 项）。不要自行发明动作名。

### 8.2 拆页规则（决策 6）

v1 有 4 处自定的页面合并，v2 一律拆开为独立页面与独立 URL：

| v1 合并页 | v2 拆为 |
|---|---|
| `RiskDetailPage` | P-RI-06 标准化风险记录详情 + P-WR-04 预警处置任务详情 + P-RS-01 处置建议详情 |
| `AssessmentRecordPage` | P-RA-05 风险评估记录详情 + P-RA-06 P/C 风险矩阵视图 |
| `AssessmentRecordsPage` | P-RA-04 风险评估记录列表 + P-RA-07 重新评估历史 |
| `RuleSetsPage` | P-KM-05 指标体系与量化标准 + P-KM-06 结构化评分规则与适用规则集 |

但规格 §18 要求第 4、5 张汇报图是**跨页组合视图**。拆页后必须另设「组合视图」机制，而不是把页面重新合并：用路由参数或专用组合路由，把 2–3 个页面以只读、无重复事实的方式并置，并保证被组合页各自的页面契约不被破坏。这本身是一个设计交付项。

### 8.3 骨架扩展（预设）

C10 的五类骨架（`WebShellKindV1 = list | detail | run | governance | review | custom`）表达不了规格要求的形态。v2 需预设扩展并在缺口台账标注：

- **复合骨架** A+C（P-PJ-08、P-RV-05）与 A+B（P-OP-02）—— 单值枚举无法表达，需组合机制。
- **Agent 专用骨架**（P-AG-01/02）—— 枚举中无对应值。
- **15 处 slot 缺口**，结构性的是：B 缺右侧「上下文」停靠区与底部业务事件时间线；C 缺运行头部（运行标识/状态/阶段/触发原因/操作者/启动时间/幂等键）、子任务表、结果汇总；A 缺上下文副标题与独立主操作区；D 缺对象列表（审核状态筛选）与修订表单；E 缺批量确认摘要与历史决定。
- 另需容纳三种 v1 已有、五类骨架都放不下的形态：主从复合页（左列表右详情）、KPI 横条网格、图谱画布。

### 8.4 页面状态

每页必须给出七态设计（决策 3 要求「缺口预设并注明」，七态缺口即在页面内预设）。至少覆盖：`idle`、`loading`（含骨架屏）、`ready`、`empty`、`error`（仅展示 code / retryable / requestId / 引用类别，照搬 `PageFrame.tsx:19-26` 的安全字段）、`forbidden`（置灰并提示所需能力，照搬 `PageFrame.tsx:38-56`）、`unavailable`（区分「路由未接入」与「权限检查中」）。

七态不靠人工翻页检验，由 §5.2 的状态矩阵承载。

---

## 9. 缺口预设与注明机制

决策 3 要求缺口可预设并注明，但 `AGENTS.md` §8 禁止在用户可见界面放开发说明。两者靠**双轨**同时满足。

**轨道一：缺口台账（文档轨）**
单一 markdown 文件，逐条登记，稳定 ID 形如 `GAP-001`。每条固定五个字段：

| 字段 | 说明 |
|---|---|
| 缺口 | 一句话描述 |
| 依据 | 哪条已归档规格/契约/文档缺失或冲突，附路径与行号 |
| 预设 | v2 里采用的设计决定 |
| 待确认 | 将来由哪个 change 或谁裁决 |
| 风险 | 预设被推翻时的影响面 |

**轨道二：原型内标注（界面轨）**
由 §5.2 的缺口台账面板与 `?gaps=on` 覆盖层承载，默认关闭。关闭状态下页面与截图**完全不出现任何内部信息**，汇报截图一律以此状态产出。

**必须登记的缺口类别**

| 类别 | 内容 |
|---|---|
| G1 外壳契约 | 15 处 slot、复合骨架、Agent 骨架、主从/KPI/图谱形态 |
| G2 契约字段 | v1 fixture 与 `packages/contracts` 的字段级偏差：关系三元组、`compositeConfidence{value,basis}`、P/C 与等级归属、`externalRiskEventId` 二选一、评估记录缺 `weightVersion`/`indicatorResults`/`kind`、预警 `triggerType` 单值 vs 数组、缺 `evidenceReferences`/`audit` |
| G3 未建能力 | 部分可用 `available\|partial\|unavailable`、证据脱敏 `full\|redacted`、Agent 任务信封（taskType / 工具策略 / 预算策略 / 类型化增量 / 确定性校验）、治理生命周期五分支与版本 diff、`I0–I9`/`A0–A9` 运行阶段、双时间查询、报告与审计证据包导出 |
| G4 归属待定 | P-OV-01、P-RV-01、P-RV-02、P-AU-01 的 change 双写 |
| G5 依赖决策 | C37 迁移所需图表/路由依赖，以及 Electron 精确版本、打包工具和平台验收；HTTPS 路由形态已明确 |
| G6 规格空白 | 可访问性无规格依据，只能对齐生产 C10 实现 |

**契约字段的处理原则**：v2 的 fixture **以 `packages/contracts` 为准重写**，不沿用 v1 的字段形状。这是 v2 相对 v1 最实质的改进之一，也是「生产可移植」的前提。

---

## 10. 里程碑：做到哪一步

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| **M0 底座与隔离** | `demo/v2/` 目录、独立 package.json 与锁文件、Vite + React 19 + TS、路由与七态框架空壳、`npm run build` / `npm run review` 骨架 | 构建通过；`npm run review` 能起、能探活、能停；根 `pnpm verify` 相关项结果与改动前一致 |
| **M1 设计系统** | 令牌补全、排版与间距刻度、z-index 与动效令牌、暗色结构、a11y 基线 | 令牌清单冻结成文档；a11y 逐项可验 |
| **M2 外壳与骨架** | 路由注册表、七态框架、能力门控导航、上下文与 revision、停靠区（上下文/Agent 互斥双面板）、复合骨架与 Agent 骨架的预设方案 | 空壳可跑通七态与权限三态；骨架扩展方案成文 |
| **M3 审阅控制台** | 页面总览台、状态矩阵、角色切换（镜像 `policy.ts`）、缺口台账面板、URL 寻址、视口与安全区预设 | 57 页未铺完时即可用；任一页面可在任一状态×任一角色下直达 |
| **M4 页面铺量** | 57 页，按域分 11 批推进；每页交付：布局、七态、能力门控、版本引用、证据入口、跳转矩阵落点；缺口台账同步闭合 | 57 页全部可点击可达；每页可标注骨架与数据来源 branch；`GAP-*` 均有依据、预设、待确认方 |
| **M5 截图、对照与部署移交** | 5 张汇报图从 v2 派生（第 4、5 张走组合视图）；v1 对照深链；`dist/` 交付；可选 `Dockerfile`；设计规格文档更新；移交说明 | 截图可重复产出且不含内部信息；一条命令可部署启动；文档齐备，C32–C35 开工可直接引用 |

**v2 的终点就在 M5**：57 页可点击、七态与五角色可在控制台逐格审阅、缺口台账闭合、5 张汇报图可派生、`npm run review` 一条命令可部署启动、设计规格齐备。到这一步停手，不进入生产迁移。

---

## 11. 自检要点

每次改动后按此清单核对，避免原型悄悄长成第二套生产基线。

1. `git status` 中**没有** `apps/`、`packages/`、`openspec/`、`config/`、根配置文件的改动。
2. `demo/` 顶层文件**零改动**（v1 冻结）。
3. 根 `pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm deps:check` 结果与基线一致。
4. `demo/v2/` 下不存在 `.test.` 或 `.spec.` 命名的文件（否则会被根 vitest 扫到）。
5. `src/` 的依赖清单中**没有** router / 状态库 / UI 库 / 图表库 / CSS 框架；审阅设施依赖只出现在 `tools/`。
6. 页面文案中 grep 不到 `identificationGraph`、`assessmentGraph`、`riskFlowGraph` 等实现名，也 grep 不到 TODO / Mock / 占位 / 兼容性说明。
7. 关闭设计说明覆盖层后，页面与截图中不出现任何 `GAP-*` 或内部说明。
8. 强制状态与角色注入只在框架层实现，页面组件内无相关分支。
9. 角色能力集由 `policy.ts` 的策略镜像推导，不是手写常量；`system-administrator` 呈现为空能力集而非全量。
10. 风险矩阵与等级**不来自硬编码**，全部由数据驱动。
11. 每页都能回答：属于哪个骨架、数据来自哪个 branch、需要哪个能力位、七态如何表现。
12. 键盘可完整走通主要流程；`prefers-reduced-motion` 下动画关闭。
13. 截图管线可重复执行，不依赖手工准备浏览器状态；产物中不含 `#/__review`。

---

## 12. 待决与风险

**待决（不阻塞开工）**
- 是否允许 `demo/v2/` 执行 `npm install`（§5.8）。若不授权，则走零新增依赖路线，截图用系统 `google-chrome`。
- 是否需要 `Dockerfile`（异机部署），或先只交付 `dist/` 与本机启动脚本。
- 审阅 Harness 的默认监听：`0.0.0.0:5320` 还是 `127.0.0.1` + SSH 隧道。
- 暗色模式是否需要实现，或只做令牌结构。
- 5 张汇报图的产出时机：M5 统一做，还是随页面分批做。

**风险**
- **范围风险**：57 页是规格全量，工作量远大于 v1 的 25 页。若中途收缩，优先保 C32/C34 两组（它们对应的已归档规格最多，契约依据最实）。
- **Harness 膨胀**：审阅设施最容易长成第二套应用，把设计产物淹掉。缓解手段是 §5.4 的框架层注入约束与 §11 的自检项 5、8。
- **预设被推翻**：G1/G3 的预设若与将来 C32–C35 的 design 冲突，改动面大。缓解手段是让预设集中在骨架与状态层，页面内容层尽量少发明。
- **权威性漂移**：v2 的产物是设计输入，不是规格。若被后续 change 直接引用为契约依据，会重演 `.scratch/` 草稿被误当事实源的问题。移交说明必须写明这一点。
- **依赖回潮**：设计过程中很容易为了省事引入 `react-router-dom` 或图表库。「生产可移植子集」是这次工作的核心约束，破了它，v2 相对 v1 的增量就只剩下页面数量。
- **端口冲突**：v1 预览占 5319，v2 harness 占 5320；同时启动时不冲突，但需在脚本中显式 `--strictPort` 以免静默漂移。
