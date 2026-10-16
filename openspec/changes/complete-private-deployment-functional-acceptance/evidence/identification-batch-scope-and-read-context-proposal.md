# D-54：完整验收批次与精确读取授权（已批准）

状态：用户已批准，正在实施。仍归本 change 的 IP-19/IP-21/IP-22，不另拆 change。D-53 代码已部署 v59，工程回归通过；真实业务仍 5/19。证据见 [D-53 记录](identification-domain-authorization-2026-10-15.md)及 [事实汇总](identification-domain-authorization-v59.json)。

批准记录（2026-10-15）：用户批准本提案全部范围，并给出持续授权原文「以后遇到需要修正的地方我都批准，不用每次都停下来问我了」。按当前验收任务后续必要修正预先授权解释：仍先记录事实、设计/施工图与验证，不逐项重复询问；不提交、不归档、不放松权限、不伪造验收。范围外的公共字段、权限、文件、事务或迁移仍凭实际证据升级。

## 为什么需要新范围

原父固定在 2026-10-15T03:59:30.584Z、五份现场资料、外层 21 来源。其时刻解析到旧检索发布，该发布没有当前 v13 的活动代际。已有 v55 七门禁通过属于新发布 `knowledge-release-4c9e88b1-3155-4977-ab82-6afd8ccb2321@1`，不能挪给旧父。

新发布实际使用 19 份知识来源，比原父授权多三份；原父与知识发布的来源并集为 24。当前时刻仍用原 21 来源读取依据，实测拒权。三份新增来源仅为已经正式导入、已参与 D-50 知识发布的治理来源，精确引用在事实汇总的 nextBatchScope.addedSourceVersionRefs 中，不增加原始研究资料。

下游策略还遗漏了正式调用分支；C21 内部逐发布签发与提交身份不一致，并混用了现场工作项来源与知识读取范围。C24 外层签发已经修复，但不能替代所属模块修复或策略审批。v59 的原时刻依据复读仍返回技术失败，原因尚未闭合，不能声称新批次已经可运行。

## 已批准的方案

### 1. 建立新的显式验收批次

保留旧父、旧游标、失败、唯一准备绑定、重试预算与全部报告。新批次通过既有正式工作流入口发起，现场业务载荷仍为原五份来源、原工程修订和空间；外层授权显式声明与已发布知识来源的 24 项并集，逐项经当前账号权限验证。原五份准备可按既有严格条件正式绑定；无法匹配时拒绝，不用 19 资料知识准备冒充五份现场准备。

同成员、同知识内容的新检索组合必须走既有提交、人工审核、独立发布，再在该批次精确的授权摘要下重建双索引和激活代际。新批次在发布完成后固定真实输入时刻，解析到该发布；不改旧发布 effectiveFrom/recordedAt，不把新发布回填旧父。以真实回执固定引用，不预造发布或运行标识。

检索数据集仅为新发布引用及新批次建立新版本，原问题、预期标签、来源证据和七项门槛不变；模型、TopK、工具预算、Agent 预算及质量要求不变。旧 v55 PASS 继续只属于它原来的发布/范围，新组合必须重新实测，失败不得降标。

### 2. 仅补当前隔离验收策略的缺失分支

创建新不可变下游策略版本，为 workflow.start-run、workflow.resume-run、engineering-data.complete-identification-preparation 增加以下既有分支：

- knowledge-modeling.hybrid-evidence
- risk-identification.assemble-and-infer
- risk-identification.repair-and-validate
- risk-identification.merge-run-candidates
- risk-identification.route-acceptance
- risk-identification.accept-groups
- review-audit.trace
- review-audit.request-review

已有复核恢复需由 review-audit.decide-review 的真实来源推进时，只为该根声明同一 C24 调用链所需的上述八项及已存在的 risk-identification.plan、risk-identification.run-read、knowledge-modeling.identification-basis、knowledge-modeling.relationship-context、engineering-data.evidence-access、agent-task.start-task。仍由 C06 逐分支检查当前主体的既有角色能力；不能借策略关联赋予角色原本没有的权限，不能借复核者身份代替原运行主体。

不修改应用角色权限、账号、成员、资料授权、TTL、事务或迁移。未批准工程和生产配置不变。取消或恢复来源若无法按原主体/精确任务/等待/父子运行证明，保持拒绝并升级，不新建通用服务账号、通用事件或工作流状态机。

### 3. 闭合读取身份与冻结授权范围

在 C21 的知识逐发布读取、候选事实读取、基线与有界补搜处，签发身份必须与随后实际 queryId/invocationId 一致；签发只来自本次真实控制/任务来源。现场工作项的五份来源继续表示业务输入，知识读取和检索授权使用本批次明确批准的冻结授权范围，不能把现场五份来源误作全部知识权限，也不能读取 24 项以外的来源。

C21 窄授权输入补充原 AuthorizationContextV1，以便组合根复验其真实签发来源、资源范围及当前资格后再按精确用途签发；知识读取、关系查询与 hybrid-evidence 仍分别使用既有分支。原完整授权摘要贯穿候选集、任务冻结、检索输入和结果对账；新代际按同一摘要建立，保留 C20 现有严格相等检查，不改成宽松匹配或跨范围复用。

对 C17→C16 的内部解析允许显式传入精确 invocationId：C17 按当前可信调用与既有解析目标派生，C16 原样复验；未显式提供的既有调用者仍按原派生严格验证。该字段只属于内部正式读取，不新增外部 HTTP。C24 逐操作签发回调允许返回真实 invocationId 与 authorization，使用可信来源身份区分不同控制调用及主体；adapter 继续独立验证返回的精确身份、单能力和范围。相同业务目标不应迫使新合法调用借用另一个控制调用的过期授权。禁止延长旧 TTL、复活已失效上下文或绕过 C06。

先定位 v59 原时刻依据复读的技术错误，再按上述读取契约修复；错误码保留其真实类别，不用终止失败包装成通过。若发现需要此范围之外的公共字段、权限、文件、事务或迁移，再凭实际证据升级。

## 文件与实施边界

- `packages/core/src/identification/context/ports.ts`、`service.ts`：原上下文、精确用途/调用身份及完整冻结授权对账，复用既有 reader、校验和摘要；`schema.ts` 仅在已存在摘要字段的语义必须同步时调整，不扩张业务 DTO。
- `packages/core/src/knowledge-governance/schema.ts`、`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：内部解析 invocationId；`packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`：调用方精确身份传递和已确认的读取错误。
- `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`apps/worker/src/identification/graph/composition.ts`：逐操作真实签发身份回调，不改业务登记/事务。
- `apps/worker/src/identification/context/composition.ts`、`scripts/deployment/start.mjs`、`scripts/deployment/composition/identification.mjs`：真实签发与既有模块接线；原模型与预算配置不动。
- 上述模块的既有 core/adapter/worker 测试，以及 `scripts/deployment/entrypoints.test.mjs`、`composition.test.mjs`：补真实 PG/C06/C04 集成回归，复用既有夹具。
- 当前 change 的 proposal/design/implementation-plan/handoff、相关 identification/graph、domain/module-interfaces-events-workflows、identification/process-model-mechanism-and-evidence-governance 局部 delta 与安全证据；隔离实例内新版本配置、候选包、正式命令及回执。不改主规格。

无新依赖、迁移、通用数据库/文件/网络工具、UI 范围或模型预算变更。不直接 SQL 写业务事实，不覆盖任何历史对象。此提案尚未执行任何新策略签发、知识发布、索引构建或新业务运行。

## 实施前后的证据

先在真实 PG/C06/C04 测试设施复现逐发布身份错配、完整冻结范围与现场来源混用、跨调用身份碰撞/过期复读。验证同一合法范围可读，错主体、来源、范围、分支、过期或撤权仍拒绝，任务只读原冻结输入。真实读取链和新批次的发布/授权/代际摘要全部一致后，才发正式新运行，不拿原父预算探路。

所属回归、build/typecheck、lint、格式、全仓 strict/diff 通过后冻结新制品；现有物理 Chrome 发正式命令并取证 I0–I3、Agent 运行、RI/RA、人工决定和同次报告。任何等待、失败或缺失都不算通过。tasks 按完整行为与证据勾选，当前保持 5/19，不提交、归档或提前创建 verification。

批准依据（已闭合）：D-53 明确要求白名单、原冻结来源和输入时刻不变；本方案增加隔离策略分支、声明三份既有治理来源并使用新批次，且补 C21/C16/C24 内部授权契约，超出 D-53。项目 AGENTS.md §3 与施工图 §7 要求这些契约和文件先获批；用户已于 2026-10-15 批准，正在按上述范围实施。实施中不宣称通过、不勾 tasks、不建 verification、不提交或归档。
