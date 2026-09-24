# C31 公共投影契约与报告范围批准

- 批准人：主调度。
- 批准日期：2026-09-25。
- 工作项：C31 `deliver-graph-trace-and-report-projections`。
- 批准依据：本 Planning Task 对公共契约及报告导出边界的升级与主调度回复。

## 批准事项

1. 对 C30 的 `ProjectionQueryV1`、`ProjectionResultReadResultV1Schema.queryType`、`ProjectionResultItemV1` 做最小加法式扩展，所有权仍属 C30。既有 `run-view`、`trace-chain` 的语义和权限保持不变；未知查询类型稳定失败。沿用 C05 当前授权校验、C30 查询登记/有界分页/审计，结果可由已成立事实重放，不建立新的领域写入路径。
2. C31 的报告范围仅为只读投影。投影结果可作为后续导出的数据契约，但本 change 不实现 `ProjectionPortV1.export` 的文件产物、落盘或下载管线。

## 实施约束

报告只取可证明的精确版本引用和当前获准摘要；不得从关联边推断风险等级，不得为缺席链尾补造事实。若实际实现需要超出上述加法式 Schema、现有权限、持久化或迁移边界，先升级主调度。
