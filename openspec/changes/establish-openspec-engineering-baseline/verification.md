# Verification Report: establish-openspec-engineering-baseline

验证日期：2026-08-31

## 结论

| 维度 | 结果 |
| --- | --- |
| 完整性 | 14/14 tasks；8/8 requirements |
| 正确性 | 8/8 requirements、16/16 scenarios 均有实现或工具链证据 |
| 一致性 | 实现遵守 design 的目录、依赖、边界、Non-goals 与文件所有权 |

未发现 CRITICAL、HIGH、WARNING 或 SUGGESTION。C00 可以归档。

## Requirement 映射

| Requirement | 实现与验证证据 |
| --- | --- |
| 单一生产 workspace | `pnpm-workspace.yaml` 精确声明六个成员；`pnpm list -r --depth -1` 返回根和六个生产成员；生产清单不引用 `demo/` |
| 冻结且可重放的工具链 | `.node-version`、`.npmrc`、根 `package.json` 与 `pnpm-lock.yaml` 固定 Node 24.12.0、pnpm 11.10.0 和直接依赖；frozen/offline install 后清单与锁文件无改写 |
| 可构建的应用与深层共享包 | 根 `tsconfig.json` 引用六个工程；三个共享包只导出 `.`；`pnpm build` 与 `pnpm typecheck` 通过 |
| 强制单向依赖边界 | `dependency-cruiser.config.cjs` 拒绝反向、跨应用、深层、Demo 与循环依赖；合法图和临时违规夹具均得到预期结果 |
| 统一且可组合的质量入口 | 根脚本使用 `&&` 顺序组合全部检查；`pnpm verify` 全部通过且未启动服务 |
| CI 使用本地同构命令 | `.github/workflows/verify.yml` 只调用 Corepack、frozen install、`pnpm verify`、pnpm 原生 SBOM 与工件上传 |
| 依赖来源与离线治理 | `config/dependency-policy.json` 覆盖全部直接第三方依赖；Node 标准库检查器与两项表格驱动失败用例通过；七份 CycloneDX 1.7 文件覆盖根和六个成员 |
| OpenSpec 后续工件继承项目约束 | `openspec/config.yaml` 提供当前技术栈、四层边界、RI/RA 追踪、共享契约及 apply/archive 规则；严格校验通过 |

## 命令证据

- 工具链：`node --version` 为 `v24.12.0`，`pnpm --version` 为 `11.10.0`。
- 冻结安装：`pnpm install --frozen-lockfile` 通过，依赖清单和锁文件无改写。
- 聚合验证：`pnpm verify` 通过，包括 build、typecheck、lint、format、2 项 Vitest、dependency-cruiser、依赖治理和 OpenSpec 严格校验。
- 边界失败夹具：临时让 `contracts` 深层导入 `core/src` 时返回非零并报告 `no-core-deep-import`、`no-contracts-reverse-dependency`；临时让 API 深层导入 `core/src` 时返回非零并报告 `no-core-deep-import`。夹具随后恢复，未入库。
- 治理失败测试：未登记直接依赖与缺少治理字段两个表格驱动用例均通过。
- 离线重放：Worker 的 PTY 环境执行 `pnpm fetch --frozen-lockfile` 与 `pnpm install --offline --frozen-lockfile` 通过；主 Agent在无 TTY 的 CI 同构环境以 `CI=true` 重跑同一流程通过，未发生公网回退或锁文件改写。
- SBOM：`pnpm sbom --sbom-format cyclonedx --split --out 'bom-%s.cdx.json'` 生成七份可解析的 CycloneDX 1.7 JSON；元数据覆盖 `api`、`web`、`worker`、`adapters`、`contracts`、`core`。生成物受 Git 忽略，未提交。
- CI 同构：本地依次执行 frozen install、`pnpm verify` 和原生 SBOM 命令通过；workflow 未复制子检查逻辑。
- OpenSpec：`openspec validate establish-openspec-engineering-baseline --strict --no-interactive` 与 `openspec validate --all --strict --no-interactive` 均通过。
- 仓库卫生：`git diff --check` 通过；相对 `main` 的 C00 差异不包含 `demo/**`、`references/**` 或 `.scratch/**`。

## Non-goals 与运行边界

C00 未新增领域 DTO、Schema、接口、LangGraph、数据库、模型、业务路由、页面组件、Mock、环境变量或部署适配器。API 只导出未监听端口的 `buildApi()`，Worker 不启动循环，Web 只挂载空根节点；验证期间未启动开发服务器。
