## Context

固定基线为 `07d1a599ae91be781c490090dad2e8a77dc2f625`，实际 schema 为 `orchestrated-delivery`。C14 已提供精确监测快照和受权窄读，C18/C19 已发布并可读取 `forecast-policy`、`deviation-policy` 与风险矩阵成员，C25 已保存评估输入快照、指标结果和评估记录，C27 已保存正式建议及其预警、评估、空间和措施发布链。公共 contracts 已声明执行/反馈命令、预测/反馈输入快照及相应引用，但基线尚无 workflow-run/route-decision 生产存储，完整 LangGraph 属于 C30。

公共 `DeviationRecordSchema` 同时要求真实 `calibrationRecommendation` 和 `reviewStatus`，而这两项归 C29 的校准建议与治理闭环所有。协调者已确认：C28 只保存确定性私有偏差事实，禁止伪造公共偏差记录；C29 以后用稳定偏差事实和真实校准建议组合公共记录。研究输入仅为 `references/风险识别与评估规划事实源摘要.md`。

## Goals / Non-Goals

**Goals:**

- 在 C28 自有模块内闭合人工决定、效果预测、现场执行、反馈和确定性偏差事实。
- 全部结果只消费精确 C14/C18/C19/C25/C27 事实，保留建议 → 预测/执行 → 反馈 → 偏差的版本、证据、权限和审计链。
- 为 C30 提供真实领域能力，为 C29 提供稳定、可授权读取的偏差事实；不提前占有两者的运行或校准语义。

**Non-Goals:**

- 不修改 `packages/contracts`、权限映射、C14/C18/C19/C25/C27 事实或现有 HTTP 路由，不声明完整 `WarningResponsePortV1` 已接线。
- 不创建 workflow run、route decision、LangGraph、校准 Agent、公共 `DeviationRecord`、校准建议、配置发布或风险解除事实。
- 不引入依赖、默认甲方预测模型/参数、跨日等待状态机、Mock 生产后端或自动回退算法。

## Decisions

### D-01：C28 使用独立 `response-lifecycle` 深模块

新增 `packages/core/src/response-lifecycle`，集中 strict 私有 DTO、偏差纯计算、上下文/预测执行器接口与 `ResponseLifecycleServiceV1`；新增 `packages/adapters/src/response-lifecycle`，集中精确上游读取、C03 原子命令和 PostgreSQL 实现。服务暴露五个窄用例：`recordDecision`、`forecastResponse`、`recordExecution`、`recordFeedback`、`calculateDeviation`，不复制公共 `record` union，也不以一个开放 `execute` 分支承接任意动作。

`recordDecision` 接收公共 `adopt-recommendation` 命令和 D-04 已验证运行绑定；`recordExecution` 接收公共 `record-execution` 命令；`recordFeedback` 接收公共 `record-feedback` 命令及 C30 已完成的实际 C25 评估引用；`calculateDeviation` 接收公共同名命令但返回私有偏差事实结果。`forecastResponse` 使用私有 strict `ForecastResponseCommandV1`，字段固定为公共命令身份/授权信封、D-04 workflow binding、预测输入快照 ref 与正文；它不开放新的 HTTP DTO。C29 的私有读取只接受 request/idempotency 身份、当前授权和精确偏差事实 ref。C30/C29 后续只做公共命令与这些窄用例的类型化组合。

替代：扩张 C26 `warning` 或 C27 `recommendation` 会混合预警归集、候选生成和执行后闭环；直接实现整个公共 port 会伪装 C30/C29 尚未交付的分支。

### D-02：私有 Schema 只表达 C28 拥有的事实

`schema.ts` 定义并由 Zod 推导以下 strict 类型：

- `ResponseAdoptionDecisionV1`：正式建议、`adopted | declined`、原因、真实 route/run 引用、主体、时间、授权和审计；同一建议精确版本只能有一个终局决定。
- `EffectForecastV1` 与 `EffectForecastOutcomeV1`：预测输入快照引用、建议/基线评估、C18 策略和 `requiredRef`、方法、目标指标、规范预测值、单位、时域、预测风险状态、证据、摘要，或闭合不可用原因。
- `ResponseExecutionRecordV1`：公共 action source、建议决定或措施发布、执行/录入主体、工程/空间、发生时间和证据。
- `ResponseFeedbackV1`：执行、执行后监测快照、反馈工件、C25 实际评估、可用/不可用预测、发生时间和证据。
- `ResponseDeviationFactV1` 与 `ResponseDeviationFactRefV1`：建议/执行/预测/反馈、预测和实际目标值及风险状态、偏差策略、规范偏差值、有限 public number、`thresholdExceeded`、`actual-above | actual-below | equal`、证据、版本和摘要。

公共引用、`RiskStateSchema`、命令和输入快照均直接复用 `@riskflow/contracts`。私有偏差事实没有 `calibrationRecommendation` 或 `reviewStatus`，也不导出公共 `DeviationRecordRefV1`。

### D-03：精确上下文读取不产生第二事实源

`ResponseLifecycleContextReaderV1` 的 PostgreSQL 实现先复验 C06 当前主体/工程/空间，再按精确引用读取 C27 正式建议及其 C26/C25 链、C25 基线/实际评估与输入快照。监测正文通过 C14 `AssessmentMonitoringReaderV1`，评估配置集合通过 C19 `AssessmentBasisReleaseSetReaderV1`，`forecast-policy`、`deviation-policy` 与 `risk-matrix` 正文通过 C04 `ArtifactStoreV1` 按成员工件和摘要读取并以 C18 strict Schema 解析。

上下文必须逐项核对工程、空间、风险输入、评估依据集合、配置 release、目标指标、单位、业务时间和授权；不查询 latest，不从自由文案推断指标/类别，不更新 C14/C25/C27 表。适配器可以只读其 PostgreSQL 投影列，但核心只依赖该窄接口，不暴露 SQL 或通用仓储。

### D-04：C30 拥有运行，C28 只消费已验证绑定

C30 以后创建真实 route decision、workflow run 和公共 `ResponseForecastInputSnapshotV1` / `ResponseFeedbackInputSnapshotV1`，再以私有 `VerifiedResponseWorkflowBindingV1` 把精确引用、工程、建议和授权传给 C28。C28 只校验绑定与命令/上下文逐项一致并保存引用，不生成运行标识、不保存检查点、不实现重试状态机。

`declined` 决定只保存决定；即使公共适配层为了闭合结果拥有一个终态 workflow run，C28 也不创建预测输入或效果预测。C28 包导出真实服务供 C30 接入，但本 change 不修改 API composition root 或宣称现有 HTTP record 路由已具备生产实现。

### D-05：效果预测由精确版本执行器完成

`EffectForecastExecutorV1.forecast` 是一个私有版本化执行接缝，输入为 D-04 公共预测快照、D-03 解析的单个 C18 `ForecastPolicyV1`、基线指标/风险状态和 C14 执行前快照；输出只允许 D-02 的规范结果。实现按策略 `method` 和 `requiredRef` 分派已部署的 `historical-statistics`、`monitoring-trend` 或 `mechanism-model` 执行器，必须回显完全相同的目标指标、单位、时域、方法版本和证据。

缺少正式执行器、甲方模型/统计口径或输入时返回稳定 `unavailable`，不得换方法、调用 Agent、使用最新模型或基线冒充预测。测试可使用标明“合成样本、待甲方复核”的确定性执行器夹具；生产只有注入匹配 `requiredRef` 的正式实现才能产生 `available` 预测。

### D-06：执行和反馈由 C30 分段编排

已采纳建议执行先读取唯一 `adopted` 决定；`declined`、未决定或错版本建议失败。独立行动只接受同工程获授权的精确措施发布，不产生建议、决定或预测。两类执行均只追加，不关闭 C26 任务，不写风险解除。

反馈之前，C30 使用执行后 C14 快照和执行链原风险输入调用 C25 形成新的实际评估；随后把公共反馈命令与该精确评估引用交给 C28。C28 验证监测 cutoff/反馈发生时间不早于执行、实际评估与原风险输入/空间/冻结依据相容，再原子保存反馈。`warning.feedback-recorded.v1` 复用现有事件：可用预测携带真实 effect ref，否则携带稳定 unavailable reason；事件不复制正文。

### D-07：偏差计算是纯确定性逻辑且只产私有事实

`calculateResponseDeviation` 使用规范十进制 helper，禁止 JavaScript 浮点参与阈值决定：

- `absolute = abs(actual - predicted)`；
- `relative = abs(actual - predicted) / max(abs(predicted), minimumBaseline)`；
- `risk-level-step = abs(actualOrdinal - predictedOrdinal)`，等级序只来自同一冻结风险矩阵。

absolute/relative 比较同一预测目标指标和单位；risk-level-step 比较预测风险状态与 C25 实际评估风险状态。阈值相等视为未超过，只有严格大于才令 `thresholdExceeded=true`；方向按 `actual - predicted` 保存。无预测、值/单位/时域/依据不一致、无等级序或证据不足时返回 unavailable/失败且不插入偏差事实。

relative 的越限判定使用整数交叉乘法比较 `absDelta` 与 `threshold × denominator`，不先做除法；保存值按六位小数和 `half-away-from-zero` 规范舍入。absolute 保留规范差值，risk-level-step 保留安全整数；公共有限 number 只用于展示和 C29 组合，不能反向参与判定。

C28 不调用 `DeviationRecordSchema`，不生成公共 `DeviationRecordRefV1`。`ResponseDeviationFactReaderV1` 以精确私有 ref、当前 C06 授权和读取幂等身份返回 C29 所需的建议 ID、预测/实际风险状态、偏差值、阈值版本和证据；不提供列表/latest 查询。C29 负责加入真实校准建议与审核状态并形成公共记录。

### D-08：权限、错误、事务和审计全部复用基线

公共命令沿用既有 branch capability：决定/偏差使用 `warning-response.record`，执行和反馈使用各自现有 branch；内部预测沿用 C30 冻结且不扩大的授权，不新增角色或 capability。所有外部读取先授权，主体必须等于 C06 当前验证主体；无权、跨工程/空间/来源和目标不存在对调用方统一不可枚举。

每个 C28 写用例使用 `TransactionUnitV1`：业务事实、C03 命令回执、C07 audit entry，以及反馈分支的既有 Outbox 事件同事务提交。相同工程/分支/幂等键同载荷返回原结果，同键异载荷为 `IDEMPOTENCY_CONFLICT`；数据库唯一约束和必要的事务锁收口并发。沿用公共错误码：权限 `AUTHORIZATION_DENIED`、版本/决定冲突 `STALE_VERSION` 或 `BUSINESS_BLOCKED`、幂等冲突、短暂存储失败、契约/执行器漂移；不新增公共错误枚举。错误、日志和事件不含监测值、反馈工件正文、配置正文、SQL 或未授权存在性。

### D-09：`000046` 建五张只追加事实表

新增 `packages/adapters/src/postgres/migrations/warning-response/deliver-execution-forecast-feedback-and-deviation/000046_execution_forecast_feedback_deviation.ts`，实施前复验序号空闲：

1. `business.response_adoption_decisions`：建议、终局决定、route/run 引用与审计；建议精确版本唯一。
2. `business.response_forecast_outcomes`：预测输入引用、策略/执行器、available 预测或 unavailable 原因、摘要与证据。
3. `business.response_execution_records`：闭合来源、建议决定或措施发布、主体、空间、时间和证据。
4. `business.response_feedback_records`：执行、执行后快照、反馈工件、实际评估、预测可用性、事件关联与摘要。
5. `business.response_deviation_facts`：D-02 私有事实、偏差策略/阈值、越限判定、证据和摘要。

全部表使用精确版本、JSONB strict payload、digest、command/idempotency、授权、audit 与三时态列，外键连接 C27/C25/C14/C03/C07 现有事实；业务唯一键收口决定、相同冻结预测和相同 forecast/feedback/policy 的重复计算。只允许 INSERT/SELECT，提供最小 role grant 和逆序 `down`，不修改 `000045` 或更早迁移。中央 foundation/auth fixture 登记由主调度在集成检查点串行处理，Implementation 仅报告精确位置。

### D-10：文件所有权与最小验证

新增 core/adapters 的 `response-lifecycle` 子路径、D-09 迁移和各一组 core/adapter 测试；修改两个 package manifest 仅增加 `./response-lifecycle` 导出。C28 不改 `packages/contracts/**`、`apps/**`、其它领域模块、旧迁移、中央 fixture、根依赖/锁文件或 `openspec/config.yaml`。

core 表格测试覆盖 strict 私有 Schema、三种偏差公式/边界/方向、比较口径拒绝和预测执行器结果校验；PostgreSQL 纵向测试复用真实 C14/C25/C27/C03/C06/C07 前置，覆盖决定、可用/不可用预测、两类执行、反馈事件、稳定偏差读取、权限、幂等、并发和事务回滚。测试不锁定文案、SQL 顺序或内部调用顺序。

## Risks / Trade-offs

- C30 尚未实现，因此 C28 只交付可直接测试的真实领域服务与存储，不激活 HTTP record 路由；用伪 workflow ref 证明接线不算通过。C30 必须提供真实绑定后才能完成应用层入口。
- 正式预测执行器和甲方模型可能尚未交付；此时生产只能得到明确 unavailable，不能把合成测试夹具当正式预测。
- 公共 `DeviationRecord` 延后到 C29 形成；C28 的私有 ref 只在 core/adapters 内使用，避免在已有公共契约中制造第二种不完整偏差记录。
- 五表比单一 JSON 表多，但分别对应独立幂等命令和所有权边界，并使外键、唯一性和 C29 精确读取可由数据库验证。

## Migration Plan

先确认 base HEAD、`000046` 空闲以及 C14/C25/C27/C19/C04 精确读取接缝；再追加 D-09 迁移和 response-lifecycle core/adapter。运行真实 up/down、重复 up、旧数据保留、最小 grant、原子回滚与并发唯一测试；不回填旧建议或执行记录，不创建公共偏差/校准事实。主调度在集成时串行补中央 migration/auth fixture 并运行 PostgreSQL foundation 回归。

## Open Questions

无影响本 change 施工的未决语义。若实现需要改公共 contracts/权限、由 C28 创建 workflow run、让 C28 填公共偏差记录，或缺少 C14/C25/C27/C19/C04 的合法精确读取接缝，必须升级并停止对应实施项。
