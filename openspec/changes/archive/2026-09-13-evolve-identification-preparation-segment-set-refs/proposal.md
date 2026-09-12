## Why

`IdentificationPreparationSnapshotV1` 允许冻结多个 `sourceVersionRefs`，却只保存一个 `includedSourceSegmentSetRef`，因此 I0 无法完整表达每个资料版本实际纳入的资料段集合，也无法可靠重放多资料版本识别输入。需要在 C15、C21 与 C24 实现前收紧该公共 DTO，避免下游围绕有损快照建立契约。

## What Changes

- **BREAKING**：将 `IdentificationPreparationSnapshotV1.includedSourceSegmentSetRef` 替换为非空数组 `includedSourceSegmentSetRefs`。
- 要求 `sourceVersionRefs` 与 `includedSourceSegmentSetRefs` 等长并按相同索引一一对应；每个资料段集合必须属于配对的精确资料版本。
- 保持 `IdentificationInputSnapshotV1.preparationSnapshotRef` 为单个引用；一次识别运行仍只冻结一个聚合全部输入版本的准备快照。
- 非目标：不修改其它 contracts 字段或工程资料登记语义，不实现 C15/C21/C24，不增加兼容字段、数据迁移、依赖、workspace 或锁文件变更。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：收紧 I0 识别准备快照中资料版本与资料段集合引用的一一对应契约。

## Impact

- 影响 `packages/contracts/src/workflows/index.ts` 中 `IdentificationPreparationSnapshotV1Schema` 及其推导类型，并更新 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的现有 DTO fixture 与边界断言。
- 当前字段除上述 contracts 定义和测试 fixture 外没有生产调用方；无需修改 core、adapters、apps 或数据库。
- 复用既有 `SourceVersionRefV1Schema` 与 `SourceSegmentSetRefV1Schema`，不新增依赖。
- 追踪 RI-S1、RI-S2：I0 对每个纳入识别的精确资料版本保留其不可变资料段集合引用。
