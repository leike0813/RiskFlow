# Tasks

## 1. 控制器自持尝试台账

- [x] 1.1 在 `scripts/orchestration/control.mjs` 新增 `recordAttempt`（`attempts/<taskId>.json`，临时文件 + rename）与 `attemptEnvelope`（由路线节点 + 派发信封归一化出 `queued`/`running` 信封）
- [x] 1.2 运行时锁上下文向受控操作暴露 `runtimeDir`
- [x] 1.3 派发前登记 `queued` 尝试（硬前置），worker 启动成功后登记 `running`（软失败，返回 `attemptRecorded` / `attemptWarning`）
- [x] 1.4 受控 `reconcile` 与受控 `settle` 同步登记台账
- [x] 1.5 `control.mjs` 复用 `status.mjs` 导出的 `gitCommonDir`，删除本地重复实现

## 2. 状态视图补齐

- [x] 2.1 `scripts/orchestration/status.mjs` 新增台账读取（`attempts/*.json`，读取失败视为空）
- [x] 2.2 `normalizeTask` 在 `result` 无法解析出有效信封时用同 `taskId` 的台账信封补齐，Orca 侧有效信封优先
- [x] 2.3 `collectFacts` 在归一化任务时传入台账信封

## 3. 规格与测试

- [x] 3.1 delta：`orchestration-controlled-actions` 新增台账登记要求
- [x] 3.2 delta：`orchestration-execution-status` 新增台账补齐与优先级要求
- [x] 3.3 `control.test.mjs` 覆盖：派发登记运行态台账、worker 未启动时台账保留 `queued` 尝试、登记被拒时不使派发失败
- [x] 3.4 `status.test.mjs` 覆盖：台账补齐当前尝试、Orca 侧有效信封优先
- [x] 3.5 `status.mjs` 活动写者计数改用获批 replan 边界之后的尝试集合（`taskSummary.scope`），并为「边界之前的尝试不构成第二个活动写者」补规格场景与测试

## 4. 验证

- [x] 4.1 `npx vitest run scripts/orchestration/` 全部通过（48 passed）
- [x] 4.2 `npx prettier --check` 与 `npx eslint` 对改动文件干净
- [x] 4.3 `openspec validate fix-dispatch-attempt-envelope-visibility --strict --no-interactive` 通过
- [x] 4.4 `pnpm orchestration:doctor` 与 `orchestration:status --json` 在真实仓库上确认 `violations` 为空，且运行中的尝试被识别为当前尝试（C26 → `run_202d1c5218b4`、AUX → `run_56017001549d` 均为 `running`）
- [x] 4.5 真实收口验证：C17 attempt 2 在 `result` 被 worker 报告覆盖后，经台账解析出当前尝试并以 `outcome = paused` 完成受控收口
