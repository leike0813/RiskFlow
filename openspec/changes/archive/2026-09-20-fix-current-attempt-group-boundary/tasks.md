# Tasks

## 1. 选择规则

- [x] 1.1 `taskSummary` 在最大阶段内先按尝试组边界（组内最新创建时间）定界，再取该范围内的最大 attempt 与创建顺序
  - 证据：`status.mjs` 新增 `latestAttemptGroupScope`，`taskSummary` 的 `phaseTasks` 改为经其定界后再取 attempt 与创建顺序。
- [x] 1.2 无尝试组或创建时间不可比较时回退既有语义；边界相同时不做单独裁决
  - 证据：任一组缺 `createdAt` 时直接返回 `phaseTasks`；边界相同的组一并保留，交由后续 attempt/创建顺序与冲突判定。

## 2. 测试

- [x] 2.1 `status.test.mjs` 覆盖：同阶段内 audit（新组，attempt 1）压过已收口的 finalization（旧组，attempt 2），`checkpoints` 指向 audit
  - 证据：用例 `selects the newest attempt group as the current attempt within a phase`。
- [x] 2.2 `status.test.mjs` 覆盖：同一组内的多次尝试仍按 attempt 选择（既有语义不回退）
  - 证据：用例 `still orders attempts inside one attempt group`。
- [x] 2.3 既有 replan 边界、无唯一创建顺序等用例保持通过
  - 证据：`npx vitest run scripts/orchestration/` 61 passed（含新增 2 例）。

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
  - 证据：61 passed（后续两次修复追加用例后为 64 passed）。
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
  - 证据：两条命令均 exit 0。
- [x] 3.3 `openspec validate fix-current-attempt-group-boundary --strict --no-interactive` 通过
  - 证据：`Change 'fix-current-attempt-group-boundary' is valid`。
- [x] 3.4 真实仓库验证：C26 的 `checkpoints` 指向正在运行的 audit
  - 证据：修复后 `status.mjs` 对 C26 报 `cp: task_5229b594d23c audit running`（此前指向已收口的 finalization 尝试）。
