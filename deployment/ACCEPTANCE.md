# RiskFlow 当前功能验收

已实现工程成果由 [deliver-offline-private-deployment-and-operations](../openspec/changes/archive/2026-10-13-deliver-offline-private-deployment-and-operations/proposal.md) 保留；剩余真实功能与完整桌面取证归 [complete-private-deployment-functional-acceptance](../openspec/changes/complete-private-deployment-functional-acceptance/proposal.md)，接续入口为该 change 的 [handoff.md](../openspec/changes/complete-private-deployment-functional-acceptance/handoff.md)。工程任务与功能任务分开，后续使用真实 API/Worker、数据库/索引/工件及批准模型核验业务终态、权限、预算、审计和追溯。

合成材料 V1 保留历史来源，MinerU 新转换使用 V2 合格投影及其真实资料版本，见下文。样本均标明“合成样本，待甲方复核”；实际报告只能证明其适用范围，不证明真实工程准确率。

## 当前接入

2026-10-17当前任务17/19，运行v173/000059；真实桌面全部14场景由完整批次13项与SSE定向结果分别闭合，可见Chrome正式确认/拒权/跨页追溯及同次functional PASS已取证。原失败报告保留，未声称单次完整14项或最终monolithic verify exit0。详见[本轮批量收口](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/batch-closeout-d189-d190-2026-10-17.md)及[112 Requirement/213 Scenario索引](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/scenario-index-2026-10-17.md)。固定Git检查点及最终verification仍未完成，C38未计通过。

当前减负实现与回归记录见 [reduce-defensive-design-overhead](../openspec/changes/archive/2026-10-16-reduce-defensive-design-overhead/handoff.md)。运行清单按阶段准备配置，资料访问独立记账，检索按当前可见条目筛选，确定性组装复用已批准来源。切换现场前按运维说明备份、执行000059并部署兼容版本，再接续原工程的已完成成果。下文带日期的工程核验保留当时记录，当前运行约束以该change及其实际实现为准。

资料原件与Agent入口修正的当前平台实跑见[2026-10-15取证](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/original-and-agent-ui-2026-10-15.md)。资料详情默认原件：PDF/图片在应用内查看，文本严格解码，DOCX/XLSX保存原文件后用本机软件打开。解析失败不阻止受权原件读取。正常业务页从“打开停靠区”进入Agent，任务详情可续页查看行动、候选校验和预算。该修正不代表整个RI/RA及桌面场景已经通过。

聊天使用中国区 MiniMax M Plan：`https://api.minimax.cn/v1`、`MiniMax-M3.1-Flash-Preview`、`reasoningEffort=low`。结构化模式由精确部署显式指定：`schema-prompt`把同一Zod生成的JSON Schema加入固定提示；`function-call`将其作为唯一`emit_result`函数参数，仅接收正常`tool_calls`或`stop`终止的单次函数调用并按原Zod严格复验。函数只承载结果，不执行工具，不发送未声明的`tool_choice`/`strict`。非法JSON、额外字段、正文混入、多调用、截断或验证失败均拒绝，不修补、自动重试或换模式。新模式须先保存真实协议及原响应证据；当前服务不声明服务端strict JSON Schema能力。

Embedding 使用 `http://192.168.13.11:11434` 的 `qwen3-embedding:4b`，原生 `/api/embed`、`truncate=false`，无需密钥。启动核验 Ollama 0.40.0、模型摘要、40960 上下文和 2560 维。模型身份变化必须新建部署及检索代际。

[model-gateway-config.example.json](model-gateway-config.example.json) 展示两项部署结构。引用名和预算是配置示例；实际运行必须固定本次批准配置，不能把示例当作协议资格或业务版本的证据。MiniMax 的 1M 上下文及供应商 512Ki 输出上限不等于单项 RiskFlow 任务预算。密钥只经服务端受限文件加载，不能放入公开 JSON、浏览器或命令参数。

## 运行前置

2026-10-14 的代码准备、工程证据及实机输入清单见 [本次准备记录](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/readiness.md)。桌面验收已定义完整场景；真实模型业务、Electron、可见 Chrome 和故障/恢复仍须实跑取证。

桌面预检读取 `RISKFLOW_DEPLOYMENT_CONFIG`、`RISKFLOW_RELEASE_MANIFEST`、`RISKFLOW_DESKTOP_BUILD_CONFIG` 与 `RISKFLOW_DESKTOP_ACCEPTANCE_CONFIG` 指定的真实文件。验收 JSON 的字段及本次正式回执绑定见准备记录；`functionalReportFile` 必须指向同次 `functional.json`，相邻 `synthetic/run.json` 不得换用历史报告。运行、查询、资料及导出工件须在对应正式回执中成立。管理员测试账号还须具备同一工程的业务读取授权，纯系统管理员不能读取业务报告。

“关窗后任务继续”先执行，要求本次运行已受理且尚未完成；已完成、等待人审、失败或取消不能替代。SSE 样例须有游标后的正式事件；TLS 拒绝目标须真实可达且证书不可信，DNS/连接失败不能替代证书拒绝。撤权场景仅修改隔离工程成员，随后恢复其 active 状态。

若活动评估运行的正式事件不足以满足SSE的2+2前置，可在桌面验收输入显式声明`sseIdentificationRun: { workflowRunRef, readSnapshotRef, sourceVersionRefs }`。事件流身份与C33状态快照分别固定，必须属于同一运行实体；测试先通过当前会话的C33正式读取核对精确快照及completed，再对事件身份执行两次订阅。不得改变两次订阅的身份或放宽游标/事件/零写断言。关窗场景继续使用本次活动提交，证据分别记录。该字段仅用于测试样例，不改变产品订阅范围。

`functional-run-config.example.json` 展示运行与五类 Agent 的观察结构。示例步骤名需逐项绑定本次运行计划的真实 `stepId` 与 captures；旧基础 run-config 示例未包含这些任务，不可直接拼接后声称完整配置。正式建议、执行/反馈、审计与 C04 全链另由所属查询补证，三类观察器不接受任意 DTO 的通用 status。

1. 检查合成包：`pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1`。
2. 完成显式初始化及迁移，准备真实授权工程、空间、原始资料及元信息工件。正式资料登记消费已存在的工件；当前 HTTP 没有上传/转换入口，不能把登记回执当作资料已完成转换。
3. 按原 Schema 导入并审核业务定义及运行策略。模型只接收有资格的资料正文，`expected.json`、场景标签和验收报告不得作为模型输入。
4. 为 PDF、扫描 PDF、PNG/JPEG 与 DOCX 提供 MinerU 官网精准 v4 配置和专用 token；MiniMax key 不能用于 MinerU。XLSX/CSV 使用原生解析。官网实际 ZIP 必须核验后冻结消费字段，未知结构严格拒绝。
5. 装配完整生产 provider 后启动 API、独立 Worker 与同源 HTTPS Web。依赖缺失或策略漂移时不得声明就绪。

`scripts/deployment/start.mjs` 已提供完整 API/Worker 工厂与显式启动 CLI：`node scripts/deployment/start.mjs --role api|worker --config <真实部署配置> --manifest <同发布清单>`。启动核对已完成的初始化与迁移，不自动引导或迁移；发布清单亦可通过 `RISKFLOW_RELEASE_MANIFEST` 指定。正式初始化库的装配回归通过，真实业务、HTTPS Web 及可见浏览器验收仍须使用本次实际部署及批准输入取证。

## 本次拆分核验（2026-10-13）

原 change 的已实现工程任务整理为 43/43，新 change 的 14 项剩余任务尚未执行。两个 change 的规格、设计、施工图和任务同步划分范围；当前宿主仍只开放 synthetic-acceptance 合置本地 C04，完整 remote host 交 C38 F-03，不能因 adapter 已存在而宣称可启动。

本次工程复验：14 个部署/图/终态观察定向套件 383 项通过；`pnpm test:deployment` 20 个套件 408 项通过；模型/评分包/所属 adapter/API quality/Web 确认另 14 个定向套件 245 项通过。三批存在重叠，不累加为全仓覆盖。`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、依赖边界/政策、两个 change strict、本轮 Markdown 格式及 diff 检查均通过。

归档收口轮 `pnpm test:browser` 为 87 passed / 1 flaky（exit 0，14.6 分钟），唯一 flaky 为慢读/切工程取消断言首次 `aborted = 0`、重试通过；前一轮的 86 passed / 2 failed 与重评确认按钮首次、重试均失败已如实保留在归档 verification 中，两项同归 IP-21。全仓 strict 收口轮为 33 passed / 12 failed（45 项），全部为 >500 字长正文警告，其中第 12 项由 C37 自身 delta 引入，IP-22 范围须显式纳入。

C37 工程 change 已归档，结论 PASS：固定检查点 `9432a3f` 与独立限定审计（独立会话 Targeted Auditor，VERDICT PASS、无阻塞项）均已闭合归档门；主规格同步提交 `4fb9b09`，结论更新提交 `07c9184`。审计另确认重评确认按钮属产品缺陷——`ConfirmButton.css` 的 `.confirm-dialog` 缺 `max-height`/`overflow`，对话框溢出视口时真实用户同样点不到主确认按钮，按产品缺陷归 IP-21。旧 88/0 仍不能替代上述结果。

## 证据与命令

| 证据                   | 命令或入口                                                                                                                                            | 能证明什么                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 材料静态检查           | `pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1`                                                                           | 材料契约、文件和引用完整性                                           |
| 模型协议测试           | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts`     | 映射、校验、预算和失败边界                                           |
| 真实模型 adapter smoke | `RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`                              | 真实结构化生成、Embedding、会话流及 C04 响应证据；不等于生产业务验收 |
| 正式业务终态           | `node scripts/acceptance/functional.mjs --pack references/acceptance/synthetic-v1 --config <functional-config.json> --output <新证据目录> [--resume]` | 同次运行的正式只读终态和必需引用；等待人审、超时或缺引用不能 PASS    |
| 可见浏览器             | 当前桌面 Chrome，连接上述生产 HTTPS                                                                                                                   | 登录、业务页面、正式人工确认、权限、重试与跨页追溯的实际行为         |

2026-10-12 的定向工程回归通过 4 个测试文件、95 项测试：

```sh
pnpm exec vitest run scripts/deployment/lifecycle.test.mjs scripts/acceptance/functional.test.mjs scripts/acceptance/synthetic.test.mjs packages/adapters/test/deployment/observability.test.ts
```

本次验证覆盖五类 Agent 的合法完成产出及同次任务身份、投影报告事实的运行归属，以及探针、API 关闭和在途 Worker claim 的截止行为。忽略取消信号的探针不能阻塞观察；API 关闭或 claim 未完成时返回未收口，不能作为停写证明。停止后晚到的租约不再 dispatch，按原租约恢复语义处理。修改过的脚本通过 ESLint、Prettier 检查。

质量门禁的 retrievalQuality 配置已在当前 design/spec/施工图闭合并实现：API/Worker 连接前加载精确数据集，拒绝错工程/版本、路径越界、符号链接及正式实例的合成数据；实际容器身份和总截止来自受控配置。报告在 logRoot/retrieval-quality 经文件及目录同步保存，不能以保存失败的报告通过。部署配置、入口、组合、预置和发布回归 5 个文件、103 项测试通过；新增报告目录符号链接用例后的入口回归为 43 项通过。

C28 已补齐按运行时已验证策略创建预测执行器的窄口，既有数组调用方保留。入口、assessment 组合与两份预测 adapter 测试的定向回归 4 个文件、106 项通过；执行器身份不符与核验前禁止解析另经真实 PostgreSQL 与工厂路径 42 项测试通过。

SSE 运行事件读取已按 D-21 接线：迁移 000057 只登记引用关联并以同事务触发器与工程顺序锁写入，reader 固定 64 条批量、按精确工程/run/version 游标推进，由当前 human-session 为每条事件重新签发授权并复验主体。相关回归覆盖 workflow 侧 4 个文件、62 项，HTTP/API 侧 3 个文件、51 项，基础/配置/入口/预置/API 组合 5 个文件、98 项，以及真实 C06 auth 24 项（同事务登记、并发序号、历史回填与 redacted 拒绝）。这些仍是工程回归。

评分治理工厂已提供措施发布读取器，逐精确引用派生下游授权并复用 C19 正文读取。入口与 assessment 组合的 68 项定向测试、API/Worker TypeScript 构建、相关 ESLint/Prettier 及 OpenSpec strict 校验通过。

检查点上下文已贯通三图的调用与恢复入口，读取使用本次授权；评估 A0 已删除未登记 seed，由真实入口登记及受权窄读恢复快照。迁移 000058 允许既有 A0 登记保存入口引用，启动身份复用带精确 run/thread 的正式命令收据。这些改动已通过 PostgreSQL、契约和 Worker 定向工程回归。

2026-10-13 部署配置任务 2.1 已闭合：配置/发布测试 33 项、入口测试 51 项通过，覆盖真实文件加载、职责秘密集合及非法配置/错误发布/缺失或权限过宽秘密的失败闭合。C27 候选精确父运行证明回归 14 项、C03 与两个子图回归 66 项通过；C06 只读下游授权回归 24 项通过，验证连续读取不增加上下文和审计。子运行启动审计保存精确父引用，不依赖子图收口后才登记的链边。以上均属工程证据。

2026-10-13 拆分前策略任务 4.1 的历史记录（当时 34/44）：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/entrypoints.test.mjs` 当次 81 项通过。十六类策略使用原 Schema、精确版本及不可变正文；目录与数据集共用受控根内文件读取，读取前与流式读取均限制大小，拒绝链接、越界和非法 UTF-8。示例目录改为 dataRoot/policies/catalog.json。

检查点只读证明已补齐本地 C04 verifyContent、C15 准备、C24 识别登记和 C30 阶段/路线/错误/结果接缝。普通 C04 open 保留访问审计；证明共用权限、路径、长度及摘要核验而不写访问记录、诊断、回执或审计。`pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` 42 项通过；C03/C24 的后续定向回归 36 项通过，加入全库审计/回执/访问/工件/事件计数不增断言。C15/C30 定向回归 56 项通过。生产 validator 已组合本次 C06 来源及当前权限、工程图版本、原启动主体/授权和精确父子收据，并复用识别入口身份派生；宿主入口回归 72 项通过，覆盖四种 checkpoint 操作、身份漂移、撤权、技术错误及未支持引用。尚未装配完整宿主或闭合所有领域引用，以上不作为生产就绪、业务终态或浏览器验收证据；远程 store 缺正文证明能力时拒绝。

C27/C29 宿主模型步已读取所属模块的真实冻结输入，并接入评估组合返回的共享 runner callbacks；当前持久授权、来源版本、精确空间、原任务绑定和无工具边界保留。候选及增量交真实 C04 persistArtifact，确定性校验与最终收口进入原任务作用域。`pnpm exec vitest run scripts/deployment/calibration-task.test.mjs scripts/deployment/response-model-step.test.mjs scripts/deployment/assessment-composition.test.mjs` 58 项通过。C19 成员、C24 路线、C30 空间配对相关组合与真实风险输入 reader 回归 73 项通过。以上模型步测试使用合成端口，尚未证明共享 runner 在完整宿主中完成真实推理和业务终态。

C24 检查点工作项已复用本运行冻结工作计划登记与 C04 verifyContent，缺计划、错版本、异运行、脱敏或范围收窄拒绝；真实 PostgreSQL/C04 套件 14 项通过，加入脱敏后同一纵向证明单项重跑通过。成功和损坏正文失败后审计、回执、访问、工件、Outbox 计数均不增加。宿主入口更新至 76 项通过，包含三图 Agent 任务引用与已登记子入口的父子证明；C08 真库套件 11 项通过，覆盖等待/终态任务、精确版本/父运行/主体、撤权/脱敏/范围收窄与零写、不读正文。`NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc -b apps/api apps/worker --pretty false` 通过，默认 4 GiB 堆的同命令曾内存耗尽；格式、lint 及 OpenSpec strict 校验通过。

C24/C30 完整等待登记证明已接到三图，按完整等待对象及工程/运行/主体/范围有界窄读，不枚举历史或新增事实；两份真实 PostgreSQL 套件 42 项通过。C07 复核任务证明共用任务状态解析，核对原主体和完整父运行，不读决定正文；真实复核套件 25 项通过。标准化风险记录复用纯 SELECT record-read，并额外复验未脱敏当前授权与精确识别运行；入口及真实识别读面回归合计 94 项通过（入口 86 项）。C22 候选/合并计划/组证明已组合原严格正文 Schema 与 C04 verifyContent，先证明冻结输入/计划；组合与入口回归 124 项通过（组合 38 项、入口 86 项），原 C22 核心与当时入口回归 143 项通过。最新 API/Worker TypeScript 构建、相关格式/lint、当前 change strict 校验及 diff 检查通过。

上述结果仅是工程回归。生产 checkpointer 的全部所属模块引用验证、完整 host 及真实 Web/Desktop 业务验收仍未完成。当前没有新增真实生产业务、可见浏览器或 Desktop PASS 证据，不据此完成 5.2/16.1–16.3；当时 tasks 为 34/44；当前拆分状态见上文。

API/Worker foundation 已按独立 checkpointer 角色构造原 saver，并将 end 纳入资源关闭；缺引用校验函数或独立密码在数据库连接前拒绝，provision 保持原职责。入口、预置和组合回归共 138 项通过（入口 89 项、预置 11 项、组合 38 项），相关格式/lint、当前 change strict 与 diff 检查通过。此处只证明装配与前置拒绝，完整宿主运行和真实 saver/领域证明闭包仍须后续取证。

2026-10-13 评估侧十类引用已提供所属模块只读证明并接入宿主 validator：C25 输入/评估记录、C26 预警/历史任务、C27 正式建议、C28 预测/执行/反馈、C29 已落库偏差/校准建议。C30 只证明本运行精确链边或 A0 冻结输入；领域正文、原 Schema/摘要及完整当前授权/空间版本由各所属模块证明。A6 任务在建议链边产生前，经已证明的评估记录及 C26 原任务—预警关系核对历史任务版本。父图转发先核验 C03 精确子入口；预测独立运行不当作评估运行。首次输入及知识准备/用户确认的 put-writes 使用旧 tuple 与已提交模块登记，不能要求新引用已出现于旧状态，也不能用待写数据代替正式事实。

相关完整工程套件分别通过：C30 28 项、C25 38 项、C26 19 项、C27 15 项、C28 34 项、C29 22 项、宿主入口 109 项，共 265 项。六文件首次合跑中的 C29 两项初始计数受新增夹具影响；新增用例移到初始计数用例后，C29 全套 22 项重跑通过。新增历史任务/偏差版本及预测独立运行身份列漂移的三项定向检查通过；各证明用例核对审计、回执、工件、访问与 Outbox 计数不增加。命令为各 `packages/adapters/test/{workflow,risk-assessment,warning,recommendation,response-lifecycle,calibration}/postgres-*.test.ts` 的真实测试路径及 `scripts/deployment/entrypoints.test.mjs`，具体命令按当前施工图 IP-05/IP-16 记录。API/Worker 的 8 GiB TypeScript 构建及相关源码/测试格式、lint、当前 change strict 校验通过。

校准引用时序已按批准方案修正：A3 只冻结输入，A4 正式建议提交后经 C29 受权窄读取得该建议创建时的 pending 偏差版本，再一次登记精确引用、游标及 feedback-deviation/deviation-calibration。Agent 等待、失败、正式建议失败和缺创建记录均不登记未成立引用；后续复核不改变创建版本。评估运行套件 17 项通过，含实际检查点状态断言。

三图 createDeploymentGraphsV1 已在真实 PostgreSQL 初始化库完成构造、五类共享任务注册、所属检查点证明绑定及关闭。测试走正式 initializeDeploymentV1，运行角色仅读迁移账本；修正 C20→C21 查询输入的方法映射为现有 readExact。该构造测试不调用模型、不监听 API、不运行 Worker，也不证明正式业务终态。当时 当时仅完成三图构造；后续完整宿主工程装配已完成，真实业务与可见 Web/Desktop 验收尚未完成，以上均不构成生产 PASS。

2026-10-13 完整 API 宿主 createDeploymentApiV1 已复用同一三图与全部必需 provider，C34 使用同一 C25 engine，C30/C33/C20/C36 均经原公开读口接线。正式初始化库用例完成管理员引导、登录改密、工程授权、真实 HTTP 缺计划业务阻断与注销后拒绝，以及测试端口显式监听和关闭；实际 PostgreSQL/工件目录探针通过，模型探针在受控 HTTP 夹具验证状态、重定向拒绝及取消。模型版本只取五类任务定义与批准配置；服务可达不代表已验证加载版本或推理。riskIdentification.plan 使用本次身份读取已登记计划，缺失/漂移/错主体/撤权及空间、来源缩减均拒绝；重复读取不新增计划。

共享任务运行组合 createDeploymentAgentRunnerV1 注入完整 runTask 作用域，工具执行、候选校验和收口沿同一原任务来源；作用域失败保留原未确认租约恢复，知识编制失败继续经所属 settleAuthoringFailures 收口。正式初始化库空轮询只证明装配与有限调用，不是 Agent 业务完成证据。命令 `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/api-ports.test.mjs scripts/deployment/lifecycle.test.mjs apps/api/test/http-shell.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/agent-runtime/runner.test.ts` 六套件 214 项通过；8 GiB API/Worker 构建通过，相关格式/lint 通过。完整 Outbox Worker 尚缺事件→父运行精确定位与短事务耐久消费回执；inputs-ready 同时含识别和评估准备，独立无父运行事件的投递语义待闭合。tasks 仍为 34/44。

2026-10-13 Worker 事件语义及宿主已补齐：C30 受权窄口只沿正式因果/精确链边和 C03 启动收据定位，暂缺与冲突保持失败重投；消费只认已提交输入、阶段与运行状态，取消态及单独路由不能确认。长图在原 consumer 事务外推进，回执事务内复验；图提交而回执失败后重投补回执。验收入口先核对精确子版本/取消态，重复路由不再追加。assessment 准备与精确 C06 人工独立来源保存无匹配后台运行回执。真实宿主绑定 C20/C24/C26/C30 五消费者，七类原显式无消费者事件保持登记；投影未完成和未知事件不伪造回执。Agent/Outbox 独立轮询，原投递策略与并发预算保持；租约失效不确认，drain 超时不释放仍在用的资源，关闭后拒绝再 claim。

本轮八套件 261 项通过：`pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts scripts/deployment/entrypoints.test.mjs scripts/deployment/risk-flow-composition.test.mjs apps/worker/test/risk-flow/runtime.test.ts scripts/deployment/lifecycle.test.mjs scripts/deployment/composition.test.mjs apps/worker/test/agent-runtime/runner.test.ts scripts/deployment/api-ports.test.mjs`。正式初始化库包含完整 API/Worker 工厂、真实 C06 登录/权限和原 Outbox 空轮询关闭；该用例不调用模型、不执行完整业务。8 GiB API/Worker 构建、相关 ESLint/Prettier、当前 change strict 和 diff 检查通过。这是拆分前 34/44 的历史工程记录，不作为真实业务或 Web/Desktop PASS。

当前运行前置核对：旧功能实例临时目录已消失，原 PostgreSQL/Qdrant 容器已停止，无实际 API/Worker/HTTPS 业务入口；本机未找到可用的完整部署配置、同发布清单与业务运行配置。Ollama 批准版本/模型的只读探针可达，不能替代完整部署。环境中的模型/转换 token 不输出，也不自动替代受限文件加载契约。下一步须选择实际环境并生成/提供这三份配置后重新取证。

本轮定向命令 `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs scripts/deployment/assessment-composition.test.mjs packages/adapters/test/calibration/postgres-calibration-adapter.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/assessment/composition.test.ts apps/worker/test/risk-flow/acceptance.test.ts` 共 7 个套件、245 项通过，包含真实初始化库、C29 创建/后继/复核版本与越权零写，以及反馈分支等待/成功/失败。`NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc -b apps/api apps/worker --pretty false`、相关 prettier/eslint、当前 change strict 和 diff 检查通过。

网络 smoke 的公开配置路径使用 `RISKFLOW_MODEL_GATEWAY_CONFIG`，受限秘密定位文件使用 `RISKFLOW_MODEL_GATEWAY_SECRETS`。报告保存部署、模型、配置、正式对象、审计及 C04 引用和命令，不记录密码、Cookie、密钥、正文或模型内部思考。模型 smoke 使用隔离测试存储时必须明确这一边界。

可用 `RISKFLOW_NETWORK_API_SMOKE_REPORT=<新报告路径>` 将真实 smoke 报告写入新文件，已有文件不会覆盖。2026-10-11 的三能力检查已通过：结构化生成 303 token、Embedding 29 输入 token／2560 维、会话流 26 个增量／288 token。该次使用隔离 PostgreSQL/C04 测试存储，未验证生产授权；报告中的测试工件引用不作为生产业务追溯证据。

2026-10-11 的隔离功能实例曾完成 000056 初始化、checkpointer setup、职责角色登录及初始化重放；通过正式 C06/C11/C04 入口登记工程、空间、适用性快照，并完成 10 份 DOCX 与 12 份 CSV 的来源登记和转换。第一份 DOCX 的 JSON-LD 曾完整读取、核验 `verified` 并通过原 Schema，共 3 个资料段。原临时证据目录 `/tmp/riskflow-functional-runtime-OuUmoX/` 当前已不存在；上述仅为历史执行记录。正式收口须在当前宿主重新执行并将报告保存到交付证据目录。

上述旧 DOCX/PDF 准备证据来自原转换器，不能改标签作为 MinerU PASS。采用 MinerU 的资料通过正式新资料版本重新准备，并重建清洗、知识和检索输入。已用环境中的 MinerU token 取得五类官网探针结果包：官网布局为 3.4.4，独立于自托管 4.0.12 的 Middle 2.0；探针仅证明协议和字段，尚不能代替生产 C04/资料段/质量与完整业务验收。完整策略及 API/Worker 装配的完成情况由 C37 独立核验，资料准备不能计为浏览器业务验收通过。

2026-10-11 的 MinerU parser smoke 使用真实官网API和隔离受限文件存储回读：文本PDF、PNG、JPEG、DOCX通过转换检查。以最终代码回读真实响应并经共享JSON-LD/资料段生成与合规校验，分别得到22、4、5、3个资料段；回读证据目录为 `/tmp/riskflow-mineru-final-replay-8VLkFA`（临时隔离存储，非发布工件）。扫描PDF返回13页，只有10页有正文，按非空页比例1的策略拒绝。核对原件可见被遗漏页面有正文，不能剔除页面或降低门槛来标记通过。本次示例配置的关键字段清单为空，不计作完整内容质量验收；服务原始证据和规范化结果分别保存在权限受限的临时目录，尚无生产资料版本/数据库登记引用。

同日按原配置重试扫描 PDF，新批次仍返回 13 页、10 页有正文，第 2、3、9 页的 `para_blocks` 无文本；两次 `layout.json` 内容完全一致，重试证据为 `/tmp/riskflow-mineru-smoke-VNnk0C`。第 3、9 页的 `preproc_blocks` 有文字，`para_blocks` 带 `lines_deleted`，相邻前页含 `cross_page` 文本；应区分跨页合并与实际漏识别，不能把空正文页统一解释为物理缺页。官方 CLI 使用同一 VLM/OCR 单独请求第 2 页也未得到 Markdown。进一步无重采样提取第 2 页内嵌原图，以同一生产 parser 和端点独立转换：返回标题但未识别图中可见的 `SYN-DEV-SEG-001-GEO`、`SYN-DEV-SEG-002-GEO` 资料行，原始 Markdown 也缺失这两行。原图及响应分别保存在 `/tmp/riskflow-mineru-image-retry-syMgom`、`/tmp/riskflow-mineru-smoke-tKlDs4`。该图片因关键字段清单为空而通过非空检查，不计完整内容验收；扫描 PDF 仍未通过，质量门槛保持不变。

进一步检查发现合成生成器 `_text_page` 将 `insert_textbox()` 的正返回值误判为溢出；[PyMuPDF 官方说明](https://pymupdf.readthedocs.io/en/latest/shape.html#Shape.insert_textbox)明确非负值表示成功及剩余空间，负值才表示放不下。本地短行实测返回 `28.98046875` 且文本已写入，旧生成器因而把 12 条记录排成 13 页并重复写行。未覆盖旧样本，仅用相同内容、字体、150 DPI 和服务参数生成正常分页的临时一页对照件 `/tmp/riskflow-mineru-pagination-probe-i1d0l8tb/geology-report-correct-pagination.pdf`。其真实响应 `/tmp/riskflow-mineru-smoke-fX6tjI` 中的 13 个 `interline_equation` 块覆盖表头和 12 条记录，去空白后的原始公式文本包含全部 12 个资料段 ID；当前官网映射未覆盖该块类型，返回 `MINERU_PROTOCOL_INVALID`。关闭公式识别的独立 CLI 对照仍返回 LaTeX，不能作为修复结论。后续须分别修正样例生成、补齐实际输出映射、验证原页定位及关键字段，不能以该临时对照替代原件验收或声明生产通过。

真实检查命令为 `MINERU_REAL_SMOKE=1 pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts`；通过 `MINERU_SMOKE_CONFIG`、`MINERU_SMOKE_INPUT`、`MINERU_SMOKE_MEDIA_TYPE`、`MINERU_SMOKE_INPUT_KIND` 显式选择配置和资料。token从环境中的 `MINERU_TOKEN` 读取，不写入命令参数。默认测试跳过真实调用，skip不计外部验收通过。

分页和官网原页映射修复后，五格式源字段验收命令为：

```sh
MINERU_REAL_SMOKE=1 MINERU_SMOKE_SUITE=references/acceptance/mineru-v2/manifest.json pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts
```

2026-10-11 此命令5/5通过。清单版本2只从已有场景与源模板产生预期；文本PDF和扫描PDF采用新投影，PNG/JPEG/DOCX仍使用未改变的V1文件。每项冻结非空页比例1、关键字段覆盖率1及独立质量策略引用；记录关联与原页校验、共享JSON-LD合规完成后才记录completed。文本PDF、扫描PDF、PNG、JPEG、DOCX分别得到8/15/4/5/3段，记录检查分别6/12/2/3/2条。官网公式以原始LaTeX保留，去空白比较仅用于验收，不改写正文。原始响应与结果仍在受限临时目录，汇总见 [新投影验收报告](../references/acceptance/mineru-v2/acceptance-report.json)。

补充同源试运行扫描件的5页/60条记录真实检查，127个关键字段、全部记录关联及原页定位通过，共72段、JSON-LD合规；受限证据 `/tmp/riskflow-mineru-smoke-Lp9925`，诊断清单 `/tmp/riskflow-mineru-trial-suite-rsaiw7y3/manifest.json`。旧扫描样例响应使用最终映射重放为12/13非空页，仍缺SEG-002-GEO，被质量门拒绝。上述证据证明隔离parser和JSON-LD功能；不代表生产C04/C11登记、完整业务终态、可见浏览器或本地硬件验收完成。

终态观察支持 Agent 任务详情、识别运行详情、评估运行详情和运行总览投影四种正式结果。观察必须与精确任务或运行引用匹配，并取得必需的正式主结果引用；其他查询 DTO、辅助引用、零结果缺少所需引用、人工等待和超时均不能 PASS。配置示例见 [functional-run-config.example.json](functional-run-config.example.json)。

复用已有正式结果时显式指定 `mode: "existing-formal-references"`，并以 `targets`
逐项声明 `stepId`、`resultRef`（`workflowRunRef` 或完整 `agentTaskRef`）、
`requestedSpatialScopeRefs` 和 `requestedSourceVersionRefs`，与 `observations` 一一对应。
此模式只登录并执行正式查询，报告标记只读证据来源，不产生启动回执；运行配置只需
查询会话字段。精确业务链、来源、模型、配置和审计另由正式查询索引逐边核对。
桌面在途关窗与重启续接仍须真实提交回执，不使用只读报告替代。

可见浏览器必须打开在用户正在观看的桌面会话中。无界面模式和虚拟 X 屏幕不能替代观看要求；浏览器可以通过 CDP 操作，但业务请求仍走原 HTTPS/会话/确认契约。

`pnpm test:browser` 的工程 harness 测试保留为回归证据，完整样例验收需另有上述生产宿主、网络推理和正式业务结果。现有 `deployment:smoke`、`deployment:benchmark` 只校验配置，不能计作场景或性能通过。

## 最终交付

签名、多平台正式安装包、禁网三 VM、本地模型/MinerU 介质与许可、4090/128GB 加辅助 NVIDIA GPU 的实测由 C38 独立取证。主卡运行 Qwen3.8-27B，辅助卡运行 MinerU 专用模型；embedding 默认保持独立 Ollama 主机。C38 必须比较同一标注样例的云端/本地转换质量、关键字段和后续结果，并测量双服务同时运行时的峰值显存/RAM、吞吐、延迟、排队和取消；官网功能 PASS 不证明本地质量、资源隔离或离线交付通过。后续功能 change 只有全部功能义务和必要审计完成后才可 PASS；原工程任务全勾不表示这些业务缺项通过。

# MinerU change 的验收范围

`adopt-mineru-document-ingestion`以转换器真实功能与受影响回归验收：五格式源字段/记录关联/页码、JSON-LD、质量阻断、权限/幂等/取消及耐久证据。本机CPU/Vulkan GPU基准为补充报告；完整浏览器业务归 complete-private-deployment-functional-acceptance，目标4090/Qwen双卡交付归 C38，不作为本change产品验收前置。全仓16项lint错误已修复。2026-10-11已部署MinerU 4.0.12固定服务并完成CPU/P4 Vulkan实测：两轮五格式的预热及各3次重复全部通过，五页扫描件亦完成各3次暖请求，127字段/60记录/原页/JSON-LD均正确。扫描件GPU加速约2.24–2.48倍，服务进程峰值显存1886 MiB；重启后真实PNG转换通过。GPU服务健康运行于127.0.0.1:18000，CPU实例已停止，模型与证据保留。操作见[服务说明](mineru/README.md)，计量与边界见[本机报告](../references/acceptance/mineru-v2/local-benchmark-report.md)。本change正式独立verification仍待最终Git检查点，未提交或归档。
