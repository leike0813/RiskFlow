## 1. 实施硬门与夹具

- [ ] 1.1 [IP-01, IP-10] 运行 `git rev-parse HEAD && git status --short && openspec instructions apply --change deliver-response-recommendation --json && openspec status --change deliver-response-recommendation --json`，完整读取全部 `contextFiles`，核对固定 base、实际 schema、C26/C19/C04 接缝和 `000045` 空闲；漂移立即升级。
- [ ] 1.2 [IP-01] 新增 PostgreSQL 推荐链 fixture，复用 C25/C26/C18/C19/C08 正式前置、C06 授权与 C03/C07 失败 seam；运行 `pnpm exec prettier --check packages/adapters/test/recommendation/fixture.ts`。

## 2. 候选与 Agent

- [ ] 2.1 [IP-02] 新增 recommendation 私有 strict Schema、候选合并与三项确定性校验纯逻辑；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`。
- [ ] 2.2 [IP-03] 实现精确任务/评估/basis/措施工件读取与 `measureCandidates` 冻结查询，完成跨工程、空间、版本和空集失败闭合；运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`。
- [ ] 2.3 [IP-04] 注册 C08 `response-recommendation` 任务定义，完成类型化增量逐项校验、合法候选持久化与任务结果引用；运行 `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`。

## 3. 事务与正式建议

- [ ] 3.1 [IP-05] 新增 `000045` 四表迁移、约束、权限与逆序 down；运行 `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`，确认真实 up/down 与重复 up。
- [ ] 3.2 [IP-06] 实现 `create-candidate` 的精确结果绑定、`validate-and-record` 的三项通过后正式入库，以及 C03 命令幂等/审计；运行 `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`。
- [ ] 3.3 [IP-07] 实现失败验证快照、C08 parent run → C07 复核、授权不可枚举及 C07/C27 两事务稳定重试；运行 `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`。

## 4. 稳定行为与接线边界

- [ ] 4.1 [IP-08] 补齐 implementation-plan §6 全部 13 个 Scenario 的代表性 core/PG 测试，特别检查真实候选越界、三项失败、权限、审计回滚和并发唯一；运行 `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`。
- [ ] 4.2 [IP-09] 只增加 core/adapters 的 `./recommendation` 子路径导出；核对既有公共接口和 API route 无漂移，运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts`。

## 5. 最小验证与交接

- [ ] 5.1 [IP-10] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false`、`pnpm exec eslint packages/core/src/recommendation packages/core/test/recommendation packages/adapters/src/recommendation packages/adapters/test/recommendation`、`pnpm exec prettier --check openspec/changes/deliver-response-recommendation packages/core/src/recommendation packages/core/test/recommendation packages/adapters/src/recommendation packages/adapters/test/recommendation packages/core/package.json packages/adapters/package.json`，修复范围内问题。
- [ ] 5.2 [IP-10] 运行 `pnpm run deps:check && pnpm run deps:policy && git diff --check && openspec validate deliver-response-recommendation --strict --no-interactive`，核对修改路径仅在 implementation-plan §7 allowlist，并向主调度报告中央迁移登记位置；不提交或归档。
