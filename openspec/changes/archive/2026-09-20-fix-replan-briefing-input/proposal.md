# Proposal

## Why

重开规划（`replanApprovalRef`）只把批准引用写进信封，**没有任何通道把「为什么重开」送进规划任务**：`taskSpec` 生成的是通用文案，规划者既看不到被取代尝试升级出来的 `issueRefs`，也不知道存在一份必须读取并逐项展开的批准记录。

实测后果：C17 的重开规划被派发后，规划者只按模板补齐了 `implementation-plan.md` 的 Finalizer 授权与限定审计章节，**完全没有纳入 C19 delegate 依赖与 allowlist 扩大**这项已批准范围，规划工件看似「全部 done」却不覆盖批准内容，整轮白跑。

## What Changes

- `taskSpec` 在带 `approvalRef` 的规划任务中追加「本次为重开规划」段落：批准引用、被取代的尝试组、被取代尝试的 `issueRefs` / `evidenceRefs`，以及处置要求——先读该 change 目录中由 proposal 引用的批准记录，把其列出的范围逐项展开为 IP-ID、允许文件清单和验证命令；`worker_done` 必须逐项说明闭合情况。
- 处置要求同时明确：仅补齐模板章节不构成规划完成；批准范围内任一项若无法在既有已批准语义内闭合，必须显式说明并 escalation。
- 不带 `approvalRef` 的常规规划任务文案不变。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-controlled-actions`: 重开规划派发必须把批准范围与触发原因送入规划任务。

## Impact

- 代码：`scripts/orchestration/control.mjs`（`taskSpec`、`createTask`）、`scripts/orchestration/control.test.mjs`。
- 规格：`openspec/specs/operations/orchestration-controlled-actions/spec.md`（本 change 的 delta）。
- 不新增依赖，不改变信封字段、阶段转换、幂等或 Orca 契约；常规规划任务不受影响。
