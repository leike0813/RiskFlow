# Tasks: fix-workflow-body-read-authorization-identity

## 1. 契约与实现

- [x] 1.1 实现 IP-01：`readBody` 输入加法必填 `invocationId`。验证：`pnpm exec vitest run packages/core/test/workflow`
- [x] 1.2 实现 IP-02：`postgres-workflow-adapter` 的 `readBody` 改用传入身份复验，删除内部固定派生。验证：`pnpm exec vitest run packages/adapters/test/workflow`
- [x] 1.3 实现 IP-03：`#readBodyAuthorized` 派生身份纳入父授权上下文并透传给 `readBody`。验证：`pnpm exec vitest run packages/adapters/test/workflow`
- [x] 1.4 实现 IP-04：`apps/worker/src/risk-flow/graph.ts` 调用点显式传参。验证：`pnpm exec vitest run apps/worker/test/risk-flow apps/worker/test/assessment`

## 2. 回归锁与全量

- [x] 2.1 实现 IP-05：投影适配器新增「同一工件连续两次读取均成功、不同父上下文身份互不相同」断言，并让 C06 替身按真实重放语义建模（旧实现下该用例已验证变红）。验证：`pnpm exec vitest run packages/adapters/test/workflow`（15/15）
- [x] 2.2 实现 IP-06：既有测试与夹具补 `invocationId` 实参。验证：`pnpm exec vitest run packages/adapters apps/worker apps/api`（899 passed / 2 skipped）
- [x] 2.3 全量验证：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate fix-workflow-body-read-authorization-identity --strict --no-interactive`（全部通过；浏览器回归 51 passed）
