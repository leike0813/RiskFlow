# Implementation Plan: fix-projection-reverification-identity-seam

## 1. 实施基线与权威来源

- **Base commit**：`71465787d50e669ad7317fbb0b7e474130ad7b2c` + C33 未提交工作区改动（本 change 直接叠加在 C33 产物之上；C33 的 `identification-review.spec.ts` 三条断言翻正是本 change 的验收面）。
- **权威输入**：本 change 的 `proposal.md`、`design.md`（D1–D5）、`specs/domain/module-interfaces-events-workflows/spec.md` delta；根因证据见 `openspec/changes/deliver-identification-and-review-ui/verification.md` 结论段与 `.scratch/c33-finalizer-projection-repro.mjs`。
- **就绪判断**：无新迁移（实施第一步复核 main 最大迁移序号仍为 `000053`）；无新依赖。

## 2. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | delta「受保护读端口必须以当前调用的领域标识复验签发身份」Scenario 2/3 | `packages/contracts/src/ports/index.ts`：`ProjectionResultReadRequestV1Schema` +`queryId: IdentifierSchema`；`RiskRecordTraceReadRequestV1Schema` +`invocationId: IdentifierSchema` 与 `branch`（限 `ModuleBranchV1` 成员） | 纯加法字段；更新受影响类型导出 | 既有字段与结果形状 |
| IP-02 | 1.2 | delta Scenario 1/2/3 | `packages/adapters/src/workflow/postgres-workflow-projection.ts`：`query()` :320 复验改 `parsed.data.queryId`；`readPage()` :510 复验改请求新增 `queryId` 且 branch 改用 `projection.result-read`（不再由 capability 派生）；`#evidenceForSubject`/`#evidenceBatch` 按入口透传身份对 | 仅复验身份对取值变化 | 登记语义、分页、越界与同形失败 |
| IP-03 | 1.3 | delta Scenario 3 | `packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts`：`readBatch` 复验改请求 `invocationId`+`branch`（删除 `TRACE_READ_BRANCH_V1` 硬编码）；删除 `riskRecordTraceReadInvocationIdV1` | 移除无配对派生函数与硬编码 branch | readBatch 的有界与追溯字段形状 |
| IP-04 | 1.4 | delta Scenario 2 | `apps/api/src/http.ts`：`invokeProjectionResultRead` 透传 `query.queryId` | 一行透传 | 路由目录与信封 |
| IP-05 | 2.1 | 全部（回归锁） | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts`（stub verify 增 identity 断言、readPage 夹具补 queryId）；`packages/adapters/test/identification/postgres-risk-candidate-adapter.test.ts`（:165 伪 issuer 改按请求身份签发） | 测试锁定新身份语义 | 既有行为断言 |
| IP-06 | 2.2 | delta Scenario 1（端到端正向证据） | `demo/test/browser/server.mjs`：投影构造注入 `riskRecordTrace`；播种记录行补齐授权摘要匹配字段；链边/链运行播种时点不晚于查询登记时点；`demo/test/browser/identification-review.spec.ts` 断言翻正（关联图正向；证据追溯 1–5 号节点正向、6–8 号按 D7 缺席形态；运行记录链运行组正向，依赖 IP-08） | 失败闭合断言按 D7 范围翻正 | read-only.spec.ts 语义 |
| IP-07 | 2.3 | 全部 | 回归：C32 `read-only.spec.ts`、`.scratch/c33-finalizer-projection-repro.mjs` 复跑应 200 | — | — |
| IP-08 | 1.5 | delta Scenario 2（risk-overview/run-view 正向可达） | `packages/adapters/src/workflow/postgres-workflow-projection.ts`：`#readReportBody` 前按 D6 进程内重签发（`workflowGraphReadInvocationIdV1` body-read + 配套 branch，`issueReadAuthorization` 先例）；装配点（apps/api 与 demo harness）注入 authorize 能力 | 仅正文读取的授权来源 | readBody 端口形状与既有配对语义 |

## 3. 调用与副作用顺序

1. IP-01（契约字段）→ IP-02/03（适配器）→ IP-04（HTTP 透传）；每步 `pnpm typecheck`。
2. IP-05（适配器测试锁回归）→ IP-06（harness + 断言翻正）→ IP-07（回归与复现脚本复验）。
3. 失败处理：修复后正向路径首次真正执行，若暴露夹具缺口（授权摘要、链边播种）在 IP-06 内修；若暴露已归档语义的进一步缺陷 → 停手升级。

## 4. Schema、状态与持久化落实

- 两个请求 Schema 各加一个必填字段（strict 对象加法），SSOT 仍在 `packages/contracts/src/ports/index.ts`。
- 无状态机/持久化/迁移变化；无新 branch/能力位；`policy.ts` 不动。

## 5. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|
| delta 三 Scenario（单元） | IP-02/03/05 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts`、`packages/adapters/test/identification/` | stub verify 记录身份 == 当前调用 queryId/invocationId；无 `c30-*`/`c22-*` 自造身份 | `pnpm vitest run packages/adapters/test/workflow packages/adapters/test/identification` |
| HTTP 透传 | IP-04 | `apps/api/test/http-shell.test.ts`（扩展断言透传 queryId） | readPage 收到信封 queryId | `pnpm vitest run apps/api` |
| delta Scenario 1（端到端） | IP-06/07/08 | `demo/test/browser/identification-review.spec.ts` + `.scratch` 复现脚本 | 关联图/链运行组正向呈现；追溯链 1–5 号节点正向、6–8 号缺席形态；复现脚本 200 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` |
| 回归 | IP-07 | 全部既有测试 | 无红 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate fix-projection-reverification-identity-seam --strict --no-interactive` |

## 6. 文件清单与升级条件

**修改**：`packages/contracts/src/ports/index.ts`、`packages/adapters/src/workflow/postgres-workflow-projection.ts`、`packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts`、`apps/api/src/http.ts`、`demo/test/browser/server.mjs`、`demo/test/browser/identification-review.spec.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`、`packages/adapters/test/identification/postgres-risk-candidate-adapter.test.ts`、`apps/api/test/http-shell.test.ts`。

**保护（不得改）**：C06 绑定校验、C09 签发规则、投影登记与结果形状、`policy.ts`、已归档规格的既有 Requirement（仅新增澄清 delta）。

**升级条件**：修复后暴露进一步的已归档语义缺陷；需要迁移/依赖/计划外公共契约；工具链缺口。

## 7. 验收 Agent 授权与限定审计

- **授权验收范围**：§2 全部 IP-ID 与 §5 证据矩阵；Finalizer 可修复夹具与断言的普通缺陷。
- **保护语义边界**：授权与同形失败语义不变——本 change 只让复验按归档语义成功配对，不放宽任何可见性判断。
- **限定审计**：本 change 触及授权复验接缝，Finalizer 须在 verification 中专项核验"修复未放宽失败闭合"（无权/漂移仍同形失败的测试证据）。
