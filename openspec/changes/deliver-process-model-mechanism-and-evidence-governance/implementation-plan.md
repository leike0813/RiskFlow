# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`1e51bec508ddad8e2ccdd5af9a9d17b593458af9`；实施前执行 `git rev-parse HEAD`，并用 `git diff --name-only 1e51bec508ddad8e2ccdd5af9a9d17b593458af9 -- <本计划允许文件>` 逐项复读集成后的符号。计划依据是本 change 的 proposal/spec/design、已归档主 specs、C08/C16 代码和 C15 检查点 `ba13a0d6f19609fcb4c6f0f40fc4dd035516effc` 的五工件；技术事实只使用 `references/风险识别与评估规划事实源摘要.md`。
- schemaName 已由 `openspec status --change deliver-process-model-mechanism-and-evidence-governance --json` 确认为 `riskflow-delivery`。
- D-01 硬门：集成后 contracts 能解析 `standard-library`/`case-library`；C15 正式 `readBoundResult` 可读精确准备，且 `implement-engineering-data-read-branches` 已实现 D-04 的 C02 资料段/证据公共读取；C08/C16 与复数 `includedSourceSegmentSetRefs` 均已归档集成。实施 Agent 只验证和消费，不修改其所有权文件；任一门失败立即升级。
- 协调裁决：C17 迁移号段 `000020`～`000023`，实际仅使用 `000020`；`identificationPolicySetRef` 归 C21/C24，C17 通过注入 provider 精确读取并在缺失时 fail-closed；C16 resolver 能力分支修正是本 change 唯一获准的 C16 生产修改。
- 当前已核实命令工具：Node `24.12.0`、pnpm `11.10.0`、OpenSpec `1.13.0`、Vitest `4.1.11`、TypeScript `5.9.3`、ESLint `10.9.1`、Prettier `3.9.6`、dependency-cruiser `17.1.0`。不安装或升级依赖。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/vocabulary/index.ts` 的五工序、六机理、四关系及设备/参数/指标 Schema；`packages/contracts/src/workflows/index.ts` 的 `IdentificationPreparationSnapshotV1Schema` | 只通过公共导出构造验收 fixture，证明复数字段和新增定义类型可 strict parse | 不复制枚举、准备快照或公共引用 Schema |
| IP-01、IP-05、IP-06 | C15 正式 `PostgresDataCleaningStore.readBoundResult`；`implement-engineering-data-read-branches` 集成后的 C02 `EngineeringDataPortV1.read`；C04 `open()` | C17 本地结构接口只组合精确准备、`queryResultRef`、切片和证据资格 | 不读 C15/C11 表、私有 reader 或排除前正文 |
| IP-02 | `packages/core/src/agent-runtime/runtime.ts` 的 `AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry`；`schema.ts` 的 validation/result DTO | 注册现有 `knowledge-authoring` 严格定义并返回逐项 validation | 不复制状态机、预算、候选或结果族 |
| IP-03、IP-05、IP-06 | `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` 的 `govern()`、`resolveGovernedReleases()`、`#verifyAuthorization()` 与 C16 生命周期 | 修正共享 resolver 分支；C17 façade 委派修订/审核/发布/停用/回滚 | 不复制 C16 定义、修订、发布、停用、回滚表和规则 |
| IP-04～IP-07 | C03 `TransactionUnitV1`、命令收据/审计；C04 `ArtifactStoreV1`/`ArtifactReferenceGuardV1`；C07 `ReviewAuditPortV1` | 工件先耐久，C17 索引/收据事务提交，审核经 C16→C07 | 不建平行工件仓库、审计表或 review 状态 |
| IP-07、IP-08 | `apps/worker/src/agent-runtime/runner.ts` 的 `AgentRuntimeRunner` 与 callback 接缝；C08 PostgreSQL task store 的精确 `getTask` | 模块 runner 包装一次 shared `runOnce()` 后只收口 C17 attempt | 不复制 claim、租约、预算、模型循环、重试和恢复 |
| IP-06 | C02 `KnowledgeResolutionCommandV1Schema`/`KnowledgeResolutionSuccessV1Schema`；注入的 `IdentificationPolicySetProviderV1` | 按 public 四字段返回识别基础，策略引用由 C21/C24 provider 提供 | 不定义识别策略内容、默认引用或治理类型 |
| IP-05、IP-09 | `apps/api/src/http.ts` 的 generic knowledge/agent 路由 | 生产组合注入 C17 façade；只跑现有路由回归 | 不新增 C17 URL、请求 Schema 或 Web 页面 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置门与契约夹具 | `识别知识包使用独立稳定定义身份`、`证据可达性和关键工序覆盖由确定性策略收口`、`识别基础按准备快照和双时间精确解析` 的全部前置场景 | **新增** `packages/adapters/test/identification-knowledge/fixture.ts`：`startIdentificationKnowledgeFixture`、五类 package builders、真实 C03/C04/C06/C07/C08/C16/C15/C02 read 组合；只用已集成公共接口 | 先证明两个定义类型、复数准备快照、C15 `readBoundResult` 和 `implement-engineering-data-read-branches` 可用；fixture 为后续测试提供工程二、权限撤销、时钟和故障 latch | 不以 fake production store、私有 SQL reader 或单数字段兼容代替上游 |
| IP-02 | 核心 Schema、关系/覆盖校验与 Agent 定义 | 工序、机理、规范/案例、证据/覆盖、同一事实模型、类型化增量的全部场景 | **新增** `packages/core/src/identification-knowledge/schema.ts`；**新增** `service.ts`：`validateIdentificationKnowledgePackage`、`applyKnowledgeAuthoringIncrement`、`createKnowledgeAuthoringTaskDefinition`；**新增** `index.ts`；**修改** `packages/core/package.json` 增加 `./identification-knowledge` export；**新增** `packages/core/test/identification-knowledge.test.ts` | 实现 D-02/D-03/D-08 strict 联合、唯一/引用检查、五/六最小集、O(V+E) 时间环、关键工序覆盖、三成员组合和逐操作 validation；参数化代表性边界 | 不新增公共 contracts、第二枚举源、公式 DSL、提示词/完整文案断言或无价值逐字段测试 |
| IP-03 | C16 resolver 权限根因修正 | `识别基础按准备快照和双时间精确解析 / 评估解析行为保持不变`，以及识别/交叉权限失败 | **修改** `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：新增私有 `knowledgeResolutionBranch(requiredDefinitionTypes)` 并由 `resolveGovernedReleases()` 使用；**修改** `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` | 按 D-06 映射纯识别族/纯评估族，混合族在查询前拒绝；真实 C06 测试识别允许、交叉拒绝，并保留评估逐字段结果 | 不改方法输入/输出、C16 表/迁移、选择算法、时间/停用语义或公共 Schema |
| IP-04 | C17 只追加持久化 | 幂等/事务/绑定/失败复核场景 | **新增** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.ts`：`up`/`down`；**修改** `packages/adapters/test/postgres/postgres-foundation.test.ts` 的递归发现期望 | 按 D-07 建四表、唯一/check/本模块外键、app 写和 worker/checkpointer 最小权限；down 仅空表可执行；证明 provider 自动发现 | 不改 migration provider/中央清单、既有表、既有迁移或使用 `000021`～`000023` |
| IP-05 | C17 façade、审核包导入和精确发布读取 | 独立身份、同一事实模型、生命周期、人类发布、下游窄读和事务场景 | **新增** `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`：`PostgresIdentificationKnowledgeAdapter.govern`、`readExact`、validation/revision/release binding helpers；**新增** `index.ts`；**修改** `packages/adapters/package.json` 增加 `./identification-knowledge` export；**新增** `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` | 按 D-05/D-10/D-11/D-12 完成 C04→validation→C16→binding 分阶段收口；C17 publish 重验合格绑定/组合，Agent 发布由 C16 拒绝；非 C17 govern 原样委派；精确 reader 复验授权 | 不暴露裸 C16 为生产 knowledge port，不复制生命周期，不解释评估包，不新增列表/搜索/最新读取 |
| IP-06 | 三发布组合与 public identification-basis | 组合全部场景、识别基础成功/失败、证据授权撤销 | **修改** 同一 adapter/test 文件：`resolveIdentificationBasis`、`resolve`、组合成员 reader；新增 core `IdentificationPolicySetProviderV1`/result interface（归 IP-02 文件） | 按 D-10 顺序读取准备、解析三主发布和 composite 三成员、复验机理一致、调用策略 provider，映射四个 public typed refs；非 identification resolve/retrieve 保持当前 `UNSUPPORTED_CONTRACT` | 不返回半套结果、不硬编码策略、不实现 C20 检索、不把 `issuedAt` 换成数据库当前时间 |
| IP-07 | C08 编制准备、工具、finalizer 与失败复核 | 有界任务、逐项增量、合格修订、预算/模型/工具/恢复/取消失败复核及幂等场景 | **修改** C17 adapter/test 文件：`prepareOrReplayAuthoringTask`、两个 read-only tool executors、`finalizeAuthoringCandidate`、`settleAuthoringFailures` | 按 D-08/D-09 写 frozen manifest、启动同一 C08 task、按精确范围读工具；finalizer 走 IP-05；终态失败写 diagnostic→C16 failure revision→C07 review，绑定 `failure-review-only`；每段稳定键可恢复 | 不给 Agent C16 发布工具，不在 retryable 状态提前复核，不重置预算，不把失败 revision 当合法包 |
| IP-08 | Worker 接入 shared runner | 有界任务两个场景、增量两个场景、失败复核两个场景 | **新增** `apps/worker/src/identification-knowledge/runtime.ts`：`withKnowledgeAuthoringModelStep`、`interpretKnowledgeAuthoringModelStep`、`KnowledgeAuthoringRunner`；**修改** `apps/worker/src/index.ts` 导出；**新增** `apps/worker/test/identification-knowledge/runtime.test.ts` | 协议脚本驱动工具→候选→逐项校验→revision；模型/工具/预算/租约/取消终态后调用 IP-07 收口；其它 task callback 原样委派 | 不修改 generic runner、不创建 worker 全局注册表/单例、不断言自然语言提示全文 |
| IP-09 | API/Worker/Web 与依赖回归 | 所有 public/跨模块边界 | **不修改** `apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts`、`apps/worker/src/agent-runtime/runner.ts`、`apps/worker/test/agent-runtime/runner.test.ts`、`apps/web/**`、contracts/C15/C11 文件 | 运行现有 generic route、runner、contracts、C11/C15、C16 回归；确认无新增 URL/Web、无依赖和跨表读取 | 不通过改测试、snapshot 或文案掩盖漂移 |
| IP-10 | 最小全量验证与 OpenSpec 完成门 | 每个 Requirement/Scenario、每个计划文件和验证义务 | **不新增生产文件**；只更新 `tasks.md` 勾选证据 | 执行 V-01～V-10；检查文件 allowlist、IP 反向映射、apply `contextFiles` 全读和 strict validate | 不提交、不归档、不启动开发服务器 |

## 4. 调用与副作用顺序

### 4.1 审核包导入、送审与发布（IP-02、IP-04、IP-05）

1. Façade strict parse public command，先校验工程/actor/branch authorization；对 C17 type 以 C04 `open()` 读取精确候选，验证 manifest/ref/digest，调用 D-04 检查准备和证据。
2. Core 按 D-03 产生逐项 validation；adapter 先写 C04 validation artifact，再用派生 `:validation` 键在 C03 事务写 validation、receipt、audit、零事件。拒绝直接返回 `BUSINESS_BLOCKED`，数据库和错误不含正文。
3. 合格 validation 用派生 `:c16-submit` 键调用 C16。C16 失败不建 binding；重试先读 C17 receipt，再由 C16 自身幂等返回原 revision。
4. 用 `:bind-revision` 事务追加 validated binding；只有 binding 成功后 façade 才把 revision 返回调用方。送审继续委派 C16→C07。
5. publish 前重新读取 binding/package；组合包调用 C16 resolver 验证三个成员在 `effectiveFrom`/命令记录时间有效。C16 human gate、approval proof 和发布事务成功后，C17 用 `:bind-release` 追加 release binding；未绑定 release 不被 C17 reader/resolver 暴露。停用/回滚同样先验 binding，回滚的新 release 绑定历史 revision。

### 4.2 identification-basis（IP-03、IP-05、IP-06）

1. 解析 command 并以 `requiredAt`/`issuedAt` 固定双时间；D-04 reader 在任何知识读取前解析精确 preparation、C15 bound result 和当前资料权限。
2. C16 resolver 通过 IP-03 选择 `knowledge-modeling.identification-basis`，只查工程及三个主类型；C17 `readExact` 打开 composite 并再次调用 resolver 校验其三成员，要求机理 ref 与主结果相等。
3. 调用 C21/C24 provider 取得精确 policy set ref；映射 C16 refs 为 Process/RiskMechanism/Retrieval typed refs并 strict parse public success。
4. 任一步缺失、未生效、停用、错工程/类型、授权撤销、策略空缺均映射为现有 ModuleError；不执行后续读取、不返回部分结果、不 fallback。

### 4.3 Agent 编制与成功收口（IP-02、IP-05、IP-07、IP-08）

1. `prepareOrReplayAuthoringTask` 复验 D-04 preparation 和可选 baseline；将 manifest 写 C04，C03 事务写 attempt/receipt/audit，再通过 C08 port 以相同冻结 refs 启动或重放一个 task。
2. `KnowledgeAuthoringRunner` 调用 shared runner；model callback 只渲染 manifest refs/有界观察，tool request 先经 C08 registry/预算，再由 C17 tool 复验当前 authorization、manifest membership、对象/字节限制并调用 D-04 或 `readExact`。
3. candidate 是封闭操作数组；C08 parse action/increment/candidate，core 逐项 validation。repairable rejection 保留在同一 task/ledger；terminal rejection 不循环。
4. 全部通过后 finalizer 将操作应用冻结 baseline，完整复验 package，写 C04 candidate，并走 4.1 submit 得到 knowledge revision；C08 确认 result family/task ref 后记录 candidate/action/完成终态。

### 4.4 Agent 失败、恢复与人工复核（IP-04、IP-07、IP-08）

1. generic runner 先按 C08 处理 lease、重试、预算和终态；模块 settlement 仅查询 C17 pending attempt 的 task ref。
2. `retryable-failure` 不收口；`terminal-failure | cancelled` 且无正式 result 时，先写 failure diagnostic artifact，再以 `:failure-revision` 直接调用 C16 submit，并写 `failure-review-only` binding。
3. 以 `:failure-review` 调用 C16 request-review/C07，再事务绑定 review ref 和 settled 状态。任一步失败保留前一步稳定事实；下一次只补未完成阶段。
4. Façade publish 永久拒绝 failure binding。人工只能依据 review 决定补资料、启动新幂等 task 或结束；旧 task、预算、诊断和 review 均保留。

## 5. Schema、状态与持久化落实

- **Schema SSOT（IP-02）**：五类 package、policy、manifest、increment、validation/binding/failure 全部在 core C17 子模块；公共 refs/枚举只 import contracts。`KnowledgeAuthoringIncrementV1` 按 `definitionType`+`operation` 双层判别，退役必须指向 baseline 条目并带原因/证据。
- **关系和覆盖（IP-02）**：包内 ID 唯一；边端点存在、自指/重复拒绝；只对时间先后边做拓扑环检查；五工序、六机理由 contracts 集合差验证；critical kinds/最小覆盖从精确 policy 对象读取。
- **状态（IP-04、IP-07）**：validation 为 accepted/rejected；revision binding 为 validated/failure-review-only；attempt 依次 `prepared → task-started → completed | failure-revision-bound → review-linked`，只追加事实或 CAS 前进，不回退。C08/C16/C07 状态仍为各自 SSOT。
- **持久化（IP-04）**：`000020` 四表均带 project、完整版本引用、digest、command/idempotency、authorization/audit 和 occurred/recorded/persisted 时间；正文只在 C04。外部 ref 由 `ArtifactReferenceGuardV1`/领域端口复验，不对其它模块私有表建耦合外键。
- **权限（IP-03、IP-05～IP-08）**：govern 使用准确 command branch；resolver 按知识族选 identification/assessment branch；D-04 使用 engineering read；C17 reader 使用 identification-basis；Agent 工具只读，submit/review 为收口动作，发布/停用/回滚必须 C16 验证 human invocation。
- **幂等/事务（IP-04、IP-05、IP-07）**：外层 key 加稳定阶段后缀；同 key 不同规范摘要冲突。每个本地阶段是一个 C03 事务，跨 C16/C07 使用阶段 latch 恢复；artifact 成功但事务失败只留不可消费孤儿。
- **审计/可观测（IP-04～IP-08）**：记录 package/manifest/validation/task/revision/release/review refs、每项原因、策略/模型/提示/工具/预算 refs 和 usage；无新 public event 时零 Outbox。日志不写正文、模型响应、凭据或内部错误。

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
| 同 Requirement / 成员缺失或停用时组合不可消费 | IP-03、IP-06 | adapter C17 + C16 tests | 缺/错 type/project/future/deactivated 表 | wait/fail；不替换；历史双时间仍解出 | V-03、V-04 |
| 配置导入与 Agent 编制进入同一治理事实模型 / 已审核配置包直接导入 | IP-02、IP-05 | adapter C17 test | valid reviewed package | agent task 0；draft revision 1；未发布 | V-03 |
| 同 Requirement / Agent 合格候选形成同类修订 | IP-02、IP-07、IP-08 | worker C17 test | scripted tool→candidate | C08 completed；同 Schema/binding；revision result | V-05 |
| 非结构化知识编制使用统一有界 Agent 任务 / Agent 在冻结范围内读取并编制 | IP-07、IP-08 | worker C17 test | manifest 内 segment/baseline | bounded observation；usage/authorization recorded | V-05 |
| 同 Requirement / 越界工具请求被拒绝 | IP-07、IP-08 | worker + adapter C17 tests | manifest 外 ref、未知 tool、object/budget max | no target read/write；stable C08 failure | V-03、V-05 |
| Agent 增量逐项确定性校验且无发布权 / 类型化增量全部通过 | IP-02、IP-07、IP-08 | core + worker C17 tests | 每 definition 代表 operation | 每项 accepted；deterministic package；draft only | V-02、V-05 |
| 同 Requirement / 发布或绕过校验的增量被拒绝 | IP-02、IP-05、IP-08 | core + adapter/worker C17 tests | publish op、JSON Patch、whole object、agent publish command | pre-side-effect reject；C16 human gate；无 release | V-02、V-03、V-05 |
| 编制失败必须进入人工复核而非静默通过 / 预算耗尽创建一次失败复核 | IP-04、IP-07、IP-08 | adapter + worker C17 tests | each C08 budget boundary；settle replay | terminal；one diagnostic/revision/review；failure-only | V-03、V-05 |
| 同 Requirement / 失败不触发替代结果 | IP-07、IP-08 | worker C17 test | model/tool/recovery failure + old base/candidate | no model/budget switch；no completed/publication | V-05 |
| 识别基础按准备快照和双时间精确解析 / 精确识别基础解析成功 | IP-03、IP-05、IP-06 | adapter C17 + C16 tests | exact prep、three main+members、policy provider | public four typed refs；project/time fixed | V-03、V-04 |
| 同 Requirement / 缺失策略或组合不一致时封闭失败 | IP-06 | adapter C17 test | provider undefined；mechanism mismatch | typed failure；no default/partial/fallback | V-03 |
| 同 Requirement / 评估解析行为保持不变 | IP-03 | C16 adapter test | existing assessment timeline + real C06 | branch assessment；result/error deep equal baseline fixture | V-04 |
| 识别知识事实支持幂等审计和有界下游读取 / 相同请求幂等重放 | IP-04、IP-05、IP-07 | adapter C17 test | replay import/start/failure/publish binding | refs equal；task/revision/review/binding/audit counts unchanged | V-03 |
| 同 Requirement / 工件或事务失败不成立正式绑定 | IP-04、IP-05、IP-07 | adapter C17 test | artifact/guard/transaction/audit latch | no consumable binding；retry recovers same refs | V-03 |
| 同 Requirement / 下游读取严格有界 | IP-05、IP-06 | adapter C17 test | project-1 exact ref、project-2/unknown/history probes | only bound package/validation；C06 denial; no scans | V-03 |
| 全量公共/依赖回归 | IP-09 | existing contracts/C08/C11/C15/C16/API tests | D-01 deps integrated | public parse、generic routes、runner、preparation/evidence and assessment unchanged | V-01、V-04、V-06 |
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
- `apps/worker/src/identification-knowledge/runtime.ts`（IP-08）
- `apps/worker/test/identification-knowledge/runtime.test.ts`（IP-08）

**修改：**

- `packages/core/package.json`（IP-02，仅新增 subpath export）
- `packages/adapters/package.json`（IP-05，仅新增 subpath export）
- `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`（IP-03，仅 resolver branch mapping）
- `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`（IP-03）
- `packages/adapters/test/postgres/postgres-foundation.test.ts`（IP-04，仅迁移发现/权限期望）
- `apps/worker/src/index.ts`（IP-08，仅导出组合函数/类）

**删除：**无。

### 7.2 保护区与升级条件

- 不得修改 `packages/contracts/**`、根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`openspec/config.yaml`、`openspec/specs/**`、归档/其它 changes、migration provider、C15/C11 生产文件、`apps/api/src/http.ts` 或 `apps/web/**`。
- 若两个定义类型、C15 正式 reader 或 `implement-engineering-data-read-branches` 未集成，C15 的正式结果结构不同于检查点，C16 新增了正式 public resolver/validator seam，或 base drift 改变 C08 runner/C16 transaction 语义，停止并向协调端提交文件/符号/行为证据。
- 若需要修改公共 Schema、增加 public branch/event、读取上游私有表、增加依赖、占用 `000021`～`000023`、拆分/扩大 capability 或新增 API/Web 文件，必须先升级；不得自行补设计。
- 若 production 组合无法保证只暴露 C17 façade、或 C06 无法在不改 contracts 下精确匹配 D-06 分支，停止实现。若 Docker/PostgreSQL 等外部条件导致测试不能运行，只报告环境原因，不以 Mock 后端替代。

### 7.3 已核实工具对应的可运行命令

- **V-01 前置契约/数据回归**：`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`
- **V-02 core 定向**：`pnpm exec vitest run packages/core/test/identification-knowledge.test.ts`
- **V-03 adapter 定向**：`pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`
- **V-04 C16 resolver 回归**：`pnpm exec vitest run packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`
- **V-05 Worker 定向**：`pnpm exec vitest run apps/worker/test/identification-knowledge/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts`
- **V-06 generic API 回归**：`pnpm exec vitest run apps/api/test/http-shell.test.ts`
- **V-07 构建与类型**：`pnpm build && pnpm typecheck`
- **V-08 静态和格式**：`pnpm exec eslint packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge && pnpm exec prettier --check packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/core/package.json packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge packages/adapters/package.json packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge apps/worker/src/index.ts`
- **V-09 依赖边界**：`pnpm deps:check && pnpm deps:policy`
- **V-10 OpenSpec/施工图完成门**：`openspec validate deliver-process-model-mechanism-and-evidence-governance --type change --strict --no-interactive && openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json`
