## 1. 复现父子图边界

- [ ] 1.1 [IP-01] 在 `nested-boundary.test.ts` 以真实 C03 PostgreSQL 父图和现有 C24 夹具固化嵌套复核等待、父检查点与同命令重试红证据；运行 `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts`，保存改前失败结果。

## 2. 固定子图检查点所有权

- [ ] 2.1 [IP-02] 统一 C24 runner 的调用/回读配置，使原子线程、根命名空间与注入的 saver 在父节点内外一致；运行 `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts`，核对子检查点身份。

## 3. 收口中断与重放

- [ ] 3.1 [IP-03] 仅在精确子检查点、当前授权和 C24 等待事实一致时将 GraphInterrupt 返回为既有等待结果，并让同命令重放沿该边界对账；运行 `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/identification/graph/runtime.test.ts`。

## 4. 回归与交接

- [ ] 4.1 [IP-04] 完成复核决定恢复、重复/迟到信号、撤权和检查点故障的稳定行为断言；运行 `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`。
- [ ] 4.2 [IP-02, IP-03, IP-04] 核对生产文件仅在 implementation-plan §7 允许清单，执行 `pnpm typecheck && pnpm format:check && openspec validate fix-c24-nested-graph-interrupt-checkpoint-boundary --strict --no-interactive`；C30 已进入当前 HEAD 时另跑其真实同容器验收，否则明确记录未运行原因。
