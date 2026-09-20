# Proposal

## Why

现行规格只写了「普通实现缺陷 MUST 保留在当前 Finalizer 责任链中」，没有写明**同一收尾轮次内允许几轮限定审计、发现的问题由谁在哪次会话里修完**。这个缺口被我在 C26 上放大成了一条错误的执行路径：

- 限定审计发现缺陷 → 我把审计收口为 `failed` → 状态机再派一个新的 finalization 尝试；
- 新 Finalizer 修完 → `auditPolicy: targeted` 又要求审计 → 派**第二次**审计；
- 第二次审计再发现问题 → 又要再派一轮。

结果是同一收尾被重复派发（C26 一共派了两轮 Finalizer、两轮审计）。而项目里其实早有约定，只是只记在归档 change 里：

> `openspec/changes/archive/2026-08-31-deliver-postgresql-outbox-and-checkpoint-foundation/tasks.md:39`：「验证发现的批准范围局部缺陷可在**同一连续验证上下文中直接修复**…**不重复派发第二次 Sol 复检**」
> 同 change `verification.md:7`：「依据当前用户约定，不重复派发第二次 Sol 复检」

这条约定从未提升到 `AGENTS.md` / `HANDBOOK` / 主规格；我也没有遵守它，还专门开了 change（`fix-verification-loop-bookkeeping`）把"审计失败后可再派修复尝试"写成规格要求，等于把偏差固化。

## What Changes

- **规则入规格**：同一收尾轮次内，限定审计最多一次；审计发现的普通缺陷 MUST 在同一收尾轮次内一次修完；MUST NOT 为同一收尾重复派发新的 Finalizer 或第二次审计；机制上无法在会话内完成时 MUST 升级给用户，MUST NOT 自行再开一轮。
- **责任语义修正**：审计未通过时责任仍留在收尾链（这点不变），但"保持责任"不得再被解释为"可以重复派发"。
- **状态机可执行化**：状态视图显式给出 `auditRequired`；同一收尾轮次内已存在**已收口**的 audit 尝试时，成功收口的 finalization 直接进入已验收态（可集成），不再要求第二次审计；`nextTaskKind` 据此选择角色，不再凭"检查点是 finalization 且 targeted"就一律再派审计。
- **提示词**：finalization/audit 任务说明写明这条规则（审计发现在同一会话内修完、禁止重复派发、无法在会话内完成则升级）。

## Capabilities

### New Capabilities
<!-- 无新增能力。 -->

### Modified Capabilities
- `operations/orchestration-execution-status`: 新增 `auditRequired` 与"每轮最多一次审计"的判定，并修正"审计未通过保持收尾责任"的措辞。
- `operations/orchestration-controlled-actions`: 新增"同一收尾轮次禁止重复派发"要求，并让角色选择据此收窄。

## Impact

- 代码：`scripts/orchestration/status.mjs`、`scripts/orchestration/control.mjs`、两个测试文件。
- 文档：`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`（§5 收尾段）、`AGENTS.md` §3.1。
- 规格：两个 main spec 的 delta（其中一处为 MODIFIED，用于纠正此前被固化的措辞）。
- 不新增依赖；不改变阶段顺序、尝试组边界、活动写者判定或 Orca 契约；状态输出新增一个字段 `auditRequired`。
