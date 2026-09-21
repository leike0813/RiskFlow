# C20 最终核验报告

验证对象：`deliver-versioned-dual-index-hybrid-retrieval`；实际 schema：`riskflow-delivery`。该 schema 仅定义 proposal、specs、design、implementation-plan、tasks 五个规划工件，故本报告作为 change 目录内的验收记录，不修改 schema。

初次核验输入 HEAD：`1c757649d3975cf9e57835bc6c56b79f92694dca`；本次限定审计输入与产物 HEAD：`1c22ddba84fa19fb840e89c1d696f3a8e5b9904f`。本次修复和报告尚未提交；检查点须由协调端审阅后形成。

## Summary

| 维度 | 结果 |
| --- | --- |
| 完整性 | 10 项 Requirement、30 个 Scenario 均对应实现与可运行证据；独立核验和唯一限定审计完成，实施任务 18/18 已勾选 |
| 正确性 | C20-FIN-01～05 与 C20-AUD-01～03 在批准范围内修复；最终 C20 检索套件 8 files / 188 tests、初次直接依赖 7 files / 104 tests 通过；真实 Qdrant 七项硬门通过 |
| 一致性 | D1～D13、IP-00～IP-08 的事实入口、模块边界、代际/权限/结果收口保持；本轮未修改公共 contracts、迁移、依赖或 C17 接缝 |

当前评估：产品回归与唯一限定审计均通过；最终结论和本次运行证据见末节。

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

本轮修复涉及权限过滤，按 implementation-plan §8 对授权顺序与 scope 摘要过滤、跨工程/跨空间召回隔离、point ID 唯一性、事务和代际关键状态机做了唯一一次限定审计，结论见下节。

上述为初次核验结论；唯一一次限定审计的实时结论见下节。协调端尚需审阅检查点；本 worker 不提交、不合并、不归档。

## 唯一一次限定审计（输入 HEAD `1c22ddba84fa19fb840e89c1d696f3a8e5b9904f`）

审计范围：权限、事务、代际关键状态机及语义合并。对照 D5/D6、实施计划 4.1/4.2、生产调用链和现有测试发现以下三项实现偏差；协调端明确批准在本任务内修复，当前结论见本节末尾。

1. **C20-AUD-01，第二代激活无法完成——已修复。** Worker 原先固定 `activationOrdinal: 1`，且按新策略和授权摘要过滤旧代际。现在构建前记录系列当前激活快照；最后在同一消费事务取得系列级 advisory lock，复读当前激活，检查快照未变，再以当前最大序号加一提交 CAS。PostgreSQL adapter 同时拒绝跳号和失配；成功后追加新代际 active、旧代际 superseded。测试覆盖同系列第二代序号 2、策略变更、并发一个胜者、过期快照冲突和不覆盖旧事实。
2. **C20-AUD-02，权限拒绝回归失败——已修复。** 公共查询 Schema 自身会因 capability、project、actor 不匹配而 `safeParse` 失败，旧服务因此错误返回 `UNSUPPORTED_CONTRACT`。现在服务复用公共分支的字段 Schema 先确认结构，再在目标读取前拒绝上述权限不匹配，最后运行完整公共 Schema；三例均返回同形 `AUTHORIZATION_DENIED`，无 input reader、代际、Qdrant 或事实读取。真正的契约漂移仍走 `UNSUPPORTED_CONTRACT`。
3. **C20-AUD-03，永久投影失败的回执与状态不原子——已修复。** 永久失败在 C03 消费回调内追加 `failed` transition 及审计；尚未创建代际的失败直接在同一事务追加结构化失败审计。仅当这些写入成功后才提交 completed 回执；写入异常上抛并回滚，重投复用同一事件身份。真实 PostgreSQL/C03 测试注入事务失败，确认代际、transition、审计均回滚且回执保持 pending；成功重投一次，随后同事件只重放回执，不再写第二份失败事实。

首次定向复现命令：`pnpm exec vitest run packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts apps/worker/test/retrieval/projection-handler.test.ts packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts --testTimeout=180000`，结果 **2 files passed、1 file failed；38 passed、3 failed**，失败均为权限预检期望 `AUTHORIZATION_DENIED`、实际 `UNSUPPORTED_CONTRACT`。修复后同一命令为 **3 files / 44 tests passed**；后续新增过期快照用例单独运行 Worker 文件 **13 tests passed**。

**事务机制差异：** D5 原文写 serializable；实际 C03 `PostgresIdempotentConsumer.consume` 环境事务为 PostgreSQL READ COMMITTED，且在调用 C20 前已读取回执，无法在 C20 内提升隔离级别。协调端明确接受同一环境事务中的系列级 `pg_advisory_xact_lock` 加锁后复读及 CAS 作为等价机制。锁随提交/回滚释放；后续处理者取锁后读取已提交的胜者，失配返回可重试 `ACTIVATION_CONFLICT`。本轮未改 C03、公共 contracts、`000040` 迁移、依赖或 C17 接缝，亦未发现语义 merge 冲突。

### 最终回归与收口

- `pnpm exec vitest run packages/core/test/retrieval packages/adapters/test/retrieval apps/worker/test/retrieval --testTimeout=180000`：**8 files / 188 tests passed**，包含真实 Qdrant adapter 与验收测试，无 skipped 用例。
- `pnpm exec vitest run apps/worker/test/retrieval/projection-handler.test.ts --testTimeout=180000`：新增过期快照用例后 **13 tests passed**；PostgreSQL/C03 失败回滚、并发 CAS 与权限定向测试也包含在上述全套回归中。
- `pnpm exec tsc -b --pretty false`：exit 0。
- `pnpm exec eslint packages/core/src/retrieval/service.ts packages/core/src/retrieval/ports.ts packages/adapters/src/retrieval/postgres-retrieval-adapter.ts apps/worker/src/retrieval/projection-handler.ts apps/worker/test/retrieval/projection-handler.test.ts packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`：exit 0；同一文件清单的 `pnpm exec prettier --check`：通过；`pnpm exec prettier --check openspec/changes/deliver-versioned-dual-index-hybrid-retrieval/verification.md`：通过。
- `openspec validate deliver-versioned-dual-index-hybrid-retrieval --type change --strict --no-interactive`：valid；`openspec status --change deliver-versioned-dual-index-hybrid-retrieval --json`：`riskflow-delivery` 五个规划工件 done、任务 18/18；`git diff --check`：通过。

**最终结论：PASS。** C20-AUD-01～03 已在当前唯一限定审计任务内修复并回归，无未解决产品 finding。产物 Git HEAD 仍为输入 `1c22ddba84fa19fb840e89c1d696f3a8e5b9904f`；本任务修改的七个文件尚未提交，需协调端审阅并形成检查点。本 worker 不提交、不合并、不归档。
