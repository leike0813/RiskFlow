## 1. 契约夹具

- [ ] 1.1 [IP-01] 在 `packages/core/test/assessment-config/fixture.ts` 建立 11 类互相兼容的最小合成配置及单点覆写 helper，明确标注“合成样本、待甲方复核”；运行 `test -f packages/core/test/assessment-config/fixture.ts && rg -n "合成样本、待甲方复核" packages/core/test/assessment-config/fixture.ts` 验证夹具身份和文件存在。

## 2. Core

- [ ] 2.1 [IP-01, IP-02] 实现 `packages/core/src/assessment-config/schema.ts` 的 strict document/content/metadata/set/request/result Schema 与 11 类型常量，使 IP-01 fixture 均有对应鉴别分支；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`，验证仅复用 contracts 既有类型且无公共 Schema 修改。
- [ ] 2.2 [IP-03] 实现 `decimal.ts` 的 canonical decimal BigInt 解析、比较、运算、舍入和矩阵 band lookup，以及 `validation.ts` 的指标/映射、10000 基点、闭合聚合、非 5×5 矩阵、两类阈值、扁平联合规则、措施、预测/偏差和跨文档校验；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false` 验证实现不引入 number 边界比较或新依赖。
- [ ] 2.3 [IP-04] 完成 1 MiB UTF-8 JSON/C04 verified 工件读取、稳定错误映射、11 成员重读验 digest 和不可变集合 identity 解析；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`，确认服务只依赖 C04/C16 窄接口且不返回公共 `AssessmentBasisReleaseSetRefV1`。
- [ ] 2.4 [IP-01, IP-02, IP-04, IP-09] 完成 `assessment-config.test.ts` 的表格驱动稳定行为测试（含 11 个 fixture 全部分支）并由 `index.ts` 导出 IP-02～IP-04 production 能力；运行 `pnpm exec vitest run packages/core/test/assessment-config/assessment-config.test.ts`，不得锁定完整文案、Zod issue 顺序或内部调用顺序。

## 3. Adapter 与持久化

- [ ] 3.1 [IP-05] 新增固定 `000012_assessment_configuration.ts`，创建 D8 三表、约束/索引/延迟审计外键和最小角色权限；在 C18 集成测试运行 `up → down → up`，执行 `pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts -t "migration and database privileges" --testTimeout=240000`，禁止修改 provider、中央迁移清单或既有 migration。
- [ ] 3.2 [IP-06] 实现 `PostgresAssessmentConfigurationAdapter` 的 prepare、事务内 metadata、发布事件、11 成员集合解析/持久化和闭合错误映射；运行 `pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts -t "imports|publishes|resolves" --testTimeout=240000` 验证真实 C04/C16/C03 链。
- [ ] 3.3 [IP-07] 按 D1 最小修改 `PostgresKnowledgeGovernanceAdapter`，将 C18 prepare/metadata/event 接入原 submit/publish/rollback 事务，阻断缺 policy 的 C18 类型，并为内部 resolver 增加排序 members；运行 `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000`，确认非 C18 治理行为不漂移。
- [ ] 3.4 [IP-08] 在 `packages/core/package.json` 与 `packages/adapters/package.json` 只追加 `./assessment-config` 子路径 export；运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false`，禁止修改根 barrel、根 manifest/workspace、依赖政策或 lockfile。
- [ ] 3.5 [IP-10] 完成真实 PostgreSQL 集成 fixture 与测试：11 工件导入/送审/批准/发布/解析、幂等/并发、Agent/跨工程、非法工件、缺失/停用/不兼容、rollback、旧集合、Outbox/审计及故障回滚；运行 `pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000`，容器不可用时不得 skip 或回退内存实现。

## 4. API 与 Worker 边界

- [ ] 4.1 [IP-11] 确认 C18 没有新增 API/Worker 生产文件，且 C09 generic knowledge route 仍通过既有 contracts；运行 `git diff --quiet -- apps/api apps/worker && pnpm exec vitest run apps/api/test/http-shell.test.ts`，如公共路由无法承载既有 C16 命令则 ask，不得在 C18 扩张契约。

## 5. Web 边界

- [ ] 5.1 [IP-11] 确认 C18 不提前实现 C32 治理页面或用户可见占位入口；运行 `git diff --quiet -- apps/web && pnpm exec vitest run apps/web/test/routing-context-actions.test.ts`，保持现有导航和页面骨架不变。

## 6. 最小验证

- [ ] 6.1 [IP-09, IP-10, IP-11] 运行定向回归 `pnpm exec vitest run packages/core/test/assessment-config/assessment-config.test.ts packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000`，证明 C18 行为、C14 字段事实和 C16 生命周期共同通过。
- [ ] 6.2 [IP-08, IP-11] 运行 `pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy`，确认零新增依赖、子路径导出和 `contracts ← core ← adapters` 边界；只修复 C18 根因，不格式化或改写保护区。
- [ ] 6.3 [IP-11] 运行 `git diff --check && git status --short && git diff --name-only 5c49f20e615c6507be40b5cc74f734fba4b4fb80 --`，逐项对照 implementation-plan §7 allowlist，并用 `git diff --quiet -- packages/contracts apps packages/core/src/engineering-data/monitoring packages/adapters/src/engineering-data/monitoring packages/core/src/knowledge-governance packages/adapters/test/postgres/postgres-foundation.test.ts pnpm-lock.yaml openspec/config.yaml` 确认保护区无改动。

## 7. OpenSpec verify 准备

- [ ] 7.1 [IP-11] 运行 `openspec validate deliver-assessment-configuration-and-measure-governance --strict --no-interactive`，逐条核对 specs、D-ID、IP-ID、文件与证据一致，并确认没有公式 DSL、默认配置、Mock、TODO、公共契约/依赖/范围漂移。
- [ ] 7.2 [IP-01, IP-02, IP-03, IP-04, IP-05, IP-06, IP-07, IP-08, IP-09, IP-10, IP-11] 仅在前述行为和命令全部通过后保持所有 task 已勾选，并运行 `openspec instructions apply --change deliver-assessment-configuration-and-measure-governance --json` 确认 apply ready；随后交由独立 Sol 按 `openspec-verify-change` 验证，不在实现任务中提交、归档或启动服务。
