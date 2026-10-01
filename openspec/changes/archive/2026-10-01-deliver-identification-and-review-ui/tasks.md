# Tasks: deliver-identification-and-review-ui

## 1. 契约与授权

- [x] 1.1 实现 IP-01：contracts 新增五条 branch 的只读 Schema/端口/能力映射（D2/D3）；验证 `pnpm vitest run packages/contracts && pnpm typecheck`
- [x] 1.2 实现 IP-02：`policy.ts` 角色授予加法（D5）；验证 `pnpm vitest run packages/core/test/access.test.ts`

## 2. 适配器与 HTTP 接线

- [x] 2.1 实现 IP-03：识别只读适配器（run-list/run-read/record-catalog/record-read）；验证 `pnpm vitest run packages/adapters/test/identification`
- [x] 2.2 实现 IP-04：复核队列只读（筛选/游标/stale/同形失败）；验证 `pnpm vitest run packages/adapters/test/review-audit`
- [x] 2.3 实现 IP-05：ApiPortsV1 两注入位 + 五条 query branch 目录条目；验证 `pnpm vitest run apps/api`

## 3. demo 界面

- [x] 3.1 实现 IP-06：demo api 层扩展（postCommand + 五个查询 operation + decide 命令 operation + 关联图两段读）；验证 `pnpm --dir demo build`
- [x] 3.2 实现 IP-07：识别运行列表/详情与风险记录列表/详情四页接真实数据 + 路由参数化 + 移除假写入口；验证 `pnpm --dir demo build`
- [x] 3.3 实现 IP-08：关联图页与证据追溯页接投影两段读 + 失败闭合与降级视图 + 证据抽屉沿用；验证 `pnpm --dir demo build`
- [x] 3.4 实现 IP-09：复核队列（queue-read + decide-review 确认/幂等/过期禁决定）与运行记录页（双源聚合）+ 跨页深链；验证 `pnpm --dir demo build`

## 4. 验收链路与收口

- [x] 4.1 实现 IP-10：浏览器 harness 夹具扩展 + identification-review specs；验证 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`
- [x] 4.2 实现 IP-11：清理 demo/src/content 中本 change 已替换的静态业务数据；验证 `pnpm --dir demo build && pnpm typecheck`
- [x] 4.3 全量验证：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate deliver-identification-and-review-ui --strict --no-interactive`
