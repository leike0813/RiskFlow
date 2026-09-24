# C30 收尾轮批准记录（2026-09-23：评估依据解析与两个分段入口的受限加法）

- 批准引用：`approval://riskflow/C30/finalization-2026-09-23-assessment-basis-residual`
- 批准来源：项目方在本会话指示「C30 实现似乎已完成，有一个阻塞项，建议让 validator 一并处理」。本记录取代 `approval-2026-09-23-assessment-and-riskflow-graphs.md` 中未覆盖的该残差口径，其余条款继续有效。
- 事实依据（实现 worker 报告 + 定位复核）：
  1. 评估图 A0/A1/A2/A3/A4/A7 与 `entryRefsOf` 统一用 `requiredFrozenRef(kind='assessment-basis-release-set')` 取评估依据集合；取不到即 `ENTRY_REFERENCES_INCOMPLETE`。
  2. 公共启动载荷里只有 `historical-backfill` 携带 `assessmentBasisReleaseSetRef`；`assess` / `reassess` / `forecast-response` / `record-response-feedback` 无该字段。
  3. 既有只读分支 `EngineeringDataQueryV1` 仅 `source-segments` / `monitoring-snapshot` / `evidence-access` 三种，无法读评估输入快照（已在 `packages/contracts/src/ports/index.ts:997-1015` 复核）。
  4. `forecast-response` / `record-response-feedback` 的冻结输入只有 `adoptedRecommendationRef` / `preActionMonitoringSnapshotRef` 与 `executionRecordRef` / `feedbackRef`，因此无法取得 `{preparationSnapshotRef, requiredAt}` 去解析依据集合。
- worker 已自行闭环的部分（**批准**，属已批准行为的实现不完整，不是范围变更）：为 `AssessmentGraphPortsV1` 增加注入端口 `basisResolver`（与 C24 识别图同形，复用 `KnowledgeModelingPortV1.resolve` 的 `assessment-basis` 分支），A0 不再强制要求冻结依据引用；A1/A2/A3/A4/A7 与 `runtimePoliciesFor` 改为「有冻结引用则用，否则按冻结评估准备快照 + `requiredAt` 解析」，结果确定性可重放；`identify-and-assess` / `assess` / `reassess` / `historical-backfill` 全链可达。不得改公共契约、spec/design、依赖或迁移。

## 对残差的裁决：允许一次性、受限的公共契约加法

- **允许**：在 `packages/contracts/src/ports/index.ts`（C30 实施计划 IP-01 已允许文件）为 `forecast-response` 与 `record-response-feedback` 两个分段入口载荷增加**可选** `assessmentBasisReleaseSetRef?: AssessmentBasisReleaseSetRefV1Schema`。
- **门禁语义**：该字段缺失时，两入口必须在产生任何副作用之前以既有 `ENTRY_REFERENCES_INCOMPLETE` 稳定失败，**不得**推断、回退到「当前发布集」或在运行时解析最新值（维持 delta spec R3）。
- **同步修订（同一 change 内）**：delta spec R1 的字段清单与相关 Scenario、`design.md` 的 D-01 载荷表格、`implementation-plan.md` §3 允许文件清单与对应 IP-ID 行。修订只记录上述加法与门禁，不重写其它结论。
- **禁止**：新增 `EngineeringDataQueryV1` 查询分支或任何新 capability/角色/权限值；改动 C22/C24 的写路径、migration、已归档规格；改动权重/矩阵/阈值/措施库；引入生产运行时依赖；修改本轮已通过的门禁与测试基线以外的范围。
- **验证要求**：两入口各补一条「带冻结依据引用成功、缺失即安全失败」的行为测试（真实 PostgreSQL 切片按既有范式），并复跑 `pnpm typecheck / lint / build / format:check / deps:check / deps:policy / openspec:validate` 与 C30 相关全链验收。
- **收尾职责**：本轮由 Finalizer 在自身活动 Task 内完成上述加法、回归与 `verification.md`（按 change 实际 schema）；同一收尾轮次最多一次限定审计，不得为同一收尾重复派发 Finalizer。
