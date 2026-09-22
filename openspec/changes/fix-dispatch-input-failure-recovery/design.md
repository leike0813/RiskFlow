# Design

## Context

见 `proposal.md`。当前 `startWorker` 只匹配抛出错误的 message；Orca `worker-start` 失败时 JSON 结构位于命令失败输出中，并可由同一 `--retry-request` 重放。状态视图只看到终态 worker 与尚未生成的本地 change，无法区分输入前信任阻塞和真正执行失败。

## Goals / Non-Goals

**Goals:**

- 只把结构化 `dispatch_input` 信任提示视为可恢复的 queued 尝试。
- 让同一 Task/terminal 的重新派发与 reconcile 可达，并在输入接受后恢复严格校验。

**Non-Goals:**

- 不自动确认信任，不修改 Orca 生命周期契约，不新增状态存储、依赖或新的 Task。
- 不豁免重复工作树、重复写者、身份、检查点或其他 OpenSpec 缺失场景。

## Decisions

### D-01：失败解析复用同一 retry-request

命令失败时先解析其 JSON 输出；`worker-start` 未携带可用结构化结果时，以完全相同的参数和 retry-request 重放一次。仅当返回的 `stage`/`failedStage` 为 `dispatch_input` 且 `lastError` 命中工作区信任特征时归类。替代方案“继续匹配异常 message”无法读取真实 Orca 结果，已被现场证据否定。

### D-02：用现有 `issueRefs` 保存恢复原因

控制器把固定恢复原因写入现有 queued 尝试信封的 `issueRefs`，不扩展 v2 信封 Schema，也不在 worktree 内新增运行时状态。状态视图只消费这一固定标记。替代方案“凭 failed worker + 缺少 change 推断”会错误放宽其他输入失败。

### D-03：豁免条件同时约束信封与 worker 事实

状态视图要求当前信封仍为 queued、带精确恢复标记，且没有 live/ready/succeeded worker。命中时忽略本次 `task_missing_local_openspec` 并将该尝试继续投影为待派发；一旦 worker 接受输入或信封进入 running，原失败闭合规则自动恢复。

## Risks / Trade-offs

- **[重放结果仍不可解析]** → 保留原错误并失败闭合，不猜测信任状态。
- **[历史失败被误判为当前恢复]** → 只检查当前 Task 的 worker 与 queued 信封中的固定标记。
- **[恢复标记残留]** → running 信封和已接受输入的 worker 事实优先，标记不再触发豁免。

## Migration Plan

无迁移。回滚代码与 delta 即恢复原行为；历史运行台账中的未知 `issueRefs` 仍按普通引用处理。
