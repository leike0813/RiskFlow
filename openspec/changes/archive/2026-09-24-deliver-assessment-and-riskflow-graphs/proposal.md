## Why

识别子图与评估、预警、处置、反馈和校准领域能力已分别交付，但尚无受控父运行把它们组成可暂停、恢复和审计的完整链路。C30 在固定基线 `f8920b4254a4d638356678d5a6a82d801a86d6af` 上交付该应用编排及其自有运行/追踪投影。

## What Changes

- 以唯一 LangGraph `assessmentGraph` 编排 A0～A9 及独立预测、反馈入口；`riskFlowGraph` 通过 C24 `IdentificationGraphRuntimeV1` 调用识别子图，并按验收结果启动独立评估子运行。
- 为父子运行保存只追加身份、状态、路由、阶段、审计和检查点关联；冻结输入版本，按原身份处理等待、恢复、重试、取消与人工决定。
- 建立 C30 自有的有界运行页面与端到端追踪投影，只消费各领域公开接口和已成立的事实引用，不复制领域正文或读取其它模块私表。
- 为 `start-run` 的评估/历史补算入口补齐冻结所需的工程修订、监测集合与历史适用性精确引用；增加独立的最小只读结果接缝，保持既有分支、能力与角色语义。
- 以可重现命令和耐久证据核验资料段至偏差/校准的链路；只编排 C18/C19/C25～C29 已有逻辑，P/C、矩阵、预警和三项处置校验仍由确定性领域模块完成。

本轮按 `approval://riskflow/C30/finalization-2026-09-23-narrow-scope-and-archive` 收窄交付边界：真实 C24 同容器多风险扇出与全链验收交由 C40 `fix-c24-nested-graph-interrupt-checkpoint-boundary`；预测、反馈分段入口的成功路径及 C28 人工决定/正式反馈命令输入交由 C41 `wire-human-decision-and-feedback-commands`。C30 已成立的分段、失败与缺席链证据仍按精确场景记录；未闭合行为不作为本 change 的通过结论。

## Capabilities

### New Capabilities

无。不新增能力名、角色或权限值。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：落实已有有限工作流与只读投影契约的 C30 父子图、运行生命周期和跨阶段追踪场景。

## Impact

- 实现预计位于 `apps/worker` 的图/事件接线、`packages/core` 的运行事实与投影 Schema、`packages/adapters` 的 C30 自有只追加持久化与授权读取，以及 `packages/contracts` 的最小加法输入/只读端口；以实施计划的允许文件清单为准。
- 复用现有 `@langchain/langgraph`、C03 事务/审计/检查点、C04 工件、C06 授权、C07 追溯和 C24～C29 公开服务；不新增运行时依赖。
- 不改变 C24～C29 或 C10/C14 的领域语义，不实现 C31～C38 的图谱/报告功能。既有公共字段仍可解析；C30 运行时只在精确冻结引用齐全时接受正式运行。加法字段、只读端口及自有存储的细节在设计中固定。
