# Verification

## 验收对象

- Change：`deliver-execution-forecast-feedback-and-deviation`
- 实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`5c818a7dcecf62d8b6b0add1e71d0f11b49a8cf0`
- 当前工作树 HEAD：`5c818a7dcecf62d8b6b0add1e71d0f11b49a8cf0`
- 最终验收产物：上述 HEAD 加本轮未提交审计修复与本报告；受控 settle 形成的 `outputHead` 由协调端记录。
- 验收 Agent：Finalizer Task `task_b404cdbf49a8`，Dispatch `ctx_2205dcc24d1a`
- 限定审计 Agent：Targeted Auditor Task `task_ef34309957e9`，Dispatch `ctx_82a56e7eaa0a`
- 样本边界：预测执行器、监测、配置和评估数据均为“合成样本、待甲方复核”；生产未注入匹配执行器时保持显式 unavailable。

## 结论

**PASS。** Finalizer 已核对 12/12 tasks、8 项 Requirement、20 个 Scenario 与 IP-01～IP-11；本收尾轮次唯一一次 Targeted Auditor 又独立复核权限、事务、关键状态和迁移，在当前任务内修复六类已批准范围缺陷。C28、公共 contracts/API、PostgreSQL foundation、被引用旧迁移及静态检查全部通过，未发现剩余阻塞项。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| 人工决定与预测工作流独立；采纳、拒绝、虚假绑定；IP-01、IP-03、IP-04、IP-09、IP-10 | V-01；真实 PostgreSQL 终局决定、拒绝无预测、错工程/空间绑定、并发唯一测试；`recordDecision` 不创建运行或执行 | PASS |
| 冻结建议、监测和评估依据；完整输入、依据不完整；IP-03、IP-05、IP-09、IP-10 | V-01；精确建议/C25 input/C14 snapshot/C19 member 读取，新增 `forecastPolicyRef` 与冻结成员 release 精确对账 | PASS；修复前可保存与实际执行策略不一致的快照引用 |
| 三类版本化预测；正式结果、非法执行器结果；IP-02、IP-05、IP-10 | V-01；三种 method、requiredRef、指标、单位、时域、风险等级、证据和 unavailable 分支覆盖 | PASS |
| 已采纳建议执行与独立行动；伪造来源拒绝；IP-03、IP-06、IP-09、IP-10 | V-01；决定链、已发布措施、录入主体、发生时间和证据由真实 PostgreSQL 场景覆盖 | PASS |
| 执行后反馈；完整事实、时间/评估链错配；IP-03、IP-07、IP-09、IP-10 | V-01；反馈、审计、回执和 `warning.feedback-recorded.v1` 原子回归，新增反馈快照授权引用与当前 C06 上下文精确对账 | PASS；修复前可接受错配的快照授权引用 |
| 冻结策略偏差；三策略边界、无预测、禁止公共记录；IP-02、IP-03、IP-08、IP-09、IP-10 | V-01；absolute/relative/risk-level-step、严格 `>`、relative 整数交叉乘法、无预测不造事实及私有 Schema 覆盖 | PASS |
| C29 稳定精确读取；后续不改旧事实；IP-08～IP-10 | V-01；同工程/空间精确 ref、摘要对账、缺失与越权同形、无 list/latest/update | PASS |
| 权限、幂等、事务和审计；越权、重放/并发、成员失败回滚；IP-01、IP-03～IP-11 | V-01、V-03～V-06；五类命令使用稳定请求作为 C03 原子载荷；决定、预测、执行、反馈和偏差读取统一复验 strict payload、digest 与行投影；Outbox 故障零部分事实 | PASS |
| 包导出、迁移机械接缝和范围；IP-09～IP-11 | V-02～V-09；`000046` 被 provider discovery 发现，真实 up/down/up、最小 grant、旧数据保留、七条上游事实 FK 和旧迁移 down guard；无公共 contracts/API 接线漂移 | PASS |

### 验收阶段修复

1. `forecastResponse` 现在要求公共冻结快照的 `forecastPolicyRef` 与 C25 basis 中 C19/C04 `forecast-policy` 成员 release 完全一致，错版本失败闭合。
2. `recordFeedback` 现在要求 `ResponseFeedbackInputSnapshotV1.authorizationContextRef` 与本次经 C06 复验的公共命令授权引用一致；测试夹具改为回填真实签发引用，并覆盖伪造引用拒绝。
3. C28 决定、执行和反馈读取统一复验 strict payload、SHA-256 摘要、稳定引用、工程与空间投影；新增真实 PostgreSQL 反馈摘要漂移回归。未修改公共契约、权限映射、迁移、依赖或应用接线。

### 限定审计发现与任务内修复

1. 下游只读授权返回值原先只校验工程、主体与 capability，未限制空间集合。现要求返回空间是请求空间的子集，并覆盖恶意扩大空间的回归。
2. C03 幂等摘要原先使用含 `now()` 字段的生成结果，完全相同的命令跨时钟重放会冲突。五类写命令改用已验证的稳定请求作为原子载荷，偏差写入后重新读取持久化事实；跨时钟重放不再生成重复事实。
3. 已冻结为 `forecast.kind=unavailable` 的反馈原先可被同一建议后续出现的可用预测补成偏差。偏差入口现以反馈冻结状态为准，保持稳定 unavailable。
4. C18 允许规范十进制负数，C28 计算原先未拒绝负 absolute/relative 阈值。纯计算边界现失败闭合为 `basis-incompatible`。
5. 预测、反馈和偏差读取补齐正文摘要、稳定引用与所有结构化列的双向投影对账；任一行列/正文漂移均失败闭合。
6. `000046` 原先缺少 D-09 要求的上游事实外键。经协调端批准，在既有五表内补齐 C25 baseline/input、C14 前后监测快照、C04 反馈附件、C25 实际评估和执行路由决定共七条 `DEFERRABLE INITIALLY DEFERRED` 外键，并为三个被引用旧迁移补充 down guard；未新增表、列、索引、权限语义、依赖或公共契约。

### 实际命令

| 命令 | 结果 |
| --- | --- |
| V-01 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts --reporter=verbose` | PASS：2 files / 67 tests；真实 PostgreSQL，无关键 skip；含跨时钟重放、授权不扩大、冻结 unavailable、投影漂移与 Outbox 故障整体回滚 |
| V-02 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts` | PASS：2 files / 27 tests |
| V-03 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` | PASS：1 file / 17 tests；迁移发现、up/down/up、角色与追加式约束 |
| V-04 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/risk-assessment/migration-idempotency.test.ts packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` | PASS：4 files / 53 tests；被引用迁移 rollback/up 与 C28 外键恢复通过 |
| V-05 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false` | PASS |
| V-06 `pnpm exec eslint`（本轮 10 个受影响源码、迁移和测试文件）；`pnpm exec prettier --write`（同一文件集） | PASS |
| V-07 `pnpm run deps:check && pnpm run deps:policy` | PASS：353 modules / 996 dependencies；0 violations；policy OK |
| V-08 `openspec validate deliver-execution-forecast-feedback-and-deviation --strict --no-interactive`；`openspec status --change deliver-execution-forecast-feedback-and-deviation --json` | PASS：change valid；`orchestrated-delivery` 全部工件 done |
| V-09 `git diff --check` | PASS |

## 限定审计

本 change 及本轮修复涉及权限、事务和迁移。本收尾轮次唯一一次 Targeted Auditor 已完成以下限定复核：

- C06 当前授权、下游授权不扩大、反馈快照授权绑定及跨工程/空间不可枚举；
- 终局决定并发唯一、C03 fact/receipt/audit/feedback event 原子回滚与不同幂等载荷冲突；
- C28 五类 payload/digest/投影对账、relative 整数交叉乘法边界；
- `000046` 五表 FK/check/grant/down，以及输入 HEAD 已登记的中央 migration/auth fixture 接缝；
- C30 持有 route/workflow run、C28 只持私有偏差事实、C29 组合公共 `DeviationRecord` 的所有权边界。

审计结论：**PASS。** 六类普通 finding 已在当前活动 Task 内修复并完成回归；缺失上游事实 FK 经 escalation `msg_942e2d25b2d3`、协调端回复 `msg_ef4cd0b8f50d` 明确批准后，严格按既有五表和七条约束修复。没有第二次审计、公共契约变化、权限语义扩张、新迁移编号、新依赖或遗留 finding；剩余仅为协调端受控 settle、形成 `outputHead` 并集成。

## 后续注意事项

- C30 的生产 workflow binding、图运行和应用层组合根，以及 C29 的校准建议/公共 `DeviationRecord` 组合仍属于后续 change；不影响 C28 私有深模块的当前 Finalizer 结论。
- 正式预测执行器和甲方脱敏样例尚未交付；当前 available 路径仅由明确标识的合成测试执行器证明，生产不得把该夹具作为回退。
