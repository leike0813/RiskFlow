# gap-inbox · overview（P-OV，C34/C35 待定）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-OV-01（G6 规格空白 · 投影形状）

- 缺口：`risk-overview` 查询成功结果只有 `queryResultRef` 引用，契约未定义总览投影的内容形状（KPI 计数口径、等级分布、矩阵落点集合、趋势序列选取规则均无 schema）。
- 依据：`packages/contracts/src/ports/index.ts:1787-1792`（risk-overview payload 仅 projectRevisionRef + 可选 spatialScopeRef）、`:2294-2297`（ProjectionQuerySuccessV1Schema 仅 queryResultRef）；页面需求见 `demo/v2/src/pages/overview/OverviewPage.tsx`。
- 预设：fixture 在 `demo/v2/src/content/overview.ts` 中从既有域 fixture 派生聚合（在评风险 = PENDING_RISKS 非 assessed；预警中 = WARNING_RECORDS；处置执行中 = 处置任务状态机 executing；待复核 = pendingReviewTasks），矩阵落点与等级分布按「各风险记录最新评估记录」口径。
- 待确认：risk-overview 投影的记录 schema 是否入契约（含各 KPI 口径与「最新评估」派生规则），或明确由投影层自由定义、仅保证可重放。
- 风险：各端各自实现聚合口径会出现计数不一致（如同一风险记录的首次评估与重评估被重复计数）。

## GAP-OV-02（G6 规格空白 · 趋势选取）

- 缺口：总览「关键监测指标趋势」选取哪条监测序列、时间窗多长，契约与规格均未定义；本批选取与 I 级预警触发指标一致的地表沉降序列（MON-001）。
- 依据：`packages/contracts/src/ports/index.ts` 无总览趋势相关 schema；监测序列与阈值事实源为 `demo/v2/src/content/project.ts:1006-1052`（MON-001，阈值 12.0 mm · THRESH-MON-001 v2026.08）。
- 预设：fixture 从 MON-001 快照点派生趋势，阈值线沿用序列自带监测预警阈值版本；序列选取规则（按当前最高预警等级的触发指标）待裁决。
- 待确认：总览趋势是固定若干关键指标，还是跟随当前预警触发指标动态选取。
- 风险：固定序列在工程阶段切换后失去代表性；动态选取规则不入契约则各端展示不一致。
