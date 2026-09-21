# Verification Report: fix-orchestration-recovery-skill

验证对象：`fix-orchestration-recovery-skill`

实际 schema 为 `spec-driven`，只声明 proposal、specs、design、tasks；`openspec instructions verification --change fix-orchestration-recovery-skill --json` 返回 `Artifact 'verification' not found in schema 'spec-driven'`。本文件是补充核验记录，不冒充 schema 工件状态。

核验基线为 `388407a2e07f438fc6ceb97e6c6a2501785ae09c`，核验对象包含该提交后的当前完整 worktree diff；最终产物 HEAD 由受控 settle 信封记录。

## Summary

| 维度 | 结果 |
| --- | --- |
| Completeness | PASS：tasks 全部完成；delta requirements、scenarios、项目 Skill、Handbook 与 Runbook 已同步 |
| Correctness | PASS：86 项调度回归、OpenSpec strict、格式、lint、doctor、Skill 校验和 diff 检查通过 |
| Coherence | PASS：未引入依赖、执行图路由、业务模块或新状态存储；恢复的 session 纪律与受控工具边界一致 |

## 实现与验证证据

| 范围 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 七个受控工具 | `control.mjs` 导出唯一清单；OMP 扩展注册 status、dispatch、wait、reply、settle、integrate、reconcile | doctor 输出七个工具；控制器回归验证清单 |
| 受控回复与 Delivery | reply 绑定当前 Run、revision 和幂等键；wait 用 `ackDeliveryId` 先确认上一批再等待，且整体登记为 write approval | 成功、重放、过期拒绝和 Delivery 续读回归通过 |
| Codex 工作区信任 | Planning、Finalizer、Auditor 先创建 terminal、等待 idle，再 `worker-start --terminal`；信任阻塞保留 queued Task | 信任提示时 worker-start 为 0；确认后复用当前 queued Task 和精确 terminal |
| reconcile 与 stale cleanup | reconcile 只放行两类安全漂移；cleanup 严格校验后关闭精确 terminal、重读并要求同一 worktree reclaimable | duplicate writer 不可绕过；脏树、漂移和关闭失败均 fail-closed |
| 状态投影 | dirty auxiliary 不误判 merged；只有同 Task 没有 live Dispatch 时，历史 failed Dispatch 才触发恢复 | 新回归覆盖旧 failed Dispatch 与当前 live Dispatch 并存，状态保持 running |
| session 隔离与限定审计 | 每个独立 Task 新 session；Auditor 在自身活动 Task 内闭合普通 finding；失败 audit 转 paused 并升级 | 状态与任务说明回归验证不会复用旧 Finalizer 或自动派第二轮 |
| 项目级 Skill | 单文件 Skill 包含冷启动、状态分流、七工具、事件循环、session 边界、stale 回收 | quick validation 通过；`.gitignore` 只豁免目标 Skill |

## Handbook 历史审计

Git 历史确认这次异常来自规则重构回归，不是操作员记忆偏差：

- `1f15eeb` 明确规定一个独立规划或验证任务使用一个新 session，禁止复用已结束、暂停、释放或久置的 terminal、Run、Dispatch 和上下文；同时规定活动 Agent 正常情况下只通过事件等待。
- `6aab917` 增加新 worktree 首次启动 Codex 时先完成工作区信任、再 worker-start 的六步流程。
- `62485be` 将 Handbook 从 363 行重构为 205 行；其 design D-09 要求把有效操作经验迁入 Runbook，但 session 隔离、活动 Agent 非干扰和信任预热没有完整保留到可执行控制层。
- `03303c1` 恢复了部分 Runbook 文字，但控制器仍直接 worker-start，文档与实现继续漂移。
- `12c9bb1` 又加入“把审计 finding 回灌旧 Finalizer 连续上下文”，与 `1f15eeb` 的独立 Task 不复用规则冲突。

本 change 恢复仍有效的当前规则：只处理实时队首且不预建未来 Agent；协调动作由主调度自己完成；每个独立 Task 使用新 session；活动 Agent 不受无关输入干扰；Auditor 在自己的 Task 内修复普通 finding；依赖门重新写明版本、许可证、来源、离线方式和退出条件。动态进度、旧模型名、固定 HEAD 和旧命令实例没有恢复。

## 审计 finding 处置

### 旧 failed Dispatch 覆盖 live Dispatch

已修复。状态层先筛选当前 Task 的全部 worker；只要其中仍有 live worker，就不使用历史 failed worker/Dispatch 触发 reconcile。新增混合状态回归，旧实现会得到 blocked，修复后得到 running。

### `riskflow_wait` 权限层级错误

已修复。因为可选 `ackDeliveryId` 会持久修改 Delivery 状态，`riskflow_wait` 整体由 read tier 提升为 write tier；无 ack 的调用也保持同一工具权限，避免参数驱动的权限漂移。

### 审计修复回灌旧 Finalizer 上下文

历史复核后认定为规则回归并修复。控制器任务说明、状态投影、AGENTS、Handbook、Runbook、Skill 和 OpenSpec 统一为：Auditor 在自己的活动 Task 内闭环范围内普通 finding；结束仍未闭合时 paused 并升级用户，不自动派新 Finalizer 或第二次审计。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/` | PASS：2 files / 86 tests |
| `pnpm exec prettier --check scripts/orchestration/ AGENTS.md IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md .agents/skills/riskflow-orchestration/SKILL.md openspec/changes/fix-orchestration-recovery-skill` | PASS |
| `pnpm exec eslint scripts/orchestration/` | PASS |
| `git diff --check` | PASS |
| `pnpm exec openspec validate fix-orchestration-recovery-skill --strict --no-interactive` | PASS |
| `pnpm orchestration:doctor` | PASS：Orca ready，七个工具可见 |
| `pnpm orchestration:check` | PASS |
| `uv run --project=/home/joshua/.ar --locked -- python /home/joshua/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/riskflow-orchestration` | PASS：`Skill is valid!` |
| `git check-ignore -v` 与 `git ls-files --others --exclude-standard` 定向检查 | PASS：目标 Skill 可追踪，其他 `.agents/skills/*` 保持忽略 |

## Issues by priority

CRITICAL：无。

WARNING：无。

SUGGESTION：无。

## Final Assessment

PASS。已发现的状态机、权限分级和 session 规则回归均已闭合；产物可以进入受控 settle 与集成门禁。本轮不再派发任何 Agent 或第二次审计。
