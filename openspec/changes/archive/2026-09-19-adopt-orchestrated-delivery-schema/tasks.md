## 1. Schema 与默认规则

- [x] 1.1 [IP-01] 新增 `orchestrated-delivery` schema 与六个模板，保持旧 schema 原样，并运行 `openspec schema validate orchestrated-delivery --verbose` 与 `openspec schema validate riskflow-delivery --verbose`
- [x] 1.2 [IP-01] 将项目默认 schema、verification 规则和 Agent 规则切换到新工作流，并以新 schema 临时 change 验证五工件可 apply、verification 独立完成

## 2. 编排门禁

- [x] 2.1 [IP-02] 更新 Planning、Finalizer 与 Auditor 任务提示，并运行 `pnpm exec vitest run scripts/orchestration/control.test.mjs`
- [x] 2.2 [IP-02] 在成功 settle 的 Git 副作用前校验实际 verification artifact 状态，补充新旧 schema 兼容测试，并运行 `pnpm exec vitest run scripts/orchestration/control.test.mjs`

## 3. 操作文档

- [x] 3.1 [IP-03] 更新 Handbook 与 Runbook 中的责任、CLI、提前 ready 提示及收口/归档步骤，并用 `pnpm exec prettier --check AGENTS.md IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md openspec/config.yaml` 检查格式

## 4. 综合验收与归档

- [x] 4.1 [IP-04] 运行 `openspec validate adopt-orchestrated-delivery-schema --strict --no-interactive`、`pnpm verify` 与 `git diff --check`，逐项核对全部 Requirement/Scenario 和 IP-ID
- [x] 4.2 [IP-04] 同步两份主规格并完成归档前检查，运行 `openspec validate --all --strict --no-interactive`；change 归档由后续 OpenSpec archive 阶段执行
