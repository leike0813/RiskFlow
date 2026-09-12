## Context

见 [proposal.md](./proposal.md) 的 Why。基线固定为 `01b2df23194c6203a1104fa2c898e266109d8365`：C01/C02 已冻结风险输入 XOR、评估记录、六领域 port、评估快照与事务事件；C03 提供 `TransactionUnitV1`、命令回执、审计与 Outbox 原子提交；C11 当前只把 `EngineeringDataPortV1.freeze(monitoring-snapshot)` 委派给 C14，`assessment-preparation` 仍返回 `UNSUPPORTED_CONTRACT`；C14 已提供受权的不可变监测快照与 `resolveSnapshotQuery`，但序列修订读取仍为 private；C18 已提供 11 类严格配置、规范十进制和矩阵边界函数；C19 尚未实现，其检查点 `6ea078c675572b98dc75c3c0681a4b01b728f492` 只作为接口输入。

调查发现四个必须在设计中闭合的接缝。第一，公共 `AssessmentInputSnapshotV1` 要求 22 类引用，而 C18/C19 只拥有其中 12 类；协调裁决为其余 10 类由组合根注入正式已发布策略。第二，C19 原规划只返回 `AssessmentBasisReleaseSetRefV1`，无法让 C25 合法取得成员；协调裁决为 C19 在实现前补充受权有界 reader，C25 取得成员工件引用后再经 C04 读取正文。第三，基线 `EngineeringFreezeCommandV1.assessment-preparation` 缺少准备快照必填的入口模式/触发原因，且单个监测快照无法覆盖 C18 多序列映射；调度将以独立前置 change `evolve-assessment-preparation-entry-fields` 增加 `entryMode`、`triggerReasonCode`、可选 `previousAssessmentRecordRef`/`causalRunRef`，以可选非空 `monitoringSnapshotRefs` 取代 `monitoringCutoff`/单 `monitoringSnapshotRef`，并让 `engineering.assessment-input-changed.v1` 的 monitoring 分支用前后复数引用集合表达增删。第四，C11 基线尚无正式外部风险事件登记读取路径；调度将以独立前置 change `implement-external-risk-event-registration` 在 C11 所有权内补齐，C25 只消费其正式结果。C25 等这些前置变更归档后消费，任一缺失均失败闭合。

## Goals / Non-Goals

**Goals:**

- 建立一个无 Agent 的深层 `risk-assessment/engine`，纯领域计算与 PostgreSQL 用例 adapter 分离。
- 完成 `EngineeringDataPortV1.freeze(assessment-preparation)`、`RiskAssessmentPortV1.prepare/evaluate` 的正式实现和 RA-S1～RA-S6 事务证据。
- 在公共 number 契约、C18 最多六位规范十进制矩阵和所有比较边界内保持跨进程可重放。
- 只增加 C25 自有表、子路径导出和最小测试；复用 C03/C04/C06/C11/C14/C18/C19，不引入依赖。

**Non-Goals:**

- 不修改 `packages/contracts`、C14/C18/C19 生产实现、根 workspace、锁文件、中央迁移注册或测试清单。
- 不实现 C24 标准化风险记录仓储、C26 预警/任务/通知、C27～C29 处置反馈与校准、C30 LangGraph、C31 投影或 C34 Web。
- 不建立生产 seed API、内存事实源、默认阈值、默认策略、临时评分算法、通用规则引擎或第二套工作流状态机。

## Decisions

### D-01：公共契约不变，新增 feature-owned 内部 Schema 与窄读取接缝

`packages/core/src/risk-assessment/engine` 定义 C25 自有 strict Schema：`RiskInputFactsV1`、`AssessmentRuntimePolicySetV1`、`IndicatorActualValueSetV1`、`AssessmentDecisionArtifactV1`、持久化信封、闭合 reason code 与纯计算输入/结果。公共边界继续直接解析并返回 C01/C02 的 `RiskInputVersionRefV1`、`AssessmentPreparationSnapshotV1`、`AssessmentInputSnapshotV1`、`RiskAssessmentRecord` 和 `RiskAssessmentPortV1` 结果，内部 Schema 不复制这些字段。

四个外部注入接缝各只表达一个跨模块读取：

1. `RiskInputFactsReaderV1`：按工程、授权和精确 XOR 引用读取标准化风险记录或外部事件的可评估字段、证据和版本身份；标准化记录事实所有者仍是 C24，外部事件登记/读取由前置 `implement-external-risk-event-registration` 在 C11 所有权内提供。
2. C19 拥有的 `AssessmentBasisReleaseSetReaderV1`：按工程、授权和精确 basis ref 返回发布成员引用/摘要，见 D-03。
3. `AssessmentRuntimePolicySetProviderV1`：由部署组合根按工程、准备快照、basis ref 和业务时点返回 10 个后续策略精确引用，见 D-04。
4. C14 前置 `implement-monitoring-series-reader` 所拥有的 `MonitoringSeriesReaderV1`：按工程、授权和精确 series ref 返回序列修订的指标、parameterCode、canonicalUnit、单位换算和版本身份，不返回原始序列数据。

`MonitoringRegistryV1.resolveSnapshotQuery`、前置 C14 series reader 和 C11 评估准备 reader 直接复用已有/裁决后的领域接口，不再包一层通用 repository。

C25 另定义 feature-owned `AssessmentPreparationContextReaderV1`，返回公共 preparation snapshot 及其已冻结的 `ApplicabilityMetadataSnapshotV1` 值；C11 adapter 在创建 preparation 时实现该 reader，同时以 C19 要求的接口只返回公共 preparation。它不是新的事实源，只是 C25 自有准备表的有界读取面。

**替代方案：**修改 contracts 增加正文或策略字段违反任务边界；让 adapter 直读 C19/C24 私表违反模块所有权；建立通用对象 reader 会失去闭合类型与权限语义。这些窄接缝是最小跨模块面。

### D-02：评估准备属于 engineering-data，C11 adapter 完成既有 freeze 分支

`PostgresEngineeringContextSourceRegistry.freeze()` 增加 `assessment-preparation` 分派，并在同一类内复用现有私有工程修订、空间、适用性快照读取与 C06 校验；不复制 C11 表查询到 C25 adapter。它通过注入的 `RiskInputFactsReaderV1` 复验风险输入存在、精确版本、工程/空间/证据可见性。实现必须等待 `evolve-assessment-preparation-entry-fields` 和 `implement-monitoring-series-reader` 归档，然后把命令的 `entryMode`、`triggerReasonCode` 和规范去重后的 `monitoringSnapshotRefs` 原样写入公共 `AssessmentPreparationSnapshotV1`，只在载荷显式提供时写 `previousAssessmentRecordRef`、`causalRunRef`；payload 与 authorization 同时含 causal run 时必须精确相等。每个监测 ref 通过 C14 受权 snapshot query 复验工程/空间，其 series ref 再通过正式 series reader 复验版本身份。C25 不冻结新监测快照，不选择 series、availability policy 或 cutoff，也不得由 risk input、时点、authorization 或默认值推导字段。

准备快照正文及当时读取的完整 `ApplicabilityMetadataSnapshotV1` 值保存在 C25 自有 `business.assessment_preparation_snapshots`；后者是形成评估记录所需的冻结输入副本，不改变 C11 原事实。C11 adapter 暴露两个窄读取：C25 的 `AssessmentPreparationContextReaderV1` 返回 preparation+适用性值，C19 已规划的 `AssessmentPreparationSnapshotReaderV1` 只返回公共 preparation。两者都按 project/ref/auth 限界并对不存在、跨工程或撤权统一返回不可枚举失败。创建准备快照与审计、命令回执、`engineering.inputs-ready.v1` assessment 分支同事务；后续重评由 D-10 的 prepare 事务按前置契约发布一次 input-changed 事件，监测分支只带规范化前后 refs 集合及差集可辨身份，不带正文。

前置事件的 previous/new monitoring refs 各为可选非空、规范去重数组；至少一侧存在，两侧都存在时集合不得相同，因此可以表达纯新增、纯删除、替换和多序列同时变化。C25 只在集合确实变化时发布一次该事件；适用性分支继续使用原有单一 previous/new applicability ref。

**替代方案：**独立 adapter 读取 C11 私表会跨所有权；让 C19 保存准备快照形成第二事实源；只在测试构造快照无法完成正式 port。把现有 C11 composition 补齐最少一个分支符合 C02/C11 方向。

### D-03：C19 reader 只返回发布成员描述，正文统一经 C04 受权读取

C25 注入并只消费由 C19 拥有的 `AssessmentBasisReleaseSetReaderV1`。实现前硬门要求其输入为 `projectId + AssessmentBasisReleaseSetRefV1 + AuthorizationContextV1 + invocation identity/time`，输出至少包含：

- basis ref、准备快照 ref、工程修订 ref、适用性快照 ref、C18 configuration set ref、业务/记录时点和 basis member/identity digest；
- 恰好 11 个 C18 成员，每项含 definition type、精确 release ref、revision ref、`ContentArtifactRefV1` 与 content digest；
- 一个 applicable-rule-set 成员，含精确 release ref、revision ref、artifact ref 与 content digest；
- 该集合纳入的每个结构化规则成员，含精确 release ref、revision ref、artifact ref 与 content digest，且成员顺序/身份有规范摘要。

reader 必须只返回同工程、已发布、时点有效、未停用且属于集合的成员，失败不可枚举并记录只追加查询审计。C25 对每个 artifact ref 使用 C04 `ArtifactStoreV1` 的受权有界读取，核对 media type、字节上限、完整流校验、Schema、正文 digest、revision/release/set/工程/适用性兼容身份；配置复用 C18 parser/validation，规则复用 C19 strict Schema。reader 不返回正文，C25 不读 C19 私表、不保存第二份发布成员事实。

C19 还必须导出其自身 conflict/overlap 校验共用的规范边界 helper（预期 `normalizeGradeIntervals`、`evaluateScoringRule` 或等价闭合名称）：grade intervals 固定左闭右开、缺下/上界分别为负/正无穷并连续无空洞；scoring threshold 和 `between` 的端点语义由 C19 已归档 spec 唯一定义。C25 只调用该纯 helper 得到 score/grade/no-match/ambiguous，不复制其比较实现。符号或语义缺失均为实现硬门。

**替代方案：**只返回 applicable set release 无法定位规则正文；把正文放进 reader 会绕过 C04 的权限与内容校验；C25 查询 C16/C18/C19 多张表会复制发布解析规则。以上是确定性计算所需的最小描述集合。

### D-04：22 类输入引用按所有者分层，完整后一次物化

`AssessmentInputSnapshotV1` 的来源固定如下：

| 公共字段 | 唯一来源 |
| --- | --- |
| `indicatorSystemRef`、`indicatorFieldMappingRef`、`weightSetRef`、`scoringStrategyRef`、`riskMatrixRef`、`riskAcceptanceThresholdRef`、`monitoringWarningThresholdRef`、`jointTriggerPolicyRef`、`measureLibraryReleaseRef`、`effectForecastPolicyRef`、`deviationPolicyRef` | C19 reader 返回的 C18 发布成员 |
| `applicableRuleSetRef` | C19 reader 返回的已发布 applicable-rule-set 成员 |
| `warningAggregationPolicyRef`、`notificationPolicyRef` | C26/部署所有者经正式策略提供者注入 |
| `responseGenerationPolicyRef`、`responseValidationPolicyRef`、`responseAgentPolicyRef` | C27/部署所有者经正式策略提供者注入 |
| `calibrationAgentPolicyRef` | C29/部署所有者经正式策略提供者注入 |
| `retryPolicyRef`、`reviewPolicyRef`、`modelDeploymentRef`、`promptTemplateRef` | C30/平台部署策略所有者经正式策略提供者注入 |

C18 的 forecast/deviation 即使 C25 不计算也按公共快照契约冻结；其余 10 项只记录引用，不进入指标/P/C/矩阵/触发计算。provider 必须返回全量 strict 对象并证明已发布、工程/业务时点/兼容身份；任一缺失或漂移均返回 `BUSINESS_BLOCKED`/`STALE_VERSION`，不产生部分快照。`prepare(initial|reassessment|historical-backfill)` 读取同一 preparation 与 basis，校验命令分支特有的前次记录/原因/历史时点后一次物化快照。

分支映射固定：`initial` 只接受 preparation `entryMode=assess|identify-and-assess` 且命令不带 previous；`reassessment` 只接受 `entryMode=reassess`，命令 previous 必须与 preparation previous 相同；`historical-backfill` 只接受 `entryMode=historical-backfill` 并使用命令 `effectiveAt`。其它 entry mode 或前次记录不一致返回 `UNSUPPORTED_CONTRACT`/`STALE_VERSION`，不静默改写。

**替代方案：**C25 定义占位策略或固定常量会制造未审核默认；把 10 项加入现有命令需要改 contracts；允许空引用会破坏公共 strict Schema。运行时正式 provider 是不扩契约的唯一可行组合点。

### D-05：指标取值以“先冻结、后计算”的唯一管线收口

纯函数先从 applicable rule set 得到完整目标指标身份，再按 C18 indicator system 验证 P/C 轴和三维适用性，并由 field mappings、monitoring thresholds 与 joint rules 求出所需 `monitoringIndicator + parameterCode` 集合。对每个 snapshot 先用 C14 series reader 解析精确指标、参数、canonicalUnit 和版本，不从 ref 字符串猜测；每个所需序列必须在 preparation 的 `monitoringSnapshotRefs` 中恰好命中一个。每个目标指标必须恰好命中一个 field mapping：`source-field` 从 `RiskInputFactsV1.fields` 以 document type + field path 精确读取；`monitoring-value` 只取 `sampledAt === snapshot.cutoff` 且 status 为 available/interpolated 的对齐点，不回退较早值；`monitoring-feature` 只取同 snapshot 的 available feature。来源数组只先按身份建索引，不以顺序决策；序列快照零/多命中、series identity/canonicalUnit 不符、cutoff 点缺失、值零/多命中、C14 feature unavailable、类型不符或证据为空均整体失败。

数值 mapping 先验证 `sourceUnit`，identity 要求源/目标单位一致，affine 使用配置 scale/offset 变换；ordinal/boolean 只允许 source-field 且不得经过数值转换。输出 `IndicatorActualValueSetV1` 逐项保存 indicator/mapping、原始与规范值、单位、来源快照/风险输入、证据和 digest，后续只消费该集合。监测读取不会回看最新批次。

**替代方案：**多来源择优、缺值填零/均值或模型补全会使结果不可重放；评分时即时读源会把时点漂移带入计算。一次完整物化是最小可靠边界。

### D-06：评分使用规范有限数值表示，不依赖二进制边界巧合

C01/C19 的公开评分阈值和 score 是有限 JavaScript number，C18 矩阵边界是最多六位 `CanonicalDecimalV1`。C25 将每个已通过公共 Schema 的 number 用 ECMAScript 最短往返十进制表示规范化，并支持指数展开为有符号 `BigInt + scale`；比较、affine、中间乘加、基点权重和半远离零舍入均在该表示上进行，不用浮点决定共享边界。最终写公共 number 前必须有限且往返到相同规范值；决策工件同时保存精确十进制中间量与规则/权重引用。

规则匹配调用 D-03 的 C19 纯 helper，按其已闭合适用规则、阈值运算符、区间与例外语义为每个指标解析恰好一个基础分；C25 只负责完整覆盖和结果相容性。`weighted-average` 使用对应轴完整的 10000 基点集合，逐项 `weightedScore=baseScore×basisPoints/10000`，累加未舍入精确贡献后按声明 0～6 位舍入 P/C；`maximum` 令每项公共 `weightedScore=baseScore`，再取规范比较下的最大基础分且不读取权重。maximum 结果即使超过六位小数也可与 C18 矩阵边界用同一规范整数尺度精确比较，不擅自舍入；矩阵输出仍只使用已发布 level identity。

**替代方案：**直接 `number * weight`/`Math.round` 会污染十进制半边界；新增 decimal 依赖违反依赖治理；把 maximum 强制舍入会改变已发布策略。标准 `BigInt` 加短十进制解析覆盖公共有限 number 空间且无新依赖。

### D-07：矩阵与四类触发共享一次规范比较事实

矩阵映射沿用 C18 的连续分带、非末段左闭右开、末段右闭和完整笛卡尔积语义；能直接表示为 C18 canonical decimal 的 P/C 调用既有 helper，其他合法 maximum 值使用 D-06 同尺度比较，但必须得到相同边界语义。越界、缺单元或版本不相容整体失败。

触发按固定顺序计算后按 `{triggerType, indicator/rule identity}` 规范排序去重：

1. 按三维适用性解析唯一风险可接受 threshold，用 matrix ordinal 判断实际 level 是否严格高于 maximum accepted level；
2. metric=`value` 的监测 threshold 先核 threshold unit 与 C14 series canonicalUnit，再以 cutoff 对齐值比较，命中记为“监测指标越限”；
3. metric 为冻结 feature 的 threshold 先核 feature/threshold unit，再比较，命中记为“趋势/加速度/异常评分越限”，其中主频也作为 C14 feature 按该类保存；
4. joint rule 只组合前述单阈值 identity，执行 `all-of|any-of|at-least`，不重新读值。

`gt/gte/lt/lte` 依运算符决定等号，`outside` 仅在 `[lower, upper]` 闭区间外命中。触发为空是合法完整评估；阈值适用性歧义或引用不存在则失败。C25 只把触发写入记录并发布 `assessment.recorded.v1`，C26 才创建 `warning.warning-recorded.v1`、预警记录、任务与通知。

**替代方案：**用风险等级字符串排序、联合规则重算阈值或四类按优先级互斥都会改变配置语义；由 Agent 复核触发违反 AGENTS.md §2.1。

### D-08：一个深层 core 服务暴露 prepare/evaluate 所需纯函数

`schema.ts` 只放闭合 DTO/常量，`decimal.ts` 放 D-06 数值原语，`engine.ts` 组合 `materializeIndicatorActualValues`、`scoreAssessmentAxes`、`mapAssessmentRiskLevel`、`evaluateAssessmentTriggers` 和 `buildRiskAssessmentRecord`。函数接收已解析且兼容的正文，不做 I/O；失败抛出/返回带稳定 reason code 和目标 ref 的 C25 领域错误。`service.ts` 只定义 D-01 的窄接缝、artifact 受权读取组合和 `RiskAssessmentEngineV1` 用例接口，避免松散工具函数与多层 factory。

核心不导入 adapters、apps、LangGraph、Agent runtime 或数据库。公开子路径为 `@riskflow/core/risk-assessment/engine`；不修改根 `src/index.ts`。

**替代方案：**把所有逻辑塞入 PostgreSQL adapter 难以独立验证全配置边界；为每一步建 class/strategy 会过度抽象。一个纯计算深层模块和一个用例服务层足够。

### D-09：C25 只用 `000032` 增加不可变事实与关联表

迁移固定为 `packages/adapters/src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts`，不占用 `000033–000035`。新增：

- `business.assessment_preparation_snapshots`：公共快照 JSON、完整适用性元数据快照 JSON、risk input/project/spatial/applicability/monitoring refs、内容 digest、命令/授权/审计和三时态；
- `business.assessment_input_snapshots`：公共快照 JSON、preparation/basis/previous record refs、entry kind/effective time、22 引用摘要、内容 digest、命令/授权/审计和三时态；
- `business.indicator_actual_value_sets`：公共 ref、input snapshot ref、规范值集合 JSON、内容 digest、证据摘要和三时态；
- `business.assessment_decision_artifacts`：公共 decision ref、input/value-set refs、C04 content artifact ref、内容 digest和三时态；
- `business.risk_assessment_records`：公共 record ref、risk input branch/id、input/value-set/decision refs、记录 JSON、P/C 规范值、risk level、配置版本摘要、内容 digest、命令/授权/审计和三时态。

主键/唯一约束收口精确 ref、`(project_id, identity_digest)` 和一个 input snapshot 只对应一个正式评估；外键连接 C03 receipt/audit、本 change 快照和值/决策关系，JSON 类型、XOR、digest、非空和 branch check 在数据库再收口。应用角色只获 SELECT/INSERT，无 UPDATE/DELETE；provider 已递归发现迁移，不改中央注册。决策正文先写 C04，再在 D-10 事务内登记；孤儿 C04 工件不构成正式结果。

**替代方案：**拆四个迁移增加部署面；把所有正文放一个表弱化关系约束；原地更新 latest record 破坏重放。一个迁移和五张只追加表是当前最小持久化模型。

### D-10：prepare/evaluate 沿用 C03 原子命令、幂等、审计和 Outbox

`PostgresRiskAssessmentEngine` 实现公共 `RiskAssessmentPortV1`：

- `prepare` 的读取顺序固定为授权 → preparation context → C19 basis descriptors → C04 正文 → runtime policies → 全量兼容；随后以规范输入 digest 执行 C03 atomic command，保存 input snapshot、audit、receipt，并在 reassessment 的新旧监测 refs 集合或适用性 ref 确实变化时追加前置 change 演进后的 `engineering.assessment-input-changed.v1`。
- `evaluate` 的读取顺序固定为授权 → input snapshot → preparation/risk facts/monitoring → basis descriptors → C04 正文 → 二次兼容校验 → D-05～D-08 纯计算 → 决策正文先写 C04；随后单个 atomic command 保存 value set/decision link/record/audit/receipt 和 `assessment.recorded.v1`。assessment run ref 必须来自命令授权或 preparation 的相同因果运行；缺失或冲突失败闭合。

规范业务身份不含记录时钟：相同输入 snapshot 内容只得到一个 value set、decision 和 record 内容 digest；`(project, command kind, idempotency key)` 同载荷返回原公共结果，异载荷 `IDEMPOTENCY_CONFLICT`。数据库约束与 C03 receipt 共同处理并发。读取后提交前复验 basis、artifact digest、授权和需要有效的 release；任一失败不提交部分结果。

**替代方案：**为每个计算阶段独立事务会产生部分等级；把 C04 写入伪装为数据库原子不真实；让 C30 代替领域幂等会使其它调用方可绕过。工件先耐久、正式引用单事务成立沿用项目既有范式。

### D-11：授权、失败代码和审计保持闭合且不可枚举

所有入口先解析公共 Schema，再用 C06 `LocalIdentityAccessV1` 校验命令 actor/project、`risk-assessment.prepare|evaluate` 或 `engineering-data.assessment-preparation` 能力、空间与资料 grants；下游授权只能相同或收窄。内部 reason code 至少区分 invalid-input、risk-input-unavailable、snapshot-incomplete、monitoring-snapshot-coverage、basis-unavailable、runtime-policy-incomplete、artifact-mismatch、indicator-missing、indicator-ambiguous、unit-conflict、rule-coverage、numeric-unrepresentable、matrix-out-of-range、threshold-ambiguous、assessment-run-required；映射到公共 `AUTHORIZATION_DENIED|UNSUPPORTED_CONTRACT|BUSINESS_BLOCKED|STALE_VERSION|IDEMPOTENCY_CONFLICT|TRANSIENT_FAILURE|TERMINAL_FAILURE`。

普通错误、日志和事件只含稳定 stage/reason/target ref 或诊断 ref，不含正文、监测序列、凭据、SQL 和存在性。audit 保存 risk/basis/snapshot/config/rule/policy refs、输入/输出 digest、操作者、授权、因果运行和三时态；不保存模型思维链，因为计算链没有模型。

**替代方案：**开放 details 或完整错误文案路由会泄露并形成脆弱契约；C25 自建授权/审计表重复 C06/C03/C07 事实源。

### D-12：文件所有权与应用接入保持最小

新增 core `risk-assessment/engine`、adapter `risk-assessment/engine`、一个迁移及两类测试；修改两个 package manifest 增加同名子路径 export，并修改 C11 PostgreSQL adapter/index 的 assessment-preparation 分派与 reader。API 的通用 `risk-assessment.initial|reassessment|historical-backfill|evaluate` 路由已经存在，只做回归；当前 Worker 只有 Agent runner，C30 才拥有图与事件消费组合，C25 不新增空 runner；Web 由 C34 拥有，仅做无漂移检查。根导出、API/Web/Worker 生产文件、contracts、C14/C18/C19、迁移 provider 均不改。

**替代方案：**为“看起来完整”增加 API endpoint、Worker 空壳或 Web 页面会重复现有路由并越过路线所有权。现有 transport 足以调用注入的 `RiskAssessmentPortV1`。

### D-13：验证以边界表和一条真实 PostgreSQL 纵向链为中心

core 表格测试覆盖 XOR、映射唯一性/缺值/单位、C19 六类 scoring operator 与 grade 端点/无穷边界、正负 half-away、weighted/maximum、矩阵首/共享/末/越界、五种监测比较、三种 joint、四类同命中与输入乱序重放。adapter 集成测试复用 C03/C04/C06/C11/C14/C18 fixture，并在 C19 接口集成后使用其正式 reader/helper；一条 G2.5 fixture 以公共标准化风险记录 Schema 和正式 ref 走 PostgreSQL prepare/evaluate，断言记录/audit/outbox 可重建。测试 fixture 可以实现读取接缝，但不得进入生产导出或建立内存事实仓储。

只断言公共结果 kind/code/reason/ref/digest/事务事实，不锁错误全文、SQL 顺序、JSON 字段顺序或私有调用。额外运行 contracts、C11、C14、C18、API 路由、Worker、Web、迁移 provider 与依赖边界代表性回归；不启动开发服务器。

**替代方案：**为每个文案/函数写单测增加维护成本；只测纯函数无法证明原子性和正式端口。边界表加一条纵向链覆盖真实风险。

### D-14：RA 与后续交接映射固定

| 专利步骤/阶段 | C25 事实 | 后续交接 |
| --- | --- | --- |
| RA-S1 / A0 | RiskInput XOR、工程/空间/适用性/监测准备快照 | C11/C14/C19 按 ref 消费 |
| RA-S2～RA-S4 / A1～A3 | basis 成员、完整 input snapshot、indicator actual value set | 不回读 latest，不复制配置事实 |
| RA-S5 / A4～A5 | P/C、matrix cell、decision artifact、immutable assessment record | `assessment.recorded.v1` |
| RA-S6 / A4～A6 | 四类 trigger facts | C26 凭 assessment record ref 创建预警 |
| RA-S7 | 不在 C25 计算；C25 冻结 forecast/deviation refs 供后续 | C27～C29/C30 |

## Risks / Trade-offs

- [C19 当前五工件没有 C25 所需 basis reader] → 调度已裁决由 C19 有界修订并拥有该接口；C25 实现首门核对 D-03 全字段、授权、审计和导出，缺失即停止，不直读私表。
- [基线 assessment-preparation 命令无法提供快照必填入口语义且单监测 ref/单数变更事件无法覆盖多序列] → 等独立 `evolve-assessment-preparation-entry-fields` 归档后再实现；C25 只原样复制新增字段/refs，缺失必填或监测集合不完整即拒绝，变更事件只用前后 refs 集合。
- [C11 尚未提供正式外部风险事件登记/读取，C24 标准化记录 reader 也可能未接入] → 外部分支必须等待前置 `implement-external-risk-event-registration` 归档，标准化分支由 C24 正式 reader 注入；C25 不实现任何一侧事实仓储，G2.5 fixture 只验证接缝且不可替代生产所有者。
- [C14 当前无法按 series ref 受权读取指标/参数/规范单位] → 调度以 `implement-monitoring-series-reader` 在 C14 所有权内补窄 reader；C25 实现首门核符号、权限、审计和不可枚举语义，不改 C14 或猜 ref。
- [C19 当前未固定/导出评分区间唯一求值语义] → C19 修订必须在归档 spec 中定义端点并导出与冲突检测共用的纯 helper；C25 缺 helper 即停止，不重写比较。
- [后续 10 类 runtime policy 可能尚未发布] → provider 缺任一项即 fail-closed；这会阻断完整公共 input snapshot，但不会诱发默认或改变计算语义。
- [C01/C19 number 与 C18 canonical decimal 精度不同] → D-06 以标准 `BigInt` 展开公共有限 number 并保存精确中间量；不新增依赖或隐式舍入。
- [C04 与 PostgreSQL 无分布式事务] → 工件先耐久，只有数据库事务登记后的 ref 才是正式事实；孤儿工件可由 C04 生命周期清理，不作成功证据。
- [C11 单文件已较大] → 只加入一个既有 freeze 分派和窄 reader，计算/Schema/表映射留在 C25 feature；不借机重构无关 C11 路径。

## Migration Plan

1. 实现前确认 HEAD 仍基于 `01b2df23194c6203a1104fa2c898e266109d8365`，前置 `evolve-assessment-preparation-entry-fields`、`implement-external-risk-event-registration` 已归档，前者只完成裁决的入口四字段、复数 monitoring refs 与 input-changed 事件复数化，后者在 C11 所有权内提供正式登记/受权读取，`implement-monitoring-series-reader` 已在 C14 导出正式 reader，C19 已按 D-03 集成并导出 reader/helper，C11/C18 及其余 contracts 无漂移，`000032` 未占用；任一不满足立即升级。
2. 部署 `000032_deterministic_risk_assessment`，创建五张只追加表、约束、索引、外键和 `riskflow_app` 最小 SELECT/INSERT 权限；无回填，不修改旧表。
3. 发布 core/adapters 子路径和 C11 分派，在组合根注入正式 risk input、C19 basis 与 runtime policy providers；provider 未就绪时端口保持类型化失败。
4. 运行 G2.5 PostgreSQL 验收 fixture 和全部最小回归，确认标准化风险记录到 `assessment.recorded.v1`/audit 的可重建链后才允许 C26/C30 消费。
5. 应用回滚先停止 C25 新写入并回退应用；已成立的评估、审计和 Outbox 历史保留。仅在确认无下游引用后运行迁移 `down`，按外键反序删除 C25 自有表，不改 C03/C11/C14/C18/C19 历史。

## Open Questions

无。准备入口字段/监测集合契约演进、C11 外部事件登记、C14 series reader、22 类引用来源和 C19 reader/helper 义务已由协调端裁决；三个前置 change、C19 symbol、C24 标准化记录 provider、正式 runtime policies 与验收数据是否已集成均为实现前可判定硬门，不是可延后设计决定。
