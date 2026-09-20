# Design

## Context

- 合并证据在 `deriveNodeState` 里由 `featureMerged = mainArchive || Boolean(context.ancestry?.[node.id])` 决定；`mainArchive` 只在 change 已归档进 main 时为真。
- `ancestry` 在 `collectFacts` 中采集，原实现只遍历 `graph.nodes.filter((candidate) => candidate.kind === "change" && worktree.localNodeIds.includes(candidate.id))`。
- 辅助工作项 `AUX:<change>` 由 `deriveSnapshot` 运行时合成（`routeChangeNames` 之外的 change 名称），不在 `execution-graph.json` 中；其信封 `routeNodeId` 为 `null`，因此 `localNodeIds` 不含它。
- 结果：辅助 change 的 `ancestry` 永远缺失，`featureMerged` 恒为假（除非已归档），集成第二步与第三步不可达。

## Goals / Non-Goals

**Goals:**

- 辅助 change 与路线 change 使用同一合并判据，使 `finalized → merged → main_verified → archive` 阶段链对两类工作项都可达。
- 不改动路线节点的现有判定。

**Non-Goals:**

- 不把辅助 change 提升为路线节点，不修改 `config/orchestration/execution-graph.json`。
- 不新增第二套合并判定（如直接比对分支名或 `git branch --merged`）。
- 不改变 worktree 回收、replan 边界或尝试选择的语义。

## Decisions

**D1：在 ancestry 采集处补非路线分支，而不是在 `deriveNodeState` 里给辅助节点特判。**
判据属于「事实采集」，不是「状态推导」：`deriveNodeState` 只应消费 `ancestry[node.id]`，让它在辅助节点上保持与路线节点完全一致的语义。若在推导处特判，同一判据会出现两份实现（违反 SSOT）。

**D2：键名与合成 id 对齐为 `AUX:<name>`。**
`deriveSnapshot` 已经用 `` `AUX:${name}` `` 作为辅助工作项 id；采集侧使用同一表达式即可命中，不需要在两侧共享额外映射表。

**D3：复用既有 `isAncestor`，逐 worktree 逐 name 采集。**
非路线名称来自 `collectWorktree` 已经算好的 `openSpecNames`，无需新增 Git 调用以外的探测；每个名称一次 `git merge-base --is-ancestor`，与路线节点同量级。

## Risks / Trade-offs

- 同一辅助 change 名称若同时出现在多个工作树，后写入的键会覆盖先写入的。原实现的路线分支有同样特征（按节点 id 覆盖），此处保持一致；辅助工作项在 `deriveSnapshot` 中已经通过「信封声明的 workItemId」选出归属工作树，因此该覆盖不改变归属判定。
- 采集会为每个非路线活动 change 增加一次 Git 调用；活动 change 数量有限，成本可忽略。
