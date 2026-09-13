## Why

共享 `RiskInputReferenceSchema` 的 strict union 会在运行时拒绝同时携带 `riskRecordId` 与 `externalRiskEventId` 的对象，但其推导 TypeScript union 仍允许这种结构性赋值，未满足主规格和项目规则要求的类型层 XOR。该 drift 会把错误延迟到运行时，并影响后续评估实现对共享契约的可信使用。

## What Changes

- **BREAKING**：为 `RiskInputReferenceSchema` 的两个 strict 分支增加既有风格的 `kind` 判别字段，并改用 Zod discriminated union，使运行时 Schema 与推导类型同时只接受一种风险输入来源。
- 让 `RiskAssessmentRecordSchema` 复用同一组带判别字段的分支，保持风险输入与评估记录的 XOR 语义一致。
- 更新现有契约测试中的合法对象，增加最小类型层回归证据，并继续验证缺失、双重或未知输入被拒绝。
- 保持 C02 的 `RiskInputVersionRefV1Schema`、命令/快照契约及其调用方不变；不增加兼容别名、迁移、依赖或其它契约演进。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/contract-kernel`：明确风险输入引用及风险评估记录必须使用 `kind: "standardized-risk-record" | "external-risk-event"` 在运行时与 TypeScript 类型层共同强制 XOR。

## Impact

- **所有权与范围**：仅修改 C01 所有的 `packages/contracts/src/records/index.ts`、现有 `packages/contracts/test/contract-kernel.test.ts` 及本 change 工件；不修改 ports、workflows、events、core、adapters 或 apps。
- **调用方**：基线 `f7b568907026864735dee8599f8aae1a1cf34794` 中，`packages/contracts` 外没有 `RiskInputReference` 或 `RiskInputReferenceSchema` 的直接引用。`packages/contracts/src/ports/index.ts` 只重导出该契约；C25 命令与快照路径使用已判别的 `RiskInputVersionRefV1Schema`，无需适配；未发现风险输入进入 JSON-LD 转换。
- **公共行为**：这是有意的窄 breaking change；旧的 `{ riskRecordId }`、`{ externalRiskEventId }` 及对应无 `kind` 的风险评估记录将不再通过解析或类型检查，现有合法对象需机械补充 `kind`。
- **依赖治理**：无新增、升级或删除依赖，继续复用已锁定的 Zod、TypeScript、Vitest、ESLint 与 Prettier。
- **追踪**：修正 RA-S1、RA-S5 的共享风险输入边界，不改变评估计算、版本、证据、审计或 C25 生产所有权。
