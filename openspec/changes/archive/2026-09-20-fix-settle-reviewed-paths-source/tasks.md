# Tasks

## 1. 修复已审阅改动的读取来源

- [x] 1.1 `preflightAction` 的 reviewedPaths 一致性校验改用 `node.worktree.dirty` / `node.worktree.dirtyPaths`
- [x] 1.2 `riskflowSettle` 的检查点提交判定改用 `ctx.node.worktree.dirty`，仍只暂存 `reviewedPaths`
- [x] 1.3 确认 `control.mjs` 不再引用投影中不存在的 `worktree.git`

## 2. 测试

- [x] 2.1 `control.test.mjs` 覆盖：`reviewedPaths` 与 `dirtyPaths` 不一致时在 Git 副作用前拒绝
- [x] 2.2 `control.test.mjs` 覆盖：一致时只暂存这些路径并提交

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-settle-reviewed-paths-source --strict --no-interactive` 通过
