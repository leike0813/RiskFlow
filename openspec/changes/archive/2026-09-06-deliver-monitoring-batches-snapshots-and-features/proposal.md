## Why

RiskFlow 已能登记工程上下文、资料版本和资料段，但 C02 预留的监测序列、批次和快照引用仍无事实所有者，识别与评估无法冻结可重放的监测输入。C14 需要落实 RI-S21 与 RA-S1 的确定性监测预处理基线，使更正、迟到数据和后续新增样本不会改写既有运行依据。

## What Changes

- 在工程数据层新增监测序列及不可变修订、监测批次、原始/更正/补录关系、规范化样本、监测快照、特征结果和确定性可用性事实。
- 实现既有 `EngineeringDataPortV1` 的 `register-monitoring-batch`、`monitoring-snapshot` 冻结和 `monitoring-snapshot` 查询分支；保持 C02 命令、结果、路由与引用 Schema 不变。
- 以 strict Schema 解析 C04 样本工件，显式校验序列、工程/空间、单位、时间窗、来源证据和批次关系；完全重复交付幂等返回原批次，不覆盖旧样本。
- 按冻结策略执行单位换算、时间对齐及短期斜率、加速度、频域主峰、异常评分计算；快照固定截止点、系统记录时点、实际样本版本、策略版本、特征和可用性原因。
- 复用 C03 事务/幂等/Outbox、C04 内容工件、C06 服务端授权、C07 审计和 C11 工程/空间事实；新增 PostgreSQL 只追加持久化与地表沉降数值交叉验证。
- 不实现 C12/C13 文件解析、C15 数据清洗 Agent 与业务可用判断、C18 指标/阈值治理、C25 P/C 评分、预警、处置反馈或界面；不新增第三方依赖。

## Capabilities

### New Capabilities

- `domain/monitoring-batches-snapshots-features`: 规定监测序列、批次关系、样本规范化、不可变快照、确定性时序特征、可用性、权限、幂等与审计行为。

### Modified Capabilities

无。C14 实现既有 `domain/contract-kernel`、`domain/module-interfaces-events-workflows`、`domain/engineering-context-source-registry` 与平台契约，不改变其 requirements。

## Impact

- **直接依赖**：C11；同时复用已归档 C01～C07 的共享 Schema、端口、事务、工件、授权与审计能力。
- **代码所有权**：新增 `packages/core/src/engineering-data/monitoring/`、`packages/adapters/src/engineering-data/monitoring/`、对应测试与 C14 PostgreSQL migration；C11 PostgreSQL composition、共享 fixture 及其测试仅增加三个既有监测分支的注入与委派，PostgreSQL foundation 测试只登记 `000011`，并补充两个 package 的子路径/根导出。
- **接口与事件**：不修改 `packages/contracts/**` 或 `apps/**`；监测实现通过组合既有 C11 adapter 补齐三个既有公共分支，普通批次登记不发布重评估事件，后续形成新快照并能比较前后快照时才由所属流程使用既有 `engineering.assessment-input-changed.v1`。
- **后续消费者**：C15 消费快照与特征执行清洗 Agent 和业务可用判断；C18 引用单位/特征字段建立指标映射；C25/C28 只按精确 `MonitoringSnapshotRefV1` 读取冻结输入。
- **依赖治理**：使用 Node.js 标准能力实现有界频域计算，不修改 manifest、依赖政策或 lockfile；只有目标规模基准证明有界实现不足时才另开依赖 change。
