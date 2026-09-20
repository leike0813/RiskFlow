# C17 重开规划批准记录（2026-09-20）

- 批准引用：`approval://riskflow/C17/replan-2026-09-20`
- 批准来源：项目方在本会话明确批准「重开规划，把 C19 delegate 依赖与 allowlist 扩大纳入新的已批准规划版本」
- 被取代的尝试组：`C17:finalizing`
- 触发证据：`run_35094c6a15f3` 的 Finalizer worker 报告 `msg_9e588210c8cd`，产物 HEAD `ec97787a018a71912acd70164ae1607c55afac44`

## 触发事实

Finalizer 在已批准范围内完成核验与一处普通缺陷修复后，卡在如下边界：

- `PostgresIdentificationKnowledgeAdapter.resolve` 对 assessment-basis 返回 `UNSUPPORTED_CONTRACT`；
- 当前 main 已合入 C19 `PostgresScoringRulesAdapter` 的正式评估基准解析器；
- 使其可用需要以 delegate/组合方式接入 C19 的评估基准解析，并相应扩大该 adapter 的 allowlist。

该修复改变 C17 的依赖与批准范围，按本 change `implementation-plan.md` §7 / §8.1 的升级条件，不得由 Finalizer 自行补设计。

## 本次重开规划必须闭合的范围

1. 把 assessment-basis 解析改为经组合根注入的 C19 delegate 依赖；不复制 C19 解析规则，不在 C17 新建第二套评估基准解析。
2. 相应扩大 `PostgresIdentificationKnowledgeAdapter` 的 allowlist，并记录扩大的理由与影响面。
3. 据此更新 `design.md` 的决策，以及 `implementation-plan.md` 的 IP-ID、允许文件清单与验证命令，使施工图覆盖该变更。
4. 既有 Non-Goals、C08/C15/C11 所有权与 §7.1 保护区保持不变。

## 处置要求

规划者 MUST 把上述范围展开为可施工的 IP-ID、允许文件清单和验证命令。若认定其中任一项无法在 C17 已批准语义内闭合，MUST 在规划工件中显式说明并升级，而不是仅补齐模板章节。

本记录是重开规划的输入与批准凭据，不是设计结论；设计结论仍写入 `design.md`。
