# Orchestration Execution Status Specification

## Purpose

本能力为 RiskFlow 的多 worktree OpenSpec 交付流程提供可机读、可重建的执行状态视图，使协调 Agent 能区分 feature worktree 的本地进度与 `main` 的集成事实，并安全发现阻塞与待回收工作树。

## Requirements

### Requirement: 活动状态必须按 worktree 事实汇聚

系统 MUST 对每个已登记的非主 RiskFlow worktree 独立读取其活动 OpenSpec change 与 Git 状态，并以完整 `worktreeId`、`changeId` 和 Orca `taskId` 建立关联。feature worktree 从 `main` 继承的历史归档 MUST NOT 用于关联该 worktree。`main` 缺少某个活动 change 时，系统 MUST NOT 将该 change 判定为未创建、未开始或不存在。

#### Scenario: 活动工件只存在于 feature worktree
- **WHEN** 一个 change 的 proposal、design、tasks 或实现检查点存在于 feature worktree，而 `main` 尚未合并该 change
- **THEN** 状态视图 MUST 从该 feature worktree 报告其活动阶段和本地 HEAD
- **AND** `main` 的缺少该 change MUST 只表示尚未集成，不得覆盖 feature worktree 的活动事实

#### Scenario: feature 继承历史归档
- **WHEN** 非主 worktree 包含从 `main` 继承的已归档 change，但没有对应活动 change 或关联信封
- **THEN** 状态视图 MUST NOT 将该历史 change 关联到该 worktree

#### Scenario: 多个 worktree 关联同一 change
- **WHEN** 两个或更多非主 worktree 被关联到同一个 change
- **THEN** 状态视图 MUST 报告重复活动 worktree 冲突
- **AND** MUST NOT 自动选择一个 worktree 继续派发或回收

#### Scenario: worktree 路径消失
- **WHEN** Orca 或实时执行记录仍有某个 worktree 的任务，但该路径已不存在
- **THEN** 状态视图 MUST 报告 worktree 缺失
- **AND** MUST NOT 将任务静默标记为完成或重新派发

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

### Requirement: 集成状态必须以 main 为准

系统 MUST 使用当前 `main` 提交中存在的 OpenSpec 归档作为 change 完成事实，并使用 Git、主线验证和结构化 checkpoint 判断仍在集成的 change。工作区未提交的归档目录、feature worktree 中的归档意图、文本报告或历史 Orca 失败记录 MUST NOT 单独产生或撤销已完成状态。

#### Scenario: feature 已完成但尚未合并
- **WHEN** feature worktree 中 tasks、验证或归档准备均已完成，但 feature HEAD 尚未成为 `main` 的祖先
- **THEN** change MUST 保持未集成状态
- **AND** 状态 MUST 指向合并或主调度收口动作

#### Scenario: feature 已合并但 main 尚未复验
- **WHEN** feature HEAD 已进入 `main`，但主线冻结安装或 `pnpm verify` 尚未通过
- **THEN** change MUST NOT 标记为 completed 或 archived
- **AND** 状态 MUST 指向主线验证

#### Scenario: main 已完成归档
- **WHEN** OpenSpec 归档存在于当前 `main` 提交
- **THEN** change MUST 标记为 completed，且历史 Orca 记录 MUST NOT 将其降级

#### Scenario: main 后续推进
- **WHEN** 结构化主线 checkpoint 是当前 `main` 的祖先但不再等于当前 HEAD
- **THEN** checkpoint MUST 保持有效
- **AND** 状态 MUST NOT 报告主线 checkpoint mismatch

#### Scenario: 工作区存在未提交归档
- **WHEN** archive 目录仅存在于主 worktree 的未提交文件中
- **THEN** 状态 MUST NOT 将对应 change 标记为 completed

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

### Requirement: worktree 回收就绪必须可确定性判断

系统 MUST 输出 worktree 是否 `reclaimable`，但 MUST NOT 自动删除 Git 或 Orca worktree。只有 feature 已合并、主线复验通过、OpenSpec 已归档、相关 Task/Dispatch 已收口、无活动 terminal 且无未知未提交改动时，才可判定为 reclaimable。

#### Scenario: 合并归档后仍保留 worktree
- **WHEN** change 已合并、主线验证通过并完成归档，但 Git 或 Orca 仍登记其非主 worktree
- **THEN** 状态 MUST 标记 stale 或 reclaimable
- **AND** 输出使用完整 worktree ID 的回收下一动作

#### Scenario: 未知脏改动阻止回收
- **WHEN** 可回收条件已满足但 worktree 含有未识别的未提交文件
- **THEN** 状态 MUST NOT 标记为 reclaimable
- **AND** MUST 要求人工审阅，不得建议使用强制删除

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

### Requirement: 状态视图必须用自持台账补齐被覆盖的当前尝试

Orca 会在监督派发起步与 worker 报告收口时整体覆盖 Task 的 `result`。当某个 Task 的 `result` 不再解析出有效 v2 信封时，状态视图 MUST 用控制器自有台账中同一 `taskId` 的信封补齐该尝试；当 `result` 仍解析出有效信封时 MUST 以它为准。

#### Scenario: result 被清空后用台账补齐
- **WHEN** 某个 Task 的 `result` 为空或不是有效 v2 信封，而台账中存在该 `taskId` 的信封
- **THEN** 状态视图 MUST 用台账信封构造该尝试的证据
- **AND** 该尝试 MUST 参与所属工作项的尝试选择与检查点计算

#### Scenario: result 仍有效时以 Orca 为准
- **WHEN** 某个 Task 的 `result` 仍是有效 v2 信封，且台账存在同一 `taskId` 的陈旧信封
- **THEN** 状态视图 MUST 采用 Orca 侧信封
- **AND** 陈旧台账 MUST NOT 覆盖它

#### Scenario: 台账缺失或无效
- **WHEN** 某个 Task 的 `result` 不是有效 v2 信封，且台账中没有该 `taskId` 或该记录不构成有效信封
- **THEN** 该 Task MUST 照旧不被视为该工作项的当前尝试证据
- **AND** 状态视图 MUST NOT 猜测一个尝试

### Requirement: 获批重开规划边界必须界定活动写者

获批的 planning 尝试在创建边界上取代旧尝试组；该边界之前的尝试已经作废，MUST NOT 继续参与当前状态判定，包括活动写者冲突检测。

#### Scenario: 边界之前的尝试不构成第二个活动写者
- **WHEN** 一个已进入 finalizing 的尝试被获批的 planning 尝试取代，且该旧尝试仍处于 `ready` 或 `dispatched`
- **THEN** 状态 MUST NOT 因该旧尝试与边界之后的尝试并存而报告重复活动写者
- **AND** 当前尝试 MUST 仍按边界之后的创建顺序选取

#### Scenario: 没有获批重开规划时保持原判定
- **WHEN** 工作项不存在获批的 replan 边界
- **THEN** 活动写者冲突检测 MUST 覆盖该工作项的全部有效尝试

### Requirement: 辅助 change 的合并证据必须与路线 change 同口径

没有固定路线节点、以 `AUX:<change>` 合成的工作项 MUST 与路线 change 使用同一合并判据：以该工作项所属非主工作树的 HEAD 是否为 main HEAD 的祖先作为「产物已进主线」的证据。路线图之外不得成为跳过该采集的理由。

#### Scenario: 辅助 change 合入 main 后进入 merged
- **WHEN** 一个辅助 change 的非主工作树 HEAD 已成为 main HEAD 的祖先，且其信封尚未记录主线复验通过
- **THEN** 状态 MUST 把该工作项报告为 `merged`，而不是停留在 `finalized`
- **AND** MUST 返回「在 main 上完成冻结安装、pnpm verify 和主线验证」作为下一动作

#### Scenario: 辅助 change 未合入时保持 finalized
- **WHEN** 辅助 change 的非主工作树 HEAD 仍不是 main HEAD 的祖先
- **THEN** 状态 MUST 保持整合前的阶段判定
- **AND** MUST NOT 仅因信封存在合并摘要而报告 `merged`

#### Scenario: 路线 change 沿用原映射
- **WHEN** 某个活动 change 名称映射到路线图中的 change 节点
- **THEN** 该节点的合并证据 MUST 继续按其自身工作项 id 采集
- **AND** MUST NOT 因辅助分支的加入而改变其判定

### Requirement: 同组内被取代的较早尝试不构成活动写者

同一尝试组内只能有一个活动写者。被**尝试次数严格更高**的同组尝试取代的较早尝试 MUST NOT 继续计入活动写者，否则已作废的旧尝试会把整个工作项锁死。同次数、仅创建顺序不同的两个活动尝试属于「无法唯一确定当前尝试」，MUST 继续 fail-closed。该收窄 MUST NOT 影响不同尝试组之间以及多写者的既有判定。

#### Scenario: 同组遗留的旧尝试不再阻塞
- **WHEN** 同一尝试组内同时存在尝试次数较低的活动尝试与尝试次数更高的活动尝试
- **THEN** 状态 MUST NOT 因这两者并存而报告重复活动写者
- **AND** 当前尝试 MUST 仍按尝试次数与创建顺序选出

#### Scenario: 同次数活动尝试仍然 fail-closed
- **WHEN** 同一尝试组内两个活动尝试的尝试次数相同、仅创建顺序不同
- **THEN** 状态 MUST 继续报告重复活动写者
- **AND** MUST NOT 借本规则擅自选定其中一个

#### Scenario: 真正的多写者仍然被拒绝
- **WHEN** 同一工作项在不同尝试组或不同阶段各有一个活动尝试
- **THEN** 状态 MUST 继续报告重复活动写者
- **AND** 受控操作 MUST 继续被阻止

#### Scenario: 已产生结果的较早尝试不复活
- **WHEN** 较早尝试已经收口（`completed`/`failed`）
- **THEN** 它 MUST 继续按既有规则排除在活动写者之外
- **AND** MUST NOT 因本规则被重新计入
