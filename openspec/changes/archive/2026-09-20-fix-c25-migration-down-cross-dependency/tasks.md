# Tasks

## 1. 硬化 000032 的 down

- [x] 1.1 在 `down()` 删表前以 `DROP CONSTRAINT IF EXISTS` 解除 `business.warning_records` 上指向 `risk_assessment_records` 的外键
- [x] 1.2 保持 `up()`、迁移清单与其它表删除顺序不变

## 2. 验证

- [x] 2.1 `pnpm exec vitest run packages/adapters/test/risk-assessment/migration-idempotency.test.ts` 通过
- [x] 2.2 `pnpm verify` 在 main 上通过（含 openspec validate）
- [x] 2.3 `npx prettier --check` 与 `npx eslint` 对改动文件干净
