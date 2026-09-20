## Context

参见 [proposal.md](proposal.md) 的动因和 [delta spec](specs/domain/warning-tasks-and-in-app-notification/spec.md) 的行为边界。基线提交固定为 `8ad1e823adb1b0617ff41aa44e4890b2d1a8c2c0`，实际 schema 为 `riskflow-delivery`。

C25 尚未实现，但其检查点 `2578973` 已固定 `business.risk_assessment_records`、`business.assessment_input_snapshots` 和 `assessment.recorded.v1`：评估记录保存公共 `RiskAssessmentRecord`，输入快照冻结 `warningAggregationPolicyRef`、`notificationPolicyRef` 和空间上下文，C26 “凭 assessment record ref” 消费，C25 不写预警。C25 同时规定这两个策略由 C26/部署所有者的正式运行时策略提供者注入，不得默认或内联。

C03 已提供 `TransactionUnitV1`、命令回执、Outbox、租约和 `PostgresIdempotentConsumer`；C06 提供当前工程/空间/能力授权；C07 提供原子只追加审计；C09 已登记 `warning-response.open` 与 `warning-response.acknowledge` HTTP 路由。公共 contracts 已具备 `WarningRecordSchema`、`WarningResponsePortV1`、打开/确认命令与结果、`warning.warning-recorded.v1` 和 `warning.warning-acknowledged.v1`。当前代码没有 warning core、PostgreSQL adapter 或通知 Worker。

## Goals / Non-Goals

**Goals:**

- 建立无 Agent、无触发计算的 `warning` 深层模块，以一套事务和数据库唯一性实现预警、任务、意图和确认。
- 让 C26 只读取 C25 的权威持久化事实，且 core 通过显式窄端口与 PostgreSQL 隔离。
- 使用一个迁移和现有 Outbox/幂等消费者完成可靠应用内通知，不增加消息或去重基础设施。
- 固定后续 C27～C31、C34 可消费的任务版本、通知意图、投递和确认事实。

**Non-Goals:**

- 不实现或修改 P/C、矩阵、阈值、联合触发、风险解除、任务关闭、建议、执行、反馈、偏差、校准或 LangGraph。
- 不修改公共 contracts、C25 生产代码、主 specs、中央迁移登记/测试清单、API route catalog 或 Web 页面。
- 不提供邮件、短信、企业微信等外部渠道，不启动常驻 Worker 或开发服务器。
- 不为尚未实现的 `recommend` 和其它 `record` 分支提供 Mock、占位成功或伪回退，也不在 C26 单独组装不完整的 `WarningResponsePortV1`。

## Decisions

### D-01：复用公共契约，C26 只导出其拥有的两个分支处理器

`packages/core/src/warning` 直接解析公共 `OpenWarningCommandV1Schema`、`WarningResponseRecordCommandV1Schema` 的 `acknowledge` 分支、对应结果 Schema、`WarningRecordSchema` 和两个既有事件。C26 内部服务接口为 `WarningLifecycleServiceV1`，只暴露 `open(command)` 与 `acknowledge(command)`；确认命令类型由公共联合类型 `Extract` 得到，不复制 DTO。

PostgreSQL adapter 实现这两个处理器，但不宣称实现完整 `WarningResponsePortV1`。C09 的 port presence 会一次激活 `open`、`recommend` 和全部 `record` 路由；在 C27～C29 的真实分支尚未齐备前注入部分 port 会错误暴露未实现能力，因此 C26 只验证既有 open/ack transport 无漂移，完整 port 组合留给拥有全部分支的后续应用组合根。

**替代方案：**返回 `UNSUPPORTED_CONTRACT` 填满其余方法会形成生产占位；增加 C26 专用公共 port 或 HTTP 路由会复制已归档契约。两个真实分支处理器是当前最小完整出口。

### D-02：strict 运行时策略只承载 C26 必需的业务输入

`schema.ts` 定义并导出：

- `WarningAggregationPolicyV1`：`schemaVersion=1`、精确 `policyRef`、`projectId`，以及四类公共触发类型各自唯一的 `recommendedResponseDirection`；任务归集键是规格固定规则，不做可编程表达式。
- `InAppNotificationPolicyV1`：`schemaVersion=1`、精确 `policyRef`、`projectId`、唯一且规范排序的非空 `recipientActorIds`，channel 固定为 `in-app`。
- `WarningRuntimePolicySetV1`：把上述两项组成一次精确解析结果；`WarningRuntimePolicyProviderV1` 只能按命令中的两个精确引用、工程和授权返回，不提供 latest/default。
- `WarningAssessmentContextV1`：公共评估记录、其精确引用、公共输入快照引用、风险输入精确引用、空间精确引用和快照冻结的两个策略引用。
- 任务版本、通知意图、应用内投递、确认及闭合 reason code 的 C26 自有 strict/bounded DTO。

`notificationStatus` 在不可变公共预警上固定为 `intent-recorded`，只表示通知意图已与预警原子持久化；送达和失败属于独立投递事实，确认属于独立确认事实。所有集合按稳定引用键排序去重。

**替代方案：**把策略写进命令会让客户端覆盖审核输入；把它们并入 C18 的闭合定义类型会越过 contracts/C18 所有权；模板 DSL、渠道插件和可配置归集表达式均无当前需求。

### D-03：用私有只读端口消费 C25 权威记录，不建立第二事实源

core 定义 `WarningAssessmentContextReaderV1.read(projectId, assessmentRecordRef, authorization)`。`PostgresWarningLifecycleAdapter` 的私有查询实现只按精确 ref 联结 C25 计划中的 `business.risk_assessment_records` 与 `business.assessment_input_snapshots`，解析公共 `RiskAssessmentRecordSchema` 和 `AssessmentInputSnapshotV1Schema`，投影 D-02 的有界上下文；它不导出列表查询，不复制评估表，不读取“最新评估”，也不更新 C25 数据。

读取顺序为公共命令 parse → C06 当前授权复验 → 获准工程/空间内精确记录查询 → 公共 Schema/digest/引用联结复验 → 策略提供者精确解析。C25 表或字段与其已批准 D-09 漂移、reader 无法形成、或两个策略 ref 不能从冻结快照证明时，实施必须停止升级，不能猜列名或增加 C25 修改。

**替代方案：**core 直接使用 Kysely 违反层边界；修改公共 `RiskAssessmentPortV1` 或 C25 生产代码扩大 change；复制一张 warning-side assessment 表会形成第二事实源。私有 read port 保持调用边界显式，唯一 adapter 读取已批准持久化接口。

### D-04：一条评估的每个触发类型只有一条不可变预警

core 纯函数 `planWarningOpening` 接收 D-02 已解析上下文和策略：

1. 按 `WarningTriggerType` 及触发指标稳定身份规范排序、去重和分组；空集合返回空计划。
2. 每个非空触发类型生成一份 `WarningRecord` 草案，风险等级取评估记录 `riskLevel`，证据为该类型指标证据与评估证据的规范并集，响应方向取精确归集策略，状态固定为 `intent-recorded`。
3. 形成固定归集键 `{projectId, riskInputRef.kind, riskInputRef.reference.entityId, spatialScopeRef.reference.entityId}`；版本只作为每次关联证据，不进入稳定归集键。
4. 为每个预警和通知接收人形成唯一意图草案；不产生事件、审计或数据库 ID。

数据库以 `(project_id, assessment_record_entity_id, assessment_record_version_id, trigger_type)` 唯一约束收口不同命令和并发。ID 使用现有 Node `crypto.randomUUID()` 生成，竞争失败后在同一事务读取规范既有行；不把内容 hash 当作额外门禁或幂等注册。

**替代方案：**每个指标一条预警会放大重复；把四类压成一条会丢失公共 `triggerType` 语义；按命令 ID 去重无法处理不同命令；重新运行阈值算法违反 C25 所有权。

### D-05：任务是稳定实体加只追加版本和关联

PostgreSQL 使用一个稳定任务行保存归集键、`open|closed` 和当前版本号；`warning_response_task_versions` 只追加每次版本、精确空间版本、命令、授权、审计与时间；`warning_response_task_warnings` 只追加任务—预警关联并记录首次纳入版本。处理新预警时锁定归集键对应的未关闭任务：存在则一次性追加所有新关联并创建一个新版本，不存在则创建任务和版本 1。数据库部分唯一索引保证一个归集键最多一个未关闭任务。

同一次命令内多个触发类型共享最终任务版本，成功结果只返回该引用一次，每个 `warning.warning-recorded.v1` 也引用该最终版本。C26 不提供 close 操作；`closed` 仅是后续正式处置流程使用的状态边界，关闭后新预警创建新任务实体。

**替代方案：**每条预警一个任务不满足持续归集；只维护可变 JSON 数组无法追溯版本和并发；每条预警推进一次版本会制造无业务意义的中间版本。

### D-06：`open` 复用一份命令回执和一个原子事务

`PostgresWarningLifecycleAdapter.open` 的顺序固定为：

1. parse 公共命令并复验 `warning-response.open` 授权；读取 D-03 上下文和 D-02 精确策略。
2. 计算规范载荷摘要并进入 C03 `TransactionUnitV1.execute`；同键同载荷直接返回已保存公共结果，同键异载荷返回 `IDEMPOTENCY_CONFLICT`。
3. 运行 D-04 纯计划；空触发只写成功命令回执和 C07 审计，不写 warning 业务表或事件。
4. 对非空计划按 D-04 业务唯一键读取或插入预警；锁定/创建 D-05 任务，仅在出现新关联时追加一个任务版本；为每条新预警和策略接收人插入不可变通知意图。
5. 为每条新预警写一条 `warning.warning-recorded.v1`，其 `aggregateRef` 与 payload task ref 相同；写 C07 审计和成功回执后共同提交。

语义重复的不同命令返回同一评估全部触发类型对应的规范预警、唯一当前任务和意图 refs；只有本事务新建的预警发布事件。任一业务事实、审计、回执或 Outbox 失败整体回滚。数据库约束与 C03 回执是唯一两层收口：前者保护领域唯一事实，后者实现公共命令幂等，不增加缓存、锁服务或自有 receipt。

**替代方案：**先提交预警再创建意图会留下半成品；每个触发独立事务不能原子归集；用 Worker 生成预警会把领域事实依赖于异步可用性。

### D-07：Worker 用现有幂等消费者写应用内投递事实

`apps/worker/src/warning/runtime.ts` 导出 `consumeWarningRecordedForInAppNotification`。它只接受并解析 `warning.warning-recorded.v1`，以固定 consumer name 调用现有 `PostgresIdempotentConsumer.consume`；handler 在消费者绑定的同一事务中按事件给出的精确 intent refs 调用 adapter 的 `deliverInAppNotifications`，验证每个意图属于事件的预警和任务后批量插入 `in_app_notifications`，并以 `warningRecordRef` 作为消费者结果引用。

`(project_id, notification_intent_entity_id, notification_intent_version_id)` 唯一约束提供投递事实的最后防线。handler 失败时消费者事务回滚，C03 receipt 记录 attempt/error/next retry；已提交的 open 事务完全不受影响。成功重投返回消费者既有结果，不重复通知。通知意图与预警均不更新状态，C31/C34 后续按 intent、delivery、ack 三类事实投影。

本 change 只提供可由现有事件泵调用的生产 handler，不启动常驻进程，不创建第二个 outbox poller 或自定义 retry loop。

**替代方案：**在 open 事务内写最终通知会让通知故障回滚预警；仅靠 `ON CONFLICT DO NOTHING` 没有事件载荷冲突检测；新消息队列和重试表重复 C03。

### D-08：确认是独立不可变配对事实

`acknowledge` 直接使用已归档公共命令。顺序固定为 parse 且 kind 必须为 `acknowledge` → C06 `warning-response.record` 授权 → 获准工程/空间内联结精确 warning/task/version/association → 验证任务当前版本等于命令版本且状态 open → C03 atomic command。

事务锁定目标任务版本和配对，以 `(project_id, warning_ref, task_ref)` 唯一插入 `warning_acknowledgements`，保存首次 actor/time/authorization/audit；随后写命令回执、C07 审计和 `warning.warning-acknowledged.v1`。同键同载荷返回首次结果，同键异载荷冲突；不同命令竞争时唯一成功，若任务已推进返回 `STALE_VERSION`，若同一精确配对已确认返回 `BUSINESS_BLOCKED`。无权、跨工程/空间、缺失或关联不符统一不可枚举。

确认不更新 warnings、tasks、assessment、intents 或 deliveries。后续投递成功也不能自动生成确认。

**替代方案：**任务级批量确认无法表达逐条已读；更新 warning 状态会把可变交互写进不可变事实；用通知送达代替确认混淆系统投递与人工接管。

### D-09：`000044` 一次建立最小持久化模型

迁移固定为 `packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`，不占用 `000045`–`000047`。新增七张表：

- `business.warning_records`：公共 warning ref/JSON、project、assessment ref、trigger type、risk/spatial identity、两个策略 ref、内容摘要、命令/授权/审计与三时态；评估+触发类型唯一。
- `business.warning_response_tasks`：稳定 task ID、归集键、open/closed、current version 和三时态；未关闭归集键部分唯一。
- `business.warning_response_task_versions`：task/version、精确空间 ref、状态、命令/授权/审计和三时态，只追加。
- `business.warning_response_task_warnings`：task、warning、首次纳入版本和时间，只追加且配对唯一。
- `business.notification_intents`：intent ref、warning/task/policy/recipient、channel=`in-app`、审计和时间，只追加且意图业务键唯一。
- `business.in_app_notifications`：intent、warning/task/recipient 和创建时间，只追加且 intent 唯一。
- `business.warning_acknowledgements`：精确 warning/task 配对、actor、authorization、audit 和时间，只追加且配对唯一。

FK 连接 C25 评估记录、C03 command receipt/consumer receipt/Outbox、C07 audit 及本迁移关系；JSON/check/非空/version/状态约束在数据库复验。应用角色仅获得所需 SELECT/INSERT，以及任务当前指针/状态所需的窄 UPDATE；其它事实无 UPDATE/DELETE。provider 已递归发现 `warning-response`，不修改 provider；中央迁移登记和全局测试清单由主调度检查点所有，本 change 不触碰。

**替代方案：**拆四个迁移增加部署面；把所有内容塞入一张 JSON 表无法保护唯一关联和投递；为每种触发建表复制 Schema。一个迁移保留 `000045`–`000047`。

### D-10：权限、失败和审计沿用现有闭合语义

所有入口先 parse，再复验命令 actor/project 与 C06 当前授权主体、`warning-response.open|record` 能力、空间范围和所需来源范围；系统调用只能使用 C06 签发且范围相同或更窄的上下文。内部 reason code 至少区分 `assessment-unavailable`、`assessment-contract-drift`、`policy-unavailable`、`policy-mismatch`、`trigger-context-invalid`、`task-version-stale`、`warning-task-mismatch`、`already-acknowledged`、`notification-intent-mismatch`，映射到公共 `AUTHORIZATION_DENIED|UNSUPPORTED_CONTRACT|BUSINESS_BLOCKED|STALE_VERSION|IDEMPOTENCY_CONFLICT|TRANSIENT_FAILURE|TERMINAL_FAILURE`。

普通结果、事件、日志只含契约允许的引用、结果 kind、稳定 stage/reason/diagnostic ref，不含评估/证据/通知正文、接收人私有信息、授权详情或 SQL。open 审计连接 assessment/risk/spatial/policy/warning/task/intent，ack 审计连接 warning/task/actor，Worker 失败使用 C03 consumer/outbox 尝试记录。业务审计失败回滚所属事务；Worker 失败不影响先前 open。

**替代方案：**新增错误码或审计表会复制公共事实源；先查存在再授权会泄露跨工程目标。

### D-11：包导出和应用接入遵守后续 change 所有权

core/adapters 的 package manifest 各增加且只增加 `./warning` 子路径导出；不改根 `src/index.ts`、依赖或锁文件。Worker 新增 `warning` 子模块并从现有 `apps/worker/src/index.ts` 导出生产 handler。

API 的 open/ack route、strict transport、服务端授权组装与 `record` 分派已由 C09/前置契约完成，C26 不改 `apps/api/src/http.ts`；测试运行现有 HTTP shell 证明无漂移。Web `/warnings` 壳层由 C09 提供、业务页面由 C34 所有，C26 不改 Web 生产文件，只运行 route/SSR 回归并检查 diff。完整 `WarningResponsePortV1` 和常驻事件组合在相关后续 change 所有分支齐备后接线。

**替代方案：**现在增加页面、专用 endpoint、空 Worker 主循环或部分 public port 都会重复既有入口或越过 C27～C34 所有权。

### D-12：验证聚焦一个纯计划表和一条真实 PostgreSQL 链

core 表格测试覆盖空触发、四类单触发/多触发、乱序去重、策略不匹配、固定归集键和 notification intent 规划。PostgreSQL 集成测试使用 C25 正式表/公共 Schema 与 C03/C06/C07 fixture，覆盖 open 原子回滚、同键重放/冲突、不同命令并发、持续越限同任务、多触发单任务版本、closed 后新任务、确认语义/版本/并发、审计和两个事件。Worker 测试用真实 PostgreSQL adapter 与 `PostgresIdempotentConsumer` 注入一次可恢复写入失败，证明 warning 保留、consumer 记录失败、重试只落一份通知。

G2.5 纵向夹具从 C25 已持久化标准风险评估记录开始，检查 risk→P/C→matrix→trigger→warning→task→intent→delivery→ack→audit 引用链；不复制 C25 算法。测试只断言结构化结果、引用、唯一行数与事务可见性，不锁定 SQL 顺序、全文、字段顺序或内部调用。

**替代方案：**内存仓储或 Mock 无法证明数据库唯一性和失败隔离；每种等价输入写独立测试增加维护成本。表格 core 测试加一条 PostgreSQL 纵向链足够。

### D-13：文件所有权和 RA 交接固定

| 所有者 | 新增/修改范围 | 明确保护 |
|---|---|---|
| C26 core | `packages/core/src/warning/{schema,service,index}.ts`、`packages/core/test/warning/*`、core package 子路径 export | 不导入 adapters/apps/数据库，不重算 C25 |
| C26 adapter | `packages/adapters/src/warning/{postgres-warning-lifecycle-adapter,index}.ts`、对应测试、adapter package 子路径 export | 不修改 C25、C03/C06/C07 实现或 migration provider |
| C26 database | D-09 唯一 `000044` 迁移 | 不改旧迁移、中央清单，不用 `000045`–`000047` |
| C26 Worker | `apps/worker/src/warning/{runtime,index}.ts`、`apps/worker/src/index.ts`、对应测试 | 不建第二 poller/retry，不启动服务 |
| 受保护 | `packages/contracts/**`、`apps/api/src/**`、`apps/web/src/**`、根 workspace/锁文件/依赖政策、主 specs、其它 changes | 只运行回归与 diff 检查 |

RA-S6 的触发判断继续属于 C25；C26 从 `RiskAssessmentRecordRef` 延伸到 warning/task/intent/delivery/ack/audit；C27～C29 后续追加建议、执行和反馈，C31/C34 只投影这些事实。C26 不保存或展示模型思维链，因为全流程无 Agent。

## Risks / Trade-offs

- [C25 尚未实现，实际表名或列可能偏离其批准 D-09] → 实施前以 C25 合并检查点和 `openspec instructions apply --json` 为硬门；任何漂移立即升级，不在 C26 猜测或修改 C25。
- [C09 以 port presence 激活整个 warning-response 路由族] → C26 不注入部分 public port，只交付真实 branch handlers；完整组合等所有分支实现后进行。
- [任务稳定归集键忽略 risk/spatial 的版本] → 每个任务版本和 warning 仍保存精确版本；稳定实体变化才拆任务，满足持续越限归集且可追溯。
- [任务当前指针需要窄 UPDATE] → 所有历史版本和关联只追加；行锁、部分唯一索引和 C07 审计限制更新面。
- [同一事件包含多个通知意图，一项失败会重试整批] → 同一消费者事务原子写全部意图，唯一约束使重试安全；当前应用内渠道规模有界，不提前拆消息。
- [中央迁移清单不由 C26 修改] → C26 通过 feature 集成测试直接加载 `000044`；主调度在合并检查点统一登记并运行全局 provider 测试。

## Migration Plan

1. 实施前确认 C25 已按检查点 `2578973` 落地并可提供 D-03 所需字段，且当前迁移序号 `000044` 空闲；任一条件不满足即升级。
2. 部署 `000044`，由现有 provider 递归发现；迁移只创建新表、约束、索引和 grants，无存量回填。
3. 部署 core/adapters warning 子路径和 Worker handler；在正式 C26/部署策略已注入前不启用调用。
4. 用真实 PostgreSQL 纵向测试证明 open/ack/notification 事务和重试；主调度另行维护中央迁移检查点。
5. 回滚时先停止事件调用，再执行 `000044` 的逆序 down 删除本 change 七表；已产生正式 warning 数据后不得直接回滚，须先导出审计引用并由业务批准处置。

不存在会改变 specs、实现路径或任务拆分的开放问题。
