# Implementation Plan

## 1. 实施基线与权威来源

- 固定输入 HEAD：`1922ca9257061d83ccef4cddb4eb4771e996fd57`；change：`deliver-graph-trace-and-report-projections`；实际 schema：`orchestrated-delivery`。实施前对照集成 HEAD 核查同名符号、迁移号和测试命令，公共契约或迁移漂移先升级。
- 权威输入：本 change 的 `specs/domain/module-interfaces-events-workflows/spec.md`、`design.md` D-01～D-06、[公共契约批准](approval-2026-09-25-c31-public-projection-contract.md)；主规格 `domain/module-interfaces-events-workflows`、`platform/local-identity-project-authorization`、`platform/review-and-audit-runtime`、`platform/http-command-query-sse-shell` 以及识别/评估主规格。研究资料仅使用 `references/风险识别与评估规划事实源摘要.md`。
- 直接前置 C03 事务/审计/PostgreSQL、C05 授权、C22 标准化风险记录窄读、C30 运行/链边和 C04 正文已在基线；C40/C41 的全链阻断不由本 change 修改。本规划只闭合 `applyRequires` 的 proposal、specs、design、implementation-plan、tasks；verification 由最终验收 Agent 对实施检查点生成。
- 实施门：D-05 索引/空间登记迁移已获主调度 `msg_f7561b58220c` 批准；实施时须核对 main 的迁移序号与表结构。无新依赖、角色或能力值。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `ProjectionQueryV1Schema`、`ProjectionResultReadResultV1Schema`、`ProjectionResultItemV1Schema` | 按 D-01 加法扩展结果判别值及两种报告项 | 不改旧分支、不新增开放字段袋或导出接口 |
| IP-02 | `packages/core/src/workflow/schema.ts` 的 `WorkflowQueryRegistrationV1Schema`；`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 的 `registerQuery`/`readQuery` | 精确空间目标随同现有查询登记/回读，沿用同事务审计和幂等 | 不另建报表事实表、不改其它领域表 |
| IP-03 | `packages/adapters/src/workflow/postgres-workflow-projection.ts` 的 `query`、`#verify`、`#visibleTargets`、`readPage`、游标 helpers | 复用查询引用、授权复验与稳定游标；新分支固定完整负载、空间及登记时点 | 不绕过 C05、不让旧分支扩权 |
| IP-04 | 同一 adapter 的 `#linksForSubject`、`#readTraceChain`；C22 `RiskRecordTraceReadPortV1.readBatch` | 关联图只从 C30 链边和 C22 一批来源窄读展开 | 不读 C22 私表、不推断未成立节点 |
| IP-05 | 同一 adapter 的 `#runSummaries`、`#latestRunState`；C30 `workflow_graph_results`、`WorkflowGraphRunResultV1Schema`/`WorkflowSkippedTailV1Schema` | 总览在 C30 自有表上按工程修订/空间索引有界选运行，再读 C04 精确正文，输出报告事实/缺席项 | 不逐运行试探、不复制评估正文、不计算 P/C/等级 |
| IP-06 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 扩展现有稳定契约及真实 PG 回归 | 不锁定 SQL 调用顺序、文案或快照 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1 | R1/S1～S2；R2/S1～S2；R3/S3 | 修改 `packages/contracts/src/ports/index.ts` 的 `ProjectionResultReadResultV1Schema.queryType`、`ProjectionResultItemV1Schema`；修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 增加 `association-graph`/`risk-overview`、strict `report-fact`/`report-absence`，验证旧分支和未知值 | `ProjectionPortV1` 签名、能力值、旧 item 形状 |
| IP-02 | 2 | R2/S1～S2；R3/S1～S2 | 新建 `packages/adapters/src/postgres/migrations/workflow/deliver-graph-trace-and-report-projections/000051_graph_trace_report_projections.ts`（序号以实施前主干核对为准）；修改 `packages/core/src/workflow/schema.ts` 的 `WorkflowQueryRegistrationV1Schema`；修改 `packages/adapters/src/workflow/postgres-workflow-adapter.ts` 的 `registerQuery`/`readQuery`；修改 `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 加空间引用 nullable 列和定向索引，登记与回读保留精确空间，旧行仍解析 | C30 原迁移、业务写入、其它模块表 |
| IP-03 | 3 | R2/S1～S2；R3/S1～S3 | 修改 `packages/adapters/src/workflow/postgres-workflow-projection.ts` 的 `#verify`、`query`、`readPage` 与游标处理；修改 `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 新分支登记完整负载、空总览成功、每页 C05 复验、历史截点、同键异负载冲突、稳定分页；旧分支保持原行为 | HTTP/SSE 传输签名、旧 query 分支语义 |
| IP-04 | 4 | R1/S1～S2；R3/S1～S2 | 修改 `packages/adapters/src/workflow/postgres-workflow-projection.ts` 的链边选择与图分页；扩展 `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 精确主题→已证明运行关系→有界图边；C22 单批来源补齐；无法证明/越界失败 | 领域记录写入、无证据边、P/C/等级 |
| IP-05 | 5 | R2/S1～S2；R3/S1～S2 | 修改 `packages/adapters/src/workflow/postgres-workflow-projection.ts` 的 C30 自有表工程修订选择与 C04 结果展开；扩展 `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 按修订/空间索引和稳定键有界取运行；从精确状态/结果输出 run-summary、report-fact、report-absence，稳定游标与空结果 | 无界全工程扫、正文复制、导出文件 |
| IP-06 | 6 | R1/S1～S2；R2/S1～S2；R3/S1～S3 | 扩展 `packages/adapters/test/postgres/postgres-foundation.test.ts`（仅迁移/角色证据需要时）；复用上述两项 adapter 测试 | 真实 PG 查询计划/上限、迁移发现与最小角色、撤权/伪游标/历史重放及旧分支回归 | 临时 Mock 结果充当完成证据 |

## 4. 调用与副作用顺序

1. `query` 先 strict 解析，再用 C05 按目标工程、主题或修订/空间复验当前 `projection.query`；图分支要求精确主题有可见已成立边，工程总览在合法授权下允许空结果。授权失败与不可见目标同形。
2. 对新分支计算完整负载与授权摘要；沿 C30 `registerQuery` 在同一事务登记查询、幂等身份和只追加审计。重复同负载返回原 `QueryResultRefV1`，异负载稳定冲突；审计/事务失败不返回成功。不发布领域事件。
3. `readPage` 先回读精确查询登记，再复验当前 C05 与冻结空间/资料范围、对账授权摘要和游标；只读登记时点及之前的 C30 事实。图使用已证明链边；报告每页只展开一个修订/空间选出的运行，最多读取其一份 C04 状态正文和一份结果正文，游标记录运行与内部事实键。一次页面最多 100 项和一批 C22 来源回读。
4. 任一来源无权/不可证明、C04 正文错版本、边界超限或游标失效时返回类型化错误，不披露半页；不重试权限/版本冲突，不改选最新版。`run-view`/`trace-chain` 旧路径保持原读写与错误语义。

## 5. Schema、状态与持久化落实

- 公共 SSOT 为 `packages/contracts/src/ports/index.ts`；C30 自有登记为 `packages/core/src/workflow/schema.ts`；报告项只含引用、缺席原因和允许的证据定位，不引入第二份风险事件或等级字段。图谱两端 ref 即节点，关系沿 `WorkflowLinkRelationV1Schema`。
- 查询登记的新可选空间字段在新迁移中落 `workflow_query_results.spatial_scope_ref`；旧行 `NULL` 只适用于原分支。C30 投影 adapter 在自有 `workflow_graph_results.frozen_refs` 上以 JSONB 精确引用和定向索引筛选工程修订/空间；主题相邻边使用 `workflow_graph_links.from_ref/to_ref` 定向索引，不扩展其它模块可调用的运行登记端口。`project_id`、授权摘要、记录时点、排序键、`LIMIT` 必须进入数据库查询；不得把全集读到 JS 再过滤。
- 图谱及报告读不改 LangGraph 状态/业务事实；C30 查询登记仍是唯一写入且带审计的事务单元。报告单运行事实展开上限 1000 项，页面最多两次 C04 精确正文回读；输出必须有已成立的版本/审计引用，缺席原因只读 C30 `skippedTails`。
- 新迁移候选序号 `000051`，实施前核对 provider 发现顺序和并行集成；序号被占用时先升级。回滚/重跑验证新增列和索引，既有查询历史与领域事实不回填、不覆盖。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| R1/S1 获权主题关联图 | IP-01,03,04,06 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 真实 PG、C30 多阶段边、C22 合成来源 | 精确关系/版本/审计/允许定位，多页后完整 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| R1/S2 缺席与不可证明 | IP-04,06 | 同上 | 无触发尾、C22 失败、边越界 | 最后成立事实或稳定不完整失败，无占位与推断等级 | 同上 |
| R2/S1 同修订报告 | IP-01,02,03,05,06 | 同上及 `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 同修订多运行、两空间、历史发布后新记录 | 稳定排序、精确引用、缺席项、历史截点不漂移 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` |
| R2/S2 无风险或无后续 | IP-03,05,06 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 空修订、只有风险/评估的合成运行 | 空页或已成立项及原因，无默认等级 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| R3/S1 撤权后不可读 | IP-02,03,06 | 同上 | 查询后撤销 C05 授权、跨工程/空间/资料 | 与不存在同形，零敏感数据 | 同上 |
| R3/S2 有界与伪游标 | IP-02,03,04,05,06 | 同上及 `packages/adapters/test/postgres/postgres-foundation.test.ts` | 101 项、错误游标、真实 PG 索引 | 稳定续页或显式越界，查询有 `LIMIT` 和索引，不全库扫描 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` |
| R3/S3 旧/未知分支 | IP-01,03,06 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` 及 projection test | C30 原 fixture、未知判别值 | run-view/trace-chain 原行为，未知稳定拒绝 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |

模块门禁：`pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm format:check`、`pnpm openspec:validate`。合成样本标记“合成样本、待甲方复核”；测试输出需保留版本、授权、查询结果、游标、审计及缺席/失败引用，不能只断言文件存在。

## 7. 文件清单与升级条件

新增：本 change 的五项规划工件、批准记录与 delta spec；实施期候选迁移 `packages/adapters/src/postgres/migrations/workflow/deliver-graph-trace-and-report-projections/000051_graph_trace_report_projections.ts`。修改：`packages/contracts/src/ports/index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/core/src/workflow/schema.ts`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts`、`packages/adapters/src/workflow/postgres-workflow-projection.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`；仅确需迁移证据时修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`。删除：无。保护：C30 旧迁移、C22/C25～C29 写路径、C05 策略、C04 事实、API/SSE 入口、`pnpm-lock.yaml`、OpenSpec 主规格和 `verification.md`（收尾前）。

若需计划外公共字段/接口、权限能力、领域私表、额外持久化/迁移/依赖、正式 P/C/等级正文、文件导出或改变 C30 旧分支，立即升级；若迁移序号或表结构漂移、任何验证命令不存在或 C40/C41 阻断导致场景不能真实成立，也先升级，不用 Mock、全表扫描或部分结果冒充完成。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在本计划列出的生产文件、测试和已批准迁移内修复普通缺陷、回归并生成 `verification.md`；不得改变 D-01～D-06 的公共语义或借验收实现导出、等级计算和新权限。对 C05 撤权/空间过滤、C30 查询登记审计事务或迁移/索引语义发生疑义时标注限定审计风险，审计结论补同一 verification。Finalizer 必须以真实 PG、公开端口和最终 HEAD 的证据判定每个场景，C40/C41 未闭合时保留对应 BLOCKED/缺席结论。
