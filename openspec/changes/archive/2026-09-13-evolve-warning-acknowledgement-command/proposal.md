## Why

C26 要求“预警确认只表示已读接管，不表示风险解除”，但 C02 冻结的 `WarningResponsePortV1` 命令/结果联合与 C09 闭合 HTTP 路由表都没有确认分支。若不先演进公共契约，C26 与 C34 只能自建旁路或误用采纳、执行等处置命令，破坏预警事实、权限和幂等边界。

## What Changes

- 在既有预警处置 `record` interface 内增加 `acknowledge` 命令分支及 `acknowledgement` 成功结果分支；命令只携带预警信息与其处置任务的精确引用，并继续复用命令信封中的命令标识、业务幂等键、操作者、工程和版本化授权上下文。
- 固定确认语义为“已读并接管”：确认不得解除风险、关闭任务、修改预警事实或风险评估记录，也不得代替建议采纳、现场执行、反馈、偏差或校准决定。
- 增加 `warning.warning-acknowledged.v1` 事务领域事件分支，使 C26/C34 可基于可靠事实更新投影；事件载荷只包含预警与处置任务精确引用，操作者、授权、审计、命令和幂等身份沿用既有事件信封。
- 在 C09 的单一 `HTTP_ROUTE_CATALOG_V1` 中登记 `warning-response.acknowledge`，绑定既有 `WarningResponseRecordCommandV1Schema`、`WarningResponseRecordResultV1Schema` 与 `WarningResponsePortV1.record()`，并继续由同一元数据派生运行时路由和 OpenAPI。
- 扩展既有 contracts 与 HTTP 壳层测试，覆盖 strict 分支、结果/事件引用、授权与幂等信封、唯一 port 分派、服务端授权组装和 OpenAPI/运行时登记一致性；保留全部既有命令分支与语义。
- 非目标：不实现 C26 的预警归集、任务持久化或通知投递，不实现 C34 页面，不改变评估、P/C、风险矩阵或触发逻辑，不修改其它命令，不新增依赖、迁移或数据库注册，也不修改 Web、Worker、根 workspace、锁文件、依赖政策或主 specs 正文。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`: 为既有预警处置 `record` interface 增加确认命令、成功结果和精确引用事件，并固定其已读接管、权限、幂等、审计及不可解除风险语义。
- `platform/http-command-query-sse-shell`: 将确认分支登记到既有闭合 HTTP 路由清单，复用服务端授权、结果校验和 OpenAPI 派生路径。

## Impact

- **公共契约分支集合**：计划修改 `packages/contracts/src/ports/index.ts` 的 `MODULE_BRANCH_CAPABILITY_V1`、`WarningResponseRecordCommandV1Schema`、`WarningResponseRecordSuccessV1Schema`；`WarningResponsePortV1` 仍为 `open/recommend/record` 三方法，不新增浅层方法。计划修改 `packages/contracts/src/events/index.ts` 的 `DomainEventV1Schema`。现有 `OpenWarningCommandV1Schema`、`OpenWarningSuccessV1Schema` 及建议采纳、执行、反馈、偏差、校准分支字段和语义保持不变。
- **C09 登记点**：计划只修改 `apps/api/src/http.ts` 中 `HTTP_ROUTE_CATALOG_V1` 的 `WarningResponseRecordCommandV1Schema` 那组 `commandRoutes(...)` 映射，新增 `['warning-response.acknowledge', 'acknowledge']`；继续使用 `invokeWarningRecord`、`activeHttpRouteCatalog` 和 `httpCatalogForOpenApi`，不增加 handler、route catalog 或 OpenAPI 清单。
- **调用面**：C26 可通过公共命令保存已读接管事实并发布确认事件；C34 可调用同一 HTTP route，并根据精确结果/事件刷新任务展示。两者不得把确认当作风险解除或处置完成。
- **既有消费者与测试**：扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 和 `apps/api/test/http-shell.test.ts`；核对 `DomainEventV1Schema` 的通用持久化/Outbox 消费者及 `WarningResponsePortV1`、C09 route catalog 消费者，新增联合分支不得改变既有字段。
- **规格关系**：两个主规格都以通用要求约束闭合分支和路由，而未逐项枚举当前命令；本 change 以最小 ADDED requirement 固定新分支行为，不改写既有通用要求。`domain/contract-kernel` 已覆盖精确版本、命令信封、预警链路和审计语义，本 change 不改变其记录 Schema，故不产生该 capability 的 delta。
- **依赖与数据**：无新增、升级或删除依赖；无迁移、号段、数据回填或配置变化。若实现需要迁移、修改权限角色清单、扩大生产文件范围或改变既有命令/记录字段，必须停止并升级主调度 Agent。
