## Context

参见 `proposal.md` 的问题说明。C03 的 PostgreSQL 集成测试夹具使用闭合测试迁移 loader，生产迁移根目录加入合法的后续 platform migration 后，生产提供器发现行为正确，但任何只声明历史子集的测试 loader 都会把新模块包装为 `MIGRATION_INVALID`。当前已知受影响夹具包括 `postgres-foundation.test.ts` 与 C06 授权测试 fixture。

本 change 不改变接口、Schema、数据库状态、权限、事务、审计、持久化或错误分类。C03 对 RI-S14、RI-S44、RI-S62～RI-S65 与 RA-S4～RA-S7 的追踪保持原样。

## Goals / Non-Goals

**Goals:**

- 让所有依赖生产迁移根的 PostgreSQL 测试夹具显式加载当前合法的多个 platform migration modules。
- 以测试内显式事实源驱动 loader 许可和生产 provider 的完整集合断言；每个定制 loader 都保持闭合边界。
- 保留未知模块拒绝、结构校验、重复序号预检和数据库历史不变的验收证据。

**Non-Goals:**

- 不修改生产 provider、migration runner、生产 migrations 或迁移编号分配。
- 不修改 package exports、manifest、依赖策略、根配置、锁文件、主 specs 或其它 change。
- 不增加自动扫描后任意动态导入、中央生产迁移注册表、新依赖或新的测试文件。

## Decisions

### 1. 测试夹具使用显式迁移模块清单作为唯一事实源

`packages/adapters/test/postgres/postgres-foundation.test.ts` 在现有静态 import 基础上声明受控清单。每项关联 migration root 下的精确相对路径、模块对象和稳定 migration name；fixture root 初始化后，将相对路径解析为精确文件路径供 loader 查找。生产迁移集合断言从同一清单取得期望名称并按全局序号比较，因此增加合法迁移只需补一项声明，不会再维护互相漂移的 loader 分支和单项数组。

`packages/adapters/test/auth/fixture.ts` 保持独立闭合 loader，静态导入该 fixture 所需的全部当前生产迁移模块，并按精确文件名许可；它不执行任意动态 import，也不依赖 PostgreSQL 测试文件的执行副作用。两类夹具都只允许当前声明集合，避免合法后续迁移触发错误，同时继续在未知模块上 fail closed。

未命中的文件路径继续抛错，由 provider 映射为 `MIGRATION_INVALID`。路径使用 root 加相对路径解析，不使用仅按 basename 或模糊后缀匹配，以免不同领域/change 的同名文件误获许可。

### 2. provider 与 runner 的生产行为保持不变

根因位于测试夹具，生产 provider 已满足“新增模块迁移无需中央注册”的主规格。实现只替换测试 loader 的许可数据和相关期望，不给 `provider.ts`、`run.ts` 或生产 migrations 增加兼容分支。

### 3. 既有负向校验保持独立可观察

非法 provider root、缺失 migration 导出以及重复 migration root 的现有场景继续断言稳定错误码，不断言完整错误文案。新增或调整的未知模块场景通过 provider/runner 边界观察 `MIGRATION_INVALID`；重复序号仍在模块加载和数据库执行前收口为 `MIGRATION_SEQUENCE_CONFLICT`。合法集合扩展不得弱化这些断言。

### 4. 文件所有权与验证范围固定

实现代码只修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`。最小行为验证依次运行 PostgreSQL foundation 单文件、受影响的授权测试、adapter TypeScript/ESLint/Prettier 检查和根 Vitest；OpenSpec 严格校验与 `git diff --check` 作为规格与补丁门禁。不得启动服务、归档或提交。

## Risks / Trade-offs

- [每个合法 platform migration 仍需在测试清单中显式登记] → 这是闭合 loader 的预期成本；单一清单使遗漏立即以 `MIGRATION_INVALID` 暴露，并同时更新集合断言。
- [静态 import 会让后续 migration 的模块副作用进入测试进程] → migration 模块应继续只导出 `up/down`；现有 provider 导出校验与定向集成测试负责暴露越界实现。
- [Testcontainers 依赖本机容器运行时] → 按 C03 既有规则明确失败，不静默 skip，也不增加内存替代。

## Migration Plan

这是测试代码与规格工件变更，不迁移或回滚数据库。应用 change 后运行 tasks 中的定向与根验证；若失败，回退 `postgres-foundation.test.ts` 的单文件修改即可，生产 migration 历史不受影响。
