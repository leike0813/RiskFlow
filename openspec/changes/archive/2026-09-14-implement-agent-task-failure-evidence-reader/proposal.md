## Why

C17 必须在不接触 C08 私有任务存储、任务信封或正文的前提下，按自身待收口 attempt 的精确任务引用取得终态失败证据。当前 C08 只有内部执行读取，contracts/C06 也没有对应的最小读取 branch 与 capability，因此 C17 尚不能安全集成失败复核流程。

## What Changes

- 为 C08 增加 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()` 公共窄读，只返回精确任务的终态失败、预算用量及动作/候选/校验工件引用。
- 在 contracts 最小增加 `agent-task.read-failure-evidence` branch 与 `agent-task.read` capability，并由 C06 现有精确 branch 映射路径签发和复验唯一读取能力。
- 将未授权、不存在、跨工程、任务类型不符和非终态统一收口为同形 `AUTHORIZATION_DENIED`，且不返回任务信封、模型响应、工件正文、列表或存在性差异。
- 成功读取使用 `requestId` 经 C03 幂等追加命令收据和事实审计；相同身份的不同目标保持幂等冲突语义。
- 增加 terminal-failure、cancelled、同形拒绝、投影不泄露与审计幂等行为测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/unified-bounded-agent-runtime`: 增加受 C06 当前授权约束的终态失败证据公共窄读契约、不可枚举失败语义和成功读取审计。

## Impact

- 受影响代码：`packages/contracts` 的 capability/branch 事实源，`packages/core/src/agent-runtime` 的公共类型，`packages/adapters/src/agent-runtime` 的 PostgreSQL 实现，以及对应 contracts、C06、C08 测试。
- C17 仅作为后续消费者注入该 reader；本 change 不修改或实现任何 C17/C15/C16 内容。
- 不新增依赖、不新增迁移、不修改现有持久化结构、不增加 HTTP/UI 接口。
