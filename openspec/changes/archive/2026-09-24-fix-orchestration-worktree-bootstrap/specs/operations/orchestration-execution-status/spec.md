## ADDED Requirements

### Requirement: 辅助 change 采纳必须有工作树归属证据

状态视图 MUST 只把具有真实归属证据的非路线 change 关联为 `AUX:<change-name>` 工作项。有效证据是该工作树中的精确工作项任务/尝试信封，或该 change 只在该工作树本地登记而未从当前 main 继承。仅在工作树的 OpenSpec 列表中看到 main 已有的同名活动 change，MUST NOT 构成采纳意图。多个真正归属同一辅助 change 的工作树仍 MUST fail-closed。

#### Scenario: 新工作树继承 main 的未归档辅助 change
- **WHEN** 多个新建路线工作树都含有 main 中尚未归档的同名非路线 change，但没有指向该 change 的本地任务、尝试或独立登记
- **THEN** 状态 MUST NOT 为这些继承副本生成辅助工作项或 `duplicate_active_worktree`
- **AND** 这些副本 MUST NOT 阻断路线工作项的合法派发

#### Scenario: 工作树本地登记辅助 change 待采纳
- **WHEN** 非主工作树有 main 中不存在的活动非路线 change，且尚无关联 Task
- **THEN** 状态 MUST 把该工作树列为对应 `AUX:<change-name>` 的待采纳 recovery

#### Scenario: 精确任务指明辅助 change 所有权
- **WHEN** 一个工作树有指向 `AUX:<change-name>` 的有效任务或尝试信封，而其他工作树仅继承同名 change
- **THEN** 状态 MUST 只采用前者作为该辅助工作项的归属工作树
- **AND** 不得把继承副本计为重复所有者

#### Scenario: 多个工作树都有真实采纳证据
- **WHEN** 两个非主工作树均有同一辅助 change 的独立本地登记或有效归属信封
- **THEN** 状态 MUST 报告 `duplicate_active_worktree`，不得擅自选择其中一个

## MODIFIED Requirements

### Requirement: 集成状态必须以 main 为准

系统 MUST 使用当前 `main` 提交中存在的 OpenSpec 归档作为 change 完成事实，并使用 Git、主线验证和结构化 checkpoint 判断仍在集成的 change。未归档 feature 的 HEAD 必须与当前 main HEAD 不同且确为 main 祖先，才能将祖先关系作为已合并证据。工作区未提交的归档目录、feature worktree 中的归档意图、文本报告或历史 Orca 失败记录 MUST NOT 单独产生或撤销已完成状态。

#### Scenario: feature 已完成但尚未合并
- **WHEN** feature worktree 中 tasks、验证或归档准备均已完成，但 feature HEAD 尚未作为独立产物进入 `main`
- **THEN** change MUST 保持未集成状态
- **AND** 状态 MUST 指向合并或主调度收口动作

#### Scenario: feature 已合并但 main 尚未复验
- **WHEN** feature HEAD 与当前 main HEAD 不同且已成为其祖先，但主线冻结安装或 `pnpm verify` 尚未通过
- **THEN** change MUST NOT 标记为 completed 或 archived
- **AND** 状态 MUST 指向主线验证

#### Scenario: 新工作树停在 main 尖端
- **WHEN** 尚未归档的路线或辅助工作树 HEAD 等于当前 main HEAD，即使祖先查询返回真
- **THEN** 状态 MUST NOT 仅据该祖先结果报告 `merged` 或 `main_verified`
- **AND** 工作项 MUST 保持其真实规划、实施、采纳或收尾阶段

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
