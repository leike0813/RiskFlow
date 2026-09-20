## Verification Report: deliver-process-model-mechanism-and-evidence-governance

### 验收上下文

- OpenSpec schema：`riskflow-delivery`
- Finalizer implementation checkpoint：`679480653a106b3b993a52109e6bf9a1b7434b7f`
- Targeted Auditor 输入与当前 Git HEAD：`1eafc4f0895526dff5f6ba19027ca05bb188e8f4`
- 工作树状态：未提交；当前产物为上述 HEAD 加本报告列出的限定修复，未提交修复不会产生新的 Git HEAD。
- 审计证据：本文件与 `worker-report:msg_4d498fb8b310`；issueRefs 为 `C17-AUD-01:command-actor-not-checked-against-verified-actor`、`C17-AUD-02:failure-binding-committed-before-attempt-cas-replay-stale-version`。
- 已完整读取 `openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json` 返回的 proposal、delta spec、design、implementation-plan、tasks。

### Summary

| Dimension | Status |
| --- | --- |
| Completeness | 19/19 tasks；12/12 Requirements；32/32 Scenarios |
| Correctness | V-01～V-11 基线通过；两项 CRITICAL 已修复，受影响的 V-03、V-04、V-05、V-07～V-11 已复验通过 |
| Coherence | 发布/回滚事务、semantic-merge、D-09 失败恢复状态机与 D-11 actor/授权绑定均通过 |

### Correctness evidence

| 规格范围 | 实现证据 | 场景证据 |
| --- | --- | --- |
| 五类独立知识包、工序模型、机理、规范、案例与组合 Schema | `packages/core/src/identification-knowledge/schema.ts:111`、`packages/core/src/identification-knowledge/service.ts:648` | V-02、V-03 覆盖 strict 字段、五工序、六机理、关系、证据和三成员组合的接受/拒绝边界 |
| 稳定定义、验证、修订、发布 binding、精确识别基础与有界读取 | `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts:885`、`:1127`、`:1338` | V-03、V-04 覆盖发布/回滚原子性、双时间解析、成员失效、跨工程与精确读取 |
| 配置导入、Agent 编制、类型化增量与失败复核 | `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts:2480`、`apps/worker/src/identification-knowledge/composition.ts:166` | V-01、V-03、V-05 覆盖冻结 manifest、越界零读取、失败证据窄读、CAS 恢复与一次复核 |
| C19 assessment-basis 原样委派 | `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts:1199`、`apps/worker/src/identification-knowledge/composition.ts:308` | V-04、V-11 覆盖 success/error 逐字段透传、单次调用、identification 零调用和缺失依赖关闭失败 |
| 幂等、审计及事务失败恢复 | `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts:1477` | V-03 新增“验证已提交但 C16 首次提交失败”重放回归，并保留 release/binding/audit/receipt/Outbox 故障回滚证据 |

### Finalizer 修复

限定审计发现：`submit-revision` 的验证事务已经成功、随后 C16 首次提交失败时，重放会取得原验证结果，却继续使用本次新生成的 `validationId` 写 revision binding，导致外键失败且不能恢复。修复在共同提交路径按 `(project_id, idempotency_key)` 读取已持久化验证身份并绑定精确 `validation_id/version_id`；对应测试先在旧实现稳定失败，修复后通过，未改变 Schema、事务边界或公共契约。

限定审计的两项 CRITICAL 已逐项闭合：

1. `C17-AUD-01:command-actor-not-checked-against-verified-actor`：`#verifyAuthorization()` 现在同时校验请求前和 C06 复验后的 project、actor 与唯一 branch capability；所有 C17 public govern/resolve/read 路径传入预期 actor，候选、发布与 manifest 写入只使用复验后的上下文。回归分别覆盖调用方 authorization actor 不一致及 C06 `verify()` 返回 actor 不一致，均在目标读取前以 `AUTHORIZATION_DENIED` 关闭失败。
2. `C17-AUD-02:failure-binding-committed-before-attempt-cas-replay-stale-version`：`#settleOneFailure()` 在发现已有 `failure-review-only` binding、但 attempt 仍为 `prepared | task-started` 时，复用已有 CAS 路径幂等补齐 `failure-revision-bound`，再请求 review。故障窗口回归证明不重读 C08 证据、不新增第二个 revision/binding/review，并最终进入 `review-linked`。

### 限定审计

- **permission**：exact branch、project、actor、invocation、唯一 capability、空间/资料范围与 human/system 来源均通过；公共 C17 入口在任何目标读取或委派前校验调用身份，并使用 C06 复验上下文执行后续操作。
- **transaction**：核对 D-05、D-07、D-11 的 C16 publish/rollback 同事务 release-binding-audit-receipt-Outbox、故障回滚和幂等重放；独立复跑 V-03、V-04 均通过，未发现新增缺陷。
- **critical-state-machine**：C08 runner 复用、终态失败窄读、`failure-revision-bound → review-linked` 与 binding 已提交但 attempt CAS 未提交的崩溃窗口均通过。
- **semantic-merge**：implementation checkpoint 后未发生语义合并冲突，不触发。

### Targeted Auditor 独立证据

| 范围 | 实际命令 / 检查 | 结果 |
| --- | --- | --- |
| permission 前置与 C08 窄读 | V-01 原命令 | PASS，5 files / 84 tests |
| transaction 与 failure settlement | V-03 原命令 | PASS，2 files / 34 tests；现有用例未覆盖 binding 已提交而 attempt CAS 未提交的窗口 |
| C16 发布/回滚事务与 C07 授权 | V-04 原命令 | PASS，2 files / 25 tests |
| Worker exact branch、来源与 runner | V-05 原命令 | PASS，3 files / 26 tests |
| semantic merge | `git log --merges --oneline 6794806..1eafc4f` | 无输出；不触发 |

### CRITICAL 修复复验

| 缺陷 | 实现与回归证据 | 结果 |
| --- | --- | --- |
| `C17-AUD-01` / D-11 actor 未绑定 | `postgres-identification-knowledge-adapter.ts` 的共享请求前/复验后校验，以及 adapter test 的 request actor mismatch 与 verified actor mismatch 场景 | PASS；读/写/委派均在目标访问前拒绝不一致身份 |
| `C17-AUD-02` / D-09 binding/CAS 崩溃窗口 | `postgres-identification-knowledge-adapter.ts` 的已有 binding 恢复分支与共享 CAS，以及 adapter test 的故障状态构造 | PASS；不重读 C08 证据，单 revision、单 binding、单 review，最终 `review-linked` |

### 实际验证命令与结果

| ID | 实际命令 | 结果 |
| --- | --- | --- |
| V-01 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/agent-runtime/agent-runtime.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` | PASS，5 files / 84 tests |
| V-02 | `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts` | PASS，1 file / 32 tests |
| V-03 | `pnpm exec vitest run --reporter=verbose packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` | PASS，2 files / 34 tests；修复后重跑 |
| V-04 | `pnpm exec vitest run --reporter=verbose packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` | PASS，2 files / 25 tests |
| V-05 | `pnpm exec vitest run --reporter=verbose apps/worker/test/identification-knowledge/composition.test.ts apps/worker/test/identification-knowledge/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` | PASS，3 files / 26 tests |
| V-06 | `pnpm exec vitest run apps/api/test/http-shell.test.ts` | PASS，1 file / 14 tests |
| V-07 | `pnpm build && pnpm typecheck` | PASS；修复后重跑 |
| V-08 | implementation-plan §7.3 的完整 `eslint` 与 `prettier --check` 命令 | 首次 `prettier --check` 定位新增测试排版不匹配；仅格式化该测试后完整重跑 PASS，全部匹配 Prettier |
| V-09 | `pnpm deps:check && pnpm deps:policy` | 修复后重跑 PASS，270 modules / 746 dependencies，policy OK |
| V-10 | `openspec validate deliver-process-model-mechanism-and-evidence-governance --strict --no-interactive && openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json` | PASS；strict valid，全部 contextFiles 可读 |
| V-11 | `pnpm exec vitest run --reporter=verbose packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/test/identification-knowledge/composition.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` | PASS，3 files / 49 tests；修复后重跑 |

补充检查：`git diff --check` 通过；未执行未列出的全仓测试，因为 V-01～V-11 已覆盖批准范围且施工图要求最小必要验证。

### Issues by priority

#### CRITICAL

无。`C17-AUD-01` 与 `C17-AUD-02` 均已修复并通过回归。

#### WARNING

无。

#### SUGGESTION

无。

### 范围与剩余事项

- Finalizer 未修改 `packages/contracts/**`、C08/C15/C11 所有权文件、API/Web、根 workspace、锁文件、主 specs 或其它 changes；未新增迁移或依赖。
- C16 生命周期中已在批准工件记载的“当前发布停用/唯一性语义”风险不属于 C17，本次未扩大范围处理，也不阻塞已批准 C17 场景。
- 当前 Git HEAD 仍为 `1eafc4f0895526dff5f6ba19027ca05bb188e8f4`；修复后的未提交产物仍需协调端审阅并形成 Git 检查点，合并、main 门禁与归档仍由主编排流程执行。

### Final Assessment

`C17-AUD-01` 与 `C17-AUD-02` 已闭合，受影响检查全部通过；C17 产物可交协调端复核并进入后续检查点流程。
