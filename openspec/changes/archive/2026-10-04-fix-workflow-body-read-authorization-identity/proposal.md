# Proposal: fix-workflow-body-read-authorization-identity

## Why

`fix-projection-reverification-identity-seam` 的 D6 裁决让 C31 投影适配器在读取运行正文前，用 `workflowGraphReadInvocationIdV1({operation:"body-read", projectId, targetId: artifactId})` 派生的固定调用身份重新 authorize 一条配对上下文。该派生身份只含 operation、工程与工件，**不含调用主体或授权上下文**；而 C06 归档语义规定 `invocationId` 即该次领域调用的身份，且 C05 规定「一个授权上下文只对应一个 invocation_id」。C06 `authorize` 对重复 `invocationId` 走重放路径，逐项比对已存上下文与本次请求的 `invocation`、`parent_context_id`、`causal_run_ref`、能力位与空间范围。投影侧每次读取的 `parentContext` 都是本次读取自己复验出来的新上下文（`#verify` 以本次 `queryId` 复验，引用必然不同），因此从**第二次正文读取起**比对必然失配，抛出 `IDEMPOTENCY_CONFLICT`；该异常被 `#readBodyAuthorized` 的 `catch` 吞成 `undefined`，`#reportRunEntries` 随即以 `risk-overview-incomplete` 收口，HTTP 层映射为 422 `BUSINESS_BLOCKED`。

结果是 `projection.result-read` 在同一进程内**只有第一次成功**：风险态势总览页的「运行摘要（原投影追溯）」区在正常使用中直接呈现「内容加载失败（BUSINESS_BLOCKED）」，用户驱动的续页同样失败。`/review/runs` 因只发起一次读取而侥幸正常，掩盖了该缺陷。

实测证据（`demo/test/browser` 真实 PostgreSQL + 生产 demo build）：

- 两次逐字节相同的 `projection.result-read` 请求（仅 `queryId` 与 `requestedAt` 不同）：第一次 200，返回 8 条并带 `nextCursor`；第二次 422 `BUSINESS_BLOCKED`。
- 随后用**全新** `projection.query` 登记与**全新** `queryResultRef` 再读三次：全部 422。可排除「登记身份冲突」，确认是**按工件固定的身份**在第二次起必然冲突。
- 对照：`/review/runs` 链路只读一次，该页链运行组断言仍通过。

本 change 直接阻塞 `deliver-assessment-warning-and-response-ui` 的 IP-12 task 4.2 场景「C31 分页 / 父子运行 / 原投影引用按页追溯」。

## What Changes

- **正文读取的调用身份纳入授权上下文**：投影正文重签发使用的派生身份追加当前父授权上下文引用（`c30-body-read:<projectId>:<artifactId>:<parentContextRef>`）。同一授权上下文下的重复读取走 C06 重放路径返回既有上下文（不重复签发），不同授权上下文各自获得独立身份，不再互相冲突。
- **`readBody` 接受调用方给出的调用身份**：`WorkflowGraphArtifactBodiesPortV1.readBody` 增加必填 `invocationId`，由调用方按同一导出派生函数给出；`postgres-workflow-adapter` 不再自行派生正文读取身份。签发方与复验方仍共用同一导出函数，满足既有 spec 对「进程内配对」的口径。
- **规格澄清 delta**（`domain/module-interfaces-events-workflows`）：把「进程内配对的派生身份必须纳入调用主体/授权上下文维度，且同一工件必须可被重复读取」写成显式 Requirement 与 Scenario，锁死本类缺陷不再复现。
- **验收补验**：`packages/adapters/test/workflow` 增加「同一工件连续两次读取均成功、且不同授权上下文互不冲突」的回归断言；`deliver-assessment-warning-and-response-ui` 的 C31 分页与父子运行场景在修复后由其自身 spec 承接。
- 不改 C06 绑定校验、不改 C09 签发规则、不改 C05 一上下文一身份原则、不改投影登记与分页语义；无新迁移、无新依赖。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 新增澄清 Requirement——进程内配对的派生调用身份必须纳入调用主体或授权上下文维度，且同一工件在同一授权下可被重复读取；不同授权上下文不得共用同一派生身份。

## Impact

- **代码**：`packages/adapters/src/workflow/postgres-workflow-projection.ts`（`#readBodyAuthorized` 身份派生与透传）、`packages/adapters/src/workflow/postgres-workflow-adapter.ts`（`readBody` 端口与实现改为接受调用方身份）、`apps/worker/src/risk-flow/graph.ts`（唯一另一个生产调用方按同一导出派生身份传入）、相关适配器测试。
- **契约**：`readBody` 端口请求加法一个必填 `invocationId` 字段；无结果形状变化，无 HTTP 形状变化。
- **权限语义**：`system` 调用的 `authorize` 在 C06 中强制要求 `parentContext` 与 `causalRunRef`，因此**不能**用「去掉父上下文」的方式绕开冲突；收窄语义保持「自当前已复验上下文收窄」，只改变身份的维度构成。
- **依赖/迁移**：无。
- **范围外（Non-goals）**：C06 绑定校验与重放规则本身；C09 签发规则；C05 一上下文一身份原则；投影查询登记与分页语义；C22 窄读身份。
