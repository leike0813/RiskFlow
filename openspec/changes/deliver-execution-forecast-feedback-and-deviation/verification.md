# Verification

## 验收对象

- Change：`deliver-execution-forecast-feedback-and-deviation`
- 实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`5783e2f6e14a0c44531ae15480f1c8c577a66602`
- 当前工作树 HEAD：`5783e2f6e14a0c44531ae15480f1c8c577a66602`
- 最终验收产物：上述 HEAD 加本轮未提交修复与本报告；生产代码及测试 diff 摘要为 `7d1c88a640aaf42efbbe293d08af47929e0bc3c52347e0ab75bfb01407b1f588`。受控 settle 形成的 `outputHead` 由协调端记录，限定审计须核对并补记最终 HEAD。
- 验收 Agent：Finalizer Task `task_b404cdbf49a8`，Dispatch `ctx_2205dcc24d1a`
- 样本边界：预测执行器、监测、配置和评估数据均为“合成样本、待甲方复核”；生产未注入匹配执行器时保持显式 unavailable。

## 结论

**BLOCKED（待限定审计）。** Finalizer 已核对 12/12 tasks、8 项 Requirement、20 个 Scenario 与 IP-01～IP-11，修复冻结策略引用、反馈授权绑定和私有 payload 摘要复验三项已批准范围缺陷，受影响回归全部通过。本 change 涉及权限、事务和迁移，协调端须在最终检查点形成后执行本收尾轮次唯一一次 Targeted Auditor；审计完成前不得集成。

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
| 权限、幂等、事务和审计；越权、重放/并发、成员失败回滚；IP-01、IP-03～IP-11 | V-01、V-03～V-06；决定/执行/反馈读取统一复验 strict payload、digest 与行投影，事务故障零部分事实 | Finalizer PASS；待限定审计独立复核 |
| 包导出、迁移机械接缝和范围；IP-09～IP-11 | V-02～V-08；`000046` 被 provider discovery 发现，真实 up/down/up、最小 grant、旧数据保留；无公共 contracts/API 接线漂移 | PASS |

### 验收阶段修复

1. `forecastResponse` 现在要求公共冻结快照的 `forecastPolicyRef` 与 C25 basis 中 C19/C04 `forecast-policy` 成员 release 完全一致，错版本失败闭合。
2. `recordFeedback` 现在要求 `ResponseFeedbackInputSnapshotV1.authorizationContextRef` 与本次经 C06 复验的公共命令授权引用一致；测试夹具改为回填真实签发引用，并覆盖伪造引用拒绝。
3. C28 决定、执行和反馈读取统一复验 strict payload、SHA-256 摘要、稳定引用、工程与空间投影；新增真实 PostgreSQL 反馈摘要漂移回归。未修改公共契约、权限映射、迁移、依赖或应用接线。

### 实际命令

| 命令 | 结果 |
| --- | --- |
| V-01 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` | PASS：2 files / 63 tests；真实 PostgreSQL，无关键 skip |
| V-02 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/http-shell.test.ts` | PASS：2 files / 27 tests |
| V-03 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` | PASS：1 file / 17 tests；迁移发现、up/down/up、角色与追加式约束 |
| V-04 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false` | PASS |
| V-05 `pnpm exec eslint packages/core/src/response-lifecycle packages/core/test/response-lifecycle packages/adapters/src/response-lifecycle packages/adapters/test/response-lifecycle`；implementation-plan §6 `prettier --check` | PASS |
| V-06 `pnpm run deps:check && pnpm run deps:policy` | PASS：353 modules / 993 dependencies；0 violations；policy OK |
| V-07 `openspec validate deliver-execution-forecast-feedback-and-deviation --strict --no-interactive` | PASS：change valid |
| V-08 `git diff --check` | PASS |

## 限定审计

本 change 及本轮修复涉及权限、事务和迁移。协调端须在最终检查点形成后派发本收尾轮次唯一一次 Targeted Auditor，限定复核：

- C06 当前授权、下游授权不扩大、反馈快照授权绑定及跨工程/空间不可枚举；
- 终局决定并发唯一、C03 fact/receipt/audit/feedback event 原子回滚与不同幂等载荷冲突；
- C28 五类 payload/digest/投影对账、relative 整数交叉乘法边界；
- `000046` 五表 FK/check/grant/down，以及输入 HEAD 已登记的中央 migration/auth fixture 接缝；
- C30 持有 route/workflow run、C28 只持私有偏差事实、C29 组合公共 `DeviationRecord` 的所有权边界。

Auditor 必须在本节补入最终 HEAD、发现及任务内修复、实际命令与 PASS/FAIL/BLOCKED 结论；普通 finding 不得回派 Finalizer，不得启动第二次审计。

审计结论：待 Targeted Auditor 填写。

## 后续注意事项

- C30 的生产 workflow binding、图运行和应用层组合根，以及 C29 的校准建议/公共 `DeviationRecord` 组合仍属于后续 change；不影响 C28 私有深模块的当前 Finalizer 结论。
- 正式预测执行器和甲方脱敏样例尚未交付；当前 available 路径仅由明确标识的合成测试执行器证明，生产不得把该夹具作为回退。
