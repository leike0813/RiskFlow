# AGENTS.md

> 项目级 Agent 规则。本文件优先于 `~/.claude/CLAUDE.md`（仅在本项目语境下；冲突时由用户在当前消息中明示优先级）。

## 1. 项目身份

- **项目名称**：变径盾构站隧一体化建造风险智能识别与评估系统（RiskFlow）
- **课题归属**：中国铁建 2024-W08《基于变径盾构的轨道交通隧站一体化建造技术研究》之子课题一
- **甲方**：中铁建华南建设有限公司（提供风险源清单、风险矩阵、指标体系、量化标准、监测数据等业务输入）
- **乙方（本仓库承担方）**：将甲方的业务规则转化为基于大数据、知识图谱与大语言模型的可运行智能系统
- **语言**：中文。所有面向甲方的文档、注释、提交说明默认中文；技术术语首次出现可附英文。
- **工程沟通语言**：中文（除非用户在本轮明确要求其它语言）

## 2. 规划与领域事实边界

- 项目能力、接口和模块的开发事实源是已归档 OpenSpec 主规格与当前 change；当前代码用于判断实现现状和 drift。
- 规划 Agent 的研究资料输入只由受控 Planning Task 提示词注入，且仅限 `references/风险识别与评估规划事实源摘要.md`；其余 Agent 不读取或转换研究资料原件。
- 实现 Agent 完整读取 `openspec instructions apply --json` 返回的 `contextFiles`；Finalizer 以已批准 change、代码和可运行证据完成核验、范围内修复与 verification，不重新解释研究原文。

### 2.1 Agent-native 横切运行契约

- **Agent 审阅按任务性质设置，不按所有阶段强制**。只有需要语义判断、证据取舍或受限工具行动的环节才可设为必经 Agent；P/C 计算、风险矩阵映射、阈值判断、Schema 校验、业务入库、版本发布与回滚不得以 Agent 可用性为前置。
- MVP 必经内嵌 Agent 任务固定为五类：数据清洗与部分可用判断、非结构化知识编制、识别检索审阅与有界补搜、处置建议组合排序、偏差超限后的校准建议候选。甲方已审核配置包原样导入不强制 Agent 重新解释。
- RI-S57 风险候选生成是受 RI-S56 上下文约束的专用 LLM 节点；其输出直接进入确定性校验，不得再由同一 Agent 形式化复审。常规 `assessmentGraph` 的指标取值、P/C、矩阵与预警判定不创建必经 Agent 任务。
- 内嵌与交互 Agent 共用统一的有界 Agent 任务契约；会话可以持续，但每个任务必须固定发起者、工程、输入版本、模型/提示模板、工具策略、资源预算、Agent 增量和终态。
- Agent 只能调用按任务类型版本化的领域工具白名单。任务创建时按当前用户、工程和资料权限限定输入与工具；禁止通用数据库、文件系统、Shell、自由联网和任意外部系统调用。
- Agent 增量必须使用任务类型化领域操作表达，不得使用通用 JSON Patch 或整对象覆盖。确定性模块逐项记录接受、拒绝及原因；Agent 无权修改已发布定义、P/C、矩阵、阈值或人工决定。
- 模型、工具、上下文、候选规模、并发与墙钟时间使用系统强制执行的版本化硬预算。预算耗尽或必经 Agent 失败时不得静默跳过、扩容、换模型或使用基线冒充正式结果。
- 确定性校验可把字段、格式、引用和候选越界等可修复错误反馈给同一 Agent，在原预算内生成新候选；权限、来源资格、版本兼容、规则冲突和处置三项约束失败不得通过循环尝试绕过。
- 数据清洗结果与检索增量按其确定性收口自动生效；处置建议通过三项校验后可以成为正式建议，但采纳与执行由人决定；知识发布和校准生效必须人工确认，交互 Agent 的写命令提交前必须用户确认。
- 每次 Agent 任务保存可重建输入、原始模型响应、工具行动、候选版本、Agent 增量、确定性校验、资源消耗、失败与正式结果引用；不得保存或展示模型内部思维链。

## 3. OpenSpec 驱动开发（强制）

本项目以 `openspec/` 为规格驱动的单一事实源。

- **任何能力/接口/模块级别的变更**必须先在 `openspec/changes/<name>/` 下创建 change，通过 `openspec-apply-change` 应用，通过 `openspec-verify-change` 验证，通过 `openspec-archive-change` 归档。
- 后续大型交付 change 使用项目级 `orchestrated-delivery` workflow。Planning 只闭合 apply 前置的 proposal → specs → design → implementation-plan → tasks；实现完成后由验收 Agent 生成 verification。`implementation-plan.md` 是基于固定 base commit 的代码施工图：每个 Requirement/Scenario、计划文件、现有符号、实现动作和验证证据必须映射到稳定 IP-ID；公共接口、Schema、事务、依赖或范围决定仍归 design，不得只写在施工图中。既有 change 继续按自身 `.openspec.yaml` 解析 schema。
- 实现 Agent 必须读取 `openspec instructions apply --json` 返回的全部 `contextFiles`，按 IP-ID 实施并在行为与证据均完成后勾选 task。工件冲突、代码漂移、计划外公共契约/依赖/迁移/文件或不存在的验证命令必须升级，不得自行补设计；不得在 apply 阶段提前创建 verification。
- 创建或操作 change 前必须按 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §4 和 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` §2.1 使用 OpenSpec CLI；以 change 创建结果的 `change.schema` 或 status 的 `schemaName` 为准，不从 CLI 帮助中的默认值推断实际 schema。OpenSpec 提前显示 verification `ready` 或 change `all done` 时，Planning 仍只按 `applyRequires` 判断规划完成，且归档前必须完成 verification。
- 小型机械、纯文档或紧急 drift change 可显式使用内置 `spec-driven`；不得以此绕过本应先闭合的实现设计。
- **禁止**：在无对应 OpenSpec change 的情况下修改被规格覆盖的代码；将一次"修 bug"拆成与原任务语义不同的多个 change；将一次完整能力拆成过细的多个 change。
- **冲突处理**：当代码与已归档 specs 不一致时，**以代码为准**，并在对应 specs 下开一个 drift 修正 change；不要静默忽略。
- **`openspec/config.yaml`** 已由工程基线 change 固定当前技术栈、领域上下文与工件规则；后续仅在对应 OpenSpec change 中更新，禁止绕过规格直接改写。

- **C37 工程与功能分阶段收口**：`deliver-offline-private-deployment-and-operations` 保留已实现工程成果；剩余实现和真实功能取证归 `complete-private-deployment-functional-acceptance`。接续实施或 C38 规划时读取后者 handoff.md、D-25–D-30，以及前者 D-23/D-24 和 F-01–F-05（归档后读取对应 archive）。当前可启动宿主限定 synthetic-acceptance 合置本地 C04；正式跨 VM host、签名/多平台安装、禁网、本地介质和 4090 取证归 C38。工程测试不替代真实业务终态、权限、预算、审计与追溯证据。
- **文档转换与本地交付**：PDF、扫描图片及 DOCX 通过 MinerU，XLSX/CSV 使用确定性原生解析；保存真实提供的定位与置信度。官网功能验收与自托管验收分别记录证据。C38 的主 4090 运行 Qwen3.8-27B，辅助 NVIDIA GPU 运行 MinerU 专用模型，embedding 保持独立服务；部署和验收时读取 `adopt-mineru-document-ingestion` 的 D-03–D-08（归档后读取对应 archive），按真实设备、模型和协议取证。

### 3.1 大型实现编排

涉及授权、工件读取、检索、续办、阶段配置或确定性组合发布的减负工作，先读已归档 `reduce-defensive-design-overhead` 的 design、implementation-plan 和 handoff；已有查询/报告读取、工件集合与去重、游标另读 `simplify-trusted-business-flows` 的 design 和 implementation-plan（归档后读对应 archive）。系统按封闭应用设计：入口检查当前权限和业务输入，内部消费登记事实；对象来源由服务端解析，日常流程不反复证明文件或数据库未被系统外改动。`complete-private-deployment-functional-acceptance` 保留实机验收责任，按实际代码接续原资料、结果和任务。

- 执行 39-change 路线前必须先读根目录 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 和 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md`；前者规定稳定责任与状态转换，后者规定 worktree 信任、Agent 启动、等待、同步、故障恢复和回收操作。当前起点只读取 `pnpm orchestration:status --json` 的 `resumeQueue`。
- 大型实现的阶段、角色、模型与强度以 `config/orchestration/execution-graph.json` 为唯一事实源。规划由 Planning Agent 承担；首轮实现由 Implementation Agent 承担；进入 `FINALIZING` 后由 Finalizer 对核验、已批准范围内修复、回归和 verification 负责，普通实现缺陷不得回派首轮实现角色；触发限定审计时，由 Targeted Auditor 将最终结论补入同一工件。**每个独立 Task 必须使用新的 Agent session**，已结束、失败、暂停、释放或长时间闲置的 terminal、Run、Dispatch 和上下文不得用于后续 Task；只有同一仍活动 Task 内的修复与回归可以连续执行。**同一收尾轮次最多一次限定审计**：Auditor 必须在自己的活动 Task 内修复其发现的已批准范围内普通缺陷并完成回归；禁止为同一收尾重复派发新的 Finalizer 或第二次审计，无法在当前 Task 内闭合时必须升级给用户。
- 主调度的编排写操作必须通过 `riskflow_*` 受控工具执行，并携带当前状态 `revision` 和幂等键；历史日志、聊天记录和手册示例不得替代实时状态。
- Agent 之间不得用未提交文件传递实现状态。每次角色交接前由主调度 Agent审阅并形成 Git 检查点；Git 权限仍以用户在当前 session 的明确授权为准。

## 4. 代码组织约束

### 4.1 模块边界

- 四层架构之间通过**显式接口契约**沟通，禁止跨层直接读写对方内部结构。
- 识别专利 RI-S1–RI-S6 与评估专利 RA-S1–RA-S7 应在代码中有可识别的对应模块/包，且命名贴近专利用词（例如 `processModel`, `riskMechanismKB`, `standardizedRiskRecord`, `applicableRuleSet`, `riskAssessmentRecord`, `warningRecord`, `responseRecommendation`）。
- 标准化风险记录中的风险事件是识别与评估之间的共享领域对象；评估模块只能按标识引用，不得维护第二套事件字段或修改识别事实。
- `riskFlowGraph` 只依赖各层公开接口；LangGraph 节点不得成为跨层访问数据库、知识库和规则内部结构的后门。
- 业务规则（风险源清单、风险矩阵、指标体系、量化标准、权重、阈值、通知策略）由甲方提供或审核，**作为版本化配置数据加载，禁止硬编码到业务逻辑里**。

### 4.2 识别与评估 Schema（SSOT）

- `标准化风险记录` 的字段集合、字段命名、必填性必须与相关 OpenSpec 主规格和当前 change 一致，并由单一 schema 模块导出。
- `适用性元数据`、`结构化评分规则`、`风险评估记录`、`预警信息`、`处置建议`、`偏差记录与校准建议` 分别由唯一 schema 模块导出，字段契约以相关 OpenSpec 主规格和当前 change 为准。
- 任何识别、评估、预警、处置接口与 LangGraph 状态都必须引用上述 schema，不得各自定义字段名或私自增减字段；新增字段必须先开 OpenSpec change，并同步更新对应事实源章节。
- `riskRecordId` 与 `externalRiskEventId` 使用可辨识联合类型表达“二选一且仅一个”，不得依赖运行时约定或空字符串判断。

### 4.3 规则、矩阵与配置版本（SSOT）

- 指标体系、量化标准、结构化评分规则、适用规则集、权重、风险矩阵、风险可接受阈值、监测预警阈值、措施库均使用不可变版本；发布新版本不得原地覆盖历史版本。
- 每个风险评估记录固定引用适用规则集版本、风险矩阵版本、权重版本与适用性元数据快照，确保任意历史评分可以重放。
- 规则一致性冲突、适用性筛除原因、人工审核与版本发布/回滚均写入审计日志。

### 4.4 可追溯性

- 每一条识别结果必须能回答：来源于哪份资料（资料段标识）→ 关联到哪个工序节点 → 引用了哪条风险机理条目 → 综合置信度由哪些证据构成。
- 每一条评估与预警结果必须能继续回答：使用了哪个风险事件 → 哪个适用性元数据快照 → 哪些指标实际取值与规则 → 哪个权重/矩阵版本 → 为什么得到 P/C 与风险等级 → 哪些指标触发预警 → 处置和反馈如何改变后续判断。
- 端到端追溯链固定为：**资料段标识 → 工序节点 → 风险机理条目 → 标准化风险记录 → 风险评估记录 → 预警信息 → 处置建议 → 偏差记录 / 校准建议**。
- 审计日志是合同交付的一部分，不可省略、不可异步静默丢弃。

### 4.5 状态参数、监测指标与领域枚举

- OpenSpec 主规格定义的领域枚举与分类必须由**领域层单一常量模块**导出，所有调用点通过该模块引用。
- 工序节点的“必含 5 项”和适用性元数据的“必含 3 个维度”均为**最小覆盖集**：可扩展，不可删减；变更最小覆盖集须先开 OpenSpec change 并同步专利追踪说明。

### 4.6 客户端与业务界面

- 完整业务界面统一归 `apps/web`；C37 的 `apps/desktop` 使用 Electron 加载应用服务器同一内网 HTTPS，业务调用继续走既有 HTTP/SSE 与服务端权限、审计和人工确认契约。
- Desktop 仅承担桌面入口与受限本机能力，Web 保持浏览器独立；API、Worker、数据库与模型仍在服务器。涉及 UI 迁移、桌面能力或客户端发布时，先读 `.scratch/riskflow-master-plan/prototypes/desktop-client-architecture.md`，再按当前 change 闭合依赖与施工图。移动端能力须另行明确适配与验收范围。

## 5. 第三方依赖与外部能力

- **LangGraph**：作为识别 + 评估主流程的唯一编排核心；具体语言版本、持久化检查点实现和部署形态在首个宏观架构 OpenSpec change 中确定。禁止并行维护另一套自研流程状态机。
- **LLM / Embedding**：默认以适配中文工程文本的开源预训练模型为基座；具体型号在 OpenSpec change 中确定。
- **LoRA 微调**：以专家复核结果或合成样本构造语料，使用低秩适应技术；微调后的权重与原始权重必须同时可加载、可回退。
- **向量库 + BM25**：双索引必须共存（专利 S53）；综合得分函数作为可配置策略，不允许硬编码到单一调用点。
- **MCP（Model Context Protocol）**：当且仅当用于“实时多源监测数据 → 指标实际取值”这条数据接入通路时引入；P/C 计算与风险矩阵映射仍由确定性领域模块执行。不得在无对应业务需求的位置滥用。
- **新依赖**：必须先开 OpenSpec change，附版本号、引入原因、移除条件；禁止私下加锁文件外的依赖。

## 6. 测试与验证

- 行为测试针对**稳定可观察契约**（标准化风险记录、评估记录、JSON-LD 转换结果、适用性规则筛选、P/C 计算、风险矩阵映射、预警触发、版本重放、端到端追溯链路）；不为提示词文本、错误文案、UI 文案、字段顺序写脆弱断言。
- 识别准确性的验证数据集：优先用甲方提供的脱敏工程资料样例；无样例时使用合成样本，并在 OpenSpec change 中注明"合成样本、待甲方复核"。
- 评估验证优先使用甲方审核的指标体系、量化标准、风险矩阵和脱敏监测样例；数据尚未提供时，合成样本必须标明适用性元数据与规则版本。
- LLM 推理结果不可作为单元测试的硬期望；必须通过规则一致性校验、仿真/试验约束、多来源合并等**可重现**手段约束后，再做断言。P/C 计算、矩阵映射、适用性校验与预警触发必须具有确定性期望。
- LangGraph 测试优先验证状态契约、条件路由、暂停/恢复、幂等重试与人工复核边界，不锁定内部节点调用顺序。
- 性能敏感路径（检索、LLM 调用、JSON-LD 序列化、图谱合并、规则适配、批量重评估、监测触发）必须有基准。

## 7. 交付物对齐

甲方最终接收的是"软件/源代码 + 模型 + 知识库原型 + 测试报告"。每一项在提交时必须能回答：

- 是否覆盖识别专利 RI-S1–RI-S6 与评估专利 RA-S1–RA-S7 全步骤？
- 是否保留资料段标识 → 工序节点 → 机理条目 → 风险记录 → 风险评估 → 预警 → 处置反馈的完整链路？
- 是否能解释每个 P/C 分值、风险等级和预警触发所使用的指标、规则、权重、矩阵版本与适用性元数据？
- 是否带审计日志与版本信息？
- 是否可以由第三方仅凭代码、schema、配置版本与输入快照重放识别和评估结果（可审计性）？

## 8. 不在范围内

除非用户在本轮明确授权，Agent **不得**：

- 自行提交代码、修改 Git 历史、切换分支（全局默认禁止）。
- 删除大量文件、覆盖未提交改动、强制清理。
- 擅自安装/升级/删除 npm/pnpm 依赖。
- 偏离 OpenSpec 流程直接落地规格变更。
- 在用户可见界面（前端 / 报告）放入开发思路、兼容性说明、专利原文段落等无关文字。
- 用"占位实现 / TODO / Mock 后端 / 假回退"包装成完工交付；如确属阶段性原型，需在交付说明中显式标注。

## 9. 三阶段工作流（沿用全局规则）

每条非平凡请求按 `【分析问题】→【制定方案】→【执行方案】` 推进：

- 阶段一必读：相关 `openspec/specs/`、`openspec/changes/`、生产代码、受影响调用方和现有测试；规划 Agent 另按受控 Planning Task 提示读取规划资料摘要。
- 阶段二必列：变更文件清单、新增/修改/删除的 OpenSpec specs、是否复用已有模块、是否引入新依赖。
- 阶段三必验证：与本次变更相关的最小必要验证（schema 校验、单元测试、合规校验、检索回路、JSON-LD 往返）。

## 10. 轻量任务例外

只读分析、解释说明、文本润色、单一文件小修，无需走三阶段；仍需遵守 OpenSpec 流程与已批准领域术语。
