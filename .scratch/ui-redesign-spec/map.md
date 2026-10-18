# UI 重做：设计与实施规格

## Destination

产出一份 **RiskFlow UI 重做规格**：以 `demo/v2` 设计系统为基线收敛到 `apps/web`，把界面从"对话技术对象（runId、快照 ID、发布集合、复核任务 ID）"重组为"对话工程业务对象（标准化风险记录、风险评估记录、预警处置任务、处置建议与反馈闭环）"，覆盖设计系统三层（令牌 / 基础组件 / 布局骨架）、业务对象到页面的完整映射、以及因 UI 需要的后端变更清单。规格作为 planning 事实源落盘，后续按它切分并开 OpenSpec change 施工到 `openspec/specs`。

本 effort 终点是规格本身，不写生产代码。

## Notes

**领域**：RiskFlow（变径盾构站隧一体化建造风险智能识别与评估系统）。UI 归 `apps/web` 唯一所有，`apps/desktop` 是 Electron 薄壳、不承载业务界面。

**每个 session 必读的 skill**：`grilling`、`domain-modeling`、`prototype`。

**术语权威**：`CONTEXT.md`。界面用语沿用既有术语，不新增词汇；确需新词时才改 `CONTEXT.md`，且只能是界面侧的领域语言而非实现术语。

**服务对象**（双主线，按此权衡信息密度与交互优先级）：
1. 工程风险管理员日常办公 —— 主路径，高频、信息密集，"找得准、动得快"为先。
2. 给甲方演示 / 验收 —— 叙事完整、可讲解、视觉冲击优先，直接服务 C37/C38 验收节点。

**硬约束**：
- 必须遵循 OpenSpec 流程；本地图产出的是 planning 事实源，change 另开。
- 规格允许并要求显式标出需要的后端变更（查询投影/接口），由后续 change 各自施工，本 effort 不施工。

**现状事实（前期勘察记录，源码位置和数量可能随实现变化）**：
- 生产 UI 仅 `apps/web`，现有 React／Vite／react-router／echarts 等技术栈不因本轮文档修正变化；路由规范承载与永久解析入口以票 02 的逐条清单为准，不以页面约数作为验收断言。
- 三套血缘并存：`theme/tokens.css`（30 变量，注释标明抄自 `report-screenshot-design.md §3`）× `shell/AppShell.css`（C10 老样式 `system-ui` + `#17202a/#f7f9fb` + 硬编码三列网格）× 约 30 个页面级 CSS 各写各的。`components/AppShell.tsx` 是空壳别名历史包袱。
- `demo/v2` 已有**未进生产**的完整设计系统：间距 `--space-1..7`、字号行高配对、`--radius-*`、`--dur-*`/`--ease-standard`、`--z-*`、断点 `--bp-shell 64rem`、暗色结构、焦点环。另有 57 页可点击原型与 54 条 GAP 台账（G1 外壳契约 / G2 契约字段 / G3 未建能力 / G4 归属待定 / G5 依赖决策 / G6 规格空白）。
- `demo/`（v1）已冻结为零件目录，在生产依赖图之外。
- 既有设计意图文档：`.scratch/riskflow-master-plan/prototypes/` 下 `full-product-ui-spec.md`（307 行，含七项导航、五类骨架 A–E、七态视图、证据抽屉、Agent 停靠栏、57 页清单、角色×界面矩阵、20 条验收要点）、`product-information-architecture.md`、`report-screenshot-design.md`、`prototype-v2-guiding-plan.md`、`prototype-v2-handoff-m3.md`。
- 视觉语义硬约束：工程蓝 `#2166d1` 为唯一强调色；风险四级色只表达等级/越限/预警，且必须带文字标签，不得退化为装饰色。
- `apps/web` 无 dev 脚本，本地看页面只能 `vite build` 或跑 `test/browser/server.mjs`。

## Decisions so far

<!-- 一行一条已结票：结论摘要 + 链接。详情在票内。 -->

- [界面术语与甲方用语对照](issues/01-ui-vocabulary-mapping.md)：沿用领域术语、操作动词与证据来源三层用语，技术 ID 降为详情辅助。普通业务页面不额外标合成状态；质量页面、试运行报告、验收记录及其导出或截图证据必须保留“合成样本，待甲方复核”、来源与候选资格。产出 [界面用语对照表](../riskflow-master-plan/prototypes/ui-vocabulary-mapping.md)。
- [业务对象与页面映射](issues/02-business-object-to-page-mapping.md)：保留六项导航与辅助搜索、停靠区、用户菜单；区分视觉合并、规范承载和永久地址解析。处置子记录及复核详情的精确身份不随菜单合并丢失，路由去留按逐条表核对。产出 [页面映射表](../riskflow-master-plan/prototypes/business-object-page-mapping.md)。
- [路由与深链契约](issues/09-route-redirect-contract.md)：旧地址长期精确解析，不再绑定 C38 自动移除，不保留两套业务页面。处置任务 `version` 与子记录 `recordVersion` 分离，所选记录直接精确读取；复核覆盖层保留 URL、刷新与历史读取。重叠模板按首个不同段的静态优先行为处理，不固化三键排序。产出 [路由契约](../riskflow-master-plan/prototypes/route-redirect-contract.md)。
- [GAP 台账重判](issues/03-gap-ledger-adjudication.md)：历史台账不是当前 backlog；已核、历史自报与待核分开，不再承诺抽样推断的解决率。四类处置读面已有正文，量化标准有精确版本引用但无独立治理类型，导航授权须按生产逐项核对。图表路线已定为 echarts。产出 [GAP 重判表](../riskflow-master-plan/prototypes/gap-ledger-adjudication.md)。
- [设计系统三层](issues/04-design-system-three-layers.md)：v2 仅提供初始值，CH-1 迁入生产令牌作为唯一运行值源；保留 AntD 引入方向。风险徽章与图表共用受控等级配色，操作错误使用独立令牌。左导航 152px／48px、右停靠区 22rem，可收起；不继承 64rem 自动换列，补 100%／200% 桌面缩放验收。产出 [设计系统规范](../riskflow-master-plan/prototypes/design-system-spec.md)。
- [高保真原型](issues/05-main-path-high-fidelity-prototype.md)：27 页的一次性原型方向已确认：纵向叙事、紧凑高密度、弱卡片、克制中性色、键盘可达与助手在场。fixture 不作为权限、记录契约、生产接线或业务终态证明，生产尺寸和交互边界以规格附件为准。
- [后端变更清单](issues/06-backend-change-request-list.md)：B-1 仪表盘聚合、B-2 待办、B-3 搜索按服务端授权有界提供；B-4 复用既有正文，仅补实际缺字段和子记录到预警处置任务的精确关联；B-5 闭合任务状态机；B-6 只修实际授权链缺口并增加聚合入口；B-7 按实际审计查询需求扩展。不重复新建记录 Schema，不将未返回聚合字段误说成底层未采集。产出 [后端清单](../riskflow-master-plan/prototypes/backend-change-request-list.md)。
- [规格与工作包切分](issues/07-change-slicing-and-spec-landing.md)：保留九个工作包，不按导航重划旧 capability。既有四个 web 与 platform shell 作 delta，仅新增设计系统、仪表盘、搜索与聚合规格。CH-2 不提前撤旧入口；各业务 change 验收后原子切换，CH-9 在目标承载就绪后组合启用六导航与停靠区。本地图是 planning 输入，不是 apply 就绪证明。产出 [规格主文档](../riskflow-master-plan/prototypes/ui-redesign-spec.md)。
- [待办与助手工作](issues/10-dock-todo-and-agent-contract.md)：四来源、两分组；`review-todo.read` 只控制入口，各来源按原权逐项裁剪。Agent 关联可选且单独授权，reviewer 无 Agent 权仍能复核；风险等级可选，排序稳定。校准逐项查看校验，人工整体批准生成草案／拒绝／退回，不支持部分接受。页签独立门控，复核覆盖层保留精确 URL。产出 [停靠区契约](../riskflow-master-plan/prototypes/dock-todo-and-agent-contract.md)。
- [演示与验收叙事](issues/08-demo-acceptance-narrative.md)：六站沿同一精确追溯链，评估同页解释可滚动展开。来源清单仅是候选，指标须核对实际来源、版本、定位及适用性；误引规范不能靠换号或隐藏来源修复。演示文案不豁免质量与验收材料的合成标注。产出 [演示验收叙事](../riskflow-master-plan/prototypes/demo-acceptance-narrative.md)。

## Not yet specified

- **后续闭合位置**：产品决议与工程就绪分开。甲方信息组织／术语反馈随 CH-3／CH-7／CH-9 主路径验收统一回灌；不加独立用词审批关口。各 change 仍须在自身 planning 中固定代码基线、字段映射、文件／符号清单、IP-ID 与真实验证命令并满足 `applyRequires`，本轮不代写或声称已完成施工图。

## 已由已结票解答（不再留在雾区）

- **桌面端取舍**：维持桌面信息结构与 Electron 薄壳，左栏 152px／48px、右停靠区 22rem；桌面缩放允许手动收起两侧、正文折行和二维区局部滚动。原生菜单、托盘、自绘标题栏不在本轮范围；页面内键盘交互保留，不扩为移动端适配。

## 风险登记

- **普通业务页面不额外标合成状态**：来源误解风险仍在；质量页面、试运行报告、验收记录及其导出或截图证据必须保留合成来源与待复核资格。开场说明不替代材料标注，不把技术路径证明当最终业务验收。
- **永久地址解析成本**：旧地址保留精确身份与授权解析，不随 C38 结束自动失效；不保留重复页面实现。不能解析或无权时同形拒绝，不泄露其它工程或关系状态。
- **原型与生产边界**：不采纳自绘标题栏拖拽区、CSS 窗口下限及旧自动换列规则；新视觉方案仍须在真实角色、精确历史记录、正式命令和桌面缩放下验收。

## Out of scope

<!-- 越出目的地的工作：已排除，永不毕业。 -->

- **施工与实现**：按规格开 OpenSpec change、写生产代码、迁移现有 49 条路由。本 effort 到规格为止。
- **后端查询投影与接口的实际改动**：规格只显式标出"因 UI 需要的后端变更"，不改代码。
- **移动端适配**：`AGENTS.md` §4.6 已规定移动端能力须另行明确适配与验收范围，不在本 UI 重做 effort 内。
- **demo/v1（`demo/`）的复用**：已冻结为零件目录且在生产依赖图之外，不作为本次基线；如后续需要零件，按需单独取用。
- **矩阵形态变更与由此产生的重新验收**：矩阵是版本化配置数据，当前合成包为 3×2 × 4 级、等级只有 `levelId`/`ordinal` 无名称，真实 5×5 到位后会变。`AGENTS.md` §4.3 已规定新版本不得原地覆盖历史版本、每条评估记录固定引用所用矩阵版本；`synthetic-functional-preacceptance/spec.md:35` 已规定"代码、包、配置变化须创建新运行"；`process-model-mechanism-and-evidence-governance/spec.md:95` 与 `governed-definition-lifecycle/spec.md:126` 已保证历史运行仍按原版本重放。这套机制属于配置治理，不是 UI 议题——**UI 只需不硬编码档位**（见票 04）。矩阵换形态引发的重新取证由配置治理流程承担，不在本 effort 内。
