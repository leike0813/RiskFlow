## MODIFIED Requirements

### Requirement: 执行图与任务身份必须结构化

系统 MUST 从版本化执行图读取 change/gate 的直接依赖，并按拓扑顺序输出可机读的节点状态、依赖状态、当前阶段、下一动作和证据引用。每个参与门禁的执行任务 MUST 能关联到唯一 `workItemId`、实际 OpenSpec `changeName`、任务角色、完整 worktree ID、输入 HEAD 和产物 HEAD；固定路线节点 MUST 另有 `routeNodeId`，辅助 change MUST 使用稳定的 `AUX:<change-name>` 工作项身份。分支名、display name 或自然语言报告不得作为唯一身份。系统 MUST 按 cursor 完整分页读取 Orca Run，再逐 Run 读取 Task 并按 ID 去重，不得以固定首屏作为全量事实。

#### Scenario: 依赖未满足
- **WHEN** change 的任一直接依赖尚未在 `main` 完成归档
- **THEN** 该 change MUST NOT 进入 ready frontier
- **AND** 状态 MUST 列出未满足的直接依赖

#### Scenario: 依赖全部满足
- **WHEN** change 的所有直接依赖均已在 `main` 完成归档，且没有所有权冲突
- **THEN** 该 change MUST 出现在 ready frontier
- **AND** 状态 MUST 提供可执行的下一动作

#### Scenario: Manifest 节点未按依赖排序
- **WHEN** 执行图节点顺序与依赖拓扑顺序不同但图仍为合法 DAG
- **THEN** 状态结果和 ready frontier MUST 与等价拓扑排序 Manifest 相同

#### Scenario: 任务结果缺少关联信封
- **WHEN** 仍关联现存非主 worktree、非终态 worker/Dispatch 或 live terminal 的 Orca Task 没有完整工作项、change、worktree 或 checkpoint 关联
- **THEN** 状态 MUST 标记该任务为 unlinked 或 unknown
- **AND** MUST NOT 依据任务标题或报告正文猜测其归属

#### Scenario: 历史任务结果缺少关联信封
- **WHEN** Orca Task 已不关联任何现存非主 worktree、非终态 worker/Dispatch 或 live terminal，且其结构化 result 不完整
- **THEN** 状态 MUST 将其作为非阻断诊断报告
- **AND** MUST NOT 因该历史记录改变节点状态或退出码

#### Scenario: worker 与任务信封身份冲突

- **WHEN** 实时 worker 的资源 worktree ID 与其 Task 信封中的完整 worktree ID 不一致
- **THEN** 状态 MUST 报告任务身份冲突
- **AND** MUST NOT 自动选择任一身份继续派发或回收

#### Scenario: Manifest 外活动 change
- **WHEN** 非主工作树存在未归档 OpenSpec change 且没有固定路线节点或 v2 信封
- **THEN** 状态 MUST 以辅助工作项报告该 change 并提供 `adopt` 动作
- **AND** MUST NOT 将其静默归入历史诊断

#### Scenario: 活动分支继承同一辅助 change
- **WHEN** 多个已同步 worktree 包含同名辅助 change，且其中恰有一个 v2 信封以精确 worktree ID 声明该 change 的责任
- **THEN** 状态 MUST 采用该结构化责任 worktree
- **AND** MUST NOT 把其余继承副本报告为重复活动 worktree

### Requirement: 状态冲突必须 fail-closed

系统 MUST 对当前 Git、OpenSpec、Orca 或执行信封之间的身份、HEAD、阶段和完成条件冲突输出结构化 violation。系统 MUST 分离任务运行状态和质量结论，并根据阶段顺序、尝试组、尝试次数与任务创建顺序选取同一工作项的当前尝试；早期阶段或较早尝试不得覆盖后续成功结果。有效的获批 replan planning 信封 MUST 以非空 `approvalRef` 指向批准记录，并用 `supersedesAttemptGroup` 指向已进入 finalizing 的尝试组；状态选择 MUST 从最新有效边界重新计算。同一当前阶段无法确定唯一尝试时，系统 MUST fail-closed。v1 信封 MUST 可被规范化读取，所有新增或更新的信封 MUST 写为 v2。

#### Scenario: checkpoint 与当前 HEAD 不一致
- **WHEN** 当前结构化执行信封记录的产物 HEAD 与对应 worktree 当前 HEAD 不一致
- **THEN** 状态 MUST 报告 checkpoint mismatch
- **AND** MUST 将该节点标记为 unknown 或 blocked，不得判定为已验证

#### Scenario: 早期 pending 后出现验证通过
- **WHEN** 同一 worktree 的较早阶段任务仍记录 pending，且后续主线验证阶段已明确 passed
- **THEN** 状态 MUST 采用后续阶段的当前结果
- **AND** MUST NOT 报告 main summary conflict

#### Scenario: 当前尝试不唯一
- **WHEN** 同一 worktree 的当前阶段存在多个无法按结构化尝试顺序唯一选择的互相冲突任务
- **THEN** 状态 MUST 报告结构化冲突
- **AND** MUST NOT 猜测一个任务作为当前结果

#### Scenario: active task 与本地事实冲突
- **WHEN** Orca Task 显示完成，但对应 worktree 仍有未提交未知改动或缺少要求的 OpenSpec 工件
- **THEN** 状态 MUST 报告事实冲突
- **AND** MUST 阻止归档和 worktree 回收就绪判断

#### Scenario: 新建任务尚未产生质量结论
- **WHEN** v2 信封的运行状态为 queued、running 或 waiting
- **THEN** 信封 MUST 不得预填 succeeded 或 passed
- **AND** 状态视图 MUST 根据运行状态报告当前阶段

#### Scenario: 获批 replan 取代旧收尾阶段
- **WHEN** 最新有效 planning 信封记录批准引用，并指向一个已进入 finalizing 的旧尝试组
- **THEN** 状态 MUST 从该 planning Task 的创建边界重新选择当前尝试
- **AND** 边界之前的旧 finalizing Task MUST NOT 覆盖新规划状态

### Requirement: 状态输出必须可供协调 Agent消费

系统 MUST 提供稳定的机器可读 JSON 输出，至少包含主线 HEAD、静态 frontier、确定性 `resumeQueue`、节点 status/phase、依赖、worktree、Orca task、checkpoint、evidenceRefs、nextActions 和 violations。输出 MUST 升级为 `schemaVersion: 2` 并保留已有字段语义；非阻断历史问题 MAY 通过可选 `diagnostics` 数组提供。相同输入事实 MUST 产生相同的业务状态结果；生成时间等运行元数据不得影响状态判断。

#### Scenario: 机器读取当前路线
- **WHEN** 协调 Agent 请求 JSON 状态
- **THEN** 输出 MUST 能直接定位 ready、running、blocked、failed、paused、finalizing、integrating、archived、reclaimable 和 stale 工作项
- **AND** 每个工作项 MUST 提供足以继续操作的 nextActions 或冲突说明

#### Scenario: 静态 frontier 与恢复队列并存
- **WHEN** 没有新的静态路线节点可启动，但存在活动、恢复、收尾或集成工作
- **THEN** `frontier` MAY 为空
- **AND** `resumeQueue` MUST 按策略列出下一协调 Agent 可执行的工作

#### Scenario: 无活动非主 worktree
- **WHEN** Git 与 Orca 均只保留主 worktree，且没有活动 change
- **THEN** 输出 MUST 报告空的非主 worktree、resumeQueue 和 stale/reclaimable 集合
- **AND** MUST 保留主线 HEAD 和全部就绪节点组成的路线 frontier

#### Scenario: 只有历史孤立任务
- **WHEN** 当前没有活动非主 worktree、非终态 worker/Dispatch 或 live terminal，但 Orca 保留历史孤立任务
- **THEN** `unlinkedTasks` 和阻断性 `violations` MUST 为空
- **AND** 历史孤立任务 MAY 出现在 `diagnostics` 中

#### Scenario: 重启后继续接管
- **WHEN** 新协调 Agent 在没有上一会话聊天记录的情况下读取状态
- **THEN** 系统 MUST 仅凭 Git、OpenSpec、Orca 和 Manifest 重建相同的 `resumeQueue`
- **AND** 队首 MUST 给出工作项、责任角色、检查点和合法下一动作
