## 1. 实施硬门与夹具

- [ ] 1.1 [IP-01, IP-10] 运行 `git rev-parse HEAD && git status --short && openspec instructions apply --change deliver-calibration-suggestion-and-governance-loop --json && openspec status --change deliver-calibration-suggestion-and-governance-loop --json`，完整读取全部 `contextFiles`，核对固定 base、`000047` 空闲、C28/C08/C07/C16/C18/C19 接缝及批准边界；漂移立即升级。
- [ ] 1.2 [IP-01] 新增 calibration PostgreSQL fixture，复用真实依赖并准备双工程/空间、超限边界、六类目标、三类复核决定和事务失败 seam；运行 `pnpm exec prettier --check packages/adapters/test/calibration/fixture.ts`。

## 2. 加法式证明与 Agent 结果读取

- [ ] 2.1 [IP-02] 增加 strict 校准批准证明 query/proof/result、`review-audit.read` 分支映射和端口方法，保持既有契约兼容；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`。
- [ ] 2.2 [IP-03] 在 C07 实现授权先行、工程限定、只读无副作用的校准批准证明，并覆盖批准、非批准、错目标、缺失、完整性和跨工程；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`。
- [ ] 2.3 [IP-04] 在 C08 增加 completed task/result 的私有精确窄读，校验任务类型、引用、授权、frozen input、真实 parent run、usage/actions/candidate version 且不暴露列表/latest；运行 `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`。

## 3. 校准领域与候选收口

- [ ] 3.1 [IP-05] 新增 calibration strict 私有 Schema、稳定 deviation/suggestion 身份、任务定义、六类类型化操作及完整 C18/C19 文档重建/校验；运行 `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts`。
- [ ] 3.2 [IP-06] 实现授权先行的 C28 fact、C25/C19 basis、C04 target 精确读取、冻结输入工件和 completed C08 结果收口，闭合未越限、真实 parent run、可修复和失败边界；运行 `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。

## 4. 建议、复核与治理草案

- [ ] 4.1 [IP-10] 新增 `000047` 三表迁移、精确外键/唯一约束/最小权限和逆序 `down`，验证真实 up/down、重复 up 和旧数据保留；运行 `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。
- [ ] 4.2 [IP-07] 实现确定性 C07 复核请求，以及建议、pending 公共偏差记录、回执、审计和既有 Outbox 的 C03 原子写入；运行 `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。
- [ ] 4.3 [IP-08] 实现 reject、return-for-revision、approve-draft-creation 三类精确决定收口和只追加状态版本；运行 `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。
- [ ] 4.4 [IP-09] 实现 C07 证明门禁、候选精确重放、C04 内容工件、C16 幂等 `submit-revision` 与成功后的 approved 记录，证明无自动发布且尾事务重试不重复修订；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。

## 5. 导出与稳定行为

- [ ] 5.1 [IP-11] 增加 core/adapters `./calibration` 子路径导出，补齐 implementation-plan §6 的 31 个 Scenario 代表性证据；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/calibration/calibration.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。
- [ ] 5.2 [IP-11] 验证 contracts/records/events/workflows 与 apps 未漂移、C29 未激活路由且草案保持未发布；运行 `git diff -- packages/contracts/src/records packages/contracts/src/events packages/contracts/src/workflows apps && pnpm deps:check`，预期前一命令无 diff。

## 6. 最小验证与交接

- [ ] 6.1 [IP-11] 运行 `pnpm typecheck`、implementation-plan §6 的 scoped `eslint` 与 `prettier --check`，修复批准范围内问题。
- [ ] 6.2 [IP-01, IP-11] 运行 `pnpm deps:check && pnpm deps:policy && git diff --check && openspec validate deliver-calibration-suggestion-and-governance-loop --strict --no-interactive`，核对修改路径仅在 implementation-plan §7 allowlist，并向主调度报告中央 migration/auth fixture 登记位置；不创建 verification、不提交或归档。
