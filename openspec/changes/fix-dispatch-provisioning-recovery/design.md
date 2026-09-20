# Design

## Context

- `createWorktreeForReadyNode` 目前只走 `orca worktree create --repo path:<root> --name <node.id 小写> --base-branch main --no-parent --setup run --comment "RiskFlow <id> <change>"`，并把返回值 `worktree.{id,path,head}` 当作唯一真相。
- 实测（2026-09-21）该调用会 30 秒后以 `runtime_unavailable` 结束；副作用是否发生不确定：4/6 次建立了完整工作树（分支、文件、依赖安装齐全，`orca worktree list` 可见），2/6 次没有副作用。
- `orca repo list --json` 公开该仓库的 `worktreeBasePath`（`../.orca`）、`worktreeBaseRef`（`main`）与 `hookSettings.scripts.setup`；实测由 `git worktree add` 建立的工作树会以 `<repoId>::<path>` 形式出现在 `orca worktree list --json`（仓库设置 `externalWorktreeVisibility: "show"`），即控制器可以自持建立并取回身份。
- `riskflowDispatch` 的复用分支用 `nextTaskKind(node)` 推导 `taskKind`，而任务说明来自被复用的任务对象；两者在"排队中的规划尝试"上不一致。

## Goals / Non-Goals

**Goals:**

- Orca CLI 失去响应时，派发仍能在**确认了外部副作用**的前提下继续，且身份来自实时事实而不是猜测。
- 已排队尝试按其自身角色启动，规划尝试绝不再被交给实现角色。
- 两种失败都 fail-closed：无法确认身份或外部工具真的失败时，保留原始错误，不制造半成品状态。

**Non-Goals:**

- 不替换 Orca 的工作树管理：成功路径、回收（`orca worktree rm`）、监督 worker、terminal 创建全部保持原样。
- 不修复 Orca 运行时本身，也不改写其仓库设置。
- 不改变 `nextTaskKind` 对"无排队尝试"节点的既有语义。
- 不为外部工作树可见性被关闭的环境提供备用登记方式（该设置关闭时取回必然失败，控制器 fail-closed）。

## Decisions

**D1：Orca 优先，控制器自持为回退。**
先用 CLI 完成（保留 Orca 侧的 lineage、cliProvenance 与 UI 侧效果）；仅当该调用失败时进入回退。回退不猜测路径：布局取自仓库公开元数据 `resolve(repo.path, repo.worktreeBasePath, repo.displayName, name)`，与既有工作树（`.orca/RiskFlow/<name>`）一致。

**D2：先确认、后建立、再取回。**
回退的三步是：(1) 期望路径已是该仓库的 git 工作树且 HEAD 等于基线 → 直接取回（覆盖"副作用已发生但响应丢失"这一最主要形态）；(2) 否则用 `git worktree add <path> -b <name> <baseRef>` 建立（分支已存在时复用该分支），再按 Orca 语义逐行执行 `hookSettings.scripts.setup`；(3) 从 `orca worktree list --json` 取回身份。

**D3：身份取回必须是唯一的、可核验的。**
匹配条件为 `repoId` 相同、`isMainWorktree !== true`、`path` 归一化后等于期望路径；命中数量必须恰为 1，且记录必须有 `id`/`path`/`head`。取回后校验目录存在、`head` 与请求基线一致。任一步不成立即抛出携带原始 Orca 错误的 `ControlError`，并提示 `externalWorktreeVisibility`，绝不返回一个"可能对"的工作树。

**D4：角色身份取自尝试本身。**
复用分支的 `taskKind` 改为 `checkpoints.taskKind`，并以 `graph.policy.roles` 中存在对应角色为前置；不存在则 `ControlError`。`replanApprovalRef` 路径仍强制 `planning`；无排队尝试时仍用 `nextTaskKind`。

**D5：setup 脚本失败不伪装成成功。**
逐行执行并设置超时；任一行非零退出或超时都写入结构化 `setupWarnings` 返回体，与 Orca 的 `hookWarning` 语义一致。工作树身份本身不因脚本失败而作废（脚本内容属于仓库配置，不是供给契约），但调用方与运行手册都能看到。

**D6：回退只对运行时/传输失败触发。**
回退的触发条件是 Orca 调用抛出**运行时不可用或响应丢失**类错误（`runtime_unavailable`、`closed the connection before responding`、`Timed out waiting for the Orca runtime to respond`、`Could not connect to the running Orca app`）。参数错误、命名冲突等业务错误仍然直接冒泡：这类错误下自行建立工作树会掩盖真实原因，而 Orca 的运行时故障不会。

## Risks / Trade-offs

- **布局耦合**：期望路径依赖 `worktreeBasePath`/`displayName`。若 Orca 改布局，取回会失败并 fail-closed，错误信息指向这两个字段，不会被静默带错目录。
- **非幂等 setup**：仅在 Orca CLI 失败后执行一次；仓库当前 setup 行（`pnpm install --frozen-lockfile`、`openspec init`、`mattpack init`、`codegraph init -i`）在已初始化的工作树上重复执行是安全的，且失败以 warning 暴露。
- **可见性设置**：回退依赖 `externalWorktreeVisibility: "show"`。关闭该设置时回退无法取回身份并 fail-closed；这是有意的，因为替代方案（自行登记 Orca 元数据）会写入 Orca 私有状态。
- **延迟的异步副作用**：Orca 的创建可能在被判失败之后才落地（实测：`--setup skip` 的第二次同名调用在 30 秒超时后仍建立了带 `-2` 后缀的工作树与分支）。回退在期望路径确认身份后不再等待 Orca，因此延迟到达的副作用只会多出一个后缀工作树，不会改变已确认的身份；协调者在回收阶段按完整 worktree ID 处理这些多余项。
- **回退期间的锁占用**：`worktree create` 的 30 秒等待与工作树建立都在运行时锁内，最坏情况会让并发的受控操作等待。当前规模（单 frontend 串行派发）可接受；若将来并行度提高，应把工作树供给移出锁外（与 `fix-long-step-revalidation-scope` 的锁让出模式一致）。
