## 1. 契约门与夹具

- [x] 1.1 [IP-01、IP-06、IP-11] 以第三次规划修补基线 `08ed107fb31fc4e244f28922d24d33ddfc6cd7d6` 复核 C07/C08/C15/C16/C18 接缝、C15 reader 与生产 `reviewStatus` 消费；运行 `git rev-parse HEAD && rg -n "DataCleaningResultV1Schema|readBoundResult|#finalizePreparation" packages/core/src/engineering-data/cleaning packages/adapters/src/engineering-data/cleaning && rg -n "verifyKnowledgeRevisionApproval|requestReview|#prepareScoringRuleRevision|#appendScoringRuleRelease|reviewStatus" packages apps`，计划外公共契约/文件变化立即升级。
- [x] 1.2 [IP-01] 新增 core/adapter 共用夹具，并接入一条获准、可核验来源版本和资料段定位的真实规范 C15 completed-result 输入；运行 `pnpm exec prettier --check packages/core/test/scoring-rules/fixture.ts packages/adapters/test/scoring-rules/fixture.ts` 验证格式，禁止以合成条文替代 RA-S3/S4 出口。
- [x] 1.3 [IP-11] 在 `PostgresDataCleaningStore` 增加公共 `readBoundResult({projectId, actorId, requestId, requestedAt, authorization, taskRef})` 薄包装，固定按 `engineering-data.evidence-access` 复验 C06 后复用私有 `#readBoundResult`，再以 requestId/规范载荷写既有 C03 只追加回执/审计；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果有界读取|清洗结果不可枚举|清洗结果无正文旁路|清洗结果读取幂等'` 验证统一不可枚举拒绝、撤权不重放旧成功、同键异载荷冲突及 C03/C04 审计重放不增，且不得枚举 branch、复制私有查询、修改 `DataCleaningTaskPortV1`/contracts/C15 表迁移或 `#finalizePreparation` 行为。

## 2. Core

- [x] 2.1 [IP-02、IP-10] 返工 C19 basis reader strict Schema：请求删除 `projectId/actorId`，成功改为顶层七字段并删除 `{releaseSet}`，增加闭合 `unavailable | failed`；保持其它文档/求值 Schema 与 contracts 不变；运行 `pnpm exec prettier --check packages/core/src/scoring-rules`。
- [x] 2.2 [IP-03] 将规则身份固定为 `(ruleId, entityId, versionId)` 并规范排序两端；令 `detectRuleRelations` 只产 relation templates，按最大连通域合并 exact duplicate，拒绝同身份异文和同 pair/domain 的 kind/winner 矛盾；新增最小 `bindScoringRuleRelationsToRevision` 生成 owner-bound `relationId`/snapshot digest，令 assembly 直接消费 conflict/overlap 的 retained/excluded；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '关系身份|修订归属|重叠事实去重|关系贡献冲突'`。
- [x] 2.3 [IP-03、IP-06] 调整 prepared revision 类型，使 C16 生成 revision 后才绑定关系 owner；保持 C07 精确决定 reader 的既有生产实现和 Agent 候选 `pending` 契约，运行 core 全部场景验证。

## 3. Adapter 与持久化

- [x] 3.1 [IP-04] 不修改既有 `000028`：核对 `(relation_id,version_id)` PK、revision FK 和 revision+canonical pair+overlap unique 可分别约束 owner 与 domain collision；完整三元身份、policy、overlap 载荷和 retained/excluded 由 IP-03/IP-05 strict 复验。运行 foundation/auth tests 证明迁移无漂移，禁止修改任何迁移、测试迁移清单、表、列或 provider/runner。
- [x] 3.2 [IP-05] 返工 `PostgresScoringRulesAdapter.prepareRevision`/`appendPreparedRevision`/`#assertRelationGate`/assembly：revision 生成后绑定并原子写关系，删除 relation `ON CONFLICT DO NOTHING`，组装零检测、零写入、零重选边；运行 `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '修订归属|重叠事实去重|关系碰撞回滚'`。
- [x] 3.3 [IP-06] 把 C16 `#publish` 的 C19 最终 gate 从 release insert 后移动到 insert 前；保持真实顺序为 C06→knowledge approval proof→事务锁/校验→C19 relation/C07 gate→release/audit/receipt/outbox；C07 reader 只回归不改生产代码。运行 `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts -t 'C19 发布门禁先于 release insert'`。
- [x] 3.4 [IP-05、IP-06] 补持久化可观测断言：gate 调用时及失败后 release/publish-audit/completed-receipt/outbox 均零增量；成功时 release/publish-audit/completed-receipt 各增一且 outbox 等于 policy 事件数（当前为零）；refs/targets 证明 submit audit→C07 conflict decision→knowledge review decision→publish audit，且 assembly 不新增 relation/task/audit。运行 C19+C16 tests 的 `发布真实顺序|审计顺序|发布回滚`。
- [x] 3.5 [IP-05] 收紧 D-14 runtime：strict input、C06 deny/revoked、C06 retryable fault、授权后首次 unavailable、unavailable replay、success replay integrity、DB/C03/audit transient/terminal 和后续发布/停用不改冻结成员分别断言；运行 `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 运行时边界|basis 历史成功完整性|basis 冻结集合|basis 瞬时失败'`。

## 4. API / Worker

- [x] 4.1 [IP-07] 为现有 C08 Runner 增加 C19 render/interpret 组合函数及根导出，覆盖工具、候选、预算、模型、权限和 finalize 协议；运行 `pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` 验证仍使用同一 Runner。
- [x] 4.2 [IP-05、IP-08] 保持既有 API 通用 `knowledge-modeling.assessment-basis` 路由不变，并用 C19 resolver 结果契约运行回归；执行 `pnpm exec vitest run apps/api/test/http-shell.test.ts` 验证无新增 C19 HTTP 分支。

## 5. Web

- [x] 5.1 [IP-08] 确认 C19 不修改 Web 或新增未授权 UI；运行 `git diff --exit-code -- apps/web` 验证 Web 目录无差异。

## 6. 最小验证

- [x] 6.1 [IP-03、IP-05、IP-06] 运行 implementation-plan §8 的四项定向 core、C19 adapter 与 C16 tests，确认所有关键词均命中测试。
- [x] 6.2 [IP-04、IP-09] 重新运行 PostgreSQL foundation/auth 及 C07/C16/C18/C08/API 代表性回归。
- [x] 6.3 [IP-03～IP-06、IP-09] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`，验证返工接口闭合。
- [x] 6.4 [IP-03～IP-06、IP-09] 运行 implementation-plan §8 列出的定向 `eslint` 与 `prettier --check`。
- [x] 6.5 [IP-09] 运行 `pnpm deps:check && pnpm deps:policy`，确认分层依赖与既有许可证/依赖策略通过且锁文件未变化。
- [x] 6.6 [IP-03、IP-05、IP-06、IP-09] 运行 `rg -n "reviewStatus|detectRuleRelations|ensureConflictReviewLinks|onConflict|appendScoringRuleRelease|releaseSet" packages apps`，确认 assembly 无检测/建任务、relation insert 不吞碰撞、最终 gate 位于 release insert 前且 reader 不重解当前 release。

## 7. OpenSpec verify

- [x] 7.1 [IP-03～IP-06] 逐项核对四项返工后的 Scenario、文件、既有迁移无改动、命令与可观测证据并回填本清单；运行 `openspec validate deliver-structured-scoring-rules-and-applicable-rule-sets --strict --no-interactive` 确认 change 严格通过。
- [x] 7.2 [IP-03～IP-06、IP-09] 返工完成后运行 `openspec instructions apply --change deliver-structured-scoring-rules-and-applicable-rule-sets --json`，确认全部 `contextFiles` 与 reopened tasks 完成后，再交由 `openspec-verify-change` 做完整独立验收；不提交、不归档。
