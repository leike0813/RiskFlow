## 1. 契约、依赖门与夹具

- [ ] 1.1 [IP-00] 核验已归档公共发布事件、C17 同事务 Outbox 发件及 `readExact` 检查点，并等待主调度提供 Qdrant OCI、`testcontainers@12.1.0` 及 package exports 机械前置；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`，确认前置测试通过后开始 C20；C17 检索委派由 4.3 完成。
- [ ] 1.2 [IP-01] 新增 retrieval strict Schema、三个必要端口、子路径导出和核心表驱动契约测试，运行 `pnpm exec vitest run packages/core/test/retrieval/retrieval.test.ts` 验证策略、代际、结果、错误及非法边界。
- [ ] 1.3 [IP-07] 新增固定中文合成数据集、版本化验收策略、夹具契约测试和共享真实容器 fixture，运行 `pnpm exec vitest run packages/adapters/test/retrieval/fixture-contract.test.ts` 确认 JSON 经 IP-01 Schema 解析且合成/测量边界标记完整。

## 2. Core 确定性实现

- [ ] 2.1 [IP-02] 实现代际/成员稳定身份、状态转换、双索引 manifest 对账和错误映射，运行 `pnpm exec vitest run packages/core/test/retrieval/retrieval.test.ts` 验证不可变代际、缺一路、版本/权限差异及失败状态。
- [ ] 2.2 [IP-02] 实现版本化 RRF 贡献复验和独立质量/权限/p95 硬门判定，运行 `pnpm exec vitest run packages/core/test/retrieval/retrieval.test.ts` 验证策略差异、融合排序及任一单项失败均使 overall 失败。
- [ ] 2.3 [IP-02、IP-06] 完成 `HybridRetrievalService` 的精确输入、当前授权、活动代际、双路查询、事实回查、C04/PG 结果收口顺序，运行 `pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts` 验证成功引用、撤权/漂移拒绝、幂等冲突和持久化失败零正式结果。

## 3. PostgreSQL 与 Qdrant Adapter

- [ ] 3.1 [IP-03] 新增 `000040` migration 和 `PostgresRetrievalAdapter`，运行 `pnpm exec vitest run packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts` 验证 up/down/up、追加状态、唯一约束、serializable 激活、审计及查询结果幂等。
- [ ] 3.2 [IP-04] 以 Node 24 原生 `fetch` 实现 Qdrant create/upsert/query/inspect/delete 严格 adapter，运行 `pnpm exec vitest run packages/adapters/test/retrieval/qdrant-retrieval-adapter.test.ts --testTimeout=120000` 验证真实双向量、双 prefetch/RRF、最小 payload、超时/非法响应和精确删除。
- [ ] 3.3 [IP-07] 完成真实 Qdrant 质量、权限、p95 与全删重建验收，运行 `pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts --testTimeout=180000`，确认 D11 每项阈值、零泄露、100% 对账和等价重建均独立通过并产生测量报告。

## 4. API / Worker 组合

- [ ] 4.1 [IP-05] 新增版本化 Outbox projection handler，运行 `pnpm exec vitest run apps/worker/test/retrieval/projection-handler.test.ts` 验证合法/重复/坏事件、三类同代际、外部失败、部分 Qdrant 副作用重启续作及 ready 后原子切换。
- [ ] 4.2 [IP-05] 新增 Worker composition、retrieval 导出并只修改 Worker 根导出，运行 `pnpm exec vitest run apps/worker/test/retrieval/composition.test.ts` 验证生产依赖均显式注入、非目标事件 ignored、无私表扫描/第二队列且资源预算传递完整。
- [ ] 4.3 [IP-06] 按 D13 在 C17 adapter 与 Worker 组合根新增可选 `retrievalDelegate`，注入 C20 检索服务；现有 C17 adapter 测试覆盖未注入 `UNSUPPORTED_CONTRACT`、已注入同一查询一次转发及成功/失败结果原样返回，C20 组合测试覆盖注入链；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts apps/worker/test/retrieval/composition.test.ts`。

## 5. Web 与所有权边界

- [ ] 5.1 [IP-08] 确认本 change 无 Web/UI 文件；C17 仅 D13 三个获批文件变化，未触碰 contracts、C18/C19、主 specs、迁移 provider、中央测试清单或依赖文件；运行 `git diff --name-only cafdecfb78d1ebebf4fccd4260422f6cb4eb7556`，逐项对照 IP-ID allowlist 与主调度独立机械前置检查点，超出两者的路径停止并升级。

## 6. 最小验证

- [ ] 6.1 [IP-08] 运行 C20 最小测试集：`pnpm exec vitest run packages/core/test/retrieval packages/adapters/test/retrieval apps/worker/test/retrieval --testTimeout=180000`，确认全部行为证据通过且没有 skipped Qdrant adapter/验收用例。
- [ ] 6.2 [IP-08] 运行直接依赖与 D13 接缝回归：`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/model.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/test/retrieval/composition.test.ts`。
- [ ] 6.3 [IP-08] 运行类型、静态、格式和依赖边界：`pnpm typecheck && pnpm exec eslint packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts && pnpm exec prettier --check packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts openspec/changes/deliver-versioned-dual-index-hybrid-retrieval && pnpm deps:check && pnpm deps:policy`。

## 7. OpenSpec Verify

- [ ] 7.1 [IP-08] 运行 `openspec validate deliver-versioned-dual-index-hybrid-retrieval --type change --strict --no-interactive`，逐项核对 implementation-plan 证据矩阵后再勾选所有实施任务。
- [ ] 7.2 [IP-08] 由独立验证 Agent 使用 `openspec-verify-change` 对批准的 proposal/specs/design/implementation-plan/tasks、实现代码和第 6 节证据验收；验证完成前不归档、不提交，任何缺口回到对应 IP-ID 修复并重跑命令。
