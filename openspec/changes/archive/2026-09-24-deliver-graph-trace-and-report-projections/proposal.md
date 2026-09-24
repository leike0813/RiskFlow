## Why

C30 已保存父子运行与相邻追溯边，但查询只开放运行视图和单主题链路；关联图、工程风险总览与可交付报告尚不能从这些已成立事实取得。C31 在固定基线 `1922ca9257061d83ccef4cddb4eb4771e996fd57` 上补齐只读投影，使获权人员能检查 RI-S1～RI-S6、RA-S1～RA-S7 的版本化链路，同时保留缺席和不可证明的边界。

## What Changes

- 实现既有 `association-graph` 与 `risk-overview` 查询分支，从 C30 自有运行/链边登记和上游公开窄读组合有界、可重建的图谱、追溯与汇总结果。
- 加法式扩展 C30 `ProjectionResultReadPortV1` 的结果判别值和最小展示项；查询登记、当前授权复验、稳定分页和只追加审计沿用既有机制。
- 以已成立的精确版本、证据定位和审计引用形成只读报告投影；不从关联边推断未获证实的风险等级，也不补造未触发的链尾。
- 对无权、跨工程/空间/资料、来源不可证明、伪游标和历史版本重放给出安全且可验证的收口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：增加 C31 关联图、风险总览及报告投影的有界读取、重放和缺席语义。

## Impact

- 预计修改 `packages/contracts/src/ports/index.ts`、`packages/adapters/src/workflow/postgres-workflow-projection.ts` 及其现有测试；复用 C30 登记表、链边和 C22 批量追溯端口，具体文件与符号由施工图固定。
- 不新增角色、能力值、运行时依赖或导出文件管线；领域风险记录、评估、预警、建议和审计仍由原模块拥有。公共结果加法扩展与只读报告范围依据本 change 的批准记录。
