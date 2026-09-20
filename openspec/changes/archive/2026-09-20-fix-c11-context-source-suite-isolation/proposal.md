## Why

`C25 assessment-preparation freeze` 子套件复用了同文件前序用例创建并改密后的 `c11-admin`，导致完整文件通过、按子套件过滤运行时因缺少该身份状态而以 `AUTHENTICATION_REJECTED` 失败。测试必须自行建立授权前置状态，才能稳定验证 C25 行为并支持独立回归。

## What Changes

- 让 C25 子套件通过现有 `startEngineeringContextSourceFixture` 工厂持有独立 fixture，并在自身 setup 中 bootstrap 专用系统管理员、完成首次改密、创建专用风险管理员及工程授权。
- 在子套件 teardown 中关闭专用 fixture；保留现有 C25 三个用例及全部断言，不使用 sleep、重试或条件回退。
- 验证完整测试文件、C25 子套件单跑以及相邻 C11 用例均通过。
- 明确非目标：不修改生产代码、公共测试夹具、业务契约、断言、依赖或其它子套件行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。该 drift 只修复测试环境的生命周期与身份状态隔离，不改变 `domain/engineering-context-source-registry` 或其它主规格的 Requirement/Scenario；本 change 显式跳过 spec delta。

## Impact

- **计划修改**：仅 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 中 `C25 assessment-preparation freeze` 子套件的 fixture 生命周期和身份 setup。
- **不修改**：生产源码、`packages/adapters/test/engineering-data/context-source/fixture.ts`、主 specs、依赖、锁文件及其它测试。
- **基线前置**：当前 base `f7b5689` 的目标文件只有 25 个测试，尚不含 C25 子套件；待包含该子套件的 C25 实现（已在提交 `8e3b0b8` 观察到）进入实施基线后，才能应用和运行本修复。若最终集成版本的符号或夹具结构不同，实施前必须回到规划核对，不得自行扩大范围。
- **兼容性与追踪**：无公共 API、Schema、数据库或运行时行为变化；该测试继续覆盖 RA-S1 评估准备输入冻结所需的 C11/C25 接缝。
