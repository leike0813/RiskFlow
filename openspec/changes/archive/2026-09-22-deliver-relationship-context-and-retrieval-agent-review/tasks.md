## 1. 契约与关系检索

- [x] 1.1 [IP-01、IP-07] 新增 C21 严格 DTO、最窄端口和合成夹具；运行 `pnpm exec vitest run packages/core/test/identification/context.test.ts`。
- [x] 1.2 [IP-02、IP-07] 完成精确冻结输入、C06 收窄授权、C17 知识读取与一跳关系/机理匹配；运行 `pnpm exec vitest run packages/core/test/identification/context.test.ts`。

## 2. 结果事实与审计

- [x] 2.1 [IP-03、IP-07] 新增 C21 `000041` 单表迁移、append-only 权限与 up/down/up 检查；运行 `pnpm exec vitest run packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`。
- [x] 2.2 [IP-03、IP-07] 接入 C04 先耐久、C03 登记/审计事务及同键重放/冲突、撤权回查；运行 `pnpm exec vitest run packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`。

## 3. 双路基线与必经 Agent 审阅

- [x] 3.1 [IP-04、IP-07] 以 C20 正式混合结果读取基线、稳定补搜 queryId，并构成唯一委派 router；运行 `pnpm exec vitest run apps/worker/test/identification/context/composition.test.ts apps/worker/test/retrieval/composition.test.ts`。
- [x] 3.2 [IP-05、IP-07] 向共享 C08 registry 注册 `retrieval-review` 类型化动作、两项有界工具和同任务模型步骤，严禁第二 claim runner；运行 `pnpm exec vitest run apps/worker/test/identification/context/runtime.test.ts`。
- [x] 3.3 [IP-05、IP-07] 完成增量逐项校验、正式检索工件集收口、预算/失败/重放边界；运行 `pnpm exec vitest run packages/core/test/identification/context.test.ts apps/worker/test/identification/context/runtime.test.ts`。

## 4. 五项上下文与回归

- [x] 4.1 [IP-06、IP-07] 只从关系结果与已 completed 审阅任务组装五项不可变上下文；接入 Worker C21 导出并验证缺项阻断；运行 `pnpm exec vitest run packages/core/test/identification/context.test.ts apps/worker/test/identification/context/composition.test.ts`。
- [x] 4.2 [IP-07] 执行计划 V-01～V-04 全部关键测试，真实 PG 容器测试不得 skip；复查 `git diff --name-only 6ffe9d5879fd6ec9ba252a79aa843c430158abf4` 只含已批准 C21 路径和主调度机械前置。
- [x] 4.3 [IP-01～IP-07] 执行 V-05 `pnpm exec tsc -b packages/core packages/adapters && pnpm typecheck && pnpm deps:check`、V-06 定向 ESLint/Prettier 和 V-07 `openspec validate deliver-relationship-context-and-retrieval-agent-review --type change --strict --no-interactive`；只有行为与证据均完成才勾选任务。
