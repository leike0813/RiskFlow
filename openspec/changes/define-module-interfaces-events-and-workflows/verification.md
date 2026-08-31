# Verification Report: define-module-interfaces-events-and-workflows

验证日期：2026-08-31  
固定 implementation checkpoint：`d83bca6 fix(contracts): 收紧 C02 契约边界`

## 结论

**不通过。当前 checkpoint 不可归档，也不应开放 G1。**

旧报告中的 C1–C8/W1–W3 已在本 checkpoint 的定向反例中通过修复回归检查；但对 design 中全部 port 成功结果、工作流入口和 Agent 产物组合继续逐项检查后，发现 7 个新的 CRITICAL。它们均可由运行时 `safeParse` 反例或源码直接证明。

本报告由独立复验 worker 已执行的命令、反例输出和当前文件状态汇总。该 worker 在完成主要检查后误进入与 C02 无关的 MinerU 读取，未能自行落盘报告，随后由主调度终止；因此本报告不把 worker 的未发送完成信号当作通过依据。

## CRITICAL（归档前必须修复）

### C1. 知识治理 `request-review` 没有可表达的成功结果

- `openspec/.../design.md:202-210` 将 `request-review` 纳入 `KnowledgeModelingPortV1.govern`，成功结果允许返回“任务引用”，应为 `ReviewTaskRefV1`。
- `packages/contracts/src/ports/index.ts:1801-1811` 的 `KnowledgeGovernanceSuccessV1Schema` 只接受 `revision`、`release`、`preparation` 三个分支；没有 review task 分支。
- 独立运行时探针：`KnowledgeGovernanceSuccessV1Schema.safeParse({ kind: "review-task", reviewTaskRef }).success === false`。
- 虽然 `ReviewRequestSuccessV1Schema` 在 `:1916-1919` 可表达 `reviewTaskRef`，但它没有被知识治理方法结果引用，导致 design 声明的 port 分支仍无法闭合表达。

### C2. 复核追踪不能返回 design 允许的查询结果引用

- `design.md:270-276` 允许 `ReviewAuditPortV1.trace` 返回 `AuditTrailRefV1` 或获准查询引用。
- `packages/contracts/src/ports/index.ts:1926-1927` 的 `TraceSuccessV1Schema` 只接受 `{ auditTrailRef }`。
- 独立运行时探针：`TraceSuccessV1Schema.safeParse({ queryResultRef }).success === false`。
- `QueryResultRefV1Schema` 已由公共 ports 导出，但没有进入 Trace 成功结果联合；调用方无法用 design 指定的授权查询结果完成追踪。

### C3. `adopt-recommendation` 成功结果缺少预测运行入口引用

- `design.md:262-268` 要求 `record(adopt-recommendation)` 返回决定与预测运行入口引用。
- `packages/contracts/src/ports/index.ts:1902-1904` 的 adoption 分支只接受 `routeDecisionRef`，没有预测运行入口字段。
- 独立运行时探针中，带 `forecastRunRef: WorkflowRunRefV1` 的结果被拒绝；带 `ResponseForecastInputSnapshotRefV1` 的结果同样被拒绝。
- 这会丢失 RA-S7 采纳后预测的可追踪入口，后续 forecast-response 工作流无法从该 port 成功结果获得正式衔接引用。

### C4. Agent 完成结果的产物组合仍是开放的

- `packages/contracts/src/ports/index.ts:678-754` 把 `incrementRef`、`candidateRef`、`validationRef`、`formalResultRef` 都定义为任意 `ContractReferenceV1` 可选字段，只对少数字段做排除检查。
- 独立运行时探针证明 `retrieval-review` 可以接受任意 `audit-trail` 作为 `incrementRef`，也可以同时接受跨任务的多个产物族；探针结果分别为 `true`、`true`。
- 当前检查只禁止部分字段，并没有建立任务类型 → 合法增量/候选/验证/正式结果的闭合映射。因此 Agent 仍可提交不属于任务类型的产物，违反 design `:72-86` 与 `:270-287` 的任务专属结果约束。

### C5. 识别 finalize 的 `skipped` 结果使用了错误引用类型

- `design.md:228-234` 和识别阶段契约要求跳过的合并组由 `IdentificationGroupRefV1` 标识。
- `packages/contracts/src/ports/index.ts:1864` 将 `skippedGroupRefs` 声明为 `z.array(MergePlanRefV1Schema)`。
- 独立运行时探针：传入 `IdentificationGroupRefV1` 被拒绝，传入 `MergePlanRefV1` 却被接受。
- 这让 I8/I9 的“跳过组”无法保留实际组标识，并把计划引用误当成事实组引用，破坏识别结果追踪。

### C6. `historical-backfill` 入口可缺少 RA-S1 适用性元数据快照

- AGENTS.md 的 RA-S1 要求施工工法、地层条件、工程阶段的适用性元数据，并要求评估记录保存快照；`design.md:540-547` 将历史回填定义为评估入口。
- `packages/contracts/src/ports/index.ts:1407-1418` 的 `historical-backfill` payload 没有强制 `applicabilityMetadataSnapshotRef`，只要求风险输入、effective-at 和评估依据引用。
- 独立运行时探针：历史回填 start payload 缺少该快照时仍返回 `success: true`。
- 因此历史评估可以脱离 RA-S1 适用性上下文创建，历史记录不可重放且可能套用错误规则。

### C7. 顶层图状态允许非 waiting 状态携带 `waitingRefs`

- `packages/contracts/src/workflows/index.ts:406-472` 的 `lifecycleStateRefine` 只禁止非 waiting 状态携带单数 `waitingRef`，没有禁止数组 `waitingRefs`。
- `RiskFlowGraphStateV1Schema` 在 `:547-581` 定义了 `waitingRefs`，但只在 `status === "waiting"` 时检查非空。
- 独立运行时探针：`status: "running"` 且 `waitingRefs` 非空的顶层状态被接受，结果为 `true`。
- 这会产生“运行中但存在待复核引用”的不一致状态，无法可靠驱动暂停/恢复路由；应保证 waiting 引用只在 waiting 状态出现。

## 已通过的定向检查

- 复核决定 Schema 的重复 discriminator 已修复，`ReviewDecisionCommandV1Schema.safeParse` 不再因重复 `reject` 抛异常，subject/target/decision 的错误配对被拒绝。
- 上一报告 C2 中的 monitoring batch、external risk event、assessment basis、repair-and-validate 和 deviation unavailable 结果均已能由对应成功结果 Schema 表达。
- system/Agent 因果运行、信封 actor/project 一致性和 branch capability 映射已通过定向反例。
- `assessment-preparation`、`assess` 入口及冻结快照的 RA-S1 引用已强制；I1/A1 不能形成空 ready/waiting 状态。
- 顶层识别/评估子运行字段使用 `WorkflowRunRefV1`；assessment graph 的 `responseRecommendationRef` 复用 `ResponseRecommendationRefV1Schema`。
- 三个公开子路径可以从 `packages/contracts` 工作目录动态导入。
- 生产 DTO 没有发现 `Record<string, unknown>`、`z.unknown()` payload、`.passthrough()`、JSON Patch、通用 `execute`、数据库/文件系统/HTTP/Agent runtime 或 LangGraph 实现。

## Requirements 逐条核对

| # | Requirement | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | 六个领域模块只暴露用例级 interface | **FAIL** | C1/C2/C3 使已声明 port 成功结果不闭合 |
| 2 | 应用模块只能组合领域 interface | **PASS（契约层）** | 未发现跨层基础设施依赖或开放式执行入口 |
| 3 | 每次跨模块调用携带冻结授权上下文 | **PASS（已修复面）** | 因果运行、actor/project 和 branch capability 反例通过 |
| 4 | 命令、结果和错误具有稳定幂等语义 | **PASS（契约层）** | 命令/错误/版本引用约束通过；运行时幂等由后续 change 负责 |
| 5 | 已入库事实通过事务领域事件衔接 | **PASS（契约层）** | 十类事件及元数据闭合；事务实现由后续 change 负责 |
| 6 | 识别工作流具有 I0 至 I9 的版本化阶段契约 | **FAIL** | C5 使 skipped 结果引用错误 |
| 7 | 评估工作流具有 A0 至 A9 的版本化阶段契约 | **FAIL** | C6 允许历史入口缺少 RA-S1 上下文 |
| 8 | 图状态只保存小型版本化引用 | **FAIL** | C7 允许不一致 waiting 引用状态 |
| 9 | 暂停、恢复、重试和取消保持业务事实完整 | **FAIL** | C7 破坏顶层暂停/恢复状态语义 |
| 10 | Agent 与人工复核使用不同引用和决定边界 | **FAIL** | C4 仍允许任务无关 Agent 产物组合 |
| 11 | 公共契约保持 Zod SSOT 和完整追踪 | **FAIL** | C1/C2/C3/C5/C6 造成结果字段和追踪链断点 |

## RI-S1～RI-S6 与 RA-S1～RA-S7 追踪摘要

| 追踪 | 结果 |
| --- | --- |
| RI-S1～RI-S4 | 已有工程接入、知识解析、工序/机理/检索引用；定向检查通过 |
| RI-S5 | **部分通过**：识别 Agent/检索引用存在，但 C4 任务产物边界未闭合 |
| RI-S6 | **部分通过**：入库结果引用存在，但 C5 skipped 组引用类型错误 |
| RA-S1 | **失败**：C6 的 historical-backfill 可缺少适用性元数据快照 |
| RA-S2～RA-S6 | 已有指标、规则、确定性评估和预警引用；本 checkpoint 定向检查通过 |
| RA-S7 | **失败**：C3 缺少采纳后的预测运行入口，C4 影响处置 Agent 产物边界 |

## 验证命令与结果

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` | PASS |
| `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` | PASS：1 file，10 tests |
| C02 ports/events/workflows/test 的 ESLint | PASS |
| C02 生产文件、测试和 package.json 的 Prettier check | PASS |
| `pnpm deps:check` | PASS：无 dependency violations |
| `pnpm deps:policy` | PASS |
| `openspec validate define-module-interfaces-events-and-workflows --strict --no-interactive` | PASS |
| 从 `packages/contracts` 动态导入 `@riskflow/contracts/{ports,events,workflows}` | PASS |
| C02 运行时反例探针 | **FAIL**：C1～C7 均复现错误拒绝或错误接受 |
| `git diff --check` | PASS（实现提交范围）；待本报告提交后重新执行 |

未运行根 `pnpm verify`；当前 C02 公共契约仍有 CRITICAL，根级构建不能替代上述契约反例。未启动开发服务器。

## 范围与后续

- 实现 checkpoint 的生产改动仍局限于 C02 所有权文件；未修改 C01、根 barrel、依赖、锁文件、配置或主 specs。
- 不勾选 tasks 7.2，不合并 feature branch，不归档 change。
- 应在同一 change、同一 feature worktree 由 Luna 修复 C1～C7，补充对应最小高价值反例；形成新的 implementation checkpoint 后重新执行独立验证。
