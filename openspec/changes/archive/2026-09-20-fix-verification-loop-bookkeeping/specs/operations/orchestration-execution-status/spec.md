# Spec Delta

## ADDED Requirements

### Requirement: 审计未通过必须保持收尾责任

限定审计发现普通实现缺陷时，修复仍属收尾责任。审计以失败收口后，状态 MUST 保持 `finalizing` 并给出继续修复的下一动作，MUST NOT 落入没有后续角色的失败态。

#### Scenario: 审计发现缺陷后仍可派发修复
- **WHEN** 当前尝试为 audit 且以失败收口
- **THEN** 状态 MUST 报告 `finalizing`，下一动作为由强模型 Finalizer 继续修复与回归
- **AND** 调度器 MUST 能把修复尝试派发为同一收尾阶段的 finalization 尝试

#### Scenario: 实现或收尾的失败语义不变
- **WHEN** 当前尝试为 implementation 或 finalization 且以失败收口
- **THEN** 状态 MUST 保持既有判定与下一动作
- **AND** MUST NOT 因本规则改变其责任归属
