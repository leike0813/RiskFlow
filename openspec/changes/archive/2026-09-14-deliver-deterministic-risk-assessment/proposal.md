## Why

RiskFlow 已有风险输入、监测快照、评估配置和适用规则集契约，但尚缺少把这些精确版本输入收口为可重放 P/C、风险等级和四类触发事实的确定性评估引擎。C25 必须在 C26～C30 接入预警与评估图之前建立这条无 Agent、失败闭合且可审计的 RA-S1～RA-S6 主链。

## What Changes

- 实现正式风险输入引用，严格保持 `riskRecordId` 与 `externalRiskEventId` 二选一，并把工程修订、空间、适用性、调用方预先冻结的精确监测快照集合和来源证据冻结为不可变评估准备快照。
- 通过 C19 的精确评估依据引用解析 C18 配置与适用规则集；其余后续策略只从运行时注入的正式策略提供者取得已发布版本。任一引用缺失、未发布或不兼容时失败闭合，不生成部分快照，不定义默认策略。
- 以版本化指标映射、结构化评分规则、权重和评分策略确定性地产生指标实际取值与 P/C，再复用 C18 风险矩阵映射得到风险等级；缺值、不可转换单位、规则冲突或覆盖不完整均不得产生部分分值或等级。
- 分别判定风险可接受阈值、监测预警阈值、联合触发和异常检测四类触发，并把精确输入、逐指标依据、配置版本、触发事实、证据和审计写入不可变风险评估记录。
- 支持初评、重评和历史补算的幂等准备与评估；相同冻结输入精确重放为同一结果，版本变化只新增快照和记录。
- 以正式 `RiskInputRef` 和验收 fixture 跑通“标准化风险记录 → P/C → 矩阵 → 触发事实/预警事件交接”，fixture 仅存在于测试，不新增生产 seed 接口、内存事实源或临时算法。
- 消费前置契约演进 `evolve-assessment-preparation-entry-fields`：评估准备命令显式携带入口模式、触发原因、可选前次记录/因果运行及可选非空监测快照引用集合，输入变化事件同步以复数引用表达监测集合增删；C25 原样冻结，不从其它字段推导、按 latest 选序列或补默认值。

## Capabilities

### New Capabilities

- `risk-assessment/engine`: 覆盖风险输入与评估快照、指标实际取值、P/C 计算、矩阵映射、四类触发判定、不可变记录、重放及审计语义。

### Modified Capabilities

无。

## Impact

- 依赖 C01/C02 公共契约及前置 change `evolve-assessment-preparation-entry-fields`、C03 原子事务/Outbox、C06 授权、C07 审计、C11 工程与适用性事实及前置 `implement-external-risk-event-registration`、C14 监测快照及前置 `implement-monitoring-series-reader`、C18 评估配置以及 C19 评估依据解析；C19 实现接入前以检查点 `6ea078c675572b98dc75c3c0681a4b01b728f492` 的五工件和协调裁决后的 reader/helper 为接口门禁。
- 生产影响限于新增 `packages/core` 与 `packages/adapters` 的 `risk-assessment/engine` 子路径、C11 `EngineeringDataPortV1.freeze(assessment-preparation)` 的正式装配，以及预留序号 `000032` 起的 C25 自有 PostgreSQL 迁移；API 继续使用既有通用风险评估路由，Worker 图组合留给 C30，Web 留给 C34。
- 不修改 `packages/contracts`、根 workspace、锁文件、OpenSpec 配置、中央迁移注册或测试清单，不改 C14/C18/C19 生产代码，不引入第三方依赖。
- C25 只消费后续策略提供者返回的精确引用；这些策略仍分别归 C26/C27/C28/C29 和部署策略所有者，C25 不取得其治理所有权，且确定性计算链中不创建或调用 Agent。
