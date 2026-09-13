# Implementation Plan

## 1. 实施基线与权威来源

- 修补与返工基线：`7b60892b1561aff7e8bc9357da78c97abad55b17`；worktree `c19-scoring-rules`，change 为 `deliver-structured-scoring-rules-and-applicable-rule-sets`。该基线已实现原计划但独立验证不通过；本计划明确覆盖原施工顺序，禁止在旧实现上做发布后补链。
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
| IP-03 | C08 `AgentTaskDefinitionV1`、`buildCompletedAgentTaskResult`；core `sha256CanonicalJson`；C18 `assessmentConfigurationDocumentDigest`、`validateAssessmentConfigurationSet`/成员索引方式 | 保留唯一边界归一/评分求值，令关系检测输出绑定候选 revision/base release 的完整快照；规则集筛选只消费已持久化关系决定 | 不复制 Runner、预算台账、边界算法、C18 内容校验或 C16 生命周期 |
| IP-04 | 已实现 `000028_structured_scoring_rules.ts`、迁移 `000007`/`000012` 和两处测试清单 | 修改尚未归档的 `000028`：关系事实增加候选 C16 revision 与比较基线绑定，保持五表、只追加和现有发现方式 | 不新增第六张表/迁移文件，不改旧迁移、生产 provider/runner、发现算法或历史数据 |
| IP-05 | C04 `ArtifactStoreV1`；C07 concrete adapter；C08 `AgentTaskPortV1`；C18 resolver；IP-11 C15 reader；现有 `PostgresScoringRulesAdapter` | 把 `detectRuleRelations`、relation 写入和 C07 补链从规则集组装移到规则发布前；组装只消费已闭合事实；修复 basis reader | 不直读 C15/C18/C25 私表，不建立第二审阅/任务/审计体系，不缓存 C07 link.status 作为决定事实 |
| IP-06 | `PostgresKnowledgeGovernanceAdapter` 的四个 C19 policy helper；`PostgresReviewAuditAdapter` 的 C07 task/decision 表与 `trace` 授权范式 | 在 C16 submit/review/publish 接缝分别落关系原子写入、C07 精确决定门禁和最终发布复验；在 C07 concrete adapter 增加窄的精确冲突决定读取 | 不修改 C07/C16 公共 contracts，不抽象通用插件框架，不改变 C18 或其它定义行为 |
| IP-07 | `apps/worker/src/agent-runtime/runner.ts` 的 `renderModelStep`/`interpretModelStep` callbacks | 以组合函数接入 C19 renderer/interpreter，仍使用同一 Runner | 不创建全局 registry、第二 Runner、模型网关或自然语言写命令 |
| IP-08 | 已有 C19/C16/C07 PostgreSQL tests、fixture 和 API 通用知识路由 | 重写错误生命周期断言：先关系/C07、后 C16 规则发布；补发布回滚、reader 不可用审计与幂等 | 不为文案/私有调用顺序加断言，不增加 C19 API/Web 入口 |
| IP-09 | 根 `typecheck`、`lint`、`format:check`、`deps:check`、`deps:policy` 与 OpenSpec CLI | 执行最小全局静态/边界/规格校验并形成验收证据 | 不启动开发服务器、不安装依赖、不提交或归档 |
| IP-10 | contracts refs/errors；C06 `LocalIdentityAccessV1.verify`；C03 `TransactionUnitV1.execute` receipt replay；C18 member schema；现有 C19 basis snapshot | 将 reader 改为无调用方 project/actor 的 strict 输入和顶层三分支结果；在 C03 handler 内形成 success/unavailable 并以 audit action 重放，逐项核对 included refs | 不修改 C02/contracts/C18/C25，不返回内部 `releaseSet`/正文/元数据，不静默去重，不让历史回执绕过撤权 |
| IP-11 | `PostgresDataCleaningStore.#readBoundResult`、`#finalizePreparation`、`#verify`、`#readJson`/`#readBytes`；core `DataCleaningResultV1Schema` 与仅供 C08 执行的 `DataCleaningTaskPortV1` | 在 concrete store 增加公共 `readBoundResult(input)` 薄包装，复用私有单点查询、strict parse、C04 受权读取和任务—结果绑定；C19 通过 `Pick<PostgresDataCleaningStore, "readBoundResult">` 注入消费 | 不扩展 contracts/core task port，不复制查询/解析，不改 C15 表、迁移、冻结路径行为或提供正文/list/search/latest 旁路 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 前置契约与验收夹具 | `合格且冻结的规范条文输入` 两场景；`不可变适用规则集组装与人工发布 / RA-S3/S4 形成适用规则集` | **新增** `packages/core/test/scoring-rules/fixture.ts`：公共规则/三维/C18 ref builders；**新增** `packages/adapters/test/scoring-rules/fixture.ts`：C03/C04/C07/C08/C15/C16/C18 组合 fixture、真实规范输入 builder | 先用已集成生产导出和 strict Schema 构造 C15 completed result；真实规范只保留获准最小资料段、标准身份、来源版本和 segment locator；提供冲突、不适用、故障注入开关 | 无 C15 时不建本地替身；不读取研究原件；不 Mock 后端；不写未经许可的完整规范正文 |
| IP-02 | C19 strict Schema 与子路径 | `结构化评分规则唯一内容契约` 全部场景；`三维适用性筛选与完整原因`；`评估依据发布集合成员的有界读取`；D-01～D-04/D-06/D-14 | **返工** `packages/core/src/scoring-rules/schema.ts`：保留现有文档/规则 Schema；将 `ReadAssessmentBasisReleaseSetV1Schema` 精确收口为 `{requestId,idempotencyKey,requestedAt,authorization,assessmentBasisReleaseSetRef}`，删除 `projectId`/`actorId`；将 `AssessmentBasisReleaseSetReadResultV1Schema` 改为顶层 strict `succeeded | unavailable | failed`，成功直接组合成员字段而非 `releaseSet`；`packages/core/src/scoring-rules/index.ts` 继续导出 | 成功精确字段为 `kind/schemaVersion/assessmentBasisReleaseSetRef/memberDigest/applicableRuleSetMember/scoringRuleMembers/configurationMembers`；unavailable 固定非重试 `AUTHORIZATION_DENIED`；failed 保留技术错误；其它既有 Schema 不变 | 不改 contracts/根 workspace；不暴露内部 project/snapshot/config-set/timestamps，不添加兼容旧 `releaseSet` 分支 |
| IP-03 | 核心确定性逻辑和 Agent definition | `冲突与重叠确定性检测` 全部场景；`规则冲突人工审阅`；`评估依据发布集合成员的有界读取`；D-05～D-07/D-09/D-14 | **返工** `packages/core/src/scoring-rules/validation.ts`：保留 `normalizeScoringThresholds`/`normalizeGradeIntervals`/`evaluateScoringRule`；令 `detectRuleRelations` 的输入/输出明确绑定候选 revision、比较基线 release 与 relation digest；修改 `projectApplicableRuleSetMembers`、`buildAssessmentBasisMembers` 及一致性 helper，遇重复/缺失/额外 member 直接失败而不 `Map` 去重；**返工** `packages/core/src/scoring-rules/service.ts`：prepared revision 携带关系快照，`AssessmentBasisReleaseSetReaderV1` 返回 IP-02 三分支；**返工** core test | 关系检测仍只调用唯一边界 helper；关系快照在 C16 submit 前算完，组装函数接收已闭合关系事实；basis included refs 与 scoring members 双向逐项相等；测试覆盖重复成员和顶层 reader 形状 | 不让规则集组装重新检测关系；不增加 contracts 字段/新生命周期/新抽象；不按数组顺序或置信度选边 |
| IP-04 | PostgreSQL 迁移 | `冲突与重叠确定性检测`；`规则冲突人工审阅`；`授权、事务、幂等与可重放审计`；D-11/D-12 | **返工** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`：在 `business.rule_relations` 增加候选 `revision_id` FK、比较基线 release ref/digest 和相应 project/revision/relation 唯一约束；`rule_conflict_review_links` 删除重复的 decision/status，只保存 relation→C07 task/attempt/审计绑定；**返工** foundation/auth migration 测试断言，不改清单序号 | 五表数量不变；relation 在发布前即可属于候选 revision；同一 revision+relation identity、同一 task link 只写一次；决定状态实时从 C07 推导；down 仍逆序删除本迁移对象 | 不新增迁移文件/表，不修改 C16/C18 旧表、生产 provider/runner 或其它清单条目 |
| IP-05 | C19 PostgreSQL adapter | `冲突与重叠确定性检测`；`规则冲突人工审阅`；`结构化规则复用统一定义生命周期`；`不可变适用规则集组装与人工发布`；reader 全部场景；D-07～D-12/D-14 | **返工** `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`：`prepareRevision` 在 structured-rule submit 前读取精确 base/current 发布并计算完整关系快照；`appendPreparedRevision` 与 C16 revision 同事务追加 metadata+relations；finalizer 在 submit 成功后以 relation stable key 补 C07 task/link；`assertRevisionMetadata` 从注入的 C07 决定 reader 校验全部关系；`appendRelease` 在 C16 publish 事务内复验 relation/base/C07 决定；`assembleApplicableRuleSetRevision` 删除关系检测/建 C07 task，改为读取已闭合事实；重写 `readAssessmentBasisReleaseSet`，在 C06 verify 后以 C03 transaction handler形成 success/unavailable audit+receipt | 精确顺序为编制→检测→relation 耐久→C07 决定→C16 review/publish gate→发布；外部 C07 失败只留下未发布 revision，原键只补 link；最终门禁抛错使 C16 release/audit/receipt/outbox 回滚；reader replay 由 receipt `auditEntryId` 的 `.succeeded/.unavailable` action 判别，success 再单点读取 immutable snapshot，unavailable 不泄露原因 | 不在 assembly 重新检测/补链，不信任 link.status，不改已发布规则，不吞瞬时失败，不返回 reader 内部 `releaseSet` |
| IP-06 | C16/C07 窄接缝 | `规则冲突人工审阅`；`结构化规则复用统一定义生命周期`；D-08/D-12 | **返工** `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：保持四个 policy dispatch，在 submit handler 向 `appendPreparedRevision` 传入精确 C16 revision；request-review 前调用关系/C07 门禁；publish 事务写 release 前调用最终门禁并让异常回滚；**返工**其既有测试。**修改** `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`：增加仅供 adapter 组合使用的精确 `rule-conflict` 决定读取，按 `review-audit.trace` 当前授权单点核对 task target/type/project/decision，不扩展公共 port；**修改**对应 C07 adapter test | C07 数据库决定是 SSOT；C19 只注入该 concrete 窄方法；C16 definition lock/expected base/知识审核/release 原子集合全部复用现状 | 不改 C07/C16 contracts、C18 生产文件、公共命令/表或其它类型行为，不引入通用 plugin registry |
| IP-07 | Worker 接入同一 C08 Runner | `有界规范知识编制 Agent` 两场景；D-05 | **新增** `apps/worker/src/scoring-rules/runtime.ts`：`withScoringRuleAuthoringModelStep`、`interpretScoringRuleAuthoringModelStep`；**新增** `apps/worker/test/scoring-rules/runtime.test.ts`；**修改** `apps/worker/src/index.ts` 导出组合函数 | 只对 metadata/policy 精确匹配的 C19 knowledge-authoring 任务渲染 manifest/观察引用与解析 tool-request/candidate；其它任务委派原 callback；协议测试覆盖工具→候选→校验→finalize、预算/模型/工具/权限失败 | 不注册 C17、不吞 C08 错误、不硬编码模型文案、不创建全局 worker 实例 |
| IP-08 | PostgreSQL 端到端与公共接口回归 | 所有 Requirement/Scenario，重点发布前冲突/C07、发布回滚和 basis reader | **返工** `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` 及 fixture：删除“先发布冲突规则、assembly 后检测”的旧主链，改为 C08 candidate→C16 revision+relations→C07 精确决定→C16 knowledge review→publish rule→assembly；**返工** C16 test；**扩展** C07 test | 断言 conflict 时 release 数为 0，补链重试不重复 relation/task/link/audit；pending/reject/return/stale 决定均阻断；publish 门禁故障不留 release/audit/receipt/outbox；assembly 不新增 relation/task；reader exact keys、无正文、success/unavailable replay、异载荷冲突、撤权、瞬时失败 | 不锁私有调用顺序/错误全文/SQL；不增加 UI、HTTP 分支或 snapshot |
| IP-09 | 最小全局验证与 OpenSpec 交接 | 全部验证义务；D-13 | 无生产文件；仅运行 §6/§7 命令并核对 `openspec instructions apply --json` | core→adapter→worker 定向测试后运行类型、lint、format、依赖边界、C16/C18/API 回归与 OpenSpec strict；行为/证据完成后才勾 tasks | 不运行全量 `pnpm verify` 替代有界故障定位；不启动 dev server、不提交/归档 |
| IP-10 | C19 评估依据成员有界读取 | `评估依据发布集合成员的有界读取` 全部场景；D-10/D-11/D-12/D-14 | **返工 IP-02** `schema.ts` 的请求和结果；**返工 IP-03** `service.ts` reader 类型及 `validation.ts` 的 member builders/assertion；**保留 IP-04** `assessment_basis_release_sets.member_snapshot`，不新增结果表；**返工 IP-05** `PostgresScoringRulesAdapter.readAssessmentBasisReleaseSet`、basis resolve included refs 派生和 C03 审计/回执；**返工 IP-08** core/PostgreSQL tests | 输入无 project/actor；成功顶层精确七字段且无 `releaseSet`；适用集 member 来自 set release→revision metadata，scoring members 来自 strict included refs 且逐项一致，configuration members 来自已验证 C18 11 类，所有 digest 来自拥有方 helper；授权有效的 missing/corrupt/mismatch 均返回同一 unavailable 并只写一次 `.unavailable` audit+receipt；撤权先拒绝且只留 C06 安全审计；same key/payload 重放原 action，同键异载荷冲突；技术失败走 failed 且不完成 receipt | 不改公共 resolve 形状，不返回正文、内部记录字段、自由字段或未发布成员；不静默去重；不把瞬时失败伪装为 unavailable；不增加表/迁移文件或占用 `000029–000031` |
| IP-11 | C15 清洗结果公共只读接缝 | `C15 清洗结果有界读取` 四场景；D-04/D-12/D-15 | **修改** `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`：新增公共 `PostgresDataCleaningStore.readBoundResult(input)`，复用 `#readBoundResult`，并用既有 `TransactionUnitV1` 写读取回执/审计；**修改** `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`：新增有界读取行为测试；**扩展 IP-08 新增测试** `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`：证明 C19 只经注入 reader 消费 | 入参精确为 `{projectId, actorId, requestId, requestedAt, authorization, taskRef}`；先校验授权上下文 actor/project 并固定用 C06 `engineering-data.evidence-access`/`engineering-data.read` 当前复验，再调用私有单点读取；成功后以 requestId 与规范载荷原子写 C03 `engineering-data.read-data-cleaning-result` 回执/审计；成功返回 `{kind:"ok", result:DataCleaningResultV1, resultArtifactRef}`；授权/跨工程/缺失/不可见/绑定失配统一不可重试拒绝；同键同载荷重放不重复 C03/C04 审计，同键异 taskRef 冲突，撤权不重放旧成功 | 不枚举 capability 对应分支，不复制 `#readBoundResult` 查询/解析，不改 `#finalizePreparation` 对私有方法的调用和既有错误，不改 `DataCleaningTaskPortV1`/contracts、表/迁移，不返回原始资料正文、C04 handle、list/search/latest，不吞瞬时技术失败 |

无新增或删除文件。返工复用现有 IP-02～IP-06/IP-08/IP-10 文件；仅把 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 及其既有测试纳入 IP-06。IP-01/IP-07/IP-09/IP-11 现状可保留。测试命令/验收义务归属 IP-03～IP-10。

## 4. 调用与副作用顺序

### 4.1 规范编制与规则修订（IP-01、IP-03、IP-05、IP-06、IP-07、IP-11）

1. C19 入口 strict parse 工程、actor、C15 result artifact、C18 policy/as-of、可选 base release 和全部 C08 policy refs；C06 在任何业务读取前校验 `agent-task.start` 与相应资料/知识能力。
2. adapter 调用注入的 `PostgresDataCleaningStore.readBoundResult({projectId, actorId, requestId, requestedAt, authorization, taskRef})`。该公共薄包装先复验 actor/project 与固定 C06 `engineering-data.evidence-access`/`engineering-data.read` 当前授权，不做 branch 枚举；再复用私有 `#readBoundResult` 的 `projectId + taskRef` 单点索引、C04 结果工件读取、strict `DataCleaningResultV1Schema` 和任务—结果双向绑定。成功后以 requestId/规范载荷写 C03 只追加读取回执与审计；授权/跨工程/缺失/不可见/失配统一拒绝，同键同载荷重放不重复 C03/C04 审计，同键异 taskRef 冲突，撤权先于旧回执重放。成功只返回 result 与 `resultArtifactRef`；C19 随后只接受 `available | partial` 中未被排除的 segment，并调用 C18 `resolveConfigurationSet` 固定 11 个配置成员和 indicator-system。
3. 构建 manifest，规范化摘要后先写 C04；以 manifest ref 启动或重放同一个 C08 task。相同幂等身份/载荷返回原 task，不同载荷冲突。
4. Worker 通过现有 Runner 执行；两个 C19 工具每次复验 task/policy/project/source/version/budget，只将有界观察写 C04。模型只能返回 strict add/replace operations。
5. core 按 D-06 逐项校验并 materialize 完整规则文档。C19 `prepareRevision` 随后读取命令指定的精确 base/current 规则 release 与 C04 正文，以同一归一 helper 比较候选内及候选对基线的规则，产出完整 relation snapshot、relation digest、拟保留/拟筛除引用和比较基线；冲突是不可修复结果，不进入 Agent correction。
6. finalizer 先使规则文档 C04 工件耐久，再调用 C16 `submit-revision`。C16 现有 definition lock/expected base 校验通过后，在一个事务写 definition/revision、C19 metadata、全部 relation facts、receipt 和 audit；任一写入失败整体回滚。基线已漂移则返回 `STALE_VERSION`，必须重新 materialize/检测并提交新 revision，孤儿工件不可消费。
7. revision 提交成功后，C19 对每个 conflict 以 `project + revision + relation` 派生稳定幂等身份，请求 C07 `rule-conflict` task，再只追加精确 link。C07 暂时失败不撤销 revision，也绝不放行；原身份重试只补缺失 task/link，relation/task/link/audit 均不重复。C19 finalizer 仅在全部 conflict 已有耐久 link 后返回 completed revision ref。
8. C16 `request-review` 前，C19 `assertRevisionMetadata` 复验 metadata/relation digest/base，并通过 IP-06 窄 reader 从 C07 决定事实读取每个 link；只有目标、工程、relation version、task type 和拟议处置全部匹配的人工 `approve-publication` 通过。pending、reject、return、缺失、错目标或过期决定一律阻断；reject/return 后只能提交新 candidate revision。
9. 通过冲突门禁后才创建 C07 `knowledge-revision` 审核；人工批准后，授权用户调用 C16 publish。C16 publish 事务在插入 release 前调用 C19 `appendRelease` 最终复验同一 relation/base/current/C07 决定；任一失败抛错并回滚本次 release、audit、receipt、outbox。成功才形成 immutable rule release；正文 `reviewStatus` 仍 pending。

### 4.2 规则集组装与发布（IP-03、IP-05、IP-06）

1. assembly command strict parse 并校验 `knowledge-modeling.govern`、工程/actor；snapshot reader 提供精确 C01 snapshot 值，C16 resolver 选择 `requiredAt/asOf` 唯一规则 release，C18 resolver返回完整集合。
2. adapter 有界读取规则 artifact，复验 C19 revision metadata、project revision、C15/C18/compatibility digests；任何缺失、停用、跨工程或版本冲突整体失败。
3. adapter 读取规则 release 对应的、已在发布前耐久且通过 C07/C16 门禁的关系事实；core 只执行三维/例外筛选，并按既有 conflict/overlap retained/excluded 决定为每条候选形成恰好一个结果。组装路径不得调用 `detectRuleRelations`、创建 C07 task 或追加关系事实；事实缺失、摘要不符、仍 pending、无成员或决定不完整整体失败。成功结果规范排序并写一个 applicable-set C04 工件。
4. 通过 C16 提交 `applicable-rule-set` revision；C19 metadata 与 revision/audit/receipt 同事务。其后仍走 C16 request-review 与人工批准，不自动发布。
5. publish/rollback 时 C19 policy 复验精确 artifact 和成员发布状态；C16 release、audit、receipt 与一个 `knowledge.assessment-basis-published.v1` 在同一事务。Outbox 失败整体回滚；重复命令返回原 release/event。

### 4.3 公共评估依据解析（IP-05、IP-08）

1. generic API/调用方把公共 `assessment-basis` command 交给 C19 resolver；strict parse 后 C06 校验 `knowledge-modeling.read`。
2. 注入 reader 按 preparation ref 返回公共快照；C19 复验 project、authorization 和 applicability ref，不查询 C25 私表。
3. 以 `requiredAt`/`issuedAt` 解析唯一 applicable-set release 与 C18 set，读取并 strict parse C04 set document，逐项验证 snapshot、rule release、C18 members、compatibility 和发布决定。
4. 尚未发布/准备完成返回 waiting；授权/跨工程/停用/stale/incompatible 返回脱敏 failed。不得回退或部分返回。
5. 成功时从 strict applicable-set `included refs` 解析并规范化其规则发布成员，连同适用规则集成员和 C18 的 11 个完整成员计算 `memberDigest`；任一 included ref 缺少 C16 revision/artifact/content digest、成员重复/额外或不相符则整体失败。在一个 C03 事务写 immutable set/member snapshot、receipt 和 audit；相同命令重放同一 ref。返回公共 `{kind: assessment-basis, assessmentBasisReleaseSetRef}`，正文仍在 C04/C18/C16。

### 4.4 评估依据成员有界读取（IP-10）

1. C25 等进程内消费方提交 strict `{requestId,idempotencyKey,requestedAt,authorization,assessmentBasisReleaseSetRef}`；没有 project/actor/name/latest/list，工程和 actor 只信任 C06 验证结果。
2. adapter 先调用 `LocalIdentityAccessV1.verify`，按 `knowledge-modeling.assessment-basis` 与当前时间复验授权上下文和 `knowledge-modeling.read`。失败返回 strict unavailable，由 C06 记录安全拒绝；不得查询 C19 表/回执，也不得以未验证身份写 C19 audit。
3. 授权通过后，以验证结果构造 `knowledge.read-assessment-basis-release-set.v1` C03 command，规范载荷只含 set ref、授权上下文引用和请求时刻。C03 同键异载荷直接返回 `IDEMPOTENCY_CONFLICT`；已完成同载荷 receipt 通过 `auditEntryId` 单点读取 audit action：`.unavailable` 直接重建统一 unavailable，`.succeeded` 才按 receipt `resultRef` 单点读取 immutable snapshot，不追加 audit。
4. 首次执行在 C03 transaction handler 中以验证后的 `projectId + set ref` 单点读取 `business.assessment_basis_release_sets`。strict parse `member_snapshot`，复验 set ref、`memberDigest`、一个 applicable member、included refs 对应的唯一且规范排序 scoring members，以及恰好 11 类 configuration members。适用集 member 来自 set release→revision metadata；scoring members 逐项来自 strict applicable-set `included refs`，两侧任何重复、缺失或额外成员都失败，不得静默去重；配置成员来自 C18 已验证集合。
5. 首次成功在同一 C03 事务提交 `.succeeded` audit+receipt，返回顶层 `{kind:"succeeded",schemaVersion:"1",assessmentBasisReleaseSetRef,memberDigest,applicableRuleSetMember,scoringRuleMembers,configurationMembers}`。不返回 `releaseSet` 或内部 project/preparation/applicability/config-set/timestamps，不打开 C04；消费方另经 C04 当前授权读取正文并用 C19/C18 helper 复算 digest 和 included refs。
6. 当前授权有效但零行、跨工程、成员缺失/损坏、included refs 不一致、digest 不符或不可见时，在同一 C03 事务提交唯一 `.unavailable` audit+receipt，返回 `{kind:"unavailable",error: AUTHORIZATION_DENIED}`，audit 不记录真实差异原因或成员。数据库/C03/audit 瞬时失败返回 `{kind:"failed",error: TRANSIENT_FAILURE}` 且事务回滚、不完成 receipt；reader 不产生 event、update/delete 或正文副作用。

## 5. Schema、状态与持久化落实

### 5.1 Schema 与版本（IP-02、IP-03）

- C19 内部对象全部由 `packages/core/src/scoring-rules/schema.ts` 单一导出，strict、`schemaVersion: "1"`、有界集合；身份集合规范排序，业务序列才保序。
- 公共 `StructuredScoringRuleSchema`、`ApplicabilityMetadataSchema`、Evidence/Knowledge/Review/Agent refs 直接导入；C18 `AssessmentConfigurationReleaseSetV1Schema` 直接导入，不建立兼容镜像。
- `normalizeScoringThresholds`、`normalizeGradeIntervals`、`evaluateScoringRule` 是 operator、等级区间和越界行为的唯一执行事实源；`between` 与 grade 固定左闭右开，缺失 grade 下/上界分别映射负/正无穷，逐规则闭合策略不进入 Schema。
- `reviewStatus` 只允许 pending；正式准入从 C16 release+decision 读取。实现前后用 `rg -n "reviewStatus" packages apps` 检查没有新增消费门禁。
- 文档 digest 包含 schema、工程修订、C15/C18/规则/适用性/策略精确版本和规范内容；`structuredScoringRuleDocumentDigest`/`applicableRuleSetDocumentDigest` 与 C18 `assessmentConfigurationDocumentDigest` 均对 strict parse 后的文档调用 `sha256CanonicalJson`，使 C25 从 C04 取得正文后可复算；任何输入或策略变化生成新 artifact/revision/set，不复用旧结果。
- IP-10 的读请求和三分支结果由同一 C19 `schema.ts` strict 导出；请求不含 project/actor，成功顶层只含 kind/schema/set ref/member digest 和三个成员投影，unavailable 固定非重试拒绝，failed 仅承载技术失败；scoring members 与 included refs 逐项双向一致且禁止静默去重，只组合既有 ref/digest 类型，不在 contracts 建镜像。
- IP-11 不新增 Schema：公共包装的叶子输入直接复用 C06 authorization、C08 `AgentTaskRefV1` 和 C15 `DataCleaningResultV1`/`ContentArtifactRefV1`；返回联合在 concrete store 方法签名内闭合，`DataCleaningTaskPortV1` 与 contracts 保持不变。

### 5.2 领域状态（IP-03、IP-05、IP-06）

- Authoring task 状态完全由 C08 管理；C19 只消费 immutable snapshot/candidate/validation/result refs。
- rule relation 绑定候选 C16 revision 与比较基线，从 immutable relation + append-only review link + C07 当前决定事实推导 `pending | approved | rejected | returned`；link 自带 status 不得作为批准事实。只有 exact approved 允许进入 knowledge review，任何新 rule version/base release 产生新 relation。
- 规则和规则集 revision/release/deactivation/rollback 状态完全由 C16 管理。C19 metadata 只证明内容已校验，不持有“当前发布”指针。
- basis set 为 immutable query/result fact，不提供 update/delete；版本变化由新 command/ref 表达。
- basis member reader 只读 immutable set；授权先于幂等重放，reader 自身不产生新 set、release、revision 或正文工件。
- C15 bound-result reader 只读既有 immutable 结果索引与 C04 工件；它不产生新清洗结果、任务、准备快照或正文工件，内部 `#finalizePreparation` 状态机不变。

### 5.3 表、约束与权限（IP-04）

- 五表及正文边界按 D-11。每表保存 project、精确 version refs、规范 digest、`occurred_at/recorded_at/persisted_at` 和必要 audit/command 身份；`assessment_basis_release_sets.member_snapshot` 保存由 `AssessmentBasisReleaseSetMembersV1Schema` 校验的 applicable-set、scoring-rule 和 11 类 configuration 引用/摘要投影，不保存正文。
- relation 以 `(project_id, relation_id, version_id)` 为主键并外键绑定候选 C16 revision，唯一约束 revision+比较基线+双方规范 identity+policy+overlap digest；review link 唯一约束 relation+attempt 和 review task ref，且不保存 C07 decision/status 副本；basis set 唯一约束 project+preparation ref+required/as-of+member digest。
- FK 只指向同迁移表或已有 C16 revision/release；C04/C07/C08 公共 ref 以 strict JSONB+分解 identity 保存，读取时反向 parse。规则/筛选正文不展开列。
- app role 只获 SELECT/INSERT；迁移 `down` 逆序 revoke/drop 本对象。生产 provider 递归发现 `000028`；`postgres-foundation.test.ts` 的 manifest 与 auth fixture 的 module map 只机械加入同一迁移，不改变 provider/runner。

### 5.4 事务、幂等、失败与审计（IP-05、IP-06、IP-08）

- 使用 C03 `TransactionUnitV1`、`AtomicCommandV1` 和 canonical digest；副作用集合见 §4。C16 revision+metadata+relations 先耐久，C07 task/link 再按 relation stable key 补偿；C16 publish 门禁与 release 原子提交。
- 授权/来源/冲突/版本失败不可修正；C04/DB/C07/C08 暂态错误可按原策略重试但不得换模型、扩大预算或跳过 Agent/人工门禁。
- 日志、错误、audit、receipt、event 只含引用、reason code、摘要和计数；原文、规则/config 正文、凭据、模型响应和内部 SQL 错误不复制。
- 可观测证据以现有 C03 audit/outbox、C08 action/usage 和 C19 relation/metadata refs 组成，不新建日志表或事件类型。
- IP-10 读取复用 C06 `verify` 与 C03 transaction/receipt/audit；撤权/无效上下文仅由 C06 安全审计，授权后的 success/unavailable 各由一条闭合 C19 audit+receipt 记录。当前授权复验总在 receipt replay 前执行，重放从 receipt 的 `auditEntryId` 和 action 判别原结果；同键异载荷冲突，技术失败不完成 receipt。
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
| 冲突与重叠确定性检测 / 冲突规则全部被拦截 | IP-03～IP-06、IP-08 | core + adapter tests | same indicator/applicability, different conclusion | relation 绑定候选 revision；C07 决定前 rule release 数为 0 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '发布前冲突'` |
| 冲突与重叠确定性检测 / 等价重叠被完整记录 | IP-03、IP-08 | core + adapter tests | same conclusion overlapping intervals | overlap range/evidence + deterministic retained/excluded | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '重叠'` |
| 冲突与重叠确定性检测 / 关系检测或补链失败保持未发布 | IP-04～IP-06、IP-08 | adapter test | relation insert / C07 request / link insert fault + same-key retry | 无 rule release；事务失败无 partial relation；跨端口失败保留 blocked revision；重试不重复 relation/task/link/audit | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '冲突补链补偿'` |
| 规则冲突人工审阅 / 人工决定解除精确冲突门禁 | IP-04～IP-06、IP-08 | adapter test | C07 exact approve + new valid candidate | exact relation/proposal approved、仅 retained rule 入集、knowledge review allowed | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '冲突审阅'` |
| 规则冲突人工审阅 / 过期决定不能放行 | IP-03、IP-05、IP-08 | adapter test | decision targets prior relation version | stale rejected、new relation pending | 同上 |
| 结构化规则复用统一定义生命周期 / 人工批准后形成不可变规则发布 | IP-05、IP-06、IP-08 | C16 + adapter tests | knowledge-review exact approval | one immutable release、decision chain replayable | `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` |
| 结构化规则复用统一定义生命周期 / Agent 或未审核修订不能发布 | IP-05、IP-06、IP-08 | C16 + adapter tests | Agent actor / no approval | failed、active release unchanged | 同上 |
| 结构化规则复用统一定义生命周期 / C16 发布前重复校验冲突决定 | IP-05、IP-06、IP-08 | C16 + adapter tests | missing relation / stale base / revoked or mismatched C07 decision / publish fault | C19 final gate runs before release insert；release/audit/receipt/outbox count unchanged on failure | `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '发布最终门禁|发布回滚'` |
| 三维适用性筛选与完整原因 / 三维匹配规则被纳入 | IP-02、IP-03 | core test | exact method/stratum/stage | included once + three match evidence | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '三维适用性'` |
| 三维适用性筛选与完整原因 / 不适用规则全部筛除 | IP-02、IP-03、IP-08 | core + adapter tests | mismatch each dimension + exception | every candidate one exclusion reason、members absent | 同上 |
| 不可变适用规则集组装与人工发布 / RA-S3/S4 形成适用规则集 | IP-01、IP-03、IP-05、IP-06、IP-08 | adapter test | published real rule + complete C18 + snapshot + two approvals | candidate then immutable set release; Agent no approval | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'RA-S3/S4'` |
| 不可变适用规则集组装与人工发布 / 配置或冲突不完整时整体失败 | IP-03、IP-05、IP-08 | adapter test | missing C18 / incompatible / pending conflict | no partial artifact/release/basis | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '规则集门禁'` |
| 公共评估依据解析 / 精确依据可供后续评估冻结 | IP-05、IP-08 | adapter test + API regression | reader returns exact prep; valid releases | public strict success ref; stored members exact | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'assessment-basis' && pnpm exec vitest run apps/api/test/http-shell.test.ts` |
| 公共评估依据解析 / 未准备完成时不返回默认依据 | IP-05、IP-08 | adapter test | missing set/member/reader waiting | waiting/failed; no fallback/partial | 同上 |
| 评估依据发布集合成员的有界读取 / 当前授权读取精确集合 | IP-02、IP-03、IP-05、IP-10 | adapter test | exact basis ref + current C06 read grant | verify-before-query；输入无 project/actor；顶层 success 精确七字段；one append-only audit | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取'` |
| 评估依据发布集合成员的有界读取 / 不可用目标不可枚举 | IP-10 | adapter test | missing member / revoked context / foreign-project ref / nonexistent ref | identical non-retryable code and public shape；no members/existence leak；revoked replay cannot hit old success | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 不可枚举'` |
| 评估依据发布集合成员的有界读取 / 成员清单固定精确引用 | IP-02、IP-03、IP-10 | core + adapter tests | persisted strict member snapshot + applicable-set included refs | 无 `releaseSet`/内部字段；applicable member；scoring members 与 included refs 逐项一致且重复即失败；11 sorted configuration members | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员清单|basis 规则成员与摘要'` |
| 评估依据发布集合成员的有界读取 / 规则成员与工件摘要可复验 | IP-10 | core + adapter tests | C04 applicable/rule/config documents + mismatched/missing/extra member cases | C25 路径复算全部 `contentDigest`；scoring members 与 included refs 双向完备；任一不符整体失败且无部分集合 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 规则成员与摘要'` |
| 评估依据发布集合成员的有界读取 / 成员读取不返回正文 | IP-10 | core + adapter tests | snapshot plus attempted unknown/body fields | strict parse rejects extra fields；success has refs only；C04 open count 0 | `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 无正文'` |
| 评估依据发布集合成员的有界读取 / 读取重放保持幂等且不绕过撤权 | IP-10 | adapter test | same/different payload key + unavailable first result + grant revoked after success | audit action reconstructs same success/unavailable result and stable audit count；payload conflict；post-revocation unified denial | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 读取幂等'` |
| 评估依据发布集合成员的有界读取 / 不可用结果也可幂等重放 | IP-05、IP-10 | adapter test | valid grant + missing/corrupt set, same payload replay, different set same key | strict unavailable deep-equal；one `.unavailable` audit+receipt；replay 不增；异载荷 conflict | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 不可用幂等'` |
| 评估依据发布集合成员的有界读取 / 瞬时失败不伪装成不可用 | IP-05、IP-10 | adapter test | DB/audit/receipt fault | strict failed/`TRANSIENT_FAILURE`；零 completed receipt；原键可重试 | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 瞬时失败'` |
| 授权、事务、幂等与可重放审计 / 重放返回同一结果 | IP-04～IP-06、IP-08 | adapter test | same/different payload key, concurrent calls | same refs/counts; mismatch conflict | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '幂等'` |
| 授权、事务、幂等与可重放审计 / 任一原子副作用失败即回滚 | IP-04～IP-06、IP-08 | adapter test | audit/outbox/metadata/basis insert fault | zero partial DB facts/events; sanitized failure | `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '回滚'` |

说明：Vitest 的 `-t` 参数、多个文件参数均已由已安装 Vitest CLI 支持；实际测试标题必须保留矩阵中的关键词，避免命令命中零测试。不得精确断言完整错误文案，只断言公共 code、reason 类别、结构化引用和副作用计数。

## 7. 文件清单与升级条件

### 7.1 既有实现需回滚或重做

- IP-02/IP-10：重做 `packages/core/src/scoring-rules/schema.ts` 的 `ReadAssessmentBasisReleaseSetV1Schema`、`AssessmentBasisReleaseSetReadResultV1Schema`；删除请求 `projectId/actorId` 和 success `{releaseSet}` 形状，不提供兼容分支。
- IP-03/IP-10：重做 `packages/core/src/scoring-rules/validation.ts` 的 `projectApplicableRuleSetMembers`、`buildAssessmentBasisMembers`、`assertScoringRuleMembersMatchApplicableRuleSet`，移除静默去重；扩充 relation snapshot；同步重做 `packages/core/src/scoring-rules/service.ts` 与 core test。
- IP-04：重做 `000028_structured_scoring_rules.ts` 的 `rule_relations` 候选 revision/比较基线绑定及约束，并从 review link 删除重复的 decision/status；同步修订 `postgres-foundation.test.ts`、`auth/fixture.ts` 中对应结构断言，迁移清单编号不变。
- IP-05：重做 `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`。删除 `assembleApplicableRuleSetRevision` 内的 `detectRuleRelations`、`#ensureConflictReviewLinks` 调用；把检测/关系写入移入 `prepareRevision`/`appendPreparedRevision`，把 C07 补链接在 submit 成功后，把精确决定门禁放入 `assertRevisionMetadata`/`appendRelease`；重写 basis reader 的审计和 replay。
- IP-06：重做 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` 对 C19 四接缝的参数与事务时点及其测试；修改 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 及其测试，提供不扩展 contracts 的精确冲突决定读取。
- IP-08：重做 `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` 中“先发布冲突规则、组装时再检测/建任务”的 fixture 和断言；重做 `basisRead.releaseSet...`、伪造 actor 仍成功、不可用无审计等旧断言。
- IP-01/IP-07/IP-09/IP-11 现有实现不因本次修补作废；`packages/core/src/scoring-rules/index.ts`、两个 package export、Worker 和 C15 reader 仅需通过回归，无计划改动。

### 7.2 修改文件

- IP-02：`packages/core/package.json`
- IP-05：`packages/adapters/package.json`
- IP-04：`packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`（仅 `000028` import 与 manifest/module-map 条目）
- IP-06：`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`、`packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`
- IP-06：`packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`、`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`
- IP-07：`apps/worker/src/index.ts`
- IP-11：`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`、`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`

### 7.3 删除文件

无。

### 7.4 保护区

禁止修改：`packages/contracts/**`、`packages/core/src/engineering-data/cleaning/**`、`packages/core/src/assessment-config/**`、`packages/adapters/src/assessment-config/**`、根 workspace/lock、`openspec/config.yaml`、生产 migration provider/runner、主 specs、归档/其它 changes、C15 生产代码（除 IP-11 精确列出的 store 文件与方法）、C17/C18 生产代码、API/Web 生产文件。两处测试迁移清单只允许 IP-04 的 `000028` import 与 manifest/module-map 机械条目；不得改其它条目或发现算法。不得新增依赖、Mock/占位/默认规则、开发服务器、提交或归档。

### 7.5 必须升级的条件

1. HEAD 不再以 `7b60892b1561aff7e8bc9357da78c97abad55b17` 为返工基线，或 C07/C08/C16/C18 现有符号、C15 `DataCleaningResultV1Schema`/`#readBoundResult`/`#finalizePreparation` 与本计划不一致。
2. 生产代码出现将 `StructuredScoringRule.reviewStatus` 作为审核/评分门禁的消费者，或 C25 必须这样消费。
3. 无法取得获准的真实规范资料段 fixture，或必须读取原始 Office/逐篇研究材料、自由联网、未授权全文才能验收。
4. 需要修改 contracts、`ReviewAuditPortV1`、`DataCleaningTaskPortV1`、C15 表/迁移/既有冻结行为、C18 生产代码、C25/C11 私表、API/Web、旧迁移、生产 migration provider/runner，或两处测试迁移清单需要超出 `000028` 现有条目的结构断言，或必须新增迁移文件/第六张表。
5. C08 一个 Registry 实例必须同时注册 C17 与 C19 两个不同 `knowledge-authoring` definitions，且现有 composition 所有权不允许分开实例/后续组合。
6. C07 concrete adapter 无法在不扩展公共 contract 的前提下提供精确冲突决定事实，pending-link 补偿无法保持“失败永不误放行”，C03 无法让 success/unavailable 共用原子回执审计，或 C16 policy 接缝要求通用框架/公共接口演进。
7. 规则阈值确需高于公共 number 契约的十进制精度、业务要求非闭合冲突优先级/新枚举，或规则集需要同一工程同一时刻多个活跃 C16 stable definitions。
8. 任何新增第三方依赖、公共契约、数据迁移/回填、权限扩大、范围扩大或计划外生产文件；或实现需要枚举 capability 对应 branch、复制 `#readBoundResult` 查询/解析，或无法让授权/跨工程/缺失/不可见/绑定失配保持同形不可枚举拒绝、撤权先于回执重放、同键异载荷冲突、C03/C04 读取重放不重复审计、瞬时失败仍可区分。

## 8. 已核实的执行命令

定向行为验证：

```bash
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts -t '内容校验|评分边界'
pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts -t '清洗结果有界读取|清洗结果不可枚举|清洗结果无正文旁路|清洗结果读取幂等'
pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t '发布前冲突|冲突补链补偿|冲突审阅|发布最终门禁|发布回滚'
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t 'basis 成员读取|basis 不可枚举|basis 成员清单|basis 规则成员与摘要|basis 无正文|basis 读取幂等|basis 不可用幂等|basis 瞬时失败'
pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts
pnpm exec vitest run apps/worker/test/scoring-rules/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts
pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts apps/api/test/http-shell.test.ts
```

静态、格式与边界验证：

```bash
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/scoring-rules packages/core/test/scoring-rules packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts
pnpm exec prettier --check packages/core/src/scoring-rules packages/core/test/scoring-rules packages/adapters/src/scoring-rules packages/adapters/test/scoring-rules packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts
pnpm deps:check
pnpm deps:policy
rg -n "reviewStatus" packages apps
```

OpenSpec 完成门：

```bash
openspec validate deliver-structured-scoring-rules-and-applicable-rule-sets --strict --no-interactive
openspec instructions apply --change deliver-structured-scoring-rules-and-applicable-rule-sets --json
```

以上命令名称、脚本和现有回归文件均已在固定 worktree 核实存在；新增测试路径由对应 IP 创建后执行。实现 Agent 完成行为与证据、逐项勾选 tasks 后，再交给 `openspec-verify-change` 独立验证；本 change 实施阶段仍不提交、不归档。
