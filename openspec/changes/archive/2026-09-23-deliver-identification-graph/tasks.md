## 1. 核心识别图领域能力

- [x] 1.1 实施 IP-09：建立 C24 内部 Schema、端口和类型化结果并增加 core 子路径导出；运行 `pnpm typecheck && pnpm deps:check`。
- [x] 1.2 实施 IP-10：完成冻结输入快照和完整稳定工作计划的纯函数；运行 `pnpm exec vitest run packages/core/test/identification/graph.test.ts`。
- [x] 1.3 实施 IP-11、IP-19：完成结构化错误路由和 I9 汇总，并闭合核心行为矩阵；运行 `pnpm exec vitest run packages/core/test/identification/graph.test.ts`。

## 2. 业务持久化与精确读取

- [x] 2.1 实施 IP-13：新增 `000043` 追加登记迁移及中央迁移/权限 fixture 登记；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth`。
- [x] 2.2 实施 IP-12、IP-17：完成 PostgreSQL 登记、C21/C22 精确 reader、C04 digest 核对、当前授权和 checkpoint 对账，并增加 adapter 子路径导出；运行 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`。
- [x] 2.3 实施 IP-20：闭合真实 PostgreSQL 下的追加权限、同键重放/冲突、撤权和伪 checkpoint 引用证据；运行 `pnpm exec vitest run packages/adapters/test/identification/graph packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth`。

## 3. LangGraph 运行时与组合

- [x] 3.1 实施 IP-18：精确加入 `@langchain/langgraph@1.4.17` 并更新锁文件和依赖策略；运行 `pnpm deps:policy && pnpm licenses:check && pnpm security:check`。
- [x] 3.2 实施 IP-14：用真实 StateGraph 完成 I0～I9 顺序工作项/分组编排和类型化条件边；运行 `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts`。
- [x] 3.3 实施 IP-15：完成内部 start/resume/cancel、原线程等待、冻结重试、状态版本和业务/checkpoint 对账；运行 `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts`。
- [x] 3.4 实施 IP-16：接入 C17/C21/C22/C23、策略目录及 Agent/review 幂等恢复消费者并导出 Worker 组合入口；运行 `pnpm exec vitest run apps/worker/test/identification/graph/composition.test.ts`。
- [x] 3.5 实施 IP-21：闭合成功、部分失败、Agent/人工等待恢复、重复/迟到信号、checkpoint 写失败和协作取消证据；运行 `pnpm exec vitest run apps/worker/test/identification/graph`。

## 4. 跨模块回归与依赖门禁

- [x] 4.1 验证 C21/C22/C23 公开接缝未漂移；运行 `pnpm exec vitest run packages/core/test/identification/context.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/core/test/identification/human-review.test.ts apps/worker/test/identification/context apps/worker/test/identification/candidate-finalization apps/worker/test/identification/human-review`。
- [x] 4.2 验证构建、类型、静态规则、格式和全量测试；运行 `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm deps:check`。
- [x] 4.3 验证依赖、许可证、安全与 OpenSpec；运行 `pnpm deps:policy && pnpm licenses:check && pnpm security:check && pnpm exec openspec validate deliver-identification-graph --strict --no-interactive`。

## 5. Apply 收口

- [x] 5.1 按 IP-01～IP-21 核对全部 Requirement/Scenario、计划文件和证据命令；运行 `pnpm exec openspec instructions apply --change deliver-identification-graph --json` 并确认所有 `contextFiles` 已读取、实现任务全部勾选且未提前创建 verification。

## 6. 批准重开范围：I0/I1 阶段登记与依赖门禁

- [x] 6.1 实施 IP-22：收敛 C24 `stage-result` Schema 与 `000043` 同名 check，覆盖新表和重复 `up`；运行 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts --testTimeout 30000 --maxWorkers 1`。
- [x] 6.2 实施 IP-23：让 I0 和成功 I1 按原事务登记阶段结果，I2 起保持冻结工作计划要求；运行 `pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 --maxWorkers 1 -t 'I0～I2'`。
- [x] 6.3 实施 IP-24：在现有 C24 adapter/worker 测试中覆盖允许/拒绝组合、I0/I1 登记和重放，并回归当前 actor 授权与取消事务；运行 `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/identification/graph/runtime.test.ts --testTimeout 30000 --maxWorkers 1`。
- [x] 6.4 核对 IP-25：确认 `pnpm-workspace.yaml` 的例外仅为已锁定的 `@langchain/langgraph@1.4.17`，不变更依赖版本；运行 `pnpm deps:policy && pnpm deps:check && pnpm licenses:check`。
- [x] 6.5 按 IP-22～IP-25 收口规划新增场景和批准文件；运行 `pnpm typecheck && pnpm format:check && pnpm exec openspec validate deliver-identification-graph --strict --no-interactive`，并将最终行为和证据交由新一轮 Finalizer 更新 verification。
