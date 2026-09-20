# Proposal

## Why

受控操作把**整段外部命令**圈在运行时锁里，而锁的等待只有约 1 秒：一旦某个操作在执行长命令（集成第二步的 `pnpm verify` 最长 30 分钟），其余所有受控操作都会以 `control_busy` 立即失败——本轮实测中，C17 的收口就因为 AUX 正在跑主线复验而被拒绝。

同一条路径还有第二个缺陷：外部命令继承协调者环境。协调终端会设置 `ORCA_TERMINAL_HANDLE`，而 `resolveOrcaInvocation` 依据它把 CLI 从 `orca-ide` 切换为 `orca`；该变量经 `defaultExec` 泄漏进 `pnpm verify` 里的编排测试，使 8 个用例的假 exec 失配。**从 Orca 终端发起的主线复验因此必然失败**，集成闭环不可达（本轮 AUX 复验即如此失败）。

另外，编排测试套件本身依赖调用方环境：同一批用例在干净 shell 里通过、在 Orca 终端里失败，验证结论取决于谁在跑。

## What Changes

- 运行时锁提供受控的**让出**原语：长外部步骤在锁外执行，执行完重新取锁；重新取锁后 MUST 用该操作起始的 `expectedRevision` 重新校验事实集，变化则 fail-closed，不写入任何状态。
- 长外部步骤 MUST 在不继承协调者身份的环境下执行（剥离 `ORCA_TERMINAL_HANDLE`、`ORCA_CLI_COMMAND`），使验证结论与发起终端无关。
- 会产生编排副作用的短操作（派发、收口、对账）继续全程持锁，保持「同一 Git common dir 内并发状态操作串行提交」「两个调度器同时派发最多一个成功」的既有保证。
- 编排测试套件与调用方环境隔离：用例显式清除 ambient 编排身份并在结束后还原。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 长外部步骤的执行契约（锁让出、重新校验、环境隔离）。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`withRuntimeLock`、`controlledMutation`、`riskflowIntegrate` 的主线复验步骤）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变幂等键、回执语义或 Orca/Run/Task/Dispatch 契约；不改变短操作的持锁范围。
