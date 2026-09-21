# Verification

## 验收对象

- Change：`deliver-response-recommendation`（实际 schema：`orchestrated-delivery`）
- 输入实现 HEAD：`45e19ce937fc8eed38e0877d40677d50f97f9c58`
- 当前产物 HEAD：`4fa08e1186a441a6f22a5a3d1f25f202c208ae7d`；限定审计修复仍在未提交工作树，主调度形成检查点后须更新此值。
- 验收 Agent：C27 Finalizer，任务 `task_d5df0e2ccef8`，派发 `ctx_e3e4ac832422`
- 限定审计 Agent：任务 `task_79276f4809d0`，派发 `ctx_a301d83f4bf7`

## 结论

**PASS**：本轮唯一一次限定审计完成。候选查询幂等绕过和关联预警读取前的空间过滤已在 C27 范围内修复；最终回归、类型、格式及 OpenSpec 严格校验通过。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 措施候选 / 多预警冻结同一任务的候选；IP-01/02/03/08 | PostgreSQL 测试“多预警冻结同一任务的候选”；C26 真实预警、C04 授权工件、C18 strict 文档及 C19 公共读取契约；冻结集合含精确发布和预警引用。 | 通过；后续归集不改旧集。 |
| 措施候选 / 不合格来源不能进入候选；IP-02/03/08 | PostgreSQL 同名测试；类别、适用性、发布与工程边界，空集结构化阻塞。 | 通过。 |
| 处置 Agent / 合法组合成为建议候选；IP-04/08 | PostgreSQL“合法组合成为建议候选”；C08 完成结果只产生候选引用。 | 通过。 |
| 处置 Agent / 越界增量被拒绝；IP-04/08 | Core 任务定义测试及 PostgreSQL 候选越界测试；逐项拒绝和失败证据。 | 通过；未产生正式建议。 |
| 候选命令 / 结果与冻结依据一致；IP-04/06/08 | PostgreSQL `create-candidate` 精确绑定及幂等测试。 | 通过；同键同载荷复用引用。 |
| 候选命令 / 结果错配或过期；IP-06/08 | PostgreSQL 错配、过期、失败结果测试。 | 通过；无正式事实和成功审计。 |
| 三项校验 / 三项均通过；IP-02/06/08 | Core 三项纯规则测试；PostgreSQL 正式建议测试；同版 C18 阈值/联合规则经字段映射解析为措施目标指标。 | 通过；三项独立记录后入库。 |
| 三项校验 / 任一项失败或依据缺失；IP-02/07/08 | Core 三类失败测试；PostgreSQL 失败快照/C07 复核测试；新增缺映射和措施目标未覆盖两种真实数据库链测试。 | 通过；待复核且正式建议零新增。 |
| 正式建议 / 合格建议入库并可重放；IP-05/06/08 | PostgreSQL 正式建议、幂等与并发测试；`000045` 重复 up、逆序 down 和重建测试。 | 通过；公共记录可沿预警、评估、措施与校验引用重建。 |
| 正式建议 / 不完整或失败结果不可冒充正式建议；IP-02/06/08 | Core 公共记录构造边界；PostgreSQL 不完整/过期候选测试。 | 通过；正式表零新增。 |
| 权限事务审计 / 无权或跨工程请求；IP-03/07/08 | PostgreSQL 无权、跨工程、越界空间测试；新增 `create-candidate` 和 `validate-and-record` 对候选及查询的当前 C06 空间限定。 | 通过；拒绝且无回执/业务写入。 |
| 权限事务审计 / 审计写入失败；IP-05/07/08 | PostgreSQL 真实审计约束失败、同事务回滚与同键重试测试。 | 通过。 |
| 建议与采纳 / 入库后尚未采纳；IP-06/07/08/09 | PostgreSQL 未采纳测试；contracts/API 现有接口回归。 | 通过；无采纳、执行、反馈或任务关闭事实。 |
| 实施与范围；IP-01/05/09/10 | 下列静态检查、迁移测试、包导出和接口回归；`git diff --check`。 | 通过；本轮未提交、合并或归档。 |

可运行命令及结果：

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` | 2 文件，26 项通过。 |
| `pnpm exec vitest run packages/core/test/assessment-config/assessment-config.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` | 5 文件，117 项通过。 |
| `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts` | 2 文件，27 项通过。 |
| `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false` | 通过。 |
| `pnpm exec eslint packages/core/src/recommendation/schema.ts packages/core/src/recommendation/service.ts packages/core/test/recommendation/recommendation.test.ts packages/adapters/src/recommendation/postgres-recommendation-adapter.ts packages/adapters/test/recommendation/fixture.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts` | 通过。 |
| `pnpm exec prettier --check openspec/changes/deliver-response-recommendation packages/core/src/recommendation packages/core/test/recommendation packages/adapters/src/recommendation packages/adapters/test/recommendation packages/core/package.json packages/adapters/package.json` | 通过。 |
| `pnpm run deps:check && pnpm run deps:policy && openspec validate deliver-response-recommendation --strict --no-interactive` | 通过。 |
| `git diff --check` | 通过。 |

验收期修复：

- 在 C27 私有冻结预警中保存同版 C18 阈值或联合规则解析出的指标身份和无法解析的触发项。触发校验现在同时要求已选措施覆盖这些指标、正式策略提供目标值；缺失或歧义进入 C07 复核，不生成正式建议。
- `create-candidate` 与 `validate-and-record` 在读取候选及查询前按当前 C06 授权空间限定目标；补充越界空间的无副作用回归。
- C27 合成夹具经协调端提供的 C25/C26 参数化接缝注入单一有效映射，并覆盖可通过、缺映射和措施未覆盖目标三种情况。协调端预先批准的旧迁移 down、基础授权夹具与迁移清单接缝均作为输入状态核验，未在本任务内回滚。

## 限定审计

- 触发范围：本轮修改了候选/查询的当前空间授权过滤及正式建议触发校验；按收尾协议仅安排一次限定审计，重点核对来源不可枚举、事务/并发唯一性、Agent 越界和失败候选无法强制放行。
- 结论：**PASS**。已独立审阅 `PostgresRecommendationContextReader.readFrozenContext/#loadWarning`、`measureCandidates`、`createCandidate/#bindAgentResult`、`validateAndRecord/#validateAndRecordCommit/#requestReview`、C08 增量收口、`000045` 的唯一约束和只追加权限，以及既有 PostgreSQL 行为测试。
- 发现并修复：`measureCandidates` 命中已有冻结集时曾直接返回，跳过 C03 回执与审计，同一 `queryId` 改用另一条关联评估还可能成功。现共用包含原始查询载荷的原子命令；复用时也生成回执与审计，同键异载荷被 C03 拒绝。多预警 PostgreSQL 用例新增同键改载荷及另一命令复用的回归断言。
- 发现并修复：关联预警原先在读取正文后才检查空间。现将获准空间加入读取 SQL；不存在或越界的关联预警统一返回 `AUTHORIZATION_DENIED`，不会读取越界正文。未更改 C06 权限策略或上游事实。
- 事务与状态边界：C27 四表仅授予应用角色 `SELECT, INSERT`，候选、校验及正式记录有精确外键/唯一约束；C03 回执、业务事实、C07 审计在同一事务中提交，审计约束失败回滚测试及并发唯一测试通过。C08 增量只接受冻结措施身份和顺序；三项校验失败仅请求 C07 复核，不生成正式建议或采纳事实。
- 限定审计实际命令：`pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`（13 项通过）；最终改动后 `pnpm exec vitest run packages/core/test/recommendation/recommendation.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`（26 项通过）；`pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false`、`pnpm exec eslint packages/adapters/src/recommendation/postgres-recommendation-adapter.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`、`pnpm exec prettier --check packages/adapters/src/recommendation/postgres-recommendation-adapter.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`、`openspec validate deliver-response-recommendation --strict --no-interactive`、`git diff --check` 均通过。

## 后续注意事项

- PostgreSQL 纵向测试使用真实 C25/C26/C04/C03/C07/C08 容器链；C19 读取端按公共 `AssessmentBasisReleaseSetReaderV1` 和成员摘要构造夹具，未声称覆盖 C19 生产服务。配置与监测输入为合成样本，待甲方复核。
