## Why

C16 已提供受治理定义的不可变修订、人工发布与回滚，C14 已冻结监测序列、单位和特征，但评估侧仍没有可执行的指标映射、权重、矩阵、阈值、措施与预测/偏差策略内容契约。C18 把甲方提供或审核的评估配置收口为严格、可重放的版本化配置，使后续确定性评估、预警、处置和校准不再猜测字段、边界或公式。

## What Changes

- 定义 11 类评估配置包：指标体系、指标字段映射、权重集、受控聚合策略、风险矩阵、风险可接受阈值、监测预警阈值、联合触发规则、措施库、预测策略和偏差策略；全部使用 strict Schema、精确工程修订与兼容集合引用。
- 为资料字段和 C14 监测快照的原值、斜率、加速度、频域主峰、异常评分建立显式映射；单位和转换必须由发布配置声明，评分时不得临时猜测。
- 用闭合聚合策略、十进制字符串边界和穷尽矩阵单元实现确定性校验；拒绝任意公式字符串、表达式树、脚本和不完整或重叠的边界。
- 严格分离风险可接受阈值与监测预警阈值，并以扁平、闭合的 `all-of | any-of | at-least` 联合规则组合已发布监测阈值，不提供递归 DSL。
- 复用 C16 五个治理命令完成内容校验后的导入、送审、发布、停用和历史版本重新发布；Agent 不得发布或回滚，发布/回滚与审计、Outbox 事件保持原子。
- 物化可按业务时间与记录时间重放的评估配置发布集合，固定 11 类精确发布、修订、内容工件和摘要；缺失、停用、跨工程或兼容性冲突时整体失败，不选择“最新版”或部分集合。
- 使用现有 Node.js、Zod、Kysely、PostgreSQL 与内容寻址工件能力；不新增依赖。

### Non-goals

- 不修改 `packages/contracts/**` 的公共 Schema、端口、事件、工作流、枚举或记录字段。
- 不实现 C19 的结构化评分规则、规则冲突/重叠检测与适用规则集，也不实现 C25 的指标取值、P/C 计算、矩阵映射和预警判定。
- 不实现 C27 的处置建议 Agent、C28 的预测/反馈/偏差记录、C29 的校准建议 Agent，亦不实现 API 专用路由、Worker、Web 页面或查询投影。
- 不提供公式 DSL、脚本执行、自由 JSONPath/JSON Patch、可变当前配置、生产 seed、Mock adapter 或未审核默认配置。

## Capabilities

### New Capabilities

- `knowledge/assessment-configuration-and-measure-governance`: 规定评估指标与字段映射、权重和受控聚合、风险矩阵、两类阈值、联合规则、措施库及预测/偏差策略的严格内容、治理接入和精确发布集合行为。

### Modified Capabilities

无。C18 复用 `knowledge/governed-definition-lifecycle` 与 `domain/monitoring-batches-snapshots-features` 的既有 requirements，不改变其公共行为。

## Impact

- **直接依赖**：已归档 C16 `knowledge/governed-definition-lifecycle` 与 C14 `domain/monitoring-batches-snapshots-features`；同时复用 C01/C02 公共枚举与端口、C03 原子事务/Outbox、C04 内容工件、C06 授权和 C07 审计/复核。
- **四层归属与追踪**：本 change 属于知识建模层并拥有 `assessment-config`；覆盖 RA-S2、RA-S5～RA-S7 的配置依据，保留 C14 监测字段与 C16 发布事实的精确引用，不拥有评估、预警、处置或偏差业务记录。
- **计划代码范围**：新增 `packages/core/src/assessment-config/**`、`packages/core/test/assessment-config/**`、`packages/adapters/src/assessment-config/**`、`packages/adapters/test/assessment-config/**` 与 `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts`；最小修改 C16 PostgreSQL adapter 及其测试以接入 C18 内容策略，并追加两个 package 的 `assessment-config` 子路径导出。
- **下游消费者**：C19 在此配置集合上加入适用规则集，C25 消费确定性评分依据，C27 消费措施库，C28 消费预测/偏差策略，C29 只据偏差策略形成候选校准草稿，C32 提供治理界面。
- **禁止修改**：`packages/contracts/**`、`apps/**`、根 workspace/manifest、`pnpm-lock.yaml`、依赖政策、`openspec/config.yaml`、中央迁移注册/测试清单、既有 migration、主 specs、归档 change 与其它活动 change。

若实现证明既有 C02 命令/结果无法承载严格内容导入或精确评估配置集合，必须停止并由独立契约演进 change 处理；不得在 C18 内扩张公共契约。
