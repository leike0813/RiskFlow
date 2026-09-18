# gap-inbox · warning（P-WR，C34）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-WR-01（G2 契约字段 · 文档漂移）

- 缺口：`docs/PAGE-GUIDE.md` §3 写「预警触发：triggerType 为数组语义（可多个触发类型）」，与契约单值语义相反。
- 依据：`demo/v2/docs/PAGE-GUIDE.md:39`；`packages/contracts/src/records/index.ts:231`（`WarningRecordSchema.triggerType: WarningTriggerTypeSchema` 单值枚举）；`packages/contracts/src/vocabulary/index.ts:79-84`。
- 预设：fixture 按契约单值落实；v1 的数组 `triggerTypes` 经 `triggerIndicators` 逐项的 `triggerType` 结构化表达（见 `demo/v2/src/content/warning.ts` 头部注释与 WARN-2026-001）。
- 待确认：PAGE-GUIDE 该行是否改为「triggerType 为单值，多类触发经多条触发记录或 triggerIndicators 结构化字段表达」。
- 风险：后续批次若照 PAGE-GUIDE 数组语义写 fixture，会与契约校验冲突。

## GAP-WR-02（G2 契约字段）

- 缺口：`TriggerIndicatorSchema` 只有 `indicatorItem / triggerType / actualValue`，无阈值快照与越限方向；预警详情页必须呈现「实际值 / 阈值 / 越限方向」，阈值事实源在监测预警阈值版本里，契约层没有随触发指标固化。
- 依据：`packages/contracts/src/records/index.ts:197-202`；页面需求见本批 P-WR-02 触发指标卡（`demo/v2/src/pages/warning/WarningDetailPage.tsx`）。
- 预设：fixture 在契约字段旁携带展示用阈值快照（`threshold / exceedDirection / unit`），并显式引用监测预警阈值版本 `MWT-001 · v2026.08`（`demo/v2/src/content/warning.ts` 的 `WarningTriggerIndicatorView`）。
- 待确认：契约是否应在触发指标或预警记录上固化阈值版本与阈值快照，保证历史预警可重放解释。
- 风险：阈值版本更新后，历史预警详情按当前阈值重算展示会与开立时口径漂移。

## GAP-WR-03（G6 规格空白）

- 缺口：预警处置任务（warning-response-task）只有引用类型 `WarningResponseTaskRefV1`，契约无任务记录 schema，也没有任务状态机枚举；页面需要呈现「待确认 → 已确认 → 建议已采纳 → 处置执行中 → 反馈已登记 → 已闭环」及确认人。
- 依据：`packages/contracts/src/ports/index.ts:184-185`（仅 ref）；`packages/contracts/src/records/index.ts`（无任务记录）；确认不关闭任务的约束见 `openspec/specs/domain/module-interfaces-events-workflows/spec.md:346`。
- 预设：fixture 自定义展示状态机 `WARNING_TASK_STATUSES`（次序对齐 warning-response 各 record 分支推进），确认人来自 acknowledge 审计（`demo/v2/src/content/warning.ts`）。
- 待确认：任务状态机与确认人字段是否入契约记录 schema，或明确由投影层派生。
- 风险：各端各自派生任务状态会出现口径不一致（如把「确认」误作「闭环」）。

## GAP-WR-04（G2 契约字段）

- 缺口：通知意图（notification-intent）只有 `NotificationIntentRefV1`，渠道 / 接收角色 / 投递状态无契约字段；预警详情的通知投递卡需要这些字段。
- 依据：`packages/contracts/src/ports/index.ts:187-188`；`packages/contracts/src/events/index.ts` `warning.warning-recorded.v1` payload 仅含 `notificationIntentRefs`。
- 预设：fixture 自定义 `NotificationIntentView`（intentId / channel / recipientRole / status），接收角色取 contract-mirror 五角色键（`demo/v2/src/content/warning.ts`）。
- 待确认：通知意图记录字段是否入契约，投递状态枚举取值为何。
- 风险：通知状态展示无契约约束，可能与实际投递结果口径漂移。
