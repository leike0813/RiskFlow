# Verification

## 验收对象

- Change：`fix-workflow-run-completion-proof-authorization-coverage`
- 核验日期：2026-10-07
- 输入实现 HEAD：`c54e3dc995e2500c2408cfd7450a571819b1750b`
- 最终验收 HEAD：`c54e3dc995e2500c2408cfd7450a571819b1750b`（固定产品实现检查点；后续规格同步、任务勾选和归档提交不改变产品实现）
- 验收 Agent：Codex，当前连续收尾任务的 Finalizer
- 验收依据：本 change 的 proposal、delta specs、design、implementation-plan、tasks，以及固定实现和已执行测试证据。

## 结论

**PASS**。本 change 的实现、行为回归、真实浏览器闭环和所需限定审计均已完成，未发现待修复的范围内缺陷或缺失证据。任务 9/9 完成；7.2 已按原顺序在两个修复 change 归档后执行，返回 C34 重新核对并勾选 4.1/4.2/4.4，4.3 的证据已汇总。

## 核验与修复证据

| Requirement / Scenario | IP-ID / 证据 | 结果 |
| --- | --- | --- |
| 工作流生命周期；按收窄上下文证明更宽范围启动的运行 | IP-01/02；workflow adapter 的不同摘要但覆盖充分、真实 C04 completion 用例 | 通过：覆盖准入，写入摘要保持。 |
| 范围不足时仍然拒绝 | IP-01/02/05；缺来源 grant、错版本 grant、同摘要但不足、跨工程/无授权/缺事实用例 | 通过：同型拒绝，摘要相等不代替授权。 |
| 写入侧授权摘要仍被审计保留 | IP-03/05；登记重放、事务回滚、application-role append-only 用例 | 通过：写入与审计没有放宽。 |
| 等待决定后以原运行恢复；陈旧等待版本拒绝 | IP-05；workflow、human-decision-feedback、response-lifecycle、worker runtime 回归 | 通过：原运行身份及冻结等待点检查仍在。 |
| 检查点与业务事实不一致；取消和技术失败保留追溯 | IP-05；worker assessment/risk-flow runtime 与 composition | 通过：登记事实与 checkpoint 分工不变。 |
| 反馈命令；执行后反馈形成正式事实；实际评估缺失或链不符失败 | IP-04/05；C41/C28 回归、真实页面执行/反馈闭环 | 通过：实际评估和链证明没有省略。 |
| 以按任务收窄的读取上下文确认实际评估 | IP-04/06；真实采纳→预测→执行→反馈→偏差→校准草案 browser | 通过：不扩大 C41 请求范围以迁就旧摘要。 |

核验期修复：删除 retrieval 重复的仅空间覆盖算法及摘要等值捷径，C30 运行状态、绑定与完成证明复用 C04 manifest 的工程、空间、来源及策略覆盖校验。缺失与无权同型拒绝，已受权事实矛盾仍失败闭合；写入授权摘要、审计及事务语义不变。修复已包含在上述固定检查点。

| 可运行命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/adapters/test/workflow packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts --maxWorkers=2` | 3 文件、74 通过 |
| `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` | 31 通过 |
| `pnpm exec vitest run apps/worker/test/assessment --maxWorkers=2` | 重评身份修复后两文件、35 通过 |
| `NODE_OPTIONS=--max-old-space-size=12288 pnpm exec playwright test -c playwright.config.ts --project=demo-chromium --retries=0 --output=/tmp/riskflow-plan-browser-final-complete` | 68 通过、0 失败，零重试，8.2m |
| `NODE_OPTIONS=--max-old-space-size=12288 pnpm build`、同 heap 的 `pnpm typecheck`、`pnpm --dir demo build` | 通过 |
| `pnpm lint`、`pnpm format:check`、`git diff --check` | 通过 |
| `pnpm deps:check`、`pnpm deps:policy` | 482 模块、1441 依赖无违规；依赖策略通过 |
| `openspec validate fix-workflow-run-completion-proof-authorization-coverage --strict --no-interactive` | 通过 |

此前关联核心/适配器/Worker 18 文件 322 通过的完整命令和各阶段证据见 [C34 正式验收](../2026-10-07-deliver-assessment-warning-and-response-ui/verification.md)。这些组与上表有重叠，不相加为独立测试总数。产品源码与最终成功回归时一致，固定检查点将同一份已验证实现提交，没有用旧测试覆盖后续产品变更。

## 规格同步与归档检查

38 份主规格严格校验通过；本轮三个归档 change 均通过严格校验，任务全部完成。额外全历史归档扫描为 88 通过、4 失败，失败是既有归档工件未勾选任务；本轮未修改这些工件。明细见 [C34 规格同步与归档检查](../2026-10-07-deliver-assessment-warning-and-response-ui/verification.md)。

## 限定审计

本收尾轮次已经执行唯一一次限定审计（Erdos），范围为真实 C06 绑定及下游收窄、C29 证明/草案/尾事务、C41 等待采纳与互斥决定、D-12 重评入口身份与原键重试、精确历史读取及不可枚举失败。发现已由当前 Finalizer 在批准范围内修复，并以最新所属适配器回归及 68 项完整浏览器验证收口。该 change 的授权覆盖与反馈完成证明通过，没有待执行审计；未另派第二次审计。

## 后续注意事项

浏览器与压力输入均为版本化合成样本，待甲方复核；这不影响本轮软件行为验收。此前失败与中断 trace 已保存在工作树核验记录指定位置，最终完整回归为 68/0。未重新宣称全库单测全部通过，也未修改默认风险接受阈值规避闭环校验。
