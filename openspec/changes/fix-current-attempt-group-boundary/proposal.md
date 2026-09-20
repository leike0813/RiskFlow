# Proposal

## Why

同一阶段内可以先后出现**不同责任**的尝试：finalization 成功且 `auditPolicy: targeted` 时，控制器会派发 audit 作为新的尝试组（`<id>:audit`，attempt 1）。而当前尝试选择只按「阶段内最大 attempt」比较：

- finalization 已经在 `C26:finalizing` 组里到 attempt 2；
- audit 在新组 `C26:audit` 里是 attempt 1；
- 于是 audit 永远被旧的 finalization 压过，状态视图仍指向**已收口**的 finalization，`checkpoints` 不指向正在运行的审计。

后果：限定审计虽然派发成功并在运行，却无法通过控制器收口（`riskflow_settle` 会打到已结算的 finalization 上被拒），最终验收环节实际上无法闭环。实测 C26 即如此。

## What Changes

- 当前尝试选择在「阶段顺序」之后先按**尝试组边界**定界：同一阶段内取边界最新的尝试组（组的边界为其成员中最新创建时间），再在该组内按尝试次数与创建顺序选取。
- 无尝试组或创建时间不可比较时保持既有语义（不做跨组猜测，继续按原逻辑 fail-closed）。
- 组的边界相同时不擅自选定，仍交给后续尝试次数、创建顺序与冲突判定。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: 当前尝试必须先按尝试组边界定界。

## Impact

- 代码：`scripts/orchestration/status.mjs`（`taskSummary`）、`scripts/orchestration/status.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-execution-status/spec.md`（本 change 的 delta）。
- 不新增依赖；不改变信封字段、阶段顺序、replan 边界、活动写者判定或 Orca 契约。
- 与既有 replan 语义一致：新尝试组取代旧尝试组，这次把同一规则推广到同阶段的第二种责任。
