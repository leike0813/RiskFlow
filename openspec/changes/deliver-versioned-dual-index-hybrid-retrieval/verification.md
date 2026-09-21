# C20 最终核验报告

验证对象：`deliver-versioned-dual-index-hybrid-retrieval`；实际 schema：`riskflow-delivery`。该 schema 仅定义 proposal、specs、design、implementation-plan、tasks 五个规划工件，故本报告作为 change 目录内的验收记录，不修改 schema。

输入及当前工作树 HEAD：`1c757649d3975cf9e57835bc6c56b79f92694dca`。以下修复和本报告尚未提交；最终实现检查点须由协调端审阅后形成。

## Summary

| 维度 | 结果 |
| --- | --- |
| 完整性 | 10 项 Requirement、30 个 Scenario 均对应实现与可运行证据；独立核验完成，实施任务 18/18 已勾选；限定审计为后续独立门禁 |
| 正确性 | C20-FIN-01～05 在批准范围内修复；C20 检索套件 8 files / 184 tests、直接依赖 7 files / 104 tests 通过；真实 Qdrant 七项硬门通过 |
| 一致性 | D1～D13、IP-00～IP-08 的事实入口、模块边界、代际/权限/结果收口保持；本轮未修改公共 contracts、迁移、依赖或 C17 接缝 |

当前评估：产品回归通过；本轮修改涉及权限，最终结论待同一收尾轮次的一次限定审计填入下节。审计完成前状态为 **BLOCKED（待限定审计）**。

## Finding 与修复

### C20-FIN-01：相同文本的不同成员复用 Qdrant point ID — 已解决

- `packages/core/src/retrieval/service.ts:292` 的成员规范化先构造包含来源类别、发布和条目标识的 `memberRef`，再由其规范摘要导出 point ID；不同来源成员即使投影文本相同也不再互相覆盖。
- Core 回归覆盖相同文本、不同成员产生三个独立 point；查询服务夹具使用同一身份规则，事实回查时复核命中 point ID。

### C20-FIN-02：授权能力、工程、actor 未在目标读取前拒绝 — 已解决

- `packages/core/src/retrieval/service.ts:743` 的 `HybridRetrievalService.retrieve` 先解析公共查询 Schema，再验证 C06 授权上下文的能力、工程和 actor；失败返回同形 `AUTHORIZATION_DENIED`，不调用 input reader、代际存储、Qdrant 或事实 reader。
- 空间与来源 scope 由公共 Schema 严格校验；资源级当前授权仍由既有 `HybridRetrievalInputReaderV1` 和 C17 `readExact` 在精确读取时判定，不增加端口。查询方 scope 摘要与冻结输入及代际摘要不一致时整次失败。

### C20-FIN-03：Qdrant 双路候选未按授权范围过滤 — 已解决

- `packages/adapters/src/retrieval/qdrant-rest-client.ts:122` 的 C20 内部混合查询 filter 带 `authorizationScopeDigest`，Qdrant 的 dense、BM25 prefetch 及融合请求均按工程、代际、scope 过滤；事实回查继续核对 payload 摘要。
- 真实 Qdrant 干扰测试用高分的跨工程和同工程异 scope 点占据召回窗口，证明两路仍只返回授权候选；无权限候选与 payload 摘要不符均不产生正式结果。

### C20-FIN-04：冻结策略与候选发布/身份对账不足 — 已解决

- `packages/core/src/retrieval/service.ts:850` 的冻结策略正文 `policyRef` 与请求精确匹配。`packages/core/src/retrieval/service.ts:1128` 在访问 C17 来源前，按活动代际的三类 `memberReleaseRefs` 校验发布，并按成员引用重算 point ID；不符返回 `SOURCE_FACT_DRIFT`。
- 查询服务回归覆盖策略正文漂移及候选引用非当前代际发布，两者均无正式结果。

### C20-FIN-05：结果登记异常未按结构化失败收口 — 已解决

- `packages/core/src/retrieval/service.ts:1347` 的 PostgreSQL 结果登记抛错统一映射为可重试 `RESULT_PERSISTENCE_FAILED`；已写的 C04 工件不作为正式结果返回。查询服务回归验证零正式结果引用。

## Requirement 与设计核对

| Requirement（含其 Scenario） | IP-ID | 证据 |
| --- | --- | --- |
| 发布事件唯一入口；合法、重复、坏事件 | IP-00、IP-05 | Worker projection handler 与 C17/contract 直接回归 |
| 发布组合不可变代际；三类同代、输入变化旁路新代 | IP-01、IP-02、IP-05 | Core 身份测试、Worker projection handler |
| 稠密/BM25 成员双路对账；缺路、摘要或版本冲突 | IP-02、IP-04、IP-07 | Core 对账、真实 Qdrant adapter 与验收 |
| 构建后原子切换；成功、失败保旧、并发冲突 | IP-02、IP-03、IP-05 | PostgreSQL adapter、Worker projection handler |
| 双路独立召回及版本化 RRF；策略差异、缺路失败 | IP-01、IP-02、IP-04、IP-06 | Core 融合、Qdrant adapter、查询服务 |
| 精确输入、当前权限、事实回查；C17 委派及漂移拒绝 | IP-03、IP-06、IP-07 | 查询服务、真实 Qdrant 验收、C17 adapter 与组合 |
| 可重放解释、queryId 冲突、排序分值不作为 P/C | IP-01、IP-03、IP-06 | Core Schema、PostgreSQL adapter、查询服务 |
| 全删投影并从事实重建；等价对账、坏事件拒绝 | IP-04、IP-05、IP-07 | Qdrant 验收、Worker projection handler |
| 质量、性能、权限独立硬门；合成样本标记 | IP-02、IP-07 | Core 硬门判定、真实 Qdrant 七门验收 |
| 外部故障无半正式状态；构建/登记失败、重启续作 | IP-03～IP-06 | PostgreSQL/Qdrant/Worker/查询服务回归 |

D1～D13 对应的发布事实入口、C20 领域单一模块、版本化身份/策略、Qdrant named dense/sparse、追加状态、D6 查询顺序、Qdrant RRF、既定 `000040`、结构化错误、固定服务版本、真实验收、文件所有权及 C17 可选委派均按上述证据核对。此次没有新依赖、迁移号段、公共接口或业务规则硬编码。

## 实际命令与证据

- `pnpm exec vitest run packages/core/test/retrieval packages/adapters/test/retrieval apps/worker/test/retrieval --testTimeout=180000`：8 files / 184 tests passed，真实 Qdrant adapter 与验收用例无 skip。
- 最后将公共 Schema parse 移到授权前置检查之前后，复跑 `pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts --testTimeout=180000`：1 file / 22 tests passed；随后 `pnpm exec prettier --check packages/core/src/retrieval/service.ts && pnpm exec eslint packages/core/src/retrieval/service.ts && pnpm exec tsc -b --pretty false`：exit 0。
- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/model.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/test/retrieval/composition.test.ts`：7 files / 104 tests passed。
- `pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts --testTimeout=180000 --reporter=verbose`：4/4 passed，真实 Qdrant 1.19.0；合成样本、待甲方复核。固定六查询上 dense Recall@5 = 0.9167、BM25 Recall@5 = 0.8333、RRF Recall@5 = 1、RRF nDCG@5 = 0.9710、双索引对账率 = 100%、授权泄露 = 0；200 次计量的 Qdrant RRF 请求 p95 = 46.66 ms（门槛 500 ms）。环境为 Node v24.12.0、Linux、Docker 中的 `qdrant/qdrant:v1.19.0`；p95 仅覆盖查询向量准备完成后的串行双路 RRF 请求。
- `pnpm typecheck` 与 `pnpm exec tsc -b --pretty false`：exit 0。
- `pnpm exec eslint packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts`：exit 0。
- `pnpm exec prettier --check packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts openspec/changes/deliver-versioned-dual-index-hybrid-retrieval`：全部通过。
- `pnpm run deps:check`：306 modules / 826 dependencies，无边界违规；`pnpm run deps:policy`：通过；`git diff --check`：通过。
- `openspec validate deliver-versioned-dual-index-hybrid-retrieval --type change --strict --no-interactive`：change valid；`openspec status --change deliver-versioned-dual-index-hybrid-retrieval --json`：schemaName 为 `riskflow-delivery`，五个规划工件 done。

## 限定审计与剩余事项

本轮修复涉及权限过滤，按 implementation-plan §8 须在同一收尾轮次审计权限、事务、代际关键状态机和语义 merge。重点核对授权顺序与 scope 摘要过滤、跨工程/跨空间召回隔离、point ID 唯一性，以及本轮修复与既有代际状态和主线合入语义的关系。结论由协调端派发的唯一一次限定审计追加至本节；完成前不判定 PASS。

当前无已知产品实现 finding。协调端尚需组织唯一一次限定审计并形成 Git 检查点；本 worker 不提交、不合并、不归档。
