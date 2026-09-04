# C08 统一有界 Agent Runtime 收口交接报告

## 范围

本轮在 `leike0813/c08-agent-runtime-fix3` 上完成独立复核报告所列运行时修复，并在最终收口审阅中补齐工具闭环、取消传播与预算计量缺口。当前分支基线提交为 `318cde0`，本报告随最终 C08 检查点一并提交。

## 已完成

- **正式结果收口**：`AgentTaskDefinitionV1.finalizeCandidate` 已成为必需定义；模型动作只能在候选通过确定性校验并完成正式结果收口后完成任务。新增 `primaryReferenceFromAgentTaskResult` 统一提取结果主引用。
- **模型工具循环**：结构化模型结果支持受注册工具白名单约束的工具请求；读取型工具允许仅返回观察工件，工具观察完成后回到模型步骤，不能把模型或工具中间结果当作正式结果。恢复会重建已完成的模型工具请求与工具观察，继续原循环。
- **恢复路径**：已记录 `started` 的领域工具动作从持久化意图工件读取原始 `toolRef` 与输入，并把原始类型化输入传给恢复端口；无法读取或解析意图时进入 `AGENT_ACTION_UNCERTAIN`。
- **硬预算**：模型动作按剩余 token、上下文、输入输出字节、候选、对象和修正预算预留；领域工具按剩余输入输出字节及声明的最小资源用量预留；候选至少计入一次，候选版本大于 1 时计入一次修正；模型网关真实 usage 与回调 usage 取上界，缺失 token 用量按预留量结算，模型与工具输入输出字节按实际 JSON 计量，避免低报。
- **候选父版本**：候选 DTO 要求 `parentCandidateVersion`；PostgreSQL 收口同时校验候选版本递增和父候选版本等于当前最新版本。
- **墙钟截止**：模型、工具、恢复、确定性校验与正式结果收口通过 `AbortSignal` 竞速；调用方取消会传播到当前动作；截止后记录 `AGENT_WALL_CLOCK_EXCEEDED`，失败结算保留实际活动墙钟时间，不再把超时值截断为预算上限。
- **规格同步**：C08 design 中同时列出 `000005_agent_task_runtime.ts` 与现有 `000006_agent_proposal_artifact_ref.ts` 迁移。
- **回归夹具**：Worker 恢复测试使用合法授权上下文和持久化原始意图工件，覆盖精确恢复路径。

## 验证证据

在最终 C08 精确工作树上已运行：

- `openspec validate deliver-unified-bounded-agent-runtime --strict --no-interactive`：通过；当前 OpenSpec CLI 没有独立 `verify` 子命令，因此独立 verify 采用逐条规格/场景审阅、目标回归和 strict validate 完成。
- `pnpm exec vitest run packages/core/test/agent-runtime/agent-runtime.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts apps/worker/test/agent-runtime/runner.test.ts --testTimeout=240000`：3 个测试文件、20 个测试通过。
- `pnpm verify`：构建、类型检查、Lint、格式检查、全量测试、依赖检查、依赖策略与 OpenSpec 全量严格校验通过；16 个测试文件通过、1 个 smoke 跳过，181 个测试通过、1 个跳过；108 个模块、243 条依赖、0 个违规；OpenSpec 11 项通过、0 项失败。
- `git diff --check`：通过。

## 集成边界

- 本轮只提交 `c08-agent-runtime-fix3` 中属于 C08 的实现、测试、design 与本报告。
- 不合并 `main`，不归档 OpenSpec，不修改其它工作树。

## 后续集成

1. 由主调度审阅本检查点后把 C08 集成到 `main`，再按 OpenSpec 流程执行归档。
2. 本报告不构成归档授权；真实 llama.cpp 服务 smoke 仍以显式环境配置为前提。
