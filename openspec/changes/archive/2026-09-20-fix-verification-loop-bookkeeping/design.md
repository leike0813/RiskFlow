# Design

## Context

- `deriveNodeState` 的失败分支：`summary.failed && ["verification", "finalization"].includes(currentKind)` → `finalizing`；否则落到 `failed`。
- `nextTaskKind` 的合法组合只有：`adopt`/`untracked` → finalization；`ready` → planning；`finalizing` → audit 或 finalization；阶段 `planning`/`implementing` → implementation；其余抛错。
- `riskflowDispatch` 在派发前调用 `recordAttempt(..., "queued")`；`startWorker` 的 `worker-start` 分支随后登记 `running`，而实现分支（`terminal create` + `orchestration dispatch --inject`）此前没有这一步。

## Goals / Non-Goals

**Goals:**

- 审计失败后能派发修复，闭环不断。
- 所有派发路径的台账状态与真实运行状态一致。

**Non-Goals:**

- 不改变"审计未通过不得集成"的约束（仍由集成前的前置校验与 verification 工件承担）。
- 不改变 `running`/`queued` 之外的台账状态语义。
- 不改变实现分支的启动方式或 Orca 契约。

## Decisions

**D1：把 audit 纳入"保持收尾责任"的失败分支，而不是给 `failed` 增加后续角色。**
责任归属本来就属于收尾：规格写明审计发现的普通缺陷由当前 Finalizer 修复。让失败态变回可派发的 `finalizing`，比在 `nextTaskKind` 里为 `failed` 增加特例更贴合"失败不改变责任角色"的既有语义。

**D2：运行态登记放在实现分支的注入成功之后。**
注入被接受才意味着 worker 已接管；过早登记会在启动失败时留下"运行中"的假象。登记失败按既有约定只告警，不改变已经发生的派发。

## Risks / Trade-offs

- 失败分支放宽后，审计失败的节点不再报告 `failed`；运维视角的失败事实仍由尝试信封的 `outcome: failed` 与证据保留，不影响可追溯性。
- 实现分支多一次台账写入；与既有 `worker-start` 分支同量级。
