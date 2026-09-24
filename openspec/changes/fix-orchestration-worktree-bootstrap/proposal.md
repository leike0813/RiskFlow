## Why

新工作树创建后的三个已复现缺陷会阻断受控派发：继承的未归档 change 被误当成辅助工作项、停在 main 尖端的分支被误判为已合并、Codex 首次启动卡在工作区信任提示。它们都发生在工作树进入正常任务执行之前，需要在 C42 一次收口。

## What Changes

- 辅助 change 采纳依据改为真实归属证据；仅从 main 继承的同名活动目录不再生成辅助工作项或重复工作树冲突。
- 未归档 feature 的合并判据排除 `feature HEAD === main HEAD`，保留真正已合并分支的集成状态。
- 受控创建 Codex terminal 时，只对当前受管工作树提供单次信任配置；若仍遇信任提示，继续使用现有屏幕探测和同 Task 恢复链路。
- 使用现有编排测试覆盖三条缺陷路径及各自的反例。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `operations/orchestration-execution-status`：辅助工作项归属与未归档工作树的合并状态判定。
- `operations/orchestration-controlled-actions`：Codex 受控派发对当前受管工作树提供有界信任配置，并保留失败恢复。

## Impact

- 影响 `scripts/orchestration/status.mjs`、`scripts/orchestration/control.mjs` 及同目录现有测试。实施范围仅 `scripts/orchestration/**`，不改业务代码或执行图语义。
- 规划基线为 `2ca676833916a2bfdbb250e17582a6fb4ed8688a`。复用 Node.js、Git、OpenSpec、Orca 与 Codex 现有能力；无新依赖、业务 Schema、数据库迁移或 RI/RA 链路改动。
