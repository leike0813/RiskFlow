## Context

参见 [proposal.md](./proposal.md) 的问题说明。根清单固定 `pnpm@11.10.0`，`pnpm-workspace.yaml` 当前只声明六个生产成员；pnpm 11 的 `strictDepBuilds` 默认为 `true`，依赖含有未在 `allowBuilds` 中决策的构建脚本时会返回 `ERR_PNPM_IGNORED_BUILDS`。[pnpm 官方构建设置](https://pnpm.io/settings/build#allowbuilds)将 `allowBuilds` 定义为包匹配器到 `true`/`false` 的映射：`false` 表示已审阅并禁止脚本执行，未列出的包仍保持未审阅并默认失败；安装时自动写入的占位决策不能替代仓库评审后的静态配置。

当前三个未决包都经 `@testcontainers/postgresql@12.1.0` 的传递依赖链进入根开发依赖：

| 包 | 实际脚本 | 运行时证据 | 决策 |
| --- | --- | --- | --- |
| `cpu-features@0.0.10` | `install`: 生成 gyp 配置并执行 `node-gyp rebuild` | 它是 `ssh2` 的可选依赖；`ssh2` 加载失败时捕获异常，只失去 CPU 特征辅助排序 | `false` |
| `protobufjs@7.6.6` | `postinstall`: 检查父包依赖版本前缀并按需输出告警 | 脚本不生成运行产物，不改变 protobuf 编解码实现 | `false` |
| `ssh2@1.17.0` | `install`: 尝试构建可选 `sshcrypto.node` | 构建失败本身被上游视为非致命；运行时捕获绑定缺失并使用 Node.js/JavaScript/WASM 路径 | `false` |

相邻已安装工作树中 `cpu-features` 与 `ssh2` 的原生构建产物均不存在，`protobufjs` 的 postinstall 本身不生成运行产物；使用同一锁定依赖图的 PostgreSQL foundation 与授权定向测试已经通过。这与包内显式回退代码共同证明当前工程不依赖这些脚本输出。

## Goals / Non-Goals

**Goals:**

- 用 pnpm 11 原生配置为当前三个依赖脚本提交唯一、可审查的拒绝决策。
- 让冻结安装与根质量入口在不执行三项脚本的前提下继续运行。
- 保持未知依赖脚本严格失败，并证明验收命令不会动态改写根策略、清单或锁文件。

**Non-Goals:**

- 不在本 change 中允许任何依赖构建脚本，不增加版本匹配器、审批 CLI 包装、校验脚本或第二份策略清单。
- 不修改 `package.json`、`pnpm-lock.yaml`、依赖版本、直接依赖治理记录、CI、生产代码或测试代码。
- 不修复 `pnpm verify` 暴露的其它独立失败，不运行或启动任何服务。

## Decisions

### 1. `pnpm-workspace.yaml#allowBuilds` 是唯一策略入口

实施只在现有成员清单后增加：

```yaml
allowBuilds:
  cpu-features: false
  protobufjs: false
  ssh2: false
```

选择 pnpm 11 原生 `allowBuilds`，因为它同时表达“允许”和“已审阅后拒绝”，也是 `pnpm@11.10.0` 识别的当前配置。包名级 `false` 会继续拒绝这些包的后续锁定版本，避免依赖升级后未经新评审便执行脚本；若未来版本把构建产物变为必需能力，应另开 change，核对脚本、平台产物与供应链风险后才可改为 `true`。

不使用已经由 pnpm 11 移除的 `onlyBuiltDependencies`、`ignoredBuiltDependencies` 等旧字段；不设置 `dangerouslyAllowAllBuilds`，也不把 `strictDepBuilds` 改为 `false`。这样，当前三个包从“未审阅”变为“明确拒绝”，其它新出现的构建脚本仍以 `ERR_PNPM_IGNORED_BUILDS` 暴露。

### 2. 三项均拒绝构建，不保留不必要的原生路径

`cpu-features` 和 `ssh2` 的 node-gyp 产物只提供可选的 CPU/密码实现优化，包本身已有缺失绑定的显式回退；`protobufjs` 的 postinstall 只提示依赖范围约定。批准其中任一脚本都会扩大安装时的代码执行面和本机构建工具要求，却不增加当前验收所需的功能，因此三项统一为 `false`。

该决策只禁止生命周期脚本，不从依赖图删除包，也不改变锁文件解析。Testcontainers、Docker 连接以及现有 PostgreSQL 测试仍消费相同 JavaScript 包内容。

### 3. 验收同时检查成功结果和零动态写入

实施验收在受支持的 Node.js 24 与声明的 pnpm 版本下按以下顺序执行：

1. 记录 `pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml` 的内容摘要。
2. 执行 `pnpm install --frozen-lockfile`，要求退出码为 0，且不出现 `ERR_PNPM_IGNORED_BUILDS`。
3. 执行 `pnpm verify`，要求根聚合质量门禁退出码为 0，且不因依赖审批触发隐式安装失败。
4. 再次计算三文件摘要并与步骤 1 比较，要求逐文件一致；随后运行 `git diff --check`。

摘要只用于一次验收前后比较，不提交摘要文件，也不在仓库新增哈希门禁。若 `pnpm verify` 暴露与本策略无关的既有失败，执行者必须保留原始失败并交回主调度 Agent，不能扩大本 change 修改范围。

### 4. 接口、状态、权限与审计边界不扩张

本 change 没有应用接口、领域 Schema、数据库状态、事务、运行时身份或授权决策。唯一持久状态是 Git 管理的 `allowBuilds` 映射；脚本执行权限由 pnpm 在安装边界确定。错误与可观测性沿用 pnpm 进程退出码和包名定位信息，验收记录由 OpenSpec verification 与 Git diff 提供，不新增业务审计事件或日志格式。

### 5. 文件所有权固定

**实施修改：**

- `pnpm-workspace.yaml`：增加三个包名级 `false` 决策。

**本次规划新增：**

- `openspec/changes/configure-pnpm-build-script-policy/.openspec.yaml`
- `openspec/changes/configure-pnpm-build-script-policy/proposal.md`
- `openspec/changes/configure-pnpm-build-script-policy/design.md`
- `openspec/changes/configure-pnpm-build-script-policy/specs/platform/engineering-baseline/spec.md`
- `openspec/changes/configure-pnpm-build-script-policy/tasks.md`

**禁止修改：**

- `package.json`、`pnpm-lock.yaml`、`.npmrc`、CI、`config/dependency-policy.json`；
- `apps/**`、`packages/**`、`demo/**`、`references/**`、生产代码与测试代码；
- `openspec/specs/**`、其它活动/归档 change、`openspec/config.yaml`。

## Risks / Trade-offs

- [可选原生加速不可用] → 当前回退路径已被包自身支持，且测试证据不依赖原生产物；只有可测性能或协议能力要求出现时才重新评审单个包。
- [包名级拒绝也覆盖未来版本] → 这是最小权限的预期行为；依赖升级若改变脚本必要性，必须在升级 change 中重新取证并显式调整。
- [未来新增带脚本依赖仍可能让 pnpm 失败并写入待决占位] → 保留严格失败以暴露供应链决策，评审者不得提交占位值或通过全局放宽绕过。

## Migration Plan

1. 应用阶段只把设计中的 `allowBuilds` 映射加入根 `pnpm-workspace.yaml`，不运行会更新锁文件的安装命令。
2. 主调度 Agent 审阅静态 diff 后执行设计 §3 的冻结安装、根质量门禁和前后摘要验收。
3. 若当前 JavaScript 回退路径无法通过既有门禁，移除本次映射即可回滚；不得直接把三项全部改为 `true`，应根据失败包重新规划最小单项授权。
