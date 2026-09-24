## 1. 公共结果契约

- [x] 1.1 实施 IP-01：扩展查询结果与报告事实项，并保留旧分支及未知值校验；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`。

## 2. C30 自有登记与迁移

- [x] 2.1 实施 IP-02：核对 main 迁移序号，完成获批的空间登记与定向索引迁移；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`。

## 3. 只读投影

- [x] 3.1 实施 IP-03：接通新查询登记、逐页授权复验和历史游标；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`。
- [x] 3.2 实施 IP-04：按精确主题生成有界关联图并验证来源资格；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`。
- [x] 3.3 实施 IP-05：按工程修订/空间有界生成报告事实和缺席项；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`。

## 4. 回归与交付证据

- [x] 4.1 实施 IP-06：在真实 PostgreSQL 下核验迁移、分页、撤权、历史重放及旧分支；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm format:check` 和 `pnpm openspec:validate`。
