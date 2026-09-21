## Why

C26 已把确定性评估触发事实保存为预警和处置任务，但当前系统不能从已审核措施库形成可追溯的处置建议。C27 补齐 RA-S7 的候选、受限 Agent 组合排序和三项确定性校验，使合格建议可以入库，现场采纳仍由人决定。

## What Changes

- 从 C18 精确发布的措施库，按 C26 处置任务关联的风险事件、适用性快照和预警触发类型冻结候选；候选为空或依据不完整时显式失败，不补默认措施。
- 为 `response-recommendation` 注册 C08 有界 Agent 任务，Agent 只能对冻结候选组合和排序，并以类型化增量交付候选版本；任务失败不产生正式建议。
- 实现既有 `RecommendationCommandV1` 的 `create-candidate` 与 `validate-and-record` 分支，确定性执行触发指标一致性、规范合规性、现场资源与工序可执行性校验；失败候选保留证据并进入复核，不能被人工决定强制转为正式建议。
- 原子保存通过校验的公共 `ResponseRecommendation`、精确来源和版本、命令回执及审计；正式建议不等于采纳、现场执行或任务关闭。

## Capabilities

### New Capabilities

- `domain/response-recommendation`: 定义措施候选冻结、受限 Agent 增量、三项确定性校验、正式建议持久化和人工采纳边界。

### Modified Capabilities

无。

## Impact

- 主要实现范围：C27 自有 `recommendation` core/adapters 子模块、相应测试与 PostgreSQL 迁移；复用 C18 措施库、C26 预警和处置任务、C08 Agent 任务、C07 复核审计、C03 事务及 C06 授权。
- 公共接口：使用已归档的 `RecommendationCommandV1`、`RecommendationResultV1`、`ResponseRecommendationSchema`、`ResponseRecommendationRefV1` 及既有 capability，不修改 `packages/contracts` 或其它 change 所有的公共 Schema。
- 依赖治理：不新增、升级或删除第三方依赖，不修改锁文件；迁移只追加到既有序号与路径约定。
- 追踪：覆盖 RA-S7，并沿评估记录 → 预警 → 处置任务 → 冻结措施候选 → 正式建议保存精确引用、版本与审计；采纳、执行、反馈及偏差由后续 change 承接。
