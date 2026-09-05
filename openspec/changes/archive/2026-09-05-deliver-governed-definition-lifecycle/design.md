## Context

参见 [proposal.md](./proposal.md) 的动机。当前代码已有：

- C01 `VersionReferenceSchema`、`EvidenceReferenceSchema`、命令/错误信封与固定知识定义类型；
- C02 `KnowledgeModelingPortV1.govern` 的五个闭合分支，以及 `KnowledgeRevisionRefV1`、`KnowledgeReleaseRefV1`、`KnowledgeReviewDecisionV1`；
- C03 `TransactionUnitV1`、命令幂等、只追加审计、Outbox 与按领域目录自动发现迁移；
- C04 不可变 `ContentArtifactRefV1`；
- C06 `LocalIdentityAccessV1.verify` 与 `knowledge-modeling.govern` 服务端授权；
- C07 `ReviewAuditPortV1`，能对精确 `knowledge-revision` 创建复核任务并保存 `approve-publication | reject | return-for-revision` 决定。

缺口位于知识建模层：没有稳定定义、修订、发布/停用事实，也没有实现 C02 的治理端口。C17/C18/C19 后续会提供不同定义类型的正文 Schema 与确定性业务校验；C16 必须只治理不透明内容工件和校验快照引用，避免提前复制这些领域规则。

## Goals / Non-Goals

**Goals:**

- 用一个深层治理模块实现 C02 五个 `govern` 分支，保持稳定身份、不可变修订和只追加发布决定。
- 复用 C03/C06/C07，实现先授权、后读取，事实/审计/Outbox 原子提交，以及精确人工批准门。
- 让每类定义以业务有效时间形成不重叠的发布序列；停用和重新启用历史内容均保留完整决定链。
- 把单个 `candidateArtifactRef` 定义为一个定义类型的精确配置包；导入只登记内容寻址引用和证据，不解析业务正文。
- 提供 C17/C18/C19 可复用的内部精确解析器，但不提前实现 C02 `resolve`/`retrieve` 的具体识别或评估组合。

**Non-Goals:**

- 不新增公共 DTO、端口分支、事件类型、能力、角色或依赖。
- 不实现多定义类型配置包的一次性大事务。调用方对每个定义包使用标准 `submit-revision`；C18 可在自己的受控导入流程中编排多项并逐项报告。
- 不读取或解释配置正文，不实现具体定义完整性/一致性校验、Agent 编制、检索、评分、HTTP、UI 或 LangGraph。
- 不提供可变 `current` 行、别名、通用仓储、通用 patch、发布覆盖或物理删除。

## Decisions

### 1. 一个稳定定义对应“工程 + 定义类型”

`KnowledgeDefinitionTypeV1` 已是闭合枚举，且 C02 `submit-revision` 没有客户端定义 ID。C16 因此以 `(projectId, definitionType)` 唯一确定稳定定义身份，服务端生成 `definitionId`；一个工程同一类型只有一条演进链。

首次提交不带 `baseReleaseRef`；已有定义的后续提交必须带同类型、同工程的精确发布引用作为基线。修订保存父发布与其修订的精确引用，不使用“当前修订”字段判断并发。

替代方案是从文件名或包内字段取得定义 ID。这会让未受 C02 Schema 约束的字符串成为身份事实源，且允许同类型平行定义造成解析歧义，因此不采用。

### 2. 单个候选工件就是一个精确配置包

C02 已冻结 `submit-revision { definitionType, baseReleaseRef?, candidateArtifactRef, evidenceReferences[] }`。C16 不增加第二个导入接口：`candidateArtifactRef` 是经 C04 登记的不可变配置包，命令其余字段构成治理清单。

治理模块保存：

- 定义类型与稳定定义身份；
- 候选工件精确引用；
- 证据引用的规范 JSON；
- 可选父发布/父修订；
- 内容工件引用的规范摘要，用于冲突检测；
- 命令、操作者、授权、业务发生/系统记录/数据库持久化时间。

相同 `(projectId, candidateArtifact entityId, versionId)` 只能归属一个稳定定义；这不限制后续新修订引用新的内容工件。C16 不展开包内字段。C17/C18/C19 在调用提交前形成自己的确定性验证快照；验证不通过时形成新工件/修订，而不是更新原行。

替代方案是解析一个含多个定义的 ZIP/JSON 并引入批量事务。现有端口没有批量契约，且这会把具体内容 Schema 拉入通用治理模块，故留给上层按标准命令编排。

### 3. 修订状态由成立事实推导，不维护可覆盖状态机

修订主体 `knowledge_revisions` 只插入，不更新，状态从关联事实推导：

```text
draft       = 修订已提交、没有有效待决/最终复核
in-review   = 存在 C07 pending review task
approved    = 存在匹配 approve-publication 决定
rejected    = 最终决定为 reject
returned    = 最终决定为 return-for-revision
published   = 存在引用该修订的发布事实
```

`request-review` 组合治理模块生成的验证/证据快照引用与 C07 `requestReview`。C02 治理命令只携带 `revisionRef` 和 `reviewPolicyRef`，因此 C16 在送审事务前创建两项内部不可变快照引用：

- `validationSnapshotRef`：证明定义类型、工件/证据引用、父发布和修订结构校验通过；
- `evidenceSnapshotRef`：固定提交时的证据集合摘要。

C07 还要求 `waitingRunRef`。C16 以送审命令身份创建一个轻量、不可变的治理等待引用 `workflow-run { entityId: "knowledge-review:<revisionId>", versionId: <review-attempt-id> }`，只用于 C07 事件关联；它不是 LangGraph 检查点或长期流程事实。C16 收到复核决定后直接由发布命令重新校验，不依赖事件自动恢复。

不在 C16 复制 C07 任务或决定行，也不读取 C07 内部表。现有 C07 公共端口不能读回决定类型和目标，因此 C16 实现前必须先由独立的 review-audit 契约演进 change 提供最小只读批准证明接缝；该 change 归档前，C16 的发布与回滚任务不得开始。建议签名为：

```ts
interface KnowledgeRevisionApprovalProofReaderV1 {
  verifyKnowledgeRevisionApproval(input: {
    projectId: string;
    revisionRef: KnowledgeRevisionRefV1;
    reviewDecisionRef: ReviewDecisionRefV1;
    authorizationContext: AuthorizationContextV1;
  }): Promise<
    | {
        kind: "approved";
        reviewTaskRef: ReviewTaskRefV1;
        reviewDecisionRef: ReviewDecisionRefV1;
        decidedAt: string;
      }
    | {
        kind: "not-approved";
        reason:
          | "not-found"
          | "project-mismatch"
          | "target-mismatch"
          | "decision-not-approval"
          | "task-superseded";
      }
  >;
}
```

该接缝由 review-audit 所有，负责确认决定属于同一工程与精确修订、任务未被替代，且决定为 `knowledge-revision / approve-publication`；它只返回证明所需引用和决定时间，不暴露复核正文或数据库行。C16 仅消费已归档接缝，不在本 change 修改 C02/C07。

### 4. 发布是单定义不可变版本，工程发布集合由精确引用组成

一个 `KnowledgeReleaseRefV1` 只发布一个定义类型的一个修订。工程在某一时刻的“发布集合”是每个所需定义类型各自唯一有效发布的精确引用集合；C17/C18/C19 的 `resolve` 将按用途把这些引用组合为 C02 已声明的 `ProcessModelReleaseRefV1`、`AssessmentBasisReleaseSetRefV1` 等结果。

发布事实固定：

- `releaseId/versionId`；
- 稳定定义、定义类型和修订引用；
- C07 复核任务/批准决定引用；
- `effectiveFrom` 与开放的 `effectiveTo`；
- 发布命令、操作者、授权、审计与三类时间。

为避免更新旧发布的有效区间，时间线另存只追加决定：新发布生效时，解析器以“要求时刻之前最后一个已发布、且之后没有停用决定”的规则选取。数据库排他约束/事务锁保证同一 `(projectId, definitionId, effectiveFrom)` 不重复，并在命令内检查未来/重叠发布。C16 不自动截断、移动或覆盖旧时间。

### 5. 停用是决定事实；回滚是引用历史修订的新发布

`deactivate-release` 在 `knowledge_release_decisions` 追加 `deactivated` 决定，固定原因和决定时间。命令返回原 `KnowledgeReleaseRefV1`，符合 C02 成功形状；返回同一引用不表示修改发布正文。

`rollback-by-new-release` 查找 `historicalReleaseRef`，取得其修订引用，并通过第 3 节的批准证明接缝确认提交的 C07 决定明确批准该修订用于新的发布决定。新发布的业务生效时间取命令 `issuedAt`；这是 C02 该分支未携带 `effectiveFrom` 时唯一稳定且可审计的时间。新发布保存 `restoredFromReleaseRef` 和 `reasonCode`，获得新的 release version。

停用/回滚不修改历史行。旧运行按其冻结引用重放；新运行解析时同时考虑业务有效时刻和停用决定的系统记录时刻，避免在“当时未知”的情况下追溯改写历史。

### 6. 精确解析器是模块内部深层能力

新增 `resolveGovernedReleases` 内部服务，输入为：

```text
projectId
requiredDefinitionTypes[]
requiredAt
asOfRecordedAt
authorization context
```

输出为按定义类型排序的精确 `KnowledgeReleaseRefV1[]`，或闭合错误：

| 条件 | 错误语义 |
| --- | --- |
| 授权无效/跨工程 | `AUTHORIZATION_DENIED` |
| 精确引用不存在 | `ENTITY_NOT_FOUND` |
| 基线/决定/修订已陈旧 | `STALE_VERSION` |
| 未审核、缺少必需类型、停用或时间线冲突 | `BUSINESS_BLOCKED` |
| 数据库/审计/Outbox 故障 | `TRANSIENT_FAILURE` / `TERMINAL_FAILURE` |

解析器不加入 C02 公共 interface；C17/C18/C19 adapter 与 C16 位于同一知识建模模块内，可复用它实现各自 `resolve` 分支。这保留 `KnowledgeModelingPortV1` 是唯一跨模块入口，也避免现在虚构完整识别/评估 basis。

解析查询先按工程和类型过滤，再使用 `effectiveFrom <= requiredAt`、`recordedAt <= asOfRecordedAt` 与停用决定选择候选；不得查询全库后在内存过滤。返回只含引用，不返回内容或表行。

### 7. 授权、Agent 边界与原子提交

五个 `govern` 分支均先调用 C06 `LocalIdentityAccessV1.verify` 验证命令自带的精确授权和分支，不先探测目标。项目风险管理员具有治理能力；reviewer 只在 C07 决定复核，没有治理命令能力。

C06 当前允许带因果运行的 system/Agent 授权获得最小 capability。C16 还要在领域层收紧：

- `submit-revision` 可接受人类或经授权的 Agent 候选提交；
- `request-review` 可接受人类或系统编排；
- `publish-approved-release`、`deactivate-release`、`rollback-by-new-release` 只接受 `authorization.invocation.kind === "human"`。

每个写命令使用 C03 `TransactionUnitV1`。同一事务保存 C16 事实、`audit.entries`、命令回执及适用事件。C02 目前只有评估基础发布事件；只有定义类型属于评估依据且受影响工程修订可从后续 C18 输入确定时，C18 才发送 `knowledge.assessment-basis-published.v1`。C16 不滥发语义不完整的事件；通用发布通过命令回执与审计成立。

送审跨 C16/C07 两个模块不能使用分布式事务。调用顺序为：C16 幂等生成快照/等待引用 → 调用 C07 原子创建任务 → C16 保存任务关联。任一步重试使用相同命令/幂等身份；若 C07 已成功而最后关联失败，重试取回原任务并补齐关联，不产生第二任务。关联未完成时修订不能发布。

### 8. PostgreSQL 模型

迁移路径固定为：

`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts`

全局序号 `000007` 紧随现有 `000006_agent_proposal_artifact_ref.ts`，无需中央注册。

#### `business.knowledge_definitions`

- `definition_id` 主键，`project_id`、`definition_type`；两者组合唯一。
- `created_by`、`authorization_context_ref`、`created_at/recorded_at/persisted_at`。
- 只插入；应用角色无 UPDATE/DELETE。

#### `business.knowledge_revisions`

- `revision_id/version_id`、`definition_id/project_id/definition_type`。
- `candidate_artifact_ref`、`evidence_references`、可选 `base_release_ref/base_revision_ref`。
- `artifact_identity_digest`、命令/主体/授权、三类时间。
- 修订主键、工程/定义外键；候选工件精确引用在工程内唯一；只插入。

#### `business.knowledge_review_links`

- `review_attempt_id`、修订、验证/证据快照、治理等待、C07 review task/decision 可选引用。
- 仅允许从“等待 C07 结果”补齐精确任务/决定引用；数据库 CHECK 防止换目标或清空字段。
- 同一修订同一 review policy 的活动尝试唯一。

#### `business.knowledge_releases`

- `release_id/version_id`、定义/修订、批准决定、`effective_from`。
- 可选 `restored_from_release_ref`、`reason_code`；命令/主体/授权和三类时间。
- 只插入；同一稳定定义和生效时刻唯一。

#### `business.knowledge_release_decisions`

- 决定为 `deactivated`，引用精确发布、原因、命令/主体/授权和三类时间。
- 每个发布只允许一个有效停用决定；只插入。

数据库约束保存身份、外键、不可变性和唯一性；定义类型集合仍以 C02 Zod 为 SSOT，不在 CHECK 中复制完整枚举。迁移显式授予 `riskflow_app` 必要 SELECT/INSERT；不授予 DELETE，除 `knowledge_review_links` 的受限补齐列外不授予 UPDATE；PUBLIC 无权限。

### 9. 核心与适配器结构

```text
packages/core/src/knowledge-governance/
  schema.ts
  lifecycle.ts
  index.ts
packages/core/test/knowledge-governance/knowledge-governance.test.ts

packages/adapters/src/knowledge-governance/
  postgres-knowledge-governance-adapter.ts
  index.ts
packages/adapters/test/knowledge-governance/
  fixture.ts
  postgres-knowledge-governance-adapter.test.ts
packages/adapters/src/postgres/migrations/knowledge-modeling/
  deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts
```

`schema.ts` 定义模块私有表外事实形状、状态投影和解析请求，不导出数据库行。`lifecycle.ts` 提供纯函数校验首次/后续提交、批准证明、发布/停用/回滚和候选选择。PostgreSQL adapter 实现 `KnowledgeModelingPortV1.govern`，组合 C03/C06 与已归档的 review-audit 批准证明接缝；它不实现尚未到期的 `resolve`/`retrieve`，也不导出通用 repository。

现有 `packages/core/src/index.ts`、`packages/adapters/src/index.ts` 和两个 package manifest 只增加 `knowledge-governance` 子路径导出；不新增依赖。若当前导出约定无需根 barrel，则不修改根 barrel。

### 10. 验证策略

核心测试只覆盖稳定领域行为：

- 首次/后续修订与错误基线；
- 人工批准、拒绝、退回、陈旧与错目标决定；
- 发布时间线选择、停用和历史修订重新发布；
- Agent 只能提交候选，不能发布/停用/回滚；
- 配置工件身份冲突和闭合错误映射。

PostgreSQL 集成测试复用现有 Testcontainers fixture，覆盖：

- 修订、发布、停用表不可更新/删除；
- 命令相同载荷重放、异载荷冲突、并发发布只有一个获胜；
- C07 真实送审/决定后发布，拒绝/退回不发布；
- 无权、跨工程、旧授权在存在/不存在目标时同类拒绝；
- 审计/Outbox 注入失败整体回滚；
- 送审跨模块失败后的幂等补偿；
- `requiredAt + asOfRecordedAt` 精确解析及索引支持；
- 迁移 `up → down → up` 与最小数据库角色权限。

不新增静态断言指令文本、完整错误文案、SQL 顺序或内部调用次数的测试。

## Risks / Trade-offs

- **C02 送审命令没有显式验证/证据/等待运行引用** → C16 从不可变修订确定性生成快照与治理等待引用；若 C07 必须验证外部 workflow 实体存在，则另开共享契约演进 change，不能在 C16 伪造实体。
- **C07 当前不能公开证明决定类型与目标** → 先以独立 review-audit 契约演进 change 增加最小只读批准证明接缝；C16 只消费归档契约，不读取 C07 表或复制复核事实。
- **通用发布没有通用领域事件** → C16 以原子事实、审计和命令回执作为成立依据；C18 在能填满既有评估事件语义时发事件，避免新增或滥用事件。
- **一次命令只导入一个定义包** → 保持 C02 SSOT；多定义交付由 C18 编排标准命令并显示逐项结果，真实原子整包需求出现时另开契约 change。
- **时间线不更新旧行使查询稍复杂** → 使用工程/定义/生效/记录时间复合索引和只追加决定，换取历史可重放与无覆盖。
- **跨 C16/C07 不能单事务** → 两端都使用稳定幂等身份，C16 保存可补偿关联，发布前要求关联完整；不引入分布式事务或新队列。

## Migration Plan

1. 先创建、实现并归档独立的 review-audit 契约演进 change，提供第 3 节批准证明只读接缝；未完成时停止 C16 实现。
2. 运行 `000007_governed_definition_lifecycle` 创建空治理表、索引、约束和最小权限；现有数据无需回填。
3. 部署 core 与 adapter 子路径；没有 API 路由或自动启动动作，未调用时不改变现有行为。
4. C17/C18/C19 后续通过同一 adapter 登记各自精确配置包并实现用途级解析。
5. 回滚仅在开发/测试或尚无后续领域外键时执行 migration `down`；生产已经形成治理事实后不自动降级，修正通过新 migration 完成。

不存在会改变规格、实现边界或任务拆分的 Open Questions。
