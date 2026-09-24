## Context

输入基线为 `7601bc9808b01edb8c4014cbc4cd3484bee57787`；规划期间 C30 合入工作树，实查 HEAD 为 `ff3da69116e3c24f350ff3654ffb82f87cd0577e`。C09 已登记 `warning-response` 的决定、执行、反馈命令，C28 的 `PostgresResponseLifecycleAdapter` 已实现 `recordDecision`、`recordExecution`、`recordFeedback`，但公开 `WarningResponsePortV1.record` 尚无 C41 组合实现。C28 的 `ResponseAdoptionDecisionCommandV1Schema` 对采纳和拒绝都强制要求真实 `routeDecisionRef` 与 `forecastRunRef`；`ResponseFeedbackCommandV1Schema` 要求内嵌冻结快照和精确实际评估记录。C30 公共 `WorkflowPortV1.startRun` 的具体运行时由 `apps/worker/src/risk-flow/runtime.ts` 承担，父图在 `apps/worker/src/risk-flow/graph.ts` 登记分段路由，C30 PostgreSQL 适配器负责持久事实。C25 已持久化评估记录及输入快照，但目前只有输入快照窄读。C10 的确认状态和 C06 授权、C03 事务审计均复用现有实现。

## Goals / Non-Goals

**Goals:** 人提交的决定、现场执行和反馈经单一公开命令入口形成可追溯事实；采纳先建立等待中的真实 C30 预测运行，拒绝不创建运行；实际反馈只使用 C25 已成立的精确评估；所有读取受当前权限约束，重试不重写事实。（RA-S7）

**Non-Goals:** 不改变 C22/C24/C28 原写方法、旧迁移、已归档规格；不让图代替人提交决定或执行；不新增角色、能力值、运行时依赖、自动校准或“最新”猜测。

## Decisions

### D1：公开命令与结果契约（RA-S7）

C41 在应用组合层实现 `WarningResponsePortV1.record` 的 `adopt-recommendation`、`record-execution`、`record-feedback` 三分支；`ApiPortsV1` 增加仅承载这三分支的 `humanDecisionFeedback` 注入位，C09 `HTTP_ROUTE_CATALOG_V1` 对这三项转发给它，其余 `warning-response.record` 分支仍交原 `warningResponse` port。C10 用原命令标识、幂等键和精确目标确认；HTTP 每次从会话签发当前 C06 授权。C41 内部才可组装 C28 私有命令，HTTP strict DTO 不接收 `binding`、运行身份、操作者或授权上下文。

公共采纳 payload 加可选 `preActionMonitoringSnapshotRef`：若提供，必须由 C14/C25 证明属于同一建议的冻结评估输入；未提供时仅在该输入恰有一个合格执行前快照时选择，否则安全失败。公共反馈 payload 加可选 `actualAssessmentRecordRef` 作为**精确选择器**；正式提交必须提供，C25 当前授权下证明其为已成立实际评估且 C30 对应运行已完成，选择器本身不被当成评估结果。加可选字段保留旧 DTO 的解析；旧调用在缺少可证明依据时明确失败。`WarningResponseRecordSuccessV1Schema` 加 `decline` 分支，仅含 C41 自有 `routeDecisionRef`，不伪造 `forecastRunRef`；采纳继续用原 `adoption` 分支。备选为给拒绝创建假运行或让 C28 接受无运行；两者分别违背真实引用与本 change 的 C28 写路径边界。

### D2：采纳运行与人工决定的顺序（RA-S7）

C41 先以人工决定的 `commandId`、`idempotencyKey` 和精确 `responseRecommendationRef` 调用 `WorkflowPortV1.startRun` 的 `forecast-response`；`adoptedRecommendationRef` 正是这次人工提交的建议。C30 接受可选闭合 `waitForDecision: true`，旧调用默认原语义；此模式在父图准备阶段只登记真实父运行、预留分段路由和等待状态，不启动评估子图或预测。`startRun` 的 `waiting.waitingRunRef` 即精确运行引用。采纳证明后恢复时，C30 将精确决定引用追加到冻结运行事实，再按原分段身份创建子运行；子图 A0 的 `adoptionDecisionRef` 只取该已证实引用。`graphVersion`、`retryPolicyRef` 来自服务端已发布的 C30 配置，执行前快照按 D1 获取；缺配置或上下文则不启动。C30 用同一业务幂等身份返回同一运行，不因响应丢失重复创建。

C30 的独立只读证明（D5）返回这次运行的路由、空间、建议和冻结摘要。C41 逐项校验后冻结 `VerifiedResponseWorkflowBindingV1`，再交 C28 `recordDecision`。C28 成功并完成 D3 终局登记后，C41 才用当前 C06 授权调用 C30 既有 `resumeRun`；`ResumeCauseV1Schema` 加闭合 `human-decision-committed` 分支，携带 C41 决定引用。C30 等待模式只接受此分支，并经 D3 精确采纳证明核对运行、建议和空间；旧运行的其它恢复语义不变。C41 重试依次重放 `startRun`、C28 决定和恢复；恢复失败保留正式决定与等待中的运行，由同一命令身份重试，不回滚或自动改选建议。备选为先提交 C28 再创建运行，无法满足 C28 的真实运行绑定。

### D3：拒绝、执行与单一终局性（RA-S7）

拒绝不调用 C30，也不调用强制要求 `forecastRunRef` 的 C28 `recordDecision`。C41 在自有 `business.human_response_decisions` 表以 `(project_id, recommendation_id, recommendation_version_id)` 唯一键保存 `pending-adoption | adopted | declined` 决定状态、原命令摘要与终局拒绝的原因、操作者、时点、审计引用；拒绝返回 D1 的 `decline` 结果。采纳先占用同一唯一键，C28 决定成功后将其终局化并记录真实 C28 决定与 C30 运行引用。进行中行只允许原键同载荷继续；异载荷或其它主体并发决定失败。C28 成功而 C41 终局化失败时，重试复用 C28 回执并补记 C41 行，不创建第二项事实；该中间态不向外宣称决定完成。C41 表是公开命令的唯一终局索引，既有 C28 表仍是采纳领域事实。C41 提供仅供 C30 等待运行恢复使用的 `HumanDecisionProofPortV1`：按当前授权及精确决定/运行/建议引用只返回已终局 `adopted` 与 C28 决定引用一致的最小证明；pending、declined、缺失、越权一律失败。拒绝事实与采纳互斥，且不会借 C28 假绑定写入。

现场执行直接调用 C28 `recordExecution`，不代替 `adopt-recommendation`；沿用 C28 对实际执行人、录入人、发生时间、证据和 `adopted-recommendation | independent-action` 来源的检查。采纳来源须同时与 C41 终局索引和 C28 事实对账；独立行动用 C19 已发布措施证明，不生成建议或预测。

### D4：反馈冻结与精确实际评估（RA-S7）

公开反馈只携带执行引用、执行后监测、工件、发生时间及 D1 的精确评估选择器。C41 通过 C28 既有受权读取接缝验证执行、C14 监测 cutoff、C04 工件；通过 C25 新增只读证明验证同工程、空间、风险输入、冻结 basis、监测快照和已完成运行。不可用、错链、过早时间一律在正式反馈前失败，绝不回退到基线或预测值。

C41 在自有 `business.human_feedback_input_snapshots` 中按原命令身份保存不可变 `ResponseFeedbackInputSnapshotV1`、精确 `actualAssessmentRecordRef`、内容摘要与状态 `prepared | committed`。`feedbackRef` 由工程、执行、监测、工件、评估和业务命令身份的规范摘要确定；该表唯一约束工程+命令种类+幂等键，重放核对摘要。prepared 只是内部冻结输入，不是正式反馈、成功审计或事件。C41 将已冻结 DTO 交 C28 `recordFeedback`；C28 自身事务原子写正式反馈、审计和事件，成功后 C41 把冻结行标为 committed。若最后标记失败，原键重试 C28 回执后补标记；未标记前不对外宣布组合命令成功。正式反馈之后才以其精确引用通过 C30 `record-response-feedback` 分段入口启动/恢复后续偏差流程；运行启动失败由同一身份重试，绝不重复人工录入。

### D5：C30 与 C25 的加法式只读证明（RA-S1、RA-S5、RA-S7）

在 `packages/contracts/src/ports/index.ts` 分别定义独立 strict 的 `ResponseWorkflowBindingProofPortV1`、`ActualAssessmentProofPortV1`，不扩张原 `WorkflowPortV1` / `RiskAssessmentPortV1` 的写签名。请求固定工程、精确目标引用、请求时点和当前 `AuthorizationContextV1`；C30 证明还包含精确运行引用，C25 证明还包含精确 `RiskAssessmentRecordRefV1`。C30 提供方从自身持久运行/路由行返回建议、路由、运行、空间、状态、冻结摘要与审计引用；C25 提供方从评估记录和输入快照行返回风险输入、空间、冻结依据、监测快照、偏差/校准策略及所属运行引用。两者先用 C05/C06 现有授权复验主体、工程、能力、空间和资料范围，随后按精确键读取并核对行、正文、摘要、状态；缺失与越权同型失败，损坏用稳定类型化失败，不返回正文、latest 或列表。证明只读、不登记业务成功事实。备选为由 C41 跨模块读表或用投影猜测，均破坏模块边界。

### D6：权限、错误、事务与可观测性（RA-S7）

C41 不签发新能力，三分支沿用 C02 的 `warning-response.*` 能力并在每次读写、恢复前复验 C06；C30/C25 内部证明仅使用同一已签发上下文所允许的既有 `workflow`/`risk-assessment.read` 窄权限，不扩大空间或资料。HTTP 的 strict 校验早于下游，直接 HTTP 与 C10 对话框走同一服务端逻辑。已存在 C03 原子边界分别保护 C30 运行创建、C28 领域写入及 C41 自有决定/快照行和审计；跨三次提交不能伪称单事务，靠稳定命令身份、状态和重试前向收口。错误复用 `ModuleErrorV1` 的授权、陈旧版本、幂等冲突、业务阻断、瞬态和终止类别；日志只记录命令、工程、精确引用、阶段、错误码及审计引用，不记录受限正文。C41 prepared/pending 行的失败审计与重试结果可追溯，正式成功只在对应 C28 事实/拒绝终局事实已成立后返回。

### D7：文件所有权、迁移及验证（RA-S7）

C41 组合层放 `packages/core/src/human-decision-feedback/`，C41 PostgreSQL 事实适配器及新增迁移放 `packages/adapters/src/human-decision-feedback/` 与 `packages/adapters/src/postgres/migrations/warning-response/wire-human-decision-and-feedback-commands/`。公共 DTO 和三个只读 port 只在 `packages/contracts/src/ports/index.ts` 加法式扩展；C30 等待/恢复实现落 `apps/worker/src/risk-flow/`，C30 持久证明落 `packages/adapters/src/workflow/`，C25 证明落 `packages/adapters/src/risk-assessment/engine/`；API 组合只改 `apps/api/src/http.ts` 的已有路由注入。C10 只接入既有 `CommandConfirmationPlanV1`/对话框，不另建确认状态机。迁移仅新建 C41 两表、唯一键与不可变约束，不回填、不改 C28/C30/C25 旧表；发布前按现有迁移 provider 校验顺序与回滚对称性。无生产依赖变化。用既有 Vitest、PostgreSQL fixture、typecheck、依赖边界与 OpenSpec strict 校验；测试稳定引用、状态、审计、权限与幂等，不锁定内部调用次数或提示文案。

## Risks / Trade-offs

- C30 已在规划期间合入，但现有 `startRun` 对 `forecast-response` 会直接进入分段子图，且既有子图 A0 要求采纳决定引用；实施第一步须核对最新 HEAD，并按 D2 在父图准备阶段登记等待及预留路由。若无法在 D2/D5 的加法边界实现，先升级，不以假运行替代。
- C28 拒绝写入契约强制带预测运行；D3 的 C41 自有终局拒绝避免改 C28 写路径，但旧 C28 内部直接调用不经过 C41 唯一索引。公开入口必须唯一指向 C41；任何其它公开写入口须收敛或升级。
- 跨 C30、C28、C41 的分步提交可能留下等待运行或 prepared 快照；这些状态无正式预测/反馈效果，原身份可重试补齐。超时处置由审计与人工排查，不自动采纳或清理可追溯事实。

## Migration Plan

先在 C30 合入后的基线上验证 D2/D5 接缝，再应用 C41 加法迁移和端口。部署组合根后公开路由统一指向 C41；旧客户端可解析原请求，缺少精确反馈评估选择器时返回受控失败。回滚仅停止 C41 入口并保留自有审计/冻结事实，不删除已成立 C28/C30/C25 历史。
