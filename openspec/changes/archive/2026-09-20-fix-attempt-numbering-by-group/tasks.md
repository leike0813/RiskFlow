# Tasks

## 1. 按组历史递增尝试编号

- [x] 1.1 `createV2Envelope` 在目标尝试组内取既有最大 `attempt` 并加一；无历史时从 1 开始；replan 边界仍为 1
- [x] 1.2 快照缺少 `orca.attempts` 时回退既有判断

## 2. 测试

- [x] 2.1 `control.test.mjs` 覆盖：目标组已有 attempt 2 且当前检查点为 audit 时，新 finalization 尝试编号为 3
- [x] 2.2 `control.test.mjs` 覆盖：目标组无历史时编号为 1

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-attempt-numbering-by-group --strict --no-interactive` 通过
- [ ] 3.4 真实仓库验证：在 C26 下一次新建尝试（reconcile 或再派发）时确认编号按组历史递增并成为当前尝试；本轮已存在的修复尝试创建于修复之前，其编号不会追溯改变
