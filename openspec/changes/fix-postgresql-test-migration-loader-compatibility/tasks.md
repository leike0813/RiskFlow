## 1. 迁移测试夹具兼容性

- [ ] 1.1 以当前生产迁移根中的全部合法 platform migrations、现有 fixture migration 与 delta spec 为输入，仅修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`：静态导入合法模块，用一个显式闭合清单同时生成精确路径 loader 和预期 migration names，使生产 provider 断言覆盖已声明的完整集合；未声明模块仍收口为 `MIGRATION_INVALID`，并保留非法路径、非法导出、重复全局序号及执行前完整校验的现有证据。运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts --testTimeout=120000` 验证；禁止修改 `packages/adapters/src/postgres/migrations/**`、增加任意动态导入或新建测试文件。

## 2. 最小质量门禁

- [ ] 2.1 以任务 1.1 的单文件 diff 为输入，运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false && pnpm exec eslint packages/adapters/test/postgres/postgres-foundation.test.ts && pnpm exec prettier --check packages/adapters/test/postgres/postgres-foundation.test.ts && pnpm test`，验证 adapter 类型、单文件静态检查与根 Vitest 全部退出码为 0；禁止安装或更新依赖、启动服务或越界修复无关问题。
- [ ] 2.2 以最终 proposal、delta spec、design、tasks 和实现 diff 为输入，运行 `openspec validate fix-postgresql-test-migration-loader-compatibility --strict --no-interactive && git diff --check && git status --short`，验证 OpenSpec 严格校验通过且实现文件只有 `packages/adapters/test/postgres/postgres-foundation.test.ts`；禁止修改 proposal、主 specs、其它 change、生产代码、manifest、根配置或锁文件，也不归档、提交或修改 Git 历史。
