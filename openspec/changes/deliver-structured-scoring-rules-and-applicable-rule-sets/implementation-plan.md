# Implementation Plan

## 1. 实施基线与权威来源

- 固定代码基线：`6c225c113d570de2bf8b15fd2b3fa6c1b6364bf5`；规划分支 `leike0813/c19-scoring-rules`，change 为 `deliver-structured-scoring-rules-and-applicable-rule-sets`。
- `openspec status --change deliver-structured-scoring-rules-and-applicable-rule-sets --json` 已确认 `schemaName: riskflow-delivery`。行为事实源为本 change 的 proposal、`knowledge/structured-scoring-rules-and-applicable-rule-sets` delta spec 与 `design.md`；实现 Agent 必须先完整读取 `openspec instructions apply --change ... --json` 返回的全部 `contextFiles`。
- 已归档直接依赖：C08 `deliver-unified-bounded-agent-runtime`、C16 `deliver-governed-definition-lifecycle`、C18 `deliver-assessment-configuration-and-measure-governance`。只读前置输入：C15 检查点 `ba13a0d6f19609fcb4c6f0f40fc4dd035516effc` 的五工件；C15 未实现，禁止从规划文档臆造生产符号。
- 主契约事实源：C01/C02 的 contracts 与主 specs、C07 审阅主 spec、C08/C16/C18 主 specs及当前生产代码。研究语义只来自 `references/风险识别与评估规划事实源摘要.md`，不得读取原始 Office 或逐篇转换材料补设计。
- 实施前硬门：C15 已归档集成且导出其计划中的 `DataCleaningResultV1Schema`/结果读取接缝；C08/C16/C18 符号无漂移；仓库生产代码仍无 `reviewStatus` 准入消费者；存在一条获准、可核验来源版本和资料段定位的真实规范 fixture。任一不满足，IP-01 停止并通过协调端升级，禁止先实现其它 IP。
- 版本与工具已在当前 worktree 核实：Node `v24.12.0`、pnpm `11.10.0`、Vitest `4.1.11`、TypeScript `5.9.3`、Prettier `3.9.6`、OpenSpec `1.13.0`；下文只使用根 `package.json` 已有脚本或这些已安装 CLI。
- 不新增依赖。迁移使用分配号段中的 `000028`，不占用 `000029–000031`，不修改 provider/中央注册。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts 的 `StructuredScoringRuleSchema`、`ApplicabilityMetadataSchema`、`KnowledgeResolutionCommandV1Schema`；C15 五工件 | 用 strict parse 与真实规范 fixture 证明前置契约可消费 | 不修改 contracts，不复制 C15 私有 schema，不用合成条文代替出口 |
| IP-02 | `packages/core/src/assessment-config/schema.ts` 的 C18 集合/成员；contracts common/records/ports refs | 直接组合已有类型形成 C19 两类文档、manifest、操作和命令 Schema | 不重定义三维字段、定义枚举、C18 11 类配置或审核状态 |
| IP-03 | C08 `AgentTaskDefinitionV1`、`buildCompletedAgentTaskResult`；C18 `validateAssessmentConfigurationSet`/成员索引方式 | 实现规则级校验、materialize、关系检测、筛选和 C08 definition | 不复制 Runner、预算台账、C18 内容校验或 C16 生命周期 |
| IP-04 | 迁移 `000007_governed_definition_lifecycle.ts`、`000012_assessment_configuration.ts` 与递归 provider | 沿现有 Kysely 迁移、三时态、角色权限、复合约束范式新增 C19 表 | 不改旧表、provider、根迁移清单或历史数据 |
| IP-05 | C04 `ArtifactStoreV1`；C07 `ReviewAuditPortV1`；C08 `AgentTaskPortV1`；C18 `PostgresAssessmentConfigurationAdapter.resolveConfigurationSet` | 组合有界读取、Agent finalizer、冲突补链、规则集组装与 basis resolve | 不直读 C15/C18/C25 私表，不建立第二审阅/任务/审计体系 |
| IP-06 | `PostgresKnowledgeGovernanceAdapter` 的 `#prepareAssessmentConfigurationRevision`、`#appendPreparedAssessmentConfigurationRevision`、`#assertAssessmentConfigurationRevisionMetadata`、`#appendAssessmentConfigurationRelease` | 在相同四个接缝加入 C19 两类定义的专用 policy 分派 | 不修改 C18 adapter，不抽象通用插件框架，不改变其它类型行为 |
| IP-07 | `apps/worker/src/agent-runtime/runner.ts` 的 `renderModelStep`/`interpretModelStep` callbacks | 以组合函数接入 C19 renderer/interpreter，仍使用同一 Runner | 不创建全局 registry、第二 Runner、模型网关或自然语言写命令 |
| IP-08 | C16/C18/PostgreSQL 测试 fixture 和 API 通用知识路由 | 一条集成主链验证治理、冲突、筛选、发布、解析、事务和重放 | 不为文案/内部顺序加断言，不增加 C19 API/Web 入口 |
| IP-09 | 根 `typecheck`、`lint`、`format:check`、`deps:check`、`deps:policy` 与 OpenSpec CLI | 执行最小全局静态/边界/规格校验并形成验收证据 | 不启动开发服务器、不安装依赖、不提交或归档 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置契约与验收夹具 | `合格且冻结的规范条文输入` 两场景；`不可变适用规则集组装与人工发布 / RA-S3/S4 形成适用规则集` | **新增** `packages/core/test/scoring-rules/fixture.ts`：公共规则/三维/C18 ref builders；**新增** `packages/adapters/test/scoring-rules/fixture.ts`：C03/C04/C07/C08/C15/C16/C18 组合 fixture、真实规范输入 builder | 先用已集成生产导出和 strict Schema 构造 C15 completed result；真实规范只保留获准最小资料段、标准身份、来源版本和 segment locator；提供冲突、不适用、故障注入开关 | 无 C15 时不建本地替身；不读取研究原件；不 Mock 后端；不写未经许可的完整规范正文 |
| IP-02 | C19 strict Schema 与子路径 | `结构化评分规则唯一内容契约` 两场景；`三维适用性筛选与完整原因` 两场景；D-01～D-04 | **新增** `packages/core/src/scoring-rules/schema.ts`：`StructuredScoringRuleDocumentV1Schema`、`ApplicableRuleSetDocumentV1Schema`、`ScoringRuleAuthoringManifestV1Schema`、`ScoringRuleAuthoringCandidateV1Schema`、`ScoringRuleValidationPolicyV1Schema`、`AssembleApplicableRuleSetV1Schema`、`AssessmentBasisReleaseSetV1Schema`、闭合原因/结果 Schema 与常量；**新增** `packages/core/src/scoring-rules/index.ts`；**修改** `packages/core/package.json` 增加 `./scoring-rules` export | 全部 strict、`schemaVersion: "1"`、有界数组/字节、规范排序/唯一身份；公共规则直接 parse；Agent 操作只允许 add/replace；候选 `reviewStatus` 固定 pending；文档固定 C15/C18/适用性/版本引用 | 不改 contracts/根 workspace；不添加 delete/upsert/JSON Patch、自由公式或额外审核状态 |
| IP-03 | 核心确定性逻辑和 Agent definition | `有界规范知识编制 Agent` 两场景；`结构化评分规则唯一内容契约` 两场景；`冲突与重叠确定性检测` 两场景；`规则冲突人工审阅` 过期门禁场景；`三维适用性筛选与完整原因` 两场景；D-05～D-07/D-09 | **新增** `packages/core/src/scoring-rules/validation.ts`：`validateScoringRuleOperations`、`materializeScoringRuleDocument`、`detectRuleRelations`、`assembleApplicableRuleSet`、digest/失败映射；**新增** `packages/core/src/scoring-rules/service.ts`：两个 domain tool 协议、`createScoringRuleAuthoringTaskDefinition`、`AssessmentPreparationSnapshotReaderV1`、C16 policy 输入接口；**新增** `packages/core/test/scoring-rules/scoring-rules.test.ts` | 校验顺序固定为操作/base→strict/pending→三维→指标/C18→阈值/区间→例外→证据；按指标+三维交集检测 conflict/overlap 并按闭合优先级固定拟保留/拟筛除版本；逐项决定；三维精确匹配和闭合筛除原因；不可修复冲突不进 correction loop；finalizer 只通过注入的原治理回调返回 revision ref | 不用 LLM 判冲突/适用性；不实现 P/C；不按数组顺序/置信度选边；不测试提示词全文 |
| IP-04 | PostgreSQL 迁移 | `规则冲突人工审阅` 两场景；`授权、事务、幂等与可重放审计` 两场景；D-11/D-12 | **新增** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`：`up`/`down` | 创建 D-11 五表、外键/check/唯一约束/有界索引和 app SELECT/INSERT 权限；down 只逆序删除本迁移对象 | 不回填、不修改 C16/C18 表、provider、中央测试清单；不使用 000029–31 |
| IP-05 | C19 PostgreSQL adapter | `合格且冻结的规范条文输入` 两场景；`有界规范知识编制 Agent` 两场景；`规则冲突人工审阅` 人工放行场景；`结构化规则复用统一定义生命周期` 两场景；`不可变适用规则集组装与人工发布` 两场景；`公共评估依据解析` 两场景；`授权、事务、幂等与可重放审计` 两场景；D-04/D-05/D-07～D-12 | **新增** `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`：`PostgresScoringRulesAdapter`、`prepareRevision`、`appendPreparedRevision`、`assertRevisionMetadata`、`appendRelease`、authoring tool executors/finalizer、`assembleApplicableRuleSetRevision`、`resolve`、pending conflict 补链；**新增** `packages/adapters/src/scoring-rules/index.ts`；**修改** `packages/adapters/package.json` 增加 `./scoring-rules` export | C04 有界读取 C15/规则/指标/规则集工件；C18 resolver 固定配置；C07 pending→幂等 task→link；C16 回调提交修订；发布 applicable set 时发既有 basis event；snapshot reader 注入；basis 集合物化为引用；所有查询先 project/type/ref/time 限界 | 不直读 C25/C11 私表、不发 structured-rule basis event、不复制正文/模型响应、不把孤儿工件/未链冲突当完成 |
| IP-06 | C16 C19 policy 接缝 | `结构化规则复用统一定义生命周期` 两场景；`不可变适用规则集组装与人工发布` 两场景；D-08/D-12 | **修改** `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：options/field/constructor、四个 policy helper 的 C19 type dispatch；**修改** `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`：C19 缺策略阻断、结构化规则/规则集调用相符策略、其它类型/C18 回归 | 保留现有 assessment policy；C19 两类型必须先走 scoring policy；prepared value 只在同命令闭包内传递；policy 异常复用现有错误/rollback 路径 | 不改 C18 生产文件、C16 公共命令/表/生命周期、不引入通用 plugin registry |
| IP-07 | Worker 接入同一 C08 Runner | `有界规范知识编制 Agent` 两场景；D-05 | **新增** `apps/worker/src/scoring-rules/runtime.ts`：`withScoringRuleAuthoringModelStep`、`interpretScoringRuleAuthoringModelStep`；**新增** `apps/worker/test/scoring-rules/runtime.test.ts`；**修改** `apps/worker/src/index.ts` 导出组合函数 | 只对 metadata/policy 精确匹配的 C19 knowledge-authoring 任务渲染 manifest/观察引用与解析 tool-request/candidate；其它任务委派原 callback；协议测试覆盖工具→候选→校验→finalize、预算/模型/工具/权限失败 | 不注册 C17、不吞 C08 错误、不硬编码模型文案、不创建全局 worker 实例 |
| IP-08 | PostgreSQL 端到端与公共接口回归 | 所有 Requirement/Scenario，重点 RA-S3/S4、冲突/不适用全拦截、筛除原因、人工发布和 basis resolve | **新增** `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`；复用 IP-01 adapter fixture；不修改 API/Web | testcontainers 主链：真实 C15 input→C08 candidate→C16 revision→冲突 C07→修订/人工 publish rule→三维 assembly→人工 publish set→public resolve；另覆盖 unauthorized/stale/idempotency/concurrency/audit/outbox/rollback、缺 C18/reader waiting；执行现有 API/C16/C18/Worker 回归 | 不增加 UI、HTTP 分支或 snapshot；不精确断言错误全文/SQL 顺序 |
| IP-09 | 最小全局验证与 OpenSpec 交接 | 全部验证义务；D-13 | 无生产文件；仅运行 §6/§7 命令并核对 `openspec instructions apply --json` | core→adapter→worker 定向测试后运行类型、lint、format、依赖边界、C16/C18/API 回归与 OpenSpec strict；行为/证据完成后才勾 tasks | 不运行全量 `pnpm verify` 替代有界故障定位；不启动 dev server、不提交/归档 |

无删除文件。每个计划文件仅归属上表一个 IP-ID；测试命令/验收义务归属 IP-03、IP-06、IP-07、IP-08 或 IP-09。

## 4. 调用与副作用顺序

### 4.1 规范编制与规则修订（IP-01、IP-03、IP-05、IP-06、IP-07）

1. C19 入口 strict parse 工程、actor、C15 result artifact、C18 policy/as-of、可选 base release 和全部 C08 policy refs；C06 在任何业务读取前校验 `agent-task.start` 与相应资料/知识能力。
2. adapter 调用 C15 已实现的 `readBoundResult`，复验 completed task、result artifact 双向绑定、`available | partial`、保留 segment 和当前资料授权；调用 C18 `resolveConfigurationSet` 固定 11 个配置成员和 indicator-system。
3. 构建 manifest，规范化摘要后先写 C04；以 manifest ref 启动或重放同一个 C08 task。相同幂等身份/载荷返回原 task，不同载荷冲突。
4. Worker 通过现有 Runner 执行；两个 C19 工具每次复验 task/policy/project/source/version/budget，只将有界观察写 C04。模型只能返回 strict add/replace operations。
5. core 按 D-06 逐项校验并 materialize 完整规则文档；可修复项在原预算内返回 correction，权限/来源/版本/冲突直接拒绝。关系检测写 conflict/overlap 候选事实。
6. finalizer 先使规则文档 C04 工件耐久，再以原调用者授权调用 C16 `submit-revision`。C16 在同一事务写 definition/revision、C19 metadata/relations、receipt 和 audit；任一失败整体回滚，孤儿工件不可消费。
7. pending conflict 连同闭合策略计算的拟保留/拟筛除规则先耐久阻断发布，再通过 C07 幂等创建 `rule-conflict` task 并原子追加 link；中断重试只补同一 link。冲突未获精确人工批准时 C19 policy 阻断 `request-review`/publish；过期决定不匹配，批准也只允许拟议处置而不允许双方入集。
8. 冲突处理后的候选获得 C07 `knowledge-revision` 人工批准后，授权用户由 C16 发布新 immutable rule release；正文 `reviewStatus` 仍 pending。Agent 身份、错目标决定或并发 base 漂移均失败。

### 4.2 规则集组装与发布（IP-03、IP-05、IP-06）

1. assembly command strict parse 并校验 `knowledge-modeling.govern`、工程/actor；snapshot reader 提供精确 C01 snapshot 值，C16 resolver 选择 `requiredAt/asOf` 唯一规则 release，C18 resolver返回完整集合。
2. adapter 有界读取规则 artifact，复验 C19 revision metadata、project revision、C15/C18/compatibility digests；任何缺失、停用、跨工程或版本冲突整体失败。
3. core 对候选全集执行三维/例外/冲突/重叠筛选，每条规则恰好一个决定；无成员、决定不完整或 pending conflict 失败。成功结果规范排序并写一个 applicable-set C04 工件。
4. 通过 C16 提交 `applicable-rule-set` revision；C19 metadata 与 revision/audit/receipt 同事务。其后仍走 C16 request-review 与人工批准，不自动发布。
5. publish/rollback 时 C19 policy 复验精确 artifact 和成员发布状态；C16 release、audit、receipt 与一个 `knowledge.assessment-basis-published.v1` 在同一事务。Outbox 失败整体回滚；重复命令返回原 release/event。

### 4.3 公共评估依据解析（IP-05、IP-08）

1. generic API/调用方把公共 `assessment-basis` command 交给 C19 resolver；strict parse 后 C06 校验 `knowledge-modeling.read`。
2. 注入 reader 按 preparation ref 返回公共快照；C19 复验 project、authorization 和 applicability ref，不查询 C25 私表。
3. 以 `requiredAt`/`issuedAt` 解析唯一 applicable-set release 与 C18 set，读取并 strict parse C04 set document，逐项验证 snapshot、rule release、C18 members、compatibility 和发布决定。
4. 尚未发布/准备完成返回 waiting；授权/跨工程/停用/stale/incompatible 返回脱敏 failed。不得回退或部分返回。
5. 成功时以规范成员摘要生成 deterministic basis set ref，在一个 C03 事务写 immutable set、receipt 和 audit；相同命令重放同一 ref。返回公共 `{kind: assessment-basis, assessmentBasisReleaseSetRef}`，正文仍在 C04/C18/C16。

## 5. Schema、状态与持久化落实

### 5.1 Schema 与版本（IP-02、IP-03）

- C19 内部对象全部由 `packages/core/src/scoring-rules/schema.ts` 单一导出，strict、`schemaVersion: "1"`、有界集合；身份集合规范排序，业务序列才保序。
- 公共 `StructuredScoringRuleSchema`、`ApplicabilityMetadataSchema`、Evidence/Knowledge/Review/Agent refs 直接导入；C18 `AssessmentConfigurationReleaseSetV1Schema` 直接导入，不建立兼容镜像。
- `reviewStatus` 只允许 pending；正式准入从 C16 release+decision 读取。实现前后用 `rg -n "reviewStatus" packages apps` 检查没有新增消费门禁。
- 文档 digest 包含 schema、工程修订、C15/C18/规则/适用性/策略精确版本和规范内容；任何输入或策略变化生成新 artifact/revision/set，不复用旧结果。

### 5.2 领域状态（IP-03、IP-05、IP-06）

- Authoring task 状态完全由 C08 管理；C19 只消费 immutable snapshot/candidate/validation/result refs。
- rule relation 状态从 immutable relation + append-only review link/decision 推导：`pending | approved | rejected | returned`；只有 exact approved 允许进入 knowledge review，任何新 rule version 产生新 relation。
- 规则和规则集 revision/release/deactivation/rollback 状态完全由 C16 管理。C19 metadata 只证明内容已校验，不持有“当前发布”指针。
- basis set 为 immutable query/result fact，不提供 update/delete；版本变化由新 command/ref 表达。

### 5.3 表、约束与权限（IP-04）

- 五表及正文边界按 D-11。每表保存 project、精确 version refs、规范 digest、`occurred_at/recorded_at/persisted_at` 和必要 audit/command 身份。
- relation 以 `(project_id, relation_id, version_id)` 主键并唯一约束双方规范 identity+policy+overlap digest；review link 唯一约束 relation+attempt 和 review task ref；basis set 唯一约束 project+preparation ref+required/as-of+member digest。
- FK 只指向同迁移表或已有 C16 revision/release；C04/C07/C08 公共 ref 以 strict JSONB+分解 identity 保存，读取时反向 parse。规则/筛选正文不展开列。
- app role 只获 SELECT/INSERT；迁移 `down` 逆序 revoke/drop 本对象。provider 递归发现 `000028`，不更新注册表。

### 5.4 事务、幂等、失败与审计（IP-05、IP-06、IP-08）

- 使用 C03 `TransactionUnitV1`、`AtomicCommandV1` 和 canonical digest；副作用集合见 §4。对外动作前意图耐久，C07/C08 调用按原 idempotency key 补偿。
- 授权/来源/冲突/版本失败不可修正；C04/DB/C07/C08 暂态错误可按原策略重试但不得换模型、扩大预算或跳过 Agent/人工门禁。
- 日志、错误、audit、receipt、event 只含引用、reason code、摘要和计数；原文、规则/config 正文、凭据、模型响应和内部 SQL 错误不复制。
- 可观测证据以现有 C03 audit/outbox、C08 action/usage 和 C19 relation/metadata refs 组成，不新建日志表或事件类型。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 合格且冻结的规范条文输入 / 真实规范资料段进入知识编制 | IP-01、IP-05、IP-08 | adapter fixture + adapter test | C15 completed、获准真实标准/版本/segment、当前授权 | manifest 精确绑定且规则证据反向定位同一 segment | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '真实规范'` |
| 合格且冻结的规范条文输入 / 排除或未授权资料段被拒绝 | IP-01、IP-05 | adapter test | excluded segment / revoked grant | 模型调用数 0、无 candidate/revision | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '来源门禁'` |
| 有界规范知识编制 Agent / Agent 只形成候选修订 | IP-03、IP-05、IP-07 | core + worker + adapter tests | exact C08 refs | completed result 仅 revision+validation；无 release | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts apps/worker/test/scoring-rules/runtime.test.ts` |
| 有界规范知识编制 Agent / 越权动作直接失败 | IP-03、IP-05、IP-07 | worker + adapter tests | publish/unknown tool/out-of-manifest requests | 拒绝、预算/证据保留、无业务发布 | `pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts -t '越权'` |
| 结构化评分规则唯一内容契约 / 完整规则通过内容校验 | IP-02、IP-03 | core test | three-dimensional rule + C18 indicator | accepted once、规范 digest/证据 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '内容校验'` |
| 结构化评分规则唯一内容契约 / 不完整或悬空规则被拒绝 | IP-02、IP-03 | core test | table-driven missing dimension/indicator/gap/overlap/evidence | 每项稳定 reason、无 materialized member | 同上 |
| 冲突与重叠确定性检测 / 冲突规则全部被拦截 | IP-03、IP-05、IP-08 | core + adapter tests | same indicator/applicability, different conclusion | one symmetric conflict、publish blocked | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '冲突'` |
| 冲突与重叠确定性检测 / 等价重叠被完整记录 | IP-03、IP-08 | core + adapter tests | same conclusion overlapping intervals | overlap range/evidence + deterministic retained/excluded | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '重叠'` |
| 规则冲突人工审阅 / 人工决定解除精确冲突门禁 | IP-04～IP-06、IP-08 | adapter test | C07 exact approve + new valid candidate | exact relation/proposal approved、仅 retained rule 入集、knowledge review allowed | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '冲突审阅'` |
| 规则冲突人工审阅 / 过期决定不能放行 | IP-03、IP-05、IP-08 | adapter test | decision targets prior relation version | stale rejected、new relation pending | 同上 |
| 结构化规则复用统一定义生命周期 / 人工批准后形成不可变规则发布 | IP-05、IP-06、IP-08 | C16 + adapter tests | knowledge-review exact approval | one immutable release、decision chain replayable | `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` |
| 结构化规则复用统一定义生命周期 / Agent 或未审核修订不能发布 | IP-05、IP-06、IP-08 | C16 + adapter tests | Agent actor / no approval | failed、active release unchanged | 同上 |
| 三维适用性筛选与完整原因 / 三维匹配规则被纳入 | IP-02、IP-03 | core test | exact method/stratum/stage | included once + three match evidence | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '三维适用性'` |
| 三维适用性筛选与完整原因 / 不适用规则全部筛除 | IP-02、IP-03、IP-08 | core + adapter tests | mismatch each dimension + exception | every candidate one exclusion reason、members absent | 同上 |
| 不可变适用规则集组装与人工发布 / RA-S3/S4 形成适用规则集 | IP-01、IP-03、IP-05、IP-06、IP-08 | adapter test | published real rule + complete C18 + snapshot + two approvals | candidate then immutable set release; Agent no approval | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'RA-S3/S4'` |
| 不可变适用规则集组装与人工发布 / 配置或冲突不完整时整体失败 | IP-03、IP-05、IP-08 | adapter test | missing C18 / incompatible / pending conflict | no partial artifact/release/basis | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '规则集门禁'` |
| 公共评估依据解析 / 精确依据可供后续评估冻结 | IP-05、IP-08 | adapter test + API regression | reader returns exact prep; valid releases | public strict success ref; stored members exact | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'assessment-basis' && pnpm exec vitest run apps/api/test/http-shell.test.ts` |
| 公共评估依据解析 / 未准备完成时不返回默认依据 | IP-05、IP-08 | adapter test | missing set/member/reader waiting | waiting/failed; no fallback/partial | 同上 |
| 授权、事务、幂等与可重放审计 / 重放返回同一结果 | IP-04～IP-06、IP-08 | adapter test | same/different payload key, concurrent calls | same refs/counts; mismatch conflict | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '幂等'` |
| 授权、事务、幂等与可重放审计 / 任一原子副作用失败即回滚 | IP-04～IP-06、IP-08 | adapter test | audit/outbox/metadata/basis insert fault | zero partial DB facts/events; sanitized failure | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '回滚'` |

说明：Vitest 的 `-t` 参数、多个文件参数均已由已安装 Vitest CLI 支持；实际测试标题必须保留矩阵中的关键词，避免命令命中零测试。不得精确断言完整错误文案，只断言公共 code、reason 类别、结构化引用和副作用计数。

## 7. 文件清单与升级条件

### 7.1 新增文件

- IP-01：`packages/core/test/scoring-rules/fixture.ts`、`packages/adapters/test/scoring-rules/fixture.ts`
- IP-02：`packages/core/src/scoring-rules/schema.ts`、`packages/core/src/scoring-rules/index.ts`
- IP-03：`packages/core/src/scoring-rules/validation.ts`、`packages/core/src/scoring-rules/service.ts`、`packages/core/test/scoring-rules/scoring-rules.test.ts`
- IP-04：`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`
- IP-05：`packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`、`packages/adapters/src/scoring-rules/index.ts`
- IP-07：`apps/worker/src/scoring-rules/runtime.ts`、`apps/worker/test/scoring-rules/runtime.test.ts`
- IP-08：`packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`

### 7.2 修改文件

- IP-02：`packages/core/package.json`
- IP-05：`packages/adapters/package.json`
- IP-06：`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`、`packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`
- IP-07：`apps/worker/src/index.ts`

### 7.3 删除文件

无。

### 7.4 保护区

禁止修改：`packages/contracts/**`、`packages/core/src/assessment-config/**`、`packages/adapters/src/assessment-config/**`、根 workspace/lock、`openspec/config.yaml`、migration provider/中央注册与测试清单、主 specs、归档/其它 changes、C15/C17/C18 生产代码（C18 路径已单独列为绝对保护）、API/Web 生产文件。不得新增依赖、Mock/占位/默认规则、开发服务器、提交或归档。

### 7.5 必须升级的条件

1. HEAD/base 或 C08/C16/C18 现有符号、C15 集成后的 `DataCleaningResultV1`/结果读取接缝与本计划不一致，导致计划文件、公共输入或任务拆分变化。
2. 生产代码出现将 `StructuredScoringRule.reviewStatus` 作为审核/评分门禁的消费者，或 C25 必须这样消费。
3. 无法取得获准的真实规范资料段 fixture，或必须读取原始 Office/逐篇研究材料、自由联网、未授权全文才能验收。
4. 需要修改 contracts、C18 生产代码、C25/C11 私表、API/Web、旧迁移/中央清单，或 `000028` 已被占用。
5. C08 一个 Registry 实例必须同时注册 C17 与 C19 两个不同 `knowledge-authoring` definitions，且现有 composition 所有权不允许分开实例/后续组合。
6. C07 pending-link 补偿无法保持“失败永不误放行”，C03 无法包住列明的原子集合，或 C16 policy 接缝要求通用框架/公共接口演进。
7. 规则阈值确需高于公共 number 契约的十进制精度、业务要求非闭合冲突优先级/新枚举，或规则集需要同一工程同一时刻多个活跃 C16 stable definitions。
8. 任何新增第三方依赖、公共契约、数据迁移/回填、权限扩大、范围扩大或计划外生产文件。

## 8. 已核实的执行命令

定向行为验证：

```bash
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts
pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts
pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts
pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts apps/api/test/http-shell.test.ts
```

静态、格式与边界验证：

```bash
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/scoring-rules packages/core/test/scoring-rules packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts apps/worker/src/scoring-rules apps/worker/test/scoring-rules
pnpm exec prettier --check packages/core/src/scoring-rules packages/core/test/scoring-rules packages/core/package.json packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/package.json packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts apps/worker/src/scoring-rules apps/worker/test/scoring-rules apps/worker/src/index.ts
pnpm deps:check
pnpm deps:policy
rg -n "reviewStatus" packages apps
```

OpenSpec 完成门：

```bash
openspec validate deliver-structured-scoring-rules-and-applicable-rule-sets --type change --strict --no-interactive
openspec instructions apply --change deliver-structured-scoring-rules-and-applicable-rule-sets --json
```

以上命令名称、脚本和现有回归文件均已在固定 worktree 核实存在；新增测试路径由对应 IP 创建后执行。实现 Agent 完成行为与证据、逐项勾选 tasks 后，再交给 `openspec-verify-change` 独立验证；本 change 实施阶段仍不提交、不归档。
