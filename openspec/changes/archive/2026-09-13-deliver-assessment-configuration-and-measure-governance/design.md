## Context

见 [proposal.md](./proposal.md) 与 [delta spec](./specs/knowledge/assessment-configuration-and-measure-governance/spec.md)。当前基线提交固定为 `5c49f20e615c6507be40b5cc74f734fba4b4fb80`，代码现状为：

- C01/C02 已在 `packages/contracts` 冻结 11 个 C18 `KnowledgeDefinitionTypeV1` 值、六项监测指标、P/C 指标类型、五项量化指标组、四项预警触发类型、`KnowledgeModelingPortV1`、`AssessmentBasisReleaseSetRefV1` 和 `knowledge.assessment-basis-published.v1`；C18 禁止修改这些公共契约。
- C16 的 `PostgresKnowledgeGovernanceAdapter` 已实现五个 `govern` 分支和内部 `resolveGovernedReleases`，但按设计只登记不透明内容工件，不读取配置正文，也没有 `resolve/retrieve` 公共实现。其修订、复核、发布、停用、回滚、授权、幂等、审计与 Outbox 事务语义是 C18 必须复用的唯一治理事实源。
- C14 的 `MonitoringSeriesRevisionV1` 和 `MonitoringSnapshotV1` 已固定监测指标、参数码、规范单位、对齐点、短期斜率、加速度、频域主峰、异常评分和可计算性；C18 只能引用这些字段语义，不复制监测事实或算法。
- C03 的迁移提供器递归发现领域目录，不需要中央注册；协调端已确认 C18 使用 `000012`，C13 不占迁移号。当前 package 已锁定 Node.js 24、TypeScript 5.9.3、Zod 4.5.4、Kysely 0.29.5、pg 8.23.0 和测试侧 Testcontainers 12.1.0。

## Goals / Non-Goals

**Goals:**

- 以一个 feature-owned 深层模块定义 11 类配置的唯一 strict Schema、规范化规则、局部校验、跨配置校验和精确矩阵边界函数。
- 让 C18 内容校验作为 C16 修订事务的一部分成立，且发布/历史版本重新发布时原子写出既有评估依据发布事件；失败不能留下已治理但未校验的 C18 修订。
- 物化 C18 自有的评估配置发布集合，供 C19 组合结构化规则与适用规则集、供 C25/C27/C28/C29 后续按精确版本消费。
- 固定接口、数据结构、错误、权限、事务、迁移、文件范围和最小验证，不让实现 Agent 再决定公式、边界或所有权。

**Non-Goals:**

- C18 不把自身配置集合冒充 C19 完成后的最终 `AssessmentBasisReleaseSetRefV1`；本 change 不实现 `KnowledgeModelingPortV1.resolve(assessment-basis)`，C19 将把 C18 配置集合与适用规则集组合为公共评估依据引用。
- 不计算指标实际值、P/C、风险等级、预警、措施排序、预测结果、偏差记录或校准建议；本 change 只校验并解析这些计算所需的版本化依据。
- 不提供批量公共治理命令。一个 C16 `candidateArtifactRef` 仍对应一个定义类型；调用方可用相同未来 `effectiveFrom` 发布一组兼容修订，C18 只在解析时整体收口。
- 不引入通用内容策略注册表、公式执行器、JSONPath/JSON Patch、全局单位词典、内存 adapter、生产 seed、API/Worker/Web 或新依赖。

## Decisions

### D1. 在 C16 事务中接入一个 C18 专用内容策略

`packages/core/src/assessment-config/service.ts` 定义模块内 `AssessmentConfigurationGovernancePolicyV1`，只暴露五个 C18 所需动作：

```ts
interface AssessmentConfigurationGovernancePolicyV1 {
  prepareRevision(command: SubmitAssessmentConfigurationRevisionV1):
    Promise<PreparedAssessmentConfigurationV1>;
  appendPreparedRevision(context: TransactionContextV1, input: {
    revision: KnowledgeRevisionV1;
    prepared: PreparedAssessmentConfigurationV1;
    auditEntryId: string;
    persistedAt: string;
  }): Promise<void>;
  assertRevisionMetadata(input: {
    projectId: string;
    revisionRef: KnowledgeRevisionRefV1;
    authorization: AuthorizationContextV1;
  }): Promise<void>;
  appendRelease(context: TransactionContextV1, input: {
    command: PublishOrRollbackAssessmentConfigurationV1;
    revision: KnowledgeRevisionV1;
    releaseRef: KnowledgeReleaseRefV1;
    audit: AuditAppendV1;
    recordedAt: string;
  }): Promise<DomainEventV1[]>;
  resolveConfigurationSet(request: ResolveAssessmentConfigurationSetV1):
    Promise<AssessmentConfigurationSetResultV1>;
}
```

`PostgresKnowledgeGovernanceAdapterOptionsV1` 增加可选 `assessmentConfigurationPolicy`。适配器直接从 C18 导出的常量判断 11 类定义：命中时缺少 policy 即返回 `BUSINESS_BLOCKED/assessment-configuration-policy-required`；非 C18 类型保持 C16 行为。

执行顺序固定为：

1. `submit-revision` 先完成 C06 授权，再在事务外调用 `prepareRevision` 读取并验证 C04 工件；进入 C16 原事务后创建 revision，并用同一 `TransactionContextV1` 调用 `appendPreparedRevision`，然后提交统一审计和命令回执。
2. `publish-approved-release` 与 `rollback-by-new-release` 沿用 C16 授权、人工调用和批准证明；生成 release ref 后在同一事务调用 `appendRelease`，返回的事件并入 C03 `AtomicCommitV1.events`。
3. `request-review` 在调用 C07 前以 `assertRevisionMetadata` 确认 C18 修订已通过原子内容校验；`deactivate-release` 不新增 C18 状态，仍由 C16 只追加决定控制解析。

为让 C18 集合解析不读取 C16 表，`resolveGovernedReleases` 的内部成功值增加按定义类型排序的 `members`，每项只含 C16 已拥有的 release、revision 和 candidate artifact 精确引用；现有 `releaseRefs` 保留。该方法不是公共 contracts，不新增第二个仓储或 public port。

**替代方案：**独立 C18 adapter 先/后调用 C16 会产生跨事务半成功；复制 C16 五个治理分支会产生第二套事实源；通用 hook registry 会为尚未实现的 C17/C19 增加推测性抽象。专用 policy 是当前最小且能保持原子的接缝。

### D2. 每个工件只承载一个带兼容身份的配置文档

`AssessmentConfigurationDocumentV1Schema` 是以 `definitionType` 鉴别的 11 分支 strict union。公共 envelope 固定：

- `schemaVersion: "1"`；
- 与命令完全一致的 `definitionType`；
- `projectRevisionRef: ProjectRevisionRefV1`；
- `configurationSetRef: VersionReference`，作为 11 个文档的兼容身份；
- `content`，由对应分支 Schema 定义。

工件媒体类型固定为 `application/vnd.riskflow.assessment-configuration+json`，UTF-8 JSON 最大 1 MiB；读取时累积有界字节、严格解码、`JSON.parse`、Zod parse，完整消费流并等待 C04 `verified` 后才返回 prepared value。规范摘要使用既有 `sha256CanonicalJson`，集合使用 Schema 规定的排序，不重排甲方有业务顺序的步骤。

本地校验错误统一为稳定 reason code，例如 `configuration-media-type-invalid`、`configuration-size-exceeded`、`configuration-type-mismatch`、`configuration-project-mismatch`、`configuration-content-invalid`；不把 Zod issue、正文或字段值复制到普通错误。

**替代方案：**一个 ZIP/JSON 含 11 类会要求新批量公共命令和分布式发布语义；自由 JSON 由 C25 解释会把校验推迟并产生多套字段事实源。因此维持 C16 的“一工件一类型”。

### D3. 指标和字段映射只允许闭合来源与转换

`indicator-system` 内容包含 1～256 个按 `indicatorId` 排序的指标：`indicatorType` 复用 P/C 枚举，`group` 复用五组枚举，`valueKind` 为 `numeric | ordinal | boolean`，numeric 必须有 1～32 ASCII 字符的 `canonicalUnit`，并保存结构化适用条件与量化区间引用。至少一个 P 指标、一个 C 指标且量化组至少两类。

`indicator-field-mapping` 含 1～1024 项映射，来源分支固定为：

- `source-field`：资料类型和由 1～16 个 identifier 段组成的字段路径；不是 JSONPath。
- `monitoring-value`：C01 `MonitoringIndicator`、`parameterCode` 和 `value`。
- `monitoring-feature`：固定 `short-term-slope | acceleration | dominant-frequency | anomaly-score`。

每项映射固定目标 indicator、source/target unit 和 `identity | affine`；affine 只允许有限非零 scale 与有限 offset。跨文档校验要求目标 indicator 存在、值种类兼容、监测项属于 C01 枚举、source/target unit 与指标/C14 特征单位一致。C18 不读取监测快照或工程资料正文。

**替代方案：**自由路径和运行时单位词典更灵活，但会让取值依赖字符串解释与隐式转换，违背确定性和 SSOT。

### D4. 权重、聚合和矩阵使用整数/规范十进制

`weight-set` 分 P/C 两组，每项 `{indicatorId, basisPoints}`，`basisPoints` 为 0～10000 安全整数；每组完整覆盖对应指标、至少一项大于零且精确合计 10000。`scoring-strategy` 对 P/C 分别固定：

- `weighted-average`：引用同一兼容集合的 weight-set，累加 `score × basisPoints` 后按 `half-away-from-zero` 和声明的 0～6 位 decimal scale 舍入；
- `maximum`：取轴内最大单指标分值，不携带或读取权重。

`CanonicalDecimalV1` 是无指数、无前导加号/零、无尾随小数零、最多 6 位小数的字符串。`decimal.ts` 使用字符串拆分与 `BigInt` 对齐 scale，提供 compare/add/multiply/round；边界判断不转为 `number`。矩阵轴含 1～32 个按序分段，统一左闭右开、末段右闭；相邻边界必须逐字规范且精确相等。风险等级 1～32 个，使用唯一 `levelId` 和递增整数 `ordinal`。矩阵单元按 `pBandId/cBandId` 排序并精确覆盖笛卡尔积。

Schema 不含 formula、operator tree、script、function name 或自由参数袋，未知字段由 strict parse 拒绝。

**替代方案：**JavaScript number 会让小数共享边界受二进制近似影响；第三方 decimal 包会增加依赖。最多 6 位的规范十进制加 `BigInt` 已覆盖配置边界并保持供应链最小。

### D5. 两类阈值在类型、字段和引用上完全分离

`risk-acceptance-threshold` 只包含按适用条件选择的 `{thresholdId, maximumAcceptedLevelId}`，并引用同集合 risk-matrix；level 必须存在。`monitoring-warning-threshold` 只包含 `{thresholdId, monitoringIndicator, parameterCode, metric, unit, operator, boundaries, warningLevelId}`：

- `metric` 为 `value | short-term-slope | acceleration | dominant-frequency | anomaly-score`；
- 单边 operator 为 `gt | gte | lt | lte` 且只含 `boundary`；区间 operator 为 `outside` 且含 `lower/upper`，lower 必须精确小于 upper；
- `warningLevelId` 必须存在于同集合 risk-matrix，unit 必须与映射/C14 特征口径匹配。

两个 Schema 没有共享的可辨识分支，cross-validation 也不提供 fallback。`joint-trigger-policy` 的 rule 只保存排序唯一 `monitoringThresholdIds`、`operator: all-of | any-of | at-least` 与可选合法 count；不允许递归 child、表达式或风险接受阈值引用。

**替代方案：**一个通用 threshold union 会让调用方在运行时猜语义，且容易把风险等级阈值当作监测数值；分立文档与发布引用更清晰。

### D6. 措施、预测和偏差文档只声明下游口径

`measure-library` 每项按 `measureId` 排序，固定风险事件类别、结构化适用条件、C01 触发类型、1～32 个有业务顺序的步骤、排序资源需求、排序目标 indicator IDs、规范证据和禁忌。目标必须存在于同集合 indicator-system。C18 提供纯函数 `selectMeasureCandidates`，输入精确库、风险类别、适用性元数据和触发类型，输出排序精确 measure IDs；它不调用 Agent、不创建建议。

`forecast-policy` 方法闭合为 `historical-statistics | monitoring-trend | mechanism-model`，固定输入/目标指标、正整数 horizon、单位和所需 `VersionReference`；`deviation-policy` 口径闭合为 `absolute | relative | risk-level-step`，固定 canonical decimal threshold、最小基线与证据要求。relative 要求正基线下限，risk-level-step 以正整数等级步数表达且不携带小数阈值。cross-validation 校验全部指标和矩阵等级引用。

**替代方案：**在策略中嵌入可执行公式会提前实现 C28/C29 并引入安全边界；C18 只冻结可执行口径与版本。

### D7. 评估配置集合由 11 个精确 C16 发布组成

`AssessmentConfigurationResolverV1.resolveConfigurationSet` 输入 `projectId`、`projectRevisionRef`、`requiredAt`、`asOfRecordedAt`、authorization 与稳定 request/idempotency identity。它调用注入的 C16 `resolveGovernedReleases`，固定要求 D2 的 11 类定义；成功后按 definitionType 读取 `assessment_config_revision_metadata`，再通过 C04 按精确 artifact ref 重新读取、完整校验并核对 canonical digest，最后校验所有成员同工程修订、同 `configurationSetRef` 以及 D3～D6 交叉引用。数据库不保存为完成交叉校验而复制的配置正文。

集合 identity 由 `projectId + projectRevisionRef + configurationSetRef + requiredAt + asOfRecordedAt + ordered(member release/ref/digest)` 的 canonical SHA-256 确定性派生。完全相同内容的不同请求返回同一集合；同一幂等键异载荷仍由 C03 拒绝。返回模块私有 `AssessmentConfigurationReleaseSetV1`，包含 11 个排序 member，另派生 measure library 的精确成员引用供 C27 后续使用。

缺成员、停用、未生效由 C16 返回 `BUSINESS_BLOCKED/required-release-unavailable`；工程修订/兼容身份/交叉引用不一致映射 `BUSINESS_BLOCKED/assessment-configuration-incompatible`；无权在读取前返回 `AUTHORIZATION_DENIED`。不回退历史、未审核修订或默认内容。

C19 后续把该私有集合与其结构化评分规则/适用规则集组合为公共 `AssessmentBasisReleaseSetRefV1`；不得修改本集合或把 C19 内容塞入 C18 metadata。

**替代方案：**直接在 C18 实现公共 `assessment-basis` 会缺失 C19 规则事实；只返回散列 release refs 会迫使每个下游重复交叉校验。私有完整集合是当前能力边界内的最小稳定输出。

### D8. `000012` 只保存配置关联和不可变集合

迁移固定为：

`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts`

在既有 `business` schema 创建：

| 表 | 内容与约束 |
| --- | --- |
| `assessment_config_revision_metadata` | C16 revision/project/type/artifact 精确引用、project revision、configuration set ref、canonical content digest、摘要、audit/三类时间；revision 唯一，FK 到 `knowledge_revisions` 与 `audit.entries`，只插入 |
| `assessment_configuration_release_sets` | 私有 set id/version、project/project revision、configuration set ref、required/as-of、ordered member digest、command/authorization/audit/三类时间；identity digest 唯一，只插入 |
| `assessment_configuration_release_set_members` | set、ordinal、definition type、C16 release/revision/artifact ref、content digest；每 set/type 和 set/ordinal 唯一，FK 到 set、metadata 与 C16 release，只插入 |

数据库 CHECK 只保存结构版本、非空身份、JSON object/array、ordinal 和 FK/唯一性，不复制 11 类枚举或业务交叉校验；Zod 是内容 SSOT。`riskflow_app` 仅授予 SELECT/INSERT，PUBLIC、Outbox Worker 和 checkpointer 无权，所有表不授予 UPDATE/DELETE。`down` 仅按 member → set → metadata 精确撤销本迁移对象。

协调端确认 C18 可用 `000012–000015`；本设计只使用 `000012`，不修改 provider、中央迁移测试清单或既有 migrations。

**替代方案：**复制完整配置 JSON 到 PostgreSQL 会形成第二套正文；不保存 metadata 则无法在 C16 同事务证明修订已通过 C18 校验，也会迫使发布重复解释正文。

### D9. 授权、事件、错误与事务沿用既有闭合语义

- 所有 C18 submit/review/publish/deactivate/rollback 先由 C16 使用 C06 校验 `knowledge-modeling.govern`，集合解析校验 `knowledge-modeling.read`；任何工件读取还由 C04 重校当前工程与资料授权。
- 发布、停用、回滚继续要求 human invocation；Agent 只能按 C16 规则提交候选或命令提案。
- C18 本地校验失败映射到 `BUSINESS_BLOCKED`，工件无权/不存在不可枚举为 `AUTHORIZATION_DENIED`，C16 精确引用缺失/陈旧沿用 `ENTITY_NOT_FOUND/STALE_VERSION`，同键异载荷沿用 `IDEMPOTENCY_CONFLICT`，I/O/数据库故障映射 `TRANSIENT_FAILURE/TERMINAL_FAILURE`。
- C18 submit metadata 与 C16 revision/audit/receipt 同事务；发布或 rollback 的 C16 release、C18 校验关联、audit、receipt 和 `knowledge.assessment-basis-published.v1` 同事务。事件 aggregate 为新 knowledge release，payload 只含 `basisKind`、new release 和 metadata 中的 project revision。
- 普通日志、错误和事件不包含配置正文、字段值、工件字节、来源正文、Zod issue 或 SQL 错误。受保护审计只记录精确引用、digest、reason code、actor、authorization、command 和三类时间。

### D10. 文件所有权和依赖保持有界

新增：

```text
packages/core/src/assessment-config/{schema,decimal,validation,service,index}.ts
packages/core/test/assessment-config/{fixture.ts,assessment-config.test.ts}
packages/adapters/src/assessment-config/{postgres-assessment-configuration-adapter,index}.ts
packages/adapters/test/assessment-config/{fixture.ts,postgres-assessment-configuration-adapter.test.ts}
packages/adapters/src/postgres/migrations/knowledge-modeling/
  deliver-assessment-configuration-and-measure-governance/
    000012_assessment_configuration.ts
```

修改：

- `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：仅加入 D1 专用 policy 接缝、C18 必须接入门禁、内部 resolver member 和原子事件组合。
- `packages/adapters/test/knowledge-governance/{fixture,postgres-knowledge-governance-adapter.test}.ts`：注入 C18 policy 后验证 C16 非 C18 行为不漂移、缺 policy 时 C18 拒绝。
- `packages/core/package.json`、`packages/adapters/package.json`：只追加 `./assessment-config` 子路径 export；不改根 barrel，因为当前根 barrel 只聚合 engineering-data。

删除文件为零。禁止修改 `packages/contracts/**`、`apps/**`、C14 生产代码/测试、C16 core Schema/生命周期/migration、根 workspace/manifest、锁文件、依赖政策、中央迁移注册/测试清单、OpenSpec 主 specs/配置、归档或其它活动 change。

不新增依赖。规范十进制使用标准 `BigInt`，JSON 解码使用 `TextDecoder`，摘要复用 `sha256CanonicalJson`，测试复用现有 PostgreSQL/Testcontainers 与 C04/C06/C07/C16 fixture 链。

### D11. 测试只覆盖稳定行为和真实事务

Core 表格驱动测试覆盖：11 分支 strict parse；P/C 与指标组覆盖；字段/单位/特征映射；10000 基点；闭合聚合和 DSL 拒绝；canonical decimal；非 5×5 矩阵、共享边界、缺口/重叠/缺格；两阈值分离；联合规则；措施候选；预测/偏差口径；11 文档兼容集合。断言 Schema 成败、reason code、成员/ref/digest 和数值边界，不锁定完整文案、Zod issue 顺序或内部函数调用。

PostgreSQL 集成测试使用真实 C03/C04/C06/C07/C16/C18 migrations 和文件工件：上传 11 个合法 JSON → 逐项 submit/review/approve/publish → 解析集合；验证原子 metadata、Outbox 事件、幂等/并发、Agent/跨工程拒绝、非法工件无修订、缺成员/停用/兼容冲突不降级、rollback 新发布、旧集合不变、审计失败整体回滚、角色权限及 `000012 up/down/up`。容器不可用即失败，不回退内存 adapter。

既有 C16 adapter 测试与 C14 core 测试作为受影响回归；API/Web 不修改，其现有 generic route 契约无需新增文案或 snapshot 测试。

## Risks / Trade-offs

- [一工件一类型使 11 项发布不是单个公共批量事务] → 使用同一未来 `effectiveFrom` 和 `configurationSetRef`，解析时只接受完整兼容集合；旧冻结集合不受中间状态影响，真实原子整包命令需求出现时另开 contracts change。
- [专用 C18 policy 修改 C16 adapter] → 接缝只服务已到期的 C18 原子校验，不做通用 registry；既有 C16 测试证明非 C18 行为不变。
- [最多 6 位 canonical decimal 不是任意精度] → 这是明确输入上限，可覆盖阈值/矩阵配置并保证比较稳定；甲方提供更高精度且业务确需时以独立 Schema 演进处理。
- [完整解析需要 11 个已发布文档] → 缺失是 G2 前的显式业务等待，不使用默认/历史配置；测试以“合成样本、待甲方复核”的 11 文档 fixture 验收结构。
- [发布事件名称是 assessment-basis 而 C19 尚未组合规则] → 事件只表达 C18 配置成员发布并携带精确 knowledge release；C19/C25 消费者仍必须解析完整最终依据，不能因事件直接运行。

## Migration Plan

1. 在固定 base `5c49f20e615c6507be40b5cc74f734fba4b4fb80` 上先实现 core Schema/decimal/validation/service 与合成配置 fixture。
2. 执行 `000012_assessment_configuration` 创建空 metadata/set/member 表和最小权限；现有 C16 修订无需回填，历史上若有 C18 类型修订但无 metadata，新的 policy 必须拒绝送审/发布并要求重新提交合法内容工件。
3. 实现 C18 PostgreSQL policy，再把专用接缝接入 C16 adapter；通过 package 子路径导出供后续 C19/C25/C27/C28/C29 组合。
4. 没有应用启动动作、API 路由或生产 seed。甲方配置由既有 C04 + C16 命令导入；验收 fixture 明确标注“合成样本、待甲方复核”。
5. `down` 只用于尚无下游引用的开发/测试环境。生产形成 metadata 或集合后不自动删除；问题通过后续向前 migration 和新修订/新发布纠正，旧工件、治理事实、事件和冻结集合保留。

不存在会改变接口、持久化、权限、依赖、范围或任务拆分的 Open Questions。
