# Implementation Plan

## 1. 实施基线与权威来源

- 初始规划 base commit：`1e51bec508ddad8e2ccdd5af9a9d17b593458af9`；本次修补核对的实现检查点：`e3172c6ff65b8ba4a75e8f794626cc53d410d606`。继续实现前执行 `git rev-parse HEAD`，并用 `git diff --name-only e3172c6ff65b8ba4a75e8f794626cc53d410d606 -- <本计划允许文件>` 复读修补范围。计划依据是本 change 工件、已归档主 specs、C08/C16/C17 当前代码、已归档 `evolve-identification-basis-published-event` D-04、独立 C15 drift change 和待归档的 C08 失败证据窄读前置 change；技术事实只使用 `references/风险识别与评估规划事实源摘要.md`。
- schemaName 已由 `openspec status --change deliver-process-model-mechanism-and-evidence-governance --json` 确认为 `riskflow-delivery`。
- D-01 硬门：集成后 contracts 能解析 `standard-library`/`case-library`；独立 C15 drift change 已归档，`PostgresDataCleaningStore.readExactPreparation(input: IdentificationPreparationReadRequestV1): Promise<IdentificationPreparationReadResultV1>` 能按精确准备引用返回 strict `snapshot/agentTaskRef/result/resultArtifactRef`，且 `coverageDecisionRef`、`excludedSegmentDecisionRefs[]` 均 strict parse 为 `route-decision`；`implement-engineering-data-read-branches` 已实现 D-04 的 C02 资料段/证据公共读取；独立 C08 change 已提供 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()`；C16 与复数 `includedSourceSegmentSetRefs` 均已归档集成。实施 Agent 只验证和消费，不修改 C08/C15/contracts；任一门失败立即升级。
- 协调裁决：C17 迁移号段 `000020`～`000023`，实际仅使用 `000020`；`identificationPolicySetRef` 归 C21/C24，C17 通过注入 provider 精确读取并在缺失时 fail-closed；C16 获准修改 resolver 分支及已归档事件 D-04 指定的发布/回滚 transaction policy 接缝，其它生命周期语义不变。
- 当前已核实命令工具：Node `24.12.0`、pnpm `11.10.0`、OpenSpec `1.13.0`、Vitest `4.1.11`、TypeScript `5.9.3`、ESLint `10.9.1`、Prettier `3.9.6`、dependency-cruiser `17.1.0`。不安装或升级依赖。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/vocabulary/index.ts` 的五工序、六机理、四关系及设备/参数/指标 Schema；`packages/contracts/src/workflows/index.ts` 的 `IdentificationPreparationSnapshotV1Schema` | 只通过公共导出构造验收 fixture，证明复数字段和新增定义类型可 strict parse | 不复制枚举、准备快照或公共引用 Schema |
| IP-01、IP-05、IP-06 | C15 `PostgresDataCleaningStore.readExactPreparation`；C02 `EngineeringDataPortV1.read` 与 adapter `resolveReadQuery`；C04 `ArtifactStoreV1.open` | `IdentificationPreparationNarrowReadV1` 注入 `preparationRead/engineeringData`，`PostgresIdentificationPreparationKnowledgeReader` 以 `requestId` 内部签发授权并组合 strict 精确准备、`queryResultRef`、切片和证据资格 | 不读 C15/C11 表、不保留测试 payload view、不向 reader 伪造不存在的 `authorization` 参数 |
| IP-02 | `packages/core/src/agent-runtime/runtime.ts` 的 `AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry`；`schema.ts` 的 validation/result DTO | 注册现有 `knowledge-authoring` 严格定义并返回逐项 validation | 不复制状态机、预算、候选或结果族 |
| IP-02、IP-03、IP-05、IP-06 | C18 `AssessmentConfigurationGovernancePolicyV1.appendRelease(context, input)`；C16 `PostgresKnowledgeGovernanceAdapter.govern()`、`resolveGovernedReleases()`、`#appendIdentificationKnowledgeRelease()`、现有 `reviewAuthorization/approvalAuthorization` | 按同一 transaction policy 形状接入 C17 release binding/event；把两个可选授权回调收口为新增 `KnowledgeGovernanceReviewAuthorizationProviderV1.authorize()`，由 C16 生成精确任务 DTO | 不复制 C16 表/规则，不用内存 recorder、发布后补写 binding 或私有内联授权 |
| IP-04～IP-07 | C03 `TransactionUnitV1`、命令收据/审计；C04 `ArtifactStoreV1`/`ArtifactReferenceGuardV1`；C07 `ReviewAuditPortV1` | 工件先耐久，C17 索引/收据事务提交，审核经 C16→C07 | 不建平行工件仓库、审计表或 review 状态 |
| IP-07、IP-08 | C15 `createPostgresDataCleaningComposition()` 的 C06 受信来源模式；`AgentRuntimeRunner` callback 接缝；前置 C08 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()` | C17 组合根按 exact branch 签发工具/start/submit/review 授权；失败收口只按 C17 attempt 的 task ref 调 C08 reader；模块 runner 包装一次 shared `runOnce()` | 不注入 `AgentTaskStoreV1`，不调用 `PostgresAgentTaskAdapter.getTask()`，不复制 C08 查询、claim、租约、预算、模型循环、重试和恢复 |
| IP-06 | C02 `KnowledgeResolutionCommandV1Schema`/`KnowledgeResolutionSuccessV1Schema`；注入的 `IdentificationPolicySetProviderV1` | 按 public 四字段返回识别基础，策略引用由 C21/C24 provider 提供 | 不定义识别策略内容、默认引用或治理类型 |
| IP-05、IP-09 | `apps/api/src/http.ts` 的 generic knowledge/agent 路由 | 生产组合注入 C17 façade；只跑现有路由回归 | 不新增 C17 URL、请求 Schema 或 Web 页面 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置门与契约夹具 | `识别知识包使用独立稳定定义身份`、`证据可达性和关键工序覆盖由确定性策略收口`、`识别基础按准备快照和双时间精确解析`、`失败收口只读取精确任务证据` 的全部前置场景 | **修改** `packages/adapters/test/identification-knowledge/fixture.ts`：`startIdentificationKnowledgeFixture`、五类 builders、真实 C03/C04/C06/C07/C08/C16/C15/C02 read 组合 | 先运行 C15 `readExactPreparation()` 与 C08 `readTerminalFailure()` 的公共窄读行为测试；fixture 只消费这两个公开 reader，任何不成功分支用 narrowing helper 抛错 | 不在 C17 修 C08/C15，不以私有 SQL、`getTask()`、宽松 payload view 或 fake production store 代替上游 |
| IP-02 | 核心 Schema、关系/覆盖校验、Agent 定义与发布 policy 契约 | 工序、机理、规范/案例、证据/覆盖、同一事实模型、类型化增量、工具成员范围和原子发布场景 | **修改** `packages/core/src/identification-knowledge/schema.ts`：manifest 冻结正式准备/清洗/成员；**修改** `service.ts`：既有校验/增量/任务定义，并以接收 `TransactionContextV1` 的 `IdentificationKnowledgeGovernancePolicyV1.appendRelease(context, input)` 替换无事务 release policy；**修改** core test | 保留既有确定性校验；C08 metadata 只列两个工具，manifest 成为对象成员 SSOT；发布 policy 接缝与 C18 形状一致，使 adapter 能在 C16 transaction 内写 binding/event | 不新增公共 contracts、第二枚举源、通用 policy registry、提示词全文断言或无事务事件 recorder |
| IP-03 | C16 resolver、发布事务与 C07 授权接缝修正 | 评估解析保持不变、识别/交叉权限失败、组合发布绑定与事件原子成立、发布与回滚使用精确批准证明授权 | **修改** `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：`#knowledgeResolutionBranch()`、`PostgresKnowledgeGovernanceAdapterOptionsV1.identificationKnowledgePolicy`、`#appendIdentificationKnowledgeRelease(context, input)`；**新增于同文件** `KnowledgeGovernanceReviewAuthorizationRequestV1`、`KnowledgeGovernanceReviewAuthorizationProviderV1`，options 改为 `reviewAuthorizationProvider?`；**修改** C16 adapter test | 按 D-06 映射 resolver；在 `#publish`/`#rollback` transaction callback 把同一 context 传给 C17 policy；C16 为 request-review/approval-proof 生成精确 DTO，provider 返回上下文后复验 project/actor/invocation/唯一 capability 再调用 C07 | 不改 C02 公共输入/输出、C16 表/迁移、currentRelease/base 语义、选择/时间/停用语义或评估 policy 行为 |
| IP-04 | C17 只追加持久化 | 幂等/事务/绑定/失败复核场景 | **新增** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.ts`：`up`/`down`；**修改** `packages/adapters/test/postgres/postgres-foundation.test.ts` 的递归发现期望 | 按 D-07 建四表、唯一/check/本模块外键、app 写和 worker/checkpointer 最小权限；down 仅空表可执行；证明 provider 自动发现 | 不改 migration provider/中央清单、既有表、既有迁移或使用 `000021`～`000023` |
| IP-05 | C17 façade、正式准备 reader、审核包导入和原子发布 policy | 独立身份、同一事实模型、生命周期、人类发布、下游窄读、原子事件和事务失败场景 | **修改** `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`：`PostgresIdentificationPreparationKnowledgeReader`、`PostgresIdentificationKnowledgeReleasePolicy.appendRelease`、`PostgresIdentificationKnowledgeAdapter.govern/readExact` 及 binding helpers；**修改** adapter test/fixture | 正式 reader 只组合 C15 public reader、C02 read/resolve 和 C04；policy 在 C16 context 内复验 validated binding/package，写 release binding，组合发布再构造五引用事件；删除 `IdentificationKnowledgeReleaseEventRecorder` 和 façade 发布后 `#bindRelease`。测试为 publish/rollback 注入 binding、member、event、outbox 故障并断言全部回滚 | 不暴露裸 C16，不读取 C15/C11 私表，不复制生命周期，不解释评估包，不新增列表/搜索/最新读取 |
| IP-06 | 三发布组合与 public identification-basis | 组合全部场景、识别基础成功/失败、证据授权撤销、provider 缺失关闭失败 | **修改** 同一 adapter/test 文件：`#resolveIdentificationBasis()`、`resolve()`、组合成员 reader；复用 core `IdentificationPolicySetProviderV1` | 按 D-10 顺序使用正式准备 reader、解析三主发布和 composite 三成员、复验机理一致、调用策略 provider，映射四个 public typed refs；provider 未注入/无精确引用只阻断该 resolve；非 identification resolve/retrieve 保持当前 `UNSUPPORTED_CONTRACT` | 不返回半套结果、不硬编码策略、不实现 C20 检索、不把 `issuedAt` 换成数据库当前时间 |
| IP-07 | C08 编制准备、工具成员校验、finalizer 与失败复核状态收口 | 有界任务、工具成员、逐项增量、合格修订、预算/模型/工具/恢复/取消失败复核、失败收口只读取精确任务证据及幂等场景 | **修改** C17 adapter/test：`prepareOrReplayAuthoringTask()`、`#readSegmentSliceTool()`、`#readExactKnowledgeTool()`、`#finalizeAuthoringCandidate()`、`settleAuthoringFailures()`/`#settleOneFailure()`；options 以 `agentTaskFailureEvidenceReader: AgentTaskFailureEvidenceReaderV1` 替换 `agentTaskStore?: AgentTaskStoreV1` | manifest 冻结正式准备成员；失败收口以新鲜 C08 read 授权调用 `readTerminalFailure()`，把返回的 error/cancel/usage/action/candidate/validation 引用写入诊断；窄读或授权失败返回可验错误，不 catch 静默跳过。submit/review 各用 exact branch，重放只 CAS 到 `completed | review-linked` | 不调用 C08 `getTask()`、不使用 optional 授权回调或 task-envelope fallback、不吞异常计为 settled、不在 retryable 状态提前复核 |
| IP-08 | Worker 生产组合与 shared runner | 生产组合依赖/授权关闭失败、有界任务/增量/失败复核和 C16→C07 精确授权场景 | **修改** `apps/worker/src/identification-knowledge/composition.ts`：`createPostgresIdentificationKnowledgeComposition()`、`PostgresIdentificationKnowledgeCompositionOptionsV1`、受信 human/system 来源、exact branch C06 authorize、C07/C08/C15/C16/C17 组装；**修改** composition test | options 必须注入前置 C08 `agentTaskFailureEvidenceReader`；以对象实现 `KnowledgeGovernanceReviewAuthorizationProviderV1` 并注入 C16，删除 `reviewAuthorization/approvalAuthorization` 两个内联闭包；缺失依赖拒绝构造，授权拒绝零 C08/C07 读取 | 不修改 generic runner、不创建 provider registry/单例、不接受预制 AuthorizationContext、不用 `agentTaskAdapter.getTask()` 代替 reader |
| IP-09 | API/Worker/Web 与依赖回归 | 所有 public/跨模块边界 | **不修改** `apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts`、`apps/worker/src/agent-runtime/runner.ts`、`apps/worker/test/agent-runtime/runner.test.ts`、`apps/web/**`、contracts/C15/C11 文件 | 运行现有 generic route、runner、contracts、C11/C15、C16 回归；确认无新增 URL/Web、无依赖和跨表读取 | 不通过改测试、snapshot 或文案掩盖漂移 |
| IP-10 | 最小全量验证与 OpenSpec 完成门 | 每个 Requirement/Scenario、每个计划文件和验证义务 | **不新增生产文件**；只更新 `tasks.md` 勾选证据 | 执行 V-01～V-10；检查文件 allowlist、IP 反向映射、apply `contextFiles` 全读和 strict validate | 不提交、不归档、不启动开发服务器 |

## 4. 调用与副作用顺序

### 4.1 审核包导入、送审与发布（IP-02、IP-04、IP-05）

1. Façade strict parse public command，先校验工程/actor/branch authorization；对 C17 type 以 C04 `open()` 读取精确候选，验证 manifest/ref/digest，调用 D-04 检查准备和证据。
2. Core 按 D-03 产生逐项 validation；adapter 先写 C04 validation artifact，再用派生 `:validation` 键在 C03 事务写 validation、receipt、audit、零事件。拒绝直接返回 `BUSINESS_BLOCKED`，数据库和错误不含正文。
3. 合格 validation 用派生 `:c16-submit` 键调用 C16。C16 失败不建 binding；重试先读 C17 receipt，再由 C16 自身幂等返回原 revision。
4. 用 `:bind-revision` 事务追加 validated binding；只有 binding 成功后 façade 才把 revision 返回调用方。送审继续委派 C16→C07。
5. publish/rollback 前 façade 只确认 validated/historical binding 后调用 C16。C16 在自己的 transaction callback 内依次写 C16 release、调用 C17 policy；policy 使用同一 context 复验 binding/package 和当前授权并写 C17 release binding。四类成员返回 `events: []`；组合包再解析三个成员及机理引用的工序发布，strict 构造 `knowledge.identification-basis-published.v1`。C03 在同一事务写事实审计、命令回执和 Outbox 后才提交并返回 release。
6. binding/member/event/audit/receipt/Outbox 任一步失败抛出并回滚 C16 release 与 C17 binding；同命令重放返回同一 release/binding/event。不得在 façade 返回后补绑定、用内存 recorder 预登记或发布后补发事件。

### 4.2 identification-basis（IP-03、IP-05、IP-06）

1. 解析 command 并以 `requiredAt`/`issuedAt` 固定双时间；`PostgresIdentificationPreparationKnowledgeReader.readExactPreparation()` 在任何知识读取前调用 C15 public `PostgresDataCleaningStore.readExactPreparation()`，strict parse preparation 和 route decisions，并复验当前资料权限。reader 不存在或返回非 strict 结果立即失败。
2. C16 resolver 通过 IP-03 选择 `knowledge-modeling.identification-basis`，只查工程及三个主类型；C17 `readExact` 打开 composite 并再次调用 resolver 校验其三成员，要求机理 ref 与主结果相等。
3. 调用 C21/C24 provider 取得精确 policy set ref；映射 C16 refs 为 Process/RiskMechanism/Retrieval typed refs并 strict parse public success。
4. 任一步缺失、未生效、停用、错工程/类型、授权撤销、策略空缺均映射为现有 ModuleError；不执行后续读取、不返回部分结果、不 fallback。

### 4.3 Agent 编制与成功收口（IP-02、IP-05、IP-07、IP-08）

1. `prepareOrReplayAuthoringTask` 复验 D-04 strict preparation 和可选 baseline；把 cleaning result、同序 source/segment-set、route decisions 和 exact baseline 冻结进 manifest。先写 C04，再由组合根经 C06 签发 `agent-task.start-task`，C08 启动成功后 C03 写 attempt/receipt/audit；授权或 task port 缺失不启动。
2. `KnowledgeAuthoringRunner` 调用 shared runner；model callback 只渲染 manifest refs/有界观察。tool request 先经 C08 registry/预算校验 tool ref，再由 C17 校验 requested set/segment 或 baseline type/release 属于 manifest，最后用组合根为对应 exact read branch 新签发的 C06 上下文调用 D-04 或 `readExact`。任一成员/授权失败不触达目标读取。
3. candidate 是封闭操作数组；C08 parse action/increment/candidate，core 逐项 validation。repairable rejection 保留在同一 task/ledger；terminal rejection 不循环。
4. 全部通过后 finalizer 将操作应用冻结 baseline，完整复验 package，写 C04 candidate；组合根为稳定 submit 身份签发 `knowledge-modeling.submit-revision` 后走 4.1 得到 revision。C08 确认 result family/task ref 后记录 candidate/action/完成终态；不得回退任务信封 authorization。

### 4.4 Agent 失败、恢复与人工复核（IP-04、IP-07、IP-08）

1. generic runner 先按 C08 处理 lease、重试、预算和终态；模块 settlement 仅查询 C17 pending attempt 的 task ref，并以 `expectedTaskType: "knowledge-authoring"` 和新鲜 `agent-task.read-failure-evidence` 授权调用 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()`；不注入或调用 `AgentTaskStoreV1.getTask()`。
2. `retryable-failure` 不收口；`terminal-failure | cancelled` 且无正式 result 时，先写 failure diagnostic artifact，再由组合根为 `:failure-revision` 签发独立 `knowledge-modeling.submit-revision` 上下文，调用 C16 并写 `failure-review-only` binding，CAS 到 `failure-revision-bound`。
3. 组合根为 `:failure-review` 签发 `knowledge-modeling.request-review`；C16 用 `KnowledgeGovernanceReviewAuthorizationProviderV1.authorize()` 的 `request-review` DTO 取得 `review-audit.request-review` 上下文。成功后事务绑定 review ref 并 CAS 到 `review-linked`。任一授权/调用失败保留前一步稳定事实和原因；下一次只补未完成阶段，未创建 review 不计 settled。
4. Façade publish 永久拒绝 failure binding。人工只能依据 review 决定补资料、启动新幂等 task 或结束；旧 task、预算、诊断和 review 均保留。

## 5. Schema、状态与持久化落实

- **Schema SSOT（IP-02）**：五类 package、policy、manifest、increment、validation/binding/failure 全部在 core C17 子模块；公共 refs/枚举只 import contracts。`KnowledgeAuthoringIncrementV1` 按 `definitionType`+`operation` 双层判别，退役必须指向 baseline 条目并带原因/证据。
- **关系和覆盖（IP-02）**：包内 ID 唯一；边端点存在、自指/重复拒绝；只对时间先后边做拓扑环检查；五工序、六机理由 contracts 集合差验证；critical kinds/最小覆盖从精确 policy 对象读取。
- **状态（IP-04、IP-07）**：validation 为 accepted/rejected；revision binding 为 validated/failure-review-only；attempt 只允许 `prepared → task-started → completed` 或 `prepared | task-started → failure-revision-bound → review-linked`，逐阶段 CAS 前进。授权或 C07/C16 失败停在最后成立阶段并记录原因，未拿到 review ref 不计 settled。C08/C16/C07 状态仍为各自 SSOT。
- **持久化（IP-04）**：`000020` 四表均带 project、完整版本引用、digest、command/idempotency、authorization/audit 和 occurred/recorded/persisted 时间；正文只在 C04。外部 ref 由 `ArtifactReferenceGuardV1`/领域端口复验，不对其它模块私有表建耦合外键。
- **权限（IP-03、IP-05～IP-08）**：组合根只接受 C06 支持的 human-session 或同 causal run system parent 来源，并为每个稳定 invocation 单独 authorize。govern/resolver 使用准确 knowledge branch；D-04 使用 exact engineering read；baseline reader 使用 identification-basis；C08 启动使用 `agent-task.start-task`，失败证据读取使用前置 change 的 `agent-task.read-failure-evidence`；C16 通过 `KnowledgeGovernanceReviewAuthorizationProviderV1` 请求 C07 request/approval-proof。复验 actor/project/invocation/唯一 capability/空间/来源，不接受预制上下文或 task-envelope fallback；发布/停用/回滚仍由 C16 验证 human invocation。
- **幂等/事务（IP-04、IP-05、IP-07）**：外层 key 加稳定阶段后缀；同 key 不同规范摘要冲突。非发布阶段各用一个 C03 事务，跨 C16/C07 使用阶段 latch 恢复；artifact 成功但事务失败只留不可消费孤儿。发布/回滚由 C16 单个事务原子提交 release、C17 binding、审计、回执和事件。
- **审计/可观测（IP-04～IP-08）**：记录 package/manifest/validation/task/revision/release/review refs、每项原因、策略/模型/提示/工具/预算 refs 和 usage；四类成员发布零识别基础事件，组合发布/回滚恰有一个事件。测试不得用 `return` 早退掩盖失败分支，必须断言最终 binding/state/audit/receipt/outbox 计数。日志不写正文、模型响应、凭据或内部错误。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 独立稳定定义身份 / 五类知识独立演进 | IP-01、IP-04、IP-05 | adapter C17 test | 五类首修订及三类后续修订 | 五稳定 identity；各自 base/release；无互相改写 | V-03 |
| 同 Requirement / 未声明字段和错类型内容被拒绝 | IP-02、IP-05 | core + adapter C17 tests | unknown field/错工程/错 type 表 | strict/validation failed；无 C16 revision/binding | V-02、V-03 |
| 工序模型覆盖必含工序与可执行关系 / 完整工序模型通过结构校验 | IP-02 | core C17 test | 五工序、四关系代表边 | accepted；关系/覆盖决定可复读 | V-02 |
| 同 Requirement / 缺失工序或关系不一致被拒绝 | IP-02 | core C17 test | 缺一工序、未知端点/自指/重复/时间环参数表 | 对应 check rejected/reason；无 final package | V-02 |
| 风险机理库覆盖六类机理并连接工序证据 / 六类机理形成闭合关系 | IP-02、IP-05 | core + adapter C17 tests | 六机理连接同工程 process release | 六类齐全；每项 process/parameter/indicator/evidence 可反查 | V-02、V-03 |
| 同 Requirement / 孤立机理或跨工程引用被拒绝 | IP-02、IP-05 | core + adapter C17 tests | 缺 link、非法枚举、project-2 release | rejected；无正文/自由文本 fallback | V-02、V-03 |
| 规范与案例条目保留原始依据和适用性 / 规范条款与案例可追溯 | IP-02、IP-05 | core + adapter C17 tests | 三层规范、五类方法代表案例、真实 segment refs | accepted；entry→segment→release 可达 | V-02、V-03 |
| 同 Requirement / 无定位知识不进入正式库 | IP-02、IP-05 | core + adapter C17 tests | 仅文件名/自然语言来源 | evidence rejected；无 revision | V-02、V-03 |
| 证据可达性和关键工序覆盖由确定性策略收口 / 关键工序达到审核策略门槛 | IP-02、IP-05 | core + adapter C17 tests | 注入 critical kinds/门槛和可读 segment | policy ref/逐项证据/coverage accepted | V-02、V-03 |
| 同 Requirement / 清洗排除或授权撤销使证据失效 | IP-01、IP-05 | adapter C17 test | C15 excluded segment；提交后撤销 grant | 不可枚举失败；无目标 content read/revision | V-03 |
| 检索证据库组合精确冻结三个发布集合 / 三个合格发布形成组合 | IP-02、IP-05、IP-06 | core + adapter C17 tests | 同工程同双时间三 release | exact 三成员；主/组合 mechanism 相等 | V-02、V-03 |
| 同 Requirement / 组合发布绑定与事件原子成立 | IP-02、IP-03、IP-05 | adapter C17 + C16 tests | publish/rollback；四成员与 composite；binding/event/outbox fault latches | 四成员零事件；组合恰一五引用事件；release/binding/audit/receipt/outbox 同成同败；重放计数不增 | V-03、V-04 |
| 同 Requirement / 成员缺失或停用时组合不可消费 | IP-03、IP-06 | adapter C17 + C16 tests | 缺/错 type/project/future/deactivated 表 | wait/fail；不替换；历史双时间仍解出 | V-03、V-04 |
| 配置导入与 Agent 编制进入同一治理事实模型 / 已审核配置包直接导入 | IP-02、IP-05 | adapter C17 test | valid reviewed package | agent task 0；draft revision 1；未发布 | V-03 |
| 同 Requirement / Agent 合格候选形成同类修订 | IP-02、IP-07、IP-08 | worker C17 test | scripted tool→candidate | C08 completed；同 Schema/binding；revision result | V-05 |
| 非结构化知识编制使用统一有界 Agent 任务 / Agent 在冻结范围内读取并编制 | IP-07、IP-08 | worker C17 runtime/composition tests | manifest 内 set/segment/exact baseline；C06 human/system source | bounded observation；exact branch/scope/usage/authorization recorded | V-05 |
| 同 Requirement / 越界工具请求被拒绝、工具对象必须属于冻结清单 | IP-02、IP-07、IP-08 | core + worker + adapter C17 tests | manifest 外 set/segment/baseline、未知 tool、object/budget max | pre-read rejection；目标 port 调用 0；stable C08 failure | V-02、V-03、V-05 |
| 同 Requirement / 生产组合依赖或授权来源缺失时关闭失败 | IP-07、IP-08 | worker composition + adapter C17 tests | 缺失 dependency/C06 source；actor/project/capability/scope mismatch | 构造或副作用前失败；目标端口调用 0；无预制上下文/envelope fallback | V-03、V-05 |
| Agent 增量逐项确定性校验且无发布权 / 类型化增量全部通过 | IP-02、IP-07、IP-08 | core + worker C17 tests | 每 definition 代表 operation | 每项 accepted；deterministic package；draft only | V-02、V-05 |
| 同 Requirement / 发布或绕过校验的增量被拒绝 | IP-02、IP-05、IP-08 | core + adapter/worker C17 tests | publish op、JSON Patch、whole object、agent publish command | pre-side-effect reject；C16 human gate；无 release | V-02、V-03、V-05 |
| 编制失败必须进入人工复核而非静默通过 / 预算耗尽、精确任务证据窄读、失败复核独立授权、发布/回滚批准证明授权 | IP-01、IP-03、IP-04、IP-07、IP-08 | C08 adapter + C16 adapter + C17 adapter/worker tests | each C08 terminal boundary；不存在/跨工程/错类型/非终态/撤权表；submit/request-review/C07 approval-proof allow/deny；settle replay | exact reader refs；不可枚举失败；one diagnostic/revision/review；C07 零越权调用；重放只补一次 | V-01、V-03～V-05 |
| 同 Requirement / 失败不触发替代结果 | IP-07、IP-08 | worker C17 test | model/tool/recovery failure + old base/candidate | no model/budget switch；no completed/publication | V-05 |
| 识别基础按准备快照和双时间精确解析 / 精确识别基础解析成功 | IP-03、IP-05、IP-06 | adapter C17 + C16 tests | exact prep、three main+members、policy provider | public four typed refs；project/time fixed | V-03、V-04 |
| 同 Requirement / 缺失策略或组合不一致时封闭失败 | IP-06 | adapter C17 test | provider undefined；mechanism mismatch | typed failure；no default/partial/fallback | V-03 |
| 同 Requirement / 评估解析行为保持不变 | IP-03 | C16 adapter test | existing assessment timeline + real C06 | branch assessment；result/error deep equal baseline fixture | V-04 |
| 识别知识事实支持幂等审计和有界下游读取 / 相同请求幂等重放 | IP-04、IP-05、IP-07 | adapter C17 test | replay import/start/failure/publish binding | refs equal；task/revision/review/binding/audit counts unchanged | V-03 |
| 同 Requirement / 工件或事务失败不成立正式绑定 | IP-03、IP-04、IP-05、IP-07 | adapter C17 + C16 tests | artifact/guard/binding/event/audit/receipt/outbox latch | publish transaction 无残留 release/binding/event；retry recovers same refs/counts | V-03、V-04 |
| 同 Requirement / 下游读取严格有界 | IP-05、IP-06 | adapter C17 test | project-1 exact ref、project-2/unknown/history probes | only bound package/validation；C06 denial; no scans | V-03 |
| 全量公共/依赖回归 | IP-09 | existing contracts/C08/C11/C15/C16/API tests | C15 drift 与 D-01 deps integrated | strict preparation/route-decision、generic routes、runner、evidence、assessment unchanged | V-01、V-04、V-06 |
| 所有计划文件与完成门 | IP-10 | all | 定向测试已通过 | build/type/lint/format/deps/OpenSpec、IP/file map 全通过 | V-07～V-10 |

## 7. 文件清单与升级条件

### 7.1 允许文件

**新增：**

- `packages/core/src/identification-knowledge/schema.ts`（IP-02）
- `packages/core/src/identification-knowledge/service.ts`（IP-02）
- `packages/core/src/identification-knowledge/index.ts`（IP-02）
- `packages/core/test/identification-knowledge.test.ts`（IP-02）
- `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`（IP-05～IP-07）
- `packages/adapters/src/identification-knowledge/index.ts`（IP-05）
- `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.ts`（IP-04）
- `packages/adapters/test/identification-knowledge/fixture.ts`（IP-01）
- `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`（IP-05～IP-07）
- `apps/worker/src/identification-knowledge/composition.ts`（IP-08，唯一生产组合根）
- `apps/worker/src/identification-knowledge/runtime.ts`（IP-08）
- `apps/worker/src/identification-knowledge/index.ts`（IP-08，仅导出本模块组合入口）
- `apps/worker/test/identification-knowledge/composition.test.ts`（IP-08）
- `apps/worker/test/identification-knowledge/runtime.test.ts`（IP-08）

**修改：**

- `packages/core/package.json`（IP-02，仅新增 subpath export）
- `packages/adapters/package.json`（IP-05，仅新增 subpath export）
- `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`（IP-03，仅 resolver branch 与发布/回滚 transaction policy 接缝）
- `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`（IP-03）
- `packages/adapters/test/postgres/postgres-foundation.test.ts`（IP-04，仅迁移发现/权限期望）
- `apps/worker/src/index.ts`（IP-08，仅导出组合函数/类）

**删除：**无。

**协调端所有权机械同步：**`packages/adapters/test/postgres/postgres-foundation.test.ts` 与 `packages/adapters/test/auth/fixture.ts` 中对迁移 `000020` 的中央清单登记由主调度协调端串行完成；该精确登记不属于本 change 实现者越界，其它改动仍按本节 allowlist 和保护区判断。

**前置 change 所有权（不在本 allowlist）：**C08 change 新增/调整 `packages/core/src/agent-runtime/` 的 failure evidence DTO/reader、`packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 的 `readTerminalFailure()`、相应 package 导出和 `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`；该 change 还须在 `packages/contracts` 新增 `agent-task.read-failure-evidence`/`agent-task.read` 并调整 C06 策略测试。复用现有 C08 表与 C03 审计，不新增迁移。

### 7.2 保护区与升级条件

- 不得修改 `packages/contracts/**`、根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`openspec/config.yaml`、`openspec/specs/**`、归档/其它 changes、migration provider、C15/C11 生产文件、`apps/api/src/http.ts` 或 `apps/web/**`。
- 若两个定义类型、独立 C15 drift change、C08 failure evidence change 或 `implement-engineering-data-read-branches` 未归档集成，C15 public `readExactPreparation()` 不能 strict 返回 route decisions，C08 public `readTerminalFailure()` 不能授权返回精确证据，C16 transaction policy seam 不接收 `TransactionContextV1`，或 base drift 改变 C08 runner/C16 transaction 语义，停止并向协调端提交文件/符号/行为证据。不得在 C17 修改 C08/C15/C11 文件。
- 若需要修改公共 Schema、增加 public branch/event、读取上游私有表、增加依赖、占用 `000021`～`000023`、拆分/扩大 capability 或新增 API/Web 文件，必须先升级；不得自行补设计。
- 若 production 组合无法保证只暴露 C17 façade、无法先把 C17 release policy 注入 C16 再把该 C16 adapter 注入 façade、C06 无法对 D-11 exact branches 签发独立上下文，或 C07 request-review 能力无法接通，停止实现。若 Docker/PostgreSQL 等外部条件导致测试不能运行，只报告环境原因，不以 Mock 后端替代。

### 7.3 已核实工具对应的可运行命令

- **V-01 前置契约/C15/C08/数据回归**：`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/agent-runtime/agent-runtime.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`；必须出现 C15 `readExactPreparation()` strict snapshot/route-decision 与 C08 `readTerminalFailure()` exact/auth/non-enumeration/audit 场景通过，不能只依赖 C17 fixture。
- **V-02 core 定向**：`pnpm exec vitest run packages/core/test/identification-knowledge.test.ts`
- **V-03 adapter 定向**：`pnpm exec vitest run --reporter=verbose packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`；发布/回滚测试必须到达并断言 release、binding、audit、receipt、Outbox，所有成功前置使用会抛错的 narrowing helper，禁止 `return` 早退。
- **V-04 C16 resolver/发布事务/C07 授权回归**：`pnpm exec vitest run --reporter=verbose packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`；证明评估逐字段不变、C17 policy 缺失关闭失败、publish/rollback callback 使用同一 transaction context，以及结构化 provider 的 request/approval-proof DTO 和 actor/project/invocation/唯一 capability 拒绝边界。
- **V-05 Worker 组合/运行定向**：`pnpm exec vitest run --reporter=verbose apps/worker/test/identification-knowledge/composition.test.ts apps/worker/test/identification-knowledge/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts`；证明每个 exact branch、成员越界零目标读取、授权拒绝零副作用和失败最终 `review-linked`，禁止早退。
- **V-06 generic API 回归**：`pnpm exec vitest run apps/api/test/http-shell.test.ts`
- **V-07 构建与类型**：`pnpm build && pnpm typecheck`
- **V-08 静态和格式**：`pnpm exec eslint packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge && pnpm exec prettier --check packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/core/package.json packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge packages/adapters/package.json packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge apps/worker/src/index.ts`
- **V-09 依赖边界**：`pnpm deps:check && pnpm deps:policy`
- **V-10 OpenSpec/施工图完成门**：`openspec validate deliver-process-model-mechanism-and-evidence-governance --strict --no-interactive && openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json`

## 8. Finalizer 授权与限定审计

### 8.1 已批准收尾范围

- Finalizer 以协调端固定的 implementation checkpoint 为输入，先核对实际 HEAD、完整读取本 change 的全部 `contextFiles`，再按 IP-01～IP-10、§7.1 文件清单和 tasks 未完成项验收。为落实已批准 Requirement/Scenario，可在 §7.1 允许文件内直接修复生产代码、迁移、包导出和测试，并运行受影响回归；普通缺陷不回派 Implementation。
- Finalizer 可更新本 change 的 `tasks.md` 完成状态与验收证据，但不得改变 proposal、spec、D-01～D-12、IP-ID、Non-Goals、文件所有权或验收语义。若实现检查点相对本施工图发生 drift，先提交符号、调用链和 diff 证据；只有不改变已批准设计的机械定位调整可在当前收尾中处理。
- §7.1 保护区继续生效。任何需要新增公共字段/branch/event、改变授权或事务语义、修改 C08/C15/C11 所有权文件、增加迁移/依赖、占用计划外文件或扩大 C17 能力的修复都必须升级，不得由 Finalizer 自行补设计。

### 8.2 Finalizer 必须形成的证据

- 逐项反向核对全部 Requirement/Scenario、D-01～D-12、IP-01～IP-10、允许文件和 tasks；运行 V-01～V-10，并保留实际命令、退出结果及关键场景已到达最终 binding/state/audit/receipt/Outbox 断言的证据。关键场景被跳过、条件早退或仅验证替身时不得判定通过。
- 审阅 implementation checkpoint 到最终 HEAD 的全部 diff，确认只落在 §7.1 允许文件或协调端明确拥有的迁移清单机械同步中；确认 `packages/contracts/**`、C08/C15/C11、API/Web、根 workspace、锁文件、主 specs 和其它 changes 未发生越界修改。
- 最终报告必须列出最终 HEAD、实际修改文件、覆盖的 Requirement/Scenario 与 IP-ID、V-01～V-10 结果、未执行命令及原因、剩余风险和需要协调端完成的机械事项；Finalizer 不提交、合并或归档。

### 8.3 限定审计标签

- **permission（必需）**：限定检查 D-04、D-09、D-11 的 exact branch、actor/project/invocation、唯一 capability、空间/资料范围、human/system 来源和目标读取前拒绝；重点证据为 V-01、V-03～V-05，禁止扩大为全库权限重审。
- **transaction（必需）**：限定检查 D-05、D-07、D-11 的 C16 publish/rollback 同事务 release-binding-audit-receipt-Outbox 原子性、故障回滚和幂等重放；重点证据为 V-03、V-04。
- **critical-state-machine（必需）**：限定检查 D-08、D-09 的 C08 runner 复用、attempt 单向 CAS、终态失败窄读、`failure-review-only → review-linked` 恢复及无 fallback；重点证据为 V-01、V-03、V-05。
- **semantic-merge（条件触发）**：仅当 implementation checkpoint 之后发生语义 merge 冲突或冲突解决时触发，范围限于受影响 IP-ID、调用链和回归；旧检查点证据不得覆盖冲突解决后的产物。
- 限定审计发现的普通实现缺陷由当前 Finalizer 在已批准范围内修复并重跑受影响验证；发现需要改变公共契约、权限、事务、持久化、迁移、依赖或 Non-Goals 时暂停并升级。
