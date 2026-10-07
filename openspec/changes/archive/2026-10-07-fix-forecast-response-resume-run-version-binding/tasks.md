## 1. 公共契约

- [x] 1.1 实施 IP-01：在模块化结果等待变体上增可选 `waitStateVersion`，并写明它与等待引用、运行引用同源；不改成功/失败变体、能力映射与命令 Schema。验证：`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/workflow`、`pnpm typecheck`。

## 2. 运行侧交出

- [x] 2.1 实施 IP-02：`startRunPort` 等待分支回传游标 `runVersionId` 作为等待点版本，无法给出时留空而不编造；等待门、失败映射、重试与幂等身份不变。验证：`pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts`。

## 3. 冻结与恢复

- [x] 3.1 实施 IP-03：`VerifiedResponseWorkflowBindingV1` 与 `HumanResponseDecisionV1` 各增可选等待点状态版本字段，既有引用字段与决定摘要不变。验证：`pnpm exec vitest run packages/core/test/response-lifecycle packages/core/test/human-decision-feedback`。
- [x] 3.2 实施 IP-04：采纳路径把等待结果的值同时写入绑定与终局决定；恢复以绑定中的值作为 `expectedStateVersion`，缺失即失败闭合，不在恢复点重新读状态。验证：`pnpm exec vitest run packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback`。

## 4. 绑定证明核对

- [x] 4.1 实施 IP-05：精确绑定证明核对冻结的等待点状态版本属于该绑定的同一运行，错配或缺失按既有失败形态返回；公开返回联合与读权限不变。验证：`pnpm exec vitest run packages/adapters/test/workflow packages/adapters/test/response-lifecycle`。

## 5. 行为回归

- [x] 5.1 实施 IP-06：覆盖等待结果交出版本、绑定与决定冻结同值、缺失失败闭合、版本陈旧仍拒绝、同键异载荷仍拒绝。验证：`pnpm exec vitest run packages/core/test/workflow packages/adapters/test/workflow packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback`（131 passed / 0 failed，含 `apps/worker/test/risk-flow` 陈旧版本拒绝与 `packages/contracts/test` 契约用例）。

## 6. 真实闭环

- [x] 6.1 实施 IP-07：`demo/test/browser/assessment-warning-response.spec.ts` 的采纳→预测分段恢复成立并继续执行，不改写默认风险接受阈值与共享 fixture。验证：`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts -g "偏差驱动出校准建议" --retries=0`。

  进展：采纳（C41 终局采纳 + 真实预测运行绑定）、预测运行（真实效果预测执行，输出 `predictedValue=22mm`、`riskLevel=demo-level-3`）与执行登记三段已在真实浏览器链路中成立。剩余阻塞在反馈段的 C30 运行完成证明：闭环场景走 `record-feedback` 时，C41 以自身签发的读取上下文调 `verifyWorkflowRunCompletion`，C30 按 `authorizationScopeDigest` 过滤运行行，读取上下文的范围摘要与当初 operator 启动该评估运行时写入的行摘要不一致，读取不到运行状态行，按 `completion-not-established` 关闭失败。该缺口涉及 C30 证明端口的授权范围语义（是否应比对完整授权范围摘要），属跨模块设计决定，不在本 change 授权范围内自行收紧或放宽；实现前需先在对应 change 定死口径。

  该阻塞已由 `fix-workflow-run-completion-proof-authorization-coverage` 按用户裁决的覆盖判定口径解决，闭环场景随之跑通：采纳→预测运行→执行登记→反馈登记→偏差事实→校准建议全链成立，零重试 18.7s。「不改写默认风险接受阈值与共享 fixture」已核对——发布配置里的 `risk-acceptance-threshold` 仍是 `demo-acceptance-default` / `maximumAcceptedLevelId: demo-level-2`（与 HEAD 一致），闭环里出现的 `demo-level-3` 是校准候选**提出的** `replace-risk-acceptance-threshold` 操作，且该建议未发布为知识（`knowledgeRevisionRef` 缺席），默认值没有被抬高来避错。

## 7. 收口

- [x] 7.1 实施全部 IP-ID：运行 `NODE_OPTIONS=--max-old-space-size=12288 npx tsc -b packages/core packages/adapters apps/worker`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm openspec:validate`、`openspec validate fix-forecast-response-resume-run-version-binding --strict --no-interactive`；在实现检查点后移交 Finalizer 填 `verification.md`，实现阶段不提前生成。
- [x] 7.2 本 change 归档后回到 C34：重新评估并勾选 4.1/4.2/4.4，并按其 4.3 汇总证据；不得在本 change 内提前勾选 C34 任务。
