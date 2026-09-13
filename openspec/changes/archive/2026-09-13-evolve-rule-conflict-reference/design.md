## Context

基线提交为 `8fe4c1f07dd469ed15b7b6da6c4c98292dd476f5`。见 [proposal.md](./proposal.md) 的动因与 [delta spec](./specs/domain/module-interfaces-events-workflows/spec.md) 的行为要求。

当前 `ContractReferenceV1Schema` 位于 `packages/contracts/src/ports/index.ts`，而非 `common/index.ts`。`common/index.ts` 只提供其叶子字段使用的 `VersionReferenceSchema`。同一 ports 文件已经三次表达规则冲突语义：

- `ReviewTargetRefV1Schema` 内联接受 `{ kind: "rule-conflict", reference: VersionReference }`；
- `ReviewTaskRefV1Schema` 的 `reviewType=rule-conflict` 分支通过私有 `RuleConflictReviewTargetRefV1Schema` 接受相同形状；
- `ReviewDecisionV1Schema` 与 `reviewTargetMatchesType` 已把 `rule-conflict` 作为闭合复核分支。

缺失的是 `ContractReferenceV1Schema` 中对应的 kind。C07 的 `ReviewAuditPortV1.requestReview` 可以先接受该复核目标，但 `PostgresReviewAuditAdapter.makeRequestEvent` 随后把 `targetRef` 作为 `ContractReferenceV1` 解析进 `review.review-requested.v1`，因此事务在落库前失败。C19 的规则冲突 DTO 与 `rule_conflict_review_links` 结构已经存在，无需新增冲突模型或迁移。

## Goals / Non-Goals

**Goals:**

- 让规则冲突的同一精确版本引用同时属于复核目标和公共契约引用。
- 让 public Schema 成为该引用形状的唯一事实源，并保持 strict、闭合和可静态推导。
- 以现有 contracts 测试和全仓类型检查证明新增联合成员没有破坏消费者。

**Non-Goals:**

- 不改变 C07/C19 运行时、持久化、事务、授权、事件或审计实现。
- 不改变规则冲突的实体身份生成方式、状态机、复核决定或发布语义。
- 不修改其它引用、枚举、records、迁移、应用、workspace 或依赖。

## Decisions

### D-01：增加一个命名的叶子引用 Schema

在现有命名引用区域导出：

```ts
export const RuleConflictRefV1Schema = versionedRef("rule-conflict");
export type RuleConflictRefV1 = z.infer<typeof RuleConflictRefV1Schema>;
```

该引用只有 `kind` 与 `VersionReferenceSchema`，因此实体标识和版本标识均为非空精确值，`z.strictObject` 会拒绝正文及其它自由字段。它引用 C19 已拥有的规则冲突关系版本，不定义关系成员、冲突原因、规则内容、状态或决定。

备选方案是在 `ContractReferenceV1Schema` 中再写一个内联分支。该方案能修复解析，但会保留第三份相同形状，调用方也没有可导入的命名类型；故不采用。

### D-02：三个联合复用同一规则冲突引用

`ReviewTargetRefV1Schema`、`ReviewTaskRefV1Schema` 的 `reviewType=rule-conflict` 分支和 `ContractReferenceV1Schema` 均直接使用 `RuleConflictRefV1Schema`。删除私有且重复的 `RuleConflictReviewTargetRefV1Schema`，不增加适配函数、工厂或第二个 DTO。

`ReviewTypeV1Schema`、`RuleConflictReviewDecisionV1Schema`、`reviewTargetMatchesType` 及其它 kind 不改。由此，复核请求、任务、决定校验和事件/审计公共引用仍沿现有路径，只把原本运行时不合法的强制类型转换变成真实联合成员。

### D-03：兼容性按“同形状、联合加成员”处理

- **运行时**：既有 kind 的 Schema 和判别值不变；新增输入仅放宽为一个已在复核契约中存在的 strict 形状，未知 kind 仍失败。
- **静态类型**：`ContractReferenceV1` 增加一个联合成员。仓库当前消费点按通用 `kind/reference` 结构读取，未发现穷尽枚举所有 kind 的分支；`pnpm typecheck` 仍作为强制门，若未来基线出现穷尽分支则必须在本 change 内显式处理或停止升级，不能用断言掩盖。
- **持久化**：C07 的 `target_kind` 为非空 text，引用为 JSONB；没有数据库 enum 或限制 kind 集合的 CHECK。新增成员不需要迁移、回填或双写。
- **序列化**：wire shape 与 C19 已提交的 `{ kind: "rule-conflict", reference: { entityId, versionId } }` 完全相同，不增加 contract version 字段或更改事件版本。

### D-04：消费面及所需动作

| 消费类别 | 直接消费点 | 本 change 动作 |
| --- | --- | --- |
| contracts | `packages/contracts/src/ports/index.ts`、`packages/contracts/src/events/index.ts` | 仅修改 ports 的叶子引用与联合；events 自动接纳新增成员 |
| contracts 测试 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 扩展现有引用/复核/事件行为测试，不新建测试文件 |
| core | `access/schema.ts`；`agent-runtime/{schema,runtime}.ts`；`artifacts/schema.ts`；`assessment-config/{service,validation}.ts`；`engineering-data/context-source/service.ts`；`knowledge-governance/{schema,lifecycle}.ts`；`persistence/schema.ts`；`review-audit/schema.ts` | 不改；均按公共 Schema 或通用 `kind/reference` 结构消费，由全仓类型检查回归 |
| adapters | `agent-runtime/postgres-agent-task-adapter.ts`、`artifacts/postgres-artifact-registry.ts`、`assessment-config/postgres-assessment-configuration-adapter.ts`、`auth/postgres-local-identity-access.ts`、`engineering-data/context-source/postgres-engineering-context-source-registry.ts`、`engineering-data/monitoring/postgres-monitoring-store.ts`、`knowledge-governance/postgres-knowledge-governance-adapter.ts`、`postgres/checkpointer.ts`、`review-audit/postgres-review-audit-adapter.ts` | 不改；C07 的 `targetAsContractReference` 由不安全断言变为与公共联合一致，现有 JSON/text 存储可直接承载 |
| apps | `apps/api/src/http.ts`；`apps/worker/src/agent-runtime/runner.ts`；`apps/web/src/api/errors.ts`、`shared/{confirmation,CommandConfirmationDialog}.tsx`、`shell/dock/RightDock.tsx` | 不改；解析、传递与展示均使用通用引用结构 |
| 既有回归测试 | `apps/web/test/{api-client-openapi,confirmation}.test.ts`、`packages/core/test/agent-runtime/agent-runtime.test.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts` | 不改；由 `pnpm typecheck` 与 contracts 定向测试覆盖类型扩张，当前 change 不扩大到应用或 adapter 测试 |

### D-05：测试只覆盖稳定契约边界

在既有 `module-interfaces-events-workflows.test.ts` 中增加一个共享 `ruleConflictRef` fixture，并验证：

1. `RuleConflictRefV1Schema` 与 `ContractReferenceV1Schema` 接受精确引用；
2. `ReviewRequestV1Schema` 接受 `reviewType=rule-conflict` 与同一 target，`ReviewTaskRefV1Schema` 保持类型匹配；
3. `DomainEventV1Schema` 接受以该目标构成的 `review.review-requested.v1`；
4. 缺少 `versionId`、附带冲突正文或未知字段时失败，任一未知 kind 仍失败。

不为字段顺序、完整错误文案、内部 helper 或 C07 SQL 顺序增加断言。

### D-06：文件所有权和验证边界

生产实现只允许修改 `packages/contracts/src/ports/index.ts`，测试只允许修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts`。规划工件仅位于本 change 目录。实现不得修改 `common/index.ts`、`records/index.ts`、`events/index.ts`、core、adapters、apps、迁移、根配置、锁文件、依赖政策、`openspec/config.yaml`、主 specs 或其它 change。

## Risks / Trade-offs

- **联合成员增加可能使未来新增的穷尽 kind 分支编译失败** → 先运行 contracts tsc，再运行根 `pnpm typecheck`；若存在真实穷尽消费者，只在用户扩大文件范围后处理，否则停止并报告 drift。
- **只测试公共 Schema 可能遗漏 C07 的 PostgreSQL 行为** → 当前根因发生在 contracts 解析且 C07 已有规则冲突目标存储结构；本 change 不越界修改 C07。C19 在合入本契约后恢复自己的 PostgreSQL 断言，作为端到端证明。
- **把规则关系误当成新的公共冲突事实** → 引用的 `entityId/versionId` 继续由 C19 的既有关系身份提供；Schema 不定义正文或所有权，不建立第二套模型。

## Migration Plan

1. 先发布 contracts 的命名引用与联合成员，并通过 contracts tsc/vitest、全仓 typecheck、格式和 OpenSpec 校验。
2. 无数据库迁移、回填、版本转换或运行时部署顺序要求；C07 现有 text/JSONB 字段直接保存新 kind。
3. C19 将包含本变更的基线合入其工作分支后，恢复既有冲突测试中 `status=pending` 的复核链接断言；不把该下游测试修改纳入本 change。
4. 若需回退，撤销 contracts 联合成员及对应测试/spec delta；没有数据迁移可回滚，但回退会重新阻断新的规则冲突复核请求，已保存引用仍须在回退前确认没有消费者读取需求。

不存在会改变规格、接口、持久化、依赖、范围或任务拆分的 Open Questions。
