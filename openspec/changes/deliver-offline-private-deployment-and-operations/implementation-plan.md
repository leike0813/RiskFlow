# Implementation Plan

## 1. 实施基线与权威来源

固定 base commit：`6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`。HEAD 和 base 在初始规划时一致；当前实施进度以 tasks 与可运行证据为准。继续实施前核对已完成改动与计划，不把规划文件的存在当作功能实现。

权威输入：本 change 的 proposal、八份 delta specs 与 design D-01–D-22；既有 C03–C36 主规格；当前代码用于确定可复用事实与缺口。产品文档路径见 proposal。orchestrated-delivery 的 applyRequires 是 proposal/specs/design/implementation-plan/tasks，verification 由后续 Finalizer 生成。

直接依赖沿 proposal 已归档清单，生产运行沿 C03 persistence、C04 artifacts、C05 model、C06 access、C07 review、C08 Agent、C09 HTTP、C10 shell、C11–C31 adapters/graphs。既有六 workspace 成员保持，在 IP-01 增加 Desktop；版本、三平台、服务管理和流协议按 design 冻结，不再交给实现者选方案。

**没有新的阻塞架构决策。** 真实模型、批准策略/数据集、甲方样本、内网证书、签名材料、目标机与资源阈值是正式部署/交付验收输入；缺项只使对应交付取证 task 未完成，独立代码实现和工程审查继续，不以默认值/合成介质闭合正式验收。依赖安装、服务启动与提交均遵守项目授权边界。

实施顺序按 D-12 分为：完成 1–13、14.1 的实现及工程检查 → 14.2 固定检查点交接 Finalizer → 15.1 正式包制备、15.2 三平台安装、15.3 三 VM、15.4 硬件取证 → 15.5 总体交付收口。交付取证任务不属于交接前必须完成的实现任务；它们在原 change 中持续跟踪，全部通过前不能成功集成或归档。生产 Schema、权限、证书校验与缺项拒绝仍按原契约实现。

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
| IP-13 | Playwright _electron.launch；真实 HTTPS、C06、apps/web 浏览器验收；平台安装包 | 真实桌面验收；D-12/D-15/D-22 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |
| IP-14 | model/llamacpp-model-gateway.smoke.test.ts；OCR smoke；已归档端到端行为；更新后的项目设计 | 真实部署、基准与交付收口；D-12/D-22 | 领域 Schema、权限、规则、幂等和版本事实仍归原模块 |

### 生产组合 options 映射（IP-04 / IP-05）

共同基础：db=createPostgresRuntime.db；transactionUnit=createPostgresTransactionUnit；checkpointer=createPostgresCheckpointer；access=createPostgresLocalIdentityAccess；artifactStore=IP-03 remote store；referenceGuard=本地 PG guard；modelGateway=createLlamaCppModelGateway；OCR=createPaddleOcrLayoutParser（原公开入口）；review=createPostgresReviewAuditAdapter；idempotentConsumer=createPostgresIdempotentConsumer。所有模型/OCR/工件/预算入参使用原 strict Schema，不从 demo 私有 fixture 获取。IP-01 先建立 Desktop manifest/tsconfig，完整主进程在 IP-09 完成后根 build 才作为通过证据；宿主测试加载 dist 前由测试 setup 使用现有 tsc -b apps/api apps/worker 构建服务侧，不依赖未完成的桌面或开发服务器。

| 组合根 | options → 固定 provider |
| --- | --- |
| C15 createPostgresDataCleaningComposition | 基础 db/transaction/artifact/access/model；原 parser/source registry；catalog cleaning policy；共享 registry（新增可选注入）；resolveStartAuthorizationInvocation=IP-04 C06 invocation source |
| C17 createPostgresIdentificationKnowledgeComposition | 基础；同一 registry（新增可选注入）；catalog validationPolicy；assessmentBasisResolver=scoring adapter.resolve；resolveAuthorizationSource=C06 source；preparationRead=C15 store.readExactPreparation；engineeringData=registry read/resolveReadQuery；reviewAudit=原 review；policySetProvider=同一 IP-04 policySet；agentTaskFailureEvidenceReader=C15 agentTaskAdapter 的原 reader；retrievalDelegate=一次绑定的 C20 retrieve |
| C20 createHybridRetrievalProjectionComposition | generationStore=PostgresRetrievalAdapter 的真实 db/transaction；qdrant=配置端点/时限；sourceFacts=C17 adapter；model/artifact/transaction/idempotentConsumer=基础；policyProvider/qualityGate/authorize=IP-04；queryInputReader=一次绑定 C21 service.queryInputReader；budgetPolicyRef=批准配置 |
| C21 createIdentificationContextComposition | 基础；inputReader=PostgresIdentificationGraphAdapter.contextInputReader；knowledgeReader=C17 adapter；hybridPolicy=IP-04 同一 catalog；hybridStore=PostgresRetrievalAdapter；retrievalService=C20 retrievalDelegate；taskReader=共享 PostgresAgentTaskAdapter.getTask；reviewPolicy=catalog 原 RetrievalReviewPolicy；registry=共享 registry |
| C22 createRiskCandidateFinalizationComposition | 基础；review=同一 C07；modelContextReader=C21 service；workPlanReader=identification graph adapter.workPlanReader；policyProvider=IP-04 RiskCandidatePolicyBundle；reviewDecisionReader=review.readIdentificationGroupDecision |
| C23 createIdentificationHumanReviewComposition | pendingReviewReader=review；reviewRevision=C22 service；review=同一 review.decideReview |
| C24 createIdentificationGraphComposition | 基础；runtimeAuthorization/recoveryAuthorization=IP-04 C06 source；policyProvider/reviewPolicy=catalog；basisResolver/knowledgeReleaseReader=C17 adapter；preparationReader=C15 store.readExactPreparation；contextService=C21 service；agentTasks/agentTaskReader=共享 adapter；finalizationService=C22 service；reviewDecisionReader=review；acceptanceRoutes=IP-04 精确登记+C04 reader；recoveryConsumer=原 idempotentConsumer |
| C25 createAssessmentGraphComposition | 基础；runtimeAuthorization/authorizeDownstream=IP-04 C06 source；engineeringData=engineering registry；basis/basisResolver=同一 scoring adapter；runtimePolicies=IP-04；riskAssessment=createPostgresRiskAssessmentEngine；warning=createPostgresWarningLifecycleAdapter；recommendation=createPostgresRecommendationAdapter；recommendationAgent=共享 registry 的 createResponseRecommendationTaskDefinition；responseLifecycle=createPostgresResponseLifecycleAdapter + createPostgresResponseLifecycleContextReader + createEffectForecastModelReaderV1 + createProductionEffectForecastExecutorsV1；calibration=createPostgresCalibrationAdapter；calibrationAgent=共享 registry 的原校准任务定义；policies=正式 C19 成员/candidate catalog |
| C30 createRiskFlowGraphComposition | 基础；runtimeAuthorization=IP-04；humanDecisionProof=createPostgresHumanDecisionFeedbackAdapter；identificationRuntime=C24 runtime；assessmentRuntime=C25 runtime；riskSpatialPairing/retryPolicy=IP-04；subGraphVersions/retryPolicyRef=批准配置 |
| API BuildApiOptionsV1 | access=基础；ports=design D-21 全表；publicOrigin=配置；ssePolicy=原 Schema；accessLog=安全有界记录；now/idGenerator 沿生产实现；不注入固定测试时间/ID |

各 composition 的原可选 now 省略则使用真实时间，不能覆盖版本语义。原 C20/C21/C17 构造环按 D-20 的一次绑定处理；先完成 registry 所有任务注册和全 ports 校验，再 listen/claim。存在已发布工程时，策略按 projectBindings 的精确版本解析；新工程未配置必需运行策略时功能明确失败，不从其它工程取值。

C27 recommendationAgent 的现场上下文从 C28 contextReader 与当前精确 assessment/response 的受保护登记构建，校准上下文从已登记 deviation/calibration lineage 读取；需要的引用均来自冻结图输入，不指定“当前最近”现场。任务定义使用原 typed tools/validation/finalization adapter，不能靠函数返回假任务结果。

IP-04 新窄读契约：工程 registry.listDeploymentProjects 使用固定分页上限和 cursor 返回真实 projectId/revision/空间/来源登记引用；auth resolver 在 HTTP 受理时按固定下游清单分别用真实会话签发、耐久关联；后台按目标 branch 读原关联 context，复验 actor/当前授权再以同能力 parent 收窄，不扩展原 parent 能力；scoring/config reader 按同工程 member releaseRef/versionId 返回原已发布正文与 digest，缺失返回 undefined。这些函数在所属 adapter 内实现；部署 provider 只消费公开导出，不读取私表。保护 C06 sessionToken 不进入 catalog、日志或 checkpoint。

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
| IP-09 | 9.1–9.3；15.1 正式包取证 | 桌面运行必须限制导航与本机能力；桌面发布必须按冻结平台离线验收 | §2 与 §7 文件表 | 三个平台薄壳：受控 origin、无 preload、禁 Node、sandbox/context isolation、权限默认拒绝、导航/窗口/下载限制、CA 信任；本地无权状态页仅显式重试；离线包/签名/许可证配置及程序工程检查，正式签名包由 15.1 取证。 | D-14/D-15/D-16 的保护边界 |
| IP-10 | 10.1–10.3 | 部署必须遵循三台虚拟机的集中式边界；离线发布包必须完整且版本可核验 | §2 与 §7 文件表 | 安装工具只读/导入精确介质，固定 systemd units/网络规则；手工证书 Caddy、同源 API/SSE 与深链；GPU/OCR 配置/预算与本地镜像，install/run 不隐式下载。 | D-01/D-02/D-07/D-16 的保护边界 |
| IP-11 | 11.1–11.3 | 同机逻辑副本必须绑定同一停写边界及全部耐久事实 | §2 与 §7 文件表 | 独立宿主权限 + 全工程资料/空间授权；三 VM 本地停写回执与无在途证明；先 manifests 再 dump 再工件复制/描述耐久发布；状态、互斥与失败采用 IP-02，不自动清理/成功。 | D-08/D-09/D-19 的保护边界 |
| IP-12 | 12.1–12.3 | 恢复必须先隔离核验再人工切换 | §2 与 §7 文件表 | 新 DB/本地工件根隔离恢复；先原集合核对后诊断；索引真实重建并过原门禁；精确 revision/副本/目标确认、会话失效和受控切换，失败保留双根；不兼容回退须匹配副本。 | D-10/D-11/D-19 的保护边界 |
| IP-13 | 13.1 程序实现；15.1 制包、15.2 安装取证 | 证书与会话必须沿用安全 HTTPS 边界；连接恢复不得重启任务或自动提交写命令；桌面发布必须按冻结平台离线验收 | §2 与 §7 文件表 | 先完成独立 Playwright、平台/包/输入预检及场景程序，以 acceptance.test.mjs 验证缺项拒绝；随后取证三个真实平台安装/登录/上传下载/撤权/证书拒绝/导航/重连/任务继续。缺环境只阻塞对应平台取证，截图不能代替事实/回执。 | D-12/D-15/D-22 的保护边界 |
| IP-14 | 14.1 程序实现、14.2 工程交接；15.3–15.4 实机取证、15.5 总体收口 | 模型与 OCR 必须离线预置并隔离资源；发布回退与目标环境验收必须有真实证据 | §2 与 §7 文件表 | 先完成 smoke/benchmark/报告程序、配置与手册及本地行为检查，交接 Finalizer；随后运行真实禁网三 VM 完整安装/后台/恢复/回退和最低目标基准。报告分别记录工程结果与交付证据，Finalizer 在工程审查后生成 verification，全部取证完成再更新为总体结论。 | D-12/D-22 的保护边界 |

§6 是逐场景主映射。IP-05 为生命周期/策略/质量场景的共同依赖；IP-09/13 为完整 UI 桌面场景共同证据；IP-10/14 为所有真实部署验收的共同证据，不能因主映射已测单元测试而漏掉集成义务。

9.3 的打包程序工程检查复用 scripts/deployment/release.test.mjs（IP-09/IP-10）；13.1 的桌面环境预检复用 scripts/deployment/acceptance.test.mjs（IP-13/IP-14）。相关测试按稳定输入、结构化工具调用、缺项非零和结果状态断言，合成输入与工具替身仅用于程序契约测试，不进入正式发布介质或充当实机证据。

## 4. 调用与副作用顺序

- IP-02/10：verify manifest/路径/架构/许可→strict config→秘密权限→显式初始化（权限组/LOGIN→原 migrations→checkpointer→C06 空库 bootstrap）→核对兼容迁移→装配真实 ports→本机 listener/Worker→Caddy。同一失败不半启动；bootstrap 在已有账号库中不能重新创建/改密。
- IP-03：mTLS→当前 C06 工程/来源/空间/capability→原 DTO→有界流→C04 原登记/审计→原回执；open 只有最终 receipt 与内容 identity 核验后 resolve verified。引用检查必须使用调用业务事务。超时/断流没有成功响应，不更换命令身份。
- IP-04/05：精确配置/catalog→原 Schema/批准身份→所属正式成员/登记→原 C04 verified→受控一次绑定→全 ports 校验→允许业务。检索门禁先测真实代际并通过 evaluateRetrievalAcceptance，随后原 C20 激活；不跳过 dense/BM25/RRF/授权门。
- IP-06：claim durable event→按 eventType 明确 dispatch→消费者原事务/幂等回执→ack；失败 recordFailure 沿原预算，未知事件失败。Agent runner 有界轮询原任务，取消/恢复不创建新任务。停止接收→停止 claim→限时 drain→关闭 SSE/图/流/连接；超时不能成为停写回执。
- IP-07/08：真实会话/URL selector→当前工程权限与路由能力→有界读取→原七态；写动作冻结信封→唯一确认→服务端复验→原回执→刷新同上下文。取消无请求；未知响应只允许用户在原计划显式重试，迟到响应用 context revision 隔离。
- IP-11：授权/全工程枚举/容量/锁→三 VM 本地维护回执及全写者停止→逐工程 hash manifests→完整数据库逻辑 dump（含业务/audit/Outbox/checkpoint/迁移）→全部耐久工件（含清单）→descriptor 耐久发布→IP-12 隔离核对→可用回执。中断保留未完成阶段与旧根，不默默删除。
- IP-12：受控目标映射→新的隔离 DB/工件根→原副本所有工程 reconcile（findings 全消费+summary）→正式登记/审计/任务/checkpoint 验证→真实双索引重建与门禁→精确目标确认→授权/revision 再核验→停写/切换→旧会话失效→就绪。失败保留双根，回退按原记录显式确认。
- IP-13/14：真实制品与环境身份→禁网安装→HTTP/Electron/后台/权限/恢复→原始证据→安全报告。启用项缺介质、平台或硬件非零，不将 fixture/protocol 局部通过记成真实部署通过。

## 5. Schema、状态与持久化落实

唯一 Schema 与边界按 design D-18/D-19/D-20。IP-02 实现 strict ReleaseManifestV1/DeploymentConfigV1/DesktopConfigV1/DeploymentOperationV1/LogicalBackupDescriptorV1/DeploymentOperationResultV1；原 Zod 4.5.4 不升级。所有复用业务 policy 直接 import 原 core Schema，无第二字段镜像。

000056 运维表/因果授权关联/追加审计/grants 只为宿主操作，不修改历史迁移。用独立 deployment operator role、instance+operation 主键与幂等唯一键、payloadDigest/expectedRevision/CAS 和租约；阶段与审计同 transaction。原 audit.entries 继续项目级，C04 manifest/reconcile 保持原审计回执，不伪造 deployment 的 ContractReference。运行主体无运维写权限；计划外业务表/枚举/branch/Schema 必须升级。

不重写指标/权重/矩阵、历史风险/评估/人决定，不用工件文件补造领域登记。恢复源完整业务事实保留；Qdrant 可重建但只有通过原门禁才就绪。秘密轮换仅改变凭据/旧会话，不能改历史 actor/version/ref。维护闭合动作持久化的是安全引用/阶段/计数，不保存正文/秘密/内部思维链。

确认控制器使用 project/system 判别及原管理回执；实现同时更新全部本仓库调用方与测试。C36 queryWithSourceGrants 无论完整 projection 是否存在都按质量 queryType 接管，并保留现有逐来源 C06 签发。

## 6. 验收证据矩阵

下表每行引用准确 Requirement/Scenario，不复制规范正文。新测试/命令均是 IP 文件清单的实现内容，完成对应 task 后才存在。fixture 采用原 contracts/core Schema，明确合成样本待甲方复核；随机 LLM 回复不作期望。稳定断言验证身份、状态、版本、权限、耐久回执、资源边界，禁止全文文案/CSS snapshot。

矩阵中的目标平台、正式介质与硬件命令用于交付取证，不作为对应程序编写完成或 14.2 工程交接的前置。程序工程检查按 tasks 的本地命令执行；真实 PG/Qdrant/HTTP/Chromium 接缝要求保留。未运行的交付场景保持 BLOCKED，不能用本地测试替代最终通过证据。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 两种入口访问同一业务对象 | IP-08 | apps/web/test/browser/*.spec.ts；apps/desktop/test/e2e/client.spec.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 所有真实路由、精确对象和版本相同；无 fixture 回退 | `pnpm test:browser` |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 原型数据或页面遗漏 | IP-08 | apps/web/test/browser/*.spec.ts；apps/desktop/test/e2e/client.spec.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 所有真实路由、精确对象和版本相同；无 fixture 回退 | `pnpm test:browser` |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 越界导航或本机调用 | IP-09 / IP-13 | apps/desktop/test/security.test.ts；apps/desktop/test/e2e/client.spec.ts | 工程检查用原 Schema；平台取证用真实安装包/服务 | origin/协议/权限拒绝；平台包中实际拒绝越界 | 工程：`pnpm exec vitest run apps/desktop/test/security.test.ts`；交付：`pnpm desktop:package && pnpm test:desktop` |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 基础上传与下载 | IP-09 / IP-13 | apps/desktop/test/security.test.ts；apps/desktop/test/e2e/client.spec.ts | 工程检查用原 Schema；平台取证用真实安装包/服务 | 授权上传下载有用户操作；平台安装后可完成正式文件操作 | 工程：`pnpm exec vitest run apps/desktop/test/security.test.ts`；交付：`pnpm desktop:package && pnpm test:desktop` |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 有效证书与真实登录 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 三平台真证书/真实登录；撤权拒绝，Cookie 不外露 | `pnpm test:desktop` |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 证书失败或权限撤销 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 三平台真证书/真实登录；撤权拒绝，Cookie 不外露 | `pnpm test:desktop` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 首次连接失败与恢复 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 显式重连/原任务继续/原 SSE 游标；未知命令不自动提交 | `pnpm test:desktop` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 窗口关闭后任务继续 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 显式重连/原任务继续/原 SSE 游标；未知命令不自动提交 | `pnpm test:desktop` |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 命令响应丢失与订阅重连 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 显式重连/原任务继续/原 SSE 游标；未知命令不自动提交 | `pnpm test:desktop` |
| platform/electron-https-client / 桌面发布必须按冻结平台离线验收 / 无公网环境安装已冻结客户端 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 三平台禁网安装/签名/版本；无对应机器明确失败 | `pnpm test:desktop` |
| platform/electron-https-client / 桌面发布必须按冻结平台离线验收 / 服务端界面升级与平台证据缺失 | IP-13 | apps/desktop/test/e2e/client.spec.ts | 真实平台/三 VM/批准发布与输入 | 三平台禁网安装/签名/版本；无对应机器明确失败 | `pnpm test:desktop` |
| platform/electron-https-client / 桌面发布必须按冻结平台离线验收 / 平台输入未齐时完成工程检查 | IP-09 / IP-13 / IP-14 | scripts/deployment/release.test.mjs；scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 原 Schema 与标注测试输入；缺正式平台/介质/签名 | 缺项拒绝；工程结果与平台 BLOCKED 分列；14.2 可交接；正式包不回退 | `pnpm exec vitest run scripts/deployment/release.test.mjs scripts/deployment/acceptance.test.mjs`；Finalizer 核对 tasks 与 verification |
| platform/engineering-baseline / 单一生产 workspace / 发现全部生产成员 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 恰好四 apps 三 packages，demo 不在生产图 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 单一生产 workspace / Demo 不进入生产依赖图 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 恰好四 apps 三 packages，demo 不在生产图 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 冻结安装成功 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 清单与锁文件不一致 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 冻结且可重放的工具链 / 不受支持的 Node 主版本 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 精确锁/离线安装、Node 主版本和清单拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 全 workspace 构建 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 公开入口可解析 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 深层导入被拒绝 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 根构建/公开 export 可解析；深导入拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 强制单向依赖边界 / 合法依赖图 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 合法图通过；Desktop→其它 app 与反向依赖拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/engineering-baseline / 强制单向依赖边界 / 反向或跨应用依赖 | IP-01 | scripts/check-dependency-policy.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 合法图通过；Desktop→其它 app 与反向依赖拒绝 | `pnpm build && pnpm deps:check && pnpm deps:policy` |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 真实跨 VM 写入与读取 | IP-03 | packages/adapters/test/artifacts/remote-artifact-store.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 原 C04 回执/引用/流校验；截断与越权拒绝 | `pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 断流或传输身份越权 | IP-03 | packages/adapters/test/artifacts/remote-artifact-store.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 原 C04 回执/引用/流校验；截断与越权拒绝 | `pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 完整来源装配并保留质量查询授权 | IP-04 | packages/adapters/test/deployment/policies-readers.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 精确来源与版本；真实门禁拒绝；C36 资料过滤 | `pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts` |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 策略漂移或质量门禁失败 | IP-04 | packages/adapters/test/deployment/policies-readers.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 精确来源与版本；真实门禁拒绝；C36 资料过滤 | `pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts` |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 阶段重放与权限隔离 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | CAS/唯一键/互斥与 append-only；审计失败无 completed | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 审计失败与授权缺项 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | CAS/唯一键/互斥与 append-only；审计失败无 completed | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 客户端只访问应用入口 | IP-10 | scripts/deployment/release.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 客户端仅 HTTPS；三 VM 内部端口受限；同机恢复边界 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 同机副本与宿主故障边界 | IP-10 | scripts/deployment/release.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 客户端仅 HTTPS；三 VM 内部端口受限；同机恢复边界 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 断网环境完成安装 | IP-10 | scripts/deployment/release.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 禁网安装、精确制品校验；缺项非零且不启动 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 制品不完整或不匹配 | IP-10 | scripts/deployment/release.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 禁网安装、精确制品校验；缺项非零且不启动 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 已验收界面尚未进入生产构建 | IP-10 | scripts/deployment/release.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 禁网安装、精确制品校验；缺项非零且不启动 | `pnpm exec vitest run scripts/deployment/release.test.mjs && pnpm deployment:verify` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 同一配置可重放 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 配置非法或秘密不可用 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 秘密轮换保持历史可追溯 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | strict 配置/秘密权限/同版本重放；轮换会话失效 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 空实例初始化成功 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 初始化重放或部分失败 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 运行主体试图越权 | IP-02 | packages/adapters/test/deployment/config-operations.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 空库/重复初始化；原账号与审计保持；DDL 越权拒绝 | `pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 真实实例完成请求和后台消费 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 缺少必需接线 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 进程重启与事件重投 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 有界停止未能完成 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 真实 ports/消费回执/幂等重投；缺线及 drain 超时不就绪 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 安全同源访问和重连 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 依赖失败或正在维护 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 慢探针或无权查询 | IP-06 | scripts/deployment/lifecycle.test.mjs；packages/adapters/test/deployment/observability.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 同源 Cookie/SSE、安全四组件；总截止与当前授权拒绝 | `pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / 预置服务身份与真实协议匹配 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 真实模型/OCR 身份、独立预算；缺环境失败 | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / OCR 饱和或崩溃 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 真实模型/OCR 身份、独立预算；缺环境失败 | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 模型与 OCR 必须离线预置并隔离资源 / 模型制品或资源证明缺失 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 真实模型/OCR 身份、独立预算；缺环境失败 | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 完整停写备份成立 | IP-11 | scripts/deployment/backup.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 停写失败或工程授权不完整 | IP-11 | scripts/deployment/backup.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 复制、空间或耐久记录失败 | IP-11 | scripts/deployment/backup.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 同键重试与异载荷冲突 | IP-11 | scripts/deployment/backup.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 全工程授权/停写证明；manifest→dump→复制；失败无可用副本 | `pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 隔离恢复与原实例并存 | IP-12 | scripts/deployment/restore.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 缺失、损坏或快照不匹配 | IP-12 | scripts/deployment/restore.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 索引重建与正式空结果 | IP-12 | scripts/deployment/restore.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 人工切换、拒绝与重复操作 | IP-12 | scripts/deployment/restore.test.mjs | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 损坏拒绝；完整 findings/summary；真索引；精确目标确认 | `pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 兼容版本回退 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 兼容性检查/隔离回退；真实 4090/128GB 证据，无 skip | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 不兼容回退或缺少真实证据 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 兼容性检查/隔离回退；真实 4090/128GB 证据，无 skip | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 在批准目标硬件形成基准 | IP-14 | scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 真实平台/三 VM/批准发布与输入 | 兼容性检查/隔离回退；真实 4090/128GB 证据，无 skip | `pnpm verify && pnpm deployment:smoke && pnpm deployment:benchmark` |
| platform/offline-private-deployment-and-operations / 发布回退与目标环境验收必须有真实证据 / 目标环境未齐时完成工程检查 | IP-10 / IP-14 | scripts/deployment/release.test.mjs；scripts/deployment/acceptance.test.mjs；deployment/ACCEPTANCE.md | 本地真实接缝/标注测试输入；缺目标硬件/正式介质 | 实现及工程检查可交接；交付缺项逐项 BLOCKED；总体不宣告 PASS；补证绑定最终身份 | `pnpm verify && pnpm test:browser && pnpm test:deployment`；Finalizer 核对 tasks 与 verification |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 普通命令确认后提交一次 | IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 高影响命令要求显式二次确认 | IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无权限确认卡不可提交 | IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 陈旧版本确认失败 | IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无工程的系统管理确认 | IP-07 | apps/web/test/{api-client-openapi,routing-context-actions,confirmation,focus}.test.ts | 原 Schema、真实 PG/C04；涉及索引用真实 Qdrant | 冻结完整信封/一次提交；额外确认与焦点；陈旧/无权拒绝 | `pnpm exec vitest run apps/web/test && pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 已接通页面与 v2 分区一致 | IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 刷新切换与服务异常 | IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 真实浏览器完成 C35 链路 | IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 慢读和环境缺失 | IP-08 | apps/web/test/browser/agent-audit-operations.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 真实数据与页面可达 | IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 工程切换与失败 | IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/assessment-warning-and-response-ui / C34 必须以真实浏览器验收业务接缝 / 真实闭环与失败边界验收 | IP-08 | apps/web/test/browser/assessment-warning-response.spec.ts；risk-level-response-verification.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 页面渲染当前工程的真实事实 | IP-08 | apps/web/test/browser/read-only.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 写操作入口不存在 | IP-08 | apps/web/test/browser/read-only.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成只读链路 | IP-08 | apps/web/test/browser/read-only.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | IP-08 | apps/web/test/browser/read-only.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 页面渲染当前工程的真实事实 | IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 假写入口不存在 | IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成识别与复核链路 | IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | IP-08 | apps/web/test/browser/identification-review.spec.ts | 真实 PG、Cookie、迁移与合成已标注 fixture | 真实浏览器/正式事实/权限/工程切换/键盘；环境缺失非零 | `pnpm test:browser` |

共同验证义务：

| IP-ID | 必须补足的可观察证据 | 命令 |
| --- | --- | --- |
| IP-04 / IP-05 | 所有必需 options 有真实 provider；每种缺失逐项拒绝；构造环绑定前不能执行；质量与普通 projection 同时接入后撤权仍过滤 | `pnpm exec vitest run scripts/deployment/composition.test.mjs packages/adapters/test/deployment/policies-readers.test.ts apps/api/test/quality.test.ts` |
| IP-08 | 五份迁移浏览器 spec 与 C36 全过、真会话/SQL 回执、焦点/高频单请求、工程切换；深链完整枚举 | `pnpm test:browser` |
| IP-09 / IP-13 | 本地检查权限/导航边界及打包程序；各平台再取证 handler 拒绝、未知写不重投、上传/用户选保存、证书不绕过 | 工程：`pnpm exec vitest run apps/desktop/test/security.test.ts scripts/deployment/release.test.mjs scripts/deployment/acceptance.test.mjs`；交付：`pnpm desktop:package && pnpm test:desktop` |
| IP-11 / IP-12 | 全工程 manifest 登记先于 dump；坏字节/缺文件/异 snapshot/未消费 summary/审计失败均拒绝；重投无重复业务事实 | `pnpm test:deployment` |
| IP-10 / IP-14 | 工程阶段验证发布/验收程序及缺项拒绝；交付阶段验证真实禁网三 VM、正式介质、4090/128GB 模型/OCR、恢复/回退及报告 | 工程：`pnpm exec vitest run scripts/deployment/release.test.mjs scripts/deployment/acceptance.test.mjs`；交付：`pnpm deployment:verify && pnpm deployment:smoke && pnpm deployment:benchmark` |

命令实现登记（IP-01 添加 package scripts；代码所有权如下）：

| 新命令 | 固定入口与含义 | 所有权 |
| --- | --- | --- |
| test:deployment | vitest run packages/adapters/test/deployment packages/adapters/test/artifacts/remote-artifact-store.test.ts scripts/deployment；需要真实 PG/Qdrant，缺环境非零 | IP-02–06 / IP-10–12 |
| test:desktop | playwright test -c playwright.desktop.config.ts；目标平台受控配置与真实 installed app 必需 | IP-13 |
| desktop:package | node scripts/deployment/package-desktop.mjs；原生构建+本地 electronDist/cache+签名+许可核验 | IP-09 |
| deployment:verify | node scripts/deployment/release.mjs verify；manifest/config/许可/身份与副作用前 preflight | IP-02 / IP-10 |
| deployment:smoke | node scripts/deployment/smoke.mjs；真实服务/禁网/恢复完整验收，输出非零阻塞 | IP-14 |
| deployment:benchmark | node scripts/deployment/benchmark.mjs；按批准 acceptance config 实测并输出报告 | IP-14 |

配置路径环境名见 D-22；示例只给字段/占位身份与注释说明，不给能启动生产的假业务策略或固定秘密。pnpm verify、test:browser 与 test:deployment 保持工程验证，不需要真实三平台/目标硬件；真实 deployment/desktop 命令在交付取证任务中单独必跑。IP-10/14 的程序工程检查分别复用 release.test.mjs/acceptance.test.mjs；真实模型/OCR smoke 在 15.3 取证时显式设置 RISKFLOW_LLAMACPP_SMOKE=1/RISKFLOW_OCR_SMOKE=1 及其真实 config，不能利用原默认 skip 宣告全套通过。

## 7. 文件清单与升级条件

以下是完整 allowlist；基线已存在者为修改，不存在者为新增。同一路径多阶段由后阶段接续，禁止并行 writer。IP-01 拥有共享根配置/锁文件；IP-02 拥有 adapters manifest，IP-05 通过它补 catalog/read 两个 exports；IP-08 的新页面文件另按附表展开。不删除 demo 或归档历史，移除的只是生产引用/废弃重复逻辑。

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

升级条件：base 代码漂移改变符号/语义；新增未列文件/依赖/公共 branch/Schema/业务字段/业务表；需要改历史事实/权限；目录闭包出现额外运行时 import；正式 provider 接缝无法按批准契约实现；既有工程命令不存在或本地必要测试环境阻止工程检查。普通范围内缺陷由原任务修复。真实平台、生产证书、签名材料、发布介质/批准输入缺项单列对应交付取证 BLOCKED，继续独立实现和工程审查；不能静默改方案或用 Mock/skip 兜底正式运行，不再询问已确认的 HTTPS/三 VM/UI 归属。

## 8. 验收 Agent 授权与限定审计

14.2 的交接条件是全部实现任务（1–13、14.1）及工程检查完成并形成固定实现检查点；第 15 组的交付取证不作为本项前置，未完成项持续留在同一 change 中。

Finalizer 完整读取 apply contextFiles 与 IP-01–IP-14，先核对实现和每场景的工程证据，可修复本 allowlist 内已批准范围的普通缺陷、完成回归后生成 verification。工件逐项记录工程结果与待交付证据；实现缺陷记 FAIL，仅缺交付输入时对应验收及 C37 总体结论记 BLOCKED。工程审查结果不单独成为 C37 总体 PASS。目标输入齐备后完成交付取证，按最终 HEAD/制品身份核验受影响范围并更新同一 verification。新公共契约/依赖/迁移/字段/业务判断与范围外文件仍需升级；不得重新解释研究原文或以模型回答替代确定性断言。

限定审计标签：security（Electron/mTLS/秘密/授权/许可）、persistence（操作状态/审计/租约/停写/恢复）、integration（完整 ports/事件/质量来源授权/UI 迁移）、performance（流背压/Agent 单请求/真实资源边界）。按项目手册同一收尾最多一次限定审计，Auditor 在自身活动任务内闭合范围内缺陷；无三平台/硬件/模型证据不能归档为交付完成。
