# Spec Delta

## ADDED Requirements

### Requirement: 收口必须保留获批重开规划边界

获批重开规划以 `approvalRef` 与 `supersedesAttemptGroup` 标记边界，状态视图依据它把边界之前的尝试排除在当前判定之外。收口 MUST 在 settled 信封中原样保留这对字段，否则边界消失、被取代的尝试会重新参与选择。

#### Scenario: 重开规划尝试收口后边界仍生效
- **WHEN** 收口一个携带完整重开规划边界的尝试
- **THEN** settled 信封 MUST 保留相同的 `approvalRef` 与 `supersedesAttemptGroup`
- **AND** 状态视图 MUST 继续把边界之前的尝试排除在当前尝试与冲突判定之外

#### Scenario: 边界不完整时不得写入
- **WHEN** 检查点只有 `approvalRef` 或只有 `supersedesAttemptGroup`
- **THEN** settled 信封 MUST NOT 写入该不完整边界
- **AND** MUST NOT 因此产生 `invalid_replan_boundary`

#### Scenario: 常规收口不受影响
- **WHEN** 收口一个不含重开规划边界的尝试
- **THEN** settled 信封 MUST 保持既有字段与语义
- **AND** MUST NOT 新增任何边界字段
