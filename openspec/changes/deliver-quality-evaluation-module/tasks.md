## 1. 冻结样例与确定性计算

- [x] 1.1 实施 IP-01 数据集/报告 Schema、合成样例与导出；运行 `pnpm exec vitest run packages/core/test/quality/quality.test.ts`，确认完整样例通过、缺标签/版本失败且标记“合成样本，待甲方复核”。
- [x] 1.2 实施 IP-02 指标、逐项诊断和 C29 重放复用；运行 `pnpm exec vitest run packages/core/test/quality/quality.test.ts`，确认分子分母、零分母、错版和缺失结果边界。

## 2. 证据、索引与公共查询

- [x] 2.1 实施 IP-04 的 C36 自有只追加 migration 与测试清单；报告索引按报告引用唯一，冻结登记按数据集身份唯一；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts`，确认重复 up、逆序 down、两表最小 GRANT 和序号无冲突。
- [x] 2.2 实施 IP-03 授权读、C04 报告、C03 同事务冻结摘要核对/索引/审计/回执及 CLI；运行 `pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts`，确认同键重放、并发同/异摘要、同数据集多报告、失败不显成功、可重现命令与工件引用。
- [x] 2.3 实施 IP-05 的公共 Schema 最小加法、C36 投影、C09 窄查询接线；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`，确认授权、不可枚举拒绝、旧类型兼容及有界分页。

## 3. 页面与真实浏览器

- [x] 3.1 实施 IP-06 质量页面和生产入口接线；运行 `pnpm exec vitest run apps/web/test/quality.test.tsx`，确认工程切换清除旧数据、只显示授权摘要与 C10 交互状态。
- [x] 3.2 协调端先按 D-07 登记 `@playwright/test@1.63.0` 的 `devDependency`、锁文件及依赖策略；实施 IP-07 浏览器配置、真实服务 fixture 与跨页面测试；运行 `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`，缺 Chromium/服务时记录非零失败而不跳过。

## 4. 最小回归与交接

- [x] 4.1 对 IP-01～IP-07 运行 `pnpm typecheck && pnpm deps:check && pnpm deps:policy && openspec validate deliver-quality-evaluation-module --strict --no-interactive`，记录真实 HEAD、C04 报告、浏览器版本/trace 与命令；仅在行为和证据完成后勾选各实施任务，移交 Finalizer 填写 verification。

## 5. 重开范围：证明与授权映射

- [ ] 5.1 **IP-08 当前 BLOCKED：** `packages/core/src/identification/candidate-finalization/service.ts:3559-3560` 对零记录/跳过直接返回 `skipped`，未进入 `:3599-3605` 的 C03 事务；`000042_risk_candidate_finalization.ts:242-265` 只存已接受记录。`msg_ca7d95d014fa` 不授权本轮补写入事实，故已批准的 C22 `readFormalRunResultProof` 只读加法也暂不施工，保持 TN/覆盖失败闭合。待后续拥有方事实源成立，再运行 `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`，以真实 PostgreSQL 证明有结果/正式零结果/无权/跨空间、并发及重放；不得提前勾选。
- [x] 5.2 **IP-09：** 复用 C13 已公开 `evidence-access` 及当前 C06 既有读授权，对每个 `requiredEvidenceRefs` 取得同形解析收据并与 C04/审计证据合取；运行 `pnpm exec vitest run packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts`，核对全项通过及缺证/撤权/跨空间工程/错版/重放失败。
- [x] 5.3 **IP-10：** 在 C36/C09 请求内先有界取候选来源版本、逐版本向 C06 精确签发，再按真实 grant 映射过滤摘要定位；运行 `pnpm exec vitest run apps/api/test/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts` 和 `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`，核对获准可见、无权隐藏、同形拒绝、并发和旧查询兼容。
- [ ] 5.4 **IP-08～IP-10：** 三项均有真实行为及证据后运行 `pnpm typecheck && pnpm deps:check && pnpm deps:policy && openspec validate deliver-quality-evaluation-module --strict --no-interactive`；形成固定实现检查点后由 Finalizer 更新既有 `verification.md`，规划阶段不得勾选或改写旧 BLOCKED 结论。
