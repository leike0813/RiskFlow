# Proposal

## Why

`collectGit` 把 `git status --porcelain=v1 --branch` 的**原始行**当作 `dirtyPaths`：

```js
const dirtyPaths = lines.filter((line) => !line.startsWith("## "));
```

于是投影里的 `dirtyPaths` 是 `" M packages/.../a.ts"` 这种「状态码 + 路径」，而不是路径。这条形状错误让成功收口的已审阅改动契约无法满足：

- 契约要求 `reviewedPaths` 与实时 dirty paths 完全一致，但调用方列的是真实路径，永远不可能与带状态码的字符串相等；
- 即使通过了比较，收口执行的是 `git add -- <reviewedPaths>`，把 `" M path"` 当路径传入会直接失败。

实测：C26 的 Finalizer 留下两处未提交修复，上一处修复（让校验真正生效）之后，第一次真实收口就被 `unreviewed_changes` 拒绝——不是因为路径写错，而是因为两侧形状不同。

## What Changes

- `collectGit` 把 porcelain 行解析为**裸路径**后再作为 `dirtyPaths` 暴露：`XY<space>PATH` 取 `PATH`，重命名/复制取箭头右侧的目标路径，并去掉 Git 为特殊字符加的外层引号。
- `dirty` 的判定不变（仍以是否存在未提交条目为准）。
- 其余消费方（收口校验与 `git add`、节点投影、main 汇总）继续只拿到路径。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: `dirtyPaths` 必须表达路径而不是 status 行。

## Impact

- 代码：`scripts/orchestration/status.mjs`、`scripts/orchestration/status.test.mjs`，以及 `scripts/orchestration/control.test.mjs` 中依赖该形状的 fixture。
- 规格：`openspec/specs/operations/orchestration-execution-status/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变 `dirty` 布尔、violations 判定或 Orca 契约。
- 已知边界：只处理 Git 的常规引号包裹，不做 C 风格完整反转义；仓库现有路径均为无空格 ASCII 路径。
