# RiskFlow 实现与调度执行 Handbook

## 1. 用途与当前接管点

本文供 RiskFlow 大型 OpenSpec 路线的主调度 Agent 使用。它规定模型分工、执行图、worktree 与提交检查点、Orca 生命周期、验证门和异常升级方式。领域事实仍以 `AGENTS.md`、已归档 `openspec/specs/` 和对应专利为准；39-change 路线以 `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md` 为准。

当前接管点：

- `main` 已完成并归档 C00 `establish-openspec-engineering-baseline`。
- `main` 已完成并归档 C01 `define-domain-contract-kernel`。
- C01 主 spec 位于 `openspec/specs/domain/contract-kernel/spec.md`。
- 当前没有已批准的 C02 工件；下一项只能是 C02 `define-module-interfaces-events-and-workflows`。
- G0 仍是串行闸门。C02 归档前不得开放业务并行 worktree。
- 不推送远端；远端操作必须由用户另行授权。

## 2. 固定角色与模型

| 角色 | 模型与强度 | 负责 | 不负责 |
| --- | --- | --- | --- |
| 主调度 Agent | `gpt-5.6-luna` / `max` | 维护执行图；创建 Run/Task/worktree；监控与问答；审阅范围；提交、合并、清理；处理依赖清单与锁文件 | 起草 OpenSpec change；替代验证 Agent 做正式验收；编写生产代码 |
| 规划与验证 Agent | `gpt-5.6-sol` / `high` | 起草 proposal/specs/design/tasks；拆解执行任务；核对专利与主 specs；实现后独立验证并写 verification 报告 | 生产代码；依赖安装；归档；调度监控 |
| 代码执行 Agent | `gpt-5.6-luna` / `max` | 按已批准 change 使用 `openspec-apply-change` 实现；运行最小验证；按反馈修复 | 更改规划、接口、依赖、范围；归档；Git 提交 |
| 简单杂活 Agent | OMP + `minimax-code-cn/MiniMax-M3` / `high` | 无判断冲突的机械归档、资料搜索、证据整理、tracker 更新 | change 起草、架构设计、任务规划、代码/测试/配置/迁移、冲突处理、验收判断 |

角色以任务性质区分，同一模型不能借身份重叠绕过分工。主调度 Agent 若发现需要语义规划或正式验证，必须派给 Sol high；Sol 发现需要改代码，必须退回主调度 Agent，再派 Luna max。

## 3. 授权与单写者原则

- 新 session 开始时先确认用户已授权本轮 Git commit、分支、合并、worktree 和依赖操作；handbook 本身不授予权限。
- 同一 worktree 同一时刻只有一个写者。验证 Agent 默认只读；若要写 `verification.md`，代码 Agent 必须已停止写入。
- Worker 不执行 `git commit`、merge、rebase、archive 或 push。主调度 Agent 审阅后提交。
- 不把未提交文件当作 worktree 间传递机制。任何角色交接前都必须由主调度 Agent形成提交检查点。
- 不覆盖用户未提交改动。发现不属于当前 change 的改动立即停止并升级。

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
Sol high 独立 verify；失败则返回 Luna max 修复
  ↓
主调度 Agent 提交 verification checkpoint
  ↓
feature → main（--no-ff），main 冻结安装 + pnpm verify
  ↓
M3 high 机械 sync/archive；有冲突或判断项则升级 Sol high
  ↓
主调度 Agent 复验 OpenSpec、提交 archive checkpoint、清理 worktree
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

Luna max 只能实现 tasks 中已批准的文件和行为。它必须使用 `openspec-apply-change`，不启动开发服务器，不归档，不提交。发现 design 缺口时通过 Orca `ask` 升级；不能自行补字段、加依赖或扩大 Non-goals。

### 5.4 验证门

Sol high 在 implementation checkpoint 后独立执行 `openspec-verify-change`：

- 对照每条 requirement、scenario、RI/RA、权限、失败、幂等、版本、证据和审计语义；
- 检查代码与 design 文件所有权、Non-goals、依赖方向；
- 运行该 change 的最小验证，并判断是否需要根 `pnpm verify`；
- 只写验证报告和任务状态，不修代码；
- 发现缺陷时给出精确文件/行为/验证证据，由主调度 Agent创建 Luna 修复任务；修复后重新验证。

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
3. Sol 验证只针对固定 implementation commit；修复会产生新 commit，旧验证失效。
4. feature 合并前执行 `git diff --check`、确认无越界文件、确认所有提交均在 feature branch。
5. archive 提交后用 `git merge-base --is-ancestor <feature-head> main` 确认实现已集成，再移除 worktree。

禁止使用 `git reset --hard`、`git checkout --`、强制清理或未解析变量的删除命令。主调度 Agent不从一个 worktree 复制未提交文件到另一个；需要共享时提交后 merge/cherry-pick，优先按既定分支合并。

## 7. Orca 操作协议

### 7.1 session 预检

新主调度 Agent先执行：

```bash
git status --short
git log --oneline --decorate -8
openspec list --json
orca repo show --repo id:d4349f30-1c7e-4777-b16d-f259481b0121 --json
orca worktree list --repo id:d4349f30-1c7e-4777-b16d-f259481b0121 --json
```

不要复用旧 session 的 terminal handle、Run 或 Dispatch。用当前 Orca terminal 创建新 Run；所有协调命令显式传当前 `ORCA_TERMINAL_HANDLE`，所有 worker 使用完整 worktree ID。

### 7.2 setup hook 当前门禁

Orca repo 的有效 setup hook 应只有：

```bash
pnpm install --frozen-lockfile
```

当前 `orca repo show` 仍显示第二行 `openspec init --tools codex,omp`；它无效，因为 OpenSpec CLI 不接受工具名 `omp`，并会令 setup 以非零状态结束。仓库也已初始化 OpenSpec，无需每个 worktree 重跑 init。创建下一个正式 worktree 前，先用 Orca UI 删除该行，再创建一次受控 worktree，以 `--setup run` 验证安装成功且 Git clean。Orca CLI 当前没有 repo hook setter。

### 7.3 精确 Agent 启动

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
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

收到 question 必须基于工件/代码给出明确答案。`check --wait` 超时只是检查点，不是失败；先看任务状态和 terminal 活性，不能自动重复派发。

收到唯一 `worker_done` 后：

1. 处理完整 Delivery；
2. 决定复用 terminal 还是 `worker-release`；
3. 外部 terminal 的 release 会返回 `retained / external_terminal`，确认 transcript 和结果后只关闭该 Dispatch 创建的精确 tab；
4. 最后 acknowledge Delivery。

### 7.4 OMP + MiniMax-M3

Orca 当前不能通过 `worker-start --agent omp --model ...` 选择 OMP 模型与思考强度。先在 OMP 配置/启动界面明确选中 `minimax-code-cn/MiniMax-M3` 和 `high`，用自定义 OMP terminal 启动，确认模型后再通过 `worker-start --terminal` 纳入 Dispatch。无法确认模型或 high 时不得把结果记为已验证；可继续做纯机械只读工作，但要在回报中标明限制。

M3 prompt 必须包含精确路径、确定步骤、禁止修改区域和升级条件。不要让它“自行判断是否可归档”“完善 change”或“顺便修复”。

### 7.5 computer-use 边界

当前 Orca 桌面窗口的 accessibility tree 只暴露顶层 frame，截图也不能可靠读取内部 TUI。不要用 computer-use 操作 Orca 内部终端、模型选择或设置；使用 Orca CLI。只有 CLI 不提供的 repo setup hook 仍由用户在 Orca UI 手动配置。

## 8. 任务规格模板

每个 Orca Task 至少写清：

- change 名、工作树完整路径/ID、base commit；
- 必读工件和技能；
- 允许修改的文件/目录；
- 禁止修改的共享区域；
- 输入检查点 commit；
- 要交付的可观察行为；
- 逐条验证命令与通过条件；
- 何时使用 `ask` / `escalation`；
- 是否允许写 verification 报告；
- 禁止提交、归档、扩大依赖与启动服务；
- `worker_done` 的文件列表、验证摘要和剩余事项。

一句“实现 Cxx”不构成可派发任务。规划 task、实现 task、验证 task、归档 task 必须分开，依赖由 `--deps` 表达。

## 9. 完成判定与失败处理

change 完成需要：

- 已批准工件与实现一致，Non-goals 未被带入；
- 高价值验证、权限/失败/幂等/版本/证据/审计语义有证据；
- 无生产 Mock、占位、临时回退或第二套事实源；
- Sol verify 通过；
- feature 和 `main` 复验通过；
- 主 specs 已同步，change 已归档；
- Git clean，feature commit 已是 `main` 祖先，worktree 已清理；
- frontier 已重新计算，但只在用户要求继续时派发下一项。

同一阻塞连续三次且无法在既定权限内推进时，停止重试并向用户报告。难、慢、测试失败或需要修复不算阻塞；必须先用同一 change 和同一责任角色解决。

## 10. 下一 session 的首个动作

1. 以 Luna max 启动新的主调度 session，先读 `AGENTS.md`、本 handbook 和路线文档。
2. 确认 `main` clean，C00/C01 已归档，当前无活动 change/worker。
3. 请用户修正 setup hook，或确认已删除无效的 OpenSpec init 行；做一次受控 setup 验证。
4. 只创建 C02 `define-module-interfaces-events-and-workflows` worktree。
5. 建立新 Run，把 C02 规划 task 派给 Sol high；主调度 Agent不自行起草 change。
6. Sol 工件通过审阅并形成 planning checkpoint 后，才派 Luna max 实现。

完成 C02 并归档后再重新计算 G1 frontier。不要提前建立 C03～C10 的长期工作树。
