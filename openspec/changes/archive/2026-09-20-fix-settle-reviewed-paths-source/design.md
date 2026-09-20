# Design

## Context

- `deriveNodeState`（`status.mjs`）把工作树投影为 `{ id, path, branch, head, exists, dirty, dirtyPaths, liveTerminalCount }`，其中脏状态已经由 `collectGit` 展开为 `dirty` 布尔与 `dirtyPaths` 数组；投影**不含**嵌套的 `git` 对象。
- `control.mjs` 的 `preflightAction`（第 166 行附近）与 `riskflowSettle`（第 917 行附近）都读 `node.worktree.git?.dirty`，因此条件恒假。
- 后果：reviewedPaths 一致性校验与检查点提交被静默跳过，settled 信封仍写入 `outputHead = worktree HEAD`。

## Goals / Non-Goals

**Goals:**

- 让「只提交已审阅改动」这条既有规则真正生效，且不一致时在 Git 副作用前拒绝。
- 保持控制器只消费状态视图的公开投影，不新增字段。

**Non-Goals:**

- 不改变投影字段集合或 `collectGit` 的语义。
- 不引入 `git add -A` 或任何整树暂存路径。
- 不改变干净工作树下的收口行为。

## Decisions

**D1：改用投影已有字段，而不是给投影补一个 `git` 对象。**
`dirty`/`dirtyPaths` 就是 `collectGit` 的结果，已经是事实源；再暴露一份嵌套结构等于同一事实两个出口，并且会让控制器继续依赖状态视图的内部形状。

**D2：修在两处消费点，且保持"先校验、后副作用"的顺序。**
`preflightAction` 负责在副作用前拒绝不一致；`riskflowSettle` 负责只暂存 reviewedPaths 并提交。两处都改，规则才闭环。

## Risks / Trade-offs

- 修复后，带未提交改动的成功收口会**开始真的提交**，这会改变行为（此前静默跳过）。这是恢复既有契约，但对已经在跑的流程可能表现为"新的" Git 副作用；收口请求必须继续显式提供正确的 `reviewedPaths`。
- 若工作树改动在收口瞬间发生变化，仍按既有语义以 `unreviewed_changes` 拒绝，需重新审阅后重试。
