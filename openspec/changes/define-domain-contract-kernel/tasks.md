## 1. 依赖检查点（主 Agent）

- [x] 1.1 在 `packages/contracts/package.json` 精确登记 `zod@4.5.4`，在 `config/dependency-policy.json` 登记 proposal/design 指定的用途、MIT 许可证、官方来源、离线方式和退出条件，更新 `pnpm-lock.yaml`；执行 `pnpm install --frozen-lockfile && pnpm deps:policy` 必须通过。除这三个文件外不得修改根工具链或依赖检查实现。

## 2. 契约夹具

- [ ] 2.1 按 `specs/domain/contract-kernel/spec.md` 和 `design.md` 在 `packages/contracts/test/contract-kernel.test.ts` 建立单一参数化契约测试，覆盖 11 组固定词汇、版本/双时间/证据、六项模型输出、七项标准化记录、三维适用性、评分规则、风险输入 XOR 及预警—处置—偏差闭环；测试只断言稳定成功/失败与关键路径，不断言完整 Zod 文案、issue 顺序或字段顺序。实现完成后 `pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts` 必须通过。

## 3. 领域词汇与通用契约

- [ ] 3.1 在 `packages/contracts/src/vocabulary/index.ts` 实现 design 表列的 11 组只读中文值、Zod 枚举 Schema 与 `z.infer` 派生类型；不得提供英文别名、自动归一化或第二套手写 union，完成后词汇参数化测试必须通过。
- [ ] 3.2 在 `packages/contracts/src/common/index.ts` 实现标识、ISO 时间、精确版本引用、有效时间、记录时间、版本化记录信息、证据定位/引用、审计、审核状态、校验结果、命令信封与错误信封；倒置时间、空资料段标识和缺少命令身份必须被拒绝，完成后对应契约测试必须通过。

## 4. 识别与评估记录契约

- [ ] 4.1 在 `packages/contracts/src/records/index.ts` 实现 `RiskElementRelationSchema`、`ModelOutputResultSchema`、`StandardizedRiskRecordSchema`、综合置信度与独立记录信封；标准化风险记录必须 strict 且恰好七项内容字段，置信度限制为 `[0,1]`，完成后 RI-S57/RI-S58/RI-S61 相关正反例必须通过。
- [ ] 4.2 在同一文件实现适用性元数据/条件、标量值、阈值、分级区间、结构化评分规则、指标结果、触发指标与 `RiskAssessmentRecordSchema`；风险输入用两个 strict 分支实现 `riskRecordId` / `externalRiskEventId` 二选一且仅一个，完成后 RA-S1～RA-S5 正反例必须通过。
- [ ] 4.3 在同一文件实现预警、措施项、目标指标、处置建议、风险状态、偏差记录与校准建议契约；处置建议必须含三项 `ValidationResultSchema`，偏差记录不得出现自动发布/覆盖配置字段，完成后 RA-S6/RA-S7 闭环测试必须通过。

## 5. 公开 interface

- [ ] 5.1 修改 `packages/contracts/src/index.ts` 只重导出 vocabulary/common/records，并在 `packages/contracts/package.json` 增加 `./vocabulary`、`./common`、`./records` 的 types/import 子路径；不得新增 package scripts、跨包依赖或导出内部文件，执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 必须通过。

## 6. 最小验证与 OpenSpec 复核

- [ ] 6.1 依次执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`、`pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts`、`pnpm exec eslint packages/contracts/src packages/contracts/test`、`pnpm exec prettier --check packages/contracts/src packages/contracts/test packages/contracts/package.json config/dependency-policy.json`、`pnpm deps:check` 与 `pnpm deps:policy`；全部通过，且 `git diff --check` 无空白错误。
- [ ] 6.2 执行 `openspec validate define-domain-contract-kernel --strict --no-interactive`，再按 `openspec-verify-change` 核对所有 requirement、RI/RA 追踪、文件所有权与 Non-goals；把验证证据写入本 change，未经主 Agent 审阅批准不得归档或修改其它主 specs。
