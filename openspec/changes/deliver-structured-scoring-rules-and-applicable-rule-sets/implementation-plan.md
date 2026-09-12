# Implementation Plan

## 1. 实施基线与权威来源

- 固定代码基线：`c5f26d7f5d158fa2f37fbaa7d571631af4b69eae`；规划分支 `leike0813/c19-scoring-rules`，change 为 `deliver-structured-scoring-rules-and-applicable-rule-sets`。
- `openspec status --change deliver-structured-scoring-rules-and-applicable-rule-sets --json` 已确认 `schemaName: riskflow-delivery`。行为事实源为本 change 的 proposal、`knowledge/structured-scoring-rules-and-applicable-rule-sets` delta spec 与 `design.md`；实现 Agent 必须先完整读取 `openspec instructions apply --change ... --json` 返回的全部 `contextFiles`。
- 已归档直接依赖：C08 `deliver-unified-bounded-agent-runtime`、C15 `deliver-agent-cleaning-and-partial-availability`、C16 `deliver-governed-definition-lifecycle`、C18 `deliver-assessment-configuration-and-measure-governance`。C15 当前生产事实为 `DataCleaningResultV1Schema`、`PostgresDataCleaningStore` 公共 task/freeze 方法及私有 `#readBoundResult`；C19 按 D-15/IP-11 补公共薄包装，不从归档规划臆造其它符号。
- 主契约事实源：C01/C02 的 contracts 与主 specs、C07 审阅主 spec、C08/C16/C18 主 specs及当前生产代码。研究语义只来自 `references/风险识别与评估规划事实源摘要.md`，不得读取原始 Office 或逐篇转换材料补设计。
- 实施前硬门：C15 已归档集成且 `DataCleaningResultV1Schema`、私有 `#readBoundResult`、`#finalizePreparation` 与公共 task/freeze 面无漂移；C08/C16/C18 符号无漂移；仓库生产代码仍无 `reviewStatus` 准入消费者；存在一条获准、可核验来源版本和资料段定位的真实规范 fixture。除已批准 IP-11 的公共包装外，任一不满足都由 IP-01 停止并通过协调端升级，禁止先实现其它 IP。
- 版本与工具已在当前 worktree 核实：Node `v24.12.0`、pnpm `11.10.0`、Vitest `4.1.11`、TypeScript `5.9.3`、Prettier `3.9.6`、OpenSpec `1.13.0`；下文只使用根 `package.json` 已有脚本或这些已安装 CLI。
- 不新增依赖。迁移使用分配号段中的 `000028`，不占用 `000029–000031`，不修改生产 migration provider/runner；按协调端授权机械同步 `packages/adapters/test/postgres/postgres-foundation.test.ts` 与 `packages/adapters/test/auth/fixture.ts` 的显式测试迁移条目。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | contracts 的 `StructuredScoringRuleSchema`、`ApplicabilityMetadataSchema`、`KnowledgeResolutionCommandV1Schema`；C15 已归档主 spec、`DataCleaningResultV1Schema` 与生产实现 | 用 strict parse 与真实规范 fixture 证明前置契约可消费 | 不修改 contracts，不复制 C15 私有 schema，不用合成条文代替出口 |
| IP-02 | `packages/core/src/assessment-config/schema.ts` 的 C18 集合/成员；contracts `ScoringThreshold`、`GradeInterval` 及 common/records/ports refs | 直接组合已有类型形成 C19 两类文档、manifest、操作、命令和成员投影 Schema | 不重定义三维/阈值/等级字段、定义枚举、C18 11 类配置或审核状态 |
| IP-03 | C08 `AgentTaskDefinitionV1`、`buildCompletedAgentTaskResult`；core `sha256CanonicalJson`；C18 `assessmentConfigurationDocumentDigest`、`validateAssessmentConfigurationSet`/成员索引方式 | 实现并导出唯一边界归一/评分求值、规则级校验、materialize、内容摘要、关系检测、筛选和 C08 definition | 不复制 Runner、预算台账、边界算法、C18 内容校验或 C16 生命周期 |
| IP-04 | 迁移 `000007_governed_definition_lifecycle.ts`、`000012_assessment_configuration.ts`、递归 provider，以及 PostgreSQL/auth 测试的显式 migration module 清单 | 沿现有 Kysely 迁移、三时态、角色权限、复合约束范式新增 C19 表；只在两处测试 loader/manifest 机械加入 `000028` | 不改旧表、生产 provider/runner、发现算法或历史数据 |
| IP-05 | C04 `ArtifactStoreV1`；C07 `ReviewAuditPortV1`；C08 `AgentTaskPortV1`；C18 `PostgresAssessmentConfigurationAdapter.resolveConfigurationSet`；IP-11 的 C15 reader | 组合受权 C15 结果读取、Agent finalizer、冲突补链、规则集组装与 basis resolve | 不直读 C15/C18/C25 私表，不建立第二审阅/任务/审计体系 |
| IP-06 | `PostgresKnowledgeGovernanceAdapter` 的 `#prepareAssessmentConfigurationRevision`、`#appendPreparedAssessmentConfigurationRevision`、`#assertAssessmentConfigurationRevisionMetadata`、`#appendAssessmentConfigurationRelease` | 在相同四个接缝加入 C19 两类定义的专用 policy 分派 | 不修改 C18 adapter，不抽象通用插件框架，不改变其它类型行为 |
| IP-07 | `apps/worker/src/agent-runtime/runner.ts` 的 `renderModelStep`/`interpretModelStep` callbacks | 以组合函数接入 C19 renderer/interpreter，仍使用同一 Runner | 不创建全局 registry、第二 Runner、模型网关或自然语言写命令 |
| IP-08 | C16/C18/PostgreSQL 测试 fixture 和 API 通用知识路由 | 一条集成主链验证治理、冲突、筛选、发布、解析、事务和重放 | 不为文案/内部顺序加断言，不增加 C19 API/Web 入口 |
| IP-09 | 根 `typecheck`、`lint`、`format:check`、`deps:check`、`deps:policy` 与 OpenSpec CLI | 执行最小全局静态/边界/规格校验并形成验收证据 | 不启动开发服务器、不安装依赖、不提交或归档 |
| IP-10 | contracts `AssessmentBasisReleaseSetRefV1Schema`/`AuthorizationContextV1Schema`/`ModuleErrorV1Schema`；C06 `LocalIdentityAccessV1.verify`；C18 `AssessmentConfigurationMemberV1Schema`；本计划 IP-02 的 `ApplicableRuleSetDocumentV1Schema`/`AssessmentBasisReleaseSetV1Schema` 与 IP-05 的 `PostgresScoringRulesAdapter.resolve`/`business.assessment_basis_release_sets` | 在 C19 core 内组合既有叶子引用形成 strict 适用规则集、纳入规则发布和 11 类配置成员投影；由 basis resolve 从 included refs 原子派生，由同一 C19 adapter 按当前授权单点读取 | 不修改 C02/contracts/C18/C25，不返回正文，不增加 list/search/HTTP/repository 抽象，不让幂等回执绕过撤权 |
| IP-11 | `PostgresDataCleaningStore.#readBoundResult`、`#finalizePreparation`、`#verify`、`#readJson`/`#readBytes`；core `DataCleaningResultV1Schema` 与仅供 C08 执行的 `DataCleaningTaskPortV1` | 在 concrete store 增加公共 `readBoundResult(input)` 薄包装，复用私有单点查询、strict parse、C04 受权读取和任务—结果绑定；C19 通过 `Pick<PostgresDataCleaningStore, "readBoundResult">` 注入消费 | 不扩展 contracts/core task port，不复制查询/解析，不改 C15 表、迁移、冻结路径行为或提供正文/list/search/latest 旁路 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置契约与验收夹具 | `合格且冻结的规范条文输入` 两场景；`不可变适用规则集组装与人工发布 / RA-S3/S4 形成适用规则集` | **新增** `packages/core/test/scoring-rules/fixture.ts`：公共规则/三维/C18 ref builders；**新增** `packages/adapters/test/scoring-rules/fixture.ts`：C03/C04/C07/C08/C15/C16/C18 组合 fixture、真实规范输入 builder | 先用已集成生产导出和 strict Schema 构造 C15 completed result；真实规范只保留获准最小资料段、标准身份、来源版本和 segment locator；提供冲突、不适用、故障注入开关 | 无 C15 时不建本地替身；不读取研究原件；不 Mock 后端；不写未经许可的完整规范正文 |
| IP-02 | C19 strict Schema 与子路径 | `结构化评分规则唯一内容契约` 全部场景；`三维适用性筛选与完整原因` 两场景；D-01～D-04/D-06 | **新增** `packages/core/src/scoring-rules/schema.ts`：`StructuredScoringRuleDocumentV1Schema`、`ApplicableRuleSetDocumentV1Schema`、`ScoringRuleAuthoringManifestV1Schema`、`ScoringRuleAuthoringCandidateV1Schema`、`ScoringRuleValidationPolicyV1Schema`、`ScoringRuleEvaluationResultV1Schema`、`AssembleApplicableRuleSetV1Schema`、`AssessmentBasisReleaseSetV1Schema`、闭合原因/结果 Schema 与常量；**新增** `packages/core/src/scoring-rules/index.ts`；**修改** `packages/core/package.json` 增加 `./scoring-rules` export | 全部 strict、`schemaVersion: "1"`、有界数组/字节、规范排序/唯一身份；求值结果只允许 evaluated 的 threshold/score/grade 或 type-mismatch/out-of-range 拒绝；公共规则直接 parse；Agent 操作只允许 add/replace；候选 `reviewStatus` 固定 pending；文档固定 C15/C18/适用性/版本引用；不新增闭合性字段 | 不改 contracts/根 workspace；不添加 delete/upsert/JSON Patch、自由公式、逐规则闭合配置或额外审核状态 |
| IP-03 | 核心确定性逻辑和 Agent definition | `有界规范知识编制 Agent` 两场景；`结构化评分规则唯一内容契约` 全部场景；`冲突与重叠确定性检测` 两场景；`规则冲突人工审阅` 过期门禁场景；`三维适用性筛选与完整原因` 两场景；D-05～D-07/D-09 | **新增** `packages/core/src/scoring-rules/validation.ts`：`normalizeScoringThresholds`、`normalizeGradeIntervals`、`evaluateScoringRule`、`validateScoringRuleOperations`、`materializeScoringRuleDocument`、`structuredScoringRuleDocumentDigest`、`applicableRuleSetDocumentDigest`、`detectRuleRelations`、`assembleApplicableRuleSet`、失败映射；**新增** `packages/core/src/scoring-rules/service.ts`：两个 domain tool 协议、`createScoringRuleAuthoringTaskDefinition`、`AssessmentPreparationSnapshotReaderV1`、C16 policy 输入接口；**新增** `packages/core/test/scoring-rules/scoring-rules.test.ts`；由 `packages/core/src/scoring-rules/index.ts` 导出上述公共 helper | 固定 `between=[value, upperValue)`、其余 operator 字面开闭及 grade 左闭右开/缺界无穷语义；归一校验排序、端点、连续性、重叠和内部空洞，有限外边界越界返回结构化失败；校验和 `detectRuleRelations` 只调用同一 helper；其后按指标+三维交集检测 conflict/overlap、逐项决定并保持既有 Agent/finalizer 门禁 | 不让 C19/C25 复制边界算法；不增加 contracts 字段；不用 LLM 判冲突/适用性；不实现 P/C、权重或矩阵；不按数组顺序/置信度选边；不测试提示词全文 |
| IP-04 | PostgreSQL 迁移 | `规则冲突人工审阅` 两场景；`授权、事务、幂等与可重放审计` 两场景；D-11/D-12 | **新增** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`：`up`/`down`；**修改** `packages/adapters/test/postgres/postgres-foundation.test.ts`：导入迁移并在 `testMigrationManifest` 按 sequence `28` 登记；**修改** `packages/adapters/test/auth/fixture.ts`：导入迁移并在 `migrationModules` 加入精确路径映射 | 创建 D-11 五表、外键/check/唯一约束/有界索引和 app SELECT/INSERT 权限；down 只逆序删除本迁移对象；两处测试清单只机械加入 `000028` module/path/name/sequence，使现有递归发现和 auth fixture loader 可运行 | 不回填、不修改 C16/C18 表、生产 provider/runner、发现算法；不使用 000029–31，不改其它清单条目 |
| IP-05 | C19 PostgreSQL adapter | `合格且冻结的规范条文输入` 两场景；`C15 清洗结果有界读取 / 当前授权读取清洗结果与工件引用`；`有界规范知识编制 Agent` 两场景；`规则冲突人工审阅` 人工放行场景；`结构化规则复用统一定义生命周期` 两场景；`不可变适用规则集组装与人工发布` 两场景；`公共评估依据解析` 两场景；`授权、事务、幂等与可重放审计` 两场景；D-04/D-05/D-07～D-12/D-15 | **新增** `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`：`PostgresScoringRulesAdapterOptionsV1` 注入 `Pick<PostgresDataCleaningStore, "readBoundResult">`，并新增 `PostgresScoringRulesAdapter`、`prepareRevision`、`appendPreparedRevision`、`assertRevisionMetadata`、`appendRelease`、authoring tool executors/finalizer、`assembleApplicableRuleSetRevision`、`resolve`、pending conflict 补链；**新增** `packages/adapters/src/scoring-rules/index.ts`；**修改** `packages/adapters/package.json` 增加 `./scoring-rules` export | authoring prepare 只经 IP-11 reader 取得 C15 strict result/result artifact，先拒绝不可用/排除输入再做 C04 有界规则/指标/规则集读取；C18 resolver 固定配置；C07 pending→幂等 task→link；C16 回调提交修订；发布 applicable set 时发既有 basis event；snapshot reader 注入；basis 集合物化为引用 | 不直读 C15/C25/C11 私表、不调用 C15 私有 helper、不另开 C15 结果工件、不发 structured-rule basis event、不复制正文/模型响应、不把孤儿工件/未链冲突当完成 |
| IP-06 | C16 C19 policy 接缝 | `结构化规则复用统一定义生命周期` 两场景；`不可变适用规则集组装与人工发布` 两场景；D-08/D-12 | **修改** `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：options/field/constructor、四个 policy helper 的 C19 type dispatch；**修改** `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`：C19 缺策略阻断、结构化规则/规则集调用相符策略、其它类型/C18 回归 | 保留现有 assessment policy；C19 两类型必须先走 scoring policy；prepared value 只在同命令闭包内传递；policy 异常复用现有错误/rollback 路径 | 不改 C18 生产文件、C16 公共命令/表/生命周期、不引入通用 plugin registry |
| IP-07 | Worker 接入同一 C08 Runner | `有界规范知识编制 Agent` 两场景；D-05 | **新增** `apps/worker/src/scoring-rules/runtime.ts`：`withScoringRuleAuthoringModelStep`、`interpretScoringRuleAuthoringModelStep`；**新增** `apps/worker/test/scoring-rules/runtime.test.ts`；**修改** `apps/worker/src/index.ts` 导出组合函数 | 只对 metadata/policy 精确匹配的 C19 knowledge-authoring 任务渲染 manifest/观察引用与解析 tool-request/candidate；其它任务委派原 callback；协议测试覆盖工具→候选→校验→finalize、预算/模型/工具/权限失败 | 不注册 C17、不吞 C08 错误、不硬编码模型文案、不创建全局 worker 实例 |
| IP-08 | PostgreSQL 端到端与公共接口回归 | 所有 Requirement/Scenario，重点 RA-S3/S4、冲突/不适用全拦截、筛除原因、人工发布和 basis resolve | **新增** `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`；复用 IP-01 adapter fixture；不修改 API/Web | testcontainers 主链：真实 C15 input→C08 candidate→C16 revision→冲突 C07→修订/人工 publish rule→三维 assembly→人工 publish set→public resolve；另覆盖 unauthorized/stale/idempotency/concurrency/audit/outbox/rollback、缺 C18/reader waiting；执行现有 API/C16/C18/Worker 回归 | 不增加 UI、HTTP 分支或 snapshot；不精确断言错误全文/SQL 顺序 |
| IP-09 | 最小全局验证与 OpenSpec 交接 | 全部验证义务；D-13 | 无生产文件；仅运行 §6/§7 命令并核对 `openspec instructions apply --json` | core→adapter→worker 定向测试后运行类型、lint、format、依赖边界、C16/C18/API 回归与 OpenSpec strict；行为/证据完成后才勾 tasks | 不运行全量 `pnpm verify` 替代有界故障定位；不启动 dev server、不提交/归档 |
| IP-10 | C19 评估依据成员有界读取 | `评估依据发布集合成员的有界读取` 全部场景；D-10/D-11/D-12/D-14 | **扩展 IP-02 新增文件** `packages/core/src/scoring-rules/schema.ts`：`ReadAssessmentBasisReleaseSetV1Schema`、`AssessmentBasisReleaseSetMembersV1Schema`、`AssessmentBasisReleaseSetReadResultV1Schema`；**扩展 IP-03 新增文件** `packages/core/src/scoring-rules/service.ts`：`AssessmentBasisReleaseSetReaderV1.readAssessmentBasisReleaseSet`，`packages/core/src/scoring-rules/validation.ts`：`structuredScoringRuleDocumentDigest`、`applicableRuleSetDocumentDigest`；`packages/core/src/scoring-rules/index.ts` 继续统一导出；**扩展 IP-04 迁移** `000028_structured_scoring_rules.ts`：`business.assessment_basis_release_sets.member_snapshot` strict JSONB；**扩展 IP-05 新增文件** `postgres-scoring-rules-adapter.ts`：options 注入 `Pick<LocalIdentityAccessV1, "verify">`，`PostgresScoringRulesAdapter.readAssessmentBasisReleaseSet`、basis resolve 的 included refs→规则发布成员解析、精确集合/audit 单点查询和错误映射；**扩展 IP-03/IP-08 测试** core 与 PostgreSQL 既定测试文件 | 请求只用精确 set ref、authorization 及 C03 request 元数据；当前授权复验先于回执和 DB 查询；成功只投影 set ref/schema version/`memberDigest`、`applicableRuleSetMember{releaseRef,revisionRef,artifactRef,contentDigest}`、规范排序且与 included refs 来源发布精确一致的 `scoringRuleMembers[]`，以及 11 个 `{definitionType,releaseRef,revisionRef,artifactRef,contentDigest}`；basis resolve 从 strict 规则集正文派生规则成员并同事务保存 snapshot，缺失/重复/额外成员整体失败；读时复验 strict snapshot 与 `memberDigest`，C25 经 C04 读取正文并用拥有方 digest helper 复算每个 `contentDigest`；成功/不可用共用请求 set ref 作为 C03 resultRef，以闭合 audit action 经 `auditEntryId` 重建幂等结果 | 不改公共 resolve 形状，不返回 release/config/rule 正文、自由字段或未发布成员；不复制 C18/C19 私有事实或 digest 算法到 C25；不存在/成员缺失/撤权/跨工程/不可见不得返回差异化 code/payload；不增加结果表、迁移文件或占用 `000029–000031` |
| IP-11 | C15 清洗结果公共只读接缝 | `C15 清洗结果有界读取` 四场景；D-04/D-12/D-15 | **修改** `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`：新增公共 `PostgresDataCleaningStore.readBoundResult(input)`，复用 `#readBoundResult`，并用既有 `TransactionUnitV1` 写读取回执/审计；**修改** `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`：新增有界读取行为测试；**扩展 IP-08 新增测试** `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`：证明 C19 只经注入 reader 消费 | 入参精确为 `{projectId, actorId, requestId, requestedAt, authorization, taskRef}`；先校验授权上下文 actor/project 并固定用 C06 `engineering-data.evidence-access`/`engineering-data.read` 当前复验，再调用私有单点读取；成功后以 requestId 与规范载荷原子写 C03 `engineering-data.read-data-cleaning-result` 回执/审计；成功返回 `{kind:"ok", result:DataCleaningResultV1, resultArtifactRef}`；授权/跨工程/缺失/不可见/绑定失配统一不可重试拒绝；同键同载荷重放不重复 C03/C04 审计，同键异 taskRef 冲突，撤权不重放旧成功 | 不枚举 capability 对应分支，不复制 `#readBoundResult` 查询/解析，不改 `#finalizePreparation` 对私有方法的调用和既有错误，不改 `DataCleaningTaskPortV1`/contracts、表/迁移，不返回原始资料正文、C04 handle、list/search/latest，不吞瞬时技术失败 |

无删除文件。IP-10 只扩展 IP-02～IP-05/IP-08 已规划文件，不新增文件；IP-11 只修改一个 C15 所有权生产文件、其既有测试，并扩展 IP-08 已规划测试。其余计划文件仍各归属一个 IP-ID。测试命令/验收义务归属 IP-03、IP-04、IP-06～IP-11。

## 4. 调用与副作用顺序

### 4.1 规范编制与规则修订（IP-01、IP-03、IP-05、IP-06、IP-07、IP-11）

1. C19 入口 strict parse 工程、actor、C15 result artifact、C18 policy/as-of、可选 base release 和全部 C08 policy refs；C06 在任何业务读取前校验 `agent-task.start` 与相应资料/知识能力。
2. adapter 调用注入的 `PostgresDataCleaningStore.readBoundResult({projectId, actorId, requestId, requestedAt, authorization, taskRef})`。该公共薄包装先复验 actor/project 与固定 C06 `engineering-data.evidence-access`/`engineering-data.read` 当前授权，不做 branch 枚举；再复用私有 `#readBoundResult` 的 `projectId + taskRef` 单点索引、C04 结果工件读取、strict `DataCleaningResultV1Schema` 和任务—结果双向绑定。成功后以 requestId/规范载荷写 C03 只追加读取回执与审计；授权/跨工程/缺失/不可见/失配统一拒绝，同键同载荷重放不重复 C03/C04 审计，同键异 taskRef 冲突，撤权先于旧回执重放。成功只返回 result 与 `resultArtifactRef`；C19 随后只接受 `available | partial` 中未被排除的 segment，并调用 C18 `resolveConfigurationSet` 固定 11 个配置成员和 indicator-system。
3. 构建 manifest，规范化摘要后先写 C04；以 manifest ref 启动或重放同一个 C08 task。相同幂等身份/载荷返回原 task，不同载荷冲突。
4. Worker 通过现有 Runner 执行；两个 C19 工具每次复验 task/policy/project/source/version/budget，只将有界观察写 C04。模型只能返回 strict add/replace operations。
5. core 按 D-06 调用 `normalizeScoringThresholds`/`normalizeGradeIntervals` 逐项校验并以 `evaluateScoringRule` 固定端点与越界行为，再 materialize 完整规则文档；可修复项在原预算内返回 correction，权限/来源/版本/冲突直接拒绝。关系检测复用同一归一结果写 conflict/overlap 候选事实。
6. finalizer 先使规则文档 C04 工件耐久，再以原调用者授权调用 C16 `submit-revision`。C16 在同一事务写 definition/revision、C19 metadata/relations、receipt 和 audit；任一失败整体回滚，孤儿工件不可消费。
7. pending conflict 连同闭合策略计算的拟保留/拟筛除规则先耐久阻断发布，再通过 C07 幂等创建 `rule-conflict` task 并原子追加 link；中断重试只补同一 link。冲突未获精确人工批准时 C19 policy 阻断 `request-review`/publish；过期决定不匹配，批准也只允许拟议处置而不允许双方入集。
8. 冲突处理后的候选获得 C07 `knowledge-revision` 人工批准后，授权用户由 C16 发布新 immutable rule release；正文 `reviewStatus` 仍 pending。Agent 身份、错目标决定或并发 base 漂移均失败。

### 4.2 规则集组装与发布（IP-03、IP-05、IP-06）

1. assembly command strict parse 并校验 `knowledge-modeling.govern`、工程/actor；snapshot reader 提供精确 C01 snapshot 值，C16 resolver 选择 `requiredAt/asOf` 唯一规则 release，C18 resolver返回完整集合。
2. adapter 有界读取规则 artifact，复验 C19 revision metadata、project revision、C15/C18/compatibility digests；任何缺失、停用、跨工程或版本冲突整体失败。
3. core 对候选全集执行三维/例外/冲突/重叠筛选；冲突/重叠继续复用 D-06 的归一边界，每条规则恰好一个决定。无成员、决定不完整或 pending conflict 失败；成功结果规范排序并写一个 applicable-set C04 工件。
4. 通过 C16 提交 `applicable-rule-set` revision；C19 metadata 与 revision/audit/receipt 同事务。其后仍走 C16 request-review 与人工批准，不自动发布。
5. publish/rollback 时 C19 policy 复验精确 artifact 和成员发布状态；C16 release、audit、receipt 与一个 `knowledge.assessment-basis-published.v1` 在同一事务。Outbox 失败整体回滚；重复命令返回原 release/event。

### 4.3 公共评估依据解析（IP-05、IP-08）

1. generic API/调用方把公共 `assessment-basis` command 交给 C19 resolver；strict parse 后 C06 校验 `knowledge-modeling.read`。
2. 注入 reader 按 preparation ref 返回公共快照；C19 复验 project、authorization 和 applicability ref，不查询 C25 私表。
3. 以 `requiredAt`/`issuedAt` 解析唯一 applicable-set release 与 C18 set，读取并 strict parse C04 set document，逐项验证 snapshot、rule release、C18 members、compatibility 和发布决定。
4. 尚未发布/准备完成返回 waiting；授权/跨工程/停用/stale/incompatible 返回脱敏 failed。不得回退或部分返回。
5. 成功时从 strict applicable-set `included refs` 解析并规范化其规则发布成员，连同适用规则集成员和 C18 的 11 个完整成员计算 `memberDigest`；任一 included ref 缺少 C16 revision/artifact/content digest、成员重复/额外或不相符则整体失败。在一个 C03 事务写 immutable set/member snapshot、receipt 和 audit；相同命令重放同一 ref。返回公共 `{kind: assessment-basis, assessmentBasisReleaseSetRef}`，正文仍在 C04/C18/C16。

### 4.4 评估依据成员有界读取（IP-10）

1. C25 等进程内消费方提交 strict 请求：精确 `assessmentBasisReleaseSetRef`、C06 `authorization`、`requestId`、`idempotencyKey` 和 `requestedAt`；没有 project/name/latest/list 参数。
2. adapter 先调用注入的 `LocalIdentityAccessV1.verify`，按 `knowledge-modeling.assessment-basis` 和当前时间复验授权上下文引用、工程与 `knowledge-modeling.read`；验证失败直接映射统一不可用结果并由 C06 记录安全拒绝，不读取 C19 表或历史成功回执。
3. 授权通过后，adapter 以验证结果的 `projectId` 和精确 set ref 单点查询 `business.assessment_basis_release_sets`，strict parse `member_snapshot`，复验 schema 版本、set ref、完整 `memberDigest`、适用规则集成员、按 release identity 规范排序且唯一的规则成员，以及规范排序且恰好 11 类的配置成员。零行、跨工程、成员缺失或不可见对调用方均为同一个不可重试 `AUTHORIZATION_DENIED` 形状；瞬时数据库失败保持 `TRANSIENT_FAILURE`。
4. 成功只返回 strict 引用与摘要投影，不打开 C04 工件；消费方必须以 `applicableRuleSetMember`、`scoringRuleMembers` 和 `configurationMembers` 的 `artifactRef` 另行调用 C04 并接受其当前授权与访问审计，分别调用 C19/C18 拥有方摘要 helper 复算 `contentDigest`，并断言规则集 `included refs` 的规范投影与 `scoringRuleMembers` 完全一致。
5. 授权后的成功或统一不可用结果以 `knowledge.read-assessment-basis-release-set.v1` 规范载荷进入既有 C03 transaction/receipt/audit，两者都以请求 set ref 作为 `resultRef`，audit action 分别固定为 `.succeeded`/`.unavailable`。回执重放按 `auditEntryId` 单点读取闭合 action 并重建原结果；同键同载荷不重复 audit，同键异载荷冲突。瞬时失败不完成回执，reader 无业务 update/delete/event 副作用。

## 5. Schema、状态与持久化落实

### 5.1 Schema 与版本（IP-02、IP-03）

- C19 内部对象全部由 `packages/core/src/scoring-rules/schema.ts` 单一导出，strict、`schemaVersion: "1"`、有界集合；身份集合规范排序，业务序列才保序。
- 公共 `StructuredScoringRuleSchema`、`ApplicabilityMetadataSchema`、Evidence/Knowledge/Review/Agent refs 直接导入；C18 `AssessmentConfigurationReleaseSetV1Schema` 直接导入，不建立兼容镜像。
- `normalizeScoringThresholds`、`normalizeGradeIntervals`、`evaluateScoringRule` 是 operator、等级区间和越界行为的唯一执行事实源；`between` 与 grade 固定左闭右开，缺失 grade 下/上界分别映射负/正无穷，逐规则闭合策略不进入 Schema。
- `reviewStatus` 只允许 pending；正式准入从 C16 release+decision 读取。实现前后用 `rg -n "reviewStatus" packages apps` 检查没有新增消费门禁。
- 文档 digest 包含 schema、工程修订、C15/C18/规则/适用性/策略精确版本和规范内容；`structuredScoringRuleDocumentDigest`/`applicableRuleSetDocumentDigest` 与 C18 `assessmentConfigurationDocumentDigest` 均对 strict parse 后的文档调用 `sha256CanonicalJson`，使 C25 从 C04 取得正文后可复算；任何输入或策略变化生成新 artifact/revision/set，不复用旧结果。
- IP-10 的读请求、成员投影和结果由同一 C19 `schema.ts` strict 导出；投影含一个 applicable-set member、与 included refs 来源发布精确一致的规范排序 scoring-rule members、恰好覆盖 C18 `ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1` 的 11 个完整 members，以及三者的规范 `memberDigest`；只组合既有 ref/digest 类型，不在 contracts 建镜像。
- IP-11 不新增 Schema：公共包装的叶子输入直接复用 C06 authorization、C08 `AgentTaskRefV1` 和 C15 `DataCleaningResultV1`/`ContentArtifactRefV1`；返回联合在 concrete store 方法签名内闭合，`DataCleaningTaskPortV1` 与 contracts 保持不变。

### 5.2 领域状态（IP-03、IP-05、IP-06）

- Authoring task 状态完全由 C08 管理；C19 只消费 immutable snapshot/candidate/validation/result refs。
- rule relation 状态从 immutable relation + append-only review link/decision 推导：`pending | approved | rejected | returned`；只有 exact approved 允许进入 knowledge review，任何新 rule version 产生新 relation。
- 规则和规则集 revision/release/deactivation/rollback 状态完全由 C16 管理。C19 metadata 只证明内容已校验，不持有“当前发布”指针。
- basis set 为 immutable query/result fact，不提供 update/delete；版本变化由新 command/ref 表达。
- basis member reader 只读 immutable set；授权先于幂等重放，reader 自身不产生新 set、release、revision 或正文工件。
- C15 bound-result reader 只读既有 immutable 结果索引与 C04 工件；它不产生新清洗结果、任务、准备快照或正文工件，内部 `#finalizePreparation` 状态机不变。

### 5.3 表、约束与权限（IP-04）

- 五表及正文边界按 D-11。每表保存 project、精确 version refs、规范 digest、`occurred_at/recorded_at/persisted_at` 和必要 audit/command 身份；`assessment_basis_release_sets.member_snapshot` 保存由 `AssessmentBasisReleaseSetMembersV1Schema` 校验的 applicable-set、scoring-rule 和 11 类 configuration 引用/摘要投影，不保存正文。
- relation 以 `(project_id, relation_id, version_id)` 主键并唯一约束双方规范 identity+policy+overlap digest；review link 唯一约束 relation+attempt 和 review task ref；basis set 唯一约束 project+preparation ref+required/as-of+member digest。
- FK 只指向同迁移表或已有 C16 revision/release；C04/C07/C08 公共 ref 以 strict JSONB+分解 identity 保存，读取时反向 parse。规则/筛选正文不展开列。
- app role 只获 SELECT/INSERT；迁移 `down` 逆序 revoke/drop 本对象。生产 provider 递归发现 `000028`；`postgres-foundation.test.ts` 的 manifest 与 auth fixture 的 module map 只机械加入同一迁移，不改变 provider/runner。

### 5.4 事务、幂等、失败与审计（IP-05、IP-06、IP-08）

- 使用 C03 `TransactionUnitV1`、`AtomicCommandV1` 和 canonical digest；副作用集合见 §4。对外动作前意图耐久，C07/C08 调用按原 idempotency key 补偿。
- 授权/来源/冲突/版本失败不可修正；C04/DB/C07/C08 暂态错误可按原策略重试但不得换模型、扩大预算或跳过 Agent/人工门禁。
- 日志、错误、audit、receipt、event 只含引用、reason code、摘要和计数；原文、规则/config 正文、凭据、模型响应和内部 SQL 错误不复制。
- 可观测证据以现有 C03 audit/outbox、C08 action/usage 和 C19 relation/metadata refs 组成，不新建日志表或事件类型。
- IP-10 读取复用 C06 `verify` 与 C03 transaction/receipt/audit；授权拒绝由 C06 安全审计，授权后的成功/不可用结果由 C19 只追加 audit 记录。当前授权复验总在 receipt replay 前执行。
- IP-11 读取在目标索引查询和 C03 回执重放前固定按 `engineering-data.evidence-access` 复用 C06 `verify`，不得反查或枚举 branch；结果工件继续走 C04 当前授权与稳定读键，成功后用 requestId 与规范载荷提交 C03 领域读取回执/审计。同键同载荷返回相同 result/artifact ref 且 C03/C04 审计计数不增，同键异 taskRef 冲突，撤权不重放旧成功。公共包装统一不可用错误但保留瞬时技术失败，私有冻结调用的既有 blocker 语义不变。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 合格且冻结的规范条文输入 / 真实规范资料段进入知识编制 | IP-01、IP-05、IP-08 | adapter fixture + adapter test | C15 completed、获准真实标准/版本/segment、当前授权 | manifest 精确绑定且规则证据反向定位同一 segment | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '真实规范'` |
| 合格且冻结的规范条文输入 / 排除或未授权资料段被拒绝 | IP-01、IP-05 | adapter test | excluded segment / revoked grant | 模型调用数 0、无 candidate/revision | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '来源门禁'` |
| C15 清洗结果有界读取 / 当前授权读取清洗结果与工件引用 | IP-05、IP-11 | C15 store + C19 adapter tests | completed task/result + exact current C06 read grant | verify-before-query；strict result 与精确 artifact ref；C19 reader 调用一次且不直读 C15 表 | `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '清洗结果有界读取|C15 结果读取接缝'` |
| C15 清洗结果有界读取 / 不可用清洗结果不可枚举 | IP-11 | C15 store test | revoked grant / actor mismatch / foreign project / missing result / unreadable artifact / mismatched task binding | 相同不可重试 code/公开结构；无 result/artifact/existence 差异；目标查询前授权复验 | `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果不可枚举'` |
| C15 清洗结果有界读取 / 清洗结果读取不提供正文旁路 | IP-05、IP-11 | C15 store + C19 adapter tests | successful bound result + attempted raw/list/search access | 返回仅 strict result/artifact ref；无 C04 handle、原始条文正文或 list/search/latest 方法；资料段仍走 C19 有界工具 | `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '清洗结果无正文旁路'` |
| C15 清洗结果有界读取 / 清洗结果重复读取不重复审计 | IP-11 | C15 store test | same request identity/payload twice；same key/different task；grant revoked after success | result/artifact refs deep-equal；C03 domain audit 与 C04 access audit counts 均不增；异载荷冲突；撤权后统一拒绝而非旧成功 | `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果读取幂等'` |
| 有界规范知识编制 Agent / Agent 只形成候选修订 | IP-03、IP-05、IP-07 | core + worker + adapter tests | exact C08 refs | completed result 仅 revision+validation；无 release | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts apps/worker/test/scoring-rules/runtime.test.ts` |
| 有界规范知识编制 Agent / 越权动作直接失败 | IP-03、IP-05、IP-07 | worker + adapter tests | publish/unknown tool/out-of-manifest requests | 拒绝、预算/证据保留、无业务发布 | `pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts -t '越权'` |
| 结构化评分规则唯一内容契约 / 完整规则通过内容校验 | IP-02、IP-03 | core test | three-dimensional rule + C18 indicator + continuous thresholds/grades | accepted once、规范 digest/证据、唯一归一结果 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '内容校验|评分边界'` |
| 结构化评分规则唯一内容契约 / 不完整或悬空规则被拒绝 | IP-02、IP-03 | core test | table-driven missing dimension/indicator/gap/overlap/evidence | 每项稳定 reason、无 materialized member | 同上 |
| 结构化评分规则唯一内容契约 / 端点与无穷边界唯一求值 | IP-03 | core test | `lt/lte/eq/gte/gt/between` 端点；grade 共享端点；缺下界/上界 | `between`/grade 左闭右开；负/正无穷命中；C19 relation 与 evaluator 结论相同 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '评分边界'` |
| 结构化评分规则唯一内容契约 / 不连续或越界取值被拒绝 | IP-02、IP-03 | core test | threshold/grade overlap、internal gap、finite outer bounds + type mismatch/out-of-range input | normalize 拒绝重叠/空洞；evaluate 返回 strict `scoring-value-type-mismatch`/`scoring-value-out-of-range` 且无默认 score/grade | 同上 |
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
| 评估依据发布集合成员的有界读取 / 当前授权读取精确集合 | IP-10 | adapter test | exact basis ref + current C06 read grant | verify-before-query；strict success；one append-only audit | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取'` |
| 评估依据发布集合成员的有界读取 / 不可用目标不可枚举 | IP-10 | adapter test | missing member / revoked context / foreign-project ref / nonexistent ref | identical non-retryable code and public shape；no members/existence leak；revoked replay cannot hit old success | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 不可枚举'` |
| 评估依据发布集合成员的有界读取 / 成员清单固定精确引用 | IP-10 | core + adapter tests | persisted strict member snapshot + applicable-set included refs | exact set/version/member digest；applicable member；sorted scoring members exact with included release projection；11 sorted configuration release/revision/artifact/content digests | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员清单|basis 规则成员与摘要'` |
| 评估依据发布集合成员的有界读取 / 规则成员与工件摘要可复验 | IP-10 | core + adapter tests | C04 applicable/rule/config documents + mismatched/missing/extra member cases | C25 路径复算全部 `contentDigest`；scoring members 与 included refs 双向完备；任一不符整体失败且无部分集合 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 规则成员与摘要'` |
| 评估依据发布集合成员的有界读取 / 成员读取不返回正文 | IP-10 | core + adapter tests | snapshot plus attempted unknown/body fields | strict parse rejects extra fields；success has refs only；C04 open count 0 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 无正文'` |
| 评估依据发布集合成员的有界读取 / 读取重放保持幂等且不绕过撤权 | IP-10 | adapter test | same/different payload key + unavailable first result + grant revoked after success | audit action reconstructs same success/unavailable result and stable audit count；payload conflict；post-revocation unified denial | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 读取幂等'` |
| 授权、事务、幂等与可重放审计 / 重放返回同一结果 | IP-04～IP-06、IP-08 | adapter test | same/different payload key, concurrent calls | same refs/counts; mismatch conflict | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '幂等'` |
| 授权、事务、幂等与可重放审计 / 任一原子副作用失败即回滚 | IP-04～IP-06、IP-08 | adapter test | audit/outbox/metadata/basis insert fault | zero partial DB facts/events; sanitized failure | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '回滚'` |

说明：Vitest 的 `-t` 参数、多个文件参数均已由已安装 Vitest CLI 支持；实际测试标题必须保留矩阵中的关键词，避免命令命中零测试。不得精确断言完整错误文案，只断言公共 code、reason 类别、结构化引用和副作用计数。

## 7. 文件清单与升级条件

### 7.1 新增文件

- IP-01：`packages/core/test/scoring-rules/fixture.ts`、`packages/adapters/test/scoring-rules/fixture.ts`
- IP-02、IP-10：`packages/core/src/scoring-rules/schema.ts`、`packages/core/src/scoring-rules/index.ts`
- IP-03、IP-10：`packages/core/src/scoring-rules/validation.ts`、`packages/core/src/scoring-rules/service.ts`、`packages/core/test/scoring-rules/scoring-rules.test.ts`
- IP-04、IP-10：`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`
- IP-05、IP-10：`packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`、`packages/adapters/src/scoring-rules/index.ts`
- IP-07：`apps/worker/src/scoring-rules/runtime.ts`、`apps/worker/test/scoring-rules/runtime.test.ts`
- IP-08、IP-10：`packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`

### 7.2 修改文件

- IP-02：`packages/core/package.json`
- IP-05：`packages/adapters/package.json`
- IP-04：`packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`（仅 `000028` import 与 manifest/module-map 条目）
- IP-06：`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`、`packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`
- IP-07：`apps/worker/src/index.ts`
- IP-11：`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`、`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`

### 7.3 删除文件

无。

### 7.4 保护区

禁止修改：`packages/contracts/**`、`packages/core/src/engineering-data/cleaning/**`、`packages/core/src/assessment-config/**`、`packages/adapters/src/assessment-config/**`、根 workspace/lock、`openspec/config.yaml`、生产 migration provider/runner、主 specs、归档/其它 changes、C15 生产代码（除 IP-11 精确列出的 store 文件与方法）、C17/C18 生产代码、API/Web 生产文件。两处测试迁移清单只允许 IP-04 的 `000028` import 与 manifest/module-map 机械条目；不得改其它条目或发现算法。不得新增依赖、Mock/占位/默认规则、开发服务器、提交或归档。

### 7.5 必须升级的条件

1. HEAD/base 或 C08/C16/C18 现有符号、C15 `DataCleaningResultV1Schema`/`#readBoundResult`/`#finalizePreparation` 与本计划不一致，或 IP-11 不能仅靠 concrete-store 公共薄包装和 C19 注入完成。
2. 生产代码出现将 `StructuredScoringRule.reviewStatus` 作为审核/评分门禁的消费者，或 C25 必须这样消费。
3. 无法取得获准的真实规范资料段 fixture，或必须读取原始 Office/逐篇研究材料、自由联网、未授权全文才能验收。
4. 需要修改 contracts、`DataCleaningTaskPortV1`、C15 表/迁移/既有冻结行为、C18 生产代码、C25/C11 私表、API/Web、旧迁移、生产 migration provider/runner，或两处测试迁移清单需要超出 `000028` import/manifest/module-map 的机械变化，或 `000028` 已被占用。
5. C08 一个 Registry 实例必须同时注册 C17 与 C19 两个不同 `knowledge-authoring` definitions，且现有 composition 所有权不允许分开实例/后续组合。
6. C07 pending-link 补偿无法保持“失败永不误放行”，C03 无法包住列明的原子集合，或 C16 policy 接缝要求通用框架/公共接口演进。
7. 规则阈值确需高于公共 number 契约的十进制精度、业务要求非闭合冲突优先级/新枚举，或规则集需要同一工程同一时刻多个活跃 C16 stable definitions。
8. 任何新增第三方依赖、公共契约、数据迁移/回填、权限扩大、范围扩大或计划外生产文件；或实现需要枚举 capability 对应 branch、复制 `#readBoundResult` 查询/解析，或无法让授权/跨工程/缺失/不可见/绑定失配保持同形不可枚举拒绝、撤权先于回执重放、同键异载荷冲突、C03/C04 读取重放不重复审计、瞬时失败仍可区分。

## 8. 已核实的执行命令

定向行为验证：

```bash
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '内容校验|评分边界'
pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果有界读取|清洗结果不可枚举|清洗结果无正文旁路|清洗结果读取幂等'
pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取|basis 不可枚举|basis 成员清单|basis 规则成员与摘要|basis 无正文|basis 读取幂等'
pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts
pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts
pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts apps/api/test/http-shell.test.ts
```

静态、格式与边界验证：

```bash
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/scoring-rules packages/core/test/scoring-rules packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts apps/worker/src/scoring-rules apps/worker/test/scoring-rules
pnpm exec prettier --check packages/core/src/scoring-rules packages/core/test/scoring-rules packages/core/package.json packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/package.json packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts apps/worker/src/scoring-rules apps/worker/test/scoring-rules apps/worker/src/index.ts
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
