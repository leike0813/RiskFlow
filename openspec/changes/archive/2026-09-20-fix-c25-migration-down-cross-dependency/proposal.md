# Proposal

## Why

C26 的迁移 `000044` 建了外键 `warning_records_assessment_fk`（`business.warning_records` → `business.risk_assessment_records`，后者属 C25 的 `000032`）。C25 自己的用例 `packages/adapters/test/risk-assessment/migration-idempotency.test.ts` 会在全量迁移已应用的前提下**单独**调用 `000032.down()` 两次，而此时该外键仍存在，PostgreSQL 拒绝删表：

```
error: cannot drop table business.risk_assessment_records because other objects depend on it
```

后果是主线复验红：C26 合入 main 后 `pnpm verify` 在 `packages/adapters/test/risk-assessment/migration-idempotency.test.ts` 失败，C26 与 C17 的集成都被挡住。两个 worker 都没抓到它：C26 只跑了 warning/adapter 定向用例，审计按 permission/transaction 范围也只跑了定向用例，谁都没跑 C25 的迁移用例——正是 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §8「共享机械接缝」提示的那类跨 change 影响。

## What Changes

- `000032_deterministic_risk_assessment.ts` 的 `down()` 在删表前先解除**后续 change 引入的、指向本表的依赖**（当前为 C26 在 `business.warning_records` 上建的三个外键：`warning_records_assessment_fk`、`warning_records_input_snapshot_fk`、`warning_records_preparation_snapshot_fk`），统一使用 `DROP CONSTRAINT IF EXISTS`，保持既有 up/down 可重复执行契约与「不重复创建审计外键」的判定不变。
- 不改变 `up()`、不改变任何业务语义、不新增迁移或依赖。

## Capabilities

### New Capabilities
<!-- 无：本 change 是集成接缝的机械修复，无规格行为变化。 -->

### Modified Capabilities
<!-- 无：C25 的迁移可重入是测试级契约，主规格与归档 change 均无对应 delta；本 change 在 .openspec.yaml 标记 skip_specs。 -->

## Impact

- 代码：`packages/adapters/src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts`（仅 `down()`）。
- 不新增依赖；不改迁移清单/序号；不改 C26 的外键（库级完整性保持）。
- 验证：`packages/adapters/test/risk-assessment/migration-idempotency.test.ts` 与主线 `pnpm verify`。
