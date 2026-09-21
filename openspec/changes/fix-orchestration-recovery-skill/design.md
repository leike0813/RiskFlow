# Design

## Context

见 `proposal.md`。控制器已经集中处理 revision、幂等回执、runtime lock 与 Orca 调用，但工具注册在扩展和 doctor 中重复维护；`reconcile` 只存在于 CLI，消息回复没有受控入口，cleanup 也没有终态 terminal 的安全收口步骤。状态投影拥有完成这些动作所需的事实，无需新增持久化或依赖。

## Goals / Non-Goals

**Goals:**

- 用现有控制层补齐工具面和恢复闭环。
- 让 stale 清理与 reconcile 保持 fail-closed。
- 将稳定操作方法压缩为一个项目级、模型可调用 Skill。

**Non-Goals:**

- 不清理历史 diagnostics，不修改执行图或业务 change 队列。
- 不增加通用 Orca 代理、后台守护进程或新的状态存储。
- 不让 Skill 绕过实时状态、revision、幂等键和项目手册。

## Decisions

### D1：工具名由控制器导出，扩展与 doctor 共用

把七个受控工具名作为控制器的公开常量，OMP 扩展据此完成注册完整性检查。具体 schema 仍靠各工具注册处定义，不增加第二套注册框架。

### D2：reply 复用 controlledMutation

`riskflow_reply` 使用与其他写操作相同的 revision、幂等回执和 runtime lock，绑定当前 checkpoint 的 Run，并调用 Orca 原生 message reply。输入固定为 `workItemId`、`expectedRevision`、`idempotencyKey`、`messageId`、`body`。

### D3：reconcile 安全集合只按违规 code 判定

删除“违规属于目标节点即可绕过”的条件，仅保留 `checkpoint_mismatch` 与 `worktree_reclaim_pending`。这样恢复能力不再成为 duplicate writer 或身份冲突的后门。

### D4：stale cleanup 是两段式精确操作

控制器先验证归档、主线验证、干净工作树、成功 settled checkpoint、无违规和非空 handles，再逐个关闭精确 terminal。随后重新采集状态，只在目标变为 `reclaimable` 时调用既有完整 ID 回收；不使用 force。`reclaimable` 原路径保持直接回收。

### D5：冷启动只投影实时摘要

OMP 上下文在既有 `resumeQueue` 之外增加 violations、stale 和 diagnostics 摘要；状态层把已知失败 worker/终态 terminal 阻塞映射为具体受控动作。摘要不复制完整手册，Skill 负责流程说明。
辅助 worktree 只有在 HEAD 已进入 main 且工作树干净时才把 ancestry 当作 merge 证据，避免新建后尚未形成首个检查点的 dirty worktree 跳过 adopt。

### D6：Skill 保持单文件

`.agents/skills/riskflow-orchestration/SKILL.md` 直接包含冷启动、状态分流、七个工具、幂等与事件循环；长篇稳定职责仍链接 Handbook/Runbook。没有可复用脚本或 UI 元数据，因此不创建 `references/`、`scripts/` 或 `agents/openai.yaml`。

### D7：wait 由下一次调用确认上一批 Delivery

`riskflow_wait` 透传可选 `ackDeliveryId` 到 Orca `check --ack`。首次 wait 不自动确认当前返回值；协调者处理完整批次后，在下一次 wait 同时确认前一批并等待后续消息。这样不增加本地游标存储，也不在消息交给调用方前丢失 Delivery。

### D8：Codex 派发先预热 terminal，再绑定 worker

Planning、Finalizer 和 Targeted Auditor 不再让 `worker-start --agent codex` 隐式创建首次 terminal。控制器先以 Manifest 模型和强度创建 Codex terminal、等待 `tui-idle`，再通过 `worker-start --terminal` 绑定当前 queued Task。遇到工作区信任提示时返回精确 handle；操作者确认后以新幂等键和 `terminalHandle` 重入，控制器复用同一 Task 与 terminal。该路径不自动操作信任提示，也不增加信任状态存储。

### D9：独立 Task 隔离 session，审计在自身任务内闭环

每个独立 Task 创建新的 Agent session；已结束、失败、暂停、释放或闲置上下文不承接后续 Task。首次信任确认位于 worker-start 前，因此同 queued Task 复用预热 terminal 不违反该边界。活动 Agent 只通过事件循环驱动，除 question、escalation、连接/进程故障或用户指令外不追加输入、不停止或释放。

Targeted Auditor 若发现已批准范围内的普通缺陷，在自己的活动 audit Task 内修复、回归并更新 verification。audit 结束仍未闭合时状态转为 `paused` 并升级用户，不再派 Finalizer 或第二次 audit。这保留“一轮一次审计”，同时不依赖不可见的旧 Finalizer 上下文。

### D10：同 Task 的 live Dispatch 优先于历史失败记录

Orca 可能保留同一 Task 的旧 failed Dispatch 与当前 live Dispatch。状态只在该 Task 不存在 live worker 时才把失败记录映射为 reconcile；否则按当前运行态继续，避免陈旧记录制造假死锁。

## Risks / Trade-offs

- **关闭 terminal 与状态刷新之间发生并发变化** → 重新采集并要求 `reclaimable`，否则停止回收。
- **Orca reply 目标失效** → 原始错误通过结构化控制错误返回，幂等回执阻止重复发送。
- **Skill 与代码漂移** → doctor 的工具清单测试、文档评审和 Skill 快速校验共同约束；运行事实仍以 `riskflow_status` 为准。
- **Delivery 未确认导致同批重放** → 下一次 wait 显式携带上一批标识，先 ack 再等待。
- **Codex 首次信任提示被算作 worker 失败** → 在 worker-start 前创建并检查 terminal；提示未处理时保留 queued Task 和精确恢复 handle。
- **旧 session 被当作廉价续跑路径** → 独立 Task 强制新 session；只有同一活动 Task 内允许连续修复。
- **旧 failed Dispatch 覆盖当前 live Dispatch** → 先检查同 Task 是否仍有 live worker，再判定失败恢复。

## Migration Plan

该变更只扩展控制器和文档。合入后先运行 doctor 与调度测试，再由协调端使用受控 integrate 完成主线验证、归档和精确回收；回滚时整体回退该提交即可，不迁移数据。
