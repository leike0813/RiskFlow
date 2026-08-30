## 1. OpenSpec 项目约束

- [x] 1.1 按 design §7 修改 `openspec/config.yaml`，写入当前技术栈、四层边界、RI/RA 追踪、共享契约、测试及 proposal/specs/design/tasks/apply/archive 规则；以 `openspec validate --all --strict --no-interactive` 和后续工件 instructions 能返回项目 context 为通过条件；不得复制完整专利正文、39-change 路线或修改 `openspec/changes/**` 既有工件。

## 2. 根 workspace 与冻结依赖

- [x] 2.1 依据 design §1～§2 新增 `.node-version`、`.npmrc`、根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json` 与根 references `tsconfig.json`，只声明六个精确生产成员、Node `24.12.0`、pnpm `11.10.0`、ESM 和设计表中的精确直接依赖；以 `pnpm --version`、`pnpm list -r --depth -1` 与清单审查通过为条件；不得纳入或修改 `demo/**`，不得引入 design 未列依赖。
- [x] 2.2 使用固定 pnpm 解析 2.1 的清单并新增唯一 `pnpm-lock.yaml`，再执行 `pnpm install --frozen-lockfile`；以冻结安装成功且 `git diff --exit-code -- package.json 'apps/*/package.json' 'packages/*/package.json' pnpm-lock.yaml` 无二次改写为通过条件；不得升级包、使用范围版本、生成第二个锁文件或安装 Demo 依赖。

## 3. 最小可构建成员

- [x] 3.1 新增 `packages/{contracts,core,adapters}/{package.json,tsconfig.json,src/index.ts}`，只建立 design §1 的包名、project references、`.` exports 和合法 workspace 依赖；以 `pnpm exec tsc -b packages/contracts packages/core packages/adapters --pretty false` 成功且公开入口存在为条件；不得定义 C01/C02 所有的 DTO、Schema、interface、领域常量或 adapter。
- [x] 3.2 新增 `apps/api/{package.json,tsconfig.json,src/index.ts,src/app.ts}` 与 `apps/worker/{package.json,tsconfig.json,src/index.ts}`；API 只导出不监听端口的 `buildApi(): FastifyInstance`，Worker 只建立模块入口；以两应用通过 `tsc -b` 且导入模块不启动监听/循环为条件；不得添加业务路由、环境变量、数据库、队列、LangGraph 或 Mock。
- [x] 3.3 新增 `apps/web/{package.json,tsconfig.json,index.html,vite.config.ts,src/index.ts,src/main.tsx}`，React 入口只挂载空应用根节点并参加 project references；以 Web 的 TypeScript 检查与 Vite production build 成功为条件；不得迁移 Demo、添加路由、组件库、业务页面、样式系统或可见开发说明。

## 4. 质量与边界检查

- [x] 4.1 新增 `eslint.config.js`、`prettier.config.mjs`、`.prettierignore` 并补充 `.gitignore` 的生产输出/缓存/SBOM规则，连接根 `lint` 与 `format:check` 脚本；以 `pnpm lint` 和 `pnpm format:check` 通过为条件；不得覆盖已有忽略项或引入第二套 lint、格式化及 Git Hook 工具。
- [x] 4.2 新增 `dependency-cruiser.config.cjs` 与根 `deps:check` 脚本，落实 design §4 的应用/共享包方向、深层导入和 Demo 隔离规则；以合法六成员图通过，并用未提交的临时违规导入分别确认反向依赖和深层导入返回非零后恢复工作树为条件；不得把临时夹具或例外规则提交进仓库。
- [x] 4.3 新增 `config/dependency-policy.json`、`scripts/check-dependency-policy.mjs` 和 `scripts/check-dependency-policy.test.ts`，使用 Node 标准库对账所有直接第三方依赖的精确版本、用途、许可证、来源、离线方式与退出条件；连接 `deps:policy` 和 Vitest 单次 `test` 脚本；以 `pnpm deps:policy` 通过且表格驱动测试证明未登记依赖/缺字段失败为条件；不得手抄锁文件 integrity、引入校验库或精确断言完整错误文案。

## 5. 聚合验证、SBOM 与 CI

- [ ] 5.1 在根 `package.json` 补齐 design §3 的 `build`、`typecheck`、`test`、`openspec:validate`、`sbom` 与 `verify` 组合脚本；以每个子命令可独立运行、`pnpm verify` 顺序执行全部检查且不启动服务为条件；不得用吞错、`|| true`、自动修复或锁文件改写掩盖失败。
- [ ] 5.2 新增 `.github/workflows/verify.yml`，只使用 `.node-version`、Corepack、`pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm sbom` 和 SBOM 工件上传；以 workflow 静态审查与本地同构命令全部通过为条件；不得复制子检查逻辑、写入凭据、启动开发服务器或访问业务外部服务。
- [ ] 5.3 运行 `pnpm fetch --frozen-lockfile` 后执行 `pnpm install --offline --frozen-lockfile`，再运行 `pnpm sbom` 并检查 CycloneDX JSON 覆盖六个 workspace 成员；以无公网回退、锁文件不变、SBOM 可解析且直接依赖均有治理记录为条件；不得提交 pnpm store、registry 凭据、构建输出或生成的 SBOM。

## 6. 交付验证

- [ ] 6.1 执行 `pnpm verify`、`git diff --check` 和 `openspec validate establish-openspec-engineering-baseline --strict --no-interactive`，逐项对账 proposal/spec/design 的文件所有权、Non-goals 和验收场景；以全部命令通过、无 `demo/**`/`references/**`/`.scratch/**` 改动且 `tasks.md` 状态真实为条件；不得扩大到 C01/C02、提交代码或启动开发服务器。
- [ ] 6.2 使用 `openspec-verify-change` 审核实现与工件一致性，保存 frozen install、边界失败夹具、治理失败测试、offline install、SBOM 和 CI 同构命令的验证摘要；以 verify 无 CRITICAL/HIGH 遗留为条件；归档、CodeGraph 初始化和 Orca setup hook 配置留给主 Agent 在集成审阅后执行。
