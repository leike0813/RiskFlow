# Design

## Context

- `deriveNodeState` 的活动写者判定是 `summary.scope.filter((task) => WRITER_TASK_STATUSES.has(task.status))`，超过一个即报 `duplicate_active_writer`；`WRITER_TASK_STATUSES` 为 `pending/ready/dispatched`。
- `summary.scope` 已经排除了获批 replan 边界之前的尝试（上一处修复），但边界之外的**同一尝试组**仍可能同时存在多个未收口尝试：`reconcile` 每次登记新 HEAD 都会新建一个尝试，而旧的那个保持 `ready`。
- 既有选择规则（`taskSummary`）在阶段内按尝试次数上限、再按创建顺序选出当前尝试；较早尝试本来就不可能被派发（`riskflowDispatch` 只复用/创建当前尝试）。
- Orca 的状态集合没有 `cancelled`/`superseded`，因此无法在源头上诚实地"作废"旧尝试——只能由判定侧识别它已被取代。

## Goals / Non-Goals

**Goals:**

- 同一尝试组内只允许一个活动写者，使已作废的旧尝试不再锁死工作项。
- 保留对真实并发写者的拒绝能力。

**Non-Goals:**

- 不改变尝试选择规则、replan 边界或阶段转换。
- 不写入或清理 Orca 状态；不试图给 Orca 增加终态。
- 不改变「不同阶段/不同组同时活动」时的拒绝行为。

## Decisions

**D1：在判定侧收窄，而不是在 reconcile 侧清理。**
Orca 没有 `cancelled` 状态，把从未运行的尝试写成 `failed` 是伪造事实；而"该尝试已被取代"完全是可从尝试次数与创建顺序确定的事实。判定侧收窄是只读的、可测的，也不依赖 Orca 增加状态。

**D2：取代关系只在同一 `attemptGroup` 内成立，且要求尝试次数严格更高。**
跨组（如 planning 与 finalizing 并存）本来就不是取代关系，必须继续计入写者。同次数、仅创建顺序不同的两个活动尝试是「无法唯一确定当前尝试」的歧义状态，必须继续 fail-closed——否则会拿一个正在跑的 worker 去换一个仅仅更晚创建的 ready 任务（编年史测试即覆盖了该场景）。

**D3：缺少尝试次数时不参与取代判断。**
v1 信封没有 `attemptGroup`/`attempt`，凭空比较会误伤；此时保持既有的活动写者语义（宁可多报冲突，也不放松）。这与「无法唯一确定当前尝试时 fail-closed」的既有取向一致。

**D4：实测修正记录。**
首版实现把「同次数但更晚创建」也当作取代，结果让一个 `dispatched`（正在运行 worker）的尝试被一个仅更晚创建的 `ready` 尝试取代，弱化了既有的多写者保护；既有编年史用例当场失败，据此收窄为「次数严格更高」。

## Risks / Trade-offs

- 极端情况下两个同组尝试都被真实派发（绕过控制器直接操作 Orca）时不再报冲突。控制器的派发入口只作用于选出的当前尝试，且 Orca 的 `ready → dispatched` 转换本身拒绝重复派发，因此该路径不在受控范围内。
- 陈旧任务仍会留在 Orca 中（本 change 不清理）。它们被判定排除即可；清理属于独立议题。
