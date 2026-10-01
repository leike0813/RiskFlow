# Verification

## 验收对象

- Change：`fix-projection-reverification-identity-seam`
- 输入实现 HEAD：`71465787d50e669ad7317fbb0b7e474130ad7b2c`（implementation-plan §1 固定基线 + C33 未提交工作区改动）
- 最终验收 HEAD：`71465787d50e669ad7317fbb0b7e474130ad7b2c`（沿用既有裁决全程不提交 Git，实现以未提交工作区形式存在；验收期未改动任何代码，输入与最终 HEAD 为同一基点）
- 验收 Agent：Kimi Code（Finalizer，本收尾会话，2026-10-01）

## 结论

**PASS**。spec delta 唯一 Requirement 的三条 Scenario、design D1–D7 与 implementation-plan IP-01～08 全部闭合，且均有新鲜可运行证据：投影三路径（trace-chain / association-graph / risk-overview）在真实 HTTP 接缝（testcontainers PostgreSQL + 生产迁移 + 真实登录会话）全部正向 200；`demo-chromium` 25/25 通过（含翻正后的关联图正向、证据追溯 1–5 号节点正向 + 6–8 号缺席形态、运行记录链运行组正向，以及 C32 read-only 回归 11 条）；限定审计「修复未放宽失败闭合」专项核验通过（见下）。本 change 无验收期修复。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| delta「受保护读端口必须以当前调用的领域标识复验签发身份」Scenario 1：HTTP 签发的授权可通过投影复验 | 探针 `.scratch/c33-finalizer-projection-repro.mjs`（原 404 最小复现）2026-10-01 复跑：`projection.query` trace-chain 返回 `200 {"kind":"succeeded",...}`，取得真实 `queryResultRef`；浏览器用例「关联图无主体时…带主体时呈现可证明关联边」正向呈现链边 | 通过 |
| delta Scenario 2：结果再读取以本次调用身份复验 | `apps/api/src/http.ts:603-620` invoker 透传信封 `query.queryId`（`http-shell.test.ts:1181` 断言 `readPage` 收到 `queryId: "query-1"`）；`postgres-workflow-projection.ts:510-511` 复验用请求 `queryId` + `projection.result-read` branch；探针 association-graph 与 risk-overview 的 `readPage` 均 200 返回真实 page（risk-overview 含 run-summary 行，证明 D6 正文重签发路径可达） | 通过 |
| delta Scenario 3：无配对签发方的派生身份不得复现 | 全仓 grep：`c30-query:`/`c30-read-page:`/`c22-risk-record-trace:` 在生产代码零残留（仅测试断言其不再出现与历史文档）；`riskRecordTraceReadInvocationIdV1` 已删除；回归锁测试 `never reverifies with a self-derived identity on the query/readPage paths` 通过 | 通过 |
| IP-01 契约加法字段 | `packages/contracts/src/ports/index.ts:2883-2891`（`ProjectionResultReadRequestV1Schema` +`queryId`）、`:2792-2799`（`RiskRecordTraceReadRequestV1Schema` +`invocationId`/`branch`，branch 限 `ModuleBranchV1Schema` 成员）；均为 strict 对象加法，既有字段与结果形状不变 | 通过（`pnpm vitest run packages/contracts` 含于 234 全绿） |
| IP-02 投影适配器复验身份 | `query()` `:314-315` 复验 `parsed.data.queryId` + `projection.query`；`readPage()` `:510-511` 复验请求 `queryId` + `projection.result-read`（branch 不再由 capability 反推）；`#evidenceForSubject`/`#evidenceBatch` 按入口透传身份对（`:557/:567/:579`、`:908-909`、`:1135-1136`） | 通过（代码核验 + 探针 200 + 适配器测试 14/14） |
| IP-03 C22 窄读复验身份 | `postgres-risk-record-trace-reader.ts:131-136` 复验改请求 `invocationId`+`branch`；`TRACE_READ_BRANCH_V1` 硬编码与派生函数已删除 | 通过（candidate-adapter 测试 15/15，伪 issuer 按请求身份对签发） |
| IP-04 HTTP 透传 | 见 Scenario 2 行 | 通过（http-shell 25/25） |
| IP-05 测试身份断言锁回归 | `postgres-workflow-projection.test.ts:1536-1543` 断言复验身份不以 `c30-query:`/`c30-read-page:`/`c22-risk-record-trace:` 开头；stub verify 记录 `invocationId`+`branch` 配对 | 通过（14/14） |
| IP-06 harness 注入与断言翻正 | `demo/test/browser/server.mjs:2094-2104` 投影注入真实 `riskRecordTrace: createPostgresRiskRecordTraceReader(...)`，播种行补齐授权摘要匹配字段、播种时点早于查询登记时点；`identification-review.spec.ts` 三处翻正（关联图正向 `:198-217`；证据追溯 1–5 正向 + 6–8 缺席 `:350-378`；运行记录链运行组正向 `:380-391`） | 通过（demo-chromium 25/25） |
| IP-07 回归 | C32 `read-only.spec.ts` 11 条全绿（viewer 追溯降权用例 `:164` 仍走「暂无关联对象」分支，未改写）；复现脚本复跑 200 | 通过 |
| IP-08 D6 进程内重签发 | `postgres-workflow-projection.ts:1419-1462` `#readBodyAuthorized`：以 `workflowGraphReadInvocationIdV1({operation:"body-read",...})` + `projection.query` branch 重新 `authorize`（`invocation.kind:"system"`、`parentContext` 收窄自当前已复验上下文），签发或读取失败一律按不可读收口；options `authorization` 扩展为 `Pick<LocalIdentityAccessV1,"verify"\|"authorize">`，demo 装配点已注入 `access` | 通过（risk-overview readPage 返回 run-summary 行 = 正文读取成功；适配器测试全绿） |
| 全量门禁 | `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck`（exit 0）；`pnpm vitest run packages/contracts packages/core/test/access.test.ts packages/adapters/test/identification packages/adapters/test/review-audit packages/adapters/test/workflow apps/api`（18 文件 234 passed，162.5s）；`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`（25 passed，1.7m）；`pnpm openspec:validate`（38 passed, 0 failed）；`openspec validate fix-projection-reverification-identity-seam --strict --no-interactive` → valid | 通过（2026-10-01 全部真实复跑） |
| 三路径探针（真实 HTTP 接缝） | trace-chain：`.scratch/c33-finalizer-projection-repro.mjs` → `projection.query` 200 succeeded；association-graph：`.scratch/c33-finalizer-graph-probe.mjs` → query 200 + readPage 200（5 条真实 trace-link，含 evidenceLocator）；risk-overview：`.scratch/c33-finalizer-risk-overview-probe.mjs` → query 200 + readPage 200（run-summary + 8 条 report-fact） | 通过 |

### 验收期修复

无。验收阶段未改动任何产品/测试代码；仅复跑命令与探针取证。

### D6 重签发的审计语义说明

`#readBodyAuthorized` 的每次正文读取经 `LocalIdentityAccessV1.authorize` 产生一条持久化签发行（`business.authorization_contexts`，`invocation_id` 为 `workflow-graph-read:body-read:<projectId>:<entityId>` 派生值，`branch=projection.query`，`invocation.kind="system"`，`reasonCode="projection-body-read"`，`causalRunRef` 指向当前运行），并经 `isAuthorizationSubset` 强制收窄自已复验的父上下文（越权即 `authorizationDenied`）。签发与复验使用同一导出派生函数，属 plan §保护清单认可的合法进程内配对模式；此审计开销是 design D6 用户裁决已接受的既有语义，不新增契约字段、不改 `readBody` 端口形状。

### 改动文件清单（归属本 change，对照 plan §6）

`packages/contracts/src/ports/index.ts`、`packages/adapters/src/workflow/postgres-workflow-projection.ts`、`packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts`、`apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts`、`demo/test/browser/server.mjs`、`demo/test/browser/identification-review.spec.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`、`packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。与 plan §6 清单一致，无计划外文件；无新依赖、无迁移（main 最大迁移序号复核仍为 `000053`）。

## 限定审计

**触发并已闭合**（plan §7 授权范围：Finalizer 专项核验「修复未放宽失败闭合」）。结论：**通过**——本 change 只让复验按已归档语义成功配对，未放宽任何可见性判断。证据（均为 2026-10-01 复跑的 `postgres-workflow-projection.test.ts` 14/14 内用例）：

- **无权同形失败**：`keeps unauthorized and cross-project reads indistinguishable from missing targets`——越权与跨工程读取与目标不存在不可区分（同形失败闭合）；
- **撤销/漂移同形失败**：`keeps revoked report reads indistinguishable from missing targets`——授权撤销后报告读取与目标不存在同形；
- **游标篡改闭合**：`rejects forged cursors, unknown query references and unsupported query types` 与 `rejects an unprovable graph subject and forged cursors on the new branches`——伪造游标稳定 `cursor-invalid`，不可证明主体失败闭合；
- **身份语义回归锁**：`never reverifies with a self-derived identity on the query/readPage paths`——复验身份恒为当前调用领域标识，自造派生身份不得复现；
- **D6 重签发不放宽**：签发经 `isAuthorizationSubset` 收窄校验，签发/读取失败一律按不可读收口（`catch → undefined →` 报告不可重建），不落入任何放宽分支。

无需再派 Targeted Auditor：审计范围已由 Finalizer 在本 Task 内以行为级测试证据闭合，符合「同一收尾轮次最多一次限定审计」约束。

## 后续注意事项

- 本 change 与 C33（`deliver-identification-and-review-ui`）的全部改动均未提交 Git（沿用既有裁决）；归档与提交动作待用户另行指示。
- C33 verification 已随本闭合更新为 PASS（三条原阻塞 Scenario 取得正向证据），原始 BLOCKED 记录保留为历史段落。
- `.scratch/` 下三个探针脚本为一次性取证脚本（非交付物），可供归档前复核复用。
