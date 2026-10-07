# Implementation Plan

## 1. 实施基线与权威来源

- 基线：`HEAD`（含 C34 未提交工作树）；本 change 的文件面与 C34 完全不相交，实施前须确认基线无新增漂移。
- 直接依赖（已归档，只读引用）：C30 `domain/module-interfaces-events-workflows` 的「工作流生命周期以耐久业务事实和冻结身份收口」；C41 `domain/human-decision-and-feedback-command-wiring` 的「人工决定命令必须得到真实工作流绑定后才提交」；C30 design D-08 的运行版本断言。
- 本 change 权威工件：本 change 的两份 delta spec 与 `design.md` 的 D-01～D-05。
- 就绪判定：spec 已定义等待点状态版本的交出、冻结、核对与失败形态；design 已定死字段归属与拒绝策略；无新增依赖、迁移或公共枚举。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `moduleResultSchema` 等待变体 | 在既有等待变体上追加可选字段，不新开结果联合 | 不为等待点版本另造一个结果 kind 或错误码 |
| IP-01 | `packages/core/src/workflow/service.ts` 的运行结果与 `resume` 入口 | 复用既有游标 `runVersionId` 作为取值来源 | 不新增一次状态读取来取得该值 |
| IP-02 | `apps/worker/src/risk-flow/runtime.ts` 的 `startRunPort` 等待分支 | 在既有 `outcome` 上回传等待点版本 | 不改变等待门与 `terminalFailureOf` 的判定顺序 |
| IP-03 | `packages/core/src/response-lifecycle/schema.ts` 的 `VerifiedResponseWorkflowBindingV1Schema`、`packages/core/src/human-decision-feedback/schema.ts` 的 `HumanResponseDecisionV1Schema` | 各增一个可选字段，与既有引用字段同级 | 不把运行登记摘要改名或替换为状态版本 |
| IP-04 | `packages/core/src/human-decision-feedback/service.ts` 的 `#continueAdoption`、`#settledOrResume`、`#resumeForecastRun` | 采纳路径把等待结果的值写入绑定与决定；恢复只从绑定读 | 不在恢复点重新读取运行状态 |
| IP-05 | C30 精确绑定证明端口与 `readBindingProof` | 在既有证明核对里加归属校验 | 不新增绑定证明的错误码，按既有失败形态返回 |
| IP-06 | `demo/test/browser/assessment-warning-response.spec.ts` 的采纳→预测分段段 | 复用既有场景与 helper 断言恢复成立 | 不改写默认风险接受阈值或共享 fixture 来避开版本问题 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1 | 工作流生命周期…／等待结果交出可恢复的等待点状态版本 | `packages/contracts/src/ports/index.ts` 等待变体、`packages/core/src/workflow/schema.ts` | 等待结果增可选 `waitStateVersion` 标识字段，并在等待引用注释处写明它与运行引用同源 | 成功/失败变体、命令 Schema 与能力映射 |
| IP-02 | 2.1 | 工作流生命周期…／等待结果交出可恢复的等待点状态版本 | `apps/worker/src/risk-flow/runtime.ts` `startRunPort`、`packages/core/src/workflow/service.ts` 结果构造 | 等待分支回传游标 `runVersionId` 作为等待点版本；无法给出时留空而不编造 | 等待门、失败映射、重试与幂等身份 |
| IP-03 | 3.1 | 人工决定命令…／采纳绑定冻结等待点状态版本 | `packages/core/src/response-lifecycle/schema.ts`、`packages/core/src/human-decision-feedback/schema.ts` | 两份记录各增可选等待点状态版本字段 | 既有引用字段、决定摘要与互斥语义 |
| IP-04 | 3.2 | 人工决定命令…／采纳绑定冻结等待点状态版本、绑定缺少等待点状态版本时失败闭合 | `packages/core/src/human-decision-feedback/service.ts` `#continueAdoption`、`#settledOrResume`、`#resumeForecastRun` | 采纳时把等待结果的值同时写入绑定与终局决定；恢复以绑定中的值作为 `expectedStateVersion`，缺失即失败闭合 | 决定与运行的既有身份、恢复的授权与幂等身份 |
| IP-05 | 4.1 | 人工决定命令…／绑定缺少等待点状态版本时失败闭合 | C30 精确绑定证明实现与端口类型 | 核对冻结版本属于该绑定的同一运行，错配或缺失按既有失败形态返回 | 绑定证明的公开返回联合与既有读权限 |
| IP-06 | 5.1 | 以陈旧等待点版本恢复被拒绝 | `packages/adapters/test/workflow`、`packages/adapters/test/response-lifecycle`、`packages/adapters/test/human-decision-feedback`、`packages/core/test/workflow` | 覆盖：等待结果交出版本、绑定与决定冻结同值、缺失时失败闭合、版本陈旧仍拒绝、同键异载荷仍拒绝 | 既有断言的稳定可观察口径 |
| IP-07 | 6.1 | 等待决定后以原运行恢复 | `demo/test/browser/assessment-warning-response.spec.ts` | 采纳后预测分段恢复成立并继续 | 场景的精确引用断言与失败 trace 保留 |

## 4. 验证命令

| IP-ID | 命令 |
| --- | --- |
| IP-01～IP-05 | `pnpm exec vitest run packages/core/test/workflow packages/adapters/test/workflow` |
| IP-06 | `pnpm exec vitest run packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback` |
| IP-07 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts -g "偏差驱动出校准建议" --retries=0` |
| 全部 | `NODE_OPTIONS=--max-old-space-size=12288 npx tsc -b packages/core packages/adapters apps/worker`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm openspec:validate`、`openspec validate fix-forecast-response-resume-run-version-binding --strict --no-interactive` |

## 5. 事务、权限、审计与失败形态

- 事务：等待点版本取自同一次运行推进的游标，不新增事务边界；绑定与决定的写入沿用各自既有事务。
- 权限：等待点版本只是既有运行读取事实的一个投影，不新增能力或分支；绑定证明的核对沿用既有受权读取。
- 幂等：同一命令身份重试取得同一等待点版本；恢复的命令身份与业务幂等键不变。
- 审计：不新增审计项；恢复与决定仍写既有审计。
- 迁移与依赖：无。
- 失败形态：等待点版本缺失或错配 → 绑定证明/恢复以既有稳定失败收口，不改按最新版本继续。

## 6. 文件清单

| IP-ID | 类型 | 文件 |
| --- | --- | --- |
| IP-01 | M | `packages/contracts/src/ports/index.ts`、`packages/core/src/workflow/schema.ts` |
| IP-02 | M | `apps/worker/src/risk-flow/runtime.ts`、`packages/core/src/workflow/service.ts` |
| IP-03 | M | `packages/core/src/response-lifecycle/schema.ts`、`packages/core/src/human-decision-feedback/schema.ts` |
| IP-04 | M | `packages/core/src/human-decision-feedback/service.ts` |
| IP-05 | M | C30 精确绑定证明的实现与其端口类型（随 IP-06 fixture 一并定位到具体文件后固化） |
| IP-06 | M | `packages/core/test/workflow/service.test.ts`、`packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`、`packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts` 及其 fixture |
| IP-07 | M | `demo/test/browser/assessment-warning-response.spec.ts` |

升级条件：需要新增公共错误码或能力分支、需要改变 D-08 的运行版本断言或既有幂等协议、需要新增表/迁移/依赖、绑定证明端口无法在不扩展联合的前提下表达失败、或基线漂移使上述符号失效。

## 7. 移交

实施完成后移交 Finalizer 填 `verification.md`；本 change 的实现阶段不提前生成 verification，也不勾选 C34 的 4.1/4.2/4.4——那三项由 C34 在本 change 归档后自行完成。
