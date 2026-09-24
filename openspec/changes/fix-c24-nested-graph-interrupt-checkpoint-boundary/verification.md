# Verification

## 验收对象

- Change：`fix-c24-nested-graph-interrupt-checkpoint-boundary`（`orchestrated-delivery`）
- 输入实现 HEAD：`fedb1ac07887ab46ffba62af6012afcc9a8608ba`
- 最终产物 HEAD：`391663f1d1f524b526548c36227df8c6cf42cd51`（本轮限定审计未修改生产代码；本工件由主调度建立检查点）
- 验收 Agent：C40 Finalizer，`task_79aa0d8823bc`；限定审计 Agent，`task_60bfa70a8bf2`

## 结论

**PASS**：已批准范围内五个场景和 IP-01～04 均有可运行证据；本轮唯一一次限定审计通过。C30 同容器验收文件尚未进入当前工作树，按批准计划记录为未运行，不计入本 HEAD 的必经门槛。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 父图嵌套等待；IP-01/02/03/04 | `nested-boundary.test.ts` 使用真实父子 `StateGraph`、C03 PostgreSQL saver，核对父子各自等待、子线程根命名空间、业务登记及审计边界 | 通过；父子图 7/7 |
| 同身份重试；IP-01/02/03/04 | 同文件核对原运行版本、等待引用、无重复业务行；旧版本等待登记仍存在时失败闭合 | 通过；父子图 7/7 |
| 决定恢复、重复及迟到信号；IP-02/03/04 | 同文件核对原子线程恢复、父检查点不被改写、业务行不增；`runtime.test.ts` 覆盖单图恢复 | 通过；联合回归 56/56 |
| 子检查点缺失、错位、写入未确认及引用不符；IP-02/03/04 | `nested-boundary.test.ts` 的命名空间错位、缺失、登记行缺失用例；`runtime.test.ts` 的 checkpoint 写故障用例 | 通过；联合回归 56/56 |
| 撤权拒绝跨图恢复；IP-03/04 | `nested-boundary.test.ts` 撤权后启动和恢复均拒绝，授权恢复后业务行保持不变 | 通过 |
| C24/C03 基线；IP-02/03/04 | 三文件联合回归覆盖父子图、单图运行时和 C03 PostgreSQL 基础 | 3 文件、56/56 通过 |
| 类型、格式、规范；IP-02/03/04 | `pnpm typecheck`；`pnpm format:check`；`pnpm exec eslint apps/worker/src/identification/graph/graph.ts apps/worker/src/identification/graph/runtime.ts apps/worker/test/identification/graph/nested-boundary.test.ts`；`openspec validate fix-c24-nested-graph-interrupt-checkpoint-boundary --strict --no-interactive`；`git diff --check` | 均通过 |

Finalizer 验收期修复：`apps/worker/src/identification/graph/runtime.ts` 在等待重放及业务领先恢复前核对最新运行版本的精确等待登记行，保留原业务领先恢复路径，防止旧等待行绕过对账；`apps/worker/test/identification/graph/nested-boundary.test.ts` 增加对应零补写回归。初始定向用例失败，修复后 1/1 通过。限定审计期间无新增代码修复。

实际回归命令：

- `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/identification/graph/runtime.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts --reporter=dot` → 最终 HEAD，3 文件 56/56，exit 0。
- `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts --reporter=dot` → 32/32。
- `pnpm exec vitest run apps/worker/test/identification/graph/nested-boundary.test.ts --reporter=dot` → 最终代码 7/7。
- `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts -t '启动命令相同载荷|I3 Agent 尚未完成|I6～I8 待定组' --reporter=dot` → 最终代码 3/3。
- `pnpm typecheck`、`pnpm format:check`、`pnpm exec eslint apps/worker/src/identification/graph/graph.ts apps/worker/src/identification/graph/runtime.ts apps/worker/test/identification/graph/nested-boundary.test.ts`、`openspec validate fix-c24-nested-graph-interrupt-checkpoint-boundary --strict --no-interactive`、`git diff --check` → 通过。

## 限定审计

- 触发范围：`nested-interrupt-boundary`、`checkpoint-ownership`、`replay-idempotency` 与当前授权；重点核对本次等待重放分支调整。
- 审计结论：**通过**。`graph.ts` 的 `invoke/resume/retry/recover/getState` 均以同一配置固定子线程、根命名空间及 C24 saver；`runtime.ts` 只在 GraphInterrupt 后读到精确子检查点，并经当前授权、最新游标版本和等待登记行核对后返回等待。旧等待行、错位或缺失的子检查点、撤权均由真实数据库用例证明失败闭合且零补写；联合回归 56/56。审计未发现需在批准范围内继续修复的缺陷，也未触及公共契约、权限、事务、持久化、迁移或依赖。

## 后续注意事项

- 本轮使用合成样本，待甲方复核。
- C30 实际同容器验收路径未进入当前 HEAD；集成后按批准计划运行真实路径。
- `__pregel_checkpointer` 为锁定的 LangGraph 1.4.17 内部配置键，升级依赖时重新验证父子检查点隔离。
