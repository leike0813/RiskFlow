Type: grilling
Status: resolved
Blocked by: 24

# 确定覆盖 MVP 的 OpenSpec 实现路线

## Question

在完整产品、MVP 范围、领域与功能、工作流、数据与检索、完整界面、外部集成、私有部署和验收标准均已明确后，应如何把 MVP 切分为不过细、可独立验收且依赖顺序清晰的 OpenSpec changes，并为 MVP 后续能力保留明确扩展点？

## Comments

- 已领取本票，并把所有待决问题展开为“全部选项、推荐方案、按推荐继续推演后的条件结论”。
- 采用三条独立设计路线交叉审阅：最小深层模块、最大安全并行 DAG、纵向 walking skeleton；汇总后推荐 39 个能力级 OpenSpec changes、六个波次和 G0～G5 阶段门。
- 详细路线、change 依赖、模块 interface、工件厚度、worktree/Agent 协议与集中复核入口见 [OpenSpec 实现路线](../prototypes/openspec-delivery-roadmap.md)。
- 本票属于 HITL 决策票。集中复核前保持 `claimed`，不写正式 Answer、不更新地图，也不创建 OpenSpec change；当前推演均以采纳推荐方案为条件。

### 第一轮编排能力探测（基线）

已验证的能力与边界：

- 直接 subagent 可按 `gpt-5.6-luna`、`medium` 思考强度启动，能读取同一工作区及主工作树未提交改动，并可靠返回最终结果；但本轮没有验证其中间结构化通信能力，也没有 Orca Run / Task / Dispatch 的任务来源记录。因此，它只适合只读探索、方案或审阅，不作为需要监督、等待和审计的执行通道。
- Orca 的 Run / Task / Dispatch、任务依赖 DAG、decision gate、ask / reply、`worker_done` 与 transcript 均可用。原生 `worker-start` 已验证请求和实际模型均为 `gpt-5.6-luna`、思考强度 `medium`；`max` 留待下一轮验证。
- 当前协调进程不会自动获得 Orca terminal identity；状态化命令缺少身份时会报 `no_active_sender_terminal`。协调 Agent 必须先绑定发送端 terminal，并显式传递 `ORCA_TERMINAL_HANDLE` 或 `--from`。
- ask 超时后，执行 Agent 曾重复提出同一问题；协议需由协调端去重，并要求执行端使用 `ask --resume` 续接。`check --wait` 输出 keepalive 后还可能留下可执行 waiter，导致下一次调用报 `waiter_exists`；暂以 `check --json`、`worker-show` / `worker-read` 兜底，待复测确认是否为当前 Orca 版本问题。
- `worker-release` 多次返回 `release_unknown` / `tab_not_found`，尽管 transcript 已保留且对应 worker terminal 实际退出；另有外部探测 terminal 关闭后留下幽灵或替代 terminal。39 个 change 的路线不能在该问题未确认前放开高并发。

工作树探测结论：

- 首次创建失败的原因是 RiskFlow 的 Orca 项目配置缺少 `worktreeBasePath`，默认路径与 `/home/joshua/orca` Unix socket 冲突；将 Orca 外部项目元数据改为 `../.orca` 后，新工作树创建成功：`/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/riskflow-orca-probe-wt`。
- Orca 实际创建的分支为 `leike0813/riskflow-orca-probe-wt`，不会遵循路线原型中假设的 `change/<name>`。编排协议不得依赖分支命名，应以完整 worktree ID 与 base HEAD 为事实源。
- 新工作树首次派发被目录信任提示阻塞；用户手动信任后，原生 `worker-start` 能在指定工作树中启动 `gpt-5.6-luna` / `medium` worker 并收到 `worker_done`。`terminal send` 不能绕过信任提示，后续需用 computer-use 自动处理。
- 向已有 terminal 派发时，必须同时提供与它一致的完整 worktree ID，否则报 `terminal_worktree_mismatch`。自定义 terminal 还可能出现命令审批提示，因此默认应使用指定 worktree 的原生 `worker-start`。
- 新工作树只继承 base commit，不包含主工作树的未提交或未跟踪内容。本轮已有三个未跟踪 prototype 在新工作树中不可见。规划、实现、验证应在同一工作树顺序交接，输入只依赖已提交 / 已归档基线，或由协调端显式传递上下文。
- `setup --setup run` 返回 `not_configured`，说明 RiskFlow 尚未配置 Orca worktree setup hook。正式派发前需把 hook 的配置和验证纳入预检。

对路线的条件性修订：

- 在 G0 前增加编排预检：协调 terminal 绑定、`worktreeBasePath`、setup hook、目录信任、computer-use、模型 / 思考强度覆盖、`worker_done`、wait 与 release 全链路。
- 分成两条通道：直接 subagent 只承担只读探索与审阅；需要监督、任务依赖、人工决策或审计的工作统一走 Orca。
- 推荐派发顺序为“创建工作树 → 信任与 setup 预检 → 主 Agent 落下并审阅工件 → 在完整 worktree ID 上原生 `worker-start`”；同一 change 的 Luna 实现、验证和主 Agent 审阅在同一工作树顺序交接。
- 在 wait / release / terminal 生命周期问题复测通过前限制并发；本轮探测不构成对 39 个 changes 路线的最终批准。

### Python 环境处理与下一轮条件

- `orca computer` 当前失败，是因为正在运行的 Orca 服务解析到 Anaconda base 的 `python3`，其中缺少可用的 `gi`；系统 AT-SPI 依赖已存在。此前向 Anaconda base 尝试安装的 PyGObject / pycairo 已按要求卸载并确认不存在，没有保留 Conda 事务。
- chezmoi 管理的 `$HOME/.ar` 规格已加入 `PyGObject==3.50.0` 并更新锁文件；变更已提交、推送到 dotfiles `main`，提交为 `f0e0282 chore: add PyGObject to agent runtime`。当前 live `$HOME/.ar` 尚未 apply。
- 等用户执行 `chezmoi apply`，并用 uv 包裹方式冷启动 Orca 后，再开始下一轮；复测范围包括 computer-use、自动目录信任、`gpt-5.6-luna` / `max`、`check --wait`、worker release 与 terminal 生命周期。在此之前暂停新的编排测试。

### 第二轮编排能力探测（uv 包裹冷启动后）

本轮使用 Orca `1.4.188`，创建独立 Run `run_ff19ba7b4bdb` 和只读 Task `task_0e0e14666e86`；未修改项目代码、依赖或设置。结论如下：

- uv 包裹冷启动已消除上轮 `gi` 导入阻塞。`orca computer capabilities` 成功加载 `orca-computer-use-linux`，截图、元素框、点击、输入、按键、滚动、拖拽、set-value 等能力均可用。
- computer-use 能读取 Linux/XFCE 图形会话中的 GTK 应用。受控 Zenity 对话框的无障碍树和截图均成功获取，按钮通过 accessibility click 触发，对话框最终以退出码 `0` 结束。
- Orca 桌面窗口及其承载的 Codex TUI 没有出现在 `orca computer list-apps` 中，按 Orca PID 查询也返回 `app_not_found`。因此 computer-use 当前不能自动点击 Orca terminal 内的目录信任提示；“computer-use 后端可用”与“Orca 自身 UI 可操作”必须分开验收。
- 新工作树首次派发仍因目录信任返回 `agent_prompt_blocked`。本轮 `terminal send` 发送 `1` 与回车后能够完成信任，推翻了第一轮“terminal send 不能绕过”的临时判断；但这只是低层 terminal 控制，不构成 computer-use 自动信任。
- 新工作树为 `/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/riskflow-orca-probe-20260831`，实际分支为 `leike0813/riskflow-orca-probe-20260831`。复用已有 terminal 时再次确认必须同时提供完整 worktree ID，否则返回 `terminal_worktree_mismatch`。
- `worker-start` 回执中请求与有效启动参数均为 `gpt-5.6-luna` / `max`；但 Codex TUI 标头显示 `gpt-5.6-luna default`，worker 与归档 transcript 也无法读取精确 reasoning effort。模型可确认，`max` 是否真正生效仍未形成一致证据，不能标记通过。
- `check --wait` 在 keepalive 后正常收到唯一 `worker_done`，没有重复问题，也没有残留 waiter 或 `waiter_exists`。worker 确认工作目录、分支和 `AGENTS.md` 可读，并确认没有文件修改。
- `worker-release` 仍稳定返回 `release_unknown` / `tab_not_found`；按回执使用同一 `--retry-request` 重放后结果不变。目标 terminal 实际已退出、工作树 terminal 列表为空、transcript 已归档，但资源账面仍为 `releaseState: unknown`。
- `--setup run` 再次返回 `not_configured`。setup hook、Orca 自身 UI 的自动目录信任、`max` 有效性证明和 release 状态收口仍是 G0 前编排预检的未通过项；在这些问题解决前继续限制并发，不批准 39 个 changes 的高并发实施。

### 第三轮编排能力探测（OMP + MiniMax-M3）

本轮创建 Run `run_3fadc36e49b5`、只读 Task `task_953c5699ddbe` 和 Dispatch `ctx_009a361e4872`，验证以 OMP + MiniMax-M3 承担简单任务的可行性：

- OMP `18.0.11` 的模型目录包含多个 MiniMax-M3 路由；为避免模糊匹配，本轮固定直接 selector `minimax-code-cn/MiniMax-M3`，并请求 `--thinking low`。
- Orca `worker-start --agent omp --model ...` 返回 `Agent omp does not support launch-time model selection`，且未创建资源。精确模型必须先通过自定义 argv 启动 OMP terminal，再用 `worker-start --terminal` 绑定完整 worktree ID 纳入受监督 Dispatch。
- 实际启动命令为 `omp --model minimax-code-cn/MiniMax-M3 --thinking low`；Orca terminal 状态显示 `MiniMax-M3`，worker 运行时报告 selector 为 `minimax-code-cn/MiniMax-M3`、thinking 已启用。OMP 未独立显示 `low` 级别，因此只能确认启动参数为 `low`，不能从 worker 回执二次证明精确等级。
- worker 在约 12 秒内正确返回当前目录、`main` 分支、`AGENTS.md` 首个 H1 和 `37 × 43 = 1591`，随后发送唯一 `worker_done`；Task 自动变为 `completed`，delivery 正常确认，未修改文件、Git 状态、依赖或外部系统。
- `worker-read` 对 OMP 使用 terminal fallback，原因是 `session_not_reported`；仍可读取受限 terminal transcript，但没有 Codex/Claude 式 provider session transcript。
- 自定义 argv terminal 被 Orca 标记为 `external_terminal`，所以 `worker-release` 按契约返回 `retained` 且不关闭进程。协调端随后只关闭本轮创建的精确 tab，terminal 列表和进程检查均确认没有残留。

条件结论：OMP + `minimax-code-cn/MiniMax-M3` 可以作为非实质开发杂活的低成本通道。正式执行时固定请求 `--thinking high`，范围只包括资料搜索、证据整理、已批准 change 的机械归档和 tracker 更新；不得起草 proposal/specs/design/tasks，也不得编写或修改代码、测试、配置、依赖、迁移。当前编排协议必须显式走“创建精确模型 OMP terminal → 等待 TUI idle → `worker-start --terminal` → 等待并确认 `worker_done` → release 记账 → 关闭精确外部 terminal”。

### 第四轮编排能力探测（G0 阻塞收口）

本轮使用 Orca `1.4.188`，创建 Run `run_9de19c0428b0`、只读 Task `task_574f38f634fb` 和有效 Dispatch `ctx_1f384274e7f6`；临时工作树、分支和本轮创建的 terminal 已在确认无改动、HEAD 未偏移后清理。结论如下：

- `orca-ide open` 可让既有服务进入桌面窗口可用状态；computer-use 能发现 Orca 应用和窗口，但无障碍树只有顶层 frame，截图为空白/黑色，模拟按键也未进入 Codex TUI。Orca 内部 TUI 暂不作为 computer-use 的可操作目标；它不再是 G0 硬门禁，终端交互改用有明确回执的 Orca terminal 命令。
- 新工作树首次 Codex 启动仍会显示目录信任提示，单次启动传入项目 trust 配置不能提前绕过。拆分执行 `terminal send --text 1` 和 `terminal send --enter` 可稳定完成并持久化信任；合并发送会被 `agent_prompt_blocked` 拒绝。后续工作树预检固定采用拆分发送，并在进入 Dispatch 前再次等待 `tui-idle`。
- Luna terminal 的实际 argv 包含 `--model gpt-5.6-luna -c model_reasoning_effort="max"`；模型目录加载完成后，TUI 的模型选择项和状态栏均明确显示 `gpt-5.6-luna max`。先前的 `default` 是模型目录尚未加载完成时的瞬态占位，本项通过。
- 原生 Codex owned terminal 的历史 `release_unknown / tab_not_found` 不再作为正式路线。Luna 与 M3 一样先由精确 argv 创建外部 terminal，再以完整 worktree ID 执行 `worker-start --terminal`；本轮 `worker-release` 按契约返回 `retained / external_terminal`，协调端在处理 transcript 和 delivery 后关闭精确 tab，没有资源账面不明或进程残留。
- C00 执行前仓库尚无正式 pnpm workspace，无法配置真实安装 hook。C00 工作树固定显式使用 `--setup skip`；C00 建立 workspace 和冻结锁文件后，再把项目 setup hook 配置为 `pnpm install --frozen-lockfile` 并用后续工作树验证。`not_configured` 因而从前置阻塞改为 C00 的阶段内交付项，不添加虚假的空 hook，也不安装 Demo 依赖。
- 本轮额外传入的 Codex `--sandbox read-only` 在宿主触发 `bwrap: loopback: Failed RTM_NEWADDR`，导致 worker 无法执行只读 shell 或自行调用回执 CLI；协调端使用该 Dispatch 的能力令牌完成唯一 `worker_done`，随后 delivery、ack 和 release 正常收口。该错误来自探测参数，不是 Orca 编排故障；正式 Luna terminal 沿用项目默认沙箱与审批策略，不追加此参数。

条件结论：四个原 G0 阻塞项已有可执行收口路径，可以开始 C00 的单 lane 实施；这不等于立即开放高并发。C00 完成并验证真实 setup hook 后，再按静态依赖图滚动物化后续任务。

### 编排执行方案（已确认）

- 39 个 changes 的完整依赖图预先规划并作为静态事实源；Orca 不一次性物化 39 个节点的深链，而是按 G0～G5 分 Run，滚动物化当前波次和相邻下一层。
- 每个 change 在 Orca 中采用 `deliver → archive → 下游 deliver`：`deliver` 由 `gpt-5.6-luna` / `max` 完成实质开发、最小验证和 `openspec-verify-change`；`archive` 仅在主 Agent 审阅批准后交给 MiniMax-M3 / `high` 机械执行。
- 主 Agent 独占路线计算、frontier 选择、proposal/specs/design/tasks 起草、工作树准备、Luna 结果审阅和归档授权。规划职责不委派给 M3。
- Luna 在发送 `worker_done` 前必须通过 Orca `ask` 请求主 Agent 审阅；主 Agent 回复修改意见时继续原 Dispatch，明确批准后才允许完成并解锁 `archive`。
- 工作树按就绪前沿滚动预建：只为直接依赖已归档、目录所有权互不冲突的 change 创建，记录完整 worktree ID、实际分支和 base HEAD。禁止提前创建全部 39 个工作树，避免长期阻塞分支基线陈旧。
- 每轮通过 `task-create --deps` 表达依赖，并以 `task-list --ready` 计算可派发项；ready 只表示具备调度资格，最终派发仍由主 Agent 控制。
- C00 采用单 lane：显式 `--setup skip`，Luna 走精确 argv 外部 terminal，目录信任用拆分 terminal 输入，交付后按 `retained / external_terminal` 记账并关闭精确 tab。C00 归档前必须配置并验证真实 pnpm setup hook；通过后才开放 G0 后的业务并行。

## Answer

用户已确认 [OpenSpec 实现路线](../prototypes/openspec-delivery-roadmap.md)。MVP 拆分为 C00～C38 共 39 个能力级 changes，按 G0～G5 六个阶段门推进；静态依赖图一次性维护，Orca 只滚动物化当前波次和相邻下一层。规划可提前两个波次，生产实现必须等待直接依赖归档。

每个 change 使用独立 worktree，并采用 `主 Agent 工件闸门 → Luna max deliver/apply/verify → 主 Agent 审阅批准 → MiniMax-M3 high 机械 archive → 下游解锁` 的执行子图。主 Agent 独占依赖计算、proposal/specs/design/tasks 起草、接口与文件所有权决策、交付审阅和归档授权；M3 不承担规划或实质开发。

C00～C02 串行建立工程、领域契约与模块接口基线。G0 后才允许目录所有权互不冲突的业务 changes 并行；根配置、锁文件、公共 contracts、中央注册和迁移编号由主 Agent 串行治理。每个 design 必须消除实施 Agent 对模块、Schema、错误、权限、事务、依赖和测试层次的临场判断，tasks 明确到目标文件、前置工件、可观察结果和验证命令。

编排预检采用第四轮探测确认的路径：C00 显式 `--setup skip`；Luna 通过精确 argv 外部 terminal 固定 `gpt-5.6-luna` / `max`，以完整 worktree ID 纳入 Dispatch；目录信任使用拆分 terminal 输入；结果和 transcript 处理后按 `retained / external_terminal` 记账并关闭精确 tab。C00 建立正式 pnpm workspace 与冻结锁文件后配置 `pnpm install --frozen-lockfile` setup hook，通过验证后再开放业务并行。computer-use 不能操作 Orca 内部 TUI 作为已知限制保留，不再阻塞 C00。
