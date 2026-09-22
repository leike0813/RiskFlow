## Why

C15、C17、C21、C22 与 C23 已分别提供可冻结的识别准备、识别知识、五项上下文、候选收口和人工复核能力，但生产系统尚无实现既有 I0～I9 契约的 `identificationGraph` 将这些能力组合成可暂停、恢复和重放的完整识别运行。C24 需要补齐这一编排与业务运行事实层，才能把 `engineering.inputs-ready.v1` 可靠推进为标准化风险记录和评估事件。

## What Changes

- 新增唯一的生产 `identificationGraph`，按现有 `WorkflowPortV1`、`RiskIdentificationPortV1` 与 `IdentificationGraphStateV1` 契约推进 I0～I9，并仅通过上游公开窄端口组合 C15/C17/C21/C22/C23。
- 冻结识别输入快照、工序工作计划与工作项，持久保存阶段/运行结果、等待和错误引用；LangGraph checkpoint 继续与业务事实分离，不能补造业务记录。
- 接收父运行已绑定的输入就绪事实，并消费 Agent 完成和人工复核解决信号，支持同线程、同冻结版本、同幂等身份的暂停/恢复、技术重试与协作式取消；单个失败或待复核分组不阻塞其它已合格分组入库。
- 在 Worker 组合根接入 C21 检索审阅、C22 候选收口与 C23 复核恢复，补充真实 PostgreSQL、检查点恢复和端到端识别图行为验证。
- 经协调批准新增并精确锁定 `@langchain/langgraph@1.4.17`，同步依赖治理记录和锁文件；新增 C24 自有 `000043` 业务迁移，不修改既有公共 DTO、事件或权限枚举。

## Capabilities

### New Capabilities

- `identification/graph`: 规定 I0～I9 识别图的冻结输入与计划、阶段编排、等待/恢复/取消、业务运行持久化、检查点隔离和端到端收口行为。

### Modified Capabilities

无。

## Impact

- **代码所有权**：新增 `packages/core/src/identification/graph/`、`packages/adapters/src/identification/graph/`、`apps/worker/src/identification/graph/` 及对应测试；修改三个包的公开导出/依赖接线和 Worker 根导出。
- **持久化**：新增 `packages/adapters/src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.ts`，只追加保存识别输入、工作计划/工作项、阶段与运行结果及其审计/幂等关联；LangGraph 继续复用 C03 的独立 checkpointer schema。
- **依赖**：`apps/worker` 新增精确直接依赖 `@langchain/langgraph@1.4.17`；更新 `pnpm-lock.yaml` 与 `config/dependency-policy.json`。该版本的 registry peer 范围接受现有 `@langchain/core@1.2.9`，其 `@langchain/langgraph-checkpoint@^1.1.5` 依赖可复用当前锁定的 `1.1.5`，无需改变 `@langchain/langgraph-checkpoint-postgres@1.0.5`。
- **不变边界**：不修改 `packages/contracts/**`、C05/C06 权限映射、C03 checkpointer 内部表、C15/C17/C21/C22/C23 的事实所有权，也不实现顶层 `riskFlowGraph`、评估图、API、Web 或查询投影。
