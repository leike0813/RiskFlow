# Proposal

## Why

上一处修复把"同一收尾轮次最多一次限定审计、禁止重复派发"写进了规格与状态机，但**派发时并没有把本轮协议告诉 worker**：

- 首个 finalization 尝试不知道自己处在一个"最多一次审计"的轮次里；
- **修复尝试**（本轮已有失败审计之后的那次 finalization）在任务说明里看不到任何 finding，只能靠自己去翻 `verification.md` 猜要修什么——实测 C26 的修复尝试之所以能闭合，是因为我额外把范围写进了 `tasks.md` 并发了协调消息，属人工补台；
- audit 尝试不知道自己是本轮唯一一次，也不知道只该报告 finding、不改产品代码。

规则落在文档与状态机上，但执行 agent 拿到的说明里没有它，等于把协议留给协调端口头传达——这正是上一轮"来回摩擦"的来源。

## What Changes

- `taskSpec` 在收尾/审计任务里写明本轮协议：本轮最多一次限定审计、禁止期待或请求第二轮、finding 的处置路径与 escalation 条件。
- **修复尝试**的任务说明直接列出本轮限定审计的 finding 与证据引用（审计任务 id、`issueRefs`、`evidenceRefs`）并要求逐项闭合；不再要求 worker 自行猜测。
- audit 任务说明写明：它是本轮唯一一次限定审计，只报告 finding 与证据（不改产品代码），结论写入同一 verification，供本轮修复尝试逐项闭合。
- 首个 finalization 尝试的任务说明写明：若本次修改触及 permission/transaction/critical-state-machine/semantic-merge，本轮会由协调端触发一次限定审计；你交付的 verification 必须为它留出结论位置。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 派发收尾/审计任务时必须写明本轮协议与（修复尝试的）finding 清单。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`taskSpec` 及 `createTask` 的传参）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖、不新增受控动作、不改信封字段；只改派发说明的生成。
