# Proposal：修复工作区信任阻断后的状态推导与恢复路径

## 问题

新建工作树的首次派发会让 Codex 停在「Trust this folder?」确认上。此时：

1. `worker-start` 失败但**未被识别为信任失败**（`WORKSPACE_TRUST_PATTERN` 只匹配 `agent_prompt_blocked|workspace trust`，实际失败文本是 `agent_prompt_stalled`），因此控制器没有走 `workspace_trust_required` 恢复流程，也没有写入 `recordWorkspaceTrustRecovery`。
2. 派发已经创建了 Task，但规划者尚未创建本地 change，于是状态视图判出 `task_missing_local_openspec` 违规，工作项落成 `status=unknown`，并给出「审阅 violations，禁止自动派发或回收」——**没有任何受控恢复动作可用**。
3. 协调端随后只能 `reconcile` 生成替代尝试，而 `nextTaskKind()` 对 `unknown/untracked` 一律回退 `finalization`（该回退本是给「已采纳的 auxiliary 工作树」用的），导致一个**从未完成规划**的工作项被派成 Finalizer，实测发生两次（C30）。

## 变更

1. **信任失败归因**（`control.mjs`）：`worker-start` 与 `tui-idle` 等待失败时，除失败文本外再读一次该 terminal 的屏幕，命中信任提示即按 `workspace_trust_required` 收口，并记录 `recordWorkspaceTrustRecovery`，使状态视图能识别恢复中的工作项。
2. **违规判定**（`status.mjs`）：规划尝试尚未成功时，本地 change 正由该尝试负责创建，`task_missing_local_openspec` 不得判为冲突。
3. **角色推导**（`control.mjs`）：当前尝试是未成功的 planning（失败、排队未启动或被信任确认阻断）时，下一角色仍是 planning；`finalization` 回退只保留给已采纳的 auxiliary 工作树。

## 影响

- 不改变正常路径语义：成功规划后仍按原规则进入实现/收尾；已采纳 auxiliary 工作树仍走 Finalizer。
- 恢复路径由「无可用动作的 unknown」变为「重新派发规划（可携带同一 terminalHandle）」。
