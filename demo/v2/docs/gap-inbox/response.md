# gap-inbox · response（P-RS，C34）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-RS-01（G6 规格空白）

- 缺口：处置效果预测（effect-forecast）在契约中仅有引用类型 `EffectForecastRefV1`，无记录 Schema；预测后风险状态、预测窗口、逐指标预测值、预测依据均无契约字段。
- 依据：`packages/contracts/src/ports/index.ts:196-197`（仅 ref）；预测输入快照字段见 `packages/contracts/src/workflows/index.ts:176-188`；页面需求见 `demo/v2/src/pages/response/PredictionDetailPage.tsx`。
- 预设：fixture 自定义 `EffectForecastView`（forecastId / 处置建议与采纳决定引用 / 处置前监测快照 / 冻结评估依据 / 预测策略版本 / 预测后 RiskState / 逐指标预测），见 `demo/v2/src/content/response.ts`。
- 待确认：效果预测记录是否入契约记录 Schema，还是明确由预测评估运行的结果工件承载。
- 风险：各端各自组织预测字段，P-RS-03 与后续批次展示口径可能漂移。

## GAP-RS-02（G6 规格空白）

- 缺口：执行记录（execution-record）与反馈记录（feedback）在契约中仅有引用类型，无记录 Schema；记录本体字段只能以 record-execution / record-feedback 命令 payload 推断。
- 依据：`packages/contracts/src/ports/index.ts:199-203`（仅 ref）；命令 payload 见 `packages/contracts/src/ports/index.ts:1542-1562`；页面需求见 `demo/v2/src/pages/response/ExecutionRegisterPage.tsx`、`FeedbackDetailPage.tsx`。
- 预设：fixture 自定义 `ExecutionRecordView`（含 ActionSource 判别联合）与 `FeedbackRecordView`（含处置后监测快照、反馈材料、实测指标），字段名对齐命令 payload，见 `demo/v2/src/content/response.ts`。
- 待确认：执行记录是否应固化「执行措施子集 / 未执行措施及现场核查结论」字段（当前 fixture 以 `executedMeasureIds` / `skippedMeasureNote` 预设）。
- 风险：执行与反馈的入库字段若无契约约束，重放与审计取证时无法校验登记完整性。

## GAP-RS-03（G6 规格空白）

- 缺口：校准建议（calibration-suggestion）在契约中仅有引用类型 `CalibrationSuggestionRefV1`，无记录 Schema；建议内容、目标知识对象与调整内容、确定性校验结果无契约字段。
- 依据：`packages/contracts/src/ports/index.ts:208-209`（仅 ref）；创建成功结果含复核任务引用见 `packages/contracts/src/ports/index.ts:2221-2225`；页面需求见 `demo/v2/src/pages/response/CalibrationDetailPage.tsx`。
- 预设：fixture 自定义 `CalibrationSuggestionView`（建议摘要 / targetKnowledge 目标知识与调整内容 / Agent 任务来源与模型、提示模板、工具、预算策略版本 / validationResult / reviewTaskRef），见 `demo/v2/src/content/response.ts`。
- 待确认：校准建议记录 Schema 是否入契约，以及「复核批准仅创建知识修订草稿」的生效链路是否需要在记录上显式表达。
- 风险：校准建议内容无契约约束，人工确认入口所依据的字段可能跨端不一致。

## GAP-RS-04（G2 契约字段）

- 缺口：`ResponseRecommendationSchema.implementationOrder` 仅记录措施顺序数组，无排序依据字段；页面要求呈现「排序依据」。
- 依据：`packages/contracts/src/records/index.ts:252-266`；页面需求见 `demo/v2/src/pages/response/RecommendationDetailPage.tsx` 建议组合与排序卡。
- 预设：fixture 在契约字段旁携带展示用 `orderingBasis`，注明由处置生成策略对措施库候选约束组合给出，见 `demo/v2/src/content/response.ts`。
- 待确认：排序依据是否随建议入库固化（保证历史建议的排序可解释），还是由投影层从生成策略推导。
- 风险：生成策略版本更新后，历史建议的排序理由无法从记录本身还原。

## GAP-RS-05（G2 契约字段 · 跨域 fixture 叙事漂移）

- 缺口：预警域 fixture 中处置任务 WRT-2026-001 状态为「已确认」、时间线止于「处置建议 RESP-2026-001 记录，三项校验通过，待采纳」；本域按典范链要求 RESP-2026-001 已登记采纳决定（RD-2026-001）并推进至执行 / 反馈 / 偏差 / 校准，两处叙事存在先后漂移。
- 依据：`demo/v2/src/content/warning.ts:354-376`（WRT-2026-001 status `acknowledged` 与 timeline）；`demo/v2/src/content/response.ts`（RESP-2026-001 adoptionDecision、EXE-2026-001、FBK-2026-001、DEV-2026-001、CAL-2026-001）。
- 预设：本域时间线自 2026-08-27 09:52 采纳决定续接；预警域 fixture 视作采纳前时刻的视图快照。
- 待确认：预警域 fixture 是否应补登采纳后事件（建议已采纳 → 处置执行中 → 反馈已登记），或明确处置任务状态以处置域事实为准。
- 风险：评审沿典范链跳转时会看到「待采纳」与「已采纳」并存，可能被误认为状态机错误。
