## 1. 共享契约

- [x] 1.1 [IP-01] 按 design D-01～D-03 收紧 `packages/contracts/src/records/index.ts` 的风险输入与评估记录判别联合；运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，确认 Schema 与声明构建通过。

## 2. 契约证据

- [x] 2.1 [IP-02] 机械更新 `packages/contracts/test/contract-kernel.test.ts` 的合法夹具并补齐运行时 XOR 边界；运行 `pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts`，确认全部契约行为通过。
- [x] 2.2 [IP-02] 在同一测试文件加入合法分支收窄与预先赋值双标识对象的编译期断言；运行 `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --verbatimModuleSyntax --noUncheckedIndexedAccess --exactOptionalPropertyTypes packages/contracts/test/contract-kernel.test.ts`，确认含糊结构只通过 `@ts-expect-error` 被拒绝。

## 3. 交付门禁

- [x] 3.1 [IP-03] 运行 `pnpm exec eslint packages/contracts/src/records/index.ts packages/contracts/test/contract-kernel.test.ts`、`pnpm deps:check` 与 `git diff --check`，确认代码质量、依赖边界和空白检查通过。
- [x] 3.2 [IP-03] 运行 `pnpm exec prettier --check packages/contracts/src/records/index.ts packages/contracts/test/contract-kernel.test.ts openspec/changes/evolve-risk-input-reference-discriminant` 与 `openspec validate evolve-risk-input-reference-discriminant --strict --no-interactive`，确认格式和五工件 strict 校验通过。
- [x] 3.3 [IP-03] 运行 `git diff --name-only f7b568907026864735dee8599f8aae1a1cf34794 --` 与 `git status --short`，确认范围只含 implementation-plan §7 允许的两个代码文件和本 change 工件；不提交、不归档。
