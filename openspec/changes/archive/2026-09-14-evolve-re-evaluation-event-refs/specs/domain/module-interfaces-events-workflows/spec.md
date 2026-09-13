## MODIFIED Requirements

### Requirement: 评估准备入口显式冻结入口语义与多序列监测引用

系统 MUST 让 `assessment-preparation` 命令显式携带 `entryMode` 与 `triggerReasonCode`，并可携带 `previousAssessmentRecordRef` 与 `causalRunRef`；调用方不得从风险输入种类或其它上下文推导入口模式和触发原因，也不得依靠默认值补全。命令和 A0 `AssessmentPreparationSnapshotV1` MUST 使用同名、同形状的可选 `monitoringSnapshotRefs`：未提供表示本次评估不使用监测输入，提供时必须是至少含一个 `MonitoringSnapshotRefV1` 的集合，并引用调用方预先按监测序列冻结且当前授权允许使用的精确快照。每个 C14 监测快照仍只属于一个监测序列，评估准备只聚合引用，不复制监测正文或改变 C14/C18 事实。

`engineering.assessment-input-changed.v1` 的 monitoring-snapshot 变化 MUST 通过可选的 `previousMonitoringSnapshotRefs` 与 `newMonitoringSnapshotRefs` 精确引用数组表达；字段存在时 MUST 至少包含一个引用，且两字段 MUST 至少存在一个。只提供新数组表示纯新增，只提供前数组表示纯删除，同时提供两个非空数组表示替换或多序列变化；两侧均缺或任一显式空数组 MUST 被拒绝。事件 MUST 只携带前后监测快照引用和既有原因码，不得包含监测正文，也不得成为平行于 C14 监测快照的第二套变更事实。（RA-S1、RA-S5～RA-S7）

#### Scenario: 调用方显式提交评估入口语义

- **WHEN** 调用方提交合法风险输入、入口模式、触发原因以及按需提供的前次评估和因果运行精确引用
- **THEN** `assessment-preparation` 命令接受这些显式字段，A0 准备快照原样保留相应语义和引用
- **AND** 系统不从风险输入种类或运行上下文推导或默认入口模式与触发原因

#### Scenario: 缺少必填入口字段时拒绝

- **WHEN** `assessment-preparation` 命令缺少 `entryMode` 或 `triggerReasonCode`
- **THEN** strict 公共契约拒绝该命令
- **AND** 不创建入口语义不完整的 A0 准备快照

#### Scenario: 不使用监测输入

- **WHEN** 本次评估不需要任何监测输入且调用方不提供 `monitoringSnapshotRefs`
- **THEN** 命令与 A0 准备快照均可省略该字段
- **AND** 系统不根据截止点、风险输入或其它上下文自动选择监测快照

#### Scenario: 聚合多个已冻结监测序列

- **WHEN** C18 字段映射、监测阈值或联合规则需要多个监测序列，且调用方已逐序列冻结获准使用的精确监测快照
- **THEN** 调用方以非空 `monitoringSnapshotRefs` 提交全部所需引用，A0 准备快照保留该引用集合
- **AND** 每个被引用的 C14 快照仍固定单个 `monitoringSeriesRef`，评估准备不复制其监测正文

#### Scenario: 拒绝空监测引用集合和旧输入形状

- **WHEN** 命令或 A0 准备快照显式提供空的 `monitoringSnapshotRefs`，或使用旧 `monitoringCutoff`、`monitoringSnapshotRef` 字段
- **THEN** strict 公共契约拒绝该输入
- **AND** 不把空集合解释为自动选取快照或无监测输入

#### Scenario: 事件表达监测序列新增和删除

- **WHEN** 一次评估输入变化只新增或只删除一个或多个监测快照引用
- **THEN** 纯新增只提供非空 `newMonitoringSnapshotRefs`，纯删除只提供非空 `previousMonitoringSnapshotRefs`，并分别省略空侧字段
- **AND** 消费方把缺失侧解释为空集合

#### Scenario: 事件表达替换

- **WHEN** 一次评估输入变化同时具有前后监测快照引用
- **THEN** monitoring-snapshot 分支同时提供两个非空精确引用数组
- **AND** 消费方从两侧引用判断替换或多序列变化，不读取监测正文或第二套变更事实

#### Scenario: 事件拒绝无变化载荷

- **WHEN** monitoring-snapshot 分支同时缺少前后引用数组，或显式提供任一空数组
- **THEN** strict 事件契约拒绝该载荷
- **AND** 系统不发布或消费无法表达实际新增、删除或替换的事件

#### Scenario: 事件拒绝旧单数载荷和监测正文

- **WHEN** monitoring-snapshot 事件分支提交旧单数快照字段、监测样本、特征或其它未声明内容
- **THEN** strict 事件契约拒绝该载荷
- **AND** 不把契约外内容透传给重评估消费方
