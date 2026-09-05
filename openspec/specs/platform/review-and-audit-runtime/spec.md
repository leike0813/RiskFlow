# platform/review-and-audit-runtime Specification

## Purpose

为 RiskFlow 提供版本化、可审计且受工程授权边界约束的人工复核任务、决定提交与活动追溯能力。

## Requirements

### Requirement: 系统必须以冻结复核契约创建显式人工复核任务

系统 MUST 通过 C02 `ReviewAuditPortV1.requestReview` 创建复核任务，并保存复核类型、不可变目标版本、验证快照、证据快照、等待运行、复核策略、工程、发起主体、授权上下文和三类时间的引用。系统 MUST 只保存跨模块引用，不得复制上游候选、规则、证据或模型正文。

#### Scenario: 创建等待人工复核的任务

- **WHEN** 已获 `review-audit.request-review` 授权的工程风险负责人提交结构有效的复核请求
- **THEN** 系统创建状态为 `pending` 的 `ReviewTaskRefV1`
- **AND** 任务完整关联目标及版本、验证/证据快照、等待运行和复核策略
- **AND** 业务事实、C03 审计、命令回执和 `review.review-requested.v1` 在同一事务提交

#### Scenario: 同一请求重放

- **WHEN** 调用者以相同工程、命令类型、幂等键和相同载荷重放请求
- **THEN** 系统返回原 `ReviewTaskRefV1`
- **AND** 不重复创建任务、审计记录或 Outbox 事件

#### Scenario: 同一幂等键载荷变化

- **WHEN** 调用者复用已完成请求的幂等键但改变任一受保护载荷
- **THEN** 系统返回 `IDEMPOTENCY_CONFLICT`
- **AND** 不创建或修改复核事实

### Requirement: 系统必须维护可验证的复核任务状态

系统 MUST 维护 `pending`、`decided`、`superseded` 三种任务状态。相同等待运行、复核类型和稳定目标实体的新目标版本送审时，系统 MUST 将旧 `pending` 任务标记为 `superseded`；已决定任务 MUST 保持不可变。

#### Scenario: 新版本替代待处理任务

- **WHEN** 同一等待运行和稳定目标实体已有 `pending` 任务，且调用者送审新的目标版本
- **THEN** 系统创建引用新版本的任务
- **AND** 旧任务转换为 `superseded`
- **AND** 旧任务的目标、输入快照和历史审计保持可追溯

#### Scenario: 已决定任务不被新版本覆盖

- **WHEN** 同一稳定目标实体的新版本进入复核
- **THEN** 系统不得更新或删除此前已决定任务及决定

### Requirement: 系统必须原子领取并提交类型化人工决定

系统 MUST 通过 C02 `ReviewAuditPortV1.decideReview` 接受与复核类型匹配的 `ReviewDecisionV1`。领取 MUST 在决定事务内通过工程内行锁和完整任务版本引用原子完成；系统不得要求独立领取端口、租约或心跳。

#### Scenario: 首个有效决定胜出

- **WHEN** 获授权复核者对 `pending` 任务提交类型、目标和版本均匹配的决定
- **THEN** 系统原子创建唯一 `ReviewDecisionRefV1` 并把任务转换为 `decided`
- **AND** 决定保存原因码、主体、授权上下文、输入输出引用与三类时间
- **AND** 业务事实、C03 审计、命令回执和 `review.review-resolved.v1` 在同一事务提交

#### Scenario: 两名复核者并发决定同一任务

- **WHEN** 两个不同命令并发决定同一 `pending` 任务
- **THEN** 恰有一个命令提交决定
- **AND** 另一命令返回 C02 `STALE_VERSION` 且不得覆盖首个决定
- **AND** 被拒绝命令产生一条幂等的 C07 业务拒绝审计

#### Scenario: 相同决定命令重放

- **WHEN** 已成功的决定以相同幂等键和相同载荷重放
- **THEN** 系统返回原 `ReviewDecisionRefV1`
- **AND** 不重复决定、审计或领域事件

### Requirement: 系统必须拒绝过期、错配和越界决定

系统 MUST 在写入前确定性校验任务状态、工程、任务版本、目标实体与版本、复核类型、决定联合类型和必需输出引用。任一校验失败 MUST 保持任务与目标事实不变，人工选择不得绕过确定性失败。

#### Scenario: 对已替代版本提交决定

- **WHEN** 复核者对 `superseded` 任务或非当前任务版本提交决定
- **THEN** 系统返回 C02 `STALE_VERSION`
- **AND** 不创建决定或恢复运行事件
- **AND** 追溯中可见最小拒绝原因和原命令/任务引用

#### Scenario: 决定类型与任务类型不匹配

- **WHEN** 命令的决定联合类型、目标类型或任务复核类型不一致
- **THEN** 系统返回结构化校验失败
- **AND** 不创建或修改任何业务事实

#### Scenario: 人工尝试绕过处置或校准边界

- **WHEN** 处置复核试图批准未通过上游三项校验的候选，或校准复核试图直接改写生效配置
- **THEN** C02 Schema 与 C07 确定性校验拒绝该决定
- **AND** 系统不发布建议、不改写规则、权重、阈值或矩阵

### Requirement: 系统必须在每次操作前验证工程授权边界

系统 MUST 在查询资源存在性或写入业务事实之前，通过 C06 `LocalIdentityAccessV1.verify` 校验调用者、工程、精确分支和授权上下文当前有效性。C07 核心和适配器 MUST NOT 直接读取 C06 身份、会话、成员、角色或策略内部表。

#### Scenario: reviewer 提交决定并查询追溯

- **WHEN** reviewer 持有当前工程且分别绑定 `review-audit.decide-review` 或 `review-audit.trace` 的有效授权上下文
- **THEN** 系统允许其执行对应分支
- **AND** 不因一个分支获准而放宽另一个分支

#### Scenario: reviewer 尝试发起复核

- **WHEN** reviewer 尝试使用 `review-audit.request-review`
- **THEN** 系统按 C06 能力矩阵拒绝
- **AND** 不创建任务、命令回执或复核事件

#### Scenario: 授权无效且目标存在

- **WHEN** 授权上下文已过期、被撤销、工程不匹配、分支不匹配或角色无权
- **THEN** 系统返回与目标不存在不可区分的安全拒绝类别
- **AND** 在授权前不读取或泄露目标、任务或决定存在性
- **AND** C06 安全审计记录结构化拒绝

### Requirement: 成功复核写入必须与审计及事件原子提交

系统 MUST 复用 C03 `TransactionUnitV1`，将任务/决定事实、命令回执、`audit.entries` 和相应 Outbox 事件作为一个 PostgreSQL 事务提交。检查点、日志或内存状态 MUST NOT 替代业务入库或审计。

#### Scenario: 审计写入失败

- **WHEN** 任务或决定事实可写但 C03 审计写入失败
- **THEN** 系统回滚事实、命令回执和 Outbox
- **AND** 不返回业务成功

#### Scenario: Outbox 写入失败

- **WHEN** 任务或决定事实与审计可写但 Outbox 写入失败
- **THEN** 系统回滚整个命令事务
- **AND** 重试仍受原幂等键保护

### Requirement: 系统必须提供责任可归属的只追加审计链

系统 MUST 以 C06 已认证主体和授权上下文、C03 命令与幂等标识、不可变业务/运行/版本/输入输出引用、三类时间及数据库只追加权限形成业务不可抵赖追溯。系统 MUST NOT 把无外部可信锚的自制散列宣称为数字签名或法律不可抵赖。

#### Scenario: 追溯一次人工决定

- **WHEN** 获授权调用者按复核任务、目标、决定或运行引用查询
- **THEN** 结果可关联发起任务、目标版本、验证/证据快照、复核策略、人工决定、等待/恢复运行、主体、授权上下文、命令和三类时间
- **AND** 每个引用仍指向创建决定时使用的不可变版本

#### Scenario: 应用角色试图改写审计

- **WHEN** `riskflow_app` 尝试更新或删除 C03 业务审计、C06 安全审计或 C07 复核拒绝审计
- **THEN** PostgreSQL 拒绝操作
- **AND** 原审计记录保持不变

### Requirement: 系统必须统一查询业务、安全与复核拒绝活动

系统 MUST 提供工程有界、主题有界且支持 `asOfRecordedAt` 的只读活动投影，统一 C03 业务审计、C06 安全审计和 C07 复核拒绝。投影 MUST 以闭合活动码和类型化参数保存事实，中文文案仅由展示映射生成。

#### Scenario: 按主题和时间追溯

- **WHEN** 获授权调用者以 `subjectRef` 和 `asOfRecordedAt` 查询
- **THEN** 系统只返回当前工程中记录时间不晚于边界且与主题关联的活动
- **AND** 返回 `AuditTrailRefV1` 或 `QueryResultRefV1`
- **AND** 查询不扫描或泄露其他工程活动

#### Scenario: 请求证据摘要

- **WHEN** 查询设置 `includeEvidenceSummary=true`
- **THEN** 投影最多包含证据快照引用及类型/计数摘要
- **AND** 不读取、复制或展示证据正文

#### Scenario: 生成中文活动项

- **WHEN** 投影包含已知闭合活动码
- **THEN** 系统用代码与安全参数生成对应中文活动语义
- **AND** 原始活动码、结果、原因和引用仍为查询事实源
- **AND** 数据库错误、凭据、token、连接串或任意业务正文不得进入活动文案

### Requirement: 多项复核决定必须逐项隔离

系统 MUST 将批量复核解释为多个标准 `decideReview` 命令。每项 MUST 独立授权、幂等、事务提交、返回结果和审计；系统 MUST NOT 创建跨任务大事务或未冻结的批量端口。

#### Scenario: 批量中一项过期

- **WHEN** 调用方提交多个决定命令且其中一项任务已过期
- **THEN** 过期项返回自己的 C02 `STALE_VERSION`
- **AND** 其他有效项可独立提交
- **AND** 每项拥有独立命令、结果和审计引用

### Requirement: 人工复核运行时不得越界承担 Agent 或交付界面职责

系统 MUST 将语义决定限制在五类 C02 人工决定中，并把 Schema、状态、版本、权限和持久化校验留在确定性模块。C07 MUST NOT 实现通用 Agent 任务状态、模型调用、工具执行、HTTP 路由或 UI。

#### Scenario: 复核任务来源于 Agent 候选

- **WHEN** 上游把 Agent 或 LLM 产生的候选送入复核
- **THEN** C07 只接收候选、验证、证据和运行的版本化引用
- **AND** 不读取模型思维链、不重跑模型，也不执行候选建议

#### Scenario: 确定性校验失败

- **WHEN** 字段、引用、状态、权限或版本校验失败
- **THEN** 系统拒绝或保持任务等待人工/上游修正
- **AND** 不以人工决定、默认值、基线结果或 Agent 可用性静默跳过失败

### Requirement: 系统必须提供知识修订人工批准证明只读接缝

系统 MUST 由 C07 通过公共复核审计端口接收工程、精确 `KnowledgeRevisionRefV1`、`ReviewDecisionRefV1` 和 C06 授权上下文，并以闭合结果证明该决定是否可作为该修订的人工批准依据。只有同一工程中状态为 `decided` 的 `knowledge-revision` 复核任务，其精确目标等于所查询修订、任务保存的精确决定引用匹配且决定类型为 `approve-publication` 时，系统 MUST 返回已批准证明；决定不存在、目标不匹配或决定不是批准时，系统 MUST 返回对应未批准原因。证明只包含精确修订、复核任务、复核决定和决定时间，不得返回决定正文、原因正文、证据正文或数据库行；任务与决定事实违反既有状态约束时 MUST 作为技术完整性失败关闭，不得生成批准证明。（RI-S44；RA-S3、RA-S4、RA-S7）

#### Scenario: 精确知识修订获得批准证明

- **WHEN** 获授权调用方提交同一工程中指向精确知识修订的 `approve-publication` 决定引用，且关联复核任务保持有效决定状态
- **THEN** 系统返回闭合的已批准结果及精确修订、复核任务、复核决定和决定时间
- **AND** 调用方无需读取 C07 表、追溯投影或解析活动文案即可执行自己的确定性发布校验

#### Scenario: 拒绝或退回决定不能形成批准证明

- **WHEN** 所查询决定为 `reject` 或 `return-for-revision`
- **THEN** 系统返回 `decision-not-approval` 未批准原因
- **AND** 不把决定存在、复核已完成或人工参与等同于批准发布

#### Scenario: 错目标决定不能形成批准证明

- **WHEN** 决定指向另一知识修订
- **THEN** 系统返回 `target-mismatch` 未批准原因
- **AND** 不把决定转移到调用方提交的修订版本

#### Scenario: 任务决定事实不一致时失败关闭

- **WHEN** 决定关联的任务并非 `decided`，或任务保存的决定引用与查询决定不一致
- **THEN** 系统返回技术完整性失败且不生成批准证明
- **AND** 不增加正常状态机无法产生的未批准原因

#### Scenario: 决定不存在时稳定阻断

- **WHEN** 当前工程内不存在所查询的精确决定引用
- **THEN** 系统返回 `decision-not-found` 未批准原因
- **AND** 下游可以稳定阻断发布而无需匹配错误文案

### Requirement: 批准证明查询必须遵守工程授权与只读边界

批准证明查询 MUST 使用映射到 `review-audit.read` 的专用复核审计查询分支，并在读取任务、决定或目标存在性之前通过 C06 校验调用者、工程和版本化授权上下文。查询 MUST 先以工程和精确决定引用约束 C07 自有事实；其它工程中存在的同名引用与完全不存在 MUST 对调用方不可区分。查询 MUST NOT 创建或修改复核任务、决定、拒绝审计、业务审计、命令回执或 Outbox 事件；授权拒绝仍由 C06 安全审计负责。

#### Scenario: 获授权下游读取批准证明

- **WHEN** 调用方持有当前工程和专用批准证明查询分支的有效 C06 授权上下文
- **THEN** C07 可以只读验证决定与修订关系并返回闭合证明结果
- **AND** 查询不产生 C07 业务写入或领域事件

#### Scenario: 无权查询不读取决定事实

- **WHEN** 授权上下文过期、被撤销、能力不足、分支不匹配或工程不匹配
- **THEN** 系统在读取任何复核任务或决定前返回 `AUTHORIZATION_DENIED`
- **AND** 响应不泄露决定、任务或修订是否存在

#### Scenario: 跨工程决定不可枚举

- **WHEN** 获授权调用方在当前工程查询只存在于其它工程的精确决定引用
- **THEN** 系统返回与当前工程内决定不存在相同的 `decision-not-found` 结果
- **AND** 查询不通过无工程约束的回退读取辨认该决定的真实归属

#### Scenario: 批准证明查询保持现有复核语义

- **WHEN** 调用方读取批准证明
- **THEN** `requestReview`、`decideReview`、`trace`、复核状态、五类决定和既有事件的行为保持不变
- **AND** 查询不能发布、停用、回滚或修改任何知识治理事实
