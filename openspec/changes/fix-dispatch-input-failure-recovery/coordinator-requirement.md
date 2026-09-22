# 协调端要求：dispatch_input 阶段失败的受控恢复

> 本文件由主调度在派发前写入，是本次修复的范围与验收依据，不是 OpenSpec CLI 工件。

## 现象（2026-09-22 实时复现，两次连续命中）

1. 对 `ready` 节点首次 `riskflow_dispatch`（新工作树）时，Orca 已创建 worktree、terminal、Run 与 Task，但 Codex 首次进入该路径会停在「是否信任该目录」提示，`worker-start` 以 `stage=dispatch_input`、`lastError=agent_prompt_blocked` 结束。

2. **缺陷 A**：`riskflowDispatch` 把该失败原样冒泡为 `control_failure`，只回显命令行，未识别 `agent_prompt_blocked`，因此既不返回 `workspace_trust_required` 与精确 terminal handle，也没有阻止 queued Task 被标成 failed。这与已归档 `fix-orchestration-close-and-trust` 的 Requirement「Codex worker 只在工作区信任完成后启动」不一致。

   - 实证（C22）：`orca-ide orchestration worker-start --run run_28405f8e49ab --task task_c3332e63cc61 --worktree id:d4349f30-…::…/c22 --terminal term_06c4c697-…-dc1b94c450ed --from term_cd36c0ce-… --retry-request b65274857f21e134ae6804b22ddfe55aba4719d631be42a4c6acd10e81c814df --json` 返回 `{"state":"failed","stage":"dispatch_input","lastError":"agent_prompt_blocked","replayed":true}`；而 `riskflow_dispatch` 的返回只有 `command failed: orca orchestration worker-start …`，且该 Task 事后状态为 `failed`。
   - 实证（C28）：同一形态，`run_f53aaae4c889` / `task_28707174f138` / `term_49216f56-…`，`{"stage":"dispatch_input","lastError":"agent_prompt_blocked"}`。

3. **缺陷 B**：该失败后节点进入 `unknown`：`violations=[{code:"task_missing_local_openspec", nodeId:"C22"}]`，`preflightAction` 因此对所有动作（含 `reconcile`）抛出 `orchestration_conflict`，节点死锁。新工作树在规划任务真正运行前本来就没有本地 change 目录，这一瞬态状态不应阻断受控恢复。

   - 实证：修复前 `riskflow_status` 报 `C22: unknown … violations [{code:"task_missing_local_openspec"}]`；只有人工在 c22 工作树执行 `openspec new change deliver-risk-candidate-validation-merge-and-acceptance --schema orchestrated-delivery` 之后，状态才回到 `blocked`，随后的 `reconcile` + 携带 `terminalHandle` 的 `dispatch` 才成功。

## 要求

1. `worker-start`（以及 `tui-idle` 等待）失败时，控制器 MUST 通过同一 `--retry-request` 重放或解析结构化结果取回 `stage`/`lastError`；命中 `agent_prompt_blocked` 或工作区信任特征时 MUST 以 `workspace_trust_required` 返回精确 terminal handle 与「尚未生成 failed attempt」的事实，并 MUST NOT 把该 queued Task 标为失败。
2. 恢复 MUST 复用同一 Task 与 terminal：操作者在 terminal 确认信任后，以新幂等键、同一 `terminalHandle` 重新 dispatch，控制器确认 `tui-idle` 后调用 `worker-start --terminal`，MUST NOT 创建第二个 Task 或 terminal。
3. `task_missing_local_openspec` MUST NOT 阻断受控恢复：当同一工作项当前尝试的 worker 从未接受输入（`stage=dispatch_input`，无 live/ready/succeeded worker）时，该 violation 不得使 `reconcile` 与携带 `terminalHandle` 的重新 `dispatch` 不可达；一旦 worker 已接受输入或尝试已成功收口，缺少本地 change 仍 MUST 失败闭合。
4. 回归必须覆盖上述 1–3，且断言可观察行为（返回码、返回体字段、是否创建第二个 Task/terminal、是否仍失败闭合），不得只断言命令字符串。

## 禁止

- 不得自动修改全局 Codex 信任配置，不得代替人工确认信任。
- 不得放宽 `duplicate_active_worktree`、`unlinked_task_result`、`checkpoint_mismatch` 等既有失败闭合规则。
- 不得改动 `worker-start` 之外的 Orca 调用语义，不得新增依赖。

## 验证

- `pnpm exec vitest run scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs`
- `pnpm orchestration:check`
- 证据须包含：信任提示场景返回 `workspace_trust_required` 且 Task 仍为 queued；确认信任后复用同一 Task/terminal 派发成功；`task_missing_local_openspec` 不再使 `reconcile`/恢复派发不可达，而 worker 已接受输入后仍失败闭合。
