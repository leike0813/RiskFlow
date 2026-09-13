## Why

RiskFlow 尚无可运行的识别知识事实源：工序、风险机理、规范、案例及其证据关系不能按工程独立演进、受审发布并冻结到识别运行，非结构化资料也缺少受限编制与失败复核路径。C17 需要在 C20 检索和 C21 风险识别之前闭合这条治理链，使 RI-S2～RI-S4 的输入可校验、可追溯、可重放。

## What Changes

- 新增 `identification-knowledge` 领域能力，以 strict Schema 表达工序模型、风险机理库、规范标准库、类比工程案例库和检索证据库组合；五个必含工序、六类机理、关系一致性、证据可达性与版本化关键工序覆盖规则由确定性校验收口。
- 复用 C16 的稳定定义身份、不可变修订、人工送审/发布、停用与回滚；规范库和案例库分别使用前置契约演进提供的 `standard-library`、`case-library` 定义类型，检索证据库组合精确冻结 `risk-mechanism`、`standard-library`、`case-library` 三类发布，不创建第二套生命周期或“最新版”别名。
- 复用 C08 的 `knowledge-authoring` 任务、预算账本、恢复协议与 Worker runner。Agent 只提交类型化领域增量；确定性模块逐项记录接受/拒绝及原因，合格结果只能形成待审修订，失败则形成知识修订复核任务，Agent 无权发布、停用或回滚。
- `identification-basis` 中的 `identificationPolicySetRef` 由 C21/C24 拥有，C17 只通过组合根注入的策略提供者读取精确版本引用；缺失时封闭失败，不在 C17 新建策略类型、默认值或第二套治理。
- 为识别知识建立内容工件引用、校验收据、修订/发布绑定和编制任务绑定的只追加 PostgreSQL 索引，正文继续由 C04 内容寻址工件保存，审计与幂等事实通过 C03/C07/C16 组合完成。
- 按已归档 `evolve-identification-basis-published-event` D-04，把 C17 发布绑定和 `knowledge.identification-basis-published.v1` 事件接入 C16 发布/回滚事务；事务内无法形成完整五发布集合时整体回滚，不在 C16 成功后补绑定或补发事件。
- 补正 C16 内部发布解析的能力分支选择：识别知识族使用 `knowledge-modeling.identification-basis`，评估知识族保持 `knowledge-modeling.assessment-basis`；公共 contracts 与既有评估结果逐字段不变。
- C17 继续实现以前必须满足三项上游门：公共 `KnowledgeDefinitionTypeV1` 已含上述两个字面量；独立 C15 drift change 已提供受 C06 约束的正式精确窄读，并把准备快照中的覆盖/排除引用修正为公共 `route-decision` 契约；`implement-engineering-data-read-branches` 已实现 C02 `source-segments`、`evidence-access` 公共读取分支及 C06 工程/资料授权。C17 不在本 change 修复 C15、不读取上游私有表，也不修改 `packages/contracts`。

## Capabilities

### New Capabilities

- `identification/process-model-mechanism-and-evidence-governance`: 定义识别知识包、证据关系、确定性覆盖校验、C16 发布组合、C08 非结构化知识编制及失败人工复核的完整行为。

### Modified Capabilities

无。C16 能力分支修正保持现有 `knowledge/governed-definition-lifecycle` 需求和公共契约不变；C08、C04、C07、C15/C11 仅作为既有或前置依赖消费。

## Impact

- **代码**：新增 `packages/core/src/identification-knowledge/`、`packages/adapters/src/identification-knowledge/`、`apps/worker/src/identification-knowledge/` 及对应测试；新增自动发现的 `000020` 迁移；最小修改 core/adapters 包导出、Worker 根导出、C16 PostgreSQL adapter 及其回归测试和迁移发现测试。既有 API generic 路由与 Web 不改。
- **契约与所有权**：C17 拥有 `identification-knowledge`；继续复用 C02 的 `KnowledgeModelingPortV1`、`AgentTaskPortV1` 和识别输入引用。`packages/contracts`、主 specs、中央注册文件及 C15/C11 私有存储不在本 change 修改范围。
- **依赖**：实现依赖 C08、C16、C15、`implement-engineering-data-read-branches`、`evolve-identification-basis-published-event` 和知识定义类型契约演进均已归档并集成；继续实现前还要求独立 C15 drift change 归档。生产组合根必须显式注入 C03/C04/C06/C07/C08/C15/C16 接缝、审核策略和 C21/C24 精确策略提供者；任何必需项或受信授权来源缺失均关闭失败。不新增第三方依赖，不修改根 workspace 或锁文件。
- **追踪**：覆盖 RI-S2（工序模型）、RI-S3（风险机理和证据关系）、RI-S4（非结构化知识编制）；为 C20 的混合检索与 C21 的识别准备提供精确发布输入，不在本 change 实现索引检索、候选识别或风险评估。
