## Why

C07 已保存复核决定的类型、精确目标、工程归属和任务状态，但 `ReviewAuditPortV1` 只能返回决定引用或通用追溯引用。C16 因而不能在发布或重新启用历史修订前，确定性证明所提交的 `reviewDecisionRef` 确实批准了同一知识修订；若让 C16 读取 C07 表或复制决定事实，会破坏模块所有权。

## What Changes

- 为 C02 `ReviewAuditPortV1` 增加一个知识修订批准证明只读查询：输入工程、精确 `KnowledgeRevisionRefV1`、`ReviewDecisionRefV1` 和 C06 授权上下文，返回闭合的已批准证明或未批准原因。
- 由 C07 根据自己已持久化的任务与决定事实，验证复核类型为 `knowledge-revision`、决定为 `approve-publication`、目标与工程完全匹配且任务未被替代；响应只包含下游发布门所需的精确引用和决定时间。
- 查询复用 `review-audit.read` 与 C06 授权校验，必须先授权后读取；无权或跨工程调用不得泄露决定、任务或修订是否存在。
- 保持 `requestReview`、`decideReview`、`trace`、现有事件、写事务、审计和数据库结构语义不变；批准证明查询不写业务审计、拒绝审计、Outbox 或命令回执。
- 增加公共 Schema/端口契约、C07 只读适配实现及针对批准、拒绝、退回、错目标、无权和跨工程的最小回归验证。

### Non-goals

- 不新增决定、复核状态、授权能力、HTTP/UI 路由、领域事件、数据库表、视图、索引或第三方依赖。
- 不让批准证明查询发布、停用或回滚知识；C16 仍拥有治理事实和命令。
- 不提供通用决定详情读取、任意条件查询、决定正文导出或跨工程管理查询。
- 不改变 C07 既有写路径、追溯投影、批量语义及五类人工决定。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/review-and-audit-runtime`: 增加工程有界、授权受控的知识修订人工批准证明只读能力，供知识治理发布门消费。

## Impact

- **公共契约**：最小修改 `packages/contracts/src/ports/index.ts`，在既有 `ReviewAuditPortV1` 上增加批准证明查询方法及 strict Zod 输入/输出 Schema；同步扩展既有 C02 契约测试，不增加平行端口或能力枚举。
- **C07 实现**：最小修改 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 与现有 PostgreSQL 集成测试；直接查询 C07 自有决定/任务事实，不修改迁移和核心状态模型。
- **消费者**：解锁 C16 `publish-approved-release` 与 `rollback-by-new-release` 对人工批准、精确修订和工程一致性的确定性验证；其它消费者也只能按同一专用契约读取证明。
- **权限与审计**：直接依赖 C06 `LocalIdentityAccessV1.verify` 与现有 `review-audit.read`；查询保持只读，不产生业务审计写，授权拒绝仍由 C06 安全审计负责。
- **RI/RA 追踪**：支撑 RI-S44 的审核状态与版本化发布，以及 RA-S3、RA-S4、RA-S7 的人工审核、发布和回滚边界；批准证明自身不改变任何生效配置。
- **依赖治理**：不新增或升级依赖，不修改根 workspace、锁文件、`openspec/config.yaml`、C03/C06 事实或 C07 迁移。
