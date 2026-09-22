## 1. 领域契约与确定性逻辑

- [ ] 1.1 实施 IP-01、IP-02：建立 C22 私有严格 Schema、窄端口和输入一致性检查；运行 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts`。
- [ ] 1.2 实施 IP-04：完成逐项确定性校验、错误分类和原预算内父子候选修正状态；运行 V-01。
- [ ] 1.3 实施 IP-05：完成全工作计划三信号合并、显式无重复组和策略化综合置信度；运行 V-01。
- [ ] 1.4 实施 IP-06 的核心部分：完成唯一验收路由及决定匹配/阻断语义；运行 V-01。

## 2. 模型运行与 Worker 组合

- [ ] 2.1 实施 IP-03：以 C21 五项上下文和 C10 `completeStructured`/`embed` 完成候选生成、修正与向量证据运行时；运行 `pnpm exec vitest run apps/worker/test/identification/candidate-finalization/runtime.test.ts`。
- [ ] 2.2 实施 IP-09：组合全部必需依赖并增加现有包子路径与 Worker 导出，缺依赖时构造失败；运行 V-03。
- [ ] 2.3 回归 IP-02、IP-03、IP-09 的 C21/C10 接缝且确认无公共契约漂移；运行 V-05。

## 3. 复核决定与持久化

- [ ] 3.1 实施 IP-06 的适配器部分：按现有模式增加 `readIdentificationGroupDecision` 内部窄读并覆盖 pending、superseded、错目标和跨工程决定；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`。
- [ ] 3.2 实施 IP-07：完成 C04 正文、C03 追加登记、授权复验及同 ref 重放/冲突的 PostgreSQL 适配器；运行 `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。
- [ ] 3.3 实施 IP-08：以单个 C03 事务原子写入标准化记录、回执、审计和既有接受事件，并覆盖故障回滚与并发幂等；运行 V-02。
- [ ] 3.4 实施 IP-10：新增并登记 `000042_risk_candidate_finalization.ts`，更新迁移与授权测试清单并验证 up/down/up、角色和追加式约束；运行 V-04。

## 4. 集成回归与收口

- [ ] 4.1 完成 IP-01～IP-10 的定向行为回归，确认 V-01、V-02、V-03、V-04、V-05 全部通过且无关键场景 skip。
- [ ] 4.2 完成 IP-09、IP-10 的构建、类型与依赖边界检查；运行 V-06。
- [ ] 4.3 完成全部计划文件的 lint 与格式检查；运行 V-07。
- [ ] 4.4 核对实际 diff 仅落在 implementation-plan §7 allowlist，运行 V-08，并将实现证据交给 Finalizer 创建 verification。
