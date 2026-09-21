# Tasks

## 1. 命令参数与幂等关闭

- [x] 1.1 `orcaJson` 只在 `args[0] === "orchestration"` 时附加 `--retry-request`
- [x] 1.2 cleanup 的关闭循环把 `terminal_handle_stale` 视为已关闭并继续，其他错误仍抛出
- [x] 1.3 `control.test.mjs`：断言 `terminal close` 调用不带 `--retry-request`；stale handle 不阻断其余 handle 与回收

## 2. 信任提示归类

- [x] 2.1 Codex 分支的 `worker-start` 失败按信任提示特征归类为 `workspace_trust_required`，携带精确 handle 与恢复动作
- [x] 2.2 `control.test.mjs`：`worker-start` 返回信任提示时派发以 `workspace_trust_required` 结束，且不生成 failed attempt

## 3. 验证

- [x] 3.1 运行 `pnpm exec vitest run scripts/orchestration`，全部通过
- [x] 3.2 运行 `pnpm exec tsc -b`、`pnpm exec eslint scripts/orchestration`、`pnpm exec prettier --check scripts/orchestration openspec/changes/fix-orchestration-close-and-trust`
- [x] 3.3 运行 `openspec validate fix-orchestration-close-and-trust --strict --no-interactive`，valid
