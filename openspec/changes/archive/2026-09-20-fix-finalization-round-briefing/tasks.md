# Tasks

## 1. 派发说明

- [x] 1.1 `taskSpec` 为 finalization/audit 写明本轮协议（最多一次审计、禁止期待第二轮、无法在会话内完成则 escalation）
- [x] 1.2 修复尝试（`auditRequired` 为假且存在已收口失败审计）的说明列出该审计的 task id、`issueRefs`、`evidenceRefs` 并要求逐项闭合
- [x] 1.3 audit 任务的说明写明它是本轮唯一审计、只报告 finding 与证据、不改产品代码

## 2. 测试

- [x] 2.1 首个 finalization 尝试的说明含协议、不含 finding 清单
- [x] 2.2 修复尝试的说明含本轮审计 task id 与 finding 引用
- [x] 2.3 audit 任务的说明含"本轮唯一审计 / 只报告 / 不改产品代码"

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-finalization-round-briefing --strict --no-interactive` 通过
