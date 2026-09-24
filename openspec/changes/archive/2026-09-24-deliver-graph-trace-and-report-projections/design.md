## Context

输入 HEAD：`1922ca9257061d83ccef4cddb4eb4771e996fd57`；实际 schema：`orchestrated-delivery`。公共契约与报告范围依据 [C31 批准记录](approval-2026-09-25-c31-public-projection-contract.md)；C30 自有最小加法迁移及索引经主调度消息 `msg_f7561b58220c` 批准，迁移序号在实施时对 main 复核。C30 已有 `ProjectionPortV1.query`、`ProjectionResultReadPortV1.readPage`、`WorkflowQueryRegistrationV1`、`workflow_graph_results/links/query_results`、C22 `RiskRecordTraceReadPortV1.readBatch` 和 C05 授权复验；`run-view`/`trace-chain` 已实现，`association-graph`/`risk-overview` 当前显式失败。C30 `listRunRows` 只按 `runId` 读取，查询登记尚未保存 `risk-overview` 的可选空间目标。

## Goals / Non-Goals

**Goals:** 按精确主题返回已成立的关联边；按工程修订和可选空间返回只读风险总览与报告事实；保留历史版本、缺席原因、证据与审计；在当前权限下有界分页，并让 C30 旧分支保持原语义。

**Non-Goals:** 文件导出/下载、风险评分或等级重算、复核/采纳/发布、图谱事实写入、前端页面、Agent 参与投影、跨模块私表读取、新角色或能力值。C40/C41 尚未闭合的全链场景仍按已成立切片报告，不以投影伪造完整链。

## Decisions

### D-01 公共结果契约只增加两个查询结果和两种事实项

保持 `ProjectionPortV1.query` 返回 `QueryResultRefV1`、`ProjectionResultReadPortV1.readPage` 的请求形状、`ProjectionPortV1.export` 和 `run-view`/`trace-chain` 结果不变。`ProjectionQueryV1Schema` 已声明 `association-graph` 与 `risk-overview` 输入，无需新增自由查询字段；`ProjectionResultReadResultV1Schema.queryType` 增加这两个判别值。`ProjectionResultItemV1` 沿用 `trace-link` 表示图边、`run-summary` 表示报告运行状态，只增加 strict `report-fact` `{workflowRunRef, factRef, auditTrailRef, evidenceLocator?}` 与 `report-absence` `{workflowRunRef, tailKind, reasonCode, lastEstablishedRef?, auditTrailRef}`。`factRef` 限定为风险记录、评估、预警、建议、偏差或校准的现有六种版本化引用；将 C30 `WorkflowSkippedTailV1` 的 tail kind 移到公共契约导出，再由 C30 引用该单一枚举。结果页上限仍为 100。报告本身就是可后续导出的数据契约，本轮不调用 `export`。

理由：图节点可由边两端精确引用导出，额外节点表会复制事实；报告按单个事实项分页，不把无限增长的引用数组塞进一行。备选的通用 JSON 报告、独立投影端口或文件产物会增加第二套契约与所有权，故不选。

### D-02 图谱按精确主题限定已成立的运行链

`association-graph` 查询登记继续复用 C30 同一 `registerQuery` 事务/审计，以主题的精确 `ContractReferenceV1`、授权摘要和登记时点固定 `QueryResultRefV1`；只有 C30 已有链边能够证明主题可见时登记成功。分页按登记时点过滤 C30 自有链边；从主题相邻边确定可见运行，并仅沿该运行及由已登记 `parent-child`/后续链边证明的关联运行扩展，按 `(recorded_at, link_id)` 排序，返回 `trace-link`。按运行集合批量取边，不按单边往返；一次图查询最多 32 个已证明关联运行、1000 条边，超过时返回 `BUSINESS_BLOCKED` 的稳定越界原因，绝不裁成伪完整图。图分页每页最多 50 条边，以保证每页涉及的标准化风险记录不超过 C22 `readBatch` 的 100 条上限；来源定位只做一批精确批读，来源资格不能证明时整页失败。图不会推断 P/C、等级或未触发边。

理由：C30 链边和 C22 窄读已是可证明关联的唯一现有来源。备选的跨领域私表联查或第二套图数据库违反所有权，也不能可靠重放。

### D-03 工程总览以冻结修订选择运行，报告逐事实分页

`risk-overview` 以输入的精确 `projectRevisionRef` 为 `targetRef`，可选 `spatialScopeRef` 单独冻结在 C30 查询登记，`queryResultVersionId` 对完整查询负载和授权摘要计算；同 `queryId` 异负载仍冲突。查询在 C30 `entry-snapshot` 的 `frozenRefs` 中匹配精确修订及可选空间，按当前权限和登记时点选择候选运行；无匹配且授权有效时返回真正空页，不把不存在目标的其他资料暴露。每个运行的最新已登记 `run-state` 和已成立 `run-result` 只从 C04 精确正文回读：输出一个 `run-summary`、已确认的风险/评估/预警/建议/偏差/校准 `report-fact`，以及 `skippedTails` 的 `report-absence`，按 `(runId, itemKind, factRef/version)` 稳定排序。后续独立运行仅在 C30 关联事实能证明与所选运行相连时纳入；无证明则不并入。每页最多 100 项，单运行事实展开另设系统硬上限，超限显式失败；不从边或计数推断风险等级。涉及风险来源定位按 C22 批读，失败不披露半份报告。

每页只展开一个运行，最多精确回读该运行的一份状态正文和一份结果正文；游标保存运行键和运行内事实排序键，允许页面少于请求上限。单运行最多展开 1000 个事实/缺席项，超限显式失败，避免跨 C04 逐行调用。理由：C30 状态/结果只有精确引用和缺席原因，足以形成可信的只读报告；C25 的评分正文没有本 change 获批的批读契约，故报告不声明 P/C 数值或等级。备选的项目级全表投影、复制评估正文和自建报表事实表均不采用。

### D-04 读取目标、权限、游标与历史快照

总览在查询及分页时将登记的 `spatialScopeRef` 传入 C05 `requestedSpatialScopeRefs`；图主题的资料资格由 C22 精确窄读与 C30 授权摘要共同证明，不凭查询引用推断权限。

`query`、每次 `readPage` 均使用 C05 对当前 actor、工程、空间和资料范围复验 `projection.query`，并按主题或修订/空间精确目标核对可见性。权限摘要与登记摘要不符、撤权、跨工程/空间、资料不可见和不存在对调用方同形为 `ENTITY_NOT_FOUND`，不返回目标、正文或存在性。游标沿用 C30 摘要格式，绑定查询精确版本、排序键与当前授权摘要；伪造/错查询为 `BUSINESS_BLOCKED`。所有 C31 读取只选登记 `recordedAt` 及之前已提交的事实，重新读 C04 正文须匹配精确结果引用；版本缺失/冲突不改选最新版。既有两分支的输入、结果和失败规则不改。日志只记低基数分支、引用、结果码和耗时，成功查询登记与审计保持同事务，审计失败不返回成功。

理由：C30 查询登记已经承担幂等和审计，读时复验能阻止历史查询在撤权后继续泄露。备选的一次授权后永续可读不满足现行权限边界。

### D-05 C30 自有持久化接缝和迁移

工程级查询不得逐个 `runId` 试探或全项目扫描。对 C30 `workflow_graph_results` 的 `entry-snapshot.frozen_refs` 增加定向 GIN 索引，对 `workflow_graph_links.from_ref/to_ref` 增加定向 GIN 索引；C30 投影 adapter 直接在自有表上以 `project_id`、精确 JSONB 引用、授权摘要及记录时点作谓词，并以 `LIMIT`/稳定键续页，不扩展面向其它模块的运行登记端口。`workflow_query_results` 加 nullable `spatial_scope_ref` JSONB 列及对象约束，C30 `WorkflowQueryRegistrationV1Schema` 同步加可选字段；旧登记行为空仍按原分支读取。新迁移位于 C30 自有 workflow 目录，由 provider 自动发现；不改 C30 已发布迁移或其它领域表，不新增业务写路径。迁移编号必须在实施开始时核对主干最新序号，冲突先升级。主调度已通过 `msg_f7561b58220c` 批准该自有最小加法迁移及索引。

理由：现有 `(project_id, run_id, …)` 索引不能按工程修订选运行，空间目标也未入查询登记。备选的全工程扫描与只凭授权摘要推断空间目标均不可靠。

### D-06 所有权、验证与依赖

`packages/contracts` 只拥有公共结果 Schema；`packages/core/src/workflow` 只拥有 C30 自有查询登记 Schema；`packages/adapters/src/workflow` 实现投影与 C30 自有查询；API 既有 `projection.query` 传输签名不改，页面 C34 消费结果。复用 Node.js 24、pnpm、Kysely、Zod 与现有 C03/C04/C05/C22/C30，不新增依赖。验证覆盖真实 PG 查询/索引、结果 Schema、101 项分页、历史时点、撤权、跨工程/空间/资料、重复查询冲突、C22 批读失败、缺席尾及 C30 旧分支回归；合成样本须标注“合成样本、待甲方复核”。

理由：在现有接缝上补齐读取，避免新增生产模块和另一套事实源。

## Risks / Trade-offs

- C30 当前 `trace-chain` 只查主题相邻边，不能代表完整图；C31 图按已证明的运行连接扩展，遇边界上限显式失败。`risk-overview` 只显示已成立引用，不提供未经公开端口验证的 P/C 或等级值。
- C40/C41 的待闭合路径可能让报告保留缺席原因；验收应按真实链路状态判定，不能把投影完整当作领域链完整。
- D-05 的索引/列迁移已获批准；若实施时迁移序号或表结构发生漂移，先升级，不得改用工程级扫描。

## Migration Plan

先确认 main 的最新迁移序号并新增一个 C30 自有加法式迁移：nullable 空间列、对象约束和定向索引；无需回填旧 `run-view`/`trace-chain` 登记。迁移、Schema、adapter 接线在同一实施任务内验证，现有查询结果引用与既有列不变。回滚只撤销本迁移新增列/索引，不改历史业务事实；生产数据回退遵守现有迁移工具与人工恢复流程。

## Open Questions

无实现阶段可自行决定的问题。
