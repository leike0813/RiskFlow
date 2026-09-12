# Implementation Plan

## 1. 实施基线与权威来源

- 固定代码基线：`5c49f20e615c6507be40b5cc74f734fba4b4fb80`；当前规划分支为 `leike0813/c15-cleaning-partial`。
- change：`deliver-agent-cleaning-and-partial-availability`；`openspec status --change ... --json` 确认为 `schemaName: riskflow-delivery`。
- 行为事实源：本 change 的 proposal、`data/agent-cleaning-and-partial-availability` delta spec 和 `design.md`；领域术语依据相关主 specs。实现不得重新解释研究原件。
- 直接实现依赖：已归档 C08 `deliver-unified-bounded-agent-runtime`、C11 `deliver-engineering-context-and-source-registry`、C12 `deliver-structured-document-conversion`、C14 `deliver-monitoring-batches-snapshots-and-features`。
- 只读接口输入：C13 `deliver-scanned-document-ocr` 的五工件与检查点 `e0c928105de371668f7619145eb87a2272854b12`；只依赖其 C12 `ocr-layout` 输出契约，不依赖 PaddleX 私有响应。
- 硬性前置：独立 change `evolve-identification-preparation-segment-set-refs` 与 C13 均已归档并集成；`IdentificationPreparationSnapshotV1Schema` 暴露 `includedSourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1)`，C13 仍输出 C12 `ocr-layout` conversion + JSON-LD + segment set。未满足则 IP-01 立即升级，禁止实现其它 IP。
- 依赖与范围：不新增依赖，不修改 `packages/contracts`、根 `package.json`/workspace、锁文件、`openspec/config.yaml`、API/Web 或中央注册文件；不启动开发服务器。

实施前执行 `git diff --name-only 5c49f20e615c6507be40b5cc74f734fba4b4fb80 -- <本计划文件清单>` 并逐个读取集成后的受影响符号。若前置集成改变本计划引用的公共契约、事务、授权、C08 runner 接缝或 C12/C14 结果结构，停止并升级，不凭计划文本覆盖代码事实。

设计决定到实施切片的固定映射：IP-01 → D-11/D-12；IP-02 → D-02/D-05/D-06/D-11；IP-03 → D-02/D-03/D-04/D-07/D-09/D-10；IP-04 → D-07/D-08/D-09/D-11；IP-05 → D-01/D-08/D-09/D-10/D-12；IP-06 → D-04/D-05/D-09/D-10/D-11；IP-07 → D-10/D-11；IP-08 → D-12。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/workflows/index.ts` 的 `IdentificationPreparationSnapshotV1Schema`；C13 已批准五工件 | 只做编译时/fixture 就绪门，消费前置复数字段与 C13 的 C12 输出 | 不在 C15 改公共 Schema，不复制 OCR 私有结构 |
| IP-02 | `packages/core/src/agent-runtime/runtime.ts` 的 `AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry`、`buildCompletedAgentTaskResult`；C12/C14 core Schema | 定义 C15 strict 内部 Schema、逐项校验和确定性可用性收口 | 不复制 C08 状态机、预算算法、C12/C14 事实或 Agent task DTO |
| IP-03 | C04 `ArtifactStoreV1`/guard；C03 `TransactionUnitV1`；C08 `AgentTaskPortV1`、`AgentTaskStoreV1`；C14 `PostgresMonitoringStoreV1` | 组合冻结清单、两个只读工具、正式结果索引与 C08 任务 | 不复制工件存储、命令收据、授权、任务账本、监测算法 |
| IP-04 | `PostgresMigrationProvider` 的递归发现和全局序号约束；现有 C03/C08/C11/C12/C14 PostgreSQL fixture | 使用协调端给 C15 预留号段中的首个序号，增加自动发现的 `000016` 与跨模块集成 fixture | 不修改 provider 或另建迁移注册表 |
| IP-05 | `PostgresEngineeringContextSourceRegistry.freeze()`、`LocalIdentityAccessV1`、现有 module error/Outbox 构造 | 仅分派 `identification-preparation` 并提交 C15 准备事务 | 不复制 `monitoring-snapshot` 分支、HTTP 入口或授权规则 |
| IP-06 | `apps/worker/src/agent-runtime/runner.ts` 的 `AgentRuntimeRunnerOptionsV1.renderModelStep`、`interpretModelStep` 和 runner | 为 `data-cleaning` 增加组合函数，仍运行同一 C08 runner | 不建立第二套 runner、模型网关、任务注册表或预算循环 |
| IP-07 | `apps/api/test/http-shell.test.ts`、现有 C08/C11/C12/C14 回归测试 | 验证通用 API 分派未漂移、直接依赖行为仍成立 | 不新增 C15 HTTP/Web 契约或 UI 文案测试 |
| IP-08 | 根 scripts 与 OpenSpec CLI | 执行最小验证、依赖边界和 change 严格校验 | 不新增脚本或修改全局配置 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置契约与验收夹具 | `识别准备只冻结已收口的可用输入 / 前置复数契约未就绪时禁止实现`；`清洗准备冻结精确文档与监测输入 / OCR 结果复用同一清洗契约` | **新增** `packages/adapters/test/engineering-data/cleaning/fixture.ts`：`createDataCleaningFixture`、四类文档/OCR/地表沉降 builders | 先用类型和 strict parse 证明复数字段存在；fixture 复用 C03/C04/C08/C11/C12/C14 现有构造并能按开关输入 C13 `ocr-layout` | 不加单数字段兼容、Mock 后端或静态复制生产结果 |
| IP-02 | 核心 Schema、校验与收口 | `Agent 增量只能排除既有引用` 全部场景；`业务可用性由确定性策略收口` 全部场景；`版本、幂等与权限支持精确重放 / 输入或策略变化形成新版本` | **新增** `packages/core/src/engineering-data/cleaning/schema.ts`：`DataCleaningPolicyV1Schema`、`CleaningPreparationManifestV1Schema`、`DataCleaningCandidateV1Schema`、`DataCleaningResultV1Schema`；**新增** `packages/core/src/engineering-data/cleaning/service.ts`：`validateDataCleaningCandidate`、`settleDataCleaningCandidate`、`createDataCleaningTaskDefinition`；**新增** `packages/core/src/engineering-data/cleaning/index.ts`；**修改** `packages/core/package.json` 增加 `./engineering-data/cleaning` export；**新增** `packages/core/test/engineering-data/cleaning.test.ts` | strict 判别联合只允许两类引用级排除；逐项验证存在性、证据、原因、重复和保护；按 D-06 算每项/整体三级状态；definition 固定 `embedded/data-cleaning`、content-artifact 结果族和版本引用 | 不允许 Agent 输出最终状态或改值；不重算 C14；不新增公开 contracts 或通用抽象 |
| IP-03 | PostgreSQL 清洗适配与只读工具 | `清洗准备冻结精确文档与监测输入` 全部场景；`data-cleaning 任务只使用版本化只读领域工具` 全部场景；`清洗结果经确定性收口自动生效并完整留痕` 全部场景；`必经 Agent 失败不得静默跳过 / 预算耗尽阻断准备`；`版本、幂等与权限支持精确重放 / 当前资料权限撤销后拒绝消费` | **新增** `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`：`PostgresDataCleaningStore`、`prepareOrReplayTask`、两个 tool executors、`finalizeCandidate`、`readBoundResult`；**新增** `packages/adapters/src/engineering-data/cleaning/index.ts`；**修改** `packages/adapters/package.json` 增加 `./engineering-data/cleaning` export | 按 D-02/D-03 唯一解析成功转换并冻结可选 C14 快照；清单写 C04 后以规范摘要启动/重放 C08；每次工具/收口复验授权与范围；观察工件只含请求切片；finalizer 写内容工件和 C15 只追加结果事实并返回同一 artifact ref | 不选“最新”、不读取冻结外对象、不提供写工具、不把孤儿结果视为完成、不泄露不可枚举资源 |
| IP-04 | 持久化与集成测试 | `清洗结果经确定性收口自动生效并完整留痕 / 工件或业务收口失败不成立结果`；`准备快照、审计和输入就绪事件原子提交 / 审计或 Outbox 失败整体回滚`；`版本、幂等与权限支持精确重放 / 相同准备重放不重复副作用` | **新增** `packages/adapters/src/postgres/migrations/engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.ts`：`up`/`down`；**新增** `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`；**修改** `packages/adapters/test/postgres/postgres-foundation.test.ts` 的生产迁移期望 | 建 `data_cleaning_results`、`identification_preparation_snapshots` 两个只追加表；约束 task/result/manifest/策略/工程身份与 `(project_id,idempotency_key)` 唯一，JSONB 载荷由 strict Schema 复读；测试注入工件、事务、审计/Outbox 故障并证明 provider 自动发现 `000016` | 不回填或覆盖历史、不改既有表/迁移 provider、不把正文/监测值展开为列 |
| IP-05 | C11 冻结收口 | `识别准备只冻结已收口的可用输入` 中“多资料部分可用准备成功”“全部文档不可用时阻断”；`准备快照、审计和输入就绪事件原子提交 / 完整准备可靠发布输入就绪事件`；`必经 Agent 失败不得静默跳过 / 任务仍在运行时不冻结输入`；`版本、幂等与权限支持精确重放` 全部场景 | **修改** `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`：options/field、`freeze()` 分派和 C15 store 调用；IP-04 集成测试覆盖该入口 | `identification-preparation` 先调用 `prepareOrReplayTask`；仅 completed 且 task/result 双向匹配时构造复数集合、排除/覆盖决定；在一个 C03 事务提交 snapshot、receipt、audit、单条 inputs-ready Outbox，返回前复验授权 | 不提前发事件、不把 unavailable 监测写入可消费引用、不影响 monitoring 分支 |
| IP-06 | Worker 接入同一 C08 runner | `必经 Agent 失败不得静默跳过` 全部场景；`data-cleaning 任务只使用版本化只读领域工具 / 越权或越界工具请求被拒绝`；`清洗结果经确定性收口自动生效并完整留痕 / 合格候选自动形成正式清洗结果` | **新增** `apps/worker/src/engineering-data/cleaning/runtime.ts`：`withDataCleaningModelStep`、`interpretDataCleaningModelStep`；**修改** `apps/worker/src/index.ts` 导出组合函数；**新增** `apps/worker/test/engineering-data/cleaning/runtime.test.ts` | 仅对 `taskType === data-cleaning` 构造有界消息和解析 tool-request/candidate；其它类型委派原 callback；协议脚本驱动同一 runner 验证工具→候选→校验→finalize，以及预算/模型/工具失败终态 | 不硬编码自然语言期望、不吞 C08 错误、不换模型/预算、不创建 worker 全局单例 |
| IP-07 | 回归边界 | 所有 Requirement 的公共边界；重点为“关键数值无有害修改”“Agent 失败不得跳过”“四类文档与监测数据形成业务可用结果” | **不修改** `apps/api/test/http-shell.test.ts`、`apps/worker/test/agent-runtime/runner.test.ts`、C11/C12/C14 现有测试 | 运行既有回归，确认 API generic freeze、C08 状态机、C12 转换、C14 样本/特征和 C11 monitoring 分派无漂移 | 不为 C15 增 API/Web 测试文件，不更新 snapshots/文案来掩盖回归 |
| IP-08 | 完成门 | 全部 Requirement/Scenario 与 D-01～D-12 | 本 change 五工件与所有 IP 文件 | 执行格式、类型、lint、定向/回归测试、依赖边界、迁移发现、OpenSpec strict validate；最后运行 apply instructions 检查全部 `contextFiles` 可解析 | 不勾选无证据 task，不归档、不提交 |

## 4. 调用与副作用顺序

### 4.1 首次 `identification-preparation` 冻结（IP-01、IP-03、IP-05）

1. C11 用 `EngineeringFreezeCommandV1Schema` 解析并按 capability、工程、空间和资料引用复验当前授权；前置复数契约不匹配时返回 `UNSUPPORTED_CONTRACT`。
2. C15 校验注入的 `DataCleaningPolicyV1.policyRef` 与命令一致，按命令顺序逐项读取精确 source version；按允许转换策略/质量策略/部署引用筛选成功 C12/C13 记录，要求每项恰好一个。
3. 策略有监测序列时，以命令 `monitoringCutoff`、策略序列和 C14 可用性策略调用 `freezeSnapshot()`；缺 cutoff、版本/范围不符或 C14 失败则结构化阻断，不猜测快照。
4. 生成 canonical manifest，写 C04 内容工件；工件只存引用、版本与授权边界，不存正文/监测值。工件写失败不创建任务。
5. 从规范化命令+策略+精确输入摘要派生 task identity，调用 C08 `startTask()`；相同身份重放原任务，同键异载荷由 C03/C08 返回冲突。
6. C08 未完成时 freeze 返回 `BUSINESS_BLOCKED` 与 `agentTaskRef`；不写识别准备，不发事件。manifest 写成孤儿时内容寻址可去重，不是业务成功。

### 4.2 Worker 工具、候选与清洗结果（IP-02、IP-03、IP-04、IP-06）

1. 同一 `AgentRuntimeRunner` 领取任务、保留预算并调用 data-cleaning renderer；输入只含 manifest 引用与上一观察引用。
2. 模型若请求工具，C08 先校验白名单和预算；工具再复验当前授权、manifest/策略/task 绑定、目标成员及对象上限，按请求读取一个切片，写 C04 观察工件并返回 `effect: none`。任何失败由 C08 记录 action/error/usage 后释放或终止，不扩大范围。
3. 模型提交候选时 strict Schema 先拒绝未知/改值字段；确定性校验逐项输出决定。仅可修复的字段/格式/引用越界可在原修正预算内反馈；权限、来源、版本、保护规则冲突不可通过循环修复。
4. 候选通过后 core 计算保留集和三级可用性；adapter 写正式 result artifact，再通过 C03 事务只追加结果索引和事实审计，返回该 artifact ref。
5. C08 记录 candidate/result 并完成 task。若步骤 4 后 C08 写失败，C15 事实保持孤儿；后续 freeze 的双向绑定检查拒绝消费，C08 按原 task/预算恢复，不重做已确认 tool side effect。

### 4.3 识别准备最终提交（IP-04、IP-05）

1. 重试 freeze 重新解析命令、复验授权并重算相同输入摘要；读取 C08 task，任何非 `completed` 状态、任务失败/取消、版本不匹配或 result ref 不一致都阻断。
2. C15 读取 result artifact 与索引，复验 strict Schema、摘要、清单、策略和输入引用；按命令顺序生成 `includedSourceSegmentSetRefs[]`，并为 unavailable/partial 输入写内容寻址的排除/覆盖决定工件。
3. 如果所有文档 unavailable 或整体门不通过，返回 `BUSINESS_BLOCKED` 并保留已完成清洗事实；不创建空准备。
4. 调用 `TransactionUnitV1.execute()` 一次提交 preparation snapshot、C03 receipt、audit 和一条 `engineering.inputs-ready.v1` Outbox。任一 SQL/audit/outbox 失败由事务整体回滚，决定工件可成为不可消费孤儿。
5. 事务成功后再复验当前授权并读取 snapshot；返回成功。相同命令重放 C03 receipt 和既有 snapshot/event，不重复副作用；同键异载荷冲突。

### 4.4 失败、权限与可观测性（IP-03～IP-06）

- `UNSUPPORTED_CONTRACT`：strict 输入或前置契约版本不兼容，不可重试。
- `AUTHORIZATION_DENIED`：当前工程/空间/资料授权失败；不存在与未授权同形，不读取目标内容。
- `BUSINESS_BLOCKED`：转换缺失/歧义、监测准备失败、任务未完成、覆盖不足；返回稳定 blocker ref。
- `IDEMPOTENCY_CONFLICT`：同作用域幂等键载荷不同，不可重试。
- `TRANSIENT_FAILURE`：C04/PostgreSQL/可恢复执行故障；沿用同 task、action key 和累计预算。
- `TERMINAL_FAILURE`：不可恢复任务终态或已提交事实无法复读；禁止 fallback。
- C08 保存原始模型响应、工具行动、候选版本、验证和预算；C15 审计保存输入/策略/result/preparation 引用和稳定结果，不保存思维链。日志只写引用和原因码，不写正文或监测值。

## 5. Schema、状态与持久化落实

### 5.1 内部 Schema（IP-02）

- 所有内部对象使用 Zod strict Schema、`schemaVersion: "1"` 和 contracts 已有 reference/authorization Schema；`sourceVersionRefs[]` 与 `includedSourceSegmentSetRefs[]` 顺序一致且长度相等。
- `DataCleaningCandidateV1` 不含可用性或替换值；监测排除用精确 sample version ref，文档排除用 C11 `SourceSegmentIdV1Schema`。
- `DataCleaningResultV1` 是清洗业务载荷 SSOT；数据库 JSONB 和 C04 内容都必须反向 parse 同一 Schema，代码不得另定义字段。

### 5.2 状态（IP-03、IP-05、IP-06）

- 业务阶段只有：无 task → C08 task 非终态 → C08 failed/cancelled（阻断）或 completed + bound C15 result → preparation committed。
- Agent 状态、租约、动作、候选、预算与修正完全复用 C08；C15 不增加平行状态机。
- 清洗结果自动生效的判据是 `task.status === completed`、C08 primary ref、C15 result artifact/index 三方相等；单独存在任一方不成立。

### 5.3 PostgreSQL（IP-04）

- `business.data_cleaning_results`：复合主身份、`project_id`、`agent_task_ref`、`manifest_artifact_ref`、`result_artifact_ref`、`policy_ref`、`overall_availability`、`result_payload`、`created_at`、`audit_entry_id`；task/result/manifest 唯一约束，状态 check 约束。
- `business.identification_preparation_snapshots`：snapshot ref/version、`project_id`、`command_id`、`idempotency_key`、`payload_hash`、`agent_task_ref`、`cleaning_result_artifact_ref`、`snapshot_payload`、`created_at`、`audit_entry_id`；命令和 `(project_id,idempotency_key)` 唯一约束。
- 排除/覆盖决定为 C04 内容工件，snapshot 保存 contracts route decision refs；正文、原始 Agent 响应和监测值不入两表。
- `000016` 由现有 provider 自动发现；`up` 建表/约束/索引，`down` 仅按逆依赖顺序删除本迁移新表，生产回滚不执行 down 并保留审计事实。

### 5.4 文件所有权与无变更面（IP-01～IP-08）

新增 11 个文件：3 个 core 生产文件、1 个 core 测试、2 个 adapter 生产文件、1 个迁移、2 个 adapter 测试/fixture、1 个 worker 生产文件、1 个 worker 测试。修改 5 个文件：两个包 manifest、C11 registry、worker root export、PostgreSQL 迁移发现回归测试。删除 0 个文件。API/Web 只有回归验证，无文件变更。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 清洗准备冻结精确文档与监测输入 / 四类结构化文档与地表沉降快照进入同一准备 | IP-01、IP-03 | adapter cleaning test | DOCX/text-PDF/XLSX/CSV 成功转换 + settlement snapshot | 一个 manifest 按序含四组转换/JSON-LD/segment-set 和精确 snapshot ref；无正文/值 | `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` |
| 同 Requirement / OCR 结果复用同一清洗契约 | IP-01、IP-03 | adapter cleaning test | C13 `ocr-layout` record（C13 归档后） | 与其它 inputKind 同路由，页/版面/置信度证据可读且无 PaddleX 私有字段 | 同上 |
| 同 Requirement / 输入版本不完整或不一致时拒绝准备 | IP-03 | adapter cleaning test | 缺失/双重转换、错工程 snapshot、错策略 | task 数为 0；稳定 blocked/stale/auth error | 同上 |
| data-cleaning 任务只使用版本化只读领域工具 / 读取获准的文档资料段切片 | IP-03、IP-06 | worker cleaning test | manifest 内 2 个 segment | observation 只含请求成员；`effect:none`；usage 计数正确 | `pnpm exec vitest run apps/worker/test/engineering-data/cleaning/runtime.test.ts` |
| 同 Requirement / 读取获准的监测快照切片 | IP-03、IP-06 | worker cleaning test | snapshot 成员/对齐点/四特征 | 值、单位、状态、特征与 C14 原值深相等，无重算 | 同上 |
| 同 Requirement / 越权或越界工具请求被拒绝 | IP-03、IP-06 | worker + adapter cleaning tests | 冻结外 ref、对象超限、撤销授权 | C08 记录稳定 tool/budget/auth failure；无目标读取/扩容 | `pnpm exec vitest run apps/worker/test/engineering-data/cleaning/runtime.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` |
| Agent 增量只能排除既有引用 / 合法引用级排除进入确定性校验 | IP-02 | core cleaning test | 文档/监测合法排除表 | 每项 accepted/rejected 及证据稳定，输入不变 | `pnpm exec vitest run packages/core/test/engineering-data/cleaning.test.ts` |
| 同 Requirement / 正文或数值修改整体拒绝 | IP-02 | core cleaning test | 额外 text/value/path/unknown 字段 | strict parse 失败且不转为 exclusion | 同上 |
| 同 Requirement / 受保护关键数值不能通过排除消失 | IP-02 | core cleaning test | 关键表格值和受保护 settlement sample | 不可修复拒绝；拆分/换 reason 仍拒绝 | 同上 |
| 业务可用性由确定性策略收口 / 保留子集达到部分可用门槛 | IP-02 | core cleaning test | 有接受排除、覆盖仍达门 | input/overall 为 partial，保留/排除精确 | 同上 |
| 同 Requirement / 无排除且全部门槛通过 | IP-02 | core cleaning test | 完整基线，无排除 | available 且引用原输入 | 同上 |
| 同 Requirement / 低于最低门槛时不可用 | IP-02 | core cleaning test | 低覆盖/缺结构/C14 unavailable/保护失败表 | unavailable，原因稳定，无默认值 | 同上 |
| 清洗结果经确定性收口自动生效并完整留痕 / 合格候选自动形成正式清洗结果 | IP-03、IP-04、IP-06 | worker + adapter cleaning tests | 合格 candidate | C04 result、C15 index、C08 completed 三方绑定；无人工任务 | `pnpm exec vitest run apps/worker/test/engineering-data/cleaning/runtime.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` |
| 同 Requirement / 工件或业务收口失败不成立结果 | IP-03、IP-04 | adapter cleaning test | artifact/transaction failure latch | 无可消费 bound result；已成立诊断可复读 | adapter 定向命令 |
| 必经 Agent 失败不得静默跳过 / 预算耗尽阻断准备 | IP-03、IP-05、IP-06 | worker + adapter cleaning tests | 每类 C08 budget 达上限 | task failed、freeze blocked；无 prep/event/fallback | worker + adapter 联合命令 |
| 同 Requirement / 任务仍在运行时不冻结输入 | IP-05 | adapter cleaning test | queued/running task | blocked 指同 task；prep/outbox 计数 0 | adapter 定向命令 |
| 同 Requirement / 失败重试沿用冻结任务 | IP-03、IP-06 | worker + adapter cleaning tests | 可恢复 tool/store failure | task/input/policy/action key 不变，累计 usage 不重置，无重复结果 | worker + adapter 联合命令 |
| 识别准备只冻结已收口的可用输入 / 多资料部分可用准备成功 | IP-05 | adapter cleaning test | 四资料结果，至少一 partial，整体达门 | source 与 plural sets 同序一一对应；排除 refs/coverage/result refs 完整 | adapter 定向命令 |
| 同 Requirement / 全部文档不可用时阻断 | IP-05 | adapter cleaning test | 全部 unavailable | blocked；无 snapshot/event | adapter 定向命令 |
| 同 Requirement / 前置复数契约未就绪时禁止实现 | IP-01 | fixture compile + contracts regression | 前置 change 已归档 | plural parse/类型通过；无 C15 contracts diff | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` |
| 准备快照、审计和输入就绪事件原子提交 / 完整准备可靠发布输入就绪事件 | IP-04、IP-05 | adapter cleaning test | completed bound result | 一个事务、一个 snapshot/audit/receipt/event；event 仅含 prep ref | adapter 定向命令 |
| 同 Requirement / 审计或 Outbox 失败整体回滚 | IP-04、IP-05 | adapter cleaning test | audit/outbox failure latch | snapshot/receipt/event 全为 0；result 不变可重试 | adapter 定向命令 |
| 版本、幂等与权限支持精确重放 / 相同准备重放不重复副作用 | IP-03～IP-05 | adapter cleaning test | 同 command/idempotency/payload 两次 | refs 相等；task/model/tool/result/audit/event 计数不增 | adapter 定向命令 |
| 同 Requirement / 输入或策略变化形成新版本 | IP-02～IP-04 | core + adapter cleaning tests | 改任一 frozen ref | 新 task/result；旧结果不变 | core + adapter 联合命令 |
| 同 Requirement / 当前资料权限撤销后拒绝消费 | IP-03、IP-05 | adapter cleaning test | task 后撤销，分别触发 tool/final freeze | 不可枚举 auth error；不读取/不提交/不泄露 | adapter 定向命令 |
| 全量公共/依赖回归 | IP-07 | 既有 contracts/C08/C11/C12/C14/PostgreSQL/API tests | 当前仓库 fixture | 公共解析、runner、迁移发现、转换、监测、generic HTTP freeze 不漂移 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/agent-runtime/runner.test.ts packages/core/test/engineering-data/context-source.test.ts packages/core/test/engineering-data/document-conversion.test.ts packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts apps/api/test/http-shell.test.ts` |
| 所有计划文件、依赖与 OpenSpec 完成门 | IP-08 | 全部 | 前述定向测试通过 | type/lint/format/deps/migration/OpenSpec 全通过，apply contextFiles 完整 | 见 7.3 命令组 |

## 7. 文件清单与升级条件

### 7.1 文件 allowlist

**新增（IP 所有权）：**

- IP-01：`packages/adapters/test/engineering-data/cleaning/fixture.ts`
- IP-02：`packages/core/src/engineering-data/cleaning/schema.ts`、`packages/core/src/engineering-data/cleaning/service.ts`、`packages/core/src/engineering-data/cleaning/index.ts`、`packages/core/test/engineering-data/cleaning.test.ts`
- IP-03：`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`、`packages/adapters/src/engineering-data/cleaning/index.ts`
- IP-04：`packages/adapters/src/postgres/migrations/engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.ts`；`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`
- IP-06：`apps/worker/src/engineering-data/cleaning/runtime.ts`；`apps/worker/test/engineering-data/cleaning/runtime.test.ts`

**修改（IP 所有权）：**

- IP-02：`packages/core/package.json`
- IP-03：`packages/adapters/package.json`
- IP-05：`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`
- IP-06：`apps/worker/src/index.ts`
- IP-04：`packages/adapters/test/postgres/postgres-foundation.test.ts`

**删除：**无。

**只读回归：**IP-07 矩阵列出的现有 tests 与其生产实现。

**保护区：**`packages/contracts/**`、根 `package.json`/workspace、`pnpm-lock.yaml`、`openspec/config.yaml`、`apps/api/src/**`、`apps/web/src/**`、C13 worktree、其它 change、迁移 provider/runner、中央运行时注册文件。

### 7.2 具体升级条件

遇到以下任一条件立即 ask/escalation，不继续落地：

1. 前置复数契约 change 未归档、字段名/基数不同，或要求 C15 修改 contracts。
2. C13 尚未归档/集成、归档输出不再是 C12 `ocr-layout` 成功 conversion + JSON-LD + segment set，或需要读取 PaddleX 私有响应。
3. 集成后 C08 缺少 strict definition/tool/finalizer 接缝，C03 无法包住 snapshot+audit+outbox，或 C11/C12/C14 所有权要求跨 change 修改公共接口。
4. 同 source version 经冻结策略过滤后允许多条成功 conversion，而业务方要求非“阻断”的选择规则。
5. 需要新公共 Schema、迁移既有数据、改变授权/事务/错误语义、增 API/Web、修改保护区或新增依赖。
6. 协调端预留的 C15 号段 `000016–000019` 与集成分支冲突，或任何计划命令在实现时不存在。
7. 测试只能通过 Mock 后端、默认 fallback、占位实现、降低审计或忽略用户未提交改动。

### 7.3 已核实存在的可运行命令（IP-08）

当前 worktree 已确认 Node `v24.12.0`、pnpm `11.10.0`、Vitest `4.1.11`、Prettier `3.9.6`、ESLint `10.9.1`、OpenSpec `1.13.0`，根 scripts 含以下命令：

```bash
pnpm exec vitest run packages/core/test/engineering-data/cleaning.test.ts
pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts
pnpm exec vitest run apps/worker/test/engineering-data/cleaning/runtime.test.ts
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/agent-runtime/runner.test.ts packages/core/test/engineering-data/context-source.test.ts packages/core/test/engineering-data/document-conversion.test.ts packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts apps/api/test/http-shell.test.ts
pnpm typecheck
pnpm lint
pnpm exec prettier --check packages/core/src/engineering-data/cleaning packages/core/test/engineering-data/cleaning.test.ts packages/adapters/src/engineering-data/cleaning packages/adapters/test/engineering-data/cleaning apps/worker/src/engineering-data/cleaning apps/worker/test/engineering-data/cleaning
pnpm deps:check
pnpm deps:policy
pnpm test
openspec validate deliver-agent-cleaning-and-partial-availability --type change --strict --no-interactive
openspec instructions apply --change deliver-agent-cleaning-and-partial-availability --json
git diff --check
git diff --name-only 5c49f20e615c6507be40b5cc74f734fba4b4fb80
```

定向测试先于全量 `pnpm test`；只有代码、行为和证据完成后才勾选对应 task。最终只交 `openspec-verify-change` 验证，不在本 change 的 apply 阶段归档或提交。
