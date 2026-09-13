## ADDED Requirements

### Requirement: 终态失败证据只通过公共窄读披露

系统 MUST 提供版本化公共窄读，以调用方提交的 `projectId`、`actorId`、`requestId`、`requestedAt`、精确 `AgentTaskRefV1`、预期 `AgentTaskTypeV1` 和新鲜 `AuthorizationContextV1` 读取一个 C08 任务的失败证据。读取 MUST 在定位任务前复验当前 `agent-task.read-failure-evidence` branch，且该 branch MUST 由 C06 精确映射到唯一 capability `agent-task.read`；授权上下文、调用方身份或当前授权无法证明满足请求时默认拒绝。

成功结果 MUST 只返回原精确任务引用、任务类型、`terminal-failure | cancelled` 终态、可选结构化错误、可选取消原因码、已使用预算，以及动作、候选和校验工件的公开引用。动作引用 MUST 按动作 sequence 升序并确定性映射为以 `actionId` 为 `entityId`、`String(sequence)` 为 `versionId` 的 `VersionReference`；候选工件引用 MUST 按候选版本升序；校验工件引用 MUST 按候选版本首次出现顺序去重。读取不得返回任务信封、冻结输入、授权快照、模型响应、动作或候选正文、工件内容、数据库行、列表、搜索结果或其它任务信息。

授权无效、任务不存在、跨工程、精确任务引用不符、任务类型不符或任务尚未进入 `terminal-failure | cancelled` 时，系统 MUST 返回同形、不可重试的 `AUTHORIZATION_DENIED`，`requiredCapability` 固定为 `agent-task.read`，且不得泄露目标是否存在或具体拒绝原因。成功读取 MUST 以 `requestId` 和规范请求载荷经 C03 幂等追加一条命令收据与一条事实审计，写零个 Outbox 事件；同一请求和同一载荷重放不得重复审计，同一请求携带不同目标或载荷 MUST 返回不可重试幂等冲突。

#### Scenario: C06 签发并复验精确读取能力

- **WHEN** 当前工程中获准的调用方请求 `agent-task.read-failure-evidence` branch
- **THEN** C06 签发且复验只含 `agent-task.read` 的最小授权上下文
- **AND** 不把 `agent-task.start | resume | cancel | confirm` 或其它 capability 并入该上下文

#### Scenario: 读取 terminal-failure 证据

- **WHEN** 已授权调用方按同一工程、精确任务引用和正确预期任务类型读取 `terminal-failure` 任务
- **THEN** 系统返回 `kind: "succeeded"` 及该任务的结构化错误、已使用预算和有序动作/候选/校验引用
- **AND** 动作引用确定性映射、候选引用按版本升序、校验引用按首次出现去重

#### Scenario: 读取 cancelled 证据

- **WHEN** 已授权调用方按同一工程、精确任务引用和正确预期任务类型读取 `cancelled` 任务
- **THEN** 系统返回 `kind: "succeeded"`、`terminalStatus: "cancelled"`、已有取消原因码和失败证据引用
- **AND** 已提交预算、动作、候选和校验引用继续保留

#### Scenario: 不可枚举失败保持同形

- **WHEN** 授权无效，或目标任务不存在、属于另一工程、精确引用不符、任务类型不符或尚未进入终态
- **THEN** 系统返回 `kind: "failed"` 和同形 `AUTHORIZATION_DENIED`
- **AND** 结果不披露目标存在性、实际任务类型、当前状态、失败原因、预算或任何工件引用

#### Scenario: 窄读不泄露信封和正文

- **WHEN** 调用方成功读取终态失败证据
- **THEN** 返回对象只含公共失败证据契约声明的字段和公开引用
- **AND** 即使数据库中存在任务信封、冻结授权、模型响应、动作意图、候选增量或工件正文，也不返回这些值或读取列表

#### Scenario: 成功读取幂等审计

- **WHEN** 调用方以相同 `requestId` 和相同规范请求载荷重复读取同一终态失败任务
- **THEN** 系统返回相同证据且 C03 命令收据与事实审计计数不增加
- **AND** 相同 `requestId` 改读其它任务、工程、类型或授权身份时返回不可重试幂等冲突
