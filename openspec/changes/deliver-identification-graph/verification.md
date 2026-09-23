# Verification

## 验收对象

- Change：`deliver-identification-graph`
- 输入实现 HEAD：`94aef94438ba9e180c4113e96628442356da46cb`
- 最终验收 HEAD：`94aef94438ba9e180c4113e96628442356da46cb` 加本工作树未提交验收修复（按任务约束未提交）
- 验收 Agent：C24 Finalizer（task `task_467b931316ca`，dispatch `ctx_5ea9b27b51a6`）

## 结论

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

## 限定审计

本轮唯一限定审计待执行。协调端指定范围：

- critical-state-machine：稳定动作身份、重试计数、取消终态；
- C03 checkpointer：`put`/`putWrites` 同步及控制通道豁免；
- 恢复的 tasks 3.2、3.3、3.5；
- `@langchain/langgraph` 绑定与依赖治理；
- `000043` 迁移与中央登记；
- contracts `WaitingRef.agent-task` 变体；
- C22 逐组封闭/待定语义。

审计结论和审计内修复/回归证据必须合并回本文件后，才能把结论改为 PASS 或 FAIL。

## 后续注意事项

项目默认 `npmmirror` 不实现 pnpm audit endpoint；本轮已用官方 npm registry 执行等价 high-level 生产依赖审计。该环境差异不构成当前实现缺陷。
