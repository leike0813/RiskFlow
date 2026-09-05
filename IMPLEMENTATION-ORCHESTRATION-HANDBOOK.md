# RiskFlow 实现与调度执行 Handbook

## 1. 用途与当前接管点

本文供 RiskFlow 大型 OpenSpec 路线的主调度 Agent 使用。它规定模型分工、执行图、worktree 与提交检查点、Orca 生命周期、验证门和异常升级方式。领域事实仍以 `AGENTS.md`、已归档 `openspec/specs/` 和对应专利为准；39-change 路线以 `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md` 为准。

当前接管点：

- `main` 已完成并归档 C00–C10（C00 `establish-openspec-engineering-baseline`、C01 `define-domain-contract-kernel`、C02 `define-module-interfaces-events-and-workflows`、C03 `deliver-postgresql-outbox-and-checkpoint-foundation`、C04 `deliver-content-addressed-artifact-store`、C05 `deliver-llamacpp-model-gateway`、C06 `deliver-local-identity-and-project-authorization`、C07 `deliver-review-and-audit-runtime`、C08 `deliver-unified-bounded-agent-runtime`、C09 `deliver-http-command-query-and-sse-shell`、C10 `deliver-web-shell-and-interaction-primitives`）。
- `openspec/changes/archive/` 共 14 项 = C00–C10 + 4 个辅助/修复 change（`configure-pnpm-build-script-policy`、`fix-postgresql-test-migration-loader-compatibility`、`deliver-structured-orchestration-status` 等）。
- C01 主 spec 位于 `openspec/specs/domain/contract-kernel/spec.md`。
- C02 主 spec 位于 `openspec/specs/domain/module-interfaces-events-workflows/spec.md`。
- C03 主 spec 位于 `openspec/specs/platform/postgresql-outbox-checkpoint-foundation/spec.md`。
- G0、G1 已通过；C03–C10 已全部合并、归档；无活动 change/worker。当前完整 frontier 为 C11 `deliver-engineering-context-and-source-registry` 与 C16 `deliver-process-model-and-association-adapters`，由主调度按资源和路线选择派发，不能预建长期 worktree。
- C09/C10 的 feature worktree 已按 §6.1 回收；Git 与 Orca 均无残留 feature worktree。
- 状态观察器以当前 `main` 提交中的 OpenSpec archive 作为持久完成事实；Orca 仅提供现存 feature worktree、worker 与 Dispatch 均非终态或关联 live terminal 的实时状态。已脱离实时对象的旧 Task 只进入 `diagnostics`，不得阻断 frontier 或 `orchestration:check`。
- 不推送远端；远端操作必须由用户另行授权。

## 2. 固定角色与模型


| 角色          | 模型与强度                                       | 负责                                                                                                               | 不负责                                        |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 主调度 Agent   | 推荐：`gpt-5.6-luna`/ `max`（非固定，可以是任何有长程agent能力的模型）                   | 维护执行图；创建 Run/Task/worktree；监控与问答；审阅范围；提交、合并、清理；处理依赖清单与锁文件                                                        | 起草 OpenSpec change；替代验证 Agent 做正式验收；编写生产代码 |
| 规划与验证 Agent | `gpt-5.6-sol` / `high`                      | 起草 proposal/specs/design/tasks；拆解执行任务；核对专利与主 specs；实现后独立验证并写 verification 报告；对自己发现的局部实现缺陷在当前未结束的验证任务内直接修复并完成局部验证 | 首轮生产实现；依赖安装；归档；调度监控；不得改变已批准目标、接口设计或范围      |
| 代码执行 Agent  | `gpt-5.6-luna` / `max`                      | 按已批准 change 使用 `openspec-apply-change` 实现；运行最小验证；当 Sol 无法在受限边界修复时承担升级修复                                          | 更改规划、接口、依赖、范围；归档；Git 提交                    |
| 简单杂活 Agent  | OMP + `minimax-code-cn/MiniMax-M3` / `high` | 无判断冲突的机械归档、资料搜索、证据整理、tracker 更新                                                                                  | change 起草、架构设计、任务规划、代码/测试/配置/迁移、冲突处理、验收判断  |


角色以任务性质区分，同一模型不能借身份重叠绕过分工。主调度 Agent 若发现需要语义规划或正式验证，必须派给 Sol high；Sol 复核发现已批准 change 内的局部实现缺陷时，必须在当前尚未结束的验证任务中直接修复并完成局部验证，随后由主调度 Agent审阅和收口；只有超出修复边界时才退回主调度 Agent重新安排，不再派 Sol 做第二次复检。

## 3. 授权与单写者原则

- 新 session 开始时先确认用户已授权本轮 Git commit、分支、合并、worktree 和依赖操作；handbook 本身不授予权限。
- 同一 worktree 同一时刻只有一个写者。验证 Agent 默认只读；若当前验证任务发现已批准 change 内的局部实现缺陷，原 Sol 可在该任务仍处于活动状态时临时写入精确允许范围并完成局部验证，主调度 Agent随后审阅并形成新检查点，不再派 Sol 二次复检。
- Worker 不执行 `git commit`、merge、rebase 或 push；按 5.5/7.4 明确派发的 M3 仅执行精确的机械归档移动，提交仍由主调度 Agent审阅后完成。
- 不把未提交文件当作 worktree 间传递机制。任何角色交接前都必须由主调度 Agent形成提交检查点。
- 不覆盖用户未提交改动。发现不属于当前 change 的改动立即停止并升级。
- 委派 Agent 处于活动状态时，除明确的错误、`escalation`、需要回答的 `question`、连接/进程失效或用户要求外，原则上不得发送终端输入、停止 Agent 或释放 Dispatch；正常等待只使用事件等待，`worker_done` 由 Agent 自然结束。
- 一个 Sol session 只服务一个独立规划或验证任务。禁止把已结束、已暂停、已释放或长时间闲置的 Sol terminal、Run、Dispatch 或上下文用于新任务；剩余 context window 不可见，间隔后的缓存状态也不可假定，避免把剩余容量所剩无几且缓存已冷却的上下文重新拉起并一次性增加大量未缓存输入。当前活动验证任务内的直接修复属于同一任务的连续执行，不属于 session 复用。

## 4. 静态依赖图与滚动展开

完整图：

```text
C00 → C01 → C02
                 ├─ C03 → C04 → C05
                 ├─ C03 → C06 → C07 → C08
                 ├─ C03 + C06 → C09 → C10
                 └─ G0

数据线：C11 → {C12, C13, C14} → C15
治理线：C16 → C18
识别知识：{C15, C16, C08} → C17
评估知识：{C15, C16, C18, C08} → C19

识别：C20 → C21 → C22 → C23 → C24
评估：C25 → C26 → C27 → C28 → C29
汇合：{C24, C25..C29} → C30 → C31

界面：C32、C33、C34、C35
质量：C36
收口：{C32..C36} → C37 → C38
```

主调度 Agent 每次只物化当前 frontier 和相邻下一层，禁止一次创建 39 个长期 worktree。直接依赖必须已归档到主 specs；分支名、Orca display name 不能代替完整 worktree ID、base HEAD 和 change identity。

并发限制：

- G0 只允许一个 lane。
- G1 最多两个互不冲突的实现 worktree。
- G2 关键路径最多两个，识别/评估两主干最多各一个写者。
- G3/G4 只有目录所有权和公共入口稳定后才提高到三个。
- 根清单、锁文件、`openspec/config.yaml`、中央注册文件和主 specs 始终由主调度 Agent串行处理。

## 5. 每个 change 的执行子图

```text
frontier 就绪
  ↓
创建 feature worktree，记录 base HEAD
  ↓
Sol high 起草并自检 proposal/specs/design/tasks
  ↓
主调度 Agent 审阅并提交 planning checkpoint
  ↓
主调度 Agent 处理已批准依赖并提交 dependency checkpoint（如有）
  ↓
Luna max 实现 + 最小验证
  ↓
主调度 Agent 审阅范围并提交 implementation checkpoint
  ↓
Sol high 独立 verify
  ↓
发现局部实现缺陷？──否──→ 主调度 Agent升级或重新规划
  │是
  ↓
当前活动 Sol 任务直接修复 + 局部验证
  ↓
Sol 在同一任务中形成最终报告
  ↓
主调度 Agent 审阅并提交新的 implementation checkpoint；不复用 Sol、不派第二次 Sol 复检
  ↓
主调度 Agent执行必要门禁并提交 verification checkpoint
  ↓
feature → main（--no-ff），main 冻结安装 + pnpm verify
  ↓
M3 high 机械 sync/archive；有冲突或判断项则升级 Sol high
  ↓
主调度 Agent 复验 OpenSpec、提交 archive checkpoint、按 §6.1 立即回收 worktree
```

### 5.1 规划门

Sol high 必须先读：

1. `AGENTS.md` 和本 handbook；
2. 当前主 specs、直接依赖的归档 change；
3. 路线中该 change 的行、依赖和所有权；
4. 相关专利与研究方案；
5. OpenSpec artifact instructions。

规划交付必须解决 module interface、Schema、状态、错误、权限、事务、审计、文件清单、依赖版本和测试层次；不存在会改变任务拆分的 Open Questions。Sol 不提交，主调度 Agent以 `docs(openspec): ...` 提交。

### 5.2 依赖门

新增依赖由 Sol 在 proposal/design 中写明精确版本、用途、许可证、官方来源、离线方式和退出条件。主调度 Agent负责修改 manifest、`config/dependency-policy.json`、`pnpm-lock.yaml`，执行冻结安装与政策检查后单独提交。代码 Agent不得运行会改锁文件的安装命令。

### 5.3 实现门

Luna max 首轮只能实现 tasks 中已批准的文件和行为。它必须使用 `openspec-apply-change`，不启动开发服务器，不归档，不提交。发现 design 缺口时通过 Orca `ask` 升级；不能自行补字段、加依赖或扩大 Non-goals。Sol 验证任务必须优先在自身仍活动的任务内修复已批准范围的局部错误；只有 Sol 明确升级架构、规划、范围、权限、依赖或工具问题，或活动任务无法继续时，主调度 Agent才另派 Luna 接管。

### 5.4 验证门

Sol high 在 implementation checkpoint 后独立执行 `openspec-verify-change`：

- 对照每条 requirement、scenario、RI/RA、权限、失败、幂等、版本、证据和审计语义；
- 检查代码与 design 文件所有权、Non-goals、依赖方向；
- 运行该 change 的最小验证，并判断是否需要根 `pnpm verify`；
- 首轮复核默认只读并写出精确报告；任务勾选和 Git 检查点由主调度 Agent负责；
- 发现属于已批准契约内、文件范围内的局部实现缺陷时，当前仍活动的 Sol 任务直接修复，运行相关回归检查并在最终 `worker_done` 中报告修复差异；不得借修复改变需求、接口设计、依赖或 Non-goals；
- 主调度 Agent审阅 Sol 修复并提交新的 implementation checkpoint，随后由主调度 Agent运行必要门禁并收口；不得重置、复用已结束的 Sol session，也不得因普通局部验证失败派发 Sol 二次复检；
- 若缺陷属于 proposal/spec/design 不一致、架构/范围/权限判断、依赖或工具故障，Sol 不自行改规划，立即通过 Orca `ask`/`escalation`交回主调度 Agent；只有主调度 Agent明确升级后才重新派发。

验证通过不自动授权归档。主调度 Agent仍需审阅 diff、提交、合并并在 `main` 复验。

### 5.5 归档门

M3 只在以下条件全部满足时归档：工件完整、tasks 全勾选、Sol verify 通过、实现已合并、`main` 复验通过、delta 与 main spec 同步无冲突。它按 `openspec-archive-change` 做机械移动和 tracker 更新，不做语义合并判断。

若主 spec 已存在且 delta 含 MODIFIED/REMOVED/RENAMED、同步结果不明显、出现规格漂移或冲突，M3 立即停止；由 Sol high 处理 sync/验证，再交回主调度 Agent提交。

## 6. Git 与 worktree 检查点

每个 change 至少包含以下可追踪提交；无对应内容时可省略中间项，不得把所有阶段压成一个提交：

```text
docs(openspec): 定义 <change>
build(...): 锁定 <dependency>          # 仅有依赖变化
feat(...): 实现 <capability>           # 或 fix/refactor
test(...): 验证 <capability>           # 验证报告单独形成实质改动时
merge: 集成 <change>
docs(openspec): 归档 <change>
```

交接规则：

1. Sol 规划结束 → 主调度 Agent审阅、提交，工作树 clean。
2. Luna 实现结束 → 主调度 Agent审阅、提交，工作树 clean。
3. Sol 验证只针对固定 implementation commit；若发现局部实现缺陷，必须在当前活动验证任务内直接修复并完成局部验证，主调度 Agent形成新的 implementation checkpoint 后由主调度 Agent收口；不得重置或复用已结束的 Sol session，也不再派 Sol 二次复检。
4. feature 合并前执行 `git diff --check`、确认无越界文件、确认所有提交均在 feature branch。
5. archive 提交后用 `git merge-base --is-ancestor <feature-head> main` 确认实现已集成；按 §6.1 完成 worker/terminal 收口和 worktree 回收。

禁止使用 `git reset --hard`、`git checkout --`、`git clean` 或未解析变量的删除命令。worktree 回收默认不使用强制选项；只有用户明确授权丢弃已确认的临时/无效未提交产物时，才可按 §6.1 使用 Orca 的 `--force`，不得借此掩盖未知改动。主调度 Agent不从一个 worktree 复制未提交文件到另一个；需要共享时提交后 merge/cherry-pick，优先按既定分支合并。

### 6.1 Worktree 回收

一个 change 完成并合并回 `main` 后，不再为观察或保留验证上下文长期占用 feature worktree。满足以下条件即进入回收：

1. feature 已使用 `--no-ff` 合并到 `main`，`main` 冻结安装与 `pnpm verify` 已通过。
2. archive checkpoint 已提交，且 `git merge-base --is-ancestor <feature-head> main` 通过。
3. worker 已收到最终 `worker_done`，Delivery 已 acknowledge；对应 Run、Dispatch 和 Agent session 已按 §7.3 收口，不得仍有活动写者。
4. `git status --short` 已审阅。未知的未提交改动必须保留并升级；已明确确认可丢弃的临时/无效产物才可随回收删除。

回收顺序固定为：

```bash
orca terminal list --worktree id:<full-worktree-id> --json
orca terminal stop --worktree id:<full-worktree-id> --json   # 仅在任务已结束且仍有残留 terminal 时执行
orca worktree rm --worktree id:<full-worktree-id> --json
git worktree list --porcelain
orca worktree list --repo id:d4349f30-1c7e-4777-b16d-f259481b0121 --json
```

回收必须使用完整 worktree ID，不能用 display name 猜测目标；回收后确认 Git 与 Orca 均无该 feature worktree。若存在已授权丢弃的已确认临时/无效产物，可将最后的 `worktree rm` 改为 `--force`，并在 Delivery 或协调记录中列出被丢弃内容；不得使用 `git clean` 或手工删除目录替代 Orca 回收。分支是否删除与 worktree 回收独立，按历史保留策略另行决定。

## 7. Orca 操作协议

### 7.1 session 预检

新主调度 Agent先执行：

```bash
git status --short
git log --oneline --decorate -8
openspec list --json                    # 仅作 main 基线/归档事实
orca repo show --repo id:d4349f30-1c7e-4777-b16d-f259481b0121 --json
orca worktree list --repo id:d4349f30-1c7e-4777-b16d-f259481b0121 --json
pnpm orchestration:status --json        # 按每个 worktree cwd 汇总活动状态
```

状态查询不能只读取 `main`。活动 change 的 OpenSpec、Git HEAD、Task/Run 和 worker 事实必须按 Orca 返回的完整 worktree ID，在对应 feature worktree 中采集；feature worktree 继承的 archive 不用于关联 change。当前 `main` 提交中的 OpenSpec archive 是完成事实，活动集成信封中的旧 `mainHead` 只要仍是当前 HEAD 的祖先即有效。根目录提供两个只读入口：

```bash
pnpm orchestration:status --json
pnpm orchestration:check
```

查询结果以 `config/orchestration/execution-graph.json` 的静态 Manifest 为节点和依赖事实源，以当前结构化 Task result 为实时执行事实源；Run 必须按 cursor 完整分页。自然语言标题、报告正文、历史孤立 Task 和 main 缺失的 OpenSpec change 不得用于反推活动状态。

### 7.2 Task 执行信封

创建 planning、implementation、verification 或 archive Task 后，必须立即写入结构化 result 信封。最小身份键为：

```json
{
  "schemaVersion": 1,
  "changeId": "Cxx",
  "taskKind": "implementation",
  "phase": "implementation",
  "worktreeId": "<repo-id>::<absolute-worktree-path>",
  "baseHead": "<commit>",
  "head": "<commit>",
  "outcome": "succeeded",
  "evidenceRefs": [],
  "main": {
    "mergeCommit": null,
    "mainHead": null,
    "verification": "pending",
    "archiveCommit": null
  }
}
```

阶段收口、主线复验和归档后，用 `task-update --result` 更新同一信封；报告正文只补充证据，不承载状态字段。`main.verification` 只允许 `pending`、`passed` 或 `failed`。`head` 与当前 feature worktree HEAD 不一致时状态为 `unknown`，不得继续自动归档或回收。

不要复用旧 session 的 terminal handle、Run 或 Dispatch。一个独立任务始终创建新的 Sol session；不要假定旧 context window 的剩余容量或缓存仍可用，尤其不要在长间隔后复用。当前活动验证任务内的直接修复是同一任务的连续执行，不是新任务复用。用当前 Orca terminal 创建新 Run；所有协调命令显式传当前 `ORCA_TERMINAL_HANDLE`，所有 worker 使用完整 worktree ID。

### 7.3 setup hook

Orca repo 当前配置为：

```bash
pnpm install --frozen-lockfile
openspec init --tools codex,oh-my-pi
```

该 hook 已在一次全新受控 worktree 中以 `--setup run` 验证：冻结安装成功，OpenSpec 对 Codex 与 Oh My Pi 均完成 setup，Git 保持 clean。后续正式 worktree 继续使用 `--setup run`；只有 hook 内容变化或 setup 报错时才重新做一次受控验证。`oh-my-pi` 是 OpenSpec CLI 工具名，不能写成 `omp`。

### 7.4 精确 Agent 启动

需要自定义模型/强度时先创建 terminal，再纳入 Dispatch：

```bash
# Luna max
codex --model gpt-5.6-luna -c model_reasoning_effort="max" -a never -s danger-full-access

# Sol high
codex --model gpt-5.6-sol -c model_reasoning_effort="high" -a never -s danger-full-access
```

等待 `tui-idle`，并从状态栏确认模型与强度。新目录出现信任提示时，分开发送 `1` 和 Enter。随后：

```bash
orca orchestration task-create --spec '<bounded task>' --json
orca orchestration worker-start --task <task-id> --worktree <full-worktree-id> --terminal <handle> --json
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 240000 --json
```

收到 question 必须基于工件/代码给出明确答案。默认以约 240 秒作为一次主协调等待窗口，在降低无谓轮询 token 消耗的同时保持缓存热度；超时只做一次状态/活性检查后重新进入等待，不做高频 screen/status 轮询。错误、`escalation`、`question` 或 `worker_done` 由事件立即唤醒，不视为轮询。`check --wait` 超时只是检查点，不是失败；不能自动重复派发。

收到唯一 `worker_done` 后：

1. 处理完整 Delivery；
2. 检查该 Sol 验证任务的 Delivery：prompt 是否已要求批准范围内局部缺陷在当前活动任务中直接修复并完成局部验证，且最终 `worker_done` 已报告修复差异；因此收到 `worker_done` 后不重置、不复用该 Sol session，也不派第二次 Sol 复检；
3. 若 `worker_done` 仍为 FAIL，按升级报告处理：规划、架构、范围、权限、依赖或工具问题由主调度 Agent决定重新规划或另派有界 Luna；不能把已结束的 Sol session当修复会话；
4. 主调度 Agent审阅最终 diff 并形成 implementation/verification checkpoint；运行必要门禁后，最终通过或明确升级，再决定 `worker-release`；外部 terminal 的 release 可能返回 `retained / external_terminal`，确认 transcript 和结果后只关闭该 Dispatch 创建的精确 tab；
5. 最后 acknowledge Delivery。

### 7.5 OMP + MiniMax-M3

Orca 当前不能通过 `worker-start --agent omp --model ...` 选择 OMP 模型与思考强度。先在 OMP 配置/启动界面明确选中 `minimax-code-cn/MiniMax-M3` 和 `high`，用自定义 OMP terminal 启动，确认模型后再通过 `worker-start --terminal` 纳入 Dispatch。无法确认模型或 high 时不得把结果记为已验证；可继续做纯机械只读工作，但要在回报中标明限制。

M3 prompt 必须包含精确路径、确定步骤、禁止修改区域和升级条件。不要让它“自行判断是否可归档”“完善 change”或“顺便修复”。

### 7.6 computer-use 边界

当前 Orca 桌面窗口的 accessibility tree 只暴露顶层 frame，截图也不能可靠读取内部 TUI。不要用 computer-use 操作 Orca 内部终端、模型选择或设置；使用 Orca CLI。只有 CLI 不提供的 repo setup hook 仍由用户在 Orca UI 手动配置。

## 8. 任务规格模板

每个 Orca Task 至少写清：

- change 名、工作树完整路径/ID、base commit；
- 创建 Task 后用 `orca orchestration task-update --result '<execution-envelope>'` 登记结构化执行信封；阶段收口时更新 `phase`、`head`、`outcome` 和 `evidenceRefs`，main 集成后再填写 `mergeCommit`、`mainHead`、`verification`、`archiveCommit`；
- `taskKind` 只允许 `planning`、`implementation`、`verification`、`archive`，不得从 task 标题或 Delivery 正文解析阶段；
- 必读工件和技能；
- 允许修改的文件/目录；
- 禁止修改的共享区域；
- 输入检查点 commit；
- 要交付的可观察行为；
- 逐条验证命令与通过条件；
- 何时使用 `ask` / `escalation`；
- 是否允许写 verification 报告；
- Sol 验证失败时是否必须在当前活动任务内直接修复并完成局部验证；`worker_done` 后不复用 session、不派二次 Sol 复检；允许修改的精确文件和新检查点责任；
- 禁止提交、归档、扩大依赖与启动服务；
- `worker_done` 的文件列表、验证摘要和剩余事项。

一句“实现 Cxx”不构成可派发任务。规划 task、实现 task、验证 task、归档 task 必须分开，依赖由 `--deps` 表达。

## 9. 完成判定与失败处理

change 完成需要：

- 已批准工件与实现一致，Non-goals 未被带入；
- 高价值验证、权限/失败/幂等/版本/证据/审计语义有证据；
- 无生产 Mock、占位、临时回退或第二套事实源；
- Sol 验证任务已完成局部修复/验证并最终报告通过；主调度 Agent已完成最终门禁，不需要第二次 Sol 复检；
- feature 和 `main` 复验通过；
- 主 specs 已同步，change 已归档；
- Git clean，feature commit 已是 `main` 祖先，worktree 已清理；
- 回收前运行 `pnpm orchestration:check`；它只读检查 Manifest、各 worktree、本地 OpenSpec、Git、Orca Task/Run 和 main 归档事实，不自动修改或删除状态；
- frontier 已重新计算，但只在用户要求继续时派发下一项。

同一阻塞连续三次且无法在既定权限内推进时，停止重试并向用户报告。难、慢、测试失败或需要修复不算阻塞；必须先用同一 change 和同一责任角色解决。

验证失败按以下顺序处理：

1. Sol 在当前活动验证任务中先判断是批准范围内局部实现缺陷，还是规划/架构/范围/权限/依赖/工具问题。
2. 局部实现缺陷由当前活动 Sol 任务直接修复并运行回归；修复完成后以最终 `worker_done` 报告，主调度 Agent审阅、提交、门禁收口，不再派 Sol 二次复检。
3. 规划/架构/范围/权限/依赖/工具问题由 Sol 立即 `escalation`；主调度 Agent决定重新规划或另派有界 Luna。活动任务已 settled 后不得复用其 terminal/Run/Dispatch。
4. 若活动任务因连接/进程错误无法继续，按错误处理；不要把普通超时视为打断理由。

## 10. 下一 session 的首个动作

1. 以 Luna max 启动新的主调度 session，先读 `AGENTS.md`、本 handbook 和路线文档。
2. 确认 `main` clean，C00–C10 已归档（archive 目录 14 项），主 specs 与路线状态一致，当前无活动 change/worker。
3. 用 `orca repo show` 确认 setup hook 仍与 §7.2 一致；若未变化，直接沿用已验证配置。
4. 根据路线重新计算当前 frontier，只为当前 change 创建 worktree 和 Run，不预建后续长期 worktree。
5. 把新 change 的规划 task 派给 Sol high；主调度 Agent不自行起草 change。
6. Sol 工件通过审阅并形成 planning checkpoint 后，才派 Luna max 实现；实现复核若发现批准范围内局部缺陷，由当前仍活动的 Sol 任务直接修复并做局部验证，随后主调度 Agent门禁收口，不再派 Sol 二次复检；已结束 session 不复用。

完成当前 change 并归档后再重新计算下一 frontier。