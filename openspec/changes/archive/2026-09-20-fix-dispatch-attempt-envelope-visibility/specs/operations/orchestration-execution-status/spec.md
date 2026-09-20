# Spec Delta

## ADDED Requirements

### Requirement: 状态视图必须用自持台账补齐被覆盖的当前尝试

Orca 会在监督派发起步与 worker 报告收口时整体覆盖 Task 的 `result`。当某个 Task 的 `result` 不再解析出有效 v2 信封时，状态视图 MUST 用控制器自有台账中同一 `taskId` 的信封补齐该尝试；当 `result` 仍解析出有效信封时 MUST 以它为准。

#### Scenario: result 被清空后用台账补齐
- **WHEN** 某个 Task 的 `result` 为空或不是有效 v2 信封，而台账中存在该 `taskId` 的信封
- **THEN** 状态视图 MUST 用台账信封构造该尝试的证据
- **AND** 该尝试 MUST 参与所属工作项的尝试选择与检查点计算

#### Scenario: result 仍有效时以 Orca 为准
- **WHEN** 某个 Task 的 `result` 仍是有效 v2 信封，且台账存在同一 `taskId` 的陈旧信封
- **THEN** 状态视图 MUST 采用 Orca 侧信封
- **AND** 陈旧台账 MUST NOT 覆盖它

#### Scenario: 台账缺失或无效
- **WHEN** 某个 Task 的 `result` 不是有效 v2 信封，且台账中没有该 `taskId` 或该记录不构成有效信封
- **THEN** 该 Task MUST 照旧不被视为该工作项的当前尝试证据
- **AND** 状态视图 MUST NOT 猜测一个尝试

### Requirement: 获批重开规划边界必须界定活动写者

获批的 planning 尝试在创建边界上取代旧尝试组；该边界之前的尝试已经作废，MUST NOT 继续参与当前状态判定，包括活动写者冲突检测。

#### Scenario: 边界之前的尝试不构成第二个活动写者
- **WHEN** 一个已进入 finalizing 的尝试被获批的 planning 尝试取代，且该旧尝试仍处于 `ready` 或 `dispatched`
- **THEN** 状态 MUST NOT 因该旧尝试与边界之后的尝试并存而报告重复活动写者
- **AND** 当前尝试 MUST 仍按边界之后的创建顺序选取

#### Scenario: 没有获批重开规划时保持原判定
- **WHEN** 工作项不存在获批的 replan 边界
- **THEN** 活动写者冲突检测 MUST 覆盖该工作项的全部有效尝试

