# Tasks: deliver-engineering-and-knowledge-ui

## 1. 契约与授权

- [x] 1.1 实现 IP-01：contracts 新增七条 branch 的只读 Schema/端口/能力映射（D2/D3）；验证 `pnpm vitest run packages/contracts && pnpm typecheck`
- [x] 1.2 实现 IP-02：`policy.ts` 角色授予加法（D5）；验证 `pnpm vitest run packages/core/test/access.test.ts`

## 2. 适配器与 HTTP 接线

- [x] 2.1 实现 IP-03：engineering-data catalog 适配器（context-read/source-catalog/monitoring-catalog/read-result）；验证 `pnpm vitest run packages/adapters/test/engineering-data`
- [x] 2.2 实现 IP-04：知识治理只读（list/精确读取/当前发布集合）；验证 `pnpm vitest run packages/adapters/test/knowledge-governance`
- [x] 2.3 实现 IP-05：检索结果再读取（hybrid/relationship）；验证 `pnpm vitest run packages/adapters/test/identification`
- [x] 2.4 实现 IP-06：ApiPortsV1 四注入位 + 七条 query branch 目录条目；验证 `pnpm vitest run apps/api && pnpm vitest run packages/adapters/test/workflow`

## 3. demo 界面

- [x] 3.1 实现 IP-07：demo 数据接入层、登录页、鉴权门、vite 代理、AppShell 工程上下文；验证 `pnpm --dir demo build`
- [x] 3.2 实现 IP-08：工程项目四页接真实只读数据；验证 `pnpm --dir demo build`
- [x] 3.3 实现 IP-09：知识治理五页 + 检索结果页 + 证据抽屉接线 + 跨页深链 + 移除假写操作按钮；验证 `pnpm --dir demo build`

## 4. 验收链路与收口

- [x] 4.1 实现 IP-10：浏览器验收 harness + demo-chromium project + specs；验证 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`
- [x] 4.2 实现 IP-11：清理 demo/src/content 中本 change 已替换的静态业务数据；验证 `pnpm --dir demo build && pnpm typecheck`
- [x] 4.3 全量验证：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate deliver-engineering-and-knowledge-ui --strict --no-interactive`
