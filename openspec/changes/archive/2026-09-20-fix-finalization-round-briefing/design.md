# Design

## Context

- `taskSpec(node, taskKind, envelopeOptions)` 生成 Orca Task 的 `spec`（即 worker 的派发说明）；它已能拿到节点快照，其中包含 `orca.attempts`（各尝试的 taskKind/issueRefs/evidenceRefs/runState）与 `auditRequired`（本轮是否仍需要审计）。
- 上一处修复后：本轮最多一次限定审计；`auditRequired` 为假且存在失败的审计尝试，即"本轮审计已出结论、当前应为修复"。
- 规则已写入主规格与手册，但 **worker 只读任务说明与 change 工件**，任务说明里没有协议就等于没送达。

## Goals / Non-Goals

**Goals:**

- 让执行者在派发说明里就能看到本轮协议与（修复时的）finding 清单。
- 不改动受控动作集合，不引入新的编排原语。

**Non-Goals:**

- 不实现"收尾会话等待审计"的自动化（那需要新的受控动作；本轮明确不做）。
- 不把 finding 正文内联进说明：只给 task id 与结构化引用，正文仍以 change 工件为准（避免同一内容两处维护）。
- 不改变信封字段、角色选择或阶段语义。

## Decisions

**D1：协议随派发说明送达，而不是靠协调端转述。**
上一轮 C26 的修复之所以闭合，是因为协调端额外写了 `tasks.md` 并发消息——那是人工补台。把同样的信息放进生成的任务说明，才是可重复的路径。

**D2：只引用 finding，不内联正文。**
说明里给出审计 task id、`issueRefs`、`evidenceRefs`，并要求逐项闭合；正文仍在 `verification.md` 与台账里，保持单一事实源。

**D3：修复尝试的判定用现成事实，不新增状态。**
判据：`node.auditRequired === false` 且 `node.orca.attempts` 中存在已收口且 outcome 为失败的 audit 尝试。取其中最新的一次作为本轮审计结论来源；无则视为首个收尾尝试。

## Risks / Trade-offs

- 说明变长（只在收尾/审计任务上），但省掉的是一整轮人工补台与返工。
- 若历史里存在跨轮次的失败审计，判据可能选中较旧的一次；当前 rounds 由获批 replan 边界分隔，实际影响限于展示哪一组 finding，修复尝试仍会逐项核对 verification。
