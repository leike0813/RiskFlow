---
name: riskflow-orchestration
description: 接管并推进 RiskFlow 的受控 Orca/OpenSpec 多 Agent 调度；在新会话、恢复失败任务、回复 Agent、收口、集成、归档或回收 worktree 时使用。
---

# RiskFlow 调度执行

## 目标

从实时 Git、OpenSpec 与 Orca 事实接管调度，不依赖旧会话记忆。
所有编排写操作走 `riskflow_*` 受控工具。
保持单一 writer、可审阅 Git 检查点和可重放执行信封。

只为执行图规定的独立语义任务派发 Agent。状态读取、队列选择、回复、审阅、settle、集成、归档和回收由当前协调者直接完成。

## 必读事实源

首次接管先完整阅读：

- `AGENTS.md`
- `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`
- `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md`
- `config/orchestration/execution-graph.json`，仅在需要核对阶段、角色或模型时读取

稳定责任和状态转换以 Handbook 为准。
启动、等待、故障恢复和回收细节以 Runbook 为准。
当前进度只认 `riskflow_status` 的实时结果。
聊天记录、日志片段、旧 HEAD、旧 Task 和手册示例都不是当前指令。

## 冷启动

1. 确认当前目录属于 RiskFlow 主仓库或其受管 worktree。
2. 运行 `pnpm orchestration:doctor`，确认扩展、配置和命令入口可用。
3. 调用 `riskflow_status()`。
4. 保存本次返回的 `revision`，不要复用旧 revision。
5. 分开读取 `violations`、`resumeQueue`、stale/reclaimable 节点和 `diagnostics`。
6. 只处理授权范围内、队列优先级最高且合法的动作。
7. 不预建后续 worktree、Task、Run 或 Agent session。

若 OMP 扩展不可用，可用只读命令检查状态：

```bash
pnpm orchestration:status --json
pnpm orchestration:check
```

只读 CLI 可以诊断，不能替代受控写工具。

## 状态分流

按以下顺序决策：

1. `violations` 非空：先停止普通派发；只有 `checkpoint_mismatch` 或 `worktree_reclaim_pending` 才使用 `riskflow_reconcile`。
2. `resumeQueue` 中 `recovery`：按节点事实分流。`untracked/adopt` 且无违规时使用 `riskflow_dispatch` 登记并派发 Finalizer；上述两类安全漂移才使用 `riskflow_reconcile`；其他情况升级。
3. `finalizing`：派发或继续当前 Finalizer；必要时只做一次限定审计。已结束且未闭合的 audit 必须升级，不派新的 Finalizer。
4. `integrating`：审阅证据后调用 `riskflow_integrate`。
5. `implementing`：派发当前 Implementation 任务。
6. `planning`：派发 Planning，闭合实际 schema 的 apply 前置工件。
7. `ready`：由 `riskflow_dispatch` 创建 worktree 和任务。
8. `cleanup`：只用 `riskflow_integrate` 回收。
9. `diagnostics`：记录并判断相关性；它本身不阻断合法队列。

不要把以下概念混在一起：

- `violations` 是 fail-closed 的状态冲突。
- `resumeQueue` 是当前可执行接管顺序。
- `stale` 表示归档后仍有需核实的残留。
- `reclaimable` 表示已满足受控回收门禁。
- `diagnostics` 是非阻断历史或观察信息。

## 七个受控工具

### `riskflow_status`

用途：读取实时状态、`revision`、`resumeQueue`、违规、节点和诊断。

参数：无。

每次写操作前重新调用。
写操作完成、超时、报错或收到 Agent 事件后也重新调用。

### `riskflow_dispatch`

用途：根据节点阶段和执行图选择唯一合法角色，创建或启动任务。

参数：

```text
workItemId
expectedRevision
idempotencyKey
replanApprovalRef?  # 仅用户已批准重新规划时
terminalHandle?     # Codex 首次信任确认后的精确 terminal
```

不要自行选择与 Manifest 不同的模型或角色。
不要为了绕过失败创建第二个 writer、Task 或 worktree。
新建 worktree 的 setup 失败时停止派发，保留事实并重新读取状态。
Planning、Finalizer 或 Auditor 首次派发会先创建 Codex terminal 并等待 `tui-idle`。
若返回 `workspace_trust_required`，在结果给出的精确 terminal 中由操作者确认信任；确认 idle 后重新读取状态，以新幂等键和该 `terminalHandle` 再调用 `riskflow_dispatch`。复用当前 queued Task，不新建 Task、Run 或 terminal。

每个独立 Task 使用新的 Agent session。只有同一仍活动 Task 内的修复与回归可以继续使用当前上下文；worker_done、失败、暂停、释放或长时间闲置后的 terminal、Run、Dispatch 和上下文不得用于后续 Task。信任恢复复用的是尚未 worker-start 的 queued Task，不是旧任务上下文。

### `riskflow_wait`

用途：等待当前工作项的 `worker_done`、`question` 或 `escalation`。

参数：

```text
workItemId
ackDeliveryId?  # 已完整处理的上一批 Delivery
timeoutMs?  # 1000..60000
```

单次最多等待 60 秒。
完整处理返回批次后，把其 Delivery 标识作为下一次调用的 `ackDeliveryId`；控制器会先 ack 前一批再等待，避免重复重放。
不要 ack 尚未处理完整的批次。
超时是正常协调检查点，不代表 worker 失败。
超时后读取状态；仍在运行就继续等待，不新建替代任务。

### `riskflow_reply`

用途：回复当前非 settled Run 中的 `question` 或 `escalation`。

参数：

```text
workItemId
expectedRevision
idempotencyKey
messageId
body
```

使用事件给出的精确 `messageId`。
答案必须受已批准规格、代码和任务范围约束。
若问题涉及公共契约、权限、持久化、迁移、依赖或范围变化，升级给用户；不要替用户决定。
不要直接调用 Orca reply 命令。

### `riskflow_settle`

用途：在审阅结果和证据后收口当前任务，必要时形成 Git 检查点。

参数：

```text
workItemId
expectedRevision
idempotencyKey
outcome             # succeeded|failed|blocked|paused
evidenceRefs?
issueRefs?
riskTags?
reviewedPaths?
```

收到 `worker_done` 后先核对：

- Delivery 与任务范围一致；
- worktree diff 全部已审阅；
- 实际 HEAD 与任务信封一致；
- 声明的检查确实运行并通过；
- schema 要求的 verification 已完成且对应最终 HEAD。

存在 dirty paths 时，`reviewedPaths` 必须与实时 dirty paths 完全一致。
不要用 `git add -A`。
普通测试失败由当前责任角色修复，不把 Finalizer 缺陷回派给 Implementation。

若 Git 检查点已形成，但 Orca Task 已终态而 v2 信封仍为 running，先重读状态，再以新 revision 和幂等键调用 `riskflow_settle` 补齐尝试台账。不要新建 Agent Task，也不要直接编辑 runtime 文件。

### `riskflow_integrate`

用途：执行当前状态允许的 merge、main 验证、OpenSpec archive 或 worktree 回收。

参数：

```text
workItemId
expectedRevision
idempotencyKey
```

一次调用只推进实时状态允许的步骤；完成后重新读取状态。
集成顺序固定为：最终验收、feature clean、merge、main `pnpm verify`、archive、cleanup。

cleanup 时控制器只处理完整 worktree ID。
对终态 terminal 残留，它会关闭状态中记录的精确 handle，重新采集状态，确认同一节点变为 `reclaimable` 且 worktree ID 未变，才回收。
任一前提漂移都应 fail-closed。

### `riskflow_reconcile`

用途：对允许的 checkpoint 漂移或回收漂移创建新的受控恢复尝试。

参数：

```text
workItemId
expectedRevision
idempotencyKey
taskKind?  # planning|finalization
waiting?
```

仅以下违规允许受控 reconcile：

- `checkpoint_mismatch`
- `worktree_reclaim_pending`

重复 writer、身份冲突、未知 worktree、全局违规或证据冲突不能通过 reconcile 绕过。
失败 worker 仍绑定未 settled checkpoint 时，先读取新 revision，再 reconcile；不要直接复用已失败 Dispatch。

## Revision 与幂等

每个写操作都携带最近一次 `riskflow_status` 返回的 `revision`。
状态改变后旧 revision 立即失效。

为每个逻辑写操作生成唯一 `idempotencyKey`。
只有完全相同的操作重放才复用同一 key。
参数、目标或意图变化时使用新 key，但先重新读取状态。

若返回 `uncertain_prior_execution`：

1. 不换 key 盲重试。
2. 重新读取状态。
3. 对账 Task、Run、Dispatch、Git、OpenSpec 和幂等回执。
4. 仅在状态明确给出恢复动作时使用 `riskflow_reconcile`。

## Agent 事件循环

1. `riskflow_status` 取得队首和 revision。
2. 对 `nextAction` 做最小合法动作，通常是 `riskflow_dispatch`。
3. 使用 `riskflow_wait` 等待最多 60 秒；处理完整批次后，下一次 wait 携带其 `ackDeliveryId`。
4. `question`：有界回答后 `riskflow_reply`。
5. `escalation`：能在已批准范围内回答则 reply；否则向用户升级。
6. `worker_done`：审阅交付、diff、HEAD、verification 和证据。
7. 审阅通过后 `riskflow_settle`。
8. 若 `auditRequired` 为真，以新的独立 session 只派发一次 Targeted Auditor。
9. Auditor 在自己的活动 Task 内修复已批准范围的普通 finding、回归并更新 verification。
10. Auditor 无法在当前 Task 内闭合时升级给用户；不复用 Finalizer 会话，不派新的 Finalizer 或第二次审计。
11. 节点进入 integrating 后调用 `riskflow_integrate`，每步后重读状态。

Agent 活动期间，除明确的 `question`、`escalation`、进程或连接故障、用户指令外，不追加终端输入，不停止 Agent，不释放 Dispatch；正常推进只使用事件等待。

## OpenSpec 边界

创建 change 时显式选择 schema。
之后以 change 的 `.openspec.yaml`、`openspec status --change <name> --json` 和 instructions 返回值为准。
不要从 CLI 默认值或其他 change 推断 schema。

Planning 只闭合实际 `applyRequires`。
OpenSpec 提前显示 verification `ready` 或 all done，不代表可以提前创建 verification 或归档。
Implementation 完整读取 apply instructions 的全部 `contextFiles`。
Finalizer 对最终 HEAD 完成 verification；归档前确认工件为 done。

## Git 与 worktree 边界

Agent 之间只通过已审阅 Git 检查点交接，不传递未提交文件。
正常流程禁止直接执行：

- Orca Task、Dispatch、Run、reply、terminal close 写命令；
- Orca worktree create/rm；
- `git merge`、`git commit`、`git rebase`、`git cherry-pick`；
- `openspec archive`；
- `git clean`、手工删 worktree 目录或按 display name 猜目标。

只有控制器故障且用户明确批准 break-glass 时才手工恢复。
break-glass 后立即运行 status/check 对账，并回到受控工具。

## Stale 与回收

`stale` 不等于可以强删。
调用 cleanup 前确认状态所示事实包括：

- change 已归档；
- main 验证通过；
- feature commit 已进入 main；
- worktree 存在且 clean；
- checkpoint 已成功 settled；
- 无违规；
- 仅有状态记录的终态 terminal 残留，或节点已是 `reclaimable`。

满足条件后调用 `riskflow_integrate`。
控制器负责精确关闭 terminal、重验和完整 ID 回收。
若存在未知改动、活动 writer、未归档产物、身份变化或新违规，停止并报告实时证据。
不要使用 force。

## 完成判定

单个工作项完成需同时满足：

- 规划前置闭合；
- 实现和收尾完成；
- verification 与最终 HEAD 匹配；
- 必要审计完成；
- main 门禁通过；
- OpenSpec 已归档；
- worktree 已回收或状态明确为可回收。

整个授权目标完成还要求：

- 范围内所有工作项都完成；
- `violations` 为空；
- 没有遗漏的合法集成或 cleanup 动作。

用户暂停、真实外部阻塞或预算耗尽时如实进入 paused/blocked。
困难、耗时、普通测试失败或一次 wait 超时都不是阻塞理由。
