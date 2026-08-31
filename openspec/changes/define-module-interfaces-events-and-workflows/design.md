## Context

见 [proposal.md](./proposal.md) 的动机与 [spec.md](./specs/domain/module-interfaces-events-workflows/spec.md) 的可观察行为。C00 已建立三应用三共享包和依赖边界，C01 已在 `@riskflow/contracts/{vocabulary,common,records}` 冻结 Zod SSOT、精确版本、双时间、证据、命令/错误信封以及识别—评估—预警—处置记录。当前生产代码中没有 module port、领域事件或工作流 DTO。

C02 是 G0 的最后一个串行契约 change。它只能在 `packages/contracts` 增加纯契约，不实现六领域模块、应用模块、LangGraph、Outbox、checkpointer 或 adapter。下游 C03～C31 只能实现本设计冻结的接缝；若真实实现需要改变字段或分支，必须另开契约演进 change，不能在业务 change 中顺手修改。

## Goals / Non-Goals

**Goals:**

- 用三个深层契约模块固定 port、事务领域事件和工作流引用，并保持公开面小于下游实现复杂度。
- 让每个跨模块输入都能回答“谁、在哪个工程、基于哪个权限/版本、以什么幂等身份、产生了哪个结果或错误”。
- 固定六领域模块的事实所有权、三个应用模块的只读/编排边界和单向依赖。
- 把 I0～I9、A0～A9、顶层入口、暂停/恢复/取消落实为 strict Zod DTO，同时不把业务正文写入图状态。
- 让领域事件只传事实引用，并预先固定本地事务原子性和至少一次消费幂等语义。
- 给 Luna 一个无需再决定命名、文件、Schema、错误、权限、事务和验证层次的实施清单。

**Non-Goals:**

- 不实现任何领域规则、评分、矩阵、阈值、检索、合并、置信度、预测、复核迁移或业务写入。
- 不定义 PostgreSQL 表、迁移、Outbox 表、消息设施、LangGraph checkpointer 或 Qdrant/文件投影；C03 及后续 change 实现这些内容。
- 不实现完整 Agent 任务信封、五类增量、工具白名单、预算执行或模型网关；C02 只固定应用 port、任务类型与版本化引用，C08 在该接缝内深化。
- 不实现 HTTP/OpenAPI/SSE、Web 查询模型或导出格式；C09/C31 组合已有 Schema，不重定义领域字段。
- 不修改 C01 的 vocabulary/common/records、根便利入口或主 specs；不增加依赖，不创建未来 adapter 占位。
- 不把 Wayfinder 原型中的旧多包目录带回生产结构；当前目录只采用 `packages/contracts`、`packages/core`、`packages/adapters`。

## Decisions

### 1. 三个子路径是 C02 的全部生产交付面

新增以下深层契约模块：

| 公开子路径 | 文件 | 拥有内容 | 明确不拥有 |
| --- | --- | --- | --- |
| `@riskflow/contracts/ports` | `packages/contracts/src/ports/index.ts` | 授权上下文、类型化错误/结果、版本化引用、六领域与三应用 port、workflow 调用 DTO | 领域实现、数据库 adapter、HTTP transport |
| `@riskflow/contracts/events` | `packages/contracts/src/events/index.ts` | 事务领域事件元数据和十个闭合事件分支 | Outbox 实现、broker、消费者注册 |
| `@riskflow/contracts/workflows` | `packages/contracts/src/workflows/index.ts` | I/A 输入快照与阶段结果、子图/顶层图状态 | LangGraph 节点/边、checkpointer、领域逻辑 |

`packages/contracts/package.json` 只增加 `./ports`、`./events`、`./workflows` 的 `types`/`import` exports。`packages/contracts/src/index.ts` 不重导出 C02 内容；下游使用明确子路径，避免未来业务 changes 争用根 barrel。

子模块依赖固定为 `vocabulary/common/records → ports → events` 与 `vocabulary/common/records → ports → workflows`；`ports` 不导入 `events/workflows`，`events` 与 `workflows` 互不导入。事件/阶段所需的事件或阶段引用在 `ports` 中作为小型类型化引用定义，避免循环依赖。

**选项：**（A）全部放入根入口；（B）每个 DTO 一个文件；（C）三个按变化轴划分的子路径。  
**推荐：** C。  
**条件结论：** 当前规模只需要三个 `index.ts`；某个子路径超过可导航范围且出现独立所有者时，再在保持子路径不变的前提下拆内部文件。不得仅为“以后可能”拆包。

### 2. Zod Schema 仍是唯一事实源，复用 C01 而不修改它

三个模块均直接从 `../common/index.js`、`../records/index.js` 或 `../vocabulary/index.js` 复用 C01 Schema。每个公共 DTO 先导出 `...Schema`，再导出 `z.infer<typeof ...Schema>` 类型。所有对象使用 `z.strictObject`，所有联合使用显式 `kind`、`code`、`eventType`、`stage` 或 `entryMode` 判别；不使用 `Record<string, unknown>`、`z.unknown()` 载荷、`.passthrough()` 或可选字段组合模拟联合。

C01 的 `CommandEnvelopeSchema` 只作为字段事实源；C02 的具体命令分支以 `.extend({ kind, authorization, payload: <strict schema> })` 收窄 `payload`。C01 `ErrorEnvelopeSchema` 可供未来 transport 映射，但 C02 module 路由只使用下文闭合 `ModuleErrorV1`，不读取开放 `details` 做分支。

**选项：**（A）重写一套 command/ref/error 基础字段；（B）直接使用 C01 的开放载荷/详情；（C）复用 C01 基础 Schema并导出收窄后的具体联合。  
**推荐：** C。  
**条件结论：** 若 C01 的基础字段本身需要变化，停止 C02 实施并开 C01 契约演进；不得在 ports 内复制修正版。

### 3. 版本化引用采用一个内部构造器和命名 Schema

`ports/index.ts` 定义不导出的 `versionedRef(kind)` 小函数，生成 strict `{ kind: <literal>, reference: VersionReferenceSchema }`。随后导出以下命名 Schema；字段必须引用具体 Schema，不能退化为任意 `VersionReference`。唯一例外 `DomainEventRefV1Schema` 固定 `{ kind: "domain-event", eventId, eventVersion: 1 }`，因为事件本身是不可变事实而不是可修订实体。

| 类别 | 命名引用 |
| --- | --- |
| 授权/工程 | `AuthorizationContextRefV1`、`ProjectRevisionRefV1`、`SpatialScopeRefV1`、`SourceAccessGrantRefV1`、`ContentArtifactRefV1`、`DiagnosticArtifactRefV1` |
| 工程数据 | `SourceDeliveryRefV1`、`SourceVersionRefV1`、`SourceSegmentSetRefV1`、`MonitoringSeriesRefV1`、`MonitoringBatchRefV1`、`MonitoringSnapshotRefV1`、`ApplicabilityMetadataSnapshotRefV1`、`ExternalRiskEventRefV1` |
| 知识 | `KnowledgeRevisionRefV1`、`KnowledgeReleaseRefV1`、`KnowledgePreparationTaskRefV1`、`ProcessModelReleaseRefV1`、`RiskMechanismReleaseRefV1`、`RetrievalEvidenceBaseReleaseRefV1`、`IdentificationPolicySetRefV1`、`AssessmentBasisReleaseSetRefV1`、`MeasureLibraryReleaseRefV1`、`KnowledgeQueryResultRefV1` |
| 识别 | `IdentificationPreparationSnapshotRefV1`、`IdentificationInputSnapshotRefV1`、`IdentificationWorkPlanRefV1`、`IdentificationWorkItemRefV1`、`RetrievalArtifactSetRefV1`、`ModelContextArtifactSetRefV1`、`IdentificationCandidateSetRefV1`、`ValidatedCandidateSetRefV1`、`MergePlanRefV1`、`AcceptanceRouteSetRefV1`、`StandardizedRiskRecordRefV1`、`IdentificationRunResultRefV1` |
| 评估/处置 | `AssessmentPreparationSnapshotRefV1`、`AssessmentInputSnapshotRefV1`、`ResponseForecastInputSnapshotRefV1`、`ResponseFeedbackInputSnapshotRefV1`、`IndicatorActualValueSetRefV1`、`AssessmentDecisionArtifactRefV1`、`RiskAssessmentRecordRefV1`、`WarningRecordRefV1`、`WarningResponseTaskRefV1`、`NotificationIntentRefV1`、`RecommendationCandidateRefV1`、`ResponseRecommendationRefV1`、`EffectForecastRefV1`、`ExecutionRecordRefV1`、`FeedbackRefV1`、`DeviationRecordRefV1`、`CalibrationSuggestionRefV1`、`AssessmentRunResultRefV1` |
| 复核/Agent/运行 | `ReviewDecisionRefV1`、`AuditTrailRefV1`、`CommandProposalRefV1`、`UserConfirmationRefV1`、`WorkflowRunRefV1`、`StageResultRefV1`、`RouteDecisionRefV1`、`WorkflowErrorRefV1`、`DomainEventRefV1`、`RiskFlowRunResultRefV1`、`QueryResultRefV1`、`ExportArtifactRefV1` |

`StandardizedRiskRecordRefV1` 和 `ExternalRiskEventRefV1` 组合为 `RiskInputVersionRefV1` 可辨识联合；它补足 C01 `RiskInputReferenceSchema` 没有版本的工作流需求，但不复制风险正文。`ContractReferenceV1Schema` 是上述命名引用的闭合可辨识联合，只用于错误目标、事件聚合与复核目标等确需多事实类型的位置，不接受任意 `VersionReference`。

`AgentTaskRefV1Schema` 和 `ReviewTaskRefV1Schema` 不使用简单构造器，固定额外路由信息：

```text
AgentTaskRefV1 = {
  kind: "agent-task", reference, taskType, triggerMode,
  modelDeploymentRef, promptTemplateRef, toolPolicyRef,
  budgetPolicyRef, incrementSchemaRef, validationPolicyRef
}
ReviewTaskRefV1 = {
  kind: "review-task", reference, reviewType,
  targetRef: ReviewTargetRefV1, waitingRunRef
}
```

`ReviewTargetRefV1Schema` 只允许 identification candidate/group、knowledge revision/rule conflict、response candidate、calibration suggestion。`AgentTaskResultRefV1Schema` 固定 task ref、终态、增量/候选/校验/错误/正式结果引用中的合法组合；它不复制增量正文。事件和图状态只使用这些引用。

**选项：**（A）所有字段都用裸 `VersionReferenceSchema`；（B）为每个实体手写 branded ID；（C）共享两字段形状、导出按事实类型辨识的命名引用。  
**推荐：** C。  
**条件结论：** 若两个真实实体在同一调用位置仍发生误用，再评估 branded ID；当前命名引用已同时提供运行时和静态区分，避免额外类型体系。

### 4. 授权上下文固定发起主体，Agent 只能作为调用来源

`AuthorizationContextV1Schema` 字段固定为：

```text
schemaVersion: "1"
authorizationContextRef: AuthorizationContextRefV1
actorId: Identifier
projectId: Identifier
grantedCapabilities: ModuleCapabilityV1[]       # 至少一项、去重
spatialScopeRefs: SpatialScopeRefV1[]           # 可为空表示仅工程级用例
sourceAccessGrantRefs: SourceAccessGrantRefV1[] # 可为空表示不访问资料正文
authorizationPolicyRef: VersionReference
decidedAt: IsoDateTime
causalRunRef?: WorkflowRunRefV1
invocation:
  | { kind: "human" }
  | { kind: "system"; systemActorId: Identifier; reasonCode: Identifier }
  | { kind: "agent-task"; agentTaskRef: AgentTaskRefV1 }
```

`authorizationContextRef` 标识这份不可变快照；没有父运行的人工顶层命令可以省略 `causalRunRef`，系统触发、Agent 和下游编排必须提供。命令/查询信封中的 `actorId/projectId` 必须与上下文一致，接收方不得以信封值覆盖上下文。

`ModuleCapabilityV1Schema` 固定以下值：

```text
engineering-data.read | engineering-data.write | engineering-data.freeze
knowledge-modeling.read | knowledge-modeling.govern | knowledge-modeling.retrieve
risk-identification.read | risk-identification.run | risk-identification.finalize
risk-assessment.read | risk-assessment.prepare | risk-assessment.evaluate
warning-response.read | warning-response.recommend | warning-response.record
review-audit.read | review-audit.request | review-audit.decide
agent-task.start | agent-task.resume | agent-task.cancel | agent-task.confirm
workflow.start | workflow.resume | workflow.cancel
projection.query | projection.subscribe | projection.export
```

每个 port 分支在设计表中映射一个 required capability。实现必须在副作用前校验 context、实体工程和资料范围；下游只能传原 context 或由授权模块产生的收窄 context。图状态只保存 `AuthorizationContextRefV1`。

| 角色/来源 | 允许 | 禁止 |
| --- | --- | --- |
| 人工主体 | 在获授权工程提交业务命令、查询、复核 | 跨工程、越过资料正文权限 |
| 系统触发 | 按已发布策略创建事件驱动运行 | 以“系统”绕过原业务授权或发布事实 |
| Agent 任务 | 在发起者权限交集内调用任务白名单 port | 作为独立业务身份、扩大权限、直接决定/发布 |
| 查询投影 | 读取获准事实引用与脱敏视图 | 反写领域事实或泄露证据正文 |

**选项：**（A）只传 `actorId/projectId`；（B）每次工具调用动态计算无限细权限；（C）冻结最小授权快照并在正式命令边界复验。  
**推荐：** C。  
**条件结论：** C06 可以把授权上下文持久化和签名，但不得改变字段语义；需要动态撤权时通过正式命令复验或创建新上下文，不在 C02 增加通用策略语言。

### 5. 命令、查询、结果和错误均为闭合联合

写命令复用 C01 的 `commandId`、`idempotencyKey`、`projectId`、`actorId`、`issuedAt`，增加 `kind`、`authorization: AuthorizationContextV1` 和 strict `payload`。读查询使用 `QueryEnvelopeV1Schema`：`queryId`、`projectId`、`actorId`、`requestedAt`、`authorization`、`kind`、strict `payload`；查询没有业务幂等键。

每个 port 方法导出自己的 `...ResultV1Schema`，只允许：

- `{ kind: "succeeded", result: <该方法的精确结果联合> }`；
- `{ kind: "waiting", waiting: WaitingRefV1 }`（仅可暂停用例）；
- `{ kind: "failed", error: ModuleErrorV1 }`。

`WaitingRefV1` 是 `knowledge-preparation`、`review`、`user-confirmation` 三分支。`ModuleErrorV1Schema` 以 `code` 判别；每个分支共有 `category: authorization | not-found | concurrency | idempotency | business-blocked | technical`、`stageCode`、`occurredAt`、`causalRunId`，并固定：

| code | retryable | 精确字段 | 路由 |
| --- | ---: | --- | --- |
| `AUTHORIZATION_DENIED` | false | `requiredCapability`、`authorizationPolicyRef` | 终止/补权限后新命令 |
| `ENTITY_NOT_FOUND` | false | `targetRef: ContractReferenceV1` | 终止 |
| `STALE_VERSION` | false | `targetRef: ContractReferenceV1`、`currentRef?: ContractReferenceV1` | 刷新后新命令 |
| `IDEMPOTENCY_CONFLICT` | false | `idempotencyKey`、`priorCommandId` | 不覆盖原结果 |
| `BUSINESS_BLOCKED` | false | `blockerKind`、`blockerRef: ContractReferenceV1` | 进入类型化等待或上游流程 |
| `TRANSIENT_FAILURE` | true | `attempt`、`retryPolicyRef`、`diagnosticRef: DiagnosticArtifactRefV1`、`retryAt?` | 原输入原策略重试 |
| `TERMINAL_FAILURE` | false | `diagnosticRef: DiagnosticArtifactRefV1` | 终止运行 |
| `UNSUPPORTED_CONTRACT` | false | `schemaVersion`、`graphVersion?` | 升级契约后新运行 |

错误分支不得携带业务正文或开放 details。API 后续可以把该联合映射成 C01 `ErrorEnvelopeSchema`，但业务路由只读闭合字段。

幂等唯一键固定为 `(projectId, commandKind, idempotencyKey)`；相同键的规范化 strict payload 哈希不一致即 `IDEMPOTENCY_CONFLICT`。`commandId` 用于审计/因果，不能代替业务幂等键。

**选项：**（A）异常字符串；（B）一个通用错误加任意 details；（C）闭合错误联合。  
**推荐：** C。  
**条件结论：** 新增稳定错误路由必须走契约演进；展示文案、日志堆栈和第三方错误只进入 `diagnosticRef` 所指受保护工件，不扩张公共错误。

### 6. 六领域模块的精确 port

所有方法返回 `Promise<对应 ResultV1>`，隐藏事务、重试和持久化。不得额外导出通用仓储 port。每个方法参数均是下表命名 Schema 的派生类型。

#### 6.1 `EngineeringDataPortV1`

```text
apply(command: EngineeringDataCommandV1)
freeze(command: EngineeringFreezeCommandV1)
read(query: EngineeringDataQueryV1)
```

| 方法 | `kind` 分支 | payload | 成功结果 | capability |
| --- | --- | --- | --- | --- |
| `apply` | `register-source-delivery` | 来源标识、交付幂等身份、工件引用、元数据引用 | `SourceDeliveryRefV1`、`SourceVersionRefV1` | `engineering-data.write` |
| `apply` | `register-monitoring-batch` | 监测序列、批次窗口、样本工件引用、更正/补录引用 | `MonitoringBatchRefV1` | `engineering-data.write` |
| `apply` | `register-external-risk-event` | 外部来源、证据引用、事件工件引用 | `ExternalRiskEventRefV1` | `engineering-data.write` |
| `freeze` | `identification-preparation` | 资料/区段范围、可选监测截止点、处理策略引用 | `IdentificationPreparationSnapshotRefV1` 或业务阻断 | `engineering-data.freeze` |
| `freeze` | `assessment-preparation` | `RiskInputVersionRefV1`、空间范围、适用性/监测截止点 | `AssessmentPreparationSnapshotRefV1` | `engineering-data.freeze` |
| `freeze` | `monitoring-snapshot` | 序列引用、截止点、可用性策略引用 | `MonitoringSnapshotRefV1` | `engineering-data.freeze` |
| `read` | `source-segments` | `SourceSegmentSetRefV1` | `QueryResultRefV1` | `engineering-data.read` |
| `read` | `monitoring-snapshot` | `MonitoringSnapshotRefV1` | `QueryResultRefV1` | `engineering-data.read` |
| `read` | `evidence-access` | 证据引用集合、用途码 | `QueryResultRefV1`（仅获准定位/摘要） | `engineering-data.read` |

#### 6.2 `KnowledgeModelingPortV1`

```text
govern(command: KnowledgeGovernanceCommandV1)
resolve(command: KnowledgeResolutionCommandV1)
retrieve(query: KnowledgeRetrievalQueryV1)
```

| 方法 | `kind` 分支 | 输入 | 成功结果 | capability |
| --- | --- | --- | --- | --- |
| `govern` | `submit-revision`、`request-review`、`publish-approved-release`、`deactivate-release`、`rollback-by-new-release` | 定义类型、目标/基线精确版本、候选工件或决定引用 | 新修订/发布集合/任务引用 | `knowledge-modeling.govern` |
| `resolve` | `identification-basis` | `IdentificationPreparationSnapshotRefV1` | 工序模型、机理库、检索证据库、策略集合精确引用；或知识准备等待 | `knowledge-modeling.read` |
| `resolve` | `assessment-basis` | `AssessmentPreparationSnapshotRefV1` | `AssessmentBasisReleaseSetRefV1`；或知识准备等待 | `knowledge-modeling.read` |
| `retrieve` | `hybrid-evidence` | 输入快照、工作项、检索策略 | `KnowledgeQueryResultRefV1` | `knowledge-modeling.retrieve` |
| `retrieve` | `relationship-context` | 输入快照、工作项 | `KnowledgeQueryResultRefV1` | `knowledge-modeling.retrieve` |
| `retrieve` | `measure-candidates` | 评估/预警引用、措施库版本 | `KnowledgeQueryResultRefV1` | `knowledge-modeling.retrieve` |

`resolve` 不发布缺失知识；它只返回 ready 或 `KnowledgePreparationTaskRefV1` 等待引用。`retrieve` 返回工件引用，不把检索片段正文放入调用结果。

#### 6.3 `RiskIdentificationPortV1`

```text
plan(command: IdentificationPlanCommandV1)
analyze(command: IdentificationAnalysisCommandV1)
finalize(command: IdentificationFinalizationCommandV1)
```

| 方法 | 分支 | 输入 | 成功结果 | capability |
| --- | --- | --- | --- | --- |
| `plan` | 单一用例 | 冻结识别输入快照 | `IdentificationWorkPlanRefV1` | `risk-identification.run` |
| `analyze` | `assemble-and-infer` | 工作项、最终检索工件、模型/提示版本 | `ModelContextArtifactSetRefV1`、`IdentificationCandidateSetRefV1` | `risk-identification.run` |
| `analyze` | `repair-and-validate` | 候选集、修复/规则/仿真策略 | `ValidatedCandidateSetRefV1` | `risk-identification.run` |
| `finalize` | `merge-run-candidates` | 工作计划、全部可继续候选集 | `MergePlanRefV1`，无重复时含显式 skip 分支 | `risk-identification.finalize` |
| `finalize` | `route-acceptance` | 合并计划、置信度/强制复核策略 | `AcceptanceRouteSetRefV1`、`ReviewTaskRefV1[]` | `risk-identification.finalize` |
| `finalize` | `accept-groups` | 通过验收的组与自动/人工决定引用 | `StandardizedRiskRecordRefV1[]`、评估事件引用 | `risk-identification.finalize` |

`modelConfidence` 只来自 RI-S57 候选并保持只读；人工修订以新候选版本引用进入相同校验/验收入口。任何标准化风险记录只能由 `accept-groups` 原子形成。

#### 6.4 `RiskAssessmentPortV1`

```text
prepare(command: AssessmentPreparationCommandV1)
evaluate(command: AssessmentEvaluationCommandV1)
```

| 方法 | 分支 | 输入 | 成功结果 | capability |
| --- | --- | --- | --- | --- |
| `prepare` | `initial`、`reassessment`、`historical-backfill` | 评估准备快照、评估知识精确版本；重评估含前次记录和原因 | `AssessmentInputSnapshotRefV1` | `risk-assessment.prepare` |
| `evaluate` | 单一深用例 | 评估输入快照 | 指标实际值工件、评分/触发决定工件和完整 `RiskAssessmentRecordRefV1` | `risk-assessment.evaluate` |

`evaluate` 内部完成显式字段映射、单位/时效/必需性、基础分、P/C、舍入、矩阵和全部触发判定；任一必需输入失败时不返回部分等级。A3～A5 通过一个结果中的三个引用展示阶段里程碑，不为内部函数制造 port。

#### 6.5 `WarningResponsePortV1`

```text
open(command: OpenWarningCommandV1)
recommend(command: RecommendationCommandV1)
record(command: WarningResponseRecordCommandV1)
```

| 方法 | 分支 | 输入 | 成功结果 | capability |
| --- | --- | --- | --- | --- |
| `open` | 单一用例 | 已入库评估记录 | 各触发类型预警引用、归集任务引用、通知意图引用；未触发返回显式空结果 | `warning-response.record` |
| `recommend` | `create-candidate` | 任务、措施候选集、Agent 增量引用 | `RecommendationCandidateRefV1` | `warning-response.recommend` |
| `recommend` | `validate-and-record` | 候选、三项策略/上下文引用 | 正式 `ResponseRecommendationRefV1` 或 `ReviewTaskRefV1` | `warning-response.recommend` |
| `record` | `adopt-recommendation` | 正式建议版本、采纳决定 | 决定/预测运行入口引用 | `warning-response.record` |
| `record` | `record-execution` | 采纳来源或现场独立行动、执行者/录入者、发生时间、证据 | `ExecutionRecordRefV1` | `warning-response.record` |
| `record` | `record-feedback` | 执行记录、处置后监测快照、现场反馈工件 | `FeedbackRefV1` | `warning-response.record` |
| `record` | `calculate-deviation` | 预测、反馈及预测时冻结评分依据 | `DeviationRecordRefV1` 或显式 unavailable 结果 | `warning-response.record` |
| `record` | `create-calibration-suggestion` | 超阈值偏差、已校验 Agent 增量 | `CalibrationSuggestionRefV1`、`ReviewTaskRefV1` | `warning-response.record` |

三项校验失败没有“强行通过”分支；现场独立行动与系统建议使用不同输入分支，无合法预测时不得生成偏差。

#### 6.6 `ReviewAuditPortV1`

```text
requestReview(request: ReviewRequestV1)
decideReview(command: ReviewDecisionCommandV1)
trace(query: TraceQueryV1)
```

`ReviewSubjectV1` 固定 `identification-group`、`knowledge-revision`、`rule-conflict`、`response-candidate`、`calibration-suggestion`。每个 subject 分支携带目标精确版本、校验/证据快照和待恢复运行引用。

`ReviewDecisionV1` 是按 subject 闭合的联合：

- 识别组：`approve-unchanged`、`approve-revised-candidate`、`confirm-merge`、`keep-separate`、`reject`、`return-upstream`；修订只引用已由风险识别模块创建的候选修订，不能带 JSON Patch，不能改 `modelConfidence`。
- 知识/规则：`approve-publication`、`reject`、`return-for-revision`；发布仍由知识模块正式命令执行。
- 处置候选：`submit-revised-candidate`、`return-upstream`、`reject`；不存在覆盖失败校验的批准。
- 校准建议：`approve-draft-creation`、`reject`、`return-for-revision`；批准只允许创建治理草稿，不发布生效版本。

`decideReview` 使用 `review-audit.decide`，陈旧目标返回 `STALE_VERSION`；`trace` 使用 `review-audit.read`，只返回 `AuditTrailRefV1` 或获准查询引用。

**选项：**（A）每个模块大量细方法；（B）一个 `execute(any)`；（C）每模块 2～3 个用例级方法、方法内闭合分支。  
**推荐：** C。  
**条件结论：** 当同一方法出现两个需要独立授权、事务或性能契约的真实调用族时，另开契约演进拆方法；当前不得暴露模块内部步骤。

### 7. 三个应用模块的 port 不拥有业务事实

#### 7.1 `AgentTaskPortV1`

```text
startTask(command: StartAgentTaskCommandV1)
resumeTask(command: ResumeAgentTaskCommandV1)
cancelTask(command: CancelAgentTaskCommandV1)
confirmCommand(command: ConfirmAgentCommandV1)
```

`AgentTaskTypeV1Schema` 固定五类：`data-cleaning`、`knowledge-authoring`、`retrieval-review`、`response-recommendation`、`calibration-suggestion`。`StartAgentTaskCommandV1` 固定任务类型、`embedded | interactive`、父运行、冻结输入引用、模型/提示/工具/预算/增量/校验策略精确版本和业务幂等键。C02 只返回 `AgentTaskRefV1` 或 `AgentTaskResultRefV1`；任务专属增量内容由 C08 及业务 change 在各自事实目录定义，并通过任务类型引用，不放入图状态。

`confirmCommand` 只接受 `interactive` 任务生成的 `CommandProposalRefV1`，确认后调用原领域 port；Agent 任务本身不写正式事实。

#### 7.2 `WorkflowPortV1`

```text
startRun(command: StartWorkflowRunCommandV1)
resumeRun(command: ResumeWorkflowRunCommandV1)
cancelRun(command: CancelWorkflowRunCommandV1)
```

`startRun` 使用第 10 节六值 `entryMode` 和对应 payload 联合；`resumeRun` 只接受第 10 节六分支 `resumeCause`；`cancelRun` 只记录协作式取消原因。所有分支使用 workflow capability。

#### 7.3 `ProjectionPortV1`

```text
query(request: ProjectionQueryV1)
subscribe(request: RunSubscriptionRequestV1)
export(request: ProjectionExportRequestV1)
```

查询类型固定 `risk-overview`、`trace-chain`、`association-graph`、`run-view`、`agent-task-view`、`review-queue`；输出为 `QueryResultRefV1`。订阅只接受运行引用与上次事件游标，输出类型化运行事件引用；导出只接受查询结果/事实引用和导出策略版本，返回 `ExportArtifactRefV1`。它们不复制领域 Schema、不能回写事实。

**选项：**（A）把应用模块并入领域模块；（B）每个应用自己访问存储；（C）独立应用 port 只组合领域引用。  
**推荐：** C。  
**条件结论：** C08/C09/C31 可以增加实现内部 seam，但不能扩大本外部 interface；出现第二种真实 transport 时才建立对应 adapter seam。

#### 7.4 所有 port 分支的 payload 字段冻结

为消除实现阶段的字段判断，所有写分支共享且只共享 `CommandEnvelopeSchema` 的 `commandId/idempotencyKey/projectId/actorId/issuedAt` 加 `authorization`；下表只列 strict `payload`。所有 `...PolicyRef`、`...StrategyRef`、`...ModelRef` 均使用 C01 `VersionReferenceSchema`，所有时间使用 `IsoDateTimeSchema`，所有证据使用 `EvidenceReferenceSchema`，未标 optional 的字段必填。

**工程数据：**

| kind | strict payload 字段 |
| --- | --- |
| `register-source-delivery` | `sourceConnectionRef`、`deliveryKey`、`sourceArtifactRef: ContentArtifactRefV1`、`metadataArtifactRef: ContentArtifactRefV1`、`occurredAt` |
| `register-monitoring-batch` | `monitoringSeriesRef`、`deliveryKey`、`sampleArtifactRef: ContentArtifactRefV1`、`window: { from, to }`（to > from）、`relation: original | correction{priorBatchRef} | supplement{priorBatchRef}` |
| `register-external-risk-event` | `externalSourceRef`、`externalEventKey`、`eventArtifactRef: ContentArtifactRefV1`、`evidenceReferences[]`（至少一项）、`occurredAt` |
| `identification-preparation` | `projectRevisionRef`、`spatialScopeRefs[]`（至少一项）、`sourceVersionRefs[]`（至少一项）、`monitoringCutoff?`、`dataProcessingPolicyRef` |
| `assessment-preparation` | `riskInput: RiskInputVersionRefV1`、`projectRevisionRef`、`spatialScopeRef`、`applicabilityMetadataSnapshotRef?`、`monitoringCutoff?` |
| `monitoring-snapshot` | `monitoringSeriesRef`、`cutoff`、`availabilityPolicyRef` |

工程查询 payload：`source-segments { sourceSegmentSetRef }`、`monitoring-snapshot { monitoringSnapshotRef }`、`evidence-access { evidenceReferences[]; purposeCode }`。

**知识建模：**

`KnowledgeDefinitionTypeV1Schema` 固定 `process-model`、`risk-mechanism`、`retrieval-evidence-base`、`indicator-system`、`indicator-field-mapping`、`structured-scoring-rule`、`applicable-rule-set`、`weight-set`、`scoring-strategy`、`risk-matrix`、`risk-acceptance-threshold`、`monitoring-warning-threshold`、`joint-trigger-policy`、`measure-library`、`forecast-policy`、`deviation-policy`。

| kind | strict payload 字段 |
| --- | --- |
| `submit-revision` | `definitionType`、`baseReleaseRef?`、`candidateArtifactRef`、`evidenceReferences[]`（至少一项） |
| `request-review` | `revisionRef: KnowledgeRevisionRefV1`、`reviewPolicyRef` |
| `publish-approved-release` | `revisionRef`、`reviewDecisionRef`、`effectiveFrom` |
| `deactivate-release` | `releaseRef: KnowledgeReleaseRefV1`、`reasonCode` |
| `rollback-by-new-release` | `historicalReleaseRef`、`reviewDecisionRef`、`reasonCode` |
| `identification-basis` | `preparationSnapshotRef`、`requiredAt` |
| `assessment-basis` | `preparationSnapshotRef`、`requiredAt` |

知识查询 payload：`hybrid-evidence { inputSnapshotRef; workItemRef; retrievalPolicyRef }`、`relationship-context { inputSnapshotRef; workItemRef }`、`measure-candidates { assessmentRecordRef; warningResponseTaskRef; measureLibraryReleaseRef }`。

**风险识别：**

| method / kind | strict payload 字段 |
| --- | --- |
| `plan` | `inputSnapshotRef` |
| `analyze / assemble-and-infer` | `workItemRef`、`retrievalArtifactSetRef`、`modelDeploymentRef`、`promptTemplateRef` |
| `analyze / repair-and-validate` | `candidateSetRef`、`repairPolicyRef`、`ruleValidationPolicyRef`、`simulationConstraintPolicyRef?` |
| `finalize / merge-run-candidates` | `workPlanRef`、`validatedCandidateSetRefs[]`（至少一项）、`mergePolicyRef` |
| `finalize / route-acceptance` | `mergePlanRef`、`confidencePolicyRef`、`forcedReviewPolicyRef` |
| `finalize / accept-groups` | `acceptanceRouteSetRef`、`acceptedGroupRefs[]`（至少一项）、`decisionRefs[]`（每组一项，自动决定使用 `RouteDecisionRefV1`，人工决定使用 `ReviewDecisionRefV1`） |

**风险评估：**

| method / kind | strict payload 字段 |
| --- | --- |
| `prepare / initial` | `preparationSnapshotRef`、`assessmentBasisReleaseSetRef` |
| `prepare / reassessment` | 上述字段 + `previousAssessmentRecordRef`、`reason: monitoring-snapshot | applicability-metadata | applicable-rule-set | weight-or-strategy | risk-matrix` |
| `prepare / historical-backfill` | 上述字段 + `effectiveAt` |
| `evaluate` | `assessmentInputSnapshotRef` |

`evaluate` 成功 result 恰好包含 `indicatorActualValueSetRef`、`assessmentDecisionArtifactRef`、`assessmentRecordRef`；不得返回部分三元组。

**预警处置：**

| method / kind | strict payload 字段 |
| --- | --- |
| `open` | `assessmentRecordRef`、`warningAggregationPolicyRef`、`notificationPolicyRef` |
| `recommend / create-candidate` | `warningResponseTaskRef`、`measureCandidateQueryResultRef`、`agentTaskResultRef`、`responseGenerationPolicyRef` |
| `recommend / validate-and-record` | `recommendationCandidateRef`、`responseValidationPolicyRef`、`siteContextRef` |
| `record / adopt-recommendation` | `responseRecommendationRef`、`decision: adopted | declined`、`reasonCode` |
| `record / record-execution` | `actionSource: adopted-recommendation{responseRecommendationRef} | independent-action{measureReleaseRefs[]}`、`executedByActorId`、`recordedByActorId`、`occurredAt`、`evidenceReferences[]` |
| `record / record-feedback` | `executionRecordRef`、`postActionMonitoringSnapshotRef`、`feedbackArtifactRef`、`occurredAt` |
| `record / calculate-deviation` | `effectForecastRef`、`feedbackRef`、`frozenAssessmentBasisRef` |
| `record / create-calibration-suggestion` | `deviationRecordRef`、`agentTaskResultRef`、`calibrationValidationPolicyRef` |

**复核审计：**

`requestReview` payload 固定 `reviewType`、`targetRef`、`validationSnapshotRef`、`evidenceSnapshotRef`、`waitingRunRef`、`reviewPolicyRef`；`decideReview` payload 固定 `reviewTaskRef`、`targetRef`、第 6.6 节对应 decision 分支、`reasonCode`。`trace` 查询 payload 固定 `subjectRef`、`asOfRecordedAt?`、`includeEvidenceSummary: boolean`，原始证据正文仍按授权单独读取。

**Agent、workflow 与投影：**

| command/query | strict payload 字段 |
| --- | --- |
| `startTask` | `taskType`、`triggerMode`、`parentRunRef`、`frozenInputRef`、model/prompt/tool/budget/increment/validation policy refs |
| `resumeTask` | `agentTaskRef`、`resumeReason: transient-recovered | user-confirmed`、`resumeEvidenceRef` |
| `cancelTask` | `agentTaskRef`、`reasonCode` |
| `confirmCommand` | `agentTaskRef`、`commandProposalRef`、`confirmation: confirmed | rejected` |
| `startRun` | 第 10 节 `entryMode` 对应 payload + `graphVersion`、`retryPolicyRef` |
| `resumeRun` | `workflowRunRef`、`resumeCause` 闭合联合、`expectedStateVersion` |
| `cancelRun` | `workflowRunRef`、`expectedStateVersion`、`reasonCode` |
| `projection query` | `queryType`、对应 subject refs、`asOfRecordedAt?` |
| `subscribe` | `workflowRunRef`、`afterEventId?` |
| `export` | `sourceRef: QueryResultRefV1 | ContractReferenceV1`、`exportPolicyRef` |

任何表外字段、optional 组合替代分支或用 `ContentArtifactRefV1` 传正式业务记录均为 Schema 失败。

### 8. 十个事务领域事件分支只携带引用

`DomainEventMetadataV1Schema` 固定：

```text
schemaVersion: "1"
eventId: Identifier
eventVersion: 1
projectId: Identifier
aggregateRef: ContractReferenceV1
occurredAt: IsoDateTime       # 业务发生时间
recordedAt: IsoDateTime       # 系统记录时间
causationId: Identifier
correlationId: Identifier
producerCommandId: Identifier
idempotencyKey: Identifier
authorizationContextRef: AuthorizationContextRefV1
auditTrailRef: AuditTrailRefV1
```

`DomainEventV1Schema` 以 `eventType` 判别以下 strict 分支：

| eventType | 精确 payload | 生产者 | 主要消费者 |
| --- | --- | --- | --- |
| `engineering.inputs-ready.v1` | `preparation: identification { identificationPreparationSnapshotRef } \| assessment { assessmentPreparationSnapshotRef }` | 工程数据 | workflow |
| `identification.risk-record-accepted.v1` | `standardizedRiskRecordRef`、`identificationInputSnapshotRef`、`identificationRunRef` | 风险识别 | 风险评估/workflow |
| `engineering.assessment-input-changed.v1` | `change: monitoring-snapshot { previousMonitoringSnapshotRef, newMonitoringSnapshotRef } \| applicability-metadata { previousApplicabilityMetadataSnapshotRef, newApplicabilityMetadataSnapshotRef }`、`reasonCode` | 工程数据 | workflow 重评估 |
| `knowledge.assessment-basis-published.v1` | `basisKind`、`newKnowledgeReleaseRef`、`affectedProjectRevisionRef` | 知识建模 | workflow 重评估 |
| `assessment.recorded.v1` | `riskInputRef`、`assessmentInputSnapshotRef`、`assessmentRecordRef`、`assessmentRunRef` | 风险评估 | 预警处置/投影 |
| `warning.warning-recorded.v1` | `assessmentRecordRef`、`warningRecordRef`、`warningResponseTaskRef`、`notificationIntentRefs[]` | 预警处置 | notification/projection |
| `warning.feedback-recorded.v1` | `executionRecordRef`、`feedbackRef`、`forecast: available { effectForecastRef } \| unavailable { reasonCode }` | 预警处置 | workflow 偏差入口 |
| `warning.calibration-suggestion-created.v1` | `deviationRecordRef`、`calibrationSuggestionRef`、`reviewTaskRef` | 预警处置 | 复核审计/投影 |
| `review.review-requested.v1` | `reviewTaskRef`、`targetRef`、`waitingRunRef` | 复核审计 | workflow/projection |
| `review.review-resolved.v1` | `reviewTaskRef`、`reviewDecisionRef`、`resumeRunRef` | 复核审计 | workflow/所属领域模块 |

本地领域命令提交边界固定为“业务事实 + 审计 + 待发布事件”同一事务。跨模块不使用分布式事务；Outbox 至少一次投递，消费者以 `(eventId, consumerName)` 去重，并以事件携带的业务幂等键调用所属 port。检查点写入与业务事务分离，只通过 run/thread/command/event 标识关联。

**选项：**（A）跨模块同步大事务；（B）事件发送完整业务对象；（C）模块本地原子提交引用事件、下游幂等消费。  
**推荐：** C。  
**条件结论：** C03 选择 PostgreSQL Outbox 和投递实现，但不得改变事件语义；如果未来 broker 改变，contracts 和领域调用方保持不变。

### 9. I0～I9 阶段 DTO 固定输入输出引用

`IdentificationStageV1Schema` 固定 `I0`～`I9`。每个阶段结果为独立持久化工件，`IdentificationStageResultV1Schema` 以 `stage` 判别：

| 阶段 | 名称 / 追踪 | 必含输出引用 |
| --- | --- | --- |
| I0 | 资料准备与输入冻结 / RI-S1、RI-S2 | `IdentificationPreparationSnapshotRefV1`；阻断时 `WorkflowErrorRefV1` |
| I1 | 知识就绪 / RI-S3、RI-S4 | ready 时 `IdentificationInputSnapshotRefV1`；waiting 时 `KnowledgePreparationTaskRefV1`、`ReviewTaskRefV1[]` |
| I2 | 工序工作项规划 / RI-S31～S34 | `IdentificationWorkPlanRefV1`、计划/排除数量 |
| I3 | 混合/关系检索与 Agent 审阅 / RI-S52～S55 | `RetrievalArtifactSetRefV1[]`、`AgentTaskRefV1[]`、失败工作项引用 |
| I4 | 五项上下文与专用 LLM / RI-S51、S56、S57 | `ModelContextArtifactSetRefV1[]`、`IdentificationCandidateSetRefV1` |
| I5 | 修复与确定性校验 / RI-S58、S59、S61 | `ValidatedCandidateSetRefV1`、失败/待复核候选引用 |
| I6 | 全局重复检测与合并 / RI-S62、S63 | `MergePlanRefV1`、显式 skipped group refs |
| I7 | 综合置信度与验收路由 / RI-S61、S64 | `AcceptanceRouteSetRefV1`、`ReviewTaskRefV1[]` |
| I8 | 业务入库与评估事件 / RI-S62、S65 | `StandardizedRiskRecordRefV1[]`、领域事件引用 |
| I9 | 结果汇总 / RI-S65 | `IdentificationRunResultRefV1` |

`IdentificationPreparationSnapshotV1Schema` 固定：schemaVersion、project/project revision、spatial scope refs、source version refs、included source segment set、excluded segment decision refs、optional monitoring snapshot、data processing policy/tool/model refs、coverage decision ref、authorization/audit refs、createdBy/createdAt。

`IdentificationInputSnapshotV1Schema` 在 preparation ref 上增加 process model、risk mechanism、retrieval evidence base、retrieval/review/repair/confidence/forced-review/retry policy、model deployment、prompt template精确版本。它不保存知识正文或“latest”。

`IdentificationGraphStateV1Schema` 固定：

```text
schemaVersion + graphVersion
parentRiskFlowRunRef + runRef + threadId
triggerType + triggerReasonCode
authorizationContextRef
preparationSnapshotRef + inputSnapshotRef?
status + stage
workPlanRef? + candidateSetRef? + mergePlanRef?
agentTaskRefs[] + acceptedRiskRecordRefs[] + reviewTaskRefs[]
rejectedGroupRefs[] + failedWorkItemRefs[]
lastStageResultRef? + lastRouteDecisionRef? + lastErrorRef? + resultRef?
```

所有数组只含引用；计数和短枚举可以内联。不得出现 source content、JSON-LD、retrieval snippets、model response、candidate/record body 或任意对象袋。

### 10. A0～A9 与顶层入口 DTO 固定为有限运行

`AssessmentStageV1Schema` 固定 `A0`～`A9`。`AssessmentStageResultV1Schema`：

| 阶段 | 名称 / 追踪 | 必含输出引用 |
| --- | --- | --- |
| A0 | 输入准备 / RA-S1 | `AssessmentPreparationSnapshotRefV1` |
| A1 | 知识就绪 / RA-S2～S4 | ready 时 `AssessmentBasisReleaseSetRefV1`；waiting 时知识/复核任务 refs |
| A2 | 输入冻结 / RA-S1～S4 | `AssessmentInputSnapshotRefV1` |
| A3 | 指标取值 / RA-S5 | `IndicatorActualValueSetRefV1` |
| A4 | 评分与触发判定 / RA-S5、S6 | `AssessmentDecisionArtifactRefV1` |
| A5 | 评估入库 / RA-S5、S6 | `RiskAssessmentRecordRefV1` |
| A6 | 预警入库与归集 / RA-S6 | warning、response task、notification intent refs；未触发为显式空数组 |
| A7 | 处置建议候选 / RA-S7 | measure query、Agent task、recommendation candidate refs |
| A8 | 约束校验与建议入库 / RA-S7 | recommendation ref 或 review task ref，互斥 |
| A9 | 结果汇总 / RA-S1～S7 | `AssessmentRunResultRefV1` |

`AssessmentPreparationSnapshotV1Schema` 固定 schemaVersion、project/project revision、spatial scope、`RiskInputVersionRefV1`、applicability/optional monitoring snapshot、source evidence refs、entryMode、trigger reason、optional previous assessment/causal run、authorization/audit、createdBy/createdAt。

`AssessmentInputSnapshotV1Schema` 在 preparation ref 上冻结 indicator definition/field mapping/applicable rule set/weight/scoring strategy/risk matrix/risk acceptance threshold/monitoring warning threshold/joint trigger/measure library/warning aggregation/notification/response generation/response validation/response Agent/effect forecast/deviation/calibration Agent/retry/review/model/prompt 精确版本。

`ResponseForecastInputSnapshotV1Schema` 固定 recommendation/adoption decision、处置前监测快照、冻结评估依据、预测策略、授权/审计和创建时间；`ResponseFeedbackInputSnapshotV1Schema` 固定 execution/feedback、optional forecast、偏差/校准 Agent 策略、授权/审计和创建时间。`AssessmentEntrySnapshotRefV1Schema` 是 assessment preparation、forecast input、feedback input 三分支。

`AssessmentGraphStateV1Schema` 固定：

```text
schemaVersion + graphVersion
parentRiskFlowRunRef + runRef + threadId
entryMode + authorizationContextRef + entrySnapshotRef: AssessmentEntrySnapshotRefV1
status + stage + assessmentInputSnapshotRef?
assessmentRecordRef? + warningRecordRefs[] + warningResponseTaskRefs[]
recommendationCandidateRef? + agentTaskRefs[] + responseRecommendationRef?
effectForecastRef? + executionRecordRef? + feedbackRef?
deviationRecordRef? + calibrationSuggestionRef?
reviewTaskRefs[] + lastStageResultRef? + lastRouteDecisionRef?
lastErrorRef? + resultRef?
```

`WorkflowEntryModeV1Schema` 是六个 `entryMode` 字面量的闭合枚举；`StartWorkflowRunCommandV1Schema` 以该字段判别以下六个 payload 分支。它与 `ResumeWorkflowRunCommandV1Schema`、`CancelWorkflowRunCommandV1Schema` 均由 `ports` 定义，因为它们是 `WorkflowPortV1` 的直接调用契约；`workflows` 只导入这些 DTO 构造图状态，不复制或反向导入。

| entryMode | 必含输入 |
| --- | --- |
| `identify-and-assess` | project/spatial/source version refs、optional monitoring snapshot ref |
| `assess` | `RiskInputVersionRefV1`、applicability/optional monitoring snapshot、spatial scope |
| `reassess` | previous assessment ref、reason（monitoring/metadata/rule-set/weight-strategy/matrix）、changed input refs |
| `historical-backfill` | risk input、effective-at、explicit assessment basis refs |
| `forecast-response` | adopted recommendation ref、pre-action monitoring snapshot ref |
| `record-response-feedback` | execution record ref、feedback ref、optional forecast ref |

每个 start 分支还固定 `graphVersion`、`retryPolicyRef`、`authorizationContext`、`commandId` 和 `idempotencyKey`。resume 固定 `workflowRunRef`、`expectedStateVersion` 和以下 `resumeCause` 联合：`review-resolved { reviewDecisionRef }`、`knowledge-ready { knowledgePreparationTaskRef }`、`agent-task-completed { agentTaskResultRef }`、`command-confirmed { commandProposalRef }`、`transient-recovered { workflowErrorRef, diagnosticArtifactRef }`、`user-confirmed { userConfirmationRef }`；cancel 固定 `workflowRunRef`、`expectedStateVersion`、`reasonCode`。三个调用都使用第 5 节 `succeeded | waiting | failed` 外层结果；start/resume 成功只返回 `workflowRunRef` 和 `disposition: created | existing`，cancel 成功只返回 `workflowRunRef` 和 `disposition: cancellation-recorded | already-cancelled`。

`riskFlowGraph` 对 `identify-and-assess` 组合 identification → accepted risk events → 独立 assessment runs；无合格记录或等待复核时不伪造评估。其它 entryMode 只进入 assessmentGraph 的对应有限入口。预测、执行和反馈不得用一个跨日运行等待现场动作。

`RiskFlowStageV1Schema` 固定 `preparing`、`identification`、`assessment`、`result-summary`。顶层 `RiskFlowGraphStateV1Schema` 固定：

```text
schemaVersion + graphVersion
runRef + threadId + entryMode + authorizationContextRef
status + stage
identificationRunRef?
assessmentRunRefs[] + waitingRefs[]
lastStageResultRef? + lastRouteDecisionRef? + lastErrorRef?
resultRef?: RiskFlowRunResultRefV1
```

它只关联子运行和顶层路由，不复制任一子图状态；`identify-and-assess` 可同时具有一个 identification run 和多个 assessment run，其它入口不得具有 identification run。`RiskFlowRunResultRefV1` 指向另行持久化的汇总工件，汇总正文不进入图状态。

**选项：**（A）把预测/反馈留在长期运行中等待；（B）另建绕过评估的第三张图；（C）使用同一 assessmentGraph 契约的独立 entryMode。  
**推荐：** C。  
**条件结论：** 后续若出现新的 RA-S7 用户动作，优先增加闭合 entryMode；只有其事实所有权和生命周期不再属于评估闭环时才评估新子图。

### 11. 运行状态、暂停、恢复、重试和取消

`WorkflowRunStatusV1Schema` 由 `ports` 定义，固定：`pending`、`running`、`waiting`、`retryable-failure`、`completed`、`terminal-failure`、`cancelled`。`waiting` 必须有 `WaitingRefV1`；failure 必须有 `WorkflowErrorRefV1`；completed/cancelled 必须有 result ref。stage 不扩张状态枚举。

- **暂停**：知识待发布、人工复核、交互确认保存等待引用和原 thread；不保持模型/Worker 长期占用。
- **恢复**：只使用原 input snapshot、graph/node version、策略、模型、提示、工具、预算和业务幂等键；先查询既有工件/事实，已完成步骤不重复副作用。
- **重试**：仅 `TRANSIENT_FAILURE` 且冻结策略有预算；原 work item、run、command/idempotency key 不变。换任一冻结版本必须新运行。
- **取消**：协作式停止未开始工作并请求真实可取消 adapter 终止；已入库事实、决定、审计、事件不回滚。取消后不可恢复，新请求创建新运行。
- **重放**：读取既有工件重新执行确定性核对，不调用模型；**重新运行**创建新 run 并引用原 run。两者是不同 entry reason。

领域 port 不统一增加 `AbortSignal`。真正可取消的模型/OCR/通知 adapter 在其首次真实实现 change 中建立内部 seam；workflow 的取消事实和业务不回滚语义已在公共契约固定。

**选项：**（A）所有 domain port 暴露 `AbortSignal`；（B）只写 cancelled 布尔值；（C）公共取消命令 + 真实外部 adapter 内部协作取消。  
**推荐：** C。  
**条件结论：** 只有一个外部调用确有可验证取消能力时，才在其内部 adapter interface 增加 signal；不得为纯确定性函数预建取消 seam。

### 12. 事务、持久化与投影所有权预先固定语义，不预建表

C02 无迁移。后续持久化必须遵守：

| 内容 | 事实所有者/后续 change | C02 固定的不变量 |
| --- | --- | --- |
| 领域事实、幂等命令、审计、Outbox | 各领域模块 + C03 基础 | 单模块事务原子提交；只追加版本 |
| LangGraph checkpointer | C03/workflow | 与业务表分离；不能用于查询/伪造事实 |
| Agent 原始输入输出工件 | C04/C08 | 内容引用，不进入图状态；不保存思维链 |
| Qdrant/图谱/查询投影 | C20/C31 | 可删重建、只读、不反写事实 |
| 通知投递 | C09/C26 | 预警先入库，通知失败不回滚预警 |

事务唯一约束至少包括 command 幂等键、event identity、consumer event identity、run/thread identity 和各领域业务幂等键。具体表名、索引、隔离级别和租约由 C03 设计；任何选择都不能改变公共 Schema。

### 13. 可观测性、安全、性能和秘密边界

- 每次 port 调用记录 command/query kind、project、actor、authorization policy ref、run/thread、input/output refs、结果 kind、错误 code 和耗时；不记录证据正文、模型响应、凭据或开放 payload dump。
- 每次运行记录 graph/node/schema version、阶段、路由、重试/暂停/恢复/取消和资源工件引用。审计失败阻断业务提交；普通日志失败不得冒充审计成功。
- Schema 解析复杂度应对 DTO 大小线性；公开 DTO 只含有界元数据和引用数组。实际批量上限由业务策略版本持有，不硬编码在 C02。
- 权限错误不透露目标是否存在；Evidence 查询只返回授权后的引用或脱敏投影。
- contracts 不包含秘密、连接串、模型名、量化文件、URL 或第三方错误对象。秘密由 adapter/部署 change 管理。
- `DomainEventV1`、graph state 和 port union 的序列化必须确定性可往返；测试不锁定字段顺序。

### 14. 最小验证只覆盖高风险公共边界

新增一个 `packages/contracts/test/module-interfaces-events-workflows.test.ts`，先写夹具再实现：

1. 参数化验证六领域和三应用 port 的全部 `kind`/capability 映射接受，代表性未知 kind、未知字段、开放 patch/query 字段被拒绝。
2. 验证授权上下文三种 invocation、跨工程/能力缺失由调用边界返回闭合错误；不精确断言错误文案。
3. 验证命令幂等身份、八类错误、waiting/result 联合，以及同一个结果不能同时成功和失败。
4. 参数化验证十个事件分支、双时间/因果/幂等字段和 payload 只有引用；向事件夹带正式记录正文必须失败。
5. 参数化验证 I0～I9、A0～A9 各阶段恰好一次覆盖，识别/评估 state 的最小正例及大对象/未知字段反例。
6. 验证 `RiskInputVersionRefV1` 两个合法分支和“同时/均无”非法分支，及 accepted risk event → assessment start 只传 record ref。
7. 验证 waiting/retry/resume/cancel 的闭合引用，不锁定 LangGraph 内部节点顺序。

不新增 adapter fake、数据库 fixture、snapshot 或每字段缺失排列；C02 是纯契约，单一参数化测试足够。

最小命令：

```bash
pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts
pnpm exec eslint packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts
pnpm exec prettier --check packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts packages/contracts/package.json
pnpm deps:check
pnpm deps:policy
git diff --check
openspec validate define-module-interfaces-events-and-workflows --strict --no-interactive
```

主 Agent 在 implementation checkpoint 后决定是否追加根 `pnpm verify`；Luna 不重复跑无关 UI 构建作为 C02 的必经局部验证。

### 15. RI/RA → interface → DTO → 事件/结果追踪

| 追踪 | 所属 port | 工作流 DTO | 事件/持久化结果 | C02 验收证据 |
| --- | --- | --- | --- | --- |
| RI-S1 | Engineering `apply/freeze/read` | I0 preparation | `engineering.inputs-ready`、资料/段/权限 refs | I0/授权/事件夹具 |
| RI-S2 | Engineering `freeze/read` | I0 preparation | 解析/清洗/JSON-LD/监测工件 refs、失败 ref | 大对象拒绝与阻断夹具 |
| RI-S3 | Knowledge `resolve`、Identification `plan` | I1、I2 | process model release/work plan refs | I1/I2 阶段覆盖 |
| RI-S4 | Knowledge `resolve/retrieve` | I1、I3 | mechanism/evidence release/query refs | I1/I3 阶段覆盖 |
| RI-S5 | Knowledge `retrieve`、Agent `startTask`、Identification `analyze` | I3～I5 | retrieval/context/candidate/validation refs | I3～I5、Agent 引用夹具 |
| RI-S6 | Identification `finalize`、Review `request/decide` | I6～I9 | risk record ref、`identification.risk-record-accepted` | I6～I9、RI→RA 事件夹具 |
| RA-S1 | Engineering `freeze`、Assessment `prepare` | A0、A2 | risk input XOR、metadata/monitoring snapshot refs | 风险输入联合夹具 |
| RA-S2 | Knowledge `govern/resolve` | A1、A2 | indicator/weight/matrix release refs | A1/A2 阶段覆盖 |
| RA-S3 | Knowledge `govern`、Agent `startTask`、Review | A1 外部治理引用 | structured rule candidate/review/release refs | Agent/复核闭合分支 |
| RA-S4 | Knowledge `resolve`、Assessment `prepare` | A1、A2 | applicable rule set/ref reasons | knowledge waiting/resume 夹具 |
| RA-S5 | Assessment `evaluate` | A3～A5 | indicator/decision/assessment refs、`assessment.recorded` | A3～A5 确定性引用夹具 |
| RA-S6 | Assessment `evaluate`、Warning `open` | A4～A6 | trigger refs、warning/task/notification refs | A6 空/非空与先入库事件 |
| RA-S7 | Warning `recommend/record`、Agent、Review | A7～A9、forecast/feedback entry | recommendation/forecast/execution/feedback/deviation/calibration refs | 三项校验、独立入口、无自动校准 |

### 16. 文件所有权与精确变更清单

新增：

- `packages/contracts/src/ports/index.ts`：所有 C02 引用、授权/错误/结果、workflow 调用 DTO 和九个 port。
- `packages/contracts/src/events/index.ts`：领域事件元数据和十个事件分支。
- `packages/contracts/src/workflows/index.ts`：I/A 阶段、输入快照和子图/顶层图状态。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：单一高价值契约测试。
- `openspec/changes/define-module-interfaces-events-and-workflows/.openspec.yaml`：OpenSpec change 元数据，仅由 `openspec new change` 生成。
- `openspec/changes/define-module-interfaces-events-and-workflows/{proposal.md,design.md,tasks.md,specs/domain/module-interfaces-events-workflows/spec.md}`：规划工件。

修改：

- `packages/contracts/package.json`：只增加三个子路径 exports；依赖、scripts、版本和其它 exports 不变。

删除：无。

禁止修改：

- `packages/contracts/src/vocabulary/**`、`packages/contracts/src/common/**`、`packages/contracts/src/records/**`、`packages/contracts/src/index.ts`；
- `packages/core/**`、`packages/adapters/**`、`apps/**`、`demo/**`；
- 根 `package.json`、workspace/tsconfig/ESLint/Prettier/dependency-cruiser/CI、`config/dependency-policy.json`、`pnpm-lock.yaml`；
- `openspec/config.yaml`、`openspec/specs/**`、其它 change/归档工件；
- 数据库、迁移、部署、模型、索引或外部集成文件。

### 17. 全部技术问题均已选择条件结论

除前述逐项选项外，以下实施时常见分歧也固定：

| 问题 | 选项 | 推荐 | 条件结论 |
| --- | --- | --- | --- |
| port 是同步还是异步 | 同步返回 / `Promise` | `Promise` | 持久化/模型真实异步；纯确定性实现也保持同一调用面 |
| 领域事件是否定义 transport | 绑定 broker / 只定语义信封 | 只定语义信封 | C03 选择 Outbox 投递；更换 transport 不改事件 |
| 事件是否复制记录 | 完整对象 / 精确引用 | 精确引用 | 消费者按授权读取；离线外部同步由后续集成契约另定 |
| 图状态是否内联阶段结果 | 内联 / `StageResultRefV1` | 引用 | 只允许少量计数和枚举内联；正文先持久化取 ref |
| A7 是否在无候选时让 Agent 自由生成 | 允许 / 阻断或人工编制 | 阻断或人工编制 | 措施治理发布候选后新运行，不扩 Agent 权限 |
| 复核能否覆盖失败校验 | 可强行通过 / 修订后重校验 | 修订后重校验 | 紧急现场行动另建真实执行记录 |
| 是否预建 adapter | 全部预建 / 等真实变化点 | 等真实变化点 | 模型、OCR、持久化等在各自 change 有第二实现/测试替身时建立 |
| 是否新增依赖 | 引入工具库 / 复用 Zod | 复用 Zod | 无新增依赖；若实现发现必需依赖，停止并更新 proposal/design |

## Risks / Trade-offs

- [C02 一次冻结较多跨模块名称，后续实现可能暴露不足] → 只冻结路线和已确认原型中的稳定引用/用例；私有工件留给事实 owner，真实缺口走契约演进。
- [一个 `ports/index.ts` 会较长] → 当前单 owner、单 change，聚合能避免浅文件和 barrel；到出现独立变化轴时再内部拆分，不改变公开子路径。
- [命名引用数量较多] → 它们换取运行时实体类型区分和图状态安全；用一个内部构造器消除实现重复。
- [闭合错误和事件会要求显式演进] → 这是 G0 的预期门禁；第三方细节保留在 diagnostic 工件，不泄漏到公共契约。
- [评估 `evaluate` 较深，A3～A5 不是三个 port] → 深 module 隐藏确定性评分实现，返回三个里程碑引用仍能支持图进度和审计。
- [事务与 checkpointer 尚无实现] → C02 只固定可验证语义；C03 必须用真实 PostgreSQL/Testcontainers 证明原子性和隔离。
- [授权上下文当前不含动态撤权] → 正式命令边界复验，任务/运行使用冻结权限；真实动态撤权需求出现后由 C06 契约演进处理。

## Migration Plan

1. Luna 按 tasks 先创建测试夹具，再实现 `ports`、`events`、`workflows`，最后增加 package 子路径 exports；整个过程不触碰 C01 三模块。
2. 运行第 14 节最小验证；Sol 使用 `openspec-verify-change` 对照全部 requirements、RI/RA、权限/幂等/事件/图状态和文件范围，只写 verification 工件需由主 Agent另行授权。
3. 主 Agent 审阅后形成 planning/implementation/verification checkpoints，合并到 main 并决定是否运行根 `pnpm verify`。
4. 批准后再同步/归档为 `openspec/specs/domain/module-interfaces-events-workflows/spec.md`；C03 及后续只依赖归档后的主 spec。

回滚 C02 只需整体回退其 contracts exports、三个纯契约模块和测试；没有数据库、外部消费者或数据迁移。若归档后需要改变公共分支，创建新的契约演进 change，不覆盖已发布 Schema。

## Open Questions

无。所有会改变 specs、实现文件、接口、权限、事务或任务拆分的问题均已在 Decisions 中给出选项、推荐和条件结论；数据库产品细节、adapter 实现和策略数值属于明确分配给后续 change 的私有实现决策，不是 C02 留白。
