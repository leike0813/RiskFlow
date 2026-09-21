# RiskFlow 编排操作手册

## 1. 用途

本文只保存可重复使用的 Orca、OMP、Codex 操作步骤和故障恢复方法。稳定责任与状态转换以 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 为准；当前工作起点以 `pnpm orchestration:status --json` 的 `revision`、`resumeQueue` 和 `violations` 为准。本文不保存当前 frontier、HEAD、Run、Task、terminal 或历史进度。

工具升级后先运行以下命令；实际帮助与 doctor 结果优先于本文示例：

```bash
pnpm orchestration:doctor
orca --version
orca orchestration --help
omp --version
codex --version
```

## 2. 接管与创建 worktree

新协调会话先运行：

```bash
git status --short --branch
git log --oneline --decorate -8
pnpm orchestration:doctor
pnpm orchestration:status --json
pnpm orchestration:check
```

按 `resumeQueue` 的第一项推进。状态不一致时先修复 `violations`；不要从任务标题、聊天记录、旧 Delivery 或手册文字推测当前阶段。

Orca 操作始终使用完整 worktree ID。创建正式 worktree 时运行 repo setup hook；当前 hook 应完成冻结依赖安装和 OpenSpec 工具初始化，其中 OpenSpec 的工具名是 `oh-my-pi`，不是 `omp`。hook 失败时保留输出并停止派发，不在 worktree 内临时安装依赖。

从普通 shell 调用 Orca 协调命令时，若返回 `no_active_sender_terminal`，应显式传入当前协调 terminal 的 `--from <terminal-handle>`。不得借此复用另一会话的 sender、Run 或 Dispatch。

### 2.1 OpenSpec 命令

`orchestrated-delivery` 改变工件图，不改变 OpenSpec 顶层命令。后续大型 change 创建时显式选 schema，之后以 change 自身 `.openspec.yaml` 和 status 返回值为准；旧 change 不覆盖 schema 元数据：

| 目的 | 命令 |
|---|---|
| 校验 schema | `openspec schema which orchestrated-delivery`；`openspec schema validate orchestrated-delivery --verbose` |
| 创建大型 change | `openspec new change <change> --schema orchestrated-delivery --json` |
| 查看实际 schema/下一工件 | `openspec status --change <change> --json` |
| 获取工件指令 | `openspec instructions <artifact-id> --change <change> --json` |
| 获取实现上下文 | `openspec instructions apply --change <change> --json` |
| 获取最终验收指令 | `openspec instructions verification --change <change> --json` |
| 严格校验 | `openspec validate <change> --strict --no-interactive` |

`openspec-apply-change`、`openspec-verify-change` 和 `openspec-archive-change` 是 Agent Skill，不是 CLI 子命令。CLI 没有 `openspec verify`。apply 返回缺少 `implementation-plan` 时，应先按 instructions 创建该工件，不能改用默认四工件流程；发现 schema 不符时停止，不用命令行 override 强行继续。

OpenSpec 1.13.1 会在五个 apply 前置工件完成后把 verification 提前显示为 `ready`，并可能把 change 显示为 all done。Planning 以 status 的 `applyRequires` 为准，不创建 verification；Implementation 完成并形成固定检查点后，Finalizer 才生成该工件。归档前必须确认 verification 为 `done` 且结论对应最终 HEAD。

## 3. Codex 首次启动与工作区信任

新 worktree 首次启动 Codex 时，工作区信任确认可能先于 Agent idle 出现。典型信号是状态栏长期停在 `model: loading` / `directory: loading`，或派发返回 `agent_prompt_blocked`。

处理顺序：

1. 正常调用 `riskflow_dispatch`。Planning、Finalizer 和 Targeted Auditor 路径会先按 Manifest 模型与强度创建 Codex terminal，再等待 `tui-idle`，最后才执行 worker-start。
2. 若返回 `workspace_trust_required`，使用结果中的精确 terminal handle 定位 TUI。不要新建 Task、Run、terminal 或 worktree。
3. 由操作者在该 terminal 明确信任当前目录；若 CLI 因交互保护拒绝输入，保持当前 queued Task，等待操作者在该精确 terminal 中确认。
4. 确认状态栏显示实际模型、思考强度、目标目录和权限，MCP 启动完成并进入 idle。
5. 重新读取状态，以新幂等键调用 `riskflow_dispatch` 并传入该 `terminalHandle`。控制器复用当前 queued Task，通过 `worker-start --terminal` 启动。

不得自动修改全局 Codex 信任配置，也不得把 `agent_prompt_blocked` 记为实现失败、无进展或验收失败。

## 4. 精确启动 Agent

角色、模型和思考强度从 Manifest 选择，不在命令行临时改路由。正常路径使用 `pnpm orchestration:coordinator` 提供的受控工具。

排查启动问题时，可核对底层形态：

```bash
# Codex：先解决工作区信任，再 worker-start
codex --model <model> -c model_reasoning_effort="<effort>" -a never -s danger-full-access

# OMP：思考强度参数是 --thinking
omp --model <model> --thinking <level> --approval-mode yolo
```

OMP 的模型和思考强度由其启动命令指定；不要把 Codex 的 `--effort` 或 `model_reasoning_effort` 传给 OMP。自建 OMP terminal 时，先等待 `tui-idle` 并核对状态栏，再用 Dispatch 注入已有 Task。

若 OMP 注入后返回 `agent_prompt_stalled`，先检查是否只是输入仍待提交；只提交一次现有输入，不要再次 dispatch 同一 Task。禁止使用 `orca reset --tasks`，该命令会影响项目内全部 Run，而非当前 Task。

每个独立 Task 使用新的 Agent session。只有同一仍活动 Task 内的修复和回归保持连续会话；已结束、失败、暂停、释放、崩溃或长时间闲置的 terminal、Run、Dispatch 和上下文一律不用于后续 Task。工作区信任发生在 worker-start 前；确认信任后复用当前 queued Task 和其预热 terminal，不构成跨 Task 复用。

## 5. 等待、提问与超时

`riskflow_wait` 单次最多等待 60 秒。它返回的 Delivery 必须作为一个完整批次处理；处理完后，下一次 wait 传入该批次的 `ackDeliveryId`，控制器先 ack 再等待后续消息。不要在处理完成前 ack，也不要省略 ack 后反复读取同一批次。超时只是协调检查点：读取一次最新状态后继续等待，不创建替代 Task，不轮询 terminal 屏幕，也不把超时记为 worker 失败。

Agent 活动期间，除回复明确的 `question` / `escalation`、处理进程或连接故障、执行用户指令外，不向 terminal 追加输入，不停止 Agent，不释放 Dispatch。协调者只等待事件；`worker_done` 后该 session 即结束，不再承接新 Task。

收到 `question` 时，根据已批准工件和真实代码给出有界答案；答案涉及公共契约、权限、持久化、迁移、依赖或范围变化时转为 escalation。收到 `worker_done` 后先审阅 Delivery、diff、HEAD 和证据，再 settle；不要只凭退出码或报告中的 PASS 收口。

回复 `question` 或 `escalation` 时调用 `riskflow_reply`，携带最新 `expectedRevision`、唯一幂等键、事件的精确 `messageId` 和答复正文。工具只绑定当前未 settled Run；不要直接调用 Orca reply 命令，也不要向已结束 Run 发送消息。

命令超时与命令失败分开记录。必须执行的关键场景应保留其实际运行证据；合理的外围 skip 可以报告，但关键路径未执行不能算通过。

## 6. 派发和收口故障

发生 Orca/OMP/Codex 错误时先重新运行 status 并对账以下事实：

- Task、Run、Dispatch 是否已经创建；
- 是否存在活动 writer 或重复 terminal；
- Task 信封的 input/output HEAD 是否仍匹配；
- 幂等回执是否为 `inflight`；
- 错误发生在副作用之前还是之后。

`uncertain_prior_execution` 表示副作用可能已发生。此时不得换幂等键盲重试；先核对 Orca、Git 和 OpenSpec 的真实结果，再走受控 reconcile。已 settled 的 Task 不复用；普通测试失败由当前责任角色处理。

`riskflow_reconcile` 只允许处理 `checkpoint_mismatch` 与 `worktree_reclaim_pending`。失败 worker 仍绑定未 settled checkpoint 时，先读取最新状态和 revision，再创建替代尝试。重复 writer、任务身份冲突、未知 worktree 或全局违规必须人工查明根因，不能把目标节点 ID 当作绕过违规的许可。

Orca 内部 terminal 优先用 Orca CLI 定位和操作。桌面 accessibility 无法可靠识别目标 terminal 时，不使用坐标或盲按键替代精确 handle。

Finalizer 有未提交修复时，主调度必须先审阅全部 dirty paths。`riskflow_settle` 的 `reviewedPaths` 必须与实时 dirty paths 完全一致；工具只暂存这些路径。对声明 verification 的 schema，finalization/audit 成功收口前先运行 status 确认该工件为 `done`，否则 settle 会在 Git 暂存前拒绝。不要使用 `git add -A` 把未知改动带入检查点。

### 6.1 Orca 工作树供给故障恢复

症状：`ready` 节点的派发没有进入 `createTask`，幂等回执停在 `inflight`，而 Orca 创建调用约 30 秒后以
`runtime_unavailable: The Orca runtime closed the connection before responding` 结束。调用失败不代表副作用没发生：
worktree、分支、文件与 setup 结果可能已经建立，也可能完全没发生，而且**延迟**——判失败之后仍可能再建立工作树。

先判定实时事实，再决定动作：

```bash
orca repo list --json        # 该仓库的 worktreeBasePath / worktreeBaseRef / hookSettings.scripts.setup / externalWorktreeVisibility
orca worktree list --json    # 期望路径上是否已出现受管记录（id 形如 <repoId>::<path>）
git worktree list --porcelain
pnpm orchestration:status --json
```

期望路径由 Orca 布局决定：`<repo.path>/<worktreeBasePath>/<displayName>/<工作项 id 小写>`。不要从分支名或 display name 反推身份。

控制器已实现的行为（不必人工重放）：Orca 的 `worktree create` 仍是首选路径，成功时语义不变；只有运行时不可用/响应丢失类错误才进入回退，
参数、命名、权限类业务错误直接冒泡。回退顺序是「先确认、后建立、再取回」——期望路径已是该仓库的 git 工作树且 HEAD 等于 `worktreeBaseRef` 对应基线时
直接取回身份，不重复建立；否则用 `git worktree add <path> -b <name> <baseRef>`（分支已存在时复用该分支）建立，再逐行执行仓库 setup 脚本。
随后从 `orca worktree list --json` 取回 `repoId` 相同、非主工作树、路径唯一的记录，并校验 `id`/`path`/`head` 与请求基线一致。
任一步不成立都 fail-closed：错误保留原始 Orca 文本并提示 `externalWorktreeVisibility`。此时先对账实时事实，不要换幂等键盲重试。
回退的 git 建立、setup 与身份取回在 `lock.withoutLock` 中执行；复锁后立即重验工作项状态、当前尝试、main HEAD 和违规集，有任一漂移就在创建 Task 或启动 worker 前拒绝。

前提：回退依赖仓库设置 `externalWorktreeVisibility: "show"`（`orca repo list --json` 可见）。关闭时 `git worktree add` 建立的工作树不会进入 Orca 列表，
身份必然取不回，控制器按 fail-closed 处理；不要绕过它自行登记 Orca 私有元数据。

延迟副作用：判失败后先用 `orca worktree list --json` 看期望路径是否已经出现。控制器确认身份后不再等待 Orca，之后到达的副作用只会多出带 `-2` 一类后缀的工作树与分支；
这些多出来的工作树在回收阶段按**完整 worktree ID** 处理（§9），不用 display name 猜测。

setup 失败：回退执行仓库 setup 脚本时，任一行非零退出或超时都以 `worktree_setup_failed` 终止该次派发，不创建 Task、不启动 worker，也不返回成功供给。
保留失败命令、原始错误和已建立的工作树供对账；按 §2 修复并重新执行 setup，确认依赖与 OpenSpec 工具就绪后，再重新读取状态并使用新幂等键派发。

## 7. 活动 worktree 同步

共享编排策略、Schema、公共脚本或基础契约合入 main 后，逐个同步保留的活动 worktree：

1. 确认没有活动 writer，记录同步前 HEAD，并确认 clean；脏树停止同步。
2. 将 main merge 到该 feature 分支。
3. 无冲突时运行受影响的最小检查，并以新 HEAD 更新 v2 信封。
4. 有冲突时保留 merge 状态，读取冲突双方的规格、提交意图和调用方；不能直接选 ours/theirs。
5. 语义冲突解决后运行受影响检查，并触发 Targeted Auditor；旧 PASS 不适用于新产物。
6. 重新运行 status，确认 `resumeQueue`、依赖阻塞和 HEAD 一致。

Agent 之间不复制未提交文件。同步必须形成可审阅 Git 检查点后再交接。

## 8. 共享机械接缝

多个 change 同时触及中央注册、迁移清单、公共 fixture 或 package exports 时，业务实现者只提交其获批范围；主调度在最终集成时统一处理机械接缝。新增 PostgreSQL migration 时至少核对：

- migration manifest 的序号和路径排序；
- `packages/adapters/test/postgres/postgres-foundation.test.ts` 的发现与约束；
- `packages/adapters/test/auth/fixture.ts` 的测试库迁移列表；
- package exports 与实际调用方是否一致。

这些调整只允许落实已批准设计。任何顺序、事务、权限或公共 Schema 的语义决定仍需升级。

## 9. 回收

回收前确认：change 的 verification（若 schema 声明）已完成且随 change 归档、feature commit 已进入 main、main 验证通过、worktree clean、checkpoint 已成功收口、没有活动 writer 或违规，并且状态将该项列为 `reclaimable`，或仅因状态中可精确识别的终态 terminal 残留而列为 `stale`。

调用 `riskflow_integrate` 回收。对上述 terminal 残留，控制器会关闭状态记录的精确 handle，重新采集状态，并仅在同一节点变为 `reclaimable` 且完整 worktree ID 未变化时执行删除。任一前提漂移都停止，不使用 force。完成后同时核对：

```bash
git worktree list --porcelain
orca worktree list --repo <full-repo-id> --json
pnpm orchestration:status --json
pnpm orchestration:check
```

不得直接运行 terminal close 或 worktree rm，不得使用 `git clean`、手工删除目录或 display name 猜测目标。分支删除与 worktree 回收是两个决定；没有明确授权时保留分支。
