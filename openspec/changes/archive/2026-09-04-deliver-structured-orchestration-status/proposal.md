## Why

当前协调流程把静态路线、各 feature worktree 中的 OpenSpec 工件、Git 检查点和 Orca 任务状态分散保存。`main` 在合并前通常没有活动 change 的最新 OpenSpec，因此只从 `main` 查询会把“已在 worktree 中开始”的任务误判为未开始、缺失或可重新派发；已合并但未回收的 worktree 也缺少确定性的发现信号。

## What Changes

- 新增版本化的工程交付依赖图 Manifest，记录 C00～C38 的 change/gate、直接依赖和并发波次。
- 新增只读状态聚合命令，扫描 Orca 注册的 RiskFlow worktree，并在每个 worktree 自身的 `cwd` 中读取 OpenSpec 与 Git 状态。
- 将 Orca Task 的 `result` 约定为短结构化执行信封，绑定 `changeId`、`taskId`、完整 `worktreeId`、checkpoint、阶段、证据引用和下一动作。
- 分别读取 feature worktree 的活动状态与 `main` 的合并、主线验证、归档状态；状态冲突时输出 `unknown`/`violations`，不得静默推断。
- 输出统一的 frontier、blocked、verification failure、stale worktree、reclaimable 和 next action 状态，并提供机器可读 JSON 与人类摘要。
- 更新协调 Handbook 与路线工件，要求任务创建、检查点、合并、归档和 worktree 回收使用结构化状态核对。
- 不新增数据库、服务、生产包、第三方依赖或自动删除 worktree 的能力。

## Capabilities

### New Capabilities

- `operations/orchestration-execution-status`: 为工程交付路线提供跨 worktree、Git、OpenSpec 和 Orca 的结构化执行状态、依赖 frontier、冲突检测和 worktree 回收就绪判断。

### Modified Capabilities

- None.

## Impact

- 新增 `config/orchestration/execution-graph.json`、`scripts/orchestration/status.mjs` 及其行为测试。
- 修改根 `package.json`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 和路线记录，使机器状态与人工流程保持一致。
- 不修改 `apps/**`、`packages/**`、业务领域 Schema、LangGraph 图状态、PostgreSQL 迁移或锁文件。
- 不把自然语言报告解析为唯一状态来源；报告只通过引用进入执行证据。
