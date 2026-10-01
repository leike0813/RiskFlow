# Proposal: fix-projection-reverification-identity-seam

## Why

C30/C31 交付的投影适配器在 `query()`/`readPage()` 复验授权时使用实现期自造的派生身份（`c30-query:<projectId>:<queryId>`、`c30-read-page:<projectId>:<queryResultId>`），而 C06 归档语义规定 `invocationId` 即该次领域调用的 `commandId`/`queryId`，C32 归档规则进一步明确 HTTP 外壳以领域 `queryId` 签发。两者恒不匹配，导致投影端口经 HTTP 调用时在任何数据可见性判断之前失败闭合为 404——投影查询自 C31/C32 归档起从未在真实 HTTP 接缝上成功过，C33 的三条正向投影 Scenario 因此被阻塞。同模块的 C22 风险记录窄读（`riskRecordTraceReadInvocationIdV1`）存在相同的无签发方派生身份缺陷，是投影正向路径上的第二次闭合点。

## What Changes

- **修复投影适配器复验身份**：`query()` 以当前调用的领域 `queryId` 复验；`readPage()` 经 `ProjectionResultReadRequestV1` 加法新增的身份字段（HTTP invoker 透传当前 `projection.result-read` 查询的 `queryId`）复验。
- **修复 C22 窄读复验身份**：`RiskRecordTraceReadRequestV1` 加法新增调用身份字段，投影适配器透传当前调用身份；删除无生产配对的 `riskRecordTraceReadInvocationIdV1` 派生函数。
- **规格澄清 delta**（`domain/module-interfaces-events-workflows`）：把"受保护读端口以当前调用的领域 queryId 复验签发身份"这一 C06/C32 既有规则写成显式 Requirement，防止再次自造派生身份。
- **验收补验**：demo 浏览器 harness 注入真实 `riskRecordTrace` 端口并补齐授权摘要匹配的播种；C33 `identification-review.spec.ts` 三条失败闭合断言翻正为正向呈现断言；重跑 C32 `read-only.spec.ts` 回归。
- 不改 C06 绑定校验、不改 C09 签发规则、不改既有端口外部语义；无新迁移、无新依赖。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 新增澄清 Requirement——投影与窄读端口的授权复验 MUST 使用当前调用的领域调用标识（queryId），不得使用无配对签发方的派生身份。

## Impact

- **代码**：`packages/adapters/src/workflow/postgres-workflow-projection.ts`（两处复验身份 + 透传）、`packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts`（复验身份、删除派生函数）、`packages/contracts/src/ports/index.ts`（两个请求 Schema 各加法一个字段）、`apps/api/src/http.ts`（invoker 透传）、`demo/test/browser/server.mjs`（注入 riskRecordTrace + 夹具补齐）、`demo/test/browser/identification-review.spec.ts`（三条断言翻正）、相关适配器测试。
- **API**：无 HTTP 形状变化（`ProjectionResultReadQueryV1` 的 `queryId` 本就在信封上）；端口级请求 Schema 加法字段，唯一生产调用方是 HTTP invoker。
- **依赖/迁移**：无。
- **范围外（Non-goals）**：C06 绑定校验语义；C09 签发规则；投影查询登记语义与结果形状；C32 其它界面行为。
