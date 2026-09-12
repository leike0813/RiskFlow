# RiskFlow 实现与调度执行 Handbook

## 1. 用途与当前接管点

本文供 RiskFlow 大型 OpenSpec 路线的主调度 Agent 使用。它规定模型分工、执行图、worktree 与提交检查点、Orca 生命周期、验证门和异常升级方式。领域事实仍以 `AGENTS.md`、已归档 `openspec/specs/` 和对应专利为准；39-change 路线以 `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md` 为准。

当前接管点：

- `main` 已完成并归档 15 个路线 change：C00–C12、C14、C16。
- `openspec/changes/archive/` 共 21 项 = 15 个路线 change + 6 个辅助/修复 change（`configure-pnpm-build-script-policy`、`deliver-structured-orchestration-status`、`evolve-review-audit-approval-proof`、`fix-postgresql-test-migration-loader-compatibility`、`fix-orchestration-execution-status-reliability`、`strengthen-implementation-planning-workflow`）。
- C01 主 spec 位于 `openspec/specs/domain/contract-kernel/spec.md`。
- C02 主 spec 位于 `openspec/specs/domain/module-interfaces-events-workflows/spec.md`。
- C03 主 spec 位于 `openspec/specs/platform/postgresql-outbox-checkpoint-foundation/spec.md`。
- G0、G1 已通过；当前静态依赖图的 frontier 为 C13 `deliver-scanned-document-ocr` 与 C18 `deliver-assessment-configuration-and-measure-governance`。
- C13 已准备到实现阶段：现有 Orca worktree 为 `d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c13-scanned-doc-ocr`，分支 `c13-scanned-doc-ocr`，Git 检查点 `e0c928105de371668f7619145eb87a2272854b12`（在 `69ebbca7c7c9f27685937b50dc79d9b19549c1be` 之上合入 `main` 的同步提交）。检查点事实源是 `task_9ed3df9648b2` 的结构化信封 `head/baseHead`，Task spec 内记录的 SHA 只是规划时点。该检查点已包含当前 `main` 的五工件 schema 基线，`deliver-scanned-document-ocr` 使用 `riskflow-delivery`，proposal/specs/design/implementation-plan/tasks 均完成，apply 状态为 ready、任务为 0/13。implementation Run `run_4e82315340bc` 与 ready Task `task_9ed3df9648b2` 已预建且未派发。接管者命中该精确状态时不得重建 worktree、change、Run/Task 或重新派 Sol 起草，核验后直接把既有 Task 派给实现 Agent。
- C18 尚未预建长期 worktree 或 change，仍按标准“创建 worktree → `openspec new change ... --schema riskflow-delivery` → Sol 五工件规划”路径启动。活动 change、worker 与 feature worktree 状态仍必须在接管时按 §10 实查，不能只依赖本段快照。
- 状态观察器以当前 `main` 提交中的 OpenSpec archive 作为持久完成事实；Orca 仅提供现存 feature worktree、worker 与 Dispatch 均非终态或关联 live terminal 的实时状态。已脱离实时对象的旧 Task 只进入 `diagnostics`，不得阻断 frontier 或 `orchestration:check`。
- 不推送远端；远端操作必须由用户另行授权。

## 2. 固定角色与模型


| 角色          | 模型与强度                                       | 负责                                                                                                               | 不负责                                        |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 主调度 Agent   | 推荐：`commandcode/deepseek/deepseek-v4.1-flash`/ `high`                   | 维护执行图；创建 Run/Task/worktree；监控与问答；审阅范围；提交、合并、清理；处理依赖清单与锁文件                                                        | 起草 OpenSpec change；替代验证 Agent 做正式验收；编写生产代码 |
| 规划与验证 Agent | Codex + `gpt-5.6-sol` / `high`                      | 起草 proposal/specs/design/implementation-plan/tasks；把已批准设计映射为代码施工图；规划时核对项目来源约束与主 specs；实现后仅依据已批准 change、代码和证据独立验证并写 verification 报告；对自己发现的局部实现缺陷在当前未结束的验证任务内直接修复并完成局部验证 | 首轮生产实现；依赖安装；归档；调度监控；不得改变已批准目标、接口设计或范围      |
| 代码执行 Agent  | OMP + `commandcode/deepseek/deepseek-v4.1-flash` / `max`                      | 按已批准 change 使用 `openspec-apply-change` 实现；运行最小验证；当 Sol 无法在受限边界修复时承担升级修复                                          | 更改规划、接口、依赖、范围；归档；Git 提交                    |
| 简单杂活 Agent  | OMP + `minimax-code-cn/MiniMax-M3` / `high` | 无判断冲突的机械归档、资料搜索、证据整理、tracker 更新                                                                                  | change 起草、架构设计、任务规划、代码/测试/配置/迁移、冲突处理、验收判断  |


角色以任务性质区分，同一模型不能借身份重叠绕过分工。主调度 Agent 若发现需要语义规划或正式验证，必须派给 Sol high；Sol 复核发现已批准 change 内的局部实现缺陷时，必须在当前尚未结束的验证任务中直接修复并完成局部验证，随后由主调度 Agent审阅和收口；只有超出修复边界时才退回主调度 Agent重新安排，不再派 Sol 做第二次复检。

## 3. 授权与单写者原则

- 新 session 开始时先确认用户已授权本轮 Git commit、分支、合并、worktree 和依赖操作；handbook 本身不授予权限。
- 同一 worktree 同一时刻只有一个写者。验证 Agent 默认只读；若当前验证任务发现已批准 change 内的局部实现缺陷，原 Sol 可在该任务仍处于活动状态时临时写入精确允许范围并完成局部验证，主调度 Agent随后审阅并形成新检查点，不再派 Sol 二次复检。
- Worker 不执行 `git commit`、merge、rebase 或 push；按 5.5/7.5 明确派发的 M3 仅执行精确的机械归档移动，提交仍由主调度 Agent审阅后完成。
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
Sol high 按 riskflow-delivery 起草并自检 proposal/specs/design/implementation-plan/tasks
  ↓
主调度 Agent 审阅并提交 planning checkpoint
  ↓
主调度 Agent 处理已批准依赖并提交 dependency checkpoint（如有）
  ↓
deepseek-v4.1-flash max 实现 + 最小验证
  ↓
主调度 Agent 审阅范围并提交 implementation checkpoint
  ↓
Sol high 独立 verify
  ↓
结论分流：
  ├─ 无问题 → Sol 形成最终报告
  ├─ 批准范围内局部实现缺陷 → 当前活动 Sol 直接修复并局部验证 → 最终报告
  └─ 规划/架构/范围/权限/依赖/工具问题 → escalation，停止当前交付
  ↓ 前两类结论
主调度 Agent 审阅；有 Sol 修复时提交新的 implementation checkpoint
  ↓
主调度 Agent执行必要门禁并提交 verification checkpoint
  ↓
feature → main（--no-ff），main 冻结安装 + pnpm verify
  ↓
M3 high 机械 sync/archive；有冲突或判断项则升级 Sol high
  ↓
主调度 Agent 复验 OpenSpec、提交 archive checkpoint、按 §6.1 立即回收 worktree
```

### 5.0 OpenSpec CLI 与自定义 schema

`riskflow-delivery` 只改变工件图和指令内容，不改变 OpenSpec 的顶层命令。大型 change 在创建时显式选择 schema；创建后由 `.openspec.yaml` 固定 schema，后续命令不再传 `--schema` override。

| 目的 | 命令 |
|---|---|
| 确认 schema 可用 | `openspec schema which riskflow-delivery`；`openspec schema validate riskflow-delivery --verbose` |
| 创建大型 change | `openspec new change <change> --schema riskflow-delivery --json` |
| 创建允许走简化流程的 change | `openspec new change <change> --schema spec-driven --json` |
| 确认实际 schema 与下一工件 | `openspec status --change <change> --json`，检查 `schemaName` |
| 获取五类工件指令 | `openspec instructions <artifact-id> --change <change> --json`；`artifact-id` 依次为 `proposal`、`specs`、`design`、`implementation-plan`、`tasks` |
| 获取实现指令 | `openspec instructions apply --change <change> --json`，读取全部 `contextFiles` |
| 校验 | `openspec validate <change> --strict --no-interactive` |
| 独立验证 | 使用 `openspec-verify-change` Skill；CLI 没有 `openspec verify` 子命令 |
| 归档 | 使用 `openspec-archive-change` Skill；其底层归档命令仍是 `openspec archive <change>` |

`openspec-continue-change`、`openspec-ff-change`、`openspec-apply-change`、`openspec-verify-change` 和 `openspec-archive-change` 是 Agent Skills，不是 CLI 子命令；它们必须从 status/instructions 的动态结果读取工件，不能假定默认四工件。

排错只看以下事实：

- 创建结果的 `change.schema` 或 status 的 `schemaName` 才是实际 schema；OpenSpec 1.13.0 的 `new change --help` 与 `planningHome.defaultSchema` 可能仍显示内置 `spec-driven`。
- 已有 change 由自身 `.openspec.yaml` 决定 schema。发现 `schemaName` 不符合预期时先停止，不用 `--schema` 强行覆盖后继续写工件。
- apply 返回 `missingArtifacts: ["implementation-plan"]` 是正常硬门；运行 `openspec instructions implementation-plan --change <change> --json`，完成施工图后再请求 apply。

### 5.1 规划门

Sol high 必须先读：

1. `AGENTS.md` 和本 handbook；
2. 当前主 specs、直接依赖的归档 change；
3. 路线中该 change 的行、依赖和所有权；
4. OpenSpec artifact instructions。

Sol 还必须读取本 change 将触及的生产代码、所有受影响接口调用方和现有测试，不能从规划文档推测代码现状。大型交付 change 使用 `riskflow-delivery`；`implementation-plan.md` 固定 base commit，并以 IP-ID 将每个 Requirement/Scenario、计划文件、现有符号、实现动作和可运行验证一一映射。module interface、Schema、状态、错误、权限、事务、审计、文件清单、依赖版本和测试层次仍在 design 中作出决定，施工图只说明这些决定如何落到当前代码。

规划完成门：每个 Requirement/Scenario、计划文件和验证义务均可反向定位到 IP-ID；所有命令已在当前仓库核实存在；不存在会改变接口、持久化、权限、依赖、范围或任务拆分的 Open Question；新的代码 Agent 无需自行发明公共契约、数据规则、事务语义或测试范围。主调度 Agent不以“工件文件已存在”代替该审阅。Sol 不提交，主调度 Agent以 `docs(openspec): ...` 提交。

### 5.2 依赖门

新增依赖由 Sol 在 proposal/design 中写明精确版本、用途、许可证、官方来源、离线方式和退出条件。主调度 Agent负责修改 manifest、`config/dependency-policy.json`、`pnpm-lock.yaml`，执行冻结安装与政策检查后单独提交。代码 Agent不得运行会改锁文件的安装命令。

### 5.3 实现门

deepseek-v4.1-flash max 首轮只能实现已批准的 IP-ID、文件和行为。它必须使用 `openspec-apply-change`，先读取 `openspec instructions apply --json` 返回的全部 `contextFiles`，再按 implementation plan 和 tasks 的依赖顺序实施。每项指定验证通过且行为证据齐全后才能勾选 task；`worker_done` 按 IP-ID 报告修改文件、覆盖的 Requirement/Scenario、命令及结果和任何偏差。

工件冲突、计划符号不存在或代码已漂移、需要计划外公共字段/依赖/迁移/状态/文件、指定命令不存在或失败、任一 Scenario 无法满足时，通过 Orca `ask` 升级；不能自行补设计、缩减场景或扩大 Non-goals。不启动开发服务器，不归档，不提交。Sol 验证任务必须优先在自身仍活动的任务内修复已批准范围的局部错误；只有 Sol 明确升级架构、规划、范围、权限、依赖或工具问题，或活动任务无法继续时，主调度 Agent才另派 deepseek-v4.1-flash 接管。

### 5.4 验证门

Sol high 在 implementation checkpoint 后独立执行 `openspec-verify-change`：

- 对照每条 requirement、scenario、RI/RA、权限、失败、幂等、版本、证据和审计语义；
- 检查代码与 design 文件所有权、Non-goals、依赖方向；
- 将 Implementation fidelity 作为第四个验证维度，逐个 IP-ID 核对计划文件、符号、执行机制和验收证据；tasks 勾选不能替代实际证据；
- 运行该 change 的最小验证，并判断是否需要根 `pnpm verify`；
- 首轮复核默认只读并写出精确报告；任务勾选和 Git 检查点由主调度 Agent负责；
- 发现属于已批准契约内、文件范围内的局部实现缺陷时，当前仍活动的 Sol 任务直接修复，运行相关回归检查并在最终 `worker_done` 中报告修复差异；不得借修复改变需求、接口设计、依赖或 Non-goals；
- 主调度 Agent审阅 Sol 修复并提交新的 implementation checkpoint，随后由主调度 Agent运行必要门禁并收口；不得重置、复用已结束的 Sol session，也不得因普通局部验证失败派发 Sol 二次复检；
- 若缺陷属于 proposal/spec/design/implementation-plan 不一致、架构/范围/权限判断、依赖或工具故障，Sol 不自行改规划，立即通过 Orca `ask`/`escalation`交回主调度 Agent；只有主调度 Agent明确升级后才重新派发。

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
2. deepseek-v4.1-flash 实现结束 → 主调度 Agent审阅、提交，工作树 clean。
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
# 代码执行 commandcode/deepseek/deepseek-v4.1-flash max（OMP）
# OMP 思考强度用 --thinking（非 --effort / -c model_reasoning_effort）；worker-start 不支持 --model 选 OMP 模型，见 §7.5
omp --model commandcode/deepseek/deepseek-v4.1-flash --thinking max --approval-mode yolo

# Sol high（Codex）
codex --model gpt-5.6-sol -c model_reasoning_effort="high" -a never -s danger-full-access
```

等待 `tui-idle`，并从状态栏确认模型与强度。新目录出现信任提示时，分开发送 `1` 和 Enter。随后：

> **经验：新建 worktree 后的首次 codex 启动必须先信任工作区。**
> 新建 worktree（`orca worktree create` / `orca terminal create --command "codex ..."`）后，codex 会先弹工作区信任选项再进入 idle；未批准前状态栏停在 `model: loading / directory: loading`，`orca orchestration worker-start` 会报 `agent_prompt_blocked`，且 task 被标记 `failed`（需 `task-update --status ready` 重置后才能重启）。正确处理：
>
> 1. 用 `orca terminal create --worktree <full-id> --command 'codex --model <model> ...'` 启动 codex（不要直接 worker-start 自动建 terminal）。
> 2. 等待状态栏出现 codex TUI 且停在 `model: loading` / `directory: loading`，此时实际是在等信任确认。
> 3. 用 `orca terminal send --terminal <handle> --enter` 发送回车批准信任；必要时先发 `1` 再发 Enter。
> 4. 状态栏应从 `loading` 变为实际模型与目录（如 `model: gpt-5.6-sol high`、`directory: ~/…/<worktree>`、`permissions: YOLO mode`），MCP servers 启动完成后进入 idle。
> 5. 再用 `orca orchestration worker-start --task <task-id> --worktree <full-id> --terminal <handle>` 纳入 Dispatch，否则会重复触发 `agent_prompt_blocked` 并再次把 task 置为 failed。
> 6. 若 worker-start 已把 task 置 failed，先 `task-update --id <task-id> --status ready` 重置，勿直接重试已 failed 的 task。

```bash
orca orchestration task-create --spec '<bounded task>' --json
orca orchestration worker-start --task <task-id> --worktree <full-worktree-id> --terminal <handle> --json
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 240000 --json
```

收到 question 必须基于工件/代码给出明确答案。默认以约 240 秒作为一次主协调等待窗口，在降低无谓轮询 token 消耗的同时保持缓存热度；超时只做一次状态/活性检查后重新进入等待，不做高频 screen/status 轮询。错误、`escalation`、`question` 或 `worker_done` 由事件立即唤醒，不视为轮询。`check --wait` 超时只是检查点，不是失败；不能自动重复派发。

收到唯一 `worker_done` 后：

1. 处理完整 Delivery；
2. 检查该 Sol 验证任务的 Delivery：prompt 是否已要求批准范围内局部缺陷在当前活动任务中直接修复并完成局部验证，且最终 `worker_done` 已报告修复差异；因此收到 `worker_done` 后不重置、不复用该 Sol session，也不派第二次 Sol 复检；
3. 若 `worker_done` 仍为 FAIL，按升级报告处理：规划、架构、范围、权限、依赖或工具问题由主调度 Agent决定重新规划或另派有界 deepseek-v4.1-flash；不能把已结束的 Sol session当修复会话；
4. 主调度 Agent审阅最终 diff 并形成 implementation/verification checkpoint；运行必要门禁后，最终通过或明确升级，再决定 `worker-release`；外部 terminal 的 release 可能返回 `retained / external_terminal`，确认 transcript 和结果后只关闭该 Dispatch 创建的精确 tab；
5. 最后 acknowledge Delivery。

### 7.5 OMP 模型与思考强度（commandcode/deepseek/deepseek-v4.1-flash / MiniMax-M3）

Orca 不能通过 `worker-start --agent omp --model ... --effort ...` 选择 OMP 模型与思考强度：该组合返回 `invalid_argument`（"Agent omp does not support launch-time model selection"）。OMP 的思考强度用 `--thinking`（off/minimal/low/medium/high/xhigh/max/auto）而非 `--effort` 或 `-c model_reasoning_effort`。选择任意 OMP 模型都走「terminal create → tui-idle → dispatch --inject」低层路径（已实测 deepseek-v4.1-flash 与 MiniMax-M3 均可用）：

```bash
# 代码执行（commandcode/deepseek/deepseek-v4.1-flash，max）
orca terminal create --worktree <full-id> --title <name> --command 'omp --model commandcode/deepseek/deepseek-v4.1-flash --thinking max --approval-mode yolo' --json

# 机械归档/资料搜索/证据整理（minimax-code-cn/MiniMax-M3，high）
orca terminal create --worktree <full-id> --title <name> --command 'omp --model minimax-code-cn/MiniMax-M3 --thinking high --approval-mode yolo' --json
```

两者创建后统一：

```bash
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
# 从状态栏确认模型与强度（"DeepSeek V4.1 Flash · max" / "MiniMax-M3 · high"）后再纳入 Dispatch：
orca orchestration dispatch --task <task-id> --to <handle> --inject --json
```

`worker-start --terminal <handle>` 也可复用已就绪的 OMP terminal 纳入 Dispatch，但同样不能传 `--model`/`--effort`。无法确认模型或强度时不得把结果记为已验证；可继续做纯机械只读工作，但要在回报中标明限制。

M3 prompt 必须包含精确路径、确定步骤、禁止修改区域和升级条件。不要让它“自行判断是否可归档”“完善 change”或“顺便修复”。

### 7.6 computer-use 边界

当前 Orca 桌面窗口的 accessibility tree 只暴露顶层 frame，截图也不能可靠读取内部 TUI。不要用 computer-use 操作 Orca 内部终端、模型选择或设置；使用 Orca CLI。只有 CLI 不提供的 repo setup hook 仍由用户在 Orca UI 手动配置。

## 8. 任务规格模板

每个 Orca Task 至少写清：

- change 名、工作树完整路径/ID、base commit；
- 创建 Task 后用 `orca orchestration task-update --result '<execution-envelope>'` 登记结构化执行信封；阶段收口时更新 `phase`、`head`、`outcome` 和 `evidenceRefs`，main 集成后再填写 `mergeCommit`、`mainHead`、`verification`、`archiveCommit`；
- `taskKind` 只允许 `planning`、`implementation`、`verification`、`archive`，不得从 task 标题或 Delivery 正文解析阶段；
- 必读工件和技能；
- planning checkpoint 与 implementation-plan 中待执行/验证的 IP-ID；
- 允许修改的文件/目录；
- 禁止修改的共享区域；
- 输入检查点 commit；
- 要交付的可观察行为；
- 逐条验证命令与通过条件；
- 何时使用 `ask` / `escalation`；
- 是否允许写 verification 报告；
- Sol 验证失败时是否必须在当前活动任务内直接修复并完成局部验证；`worker_done` 后不复用 session、不派二次 Sol 复检；允许修改的精确文件和新检查点责任；
- 禁止提交、归档、扩大依赖与启动服务；
- `worker_done` 按 IP-ID 列出的文件、Requirement/Scenario、验证命令与结果、偏差和剩余事项。

一句“实现 Cxx”不构成可派发任务。规划 task、实现 task、验证 task、归档 task 必须分开，依赖由 `--deps` 表达。

### 8.1 规划 Task prompt 核心段

```text
你是 Sol high 规划 Agent，只创建规划工件，不实现、不提交。固定输入为 <base-head>。
先运行 openspec new change <change> --schema riskflow-delivery --json，再按该 workflow
创建全部工件；先读取 AGENTS、handbook、路线、
`references/风险识别与评估规划事实源摘要.md`、主 specs、直接依赖归档 change、
相关生产代码、全部受影响调用方和现有测试。项目技术来源只读取该摘要；
原始 Office 文件和五份逐篇转换材料不进入任务上下文，发现摘要与主 specs 或代码冲突时 escalation。
创建后运行 openspec status --change <change> --json，并确认 schemaName 为 riskflow-delivery。

implementation-plan.md 是代码施工图。为每个实施切片分配 IP-ID，并映射精确文件、
现有符号、Requirement/Scenario、执行与副作用顺序、失败/权限/事务/幂等/版本/审计、
测试证据和可运行命令。每个计划文件和验证义务均须归属 IP-ID，tasks 逐项引用 IP-ID。

完成标准以 §5.1 为准；代码与 specs 漂移、所有权/依赖冲突或需要扩大 change 时 escalation。
```

### 8.2 实现 Task prompt 核心段

```text
你是代码执行 Agent，固定规划输入为 <planning-checkpoint>。先运行 openspec status 和
openspec instructions apply --json，完整读取全部 contextFiles，尤其是 implementation-plan.md。

按 task/IP-ID 顺序实施；先核对计划符号仍匹配基线，只修改文件白名单，运行每项指定命令，
行为和证据均完成后才勾选 task。§5.3 所列冲突、漂移、计划外变更和验证失败必须 ask，
不得自行重设计、缩减场景或用占位实现替代。

worker_done 按 IP-ID 返回修改文件、覆盖的 Requirement/Scenario、命令与结果和所有偏差。
```

### 8.3 验证 Task prompt 核心段

```text
你是 Sol high 独立验证 Agent，固定对象为 <implementation-checkpoint>。读取 apply 返回的
全部 contextFiles，并按 Completeness、Correctness、Coherence、Implementation fidelity
四个维度验证；逐个 IP-ID 检查文件、机制和证据，不以 tasks 勾选或自动门禁通过代替核验。
局部实现缺陷按 §5.4 在当前活动任务内修复并回归；规划冲突立即 escalation。
```

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
3. 规划/架构/范围/权限/依赖/工具问题由 Sol 立即 `escalation`；主调度 Agent决定重新规划或另派有界 deepseek-v4.1-flash。活动任务已 settled 后不得复用其 terminal/Run/Dispatch。
4. 若活动任务因连接/进程错误无法继续，按错误处理；不要把普通超时视为打断理由。

## 10. 下一 session 的首个动作

1. 以 commandcode/deepseek/deepseek-v4.1-flash high 启动新的主调度 session，先读 `AGENTS.md`、本 handbook 和路线文档。
2. 确认 `main` clean，C00–C12、C14、C16 已归档（archive 目录共 21 项，其中包含 `strengthen-implementation-planning-workflow`），主 specs 与路线状态一致；再读取本地 OpenSpec、Git 与 Orca 实时状态，不预设当前无活动 change/worker。
3. 用 `orca repo show` 确认 setup hook 仍与 §7.2 一致；若未变化，直接沿用已验证配置。
4. 根据路线重新计算当前 frontier；在上述归档事实未变化时应为 C13/C18。先按完整 Orca worktree ID 定位 C13，并在其目录核验：`git rev-parse HEAD` 精确等于 `e0c928105de371668f7619145eb87a2272854b12`（Task spec 内的 `69ebbca7c7c9f27685937b50dc79d9b19549c1be` 是规划时点，已由该检查点取代）、工作区 clean、`openspec status --change deliver-scanned-document-ocr --json` 返回 `schemaName=riskflow-delivery` 且五工件 done、`openspec instructions apply --change deliver-scanned-document-ocr --json` 返回 ready、0/13 且 `contextFiles` 包含 implementation-plan。任一项不符时停止实现派发，先修复同步或规划漂移；不要静默重建 change。
5. C13 核验通过后，用 `orca orchestration run-use --id run_4e82315340bc` 接管既有 implementation Run，确认 `task_9ed3df9648b2` 仍为 `ready` 且结构化信封的 `head/baseHead` 均指向规划检查点，再将该 Task 派给 deepseek-v4.1-flash max；不要重建 Task 或再派 Sol 起草。C18 或其它尚未物化的 frontier 才创建新 worktree，并运行 `openspec new change <change> --schema riskflow-delivery --json`，确认返回的 `change.schema` 后把规划 task 派给 Sol high。
6. 对新起草的 change，Sol 五类工件和 implementation plan 覆盖门通过审阅并形成 planning checkpoint 后，才派实现；C13 直接使用上述既有 planning checkpoint。实现复核若发现批准范围内局部缺陷，由当前仍活动的 Sol 任务直接修复并做局部验证，随后主调度 Agent门禁收口，不再派 Sol 二次复检；已结束 session 不复用。

完成当前 change 并归档后再重新计算下一 frontier。
