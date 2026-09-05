## Context

参见 [proposal.md](./proposal.md) 的动机。现有事实已经足够，无需新建存储：

- C02 在 `packages/contracts/src/ports/index.ts` 冻结了 `KnowledgeRevisionRefV1`、`ReviewDecisionRefV1`、`knowledge-revision / approve-publication` 决定，以及 `ReviewAuditPortV1.requestReview/decideReview/trace`。
- C07 的 `business.review_decisions` 已保存工程、复核类型、复核任务、精确目标、类型化决定和决定时间；`business.review_tasks` 已保存 `pending | decided | superseded` 状态及决定引用。
- C07 当前只把决定引用返回给写调用者，并让 `trace` 返回追溯引用。追溯结果不能作为机器可判定的批准证明，且让 C16 读取 C07 表会绕过公开接口。
- C06 已将复核审计读能力表示为 `review-audit.read`，并要求授权上下文绑定精确分支；授权必须先于资源读取。
- C16 的发布和历史版本重新启用命令已经携带精确修订与决定引用，因此缺口只是一项 C07 拥有的专用只读验证。

本 change 修改公共契约和 C07 适配实现，必须保持 Schema、权限、错误和最小披露一致；不需要数据库迁移、HTTP 路由或新依赖。

## Goals / Non-Goals

**Goals:**

- 让下游通过 C07 公共接口确定性验证“该精确知识修订已获人工批准”。
- 保持决定事实的唯一所有者为 C07，消费者只取得最小证明结果。
- 在同一 strict Zod Schema 中固定输入、输出、未批准原因和 TypeScript 类型。
- 复用 C06 授权、C07 现有工程索引和 `review-audit.read` 能力，保持先授权后读取与跨工程不可枚举。

**Non-Goals:**

- 不提供通用决定读取器、仓储接口、SQL 接缝、活动正文或证据正文。
- 不改变复核任务状态机、决定命令、追溯投影、事务事件或审计写入。
- 不替 C16 实现发布、停用、回滚或知识修订归属校验。
- 不为一个只读等值查询增加缓存、物化视图、索引、迁移、工厂或单实现接口包装。

## Decisions

### 1. 扩展既有 `ReviewAuditPortV1`，不新增平行只读端口

公共端口增加：

```ts
interface ReviewAuditPortV1 {
  requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1>;
  decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1>;
  verifyKnowledgeRevisionApproval(
    query: KnowledgeRevisionApprovalProofQueryV1,
  ): Promise<KnowledgeRevisionApprovalProofResultV1>;
  trace(query: TraceQueryV1): Promise<TraceResultV1>;
}
```

这是复核审计模块拥有的第四个用例，不是跨领域服务。把它加入既有端口可继续满足 C02“少量用例级 interface”约束，也让所有实现者在编译期显式提供该能力。

备选方案是新增 `KnowledgeRevisionApprovalProofReaderV1`。它只有一个实现、读取同一 C07 聚合并使用同一授权机制，会形成平行装配面和额外注入依赖，未带来隔离收益，因此不采用。复用 `trace` 也不合适：`trace` 返回引用式活动结果，未承诺结构化决定详情，消费者若解析活动文案或投影会产生第二套脆弱契约。

### 2. 查询使用专用分支并复用现有读能力

新增模块分支 `review-audit.verify-knowledge-revision-approval`，在 `MODULE_BRANCH_CAPABILITY_V1` 中映射到既有 `review-audit.read`。不增加 `ModuleCapabilityV1` 枚举值；项目风险管理员通过现有全分支策略获得该分支，C16 的 system 调用只能从具备该分支的父授权上下文收窄取得授权。

该分支不自动加入 reviewer 的显式角色分支表。reviewer 的职责是提交决定与人工追溯，批准证明是下游确定性发布门的机器查询；当前没有 reviewer 直接调用此接缝的需求。若未来 UI 需要展示证明，应通过其 owning projection，而不是为本 change 放宽角色。

查询 DTO 沿用 C02 查询信封：

```ts
type KnowledgeRevisionApprovalProofQueryV1 = {
  queryId: string;
  projectId: string;
  actorId: string;
  requestedAt: string;
  authorization: AuthorizationContextV1;
  kind: "verify-knowledge-revision-approval";
  payload: {
    revisionRef: KnowledgeRevisionRefV1;
    reviewDecisionRef: ReviewDecisionRefV1;
  };
};
```

`querySchema` 继续校验信封工程/主体与授权上下文一致、授权包含 `review-audit.read`。适配器再调用 `LocalIdentityAccessV1.verify` 校验精确新分支，避免仅凭调用方自报 capability 放行。

### 3. 结果以业务结论联合表示，不把未批准混成技术错误

公共成功结果为闭合联合：

```ts
type KnowledgeRevisionApprovalProofV1 =
  | {
      kind: "approved";
      revisionRef: KnowledgeRevisionRefV1;
      reviewTaskRef: ReviewTaskRefV1;
      reviewDecisionRef: ReviewDecisionRefV1;
      decidedAt: string;
    }
  | {
      kind: "not-approved";
      reason:
        | "decision-not-found"
        | "target-mismatch"
        | "decision-not-approval";
    };
```

外层 `KnowledgeRevisionApprovalProofResultV1` 沿用 `moduleResultSchema` 的 `succeeded | failed`：未找到、拒绝/退回、错目标或任务状态无效都是发布门可稳定处理的业务结论；Schema 无效、授权拒绝和数据库故障仍使用现有 `ModuleErrorV1`。下游只根据联合字段路由，不匹配错误文案。

已批准结果刻意不返回 `decision`、`reasonCode`、actor、授权上下文、证据或快照。决定类型由 C07 验证后折叠为 `approved`，精确引用和 `decidedAt` 足以让 C16 保存发布依据；详细责任追溯仍走 `trace`。

### 4. 单次工程有界查询直接读取现有 C07 事实

适配器按以下顺序执行：

1. strict 解析查询；失败返回现有 `UNSUPPORTED_CONTRACT`。
2. 以查询授权、工程、查询标识调用 C06 校验 `review-audit.verify-knowledge-revision-approval`；失败在任何决定读取前返回现有安全错误。
3. 使用 `(project_id, review_decision_id, version_id)` 读取 `business.review_decisions`，并以内连接取得其 `business.review_tasks`；不得先按决定引用跨工程查找后再比较工程。
4. 无记录返回 `decision-not-found`；因此其它工程存在与完全不存在不可区分。
5. 依次验证决定行/任务行的精确引用一致、复核类型为 `knowledge-revision`、目标等于输入修订、任务为 `decided` 且任务保存的 `decision_ref` 等于输入决定、决定为 `approve-publication`。
6. 返回对应闭合结论；任何不可解析的已存 JSON、非 `decided` 任务或任务决定引用不一致视为技术/完整性失败，不降格为批准。

现有主键已支持决定定位，任务主键/外键支持连接；工程谓词将查询限定在单工程。没有扫描、排序或正文读取，故不增加视图/索引/缓存。

验证顺序只约束安全语义，不把内部调用次数写成业务契约。`decision-not-approval` 可覆盖 `reject` 与 `return-for-revision`，避免把完整决定联合复制到证明响应。C07 只允许 `pending` 任务被替代，`decided` 任务保持不可变，因此正常流程不存在“已有决定但任务后来被替代”；不为不可达状态增加公开原因或测试。若已存任务/决定违反该约束，查询按技术完整性失败关闭。

### 5. 查询保持无业务写入，授权拒绝仍由 C06 审计

批准证明不是命令，也不形成新领域事实。它不经过 C03 `TransactionUnitV1`，不写 `audit.entries`、`audit.review_rejections`、命令回执或 Outbox；数据库连接只执行 SELECT。C06 对授权成功/拒绝的既有安全审计保持不变，详细人工决定追溯仍由 C07 `trace` 提供。

这与 C07 当前 `trace` 的只读行为一致，也避免高频发布前校验制造重复业务审计。若未来合规要求所有读取单独审计，应以统一查询审计 change 处理，不能只为该接缝另起一套日志。

### 6. 契约、实现和测试文件保持最小范围

计划修改：

- `packages/contracts/src/ports/index.ts`：新增分支映射、查询/证明/结果 Schema 与类型，并扩展 `ReviewAuditPortV1`。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：在现有 C02 契约测试中覆盖 strict 输入、分支能力、闭合结果和端口类型。
- `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`：实现授权先行、工程有界读取与证明折叠。
- `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`：复用现有 fixture 和真实 C07 决定，覆盖批准与失败边界。

条件修改：若现有 auth 契约测试静态列举所有分支，则只更新对应断言以接受新分支映射；不修改 C06 角色、授权算法或迁移。预计无需修改 core、package exports、适配器导出、数据库迁移、应用或 manifests。

### 7. 错误、权限、审计与 C16 消费契约

| 条件 | 对外结果 | 读取/写入边界 |
| --- | --- | --- |
| 查询 Schema 或契约版本非法 | `failed / UNSUPPORTED_CONTRACT` | 不读取决定；不写业务事实 |
| 授权失效、分支/工程/主体不匹配 | `failed / AUTHORIZATION_DENIED` | 授权前不读取；C06 按既有规则安全审计 |
| 当前工程无精确决定 | `succeeded / not-approved / decision-not-found` | 仅工程有界 SELECT；无业务写 |
| 决定目标不是输入修订 | `succeeded / not-approved / target-mismatch` | 不读取修订正文；无业务写 |
| 决定为拒绝或退回 | `succeeded / not-approved / decision-not-approval` | 不泄露原因正文；无业务写 |
| 任务/决定关系或状态无效 | 现有终止技术错误 + 诊断引用 | 拒绝形成证明；无业务写 |
| 数据库或已存事实完整性故障 | 现有可重试/终止技术错误 + 诊断引用 | 不返回批准；无业务写 |

C16 在自己的 `publish-approved-release` 与 `rollback-by-new-release` 写事务前调用本方法。只有 `approved` 且响应引用与命令精确输入相同才继续；所有 `not-approved` 或 `failed` 均阻断发布。C16 保存返回的决定/任务引用和决定时间作为治理审计关联，但不复制 C07 决定正文，也不把本查询结果当成新的人工决定。

## Risks / Trade-offs

- **`ReviewAuditPortV1` 增加必需方法会让现有实现编译失败** → 仓库当前只有 `PostgresReviewAuditAdapter` 一个生产实现；同一 change 同步实现并用类型检查发现测试替身遗漏，不引入可选方法或默认放行。
- **闭合未批准原因会暴露同工程内决定状态** → 只有通过专用 C06 分支授权的调用者可查询；跨工程始终工程有界并折叠为 `decision-not-found`，响应不含正文或主体。
- **C16 调用与后续发布不是跨模块单事务** → 决定和任务事实不可变，证明绑定精确版本；C16 在自己的写事务中保存证明引用并可在重试时重新验证，无需分布式事务。
- **未来其它决定类型也可能需要证明** → 当前唯一确认消费者是知识修订发布；先提供专用契约，真实第二个用例出现后再以新的闭合证明类型演进，避免现在设计通用决定详情查询。
- **历史数据不一致可能被归为技术失败** → 失败关闭，绝不返回批准；实现记录诊断引用，由现有追溯/运维流程处理，不增加修复脚本。

## Migration Plan

1. 先发布 contracts 的 strict Schema、分支映射和端口方法，同时实现唯一生产适配器并更新现有测试替身。
2. 部署 C07 适配实现；无数据库迁移或数据回填，现有任务、决定和追溯行为不变。
3. 通过 contracts 与 PostgreSQL 定向测试、类型检查、依赖边界和严格 OpenSpec 校验后归档本 change。
4. C16 仅在本 change 已实现、验证并归档后开始发布/回滚实现；消费 `verifyKnowledgeRevisionApproval`，不得读取 C07 内部表。
5. 若需要回退，整体回退 contracts 方法与适配实现；该查询从未写入事实，因此无数据回滚或双写窗口。

不存在会改变规格、实现边界或任务拆分的 Open Questions。
