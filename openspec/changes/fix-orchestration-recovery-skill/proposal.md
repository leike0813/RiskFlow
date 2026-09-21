# Proposal

## Why

新的调度会话目前需要自行探索受控工具、恢复顺序和状态含义；同时 `reconcile` 未暴露、消息无法受控回复、终态 terminal 残留无法由控制器安全收口，导致可恢复状态演变为人工死锁。

## What Changes

- 统一并完整暴露 RiskFlow 受控调度工具，新增消息回复并开放既有 reconcile。
- 让 wait 显式确认已处理的 Delivery，并让 Codex 角色在 worker-start 前经受控 terminal 完成首次工作区信任。
- 恢复历史中被重构弱化的 session 隔离与活动 Agent 非干扰规则：每个独立 Task 使用新 session，限定审计在自己的活动 Task 内闭合普通 finding。
- 收紧 reconcile 的违规豁免，只允许修复明确的 checkpoint/worktree 回收漂移。
- 让 cleanup 在严格前提下关闭精确终态 terminal，重读状态并仅回收已变为 reclaimable 的工作树。
- 改善冷启动上下文与阻塞下一动作，使新会话能直接区分可执行队列、违规、stale 残留和历史诊断。
- 增加项目级 `riskflow-orchestration` Skill，并在 `.gitignore` 中仅豁免该 Skill。
- 更新 Handbook、Runbook 与稳定行为测试，不引入依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `operations/orchestration-controlled-actions`：补充受控回复、reconcile 安全边界、终态残留回收、统一工具注册、session 隔离和限定审计闭环契约。
- `operations/orchestration-execution-status`：补充冷启动摘要、阻塞状态的可执行下一动作及审计失败的暂停语义。

## Impact

影响 `scripts/orchestration/` 控制器、状态投影和 OMP 扩展，项目编排手册、运行手册、`.gitignore` 与 `.agents/skills/riskflow-orchestration/SKILL.md`。不改变业务生产模块、领域 Schema、依赖或执行图路由。
