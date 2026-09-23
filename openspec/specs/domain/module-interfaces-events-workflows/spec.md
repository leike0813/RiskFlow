# module-interfaces-events-workflows Specification

## Purpose

为 RiskFlow 六个领域模块及应用模块提供闭合、版本化、可运行时校验的跨模块调用、领域事件和有限工作流契约，使后续实现保持事实所有权、权限、幂等、追溯与暂停恢复语义一致。

## Requirements

### Requirement: 六个领域模块只暴露用例级 interface

系统 MUST 为工程数据、知识建模、风险识别、风险评估、预警处置、复核审计六个领域模块分别提供少量用例级命令或查询分支。每个分支 MUST 是闭合的可辨识联合类型，输入和输出只包含调用所需的身份、精确版本、授权上下文、幂等身份和结果引用；不得暴露通用 `execute`、任意仓储/查询器、SQL、文件、URL、JSON Patch 或自由字段袋。工程数据 MUST 以独立的 `StructuredDocumentConversionPortV1` 暴露结构化文档转换，保持既有 `EngineeringDataPortV1` 的分支与签名不变；该转换端口 MUST 以共享 strict Schema 表达 DOCX、文本型 PDF、XLSX、CSV 与 OCR 版面结果输入，使 C12 和 C13 复用同一结构化块、坐标、资料段与失败诊断契约。

工程数据拥有工程资料、资料段、监测与适用性快照；知识建模拥有工序模型、风险机理、检索证据、评估知识与措施的受治理版本；风险识别拥有候选/合并工件、标准化风险记录和关联事实；风险评估拥有评估快照、指标结果和风险评估记录；预警处置拥有预警、处置、预测、反馈、偏差与校准建议；复核审计拥有复核任务、类型化决定和只追加审计。一个模块不得通过 interface 修改另一个模块拥有的事实。（RI-S1～RI-S6；RA-S1～RA-S7）

#### Scenario: 调用所属模块完成用例
- **WHEN** 调用方提交一个已声明的模块命令或查询分支，并提供合法授权上下文与精确输入引用
- **THEN** interface 返回该分支声明的类型化结果引用或类型化错误
- **AND** 调用方无需了解事务、重试、持久化或第三方协议

#### Scenario: 结构化转换使用独立共享端口
- **WHEN** C12 转换结构化文档或 C13 规范化 OCR 版面结果
- **THEN** 两者调用 `StructuredDocumentConversionPortV1` 并返回相同契约定义的转换、工件、资料段或诊断引用
- **AND** 既有 `EngineeringDataPortV1` 的命令和查询分支保持不变

#### Scenario: 拒绝开放式调用
- **WHEN** 调用方尝试提交未声明的动作、任意对象补丁、存储查询或契约外字段
- **THEN** 运行时 Schema 拒绝该输入
- **AND** 不把未知字段透传给领域实现

#### Scenario: 评估不复制识别事实
- **WHEN** 风险评估模块接收识别产生的风险输入
- **THEN** 输入只引用标准化风险记录的身份与精确版本
- **AND** 不复制或改写风险事件、证据或模型置信度正文

### Requirement: 应用模块只能组合领域 interface

系统 MUST 为 Agent 任务、LangGraph 工作流、查询与交付投影提供独立应用 interface。Agent 任务只管理有界任务与任务产物引用；LangGraph 只管理有限运行、阶段、检查点关联和路由；查询与交付投影只组合已成立事实的只读引用。应用模块 MUST 依赖领域模块公开 interface，领域模块不得反向依赖应用模块、应用、适配器或 LangGraph。

#### Scenario: 工作流通过公开 interface 编排
- **WHEN** 工作流推进识别、评估、预警或处置阶段
- **THEN** 它只提交已声明的领域命令或查询并保存返回引用
- **AND** 不直接读取数据库、Qdrant、文件工件或模块内部结构

#### Scenario: 查询投影不成为事实源
- **WHEN** 查询投影被删除后重建或返回组合视图
- **THEN** 所有业务事实仍由六个领域模块拥有
- **AND** 投影不能反向写回任何领域对象

#### Scenario: Agent 不能越权写事实
- **WHEN** Agent 任务产生任务类型化候选或命令提案
- **THEN** 正式写入仍调用原领域 interface 并重新执行其权限与确定性校验
- **AND** Agent 任务引用不能代替正式业务结果引用

### Requirement: 每次跨模块调用携带冻结授权上下文

每个命令和受保护查询 MUST 携带版本化授权上下文，至少固定发起主体、工程、获准空间范围、资料可见范围、授权策略版本与因果运行引用。接收模块 MUST 在副作用前校验工程作用域和所需能力；下游调用只能保持或收窄授权范围，不能扩大权限。无资料正文权限的调用方可以获得获准的定位与脱敏摘要，但不得通过事件、错误、审计、Agent 或图状态取得正文。

#### Scenario: 获授权调用成功
- **WHEN** 发起主体在目标工程和空间范围内拥有命令所需能力，并可访问输入引用
- **THEN** 模块可以处理该命令并把授权策略版本写入审计关联

#### Scenario: 跨工程调用被拒绝
- **WHEN** 授权上下文的工程与目标实体所属工程不一致
- **THEN** 模块返回不可重试的权限错误
- **AND** 不产生业务事实、领域事件或待通知副作用

#### Scenario: 下游不能扩大证据可见性
- **WHEN** 工作流、Agent 或投影使用比上游更宽的资料范围继续调用
- **THEN** 接收模块拒绝该调用
- **AND** 错误详情不泄露无权资料正文或存在性

### Requirement: 命令、结果和错误具有稳定幂等语义

每个写命令 MUST 携带命令标识和业务幂等键，并使用闭合、类型化的结果联合表达成功、等待、冲突或失败。相同工程、命令类型与幂等键重试同一有效载荷 MUST 返回同一逻辑结果；同键不同载荷 MUST 返回不可重试的幂等冲突。错误 MUST 以稳定代码、类别、可重试性、阶段及精确诊断引用表达，不得要求调用方匹配完整文案，也不得使用开放 `Record<string, unknown>` 详情决定业务路由。

#### Scenario: 重复命令返回原结果
- **WHEN** 调用方以相同作用域、命令类型、幂等键和有效载荷重试已完成命令
- **THEN** 模块返回原业务结果引用
- **AND** 不重复写事实、审计、事务事件或外部意图

#### Scenario: 同键不同载荷冲突
- **WHEN** 调用方复用同一幂等键提交不同的类型化载荷
- **THEN** 模块返回幂等冲突错误
- **AND** 保留原命令与结果不变

#### Scenario: 陈旧版本提交被拒绝
- **WHEN** 命令目标的精确版本已被取代、作废或不再可决定
- **THEN** 模块返回类型化陈旧版本或并发冲突
- **AND** 不把提交静默应用到当前版本

### Requirement: 已入库事实通过事务领域事件衔接

系统 MUST 使用版本化事务领域事件表达已可靠成立的跨阶段事实。事件信封 MUST 固定事件身份、事件类型、契约版本、工程、聚合身份与版本、业务发生时间、系统记录时间、因果/关联运行、生产命令和业务幂等键；事件载荷只包含下游所需的精确事实引用和原因，不复制完整业务记录。业务事实、审计和待发布事件 MUST 原子提交；事件至少一次投递时，消费者 MUST 幂等处理。

事件至少覆盖：资料输入已就绪、标准化风险记录已验收入库、评估输入变化、受治理识别知识基础已发布、受治理评估版本已发布、风险评估记录已入库、预警信息已入库、处置反馈已记录、校准建议已创建、复核已请求和复核已解决。（RI-S14、RI-S53～RI-S56、RI-S62～RI-S65；RA-S4～RA-S7）

#### Scenario: 风险记录事件启动评估候选
- **WHEN** 标准化风险记录通过 RI-S61 完整性检查并与事务事件原子入库
- **THEN** 评估消费者只使用风险记录身份与精确版本创建评估候选
- **AND** 不从事件载荷复制风险事件定义

#### Scenario: 识别知识基础发布事件只携带精确引用
- **WHEN** `retrieval-evidence-base` 经 C16 发布或历史版本重新发布，并形成覆盖 `process-model`、`risk-mechanism`、`standard-library`、`case-library`、`retrieval-evidence-base` 的完整唯一识别知识发布集合
- **THEN** 系统在同一发布事务中产生 `knowledge.identification-basis-published.v1`，以事件信封固定工程、聚合、审计、命令、幂等和版本，并在载荷中固定五类定义及其精确 `KnowledgeReleaseRefV1` 和精确 `RetrievalEvidenceBaseReleaseRefV1`
- **AND** 事件不包含知识正文、证据正文、检索片段、模型响应或契约外自由字段

#### Scenario: 事件发布失败不伪装成功
- **WHEN** 业务事务无法同时保存事实、审计和待发布事件
- **THEN** 整个业务提交失败或回滚
- **AND** 不留下下游不可追踪的孤立事实

#### Scenario: 重复投递不重复产生事实
- **WHEN** 同一事件因至少一次投递语义被重复消费
- **THEN** 消费者以事件身份和业务幂等键返回原处理结果
- **AND** 不重复创建评估、预警、处置任务、索引代际或通知意图

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

### Requirement: 评估工作流具有 A0 至 A9 的版本化阶段契约

系统 MUST 以 `A0`～`A9` 闭合阶段表示一次有限评估运行：A0 输入准备，A1 知识就绪，A2 输入冻结，A3 指标取值，A4 确定性评分与触发判定，A5 评估入库，A6 预警入库与任务归集，A7 处置建议候选，A8 三项约束校验与建议入库，A9 结果汇总。处置效果预测和处置反馈 MUST 作为使用同一图契约的独立有限入口，不跨越数日等待现场动作。

A0～A9 MUST 完整追踪 RA-S1～RA-S7。A3～A6 不创建必经 Agent 任务；P/C、矩阵、四类触发、三项处置约束与业务入库 MUST 由领域模块确定性完成。预警和处置只能在已入库风险评估记录之后推进。（RA-S1～RA-S7）

#### Scenario: 无预警的确定性评估完成
- **WHEN** A3/A4 产生完整 P/C、风险等级和空触发指标集合
- **THEN** A5 原子保存完整风险评估记录并直接进入 A9
- **AND** 不创建预警、处置任务或 Agent 任务

#### Scenario: 预警先入库再通知
- **WHEN** A4 命中一个或多个触发类型
- **THEN** A5 先保存包含触发指标的评估记录，A6 再幂等保存预警与处置任务关联
- **AND** 只有预警可靠入库后才安排通知意图

#### Scenario: 处置候选不能越过三项校验
- **WHEN** A7 形成处置建议候选但 A8 任一确定性约束失败
- **THEN** 候选保持为运行工件并创建复核任务
- **AND** 任何人工决定都不能把失败结果强制标记为正式处置建议

#### Scenario: 反馈运行不自动校准
- **WHEN** 独立反馈入口形成偏差记录且超过冻结阈值
- **THEN** 系统创建有界校准建议 Agent 任务及待审核建议引用
- **AND** 不覆盖当前规则、权重、阈值、区间或矩阵版本

### Requirement: 图状态只保存小型版本化引用

识别、评估和顶层图状态 MUST 由 Zod Schema 定义并派生 TypeScript 类型，固定 schema/graph 版本、运行与线程、触发/入口模式、授权主体引用、阶段、有限状态、快照/工件/业务结果/Agent/复核/路由/错误引用及因果关系。图状态 MUST 拒绝原始文档、完整 JSON-LD、监测序列、完整检索片段、模型响应、业务记录正文、规则正文、建议正文、通用对象袋和模型内部思维链。

#### Scenario: 小型引用状态通过校验
- **WHEN** 状态只包含声明的标识、版本引用、枚举状态、阶段与结果引用
- **THEN** 对应图状态 Schema 接受该对象

#### Scenario: 大对象不能进入检查点
- **WHEN** 调用方把标准化风险记录正文、风险评估记录正文、检索片段或任意未知对象加入图状态
- **THEN** strict Schema 拒绝该状态
- **AND** 调用方必须先把内容交给事实所属模块或工件存储并取得引用

#### Scenario: 检查点不替代业务事实
- **WHEN** 检查点存在但其引用的业务提交不存在
- **THEN** 恢复流程返回结构化不一致错误
- **AND** 不从检查点内容伪造业务记录

### Requirement: 暂停、恢复、重试和取消保持业务事实完整

工作流运行 MUST 使用闭合有限状态表达待运行、运行中、等待、可重试失败、已完成、终止失败和已取消，并用类型化等待原因区分知识准备、人工复核和交互确认。恢复 MUST 沿用原线程、冻结输入、策略、模型、提示模板和业务幂等键；需要更换任一冻结版本时 MUST 创建新运行。取消只停止未开始或可协作终止的工作，不回滚已可靠成立的事实、决定、审计或事务事件。

#### Scenario: 人工复核后幂等恢复
- **WHEN** 复核模块保存指向精确目标版本的类型化决定并发布复核已解决事件
- **THEN** 原线程从等待点恢复并复用已完成工件
- **AND** 不重复调用已完成模型步骤或重复入库

#### Scenario: 技术故障按原策略重试
- **WHEN** 可重试技术错误发生且冻结重试策略仍有预算
- **THEN** 运行在原工作项和原业务幂等键下重试
- **AND** 不切换模型、知识、工具、预算或输入版本

#### Scenario: 取消保留已入库事实
- **WHEN** 用户取消仍在运行的识别或评估流程
- **THEN** 未开始的工作被停止并生成取消汇总
- **AND** 已入库风险、评估、预警、决定和审计仍可追溯

### Requirement: Agent 与人工复核使用不同引用和决定边界

系统 MUST 使用不同的版本化引用表示 Agent 任务与人工复核任务。Agent 任务引用 MUST 固定任务类型、触发方式、冻结策略和任务版本；复核任务引用 MUST 固定复核类型、目标对象与目标精确版本。Agent 结果只能是任务专属增量、候选、校验、命令提案或正式结果引用，不能成为人工决定；复核决定 MUST 是闭合、类型化联合，不能使用通用补丁或整对象覆盖。

#### Scenario: Agent 候选进入确定性收口
- **WHEN** 必经 Agent 任务完成并返回任务专属增量引用
- **THEN** 所属领域模块校验并逐项记录接受或拒绝
- **AND** Agent 无权直接发布、批准、采纳、作废或回滚事实

#### Scenario: 复核决定针对精确版本
- **WHEN** 复核人对仍可决定的目标精确版本提交已声明决定
- **THEN** 复核模块保存决定、审计和应恢复运行引用
- **AND** 不直接修改工作流状态或上游业务记录正文

#### Scenario: 陈旧复核决定被拒绝
- **WHEN** 复核任务目标已经被新候选、决定或作废决定取代
- **THEN** 模块返回陈旧目标冲突
- **AND** 不把决定转移到新版本

### Requirement: 公共契约保持 Zod 单一事实源和完整追踪

所有 port、领域事件和工作流公共 DTO MUST 先定义 strict Zod Schema，再由 `z.infer` 派生 TypeScript 类型，并通过明确的 contracts 子路径消费。它们 MUST 复用 C01 的词汇、通用值对象、风险输入 XOR 与记录 Schema，不得复制其字段定义。契约验证 MUST 能证明 RI-S1～RI-S6 与 RA-S1～RA-S7 均至少映射到一个 module interface、阶段 DTO 和审计/事件结果，且依赖方向为 contracts ← core ← adapters/apps。

#### Scenario: 运行时与静态类型来自同一 Schema
- **WHEN** 调用方导入 port、事件或工作流 DTO
- **THEN** 运行时解析与 TypeScript 类型由同一个公开 Zod Schema产生
- **AND** 不存在并行手写 DTO 或第二套风险记录字段

#### Scenario: RI 与 RA 追踪无断点
- **WHEN** 验证者按 RI-S1～RI-S6 和 RA-S1～RA-S7 检查公共契约
- **THEN** 每个步骤都能定位到所属模块、I/A 阶段、输入输出引用与领域事件或运行结果
- **AND** 识别通过 `riskRecordId` 及精确版本进入评估，预警与处置没有绕过评估记录的旁路

#### Scenario: 依赖方向不反转
- **WHEN** 依赖边界检查分析 contracts、core、adapters 与三个应用
- **THEN** contracts 不依赖 core、adapters、apps、LangGraph 或基础设施客户端
- **AND** 领域模块不反向依赖应用模块

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

### Requirement: 公共引用必须闭合覆盖规则冲突复核目标

系统 MUST 在公共契约引用中提供 `rule-conflict` 分支。该分支 MUST 只包含固定 kind、规则冲突实体标识和精确版本标识，并与 `reviewType=rule-conflict` 的复核目标、复核任务和决定使用同一引用语义；不得携带冲突正文、规则正文、自由字段或第二套冲突身份。新增分支 MUST 不改变既有公共引用 kind 的字段与语义，公共引用仍须拒绝未知 kind 和契约外字段。（RA-S3、RA-S4）

#### Scenario: 规则冲突进入引用式复核链

- **WHEN** 调用方以 `rule-conflict` kind、非空实体标识和精确版本标识提交规则冲突复核目标
- **THEN** 公共引用、`reviewType=rule-conflict` 的复核请求与复核任务 Schema 接受同一目标引用
- **AND** 复核请求事务事件、审计和追溯链可以保存该精确目标引用而不复制冲突正文

#### Scenario: 拒绝不精确或夹带正文的规则冲突引用

- **WHEN** 规则冲突引用缺少实体标识或版本标识，或附带冲突详情、规则内容及任意未声明字段
- **THEN** 公共引用与复核契约拒绝该输入
- **AND** 系统不得以自由字段、空字符串或可变“当前版本”补足引用

#### Scenario: 既有闭合引用保持兼容

- **WHEN** 调用方提交任一既有公共引用 kind 或未声明的新 kind
- **THEN** 既有 kind 仍按原字段与语义完成校验，未声明 kind 仍被拒绝
- **AND** 新增 `rule-conflict` 分支不放宽其它判别联合或枚举

### Requirement: 预警确认必须以独立的已读接管命令表达

系统 MUST 在既有预警处置 `record` interface 中提供 `acknowledge` 写命令分支。该分支的 strict payload MUST 且只能包含 `warningRecordRef` 与 `warningResponseTaskRef` 两个精确版本引用，并 MUST 沿用公共命令信封的命令标识、业务幂等键、工程、操作者、发起时间和版本化授权上下文；两个引用 MUST 属于同一获授权工程和空间，且任务精确版本 MUST 归集该预警精确版本。成功结果 MUST 是 `{ kind: "acknowledgement", status: "acknowledged", warningRecordRef, warningResponseTaskRef }` 的 strict 分支，只返回已确认配对的精确引用与确认状态。（RA-S6、RA-S7）

预警确认只表示工程风险管理员已读并接管已入库生效的预警。系统 MUST NOT 因确认而解除风险、关闭预警处置任务、改变风险等级或触发状态、改写预警信息或风险评估记录，也 MUST NOT 把确认解释为处置建议采纳、现场执行、处置反馈、偏差结论或校准生效。建议采纳、执行、反馈、偏差和校准 MUST 继续使用各自既有 `record` 分支；`open` 与通知投递语义保持不变。

系统 MUST 在确认事实、审计和待发布事件原子成立时产生 `warning.warning-acknowledged.v1`。事件信封 MUST 沿用既有版本、工程、时间、因果、生产命令、幂等、授权和审计字段，`aggregateRef` MUST 是结果中的精确 `warningResponseTaskRef`；事件 payload MUST 且只能包含结果中的 `warningRecordRef` 与 `warningResponseTaskRef`，不得复制预警、评估、任务、通知或处置正文。

#### Scenario: 获授权管理员确认精确预警任务配对
- **WHEN** 工程风险管理员以具备 `warning-response.record` 能力的授权上下文、唯一命令标识和业务幂等键，提交同一工程内仍可确认且相互关联的预警与处置任务精确引用
- **THEN** `record` interface 返回 `kind=acknowledgement`、`status=acknowledged` 及该预警和任务的精确引用
- **AND** 系统原子保存确认事实、只追加审计和 `warning.warning-acknowledged.v1` 待发布事件

#### Scenario: 确认不改变风险与处置结论
- **WHEN** 一个已入库生效的预警被成功确认
- **THEN** 预警事实、其风险评估记录、风险等级和触发依据保持原精确版本与内容
- **AND** 任务不因确认而关闭，也不产生建议采纳、执行、反馈、偏差、校准或风险解除结果

#### Scenario: 不可枚举地拒绝无权或不匹配目标
- **WHEN** 调用方无确认能力、引用跨工程或越出获准空间，或者预警/任务任一不存在、精确版本不再可确认或任务未归集该预警
- **THEN** 系统在任何确认事实、审计成功记录或事件副作用前拒绝命令
- **AND** 对无权调用方使用与目标不存在不可区分的安全失败，不泄露预警、任务或关联关系是否存在

#### Scenario: 相同确认命令幂等重放
- **WHEN** 调用方以相同工程、`acknowledge` kind、业务幂等键和完全相同的精确引用 payload 重试已成功命令
- **THEN** 系统返回首次提交的同一逻辑确认结果
- **AND** 不重复保存确认事实、审计或事件

#### Scenario: 冲突重放与并发接管不覆盖原决定
- **WHEN** 调用方复用同一业务幂等键但改变任一精确引用，或多个不同命令竞争确认同一尚未确认的任务精确版本
- **THEN** 同键异载荷返回不可重试的幂等冲突，并发竞争只有一个命令可建立确认事实，其余命令返回类型化陈旧版本或业务冲突
- **AND** 系统不覆盖首次确认及其操作者、审计或事件

#### Scenario: strict 契约拒绝确认越权字段和伪处置状态
- **WHEN** 确认命令、结果或事件携带风险解除、任务关闭、处置结论、客户端操作者/授权覆盖、业务正文或其它契约外字段
- **THEN** 对应 strict 公共 Schema 拒绝该对象
- **AND** 既有建议采纳、执行、反馈、偏差、不可用和校准结果分支仍按原字段与语义通过校验

### Requirement: 专用只读端口加法式暴露校准批准证明

系统 MUST 以 strict Zod Schema 和独立的 `CalibrationSuggestionApprovalProofPortV1` 增加专用校准建议决定证明查询及闭合结果，输入只包含工程、精确 `CalibrationSuggestionRefV1`、精确 `ReviewDecisionRefV1` 和版本化授权上下文；匹配结果必须闭合区分 `approved-for-draft`、`rejected` 和 `returned-for-revision`，且只包含建议、复核任务、决定和决定时间的精确引用，缺失或目标错配结果只包含稳定原因。该加法式端口 MUST 保持现有 `ReviewAuditPortV1`、`requestReview`、`decideReview`、`trace`、知识修订批准证明查询、命令和事件签名不变，并复用既有 `review-audit.read` 能力，不得增加角色、能力或权限枚举。（RA-S7）

#### Scenario: 下游只通过公共端口取得精确决定证明
- **WHEN** 校准领域需要判断一个精确建议被批准、拒绝或退回
- **THEN** 下游通过新增只读查询取得带精确决定类型的闭合证明结果
- **AND** 不直接读取 C07 数据表、复制决定事实或解析审计活动文案

#### Scenario: strict 查询拒绝多余或不精确输入
- **WHEN** 查询缺少建议或决定的精确版本，或携带决定正文、证据正文、数据库定位及任意未声明字段
- **THEN** strict 公共契约拒绝输入
- **AND** 不以 latest、空字符串或自由文本补足

#### Scenario: 既有复核端口保持兼容
- **WHEN** 既有调用方继续使用复核请求、决定、追溯或知识修订批准证明查询
- **THEN** `ReviewAuditPortV1` 及其原输入、结果、状态、决定和事件语义保持不变
- **AND** 新增校准证明查询不扩大任何调用方权限

### Requirement: C25 通过加法式窄读端口证明冻结评估输入

系统 MUST 由 C25 实现独立的 `AssessmentInputSnapshotReaderV1` 类窄读端口，按工程和精确 `AssessmentInputSnapshotRefV1` 返回该快照绑定的工程、空间范围、`AssessmentBasisReleaseSetRefV1` 以及校准目标发布引用与内容摘要。端口 MUST 复用 C25 既有只读能力并在读取正文前验证 C06 授权，不得由 C29 直读 `business.assessment_input_snapshots`、增加能力或角色枚举，或提供列表/latest 查询。（RA-S7）

#### Scenario: 精确快照读取返回最小冻结投影
- **WHEN** 获授权调用方按同一工程和精确版本读取评估输入快照
- **THEN** C25 返回足以核对空间、依据集合和目标发布摘要的最小投影
- **AND** 不返回数据库行、评估正文、其它工程事实或未声明内部字段

#### Scenario: 缺失、陈旧或越权快照失败关闭
- **WHEN** 快照不存在、版本陈旧、工程或空间超出当前授权
- **THEN** 端口在披露冻结投影前返回类型化失败
- **AND** 不回退到 latest、调用方提供的依据集合或 C25 私表旁路
