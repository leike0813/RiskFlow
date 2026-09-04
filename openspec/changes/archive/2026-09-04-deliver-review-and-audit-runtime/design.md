# C07 人工复核与审计运行时设计

## 1. 目标与边界

C07 把 C02 的复核/追溯契约、C03 的原子持久化和 C06 的本地授权组合成一个可运行模块。模块负责三件事：保存人工复核任务，原子提交类型化决定，以及按引用查询可归属、不可静默改写的审计链。

实现不得承担候选生成、确定性评分、模型调用、通用 Agent 调度、HTTP 或 UI。上游模块只提交版本化引用；C07 不复制候选正文、不解释评分规则，也不替业务模块发布知识、规则、建议或配置。

## 2. 已冻结契约与复用边界

### 2.1 唯一公共端口

实现 `@riskflow/contracts/ports` 已有的 `ReviewAuditPortV1`：

```ts
interface ReviewAuditPortV1 {
  requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1>;
  decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1>;
  trace(query: TraceQueryV1): Promise<TraceResultV1>;
}
```

C07 不新增平行公共端口，也不改写下列 C02 事实：

- 复核类型固定为 `identification-group`、`knowledge-revision`、`rule-conflict`、`response-candidate`、`calibration-suggestion`。
- `ReviewRequestV1` 保存目标、验证快照、证据快照、等待运行和复核策略引用。
- `ReviewDecisionCommandV1` 保存任务、目标、类型化决定和原因码。
- 成功请求返回 `ReviewTaskRefV1`，成功决定返回 `ReviewDecisionRefV1`，追溯返回 `AuditTrailRefV1` 或 `QueryResultRefV1`。
- 状态变化只发送 `review.review-requested.v1` 与 `review.review-resolved.v1`；不得发明第二套复核事件。

### 2.2 C03 复用

所有成功写命令通过 `TransactionUnitV1.execute`。领域处理器在同一数据库事务中写 C07 事实，并返回一个 `AtomicCommitV1`；C03 负责命令回执、`audit.entries` 和 Outbox。C07 不实现第二套命令幂等表、通用审计表或 Outbox。

### 2.3 C06 复用

端口适配器在任何目标查询或写入之前调用 `LocalIdentityAccessV1.verify`，并传入调用契约要求的精确分支：

| 操作 | 分支 |
|---|---|
| 创建复核任务 | `review-audit.request-review` |
| 提交复核决定 | `review-audit.decide-review` |
| 查询追溯 | `review-audit.trace` |

校验失败沿 C06 的统一安全拒绝返回；C07 不查询账户、会话、成员、角色、策略和授权上下文表。C07 的数据库投影只读 C06 已承诺由 C07 统一投影的 `business.security_audit_events`，不得更新、删除或重新解释其授权决定。

## 3. 领域状态

### 3.1 复核任务

C07 内部 `ReviewTaskStateV1` 只增加持久化所需状态，不改变 C02 DTO：

```ts
type ReviewTaskStatusV1 = "pending" | "decided" | "superseded";

type ReviewTaskStateV1 = {
  reviewTaskRef: ReviewTaskRefV1;
  projectId: string;
  validationSnapshotRef: ContractReferenceV1;
  evidenceSnapshotRef: ContractReferenceV1;
  reviewPolicyRef: VersionReferenceV1;
  status: ReviewTaskStatusV1;
  decisionRef?: ReviewDecisionRefV1;
  requestedBy: string;
  requestedAuthorizationContextRef: AuthorizationContextRefV1;
  requestedAt: string;
  decidedAt?: string;
};
```

状态转换：

```text
requestReview ──> pending
pending + first valid decideReview ──> decided
pending + replacement request for the same waiting run and stable target ──> superseded
decided/superseded + non-replay decideReview ──> rejected (no state change)
```

`reviewTaskRef.reference.versionId` 是任务不可变版本。决定必须携带创建时取得的完整任务引用和同一目标版本；不得用空版本、目标实体当前指针或“最新版本”代替。

### 3.2 领取与并发

C02 没有独立领取命令。C07 将领取定义为决定事务中的原子抢占：适配器先按工程和任务引用执行 `SELECT ... FOR UPDATE`，验证 `pending`、目标引用和版本，再写决定并转换为 `decided`。事务提交前的 `deciding` 仅是事务内状态，不对外持久化。

因此首个有效提交者取得处理权；同一命令的幂等重放返回原决定，其他命令即使决定内容相同也返回 C02 `STALE_VERSION`。这提供领取、防抢答和过期提交保护，同时不引入无消费者的租约、心跳、超时回收或新端口。

### 3.3 类型化决定与人工边界

决定必须使用 C02 `ReviewDecisionV1Schema`。C07 执行以下确定性校验：

1. 命令结构、复核类型与目标类型匹配；
2. 任务、目标、工程和版本与已存事实完全匹配；
3. 任务仍为 `pending`；
4. `reasonCode` 为非空标识；
5. 修订候选决定携带的输出引用符合相应联合类型；
6. 授权上下文对精确分支仍有效。

C07 不判断工程语义是否正确。人工只在 C02 允许的决定集合中选择；确定性校验失败不能由人工覆盖：

- 识别复核可批准原候选、批准修订候选、确认合并、保持分离、拒绝或退回上游；
- 知识和规则复核可批准发布、拒绝或退回修改；
- 处置复核只能提交供上游重新校验的修订候选引用、退回上游或拒绝，不存在强行批准失败候选的决定分支；
- 校准复核的批准仅允许创建草案，不能直接变更生效权重、阈值、矩阵或规则版本。

上游通过新的目标版本和新的 `requestReview` 重新送审。相同等待运行、复核类型和稳定目标实体的新版本请求会把旧 `pending` 任务标记为 `superseded`；旧决定随即按过期提交拒绝。已经决定的历史任务不修改。

## 4. 命令流程

### 4.1 `requestReview`

1. 以 C02 Schema 解析请求，拒绝额外字段和类型/目标不匹配。
2. 使用 C06 校验 `review-audit.request-review`，不提前读取目标或任务。
3. 转换为 C03 `AtomicCommandV1`，保留 `projectId`、`commandId`、`idempotencyKey`、主体、授权上下文、运行与时间。
4. 在 C03 事务中锁定同一等待运行、复核类型和稳定目标实体的待处理任务；同版本请求由幂等回执重放，不同版本请求令旧任务 `superseded`。
5. 插入 `review_tasks`，写 `review.request-review` 审计，并投递 `review.review-requested.v1`。
6. 返回 C02 `ReviewRequestResultV1`。

请求只验证引用结构和相互一致性，不跨模块读取目标正文。目标版本存在性和验证/证据快照的生成由调用方负责；C07 以不可变引用固化收到的输入。

### 4.2 `decideReview`

1. 以 C02 Schema 解析命令。
2. 使用 C06 校验 `review-audit.decide-review`，避免资源存在性泄漏。
3. 转换为 C03 原子命令，锁定任务行，并执行 §3.3 的确定性校验。
4. 有效时插入唯一 `review_decisions`，更新任务状态，写 `review.decide-review` 审计，并投递 `review.review-resolved.v1`；事件的 `resumeRunRef` 使用任务保存的精确 `waitingRunRef`。
5. 已完成的同一幂等命令由 C03 回执重放。其他已决定、已替代、目标不匹配或版本不匹配的命令不写决定事实，以 C02 `STALE_VERSION` 返回并写 C07 只追加拒绝记录。
6. 拒绝审计写入失败时返回技术失败；不得把未记录的拒绝伪装成稳定业务结果。

### 4.3 批量决定

批量操作是调用方对多个 `decideReview` 命令的有界并发或顺序提交。每项具有自己的 `commandId`、`idempotencyKey`、授权校验、数据库事务、结果和审计。任何一项失败不回滚其他已提交项，也不存在跨任务“全部成功”承诺。C07 不新增批量 DTO、批量数据库事务或第二套决定逻辑。

## 5. 审计与不可抵赖边界

### 5.1 三类来源

| 来源 | 所有者 | 写入时机 | C07 权限 |
|---|---|---|---|
| `audit.entries` | C03 | 成功创建任务或提交决定，与业务事实和 Outbox 同事务 | 插入自己的动作；只读追溯；不可更新/删除 |
| `business.security_audit_events` | C06 | 身份、会话、授权成功/拒绝/失败 | 只读投影；不可写入 |
| `audit.review_rejections` | C07 | 已授权但因任务状态、目标或版本冲突而拒绝决定 | 只追加；不可更新/删除 |

业务不可抵赖语义由以下现有机制共同提供：C06 已认证主体和授权上下文、C03 命令/幂等标识、目标及版本引用、运行引用、业务发生时间/系统记录时间/数据库持久化时间，以及数据库角色禁止修改或删除审计。C07 不新增自制签名或哈希链；在没有外部可信锚和密钥治理时，这类散列不能提供法律意义的不可抵赖，且会形成第二套脆弱事实源。

成功业务事实缺少 `audit.entries` 时整个 C03 事务回滚。授权失败由 C06 先行审计且不进入 C07。已授权业务拒绝先保持业务事实不变，再以 C07 短事务追加最小拒绝记录；拒绝记录唯一键为工程、命令和结果码，重试不重复。

### 5.2 最小审计字段

统一追溯至少保留：

- 来源类型、活动码、结果与原因码；
- 工程、主体、授权上下文、命令和幂等标识；
- 复核任务、目标实体与版本、决定或拒绝引用；
- 等待运行与恢复运行引用；
- 验证快照、证据快照、复核策略及修订候选等输入输出引用；
- `occurredAt`、`recordedAt`、`persistedAt`。

审计不得保存密码、token、连接串、工程资料正文、证据正文、模型原始响应或思维链。`includeEvidenceSummary` 只决定是否在结果中列出有权查看的证据快照引用和计数/类型摘要，不读取或复制证据内容；正文仍由资料模块按原权限提供。

## 6. 追溯与中文活动投影

`trace` 先用 C06 校验 `review-audit.trace`，再按查询工程和 `subjectRef` 从 C07 只读投影读取。`asOfRecordedAt` 是包含边界；未提供时使用查询开始时固定的数据库时间，避免分页过程中观察到不同快照。

迁移创建 `audit.review_activity_v1`，以 `UNION ALL` 规范化三类审计来源。投影只保存闭合活动码和类型化参数，不把可变中文句子作为事实：

| 活动码 | 中文展示语义 |
|---|---|
| `review.requested` | 已发起人工复核 |
| `review.superseded` | 旧版本复核任务已替代 |
| `review.decided` | 已提交人工复核决定 |
| `review.decision-rejected` | 复核决定因状态或版本冲突被拒绝 |
| `security.authorization-allowed` | 授权校验通过 |
| `security.authorization-rejected` | 授权校验拒绝 |

核心模块提供一个纯函数，把活动码和安全参数映射为中文活动项；未知码使用中性占位并保留原码，不拼接数据库错误或任意正文。测试锁定活动码、引用与结果，不精确断言整段中文。

返回的 `AuditTrailRefV1` 指向按工程与主题组织的审计流，`versionId` 取本次查询最后一条可见记录的不可变事件/审计标识；空结果返回 `QueryResultRefV1` 并使用查询标识。该返回遵守 C02 的引用式接口，不在结果 DTO 中另塞未冻结字段。

## 7. PostgreSQL 模型与权限

迁移文件：

`packages/adapters/src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.ts`

### 7.1 表

#### `business.review_tasks`

- 主键：`review_task_id`；保存 `version_id`、`project_id`、`review_type`、目标 kind/entity/version。
- JSONB 引用：目标、验证快照、证据快照、等待运行、复核策略、请求授权上下文、决定引用。
- 状态：`pending | decided | superseded`，数据库 CHECK 约束状态与决定引用/时间的一致性。
- 归属：`requested_by`、`requested_at`、`recorded_at`、`persisted_at`。
- 并发：同一等待运行、复核类型、稳定目标实体最多一个 `pending` 任务；决定按主键和工程锁行。

#### `business.review_decisions`

- 主键：`review_decision_id`；`review_task_id` 唯一，保证每个任务至多一个决定。
- 保存决定类型、完整类型化决定 JSON、原因码、任务/目标/输入/输出/运行引用、主体和授权上下文。
- 保存业务、记录和持久化时间；决定事实只插入、不更新、不删除。

#### `audit.review_rejections`

- 主键：`rejection_id`；工程、命令、结果码唯一，保证失败重试不重复。
- 只保存任务/目标/运行引用、主体、授权上下文、结果/原因码和三类时间。
- 仅 `SELECT, INSERT`，无 `UPDATE, DELETE`。

### 7.2 视图与索引

- `audit.review_activity_v1` 只读合并 C03、C06 与 C07 来源，统一工程、主题、主体、上下文、活动码、结果、原因、引用和时间列。
- 索引覆盖任务工程/状态/复核类型、稳定目标、等待运行、决定任务唯一键、审计工程/主题/记录时间。
- `trace` 所有查询先约束工程，再约束主题和时间，不做跨工程全表扫描。

### 7.3 数据库角色

- 所有对象由 `riskflow_migrator` 创建。
- `riskflow_app` 对 `review_tasks` 仅有 SELECT、INSERT 和限定状态列 UPDATE；对 `review_decisions`、`audit.review_rejections` 只有 SELECT、INSERT；对活动视图只有 SELECT。
- 应用角色没有任何审计表 UPDATE/DELETE、DDL 或角色管理权限；PUBLIC 无权限。
- 迁移显式验证对 C03 `audit.entries` 和 C06 `security_audit_events` 的既有只读权限，不扩大应用角色对依赖表的写权限。

## 8. 错误、幂等与安全响应

| 条件 | 对外类别 | 是否写业务事实 | 审计来源 |
|---|---|---:|---|
| Schema 或决定联合类型非法 | 信任边界 Schema 拒绝 | 否 | 边界指标；不保存原始敏感载荷 |
| 授权上下文无效、工程/分支不匹配、角色无权 | `AUTHORIZATION_DENIED` | 否 | C06 安全审计 |
| 已授权调用者查询的任务不存在 | `ENTITY_NOT_FOUND` | 否 | C03/C07 查询指标 |
| 任务已决定/替代、目标或版本不匹配 | `STALE_VERSION` | 否 | C07 拒绝审计 |
| 相同幂等键、相同载荷 | 原结果重放 | 不重复 | 原 C03 审计/事件 |
| 相同幂等键、不同载荷 | `IDEMPOTENCY_CONFLICT` | 否 | C03 冲突指标 |
| 审计、决定、任务或 Outbox 写失败 | `TRANSIENT_FAILURE` 或 `TERMINAL_FAILURE` + 诊断引用 | 回滚 | 无成功响应 |

日志只记录工程、命令、任务、目标引用、错误码、诊断引用和三类时间。PostgreSQL 错误、连接信息及输入正文不得直接进入日志或结果。

## 9. 模块与文件所有权

计划实现文件：

- `packages/core/src/review-audit/schema.ts`：C07 内部任务状态、拒绝记录、活动投影与解析 Schema。
- `packages/core/src/review-audit/service.ts`：确定性状态转换、决定校验和中文活动映射；无数据库或授权内部读取。
- `packages/core/src/review-audit/index.ts`：模块公开导出。
- `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`：实现 `ReviewAuditPortV1`，组合 C03 transaction unit 与 C06 access service。
- `packages/adapters/src/review-audit/index.ts`：适配器导出。
- `packages/adapters/src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.ts`：表、视图、索引、约束和最小权限。
- `packages/core/package.json`、`packages/adapters/package.json`：仅增加现有 workspace 子路径导出，不增加依赖。
- `packages/core/test/review-audit/review-audit.test.ts`：稳定领域行为。
- `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`：事务、并发、权限、审计与追溯集成。

禁止修改 `packages/contracts/**`、C03/C06 迁移和实现、应用入口、HTTP 路由、Web 页面及 Agent runtime。

## 10. 验证策略

单元测试验证类型化决定与任务类型匹配、状态转换、替代规则和活动码映射，不锁定 SQL 顺序、内部函数或整段中文。

PostgreSQL 集成测试验证：

- 请求和决定的同键重放与载荷冲突；
- 两个不同命令并发决定同一任务仅一个成功；
- 新版本送审后旧任务决定被拒绝；
- 授权上下文过期、工程/分支不匹配和 reviewer/request-review 越权不泄露存在性；
- 审计或 Outbox 故障回滚任务/决定，拒绝审计失败不返回稳定业务结果；
- `riskflow_app` 不能更新/删除三类审计来源和决定事实；
- 追溯受工程、主题和 `asOfRecordedAt` 限制，证据摘要只含引用；
- 多命令批量提交逐项独立，单项失败不污染其他结果。

最小完成门为相关测试、workspace 类型检查、迁移 up/down/up、OpenSpec 严格校验和 `git diff --check` 全部通过。

## 11. 关键设计决定

1. **保持 C02 公共契约不变。** 领取和批量是现有决定命令的执行语义，不新增无上游消费者的端口。
2. **成功审计复用 C03。** C07 只为没有业务提交的状态/版本拒绝增加最小只追加记录，避免第二套通用审计。
3. **不自制哈希链。** 已认证主体、授权上下文、不可变引用、事务审计和数据库权限构成当前业务可归属边界；无可信锚的散列不提升实际保证。
4. **投影存代码与参数，不存文案。** 中文只是展示映射，审计事实保持稳定、可查询且不受文案调整影响。
5. **内容留在来源模块。** C07 固化输入/输出/证据引用，不跨层读取或复制正文。
