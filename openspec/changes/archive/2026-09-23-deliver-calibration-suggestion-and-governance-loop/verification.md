# Verification

## 验收对象

- Change：`deliver-calibration-suggestion-and-governance-loop`；实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`9a0bd43c688c99625fd44ce087ca9a17d8b55fdc`
- 当前产物 HEAD：`293e5af037354f2cc948585b41d7898620600d00` 的限定审计修复已由协调端形成 Git 检查点（下一次提交即本文件所指最终产物 HEAD）；审计核验的输入 HEAD 为 `293e5af037354f2cc948585b41d7898620600d00`
- 验收 Agent：Orca Dispatch `task_4709b482428c` / `ctx_1fffaafaa9f8`（收尾 attempt 2）
- 核验范围：15/15 implementation tasks、11 项 Requirement、38 个 Scenario、IP-01～IP-11

## 结论

**BLOCKED**：已批准的实现与回归证据均闭合；本轮触及权限分支、C25 授权读取、C03 事务、退回状态机和 `000048` 迁移，必须由协调端派发本收尾轮次唯一一次限定审计，并把审计结论写入本文件后才能判定 PASS。此状态不表示把范围内缺陷留待后续修复。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 产物与可运行证据 | 结果 |
|---|---|---|
| 入口：已越限、冻结依据精确匹配、其它有效依据不能替代、未越限、无权错配；IP-01/IP-06 | C29 `prepareInput` 经 C28 精确事实、C25 `readInputSnapshot`、C19 成员与 C04 摘要后才保存工件；C29 PostgreSQL 测试覆盖缺失快照、其它依据、目标版本、空间错配与零工件；C25 PostgreSQL 测试覆盖真实精确读、缺失、错目标和跨工程 | 覆盖 5/5 Scenario |
| Agent：合格候选、原预算内可修复错误、规则与版本冲突；IP-04/IP-05/IP-06 | `packages/core/src/calibration` 类型化操作、完整 C18/C19 文档校验；C08 completed result 精确窄读；core、agent-runtime 和 calibration 测试 | 覆盖 3/3 Scenario；无 Agent 直接发布 |
| 建议与公共记录：创建、幂等重放、事务成员失败；IP-07/IP-10 | `PostgresCalibrationAdapter.createSuggestion` 使用真实 parent run、C07 请求和 C03 事务；calibration PostgreSQL 测试核对 pending 记录、Outbox、回执与失败回滚 | 覆盖 3/3 Scenario |
| 决定：拒绝、退回、退回与后继幂等、无效消费、陈旧决定、调用方类型伪装；IP-08/IP-10 | C07 精确决定证明；`000048` reservation/consumption 两张只追加表；calibration PostgreSQL 测试覆盖独立后继、单次消费及失败不写 | 覆盖 6/6 Scenario |
| 草案：精确批准、无证明、基准漂移、重试；IP-09 | C29 证明门禁、候选摘要重放、C04 工件和 C16 `submit-revision` 稳定命令；calibration/review-audit 测试覆盖尾事务失败后的单修订收敛 | 覆盖 4/4 Scenario；草案未发布 |
| 既有治理：批准不等于发布、后续发布不改校准历史；IP-08/IP-09 | C29 只调用 `submit-revision`；calibration PostgreSQL 测试核对未发布状态、历史只追加与精确引用 | 覆盖 2/2 Scenario |
| 权限审计重放：授权收窄、第三方精确重放；IP-04/IP-05/IP-06/IP-09 | C06 每阶段复验、C25 精确快照窄读、C08 原始响应/usage/action 引用、C29 候选 digest；C25/C29/C08 测试 | 覆盖 2/2 Scenario；无思维链存储 |
| 公共端口：精确决定证明、strict 查询、既有端口兼容；IP-02/IP-03 | `CalibrationSuggestionApprovalProofPortV1` 独立端口；contracts 与 review-audit 测试 | 覆盖 3/3 Scenario |
| C25 冻结输入端口：最小投影、缺失/陈旧/越权；IP-06 | `AssessmentInputSnapshotReaderV1` 由 C25 adapter 实现；`risk-assessment.read-input-snapshot` 只映射既有 `risk-assessment.read`，C29 不读 C25 私表；C25 真 PostgreSQL 与 C29 授权分支测试 | 覆盖 2/2 Scenario |
| C07 证明：批准、拒绝/退回、错目标、状态不一致、决定缺失；IP-02/IP-03 | C07 只读证明与真 PostgreSQL 测试；精确任务/决定引用核对 | 覆盖 5/5 Scenario |
| C07 授权：合法读取、无权先拒绝、跨工程不可枚举；IP-03 | C07 证明先验 C06 授权，不写审计/回执/Outbox；review-audit PostgreSQL 测试 | 覆盖 3/3 Scenario |
| 迁移与中央登记；IP-10/IP-11 | `000047`/`000048` up/down、重复 up、旧数据保留、最小 grant；`packages/adapters/test/auth/fixture.ts` 与 `packages/adapters/test/postgres/postgres-foundation.test.ts` 均登记 `000048_warning-response_deliver-calibration-suggestion-and-governance-loop_calibration_suggestion_lineage` | foundation 17 tests、auth 13 tests 通过 |

实际回归命令与结果：

- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/calibration/calibration.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`：8 files、121 tests passed。
- 最后一次 C25 读取完整性核对后，重跑 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`：2 files、37 tests passed。
- `pnpm typecheck`：exit 0。
- implementation-plan §6 的 scoped `pnpm exec eslint` 加 C25、中央 fixture 文件：exit 0。
- implementation-plan §6 的 scoped `pnpm exec prettier --check` 加 C25、中央 fixture 文件：全部匹配。
- `pnpm deps:check && pnpm deps:policy && git diff --check && openspec validate deliver-calibration-suggestion-and-governance-loop --strict --no-interactive`：exit 0；371 modules / 1058 dependencies，无违规；change valid。
- `git diff -- packages/contracts/src/records packages/contracts/src/events packages/contracts/src/workflows apps`：无 diff；C29 未激活应用路由。
- `openspec instructions apply --change deliver-calibration-suggestion-and-governance-loop --json`：15/15 tasks complete。

本轮完成的修复：

- 落实协调端裁决 `msg_3ddffe19c23e`、`msg_acd25df67de8`：新增 C25 精确快照窄读与唯一 `risk-assessment.read-input-snapshot` 分支；C29 在冻结工件写入前核对工程、空间、依据集合、目标发布和摘要，并补真实 C25 与 C29 负向回归。
- 按本次派发 `msg_dc652657ee86` 补 `000048` 中央 migration/auth 测试登记和回归；输入工作树已有的决定证明、退回血缘、事务与配置语义修复经本轮 8 组测试独立复验。
- 将 IP-06/IP-11 两项剩余 task 勾选，并把 design 中待裁决分支更新为已批准映射。
- 在固定施工图 §9 追加协调端批准的 7 个新 Scenario、IP-ID 和文件增量映射，保留原始 §3/§7 记录。

## 限定审计

- 必审范围：`risk-assessment.read-input-snapshot` 的 C06 权限和空间/来源约束；C25 读取与 C29 冻结事实一致性；C07 精确决定证明；退回 reservation/consumption 的并发和只追加状态；C03 事务/Outbox；`000047`/`000048` 迁移与最小授权；C16 草案幂等收敛。
- Targeted Auditor：Orca Dispatch `task_3d2cb70dbb72` / `ctx_750026821a88`；输入 HEAD `293e5af037354f2cc948585b41d7898620600d00`。
- **结论：PASS。** 上文 Finalizer 的 BLOCKED 是待限定审计的阶段结论；本轮审计发现的唯一缺陷已在当前任务内修复，未发现待处置开放项。
- 权限与冻结输入：分支 `risk-assessment.read-input-snapshot` 只映射既有 `risk-assessment.read`；C25 先验 C06 授权，再按工程、快照 id/version、空间/来源、依据集合、目标发布与内容摘要读取和验证。C29 只调用 C25 窄读端口，未直接读取其私表；未增加 capability、角色或权限值。
- 决定与事务：C07 证明按精确任务、决定、建议版本绑定三种决定；缺失或错目标分别返回既有未批准原因，状态矛盾为技术失败。C29 的退回预留和消费通过唯一约束及 C03 串行化事务限为一次，公共记录只追加 pending 后继版本；拒绝只追加 rejected 版本；批准经 C16 幂等 `submit-revision` 取得未发布修订后才追加 approved 版本。C07 证明查询无业务审计、回执或 Outbox 写入。
- 迁移：`000048` 的两项审计外键此前无条件 `ADD CONSTRAINT`，第二次 `up` 会失败。协调端 `msg_7dc2bfb832ce` 批准在现有迁移内按 `000047` 的存在性保护修复；表结构、权限、触发器语义与逆序 `down` 未改。现有 PostgreSQL 迁移测试新增连续两次 `up`，连同原有 `down → up` 和旧数据保留断言均通过；中央 auth/foundation 登记与迁移 id 一致。
- 实际命令与结果：`pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts -t 'migration supports down and up'`：1 passed；`pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts --maxWorkers=1`：3 files、55 tests passed。先前并行执行同三文件时 54 passed、1 项触发 5 秒超时；该用例单独复跑 1 passed，单文件校准回归 16/16 passed。`pnpm typecheck`、scoped `pnpm exec eslint`、scoped `pnpm exec prettier --check`、`pnpm deps:check && pnpm deps:policy && openspec validate deliver-calibration-suggestion-and-governance-loop --strict --no-interactive && git diff --check`：均 exit 0。
- 剩余事项：协调端审阅本任务的三个未提交文件并形成 Git 检查点；随后按受控流程集成、归档。

## 后续注意事项

- 固定施工图 §7 的原文件清单早于上述两项协调端裁决；§9 记录已批准的文件增量，未引入新 capability、角色、依赖或应用路由。
- 本轮不得提交、合并或归档；协调端形成 Git 检查点后，审计 Agent 须将本文件中的当前产物 HEAD 更新为实际最终 HEAD。
