## 1. 契约门与夹具

- [x] 1.1 [IP-01、IP-11] 在任何生产改动前确认 HEAD/branch、C08/C15/C16/C18 已归档集成、C15 `DataCleaningResultV1Schema`/私有 `#readBoundResult`/`#finalizePreparation` 与既有公共面真实存在且生产代码没有 `reviewStatus` 准入消费者；运行 `git rev-parse HEAD && git branch --show-current && rg -n "DataCleaningResultV1Schema|#readBoundResult|#finalizePreparation" packages/core/src/engineering-data/cleaning packages/adapters/src/engineering-data/cleaning && rg -n "reviewStatus" packages apps`，除已批准 IP-11 公共薄包装外任一硬门不符立即升级。
- [x] 1.2 [IP-01] 新增 core/adapter 共用夹具，并接入一条获准、可核验来源版本和资料段定位的真实规范 C15 completed-result 输入；运行 `pnpm exec prettier --check packages/core/test/scoring-rules/fixture.ts packages/adapters/test/scoring-rules/fixture.ts` 验证格式，禁止以合成条文替代 RA-S3/S4 出口。
- [x] 1.3 [IP-11] 在 `PostgresDataCleaningStore` 增加公共 `readBoundResult({projectId, actorId, requestId, requestedAt, authorization, taskRef})` 薄包装，固定按 `engineering-data.evidence-access` 复验 C06 后复用私有 `#readBoundResult`，再以 requestId/规范载荷写既有 C03 只追加回执/审计；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果有界读取|清洗结果不可枚举|清洗结果无正文旁路|清洗结果读取幂等'` 验证统一不可枚举拒绝、撤权不重放旧成功、同键异载荷冲突及 C03/C04 审计重放不增，且不得枚举 branch、复制私有查询、修改 `DataCleaningTaskPortV1`/contracts/C15 表迁移或 `#finalizePreparation` 行为。

## 2. Core

- [x] 2.1 [IP-02] 实现 C19 strict 文档、manifest、规则操作、`ScoringRuleEvaluationResultV1Schema`、组装/解析命令及闭合原因 Schema，增加 `@riskflow/core/scoring-rules` 子路径且不修改 contracts；运行 `pnpm exec prettier --check packages/core/src/scoring-rules packages/core/package.json` 验证格式。
- [x] 2.2 [IP-03] 在 `validation.ts` 实现并由 core 子路径导出 `normalizeScoringThresholds`、`normalizeGradeIntervals`、`evaluateScoringRule`，让规则校验与冲突/重叠检测共用固定开闭边界，再完成 materialize、三维适用性和确定性筛选；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '内容校验|评分边界|三维适用性|冲突|重叠'` 验证端点、无穷边界、连续性与越界拒绝。
- [x] 2.3 [IP-03] 实现两个只读领域工具协议、`createScoringRuleAuthoringTaskDefinition`、准备快照 reader 与 C16 policy 输入接口，证明 Agent 候选固定 `pending` 且不可发布；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts` 验证 core 全部场景。

## 3. Adapter 与持久化

- [x] 3.1 [IP-04] 新增 `000028_structured_scoring_rules` 迁移的五张只追加关系表、约束、索引和 SELECT/INSERT 权限，并仅在 `packages/adapters/test/postgres/postgres-foundation.test.ts` 与 `packages/adapters/test/auth/fixture.ts` 机械加入对应 import/manifest/module-map 条目；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts` 验证递归发现、顺序和 auth fixture loader，禁止修改生产 provider/runner 或其它迁移条目。
- [x] 3.2 [IP-05、IP-11] 实现 `PostgresScoringRulesAdapter` 的 C15/C04/C18 有界读取、authoring 工具/finalizer、冲突补链、规则集组装、C16 policy 和公共 basis resolve；其 options 只注入 `Pick<PostgresDataCleaningStore, "readBoundResult">` 并经该方法取得 C15 result/artifact，不直读 C15 表或私有 helper；运行 `pnpm exec prettier --check packages/adapters/src/scoring-rules packages/adapters/package.json` 验证格式。
- [x] 3.3 [IP-06] 在 C16 adapter 四个既有 policy 接缝加入 C19 两类定义分派并保留 C18 原实现；运行 `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 验证缺策略阻断、C19 调用及既有类型回归。
- [ ] 3.4 [IP-05、IP-08、IP-11] 完成 PostgreSQL 集成测试，覆盖 C19 只经注入 reader 消费 C15 result/artifact、真实规范→C08→C16/C07→规则发布→三维筛选→规则集人工发布→公共 basis resolve，以及来源/冲突/配置/权限/幂等/并发/事务失败；运行 `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` 验证。
- [x] 3.5 [IP-10] 在既定 C19 core schema/service、`000028` 迁移和 `PostgresScoringRulesAdapter` 中实现 `AssessmentBasisReleaseSetReaderV1.readAssessmentBasisReleaseSet`：成功值含适用规则集完整成员、与 included refs 精确一致的规范排序评分规则成员、带 release/content digest 的 11 类配置成员和可复算 `memberDigest`，同时保持当前 C06 授权复验、无正文、统一不可枚举拒绝与不绕过撤权的幂等审计；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取|basis 不可枚举|basis 成员清单|basis 规则成员与摘要|basis 无正文|basis 读取幂等'` 验证成员双向完备及 C04 正文摘要复算。

## 4. API / Worker

- [x] 4.1 [IP-07] 为现有 C08 Runner 增加 C19 render/interpret 组合函数及根导出，覆盖工具、候选、预算、模型、权限和 finalize 协议；运行 `pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` 验证仍使用同一 Runner。
- [x] 4.2 [IP-05、IP-08] 保持既有 API 通用 `knowledge-modeling.assessment-basis` 路由不变，并用 C19 resolver 结果契约运行回归；执行 `pnpm exec vitest run apps/api/test/http-shell.test.ts` 验证无新增 C19 HTTP 分支。

## 5. Web

- [x] 5.1 [IP-08] 确认 C19 不修改 Web 或新增未授权 UI；运行 `git diff --exit-code -- apps/web` 验证 Web 目录无差异。

## 6. 最小验证

- [x] 6.1 [IP-03、IP-05、IP-06、IP-07、IP-08、IP-10、IP-11] 运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts apps/worker/test/scoring-rules/runtime.test.ts` 验证 C15 reader→C19 core→adapter→worker 主链。
- [x] 6.2 [IP-04、IP-08、IP-09] 运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts apps/worker/test/agent-runtime/runner.test.ts apps/api/test/http-shell.test.ts` 验证迁移测试清单、C18、C08 Worker 与 API 代表性回归。
- [x] 6.3 [IP-02、IP-04～IP-07、IP-09～IP-11] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`，验证所有新导出和注入接口类型闭合。
- [x] 6.4 [IP-02～IP-11] 运行 implementation-plan §8 列出的定向 `eslint` 与 `prettier --check` 命令，修复本 change 文件的静态和格式问题。
- [x] 6.5 [IP-09] 运行 `pnpm deps:check && pnpm deps:policy`，确认分层依赖与既有许可证/依赖策略通过且锁文件未变化。
- [x] 6.6 [IP-03、IP-05、IP-09] 运行 `rg -n "reviewStatus" packages apps` 并审阅全部生产命中，确认已发布消费方只认 C16 release+C07 decision；发现任何状态门禁立即升级。

## 7. OpenSpec verify

- [ ] 7.1 [IP-01～IP-11] 逐项核对 implementation-plan 的 Requirement/Scenario、文件、迁移、命令与证据映射并回填本清单；运行 `openspec validate deliver-structured-scoring-rules-and-applicable-rule-sets --type change --strict --no-interactive` 确认 change 严格通过。
- [x] 7.2 [IP-09～IP-11] 运行 `openspec instructions apply --change deliver-structured-scoring-rules-and-applicable-rule-sets --json`，确认 `schemaName`、全部 `contextFiles` 和完成进度正确后交由 `openspec-verify-change` 独立验收；本任务不提交、不归档。
