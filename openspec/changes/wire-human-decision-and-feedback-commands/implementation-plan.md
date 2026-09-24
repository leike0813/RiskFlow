# Implementation Plan

## 1. 实施基线与权威来源

原输入 HEAD `7601bc9808b01edb8c4014cbc4cd3484bee57787`，规划期间 C30 合入；本施工图固定代码基线 `ff3da69116e3c24f350ff3654ffb82f87cd0577e`，直接依赖 C28 与已合入 C30。事实优先级：本 change 的三份 delta spec、`design.md` D1–D7、`openspec/specs/domain/execution-forecast-feedback-and-deviation/spec.md`、`openspec/specs/domain/module-interfaces-events-workflows/spec.md`、`openspec/specs/risk-assessment/engine/spec.md`、C09/C06/C03 主规格和当前代码。规划研究输入限于 `references/风险识别与评估规划事实源摘要.md`；不从研究原件猜字段。目标为 RA-S7，并保留 C25 的 RA-S1/RA-S5 事实链。

**IP-0 实施前门：**对照上述固定 HEAD 和实施时 HEAD，核对 `WorkflowPortV1.startRun`、`resumeRun`、`StartWorkflowRunCommandV1Schema`、`createRiskFlowGraphRuntime`、`stageAssessment`、`PostgresWorkflowAdapterV1` 的实际符号、运行登记/路由行、等待及恢复语义；核对 C25 评估记录索引/正文列。已实查 C30 当前 `forecast-response` 直接进入子图且 A0 要求采纳决定引用，故必须在父图进入子图前增加真实等待门。只允许按 D2/D5 加法扩展；若真实等待运行和路由证明不可在此边界实现，升级，不自建第二套 C30 运行。检查：`git rev-parse HEAD`、`rg -n 'startRun|resumeRun|forecast-response|routeDecisionRef' packages/contracts/src/ports/index.ts apps/worker/src/risk-flow packages/adapters/src/workflow`、`pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts`。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-1 | `packages/contracts/src/ports/index.ts`：`WarningResponseRecordCommandV1Schema`、`WarningResponseRecordSuccessV1Schema`、`StartWorkflowRunCommandV1Schema`、`ResumeCauseV1Schema` | 增加 D1/D2/D3/D5 所述 strict 字段、分支及独立只读 port | 不复制风险记录、评估记录或授权字段 |
| IP-2 | `apps/worker/src/risk-flow/runtime.ts`：`createRiskFlowGraphRuntime`/`startRunPort`/`resumeRunPort`；`apps/worker/src/risk-flow/graph.ts`：`stageAssessment`；`packages/core/src/workflow/service.ts`：`evaluateWorkflowEntryGate`；`packages/adapters/src/workflow/postgres-workflow-adapter.ts`：运行登记与授权读 | 在 C30 父图入子图前加等待门、精确证明、采纳证明恢复 | 不由 C41 伪造运行或写 C30 内表 |
| IP-3 | `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`：`RiskAssessmentRecordRow`、`readInputSnapshot`、`#verifyCommand` | C25 所有者加精确评估只读证明 | 不用 C28 私有 `readAssessmentChain` 当公共事实源 |
| IP-4 | `packages/core/src/response-lifecycle/schema.ts`：`VerifiedResponseWorkflowBindingV1Schema`；`packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts`：`recordDecision` | C41 仅构造真实绑定、调用旧 C28 写端口 | 不改 C28 写法、旧迁移或拒绝时填假运行 |
| IP-5 | 同一 C28 适配器：`recordExecution`；`ResponseLifecycleContextReaderV1.readRecommendationContext` | 保留 C28 的人工执行与已发布措施校验 | 不把采纳当执行 |
| IP-6 | `packages/contracts/src/workflows/index.ts`：`ResponseFeedbackInputSnapshotV1Schema`；C28 `recordFeedback` | C41 冻结输入并提供精确 C25 评估引用，正式事务仍归 C28 | 不把预测/基线结果当实际评估 |
| IP-7 | `apps/api/src/http.ts`：`HTTP_ROUTE_CATALOG_V1`、`ApiPortsV1`、`invokeWarningRecord`；`apps/web/src/shared/confirmation.ts`：`CommandConfirmationPlanV1` | 原路由注入 C41，前端继续用 C10 确认身份与重试状态 | 不新增 HTTP 幂等缓存或客户端授权 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-0 | 1.1 | 全部前置 | 上述 C30/C25 代码、`git HEAD` | 记录合入后接缝与当前符号；确认命令可运行 | 不用旧 HEAD 推断新实现 |
| IP-1 | 1.2 | 命令接线；C30 证明/等待；C25 证明 | `packages/contracts/src/ports/index.ts` 和 `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 实现 D1/D2/D3/D5 的 optional selectors、`decline` 结果、等待/恢复闭合字段、三个精确只读 port DTO；验证 strict 拒绝客户端绑定/授权 | 原分支默认语义、能力枚举不变 |
| IP-2 | 2.1 | C30 真实绑定、等待 | `packages/core/src/workflow/service.ts`、`apps/worker/src/risk-flow/{runtime,graph,composition}.ts`、`apps/worker/test/risk-flow/{runtime,composition}.test.ts`、`packages/adapters/src/workflow/{postgres-workflow-adapter,index}.ts`、`packages/core/test/workflow/service.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 在 C30 父图准备阶段登记等待运行/预留路由，恢复前核对 D3 证明并追加精确采纳决定引用，然后沿原分段入口建子运行；同键重放；提供持久路由/运行只读证明 | 不改非等待入口、不由 C41 直接读图表 |
| IP-3 | 2.2 | C25 精确实际评估证明 | `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`、`packages/adapters/src/risk-assessment/engine/index.ts`、`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` | 从评估记录及冻结输入按精确键/授权投影 D5 最小证明，校验正文摘要/索引/所属运行 | 不重算、重写 C25 评估 |
| IP-4 | 3.1 | 采纳/拒绝与唯一终局 | 新 `packages/core/src/human-decision-feedback/{service,index}.ts`、新 `packages/adapters/src/human-decision-feedback/{postgres-human-decision-feedback-adapter,index}.ts`、新 `packages/adapters/src/postgres/migrations/warning-response/wire-human-decision-and-feedback-commands/000051_human_decision_feedback.ts`、新 `packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts` | C41 唯一索引、pending/adopted/declined、C03 审计、真实绑定冻结、C28 采纳调用、拒绝自有终局、D3 精确采纳证明 | 不改 C28 写方法；迁移编号实施时按 provider 实时序列核实，冲突升级 |
| IP-5 | 3.2 | 现场执行 | 上述 C41 service/adapter/test | 只从人工命令组装 C28 `recordExecution`，核对采纳终局或独立措施，返回精确执行引用 | 不自动执行、无假建议 |
| IP-6 | 4.1 | 正式反馈 | 上述 C41 service/adapter/migration/test；`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` | 创建 prepared 冻结快照，按 D4 验证 C14/C04/C25/C30 事实，C28 正式反馈后 commit 标志并启动精确反馈分段；原身份恢复 | 不写 C28 旧表、不产生部分正式反馈 |
| IP-7 | 4.2 | C09/C10/C06 接入 | `apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts`、`apps/web/test/confirmation.test.ts` | `ApiPortsV1.humanDecisionFeedback` 注入 C41 三分支端口；`invokeWarningRecord` 仅对这三分支转发，其余留原 `warningResponse`；原结果 Schema 自动覆盖新增分支；验证 C10 固定身份重试与直接 HTTP 服务端校验 | 不改 web 现有确认状态机；不在 API 读领域表 |
| IP-8 | 5.1 | 端到端证据 | 新 `packages/adapters/test/human-decision-feedback/command-chain.test.ts` | PostgreSQL fixture 跑真实 C30 等待→C28 决定→恢复、执行、实际评估、反馈；含失败和重试 | 测试不锁定文案或内部调用序 |

## 4. 调用与副作用顺序

1. C09 strict 解析 → C06 当前会话/工程/分支授权 → C10 确认后的原 `commandId` 与 `idempotencyKey` 到 C41；直接 HTTP 同样执行前两步。C41 在每次下游读写前复验授权。
2. **采纳**：C28 受权建议链与 C14 精确执行前监测 → C41 原键占用 pending 决定与审计 → C30 `startRun(waitForDecision: true)` → C30 精确只读证明 → 冻结 C28 binding → C28 `recordDecision` → C41 adopted 终局及审计 → C30 `resumeRun(human-decision-committed)`。每步仅能在前一步成功后继续；中断原键重放。C30 proof、C28 或终局失败不执行预测；resume 失败保留等待运行可恢复。
3. **拒绝**：精确建议与授权验证 → C41 唯一键提交 declined 与审计 → 返回仅有 `routeDecisionRef` 的结果；不调用 C30/C28 预测写入。
4. **执行**：C41 复验当前现场主体、唯一终局或精确措施发布 → C28 `recordExecution` 原有 C03 事务 → 返回执行引用。不触发自动预测或反馈。
5. **反馈**：C41 复验执行及 C14/C04 输入、C25 精确评估证明与 C30 已完成运行 → prepared 快照/摘要/审计 → C28 `recordFeedback` 自身原子正式提交 → C41 标记 committed → C30 以精确反馈引用启动反馈分段。同键同载荷重放返回相同结果；任何引用不符、越权、版本陈旧、同键异载荷在副作用前或保留已准备可恢复状态下失败，不写成功审计/正式事件。

## 5. Schema、状态与持久化落实

- SSOT：`packages/contracts/src/ports/index.ts` 原命令/结果及新证明；`packages/contracts/src/workflows/index.ts` 已有反馈快照；C28 的 `VerifiedResponseWorkflowBindingV1Schema` 和 `ResponseFeedbackCommandV1Schema` 原样消费。C41 不复制风险事件或评分字段。
- C41 新表 `business.human_response_decisions`：主键精确 route decision ref，唯一 `(project_id, recommendation_id, recommendation_version_id)`，保存命令键/规范 payload 摘要、状态、人工原因/actor、C28 决定/C30 运行/空间精确引用与审计；状态只允许 pending→adopted，declined 为独立终态。`business.human_feedback_input_snapshots`：精确 snapshot ref、工程+命令种类+幂等键唯一、输入摘要、严格快照 DTO、精确实际评估 ref、prepared/committed 与审计；不可原地改正文。迁移 `up/down` 只管理新表及约束，编号按实施时 provider 的实况确认。
- C30 仍拥有运行/路由表与状态；等待模式仅冻结真实引用，D3 采纳证明后才推进。C25 仍拥有正式评估/输入快照表；只读证明不写、不扫 latest。C28 自身写事务和 Outbox 不改。
- 错误按 D6 返回有限 `ModuleErrorV1`；权限/缺失同型不可枚举，损坏终止失败，瞬态保留原身份。日志只写引用和状态。无新运行时依赖、新 capability、旧表迁移或甲方硬编码矩阵。

## 6. 验收证据矩阵

下表“接线”指 `human-decision-and-feedback-command-wiring`；“工作流”指 `module-interfaces-events-workflows`；“评估”指 `risk-assessment/engine`。所有命令从仓库根目录运行；PostgreSQL fixture 使用现有容器方式，不提供生产 mock。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 接线/人工采纳后可启动预测分段 | IP-1,2,4,8 | `packages/adapters/test/human-decision-feedback/command-chain.test.ts` | 正式建议+已发布策略+C30 | 真实等待运行→C28 决定→恢复；无执行/反馈 | `pnpm exec vitest run packages/adapters/test/human-decision-feedback/command-chain.test.ts` |
| 接线/人工拒绝到此结束 | IP-1,4,8 | 同上 | 精确建议 | declined 终局、无 C30 运行 | 同上 |
| 接线/缺少或错配绑定时拒绝决定 | IP-2,4,8 | 同上 | 错工程/空间/建议 proof | 无 C28 决定 | 同上 |
| 接线/等待中的预测运行不先于人工决定执行 | IP-2,4,8 | 同上 | 注入决定前故障/响应丢失 | 等待、同运行重试、无预测 | 同上 |
| 接线/非人工决定恢复不能越过等待门 | IP-1,2,8 | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`command-chain.test.ts` | 等待中的真实运行 | 普通/错配恢复失败 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts` |
| 接线/已采纳建议形成现场执行 | IP-5,8 | `command-chain.test.ts` | 采纳终局 | 一项执行、决定不变 | `pnpm exec vitest run packages/adapters/test/human-decision-feedback/command-chain.test.ts` |
| 接线/独立行动不伪造建议 | IP-5,8 | 同上 | C19 已发布措施 | independent-action、无采纳/预测 | 同上 |
| 接线/无权或虚假执行拒绝 | IP-5,8 | 同上 | 错 actor/未采纳/无证据 | 无写入 | 同上 |
| 接线/执行后反馈形成正式事实 | IP-3,6,8 | 同上 | 执行后监测+工件+C25 实际评估 | 冻结输入、C28 反馈、后续分段只读 ref | 同上 |
| 接线/实际评估缺失或链不符时失败 | IP-3,6,8 | 同上 | 缺失或错风险/空间/时间 | 无正式反馈/成功审计，原键可重试 | 同上 |
| 接线/确认后单次提交与安全重试 | IP-4,6,7,8 | `apps/api/test/http-shell.test.ts`、`command-chain.test.ts` | C10 固定 plan、响应丢失 | 同键同载荷同逻辑引用 | `pnpm exec vitest run apps/api/test/http-shell.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts` |
| 接线/无权或陈旧版本不能绕过 | IP-1,4,6,7,8 | 同上 | 撤权/跨空间/版本更替 | 安全失败、无新副作用 | 同上 |
| 工作流/精确正式建议取得真实决定绑定 | IP-1,2 | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | C30 登记运行 | 最小 proof 精确匹配 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` |
| 工作流/事实缺失、越权或内容不一致时失败关闭 | IP-2 | 同上 | 缺失/错摘要/撤权 | 类型化最小失败 | 同上 |
| 工作流/采纳前等待与幂等重放 | IP-1,2 | `apps/worker/test/risk-flow/runtime.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 相同决定身份 | 同运行、无预测 | `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` |
| 评估/精确实际评估返回最小证明 | IP-1,3 | `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` | 已成立 C25 记录 | 精确 ref/风险/空间/冻结依据/运行 | `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` |
| 评估/无权、缺失或内容不一致时失败关闭 | IP-3 | 同上 | 错摘要/版本/授权 | 不泄露正文、无重算 | 同上 |
| 所有公共接口与模块边界 | IP-1–8 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 当前代码 | strict 契约、类型和依赖 | `pnpm typecheck && pnpm deps:check && openspec validate wire-human-decision-and-feedback-commands --strict --no-interactive` |

## 7. 文件清单与升级条件

修改：`packages/contracts/src/ports/index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/core/src/workflow/service.ts`、`packages/core/test/workflow/service.test.ts`、`apps/worker/src/risk-flow/runtime.ts`、`apps/worker/src/risk-flow/graph.ts`、`apps/worker/src/risk-flow/composition.ts`、`apps/worker/test/risk-flow/runtime.test.ts`、`apps/worker/test/risk-flow/composition.test.ts`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts`、`packages/adapters/src/workflow/index.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`、`packages/adapters/src/risk-assessment/engine/index.ts`、`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`、`apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts`、`apps/web/test/confirmation.test.ts`（仅确有 C10 回归风险时扩展）。新增：第 3 节 IP-4/IP-8 明列的 C41 core、adapter、迁移和测试文件。删除：无。保护：C22/C24/C28 写路径和迁移、`openspec/specs/` 已归档主规格、锁文件。

若实施所需公共字段超出 D1/D2/D3/D5、C30 合入后缺等待/路由/恢复所需事实、C25 证明必须越权读正文、C41 迁移编号或唯一性无法保持、需改 C28 写路径/旧表、需新依赖或 capability、指定命令不存在，先升级并停在当前 IP；普通类型/测试缺陷在当前任务内修复。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在以上文件与已批准 D1–D7 语义内修复代码/测试，核对最终 HEAD 的真实 C30 等待→采纳门、C25 精确证明、C41 拒绝/反馈与 API 直调；运行第 6 节受影响命令并填写独立 `verification.md`。权限、跨事务状态、等待恢复门及 C41/C28/C30 语义冲突需一次限定审计；审计结果写入同一 verification。Planning/Implementation 不提前创建 verification，不提交、合并或归档。
