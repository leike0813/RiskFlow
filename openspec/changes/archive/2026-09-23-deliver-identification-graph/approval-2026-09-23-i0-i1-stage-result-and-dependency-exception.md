# C24 规划范围变更批准记录（2026-09-23）

- 批准引用：`approval://riskflow/C24/scope-2026-09-23-i0-i1-stage-result-and-dependency-exception`
- 批准来源：协调端在本次受控调度会话中的裁决（授权目标为推进并完成既定 39-change 路线；裁定方式与同轮 C29 的加法式范围裁定一致）。
- 被取代的尝试组：`C24:audit`
- 触发证据：`run_7eaac0143759` 限定审计的 `msg_8e62f19edddc`、`msg_ef8b9f0f62f8`、`msg_0cf839efcf83`（escalation）与 `msg_a7767c2759c9`（worker_done）；产物 HEAD `5c95b6d84a42f52edccf3c54896b5d386d5b53a6` 加当前未提交审计修复。

## 触发事实

1. **I0/I1 阶段结果登记形状冲突**。规格 `Requirement: I0 至 I2 冻结单一输入快照和完整工序工作计划` 场景要求「运行依次保存 I0 准备结果、一个识别输入快照和一个包含全部适用工序工作项的 I2 工作计划」；design D-02 要求「I0 校验父运行、准备引用和触发上下文并**登记准备结果**」。但 `IdentificationGraphResultRowV1Schema` 的 `stage-result` 判别要求 `workPlanRef`，迁移 `000043_identification_graph.ts` 的 `kindPairing("stage-result", ["work_plan_ref", "stage_result_ref"])` 同样要求它；I0/I1 时尚无工作计划，`input-snapshot` 类别又要求 `preparation_snapshot_ref` 与 `input_snapshot_ref` 同时存在，故 I0/I1 的登记形状与规格/设计冲突。`apps/worker/src/identification/graph/graph.ts` 的 `stageI0`/`stageI1` 目前以 `advance(..., stageResultRow: false)` 跳过登记。该冲突只影响 C24 自有 schema 与自有迁移的允许组合，不涉及其它 change 的数据。
2. **依赖安装门禁例外未登记**。c24 分支相对 main 还包含 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude: ["@langchain/langgraph@1.4.17"]`；该精确版本此前已获批准（`pnpm deps:policy` 与锁文件校验通过），但该文件未列入本 change design §7 的新增/修改清单。
3. 本轮限定审计已在批准范围内完成两项修复（受保护读取按当前 actor 复验且失败与不存在同形；取消与 run-state 在同一事务内按预期运行状态版本推进，含并发与重放回归），结论与证据见本 change `verification.md` 与 `msg_a7767c2759c9`。

## 本次重开规划必须闭合的范围

1. **I0/I1 stage-result 登记形状**：在 C24 自有范围内决定并写明确切形状，至少覆盖：
   - `stage-result` 登记如何表达工作计划形成前的阶段结果（例如把该判别的 `workPlanRef` 放宽为可选，并同步 `packages/core/src/identification/graph/schema.ts` 判别、`000043_identification_graph.ts` 的 check constraint 允许组合与 design 表格）；
   - 允许修改的文件：`packages/core/src/identification/graph/schema.ts`、`packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts`（仅调整该 check constraint 的允许组合，保持可重复执行与最小授权，不新增迁移文件）、`apps/worker/src/identification/graph/graph.ts`（I0/I1 登记）、`apps/worker/src/identification/graph/**` 与 `apps/worker/test/identification/graph/**`、`packages/adapters/test/identification/graph/**`、以及本 change 的 `design.md`、`specs/**`、`implementation-plan.md`、`tasks.md`；
   - 语义边界：不新增 capability、角色、权限值、迁移文件或跨 change 公共契约；不改变 `input-snapshot`、`work-plan`、`waiting`、`run-result`、`run-state`、`cancellation` 等其它类别的既有允许组合；不复制 C21/C22/C23 的结果正文或结论。
2. **依赖安装门禁例外**：确认 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude: @langchain/langgraph@1.4.17` 纳入本 change 批准范围，并在 design §7 文件清单中登记该文件与理由（该版本为已批准的固定依赖版本，例外只影响安装门禁，不新增或变更依赖版本）。若规划认定不能纳入本 change 范围，MUST 显式说明并给出替代处置（例如回退该配置及其影响），不得静默保留。
3. `implementation-plan.md` 必须以新的 IP-ID、现有符号、允许文件清单和可运行验证命令展开上述两项；`tasks.md` 同步更新。验证命令至少覆盖：迁移可重复执行、check constraint 的允许与拒绝组合、I0/I1 登记存在性、以及既有 actor 授权与取消事务回归。
4. 超出上述文件与语义的改动不在本次批准范围内，必须重新 escalation。

## 处置要求

规划者 MUST 先读取本记录并把它作为本次规划的批准输入，把上述范围逐项展开为可施工 IP-ID、允许文件清单与验证命令；若认定任一项无法在 C24 已批准语义内闭合，MUST 在规划工件中显式说明并升级，而不是仅补齐模板章节。本记录是重开规划的批准凭据，不是设计结论；设计结论仍写入 `design.md`。
