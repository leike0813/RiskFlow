## Context

见 proposal.md。当前协调流程把 39-change 静态依赖、feature worktree 内的 OpenSpec 工件、Git 检查点和 Orca Task/Run/Dispatch 分开保存。C00～C38 的路线工件明确要求主 Agent 只滚动物化当前 frontier；实现、验证和规划通常先发生在 feature worktree，合并和归档随后才进入 `main`。

本 change 是工程调度工具，不属于 RiskFlow 生产四层和业务 `riskFlowGraph`。它不能把产品 LangGraph checkpoint、C03 PostgreSQL 业务基础设施或 OpenSpec 工件复制成第二套业务事实源。

## Goals / Non-Goals

**Goals:**

- 以一个版本化 Manifest 记录 C00～C38 的 change/gate 依赖，不再让机器解析 Handbook ASCII 图。
- 从每个实际存在的 feature worktree 自身读取 OpenSpec 和 Git 状态，解决 main 滞后造成的误判。
- 复用 Orca 现有 Run、Task、Dispatch、worktree 和 terminal 状态，建立结构化任务身份与 checkpoint 摘要。
- 以确定性规则计算 frontier、blocked、failed、archived、reclaimable 和 stale 状态。
- 输出人类摘要与稳定 JSON，帮助协调 Agent 选择下一动作和及时回收 worktree。
- 在事实冲突、路径缺失、checkpoint 不匹配或未知脏改动时 fail-closed。

**Non-Goals:**

- 不实现新的持久化数据库、服务、工作流状态机或 LangGraph 图。
- 不改变 C00～C38 的产品依赖、业务 Schema、领域模块、PostgreSQL 迁移或生产 workspace。
- 不自动解析完整 Delivery/verification 文本来决定 PASS/FAIL。
- 不自动提交、合并、归档、修改 OpenSpec、删除分支或回收 worktree。
- 不频繁把实时状态提交到 `main`；历史仍由 Git、OpenSpec 和 Orca 保存。

## Decisions

### 1. 双层状态模型

静态依赖放入 `config/orchestration/execution-graph.json`。该文件是机器读取的 change/gate 依赖事实源，路线 Markdown 和 Handbook 中的图只作为人类视图。

动态执行状态不写入仓库快照，而由 `scripts/orchestration/status.mjs` 每次读取事实源后派生。这样不会因为 Orca terminal、临时路径、时间戳和当前 HEAD 变化制造大量状态提交。

### 2. 按字段选择事实源

| 状态 | 事实源 |
|---|---|
| change 的规划/实现/验证工件 | 关联 feature worktree 中的 OpenSpec |
| worktree HEAD、分支、dirty 状态 | 关联 feature worktree 中的 Git |
| Task/Run/Dispatch/terminal 生命周期 | Orca JSON |
| feature 是否集成 | `main` Git ancestry/merge checkpoint |
| main 验证和归档 | `main` 的 checkpoint、OpenSpec 与验证证据 |
| FAIL 原因和升级上下文 | Orca result 的 evidenceRefs 与原始 transcript |

`main` 的 OpenSpec 查询只用于集成后事实，不能覆盖活动 feature worktree 的本地状态。

### 3. worktree-aware 采集流程

状态命令从 Orca 查询当前仓库登记的 worktree，按完整 `worktreeId` 去重，并对每个仍存在的路径执行有限读取：

1. 读取 feature worktree 的 `git status --short --branch`、HEAD 和分支关系。
2. 在该 worktree 的 `cwd` 运行 `openspec list --json`，必要时查询具体 change 状态。
3. 从 Orca `task-list --json`、Run/worker/worktree 状态中读取结构化运行信息。
4. 单独读取 `main` 的 HEAD、merge ancestry、主线验证和归档事实。
5. 按 `changeId + taskId + worktreeId` 合并并推导状态。

只扫描 Orca 当前登记的实际 worktree，不为未物化 change 创建路径或执行命令。路径不存在时报告 `worktree_missing`，不静默降级。

### 4. Orca Task result 结构化信封

Orca `task-create` 没有任意 metadata 字段，但 `task-update` 支持 JSON `result`。主调度 Agent 在创建 Task 后写入信封，并在阶段收口时更新：

```json
{
  "schemaVersion": 1,
  "changeId": "C08",
  "taskKind": "verification",
  "worktreeId": "repo-id::/absolute/worktree/path",
  "baseHead": "5fa57aa",
  "head": "318cde0",
  "phase": "verification",
  "outcome": "failed",
  "evidenceRefs": [{
    "kind": "verification-report",
    "worktreeId": "repo-id::/absolute/worktree/path",
    "path": "openspec/changes/.../verification.md",
    "head": "318cde0"
  }],
  "main": {
    "mergeCommit": null,
    "mainHead": null,
    "verification": "pending",
    "archiveCommit": null
  },
  "nextAction": "repair-or-replan",
  "reclaim": "blocked"
}
```

信封只保存身份、状态摘要、checkpoint 和证据引用；不复制报告正文。旧 Task 没有信封时标记 `unlinked`，不得从 title、display name 或正文推断归属。

### 5. 状态推导

节点同时保存原始来源和派生状态。建议的派生值为 `pending`、`ready`、`running`、`blocked`、`verification_failed`、`merged`、`main_verified`、`archived`、`reclaimable`、`completed`、`stale`、`unknown`。

核心不变量：

- 所有直接依赖必须在 `main` 归档后才能解锁 frontier。
- feature worktree 的本地完成不能单独产生 `archived` 或 `completed`。
- `featureHead` 必须是 `main` 祖先，主线验证摘要为 `passed`，且归档事实齐全，才进入 `reclaimable`。
- Git、OpenSpec、Orca、信封之间出现身份或 HEAD 冲突时输出 `unknown`/`violations`。
- 未知未提交改动阻止回收；不自动建议 `--force`。

### 6. CLI 边界

`status` 只读并输出状态；`--json` 用于 Agent，默认格式用于人工查看；`--check` 只返回门禁结果和 violations，不执行副作用。worktree 回收仍由 Handbook 规定的 Orca 命令完成，回收后重新运行 `status --check`。

不增加第三方依赖；脚本使用 Node.js 24 标准库执行子进程、读取 JSON 和路径检查。命令执行器必须支持注入，测试只验证确定性推导，不依赖 live Orca、真实 Agent 或数据库。

## Risks / Trade-offs

- 每个实际 worktree 都需要一次本地 OpenSpec 查询；这是避免 main 滞后误判所必需的，扫描范围限制为 Orca 已登记路径。
- Orca Task 信封依赖协调 Agent 按协议写入；缺失时 fail-closed，不能通过解析文本补救。
- Manifest 与路线 Markdown 仍可能漂移；`orchestration:check` 应校验节点/依赖覆盖，后续可增加从 Manifest 生成图，但本 change 不引入生成器。
- `main` 之外的 feature worktree 可能临时包含不完整工件；状态视图报告事实，不把局部验证结果冒充最终交付。
- 不保存额外运行历史会限制跨机器审计；只有出现多协调者、跨主机或审计需求时再引入 append-only ledger。
