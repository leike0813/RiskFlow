## Context

见 proposal.md。现有 `status.mjs` 已能从静态 Manifest、Git、OpenSpec 与 Orca 聚合只读状态，但 v1 信封把路线节点当作 change 身份、把 phase 等同 taskKind，并允许创建时预填成功。手册同时混有稳定规则、动态进度与失效接管命令。OMP 18.1.18 已提供自定义工具、`tool_call` 阻断、动态工具集合、上下文事件和 `session_stop`；项目扩展需显式加载，避免不同 worktree 的目录发现差异。

## Goals / Non-Goals

**Goals:**

- 在现有状态聚合器上增加最薄的确定性状态转换和 OMP 接入层。
- 让任意新协调会话从机器状态重建当前可执行队列。
- 迁移当前活动工作并把同一实现检查点同步到所有保留工作树。

**Non-Goals:**

- 不实现通用 Agent 平台、第二套 Orca、独立数据库或长期事件存储。
- 不把提示词守卫描述成操作系统权限边界，也不拦截 Orca 外部 worker 内部的全部行为。
- 不改变首轮实现模型路由，不为普通 Finalizer 修复增加第二次全量验收。

## Decisions

### D-01：Manifest 是稳定策略的唯一机器事实源

扩展现有 `config/orchestration/execution-graph.json`，加入 schemaVersion 2 的角色路由、阶段顺序、审计触发和无进展阈值；手册只解释流程并指向 Manifest。继续使用一个文件，避免新增重复 policy 配置。替代方案是独立 policy 文件，因增加同步面而不采用。

### D-02：v2 信封分离身份、阶段、运行与质量

v2 信封字段固定为：`schemaVersion`、`workItemId`、可选 `routeNodeId`、`changeName`、`taskKind`、`phase`、`runState`、可选 `outcome`、`worktreeId`、`inputHead`、可选 `outputHead`、`owner`、`attemptGroup`、`attempt`、`auditPolicy`、`issueRefs`、`evidenceRefs` 与现有 `main` 集成对象。`outcome` 只在 `runState=settled` 时出现。v1 只在读取时规范化，不再写入。辅助 change 使用 `AUX:<change-name>`，固定路线节点使用 C-ID。

### D-03：当前状态由事实重建，不保存仓库快照

状态命令每次读取 Git、OpenSpec、Orca 与 Manifest；`frontier` 继续表示可新启动的静态节点，`resumeQueue` 表示当前合法工作。队列先按类别排序：恢复、finalizing、integrating、implementing、planning、ready、cleanup；同类按可解锁下游数降序、Manifest 拓扑序、workItemId 排序。Manifest 外的活动 change 生成 adopt 项。替代方案是提交 `current-state.json`，因会在工作树间立即漂移而不采用。

### D-04：控制器复用状态聚合器并保持操作窄小

新增 `control.mjs`，导出纯校验函数和 CLI。五个动作分别为 status、dispatch、wait、settle、integrate；调用者只能指定工作项、期望 revision、幂等键及动作必要证据，任务角色、模型、模板和下一阶段由 Manifest 与状态决定。第一版集成动作只允许返回并执行当前 `nextAction` 对应的 Orca/Git/OpenSpec 受控步骤，不接受自由 shell。拒绝返回稳定 code、reason 与 nextActions。

### D-05：revision、锁和幂等使用 Node 与 Git common dir

revision 是规范化状态业务字段的 SHA-256 摘要，不包含 generatedAt；它用于乐观并发，不作产物完整性校验。变更操作在 `git rev-parse --git-common-dir` 下用原子目录锁串行化，并将幂等回执写入未跟踪的 orchestration runtime 目录。锁有所有者和过期时间；只清理可证明过期且进程不存在的锁。替代数据库和第三方锁库均不采用。

### D-06：OMP 扩展只提供项目级软守卫

扩展注册 `riskflow_status`、`riskflow_dispatch`、`riskflow_wait`、`riskflow_settle`、`riskflow_integrate`，在 context 中注入短状态摘要，并在 `tool_call` 阻止 `goal complete`、直接 Orca 派发/集成及明显绕过受控入口的 Git 状态变更。`session_stop` 仅在存在立即可执行的合法下一步时请求继续。启动脚本显式传入扩展绝对路径并运行 doctor；保留有限通用工具，因此文档明确其不是安全边界。

### D-07：Finalizer 终态由责任闭环定义

Finalizer task 的完成条件是当前产物核验、批准范围内缺陷修复、受影响回归和最终报告全部完成。`openspec-verify-change` 仅作为核验步骤。公共契约、权限、持久化、迁移、依赖或批准范围变化进入 paused/replan；会话失败移交新强模型 Finalizer。权限、事务、关键状态机及语义 merge 冲突发生实质修改时把 `auditPolicy` 提升为 targeted，并要求不同强模型审阅受影响范围。

### D-08：rollout 以 main 检查点为同步源

本 change 验收归档后先合入 main；冻结活动 writer 后，把该 main 检查点依次 merge 到 C17、C20、C26 与 C11 辅助工作树。合并后以实际 HEAD 回填 v2：C17、C26、C11 辅助项为 finalizing-ready，C20 为 waiting_dependency(C17)。任何旧 PASS 都只保留为 evidence。三个已合并、干净且无活动 writer 的旧工作树通过 Orca 正常回收。

## Risks / Trade-offs

- [通用 shell 或宿主桥接可绕过 OMP hook] → 启动时明确软守卫边界，关键状态仍由控制器和集成前检查拒绝。
- [现有 Orca 历史信封不完整] → v1 兼容读取；当前活动项在同步后显式回填 v2，不从标题或报告猜测。
- [跨工作树 merge 改变已验收产物] → 合并后旧 PASS 失效，按新的 HEAD 进入 Finalizer。
- [全局锁降低并行吞吐] → 当前协调写操作低频，先使用单锁；只有出现可测竞争时再细分。
- [工作树状态在 rollout 前变化] → 冻结 writer 后重新采集，任何脏改动或活动 Dispatch 都停止该目标的同步。

## Migration Plan

1. 在独立工作树完成、验证并归档本 change，形成 main 同步检查点。
2. 运行 doctor 和 v1/v2 状态测试，再在 main 启用显式 OMP 扩展入口。
3. 冻结并复核四个活动工作树，逐个 merge main；冲突按文件所有权解决并运行最小验证。
4. 使用控制器回填四个 v2 信封，验证 `resumeQueue` 为 C17、C26、C11 辅助项，C20 明确阻塞于 C17。
5. 核验并回收三个旧工作树；最终 `orchestration:check` 必须返回 0。

回滚时禁用新的 coordinator 启动命令即可恢复只读状态入口；已写 v2 信封仍可被状态脚本读取，不回写 v1，也不回滚已同步的业务分支。
