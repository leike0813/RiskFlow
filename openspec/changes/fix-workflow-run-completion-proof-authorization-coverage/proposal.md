## Why

C41 登记正式反馈时，先用 C25 精确证明核对实际评估，再用 C30 的「运行完成证明」确认这条评估确由**已完成的运行**产生。该证明在回读运行状态行时按 `authorizationScopeDigest` **等值过滤**：只有调用方上下文的空间范围、来源授权与策略摘要与当初写入这些行的那份上下文逐字相同，才承认这条运行。

运行以**工程级范围**启动（人工会话的完整范围），而 C41 出面读取时按 C25 证明给出的**单个空间**收窄签发上下文。两者摘要必然不同，于是证明读不到运行状态行，按 `completion-not-established` 关闭失败，采纳闭环的反馈→偏差→校准尾段永远走不通。

根因不是某次接线写错，而是「等值比对」这一口径本身在真实部署里不可满足：任何按任务收窄范围的下游读取方都无法证明一条以更宽范围启动的运行。把授权问题等同于「上下文摘要相等」，把授权范围问题变成了身份比对问题。这是 C30 证明端口的授权语义缺陷。

## What Changes

- C30 的运行读取路径（精确绑定证明、运行完成证明）把「行摘要 == 调用方上下文摘要」的等值判定改为**覆盖判定**：调用方上下文的空间范围与来源授权 MUST 覆盖该运行已登记事实的范围，才承认这些行；跨工程、范围不足或来源授权缺失仍 MUST 拒绝。
- 覆盖判定 MUST 以逐项集合包含表达，不用摘要前缀、相近值或任何模糊匹配；判定失败与事实缺失保持同型失败，不枚举目标是否存在。
- `authorizationScopeDigest` 仍用于**写入**登记行（审计与追溯需要「这份事实是在哪份授权下写的」），只是不再用于**读取**时的准入。
- 非 **BREAKING**：判定放宽只发生在「同工程 + 调用方范围覆盖运行范围」这一方向；范围不足的调用方依旧读不到任何运行事实。

## Capabilities

- Modified: `domain/module-interfaces-events-workflows`（运行只读证明按覆盖而非等值判定授权范围）。
- Modified: `domain/human-decision-and-feedback-command-wiring`（正式反馈依赖的运行完成证明在收窄读取上下文下可用）。

## Impact

- 领域逻辑与适配器：`packages/adapters/src/workflow/postgres-workflow-adapter.ts`（`#latestRunStateWith`、`verifyResponseWorkflowBinding`、`verifyWorkflowRunCompletion`）、`packages/core/src/retrieval/service.ts`（覆盖判定的唯一构造）。
- 调用方：`packages/core/src/human-decision-feedback/service.ts`（反馈段读取上下文的范围口径保持不变，不因本 change 扩大自身签发范围）。
- 测试：`packages/adapters/test/workflow`、`packages/adapters/test/human-decision-feedback`。
- 无新增依赖、无新增表或迁移、无新增公共错误码。
- 阻塞面：`deliver-assessment-warning-and-response-ui` 的 4.1/4.2/4.4 在本 change 修复前不能勾选。

## 升级与授权边界

本 change 触及 `deliver-assessment-warning-and-response-ui` §7 明列的「授权需扩大」升级条件，因此 MUST 由用户明确裁决后才能实施：

- 允许的放宽方向只有一条：**同工程内，调用方已授权的空间范围/来源授权覆盖运行已登记事实的范围**。
- 不允许：跨工程读取、范围不足时降级为「尽力返回」、以运行引用或任何既有身份代替授权判定、为通过断言提高摘要容忍度。
- C41 自身签发的读取上下文范围不因此扩大；是否收窄仍由各调用方按任务需要决定。