## 1. 根 pnpm 构建脚本策略

- [x] 1.1 以 `pnpm@11.10.0`、当前 `pnpm-lock.yaml`、design §Context 的三包脚本证据及 delta spec 为输入，只修改根 `pnpm-workspace.yaml`：在保留六个精确生产成员的同时新增 `allowBuilds`，将 `cpu-features`、`protobufjs`、`ssh2` 分别设为 `false`。通过静态审查确认映射与 design 完全一致；禁止使用审批命令动态写配置，禁止设置 `true`、`strictDepBuilds: false`、`dangerouslyAllowAllBuilds`，也禁止修改 `package.json`、`pnpm-lock.yaml`、依赖版本、CI、生产/测试代码或其它 OpenSpec 工件。

## 2. 冻结安装与根质量门禁验收

- [x] 2.1 以任务 1.1 的静态策略为输入，在受支持的 Node.js 24 和声明的 pnpm 版本下，先记录 `pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml` 的 `sha256sum`，再执行 `pnpm install --frozen-lockfile && pnpm verify`，最后重新计算并比较三文件摘要；要求两条 pnpm 命令退出码均为 0、不出现 `ERR_PNPM_IGNORED_BUILDS`、三文件前后逐项一致。摘要只保留在验证输出中，不创建临时工件或新校验脚本；若出现无关既有失败，保留原始结果并交回主调度 Agent，禁止越界修复。
- [x] 2.2 以最终静态 diff 和任务 2.1 输出为输入，运行 `openspec validate configure-pnpm-build-script-policy --strict --no-interactive && git diff --check && git status --short`；确认 OpenSpec 严格校验通过，实施 diff 除本 change 工件外仅有 `pnpm-workspace.yaml`，且 `package.json`、`pnpm-lock.yaml`、依赖、生产/测试代码、主 specs、其它 change 均未变化。禁止提交、归档、启动服务、运行 formatter/lint 或额外项目测试套件。
