# Spec Delta

## ADDED Requirements

### Requirement: 同一收尾轮次禁止重复派发

同一收尾轮次内，控制器 MUST NOT 为同一收尾重复派发新的 Finalizer，也 MUST NOT 派发第二次限定审计。审计发现的普通缺陷 MUST 由同一收尾轮次一次修完；协调端 MUST 把审计发现回灌到仍在活动的收尾会话（同一连续上下文），而不是新开一轮。机制上确实无法在会话内完成时，协调端 MUST 停下来升级给用户，MUST NOT 自行再开一轮来"绕过"。

#### Scenario: 审计发现回灌同一会话
- **WHEN** 限定审计得出 finding，且发起该审计的收尾会话仍处于活动状态
- **THEN** 协调端 MUST 把 finding 回灌给该收尾会话并在同一会话内完成修复与回归
- **AND** MUST NOT 为这些 finding 新建 Finalizer 尝试或第二次审计

#### Scenario: 会话已结束时不重复派发
- **WHEN** 审计得出 finding 时，发起它的收尾会话已经结束
- **THEN** 协调端 MUST 停止自动推进并升级给用户说明该冲突
- **AND** MUST NOT 通过新建 Finalizer 尝试或第二次审计来继续

#### Scenario: 首轮收尾仍按一次审计
- **WHEN** 工作项首次进入收尾且修改触及权限、事务、关键状态机或语义 merge 冲突
- **THEN** 该轮次 MUST 恰好触发一次限定审计
- **AND** 审计结论与随后修复的证据 MUST 进入同一 verification
