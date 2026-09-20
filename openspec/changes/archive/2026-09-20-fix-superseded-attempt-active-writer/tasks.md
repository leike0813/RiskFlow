# Tasks

## 1. 活动写者判定收窄

- [x] 1.1 `status.mjs` 新增「同组内已被取代」判定，并在活动写者计数中排除这类尝试
- [x] 1.2 判定要求同组且两侧均有可用尝试次数/创建顺序；信息不足时保持既有语义

## 2. 测试

- [x] 2.1 `status.test.mjs` 覆盖：同一尝试组内较早的 `ready` 尝试 + 更晚尝试不再报 `duplicate_active_writer`
- [x] 2.2 `status.test.mjs` 覆盖：不同尝试组的两个活动尝试仍报 `duplicate_active_writer`

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-superseded-attempt-active-writer --strict --no-interactive` 通过
- [x] 3.4 真实仓库验证：C17 不再报 `duplicate_active_writer`，可派发重开规划
