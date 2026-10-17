## Why

当前接续：过度防御性设计减负已由独立 [reduce-defensive-design-overhead](../archive/2026-10-16-reduce-defensive-design-overhead/proposal.md) 完成并归档，责任见其 handoff.md。当前任务6/19，现场v110、000059；新清洗准备、纵向监测三批次/快照及旧发布条目补登记已完成，D-102修复全组待复核的空决定收口、D-103修复工作计划混入失败I5诊断引用，D-104约束检索审阅生成绑定且一次真实模型诊断通过。当前原父等待失败检索任务，D-105公开失败通知已获用户批准并在实施，范围见 evidence/failed-review-resume-scope-proposal.md；完整业务尚未通过，证据见 evidence/resume-after-reduction-2026-10-16.md。原成果与历史证据保留。下文 D-ID 保留历史实施记录。

前置 change 已实现大部分部署、业务宿主与验收程序，但正式来源补证、完整 Electron 场景和真实业务报告尚未完成。将这些剩余义务独立规划，以完整终态证据判断功能是否可交付。

## What Changes

- 承接原 4.3、5.1–5.3、13.1、14.1–14.2、16.1–16.3 的剩余义务，逐项映射见 handoff.md；复用已有宿主、reader、模型 adapter 和报告程序。
- 补证正式 C19 发布成员、C24 路线、C30 精确空间来源；范围内缺陷使用既有所属模块接缝修复，不接入第二套来源。
- 在隔离 synthetic-acceptance 合置实例准备真实配置、同发布清单、权限和资料，运行显式 API/Worker 与同源 HTTPS。资料转换依赖 MinerU 独立 change 的合格新版本。
- 补齐当前平台 Electron 的共享对象、登录、上传下载、撤权、证书拒绝、导航、SSE 重连及关闭窗口后任务继续场景。
- 运行识别、复核、评估、预警、处置/人工决定、执行反馈，以及会话流、拒权、重投、重启和适用恢复核验；由正式只读终态和可见外部 Chrome 留证。
- 形成安全报告、双向追踪、工程验证、固定实现检查点与限定审计，由 Finalizer 生成 verification。C38 F-01–F-05 保持未来移交。
- 按已批准D-36–D-38补原件读取/预览/下载、真实Agent停靠接线及C17/复核动作修复，复用原件与已冻结预算。
- 按已批准D-39接正式适用规则集组装命令及部署提交回调，仅在隔离验收工程的新策略允许明确合成评分来源；继续复用C07/C16审核发布。
- 按已批准D-40补发布命令到检索投影的精确派生授权，修复父图检查点误用入口摘要的问题，保持原权限、有效期与冻结图版本。
- 按已批准D-41将原消费者事务上下文传给检索质量门的代际窄读，保持质量、权限、耐久报告与激活门禁。
- 按已批准D-42为标准库检索正文增加真实证据段校验，并为稠密查询增加版本化指令；原标签、阈值、模型、预算、权限及旧发布保持不变。
- 按已批准D-43将本次验收输入补充为原16份治理资料与STD-001/002/003标准真实原文的新正式准备版本；复用既有C04/C11正式登记、MinerU转换与质量门、C15清洗与准备冻结及C17真实证据正文，经物理Chrome人工审核后独立发布，形成新的检索组合、精确引用策略与新代际；原query、grade、TopK、阈值、模型、预算、权限及旧失败不变，不新增生产代码、契约、依赖、迁移或HTTP。原文经受权资料入口送正式转换，Agent不读取研究原件、不合成条款。
- 按已批准D-44修复C04文件流在输出边界复用缓冲区导致的保留块改写：每块交付独立字节副本，保持原1MiB分块、EOF完整消费、摘要、审计、取消与verified时机；扩展既有C04多块不同内容测试并沿原大文件资源基准，纳入IP-19；不新增API、依赖、迁移或预算。
- 按已批准D-45修复MinerU官网图表结构映射（chart/chart_body/chart_caption/chart_footnote及chart span映射为既有共享惰性图像载荷，保留图注/脚注真实文本与源坐标），并在共享表格HTML文本中允许无属性eq的惰性字面公式文本（不求值，eq属性、危险内容与资源检查继续拒绝）；生产代码与测试限两个解析器及两个既有测试文件。仅对精确STD-001原件摘要建立来源专用质量策略（非空页97/99、关键字段覆盖1及原keyFields不变），正式转换后下游前核对完整99页映射、非空97页、无正文页恰为{9,51}及摘要/策略匹配；STD-002/003及原16份保持原策略，冻结新converterDeploymentRef并按既有C11建立新source-version，保留旧失败/旧源/旧下游引用，模型、通道、权限、预算与检索门槛不变。

## Capabilities

D-93为D-91原生CSV新增显式清洗策略版本，允许其实际转换质量引用并要求table段，保留保护类型及100%留存/覆盖、工具/模型/预算。既有冻结准备和原422拒绝保持；不改清洗算法或生产契约。

D-92修正隔离实例生成的置信度策略：必需模型/规则依据，未参与的合并/仿真依据按既有显式排除归一规则处理。保持原权重、强制人工复核、阈值、预算和所有确定性校验；旧v97五项I5及I6保留，I7终态不复活，后续独立批次取证。不改生产计算或公共契约。

D-91沿用户持续授权补独立合成纵向监测情景及其初始/补录/更正三份CSV，使用现有C04/C11、原生转换、C15、D-89预置及公共批次/快照入口。原case与CSV保持，指标阈值、矩阵和预算不变；输入生成不代表正式监测、评估或预测通过，精确范围见design D-91。

D-54已完成24来源同内容新组合审核发布及七门槛复测，v62代际active。D-55显式executionBatchId已实施并部署v63，公共同批次/异批次/同键冲突回归通过，新父与旧父隔离。真实新父已绑定原五资料准备并到达I3，C08任务因C24预冻结引用与实际任务身份不一致而终止，父返回技术失败；D-56按持续授权复用C08唯一任务身份函数，并为既有检查点补任务/复核只读策略。保留全部失败与预算，不复活旧任务；细节见design D-55/D-56及最新安全证据，完整业务终态仍未通过。

D-50具体v13候选已获用户确认用于正式门禁：[复核报告](evidence/retrieval-relevance-review-2026-10-15.md)保留原6查询文本、逐项复核15成员，移除8项不直接回答所问的规范标签，保留13项原正标签并新增4个规范问题/标签。同成员新组合经正式审核发布，v55按原七门槛7/7通过且代际active；生产检索算法、模型、预算、TopK和门槛不变，旧FAIL保持。

D-51[显式绑定提案](evidence/workflow-identification-preparation-binding-scope-proposal.md)已实施并实机取证，原五资料准备和生产检查点窄证明成立。已批准[D-52](evidence/identification-start-authorization-scope-proposal.md)的真实父调用字段修复也已实现、回归和部署，真实C06预检通过父调用核验；D-53的控制/领域及逐操作接线已部署v59，工程验证通过；用户已批准[D-54](evidence/identification-batch-scope-and-read-context-proposal.md)，正在实施新显式验收批次（业务载荷仍原五来源、外层授权24项并集）、同成员新发布重建双索引与新代际、隔离策略八分支及复核root、C21/C16/C24所属读取契约；持续授权仅覆盖当前验收任务的后续必要修正，仍先记录事实/设计/施工图/验证，不提交、不归档、不放松权限、不伪造验收。未重试原父图或新增任务，完整业务终态未通过。

D-49已获批准：按[evidence/cleaning-preparation-completion-scope-proposal.md](evidence/cleaning-preparation-completion-scope-proposal.md)增加精确任务引用的完成准备命令，以新鲜当前授权消费原任务/清单/结果，保留唯一快照、单次事件及原父运行因果。普通TTL、预算和质量门槛不变。

D-48已获批准：按[evidence/agent-task-current-authorization-scope-proposal.md](evidence/agent-task-current-authorization-scope-proposal.md)基于C08正式任务/有效租约和C06当前权限签发任务行动短效授权，统一覆盖模型、工件和工具；普通TTL、冻结范围、撤权、预算及人工确认不变。

D-46已获批准：按[evidence/table-image-payload-scope-proposal.md](evidence/table-image-payload-scope-proposal.md)保留有源未识别表格图片引用，补JSON-LD、C15冻结计数/有界观察及指纹；不推断图形、开放外链或扩大预算。新增生产字段仅属该批准的文档/清洗数据契约。

D-47已获批准：按[evidence/jsonld-read-bound-scope-proposal.md](evidence/jsonld-read-bound-scope-proposal.md)共享C15既有16MiB JSON-LD读取边界，C17精确文档及单条标准累计读取使用16MiB，候选包、清洗清单与其它4MiB读取保持；模型、工具输出和检索质量预算不变。

### New Capabilities

无新增能力目录，复用前置 change 的平台能力。

### Modified Capabilities

- `identification/versioned-dual-index-hybrid-retrieval`：D-41补质量门沿原事务读取building代际，不改变事务或质量判定。
- `identification/versioned-dual-index-hybrid-retrieval`：D-42仅补真实来源的标准库检索正文、共享成员文本和版本化查询指令语义。
- `identification/process-model-mechanism-and-evidence-governance`：D-42补标准库检索正文的真实证据来源与候选校验。
- `platform/offline-private-deployment-and-operations`：添加从原 change 移入的阶段收口、真实功能取证、生产来源与报告覆盖义务。
- `platform/electron-https-client`：添加从原 change 移入的完整桌面功能取证与正式多平台分阶段要求。
- `platform/content-addressed-artifact-store`：按用户授权补充可信本地宿主的精确清单读取接缝，模型父工件使用真实用途受权预检；设计为 D-31 / IP-19；D-44补读取块字节在消费者保留后不被改写的稳定语义，保持EOF完整性、审计与既有接口不变。
- `engineering-data/structured-document-conversion`：按用户授权修复DOCX标准XML字符引用的正文语义，保留实体声明拒绝及源一致性；设计为D-33。D-45补官网表格HTML无属性eq的惰性字面公式文本读取，保持属性、危险内容与资源检查拒绝；delta沿主规格现有目录整理。
- `platform/mineru-service-integration`：D-45补官网已观察图表结构的共享惰性映射、未知结构继续拒绝，以及新converterDeploymentRef与C11新source-version的历史保留语义。
- `data/agent-cleaning-and-partial-availability`：按用户授权补齐真实冻结定位及受权观察进入模型消息；设计为D-34。
- `platform/unified-bounded-agent-runtime`：按用户授权修复失败恢复读取、错误分类及累计重试预算收口；设计为D-34。
- `platform/llamacpp-model-gateway`：按D-35补模型行动剩余额度的调用前及usage核验；清洗增加受限定位工具，共享Agent失败结算如实记账，新实例按用户授权提高冻结预算。
- `domain/engineering-context-source-registry`、`platform/http-command-query-sse-shell`、`web/engineering-and-knowledge-ui`：D-36补精确原件窄读和二进制HTTP及原件默认视图。
- `web/agent-audit-and-operations-ui`、`platform/web-shell-interaction-primitives`：D-37/D-38补Agent三视图共享、候选读取及复核动作判定。

两目录由 `deliver-offline-private-deployment-and-operations` 创建，尚未同步主规格。本 delta 使用 ADDED Requirements；先归档/同步前置成果再同步本 change，不替换不存在的主规格 Requirement。

## Impact

- **依赖**：前置 change 工件及实现、C03–C36 已归档规格、adopt-mineru-document-ingestion 的真实转换。评分规则走配置包分支，不创建 C19 第二个 knowledge-authoring 定义。
- **所有权**：仅补当前功能验收及已批准范围内缺陷，按 IP-17–IP-22 施工图。完整跨 VM host、签名/原生平台安装、禁网和硬件证据移交 C38；不开放远程正文证明协议。
- **公共契约**：复用strict Schema、C06/C04与人工确认；D-36新增原件DTO/GET、可选原文件名及Web直接pdfjs-dist@6.3.289依赖，D-39新增适用规则集组装窄命令/端口及HTTP入口，无迁移或pnpm别名。
- **RI/RA**：覆盖 RI-S1–RI-S6、RA-S1–RA-S7 和完整追溯；合成样本明确待甲方复核，不宣称甲方验收或真实工程准确率。
 - **当前操作**：D-50七门槛及活动代际、D-51五资料绑定保持，D-53控制与领域授权接线已部署v59，HTTPS19443。真实C06预检通过控制/执行身份及正式准备读取，所属工程验证通过；旧父的发布/范围、策略缺项和C21读取问题按已批准D-54实施中。原父仍identification/retryable-failure、游标和任务数10保持，未重试或修改预算。详见[D-53记录](evidence/identification-domain-authorization-2026-10-15.md)。没有识别/评估终态，tasks仍5/19。不修改执行图/Orca，不提交或归档。规划基线固定为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`；已有dirty是显式前置叠加层，不能把HEAD当作包含所有实现的检查点。
