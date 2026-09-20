# C26 定向独立核验报告

验证对象：`deliver-warning-tasks-and-in-app-notification`

输入与产物 HEAD：`1201085e1b9365fcd118da62db02ae3a166e0843`。本轮仅审计权限、事务、关键状态机和语义 merge 接缝，不修改生产代码、公共契约、迁移或测试，不提交、不合并、不归档。

## 结论

| 维度 | 结果 |
| --- | --- |
| 完整性 | 17/17 tasks 已勾选；7 项 Requirement 与 22 个 Scenario 已读取并对照限定范围实现 |
| 权限 | 1 项 CRITICAL：`open` 的空间授权过滤晚于目标读取，可泄露同工程未授权空间中的评估引用是否存在 |
| 事务 | `open`、`acknowledge` 与异步投递分别复用 C03 原子事务/幂等消费者；回滚、重放和并发代表性测试通过 |
| 状态机 | 当前 C26 服务不会重开已关闭任务；数据库未约束 `closed → open` 回退，记录 1 项 WARNING |
| 合并一致性 | C26 实施后 6 次 main 合并未在受影响路径产生 combined diff；中央 `000044` 登记和 feature exports 未丢失 |

当前存在 1 项未解决 CRITICAL，不应归档。两项 finding 均涉及权限或迁移/持久化边界，已通过 Orca escalation 交由协调者决定修复任务；本轮 Targeted Auditor 未越权修改实现。

## CRITICAL

### C26-AUD-01：`open` 可枚举同工程未授权空间中的评估引用

- 规格要求在任何目标读取前复验当前工程、空间和分支授权；无权、跨空间或不存在目标必须不可枚举。
- `#verifyCommand` 会复验授权上下文，但 `open` 随后把命令携带的 authorization 交给 reader，先读取评估，再对返回的空间执行 `#requireAuthorizedSpatialScope`：`packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts:447`、`:448`、`:454`。
- reader 的 SQL 只按 `project_id` 和评估精确引用过滤，没有把已复验的空间集合放入查询：`packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts:267`、`:291`、`:294`。
- 因此同工程调用者查询未授权空间中存在的引用时得到 `AUTHORIZATION_DENIED`；查询不存在引用时，reader 在 `:295` 产生 `assessment-unavailable`，映射为 `BUSINESS_BLOCKED`。返回码差异泄露目标是否存在。
- 现有授权测试只覆盖伪造的外工程 authorization context，没有覆盖“同工程、有效上下文、未授权空间”的存在/不存在等价拒绝：`packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts:376`。
- 建议：reader 使用 `#verifyCommand` 返回的当前授权，并在同一目标 SQL 中按获准空间过滤；补一组同工程跨空间的存在/不存在测试，二者均断言不可枚举 `AUTHORIZATION_DENIED` 且零副作用。该修复落实既有批准语义，不应放宽权限或改公共 DTO。

## WARNING

### C26-AUD-02：任务表未在数据库层阻止 `closed → open`

- design §5.2 将任务状态固定为 `open → closed`；delta spec 要求已关闭任务不得重新打开。
- `000044` 只检查 `status IN ('open', 'closed')`，并向 `riskflow_app` 授予 `status` 列 UPDATE：`packages/adapters/src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts:193`、`:197`、`:503`。
- 当前 `open` 路径只选择未关闭任务，现有测试也证明关闭后会创建新任务实体，因此 C26 当前入口行为正确；但数据库没有 transition guard，后续任一使用应用角色的写路径都能把 closed 行改回 open，破坏持久化状态机。
- 建议：由迁移所有者决定是否在 `000044` 增加单向 transition trigger/constraint，并补数据库角色下的 closed→open 拒绝测试。此项涉及迁移语义，不能由本轮 auditor 直接修改。

## 已通过的定向核验

- `open` 使用 serializable 事务并在有限预算内重试；预警唯一键、未关闭任务部分唯一索引、任务行锁、命令收据、审计和 Outbox 在同一 C03 事务中提交。注入审计冲突的测试证明业务表、回执和事件整体回滚后可安全重试。
- `acknowledge` 先复验当前 C06 上下文，在事务内锁定当前任务并校验 warning/task/空间/版本/关联；确认、审计、命令回执和事件原子提交。并发确认只保留首次事实，失败者按提交后事实稳定返回业务阻塞。
- Worker 只处理 strict `warning.warning-recorded.v1`，复用 `PostgresIdempotentConsumer` 的事务与 receipt；投递失败仅回滚独立投递事务并记录 pending attempt，重试与重复事件不复制通知。
- 迁移七表、FK/唯一索引/最小 grant、逆序 down/up 与中央 manifest 的代表性测试通过；除 C26-AUD-02 外未发现额外事务或关键状态机偏差。
- `a4705ba..HEAD` 的受影响路径只新增了 finalizer 对 warning adapter 与对应测试的修正；逐个 merge commit 的 combined diff 在 C26 路径为空，未发现语义 merge 冲突。最终 `apps/worker/src/index.ts`、两个 package `./warning` exports、授权 fixture 和 PostgreSQL foundation manifest 均保留 C26 接缝。

## 实际命令与证据

- `openspec status --change deliver-warning-tasks-and-in-app-notification --json`：`schemaName=riskflow-delivery`，五工件 done。
- `openspec instructions apply --change deliver-warning-tasks-and-in-app-notification --json`：17/17 tasks complete；已完整读取返回的全部 contextFiles。
- `codegraph explore "C26 warning permission authorization transaction state machine semantic conflicts: ..."`：CLI 报当前 worktree 无可用 `.codegraph/` index，随后按项目规则回退到 `rg`、Git 与逐文件读取，未自行建索引。
- `git diff --name-status main...HEAD`、`git diff --name-status a4705ba..HEAD -- <C26 paths>`、逐个 `git diff-tree --cc`：确认 C26 文件范围、finalizer 修正和无 C26 combined merge diff。
- `pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts apps/worker/test/warning/runtime.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：3 files / 33 tests passed。
- `openspec validate deliver-warning-tasks-and-in-app-notification --strict --no-interactive`：change valid。
- `pnpm exec prettier --check openspec/changes/deliver-warning-tasks-and-in-app-notification/verification.md && git diff --check`：通过。

## 剩余事项

1. 修复并回归 C26-AUD-01 后重新执行权限定向核验；修复前不得归档。
2. 协调者决定 C26-AUD-02 是否在当前 change 内以数据库 transition guard 收口；若暂不修复，须显式接受持久化状态机仅由调用路径保证的风险。
3. 修复若实质改变权限、迁移或最终产物，必须再次核验受影响范围；旧 PASS 不能覆盖新产物。
