## Why

C15 已归档的识别准备写入把覆盖决定与排除决定的 C04 内容工件引用直接放入 `IdentificationPreparationSnapshotV1`，但公共 strict Schema 要求 `RouteDecisionRefV1`，因此已提交的 `snapshot_payload` 无法按契约解析。该 drift 已阻断 C17 以正式接口消费清洗准备，也会使 C24 无法可靠冻结 I0→I1 的单一准备快照引用，必须在恢复 C17 实现前独立修正。

## What Changes

- 保持 `IdentificationPreparationSnapshotV1Schema` 不变，在 C15 写入端把覆盖/排除内容工件的精确版本身份投影为 strict `route-decision` 引用，并在持久化前以公共 Schema 校验完整准备快照。
- 在 `PostgresDataCleaningStore` 提供按精确 `IdentificationPreparationSnapshotRefV1` 读取准备快照及其绑定清洗结果的窄接口；读取执行当前授权复验、不可枚举失败、幂等回执与只追加审计，不提供列表、搜索、“最新值”或正文旁路。
- 扩展现有 C15 PostgreSQL 行为测试，证明真实数据库中的准备 payload 可由公共 Schema 解析、决定引用类型正确、精确读取受权且可审计，并覆盖缺失/跨工程/撤权/绑定失配与重放边界。
- 与 C19 分支已经实现的 task-ref `readBoundResult` 合并时保留其签名；本 change 的 preparation-ref 读取复用同一私有绑定结果读取逻辑，不建立第二个同义的清洗结果入口。

### Non-goals

- 不修改其它清洗候选、排除、可用性、任务、冻结、幂等或事件语义，不改变识别/评估业务规则。
- 不修改 `packages/contracts` 既有 Schema、apps、其它模块生产代码、既有 migration、migration provider/runner、中央迁移注册与测试清单、根 workspace、锁文件、依赖政策、`openspec/config.yaml`、主 specs 正文或其它 change。
- 不新增依赖；不新增 migration。若实现证明现有 `000016` 列无法承载精确读取，必须停止并先申请 `000048` 起的号段，不得在本 change 内自行扩大范围。
- 不原地改写已落库的不可变历史 payload，不增加读时宽松兼容或一次性修复脚本。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `data/agent-cleaning-and-partial-availability`: 明确识别准备中的覆盖/排除决定必须是可由公共快照 Schema 解析的 strict `route-decision` 引用，并补齐按精确准备引用受权复读正式清洗结果的窄边界。

## Impact

- **生产代码**：仅涉及 `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`；复用 `000016` 已有 `snapshot_payload`、`agent_task_ref`、`cleaning_result_artifact_ref` 与现有 C04/C03/C06 接缝。
- **测试**：扩展 `packages/adapters/test/engineering-data/cleaning/fixture.ts` 和 `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`；现有 contracts 测试已证明目标 Schema 只接受 `route-decision`，无需修改。
- **消费者**：C17 通过 preparation-ref 窄读取得 strict 准备、绑定清洗结果和决定引用，不再读取 C15 私表或使用宽松 payload view；C24 继续只冻结单一 `preparationSnapshotRef`，需要展开 I0 准备时使用同一精确读取边界。C19 继续按 task ref 使用其既有 `readBoundResult`。
- **依赖与迁移**：无新增/升级依赖，无数据库迁移、回填或历史覆盖。
