## 1. 回归边界

- [x] 1.1 扩展 `scripts/orchestration/status.test.mjs`，覆盖归档完成优先、主线祖先 checkpoint、阶段进展、历史孤立任务、乱序 Manifest 与未提交 archive，并验证针对性测试先失败后通过

## 2. 状态观察器

- [x] 2.1 修改 `scripts/orchestration/status.mjs`，从当前 `main` 提交采集归档、按拓扑推导状态并按生命周期校验 checkpoint，验证状态推导回归通过
- [x] 2.2 收紧 worktree/任务信封关联与当前尝试选择，区分实时阻断和历史 `diagnostics`，验证无实时对象时 `unlinkedTasks` 不受历史记录污染
- [x] 2.3 按 cursor 完整分页 Orca Run、逐 Run 读取并去重 Task，补齐 Manifest 与信封输入校验，验证采集器边界测试通过

## 3. 文档与验收

- [x] 3.1 更新 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 的状态观察器职责，并验证文档与 delta spec 一致
- [x] 3.2 运行 OpenSpec 严格校验、编排脚本测试、graph-only、JSON 状态、check 与 `pnpm verify`；当前仓库应报告 C00–C10/G0/G1 完成、frontier 为 C11/C16 且 check 返回 0
