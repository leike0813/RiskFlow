# Verification Report: define-module-interfaces-events-and-workflows

验证日期：2026-08-31  
固定 implementation checkpoint：`9bfd507a93a6b2dabfd40780269b70512ec869b6`（`fix(contracts): 闭合 C02 治理与 Agent 结果契约`）

## 结论

**PASS。固定 checkpoint `9bfd507` 的实现与 C02 proposal、delta spec、design 和已完成 tasks 一致；未发现 CRITICAL、WARNING 或 SUGGESTION。**

上次 C1/C2 均已闭合：知识治理命令在运行时配对 Schema 与 `KnowledgeModelingPortV1.govern` 静态条件返回类型上同时约束成功结果；五类 Agent 完成态均要求恰好一个任务专属主产物，并只允许附加 `ValidationSnapshotRefV1`。独立 120 项运行时矩阵全部符合预期，目标 Vitest 10/10 与全部指定门禁通过。

本结论只验收 C02 的纯契约交付面，不替代主调度 Agent 的 verification checkpoint、feature 合并、`main` 复验或归档授权。

## Summary

| Dimension | Status | Evidence |
| --- | --- | --- |
| Completeness | PASS | delta spec 的 11 条 Requirement、35 个 Scenario 均有实现与测试证据；12 项 tasks 中 11 项已勾选，唯一未勾选的 7.2 即本次独立复验，按任务约束未修改 `tasks.md` |
| Correctness | PASS | 11/11 Requirement 通过；C1/C2 定向回归、45 个 port 成功分支、18 个复核决定、I0-I9/A0-A9、授权/因果/生命周期及负例均通过 |
| Coherence | PASS | 实现遵守三个公开子路径、Zod SSOT、事实所有权、引用型图状态、Non-Goals 与单向依赖设计 |

## 上次 C1/C2 修复复验

### C1. 知识治理 command/result 成功分支已闭合

- `design.md:197-216` 固定 `submit-revision → revision`、`request-review → review-task`、其余三个治理命令 `→ release`，并要求失败结果可由任一命令返回。
- `packages/contracts/src/ports/index.ts:1809-1842` 定义三类成功结果、完整五命令映射与 `KnowledgeGovernanceResultForCommandV1<T>` 条件类型；`packages/contracts/src/ports/index.ts:2159-2164` 让 `KnowledgeModelingPortV1.govern` 使用该条件返回类型。
- `packages/contracts/src/ports/index.ts:2032-2056` 的 `KnowledgeGovernanceCommandResultV1Schema` 对 `{ command, result }` 执行运行时配对校验，失败分支不受成功类型映射限制。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts:663-686` 覆盖 `request-review + review-task` 正例及 `request-review + revision/release` 反例。
- 独立运行时矩阵覆盖五个正确成功配对、三类错误成功配对和五个通用失败配对，13/13 符合预期。

### C2. Agent 完成态恰好一个任务专属主产物

- `design.md:86` 明确五类任务的主产物族，要求完成态恰好一个任务专属主产物，并允许另带 `ValidationSnapshotRefV1`。
- `packages/contracts/src/ports/index.ts:680-708` 对主产物计数执行 `=== 1` 约束；`packages/contracts/src/ports/index.ts:710-779` 分五类 strict Schema 收窄主产物、校验、失败和取消组合。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts:1121-1230` 覆盖五类“主产物 + validation”正例，以及 validation-only、跨任务产物、多主产物、错误 validation、失败夹带产物、取消夹带产物反例。
- 独立运行时矩阵中五类合法完成态、validation-only/no-output、跨任务、多主产物、失败与取消正反例共 13/13 符合预期。

## Requirements 逐条核对

| # | Requirement | 结果 | 精确证据 |
| --- | --- | --- | --- |
| 1 | 六个领域模块只暴露用例级 interface | PASS | 六领域 port 位于 `ports/index.ts:2153-2190`；全部 domain command/query 分支与未知 action/字段反例见测试 `:235-594`；45 个成功分支运行时矩阵全部通过 |
| 2 | 应用模块只能组合领域 interface | PASS | Agent/workflow/projection port 位于 `ports/index.ts:2192-2210`，只返回任务、运行、事件或查询/导出引用；应用输入闭合测试见 `:779-967` |
| 3 | 每次跨模块调用携带冻结授权上下文 | PASS | capability 映射与三种 invocation 在 `ports/index.ts:473-583`；命令/查询边界在 `:781-851` 校验 project、actor、capability；system/Agent 缺因果运行及越权负例通过 |
| 4 | 命令、结果和错误具有稳定幂等语义 | PASS | 写命令复用幂等信封，结果由 `ports/index.ts:853-878` 的闭合 `succeeded/waiting/failed` 构造器形成；八类错误在 `:598-670`；C1 的分支级成功类型已闭合 |
| 5 | 已入库事实通过事务领域事件衔接 | PASS（契约层） | `events/index.ts:34-160` 定义完整元数据与十个引用型事件；测试 `:1255-1388` 验证十事件、RI→RA 运行引用及业务正文/未知字段拒绝 |
| 6 | 识别工作流具有 I0 至 I9 的版本化阶段契约 | PASS | `workflows/index.ts:210-318` 闭合 I0-I9；测试 `:1391-1418` 逐阶段覆盖，I6 skipped 使用 `IdentificationGroupRefV1` |
| 7 | 评估工作流具有 A0 至 A9 的版本化阶段契约 | PASS | `workflows/index.ts:224-235,320-404` 闭合 A0-A9；运行时矩阵和测试 `:1419-1447` 均逐阶段通过，A3-A6 无 Agent 产物字段 |
| 8 | 图状态只保存小型版本化引用 | PASS | 三个 strict state 在 `workflows/index.ts:474-581`；业务正文、JSON-LD、检索片段、错误引用类型和未知字段反例均拒绝 |
| 9 | 暂停、恢复、重试和取消保持业务事实完整 | PASS（契约层） | 七状态、三类 waiting、六种 resume cause 与 start/resume/cancel DTO 位于 `ports/index.ts:585-596,1325-1464`；生命周期一致性约束在 `workflows/index.ts:406-472` |
| 10 | Agent 与人工复核使用不同引用和决定边界 | PASS | C2 已闭合 Agent 主产物；五类复核决定联合在 `ports/index.ts:1589-1670`，request/decision 目标配对在 `:1711-1758`；18 个合法决定与跨 subject 负例通过 |
| 11 | 公共契约保持 Zod SSOT 和完整追踪 | PASS | DTO 均由 strict Zod Schema 派生；`ports → events/workflows` 单向导入；`package.json:26-37` 提供三个明确子路径；RI/RA 追踪与依赖门禁通过 |

## 重点横切复查

| 检查点 | 结果 | 证据 |
| --- | --- | --- |
| 所有 port 成功分支 | PASS | 独立矩阵对 `ports/index.ts:1773-2013` 的 45 个成功分支逐项 `safeParse`，45/45 通过；目标测试同时覆盖方法级错配反例 |
| 复核决定闭合联合 | PASS | 18 个合法 subject/decision 组合全部接受，跨 subject 决定拒绝；源码 `ports/index.ts:1589-1758` |
| 授权与因果运行 | PASS | human 可无父运行；system/Agent 必须有 `WorkflowRunRefV1`；actor/project/capability 越界拒绝，8 项矩阵全部符合预期 |
| RA-S1 适用性元数据快照 | PASS | `assess` 与 `historical-backfill` 都在 `ports/index.ts:1391-1419` 强制 `ApplicabilityMetadataSnapshotRefV1`；有/无快照四项矩阵通过；冻结快照在 `workflows/index.ts:115-132` 继续保留 |
| waiting / WorkflowRunRef / ResponseRecommendation SSOT | PASS | `workflows/index.ts:406-472,505-581` 强制 waiting 一致性；顶层子运行和事件运行均用 `WorkflowRunRefV1`；评估状态和 A8 复用 `ResponseRecommendationRefV1Schema`（`:346,524`） |
| Agent 负例 | PASS | validation-only、no-output、跨任务、多主产物、错误 validation、失败/取消夹带产物均拒绝；合法失败可通用、合法取消不带产物 |
| RI-S1～RI-S6 | PASS（契约层） | design `:645-650` 的 port → I0-I9 → 事件/结果映射均能定位；I0-I9 与 accepted-risk event 运行时覆盖通过 |
| RA-S1～RA-S7 | PASS（契约层） | design `:651-657` 的 port → A0-A9/独立入口 → 事件/结果映射均能定位；A0-A9、评估后预警及预测/反馈/校准引用通过 |
| 禁止开放 DTO | PASS | 生产 Schema 未出现 `z.record`、`z.any`、`z.unknown`、`.passthrough()`、开放 payload、通用 `execute`、JSON Patch 或正文状态；局部 TypeScript `unknown` 仅用于 refinement 入参，不构成 DTO 字段 |
| 依赖方向与 Non-Goals | PASS | `deps:check`/`deps:policy` 无违规；contracts 未依赖 core/adapters/apps/LangGraph/基础设施；未实现领域逻辑、Outbox、checkpointer、HTTP/SSE、Agent runtime 或投影 |

## 验证命令与结果

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` | PASS：1 file，10 tests |
| `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` | PASS |
| `pnpm exec eslint packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts` | PASS |
| `pnpm exec prettier --check packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts packages/contracts/package.json` | PASS |
| `pnpm deps:check` | PASS：20 modules、27 dependencies、0 violations |
| `pnpm deps:policy` | PASS：`dependency policy: OK` |
| `openspec validate define-module-interfaces-events-and-workflows --strict --no-interactive` | PASS |
| 从 `packages/contracts` 动态导入 `@riskflow/contracts/{ports,events,workflows}` | PASS |
| 独立 Node `safeParse` 运行时矩阵 | PASS：120/120 expectations matched |
| `git diff --check` | PASS（报告写入前；报告写入后再次执行） |

未运行根 `pnpm verify`：C02 design §14 与 handbook 将根级复验留给主调度 Agent 在 integration/main 检查点决定；本 worker 已完整执行任务明确列出的 C02 局部门禁。未启动开发服务器。

## 范围与剩余风险

- checkpoint 相对 planning checkpoint `0e3b72d` 的实现文件仅为 `packages/contracts/src/{ports,events,workflows}/index.ts`、目标契约测试与 `packages/contracts/package.json`，以及本 change 的 design/tasks/verification 工件；禁止的 C01 三模块、根 barrel、主 specs、配置、依赖和锁文件差异为空。
- 当前工作树唯一改动为本报告；未修改生产代码、测试、proposal、delta spec、design、tasks、package、lock、config，未提交、归档、启动服务或派发子任务。
- C02 只冻结契约。事务原子性、至少一次消费幂等、实际授权收窄、领域计算和 LangGraph 执行仍由 C03 及后续 changes 实现与验证，不是本次缺失。
