# Verification Report: fix-orchestration-legality-gaps

验证对象：`fix-orchestration-legality-gaps`。实际 schema 为 `spec-driven`，只声明 proposal、specs、design、tasks；`openspec instructions verification --change fix-orchestration-legality-gaps --json` 返回 `Artifact 'verification' not found in schema 'spec-driven'`。本文件是收尾核验记录，不冒充 schema 工件。

输入与当前工作树 HEAD：`d45d9ed85006828ea48f5833cb69feb70bb49d31`。本报告核验该提交及本轮工作树修改；受控 settle 形成的最终 `outputHead` 由协调端写入 v2 信封，限定审计须在最终产物确定后核对并补记其 HEAD。

## Summary

| 维度 | 结果 |
| --- | --- |
| Completeness | PASS：12/12 tasks；3 项 delta requirements、17 个 scenarios 已核对 |
| Correctness | PASS（Finalizer）：回收就绪标记、重开规划边界、前置校验均有受影响路径回归证据 |
| Coherence | PASS（Finalizer）：状态与控制器共用 `supersedableAttempt`；规格、设计、任务及手册已按协调端裁定统一 |

## Finding 与处置

| Finding | 处置与证据 |
| --- | --- |
| `currentTaskWindow` 只要同组任意旧尝试可取代，就接受获批边界；较新 planning 尝试已成功时仍可能误放行 | 改为按被取代组最高尝试次数判定；`status.test.mjs` 覆盖先 paused、后 succeeded 的同组序列，并要求 `invalid_replan_boundary` |
| `finalized` 是已成功收口 finalization 的实际状态，但前置校验只允许 `finalizing` 或 `paused` | 在获批重开入口加入 `finalized`；`control.test.mjs` 覆盖已成功收口且尚未集成的 finalization |
| 原 delta 同时写了 finalizing 活动尝试可被取代、活动尝试一律不可被取代 | 协调端裁定保留 finalizing 例外；仅 planning/implementing 的活动或成功尝试不可被取代。已同步 proposal、design、两份 delta、tasks、Handbook，现有 finalizing ready 场景仍通过 |
| proposal、design 与 tasks 曾将回收标记豁免限定为目标工作项自身，与 delta 的跨工作项场景和实现不一致 | 已统一为所有 `worktree_reclaim_pending` 均只作待回收标记；目标工作项的归档、主线验证、clean、成功收口与重读身份校验仍保留 |
| stale cleanup 的就绪标记曾阻断受控回收 | 原实现按所有 `worktree_reclaim_pending` 只作就绪标记；回归确认只含该标记时关闭精确 terminal、重读为 reclaimable 后按完整 ID 回收，其他违规仍阻断 |

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration` | PASS：2 files / 93 tests；本轮修改后的回归 |
| `pnpm exec tsc -b` | PASS |
| `pnpm exec eslint scripts/orchestration` | PASS |
| `pnpm exec prettier --check scripts/orchestration openspec/changes/fix-orchestration-legality-gaps IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` | PASS |
| `openspec validate fix-orchestration-legality-gaps --strict --no-interactive` | PASS：valid |
| `pnpm orchestration:doctor` | PASS：Orca ready，七个受控工具可见 |
| `pnpm orchestration:check` | PASS：当前状态无违规；该 AUX 工作项处于 finalizing |
| `git diff --check` | PASS |

## 限定审计

本轮修改涉及关键状态机。协调端须在最终检查点形成后派发本收尾轮次唯一一次 Targeted Auditor，复核 `currentTaskWindow` 的最新尝试选择、`finalized` 重开入口、回收前置校验与实际状态投影。Auditor 在本节补入最终 HEAD、发现及任务内修复、受影响回归的实际命令和 PASS/FAIL/BLOCKED 结论；审计完成前不得集成。

审计结论：待 Targeted Auditor 填写。

## Final Assessment

**BLOCKED（待限定审计）**。Finalizer 已完成已批准范围内的修复和回归；最终集成结论须以本轮限定审计补写后的结果为准。
