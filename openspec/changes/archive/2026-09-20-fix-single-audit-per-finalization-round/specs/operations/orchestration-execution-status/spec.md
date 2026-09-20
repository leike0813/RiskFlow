# Spec Delta

## ADDED Requirements

### Requirement: 同一收尾轮次最多一次限定审计

同一收尾轮次内限定审计最多一次，审计发现的普通缺陷 MUST 在同一收尾轮次内一次修完。状态视图 MUST 显式给出该轮次是否仍需要审计（`auditRequired`）；一旦本轮已有已收口的 audit 尝试，成功收口的 finalization MUST 直接进入已验收态，MUST NOT 再要求第二次审计。

#### Scenario: 尚未审计时要求一次审计
- **WHEN** finalization 尝试成功收口、`auditPolicy` 为 `targeted`，且本收尾轮次内没有任何已收口的 audit 尝试
- **THEN** 状态 MUST 标记 `auditRequired` 为真并给出派发限定审计的下一动作
- **AND** 角色选择 MUST 返回 audit

#### Scenario: 本轮已审计后不再要求第二次
- **WHEN** 本收尾轮次内已存在已收口的 audit 尝试，且其后的 finalization 尝试成功收口
- **THEN** 状态 MUST 不再要求审计（`auditRequired` 为假）
- **AND** 该工作项 MUST 直接进入已验收态，下一动作为集成

#### Scenario: 判定范围随最新获批边界
- **WHEN** 工作项经过一次获批重开规划进入新的收尾轮次
- **THEN** 边界之前的已收口审计 MUST NOT 抑制新轮次的审计
- **AND** 新轮次仍 MUST 恰好触发一次限定审计

## MODIFIED Requirements

### Requirement: 审计未通过必须保持收尾责任

限定审计未通过时，收尾责任仍留在 Finalizer 责任链中：MUST NOT 回退到实现阶段、MUST NOT 因此重新规划，也 MUST NOT 落入没有后续角色的失败态。但"保持责任"MUST NOT 被解释为可以重复派发：审计发现的普通缺陷必须在同一收尾轮次内一次修完，禁止为同一收尾重复派发新的 Finalizer 或第二次限定审计。

#### Scenario: 审计发现缺陷后仍可派发修复
- **WHEN** 当前尝试为 audit 且以失败收口
- **THEN** 状态 MUST 报告 `finalizing`，下一动作为由强模型 Finalizer 继续修复与回归
- **AND** 修复 MUST 优先在同一收尾轮次仍然活动的收尾会话内完成（由协调端回灌 finding）
- **AND** 会话已结束而机制无法在会话内完成时，协调端 MUST 升级给用户，MUST NOT 自动再开一轮

#### Scenario: 实现或收尾的失败语义不变
- **WHEN** 当前尝试为 implementation 或 finalization 且以失败收口
- **THEN** 状态 MUST 保持既有判定与下一动作
- **AND** MUST NOT 因本规则改变其责任归属
