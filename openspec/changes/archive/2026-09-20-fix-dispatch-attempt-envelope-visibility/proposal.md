# Proposal

## Why

受控派发在**两个窗口**内会丢失当前尝试的结构化信封：worker 运行期间，以及 worker 报告收口之后。状态视图随即回落到上一个已 settled 的尝试，`resumeQueue`、`riskflow_wait` 与 `riskflow_settle` 因此指向过期 Run，派发—监督—收口闭环闭不上。

根因是两套语义挤在同一字段上：

- RiskFlow 把 v2 执行信封存放在 Orca Task 的 `result`。
- Orca 把 `result` 当作「本次尝试的结论载荷」，在两处整体覆盖它：
  - 监督派发起步 `createStartingWorkerDispatch`：`UPDATE tasks SET status = 'dispatched', result = NULL, completed_at = NULL`；
  - worker 报告收口 `settleWorkerReport`：`UPDATE tasks SET status = ?, result = ?, completed_at = …`，写入的是 `{"provenance":"worker_report",…}` 这种报告对象。

`status.mjs` 的 `taskMatchesNode` 硬门是 `envelope.valid`，而信封只从 `task.result` 解析（`parseTaskEnvelope`）；`attempts` 也只由 tasks 产生，live worker 不参与检查点选择。

实测后果：C17 派发成功后节点从 `finalizing` 掉回 `paused`（回落到 attempt 1 / `run_659dc013d9a9`），`nextActions` 变成「批准新规划后才可重开实现」；attempt 2 又以 `failed` 收口后同样不可解析。全库 45 个 Run 扫描印证字段行为：所有 `ready`/`completed` Task 的 `result` 均在，唯一 `dispatched` 与唯一 `failed` Task 为 NULL。这与 2026-09-14 之后队列长期静止、且这些条目从未真正跑过「派发→收口」闭环的现象一致。

## What Changes

- 控制器维护**自持尝试台账**：把当前尝试的完整 v2 信封写入 git common dir 的 `riskflow-orchestration/attempts/<taskId>.json`（临时文件 + rename，受既有运行时锁保护），在派发登记（`queued`）、worker 启动成功（`running`）、受控 reconcile 与受控收口（`settled`）时更新。
- `status.mjs` 只在该 Task 的 `result` 不再携带有效信封时，用台账补齐该尝试的证据；Orca 侧仍然有效的信封始终优先，陈旧台账不得覆盖它。
- 台账登记失败不得使已经启动的派发被报告为失败（避免上层盲重试产生第二个 worker），而以结构化 warning 暴露。
- 派发前的登记是硬前置：台账写不进去就不启动 worker，避免制造无法监督的尝试。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 新增要求——控制器必须以自持台账登记当前尝试，并保证派发前可持久化。
- `operations/orchestration-execution-status`: 新增要求——Task 的 `result` 不再携带有效信封时，状态视图用台账补齐当前尝试，且 Orca 侧有效信封优先。

## Impact

- 代码：`scripts/orchestration/control.mjs`（新增 `recordAttempt`、`attemptEnvelope`、`recordRunningAttempt`；在 dispatch / reconcile / settle 登记台账；运行时锁上下文暴露 `runtimeDir`）、`scripts/orchestration/status.mjs`（导出 `gitCommonDir` 与 `normalizeTask`；新增台账读取与补齐）、两个测试文件。
- 运行时状态：新增 `<git-common-dir>/riskflow-orchestration/attempts/` 目录。该目录是控制器的自有事实源，不写入仓库工作树，也不与 Orca 争用 `tasks.result`。
- 不影响 Orca、Run、Task、Dispatch 的既有契约，不新增依赖，不改变 v2 信封字段集合与既有尝试选择规则。
- `scripts/orchestration/control.mjs` 不再需要本地 `gitCommonDir`，改为复用 `status.mjs` 导出的同一实现。
