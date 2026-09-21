## Why

C20 已提供按精确发布版本和当前权限回查事实的双路混合检索，但 `relationship-context` 仍返回未支持，检索结果尚不能经过必经的有界 Agent 审阅和补搜形成 RI-S56 的完整上下文。C21 在 C24 识别图接线之前闭合每个冻结工序工作项的关系检索、检索增量与五项上下文产物。

## What Changes

- 按精确识别输入、工序工作项、工序模型及机理发布读取当前工序、前后工序、受力/资源等依赖和适用风险机理；拒绝跨版本、跨工程、越权或断裂关系，返回可审计的关系检索结果引用。
- 以 C20 双索引混合检索的正式结果为基线，在 C08 `retrieval-review` 任务内执行版本化领域工具白名单下的有限补搜；Agent 只提交类型化证据选择/剔除增量，确定性校验冻结集合、来源、版本、权限和证据后收口检索工件集。
- 由检索审阅的正式产物与关系检索结果组装 RI-S56 五项上下文：工序节点描述、状态参数描述、受力依赖关系、风险机理条目和检索证据；以精确引用和来源定位供 C24/C22 消费，不把排序分数充作置信度。
- 预算、工具、候选规模、失败收口和幂等重试复用 C08/C04/C03；检索审阅失败不得以基线检索或缓存冒充正式结果。使用 C17 已有可选 `retrievalDelegate`，不新增公共分支、权限、代理委派或图状态字段。

## Capabilities

### New Capabilities

- `identification/relationship-context-and-retrieval-agent-review`：精确关系上下文、混合证据的有界 Agent 审阅/补搜、确定性增量和五项上下文可重放产物。

### Modified Capabilities

无。

## Impact

- **依赖**：仅复用已归档 C08 统一有界 Agent、C17 识别知识精确窄读、C20 版本化双索引检索与 C02 既有 `relationship-context`/`retrieval-review` 契约；C03 事务审计、C04 受保护工件、C06 当前权限校验沿用已有能力，不引入新依赖。
- **代码所有权**：新增 `packages/core/src/identification/context/`、`packages/adapters/src/identification/context/`、`apps/worker/src/identification/context/` 及对应测试；为 C21 自有关系结果登记新增单一数据库迁移。既有 C17 façade 只使用已批准的 `retrievalDelegate` 注入点，不修改 C17/C02/C08/C20 的公共契约；C24 负责识别策略集提供者和 I0～I9 图接线，C22 负责 RI-S57 候选生成与后续确定性校验。
- **追踪**：本 change 覆盖 RI-S55～RI-S56；只组装下游候选所需上下文，不创建标准化风险记录、P/C、矩阵或预警事实。甲方脱敏样例未提供时，以标注“合成样本、待甲方复核”的冻结数据集验证边界。
