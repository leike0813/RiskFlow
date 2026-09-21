# Verification Report: fix-orchestration-recovery-skill

验证对象：`fix-orchestration-recovery-skill`

实际 schema：`spec-driven`。该 schema 只声明 proposal、specs、design、tasks；`openspec instructions verification --change fix-orchestration-recovery-skill --json` 返回 `Artifact 'verification' not found in schema 'spec-driven'`。本文件是任务要求的补充最终核验报告，不冒充 schema 工件状态。

输入与当前 Git HEAD：`7f9fc97299c2ade6846e49374f64c899268ca6c2`。当前产物为该 HEAD 加本 change 的未提交实现、下述 Finalizer 修复和本报告；协调端仍需审阅并形成 Git 检查点。

## Summary

| 维度 | 结果 |
| --- | --- |
| Completeness | 15/15 tasks；8/8 Requirements；16/16 Scenarios 均有实现与回归证据 |
| Correctness | 七工具注册、受控回复、Delivery ack、Codex 信任恢复、reconcile 安全集合、stale cleanup、状态投影与项目 Skill 均通过定向验证；Finalizer 共关闭 3 项缺陷 |
| Coherence | D1～D8、Non-Goals、既有控制层边界及单文件 Skill 设计保持一致；未引入依赖、执行图、业务模块或新状态存储 |

## Requirement 与场景证据

| 规格范围 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 七个受控工具具有单一完整清单 | `scripts/orchestration/control.mjs:32` 导出唯一清单；`scripts/orchestration/omp-extension.mjs:14` 复用并注册；doctor 复用同一清单检查扩展 | doctor 输出七个工具；`control.test.mjs` 校验清单与冷启动摘要；OMP smoke 通过 |
| 当前 Run 的受控回复 | `scripts/orchestration/control.mjs:198` 关闭 settled/missing Run；`:1150` 复用 revision、幂等回执和 `--run` 绑定 | 成功只发送一次、重复请求重放既有结果、settled 尝试拒绝的控制器测试通过 |
| wait 确认已处理 Delivery | `riskflow_wait` 接受可选 `ackDeliveryId`，并在同一次 `orchestration check` 中先传 `--ack` 再 `--wait`；Skill 与 Runbook 规定处理完整批次后才确认 | 回归先复现缺少 ack 时连续返回 `msg-same`，修复后第二次 wait 返回 `msg-next` |
| Codex worker 只在工作区信任完成后启动 | Planning、Finalizer、Targeted Auditor 统一由 `startWorker` 创建 terminal、等待 `tui-idle`，再以 `worker-start --terminal` 绑定；提示阻塞时返回精确 handle，同 Task/terminal 可重入 | 回归证明信任提示时 worker-start 为 0；确认后只创建 1 个 terminal，并以同 handle 启动当前 queued Task |
| reconcile 只豁免安全漂移 | `scripts/orchestration/control.mjs:106` 仅放行 `checkpoint_mismatch`、`worktree_reclaim_pending` | 同时存在安全漂移可恢复；目标节点 duplicate writer 仍 fail-closed |
| stale terminal 重验后回收 | `scripts/orchestration/control.mjs:1340` 校验 archive/main verify/clean/succeeded/no violations，关闭精确 handle 后重读并要求同一 worktree 变为 reclaimable | 成功路径验证精确 handles 与完整 worktree ID；脏树前提失败时零 terminal close；无 `--force` |
| 冷启动与阻塞恢复状态 | `scripts/orchestration/omp-extension.mjs:16` 区分 resumeQueue、violations、stale、diagnostics；`scripts/orchestration/status.mjs:924` 防止 dirty auxiliary 被 ancestry 误判；`:949` 识别当前 worker/dispatch 失败 | diagnostics 非阻断、stale cleanup、dirty auxiliary adopt、失败派发 reconcile 场景通过 |
| 项目级 RiskFlow Skill | `.agents/skills/riskflow-orchestration/SKILL.md` 内联冷启动、状态分流、七工具、幂等、事件循环和收口边界；`.gitignore` 只豁免该目录 | Skill quick validation 通过；其他 `.agents/skills/*` 仍被忽略，目标 Skill 可追踪 |

## Finalizer 修复与同轮限定审计

初审发现 D5 的失败恢复存在一个边界：当前派发若表现为 `dispatchStatus=failed`、`workerState=unsupervised`，状态层不会识别失败；同时 feature HEAD 已是 main 祖先时，merge 投影先于失败 checkpoint 生效，可能绕过 `riskflow_reconcile`。

修复位于共享状态投影：当前 task 的 worker 或 dispatch 任一失败都视为失败，并在未 settled 时优先于未归档的 merge 状态返回受控 reconcile。现有回归用例被强化为 `dispatchStatus=failed + ancestry=true`，旧实现会失败，修复后通过；没有改变公共 schema、持久化、权限、依赖或执行图。

本轮唯一一次限定审计通过 Run 消息 `msg_878101d2d4d0` 回灌。审计比对 Git 历史后确认：`6aab917` 已规定 Codex 首次启动先创建 terminal、确认工作区信任、再执行 worker-start；`62485be` 引入当前控制器时把 Planning/Finalizer/Audit 改回直接 `worker-start --agent codex`，`03303c1` 只恢复了 Runbook 文字，导致首次派发遇到 `agent_prompt_blocked` 时 Task 被错误标为 failed。用户同时补充 `riskflow_wait` 未确认上一批 Delivery，造成相同消息重复重放。

两项均在共享控制入口作最小修复：Codex 三类角色在 worker-start 前完成 terminal 预热，信任提示保留 queued Task，并以新幂等键、同一 `terminalHandle` 恢复；wait 以可选 `ackDeliveryId` 原样映射 Orca `check --ack`，不增加本地游标或提前确认。定向测试先在旧行为下得到 2 个失败，再在修复后得到 2 个通过；完整调度回归为 86/86。该审计结论为 PASS，finding 已在同一收尾轮次关闭，不请求第二次审计。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/control.test.mjs -t "acknowledges the prior Delivery\|stops before worker-start"` | RED：修复前 2 failed / 47 skipped；GREEN：修复后 2 passed / 47 skipped |
| `pnpm exec vitest run scripts/orchestration/` | PASS：2 files / 86 tests（审计修复后完整回归） |
| `pnpm exec vitest run scripts/orchestration/status.test.mjs` | PASS：1 file / 37 tests（Finalizer 修复后定向回归） |
| `pnpm exec prettier --check scripts/orchestration/ .agents/skills/riskflow-orchestration/SKILL.md IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md openspec/changes/fix-orchestration-recovery-skill/` | PASS |
| `pnpm exec eslint scripts/orchestration/` | PASS |
| `git diff --check` | PASS；修复后再次执行 |
| `pnpm exec openspec validate fix-orchestration-recovery-skill --strict --no-interactive` | PASS：change valid |
| `pnpm orchestration:doctor` | PASS：Orca ready，七个受控工具全部可见 |
| `pnpm orchestration:check` | PASS |
| `uv run --project="$HOME/.ar" --locked -- python /home/joshua/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/riskflow-orchestration` | PASS：`Skill is valid!` |
| `git check-ignore -v` 与 `git ls-files --others --exclude-standard` 定向检查 | PASS：目标 Skill 可追踪，其他 `.agents/skills/*` 保持忽略 |

## Issues by priority

### CRITICAL

无。D5 边界缺陷已修复并通过回归。

### WARNING

无。唯一一次限定审计的 finding 已修复并复验。

### SUGGESTION

无。

## 最终检查点限定审计

- 审计输入：Git HEAD `7f9fc97299c2ade6846e49374f64c899268ca6c2` 加当前未提交 change 产物；Run finding `msg_878101d2d4d0`。
- 审计结论：PASS；关键状态机的 2 项 finding 已在同一 Finalizer 会话关闭，permission、transaction、semantic-merge 未发现新增问题。
- Finding 与处置：Codex 信任提示发生在 worker-start 之后的问题改为 terminal 预热；Delivery 未 ack 的重复重放改为下一次 wait 显式确认上一批。
- 审计实际证据：`git show 6aab917`、`git show 62485be`、`git show 03303c1` 与 `orca orchestration check --all --json` 用于定位 drift；定向红绿测试及 86 项完整调度回归用于闭环。

## 剩余事项

- 协调端审阅全部 dirty paths，形成最终 feature 检查点并填写产物 HEAD。
- 本 worker 不提交、不合并、不归档、不回收 worktree。

## Final Assessment

Finalizer 核验、同轮限定审计修复和完整回归均通过，未留 CRITICAL/WARNING/SUGGESTION 产品 finding。产物可交协调端审阅并形成检查点，再进入集成门禁。
