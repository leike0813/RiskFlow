## Why

RiskFlow 目前只有独立的汇报 Demo 和空白 OpenSpec 配置，缺少可供后续 38 个能力 change 共同依赖的生产工程、单一锁文件和边界检查。先建立最小但完整的工程基线，才能让后续契约、领域、适配器与界面 change 在同一套可重放工具链上独立交付。

## What Changes

- 填充 `openspec/config.yaml`，把已经确认的技术栈、四层架构、双专利追踪、工件厚度与 apply/archive 约束提供给后续 change。
- 建立 Node.js 24 + pnpm 的 TypeScript monorepo，生产目录固定为 `apps/web`、`apps/api`、`apps/worker` 和 `packages/contracts`、`packages/core`、`packages/adapters`。
- 建立三个应用与三个共享包的最小可构建入口、TypeScript project references、公开 `exports` 和单向依赖边界；不预建业务模块或未来 adapter。
- 建立单一精确 `pnpm-lock.yaml`、冻结安装、构建、类型检查、lint、格式检查、单元测试和 dependency-cruiser 检查入口。
- 建立 CI 与依赖治理基线，固定直接依赖版本，生成 CycloneDX SBOM，并记录许可证、离线来源与受控升级条件。
- 将 `demo/` 明确排除在生产 workspace 外；它继续作为汇报参考保留，后续由界面 change 按已确认范围迁移。

### Non-goals

- 不定义 C01/C02 所有的领域枚举、业务 Schema、模块 interface、事件或 LangGraph 状态。
- 不实现 PostgreSQL、Qdrant、解析器、OCR、模型、可观测性或部署 adapter；只为当前最小入口实际使用的依赖建立基线。
- 不迁移、删除或改写 `demo/`，不启动开发服务器，也不创建占位业务页面、Mock API 或空 adapter。

### Dependencies and ownership

- 直接依赖：无；本 change 是 G0 的第一个串行 change。
- 下游消费者：C01 `define-domain-contract-kernel` 与 C02 `define-module-interfaces-events-and-workflows`，随后是全部生产能力 changes。
- 事实所有者：根 workspace、工具链、锁文件、CI、包边界与依赖治理规则。
- 不拥有：领域契约、业务事实、数据库模型、工作流语义、页面功能和部署拓扑。
- RI/RA 追踪：本 change 不实现 RI-S1～RI-S6 或 RA-S1～RA-S7；它建立后续实现保持追踪、版本和审计要求所需的工程约束。

## Capabilities

### New Capabilities

- `platform/engineering-baseline`: 规定生产 workspace 的目录、工具链、冻结安装、构建验证、依赖边界和离线依赖治理行为。

### Modified Capabilities

无。

## Impact

- 新增根工程配置、单一 pnpm 锁文件、三应用三共享包的最小入口、边界检查和 CI。
- 修改 `openspec/config.yaml`，使后续工件自动获得项目技术栈与领域约束。
- 新增并精确锁定 C00 实际使用的开发与运行依赖；每项在 design 中记录用途、许可证、离线来源、退出条件和后续归属。
- 保留现有 `demo/` 及用户未提交改动，不把 Demo 的 npm/React 18 基线并入生产 workspace。
