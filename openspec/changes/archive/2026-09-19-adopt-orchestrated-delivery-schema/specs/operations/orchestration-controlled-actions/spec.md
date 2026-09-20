## MODIFIED Requirements

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
