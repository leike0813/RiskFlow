# Proposal

## Why

辅助 change（没有固定路线节点、以 `AUX:<change>` 合成的工作项）无法完成集成：即使其 feature 分支已经真实合入 main，状态视图仍停留在 `finalized`，`riskflow_integrate` 因此永远进不到 `merged` / `main_verified` 阶段，主线复验与归档都执行不了。

根因是合并证据的采集口径：`deriveNodeState` 用 `featureMerged = mainArchive || ancestry[node.id]` 判断产物是否已进主线，而 `collectFacts` 只对**路线图中 kind = "change" 的节点**采集 ancestry：

```js
for (const node of graph.nodes.filter(
  (candidate) => candidate.kind === "change" && worktree.localNodeIds.includes(candidate.id),
)) {
  ancestry[node.id] = await isAncestor(exec, worktree.git.head, main.head, rootDir);
}
```

辅助 change 不在 `execution-graph.json` 里，对应工作项的 id 是运行时合成的 `AUX:<change>`，既不在图中，其信封的 `routeNodeId` 也是 `null`，因此 ancestry 永远没有它的键。

实测：`fix-c11-context-source-suite-isolation` 已合入 main（`703e03c`），合并摘要也已写入信封（`main.mergeCommit` 有值），但节点仍是 `finalized`、`main.merged: false`，resumeQueue 一直停在 `integrating`。

## What Changes

- `collectFacts` 的 ancestry 采集覆盖**非路线 change**：非主工作树中每个不映射到路线图 change 节点的活动 change，按 `AUX:<name>` 记录其工作树 HEAD 是否为 main 的祖先。
- 采集口径与仓库既有规则保持一致：只用同一判据 `git merge-base --is-ancestor <worktree head> <main head>`，不新增合并判定方式。
- 路线节点行为不变：已有 name → 节点的映射仍优先，辅以新的非路线分支。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: 辅助 change 的合并证据必须与路线 change 使用同一采集口径。

## Impact

- 代码：`scripts/orchestration/status.mjs`、`scripts/orchestration/status.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-execution-status/spec.md`（本 change 的 delta）。
- 不改变路线节点、优先级或回收判定的既有语义，不新增依赖，不改变 Git 判据。
- 不修改 `execution-graph.json`：辅助 change 依旧不进入路线图。
