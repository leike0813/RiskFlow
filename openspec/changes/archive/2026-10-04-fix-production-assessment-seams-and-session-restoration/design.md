## Context

固定实现基线为 `e26ca45db5d124793b1c323ac83687f629913a3f`。C11/C25 已消费 `RiskInputFactsReaderV1`，生产实现缺失；标准记录实际由识别验收域 C22 保存，C24 是调用者。C28 已有预测输入冻结、结果校验和原子保存，只缺部署执行器。C06 已有 Cookie、期限和受限会话事实；API 缺自省，demo 从 anonymous 启动，apps/web 虽已有 checking 状态却被入口改成 anonymous。

已有 `000054` 风险记录作用域列可复用，不补空作用域。C18 的预测策略引用参数模型，不执行公式；模型工件归 C28 算法契约，由 C04 存储，不新增配置定义类型。共享 harness 和 C25/C28 文件与 C34 重叠，需要串行实施。

## Goals / Non-Goals

目标是闭合两个生产领域接缝和两套 Web 会话恢复，提供可部署、可授权、可重放的实现及真实集成证据。三种预测算法全部交付，验收参数标记“合成样本、待甲方复核”。

不承担模型训练、甲方参数审核、任意资料正文抽取、历史记录作用域补造、C34 全链路装配或页面改版。不增加依赖、迁移、工作流、公开业务命令或新的 Agent 任务。

## Decisions

### D-01 风险字段保持单一 Schema，组合能力只分派

将现有 `RiskInputFactFieldV1Schema` 原字段约束移至 contracts `ports/index.ts`，core 原导出改为引用／重导出；共享字段上限常量同源，现有调用兼容。`RiskInputFactsV1Schema` 仍由 core engine 定义，包含原 projectId、精确 XOR 输入、1～1024 字段及 1～256 原证据。字段路径沿用 1～16 段、每段原正则和每字段 1～32 证据，不扩大标量类型。

新增 `RiskInputFactsReadRequestV1Schema` 校验现有请求形状：requestId、idempotencyKey、requestedAt、authorization、riskInput；风险工程取正式 authorization，不从自由字符串推断。`createRiskInputFactsReader({standardizedRiskRecord, externalRiskEvent})` 返回原接口，仅校验及按 kind 分派，不查询数据库、不改调用身份、不内嵌字段。两 owning factories 无 C11 registry 实例依赖，组合后同时注入 C11 的 `riskInputFactsReader` 和 C25 的 `riskInputFacts`，消除构造循环。

### D-02 标准记录由所属域按原身份读取

`createPostgresStandardizedRiskInputFactsReader` 位于 adapters identification/read，依赖 db、C06 access 和 now。按 project、riskRecordId、versionId 读取一条已验收 `business.standardized_risk_records`，复验行引用、正式记录 Schema、route/review 验收事实及已保存 spatial/source 范围。复用现有记录 Schema、证据类型和 C33 作用域判断语义，不借用 C33 的另一个授权分支。

documentType 固定为 `standardized-risk-record`；只投影 `record.processNodeId`、`record.riskSource`、`record.riskFactor`、`record.riskEvent`、`record.modelConfidence`、`compositeConfidence.value` 六个已有标量，以分段路径表达。字段证据取验收时保存的 evidenceReferences；不从模型置信度反推数值指标，不输出关系数组或补造地质字段。字段及总证据使用稳定身份去重，超预算关闭失败，不截断形成貌似完整结果。

### D-03 外部事件结构化工件由 C11 所属域读取

在 core engineering-data/context-source 新增 strict `ExternalRiskEventFactsArtifactV1Schema`：schemaVersion="1"、projectId、externalSourceRef（精确来源版本）、externalEventKey、fields（共享字段 Schema）。字段的 documentType+fieldPath 唯一；每字段证据必须属于登记的事件 evidenceReferences。身份必须逐项等于 `business.external_risk_events` 的精确登记行；源资料段证据再按 C11 自有 source_versions/source_segments 核对工程、来源版本、可用资格与范围。

`createPostgresExternalRiskInputFactsReader` 依赖 db/access/now/artifactStore，读取登记行 event_artifact_ref 的 application/json 正文，沿 C04 verified handle 校验内容、关闭流和读取预算（最多 1 MiB），不使用最新来源。输出 riskInput 来自登记引用，总证据取登记原证据。旧登记命令和任意 JSON 正文可继续登记；正文不符合结构化契约时 reader 返回 UNSUPPORTED_CONTRACT，不把“登记成功”当作“可评估”。因此不修改所有旧登记样例，也不引入文档清洗或 LLM。

### D-04 风险读取当前授权与失败一致

reader 保持调用方签发的 `engineering-data.evidence-access` 分支、原 requestId/invocationId 和 actor；在暴露目标前 C06 verify，内部精确行查找只用于得到待复验作用域，再复验全部保存 spatial/source refs。不能另签 identification 分支或扩大范围。缺失、错版本、跨工程、撤权、缺旧作用域均以 AUTHORIZATION_DENIED 关闭且不枚举存在性；已获权但正文非法为 UNSUPPORTED_CONTRACT，预算越界为 BUSINESS_BLOCKED，存储故障沿既有 TRANSIENT_FAILURE/TERMINAL_FAILURE。所有者不保存风险、评估、命令收据或领域事件；C04/C06 自身安全／读取审计沿既有契约。

C11 在 `#freezeAssessmentPreparation` 的入口 C06 verify 成功后，以 `decision.context.sourceAccessGrantRefs` 作为唯一来源授权输入。授权修订引用与资料版本引用是不同契约：复用 `readAuthorizedSourceVersions` 已有的 C11 自有 `source_versions` 映射，将其提取为私有共用解析能力。按当前工程、ready 状态和稳定 grant identity 定位精确来源版本，沿用现有上限、至多授权数量加一的查询边界、一对一及 Schema/行身份校验；返回原精确 source-version refs，不选择最新版本、不读取 C06 私表。空授权得到空来源集合，缺失、歧义或越界映射按不可枚举 AUTHORIZATION_DENIED 收口。已有入口目录与准备冻结复用同一解析实现，各自保留原 C06 分支与调用身份。

C11 用上述来源版本和本次业务空间签发 `${commandId}:risk-input-facts` 的 `engineering-data.evidence-access` 上下文。使用前确认返回的每项来源授权修订均在当前 `decision.context.sourceAccessGrantRefs` 中，空间保持已获准的同一空间身份并由 C06 复验；额外来源或空间拒绝。reader 再以精确记录／事件保存的全部来源和空间收窄复验，未包含目标来源的入口授权必须失败。C06 authorize/verify 的公共契约和授权子集规则沿用现状；不得通过修改已签上下文对象补入权限。

C25 的 `#loadRiskFacts` 同样必须传入范围：从已由 `#verifyCommand` 复验的 preparation binding 取得精确空间和 sourceVersionRefs，按原 `${commandId}:risk-input-facts` 身份签发同一事实读取分支，并校验返回范围未超出已复验调用方授权。来源清单取已冻结准备证据，不从自由请求、风险标识或最新资料推断。该修正落实既有正式评估读取，归 IP-04，不等待预测投影 IP-05；任何一级缺权限均在评估事实写入前关闭失败。

### D-05 预测输入与执行结果显式闭合

`ResponseForecastExecutorRequestV1` 保留现有 snapshot/policy/baseline/monitoringSnapshot，新增 issuedAt、idempotencyKey、authorization、baselineAssessmentRecordRef、measureLibraryReleaseRef、adoptedMeasures（复用 `MeasureItemSchema[]`）。这些值只由 C28 已验证 `ResponseLifecycleFrozenContextV1` 组装，不接受自由客户端字段。正式措施只含已有 measureId/content；不虚构 measures 自有 targetIndicatorIds。C28 正式建议的 targetIndicators 和模型 target 匹配，措施效果逐条按 measureId 及精确措施库版本匹配。

baseline.indicatorValues 每项包含可选 `unit:string`，仅由 C28 从同次冻结依据中的 indicator-system 数值指标定义提取 canonicalUnit；非数值或缺失定义不带单位。执行器求值前核对模型输入集合等于冻结策略输入集合，且每个输入单位精确等于该基线项的正式单位。缺少正式单位或单位不符属于契约失败，沿 response-forecast-result-invalid 收口，不转换单位、补默认单位或保存预测事实。其余基线值与 riskState 保持原样；不修改风险评估记录 Schema。

执行返回 strict 联合 `EffectForecastExecutorOutcomeV1`：`{kind:"available",result:原 ResponseForecastExecutorResultV1}` 或 `{kind:"unavailable",reasonCode:受限枚举}`。内部接缝统一迁移，既有测试 executor() 工厂只包装 available；`verifyForecastExecutorResult` 继续只验证原 result。unavailable 沿原 `#persistForecast` 保存无值的不可用事实，不可称正式数值预测；available 复验失败沿 `response-forecast-result-invalid`，不保存事实。

新增不可用原因固定为 model-artifact-unavailable、input-indicator-unavailable、measure-parameter-unavailable、monitoring-series-mismatch、monitoring-points-insufficient、regression-degenerate、risk-state-unavailable。非法工件身份、method/unit/版本、证据、预算或数值结果属于契约失败；撤权属于 AUTHORIZATION_DENIED；技术故障保留技术错误，不伪装业务不可用。既有 executor-unavailable 等原因保留，所有新增枚举只在所属 Schema 定义一次。

### D-06 参数模型是有界内容工件

在 core response-lifecycle/schema 新增按 method 分派的 `EffectForecastModelArtifactV1Schema`。公共字段固定 schemaVersion="1"、projectId、method、algorithmVersion="parameter-forecast-v1"、inputIndicators（1～32 唯一 indicatorId/unit）、targetIndicatorId、unit、stepMs（正整数）、maxHorizonSteps（1～720）、calculationScale（1～32）、measureLibraryReleaseRef、measureEffects（1～128 唯一 measureId，canonical decimal offset/perStep）、evidenceReferences（1～256）、sampleOrigin（synthetic/client-reviewed）、reviewStatus（pending-client-review/reviewed）。client-reviewed 必须 reviewed；本 change 样本固定 synthetic/pending-client-review。

历史统计参数为 intercept、inputCoefficients（与 inputIndicators 一一对应的 canonical decimal）、horizonCoefficient、fitSampleCount（2～1000000）。监测趋势参数为 windowPoints（2～720）；输入必须只有目标指标。机理参数为 intercept、terms（1～128 项，每项 indicatorId、power=1/2/3、coefficient，同 indicatorId/power 唯一）、horizonCoefficient、inputDomains（每输入 lower/upper）、outputDomain（lower/upper）。区间下界不大于上界；模型的 indicator 集合、目标、单位、措施库和 method 必须与冻结策略及正式事实完全相符。限制在本版本支持的输入形状，禁止任意公式字符串、eval 或远程模型调用。

`requiredRef` 正是 C04 content-artifact 的 reference，不新增映射数据库或“模型最新”查找。模型工件 MIME 为 application/json、purposeCode 为 `response-lifecycle.forecast-model`，须由精确策略引用；工厂按部署指定 method/requiredRef 固定选择，不临时更换模型。模型读取最多 1 MiB，遵守原 verified read/内容寻址，不新建校验协议。合成标识只记录在工件及测试证据，不给工程参数赋予已审核含义。

### D-07 三算法及十进制口径固定

设基线数值为 b_i，h 为 policy.horizonSteps，正式措施集合为 M，措施调整 `E=Σ(offset_m+perStep_m·h)`。布尔、缺值、非数值字符串不得强制转数值；每个声明输入都须满足正式指标定义及单位。所有计算复用 CanonicalDecimalValueV1；只在除法及最终输出按模型 calculationScale 做 half-away-from-zero，最终 `decimalToString` 规范化。

历史统计执行已训练模型 `ŷ=intercept+Σ(coefficient_i·b_i)+horizonCoefficient·h+E`，不在运行时拟合；fitSampleCount 与模型证据必须完整。监测趋势仅从执行前精确快照的末尾 windowPoints 个对齐槽选 observed、有值、同单位点，以原槽下标 x 做 OLS：`slope=(nΣxy−ΣxΣy)/(nΣx²−(Σx)²)`，再由样本均值和 slope 得截距，外推至最后对齐槽+h，加 E。不重排／压缩缺槽，不采用插值点；槽时间必须按 stepMs 对齐、严格递增。n<2 或分母为零分别 unavailable。机理执行 `ŷ=intercept+Σ(coefficient_t·b_indicator^power_t)+horizonCoefficient·h+E`；输入及结果越声明物理区间关闭失败，不夹取隐藏非法结果。三者不相互回退。

十进制除法补入已有 engine/decimal，分母零失败，使用 BigInt 对齐及有界 scale；不新增浮点算法库。纯参数算法位于 core response-lifecycle/forecast.ts，生产 executor 工厂位于所属 adapter；装配代码只提供依赖和精确工件引用。验收必须包含三个方法各自改变值与风险等级的实例、负数舍入、缺槽和退化窗口，而非只断言返回可用。

### D-08 C25 拥有预测风险状态投影

新增 `ForecastRiskStatePortV1.projectForecastRiskState`，request 固定 requestId/idempotencyKey/requestedAt/projectId/actorId/authorization、baselineAssessmentRecordRef、frozenAssessmentBasisRef（原 AssessmentInputSnapshotRef）、preActionMonitoringSnapshotRef、targetIndicatorId/unit/predictedValue。结果为 succeeded（riskState）／unavailable（risk-state-unavailable 或 monitoring-series-mismatch）／failed（ModuleErrorV1）。不返回伪实际记录或新的风险状态 Schema；RiskState 沿 contracts。

PostgresRiskAssessmentEngine 实现该端口：复验现有 `risk-assessment.read-input-snapshot` 分支与完整工程/空间/来源，再从自身表回读精确基线记录、值集合和输入快照，确认记录实际引用该快照；复用 `#loadBasis` 从 C19/C04 读取原规则及配置。通过既有 monitoring reader 精确 seriesRevision/snapshot 核对目标 indicator/parameter/unit，不能从 series entityId 猜语义。基线其它指标取正式保存值，只在内存替换目标预测值；不信任自由传入的 baseline 数组作为评分事实。

将 engine 的评分依赖收窄为 `AssessmentScoringContextV1`（冻结 weightSetRef、basis 成员引用、indicatorSystem/weightSet/scoringStrategy/riskMatrix、rules），现有完整 context 扩展它。`scoreAxis`/`scoreAssessmentAxes` 的第二参数同时收窄为 `AssessmentScoringValuesV1={readonly values: readonly Pick<IndicatorActualValueV1,"indicatorId"|"actualValue">[]}`，正式值集合仍可直接赋入。预测只组装该只读投影，不伪造 rawValue、source、实际证据或持久值集合/摘要。复用原 `scoreAssessmentAxes`/`mapAssessmentRiskLevel`；其辅助函数只做形参类型收窄，实际取值、触发与正式记录构建保留完整 context。预测数值如不能无损表示为现有评分标量，关闭失败，不悄悄舍入或改评分契约。矩阵越界和规则不适用沿原失败边界。禁止写 assessment/indicator-value/warning、业务回执或 outbox；C19/C04 必需读审计照常。

executor factory 依赖 artifactStore/access/authorizeDownstream/forecastRiskState/now。模型读取与投影分别由现有受控 authorizer 按原工程及已验证范围签发精确 `knowledge-modeling.assessment-basis` 和 `risk-assessment.read-input-snapshot` 上下文，invocationId 分别为 commandId:model、commandId:forecast-risk-state，不直接把 C28 单能力上下文传给其它分支。projection 再经 C25 自有 authorizer 签发 basis/monitoring 读取；任何一级不得增加原请求范围。

### D-09 C06 提供无 token 会话元数据

新增 strict `ReadSessionCommandV1Schema`（kind="introspect-session"、sessionToken 沿现有长度限制），加入 SessionCommand 联合；新增 `SessionViewV1Schema`，包含原 SessionResult 的全部非 token 元数据，SessionResult 由它扩展 token，避免字段重复。LocalIdentityAccessV1 增必需 readSession，真实 C06 adapter 在原事务调用私有 readSession 的 allowRestricted 路径，校验失效、密码版本、闲置及绝对期限，并 touch 空闲期限且不越绝对期限。

不 mint token、工程上下文或 systemAdministrationContextRef；管理上下文不存于 local_sessions，因此自省省略该可选字段。受限会话正常返回 mustChangePassword=true。仅将此入口的停用／不存在账号导致的认证拒绝归 SESSION_REVOKED，不改业务 AUTHORIZATION_DENIED 的全局映射。读取无新业务回执/事件，沿既有安全与会话使用规则。

### D-10 安全 Cookie GET 进入唯一系统路由目录

`GET /api/v1/session` 无请求体；从原安全 HttpOnly Cookie 读取 token，调用 C06 readSession，投影为现有 `SessionMetadataV1`。在 HTTP_SYSTEM_ROUTE_CATALOG 加 introspect，OpenAPI 从同目录生成，无需手工改生成器。所有响应 Cache-Control:no-store，不返回 token 或 Set-Cookie。缺失／失效为 401；Cookie 形状错误为原 400；暂态为 503，终态为 500，既有错误信封不变。GET 不创建工程授权或绕过 mustChangePassword。

### D-11 两套 Web 在认证代次内恢复

demo SessionState 新增 restoring、restricted、restore-failed；apps/web 复用 checking/restricted/failed，取消入口 anonymous 覆盖。启动 effect 发 GET 自省，仅 401 转 anonymous；400/503/500/网络／解析错误转可重试恢复失败。恢复期间保留原 pathname/search/hash，只显示等待；恢复正常会话后由原工程门禁签发上下文，受限会话进入改密，完成后回原深链。新增 demo changePassword，复用 LoginPage 表单及既有 CSS，正常登录仍可用。apps/web 保留现有 RestrictedPage，failed 显示恢复重试，不新增登出界面。

每次 restore/login/changePassword/logout 创建认证代次并取消旧请求；只接受仍属当前代次的响应。apps/web 复用 createRequestRevisionGuard；demo 用本地 ref，禁止迟到 restore 覆盖登录、迟到登录覆盖已注销或改密。demo logout 成功或服务端返回 401 确认会话失效时清会话；技术失败保持会话并显示可重试错误。在途注销去重，旧代次表单不执行成功回跳。两客户端 GET 用 same-origin credentials、no-store、无 body/content-type；JSON 只按正式元数据严格解码，demo 补 PASSWORD_CHANGE_REQUIRED 错误类型。

### D-12 所属测试、审计与串行移交

扩展现有单测／真实 PostgreSQL 测试；新增风险 reader 和预测 executor 所属集成测试，至少一条 C11 preparation→C25 freeze/evaluate 路径注入真正 owning readers、C06、C04、C19，不用事实闭包替代核心接缝。预测保存仍沿原 C28 fact+audit+receipt 原子事务，typed unavailable 同样幂等，available 输出非法不得残留事实。精确模型、措施、监测、评分依据和规范 decimal 足以重算旧结果，发布新版本不影响历史。

生产接缝夹具复用 `risk-assessment/fixture.ts` 的单库基础设施，通过显式 reader 注入连接 C11/C25；已有故障用例默认仍使用原 stub。外部事件正文登记与 C22 最终登记种子使用所属生产写入能力，合成验收身份明确标记待甲方复核；该种子不代表完整识别工作流或人工验收已经执行。`production-assessment-seams.fixture.ts` 负责组合和真实 C19 已发布依据装配，可在共享夹具增加最小 basis reader 注入点，不复制整套数据库／C19/C25 夹具。两种 XOR 均须完成准备冻结、输入冻结、正式评估及持久回读；准备引用断言使用 assessment-preparation-snapshot 契约，风险输入分支从保存快照回读核对。

真实 C19 装配遵守主规格的合格冻结来源和人工发布边界。合成规范资料在同一工程登记、完成必要转换与资料段定位，并经真实 C15/C08 清洗任务及确定性收口形成结果；C19 `prepareAuthoring` 必须经真实 `readBoundResult` 读取该任务与结果工件，并解析真实 C18 已发布配置集合，再创建规则编制任务。`startTask` 只负责创建有界任务；任务存在本身不构成清洗完成、候选校验或人工批准。编制 manifest 的来源、清洗任务／结果、工程、配置和授权均引用上述实际事实，不使用悬空清洗引用。

测试中的 C15 清洗和 C19 编制可提供确定性的合成 Agent 响应，必须通过现有任务运行、预算、增量校验与收口路径。样本及测试审核行为标明“合成样本、待甲方复核”，不代表真实模型推理质量或甲方正式规则已经交付。C18 配置、结构化评分规则和适用规则集的修订、送审、人工批准与发布均通过真实 C16/C07 能力及 C06 人类会话授权完成；C19 `prepareRevision`、`appendPreparedRevision` 和 `appendRelease` 由相应所属流程调用，不能由测试直接调用策略接缝冒充治理发布。

装配可把清洗与评分规则夹具中的可复用工厂提取为接受现有 runtime、C06、C03、C04 和工程／会话的组合函数，由生产接缝夹具显式注入；不另起容器、不重复初始化同一系统管理员、不把 `vi.fn()` 授权或 basis 结果闭包注入该验收路径。单库约束允许增加所需适配器实例；C34 两套业务组合根、checkpointer 和 UI 业务 harness 仍由 C34 所有。若需要独立的测试辅助文件，集中到 `production-assessment-basis.fixture.ts`，避免复制整套 cleaning/scoring fixture。

每种 XOR 的真实依据顺序固定为：已发布配置和评分规则 → C11 准备快照冻结 → 适用规则集组装及独立审核发布 → C19 `resolve(assessment-basis)` 返回实际集合引用 → C25 prepare/evaluate → 持久回读。准备快照 projection 经 C11 受权读取取得，basis reader 使用真实 `PostgresScoringRulesAdapter`；集合 ID 和成员取 resolver 返回及数据库保存事实，测试不得预写固定 basis ref 或自行仿制 identityDigest。时钟、业务有效时刻和 requiredAt 显式相容。

`AssessmentPreparationSnapshotReaderV1` 目前只有测试闭包实现；其投影将编制期清洗事实错误地设为每个评估准备的必需输入。IP-04 补齐所属 C11 的生产实现，并将 `AssessmentPreparationProjectionV1Schema` 收窄为六项：`schemaVersion`、`preparationSnapshotRef`、`projectId`、`projectRevisionRef`、`applicabilitySnapshotRef`、`applicability`。适用性引用与值取保存的准备／适用性快照，字段 Schema 复用现有契约；注释明确存储所有者为 C11。移除 `dataCleaningTaskRef`、`cleaningResultArtifactRef`、`configurationSetRef`、`compatibilityRef`、`requiredAt`、`asOfRecordedAt`，并移除 reader 请求中无读取职责的 `requiredAt`。C15 任务与结果工件仍由规则编制 manifest 精确绑定；评估准备不新增清洗字段，也不改为读取 identification 准备结果。

C11 的公开 `readAssessmentPreparationSnapshot` 只接受原 C19 `knowledge-modeling.assessment-basis` 调用身份。strict 请求和引用 kind 校验先于数据库访问；以 `requestedAt` 复验当前 C06 身份后，仅按同工程精确准备引用定位自有行，取得待复验的保存空间与来源。第二次沿同一分支、invocation 和授权引用复验全部范围，通过后才返回投影；核对保存的准备引用、工程修订及适用性快照引用／值的相互绑定。目标缺失、错工程／版本、缺范围或撤权统一不可枚举 `AUTHORIZATION_DENIED`，技术故障保留技术失败。与现有 `readAssessmentPreparationContext` 共用自有行读取、解析及保存范围复验逻辑；两个公开入口各固定分支，原 C25 `engineering-data.evidence-access` 行为保持。该读取不签发额外分支或扩大授权，不新增准备、评估、领域回执或事件；保留 C06 必需安全审计。

C19 两个消费者均严格核对返回的准备引用、工程和工程修订，组装请求的适用性引用及完整值必须等于真实投影，并以投影值构造候选。配置集合不从准备投影获取：组装与 resolve 均调用现有 C18 `resolveConfigurationSet`，按各自命令的 `requiredAt`／`asOfRecordedAt`（resolve 使用 `issuedAt`）核对真实配置集合的工程、工程修订与精确 `configurationSetRef`。组装请求与已发布规则集正文分别必须匹配该集合；兼容引用沿用 C19 版本化策略、规则修订及已发布规则集的现有核验，不能用测试填写的准备投影提供担保。resolve 还须核对规则集的工程修订、适用性引用及值与真实准备一致。当前授权复验使用调用的 `requestedAt`／`issuedAt`，业务有效时刻仅用于发布解析。错身份、配置或兼容绑定在候选／依据成功写入前失败；保留 C18 自有解析留痕和既有 C19 事务语义。

先以真实 C19 完成 IP-04，再推进 IP-05 的预测风险投影与 IP-07 集成，预测测试直接复用同一已发布依据和实际评估基线。IP-06 纯算法可独立实现，但不能替代这些集成证据。会话容量不足时按既有检查点和交接规则分段接续同一 change，保持已批准范围与验收要求。

外部事件的原默认正文与结构化正文共用同一工件写入／事件登记路径；接缝专用种子优先置于专用组合夹具，共享 fixture 只提供所需的最小受权依赖。reader 安装与会话恢复职责明确：会话恢复复验当前权限，只有测试确实切换了 reader 时才提供 reader 恢复操作。

生产预测模型 IO 集中到 response-lifecycle/forecast-model-reader.ts，工厂只调用有界读取端口；错误分类、verified 内容读取与模型 Schema 核对由该 helper 负责。真实依据断言集中到 production-assessment-basis.test.ts；API quality stub 随 readSession 接口完整适配。两份 demo 业务 spec 仅适配启动恢复后的登录助手，其余业务装配保持 C34 所有。apps/web 浏览器种子按既有正式风险记录契约写入空间、来源版本及证据。空闲 PostgreSQL 连接 error 由 createPostgresPool 监听，在途查询保留原失败映射；浏览器 harness 不注册全局 uncaughtException 吞捕。

IP-04 同时覆盖入口来源缺失／不覆盖目标、来源撤权及授权器返回额外来源的拒绝，验证无新增准备或评估成功事实、业务回执和 outbox；C04/C06 必需读取与安全审计照常。任务只在对应全部行为和证据完成后勾选；reader 局部通过不等于正式评估链或该任务已完成。

两套现有浏览器服务器仅增加会话测试真实受限账号；浏览器拦截只用于延迟／技术错误注入，不 Mock 业务成功。覆盖正常 reload/deep link、受限改密、401 与 503 分离、迟到认证和注销失败。有限 OLS 性能样本最多 720 槽，作为相同纯算法用例附带测量，不加绝对耗时脆弱门禁。

精确文件授权在施工图；无删除、迁移或依赖。Finalizer 可修已批准范围内缺陷并生成 verification，限定审计关注跨域权限、预测与实际事实隔离、Cookie/竞态。共享 C34 文件只能串行修改；其 4.1d 不在本次接管范围。

## Risks / Trade-offs

- 标准记录六字段不是任意数值指标；必须有相容的字段映射或结构化外部事件，否则诚实阻断。C34 接入成功不等于工程数据已齐。
- 历史缺作用域行继续拒绝，避免重新猜测权限；若需回填须另批准迁移设计。
- 参数算法代表本版本声明模型家族，真实模型训练与参数审核依赖甲方输入；合成验收不等于生产预测精度保证。
- 内部 forecast 返回联合需同步所有实现／夹具，保持公开记录和 HTTP 预测形状不变。
- 会话自省成功会更新 idle，absolute 不延长；误将 disabled 404 或技术故障 anonymous 会破坏恢复语义，列为关键回归。

## Migration Plan

无需数据库迁移。先共享契约／owning readers 和 C11/C19 准备读取，再 C25 投影与 C28 executor，最后 C06/API/两套客户端和真实浏览器证据。部署必须同时更新内部 executor 与准备投影调用者，正式模型工件按精确策略引用登记。验收完成后归档同步九个所属主规格，再由 C34 更新依赖／基线及继续装配；本轮不修改 C34 工件、不提交 Git。

## Open Questions

无影响实施的未决问题。甲方真实模型参数、资料和审核是后续业务输入；缺失时按已固定的不可用／阻断契约处理。
