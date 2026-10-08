## Context

实施基线为 `08a3fed121635895dd4edb2f8c51cf689936d912`。Manifest 的 C35 直接依赖 C07/C08/C10/C31 已归档；代码复用 C06/C09/C32/C33/C34。当前工作树干净，分支并非编排要求的 main；本 change 起草不操作编排状态或 Git。

已核对的接缝：

| 现状 | 代码事实 | 本轮处理 |
|---|---|---|
| 已接线应用在 demo | `demo/src/App.tsx`、`api/client.ts`、`api/context.ts`、真实 browser server | 延续应用、会话和 React Router |
| v2 是独立设计原型 | `demo/v2/docs/page-manifest.json`、`src/pages/{agent,review,report,ops}`，无 API 层 | 移植布局/局部 CSS，替换全部事实来源 |
| Agent 写端口存在，UI 读面缺席 | `AgentTaskRuntime`、`PostgresAgentTaskAdapter.getTask/readTerminalFailure/readCompletedResult` | 增加所属模块安全窄读，不公开 getTask |
| 部分定义支持 interactive | identification-knowledge、scoring-rules 的 metadata；其它定义主要为 embedded | 原样遵守定义，不把五类任务都改成交互 |
| 复核队列真实，trace 只返引用 | `postgres-review-queue-read.ts`、`PostgresReviewAuditAdapter.trace` | 补精确详情与活动分页 |
| C31 报告数据存在，导出未实现 | `PostgresWorkflowProjection.export` 返回 unsupported；C04 支持 JSON 内容 | 实现原导出契约与专用报告读取 |
| 管理命令不走业务 branch | C06 `currentAdminActor/insertSystemAdministrationContext`，管理上下文 context_json=null | Cookie 派生的独立系统面 |
| health、连接生命周期、备份协议缺席 | API 无 health，v2 ops 数据为 fixture | 有界健康提供者；连接只读；恢复执行归 C37 |

权威输入为本 change 全部 specs、相关主规格和当前代码；v2 为视觉/交互输入。其 gap、样例身份和 contract-mirror 不替代当前契约。没有读取研究资料原件。

## Goals / Non-Goals

**Goals:** 将 Agent 可审计任务、五类复核、运行/活动/证据、真实 JSON 报告和 C06 六项管理动作接入同一真实应用；显式修补所需公共读接缝；保留历史版本、权限、预算、审计与性能边界。

**Non-Goals:** 通用自由聊天、持久化聊天会话、改变 Agent 定义/工具/预算或工作流阶段、UI 修改正式记录、PDF/DOCX、浏览器打印报告、连接管理/探测、模型配置发布/切换/微调、原始 Pino 日志、备份恢复执行、部署拓扑、apps/web 全量迁移。C35 交付说明必须列明这些界限。

## Decisions

### D-01 交付载体与 v2 复用

继续使用 `demo/`，沿用 C32–C34 的真实接线；不把 C35 单独迁到 apps/web 形成第二套跨页状态。v2 原件只读，按页面移植 JSX 分区与局部 CSS，改为 demo 的 AppShell、Card、DataTable、PageStateView、ConfirmButton、EvidenceLink/Drawer 和 React Router。仅在缺少对应组件时移植 v2 的无事实展示片段；不搬自写 history/router、PageScaffold 审阅层、content、contract-mirror、gap 覆盖层或依赖。

| v2 页面/部件 | 页面身份 | 交付路径与处理 |
|---|---|---|
| agent/AgentDockPage、agent-shared、shell/RightDock | P-AG-01 | `demo/src/agent/AgentDock.tsx`；停靠嵌入 shell，不增加独立 dock 路由 |
| agent/AgentWorkbenchPage | P-AG-02 | `/agent`；替换原静态工作台 |
| agent/AgentTaskDetailPage | P-AG-03 | `/agent/tasks/:taskId?taskVersion=` |
| review/ReviewQueuePage、ReviewDetailPage | P-RV-01/02 | 保留 `/review`，增加 `/review/tasks/:taskId?taskVersion=` |
| review/IdentificationReviewPage | P-RV-03 | `/review/identification/:taskId?taskVersion=`，仅选择已有修正候选 |
| review/EvidenceTracePage | P-RV-04 | 保留 `/review/trace` 的 C33 精确主题与分页 |
| review/RunRecordsPage、AuditLogPage | P-RV-05/06 | 保留 `/review/runs`，增加 `/review/audit` |
| report/ReportExportPage | P-AU-01 | `/reports/export` |
| ops/AccessPage | P-OP-01 | `/ops/access` |
| ops/DataSourcesPage、HealthPage、ModelVersionsPage、BackupPage | P-OP-02～05 | `/ops/data-sources`、`/ops/health`、`/ops/model-versions`、`/ops/backup` |

保留 demo 已有 `/project`、`/review` 等可达路径；不重写 C32–C34 导航路由。Agent 用 shell 现有按钮，系统管理用账号区辅助入口，报告用复核审计/态势内链接；都不新增第八项一级业务导航。系统路由放在 RequireSession 内、EngineeringGate 外，不能要求纯系统管理员先选工程。Agent 与报告仍在 EngineeringGate 内。

`taskVersion` 只表示精确任务身份版本，不冒充 C08 可变 stateVersion。复核深链以当前工程及任务实体/版本请求详情，由 C07 返回完整辨识联合。关联领域对象继续用 C33/C34 已有精确版本参数，不从 samplePath 构造对象。

### D-02 唯一 Schema 与端口

采用加法式窄读，不改原写端口或暴露内部 Store。公共 branch 映射在 `packages/contracts/src/ports/index.ts` 增加三项，不增加 capability：

| branch | capability | API port key / 方法 |
|---|---|---|
| `agent-task.read` | `agent-task.read` | `agentTaskRead.read` |
| `review-audit.read` | `review-audit.read` | `reviewAuditRead.read` |
| `projection.report-read` | `projection.export` | `reportRead.read` |

请求使用既有 schemaVersion=1 查询信封，内部仍有 actorId/projectId/queryId/requestedAt/authorization；payload.kind 为下文闭合操作。Schema 分别定义于所属 core 的 `agent-runtime/ui-read.ts`、`review-audit/ui-read.ts`、`workflow/report.ts`；API 引用这些唯一导出，权限/引用复用 contracts，不复制业务字段。这样能直接从 C08 原 Budget/Validation/Proposal Schema 与 C07 State/Activity Schema 派生安全投影，无需将内部完整信封搬进 contracts。系统 DTO 在 `access/administration.ts`，健康 DTO 在 `apps/api/src/operations.ts`。

contracts 将现有 `querySchema`、`moduleResultSchema` 分别以 `createModuleQuerySchemaV1`、`createModuleResultSchemaV1` 名称导出，所属 core 只通过这两个既有构造实现形成固定 read kind、闭合 payload 和对应分支能力，不复制信封或结果联合规则。它们不构成任何通用 HTTP 调用入口。

所有新目录 pageSize 为 1..50、默认 25；投影正文读取继续沿 C31 的 1..100、默认 50。列表 `items,nextCursor?` 不声明推测 totalCount。游标采用已存在的授权摘要与 keyset 模式，绑定工程、actor、筛选、固定 asOfRecordedAt、精确目标/候选与范围；未知字段、伪造或错配失败关闭。客户端不能修改游标内容或以页面索引续页。

未知 operation/字段→既有 UNSUPPORTED_CONTRACT/HTTP 400；无权/不存在/错工程→现有不可枚举类别；陈旧确认或目标→既有 STALE_VERSION/冲突；明确不可执行前置→BUSINESS_BLOCKED；存储/工件/解码失败沿既有 TRANSIENT_FAILURE/TERMINAL_FAILURE。没有新错误码或基于完整文案判断。

角色 branch 策略固定：工程风险管理员按原 allBranches 自动取得三条读面；reviewer 与 business-viewer 加入 `review-audit.read`，沿原 review-audit.read 能力读取获准主题；business-viewer 加入 `projection.report-read`，沿原 projection.export。field-responder 不新增 branch；系统管理员仍无业务 branch。其它角色不新增 Agent 权限，不能从关联任务引用反推读取权。新 branch 不改变原能力枚举或已有写权限。

### D-03 Agent 读契约与披露边界

`AgentTaskReadPortV1.read` payload 联合：

| kind | 输入 | 成功结果 |
|---|---|---|
| `list` | taskType?、公共 status?、parentRunRef?、cursor?、pageSize? | tasks 摘要、asOfRecordedAt、nextCursor? |
| `detail` | agentTaskRef | 精确任务摘要、budget、actions 可用性、当前提案?、resultRef?、safeError? |
| `actions` | agentTaskRef、cursor?、pageSize? | sequence 排序的安全动作条目及 nextCursor? |
| `candidates` | agentTaskRef、cursor?、pageSize? | candidateVersion 排序的候选与校验引用及 nextCursor? |
| `validation` | agentTaskRef、candidateVersion、cursor?、pageSize? | 接受/拒绝、checkId、rejectionClass?、reasonCode、获准证据定位与 nextCursor? |
| `launch-context` | sourceAgentTaskRef | supported=false+reasonCode，或完整原 StartAgentTask payload（triggerMode=interactive） |

列表摘要从现有 envelope/state 选择 taskRef/taskType/triggerMode、initiatorActorId、parentRunRef、frozenInputRef、createdAt/updatedAt 与 mapAgentInternalStatus 输出；列表不含输入正文或提案。detail 的 budget 直接引用 C08 `AgentBudgetUsageV1Schema`、`AgentTaskBudgetPolicyV1Schema`、`AgentBudgetLedgerV1Schema` 的结构化字段：分别显示 used、reserved、activeWallClockMs、currentConcurrency 和各原 max 上限，不合并 input/output/context token 为一个虚构总上限。taskRef 本身已有模型/提示/工具/预算/增量/校验版本；不生成假版本元数据。

安全动作从 `AgentTaskActionV1Schema` 选择 actionId、sequence、type、status、toolRef?、intentArtifactRef、observationArtifactRef?、resultRef?、结构化 errorCode? 与实际时间/usage（仅原事实存在时）。不得返回输入/观察正文、租约、恢复令牌、模型输出或命令工件正文。工具名使用精确 toolRef 与注册的安全显示名，无显示名时显示引用；不对未登记拦截行动补造成功/blocked 行。

候选选择 `AgentCandidateVersionV1Schema` 中版本、candidateArtifactRef、incrementArtifactRef、validationArtifactRef?、disposition/rejectionClass?、createdAt；增量的业务摘要只由已注册任务定义安全显示映射提供。无映射时只显示类型与引用，不通用遍历候选 JSON。校验页从原验证结构按 checkId/原数组位置稳定分页，引用不可见则整页安全失败，不伪造校验值。

proposal 仅从 `current_proposal_artifact_ref` 指向的 C04 已耐久 `AgentCommandProposalV1Schema` 选择 commandProposalRef、taskRef、targetRef、expectedTargetVersion、expectedEffect、externalEffects、proposedAt；隐藏 commandArtifactRef 与命令正文。读取前复验当前权限且限定同工程/精确任务，解析失败关闭。

`PostgresAgentTaskAdapter` 实现窄读，先 C06 verify(queryId)，再以 projectId 和任务精确身份读取自己的表；列表 SQL 用原冻结范围摘要约束，不能查全库再 JS 截取。action/candidate/validation 在各自页上限内读；C04 正文读取仅允许当前任务登记的验证或提案工件并复验其来源权限。原 readTerminalFailure（带审计/收据）和私有 readCompletedResult 继续服务原调用方，不拿它们当 UI 无副作用轮询入口。

### D-04 交互范围、启动与恢复

不新增消息表或自由聊天协议。v2 对话列显示任务发起事件、工具安全摘要、校验结论和正式结果引用；输入区改为类型化上下文选择及动作，没有实际注册上下文时呈现引导，不保留 readOnly 假聊天。页面上下文只建议选择对象，不替换已运行任务的 frozenInputRef。

launch-context 以用户可见的既有 sourceAgentTaskRef 定位真实父运行/输入，核对当前注册定义支持 interactive、策略仍可用和调用者当前范围完整覆盖；返回原信封中的冻结输入/六类策略引用组成既有 start payload。不生成新内容工件、不扩模型/工具/预算，缺少合法输入或定义支持返回 supported=false。启动只能作为一个新的明确用户任务，既有失败任务仍用 resume，不提供“复制失败任务”入口补回预算；source 为 terminal-failure/cancelled 时 launch-context 不可用。新的命令身份由客户端现有 frozen command 工具产生，确认前固定全载荷，提交后原 C08 再验定义和上下文。

只在 `retryable-failure` 且存在真实 DiagnosticArtifactRef 恢复证据时提供 resume，resumeReason 仍为 transient-recovered；没有证据不从错误码派生诊断工件。cancel 对非终态显示协作取消确认且保留已提交事实。等待用户确认仅在真实 interactive task+当前 proposal 存在时提供 confirmed/rejected；拒绝也是原 confirm-command，不是本地删除卡片。嵌入任务不可出现交互提案确认。

动作可用性沿 C34 的 allowed/denied/business-unavailable/hidden 模式，由所属端口按原准确分支/当前权限判定；只读授权不等于写权。涉及其它分支的检查用当前 read 范围为上限，通过正式 C06 授权接缝证明，不能把所有能力塞进同一上下文。

### D-05 Agent 共享视图与刷新

复用 agentDockStore 的开合接口；任务选择、分页、读状态与刷新提升为 RequireSession/EngineeringGate 内的一个 `AgentTaskProvider`，不让两个页面各轮询。只保留短生命周期 project+完整 taskRef 的选择，业务 DTO 不写 local/sessionStorage/IndexedDB。硬刷新按 URL 精确引用重新读取；仅停靠开合是 shell 偏好。

当前任务 detail 以请求完成后 setTimeout(5000) 发起下一次，最多一在途；action/candidate/validation 用户打开后分页，detail 版本更新时作废相应页，不全量重读行动。`document.visibilityState` 非 visible、两个视图都关闭、上下文变化、注销或终态时清理 timer/AbortController。开合恢复重新查询当前引用；可重试失败只显示错误与人工重试，不自动发 resume。

沿 `usePageQuery` 的工程 generation/取消习惯，以 project+taskRef+请求代际过滤迟到读与写结果；切换工程先清除旧任务/提案再读新工程。全屏与 dock 使用同一安全展示部件。复用 v2 tabs/焦点模式和现有 ConfirmButton，关闭 dock 后内容不可聚焦；高影响的账号停用/重置、工程暂停及批量复核增加原生勾选确认，默认焦点取消。

### D-06 统一复核与精确候选

`ReviewAuditReadPortV1.read` payload 联合为 `task-detail({taskId,taskVersion})` 与 `activities({subjectRef?,sourceType?,resultCode?,asOfRecordedAt?,cursor?,pageSize?})`。task-detail 只用当前工程的实体+身份版本定位，返回 `ReviewTaskStateV1Schema` 安全 pick（剔除 requestedAuthorizationContextRef）、原五类决定（存在时）、时间、actions 可用性与候选引用。decided/superseded 只读；不存在或无权同形。

原 C33 队列仍负责列表与逐项 bulk。将决定构造集中为 demo api 的一个类型化 builder，队列/详情共用并按 `ReviewDecisionV1Schema` 冻结输入；五类分别使用其已有合法分支，禁止把知识/校准/处置都发送 accept-as-is。识别“修正并通过”复用 C23/C33 真实候选集读取，只选择合法 `revisedCandidateRef`（IdentificationCandidateSetRefV1），提交 kind=`approve-revised-candidate`，不在 UI 编辑记录正文或 modelConfidence。知识发布、规则冲突裁决、处置建议和校准生效继续由原拥有方消费 C07 决定；详情展示后续精确引用，不新增自动领域写入。

C07 局部详情读取不可直接跨模块查询候选。识别候选引用通过既有 `RiskIdentificationReadPortV1` 所属读法提供，所需的只读 candidate refs 扩展其现有 run-read safe result，仍由识别 adapter 读取自己的候选登记并保留旧字段；校验/证据详情以原引用和获准摘要呈现。无修正候选时 correction 业务不可用。批量仍为独立标准命令，不加新 bulk API 或跨任务事务。

### D-07 活动、运行与证据

现有 C07 view 的业务部分仅覆盖 review.request-review/decide-review。新活动读使用 C07 自己的 adapter 组合：C03 只追加 `audit.entries` 的安全列 + 现有 view 的 security/review-rejection/superseded 事实；review 请求/决定只取一个来源避免重复。按 project、精确 subject（存在时）、时间边界及当前权限筛选，每来源先 LIMIT pageSize+1，再有界归并 `(recordedAt,sourceType,activityId)`，不改 view/migration。

既有 `ReviewActivityProjectionV1Schema` 与 display 映射继续覆盖已知码；C03 其它动作以闭合 `business.recorded` 活动码呈现，另带原已登记 actionCode（Identifier，不用其自由文本作 HTML）。安全参数只允许 actorRef、精确 subject/target/task/decision/run/authorization refs、commandId、resultCode/reasonCode、occurredAt/recordedAt/persistedAt。不得导出 audit payload dump。系统命名空间的账号管理审计不进入工程列表；没有工程/主题的登录活动不强行归属到当前工程。

权限先 verify review-audit.read，再复验该记录涉及的空间/来源上限；不能证明资格则安全失败/不提供该查询，不在返回后删掉字段并宣称完整。无主题工程活动只允许覆盖整个工程根空间的工程风险管理员；范围较小者需提交可证明的主题。账号级系统审计目录不在 C35 范围。

RunRecordsPage 保持 C33 两来源，复用 C34 run-view/risk-overview 分页和深链，单源失败独立呈现。不在此页加入 workflow resume/cancel 或审计重放；相关动作留给已有运行详情。EvidenceTracePage 复用原 C31 trace-chain/result-read，复核/Agent/报告仅传精确 subjectRef；保留缺席事实、证据定位脱敏和当前权限再读取。

### D-08 报告策略、格式与范围

补实现已有 projection.export，不再新造 export command。`ProjectionReportReadPortV1` 提供 `policies({})`、`preview({queryResultRef,exportPolicyRef})`、`artifact({exportArtifactRef})`、`history({sourceRef?,cursor?,pageSize?})` 四种 query。复用 projection.export 能力，策略由部署组合根显式注入，缺省空集合，不把 v2 EXPORT_POLICY_REF 当正式配置。

`ReportExportPolicyV1Schema` 位于 core/workflow/report.ts：schemaVersion、policyRef、format='json'、queryTypes（本轮只 risk-overview）、sections（run-summary/report-fact/report-absence 三个现有条目族的非空子集）、maxPages(1..20)、maxItems(1..1000)、maxBytes(1..8MiB)。全部是技术资源上限，不含甲方评分/矩阵规则。合成验收策略明确测试身份并待甲方复核；正式环境由部署配置提供。无发布/改策略 HTTP。

范围由 C31 精确登记 queryResultRef 固定：工程修订、空间和登记 recordedAt 时点。UI 显示原范围，不提供原型中尚无查询语义的任意时间窗；章节/格式只能从已配置策略选择，不把新字段塞到 export payload。preview 返回 sourceRef、queryType、projectRevisionRef、授权范围内 spatialScopeRefs、asOfRecordedAt、policyRef、format、sections 与已登记版本引用的有界页；引用超过页大小用户续页，不扫完整工程。生成时只接受 QueryResultRef、其类型为 risk-overview；其它 ContractReference 输入按原稳定“不支持/业务阻断”语义失败。

`ReportArtifactBodyV1Schema` 是独立内容正文 Schema：bodyKind='riskflow-report'、schemaVersion=1、projectId、queryResultRef、exportPolicyRef、scope（projectRevisionRef、空间、asOfRecordedAt）、format=json、sections、items（原 ProjectionResultItemV1Schema 安全条目、<=maxItems）、生成审计引用。复用原 run-summary/report-fact/report-absence，不重读所有领域正文或重算分值。保留缺席项；不把链边数当风险统计。它属于报告服务，不扩 `WorkflowGraphArtifactBodyV1Schema` 的 run-state/run-result 联合，也不改 Worker 正文解析。

### D-09 报告耐久、幂等与下载

PostgresWorkflowProjection 的 export 委托显式注入报告服务，仍使用同一个所属 projection/readPage。报告生成的授权首先按 projection.export/queryId 复验，再按原 query registration 范围证明全部页和 C04。C31 readPage 需要 projection.result-read 时由正式配对授权方按当前主体/范围派生，检查子集，不复用错误 branch 上下文。策略最多20页/1000项/8MiB，超过上限、循环游标、未证明结束或中途撤权直接失败，无 partial success。

不用新报告表：复用 `TransactionUnitV1` 的 command receipt，commandKind=`projection.export`，commandId/idempotencyKey 均用 queryId，载荷为 sourceRef+exportPolicyRef+actorId；同键异输入沿已有冲突。生成前做一个短的身份绑定事务并记录 export-requested，resultRef 与 audit.targetRef 均为精确 sourceRef，防止并发异载荷写工件；重复同载荷返回同一绑定身份。报告时间来自查询登记与绑定审计的 recordedAt，不取每次重试时钟。随后完整读有限投影，在 C04 以确定性 artifactId 和稳定 put 身份写 application/json、purposeCode='riskflow-report'，authorization 使用原精确导出范围；C04 先耐久化。

尾 `TransactionUnitV1` 的 commandKind=`projection.export.completed`：`command_id` 在 C03 全局唯一，尾事务不能复用绑定命令的 queryId，改用同一稳定摘要派生的独立 commandId；idempotencyKey 仍为原 queryId，两段以 (commandKind, idempotencyKey) 关联，同键重放仍解析为同一逻辑报告。resultRef 保存 ExportArtifactRef，audit.targetRef 保存真实 C04 ContentArtifactRef，generated 审计与收据同事务、零 Outbox。`ExportArtifactRefV1.reference` 与内容工件的 entityId/versionId 一一绑定，仅 kind 为 export-artifact；重新读取必须查到该 completed 收据及其 audit_entry_id 对应的精确 content target，不能从任意客户端 kind 互换猜工件。query/source/policy/scope 保存在已验证的报告正文，binding 审计保存原 sourceRef；不向仅支持 resultRef 的 AtomicCommit/收据增加私有 metadata。C03 的当前成功收据先经工程/调用者授权证明才允许重放。C04 成功而尾事务失败时不返回成功，可原身份重试；未登记孤立内容按 C04 维护机制收口。不把绑定收据当 generated 成功。

生成审计引用根据稳定 completed 命令身份预分配并纳入正文，再由尾事务保存同一引用，避免“写工件后才能知道审计ID”的循环。若 C03 原实现不能保证预分配引用在正文/尾事务一致，必须升级设计，不临时再写第二份正文。结果不自创额外 hash 门禁，沿 C04 内容身份和完整性校验。

稳定报告 artifactId 与 generated auditEntryId 复用现有 `sha256CanonicalJson` 对 `{projectId,actorId,queryId,sourceRef,exportPolicyRef}` 生成有前缀的固定身份；不包含当前授权签名或重试时间。此摘要仅用于跨工程有界标识，不另加校验门禁。AuditAppendV1 已允许调用方提供 auditEntryId/version；尾事务保存正文中的同一引用。

history 仅查询当前工程/actor 的上述 completed 收据与关联审计，以同一 idempotencyKey 的 binding 审计取得 sourceRef，复验 source 的当前空间/资料授权后，至多对本页50项登记内容做有界 C04 安全摘要读取，返回 source/policy/export refs、时间和 safe result；不全库扫描或查询所有领域记录。artifact 输入只能匹配这类收据登记的精确 export ref，重新复验 export+来源权限后 C04 open，完整验 verified/媒体类型/8MiB上限及正文 Schema，返回安全 JSON 与服务端固定 ASCII 文件名。HTTP 响应仍 JSON，前端 Blob+原生 download 保存服务端校验的 JSON，不接任意路径/外链，不提供 C04 通用下载；完成/切换/卸载立即 revokeObjectURL。

### D-10 系统管理授权、目录与六项动作

在 C06 增加独立 `SystemAdministrationPortV1`，与原 LocalIdentityAccessV1 并列；API 可选注入 `systemAdministration`，不改变所有既有 access mock 的接口。该 port 的 read/execute 输入使用服务端获得的 sessionToken 和请求身份；token 不进入返回/审计/日志。API 从唯一 Cookie 取得 token，DTO 不接收客户端管理上下文。C06 内部读取当前会话与 active account、system_administrator、安全修订与首次改密条件，复用 insertSystemAdministrationContext 生成服务端短期引用，然后通过原 administerIdentity/Project 执行；currentAdminActor 每次再验。不能让客户端透传登录时的旧 systemAdministrationContextRef。

read 操作为 `identity`、`accounts`、`projects`、`memberships(projectId)`、`spatial-scopes(projectId)`；每项绑定 queryId/requestedAt，目录有界 keyset。identity 返回 `isSystemAdministrator:boolean`、当前 accountRef、六项 SYSTEM_ACCESS_ACTIONS 中获准动作；普通有效会话仅 identity 可成功返回 false，目录/写入在读目标前拒绝。accounts 返回 accountRef、loginName/displayName/status/passwordChangeRequired；projects 返回 projectId/status/当前访问修订/根范围引用；memberships 返回 membershipRef、accountRef、原 PresetRole 集合、spatialScopeRefs/status；scope 返回精确范围/父引用/状态。全部从 C06 当前访问事实读取，不返回密码/HMAC/token或授权表内部行。

execute payload 就是原 C06 管理命令剔除 commandId/idempotencyKey/authorizationContextRef 后的六项辨识联合，保留 expectedVersion；工程动作保留 projectId。schemaVersion/commandId/idempotencyKey/issuedAt 由管理传输信封提供，授权引用由服务端注入。scope 创建/资料授权修订、初始管理员 bootstrap 不在 UI 路由中。工程开通不替用户登记 C11 业务修订，不把访问壳当已完成工程业务配置。

高影响操作停用/重置/暂停必须附当前对象与 expectedVersion 的确认勾选；不能提交默认密码。创建/重置密码只在当前原生 password 输入和单次 HTTPS 请求短暂存在，不写 frozenCommands、不把含密码 payload 放入持久化 state/确认摘要或任何日志。网络失败保留原 commandId/idempotencyKey/issuedAt，用户需重新输入相同密码再重试；改变密码/其它字段即取消旧意图、产生新身份，服务端仍判断旧键异载荷冲突。UI 不对密码做 hash。成功/关闭/路由离开清空 password 输入并释放请求体引用。

账号和访问变化沿原 C06 原子事务、收据和安全审计，沿原密码策略及会话撤销语义。不将系统管理员加入业务角色 union，不在工程业务授权中放行 system-administration。系统身份和健康页无工程上下文也可达；无管理身份不披露系统对象。

### D-11 数据源、设施、模型与备份页

DataSourcesPage 分两个独立分区：已登记资料/监测来源（需另外具备工程成员的 context-read/source-catalog/monitoring-catalog 原权限），以及当前提供的连接定义引用。现有 source 读结果缺 deliveryKind/connectionDefinitionRef 时，仅通过工程数据所属 source-catalog 的加法式安全摘要披露登记 descriptor 中已有三类 deliveryKind 与 connectionDefinitionRef；不读连接秘密，不造 adapter 状态。纯管理员可进入系统页，但工程部分返回未获业务权限，不能绕过 C06。无连接生命周期端口不显示检查/停用动作。

`SystemOperationsReadPortV1.read` 是 API 显式注入的应用输出接缝，payload.kind 为 `health` 或 `model-versions`。调用前取得 D-10 当前管理证明；最大32项，读超时2秒，单请求，无后台轮询。health 返回 capturedAt、safe componentId（api/postgresql/artifact-store/model-gateway）、status=available/unavailable/degraded/unknown、reasonCode?，不返回 URL、路径、堆栈或队列正文。provider 可使用部署组合根已有的真实窄 health callback；无 callback 的 component 为 unknown，整个 provider 未注入则路由不激活。C35 不实现监控平台、进程探测或硬件曲线。

model-versions 只从注入的当前 `LlamaCppDeploymentConfigV1Schema` 和 AgentTaskDefinitionRegistry 元数据安全 pick：deploymentRef/modelVersionRef/serverBuildRef、taskType、promptTemplateRef、toolPolicyRef/budgetPolicyRef 及支持模式。不得返回 baseUrl/modelAlias/秘密/权重路径/提示正文；没有基础-微调关系事实不补填。模型/提示 page 的发布/回退操作移除；版本是实际部署/引用，不套知识治理 draft/in-review/published 枚举。

BackupPage 移植 v2 范围与恢复区的视觉结构，但当前整体为 unavailable，只有真实功能未接入说明与返回入口，不渲染 fixture 策略/恢复点或危险按钮。备份策略、恢复点、校验、幂等、执行和系统审计由 C37 批准后接入；本轮 browser 验收必须确认零恢复 HTTP 副作用，不宣称备份能力完成。

### D-12 API 路由、OpenAPI 与会话

三个业务 query 使用原 HTTP_ROUTE_CATALOG 和 assembleQueryRequest，绑定 D-02 的唯一 port/schema。复用现有 export、review 决定和 Agent 写 branch，不另造通用 handler。业务结果 strict 解码，旧 C32–C34 ports 保留。

系统路径固定如下，元数据仍在 `HTTP_SYSTEM_ROUTE_CATALOG_V1` 派生 OpenAPI：

| 方法/路径 | DTO/操作 | 激活条件 |
|---|---|---|
| GET `/api/v1/administration` | D-10 identity，无请求体 | systemAdministration |
| POST `/api/v1/administration/queries` | schemaVersion/queryId/requestedAt + strict 目录 payload | systemAdministration |
| POST `/api/v1/administration/commands` | schemaVersion/commandId/idempotencyKey/issuedAt + 六项 payload | systemAdministration |
| POST `/api/v1/operations/queries` | schemaVersion/queryId/requestedAt + health/model-versions payload | systemAdministration + operationsRead |

系统路由继续使用既有 Cookie、同源/CSRF、JSON body-size、安全错误和 no-store 机制；管理写请求用 Idempotency-Key 与体身份一致性检查，不新增 Authorization header 或 query token。不得走 runBusiness 的工程 authorize；对应方法只调用 C06 独立管理 port。API app 工厂不监听、不迁移、不执行后台 health。系统 metadata 的激活规则需新增 port keys，不让通用 OpenAPI 文档无条件列出未注入管理面。

demo 管理客户端复用 client.ts 的 Cookie、安全错误和 AbortSignal，但提供专用 strict 信封函数以免工程依赖或密码进入普通 frozenCommands；输入只来自 D-10 shared DTO。demo 页面继续不导入 apps/api 或后端私有实现。会话恢复 GET /session 的现有形状、generation 保护和改密/注销流程不变；admin identity 独立查询，技术失败不当成 false/anonymous。

### D-13 组合根、验证与交付约束

复用 `demo/test/browser/server.mjs` 的同一 PostgreSQL、C04、C06、reviewAudit、Agent adapter/registry 与 workflow projection；新增窄读直接实例化拥有方实现，report 注入同一 C31 reader、真实 transactionUnit/C04/配对授权方。SystemAdministrationPort 使用同一 C06 对象。新增 provider 按实际 DB/artifact-store健康 callback 与部署配置装配；清理函数加入 closeables。没有 Docker/Chromium/必需策略或真实端口时测试非零失败。

交互验证使用已有 C08 运行时/Worker、真实预算、提案工件、确认及 C03 事务；为检验 runtime 平台边界，可注册版本化合成任务定义与类型化测试工具，其最终效果由真实 C06/C07/C16 等原用例提交，并标明“合成样本、待甲方复核”。不得用 SQL 直接把任务改成 completed、用成功 stub 当领域结果或把这项平台测试宣称所有生产定义已支持交互。至少一种生产支持 interactive 的知识定义通过 launch-context/启动契约边界；其它定义不改 supportedTriggerModes。

测试选择优先扩展现有 agent-runtime、review-audit、auth、workflow projection 和 API HTTP tests；新增 browser 文件只覆盖 C35 真行为，避免提示/完整文案/像素 snapshot 精确断言。v2 主分区与视觉复用在相同视口中人工/截图检查并记录证据，自动化只断言 landmark、焦点、主操作和数据行为。

性能证据：每类目录>50项合法续页及大量其它工程数据；Agent action/validation DOM 一次<=50项，5秒以上慢读单在途，关闭视图零新增读取；报告上限与超限；活动源分页每来源<=51行。记录实际读取行数/工件次数/耗时，不发明不基于现有基准的新延迟硬门禁。若既有索引不能维持边界，升级迁移设计，不能暗加全库扫描或索引。

RI-S1/2→资料定位授权；RI-S3/4/5→工序/机理/输入/检索与任务引用；RI-S6→验收/人工决定/追溯；RA-S1～4→只呈现冻结适用性/规则/权重/矩阵及已成立评分引用；RA-S5/6→预警、建议和三项约束；RA-S7→人工执行反馈、偏差/校准及独立草案。原链无事实的尾段保持缺席。

## Risks / Trade-offs

- v2 报告的 PDF/时间窗和 ops 的连接/恢复操作超出现有契约；本轮固定真实 JSON 与已登记范围，明确 C37 边界，不能保留假按钮。界面设计复用不表示 fixture 字段全部落地。
- 管理权限、跨资料范围与导出尾事务为关键接缝。本轮收尾需一次限定审计，结论进入同一 verification。
- 只用既有收据/工件避免增加报告表，但 export 身份绑定、工件与尾事务要真实注入故障验证；不能把 C04 孤立内容当公开导出结果。
- 当前生产 interactive 支持有限；页面按真实定义/前置开放入口，合成平台任务不代表新增通用 Agent 产品能力。

## Migration Plan

依次实施 Schema/授权→拥有方读与导出→HTTP→demo 页面。无依赖、锁文件、数据库迁移或历史回填；原写端口、C31 query/result与 C32–C34 页面保持。只有 C35 已替换页的 static import 被清除，content 原件由实际使用情况决定，禁止批量删除。部署宿主必须按新的可选注入契约接线，缺席能力失败关闭。

Planning 只创建五个前置工件；本 change 是可评审草案，不是实施批准。Finalizer 在最终实现检查点运行 verify、范围内修复与回归后创建 verification；涉及权限与报告尾事务的 Targeted Auditor 在同一工件记录最终结论。

## Open Questions

无实施阶段需自行裁决的公开语义。正式导出策略、甲方脱敏样本及 C37 运维输入由交付配置提供；缺失时按上述 unavailable/失败语义处理，不影响当前代码边界与测试设计。
