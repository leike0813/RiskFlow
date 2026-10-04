# Verification

## 验收对象

- Change：`fix-workflow-body-read-authorization-identity`（schema：`orchestrated-delivery`）
- 输入实现 HEAD：`87fc7a28b6cf0e127e61e811f547d60c098bfe26`（施工基线 `101882253580364fa37d27f44cf79d8dce2c1573`）
- 最终验收 HEAD：`b393205`（实现提交至 HEAD 之间只有 `feat(demo)` 接线改动，与本 change 文件清单无交集）
- 验收 Agent：mavis（MiniMax Code）。按用户在归档前的明确选择，由本 Agent 直接完成核验与本工件，未另起独立 Finalizer session；本工件为自证记录，不是第三方独立验收。

## 结论

**PASS**，边界限定在本 change 的已批准范围内：

- 覆盖 delta Requirement 的 3 条 Scenario 与 IP-01～IP-06 全部施工项，均有代码位置与可运行命令支撑。
- 权限路径的三项必查点（C05 收窄、C06 重放比对、branch 绑定）经逐行核对未被放宽，且不在实现提交的改动文件清单内。
- 验收未修改任何产品代码（见下节），因此最终验收 HEAD 与输入实现 HEAD 在范围内一致。
- **边界之外**：`pnpm lint` 在验收时的工作区报红，成因是 `apps/worker/src/risk-flow/runtime.ts`、`demo/test/browser/server.mjs` 的并发未提交诊断改动，不属于本 change 的文件清单，也不在 HEAD 中；同一文件 HEAD 内容单独 lint 退出码为 0。本结论不覆盖该并发改动。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| delta Requirement：派生身份必须纳入调用主体或当前授权上下文维度 | `packages/adapters/src/workflow/postgres-workflow-projection.ts:1430-1435`（`scopedInvocationId` 追加 `input.authorization.authorizationContextRef.reference.entityId`） | 符合 |
| Scenario 1：同一授权下同一目标可被重复读取 | `postgres-workflow-projection.test.ts:800-840`（复验轮换上下文后连续两次 `readPage` 均成功，且签发身份随 `verified-context-*` 变化）；`pnpm exec vitest run packages/adapters/test/workflow apps/worker/test/risk-flow apps/worker/test/assessment` | 100/100 通过 |
| Scenario 1（端到端正向证据） | `demo/test/browser/assessment-warning-response.spec.ts:198` 续页用例；`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts -g "C31 运行摘要按页追溯\|父子运行在摘要里按真实父运行引用呈现"` | 2 passed（40.2s） |
| Scenario 2：不同授权读取同一目标互不冲突 | `postgres-workflow-projection.test.ts:752-765`（每个签发身份都带非空父上下文后缀）、`:811-819`（不同父上下文对应不同身份）；C06 替身按真实重放语义建模（`:151-159`，同一身份绑定不同父上下文即拒绝） | 符合且不冲突 |
| Scenario 3：省略身份的调用方不得静默退回固定派生 | `packages/core/src/workflow/service.ts:126-138`（`invocationId` 为必填，无可选分支）；`postgres-workflow-adapter.ts:1758-1767`（按传入身份复验，内部固定派生已删除）；`postgres-workflow-projection.ts:1463`、`apps/worker/src/risk-flow/graph.ts:1501-1505`（两处生产调用点显式传入）；全库 `bodies.readBody` 调用点共 6 处（2 生产 + 4 测试）均已传参；`pnpm typecheck` | 通过，无缺省身份分支 |
| IP-01 | `packages/core/src/workflow/service.ts:126-138` | 完成 |
| IP-02 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts:1751-1776` | 完成 |
| IP-03 | `postgres-workflow-projection.ts:1419-1469`（派生并透传同一身份） | 完成 |
| IP-04 | `apps/worker/src/risk-flow/graph.ts:1496-1507`（按同一导出函数派生传入，值与原内部派生同形） | 完成 |
| IP-05 | `postgres-workflow-projection.test.ts:151-159, 752-765, 800-840` | 完成 |
| IP-06 | `apps/worker/test/risk-flow/runtime.test.ts:966`、`acceptance.test.ts:1155`、`apps/worker/test/assessment/runtime.test.ts:687`、`packages/adapters/test/human-decision-feedback/fixture.ts:1005` | 完成 |
| 回归：`typecheck` / `format:check` / `deps:check` / `deps:policy` / `build` / `demo build` | 逐项执行（`tsc -b --pretty false` 等） | 全部通过 |
| 回归：`openspec:validate` 与 change 严格校验 | `pnpm openspec:validate`；`openspec validate fix-workflow-body-read-authorization-identity --strict --no-interactive` | 39 passed / 0 failed；change is valid |
| 回归：demo 浏览器全量 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` | 50 passed / 1 flaky（重试通过）/ 1 failed（未跟踪探针文件，运行中被并发删除） |

验收阶段修复：无。验收未修改任何实现、测试或规划工件。

## 限定审计

design 的 Risks 段落以 `permission` 标签声明了三项必查点，本轮由验收 Agent 直接逐行核对（未另派 Targeted Auditor session，证据为下列代码位置与既有测试）：

1. **不同主体不再共用身份，无越权**：`scopedInvocationId` 后缀取本次读取所依据的已复验上下文引用（`postgres-workflow-projection.ts:1435`），主体差异必然体现在上下文引用上；C06 对 `system` 调用强制 `systemActorId === parent.actorId`，否则 `AUTHORIZATION_DENIED`（`postgres-local-identity-access.ts:2794-2796`）；子上下文必须为父上下文子集（`:2832-2837`）。`readBody` 复验前仍逐项校验 `authorization.projectId` / `actorId` 与请求一致（`postgres-workflow-adapter.ts:514-518`）。
2. **收窄语义未放宽**：正文读取以 `requestedSpatialScopeRefs: []` 签发，C06 以父上下文空间范围兜底（`:2797`），子集不成立即拒绝（`:2832-2837`）；`postgres-local-identity-access.ts` 未出现在 `git show --stat 87fc7a2` 的改动清单中。
3. **`verify` 的 branch 绑定未变**：`BRANCH_BY_CAPABILITY_V1` 与复验 branch 仍由实际持有的 capability 唯一决定（`postgres-workflow-adapter.ts:126-137, 519-521`）；投影侧仍按 `projection.query` 签发（`postgres-workflow-projection.ts:1441`），与既有 D6 一致。

补充核对：C06 重放路径的逐项比对（`parent_context_id`、`causal_run_ref`、invocation、能力位、空间范围、资料版本）位于 `postgres-local-identity-access.ts:2863-2885`，同样不在本次改动清单内，未被放宽。

## 后续注意事项

- 验收时工作区存在并发的未提交诊断改动：`apps/worker/src/risk-flow/runtime.ts`（临时 `appendFileSync` 日志，含 `require()` 式导入，导致 `pnpm lint` 报红）与 `demo/test/browser/server.mjs`。该改动与本 change 无关，本工件不为其背书，需由其作者自行收口。
- `demo/test/browser/assessment-warning-response.spec.ts:106`「处置域深链在无对应登记事实时诚实失败」在全量浏览器回归中首次因 trace 产物写入 `ENOENT` 失败、重试通过，属 flaky，未在本 change 范围内处理。
- `demo/test/browser/tmp-seam-probe.spec.ts` 为未跟踪的临时探针文件，浏览器回归期间被并发删除，导致该 run 报 1 failed；提交前不应保留。
- `implementation-plan.md` §6 的修改文件清单未列出 `demo/test/browser/assessment-warning-response.spec.ts`（实现提交中新增 121 行，作为 Scenario 1 的端到端正向证据），属计划文档与实际改动范围的轻微漂移，不涉及公共契约、依赖或迁移。
- 活动中的 `deliver-assessment-warning-and-response-ui` 在 `design.md:123` 以「按 operation 提取的入出类型 + 唯一 invocationId」描述下游读路径；本 change 的 delta 同步进主 specs 后，该表述需与新增的「正文读取身份必填、纳入授权上下文维度」口径对齐。
