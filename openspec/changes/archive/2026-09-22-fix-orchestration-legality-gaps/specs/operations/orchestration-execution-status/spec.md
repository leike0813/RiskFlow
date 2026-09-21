# Spec Delta

## MODIFIED Requirements

### Requirement: 获批重开规划边界必须界定活动写者

获批的 planning 尝试在创建边界上取代旧尝试组；该边界之前的尝试已经作废，MUST NOT 继续参与当前状态判定，包括活动写者冲突检测。被取代尝试组的当前尝试 MUST 满足下列之一：其阶段排名 ≥ `finalizing`，或其阶段排名低于 `finalizing`、已收口（`runState === "settled"`）且结局属于 `paused`、`failed`、`blocked`。阶段排名低于 `finalizing` 且仍在活动（`queued`/`running`/`waiting`）或结局为 `succeeded` 的尝试 MUST NOT 被取代，此时状态 MUST 报告 `invalid_replan_boundary`。

#### Scenario: 边界之前的尝试不构成第二个活动写者
- **WHEN** 一个已进入 finalizing 的尝试被获批的 planning 尝试取代，且该旧尝试仍处于 `ready` 或 `dispatched`
- **THEN** 状态 MUST NOT 因该旧尝试与边界之后的尝试并存而报告重复活动写者
- **AND** 当前尝试 MUST 仍按边界之后的创建顺序选取

#### Scenario: 已收口且非成功的尝试可被取代
- **WHEN** 工作项当前已收口为 `paused`、`failed` 或 `blocked` 的尝试被携带非空批准引用的 planning 尝试取代
- **THEN** 状态 MUST 接受该边界，MUST NOT 报告 `invalid_replan_boundary`
- **AND** 边界之前的尝试 MUST NOT 参与当前尝试选择或活动写者判定

#### Scenario: 较早阶段活动或已成功的当前尝试不可被取代
- **WHEN** 携带批准引用的 planning 尝试声称取代的 planning/implementing 尝试组，其当前尝试仍在活动，或其结局为 `succeeded`
- **THEN** 状态 MUST 报告 `invalid_replan_boundary` 且不放宽 fail-closed 判定

#### Scenario: 没有获批重开规划时保持原判定
- **WHEN** 工作项不存在获批的 replan 边界
- **THEN** 活动写者冲突检测 MUST 覆盖该工作项的全部有效尝试
