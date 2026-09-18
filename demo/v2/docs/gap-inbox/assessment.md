# 缺口收件箱：assessment（P-RA，C34）

> M4 第一批 assessment 域实现期间新发现的缺口提案。每条五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。临时 ID 待主代理统一编号合并。

## GAP-RA-01 评估记录「入口类别」呈现与 contracts `kind` 字段语义冲突

- 缺口：批次任务要求评估记录 fixture 含 `kind`（initial|reassessment|historical-backfill），但 contracts 中 `RiskAssessmentRecordSchema` 的 `kind` 是风险输入判别字段（`standardized-risk-record` / `external-risk-event`），入口模式只存在于 `AssessmentPreparationSnapshotV1.entryMode`（取值 `assess` / `reassess` / `historical-backfill`）。记录本身不存储入口类别。
- 依据：`packages/contracts/src/records/index.ts:171-225`（kind 判别联合）；`packages/contracts/src/workflows/index.ts:125-142`（entryMode 在准备快照）；`packages/contracts/src/ports/index.ts:945-954`（WorkflowEntryModeV1 取值）。
- 预设：页面（P-RA-04/05/07）以产生该记录的评估运行 entryMode 展示入口类别，fixture 沿用 contracts 的 `kind` 判别字段，不新增存储字段；fixture 中的 `entryMode` 仅为投影层派生展示。
- 待确认：C34 是否需要在评估记录的查询投影（projection.query）中固化 entryMode 派生字段，避免每个消费方自行回联运行。
- 风险：仅投影层展示口径问题，无契约变更风险；若消费方各自回联，口径可能漂移。

## GAP-RA-02 逐指标 P/C 归属无契约字段

- 缺口：批次要点要求「P 与 C 的归属明确」，但 `IndicatorResultSchema` 不含归属字段；某指标计入 `likelihoodScore` 还是 `consequenceScore` 由指标体系 / 评分规则定义，评估记录上不体现。
- 依据：`packages/contracts/src/records/index.ts:187-195`（IndicatorResult 字段集）；`packages/contracts/src/records/index.ts:207-208`（likelihood / consequence 分列但无逐指标归属）。
- 预设：v2 以指标体系 fixture 的 side 元数据（`INDICATOR_ITEMS`）呈现归属列，页面按 indicatorItem 查归属，不在评估记录上重复存储。
- 待确认：C34 指标体系 schema 是否固化每个指标项的 P/C 归属字段（单一事实源），以及归属变更是否随指标体系版本演进。
- 风险：低；若归属规则散在各规则集，可能出现同一指标在不同规则集中归属不一致。

## GAP-RA-03 数值得分到矩阵刻度落点的分带规则无契约载体

- 缺口：`likelihoodScore` / `consequenceScore` 是有限数值，矩阵落点（P1–P5 / C1–C5 刻度）需要分带映射；该映射规则在风险矩阵版本配置中没有契约字段承载。
- 依据：`packages/contracts/src/records/index.ts:204-217`（评估记录只存数值与等级）；`demo/v2/src/charts/RiskMatrixChart.tsx:30-52`（落点须为刻度取值）。
- 预设：v2 由评估记录 fixture 直接给出落点刻度取值（`matrixPlot`），页面不做分带计算；等级经矩阵版本 cellLevels 查表得出（数据驱动）。
- 待确认：分带规则是否应作为风险矩阵版本配置的一部分（如每轴边界数组），由 A4 确定性评分阶段执行并随记录入审计。
- 风险：若生产端改由展示层分带，各页面可能各自实现而漂移；落入矩阵版本配置可消除。
