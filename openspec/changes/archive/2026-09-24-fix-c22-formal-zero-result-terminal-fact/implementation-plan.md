# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`2d470d2ffece7ba8cbf288ecdd022f33b9c6a684`。开工先核对当前 HEAD 和计划符号；base 后若 C02/C22/C24 接缝漂移，暂停并升级。
- 实际 schema：`orchestrated-delivery`；本 change 的三个 delta spec、`design.md` D-01～D-08 和已归档 C22/C24 主规格是行为事实源。研究资料仅 `references/风险识别与评估规划事实源摘要.md`。当前代码用于定位实现现状。
- 直接依赖：C01 共享记录、C02 识别端口/阶段引用、C03 事务审计、C04 工件、C05 授权、C10 结构化模型网关、C21 五项上下文、C22 候选收口、C24 识别图。无新依赖；`000049` 为唯一新迁移。
- 施工顺序：IP-01 公共引用与输出形状 → IP-02 C22 正式零结果与幂等 → IP-03 PostgreSQL 约束与回读 → IP-04 C24 图、恢复与汇总 → IP-05 跨接缝回归和静态检查。每个 IP 的测试只断言稳定类型、引用、行/事件/审计结果和恢复终态。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `versionedRef`、`IdentificationAnalysisSuccessV1Schema`；`packages/contracts/src/workflows/index.ts` 的 `IdentificationStageResultV1Schema` | 增加一类精确引用及闭合结果分支，原非空分支保持可读 | 不定义第二套工序/风险记录字段 |
| IP-02 | C22 `RiskCandidateModelOutputV1Schema`、`#assembleAndInfer`、`#persistRows`、`RiskCandidateFinalizationResultStoreV1`；Worker `createRiskCandidateModelRuntime` | 初次合法空输出单独收口，沿原 C04/C03/C05/C10 接缝 | 不复刻模型网关、事务、审计或授权 |
| IP-03 | `PostgresRiskCandidateFinalizationAdapter` 的 `resultColumnsFor`、`resultRowFromDbRow`、`readResult`；`000042` 的八类 CHECK | 增量扩展同表，保持追加式和严格回读 | 不复制或重建既有登记表、标准化记录表 |
| IP-04 | C24 `stageI4`、`stageI6`、`stageI9`、`summarizeIdentificationRun`、`IdentificationGraphRunStateV1Schema`、`IdentificationGraphRunResultV1Schema`、`IdentificationGraphRegistrationStoreV1`、adapter `readRow`/`readBody`、runtime 检查点对账 | 零结果走阶段事实/游标/I9；复用现有授权精确登记和正文读，给 C36 一个 C24 公开的完成结果窄读 | 不把零事实塞进 checkpoint 正文或合并算法，不让 C36 读 C24 私表 |
| IP-05 | 现有 C22/C24 夹具、真实 PostgreSQL 迁移测试及根脚本 | 在既有测试文件加入代表性边界，运行最小相关检查 | 不造新测试框架、不锁定提示文案 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | `识别工作流具有 I0 至 I9 的版本化阶段契约` / `I4 返回正式零结果引用`；C22 `合法零候选形成正式终态` | `packages/contracts/src/ports/index.ts` 的 `IdentificationAnalysisSuccessV1Schema`；`packages/contracts/src/workflows/index.ts` 的 `IdentificationStageResultV1Schema`；`packages/contracts/test/module-interfaces-events-workflows.test.ts` | 定义 `IdentificationZeroResultRefV1Schema`、分析 `zero-result` 分支；I4 原候选引用或零结果引用加工作项引用恰一，旧候选阶段正文仍可解析；增加闭合联合测试 | 非空分支、其它阶段和事件结构 |
| IP-02 | 2.1 | C22 `风险候选只从冻结五项上下文生成` / `精确上下文生成候选`、`合法零候选形成正式终态`、`上下文或模型输出不合格` | `packages/core/src/identification/candidate-finalization/schema.ts` 的 `RiskCandidateModelOutputV1Schema`、`RiskCandidateFinalizationResultRowV1Schema`；`packages/core/src/identification/candidate-finalization/service.ts` 的 `#assembleAndInfer`；`apps/worker/src/identification/candidate-finalization/runtime.ts` 的 `createRiskCandidateModelRuntime` | 只把初次合法空数组分到 `RiskCandidateZeroResultV1Schema`；注册 C04 目的、冻结引用、原始响应和用量；非空仍建候选集，修正轮次空输出失败 | `RiskCandidateSetV1.candidates.min(1)`、I5 校验和五项上下文资格 |
| IP-02 | 2.2 | C22 `零结果作为可重放且受授权约束的识别终态事实` / `重放与当前权限`、`同键异载荷或撤权`、`工件或业务事务失败` | C22 `ports.ts` 的 `RiskCandidateFinalizationResultStoreV1`、`service.ts` 的 `#persistRows` 与新增 `readZeroResult`；`packages/core/test/identification/candidate-finalization.test.ts`、`apps/worker/test/identification/candidate-finalization/runtime.test.ts` | 按 D-03 稳定请求摘要/身份预读同命令零事实；读取前后复验当前授权；C04 成功后 C03 同事务登记、回执、审计；核心/Worker 测试覆盖空输出、非空回归、幂等、失败 | 不在零路线上生成风险记录/Outbox，不缓存旧权限 |
| IP-03 | 3.1 | C22 正式零结果 requirement 的全部三个场景 | `packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts` 的 `kindColumnsFor`、`resultRowFromDbRow`、`readResult` 及命令预读；新增 `packages/adapters/src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.ts` | 新增 `zero_result_ref` 可空列、九类严格 CHECK、JSON 对象 CHECK、零结果 `(project_id,command_id)` 部分唯一索引；原表 INSERT/SELECT 列映射和精确预读 | `000042`、原八类组合、角色授权、标准化记录表 |
| IP-03 | 3.2 | C22 `重放与当前权限`、`同键异载荷或撤权`、`工件或业务事务失败` | `packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`；`packages/adapters/test/postgres/postgres-foundation.test.ts`；`packages/adapters/test/auth/fixture.ts` | 真实 PostgreSQL 验证旧行、新行、异摘要、并发、权限、事务回滚和 up/down/up 安全条件；同步迁移 manifest 与 fixture | 不写大段迁移 snapshot |
| IP-04 | 4.1 | `I4 与 I5 只从正式五项上下文生成并校验候选` / `工作项候选通过校验`、`可修正错误有界闭环`、`不可修正候选失败不伪装人工复核`、`零结果工作项结束且其它工作项继续` | `apps/worker/src/identification/graph/graph.ts` 的 `stageI4`、`advance`、`stageI5`、`stageI6`；`apps/worker/src/identification/graph/composition.ts` 的 `finalizationService` Pick；`apps/worker/test/identification/graph/fixture.ts`、`runtime.test.ts` | 对零分支用 C22 `readZeroResult` 核对正式事实，I4 落阶段结果并清除上一项候选图状态，再推进下一工作项；I5 不执行该项；I6 只看 I5 已校验引用 | 不伪造 `validatedCandidateSetRef`、不改变非空阶段顺序 |
| IP-04 | 4.2 | `I9 汇总明确区分每个工作项和分组终态` / `部分成功形成可解释汇总`、`仍有待复核组`、`全部工作项为正式零结果`、`零结果与候选工作项并存`；domain `I4 返回正式零结果引用` | `packages/core/src/identification/graph/schema.ts` 的运行状态/结果 Schema；`packages/core/src/identification/graph/service.ts` 的 `IdentificationGraphWorkItemOutcomeV1`、`summarizeIdentificationRun`；`apps/worker/src/identification/graph/{graph,runtime}.ts` 的 I9/恢复；`packages/core/test/identification/graph.test.ts`、`apps/worker/test/identification/graph/runtime.test.ts` | `zeroResults` 工作项/ref 配对且历史缺省空；汇总一项一终态；恢复重新证明 C22 正式事实，混合/全零保持完整性；记录与事件仍只来自实际验收 | 不把零结果计作失败/跳过/已验收记录，不从 checkpoint 生造事实 |
| IP-04 | 4.3 | C24 `I9 汇总明确区分每个工作项和分组终态` / `冻结运行的零结果覆盖证明` | `packages/core/src/identification/graph/ports.ts` 的 `IdentificationGraphRegistrationStoreV1`；`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` 的 `IdentificationGraphRegistrationStore`、既有 `readRow`/`readBody`；`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`；`apps/worker/test/identification/graph/runtime.test.ts` | 新增 `readCompletedRunResult` 精确只读：C05 复验、run-result 登记及 C04 正文核对、最新 run-state completed/resultRef 核对、返回前再复验；全零运行与冻结计划逐项对应、C22 `readZeroResult` 均有效且 accepted/其它终态为空时，供 C36 得出本运行无 accepted 的证明；混合、旧运行、缺证、撤权、损坏均失败闭合 | 不新增权限值、C24 D-07/D-15 语义、跨模块私表访问或“工程无风险”结论 |
| IP-05 | 5.1 | domain `识别正常完成`、`多资料版本形成单个可重放准备快照`、`拒绝不完整或错配的资料段集合引用`、`知识未就绪时暂停`、`争议合并组不阻塞其它组`、`必经检索审阅失败不降级`；C22/C24 其余原场景 | 仅本表已有测试文件 | 运行相关 C02/C22/C24 回归和类型、格式、依赖边界及 OpenSpec 严格校验；失败按根因修复当前 IP 范围 | 不新增生产文件、依赖或跨模块私表读取 |

## 4. 调用与副作用顺序

1. `analyze(assemble-and-infer)` 解析 C02 命令 → C05 当前授权 → C21 正式五项上下文与冻结策略精确读取。任何拒绝先于 C10 输入披露。
2. 按 D-03 请求摘要和命令身份，通过 C22 追加登记精确预读已有零事实；同载荷且当前授权有效时回放，异载荷冲突。无零事实时以原调用身份调用 C10。C10 已登记非空输出重放仍走原路径。
3. 只有结构化成功且候选数为 0、未超预算时写 C04 `RiskCandidateZeroResultV1` 正文；同 ref 异内容由 C04/登记摘要拒绝。随后以非空候选注册的**同一** C03 命令类型、命令/幂等身份在单事务内登记行、回执、审计，零/非零并发不得双成立；数据库失败不得返回零结果 ref，未提交 C04 工件按既有回收。
4. C24 I4 接受类型化零结果，C22 `readZeroResult` 在同一收窄授权下验证工程、输入、工作项、正文摘要，C24 同事务登记阶段结果与运行游标。I4 零结果直接处理下一工作项；无剩余项且无校验集则 I6 直达 I9。
5. 恢复先以 C24 阶段与运行登记重建状态，再复验零结果；任何不存在、撤权、摘要/版本不一致停止，不用 checkpoint 自己的引用补写。I9 核对计划中每个工作项恰有一种终态，再保存汇总。
6. C36 以后按精确 `runResultRef` 经 C24 `readCompletedRunResult` 取得已完成 I9 正文，经 C24 现有授权工作计划读确认冻结计划逐项对应 `zeroResults[]`，再经 C22 `readZeroResult` 逐项复验；仅所有计划项均为零、汇总的 accepted/事件及其它终态均空时证明该运行范围无 accepted。任一步缺失、撤权或错配都失败闭合。

## 5. Schema、状态与持久化落实

- D-01/D-02：C02 `IdentificationAnalysisSuccessV1Schema` 新 `zero-result`；I4 阶段字段恰一的根 Schema 校验；非空 `RiskCandidateSetV1` 下限不动。`RiskCandidateZeroResultV1Schema` 只归 C22，不复制共享风险记录字段。
- D-03/D-04：`zeroResultRef` 由工程、工作项和冻结请求摘要导出；C22 C04 正文与 PostgreSQL 登记互相校验。现有 `RiskCandidateFinalizationResultStoreV1` 只增加按工程+命令身份预读零事实，`readZeroResult` 是受 C05 控制的 C22 窄读，不暴露数据库。
- D-05：C24 游标/运行结果存 `zeroResults: {workItemRef,zeroResultRef}[]`；I4 结果存零引用，历史字段缺省读作空。每个计划项在 `summarizeIdentificationRun` 中只能是 accepted/zero-result/skipped/failed 一种；零事实不在 I5/I6 集合。C24 `readCompletedRunResult` 只读端口复用登记、C04 正文与 C05 当前授权，供 C36 读取完成汇总；checkpoint 仍仅保存现有小型图状态引用。
- D-06：只新增 `000049`，原子修改 `identification_finalization_results_kind_ck` 与 `_json_ck`、新增 `zero_result_ref` 和零结果部分唯一索引。原八类约束不放宽；`down` 有已成立零行时拒绝。`packages/adapters/test/auth/fixture.ts` 导入新迁移并追加生产路径，`packages/adapters/test/postgres/postgres-foundation.test.ts` 追加 `000049_risk-identification_fix-c22-formal-zero-result-terminal-fact_formal_zero_result`（sequence 49）发现条目；真实 PostgreSQL 证据覆盖 up/up、无零行 down/up、有零行拒绝 down 且保留可读版本。
- D-07/D-08：权限沿原 `risk-identification.run`，无新 capability；日志/审计只含 ref、摘要、版本、用量；无需新 dependency。工作区不启动服务、不提交、不归档。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| C22 `精确上下文生成候选`；`上下文或模型输出不合格` | IP-01, IP-02 | `packages/core/test/identification/candidate-finalization.test.ts`; `apps/worker/test/identification/candidate-finalization/runtime.test.ts` | 固定结构化响应与冻结五项上下文 | 非空原引用不变；解析/越界为失败 | `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts apps/worker/test/identification/candidate-finalization/runtime.test.ts` |
| C22 `合法零候选形成正式终态` | IP-01, IP-02, IP-03 | 同上及 `packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts` | `candidates: []`、C10 原始响应、真实 C04/C03 | 精确零事实、无候选/记录/事件 | `pnpm exec vitest run apps/worker/test/identification/candidate-finalization/runtime.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts` |
| C22 `重放与当前权限`；`同键异载荷或撤权`；`工件或业务事务失败` | IP-02, IP-03 | C22 core/adapter 现有测试 | 合成固定命令、撤权、冲突与故障注入 | 不重调模型；一行一回执/审计；失败无正式 ref | `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts` |
| C24 `工作项候选通过校验`；`可修正错误有界闭环`；`不可修正候选失败不伪装人工复核` | IP-04, IP-05 | `apps/worker/test/identification/graph/runtime.test.ts` | 既有非空与失败夹具 | 阶段/路由不漂移 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` |
| C24 `零结果工作项结束且其它工作项继续`；`全部工作项为正式零结果`；`零结果与候选工作项并存` | IP-04 | C24 core/worker 现有测试 | 合成工作计划、合法零/非零响应、真实图 | I4 正式引用，零不进 I5，I9 完整且无虚假记录/事件 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| C24 `冻结运行的零结果覆盖证明` | IP-04 | `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`; `apps/worker/test/identification/graph/runtime.test.ts` | 真实 PostgreSQL/C04 完成运行、冻结工作计划、全零/混合/旧运行及撤权或损坏引用 | 精确结果读与工作计划/C22 零引用逐项核对；仅全零且无 accepted/事件/其它终态可证，异常失败闭合 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| C24 `部分成功形成可解释汇总`；`仍有待复核组` | IP-04, IP-05 | C24 core/worker 现有测试 | 混合组与待复核夹具 | 已成立结果与等待不互相吞并 | `pnpm exec vitest run packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| domain `I4 返回正式零结果引用` | IP-01, IP-04 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`; C24 runtime 测试 | I4 两种闭合 DTO 与恢复 | ref 恰一、旧 I4 可读、重放可追溯 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| domain `识别正常完成`；`多资料版本形成单个可重放准备快照`；`拒绝不完整或错配的资料段集合引用`；`知识未就绪时暂停`；`争议合并组不阻塞其它组`；`必经检索审阅失败不降级` | IP-05 | 既有 C02/C24 测试 | 既有合成夹具 | 非零及其它阶段回归 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/identification/graph.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| D-06 迁移旧行、新行、权限、重复应用及回滚 | IP-03 | `packages/adapters/test/postgres/postgres-foundation.test.ts`; C22 adapter 测试 | 真实 PostgreSQL 全迁移链 | 八类旧行有效，零类 CHECK/权限生效，有事实时 down 拒绝 | `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts` |
| 类型、格式、依赖与 spec 完整性 | IP-05 | 本 change 所有计划文件 | 已完成 IP-01～04 | 无类型/格式/依赖违规，OpenSpec 严格有效 | `pnpm typecheck`; `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/src/workflows/index.ts packages/core/src/identification/candidate-finalization packages/core/src/identification/graph apps/worker/src/identification/candidate-finalization apps/worker/src/identification/graph packages/adapters/src/identification/candidate-finalization packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts packages/adapters/src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact`; `pnpm deps:check`; `openspec validate fix-c22-formal-zero-result-terminal-fact --strict --no-interactive` |

## 7. 文件清单与升级条件

- 新增：`packages/adapters/src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.ts`。
- 修改：`packages/contracts/src/ports/index.ts`、`packages/contracts/src/workflows/index.ts`、`packages/core/src/identification/candidate-finalization/{schema,ports,service}.ts`、`packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts`、`apps/worker/src/identification/candidate-finalization/runtime.ts`、`packages/core/src/identification/graph/{schema,service,ports}.ts`、`packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`、`apps/worker/src/identification/graph/{graph,runtime,composition}.ts`、`packages/adapters/test/auth/fixture.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`packages/core/test/identification/{candidate-finalization,graph}.test.ts`、`packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`、`packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`、`apps/worker/test/identification/candidate-finalization/runtime.test.ts`、`apps/worker/test/identification/graph/fixture.ts`、`apps/worker/test/identification/graph/runtime.test.ts`。
- 删除：无。保持不动：已归档主规格、`000042`/`000043`、C05 权限矩阵、C10 模型协议、C07 复核端口、标准化风险记录 Schema/事件、锁文件、API/Web。
- 任一计划符号或文件相对 base 漂移、现有迁移序号被占用、需要改变其它公共字段/权限/事务/持久化、需要额外迁移或依赖、或矩阵命令不存在，立即升级；实现者不得自行补设计。普通测试失败在当前 IP 范围修复。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在上述文件清单与 D-01～D-08 已批准语义内修正普通缺陷、补现有测试并回归，不得扩大公共语义、迁移或权限。重点检查两条真实路径：合法零候选经 C10→C04→C03→C24 I4/I9 且没有虚假候选/事件；解析失败/撤权/回滚不能转正。D-04/D-06 涉及权限与事务，默认触发一次限定审计；审计在同一 verification 工件记录最终结论。verification 仅由 Finalizer 在固定实施检查点后创建。
