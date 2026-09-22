## 1. 私有契约与复核任务接缝

- [ ] 1.1 实施 IP-01：新增 C23 strict 单项/批量动作与结果 Schema，锁定单候选修订、只读字段、批量上限和重复任务边界；运行 `pnpm exec vitest run packages/core/test/identification/human-review.test.ts`。
- [ ] 1.2 实施 IP-02：新增 C07 identification-group pending 任务授权先行窄读及适配器测试；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`。

## 2. 候选修订与确定性重校验

- [ ] 2.1 实施 IP-03：在 C22 增加精确来源候选/已校验集/分组关系校验、后继候选版本和冻结策略重校验；运行 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts`。
- [ ] 2.2 实施 IP-03、IP-05：完成 C04 工件、C03 两类既有结果登记、审计及响应丢失/同键异载荷对账，不产生新事件；运行 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/identification/human-review.test.ts`。

## 3. 单项与批量决定编排

- [ ] 3.1 实施 IP-04：完成六类单项决定、修订成功后 C07 提交、陈旧竞态和唯一恢复事件语义；运行 `pnpm exec vitest run packages/core/test/identification/human-review.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`。
- [ ] 3.2 实施 IP-05：完成批量原样通过/拒绝的全批预检、顺序逐项隔离和部分失败结果；运行 `pnpm exec vitest run packages/core/test/identification/human-review.test.ts`。

## 4. Worker 组合与导出

- [ ] 4.1 实施 IP-06：暴露 C22 revision seam，新增 C23 Worker composition、core 子路径和 Worker 根导出，缺依赖时构造失败；运行 `pnpm exec vitest run apps/worker/test/identification/human-review/composition.test.ts apps/worker/test/identification/candidate-finalization/composition.test.ts`。
- [ ] 4.2 实施 IP-07：回归 C07/C22/C23 的权限、事务、关键状态机和合成样本证据，确认 V-01、V-02、V-03 全部通过且无关键场景 skip。

## 5. 边界与质量门禁

- [ ] 5.1 核对无公共契约、权限矩阵、迁移、依赖、API/UI drift；运行 `pnpm typecheck` 与 `pnpm deps:check && pnpm deps:policy`（V-04、V-05）。
- [ ] 5.2 完成计划文件 lint/格式、严格 OpenSpec 和 diff 检查；运行 V-06、`openspec validate deliver-identification-human-review --strict --no-interactive` 与 `git diff --check && git status --short`（V-06～V-08），将证据交给 Finalizer 创建 verification。
