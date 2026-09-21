# Tasks

## 1. 状态视图：可被取代尝试的判定

- [x] 1.1 `status.mjs` 导出 `supersedableAttempt(checkpoint, phaseOrder)`，成立条件为「阶段排名 ≥ `finalizing`」或「`runState === "settled"` 且结局属于 `paused`/`failed`/`blocked`」
- [x] 1.2 `currentTaskWindow` 的获批边界判定改用该谓词，替换原先硬编码的 `phaseRank ≥ finalizing`
- [x] 1.3 `status.test.mjs`：已收口为 `paused` 的 planning 与仍活动的 finalizing 尝试可被取代；较早阶段当前尝试仍活动或结局为 `succeeded` 时仍报 `invalid_replan_boundary`

## 2. 受控回收：阻断违规按目标工作项自身判定

- [x] 2.1 `control.mjs` 的 `safelySettled` 排除所有工作项的 `worktree_reclaim_pending`，目标工作项自身合规前提不变
- [x] 2.2 `control.test.mjs`：只含回收就绪标记时仍能关闭终态 terminal 并按完整 ID 回收；出现其他违规时仍拒绝

## 3. 派发前置校验复用同一谓词

- [x] 3.1 `control.mjs` 的 `preflightAction` 在 `replanApprovalRef` 分支改用 `supersedableAttempt(node.checkpoints)`
- [x] 3.2 `control.test.mjs`：较早阶段当前尝试不可被取代（活动或已成功收口）时 `riskflow_dispatch` 以 `replan_not_allowed` 拒绝；finalized 尝试保留获批重开入口

## 4. 文档

- [x] 4.1 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §9 写明：回收判定只看目标工作项自身合规事实与回收就绪标记
- [x] 4.2 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §3 写明：finalizing 尝试可按批准重开；较早阶段只允许取代已收口且非成功的尝试

## 5. 验证

- [x] 5.1 运行 `pnpm exec vitest run scripts/orchestration`，全部通过
- [x] 5.2 运行 `pnpm exec tsc -b`、`pnpm exec eslint scripts/orchestration`、`pnpm exec prettier --check scripts/orchestration openspec/changes/fix-orchestration-legality-gaps`，无错误
- [x] 5.3 运行 `openspec validate fix-orchestration-legality-gaps --strict --no-interactive`，valid
