# gap-inbox · review（P-RV-01～P-RV-06）

> 临时 ID 规则：`GAP-RV-NN`，主代理收尾时统一编号合并进 `src/review/gap-ledger.data.json`。

## GAP-RV-01 批量确认无契约批量决定命令

- 类别：G6 规格空白
- 相关页面：P-RV-01
- 缺口：E 骨架要求「批量确认摘要条」，但契约的复核决定命令 `decide-review`（ReviewDecisionCommandV1Schema）是单复核任务语义，且 payload 内的 reviewTaskRef 与 targetRef 须逐任务精确匹配；不存在批量决定命令或批量任务引用。
- 依据：packages/contracts/src/ports/index.ts:1976-2014（ReviewDecisionCommandV1Schema 及 superRefine 的逐任务匹配约束）；demo/v2/src/pages/review/ReviewQueuePage.tsx（批量确认摘要条）
- 预设：v2 页面将批量确认呈现为「逐项提交复核决定命令」的交互（摘要条注明逐项提交与留痕），不引入批量命令。
- 待确认：是否需要契约级批量决定命令（payload 为决定数组），还是明确批量仅为界面层组织方式。
- 风险：若后续契约引入批量命令，批量摘要条的交互语义需对齐重述；仅呈现层调整。

## GAP-RV-02 业务审计条目的活动码词汇无契约枚举

- 类别：G2 契约字段
- 相关页面：P-RV-06
- 缺口：`ReviewActivityProjectionV1.activityCode` 受 ReviewActivityCodeV1Schema 限制，仅含 6 个 review/security 活动码；但 AGENTS.md §4.3 要求规则一致性冲突、适用性筛除原因、版本发布/回滚均写入审计日志，这些业务审计条目的活动码（如 knowledge.release-published、knowledge.release-rollback、assessment.rule-applicability-excluded、knowledge.rule-conflict-registered）无契约枚举载体。core 的 mapReviewActivityToDisplay 对未知活动码仅回退通用文案。
- 依据：packages/core/src/review-audit/schema.ts:141-150（ReviewActivityCodeV1Schema 枚举）；packages/core/src/review-audit/service.ts:123-133（回退文案）；demo/v2/src/content/review.ts（AUDIT_ENTRIES 的业务审计条目）
- 预设：v2 fixture 以字符串活动码呈现业务审计条目，sourceType 取 business-audit，occurred/recorded/persisted 三时点对齐投影形状；活动码词汇待契约补枚举后对齐。
- 待确认：业务审计活动码的枚举归属（复核审计模块自有枚举，或复用业务事件分类）。
- 风险：枚举落地后活动码需一次性改名，无运行时影响。

## GAP-RV-03 跨类型运行列表无投影查询载体

- 类别：G2 契约字段
- 相关页面：P-RV-05
- 缺口：P-RV-05 要求跨识别 / 评估两类运行的统一运行台账，但 ProjectionQueryPayloadV1 的 run-view 只支持按单个 workflowRunRef 查询，无按工程 / 类型列举运行的查询形状；review-audit.trace 也是单对象追溯查询。
- 依据：packages/contracts/src/ports/index.ts:1787-1814（ProjectionQueryPayloadV1 的 queryType 枚举）；demo/v2/src/pages/review/RunRecordsPage.tsx（运行列表）
- 预设：v2 页面以聚合 fixture 呈现统一台账，详情深链回归属域运行页；列表查询形状待契约补充（如 run-list queryType）。
- 待确认：跨类型运行列表查询是否进入 projection.query 的 queryType 枚举，及其筛选维度（运行类型 / 状态 / 时间窗）。
- 风险：查询形状落地前列表筛选仅为页面内过滤，语义不变。
