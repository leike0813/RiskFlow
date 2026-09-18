# gap-inbox · report（P-AU，C34/C35 待定）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-AU-01（G2 契约字段）

- 缺口：`ProjectionExportRequestV1` payload 只有 `sourceRef` 与 `exportPolicyRef`，没有报告范围字段（时间窗、章节组成、空间范围）；报告导出页必须呈现这些选择项。
- 依据：`packages/contracts/src/ports/index.ts:1833-1843`；页面需求见 `demo/v2/src/pages/report/ReportExportPage.tsx` 报告范围区。
- 预设：fixture 将范围语义挂在导出策略版本 `EXP-POLICY-001 · v2026.08` 与查询结果引用 `QR-RISK-OVERVIEW-*` 上（`demo/v2/src/content/report.ts`），页面选择项为展示投影。
- 待确认：报告范围应作为 payload 字段入契约，还是由 exportPolicyRef 指向的策略版本承载；章节组成枚举（识别结果 / 评估记录 / 预警与处置 / 审计摘要）是否为合同固定章节。
- 风险：范围不入契约则导出产物无法按「范围 + 版本引用」重放校验，审计链断一环。

## GAP-AU-02（G2 契约字段）

- 缺口：导出产物只有 `ExportArtifactRefV1` 引用，产物的媒体类型、文件组成清单、失败错误码均无契约字段；导出历史的状态机（生成中 / 已完成 / 失败可重试）也无记录 schema。
- 依据：`packages/contracts/src/ports/index.ts:253-254`（ExportArtifactRefV1）、`:2304-2307`（成功结果仅 exportArtifactRef）。
- 预设：fixture 自定义 `ExportRecordView`（状态 completed / failed，失败带 errorCode 与 retryable，对齐 ModuleErrorV1 安全字段口径），产物清单按导出格式预设（`demo/v2/src/content/report.ts` EXPORT_FORMATS）。
- 待确认：导出记录与产物描述是否入契约；失败重试是否复用 TRANSIENT_FAILURE 语义。
- 风险：导出历史口径各端漂移；失败产物与空产物引用无法区分。

## GAP-AU-03（G6 规格空白 · 导出与追溯链衔接）

- 缺口：导出报告应覆盖端到端追溯链（资料段 → 风险记录 → 评估 → 预警 → 处置 → 偏差校准），但「审计摘要」章节收录哪些审计类别（人工审核 / 规则冲突 / 适用性筛除 / 版本发布 / 授权审计）未规格化。
- 依据：`demo/v2/src/content/review.ts:890-903`（审计类别五类）；页面需求见 P-AU-01 章节组成。
- 预设：报告审计摘要默认覆盖全部五类审计条目，版本引用清单随报告固化（REPORT_VERSION_REFS）。
- 待确认：甲方对报告章节与审计收录范围的要求是否以现有四类章节为准。
- 风险：交付评审时报告章节口径与甲方预期不符需返工。
