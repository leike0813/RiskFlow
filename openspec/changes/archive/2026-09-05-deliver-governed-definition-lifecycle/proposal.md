## Why

C02 已冻结知识建模治理端口，C03/C06/C07 也已提供原子事务、工程授权和人工复核，但受治理定义仍没有稳定身份、不可变修订与可运行的发布生命周期。C16 先建立这一共同底座，避免 C17 风险机理知识与 C18 评估配置各自实现版本、审核、回滚和导入规则，形成第二套事实源。

## What Changes

- 建立知识建模层的受治理定义聚合：稳定定义身份与不可变修订分离，修订保存定义类型、内容工件引用、来源/证据引用、适用工程、父修订和审计关联；已提交修订不原地修改。
- 落实 `submit-revision → request-review → publish-approved-release` 生命周期。发布是引用一组已批准精确修订的不可变集合；复核拒绝、退回修改和陈旧决定均不能产生发布。
- 支持发布集合停用，以及通过引用历史发布集合创建新的发布决定来重新启用历史内容；停用和“回滚”均保留历史，不移动别名、不覆盖旧发布。
- 提供面向运行方的精确版本解析：只能按发布引用或由治理模块返回的精确修订集合运行；缺失、停用、未批准、类型不兼容或跨工程引用结构化失败，不自动切换到最新版。
- 提供严格配置包导入：包清单显式列出定义类型、稳定身份、修订内容工件、来源/证据与预期摘要；同包重放幂等，身份或内容冲突整体拒绝，不做模糊匹配或部分导入。甲方已审核包仍按原内容进入同一事实模型，但不会绕过发布权限与审计。
- 用真实 PostgreSQL 验证不可变性、并发发布、幂等导入、授权、复核、审计与事务事件；不新增依赖。

### Non-goals

- 不定义 C17 的工序模型、风险机理、规范/案例库内容 Schema、完整性校验或知识编制 Agent；不定义 C18 的指标、字段映射、权重、矩阵、阈值、联合规则、措施与策略内容。
- 不实现 C19 结构化评分规则与适用规则集，不实现检索索引、评估计算、预警、处置、校准、HTTP/UI 或 LangGraph 图。
- 不修改 C01/C02 公共契约、C06 能力矩阵或 C07 复核决定集合；不提供“当前版本”可变引用、发布别名、通用 JSON Patch、任意配置 DSL 或 Agent 发布入口。

## Capabilities

### New Capabilities

- `knowledge/governed-definition-lifecycle`: 规定受治理定义的稳定身份、不可变修订、送审与发布集合、停用、历史版本重新启用、精确运行解析及严格配置包导入行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：当前基线为已归档 C03 `platform/postgresql-outbox-checkpoint-foundation`、C06 `platform/local-identity-project-authorization`、C07 `platform/review-and-audit-runtime`，并复用 C01/C02 已归档契约；发布/回滚实现前还须由独立的 review-audit 契约演进 change 提供批准证明只读接缝，C16 不修改这些主 specs。
- **四层归属与事实所有权**：本 change 属于知识建模层并拥有 `knowledge/governance`。它拥有定义身份、修订、发布集合、导入收据与精确解析结果；定义正文继续位于 C04 内容寻址工件，复核决定由 C07 拥有。
- **RI/RA 追踪**：为 RI-S44 的来源、审核状态、更新日志和版本化管理，以及 RA-S2～RA-S4、RA-S7 的不可变配置版本、审核发布、差异追溯与回滚提供共同生命周期；具体业务内容和校验由 C17/C18/C19/C29 补齐。
- **下游消费者**：C17、C18、C19、C20、C24～C25、C27、C29～C32 只通过精确发布/修订引用消费治理结果，不直接读治理表或选择“最新版”。
- **计划代码范围**：新增 `packages/core/src/knowledge-governance/**`、`packages/adapters/src/knowledge-governance/**`、`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts` 及对应 core/PostgreSQL 测试；对现有 package exports 做最小追加。删除文件为零，无依赖门。
- **禁止修改**：`packages/contracts/**`、C03/C06/C07 既有实现与迁移、`apps/**`、根工具链与锁文件、`openspec/config.yaml`、`openspec/specs/**` 及其它 change/归档工件。

若批准证明只读接缝尚未归档，或实现发现 C02 没有足够的治理分支/引用、具体定义类型无法通过不透明内容工件与校验策略引用接入，必须停止并由主调度 Agent 完成前置契约演进或重新规划；不得在 C16 内读取 C07 内部表、扩张共享契约或提前吞并 C17/C18。
