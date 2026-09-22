# 验收记录：fix-dispatch-input-failure-recovery

> 当前 change 的实际 schema 为 `spec-driven`，OpenSpec 仅声明 proposal、specs、design、tasks；本文件是 Finalizer 与本轮唯一限定审计共用的补充记录，不是 OpenSpec CLI 工件。

## 产物与结论

- Finalizer 输入 Git HEAD：`07d1a599ae91be781c490090dad2e8a77dc2f625`；Finalizer 检查点暨限定审计输入 HEAD：`6cd38717a0fe9c0b77188d1079c973ad675f0843`。
- 限定审计后工作树 HEAD 仍为 `6cd38717a0fe9c0b77188d1079c973ad675f0843`；审计修复未提交，最终产物 HEAD 由主调度审阅 dirty paths 并形成检查点后填写。
- 最终结论：PASS。已批准 drift 范围内的实现、负向边界和回归均通过；无新增依赖、迁移、权限、事务或持久化变化。

## 完整性、正确性与一致性

| 维度 | 结论 | 证据 |
| --- | --- | --- |
| 完整性 | PASS | `tasks.md` 8/8 完成；1 项 modified requirement 的 5 个场景均有实现与回归 |
| 正确性 | PASS | 结构化重放、信任归类、同 Task/terminal 恢复、有界 OpenSpec 缺失豁免及恢复严格失败闭合均通过 |
| 一致性 | PASS | 使用现有 retry-request、尝试台账与 `issueRefs`；未增加状态存储、依赖或第二套恢复路径 |

## 场景证据

- **信任提示归类**：`control.test.mjs` 模拟 `worker-start` 首次失败，再以完全相同的 retry-request 重放；重放仍退出失败，但 JSON 给出 `stage=dispatch_input`、`lastError=agent_prompt_blocked`。控制器返回 `workspace_trust_required`、精确 terminal handle 和“尚未生成 failed attempt”。
- **Task 保持 queued**：同一测试读取控制器自持台账，确认 `runState=queued` 且只写入 `workspace_trust_required:dispatch_input` 恢复原因；阶段不是 `dispatch_input` 时保留原错误并失败闭合。
- **复用同一 Run/Task/terminal**：确认信任后的第二次派发继续使用 `run-finalizer`、`task-finalizer` 与 `term-codex`，累计只创建一个 terminal、零个新 Run/Task；worker-start 的第三次调用成功，台账进入 running。
- **`task_missing_local_openspec` 有界恢复**：`status.test.mjs` 证明 queued + 精确恢复原因 + 无 live/ready/succeeded worker 时不产生该 violation，状态进入可派发队列；信封进入 running 且 worker ready 后，缺少本地 change 重新产生 `task_missing_local_openspec` 并投影为 unknown。
- **禁止错误 reconcile**：`control.test.mjs` 真正执行恢复 dispatch 并验证同一 Run/Task/terminal；带精确信任恢复标记的 queued 尝试会拒绝 reconcile，避免一般 reconcile 语义创建替代 Run/Task。

## 实际验证命令

- `pnpm exec vitest run scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs`：2 个文件、98 项测试通过。
- `pnpm exec eslint scripts/orchestration/control.mjs scripts/orchestration/status.mjs scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs`：通过，无输出。
- `pnpm exec prettier --check scripts/orchestration/control.mjs scripts/orchestration/status.mjs scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs openspec/changes/fix-dispatch-input-failure-recovery`：通过。
- `pnpm exec tsc -b`：通过，退出码 0，无输出。
- `openspec validate fix-dispatch-input-failure-recovery --strict --no-interactive`：valid。
- `pnpm orchestration:check`：通过，无状态违规；AUX change 保持当前 finalizing Task。
- `git diff --check`：通过。
- `openspec instructions verification --change fix-dispatch-input-failure-recovery --json`：按 `spec-driven` 实际 schema 返回 `verification` 工件不存在，符合本文件作为补充核验记录的约定。

## 限定审计结论

- 状态：PASS，本轮唯一 Targeted Auditor 已完成。
- 发现并修复一项范围内普通缺陷：状态视图虽已把信任阻塞投影为可恢复 queued 尝试，但 `preflightAction` 仍允许调用一般 `riskflow_reconcile`，后者会无条件创建第二个 Run/Task，违反同一尝试复用约束。修复后该精确恢复标记只允许携带原 terminal handle 重新 dispatch；其他真实失败的 reconcile 语义保持不变。
- 审计覆盖关键状态机及语义一致性；未发现权限、事务、持久化、迁移、依赖或 merge 冲突问题。

## 剩余事项

- 主调度审阅全部 dirty paths 并形成 Git 检查点；禁止由本 Task 提交、合并或归档。
- 若触发限定审计，Auditor 必须在自己的活动 Task 内闭合普通 finding 并更新本文件；不得派发第二次审计或新的 Finalizer。
