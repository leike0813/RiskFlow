## Context

参见 [proposal.md](./proposal.md) 的动机。当前仓库没有生产 `package.json`、workspace、锁文件或 CI；`demo/` 是独立参考原型，不能参与生产依赖图。C00 是 G0 的单线前置 change，并在归档后独占根工具链、锁文件、CI 和包边界配置。

本设计受以下条件约束：Node.js 24 与 pnpm 已确定；生产目录固定为三个应用和三个共享包；后续 C01/C02 才拥有领域契约与模块接口；开发和 CI 必须复用同一组不启动服务的命令；依赖与工件要能在甲方内网重放。

## Goals / Non-Goals

**Goals:**

- 用一个锁文件和一组根命令建立六个生产成员的最小可构建闭环。
- 让包公开入口、TypeScript references 和自动依赖图检查共同阻止跨层及深层导入。
- 让每个直接第三方依赖都有可机读的用途、许可证、来源、离线方式和退出条件，并能从锁文件生成 CycloneDX SBOM。
- 把后续 OpenSpec 工件需要反复遵守的当前项目约束写入 `openspec/config.yaml`。

**Non-Goals:**

- 不提前创建业务 DTO、接口、数据库表、LangGraph 节点、路由、页面、Mock 或未来 adapter。
- 不在 C00 引入 Zod、LangGraph、PostgreSQL/Qdrant 客户端、React Router、组件库、可观测性和端到端测试工具；各依赖由首次实际使用它的 change 引入。
- 不把 SBOM、pnpm store 或构建输出提交进 Git；它们是由锁文件可重建的交付工件。

## Decisions

### 1. Workspace 身份与事实所有权

生产 workspace 只匹配下列六个精确路径，不使用 `apps/*` 或 `packages/*` 宽泛 glob：

| 路径 | 包名 | C00 入口 | 允许依赖 |
| --- | --- | --- | --- |
| `apps/web` | `@riskflow/web` | React 挂载一个空应用根节点 | `@riskflow/contracts`、`@riskflow/core`、`@riskflow/adapters` |
| `apps/api` | `@riskflow/api` | 导出 `buildApi(): FastifyInstance`，不监听端口 | 三个共享包 |
| `apps/worker` | `@riskflow/worker` | 导出空的 Worker 模块入口 | 三个共享包 |
| `packages/contracts` | `@riskflow/contracts` | 空的公开模块入口 | 无 workspace 依赖 |
| `packages/core` | `@riskflow/core` | 空的公开模块入口 | `@riskflow/contracts` |
| `packages/adapters` | `@riskflow/adapters` | 空的公开模块入口 | `@riskflow/contracts`、`@riskflow/core` |

“空入口”只建立 ESM 模块与 `exports`，不得虚构领域类型、服务接口或占位实现。应用可以声明上表中的允许方向，但只添加当前源码实际导入的 workspace 依赖。`demo/` 不改动，也不被任何生产清单引用。

选择深层共享包而不是按未来模块拆包，是为了把模块语义留给 C01/C02；选择精确 workspace 成员而不是 glob，是为了让新增目录不能无审查进入生产依赖图。

### 2. 固定运行时、模块格式与构建方式

- `.node-version` 固定 `24.12.0`；根 `engines.node` 接受 `>=24.12.0 <25`，安装时通过 `.npmrc` 的严格 engine 检查拒绝其他主版本。
- 根 `packageManager` 固定当前已验证可用的 `pnpm@11.10.0`。升级 Node 补丁或 pnpm 版本必须同时更新声明、锁文件、CI 和离线缓存，不由流水线自动发生。
- 所有生产包使用 ESM。服务端和共享包采用 TypeScript `NodeNext` 解析；Web 采用适合 Vite 的 `Bundler` 解析。根 `tsconfig.json` 只保存六个 project references，通用严格选项位于 `tsconfig.base.json`。
- `packages/*`、`apps/api` 与 `apps/worker` 由 `tsc -b` 输出 JavaScript、声明文件和增量信息；Web 先参加 references 类型构建，再由 Vite 生成浏览器产物。所有输出写入成员自身的 `dist/`，由 Git 忽略。
- 共享包 `package.json#exports` 只暴露 `.`，并同时指向运行文件和声明文件。禁止 `./src/*`、通配子路径或跨包相对路径。

未采用 Turborepo、Nx、tsup 或额外任务运行器：六个成员的 `tsc -b`、pnpm filter 和 Vite 已覆盖当前需求，额外缓存层没有可量化收益。

### 3. 根命令是开发与 CI 的唯一入口

根清单提供以下脚本，子包脚本只完成本包的最小动作：

| 命令 | 行为与通过条件 |
| --- | --- |
| `pnpm build` | `tsc -b` 后构建 Web bundle；六个成员均成功且不启动服务 |
| `pnpm typecheck` | `tsc -b --pretty false`；所有 references 和公开导入可解析 |
| `pnpm lint` | ESLint Flat Config 检查生产源码、配置和治理脚本 |
| `pnpm format:check` | Prettier 只检查受版本控制的源码与配置 |
| `pnpm test` | Vitest 单次运行；C00 只测试依赖治理检查器的稳定失败边界 |
| `pnpm deps:check` | dependency-cruiser 校验应用、共享包方向和跨包深层导入 |
| `pnpm deps:policy` | Node 标准库脚本对账所有直接第三方依赖与治理清单 |
| `pnpm openspec:validate` | `openspec validate --all --strict --no-interactive` |
| `pnpm sbom` | cdxgen 从现有锁定安装生成 CycloneDX JSON，不重新安装依赖 |
| `pnpm verify` | 顺序组合 build、typecheck、lint、format、test、两项依赖检查与 OpenSpec 校验，首个失败即返回非零 |

build 与 typecheck 在 C00 有部分重复，但分别保留“产生交付产物”和“调用方检查入口”的稳定语义；以后可在不改变脚本契约的前提下优化缓存。空的应用/包不增加 smoke test；唯一新增测试对治理检查器输入缺失字段和未登记直接依赖使用表格驱动用例，避免锁定完整错误文案。

CI 使用 `.node-version`、Corepack、`pnpm install --frozen-lockfile`、`pnpm verify` 和 `pnpm sbom`，上传 SBOM 工件；不复制子命令、不启动服务、不写回锁文件。

### 4. 依赖边界由三个互补机制收口

1. TypeScript project references 表达合法编译依赖；`contracts` 无引用，`core` 只引用 `contracts`，`adapters` 只引用前两者，应用只引用共享包。
2. `exports` 让 Node/TypeScript 只能解析包公开入口。
3. dependency-cruiser 从源码导入图拒绝：共享包到应用、应用到应用、`contracts` 反向依赖、`core` 到 `adapters`、包内 `src` 深层导入，以及生产代码导入 `demo/`。

检查只针对静态导入边，不自研第二套包图。未来动态插件若真实出现，由拥有该能力的 change 扩展规则。

### 5. C00 直接依赖及精确版本

版本在 2026-08-31 以 npm 官方元数据和本机 Node/pnpm 能力核验。运行依赖只放在实际使用它的应用；构建与治理工具集中为根开发依赖。`pnpm-lock.yaml` 的完整性字段是下载内容哈希的 SSOT，不在治理清单重复手抄哈希。

| 依赖 | 版本 | 用途 | 许可证 | 官方来源 | 离线方式 | 升级/替换触发条件 |
| --- | --- | --- | --- | --- | --- | --- |
| `react` / `react-dom` | `19.2.8` | Web 最小运行入口 | MIT | npm 官方包 | 内网 npm 镜像或 `pnpm fetch` store | 安全问题、React 19 维护终止或 C10 经验证需要兼容升级 |
| `fastify` | `5.12.1` | API 工厂与薄 HTTP 入口 | MIT | npm 官方包 | 同上 | 安全问题、Node 24 不兼容或 C09 验收失败 |
| `typescript` | `5.9.3` | references 编译 | Apache-2.0 | npm 官方包 | 同上 | 安全/兼容问题；TypeScript 7 仅在全仓迁移 change 中评估 |
| `@types/node` | `24.13.3` | Node 24 类型 | MIT | npm 官方包 | 同上 | Node 基线升级 |
| `@types/react` | `19.2.18` | React 类型 | MIT | npm 官方包 | 同上 | React 类型兼容问题 |
| `@types/react-dom` | `19.2.5` | React DOM 类型 | MIT | npm 官方包 | 同上 | React DOM 类型兼容问题 |
| `vite` | `8.2.2` | Web 生产构建 | MIT | npm 官方包 | 同上 | 安全问题、Node/React 插件不兼容或 C10 构建门槛不达标 |
| `@vitejs/plugin-react` | `6.1.1` | Vite React 转换 | MIT | npm 官方包 | 同上 | 与固定 Vite/React 不兼容 |
| `vitest` | `4.1.11` | 统一单元测试入口 | MIT | npm 官方包 | 同上 | 安全/兼容问题或稳定测试能力无法覆盖 |
| `eslint` | `10.9.1` | Flat Config 执行器 | MIT | npm 官方包 | 同上 | 安全问题或与 typescript-eslint 不兼容 |
| `@eslint/js` | `10.0.1` | ESLint JavaScript 基础规则 | MIT | npm 官方包 | 同上 | 安全问题或与 ESLint Flat Config 不兼容 |
| `typescript-eslint` | `8.68.0` | TypeScript ESLint 解析与规则 | MIT | npm 官方包 | 同上 | 不支持固定 TypeScript/ESLint |
| `prettier` | `3.9.6` | 唯一格式化器 | MIT | npm 官方包 | 同上 | 安全问题或不支持所用语法 |
| `dependency-cruiser` | `17.1.0` | 静态依赖边界 | MIT | npm 官方包 | 同上 | 无法识别实际模块图或维护停止；优先改用已有编译器能力 |
| `@cyclonedx/cdxgen` | `12.8.4` | 从 pnpm 锁定工程生成 CycloneDX SBOM | Apache-2.0 | npm 官方包与 CycloneDX/cdxgen 官方仓库 | 同上；运行时禁止自动安装 | 高危漏洞、pnpm 支持失效或交付平台提供更小的等价原生生成器 |

`config/dependency-policy.json` 按单包精确记录上述元数据，因此组合行在实际文件中拆开。允许许可证初始只有 `MIT` 与 `Apache-2.0`。`scripts/check-dependency-policy.mjs` 使用 Node 标准库读取根及六个成员的 `dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies`：忽略 `workspace:` 内部依赖；拒绝范围版本、未登记项、陈旧登记、缺字段和不在允许列表的许可证。

未选择 `@cyclonedx/cyclonedx-npm`，因为它面向 npm；未自写 CycloneDX 序列化器，因为 cdxgen 已原生支持 pnpm，少量自研代码无法可靠覆盖完整传递依赖。cdxgen 的传递体积是已知成本，C37 若能由交付平台生成等价 SBOM，可在独立依赖演进 change 中替换。

### 6. 离线重放边界

C00 只建立两条可验证路径：

- 在线制备环境执行冻结安装后，可用 `pnpm fetch --frozen-lockfile` 填充与锁文件对应的 pnpm store，或由内网 npm 镜像提供同一包版本。
- 离线验证环境使用已制备 store 执行 `pnpm install --offline --frozen-lockfile`，不得回退公网或重新解析版本。

仓库不提交 store、压缩包或镜像地址中的凭据。C37 负责最终离线交付包、许可证全集、容器 digest 和制品签收；C00 只保证 npm 依赖的来源信息与重放命令有唯一入口。

### 7. OpenSpec 配置只承载高频当前约束

`openspec/config.yaml` 保持 `spec-driven`，新增简洁 `context`：项目中文语境、Node 24/pnpm/TypeScript 技术栈、三应用三共享包、四层边界、双专利 RI/RA 追踪、共享 Schema/版本/证据/审计约束、Agent-native 确定性边界及稳定行为测试策略。

工件规则要求：proposal 明确 scope/依赖/所有权/追踪/依赖治理；spec scenario 描述可观察行为和适用的失败/权限/版本/幂等边界；design 固定接口、Schema、状态、持久化、权限、错误、可观测性、迁移、文件所有权与追踪；tasks 写目标文件、前置输入、产物、命令和禁止修改区。apply 必须使用已归档直接依赖并执行最小验证；archive 前必须 verify、同步主 specs 并确认无活动下游仍引用未归档契约。

不复制完整专利正文和 39-change 路线；它们继续由 `AGENTS.md` 与规划工件持有，避免三处漂移。

### 8. 安全、错误、审计与运行语义

C00 没有业务输入、权限、Agent 工具、事务、Outbox、检查点、Qdrant 投影、秘密或双时间事实，因此不创建对应抽象。API 工厂不注册业务路由，Worker 不启动循环，Web 不展示业务页面。

工程命令以进程退出码作为结构化结果：`0` 表示通过，非零表示失败；底层工具保留自身定位信息。治理脚本输出稳定问题代码和受影响包名/依赖名，但测试不锁定完整中文文案。CI 日志不得打印 registry 凭据，离线镜像认证只由部署环境注入。

本 change 的审计证据是：冻结锁文件、CI 运行记录、OpenSpec 严格校验输出、边界检查输出、治理检查输出和生成的 SBOM。业务审计表由后续 change 建立，不能用 CI 日志代替。

### 9. 文件所有权与禁止修改区

**修改：**

- `openspec/config.yaml`：写入当前项目 context、工件与 apply/archive 规则。
- `.gitignore`：忽略生产构建、测试缓存和本地生成 SBOM，不改已有忽略规则语义。

**新增根文件：**

- `.node-version`、`.npmrc`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`
- `tsconfig.base.json`、`tsconfig.json`、`eslint.config.js`、`prettier.config.mjs`、`.prettierignore`
- `dependency-cruiser.config.cjs`
- `config/dependency-policy.json`
- `scripts/check-dependency-policy.mjs`、`scripts/check-dependency-policy.test.ts`
- `.github/workflows/verify.yml`

**新增成员文件：**

- 六个成员各自的 `package.json`、`tsconfig.json` 和 `src/index.ts`；Web 另有 `index.html`、`vite.config.ts`、`src/main.tsx`；API 另有 `src/app.ts`。

**禁止修改：**

- `demo/**`、`references/**`、`.scratch/**`、既有专利/产品规划工件和任何用户未提交改动。
- 不新增领域目录、迁移、环境变量模板、容器文件、业务路由、页面组件或 adapter。

C00 归档后，上述根工具链、锁文件、CI 与中央边界配置改为主 Agent 串行所有；业务 change 不得顺手修改。新增第三方依赖要先由拥有其用途的 change 更新治理记录和锁文件，并经主 Agent 集成。

### 10. 追踪与验收证据

| C00 要求 | 工程入口 | 持久化/版本事实 | 验收证据 | RI/RA |
| --- | --- | --- | --- | --- |
| 单一 workspace | `pnpm-workspace.yaml`、六个清单 | Git 中的路径和包版本 | workspace 列表、冻结安装 | 不适用；仅工程基线 |
| 工具链重放 | `.node-version`、`packageManager`、lockfile | Node/pnpm/依赖精确版本 | frozen/offline install | 不适用 |
| 构建与公开入口 | `tsc -b`、Vite、`exports` | 编译产物可重建 | build/typecheck | 不适用 |
| 单向边界 | references、dependency-cruiser | 规则文件版本 | 合法图通过、违规夹具失败 | 支撑四层边界，不实现专利步骤 |
| 质量与 CI | `pnpm verify` | CI workflow | 本地与 CI 同构输出 | 不适用 |
| 依赖治理 | policy checker、cdxgen | lockfile + policy | 缺失登记失败、SBOM 工件 | 支撑私有交付，不实现专利步骤 |
| OpenSpec context | `openspec/config.yaml` | Git 版本 | 后续 instructions 与 strict validate | 后续 RI/RA 工件继承追踪规则 |

### 11. Worktree setup hook

C00 工作树继续使用已经确认的 `--setup skip`，因为根锁文件尚不存在。C00 集成并归档后，主 Agent 才把 Orca 项目 setup hook 配置为 `pnpm install --frozen-lockfile`，随后新建一个受控工作树以 `--setup run` 验证。hook 配置是本地协作运行设置，不提交到产品仓库；失败时保留终端输出并阻止开放下一条实施 lane。

## Risks / Trade-offs

- [cdxgen 的传递依赖较大] → 只在开发/CI 安装，生成时禁止自动安装；C37 可在保持 CycloneDX 输出的前提下以交付平台原生工具替换。
- [Node/pnpm 固定补丁会增加升级动作] → 换取开发、CI 与离线环境一致；升级只改四个明确事实源并重新冻结验证。
- [最小应用暂时没有业务行为] → C00 只验证工具链，不制造假业务；C01/C02 归档后才允许实现业务能力。
- [依赖边界静态检查无法发现任意运行时加载] → 当前不允许动态插件；真实需求出现时由所属 change 增加有界注册机制和验证。
- [离线安装依赖预先制备的 store 或内网镜像] → C00 提供可重放命令和来源；C37 负责最终介质、凭据注入和无网验收。

## Migration Plan

1. 先更新 OpenSpec context，再建立根工具链、治理文件与六个成员入口。
2. 使用固定 pnpm 生成唯一锁文件；依次执行 frozen install、`pnpm verify`、`pnpm sbom`，并额外用临时违规夹具确认边界和治理失败路径。
3. 运行 `openspec-verify-change`，主 Agent审阅文件所有权、依赖元数据和无网重放证据后归档 C00。
4. 归档后初始化 CodeGraph（需用户另行授权），配置 Orca setup hook，并用新工作树验证 frozen setup；通过后才创建 C01 工作树。

回滚时删除 C00 新增的生产工程文件并恢复 `openspec/config.yaml`、`.gitignore` 的本 change 修改；`demo/` 始终未迁移，无数据或业务状态需要恢复。已经生成的 `dist/`、SBOM 和 pnpm store 都是可删除、可重建工件，不作为业务事实。
