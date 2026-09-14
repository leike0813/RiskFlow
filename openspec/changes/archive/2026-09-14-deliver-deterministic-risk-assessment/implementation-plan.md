# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`01b2df23194c6203a1104fa2c898e266109d8365`。实现开始先执行 `git rev-parse HEAD` 与 `git status --short`；若 HEAD、公共 contracts、D-03/D-04 接缝或计划文件发生漂移，停止并升级，不把当前代码反推成新设计。
- change/schema：`deliver-deterministic-risk-assessment` / `riskflow-delivery`；实施 Agent 必须先完整读取 `openspec instructions apply --change deliver-deterministic-risk-assessment --json` 返回的全部 `contextFiles`，按 IP-ID 实施。
- 权威顺序：本 change delta spec → design D-01～D-14 → 已归档 C01/C02/C03/C11/C14/C18 主 specs 与生产代码 → 前置 `evolve-assessment-preparation-entry-fields`、`implement-external-risk-event-registration` 与 `implement-monitoring-series-reader` 归档结果 → C19 检查点 `6ea078c675572b98dc75c3c0681a4b01b728f492` 及调度裁决后的有界 reader/helper 接口。研究内容只取 `references/风险识别与评估规划事实源摘要.md`；冲突时升级。
- 实现硬门：三个前置 change 已归档；准备命令/快照/事件已使用裁决字段与复数 monitoring refs；C11 已提供正式外部事件登记和受权读取；C14 已导出受权 `MonitoringSeriesReaderV1`，能按 exact ref 返回 indicator/parameterCode/canonicalUnit/conversions/version 且不返回原始序列；C19 已导出 D-03 的完整 basis reader、归档了 scoring/between/grade 端点语义，并导出与 conflict/overlap 共用的规范化/求值纯 helper；C18/C19 成员均能给出 C04 artifact ref；正式 runtime policy provider 的 10 项引用可注入；C24 已提供标准化风险记录正式 reader；迁移 `000032` 未占用。任一不成立不得用私表、ref 字符串、空值、默认、mock 生产实现、测试 fixture 或临时算法绕过。
- 已核实仓库命令/版本：Node `v24.12.0`、pnpm `11.10.0`、TypeScript `5.9.3`、Vitest `4.1.11`、ESLint `10.9.1`、Prettier `3.9.6`、dependency-cruiser `17.1.0`、OpenSpec `1.13.0`；根 scripts 存在 `build/typecheck/lint/format:check/test/deps:check/deps:policy`。`madge` 不存在，不进入计划。
- 不新增依赖；不执行安装、提交、归档或开发服务器。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/records/index.ts` 的 `RiskInputReferenceSchema`、`RiskAssessmentRecordSchema`；前置 change 后 `ports/index.ts` 的 `AssessmentPreparationCommandPayloadV1Schema`、`RiskInputVersionRefV1Schema`、评估 refs/commands/results；`workflows/index.ts` 的两个评估快照 Schema；`events/index.ts` 的三个既有事件 | 直接 import/parse；fixture 只构造公共合法值，命令入口字段与监测 refs 原样映射快照 | 不重定义/推导 XOR、入口语义、监测集合、评估记录字段、22 引用或事件 payload |
| IP-02 | `packages/core/src/assessment-config/decimal.ts` 的 canonical decimal parser/compare/band 语义；`persistence/canonical-json.ts` 的 `sha256CanonicalJson` | C25 扩展“有限 number → BigInt+scale”而复用 C18 canonical 边界与摘要 | 不复制 C18 配置 Schema、矩阵、阈值或摘要算法 |
| IP-03 | C18 `readPreparedAssessmentConfiguration`、`validateAssessmentConfigurationSet`、`mapRiskMatrixCell`；C19 strict rule/applicable-set Schema 及 `normalizeGradeIntervals`/`evaluateScoringRule` 等价纯 helper（集成后） | 经 D-03 descriptors+C04 读正文；规则边界/求值直接复用 C19 helper，其余传入一个纯 engine 管线 | 不按 `reviewStatus` 重新判发布，不复制 scoring/grade 边界，不建规则/配置第二事实源 |
| IP-04 | `PostgresEngineeringContextSourceRegistry.freeze`、`#verify`、`#readProjectRevision`、`#readSpatialRevision`、`#readSnapshot`；C14 `resolveSnapshotQuery` 与前置 `MonitoringSeriesReaderV1` | 在 C11 所有权内补 `assessment-preparation` 分支与受权 reader，逐 ref 解析 snapshot+series | 不复制 C11/C14 私表查询、不从 ref 猜 series 语义或改监测事实 |
| IP-05 | C03 `AtomicCommandV1Schema`/`TransactionUnitV1`/`sha256CanonicalJson`；C04 `ArtifactStoreV1`；C06 `LocalIdentityAccessV1` | 组合 `RiskAssessmentPortV1.prepare/evaluate`，全部正式事实一次提交 | 不自建事务、工件、权限、审计、Outbox 或错误体系 |
| IP-06 | `PostgresMigrationProvider.findFiles/validatePath` 递归发现；现有 C11/C14/C18 migrations 的约束与 grants 范式 | 增加唯一 `000032` migration | 不改 provider、旧迁移、中央清单或占用 000033～000035 |
| IP-07 | `packages/core/package.json`、`packages/adapters/package.json` 的 feature export 范式 | 各增加一个 `./risk-assessment/engine` export | 不改根 export、workspace、依赖和锁文件 |
| IP-08 | `packages/core/test/assessment-config/fixture.ts` 与 C18 边界测试结构 | 表格驱动纯领域边界 | 不锁私有调用、文案、字段顺序或无价值组合 |
| IP-09 | `packages/adapters/test/postgres/fixture.ts`、C11/C14/C18 adapter fixtures | 真实 PostgreSQL+C04/C06/C03 纵向验收 | 不导出 fixture 到生产、不建生产 seed/内存事实源 |
| IP-10 | `apps/api/src/http.ts` 既有 risk-assessment routes；`apps/worker/src/index.ts` 当前 Agent runner | 只跑通用 route/Worker 回归，确认注入 port 无需新 transport | 不新增 API 分支、空 Worker runner 或 C30 graph |
| IP-11 | `apps/web` 既有路由/interaction tests | 只做无生产改动与回归 | 不提前实现 C34 UI |
| IP-12 | 根校验 scripts、`openspec validate`、项目 `openspec-verify-change` Skill | 汇总最小验证与独立规格验证 | 不归档、不提交 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 契约 fixture 与接缝前置 | “风险输入与评估准备快照…”全部；“评估输入快照…”完整/缺失；“早期纵向验收…”全部 | **新增** `packages/core/test/risk-assessment/fixture.ts`：公共 risk/preparation/input/config/rule/monitoring builder；**新增** `packages/adapters/test/risk-assessment/fixture.ts`：G2.5 PostgreSQL composition、测试专用 runtime policy/C19 adapter 及正式 risk reader 的边界夹具 | 所有 fixture 使用正式 refs、strict Schema、固定时点和明确版本；外部事件夹具基于前置 change 的正式登记，另覆盖正式 reader 缺失失败；C19 fixture 形状逐字段核 D-03；仅 test export | 不出现 production seed、内存 repository、`as unknown as` 绕 Schema 或未发布默认配置 |
| IP-02 | C25 Schema、错误与数值原语 | “指标实际取值…”全部；“结构化规则与权重…”加权边界/覆盖；“风险矩阵…”全部；“权限与错误…”全部 | **新增** `packages/core/src/risk-assessment/engine/schema.ts`：D-01 DTO/result/reason；**新增** `decimal.ts`：finite-number 规范解析、BigInt 对齐/乘加/round/compare/public-number guard；**新增** `service.ts`：`RiskInputFactsReaderV1`、`AssessmentPreparationContextReaderV1`、`AssessmentRuntimePolicySetProviderV1`、受权 artifact input、领域失败映射；**新增** `index.ts` 汇总显式导出 | 全部 strict/bounded/sorted；preparation context 只组合公共快照+冻结适用性值；错误带 code/reason/target；精确中间量不进入公共 contracts | 不改 contracts，不新增 decimal 包，不重新导出 C11/C18/C19 正文类型为新 SSOT |
| IP-03 | 纯确定性 engine | “指标实际取值…”全部；“结构化规则与权重…”全部；“风险矩阵…”全部；“四类触发…”全部；“确定性评估计算链…”全部 | **新增** `packages/core/src/risk-assessment/engine/engine.ts`：`materializeIndicatorActualValues`、`scoreAssessmentAxes`、`mapAssessmentRiskLevel`、`evaluateAssessmentTriggers`、`buildRiskAssessmentRecord`、`evaluateDeterministicAssessment` | 固定 value→C19 rule helper→score→matrix→trigger→record 顺序；乱序规范化；缺一项即无业务结果；复用 C18/C19 strict values/helper | 不调用 I/O/Agent/LangGraph，不重写规则开闭边界、不补值、不按顺序/置信度选边、不产生部分等级 |
| IP-04 | 正式 assessment-preparation 与 reader | “风险输入与评估准备快照…”全部；“权限与错误…”全部；“幂等、并发与重放…”版本变化 | **修改** `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`：options 注入 risk/C14 snapshot+C14 series readers，`freeze` 新分支、`#freezeAssessmentPreparationInTransaction`、`readAssessmentPreparationContext`、C19 `readAssessmentPreparationSnapshot` implementation、row type/映射；必要导出保持在现有 class | 授权→risk/project/spatial/applicability/每个 monitoring snapshot+series read→命令 entry/reason/optional previous+run/monitoring refs 原样复制→全兼容→AtomicCommit；保存适用性冻结值；写 prep/audit/receipt/`engineering.inputs-ready.v1`；两个 reader 不可枚举 | 不推导/默认入口字段，不选择 series/cutoff/policy、从 ref 猜 indicator/parameter/unit 或冻结新监测快照，不改变其它 C11/C14 分支、私有表语义、前置 change 之外公共签名或 C19 私表 |
| IP-05 | PostgreSQL RiskAssessmentPort | “评估输入快照…”全部；“评估记录、决策工件…”全部；“幂等、并发与重放…”全部；“权限与错误…”全部 | **新增** `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`：`PostgresRiskAssessmentEngine`、options、row mappings、`prepare`、`evaluate`、artifact reads、compatibility/authorization recheck、atomic append；**新增** `packages/adapters/src/risk-assessment/engine/index.ts` | prepare 按 D-04 全量物化；evaluate 按 D-10 顺序计算，C04 工件先耐久，单事务写 value/decision link/record/audit/receipt/event；同键重放和并发唯一 | 不直读 C19/C14/C24 私表，不修改/覆盖旧记录，不在缺 run ref 时伪造 event |
| IP-06 | 只追加数据库模型 | “评估记录、决策工件…”原子/回滚；“幂等、并发与重放…”并发；“权限与错误…”越权 | **新增** `packages/adapters/src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts`：D-09 五表、FK/check/unique/index/grant、反序 down | migration name/path/序号符合 provider；XOR、JSON、digest、ref、identity、audit/receipt FK 与 SELECT/INSERT grants | 不改旧表/provider，不 grant UPDATE/DELETE，不占 000033～000035 |
| IP-07 | Feature exports | 全部 Requirement 的可消费出口 | **修改** `packages/core/package.json`；**修改** `packages/adapters/package.json` | 新增 `./risk-assessment/engine` 的 dist types/import | 不加依赖、不改根 index/workspace/lock/其它 exports |
| IP-08 | 纯领域验证 | IP-02/IP-03 所映射全部场景 | **新增** `packages/core/test/risk-assessment/engine.test.ts`，复用 IP-01 fixture | 表格覆盖 XOR input facts、mapping/type/unit/absence/ambiguity、operators/intervals、两策略、正负 round、matrix 边界、四 triggers、乱序重放、Agent-free 静态依赖 | 不逐文案断言，不测试 C18/C19 私有实现，不重复每个等价组合 |
| IP-09 | PostgreSQL/纵向验收 | “评估输入快照…”重评/历史；“评估记录…”全部；“幂等…”全部；“早期纵向验收…”全部 | **新增** `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`；**修改** `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` | 覆盖 prep 两 XOR、C19/C04/policy gates、initial/reassessment/backfill、完整/缺值/单位、atomic rollback、idempotency conflict/concurrency、outbox/audit、正式 G2.5 chain；C11 test 将旧 unsupported 断言改为已注入成功/未注入 fail-closed | 不启动 C26，不伪造 warning record，不精确断言 SQL/时间/全文 |
| IP-10 | API/Worker 接入确认 | “评估输入快照…”公共端口；“评估记录…”事件；“确定性评估计算链…”Agent-free | **无生产文件修改**；检查 `apps/api/src/http.ts` 的既有四路由，运行 API shell 与 Worker runner tests | 证明 service registry 注入真实 `RiskAssessmentPortV1` 后公共 Schema/结果不变；Worker 未新增评估 Agent/graph | 不新增 endpoint、runner、event consumer 或 app composition |
| IP-11 | Web 所有权保护 | “确定性评估计算链…”；“早期纵向验收…”fixture 非生产 | **无生产文件修改**；运行 Web routing/SSR/interaction regression 并检查 git diff | 证明 C25 未把开发说明、fixture 或未归属页面放入 UI | 不触碰 C34 页面范围 |
| IP-12 | 最小验证与 OpenSpec verify | 全部 Requirements/Scenarios | **无代码文件修改**；执行 §6 命令与 `openspec-verify-change`，仅在行为和证据齐备后勾选 tasks | 类型、测试、迁移、lint/format、依赖、OpenSpec 严格验证全部成功；失败需定位到 IP-ID | 不提交、不归档、不把无法运行写成通过 |

## 4. 调用与副作用顺序

### 4.1 `EngineeringDataPortV1.freeze(assessment-preparation)`（IP-04/IP-06）

1. 等前置 `evolve-assessment-preparation-entry-fields` 归档后执行公共 Schema parse；校验 command envelope、actor/project、显式 `entryMode`/`triggerReasonCode`、可选 previous/run/非空 monitoring refs 和 `engineering-data.freeze` 分支能力，缺任一必填字段或空/重复 refs 在边界拒绝。
2. C06 复验授权；按 XOR 调用 `RiskInputFactsReaderV1`，再读取精确 project/spatial/applicability；对调用方已冻结的每个 monitoring ref 调 C14 snapshot reader，随后按 snapshot.seriesRef 调正式 series reader，核同工程/空间/版本并保存关联。C25 不创建快照、不选择 series/cutoff/policy、不解析 ref 字符串。任一不存在、跨工程、越空间、撤权、证据不足或版本错配立即返回闭合失败。
3. 规范化来源证据和全部 refs，把命令 `entryMode`/`triggerReasonCode`/`monitoringSnapshotRefs` 原样写入 preparation snapshot，只在载荷提供时写 previous/run；构造/parse 公共 snapshot，identity digest 不含记录时钟。
4. C03 `TransactionUnitV1.execute` 内 INSERT preparation、audit、receipt、`engineering.inputs-ready.v1`。数据库失败整体回滚；同键同载荷返回原 ref，异载荷冲突；并发由 receipt+identity unique 收口。
5. 受权 reader 读取时按 project/ref/auth 查一行并 parse；不存在与越权使用同一外部失败，不枚举事实。

### 4.2 `RiskAssessmentPortV1.prepare`（IP-05/IP-06）

1. parse 分支并 C06 校验 `risk-assessment.prepare`；读取 preparation。
2. 调 C19 D-03 reader；核 11 config + applicable set + scoring rules descriptors、basis/prep/applicability/project/time/digests。缺 symbol/成员或 C19 waiting 直接 fail-closed。
3. 经 C04 逐工件有界读取并等待 verified；用 C18/C19 Schema 与 digest 校验正文，拒绝 reviewStatus 替代发布事实。
4. 调 runtime policy provider 取得 D-04 十项；逐项核已发布/project/effective/compatibility。与 C18/C19 十二项合成并 parse 完整公共 input snapshot。
5. 对 reassessment 先读取 previous record/input，核 reason 对应的新旧 ref 确有变化；monitoring reason 比较规范 refs 集合，applicability reason 比较单 ref；historical-backfill 固定 effectiveAt；initial 不带 previous。
6. C03 单事务 INSERT input snapshot/audit/receipt；仅合法 reassessment 追加一次 `engineering.assessment-input-changed.v1`，monitoring 分支的 previous/new 数组各可省略但至少一侧存在，均非空去重且前后不同。任一失败无部分快照/事件；重试与并发同 4.1。

### 4.3 `RiskAssessmentPortV1.evaluate`（IP-02/IP-03/IP-05/IP-06）

1. parse + C06 `risk-assessment.evaluate`；读取 input/preparation；确认授权或 preparation 中存在同一 assessment run ref。
2. 重新读取 risk facts、全部精确 C14 snapshots 和各自 exact series revision；重新解析 C19 descriptors+C04 正文并核 input snapshot 的 22 refs 未漂移。由 C18 mappings/thresholds/joint rules 求所需 indicator+parameter，证明每项恰有一个 snapshot+series 且 canonicalUnit 相容；读取只按 frozen refs，不取 latest。
3. 纯计算严格执行：监测序列/单位覆盖 → cutoff 网格值或 exact feature → 目标指标/映射唯一性 → 值/单位/证据全量物化 → 规则基础分 → P/C → matrix → 四触发 → public record。任何失败只产生类型化错误，不返回/保存中间业务结果。
4. 生成规范 decision body/digest，经 C04 put+verified 得到 content artifact ref。此时失败无正式 DB 结果；已写但未登记的工件是可清理 orphan。
5. 提交前复验 authorization、basis releases、artifact digests、run ref；C03 单事务 INSERT actual set、decision link、record、audit、receipt、`assessment.recorded.v1`。
6. 事务失败整体回滚；至少一次事件消费由下游按 event/idempotency 去重。trigger 为空仍发布 assessment event；trigger 非空只交给 C26，不写 warning 表。

## 5. Schema、状态与持久化落实

- SSOT：公共 XOR/refs/snapshots/record/events 仅来自 contracts；适用性来自 C11 snapshot；monitoring values/features/availability 来自 C14；11 配置与 decimal/matrix 语义来自 C18；applicable set/rules/published membership 来自 C19；C25 仅拥有 actual-value/decision/record 派生事实。
- 状态闭合：preparation/input/value-set/decision/record 都是只追加 `created` 事实，无 mutable status。等待只使用 C02 knowledge waiting；其余错误映射 D-11。重评/补算创建新 refs并关联 previous/effectiveAt。
- 数据库按 D-09 五表；所有 JSON 入库前后 strict parse，digest 用 `sha256CanonicalJson`；XOR check 强制两个 identity 列恰有一个非空；所有业务 ref 拆 entity/version 列用于 FK/unique，并保留 JSON ref 供 round-trip。
- 权限：migration 只给 `riskflow_app` SELECT/INSERT；运行时每次读取/写入均经 C06，C04/C11/C14/C19 reader 再执行其边界授权；错误不可枚举。
- 事务：preparation 一事务；input snapshot 一事务；evaluation 正式事实一事务。C04 put 在 evaluation 事务前完成，不宣称跨系统原子；只有 DB link/record 成立才是正式结果。
- 可观测性：audit/receipt/outbox 记录 command/idempotency/actor/auth/run、refs 与 digest；错误记录 stable stage/reason/diagnostic ref，不记录正文/SQL/凭据。无需 metric/log 新依赖。
- 迁移：只运行 `000032`，up/down 均由 migration provider 测试发现；down 仅用于无下游引用的受控回滚。

## 6. 验收证据矩阵

下表命令已核实可执行；其中新增 test path 在对应 IP 创建后运行。`CORE` = `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts`；`PG` = `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 风险输入与准备 / 标准化记录 | IP-01,IP-04,IP-09 | adapter PG | public record+正式 ref | 仅 riskRecord 分支；prep/audit/event 原子 | `PG` |
| 风险输入与准备 / 外部事件 | IP-01,IP-04,IP-09 | adapter PG | 前置 change 正式登记+受权 reader | 仅 external 分支；无 seed API | `PG` |
| 风险输入与准备 / 外部事实不可用 | IP-01,IP-04,IP-09 | adapter PG | 未登记/reader unavailable/unauthorized | typed fail；不回退 fixture、内存或另一 XOR 分支 | `PG` |
| 风险输入与准备 / XOR 或作用域拒绝 | IP-02,IP-04,IP-08,IP-09 | core+adapter | malformed/cross-project refs | strict/authorization failure；零写入 | `CORE && PG` |
| 风险输入与准备 / 入口语义原样冻结 | IP-01,IP-04,IP-09 | adapter PG | 前置 change 后含/不含 optional fields 的命令 | required 字段逐项相等；optional 省略；缺 required Schema 拒绝 | `PG` |
| 风险输入与准备 / 监测集合显式冻结 | IP-01,IP-04,IP-09 | adapter PG | zero/one/many/duplicate/cross-project refs | optional absent 合法；非空集合逐项一致；空/重复/越权拒绝 | `PG` |
| 完整输入快照 / 完整集合 | IP-01,IP-05,IP-09 | adapter PG | C19 12项+C18正文+provider 10项 | 22 refs 来源与 snapshot strict | `PG` |
| 完整输入快照 / 任一缺失 | IP-05,IP-09 | adapter PG | 各 owner 缺一代表项 | typed fail/wait；无 snapshot | `PG` |
| 完整输入快照 / 重评与补算 | IP-05,IP-09 | adapter PG | previous+changed ref/effectiveAt | 新 ref、旧事实不变、change event 合法 | `PG` |
| 指标取值 / 文档监测共同取值 | IP-01,IP-03,IP-08,IP-09 | core+adapter | source-field+C14 frozen metrics | 全指标、来源/单位/证据完整 | `CORE && PG` |
| 指标取值 / 单位冲突 | IP-02,IP-03,IP-08,IP-09 | core+adapter | identity/affine mismatch | unit reason；无 partial P/C/DB | `CORE && PG` |
| 指标取值 / 缺值歧义 | IP-03,IP-08,IP-09 | core+adapter | zero/two mappings/unavailable | stable indicator ref；不补值 | `CORE && PG` |
| 指标取值 / 所需序列覆盖 | IP-03,IP-08,IP-09 | core+adapter | missing/duplicate snapshot per indicator+parameter | typed coverage failure；不选 latest/不出 partial level | `CORE && PG` |
| 指标取值 / series 身份与 cutoff 值 | IP-03,IP-04,IP-08,IP-09 | core+adapter | reader mismatch unit/parameter; cutoff point missing | typed series/unit/value failure；不猜 ref/不回退 earlier | `CORE && PG` |
| P/C / 加权舍入边界 | IP-02,IP-03,IP-08 | core | ±half, scales 0..6, 10000bp | exact half-away + contribution trace | `CORE` |
| P/C / maximum 乱序 | IP-02,IP-03,IP-08 | core | >6 decimal finite scores, permutations | exact same max/digest；不读 weight | `CORE` |
| P/C / 规则覆盖失败 | IP-03,IP-08,IP-09 | core+adapter | gap/overlap/stale rule | rule reason；无 P/C/record | `CORE && PG` |
| P/C / C19 端点与无穷边界 | IP-03,IP-08 | core | lower/non-final-upper/unbounded endpoints | C25 结果与 C19 helper 一致；越界 no-match，不复制 comparator | `CORE` |
| 矩阵 / 共享边界 | IP-02,IP-03,IP-08 | core | adjacent exact boundary | 只入后带 | `CORE` |
| 矩阵 / 末上界 | IP-02,IP-03,IP-08 | core | final upper bound | 唯一末单元 | `CORE` |
| 矩阵 / 越界 | IP-03,IP-08,IP-09 | core+adapter | below/above/missing cell | typed failure；无 level/record | `CORE && PG` |
| 四触发 / 同时命中 | IP-03,IP-08,IP-09 | core+adapter | four matching policies | 四种 enum、规范去重排序 | `CORE && PG` |
| 四触发 / 运算符边界 | IP-02,IP-03,IP-08 | core | gt/gte/lt/lte/outside equality | 包含/排除精确 | `CORE` |
| 四触发 / 空集合 | IP-03,IP-08,IP-09 | core+adapter | no thresholds hit | 完整 record+event；无 warning fact | `CORE && PG` |
| 四触发 / 适用性不唯一 | IP-03,IP-08,IP-09 | core+adapter | zero/multiple acceptance rules | config failure；不首项决策 | `CORE && PG` |
| 原子事实 / 完整提交 | IP-05,IP-06,IP-09 | adapter PG | valid run/auth/C04 | 五 facts relations+audit+receipt+outbox | `PG` |
| 原子事实 / 任一失败回滚 | IP-05,IP-06,IP-09 | adapter PG | injected DB/event failure | no formal rows/receipt/event | `PG` |
| 原子事实 / C26 所有权 | IP-05,IP-09,IP-10 | adapter+API | trigger record | only assessment event; no warning rows | `PG` |
| 幂等重放 / 相同输入 | IP-02,IP-03,IP-05,IP-09 | core+adapter | same snapshot, clocks/processes differ | same logical refs/content digest | `CORE && PG` |
| 幂等重放 / 同键异载荷 | IP-05,IP-09 | adapter PG | changed payload same key | IDEMPOTENCY_CONFLICT；old intact | `PG` |
| 幂等重放 / 并发 | IP-05,IP-06,IP-09 | adapter PG | Promise.all same identity | one formal result/event | `PG` |
| 权限错误 / 跨工程越空间 | IP-04,IP-05,IP-09 | adapter PG | wrong project/scope/grant | non-enumerating denial；zero side effects | `PG` |
| 权限错误 / 提交前失效 | IP-05,IP-09 | adapter PG | deactivated release between read/commit | STALE/BLOCKED；no commit | `PG` |
| 无 Agent / runtime 不可用 | IP-03,IP-08,IP-10 | core+deps | no agent dependency registered | evaluation succeeds identically | `CORE && pnpm run deps:check` |
| 无 Agent / 缺事实不降级 | IP-03,IP-08,IP-09 | core+adapter | missing value/rule/policy | fail-closed；zero agent calls | `CORE && PG` |
| G2.5 / 正式纵向链 | IP-01,IP-04,IP-05,IP-06,IP-09 | adapter PG | public record/C11/C14/C18/C19/C04/C06 | record→P/C→matrix→trigger→event→audit 可重算 | `PG` |
| G2.5 / fixture 非生产 | IP-01,IP-07,IP-09,IP-11 | imports/diff | test-only exports | production package/API/Web 无 fixture/seed | `pnpm run deps:check && git diff --check` |

补充可运行回归与静态证据：

```bash
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/assessment-config/assessment-config.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts
pnpm exec vitest run apps/api/test/http-shell.test.ts apps/worker/test/agent-runtime/runner.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx
pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts
pnpm exec eslint packages/core/src/risk-assessment packages/core/test/risk-assessment packages/adapters/src/risk-assessment packages/adapters/test/risk-assessment packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts
pnpm exec prettier --check openspec/changes/deliver-deterministic-risk-assessment packages/core/src/risk-assessment packages/core/test/risk-assessment packages/adapters/src/risk-assessment packages/adapters/test/risk-assessment packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/core/package.json packages/adapters/package.json
pnpm run deps:check
pnpm run deps:policy
git diff --check
openspec validate deliver-deterministic-risk-assessment --strict
```

## 7. 文件清单与升级条件

**新增（均已归属 IP-ID）：**

- IP-01：`packages/core/test/risk-assessment/fixture.ts`；`packages/adapters/test/risk-assessment/fixture.ts`
- IP-02：`packages/core/src/risk-assessment/engine/schema.ts`；`decimal.ts`；`service.ts`；`index.ts`
- IP-03：`packages/core/src/risk-assessment/engine/engine.ts`
- IP-05：`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`；`index.ts`
- IP-06：`packages/adapters/src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts`
- IP-08：`packages/core/test/risk-assessment/engine.test.ts`
- IP-09：`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`

**修改：**

- IP-04：`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`
- IP-07：`packages/core/package.json`；`packages/adapters/package.json`
- IP-09：`packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`

**删除：**无。IP-10/IP-11 明确无 API、Worker、Web 生产修改。

**受保护：**`packages/contracts/**`、`packages/core/src/assessment-config/**`、`packages/core/src/engineering-data/monitoring/**`、`packages/adapters/src/assessment-config/**`、`packages/adapters/src/engineering-data/monitoring/**`、C14/C18/C19 生产代码、`apps/**` 生产文件、根 `package.json`/workspace/tsconfig、`pnpm-lock.yaml`、`openspec/config.yaml`、主 specs、其它 changes、旧 migrations、migration provider、中央测试清单。

**必须 ask/escalation：**

1. 三个前置 change 未归档，入口四字段、`monitoringSnapshotRefs`、input-changed 复数集合、C11 外部事件登记/读取或 C14 `MonitoringSeriesReaderV1` 形状/权限/审计与裁决不一致，或 HEAD/任何其它公共 Schema/port/event/C11/C14/C18/C19 symbol 与基线/设计不一致；
2. C19 未按 D-03 导出完整 reader 与共用评分 helper，或缺任一 configuration/applicable/rule artifact descriptor、端点规范、发布/权限/审计语义；
3. 任一 22 类引用没有合法 owner/provider、需要修改公共命令、允许 optional/default，或需要 C25 治理后续策略；
4. C11 前置外部事件登记或 C24 标准化记录 reader 无法通过 `RiskInputFactsReaderV1` 提供字段/证据/精确版本，C14 series reader 无法提供指标/参数/规范单位/版本，或 G2.5 必须依赖生产 seed/内存事实源；
5. 评分 number 无法按 D-06 对公共合法值保持精确语义，需收窄 contracts/C19 规则或引入 decimal 依赖；
6. 需要修改 C14/C18/C19 私表/生产代码、API/Web/Worker、受保护文件，新增迁移/依赖，或 `000032` 已占用；
7. `assessment.recorded.v1` 无合法 assessment run ref，或要求 C25 直接创建 C26 warning fact；
8. 任何测试命令不存在、fixture 无法代表正式 PostgreSQL/C04 路径、原子边界无法由 C03 实现，或验证失败需要扩大任务范围。
