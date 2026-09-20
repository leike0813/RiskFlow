# Orchestration Controlled Actions Specification

## Purpose

本能力用确定性阶段转换约束 RiskFlow 多 Agent 交付，使收尾责任、派发、验收、集成和完成声明只能作用于当前产物及当前合法阶段。

## Requirements

### Requirement: Finalizer 必须持有收尾责任

change 进入 `finalizing` 后，强模型 Finalizer MUST 在已批准语义范围内完成核验、修复、回归，并在当前 schema 声明 verification 工件时填写最终验收结论与后续注意事项；普通实现缺陷 MUST 保留在当前 Finalizer 责任链中。只有已批准的新规划版本才能重开 `implementing`。

#### Scenario: 收尾发现普通实现缺陷
- **WHEN** Finalizer 发现实现未满足已批准行为，且修复不改变公共契约、权限、持久化语义、迁移或依赖
- **THEN** 当前 Finalizer MUST 修复并回归受影响行为
- **AND** 调度器 MUST NOT 派发廉价实现任务接管该缺陷

#### Scenario: 收尾发现设计边界变化
- **WHEN** 修复需要改变公共契约、权限、持久化语义、迁移、新依赖或批准范围
- **THEN** 当前工作项 MUST 暂停并进入有界重新规划
- **AND** 收尾责任 MUST 保留到新的已批准规划明确重开实现阶段

#### Scenario: Finalizer 会话无法继续
- **WHEN** Finalizer 因会话崩溃、上下文或预算限制无法继续
- **THEN** 系统 MUST 将当前检查点和证据移交给新的强模型 Finalizer
- **AND** MUST NOT 因会话终止改变责任角色

#### Scenario: Finalizer 形成验收工件
- **WHEN** 当前 schema 声明 verification 工件且 Finalizer 已完成最终代码修复与回归
- **THEN** Finalizer MUST 基于实际最终 HEAD 填写 verification
- **AND** 工件 MUST 记录验收结论、规格与命令证据、验收期修复和后续注意事项
- **AND** 最终产物再次发生实质变化时 MUST 更新 verification 后再收口

#### Scenario: 限定审计补充验收工件
- **WHEN** Finalizer 的修改触发 Targeted Auditor
- **THEN** verification MUST 在集成前包含限定审计的最终结论与证据
- **AND** 待执行审计 MUST NOT 被记录为 PASS 后的非阻塞事项

#### Scenario: 成功收口只提交已审阅改动
- **WHEN** Finalizer 工作树存在未提交改动且主调度请求成功收口
- **THEN** 请求的 `reviewedPaths` MUST 与实时 `dirtyPaths` 完全一致
- **AND** 系统 MUST 只暂存这些路径；不一致时 MUST 在 Git 副作用前拒绝

### Requirement: 受控操作必须执行状态前置校验

派发、结果接收、集成、归档、回收和目标完成 MUST 在执行前校验状态 revision、当前阶段、工作树身份、HEAD、唯一写者、当前 schema 要求的验收工件及证据；拒绝结果 MUST 返回原因和当前合法下一动作。

#### Scenario: finalizing 后请求廉价实现
- **WHEN** 工作项处于 `finalizing` 且没有新的已批准规划版本
- **THEN** 派发操作 MUST 拒绝廉价实现角色
- **AND** MUST 返回继续或移交 Finalizer 的下一动作

#### Scenario: 获批后显式重新规划
- **WHEN** 工作项已进入 `finalizing` 或 `paused`，且派发请求提供非空 `replanApprovalRef`
- **THEN** 系统 MUST 创建 planning v2 信封并记录该批准引用与被取代的 `attemptGroup`
- **AND** 没有批准引用的请求 MUST NOT 使阶段回退到 planning 或 implementing

#### Scenario: 接收过期验收
- **WHEN** PASS 对应的产物 HEAD 与当前工作树 HEAD 不同
- **THEN** 结果接收操作 MUST 拒绝该 PASS
- **AND** 工作项 MUST 保持未验收状态

#### Scenario: 缺少 schema 声明的验收工件
- **WHEN** finalization 或 audit 请求成功收口，且当前 schema 声明的 verification 工件未完成
- **THEN** 结果接收操作 MUST 在暂存或提交前拒绝该请求
- **AND** 必须指引验收责任者按 schema 指令完成 verification

#### Scenario: 兼容不含验收工件的旧 schema
- **WHEN** 既有 change 的实际 schema 未声明 verification 工件
- **THEN** 结果接收操作 MUST 继续使用既有证据门禁
- **AND** MUST NOT 为兼容检查伪造或要求额外工件

#### Scenario: 逐项修复多个过期检查点
- **WHEN** 多个独立工作项同时只有 checkpoint mismatch 或待回收冲突
- **THEN** reconcile MUST 允许按工作项逐个登记当前实际 HEAD
- **AND** 重复 writer、身份冲突或全局违规仍 MUST 阻止该操作

#### Scenario: 协调命令需要 sender 身份
- **WHEN** 控制器从 Orca terminal 运行会改变 Run、Task 或 Dispatch 的命令
- **THEN** 所有相关写命令 MUST 携带该协调 terminal 的精确 `--from` 身份
- **AND** 状态读取命令 MUST NOT 伪造 sender

#### Scenario: 对账历史任务
- **WHEN** reconcile 为历史检查点创建新的结构化责任任务
- **THEN** 控制器 MUST 创建由当前协调 terminal 持有的新 Run
- **AND** MUST NOT 复用绑定到旧协调会话的 Run

#### Scenario: 目标尚未完成
- **WHEN** 用户目标范围仍有未完成、阻塞、活动责任或缺失证据的工作项
- **THEN** 目标完成操作 MUST 被拒绝
- **AND** MUST 返回恢复队列中的下一项合法工作

### Requirement: 状态转换必须防止重复执行

所有改变编排状态的操作 MUST 使用期望 revision 和幂等键；同一 Git common dir 内的并发状态操作 MUST 串行提交，重复请求 MUST 返回既有结果。

#### Scenario: 两个调度器同时派发
- **WHEN** 两个操作基于同一 revision 尝试派发同一工作项
- **THEN** 最多一个操作 MUST 成功
- **AND** 另一个操作 MUST 收到状态已变化及重新读取状态的指引

#### Scenario: 重放已完成操作
- **WHEN** 相同幂等键和相同输入被再次提交
- **THEN** 系统 MUST 返回第一次提交的结果
- **AND** MUST NOT 创建第二个 Task、Dispatch 或集成动作

#### Scenario: 上次外部执行结果不确定
- **WHEN** 相同幂等键的持久回执仍为 `inflight`
- **THEN** 系统 MUST 以 `uncertain_prior_execution` 拒绝重放外部副作用
- **AND** MUST 指引调用者重新读取实时状态并对账

### Requirement: 高风险最终产物必须限定独立复核

权限、事务、关键状态机或语义性 merge 冲突经过 Finalizer 实质修改后，系统 MUST 要求另一强模型对受影响范围执行独立 audit；普通 change 的 Finalizer 自验 MUST 足以完成收尾。

#### Scenario: Finalizer 修改高风险语义
- **WHEN** Finalizer 实质修改权限、事务、关键状态机或解决语义性 merge 冲突
- **THEN** 工作项 MUST 在限定 audit 通过前保持未集成
- **AND** audit 责任者 MUST 与该 Finalizer 不同

#### Scenario: 普通实现修复
- **WHEN** Finalizer 只修复已批准范围内的普通实现缺陷
- **THEN** 系统 MUST 接受其回归证据作为最终收尾证据
- **AND** MUST NOT 强制启动第二次全量验收

### Requirement: 可复用操作经验必须与动态状态分离

项目 MUST 保存当前有效的 Orca、OMP、Codex 操作与故障恢复步骤，并由协调与执行 Agent 在相关操作前读取；这些步骤 MUST 与稳定策略分开维护，且 MUST NOT 包含当前 frontier、HEAD、Run、Task、terminal 或历史进度。当前接管起点 MUST 只由实时状态生成。

#### Scenario: 新 worktree 首次启动 Codex
- **WHEN** Codex 因当前 worktree 尚未信任而返回 `agent_prompt_blocked`
- **THEN** 操作步骤 MUST 指引先在精确 terminal 完成信任并确认 Agent idle
- **AND** 系统 MUST 复用原 Task 恢复派发，不得把该提示记为实现失败或创建重复 Task

#### Scenario: 新会话读取操作手册
- **WHEN** 新协调 Agent 读取操作与恢复步骤
- **THEN** 文档 MUST 指引其从 `revision`、`resumeQueue` 和 `violations` 接管
- **AND** 文档 MUST NOT 提供带当前指令效力的固定工作项、检查点或 Run/Task 标识

### Requirement: 当前尝试必须由控制器自持台账登记

监督派发起步与 worker 报告收口都会整体覆盖 Orca Task 的 `result`，而该字段历史上承载 v2 执行信封。控制器 MUST 把当前尝试的完整信封另外持久化在 git common dir 的自有台账中，并在尝试进入新状态时更新；台账 MUST NOT 位于仓库工作树内。

#### Scenario: 派发前登记尝试
- **WHEN** 控制器准备派发一个工作项
- **THEN** 控制器 MUST 在启动任何 worker 之前把该尝试以 `runState = queued` 登记入台账
- **AND** 台账不可写时 MUST NOT 启动 worker

#### Scenario: worker 启动成功后登记运行态
- **WHEN** 监督 worker 成功启动
- **THEN** 控制器 MUST 把同一尝试以 `runState = running` 更新入台账
- **AND** `attempt`、`attemptGroup`、`auditPolicy`、`owner`、`issueRefs`、`evidenceRefs` 与阶段 MUST 与派发信封一致
- **AND** MUST NOT 预填 `outcome`、`outputHead` 或任何质量结论

#### Scenario: 台账登记失败不得伪造派发结果
- **WHEN** 派发已成功启动 worker，但运行态登记失败
- **THEN** 控制器 MUST NOT 把该派发报告为失败或要求重新派发
- **AND** MUST 以结构化 warning 暴露登记未完成

#### Scenario: 受控收口后台账与本地产物一致
- **WHEN** 受控收口接受一次终态结果
- **THEN** 控制器 MUST 以同一终态信封更新台账
- **AND** 台账记录的产物 HEAD MUST 与该次收口的实际 HEAD 一致

### Requirement: 长外部步骤必须让出运行时锁并事后重新校验

控制器的部分受控操作需要在锁内执行耗时外部命令（集成的主线复验最长 30 分钟）。此类步骤 MUST 在锁外执行并立即重新取锁，且 MUST NOT 用陈旧事实写入状态。

#### Scenario: 长步骤执行期间其他受控操作仍可提交
- **WHEN** 某个操作正在执行长外部步骤并已让出运行时锁
- **THEN** 其他受控操作 MUST 能正常获取锁并完成提交
- **AND** MUST NOT 因该长步骤而以 `control_busy` 失败

#### Scenario: 让出期间事实变化则拒绝写入
- **WHEN** 长外部步骤执行期间编排事实集发生变化，使该操作起始时的 `expectedRevision` 不再成立
- **THEN** 重新取锁后 MUST fail-closed，报告状态已变化并指引重新读取状态
- **AND** MUST NOT 把该步骤的结果写入任务信封、台账或回执的成功分支

#### Scenario: 长步骤失败仍保持回执不确定
- **WHEN** 长外部步骤自身失败
- **THEN** 控制器 MUST 以既有不确定语义处置该次幂等执行
- **AND** MUST NOT 声称已完成该步骤

#### Scenario: 产生编排副作用的短操作继续全程持锁
- **WHEN** 操作会在 Orca 上创建或改写 Run、Task、Dispatch，或写入尝试台账
- **THEN** 该操作 MUST 全程持有运行时锁
- **AND** 并发提交 MUST 至多有一个成功

### Requirement: 外部验证步骤必须在不继承协调者身份的环境下执行

协调终端会设置 `ORCA_TERMINAL_HANDLE`，而 `resolveOrcaInvocation` 依据它把 CLI 从 `orca-ide` 切换为 `orca`。外部验证命令 MUST 在不继承该身份的环境下执行，使验证结论与发起终端无关。

#### Scenario: 从 Orca 终端发起的主线复验
- **WHEN** 控制器在已设置 `ORCA_TERMINAL_HANDLE` 的协调终端中执行外部验证命令
- **THEN** 该命令 MUST NOT 继承 `ORCA_TERMINAL_HANDLE` 与 `ORCA_CLI_COMMAND`
- **AND** 编排测试 MUST 与在干净 shell 中执行时得到相同结论

#### Scenario: 编排测试与调用方环境隔离
- **WHEN** 编排测试套件在已设置 ambient 编排身份的进程中运行
- **THEN** 用例 MUST 自行界定该环境并保持可重复
- **AND** 验证结论 MUST NOT 取决于调用方终端

### Requirement: 重开规划必须把批准范围与触发原因送入规划任务

`replanApprovalRef` 只记录批准凭据，不足以让规划者知道要规划什么。派发 MUST 把被取代尝试的触发原因与批准记录的位置写进规划任务说明，使规划者能在没有额外人工提示的情况下闭合批准范围。

#### Scenario: 重开规划任务的说明包含批准输入
- **WHEN** 派发携带非空 `replanApprovalRef` 的规划任务
- **THEN** 该任务说明 MUST 包含批准引用、被取代的尝试组，以及被取代尝试的 `issueRefs` 与 `evidenceRefs`
- **AND** MUST 指引规划者先读取该 change 目录中由 proposal 引用的批准记录

#### Scenario: 批准范围必须逐项闭合
- **WHEN** 规划者处理重开规划任务
- **THEN** 批准记录列出的范围 MUST 被逐项展开为 IP-ID、允许文件清单和验证命令
- **AND** 结束报告 MUST 逐项说明每一条的闭合情况；仅补齐模板章节 MUST NOT 被视为规划完成

#### Scenario: 批准范围无法在既有语义内闭合
- **WHEN** 批准记录中任一项无法在该 change 已批准语义内闭合
- **THEN** 规划者 MUST 在规划工件中显式说明并 escalation
- **AND** MUST NOT 静默略过该项

#### Scenario: 常规规划任务不受影响
- **WHEN** 派发不带 `replanApprovalRef` 的规划任务
- **THEN** 任务说明 MUST 保持既有通用文案
- **AND** MUST NOT 要求读取不存在的批准记录

### Requirement: 收口必须保留获批重开规划边界

获批重开规划以 `approvalRef` 与 `supersedesAttemptGroup` 标记边界，状态视图依据它把边界之前的尝试排除在当前判定之外。收口 MUST 在 settled 信封中原样保留这对字段，否则边界消失、被取代的尝试会重新参与选择。

#### Scenario: 重开规划尝试收口后边界仍生效
- **WHEN** 收口一个携带完整重开规划边界的尝试
- **THEN** settled 信封 MUST 保留相同的 `approvalRef` 与 `supersedesAttemptGroup`
- **AND** 状态视图 MUST 继续把边界之前的尝试排除在当前尝试与冲突判定之外

#### Scenario: 边界不完整时不得写入
- **WHEN** 检查点只有 `approvalRef` 或只有 `supersedesAttemptGroup`
- **THEN** settled 信封 MUST NOT 写入该不完整边界
- **AND** MUST NOT 因此产生 `invalid_replan_boundary`

#### Scenario: 常规收口不受影响
- **WHEN** 收口一个不含重开规划边界的尝试
- **THEN** settled 信封 MUST 保持既有字段与语义
- **AND** MUST NOT 新增任何边界字段

### Requirement: 成功收口必须真正校验并提交已审阅改动

状态视图给节点的 `worktree` 投影只暴露 `dirty` 与 `dirtyPaths`。成功收口的已审阅改动校验与检查点提交 MUST 读取这些字段，MUST NOT 依赖投影中不存在的嵌套 Git 结构而静默跳过。

#### Scenario: 已审阅路径与实时改动不一致时拒绝
- **WHEN** 工作树存在未提交改动，且请求的 `reviewedPaths` 与实时 dirty paths 不完全一致
- **THEN** 结果接收操作 MUST 在 Git 副作用前拒绝该请求
- **AND** MUST NOT 暂存或提交任何路径

#### Scenario: 一致时只提交已审阅路径
- **WHEN** `reviewedPaths` 与实时 dirty paths 完全一致且收口结果为 succeeded
- **THEN** 控制器 MUST 仅暂存这些路径并形成 Git 检查点
- **AND** settled 信封的 `outputHead` MUST 指向包含该检查点的新 HEAD

#### Scenario: 工作树干净时行为不变
- **WHEN** 工作树不存在未提交改动
- **THEN** 收口 MUST NOT 产生 Git 副作用
- **AND** MUST NOT 要求 `reviewedPaths`

### Requirement: 任意角色的派发都必须登记运行态

控制器在派发前把尝试登记为 `queued`；worker 接管之后 MUST 把同一尝试登记为 `running`。该要求对全部派发路径一致，MUST NOT 只覆盖其中一种启动方式，否则状态视图会继续声称该尝试待派发并给出重复派发的下一动作。

#### Scenario: 实现派发后状态不再声称待派发
- **WHEN** 控制器通过终端注入方式启动实现 worker 且注入被接受
- **THEN** 台账 MUST 把该尝试登记为 `running`
- **AND** 状态视图 MUST NOT 再给出"派发当前信封指定的受控任务"这类下一动作

#### Scenario: 登记失败不改变已发生的派发
- **WHEN** 运行态登记失败
- **THEN** 控制器 MUST NOT 把该派发报告为失败
- **AND** MUST 以结构化 warning 暴露登记未完成

### Requirement: 尝试编号必须按目标尝试组的历史递增

尝试次数是同一尝试组内推进的代次，选择当前尝试时按它取最大值。新建尝试 MUST 以「目标尝试组内既有最大尝试次数 + 1」编号，MUST NOT 仅依据当前检查点是否属于同类职责而重新从 1 起算，否则不同职责先后进入同一组时会撞号，使状态视图回到已收口的旧尝试。

#### Scenario: 不同职责先后进入同一组时继续递增
- **WHEN** 为某工作项新建尝试，且目标尝试组内已存在更高尝试次数的尝试
- **THEN** 新尝试的次数 MUST 为该组既有最大值加一
- **AND** 状态视图 MUST 以该新尝试为当前尝试

#### Scenario: 组内无历史尝试时从一起算
- **WHEN** 目标尝试组内不存在任何尝试
- **THEN** 新尝试的次数 MUST 为 1

#### Scenario: 获批重开规划的边界仍从一起算
- **WHEN** 派发携带非空批准引用的规划尝试
- **THEN** 其尝试次数 MUST 从 1 开始，与既有 replan 边界语义一致
