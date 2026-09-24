## 1. 基线与契约

- [x] 1.1 完成 IP-0：核对实施 HEAD 与 C30 真实运行/路由/等待/恢复接缝；运行 `git rev-parse HEAD`、`pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts`。
- [x] 1.2 完成 IP-1：扩展 strict 命令、结果及三个精确只读证明契约，不改变旧分支默认语义；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts && pnpm typecheck`。

## 2. 事实提供方只读接缝

- [x] 2.1 完成 IP-2：C30 真实等待运行、绑定证明和采纳证明恢复门；运行 `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`。
- [x] 2.2 完成 IP-3：C25 精确已成立实际评估证明及越权/损坏失败关闭；运行 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`。

## 3. 人工决定与现场执行

- [x] 3.1 完成 IP-4：C41 迁移、唯一终局决定、真实采纳绑定与拒绝事实；运行 `pnpm exec vitest run packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts`。
- [x] 3.2 完成 IP-5：将获授权现场执行按原来源交给 C28，不由图代写；运行 `pnpm exec vitest run packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts`。

## 4. 正式反馈与公开入口

- [x] 4.1 完成 IP-6：冻结执行后输入，核对 C25 实际评估，C28 反馈成功后启动精确分段；运行 `pnpm exec vitest run packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts`。
- [x] 4.2 完成 IP-7：C09 路由注入 C41，验证 C10 固定命令身份和服务端授权；运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/web/test/confirmation.test.ts`。

## 5. 闭环证据

- [x] 5.1 完成 IP-8：用现有 PostgreSQL fixture 验证采纳/拒绝、执行、实际评估、反馈、失败和原键重试；运行 `pnpm exec vitest run packages/adapters/test/human-decision-feedback/command-chain.test.ts`。
- [x] 5.2 完成 IP-1–IP-8 的相关门禁并核对任务证据；运行 `pnpm typecheck && pnpm deps:check && openspec validate wire-human-decision-and-feedback-commands --strict --no-interactive`。
