## Why

C22 将 RI-S57 专用模型合法返回的零候选与解析、预算等技术失败混为一类；C24 因而无法把“本工作项没有风险候选”保存为可重放的正式终态，运行汇总只能显示失败或缺少结果。C39 经 `approval://riskflow/C39/scope-2026-09-23-zero-result-semantics-and-consumer` 批准，有意将 C22 已归档的“空候选输出为结构化失败”改为合法零结果成功终态，并为 C36 提供运行级覆盖证据；空候选既不能塞入要求非空的候选集，也不能靠伪造风险记录表达。

## What Changes

- **BREAKING（新增结果分支）**：合法、可解析且处于冻结预算内的 `candidates: []` 形成独立的 `zero-result` 终态；非空输出继续走既有候选、校验、合并与验收路线。
- 为零结果保存同工程、同输入、同工作项的不可变事实、原始响应引用、模型/提示/策略版本、资源消耗、授权、审计与幂等身份；重复命令返回同一事实，同键异载荷冲突。
- C24 将该工作项计为已终结的零结果，继续处理其它工作项，在 I9 中逐项列明零结果引用；零结果不得生成虚假候选集、合并组、标准化风险记录或评估事件。
- 解析失败、契约外字段、预算越界、权限失效、来源或版本不符继续返回类型化失败，不因“候选为零”而自动放行或改为人工复核。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identification/risk-candidate-validation-merge-and-acceptance`：修改 RI-S57 空输出边界并新增正式零结果事实、重放与失败场景。
- `identification/graph`：定义 I4 零结果路线、逐项终态与 I9 汇总证据。
- `domain/module-interfaces-events-workflows`：为既有识别分析结果及阶段 DTO 增加精确零结果引用，保持闭合联合。

## Impact

受影响的已归档 change 与实现文件逐项为：C02 `packages/contracts/src/ports/index.ts`、`packages/contracts/src/workflows/index.ts`；C22 `packages/core/src/identification/candidate-finalization/{schema,ports,service}.ts`、`apps/worker/src/identification/candidate-finalization/runtime.ts`、`packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts` 及其新增增量迁移；C24 `apps/worker/src/identification/graph/{graph,runtime,composition}.ts`、`packages/core/src/identification/graph/{schema,service}.ts` 及运行结果回读接缝。对应主规格仅通过本 change 的 delta 修订，不改归档快照。需一份增量 PostgreSQL 迁移；不新增第三方依赖、权限能力、风险记录字段或领域事件，也不改变非空候选、评估、预警及处置逻辑。研究资料仅参照 `references/风险识别与评估规划事实源摘要.md`；实现事实以当前代码和主规格为准。
