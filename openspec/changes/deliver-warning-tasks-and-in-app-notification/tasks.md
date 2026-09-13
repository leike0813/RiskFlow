## 1. 契约夹具与实施硬门

- [ ] 1.1 [IP-01, IP-12] 执行 `openspec instructions apply --change deliver-warning-tasks-and-in-app-notification --json` 并完整读取全部 `contextFiles`；核对 HEAD/base、schemaName、已归档 acknowledge 契约、C25 合并后的 D-09/D-14 表与公共 Schema 接缝及 `000044` 空闲。运行 `git rev-parse HEAD && git status --short && openspec status --change deliver-warning-tasks-and-in-app-notification --json && find packages/adapters/src/postgres/migrations -type f -name '00004[4-7]_*' -print`；任一硬门不符立即 escalation。
- [ ] 1.2 [IP-01] 新增 core/adapter warning fixtures，复用公共 strict Schema、C25 正式 adapter、C03/C06/C07 PostgreSQL fixture、固定策略/授权/时点和一次真实失败 seam；执行 `pnpm exec prettier --check packages/core/test/warning/fixture.ts packages/adapters/test/warning/fixture.ts`，并确认无直接 C25 表 seed、Mock/内存 repository、默认策略或生产导出。

## 2. Core warning 子模块

- [ ] 2.1 [IP-02] 按 D-01～D-04、D-10 新增 `packages/core/src/warning/{schema,service,index}.ts`，实现 strict private DTO、两个窄 reader/provider、C26 branch service 与 `planWarningOpening`；执行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`。
- [ ] 2.2 [IP-06] 新增表格驱动 core 测试，覆盖空/四类/多类触发、乱序去重、策略精确匹配、稳定归集键、意图唯一和确认不解除风险；执行 `pnpm exec vitest run packages/core/test/warning/warning.test.ts`。

## 3. PostgreSQL adapter 与迁移

- [ ] 3.1 [IP-03] 只使用 `000044` 新增 D-09 七表迁移及逆序 down，落实 FK/check/unique/partial unique/index/grant 与 append-only 边界；执行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false && git diff --check`，且不修改 provider、旧迁移或中央迁移清单。
- [ ] 3.2 [IP-04] 新增 `PostgresWarningAssessmentContextReader` 和 `PostgresWarningLifecycleAdapter`，按 D-03/D-06/D-08 实现精确 C25 读取、open、acknowledge 与 transaction-bound delivery writer；执行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`。
- [ ] 3.3 [IP-05] 在 core/adapters package manifests 各增加且只增加 `./warning` feature export；执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false && git diff --check`，确认依赖和锁文件未变。
- [ ] 3.4 [IP-07] 新增 PostgreSQL 与 G2.5 集成测试，覆盖真实 C25 assessment→warning 链、事务回滚、命令/业务幂等和并发、持续越限同任务、多触发单版本、关闭后新任务、通知意图、审计/Outbox、确认语义/版本/并发；执行 `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`。

## 4. API 与 Worker

- [ ] 4.1 [IP-08] 保持 API 生产代码不变，核对 `HTTP_ROUTE_CATALOG_V1` 的 open/ack、strict transport、服务端授权和 `invokeWarningRecord` 唯一分派；执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts`，若需要新 route/DTO 或不完整 `WarningResponsePortV1` 接线则先 escalation。
- [ ] 4.2 [IP-09] 新增 Worker warning runtime/index 并从现有 worker root 导出 handler，严格解析 `warning.warning-recorded.v1`，复用 `PostgresIdempotentConsumer` 与 adapter transaction-bound writer；执行 `pnpm exec tsc -b apps/worker/tsconfig.json --pretty false`。
- [ ] 4.3 [IP-09] 新增 Worker PostgreSQL 测试，证明提交后投递、一次失败不回滚 warning、consumer 记录失败并可重试、重复事件仅一份通知；执行 `pnpm exec vitest run apps/worker/test/warning/runtime.test.ts`。

## 5. Web 所有权保护

- [ ] 5.1 [IP-10] 保持 `apps/web/src/**` 不变，验证 `/warnings` 壳层、路由/SSR 和确认不等于解除的既有边界未漂移；执行 `pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx && git diff --exit-code -- apps/web/src`。

## 6. 最小必要验证

- [ ] 6.1 [IP-06, IP-07, IP-08, IP-09, IP-10, IP-11] 执行全部 C26 及直接契约/UI 代表性测试：`pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx`，全部通过后才勾选。
- [ ] 6.2 [IP-02, IP-04, IP-05, IP-09, IP-11] 执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`、`pnpm exec eslint packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts` 与 `pnpm exec prettier --check openspec/changes/deliver-warning-tasks-and-in-app-notification packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts packages/core/package.json packages/adapters/package.json`，全部通过后才勾选。
- [ ] 6.3 [IP-03, IP-05, IP-11] 执行 `pnpm run deps:check && pnpm run deps:policy && git diff --check`，并以 `git status --short` 确认只出现 implementation-plan §7 allowlist 与本 change 工件；中央迁移登记/测试清单仍由主调度检查点处理。

## 7. OpenSpec verify

- [ ] 7.1 [IP-12] 执行 `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive && openspec status --change deliver-warning-tasks-and-in-app-notification --json`，确认 schemaName=`riskflow-delivery`、五工件完整，且只有在每项行为和证据完成后才勾选实施任务。
- [ ] 7.2 [IP-12] 使用项目 `openspec-verify-change` Skill 独立核对 delta spec、D-ID、IP-ID、实现、数据库和 §6 证据；再次运行 `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`，verify 无未解决 finding 才完成，不提交、不归档。
