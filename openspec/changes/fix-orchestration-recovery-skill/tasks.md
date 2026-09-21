# Tasks

## 1. 受控工具与恢复边界

- [x] 1.1 按 D1 由控制器导出七个工具的单一清单，在 OMP 扩展注册 `riskflow_reconcile`，并以 doctor/扩展测试验证全部工具可见
- [x] 1.2 按 D2 实现 `riskflow_reply` 的输入校验、当前 Run 绑定、revision 与幂等控制，并以控制器测试验证成功、重复和过期拒绝
- [x] 1.3 按 D3 收紧 reconcile 违规过滤，并以测试证明安全漂移可恢复、duplicate writer/身份/全局违规不可绕过
- [x] 1.4 按 D4 实现 stale cleanup 的严格前提、精确 terminal 关闭、状态重读与 reclaimable 门禁，并以测试覆盖成功及 fail-closed 分支
- [x] 1.5 按 D7 为 `riskflow_wait` 增加上一批 Delivery 的显式 ack，并以重放回归验证下一次 wait 返回后续消息
- [x] 1.6 按 D8 在 Codex worker-start 前完成受控 terminal 预热，信任提示时保留 queued Task，并以同 terminal 恢复回归验证
- [x] 1.7 将含可选 Delivery ack 的 `riskflow_wait` 整体登记为 write approval，避免持久状态写入落入 read tier

## 2. 状态与冷启动

- [x] 2.1 按 D5 改善失败 worker、待回复和终态 terminal 残留的 nextActions，并以状态测试验证具体受控动作
- [x] 2.2 按 D5 扩充 OMP 冷启动摘要，区分 resumeQueue、violations、stale worktree 与 diagnostics，并以扩展测试验证 diagnostics 不阻断队列
- [x] 2.3 按 D9/D10 恢复独立 Task 的 session 隔离，令 Auditor 在自身任务内闭环普通 finding，并防止旧 failed Dispatch 覆盖同 Task 的 live Dispatch

## 3. 项目级 Skill 与文档

- [x] 3.1 按 D6 创建 `.agents/skills/riskflow-orchestration/SKILL.md`，包含冷启动、状态分流、七个工具、幂等与事件循环，并通过 skill quick validation
- [x] 3.2 选择性豁免该 Skill 的 `.gitignore` 路径，验证其他 `.agents/skills/*` 仍被忽略
- [x] 3.3 更新 Handbook 与 Runbook 的工具面、消息回复、reconcile 和 stale cleanup 操作说明，并确认不写入当前 HEAD/Run/Task/terminal
- [x] 3.4 对照 Handbook 历史恢复仍有效的队首物化、活动 Agent 非干扰、session 不复用和依赖门纪律，并同步项目 Skill

## 4. 验证

- [x] 4.1 运行 `pnpm exec vitest run scripts/orchestration/`，确认调度测试全部通过
- [x] 4.2 运行 `pnpm exec prettier --check scripts/orchestration/`、`pnpm exec eslint scripts/orchestration/` 与 `git diff --check`
- [x] 4.3 运行 `pnpm exec openspec validate fix-orchestration-recovery-skill --strict --no-interactive` 与 `pnpm orchestration:doctor`
- [x] 4.4 使用无历史上下文的只读 Agent 调用项目 Skill 审阅实时状态，确认能区分当前队列、stale/违规与非阻断 diagnostics，且不执行写操作
- [x] 4.5 运行调度回归、格式/lint、OpenSpec strict、Skill 校验与 doctor，确认历史规则恢复后全部通过
