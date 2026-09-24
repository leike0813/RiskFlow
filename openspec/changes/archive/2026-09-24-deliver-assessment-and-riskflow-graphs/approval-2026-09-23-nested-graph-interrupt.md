# C30 收尾轮第三次批准记录（2026-09-23：嵌套 C24 图中断与检查点边界裁决）

- 批准引用：`approval://riskflow/C30/finalization-2026-09-23-nested-graph-interrupt`
- 批准来源：协调端裁决（依据 Finalizer escalation `msg_cb576ce56351`、报告 `msg_b1db6fd3f381` 与其可复现证据）。
- 前置：`approval-2026-09-23-segmented-entry-refs-and-evidence.md` 三项已按裁决执行；本轮在真实同容器装配下复现出阻断性缺陷。

## 一、复现事实（Finalizer 证据）

在同一 PostgreSQL 容器内装配真实 C24 与真实 C30 父/评估图后，`pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts -t "真实 C24 与 C30 同容器"` 稳定失败：
- C24 复核等待抛出的 LangGraph `GraphInterrupt` 冒泡进父图；C30 父图的业务状态停在 `waiting`，而检查点报 `running` ⇒ 跨图检查点边界被破坏。
- 同一身份重试 C24 时在其 `readCheckpointState` 报 `CONTRACT_INVALID: graph-state-invalid` ⇒ C30 侧单方 catch/retry 无法安全闭环。

结论：修复需要改动 **C24 运行时/图**，或改动跨图检查点语义 ⇒ 超出本 change 已批准范围，**本轮不得就地修复**。

## 二、裁决

1. **R2/S1 与 R6/S1 维持 BLOCKED**，`verification.md` 保留该失败证据（可复现命令 + 报错 + 边界分析），不得据替身测试记 PASS，也不得保留不安全的实验性改动（Finalizer 已按此清理）。
2. **不得**在本 change 内改动 C24 运行时、图或跨图检查点语义，**不得**在 C30 侧用 catch/retry、伪造检查点或降级语义掩盖该缺陷。
3. 该缺陷由**另开 change**（C24 嵌套图中断与跨图检查点边界）承接；C28 人工决定/正式反馈命令输入缺口同样由其**另开 change**承接（两者均由协调端登记，不在本 change 内扩权）。
4. 两个分段入口的成功场景（`forecast-response` / `record-response-feedback`）在本轮同样维持 BLOCKED：其精确引用的可达性证据与 C28 命令输入均不可得，按前一份记录的门禁语义处理。
5. `tasks.md` 如实保留未完成项（当前 8/13）；`verification.md` 结论为 BLOCKED，逐场景证据、失败命令与边界必须可复核。
6. 本轮不执行限定审计（无符合策略的审计触发条件）；同一收尾轮次最多一次限定审计的纪律不变。

## 三、待项目方决定的范围问题（不在本记录内自行处置）

本 change 归档前需要先让主规格与实现事实一致：或将 R2/S1、R6/S1 与其入口成功场景**收窄为明确的后续 change**（并同步 delta spec），或**等两个后续 change 落地后再归档**。该取舍影响 C31–C38、G3–G5 的解锁时间，须由项目方裁决；协调端在得到裁决前不归档 C30、不回收其工作树。
