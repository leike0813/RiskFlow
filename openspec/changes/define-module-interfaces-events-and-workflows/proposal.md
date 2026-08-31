## Why

C01 已冻结跨模块共享记录与通用信封，但六个领域模块、应用模块和 LangGraph 尚无统一的用例级 interface、事务事件与阶段状态契约；若继续下游实现，各 change 会重复定义命令、引用和恢复语义，破坏 G0 契约闸门与端到端追溯。C02 需要在运行基础设施开始前固定这些最小接缝，使后续实现只组合版本化引用，不把领域逻辑或大对象塞入工作流。

## What Changes

- 为工程数据、知识建模、风险识别、风险评估、预警处置、复核审计六个领域模块定义少量用例级 port，并为 Agent 任务、LangGraph 工作流、查询与交付投影三个应用模块定义受限 port；每个分支使用闭合的可辨识联合 Schema，禁止通用 `execute`、任意查询器、JSON Patch 和自由字段袋。
- 定义授权上下文、精确版本引用、业务幂等键、类型化成功/错误结果、Agent/复核引用和依赖方向；调用方权限只能收窄，Agent、工作流、API 与投影均不能成为跨模块存储后门。
- 定义已入库事实产生的版本化领域事件与事务事件信封，固定事实、审计和待发布事件原子提交，以及消费者至少一次投递下的幂等语义；检查点不等于业务入库。
- 定义 `I0`～`I9` 识别阶段、`A0`～`A9` 评估阶段及顶层 `riskFlowGraph` 的版本化 DTO、有限运行状态、暂停/恢复/取消和结果引用；图状态只保存小型标识、精确版本和路由结果。
- 固定 RI-S1～RI-S6、RA-S1～RA-S7 到 module interface、事件和工作流 DTO 的追踪，使标准化风险记录、评估记录、预警与处置只由所属领域模块形成，LangGraph 只编排。
- 增加一个最小契约测试，验证闭合联合、授权与幂等字段、事件因果引用、阶段覆盖、图状态拒绝大对象，以及识别到评估的引用衔接。

明确不在本 change 中实现领域逻辑、数据库/Outbox/checkpointer、HTTP/SSE、Agent 工具循环、LangGraph 图、查询投影、适配器或业务记录；不修改 C01 的 vocabulary/common/records，不增加依赖，也不预建 MCP、外部通知、图数据库或其它空 adapter。

## Capabilities

### New Capabilities

- `domain/module-interfaces-events-workflows`: 规定 RiskFlow 六领域模块与应用模块的用例级 port、授权/幂等/错误边界、版本化领域事件，以及 I0～I9、A0～A9 与顶层工作流引用契约。

### Modified Capabilities

无。

## Impact

- **直接依赖**：已归档 C01 `domain/contract-kernel`；所有 Schema 复用其 `IdentifierSchema`、`VersionReferenceSchema`、`RiskInputReferenceSchema` 和正式记录 Schema，不复制字段事实。
- **下游消费者**：C03～C10 的运行基础设施，以及 C11～C31 的六领域模块、Agent runtime、工作流、API 与查询投影；C24/C30 必须使用本 change 的 I/A 阶段和图状态 DTO。
- **事实所有权**：C02 独占 `packages/contracts/src/ports`、`packages/contracts/src/events`、`packages/contracts/src/workflows` 的跨模块契约；各 port 只引用所属模块事实，不转移或复制事实所有权。
- **计划代码范围**：新增上述三个 `index.ts` 和 `packages/contracts/test/module-interfaces-events-workflows.test.ts`；修改 `packages/contracts/package.json` 仅增加三个子路径 exports。删除文件为零。
- **禁止修改**：`packages/contracts/src/vocabulary`、`common`、`records`、`packages/contracts/src/index.ts`、`packages/core/**`、`packages/adapters/**`、`apps/**`、根配置、主 specs、依赖与锁文件。
- **依赖治理**：无新增依赖；继续复用已锁定的 `zod@4.5.4`、TypeScript、Vitest、ESLint、Prettier 和 dependency-cruiser。
- **RI/RA 追踪**：I0～I9 覆盖 RI-S1～RI-S6，A0～A9 及预测/反馈入口覆盖 RA-S1～RA-S7；事件串起“标准化风险记录已验收入库 → 评估”和“评估记录已入库 → 预警/处置”，不复制上游记录正文。
- **路线偏离条件**：若实施需要新增共享记录字段、改变 C01 XOR 风险输入、引入依赖、增加通用 port/adapter，或让图状态承载业务正文，必须停止并由主 Agent 更新 C02 或另开契约演进 change。
