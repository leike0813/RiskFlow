# 资料原件浏览与 Agent 界面修正方案

状态：用户已批准并要求开始实施。纳入当前 `complete-private-deployment-functional-acceptance` 的 D-36–D-38，沿 IP-19/IP-21/IP-18/IP-22 实施。

## 目标与依据

用户从资料目录进入详情，应能确认自己导入的是哪份文件、哪个版本，并查看或下载该版本的原件。原件默认展示，解析与清洗事实作为辅助信息。Agent 停靠面板应从正常业务页面可达，呈现真实任务的执行记录、预算、候选校验和结果；无需用户手工输入内部路由。

已确认事实：

- C04保存原始字节；C11 SourceVersion持有sourceArtifactRef，不需要重新导入或重新转换。`resolveSourceVersionForRead` 已支持精确历史资料读取，不要求对应工程修订仍为当前版本。
- SourceItem已保存资料名称；当前目录DTO未返回名称。登记descriptor未独立保存上传文件名，旧记录不能声称存在准确原文件名。
- 当前资料详情只显示元数据、章节和段列表。主规格 `web/engineering-and-knowledge-ui` 的“证据抽屉必须经 evidence-access 呈现脱敏两态”明确禁止段原文；这是本次原件浏览需要新增的明确领域读取能力，不能偷用通用工件读取。
- 生产外壳使用RightDock，但main没有提供agentContribution；旧AgentDock未挂载。RightDock因缺证据上下文revision而在打开“上下文”后立即关闭，导致Agent标签也难以到达。
- `/agent` 与任务详情已有真实行动和预算；候选页仍返回404，尚不能将其归因为用户权限。需要通过真实C08数据与strict DTO定位并修复，保留真正无权的失败关闭。
- Electron主进程拒绝iframe、外部窗口与本机通用能力；`decideDownloadV1`存在，但main未挂下载事件。不能以浏览器原生PDF插件或自动调用本机软件作为已完成桌面方案。

无阻塞问题，基于以下假设制定方案：允许读取范围仍由当前C06工程、空间与资料授权决定；上传者在其资料授权仍有效时可读原件，上传行为不授予永久绕过撤权的权利。DOCX/XLSX通过原文件下载和用户自行使用本机软件打开完成本轮原件查看，不要求在Web中仿真Office。

## 用户界面

资料目录增加“资料名称”列，以实际SourceItem.name为主，资料ID保留在详情用于追溯。详情标题显示名称与精确版本，展示文件类型、大小、登记者和时间、解析/清洗状态，提供“原件”和“解析与清洗”两个页签。

默认打开“原件”。保留当前版本选择/深链，不自动切到最新版本；历史版本原件同样可读。解析失败或尚未清洗，只要原件已登记且当前授权允许，原件仍可查看和下载。资料段证据入口定位到原件的实际页码；没有真实页码的DOCX等只展示已有定位，不把转换块编号当原件页码。

| 原件格式               | 本轮行为                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PDF，包括扫描PDF       | 读取实际PDF原件字节，在应用内分页显示，支持页码、缩放、前后页；不会调用MinerU重新转换                              |
| PNG/JPEG等受支持位图   | 直接显示原图，支持缩放；不把SVG/HTML等主动内容内嵌执行                                                             |
| TXT/CSV                | 以纯文本呈现原文件内容，CSV不重算或重排；按明确编码解码，不能确定编码时提示下载，绝不静默改字节                    |
| DOCX/XLSX              | 显示文件信息和“下载原件”；用户保存后用Word/WPS/LibreOffice等打开，保留原布局和公式，界面说明当前格式需本机软件查看 |
| 无支持预览器的其他文件 | 允许已获授权的原件下载，明确显示预览不可用原因，不用转换结果代替原件                                               |
| 数据库/API快照         | 标为“导入快照”，展示真实来源信息并按已登记工件提供下载；不伪称上传文件或Office原件                                 |

新上传元数据在file-upload descriptor中增加可选 `originalFileName`；文件名只用作显示与安全下载名，不作为服务器路径。旧数据显示登记资料名，若原文件名缺失明确标出，下载名使用资料名加经确认的扩展名，不补造历史。无需数据库迁移：descriptor已有JSON持久化形状，strict Schema同步更新。

Agent入口固定在右侧停靠区“Agent”标签，增加可发现的任务列表与“打开工作台”；主导航维持七项。无选择时显示当前工程任务，选择后显示任务状态、安全行动摘要、累计预算及正式结果入口。侧栏、工作台、详情共用既有AgentTaskProvider，跨页保持选择，切工程/注销清空旧事实。

任务过程显示模型调用、领域工具及其版本、执行状态/时间、公开校验理由、候选版本、实际用量和最终结果。内部思维链、原始模型响应、受保护正文不显示。长行动记录按既有游标由用户续页；任务结束后仍可查看历史，不因关闭面板停止服务端任务。

## 原件读取接缝

新增资料专用窄读面，不开放任意artifactId、磁盘路径或外链：

1. `engineering-data.source-original-read`按当前会话、projectId及精确sourceVersionRef读取文件信息。复用现有 `engineering-data.read` 能力、C11历史读取及C04清单事实；新增分支映射与受控下游绑定，不增加角色权限。
2. 同源 `GET /api/v1/projects/:projectId/sources/:sourceId/versions/:versionId/original` 返回该已登记版本的二进制原件；`disposition=attachment`用于下载，缺省只允许安全文件类型的内联预览。GET拥有独立请求身份、当前会话与精确资料授权检查，不以URL可见性代替授权。
3. 来源绑定由C11解析，工件用途取真实登记清单，C04 open/完整消费/verified完成后才开始成功响应。大文件使用受限临时文件承接完整性核验和传输，finally清理，客户端断连中止；不另存永久原件副本，不加载整个文件到API堆内存。
4. 沿现有C04原件100MiB上限；本轮原件传输策略固定每API进程最多2次并发、暂存最多200MiB、单次读取与传输合计120秒，超过限制明确拒绝或中止，不由输入任意指定。暂存使用部署受控临时根、目录0700/文件0600，不把原始文件名用作暂存名，进程重启清理仅限自己登记的暂存对象。首轮不提供Range，PDF.js读取经过核验的完整响应并仅渲染可见页；不以部分读取规避C04完整性门。
5. 原件内容使用正确mediaType、Content-Length、Content-Disposition及安全文件名；响应no-store、nosniff。未知或可执行内容只允许下载。每次读取/下载沿C04已有审计记录精确资料/工件版本及主体，不创建第二套日志正文；原始文件名只在受权文件信息/下载响应中提供，不写入普通日志、错误或审计正文。
6. metadata和内容都不得依赖转换成功、清洗完成或Worker在线。账户有工程读权限但没有这份资料的来源授权时，元数据/内容按既有不可枚举规则关闭；撤权后下一次请求失败，客户端切工程/注销撤销预览与对象URL。已经看过/保存的字节无法被服务端追溯删除，界面不作此承诺。

新增GET二进制传输属于公开HTTP契约，需同步C09路由目录、错误语义及测试。原文件字段属于C11事实；原件viewer属于apps/web，API拥有传输与授权。Electron不读取服务器路径、数据库或模型。

## 复用与依赖

- 复用C11 sourceArtifactRef、`resolveSourceVersionForRead`、C04 readManifest/open/verified、C06授权与既有HTTP会话。
- PDF预览采用仓库已锁定的 `pdfjs-dist@6.3.289`，在apps/web显式声明同版本依赖并打包本地worker；官方来源 `mozilla/pdf.js`，Apache-2.0，随发布制品离线提供。不从CDN加载脚本，不把adapters服务端模块导入Web。退出条件为移除PDF预览，届时删除Web直接依赖。
- 位图/文本使用现有React和平台能力，不新增Office转换器、在线预览服务或本机IPC。PDF在Canvas上渲染，所需文本层保持选择/可访问语义；不放宽Electron iframe/object/new-window/Node限制。
- Electron下载接上现有 `decideDownloadV1` 和用户选择保存位置，仅允许批准origin的资料原件/既有报告下载路径；拒绝任意外域或路径。首轮不添加“自动打开本机文件”。
- Agent在RightDock注册真实贡献槽，提取复用已有任务摘要组件；移除不再调用的旧独立开关/未挂载外壳，避免两套面板状态。RightDock只在证据确实过期时清空证据；无证据不触发自动关闭，Agent跨页状态遵守已有shell契约。

## 文件与施工范围

批准后读取OpenSpec apply完整contextFiles，再将本方案决策写入design，新增/修改delta、更新施工图及任务依赖。生产实现涉及以下边界，精确计划文件在施工图逐个列出，不用通配符授权：

| 范围                    | 文件与动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IP-19：C11/C09原件契约  | `packages/contracts/src/ports/index.ts`增加窄读DTO/分支；`packages/core/src/engineering-data/context-source/schema.ts`增加上传文件名；`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`复用历史读取；`packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`投影实际名称；同目录新增 `source-original-reader.ts`接C11精确身份/C04清单与verified；HTTP目录/错误/二进制路由位于 `apps/api/src/http.ts`、`app.ts` |
| IP-19：真实宿主         | `scripts/deployment/composition/api-ports.mjs`、`scripts/deployment/start.mjs`装配原件provider及允许的下游分支；`packages/adapters/src/deployment/schema.ts`及部署配置示例固定原件传输预算与临时根；不开放通用工件HTTP                                                                                                                                                                                                                                                                                     |
| IP-21：资料界面         | `apps/web/src/api/client.ts`/`http.ts`/`operations.ts`新增原件读取；`DocumentListPage.tsx`/`DocumentDetailPage.tsx`及其CSS增加名称、原件默认页签；新增同目录 `DocumentOriginalView.tsx`，仅承载按格式展示、取消与清理；`apps/web/package.json`及锁文件同步已有PDF版本                                                                                                                                                                                                                                      |
| IP-21：Agent接线        | `apps/web/src/main.tsx`、`app/App.tsx`、`shell/AppShell.tsx`、`shell/dock/RightDock.tsx`注册真实槽并修开合/跨页；`agent/AgentDock.tsx`、`agentDockStore.ts`复用或删除无调用的重复实现；既有任务Provider/详情/API如需修候选投影，限其真实可复现行为                                                                                                                                                                                                                                                         |
| IP-19/IP-21：候选读缺陷 | `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`及既有测试，仅在复现strict字段/引用或授权问题后修改；不把404直接解释为权限不足，不关闭校验                                                                                                                                                                                                                                                                                                                                             |
| IP-18：桌面             | `apps/desktop/src/main.ts`接下载事件，`security.ts`限制来源/路径；原安全测试及 `apps/desktop/test/e2e/client.spec.ts`补原件下载、PDF分页和Agent三视图实际场景                                                                                                                                                                                                                                                                                                                                              |
| IP-22：规格与证据       | 本change proposal/design/implementation-plan/tasks/handoff；delta覆盖 `domain/engineering-context-source-registry`、`platform/http-command-query-sse-shell`、`web/engineering-and-knowledge-ui`、`web/agent-audit-and-operations-ui`、`platform/web-shell-interaction-primitives`及 `platform/electron-https-client`；验收/运维说明记录真实能力边界                                                                                                                                                        |

原件读取是新增能力，保留现有证据抽屉定位与脱敏约束，不将其改成通用正文入口。归档主规格本轮不直接修改，后续按正式sync/archive流程同步批准delta。

## 顺序与验收

先补原件来源/HTTP窄读及名称，再完成资料原件视图；同步修Agent开合与任务贡献接线、定位候选读取问题。C17准备范围/逐项身份及复核动作两份此前提案已随本方案批准，一并纳入施工图。

验收复用既有真实数据库、HTTP及browser/desktop套件，只增加稳定行为断言：

1. 同一已导入PDF/图片/文本能从目录自然进入原件视图，实际内容与登记原件一致；DOCX/XLSX实际下载字节与登记上传文件完全一致，原格式/扩展名保留。
2. 解析失败资料仍能读取原件，旧版本深链稳定；旧记录文件名缺失如实显示，没有重新导入、重写来源或触发转换。
3. 无资料权限、撤权、错工程/版本、损坏工件及超限均不能返回正文；读取有审计，取消/切工程不显示旧预览。
4. 从普通业务页自然点击打开Agent；空态有任务入口；选择本次清洗任务后侧栏/工作台/详情的精确任务、用量与结果一致，能续页看完27条已登记行动，候选校验可读或有真正的结构化拒绝。
5. 跨页不重新启动任务，切工程/注销清空、终态停止轮询，原单在途行为保持；不以force点击或放宽超时掩盖接线错误。
6. 在现有物理Chrome和真实Electron分别操作原件、保存下载及Agent；服务端真实权限/审计和同次结果留证后再继续RI/RA完整验收。headless和工程测试不替代此步骤。

批准后才进入执行、声明依赖变更和新的公开契约。无Git提交、安装升级、覆盖旧失败或自动扩大模型预算的授权。
