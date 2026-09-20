## Why

C25 将形成可重放的评估记录和确定性触发事实，但当前系统还不能把这些事实收口为不重复的预警、持续跟踪的处置任务和可靠的应用内通知。C26 需要在不复制 P/C、矩阵、阈值判断及幂等基础设施的前提下，补齐 RA-S6 从评估事实到人工接管的可审计出口。

## What Changes

- 新增 `warning` 子模块，只消费 C25 已持久化评估记录中的确定性触发事实；按触发类型形成不可变预警，同一评估与触发类型的重试或并发提交不产生重复预警。
- 按工程、稳定风险身份与处置空间范围归集未关闭的处置任务；持续越限及多个触发类型追加到同一任务，已关闭任务不再复用。
- 实现已归档公共契约中的 `acknowledge` 命令：确认只记录已读和接管，不修改预警、评估或任务的风险解除状态。
- 在预警事实、处置任务、通知意图、审计、命令回执和 Outbox 事件可靠入库后，由 Worker 异步投递应用内通知；投递失败可重试并留痕，但不回滚或改写预警事实。
- 复用 C03 的事务、命令幂等、Outbox 与幂等消费者，复用 C06 授权、C07 审计及 C09 HTTP 壳层；不新增触发算法、幂等子系统、外部通知渠道或 Web 业务页面。

## Capabilities

### New Capabilities

- `domain/warning-tasks-and-in-app-notification`: 定义预警事实去重、处置任务归集、已读接管确认、可靠通知意图及应用内投递的行为边界。

### Modified Capabilities

无。

## Impact

- 受影响代码：`packages/core/src/warning/`、`packages/adapters/src/warning/`、`packages/adapters/src/postgres/migrations/000044_*.ts`、`apps/worker/src/warning/` 及对应测试与包内导出。
- 公共 API：直接实现现有 `WarningResponsePortV1.open/record`、`warning.warning-recorded.v1`、`warning.warning-acknowledged.v1` 和 C09 已登记 HTTP 路由；不修改 `packages/contracts` Schema。
- 上游依赖：C25 必须先提供其批准工件定义的持久化评估记录；C26 以私有窄读端口按精确引用投影触发上下文，不修改 C25 事实或读取可变“最新值”。
- 数据与运维：仅使用分配号段中的迁移 `000044`；`000045`–`000047` 保留。中央迁移登记及测试清单由主调度检查点处理，不属于本 change。
- 依赖治理：不新增、升级或删除依赖，不修改根 workspace、锁文件、依赖政策或 `openspec/config.yaml`。
- 追踪：覆盖 RA-S6，并把评估记录继续连接到预警、处置任务、确认、通知投递与审计链；G2.5 验收夹具覆盖标准风险到预警审计出口，G3 关注 Outbox 重投不复制事实。
