# Spec Delta

## ADDED Requirements

### Requirement: 重开规划必须把批准范围与触发原因送入规划任务

`replanApprovalRef` 只记录批准凭据，不足以让规划者知道要规划什么。派发 MUST 把被取代尝试的触发原因与批准记录的位置写进规划任务说明，使规划者能在没有额外人工提示的情况下闭合批准范围。

#### Scenario: 重开规划任务的说明包含批准输入
- **WHEN** 派发携带非空 `replanApprovalRef` 的规划任务
- **THEN** 该任务说明 MUST 包含批准引用、被取代的尝试组，以及被取代尝试的 `issueRefs` 与 `evidenceRefs`
- **AND** MUST 指引规划者先读取该 change 目录中由 proposal 引用的批准记录

#### Scenario: 批准范围必须逐项闭合
- **WHEN** 规划者处理重开规划任务
- **THEN** 批准记录列出的范围 MUST 被逐项展开为 IP-ID、允许文件清单和验证命令
- **AND** 结束报告 MUST 逐项说明每一条的闭合情况；仅补齐模板章节 MUST NOT 被视为规划完成

#### Scenario: 批准范围无法在既有语义内闭合
- **WHEN** 批准记录中任一项无法在该 change 已批准语义内闭合
- **THEN** 规划者 MUST 在规划工件中显式说明并 escalation
- **AND** MUST NOT 静默略过该项

#### Scenario: 常规规划任务不受影响
- **WHEN** 派发不带 `replanApprovalRef` 的规划任务
- **THEN** 任务说明 MUST 保持既有通用文案
- **AND** MUST NOT 要求读取不存在的批准记录
