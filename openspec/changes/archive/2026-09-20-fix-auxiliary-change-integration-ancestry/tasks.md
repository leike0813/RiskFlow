# Tasks

## 1. 修复辅助 change 的合并证据

- [x] 1.1 在 `scripts/orchestration/status.mjs` 的 `collectFacts` 中，对每棵非主工作树的 `openSpecNames` 里不映射路线节点的 change，按 `AUX:<name>` 采集 `isAncestor(worktree.git.head, main.head)`
- [x] 1.2 确认路线节点的既有采集分支保持不变（名称映射到图节点时不走辅助分支）

## 2. 测试

- [x] 2.1 `status.test.mjs` 覆盖：辅助工作项的工作树 HEAD 为 main 祖先时报告 `merged` 且下一动作为主线复验
- [x] 2.2 `status.test.mjs` 覆盖：辅助工作项未合入时保持原阶段判定

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-auxiliary-change-integration-ancestry --strict --no-interactive` 通过
- [x] 3.4 真实仓库验证：`fix-c11-context-source-suite-isolation` 报告 `merged`，可继续执行主线复验与归档
