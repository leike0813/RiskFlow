## Context

固定输入 HEAD：`d4f926fd578648ab639153a5a44c6ee82cc2ca50`。C24 的 `createIdentificationGraph` 以 C03 checkpointer 编译，`runtime.runGraph` 在捕获 `GraphInterrupt` 后直接上抛；`readCheckpointState` 只以子 `thread_id` 回读。已审阅但尚未集成的 C30 检查点 `1ee42ebbf15968f7bb36df030937fae8afa5c7f6` 中，父图识别节点直接调用 `IdentificationGraphRuntimeV1.start`。LangGraph 1.4.17 在节点内嵌套调用另一张图时，把父图执行上下文中的 `__pregel_checkpointer` 传给子图；子图编译时注入的 saver 因而没有实际承载子检查点。

规划期用临时合成测试在本 HEAD 的真实 C24 夹具上复现：C03 PostgreSQL checkpointer 承载父图，父节点调用 C24 `runtime.start` 后，父检查点 `status=running`（期望 waiting）；同一 C24 命令重试报 `CONTRACT_INVALID:graph-state-invalid`。另一诊断在父图使用 `MemorySaver` 时查询 C03 `langgraph_checkpoint.checkpoints`，子线程为零行、`getState` 为 `{}`；仅在调用配置显式传入 C24 saver 与根命名空间后，子线程出现 15 个根命名空间检查点，最新状态为 `waiting`、`stage=I8`、`next=[wait]`。临时测试已删除；实施须把可重复的失败与修复证据固化为正式行为测试。C30 指定同容器验收文件尚未进入本 HEAD，实施/收尾只在其合并后运行。

## Goals / Non-Goals

**Goals:** 父节点获得 C24 已登记且可核对的等待结果；C24 所有图执行与回读使用自己的子线程和 saver；同身份重试及复核恢复仍按既有冻结版本、授权和幂等规则执行。

**Non-Goals:** 不改 C30 父图捕获逻辑、C03 checkpointer 实现、C22 写路径、公共契约、权限、迁移、依赖或评估流程；不从图检查点创建业务事实。

## Decisions

### D-01：C24 图调用固定自己的检查点执行上下文

`apps/worker/src/identification/graph/graph.ts` 中 `createIdentificationGraph` 的 `invoke`、`resume`、`retry`、`recover` 和 `getState` 均使用同一私有配置归一化：`thread_id` 仍来自 C24 `identificationRunIdentityFor`，`checkpoint_ns` 固定为根命名空间 `""`，LangGraph 内部 `__pregel_checkpointer` 显式绑定已注入的 `options.checkpointer`；`durability: "sync"` 继续保留。只在此 C24 包装边界设置该内部键，不向 C02 公共 DTO 或上游端口暴露。所用键是当前锁定 `@langchain/langgraph@1.4.17` 已实际读取的运行配置，实施时须用真实嵌套图测试证明，而非只依赖静态源码推断。

根命名空间加稳定子线程与现有独立 C24 运行身份一致，也让父图的线程/命名空间继续由父图所有。备选方案是让子图沿用父图 saver 或在 C03 按父命名空间猜子状态；这会混合两个图的所有权，并使子命令重试找不到原状态。规划期诊断已证明 C24 显式绑定足以获得合法子检查点，因此不修改 C03 校验、表或角色。

### D-02：已落库的子图中断在 C24 运行时收口为等待结果

`apps/worker/src/identification/graph/runtime.ts` 的 `runGraph` 仅在识别出 LangGraph `GraphInterrupt` 时读取 D-01 精确子检查点，检查其线程、运行、父运行、冻结版本、`status=waiting` 和非空等待引用，并以当前授权调用既有 `reconcileCheckpointReferences`，再与 C24 最新只追加运行状态核对阶段、等待引用和版本。全部成立才返回该 `IdentificationGraphStateV1`，外层 `outcomeOf` 沿既有 `IdentificationGraphRunOutcomeV1` 返回；父图随后执行自己的业务登记和检查点写入。普通节点失败、`ParentCommand` 等其它控制异常不得被改写成等待。

若中断发生而子检查点尚未确认，按现有可重试基础设施错误停止；检查点身份、状态或业务引用不一致按既有不可重试 `CHECKPOINT_INCONSISTENT` 类语义停止，绝不从业务游标伪造一份成功等待状态。父图不能靠 catch/retry 自救：中断在父节点返回状态更新前穿透，父检查点已停在旧 `running`，而子图此前又继承父 saver，原身份重试读取不到合法子检查点。C30 的通用 GraphInterrupt 捕获并不拥有 C24 业务事实与子线程，不能安全修正这个边界。

### D-03：重复启动和恢复沿同一子检查点与业务事实对账

`start` 的同载荷回执重放仍先读取原 C24 子线程的精确检查点；等待状态须与最新 C24 业务游标、等待引用、冻结身份一致，才返回原 `runVersionId` 和 `existing` disposition。`resume` 沿现有授权、等待种类/版本、零结果证明和业务领先一节点恢复逻辑运行；其 `Command.resume` 经 D-01 进入原子运行的根命名空间。相同恢复信号仍返回首次回执；撤权、错工程、错引用、旧版本或检查点缺失不得用父图状态、旧授权或新任务替代。

复用现有 `readCheckpointState`、`readCursor`、`reconcileCheckpointReferences`、`outcomeOf`，只提取必要的共享核对逻辑，避免在 start/retry/resume 分支分别发明等待判断。C24 业务事实、C03 事务与审计/Outbox、C04 工件读写及 C05 权限复验顺序不变；不增加新的状态字段或错误码。

### D-04：所有权、兼容与可运行证据

生产修改仅 `apps/worker/src/identification/graph/{graph,runtime}.ts`；行为测试修改 `apps/worker/test/identification/graph/runtime.test.ts`，新增一个最小父子图测试 `apps/worker/test/identification/graph/nested-boundary.test.ts` 并复用现有 `fixture.ts`。测试使用合成样本、待甲方复核；父图采用真实 `StateGraph` 与同容器 C03 PostgreSQL checkpointer，C24 使用现有真实适配器，验证父/子检查点分别为等待、子线程精确回读、同命令重试、决定恢复、撤权、错误命名空间、检查点写失败和无重复业务副作用。测试只断言状态、引用、错误类别和数据库事实，不锁定 LangGraph 内部节点调用顺序。

本次不迁移历史业务行或检查点。既有单图 C24 根命名空间与子线程保持原样可重放；父图嵌套失败产生的旧子检查点若不能通过 D-03 精确对账，拒绝把其升级成合法等待，须按原命令/版本的运维诊断处理，不改写历史。`@langchain/langgraph`、C03 saver 与 PostgreSQL 版本不变。若真实测试证明 D-01 无法在当前 LangGraph 版本隔离父执行上下文，停止并升级已获准的限定 C03 方案，不能在本实施中临时增依赖或放宽检查点校验。

## Risks / Trade-offs

- `__pregel_checkpointer` 是 LangGraph 内部配置键；测试必须覆盖锁定版本的真实嵌套执行及重试，依赖升级另开评估。
- 业务提交与检查点仍分两步；D-02 只承认已确认的子检查点，检查点落库失败时短暂返回技术错误，防止错误成功。
- C30 未进入本 HEAD，C40 用自包含父子图测试作为实施硬门；集成后再运行 C30 实际同容器路径，不能把规划期临时测试或 C30 的替身测试冒充终验。
