## Context

动机见 [proposal.md](./proposal.md)。当前 C08 PostgreSQL 账本已经在 `business.agent_tasks`、`business.agent_task_actions` 和 `business.agent_task_candidates` 保存终态、结构化错误、取消原因、预算台账、动作序号、候选工件引用和校验工件引用；C03 `TransactionUnitV1` 已提供命令收据与事实审计。缺口仅是一个不暴露 `AgentTaskExecutionStoreV1.getTask()`、任务信封或私有 SQL 的公共窄读，以及 C06 可签发和复验的精确读取 branch。

C17 的 D-09 是接口与语义的权威来源：C17 后续只会把自身 pending authoring attempt 的精确 `taskRef` 交给注入式 reader，固定 `expectedTaskType: "knowledge-authoring"`，并为每次读取取得新鲜 `agent-task.read-failure-evidence` 授权。本 change 不读取或修改 C17 实现。

## Goals / Non-Goals

**Goals:**

- 在 C08 属主模块形成一个稳定、类型化、不可枚举的失败证据窄读边界。
- 复用现有 C08 表、状态 Schema、预算台账、C03 事务和 C06 exact branch 机制。
- 使 C17 无需依赖 `AgentTaskStoreV1.getTask()`、`PostgresAgentTaskAdapter.getTask()` 或 C08 私有表。

**Non-Goals:**

- 不实现 C17 failure revision、diagnostic artifact、review request 或 settlement 状态机。
- 不增加列表、搜索、“最新任务”、任务正文或工件正文读取。
- 不演进 `AgentTaskPortV1`、现有任务信封、状态机、预算或候选契约。
- 不新增依赖、迁移、HTTP/API、Worker 组合或 UI。

## Decisions

### D-01：公共类型由 C08 core agent-runtime 直接导出

`packages/core/src/agent-runtime/runtime.ts` 增加并由现有 barrel 导出下列精确类型；不把 reader 塞入 C02 `AgentTaskPortV1`，也不建立通用 task repository：

```ts
export interface AgentTaskFailureEvidenceReaderV1 {
  readTerminalFailure(
    input: AgentTaskFailureEvidenceReadRequestV1,
  ): Promise<AgentTaskFailureEvidenceReadResultV1>;
}

export interface AgentTaskFailureEvidenceReadRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly taskRef: AgentTaskRefV1;
  readonly expectedTaskType: AgentTaskTypeV1;
  readonly authorization: AuthorizationContextV1;
}

export type AgentTaskFailureEvidenceReadResultV1 =
  | { readonly kind: "succeeded"; readonly evidence: AgentTaskFailureEvidenceV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

export interface AgentTaskFailureEvidenceV1 {
  readonly taskRef: AgentTaskRefV1;
  readonly taskType: AgentTaskTypeV1;
  readonly terminalStatus: "terminal-failure" | "cancelled";
  readonly error?: AgentStructuredErrorV1;
  readonly cancelReasonCode?: string;
  readonly usage: AgentBudgetUsageV1;
  readonly actionRefs: readonly VersionReference[];
  readonly candidateArtifactRefs: readonly ArtifactRefV1[];
  readonly validationArtifactRefs: readonly ArtifactRefV1[];
}
```

这些名称、字段和签名与 C17 D-09 完全一致。实现继续复用现有 `AgentTaskRefV1`、`AgentTaskTypeV1`、`AuthorizationContextV1`、`ModuleErrorV1`、`AgentStructuredErrorV1`、`AgentBudgetUsageV1`、`VersionReference` 和 `ArtifactRefV1` 事实源，不复制同义 DTO。备选方案是扩写 `AgentTaskPortV1` 或导出任务 snapshot；两者都会扩大所有调用方或泄露 envelope，故不采用。

### D-02：contracts 只增加一个 capability 和一个 exact branch

`ModuleCapabilityV1_VALUES` 只增加 `agent-task.read`，`MODULE_BRANCH_CAPABILITY_V1` 只增加：

```ts
"agent-task.read-failure-evidence": "agent-task.read"
```

C06 的 `ModuleBranchV1Schema`、`allBranches`、`branchCapability()`、`authorize()` 与 `verify()` 均从该 map 派生：工程风险管理员自然取得新 branch，签发/复验上下文仍严格只有 map 对应的一个 capability；其它预设角色不自动获得该 branch。无需修改 C06 生产代码，只在 contracts、core access 和 PostgreSQL C06 既有测试中证明枚举闭合、映射精确以及真实签发/复验结果为唯一 `agent-task.read`。备选方案是复用 `agent-task.start` 或 `projection.query`；两者权限语义不符并会扩大读取面，故不采用。

### D-03：现有 PostgreSQL adapter 同时实现公共 reader

`PostgresAgentTaskAdapter` 增加 `AgentTaskFailureEvidenceReaderV1` 实现和 `readTerminalFailure()`；不新增第二个 adapter、store、repository 或数据库端口。该类已经持有 C08 数据库、C03 `TransactionUnitV1`、可选 C06 `LocalIdentityAccessV1` 和时钟，且现有 `@riskflow/adapters/agent-runtime` barrel 已导出该实现，无需增加 package subpath。

reader 把 C06 verifier 视为必需依赖：实例未注入 `authorization` 时读取关闭失败。保留 constructor 的既有可选形状，避免本 change 迫使所有非读取调用方改造；只有调用新方法时强制该依赖存在。备选方案是把 authorization 改为 constructor 必填，会无关地扩大现有 C08 创建/runner 测试与调用方改动，故不采用。

### D-04：授权先于定位，目标只做三次有界投影查询

执行顺序固定为：

1. 复用现有标识、时间、任务引用和任务类型 Schema 校验请求字段；校验 `projectId/actorId` 与授权上下文一致，且上下文仅含 `agent-task.read`。
2. 在任何任务查询前调用 C06 `verify()`，固定 branch `agent-task.read-failure-evidence`、`invocationId=requestId`、请求工程和授权上下文自带的有界空间；复验返回上下文未扩大且唯一 capability 仍为 `agent-task.read`。
3. 以 `project_id + agent_task_id + version_id` 单点查询任务投影，并比较持久化的完整 `AgentTaskRefV1`、`task_type`、请求 `expectedTaskType` 与 `terminal-failure | cancelled` 状态。
4. 只在步骤 3 成功后，按同一 `agent_task_id` 分别查询动作的 `action_id/sequence` 与候选的 `candidate_version/candidate_artifact_ref/validation`；不 `selectAll()`，不打开 C04 工件。
5. 以任务 `budget_ledger.used` 作为 `usage`；动作按 sequence 升序映射为 `{ entityId: actionId, versionId: String(sequence) }`；候选工件按 candidate_version 升序；校验工件按该顺序以完整 artifact ref 首次出现去重。

不存在、跨工程、完整 task ref 不同、错 task type、非终态、请求身份不符、缺少 verifier 或 C06 授权拒绝均走同一个固定 `AUTHORIZATION_DENIED` helper，`requiredCapability` 为 `agent-task.read`，不携带目标状态、实际类型、任务错误或工件引用。C06 的瞬时技术失败和 C03/数据库故障保留 `ModuleErrorV1` 的技术可重试语义；同 requestId 异载荷保留 `IDEMPOTENCY_CONFLICT`。不复用现有通用 Agent 错误映射中为 start 命令固定的 capability。

### D-05：结果是手工白名单投影，不返回 envelope 或正文

成功对象只逐字段构造 D-01 的 `AgentTaskFailureEvidenceV1`。任务行的 `envelope`、`frozen_authorization`、`frozen_input_ref`、模型/提示/工具策略，动作的 intent/result artifact，候选 increment/result 和任何 C04 内容均不进入投影；方法不提供列表参数，也不调用 artifact store。测试对成功结果做字段白名单与敏感标记负向断言，而不锁定数据库查询或私有 helper 调用顺序。

### D-06：成功读取用 C03 收据和事实审计幂等收口

目标投影成功后，以 `requestId` 作为 `commandId`，固定 command kind/idempotency namespace `agent-task.read-failure-evidence`，规范 payload 只含请求身份、精确任务引用、预期类型、请求时刻和授权上下文引用。C03 handler 写零事件并追加一条 action 为 `agent-task.read-failure-evidence` 的事实审计，target/version 使用请求的精确 task ref；相同请求同载荷重放返回重新投影的同一不可变终态证据且不重复审计，相同请求异载荷由 C03 payload digest 返回幂等冲突。

C06 对授权签发/复验继续写自身安全审计；C08 不为失败定位另建审计表，也不把拒绝原因或目标事实写入日志。终态不可逆，且现有候选写入在终态后被拒绝，因此成功审计前后的重新投影不会产生可观察漂移。

### D-07：测试分层与 C17 对应关系

- contracts 测试证明 capability 闭合和 exact branch map；core access 测试证明 `branchCapability()` 与工程风险管理员 branch 集合自动包含新项；C06 PostgreSQL 测试证明真实 authorize/verify 只返回 `agent-task.read`。
- C08 PostgreSQL adapter 测试通过公共任务动作形成 terminal-failure 和 cancelled，断言结构化错误/取消原因、`budgetLedger.used`、动作映射、候选排序、校验去重、审计重放和异载荷冲突。
- 同一 adapter 行为表覆盖不存在、跨工程、完整 task ref 不符、错 `expectedTaskType`、非终态、未授权/缺 verifier，统一断言 `kind: "failed"`、`AUTHORIZATION_DENIED` 和 `requiredCapability: "agent-task.read"`。
- 成功响应负向断言不存在 `envelope`、`frozenAuthorization`、模型响应、正文、动作 intent/result、candidate increment/result 及列表字段。
- C17 后续只注入 `AgentTaskFailureEvidenceReaderV1`，以其 pending attempt 的精确 task ref、`expectedTaskType: "knowledge-authoring"` 和新鲜 exact branch 授权调用；禁止注入 `AgentTaskExecutionStoreV1`、调用 `getTask()` 或查询 C08 表。

该接口是 Agent-native 失败审计的横切前置，只强化 C08 公共边界，不改变 RI-S1～RI-S6 或 RA-S1～RA-S7 的领域计算、发布或人工决定。

## Risks / Trade-offs

- [新增 branch 自动进入工程风险管理员的 `allBranches`] → 这是 C06 现有闭合角色策略的预期行为；通过 core 与真实 C06 测试固定唯一 capability，其他角色列表不变。
- [统一授权拒绝降低诊断粒度] → C06 安全审计保留授权决定，调用方只得到不可枚举错误；技术故障和幂等冲突仍用独立结构化错误。
- [reader 与现有 C08 表列耦合] → 实现留在表属主 adapter 内，只选公开投影所需列；下游只依赖 D-01 接口。
- [同一 requestId 重放会重新查询] → 终态、动作和候选已不可变，C03 只负责审计/收据去重；无需为一个小投影新增结果表。

## Migration Plan

不新增数据库迁移或数据回填。部署顺序为 contracts → core → adapters；C17 只能在本 change 实现、验证并归档后接入。回滚只需回退对应代码和规格提交，不涉及持久化结构或数据删除。
