# C26 最终核验报告

验证对象：`deliver-warning-tasks-and-in-app-notification`

实际 schema：`riskflow-delivery`

本轮输入 HEAD：`fffa13f790c48b6054f03d00d29bc644f13880fd`（协调端已将两项限定审计发现纳入 C26 收口）；最终修复保持未提交，等待协调端审阅并形成检查点。

## Summary

| 维度 | 结果 |
| --- | --- |
| 完整性 | 20/20 tasks；7 项 Requirement、22 个 Scenario 均有实现或既有代表性证据 |
| 正确性 | 两项限定审计 finding 已修复；受影响 PostgreSQL、Worker 与迁移发现回归 33/33 通过 |
| 一致性 | D-01～D-13、IP-01～IP-12 保持；无公共契约、依赖、额外迁移号或范围变化 |

最终评估：无未解决 CRITICAL、WARNING 或 SUGGESTION；当前产物可交由协调端再次执行权限/状态机限定审计。

## Finding 处置

### C26-AUD-01：`open` 空间授权晚于目标读取 — 已解决

- `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts:253` 的 reader 现在只接收 `#verifyCommand` 返回的当前 C06 授权；评估、输入快照与准备快照的精确联结查询同时按获准空间实体过滤。
- 查询未命中统一返回不可枚举的 `AUTHORIZATION_DENIED`，不会再以 `AUTHORIZATION_DENIED` / `BUSINESS_BLOCKED` 区分同工程未授权空间中的引用是否存在；策略提供者也改用同一已复验上下文。
- `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts:425` 使用真实 C06 子空间授权证明：未授权目标存在与不存在均返回 `AUTHORIZATION_DENIED`，且 warning 与 command receipt 计数不变。

### C26-AUD-02：缺少 `closed → open` 持久化守卫 — 已解决

- `packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts:495` 在既有 `000044` 内增加可重复建立的单向 transition trigger；`closed → open` 以 SQLSTATE `23514` 失败，`open → closed` 及非状态列窄更新不受影响。
- down 在删除任务表后清理 trigger function；重复 up、逆序 down 与重建仍通过。未新增迁移、依赖、中央登记或公共 Schema。
- `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts:313` 以 `riskflow_app` 连接尝试重开已关闭任务，数据库拒绝后状态仍为 `closed`，随后同归集键预警创建新任务实体。

## Requirement 与设计核对

- “预警只能消费已持久化的确定性评估事实”：精确 C25 三表读取、当前授权空间过滤、冻结策略匹配与空计划路径保持成立。
- “每个评估与触发类型形成唯一不可变预警”及“处置任务按工程风险与空间归集”：数据库唯一键、serializable 重试、未关闭任务部分唯一索引和任务版本只追加保持成立。
- “打开预警的事实与事件必须原子且幂等”：warning/task/intent/audit/receipt/outbox 仍由一个 C03 事务提交；失败回滚与同键重放回归通过。
- “应用内通知投递不得影响预警事实”：Worker 仍复用 `PostgresIdempotentConsumer` 的独立事务，失败与重放回归通过。
- “确认只记录已读接管”与“预警链路可重放且最小披露”：确认不更新 warning/assessment/task/delivery；错误、事件与普通结果仍仅披露稳定引用和原因类别。
- D-03/D-10 的权限顺序已按 finding 收紧；D-05/D-09 的 `open → closed` 状态机现由调用路径与数据库共同守卫。其余 D-ID/IP-ID 未发生语义变化。

## 实际命令与证据

- `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`：1 file / 12 tests passed。
- `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：3 files / 33 tests passed。
- `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`：exit 0，无诊断。
- `pnpm exec eslint packages/adapters/src/warning packages/adapters/test/warning packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`：exit 0。
- `pnpm exec prettier --check openspec/changes/deliver-warning-tasks-and-in-app-notification packages/adapters/src/warning packages/adapters/test/warning packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`：通过。
- `pnpm run deps:check && pnpm run deps:policy && git diff --check`：269 modules / 737 dependencies 无违规，dependency policy OK，diff check 通过。
- `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`：change valid。

## 剩余事项

无产品实现 finding。协调端仍需审阅六个 dirty paths、形成 Git 检查点，并按编排策略再次触发限定审计；本 worker 不提交、不合并、不归档。
