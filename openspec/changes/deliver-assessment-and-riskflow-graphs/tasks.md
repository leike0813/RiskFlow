## 1. 公共契约与 C30 运行事实

- [x] 1.1 IP-01：补齐启动引用和两个独立只读端口，保留旧单数解析；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`。
- [x] 1.2 IP-02：实现 C30 核心登记 Schema、入口门禁、状态版本与父子幂等规则；运行 `pnpm exec vitest run packages/core/test/workflow/service.test.ts`。
- [x] 1.3 IP-04：建立 C30 三张只追加表及角色最小授权，核对迁移发现、重入和逆序；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts`。
- [x] 1.4 IP-04：实现运行/链边/查询登记的事务适配与审计失败回滚；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`。

## 2. 评估图与父图

- [x] 2.1 IP-05：实现 A0～A5 的精确输入冻结、正式依据解析和 C25 调用；运行 `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts`。
- [x] 2.2 IP-05：实现 A6～A9 的 C26/C27 预警、候选/三项校验及无预警终态；运行 `pnpm exec vitest run apps/worker/test/assessment/composition.test.ts`。
- [x] 2.3 IP-03：建立真实父 run、C24 识别子图与按验收风险版本启动的独立评估子运行；运行 `pnpm exec vitest run apps/worker/test/risk-flow/composition.test.ts`。
- [x] 2.4 IP-02、IP-03、IP-04：闭合重复事件、等待/恢复、检查点对账、取消和技术失败；运行 `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`。

## 3. 处置后续与有界投影

- [ ] 3.1 IP-06：接入人工采纳后的独立预测、执行后 C25 评估、正式反馈、偏差及待审核校准；运行 `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts apps/worker/test/risk-flow/runtime.test.ts`。
- [x] 3.2 IP-07：由 C22 记录所有者实现当前授权下的精确批读与来源上限；运行 `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。
- [x] 3.3 IP-08：从 C30 自有事实与 C22 公开批读生成分页 `run-view`/`trace-chain`，核对游标、撤权和审计；运行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`。

## 4. 全链验收与工程门禁

- [x] 4.1 IP-09：以真实 PostgreSQL、C04、C03 checkpoint/Outbox 和公开端口形成 RI-S1～S6、RA-S1～S7 的完整与缺席链证据；运行 `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts`。
- [x] 4.2 IP-10：记录各场景命令、冻结版本、事件/审计/工件 ref，执行 `pnpm typecheck && pnpm lint && pnpm deps:check && pnpm deps:policy && pnpm build && pnpm format:check && pnpm openspec:validate`；仅在行为与证据均完成后勾选相应 task。
