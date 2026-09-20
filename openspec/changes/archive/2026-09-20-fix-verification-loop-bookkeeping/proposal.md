# Proposal

## Why

收尾闭环有两个记账缺口，都会让"下一步做什么"失真：

1. **审计未通过后没有修复路径。** 限定审计发现普通实现缺陷时，规格要求"由当前 Finalizer 在已批准范围内修复并重跑受影响验证"。但 `deriveNodeState` 把失败尝试保持收尾责任的分支写死为 `["verification", "finalization"]`，不含 `audit`；于是审计以 `failed` 收口后节点变为 `failed`，而 `nextTaskKind` 对 `failed` + finalizing 阶段的组合没有合法角色，直接抛 `没有合法的下一任务角色`——修复无法派发，闭环断在审计之后。

2. **实现派发没有登记运行态。** `riskflowDispatch` 在派发前登记 `queued`，只有 `worker-start` 分支（planning/finalization/audit）会把台账推进到 `running`；实现走的是 `terminal create` + `orchestration dispatch --inject`，因此整段实现期间状态视图仍报告 `runState: queued` 并给出"派发当前信封指定的受控任务"的下一动作——而 worker 已在运行，照做会启动第二个实现 worker。

实测：C26 的限定审计已把权限阻断写入 `verification.md` 并要求先修复；C17 的实现 worker 运行期间状态视图一直声称该尝试待派发。

## What Changes

- 失败尝试保持收尾责任的分支承认 `audit`：审计未通过时节点保持 `finalizing`，下一动作是"由强模型 Finalizer 继续修复与回归"，`nextTaskKind` 因而能派发同一收尾组的修复尝试。
- 实现分支在注入成功后同样登记运行态台账，使状态视图与真实派发一致。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: 审计未通过必须保持收尾责任。
- `operations/orchestration-controlled-actions`: 任意角色的派发都必须登记运行态。

## Impact

- 代码：`scripts/orchestration/status.mjs`（失败分支）、`scripts/orchestration/control.mjs`（`startWorker` 的实现分支）、两个测试文件。
- 规格：两个 main spec 的 delta。
- 不新增依赖；不改变阶段顺序、尝试组边界、活动写者判定或 Orca 契约。
