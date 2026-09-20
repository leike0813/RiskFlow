# C26 最终核验报告

验证对象：`deliver-warning-tasks-and-in-app-notification`

实际 schema：`riskflow-delivery`

最终实现检查点 HEAD：`a0918fbb1d9dceb570e85d2fadefaea84a63ccad`；本轮限定审计仅更新本报告，不修改生产代码、测试、公共契约、迁移或依赖。

## Summary

| 维度 | 结果 |
| --- | --- |
| 完整性 | 21/21 tasks；7 项 Requirement、22 个 Scenario 均有实现或代表性证据 |
| 正确性 | C26-AUD-01/02/03 均已解决；最终实现检查点的限定审计与 PostgreSQL/Worker 定向回归通过 |
| 一致性 | D-01～D-13、IP-01～IP-12 保持；权限、事务、关键状态机与语义 merge 影响范围无新 finding |

最终评估：无未解决 CRITICAL、WARNING 或 SUGGESTION；最终实现检查点已通过权限、事务、关键状态机与语义 merge 冲突限定审计，可交由协调端继续集成门禁。

## Finding 处置

### C26-AUD-01：`open` 空间授权晚于目标读取 — 已解决

- `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts:253` 的 reader 现在只接收 `#verifyCommand` 返回的当前 C06 授权；评估、输入快照与准备快照的精确联结查询同时按获准空间实体过滤。
- 查询未命中统一返回不可枚举的 `AUTHORIZATION_DENIED`，不会再以 `AUTHORIZATION_DENIED` / `BUSINESS_BLOCKED` 区分同工程未授权空间中的引用是否存在；策略提供者也改用同一已复验上下文。
- `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts:425` 使用真实 C06 子空间授权证明：未授权目标存在与不存在均返回 `AUTHORIZATION_DENIED`，且 warning 与 command receipt 计数不变。

### C26-AUD-02：缺少 `closed → open` 持久化守卫 — 已解决

- `packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts:495` 在既有 `000044` 内增加可重复建立的单向 transition trigger；`closed → open` 以 SQLSTATE `23514` 失败，`open → closed` 及非状态列窄更新不受影响。
- down 在删除任务表后清理 trigger function；重复 up、逆序 down 与重建仍通过。未新增迁移、依赖、中央登记或公共 Schema。
- `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts:313` 以 `riskflow_app` 连接尝试重开已关闭任务，数据库拒绝后状态仍为 `closed`，随后同归集键预警创建新任务实体。

### C26-AUD-03：关闭任务后以新命令重放同一评估返回终态失败 — 已解决

- `PostgresWarningLifecycleAdapter.open` 现在以 `CanonicalWarningV1.created` 区分本事务新建 warning 与领域唯一性命中的既有 warning；若没有新 warning，只提交新命令的成功回执与审计，不创建任务、任务版本、通知意图或重复事件。
- 只有本事务新建的 warning 才进入任务归集、通知意图和 `warning.warning-recorded.v1`；事务完成后既有 `#canonicalOpenResult` 返回首次建立的规范 warning/task/intent refs。
- PostgreSQL 回归覆盖“首次 open → 关闭任务 → 不同命令重放同一 assessment”：结果与首次成功完全一致，task/version/intent/event 计数不变；随后新 assessment 仍创建新任务实体，旧任务保持关闭。

## Requirement 与设计核对

- “预警只能消费已持久化的确定性评估事实”：精确 C25 三表读取、当前授权空间过滤、冻结策略匹配与空计划路径保持成立。
- “每个评估与触发类型形成唯一不可变预警”及“处置任务按工程风险与空间归集”：一般并发、持续越限、新评估在关闭后创建新任务，以及同一旧评估关闭后的语义重放均成立。
- “打开预警的事实与事件必须原子且幂等”：warning/task/intent/audit/receipt/outbox 仍由一个 C03 事务提交；失败回滚与同键重放回归通过。
- “应用内通知投递不得影响预警事实”：Worker 仍复用 `PostgresIdempotentConsumer` 的独立事务，失败与重放回归通过。
- “确认只记录已读接管”与“预警链路可重放且最小披露”：确认不更新 warning/assessment/task/delivery；错误、事件与普通结果仍仅披露稳定引用和原因类别。
- D-03/D-10 的权限顺序、D-05/D-09 的 `closed → open` 单向状态守卫及 D-06 的领域语义重放均已按 finding 收口；其余 D-ID/IP-ID 未发生语义变化。

## 实际命令与证据

- 修复前 `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`：新增回归稳定复现，1 failed / 11 passed；修复后复跑为 12/12 passed。
- `pnpm exec vitest run packages/core/test/warning/warning.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx packages/adapters/test/postgres/postgres-foundation.test.ts`：8 files / 80 tests passed。
- `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`：exit 0，无诊断。
- `pnpm exec eslint packages/core/src/warning packages/core/test/warning packages/adapters/src/warning packages/adapters/test/warning apps/worker/src/warning apps/worker/test/warning apps/worker/src/index.ts packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts`：exit 0。
- 首次 Prettier 检查发现新增测试排版问题；执行 `pnpm exec prettier --write packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts` 后，完整 `pnpm exec prettier --check ...` 通过。
- `pnpm run deps:check && pnpm run deps:policy && git diff --check`：269 modules / 737 dependencies 无违规，dependency policy OK，diff check 通过。
- `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`：change valid；`openspec status --change ... --json` 确认 `schemaName=riskflow-delivery`、五工件 done。

## 剩余事项

无产品实现 finding。协调端仍需审阅本报告更新并按编排策略继续集成门禁；本 worker 不提交、不合并、不归档。

## 最终检查点限定审计

审计输入为 `a0918fbb1d9dceb570e85d2fadefaea84a63ccad`，范围限定为权限、事务、关键状态机及合入主线过程中可能形成的语义冲突，不重复执行全量 change 验收。

- 权限：`open` 在读取评估依据前复验当前 C06 授权，精确查询按获准空间过滤；`acknowledge` 复验分支能力后校验 warning/task 的工程、空间、当前版本和关联。公共事实源 `MODULE_BRANCH_CAPABILITY_V1` 明确把 `warning-response.open` 与 `warning-response.acknowledge` 映射到 `warning-response.record`，拒绝结果的 `requiredCapability` 与契约一致。
- 事务：`open` 的 warning/task/version/intent/audit/receipt/outbox 仍由单个 serializable `PostgresTransactionUnit` 事务提交；`acknowledge` 的确认/audit/receipt/event 原子提交；Worker 通过 `PostgresIdempotentConsumer` 的独立事务写投递事实，失败不会回滚已提交预警。
- 关键状态机：数据库 trigger 阻止 `closed → open`；任务历史版本、关联、通知意图、投递和确认保持只追加；关闭后旧 assessment 的新命令重放只新增成功回执与审计，不创建任务版本、意图或事件，新 assessment 才创建新任务实体。
- 语义 merge：目标实现路径的 merge 历史无合并提交改写，相关 merge 的 `--remerge-diff` 无冲突解决差异，目标路径无冲突标记；未发现主线同步改变 C26 权限、事务或状态语义。

本轮实际命令与结果：

- `git rev-parse HEAD && git status --short --branch`：HEAD 与调度输入一致，审计开始时工作树干净。
- `git log --merges --oneline -- <C26 目标路径>`、`git show --remerge-diff --stat <同步 merge>` 及冲突标记扫描：无目标路径语义冲突证据。
- `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts`：2 files / 16 tests passed。
- `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json apps/worker/tsconfig.json --pretty false`：exit 0，无诊断。
- `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`：change valid。

限定审计结论：未发现新 finding；C26-AUD-01/02/03 的修复在最终实现检查点保持成立。
