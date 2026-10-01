# Design: fix-projection-reverification-identity-seam

## Context

- 发现于 C33 收尾：`openspec/changes/deliver-identification-and-review-ui/verification.md` 结论段记录了完整根因链与最小复现（`.scratch/c33-finalizer-projection-repro.mjs`：真实 harness + 已播种链边，`projection.query` 稳定 404 `c30-projection-unavailable`）。
- 根因：`packages/adapters/src/workflow/postgres-workflow-projection.ts` 的 `query()`（:320）与 `readPage()`（:510）复验时使用实现期自造的派生身份 `c30-query:<projectId>:<queryId>` / `c30-read-page:<projectId>:<queryResultId>`，全仓无任何生产签发方配对；C06 归档语义（`invocationId` = 该次调用的 commandId/queryId，见 `2026-09-04-deliver-local-identity-and-project-authorization/design.md`）与 C32 归档接缝规则（HTTP 以领域 queryId 签发）都在 HTTP 一侧。规格对复验身份取值留白，实现填错——本 change 使实现符合已归档语义，不改规格语义本身（仅加澄清 Requirement）。
- 同类缺陷：`packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts:73-78/:142` 的 `riskRecordTraceReadInvocationIdV1`（`c22-risk-record-trace:...`）同样无生产签发方，投影 `#evidenceBatch` 把 HTTP 签发的上下文传给它会第二次恒失败闭合。
- 对照组（经 HTTP 正常工作的只读端口）全部以纯 `query.queryId` 复验；同模块 C41 证明端口（`postgres-workflow-adapter.ts:843/:982`）亦以纯 queryId 复验并有注释说明配对规则。
- 进程内配对派生身份（如 `workflowGraphReadInvocationIdV1`，签发方与复验方用同一导出函数并经 `issueReadAuthorization` 重新 authorize）是合法模式，不在本修复范围。

## Goals / Non-Goals

**Goals:**

- 投影 `query()`/`readPage()` 与 C22 `readBatch` 的复验身份与签发方配对，真实 HTTP 接缝上投影正向路径可达。
- 契约加法：`ProjectionResultReadRequestV1` 与 `RiskRecordTraceReadRequestV1` 各新增调用身份字段。
- demo harness 注入真实 `riskRecordTrace` 并补齐授权摘要匹配的播种；C33 三条失败闭合断言翻正；C32 回归保持。
- spec 澄清 Requirement 防复发。

**Non-Goals:**

- C06 绑定校验（`postgres-local-identity-access.ts`）与 C09 签发规则不变。
- 投影查询登记语义、结果形状、有界上限与越界闭合不变。
- C32 界面的其它行为；进程内合法派生身份配对模式。

## Decisions

### D1: 修法选型——端口改用签发身份

采用候选 (a)：端口复验身份改为当前调用的领域标识。否决 (b)（HTTP 按 branch 派生签发）：传输层硬编码适配器私有约定，且违反 C32 已归档的"以领域 commandId/queryId 签发"规则，属改语义而非修 drift。

### D2: 投影适配器修复

- `query()`：`invocationId` 改用 `parsed.data.queryId`。
- `readPage()`：`ProjectionResultReadRequestV1Schema` 加法新增 `queryId: IdentifierSchema`（strict 对象加必填字段；唯一生产调用方是 HTTP invoker，进程内测试同步更新）；复验改用该字段。HTTP invoker `invokeProjectionResultRead` 透传信封上的 `query.queryId`。原 `queryId` 已编入 `queryResultId` 属上一次调用身份，不可复用（C06"相同 invocation 可重复验证"指同一次调用）。
- `#evidenceBatch` 调 `trace.readBatch` 时透传当前调用身份。
- **复验 branch 配对（实施期发现的同一线缝第二层）**：C06 `verify` 精确绑定 branch，HTTP 按路由 branch 签发；适配器不得由 capability 反推 branch（capability→branch 是一对多）。各方法复验 MUST 使用当前调用入口的路由 branch：`query()` → `projection.query`，`readPage()` → `projection.result-read`。嵌套 `trace.readBatch` 的复验 branch 由外层入口透传（见 D3）。C31 归档 D-04"复验 projection.query 分支"的表述按 C06/C09 归档语义解释为"复验签发该上下文的路由分支"，本条是对该留白的实现修正，不改已归档 Requirement。

### D3: C22 窄读修复

- `RiskRecordTraceReadRequestV1Schema` 加法新增 `invocationId: IdentifierSchema` 与 `branch`（取值限既有 `ModuleBranchV1` 成员）两个必填字段；`readBatch` 复验改用请求携带的 `invocationId` + `branch`（即外层调用的签发身份对）。生产调用方仅投影适配器：`#evidenceForSubject` 传 `projection.query` 侧身份对，`#evidenceBatch` 传 `projection.result-read` 侧身份对。
- 删除 `riskRecordTraceReadInvocationIdV1`（无生产配对）；其单测的伪 issuer 改为按请求身份对签发。

### D4: 验收补验

- `demo/test/browser/server.mjs`：`createPostgresWorkflowProjection` 注入真实 `riskRecordTrace: createPostgresRiskRecordTraceReader({ db, ... })`；播种的 `standardized_risk_records` 行补齐与 `authorization_scope_digest` 匹配的字段，使记录主体可证明。
- `demo/test/browser/identification-review.spec.ts` 三条断言翻正：关联图带主体正向呈现链边；证据追溯沿链穿透；运行记录页链运行组正向呈现。
- `demo/test/browser/read-only.spec.ts:164-169` viewer 追溯用例为双态容忍正则，修复后预期走"暂无关联对象"分支，重跑确认不改写。
- `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` 的 stub verify 增加 identity 断言锁回归。
- 一次性复现脚本 `.scratch/c33-finalizer-projection-repro.mjs` 修复后应返回 200，作为人工复验证据。

### D5: 依赖与迁移

无新依赖、无迁移。既有投影登记行与授权上下文语义不变；修复只让此前必然失败的复验按归档语义执行。

### D6: readBody 正文读取的进程内重签发（用户裁决，2026-10-01）

risk-overview/run-view 的 `readPage` 在复验通过后需读运行正文，而 `bodies.readBody` 按合法进程内配对模式以 `workflowGraphReadInvocationIdV1({operation:"body-read",...})` 派生身份复验——HTTP 签发的上下文不配对该身份。裁决修法：投影适配器沿用质量评估模块（`postgres-quality-evaluation.ts` 的 `issueReadAuthorization` 先例）的既有进程内模式——为正文读取用同一导出派生函数与配套 branch **重新 authorize** 签发配对上下文，再以该上下文调 `readBody`。不新增契约字段、不改 `readBody` 端口；代价是每次正文读取产生一条配对授权签发与审计记录（属该模式的既有语义）。适配器装配如需注入 authorize 能力的 access 端口，在 apps/api/worker 装配点补齐。

### D7: trace-chain 相邻边语义维持，追溯页翻正限定到评估环节（用户裁决，2026-10-01）

C31 归档实现的 trace-chain 只返回主体相邻边（以记录为主体时仅到风险评估一条边），不沿链扩展；该语义不变。C33 证据追溯页在 trace-chain 数据源下：1–5 号节点（资料段→工序→机理→记录→评估记录）为正向呈现断言范围；6–8 号节点（预警/处置/偏差校准）按 C33 spec「链尾缺席按投影缺席事实如实呈现」断言缺席形态。`deliver-identification-and-review-ui` 的 spec 文本无需修订（其「沿链穿透到详情」Scenario 以记录→机理条目穿透为核心，已覆盖）。

## Risks / Trade-offs

- **契约 strict 对象加必填字段**：`ProjectionResultReadRequestV1`/`RiskRecordTraceReadRequestV1` 的既有构造方（HTTP invoker、投影内部、测试）必须同步，漏改即编译/契约失败——typecheck 与既有测试可完全覆盖。
- **修复暴露下游缺口**：身份修好后正向路径首次真正执行，可能暴露夹具或分页的其它问题；以真实浏览器验收与适配器测试为准，不预断。

## Migration Plan

无迁移。

## Open Questions

无。
