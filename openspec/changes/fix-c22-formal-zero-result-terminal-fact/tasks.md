## 1. 公共契约

- [ ] 1.1 完成 IP-01：零结果精确引用、分析返回分支及 I4 阶段恰一约束；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`。

## 2. C22 零结果收口

- [ ] 2.1 完成 IP-02 的初次合法零输出与非空/失败分流；运行 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts apps/worker/test/identification/candidate-finalization/runtime.test.ts`。
- [ ] 2.2 完成 IP-02 的正式事实、当前授权窄读、幂等预读与 C03/C04 故障收口；运行 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts`。

## 3. 追加登记与迁移

- [ ] 3.1 完成 IP-03 的 `000049` 增量约束、命令预读及 adapter 映射；运行 `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。
- [ ] 3.2 完成 IP-03 的真实 PostgreSQL 旧行/零行/权限/回滚与迁移发现证据；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。

## 4. C24 图与汇总

- [ ] 4.1 完成 IP-04 的 I4 零结果游标、正式引用核对及其它工作项继续；运行 `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts`。
- [ ] 4.2 完成 IP-04 的一工作项一终态、I9 全零/混合汇总与恢复对账；运行 `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts`。
- [ ] 4.3 完成 IP-04 的 C24 已完成运行结果授权精确只读与 C36 可消费的全零覆盖证据，验证缺失、撤权和错配失败闭合；运行 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/identification/graph/runtime.test.ts`。

## 5. 实施门禁

- [ ] 5.1 完成 IP-05 的 C02/C22/C24 相关回归；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/core/test/identification/graph.test.ts apps/worker/test/identification/candidate-finalization/runtime.test.ts apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`。
- [ ] 5.2 完成 IP-05 的类型、格式、依赖与规格检查；运行 `pnpm typecheck`、`pnpm deps:check`、`openspec validate fix-c22-formal-zero-result-terminal-fact --strict --no-interactive`，并按 implementation-plan §6 执行计划路径的 `pnpm exec prettier --check` 命令。
