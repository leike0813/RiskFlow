## Context

见 `proposal.md`。当前观察器在一个脚本中完成 Orca/Git/OpenSpec 事实采集、状态推导和 CLI 输出；问题集中在事实生命周期没有分层，而不是缺少新的执行引擎。

## Goals / Non-Goals

**Goals:**

- 让已提交归档、当前运行事实和历史诊断各自只有一个职责。
- 用现有 Git 与 Orca CLI 能力消除静默遗漏和顺序依赖。
- 保持已有 CLI 与 JSON v1 调用方兼容。

**Non-Goals:**

- 不让观察器创建 worktree、派发 Agent 或执行 change。
- 不修改 RI/RA 领域模块、执行图依赖或生产应用。
- 不引入新依赖、数据库或长期迁移层。

## Decisions

### 已提交 OpenSpec archive 是完成事实

通过 `git ls-tree` 读取当前 `main` 提交中的归档，而不是读取工作区目录。节点一旦由该事实完成，历史 Orca 信封不能降级它。备选方案是继续合并所有来源后投票，但它让短生命周期记录覆盖持久事实，正是当前故障来源。

### Orca 只描述实时状态和历史诊断

任务只有在关联现存非主 worktree、worker 与 Dispatch 均非终态，或关联 live terminal 时才参与门禁；其余孤立记录进入 `diagnostics`。Dispatch 已收口但遗留 `unsupervised` worker 状态属于历史不一致，不恢复为实时任务。feature worktree 的 change 关联只看活动 change 目录和完整信封，不扫描继承的 archive。实时 worker 的资源 worktree ID 必须与任务信封一致。

同一 worktree 的信封按阶段优先级选择最新阶段，再按结构化创建顺序选择当前尝试。缺少可比较顺序且结果冲突时保持 fail-closed。`main.verification` 是主线验证的唯一字段，避免把自由文本当成状态。

### checkpoint 按所属生命周期校验

活动 feature checkpoint 仍须等于对应 worktree HEAD；主线 checkpoint 只须是当前 `main` 的祖先。Git 祖先关系由 `merge-base --is-ancestor` 判断。

### 采集完整、推导与排列无关

`run-list` 按 `nextCursor` 循环读取；对每个 Run 调用无分页接口 `task-list`，Task 汇总后按 ID 去重。执行图验证产生拓扑顺序，节点状态沿该顺序推导，输出仍可保留 Manifest 原有展示顺序。

### 兼容 JSON v1

现有字段和语义修正原地保留；只增加可选 `diagnostics`。`unlinkedTasks` 继续表示会阻断协调的实时对象，因此旧调用方无需理解新字段即可获得正确门禁。

## Risks / Trade-offs

- [Orca 不可用时无法判定实时对象] → 保持现有结构化错误与 fail-closed 行为。
- [旧任务缺少可靠时间字段] → 仅在当前阶段存在冲突时阻断，不对历史记录猜测归属。
- [Git archive 路径解析依赖仓库布局] → 复用 Manifest 的 change 标识并只读取既有 `openspec/changes/archive` 约定。

## Migration Plan

无需数据迁移。更新脚本后以当前仓库状态回归：C00–C10 与 G0/G1 完成，frontier 为 C11、C16，历史孤立任务不阻断。回滚仅需恢复脚本、测试、规格和手册改动。
