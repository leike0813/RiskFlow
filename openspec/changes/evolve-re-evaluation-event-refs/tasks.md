## 1. 实施准备

- [ ] 1.1 [IP-01, IP-02, IP-03] 运行 `openspec instructions apply --change evolve-re-evaluation-event-refs --json` 并完整读取全部 `contextFiles`，再以 `git rev-parse HEAD`、`rg -n "AssessmentInputChangedPayloadV1Schema|previousMonitoringSnapshotRefs|newMonitoringSnapshotRefs|domain events:" packages/contracts` 核对固定基线、目标符号与测试；任一漂移按 implementation-plan §7 升级。

## 2. 公共事件 Schema

- [ ] 2.1 [IP-01] 按 D-01/D-02 只修改 `packages/contracts/src/events/index.ts` 的 `AssessmentInputChangedPayloadV1Schema`，使两个 monitoring 引用数组可选但存在时非空，并拒绝两侧皆缺；运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，且 applicability-metadata、事件信封和其它事件保持不变。

## 3. 契约行为测试

- [ ] 3.1 [IP-02] 按 D-03/D-06 扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的现有 domain events 用例，覆盖仅 new、仅 previous、两侧非空、两侧皆缺、任一显式空数组、旧单数字段和未知字段；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'domain events'`。
- [ ] 3.2 [IP-02, IP-03] 运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`，确认该文件全部通过且未改动的评估准备、快照、applicability-metadata 和其它事件行为无回归。

## 4. 集成与范围收口

- [ ] 4.1 [IP-01, IP-03] 运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false && pnpm typecheck`，确认公开 `DomainEventV1` 推导类型与 main 的通用事务、Outbox、幂等消费及应用调用方均可编译。
- [ ] 4.2 [IP-01, IP-02, IP-03] 运行 `pnpm exec eslint packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts`、`pnpm exec prettier --check packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-re-evaluation-event-refs`、`openspec validate evolve-re-evaluation-event-refs --strict --no-interactive` 与 `git diff --check`；再用 `git status --short` 和 `git diff --name-only` 确认实现代码只修改 implementation-plan §7 白名单且未触及依赖、迁移、apps、core、adapters、主 specs 或其它事件。
