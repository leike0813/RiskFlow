## Context

动机见 [proposal.md](./proposal.md#why)，行为契约见 [specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md](./specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md)。当前基线已经具备 C04 内容寻址工件、C06 授权、C07 审阅、C08 有界 Agent 运行时、C16 定义生命周期和 C18 评估配置解析，但尚无 C19 规则正文、冲突事实、筛选决定或最终评估依据解析。

C01/C02 已冻结 `StructuredScoringRuleSchema`、三维 `ApplicabilityMetadataSchema`/`ApplicabilityConditionsSchema`、`structured-scoring-rule`、`applicable-rule-set`、`rule-conflict`、`knowledge-authoring`、`KnowledgeModelingPortV1.resolve(assessment-basis)` 与 `AssessmentBasisReleaseSetRefV1`。本 change 不修改公共契约。C15 尚未实现，只以检查点 `ba13a0d6f19609fcb4c6f0f40fc4dd035516effc` 的五工件为接口输入；实现开始前必须确认其 `DataCleaningResultV1`、结果工件读取和资料段集合契约已集成且未漂移。

代码调查确认：C08 `AgentTaskDefinitionRegistry` 在一个实例内按任务类型唯一注册，C16 PostgreSQL adapter 目前只为 C18 提供专用内容策略接缝，C18 私有 `AssessmentConfigurationReleaseSetV1` 是最终评估依据的必要成员但不是公共 `AssessmentBasisReleaseSetRefV1`。`AssessmentPreparationSnapshotV1` 包含适用性快照引用，公共知识解析命令只传准备快照引用；C19 因此使用注入式只读解析接口，不越层读取 C11/C25 私有表。

## Goals / Non-Goals

**Goals:**

- 用一个 `knowledge/rules` 深层模块收口规范编制、规则校验、冲突检测、三维筛选、治理策略与评估依据解析，不复制 C08/C16/C18 状态机。
- 固定 Agent 候选、内容工件、冲突、筛选、发布和最终依据之间的版本/证据链，以及授权、事务、幂等和失败语义。
- 让一条经 C15 保留的真实规范资料段完成 RA-S3/S4 验收，并以代表性冲突和不适用规则证明门禁。

**Non-Goals:**

- 不实现 C15 清洗、C17 识别知识、C18 配置治理、C25 评估准备持久化或后续 P/C、矩阵、预警与 UI。
- 不新增公开 Schema、定义类型、Agent 任务类型、审核状态、HTTP 路由、Web 页面、第三方依赖、全局任务注册表或第二套生命周期。
- 不在 C19 保存规范正文、配置正文或模型响应副本；不允许未审核默认规则、Mock 后端、兼容旧字段或运行时名称猜测。
- `StructuredScoringRule.reviewStatus` 不是已发布准入事实：Agent 候选始终保留 `pending`，C16 精确发布与 C07 人工决定才是唯一审核事实。

## Decisions

### D-01：新增单一 `scoring-rules` 领域子路径并复用既有公共契约

核心模块位于 `packages/core/src/scoring-rules/`，适配器位于 `packages/adapters/src/scoring-rules/`，分别由 `@riskflow/core/scoring-rules` 和 `@riskflow/adapters/scoring-rules` 导出。模块直接复用 contracts 的规则、适用性、证据、知识/审阅/Agent 引用，以及 C18 的私有配置集合类型；不在 C19 重新声明公共 DTO 或枚举。

生产入口只暴露四个窄能力：创建 C19 `knowledge-authoring` definition、作为 C16 的 C19 内容治理策略、实现 `Pick<KnowledgeModelingPortV1, "resolve">` 的 `assessment-basis` 分支，以及从 C19 core 子路径导出的评估依据发布集合成员 reader。API 已有通用知识路由，Worker 已有通用 runner；reader 只供受控的进程内消费方注入，因此不新增 API/Web 行为。

**替代方案：**扩展 `packages/contracts` 会违反 change 边界；按校验、冲突、筛选拆成多个横向 util 会增加事实源和调用顺序耦合。

### D-02：两个受治理文档是正文 SSOT，Agent 只提交规则级操作

`StructuredScoringRuleDocumentV1` 为 `structured-scoring-rule` 内容工件，固定 `schemaVersion: "1"`、精确工程修订、C18 配置集合/兼容身份、按 `ruleId` 排序的 `rules[]` 及每条规则对应的来源版本、C15 清洗结果工件、资料段证据和 Agent/校验引用。规则对象直接由公共 `StructuredScoringRuleSchema` 解析；来源关联只增加追溯关系，不复制条文正文。

`ApplicableRuleSetDocumentV1` 为 `applicable-rule-set` 内容工件，固定工程修订、适用性元数据快照引用及三维值、结构化规则发布、C18 配置集合、兼容身份、筛选策略版本、按身份排序的纳入规则引用，以及候选全集中每条规则恰好一个 `included | excluded` 决定和稳定原因码。筛选决定是正文 SSOT，数据库仅保存其精确工件引用、摘要和治理关系。

Agent 的 `ScoringRuleAuthoringCandidateV1` 只允许 `add-rule` 与 `replace-rule` 两种判别操作；替换必须携带被替换规则的精确 `ruleVersion`，每项携带一个完整公共规则候选和现有证据引用。没有通用 Patch、路径、删除、整文档覆盖、发布或决定字段。确定性 materializer 将已接受操作应用到精确 base release 后生成完整新文档。

**替代方案：**让 Agent 返回整包会掩盖逐项接受/拒绝；把筛选决定拆成可变数据库事实会形成第二正文事实源。

### D-03：`reviewStatus` 固定为候选自述，发布事实不回写正文

协调裁决固定：Agent 产生的每条公共规则 `reviewStatus` 必须为 `pending`，strict 校验拒绝 `approved` 和 `rejected`。C16 提交后内容工件不可变；人工 `knowledge-revision` 决定和由此创建的精确 C16 release 是唯一审核事实。适用规则集组装只读取已发布 release 对应工件，绝不以正文 `reviewStatus` 判断是否审核，也不在发布时生成一份仅修改状态的新工件。

当前仓库生产代码没有 `reviewStatus` 消费方；只有 contracts 测试构造该字段。若实现前出现把该字段作为 C25 或其它生产准入门禁的消费者，必须停止并升级为独立契约演进，不在 C19 添加兼容分支。

**替代方案：**发布时改正文违反 C04/C16 不可变性；预写 `approved` 赋予 Agent 审核权；二次修订/二次审核会形成无终点循环。

### D-04：C15 结果工件与 C18 指标体系共同冻结 Authoring Manifest

`ScoringRuleAuthoringManifestV1` 保存到 C04，固定工程/父运行/授权、C15 `DataCleaningResultV1` 的精确结果工件、被保留的来源版本与资料段标识、受控标准来源类别、C18 配置集合和其中唯一 `indicator-system` 成员、可选 base 规则 release，以及模型/提示/工具/预算/增量/校验策略引用。适配器通过 C15 计划公开的 `readBoundResult` 读取并复验任务—结果双向绑定，只接受 `available | partial` 中未被排除的资料段；通过 C18 `resolveConfigurationSet` 固定完整配置集合，再从其指标体系工件做有界读取。

验收 fixture 必须使用一条有可核验标准名称、来源版本和资料段定位的真实规范条文，经 C15 结果标记为保留；测试代码只保存获准的最小资料段/摘要和精确引用。若实施基线没有这种合格 fixture 或 C15 尚未集成，实现停在契约夹具门并升级，不以合成规则冒充出口验收。

**替代方案：**直接读转换表会绕过 C15 收口；让模型自由检索规范或按名称选“最新”来源不可重放。

### D-05：复用 C08 Runner，C19 definition 只允许两个有界只读工具

`createScoringRuleAuthoringTaskDefinition()` 注册 `embedded | interactive` 的 `knowledge-authoring` 定义，固定策略引用并只提供：

1. `read-standard-segment-slice`：按 manifest 内来源版本和资料段标识返回有界条文切片及证据引用；
2. `read-indicator-catalog-slice`：按 manifest 内 C18 指标体系 release/artifact 和指标身份返回有界指标定义。

两个工具都复验任务类型、精确工具策略、工程、资料授权、manifest 归属、目标版本和对象/字节预算，并把观察写入 C04。`finalizeCandidate` 先逐项校验和 materialize 规则文档，再通过原 C16 `govern(submit-revision)` 提交待治理修订，返回 C08 允许的 `KnowledgeRevisionRefV1`；任何冲突事实与修订元数据同事务挂接，Agent 本身不获得治理写能力。

C19 只导出 definition 及 Worker 的 render/interpret 组合函数，不创建全局 Registry 或第二 Runner。C08 Registry 的 task-type 唯一约束限定单个 Worker 组合实例；C17/C19 的部署组合不在本 change 内以多路复用抽象提前解决。

**替代方案：**新建模型循环会复制 C08 预算/恢复；给工具通用检索会扩大资料面；在 C19 提前实现 C17/C19 multiplex 属于跨所有权设计。

### D-06：确定性规则校验先于冲突检测，失败分类闭合

`validateScoringRuleOperations()` 按输入顺序生成 C08 标准逐项决定，依次校验：操作/base 版本、公共 strict Schema、`reviewStatus === pending`、三维非空且规范排序、指标存在且属于同一 C18 兼容集合、阈值/区间身份唯一与数值域闭合、评分/等级覆盖无空洞和内部重叠、例外引用存在、证据命中 manifest 保留资料段。规则版本由 accepted operation 与 base release 规范摘要确定，拒绝 Agent 自造的漂移版本。

字段、格式、缺失引用和候选越界归为可修复；权限、来源资格、base/配置版本不兼容归为不可修复。规则间冲突在候选 materialize 后统一检测，也属于不可修复，不进入 C08 修正循环。系统不执行字符串公式、脚本或动态函数。

**替代方案：**边生成边写修订会留下半包；把阈值冲突交给 LLM 会不可重放。

### D-07：冲突和重叠使用同一相交算法，结论不同才形成发布门禁

`detectRuleRelations()` 仅比较同工程、同兼容集合、同指标且三维条件集合逐维有交集的规则。阈值按公共 operator 转换为带开闭边界的标量区间，枚举/布尔 `eq` 转换为单点；与 grade interval 的结论投影共同产生交叠域。交叠域结论不同或例外相互否定为 `conflict`，结论相同为 `overlap`。每个事实身份由策略版本、双方规范排序后的精确规则版本和交叠域摘要确定，避免左右顺序产生重复。

每个 conflict 事实还固定闭合优先级策略给出的 `retainedRuleVersionRef` 与 `excludedRuleVersionRef`；优先级仅按来源类别、标准业务版本和规则身份比较，不读取模型置信度或输入顺序。冲突一律创建 C07 `rule-conflict` task；创建失败时冲突仍为 pending，后续幂等重试只补同一 task link。只有目标精确匹配的人工 `approve-publication` 可批准该精确拟议处置，组装时只纳入 retained 规则并以 `approved-conflict-resolution` 筛除另一条，绝不让冲突双方同时进入集合；`reject`/`return-for-revision` 要求新规则修订。重叠不自动阻断，仍按同一闭合优先级保留一条并保存被去重成员及原因。

**替代方案：**对所有规则 O(n²) 扫描没有必要；按指标+三维倒排候选后只比较相交集合。引入外部规则引擎也无必要且会新增依赖。

### D-08：C16 增加第二个专用策略分派，不修改 C18 实现

`PostgresKnowledgeGovernanceAdapterOptionsV1` 新增可选 `scoringRulesPolicy: ScoringRulesGovernancePolicyV1`。现有 `assessmentConfigurationPolicy` 和 C18 adapter 保持不变；C16 的四个既有 policy helper 按定义类型分派：C18 的 11 类走原策略，`structured-scoring-rule | applicable-rule-set` 走 C19 策略，其它类型保持原通用行为。C19 类型缺少策略时以 `BUSINESS_BLOCKED` 拒绝，避免绕过内容校验。

C19 policy 复用 C18 的四阶段范式：事务前 `prepareRevision` 有界读取/校验 C04 工件；同一 C16 事务 `appendPreparedRevision` 保存元数据；request review/publish 前 `assertRevisionMetadata` 复验；发布或 rollback 时 `appendRelease` 验证工件绑定并为 `applicable-rule-set` 返回既有 `knowledge.assessment-basis-published.v1` 事件。`structured-scoring-rule` 单独发布不代表完整评估依据，因此不发该事件。

**替代方案：**把两个策略抽成新的通用插件框架会扩大 C16/C18 diff；复制 C16 生命周期到 C19 会产生第二事实源。第二个窄分派是当前两类新增定义的最小改动。

### D-09：适用规则集由纯函数筛选，完整候选决策随工件送审

`assembleApplicableRuleSet()` 接收精确已发布规则文档、C18 配置集合、`ApplicabilityMetadataSnapshotV1` 的引用和值、工程修订、策略和授权。三维匹配是逐维精确身份相等：规则每个数组必须包含快照对应值；例外策略只接受版本化闭合原因/条件，不解释自由文本。每条候选规则恰好产生一次决定：`included`，或 `construction-method-mismatch`、`stratum-condition-mismatch`、`engineering-stage-mismatch`、`exception-applies`、`conflict-unresolved`、`compatibility-mismatch`、`superseded-overlap` 等闭合原因。

只有至少一条纳入规则、候选全集决策完整、无未决冲突且 C18 集合完整相容时才生成 `ApplicableRuleSetDocumentV1`，再通过 C16 `submit-revision → request-review → publish-approved-release`。筛选本身不发布、不自动审批；每个新的适用性快照或规则/C18 版本变化产生新候选修订，不覆盖旧集合。

**替代方案：**运行评分时临时筛选会让同一评估不可重放；把每个快照建成一个 C16 稳定定义不符合 C16 每工程每类型单一稳定身份。

### D-10：评估准备读取采用注入式显式接口，解析只返回精确集合引用

核心定义 `AssessmentPreparationSnapshotReaderV1`，输入精确 `AssessmentPreparationSnapshotRefV1`、工程和当前授权，输出公共 `AssessmentPreparationSnapshotV1`；C19 不实现 C25 存储，也不直接读其表。`PostgresScoringRulesAdapter.resolve()` 只接受公共 `assessment-basis` 命令，先由 reader 取准备快照并复验工程/授权，再以命令 `requiredAt` 和 `issuedAt` 作为业务/记录时点解析唯一 C16 `applicable-rule-set` release 与 C18 配置集合。

resolver 有界读取该规则集工件，要求其适用性快照、工程修订、规则 release、C18 集合和兼容身份全部相符，然后以规范摘要生成不可变 `AssessmentBasisReleaseSetV1` 内部记录并返回公共 `AssessmentBasisReleaseSetRefV1`。该记录只含精确成员引用/摘要，不复制正文。未准备完成或成员未发布可返回公共 waiting；错工程、停用、时间/版本/兼容冲突返回 failed。调用相同命令只命中同一集合引用。

内部记录的后续读取由 D-14 的 C19 自有 reader 承担；公共 resolve 结果继续只返回冻结引用。

**替代方案：**C19 直接查询 C11/C25 私表违反层边界；在公共命令增加快照正文违反禁止修改 contracts；仅返回即时散列而不保存集合将失去可重建依据。

### D-11：一项 `000028` 迁移覆盖 C19 只追加关系事实

使用预留号段首项 `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts`，不占用 `000029–000031`。迁移新增：

- `business.scoring_rule_revision_metadata`：C16 revision、项目/工程修订、规则/C18 兼容引用、artifact/manifest/task/validation 引用、摘要和三时态；
- `business.rule_relations`：不可变 conflict/overlap ref、双方规则版本、拟保留/拟筛除规则版本、相交域/证据/策略摘要和创建事实；
- `business.rule_conflict_review_links`：精确 relation、C07 task/decision、状态及三时态，按 relation+attempt 幂等；
- `business.applicable_rule_set_revision_metadata`：C16 revision、适用性快照、规则 release、C18 set、artifact、decision digest 和三时态；
- `business.assessment_basis_release_sets`：公共 set ref、准备/适用性快照、applicable rule set release、C18 set、工程/时点、strict 成员快照、成员/身份摘要和三时态。

所有正文/逐项筛选仍在 C04；表只存引用和规范摘要。主键、外键、工程/类型 check、精确 ref 唯一约束和必要的工程+类型+时间索引在数据库收口。应用角色只获 SELECT/INSERT；需要链接 C07 决定时追加新行，不更新原 relation。迁移 provider 已递归发现文件，不修改中央注册或测试清单。

**替代方案：**四个连续迁移会增加部署/回滚面；修改 C16/C18 旧表会耦合所有权且难以独立回退。

### D-12：授权、幂等、事务、审计与错误沿用 C03/C06/C07/C08/C16

所有公共 govern/resolve 入口先按 `MODULE_BRANCH_CAPABILITY_V1` 校验工程、actor 和精确能力；工具动作进一步复验资料授权和冻结目标。authoring prepare、conflict task/link、规则集 assembly 和 basis resolution 各自使用规范 command/input digest，`(project_id, idempotency_key)` 同载荷重放、异载荷 `IDEMPOTENCY_CONFLICT`。并发 revision/release 继续由 C16 definition lock、expected base 与数据库约束收口。

C16 revision metadata/relations 与 revision/audit/receipt 在同一事务；适用规则集 metadata 与 revision 同事务；applicable release/metadata 校验/audit/receipt/outbox 同事务；basis set/audit/receipt 同事务。C07 是独立领域端口时采用 C16 已有的耐久 pending link → 幂等创建 → 原子回填方式，任何中断仍保持发布门禁。工件先耐久再写引用，孤儿工件不构成正式结果。

错误映射限于 `AUTHORIZATION_DENIED`、`UNSUPPORTED_CONTRACT`、`BUSINESS_BLOCKED`、`STALE_VERSION`、`IDEMPOTENCY_CONFLICT`、`TRANSIENT_FAILURE`、`TERMINAL_FAILURE` 及公共 waiting；稳定 reason code 指明来源、规则、冲突、适用性、配置或准备阻断，不复制正文、凭据或数据库信息。审计保存可重建引用、逐项决定摘要、操作者、策略与三时态；模型思维链不保存。

**替代方案：**C19 自建审计、队列或错误体系会重复平台事实；跨端口分布式事务不可用，耐久门禁和幂等补链比伪原子更可靠。

### D-13：文件所有权和验证保持最小

新增 core/adapters/worker 的 `scoring-rules` 子目录、一个迁移和三类行为测试；只修改两个 package export、C16 PostgreSQL adapter 的 C19 policy 分派和 Worker 根导出。API 通用路由、Web、contracts、C18、根 workspace、锁文件、迁移 provider 与中央测试清单不改。测试以表格驱动覆盖规则校验/冲突/三维筛选，用一条 PostgreSQL 集成主链覆盖 C15→C08→C16/C07→C19→C18→public resolve，并保留 C16/C18/Worker 代表性回归。

**替代方案：**为每个原因码写独立测试会锁定内部结构；只保留根因、权限、事务、幂等、真实规范出口和公共解析契约的代表性边界。

### D-14：C19 导出狭窄成员 reader，不扩展 C02 或 contracts

`packages/core/src/scoring-rules/schema.ts` 定义 strict `ReadAssessmentBasisReleaseSetV1Schema`、`AssessmentBasisReleaseSetMembersV1Schema` 和 `AssessmentBasisReleaseSetReadResultV1Schema`。请求的领域选择字段只有精确 `assessmentBasisReleaseSetRef` 与 C06 `authorization`，另携带 C03 所需的 `requestId`、`idempotencyKey`、`requestedAt`。成功值固定为 `assessmentBasisReleaseSetRef`、`schemaVersion: "1"`、`memberDigest`、`applicableRuleSetReleaseRef` 和 `configurationMembers`；后者必须按定义类型规范排序且恰好覆盖 C18 的 11 类，每项只含 `definitionType`、`revisionRef`、`artifactRef`。所有对象 strict parse，不允许正文、显示名称、扩展元数据或自由字段。

`packages/core/src/scoring-rules/service.ts` 导出 `AssessmentBasisReleaseSetReaderV1`，其唯一方法 `readAssessmentBasisReleaseSet(input)` 返回上述类型化结果。`PostgresScoringRulesAdapter` 实现该方法，并注入 C06 `LocalIdentityAccessV1.verify`：先按 `knowledge-modeling.assessment-basis` 对授权上下文引用做当前事实复验，再以验证后的 `projectId + assessmentBasisReleaseSetRef` 单点查询 `business.assessment_basis_release_sets`，strict parse `member_snapshot` 并复验引用、11 类成员、摘要和版本。没有 list、search、按名称、按“最新”或跨工程查询；reader 不打开任何 C04 工件，C25 等消费方必须拿 `artifactRef` 另行通过 C04 当前授权读取正文并留下 C04 访问记录。

不存在、成员缺失、撤权、跨工程和不可见统一映射为同一个不可重试 `ModuleErrorV1` `AUTHORIZATION_DENIED` 公开形状，调用方不能从 code 或 payload 枚举目标；内部 C06 安全审计或脱敏诊断可保留实际失败类别。授权复验先于 C03 幂等回执查询，避免旧成功回执绕过撤权。授权通过后，读取结果或统一不可用结果以 `knowledge.read-assessment-basis-release-set.v1` 的规范载荷写入既有 C03 回执与只追加 audit：两类提交的 `resultRef` 都使用调用方给出的精确集合引用，audit action 只允许 `knowledge.read-assessment-basis-release-set.succeeded` 或 `knowledge.read-assessment-basis-release-set.unavailable`。回执重放通过 `auditEntryId` 读取该闭合 action 重建原成功/拒绝结果，不新增结果表；相同键同载荷不重复 audit，同键异载荷冲突。瞬时数据库故障不提交完成回执，仍使用现有 `TRANSIENT_FAILURE`，不伪装为权限结果。

该入口不放入 C02 `KnowledgeModelingPortV1`：C02 的 `resolve(assessment-basis)` 是跨层冻结入口，只承诺返回公共集合引用；成员投影由 C19 私有物化结构拥有，只供确定性评估组合时注入。扩展 C02 会迫使无此存储的公共端口实现成员读取并暴露 C19 内部集合布局。也不修改 `packages/contracts`：输入、成员和错误的叶子类型全部复用既有公共引用与 `AuthorizationContextV1`/`ModuleErrorV1`，聚合 Schema 留在 `@riskflow/core/scoring-rules` 即可满足 C19→C25 的显式模块接口。

**替代方案：**C25 直读 C19 表违反模块所有权；把成员塞进公共 resolve 响应会改变 C02 wire contract；新增通用 repository 或 HTTP query 会扩大权限面。一个 C19 自有、精确引用驱动的 reader 是最小边界。

## Risks / Trade-offs

- [C15 尚未实现且其接口可能漂移] → 实现第一步按固定检查点核对导出符号、结果双向绑定和资料段语义；任何公共/内部接口变化立即升级，不复制 C15 私有结构。
- [公共 `reviewStatus` 容易被误读] → 候选固定 `pending`，发布消费只认 C16 release+C07 decision，并以仓库级搜索门检查新增生产消费者。
- [C08 Registry 按 task type 唯一] → C19 只提供 definition 和组合函数，不创建全局 registry；跨 C17 的部署组合由拥有 composition 的后续 change 决定。
- [阈值公共类型使用 JavaScript number] → C19 只在公共类型允许范围内规范化比较并拒绝非有限值，不宣称高于契约的十进制精度；若业务要求精确十进制规则，另开公共契约 change。
- [冲突对数量随规则增长] → 先按指标与三维交集缩小候选，并为对应列建索引；只有基准证明不足时再引入更复杂索引。
- [C07 跨端口调用不能与 C19 事务合并] → pending relation 永远阻断发布，任务创建与 link 使用幂等补偿；不会因中断误放行。
- [真实规范验收资料受授权/版权约束] → 只使用 C15 已保留且获准的最小资料段/摘要，正文留在 C04；无合格输入时明确阻断，不以研究原件或合成数据替代出口。

## Migration Plan

1. 在实现基线确认 C08/C16/C18 已归档集成、C15 检查点对应接口已实现、contracts 未漂移、生产代码无 `reviewStatus` 门禁，并准备一条获准真实规范 fixture；任一失败立即升级。
2. 部署 `000028_structured_scoring_rules` 的新表、约束、索引和最小角色权限；无回填、无旧表修改。
3. 发布 core/adapters/worker 代码并先导入一份候选规则文档；通过 C07/C16 人工审核后发布结构化规则，再组装并人工发布适用规则集。
4. 以真实规范、冲突规则和三维不适用规则运行 RA-S3/S4 验收，确认 basis resolve 返回精确集合引用后才允许后续 C25 消费。
5. 应用回滚时先停止新 C19 写入并回退应用；已发布 release、审阅、审计和 C19 关系事实保留。仅在确认无应用引用后执行迁移 `down`，不改写 C16/C18 历史。

## Open Questions

无。`reviewStatus` 语义已由协调者裁决；C15 集成和真实规范 fixture 是实现前可判定的硬门，不是可延后设计决定。
