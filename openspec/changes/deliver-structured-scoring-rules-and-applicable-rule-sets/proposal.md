## Why

RiskFlow 已能治理评估配置，但仍缺少从合格规范条文形成结构化评分规则、按工程三维适用性筛选并发布不可变适用规则集的受控链路。C19 补齐 RA-S3/S4，使后续评估只能消费有证据、无未决冲突且经人工批准的精确规则版本。

## What Changes

- 增加 `knowledge-authoring` 领域定义：只读取 C15 确定性收口后的合格规范资料段与 C18 已发布指标体系，输出类型化规则增量；确定性模块逐项记录接受、拒绝及原因，Agent 不获得审核或发布能力。
- 增加结构化评分规则内容契约与校验：复用 C01 三维适用性元数据、C02 `structured-scoring-rule` 定义类型和既有 `StructuredScoringRuleV1` 公共结构，校验指标、阈值、分级区间、例外条款与证据定位。
- 增加规则冲突与重叠检测及 C07 `rule-conflict` 人工审阅衔接；任何未决冲突、来源不合格或版本不兼容规则均不得进入适用规则集。
- 增加适用规则集组装与评估依据解析：以精确适用性元数据快照、C18 评估配置发布集合和已发布规则为输入，保留每条规则的纳入或筛除原因，并通过 C16 生命周期形成经人工批准的不可变 `applicable-rule-set` 发布；另由 C19 提供精确评估依据发布集合成员的有界读取，不暴露配置正文或私有表。
- 增加原子持久化、幂等、授权、审计和验收证据，至少让一条真实且来源合格的规范资料段走通 RA-S3/S4，同时证明冲突和不适用规则全部被拦截。

## Capabilities

### New Capabilities

- `knowledge/structured-scoring-rules-and-applicable-rule-sets`: 规范条文知识编制、结构化评分规则校验、冲突/重叠审阅、三维适用性筛选、适用规则集发布与评估依据解析。

### Modified Capabilities

无。C19 复用 C08、C16、C18 已发布契约及其扩展点，不改变其既有需求。

## Impact

- 受影响代码：`packages/core` 的评分规则领域模块，`packages/adapters` 的 PostgreSQL 治理扩展、规则查询与迁移，`apps/worker` 的 C19 `knowledge-authoring` 定义和组合入口，以及对应测试与包导出。
- 接口：复用 `KnowledgeModelingPortV1`、`ReviewAuditPortV1`、`AgentTaskPortV1`、`StructuredScoringRuleV1`、`ApplicabilityMetadataSnapshotV1` 和既有定义类型/枚举，并从 C19 core 子路径导出狭窄的评估依据成员 reader；不修改 `packages/contracts` 或 C02 公共端口。
- 审核语义：Agent 候选正文中的 `reviewStatus` 固定保留为 `pending`；已发布准入只认 C16 精确发布及其 C07 人工决定，不在发布时改写不可变正文，也不复制第二套审核状态。
- 依赖：直接依赖 C08、C16、C18 已归档能力，并以 C15 已完成的数据清洗结果作为规范条文输入；不新增第三方依赖，不修改根 workspace、锁文件或中央迁移注册。
- 所有权：本 change 拥有 `knowledge/rules`；不实现 C17 识别知识、C18 配置治理、C25 评估输入准备或后续 P/C、矩阵和预警计算。
