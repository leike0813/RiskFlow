# Verification

## 验收对象

- Change：`deliver-assessment-and-riskflow-graphs`；实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`1ee42ebbf15968f7bb36df030937fae8afa5c7f6`
- 当前最终产物 HEAD：`1ee42ebbf15968f7bb36df030937fae8afa5c7f6`；本次只更新验收记录，待协调端审阅并形成文档检查点
- 验收 Agent：C30 Finalizer，`task_2d0b377d10f5`；前次验收证据见下文，当前 HEAD 已包含其产物

## 结论

**BLOCKED。** 按 `approval://riskflow/C30/finalization-2026-09-23-narrow-scope-and-archive`，已成立的评估、父运行分段、持久化投影、依据缺失前置门禁和缺席链尾保留；下列场景已转由 C40/C41 承接，不能记为本次通过：

`openspec instructions apply --json` 当前显示 13 项中 8 项完成、5 项未完成；`openspec status` 的工件 `done` 只表示文件存在，不代表实现验收通过。

1. **R1/S5、R3/S4、IP-06（task 3.1）**：预测入口仍缺已成立的采纳路由 `route-decision`、基线 `assessment-input-snapshot`、精确 `spatial-scope`；反馈入口仍缺用于偏差的 `assessment-input-snapshot`。现有公共 C25 `prepare` 只返回本次准备的快照引用，C28 内部能读取建议链基线，但 C30 公共读端口不向合法调用者提供这条绑定；现有 C30 投影只返回运行摘要/链边，不能证明所给快照属于该建议或反馈。因此前次收尾未添加缺乏逐字段可运行可达性证据的可选字段。只携带 `assessmentBasisReleaseSetRef` 时，门禁会接受载荷，但子图 A0/A2 仍因其余引用缺失而停住；“任一必填引用缺失均在父运行副作用前拒绝”的要求未满足。
2. **C28 人工决定/反馈命令路径**：`forecast-response` 没有人工 `adopt-recommendation` 命令的 `decision`、`reasonCode` 和 `VerifiedResponseWorkflowBinding`，无法由 C30 调用 `recordDecision`；`record-response-feedback` 已要求 `feedbackRef` 作为输入，却缺 `recordFeedback` 所需的 `postActionMonitoringSnapshotRef`、`feedbackArtifactRef`、`occurredAt`、`feedbackInputSnapshot` 与 `actualAssessmentRecordRef`。批准记录已明确本项由 C41 承接，C30 不改 C28 契约或扩权。
3. **R2/S1、R4/S1、R6/S1、IP-03/09（tasks 2.3、2.4、4.1）**：现有 C30 验收文件仍注入会抛错的 C24 替身，不能证明真实 C24→C30 同容器路径。前次收尾在同一真实 PostgreSQL 容器内装配真实 C24、C30 父图与评估图，配置两条自动验收风险和一条待复核风险，目标测试连续失败：C24 待复核 `GraphInterrupt` 冒泡到父图，使父图检查点显示运行中而业务登记仍等待；用原幂等身份回读 C24 随即报 `CONTRACT_INVALID:graph-state-invalid`。C30 侧捕获后重试仍失败，故已撤回不安全的实验性修复和临时测试。C24 运行时/图间检查点边界由 C40 承接；未把独立通过的 C24/C30 测试当成同容器证据。
4. **IP-10（task 4.2）**：工程命令通过，但完整链的冻结版本、事件与逐跳工件/审计引用仍缺真实 C24 与正式反馈路径的证据。因行为与证据未同时满足，task 4.2 保持未完成。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| R1/S1 历史完整输入；IP-01/05 | 评估图 4 文件回归命令（下列 C）；`apps/worker/test/assessment/runtime.test.ts` | 通过，冻结历史输入；甲方输入仍为合成样本、待甲方复核 |
| R1/S2 单/多序列；IP-01/05 | 契约/核心命令 A、评估图命令 C | 通过，单项兼容及多项逐序列冻结 |
| R1/S3 缺失/错配；IP-01/05/10 | 命令 A、C | 通过已覆盖的修订/监测错配安全拒绝 |
| R1/S4 多空间配对；IP-01/03/05 | 命令 C 的 `risk-flow/runtime.test.ts` | 通过，逐空间配对；该切片使用可控 C24 端口 |
| R1/S5 分段依据；IP-01/02/06 | 命令 A、B；真实 PG 测试证实缺依据时零父运行行 | **部分通过**：依据引用可解析、冻结，缺依据前置拒绝；其余必填引用可达性及全量前置门禁 BLOCKED |
| R2/S1 多已验收风险；IP-02/03/09 | 命令 C 的受控端口切片；同容器尝试命令 F | **BLOCKED**：真实 C24 待复核中断越过父图边界，不能据替身测试声称多风险真实扇出 |
| R2/S2 无合格风险；IP-02/03 | 命令 C 的 `risk-flow/runtime.test.ts` | 通过，不建立空评估 |
| R3/S1 无预警；IP-05/09 | 命令 C 的 `assessment/runtime.test.ts`；命令 B | 通过，无预警终态和零建议 |
| R3/S2 预警处置；IP-05/06/09 | 命令 B、C | 通过已成立评估后的分段预警、候选和三项校验；不等于全链 |
| R3/S3 重评/补算；IP-01/05/09 | 命令 C | 通过，旧结论未被覆盖 |
| R3/S4 反馈越限；IP-06/09 | 命令 B 的内部分段尾链 | **部分通过**：已成立反馈引用能形成偏差及待审校准；执行后 C25→正式 C28 反馈的公共路径 BLOCKED |
| R4/S1 等待恢复；IP-02/03/04/10 | 命令 C 的 `risk-flow/runtime.test.ts` | 通过受控端口等待/恢复；真实 C24 同容器待复核路径 BLOCKED |
| R4/S2 检查点不一致；IP-02/03/04/10 | 命令 C、D | 通过现有伪引用/业务领先拒绝；命令 F 暴露新的真实跨图中断不一致 |
| R4/S3 取消/技术失败；IP-02/03/04 | 命令 C、D | 通过已覆盖的取消、审计保留与失败收口 |
| R5/S1 授权历史视图；IP-04/07/08/09 | 命令 D | 通过，真实 PG 自有投影与当前授权复验 |
| R5/S2 越权不可枚举；IP-07/08/10 | 命令 D | 通过，撤权/跨工程安全失败 |
| R5/S3 有界只读结果；IP-01/07/08/10 | 命令 A、D | 通过，分页、游标与来源上限 |
| R6/S1 全链耐久证据；IP-03/04/05/06/07/08/09 | 命令 B、F | **BLOCKED**：B 为真实 PG 中的 C30 分段与 C22 记录，C24 用替身；F 的真实同容器路径失败，且正式 C28 反馈接线缺失 |
| R6/S2 无触发/失败缺席链尾；IP-05/06/08/09 | 命令 B、C | 通过已覆盖的无预警、三项拒绝、偏差不可计算与 Agent 失败的类型化缺席 |
| 工程门禁；IP-10 | 命令 E、G、H、I、J | 均通过；不抵消上述语义与证据缺口 |

本次 Finalizer 在输入 HEAD `1ee42ebbf15968f7bb36df030937fae8afa5c7f6` 上实跑：

- **H** `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/workflow/service.test.ts apps/worker/test/identification/graph/runtime.test.ts apps/worker/test/risk-flow/acceptance.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/assessment/composition.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`：12 文件、160/160 通过（450.17 秒）；真实 PostgreSQL 切片通过，`acceptance.test.ts` 仍未装配真实 C24，同容器全链不在此结论内。
- **I** `pnpm typecheck && pnpm lint && pnpm deps:check && pnpm deps:policy && pnpm build && pnpm format:check && pnpm openspec:validate`：全部退出码 0；依赖检查 421 模块、1214 条依赖零违规；OpenSpec 33 项通过、零失败。
- **J** `openspec validate deliver-assessment-and-riskflow-graphs --strict --no-interactive`：通过；`openspec instructions apply --change deliver-assessment-and-riskflow-graphs --json` 显示 8/13 任务完成，`openspec status --change deliver-assessment-and-riskflow-graphs --json` 显示实际 schema 为 `orchestrated-delivery`。

前次 Finalizer 留存的实跑命令与诊断证据（产物已进入当前 HEAD）：

- **A** `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/workflow/service.test.ts`：2 文件，34/34 通过。
- **B** `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts apps/worker/test/risk-flow/acceptance.test.ts`：2 文件，37/37 通过；二者为独立夹具，C30 文件的 C24 端口仍是替身。
- **C** `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts apps/worker/test/assessment/composition.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts`：4 文件，45/45 通过。
- **D** `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`：4 文件，44/44 通过。
- **E** `pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm format:check`、`pnpm openspec:validate`、`openspec validate deliver-assessment-and-riskflow-graphs --strict --no-interactive`：全部通过；`pnpm build` 通过。
- **F（未通过，诊断尝试）** `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts -t '真实 C24 与 C30 同容器'`：在只改允许的验收测试文件后执行，同一容器真实装配时未得到两条评估子运行。诊断中 C24 `GraphInterrupt` 冒泡；C30 侧原身份重试得到 C24 `CONTRACT_INVALID:graph-state-invalid`。实验性测试与 C30 捕获代码已撤回，当前文件仍只含可通过的独立分段场景。
- **G** `openspec instructions apply --change deliver-assessment-and-riskflow-graphs --json`、`openspec instructions verification --change deliver-assessment-and-riskflow-graphs --json`、`openspec status --change deliver-assessment-and-riskflow-graphs --json`：确认实际 schema 与工件；本次重校验后按实时状态为准。

前次收尾将 `tasks.md` 的 2.3、2.4、4.1、4.2 保留为未完成，相关依据字段、门禁、测试与 change 文档均已进入当前 HEAD。本次未修改生产代码、测试、依赖、迁移、权限或 C24/C28 写路径。

## 限定审计

本次只更新验收记录，未修改权限、事务、关键状态机或语义合并；按 `approval://riskflow/C30/finalization-2026-09-23-nested-graph-interrupt`，本轮不执行限定审计。若协调端仍触发本轮唯一限定审计，审计者须在此节补入范围、结论与实跑证据；当前无审计通过结论。

## 后续注意事项

无。上述缺口均是已批准的后续交付项：C24 图间中断由 C40 承接，C28 人工决定与反馈命令由 C41 承接。
