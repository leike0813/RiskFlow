# Tasks

## 1. 工作树供给回退（Orca 优先，控制器自持）

- [x] 1.1 新增仓库元数据读取：`orca repo list --json` → 按 `path` 归一化匹配当前根目录，取出 `id`/`displayName`/`worktreeBasePath`/`worktreeBaseRef`/`hookSettings.scripts.setup`
- [x] 1.2 新增期望路径推导：`resolve(repo.path, repo.worktreeBasePath, repo.displayName, name)`，与 Orca 现有布局（`.orca/<displayName>/<name>`）一致
- [x] 1.3 `createWorktreeForReadyNode` 改为 Orca 优先：调用成功保持原行为；调用失败时进入回退
- [x] 1.4 回退第一步：期望路径已是本仓库 git 工作树且 HEAD 等于基线时直接取回身份，不重复建立
- [x] 1.5 回退第二步：`git worktree add <path> -b <name> <baseRef>`（分支已存在时复用该分支），随后逐行执行仓库 setup 脚本并记录结构化 `setupWarnings`
- [x] 1.6 回退第三步：从 `orca worktree list --json` 取回身份，匹配条件为 `repoId` 相同、非主工作树、路径归一化相等；命中必须唯一且含 `id`/`path`/`head`
- [x] 1.7 取回后校验目录存在与 HEAD 等于请求基线；任一步不成立即抛 `ControlError`，保留原始 Orca 错误并提示 `externalWorktreeVisibility`

## 2. 排队尝试的角色身份

- [x] 2.1 `riskflowDispatch` 复用分支的 `taskKind` 改为 `checkpoints.taskKind`（`replanApprovalRef` 路径仍强制 `planning`）
- [x] 2.2 `graph.policy.roles` 中不存在该 `taskKind` 时以结构化错误拒绝，不做角色替换
- [x] 2.3 确认无排队尝试的节点仍走 `nextTaskKind`，并保持实现/收尾/审计调度语义不变

## 3. 测试

- [x] 3.1 覆盖：Orca 创建调用抛出且期望路径已存在可用工作树 → 派发继续，任务信封使用取回的身份，不重复建立
- [x] 3.2 覆盖：Orca 创建调用抛出且期望路径不存在 → 以 `git worktree add` 建立并执行 setup 脚本后取回身份
- [x] 3.3 覆盖：`orca worktree list` 命中 0 条或多条、或记录缺字段、或 HEAD 与基线不一致 → fail-closed 且保留原始错误
- [x] 3.4 覆盖：排队中的规划尝试 → 以 `worker-start` 规划角色启动且台账 `taskKind` 为 `planning`（现有用例只覆盖 finalization/implementation 同组情形）
- [x] 3.5 覆盖：排队尝试的 `taskKind` 未知 → 以结构化错误拒绝

## 4. 文档

- [x] 4.1 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` 增补该故障的可复用恢复步骤（症状、判定命令、控制器回退行为、可见性设置依赖），不写入任何当前 HEAD/Run/Task 标识

## 5. 验证

- [x] 5.1 `pnpm exec vitest run scripts/orchestration/` 全部通过
- [x] 5.2 `pnpm exec prettier --check scripts/orchestration/` 与 `pnpm exec eslint scripts/orchestration/` 干净
- [x] 5.3 `pnpm exec openspec validate fix-dispatch-provisioning-recovery --strict --no-interactive` 通过
- [ ] 5.4 真实仓库确认（**不属于本工作树的自证范围**）：本次 change 合入 main 后，由协调端用 main 上的控制器对真实 `ready` 节点执行一次派发，确认 Orca CLI 不可用时仍能确认工作树身份并继续派发；本工作树内的控制器代码还不是 main 的运行版本，因此该条在收尾阶段保持未勾选并写入 verification 的后续事项。
