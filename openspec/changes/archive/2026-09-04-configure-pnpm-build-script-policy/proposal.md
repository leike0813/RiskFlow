## Why

pnpm 11 会把未审阅的依赖 install/postinstall 脚本视为错误；当前锁定依赖图中的 `cpu-features`、`protobufjs` 与 `ssh2` 尚无显式决策，导致冻结安装以及由根命令触发的依赖检查以 `ERR_PNPM_IGNORED_BUILDS` 提前退出。仓库需要提交最小权限的构建脚本策略，恢复工程基线已有的冻结安装与统一质量入口。

## What Changes

- 在根 `pnpm-workspace.yaml` 的 `allowBuilds` 中显式拒绝 `cpu-features`、`protobufjs` 与 `ssh2` 执行依赖构建脚本；三项均配置为 `false`。
- 保留 pnpm 11 对其它未审阅构建脚本的默认严格失败，不启用全局允许，也不降低 `strictDepBuilds`。
- 以 `pnpm install --frozen-lockfile`、`pnpm verify` 及命令前后根配置/清单/锁文件内容不变作为实施验收。
- 不修改依赖版本、`package.json`、`pnpm-lock.yaml`、生产代码、测试代码或业务产品规格。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/engineering-baseline`：在现有冻结工具链和统一质量入口上增加依赖构建脚本的显式最小权限策略。

## Impact

- **实施所有权**：只修改根 `pnpm-workspace.yaml`；本 change 另新增自身的 OpenSpec 规划工件。
- **依赖治理**：不新增、升级或删除依赖；`cpu-features@0.0.10`、`protobufjs@7.6.6`、`ssh2@1.17.0` 继续由现有 `pnpm-lock.yaml` 锁定，因此不改直接依赖治理清单。
- **运行行为**：当前三项依赖脚本不再执行，也不再作为未审阅脚本阻断安装；其它未登记脚本仍由 pnpm 11 默认策略拒绝。
- **RI/RA 追踪**：不实现或改变 RI-S1～RI-S6、RA-S1～RA-S7；该变更只修复平台工程基线门禁。
