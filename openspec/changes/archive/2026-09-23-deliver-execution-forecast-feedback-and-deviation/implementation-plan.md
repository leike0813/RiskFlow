# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base：`07d1a599ae91be781c490090dad2e8a77dc2f625`。实施前运行 `git rev-parse HEAD && git status --short`；只允许本 change 规划工件，HEAD 漂移或出现其它改动立即升级。
- 实际 schema：`orchestrated-delivery`；`applyRequires=proposal,specs,design,implementation-plan,tasks`。Implementation 必须运行 `openspec instructions apply --change deliver-execution-forecast-feedback-and-deviation --json` 并完整读取全部 `contextFiles`，不得创建 `verification.md`。
- 领域依据：本 change [delta spec](specs/domain/execution-forecast-feedback-and-deviation/spec.md) 与 [design](design.md)；直接依赖为 C07、C14、C25、C27，代码还复用 C03/C04/C06/C18/C19 已归档接缝。研究资料只由 Planning 读取指定摘要，Implementation 不再解释研究原文。
- 预置事实：C14 `MonitoringSnapshotV1` 与受权读取已落地；C18/C19 的 forecast/deviation/risk-matrix 发布和精确成员读取已落地；C25 评估记录/输入快照、C27 正式建议和 `000045` 已落地；公共执行/反馈命令和输入快照已声明。基线没有 workflow-run/route-decision store，C28 不补建。
- 已批准边界：协调者批准 C28 自有 `000046` 与私有窄服务；真实 route/run ref 由 C30 注入。C28 禁止生成公共 `DeviationRecord`，只形成 C29 可精确读取的私有偏差事实。
- 硬门：确认 `000046` 空闲；C27 建议行仍含精确评估/空间/措施链；C25/C14/C19/C04 的窄读取与 Schema 可按本计划使用；C03 receipt/audit/event 事务仍允许 C28 五类表加入。任一不成立先升级。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01, IP-03 | `packages/adapters/src/recommendation/postgres-recommendation-adapter.ts` 的 `business.response_recommendations` 投影；`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 的评估/输入快照投影 | C28 adapter 只按精确建议、评估和快照引用读取，经 C06 授权后组装 D-03 窄上下文 | 不更新或重建 C25/C27 事实，不读取 latest |
| IP-03, IP-05, IP-07 | `AssessmentMonitoringReaderV1`、`PostgresMonitoringStoreV1.readSnapshot` | 读取 C14 精确执行前/后监测快照及证据，复用既有查询审计 | 不直读持续流、不自行选择序列或 cutoff |
| IP-03, IP-05, IP-08 | `AssessmentBasisReleaseSetReaderV1`、`ArtifactStoreV1`、`ForecastPolicyDocumentV1Schema`、`DeviationPolicyDocumentV1Schema`、`RiskMatrixDocumentV1Schema` | 从 C25 冻结 basis 解析 C18 精确成员正文与摘要 | 不复制 C18/C19 表、不内联策略或矩阵 |
| IP-02, IP-08 | `packages/core/src/assessment-config/decimal.ts` 的 canonical decimal 与 bigint 运算；`packages/core/src/risk-assessment/engine/decimal.ts` 的有限 number 转换 | 复用解析、比较、舍入和展示转换；仅补 D-07 所需 abs 与交叉乘法 | 不用二进制浮点决定阈值，不建第二套通用 decimal 库 |
| IP-04, IP-09 | `WarningResponseRecordCommandV1Schema`、`MODULE_BRANCH_CAPABILITY_V1`、`LocalIdentityAccessV1` | 公共命令严格解析，使用既有 branch/capability 和当前主体 | 不新增 capability、角色或公共 DTO |
| IP-09 | `TransactionUnitV1`、`DomainEventV1Schema`、C03 command receipts / audit / outbox | 每个事实与回执、审计同事务；反馈复用 `warning.feedback-recorded.v1` | 不建私有 receipt/audit/outbox 或新公共事件 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 建正式纵向 fixture 与实施硬门 | 全部 Requirement；权限/事务前置 | 新增 `packages/adapters/test/response-lifecycle/fixture.ts` | 复用真实 C14/C25/C27/C19/C18/C03/C06/C07 迁移和服务，准备两个工程、两个空间、已采纳/拒绝建议、执行前后快照、actual assessment、正式/缺失预测执行器与失败注入 | 不 seed 生产默认预测、公共偏差或 workflow store |
| IP-02 | 私有 Schema、引用和偏差纯函数 | “偏差事实按冻结策略确定性计算”的三个 Scenario；“C29 可按稳定引用组合”的字段完整性 | 新增 `packages/core/src/response-lifecycle/schema.ts`、`service.ts::calculateResponseDeviation` | 落实 D-02/D-07 strict DTO、私有 fact ref、三种公式、严格越限、方向、六位 relative 展示值和输出校验 | 不调用 `DeviationRecordSchema`，不含校准/审核字段 |
| IP-03 | 上游精确上下文与配置读取 | “效果预测冻结…”两个 Scenario；“反馈只消费…”时间/链校验；所有版本/授权失败 | 新增 `packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts::PostgresResponseLifecycleContextReader` | D-03 先授权，精确读 C27→C25、C14 snapshot、C19 basis、C04 C18 文档；核对工程/空间/风险输入/单位/时域/digest | 不修改上游表、不猜指标/版本、不泄露目标 |
| IP-04 | 人工决定与 workflow binding | “人工决定与预测工作流保持独立所有权”的三个 Scenario | `packages/core/src/response-lifecycle/schema.ts::VerifiedResponseWorkflowBindingV1Schema`；adapter `recordDecision` | 解析公共 adoption 命令，验证 C30 binding、正式建议与终局决定；同一建议版本唯一；拒绝不建预测 | 不生成 route/run ref，不实现状态机或现场执行 |
| IP-05 | 版本化效果预测 | “效果预测冻结…”两个 Scenario；“三类预测方法…”两个 Scenario | `packages/core/src/response-lifecycle/service.ts::EffectForecastExecutorV1`、`ResponseLifecycleServiceV1.forecastResponse`；adapter 同名方法 | 严格消费公共预测快照和 C18 policy；执行器必须匹配 method/requiredRef；校验目标/单位/时域/风险状态/证据；available/unavailable 均耐久且幂等 | 不调用 Agent、换模型/方法、补默认值或把 synthetic fixture 用于生产 |
| IP-06 | 两类现场执行 | “现场执行区分…”三个 Scenario | `ResponseLifecycleServiceV1.recordExecution`；adapter 同名方法 | 对 adopted source 读取唯一采纳决定；对 independent source 校验精确措施发布；保存主体、时空和证据 | 不产生建议/采纳/预测，不关闭 C26 任务或解除风险 |
| IP-07 | 执行后反馈与既有事件 | “反馈只消费…”两个 Scenario | `ResponseLifecycleServiceV1.recordFeedback`；adapter 同名方法 | 接收公共 feedback 命令和 C30 产生的 C25 actual assessment ref；校验 cutoff/occurredAt、风险输入/空间/basis；原子保存反馈并发布既有 feedback event | 不在 C28 编排 C25、不复制工件正文、不改历史事实 |
| IP-08 | 私有偏差事实与 C29 窄读 | “偏差事实…”三个 Scenario；“C29 可按稳定引用…”两个 Scenario | `ResponseLifecycleServiceV1.calculateDeviation`、`ResponseDeviationFactReaderV1.readDeviationFact`；adapter 同名实现 | 按 effect forecast + feedback + frozen basis 运行 IP-02；保存唯一私有 fact；受权精确读取完整组合输入 | 不返回公共 deviation success/ref，不提供列表/latest，不创建 C29 事实 |
| IP-09 | `000046` 与五类原子写 | 权限/幂等/事务三个 Scenario；全部成功路径 | 新增 `packages/adapters/src/postgres/migrations/warning-response/deliver-execution-forecast-feedback-and-deviation/000046_execution_forecast_feedback_deviation.ts::up/down`；adapter C03 commit helpers | 按 D-09 建五表、FK/check/unique/grant/down；业务事实、receipt、audit 及 feedback event 原子提交；数据库收口并发 | 不改旧迁移、中央 fixture、权限映射或新建公共事件 |
| IP-10 | 稳定行为测试与包导出 | 全部 20 个 Scenario | 新增 `packages/core/test/response-lifecycle/response-lifecycle.test.ts`、`packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`、core/adapters `index.ts`；修改两个 `package.json` | core 表格覆盖公式/Schema；PG 纵向覆盖决定、预测、执行、反馈、偏差 reader、授权、重试、并发、回滚；仅增加 `./response-lifecycle` 导出 | 不改 contracts/API/worker/web，不锁定文案/SQL/内部调用顺序 |
| IP-11 | 范围与工具验证 | 全部 | 本 change 工件与 IP-01～IP-10 文件 | 跑 §6/§7 命令、核对 dirty paths 和 diff；行为与证据完成后才勾 tasks | 不创建 verification、提交、归档或启动服务 |

## 4. 调用与副作用顺序

1. `recordDecision`：公共 command parse → C06 当前 `warning-response.adopt-recommendation` 授权 → D-03 精确建议/空间/三项通过链 → D-04 C30 binding 对账 → C03 事务插入终局决定、audit、receipt。`declined` 到此结束；相同建议的第二个不同决定返回冲突。
2. `forecastResponse`：私有 command 与公共 `ResponseForecastInputSnapshotV1` parse → 继承且不扩大 C30 授权 → 精确 adopted 决定/C27 建议/C25 input/basis → C14 pre-action snapshot → C19/C04 forecast policy → 验证目标/单位/时域/requiredRef → D-05 executor。成功或 unavailable outcome、audit、receipt 在 C03 事务原子保存；执行器失败不重试换版本。
3. `recordExecution`：公共 command parse → C06 对应 execution branch → adopted source 校验唯一决定，或 independent source 校验 C19/C04 精确措施发布 → 时间/主体/证据校验 → C03 原子插 execution、audit、receipt。无事件、无任务关闭。
4. `recordFeedback`：公共 command parse → C06 feedback branch → 精确 execution → C14 post snapshot/C04 feedback artifact → C30 提供的 C25 actual assessment → 风险输入/空间/basis/时间一致性 → 解析 forecast availability → C03 原子插 feedback、audit、receipt 和 `warning.feedback-recorded.v1`。事件只带 execution/feedback refs 及 forecast union。
5. `calculateDeviation`：公共 command parse → C06 deviation branch → exact available forecast/feedback/frozen basis → D-03 deviation policy/risk matrix → IP-02 纯计算 → C03 原子插 private fact、audit、receipt。无 forecast 返回 unavailable 且不插 fact；成功返回私有 C28 result，公共适配由 C29 后续完成。
6. `readDeviationFact`：C06 当前主体/工程/空间授权与读取幂等身份 → 精确 private ref → strict payload/digest/FK 对账 → 返回完整 C29 输入。目标缺失与无权同形，不重算旧偏差。

任何步骤在业务提交前失败均不写成功 audit/receipt；事务中任一 member 失败整体回滚。相同命令先复验当前主体，再复用 C03 原结果，避免不同主体借用已有幂等结果。

## 5. Schema、状态与持久化落实

- SSOT：公共命令/引用/输入快照/事件/RiskState 只从 `@riskflow/contracts` 导入；forecast/deviation/risk-matrix 文档只从 C18 Schema 导入；C28 私有 DTO 只在 `@riskflow/core/response-lifecycle` 导出。
- 决定状态：`undecided → adopted | declined`，终局且不可反转；新决定只能针对新建议版本。workflow run 生命周期不进入 C28。
- 预测状态：每个冻结输入只有 `available(effectForecastRef)` 或 `unavailable(reasonCode)`；结果不可原地重算。新快照/策略/执行器形成新输入与结果。
- 执行/反馈状态：execution 只追加；每个 execution 可有多个不同业务时点 feedback，但同一规范输入唯一。feedback 保存 C25 actual assessment，不自行算 P/C。
- 偏差状态：只有 available forecast + compatible feedback 才有 private fact；每个 forecast/feedback/deviation-policy 唯一。C29 后续引用不改变事实。
- 五表列与约束按 D-09；payload 均 strict parse 且 digest 对账，FK 连接建议、评估、快照、工件、receipt/audit。角色只获 SELECT/INSERT；无 UPDATE/DELETE。
- 权限、错误、事务、事件按 D-08；不新增依赖。`000046` 的目录/文件名和全局序号必须由 provider discovery 测试证明，中央显式 fixture 由主调度处理。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 人工决定 / 采纳、拒绝、虚假运行引用 | IP-01, IP-03, IP-04, IP-09, IP-10 | adapter test | C27 合格建议；真实/错配 C30 binding | 终局决定唯一；采纳无执行；拒绝无预测；C28 不生成 run | `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| 预测冻结 / 完整输入、依据不完整 | IP-03, IP-05, IP-09, IP-10 | adapter test | C14 pre snapshot、C25 basis、C18 forecast policy | 精确 refs/digest；发布变化不改旧结果；缺失为 unavailable | 同上 |
| 三类预测 / 正式结果、非法执行器结果 | IP-02, IP-05, IP-10 | core + adapter test | 三种 method 的确定性 synthetic fixture 与错 ref/单位结果 | available 可重放；错版本/NaN/证据缺失不落正式预测 | `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| 现场执行 / adopted、independent、伪造来源 | IP-03, IP-06, IP-09, IP-10 | adapter test | 采纳/拒绝决定、精确措施发布、双 actor | 两来源闭合；主体/来源错配不可枚举；无任务关闭 | `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| 反馈 / 完整事实、时间或评估链错配 | IP-03, IP-07, IP-09, IP-10 | adapter test | post snapshot、反馈工件、C25 actual assessment | 仅完整链入库；feedback event 精确 available/unavailable；失败零部分事实 | 同上 |
| 偏差 / 三策略边界、无预测、禁止公共记录 | IP-02, IP-03, IP-08, IP-09, IP-10 | core + adapter test | absolute/relative/risk-level-step 边界、missing forecast | exact 值/方向/strict `>`；无预测无 fact；公共 deviation 表/Schema 不被调用 | `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| C29 组合 / 精确读取、后续不改旧事实 | IP-08, IP-09, IP-10 | adapter test | 私有 fact 与授权 reader | 返回全部组合字段；错工程/版本拒绝；无列表/latest/update | `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| 权限幂等事务 / 无权、重试并发、成员失败 | IP-01, IP-03～IP-10 | adapter test | 双工程/空间、同键异载荷、并发、audit/outbox 失败注入 | 不可枚举；同载荷同 ref；异载荷冲突；事实/receipt/audit/event 同回滚 | 同上 |

附加回归：

```bash
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/response-lifecycle packages/core/test/response-lifecycle packages/adapters/src/response-lifecycle packages/adapters/test/response-lifecycle
pnpm exec prettier --check openspec/changes/deliver-execution-forecast-feedback-and-deviation packages/core/src/response-lifecycle packages/core/test/response-lifecycle packages/adapters/src/response-lifecycle packages/adapters/test/response-lifecycle packages/core/package.json packages/adapters/package.json
pnpm run deps:check
pnpm run deps:policy
git diff --check
openspec validate deliver-execution-forecast-feedback-and-deviation --strict --no-interactive
openspec status --change deliver-execution-forecast-feedback-and-deviation --json
```

## 7. 文件清单与升级条件

- 新增：`packages/core/src/response-lifecycle/{schema,service,index}.ts`；`packages/adapters/src/response-lifecycle/{postgres-response-lifecycle-adapter,index}.ts`；D-09 migration；`packages/core/test/response-lifecycle/response-lifecycle.test.ts`；`packages/adapters/test/response-lifecycle/{fixture,postgres-response-lifecycle-adapter.test}.ts`。
- 修改：`packages/core/package.json`、`packages/adapters/package.json`，只增加 `./response-lifecycle` 子路径导出。删除：无。
- 受保护：`packages/contracts/**`、`apps/**`、其它 core/adapters 子模块、`openspec/specs/**`、其它 changes、旧迁移、中央 `packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`、根依赖/锁文件、`openspec/config.yaml`。中央机械登记由主调度完成。
- 立即升级：HEAD/schema/contextFiles 漂移；`000046` 被占用；缺少合法 C14/C25/C27/C19/C04 精确读取；真实 C30 binding 无法由调用方注入；需要改任何公共 contract、权限、事务所有权、迁移号段或依赖；实现被迫由 C28 生成 workflow run、公共 deviation/calibration/review；§6 命令不存在或关键场景只能 Mock/skip。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在 §7 新增/修改文件范围内核对并修复已批准语义、重跑回归和填写 `verification.md`；不得修改 contracts、权限映射、C14/C18/C19/C25/C27/C29/C30、应用接线或引入依赖。授权不可枚举、事实/audit/receipt/event 原子性、终局决定并发、relative 交叉乘法边界、C30 run 所有权和 C28/C29 偏差所有权属于限定审计关注项；若触发审计，同一收尾轮次最多一次，普通范围内缺陷由活动 Auditor 直接修复并回归。
