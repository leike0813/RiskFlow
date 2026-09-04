## ADDED Requirements

### Requirement: 生产迁移兼容性测试覆盖受控贡献

系统 MUST 使用闭合且显式声明的测试模块集合验证生产迁移根目录中的合法 platform migration；该集合 MUST 能包含 foundation 之后的多个合法迁移，生产提供器的期望结果 MUST 覆盖全部已声明迁移而不得固定为单个历史迁移。未声明模块、非法路径、非法导出和全局序号冲突 MUST 继续在执行任何待处理迁移前分别收口为既有结构化迁移错误。

#### Scenario: 合法后续 platform migration 参与生产根验证

- **WHEN** 生产迁移根目录包含 foundation 以及测试集合已声明的合法后续 platform migration
- **THEN** 测试 loader 加载每个已声明模块，迁移提供器按全局序号返回完整集合
- **AND** 集成测试不会仅因合法迁移数量超过一项而返回 `MIGRATION_INVALID`

#### Scenario: 未声明模块仍被闭合 loader 拒绝

- **WHEN** 迁移提供器请求测试 loader 加载一个未在受控集合中声明的模块
- **THEN** 迁移入口在执行任何待处理迁移前返回 `MIGRATION_INVALID`
- **AND** 测试不得通过任意动态导入放宽模块边界

#### Scenario: 提供器结构校验保持有效

- **WHEN** 测试输入包含非法领域路径、非法 change 标识、非法文件名或缺失迁移导出
- **THEN** 提供器在执行任何待处理迁移前返回 `MIGRATION_INVALID`
- **AND** 不因合法迁移集合扩展而跳过既有结构校验

#### Scenario: 全局序号冲突保持有效

- **WHEN** 测试输入中的多个迁移根贡献重复全局序号
- **THEN** 提供器在加载或执行任何待处理迁移前返回 `MIGRATION_SEQUENCE_CONFLICT`
- **AND** 数据库迁移历史保持不变
