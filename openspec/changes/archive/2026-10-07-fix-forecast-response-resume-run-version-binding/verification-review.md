# 当前工作树核验：预测恢复等待点版本绑定

> 历史工作树核验记录。修复现已提交为 `c54e3dc995e2500c2408cfd7450a571819b1750b`，正式结论与当前流程状态以 [verification.md](verification.md) 为准。

日期：2026-10-07。输入 HEAD：`8855c23b8d6616d208d9b1b24e4b86cb3e3780e5`；对象为该 HEAD 与本轮未提交的关联修复。本文不冒充正式固定检查点 verification。

## 结论

等待点版本修复的已核验行为通过，未发现该 change 未修复的行为缺陷。正式归档状态 **BLOCKED**：tasks 8/9，7.2 尚未执行，尚无包含修复的固定 Git 实现检查点。

`waitStateVersion` 与真实 waiting、workflowRunRef 同源，由 C30 启动等待结果交出。C41 将其冻结在绑定和终局决定中，恢复提交该值作为 expectedStateVersion；缺失、错配或陈旧失败闭合，不读最新状态代替冻结版本。绑定证明保持精确运行、等待引用和决定核对。

| Requirement / Scenario | IP-ID / 证据 | 结果 |
| --- | --- | --- |
| 工作流生命周期；等待决定后以原运行恢复 | IP-01/02/05；contracts、core/workflow、Worker runtime/composition、C41 adapter | 通过：恢复同一运行，不重建预测分段。 |
| 等待结果交出可恢复的等待点状态版本 | IP-01/02/06；Worker risk-flow runtime 与 contracts waiting 用例 | 通过：状态版本不使用运行登记引用版本。 |
| 以陈旧等待点版本恢复被拒绝 | IP-04/06；Worker risk-flow runtime、C30/C41 adapter | 通过：版本冲突不推进、不改用 latest。 |
| 检查点与业务事实不一致；取消和技术失败保留追溯 | IP-06；assessment/risk-flow runtime/composition | 通过：原已成立事实和重试身份保留。 |
| 人工决定命令真实绑定；人工采纳后启动预测分段 | IP-03/04/07；C41/C28 回归、真实采纳→预测→执行/反馈 browser | 通过：真实 forecastRun 和效果预测可回读。 |
| 采纳绑定冻结等待点状态版本 | IP-03/04/05/06；core/human-decision-feedback、C41 与 C30 adapter | 通过：绑定、决定与恢复使用同一等待点值。 |
| 人工拒绝到此结束 | IP-04/06；human-decision-feedback core/adapter | 通过：拒绝不产预测运行或执行事实。 |
| 缺少或错配绑定时拒绝决定；缺少等待点状态版本时失败闭合 | IP-05/06；C30 binding proof 与 C41 adapter | 通过：不能借运行引用版本或其它运行的状态版本恢复。 |
| 等待中的预测运行不先于决定执行；非人工决定恢复不能越过等待门 | IP-02/04/06；Worker waiting gate 与 C41 回归 | 通过：等待门与合法恢复原因保留。 |

## 核验期关联修复

C34 页面先前仅接受 succeeded，合法 waiting 结果被客户端错误解码为失败；启动操作现接收真实 waiting.workflowRunRef 导航，不伪造结果。页面执行/反馈闭环使用真实版本与证据，采纳后读到真实预测，校准批准沿真实 C07/C29/C16 接缝只生成未发布草案。这些是 C34 的边界补全，没有改变本 change 的等待版本契约。

## 验证

- 18 文件定向核心/适配器/Worker 回归 322 通过，包含 module-interfaces waiting 契约、C30/C41/C28 与两个 Worker 组合根；完整命令见 [C34 工作树报告](../2026-10-07-deliver-assessment-warning-and-response-ui/verification-review.md)。
- 最终 C25/C30 回归 3 文件 74 通过，覆盖冻结等待点绑定、完成证明、授权与最新运行读面。
- 最终真实浏览器完整回归 68 通过、0 失败（零重试，8.2m）；混合触发与单独风险等级都经三项约束、正式建议、人工采纳及原预测运行恢复，并在 UI 完成执行/反馈、偏差/校准及真实批准后的未发布草案。没有修改默认风险接受阈值规避失败。
- heap 12GB 类型检查、前后端构建、lint、格式、依赖边界/策略、本 change strict 校验通过。
- 本轮已进行一次权限/关键运行状态限定审计；没有改变等待门或用最新状态恢复。

当前工作树没有已知未解决的本轮行为问题。归档、返回 C34 勾选及正式 verification 的固定检查点前置仍未完成；完整命令、修复清单与结果见 [C34 工作树报告](../2026-10-07-deliver-assessment-warning-and-response-ui/verification-review.md)，不据历史 tasks 中的旧数量自动归档。
