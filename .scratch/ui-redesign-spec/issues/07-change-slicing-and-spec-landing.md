# 规格定稿形态与 OpenSpec change 切分

Type: grilling
Status: resolved
Blocked by: 05, 06

## Question

本 effort 的终点是规格本身。规格要写成什么样、后续按什么顺序切分成 OpenSpec change，需要在最后定下来。

**确定规格文档的形态（章节结构、验收口径、与既有 prototypes 文档的存废关系），以及把它切分成若干个可独立施工、独立验收的 change** —— 需要定下来。

具体要回答：

1. 规格文档写在哪？建议 `.scratch/riskflow-master-plan/prototypes/` 下与既有文档同处，还是另立位置？章节结构如何组织（目的地结论、设计系统三层、映射表、原型结论、后端变更、验收口径）？
2. 既有 UI 文档哪些被取代、哪些继续有效、哪些标为 drift？
   - `full-product-ui-spec.md`（307 行，七项导航 / 五类骨架 / 七态 / 57 页清单 / 角色×界面矩阵 / 20 条验收要点）
   - `product-information-architecture.md`（原始八项导航 IA 决议）
   - `report-screenshot-design.md`（468 行，五张汇报图逐屏像素级规格）
   - `prototype-v2-guiding-plan.md`、`prototype-v2-handoff-m3.md`
3. 切几个 change？切分依据是什么（按设计系统 / 按业务域 / 按页面批次）？每个 change 的边界、依赖顺序、以及各自的验收证据要求。
4. 每个 change 对 `openspec/specs/web/*` 的影响：哪些 capability 需要新增 spec、哪些需要 delta、哪些现有条款与新规格冲突需先修 drift？
5. 时间线约束：这套 change 要不要赶在 C37/C38 私有化部署功能验收之前落地？若是，哪些必须前置？
6. 规格的完成判据是什么 —— 满足哪些条件就认为"地图到达目的地"，可以停止？

产出是规格定稿计划 + change 切分表；本票不写规格正文，正文在规格定稿时按此结构落盘。

## Answer

产出资产：[UI 重做规格 · 主文档](../../riskflow-master-plan/prototypes/ui-redesign-spec.md)。

**规格形态**：一份主文档、八份章节附件及 27 页一次性原型。附件为用语、页面映射、设计系统、GAP 重判、路由、后端清单、停靠区、演示叙事；主文档组织结论和实施责任，不复制附件正文。`CONTEXT.md` 已补三词。

**Capability 按行为所有权保持稳定**：保留现有四个 `web/*` capability，以 delta 更新其入口、详情与决定契约；导航变动不要求 capability 同名或整份 superseded。只为新增设计系统、仪表盘、搜索与聚合行为新增 `web/design-system`、`web/risk-overview-dashboard`、`web/search-and-dock`。

**横切规格不得遗漏**：CH-2 对 `platform/web-shell-interaction-primitives` 的七导航、单值骨架和旧停靠面板作 delta，保留权限、七态、统一确认及焦点边界；已有 `web/*` 的重复七导航条款改为引用 shell。复核与 Agent 行为仍由原 capability 拥有，不因进停靠区重新定义。

**并行边界**：多个工作包触及同一 spec 时按 Requirement 合并，由集成方检查覆盖与丢失；不能为了避免合并文件而重组领域能力。

**九个工作包与构建顺序**：CH-1 设计系统 → CH-2 公共壳层／导航／路由接缝与 B-6 → CH-3…CH-8 各业务域；CH-9 搜索与停靠区可在 CH-2 后并行开发，但最终六导航组合发布须等 CH-3…CH-8 的承载就绪。B-4 在 CH-7 复用现有四类正文、核对实际缺字段与精确实体解析，不新建四套记录 Schema。

**发布责任**：CH-2 不提前删除旧入口或发布指向未交付目标的六导航。各业务 change 在新承载的真实权限、正文、历史深链及原命令验收通过后，原子切换对应地址与调用方；CH-9 负责待办／助手及六导航组合启用，原复核入口保留到其替代面可用。旧地址长期精确解析，不保留重复旧页面实现。

**授权先于界面切换**：CH-2 一并闭合实际缺少的读面授予和 `review-todo.read`。该专用位仅控制聚合入口，不替代来源对象授权、不扩大 reviewer 的 Agent 权限。业务域验收必须覆盖有本域权而无其它域权的角色。

**依赖**：`antd` 在 CH-1 声明（`AGENTS.md` §5 要求版本、引入原因、移除条件；移除条件是「若施工期评估覆写成本超过自建则退回自建」）。

**时间线**：不绑定 C37/C38。**核实 C38 已于 2026-10-18 归档，结论 PASS，明确排除 F-01–F-05**（目标 GPU、禁网跨 VM、多平台安装、合同最终交付）。九个 change 按自身节奏推进。

**既有文档逐份标状态**（不删文件）：`full-product-ui-spec.md` 与 `product-information-architecture.md` 被取代；`report-screenshot-design.md` 降级为截图派生文档；`desktop-client-architecture.md` 保留；`agent-native-operating-contract.md` §14 保留（停靠区扩为双页签后需 delta）；`prototype-v2-*` 与 `demo/v2/**` 仅参考；`screenshot-content-inventory.md` 保留。

**原型采纳边界**：不采纳自绘标题栏拖拽区和 CSS 窗口最小尺寸令牌；左导航 152px／48px、右停靠区 22rem 和桌面缩放用例以设计系统为准。旧地址解析不再绑定 C38 期限，按票 09 长期保留领域身份与版本。

**完成判据分层**：本轮只交付决议与 planning 输入，不宣称九个 change 可直接 apply。后续各 change 必须按项目 workflow 补齐固定基线、文件／符号清单、Requirement／Scenario／IP-ID、依赖和真实验证命令并满足 `applyRequires`；最终发布另须通过新旧入口原子切换与 CH-9 组合验收。原型非空、静态文档齐备或编译成功不等于功能完工。

**CH-4 实施落点**：[redesign-engineering-workspace](../../../openspec/changes/redesign-engineering-workspace/proposal.md)。工程承载与四条专用 HTTP 接缝按 IP-01～IP-07 实施；验收修复闭合权限交集、精确引用、读改版本、完整续页、历史只读、空间和资料访问维护、独立故障及接入深链。工程开通与访问维护复用原命令和事务，接入仅组合所属窄读，不扩展上传/解析启动，不提前启用六导航。实际行为、HTTPS Cookie 与原生缩放证据及未覆盖范围见 [verification](../../../openspec/changes/redesign-engineering-workspace/verification.md)。

**CH-5 实施落点**：[redesign-identification-workspace](../../../openspec/changes/redesign-identification-workspace/proposal.md)。固定基线 `603a192a4ac0aabeeefe5f03a62032a0f5c53819`，使用 `orchestrated-delivery`；IP-01～IP-06 已按六条识别规范地址、真实续页、精确详情、风险详情内追溯、两个旧 trace 永久解析、图谱去重复及只读模型实施。运行精确状态快照与无版本实时监控分开；两条详情分支补互斥实体身份选择，HTTP/部署自动消费公共Schema，未新增 HTTP 路由/端口/权限/依赖/迁移；未新增识别启动或原型缺失读面的工程使用关系，未提前启用 CH-9。行为、浏览器与原生缩放证据及未覆盖范围由该 change 的 verification 承担。
