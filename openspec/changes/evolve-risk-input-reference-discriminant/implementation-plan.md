# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`f7b568907026864735dee8599f8aae1a1cf34794`。
- 权威输入：主规格 `openspec/specs/domain/contract-kernel/spec.md`、本 change 的 delta spec、proposal 与 design D-01～D-05、项目 `AGENTS.md` §4.2。
- 代码事实：目标定义只在 `packages/contracts/src/records/index.ts`；全仓直接调用只含 `packages/contracts/src/ports/index.ts` 的无逻辑重导出与 `packages/contracts/test/contract-kernel.test.ts` 的解析测试，contracts 外为零。
- 已核实可运行命令：根 `package.json` 提供 TypeScript、Vitest、ESLint 与 Prettier；OpenSpec CLI 已确认本 change 使用 `riskflow-delivery`。
- 实施前运行 `git status --short`；若出现本 change 工件之外的未提交改动，停止并升级，不覆盖用户改动。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/contracts/src/ports/index.ts`：`RiskInputVersionRefV1Schema`、`StandardizedRiskRecordRefV1Schema`、`ExternalRiskEventRefV1Schema` | 复用其 `kind` 字段与 `standardized-risk-record` / `external-risk-event` literal；不修改 ports | 不另建判别词汇、版本化引用或兼容映射 |
| IP-01 | `packages/contracts/src/records/index.ts`：`IdentifierSchema`、两个输入分支、`RiskAssessmentRecordBaseShape` | 在原 SSOT 内收紧两个分支；评估记录继续扩展同一分支与原公共 shape | 不复制标识校验、评估字段或手写公共 TypeScript union |
| IP-02 | `packages/contracts/test/contract-kernel.test.ts`：“以可辨识联合类型强制风险输入 XOR”、`assessmentBase` | 扩展唯一现有风险输入测试与夹具 | 不新增重复测试文件，不断言错误文案或 issue 顺序 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 收紧共享风险输入及评估记录 | `风险评估记录只引用一个风险事件来源`；“接受识别结果作为评估输入”“接受外部风险事件作为评估输入”“拒绝含糊的风险输入”“类型层拒绝同时携带两个标识”“历史评估保持可重放” | **修改** `packages/contracts/src/records/index.ts`：Zod import、`RiskRecordInputSchema`、`ExternalRiskEventInputSchema`、新增内部 `rejectPresentOppositeRiskInputField`、`RiskInputReferenceSchema`、`RiskAssessmentRecordSchema` | 按 D-01/D-02 增加 `kind` 与对侧 `z.never().optional()`，两个顶层 Schema 改为 `z.discriminatedUnion("kind", ...)` 并复用 own-property 精炼；`RiskInputReference`/`RiskAssessmentRecord` 继续由 `z.infer` 产生 | 其它 records Schema、字段、导出名与路径；ports/workflows/events；版本、证据、审计；依赖 |
| IP-02 | 机械适配夹具并建立回归证据 | 同 Requirement 的全部五个 Scenario | **修改** `packages/contracts/test/contract-kernel.test.ts`：imports、风险输入 XOR test、四个合法输入对象及负例 | 按 D-04 为合法引用/记录补固定 `kind`；用表格覆盖缺失/未知/错配/双重/空/额外字段；增加合法类型收窄与预先赋值双标识对象的 `@ts-expect-error` | 其它测试区块、完整错误文案断言、C25/JSON-LD 夹具 |
| IP-03 | 最小验证与范围门 | 全部 Requirement/Scenario；D-01～D-05 | 不新增代码文件；验证 IP-01/IP-02 与本 change 工件 | 依次运行 §6 命令，确认声明、运行时、格式、lint、OpenSpec 与文件范围 | 不执行全量服务、依赖安装、提交或归档 |

## 4. 调用与副作用顺序

1. `RiskInputReferenceSchema` 或 `RiskAssessmentRecordSchema` 读取 `kind` 并只选择对应分支。
2. 分支校验要求本分支标识为非空 `IdentifierSchema`，对侧标识不得携带值，strict object 拒绝其它字段。
3. `rejectPresentOppositeRiskInputField` 再以 `Object.hasOwn` 拒绝显式携带但值为 `undefined` 的对侧字段，保持原 strict 解析边界。
4. 成功时返回带同一 `kind` 的推导类型；失败时只返回既有 Zod 失败，不引入领域错误、重试或回退。

该路径无权限检查、状态转换、I/O、事务、持久化、事件、审计写入、幂等或重试副作用。`RiskAssessmentRecordSchema` 的版本、证据与审计字段仍由原 shape 原样校验。

## 5. Schema、状态与持久化落实

- Schema SSOT：仅 `packages/contracts/src/records/index.ts`；`ports` 与根入口继续重导出，不修改。
- 静态类型：`RiskInputReference` 和 `RiskAssessmentRecord` 继续以 `z.infer` 从最终 Schema 产生；禁止新增手写 XOR 类型、宽松 alias 或 shim。
- 状态/权限/错误/事务/幂等/审计/可观测性：无新增或变化。
- 持久化与迁移：基线无该目标记录的生产存储或 JSON-LD 投影；新增/修改/删除 migration 均为零。
- 依赖：零变更；不得修改 package manifest、lockfile 或 dependency policy。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| 接受识别结果作为评估输入 | IP-01、IP-02 | `packages/contracts/test/contract-kernel.test.ts` | `kind: "standardized-risk-record"` + 仅 `riskRecordId`；同 kind 的完整 `assessmentBase` | 引用与记录均解析成功；TypeScript 可按 `kind` 读取 `riskRecordId` | `pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts`；类型命令见下 |
| 接受外部风险事件作为评估输入 | IP-01、IP-02 | 同上 | `kind: "external-risk-event"` + 仅 `externalRiskEventId`；同 kind 的完整 `assessmentBase` | 引用与记录均解析成功；TypeScript 可按 `kind` 读取 `externalRiskEventId` | 同上 |
| 拒绝含糊的风险输入 | IP-01、IP-02 | 同上 | 缺失/未知 kind、kind 与标识错配、双标识、无标识、显式 undefined 对侧字段、额外字段 | 两个 Schema 对各代表性边界 `safeParse(...).success === false` | `pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts` |
| 类型层拒绝同时携带两个标识 | IP-01、IP-02 | 同上 | 先保存带 literal kind 和两个有效标识的变量，再赋给 `RiskInputReference` | `@ts-expect-error` 被消费；若类型再次放宽，TypeScript 以 unused directive 失败 | `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --verbatimModuleSyntax --noUncheckedIndexedAccess --exactOptionalPropertyTypes packages/contracts/test/contract-kernel.test.ts` |
| 历史评估保持可重放 | IP-01、IP-02 | 同上 | 原 `assessmentBase` 的精确规则/权重/矩阵版本及两种 kind | 添加 kind 后既有版本、快照、证据与审计仍原样解析 | `pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts` |
| Schema/声明与包边界 | IP-01、IP-03 | 生产源码 | contracts project references | 声明构建成功且无反向依赖 | `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`；`pnpm deps:check` |
| 风格与工件有效性 | IP-01～IP-03 | 两个代码文件与本 change 五工件 | 规划、实现完成 | ESLint、Prettier、OpenSpec strict、空白与范围检查通过 | `pnpm exec eslint packages/contracts/src/records/index.ts packages/contracts/test/contract-kernel.test.ts`；`pnpm exec prettier --check packages/contracts/src/records/index.ts packages/contracts/test/contract-kernel.test.ts openspec/changes/evolve-risk-input-reference-discriminant`；`openspec validate evolve-risk-input-reference-discriminant --strict --no-interactive`；`git diff --check` |

## 7. 文件清单与升级条件

- 新增生产/测试文件：无。
- 修改：`packages/contracts/src/records/index.ts`、`packages/contracts/test/contract-kernel.test.ts`。
- 删除：无。
- 本 change 规划工件：`proposal.md`、`specs/domain/contract-kernel/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`。
- 保护范围：`packages/contracts/src/{common,vocabulary,ports,events,workflows}/**`、`packages/core/**`、`packages/adapters/**`、`apps/**`、所有 migration、根配置、manifest、lockfile、依赖政策、主 specs、归档 change 及其它 change。
- 必须停止并升级：base 或目标符号漂移；发现 contracts 外真实调用方/持久化/JSON-LD 映射；需要不同 discriminator/literal、嵌套输入、兼容入口、数据迁移、新依赖或计划外文件；直接 TypeScript 类型证据不能拒绝预先赋值的双标识对象；任一指定命令不存在或在本 change 范围内无法通过。
