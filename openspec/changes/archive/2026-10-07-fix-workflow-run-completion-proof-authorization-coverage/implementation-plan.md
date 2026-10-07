# Implementation Plan

## 1. 实施基线与权威来源

- 基线：`HEAD`（含 C34 未提交工作树与已实施的 `fix-forecast-response-resume-run-version-binding`）。本 change 的文件面与 C34 的推荐/预警/处置模块不相交。
- 直接依赖（已归档，只读引用）：C30 `domain/module-interfaces-events-workflows` 的运行只读证明；C41 `domain/human-decision-and-feedback-command-wiring` 的反馈命令要求；`authorizationScopeDigest` 的既有语义。
- 本 change 权威工件：本 change 的两份 delta spec 与 `design.md` 的 D-01～D-05。
- 就绪判定：spec 已定义覆盖判定方向、逐项包含口径、失败形态与不受影响的核对项；design 已定死写入/读取职责分离与风险边界。
- **前置**：本 change 触及 C34 §7 的「授权需扩大」升级条件，用户裁决通过后方可进入实现。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/core/src/retrieval/service.ts` 的 `authorizationScopeDigest` | 保留写入摘要，删除只比较空间的重复 helper，复用 C04 既有覆盖校验 | 不改摘要算法，不另造第二套范围规范化 |
| IP-02 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts` 的 `#latestRunStateWith` 与 `verifyWorkflowRunCompletion` | 状态及结果通过 C04 公开读取校验各自 manifest 的完整授权快照，再核对正文 | 不读 C04 私表，不保留摘要等值捷径 |
| IP-03 | 运行状态与结果工件的 C04 manifest | 复用已登记的空间、来源授权及策略引用作为被覆盖集合 | 不从摘要反推范围，不新增列 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1 | 工作流生命周期…／按收窄上下文证明更宽范围启动的运行 | `packages/core/src/retrieval/service.ts` | 删除重复空间判定，完整覆盖校验由 C04 负责 | `authorizationScopeDigest` 算法与写入侧用途 |
| IP-02 | 2.1 | 工作流生命周期…／按收窄上下文证明更宽范围启动的运行、范围不足时仍然拒绝 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts` `#latestRunStateWith` 与 `verifyWorkflowRunCompletion` | 去除摘要等值准入，分别通过 C04 读取精确状态与结果工件；空间、来源及策略不足返回证明未成立，读取后核对正文关联 | 状态可读性、版本一致性、`run-result` 正文对账与失败同型语义 |
| IP-03 | 3.1 | 工作流生命周期…／写入侧授权摘要仍被审计保留 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts` 写入路径 | 不改写入；确认登记行仍保存摘要 | 写入侧任何字段与审计 |
| IP-04 | 4.1 | 以按任务收窄的读取上下文确认实际评估 | `packages/core/src/human-decision-feedback/service.ts` | 不改签发范围；确认反馈段读取上下文仍按单空间收窄 | C41 授权签发语义 |
| IP-05 | 5.1 | 范围不足时仍然拒绝、写入侧授权摘要仍被审计保留 | `packages/adapters/test/workflow`、`packages/adapters/test/human-decision-feedback` | 覆盖成功、范围不足拒绝、跨工程拒绝、摘要写入保留 | 既有断言的稳定可观察口径 |

## 4. 验证命令

| IP-ID | 命令 |
| --- | --- |
| IP-01～IP-04 | `pnpm exec vitest run packages/adapters/test/workflow packages/adapters/test/human-decision-feedback` |
| IP-05 | 同上 + `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts -g "偏差驱动出校准建议" --retries=0` |
| 全部 | `NODE_OPTIONS=--max-old-space-size=12288 npx tsc -b packages/core packages/adapters apps/worker`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm openspec:validate`、`openspec validate fix-workflow-run-completion-proof-authorization-coverage --strict --no-interactive` |

## 5. 事务、权限、审计与失败形态

- 事务：不新增事务边界；读取路径上的判定只是准入。
- 权限：这是本 change 唯一实质改动，见 D-01/D-05 与 proposal 的授权边界；放宽方向仅限同工程内的范围覆盖。
- 审计：写入侧摘要保留，追溯不受影响。
- 幂等：不变。
- 失败形态：覆盖不足与事实缺失同型，不枚举目标。

## 6. 文件清单

| IP-ID | 类型 | 文件 |
| --- | --- | --- |
| IP-01 | M | `packages/core/src/retrieval/service.ts` |
| IP-02/IP-03 | M | `packages/adapters/src/workflow/postgres-workflow-adapter.ts` |
| IP-04 | M | `packages/core/src/human-decision-feedback/service.ts`（仅在需要收窄/放宽读取范围时；默认不改） |
| IP-05 | M | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`、`packages/adapters/test/human-decision-feedback/fixture.ts`、`packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts` |

升级条件：覆盖判定所需的被覆盖范围无法从已登记事实可靠还原、需要新增公共枚举/错误码、需要新增表/列/迁移/依赖、需要跨工程读取、或需要放宽调用方自身签发范围。

## 7. 移交

实施完成后移交 Finalizer 填 `verification.md`；本 change 的实现阶段不提前生成 verification，也不勾选 C34 的 4.1/4.2/4.4。
