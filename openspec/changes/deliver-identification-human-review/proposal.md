## Why

C22 已能把识别分组送入 C07 人工复核并消费最终决定，但目前没有一个受控识别复核模块把候选修正、证据调整、确定性重校验、决定提交与等待运行恢复信号闭合起来。C23 需要补齐这条 RI-S61～RI-S64 人工闭环，同时保持模型置信度只读、批量操作逐项隔离且不把技术失败伪装为业务复核结果。

## What Changes

- 新增识别人工复核深模块，以精确 `identification-group` 任务、目标版本和冻结验证/证据快照处理原样通过、修正并通过、确认合并、保持分立、拒绝和退回上游。
- 修正操作只允许改风险源、风险因素、风险事件、风险要素关系和冻结范围内的证据定位；`modelConfidence`、工序绑定、候选来源和版本事实保持只读。修正候选先形成不可变新版本并通过 C22 确定性校验，成功后才提交 C07 `approve-revised-candidate` 决定。
- 复用 C07 的逐项授权、幂等、事务、审计和 `review.review-resolved.v1` 事件；事件继续携带任务中冻结的等待运行引用，供 C24 恢复识别图。技术失败、校验失败或陈旧任务不提交决定，也不发出恢复信号。
- 提供有界批量原样通过/拒绝入口，但每项仍是独立的标准复核决定命令、事务、结果和审计，不增加跨任务大事务或第二套批量决定 DTO。
- 不修改公共 C02 契约、C05/C06 权限矩阵、C07/C22 持久化表或领域事件，不新增迁移、第三方依赖、HTTP 路由和 Web 页面。

## Capabilities

### New Capabilities

- `identification/human-review`: 规定识别分组的受控修正、证据调整、合并/分立决定、批量逐项决定、陈旧性保护和恢复信号闭环。

### Modified Capabilities

无。

## Impact

- 主要影响 `packages/core/src/identification/` 的 C22 候选事实窄接缝与新增 C23 复核模块，以及 `apps/worker/src/identification/` 的组合入口和对应测试。
- 复用 `@riskflow/contracts` 的 `ReviewDecisionV1`、`ReviewDecisionCommandV1`、`ReviewTaskRefV1`、`ModelOutputResultSchema`、`ReviewAuditPortV1`，以及 C22 候选/校验工件和 C07 现有事务事件。
- C24 负责消费既有恢复事件并实现 I0～I9 图；C31/C33 分别负责查询投影/报告和 Web 交互。本 change 不提前实现这些后续范围。
