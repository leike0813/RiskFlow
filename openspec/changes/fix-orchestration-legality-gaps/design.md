# Design

## Context

- 状态视图 `deriveSnapshot` 对每个 `status ∈ {stale, reclaimable}` 的节点追加 `{ code: "worktree_reclaim_pending" }`（`scripts/orchestration/status.mjs`）；它同时是「该工作项还有工作树待回收」的唯一标记。
- `riskflowIntegrate` 的 stale 分支用 `safelySettled` 判定是否允许关闭终态 terminal，其中包含 `ctx.snapshot.violations.length === 0`；preflight 对该动作另有豁免（`action === "integrate" && cleanup && violation.code === "worktree_reclaim_pending"`），两处判定不一致。
- `currentTaskWindow` 判定 replan 边界时要求被取代尝试组存在 `phaseRank ≥ finalizing` 的有效任务；`preflightAction` 对 `replanApprovalRef` 只要求 `node.status ∈ {finalizing, paused}`。C20 的规划范围变更正是「`paused` + 已收口的 planning 尝试」，两处判定互相矛盾。
- 实测证据：C20 的 cleanup 以 `cleanup_not_safe` 失败（唯一违规即自身的 `worktree_reclaim_pending`）；C20 的 replan 派发成功后状态报 `invalid_replan_boundary`，全局阻断受控写。

## Goals / Non-Goals

**Goals:**

- 让规格描述的回收与重开规划在真实状态下可达，不再依赖 break-glass。
- 把「谁能被取代」和「什么阻断回收」做成单一事实源，供状态视图与派发前置校验共用。

**Non-Goals:**

- 不放宽任何合规前提：归档、主线验证、工作树 clean、尝试成功收口、关闭后重读为 `reclaimable` 一律保留。
- 不改变 `auditPolicy`、尝试组编号、活动写者判定、阶段顺序或 Orca 契约；不新增状态输出字段。
- 不允许在无批准引用的情况下重开规划，也不允许取代仍在活动或已成功收口的 planning/implementing 尝试。

## Decisions

### D-01：回收就绪标记不构成阻断违规

cleanup 的阻断违规集合 = 全局违规集合减去全部 `worktree_reclaim_pending` 条目。理由：这些标记由状态视图对 `stale`/`reclaimable` 派生，语义是「待回收」；任一工作项待回收都不应阻断另一个工作项的受控动作。目标工作项自身的合规前提与「关闭 terminal 后重读仍为 `reclaimable` 且完整 worktree ID 未变」的校验保持不变，因此仍 fail-closed。

替代方案（在状态视图里不再派生该违规）被否决：它是操作者与协调端识别待回收工作项的主要信号，且 `reconcile` 的安全集合与 integrate 的豁免都依赖它。

### D-02：可被重开规划取代的尝试

导出谓词 `supersedableAttempt(checkpoint, phaseOrder)`，成立条件为：

1. 该尝试的阶段排名 ≥ `finalizing`（保留既有例外，覆盖仍活动或已成功的 finalizing 尝试）；或
2. 阶段排名低于 `finalizing`，且该尝试 `runState === "settled"` 且结局属于 `paused`、`failed`、`blocked`。

同一被取代尝试组以最高尝试次数为准，不能因组内较早尝试可被取代就覆盖当前尝试。较早阶段仍在活动（`queued`/`running`/`waiting`）或结局为 `succeeded` 的尝试 MUST NOT 被取代。已成功收口且尚未集成的 finalizing 尝试仍可在重新批准后重开规划。

### D-03：状态视图与前置校验共用同一谓词

`status.mjs` 导出该谓词；`currentTaskWindow` 用它判定边界有效性，`preflightAction` 在 `replanApprovalRef` 分支用它判定「当前尝试是否可被取代」。这样「允许重开」与「边界有效」不可能再各自演化出矛盾规则。

### D-04：文档同步

`RUNBOOK` §9（回收前提）与 `HANDBOOK` §7（状态机与责任移交）补一句：回收判定只看该工作项自身的合规事实与回收就绪标记；重开规划边界的被取代尝试按 D-02 判定。文档只复述已批准语义，不新增规则。

## Risks / Trade-offs

- **[放宽后误删工作树]** → 只排除该工作项自身的回收就绪标记，其他违规（重复写者、身份冲突、checkpoint 漂移等）仍阻断；关闭 terminal 后的 reclaimable 重读校验保留。
- **[重开规划被滥用为重置手段]** → planning/implementing 只允许取代已收口且非成功的当前尝试；finalizing 例外仍要求非空批准引用。

## Migration Plan

状态与派发共用新谓词后，历史节点无需迁移：既有 `invalid_replan_boundary`（如 C20 的 break-glass 台账）已不再产生；新判定只放宽「可被取代」的集合，不改变边界之前的尝试作废语义。
