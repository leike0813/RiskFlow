# Proposal

## Why

C20 收口时暴露了两个控制器合法性判定缺口，两者都是**规格已写的行为在实现里不可达**：

- **回收不可达**：`riskflow_integrate` 的 stale 分支要求「全局 violations 为空」才关闭终态 terminal 并回收，但状态视图对任何 `stale`/`reclaimable` 节点**必然**派发 `worktree_reclaim_pending`（`worktree_reclaim_pending` 正是回收触发标记本身）。于是受控回收在真实状态上永远失败，只能 break-glass 手工关 terminal 与删工作树；C14 等历史工作树残留即为同类结果。
- **重开规划边界自相矛盾**：`riskflow_dispatch` 的前置校验允许 `paused` 节点携带 `replanApprovalRef`，而状态视图的边界判定要求被取代尝试组阶段 ≥ `finalizing`。一个「已收口为 `paused` 的 planning 尝试」因此既被允许重开、又必然被判成 `invalid_replan_boundary`；该违规还是全局阻断，`reconcile` 也不适用（实测于 C20 规划范围变更）。

## What Changes

- **回收合法性按该工作项自身判定**：`worktree_reclaim_pending` 是各工作项的待回收就绪标记，不阻断受控动作；其余全部前提（已归档、主线验证通过、工作树 clean、当前尝试成功收口、关闭 terminal 后重读仍为 `reclaimable`、完整 worktree ID 未变）保持 fail-closed。
- **重开规划边界与被取代尝试的语义对齐**：被取代尝试组的当前尝试 MUST 满足「已进入 finalizing」或「较早阶段已收口且结局非成功（`paused`/`failed`/`blocked`）」之一；较早阶段仍在活动或已成功收口的尝试 MUST NOT 被取代。
- **单一事实源**：该谓词由状态视图导出，派发前置校验复用同一定义，避免 preflight 与 status 各自演化出互相矛盾的规则。
- **回归**：两个测试文件补代表性用例（多个回收标记不阻断 cleanup、paused planning 边界的接受与较早阶段运行中尝试的拒绝）。
- **文档**：`IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §9 与 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §3 写明上述判定，避免操作者再按旧措辞触发 break-glass。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`：回收前提排除待回收就绪标记；派发前置校验的重开规划条件复用状态视图的边界谓词。
- `operations/orchestration-execution-status`：获批重开规划边界可取代「已收口且非成功」的较早阶段尝试；finalizing 尝试保留原有例外。

## Impact

- 代码：`scripts/orchestration/status.mjs`、`scripts/orchestration/control.mjs` 及其测试文件。
- 文档：`IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §9、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §7。
- 规格：`operations/orchestration-controlled-actions` 与 `operations/orchestration-execution-status` 的 delta。
- 不新增依赖；不改变阶段顺序、尝试组编号、活动写者判定、Orca 契约或合规前提；状态输出字段不新增。
