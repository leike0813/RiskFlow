# Proposal

## Why

状态视图把「状态属于 `pending`/`ready`/`dispatched` 的尝试」一律计入活动写者，只要多于一个就报 `duplicate_active_writer` 并阻止所有受控操作。但同一尝试组内被**更新尝试取代**的旧尝试本来就不可再派发：`riskflowDispatch` 只会复用或创建当前尝试，不会去派发旧的那个。

实测：`reconcile` 为 C17 登记新 HEAD 时在同一尝试组 `C17:finalizing` 内新建 attempt 4，而此前遗留的 attempt 3 仍为 `ready`，两个活动写者令 C17 变成 `unknown`，重开规划因此无法派发。这与规格「根据阶段顺序、尝试组、尝试次数与任务创建顺序选取当前尝试，较早尝试不得覆盖后续」的取向相反：较早的、已被取代的尝试反而把整个工作项锁死了。

## What Changes

- 活动写者判定收窄到「在同一次尝试组内没有被更新尝试取代」的尝试：同一组内存在更高尝试次数（或同次数但更晚创建）的尝试时，较早者不再计入活动写者。
- 其他保护不变：不同尝试组、不同阶段之间仍按原规则计数；两个真正并发的写者仍会触发 `duplicate_active_writer`。
- 派发仍然只作用于按既有规则选出的当前尝试；本 change 不改变选择规则，也不清理 Orca 中的陈旧任务。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: 活动写者必须排除同组内已被取代的较早尝试。

## Impact

- 代码：`scripts/orchestration/status.mjs`、`scripts/orchestration/status.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-execution-status/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变尝试选择、replan 边界、阶段转换或 Orca 契约；不写入任何 Orca 状态（纯读取判定）。
