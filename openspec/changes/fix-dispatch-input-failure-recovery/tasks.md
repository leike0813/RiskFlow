# Tasks

## 1. 结构化失败归因

- [x] 1.1 [D-01] 解析失败命令输出并以同一 retry-request 重放 `worker-start`，验证 `dispatch_input` + 信任提示返回 `workspace_trust_required`
- [x] 1.2 [D-02] 将输入阶段信任恢复原因写入现有 queued 尝试信封，验证不生成新的失败尝试
- [x] 1.3 [D-01, D-02] 扩展 `control.test.mjs`，验证确认信任后复用同一 Task/terminal，且不创建第二个 Task 或 terminal

## 2. 有界状态恢复

- [x] 2.1 [D-03] 仅对 queued、带精确恢复标记且无 live/ready/succeeded worker 的当前尝试忽略 `task_missing_local_openspec`
- [x] 2.2 [D-03] 扩展状态与控制器回归，验证同一 Run/Task/terminal 的恢复派发可达、reconcile 不创建替代尝试，且 worker 接受输入后缺少本地 change 仍失败闭合

## 3. 验证

- [x] 3.1 运行 `pnpm exec vitest run scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs`，全部通过
- [x] 3.2 运行 `pnpm orchestration:check`、相关 lint/format、`git diff --check` 与 `openspec validate fix-dispatch-input-failure-recovery --strict --no-interactive`
- [x] 3.3 写入独立 `verification.md`，记录输入 HEAD、实际命令、输出摘要、四项恢复证据与剩余事项
