# Tasks

## 1. 收窄事后校验

- [x] 1.1 `assertFactsUnchanged` 改为比对工作项状态、当前尝试 taskId、`main.head` 与违规集合
- [x] 1.2 保持 `stale_revision` 错误码与下一步指引不变

## 2. 测试

- [x] 2.1 覆盖：只有 revision/脏状态变化时，长步骤结果仍被接受
- [x] 2.2 覆盖：工作项状态变化时仍以 `stale_revision` 拒绝

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-long-step-revalidation-scope --strict --no-interactive` 通过
- [x] 3.4 真实仓库：C17 的主线复验通过并被正确记录
