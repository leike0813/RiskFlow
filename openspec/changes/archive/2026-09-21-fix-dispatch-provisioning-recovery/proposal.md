# Proposal

## Why

两条已被真实仓库证实的派发路径缺陷，使 `ready` 节点无法推进，`resumeQueue` 反复给出同一条不可完成的动作。

**缺陷一：工作树供给依赖一个可能永不返回的响应。**
`orca worktree create` 在 Orca 1.4.198 的当前运行实例上不再可靠：CLI 约 30 秒后以 `runtime_unavailable: The Orca runtime closed the connection before responding` 结束，而**外部副作用可能已经发生**。2026-09-21 实测：连续 6 次调用中，前 4 次把 worktree、分支与文件全部建立（`orca worktree list` 能看到、`git worktree list` 能看到、依赖安装完成），却从未返回身份；后 2 次连副作用也没有。控制器 `createWorktreeForReadyNode` 直接依赖该响应，因此 `ready` 节点永远拿不到工作树身份，派发在 `createTask` 之前中止，幂等回执停在 `inflight`，而状态视图继续要求"创建当前 change 的 feature worktree 和结构化 task"。

**缺陷二：复用已排队尝试时角色被重新推导。**
`riskflowDispatch` 在复用"已排队但尚未启动"的尝试时用 `nextTaskKind(node)` 推导角色。当该尝试是规划尝试（`taskKind=planning`）时，`nextTaskKind` 依 `node.phase === "planning"` 返回 `implementation`，于是**规划任务说明被交给实现模型**，尝试台账也记成实现尝试。结果是规划者永远无法按自己的角色启动，而收口后阶段会跳到 `finalizing`。C20 自 2026-09-14 起的三次 reconcile 规划尝试（attempt 1–3）从未被正确派发，正是这条路径；同一个不一致也让"主分支同步后重新规划"这条既定流程无法完成。

## What Changes

- 工作树供给改为"Orca 优先、控制器可自持"：Orca CLI 调用成功时保持现有行为不变；调用失败时，控制器以仓库公开元数据（`orca repo list --json` 的 `worktreeBasePath`、`worktreeBaseRef`、`hookSettings.scripts.setup`）在 Orca 同一布局下用 `git worktree` 建立工作树、执行仓库 setup 脚本，再从 `orca worktree list --json` 取回受管身份。取回身份前校验：仓库匹配、非主工作树、路径唯一、目录存在、HEAD 与请求的基线一致。
- 复用已排队尝试时，角色、阶段与任务说明一律取自该尝试自身的 `taskKind`；未知 `taskKind` 一律拒绝，不再用节点当前阶段重新推导。
- 运行手册补充该故障的可复用恢复步骤。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 工作树供给必须能在 Orca CLI 无法确认外部副作用时自持完成并校验身份；复用已排队尝试必须保持尝试自身的角色身份。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`createWorktreeForReadyNode`、`riskflowDispatch`）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 文档：`IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md`（事故恢复步骤），不含当前 frontier、HEAD、Run 或 Task 标识。
- 不新增依赖；不改变 Orca 成功路径、settle/integrate 语义、工作树回收路径与真实并发保护。
