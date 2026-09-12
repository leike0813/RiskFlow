## Why

RiskFlow 已能把结构化文档、扫描文档和监测批次转换为可追溯资料段或监测快照，但这些结果尚未经过必经的数据清洗 Agent 审阅，也没有可供识别流程冻结消费的业务可用性结论。若下游直接使用转换成功或 C14 的算法可计算性作为业务可用依据，低质量片段、重复内容或异常监测样本可能进入识别，同时 Agent 失败或预算耗尽也可能被错误地降级为继续运行。

## What Changes

- 新增 C15 `data-cleaning` 任务专用的冻结输入、领域工具白名单、动作、候选和类型化增量；Agent 只能读取本任务获准的文档片段和监测快照切片，并提出对既有资料段或监测样本引用的排除建议。
- 新增版本化数据处理策略和确定性质量收口：逐项记录增量接受/拒绝及原因，禁止 Agent 提交正文或数值替换，并按保留覆盖率、受保护数值、C14 可计算性和策略要求形成 `available | partial | unavailable` 结论。
- 新增不可变清洗准备、清洗结果、排除决定和识别准备快照持久化；结果固定源版本、转换/监测快照、Agent 任务及模型/提示/工具/预算/校验策略、证据、权限和审计引用。
- 完成既有 `EngineeringDataPortV1.freeze(identification-preparation)` 分支。在所有必经清洗任务完成且确定性收口通过后，原子保存准备快照、审计和 `engineering.inputs-ready.v1`；部分可用输入保留明确排除范围，全部不可用则阻断。
- 文档转换覆盖 C12 的 DOCX、文本型 PDF、XLSX、CSV，并消费 C13 通过同一转换契约形成的 OCR 结果；监测清洗消费 C14 的精确不可变快照，不覆盖原样本、规范值或特征。
- 复用 C08 的任务信封、注册表、预算、租约、恢复和失败语义。预算耗尽、模型/工具失败、任务未完成或结果版本不匹配时不得用原转换结果、C14 基线或缓存结果替代。
- 实现前置依赖 `evolve-identification-preparation-segment-set-refs` 必须先归档，使识别准备快照以 `includedSourceSegmentSetRefs[]` 与多个 `sourceVersionRefs[]` 一一对应；本 change 不修改 `packages/contracts/**`，也不定义替代聚合段集合。

### Non-goals

- 不修改 C02/C01 公共 Schema、现有资料段或监测快照，不创建第二套 Agent 运行时、工件库、审计库或工作流状态机。
- 不执行 OCR、文档格式解析、监测时间对齐或特征计算，不修改或补造关键数值、文本正文、表格值和公式缓存值。
- 不实现知识编制、识别推理、P/C 计算、矩阵与阈值判断、人工发布/审批、API 新路由、Web 页面或通用数据清洗平台。
- 不新增第三方依赖，不修改根 workspace、锁文件、依赖政策、OpenSpec 配置或中央运行时注册。

## Capabilities

### New Capabilities

- `data/agent-cleaning-and-partial-availability`: 定义结构化/OCR 文档与监测快照的有界 Agent 清洗、引用级排除、关键数值保护、确定性质量判断、部分可用结论和识别准备冻结语义。

### Modified Capabilities

None.

## Impact

- **直接依赖**：C08 `platform/unified-bounded-agent-runtime`、C11 `domain/engineering-context-source-registry`、C12 `engineering-data/structured-document-conversion`、C13 `data/scanned-document-ocr`、C14 `domain/monitoring-batches-snapshots-features`，以及实现前置 `evolve-identification-preparation-segment-set-refs`。
- **代码所有权**：新增 `packages/core/src/engineering-data/cleaning/**`、`packages/adapters/src/engineering-data/cleaning/**`、对应测试和 PostgreSQL `000016` 迁移；在现有 C11 PostgreSQL composition 中仅委派既有 `identification-preparation` freeze 分支，并提供 C15 Worker 清洗定义与渲染/解释模块。
- **接口**：消费而不改变 `AgentTaskPortV1`、`EngineeringDataPortV1`、`StructuredDocumentConversionPortV1`、C11/C14 窄读取能力和复数识别准备快照契约；HTTP 传输已有通用 freeze 与 Agent task 路由，无新增公开路由。
- **RI/RA 追踪**：落实 RI-S21～RI-S23 的清洗、质量和失败回溯，并保留 RI-S13/RI-S14 的资料段与权限证据；向 RI-S1/RI-S2/I0 提供冻结准备输入，同时为 RA-S1 后续使用监测清洗结果保留精确快照和排除依据。
- **依赖治理**：仅使用现有 Node.js 24、TypeScript、Zod、Kysely、C03/C04/C06/C08 能力；不新增或升级依赖。
