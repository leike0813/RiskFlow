# Tasks

## 1. 状态视图

- [x] 1.1 新增"本轮是否已收口过一次 audit"的判定（范围取 `taskSummary.scope`）与 `auditRequired`
- [x] 1.2 审计要求分支改用 `auditRequired`；本轮已审计时成功收口的 finalization 直接进入已验收态
- [x] 1.3 节点输出新增 `auditRequired` 字段

## 2. 角色选择与提示词

- [x] 2.1 `nextTaskKind` 改为依据 `node.auditRequired` 返回 `audit`，不再凭检查点条件一律再派
- [x] 2.2 `taskSpec` 在收尾/审计职责中写明：同一收尾轮次最多一次审计；finding 必须在同一会话内修完；禁止重复派发；无法在会话内完成必须升级

## 3. 文档与规格

- [x] 3.1 main spec 两处 delta（MODIFIED 纠正措辞 + ADDED 禁止重复派发）
- [x] 3.2 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §5 收尾段与 `AGENTS.md` §3.1 写明同一条

## 4. 测试

- [x] 4.1 `status.test.mjs` 覆盖：本轮无审计 → finalization 成功收口后要求一次审计（`auditRequired` 真）
- [x] 4.2 `status.test.mjs` 覆盖：本轮已有收口 audit → 后续 finalization 成功收口后不再要求审计，直接进入已验收态
- [x] 4.3 `control.test.mjs` 覆盖：`auditRequired` 为假时角色选择返回 finalization 而不是 audit

## 5. 验证

- [x] 5.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 5.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 5.3 `openspec validate fix-single-audit-per-finalization-round --strict --no-interactive` 通过
