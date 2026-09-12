## Why

C02 已在 `EngineeringDataPortV1.read` 中声明 `source-segments` 与 `evidence-access`，但 C11 PostgreSQL adapter 仍把两者返回为 `UNSUPPORTED_CONTRACT`。这使 C17 及后续检索、识别流程无法通过既有工程数据公共端口取得受权资料段定位和证据引用。

## What Changes

- 在既有 C11 adapter 内实现 `source-segments` 与 `evidence-access` 两个公共读取分支，不改变 C02 方法、分支、能力或成功形状。
- 两个分支在目标存在性或结果读取前按精确分支、工程、空间和资料引用调用 C06 `verify`；缺失、跨工程、越权和目标不存在统一返回不可枚举的授权拒绝。
- 返回资料段定位、来源版本及继承的资料权限引用；证据读取只返回获准定位和既有证据引用，不返回资料正文，也不虚构当前 C11 不拥有的脱敏摘要事实。正文仍由 C04 受权工件读取并审计。
- 新增 C11 strict 查询结果与 resolve Schema，并用 `000024_engineering_data_read_query_results.ts` 创建 C11 自有只追加查询结果表；结果只保存精确查询引用，不复制资料段或其它模块事实。
- 沿用 `monitoring-snapshot` 的 `queryResultRef`、持久化、resolve、C03 幂等事务和只追加审计模式，不引入新事务模型、事件、依赖或跨模块存储访问。
- 不实现 C17/Agent，不修改 C12～C15、`packages/contracts`、apps、既有 migration、根 workspace、锁文件、依赖政策、主 specs 正文或其它 change。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/engineering-context-source-registry`：明确既有 `source-segments` 与 `evidence-access` 分支的精确授权、不可枚举、脱敏边界、查询结果引用、持久化与 resolve 行为。

## Impact

- **生产代码**：`packages/core/src/engineering-data/context-source/schema.ts`、`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`。
- **持久化**：新增 `packages/adapters/src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.ts`；由既有 migration provider 自动发现，不修改既有 migration 或 runner。
- **测试**：扩展 C11 core Schema 测试与现有真实 PostgreSQL adapter 测试；复用现有 C11 fixture，只有新增测试确需共用 helper 时才在其所有权内做最小调整。
- **接口与依赖**：`EngineeringDataPortV1`、C02 分支集合和 transport 不变；不新增、升级或删除依赖，不修改 manifest 或 lockfile。
- **追踪**：闭合 RI-S13 资料段定位、RI-S14 资料权限与审计边界，为 C17 后续知识编制和识别证据读取提供既有公共端口能力，但不实现其业务流程。
