## Context

见 [proposal.md](./proposal.md) 与 [外部风险事件登记 delta spec](./specs/domain/engineering-context-source-registry/spec.md)。固定 base commit 为 `01b2df23194c6203a1104fa2c898e266109d8365`。

C02 已在 `packages/contracts/src/ports/index.ts` 冻结 `register-external-risk-event` strict payload、`ExternalRiskEventRefV1Schema`、成功结果和 `engineering-data.write` capability；同一文件的 `RiskInputVersionRefV1Schema` 与 `assessment-preparation`、`packages/contracts/src/workflows/index.ts` 的评估工作流/快照已接受 external ref。C11 的 `PostgresEngineeringContextSourceRegistry.apply` 目前只委派 `register-monitoring-batch`、实现 `register-source-delivery`，`register-external-risk-event` 落入 `valid.kind !== "register-source-delivery"` 的 `UNSUPPORTED_CONTRACT` 兜底。C25 尚未实现，不存在其它生产消费者或其它 change 所有者。

C11 已有工程/空间修订、资料版本、资料段、C04 工件守卫、C06 当前授权、C03 strict 摘要/命令收据/事务和 C07/C03 审计接缝。现有 `DomainEventV1Schema` 没有外部风险事件登记事件；`engineering.inputs-ready.v1` 要求 preparation ref，不能由本分支伪造。

## Goals / Non-Goals

**Goals:**

- 在 C11 唯一 PostgreSQL composition 内完成既有公共分支，不新增公共接口或第二套注册表。
- 将 external ref 与工程、外部来源精确版本、事件键、事件工件、证据资料版本及资料段空间绑定为一条不可变事实。
- 复用 C03/C04/C06/C07，闭合授权顺序、幂等、不可枚举失败、原子审计和迁移权限。

**Non-Goals:**

- 不解析或复制事件正文，不验证外部系统中 `externalSourceRef` 的远端存在性；该 ref 是契约提供的精确来源身份，不是本地可查询对象。
- 不实现外部连接器、事件查询端口、评估准备/评分、知识、清洗、UI 或新 Domain Event。
- 不改 contracts、其它 apply/freeze/read 行为、既有 migration、migration provider/runner、package export、依赖或锁文件。

## Decisions

### D-01：直接补齐 C11 composition 的既有 apply 分支

`PostgresEngineeringContextSourceRegistry.apply` 在现有监测委派之后、来源交付兜底之前识别 `register-external-risk-event`，调用新私有方法 `#registerExternalRiskEvent`。`register-source-delivery`、监测委派及所有 freeze/read 分支保持原行为。

`#verify` 增加一个默认仍为 `engineering-data.register-source-delivery` 的窄 branch 参数，external 分支显式传 `engineering-data.register-external-risk-event`；既有调用点无需改语义。`#assertArtifact` 只泛化命令基形与 purpose 参数，来源交付继续使用原默认值，external 分支使用 `engineering-data.register-external-risk-event`。

**替代方案：** 新建另一个 `EngineeringDataPortV1` 会产生第二个公共 composition；把实现委派给 C25 会跨越 C11 事实所有权。两者均否决。

### D-02：授权先行，证据目标随后确定性收口

`#registerExternalRiskEvent` 从 payload 的每项 `sourceVersion` 构造并按精确版本去重的 `SourceVersionRefV1[]`。任何数据库或工件目标读取前先检查命令工程/操作者/capability 与 authorization context 一致，再调用 C06 `verify`：

- branch 固定为 `engineering-data.register-external-risk-event`；
- project 固定为 `command.projectId`；
- requested source 固定为 payload 中全部精确来源资料版本；
- requested spatial scopes 使用该 branch-specific authorization context 已冻结的当前 C06 scope 集合。

C06 成功后才进入 C03 handler。事务内先通过 C04 `ArtifactReferenceGuardV1.assertUsable` 校验事件工件，再按 `project_id + source_version_id + version_id` 读取每个资料版本并要求 `ready`，按 `project_id + source_version_id + source_segment_id` 精确匹配每项证据。资料段的空间 identity 必须全部由 authorization context 覆盖，并且属于对应资料版本；最终保存的 `source_version_refs` 和 `spatial_scope_refs` 从这些已验证事实去重、稳定排序得到，不相信调用方另行提交的空间数据。

来源资料版本、资料段或事件工件的跨工程、缺失、未就绪、越权和归属不匹配均对外映射为同一个 `AUTHORIZATION_DENIED`，不返回目标 ref、计数或差异。C04 的真实 I/O/完整性故障仍按 retryable 属性映射为技术失败，不能伪装成授权问题；`externalSourceRef` 仅按 strict 契约冻结，不声称本地存在性验证。

**替代方案：** 在授权前查询资料段以推导空间会形成存在性侧信道；在 payload 增加空间字段需要改 contracts；跳过资料段核对无法证明来源版本与空间绑定。采用“branch/source 先验授权 + 事务内证据归属收口”。

### D-03：一张只追加表保存完整登记事实

新增迁移：

```text
packages/adapters/src/postgres/migrations/engineering-data/
  implement-external-risk-event-registration/
    000036_external_risk_event_registration.ts
```

只新增 `business.external_risk_events`：

| 字段 | 类型与语义 |
| --- | --- |
| `external_risk_event_id` | `text PRIMARY KEY`；由 D-04 确定性生成 |
| `version_id` | `text NOT NULL`，首版固定 `1` |
| `project_id` | `text NOT NULL`；FK 到 `business.engineering_projects(project_id)`，`ON DELETE RESTRICT` |
| `external_risk_event_ref` | `jsonb NOT NULL`；完整 `ExternalRiskEventRefV1` |
| `external_source_entity_id` / `external_source_version_id` | `text NOT NULL`；外部来源精确版本的可约束列 |
| `external_source_ref` | `jsonb NOT NULL`；原样冻结 C02 `externalSourceRef` |
| `external_event_key` | `text NOT NULL`；外部来源内稳定事件键 |
| `event_artifact_ref` | `jsonb NOT NULL`；只指向 C04 内容工件，不保存正文 |
| `evidence_references` | `jsonb NOT NULL` 非空数组；原 strict 证据引用 |
| `source_version_refs` | `jsonb NOT NULL` 非空数组；从证据确定性派生的精确 C11 refs |
| `spatial_scope_refs` | `jsonb NOT NULL` 非空数组；从证据资料段确定性派生的空间 refs |
| `occurred_at` | `timestamptz NOT NULL`；payload 业务发生时间 |
| `recorded_at` | `timestamptz NOT NULL`；command `issuedAt` |
| `persisted_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` |
| `actor_id` | `text NOT NULL` |
| `authorization_context_ref` | `jsonb NOT NULL` |
| `audit_entry_id` | `text NOT NULL`；DEFERRABLE FK 到 `audit.entries` |

约束固定为：`UNIQUE (external_risk_event_id, version_id)`、`UNIQUE (external_risk_event_id, project_id)`、`UNIQUE (project_id, external_source_entity_id, external_source_version_id, external_event_key)`；身份/键非空；六个 JSON 字段分别为 object 或非空 array。查询索引只增加 `(project_id, occurred_at)`；外部来源查询由业务唯一约束覆盖，不增加 GIN 或投影表。

迁移先对该表从 `PUBLIC`、`riskflow_app`、`riskflow_outbox_worker`、`riskflow_checkpointer` 撤销全部权限，仅给 `riskflow_app` 授予 `SELECT, INSERT`。不授予 UPDATE/DELETE/DDL，不增加序列、trigger、自由 metadata 列或正文列。C04/C06 与数组内资料引用属于其他所有者，不建跨模块 FK；事务校验加既有 C11 来源表只追加约束保证引用不会被覆盖。

**替代方案：** 为每条证据增加关联表可提供数组元素 FK，但当前只有登记与精确引用返回，没有关系查询；一张只追加表已保留完整重放事实，避免无消费方的第二张表。

### D-04：外部事件身份与幂等身份分离

`externalRiskEventId` 由现有 `sha256CanonicalJson` 对 `{ projectId, externalSourceRef, externalEventKey }` 计算，并使用 `external-risk-event:<40 hex>` 形式；返回 ref 固定 `{ kind: "external-risk-event", reference: { entityId, versionId: "1" } }`。同一外部来源精确版本与事件键在同一工程只能形成一个 immutable identity。

C03 command kind 固定 `engineering-data.register-external-risk-event.v1`，payload 使用完整 strict command，继续由 `TransactionUnitV1` 计算规范摘要和唯一键 `(projectId, commandKind, idempotencyKey)`。同键同载荷在 handler 前由收据重放原 ref；同键异载荷映射 `IDEMPOTENCY_CONFLICT`。事务以 project/source/key 派生 advisory transaction lock，再检查业务唯一键；另一 idempotency key 试图覆盖同一外部身份时返回 `BUSINESS_BLOCKED`，不新增修订。

**替代方案：** 用 `commandId` 生成事件 identity 会允许调用方换幂等键复制同一外部事件；允许版本 2 会把不可变外部输入误建成可修订注册表。均否决。

### D-05：业务事实、收据和审计使用一个零事件 AtomicCommit

`#registerExternalRiskEventInTransaction` 在同一 C03 handler 内执行 C04 guard、C11 当前工程生命周期检查、来源资料/资料段验证及单行 INSERT，随后复用 `commit` 生成：

- `resultRef` / audit target：新 `ExternalRiskEventRefV1`；
- audit action：`engineering-data.register-external-risk-event`；
- audit version：external ref 的 `reference`；
- `events: []`。

`TransactionUnitV1` 在同一 PostgreSQL 事务追加 `audit.entries`、完成 `business.command_receipts`。任一步失败整笔回滚。当前工程不存在使用不可枚举拒绝，当前 C11 生命周期为 `ended|archived` 使用 `BUSINESS_BLOCKED`。现有 Domain Event 联合没有适用登记事件，因此不写 Outbox；若未来新增事件，必须先演进 contracts/spec，并只携带 external ref 等精确引用。

### D-06：失败语义保持闭合且不影响既有分支

| 条件 | 外部结果 |
| --- | --- |
| apply 输入不满足现有 Schema | 既有 `UNSUPPORTED_CONTRACT` |
| branch/project/actor/capability 不匹配，C06 拒绝或过期 | `AUTHORIZATION_DENIED` |
| 工件、资料版本、资料段缺失/跨工程/越权/未就绪/归属不符 | `AUTHORIZATION_DENIED` |
| 当前工程 ended/archived，或另一命令占用同一外部身份 | `BUSINESS_BLOCKED` |
| 同 C03 键异 strict payload | `IDEMPOTENCY_CONFLICT` |
| 可重试 PostgreSQL/C04 故障 | `TRANSIENT_FAILURE` |
| 其它不可重试技术故障 | `TERMINAL_FAILURE` |

现有 `#mapError` 只增加 external 分支所需的 target-conceal 选择；默认路径保持现状。错误、审计和日志均不携带正文、证据内容或目标存在性细节。

### D-07：测试复用真实 C11 fixture，生产迁移自动发现

`packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 继续复用现有 Testcontainers fixture；fixture 已递归运行 production migration root，无需修改。测试在既有 C11 资料版本/资料段事实上创建事件工件，覆盖 migration `up/down/up`、角色权限、成功绑定、XOR-facing ref、同命令重放/冲突、同外部身份覆盖拒绝、缺失/跨工程/越权不可枚举、审计失败回滚和零 Outbox。

生产 `PostgresMigrationProvider` 已递归发现迁移，不存在中央生产注册。测试侧 `packages/adapters/test/postgres/postgres-foundation.test.ts` 使用显式 `testMigrationManifest` 驱动 loader 与顺序断言，需由主调度 Agent 追加：

```ts
import * as externalRiskEventRegistrationMigration from "../../src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.js";

{
  root: "production",
  relativePath:
    "engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.ts",
  migrationName:
    "000036_engineering-data_implement-external-risk-event-registration_external_risk_event_registration",
  sequence: 36,
  module: externalRiskEventRegistrationMigration,
},
```

该项放在现有 sequence 12 条目之后、900001 fixture 条目之前。本 change 的实现 Agent不得修改该中央测试清单。

### D-08：文件所有权与追踪

实现 Agent只新增/修改：

```text
packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts
packages/adapters/src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.ts
packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts
```

主调度另行追加 D-07 的 `packages/adapters/test/postgres/postgres-foundation.test.ts` 测试 manifest。现有 fixture、contracts、core、apps、C15/C19/C25、package exports、provider/runner、既有 migration 和根配置均不修改。

追踪关系：RI-S14 由 C06 当前授权、C04 事件工件与资料段证据、C03/C07 原子审计满足；RA-S1/RA-S5 由不可变 external ref 及其工程/空间/资料版本绑定满足。C25 后续只消费 `ExternalRiskEventRefV1`，将 `reference.entityId` 作为其 external risk input identity，不复制 C11 事件事实。

## Risks / Trade-offs

- [C02 的 evidence 数组没有数量上限] → 本 change 不收窄已归档公共契约；实现使用去重集合和按工程有界查询，不增加隐式新上限。若真实载荷证明需要硬预算，另开 contracts change。
- [JSON 数组没有元素级数据库 FK] → C03 handler 对每项精确验证，依赖 C11 来源/资料段只追加与本表无 UPDATE/DELETE；出现关系查询需求后再以独立投影补充，不预建关联表。
- [外部来源系统不可在本地验证] → 只冻结 strict `externalSourceRef` 与事件键，真实性由调用方集成授权和证据资料链承担；不建立无事实源的本地来源注册表。
- [迁移 down 会删除外部事件历史] → down 仅用于部署前/非生产 `up/down/up` 验证；一旦有下游 C25 引用，只允许向前修复。

## Migration Plan

1. 主调度先追加 D-07 的测试 manifest 条目；生产 provider 不变。
2. 部署 `000036`，确认表约束及角色权限后部署包含 external apply 分支的 adapter。
3. 用一个已授权事件工件和既有 C11 资料段完成登记、重放、拒绝与零 Outbox 验收，再允许 C25 消费。
4. 尚无登记数据和下游引用时可执行 `down` 后重新 `up`；已有数据或引用后禁止回退删除，使用后续向前 migration/代码修复。
