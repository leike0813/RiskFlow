# gap-inbox · agent（P-AG，C35）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-AG-01（G6 规格空白）

- 缺口：Agent 任务的工具行动（白名单内工具逐项调用、白名单外拦截记录）在契约中无记录 Schema；`AgentTaskRefV1` 仅携带 `toolPolicyRef`，工具行动列表的字段形状无从对齐。
- 依据：`packages/contracts/src/ports/index.ts:316-328`（AgentTaskRefV1 仅版本引用）；页面需求见 `demo/v2/src/pages/agent/AgentTaskDetailPage.tsx` 工具行动卡。
- 预设：fixture 自定义 `ToolActionView`（actionId / toolName / toolLabel / summary / outcome: succeeded | blocked / note），拦截项记录拦截原因，见 `demo/v2/src/content/agent.ts`。
- 待确认：工具行动是否应作为任务运行记录的一部分入契约（保证拦截与调用可审计），还是仅由审计日志承载。
- 风险：白名单拦截若只在日志中，第三方重放时无法从记录校验「未越权调用」。

## GAP-AG-02（G6 规格空白）

- 缺口：Agent 增量的逐项确定性校验决定（接受 / 拒绝及原因）在契约中无记录 Schema；契约仅有 `incrementSchemaRef` / `validationPolicyRef` 引用与 `ValidationSnapshotRefV1`，逐项决定字段形状无事实源。
- 依据：`packages/contracts/src/ports/index.ts:316-328`、`:223`（ValidationSnapshotRefV1 仅引用类型）；页面需求见 `demo/v2/src/pages/agent/AgentTaskDetailPage.tsx` 增量校验卡。
- 预设：fixture 自定义 `AgentIncrementView`（incrementItemId / operationType / summary / decision: accepted | rejected / reason），操作类型为任务类型白名单内的类型化领域操作名，见 `demo/v2/src/content/agent.ts`。
- 待确认：逐项校验决定是否随校验快照入库为结构化记录，以及拒绝原因是否枚举化（权限 / 来源资格 / 版本兼容 / 规则冲突 / 越界）。
- 风险：逐项决定无契约约束时，「拒绝不得循环绕过」的审计取证缺乏可校验字段。

## GAP-AG-03（G6 规格空白）

- 缺口：Agent 任务的资源消耗计数（token / 工具调用次数 / 候选规模 / 墙钟时间）与版本化硬预算的对比展示无契约字段；`budgetPolicyRef` 仅指向预算策略版本。
- 依据：`packages/contracts/src/ports/index.ts:316-328`；页面需求见 `demo/v2/src/pages/agent/agent-shared.tsx` 任务摘要头部与资源消耗卡。
- 预设：fixture 自定义 `BudgetConsumptionView`（tokensUsed/tokensLimit、toolCallsUsed/toolCallsLimit、candidatesUsed/candidatesLimit、wallClockSeconds/wallClockLimitSeconds），见 `demo/v2/src/content/agent.ts`。
- 待确认：资源消耗是否作为任务终态记录字段入契约（支撑「预算耗尽不得静默跳过」的核验）。
- 风险：消耗口径跨端不一致时，预算超限判定无法重放。

## GAP-AG-04（G2 契约字段 · 跨域 fixture 标识漂移）

- 缺口：处置域 fixture 中校准建议 CAL-2026-001 的来源 Agent 任务标识为 `AGT-CAL-2026-001`，本域按 manifest samplePath（`/agent/tasks/AGT-001`）以 `AGT-001` 指代同一校准建议任务，两处标识漂移。
- 依据：`demo/v2/src/content/response.ts:663`（agentTaskRef.entityId 为 AGT-CAL-2026-001）；`demo/v2/docs/page-manifest.json`（P-AG-03 samplePath 为 /agent/tasks/AGT-001）；`demo/v2/src/content/agent.ts`（AGT-001 任务类型 calibration-suggestion，产出 CAL-2026-001）。
- 预设：本域以 AGT-001 为校准建议任务的唯一标识，处置域 fixture 暂视为同一任务的旧称。
- 待确认：统一校准建议 Agent 任务标识（建议处置域改为 AGT-001，或本域改用 AGT-CAL-2026-001 并同步 manifest samplePath）。
- 风险：评审沿典范链从 CAL-2026-001 跳转 Agent 任务详情时会落空（标识未命中）。

## GAP-AG-05（G6 规格空白）

- 缺口：交互 Agent 会话的消息流（用户指令 / Agent 回复 / 系统提示）在契约中无记录 Schema；契约仅有 CommandProposalRefV1 / UserConfirmationRefV1 承载待确认环节，消息体字段形状无事实源。
- 依据：`packages/contracts/src/ports/index.ts:229-233`；页面需求见 `demo/v2/src/pages/agent/agent-shared.tsx` 消息流组件。
- 预设：fixture 自定义 `AgentMessageView`（messageId / kind: user | agent | system / at / actorLabel / text / relatedTaskId）与 `PendingCommandView`（proposalRef / agentTaskId / commandKindLabel / summary / targetRef / state），见 `demo/v2/src/content/agent.ts`。
- 待确认：消息流是否作为会话持久化记录入契约，以及系统提示（任务契约固定要素、确定性收口结果）是否属于审计范围。
- 风险：消息流无契约约束时，「写命令提交前必须用户确认」的会话侧证据无法重放。
