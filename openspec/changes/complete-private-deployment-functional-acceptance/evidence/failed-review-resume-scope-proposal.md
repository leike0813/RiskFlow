# 终态检索审阅的公开失败收口提案（已批准）

用户于本轮明确批准本提案，并持续授权后续同类修复。当前设计与施工图已纳入D-105/IP-19，实施及验收证据另记；本提案只解决原工作项失败通知。

## 已复现的边界

v109第四个检索审阅任务已终态失败，原父、子运行仍等待该精确任务。D-104修正后的一次模型诊断通过，不能替代原任务结果，也不能使终态任务重新运行。

- `packages/contracts/src/ports/index.ts` 的 `ResumeCauseV1Schema` 要求 `agent-task-completed` 携带 `agentTaskResultRef`，结果联合虽然允许failed，但C08失败路径没有该引用。
- `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 的 `failTask` 保存错误与终态，不设置resultRef；`readTerminalFailure`可按当前权限读取真实终态证据。
- `apps/worker/src/identification/graph/runtime.ts` 的resume对携带结果引用的任务要求completed及持久化结果完全匹配。
- `apps/worker/src/identification/graph/graph.ts` 的stageI3已经实现终态任务记入failedWorkItemRefs、移除当前pending项并继续余项；公开调用不能触达这一分支。
- `apps/worker/src/risk-flow/runtime.ts` 转交公开原因，不能绕过C24的结果绑定。

主规格要求终态不可逆、失败保留证据且阻止该项形成正式上下文。没有已规定的失败通知恢复原因，也没有终态重开或新尝试替换原工作项的协议。直接构造failed resultRef、调用内部可省略结果的resume，或重开整批均不作为正式功能取证路径。

## 建议的最小契约

为既有 `workflow.resume-run` 增加类型化原因 `agent-task-failed`，只携带精确 `agentTaskRef`，不由调用方提交错误正文、预算、结果或新任务。当前范围仅消费识别图正在等待的retrieval-review任务。

服务端复验当前权限、工程、发起者、父子运行与等待任务绑定，并从C08取得真实terminal-failure证据；pending/running/retryable-failure/completed、错任务、错工程和撤权均拒绝。只有证明终态失败后才进入原stageI3失败分支，保留既有成功项、失败项、原任务预算与审计；当前项不生成上下文/风险候选，原批次仅继续剩余项。相同命令沿既有收据幂等，过期状态沿既有版本冲突处理。

不新增任务状态、数据库字段、迁移、依赖、模型调用或重试额度；不重开失败项、不关联替代任务、不改C08终态事实，不把局部成功报告成完整通过。取消任务的公开通知不纳入本次提案。

## 计划文件范围

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/ports/index.ts`、`packages/contracts/test/contract-kernel.test.ts` | 定义上述精确任务引用的公开原因，验证合法载荷与越界字段拒绝 |
| `packages/core/src/identification/graph/ports.ts` | 定义C24对应的类型化失败通知 |
| `apps/worker/src/risk-flow/graph.ts`、`runtime.ts`及既有runtime测试 | 父图识别该通知并保留身份转交C24，拒绝与当前等待不匹配的任务 |
| `apps/worker/src/identification/graph/graph.ts`、`runtime.ts`及既有runtime/nested-boundary测试 | 复用当前任务读取与绑定，验证真实失败后进入原I3失败收口，验证零替代结果与已完成工作保留 |
| 仅在现有端口不能满足所属读取授权时，`scripts/deployment/composition/identification.mjs`及其既有测试 | 接入C08已有失败证据窄读，不读取或改写C08私有表 |
| 本change的domain/module-interfaces-events-workflows、identification/graph、relationship-context-and-retrieval-agent-review delta及design/implementation-plan/tasks/handoff | 明确失败通知与原工作项收口场景，更新批准范围和证据映射 |

批准后先核对精确现有测试路径与端口接缝，再按IP-19更新施工图；如需计划外公共字段、持久化或其它文件，继续升级。

## 验证及正式续办

扩展现有测试，先复现“父等待真实失败任务无法经公开命令收口”；修后覆盖合法失败通知、非终态/错任务/错父运行/错工程/撤权拒绝、重复命令零重复工作，以及一项失败后成功项和原预算保留。执行相应contracts/C24/C30回归、build/typecheck/lint/format、change strict与diff检查。

之后冻结新制品，沿当前v109父运行的实际状态，以正式HTTP命令通知已失败的第四项；只继续本批次第五项，不创建替代第四项或新整批。到达human-review后再完成真实人工复核及后续评估。若其它确定性校验拒绝，记录真实原因，不把该提案视为后续场景PASS。
