## 1. 迁移测试夹具兼容性

- [x] 1.1 以当前生产迁移根中的全部合法 platform migrations、现有 fixture migration 与 delta spec 为输入，仅修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`：静态导入合法模块，用一个显式闭合清单同时生成精确路径 loader 和预期 migration names，使生产 provider 断言覆盖已声明的完整集合；未声明模块仍收口为 `MIGRATION_INVALID`，并保留非法路径、非法导出、重复全局序号及执行前完整校验的现有证据。运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts --testTimeout=120000` 验证；禁止修改 `packages/adapters/src/postgres/migrations/**`、增加任意动态导入或新建测试文件。
- [x] 1.2 以 C04/C06 合并后的生产迁移根和任务 1.1 的集合为输入，更新 `packages/adapters/test/auth/fixture.ts` 的闭合 loader：静态导入并许可 foundation、C04 `000002` 与 C06 `000003`，精确拒绝其它模块；运行授权测试验证合法迁移不会在执行前触发 `MIGRATION_INVALID`，禁止修改生产 provider、migration runner 或生产 migration。直接授权测试通过（12/12）。

## 2. 最小质量门禁

- [ ] 2.1 以任务 1.1～1.2 的双 fixture diff 为输入，运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false && pnpm exec eslint packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts && pnpm exec prettier --check packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts && pnpm test`，验证 adapter 类型、受影响 fixture 静态检查与根 Vitest 全部退出码为 0；禁止安装或更新依赖、启动服务或越界修复无关问题。
- [x] 2.2 以最终 proposal、delta spec、design、tasks 和实现 diff 为输入，运行 `openspec validate fix-postgresql-test-migration-loader-compatibility --strict --no-interactive && git diff --check && git status --short`，验证 OpenSpec 严格校验通过且实现文件只有 `packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`；禁止修改 proposal、主 specs、其它 change、生产代码、manifest、根配置或锁文件，也不归档、提交或修改 Git 历史。

> 2.1 状态：任务 1.1 的直接 tsc、eslint、prettier 与 Vitest 通过（14/14）；本任务的 adapter tsc、两文件 ESLint、Prettier 与直接授权测试通过（12/12）。根 pnpm 命令因既有 `ERR_PNPM_IGNORED_BUILDS` 在执行前退出，自动追加的 `allowBuilds` 已清理；根直接 Vitest（9 个文件、122 个测试）有 1 个既有授权 throttle 用例因默认 5 秒测试超时失败，剩余根门禁待主调度处理。
