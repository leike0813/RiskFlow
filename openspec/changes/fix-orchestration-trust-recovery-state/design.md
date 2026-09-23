# Design：信任阻断后的状态与角色推导

## 决策

1. **信任归因以 terminal 屏幕为证据**。失败文本在不同 Orca/Codex 版本里并不稳定（实测为 `agent_prompt_stalled`），而信任提示在屏幕上形态固定。因此在 `worker-start` 与 `tui-idle` 失败路径上增加一次 `terminal read --screen` 探测：命中 `/trust this folder|trust and continue|workspace trust/i` 即按信任失败收口。探测本身失败（terminal 已释放等）不改判，仍按原始错误上抛。
2. **违规判定区分「尚未创建」与「缺失」**。`task_missing_local_openspec` 的语义是「该工作项已有非规划阶段的任务，但工作树里没有对应 change」。规划尝试未成功时本地 change 尚不存在属正常中间态，因此把该违规的触发条件收紧为「当前尝试不是未成功的 planning」。
3. **角色推导以尝试事实为准**。`nextTaskKind()` 首先判断当前尝试是否为未成功的 planning：是则继续 planning；其余分支不变。`finalization` 回退只对 `phase === "adopt" || status === "untracked"`（即已采纳且有本地 change、无关联任务的 auxiliary 工作树）生效。
4. **替代尝试与派发共用同一套角色推导**。`riskflowReconcile` 原先只在调用方显式传 `phase="planning"` 时才重建规划，缺省一律 `finalization`；这会把「规划从未成功」的工作树派成收尾（其任务说明要求填写 verification）。改为复用派发规则：`deriveReconcileKind()` 在规划未完成时返回 `planning`，其余归入收尾，显式 `phase="planning"` 仍按规划处理。
5. **worker 启动不得产生未受控副作用**。Codex 默认在启动时检查更新（`check_for_update_on_startup`，默认 true）。这会让 worker 的 CLI 版本在交付中途漂移，并把升级横幅变成一次非预期屏幕状态（实测被误判为 `agent_prompt_stalled`）。worker 版本由项目集中管理，因此 `terminal create --command` 显式带 `-c check_for_update_on_startup=false`。
6. **注入式派发要自己同步运行态，并在派发前挡住重复写者**。实现角色用 `dispatch --inject` 注入 `omp` TUI，不进入 Orca 的受监督 worker 账本，因此 Orca 侧 Task 的 `result` 不会更新；而状态视图优先采用 Orca 的信封，于是正在运行的实现尝试一直显示为 `queued`，并给出「派发当前信封指定的受控任务」的下一动作——重试就会在同一工作树产生第二个写者（实测如此）。控制器现在：① 注入成功后把 `running` 信封 `task-update` 回 Orca；② 派发前用 `dispatch-show` + `terminal show` 判断该任务是否已有存活 dispatch，有则拒绝并给出「等待报告或先停止该 dispatch 与其 terminal」。

7. **每次带 `--run` 的 orchestration 调用前先确认 Run 绑定；失败必须透出 CLI 原始输出**。一个协调端 terminal 只能绑定一个 Run，而 orchestration 调用（含 `check --wait` 这类读取）按该绑定校验；控制器同时服务多条 lane，于是跨 lane 的 `task-create` / `worker-start` / `check --wait` 会以 `consumer_fenced` 收场。控制器现在每次调用前核对 `run-current`，不匹配即 `run-use` 重绑（并发写由运行时锁串行化）。同时 `CommandFailure` 有界透出 CLI 的 stdout/stderr：CLI 常把结构化错误写在 stdout，只报 `cause.message` 会让失败退化成一句 `Command failed: <同一命令行>`，调用方只能靠反复实验反推。

## 取舍

- 探测屏幕比解析错误文本更贴近事实，但引入一次额外 CLI 调用：仅在失败路径上发生，且失败本身已是非正常路径，成本可接受。
- 未成功的 planning 继续 planning 会让「规划者反复失败」的情形重复派发，因此仍需保留 `noProgressLimit` 与违规检查作为外圈刹车。
- 关闭启动更新检查只消除「自更新」这一副作用，不做版本探测与升级兜底：若未来 CLI 忽略该开关并重新出现升级提示，再按信任探测的同一模式补「升级横幅 ⇒ 受控恢复」判定，而不是预先加一层探测。
- 注入式派发没有心跳可观测，存活判定只依据 dispatch 状态与 terminal 是否 `orphaned`；worker 中途死亡时状态会短暂停留在 `running`，由 worker 报告与重复失败上限（`noProgressLimit`）兜底。
