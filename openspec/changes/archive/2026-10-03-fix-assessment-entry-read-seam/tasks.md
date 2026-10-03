# Tasks

## 1. 公共输入与耐久定位

- [x] 1.1 IP-01：闭合两类候选输入并补契约测试；运行 `pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts`。
- [x] 1.2 IP-02：实现 000055、迁移清单和历史/default/权限验证；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`。

## 2. 目录与候选接缝

- [x] 2.1 IP-03：实现薄端口和受权有界 keyset，验证长标识、重启、50/51、同时间、插入、错游标、损坏与零写入；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`。
- [x] 2.2 IP-04：修复 C25 两个候选调用，更新原 change 接缝依赖；运行 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` 和 `openspec validate deliver-assessment-warning-and-response-ui --strict --no-interactive`。

## 3. 集成核验

- [x] 3.1 IP-05：运行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`、目标 ESLint/Prettier check、`pnpm deps:check` 与 `openspec validate fix-assessment-entry-read-seam --strict --no-interactive`；生成 verification，保留原 change 任务未完成。

完成核验后按官方技能同步主规格并仅归档本修复 change。
