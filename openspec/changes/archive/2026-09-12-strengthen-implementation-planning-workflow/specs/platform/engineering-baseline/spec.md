## MODIFIED Requirements

### Requirement: OpenSpec 后续工件继承项目约束

OpenSpec 项目配置 MUST 向后续 change 提供已确认的技术栈、四层架构、双专利追踪、共享契约、测试策略与 apply/archive 规则。大型能力、接口或模块 change MUST 使用项目级 `riskflow-delivery` workflow，依次形成 proposal、specs、design、implementation-plan 与 tasks；配置 MUST 只描述当前有效约束，不复制完整专利正文或维护变更历史。

#### Scenario: 获取后续工件指令

- **WHEN** 为大型能力、接口或模块 change 请求 proposal、specs、design、implementation-plan 或 tasks 指令
- **THEN** 返回的项目 context 与规则包含对应工件所需的 RiskFlow 当前约束
- **AND** implementation-plan 将已批准设计映射到固定代码基线、IP-ID、文件与符号、执行顺序和可运行验证
- **AND** tasks 逐项引用 implementation-plan 中的 IP-ID

#### Scenario: 应用大型 change

- **WHEN** 为使用 `riskflow-delivery` 的 change 请求 apply 指令
- **THEN** proposal、specs、design、implementation-plan 与 tasks 均为 apply 的直接必需工件
- **AND** implementation-plan 自动包含在实现 Agent 必须读取的 contextFiles 中
- **AND** 指令要求行为与证据均完成后才勾选任务，并在工件冲突、代码漂移或计划外变更时 ask 或 escalation

#### Scenario: 使用 CLI 管理自定义 workflow

- **WHEN** 主调度 Agent 创建大型 change
- **THEN** 创建命令显式选择 `--schema riskflow-delivery`，并从创建结果的 `change.schema` 或 status 的 `schemaName` 确认实际 schema
- **AND** 后续 status、artifact instructions、apply instructions、validate、show 与 archive 按 change 元数据解析，不对既有 change 强制覆盖 schema
- **AND** implementation-plan 使用工件 ID `implementation-plan` 请求指令

#### Scenario: 完成能力级变更

- **WHEN** 大型 change 的实现任务完成
- **THEN** 后续流程仍依次执行 OpenSpec apply、独立 verify 与 archive
- **AND** 验证逐个 IP-ID 核对计划文件、Requirement/Scenario、实现行为与可运行证据
