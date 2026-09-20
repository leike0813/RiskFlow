# Design

## Context

- `controlledMutation` 在 `withRuntimeLock` 内完成「读状态 → 前置校验 → 写 inflight 回执 → perform → 写完成回执」。
- `withRuntimeLock` 的等待窗口是 25 次 × 40 ms ≈ 1 秒，之后抛 `control_busy`；`removeStaleLock` 只在持有者进程已死或锁龄超过 120 秒时回收。因此持锁者执行的任何长命令都会让其他受控操作直接失败，而不是排队。
- `riskflowIntegrate` 的主线复验步骤在锁内执行 `pnpm verify`，超时上限 30 分钟。
- `resolveOrcaInvocation`（`status.mjs`）以 ambient `ORCA_CLI_COMMAND` / `ORCA_TERMINAL_HANDLE` 为默认值，决定 CLI 是 `orca-ide` 还是 `orca`；`defaultExec` 不覆写子进程环境，于是协调终端的身份会传播到 `pnpm verify` 及其中的编排测试。
- 编排测试的假 exec 以 `command === "orca-ide"` 识别调用；当 ambient 身份存在时该假设失效，8 个用例报 `unexpected command`。

## Goals / Non-Goals

**Goals:**

- 长外部步骤不再长时间占用运行时锁；其余受控操作在其执行期间仍可提交。
- 解锁期间事实变化时 fail-closed，绝不用陈旧事实写入状态。
- 外部验证步骤的环境与发起终端解耦，使验证结论可重复。
- 编排测试不依赖调用方环境。

**Non-Goals:**

- 不放宽短操作的持锁范围：派发/收口/对账在 Orca 上产生副作用，必须全程持锁。
- 不改变幂等键、回执语义、`expectedRevision` 的定义或 Orca 契约。
- 不引入通用的进程环境管理框架，只剥离与编排身份相关的变量。

## Decisions

**D1：把「让出」做成锁的显式原语，而不是把长步骤整体移出受控流程。**
长步骤仍属于该次幂等操作（它的结果要写进同一回执与信封），只是不占用互斥资源。以 `lock.withoutLock(step)` 表达这一意图，调用点无法"忘记"重新取锁——重新取锁在 `finally` 中完成。

**D2：重新取锁后以起始 `expectedRevision` 重新校验事实集。**
`expectedRevision` 已经是整个事实集的哈希，用它做乐观并发校验既不需要新增字段，也与既有 `stale_revision` 语义一致。事实集在解锁期间变化即拒绝写入。

**D3：重新取锁使用更长的等待预算。**
初次获取保持 1 秒 fail-fast（让调用方快速失败而不是排在长操作后面）；长步骤结束后的重新获取使用约 60 秒预算，因为此时我们已经完成工作、应当尽量提交而不是丢弃结果；仍取不到则以既有不确定语义收场（回执保持 inflight）。

**D4：环境剥离放在长步骤的调用点，而不是改 `resolveOrcaInvocation` 的默认行为。**
ambient 默认值是生产语义的一部分（协调终端身份就是这样发现的）；需要隔离的是「外部命令不应继承协调者身份」这一具体事实。剥离 `ORCA_TERMINAL_HANDLE` 与 `ORCA_CLI_COMMAND` 由 `defaultExec` 透传 `env` 支持。

**D5：测试自行界定环境。**
编排测试在模块加载时清除 ambient 编排身份、结束后还原，使同一批用例在干净 shell 与 Orca 终端中结论一致。这属于测试的可重复性，不改产品行为。

## Risks / Trade-offs

- 让出锁会短暂失去「事实不变」的保证；用重新校验把它变成显式失败而不是静默错误。
- 若长步骤恰好在事实已变化后又失败，回执按既有规则保持 inflight，需要一次显式对账；这与今天的行为一致。
- 重新获取锁的 60 秒预算在极端并发下仍可能超时；此时操作失败且不写入状态，符合 fail-closed。
- 剥离 `ORCA_CLI_COMMAND` 后，若某项目的验证命令确实依赖该变量自定义 CLI，则需要在调用点显式传入；当前仓库无此用法。
