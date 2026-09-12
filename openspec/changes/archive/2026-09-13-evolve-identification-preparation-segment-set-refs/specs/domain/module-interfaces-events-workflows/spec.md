## MODIFIED Requirements

### Requirement: 识别工作流具有 I0 至 I9 的版本化阶段契约

系统 MUST 以 `I0`～`I9` 闭合阶段表示一次有限识别运行：I0 资料准备与输入冻结，I1 知识就绪，I2 工序工作项规划，I3 混合/关系检索与必经 Agent 审阅，I4 五项上下文组装与 RI-S57 专用 LLM 推理，I5 有界结构修复与确定性校验，I6 全运行重复检测与多来源合并，I7 综合置信度与验收路由，I8 业务入库与评估事件，I9 结果汇总。

每阶段 DTO MUST 只携带精确快照、工作项、候选集、Agent 任务、合并计划、复核任务、业务结果、路由、错误或汇总引用。I0 的 `IdentificationPreparationSnapshotV1` MUST 以非空 `sourceVersionRefs` 和非空 `includedSourceSegmentSetRefs` 冻结资料输入；两个数组 MUST 等长并按相同索引一一对应，每个资料段集合引用 MUST 属于配对的精确资料版本。一次识别运行 MUST 以单个 `IdentificationInputSnapshotV1.preparationSnapshotRef` 引用该聚合准备快照，不得拆成每个资料版本一个准备快照。I0～I9 MUST 完整追踪 RI-S1～RI-S6；任一技术错误不得伪装成业务复核。（RI-S1～RI-S6）

#### Scenario: 识别正常完成

- **WHEN** 冻结输入与知识版本兼容，全部必经 Agent/LLM 和确定性校验完成，且所有合并组均达到终态
- **THEN** 运行依次形成 I0～I9 的阶段结果引用并返回识别汇总
- **AND** 每个已验收合并组只产生一个标准化风险记录版本及评估事件

#### Scenario: 多资料版本形成单个可重放准备快照

- **WHEN** I0 为多个精确资料版本冻结输入，且每个版本都有一个属于该版本的不可变资料段集合引用
- **THEN** `IdentificationPreparationSnapshotV1` 按相同索引保存等长的 `sourceVersionRefs` 与 `includedSourceSegmentSetRefs`
- **AND** I1 仍通过单个 `preparationSnapshotRef` 冻结整组准备结果

#### Scenario: 拒绝不完整或错配的资料段集合引用

- **WHEN** `includedSourceSegmentSetRefs` 为空、与 `sourceVersionRefs` 数量不同，或任一资料段集合不属于相同索引的精确资料版本
- **THEN** I0 在形成准备快照前返回类型化校验失败
- **AND** 不创建有损准备快照或为各资料版本拆分准备快照

#### Scenario: 知识未就绪时暂停

- **WHEN** I1 发现发布版本缺失、停用或与冻结输入不兼容
- **THEN** 运行保存知识准备任务与复核引用并进入等待
- **AND** 恢复时重新校验精确版本，不自动切换到“最新版”

#### Scenario: 争议合并组不阻塞其它组

- **WHEN** I6/I7 中一个合并组等待复核而其它合并组通过全部约束
- **THEN** I8 可以幂等入库其它合格组
- **AND** 运行在 I9 汇总中明确区分已验收、等待复核、拒绝、跳过和失败

#### Scenario: 必经检索审阅失败不降级

- **WHEN** I3 的检索审阅 Agent 预算耗尽或重试耗尽
- **THEN** 相应工作项进入类型化失败
- **AND** 不以基线检索冒充最终检索继续 I4
