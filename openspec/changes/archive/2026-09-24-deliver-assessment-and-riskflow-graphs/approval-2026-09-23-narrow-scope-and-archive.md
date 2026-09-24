# C30 收窄范围并归档批准记录（2026-09-23）

- 批准引用：`approval://riskflow/C30/finalization-2026-09-23-narrow-scope-and-archive`
- 批准来源：项目方裁决「收窄 + 归档（推荐）」：把 C30 无法在本轮闭合的场景写成明确的后续 change，同步 delta spec 使主规格与实现事实一致后归档 C30，以便解锁 C31–C38、G3–G5。
- 依据：`verification.md`（结论 BLOCKED，含可复现失败证据）、`approval-2026-09-23-nested-graph-interrupt.md`、`approval-2026-09-23-segmented-entry-refs-and-evidence.md`。

## 本轮规划变更的**唯一**目标：把未闭合项收窄成明确的后续归属

1. 在 delta spec 中，对以下场景明确标注为**由后续 change 承接**（保留 Requirement 的正常语义描述，但不得把未实现行为写成已达成）：
   - R2/S1（多风险父图扇出 + 真实 C24 同容器全链）；
   - R6/S1（同容器端到端验收）；
   - `forecast-response` 与 `record-response-feedback` 两个分段入口的**成功场景**（其精确引用可达性与 C28 命令输入缺口）。
2. 后续归属（协调端已登记，本轮只做引用，不展开设计）：
   - `fix-c24-nested-graph-interrupt-checkpoint-boundary`（C40）：C24 复核等待的 `GraphInterrupt` 冒泡破坏跨图检查点边界、同身份重试 `graph-state-invalid`；修复面在 C24 运行时/图或跨图检查点语义。
   - `wire-human-decision-and-feedback-commands`（C41）：C28 人工采纳决定与正式反馈命令的合法输入/路径缺口。
3. `verification.md` 与本收窄保持一致：BLOCKED 项显式写明「已转由 C40/C41 承接」，其余场景的证据保持不变，不得改动已通过的结论。
4. `tasks.md` 如实保留未完成项（8/13），不得为凑绿而勾选。

## 边界（本轮禁止）

- 不得实现 R2/S1、R6/S1 或两个入口成功场景；不得改 C24 运行时/图/跨图检查点语义；不得改 C28 契约/写路径/migration；不得新增 capability/角色/权限值；不得引入生产运行时依赖；不得改动已通过的门禁与测试基线以外的范围。
- 规划完成后由协调端审阅形成检查点；随后由 Finalizer 按 change 实际 schema 复核 `verification.md` 与本收窄一致，再进入集成与归档。
