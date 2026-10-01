# Tasks: fix-projection-reverification-identity-seam

## 1. 契约与适配器修复

- [x] 1.1 实现 IP-01：两个请求 Schema 加法身份字段；验证 `pnpm vitest run packages/contracts && pnpm typecheck`
- [x] 1.2 实现 IP-02：投影适配器 query/readPage 复验身份修复 + 透传；验证 `pnpm vitest run packages/adapters/test/workflow`
- [x] 1.3 实现 IP-03：C22 窄读复验身份修复、删除无配对派生函数；验证 `pnpm vitest run packages/adapters/test/identification`
- [x] 1.4 实现 IP-04：HTTP invoker 透传 queryId；验证 `pnpm vitest run apps/api`
- [x] 1.5 实现 IP-08：`#readReportBody` 进程内重签发（D6）+ 装配点注入 authorize；验证 `pnpm vitest run packages/adapters/test/workflow apps/api`

## 2. 验收补验与回归

- [x] 2.1 实现 IP-05：适配器测试身份断言锁回归；验证 `pnpm vitest run packages/adapters/test/workflow packages/adapters/test/identification`
- [x] 2.2 实现 IP-06：harness 注入 riskRecordTrace + 夹具补齐（含播种时点不晚于登记时点）+ C33 断言按 D7 范围翻正（追溯 1–5 正向、6–8 缺席）；验证 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`
- [x] 2.3 实现 IP-07：C32 read-only 回归 + 复现脚本复验 200；验证 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`（全量）与复现脚本运行记录
- [x] 2.4 全量验证：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate fix-projection-reverification-identity-seam --strict --no-interactive`
