## 1. 实施硬门与夹具

- [x] 1.1 [IP-01, IP-11] 运行 `git rev-parse HEAD && git status --short && openspec instructions apply --change deliver-execution-forecast-feedback-and-deviation --json && openspec status --change deliver-execution-forecast-feedback-and-deviation --json`，完整读取全部 `contextFiles`，核对固定 base、`000046` 空闲、C14/C25/C27/C19/C04 接缝与批准边界；漂移立即升级。
- [x] 1.2 [IP-01] 新增 response-lifecycle PostgreSQL fixture，复用正式 C14/C25/C27/C19/C18/C03/C06/C07 前置并提供双工程/空间、workflow binding、预测执行器和事务失败 seam；运行 `pnpm exec prettier --check packages/adapters/test/response-lifecycle/fixture.ts`。

## 2. 私有领域模型与预测

- [x] 2.1 [IP-02] 新增 C28 strict 私有 Schema、稳定引用、偏差结果和 canonical decimal 三策略纯计算；运行 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts`。
- [x] 2.2 [IP-04, IP-05] 实现 `ResponseLifecycleServiceV1` 的 workflow binding、终局决定和版本化效果预测接缝，闭合 available/unavailable 与非法执行器结果；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`。

## 3. 持久化与纵向用例

- [x] 3.1 [IP-09] 新增 `000046` 五表迁移、外键/约束/最小权限及逆序 `down`，在 C28 adapter test 中验证真实 up/down、重复 up 和旧数据保留；运行 `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`。
- [x] 3.2 [IP-03, IP-04, IP-05, IP-09] 实现精确 C27→C25、C14、C19/C04 上下文读取，以及决定和效果预测的授权、幂等与原子入库；运行 `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`。
- [x] 3.3 [IP-06, IP-07, IP-09] 实现已采纳/独立行动执行、C30 actual assessment 驱动的反馈及既有 `warning.feedback-recorded.v1` 原子事件；运行 `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`。
- [x] 3.4 [IP-02, IP-08, IP-09] 实现私有偏差事实入库和 C29 受权精确读取，证明无预测不造事实且不调用公共 `DeviationRecordSchema`；运行 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`。

## 4. 稳定行为与导出边界

- [x] 4.1 [IP-10] 补齐 implementation-plan §6 全部 20 个 Scenario 的代表性 core/PG 测试，重点覆盖虚假 workflow ref、三预测方法、两类执行、反馈链、三偏差边界、C29 reader、权限、并发和事务回滚；运行 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`。
- [x] 4.2 [IP-10] 只增加 core/adapters 的 `./response-lifecycle` 子路径导出，并验证公共 contracts/API 路由无漂移且仍未被 C28 假接线；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts`。

## 5. 最小验证与交接

- [x] 5.1 [IP-11] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false`、`pnpm exec eslint packages/core/src/response-lifecycle packages/core/test/response-lifecycle packages/adapters/src/response-lifecycle packages/adapters/test/response-lifecycle` 和 implementation-plan §6 的 `prettier --check`，修复范围内问题。
- [x] 5.2 [IP-11] 运行 `pnpm run deps:check && pnpm run deps:policy && git diff --check && openspec validate deliver-execution-forecast-feedback-and-deviation --strict --no-interactive`，核对修改路径仅在 implementation-plan §7 allowlist，并向主调度报告中央 migration/auth fixture 登记位置；不创建 verification、不提交或归档。
