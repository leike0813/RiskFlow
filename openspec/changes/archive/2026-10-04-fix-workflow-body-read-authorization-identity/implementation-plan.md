# Implementation Plan: fix-workflow-body-read-authorization-identity

## 1. 实施基线与权威来源

- **Base commit**：`101882253580364fa37d27f44cf79d8dce2c1573`。
- **权威输入**：本 change 的 `proposal.md`、`design.md`（D1–D3）、`specs/domain/module-interfaces-events-workflows/spec.md` delta。
- **就绪判断**：无新迁移（实施第一步复核 main 最大迁移序号不变）；无新依赖；无新 branch/能力位。

## 2. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | delta Requirement 全部 | `packages/core/src/workflow/service.ts`：`WorkflowGraphBodyPortV1.readBody` 输入加法 `readonly invocationId: string` | 纯加法必填字段 | `putBody` 形状、返回类型 |
| IP-02 | 1.2 | delta Scenario 1/3 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts`：`readBody`（约 :1751）的 `verifyAuthorization` 由自派生改为使用 `input.invocationId`；删除该处 `body-read` 派生调用 | 身份来源改为调用方传入 | 复验其余校验、branch 绑定、`#openBody` 语义 |
| IP-03 | 1.3 | delta Scenario 1/2 | `packages/adapters/src/workflow/postgres-workflow-projection.ts`：`#readBodyAuthorized`（约 :1424）派生身份追加 `input.authorization.authorizationContextRef.reference.entityId`，并把同一身份串传入 `readBody` | 仅身份派生维度 | 授权 branch、system 调用、causalRunRef、收窄语义、失败收口 |
| IP-04 | 1.4 | delta Scenario 3 | `apps/worker/src/risk-flow/graph.ts`：`readBody` 调用点（约 :1495）显式传入 `workflowGraphInvocationIdV1({operation:"body-read", projectId, targetId: artifactRef.reference.entityId})` | 与原内部派生同值 | 调用语义与结果 |
| IP-05 | 2.1 | delta 全部 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts`：新增断言——同一工件连续两次 `readPage` 均返回条目；stub authorize 记录每次签发身份互不相同且与各自父上下文对应 | 测试锁回归 | 既有断言 |
| IP-06 | 2.2 | delta 全部 | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`apps/worker/test/risk-flow/runtime.test.ts`、`apps/worker/test/risk-flow/acceptance.test.ts`、`apps/worker/test/assessment/runtime.test.ts`、`packages/adapters/test/human-decision-feedback/fixture.ts`：补 `invocationId` 实参 | 编译适配 | 断言语义 |

## 3. 调用与副作用顺序

1. IP-01（端口加字段）→ IP-02/03/04（实现与调用方）；每步 `pnpm typecheck`。
2. IP-05（适配器回归断言）→ IP-06（测试夹具补参）。
3. 失败处理：修复后重复读取路径首次真正执行，若暴露夹具缺口在 IP-06 内修；若触及 C06/C09 语义或需要新迁移 → 停手升级。

## 4. Schema、状态与持久化落实

- `readBody` 输入加法一个必填字符串字段；SSOT 仍在 `packages/core/src/workflow/service.ts`。
- 无状态机/持久化/迁移变化；无新 branch/能力位；`policy.ts` 不动。

## 5. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|
| Scenario 1（同一授权重复读取） | IP-03/05 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 同一 `queryResultRef` 连续两次 `readPage` 均 `succeeded` 且条目一致 | `pnpm exec vitest run packages/adapters/test/workflow` |
| Scenario 2（不同授权互不冲突） | IP-03/05 | 同上 | 两次不同父上下文的 `readPage` 签发身份互不相同，均成功 | 同上 |
| Scenario 3（无缺省身份） | IP-02/04/06 | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` + worker 测试 | `readBody` 按传入身份复验；调用点显式传参 | `pnpm exec vitest run packages/adapters/test/workflow apps/worker/test/risk-flow apps/worker/test/assessment` |
| 端到端正向证据 | 下游 change | `deliver-assessment-warning-and-response-ui` 的 C31 分页/父子运行场景 | 风险态势总览「运行摘要」区正向呈现并可续页 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` |
| 回归 | 全部 | 既有全部测试 | 无红 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm --dir demo build && pnpm openspec:validate && openspec validate fix-workflow-body-read-authorization-identity --strict --no-interactive` |

## 6. 文件清单与升级条件

**修改**：`packages/core/src/workflow/service.ts`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts`、`packages/adapters/src/workflow/postgres-workflow-projection.ts`、`apps/worker/src/risk-flow/graph.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`apps/worker/test/risk-flow/runtime.test.ts`、`apps/worker/test/risk-flow/acceptance.test.ts`、`apps/worker/test/assessment/runtime.test.ts`、`packages/adapters/test/human-decision-feedback/fixture.ts`。

升级条件：需改 C06 `authorize` 重放比对项、需改 C05 一上下文一身份原则、需让 `readBody` 保留可选身份分支、需新增迁移/依赖/branch、需把身份改成不含授权上下文维度的其它方案。
