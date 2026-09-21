# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base：`79ffb524279c901be4f01e2911a5592c7460d888`；实施前运行 `git rev-parse HEAD && git status --short`，若 HEAD 不符或存在非本 change 改动，停止并升级。
- 实际 schema：`orchestrated-delivery`；`applyRequires=proposal,specs,design,implementation-plan,tasks`。实施 Agent 必须运行 `openspec instructions apply --change deliver-response-recommendation --json` 并完整读取其全部 `contextFiles`；不得提前写 `verification.md`。
- 领域依据：本 change [delta spec](specs/domain/response-recommendation/spec.md) 与 [design](design.md)；直接依赖为 C07、C08、C18、C26，代码调用还使用 C03/C04/C06/C19/C25 已归档公开接缝。研究资料只允许本次规划所读的摘要，不再解释原件。
- 预置事实：公共 `RecommendationCommandV1`、`RecommendationSuccessV1`、`ResponseRecommendationSchema` 与 branch capability 已在 `packages/contracts`；C17 `retrieve` 尚无生产分支。C27 在自有模块中实现措施候选查询，不改 C17。
- 硬门：确认 `000045` 空闲、C26 `000044` 已存在、C19 `AssessmentBasisReleaseSetReaderV1` 与 C04 授权工件读取可解析冻结措施成员。任一接口或列相对本 base 漂移，先升级。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01, IP-03 | `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts` 的 C26 任务/预警关系；`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 的评估/输入快照 | 只按精确任务、预警、评估、输入与准备快照引用读取；C06 先授权 | 不复制或更新 C25/C26 风险、触发、预警事实 |
| IP-02, IP-03 | `packages/core/src/assessment-config/validation.ts::selectMeasureCandidates`、`packages/core/src/assessment-config/schema.ts::MeasureLibraryContentV1Schema` | 按 C18 已发布措施语义筛选，按触发预警合并 | 不重建措施库或按名称/最新版本推断 |
| IP-03 | `packages/core/src/scoring-rules/service.ts::AssessmentBasisReleaseSetReaderV1`、`packages/core/src/artifacts/store.ts::ArtifactStoreV1` | 精确读取 C19 成员及 C04 已授权正文 | 不直读 C18/C19 私有表或绕过工件授权 |
| IP-04 | `packages/core/src/agent-runtime/runtime.ts::AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry` | 注册 `response-recommendation` 的 strict 增量、预算、验证与完成回调 | 不建第二套模型循环/预算/工具系统 |
| IP-05, IP-06 | `packages/core/src/persistence/index.ts::TransactionUnitV1`、`packages/core/src/access`、`packages/contracts/src/ports/index.ts::RecommendationCommandV1Schema` | C03 事务回执，C06 精确 branch 能力，公共输入/结果 | 不建私有 receipt、能力枚举或公共 DTO |
| IP-06, IP-07 | `packages/contracts/src/records/index.ts::ResponseRecommendationSchema`、`packages/core/src/review-audit` 的 C07 port | 正式记录由公共 Schema 校验；失败候选仅经合法等待运行送 C07 | 不把复核当作三项失败的强制放行 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 建测试输入与身份硬门 | 全部；尤其“无权或跨工程请求” | `packages/adapters/test/recommendation/fixture.ts` | 复用正式 C25/C26/C19/C18/C03/C06/C07/C08 测试基础，形成两个工程、两处空间、双预警、措施发布、授权及事务失败 seam | 不直接 seed 伪评估/预警，不写生产默认策略 |
| IP-02 | 定义 C27 私有 Schema 与纯规则 | “措施候选只来自冻结的已发布依据”“三项处置约束由确定性模块逐项校验” | 新增 `packages/core/src/recommendation/schema.ts` 的 `MeasureCandidateSetV1Schema`、`ResponseGenerationPolicyV1Schema`、`ResponseRecommendationIncrementV1Schema`、`ResponseValidationPolicyV1Schema`、`RecommendationSiteContextV1Schema`；`service.ts::selectFrozenMeasures`、`validateRecommendationCandidate` | 固定有界 DTO、D-03 候选合并与 D-07 三项逐项校验及多预警主引用；类别/目标值/规范条件只来自 D-06 策略 | 不复制公共记录字段，不硬编码甲方阈值/措施 |
| IP-03 | 上游精确读与候选冻结 | “多预警冻结同一任务的候选”“不合格来源不能进入候选” | 新增 `packages/adapters/src/recommendation/postgres-recommendation-adapter.ts::RecommendationContextReaderV1`、`measureCandidates` | D-02 先授权再读取 C26/C25/C19/C04；按 D-06 正式策略精确绑定类别；校验工程、空间、快照、发布和内容摘要；D-03 保存规范候选工件/引用 | 不修改 C17/C18/C25/C26，不从风险文案/外部事件键猜类别 |
| IP-04 | 处置 Agent 定义与结果收口 | “合法组合成为建议候选”“越界增量被拒绝” | `packages/core/src/recommendation/service.ts::createResponseRecommendationTaskDefinition`；`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts::finalizeCandidate` | 按 D-04 接 C08，越界逐项拒绝；合法候选只追加候选版本和结果引用；失败保留 C08 证据 | Agent 不写正式建议/采纳，不复制 C08 任务事实 |
| IP-05 | C27 迁移 | “合格建议入库并可重放”“审计写入失败” | 新增 `packages/adapters/src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.ts::up/down` | 按 D-09 建四表、外键、唯一性、最小 grant、append-only 与逆序 down | 不占用其它号段或修改旧迁移 |
| IP-06 | 两个公共命令分支 | “结果与冻结依据一致”“结果错配或过期”“合格建议入库并可重放”“不完整或失败结果不可冒充正式建议” | `packages/adapters/src/recommendation/postgres-recommendation-adapter.ts::createCandidate/validateAndRecord` | 按 D-05/D-08 精确绑定 C08 结果；D-07 通过才生成公共正式记录；C03 原子回执/审计及数据库唯一收口 | 不声称实现完整 `WarningResponsePortV1`，不提前采纳 |
| IP-07 | 失败快照、C07 复核与授权 | “任一项失败或依据缺失”“无权或跨工程请求”“审计写入失败”“入库后尚未采纳” | `packages/core/src/recommendation/service.ts::validateRecommendationCandidate`、`packages/adapters/src/recommendation/postgres-recommendation-adapter.ts` | 保存三项独立结果；取 C08 冻结的真实 `parentRunRef` 调用 C07；C04/C07/C27 按 D-08 稳定幂等顺序收口；当前 C06 授权先于对象查询 | 不伪造 review ref，不改 C26 任务状态 |
| IP-08 | 稳定行为测试 | 全部 13 个 Scenario | 新增 `packages/core/test/recommendation/recommendation.test.ts`、`packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` | core 表格覆盖多预警、顺序、边界；PG 测试真实发布/冻结/Agent/三项校验/候选与正式记录、重试/并发/权限/回滚/追溯 | 不锁定提示词、文本或内部调用顺序 |
| IP-09 | 导出与现有接口回归 | “建议生成与人工采纳分离” | 新增 `packages/core/src/recommendation/index.ts`、`packages/adapters/src/recommendation/index.ts`；修改 `packages/core/package.json`、`packages/adapters/package.json` | 仅新增 `./recommendation` 子路径导出，验证 C09 既有 recommend 路由/公共 Schema 无漂移 | 不改 API/Web、contracts、依赖或锁文件 |
| IP-10 | 范围与工具验证 | 全部 | 本 change 工件及上述文件 | 跑 §6 命令；核查 dirty paths 和变更差异，形成证据；实现 task 仅行为和证据均完成后勾选 | 不创建 verification、提交、归档或启动服务 |

## 4. 调用与副作用顺序

1. `measureCandidates`：公共 query parse → C06 `knowledge-modeling.measure-candidates` 当前授权与空间/来源复验 → C26 精确任务/预警 → C25 评估/快照 → D-06 按冻结策略与精确风险输入绑定类别 → C19 精确 basis 成员 → C04 授权措施工件 → C18 strict 解析与纯筛选 → C03 事务中插入规范候选引用、工件关系、审计和回执。未绑定类别、没有措施或任何版本错配在插入前失败。
2. C08 `start-task`：冻结 D-03 工件、政策与预算，`createResponseRecommendationTaskDefinition` 校验每版增量；合法版本由 `finalizeCandidate` 保存候选并返回 `candidateRef`，任务失败只从 C08 窄读取证。
3. `create-candidate`：公共命令 parse → C06 `warning-response.create-candidate` → 同工程任务/查询/C08 结果与 D-06 生成策略精确对账 → C03 原子写载荷/结果回执与审计 → 返回已有候选 ref；同键异载荷拒绝。
4. `validate-and-record`：parse → C06 `warning-response.validate-and-record` → 精确候选/策略/现场读取 → 三项确定性校验与 C04 证据快照。三项全过则同一 C03 事务保存校验、公共正式记录、审计和回执；失败则以候选所存 C08 `parentRunRef` 和稳定幂等键请求 C07 复核，再以 C03 事务保存校验、review ref、审计和回执，绝不插正式记录。C07 成功后 C27 事务失败可按原键重试；失去授权、事务/审计失败不留下 C27 半成品。
5. 不写 C26 任务关闭、C28 采纳/执行或 C29 校准事实；不同命令并发仍由唯一键与版本条件收口，C03 receipt 只负责同命令幂等。

## 5. Schema、状态与持久化落实

- SSOT：公共命令/结果/引用来自 `@riskflow/contracts/ports`，公共建议来自 `@riskflow/contracts/records`；C27 私有 Schema 只描述候选、政策、现场与校验快照。增量只有非空、唯一、连续顺序的候选措施 ID；候选正文与模型输出不进入公共图状态。
- 状态：`frozen-query → agent-candidate → candidate-bound → waiting-review | formal-recorded`；不建立自定义 Agent 状态机。失败复核的新候选版本从 `agent-candidate` 重新验证，旧版本不变。正式记录 `reviewStatus=pending`，采纳仍需独立分支。
- 持久化：D-09 四表存精确 ref 与 C04 工件摘要；`create-candidate` 绑定复用 C03 回执，不建新表；外键到 C26 任务/预警及 C03/C07 事实，正式建议与候选/策略/现场三元组业务唯一。三项校验以完整快照保存，不能只存一个布尔值。
- 权限：查询与命令使用 C02 已存在的 `knowledge-modeling.retrieve`、`warning-response.recommend` branch 映射；C19/C04 读取另按其原授权复验。无权、跨工程/空间/来源统一不可枚举；Agent 权限不大于发起人。
- 错误、审计、迁移、依赖：按 D-08/D-09；不新增公共错误码或事件；`000045` 重复 `up` 与逆序 `down` 需通过实际 PostgreSQL 检查；无新第三方依赖。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 措施候选 / 多预警冻结同一任务的候选 | IP-01, IP-02, IP-03, IP-08 | `packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` | C26 双预警 + C18 正式措施发布 | 候选有序去重、逐项预警/发布 ref；后续发布不改旧集 | `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 措施候选 / 不合格来源不能进入候选 | IP-02, IP-03, IP-08 | 同上 | 跨工程/不适用/未发布措施、无精确类别绑定的风险输入 | 越界措施被排除；无类别/空集结构化阻塞；不从风险文案或外部事件键推断 | 同上 |
| 处置 Agent / 合法组合成为建议候选 | IP-04, IP-08 | 同上 | C08 注册定义与冻结候选 | 完成结果恰有候选主引用，未有正式建议 | 同上 |
| 处置 Agent / 越界增量被拒绝 | IP-04, IP-08 | `packages/core/test/recommendation/recommendation.test.ts` 与 PG test | 候选外 ID、重复顺序、预算终止 | 逐项拒绝/失败证据，无正式建议 | `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 候选命令 / 结果与冻结依据一致 | IP-04, IP-06, IP-08 | PG test | 同任务/查询/策略的 completed C08 结果 | 相同命令返回同一 ref，审计与绑定唯一 | `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 候选命令 / 结果错配或过期 | IP-06, IP-08 | PG test | 失败任务、异工程查询、旧策略 | 类型化拒绝，零正式事实和成功审计 | 同上 |
| 三项校验 / 三项均通过 | IP-02, IP-06, IP-08 | core + PG test | 全覆盖目标、规范、资源与工序 | 三项独立通过；正式 ref 存在 | `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 三项校验 / 任一项失败或依据缺失 | IP-02, IP-07, IP-08 | core + PG test | 三类各一失败和缺失依据，C08 冻结真实 parent run | 失败快照保留；C07 返回 review；无正式建议；C07 成功/C27 失败的同键重试不重复复核 | 同上 |
| 正式建议 / 合格建议入库并可重放 | IP-05, IP-06, IP-08 | PG test | 正式 C25→C26→C19/C18→C08 链 | 公共 Schema 有效、精确全链、重试/并发唯一 | `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 正式建议 / 不完整或失败结果不可冒充正式建议 | IP-02, IP-06, IP-08 | core + PG test | 空资源/目标/失败结果 | Schema/领域拒绝，正式表零新增 | `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 权限事务审计 / 无权或跨工程请求 | IP-03, IP-07, IP-08 | PG test | 同工程越界空间、跨工程、有/无目标 | 同形拒绝，未先读正文，零业务副作用 | `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` |
| 权限事务审计 / 审计写入失败 | IP-05, IP-07, IP-08 | PG test | 注入真实 C07 审计约束失败 | 候选/校验/建议/回执同事务回滚，原键可重试 | 同上 |
| 建议与采纳 / 入库后尚未采纳 | IP-06, IP-07, IP-08, IP-09 | PG + contracts test | 合格建议 | 无采纳、执行、任务关闭或反馈事实；现有路由不变 | `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts` |

其余可运行检查（实现文件建成后执行）：

```bash
pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false
pnpm exec eslint packages/core/src/recommendation packages/core/test/recommendation packages/adapters/src/recommendation packages/adapters/test/recommendation
pnpm exec prettier --check openspec/changes/deliver-response-recommendation packages/core/src/recommendation packages/core/test/recommendation packages/adapters/src/recommendation packages/adapters/test/recommendation packages/core/package.json packages/adapters/package.json
pnpm run deps:check
pnpm run deps:policy
git diff --check
openspec validate deliver-response-recommendation --strict --no-interactive
openspec status --change deliver-response-recommendation --json
```

## 7. 文件清单与升级条件

- 新增：IP-02 `packages/core/src/recommendation/{schema,service,index}.ts`；IP-03/04/06/07 `packages/adapters/src/recommendation/{postgres-recommendation-adapter,index}.ts`；IP-05 `packages/adapters/src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.ts`；IP-01/08 `packages/core/test/recommendation/recommendation.test.ts`、`packages/adapters/test/recommendation/{fixture,postgres-recommendation-adapter.test}.ts`。
- 修改：IP-09 `packages/core/package.json`、`packages/adapters/package.json` 的 `./recommendation` 导出。删除：无。
- 受保护：`packages/contracts/**`、`apps/api/src/**`、`apps/web/src/**`、其它 core/adapters 子模块、`openspec/specs/**`、其它 changes、旧迁移、中央迁移清单与认证 fixture、根依赖/锁文件、`openspec/config.yaml`。中央登记由主调度检查点完成。
- 立即升级：HEAD/schema 或依赖代码漂移；`000045` 已占用；C19/C04 不能合法读精确措施正文；需改变任何公共字段、权限、事务、持久化所有权或迁移号段；需编辑受保护文件/增加依赖/新事件；合法 C07 复核无法保持失败无正式建议；§6 必需命令不存在或关键场景只靠 Mock/跳过通过。

## 8. 验收 Agent 授权与限定审计

Finalizer 可核对并在上列 C27 文件及测试范围内修复已批准语义的缺陷、重跑受影响回归、填写同一 change 的 `verification.md`；不得改公共契约、C03/C06/C07/C08/C17/C18/C25/C26 或引入依赖。授权与来源不可枚举、事务/并发唯一性、Agent 越界及失败候选强制放行属于限定审计关注项；同一收尾轮次最多一次审计，审计发现的普通范围内缺陷在其活动 Task 内直接修复并回归。
