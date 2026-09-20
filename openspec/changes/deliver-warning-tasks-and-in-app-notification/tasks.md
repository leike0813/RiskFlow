## 1. 契约夹具与实施硬门

- [x] 1.1 [IP-01, IP-12] 执行 `openspec instructions apply --change deliver-warning-tasks-and-in-app-notification --json` 并完整读取全部 `contextFiles`；核对 HEAD/base、schemaName、已归档 acknowledge 契约、C25 合并后的 D-09/D-14 表与公共 Schema 接缝及 `000044` 空闲。运行 `git rev-parse HEAD && git status --short && openspec status --change deliver-warning-tasks-and-in-app-notification --json && find packages/adapters/src/postgres/migrations -type f -name '00004[4-7]_*' -print`；任一硬门不符立即 escalation。
  - 证据：HEAD=`3e1d484`（C25 合并检查点之上）、`schemaName=riskflow-delivery`、五工件 done、号段扫描无 `000044`–`000047` 占用（现有最大为 `000036`，`000037`–`000043` 属他 change）。
  - 偏差（代码为准，未改 C25/contracts）：① 空间与风险输入身份在 `business.assessment_preparation_snapshots`（`spatial_scope_ref`、`risk_input_ref`），reader 按 `record → input_snapshot → preparation_snapshot` 三表精确联结，而非计划所述两表；② `RiskAssessmentRecord` 判别字段 `kind` 已由 C25 `102ae48` 落地，context schema 与 reader 按它复验；③ C26 不消费重评估事件，其空侧省略语义不构成接缝；④ 通知接收人非空由 strict policy Schema 的 `min(1)` 失败闭合。
- [x] 1.2 [IP-01] 新增 core/adapter warning fixtures，复用公共 strict Schema、C25 正式 adapter、C03/C06/C07 PostgreSQL fixture、固定策略/授权/时点和一次真实失败 seam；执行 `pnpm exec prettier --check packages/core/test/warning/fixture.ts packages/adapters/test/warning/fixture.ts`，并确认无直接 C25 表 seed、Mock/内存 repository、默认策略或生产导出。
  - 证据：`packages/core/test/warning/fixture.ts`、`packages/adapters/test/warning/fixture.ts`；prettier 通过。adapter fixture 只经 C25 正式 adapter 产生上游事实，adminPool 仅只读计数（另加 `preinsertAuditConflict` 语义的审计主键冲突 seam，与 C25 夹具同法）；无生产导出、无默认策略（provider 只按精确引用解析，`missing` 模式失败闭合）。

## 2. Core warning 子模块

- [x] 2.1 [IP-02] 按 D-01～D-04、D-10 新增 `packages/core/src/warning/{schema,service,index}.ts`，实现 strict private DTO、两个窄 reader/provider、C26 branch service 与 `planWarningOpening`；执行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`。
  - 证据：`tsc -b packages/core/tsconfig.json --pretty false` 通过（exit 0，无诊断）。
- [x] 2.2 [IP-06] 新增表格驱动 core 测试，覆盖空/四类/多类触发、乱序去重、策略精确匹配、稳定归集键、意图唯一和确认不解除风险；执行 `pnpm exec vitest run packages/core/test/warning/warning.test.ts`。
  - 证据：`packages/core/test/warning/warning.test.ts` 10 passed。

## 3. PostgreSQL adapter 与迁移

- [x] 3.1 [IP-03] 只使用 `000044` 新增 D-09 七表迁移及逆序 down，落实 FK/check/unique/partial unique/index/grant 与 append-only 边界；执行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false && git diff --check`，且不修改 provider、旧迁移或中央迁移清单。
  - 证据：`.../warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`；adapter 集成测试含「可重复 up + 逆序 down + 重建七表」用例；`git diff --check` exit 0、provider/旧迁移/中央清单未改。
- [x] 3.2 [IP-04] 新增 `PostgresWarningAssessmentContextReader` 和 `PostgresWarningLifecycleAdapter`，按 D-03/D-06/D-08 实现精确 C25 读取、open、acknowledge 与 transaction-bound delivery writer；执行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`。
  - 证据：`packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`、`index.ts`；tsc 通过。
  - 实现注记：C03 `PostgresTransactionUnit.execute` 的边界只保留持久化错误码，`acknowledge` 的业务拒绝（陈旧版本/配对不符/已确认）在事务失败后按当前可见事实重新定型（`#inspectAcknowledgementTargets` 事务内加锁、事务外定型），公开码与规格一致。
- [x] 3.3 [IP-05] 在 core/adapters package manifests 各增加且只增加 `./warning` feature export；执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false && git diff --check`，确认依赖和锁文件未变。
  - 证据：两个 `package.json` 各新增一个 `./warning` 导出；`git status --short` 无 `pnpm-lock.yaml`、无依赖/脚本改动。
- [x] 3.4 [IP-07] 新增 PostgreSQL 与 G2.5 集成测试，覆盖真实 C25 assessment→warning 链、事务回滚、命令/业务幂等和并发、持续越限同任务、多触发单版本、关闭后新任务、通知意图、审计/Outbox、确认语义/版本/并发；执行 `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`。
  - 证据：`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` 12 passed（含 G2.5 全链、回滚重试、重放/冲突、不同命令并发、持续越限、关闭后新任务、通知策略失败闭合、确认语义/陈旧/并发、迁移生命周期）。
  - 未覆盖（需主调度决策，非 C26 实现缺陷）：规格 Scenario「无触发事实返回空结果」在 adapter 层需要一条 `triggerIndicators` 为空的 C25 持久化记录；C25 组合夹具的固定配置无法产生该记录——沉降序列变体取值 <5 mm 或任何无阈值命中组合都会让 C25 `evaluate` 以 `TERMINAL_FAILURE` 结束（无回执、无事实，复现见回报）。该 Scenario 的规划语义已由 IP-06 core 表测试覆盖，adapter 的空计划分支返回三个空集合且只写回执与审计。

## 4. API 与 Worker

- [x] 4.1 [IP-08] 保持 API 生产代码不变，核对 `HTTP_ROUTE_CATALOG_V1` 的 open/ack、strict transport、服务端授权和 `invokeWarningRecord` 唯一分派；执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts`，若需要新 route/DTO 或不完整 `WarningResponsePortV1` 接线则先 escalation。
  - 证据：两套测试在 §6.1 运行中通过；`git status --short` 无 `apps/api/src` 与 `packages/contracts` 改动；未注入部分 public port。
- [x] 4.2 [IP-09] 新增 Worker warning runtime/index 并从现有 worker root 导出 handler，严格解析 `warning.warning-recorded.v1`，复用 `PostgresIdempotentConsumer` 与 adapter transaction-bound writer；执行 `pnpm exec tsc -b apps/worker/tsconfig.json --pretty false`。
  - 证据：`apps/worker/src/warning/{runtime,index}.ts`、`apps/worker/src/index.ts` 新增导出；tsc 通过。
- [x] 4.3 [IP-09] 新增 Worker PostgreSQL 测试，证明提交后投递、一次失败不回滚 warning、consumer 记录失败并可重试、重复事件仅一份通知；执行 `pnpm exec vitest run apps/worker/test/warning/runtime.test.ts`。
  - 证据：`apps/worker/test/warning/runtime.test.ts` 4 passed（提交后逐意图投递、重复事件 replayed、真实失败后 receipt pending attempt=1 且预警不动、重试只落一份通知、非预警事件与不匹配意图失败闭合）。
  - 实现注记：消费与投递取自同一 adapters 模块图（夹具提供 src 实例）。事务绑定把 Kysely 事务挂在模块级 WeakMap 上，若 app 侧改用 `@riskflow/adapters/postgres` 的 dist 副本与 src 夹具混用，绑定会跨副本失效；生产装配为单一模块图，不受影响。

## 5. Web 所有权保护

- [x] 5.1 [IP-10] 保持 `apps/web/src/**` 不变，验证 `/warnings` 壳层、路由/SSR 和确认不等于解除的既有边界未漂移；执行 `pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx && git diff --exit-code -- apps/web/src`。
  - 证据：两套回归在 §6.1 通过；`git diff --exit-code -- apps/web/src` exit 0。

## 6. 最小必要验证

- [x] 6.1 [IP-06, IP-07, IP-08, IP-09, IP-10, IP-11] 执行全部 C26 及直接契约/UI 代表性测试：`pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx`，全部通过后才勾选。
  - 证据：`Test Files 7 passed (7) / Tests 63 passed (63)`。
- [x] 6.2 [IP-02, IP-04, IP-05, IP-09, IP-11] 执行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`、`pnpm exec eslint packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts` 与 `pnpm exec prettier --check openspec/changes/deliver-warning-tasks-and-in-app-notification packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts packages/core/package.json packages/adapters/package.json`，全部通过后才勾选。
  - 证据：三条命令均 exit 0（tsc 无诊断、eslint 无问题、prettier `All matched files use Prettier code style!`）。
- [x] 6.3 [IP-03, IP-05, IP-11] 执行 `pnpm run deps:check && pnpm run deps:policy && git diff --check`，并以 `git status --short` 确认只出现 implementation-plan §7 allowlist 与本 change 工件；中央迁移登记/测试清单仍由主调度检查点处理。
  - 证据：`deps:check` → `no dependency violations found (269 modules, 733 dependencies)`；`deps:policy` → `OK`；`git diff --check` exit 0；`git status --short` 仅 `apps/worker/src/index.ts`、两个 package.json 与六个新增目录，无中央迁移登记/测试清单改动。
  - 待主调度登记（本 change 不触碰）：`packages/adapters/test/auth/fixture.ts` 与 `packages/adapters/test/postgres/postgres-foundation.test.ts`，精确文本见回报。

## 7. OpenSpec verify

- [x] 7.1 [IP-12] 执行 `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive && openspec status --change deliver-warning-tasks-and-in-app-notification --json`，确认 schemaName=`riskflow-delivery`、五工件完整，且只有在每项行为和证据完成后才勾选实施任务。
  - 证据：`Change 'deliver-warning-tasks-and-in-app-notification' is valid`；status 五工件 done、schemaName `riskflow-delivery`。
- [x] 7.2 [IP-12] 使用项目 `openspec-verify-change` Skill 独立核对 delta spec、D-ID、IP-ID、实现、数据库和 §6 证据；再次运行 `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`，verify 无未解决 finding 才完成，不提交、不归档。
  - 证据：七条 Requirement 逐条映射到实现符号与测试（见回报）；D-01～D-13 全部落实，偏差仅 §1.1/§3.4/§4.3 注记的三处；strict validate 复跑通过；未提交、未归档。

## 8. 限定审计发现的收口（授权：在 C26 内直接收口）

- [x] 8.1 [IP-01, IP-05] 修正授权顺序：空间授权检查必须发生在任何按工程读取评估依据之前，使同工程内的未授权空间目标无法通过 `AUTHORIZATION_DENIED` 与 `BUSINESS_BLOCKED` 的差异被枚举；补回归断言覆盖"未授权目标不得泄露目标状态差异"。
  - 依据：C26 限定审计结论 `openspec/changes/deliver-warning-tasks-and-in-app-notification/verification.md`（finding `open-checks-assessment-before-spatial-authorization`）。
  - 证据：`PostgresWarningAssessmentContextReader.read` 使用 `#verifyCommand` 返回的当前 C06 授权，并在同一精确目标 SQL 中按获准空间过滤；同工程受限空间下存在/不存在评估引用均返回 `AUTHORIZATION_DENIED` 且无回执或预警事实。`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` 通过。
- [x] 8.2 [IP-02, IP-04] 落实 delta spec 既有要求「已关闭任务不得因后续同键预警重新打开」的守卫，使 `closed → open` 不可能发生；优先应用层的条件更新/状态检查，确需数据库约束时按 `§8 共享机械接缝` 处理并在回报中列出精确登记项。补回归断言。
  - 依据：同一审计结论（finding `closed-to-open-transition-guard-missing`）。该要求已存在于本 change 的 delta spec，属缺陷修复而非范围扩张。
  - 证据：`000044` 增加 `warning_response_tasks_no_reopen_trg`，应用角色执行 `closed → open` 收到数据库拒绝且任务保持关闭；迁移重复 up、down、重建及中央 provider 测试均通过。共享机械接缝无需新增登记项，仍只登记既有 `000044`。
- [x] 8.3 [IP-12] 完成 8.1/8.2 后重跑受影响回归与 `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`，并把两项 finding 的处置结论写回 `verification.md`，供协调端再次触发限定审计。
  - 证据：warning adapter 单测 12/12；warning adapter + Worker + PostgreSQL foundation 33/33；core/adapters/worker TypeScript build、ESLint、Prettier、`deps:check`、`deps:policy`、`git diff --check` 与 OpenSpec strict validate 全部通过。最终结论见 `verification.md`。
- [x] 8.4 [IP-01, IP-04, IP-05] 修复复核审计发现的 C26-AUD-03：任务关闭后，重放同一 assessment 的新命令稳定返回**不可重试**的 `TERMINAL_FAILURE`。按本 change delta spec 的既有语义修复该重放路径（关闭任务不得因同键预警重新打开，但重放本身必须得到符合既有幂等/冲突语义的结果，不得退化为不可重试的终态失败），并补回归断言。
  - 依据：C26 复核审计结论 `openspec/changes/deliver-warning-tasks-and-in-app-notification/verification.md`（finding `C26-AUD-03`）。重跑受影响回归与 `openspec validate ... --strict --no-interactive`，并把处置结论写回 verification.md。
  - 证据：`PostgresWarningLifecycleAdapter.open` 只为本事务新建的 warning 创建任务关联、通知意图与 `warning.warning-recorded.v1`；关闭任务后以新命令重放同一 assessment 返回原有规范 warning/task/intent refs，且 task/version/intent/event 计数不变。C26 及直接契约/UI/迁移代表性回归 8 files / 80 tests 全部通过，OpenSpec strict validate 通过。
