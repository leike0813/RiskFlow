## 1. 辅助工作项归属

- [x] 1.1 按 IP-A1 采集 main 的活动 change 名称，保持 worktree 与任务信封原有采集；运行 `pnpm exec vitest run scripts/orchestration/status.test.mjs`。
- [x] 1.2 按 IP-A2 只从精确所有权或本地登记生成 AUX，覆盖继承副本、本地待采纳和真实双所有者；运行 `pnpm exec vitest run scripts/orchestration/status.test.mjs`。

## 2. 合并事实

- [x] 2.1 按 IP-B1 排除 HEAD 与 main 相等的未归档 route/AUX 工作树，保留真实祖先及归档判定；运行 `pnpm exec vitest run scripts/orchestration/status.test.mjs`。

## 3. Codex 信任与恢复

- [x] 3.1 按 IP-C1 校验受管路径身份；信任提示时返回含完整路径、terminalHandle 和人工修复指引的既有类型化结果，已信任时正常派发；运行 `pnpm exec vitest run scripts/orchestration/control.test.mjs`。
- [x] 3.2 按 IP-C2 保持屏幕探测、queued Task 与同 handle 恢复；探测不可用或配置不可读时失败闭合；运行 `pnpm exec vitest run scripts/orchestration/control.test.mjs` 与 `openspec validate fix-orchestration-worktree-bootstrap --strict --no-interactive`。

## 4. 交付检查

- [x] 4.1 按 IP-A1～IP-C2 运行 `pnpm exec eslint scripts/orchestration/status.mjs scripts/orchestration/status.test.mjs scripts/orchestration/control.mjs scripts/orchestration/control.test.mjs` 和 `pnpm exec prettier --check scripts/orchestration/status.mjs scripts/orchestration/status.test.mjs scripts/orchestration/control.mjs scripts/orchestration/control.test.mjs`，确认 A/B/C 的定向命令证据齐全。
