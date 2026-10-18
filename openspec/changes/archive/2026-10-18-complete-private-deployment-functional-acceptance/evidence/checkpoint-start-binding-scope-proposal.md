# C30 启动绑定读取修正提案

状态：用户已批准修复并继续验收；不新增公共字段、权限、事务或迁移。批准不代表复验已通过。

## 已复现的问题

正式 `workflow.start-run` 在物理验收实例返回 HTTP 503。保留的复现脚本为实例根 `reproduce-workflow-graph-v19.mjs`，多次捕获同一 `PostgresPersistenceError/CHECKPOINT_INCONSISTENT`，阶段为 `checkpointer.reference`。有界诊断确认首个 `workflow-run` 引用在 `readWorkflowRunBinding` 被拒，当前授权、图版本及运行上下文检查已通过。临时诊断已撤除。

`apps/worker/src/risk-flow/runtime.ts` 的 `bindStartRunCommand` 通过 C03 正式提交命令类型 `workflow.start-run`、审计动作 `workflow.start-run-bound`。`packages/adapters/src/postgres/transaction-unit.ts` 的读取却要求审计动作等于命令类型，导致真实绑定无法成立。识别与评估启动命令的动作与类型本就一致，应保持精确原规则。

## 最小修正范围

将以下两个文件补入 IP-21：

- `packages/adapters/src/postgres/transaction-unit.ts`：只在启动绑定读取中，按既有三类启动命令的真实审计动作验证；父工作流只认 `workflow.start-run` 对应 `workflow.start-run-bound`，识别及评估继续要求各自同名动作。保留工程、完整运行引用、线程、actor、授权、父运行及已提交收据/审计关联核验。
- `packages/adapters/test/postgres/postgres-foundation.test.ts`：扩展既有启动绑定测试，覆盖生产动作配对、错配拒绝以及已有跨工程、错版本、错主体、错授权和回滚拒绝。必要的跨调用验证复用已在范围内的 `apps/worker/test/risk-flow/runtime.test.ts`。

不改写原收据或审计，不让不存在或回滚的绑定通过，不更改 checkpointer 校验器，也不改 C06。

## 验证与继续验收

先让现有测试按真实生产动作复现失败，再修读取并运行定向数据库测试及 C30/部署相关回归；执行所属 build、lint、format、OpenSpec strict 和 diff 检查。新制品显式切换后，用原命令重放验证初始检查点可保存，继续真实识别、C11 评估准备、已批准 C19 组装和人工审核/独立发布。后续业务结果另行留证，不能把检查点修复计作整条 RI/RA 已通过。

批准依据：项目 `AGENTS.md` §3 要求计划外文件升级，`implementation-plan.md` §7 目前未列 C03 此文件。已有 IP-21 的普通运行缺陷修复授权覆盖调用侧，但不足以自行扩展此文件边界。
