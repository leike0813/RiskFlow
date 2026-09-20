# Design

## Context

- `taskSummary` 先按阶段顺序取最大阶段（`phaseRank`），再在该阶段内取最大 `attempt`，最后按创建顺序在并列者中挑选。
- finalization 与 audit 的 `phase` 都是 `finalizing`（`taskPhase` 的映射），因此两者落在同一阶段内比较。
- `createV2Envelope` 让 audit 使用独立尝试组 `<id>:audit` 并从 attempt 1 起算，而 finalization 组 `<id>:finalizing` 已经累加到更高次数——跨组比较必然让 audit 落败。
- 既有 replan 边界规则已经确立了「新尝试组取代旧尝试组」的先例（`currentTaskWindow`）。

## Goals / Non-Goals

**Goals:**

- 同一阶段内的第二种责任（audit）一旦派发就成为当前尝试，使限定审计可被收口。
- 与既有 replan 边界语义一致，不引入第二套"谁更新"的判定。

**Non-Goals:**

- 不改变阶段顺序、replan 窗口、活动写者判定或信封字段。
- 不改变组内 `attempt` 的递增规则（仍在 `createV2Envelope` 中按组累加）。
- 不为"组边界相同"这种歧义情形发明新裁决。

## Decisions

**D1：用尝试组边界定界，而不是把 attempt 改成阶段内计数。**
把 attempt 改成阶段内计数会让「尝试次数」在两个含义之间摇摆（组内递增 vs 阶段内递增），并让审计/修复循环的编号语义变得难以推理。组边界本身就是责任的边界，用它与既有 replan 规则共用同一套直觉。

**D2：组的边界取组内最新创建时间。**
"最新的组"应当以该组最后一次推进为准：一个组可能包含多次尝试，只有最后一次的时间才能表达它相对其它组的先后。取最早会把仍在推进的组误判为陈旧。

**D3：信息不完整时回退，不猜测。**
任一相关尝试缺少 `createdAt` 时无法比较组的新旧，此时回退到既有选择逻辑（按 attempt 与创建顺序），宁可保守也不凭不完整信息跨组选定。这与「无法唯一确定当前尝试时 fail-closed」一致。

## Risks / Trade-offs

- 边界定界会缩小 `current` 的范围，`failed`/`blocked`/`active`/`allSettled` 等派生量随之只反映最新责任组；这正是期望语义（审计阶段不该被已收口的 finalization 结论左右）。
- 若某个流程故意把两种责任写进同一尝试组，本 change 不改变其选择结果（同一组走原逻辑）。
