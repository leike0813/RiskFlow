## Context

见 [proposal.md](proposal.md) 的动因。基线提交为 `00eaf6c538b75cb4b87535c48dcdab12cc673321`，实际 schema 为 `spec-driven`。

当前 `WarningResponsePortV1` 只有 `open`、`recommend`、`record` 三个用例级方法。`OpenWarningCommandV1Schema` 的 `open` 分支从已入库评估记录产生 `warningRecordRefs`、`warningResponseTaskRefs` 和 `notificationIntentRefs`；`WarningResponseRecordCommandV1Schema` 随后只覆盖建议采纳、执行、反馈、偏差和校准，没有“已读接管”。`DomainEventV1Schema` 同样没有确认事件。C09 的 `HTTP_ROUTE_CATALOG_V1` 通过 `commandRoutes(...)` 静态登记每个公共 branch，`activeHttpRouteCatalog` 与 `httpCatalogForOpenApi` 再从同一条目集合驱动运行时和文档，因此新增 C02 branch 后必须同步这一个登记点。

C26 change 目录已存在但仅有 `.openspec.yaml`，没有可复用的 proposal/spec/design/implementation-plan/tasks 工件；本设计只能承诺其恢复规划时可调用的公共 interface，不替 C26 决定任务表、持久化表或通知实现。C07/C09 的归档设计和当前代码一致：领域写命令复用公共命令/错误/事件信封，HTTP 只做 strict 传输校验、服务端授权组装与唯一 port 分派。

## Goals / Non-Goals

**Goals:**

- 以最小增量在现有预警处置深模块中补齐确认 interface，使 C26/C34 无需自建旁路。
- 固定确认命令、结果、事件、权限、错误、幂等、并发和审计语义，避免实现 Agent 自行发明公共字段。
- 维持 C09 单一 route catalog、单一 port 分派和运行时/OpenAPI 同源。
- 让既有消费者保持兼容；新增分支以 strict Schema 和定向行为测试形成可运行证据。

**Non-Goals:**

- 不实现确认事实、任务归集、通知投递、投影、C34 页面或真实 `WarningResponsePortV1` adapter；这些属于 C26/C34。
- 不改变预警、风险评估、任务、通知意图或处置记录的正文 Schema，不修改 P/C、矩阵、阈值或触发逻辑。
- 不增加新 port 方法、确认专用顶层 Schema、HTTP handler、客户端 SDK、依赖、迁移或配置。
- 不修改既有命令/结果字段、权限角色清单、`apps/api/src/app.ts`、Web、Worker、核心/适配器、根 workspace、锁文件、依赖政策、迁移注册和主 specs 正文。

## Decisions

### D-01：确认是既有 `record` interface 的闭合分支

在 `packages/contracts/src/ports/index.ts` 做三处加法：

1. `MODULE_BRANCH_CAPABILITY_V1` 增加 `"warning-response.acknowledge": "warning-response.record"`。
2. `WarningResponseRecordCommandV1Schema` 增加：

   ```ts
   commandSchema(
     "acknowledge",
     z.strictObject({
       warningRecordRef: WarningRecordRefV1Schema,
       warningResponseTaskRef: WarningResponseTaskRefV1Schema,
     }),
     branchCapability("warning-response.acknowledge"),
   )
   ```

3. `WarningResponseRecordSuccessV1Schema` 增加：

   ```ts
   z.strictObject({
     kind: z.literal("acknowledgement"),
     status: z.literal("acknowledged"),
     warningRecordRef: WarningRecordRefV1Schema,
     warningResponseTaskRef: WarningResponseTaskRefV1Schema,
   })
   ```

`WarningResponseRecordResultV1Schema` 已包装整个 success union，无需新增结果顶层；`WarningResponsePortV1.record()` 的签名也无需改变。命令信封已提供 `commandId`、`idempotencyKey`、`projectId`、`actorId`、`issuedAt` 和 `authorization`，payload 不重复这些字段。

备选是在 `WarningResponsePortV1` 增加 `acknowledge()`，或新建 `WarningAcknowledgementPortV1`。两者只会复制现有授权、幂等、错误与 HTTP 分派接缝；确认与其它只追加处置决定具有同一事务和 capability，继续放在 `record` 的 leverage 更高、调用面更小。

### D-02：确认状态不复用通知或处置状态

`kind="acknowledgement"` 标识结果分支，`status="acknowledged"` 是 C26/C34 可稳定消费的唯一确认状态。本 change 不预建 `unacknowledged`、`reopened`、`transferred`、`resolved` 或 `closed` 分支；后续若出现真实转派/撤回需求，另走契约演进。

命令必须同时给出预警与任务精确引用，以便所属模块验证“该任务精确版本归集该预警精确版本”。一次任务可归集多个预警时，每个预警/任务配对分别确认，不能用任务引用批量推断全部预警已读。成功结果回显被确认的同一精确引用配对，不返回正文、操作者、时间、风险状态、审计或通知状态。

`NotificationIntentRefV1` 不进入确认 payload/result/event。通知意图只表示投递计划或投递状态；把它作为确认前提会把“送达”误当作“已读”，也会阻止管理员从非通知入口接管。`OpenWarningCommandV1Schema` 与 `OpenWarningSuccessV1Schema` 因此保持原样。

确认是只追加决定：它不修改预警信息或风险评估记录，不关闭处置任务，也不产生 `adoption`、`execution`、`feedback`、`deviation`、`unavailable` 或 `calibration` 结果。既有 record 分支字段和行为均不改变。

### D-03：沿用 `warning-response.record` 能力，并先授权后解析目标存在性

新 branch 映射到已有 `warning-response.record` capability。`commandSchema` 继续校验命令工程/操作者与 `AuthorizationContextV1` 一致且能力已授予；C09 先从 Cookie、路径工程、branch 和请求中的获准范围调用 C06 `authorize`，再由 port 在任何目标读取或副作用前复验。客户端只能提交已有 HTTP v1 信封和两个引用 payload，不能提交 `actorId`、`projectId`、`authorization` 或 capability。

C06 的 `project-risk-manager` 通过现有动态 all-branches 规则取得新 branch；`field-responder` 等显式角色清单不自动取得确认能力。本 change 不修改角色政策。

领域实现的拒绝顺序固定为：strict Schema → 授权复验 → 在获准工程/空间内联合核对预警与任务精确引用及关联 → 当前可确认状态 → 写入。无权、跨工程/空间、目标不存在或无权获知关联关系，对外使用与不存在不可区分的安全拒绝；只有已获权且目标可见的调用方才可收到 `STALE_VERSION` 或 `BUSINESS_BLOCKED`。错误仍使用 `ModuleErrorV1Schema`，不新增错误码或自由详情。

### D-04：业务幂等键与精确任务版本收口重放和竞争

继续使用 C02/C03 的 `(projectId, command kind, idempotencyKey)` 收据边界，并把 strict payload 纳入既有有效载荷摘要：

- 同键、同 `acknowledge` kind、同引用 payload 返回首次逻辑结果，不重复确认、审计或事件。
- 同键异载荷返回 `IDEMPOTENCY_CONFLICT`，不覆盖首次命令。
- 多个不同命令竞争同一未确认配对时，只允许一个建立确认；若任务精确版本已变化，返回 `STALE_VERSION`，若同一可见配对已被其它命令确认，返回 `BUSINESS_BLOCKED`。不得改写首次操作者或审计。

这是 C26 实现的事务验收约束，不要求本 change 增加收据表、锁、缓存或迁移。

### D-05：确认事件是投影所需的最小事务引用事件

在 `packages/contracts/src/events/index.ts` 的 `DomainEventV1Schema` 增加：

```ts
eventSchema(
  "warning.warning-acknowledged.v1",
  z.strictObject({
    warningRecordRef: WarningRecordRefV1Schema,
    warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  }),
)
```

该事件分支继续链式使用 `.superRefine(...)`，直接比较 `aggregateRef` 与 `payload.warningResponseTaskRef` 的 kind、entityId 和 versionId；不为一次比较增加公共 helper。该事件让 C26 的可靠事实可被 C34/投影观察，而无需轮询或复制任务正文。事件 `aggregateRef` 必须等于成功结果中的 `warningResponseTaskRef`，payload 两个引用必须与成功结果相同；操作者、授权、命令、幂等和审计只使用既有事件 metadata。C26 后续实现必须把确认事实、审计和 Outbox 事件放在同一事务，发布失败不得伪装成功。

不新增 `WarningAcknowledgementRefV1Schema`：当前调用方只需要确认状态和目标配对，引入独立实体引用会预先决定 C26 的存储模型。通用 Outbox/持久化消费者通过 `DomainEventV1Schema` 处理闭合事件且当前无 warning event 的穷举 switch；contracts 定向测试和全仓 typecheck 负责防止遗漏消费者。

### D-06：C09 只增加现有 `commandRoutes(...)` 的一个映射项

在 `apps/api/src/http.ts` 的 `HTTP_ROUTE_CATALOG_V1` 中，定位绑定 `WarningResponseRecordCommandV1Schema`、`WarningResponseRecordResultV1Schema`、`"warningResponse"`、`invokeWarningRecord` 的现有 `commandRoutes(...)`，在其 branch/domain-kind 数组加入：

```ts
["warning-response.acknowledge", "acknowledge"]
```

由现有 `payloadSchemaFor` 提取 strict payload，由 `commandTransportSchemaFor` 组装 v1 传输 Schema，由 `route` 生成固定路径和 capability，由 `invokeWarningRecord` 调用 `WarningResponsePortV1.record()`。`activeHttpRouteCatalog` 继续只在注入 `warningResponse` port 时激活该 route，`httpCatalogForOpenApi` 继续从相同活动集合派生文档；`apps/api/src/app.ts` 的通用注册无需修改。

新增专用 handler、另一张 route 表或另一个 path 会让授权、结果校验和 OpenAPI 漂移，因此不采用。

### D-07：测试只覆盖新增稳定行为

在 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 扩展现有表驱动用例：

- 将新 branch/capability 纳入闭合集合，证明命令信封的授权与幂等字段仍必需。
- 解析合法 `acknowledge` 命令与 `acknowledgement` 成功结果；拒绝缺失任一引用、错误引用 kind、未知字段、风险解除/任务关闭字段及越权能力。
- 解析 `warning.warning-acknowledged.v1`，并拒绝正文、通知意图或其它额外 payload；校验 `aggregateRef` 与任务引用一致。
- 保留并继续运行既有 open、adoption、execution、feedback、deviation、unavailable、calibration 和事件分支用例。

在 `apps/api/test/http-shell.test.ts` 增加一个定向 Fastify inject 用例，注入最小 `WarningResponsePortV1` 替身：调用确认路径，断言授权 branch、服务端拥有的工程/actor/authorization、原命令身份与两个精确引用只传给 `record()` 一次，并验证响应、catalog 和生成 OpenAPI 含同一路径。另用该用例的非法 payload 变体证明伪造字段在授权/port 前被拒绝。无需为文案、字段顺序或完整 OpenAPI snapshot 增加测试。

### D-08：文件所有权与实现范围固定

| 动作 | 文件 | 允许变化 |
| --- | --- | --- |
| 修改 | `packages/contracts/src/ports/index.ts` | branch-capability、record command、record success 三个联合分支 |
| 修改 | `packages/contracts/src/events/index.ts` | 一个确认事件分支及所需既有引用导入复用 |
| 修改 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 新分支/结果/事件及 strict 回归证据 |
| 修改 | `apps/api/src/http.ts` | `HTTP_ROUTE_CATALOG_V1` 的一个 branch/domain-kind 映射项 |
| 修改 | `apps/api/test/http-shell.test.ts` | 确认 route 唯一分派、授权、响应与 OpenAPI 定向测试 |

不新增或删除生产/测试文件。change delta 与四工件位于本 change 目录。若任一现有符号不存在、需要 `apps/api/src/app.ts` 或上述五个代码文件以外的生产修改、角色政策编辑、新依赖或迁移，实施 Agent 必须停止并升级。

### D-09：C26 恢复规划时使用的确切 interface

C26/C34 的 HTTP 调用固定为：

```http
POST /api/v1/projects/{projectId}/commands/warning-response.acknowledge
Cookie: __Host-riskflow_session=<opaque>
Content-Type: application/json
```

```json
{
  "schemaVersion": "1",
  "commandId": "<non-empty-id>",
  "idempotencyKey": "<non-empty-business-key>",
  "issuedAt": "<ISO-8601>",
  "requestedSpatialScopeRefs": [
    {
      "kind": "spatial-scope",
      "reference": { "entityId": "<scope-id>", "versionId": "<scope-version>" }
    }
  ],
  "requestedSourceVersionRefs": [],
  "payload": {
    "warningRecordRef": {
      "kind": "warning-record",
      "reference": { "entityId": "<warning-id>", "versionId": "<warning-version>" }
    },
    "warningResponseTaskRef": {
      "kind": "warning-response-task",
      "reference": { "entityId": "<task-id>", "versionId": "<task-version>" }
    }
  }
}
```

服务端组装后的领域命令为同一信封加 `projectId`、`actorId`、`kind: "acknowledge"` 和 `authorization`。成功结果固定为：

```json
{
  "kind": "succeeded",
  "result": {
    "kind": "acknowledgement",
    "status": "acknowledged",
    "warningRecordRef": {
      "kind": "warning-record",
      "reference": { "entityId": "<warning-id>", "versionId": "<warning-version>" }
    },
    "warningResponseTaskRef": {
      "kind": "warning-response-task",
      "reference": { "entityId": "<task-id>", "versionId": "<task-version>" }
    }
  }
}
```

失败沿用 `WarningResponseRecordResultV1Schema` 的 `failed { error: ModuleErrorV1 }`。C26 可以实现确认事实和上述事件生产，C34 可以调用 route 并刷新展示；二者不能增加第二套 acknowledge DTO/path，也不能从 `notificationIntentRef`、送达状态或确认结果推导风险解除。

### D-10：无依赖、无迁移，按加法契约部署

先发布 contracts 新联合分支及 C09 route 登记，再由 C26 实现并注入真实 `warningResponse` port；未注入 port 时 `activeHttpRouteCatalog` 不注册该路由。没有数据库结构或存量数据变化，不申请 `000048` 号段，不运行 migration provider/runner，也不修改中央迁移注册与测试清单。

回滚只在 C26/C34 尚未依赖新分支时删除该 branch/result/event 与 route 映射。已有消费者开始生产或保存确认事件后，必须协调降级，不能让旧 `DomainEventV1Schema` 读取新事件；本 change 本身不执行归档、发布或数据回滚。

既有 C09 低基数访问日志继续记录 route、commandId、projectId、结果类别、状态和耗时，不记录 payload；确认操作者、授权和决定证据进入 C26 的耐久审计与事件 metadata，不新增日志字段或指标体系。

## Risks / Trade-offs

- [新增 `DomainEventV1` 分支可能使隐藏的穷举消费者编译失败] → 当前 CodeGraph 未发现 warning event 穷举分派；运行全仓 `pnpm typecheck` 和定向测试，出现范围外消费者时停止并升级，不在本 change 顺手修改。
- [两个精确引用仍需 C26 证明真实关联] → public interface 固定双引用和拒绝顺序，C26 在同一授权/事务范围内联合校验，不让 HTTP 或调用方推断关联。
- [不同幂等键重复确认需要持久化唯一性] → 规格固定单一成功和冲突语义，但表、约束和事务实现留给 C26；本 change 不预建迁移。
- [加法联合会要求严格消费者认识新 kind] → C26/C34 只能在 contracts/C09 部署后启用调用；回滚按 D-10 协调，不伪造兼容 fallback。
- [确认事件增加一类投影输入] → payload 仅两个精确引用，复用既有 Outbox 与投影边界，不复制任务/预警正文。

## Migration Plan

1. 实现并验证 D-01～D-08 的 contracts 与 C09 加法改动；不执行迁移。
2. 主调度 Agent 形成契约 checkpoint 后，C26 重新读取本 change 的已批准 interface，规划确认事实、审计、唯一性和事件原子提交。
3. C26 可用后再由 C34 消费同一 HTTP route/result；不得提前建立页面私有入口。
4. 若实现前发现需要迁移或扩大范围，停止并申请迁移号段（当前预留从 `000048` 起）及新的范围裁决。

不存在会改变 interface、持久化、权限、依赖、范围或任务拆分的开放问题。
