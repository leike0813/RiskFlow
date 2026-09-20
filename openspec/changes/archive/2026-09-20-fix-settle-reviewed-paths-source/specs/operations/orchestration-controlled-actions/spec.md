# Spec Delta

## ADDED Requirements

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
