## Context

见 [proposal.md](./proposal.md) 与 [工程上下文及来源登记 delta spec](./specs/domain/engineering-context-source-registry/spec.md)。C02 已冻结 `EngineeringDataQueryV1Schema`：`source-segments` 输入一个 `SourceSegmentSetRefV1`，`evidence-access` 输入非空 `EvidenceReference[]` 与 `purposeCode`，两者要求各自 branch capability 且成功形状均为 `{queryResultRef}`。`PostgresEngineeringContextSourceRegistry.read` 当前只把 `monitoring-snapshot` 委托给 C14；C11 已有不可变 `source_versions`、`source_segment_sets`、`source_segments` 事实及读取 helper，但没有 C11 查询结果事实。

C14 的 `readSnapshot` 和 `resolveSnapshotQuery` 已提供本仓库范式：读取时复验 C06、在 C03 本地事务中追加查询结果/命令收据/审计、返回稳定 `queryResultRef`，resolve 再按当前授权解析。C11 必须采用同一模式，同时保持正文只由 C04 工件读取。迁移号段已裁决为 `000024`；既有 provider 会递归发现三层目录中的六位序号 migration。

## Goals / Non-Goals

**Goals:**

- 让既有两个 C02 read 分支在唯一 C11 PostgreSQL adapter 中可用，并提供同所有者窄 resolve。
- 以 strict core Schema 固定持久化查询事实和安全解析结果；结果只投影 C11 定位事实及权限引用。
- 在分支、工程、空间和资料四个维度执行 C06 当前授权复验，统一不可枚举失败。
- 复用 C03 幂等事务与审计，不复制资料段、C04 工件或其它模块事实。

**Non-Goals:**

- 不修改 `packages/contracts`、公共端口、分支、能力、成功形状或 transport。
- 不打开 C04 正文，不为当前不存在的脱敏摘要事实增加占位或回退，不实现 C17/Agent。
- 不修改 C12～C15 私有存储、既有 migration、migration provider/runner、package 导出、manifest、锁文件或依赖政策。
- 不引入新事件、事务模型、缓存、通用 repository 或查询框架。

## Decisions

### D-01：core schema 只定义 C11 查询事实与安全解析结果

在 `packages/core/src/engineering-data/context-source/schema.ts` 复用 C01/C02 的 `EvidenceReferenceSchema`、`QueryResultRefV1Schema`、`AuthorizationContextV1Schema`、`AuthorizationContextRefV1Schema`、`SourceAccessGrantRefV1Schema` 和既有 C11 `SourceSegmentSetV1Schema`/`SourceSegmentV1Schema`，新增以下 strict Schema 与 `z.infer` 类型：

- `EngineeringDataReadQueryRecordV1Schema`：包含 `queryResultRef`、`projectId`、可辨识 `query`（`source-segments` 只含 `sourceSegmentSetRef`；`evidence-access` 只含非空 `evidenceReferences` 与 `purposeCode`）、`requestedBy`、`authorizationContextRef`、`recordedAt` 和 `audit`。
- `SourceSegmentReadResultV1Schema`：包含 `kind: "source-segments"`、原查询结果引用、完整不可变 `segmentSet` 及其来源版本当前登记的 `sourceAccessGrantRef`。
- `EvidenceAccessItemV1Schema`：包含原 `evidenceReference`、类型化 `sourceVersionRef`、所属 `sourceSegmentSetRef`、继承的 `sourceAccessGrantRef` 与既有 `segment` 定位事实。
- `EvidenceAccessReadResultV1Schema`：包含 `kind: "evidence-access"`、原查询结果引用、`purposeCode` 与非空 `items`。
- `ResolveEngineeringDataReadQueryV1Schema`：仿照 C14 resolve 输入，包含 `queryResultRef`、`invocationId`、工程、操作者、请求时间和授权上下文。
- `EngineeringDataReadResolutionResultV1Schema`：闭合为 `succeeded`（上述两个安全结果之一）或 C02 `ModuleErrorV1` 失败。

这些 Schema 不加入 `packages/contracts`，也不增加第二套资料段字段；安全结果直接嵌入既有 C11 Schema。`context-source/index.ts` 已 `export * from "./schema.js"`，无需修改出口。

**替代方案：**把解析结果写入公共 contract，或只返回自由 JSON。前者违反已裁决边界，后者失去 strict SSOT；均不采用。

### D-02：一个 C11 只追加查询结果表保存精确输入引用

新增：

```text
packages/adapters/src/postgres/migrations/engineering-data/
  implement-engineering-data-read-branches/
    000024_engineering_data_read_query_results.ts
```

migration 创建 `business.engineering_data_read_query_results`：`query_result_id` 主键、`version_id`、`project_id`、`branch`、`query_result_ref`、`query_payload`、`authorization_context_ref`、`requested_by`、`recorded_at`、`persisted_at`、`audit_entry_id`。`branch` 只允许 `source-segments|evidence-access`；JSON 列必须为 object；`(project_id, query_result_ref)` 唯一；`audit_entry_id` 使用延迟 FK 指向 `audit.entries`。`query_payload` 只保存 strict 分支输入中的精确引用和用途，不保存资料段、正文、解析内容或其它模块事实。

权限沿用 C11：`riskflow_app` 仅有 SELECT/INSERT；PUBLIC、Outbox Worker 和 checkpointer 无权限，应用角色无 UPDATE/DELETE/DDL。`up`/`down` 都导出，供真实 PostgreSQL migration `up/down/up` 测试；生产已有查询结果后采用向前修复，不以回滚删除审计链。

**替代方案：**复用 `source_segment_sets`、C03 收据或 C14 查询表。前两者无法保存可解析查询输入且混淆事实所有权，后者跨模块；均不采用。按分支建两张表也没有收益，一个闭合 branch + strict payload 的 C11 表更小。

### D-03：`read` 路由两个分支，queryId 同时承担幂等身份

在 `PostgresEngineeringContextSourceRegistry.read` 保留 C14 `monitoring-snapshot` 委托，并把另外两个合法分支分别交给 C11 私有 handler。成功引用固定为：

- `source-segments-${queryId}` / version `1`；
- `evidence-access-${queryId}` / version `1`。

每个 handler 把公共 query 转成 command identity：`commandId=idempotencyKey=queryId`，Atomic command kind 分别为 `engineering-data.source-segments-query.v1` 与 `engineering-data.evidence-access-query.v1`。事务 handler 只插入 D-02 记录并返回以对应查询结果引用为 `resultRef` 的零事件 commit；审计 action 分别为 `engineering-data.source-segments-query` 与 `engineering-data.evidence-access-query`。

同一 `(projectId, commandKind, queryId)` 与相同 strict payload 由 C03 返回首次引用；改动载荷映射为 `IDEMPOTENCY_CONFLICT`。不增加 read 专用事务抽象。

### D-04：授权采用不可观察的预检、目标解析和精确复验

公共 contract 对 `source-segments` 只提供集合引用，无法在不解析 C11 所有关系时预先知道资料版本和空间引用。因此采用有界两阶段验证，而不跨层读取 C06 表：

1. 在 Schema 解析失败映射前，先检查 query/resolve 的工程、操作者和 `engineering-data.read` capability；身份或能力错配直接映射 `AUTHORIZATION_DENIED`，其余结构错误才是 `UNSUPPORTED_CONTRACT`。
2. 调用 C06 `verify` 校验查询声明的精确 branch 与工程；`evidence-access` 同时先提交输入中可确定的全部去重 `SourceVersionRefV1`。这一步在任何 C11 目标定位前执行。
3. 仅在 C11 表内读取目标归属：`source-segments` 解析集合、来源版本和段空间；`evidence-access` 逐项解析资料版本、资料段及所属集合。该步骤不记录成功、不返回部分内容。
4. 以解析出的全部去重空间引用和资料版本再次调用同一精确 branch 的 C06 `verify`；全部通过后才记录或返回结果。

resolve 从 `queryResultRef` 的固定前缀确定候选 branch，先做 branch/工程预检，再读取 D-02 记录，并对其原始精确目标重复第 3～4 步。当前权限撤销后即拒绝。任一阶段的缺失、错误 kind/version、跨工程、未就绪资料、集合/段不归属或 C06 拒绝都统一为 `AUTHORIZATION_DENIED`；不返回已通过的子集，也不暴露内部查找阶段。

现有 `#verifyRead` 改为显式接收 branch，两个既有私有 source read 调用点传入其当前语义，避免继续把公共 source-segments 错路由为 `engineering-data.evidence-access`。C06 `verify` 抛出的领域拒绝继续通过既有 `#mapError` 保留；数据库与临时故障仍映射既有闭合错误。

**替代方案：**修改 C02 给 `source-segments` 增加资料版本/空间字段，或直接 join C06 私有表。两者分别破坏公共契约和模块边界；不采用。

### D-05：resolve 只重建安全投影，不形成正文路径

新增公开类方法 `resolveReadQuery(query)` 作为 C11 同所有者窄能力。它读取 D-02 的原 query，再从不可变 C11 表重建 D-01 结果：

- `source-segments` 返回完整既有 `SourceSegmentSetV1` 和来源版本登记的 `SourceAccessGrantRefV1`；
- `evidence-access` 按请求逐项返回原证据引用、来源版本、所属集合、继承 grant ref 和 `SourceSegmentV1` 定位。

两种结果都不调用 `ArtifactStoreV1.open`，不含 `sourceArtifactRef`、`metadataArtifactRef`、任意内容字节、完整 JSON-LD 或外部句柄。当前 C11 没有脱敏摘要事实，故不新增空字段、占位工件或跨 C12/C13 查询；后续若要返回摘要，必须由独立 change 明确事实所有者与 Schema。

### D-06：查询记录、命令收据与审计保持一个本地事务

D-02 查询事实、C03 命令收据与 C03/C07 只追加审计由现有 `TransactionUnitV1.execute` 一次提交；任一步失败整体回滚。查询不产生 Outbox 事件。目标定位与 C06 验证在事务前完成，事务不跨 C06/C04；resolve 是受权读取，不创建第二份查询事实。该顺序与 C14 read 一致，不引入锁、补偿或 XA。

### D-07：测试复用现有 fixture，只覆盖稳定边界

`packages/core/test/engineering-data/context-source.test.ts` 扩展一组表格化 Schema 用例，证明两个查询记录/安全结果分支 strict、evidence 非空、resolve 输入闭合以及正文/工件字段被拒绝。

`packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 复用 `startEngineeringContextSourceFixture` 的真实 Testcontainers PostgreSQL、现有 C03/C04/C06/C07/C11/C14 装配与 e2e source/segment 种子，覆盖：

- `000024` 被自动发现，表权限正确且 migration 可 `down/up`；
- 两个 read 分支返回稳定引用并可 resolve；相同 query 重放不重复行/审计，同 ID 异载荷冲突；
- 缺失、跨工程、错误版本、未就绪、越权及撤权后 resolve 均为 `AUTHORIZATION_DENIED`，多证据不部分返回；
- 结果只含定位/引用，没有正文或工件引用；查询事务注入失败时无结果与成功审计，可重试；
- 既有 `monitoring-snapshot` 委托及 C11 写/私有 read 行为不回归。

`packages/adapters/test/engineering-data/context-source/fixture.ts` 已递归运行 production migration root 并暴露所需 registry、access 和 admin pool，不为自动发现增加代码；只有上述测试出现重复装配时才允许在该文件提取一个最小共用 helper。

### D-08：文件所有权与验证门固定

允许修改：

```text
packages/core/src/engineering-data/context-source/schema.ts
packages/core/test/engineering-data/context-source.test.ts
packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts
packages/adapters/test/engineering-data/context-source/fixture.ts                    # 仅确有共用 helper 时
packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts
packages/adapters/src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.ts
openspec/changes/implement-engineering-data-read-branches/**
```

禁止修改 `packages/contracts/**`、apps、C12/C13/C14/C15 生产代码与私有存储、所有既有 migration、package/root manifest、workspace、锁文件、配置、依赖政策、`openspec/config.yaml`、主 specs、归档或其它 change。验证只使用仓库已存在的 `tsc`、Vitest、ESLint、Prettier、dependency-cruiser、政策脚本与 OpenSpec CLI，不安装依赖或启动服务。

## Risks / Trade-offs

- [公共 source-segments 输入不携带资料/空间引用，需要内部定位后才能精确复验] → 先做 branch/工程预检，最小定位无外部输出，再做全量精确 C06 复验；任何失败统一拒绝且不落查询结果。
- [查询结果引用存在但目标当前授权被撤销] → resolve 每次复验当前 C06 授权，历史记录不授予访问权。
- [evidence-access 多目标增加查询次数] → 输入沿用 C02 已有非空数组边界，使用按集合查询与内存映射，禁止逐项跨模块调用；只有基准证明需要时再优化。
- [新增 migration 的 down 会删除查询审计链] → down 只用于未承载业务数据的部署回滚和集成测试；有数据后向前修复。
- [C11 当前没有脱敏摘要事实] → 本 change 返回允许的安全定位和引用，不制造摘要旁路；真实摘要需求另行建模。

## Migration Plan

1. 先实现 D-01 Schema 与最小 core 测试，再添加 `000024` migration；既有 provider 自动按全局序号发现，无需注册文件。
2. 在 C11 adapter 增加表类型、两个 read handler、查询事务写入、目标解析 helper 与 `resolveReadQuery`，更新现有 `#verifyRead` 调用点传入精确 branch。
3. 扩展真实 PostgreSQL 测试，验证 migration `up/down/up`、角色权限、两个分支、幂等、不可枚举、撤权、审计回滚及 C14 委托回归。
4. 部署先执行 migration，再部署 adapter。回滚应用版本前仅可在确认表无业务查询结果时执行 `down`；否则保留表并向前修复。

## Open Questions

无。公共契约、Schema、授权顺序、结果内容、事务、迁移号、文件所有权与验证范围均已固定。
