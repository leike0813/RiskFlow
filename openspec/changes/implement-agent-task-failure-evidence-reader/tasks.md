## 1. Contracts 与 C06 授权

- [ ] 1.1 [IP-01] 在 contracts 增加 `agent-task.read` 与 `agent-task.read-failure-evidence` 精确映射，并扩展既有 contracts/core access 测试；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/access.test.ts`
- [ ] 1.2 [IP-01] 在既有 PostgreSQL C06 测试中证明该 branch 的 authorize/verify 上下文只含 `agent-task.read`；运行 `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`

## 2. 公共接口与 PostgreSQL 实现

- [ ] 2.1 [IP-02] 在 core agent-runtime 按 D-01 导出四个公共失败证据类型并保持现有 barrel/subpath 可导入；运行 `pnpm exec tsc -b packages/contracts packages/core --pretty false`
- [ ] 2.2 [IP-03] 在现有 `PostgresAgentTaskAdapter` 实现授权先行、精确任务/动作/候选窄查询、白名单投影和同形拒绝；运行 `pnpm exec tsc -b packages/adapters --pretty false`
- [ ] 2.3 [IP-03] 以 C03 收口成功读取的幂等收据、单条事实审计和零 Outbox，并保持异载荷冲突与技术错误语义；运行 `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`

## 3. C08 行为验收

- [ ] 3.1 [IP-04] 扩展既有 C08 adapter 测试，覆盖 terminal-failure、cancelled、used usage、动作映射、候选排序、校验去重和公共字段白名单；运行 `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`
- [ ] 3.2 [IP-04] 用表驱动用例覆盖不存在、跨工程、错完整引用/expected taskType、非终态、未授权/缺 verifier 的同形 `AUTHORIZATION_DENIED`，并验证重放审计与异载荷冲突；运行 `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`

## 4. 完成门

- [ ] 4.1 [IP-05] 运行三包定向编译、ESLint、Prettier 与依赖边界检查：`pnpm exec tsc -b packages/contracts packages/core packages/adapters --pretty false && pnpm exec eslint packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/agent-runtime/runtime.ts packages/core/test/access.test.ts packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts && pnpm exec prettier --check openspec/changes/implement-agent-task-failure-evidence-reader packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/agent-runtime/runtime.ts packages/core/test/access.test.ts packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts && pnpm deps:check && pnpm deps:policy`
- [ ] 4.2 [IP-05] 运行 `pnpm build && openspec validate implement-agent-task-failure-evidence-reader --strict --no-interactive`，并检查最终 diff 仅含第 7 节白名单、无迁移/依赖/C17/C15/C16 改动
