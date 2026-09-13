## 1. 公共引用契约

- [ ] 1.1 [IP-01；D-01～D-03] 在 `packages/contracts/src/ports/index.ts` 导出 `RuleConflictRefV1Schema = versionedRef("rule-conflict")` 及其 `z.infer` 类型，让 `ReviewTargetRefV1Schema`、`ReviewTaskRefV1Schema` 的规则冲突分支和 `ContractReferenceV1Schema` 直接复用它，并删除重复的私有规则冲突引用 Schema；不得修改其它 kind、枚举或文件。执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，以退出码 0 验证公共类型与所有 contracts 引用闭合。
- [ ] 1.2 [IP-02；D-05] 在 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 扩展现有测试：同一 `ruleConflictRef` 必须被命名 Schema、`ContractReferenceV1Schema`、`reviewType=rule-conflict` 的请求/任务及 `review.review-requested.v1` 接受；缺少精确版本、附带正文/未知字段及未知 kind 必须被拒绝。执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`，以该文件全部测试通过验证稳定行为，不新增测试文件或断言完整错误文案。

## 2. 回归与范围门

- [ ] 2.1 [IP-03；D-03] 依次执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 和 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`；两条命令均须退出码 0，证明 contracts 的运行时 Schema 与静态类型一致。
- [ ] 2.2 [IP-03；D-03～D-04] 执行 `pnpm typecheck`；退出码必须为 0，证明 `ContractReferenceV1` 新联合成员未破坏 core、adapters、apps 或现有测试的消费类型。若出现需要修改 `packages/contracts/**` 之外文件的穷尽分支错误，停止并报告范围漂移，不得在本 change 扩大修改。
- [ ] 2.3 [IP-03；D-06] 执行 `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-rule-conflict-reference/proposal.md openspec/changes/evolve-rule-conflict-reference/design.md openspec/changes/evolve-rule-conflict-reference/tasks.md openspec/changes/evolve-rule-conflict-reference/specs/domain/module-interfaces-events-workflows/spec.md`；全部文件须通过格式检查，且不得用格式化命令改写范围外文件。
- [ ] 2.4 [IP-03；delta spec] 执行 `openspec validate evolve-rule-conflict-reference --strict --no-interactive`；必须通过严格校验，且 capability 只能是 `domain/module-interfaces-events-workflows`。
- [ ] 2.5 [IP-03；D-06] 执行 `git diff --check` 与 `git status --short --untracked-files=all`；前者须退出码 0，后者人工核对只出现本 change 四类规划工件、`packages/contracts/src/ports/index.ts` 和 `packages/contracts/test/module-interfaces-events-workflows.test.ts`。不得出现 `common/index.ts`、`records/index.ts`、`events/index.ts`、core、adapters、apps、迁移、根 workspace、锁文件、依赖政策、`openspec/config.yaml`、主 specs 或其它 change 的修改。

## 3. C19 恢复指引（不属于本 change 的执行范围）

C19 合入包含本契约的基线后，在 `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts` 的测试 `冲突规则被拦截：组装失败且只追加记录未决冲突与 C07 审阅链接` 中，删除“`ContractReferenceV1` 没有 `rule-conflict`”的临时说明；把 `rule_conflict_review_links` 的计数查询改为按 `link_id` 稳定排序读取 `status`，并将 `expect(links.rows[0]?.count).toBe("0")` 恢复为 `expect(links.rows.map((row) => row.status)).toEqual(["pending"])`。随后运行：

```sh
pnpm exec vitest run packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts -t '冲突规则被拦截：组装失败且只追加记录未决冲突与 C07 审阅链接'
```

通过条件是：C07 成功创建规则冲突复核任务，C19 恰好保存一条 `status=pending` 的冲突审阅链接，适用规则集仍因未决冲突保持为零；不需要修改 C19 生产代码、C07 运行时或迁移。若该断言仍失败，应作为 C19/C07 drift 单独升级，不得在本 change 修改范围外代码。
