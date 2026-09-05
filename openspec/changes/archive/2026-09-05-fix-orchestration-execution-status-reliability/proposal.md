## Why

编排状态观察器把历史 Orca 任务、旧主线检查点和当前运行事实混在一起，导致已经归档的节点被错误降级为 `unknown`，并且可能因分页截断漏掉事实。当前输出无法可靠判断已完成节点、实时阻断和可执行前沿。

## What Changes

- 以当前 `main` 中已提交的 OpenSpec 归档作为节点完成事实，历史 Orca 记录仅作诊断证据。
- 将主线检查点按 Git 祖先关系验证，避免主线后续推进使历史完成态失效。
- 只让仍关联实时 worktree、worker/Dispatch 或 terminal 的 Orca 任务参与门禁；完整分页 Run，并逐 Run 读取、去重 Task。
- 按拓扑顺序推导状态，补强 Manifest 与任务信封边界校验。
- 保持现有 CLI、JSON `schemaVersion: 1` 和已有字段兼容，增加可选非阻断诊断。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `operations/orchestration-execution-status`: 明确持久完成事实、实时阻断范围、任务尝试选择、分页采集和拓扑推导的可靠性要求。

## Impact

- 修改 `scripts/orchestration/status.mjs` 及其现有测试。
- 更新实施编排手册与编排状态规格。
- 不改变生产 workspace、RI/RA 领域 Schema、静态执行图依赖或第三方依赖。
