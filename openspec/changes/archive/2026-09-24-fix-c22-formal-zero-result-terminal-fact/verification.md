# Verification

## 验收对象

- Change：`fix-c22-formal-zero-result-terminal-fact`（实际 schema：`orchestrated-delivery`）
- 输入实现 HEAD：`b5e4d586cdb91b49345ecdf7f1f47702ad1dac23`
- 最终验收 HEAD：待主调度审阅并形成修复检查点；当前 HEAD 仍为 `b5e4d586cdb91b49345ecdf7f1f47702ad1dac23`，下述两处修复为未提交工作区改动。限定审计须以新检查点为输入并更新本栏。
- 验收 Agent：C39 Finalizer，`task_3d117a44e583` / `ctx_0a612be7b3bf`

## 结论

**BLOCKED（仅限最终 PASS 门禁）**。实现与本轮修复的相关回归、类型、格式、依赖边界及 OpenSpec 严格校验通过；design D-04/D-06 涉及当前授权和业务事务，项目规则要求一次独立限定审计，目前尚无审计结论。审计完成前不得记录 PASS、集成或归档；若审计发现已批准范围内缺陷，由该审计任务直接修复、回归并更新本工件。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| C02 `I4 返回正式零结果引用`；IP-01 | `packages/contracts/src/{ports,workflows}/index.ts`；`packages/contracts/test/module-interfaces-events-workflows.test.ts` | 分析结果闭合联合、I4 候选/零引用恰一及旧 I4 兼容用例通过。 |
| C22 `精确上下文生成候选`、`合法零候选形成正式终态`、`上下文或模型输出不合格`；IP-02 | `packages/core/src/identification/candidate-finalization/{schema,service}.ts`；对应 core/worker 测试 | 初次合法空数组形成独立事实；非空路径、解析失败、预算失败和修正轮次空输出保持原分流。 |
| C22 `重放与当前权限`、`同键异载荷或撤权`、`工件或业务事务失败`；IP-02/IP-03 | C22 core/adapter 测试；`000049_formal_zero_result.ts` 和 `postgres-foundation.test.ts` | 幂等、授权窄读、登记约束、真实 PostgreSQL 旧行/零行及回滚用例通过；无零结果时不生成记录或评估事件。 |
| C24 `零结果工作项结束且其它工作项继续`、`全部工作项为正式零结果`、`零结果与候选工作项并存`；IP-04 | `apps/worker/src/identification/graph/{graph,runtime}.ts`；C24 core/worker 测试 | I4 逐项正式引用，零结果不进入 I5/I6/I8，全零和混合 I9 汇总及恢复复验通过。 |
| C24 `冻结运行的零结果覆盖证明`；IP-04 | `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`；adapter/worker 测试 | 精确已完成运行结果回读、撤权/缺失/状态错配失败闭合；本轮补充登记 `workPlanRef` 与正文核对及回归。C36 仍须按冻结计划逐项核对 C22 引用，不能推断工程无风险。 |
| C24 `工作项候选通过校验`、`可修正错误有界闭环`、`不可修正候选失败不伪装人工复核`、`部分成功形成可解释汇总`、`仍有待复核组`；IP-04/IP-05 | C22/C24 core/worker 既有回归 | 非零、失败、待复核与已验收路线通过。 |
| C02 `识别正常完成`、`多资料版本形成单个可重放准备快照`、`拒绝不完整或错配的资料段集合引用`、`知识未就绪时暂停`、`争议合并组不阻塞其它组`、`必经检索审阅失败不降级`；IP-05 | C02 contract 与 C24 core/worker 既有回归 | 原阶段契约及失败边界通过。 |
| IP-01～IP-05 完整回归 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/core/test/identification/graph.test.ts apps/worker/test/identification/candidate-finalization/runtime.test.ts apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` | 8 文件、202 用例通过；此进程在本轮修复前启动。 |
| 本轮修复回归 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts -t 'reads a completed run result by exact reference and keeps unproven evidence closed'` | 修复后 1 用例通过、12 跳过；覆盖登记工作计划与正文错配。 |
| IP-05 静态与规格门禁 | `pnpm typecheck`；`pnpm deps:check`；implementation-plan §6 列出的 `pnpm exec prettier --check`；`openspec validate fix-c22-formal-zero-result-terminal-fact --strict --no-interactive`；`git diff --check` | 均通过；修复后再次运行受影响文件的 Prettier 与 typecheck，均通过。 |

验收期修复：`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` 在精确运行结果回读时核对登记的 `runResultRef` 和正文的 `workPlanRef`，避免不一致正文被当作完成运行的覆盖证据；`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` 增加真实 PostgreSQL 错配回归。未修改公共 DTO、权限值、事务、迁移、依赖或规划工件。

## 限定审计

- 触发范围：design D-04 的 C22 当前授权窄读、幂等预读与 C03/C04 失败收口；D-06 的 `000049` 登记约束及真实 PostgreSQL 升降级；并复核本轮 C24 精确运行结果回读修复的授权与正文一致性。
- 结论：**待执行**。本轮 Finalizer 的测试与代码核对是审计输入，不能替代独立审计；审计 Agent 须在同一工件补充结论、命令、修复和最终 HEAD。

## 后续注意事项

无。以上待审计事项是当前 BLOCKED 的门禁，不属于可带入 PASS 的注意事项。
