# Design: fix-workflow-body-read-authorization-identity

## Context

`fix-projection-reverification-identity-seam` 的 D6 让 C31 投影在读取运行正文前用固定派生身份重新 authorize 配对上下文。根因是该派生身份（`workflowGraphInvocationIdV1`，见 `packages/core/src/workflow/service.ts:140`）只拼接 `operation:projectId:targetId`，不含调用主体或授权上下文；而 C06 `authorize` 对重复 `invocationId` 走重放路径并逐项比对 `invocation`、`parent_context_id`、`causal_run_ref`、能力位与空间范围。投影侧父上下文每次都不同，于是第二次起必然 `IDEMPOTENCY_CONFLICT`。

## Goals / Non-Goals

**Goals**

- 同一授权上下文下，同一运行正文可被重复读取。
- 不同授权上下文（含不同主体）读取同一工件时互不冲突，且各自受自己的可见性范围约束。
- 签发方与复验方继续共用同一导出函数，保持既有 spec 对「进程内配对」的口径。

**Non-Goals**

- 不改 C06 的重放比对规则本身，也不放宽任何比对项。
- 不改 C05「一个授权上下文只对应一个 `invocation_id`」。
- 不改投影登记、分页、越界与同形失败语义。

## Decisions

### D1: 正文读取的派生身份追加父授权上下文引用

投影 `#readBodyAuthorized` 的签发身份改为 `c30-body-read:<projectId>:<artifactId>:<parentAuthorizationContextRef>`。

- **为什么不是「去掉父上下文」**：`system` 调用的 `authorize` 在 C06 中硬性要求 `parentContext` 与 `causalRunRef` 同时存在，缺失即 `ACCESS_CONTRACT_INVALID`；因此不能用无父签发绕开。
- **为什么不是「缓存已签发上下文」**：缓存键若只含工件，则第二个主体读取同一工件时仍与首个主体的已存上下文冲突，跨主体读取依旧失败；缓存只会把「每工件一次」变成「每工件每主体一次」但仍限一次。
- **为什么这样就闭合**：C06 重放比对里 `parent_context_id` 正是随父上下文变化的项。把它并入身份后，每次读取得到的是与本次父上下文一一对应的新身份，走独立签发路径，不再与任何其它读取争抢同一个 `invocation_id`。父上下文若真的重复（同一次已复验结果被复用），身份也随之重复并命中 C06 重放路径返回既有上下文——这正是 C05「一个上下文一个身份」要求的对称形态。既维持该原则，也不再让不同上下文互相冲突。

代价是每次正文读取签发一条上下文与一条安全审计（父上下文每次不同，无法命中重放复用）。这与 D6 已声明并接受的代价一致，不新增语义。

### D2: `readBody` 接受调用方给出的调用身份

`WorkflowGraphArtifactBodiesPortV1.readBody` 增加必填 `invocationId`，`postgres-workflow-adapter` 不再自行派生正文读取身份；其 `verifyAuthorization` 继续按该身份复验。

- 签发方（投影）与复验方（`readBody`）共用同一导出函数，D1 的身份串同时出现在两处，配对关系不变。
- `apps/worker/src/risk-flow/graph.ts` 是另一个生产调用方，按同一导出函数派生自己的正文读取身份传入；其现有行为不变（原先由 `readBody` 内部派生，值相同）。
- 不引入可选参数：可选会让「忘记传身份」退回到内部固定派生，正好复现本缺陷。

### D3: 不改 C06，也不放宽重放比对

不改 `postgres-local-identity-access.ts`。缺陷在派生身份的维度构成，不在 C06 的比对规则；放宽比对会让「同一身份、不同父上下文」静默通过，属于真正的权限削弱。

## Risks / Trade-offs

- **授权签发量上升**：父上下文每次读取都不同，因此重复读取不再走重放复用，而是每次签发一条正文读取上下文与一条安全审计。这与 D6 已声明并接受的代价一致（「每次正文读取产生一条配对授权签发与审计记录」），不新增语义。
- **端口契约加法**：`readBody` 加必填字段是 strict 对象加法，所有构造方（生产两处 + 测试夹具）必须同步；`pnpm typecheck` 与既有测试可完全覆盖。
- **风险标签 `permission`**：改动位于授权身份派生路径。限定审计须确认：不同主体不再共用身份（无越权）、收窄语义未放宽（`requestedSpatialScopeRefs` 仍自父上下文收窄）、`verify` 的 branch 绑定未变。

## Migration Plan

无迁移。行为变化对调用方透明（HTTP 形状、结果形状、目录均不变）。

## Open Questions

无。若限定审计判定「每次读取签发一条上下文」的审计量不可接受，可在后续 change 引入按 (工件, 父上下文) 的进程内复用；本 change 不预埋该复杂度。
