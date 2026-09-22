# C29 deliver-calibration-suggestion-and-governance-loop — Implementation 收口报告

输入 HEAD：c46e9387d2f7d795aec9ced729dee49c902df032（未提交、未合并、未归档；无 verification 工件）

## 1. 已实现（按 IP-ID）

| IP-ID | 产物 |
|---|---|
| IP-01 | `packages/adapters/test/calibration/fixture.ts`（真实 PostgreSQL + C03/C04/C06/C07/C08/C19/C28 组合，12 个纵向用例可运行） |
| IP-02 | `packages/contracts/src/ports/index.ts`：`CalibrationSuggestionApprovalProofQueryV1Schema`/`ProofV1Schema`/`ResultV1Schema`、`review-audit.verify-calibration-suggestion-approval` 分支（映射既有 `review-audit.read`）、独立单方法端口 `CalibrationSuggestionApprovalProofPortV1`；`ReviewAuditPortV1` 与方法签名零变化 |
| IP-03 | `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`：`verifyCalibrationSuggestionApproval` + 两类证明共用的 `#projectDecisionWithTask`（抽取后知识修订证明行为不变） |
| IP-04 | `packages/core/src/agent-runtime/runtime.ts` + `postgres-agent-task-adapter.ts`：私有 `AgentTaskCompletedResultReaderV1.readCompletedResult`（授权先行、单点投影、无列表/latest、只读无回执） |
| IP-05 | `packages/core/src/calibration/{schema,service,index}.ts`：稳定身份派生、6 类闭合类型化操作、`createCalibrationSuggestionTaskDefinition`、`validateCalibrationCandidate`/`applyCalibrationOperations`（完整 C18/C19 文档复验 + canonical digest）、闭合失败到 `ModuleErrorV1` 映射 |
| IP-06 | 授权先行的 C28 fact / C19 basis / C04 目标读取、冻结输入工件、C08 完成结果收口 |
| IP-07 | C07 确定性复核请求 + 建议、`pending` 公共偏差记录、回执、审计与既有 `warning.calibration-suggestion-created.v1` 的 C03 原子写入 |
| IP-08 | reject（追加 `rejected` 版本并标记建议为 rejected）/ return-for-revision（只写退回关联）/ approve-draft-creation 三类决定收口 |
| IP-09 | C07 证明门禁、候选精确重放与摘要核对、C04 内容工件、C16 `submit-revision`、成功后草案关联 + `approved` 版本 |
| IP-10 | `000047_calibration_suggestion_governance.ts`：三张只追加表、精确 FK/唯一/最小权限/逆序 down |
| IP-11 | core/adapters `./calibration` 子路径导出、core 表格测试 |

## 2. 本轮内发现并修复的实现缺陷（由纵向测试暴露）

1. **每用途单独授权**：新增组合根接缝 `authorizeDownstream`（镜像 C28 的 downstream authorizer），一次用例按需签发 6 类既有分支上下文，禁止透传命令授权。
2. **C08 增量工件目的码**：读取改用 C08 写入的 `agent-increment`。
3. **C04 读取身份**：同一请求内两次读取按 `${requestId}:${purposeCode}` 区分，重试可重放且不覆盖回执/审计。
4. **事件审计引用**：`auditTrailRef.entityId` 精确等于同事务审计条目 id。
5. **偏差记录审计引用**：`#insertDeviationRecordVersion` 使用命令的同一条审计条目 id（原为不存在的角色 id，延迟 FK 在提交时才失败）。

## 3. 已运行验证与结果

- `pnpm typecheck` → 通过（全工作区）
- `pnpm deps:check` / `pnpm deps:policy` → 通过；`git diff --check` → 干净
- `openspec validate deliver-calibration-suggestion-and-governance-loop --strict --no-interactive` → valid
- `pnpm exec eslint`（本次变更路径）→ 0 error；`pnpm exec prettier --check`（同范围）→ 全部符合
- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` → 14 passed
- `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts` → 13 passed
- `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` → 18 passed
- `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` → 9 passed
  （四文件合并运行：54 passed）
- 迁移真实 PostgreSQL 验证（一次性探针，已删除）：000047 应用成功、三表存在、`riskflow_app` 恰为 `{INSERT,SELECT}`、`down` 后三表与授权全部撤除且既有迁移记录不变、重复 `up` 幂等 → 1 passed
- `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` → **12 用例中 9 通过 3 失败**（最新一次运行）

## 4. 剩余事项（未收口）

- `packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` 中 3 例失败，集中在 reject/return/approve 决定与草案路径（最近一次：9 passed / 3 failed）；通过的 9 例已覆盖基线硬门、迁移 up/down、越限/未越限、授权先行、`createSuggestion` 快乐路径、幂等重放与同键异载荷冲突、审计冲突回滚。失败用例仍在诊断中，未定位到新的 src 缺陷结论。任务的 `tasks.md` 3.2/4.2/4.3/4.4/5.1 因此**未勾选**。
- 需要主调度处理的中央 fixture 登记（受保护文件，按 implementation-plan §7 未修改）：
  1. `packages/adapters/test/postgres/postgres-foundation.test.ts`：import 块（`000046_execution_forecast_feedback_deviation.js` 之后，约 59 行）新增 000047 import；`testMigrationManifest` 中 000046 条目之后（约 429 行）新增
     `relativePath: "warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.ts"`、
     `migrationName: "000047_warning-response_deliver-calibration-suggestion-and-governance-loop_calibration_suggestion_governance"`、`sequence: 47`。
     未登记时该文件以 `PostgresPersistenceError: MIGRATION_INVALID`（stage `migration.load`）失败、17 例 skipped（本轮实测）。
  2. `packages/adapters/test/auth/fixture.ts`：import（约 29 行）与迁移清单（约 132 行）。
- 未提交：工作树 15 个路径已修改/新增，未 `git add`/commit/merge/archive。
