## MODIFIED Requirements

### Requirement: 不可变适用规则集组装与人工发布

系统 MUST 以精确工程修订、适用性元数据快照、规则发布、C18 评估配置发布集合、兼容身份、组装策略版本和业务有效时刻物化适用规则集候选。候选 MUST 包含按规则身份排序的纳入规则引用及对候选全集的完整筛选决定；`includedMembers` 的唯一键 MUST 是**规则版本身份**（`ruleId` 与 `ruleVersion` 的组合），并按该身份严格升序排列。评分规则的一次发布承载的是一份累积规则集，因此**同一 `releaseRef` 下允许多条入选规则**；系统 MUST NOT 以释放引用作为入选成员的唯一键。缺少规则或任一 C18 成员、成员未生效/已停用、跨工程、版本/兼容身份不一致、筛选结果不完整、规则身份重复或排序不成立、存在未决冲突时 MUST 整体失败，不得回退、混用或返回部分集合。适用规则集 MUST 复用 C16 `applicable-rule-set` 生命周期，经独立人工审核后创建新的不可变发布；Agent 不得发布或自行审批。

#### Scenario: RA-S3/S4 形成适用规则集

- **WHEN** 至少一条来自真实规范的已发布规则与三维适用性快照和完整 C18 配置集合相容，全部筛选决定完整且无未决冲突
- **THEN** 系统形成 `applicable-rule-set` 候选，并仅在人工批准后创建不可变发布

#### Scenario: 同一次发布的多条规则可同时入选

- **WHEN** 一次评分规则发布中的多条规则都通过适用性筛选，它们共享同一个 `releaseRef` 但各自有唯一规则身份
- **THEN** 候选按规则身份逐条收录并排序，不因释放引用相同而判定重复或丢弃其中任何一条

#### Scenario: 配置或冲突不完整时整体失败

- **WHEN** C18 集合缺失成员、规则与配置兼容身份不一致、规则身份重复或排序不成立，或任何候选规则仍有未决冲突
- **THEN** 系统返回结构化失败，不发布规则集且不返回可供评分消费的部分结果

### Requirement: 评估依据发布集合成员的有界读取

系统 MUST 由 C19 提供一个只接受精确 `AssessmentBasisReleaseSetRefV1`、C06 授权上下文和标准请求幂等身份的狭窄读取入口；请求不得另带调用方可伪造的 `projectId`、`actorId`、名称、列表或 latest 选择器，工程与 actor 只能来自当前 C06 验证结果。入口 MUST 在查询集合或历史回执前按当前事实复验授权上下文及 `knowledge-modeling.read` 能力，只允许读取同一工程中已经物化的不可变评估依据发布集合。成功结果 MUST 是顶层 strict 判别联合，精确为 `{kind: "succeeded", schemaVersion: "1", assessmentBasisReleaseSetRef, memberDigest, applicableRuleSetMember, scoringRuleMembers, configurationMembers}`，不得包装或返回内部 `releaseSet`。`applicableRuleSetMember` MUST 包含精确 `releaseRef`、`revisionRef`、C04 `artifactRef` 与 `contentDigest`；`scoringRuleMembers` 的每项 MUST 包含同样四个字段，按发布引用规范排序。依据集合装的是**规则释放**而不是规则：适用规则集正文的 `included refs` MUST 按 `releaseRef` 投影为依据成员，同一释放下的多条入选规则合并为**一个**依据成员；合并时各项的 `revisionRef`、`artifactRef` 与 `contentDigest` MUST 逐字一致，任一不一致说明发布事实自相矛盾，MUST 整体失败，系统 MUST NOT 保留第一项、取值多数或按其它字段补齐。`configurationMembers` MUST 按定义类型规范排序且恰好覆盖 C18 的 11 类，每项包含 `definitionType`、精确 `releaseRef`、`revisionRef`、C04 `artifactRef` 与 `contentDigest`。每个 `contentDigest` MUST 等于对应 strict 正文的规范 JSON SHA-256 摘要，使 C25 在经 C04 当前授权读取正文后可以复算并核对；`memberDigest` MUST 覆盖上述三个成员集合的完整规范投影。入口 MUST NOT 返回内部集合记录中的工程、准备/适用性快照、配置集合、业务/记录时刻，亦不得返回适用规则集、评分规则或配置正文、显示名称、任意元数据或未发布成员；消费方读取正文时 MUST 另行通过 C04 当前授权与留痕。

运行时边界固定如下，且不得把各分支互相伪装：请求 strict Schema 失败返回 `failed/UNSUPPORTED_CONTRACT`，不调用 C06 或 C19 存储；C06 当前事实明确拒绝、过期、撤权、能力或工程不符返回同一 strict `{kind: "unavailable", error: {code: "AUTHORIZATION_DENIED", ...}}`，只保留 C06 安全审计，不查询 C19 目标/历史回执，也不写 C19 领域审计或完成回执；C06 验证自身发生可重试技术故障返回 `failed/TRANSIENT_FAILURE`，同样不查询目标或写 C19 回执。当前授权通过后，集合零行、跨工程、成员快照 strict 失败、规则成员与 `included refs` 投影不一致或摘要不一致 MUST 返回同一个不可枚举 unavailable；首次该结果与成功结果一样原子写一条 C19 只追加领域审计和 C03 完成回执。

授权复验 MUST 先于历史回执。授权通过后，相同幂等身份与规范载荷重放 MUST 根据既有回执的 audit action 返回原成功或 unavailable 且不重复审计；同键异载荷 MUST 返回 `failed/IDEMPOTENCY_CONFLICT`。历史 success 回执只能在同一不可变成员快照仍存在且 strict 校验通过时重放；success 回执对应行缺失、损坏、摘要漂移或 audit action 缺失/未知属于不可变事实完整性破坏，MUST 返回 `failed/TERMINAL_FAILURE`，不得改写为 unavailable 或创建第二回执。数据库连接、超时、死锁/序列化、C03 或审计提交等可重试故障 MUST 返回 `failed/TRANSIENT_FAILURE`，事务回滚且不完成回执，原幂等身份可重试；其它不可重试技术完整性故障返回 `failed/TERMINAL_FAILURE` 且同样不完成新回执。

reader 只重放已冻结成员，不重新解析“当前发布”：集合形成后成员被停用或出现新发布不得改写该集合；新运行必须通过公共 resolve 形成新集合。reader 也不打开 C04 工件或判断消费方当前是否仍可读取正文；消费方必须使用返回的精确工件引用另行通过 C04 当前授权读取，失败不得由 reader 回退到其它成员。首次在当前授权下得到 completed unavailable 后，即使外部状态后来变化，同一幂等身份仍重放原 unavailable；调用方必须使用新请求身份重新读取。

#### Scenario: 当前授权读取精确集合

- **WHEN** 调用方提交当前仍有效且具备读取能力的 C06 授权上下文和同工程精确评估依据发布集合引用
- **THEN** 系统在授权复验后返回该不可变集合的 strict 成员清单并记录只追加读取审计

#### Scenario: 不可用目标不可枚举

- **WHEN** 集合或必需成员缺失、授权已撤、引用属于其它工程、引用不存在或调用方不可见
- **THEN** 系统返回相同 code 与相同公开结构的不可重试类型化拒绝，不返回成员、存在性或差异化原因

#### Scenario: 成员清单固定精确引用

- **WHEN** 一个有效集合被成功读取
- **THEN** 结果固定集合引用与版本、成员摘要，适用规则集的发布/修订/工件/内容摘要，与其 `included refs` 按释放合并后一致且规范排序的评分规则成员，以及 11 类配置各自的定义类型、发布/修订/工件/内容摘要

#### Scenario: 规则成员与内容摘要可复验

- **WHEN** C25 使用成功结果中的工件引用经 C04 当前授权读取适用规则集、评分规则和 11 类配置正文
- **THEN** C25 对 strict 正文复算的每个 `contentDigest` 与结果相等，适用规则集 `included refs` 的规则发布成员按释放合并后的规范投影与 `scoringRuleMembers` 完全一致；任一缺失、额外成员或摘要不符均不得作为有效评估依据

#### Scenario: 成员读取不返回正文

- **WHEN** 消费方取得评估依据发布集合成员清单
- **THEN** 结果不包含适用规则集、配置或评分规则正文、显示名称、自由字段或未发布成员，正文只能由消费方使用返回的 C04 工件引用另行受权读取并留痕

#### Scenario: 读取重放保持幂等且不绕过撤权

- **WHEN** 当前授权仍有效的调用方以相同幂等身份和规范载荷重放读取
- **THEN** 系统只在历史 success 回执和不可变成员快照仍一致时返回原成员清单且不重复追加领域审计；若授权已经撤销，则先返回统一拒绝而不查询或重放历史成功结果

#### Scenario: 不可用结果也可幂等重放

- **WHEN** 当前授权有效但精确集合缺失或成员快照不可用，且调用方以相同幂等身份和规范载荷重复读取
- **THEN** 系统两次均返回同一 strict unavailable 结果，只存在一条 `.unavailable` 领域审计和一个完成回执；同键改传其它集合引用时返回幂等冲突

#### Scenario: 瞬时失败不伪装成不可用

- **WHEN** 数据库、审计或 C03 回执提交发生瞬时失败
- **THEN** 系统返回 strict failed 技术结果且不完成读取回执，后续可使用原幂等身份重试

#### Scenario: 历史成功与不可变快照矛盾时失败关闭

- **WHEN** 当前授权有效且历史 success 回执存在，但其集合行、成员快照、成员摘要或对应 audit action 缺失或损坏
- **THEN** 系统返回 `failed/TERMINAL_FAILURE`，不返回成员、不改写原回执、不新增 unavailable 审计或第二回执

#### Scenario: 冻结集合不受后续发布变化追溯改写

- **WHEN** 评估依据集合形成后其成员被停用或同类型发布了新版本，且调用方仍持有当前有效读取授权
- **THEN** reader 仍只返回冻结集合中的精确成员；新评估必须重新 resolve，reader 不选择新成员、旧成员替代或“当前版本”

#### Scenario: 同一释放下的成员冲突整体失败

- **WHEN** 适用规则集的 `included refs` 中多条规则共享同一 `releaseRef`，但它们的修订引用、工件引用或内容摘要互相矛盾
- **THEN** 系统返回同一不可枚举 unavailable，不返回合并后的依据成员，也不保留其中任一条
