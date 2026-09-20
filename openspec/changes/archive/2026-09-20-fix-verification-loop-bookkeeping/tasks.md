# Tasks

## 1. 审计失败保持收尾责任

- [x] 1.1 `deriveNodeState` 的失败分支承认 `audit`，使审计未通过时保持 `finalizing`
- [x] 1.2 确认 `nextTaskKind` 对该状态返回 `finalization`，修复可被派发

## 2. 实现派发登记运行态

- [x] 2.1 `startWorker` 的实现分支在注入被接受后登记 `running`（复用 `recordRunningAttempt`）
- [x] 2.2 登记失败只告警，不使派发失败

## 3. 测试

- [x] 3.1 `status.test.mjs` 覆盖：审计以失败收口后节点保持 `finalizing` 并给出继续修复的下一动作
- [x] 3.2 `control.test.mjs` 覆盖：实现分支注入成功后台账为 `running`

## 4. 验证

- [x] 4.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 4.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 4.3 `openspec validate fix-verification-loop-bookkeeping --strict --no-interactive` 通过
