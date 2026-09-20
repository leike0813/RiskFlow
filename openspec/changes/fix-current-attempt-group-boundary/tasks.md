# Tasks

## 1. 选择规则

- [ ] 1.1 `taskSummary` 在最大阶段内先按尝试组边界（组内最新创建时间）定界，再取该范围内的最大 attempt 与创建顺序
- [ ] 1.2 无尝试组或创建时间不可比较时回退既有语义；边界相同时不做单独裁决

## 2. 测试

- [ ] 2.1 `status.test.mjs` 覆盖：同阶段内 audit（新组，attempt 1）压过已收口的 finalization（旧组，attempt 2），`checkpoints` 指向 audit
- [ ] 2.2 `status.test.mjs` 覆盖：同一组内的多次尝试仍按 attempt 选择（既有语义不回退）
- [ ] 2.3 既有 replan 边界、无唯一创建顺序等用例保持通过

## 3. 验证

- [ ] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [ ] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [ ] 3.3 `openspec validate fix-current-attempt-group-boundary --strict --no-interactive` 通过
- [ ] 3.4 真实仓库验证：C26 的 `checkpoints` 指向正在运行的 audit
