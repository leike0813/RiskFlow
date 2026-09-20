# Design

## Context

- v2 执行信封历史上存放在 Orca Task 的 `result`，`status.mjs` 只从该字段解析（`parseTaskEnvelope`），并以 `envelope.valid` 作为任务与路线节点匹配的硬门（`taskMatchesNode`）；`attempts` 由 `tasks.map(taskEvidence)` 产生，live worker 不进检查点选择。
- Orca 1.4.198 的 daemon 在两处整体覆盖该字段：
  - `createStartingWorkerDispatch`：`UPDATE tasks SET status = 'dispatched', result = NULL, completed_at = NULL`；
  - `settleWorkerReport`：`UPDATE tasks SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ? AND status = ?`，参数中的 `result` 是 worker 报告对象（实测 `{"provenance":"worker_report","outcome":…}`）。
- `updateTaskStatus` 反而是保留语义（`result = COALESCE(?, result)`），但这只对 `task-update` 生效，挡不住上面两条覆盖。
- 控制器已有的 `task-update --status ready --result <envelope>` 写入发生在 worker 启动之前，必然被随后的派发清空。
- 状态视图的检查点投影（`taskEvidence`）会把 `outcome`、`approvalRef`、`supersedesAttemptGroup` 补成 `null`，且不携带 `schemaVersion`、`worktreeId`、`inputHead`；这些字段直接参与 v2 校验。

## Goals / Non-Goals

**Goals:**

- 派发到收口的整个生命周期内，当前尝试都能被状态视图解析，`checkpoints.runId` 指向真实运行中的 Run。
- 台账补齐不得改变尝试身份或阶段语义，也不得伪造质量结论。
- 登记失败不得被表述为派发失败；但派发前必须能登记，避免制造无法监督的尝试。

**Non-Goals:**

- 不改变 Orca、Run、Task、Dispatch 的既有契约，也不修改 Orca 安装。
- 不改变 v2 信封字段集合、`RUN_STATES` 取值集合或既有的尝试选择规则。
- 不再写回 `tasks.result`：该字段归 Orca 所有，控制器不与它争用。
- 不修复「台账本身陈旧」这类运维问题之外的语义问题；陈旧台账由「Orca 侧有效信封优先」这条规则兜底。

## Decisions

**D1：控制器自持台账，而不是在状态侧猜测或反复回写 `tasks.result`。**
`status.mjs` 重建当前尝试需要 `attempt` / `attemptGroup` / `auditPolicy` / `issueRefs` / `evidenceRefs`，这些字段在 `result` 被覆盖后无法从 Dispatch 记录取回；凭空推导会违反按尝试组与尝试次数选择当前尝试的要求。回写 `result` 则只能赢下运行窗口，worker 报告一收口就被再次覆盖，等于与 Orca 打地鼠。台账是唯一能同时覆盖两个窗口且不依赖 Orca 未公开语义的方案。

**D2：台账存放于 git common dir 的 `riskflow-orchestration/attempts/<taskId>.json`。**
与既有 `receipts/` 同处、同受运行时锁保护，复用「临时文件 + rename」的原子写；按 `taskId` 分文件避免整表重写竞争。`<taskId>` 主键让补齐规则最简单：Task 的 `result` 无效且台账有同 `taskId` 记录时补齐。台账不写入仓库工作树，因此不会被 Git 状态、worktree 回收或提交动作带走。

**D3：Orca 侧有效信封优先。**
收口后 `result` 会重新变成有效 v2 信封，此时它比台账更新。规则固定为「有效即采用 Orca，无效才用台账」，陈旧台账因此不会覆盖新结论。

**D4：派发前登记是硬前置，启动后登记是软失败。**
派发前写不进去就不启动 worker——否则立刻制造一个无法监督的尝试。worker 已启动后写不进去则只告警：此时报告失败会诱导上层盲重试（幂等键已 inflight），产生第二个 worker 的代价更高。

**D5：信封一律经 `attemptEnvelope` 归一化，不直接展开投影。**
投影的 `outcome: null`、`approvalRef: null`、`supersedesAttemptGroup: null` 与缺失的位置字段会让 v2 校验分别判为 `premature_outcome`、`invalid_replan_boundary`、`missing_fields`。归一化以路线节点为准补 `schemaVersion`、`workItemId`、`routeNodeId`、`changeName`、`worktreeId`、`inputHead`、`phase`，以派发信封为准保留尝试身份，并删除三个 null 与 `outputHead`。

**D6：`gitCommonDir` 收敛到 `status.mjs` 导出。**
控制器原先自带一份，现在两处都需要定位 git common dir。由 `status.mjs` 导出、`control.mjs` 复用，避免同一路径推导出现两份实现。

## Risks / Trade-offs

- 台账成为状态视图的事实源之一，若它不可写且发生在派发前，派发会被拒绝。这是刻意的 fail-closed：宁可挡住派发，也不产生不可监督的尝试。
- 台账只保留每个 `taskId` 的最新信封；历史尝试仍依赖 Orca 侧已收口的 `result`。若 Orca 未来也清理历史 `result`，需要另行评估台账保留策略。
- 依赖「Orca 覆盖 `result`、但不影响 Run/Task/Dispatch 身份」这一前提；若 Orca 改为清理任务行本身，台账会指向不存在的 Task，此时补齐规则自然失效（不会猜测），但监督需要重新设计。
- 手动登记的台账记录（例如为历史尝试补账）不经过控制器事务，属于运维动作，需要在报告中显式说明。
