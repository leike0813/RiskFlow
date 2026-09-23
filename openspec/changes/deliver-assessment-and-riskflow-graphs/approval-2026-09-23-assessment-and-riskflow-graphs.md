# C30 规划范围批准记录（2026-09-23）

- 批准引用：`approval://riskflow/C30/scope-2026-09-23-assessment-and-riskflow-graphs`
- 批准来源：协调端在本次受控调度会话中的裁决（依据路线图节点定义与已归档主规格中对 C30 的既有分配）。
- 触发证据：`C30` 规划尝试 `task_0f3e18518a83` / `task_87bcfde02f2e` 因新工作区信任与控制器阶段推导误派为 Finalizer 而未能进入规划；两次误派会话均未写入任何文件（工作树除 `openspec/changes/deliver-assessment-and-riskflow-graphs/.openspec.yaml` 外无改动），`task_1c00d2cea259` 已失败。本次重开规划用于在**强制 Planning 角色**下补齐本 change 的规划工件。

## 触发事实

- 路线图只给出本 change 名称 `deliver-assessment-and-riskflow-graphs`（lane `assessment`，依赖 C03/C07/C24/C25/C26/C27/C28/C29，均已归档）与依赖节点；change 目录初始为空，`orchestrated-delivery` 的 applyRequires 五项均缺失。
- 已归档主规格对本 change 的既有分配：
  - C24 design D-01：C30 通过父运行调用识别子图入口（`IdentificationGraphRuntimeV1` 的 `start`/`resume`/`cancel`，复用 `WorkflowPortV1` 语义，不新增公共契约）。
  - C14 design：「C30/C36 需要页面查询时使用其 own projection change 消费领域事实」——C30 的页面/追踪查询使用自有投影，消费领域公开接口，不直读其它模块私表。
  - C25/C26/C27/C28/C29 已归档的评估、预警、处置、偏差与校准闭环：C30 负责把它们与识别子图组合为端到端评估编排（含父运行与子图身份、暂停/恢复、失败与终态收口），不复制领域算法。
- C30 的前置：`G2` 门禁与 C24～C29 的评估侧链路均已通过；识别侧 C00～C23 已归档。

## 本次规划必须闭合的范围

1. **评估编排图（`assessmentGraph`）**：以唯一 LangGraph 图组合已归档公开接口（C18 指标/量化标准、C19 适用规则集、C25 确定性评估、C26 预警任务与通知、C27 处置建议、C28 执行预测/反馈/偏差、C29 校准建议与治理回路），并把识别子图作为父运行下的子运行调用；固定输入版本、暂停/恢复、幂等重试与人工决定边界，不把 P/C、矩阵映射或预警判定下沉为 Agent 决策。
2. **C30 自有页面/追踪投影**：按 C14 的边界消费公开接口与领域事实，不直读其它模块私表、不复制领域事实正文；公共契约、持久化与迁移决定由本 change 的 proposal/design 作出并写入相应工件（含最小授权与只追加语义）。
3. **端到端链路与追溯**：从资料段标识 → 工序节点 → 机理条目 → 标准化风险记录 → 评估记录 → 预警 → 处置建议 → 偏差/校准的可核验追溯，须由可重现命令与耐久证据（工件引用 + 审计）支撑。
4. **边界**：不改 C24～C29 与 C10/C14 的既有语义与公共契约；不实现 C31～C38 的范围；新增 capability、角色或权限值，引入生产运行时依赖，或需要跨 change 公共契约语义变化时 MUST 先 escalation。`packages/contracts` 的既有 Schema 只在必要且最小加法时改动，并在 design 中说明理由与兼容边界。

## 处置要求

规划者 MUST 先读取本记录并以其为批准输入；按 `orchestrated-delivery` 的 applyRequires 依次创建 proposal、specs、design、implementation-plan、tasks，把上述范围逐项映射为场景、IP-ID、允许文件清单与可运行验证命令。若认定任一项无法在本 change 已批准语义内闭合，或需要收窄范围，MUST 在规划工件中显式说明取舍与后果并升级，不得静默缩小范围。本记录是批准凭据，不是设计结论；设计结论仍写入 `design.md`。
