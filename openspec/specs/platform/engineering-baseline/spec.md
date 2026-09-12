## Purpose

为 RiskFlow 的全部生产能力提供唯一、可重放且可离线交付的 TypeScript 工程基线，使后续 change 可以在稳定目录、公开包边界和统一验证入口上独立实现与验收。

## Requirements

### Requirement: 单一生产 workspace

仓库 MUST 提供一个生产 pnpm workspace，且只包含 `apps/web`、`apps/api`、`apps/worker`、`packages/contracts`、`packages/core`、`packages/adapters` 六个成员。现有 `demo/` MUST 保留在生产 workspace 之外，不能成为生产应用或共享包的依赖。

#### Scenario: 发现全部生产成员
- **WHEN** 调用方从根目录读取 workspace 配置
- **THEN** 配置只声明三个生产应用和三个共享包
- **AND** 六个成员均具有可独立识别的包清单与 TypeScript 工程配置

#### Scenario: Demo 不进入生产依赖图
- **WHEN** 执行生产 workspace 的安装、构建或依赖边界检查
- **THEN** `demo/` 不作为 workspace 成员参与
- **AND** 任何生产成员均不依赖 `demo/` 或其 npm 锁文件

### Requirement: 冻结且可重放的工具链

生产 workspace MUST 固定 Node.js 24 LTS、精确 pnpm 版本和所有直接依赖版本，并由根 `packageManager`、`engines` 与单一 `pnpm-lock.yaml` 表达。CI 和交付验证 MUST 使用 `pnpm install --frozen-lockfile`，不得在验证过程中改写锁文件。

#### Scenario: 冻结安装成功
- **WHEN** 在受支持的 Node.js 24 环境中使用声明的 pnpm 版本执行 `pnpm install --frozen-lockfile`
- **THEN** 六个生产成员的依赖按锁文件安装完成
- **AND** Git 工作区中的依赖清单与锁文件保持不变

#### Scenario: 清单与锁文件不一致
- **WHEN** 直接依赖清单已变化但锁文件未同步
- **THEN** 冻结安装失败
- **AND** 安装过程不得自动生成新的依赖解析结果

#### Scenario: 不受支持的 Node 主版本
- **WHEN** 调用方使用非 Node.js 24 主版本执行生产工程命令
- **THEN** 工具链在安装或命令入口处明确拒绝该环境

### Requirement: 可构建的应用与深层共享包

三个生产应用和三个共享包 MUST 参与 TypeScript project references 构建。共享包 MUST 只通过各自 `package.json#exports` 暴露公开入口，应用 MUST 通过包入口消费共享能力，不得跨包深层导入。

#### Scenario: 全 workspace 构建
- **WHEN** 从根目录执行 `pnpm build`
- **THEN** 三个应用与三个共享包全部构建成功
- **AND** 构建不需要启动开发服务器或访问外部运行服务

#### Scenario: 公开入口可解析
- **WHEN** 任一生产应用导入共享包公开入口
- **THEN** TypeScript 和 Node.js 模块解析均能通过该包的 `exports` 找到声明文件与运行产物

#### Scenario: 深层导入被拒绝
- **WHEN** 生产成员尝试导入另一共享包未公开的内部路径
- **THEN** 类型检查或依赖边界检查失败

### Requirement: 强制单向依赖边界

生产代码 MUST 遵循 `apps → packages` 的方向；`contracts` MUST 不依赖 `core`、`adapters` 或应用，`core` MUST 只依赖 `contracts`，`adapters` MUST 只依赖 `contracts` 与 `core`。应用之间和共享包对应用的反向依赖 MUST 被自动检查拒绝。

#### Scenario: 合法依赖图
- **WHEN** 六个生产成员仅使用允许的公开依赖方向
- **THEN** `pnpm deps:check` 成功

#### Scenario: 反向或跨应用依赖
- **WHEN** `contracts` 引用 `core`、共享包引用应用，或一个应用直接引用另一个应用
- **THEN** `pnpm deps:check` 失败并定位违规依赖边

### Requirement: 统一且可组合的质量入口

根 workspace MUST 提供构建、类型检查、lint、格式检查、单元测试、依赖边界和 OpenSpec 校验命令，并提供一个不启动服务的聚合验证入口。聚合入口 MUST 在任一组成检查失败时返回非零状态。

#### Scenario: 工程基线完整通过
- **WHEN** 从根目录执行 `pnpm verify`
- **THEN** 构建、类型检查、lint、格式检查、单元测试、依赖边界与 OpenSpec 严格校验全部执行成功

#### Scenario: 任一检查失败
- **WHEN** 聚合验证中的任一检查发现错误
- **THEN** `pnpm verify` 返回失败
- **AND** 后续 CI 阶段不得把该结果标记为通过

### Requirement: CI 使用本地同构命令

仓库 CI MUST 使用与开发者根命令相同的冻结安装和聚合验证入口，不得维护第二套隐藏构建逻辑，也不得依赖本地 Git Hook 才能发现违规。

#### Scenario: CI 验证提交
- **WHEN** CI 对提交执行工程基线检查
- **THEN** CI 使用声明的 Node.js 与 pnpm 版本执行冻结安装和 `pnpm verify`
- **AND** 不启动开发服务器或修改锁文件

### Requirement: 依赖来源与离线治理

每个直接第三方依赖 MUST 记录精确版本、用途、许可证、官方来源、离线取得方式和升级或替换触发条件。workspace MUST 能从锁定依赖生成 CycloneDX SBOM；缺少来源或许可证不在允许范围内时，依赖治理检查 MUST 失败。

#### Scenario: 生成依赖证据
- **WHEN** 从冻结锁文件执行 SBOM 与依赖治理命令
- **THEN** 生成的 CycloneDX 清单覆盖六个生产成员的锁定依赖
- **AND** 直接依赖均可关联到其治理记录

#### Scenario: 依赖治理信息缺失
- **WHEN** 新增直接依赖但未登记用途、许可证、来源、离线方式或退出条件
- **THEN** 依赖治理检查失败

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

### Requirement: 依赖构建脚本采用显式最小权限策略

生产 workspace MUST 在根 pnpm 配置中对已审阅的依赖 install/postinstall 脚本作出显式允许或拒绝决策，并保持未审阅脚本默认失败。当前锁定依赖图中的 `cpu-features`、`protobufjs` 与 `ssh2` 构建产物不是生产工程、Testcontainers 或根质量门禁的必需输入，配置 MUST 将三者标记为禁止执行；不得通过允许全部脚本或降低严格检查绕过评审。

#### Scenario: 冻结安装使用已提交的拒绝决策

- **WHEN** 在受支持的 Node.js 24 环境中使用声明的 pnpm 版本执行 `pnpm install --frozen-lockfile`
- **THEN** pnpm 不执行 `cpu-features`、`protobufjs` 与 `ssh2` 的 install/postinstall 脚本，且安装不返回 `ERR_PNPM_IGNORED_BUILDS`
- **AND** `pnpm-workspace.yaml`、`package.json` 与 `pnpm-lock.yaml` 在安装前后内容不变

#### Scenario: 根质量门禁不触发动态审批

- **WHEN** 当前锁定依赖已经冻结安装并从根目录执行 `pnpm verify`
- **THEN** 聚合质量门禁不因这三个依赖的脚本审批而提前退出
- **AND** 验证过程不追加占位决策，也不改写根配置、依赖清单或锁文件

#### Scenario: 新增未审阅构建脚本保持严格失败

- **WHEN** 后续锁定依赖图出现尚无显式策略决策的 install/postinstall 脚本
- **THEN** pnpm 不执行该脚本，并以未审阅构建错误阻止安装通过
- **AND** 调用方必须先审阅该脚本并提交明确决策，不得启用全局允许或降低严格检查
