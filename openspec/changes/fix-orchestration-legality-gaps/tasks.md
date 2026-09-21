# Tasks

## 1. 状态视图：可被取代尝试的判定

- [x] 1.1 `status.mjs` 导出 `supersedableAttempt(checkpoint, phaseOrder)`，成立条件为「阶段排名 ≥ `finalizing`」或「`runState === "settled"` 且结局属于 `paused`/`failed`/`blocked`」
- [x] 1.2 `currentTaskWindow` 的获批边界判定改用该谓词，替换原先硬编码的 `phaseRank ≥ finalizing`
- [x] 1.3 `status.test.mjs`：已收口为 `paused` 的 planning 尝试被获批 planning 尝试取代时不再报 `invalid_replan_boundary`；被取代尝试仍在活动或结局为 `succeeded` 时仍报该违规

## 2. 受控回收：阻断违规按目标工作项自身判定

- [x] 2.1 `control.mjs` 的 `safelySettled` 改为按「全局违规减去目标工作项自身的 `worktree_reclaim_pending`」判定，其余前提不变
- [x] 2.2 `control.test.mjs`：唯一违规为自身回收就绪标记时仍能关闭终态 terminal 并按完整 ID 回收；出现其他违规时仍以 `cleanup_not_safe` 拒绝

## 3. 派发前置校验复用同一谓词

- [x] 3.1 `control.mjs` 的 `preflightAction` 在 `replanApprovalRef` 分支改用 `supersedableAttempt(node.checkpoints, phaseOrder)`
- [x] 3.2 `control.test.mjs`：当前尝试不可被取代（活动或已成功收口）时 `riskflow_dispatch` 以 `replan_not_allowed` 拒绝且不创建 planning v2 边界

## 4. 文档

- [x] 4.1 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §9 写明：回收判定只看目标工作项自身合规事实与回收就绪标记
- [x] 4.2 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §7 写明：重开规划边界可取代已收口且非成功的尝试，活动或已成功的尝试不可被取代

## 5. 验证

- [x] 5.1 运行 `pnpm exec vitest run scripts/orchestration`，全部通过
- [x] 5.2 运行 `pnpm exec tsc -b`、`pnpm exec eslint scripts/orchestration`、`pnpm exec prettier --check scripts/orchestration openspec/changes/fix-orchestration-legality-gaps`，无错误
- [x] 5.3 运行 `openspec validate fix-orchestration-legality-gaps --strict --no-interactive`，valid
