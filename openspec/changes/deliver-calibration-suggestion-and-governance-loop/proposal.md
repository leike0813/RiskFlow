## Why

C28 已能形成超限偏差事实，但系统尚不能把该事实转化为受控的校准建议、人工复核结论和可继续治理的配置草案。C29 需要闭合 RA-S7 的校准入口，同时保持 Agent 只提出候选、确定性模块校验、人工批准后仅创建草案的治理边界。

## What Changes

- 从已授权读取的 C28 私有偏差事实确定性派生公开偏差记录引用，仅对超限事实启动 `calibration-suggestion` 有界 Agent 任务。
- 以冻结的评估依据和目标定义版本约束类型化校准操作；确定性校验建议的目标、证据、版本和完整候选文档，Agent 不直接修改已发布配置。
- 复用既有 `create-calibration-suggestion` 命令、C07 复核运行时、C03 事务/Outbox 和 C16 `submit-revision`，幂等保存校准建议、公开偏差记录及治理草案关联。
- 为 C07 增加窄化、只读且加法式的校准建议批准证明查询；未取得与建议、复核任务和决定精确绑定的证明时，拒绝创建配置草案。
- `approve-draft-creation` 只创建 C16 未发布修订；发布、回滚和知识修订复核继续由既有治理流程及人工决定负责。

## Capabilities

### New Capabilities

- `domain/calibration-suggestion-and-governance-loop`: 定义超限偏差到校准建议、人工复核、公开偏差记录和配置草案的可审计闭环。

### Modified Capabilities

- `platform/review-and-audit-runtime`: 增加校准建议批准证明的窄化只读契约，并明确无有效证明不得创建配置草案。
- `domain/module-interfaces-events-workflows`: 增加专用、向后兼容的校准建议决定证明只读端口，保持现有复核审计端口、命令和事件签名不变。

## Impact

- 影响 `packages/contracts` 的加法式复核查询契约、`packages/core` 的校准领域服务、`packages/adapters` 的 PostgreSQL 持久化与迁移，以及相应的契约、领域和适配器测试。
- 复用 C28 偏差事实读取、C08 有界任务、C07 复核、C03 事务/Outbox、C16 定义治理及 C18/C19 严格配置 Schema；不引入新依赖，不增加角色、能力或权限枚举，不修改既有命令或端口方法签名。
- 追踪 RA-S7，并延续偏差事实、建议、复核决定、修订草案和审计证据之间的版本化可重放链路。
