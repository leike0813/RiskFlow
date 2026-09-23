# Implementation Plan

## 1. 实施基线与权威来源

- 初轮施工基线：`15ddd1ad40782574fb67351a68955fcc852762a8`；本次重开规划的固定代码基线（输入 HEAD）：`f8e61573bbe87fd192fd0385f0bd55ed22e15a9b`，批准凭据为 `approval://riskflow/C24/scope-2026-09-23-i0-i1-stage-result-and-dependency-exception`。Implementation Agent 从协调端审阅后的规划检查点启动，先确认该检查点以本次输入 HEAD 为祖先，且 IP-22～IP-25 所列符号仍与本基线一致；漂移先升级，不按旧行号猜测。
- OpenSpec 权威来源：本 change 的 `proposal.md`、`specs/identification/graph/spec.md`、`design.md`；既有主规格以 `openspec/specs/` 为准。
- 唯一研究输入：`references/风险识别与评估规划事实源摘要.md`。Implementation/Finalizer 不重新解释研究原件。
- 契约事实源：`packages/contracts/src/workflows/index.ts` 的 `IdentificationPreparationSnapshotV1Schema`、`IdentificationInputSnapshotV1Schema`、`IdentificationStageResultV1Schema`、`IdentificationGraphStateV1Schema`；`packages/contracts/src/ports/index.ts` 的 `RiskIdentificationPortV1`、`WorkflowPortV1` 及现有命令/引用/错误信封。
- 上游实现事实源：C17 识别基础与策略提供者、C21 上下文服务、C22 候选收口服务、C23 人工复核组合、C03 事务单元与 PostgreSQL checkpointer、C04 ArtifactStore、C05 授权和 C06 审计/Outbox。
- 直接依赖决定：仅 `apps/worker` 新增精确 `@langchain/langgraph@1.4.17`。实现前后分别运行 `pnpm install --lockfile-only` 所需的仓库标准安装流程、`pnpm deps:policy`、`pnpm licenses:check`、`pnpm security:check`；不得改动现有 `@langchain/core@1.2.9`、`@langchain/langgraph-checkpoint@1.1.5`、`@langchain/langgraph-checkpoint-postgres@1.0.5`。
- Apply 前置工件完成标准是 proposal/specs/design/implementation-plan/tasks 全部 done；本 change 不在 planning 阶段创建 verification。
- 本次重开只追加 IP-22～IP-25；初轮 IP-01～IP-21 的完成勾选保留历史记录，新增任务在实现与回归证据成立前保持未勾选。批准范围中的 actor 读取与取消事务修复已在输入 HEAD，重开只要求其回归，不再设计权限或事务变化。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/workflows/index.ts` 的识别准备、输入、I0～I9、图状态 Schema | 所有边界 parse 后再处理，graph state 只保留该 Schema 允许的引用 | 不在 core/worker 重定义公共 DTO、阶段名或状态字段 |
| IP-02 | `packages/contracts/src/ports/index.ts` 的 `RiskIdentificationPortV1`、`WorkflowPortV1` 与引用 Schema | C24 内部 runtime 适配既有命令语义；C30 后续负责公开父工作流入口 | 不新增 workflow type、公共命令、错误码或 capability |
| IP-03 | `packages/core/src/identification-knowledge/` 的 `IdentificationPolicySetProviderV1` 与基础解析；C17 adapter/composition | 精确解析双时间识别基础和已审核策略引用 | 不复制知识发布、适用性或版本选择算法 |
| IP-04 | `packages/core/src/identification/context/` 的 `IdentificationContextInputReaderV1`、`HybridRetrievalPolicyReaderV1`、`IdentificationContextService`；Worker `createIdentificationContextComposition` | C24 提供 reader，逐工作项调用完整 C21 服务 | 不复制关系、双索引、Agent 审阅、五项上下文逻辑 |
| IP-05 | `packages/core/src/identification/candidate-finalization/` 的 `IdentificationWorkPlanReaderV1`、`RiskCandidatePolicyProviderV1`、`RiskCandidateFinalizationService.analyze/finalize/prepareReviewRevision`；Worker C22 composition | C24 提供 work-plan reader，按工作项分析、按全运行收口、逐组验收 | 不复制 RI-S57、校验、修正、合并、置信度或正式记录事务 |
| IP-06 | `apps/worker/src/identification/human-review/composition.ts` 与 C23 `review.review-resolved.v1` | 精确消费决定并恢复 `resumeRunRef` 对应组 | 不解释或改写人工决定，不新建复核存储 |
| IP-07 | `packages/adapters/src/postgres/` 的 `TransactionUnitV1`、`IdempotentConsumerV1`、`createPostgresCheckpointer`；C04/C05/C06 ports | 业务事实事务先提交，checkpoint 后写；恢复时按业务事实对账 | 不跨业务/checkpoint schema 建原子事务，不读上游私表 |
| IP-08 | `packages/core/src/persistence/` 的规范摘要/幂等辅助与现有 C21/C22 追加登记模式 | 派生稳定 ID、请求摘要并实现同载荷重放/异载荷冲突 | 不新增另一套 hash、clock 或幂等框架 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-09 | 核心 Schema 与类型化结果 | 全部 Requirement；D-03/D-10 | 新增 `packages/core/src/identification/graph/schema.ts`、`ports.ts`、`index.ts` | 定义仅包内使用的策略目录、工作计划正文、登记行、运行结果、等待/错误判别联合与 `IdentificationGraphRuntimeV1`；导出 C21/C22 reader 所需实现类型 | `packages/contracts/**` 与公共错误信封 |
| IP-10 | 冻结输入和计划 | “I0 至 I2…”全部场景；D-03 | 新增 `packages/core/src/identification/graph/service.ts` 的 `resolveIdentificationInputSnapshot`、`buildIdentificationWorkPlan` | 从精确准备/知识/策略形成单一快照；稳定排序全量适用工序并派生工作项/计划 ID；缺项整体阻断 | 不接受自由正文、“最新版”、隐式默认或部分计划 |
| IP-11 | 运行终态与错误路由 | “I9…”、“图节点只组合…”全部场景；D-03/D-10 | 同一 `service.ts` 的 `classifyIdentificationGraphOutcome`、`summarizeIdentificationRun` | 仅按稳定 code/retryable 分类；完整检查工作项/分组终态后生成 I9 | 不匹配文案，不把 waiting/失败变成空成功 |
| IP-12 | 业务登记与精确 reader | “业务运行事实…”全部场景；D-04/D-06/D-07 | 新增 `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`index.ts` | 实现 C24 追加登记/回读、C21 input reader、C22 work-plan reader、当前授权复验、C04 digest 核对和 checkpoint 引用对账 | 不读取 C17/C21/C22/C23 私表，不保存正文或 graph state |
| IP-13 | C24 迁移 | “业务运行事实与 LangGraph 检查点严格分离”全部场景；D-06 | 新增 `packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts` | 创建 `business.identification_graph_results`、判别 check、主键/唯一与条件索引、延迟审计外键、SELECT/INSERT 最小授权和对称 down | 不改 C03 checkpointer、既有迁移或现有表 |
| IP-14 | I0～I9 StateGraph | I0～I9 全部 Requirement；D-02/D-05/D-08 | 新增 `apps/worker/src/identification/graph/graph.ts` | 用真实 `StateGraph` 定义 I0～I9 节点、条件边、顺序工作项/分组游标和 interrupt；节点只调用 IP-10～IP-12、C21、C22、C23 | 不自研第二状态机，不做未批准并发扇出，不复制领域算法 |
| IP-15 | 启动、恢复、重试、取消 | “启动、恢复、重试与取消…”全部场景；D-01/D-05/D-07/D-09 | 新增 `apps/worker/src/identification/graph/runtime.ts` | 实现内部 `start/resume/cancel`、状态版本 CAS、同线程恢复、冻结重试、业务提交后 checkpoint 对账和协作取消 | 不消费 inputs-ready 自主创建父运行，不改变冻结版本 |
| IP-16 | 恢复消费者与组合根 | I3 Agent 暂停、I8 人工恢复、重复信号场景；D-01/D-05 | 新增 `apps/worker/src/identification/graph/composition.ts`、`index.ts`；修改 `apps/worker/src/index.ts` | 注入 C03/C04/C05/C06、C17/C21/C22/C23 与策略目录；用 `IdempotentConsumerV1` 处理精确 Agent 完成和 review-resolved 信号 | 不创建替代 Agent/复核任务，不从 correlationId 猜运行引用 |
| IP-17 | 子路径导出 | 所有调用方；D-12 | 修改 `packages/core/package.json`、`packages/adapters/package.json` | 分别增加 `./identification/graph` 导出；adapter index 只再导出公开构造器 | 不扩大根导出或引入环依赖 |
| IP-18 | 依赖治理 | D-11 | 修改 `apps/worker/package.json`、`pnpm-lock.yaml`、`config/dependency-policy.json` | 精确加入 `@langchain/langgraph@1.4.17`，登记用途/许可证/移除条件并保持现有 peer 解析 | 不加 override，不升级或降级其它依赖 |
| IP-19 | 核心行为验证 | I0～I2、I9、错误路由；D-12 | 新增 `packages/core/test/identification/graph.test.ts` | 表格驱动覆盖快照版本组合、计划完整性/稳定 ID、全部终态、waiting 与结构化错误分类 | 不断言完整错误文案或内部调用顺序 |
| IP-20 | PostgreSQL 与权限验证 | 业务/checkpoint 分离、幂等/权限场景；D-04/D-06/D-07 | 新增 `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`；修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts` | 真实 PostgreSQL 覆盖迁移、追加权限、同键重放/冲突、reader 授权与 digest、checkpoint 缺失/伪引用 | 不用 mock DB 代替事务证据 |
| IP-21 | 真实图运行验证 | I3～I8、启动/恢复/取消；D-02/D-05/D-08/D-12 | 新增 `apps/worker/test/identification/graph/runtime.test.ts`、`composition.test.ts`、`fixture.ts` | 使用真实 LangGraph 与 PostgreSQL checkpointer，注入可控公开端口，覆盖成功、部分失败、Agent/人工等待、重复/迟到恢复、checkpoint 写失败对账、取消 | 不锁定节点内部调用序列，不用 LLM 文本作硬期望 |
| IP-22 | I0/I1 阶段登记形状与数据库约束 | “I0 至 I2…”/“工作计划形成前的阶段结果可精确回读”；D-06/D-15 | `packages/core/src/identification/graph/schema.ts` 的 `IdentificationGraphResultRowV1Schema`；`packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts` 的 `kindPairing`、`kindPairings`、`up` | 仅将 `stage-result.workPlanRef` 设为可选；SQL 同类固定 `stage_result_ref` 非空且 `work_plan_ref` 可空；新建/已存在 C24 表的同名 check 收敛且 `up` 重入不改变其它约束或授权 | 不新增迁移、类别或列；其它七类组合、主键、索引、角色与权限保持原样 |
| IP-23 | I0/I1 阶段结果登记 | 同上；D-02/D-07/D-15 | `apps/worker/src/identification/graph/graph.ts` 的 `advance`、`stageI0`、`stageI1` | I0 与成功 I1 将已有 C04 阶段正文连同 `stage-result` 行及 `run-state` 在原事务内登记；I1 同事务另登记输入快照；计划未形成时不传 `workPlanRef`，I2～I9 仍强制现有冻结引用，重放沿用稳定动作身份 | 不改 I1 waiting/失败路由，不补造工作计划或复制上游结果正文 |
| IP-24 | 新允许组合、登记与既有审计修复回归 | 同上及“业务运行事实…”、“启动、恢复、重试与取消…”授权/取消场景；D-09/D-15 | `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` 的 `resultRowFor` 与真实 PostgreSQL fixture；`apps/worker/test/identification/graph/runtime.test.ts` 的 I0～I2、授权及取消场景 | 在允许的现有测试文件中覆盖迁移 `up` 重入、stage-result 有/无计划允许、缺 `stage_result_ref` 与其它类别越界拒绝、I0/I1 可回读和同键重放；运行 actor 授权与取消事务/竞态回归 | 不写迁移文本快照、内部调用序列或完整文案断言 |
| IP-25 | 精确依赖安装门禁例外核对 | D-11/D-12；本次批准记录第 2 项 | `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，`apps/worker/package.json` 的 `@langchain/langgraph`，`pnpm-lock.yaml` 与 `config/dependency-policy.json` | 确认已存在的例外恰为 `@langchain/langgraph@1.4.17`，与精确直接依赖/锁定版本一致，记录为本 change 文件；运行依赖策略、锁文件与许可证门禁 | 不更换版本、不新增包、不扩大例外到其它依赖 |

## 4. 调用与副作用顺序

1. `start` 先解析既有命令、复验 `workflow.start` 与项目/空间/资料授权，校验父运行和 C15 准备快照，再以命令回执的 `(projectId, commandType, idempotencyKey)` 查首次结果；同摘要返回原运行，异摘要返回不可重试冲突。每个后续业务登记由该命令/阶段动作再派生各自稳定幂等键。
2. 创建稳定子运行/thread ID；I0 通过 IP-12/C03 事务单元登记阶段事实与审计，再允许 LangGraph 写 checkpoint。此后每个节点沿用相同顺序。
3. I1 调 C17 精确解析基础和策略目录；只有完整同版本组合才由 IP-10 写 C04 输入正文并登记引用。I2 同法写完整计划；任一缺项不写半计划。
4. I3 按稳定工作项顺序调用 C21。若 Agent 未终结或效果未知，先登记 waiting，再 interrupt；终止失败只封闭该项，已完成项保持有效。
5. I4/I5 仅对具有正式五项上下文的项调用 C22 `analyze`；修正仍由 C22 原任务/预算完成。每项终态登记后移动游标。
6. 全部可处理项达到 I5 终态后，I6/I7 仅一次调用 C22 `finalize`，保存引用，不重算合并/置信度。
7. I8 按稳定组顺序提交自动组；人工组登记等待后继续其它组。Agent/review 信号先由幂等消费者去重和授权校验，再恢复原 thread/任务/组；修订走 C22/C23 已有重路由。
8. 所有项和组无运行中/效果未知动作时，IP-11 生成 I9 C04 工件，IP-12 登记 run-result、run-state、审计；等待、拒绝、失败和取消分别保留精确引用。
9. `cancel` 先校验 `workflow.cancel` 与预期状态版本，再登记 cancellation/run-state；仅阻止未开始动作。已提交上游事实、正式记录、事件、审计和 checkpoint 历史不回滚。
10. 任一业务提交后的 checkpoint 失败返回可重试技术错误；恢复用首次业务回执重建小型状态。任一 checkpoint 引用无法由当前授权下业务回读证明时封闭为 `CHECKPOINT_INCONSISTENT`，不补写事实。
11. 本次重开按 IP-22 先收敛 C24 的判别 Schema 与同名数据库 check，再按 IP-23 让 I0/I1 成功路径登记已有阶段正文；I0/I1 的行无工作计划引用，I2 起仍携带冻结计划。事务中的阶段行、运行状态行和 I1 输入行共享原命令/审计关联，各有独立幂等键。IP-24 在真实 PostgreSQL 上验证登记与重入，IP-25 核对已在输入 HEAD 的安装门禁例外；不重复安装依赖。

## 5. Schema、状态与持久化落实

- 公共状态仅使用 `IdentificationGraphStateV1Schema`；C24 内部联合在 IP-09 中严格解析，出入口 `safeParse/parse` 失败映射 `CONTRACT_INVALID`。状态只含引用、阶段、游标、等待/错误和版本，不含工件正文。
- I0～I9 的阶段结果使用 `IdentificationStageResultV1Schema`。逐项 I3/I4/I5 和逐组 I7/I8 的重复结果均以独立 C04 工件 + C24 stage-result 登记表达，状态只持当前/累计引用。
- `identification_graph_results` 的列、键、约束和角色授权必须逐项落实 D-06；同一命令可关联多类登记，各类使用独立派生幂等键，`run-state` 追加新版本而非 UPDATE。所有读取按 project + kind + id + version 精确命中后再读 C04。
- C24 表写入、命令回执和 C06 审计属于同一 C03 业务事务；需要 C24 自有事件时才写 Outbox。本 change 不新增领域事件，正式风险记录事件继续由 C22 原事务产生。
- `valid_at` 来自命令业务时刻，`recorded_at` 来自请求记录时刻，`persisted_at` 由数据库 clock；重放不得用墙钟改写任何身份。
- 权限沿用 D-09；数据库角色只给 app/outbox worker SELECT/INSERT，checkpointer 与 PUBLIC 无权。应用层先授权后查询，拒绝返回不可枚举错误。
- 迁移序号固定 `000043`，不得占用 `000044` 或修改历史迁移。中央迁移清单与权限 fixture 只做 IP-20 的机械登记。
- IP-22 的可选 `workPlanRef` 只属于 `stage-result` 登记判别；`stageResultRef` 仍必填。数据库在新建表和重入既有 C24 表时均以 `identification_graph_results_kind_ck` 检查同一允许集合，保留其余判别、JSON 对象校验、索引和 SELECT/INSERT 授权；若既有表或部署状态要求新增迁移文件，立即升级。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| I0～I2 / 合格准备形成单一输入和工作计划 | IP-10, IP-19 | `packages/core/test/identification/graph.test.ts` | 同工程准备、双时间基础、完整策略 | 唯一快照；工作项覆盖全部适用工序且引用同一组合 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts` |
| I0～I2 / 知识或策略未就绪时等待 | IP-10, IP-14, IP-21 | core + worker runtime | 未生效/停用/错工程/不兼容引用 | 类型化 waiting/失败；无半快照；恢复不换版本 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| I0～I2 / 工作计划不完整时拒绝 | IP-10, IP-19 | core | 缺空间/资料/查询依据 | `WORK_PLAN_INVALID`；无空项或部分计划 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts` |
| I3 / 全部工作项形成五项上下文 | IP-14, IP-16, IP-21 | worker runtime/composition | 多工作项 C21 正式结果 | 每项正式引用齐全后进 I4；排序分与置信度分离 | `pnpm exec vitest run apps/worker/test/identification/graph` |
| I3 / 单项检索审阅终止失败 | IP-14, IP-21 | worker runtime | 一项终止失败、另一项成功 | 失败项不进 I4；成功项与证据保留 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I3 / Agent 尚未完成时暂停 | IP-15, IP-16, IP-21 | worker runtime/composition | C08 running/unknown-effect | 原 task/thread/budget waiting；无替代任务 | `pnpm exec vitest run apps/worker/test/identification/graph` |
| I4/I5 / 工作项候选通过校验 | IP-14, IP-21 | worker runtime | C22 analyze 合格结果 | 候选/已校验集和原始工件引用保留 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I4/I5 / 可修正错误有界闭环 | IP-14, IP-21 | worker runtime | C22 可修正错误后成功 | 同模型/提示/上下文/预算；候选版本递增 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I4/I5 / 不可修正候选失败不伪装人工复核 | IP-11, IP-14, IP-21 | core + worker runtime | 权限/来源/规则/预算终止错误 | 工作项失败且不创建 review 路线 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| I6～I8 / 自动组和人工组并存 | IP-14, IP-21 | worker runtime | 自动组 + 人工组 | 自动组先入库；人工组 waiting；不重复已入库组 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I6～I8 / 人工决定恢复当前组 | IP-15, IP-16, IP-21 | worker runtime/composition | 精确 review-resolved + 重复事件 | 只恢复匹配组；重复信号同回执无副作用 | `pnpm exec vitest run apps/worker/test/identification/graph` |
| I6～I8 / 修订或分立决定重新进入确定性路线 | IP-14, IP-16, IP-21 | worker runtime | C23 修订/分立决定 | 复用 C22 重路由，不复制算法 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I6～I8 / 拒绝与退回保持阻断 | IP-14, IP-21 | worker runtime | 拒绝/退回组 + 合格组 | 当前组无记录；其它组完成 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| I9 / 部分成功形成可解释汇总 | IP-11, IP-19, IP-21 | core + worker runtime | 已验收/拒绝/失败混合终态 | I9 计数与精确引用一致、可回放 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| I9 / 仍有待复核组 | IP-11, IP-19 | core | 至少一个 waiting 组 | 保持 waiting，不生成 completed/空成功 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts` |
| 业务/checkpoint / 业务提交后检查点失败 | IP-12, IP-15, IP-20, IP-21 | adapter + worker runtime | PostgreSQL 事务成功、checkpoint 注入失败 | 业务事实保留；恢复回读首次提交；无重复副作用 | `pnpm exec vitest run packages/adapters/test/identification/graph apps/worker/test/identification/graph/runtime.test.ts` |
| 业务/checkpoint / 检查点引用不存在的业务事实 | IP-12, IP-20, IP-21 | adapter + worker runtime | 伪造/删除对应 C24 引用的 checkpoint | `CHECKPOINT_INCONSISTENT`；零补写 | `pnpm exec vitest run packages/adapters/test/identification/graph apps/worker/test/identification/graph/runtime.test.ts` |
| 业务/checkpoint / 业务事实同键异载荷冲突 | IP-12, IP-20 | adapter | 相同键不同摘要 | 首次行不变；不可重试冲突 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` |
| 启动恢复取消 / 相同启动命令幂等重放 | IP-12, IP-15, IP-21 | worker runtime | 同键同/异载荷 | 同载荷原 runRef；异载荷冲突 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| 启动恢复取消 / 当前授权撤销后停止推进 | IP-12, IP-15, IP-20, IP-21 | adapter + worker | 启动后撤销资料/空间权限 | 下一效果前拒绝；无无权正文或绕过 | `pnpm exec vitest run packages/adapters/test/identification/graph apps/worker/test/identification/graph/runtime.test.ts` |
| 启动恢复取消 / 协作式取消保留已成立事实 | IP-15, IP-21 | worker runtime | 部分组已提交后取消 | 停止未开始动作；既有记录/审计/事件保留 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| 接口/失败 / 上游公开端口返回业务等待 | IP-11, IP-14, IP-19, IP-21 | core + worker | 类型化上游 waiting | 图等待且不查私表 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| 接口/失败 / 可重试技术错误按冻结策略处理 | IP-11, IP-15, IP-19, IP-21 | core + worker | retryable 错误与冻结预算 | 原动作身份、预算内重试、已完成效果不重放 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| 接口/失败 / 终止错误封闭失败 | IP-11, IP-14, IP-19, IP-21 | core + worker | 权限/版本/契约/冲突 | 不可重试并保留诊断；无默认/人工绕过 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| 迁移、权限、依赖与全量回归 | IP-13, IP-17, IP-18, IP-20 | foundation/auth + 全仓 | 真实 PostgreSQL、更新锁文件 | 000043 可升降；角色最小权限；peer/lock/依赖边界成立 | `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm deps:check && pnpm deps:policy && pnpm licenses:check && pnpm security:check && pnpm exec openspec validate deliver-identification-graph --strict --no-interactive` |
| I0～I2 / 工作计划形成前的阶段结果可精确回读 | IP-22, IP-23, IP-24 | `apps/worker/test/identification/graph/runtime.test.ts` | 成功启动并推进 I0/I1/I2；真实 C04 + PostgreSQL | I0/I1 各一条阶段登记、均无计划引用且正文阶段正确；I2 起有同一冻结计划引用；同键重放不增行 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 --maxWorkers 1 -t 'I0～I2'` |
| D-15 / 000043 重入与 stage-result 允许/拒绝组合 | IP-22, IP-24 | `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` | 真实 PostgreSQL migrator 角色，对同一 C24 表直接执行 `up` 两次；参数化插入 | 两次后同名 check/索引/最小授权相同；无计划和有计划的 stage-result 均通过；缺阶段引用、其它七类越界均被数据库拒绝 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts --testTimeout 30000 --maxWorkers 1` |
| 已批准 actor 读取与取消事务修复回归 | IP-24 | `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`、`apps/worker/test/identification/graph/runtime.test.ts` | 当前/非当前 actor、收窄空间；同版本恢复/取消竞争和重放 | 受保护读取按当前 actor 复验且拒绝与不存在同形；取消与 run-state 同事务推进、竞争至多一方成功 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 --maxWorkers 1` |
| D-11 / 精确版本安装门禁例外 | IP-25 | `pnpm-workspace.yaml`、`apps/worker/package.json`、`pnpm-lock.yaml`、`config/dependency-policy.json` | 已批准 `@langchain/langgraph@1.4.17` | 排除项仅此精确版本；依赖/锁文件/策略一致，许可证与边界门禁通过 | `pnpm deps:policy && pnpm deps:check && pnpm licenses:check` |

## 7. 文件清单与升级条件

**新增：**

- `packages/core/src/identification/graph/{index,ports,schema,service}.ts`
- `packages/core/test/identification/graph.test.ts`
- `packages/adapters/src/identification/graph/{index,postgres-identification-graph-adapter}.ts`
- `packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts`
- `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`
- `apps/worker/src/identification/graph/{index,graph,runtime,composition}.ts`
- `apps/worker/test/identification/graph/{fixture,runtime.test,composition.test}.ts`

**修改：**

- `packages/core/package.json`
- `packages/adapters/package.json`
- `apps/worker/package.json`
- `apps/worker/src/index.ts`
- `packages/adapters/test/postgres/postgres-foundation.test.ts`
- `packages/adapters/test/auth/fixture.ts`
- `config/dependency-policy.json`
- `pnpm-lock.yaml`
- 本次重开实际允许修改：`packages/core/src/identification/graph/schema.ts`、`packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts`（仅同名 check 允许组合及重入收敛）、`apps/worker/src/identification/graph/graph.ts`、`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`、`apps/worker/test/identification/graph/runtime.test.ts`；若需联动，只可在 `apps/worker/src/identification/graph/**`、`apps/worker/test/identification/graph/**`、`packages/adapters/test/identification/graph/**` 内，并先核对 D-15 语义。
- `pnpm-workspace.yaml`：输入 HEAD 已包含精确 `minimumReleaseAgeExclude`，本次只纳入批准文件清单并核对，不要求重复改写。

**删除：** 无。

**本次重开规划工件：** 仅 `openspec/changes/deliver-identification-graph/specs/**`、`design.md`、`implementation-plan.md`、`tasks.md`。`proposal.md` 和已有 `verification.md` 作为输入，不在 Planning 阶段改写。

**保护：** `packages/contracts/**`、`openspec/specs/**`、C03/C15/C17/C21/C22/C23 既有生产文件及历史迁移、C30 范围的顶层 riskFlowGraph、API/Web/评估模块均不得修改。本次重开除上述精确允许文件外，初轮清单的其它文件也不因历史列入而自动获得新修改授权。

出现以下任一情况必须停止并 escalation：本次固定基线或上述复用符号漂移；需要新增/修改公共 DTO、事件、错误码、capability 或权限映射；需要变更 C03 checkpoint schema、事务边界、C04 工件契约、C24 `000043` 同名 check 之外的迁移语义或 C21/C22/C23 事实所有权；需要新增迁移、第二张 C24 表、回填、数据删除、外部服务或新依赖；需要更改顺序执行为并发；任何本次批准清单外生产改动。原初轮关于机械文件的宽泛例外不适用于本次重开。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在本 change 已批准文件清单内修复普通实现缺陷、补齐缺失稳定行为测试并运行全部命令；本次重开仅以 §7 精确允许文件及 D-15 语义为新修改边界，`000043` 同名 check 是唯一获批的迁移调整。不得修改公共契约、权限、依赖版本、其它迁移语义、父子运行所有权或扩大到 C30。验收必须从本次固定输入 HEAD 和协调端规划检查点核对 IP-22～IP-25，并复核 IP-01～IP-21 未漂移；读取 `openspec instructions apply --json` 的全部 `contextFiles`，确认新增 task 仅在行为与证据均成立后勾选，随后以最终 HEAD 更新现有 verification。

满足执行图规定的限定审计触发条件时，Auditor 只审计这些标签：`contract-boundary`、`authorization-non-enumeration`、`append-only-idempotency`、`checkpoint-reconciliation`、`agent-review-resume`、`dependency-supply-chain`。同一收尾轮次最多一次审计；Auditor 在自己的活动 Task 内修复范围内普通缺陷并回归，无法闭合则升级，不再派第二个 Finalizer/Auditor。
