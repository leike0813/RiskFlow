## 1. 契约夹具与实现硬门

- [x] 1.1 [IP-01, IP-12] 执行 `openspec instructions apply --change deliver-deterministic-risk-assessment --json` 并完整读取全部 `contextFiles`，核对 `evolve-assessment-preparation-entry-fields`、`implement-external-risk-event-registration`、`implement-monitoring-series-reader` 三个前置 change，随后核对 HEAD、C19 D-03 完整 reader 与共用评分 helper、22 类引用来源、C11/C24 `RiskInputFactsReaderV1` 正式所有者和 `000032` 空闲；以 `git rev-parse HEAD && git status --short && openspec list && rg -n "entryMode|triggerReasonCode|monitoringSnapshotRefs|previousMonitoringSnapshotRefs|newMonitoringSnapshotRefs|registerExternalRiskEvent|RiskInputFactsReaderV1|MonitoringSeriesReaderV1|AssessmentBasisReleaseSetReaderV1|AssessmentBasisReleaseSetReadV1|normalizeGradeIntervals|evaluateScoringRule" packages/contracts/src packages` 验证，任一硬门不满足即升级。
- [x] 1.2 [IP-01] 新增 core/adapter 风险评估 fixtures，全部使用公共 strict Schema、正式 refs、固定版本/时点和测试专用 provider，且无生产 seed/内存仓储；执行 `pnpm exec prettier --check packages/core/test/risk-assessment/fixture.ts packages/adapters/test/risk-assessment/fixture.ts` 验证。

## 2. Core 确定性引擎

- [x] 2.1 [IP-02] 实现 C25 strict DTO、闭合 reason/error、四个外部读取依赖加一个 preparation context 接缝，以及有限 number 的 BigInt 十进制原语；执行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false` 验证类型边界。
- [x] 2.2 [IP-03] 实现指标全量物化、复用 C19 共用 helper 的规则求值、P/C、矩阵、四类触发和评估记录纯函数，保证端点/无穷边界与 C19 一致，任一缺值/单位/规则/边界失败不返回部分结果且不依赖 Agent；执行 `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts` 验证。
- [x] 2.3 [IP-08] 补齐表格驱动 core 测试，覆盖所需监测序列的零/一/多快照、运算符、区间、正负 half-away、weighted/maximum、矩阵首/共享/末/越界、四类 trigger、乱序重放和 Agent-free；执行 `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts packages/core/test/assessment-config/assessment-config.test.ts` 验证。

## 3. PostgreSQL Adapter 与正式事务链

- [ ] 3.1 [IP-06] 新增唯一 `000032_deterministic_risk_assessment` 迁移，落实五张只追加表、XOR/FK/check/unique/index、审计/回执关系及 `riskflow_app` SELECT/INSERT 权限；执行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` 验证递归发现、up/down 与权限。
- [ ] 3.2 [IP-04] 在 C11 PostgreSQL adapter 中完成 `freeze(assessment-preparation)`、`engineering.inputs-ready.v1` 原子提交和 C25/C19 受权窄 reader；消费前置 change 已集成的外部事件登记/读取，不实现或改写该分支；验证入口/复数 refs 原样冻结、optional 正确省略、每个 snapshot 的 C14 series 身份/工程/空间/版本均受权复验，空/重复/越权/series 不一致及缺 required 字段闭合拒绝，且不改变其它分支；执行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 验证。
- [x] 3.3 [IP-05] 实现 `PostgresRiskAssessmentEngine.prepare/evaluate`，按 D-10 顺序完成 C19 descriptors、C04 正文、runtime policies、C14 snapshot、纯计算、C04 decision artifact 和单事务正式事实；执行 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` 验证。
- [x] 3.4 [IP-07] 在 core/adapters package manifests 增加且只增加 `./risk-assessment/engine` export，不改依赖与锁文件；执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false && git diff --check` 验证。
- [x] 3.5 [IP-09] 完成 PostgreSQL 集成与 G2.5 fixture 测试，覆盖标准化记录与正式登记外部事件两类 XOR、外部未登记/reader 不可用/越权失败、监测所需序列零/一/多快照、完整/缺失 policy、初评/重评/补算、缺值/单位、原子回滚、幂等/并发、audit/outbox 及标准化风险记录纵向链；执行 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 验证。

## 4. API 与 Worker 接入确认

- [x] 4.1 [IP-10] 保持既有 API 四个 risk-assessment 通用路由不变，确认真实 `RiskAssessmentPortV1` 注入后请求/结果 Schema 无漂移；执行 `pnpm exec vitest run apps/api/test/http-shell.test.ts` 验证，若必须新增 transport 则先升级。
- [x] 4.2 [IP-10] 保持 Worker 无 C25 Agent、空 runner 或 LangGraph 组合，确认 engine 依赖方向与现有 runner 均正常；执行 `pnpm exec vitest run apps/worker/test/agent-runtime/runner.test.ts && pnpm run deps:check` 验证。

## 5. Web 所有权保护

- [x] 5.1 [IP-11] 不修改 C34 所属 Web 页面，确认没有 fixture、开发说明或未归属评估 UI 泄入前端；执行 `pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx && git diff --check` 验证。

## 6. 最小完整验证

- [x] 6.1 [IP-08, IP-09, IP-10, IP-11, IP-12] 执行 C25 与直接依赖代表性测试：`pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/assessment-config/assessment-config.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts apps/api/test/http-shell.test.ts apps/worker/test/agent-runtime/runner.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx`，全部通过后才勾选。
- [x] 6.2 [IP-02, IP-05, IP-06, IP-07, IP-12] 执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false && pnpm run lint && pnpm run format:check && pnpm run deps:check && pnpm run deps:policy && git diff --check`，确认类型、格式、依赖、受保护文件和无新依赖全部通过。

## 7. OpenSpec Verify

- [x] 7.1 [IP-12] 执行 `openspec validate deliver-deterministic-risk-assessment --strict && openspec status --change deliver-deterministic-risk-assessment --json`，确认 schemaName 仍为 `riskflow-delivery`、五工件完整、所有实施 task 已有行为与证据后再勾选。
- [ ] 7.2 [IP-12] 调用项目 `openspec-verify-change` Skill 独立核对 delta spec、D-ID、IP-ID、实现、数据库和 §6 证据；以再次执行 `openspec validate deliver-deterministic-risk-assessment --strict` 通过且 verify 报告无未解决 finding 为完成标准，不归档、不提交。
