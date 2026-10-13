## MODIFIED Requirements

### Requirement: 单一生产 workspace

仓库 MUST 提供一个生产 pnpm workspace，且只包含 `apps/web`、`apps/desktop`、`apps/api`、`apps/worker`、`packages/contracts`、`packages/core`、`packages/adapters` 七个成员。现有 `demo/` MUST 保留在生产 workspace 之外，不能成为生产应用或共享包的依赖。

#### Scenario: 发现全部生产成员
- **WHEN** 调用方从根目录读取 workspace 配置
- **THEN** 配置只声明四个生产应用和三个共享包
- **AND** 七个成员均具有可独立识别的包清单与 TypeScript 工程配置

#### Scenario: Demo 不进入生产依赖图
- **WHEN** 执行生产 workspace 的安装、构建或依赖边界检查
- **THEN** `demo/` 不作为 workspace 成员参与
- **AND** 任何生产成员均不依赖 `demo/` 或其 npm 锁文件

### Requirement: 冻结且可重放的工具链

生产 workspace MUST 固定 Node.js 24 LTS、精确 pnpm 版本和所有直接依赖版本，并由根 `packageManager`、`engines` 与单一 `pnpm-lock.yaml` 表达。Electron 内置 Node/Chromium 版本 MUST 随桌面发布单独记录，不以服务端 Node 主版本推断其运行时。CI 和交付验证 MUST 使用 `pnpm install --frozen-lockfile`，不得在验证过程中改写锁文件。

#### Scenario: 冻结安装成功
- **WHEN** 在受支持的 Node.js 24 环境中使用声明的 pnpm 版本执行 `pnpm install --frozen-lockfile`
- **THEN** 七个生产成员的依赖按锁文件安装完成
- **AND** Git 工作区中的依赖清单与锁文件保持不变

#### Scenario: 清单与锁文件不一致
- **WHEN** 直接依赖清单已变化但锁文件未同步
- **THEN** 冻结安装失败
- **AND** 安装过程不得自动生成新的依赖解析结果

#### Scenario: 不受支持的 Node 主版本
- **WHEN** 调用方使用非 Node.js 24 主版本执行生产工程命令
- **THEN** 工具链在安装或命令入口处明确拒绝该环境

### Requirement: 可构建的应用与深层共享包

四个生产应用和三个共享包 MUST 参与 TypeScript project references 构建。共享包 MUST 只通过各自 `package.json#exports` 暴露公开入口，应用 MUST 通过包入口消费共享能力，不得跨包深层导入。

#### Scenario: 全 workspace 构建
- **WHEN** 从根目录执行 `pnpm build`
- **THEN** 四个应用与三个共享包全部构建成功
- **AND** 构建不需要启动开发服务器或访问外部运行服务

#### Scenario: 公开入口可解析
- **WHEN** 任一生产应用导入共享包公开入口
- **THEN** TypeScript 和 Node.js 模块解析均能通过该包的 `exports` 找到声明文件与运行产物

#### Scenario: 深层导入被拒绝
- **WHEN** 生产成员尝试导入另一共享包未公开的内部路径
- **THEN** 类型检查或依赖边界检查失败

### Requirement: 强制单向依赖边界

生产代码 MUST 遵循 `apps → packages` 的方向；`contracts` MUST 不依赖 `core`、`adapters` 或应用，`core` MUST 只依赖 `contracts`，`adapters` MUST 只依赖 `contracts` 与 `core`。Desktop MUST 通过 HTTPS 加载 Web，不以跨应用源码依赖实现界面复用。应用之间和共享包对应用的反向依赖 MUST 被自动检查拒绝。

#### Scenario: 合法依赖图
- **WHEN** 七个生产成员仅使用允许的公开依赖方向
- **THEN** `pnpm deps:check` 成功

#### Scenario: 反向或跨应用依赖
- **WHEN** `contracts` 引用 `core`、共享包引用应用，或一个应用直接引用另一个应用
- **THEN** `pnpm deps:check` 失败并定位违规依赖边
