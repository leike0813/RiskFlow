Label: wayfinder:map

# RiskFlow 完整产品与 MVP 实施规划地图

## Destination

先形成 RiskFlow 完整产品的领域、功能、界面、技术、数据、治理与验收规格，再从完整产品中划定可实际运行、可私有部署、可验收的 MVP，最终给出覆盖 MVP 实现全过程的 OpenSpec change 依赖图与交付路线。汇报截图是完整产品设计的派生物，不决定实施主线。

## Notes

- 本地图只消除完整产品设计与 MVP 实施前的决策不确定性，不实现生产代码、不安装依赖、不启动服务；实际实现由地图终点形成的 OpenSpec change 路线承接。
- 每次处理地图前必须阅读项目级 `AGENTS.md`、识别专利、评估专利、研究方案及当前 OpenSpec 状态。
- 规划会话使用 `wayfinder`；领域和架构决策使用 `grilling`、`domain-modeling`、`codebase-design`；外部事实使用 `research` 并只采用一手来源。
- 系统覆盖“识别 → 评估 → 预警 → 处置反馈”完整闭环，保留 RI-S1–RI-S6、RA-S1–RA-S7 的可追踪对应物。
- 完整产品设计必须先覆盖用户角色、端到端用例、业务状态、功能行为、异常与复核、页面交互、数据与权限，再从中切出 MVP；不得从汇报页面反推产品能力。
- MVP 的完成含义是：在一个经确认的工程样例上真实跑通“资料接入 → 知识建模 → LangGraph 风险识别 → P/C 确定性评估 → 预警处置 → Agent 交互 → 证据追溯与人工复核”，具备完整业务界面、审计记录和单机私有部署能力。
- MVP 可以限制输入格式、知识规模和并发；CAD 深度解析、LoRA、生产级高可用等能力是否进入后续阶段，由完整产品目标和 MVP 实测结果决定。
- 技术栈基线：TypeScript 全栈；React 前端；Node.js 服务端；`@langchain/langgraph` 是唯一主流程编排核心；共享 Zod Schema 与领域类型。
- 部署基线：甲方内网完全私有化；工程资料、监测数据和审计数据不依赖公网 SaaS。
- LLM 服务：统一通过 `llama.cpp` 适配；默认候选 `Qwen3.8-27B`，`Qwen3.8-Flash-Next` 仅作为高配升级候选；最低目标硬件为单张 RTX 4090（24GB）与 128GB 主机内存。
- 业务代码不得绑定模型名称、量化文件或推理服务细节；P/C 评分、风险矩阵、阈值判断和 Schema 校验均为确定性领域逻辑。
- 界面采用工业风险驾驶舱风格：深蓝灰框架、浅色内容区、红橙黄风险色，面向 1920×1080 汇报投影。
- 汇报材料需要五张高保真静态截图：风险态势总览、智能 Agent 工作台、LangGraph 智能识别中心、风险评估与预警中心、风险详情/处置建议/证据追溯。界面不显示 Demo、Mock 或模拟数据提示；既有截图规格是早期草案，必须在完整产品界面规格确定后重新校准。
- 智能 Agent 工作台采用“对话 + 任务执行 + 结构化结果 + 证据引用”，只展示可审计的任务步骤，不暴露模型内部思维链。
- RiskFlow 采用 Agent-native 横切模式：数据清洗、非结构化知识编制、识别检索审阅、处置建议和偏差超限后的校准建议遵循“确定性产物 → Agent 审阅或候选生成与受限工具行动 → 确定性校验 → 正式产物”；Agent 与人工复核严格区分，常规 P/C、矩阵和预警保持确定性，RI-S57 后不设置同模型 Agent 自审。
- 顺序约束：先确定完整产品目标、领域与用例、功能规格和完整界面交互，再派生汇报截图；截图不阻塞数据、模型、部署、验收或 OpenSpec 实施路线。

## Decisions so far

<!-- 已在建图访谈中确认的站立约束记录在 Notes；此处仅索引后续已关闭决策票。 -->

- [核实 TypeScript LangGraph 与 llama.cpp 的能力边界](issues/01-langgraph-llamacpp-capability.md) — TypeScript LangGraph 覆盖主流程编排；llama.cpp 必须经模型网关与 Zod 复验，Flash-Next 暂不进入首发基线。
- [确定目标硬件下的 Qwen 模型部署包络](issues/02-qwen-hardware-envelope.md) — 最低硬件以 Qwen3.8-27B Q4_K_M、单槽、32K、F16 KV、关闭 MTP 作为实机验收候选。
- [确定识别与评估一体化宏观架构](issues/03-macro-architecture.md) — 首期采用 TypeScript 模块化单体与 API/Worker 分进程部署；四层约束依赖、六个领域模块拥有业务事实，父子图按事件触发有限运行。
- [确定产品信息架构与界面设计系统](issues/04-product-information-architecture.md) — 已确定业务导航、统一风险对象闭环和视觉方向；该结论是高层信息架构基线，其中 Agent 独立工作台形态已被“设计完整产品界面与交互规格”票修订为全局停靠栏 + 全屏工作台。
- [盘点汇报截图可使用的业务内容](issues/05-screenshot-content-inventory.md) — 五屏统一使用“变径空间扩挖—地表沉降风险”叙事；专利事实与编制数值分账管理，界面保持正式业务表达并预留甲方数据整体替换规则。
- [确定数据与知识持久化架构](issues/06-data-knowledge-persistence.md) — 以 PostgreSQL 为业务 SSOT、本地目录保存不可变工件、Qdrant 承担可重建双索引，并确定事务、投影、重放与联合恢复边界。
- [定义完整产品目标与 MVP 完成标准](issues/10-full-product-mvp-definition.md) — 产品定位为有人监督的施工风险闭环系统；MVP 采用“全链路覆盖、受限深度”，必须以甲方认可工程样例通过端到端、追溯审计、确定性与重放、产品可操作和私有部署五项门槛。
- [建立统一领域模型与业务对象生命周期](issues/11-domain-model-lifecycle.md) — 以标准化风险记录作为唯一风险身份，采用五类对象、条目修订与集合发布、不可变事实和双时间模型；评估、预警、处置、复核与审计通过精确版本引用形成闭环。
- [确定用户角色、权限视角与端到端业务用例](issues/12-roles-use-cases.md) — MVP 以可兼任全部业务职责的工程风险管理员为核心，采用简单预设角色、显式运行、可代录协作和默认轻量报告，保留工程授权、只读限制与完整审计记录。
- [确定完整产品功能规格与用例契约](issues/13-full-product-functional-spec.md) — 以业务用例为公开接口，统一权限、冻结输入、事实输出、异常复核、版本审计与 MVP 深度；预警入库即生效，确认只表示已读并接管。
- [确定工程资料与监测数据接入范围](issues/14-ingestion-monitoring-scope.md) — 输入能力分登记、解析、业务可用三级；MVP 聚焦文档、OCR、表格与批量地表沉降监测，完整产品统一扩展到 Office、CAD、数据库、API 和实时流，清洗由 Agent 主导并全程留证。
- [设计风险识别工作流与人工复核契约](issues/15-identification-workflow-contract.md) — 一步启动后冻结资料与已发布知识版本，按工序检索推理、全局合并和分组验收；复核采用最少打扰的一站式修正与批量决定，并完整规定恢复、审计和 RI-S1～RI-S6 追踪。
- [设计风险评估、预警与处置引擎](issues/16-assessment-warning-response-engine.md) — 评估只消费已发布依据并确定性形成 P/C、等级与触发；预警按风险和空间归集，处置建议、效果预测、反馈偏差与校准保持不可变、同口径且不可绕过审核。
- [确定知识库、混合检索与图谱查询策略](issues/17-knowledge-retrieval-graph-strategy.md) — 知识与索引按不可变组合版本治理；双路 RRF 与独立关系检索形成确定性基线，每个工序必经 Agent 审阅和有界补搜，图谱仅作可重建查询投影。
- [设计完整产品界面与交互规格](issues/18-full-product-ui-spec.md) — 五类全局骨架统一空/加载/异常/权限行为，七项业务导航约 45 页逐页契约；Agent 修订为全局停靠栏 + 全屏工作台，无权命令置灰提示权限，证据抽屉统一于右侧停靠区。
- [核实 TypeScript 私有化数据与检索组件](issues/19-typescript-data-retrieval-research.md) — MVP 事实基线为 PostgreSQL SSOT、独立 LangGraph checkpointer schema、事务 Outbox、Qdrant 向量与 BM25 可重建投影、本地不可变文件目录、原生时序分区和关系图投影。
- [核实 TypeScript 文档解析与前端工程依赖](issues/20-typescript-app-dependencies-research.md) — MVP 采用有界 Node 格式适配器、独立内网 OCR/版面进程与单一 React 工程栈；所有依赖须经真实样例、资源、许可证和断网制品门槛后再由 OpenSpec 固定。
- [完成完整产品界面 Demo 供汇报截图派生](issues/25-full-product-ui-demo.md) — `demo/` React 工程 25 条路由可运行，覆盖五张汇报页与七项导航 20 个核心页面；五屏 PNG 已取景导出，截图二定稿为全屏 Agent 工作台。
- [定义 Agent-native 横切运行与治理契约](issues/26-agent-native-operating-contract.md) — 五类必经内嵌任务与交互式 Agent 共用一个受限任务模块；工具、硬预算、类型化增量、失败与审计统一，普通评估预警保持确定性且 RI-S57 后不做同模型自审。
- [从完整产品设计派生汇报静态截图方案](issues/07-report-screenshot-design.md) — 五屏从 `demo/` 真实页面取景导出至 `demo/screenshots/`，页面到截图派生关系固定，经 Agent-native 契约终校准无需修订；第二屏定稿 Agent 全屏工作台。

## Not yet specified

- 甲方正式风险清单、指标体系、量化标准、风险矩阵、规范和脱敏工程资料到位后，实际数据差异可能继续展开格式适配、规则治理、样本治理与验收校准票据。
- CAD 深度解析、LoRA/微调、高可用集群、多项目规模化运行等后续能力的实施优先级，需要根据 MVP 样例验证、硬件基准和甲方部署条件再展开。
- 各 OpenSpec change 内部的任务颗粒度、工期与人员安排，在最终实施路线确定后逐项展开，不在 Wayfinder 决策票中提前拆成编码任务。

## Out of scope

- 本地图不亲自实现静态截图、前后端、LangGraph 工作流、模型部署、知识库或生产基础设施；它必须把这些工作通往 MVP 的决策前提和依赖顺序说明清楚。
- 本地图不提交代码、不切换分支、不安装依赖，也不替甲方决定风险矩阵、指标权重和业务阈值。
