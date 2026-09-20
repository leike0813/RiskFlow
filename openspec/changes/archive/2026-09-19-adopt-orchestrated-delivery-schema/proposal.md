## Why

现有 `riskflow-delivery` 只描述规划与实现前置工件，最终验收结论仅存在于 Agent 报告和编排信封中，无法随 change 一起归档。后续 change 需要一个与项目名解耦、明确区分规划、实现和验收责任的通用委派 schema，同时保留旧 schema 供历史 change 按元数据继续解析。

## What Changes

- 新增项目级 `orchestrated-delivery` schema，复用现有五个 apply 前置工件，并增加由验收 Agent 在最终实现检查点填写的 `verification` 工件。
- 将新 schema 设为后续 change 的默认值；`riskflow-delivery` 及既有 change 元数据保持不变。
- 更新 Finalizer 提示词和成功收口门禁：当前 schema 声明 `verification` 时，缺少该工件不得成功收口。
- 更新编排手册、操作手册与 Agent 规则，说明 OpenSpec 1.13.1 不支持 post-apply 依赖以及正确的工件创建时机。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/engineering-baseline`: 将后续大型 change 的默认 workflow 更新为通用委派 schema，并定义 post-apply 验收工件。
- `operations/orchestration-controlled-actions`: 将最终验收工件纳入 Finalizer/Targeted Auditor 的责任和成功收口门禁。

## Impact

- OpenSpec schema、项目配置及两项主规格。
- 项目编排规则、Finalizer/Auditor 任务提示与控制器定向测试。
- 不新增依赖、迁移、领域接口或运行时业务行为。
