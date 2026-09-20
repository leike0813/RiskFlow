# Tasks

## 1. 锁让出原语

- [x] 1.1 `withRuntimeLock` 拆出 `acquireRuntimeLock(lockDir, { attempts })`，并向 `work` 传入锁句柄 `{ withoutLock(step) }`
- [x] 1.2 `withoutLock` 在 `finally` 中重新取锁；重新获取使用约 60 秒预算，初次获取保持 1 秒 fail-fast
- [x] 1.3 `controlledMutation` 向 `perform` 暴露 `runtimeDir`、`lock`、`revision`、`statusProvider`

## 2. 长外部步骤

- [x] 2.1 `defaultExec` 支持 `options.env` 透传
- [x] 2.2 `riskflowIntegrate` 的主线复验步骤改用 `ctx.lock.withoutLock(...)`，并以剥离 `ORCA_TERMINAL_HANDLE`、`ORCA_CLI_COMMAND` 的环境执行 `pnpm verify`
- [x] 2.3 重新取锁后按起始 `expectedRevision` 重新校验事实集，变化则以 `stale_revision` 拒绝写入

## 3. 测试

- [x] 3.1 `control.test.mjs` 覆盖：`withoutLock` 期间另一受控操作能取到锁
- [x] 3.2 `control.test.mjs` 覆盖：主线复验以剥离编排身份的环境执行 `pnpm verify`
- [x] 3.3 `control.test.mjs` 覆盖：解锁期间事实变化时以 `stale_revision` 拒绝
- [x] 3.4 编排测试与 ambient 编排身份隔离：模块加载时清除、结束后还原

## 4. 验证

- [x] 4.1 `npx vitest run scripts/orchestration/` 全部通过（在设置 `ORCA_TERMINAL_HANDLE` 与未设置两种情况下结论一致）
- [x] 4.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 4.3 `openspec validate fix-orchestration-long-external-step-contract --strict --no-interactive` 通过
- [x] 4.4 真实仓库验证：AUX 主线复验在协调终端发起时通过
