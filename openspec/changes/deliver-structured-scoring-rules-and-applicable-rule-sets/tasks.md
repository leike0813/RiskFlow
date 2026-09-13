## 1. 契约门与夹具

- [ ] 1.1 [IP-01、IP-06、IP-11] 以返工基线 `7b60892b1561aff7e8bc9357da78c97abad55b17` 复核 C07/C08/C15/C16/C18 接缝、C15 reader 与生产 `reviewStatus` 消费；运行 `git rev-parse HEAD && rg -n "DataCleaningResultV1Schema|readBoundResult|#finalizePreparation" packages/core/src/engineering-data/cleaning packages/adapters/src/engineering-data/cleaning && rg -n "verifyKnowledgeRevisionApproval|requestReview|#prepareScoringRuleRevision|#appendScoringRuleRelease|reviewStatus" packages apps`，计划外公共契约/文件变化立即升级。
- [x] 1.2 [IP-01] 新增 core/adapter 共用夹具，并接入一条获准、可核验来源版本和资料段定位的真实规范 C15 completed-result 输入；运行 `pnpm exec prettier --check packages/core/test/scoring-rules/fixture.ts packages/adapters/test/scoring-rules/fixture.ts` 验证格式，禁止以合成条文替代 RA-S3/S4 出口。
- [x] 1.3 [IP-11] 在 `PostgresDataCleaningStore` 增加公共 `readBoundResult({projectId, actorId, requestId, requestedAt, authorization, taskRef})` 薄包装，固定按 `engineering-data.evidence-access` 复验 C06 后复用私有 `#readBoundResult`，再以 requestId/规范载荷写既有 C03 只追加回执/审计；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果有界读取|清洗结果不可枚举|清洗结果无正文旁路|清洗结果读取幂等'` 验证统一不可枚举拒绝、撤权不重放旧成功、同键异载荷冲突及 C03/C04 审计重放不增，且不得枚举 branch、复制私有查询、修改 `DataCleaningTaskPortV1`/contracts/C15 表迁移或 `#finalizePreparation` 行为。

## 2. Core

- [ ] 2.1 [IP-02、IP-10] 返工 C19 basis reader strict Schema：请求删除 `projectId/actorId`，成功改为顶层七字段并删除 `{releaseSet}`，增加闭合 `unavailable | failed`；保持其它文档/求值 Schema 与 contracts 不变；运行 `pnpm exec prettier --check packages/core/src/scoring-rules`。
- [ ] 2.2 [IP-03、IP-10] 保留唯一边界求值 helper，扩充 `detectRuleRelations` 的候选 revision/base 绑定，令规则集筛选只消费既有关系事实；修改 basis member builders/assertion，使 included refs 与 scoring members 重复、缺失或额外时失败而不静默去重；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '评分边界|发布前冲突|重叠|basis 成员清单|basis 规则成员与摘要'`。
- [ ] 2.3 [IP-03、IP-06] 返工 C16 policy prepared input 和 C07 精确冲突决定读取接缝，保持 Agent 候选固定 `pending` 且不可发布；运行 core 全部场景验证。

## 3. Adapter 与持久化

- [ ] 3.1 [IP-04] 在既有 `000028` 五表内给 `rule_relations` 增加候选 C16 revision 与比较基线绑定、FK/唯一约束，从 review link 删除重复的 C07 decision/status，保持只追加权限和迁移编号；运行 PostgreSQL foundation/auth 测试，禁止新增迁移文件或修改生产 provider/runner。
- [ ] 3.2 [IP-05、IP-11] 返工 `PostgresScoringRulesAdapter`：关系检测/写入移到 structured-rule submit，C07 补链移到 submit 后，C16 review/publish 读取精确决定；assembly 删除检测/建任务；保留 C15/C04/C18 有界读取和公共 resolve；运行 adapter 格式检查。
- [ ] 3.3 [IP-06] 返工 C16 四个 C19 policy 接缝的 revision 参数与事务时点，并在 C07 concrete adapter 增加精确 `rule-conflict` 决定读取；运行 C16/C07 adapter tests，确认不改公共 contracts 和 C18 行为。
- [ ] 3.4 [IP-05、IP-08] 重写 PostgreSQL 主链为“规则编制→发布前关系事实→C07 决定→C16 knowledge review/final gate→规则发布→只读关系组装→规则集发布→basis”，覆盖补链补偿、发布回滚和 assembly 零新增关系事实；运行 C19 adapter test。
- [ ] 3.5 [IP-02、IP-03、IP-05、IP-10] 返工 basis reader 顶层投影、included refs 双向一致、无正文、授权有效 missing/corrupt 的 `.unavailable` audit+receipt、success/unavailable 重放、同键异载荷、撤权和瞬时 failed；运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取|basis 不可枚举|basis 成员清单|basis 规则成员与摘要|basis 无正文|basis 读取幂等|basis 不可用幂等|basis 瞬时失败'`。

## 4. API / Worker

- [x] 4.1 [IP-07] 为现有 C08 Runner 增加 C19 render/interpret 组合函数及根导出，覆盖工具、候选、预算、模型、权限和 finalize 协议；运行 `pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` 验证仍使用同一 Runner。
- [x] 4.2 [IP-05、IP-08] 保持既有 API 通用 `knowledge-modeling.assessment-basis` 路由不变，并用 C19 resolver 结果契约运行回归；执行 `pnpm exec vitest run apps/api/test/http-shell.test.ts` 验证无新增 C19 HTTP 分支。

## 5. Web

- [x] 5.1 [IP-08] 确认 C19 不修改 Web 或新增未授权 UI；运行 `git diff --exit-code -- apps/web` 验证 Web 目录无差异。

## 6. 最小验证

- [ ] 6.1 [IP-03、IP-05、IP-06、IP-08、IP-10] 运行 implementation-plan §8 的 C19 core、C19 adapter、C16 与 C07 定向测试，验证发布前生命周期和 reader 主链。
- [ ] 6.2 [IP-04、IP-08、IP-09] 重新运行 PostgreSQL foundation/auth、C18、C08 Worker 与 API 代表性回归。
- [ ] 6.3 [IP-02～IP-06、IP-09、IP-10] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`，验证返工接口闭合。
- [ ] 6.4 [IP-02～IP-10] 运行 implementation-plan §8 列出的定向 `eslint` 与 `prettier --check`。
- [x] 6.5 [IP-09] 运行 `pnpm deps:check && pnpm deps:policy`，确认分层依赖与既有许可证/依赖策略通过且锁文件未变化。
- [ ] 6.6 [IP-03、IP-05、IP-06、IP-09] 运行 `rg -n "reviewStatus|detectRuleRelations|ensureConflictReviewLinks|releaseSet" packages apps`，确认准入只认 C16 release+C07 决定、assembly 无检测/建任务、reader 无旧 success 包装。

## 7. OpenSpec verify

- [ ] 7.1 [IP-01～IP-11] 逐项核对返工后的 Requirement/Scenario、文件、迁移、命令与证据映射并回填本清单；运行 `openspec validate deliver-structured-scoring-rules-and-applicable-rule-sets --strict --no-interactive` 确认 change 严格通过。
- [ ] 7.2 [IP-09～IP-11] 返工完成后运行 `openspec instructions apply --change deliver-structured-scoring-rules-and-applicable-rule-sets --json`，确认 `schemaName`、全部 `contextFiles` 和完成进度正确后再交由 `openspec-verify-change` 独立验收；不提交、不归档。
