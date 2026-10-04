## ADDED Requirements

### Requirement: 评估依据准备投影由所属域提供

系统 MUST 由 C11 通过生产 `AssessmentPreparationSnapshotReaderV1` 提供同工程精确评估准备快照的有界投影，C19 不得直接查询 C11 私表或以测试闭包提供正式依据。成功投影 MUST 严格只包含 `schemaVersion`、`preparationSnapshotRef`、`projectId`、`projectRevisionRef`、`applicabilitySnapshotRef`、`applicability`；引用和适用性值 MUST 来自相互绑定的已保存准备及适用性快照，并复用已有字段 Schema。C15 清洗任务和结果工件 MUST 绑定规范编制 manifest 的合格输入，不作为本准备投影必填字段；配置集合、兼容身份及业务有效／记录时刻由 C19/C18 发布解析承担，不进入准备投影。公开 `AssessmentPreparationSnapshotV1` 的字段集合保持不变。

读取请求 MUST 校验 strict 契约与精确 `assessment-preparation-snapshot` 引用 kind，不包含 `requiredAt` 或调用方自选分支；格式错误 MUST 返回 `UNSUPPORTED_CONTRACT`。生产 reader MUST 在查询前以原 `knowledge-modeling.assessment-basis` 分支、request invocation、授权引用和请求当前时刻通过 C06 verify，并核对工程及 actor。内部同工程精确行读取只用于定位保存的空间及来源范围，MUST 在同一调用身份下复验这些全部范围后才暴露投影，且不得扩大原授权。不存在、错版本、跨工程、缺范围、会话失效或撤权 MUST 返回不可枚举的 `AUTHORIZATION_DENIED`，不返回部分投影；基础设施故障 MUST 保留技术失败。读取 MUST NOT 新增准备、评估、领域回执或事件；C06 必需安全审计沿原契约记录。C11 原 C25 准备上下文入口仍使用其固定 evidence-access 分支，两个入口 MUST 复用所属精确行解析和保存范围核验逻辑。

C19 组装及 resolve MUST 核对生产投影的准备引用、工程、工程修订及适用性绑定；组装请求的适用性引用与完整值 MUST 匹配该投影，候选 MUST 使用经验证的真实投影值。返回身份或适用性错配 MUST 在候选／依据成功写入前结构化拒绝。

#### Scenario: 真实准备支持规则集组装

- **WHEN** C11 已冻结没有清洗字段的评估准备，C19 以当前具备保存空间和来源权限的原身份读取该精确准备
- **THEN** C11 返回 strict 六字段生产投影，工程修订与适用性取保存事实，C19 可据此继续组装已发布规则

#### Scenario: 准备读取拒绝不枚举目标

- **WHEN** 精确准备不存在、版本或工程不符、actor 或 invocation 不符、缺保存空间权限或来源授权已撤销
- **THEN** reader 返回相同公开结构的 AUTHORIZATION_DENIED，不暴露目标或部分投影，不新增成功业务事实；技术故障保持技术失败

#### Scenario: 投影身份或适用性错配不能用于组装

- **WHEN** reader 返回的准备引用、工程修订或适用性绑定与实际请求不符，或组装请求的适用性值与生产投影不同
- **THEN** C19 拒绝组装或解析，不产生候选／依据成功事实；规则编制仍要求真实 C15 收口来源

## MODIFIED Requirements

### Requirement: 公共评估依据解析

系统 MUST 通过 C02 `KnowledgeModelingPortV1.resolve(assessment-basis)`，以命令中的工程、授权、精确评估准备快照和 `requiredAt` 解析一个不可变 `AssessmentBasisReleaseSetRefV1`。解析结果 MUST 绑定该准备快照所引用的适用性元数据快照、唯一有效的 C19 适用规则集发布和相容的 C18 配置发布集合；解析后下游只能使用该精确引用。尚未组装或未批准、缺失/停用、业务时刻无效、准备快照不匹配、跨工程或兼容身份不一致 MUST 返回结构化等待或失败，不得猜测快照内容、回退历史版本或拼装“最新”成员。

C19 组装和 resolve MUST 使用 C11 生产准备投影核对精确准备、工程修订及冻结适用性，并分别调用已有 C18 `resolveConfigurationSet` 取得真实发布配置集合。组装使用请求 `requiredAt` 和 `asOfRecordedAt`，resolve 使用命令 `requiredAt` 和 `issuedAt`；当前权限复验 MUST 使用调用的 `requestedAt` 或 `issuedAt`，不把历史业务时刻当作当前授权时刻。返回配置集合的工程、工程修订与精确 `configurationSetRef` MUST 分别匹配组装请求／已发布规则集正文，规则集工程修订、适用性引用及值 MUST 匹配准备投影。兼容身份 MUST 沿 C19 版本化策略、规则修订与规则集发布核验，不由准备投影伪造。任一绑定不符 MUST 在 C19 候选／依据成功事实写入前失败；C18 既有解析留痕保留。评估准备读取不依赖 C15 identification 准备结果，清洗来源义务仍在规则编制阶段成立。

#### Scenario: 精确依据可供后续评估冻结

- **WHEN** 评估准备快照已有匹配且有效的适用规则集和完整 C18 配置集合
- **THEN** 系统返回唯一精确评估依据发布集合引用，不复制规则或配置正文

#### Scenario: 未准备完成时不返回默认依据

- **WHEN** 评估准备快照尚无匹配的已批准规则集或所需成员在 `requiredAt` 不可用
- **THEN** 系统返回结构化等待或失败且不使用默认规则、缓存候选或旧版本冒充正式依据

#### Scenario: 配置或准备绑定不符时拒绝依据

- **WHEN** C18 解析出的配置集合或工程修订与组装请求／已发布规则集不同，规则集适用性与真实准备不符，或兼容身份不成立
- **THEN** 组装或 resolve 返回结构化失败，不形成 C19 候选／依据成功事实，不以合成投影或固定 basis 引用绕过检查
