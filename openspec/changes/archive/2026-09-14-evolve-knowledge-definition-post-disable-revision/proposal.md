## Why

主规格“受治理定义具有稳定身份和不可变修订”要求后续修订沿发布基线形成父链，“停用和历史版本重新启用只追加新决定”又要求停用不改写历史，但没有规定唯一发布停用后继续演进应使用哪条基线。当前 C16 将修订基线绑定到 active `currentRelease`；唯一发布停用后该投影为空，提交与后续发布都会返回陈旧版本，使该定义类型永久冻结。

## What Changes

- 明确区分演进基线与运行可解析发布：已有发布历史时，后续修订必须基于命令时刻最近一次已生效的历史发布，无论该发布是否已停用；仅 active 发布可供新运行解析。
- 明确“无任何历史发布”与“最近历史发布已停用”的不同处理：已有定义但从未发布时仍不得提交无基线的第二条修订；最近历史发布已停用时允许以其精确引用继续演进。
- 明确停用后的重新发布门禁：修订基线仍须是最近历史发布，期间若已有更新发布则按陈旧版本拒绝；现有 active 发布互斥、未来时间线、人工批准、重复发布和命令幂等规则保持不变。
- 用 C16 core 行为测试和 PostgreSQL adapter 行为测试覆盖停用后提交、并发提交、重新发布、陈旧基线与重复发布边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `knowledge/governed-definition-lifecycle`: 补足发布停用后的修订基线、并发演进和重新发布语义。

## Impact

- **事实源**：修改主规格中“受治理定义具有稳定身份和不可变修订”与“发布版本按生效时间组成不可变发布集合”的行为定义；保持“停用和历史版本重新启用只追加新决定”及“运行只解析精确且当时有效的发布版本”的既有边界。
- **计划代码**：最小修改 `packages/core/src/knowledge-governance/lifecycle.ts` 与 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`，复用现有发布事实、停用决定和定义级事务锁，不增加 repository、状态字段或并行生命周期。
- **计划测试**：修改 `packages/core/test/knowledge-governance/knowledge-governance.test.ts` 与 `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`；不新建测试夹具。
- **接口与数据**：不修改 `packages/contracts/**`、公共 DTO、Schema、迁移、数据库权限、依赖或锁文件；不修改 C17/C25/C08 文件，不提交、不归档。
- **下游行为**：C17/C18/C19 继续通过既有 C16 治理命令提交精确引用；运行解析仍不回退到已停用历史发布。
