# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`8ad1e823adb1b0617ff41aa44e4890b2d1a8c2c0`；branch：`leike0813/c26-warning-tasks`；change/schema：`deliver-warning-tasks-and-in-app-notification` / `riskflow-delivery`。
- 实施 Agent 必须先完整读取 `openspec instructions apply --change deliver-warning-tasks-and-in-app-notification --json` 返回的全部 `contextFiles`，再按本文件 IP-ID 实施；不得只读本计划。
- 行为事实源：本 change delta spec；实现选择：`design.md` D-01～D-13；公共 DTO/结果/事件/能力事实源：当前 `packages/contracts/src/{records,ports,events,vocabulary}/index.ts`。
- 直接依赖 C03/C06/C07/C09 已归档实现；`evolve-warning-acknowledgement-command` 已在 base 中归档，open/ack HTTP 壳层与确认命令/结果/事件可直接消费。
- C25 检查点 `2578973` 是只读接口输入且当前 base 尚无其生产代码。实施硬门是 C25 已合并并仍符合其 D-09/D-14：存在可按精确 ref 读取的 `business.risk_assessment_records`、`business.assessment_input_snapshots`，公共记录/输入快照可 strict parse，且未把 warning 写入 C25。硬门不满足或字段 drift 必须 escalation；C26 不修改 C25。
- 迁移仅可使用 `000044`；`000045`–`000047` 保留，`000040`–`000043` 属于 C20。当前 base 的 provider 已包含 `warning-response` 域并递归发现迁移。
- 无新依赖。Node 24、pnpm 11.10.0、Vitest 4.1.11、TypeScript 5.9.3、ESLint 10.9.1、Prettier 3.9.6、OpenSpec 1.13.0 已在当前 worktree 核实可执行。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/records/index.ts` 的 `RiskAssessmentRecordSchema`/`WarningRecordSchema`；`ports/index.ts` 的 open/ack commands/results 与 refs；`events/index.ts` 两个 warning events；C25 测试 fixture（依赖合并后） | fixture 只构造公共合法值、正式 C25 评估记录、固定策略/授权/时点；adapter fixture 通过 C25 正式 adapter 产生上游事实 | 不改 contracts，不用手写宽松 DTO、生产 seed、内存 repository、Mock C25 记录或 `as unknown as` 绕过 Schema |
| IP-02 | 公共 warning/assessment/trigger schemas；`packages/core/src/persistence/{canonical-json,transaction,schema}.ts` | core schema 直接组合公共 refs；`WarningLifecycleServiceV1`、窄 readers/providers 和 `planWarningOpening` 使用现有规范引用键/摘要语义 | 不复制四类触发枚举、RiskAssessmentRecord/WarningRecord 字段，不实现 P/C、矩阵或阈值判断 |
| IP-03 | `packages/adapters/src/postgres/migrations/provider.ts` 的递归 provider 与 `warning-response` 域；C03/C07/C25 表 | 单个 `000044` 迁移创建 D-09 七表、关系、约束、索引和 grants | 不改 provider、旧迁移、中央登记/测试清单，不新建 receipt/outbox/audit 表 |
| IP-04 | `PostgresTransactionUnit.execute`、`LocalIdentityAccessV1`、`PostgresIdempotentConsumer` 的事务绑定、C25 两表、C03 AtomicCommit、C07 audit | `PostgresWarningAssessmentContextReader` 精确投影 C25；`PostgresWarningLifecycleAdapter` 实现 open/ack 和事务内 delivery writer | 不直读可变 latest、不更新 C25、不另建授权/幂等/审计/重试，不实现完整 WarningResponsePort 的未归属分支 |
| IP-05 | `packages/core/package.json`、`packages/adapters/package.json` 现有 feature subpath export 范式 | 各增加一个 `./warning` dist export | 不改依赖、根 export、workspace、锁文件或其它 subpath |
| IP-06 | IP-01 fixture；公共 Schema parse | 表格测试纯 warning 规划和 strict C26 DTO | 不锁内部函数顺序、错误全文或 JSON 字段顺序 |
| IP-07 | `packages/adapters/test/auth/fixture.ts`、C03/C06/C07 PostgreSQL fixture 范式、依赖合并后的 C25 fixture | 一条真实 PostgreSQL 链覆盖 open/task/ack/audit/outbox/并发 | 不用 Mock、内存仓储、直接插入伪评估事实或第二套迁移清单 |
| IP-08 | `apps/api/src/http.ts` 的 `HTTP_ROUTE_CATALOG_V1`、`invokeWarningOpen`、`invokeWarningRecord`；`apps/api/test/http-shell.test.ts` | 只运行现有 open/ack transport、授权与 OpenAPI 回归 | 不改 API 生产代码，不注入不完整 public port，不新增 route/DTO |
| IP-09 | `apps/worker/src/index.ts`；`PostgresIdempotentConsumer.consume`；IP-04 delivery writer | 新增一个可被现有事件泵调用的 warning handler，事务内落应用内投递 | 不建 poller、队列、retry loop、定时器或通知幂等表 |
| IP-10 | `apps/web/src/app/routes.ts`、现有 `/warnings` shell 与 SSR/routing tests | 仅验证路由和用户界面无 C26 越权改动 | 不实现 C34 页面，不显示开发说明/内部事实 |
| IP-11 | root scripts `typecheck`、`deps:check`、`deps:policy`；CLI lint/format/test；`git diff --check` | 运行最小相关验证并定位失败 IP-ID | 不运行 dev server，不安装依赖，不把未运行写成通过 |
| IP-12 | `openspec validate`、status 与项目 `openspec-verify-change` Skill | 严格验证五工件和实现证据，保持未归档 | 不提交、不归档、不改主 specs |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 契约夹具 | “预警只能消费…”全部；“每个评估…”多类/去重；“处置任务…”持续/多类/关闭；“应用内通知…”全部；“确认…”全部；“预警链路…”标准链 | **新增** `packages/core/test/warning/fixture.ts`：公共 assessment/open/ack refs、四 trigger、两项 C26 policy builders；**新增** `packages/adapters/test/warning/fixture.ts`：真实 PostgreSQL、C03/C06/C07、依赖合并后的 C25+C26 composition 与 failure seam | strict Schema、固定时点/版本、唯一排序；上游 assessment 必须经 C25 正式 adapter 持久化；failure seam 只使真实 DB 写失败一次 | 不新增生产 fixture/默认策略，不直接插 C25 表，不复制公共类型或建立 test-only repository |
| IP-02 | warning core | “预警只能消费…”全部；“每个评估…”全部；“处置任务…”归集语义；“应用内通知…”策略；“确认…”语义；“预警链路…”历史/披露 | **新增** `packages/core/src/warning/schema.ts`：D-02 policies/context/task/intent/delivery/ack/reason schemas；**新增** `packages/core/src/warning/service.ts`：`WarningAssessmentContextReaderV1`、`WarningRuntimePolicyProviderV1`、`WarningLifecycleServiceV1`、`planWarningOpening`、failure mapping；**新增** `packages/core/src/warning/index.ts`：显式导出 | 组合公共 SSOT；按 trigger type 规范分组；固定 stable aggregation key；空触发空 plan；一 warning/type、一 intent/recipient；输入/结果 bounded/strict | 不导入 adapter/apps/DB/Agent/LangGraph，不重算 C25，不为其它 warning-response 分支预建接口 |
| IP-03 | 数据库模型 | “每个评估…”并发唯一；“处置任务…”全部；“打开预警…”全部；“应用内通知…”全部；“确认…”全部；“预警链路…”可重放 | **新增** `packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`：D-09 `up/down` | 七表、FK/check/unique/partial unique/index/grants；task current 行窄 UPDATE，其余事实 append-only；逆序 down | 不占其它序号，不改 provider/旧迁移/中央清单，不 grant 事实 UPDATE/DELETE |
| IP-04 | PostgreSQL warning adapter | 除纯 UI 外全部 Requirement/Scenario | **新增** `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`：`PostgresWarningAssessmentContextReader`、`PostgresWarningLifecycleAdapter`、options/factory、`open`、`acknowledge`、`deliverInAppNotifications`、row parse/map；**新增** `packages/adapters/src/warning/index.ts` | 按 D-03/D-06/D-08 授权→精确读→策略→纯 plan→serializable atomic commit；DB uniqueness/row locks 收口并发；events/audit/receipts 原子；delivery 只接受绑定 transaction context | 不改 C25/C03/C06/C07，不查询 latest/list，不实现 recommend/其它 record，不吞并或降级授权/事务失败 |
| IP-05 | Feature exports | 全部 Requirement 的模块消费出口 | **修改** `packages/core/package.json`、`packages/adapters/package.json` | 各增加且只增加 `./warning` types/import export | 不改 dependency/devDependency/scripts/root exports/workspace/lock |
| IP-06 | core 行为测试 | “预警只能消费…”无触发/策略；“每个评估…”多类/去重；“处置任务…”归集键；“应用内通知…”策略；“确认…”不解除；“预警链路…”历史/披露 | **新增** `packages/core/test/warning/warning.test.ts`，复用 IP-01 core fixture | 表格覆盖空/四类/多类、乱序重复、policy mismatch、稳定 entity 聚合键、精确版本保留、intent/recipient 唯一和确认 DTO 语义 | 不精确断言全文/内部调用，不重复 contracts 已覆盖的 Schema 全排列 |
| IP-07 | PostgreSQL 与 G2.5 验收 | “每个评估…”并发；“处置任务…”全部；“打开预警…”全部；“应用内通知…”意图；“确认…”授权/版本/并发；“预警链路…”标准链/历史/披露 | **新增** `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`，复用 IP-01 adapter fixture | 正式 C25 assessment→open；原子 failure、same-key replay/conflict、different-command concurrency、continuous breach、multi-trigger one version、closed/new task、intent/event/audit、ack no resolution/stale/concurrent、G2.5 refs | 不伪造 C25 表、Mock store 或断言 SQL 顺序/内部时间 |
| IP-08 | API 契约回归 | open/ack 公共入口与“确认…”全部 | **无生产/测试文件修改**；检查 `apps/api/src/http.ts` 既有符号并运行 `apps/api/test/http-shell.test.ts`、contracts test | 证明 open/ack route、strict payload、server-owned auth、record dispatch、result/OpenAPI 仍匹配 base | 不接线不完整 port，不新增 API 文件或改 route catalog |
| IP-09 | Worker 投递 | “应用内通知…”提交/失败/重复；“预警链路…”标准链/披露 | **新增** `apps/worker/src/warning/runtime.ts`：`WARNING_IN_APP_NOTIFICATION_CONSUMER_V1`、`consumeWarningRecordedForInAppNotification`；**新增** `apps/worker/src/warning/index.ts`；**修改** `apps/worker/src/index.ts` 导出；**新增** `apps/worker/test/warning/runtime.test.ts` | parse exact event；调用现有 idempotent consumer；handler 用 IP-04 transaction-bound writer；一次失败后 retry；成功结果 ref=warning ref | 不启动 worker、不加 poller/retry/queue，不在 worker 创建 warning/task/intent，不更新 warning notificationStatus |
| IP-10 | Web 所有权保护 | “确认…”不解除；“预警链路…”最小披露 | **无生产/测试文件修改**；运行现有 routing/SSR tests 和 diff allowlist | 证明 `/warnings` 壳层保持、无内部语义进入 UI、C34 范围未被占用 | 不改 `apps/web/src/**` |
| IP-11 | 最小验证 | 全部 Requirements/Scenarios | **无代码文件修改**；执行 §6/§7 命令 | target tests、typecheck、lint、format、deps、diff 全部通过；失败归属具体 IP-ID | 不启动 dev server、不安装依赖、不忽略失败 |
| IP-12 | OpenSpec verify | 全部 Requirements/Scenarios 与 D-01～D-13 | **仅更新本 change `tasks.md` 完成勾选和 verify 证据** | strict validate/status、项目 verify Skill；行为与证据完成后才勾选 | 不改主 specs/其它 change，不归档、不提交 |

## 4. 调用与副作用顺序

### 4.1 `open`（IP-02/IP-04/IP-03）

1. `OpenWarningCommandV1Schema.parse`；复验 actor/project/authorization binding、`warning-response.open`、requested space/source grants。授权失败先返回，不查询目标。
2. `PostgresWarningAssessmentContextReader.read` 按 assessment exact ref 联结 C25 record/input snapshot，strict parse 并核对 project/risk/spatial/ref/digest；不读 latest。
3. 核对命令两个 policy refs 与冻结快照逐字一致；`WarningRuntimePolicyProviderV1` 按 exact refs 解析 D-02 policies，并核对 project/授权/recipient 非空。
4. `planWarningOpening` 纯计算 trigger groups、warning drafts、稳定 aggregation key 和 intent drafts；不生成领域判断。
5. `PostgresTransactionUnit.execute` 使用 `open` command payload；same-key completed receipt 直接回放，digest conflict 终止。
6. 空 plan：构造一个无 events 的 AtomicCommit，写 C07 audit/receipt 后返回三个空数组。
7. 非空 plan：以评估+trigger unique key 插/读规范 warnings；锁定未关闭 aggregation key，插入新 task 或追加一次 task version/link；只为新 warning 插入 intents。
8. 每条新 warning 生成一个 strict `warning.warning-recorded.v1`，event/task ref 指向本次最终任务版本，payload intent refs 只属于该 warning；AtomicCommit 统一写 audit/receipt/outbox 并提交。
9. 不同命令的 unique race 读取 winner 后重建完整规范 result；无法在 serializable retry budget 内收口映射 `TRANSIENT_FAILURE`，不暴露 SQL。

### 4.2 `acknowledge`（IP-04/IP-03）

1. `WarningResponseRecordCommandV1Schema.parse` 后断言 `kind=acknowledge`；其它 kind 不进入 C26 handler。
2. 复验 actor/project/authorization binding 与 `warning-response.record`，再在获准工程/空间联合查询 warning、task exact version 和关联。
3. 锁定 task current row；version 不当前返回 `STALE_VERSION`，closed/已确认/关系不符按 D-08 映射，越权/不可见统一 `AUTHORIZATION_DENIED`。
4. `PostgresTransactionUnit.execute` 收口 command idempotency；插入唯一 acknowledgement，构造公共 success 和 `warning.warning-acknowledged.v1`，AtomicCommit 同时提交 audit/receipt/event。
5. 任何写入失败整体回滚；绝不更新 warning、assessment、task、intent 或 delivery。

### 4.3 应用内通知（IP-09/IP-04/IP-03）

1. Worker strict parse event 且只接受 `warning.warning-recorded.v1`；其它事件 fail closed，不标记完成。
2. `PostgresIdempotentConsumer.consume(WARNING_IN_APP_NOTIFICATION_CONSUMER_V1, event, handler)` 校验同 event ID/digest。
3. handler 在绑定 transaction context 中逐个读取 event exact intent，核对 project/warning/task/event 关联和 channel；批量插入唯一 `in_app_notifications`。
4. 全部成功后返回 `warningRecordRef`，consumer receipt 标记 completed；重投返回 saved result。
5. 任一 intent 或 DB 写失败使 delivery/consumer handler 事务回滚；C03 更新 attempt/error/next retry。先前 open 事务及 warning/task/intent 不受影响。

## 5. Schema、状态与持久化落实

### 5.1 Schema 与版本

- 公共输入/输出/事件：只 import `@riskflow/contracts`，不得 re-export 改造版或新增字段。
- C26 private Schema：`schemaVersion=1`；policy、assessment context、task version、intent、delivery、ack 全部 strict/bounded；ref 集合按 `kind/entityId/versionId` 唯一排序。
- Policy compatibility：command refs = C25 snapshot refs = provider policy refs，project 相同；任一不等失败，无 latest/default。
- `WarningRecord.notificationStatus` 固定 `intent-recorded`；delivery/ack 通过独立事实表达，不回写。
- task aggregation identity 只含 project + risk kind/entity + spatial entity；每个 version 保存 exact risk/spatial/assessment/warning refs。

### 5.2 状态与并发

| 对象 | 合法状态/变化 | 并发收口 |
|---|---|---|
| Warning | 创建后不可变 | assessment exact ref + trigger type unique |
| Task | stable row `open→closed`；C26 只创建/读取 open 与推进 current version | 未关闭 aggregation key partial unique + row lock + serializable transaction |
| TaskVersion/Link | 只追加 | task/version PK；task/warning unique |
| NotificationIntent | 创建后不可变、channel in-app | warning/task/policy/recipient unique |
| InAppNotification | 只追加 delivery fact | intent exact ref unique + C03 consumer receipt |
| Acknowledgement | 只追加首次 warning/task exact pair | warning/task pair unique + task current lock |

### 5.3 事务、权限、错误、审计

- open 与 acknowledge 各使用一份 C03 command receipt 和一个 `TransactionUnitV1.execute`；business writes 通过 transaction-bound Kysely 完成，返回一个 `AtomicCommitV1`。
- Worker delivery 使用 `PostgresIdempotentConsumer` 自带事务；不得嵌套新 receipt 或先标记完成。
- open/ack 先授权后读取；Worker 使用事件的服务端系统授权链和精确 project refs，只能相同或收窄。
- public error 只使用既有 union；D-10 reason→code mapping 固定在 adapter 单处。未知 DB/contract drift 不能降级成功。
- open/ack audit 由 AtomicCommit 写 C07 表；Worker attempt/failure 使用 C03 consumer/outbox 记录。普通日志不增加高基数正文。

### 5.4 迁移

- 路径/序号/七表严格按 D-09/IP-03；`up` 建 schema objects，`down` 逆依赖删除本 change objects。
- 实施前运行 `find packages/adapters/src/postgres/migrations -type f -name '00004[4-7]_*' -print`，任何已有 `000044` 或号段冲突立即 escalation。
- feature 测试按现有 fixture API 显式加载真实迁移；不得修改 `packages/adapters/test/postgres/postgres-foundation.test.ts` 或其它中央 migration list。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 预警只能消费… / 由精确评估记录创建预警输入 | IP-01, IP-02, IP-04, IP-07 | adapter PG test | C25 正式 adapter 生成 record+snapshot；exact policies | warning fields 等于 persisted assessment；无评估重算调用面 | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 预警只能消费… / 无触发事实返回空结果 | IP-02, IP-06, IP-07 | core + PG | empty trigger record | 三数组空；仅 receipt/audit；无 warning/task/intent/event | `pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 预警只能消费… / 策略或授权不匹配时失败闭合 | IP-02, IP-04, IP-07 | core + PG | wrong project/ref/authorization/provider | structured denial；零副作用；无目标泄露 | `pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 每个评估… / 多类触发形成多条规范预警 | IP-01, IP-02, IP-06, IP-07 | core + PG | three trigger types | one warning/type；same assessment；type-scoped indicators | `pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 每个评估… / 同类重复指标只保留一次 | IP-02, IP-06 | core test | reordered duplicate indicators/evidence | same normalized plan/content | `pnpm exec vitest run packages/core/test/warning/warning.test.ts` |
| 每个评估… / 不同命令并发打开同一评估 | IP-03, IP-04, IP-07 | PG test | two keys, concurrent transactions | one warning/type；both canonical refs or retryable typed result | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 处置任务… / 持续越限归集到同一任务 | IP-03, IP-04, IP-07 | PG test | two assessment versions, same stable risk/scope | same task entity；version increments；links append | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 处置任务… / 多触发类型共享一个任务版本 | IP-02, IP-04, IP-07 | PG test | one assessment, multiple triggers | one deduped task ref；all warning links introduced in same version | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 处置任务… / 已关闭任务不被重新使用 | IP-03, IP-04, IP-07 | PG test | fixture invokes future-compatible close state transition at DB boundary | new task entity；old versions unchanged | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 打开预警… / 相同命令重试不重复预警 | IP-03, IP-04, IP-07 | PG test | same idempotency key/payload | same result refs；one facts/audit/events set | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 打开预警… / 同键异载荷被拒绝 | IP-04, IP-07 | PG test | same key, changed assessment/policy | `IDEMPOTENCY_CONFLICT`; first result unchanged | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 打开预警… / 原子写入失败整体回滚 | IP-01, IP-03, IP-04, IP-07 | PG test | fail one audit/outbox/business insert | no partial rows；same key safely retries | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 应用内通知… / 预警提交后投递应用内通知 | IP-03, IP-04, IP-09 | worker test | committed warning event/intents | one delivery/intent；exact warning/task/recipient/policy | `pnpm exec vitest run apps/worker/test/warning/runtime.test.ts` |
| 应用内通知… / 通知失败不回滚预警 | IP-01, IP-09 | worker test | one real DB delivery failure | warning/task/intent/open receipt remain；consumer pending attempt recorded | `pnpm exec vitest run apps/worker/test/warning/runtime.test.ts` |
| 应用内通知… / 重复事件不重复通知 | IP-03, IP-09 | worker test | same event twice/retry after failure | one delivery；consumer replayed=true on completed event | `pnpm exec vitest run apps/worker/test/warning/runtime.test.ts` |
| 确认… / 获授权管理员确认一条预警 | IP-04, IP-07, IP-08 | PG + API | project-risk-manager, exact current pair | public acknowledgement；one fact/audit/event；route dispatch unchanged | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/api/test/http-shell.test.ts` |
| 确认… / 确认不表示风险解除 | IP-02, IP-04, IP-06, IP-07, IP-10 | core + PG + Web | acknowledged warning | no warning/assessment/task/delivery mutation；UI shell no resolved implication | `pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx` |
| 确认… / 不匹配或陈旧任务版本被拒绝 | IP-04, IP-07 | PG test | wrong association/stale current version/cross-space | stale/business vs non-enumerable auth；zero side effects | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 确认… / 确认重试和并发接管保持唯一 | IP-03, IP-04, IP-07 | PG test | same-key replay/conflict and two command keys | one acknowledgement/audit/event; first actor retained | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 预警链路… / 标准风险链可确定性验收 | IP-01, IP-07, IP-09 | PG + worker | C25 formal G2.5 risk fixture | risk→P/C→matrix→trigger→warning→task→intent→delivery→ack→audit refs | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts` |
| 预警链路… / 历史链不受后续版本影响 | IP-03, IP-04, IP-07 | PG test | newer assessment/policies/task version | historical rows/refs unchanged and replayable | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` |
| 预警链路… / 错误和事件保持最小披露 | IP-04, IP-07, IP-09 | PG + worker | authorization/DB/policy failures | codes/refs only；no body/recipient auth/SQL leakage | `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts` |

### 6.1 已核实工具的最小验证命令

以下 executable/root scripts 已在 base worktree 核实存在；新增测试路径由对应 IP 创建后执行：

```bash
pnpm exec vitest run packages/core/test/warning/warning.test.ts
pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts
pnpm exec vitest run apps/worker/test/warning/runtime.test.ts
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts
pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts
pnpm exec prettier --check openspec/changes/deliver-warning-tasks-and-in-app-notification packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts packages/core/package.json packages/adapters/package.json
pnpm run deps:check
pnpm run deps:policy
git diff --check
openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive
openspec status --change deliver-warning-tasks-and-in-app-notification --json
```

不运行 `packages/adapters/test/postgres/postgres-foundation.test.ts` 作为 C26 完成门，因为该中央迁移清单由主调度所有且本 change 明确禁止修改；主调度完成中央登记后必须在集成检查点另行运行。

## 7. 文件清单与升级条件

### 7.1 新增文件

- IP-01：`packages/core/test/warning/fixture.ts`；`packages/adapters/test/warning/fixture.ts`
- IP-02：`packages/core/src/warning/schema.ts`；`packages/core/src/warning/service.ts`；`packages/core/src/warning/index.ts`
- IP-03：`packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`
- IP-04：`packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`；`packages/adapters/src/warning/index.ts`
- IP-06：`packages/core/test/warning/warning.test.ts`
- IP-07：`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`
- IP-09：`apps/worker/src/warning/runtime.ts`；`apps/worker/src/warning/index.ts`；`apps/worker/test/warning/runtime.test.ts`

### 7.2 修改文件

- IP-05：`packages/core/package.json`；`packages/adapters/package.json`
- IP-09：`apps/worker/src/index.ts`

### 7.3 删除文件

无。

### 7.4 无文件修改的验证责任

- IP-08：API/contracts 回归。
- IP-10：Web routing/SSR 和 diff 所有权回归。
- IP-11：target tests、type/lint/format/deps/diff。
- IP-12：OpenSpec strict validate/status/verify。

### 7.5 受保护范围

`packages/contracts/**`、C25 及其它既有生产模块、`apps/api/src/**`、`apps/web/src/**`、根 `package.json`/workspace/tsconfig、`pnpm-lock.yaml`、依赖政策、`openspec/config.yaml`、`openspec/specs/**`、其它 `openspec/changes/**`、旧 migrations、migration provider、中央迁移登记和测试清单均不得修改。

### 7.6 必须立即 ask/escalation 的条件

1. HEAD/base、schemaName、branch、迁移号段或 `000044` 空闲状态不符；
2. C25 未合并，或其正式表/公共 record/input snapshot/ref/digest 无法按 D-03 精确读取；
3. 需要修改 `packages/contracts`、C25、C03/C06/C07/C09、主 specs、API/Web 生产代码、中央迁移清单或本 allowlist 外生产文件；
4. 需要新增依赖、渠道、任务关闭、触发判断、幂等/重试/审计基础设施或完整 `WarningResponsePortV1` 组合；
5. 无法用一条 `000044` 迁移保持 FK、唯一性、append-only 与 rollback，或需要使用 `000045`–`000047`；
6. 任何 Requirement/Scenario 只能靠 Mock、生产 seed、占位、默认策略、私有最新值查询或弱化授权/事务来通过；
7. 任一已核实命令在实施环境不存在，或验证失败揭示设计/规格而非局部实现问题。

不存在需要实施 Agent 自行决定的公共契约、数据规则、事务边界、依赖、文件或测试范围。
