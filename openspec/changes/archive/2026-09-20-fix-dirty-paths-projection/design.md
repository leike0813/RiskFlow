# Design

## Context

- `collectGit` 三路并行取 `git status --porcelain=v1 --branch`、`rev-parse HEAD`、`branch --show-current`，目前直接把 status 行数组减去 `## ` 分支行后当作 `dirtyPaths`。
- `dirtyPaths` 的消费点有三类：节点投影（状态视图）、`main.dirtyPaths`（主工作树汇总）、控制器成功收口的校验与 `git add -- <paths>`。
- porcelain v1 每条为 `XY<space>PATH`；重命名/复制为 `XY<space>OLD -> NEW`；含特殊字符的路径会被 Git 加上双引号。

## Goals / Non-Goals

**Goals:**

- `dirtyPaths` 成为可直接比较与直接传给 `git add` 的路径集合。
- 保持 `dirty` 布尔与既有 violations 判定不变。

**Non-Goals:**

- 不解析 porcelain v2 或非默认状态格式。
- 不做 Git 引号内的 C 风格完整反转义（仓库路径无此需求）。
- 不改变控制器侧「只暂存 reviewedPaths、先校验后副作用」的顺序。

## Decisions

**D1：在 `collectGit` 出口解析，而不是让每个调用方各自剥离状态码。**
`dirtyPaths` 的语义应由生产者定义；四处消费点各自 `slice(3)` 会把同一解析逻辑复制四份，且任何一处漏改都会再次出现"形状不一致"的静默失败。

**D2：重命名取目标路径。**
`git add --` 与「实时改动」的语义都指向工作树当前存在的那个路径；旧路径已不存在，放进去只会让 `git add` 失败。

**D3：只剥离 Git 的外层引号。**
Git 会对特殊字符路径加引号包裹；去掉外层引号已能覆盖比较与 `git add` 的常见需求。完整 C 风格反转义（`\t`、`\nnn`）不在本 change 范围，避免引入无对应测试场景的复杂分支。

## Risks / Trade-offs

- 若将来出现带引号且内含转义序列的路径，`dirtyPaths` 与 `git add` 可能仍不一致；届时应补完整反转义并加对应用例。
- 该解析改变了 `dirtyPaths` 的字符串形状：任何按旧形状写死的外部脚本都需要同步；仓库内消费点已随本 change 一并核对。
