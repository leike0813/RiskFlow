## Context

动因见 [proposal.md](./proposal.md#why)，行为边界见 [spec.md](./specs/data/agent-cleaning-and-partial-availability/spec.md)。固定实施基线为 `3a079f5bc4f6fe8d6fcc2bde0e6fc98ff7df2141`。

公共 `IdentificationPreparationSnapshotV1Schema` 在 `packages/contracts/src/workflows/index.ts:72-98` 已把 `excludedSegmentDecisionRefs[]` 与 `coverageDecisionRef` 固定为 `RouteDecisionRefV1Schema`。C15 的 `PostgresDataCleaningStore.#finalizePreparation` 却在 `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts:805-842` 创建两个 `ContentArtifactRefV1`，并在第 858、863 行未经公共 Schema 解析就写入快照；现有测试在 `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts:76-83,629-652` 使用缺少 `kind` 约束的本地 view，因此没有发现 drift。

迁移 `000016` 已在 `business.identification_preparation_snapshots` 保存 `snapshot_payload`、`agent_task_ref`、`cleaning_result_artifact_ref`、精确 `snapshot_ref` 和审计身份，不需要新列。C19 分支已在 concrete store 增加按 `taskRef` 的 `readBoundResult`；C17 修订设计要求按 `preparationSnapshotRef` 取得 strict 准备聚合，C24 则继续以单一准备引用推进 I0→I1。两类读取的目标和返回内容不同，但应共用同一个私有任务—结果绑定实现。

## Goals / Non-Goals

**Goals:**

- 使所有新写入的识别准备 payload 在事务前通过现有公共 strict Schema，并保持决定内容、清洗结果来源和公开路由决定引用可重建。
- 给 C17/C24 一个按精确准备引用、当前受权、不可枚举且可审计的进程内读取接缝。
- 与 C19 的 task-ref reader 合并后保持一个任务结果读取实现，不复制 SQL、C04 读取或绑定校验。

**Non-Goals:**

- 不改变 C15 的清洗候选、可用性计算、结果 Schema、任务状态、冻结命令、Outbox 或事务边界。
- 不修改公共 contracts、core task port、apps、其它模块、现有 migration 或迁移清单，不增加 HTTP/transport 接口。
- 不提供决定列表、结果搜索、“最新值”、任意对象读取或正文访问，不把 C15 concrete-store 接缝提升为跨层 wire contract。

## Decisions

### D-01：决定内容留在 C04，公开引用投影为同版本 route-decision

`#finalizePreparation` 继续用现有 `#putContent` 保存覆盖决定和聚合排除决定；两份内容继续包含 `manifestDigest`、`cleaningResultArtifactRef`、覆盖/可用性或逐项排除决定，并继续以 manifest/result artifacts 作为 parent refs。写入快照前，把每个内容工件的 `reference` 原样投影为：

```ts
RouteDecisionRefV1Schema.parse({
  kind: "route-decision",
  reference: decisionArtifactRef.reference,
})
```

因此 C04 工件仍是决定内容的唯一正文，`RouteDecisionRefV1.reference` 与该内容工件使用同一精确实体/版本身份；`coverageDecisionRef` 指向覆盖决定，`excludedSegmentDecisionRefs` 仍按 C15 当前语义包含一个聚合排除决定引用。工件 guard 继续校验原 `ContentArtifactRefV1`，公开 snapshot 只保存 route-decision 投影。不得改变排除项粒度、补造 unavailable 文档的新决定或修改清洗结果。

完整对象必须先经 `IdentificationPreparationSnapshotV1Schema.parse()`，再进入现有准备事务并写入 `snapshot_payload`。这同时校验 route kind、复数资料段集合、数组等长及全部既有字段。备选是修改 contracts 接受 content-artifact，方向已被公共契约和 C17 验证否决；新增 route-decision 表会复制 C04 决定内容且现有列已足够，不采用。

### D-02：按准备引用导出一个独立的 exact reader

concrete store 新增以下 adapters 内类型和方法，不加入 `DataCleaningTaskPortV1` 或 `packages/contracts`：

```ts
export interface IdentificationPreparationReadRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly authorization: EngineeringFreezeCommandV1["authorization"];
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
}

export type IdentificationPreparationReadResultV1 =
  | {
      readonly kind: "ok";
      readonly snapshot: IdentificationPreparationSnapshotV1;
      readonly agentTaskRef: AgentTaskRefV1;
      readonly result: DataCleaningResultV1;
      readonly resultArtifactRef: ContentArtifactRefV1;
    }
  | { readonly kind: "error"; readonly error: Record<string, unknown> };

readExactPreparation(
  input: IdentificationPreparationReadRequestV1,
): Promise<IdentificationPreparationReadResultV1>;
```

读取顺序固定为：

1. 校验请求 actor/project 与授权上下文一致，并以固定 `engineering-data.evidence-access` 分支复验当前上下文；不枚举或试探其它 branch。
2. 仅以 `projectId + preparationSnapshotRef.reference.entityId/versionId` 单点读取 `000016` 的准备行；目标定位只在方法内部发生，任何后续失败均不产生可观察存在性差异。
3. 用公共 `IdentificationPreparationSnapshotV1Schema`、`AgentTaskRefV1Schema` 和 `ContentArtifactRefV1Schema` strict parse 行内字段，再以快照的精确空间/资料范围复验当前 C06 授权。
4. 调用现有私有 `#readBoundResult(context, agentTaskRef)`，复用唯一的结果索引查询、C04 受权读取、`DataCleaningResultV1Schema` 解析和任务—结果绑定；同时比较准备行的 `cleaning_result_artifact_ref` 与私有读取结果。
5. 成功后以 `requestId` 和派生幂等键 `${requestId}:read-exact-preparation` 调用现有 `TransactionUnitV1`，规范载荷固定请求主体、授权上下文引用、请求时刻和准备引用；原子写一个完成回执及一条 `engineering-data.read-identification-preparation` 审计，零事件。成功只返回签名列出的五项。

授权撤销、actor/工程不符、跨工程、零行、payload 非 strict、决定 kind 错误、工件不可见、task/result/artifact 失配统一映射为同一个不可重试 `AUTHORIZATION_DENIED` 公开形状；不返回 blocker/目标引用。数据库、C04、审计或回执的瞬时故障保留可重试技术失败。授权复验先于历史回执重放；同请求同载荷重放不重复 C03/C04 审计，同请求改传其它准备引用返回 `IDEMPOTENCY_CONFLICT`。

备选是在 C17 直读 `business.identification_preparation_snapshots`；这会复制 C15 的授权、strict parse 和绑定规则。扩展 `EngineeringDataPortV1` 则会改变 wire contract。两者均不采用。

### D-03：C19 的 task reader 与 preparation reader 保持不同职责

C19 分支 `leike0813/c19-scoring-rules` 已实现：

```ts
readBoundResult(input: {
  projectId: string;
  actorId: string;
  requestId: string;
  requestedAt: string;
  authorization: EngineeringFreezeCommandV1["authorization"];
  taskRef: AgentTaskRefV1;
}): Promise<
  | { kind: "ok"; result: DataCleaningResultV1; resultArtifactRef: ContentArtifactRefV1 }
  | { kind: "error"; error: Record<string, unknown> }
>;
```

合并策略是保留该方法、输入/输出和 `engineering-data.read-data-cleaning-result` 审计语义，不在本 change 重命名或复制它。`readBoundResult` 供已持有 C08 task ref 的 C19 读取清洗结果；`readExactPreparation` 供已持有准备快照 ref 的 C17/C24 读取准备聚合与绑定结果。两者都调用同一个私有 `#readBoundResult`，并复用相同的不可枚举错误 helper 和授权/审计模式；冲突解决后不得出现第二个 task-ref reader、第二份结果 SQL 或第二份 result parser。

若本 change 先于 C19 集成，实现只增加 `readExactPreparation`；之后合并 C19 时保留双方不同方法并人工去重共同 import/helper。若 C19 先集成，本 change 直接基于其公共类型和授权 helper 实现 preparation reader。任何需要修改 C19 scoring-rules 调用方或扩大到 core/contracts 的情况都必须停止并升级。

### D-04：历史错误 payload 不改写、不兼容投影

本 change 只保证部署后的新准备写入正确。已有 `content-artifact` 决定字段违反当时已经生效的公共 Schema，但准备事实被定义为不可变；不得 SQL 原地更新、增加读时 kind 替换、写兼容双字段或提供一次性修复脚本。`readExactPreparation` 对这些行 strict parse 失败并按 D-02 fail-closed，不向下游返回部分准备。

当前 C17/C24 尚未形成可依赖这些错误 payload 的正式生产消费链，因此不需要数据 migration。若部署盘点发现必须继续使用的历史错误行，运维应保留旧行及审计，在新版上线后以新的 command/idempotency identity 重新执行识别准备冻结，生成新的合法快照；旧 Outbox/快照不得改写。若业务要求保持旧 snapshot ref 可读，则属于新的兼容/迁移设计，必须另行升级并申请 `000048` 起号段。

应用回滚时先停止新的 identification-preparation 冻结，再回退代码；已生成的合法 route-decision 快照和 C04 决定内容保持不变，不执行 down 或数据删除。

### D-05：文件所有权和测试只覆盖稳定行为

计划生产文件仅 `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`。测试只修改：

- `packages/adapters/test/engineering-data/cleaning/fixture.ts`：若尚未由 C19 合入，则复用其 `authorizeEvidenceAccess()` 形状提供真实 C06 `engineering-data.evidence-access` 授权；合并时只保留一份 helper。
- `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`：把宽松 `PreparationSnapshotViewV1` 替换为公共 Schema parse；在真实 PostgreSQL 上验证 route-decision、精确 reader、绑定、不可枚举、幂等审计和撤权。

现有 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 已覆盖 strict 快照和 route-decision fixture，只运行回归，不修改。core 清洗 Schema/可用性逻辑不变，只运行既有定向测试。测试不得 skip PostgreSQL、不得以内存 store/Mock 后端替代，不精确断言完整错误文案。

### D-06：spec-driven 实施切片使用四个稳定 IP-ID

本 change 没有 `implementation-plan` 工件，tasks 直接使用以下稳定映射：

| IP-ID | 设计决定 | 文件 | 完成证据 |
|---|---|---|---|
| IP-01 | D-01 | `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` | 新写 snapshot 经公共 Schema parse，决定引用均为 route-decision |
| IP-02 | D-02、D-03 | 同一 store 文件 | `readExactPreparation` 精确签名、单点绑定、授权/错误/审计闭合，C19 方法不重复 |
| IP-03 | D-05 | 两个既有 adapter 测试文件 | contracts/core 回归和真实 PostgreSQL 行为测试通过且无 skip |
| IP-04 | D-04、D-05 | 本 change 四工件与仓库门禁 | 格式、类型、lint、依赖、OpenSpec 与 diff 范围全部通过 |

## Risks / Trade-offs

- [同一版本身份同时具有 route-decision 领域类型和 content-artifact 存储类型] → 只允许在 C15 写入点做一次显式投影；内容仍由原 C04 ref/guard 访问，公开 reader 返回 route ref 而不暴露推导式读取入口。
- [C19 与本 change 都修改同一 store/test/fixture] → 按 D-03 保留两个不同目标的方法并去重 import/helper；发现同义入口或结果查询复制时停止合并。
- [历史错误行无法由新 reader 消费] → 保留不可变事实并 fail-closed；确有业务需求时用新命令重新冻结，不静默修补旧 ref。
- [授权后最小定位查询看到错误或跨工程目标] → 查询结果不外泄，随后 strict/精确范围复验；所有缺失、跨工程、撤权和绑定失败使用同一公开拒绝。
- [真实 PostgreSQL 环境不可用] → 报告环境阻塞；不得 skip、换 Mock 或把其它绿色命令当作集成证据。

## Migration Plan

1. 在实施 HEAD 复核 C19 是否已合入；按 D-03 选择复用路径，不修改其它 change。
2. 修改写入端并先让完整 snapshot 通过公共 strict Schema，再运行 contracts、core 和真实 PostgreSQL 定向回归。
3. 增加并验证 `readExactPreparation` 的授权、绑定、不可枚举、幂等和审计行为；确认无 migration、依赖或保护区 diff。
4. 本 change 验证并归档后，C17 才可删除宽松 `preparationPayloadView`/私表读取，改为消费该 reader；C24 后续只按同一精确准备引用消费，不自建查询。
5. 回滚时停止新冻结并回退应用代码，保留全部快照、决定工件、回执、审计和 Outbox；不执行数据回填或删除。
