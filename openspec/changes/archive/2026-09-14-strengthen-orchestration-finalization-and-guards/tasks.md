## 1. 状态与策略

- [x] 1.1 [IP-01] 升级执行图 Manifest 的角色、阶段与审计策略，并用 `node scripts/orchestration/status.mjs --graph-only` 验证 DAG
- [x] 1.2 [IP-02] 实现 v1 兼容和 v2 信封解析、当前尝试选择与 HEAD 门禁，并通过 `pnpm exec vitest run scripts/orchestration/status.test.mjs`
- [x] 1.3 [IP-03] 实现辅助 change 发现、revision 和确定性 resumeQueue，并通过 `pnpm exec vitest run scripts/orchestration/status.test.mjs`

## 2. 受控操作与 OMP

- [x] 2.1 [IP-04] 实现受控状态转换、锁、幂等和完成门，并通过 `pnpm exec vitest run scripts/orchestration/control.test.mjs`
- [x] 2.2 [IP-05] 实现 OMP 五工具、上下文与停止/绕过守卫，更新启动命令，并通过 `pnpm orchestration:doctor`

## 3. 稳定规则

- [x] 3.1 [IP-06] 收口 handbook、Runbook、AGENTS 和 OpenSpec workflow 的 Finalizer/实现自修/审计及操作经验，并通过 `openspec validate strengthen-orchestration-finalization-and-guards --strict --no-interactive`
- [x] 3.2 [IP-01～IP-06] 运行 `pnpm verify` 与 `git diff --check`，修复所有范围内失败

## 4. 集成与当前状态迁移

- [x] 4.1 [IP-07] 验证本 change、合入 main，确认 main 代码检查点包含全部规格与实现
- [x] 4.2 [IP-07] 冻结 writer 后依次把 main 合并进 C17、C20、C26 和 C11 辅助工作树，逐树完成 clean/冲突标记/最小测试检查
- [x] 4.3 [IP-07] 按合并后 HEAD 回填四个 v2 信封，运行 `pnpm orchestration:status --json` 验证 C17、C26、AUX-C11 的接管顺序及 C20 阻塞状态
- [x] 4.4 [IP-07] 核验并通过 Orca 回收三个旧工作树，运行 `pnpm orchestration:check` 并确认返回 0
