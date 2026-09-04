## Purpose

本能力为 RiskFlow 的多 worktree OpenSpec 交付流程提供可机读、可重建的执行状态视图，使协调 Agent 能区分 feature worktree 的本地进度与 `main` 的集成事实，并安全发现阻塞与待回收工作树。

## ADDED Requirements

### Requirement: 活动状态必须按 worktree 事实汇聚

系统 MUST 对每个已登记的非主 RiskFlow worktree 独立读取其 OpenSpec 与 Git 状态，并以完整 `worktreeId`、`changeId` 和 Orca `taskId` 建立关联。`main` 缺少某个活动 change 时，系统 MUST NOT 将该 change 判定为未创建、未开始或不存在。

#### Scenario: 活动工件只存在于 feature worktree
- **WHEN** 一个 change 的 proposal、design、tasks 或实现检查点存在于 feature worktree，而 `main` 尚未合并该 change
- **THEN** 状态视图 MUST 从该 feature worktree 报告其活动阶段和本地 HEAD
- **AND** `main` 的缺少该 change MUST 只表示尚未集成，不得覆盖 feature worktree 的活动事实

#### Scenario: 多个 worktree 关联同一 change
- **WHEN** 两个或更多非主 worktree 被关联到同一个 change
- **THEN** 状态视图 MUST 报告重复活动 worktree 冲突
- **AND** MUST NOT 自动选择一个 worktree 继续派发或回收

#### Scenario: worktree 路径消失
- **WHEN** Orca 或执行记录仍有某个 worktree 的任务，但该路径已不存在
- **THEN** 状态视图 MUST 报告 worktree 缺失
- **AND** MUST NOT 将任务静默标记为完成或重新派发

### Requirement: 执行图与任务身份必须结构化

系统 MUST 从版本化执行图读取 change/gate 的直接依赖，并输出可机读的节点状态、依赖状态、当前阶段、下一动作和证据引用。每个执行任务 MUST 能关联到唯一的 change、任务角色、完整 worktree ID、base HEAD 和当前 HEAD；分支名、display name 或自然语言报告不得作为唯一身份。

#### Scenario: 依赖未满足
- **WHEN** change 的任一直接依赖尚未在 `main` 完成归档
- **THEN** 该 change MUST NOT 进入 ready frontier
- **AND** 状态 MUST 列出未满足的直接依赖

#### Scenario: 依赖全部满足
- **WHEN** change 的所有直接依赖均已在 `main` 完成归档，且没有所有权冲突
- **THEN** 该 change MUST 出现在 ready frontier
- **AND** 状态 MUST 提供可执行的下一动作

#### Scenario: 任务结果缺少关联信封
- **WHEN** Orca Task 已存在但其结构化 result 没有完整 change、worktree 或 checkpoint 关联
- **THEN** 状态 MUST 标记该任务为 unlinked 或 unknown
- **AND** MUST NOT 依据任务标题或报告正文猜测其归属

### Requirement: 集成状态必须以 main 为准

系统 MUST 使用 `main` 的 Git、主线验证和 OpenSpec 归档事实判断 change 是否已集成或完成。feature worktree 中的归档意图、文本报告或局部验证通过 MUST NOT 单独产生已完成状态。

#### Scenario: feature 已完成但尚未合并
- **WHEN** feature worktree 中 tasks、验证或归档准备均已完成，但 feature HEAD 尚未成为 `main` 的祖先
- **THEN** change MUST 保持未集成状态
- **AND** 状态 MUST 指向合并或主调度收口动作

#### Scenario: feature 已合并但 main 尚未复验
- **WHEN** feature HEAD 已进入 `main`，但主线冻结安装或 `pnpm verify` 尚未通过
- **THEN** change MUST NOT 标记为 completed 或 archived
- **AND** 状态 MUST 指向主线验证

#### Scenario: main 已完成归档
- **WHEN** feature HEAD 已进入 `main`、主线验证通过且归档 checkpoint 已存在
- **THEN** change MUST 标记为 archived 或 reclaimable
- **AND** 状态 MUST 保存 merge、verification 和 archive 的 checkpoint 引用

### Requirement: 状态冲突必须 fail-closed

系统 MUST 对 Git、OpenSpec、Orca 或执行信封之间的身份、HEAD、阶段和完成条件冲突输出结构化 violation。系统 MUST NOT 通过自然语言推断、缺省值或最近时间戳静默消除冲突。

#### Scenario: checkpoint 与当前 HEAD 不一致
- **WHEN** 结构化执行信封记录的 HEAD 与对应 worktree 当前 HEAD 不一致
- **THEN** 状态 MUST 报告 checkpoint mismatch
- **AND** MUST 将该节点标记为 unknown 或 blocked，不得判定为已验证

#### Scenario: active task 与本地事实冲突
- **WHEN** Orca Task 显示完成，但对应 worktree 仍有未提交未知改动或缺少要求的 OpenSpec 工件
- **THEN** 状态 MUST 报告事实冲突
- **AND** MUST 阻止归档和 worktree 回收就绪判断

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

系统 MUST 提供稳定的机器可读 JSON 输出，至少包含主线 HEAD、frontier、节点 status/phase、依赖、worktree、Orca task、checkpoint、evidenceRefs、nextActions 和 violations。相同输入事实 MUST 产生相同的业务状态结果；生成时间等运行元数据不得影响状态判断。

#### Scenario: 机器读取当前路线
- **WHEN** 协调 Agent 请求 JSON 状态
- **THEN** 输出 MUST 能直接定位 ready、running、blocked、failed、archived、reclaimable 和 stale 节点
- **AND** 每个节点 MUST 提供足以继续操作的 nextActions 或冲突说明

#### Scenario: 无活动非主 worktree
- **WHEN** Git 与 Orca 均只保留主 worktree，且没有活动 change
- **THEN** 输出 MUST 报告空的非主 worktree 集合和空的 stale/reclaimable 集合
- **AND** MUST 保留主线 HEAD 和路线 frontier 信息
