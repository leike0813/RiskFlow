# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`e26ca45db5d124793b1c323ac83687f629913a3f`。实施前核对 HEAD、dirty paths、实际符号与共享 C34 工作；本工件不授权提交、切分支或覆盖既有改动。
- 权威输入：本 change proposal、九份 delta specs、design D-01～D-12；所属主规格及已归档 C04/C06/C11/C14/C18/C19/C22/C25/C28、`fix-assessment-entry-read-seam`。已归档基线提供作用域和入口读取；C34 是后续消费者，不是本 change 的未归档依赖。
- 规划完整的定义是 proposal/specs/design/implementation-plan/tasks 全部满足 applyRequires。verification 由实施后 Finalizer 按最终检查点创建，Planning 不提前创建。
- 以下 E-R/E-P/E-S/E-H/E-W 是证据命令别名，只为表格缩短；tasks 写实际命令。每个新增测试文件须先创建再运行，Docker/浏览器缺失不得 skip 后报完成。
- adapters 从 core 的 dist 导出解析；修改 core/contracts 后先运行 `pnpm build`，再运行所属 adapters 证据命令，避免用旧构建产物判断接缝。

| 证据 | 实际命令 |
| --- | --- |
| E-R | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/engineering-data/context-source.test.ts packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` |
| E-P | `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/core/test/response-lifecycle/forecast.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/response-lifecycle/forecast-executors.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| E-S | `pnpm exec vitest run packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/worker/test/engineering-data/cleaning/composition.test.ts` |
| E-H | `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/web/test/api-client-openapi.test.ts apps/web/test/ssr-shells.test.tsx` |
| E-W | `pnpm build`；`pnpm --dir demo build`；`pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/quality.spec.ts`；`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/read-only.spec.ts` |

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | contracts ports 的 RiskInputVersionRefV1Schema；core engine/schema 的 RiskInputFactFieldV1Schema；engine/service 的 RiskInputFactsReaderV1 | 字段同源、原读取签名、只分派工厂 | 第二套 XOR、标量或证据 Schema |
| IP-02 | identification/read/postgres-risk-identification-read.ts 的记录解析与作用域语义；standardized_risk_records 已保存列 | 同 owning domain 精确窄读，六标量 | 识别中间候选、最新版本、补空作用域 |
| IP-03 | C11 external_risk_events/source_versions/source_segments；ArtifactStoreV1 verified handle | 精确事件结构化字段读取，原登记契约不变 | 从自由正文猜字段／来源身份 |
| IP-04 | C11 #freezeAssessmentPreparation/readAuthorizedSourceVersions/readAssessmentPreparationContext；core scoring-rules 的 AssessmentPreparationProjectionV1Schema/AssessmentPreparationSnapshotReaderV1；C25 #loadRiskFacts/evaluate；C15 readBoundResult、C19 prepareAuthoring/assembleApplicableRuleSetRevision/resolve/readAssessmentBasisReleaseSet、C16 govern/C07 审阅、C18 resolveConfigurationSet；现有 cleaning/scoring/risk-assessment fixtures | 六字段投影和 C11 生产 reader、共用保存范围复验与来源映射、真实清洗与审核发布、C19 核对真实 C18 配置、单库生产接缝验收 | harness 事实／准备投影闭包、伪发布依据、来源授权与资料版本混用、评估准备携带编制清洗事实、仅凭任务存在替代 C15 收口 |
| IP-05 | PostgresRiskAssessmentEngine 的 #loadBasis、#verifyCommand、monitoringReader；engine 的 scoreAssessmentAxes/mapAssessmentRiskLevel | 窄上下文、基线精确回读、纯风险状态投影 | 新 P/C、矩阵或实际指标事实 |
| IP-06 | assessment-config canonical decimal；engine/decimal 的 roundDecimal、addDecimals/multiplyDecimals；response-lifecycle/schema | 有界参数工件、三个纯算法、除法 | 硬编码措施效果、任意代码公式 |
| IP-07 | C28 forecastResponse、verifyForecastExecutorResult、#persistForecast、ResponseLifecycleFrozenContextV1；原 authorizer | 请求补全、部署执行器、结果联合解包 | 第二套预测表／事件／工作流 |
| IP-08 | auth adapter 私有 readSession/touchSession、SessionResult、LocalIdentityAccessV1 | 非 token view、受限会话、自省入口 | mint token 或管理／工程上下文 |
| IP-09 | HTTP_SYSTEM_ROUTE_CATALOG、SessionMetadata、cookieToken/mapHttpError；C09_SYSTEM_ROUTE_CATALOG/requestJson | 单一路由定义、GET 客户端 | 手写第二份 OpenAPI 及认证错误分类 |
| IP-10 | demo SessionContext、LoginPage、AppShell、next 路径 | 启动恢复／受限改密／注销收口 | 本地角色镜像、假成功注销 |
| IP-11 | apps/web initialWebState、RestrictedPage、createRequestRevisionGuard、App.sessionContent | checking 启动、失败重试、代次防覆盖 | 新认证状态机或无关注销界面 |
| IP-12 | 两套现有 Playwright server、真实 C06 登录与 quality/read-only specs | 受限账号、真实 Cookie、延迟／错误注入与收尾证据 | Mock 成功业务后端、C34 业务装配 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1 | 风险输入事实接缝由各所有者实现并保持统一投影，两场景 | contracts ports；core engine schema/service/index、新 risk-input-facts.ts；contracts module-interface tests | D-01 共享字段迁移／重导出、strict request、kind 分派；原接口注释澄清 owning domains | XOR 形状、字段预算、原 requestId |
| IP-02 | 1.2 | 正式风险记录按精确版本提供评估标量投影，四场景 | identification/read 新 owning reader 与 index；新 reader tests | D-02/04 C06 两阶段复验、精确行／验收／范围／证据、六标量 | 不查询其它域或补权限 |
| IP-03 | 1.3 | 外部事件所有者提供有证据的结构化风险事实，五场景 | core context-source/schema；adapter 新 external reader/index；core 与 adapter existing context-source tests | D-03/04 strict artifact、身份/证据/源资格、verified bounded read | 原自由事件登记及历史正文 |
| IP-04 | 1.4 | 两个消费者使用同一事实提供者；两个正式输入成功场景；评估准备向风险事实读取传递当前获准来源范围，两场景；冻结来源范围贯穿正式评估读取；评估依据准备投影由所属域提供，三场景；公共评估依据解析，三场景 | core scoring-rules/service；C11 registry #freezeAssessmentPreparation/readAuthorizedSourceVersions/readAssessmentPreparationContext、新 readAssessmentPreparationSnapshot；C19 assembleApplicableRuleSetRevision/resolve；C25 #loadRiskFacts/evaluate；C11/C19/core scoring/risk-assessment tests、fixtures 与生产接缝辅助文件 | D-04 有界映射与当前资源范围；D-12 六字段生产准备投影、共用所属行读取及保存范围复验、两个 C19 消费者核对真实准备／C18 配置、同库真实清洗／编制／审核发布和两种 XOR 持久回读 | C06 子集规则与公共契约、公开 assessment snapshot 字段、C15 合格编制来源及人工发布门禁；不接 C34 两套业务组合根；原故障 stub 默认行为 |
| IP-05 | 2.1 | 预测风险状态使用冻结评分依据进行纯计算，三场景；预测指标进入同一冻结评分依据 | core engine/service、engine.ts；PostgresRiskAssessmentEngine；既有 engine tests | D-08 窄评分类型、ForecastRiskStatePort、回读自域基线/快照/值、目标序列复验、内存覆盖后计算 | 实际写路径、正式评分公式、原 Schema |
| IP-06 | 2.2 | 三类生产预测执行器消费精确参数模型与正式措施，三场景 | response-lifecycle/schema/index、新 forecast.ts；engine/decimal；core response tests、新 forecast.test.ts | D-05/06/07 模型 Schema/预算/来源标记、三算法、除法与参数化算法例 | C18 配置定义与公式禁止边界 |
| IP-07 | 2.3、2.4 | 参数预测必须诚实不可用并从冻结事实重放，四场景；预测执行只消费有界正式输入及评估所有者的计算接缝，两场景 | 新 forecast-executors.ts/index；C28 adapter；existing C28 test/fixture、新 executor tests；新共享生产 fixture | D-05/08 请求带真实措施与受权身份；结果联合解包；C04模型→纯算法→C25投影→原C28事务；旧夹具统一工厂迁移 | 原公开预测、回执/审计原子性、同键判异 |
| IP-08 | 3.1 | 当前会话元数据由服务端验证后提供，四场景 | access schema/service；auth adapter；access/auth tests；worker cleaning composition stub | D-09 view 复用、readSession、touch、停用账号 SESSION_REVOKED；补完整接口字面量 | 其它授权错误映射、绝对期限、token |
| IP-09 | 3.2 | HTTP 提供安全 Cookie 当前会话查询，四场景 | API http/app/http-shell tests；appsweb api/http/api-client test | D-10 introspect 路由、mapSessionView、GET客户端无 body、目录与OpenAPI一致 | Set-Cookie、Cookie安全策略、业务路由 |
| IP-10 | 3.3 | Web 启动恢复正式会话并保护认证状态竞态，六场景 | demo api/client/session/context、App/LoginPage/AppShell | D-11 restore/受限/技术失败/重试、changePassword、认证代次、logout成功才清 | 原深链、工程门禁及现有样式 |
| IP-11 | 3.4 | Web 启动恢复正式会话并保护认证状态竞态，前五场景 | appsweb main/App、ssr-shells tests | D-11 checking初态、现有guard、受限改密、failed恢复重试 | 原RestrictedPage与已有状态类型 |
| IP-12 | 4.1、4.2、4.3 | Web 全场景；所属接口集成与最终证据 | 两套 browser server/spec；tasks/实施后verification | D-12真实Cookie/受限账号/竞态；最小必要全仓检查；记录证据 | 不提前verification、不接管C34 17页验收 |

## 4. 调用与副作用顺序

1. 共享生产夹具的实施顺序为 IP-01→IP-02/03→IP-04（真实 C19 收口）→IP-05/06→IP-07→IP-08/09→IP-10/11→IP-12。IP-06 纯算法可独立推进；IP-05/07 的集成证据依赖 IP-04 的真实已发布依据，直接复用该装配。领域／会话若在隔离编辑范围内并行仍各守依赖，共享文件必须串行。
2. 风险读取：strict 请求→C06 当前分支/身份 verify→owning 精确行与最小范围元数据→保存作用域全量复验→owning payload/C04 verified正文→原身份字段/证据结果。无写事实，无“最新”替换；任一步失败不产出部分 fields。
3. 正式评估：C11 原入口授权复验→从当前 grant refs 通过自有登记表有界解析 source-version refs→原事实分支签发及资源子集校验→owning reader 两阶段复验→原事务冻结 preparation→C25 当前授权复验 preparation binding→以该空间／来源签发同一 reader 分支并校验资源子集→读取原 basis/monitoring→原确定性 evaluate→原 assessment/receipt/audit/outbox事务。测试两种 XOR 均须实际取得引用并持久回读。C11 共用解析来源映射，不将 source-access-grant ref 强转为 source-version ref；C25 #loadRiskFacts 所需 binding 在 evaluate 的现有 #verifyCommand 后传入。
4. 预测：C28 现有采纳/运行绑定／授权→正式建议及冻结输入→策略和执行前监测→精确 executor→模型用途权限及工件→纯参数算法→C25 窄投影（自有精确基线及原basis）→结果复验→C28 原 #persistForecast。缺合法输入走 typed unavailable；越权、非法工件/结果直接失败；技术错误不降级。available/unavailable仍同键重放和整事务回滚。
5. 自省：解析唯一 Cookie→C06 原事务 readSession(allowRestricted)→状态/版本/期限检查→touch idle→元数据投影→no-store HTTP。无需 command_receipts/outbox；不 mint 授权或 token。
6. Web：checking/restoring→GET→authenticated/restricted/anonymous/failed；仅401匿名。认证每次begin代次／取消旧请求→只接收当前代次→保留原URL→正常会话才走原业务门禁。demo logout技术失败保留会话，成功清会话和上下文。

## 5. Schema、状态与持久化落实

- D-01字段共享只迁移定义，不增加标准风险记录字段；外部结构化工件新增正文格式，原事件登记命令仍接受原工件引用。D-02/03 六标量／结构化字段永远来自精确正式事实。
- D-04 不改变 C06 authorize/verify。C11 从 `decision.context.sourceAccessGrantRefs` 解析有界资料版本；共用 helper 保留 `readAuthorizedSourceVersions` 原分支、稳定 grant identity、ready 状态、数量／身份校验和排序行为。C11/C25 下游上下文由原 authorizer 签发，来源授权修订逐项属于当前复验集合；业务空间与授权空间沿现有同实体投影语义核对，不要求二者版本号相同。映射失败、来源缺权或资源范围扩张统一 AUTHORIZATION_DENIED，存储故障保留技术失败，不伪装权限拒绝。
- D-12 共享 risk-assessment fixture 的 reader 注入默认保留故障 stub；生产组合增加最小真实 C19 basis reader 注入／装配，并由所属生产能力登记精确发布事实。合成 C22 最终登记种子不代表完整识别流程验收。准备快照 ref 与 riskInput ref 各按其公开 Schema 断言；字段映射使用本 change 六标量或合法外部字段，相容依据固定精确发布版本。
- D-12 真实依据装配复用 C15 `createPostgresDataCleaningStore`/C08 任务运行和 C19 `prepareAuthoring` 的现有生产行为；确定性合成 Agent 响应通过原任务、增量校验和收口，不手工写已完成任务或清洗结果。C18/结构化规则/适用规则集均通过 C16 `govern`、C07 决定与 C06 精确人类授权发布；`appendRelease` 等策略方法由 C16 事务调用，不是独立发布入口。manifest 中的清洗任务、结果工件与配置引用须真实存在且同源。
- D-12 已发布配置与规则→C11 freezePreparation→C19 assembleApplicableRuleSetRevision→C16/C07 审核发布适用规则集→C19 resolve→C25 prepare/evaluate。真实准备 projection 使用 C11 公开受权读取，真实 basis reader 注入 C25；prepareCommand 显式接受该次 resolve 返回的实际 basisRef，原默认 stub fixture 的固定引用只服务已有单测。resolve/read 的引用与成员必须持久回读，requiredAt/生效时刻明确相容。
- D-12 准备投影严格仅含 schemaVersion/preparationSnapshotRef/projectId/projectRevisionRef/applicabilitySnapshotRef/applicability，复用已有适用性 Schema；移除两个 C15 字段、配置／兼容引用和两个业务时刻，reader 请求移除 requiredAt。C11 实现既有端口，两个公开读取方法各固定 C19 assessment-basis 或 C25 evidence-access 原分支，共用 private 精确行解析与保存范围复验；不让公共输入选择分支，不签发替代授权，不扩大原 #verifyRead 的工程数据能力语义。按请求当前时刻两阶段 C06 verify，成功前核对工程修订与适用性绑定；失败不枚举存在性，技术故障不映射为权限拒绝。
- D-12 C19 assemble/resolve 必须核对 reader 返回的精确准备引用、工程／工程修订与冻结适用性；组装用真实投影值，拒绝调用方错配。分别按命令业务／记录时刻调用已有 C18 resolveConfigurationSet，核对返回的工程、工程修订和配置集合引用与组装请求／已发布规则集正文；兼容引用复用 C19 版本化策略和已发布规则修订核验。resolve 当前权限验证用 issuedAt，requiredAt 只决定业务有效性。配置解析成功可保留 C18 既有留痕，错配不得产生 C19 候选／依据成功事实。禁止从假准备投影证明配置或兼容身份。
- D-12 cleaning/scoring fixture 可抽取接受既有数据库／服务的组合 helper；原默认测试路径保持原行为，本验收路径显式选择真实 C06/C03/C04/C07/C16/C18/C19。一个 runtime 上增加适配器不构成 C34 的第二套业务组合根，不调用会另建数据库的完整 fixture starter。样本、确定性响应与测试审核注明合成待甲方复核。
- D-12 外部事件登记 helper 共用原工件写入／登记实现，默认正文由旧 helper 提供，结构化正文由新用例提供；专用 C22 种子优先留在 production-assessment-seams.fixture.ts，仅把必要依赖暴露于共享 fixture。没有 reader 切换用例时精简 restoreProductionFactsReader/restoreStubFactsReader，权限恢复只验证真实会话和 C06 当前事实，不靠重装 reader。
- D-05预测请求为内部契约扩展，所有 EffectForecastExecutor 实现和夹具同步返回联合。新增原因集中于所属 Schema，公开不可用仍沿原形状。原 `responseForecastInputDigest` 已包含方法/requiredRef/时域/冻结refs，继续复用；不能额外制造摘要门禁。
- D-06模型参数不放入 C18 配置包；C04登记 JSON工件及原受权读取。策略requiredRef固定工件，措施效果对每条正式 measureId 和原库版本逐项绑定。缺指标或措施参数必须类型化不可用，不填默认零值。
- D-08只读自身 assessment_input_snapshots/risk_assessment_records/indicator value tables，公开 C19/C14/C04接缝，不跨域私表。评分context及values分别收窄为 AssessmentScoringContextV1 和 AssessmentScoringValuesV1；完整actual evaluation沿旧形态，预测仅传indicatorId/actualValue。C25预测投影不能建立实际值集合/准备/预警/收据/Outbox。
- D-09 SessionView基座及token扩展；自省省略 systemAdministrationContextRef。已有SessionMetadata shape与cookie属性不变；仅自省停用认证归会话失效。
- D-11 demo状态在context定义一次；appsweb复用state.ts，guard原模块复用。无持久客户端会话或角色缓存。URL返回目标使用现有校验避免跨站回跳。
- 全部数据库表、约束、审计、事务、事件及迁移沿原事实源；不新增 migration。日志只记 request/operation/code/耗时，禁止 token、正文、模型内容和敏感证据。工件读取审计与业务不可用事实不可省略。

## 6. 验收证据矩阵

每行对应一个增量 Scenario；完整 Requirement 名见同列前缀。测试稳定字段、状态、值、权限与副作用，不断言整段文案、内部调用次序、CSS或随机模型响应。

表内测试简称按下表唯一解析；fixtures与修改权限以§7为准。

| 简称 | 精确测试文件 |
| --- | --- |
| reader test | `packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts` |
| C11 test | `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` |
| contracts module test | `packages/contracts/test/module-interfaces-events-workflows.test.ts` |
| core engine test | `packages/core/test/risk-assessment/engine.test.ts` |
| C25 test | `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` |
| forecast.test | `packages/core/test/response-lifecycle/forecast.test.ts` |
| executor test | `packages/adapters/test/response-lifecycle/forecast-executors.test.ts` |
| C28 test | `packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` |
| access/auth tests | `packages/core/test/access.test.ts` 与 `packages/adapters/test/auth/local-identity-project-authorization.test.ts`；auth test仅指后者 |
| http-shell/api-client tests | `apps/api/test/http-shell.test.ts` 与 `apps/web/test/api-client-openapi.test.ts`；http-shell test仅指前者 |
| ssr test | `apps/web/test/ssr-shells.test.tsx` |
| 两套browser specs | `apps/web/test/browser/quality.spec.ts` 与 `demo/test/browser/read-only.spec.ts`；demo read-only browser spec仅指后者 |

| Requirement / Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| 外部事件所有者提供有证据的结构化风险事实 / 精确结构化外部事件进入评估 | IP-03/04 | reader test；C11 test | 真实C11登记、字段工件、C06/C04/C19单库 | 原XOR、字段/证据一致；冻结并正式评估 | E-R |
| 外部事件所有者提供有证据的结构化风险事实 / 工件身份或字段证据不符时拒绝 | IP-03 | reader test | 事件键/工程/来源/证据错配表驱动 | 契约失败、无部分facts及写入 | E-R |
| 外部事件所有者提供有证据的结构化风险事实 / 任意已登记正文不能冒充结构化事实 | IP-03 | C11 test；reader test | 原任意JSON仍合法登记 | 登记成功、reader unsupported，无假字段 | E-R |
| 外部事件所有者提供有证据的结构化风险事实 / 当前权限失效或精确目标不可读 | IP-03 | reader test | 撤权/错版本/缺目标/跨工程 | 同类AUTHORIZATION_DENIED、无存在泄漏 | E-R |
| 外部事件所有者提供有证据的结构化风险事实 / 来源发布变化不改写旧事件事实 | IP-03 | reader test | 两来源版本、旧精确登记 | 仍读旧工件/证据，不读latest | E-R |
| 评估准备向风险事实读取传递当前获准来源范围 / 入口来源授权可用于准备冻结 | IP-04 | reader test；C11 test | 真实 C06 入口授权、C11 ready 来源登记、两种 XOR | grant 映射精确来源，冻结证据同源；原范围内成功 | E-R |
| 评估准备向风险事实读取传递当前获准来源范围 / 来源范围不能证明时拒绝冻结 | IP-04 | reader test；C11 test | 空／不覆盖目标的入口来源、撤权、映射缺失／歧义、authorizer 返回额外来源或空间 | AUTHORIZATION_DENIED、无部分 facts 或准备成功事实／回执／outbox；安全审计保留 | E-R |
| 正式风险记录按精确版本提供评估标量投影 / 正式记录可形成准备与评估输入 | IP-02/04 | reader test | 真实验收记录、相容字段映射/规则 | 六原标量及原证据；C11/C25成功 | E-R |
| 正式风险记录按精确版本提供评估标量投影 / 缺少正式作用域或验收事实时阻断 | IP-02 | reader test | 缺范围/验收/证据/错payload | 失败，无空范围或伪字段 | E-R |
| 正式风险记录按精确版本提供评估标量投影 / 撤权与精确引用不符不可枚举 | IP-02 | reader test | 来源撤权/错版本/跨工程/缺记录 | 同形拒绝、不泄漏记录 | E-R |
| 正式风险记录按精确版本提供评估标量投影 / 只读投影可重复重放 | IP-02 | reader test | 固定精确记录重复读 | facts相同，记录/验收/收据/事件不增 | E-R |
| 风险输入事实接缝由各所有者实现并保持统一投影 / 两个消费者使用同一事实提供者 | IP-01/04 | reader test；C11 test | 同一组合工厂实际注入C11/C25；同库 C15 收口、C19 编制、C16/C07 审核发布与 C18 配置 | 两种 XOR 的读版本/字段/证据一致，正式评估存在；实际 basis ref 与 C19 resolve/read/数据库成员一致，清洗及人工决定链可回读 | E-R |
| 风险输入事实接缝由各所有者实现并保持统一投影 / XOR 或读取身份不合法时关闭失败 | IP-01/02/03 | contracts module test；reader test | 无分支/双分支/额外键/错invocation | typed失败，无默认分派／身份改写 | E-R |
| 风险输入事实接缝由各所有者实现并保持统一投影 / 冻结来源范围贯穿正式评估读取 | IP-04 | reader test；C25 test | 两种 XOR 的真实准备／依据，C25 当前授权，缺来源／撤权／返回扩张范围的拒绝 | 按已复验 binding 签发、正式记录可回读；失败无评估成功事实／回执／outbox | E-R |
| 评估依据准备投影由所属域提供 / 真实准备支持规则集组装 | IP-04 | C11 test；C19 test；core scoring test | 无清洗字段的真实 C11 准备、原 C19 身份与保存来源授权 | strict 六字段投影；工程修订和适用性同源；真实 C19 接受 | E-R |
| 评估依据准备投影由所属域提供 / 准备读取拒绝不枚举目标 | IP-04 | C11 test | 缺失／错版本／跨工程、错 actor／invocation、来源撤权及无空间权限参数化 | 同形 AUTHORIZATION_DENIED；无部分投影或成功业务写入；技术故障保留技术失败 | E-R |
| 评估依据准备投影由所属域提供 / 投影身份或适用性错配不能用于组装 | IP-04 | C19 test | reader 返回错准备／工程修订／适用性引用或值；组装请求错配 | 消费者拒绝，无 C19 候选／依据成功事实；原 C15 编制门禁仍成立 | E-R |
| 公共评估依据解析 / 精确依据可供后续评估冻结 | IP-04 | reader test；C19 test | C11 生产投影、真实已发布规则集与完整 C18 配置 | 实际 resolve 引用和持久成员匹配，C25 消费真实 basis | E-R |
| 公共评估依据解析 / 未准备完成时不返回默认依据 | IP-04 | C19 test | 无已批准规则集或 requiredAt 所需成员不可用 | 等待／失败，无默认 basis 或历史回退 | E-R |
| 公共评估依据解析 / 配置或准备绑定不符时拒绝依据 | IP-04 | C19 test | C18 返回与请求／规则集不同配置或工程修订；准备适用性错配；兼容不符 | assemble/resolve 均拒绝，无 C19 候选／依据成功事实；C18 正常解析留痕保留 | E-R |
| 预测执行只消费有界正式输入及评估所有者的计算接缝 / 预测指标进入同一冻结评分依据 | IP-05/07 | executor test；C25 test | 真实模型/措施、精确基线与basis | 原规则/权重/矩阵重算，风险状态随值变化 | E-P |
| 预测执行只消费有界正式输入及评估所有者的计算接缝 / 接缝拒绝不能被执行器绕过 | IP-05/07 | executor test | 撤投影/来源权限、错basis/措施 | 无可用预测、不复制基线、不跨表 | E-P；`pnpm deps:check` |
| 预测风险状态使用冻结评分依据进行纯计算 / 预测值改变风险状态并可重放 | IP-05 | C25 test；core engine test | 两预测值跨评分band、同冻结basis | 确定P/C/等级，精确重放 | E-P |
| 预测风险状态使用冻结评分依据进行纯计算 / 依据或指标不相容时拒绝 | IP-05 | C25 test | 错工程/ref/单位/序列及缺成员 | typed失败，无部分风险状态 | E-P |
| 预测风险状态使用冻结评分依据进行纯计算 / 计算不产生正式实际事实 | IP-05 | C25 test | 重复投影，读取前后数据库计数 | assessment/value/preparation/warning/receipt/outbox不增；保留必需读审计 | E-P |
| 三类生产预测执行器消费精确参数模型与正式措施 / 历史统计系数产生可重放预测 | IP-06/07 | forecast.test；executor test | synthetic已训练系数、正式措施 | 数值等于声明公式，返回精确requiredRef及证据 | E-P |
| 三类生产预测执行器消费精确参数模型与正式措施 / 监测趋势消费原冻结序列 | IP-06/07 | forecast.test；executor test | 原对齐槽/缺槽/observed、720槽测量 | OLS原下标外推+措施；不采用插值/latest | E-P |
| 三类生产预测执行器消费精确参数模型与正式措施 / 机理参数有界计算 | IP-06/07 | forecast.test；executor test | 1/2/3次terms、合法domain与措施 | 规范decimal、有限计算、越domain失败 | E-P |
| 参数预测必须诚实不可用并从冻结事实重放 / 模型或样本不足时不可用 | IP-06/07 | executor test；C28 test | 缺模型/措施参数、缺值/不足/退化点 | 稳定reason、无值，不能回退方法 | E-P |
| 参数预测必须诚实不可用并从冻结事实重放 / 越权或模型结果非法时失败 | IP-07 | executor test；C28 test | 撤权、错method/unit/ref、超预算/缺证据/非法result | failed，无部分事实/成功审计/收据 | E-P |
| 参数预测必须诚实不可用并从冻结事实重放 / 发布新模型后旧预测仍可复算 | IP-07 | executor test；C28 test | 旧新工件/策略，旧原冻结refs | 旧decimal逐字符一致、同riskState | E-P |
| 参数预测必须诚实不可用并从冻结事实重放 / 正式预测保存继续原子且幂等 | IP-07 | C28 test | available/unavailable重试、并发、尾事务失败 | 同key同载荷重放、异载荷冲突、全回滚 | E-P |
| 当前会话元数据由服务端验证后提供 / 有效会话可查询无 token 元数据 | IP-08 | access/auth tests | 真实会话/时钟 | 无token/新上下文；正确idle推进 | E-S |
| 当前会话元数据由服务端验证后提供 / 首次改密会话仍可自省 | IP-08 | auth test | 真实首次改密账号 | mustChangePassword=true、业务授权仍拒绝 | E-S |
| 当前会话元数据由服务端验证后提供 / 失效会话统一拒绝恢复 | IP-08 | auth test | 停用/撤销/密码/密钥版本/期限参数化 | SESSION_REVOKED/EXPIRED，不能AUTH_DENIED404 | E-S |
| 当前会话元数据由服务端验证后提供 / 自省不延长绝对期限 | IP-08 | auth test | 可控时钟多次读、边界到期 | idle≤原absolute，边界失效 | E-S |
| HTTP 提供安全 Cookie 当前会话查询 / 有效 Cookie 返回正式元数据 | IP-09 | http-shell test | 真实或typed C06 stub有效Cookie | 200、no-store、无token/Set-Cookie | E-H |
| HTTP 提供安全 Cookie 当前会话查询 / 无有效会话或 Cookie 形状非法 | IP-09 | http-shell test | 缺失/失效/重复/畸形Cookie | 401/400原信封，所有分支no-store | E-H |
| HTTP 提供安全 Cookie 当前会话查询 / 自省服务故障保持技术错误 | IP-09 | http-shell test | C06暂态/未知技术失败 | 503/500、不转401 | E-H |
| HTTP 提供安全 Cookie 当前会话查询 / OpenAPI 与实际会话路由一致 | IP-09 | http-shell/api-client tests | route目录生成、GET客户端 | 相同path/schema/security，无requestBody/content-type/body | E-H |
| Web 启动恢复正式会话并保护认证状态竞态 / 硬刷新和直接深链保持有效会话 | IP-10/11/12 | 两套browser specs | 真实Cookie、领域id/versionURL | reload/直接页不现登录；原id/version，恢复前无业务请求 | E-W |
| Web 启动恢复正式会话并保护认证状态竞态 / 匿名恢复后保留登录回跳目标 | IP-10/11/12 | 两套browser specs | 清Cookie、401、真实登录 | next保留，正常登录原目标 | E-W |
| Web 启动恢复正式会话并保护认证状态竞态 / 受限会话恢复后完成改密 | IP-10/11/12 | 两套browser specs；ssr test | 真实初始密码账号 | reload进入改密；无业务；改密后回目标 | E-W；E-H |
| Web 启动恢复正式会话并保护认证状态竞态 / 恢复故障可以重试 | IP-10/11/12 | 两套browser specs | 一次503/断网，后续真实200 | 失败非匿名、可重试、保留URL | E-W |
| Web 启动恢复正式会话并保护认证状态竞态 / 迟到认证响应不能覆盖新操作 | IP-10/11/12 | 两套browser specs | 真实响应延迟及新认证代次 | 旧restore/login改密不能覆盖新state；demo logout后不复活 | E-W |
| Web 启动恢复正式会话并保护认证状态竞态 / 注销失败保持现有会话 | IP-10/12 | demo read-only browser spec | demo现有logout一次503，重试真实成功 | 失败保留会话，成功后匿名；不新增appsweb登出UI | E-W |

## 7. 文件清单与升级条件

下表是代码／测试精确 allowlist；每行括号中的 IP-ID 同时承担 §6 证据责任。M 表示既有文件修改，N 表示新增。没有删除项；表外不能静默扩展。

| 操作 / IP-ID | 文件 | 变化 |
| --- | --- | --- |
| M / IP-01 | `packages/contracts/src/ports/index.ts` | 字段Schema与共享预算 |
| M / IP-01 | `packages/core/src/risk-assessment/engine/schema.ts` | 字段重导出、strict读取请求 |
| M / IP-01/05 | `packages/core/src/risk-assessment/engine/service.ts` | owning注释、ForecastRiskStatePort |
| N / IP-01 | `packages/core/src/risk-assessment/engine/risk-input-facts.ts` | XOR组合工厂 |
| M / IP-01 | `packages/core/src/risk-assessment/engine/index.ts` | 新组合导出 |
| M / IP-01 | `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 共享字段/XOR契约 |
| N / IP-02 | `packages/adapters/src/identification/read/postgres-standardized-risk-input-facts-reader.ts` | 所属标准记录reader |
| M / IP-02 | `packages/adapters/src/identification/read/index.ts` | factory/types导出 |
| M / IP-03 | `packages/core/src/engineering-data/context-source/schema.ts` | 外部结构化正文Schema |
| N / IP-03 | `packages/adapters/src/engineering-data/context-source/postgres-external-risk-input-facts-reader.ts` | 所属外部事件reader |
| M / IP-03 | `packages/adapters/src/engineering-data/context-source/index.ts` | factory/types导出 |
| M / IP-03 | `packages/core/test/engineering-data/context-source.test.ts` | 正文Schema关键行为 |
| M / IP-04 | `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` | 共用有界来源映射与事实授权范围；实现 C19 准备 reader，共用 C25 所属行解析及保存范围复验 |
| M / IP-04 | `packages/core/src/scoring-rules/service.ts` | 准备投影 strict 六字段、reader 请求去 requiredAt、引用 kind 精确 Schema 与 C11 所有权注释 |
| M / IP-04 | `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts` | assemble/resolve 核对生产准备身份及值，现有 C18 解析核对真实配置集合，保留 C15 编制来源与治理路径 |
| M / IP-04 | `packages/core/test/scoring-rules/scoring-rules.test.ts` | 窄准备投影／请求契约，复用已有规则编制及组装行为用例 |
| M / IP-04 | `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` | 调整旧投影，准备身份／配置错配表驱动及真实 C19 解析证据，保留既有编制门禁 |
| M / IP-03/04 | `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` | 原登记与真正reader消费 |
| M / IP-04 | `packages/adapters/test/engineering-data/context-source/fixture.ts` | 可注入正式reader，保留故障stub用途 |
| M / IP-04/07 | `packages/adapters/test/risk-assessment/fixture.ts` | reader／basis reader 最小注入、原 stub 默认行为、真实外部正文／C22最终登记种子及 evidence-access 授权 |
| M / IP-04 | `packages/adapters/test/engineering-data/cleaning/fixture.ts` | 必要时提取接受既有 runtime/服务的最小清洗组合与合成任务 helper，避免另建数据库；原默认用例行为保留 |
| M / IP-04 | `packages/adapters/test/scoring-rules/fixture.ts` | 必要时提取 C19/C18/C16/C07 组合和审核发布 helper，允许注入现有真实 C06；原授权 stub 不进入生产接缝验收 |
| N / IP-04/07 | `packages/adapters/test/risk-assessment/production-assessment-basis.fixture.ts` | 如需独立辅助文件，集中同库真实 C15 收口、C19 编制及审核发布、实际 basis 解析；复用既有 helper |
| N / IP-04/07 | `packages/adapters/test/risk-assessment/production-assessment-seams.fixture.ts` | 单库真实C06/C04/C11/C19/识别登记/C25及合成模型/措施数据 |
| N / IP-02/03/04 | `packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts` | 两分支权限/版本/证据和冻结评估集成 |
| M / IP-05 | `packages/core/src/risk-assessment/engine/engine.ts` | 窄评分类型与形参 |
| M / IP-04/05 | `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` | IP-04 以已复验 preparation binding 签发事实读取并校验资源范围；IP-05 实现预测投影，复用owning私有读 |
| M / IP-05 | `packages/core/test/risk-assessment/engine.test.ts` | 相同规则跨边界纯计算 |
| M / IP-04/05 | `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` | IP-04 事实授权范围与既有评估回归；IP-05 精确投影及零实际写入 |
| M / IP-06 | `packages/core/src/risk-assessment/engine/decimal.ts` | 有界规范十进制除法 |
| M / IP-06/07 | `packages/core/src/response-lifecycle/schema.ts` | 模型/结果联合Schema、内部请求措施及受权身份 |
| N / IP-06 | `packages/core/src/response-lifecycle/forecast.ts` | 三个纯参数算法 |
| M / IP-06 | `packages/core/src/response-lifecycle/index.ts` | 纯算法导出 |
| M / IP-06 | `packages/core/test/response-lifecycle/response-lifecycle.test.ts` | 原校验回归、新模型/联合 |
| N / IP-06 | `packages/core/test/response-lifecycle/forecast.test.ts` | 算法/除法/边界与有界测量 |
| N / IP-07 | `packages/adapters/src/response-lifecycle/forecast-executors.ts` | 部署工厂、受权工件读、C25窄调用 |
| M / IP-07 | `packages/adapters/src/response-lifecycle/index.ts` | 工厂与options导出 |
| M / IP-07 | `packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts` | request补全、available/unavailable解包、原事务持久化 |
| M / IP-07 | `packages/adapters/test/response-lifecycle/fixture.ts` | 支持生产executor/真实model seed所需接缝 |
| M / IP-07 | `packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` | executor工厂统一包装、不可用/原子/重放 |
| N / IP-07 | `packages/adapters/test/response-lifecycle/forecast-executors.test.ts` | 真实C04模型+C25投影三方法集成 |
| M / IP-08 | `packages/core/src/access/schema.ts` | SessionView/read命令Schema，SessionResult复用 |
| M / IP-08 | `packages/core/src/access/service.ts` | readSession必需接口 |
| M / IP-08 | `packages/adapters/src/auth/postgres-local-identity-access.ts` | 自省受限验证、idle触达、停用失效 |
| M / IP-08 | `packages/core/test/access.test.ts` | Schema与既有授权边界 |
| M / IP-08 | `packages/adapters/test/auth/local-identity-project-authorization.test.ts` | 真实会话/期限/受限/失效 |
| M / IP-08 | `apps/worker/test/engineering-data/cleaning/composition.test.ts` | 完整接口stub增加unused readSession |
| M / IP-09 | `apps/api/src/http.ts` | introspect目录/metadata映射，result沿view复用 |
| M / IP-09 | `apps/api/src/app.ts` | Cookie GET handler/no-store/error |
| M / IP-09 | `apps/api/test/http-shell.test.ts` | 新路由/status/OpenAPI及accessStub完整性 |
| M / IP-09 | `apps/web/src/api/http.ts` | introspect操作/GET方法/catalog/client |
| M / IP-09 | `apps/web/test/api-client-openapi.test.ts` | GET运行契约 |
| M / IP-10 | `demo/src/api/client.ts` | GET及PASSWORD_CHANGE_REQUIRED类型 |
| M / IP-10 | `demo/src/api/session.ts` | currentSession/changePassword、strict decoder |
| M / IP-10 | `demo/src/api/context.ts` | restoring/restricted/失败状态与操作 |
| M / IP-10 | `demo/src/App.tsx` | 启动恢复、认证代次、门禁/改密/注销 |
| M / IP-10 | `demo/src/pages/LoginPage.tsx` | 复用表单改密及失败/重试交互 |
| M / IP-10 | `demo/src/components/AppShell.tsx` | logout失败可重试 |
| M / IP-11 | `apps/web/src/main.tsx` | checking初态/restore/guard |
| M / IP-11 | `apps/web/src/app/App.tsx` | 恢复失败retry入口 |
| M / IP-11 | `apps/web/test/ssr-shells.test.tsx` | checking/failed/restricted行为 |
| M / IP-12 | `demo/test/browser/server.mjs` | 仅会话所需真实受限账号 |
| M / IP-12 | `demo/test/browser/read-only.spec.ts` | 真实恢复/受限/竞态/注销失败 |
| M / IP-12 | `apps/web/test/browser/server.mjs` | 仅会话所需真实受限账号 |
| M / IP-12 | `apps/web/test/browser/quality.spec.ts` | 真实恢复/受限/重试/竞态 |

OpenSpec 工件：本 change 的 proposal/design/implementation-plan/tasks 与九份 delta spec（IP-01～12按§3对应）；实施仅勾选已完成 tasks，Finalizer 新建本 change `verification.md`（IP-12）。归档通过 sync/archive 工作流更新九份所属主规格，不能在 apply 内提前同步主规格。

共享夹具复用是 IP-04 的批准路径，生产组合保持薄装配；C11 所属 fixture 仅在所属测试需要注入时作最小修改，不为重复搭建同一套基础设施而扩展。当前 reader 测试部分通过不能替代 §6 全部场景；1.2/1.3 按各自行为和指定验证通过后勾选，1.4 还须完成两种 XOR、真实 C19 和持久事实证据。实现中的普通断言错误、相容字段映射与该授权范围内夹具补齐在原 Task 内修复。

IP-04 的测试装配授权覆盖上述 C15/C19 及审核发布 helper 的最小提取和依赖注入，不授权修改这些模块的生产契约或绕过来源／人工发布门禁。改动 cleaning/scoring 共享 helper 后分别运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` 与 `pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` 的受影响回归；仅在实际修改共享 helper 时增加该回归。缺失实际清洗／审核／basis 事实时 1.4 保持未完成；测试执行数量不替代该验收边界。

保护路径：C34 所有 change 工件、其余 UI页面/业务 harness装配、数据库迁移、package.json/锁文件、config/orchestration、openspec/config、研究资料及业务算法口径。core access/index、context-source/index、engine adapter index 已有 export覆盖新所属符号时不必修改；无修改仅因“导出保险”。response-lifecycle/service.ts 的 verifyForecastExecutorResult 保持原签名，不修改。

升级条件：实现发现新公共契约/枚举/依赖/迁移、必须写实际评估或扩大授权、表外生产文件、基线缺失符号、未列EffectForecastExecutor实现、现有验证命令不可执行或 shared C34 并行写冲突，停止依赖工作并报告具体差异；当前已授权普通实现/测试缺陷在本Task内修复，不重复请求既有授权。实际范围变更先更新design与施工图。

## 8. 验收 Agent 授权与限定审计

Finalizer 完整读取 apply contextFiles，以固定最终实现检查点验证§6全部场景及§7全部文件；允许在原D-01～12语义内修复普通缺陷、更新相关测试和verification，不回派首轮实现角色。Docker/浏览器/构建失败必须记录FAIL或BLOCKED，不能以静态阅读替代真实接缝证据。

最终必要检查：E-R/E-P/E-S/E-H/E-W；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy`、`openspec validate fix-production-assessment-seams-and-session-restoration --strict --no-interactive`。测试按新变更／失败需要回归，不无故重复全仓昂贵测试。规划阶段只需OpenSpec严格校验与映射检查，不把尚未实现的测试当已通过。

限定审计标签为 AUTH-SCOPE（风险reader与模型/投影精确授权、无存在泄漏）、FORECAST-FACT-ISOLATION（真实措施、冻结模型、纯评分无实际事实）、SESSION-RESTORATION（停用401、技术故障分离、绝对期限、Cookie和认证代次）。如收尾触发限定审计，同轮最多一次，审计Agent负责范围内修复及回归；未闭合结论不得PASS。模型/事件样本明确合成待复核，禁止由此宣称甲方精度验收通过。
