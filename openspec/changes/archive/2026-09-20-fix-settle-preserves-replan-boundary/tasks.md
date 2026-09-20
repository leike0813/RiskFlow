# Tasks

## 1. 收口保留重开规划边界

- [x] 1.1 `riskflowSettle` 的 settled 信封在 `approvalRef` 与 `supersedesAttemptGroup` 均非空时成对保留这两个字段
- [x] 1.2 边界不完整时不写入，避免 `invalid_replan_boundary`

## 2. 测试

- [x] 2.1 `control.test.mjs` 覆盖：收口携带完整边界的尝试后，写出的 settled 信封保留 `approvalRef` 与 `supersedesAttemptGroup`
- [x] 2.2 `control.test.mjs` 覆盖：常规收口不新增边界字段

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-settle-preserves-replan-boundary --strict --no-interactive` 通过
