## Context

见 [proposal.md](./proposal.md#why)。当前 `IdentificationPreparationSnapshotV1Schema` 在 `packages/contracts/src/workflows/index.ts` 中允许多个 `sourceVersionRefs`，但只有一个 `includedSourceSegmentSetRef`。`SourceSegmentSetRefV1` 是不携带所属资料版本正文的窄版本引用；所属关系由 C11 的 `SourceSegmentSetV1.sourceVersionRef` 持有。当前字段只有 contracts 定义和同包测试 fixture 使用，尚无生产调用方或持久化记录。

## Goals / Non-Goals

**Goals:**

- 让一个 I0 准备快照无损冻结多个资料版本各自纳入的资料段集合。
- 在公共 Zod Schema 中确定可直接校验的非空、等长和按索引配对规则。
- 固定 C15、C21、C24 对配对关系的所有权与消费边界。

**Non-Goals:**

- 不改变其它 DTO、端口、事件、图状态或 `IdentificationInputSnapshotV1.preparationSnapshotRef`。
- 不实现 C15 清洗、C21 检索审阅或 C24 识别图，不修改 C11 资料段集合模型。
- 不新增持久化、migration、兼容字段、依赖或版本转换器。

## Decisions

### D-01：使用两个等长数组表达单个聚合准备快照

`IdentificationPreparationSnapshotV1Schema` 将删除单数 `includedSourceSegmentSetRef`，改为：

```ts
sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
includedSourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1),
```

两个数组以相同索引配对：`includedSourceSegmentSetRefs[i]` 是 `sourceVersionRefs[i]` 的纳入资料段集合。继续保留单个 `IdentificationInputSnapshotV1.preparationSnapshotRef`，使一次运行的资料输入、排除决定、处理策略、授权和审计仍冻结在同一快照中。

备选方案是“每个资料版本一个准备快照”，但它与既有单数 `preparationSnapshotRef` 冲突，并会拆散一次 I0 的聚合决策，因此不采用。新增 `{ sourceVersionRef, segmentSetRef }[]` 配对对象虽能让关系更显式，却偏离已裁决字段形状并重复现有 `sourceVersionRefs`，也不采用。

### D-02：Schema 校验等长，C15 校验精确所属版本

`IdentificationPreparationSnapshotV1Schema` 在 strict object 上增加 `superRefine`：两数组长度不同即在 `includedSourceSegmentSetRefs` 路径产生 Zod custom issue。`.min(1)` 分别拒绝空数组；旧单数字段因缺少新必填字段且属于未知字段而被拒绝。错误文案不是公共契约，不新增错误码。

裸 `SourceSegmentSetRefV1` 只含自身 `entityId/versionId`，无法证明它属于哪个资料版本。C15 将来形成 I0 快照时必须按索引解析每个资料段集合，并比较其 `SourceSegmentSetV1.sourceVersionRef` 与配对的 `sourceVersionRefs[i]` 的 `entityId`、`versionId`；任一不存在、越权、跨工程或版本不等都在快照成立前返回既有类型化校验失败。contracts 层不读取 C11 或引入跨层依赖。

备选方案是比较两类引用自身的 `reference.versionId`，但资料段集合版本不是资料版本身份，比较它们会产生伪校验，因此不采用。

### D-03：下游只消费已验真的聚合准备快照引用

- C15 拥有资料清洗、部分可用判断以及一一对应关系的确定性收口；它生成且审计单个准备快照。
- C21 通过冻结输入取得对应资料版本与资料段集合，不选择“最新版”、不重新配对，也不把检索结果反写准备快照。
- C24 在 I0 保存单个 `IdentificationPreparationSnapshotRefV1`，在 I1 形成仍含单数 `preparationSnapshotRef` 的 `IdentificationInputSnapshotV1`；检查点继续只保存小型引用。

该变更不改变权限、事务或可观测性边界：C15 仍按准备快照现有授权上下文读取 C11 引用，快照与审计的原子性由后续 C15/C24 实现 change 闭合。本 change 只演进共享 DTO，不增加日志、指标或事件。

### D-04：实现文件所有权与追踪保持最小

- `packages/contracts/src/workflows/index.ts`：修改 `IdentificationPreparationSnapshotV1Schema`；推导类型自动同步，不手写第二套 DTO。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`：更新现有 snapshot fixture，并在同一测试中覆盖多版本等长成功、空数组/数量不等失败和旧单数字段失败。

不修改 ports、core、adapters、apps、根配置或锁文件。该契约继续追踪 RI-S1、RI-S2；其它 I/A 阶段及 RI/RA 语义保持不变。

## Risks / Trade-offs

- [平行数组可能被调用方错误排序] → 以相同索引作为规范映射，C15 在快照成立前解析并验证每一对；下游不得自行重排。
- [Zod 只能验证数量，不能验证跨资源所属关系] → contracts 负责形状，拥有读取权限和 C11 能力的 C15 负责精确版本校验，避免 contracts 反向依赖领域实现。
- [字段重命名是破坏性变更] → 当前无生产调用方和持久化数据，只更新唯一 Schema 与现有 fixture；不保留双字段兼容分支。

## Migration Plan

无需数据迁移或部署兼容层。实现时原子更新 contracts Schema 与现有测试；所有编译调用方必须改用复数数组后方可发布。若实现验证失败，回退这两个文件即可，不涉及数据库或历史记录转换。
