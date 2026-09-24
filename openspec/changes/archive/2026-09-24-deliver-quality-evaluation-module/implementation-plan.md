# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base HEAD：`572fa73f1ccd3acb543762247842c55c2accbd42`；实现前必须核对本 HEAD 的代码符号，若协调端依赖登记/同步改变 HEAD，重新核对本施工图后继续。
- 批准输入：`approval://riskflow/C36/scope-2026-09-23-quality-evaluation-and-browser-acceptance` 与协调裁决 `msg_8f46a64026e9`。规格：`specs/quality/evaluation-and-browser-acceptance/spec.md`，决策：`design.md` D-01～D-08。研究资料仅 `references/风险识别与评估规划事实源摘要.md`。
- 直接依赖事实：C04 不可变工件、C03 原子事务/审计、C06 授权、C09 HTTP、C10 页面壳、C14 读取边界、C15/C17/C20/C21/C22 识别结果、C25/C27/C29 评估结果。C10/C13/C14 的已归档语义保持。
- 本轮规划不修改生产代码、锁文件或测试；所有下列文件是 Implementation/协调端**未来**允许的施工范围。`verification.md` 由 Finalizer 在实现检查点后创建。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/records/index.ts` 的标准化风险记录 Schema；`packages/core/src/identification/candidate-finalization/ports.ts` 的 `StandardizedRiskRecordStoreV1.readRecord` | 以精确记录 ref/digest 核对 C04 快照；只读拥有方公开窄口 | C22 正式记录、标签语义 |
| IP-02 | `packages/core/src/risk-assessment/engine/engine.ts` 的 `evaluateDeterministicAssessment`；`packages/core/src/risk-assessment/engine/schema.ts` 的评估 Schema | 用冻结上下文复算 P/C、矩阵与决策摘要 | 评分规则、矩阵和评估算法 |
| IP-03 | `packages/core/src/artifacts/store.ts` 的 `ArtifactStoreV1`；`packages/core/src/persistence/transaction.ts` 的 `TransactionUnitV1` | C04 完整工件读写，C03 回执/审计原子提交 | 工件完整性、审计、幂等基础设施 |
| IP-04 | `packages/adapters/src/postgres/migrations/provider.ts` 的自动发现；`000032_deterministic_risk_assessment.ts` 的最小 GRANT 模式 | 增加 C36 自有表，测试侧登记迁移 | 上游私表、C14 监测正文 |
| IP-05 | `packages/contracts/src/ports/index.ts` 的 `ProjectionQueryV1Schema`、`ProjectionQuerySuccessV1Schema`、`MODULE_BRANCH_CAPABILITY_V1`；`apps/api/src/http.ts` 的 `ApiPortsV1`、`activeHttpRouteCatalog` | 仅加 `quality-evaluation` 类型、质量摘要与窄查询 port 接线 | 旧 queryType、角色和 capability |
| IP-06 | `apps/web/src/app/routes.ts` 的 `createWebRouteRegistry`；`apps/web/src/app/App.tsx` 的 `routeContent`；`apps/web/src/api/http.ts` 的 `createC09Client` | 注入 C36 `/assessment` 页面及同源查询，不改 C10 组件 | C10 路由/会话/焦点规则 |
| IP-07 | `apps/api/src/app.ts` 的 `buildApi`；`packages/adapters/test/auth/fixture.ts` 的真实 PostgreSQL fixture | 生产构建、真实服务和 Chromium 测试 | Mock HTTP/浏览器、C37/C38 结论 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1 | 质量数据集必须冻结并标明适用边界；冻结的脱敏样例进入评估；样例不足或只有合成样本 | `packages/core/src/quality/schema.ts`（新 `QualityDatasetV1Schema`/`QualityReportV1Schema`）；`packages/core/src/quality/index.ts`；`packages/core/package.json` 的 `./quality` export；`packages/core/test/quality/fixtures/synthetic.json`；`packages/core/test/quality/quality.test.ts` | D-01 strict 数据集、显式正负全集、精确快照与版本、样例资格、C04 数据集引用；无真实样例显式标记 | 不推断标签、配置或甲方真实表现 |
| IP-02 | 2 | 识别与评估质量指标必须由确定性证据计算；正式结果与标注对齐；缺失结果或分母为零；可重放与可审计结论必须引用耐久证据；精确版本可复核；证据或审计缺失 | `packages/core/src/quality/evaluate.ts`（新 `evaluateQualityDataset`）；`packages/core/test/quality/quality.test.ts` | D-02 七项指标、分子/分母与逐项失败；复用 C29 引擎，核对 C22 digest、C29 决策工件/记录 ref；零分母 `null`，不重跑 LLM | C22 合并、C29 P/C/矩阵算法 |
| IP-03 | 3 | 可重放与可审计结论必须引用耐久证据；精确版本可复核；证据或审计缺失；追加与重放 | `packages/core/src/quality/service.ts`（新 `QualityEvaluationService`/窄读端口）；`packages/adapters/src/quality/postgres-quality-evaluation.ts`（新 C04/C03 组合）；`packages/adapters/src/quality/index.ts`；`packages/adapters/package.json` 的 `./quality` export；`scripts/quality/evaluate.mjs`；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts` | D-03 授权→有界 C04 读/verified→计算→报告 C04 put→C03 事务内核对数据集冻结摘要并追加索引/回执/审计；CLI 只输出安全报告 ref 与实际命令；同键重放、异摘要冲突及并发回归、失败不显成功 | 上游私表、异步丢审计、磁盘报告代替 C04 |
| IP-04 | 4 | C36 页面查询投影必须有界且只追加；追加与重放 | `packages/adapters/src/postgres/migrations/query-projection/deliver-quality-evaluation-module/000052_quality_evaluation_report_index.ts`；`packages/adapters/test/auth/fixture.ts`；`packages/adapters/test/postgres/postgres-foundation.test.ts`；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts` | D-05 报告索引与数据集冻结登记表，各自只追加；冻结身份唯一、报告 ref 唯一/列表索引；`riskflow_app` 两表均仅 SELECT/INSERT、无跨 change FK；重复 up、逆序 down；同步迁移 id | 旧迁移、上游表或 UPDATE/DELETE 权限 |
| IP-05 | 5 | C36 页面查询投影必须有界且只追加；获授权页面读取精确质量报告；工程切换或撤权；不可枚举拒绝与旧类型兼容；追加与重放 | `packages/adapters/src/quality/postgres-quality-projection.ts`；`packages/contracts/src/ports/index.ts`；`packages/contracts/test/module-interfaces-events-workflows.test.ts`；`apps/api/src/http.ts`；`apps/api/test/quality.test.ts`；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts` | D-04/D-06 仅一新增 queryType、闭合 selector 和有界摘要、`qualityProjectionQuery` 窄端口、C09 既有 route、当前 C06 最小授权，列表 keyset≤50、exact 单条、统一 NOT_FOUND | 旧 queryType/结果、额外 branch/capability/角色、私表查询 |
| IP-06 | 6 | C36 页面查询投影必须有界且只追加；获授权页面读取精确质量报告；工程切换或撤权；跨页面验收必须使用真实浏览器与正式接缝；真实浏览器完成跨页面链路 | `apps/web/src/quality/operation.ts`（C09 operation/解码）；`apps/web/src/quality/QualityPage.tsx`（C10 页面贡献）；`apps/web/src/main.tsx`（现有 App 回调/会话/工程接线）；`apps/web/test/quality.test.tsx` | D-06 无旧工程闪现，abort 旧查询，刷新重新查询，证据只显示授权摘要；UI 不写业务正文 | C10 组件/路由/焦点语义、本地业务缓存 |
| IP-07 | 7 | 跨页面验收必须使用真实浏览器与正式接缝；真实浏览器完成跨页面链路；环境不可用或接缝拒绝；前述全部端到端场景 | `playwright.config.ts`；`vitest.config.ts`；`apps/web/test/browser/quality.spec.ts`；`apps/web/test/browser/server.mjs`；`package.json` 的 `quality:evaluate`/`test:browser` 脚本；`pnpm-lock.yaml` 与 `package.json` 的 `@playwright/test` 登记（仅协调端）；`apps/web/test/quality.test.tsx` | D-07 生产构建+真实 Fastify/PostgreSQL/C04/C06/C36、真实登录 Cookie/Chromium；Vitest 排除 Playwright 规格文件；trace/版本/命令/报告 ref 证据，关键失败非零退出 | Mock 服务或浏览器、dev server、生产运行时依赖 |

## 4. 调用与副作用顺序

1. IP-01 先校验数据集版本、来源资格、样例/标签/版本完整性与同工程约束；C04 冻结数据集与 C22/C29 输出/引擎上下文快照。任何缺失先失败，不读取其它样例或模型补足。
2. IP-03 由 C06 当前授权建立单一 `projection.export` capability 的 C36 质量评估调用，C04 put 也要求此 capability；按显式 refs 逐份 C04 有界读取、完整消费 `verified`；C22 `readRecord` 核对正式记录 digest，不直接读 C22/C29 表。授权/完整性/错版统一安全失败，不生成正式质量通过项。
3. IP-02 在内存做标签比对、C29 确定性重算和证据检查；零分母产生 `not-computable`，缺正式结果保留分母与安全原因；不修改任何业务事实。
4. IP-03 先 C04 put 报告，再在 C03 单事务原子登记/核对 IP-04 数据集冻结摘要，并追加报告索引、回执、事实审计；事务失败不暴露成功，重试复用已成立工件。同一数据集版本异摘要报错版；相同幂等身份同摘要返回原 ref，不同运行/报告版本仍各自追加。
5. IP-05 C09 根据原 `projection.query` 签发当前用户/工程/空间/资料最小授权，adapter 在索引读取前复验；列表使用项目修订 + keyset + 最大 50，exact 使用完整工件 ref；返回写入时已 C04 验证的安全摘要并按当前 source grant 过滤证据定位引用，页面查询不打开 C04 正文。无权/跨工程/不存在同形失败；查询不反写业务事实。C09 的其它完整 projection port 优先，C36 窄口不启动 SSE/export。
6. IP-06 页面只用 C09 operation，工程修订变化卸载旧状态并 abort；登录由 C09 原有 Cookie 流，刷新重新读服务器，必要时重新登录。IP-07 用已成立的合成报告运行真实浏览器；失败保留 trace 且非零退出。

## 5. Schema、状态与持久化落实

- SSOT：D-01 内部数据集/报告 Schema 在 `packages/core/src/quality/schema.ts`；D-04 对外 query/摘要 Schema 只在 `packages/contracts/src/ports/index.ts`，C36 core/adapter/web 直接引用，不再定义同字段副本。旧 `ProjectionQueryV1Schema` 选项与成功基础字段维持原样。
- 状态：数据集 `invalid|frozen`；评估 `running|failed|committed`；指标 `computed|not-computable`；页面沿 C10 既有状态。业务风险记录、预警/处置不因质量评估发生状态迁移。
- 存储：C04 保存数据集、输出快照、逐项报告；C36 报告表只保存受限索引/摘要，冻结表只保存数据集身份/内容摘要。D-05 迁移无跨 change FK，两表最小 GRANT、幂等 up/down 与各自唯一组合；`riskflow_app` 无 UPDATE/DELETE。审计/回执用 C03，C04 访问保留原访问审计。
- 错误：无权/跨工程/不存在对页面统一 NOT_FOUND；错版 STALE_VERSION；同键异载荷 IDEMPOTENCY_CONFLICT；C04 失败关闭成功路径；指标无分母给不可计算原因。应用日志只放安全代码与引用，不含正文/模型响应。
- 依赖：根 `@playwright/test@1.63.0` 只作为 devDependency；协调端串行更新 `package.json`、`pnpm-lock.yaml` 与依赖策略。浏览器二进制固定到该包版本并在外部缓存，缺失时浏览器验收 BLOCKED/非零退出。

## 6. 验收证据矩阵

命令别名：`Q1=pnpm exec vitest run packages/core/test/quality/quality.test.ts`；`Q2=pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts`；`Q3=pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/quality.test.ts`；`Q4=pnpm exec vitest run apps/web/test/quality.test.tsx`；`Q5=pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`；`Q6=pnpm typecheck && pnpm deps:check && pnpm deps:policy`；`Q7=openspec validate deliver-quality-evaluation-module --strict --no-interactive`；`Q8=pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts`。所有 Q 命令是目标实现完成后的**实际可运行**命令；缺浏览器或数据库时必须报阻塞，不可计通过。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 质量数据集必须冻结并标明适用边界 / 冻结的脱敏样例进入评估 | IP-01 | `packages/core/test/quality/quality.test.ts` | 完整合成 fixture；脱敏资格样例可在有甲方数据时替换 | 精确版本/标签全集固定、同版本复算分母 | Q1 |
| 同 Requirement / 样例不足或只有合成样本 | IP-01 | 同上 | 缺标签/版本、synthetic | 缺项拒绝；固定标记“合成样本，待甲方复核”，无真实准确率声明 | Q1 |
| 识别与评估质量指标必须由确定性证据计算 / 正式结果与标注对齐 | IP-02 | `packages/core/test/quality/quality.test.ts` | C22/C29 正式结果和显式正负样本 | 七项指标分子/分母、TP/TN/FP/FN 与 refs | Q1 |
| 同 Requirement / 缺失结果或分母为零 | IP-02 | 同上 | 缺正式输出、空可比来源对 | 缺口仍在分母、零分母 `null`，无替代 LLM 结果 | Q1 |
| 可重放与可审计结论必须引用耐久证据 / 精确版本可复核 | IP-02,IP-03 | `packages/adapters/test/quality/postgres-quality-evaluation.test.ts` | C04 冻结上下文、C29 决策工件、C03 审计 | 同命令同指标和精确 refs；报告 C04 `verified` | Q2 |
| 同 Requirement / 证据或审计缺失 | IP-03 | 同上 | 工件损坏/撤权、审计提交失败 | 失败项可见、正式索引/成功不成立，重试安全 | Q2 |
| C36 页面查询投影必须有界且只追加 / 获授权页面读取精确质量报告 | IP-04,IP-05,IP-06 | `packages/adapters/test/quality/postgres-quality-evaluation.test.ts`; `apps/web/test/quality.test.tsx` | 已索引报告、真实 C06 工程成员 | 列表≤50、exact 唯一、C04 摘要无正文 | Q2,Q4 |
| 同 Requirement / 工程切换或撤权 | IP-05,IP-06 | `apps/api/test/quality.test.ts`; `apps/web/test/quality.test.tsx` | 双工程、撤权会话、延迟查询 | 同形拒绝，旧内容/证据清除、abort | Q3,Q4 |
| 同 Requirement / 不可枚举拒绝与旧类型兼容 | IP-05 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`; `apps/api/test/quality.test.ts` | 无权/跨工程/不存在、旧 queryType | 三类同形 NOT_FOUND；旧类型编码/结果不变 | Q3 |
| 同 Requirement / 追加与重放 | IP-03,IP-04,IP-05 | `packages/adapters/test/quality/postgres-quality-evaluation.test.ts`; `packages/adapters/test/postgres/postgres-foundation.test.ts` | 同键同/异摘要、同数据集多报告、并发双摘要、迁移回滚 | 冻结身份唯一、同摘要幂等/异摘要错版、报告只追加；up/up/down/up 与两表 GRANT | Q2,Q8 |
| 跨页面验收必须使用真实浏览器与正式接缝 / 真实浏览器完成跨页面链路 | IP-07 | `apps/web/test/browser/quality.spec.ts` | 真实 Chromium、生产构建、Postgres/C04/C06/C36 | 登录→页面切换→质量结果→刷新/重新登录→授权摘要、焦点 | Q5 |
| 同 Requirement / 环境不可用或接缝拒绝 | IP-07 | 同上 | 缺 Chromium/服务或撤权 | 非零退出、trace/安全错误，不跳过关键场景 | Q5 |

`Q6`/`Q7` 覆盖全部 IP 的类型、依赖边界、策略与规格；IP-03 的 Q2 集成测试还须执行 `scripts/quality/evaluate.mjs` 的合成数据集 CLI 路径并核对 C04 报告引用。浏览器测试的运行记录需写入报告工件的实际命令/浏览器版本，Finalizer 再以最终 HEAD 填 verification。

## 7. 文件清单与升级条件

**Implementation 可新增：** `packages/core/src/quality/{schema,evaluate,service,index}.ts`、`packages/core/test/quality/fixtures/synthetic.json`、`packages/core/test/quality/quality.test.ts`、`packages/adapters/src/quality/{postgres-quality-evaluation,postgres-quality-projection,index}.ts`、`packages/adapters/src/postgres/migrations/query-projection/deliver-quality-evaluation-module/000052_quality_evaluation_report_index.ts`、`packages/adapters/test/quality/postgres-quality-evaluation.test.ts`、`apps/api/test/quality.test.ts`、`apps/web/src/quality/operation.ts`、`apps/web/src/quality/QualityPage.tsx`、`apps/web/test/quality.test.tsx`、`apps/web/test/browser/quality.spec.ts`、`apps/web/test/browser/server.mjs`、`playwright.config.ts`、`scripts/quality/evaluate.mjs`。

**Implementation 可修改：** `packages/core/package.json`、`packages/adapters/package.json`、`packages/contracts/src/ports/index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/adapters/test/auth/fixture.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`、`apps/api/src/http.ts`、`apps/web/src/main.tsx`、`vitest.config.ts`、根 `package.json` 的本 change 质量/浏览器脚本。**仅协调端串行改：** 根 `package.json` 的 `@playwright/test` 依赖条目、`pnpm-lock.yaml`、既有依赖策略登记；不得由 Implementation 安装或改锁文件。**删除：** 无。

受保护：C10/C13/C14 已归档公共契约与代码、C22/C29 领域算法、其它 change 的 migration/私表、角色/capability 枚举、生产依赖。任何施工符号不存在、需新增上游公开读契约/生产依赖、改变事务/权限/迁移/公共 Schema 既定语义、碰撞迁移序号或扩大文件清单时暂停并升级，不自行补设计；普通测试失败在当前任务修复。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在第 7 节 Implementation 允许文件和已批准语义内核验、修复、回归，并创建 `verification.md`；必须核对 Q1～Q7 的实际执行、关键场景确实命中、报告 C04 引用、浏览器 trace 与最终 HEAD。权限拒绝、C03 原子事务、migration 回滚及同键幂等列为限定审计标签；审计只在触发时由单独 Task 执行并补同一 verification，不改变质量指标口径或开放新权限。

## 9. 施工文件核对

`vitest.config.ts` 的唯一变动是将 `apps/web/test/browser/**` 从 Vitest 发现范围排除，使 Playwright 规格只由 Q5 的真实 Chromium 命令执行；这不改变 C36 的交付范围。

## 10. 2026-09-23 重开规划施工增量

- **固定输入 HEAD：** `ac0ab1d788199301c65dde2b522759d097b96610`；上文 `572fa73f...` 是首轮施工基线，不得用于本轮核对。批准输入：`approval://riskflow/C36/scope-2026-09-23-quality-evidence-and-grant-mapping`、协调裁决 `msg_fa149dc63e7f`。原 IP-01～IP-07 与已勾任务属于先前实现；本轮只新增 IP-08～IP-10，既有 BLOCKED verification 不由 Planning 修改。
- **已核对符号：** `QualityEvaluationService.#collectEvidence`、`QualityEvaluationReadPortV1`、`QualitySampleV1Schema`、`QualitySampleEvidenceV1`、`evaluateQualityDataset/evaluateSample`；`PostgresQualityEvaluationAdapter.readVerifiedJson`、`PostgresQualityProjectionAdapter.query/#listRows`、`apps/api/src/app.ts` 的 `runBusiness/authorize`、`apps/api/src/http.ts` 的 `ApiPortsV1/invokeProjectionQuery`、`apps/web/src/quality/QualityPage.tsx` 的 `loadQualitySummaries`；C22 `StandardizedRiskRecordStoreV1.readRecord` 与 `RiskCandidateFinalizationResultStoreV1.readResult`；C13 `EngineeringDataPortV1.read`、`PostgresEngineeringContextSourceRegistry.resolveReadQuery` 及 `EvidenceAccessReadResultV1Schema`；C06 `evaluateCurrentAccess`。前两项 C22 公开读取均不能证明终态零结果，见 D-09。

| IP-ID | 批准项 / Requirement·Scenario | 已有符号与动作 | **唯一允许的实施文件** | 验证命令及通过证据 | 状态 |
|---|---|---|---|---|---|
| **IP-08** | 1 正式空结果；“识别与评估质量指标必须由确定性证据计算” / “精确冻结运行证明正式空结果”“精确冻结运行存在正式结果”“空结果证明缺失或越界”“跨空间或无权读取正式结果证明”“缺失结果或分母为零”；“质量数据集必须冻结并标明适用边界” / “冻结的脱敏样例进入评估” | D-09：读取 C39 已完成运行终态与精确工作计划，逐项读取 C22 正式零结果；`QualitySampleV1Schema` 可选保存运行/计划/终态引用，C36 仅在全集零结果、样例范围精确匹配及当前授权均成立时计 TN/覆盖，其他情况保持 `undetermined`。 | **C22 只读组合面：** `packages/core/src/identification/candidate-finalization/{ports,service}.ts` 与既有测试。**C36：** `packages/core/src/quality/{schema,service,evaluate}.ts`、`packages/adapters/src/quality/postgres-quality-evaluation.ts`、`packages/core/test/quality/quality.test.ts`、`packages/adapters/test/quality/postgres-quality-evaluation.test.ts`、`scripts/quality/evaluate.mjs`。无需 C22 写侧或新迁移。 | `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`；`pnpm typecheck`。 | C39/C22 已归档正式事实可用；由 Finalizer 以回归结果闭合。 |
| **IP-09** | 1 必审资料段；“可重放与可审计结论必须引用耐久证据” / “必审资料段可授权解析”“必审资料段拒绝或漂移”“证据或审计缺失”“精确版本可复核” | D-10：`QualityEvaluationService` 从命令中的现有 C13 读分支授权，按冻结 `requiredEvidenceRefs` 批量调用 `EngineeringDataPortV1.read({kind:'evidence-access'})` 与 `PostgresEngineeringContextSourceRegistry.resolveReadQuery`；核对每一项精确段、来源版本、集合/查询 ref、grant、工程/空间，丢弃正文，只交付请求内证明。`evaluateSample` 需逐项收据且既有 C04 verified/正式审计成立才计完整。C04 同形拒权不升格为“缺失即可通过”。 | `packages/core/src/quality/{schema,service,evaluate}.ts`；`packages/adapters/src/quality/postgres-quality-evaluation.ts`；`scripts/quality/evaluate.mjs`；`packages/core/test/quality/quality.test.ts`；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts`；`apps/web/test/browser/server.mjs`（仅真实夹具）。**不允许** C13/C06 源码和私表。 | `pnpm exec vitest run packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`：全引用正面解析、缺一项/错版/跨空间工程/撤权失败、同版重放、无正文进入报告；`pnpm exec playwright test -c playwright.config.ts --project=chromium`：真实夹具生成的审计指标与引用；`pnpm typecheck`。 | 已批准施工路径；实施需先以真实 C13/C06 组合测试验证原 actor 拥有既有读分支。无权时保持失败闭合，不扩权。 |
| **IP-10** | 2 grant→sourceVersion；“C36 页面查询投影必须有界且只追加” / “来源版本与资料 grant 精确映射”“来源映射缺失或授权变化”“获授权页面读取精确质量报告”“工程切换或撤权”“不可枚举拒绝与旧类型兼容”；“跨页面验收必须使用真实浏览器与正式接缝” / “真实浏览器完成跨页面链路” | D-11：`PostgresQualityProjectionAdapter` 在原项目/空间条件下预选有界索引并提取版本；`runBusiness` 仅对 C36 查询以同会话逐版本签发 `projection.query`，每次精确 `requestedSourceVersionRefs:[ref]`；把版本→grant 的请求内映射传回 C36 终读，复查行 digest/当前授权后过滤 `evidenceRefs`。`QualityPage` 仍通过原 C09 operation，不猜 grant ID；保留完整 port 优先级。 | `packages/adapters/src/quality/postgres-quality-projection.ts`；`apps/api/src/{app,http}.ts`；`apps/api/test/quality.test.ts`；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts`；`apps/web/test/browser/{server.mjs,quality.spec.ts}`。**不允许** C06 签发语义、角色/capability、HTTP 公共字段、持久化或 migration 改动。 | `pnpm exec vitest run apps/api/test/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`：真实 grant 与来源版本不同 ID 仍仅披露获准引用；混合授权、跨工程/空间、撤权、并发新报告、同键重放均失败闭合；`pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`：真实页面可见获准定位；`pnpm typecheck && pnpm deps:check && pnpm deps:policy`。 | 已批准施工路径；若现有 C09 会话签发不能支撑请求内逐版本映射，立即 BLOCKED/升级。 |

**顺序与副作用：** IP-09 先只读 C06/C13 并收集不含正文的收据，任何失败先保留样例失败码；IP-08 只有拥有方终态证明可用后才更新 TN/覆盖，不改变 D-03 报告先 C04、后 C03 索引/回执/审计原子提交；IP-10 先授权选行，再逐版本签发并终读复核，查询全程不写业务事实。IP-09/10 读时撤权不使用旧上下文；C04、C13、C06 的无权/不存在继续同形。无需新的 C36 数据表、migration、生产依赖、角色或权限值。实际 `Q1～Q8` 仍对既有行为有效；本轮新增测试应覆盖上述真实结果，不静态断言文案。

**IP-08 拥有方事实：** C39 终态与工作计划、C22 每工作项正式零结果均已在主规格及生产代码中提供；C36 只读组合不扩持久化或权限。C22 的独立只读入口由协调端 `msg_044d87768b43` 批准，与既有服务共用校验实现。

**门禁：** `openspec validate deliver-quality-evaluation-module --strict --no-interactive`、`git diff --check`、相关 Vitest 与 `pnpm typecheck && pnpm deps:check && pnpm deps:policy`。Finalizer 在三项行为及证据完成后更新任务和 verification；审计按本轮受控协议记录。
