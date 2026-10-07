## Why

C41 采纳正式建议后恢复 `forecast-response` 运行时，把 `expectedStateVersion` 取成绑定里的运行引用版本（运行登记摘要），而 C30 恢复时比对的是运行**当前状态版本**（`cursor.runVersionId`）。两者不是同一个值，运行进入 assessment 阶段后必然以 `STALE_VERSION` 关闭，采纳闭环永远走不到效果预测。C30 的 `startRun` 等待结果只交出 `workflowRunRef`，没有把运行停在等待点时的状态版本交出来，C41 按契约无从取得该值；这是 C30 与 C41 两个已归档 change 之间的契约缺口。

## What Changes

- C30 公共 `startRun` 的等待结果在已登记真实运行引用的同时，追加该运行**停在等待点时的运行状态版本**（`waitStateVersion`），与等待引用同一事务事实，不额外读一次状态。
- C41 把该等待点状态版本冻结进采纳绑定（`VerifiedResponseWorkflowBindingV1`）与终局采纳决定（`HumanResponseDecisionV1`），并在恢复时以它作为 `expectedStateVersion`；绑定与决定两份记录取同一值，避免恢复路径之间再出现两个口径。
- C30 精确绑定证明在回读绑定时同时核对该状态版本属于该运行；错配即失败闭合，不按“当前最新值”猜测。
- 恢复路径的行为边界不变：**预期状态版本陈旧仍 MUST 拒绝**（design D-08 的运行版本断言），同键异载荷仍拒绝，恢复仍沿用原线程、冻结输入、图版本与业务幂等身份。本 change 不放宽任何版本或幂等断言，只补齐「等待点状态版本」这一缺失事实。
- 非 **BREAKING**：新增字段均为可选，缺失时恢复按既有「预期版本陈旧即拒绝」收口，不会静默改按运行登记摘要恢复。

## Capabilities

- Modified: `domain/module-interfaces-events-workflows`（`startRun` 等待结果交出等待点状态版本；恢复的预期状态版本来源明确为该版本）。
- Modified: `domain/human-decision-and-feedback-command-wiring`（采纳绑定与终局决定冻结等待点状态版本，并据此恢复）。

## Impact

- 契约与 Schema：`packages/contracts/src/ports/index.ts`（等待结果联合与 `ResumeWorkflowRunCommandV1` 语义注释）、`packages/core/src/workflow/schema.ts`、`packages/core/src/response-lifecycle/schema.ts`、`packages/core/src/human-decision-feedback/schema.ts`。
- 领域逻辑：`packages/core/src/workflow/service.ts`（等待结果与恢复预期版本的对账口径）、`packages/core/src/human-decision-feedback/service.ts`（冻结与恢复）。
- 运行时：`apps/worker/src/risk-flow/runtime.ts`（等待分支交出状态版本）、`apps/worker/src/risk-flow/graph.ts`（等待点的状态版本来源）。
- 适配器与测试：`packages/adapters/src/workflow/postgres-workflow-adapter.ts`、`packages/adapters/test/workflow`、`packages/adapters/test/response-lifecycle`、`packages/adapters/test/human-decision-feedback`、`packages/core/test/workflow`、`demo/test/browser/assessment-warning-response.spec.ts`。
- 无新增依赖、无新增表或迁移：状态版本已存在于 `business.workflow_graph_results.run_version_id` 与运行状态正文的 `runVersionId`，本 change 只把它交到公共端口上。
- 阻塞面：`deliver-assessment-warning-and-response-ui` 的 4.1/4.2/4.4 验收在本次修复前不能勾选。
