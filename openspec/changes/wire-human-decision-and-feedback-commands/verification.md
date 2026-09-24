# Verification

## 验收对象

- Change：`wire-human-decision-and-feedback-commands`（`orchestrated-delivery`）
- 输入实现 HEAD：`14d90406db314d3dfe90176c8dd92ffdab4ef9e7`
- 当前产物 HEAD：`14d90406db314d3dfe90176c8dd92ffdab4ef9e7`，附本次未提交的验收修复；主调度形成检查点后须更新为其产物 HEAD。
- 验收 Agent：Codex Finalizer，`task_bfce14203362`。

## 结论

**BLOCKED**。已批准范围的实现缺口已修复，相关行为测试、类型检查、依赖边界和规格校验通过。此 change 涉及权限、跨事务终局和等待恢复状态机，按收尾协议仍须一次 Targeted Auditor 限定审计；审计结论进入本文件之前不得记为 PASS。完整仓库门禁结果见下方命令记录。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 人工决定：采纳后启动预测；IP-1/2/4/8 | `packages/core/src/human-decision-feedback/service.ts`、`apps/worker/src/risk-flow/runtime.ts`；`command-chain.test.ts`、`runtime.test.ts` | 真实等待绑定、C28 决定、C41 终局后才恢复；通过 |
| 人工决定：拒绝终结；IP-4/8 | `postgres-human-decision-feedback-adapter.test.ts`、`command-chain.test.ts` | 唯一终局拒绝，无预测运行；通过 |
| 人工决定：错配绑定拒绝；IP-1/2/4 | `postgres-workflow-adapter.test.ts`、`postgres-human-decision-feedback-adapter.test.ts` | 错建议、缺运行、跨空间失败关闭；通过 |
| 人工决定：提交前中断及原键重试；IP-2/4/8 | `runtime.test.ts`、`command-chain.test.ts` | 同运行重放且决定前零预测；通过 |
| 人工决定：普通恢复不得越等待门；IP-2 | `apps/worker/src/risk-flow/runtime.ts`、`runtime.test.ts` | 仅精确终局采纳证明可恢复；通过 |
| 现场执行：已采纳建议；IP-5/8 | `postgres-human-decision-feedback-adapter.test.ts`、`command-chain.test.ts` | C28 独立执行事实，原决定不变；通过 |
| 现场执行：独立行动；IP-5/8 | 同上 | 只用已发布措施，无假建议或预测；通过 |
| 现场执行：无权/虚假执行；IP-5/8 | 同上 | 冒充、未采纳及证据缺失均拒绝；通过 |
| 反馈：真实输入及已完成实际评估；IP-3/6/8 | `packages/core/src/human-decision-feedback/service.ts:981`、`packages/adapters/src/workflow/postgres-workflow-adapter.ts:1269`；C41 与 C30 适配器测试 | C25 精确记录、C30 已完成运行、监测/工件经 C28 校验后才冻结并提交；通过 |
| 反馈：评估缺失或链不符；IP-3/6/8 | `postgres-human-decision-feedback-adapter.test.ts`、`command-chain.test.ts` | 缺选择器、未完成运行、错风险输入不形成正式反馈；通过 |
| 命令：确认后重试；IP-4/6/7/8 | `apps/api/test/http-shell.test.ts`、`apps/web/test/confirmation.test.ts`、`command-chain.test.ts` | 保持命令身份，同键同载荷回同一事实；通过 |
| 命令：无权/陈旧版本；IP-1/4/6/7/8 | `http-shell.test.ts`、`postgres-human-decision-feedback-adapter.test.ts` | 服务端复验、strict DTO 与陈旧引用失败；通过 |
| C30 证明：精确绑定；IP-1/2 | `packages/adapters/src/workflow/postgres-workflow-adapter.ts:778`、对应适配器测试 | 只读精确路由、运行、建议及空间；通过 |
| C30 证明：缺失/越权/损坏；IP-2 | `postgres-workflow-adapter.test.ts` | 类型化失败，不写绑定事实；通过 |
| C30 等待：采纳前等待与重放；IP-2 | `apps/worker/test/risk-flow/runtime.test.ts` | 同一运行且不提前预测；通过 |
| C25 证明：精确实际评估；IP-1/3 | `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts:648`、对应适配器测试 | 记录与冻结依据的最小投影；通过 |
| C25 证明：缺失/越权/损坏；IP-3 | `postgres-risk-assessment-engine.test.ts` | 安全类型化失败，无正文披露；通过 |
| IP-0/1/7：基线、公共命令与路由 | 输入 HEAD；`packages/contracts/src/ports/index.ts`、`apps/api/src/http.ts`、`apps/web/test/confirmation.test.ts` | C30 已合入；三人工命令在原路由转 C41，C10 身份保持；通过 |

验收期修复：

- IP-6：C25 证明此前只确认评估记录存在，未验证其所属 C30 运行已完成。新增 strict `WorkflowRunCompletionProofPortV1`，由 C30 只读持久运行状态及已登记运行结果，核对精确运行版本与评估引用；C41 在准备反馈冻结输入前强制消费。增加真实 C30 证明测试和 C41 未完成运行的失败测试。
- IP-4：采纳命令摘要此前漏掉 `decision`，同键从采纳改成拒绝且原因相同时可能被当作原命令重放。决定引用及命令摘要现包含决定值，摘要也包含操作者；增加反向决定重试测试，确保不覆盖原事实。
- D3/D4 持久化：C41 迁移原有指向 C25 评估、C27 建议、C28 执行表的跨 change 外键，阻断下层迁移回滚。经协调端批准移除三条外键；C41 仍通过 C25 精确评估证明、C27 建议读取与 C28 反馈写入口验证引用。C41 迁移测试新增无跨 change 外键断言，C28 回滚测试已复验通过。
- 修复输入检查点已有的格式漂移与未使用符号；变更仅涉及本 change 的文件，不新增依赖或迁移。

已完成命令：

- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts apps/api/test/http-shell.test.ts apps/web/test/confirmation.test.ts`：9 文件、112 测试通过（输入检查点）。
- `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts`：3 文件、25 测试通过（IP-6 修复后）。
- `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`：13 测试通过（精确运行结果版本补强后）。
- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`：23 测试通过（新 strict 证明后）。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`、`pnpm deps:check`、`pnpm format:check`、`openspec validate wire-human-decision-and-feedback-commands --strict --no-interactive`：通过。默认 4 GiB 的 `pnpm typecheck` 曾因 Node 堆耗尽退出，8 GiB 堆复验通过。
- `pnpm lint`：修复输入检查点的未使用符号后复验通过。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`：构建、类型检查、lint、格式检查通过；Vitest 中 C28 PostgreSQL 链出现 21 项失败后中止，后续门禁未运行。单独执行 `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts -t '迁移 up/down 可重复执行'` 复现 C41 跨 change 外键阻断 C28 down；按协调端裁决修复后该用例及 C28 文件全部 24 项通过。全局门禁仍受既有 OpenSpec 主规格警告影响，见下。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`：通过；默认 4 GiB 堆运行同命令曾耗尽内存。
- `pnpm exec vitest run packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts -t '同键重放返回同一逻辑结果且同键异载荷失败关闭'`：1 测试通过（重建后）。
- `pnpm deps:policy`：通过。`pnpm openspec:validate`：33 项通过、1 项失败；失败项是既有 `orchestration/trust-recovery` 主规格 Purpose 占位警告，C41 change 本身验证通过，未越界修改该规格。
- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts apps/api/test/http-shell.test.ts apps/web/test/confirmation.test.ts`：9 文件、113 测试通过（IP-4/6 修复后）。
- `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`：24 测试通过（跨 change 外键修复后）。
- `pnpm exec vitest run packages/adapters/test/human-decision-feedback/migration-idempotency.test.ts packages/adapters/test/risk-assessment/migration-idempotency.test.ts`：2 文件、2 测试通过（C41/C25 回滚）。
- `pnpm exec vitest run packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts -t '000045 迁移可重复 up 且逆序 down 后能重新建立四表'`：1 测试通过（C27 回滚）。
- `pnpm exec vitest run packages/adapters/test/human-decision-feedback/postgres-human-decision-feedback-adapter.test.ts packages/adapters/test/human-decision-feedback/command-chain.test.ts`：2 文件、12 测试通过（最终迁移修复后）。
- 最终源码执行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`openspec validate wire-human-decision-and-feedback-commands --strict --no-interactive`、`git diff --check`：均通过。

## 限定审计

**待执行，一次。** 范围：C06 当前授权与 C30/C25 证明的空间、资料边界；C41 决定/反馈跨事务状态和 C28 事实一致性；C30 人工决定等待与恢复门；新增运行完成性证明。Targeted Auditor 须在本文件补充结论、发现、任务内修复及回归证据，并据最终产物更新结论与 HEAD。

## 后续注意事项

全库 `pnpm openspec:validate` 仍因 `orchestration/trust-recovery` 主规格 Purpose 占位警告失败；此项不属于 C41 已批准范围。
