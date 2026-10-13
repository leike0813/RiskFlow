# Implementation Plan

## 1. 实施基线与权威来源

IP-01–IP-14 初始基线为 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`，IP-15/IP-16 增量基线为 `0a25b6a469ade4bcc6a21c4514195d1f7c19ff31`；保持这些施工身份。当前 HEAD 为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`，累计实现尚有 dirty 改动。当前已实现网络模型 adapter、三图/五类任务、完整 API/Worker、启动 CLI、受控预置与终态观察。

本 change 权威输入为 11 份保留 delta、proposal、design D-01–D-24、tasks 和 verification。下述施工与文件表保留已实现代码的追踪；它们不要求本轮重新实施。保留任务只承载已实现工程成果，完整真实来源、业务/Electron/可见 Chrome 证据和对应收口移交 `complete-private-deployment-functional-acceptance` 的 IP-17–IP-22。原未勾义务映射见其 handoff.md，未完成工作不会因缩小范围被标为通过。

宿主当前只开放 synthetic-acceptance 的合置本地 C04；完整跨 VM host 和远程正文证明设计/装配交 C38 F-03。全部 F-01–F-05 移交保留。正式归档仍须审阅 dirty 实现并在授权后形成真实检查点及必要审计；本轮只准备，不提交或归档。

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
| IP-13 | apps/desktop/test/e2e/{acceptance.mjs,client.spec.ts}；playwright.desktop.config.ts | 已实现预检和两条基础 e2e 定义，完整场景移交 IP-18 | TLS、权限和服务端任务事实保持原契约 |
| IP-14 | scripts/deployment/acceptance.mjs；deployment/ACCEPTANCE.md 与原工程测试 | 已实现手册、配置口径与本次拆分记录，实际功能报告交 IP-22 | 配置校验不能作为实跑证据 |

| IP-15 | core/model/gateway.ts#ModelGatewayPortV1；core/model/schema.ts；adapters/model/config.ts 与 llamacpp-model-gateway.ts；C04/C06 | OpenAI Chat Completions 结构化/流式与 Ollama 原生 Embedding 配置/adapter/真实三能力 smoke；D-23 | 复用原请求/结果、授权、预算、持久化和闭合错误 |
| IP-16 | start.mjs、provision.mjs；scripts/acceptance/{synthetic,functional}.mjs | 已实现合置宿主/生命周期、受控预置和终态观察程序 | 不复制测试 harness 或预期答案，人工决定仍经正式入口 |

IP-05/IP-16 模型步增量：修改 `scripts/deployment/composition/calibration-task.mjs` 提取共用冻结输入读取并公开宿主 readModelInput；新增 `scripts/deployment/composition/response-model-step.mjs`，消费原 runTask、authorizeDownstream、C27/C28 公开读、C29 输入口及 C04 persistArtifact，返回共享 runner 的 render/interpret callbacks。`composition/assessment.mjs` 要求 foundation.authorizationScope 与 persistArtifact，直接返回绑定同一 recommendation/responseLifecycle/calibrationTaskPort 的 modelStep，原任务定义 validate/finalize 同样进入 runTask 作用域。不改变 core 任务定义或 actionSchema，不制造正式引用。扩展 `scripts/deployment/calibration-task.test.mjs`、`assessment-composition.test.mjs` 并新增 `scripts/deployment/response-model-step.test.mjs`，验证真实冻结输入、当前撤权/脱敏/精确版本、阈值、预算、输出绑定、两个耐久候选工件和显式 inner；命令 `pnpm exec vitest run scripts/deployment/calibration-task.test.mjs scripts/deployment/response-model-step.test.mjs scripts/deployment/assessment-composition.test.mjs`。宿主工程装配已完成，完整模型业务终态证据交后续 IP-19/IP-20。

### 生产组合 options 映射（IP-04 / IP-05）

IP-05/IP-16 API plan 接缝：修改 packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts 增加 D-21 readRegisteredWorkPlan，复用本次身份授权、原计划派生身份、精确登记与 C04 正文；扩展其现有真库测试，覆盖正式计划、缺失/错版本/越权/撤权、正文漂移和重复调用不新增计划。composition/identification.mjs 的 api.riskIdentification 绑定该窄读与原 candidate.service.analyze/finalize；composition.test.mjs/entrypoints.test.mjs 验证完整实际 provider。不新增 DTO、依赖、表或迁移。

IP-05/IP-16 API 请求作用域：apps/api/src/app.ts 的 BuildApiOptionsV1 增加 D-21 可选 runRequest，注册路由时包装原 handler；apps/api/test/http-shell.test.ts 扩展已有 HTTP 行为用例验证授权→下游的并发来源隔离及默认调用方。start.mjs 的真实 API 工厂注入现有 authorizationScope.runRequest 并复用 ApiLifecycleV1。命令：pnpm exec vitest run apps/api/test/http-shell.test.ts scripts/deployment/entrypoints.test.mjs scripts/deployment/api-ports.test.mjs；8 GiB API/Worker 构建。

IP-05/IP-06/IP-16 API 宿主：start.mjs 增加 createDeploymentApiV1 与 createDeploymentSystemOperationsV1，复用同一三图与原 api-ports 工厂、C25 read/C30 bodies/C33 trace/C20 hybrid reader，按 D-21 提供真实有限探针和定义版本；entrypoints.test.mjs 在正式初始化库验证完整端口装配、app.inject、关闭及拒绝缺项，模型探针以受控本地 HTTP 夹具验证状态、取消和失败。不增加依赖或业务 Schema；listen 参数由宿主显式传入，未监听不声称 ready 服务。验证沿前项命令及 api-ports/lifecycle 既有回归。

IP-06/IP-16 Worker Agent 作用域：apps/worker/src/agent-runtime/runner.ts 的 Options 增加 D-21 可选 runTask，在 claim 后包裹原单任务执行；apps/worker/test/agent-runtime/runner.test.ts 复用已有任务/工具/校验夹具验证完整作用域和默认执行，失败保留原租约恢复。start.mjs 使用现有 authorizationScope.runTask 注入，不另建 registry、任务表或预算。验证：pnpm exec vitest run apps/worker/test/agent-runtime/runner.test.ts 及 8 GiB API/Worker 构建。

IP-06/IP-16 共享任务运行组合：start.mjs 的 createDeploymentAgentRunnerV1(host) 复用原 createAgentRuntimeRunner 与 KnowledgeAuthoringRunner，将完整任务作用域、同一五类 registry/tasks/modelGateway/assessment.modelStep/persistArtifact 注入；知识编制失败经原 adapter.settleAuthoringFailures 收口。entrypoints.test.mjs 的正式初始化库用例核验未创建任务时有限 runOnce 返回零及无待收口失败，runner.test.ts 承担任务作用域行为证据；空轮询不作为业务完成证据。完整 Outbox Worker 仍须事件父运行定位及耐久回执成立。

IP-06/IP-16 Worker 事件收口：packages/adapters/src/workflow/postgres-workflow-adapter.ts 增加 D-21 readEventParentRun/verifyEventConsumption，公开工厂透传，复用当前完整授权、精确 parent-child、C03 readWorkflowRunBinding 与 C04 verifyContent；现有 workflow 真库测试覆盖精确版本、暂缺/冲突、撤权/脱敏/范围收缩与零写。apps/worker/src/risk-flow/runtime.ts 在验收路由写入前校验精确子运行与取消态，现有 runtime 真库测试覆盖错误事件零路由及重投。composition/risk-flow.mjs 组合原 apply 与事务外推进/事务内复验消费；start.mjs 绑定原五消费者、共享 runner、Outbox 与 WorkerLifecycleV1；entrypoints 及 composition/events/lifecycle 回归覆盖 assessment 准备、正式独立来源、暂缺重投、回执失败后重投、未知事件、租约与 drain。配置与 exports 沿现有公开工厂，不新增预算或依赖。构建命令保持 NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc -b apps/api apps/worker --pretty false。

IP-06/IP-16 具体宿主符号为 createDeploymentOutboxDispatchV1、createDeploymentWorkerV1、createDeploymentWorkerRuntimeV1 与 mainDeploymentV1；entrypoints.test.mjs 使用受控端口验证失败/租约/drain，正式初始化库使用同一实际 factory 验证完整 Worker 构造、原消费者闭包和空轮询关闭。C30 新窄口的 runBindingProof 由 start.mjs 注入原 transactionUnit，不扩展核心 TransactionUnitV1。验证命令：pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts scripts/deployment/entrypoints.test.mjs scripts/deployment/risk-flow-composition.test.mjs apps/worker/test/risk-flow/runtime.test.ts scripts/deployment/lifecycle.test.mjs scripts/deployment/composition.test.mjs apps/worker/test/agent-runtime/runner.test.ts scripts/deployment/api-ports.test.mjs；相关 ESLint/Prettier 与当前 change strict 校验。正式模型、业务终态、HTTPS Web 与可见 Desktop 仍须按后续 IP-19–IP-21 独立取证。

IP-05/IP-16 修改 composition/assessment.mjs 保留已创建的 C28 contextReader 并返回 readers.responseContext，供 C41 组合使用；复用 assessment-composition.test.mjs 检查同一 reader，未新增领域契约。

IP-05/IP-16 三图宿主装配：start.mjs 增加 createDeploymentGraphsV1，复用 composition/{identification,assessment,risk-flow,calibration-task}.mjs、原 registry/Agent adapter/review/workflow 工厂；四类构造环按 D-21 一次绑定，foundation/checkpointer/consumer 失败关闭，模型步复用原实现。C20→C21 queryInputReader 按现有 HybridRetrievalInputReaderV1.readExact 绑定，修正 identification.mjs 的方法映射。entrypoints.test.mjs 扩展基础依赖拒绝和真实初始化库构造边界；完整 API/provider 与 Worker 生命周期另按原施工图接入，三图组合不替代生产 ready 或 task 完成。

IP-05/IP-16 调用方回归同步：apps/worker/test/risk-flow/acceptance.test.ts 复用原校准端口替身增加创建版本窄读，校准 Agent 失败时断言公共偏差与两条链边缺席；assessment/composition.test.ts 与 risk-flow/acceptance.test.ts 的旧启动夹具补齐原 issuedInvocationId/authorizationBranch，不放宽生产检查点契约。额外验证命令：pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts。

IP-05/IP-16 反馈校准时序：修改 packages/core/src/calibration/service.ts 声明 D-21 readCreatedDeviationRecordRef；所属 packages/adapters/src/calibration/postgres-calibration-adapter.ts 复用已有建议/正文 proof，按精确建议读取创建时 pending 版本。修改 apps/worker/src/assessment/graph.ts，A3 删除提前公共引用/链边，A4 用原下游授权窄读后一次登记正式引用与两条边。更新 apps/worker/test/assessment/runtime.test.ts、composition.test.ts 的端口，扩展现有真库校准测试覆盖创建、后继、复核后重读、越权和零写，图回归覆盖冻结、等待、失败及正式成功。无新 Schema、表、迁移或依赖；现有星号导出承载。验证命令：pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/assessment/composition.test.ts scripts/deployment/entrypoints.test.mjs；8 GiB API/Worker 类型构建。完整宿主与业务终态证据成立前不勾 5.2/16.1。

IP-05/IP-16 待写证明边界：`scripts/deployment/start.mjs` 对首次评估输入及完整知识准备/用户确认的 put-writes，按 D-21 使用旧 tuple 与已提交模块登记证明，避免要求新引用提前出现在旧状态；`entrypoints.test.mjs` 复用已有四操作及领域/等待用例验证成功、未登记拒绝和普通读取不放宽。无新接口、Schema、表或依赖。命令：`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 C29 正式引用证明：`packages/adapters/src/calibration/postgres-calibration-adapter.ts` 增加 D-21 verifyCheckpointReference，复用原精确 suggestion/deviation 查询、候选/校验/记录 Schema、原摘要含义与父运行/空间身份列；`packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` 复用真实建议写链，覆盖两类引用、错版本/主体/父运行/空间、历史偏差与零写。宿主 `start.mjs`、`entrypoints.test.mjs` 组合 C30/C29，同次 proof 使用已关联精确子运行为 parentRunRef。无新 Schema、表、迁移或依赖。命令：`pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。公共偏差引用按本节反馈校准时序在 A4 正式提交后登记。

IP-05/IP-16 C26 证明增量：`packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts` 增加 D-21 verifyCheckpointReference，按精确预警正文、历史任务版本与可选 assessmentRecordRef 的原 task_warnings/warning_records 关系证明。扩展现有 warning 真库测试及 `scripts/deployment/start.mjs`、`entrypoints.test.mjs`，核对历史任务、正文漂移、权限与空间版本、A6 任务/评估关系及零写；宿主复用 C30/C25 先证明评估记录的运行归属与正文。既有导出承载，无新 Schema、表、依赖或迁移。命令：`pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 C27 正式建议证明：`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts` 按 D-21 增加 verifyCheckpointReference，复用原建议及校验正文 Schema、摘要、身份列与 warning-response.read；已有 index 星号导出承载。扩展 `packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` 真实写链，覆盖精确引用、当前授权/空间版本、正文/登记漂移、三项校验与全库零写。`start.mjs` 与 `entrypoints.test.mjs` 组合 C30/C27 证明。无新 Schema、依赖、表或迁移。命令：`pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 C28 证明增量：`packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts` 按 D-21 增加 verifyCheckpointReference，复用原精确 loader/parser、warning-response.read 与空间版本；补齐原预测解析的 forecastRunRef 身份列核对。既有 index 星号导出承载。扩展 `packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`，复用正式建议/采纳/预测/执行/反馈夹具核验三种正文、错版本/工程/主体/空间、授权漂移及零写；`scripts/deployment/start.mjs`、`entrypoints.test.mjs` 组合 C30 运行证明与 C28 正文，父图先证明精确子入口。无新依赖、Schema、表或迁移。验证：`pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 评估引用证明增量：`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 增加 D-21 verifyCheckpointDomainReference，复用原 A0 frozenRefs 与六类领域链边的完整引用等值、有界读取及当前权限。`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 增加 D-21 verifyCheckpointReference，复用原快照/记录 Schema、精确登记、摘要与准备关联。既有 index.ts 星号导出承载，无新 core/HTTP Schema、依赖、表或迁移。扩展 `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`，核验错版本/工程/运行/主体/范围、撤权/脱敏、登记与正文漂移、入口冲突及全库零写；`scripts/deployment/start.mjs`、`entrypoints.test.mjs` 组合两类证明，父图转发仍先核对 C03 精确子入口。命令 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts scripts/deployment/entrypoints.test.mjs`。此证明属于工程契约，完整真实业务证据交后续。

IP-05/IP-16 工作项检查点增量：修改 `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts#verifyCheckpointReference` 及现有 `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`，沿原 boolean 证明增加可选 workPlanRef 和 identification-work-item 分支，复用同运行登记/正文完整性及零写验证；`scripts/deployment/start.mjs#createDeploymentCheckpointValidatorV1` 从严格图状态传入冻结工作计划，`entrypoints.test.mjs` 覆盖有/无该计划及能力缺失。命令 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts scripts/deployment/entrypoints.test.mjs`。

IP-05/IP-16 Agent 检查点增量：`packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 增加 D-21 的只读 verifyCheckpointReference，`packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` 验证等待/终态、精确任务版本/父运行/主体/当前权限、范围与零写；`start.mjs` 组合 agentTasks 和当前图/已证明子运行的精确 parentRunRef，`entrypoints.test.mjs` 覆盖无能力、错父及 C03 不接受的子入口。原 getTask、失败/完成结果读和任务执行保持不变。

IP-05/IP-16 等待检查点增量：`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 的公开 adapter 增加 D-21 verifyCheckpointWaitingReference，复用当前授权与所属 waiting 登记表，完整 WaitingRefV1 等值有界查询。对应现有 adapter 测试验证精确等待、错版本/运行/主体、撤权/脱敏/范围及零写；`scripts/deployment/start.mjs`、`entrypoints.test.mjs` 只为知识准备和用户确认引用组合图状态完整等待及所属证明，缺登记拒绝。既有导出承载接口，无新 Schema、表、迁移或依赖。

IP-05/IP-16 复核检查点增量：`packages/adapters/src/review-audit/postgres-review-audit-read.ts` 按 D-21 增加公开 verifyCheckpointReference，共用 task-detail 精确任务状态解析，核对原主体/完整元数据/精确父运行及当前权限，不读决定；既有 review-audit/index.ts 星号导出承载。`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` 扩展现有真库读面场景，验证等待/终态、错版本/主体/父运行、权限收窄和零写；`start.mjs`、`entrypoints.test.mjs` 增加 reviewTasks 接线，与 Agent 任务共用 C03 父子运行证明。无 core/HTTP Schema、表、迁移或依赖新增。

IP-05/IP-16 C22 检查点增量：`scripts/deployment/composition/identification.mjs` 按 D-21 导出 createDeploymentCandidateCheckpointProofV1，组合原精确 resultStore、C06 与 C04 verifyContent。`packages/core/src/identification/candidate-finalization/service.ts` 将原 8 MiB 正文上限导出为 RISK_CANDIDATE_ARTIFACT_MAX_BYTES_V1，原读取和宿主共用。`scripts/deployment/composition.test.mjs` 验证三类原 Schema 正文、登记/输入/计划/身份/授权错配及禁止 open；`start.mjs`、`entrypoints.test.mjs` 证明 C24 输入/计划后才调用候选证明，缺少冻结引用拒绝。既有 index.ts 星号导出承载常量；不新增表、Schema、依赖或业务路径。

IP-05/IP-16 标准化风险记录检查点：`start.mjs` 组合既有 riskIdentificationRead.read 的纯 SELECT record-read，严格当前下游授权及精确本运行归属；`entrypoints.test.mjs` 验证错结果/运行/版本及脱敏拒绝，复用 `packages/adapters/test/identification/postgres-risk-identification-read.test.ts` 真库精确读取与零写用例。无新公共领域端口或生产文件。

IP-05/IP-16 checkpointer 基础装配：`start.mjs#createDeploymentFoundationV1` 对 API/Worker 要求 validateCheckpointReference 函数，在业务数据库连接前拒绝缺口，并用配置的独立 checkpointerRoleName/密码构造 createPostgresCheckpointer；返回真实 checkpointer，end 纳入既有资源关闭流程。provision 不建立该连接。`deploymentConnectionV1` 明确支持 checkpointer 职责，`entrypoints.test.mjs` 验证角色/秘密隔离、缺校验函数与缺独立密码的启动拒绝。业务启动不调用 setup 或执行 DDL；真实 PostgreSQL 角色权限与 saver 行为复用 C03 已有回归。

共同基础：db=createPostgresRuntime.db；transactionUnit=createPostgresTransactionUnit；checkpointer=createPostgresCheckpointer；access=createPostgresLocalIdentityAccess；artifactStore=当前 synthetic-acceptance 本地 C04（IP-03 remote adapter 单独保留；正式远程宿主未开放）；referenceGuard=本地 PG guard；modelGateway=按 D-23 精确部署 registry 选择 createLlamaCppModelGateway 或 createNetworkApiModelGateway；文档转换=createMineruDocumentParser（接口及实施归独立 change adopt-mineru-document-ingestion）；review=createPostgresReviewAuditAdapter；idempotentConsumer=createPostgresIdempotentConsumer。所有模型/文档/工件/预算入参使用所属 strict Schema，不从 demo 私有 fixture 获取。IP-01 先建立 Desktop manifest/tsconfig，完整主进程在 IP-09 完成后根 build 才作为通过证据；宿主测试加载 dist 前由测试 setup 使用现有 tsc -b apps/api apps/worker 构建服务侧，不依赖未完成的桌面或开发服务器。

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
| IP-13 | 13.1（程序基础） | 安全 HTTPS 桌面入口的验收预检 | apps/desktop/test/e2e/client.spec.ts、acceptance.mjs；playwright.desktop.config.ts | 已实现预检/基础启动定义；完整场景及实跑交 IP-18，正式安装交 C38 F-02 | D-14/D-15/D-24 |
| IP-14 | 14.1–14.2（文档/拆分准备） | 工程范围与证据索引 | deployment/ACCEPTANCE.md、OPERATIONS.md；本 change 工件 | 保留已实现手册、示例和工程映射；固定检查点/必要审计仍见 verification，完整功能报告和门禁交 IP-22 | D-12/D-22/D-24 |

| IP-15 | 15.1–15.3 | 模型部署能力和尺寸由配置冻结；结构化生成必须按冻结 Schema 提交并经本地 Zod 复验；网络 API 必须保持原网关的授权预算与证据契约；测试替身和真实 llama.cpp smoke 分层验收 | §7 增量文件表；原 C05 port 与 adapter | strict 协议判别配置/受限秘密；提取 C05 公共调用运行逻辑；OpenAI Chat Completions 结构化/流式与 Ollama 原生 Embedding；预算、协议和模型身份复验；C04 安全证据；真实三能力 smoke。 | D-23、原 C05/C04/C06 契约 |
| IP-16 | 16.1–16.2 | 有界服务宿主、预置及终态报告程序 | §7 增量文件表 | 已实现合置本地 C04 的 API/Worker 工厂、显式生命周期、provision、三类正式只读终态和安全报告；完整业务取证交 IP-19–IP-21。 | D-20/D-21/D-24 |

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

## 6. 保留范围逐场景工程证据

本矩阵仅映射当前 11 份保留 delta 的工程契约，不把契约回归作为真实业务或 Electron 完整验收。每个场景单独列出并复用证据组；实际执行/历史/未执行分类见 verification。完整功能及 C38 场景已移出本矩阵，见后续施工图和 handoff.md。

| Capability / Requirement / Scenario | IP-ID | 证据组 |
| --- | --- | --- |
| domain/module-interfaces-events-workflows / Worker 按精确因果事实耐久消费父图事件 / 子事件先于父关联提交 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / Worker 按精确因果事实耐久消费父图事件 / 图已消费但回执提交失败 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / Worker 按精确因果事实耐久消费父图事件 / 验收子运行版本不符 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / 识别规划接口返回正式已登记计划 / 正式计划按精确输入返回 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / 识别规划接口返回正式已登记计划 / 缺计划或拒权保持失败边界 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / 反馈校准检查点只登记已提交公共偏差 / 输入冻结与 Agent 等待不冒充公共记录 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / 反馈校准检查点只登记已提交公共偏差 / 正式建议成功后登记精确版本 | IP-05/IP-06/IP-16 | E18 |
| domain/module-interfaces-events-workflows / 反馈校准检查点只登记已提交公共偏差 / 缺失或越权的创建记录拒绝推进 | IP-05/IP-06/IP-16 | E18 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包评分规则使用真实来源与正式治理 / 配置包无需评分 Agent 即进入人工治理 | IP-04/IP-16 | E17 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包来源及版本确定性校验 / 包或来源漂移时拒绝提交 | IP-04/IP-16 | E17 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包来源及版本确定性校验 / 两种来源不能混用 | IP-04/IP-16 | E17 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包沿用人工审核及原子发布门禁 / 配置包保留原发布门禁 | IP-04/IP-16 | E17 |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 两种入口访问同一业务对象 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面 / 原型数据或页面遗漏 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 越界导航或本机调用 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力 / 基础上传与下载 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 有效证书与真实登录 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界 / 证书失败或权限撤销 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 首次连接失败与恢复 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 窗口关闭后任务继续 | IP-09/IP-13 | E09 |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令 / 命令响应丢失与订阅重连 | IP-09/IP-13 | E09 |
| platform/engineering-baseline / 单一生产 workspace / 发现全部生产成员 | IP-01 | E01 |
| platform/engineering-baseline / 单一生产 workspace / Demo 不进入生产依赖图 | IP-01 | E01 |
| platform/engineering-baseline / 冻结且可重放的工具链 / 冻结安装成功 | IP-01 | E01 |
| platform/engineering-baseline / 冻结且可重放的工具链 / 清单与锁文件不一致 | IP-01 | E01 |
| platform/engineering-baseline / 冻结且可重放的工具链 / 不受支持的 Node 主版本 | IP-01 | E01 |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 全 workspace 构建 | IP-01 | E01 |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 公开入口可解析 | IP-01 | E01 |
| platform/engineering-baseline / 可构建的应用与深层共享包 / 深层导入被拒绝 | IP-01 | E01 |
| platform/engineering-baseline / 强制单向依赖边界 / 合法依赖图 | IP-01 | E01 |
| platform/engineering-baseline / 强制单向依赖边界 / 反向或跨应用依赖 | IP-01 | E01 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 配置化部署调用成功 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 业务不能选择模型名 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结 / 部署能力或版本不匹配 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 双重约束后的结构化结果成功 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / Schema 提示与本地严格复验 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 非法 JSON 结构失败 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / Zod 复验失败 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 服务端 Schema 约束缺少证据 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / 输出 Schema 无法安全转换 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验 / reasoning 内容不进入持久化或展示 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 测试替身不进入生产导出 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 真实服务走通三项能力 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 真实服务不可用不会被跳过为成功 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收 / 当前网络 API 形成三能力证据 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 合法联网后端被业务复用 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 无权资料或秘密进入客户端 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 网络协议失败保持原错误边界 | IP-15 | E15 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约 / 后端切换不得复用旧向量空间 | IP-15 | E15 |
| platform/offline-private-deployment-and-operations / 生产检查点按当前运行验证真实引用 / 当前上下文与检查点引用一致 | IP-05/IP-16 | E05 |
| platform/offline-private-deployment-and-operations / 生产检查点按当前运行验证真实引用 / 引用或运行归属无法证明 | IP-05/IP-16 | E05 |
| platform/offline-private-deployment-and-operations / 评估启动状态不得引用未登记快照 / 首次评估经过真实 A0 | IP-05/IP-16 | E05 |
| platform/offline-private-deployment-and-operations / 评估启动状态不得引用未登记快照 / 后续阶段缺少入口快照 | IP-05/IP-16 | E05 |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 真实跨 VM 写入与读取 | IP-03 | E03 |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约 / 断流或传输身份越权 | IP-03 | E03 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 完整来源装配并保留质量查询授权 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 策略漂移或质量门禁失败 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 独立知识发布后的受限命令因果授权 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 评分配置包使用同一正式治理实例 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 预测、校准、现场和报告按精确部署绑定解析 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源 / 预测执行器使用运行时已核验策略 | IP-04/IP-05 | E04 |
| platform/offline-private-deployment-and-operations / 合成验收资料预置必须使用正式权限与模块入口 / 文本资料按正式身份预置并重试 | IP-16 | E16 |
| platform/offline-private-deployment-and-operations / 合成验收资料预置必须使用正式权限与模块入口 / 预置缺少授权、版本或 OCR | IP-16 | E16 |
| platform/offline-private-deployment-and-operations / 合成验收资料预置必须使用正式权限与模块入口 / 合成现场配置绑定正式工件 | IP-16 | E16 |
| platform/offline-private-deployment-and-operations / 合成验收资料预置必须使用正式权限与模块入口 / 合成检索样例用于真实测量 | IP-16 | E16 |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 阶段重放与权限隔离 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权 / 审计失败与授权缺项 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 客户端只访问应用入口 | IP-10/IP-09 | E10 |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界 / 同机副本与宿主故障边界 | IP-10/IP-09 | E10 |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 受控导入核验完整介质 | IP-10/IP-09 | E10 |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 制品不完整或不匹配 | IP-10/IP-09 | E10 |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验 / 已验收界面尚未进入生产构建 | IP-10/IP-09 | E10 |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 同一配置可重放 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 配置非法或秘密不可用 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 秘密轮换保持历史可追溯 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约 / 检索质量输入按精确配置加载 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 空实例初始化成功 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 初始化重放或部分失败 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限 / 运行主体试图越权 | IP-02 | E02 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 真实实例完成请求和后台消费 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 缺少必需接线 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 进程重启与事件重投 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 有界停止未能完成 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝 / 真实运行事件从耐久游标恢复 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 安全同源访问和重连 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 依赖失败或正在维护 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露 / 慢探针或无权查询 | IP-06/IP-16 | E06 |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 完整停写备份成立 | IP-11 | E11 |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 停写失败或工程授权不完整 | IP-11 | E11 |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 复制、空间或耐久记录失败 | IP-11 | E11 |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实 / 同键重试与异载荷冲突 | IP-11 | E11 |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 隔离恢复与原实例并存 | IP-12 | E12 |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 缺失、损坏或快照不匹配 | IP-12 | E12 |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 索引重建与正式空结果 | IP-12 | E12 |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换 / 人工切换、拒绝与重复操作 | IP-12 | E12 |
| platform/offline-private-deployment-and-operations / 发布回退程序保持精确兼容性与人工确认 / 兼容版本按精确确认回退 | IP-12 | E12 |
| platform/offline-private-deployment-and-operations / 发布回退程序保持精确兼容性与人工确认 / 不兼容版本缺少匹配恢复点 | IP-12 | E12 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 普通命令确认后提交一次 | IP-07 | E07 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 高影响命令要求显式二次确认 | IP-07 | E07 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无权限确认卡不可提交 | IP-07 | E07 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 陈旧版本确认失败 | IP-07 | E07 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语 / 无工程的系统管理确认 | IP-07 | E07 |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 已接通页面与 v2 分区一致 | IP-08/IP-07 | E08 |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线 / 刷新切换与服务异常 | IP-08/IP-07 | E08 |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 真实浏览器完成 C35 链路 | IP-08/IP-07 | E08 |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性 / 慢读和环境缺失 | IP-08/IP-07 | E08 |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 真实数据与页面可达 | IP-08/IP-07 | E08 |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实 / 工程切换与失败 | IP-08/IP-07 | E08 |
| web/assessment-warning-and-response-ui / C34 必须以真实浏览器验收业务接缝 / 真实闭环与失败边界验收 | IP-08/IP-07 | E08 |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 页面渲染当前工程的真实事实 | IP-08/IP-07 | E08 |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实 / 写操作入口不存在 | IP-08/IP-07 | E08 |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成只读链路 | IP-08/IP-07 | E08 |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | IP-08/IP-07 | E08 |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 页面渲染当前工程的真实事实 | IP-08/IP-07 | E08 |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实 / 假写入口不存在 | IP-08/IP-07 | E08 |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 真实浏览器完成识别与复核链路 | IP-08/IP-07 | E08 |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝 / 环境不可用明确失败 | IP-08/IP-07 | E08 |

| 证据组 | 现有源文件与符号 | 测试及可运行命令 |
| --- | --- | --- |
| E01 | 根 workspace/package/tsconfig 与依赖边界 | scripts/check-dependency-policy.test.ts；`pnpm build && pnpm deps:check && pnpm deps:policy` |
| E02 | packages/adapters/src/deployment/{schema,secrets,initialization,operations}.ts | packages/adapters/test/deployment/config-operations.test.ts；scripts/deployment/release.test.mjs；`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts scripts/deployment/release.test.mjs` |
| E03 | packages/adapters/src/artifacts/remote-*；原 C04/ref guard | packages/adapters/test/artifacts/remote-artifact-store.test.ts；`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts` |
| E04 | start.mjs#resolveDeploymentPoliciesV1/createDeploymentScoringGovernanceV1；identification/risk-flow composition | packages/adapters/test/deployment/policies-readers.test.ts；scripts/deployment/assessment-composition.test.mjs；risk-flow-composition.test.mjs；`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs` |
| E05 | start.mjs#createDeploymentCheckpointValidatorV1；三图 runtime 和所属模块精确证明 | scripts/deployment/entrypoints.test.mjs；apps/worker/test/assessment/runtime.test.ts；各所属 adapter test；`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs apps/worker/test/assessment/runtime.test.ts` |
| E06 | start.mjs#createDeploymentApiV1/createDeploymentWorkerV1/createDeploymentOutboxDispatchV1；lifecycle.mjs | scripts/deployment/lifecycle.test.mjs；api-ports.test.mjs；packages/adapters/test/deployment/observability.test.ts；`pnpm exec vitest run scripts/deployment/lifecycle.test.mjs scripts/deployment/api-ports.test.mjs packages/adapters/test/deployment/observability.test.ts` |
| E07 | apps/web/src/api/client.ts 与统一确认/路由 | apps/web/test/confirmation.test.ts、focus.test.ts、routing-context-actions.test.ts；`pnpm exec vitest run apps/web/test/confirmation.test.ts apps/web/test/focus.test.ts apps/web/test/routing-context-actions.test.ts` |
| E08 | apps/web/src/{pages,api,agent,components}；路由/迁移附表 | apps/web/test/browser/*.spec.ts 与原生产构建 HTTP/PostgreSQL harness；`pnpm test:browser` |
| E09 | apps/desktop/src/{main,security}.ts；安全 HTTPS 入口 | apps/desktop/test/security.test.ts、packaging.test.ts；`pnpm test:desktop` |
| E10 | scripts/deployment/release.mjs、package-desktop.mjs；deployment 服务/网络模板 | scripts/deployment/release.test.mjs；`pnpm exec vitest run scripts/deployment/release.test.mjs` |
| E11 | scripts/deployment/backup.mjs；原维护回执及 C04 manifest | scripts/deployment/backup.test.mjs；`pnpm exec vitest run scripts/deployment/backup.test.mjs` |
| E12 | scripts/deployment/restore.mjs；原隔离核验/人工激活/回退 | scripts/deployment/restore.test.mjs；`pnpm exec vitest run scripts/deployment/restore.test.mjs` |
| E15 | packages/adapters/src/model/{config,model-gateway-runtime,network-api-model-gateway,llamacpp-model-gateway}.ts | packages/adapters/test/model/{network-api-model-gateway,llamacpp-model-gateway}.test.ts；显式 network smoke；`pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts` |
| E16 | scripts/deployment/provision.mjs；scripts/acceptance/{synthetic,functional}.mjs | scripts/deployment/provision.test.mjs；scripts/acceptance/{synthetic,functional}.test.mjs；`pnpm exec vitest run scripts/deployment/provision.test.mjs scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs` |
| E17 | packages/core/src/scoring-rules 与 packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts | packages/core/test/scoring-rules/scoring-rules.test.ts；packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts；`pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` |
| E18 | workflow adapter#readEventParentRun/verifyEventConsumption；identification adapter#readRegisteredWorkPlan；assessment graph A3/A4 | workflow/identification/calibration adapter tests；risk-flow/assessment runtime tests；composition tests；`pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts` |

## 7. 文件清单与升级条件

IP-05/IP-16 C30 引用证明：`packages/adapters/src/workflow/postgres-workflow-adapter.ts` 增加 verifyCheckpointReference 布尔公开接缝，复用原当前授权、readRow 与 C04 verifyContent；`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` 扩展原精确登记场景，核对阶段/路线/错误/结果、错运行/版本/权限、正文损坏及零写入。既有 workflow/index.ts 类型出口承载新方法，无新迁移、依赖或事实表。

IP-04 受控策略加载：`scripts/deployment/start.mjs` 的 loadDeploymentPoliciesV1 与数据集共用受控、有界文件读取；`scripts/deployment/entrypoints.test.mjs` 的真实文件夹具及越界、链接、超额场景同步，目录以原 releaseId 绑定批准发布。D-19 的策略清单数量按 D-20 的十六类同步，无新增配置字段或依赖。

IP-05/IP-16 宿主运行证明：`packages/adapters/src/postgres/transaction-unit.ts` 的 readWorkflowRunBinding 增加可选 actorId/authorizationContextRef 筛选并核对原审计，原调用方不变；`packages/adapters/test/postgres/postgres-foundation.test.ts` 扩展既有启动收据真实场景。`scripts/deployment/start.mjs` 的生产引用校验组合当前 C06、工程精确图版本、原启动/父子身份、既有识别身份派生与所属模块证明；`scripts/deployment/entrypoints.test.mjs` 验证缺上下文、身份漂移、未支持引用和模块证明失败。未支持路径失败闭合且不记完整宿主完成。

IP-03/IP-05/IP-16 无写入正文证明：`packages/core/src/artifacts/store.ts` 增加可选 verifyContent 服务端窄口；`packages/adapters/src/artifacts/filesystem-artifact-store.ts` 复用原私有 open/流核验但跳过全部访问/诊断写入，完整有界消费后返回所属模块 boolean；`packages/adapters/src/artifacts/index.ts` 的本地 handle 透传，`scripts/deployment/start.mjs` 的受权包装透传且每次复验 C06。C24 verifyCheckpointReference 与 C15 准备证明消费该口；扩展 `packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 及 C24/C15 真实测试，覆盖摘要损坏、范围/用途/大小拒绝和审计/工件/回执计数不增。普通 open 沿原审计；无远程协议、依赖或迁移增量。

IP-05/IP-16 C15 准备引用证明：`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` 提取 readExactPreparation 的私有共用精确解析，增加 verifyPreparationReference（D-21），保留原回执/审计行为且证明不写入；`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` 扩展既有真实准备场景覆盖精确版本、主体/工程/撤权与校验不增回执/审计。既有 class 出口承载新方法，无新依赖或表。

IP-05/IP-16 所属模块证明：`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts` 增加 verifyRecommendationCandidateReference（D-21），复用原私有精确候选读取和当前 read 权限，核对冻结父运行及精确空间版本，仅返回 boolean；既有 index.ts 星号导出具体 adapter 无需新增导出层。`packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` 扩展真实候选场景覆盖不存在、错版本/运行/工程、无权和只读不增事实。`scripts/deployment/start.mjs` 组合生产引用验证器，`scripts/deployment/entrypoints.test.mjs` 覆盖缺上下文、当前权限、精确启动身份和不支持引用失败闭合。无新依赖或表。

IP-05/IP-16 只读授权：`packages/adapters/src/auth/deployment-authorization.ts` 将原有界关联解析复用于 readDownstreamContext，返回既有 context/branch/invocationId，复验 root/目标及范围，不签发或补写；resolveDownstreamContext 保留原派生调用行为。`packages/adapters/test/auth/local-identity-project-authorization.test.ts` 扩展既有关联场景，覆盖后代 root、撤权、无关联和上下文/审计计数不增。auth/index.ts 的既有星号导出承载新接口，无新表。

IP-05/IP-16 C24 图引用证明：`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` 的 adapter 接口与实现增加 verifyCheckpointReference（D-21），复用已有当前权限、精确登记行及 C04 正文，使用原签发 invocationId；`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` 扩展原 PostgreSQL 登记场景，验证错版本/运行/权限与回滚。既有子路径导出承载接口，不新增通用数据库入口。

IP-05/IP-16 检查点增量（D-21）：新增 `packages/core/src/persistence/checkpoint.ts` 并由 persistence/index.ts 导出唯一 CheckpointRuntimeContextV1Schema/configurable 键；扩展 `packages/adapters/src/postgres/checkpointer.ts`、`index.ts` 的引用校验第二参数（操作、state、runtimeContext）及上下文一致性验证，保留原引用首参数和独立 checkpoint 连接。三图 `apps/worker/src/{assessment,identification/graph,risk-flow}/runtime.ts` 的 invoke/retry/resume/recover/getState 传递本次上下文。`packages/contracts/src/workflows/index.ts` 的评估 entrySnapshotRef 在 A0 可省略，后续必需；`apps/worker/src/assessment/runtime.ts` 删除 seed，graph.ts 消费点保持缺失失败。扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`、`apps/worker/test/assessment/runtime.test.ts` 覆盖启动无虚假引用、后续缺快照拒绝、上下文/工程/运行错配、四种操作以及缺失/回滚引用。生产 validator 在 start.mjs 组合，所属模块窄读具体文件按精确引用映射补入此节后实施。无依赖、DDL 或第二引用登记表，本任务只记已实现接缝，业务证据交后续。

同一 IP-ID：`apps/worker/src/identification/graph/graph.ts` 的运行上下文携带原已签发 invocationId；`packages/core/src/workflow/service.ts` 与 `packages/adapters/src/workflow/postgres-workflow-adapter.ts` 增加 readAssessmentEntrySnapshot 精确受权窄读，API不开放；评估 A0 graph.ts 写既有 inputSnapshotRef，runtime.ts 异步 stateOfCursor 读正式入口，原测试 adapter 使用真实窄口。`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` 扩展既有受权读取用例（如测试分片归 runtime.test.ts 则复用，不重复）。不修改历史迁移。

IP-05/IP-16 入口登记迁移：新增 `packages/adapters/src/postgres/migrations/workflow/deliver-offline-private-deployment-and-operations/000058_assessment_entry_snapshot_reference.ts`，只变更 entry-snapshot 对 input_snapshot_ref 的可选配对，保留其余配对与已登记行；down 不兼容时拒绝回退。`packages/adapters/test/postgres/postgres-foundation.test.ts` 与 `packages/adapters/test/auth/fixture.ts` 注册此迁移；`packages/adapters/test/deployment/config-operations.test.ts`、`deployment/release-manifest.example.json` 更新最终版本 000058。复用真实 C30 三入口登记/读取及 Worker 恢复/取消回归，普通测试不得记预期失败。

同一 IP-ID 的初始运行证明：`packages/adapters/src/postgres/transaction-unit.ts` 增加 readWorkflowRunBinding 公共 boolean 窄读，保持 C03 私表访问在所属模块；`apps/worker/src/risk-flow/runtime.ts` 的原绑定携带 threadId，`apps/worker/src/assessment/runtime.ts` 的 start 在图调用前登记原启动收据/审计；不增表。扩展既有 foundation/runtime 测试覆盖同载荷重放、错工程/运行版本/线程、未提交或回滚收据拒绝。

同一窄读支持精确 parentRunRef 因果证明，连接原启动审计并核对 action/target/run/thread；`apps/worker/src/identification/graph/runtime.ts` 与 assessment/runtime.ts 的启动 reasonRef 保存原父运行。复用 foundation 与两子图 runtime 测试，覆盖相同工程不同父运行/版本和缺失因果关系，不造第二运行注册表。

IP-05/IP-06/IP-16 SSE 增量：新增 `packages/adapters/src/postgres/migrations/workflow/deliver-offline-private-deployment-and-operations/000057_workflow_run_events.ts`，按 D-21 创建仅引用的耐久关联、同事务触发器/工程顺序锁、精确历史回填与只读 grants；新增 `packages/adapters/src/workflow/postgres-run-event-reader.ts`，`workflow/index.ts` 导出工厂、options 与逐事件授权回调类型，复用原 DTO/C06 当前复验及来源窄读，固定 64 条批量和事件游标。`apps/api/src/http.ts` 增加可选 runEventSubscription 窄注入位，`apps/api/src/app.ts` 由当前 human-session 为事件精确范围签发新身份，reader 再核对主体并复验；原 subscribe 调用方保留。`scripts/deployment/start.mjs` 及 API 组合注入真实 runEvents 并要求逐事件授权方法。新增 `packages/adapters/test/workflow/postgres-run-event-reader.test.ts` 验证 ack 后恢复、跨工程/版本游标、撤权、主体替换拒绝和单批上限；扩展 `packages/adapters/test/postgres/postgres-foundation.test.ts` 迁移清单、真实同事务登记/回滚、工程内并发提交顺序与只读权限；扩展 `apps/api/test/http-shell.test.ts` 和 `scripts/deployment/api-ports.test.mjs` 验证来源授权与真实接缝转发；`packages/adapters/test/auth/fixture.ts` 纳入 000057 迁移，`packages/adapters/test/auth/local-identity-project-authorization.test.ts` 以真实 C06 回归逐事件签发、脱敏拒绝及因果与显式 run 引用的历史回填。`deployment/release-manifest.example.json` 的最终迁移版本在 000058 入口增量后固定为 000058；`packages/adapters/test/deployment/config-operations.test.ts` 的最新初始化预期同步，000056 历史报告不改写。没有新依赖或 HTTP/core Schema；文件归以上 IP-ID，迁移只由显式初始化/升级运行。

IP-05/IP-16 预测运行时接缝增量：`packages/adapters/src/response-lifecycle/forecast-executors.ts` 新增 createProductionEffectForecastExecutorResolverV1，复用原 createExecutor，`index.ts` 导出；`postgres-response-lifecycle-adapter.ts` 的 forecastExecutors 保留数组并接受同步窄 resolver，原受权正文核验后才解析，返回身份不符沿原 unavailable 收口。`scripts/deployment/composition/assessment.mjs` 消费该 resolver，删除启动期 forecastPolicies 要求。扩展 `packages/adapters/test/response-lifecycle/forecast-executors.test.ts`、`postgres-response-lifecycle-adapter.test.ts` 及 `scripts/deployment/assessment-composition.test.mjs` 验证运行时策略、缺发布与错执行器身份，并保留数组回归；同目录 `fixture.ts` 仅增加可选执行器来源注入，默认数组保持。无新依赖、迁移或 core/HTTP DTO；以上新增计划文件归此 IP-ID。

原 IP-01–IP-14 文件表保留供既有实现及必要范围内修复追溯；当前无需为未来正式交付补造未创建的 install/smoke/benchmark 或平台介质文件。正式介质、完整现场执行和资源采集的新增内容归 C38 F-01–F-05，其 allowlist 由 C38 自身规划闭合。IP-15/IP-16 的增量 allowlist 如下；同一文件串行改动，不覆盖他人改动。core 领域 DTO、历史迁移、执行图与锁文件保持保护边界。

**已批准补齐的基线缺口**：D-19 部署配置、D-20 全类型 catalog/真实 reader、IP-05 生产组合及受控资料预置纳入 C37。工程部分已按实际实现闭合，正式来源与业务补证移交后续 IP-17/IP-19。IP-04 的策略目录按 D-20 逐类型复用原 Schema、精确版本键与类型推导，修正 hybrid runtime 使用 acceptance Schema 的错误，新增隔离合成验收 purpose；扩展现有 policies-readers 行为测试覆盖实际正文/ref、缺项/漂移、深冻结及多版本解析。

IP-02/IP-16 的 projectBindings 必填十六类 policyRefs、三图 graphVersions、retrievalBudgetPolicyRef、forecastPolicyReleaseRef、calibrationTargetReleaseRef 与有界 siteContextBindings，配置测试核对缺项、重复工程与重复现场版本拒绝；新增 scoring-rules/report-export 直接复用原 Schema。IP-05 在装配前逐项精确解析并核验成员身份。IP-16 基础宿主加载发布清单 finalMigrationVersion，副作用前核验兼容，初始化与运行保持分离。

IP-02/IP-04/IP-16 按 D-19 补齐 retrievalQuality strict 配置。schema.ts 与 config.example.json 登记 datasets 的精确工程/引用/受控文件路径、containerRuntime 与 timeoutMs；config-operations.test.ts 扩展缺项、重复精确键、工程越界和路径越界的现有行为用例。start.mjs 公开受控数据集加载与报告保存入口，entrypoints.test.mjs 覆盖文件/正文身份漂移、符号链接、正式实例拒绝合成数据集和保存失败；质量门禁继续复用 composition/quality-gate.mjs 的真实测量，不复制阈值。API/Worker 在创建连接前加载，provision 不读取待预置数据集。报告按原验收 Schema 保留并绑定实例/发布/配置，在 logRoot/retrieval-quality 耐久保存后才能返回判定；无新依赖或迁移。

| 新增 Scenario | IP-ID / 文件 | 行为与证据 |
| --- | --- | --- |
| 合成验收资料预置必须使用正式权限与模块入口 / 文本资料通过受控预置并按原身份重试 | IP-16；provision.mjs / provision.test.mjs / start.mjs | 真实登录、原模块写入、正式结果引用、安全 checkpoint；失败续接保留原命令身份。本 change 证明程序契约；真实预置报告由后续 IP-17/IP-19 形成。 |
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
| `apps/desktop/test/e2e/client.spec.ts`、`acceptance.mjs`、`playwright.desktop.config.ts` | IP-13 | 已实现预检与两条基础用例定义，完整行为/实跑交后续 IP-18；可见 Chrome 交 IP-21，正式安装包交 C38 |
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

本 change 的工程任务已收窄并全勾，verification 记录当前工作区、逐场景工程证据及正式检查点/审计缺口。本轮用户明确要求编写该工件，尚不提交或归档。未提交代码不能被写为已验收的最终 Git HEAD，CLI 的 done 也不能替代真实 PASS。

正式工程归档仍按手册在授权后审阅并形成包含实现的固定检查点，完成 security（秘密/网络资料/Electron/mTLS）、persistence（响应/审计/检查点/恢复）、integration（完整 provider/当前授权/消费事实）及必要的流/轮询 performance 限定审计。当前没有活动审计 Task，不将测试结果声称为独立审计结论；同一收尾最多一次限定审计。

后续功能 change 按 IP-17–IP-22、D-25–D-30 完成真实功能报告与自己的验收；F-01–F-05 只供 C38 消费，不能用本 change 工程报告声明最终交付。
