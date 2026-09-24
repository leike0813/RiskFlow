# Implementation Plan

## 1. 实施基线与权威来源

- **固定 base commit**：`d4f926fd578648ab639153a5a44c6ee82cc2ca50`；实施前核对 `git rev-parse HEAD`，仅本 change 的规划检查点可在其后。C24 已归档主规格 `openspec/specs/identification/graph/spec.md`、本 change 的 delta 和 D-01～D-04 为行为与设计依据；当前生产代码用于接缝定位。
- **直接依赖**：已归档 C24 `deliver-identification-graph`、既有 C03 `platform/postgresql-outbox-checkpoint-foundation`。C30 检查点 `1ee42ebbf15968f7bb36df030937fae8afa5c7f6` 只作父节点调用方式的只读参照，尚未进入本 HEAD，不能当本 change 的实施基线。
- **规划期红证据**：先运行 `pnpm build` 后，用临时合成父子图测试两次执行 `pnpm exec vitest run apps/worker/test/identification/graph/c40-boundary-repro.test.ts`，分别得到父检查点 `running` 而期望 `waiting`、同 C24 命令重试 `CONTRACT_INVALID:graph-state-invalid`；临时测试已删除。另一个同容器诊断显示未绑定子 saver 时子线程检查点为零行，显式绑定子 saver 与根命名空间后有合法 `waiting` 检查点。实施必须以 IP-01 的正式测试重新取得改前红证据，不能只引用上述记录。
- **C30 门槛**：本 HEAD 上 `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts -t '真实 C24 与 C30 同容器'` 返回 `No test files found`，因为 C30 尚未集成。IP-04 的自包含真实父子图测试为当前必经证据；当 C30 进入同一实施/验收 HEAD 后，再按真实文件和标题运行其同容器验收，缺文件时记录为未运行而非 PASS。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `apps/worker/test/identification/graph/fixture.ts` 的 `startIdentificationGraphHarness`、`reviewRouteFor`；`packages/adapters/test/identification/graph/wiring.ts` 的 `setupPostgresCheckpointer` | 同容器真实 C24、C03 与最小父 `StateGraph` 复现 | 不造第二套 C24 业务夹具或复制数据库表访问到生产代码 |
| IP-02 | `apps/worker/src/identification/graph/graph.ts` 的 `createIdentificationGraph`、`IdentificationGraphRunnerV1`、`IDENTIFICATION_GRAPH_RUN_CONFIG_KEY_V1` | 在现有 runner 包装层统一绑定 C24 saver、根命名空间与同步持久化 | 不复制 StateGraph、C03 saver 或另建编排器 |
| IP-03 | `apps/worker/src/identification/graph/runtime.ts` 的 `runGraph`、`graphConfig`、`readCheckpointState`、`businessAheadOfCheckpoint`、`outcomeOf`；C24 core 的 `toWaitingRef`；adapter `reconcileCheckpointReferences` | 同一检查点与业务事实核对逻辑用于中断收口和重放 | 不复制等待映射、权限校验、C22 结果或 C03 事务逻辑 |
| IP-04 | `apps/worker/test/identification/graph/runtime.test.ts` 的等待、恢复、检查点失败用例；`packages/adapters/test/postgres/postgres-foundation.test.ts` | 扩展少量稳定行为断言并回归既有单图路径 | 不把 C30 未集成替身测试算作真实跨图通过 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | `父图调用识别子图时保持中断与检查点边界`／`嵌套识别运行进入人工复核等待`、`中断后同身份重试` | **新增** `apps/worker/test/identification/graph/nested-boundary.test.ts`，复用 `fixture.ts` | 先建真实 C03+最小父图红用例：同一父节点启动 C24 人工组，断言父/子等待与原命令重试，留失败输出 | 不在父节点捕获 C24 中断伪装成功；不更改 C30 |
| IP-02 | 2.1 | 同上、`原复核决定成立后恢复`、`子检查点缺失、错位或写入未确认`；D-01 | **修改** `apps/worker/src/identification/graph/graph.ts` 的 `createIdentificationGraph` | 用唯一配置构造把 `options.checkpointer`、`checkpoint_ns: ""` 绑定到 `invoke/resume/retry/recover/getState`；保留 `thread_id` 和 sync durability | 不更换 GraphState Schema、图拓扑或业务动作 |
| IP-03 | 3.1 | 全部五个 Scenario；D-02/D-03 | **修改** `apps/worker/src/identification/graph/runtime.ts` 的 `runGraph`、`readCheckpointState`、`start` 重放分支 | GraphInterrupt 时精确读取子状态、核对身份/等待/当前授权下的业务引用与最新运行游标，再返回现有等待结果；重放沿同一核对；缺失/错配按既有稳定错误封闭 | 不吞其它 bubble-up、改变授权顺序、补写业务事实或新建错误码 |
| IP-04 | 4.1 | 五个 Scenario；D-04 | **修改** `apps/worker/test/identification/graph/runtime.test.ts`；**完善新增** `nested-boundary.test.ts` | 验证复核决定恢复、重复/迟到信号、撤权、错误命名空间、子检查点写失败及数据库行数；回归单图 | 不断言错误全文、通道内部顺序或 C30 替身结果 |

## 4. 调用与副作用顺序

1. `start` 先按既有 C05 `workflow.start-run` 当前授权和 C03 命令回执核对命令身份，原有输入/工序/任务/候选/复核的阶段业务提交仍由各模块持有；IP-02 只改变 C24 图执行配置，不改变业务提交顺序。
2. C24 阶段提交等待运行事实后进入 `wait` 中断；IP-02 使其 checkpoint 落在子 `thread_id` + 根命名空间。IP-03 捕获该中断后，先读精确子检查点，再核对 C24 最新只追加运行状态、等待引用和当前授权下的 `reconcileCheckpointReferences`；仅一致时返回 `waiting`。父节点此时才能按自己的事务写父等待和父检查点。
3. C24 同命令重放先读原子检查点；状态与业务一致时返回同一版本，无新任务、审计、事件或风险记录。业务领先一节点时沿现有 `recoverCommittedBusiness`，检查点缺失或写未确认沿既有可重试技术错误，伪造/错位引用沿既有不可重试不一致错误；不从父图 checkpoint、原始中断对象或游标单独构造正式等待。
4. 复核决定成立后，`resume` 先验证原运行版本、等待种类/目标、当前授权与业务引用，再向原子线程发送 `Command.resume`。C24 与父图事务和 checkpoint 继续各自提交；取消和迟到信号保持已归档语义。

## 5. Schema、状态与持久化落实

- **SSOT**：`IdentificationGraphStateV1Schema`、`RiskFlowGraphStateV1Schema`、`WaitingRefV1` 和 C24 `IdentificationGraphRunStateV1Schema` 保持不变。业务等待与 checkpoint 等待用既有 `toWaitingRef` 对比精确种类及版本；不比较文案。
- **持久化/事务**：C03 `PostgresCheckpointer`、`langgraph_checkpoint` 表及角色不改；C24 `000043`、C22 迁移不改。业务登记、审计、Outbox 和检查点仍是原两步边界，D-02 不调用新写操作。
- **权限与失败**：`start/resume/cancel` 的 C05 当前授权复验、各窄读权限及不可枚举性保留。中断后缺 checkpoint 是基础设施未确认，身份/引用错配是检查点不一致；两类都不可被父图 catch 转成业务成功。保留既有错误码、幂等键和冻结版本。
- **依赖与迁移**：无新依赖、无安装/锁文件更新、无迁移、无回填；历史根命名空间 C24 检查点仍可读，无法证明的历史嵌套失败按原错误封闭。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| `嵌套识别运行进入人工复核等待` | IP-01/02/03/04 | `apps/worker/test/identification/graph/nested-boundary.test.ts` | 同容器 C03 父 saver、真实 C24，合成待复核组 | 父/子各自 `waiting`；子线程根命名空间检查点与原等待引用；业务行可核对 | `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts` |
| `中断后同身份重试` | IP-01/02/03/04 | 同上 | 首次已等待，同一命令/载荷 | 原 `runVersionId`、等待引用与结果；任务/审计/事件/风险行数不增 | 同上 |
| `原复核决定成立后恢复` | IP-02/03/04 | 同上及 `runtime.test.ts` | 精确决定版本与当前授权 | 原线程恢复、原冻结身份；重复/迟到信号无额外事实 | `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/identification/graph/runtime.test.ts` |
| `子检查点缺失、错位或写入未确认` | IP-02/03/04 | 同上及 `runtime.test.ts` | 定向故障注入、错误命名空间/引用 | 已提交业务不回滚、不补写；既有结构化失败类别 | 同上 |
| `权限收窄后拒绝跨图恢复` | IP-03/04 | 同上及 `runtime.test.ts` | C05 当前授权撤销 | 拒绝推进，不泄露对象是否存在 | 同上 |
| C24 单图与 C03 兼容 | IP-02/03/04 | `runtime.test.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts` | 现有真实 PG 回归 | 已归档等待/恢复和单图 saver 校验均通过 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` |
| 类型与 OpenSpec | IP-02/03/04 | 全部本 change 规划/源码 | 已完成 IP-01～03 | 类型与格式通过；spec delta 严格有效 | `pnpm typecheck && pnpm format:check && openspec validate fix-c24-nested-graph-interrupt-checkpoint-boundary --strict --no-interactive` |

## 7. 文件清单与升级条件

- **新增**：`apps/worker/test/identification/graph/nested-boundary.test.ts`。
- **修改**：`apps/worker/src/identification/graph/graph.ts`、`apps/worker/src/identification/graph/runtime.ts`、`apps/worker/test/identification/graph/runtime.test.ts`。
- **只读**：`apps/worker/test/identification/graph/fixture.ts`、`apps/worker/src/identification/graph/composition.ts`、`packages/adapters/src/postgres/checkpointer.ts`、C30 未集成已审阅检查点。**删除**：无。
- **升级**：固定 base 的图/运行时接缝漂移；真实红用例不能复现所述父子图问题；D-01 无法在锁定 LangGraph 版本隔离父 saver；需改 C03/C30/C22 生产代码、公共契约、权限、事务、持久化、迁移、依赖或批准文件清单；上述可运行命令在实施时不存在。普通测试失败由当前实施任务修复，不借扩大范围绕过。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在 §7 的四个生产/测试文件内核验、修复和回归已批准语义；按最终 HEAD 运行 §6 关键路径并填写 `verification.md`，关键场景不能以 skip 或替身代替。若 C30 同容器验收路径已进入当前 HEAD，再额外运行其真实路径并记录结果；否则记录未集成原因，不标 PASS。限定审计如被状态策略触发，只检查 `nested-interrupt-boundary`、`checkpoint-ownership`、`replay-idempotency` 与当前授权；不能借审计改 C03/C30 或提出新公共字段。
