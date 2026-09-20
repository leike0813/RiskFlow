# Design

## Context

- 状态视图在 `currentSucceeded && currentKind === "finalization" && auditPolicy === "targeted"` 时给出"派发限定审计"的下一动作；`nextTaskKind` 用同样的条件返回 `audit`。
- 该条件只看**当前尝试**（检查点），看不到"本轮是否已经审计过"，因此审计失败并修复后必然再派第二次审计。
- 尝试集合（含 taskKind/runState）在节点投影的 `orca.attempts` 上可得；`taskSummary.scope` 已经按获批 replan 边界界定"本轮"。
- worker 在 `worker_done` 之后会话即结束；`RUNBOOK §84` 明确已结束的 terminal 不得作为后续任务上下文。因此"同一连续上下文"要求收尾会话在审计期间保持活动（由协调端回灌 finding），而不是事后新开一轮。

## Goals / Non-Goals

**Goals:**

- 同一收尾轮次最多一次限定审计，且审计发现由该轮次一次修完。
- 把"本轮是否还需要审计"做成单一事实源，供状态、角色选择和协调端同时使用。
- 纠正此前被固化的措辞（"保持责任" ≠ "可重复派发"）。

**Non-Goals:**

- 不改变 `auditPolicy` 的含义（它描述该轮次是否需要限定审计，不描述是否已执行）。
- 不在 v2 信封中新增字段：`auditRequired` 是状态视图的输出，不是信封字段。
- 不实现"worker 会话在审计期间保持活动"的自动化编排；本轮只把该义务写进提示词与协调端规则，并在机制无法满足时要求升级（自动化留作后续 change）。

## Decisions

**D1：`auditRequired` 由状态视图计算，control 侧只读该字段。**
"本轮是否已审计"需要尝试集合与边界，这两者状态视图已经算好。若 `nextTaskKind` 自行按 `orca.attempts` 再判一次，同一规则会有两处实现（且边界口径容易走偏），因此角色选择只消费状态视图给出的字段。

**D2：判定范围是当前 replan 边界内的尝试。**
`taskSummary.scope` 已按最新获批边界收窄；跨边界的旧审计不抑制新一轮的审计，边界之内一旦有已收口的 audit 就不再要求第二次。这与既有"新边界取代旧状态"的语义一致。

**D3：`auditPolicy` 保持原义，不用它表示"已审计"。**
把"已执行"塞进 `auditPolicy` 会让该字段同时承担策略与进度两件事，并使信封校验与回放语义变模糊；用状态输出的布尔字段表达进度更清楚，也不需要改 schema。

**D4：机制无法满足时升级，而不是自动化再开一轮。**
协调端可以在收尾会话仍活动时回灌 finding（`--to dispatch:<id>` / `reply`）。若会话已结束，合规动作是升级给用户；自动新建尝试或第二次审计正是本 change 要禁掉的行为。
