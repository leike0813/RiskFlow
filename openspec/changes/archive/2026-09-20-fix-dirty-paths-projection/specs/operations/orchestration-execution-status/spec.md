# Spec Delta

## ADDED Requirements

### Requirement: dirtyPaths 必须表达路径而不是 status 行

状态视图的 `dirtyPaths` 是「实时未提交改动」的唯一事实出口，收口校验与 `git add -- <path>` 都直接消费它。它 MUST 是可直接使用的路径集合，MUST NOT 暴露 `git status --porcelain` 的状态行。

#### Scenario: 未提交改动以裸路径表达
- **WHEN** 工作树存在修改、新增或未跟踪条目
- **THEN** `dirtyPaths` MUST 为该条目的路径本身，不含状态码前缀
- **AND** MUST NOT 包含 `--branch` 输出的分支行

#### Scenario: 重命名与复制取目标路径
- **WHEN** 条目为重命名或复制（`old -> new`）
- **THEN** `dirtyPaths` MUST 表达重命名/复制后的目标路径

#### Scenario: 与已审阅改动可直接比较
- **WHEN** 调用方给出与实时改动一致的路径列表
- **THEN** 二者 MUST 能直接按字符串比较相等
- **AND** 该列表 MUST 可直接作为 `git add --` 的参数
