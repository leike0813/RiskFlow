# Verification

## 验收对象

- Change：`deliver-identification-graph`
- 输入实现 HEAD：`94aef94438ba9e180c4113e96628442356da46cb`
- 最终验收 HEAD：`94aef94438ba9e180c4113e96628442356da46cb` 加本工作树未提交验收修复（按任务约束未提交）
- 验收 Agent：C24 Finalizer（task `task_467b931316ca`，dispatch `ctx_5ea9b27b51a6`）

## Finalizer 结论（限定审计前）

**BLOCKED**。已批准范围内实现、修复与回归证据均已完成，但本轮修复触及 critical-state-machine 与 C03 checkpointer 同步，协调端已决定触发本收尾轮次唯一一次限定审计；审计尚未执行，因此不得标记 PASS。阻塞边界仅为下述限定审计，未发现其它实现或证据缺口。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| I0～I9 顺序编排、条件边、字段级状态通道；IP-14 | `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts` | 通过：22/22 |
| 启动、恢复、原任务等待、冻结重试、取消与 checkpoint 对账；IP-15/IP-21 | `pnpm exec vitest run apps/worker/test/identification/graph` | 通过：3 files，46/46 |
| C24 追加登记、精确 reader、digest、授权和伪 checkpoint 引用；IP-12/IP-20 | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts` | 通过：10/10 |
| C21/C22/C23 公开接缝与逐组封闭语义；IP-16、D-13 | `pnpm exec vitest run packages/core/test/identification/context.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/core/test/identification/human-review.test.ts apps/worker/test/identification/context apps/worker/test/identification/candidate-finalization apps/worker/test/identification/human-review` | 通过：8 files，119/119 |
| 构建、类型、静态规则、格式、全量行为和依赖边界；IP-09～IP-21 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm deps:check` | 通过：83 files 中 82 passed、1 skipped；1327 passed、2 skipped；dependency-cruiser 0 violation |
| 依赖策略与许可证；IP-18 | `pnpm deps:policy && pnpm licenses:check` | 通过；两者均执行依赖策略检查 |
| 生产依赖安全门禁；IP-18 | `pnpm security:check`；镜像不提供 audit endpoint 后执行 `pnpm --registry=https://registry.npmjs.org audit --prod --audit-level high` | 原命令受 `npmmirror` 能力阻塞；等价官方 registry 命令通过 high 门槛，仅报告 1 个 moderate |
| OpenSpec 一致性与 apply 上下文；IP-01～IP-21 | `pnpm exec openspec validate deliver-identification-graph --strict --no-interactive`；`pnpm exec openspec instructions apply --change deliver-identification-graph --json` | 严格校验通过；实际 schema 为 `orchestrated-delivery`，全部 contextFiles 已读取，15/15 tasks 已完成 |

验收阶段完成以下范围内修复：

- 统一阶段动作身份到稳定运行版本，恢复时沿用原 Agent 任务与业务幂等身份；按冻结策略计数重试并为每次失败证据派生单调版本。
- 从已登记 cancellation 事实重建迟到恢复/重放的取消结果，清除等待引用并保留既有事实。
- 修正 I0～I9 阶段登记、run/version/result 引用、共享审计 ID、pending-review/Agent 等待投影及 I9 阶段结果。
- 修正字段级 LangGraph 输出解析、恢复/重试路由与业务事实先于 checkpoint 的故障对账。
- C03 checkpointer 等待同一 checkpoint 的在途 `put` 后再处理 `putWrites`，消除 LangGraph 同步持久化竞态。
- PostgreSQL 登记使用数据库 `clock_timestamp()` 形成真实持久化顺序；测试通过公开源码接缝装配，避免陈旧构建产物混用。

## 限定审计范围（审计前记录）

协调端指定本轮唯一限定审计范围：

- critical-state-machine：稳定动作身份、重试计数、取消终态；
- C03 checkpointer：`put`/`putWrites` 同步及控制通道豁免；
- 恢复的 tasks 3.2、3.3、3.5；
- `@langchain/langgraph` 绑定与依赖治理；
- `000043` 迁移与中央登记；
- contracts `WaitingRef.agent-task` 变体；
- C22 逐组封闭/待定语义。

审计结论和审计内修复/回归证据合并回本文件。

## 限定审计结论（task `task_346b10bb36e6`，dispatch `ctx_601e703e8be6`）

**BLOCKED**。审计输入与当前产物 HEAD 均为 `5c95b6d84a42f52edccf3c54896b5d386d5b53a6`；下述审计修复保留在未提交工作树中。权限读取、取消事务与运行状态竞态等已批准范围内缺陷已在本任务内修复；I0/I1 阶段结果登记仍存在规格与持久化契约冲突，需由规划决定后实现，本 change 不能标记 PASS。

| 审计维度 | 结论与证据 |
|---|---|
| 权限 | 原登记端口的 `readRow`、`listRunRows`、`readLatestRunState` 使用登记行冻结身份或缺少当前调用者。现由 C24 内部端口传入当前 `actorId`、授权上下文和请求时间，在读取前调用既有 `verify` 复验精确分支；登记行的授权范围摘要须与当前上下文一致。身份或范围不符分别与不存在同形地返回 `undefined` 或空列表。恢复事件使用授权上下文的 actor，不再误用生产命令 ID。PostgreSQL adapter 用例覆盖非当前 actor 和收窄空间范围。|
| 事务与关键状态机 | 原取消仅登记 cancellation，未在同一事务按预期运行版本写入终态。现运行状态转换与取消共用事务内版本锁和最新版本校验；取消在单一 C03 业务事务中登记 cancellation 与 `cancelled` run-state。并发恢复/取消用例验证恰好一方推进，最终只存在对应终态事实。重放启动从取消登记恢复结果；重复无效恢复仍拒绝；I9 验收路线读取失败不生成完成汇总。|
| C03 checkpointer | 检查 `packages/adapters/src/postgres/checkpointer.ts` 中 `put` 在途 Promise 与同 checkpoint 的 `putWrites` 等待、失败映射、控制通道过滤及引用校验；本轮未发现需要改动 C03 的新缺陷。原 Finalizer 的 C03 与 LangGraph 回归证据见上表。|
| 语义 merge 与边界 | `git diff --name-only --diff-filter=U` 无冲突；C21/C22/C23 仍经公开端口调用，C22 待定组与逐组封闭行为按既有测试回归。未修改公共 contracts、迁移、依赖或权限值。|
| 依赖治理 | 当前 HEAD 的 `pnpm-workspace.yaml` 包含 `minimumReleaseAgeExclude: ["@langchain/langgraph@1.4.17"]`，但 IP-18 计划文件仅列 `apps/worker/package.json`、`pnpm-lock.yaml`、`config/dependency-policy.json`。本轮未修改该文件，已向协调端升级范围判断；该项不作为审计通过证据。|

### 待规划处置的开放项：I0/I1 阶段结果登记

规格场景 `specs/identification/graph/spec.md:7-13` 要求依次保存 I0 准备结果、I1 输入快照及 I2 工作计划；design D-06（`design.md:74-92`）声明阶段结果进入追加登记。当前 `apps/worker/src/identification/graph/graph.ts:1269-1299` 与 `:1305-1460` 的 I0/I1 `advance(...)` 均设置 `stageResultRow: false`。`packages/core/src/identification/graph/schema.ts:309-310` 要求 `stage-result` 有 `workPlanRef`，迁移 `packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts:68` 也要求 `work_plan_ref` 与 `stage_result_ref` 同在；I0/I1 此时尚无工作计划。协调端已裁定此处需要规划/设计决定登记形状，审计不得改写 Schema、迁移或绕过冲突。**本项未闭合，需规划决定 stage-result 登记形状后实现。**

### 审计修复与回归命令

- `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts -t 'registers all eight|reads run rows and the latest run state'`：2/2 通过，覆盖当前 actor、越范围与不存在同形。
- `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 -t '恢复与取消竞争同一运行版本'`：1/1 通过。
- `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 --maxWorkers 1 -t 'I6～I8 待定组后续有决定后恰入库一次|恢复与取消竞争同一运行版本'`：2/2 通过，覆盖重复无效恢复与取消竞态。
- `pnpm typecheck`：通过。
- `pnpm deps:policy`、`pnpm exec openspec validate deliver-identification-graph --strict --no-interactive`：通过。
- `pnpm exec vitest run apps/worker/test/identification/graph packages/adapters/test/identification/graph packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth`：82 通过、4 个用例因并行 PostgreSQL 容器下默认 5 秒超时失败；对这 4 个用例以 `--testTimeout 30000` 定向重跑，4/4 通过。
- `pnpm exec vitest run apps/worker/test/identification/graph packages/adapters/test/identification/graph --testTimeout 30000 --maxWorkers 1`：Testcontainers 初始化数分钟未产生用例结果，手动中止；不计为通过。
- `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts --testTimeout 30000 --maxWorkers 1`：2 files、34/34 通过；真实 PostgreSQL/Testcontainers 总耗时 408.87 秒。
- `pnpm format:check`、`git diff --check`、`git diff --name-only --diff-filter=U`：通过；无格式错误、尾随空白或未解决的 merge 冲突。

## 后续注意事项

项目默认 `npmmirror` 不实现 pnpm audit endpoint；本轮已用官方 npm registry 执行等价 high-level 生产依赖审计。该环境差异不构成当前实现缺陷。
