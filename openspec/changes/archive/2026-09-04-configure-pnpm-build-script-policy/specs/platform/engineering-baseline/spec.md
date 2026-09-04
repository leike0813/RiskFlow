## ADDED Requirements

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
