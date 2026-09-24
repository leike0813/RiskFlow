## Context

基线为 `572fa73f1ccd3acb543762247842c55c2accbd42`。C22 已有 `StandardizedRiskRecordStoreV1.readRecord` 与精确结果工件引用；C29 的 `evaluateDeterministicAssessment` 是可复用的确定性计算，正式记录与决策工件有精确引用；C04 提供授权、完整性校验和不可变工件；C03 提供原子回执/审计。C02 有 `projection.query` 闭合分支和 `ProjectionPortV1`，但未有质量查询类型或 C36 投影实现。C10 Web 根路由、页面壳及 C09 浏览器客户端已存在，生产 `main.tsx` 尚未注入会话与业务页面。当前仓库没有甲方真实脱敏样例，也没有浏览器测试依赖。

重开规划的实际输入 HEAD 为 `ac0ab1d788199301c65dde2b522759d097b96610`，批准记录为 `approval://riskflow/C36/scope-2026-09-23-quality-evidence-and-grant-mapping`，协调端对精确只读接缝与请求侧授权加法的裁决为 `msg_fa149dc63e7f`。当前 C36 代码和 BLOCKED verification 是实施现状；下列 D-09～D-11 只规定本次新增语义，不倒改 D-01～D-08 已完成路径。

批准边界以 `approval://riskflow/C36/scope-2026-09-23-quality-evaluation-and-browser-acceptance` 与协调回复 `msg_8f46a64026e9` 为准。C36 不改 C10/C13/C14 的行为和公共契约，不承担 C37/C38 硬件目标。

## Goals / Non-Goals

**Goals:** 冻结样例、计算并耐久保存可复核的质量结论；通过 C36 只追加索引提供有界页面查询；以真实 Chromium、真实 HTTP/授权/投影接缝执行跨页面验收。

**Non-Goals:** 新增领域算法、修改 P/C 或矩阵、让 LLM 自评、创造新角色/能力值、把质量结论当成业务风险事实、改变其它 projection queryType 的语义、硬件 SLA、通用页面投影平台。

## Decisions

### D-01. 冻结数据集与来源资格

`packages/core/src/quality/schema.ts` 定义严格 `QualityDatasetV1` 与 `QualityReportV1`，`schemaVersion='1'`。数据集字段固定为 `datasetId`、`datasetVersion`、`sampleKind: deidentified-real | synthetic`、`sourceQualificationRef`（合成时为空且显式原因）、`projectId`、`projectRevisionRef`、`labelPolicyRef`、`createdAt`、`samples[]`。每项样例固定 `sampleId`、`spatialScopeRef`、`processNodeId`、`sourceSegmentRefs`、`applicabilitySnapshotRef`、`identificationInputSnapshotRef`、`assessmentInputSnapshotRef`、`riskRecordRef?`、`standardizedRiskRecordSnapshotArtifactRef?`、`assessmentRecordRef?`、`assessmentDecisionArtifactRef?`、`assessmentReplayContextArtifactRef?`、`expectedEventKey`、`expectedPositive`、`expectedRiskLevelId?`、`comparisonGroupId?`、`requiredEvidenceRefs[]`、`versionRefs`（识别知识/策略、规则集、权重、矩阵、模型/提示及审核配置的精确版本）。C22 输出快照在 C04 中按正式记录 digest 与 C22 `readRecord` 公开窄读核对；C29 重放上下文在 C04 中按正式决策工件与输入版本核对，不把快照写入页面索引。`labelPolicyRef` 指向人工审核的事件、工序、资料段匹配规则和完整正负全集；不由模型或质量模块猜同义词。每一必评项显式列出，即使生产结果缺失也保留在分母。数据集 JSON 先按 strict Schema 校验，再作为 C04 内容工件冻结；相同版本不同摘要为冲突。无真实样例时使用仓库内合成 fixture 并在报告精确写“合成样本，待甲方复核”。考虑过直接读取生产表自动抽样，但它会绕过授权且无法确定负样本全集，故不用。

识别匹配键精确为 `(riskEvent,processNodeId,evidenceLocator.sourceSegmentId)`：`expectedEventKey` 等于共享 `StandardizedRiskRecordEnvelope.record.riskEvent` 的标识，另两项必须分别等于样例工序与明列资料段；一个样例最多命中一个正式记录，多命中记冲突失败。`labelPolicyRef` 记录这项固定口径的审核版本，不能在执行时切换近义词或相似度阈值。正式记录快照与 `readRecord.requestDigest` 不一致时不计命中并记证据失败。

### D-02. 确定性指标与重放

`packages/core/src/quality/evaluate.ts` 只消费 D-01 数据集、已授权的 C22/C29 正式输出快照与 C04 验证收据，不查询私表。`accuracy=(TP+TN)/N`、`precision=TP/(TP+FP)`；`coverage=有合格正式判断的必评项/全部必评项`；`sourceConsistency=同一 comparisonGroupId 内一致的可比来源对/全部明列可比来源对`；`gradeMatch=与已审核期望等级一致的评估项/有期望等级的评估项`；`replayRate=重算一致项/应重算项`；`auditCompleteness=完整可达项/必审项`。每个指标统一 `metricCode,numerator,denominator,value|null,status: computed|not-computable,reasonCode?`，零分母返回 `null`。逐样例保存 TP/TN/FP/FN、缺失/错版/拒权原因，不把失败样例丢出分母。精确重放复用 C29 `evaluateDeterministicAssessment` 与 C04 冻结的原版本化引擎上下文，比较 P/C 精确表示、矩阵等级、决策摘要及正式记录精确引用；不能构成完整冻结上下文的样例记失败。识别只对正式 C22 输出与人工标签比较，不重跑 LLM 或复制 C22 合并算法。考虑过根据自由文本做 fuzzy match，因不可复现且可能制造准确率，故不用。

### D-03. 证据报告、提交顺序和失败

`packages/core/src/quality/service.ts` 的 `evaluateDataset` 接受固定 `projectId,actorId,commandId,idempotencyKey,requestedAt,datasetArtifactRef,runRefs,authorization` 与公开窄读端口；评估/报告写入复用既有 `projection.export` 能力，由 C06 对当前工程、actor、空间与资料 grant 签发单 capability 上下文，C04 put 的 `requiredCapability` 同为 `projection.export`，不新增权限值。读取每份 C04 工件必须有界、完整消费 `verified`、核对工程和精确父引用。结果正文包含 D-02 逐项诊断、冻结数据集/输出/配置 refs、实际命令、代码 HEAD、浏览器/环境信息（如适用）、证据链状态和样例类型，先写 C04 `quality-evaluation-report+json` 不可变工件；再由 C36 adapter 在 C03 单个原子命令中追加索引、命令回执和事实审计。事务失败保留未索引孤儿工件供同键重试，不暴露正式成功；同键同摘要返回原引用，异摘要报 `IDEMPOTENCY_CONFLICT`。C04 完整性/授权失败报安全原因码且不输出部分正式报告。数据集错版报 `STALE_VERSION`，无合格分母只影响相应指标状态，不伪装整个命令成功质量达标。索引可由正式 C04 报告与 C03 审计重建，不作为事实源。

### D-04. C36 公共查询契约与兼容边界

在 `packages/contracts/src/ports/index.ts` 对既有 `ProjectionQueryPayloadV1Schema` **仅加一个** `queryType:'quality-evaluation'`，字段精确为 `selector` 可辨识联合：`{mode:'list',projectRevisionRef,pageSize:1..50,cursor?:string}` 或 `{mode:'exact',reportArtifactRef:ContentArtifactRefV1}`；拒绝开放过滤、SQL、任意路径、正文或多余字段。`ProjectionQuerySuccessV1Schema` 保留必有的 `queryResultRef`，仅加可选严格 `qualitySummaries` 数组和 `nextCursor?`；每个摘要的精确字段为 `{schemaVersion:'1',projectId,reportArtifactRef,datasetArtifactRef,sampleKind,label,metrics:[{metricCode,numerator,denominator,value|null,status,reasonCode?}],evidenceRefs,createdAt}`。`label` 对 synthetic 固定为“合成样本，待甲方复核”，真实样例为空；列表最多 50 项，精确查询只返 1 项，空列表也仅在已授权工程内返回。C36 实现按请求类型附加这些字段，其它 queryType 的请求/结果与编码不变。C09 沿用 `/api/v1/projects/:projectId/queries/projection.query`、原 `projection.query` capability、授权签发和 OpenAPI；不新增 route、branch、capability 或角色。`apps/api/src/http.ts` 对 `ApiPortsV1` 加入可选的 C36 `qualityProjectionQuery: Pick<ProjectionPortV1,'query'>`，只在未提供既有完整 `projection` port 时把原 query route 绑定到此窄端口；SSE/export 仍只由完整 `projection` port 激活。C36 窄端口仅接受 `quality-evaluation`，其它 queryType 在领域边界返回 `UNSUPPORTED_CONTRACT`，不制造任何结果；已有完整 port 及其行为完全不变。`apps/web` 在 C09 operation registry 只登记本查询并用同一共享 Schema 解码。无权、跨工程、不存在都收口为同形 `NOT_FOUND`，在读索引或 C04 前授权，输出不含正文。考虑过新增独立 REST 路由，但会破坏 C09 闭合路径，故不用。

字段上界：`qualitySummaries.length<=50`；每个摘要的 `metrics` 精确包含 D-02 七个 `metricCode`（不按数组顺序解释），分子/分母为非负安全整数，值仅为 `[0,1]` 有限数或 `null`，不可计算时必须有稳定 `reasonCode`；`evidenceRefs.length<=16` 且元素使用既有 `EvidenceReferenceSchema`。`cursor` 是最长 512 字节的规范 base64url，内容只含 `projectId,projectRevisionRef,createdAt,reportArtifactId,reportArtifactVersionId`；严格比较当前工程/修订后才做 keyset 查询，非法或跨项目游标在查询前失败，不作跳页推测。摘要 JSON 最大 64 KiB，超界不入索引。公开结果不得包含完整数据集、样例标签、配置正文或原始模型响应。

### D-05. C36 自有只追加索引与 migration

新增 `business.quality_evaluation_report_index`：主键 `(project_id,report_artifact_id,report_artifact_version_id)`；列只含 `project_revision_id/version_id`、`dataset_artifact_id/version_id`、`sample_kind`、`spatial_scope_refs`（冻结样例涉及的精确空间引用，仅用于当前授权过滤）、`summary_digest`、`report_artifact_ref`、`dataset_artifact_ref`、`summary_payload`（D-04 摘要，不含正文/资料段文本）、`command_id`、`actor_ref`、`authorization_context_ref`、`audit_entry_id`、`created_at`。联合约束保证 ref、项目和版本非空、`sample_kind` 闭合、摘要上界、唯一命令身份；列表索引 `(project_id,project_revision_id,created_at DESC,report_artifact_id DESC,report_artifact_version_id DESC)` 供有界 keyset 分页。无其它 change 已发布表外键；C04 引用由授权 `open` 与 manifest 守卫验证，避免跨 change 回滚耦合。`000051_quality_evaluation_report_index.ts` 位于 `query-projection/deliver-quality-evaluation-module/`，`up` 可重复、只授 `riskflow_app` 对本表 `SELECT, INSERT`（无 UPDATE/DELETE），`down` 只逆序删除本 change 表/索引。测试侧迁移清单同步 `packages/adapters/test/auth/fixture.ts` 和 `packages/adapters/test/postgres/postgres-foundation.test.ts`；不改旧迁移。序号 51 已由协调端在合并 C39 的 49 和 C30 的 50 后批准。

同一 C36 migration 内另建只追加 `business.quality_evaluation_dataset_freeze`，仅存 `project_id,dataset_id,dataset_version,content_digest`，前三项组成唯一主键；仅授 `riskflow_app` `SELECT, INSERT`。C03 报告索引命令在同一事务内先登记或核对此冻结身份，再追加报告索引、回执与审计；同摘要复用冻结事实，异摘要返回不可重试 `STALE_VERSION`。报告索引仍按报告 ref 独立追加，同一冻结数据集可以产生多个运行/报告版本，故不对报告索引施加数据集唯一约束；`down` 同时删除本 change 的两张表。

### D-06. 查询授权、投影和页面

`packages/adapters/src/quality/postgres-quality-projection.ts` 只读本表中写入时已由 C04 `verified` 核对的安全摘要与摘要 digest；页面查询不打开报告正文，完整报告仍须调用方持有相应 C04 授权才能读取。禁止从 C22/C29/C14 私表查询或维护第二份领域正文。服务端校验 C06 当前 `projection.query` 最小上下文：一项 capability、同工程 actor、精确项目修订/空间/来源授权；列表按当前工程及修订加 keyset/上限，exact 按完整工件 ref 命中。`evidenceRefs` 仅保留当前资料 grant 允许披露的定位引用；无资料正文权限时仍可见获准的工程级质量摘要，不显示正文、未获准引用或相邻片段；撤权/跨工程/不存在统一 `NOT_FOUND`。查询不写业务事实；C09 原 access log 保留安全 request ID，正式报告索引写入 C03 审计；只有实际 C04 正文读取才触发 C04 访问审计。`apps/web/src/quality/` 贡献 `/assessment` 的质量摘要视图，复用 C10 列表壳、`loading/empty/error/forbidden` 状态及工程修订切换时取消旧查询；只从 C09 客户端取授权投影，不读数据库、C04 文件或 event 正文。`apps/web/src/main.tsx` 把已有登录 callback、C09 client 和 C36 页面 contribution 接入生产入口；工程 ID 来自明确的页面选择/链接并始终经服务端验证，不把未校验 URL 当作授权。刷新后需重新从服务器查询；当前 C09 无 session introspection，刷新可要求重新登录，不保存 token 或业务正文。跨页面保持 C10 路由/停靠行为。考虑过另建全局状态缓存，因会产生旧工程闪现与重复事实，故不用。

### D-07. 浏览器设施、命令与证据

根目录仅增加 `@playwright/test@1.63.0` devDependency，许可证 Apache-2.0，官方包 `https://registry.npmjs.org/@playwright/test/-/test-1.63.0.tgz`；[官方浏览器安装说明](https://playwright.dev/docs/browsers)要求与包版本对应的 Chromium。协调端在规划检查点后串行更新 `package.json`、`pnpm-lock.yaml`、依赖策略；浏览器二进制通过 `pnpm exec playwright install chromium` 预置于测试环境外部缓存，离线运行用固定版本缓存/镜像，不在生产容器安装。移除条件：跨页面真实浏览器验收不再在仓库执行且有等价设施接管。`playwright.config.ts` 仅启用 Chromium、有限重试及 trace；`apps/web/test/browser/` 测试启动构建后的 Web 静态资源与真实 `buildApi`、C06/C03/C04/C36 PostgreSQL 组合，真实登录 Cookie 和 C36 已正式索引的样例报告。用现有 Testcontainers/Node 标准库启动临时服务，不引入其它依赖或开发服务器；失败环境不跳过关键测试。精确运行命令：`pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`；数据集计算 CLI 为 `pnpm quality:evaluate -- --dataset <dataset.json> --output <result-ref.json>`，具体可重现调用由 C36 集成测试执行并记录实际路径、环境版本和 C04 refs。最小回归：`pnpm exec vitest run packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts apps/api/test/quality.test.ts apps/web/test/quality.test.tsx`、`pnpm typecheck`、`pnpm deps:check`、`openspec validate deliver-quality-evaluation-module --strict --no-interactive`。Playwright 截图/trace 是验收诊断，不代替 C04 质量工件。

### D-08. 文件所有权及 RI/RA 追踪

本 change 仅拥有：质量 core、C36 adapter/index/migration、C36 API 接线、C36 Web 页面与入口接线、质量 fixture/测试、Playwright 配置及根脚本/锁文件登记；`packages/contracts/src/ports/index.ts` 只做 D-04 最小加法。既有 C10/C13/C14 源文件、其它 change 私表、领域算法与已有公共 queryType 不变。RI-S1～RI-S6 对应资料段、工序、机理、标准化记录及识别结果的质量链；RA-S1～RA-S7 对应适用性快照、指标/规则、P/C/矩阵、预警/处置引用的重放和审计检查。报告缺少后段正式结果时记录覆盖缺口，不制造后段业务事实。

### D-09. 正式空结果证明：C39 终态与 C22 零结果合取

C39 已归档变更提供 `readCompletedRunResult` 与 `workPlanReader.readExact`：前者只在已完成运行的终态行、C04 正文和当前授权一致时返回，后者按工作计划精确引用读取冻结工作项。C22 已归档变更为每个零候选工作项保存正式零结果，公开 `readZeroResult` 并在读取前后复验当前 `risk-identification.assemble-and-infer` 授权。C36 仅组合这三个拥有方公开读接口；C22 独立只读组合面 `createRiskCandidateZeroResultReader` 与原服务共享唯一校验实现，只注入当前授权复验、精确结果登记读和 C04 工件读，不需要模型、人工审阅或写端口。该组合面由协调端 `msg_044d87768b43` 批准。

冻结负样例可选携带运行、工作计划和终态结果精确引用。C36 对 C39 已完成终态要求零正式记录、零事件、零失败/跳过/驳回/待审/取消工作项，工作计划非空且每个工作项恰有一个 C22 零结果；逐个核对零结果的工程、输入快照与工作项引用，并将样例的工序、唯一空间和完整来源版本集合精确匹配至唯一工作项。三处事实与当前授权全部成立时，保存终态引用和冻结范围摘要，负样例才计 TN 与覆盖。无引用、无权、不存在、漂移或任一工作项未闭合时维持 `undetermined`。正样例仍按已核验正式记录判断，不由零结果路径推断；无权与不存在同形失败，不返回其他运行正文或数量。

### D-10. 必审资料段证明：复用 C13 现有授权读

C36 `QualityRequiredSegmentProofReaderV1.readExact` 接受 `projectId,actorId,sampleId,requiredEvidenceRefs(1..16),requestedAt` 与**独立由 C06 按现有 `engineering-data.evidence-access` 分支签发**的当前授权上下文，输出 `{kind:'proved', items:[{evidenceReference,sourceVersionRef,sourceSegmentSetRef,sourceAccessGrantRef,queryResultRef}]}` 或同形安全失败。C36 service 将样例 `requiredEvidenceRefs` 最多 256 项拆成每批至多 16 项，超界失败闭合；C36 adapter 的内部 `QualityC13EvidenceReadPortV1` 只取 C13 现有 `EngineeringDataPortV1.read` 和 `PostgresEngineeringContextSourceRegistry.resolveReadQuery` 两个公开方法，不改其签名/语义。逐批核对每个返回项的资料段 ID、精确来源版本、工程/空间、grant、集合引用与 strict Schema；只在全部明列项同形且拥有方成功解析时向 core 交付收据，丢弃 `segment` 正文，不写 C36 表。C13 现有读路径负责当前授权和资料段解析；C36 同时用 C04 `verified` 核对已有内容工件，不把 C13 的成功当成 C04 工件完整性证明。`QualitySampleEvidenceV1` 增加本次请求内收据；审计链仅在全部必审资料段收据、既有 C04 工件与正式审计均成立时通过。CLI/真实测试通过原会话另签已有读分支上下文；用户没有该既有能力时该样例失败闭合，不扩角色或权限。C13 失败不区分无权与不存在，错版/撤权不复用旧收据；同一精确版本重放仍须重新解析。

### D-11. 资料 grant 与来源版本映射：C09 请求侧两阶段签发

C06 的 `sourceAccessGrantRefs` 指向 `source_access_grant_id/revision_id`，不能与 `EvidenceReference.sourceVersion` 直接比较。保持 C06 签发语义：C09 对 C36 `quality-evaluation` 请求先按既有工程/空间授权选中**至多 50 条**安全索引摘要，从这些摘要提取、去重至多 `50×16` 个精确 `SourceVersionRefV1`。C36 窄端口增添仅服务端可调用的 `candidateSourceVersionRefs(query)`，返回 `{rowRefs,summaryDigests,sourceVersionRefs}`，及 `queryWithSourceGrants(query,grantsBySourceVersion)`；`grantsBySourceVersion` 是请求内 `Map<精确来源版本, readonly SourceAccessGrantRefV1[]>`，不序列化到 HTTP 或 C04 报告。C09 `runBusiness` 对每个候选版本用同一会话、工程、请求 actor、空间和原 `projection.query` 分支单独向 C06 请求 `requestedSourceVersionRefs:[ref]`。每次只在 C06 返回当前单 capability 上下文、同工程/空间且携带 grant 时，建立该**唯一请求版本 → 签发 grant refs** 的请求内映射；无 grant/拒权只删除该版本的定位引用，签发暂时性失败使请求失败而不伪装为成功空证据。最终查询重新核对所选报告 ref/摘要 digest 与候选集合，发生并发改变则同形失败或重试整个请求，绝不把旧映射用于新行；返回前逐版本复验当前授权，撤权后不披露。`queryWithSourceGrants` 只据上述映射过滤摘要 `evidenceRefs`，保留原 `queryResultRef`/分页/正文边界，不能按 grant ID 猜来源版本、不能用一个版本的 grant 放行另一个版本。旧 queryType 和完整 `projection` port 优先级不变；无新增 HTTP 字段、branch、capability、角色、生产依赖或持久化。若 C09 现有签发 API 无法在同一会话完成这条内部两阶段请求，IP-10 必须 BLOCKED 并升级，不修改 C06 既有分支语义。

## Risks / Trade-offs

- 当前无甲方真实脱敏样例，首轮只能验证测量方法和链路；必须保留“合成样本，待甲方复核”，不能声称真实准确率。
- C29 冻结上下文如未能从已批准公开接口/工件完整构成，则该样例的重放指标失败而非自行读私表；实现若需要修改 C29 公共语义，立即升级。
- 浏览器测试要求 PostgreSQL、Chromium 与正式服务可用；缺失时报告 BLOCKED，不能以 SSR/Mock 冒充通过。
- 索引不对旧表设外键，靠 C04 验证和 C03 原子审计维护真实性；这避免跨 change migration 回滚锁定。

## Migration Plan

先由协调端登记固定依赖/锁文件，再应用 D-05 migration 并验证重复 `up`、逆序 `down`、最小 GRANT 与测试清单。部署时先保证 C03/C04/C06 可用，再接入 C36 服务与页面；已有业务表无数据迁移。旧报告始终按精确 C04 ref 读取，新报告追加新行；索引可由已成立报告重建。

## Open Questions

IP-08 使用已归档 C39/C22 的正式事实，C36 不增写路径或持久化。真实甲方样例和目标硬件证据由后续交付补充，不改变本 change 的测量契约。

既有 `verification.md` 还列有 C04 缺失与拒权同形失败的开放项；本次批准记录只重开上述三项。IP-09 对该错误保持失败闭合，不能以缺失推断通过；若 Finalizer 需要改变 C04 不可枚举读契约或报告处置规则，应单独升级，不在本轮替其决策。
