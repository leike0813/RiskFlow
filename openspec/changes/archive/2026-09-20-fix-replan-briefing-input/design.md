# Design

## Context

- `riskflowDispatch` 在携带 `replanApprovalRef` 时走 `createTask`，以 `{ approvalRef, supersedesAttemptGroup }` 生成 planning v2 信封；`createTask` 用 `taskSpec(node, taskKind)` 拼任务说明并写入 Orca Task 的 `spec`。
- `taskSpec` 是纯文案函数，只包含工作项、change、工作树、输入 HEAD、角色职责与通用禁令。
- 被取代尝试的 `issueRefs` / `evidenceRefs` / `attemptGroup` 都在 `node.checkpoints` 上，控制器已经持有；批准记录的正文由协调端在 change 目录中维护，并由 proposal 引用。

## Goals / Non-Goals

**Goals:**

- 规划者在没有额外人工提示的情况下知道本次重开规划要闭合什么，以及去哪里读批准记录。
- 让「只补齐模板章节」在任务说明层面就构成未完成，可被规划者自身与协调端识别。

**Non-Goals:**

- 不把批准记录正文复制进任务说明：正文属于 change 工件，任务说明只给引用与触发原因，避免两份事实源。
- 不改变信封字段、阶段转换、幂等键或 Orca 契约。
- 不改变常规（非重开）规划任务的文案。

## Decisions

**D1：只传引用与触发原因，不内联批准正文。**
`issueRefs` / `evidenceRefs` 与 `approvalRef` 已经是控制器持有的结构化事实；批准正文留在 change 工件里由规划者按 contextFiles 读取。内联会造成同一内容两处维护，并让任务说明随工件变化而失真。

**D2：在任务说明里显式要求逐项闭合与逐项报告。**
上一轮的失败模式不是"没读到文件"，而是"按通用职责补齐模板即认为完成"。把闭合要求写进任务说明，使规划者的默认路径就包含核对批准记录。

**D3：段落仅在有 `approvalRef` 时追加。**
常规规划任务不应被要求读取不存在的批准记录；用 `nonEmptyString(approvalRef)` 作为唯一开关，与信封里的 replan 边界定义保持一致。

## Risks / Trade-offs

- 任务说明变长；重开规划是低频路径，且这段文字直接影响成功率，长度可接受。
- 「批准记录由 proposal 引用」是一条约定而非强制结构：若协调端忘记在 proposal 中引用，规划者可能找不到记录。约定与 `proposal.md` 的实际写法一致，并在本 change 的 delta 中明确要求；如需更强保证，应另行评估把记录位置写进信封字段。
