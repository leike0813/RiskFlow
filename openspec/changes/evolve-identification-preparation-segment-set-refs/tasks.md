## 1. Contracts Schema

- [x] 1.1 [D-01、D-02] 修改 `packages/contracts/src/workflows/index.ts` 的 `IdentificationPreparationSnapshotV1Schema`：删除 `includedSourceSegmentSetRef`，新增 `includedSourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1)`，并以 `superRefine` 拒绝它与 `sourceVersionRefs` 数量不等的输入；不修改 `IdentificationInputSnapshotV1Schema` 或其它字段。运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，须零错误通过。

## 2. Contract Tests

- [x] 2.1 [D-04] 修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的既有 `IdentificationPreparationSnapshotV1Schema` fixture，并在同一测试中以代表性用例验证：多资料版本与等长资料段集合数组通过，空数组、数量不等和旧单数字段失败；不为错误文案或内部 issue 顺序断言。运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'uses strict snapshots and allows only resumable references'`，须目标测试通过。

## 3. Verification

- [x] 3.1 对实现改动运行 `pnpm exec prettier --check packages/contracts/src/workflows/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts`、`pnpm typecheck`、`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` 和 `openspec validate evolve-identification-preparation-segment-set-refs --strict --no-interactive`；全部须以退出码 0 通过，并确认 `rg -n 'includedSourceSegmentSetRef' packages/contracts/src packages/contracts/test` 只命中新复数字段，不得修改 core、adapters、apps、migration、根 workspace 或锁文件。
