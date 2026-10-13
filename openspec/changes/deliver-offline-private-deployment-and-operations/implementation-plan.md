# Implementation Plan

## 1. 实施基线与权威来源

保留 IP-01–IP-14 初始基线 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a` 及已完成实现。IP-15/IP-16 增量基线为 `0a25b6a469ade4bcc6a21c4514195d1f7c19ff31`；该 HEAD 已有四应用三共享包、Web 页面迁移、Electron 薄壳与部署程序，但仅有 llama.cpp model adapter，runtime.mjs 仅提供 provider 容器/绑定与就绪检查，尚无完整启动 CLI。desktop e2e 仅两条基础用例，smoke/benchmark CLI 仅校验配置。

权威输入为本 change 九份 delta、proposal、design D-01–D-24 与既有主规格。applyRequires 保持 proposal/specs/design/implementation-plan/tasks；新增 IP-15/IP-16 按本施工图实施，Finalizer 在固定实现检查点之后创建 verification。

直接依赖与执行图不变。当前 C37 功能环境可合置三个逻辑角色，使用真实数据库、索引、工件、OCR 与批准网络 API；正式签名、多平台安装、禁网三 VM、模型介质和 4090 取证移交 C38 的 F-01–F-05，不是 C37 收口条件。

剩余依赖顺序见 tasks 首段。运行前批准服务/模型/协议、上下文/维度与预算证明、受限秘密、业务配置和样本；缺输入阻塞当前功能验收，不能填默认值。正式平台/硬件输入只在 C38 要求。当前程序缺口必须真实补齐，不将旧 checkbox 或配置检查当作完整功能证据。

## 2. 复用与接缝

相对源文件路径在下面的 packages/adapters、packages/core 与 apps 下解析；禁止宿主 deep import。

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | pnpm-workspace.yaml；tsconfig.json；scripts/check-dependency-policy.mjs#PACKAGE_MANIFESTS；dependency-cruiser.config.cjs | 七成员与依赖治理；D-03/D-16 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-02 | postgres/bootstrap.ts#bootstrapPostgresFoundation；migrations/run.ts#runPostgresMigrations；auth/postgres-local-identity-access.ts#bootstrapInitialSystemAdministrator；postgres/transaction-unit.ts | 配置、初始化与部署审计；D-02/D-05/D-19 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-03 | core/artifacts/store.ts#ArtifactStoreV1；adapters/artifacts/filesystem-artifact-store.ts；postgres-artifact-registry.ts#PostgresArtifactRegistry；auth#verify | 跨 VM C04 流服务；D-18 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-04 | core/retrieval/service.ts#evaluateRetrievalAcceptance；C19 scoring/config adapters；PostgresRiskCandidateAdapter.readResult；PostgresStandardizedRiskInputFactsReader；auth#authorize/verify | 策略、授权与正式窄读；D-20 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-05 | apps/worker 各 create*Composition；adapters factories；apps/api/src/app.ts#buildApi/qualityProjectionWithGrants | 生产组合与 API 全端口；D-04/D-20/D-21 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-06 | AgentRuntimeRunner.runOnce；createPostgresOutbox；createPostgresIdempotentConsumer；C20/C24/C26/C30 handlers；collectSystemOperationsHealth | 监听、耐久消费与有界观测；D-06/D-07/D-21 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-07 | WebRouteContributionV1；createC09Client；createConfirmationController；CommandConfirmationDialog；WebContextV1；quality contribution | 唯一 Web 路由、HTTP 与确认；D-17 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-08 | demo/src 真实页面 import 闭包；apps/web 共享 page-shells/七态；C32–C36 浏览器行为 | 完整业务 UI 与真实浏览器验收；D-12/D-17 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-09 | 系统 BrowserWindow/session 原生 API；Web HTTPS 登录、Cookie/SSE/文件操作 | Electron HTTPS 壳与平台包；D-14/D-15/D-16 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-10 | 既有固定 PostgreSQL/Qdrant 镜像；C05 gateway/C13 parser smoke；build dist | 三 VM HTTPS 与完整离线介质；D-01/D-02/D-07/D-16 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-11 | C04 maintenance.createHashManifest；C03 audit/checkpoint/outbox；PostgreSQL pg_dump | 全工程停写与同机逻辑副本；D-08/D-09/D-19 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-12 | C04 maintenance.reconcile（完整消费+await summary）；C20 rebuild；C06 session key rotation；LangGraph 原 checkpoint | 隔离核对、激活与回退；D-10/D-11/D-19 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-13 | Playwright _electron.launch；apps/desktop/test/e2e/client.spec.ts；Web HTTPS/C06 | 当前可用平台构建运行的桌面功能证据，C38 再验正式安装包；D-12/D-15/D-24 | TLS、权限、幂等、任务事实沿服务端原契约 |
| IP-14 | scripts/deployment/acceptance.mjs 配置校验/汇总；现有工程测试 | 当前证据口径、手册与交接；正式 smoke/benchmark 移交 C38；D-12/D-22/D-24 | 不能将配置校验当作真实验收 |

| IP-15 | core/model/gateway.ts#ModelGatewayPortV1；core/model/schema.ts；adapters/model/config.ts 与 llamacpp-model-gateway.ts；C04/C06 | OpenAI Chat Completions 结构化/流式与 Ollama 原生 Embedding 配置/adapter/真实三能力 smoke；D-23 | 复用原请求/结果、授权、预算、持久化和闭合错误 |
| IP-16 | scripts/deployment/runtime.mjs#ProductionCompositionRootV1、lifecycle.mjs、events.mjs；scripts/acceptance/synthetic.mjs#checkPack/runPack；正式 HTTP 操作目录；可见外部 Chrome/CDP | 实际宿主启动、精确后端装配、正式终态与证据收口；D-24 | 不复制测试 harness 或答案，不自动代替人工决定；观看验收须在可见外部浏览器 |

IP-05/IP-16 模型步增量：修改 `scripts/deployment/composition/calibration-task.mjs` 提取共用冻结输入读取并公开宿主 readModelInput；新增 `scripts/deployment/composition/response-model-step.mjs`，消费原 runTask、authorizeDownstream、C27/C28 公开读、C29 输入口及 C04 persistArtifact，返回共享 runner 的 render/interpret callbacks。`composition/assessment.mjs` 要求 foundation.authorizationScope 与 persistArtifact，直接返回绑定同一 recommendation/responseLifecycle/calibrationTaskPort 的 modelStep，原任务定义 validate/finalize 同样进入 runTask 作用域。不改变 core 任务定义或 actionSchema，不制造正式引用。扩展 `scripts/deployment/calibration-task.test.mjs`、`assessment-composition.test.mjs` 并新增 `scripts/deployment/response-model-step.test.mjs`，验证真实冻结输入、当前撤权/脱敏/精确版本、阈值、预算、输出绑定、两个耐久候选工件和显式 inner；命令 `pnpm exec vitest run scripts/deployment/calibration-task.test.mjs scripts/deployment/response-model-step.test.mjs scripts/deployment/assessment-composition.test.mjs`。宿主未装配前不勾选 5.2/16.1。

### 生产组合 options 映射（IP-04 / IP-05）

IP-05/IP-16 工作项检查点增量：修改 `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts#verifyCheckpointReference` 及现有 `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`，沿原 boolean 证明增加可选 workPlanRef 和 identification-work-item 分支，复用同运行登记/正文完整性及零写验证；`scripts/deployment/start.mjs#createDeploymentCheckpointValidatorV1` 从严格图状态传入冻结工作计划，`entrypoints.test.mjs` 覆盖有/无该计划及能力缺失。命令 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 Agent 检查点增量：`packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 增加 D-21 的只读 verifyCheckpointReference，`packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` 验证等待/终态、精确任务版本/父运行/主体/当前权限、范围与零写；`start.mjs` 组合 agentTasks 和当前图/已证明子运行的精确 parentRunRef，`entrypoints.test.mjs` 覆盖无能力、错父及 C03 不接受的子入口。原 getTask、失败/完成结果读和任务执行保持不变。

IP-05/IP-16 等待检查点增量：`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 的公开 adapter 增加 D-21 verifyCheckpointWaitingReference，复用当前授权与所属 waiting 登记表，完整 WaitingRefV1 等值有界查询。对应现有 adapter 测试验证精确等待、错版本/运行/主体、撤权/脱敏/范围及零写；`scripts/deployment/start.mjs`、`entrypoints.test.mjs` 只为知识准备和用户确认引用组合图状态完整等待及所属证明，缺登记拒绝。既有导出承载接口，无新 Schema、表、迁移或依赖。

IP-05/IP-16 复核检查点增量：`packages/adapters/src/review-audit/postgres-review-audit-read.ts` 按 D-21 增加公开 verifyCheckpointReference，共用 task-detail 精确任务状态解析，核对原主体/完整元数据/精确父运行及当前权限，不读决定；既有 review-audit/index.ts 星号导出承载。`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` 扩展现有真库读面场景，验证等待/终态、错版本/主体/父运行、权限收窄和零写；`start.mjs`、`entrypoints.test.mjs` 增加 reviewTasks 接线，与 Agent 任务共用 C03 父子运行证明。无 core/HTTP Schema、表、迁移或依赖新增。

IP-05/IP-16 C22 检查点增量：`scripts/deployment/composition/identification.mjs` 按 D-21 导出 createDeploymentCandidateCheckpointProofV1，组合原精确 resultStore、C06 与 C04 verifyContent。`packages/core/src/identification/candidate-finalization/service.ts` 将原 8 MiB 正文上限导出为 RISK_CANDIDATE_ARTIFACT_MAX_BYTES_V1，原读取和宿主共用。`scripts/deployment/composition.test.mjs` 验证三类原 Schema 正文、登记/输入/计划/身份/授权错配及禁止 open；`start.mjs`、`entrypoints.test.mjs` 证明 C24 输入/计划后才调用候选证明，缺少冻结引用拒绝。既有 index.ts 星号导出承载常量；不新增表、Schema、依赖或业务路径。

IP-05/IP-16 标准化风险记录检查点：`start.mjs` 组合既有 riskIdentificationRead.read 的纯 SELECT record-read，严格当前下游授权及精确本运行归属；`entrypoints.test.mjs` 验证错结果/运行/版本及脱敏拒绝，复用 `packages/adapters/test/identification/postgres-risk-identification-read.test.ts` 真库精确读取与零写用例。无新公共领域端口或生产文件。

IP-05/IP-16 checkpointer 基础装配：`start.mjs#createDeploymentFoundationV1` 对 API/Worker 要求 validateCheckpointReference 函数，在业务数据库连接前拒绝缺口，并用配置的独立 checkpointerRoleName/密码构造 createPostgresCheckpointer；返回真实 checkpointer，end 纳入既有资源关闭流程。provision 不建立该连接。`deploymentConnectionV1` 明确支持 checkpointer 职责，`entrypoints.test.mjs` 验证角色/秘密隔离、缺校验函数与缺独立密码的启动拒绝。业务启动不调用 setup 或执行 DDL；真实 PostgreSQL 角色权限与 saver 行为复用 C03 已有回归。

共同基础：db=createPostgresRuntime.db；transactionUnit=createPostgresTransactionUnit；checkpointer=createPostgresCheckpointer；access=createPostgresLocalIdentityAccess；artifactStore=IP-03 remote store；referenceGuard=本地 PG guard；modelGateway=按 D-23 精确部署 registry 选择 createLlamaCppModelGateway 或 createNetworkApiModelGateway；文档转换=createMineruDocumentParser（接口及实施归独立 change adopt-mineru-document-ingestion）；review=createPostgresReviewAuditAdapter；idempotentConsumer=createPostgresIdempotentConsumer。所有模型/文档/工件/预算入参使用所属 strict Schema，不从 demo 私有 fixture 获取。IP-01 先建立 Desktop manifest/tsconfig，完整主进程在 IP-09 完成后根 build 才作为通过证据；宿主测试加载 dist 前由测试 setup 使用现有 tsc -b apps/api apps/worker 构建服务侧，不依赖未完成的桌面或开发服务器。

| 组合根 | options → 固定 provider |
| --- | --- |
| C15 createPostgresDataCleaningComposition | 基础 db/transaction/artifact/access/model；原 parser/source registry；catalog cleaning policy；共享 registry（新增可选注入）；resolveStartAuthorizationInvocation=IP-04 C06 invocation source |
| C17 createPostgresIdentificationKnowledgeComposition | 基础；同一 registry（新增可选注入）；catalog validationPolicy；assessmentBasisResolver=scoring adapter.resolve；resolveAuthorizationSource=C06 source；preparationRead=C15 store.readExactPreparation；engineeringData=registry read/resolveReadQuery；reviewAudit=原 review；policySetProvider=同一 IP-04 policySet；agentTaskFailureEvidenceReader=C15 agentTaskAdapter 的原 reader；retrievalDelegate=一次绑定的 C20 retrieve |
| C20 createHybridRetrievalProjectionComposition | generationStore=PostgresRetrievalAdapter 的真实 db/transaction；qdrant=配置端点/时限；sourceFacts=C17 adapter；model/artifact/transaction/idempotentConsumer=基础；policyProvider/qualityGate/authorize=IP-04；queryInputReader=一次绑定 C21 service.queryInputReader；budgetPolicyRef=批准配置 |
| C21 createIdentificationContextComposition | 基础；inputReader=PostgresIdentificationGraphAdapter.contextInputReader；knowledgeReader=C17 adapter；hybridPolicy=IP-04 同一 catalog；hybridStore=PostgresRetrievalAdapter；retrievalService=C20 retrievalDelegate；taskReader=共享 PostgresAgentTaskAdapter.getTask；reviewPolicy=catalog 原 RetrievalReviewPolicy；registry=共享 registry |
| C22 createRiskCandidateFinalizationComposition | 基础；review=同一 C07；modelContextReader=C21 service；workPlanReader=identification graph adapter.workPlanReader；policyProvider=IP-04 RiskCandidatePolicyBundle；reviewDecisionReader=review.readIdentificationGroupDecision |
| C23 createIdentificationHumanReviewComposition | pendingReviewReader=review；reviewRevision=C22 service；review=同一 review.decideReview |
| C24 createIdentificationGraphComposition | 基础；runtimeAuthorization/recoveryAuthorization=IP-04 C06 source；policyProvider/reviewPolicy=catalog；basisResolver/knowledgeReleaseReader=C17 adapter；preparationReader=C15 store.readExactPreparation；contextService=C21 service；agentTasks/agentTaskReader=共享 adapter；finalizationService=C22 service；reviewDecisionReader=review；acceptanceRoutes=IP-04 精确登记+C04 reader；recoveryConsumer=原 idempotentConsumer |
| C25 createAssessmentGraphComposition | 基础；runtimeAuthorization/authorizeDownstream=IP-04 C06 source；engineeringData=engineering registry；basis/basisResolver=同一 scoring adapter；runtimePolicies=IP-04；riskAssessment=createPostgresRiskAssessmentEngine；warning=createPostgresWarningLifecycleAdapter；recommendation=createPostgresRecommendationAdapter；recommendationAgent=共享 registry 的 createResponseRecommendationTaskDefinition；responseLifecycle=createPostgresResponseLifecycleAdapter + createPostgresResponseLifecycleContextReader + createEffectForecastModelReaderV1 + createProductionEffectForecastExecutorResolverV1；calibration=createPostgresCalibrationAdapter；calibrationAgent=共享 registry 的原校准任务定义；policies=正式 C19 成员/candidate catalog |
| C30 createRiskFlowGraphComposition | 基础；runtimeAuthorization=IP-04；humanDecisionProof=createPostgresHumanDecisionFeedbackAdapter；identificationRuntime=C24 runtime；assessmentRuntime=C25 runtime；riskSpatialPairing/retryPolicy=IP-04；subGraphVersions/retryPolicyRef=批准配置 |
| API BuildApiOptionsV1 | access=基础；ports=design D-21 全表；publicOrigin=配置；ssePolicy=原 Schema；accessLog=安全有界记录；now/idGenerator 沿生产实现；不注入固定测试时间/ID |

各 composition 的原可选 now 省略则使用真实时间，不能覆盖版本语义。原 C20/C21/C17 构造环按 D-20 的一次绑定处理；先完成 registry 所有任务注册和全 ports 校验，再 listen/claim。存在已发布工程时，策略按 projectBindings 的精确版本解析；新工程未配置必需运行策略时功能明确失败，不从其它工程取值。

C27 recommendationAgent 的现场上下文从 C28 contextReader 与当前精确 assessment/response 的受保护登记构建，校准上下文从已登记 deviation/calibration lineage 读取；需要的引用均来自冻结图输入，不指定“当前最近”现场。任务定义使用原 typed tools/validation/finalization adapter，不能靠函数返回假任务结果。

IP-04 新窄读契约：工程 registry.listDeploymentProjects 使用固定分页上限和 cursor 返回真实 projectId/revision/空间/来源登记引用；auth resolver 在 HTTP 受理时按固定下游清单分别用真实会话签发、耐久关联；后台按目标 branch 读原关联 context，复验 actor/当前授权再以同能力 parent 收窄，不扩展原 parent 能力；scoring/config reader 按同工程 member releaseRef/versionId 返回原已发布正文与 digest，缺失返回 undefined。这些函数在所属 adapter 内实现；部署 provider 只消费公开导出，不读取私表。保护 C06 sessionToken 不进入 catalog、日志或 checkpoint。

IP-04/IP-16 同实例工件授权：auth/postgres-local-identity-access.ts 的 verifyDeploymentContext 按精确 ref 定位原业务签发，并复用原 verify、主体/能力及当前权限；start.mjs 为 put/open 注入该复验边界，保持原 DTO、工件身份和完整流消费。既有 auth test 验证假引用、错工程/主体/能力、权限撤销与合法签发；entrypoints.test 验证复验失败前无工件副作用、成功使用持久上下文。executeDeploymentProjectAccess 的管理员预置接缝及其 bootstrap/原身份重放保持 D-20。

IP-04 在同一 C06 adapter 增加 D-20 readDeploymentAuthorizationSource 精确窄口及公开类型；现有 local-identity-project-authorization.test.ts 扩展业务来源、管理/错主体拒绝与实际父因果关联用例。来源与当前权限分开，保持原五分钟期限，不新增会话持久字段或自动续期。

IP-16 start.mjs 组装精确模型 registry 与三能力 C06 复验，包括无父工件请求；原 adapter 的协议/预算/错误及 C04 持久语义保持。entrypoints.test 验证拒权前无模型调用、合法请求转发原身份、会话流的增量和终态沿原 handle；模型父工件预检完整消费同实例受权 C04。

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1–1.2 | 单一生产 workspace；冻结且可重放的工具链；可构建的应用与深层共享包；强制单向依赖边界 | §2 与 §7 文件表 | 新增 Desktop 成员/TS reference/跨应用矩阵；根 build 编译桌面主进程但不打平台包；登记四个精确 npm 依赖，保留现有版本及许可白名单，离线 Electron 安装由缓存供给。 | D-03/D-16 的保护边界 |
| IP-02 | 2.1–2.3 | 部署运维状态与审计必须耐久且独立授权；部署配置与秘密必须分离并保持原契约；初始化必须幂等且运行主体使用最小权限 | §2 与 §7 文件表 | 实现 strict 部署 Schema、秘密校验、阶段状态/CAS/租约/追加审计；000056 新表及独立 role/grants；公开现有 runtime/transaction unit，保持 getPostgresTransaction 私有；初始化显式创建 LOGIN、迁移、checkpointer 和首次管理员，运行启动不做 DDL。 | D-02/D-05/D-19 的保护边界 |
| IP-03 | 3.1–3.2 | 跨虚拟机工件访问必须保持 C04 原契约 | §2 与 §7 文件表 | 实现有限 framed streaming、mTLS/真实 C06 复验、背压/超时/截断/verified；公开单独 PostgreSQL referenceGuard factory，应用事务不经 HTTP；数据 VM 本地 maintenance 保持原实现。 | D-18 的保护边界 |
| IP-04 | 4.1–4.3 | 生产策略与窄读必须解析精确真实来源 | §2 与 §7 文件表 | 实现不可变 catalog 的按 ref 原 Schema 验证；真实检索质量测量；所属 adapter 增加精确成员正文、持久调用来源和工程枚举窄读；路线/空间/现场输入只能来自正式登记与 C04，缺项失败。 | D-20 的保护边界 |
| IP-05 | 5.1–5.3 | 关联场景与共同义务见 §6 | §2 与 §7 文件表 | 按下表装配各必需 option、共享 registry、一次绑定委派和类型化分派；公开两个现有 adapter 子路径；质量两阶段授权与完整 projection 并存；装配失败关闭已创建资源。 | D-04/D-20/D-21 的保护边界 |
| IP-06 | 6.1–6.2 | 服务生命周期必须使用真实公共接缝；内网访问与观测必须有界且最小披露 | §2 与 §7 文件表 | API 显式 listen；Worker 单独轮询/claim/ack/失败；全 12 事件清单闭合；真实四组件与模型 observation、AbortSignal/总时限；关闭超时报告失败并保留原租约恢复。 | D-06/D-07/D-21 的保护边界 |
| IP-07 | 7.1–7.3 | 写命令必须经过统一确认原语 | §2 与 §7 文件表 | BrowserRouter 取代自有 history；registry 元数据及七导航保持；旧路由别名保留 query/params；闭合 system operations；project/system 判别确认作用域和 AccessCommandResult 成功类型，深冻结信封、身份及上下文取消。 | D-17 的保护边界 |
| IP-08 | 8.1–8.5 | 桌面与浏览器必须共用完整 Web 业务界面；C35 页面必须复用 v2 设计并保持既有应用接线；C35 验收必须覆盖真实接缝和可访问性；C34 页面必须复用 v2 设计并只展示真实事实；C34 必须以真实浏览器验收业务接缝；页面必须只经既有 HTTP 只读面取得业务事实；浏览器验收必须使用真实浏览器与正式接缝；识别与复核页面必须只经既有 HTTP 面取得业务事实；浏览器验收必须使用真实浏览器与正式接缝 | §2 与 §7 文件表 | 按迁移附表合并全部真实页面及需要的视觉组件；原 HTTP/session/fixture 依赖改唯一来源，EvidenceDrawer 无静态回退；统一真实 harness 和五份浏览器 spec，保留 C36。 | D-12/D-17 的保护边界 |
| IP-09 | 9.1–9.3；C38 F-01 | 桌面运行必须限制导航与本机能力；桌面功能验收与正式离线发布分阶段 | §2 与 §7 文件表 | 保留已有安全 HTTPS 壳与程序检查；正式签名包取证移交 C38，不新增未签名分发模式。 | D-14/D-15/D-16 |
| IP-10 | 10.1–10.3 | 部署必须遵循三台虚拟机的集中式边界；离线发布包必须完整且版本可核验 | §2 与 §7 文件表 | 安装工具只读/导入精确介质，固定 systemd units/网络规则；手工证书 Caddy、同源 API/SSE 与深链；GPU/OCR 配置/预算与本地镜像，install/run 不隐式下载。 | D-01/D-02/D-07/D-16 的保护边界 |
| IP-11 | 11.1–11.3 | 同机逻辑副本必须绑定同一停写边界及全部耐久事实 | §2 与 §7 文件表 | 独立宿主权限 + 全工程资料/空间授权；三 VM 本地停写回执与无在途证明；先 manifests 再 dump 再工件复制/描述耐久发布；状态、互斥与失败采用 IP-02，不自动清理/成功。 | D-08/D-09/D-19 的保护边界 |
| IP-12 | 12.1–12.3 | 恢复必须先隔离核验再人工切换 | §2 与 §7 文件表 | 新 DB/本地工件根隔离恢复；先原集合核对后诊断；索引真实重建并过原门禁；精确 revision/副本/目标确认、会话失效和受控切换，失败保留双根；不兼容回退须匹配副本。 | D-10/D-11/D-19 的保护边界 |
| IP-13 | 13.1；C38 F-02 | 证书与会话必须沿用安全 HTTPS 边界；连接恢复不得重启任务或自动提交写命令；桌面功能验收与正式离线发布分阶段 | apps/desktop/test/e2e/client.spec.ts、acceptance.mjs；playwright.desktop.config.ts | 当前只在可用平台运行已构建主进程，补齐实际安全/会话/重连/任务继续场景；预检不要求签名/正式包。最终三平台安装另交 C38。 | D-12/D-15/D-24 |
| IP-14 | 14.1–14.2；C38 F-03–F-05 | 当前功能验收与最终部署交付必须分开收口；发布回退与目标环境验收必须有真实证据 | deployment/ACCEPTANCE.md、OPERATIONS.md；acceptance.test.mjs；§6 | 纠正证据口径并交接固定当前检查点；C37 按真实功能和必要审计收口，最终介质/平台/硬件另由 C38 取证。 | D-12/D-22/D-24 |

| IP-15 | 15.1–15.3 | 模型部署能力和尺寸由配置冻结；结构化生成必须按冻结 Schema 提交并经本地 Zod 复验；网络 API 必须保持原网关的授权预算与证据契约；测试替身和真实 llama.cpp smoke 分层验收 | §7 增量文件表；原 C05 port 与 adapter | strict 协议判别配置/受限秘密；提取 C05 公共调用运行逻辑；OpenAI Chat Completions 结构化/流式与 Ollama 原生 Embedding；预算、协议和模型身份复验；C04 安全证据；真实三能力 smoke。 | D-23、原 C05/C04/C06 契约 |
| IP-16 | 16.1–16.3、13.1、14.1 | 当前功能验收与最终部署交付必须分开收口；联网推理完成业务链路；服务生命周期必须使用真实公共接缝；合成验收资料预置必须使用正式权限与模块入口 | §7 增量文件表；ProductionCompositionRootV1、checkPack/runPack、provision、可见外部 Chrome/CDP | 真实 provider 装配及启动；受控预置和原身份续接；原合成工具只读终态观察与安全证据报告；真实生产宿主上的正式业务链路，并在用户可见外部 Chrome 中验收。 | D-20/D-21/D-24、原 HTTP/人工决定/幂等 |

§6 是逐场景主映射。IP-05 为生命周期/策略/质量场景的共同依赖；IP-09/13 为完整 UI 桌面场景共同证据；IP-15/16 为当前真实网络推理与功能闭环证据；C38 最终场景按 F-ID 移交，不能用当前单元测试冒称最终交付。

9.3 的打包程序工程检查复用 scripts/deployment/release.test.mjs（IP-09/IP-10）；13.1 的桌面环境预检复用 scripts/deployment/acceptance.test.mjs（IP-13/IP-14）。相关测试按稳定输入、结构化工具调用、缺项非零和结果状态断言，合成输入与工具替身仅用于程序契约测试，不进入正式发布介质或充当实机证据。

## 4. 调用与副作用顺序

- IP-02/10：verify manifest/路径/架构/许可→strict config→秘密权限→显式初始化（权限组/LOGIN→原 migrations→checkpointer→C06 空库 bootstrap）→核对兼容迁移→装配真实 ports→本机 listener/Worker→Caddy。同一失败不半启动；bootstrap 在已有账号库中不能重新创建/改密。
- IP-03：mTLS→当前 C06 工程/来源/空间/capability→原 DTO→有界流→C04 原登记/审计→原回执；open 只有最终 receipt 与内容 identity 核验后 resolve verified。引用检查必须使用调用业务事务。超时/断流没有成功响应，不更换命令身份。
- IP-04/05：精确配置/catalog→原 Schema/批准身份→所属正式成员/登记→原 C04 verified→受控一次绑定→全 ports 校验→允许业务。检索门禁先测真实代际并通过 evaluateRetrievalAcceptance，随后原 C20 激活；不跳过 dense/BM25/RRF/授权门。
- IP-06：claim durable event→按 eventType 明确 dispatch→消费者原事务/幂等回执→ack；失败 recordFailure 沿原预算，未知事件失败。Agent runner 有界轮询原任务，取消/恢复不创建新任务。停止接收→停止 claim→限时 drain→关闭 SSE/图/流/连接；超时不能成为停写回执。
- IP-07/08：真实会话/URL selector→当前工程权限与路由能力→有界读取→原七态；写动作冻结信封→唯一确认→服务端复验→原回执→刷新同上下文。取消无请求；未知响应只允许用户在原计划显式重试，迟到响应用 context revision 隔离。
- IP-11：授权/全工程枚举/容量/锁→三 VM 本地维护回执及全写者停止→逐工程 hash manifests→完整数据库逻辑 dump（含业务/audit/Outbox/checkpoint/迁移）→全部耐久工件（含清单）→descriptor 耐久发布→IP-12 隔离核对→可用回执。中断保留未完成阶段与旧根，不默默删除。
- IP-12：受控目标映射→新的隔离 DB/工件根→原副本所有工程 reconcile（findings 全消费+summary）→正式登记/审计/任务/checkpoint 验证→真实双索引重建与门禁→精确目标确认→授权/revision 再核验→停写/切换→旧会话失效→就绪。失败保留双根，回退按原记录显式确认。
- IP-15：strict 配置与受限凭据→精确后端/能力→C06 与父工件授权→保守 token/字节/截止预算→固定协议请求→C04 持久化及完整读取→结构/向量/流/usage 复验→原类型化结果；生成不自动重试。构建/协议身份保持 D-23 含义。
- IP-16：受控功能配置与原初始化/兼容检查→D-20/D-21 完整 provider/委派→真实 listener/Worker→原合成材料 check/run→同次回执引用的有限正式只读查询→人工等待或正式终态→精确证据解析→报告。查询不补造写事实，UNKNOWN/submitted/缺引用不通过。
- IP-13/14：当前平台构建与功能 HTTPS→实际 Electron/浏览器行为→当前证据报告与工程交接；正式制包、禁网安装与实机基准归 C38。

## 5. Schema、状态与持久化落实

唯一 Schema 与边界按 design D-18/D-19/D-20。IP-02 实现 strict ReleaseManifestV1/DeploymentConfigV1/DesktopConfigV1/DeploymentOperationV1/LogicalBackupDescriptorV1/DeploymentOperationResultV1；原 Zod 4.5.4 不升级。所有复用业务 policy 直接 import 原 core Schema，无第二字段镜像。

000056 运维表/因果授权关联/追加审计/grants 只为宿主操作，不修改历史迁移。用独立 deployment operator role、instance+operation 主键与幂等唯一键、payloadDigest/expectedRevision/CAS 和租约；阶段与审计同 transaction。原 audit.entries 继续项目级，C04 manifest/reconcile 保持原审计回执，不伪造 deployment 的 ContractReference。运行主体无运维写权限；计划外业务表/枚举/branch/Schema 必须升级。

不重写指标/权重/矩阵、历史风险/评估/人决定，不用工件文件补造领域登记。恢复源完整业务事实保留；Qdrant 可重建但只有通过原门禁才就绪。秘密轮换仅改变凭据/旧会话，不能改历史 actor/version/ref。维护闭合动作持久化的是安全引用/阶段/计数，不保存正文/秘密/内部思维链。

确认控制器使用 project/system 判别及原管理回执；实现同时更新全部本仓库调用方与测试。C36 queryWithSourceGrants 无论完整 projection 是否存在都按质量 queryType 接管，并保留现有逐来源 C06 签发。

增量配置/秘密按 D-23 归 adapters/model；core model 请求、结果和错误 Schema 保持不变。serviceContractRef 映射原 serverBuildRef 的协议身份，不伪造供应商构建。部署角色允许合置；后端 registry 在监听前冻结，不要求网络条目提供权重或 llama.cpp 专用元数据。IP-15 复用 C04/C06/预算逻辑，不新增业务表或迁移。IP-16 保留 synthetic 的命令身份及 submitted 状态，正式结果只读证明归现有拥有方；新 checkpoint/report 是验收证据，不替代领域事实。

## 6. 验收证据矩阵

下面逐项映射当前九份 delta 的 Requirement/Scenario。工程协议测试与真实功能报告分别保存；当前必需场景不能 skip。条件适用于最终制包/禁网/本地模型/硬件的行明确归 C38，F-ID 指 tasks 的移交表；它们仍保留最终契约，不能用当前结果冒称已验收。

| Requirement / Scenario | 阶段 / IP-ID | 测试文件与前置 | 可观察断言 | 可运行命令或最终移交 |
| --- | --- | --- | --- | --- |
| platform/engineering-baseline / 单一生产 workspace / 发现全部生产成员 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 恰好四 apps 三 packages，demo 不在生产图 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 单一生产 workspace / Demo 不进入生产依赖图 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 恰好四 apps 三 packages，demo 不在生产图 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 冻结安装成功 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 清单与锁文件不一致 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 不受支持的 Node 主版本 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 全 workspace 构建 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 公开入口可解析 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 深层导入被拒绝 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 强制单向依赖边界 / 合法依赖图 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 合法图通过；Desktop→其它 app 与反向依赖拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 强制单向依赖边界 / 反向或跨应用依赖 | C37：工程/适用功能；IP-01 | scripts/check-dependency-policy.test.ts | 合法图通过；Desktop→其它 app 与反向依赖拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 两种入口访问同一业务对象 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 原型数据或页面遗漏 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 越界导航或本机调用 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 基础上传与下载 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 有效证书与真实登录 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 证书失败或权限撤销 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 首次连接失败与恢复 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 窗口关闭后任务继续 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 命令响应丢失与订阅重连 | C37：工程/适用功能；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 真实客户端/权限/TLS/共享对象/原任务与命令身份；不要求正式包 | `pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`；`pnpm test:browser` |
| platform/electron-https-client / 桌面功能验收与正式离线发布分阶段 / C38 无公网环境安装正式客户端 | C38 最终 F-01/F-02；IP-09 / IP-13 / IP-16 | 正式安装包、原生目标平台及 C38 验收程序 | 签名/平台/离线安装的最终真实身份和场景 | C38 补齐正式平台命令后制包/安装取证 |
| platform/electron-https-client / 桌面功能验收与正式离线发布分阶段 / C37 功能验收与 C38 平台证据缺失 | C37：阶段范围；C38：正式平台；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 当前真实功能 PASS 不冒称最终平台完成；缺未来材料不阻塞当前 | `node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>`；Finalizer 核对范围 |
| platform/electron-https-client / 桌面功能验收与正式离线发布分阶段 / 兼容界面更新与正式平台证据 | C37：阶段范围；C38：正式平台；IP-09 / IP-13 / IP-16 | apps/desktop/test/security.test.ts、e2e/client.spec.ts；真实功能 HTTPS 与当前平台构建 | 当前真实功能 PASS 不冒称最终平台完成；缺未来材料不阻塞当前 | `node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>`；Finalizer 核对范围 |
| platform/offline-private-deployment-and-operations / 当前功能验收与最终部署交付必须分开收口 / 无目标硬件完成当前功能验收 | C37：功能范围；C38 最终证据另取；IP-15 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；真实服务/网络模型及正式业务引用 | 当前正式终态/审计/追溯、失败不冒称通过；未来硬件/介质不阻塞当前 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；`node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` |
| platform/offline-private-deployment-and-operations / 当前功能验收与最终部署交付必须分开收口 / 网络 API 或真实业务证据缺失 | C37：功能范围；C38 最终证据另取；IP-15 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；真实服务/网络模型及正式业务引用 | 当前正式终态/审计/追溯、失败不冒称通过；未来硬件/介质不阻塞当前 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；`node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 真实跨 VM 写入与读取 | C37：工程/适用功能；IP-03 | packages/adapters/test/artifacts/remote-artifact-store.test.ts | 原 C04 回执/引用/流校验；截断与越权拒绝 | `pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 断流或传输身份越权 | C37：工程/适用功能；IP-03 | packages/adapters/test/artifacts/remote-artifact-store.test.ts | 原 C04 回执/引用/流校验；截断与越权拒绝 | `pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 完整来源装配并保留质量查询授权 | C37：工程/适用功能；IP-04 | packages/adapters/test/deployment/policies-readers.test.ts | 精确来源与版本；真实门禁拒绝；C36 资料过滤 | `pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts` |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 策略漂移或质量门禁失败 | C37：工程/适用功能；IP-04 | packages/adapters/test/deployment/policies-readers.test.ts | 精确来源与版本；真实门禁拒绝；C36 资料过滤 | `pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts` |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 阶段重放与权限隔离 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | CAS/唯一键/互斥与 append-only；审计失败无 completed | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 审计失败与授权缺项 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | CAS/唯一键/互斥与 append-only；审计失败无 completed | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 客户端只访问应用入口 | C37：工程/适用功能；IP-10 | scripts/deployment/release.test.mjs | 客户端仅 HTTPS；三 VM 内部端口受限；同机恢复边界 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 同机副本与宿主故障边界 | C37：工程/适用功能；IP-10 | scripts/deployment/release.test.mjs | 客户端仅 HTTPS；三 VM 内部端口受限；同机恢复边界 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 断网环境完成安装 | C38 最终 F-03；IP-10 / IP-14 | 最终真实环境/批准介质与阈值；C38 完整执行程序 | 实测身份、命令/报告和真实效果；配置校验不能通过 | C38 补齐真实执行入口后运行 `deployment:verify / smoke / benchmark` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 制品不完整或不匹配 | C38 最终 F-03；IP-10 / IP-14 | 最终真实环境/批准介质与阈值；C38 完整执行程序 | 实测身份、命令/报告和真实效果；配置校验不能通过 | C38 补齐真实执行入口后运行 `deployment:verify / smoke / benchmark` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 已验收界面尚未进入生产构建 | C37：工程/适用功能；IP-10 | scripts/deployment/release.test.mjs | 禁网安装、精确制品校验；缺项非零且不启动 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 同一配置可重放 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 配置非法或秘密不可用 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 秘密轮换保持历史可追溯 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 空实例初始化成功 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 初始化重放或部分失败 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 运行主体试图越权 | C37：工程/适用功能；IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 真实实例完成请求和后台消费 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 缺少必需接线 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 进程重启与事件重投 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 有界停止未能完成 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 安全同源访问和重连 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 依赖失败或正在维护 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 慢探针或无权查询 | C37：工程/适用功能；IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / 联网推理完成业务链路 | C37：功能范围；C38 最终证据另取；IP-15 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；真实服务/网络模型及正式业务引用 | 当前正式终态/审计/追溯、失败不冒称通过；未来硬件/介质不阻塞当前 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；`node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / 预置服务身份与真实协议匹配 | C38 最终 F-03；IP-10 / IP-14 | 最终真实环境/批准介质与阈值；C38 完整执行程序 | 实测身份、命令/报告和真实效果；配置校验不能通过 | C38 补齐真实执行入口后运行 `deployment:verify / smoke / benchmark` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / OCR 饱和或崩溃 | C37：工程/适用功能；IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实模型/OCR 身份、独立预算；缺环境失败 | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / 模型制品或资源证明缺失 | C38 最终 F-03；IP-10 / IP-14 | 最终真实环境/批准介质与阈值；C38 完整执行程序 | 实测身份、命令/报告和真实效果；配置校验不能通过 | C38 补齐真实执行入口后运行 `deployment:verify / smoke / benchmark` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 完整停写备份成立 | C37：工程/适用功能；IP-11 | scripts/deployment/backup.test.mjs | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 停写失败或工程授权不完整 | C37：工程/适用功能；IP-11 | scripts/deployment/backup.test.mjs | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 复制、空间或耐久记录失败 | C37：工程/适用功能；IP-11 | scripts/deployment/backup.test.mjs | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 同键重试与异载荷冲突 | C37：工程/适用功能；IP-11 | scripts/deployment/backup.test.mjs | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 隔离恢复与原实例并存 | C37：工程/适用功能；IP-12 | scripts/deployment/restore.test.mjs | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 缺失、损坏或快照不匹配 | C37：工程/适用功能；IP-12 | scripts/deployment/restore.test.mjs | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 索引重建与正式空结果 | C37：工程/适用功能；IP-12 | scripts/deployment/restore.test.mjs | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 人工切换、拒绝与重复操作 | C37：工程/适用功能；IP-12 | scripts/deployment/restore.test.mjs | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 兼容版本回退 | C37：功能范围；C38 最终证据另取；IP-12 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；生产宿主、真实服务/网络模型及正式业务引用；可见外部 Chrome | 当前正式终态/审计/追溯；用户可见浏览器完成业务操作；headless 不能替代观看验收；失败不冒称通过 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；生产宿主上 `node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` 并在可见外部 Chrome 验收 |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 不兼容回退或缺少真实证据 | C37：功能范围；C38 最终证据另取；IP-15 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；生产宿主、真实服务/网络模型及正式业务引用；可见外部 Chrome | 当前正式终态/审计/追溯，失败不冒称通过；用户可见浏览器完成业务操作；headless 不能替代观看验收 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；生产宿主上 `node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` 并在可见外部 Chrome 验收 |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 在批准目标硬件形成基准 | C38 最终 F-04；IP-14 | 最终真实环境/批准介质与阈值；C38 完整执行程序 | 实测身份、命令/报告和真实效果；配置校验不能通过 | C38 补齐真实执行入口后运行 `deployment:verify / smoke / benchmark` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 目标环境未齐时完成工程检查 | C37：功能范围；C38 最终证据另取；IP-15 / IP-16 | scripts/acceptance/functional.test.mjs；原 restore.test.mjs；生产宿主、真实服务/网络模型及正式业务引用；可见外部 Chrome | 当前正式终态/审计/追溯；用户可见浏览器完成业务操作；headless 不能替代观看验收；失败不冒称通过 | `pnpm exec vitest run scripts/acceptance/functional.test.mjs scripts/deployment/restore.test.mjs`；生产宿主上 `node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>` 并在可见外部 Chrome 验收 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 配置化部署调用成功 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 业务不能选择模型名 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 部署能力或版本不匹配 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 双重约束后的结构化结果成功 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 冻结模式、精确协议/模型、Zod 严格收口、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / Schema 提示与本地严格复验 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 同一 Zod Schema 转换并进入固定 system 消息；本地严格复验最终生效 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 非法 JSON 结构失败 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 非法、额外字段、截断均失败，不修补、不重试、不回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / Zod 复验失败 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts | Zod 失败返回闭合错误与受保护诊断，服务约束不替代业务校验 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 服务端 Schema 约束缺少证据 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts | 无服务端执行证据时拒绝 server-json-schema 配置/就绪 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 输出 Schema 无法安全转换 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts | 转换失败前置拒绝，不退化纯文本 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / reasoning 内容不进入持久化或展示 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts | C04 与外部输出剔除 reasoning_content，正文走既有受保护访问边界 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts` |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 测试替身不进入生产导出 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 真实服务走通三项能力 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 真实服务不可用不会被跳过为成功 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 当前网络 API 形成三能力证据 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 合法联网后端被业务复用 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 无权资料或秘密进入客户端 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 网络协议失败保持原错误边界 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 后端切换不得复用旧向量空间 | C37：网络 API / 通用契约；llama.cpp 实机：C38；IP-15 | network-api-model-gateway.test.ts / .smoke.test.ts；原 llamacpp-model-gateway.test.ts（均在 packages/adapters/test/model） | 精确协议/模型、严格输出、原权限/预算/C04 引用；不换模型或假回退 | `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`；实际三能力另按下表 network smoke 命令取证 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 普通命令确认后提交一次 | C37：工程/适用功能；IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 高影响命令要求显式二次确认 | C37：工程/适用功能；IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无权限确认卡不可提交 | C37：工程/适用功能；IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 陈旧版本确认失败 | C37：工程/适用功能；IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无工程的系统管理确认 | C37：工程/适用功能；IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 页面渲染当前工程的真实事实 | C37：工程/适用功能；IP-08 | apps/web/test/browser/read-only.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 写操作入口不存在 | C37：工程/适用功能；IP-08 | apps/web/test/browser/read-only.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成只读链路 | C37：工程/适用功能；IP-08 | apps/web/test/browser/read-only.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | C37：工程/适用功能；IP-08 | apps/web/test/browser/read-only.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 页面渲染当前工程的真实事实 | C37：工程/适用功能；IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 假写入口不存在 | C37：工程/适用功能；IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成识别与复核链路 | C37：工程/适用功能；IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | C37：工程/适用功能；IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 真实数据与页面可达 | C37：工程/适用功能；IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 工程切换与失败 | C37：工程/适用功能；IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 必须以真实浏览器验收业务接缝 / 真实闭环与失败边界验收 | C37：工程/适用功能；IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 已接通页面与 v2 分区一致 | C37：工程/适用功能；IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 刷新切换与服务异常 | C37：工程/适用功能；IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 真实浏览器完成 C35 链路 | C37：工程/适用功能；IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 慢读和环境缺失 | C37：工程/适用功能；IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |

当前共同验证：`pnpm verify && pnpm test:browser && pnpm test:deployment`，另取 IP-13 当前平台 Electron、IP-15 真实 network smoke、IP-16 正式业务终态报告。仓库级门禁失败仍须按项目边界处理，延后现场验收不授权跳过门禁。

| 命令/入口 | 当前作用与后续落实 | 所有权 |
| --- | --- | --- |
| pnpm test:deployment | 已有工程测试；保持真实必要依赖与失败边界 | IP-02–IP-14 |
| pnpm test:desktop | 当前仅 Vitest security/packaging；不是 Electron 实跑证据 | IP-13；正式安装归 C38 F-02 |
| pnpm exec playwright test -c playwright.desktop.config.ts | 当前平台构建运行；13.1 补齐完整客户端功能场景，预检不要求签名/正式包 | IP-13 / IP-16 |
| pnpm desktop:package / deployment:verify | 已有正式介质程序；C38 须独立核验调用/实际产物，不能由当前测试推定完整 | C38 F-01/F-03 |
| pnpm deployment:smoke / deployment:benchmark | 当前只执行 acceptance.mjs 配置校验；真实场景执行/资源采集未完成，不作真实证据 | C38 F-03/F-04 |
| node scripts/deployment/start.mjs | 本次计划新增；真实初始化检查、完整公开 provider 装配、API/Worker 生命周期；配置路径按 D-22/D-23 | IP-16 |
| RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts | 本次计划新增；真实网络三能力与 C04 证据，无服务/关键 skip 非零 | IP-15 |
| node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir> [--resume] | 本次计划新增；复用 synthetic，证明正式异步终态/证据，不将 submitted 当完成 | IP-16 |

计划新增的源码/测试尚不存在；只有对应 apply 任务实施后才运行它们。真实 network smoke 的配置/秘密环境路径见 D-22，functional 配置示例由 IP-16 新增；当前正式模型/协议资格与受限秘密须在运行前提供。llama.cpp/OCR 本地介质 smoke 由 C38 显式运行，不以默认 skip 记最终通过。

## 7. 文件清单与升级条件

IP-05/IP-16 C30 引用证明：`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 增加 verifyCheckpointReference 布尔公开接缝，复用原当前授权、readRow 与 C04 verifyContent；`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` 扩展原精确登记场景，核对阶段/路线/错误/结果、错运行/版本/权限、正文损坏及零写入。既有 workflow/index.ts 类型出口承载新方法，无新迁移、依赖或事实表。

IP-04 受控策略加载：`scripts/deployment/start.mjs` 的 loadDeploymentPoliciesV1 与数据集共用受控、有界文件读取；`scripts/deployment/entrypoints.test.mjs` 的真实文件夹具及越界、链接、超额场景同步，目录以原 releaseId 绑定批准发布。D-19 的策略清单数量按 D-20 的十六类同步，无新增配置字段或依赖。

IP-05/IP-16 宿主运行证明：`packages/adapters/src/postgres/transaction-unit.ts` 的 readWorkflowRunBinding 增加可选 actorId/authorizationContextRef 筛选并核对原审计，原调用方不变；`packages/adapters/test/postgres/postgres-foundation.test.ts` 扩展既有启动收据真实场景。`scripts/deployment/start.mjs` 的生产引用校验组合当前 C06、工程精确图版本、原启动/父子身份、既有识别身份派生与所属模块证明；`scripts/deployment/entrypoints.test.mjs` 验证缺上下文、身份漂移、未支持引用和模块证明失败。未支持路径失败闭合且不记完整宿主完成。

IP-03/IP-05/IP-16 无写入正文证明：`packages/core/src/artifacts/store.ts` 增加可选 verifyContent 服务端窄口；`packages/adapters/src/artifacts/filesystem-artifact-store.ts` 复用原私有 open/流核验但跳过全部访问/诊断写入，完整有界消费后返回所属模块 boolean；`packages/adapters/src/artifacts/index.ts` 的本地 handle 透传，`scripts/deployment/start.mjs` 的受权包装透传且每次复验 C06。C24 verifyCheckpointReference 与 C15 准备证明消费该口；扩展 `packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 及 C24/C15 真实测试，覆盖摘要损坏、范围/用途/大小拒绝和审计/工件/回执计数不增。普通 open 沿原审计；无远程协议、依赖或迁移增量。

IP-05/IP-16 C15 准备引用证明：`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` 提取 readExactPreparation 的私有共用精确解析，增加 verifyPreparationReference（D-21），保留原回执/审计行为且证明不写入；`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` 扩展既有真实准备场景覆盖精确版本、主体/工程/撤权与校验不增回执/审计。既有 class 出口承载新方法，无新依赖或表。

IP-05/IP-16 所属模块证明：`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts` 增加 verifyRecommendationCandidateReference（D-21），复用原私有精确候选读取和当前 read 权限，核对冻结父运行及精确空间版本，仅返回 boolean；既有 index.ts 星号导出具体 adapter 无需新增导出层。`packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` 扩展真实候选场景覆盖不存在、错版本/运行/工程、无权和只读不增事实。`scripts/deployment/start.mjs` 组合生产引用验证器，`scripts/deployment/entrypoints.test.mjs` 覆盖缺上下文、当前权限、精确启动身份和不支持引用失败闭合。无新依赖或表。

IP-05/IP-16 只读授权：`packages/adapters/src/auth/deployment-authorization.ts` 将原有界关联解析复用于 readDownstreamContext，返回既有 context/branch/invocationId，复验 root/目标及范围，不签发或补写；resolveDownstreamContext 保留原派生调用行为。`packages/adapters/test/auth/local-identity-project-authorization.test.ts` 扩展既有关联场景，覆盖后代 root、撤权、无关联和上下文/审计计数不增。auth/index.ts 的既有星号导出承载新接口，无新表。

IP-05/IP-16 C24 图引用证明：`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` 的 adapter 接口与实现增加 verifyCheckpointReference（D-21），复用已有当前权限、精确登记行及 C04 正文，使用原签发 invocationId；`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` 扩展原 PostgreSQL 登记场景，验证错版本/运行/权限与回滚。既有子路径导出承载接口，不新增通用数据库入口。

IP-05/IP-16 检查点增量（D-21）：新增 `packages/core/src/persistence/checkpoint.ts` 并由 persistence/index.ts 导出唯一 CheckpointRuntimeContextV1Schema/configurable 键；扩展 `packages/adapters/src/postgres/checkpointer.ts`、`index.ts` 的引用校验第二参数（操作、state、runtimeContext）及上下文一致性验证，保留原引用首参数和独立 checkpoint 连接。三图 `apps/worker/src/{assessment,identification/graph,risk-flow}/runtime.ts` 的 invoke/retry/resume/recover/getState 传递本次上下文。`packages/contracts/src/workflows/index.ts` 的评估 entrySnapshotRef 在 A0 可省略，后续必需；`apps/worker/src/assessment/runtime.ts` 删除 seed，graph.ts 消费点保持缺失失败。扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`、`apps/worker/test/assessment/runtime.test.ts` 覆盖启动无虚假引用、后续缺快照拒绝、上下文/工程/运行错配、四种操作以及缺失/回滚引用。生产 validator 在 start.mjs 组合，所属模块窄读具体文件按精确引用映射补入此节后实施。无依赖、DDL 或第二引用登记表，不勾选未完成宿主任务。

同一 IP-ID：`apps/worker/src/identification/graph/graph.ts` 的运行上下文携带原已签发 invocationId；`packages/core/src/workflow/service.ts` 与 `packages/adapters/src/workflow/postgres-workflow-adapter.ts` 增加 readAssessmentEntrySnapshot 精确受权窄读，API不开放；评估 A0 graph.ts 写既有 inputSnapshotRef，runtime.ts 异步 stateOfCursor 读正式入口，原测试 adapter 使用真实窄口。`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` 扩展既有受权读取用例（如测试分片归 runtime.test.ts 则复用，不重复）。不修改历史迁移。

IP-05/IP-16 入口登记迁移：新增 `packages/adapters/src/postgres/migrations/workflow/deliver-offline-private-deployment-and-operations/000058_assessment_entry_snapshot_reference.ts`，只变更 entry-snapshot 对 input_snapshot_ref 的可选配对，保留其余配对与已登记行；down 不兼容时拒绝回退。`packages/adapters/test/postgres/postgres-foundation.test.ts` 与 `packages/adapters/test/auth/fixture.ts` 注册此迁移；`packages/adapters/test/deployment/config-operations.test.ts`、`deployment/release-manifest.example.json` 更新最终版本 000058。复用真实 C30 三入口登记/读取及 Worker 恢复/取消回归，普通测试不得记预期失败。

同一 IP-ID 的初始运行证明：`packages/adapters/src/postgres/transaction-unit.ts` 增加 readWorkflowRunBinding 公共 boolean 窄读，保持 C03 私表访问在所属模块；`apps/worker/src/risk-flow/runtime.ts` 的原绑定携带 threadId，`apps/worker/src/assessment/runtime.ts` 的 start 在图调用前登记原启动收据/审计；不增表。扩展既有 foundation/runtime 测试覆盖同载荷重放、错工程/运行版本/线程、未提交或回滚收据拒绝。

同一窄读支持精确 parentRunRef 因果证明，连接原启动审计并核对 action/target/run/thread；`apps/worker/src/identification/graph/runtime.ts` 与 assessment/runtime.ts 的启动 reasonRef 保存原父运行。复用 foundation 与两子图 runtime 测试，覆盖相同工程不同父运行/版本和缺失因果关系，不造第二运行注册表。

IP-05/IP-06/IP-16 SSE 增量：新增 `packages/adapters/src/postgres/migrations/workflow/deliver-offline-private-deployment-and-operations/000057_workflow_run_events.ts`，按 D-21 创建仅引用的耐久关联、同事务触发器/工程顺序锁、精确历史回填与只读 grants；新增 `packages/adapters/src/workflow/postgres-run-event-reader.ts`，`workflow/index.ts` 导出工厂、options 与逐事件授权回调类型，复用原 DTO/C06 当前复验及来源窄读，固定 64 条批量和事件游标。`apps/api/src/http.ts` 增加可选 runEventSubscription 窄注入位，`apps/api/src/app.ts` 由当前 human-session 为事件精确范围签发新身份，reader 再核对主体并复验；原 subscribe 调用方保留。`scripts/deployment/start.mjs` 及 API 组合注入真实 runEvents 并要求逐事件授权方法。新增 `packages/adapters/test/workflow/postgres-run-event-reader.test.ts` 验证 ack 后恢复、跨工程/版本游标、撤权、主体替换拒绝和单批上限；扩展 `packages/adapters/test/postgres/postgres-foundation.test.ts` 迁移清单、真实同事务登记/回滚、工程内并发提交顺序与只读权限；扩展 `apps/api/test/http-shell.test.ts` 和 `scripts/deployment/api-ports.test.mjs` 验证来源授权与真实接缝转发；`packages/adapters/test/auth/fixture.ts` 纳入 000057 迁移，`packages/adapters/test/auth/local-identity-project-authorization.test.ts` 以真实 C06 回归逐事件签发、脱敏拒绝及因果与显式 run 引用的历史回填。`deployment/release-manifest.example.json` 的最终迁移版本为 000057；`packages/adapters/test/deployment/config-operations.test.ts` 的最新初始化预期同步，000056 历史报告不改写。没有新依赖或 HTTP/core Schema；文件归以上 IP-ID，迁移只由显式初始化/升级运行。

IP-05/IP-16 预测运行时接缝增量：`packages/adapters/src/response-lifecycle/forecast-executors.ts` 新增 createProductionEffectForecastExecutorResolverV1，复用原 createExecutor，`index.ts` 导出；`postgres-response-lifecycle-adapter.ts` 的 forecastExecutors 保留数组并接受同步窄 resolver，原受权正文核验后才解析，返回身份不符沿原 unavailable 收口。`scripts/deployment/composition/assessment.mjs` 消费该 resolver，删除启动期 forecastPolicies 要求。扩展 `packages/adapters/test/response-lifecycle/forecast-executors.test.ts`、`postgres-response-lifecycle-adapter.test.ts` 及 `scripts/deployment/assessment-composition.test.mjs` 验证运行时策略、缺发布与错执行器身份，并保留数组回归；同目录 `fixture.ts` 仅增加可选执行器来源注入，默认数组保持。无新依赖、迁移或 core/HTTP DTO；以上新增计划文件归此 IP-ID。

原 IP-01–IP-14 文件表保留供既有实现及必要范围内修复追溯；当前无需为未来正式交付补造未创建的 install/smoke/benchmark 或平台介质文件。正式介质、完整现场执行和资源采集的新增内容归 C38 F-01–F-05，其 allowlist 由 C38 自身规划闭合。IP-15/IP-16 的增量 allowlist 如下；同一文件串行改动，不覆盖他人改动。core 领域 DTO、历史迁移、执行图与锁文件保持保护边界。

**已批准补齐的基线缺口**：D-19 部署配置、D-20 全类型 catalog/真实 reader、IP-05 生产组合及受控资料预置纳入 C37。任务 2.1、2.3、4.1、4.3、5.1–5.3 按实际义务重新打开，保留已有工程证据；对应契约先由主 Agent 闭合，再实施。IP-04 的策略目录按 D-20 逐类型复用原 Schema、精确版本键与类型推导，修正 hybrid runtime 使用 acceptance Schema 的错误，新增隔离合成验收 purpose；扩展现有 policies-readers 行为测试覆盖实际正文/ref、缺项/漂移、深冻结及多版本解析。

IP-02/IP-16 的 projectBindings 必填十六类 policyRefs、三图 graphVersions、retrievalBudgetPolicyRef、forecastPolicyReleaseRef、calibrationTargetReleaseRef 与有界 siteContextBindings，配置测试核对缺项、重复工程与重复现场版本拒绝；新增 scoring-rules/report-export 直接复用原 Schema。IP-05 在装配前逐项精确解析并核验成员身份。IP-16 基础宿主加载发布清单 finalMigrationVersion，副作用前核验兼容，初始化与运行保持分离。

IP-02/IP-04/IP-16 按 D-19 补齐 retrievalQuality strict 配置。schema.ts 与 config.example.json 登记 datasets 的精确工程/引用/受控文件路径、containerRuntime 与 timeoutMs；config-operations.test.ts 扩展缺项、重复精确键、工程越界和路径越界的现有行为用例。start.mjs 公开受控数据集加载与报告保存入口，entrypoints.test.mjs 覆盖文件/正文身份漂移、符号链接、正式实例拒绝合成数据集和保存失败；质量门禁继续复用 composition/quality-gate.mjs 的真实测量，不复制阈值。API/Worker 在创建连接前加载，provision 不读取待预置数据集。报告按原验收 Schema 保留并绑定实例/发布/配置，在 logRoot/retrieval-quality 耐久保存后才能返回判定；无新依赖或迁移。

| 新增 Scenario | IP-ID / 文件 | 行为与证据 |
| --- | --- | --- |
| 合成验收资料预置必须使用正式权限与模块入口 / 文本资料通过受控预置并按原身份重试 | IP-16；provision.mjs / provision.test.mjs / start.mjs | 真实登录、原模块写入、正式结果引用、安全 checkpoint；失败续接保留原命令身份。单测及真实预置报告共同证明。 |
| 合成验收资料预置必须使用正式权限与模块入口 / 无权、版本不符或缺 OCR 时明确阻塞 | IP-16；provision.mjs / provision.test.mjs | 无权不写入，错版本拒绝；扫描件无 OCR 记录 BLOCKED，文本样例沿原转换入口。 |

| 文件 | IP-ID | 增量动作 |
| --- | --- | --- |
| `packages/adapters/src/model/config.ts` | IP-15 | 新增 D-23 strict 网络配置/精确后端条目；保留原 llama.cpp Schema |
| `packages/adapters/src/model/network-api-model-gateway.ts` | IP-15 | 新增网络协议 adapter，复用公共调用运行逻辑 |
| `packages/adapters/src/model/model-gateway-runtime.ts` | IP-15 | 从原 llama.cpp 实现提取公共授权、预算、原始响应/诊断与有界解析逻辑；两个 adapter 共用 |
| `packages/adapters/src/model/llamacpp-model-gateway.ts`、`index.ts` | IP-15 | 消费共用逻辑、导出新 adapter/config；本地部署探针保持原行为 |
| `packages/adapters/test/model/network-api-model-gateway.test.ts`、`network-api-model-gateway.smoke.test.ts` | IP-15 | 新增稳定三能力/失败/预算/秘密边界及显式真实 smoke |
| `packages/adapters/test/model/llamacpp-model-gateway.test.ts` | IP-15 | 复用既有行为回归，只有公共接缝变化才调整 |
| `packages/adapters/src/deployment/secrets.ts`、`schema.ts`、`observability.ts` | IP-15 / IP-16 | 受限凭据定位、三个逻辑角色可合置、模型健康记录实际所选后端；不伪造 GPU/构建 |
| `packages/adapters/test/deployment/config-operations.test.ts`、`observability.test.ts` | IP-15 / IP-16 | 扩展后端选择/受限秘密/合置角色/健康失败的现有行为测试 |
| `scripts/deployment/start.mjs` | IP-16 | 新增真实组合及显式启动 CLI，导出可测试组合入口；API/Worker 仍分别运行 |
| `scripts/deployment/provision.mjs`、`provision.test.mjs` | IP-16 | D-24 受控资料预置、原公共 Schema/真实权限与安全结果；复用宿主，不复制测试 SQL |
| `packages/adapters/src/postgres/index.ts`、`artifacts/index.ts` | IP-02 / IP-03 / IP-16 | 公开既有运行连接与同事务 transactionUnit、referenceGuard factory；保护内部事务接缝 |
| `packages/adapters/src/deployment/initialization.ts` | IP-02 / IP-16 | 受限 LOGIN 密码、精确迁移兼容及真实 checkpoint setup；重放保留原密码 |
| `deployment/config.example.json` | IP-02 / IP-16 | 同步 D-19 完整 strict 部署输入，只有结构示例无秘密 |
| `scripts/deployment/release.test.mjs` | IP-02 / IP-16 | 复用既有配置示例 Schema 校验，原发布介质行为保持 |
| `scripts/deployment/runtime.mjs`、`lifecycle.mjs`、`events.mjs` | IP-16 | 复用原资源释放、一次绑定、事件闭包与耐久消费；补实际 provider 接线 |
| `scripts/deployment/entrypoints.test.mjs`、`composition.test.mjs`、`lifecycle.test.mjs` | IP-16 | 扩展当前公开启动/接线行为测试，缺 provider 不就绪 |
| `scripts/acceptance/functional.mjs`、`functional.test.mjs` | IP-16 | 新增原 check/run 组合、有限终态观察与安全结果报告及代表性行为测试 |
| `scripts/acceptance/synthetic.mjs`、`synthetic.test.mjs` | IP-16 | 复用既有导出与登录/捕获/checkpoint；必要公开只读 helper，保留 submitted 语义 |
| `apps/desktop/test/e2e/client.spec.ts`、`acceptance.mjs`、`playwright.desktop.config.ts` | IP-13 / IP-16 | 当前平台 Electron 行为；IP-16.3 在生产宿主上的功能验收须使用用户可见外部 Chrome，headless 不能替代观看；正式安装包验收归 C38 |
| `deployment/model-gateway-config.example.json`、`functional-run-config.example.json`、`ACCEPTANCE.md`、`OPERATIONS.md` | IP-15 / IP-16 / IP-14 | 新增网络/功能配置结构示例与当前运行手册，示例不含秘密或可冒充批准值的假版本 |
| `AGENTS.md`、桌面架构说明与本 change 工件 | IP-14 / IP-16 | 本轮同步阶段边界；后续 apply 消费批准输入，不擅自改规划 |
| `packages/adapters/src/deployment/schema.ts`、`readers.ts`、`quality-gate.ts` | IP-04 / IP-16 | D-20 补充现场材料包及有界检索数据集 Schema；现场原正文精确 C04 读取，实际三路检索测量复用原验收计算 |
| `packages/adapters/test/deployment/policies-readers.test.ts` | IP-04 / IP-16 | 扩展现有测试覆盖重复键、合成标记、实际发布成员绑定、有界读取与实际测量身份，不断言提示文案 |
| `references/acceptance/synthetic-v1/site-contexts.json`、`retrieval-dataset.json`、`README.md` | IP-16 | 新增经用户批准的五工序现场资源/约束与六类机理检索材料；本地版本键须通过真实回执替换，候选相关性不进入模型输入 |
| `packages/adapters/src/recommendation/postgres-recommendation-adapter.ts`、`packages/adapters/package.json` | IP-04 / IP-05 | 公开工厂透传既有 authorizeDownstream 可选参数，补 C33 已有 adapter 公开出口；无新依赖 |
| `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` | IP-04 | 复用真实 registry fixture 验证 listDeploymentProjects 的工程 keyset、当前版本和已登记范围，不直接补 SQL 业务事实 |
| `scripts/deployment/composition/quality-gate.mjs`、`scripts/deployment/quality-gate.test.mjs` | IP-04 / IP-05 / IP-16 | 适配原 C20 构建门禁，真实 Embedding/Qdrant 三路测量；小型行为用例验证指标计算、错成员/代际、拒权/截止时间；替身仅用于计算契约测试 |
| `scripts/deployment/api-ports.test.mjs` | IP-05 / IP-16 | 生产 API 全端口装配、缺项拒绝及原处置命令分派的代表性行为检查 |
| `scripts/deployment/composition/calibration-task.mjs`、`scripts/deployment/calibration-task.test.mjs` | IP-05 / IP-16 | 原校准任务的冻结快照/基准精确读取、真实校验工件保存及确定性结果收口；复用 C29/C08 原 Schema 与算法 |
| `scripts/deployment/risk-flow-composition.test.mjs` | IP-05 / IP-16 | C30 按工程精确图版本与重试策略装配、缺输入拒绝及公开父运行端口分派 |
| `packages/adapters/src/identification/read/postgres-standardized-risk-input-facts-reader.ts`、`packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts` | IP-04 | 复用精确已验收记录及两阶段授权读取空间/来源和识别运行登记，不改变 RiskInputFactsV1 |
| `scripts/deployment/assessment-composition.test.mjs` | IP-05 / IP-16 | 评估、预警、处置、预测及校准生产工厂的真实接线和精确策略解析检查 |
| `packages/contracts/src/ports/index.ts`、`packages/core/src/access/schema.ts`、`packages/adapters/src/auth/postgres-local-identity-access.ts`、`deployment-authorization.ts`、`scripts/deployment/start.mjs` | IP-04 / IP-16 | D-20 受限发布命令因果引用及 system 二选一授权；C06 核对原签发、精确关联、固定构建分支、当前权限和期限，保留 workflow/Agent 原契约，不新增持久列 |
| `packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/auth/local-identity-project-authorization.test.ts`、`scripts/deployment/entrypoints.test.mjs` | IP-04 / IP-16 | 命令因果 Schema、合法发布构建及错命令/根/父/分支拒绝、事件来源恢复；createDeploymentRuntimeAuthorizationV1 原签发身份复验、派生分支签发、撤权/过期与技术故障区分 |
| `apps/worker/src/identification-knowledge/composition.ts`、`apps/worker/test/identification-knowledge/composition.test.ts` | IP-04 / IP-05 | C17 受信 system 来源透传原命令因果，与 workflow-run 严格二选一；可选注入 C18/C19 原治理策略，返回同一 C16 的 governedReleases 窄口，不增加第二治理实例或同类型 Agent 定义 |
| `scripts/deployment/composition/identification.mjs`、`scripts/deployment/composition.test.mjs` | IP-05 / IP-16 | 生产组合透传已绑定 C18/C19 治理策略；范围外 C19 Agent 编制明确拒绝，配置包仍使用正式治理/发布/解析 |
| `packages/core/src/scoring-rules/schema.ts`、`validation.ts`、`packages/core/test/scoring-rules/scoring-rules.test.ts` | IP-04 / IP-16 | D-20 配置包与正文来源互斥 Schema，原规则校验复用，证明混用来源/悬空证据/版本漂移拒绝 |
| `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`、`packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`、`fixture.ts` | IP-04 / IP-16 | 正式包 C04 读取、C06 来源核验、C18 精确集合及摘要核验、原比较基线读取与 C16/C07 发布门禁；新增可选 authorizeConfigurationRead 原分支窄授权口 |
| `references/acceptance/synthetic-v1/rules/scoring-configuration-package.json`、`manifest.json`、`README.md`、`scripts/acceptance/synthetic.mjs`、`synthetic.test.mjs` | IP-16 | 从批准样例形成配置包输入，按真实预置回执绑定来源/工程/配置版本与包工件，单独记录待复核；不构造 Agent 任务 |


| 文件 | IP-ID | 操作 |
| --- | --- | --- |
| `package.json` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `pnpm-workspace.yaml` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `pnpm-lock.yaml` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `tsconfig.json` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `config/dependency-policy.json` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `dependency-cruiser.config.cjs` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/check-dependency-policy.mjs` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/check-dependency-policy.test.ts` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `openspec/config.yaml` | IP-01 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/index.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/schema.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/secrets.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/operations.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/initialization.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/postgres/index.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/postgres/database.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/postgres/migrations/platform/deliver-offline-private-deployment-and-operations/000056_deployment_operations.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/package.json` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/test/deployment/config-operations.test.ts` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/cli.mjs` | IP-02 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/artifacts/remote-artifact-store.ts` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/artifacts/artifact-stream-service.ts` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/artifacts/postgres-artifact-registry.ts` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/artifacts/index.ts` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/test/artifacts/remote-artifact-store.test.ts` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/serve-artifacts.mjs` | IP-03 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/policies.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/quality-gate.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/readers.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/auth/deployment-authorization.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/auth/index.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/engineering-data/context-source/index.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/assessment-config/postgres-assessment-configuration-adapter.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/identification/candidate-finalization/index.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/test/deployment/policies-readers.test.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/auth/postgres-local-identity-access.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/test/auth/local-identity-project-authorization.test.ts` | IP-04 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/runtime.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/composition/identification.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/composition/assessment.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/composition/risk-flow.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/composition/api-ports.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/composition.test.mjs` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/api/src/app.ts` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/api/test/quality.test.ts` | IP-05 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/serve-api.mjs` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/serve-worker.mjs` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/events.mjs` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/lifecycle.mjs` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/lifecycle.test.mjs` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/src/deployment/observability.ts` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `packages/adapters/test/deployment/observability.test.ts` | IP-06 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/package.json` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/main.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/app/App.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/app/routes.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/app/state.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/api/http.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/api/openapi.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/api/errors.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/shared/confirmation.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/shared/CommandConfirmationDialog.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/shell/AppShell.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/shell/navigation.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/shell/dock/RightDock.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/quality/operation.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/api-client-openapi.test.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/routing-context-actions.test.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/confirmation.test.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/focus.test.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/quality.spec.ts` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/quality/QualityPage.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/quality.test.tsx` | IP-07 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/server.mjs` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/deploymentPolicies.mjs` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/agent-audit-operations.spec.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/assessment-warning-response.spec.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/identification-review.spec.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/read-only.spec.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/test/browser/risk-level-response-verification.spec.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/api/context.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/web/src/api/session.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `playwright.config.ts` | IP-08 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/package.json` | IP-01 / IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/tsconfig.json` | IP-01 / IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/src/main.ts` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/src/security.ts` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/src/config.ts` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/resources/connection.html` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/electron-builder.yml` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/test/security.test.ts` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/package-desktop.mjs` | IP-09 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/README.md` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/config.example.json` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/release-manifest.example.json` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/Caddyfile` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/network.md` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-api.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-worker.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-artifacts.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-caddy.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-postgres.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-qdrant.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-model.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/systemd/riskflow-ocr.service` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/release.mjs` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/install.mjs` | IP-10 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/release.test.mjs` | IP-09 / IP-10 | 按对应 §3 动作新增或修改；含平台打包程序工程检查；基线存在与否见下文 |
| `scripts/deployment/maintenance.mjs` | IP-11 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/backup.mjs` | IP-11 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/backup.test.mjs` | IP-11 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/restore.mjs` | IP-12 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/activate.mjs` | IP-12 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/restore.test.mjs` | IP-12 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `playwright.desktop.config.ts` | IP-13 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/test/e2e/client.spec.ts` | IP-13 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `apps/desktop/test/e2e/acceptance.mjs` | IP-13 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `vitest.config.ts` | IP-13 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/smoke.mjs` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/benchmark.mjs` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `scripts/deployment/acceptance.test.mjs` | IP-13 / IP-14 | 按对应 §3 动作新增或修改；含桌面环境预检与部署证据汇总工程检查；基线存在与否见下文 |
| `deployment/OPERATIONS.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/ACCEPTANCE.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `deployment/acceptance-config.example.json` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `AGENTS.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/issues/21-mvp-toolchain-dependencies.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/prototypes/macro-architecture.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/prototypes/full-product-ui-spec.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/prototypes/prototype-v2-guiding-plan.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |
| `.scratch/riskflow-master-plan/prototypes/desktop-client-architecture.md` | IP-14 | 按对应 §3 动作新增或修改；基线存在与否见下文 |

| 文件 | IP-ID | 操作 |
| --- | --- | --- |
| `apps/worker/src/engineering-data/cleaning/composition.ts` | IP-05 | 增加/验证可选共享 registry 注入，原缺省行为保持 |
| `apps/worker/src/identification-knowledge/composition.ts` | IP-05 | 增加/验证可选共享 registry 注入，原缺省行为保持 |
| `apps/worker/test/engineering-data/cleaning/composition.test.ts` | IP-05 | 增加/验证可选共享 registry 注入，原缺省行为保持 |
| `apps/worker/test/identification-knowledge/composition.test.ts` | IP-05 | 增加/验证可选共享 registry 注入，原缺省行为保持 |

### 生产路由映射（IP-07 / IP-08）

旧 /project 与 /review 前缀重定向到下表目标并保留 params/search；公共 /overview 为统一首页，质量页另新增 /assessment/quality → 既有 QualityPage（IP-07）。登录/改密使用唯一 Web 会话状态，demo App 中的业务 Route wrappers 迁为同一 App 的控制接线，不复制其第二套宿主。主导航仍只保留七项，response/report/details 通过对应业务入口到达。

| 原路径 | 生产路径 | Renderer / 处理 | IP-ID |
| --- | --- | --- | --- |
| `/login` | `/login` | 真实会话表单适配；复用现有 createC09Client | IP-07 / IP-08 |
| `/change-password` | `/change-password` | 真实会话表单适配；复用现有 createC09Client | IP-07 / IP-08 |
| `/` | `/ → /overview` | RiskOverviewPage | IP-07 / IP-08 |
| `/overview` | `/overview` | RiskOverviewPage | IP-07 / IP-08 |
| `/agent` | `/agent` | AgentWorkbenchPage | IP-07 / IP-08 |
| `/agent/tasks/:taskId` | `/agent/tasks/:taskId` | AgentTaskDetailPage | IP-07 / IP-08 |
| `/identification` | `/identification` | IdentificationRunsPage | IP-07 / IP-08 |
| `/identification/runs/:runId` | `/identification/runs/:runId` | IdentificationRunPage | IP-07 / IP-08 |
| `/identification/records` | `/identification/records` | RiskRecordListPage | IP-07 / IP-08 |
| `/identification/records/:recordId` | `/identification/records/:recordId` | RiskDetailPage | IP-07 / IP-08 |
| `/identification/graph` | `/identification/graph` | AssociationGraphPage | IP-07 / IP-08 |
| `/identification/process-model` | `/identification/process-model` | ProcessModelPage | IP-07 / IP-08 |
| `/project` | `/projects` | ProjectOverviewPage | IP-07 / IP-08 |
| `/project/documents` | `/projects/documents` | DocumentListPage | IP-07 / IP-08 |
| `/project/documents/:docId` | `/projects/documents/:docId` | DocumentDetailPage | IP-07 / IP-08 |
| `/project/monitoring` | `/projects/monitoring` | MonitoringDetailPage | IP-07 / IP-08 |
| `/project/monitoring/:seriesId` | `/projects/monitoring/:seriesId` | MonitoringDetailPage | IP-07 / IP-08 |
| `/assessment` | `/assessment` | PendingAssessmentPage | IP-07 / IP-08 |
| `/assessment/start` | `/assessment/start` | StartAssessmentPage | IP-07 / IP-08 |
| `/assessment/runs/:runId` | `/assessment/runs/:runId` | AssessmentRunPage | IP-07 / IP-08 |
| `/assessment/records` | `/assessment/records` | AssessmentRecordsPage | IP-07 / IP-08 |
| `/assessment/records/:recordId` | `/assessment/records/:recordId` | AssessmentRecordPage | IP-07 / IP-08 |
| `/assessment/matrix` | `/assessment/matrix` | AssessmentMatrixPage | IP-07 / IP-08 |
| `/assessment/reassessments` | `/assessment/reassessments` | ReassessmentsPage | IP-07 / IP-08 |
| `/warnings` | `/warnings` | WarningCenterPage | IP-07 / IP-08 |
| `/warnings/tasks` | `/warnings/tasks` | ResponseTasksPage | IP-07 / IP-08 |
| `/warnings/tasks/:taskId` | `/warnings/tasks/:taskId` | WarningTaskPage | IP-07 / IP-08 |
| `/warnings/:warningId` | `/warnings/:warningId` | WarningDetailPage | IP-07 / IP-08 |
| `/response/recommendations/:recommendationId` | `/response/recommendations/:recommendationId` | RecommendationDetailPage | IP-07 / IP-08 |
| `/response/executions/register` | `/response/executions/register` | ExecutionRegisterPage | IP-07 / IP-08 |
| `/response/predictions/:predictionId` | `/response/predictions/:predictionId` | PredictionDetailPage | IP-07 / IP-08 |
| `/response/feedback/:feedbackId` | `/response/feedback/:feedbackId` | FeedbackDetailPage | IP-07 / IP-08 |
| `/response/calibrations/:suggestionId` | `/response/calibrations/:suggestionId` | CalibrationDetailPage | IP-07 / IP-08 |
| `/knowledge` | `/knowledge` | 重定向 /knowledge/mechanisms，保留工程 selector | IP-07 / IP-08 |
| `/knowledge/mechanisms` | `/knowledge/mechanisms` | MechanismLibraryPage | IP-07 / IP-08 |
| `/knowledge/rules` | `/knowledge/rules` | RuleSetsPage | IP-07 / IP-08 |
| `/knowledge/matrix` | `/knowledge/matrix` | RiskMatrixPage | IP-07 / IP-08 |
| `/knowledge/measures` | `/knowledge/measures` | MeasureLibraryPage | IP-07 / IP-08 |
| `/knowledge/retrieval-result` | `/knowledge/retrieval-result` | RetrievalResultPage | IP-07 / IP-08 |
| `/review` | `/review-audit` | ReviewQueuePage | IP-07 / IP-08 |
| `/review/tasks/:taskId` | `/review-audit/tasks/:taskId` | ReviewDetailPage | IP-07 / IP-08 |
| `/review/identification/:taskId` | `/review-audit/identification/:taskId` | IdentificationReviewPage | IP-07 / IP-08 |
| `/review/audit` | `/review-audit/audit` | AuditLogPage | IP-07 / IP-08 |
| `/report/export` | `/report/export` | ReportExportPage | IP-07 / IP-08 |
| `/review/trace` | `/review-audit/trace` | EvidenceTracePage | IP-07 / IP-08 |
| `/review/runs` | `/review-audit/runs` | RunRecordsPage | IP-07 / IP-08 |
| `/ops/access` | `/ops/access` | AccessPage | IP-07 / IP-08 |
| `/ops/data-sources` | `/ops/data-sources` | DataSourcesPage | IP-07 / IP-08 |
| `/ops/health` | `/ops/health` | HealthPage | IP-07 / IP-08 |
| `/ops/model-versions` | `/ops/model-versions` | ModelVersionsPage | IP-07 / IP-08 |
| `/ops/backup` | `/ops/backup` | BackupPage | IP-07 / IP-08 |
| `*` | `*` | 现有 Web not-found / 无权七态，不能静态填充 | IP-07 / IP-08 |

### UI 迁移闭包（IP-08；例外由 IP-07 统一接线）

该闭包自 demo/src/main.tsx 的静态 import 得出，不把目录中孤立文件全搬。普通迁入组件使用现有 Web 壳/七态/confirmation/http；ConfirmButton 是单一确认适配，EvidenceDrawer 只保留真实来源；api/operations.ts 和 api/agentAuditOperations.ts 仅迁业务编解码/操作定义，原 fetch/client 全部改 createC09Client。内容事实不迁移。主题/css 合并现有 tokens/global，去掉重复声明，允许按既有组件需要保留视觉规则。

| 当前来源 | 目标或处理 | IP-ID |
| --- | --- | --- |
| `demo/src/App.tsx` | 不复制；复用 apps/web 已有宿主/唯一客户端 | IP-07 / IP-08 |
| `demo/src/agent/AgentDock.css` | `apps/web/src/agent/AgentDock.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/agent/AgentDock.tsx` | `apps/web/src/agent/AgentDock.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/agent/AgentTaskProvider.tsx` | `apps/web/src/agent/AgentTaskProvider.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/agent/agentDockStore.ts` | `apps/web/src/agent/agentDockStore.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/agent/agentShared.tsx` | `apps/web/src/agent/agentShared.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/api/agentAuditOperations.ts` | `apps/web/src/api/agentAuditOperations.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/api/client.ts` | 不复制；复用 apps/web 已有宿主/唯一客户端 | IP-07 / IP-08 |
| `demo/src/api/context.ts` | 不复制；apps/web/src/api/context.ts 仅 selector 与 URL helper | IP-07 / IP-08 |
| `demo/src/api/operations.ts` | `apps/web/src/api/operations.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/api/session.ts` | 不复制；apps/web/src/api/session.ts 薄适配唯一客户端 | IP-07 / IP-08 |
| `demo/src/charts/ChartSurface.css` | `apps/web/src/charts/ChartSurface.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/ChartSurface.tsx` | `apps/web/src/charts/ChartSurface.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/GraphView.tsx` | `apps/web/src/charts/GraphView.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/RiskMatrixChart.tsx` | `apps/web/src/charts/RiskMatrixChart.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/TrendLine.tsx` | `apps/web/src/charts/TrendLine.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/echarts.ts` | `apps/web/src/charts/echarts.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/types.ts` | `apps/web/src/charts/types.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/charts/useChart.ts` | `apps/web/src/charts/useChart.ts`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/AppShell.css` | 不复制；复用 apps/web 已有宿主/唯一客户端 | IP-07 / IP-08 |
| `demo/src/components/AppShell.tsx` | 不复制；复用 apps/web 已有宿主/唯一客户端 | IP-07 / IP-08 |
| `demo/src/components/AssociatedObjects.css` | `apps/web/src/components/AssociatedObjects.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/AssociatedObjects.tsx` | `apps/web/src/components/AssociatedObjects.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/Card.css` | `apps/web/src/components/Card.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/Card.tsx` | `apps/web/src/components/Card.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/ConfirmButton.css` | `apps/web/src/components/ConfirmButton.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/ConfirmButton.tsx` | `apps/web/src/components/ConfirmButton.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/DataTable.css` | `apps/web/src/components/DataTable.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/DataTable.tsx` | `apps/web/src/components/DataTable.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/EvidenceDrawer.css` | `apps/web/src/components/EvidenceDrawer.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/EvidenceDrawer.tsx` | `apps/web/src/components/EvidenceDrawer.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/EvidenceLink.css` | `apps/web/src/components/EvidenceLink.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/EvidenceLink.tsx` | `apps/web/src/components/EvidenceLink.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/GraphLegend.css` | `apps/web/src/components/GraphLegend.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/GraphLegend.tsx` | `apps/web/src/components/GraphLegend.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/KpiCard.css` | `apps/web/src/components/KpiCard.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/KpiCard.tsx` | `apps/web/src/components/KpiCard.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/PageStateView.css` | `apps/web/src/components/PageStateView.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/PageStateView.tsx` | `apps/web/src/components/PageStateView.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/SectionTabs.css` | `apps/web/src/components/SectionTabs.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/SectionTabs.tsx` | `apps/web/src/components/SectionTabs.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/StageBar.css` | `apps/web/src/components/StageBar.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/StageBar.tsx` | `apps/web/src/components/StageBar.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/StatusTag.css` | `apps/web/src/components/StatusTag.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/StatusTag.tsx` | `apps/web/src/components/StatusTag.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/VersionTag.css` | `apps/web/src/components/VersionTag.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/VersionTag.tsx` | `apps/web/src/components/VersionTag.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/WarningBadge.css` | `apps/web/src/components/WarningBadge.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/WarningBadge.tsx` | `apps/web/src/components/WarningBadge.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/components/icons.tsx` | `apps/web/src/components/icons.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/content/context.ts` | 不复制；删除生产引用，以真实会话/证据读取代替 | IP-07 / IP-08 |
| `demo/src/content/evidence.ts` | 不复制；删除生产引用，以真实会话/证据读取代替 | IP-07 / IP-08 |
| `demo/src/main.tsx` | 不复制；复用 apps/web 已有宿主/唯一客户端 | IP-07 / IP-08 |
| `demo/src/pages/AgentTaskDetailPage.tsx` | `apps/web/src/pages/AgentTaskDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AgentWorkbenchPage.css` | `apps/web/src/pages/AgentWorkbenchPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AgentWorkbenchPage.tsx` | `apps/web/src/pages/AgentWorkbenchPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssessmentMatrixPage.tsx` | `apps/web/src/pages/AssessmentMatrixPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssessmentRecordPage.tsx` | `apps/web/src/pages/AssessmentRecordPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssessmentRecordsPage.tsx` | `apps/web/src/pages/AssessmentRecordsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssessmentRunPage.tsx` | `apps/web/src/pages/AssessmentRunPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssociationGraphPage.css` | `apps/web/src/pages/AssociationGraphPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AssociationGraphPage.tsx` | `apps/web/src/pages/AssociationGraphPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/AuditLogPage.tsx` | `apps/web/src/pages/AuditLogPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/CalibrationDetailPage.tsx` | `apps/web/src/pages/CalibrationDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/DocumentDetailPage.css` | `apps/web/src/pages/DocumentDetailPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/DocumentDetailPage.tsx` | `apps/web/src/pages/DocumentDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/DocumentListPage.css` | `apps/web/src/pages/DocumentListPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/DocumentListPage.tsx` | `apps/web/src/pages/DocumentListPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/EvidenceTracePage.css` | `apps/web/src/pages/EvidenceTracePage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/EvidenceTracePage.tsx` | `apps/web/src/pages/EvidenceTracePage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ExecutionRegisterPage.tsx` | `apps/web/src/pages/ExecutionRegisterPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/FeedbackDetailPage.tsx` | `apps/web/src/pages/FeedbackDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/IdentificationReviewPage.tsx` | `apps/web/src/pages/IdentificationReviewPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/IdentificationRunPage.css` | `apps/web/src/pages/IdentificationRunPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/IdentificationRunPage.tsx` | `apps/web/src/pages/IdentificationRunPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/IdentificationRunsPage.css` | `apps/web/src/pages/IdentificationRunsPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/IdentificationRunsPage.tsx` | `apps/web/src/pages/IdentificationRunsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/LoginPage.css` | `apps/web/src/pages/LoginPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/LoginPage.tsx` | `apps/web/src/pages/LoginPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MeasureLibraryPage.css` | `apps/web/src/pages/MeasureLibraryPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MeasureLibraryPage.tsx` | `apps/web/src/pages/MeasureLibraryPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MechanismLibraryPage.css` | `apps/web/src/pages/MechanismLibraryPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MechanismLibraryPage.tsx` | `apps/web/src/pages/MechanismLibraryPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MonitoringDetailPage.css` | `apps/web/src/pages/MonitoringDetailPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/MonitoringDetailPage.tsx` | `apps/web/src/pages/MonitoringDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/PendingAssessmentPage.tsx` | `apps/web/src/pages/PendingAssessmentPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/PredictionDetailPage.tsx` | `apps/web/src/pages/PredictionDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ProcessModelPage.css` | `apps/web/src/pages/ProcessModelPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ProcessModelPage.tsx` | `apps/web/src/pages/ProcessModelPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ProjectOverviewPage.css` | `apps/web/src/pages/ProjectOverviewPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ProjectOverviewPage.tsx` | `apps/web/src/pages/ProjectOverviewPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReassessmentsPage.tsx` | `apps/web/src/pages/ReassessmentsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RecommendationDetailPage.tsx` | `apps/web/src/pages/RecommendationDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReportExportPage.css` | `apps/web/src/pages/ReportExportPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReportExportPage.tsx` | `apps/web/src/pages/ReportExportPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ResponseTasksPage.tsx` | `apps/web/src/pages/ResponseTasksPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RetrievalResultPage.css` | `apps/web/src/pages/RetrievalResultPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RetrievalResultPage.tsx` | `apps/web/src/pages/RetrievalResultPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReviewDetailPage.css` | `apps/web/src/pages/ReviewDetailPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReviewDetailPage.tsx` | `apps/web/src/pages/ReviewDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReviewQueuePage.css` | `apps/web/src/pages/ReviewQueuePage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ReviewQueuePage.tsx` | `apps/web/src/pages/ReviewQueuePage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskDetailPage.css` | `apps/web/src/pages/RiskDetailPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskDetailPage.tsx` | `apps/web/src/pages/RiskDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskMatrixPage.css` | `apps/web/src/pages/RiskMatrixPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskMatrixPage.tsx` | `apps/web/src/pages/RiskMatrixPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskOverviewPage.css` | `apps/web/src/pages/RiskOverviewPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskOverviewPage.tsx` | `apps/web/src/pages/RiskOverviewPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskRecordListPage.css` | `apps/web/src/pages/RiskRecordListPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RiskRecordListPage.tsx` | `apps/web/src/pages/RiskRecordListPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RuleSetsPage.css` | `apps/web/src/pages/RuleSetsPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RuleSetsPage.tsx` | `apps/web/src/pages/RuleSetsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RunRecordsPage.css` | `apps/web/src/pages/RunRecordsPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/RunRecordsPage.tsx` | `apps/web/src/pages/RunRecordsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/StartAssessmentPage.tsx` | `apps/web/src/pages/StartAssessmentPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/WarningCenterPage.css` | `apps/web/src/pages/WarningCenterPage.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/WarningCenterPage.tsx` | `apps/web/src/pages/WarningCenterPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/WarningDetailPage.tsx` | `apps/web/src/pages/WarningDetailPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/WarningTaskPage.tsx` | `apps/web/src/pages/WarningTaskPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/assessment-response.css` | `apps/web/src/pages/assessment-response.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/assessmentResponseShared.tsx` | `apps/web/src/pages/assessmentResponseShared.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/identificationShared.tsx` | `apps/web/src/pages/identificationShared.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/knowledgeShared.tsx` | `apps/web/src/pages/knowledgeShared.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/AccessPage.tsx` | `apps/web/src/pages/ops/AccessPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/BackupPage.tsx` | `apps/web/src/pages/ops/BackupPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/DataSourcesPage.tsx` | `apps/web/src/pages/ops/DataSourcesPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/HealthPage.tsx` | `apps/web/src/pages/ops/HealthPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/ModelVersionsPage.tsx` | `apps/web/src/pages/ops/ModelVersionsPage.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/ops.css` | `apps/web/src/pages/ops/ops.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/pages/ops/opsShared.tsx` | `apps/web/src/pages/ops/opsShared.tsx`（迁入并改唯一接缝） | IP-08 |
| `demo/src/theme/global.css` | `apps/web/src/theme/global.css`（迁入并改唯一接缝） | IP-08 |
| `demo/src/theme/tokens.css` | `apps/web/src/theme/tokens.css`（迁入并改唯一接缝） | IP-08 |

test/browser 五份 spec 逐同名迁入 apps/web/test/browser；deploymentPolicies.mjs 仅测试 synthetic fixture，不供生产宿主 import；harness 使用生产 composition 公共入口和测试输入，不复制生产 wiring。旧 demo 保留参考且不进 workspace；原 C36 quality 浏览器测试改到新路由、继续验现有质量契约。

保护：原执行图/Orca 状态、Git 历史、未授权用户改动、主规格（待官方 sync/archive）、历史迁移、研究原件、业务规则/正式结果与原预算。规划文件 proposal/design/specs/implementation-plan/tasks 是本次输入，不作为实现者自由增减范围的区域；verification 留给后续验收。

升级条件：base 代码漂移改变符号/语义；新增未列文件/依赖/公共 branch/Schema/业务字段/业务表；需要改历史事实/权限；目录闭包出现额外运行时 import；正式 provider 接缝无法按批准契约实现；既有工程命令不存在或本地必要测试环境阻止工程检查。普通范围内缺陷由原任务修复。当前网络服务、批准模型/预算、功能证书、样本和业务输入缺项单列功能 BLOCKED；未来签名/介质/三平台/硬件输入归 C38。新公共契约/依赖/迁移或范围外文件仍升级，普通范围内缺陷在原 Task 修复，不用 Mock/skip 兜底。

## 8. 验收 Agent 授权与限定审计

14.2 前置是全部当前 tasks 完成，包括新增 IP-15/IP-16 的真实 network/业务证据与重新打开的桌面场景/验收口径；F-01–F-05 不计前置。主调度按授权形成固定实现检查点后，Finalizer 完整读取 apply contextFiles 与 IP-01–IP-16，对最终代码、当前 Requirement/Scenario 及实际证据核验、范围内修复与回归，随后创建 verification。

C37 总体结论限定为当前功能 PASS/FAIL/BLOCKED。缺当前服务/实际终态/必需引用记 BLOCKED，普通实现缺陷记 FAIL；待审计或当前缺陷未闭合不能 PASS。未来平台/硬件/离线材料缺席只记 C38 移交未完成，不阻塞已通过功能范围的集成、归档。C38 最终平台、介质、资源场景使用其自己的检查点、验收程序与 verification，不继承功能报告作最终交付证明。

限定审计按项目手册设置 security（模型秘密/联网资料资格/Electron/mTLS）、persistence（原始响应/操作审计/恢复）、integration（精确后端/完整 providers/终态与人工确认）及必要 performance（流/轮询边界）。同一收尾轮次最多一次限定审计，Auditor 在自身活动 Task 内闭合范围内缺陷；本轮不派发收尾、不生成 verification、不提交或归档。
