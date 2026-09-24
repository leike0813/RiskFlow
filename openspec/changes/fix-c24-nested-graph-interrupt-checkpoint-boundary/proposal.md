## Why

C30 父图的识别节点调用 C24 内部运行时；LangGraph 在嵌套执行时可把 C24 的复核等待 `GraphInterrupt` 抛给父图。当前 C24 运行时原样上抛该中断，父图可能未登记自身等待便停止，随后同身份重试也不能可靠读取 C24 检查点，破坏已归档的等待与恢复契约。

## What Changes

- 在 C24 运行时边界把已持久化的子运行等待解释为类型化 `waiting` 结果，使父图按其既有逻辑登记父运行等待；不得把中断当作成功或以异常捕获伪造检查点。
- 令 C24 启动、恢复、重试和检查点读取始终使用同一子运行线程与明确的检查点命名空间；中断后的同身份重试先核对已登记业务事实及子检查点，再沿原身份继续。
- 用真实 LangGraph 与 PostgreSQL checkpointer 验证父图调用、人工复核等待、重复启动、决定恢复及检查点失配的边界；合成样本待甲方复核。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identification/graph`：明确作为父图节点调用时，中断、子检查点与父图等待之间的可观察边界，以及同身份重试的失败闭合行为。

## Impact

- **所有权**：修改 C24 `apps/worker/src/identification/graph/{graph,runtime}.ts` 及相关行为测试；必要时复用既有 C24 测试夹具。C30 已审阅代码只作为未集成的调用方参照，不由本 change 改写。
- **既有契约**：复用 `IdentificationGraphRuntimeV1`、`IdentificationGraphStateV1`、既有等待引用、C03 checkpointer 和 C24 只追加运行事实；不新增公共 DTO、事件、能力值、角色、权限、迁移或依赖。
- **边界**：最小复现表明将 C24 图调用显式绑定到其已注入的 checkpointer 和根命名空间即可得到合法子运行检查点，因此本方案不修改 C03；也不改 C22 写路径或迁移、C30 父图语义、评估图与 Web/API。若实现验证证明必须越过这些边界，先升级并重新批准规划。
- **追踪**：保持 RI-S1～RI-S6 的识别运行暂停/恢复链与 RI-S61～RI-S65 的验收结果审计，不改变评估 RA 流程。
