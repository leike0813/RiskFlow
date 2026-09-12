## Why

当前大型 change 由 Sol high 规划、较弱模型实现，但默认四类 OpenSpec 工件没有把已批准设计闭合映射到当前代码基线，任务完成也没有绑定逐项证据。近期 C12、C14 首轮实现均在 tasks 全部勾选和自动门禁通过后出现多项 CRITICAL，说明规划交接需要正式的代码施工图和证据门。

## What Changes

- 新增项目级 `riskflow-delivery` OpenSpec workflow，在 proposal、specs、design 与 tasks 之间加入 `implementation-plan.md`。
- 将实施方案设为 apply 的直接必需工件，使其自动进入 `contextFiles`，并要求 tasks 逐项引用实施切片。
- 固定实施方案的基线、代码符号映射、调用与副作用顺序、持久化落实、验收证据和升级条件。
- 在调度 handbook 中增加自定义 schema 的 CLI 命令矩阵与常见误用诊断，明确创建时选 schema、后续按 change 元数据解析。
- 更新 OpenSpec 工程基线规格、项目规则、路线事实源、项目级 Agent 规则与调度 handbook，为规划、实现和验证任务提供闭合完成标准。
- 不修改生产代码、产品规格、依赖、状态聚合器或 Git/Orca 状态。

## Capabilities

### New Capabilities

无。本 change 不新增产品能力。

### Modified Capabilities

- `platform/engineering-baseline`：后续大型 change 改用 `riskflow-delivery` 五工件 workflow，apply 必须直接加载并校验 implementation plan，tasks 必须按 IP-ID 和证据执行。

## Impact

- 新增 `openspec/schemas/riskflow-delivery/**`。
- 修改 `openspec/specs/platform/engineering-baseline/spec.md`、`openspec/config.yaml`、`AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` 与其指定的 39-change 路线事实源。
- 后续大型 change 默认使用五工件 workflow；小型机械或纯文档 change 可显式使用内置 `spec-driven`。
