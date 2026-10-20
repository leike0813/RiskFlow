## Why

UI 重做 CH-1 设计系统与 CH-2 公共壳层／授权接缝已归档，下一工作包是 CH-3。当前 `/overview` 只有评估／预警摘要与 C31 逐运行报告分页，不能提供业务地图已决定的工序分布、真实变化时间线、待办摘要与资料／监测接入概况；前端拼页既不能得到完整统计，也会重复实现授权。

## What Changes

- 新增 B-1 服务端仪表盘读面，由事实所属模块按当前工程、空间与当前对象可见性提供统计及有界变化流，组合层不读跨域私表、不重新评分、不调用模型。
- 在 `/overview` 交付态势分布、风险／评估／预警变化时间线、三类待办摘要和资料／监测接入概况；沿用 CH-1 图表、CH-2 区域与七态。每来源独立返回成功、空、拒权或故障，不把缺权／失败计为零。
- 上传资料与监测入口连接现有真实承载，不新增接入命令或假上传表单；只有真实来源和合法动作可以展示入口。
- 将 `/review-audit/runs` 及其已知 `/review/runs` 别名原子切换到 `/overview?tab=runs`，完整承接识别运行与链运行的独立分页、精确工程修订及历史查询身份；迁移所有生产内部调用方，删除重复旧页面实现，永久保留旧地址解析。
- 保留原 C31 `risk-overview`、报告导出及历史查询重放；不把新仪表盘当历史报告，不合并不同口径为风险事件总数。
- 不实现 CH-9 四来源待办明细、搜索、助手组合或最终六导航；不提前切换旧复核队列，不实施 CH-4～CH-8 页面重做或 CH-7 关闭状态机。

## Capabilities

### New Capabilities

- `web/risk-overview-dashboard`：仪表盘区块、服务端聚合口径、独立来源状态、变化分页、接入入口、运行历史承接及真实验收。

### Modified Capabilities

- `domain/module-interfaces-events-workflows`：增加与 C31 历史投影分离的仪表盘用例级读取，明确所属事实聚合、权限裁剪、稳定分页和无业务写入。
- `web/assessment-warning-and-response-ui`：将既有风险态势要求接到新仪表盘，保留原摘要含义、当前时点与历史运行投影的独立口径。
- `web/agent-audit-and-operations-ui`：运行摘要迁到总览运行位置，保留识别／链运行独立读取、原精确版本和审计／证据分工。

## Impact

- 前置：已归档 `2026-10-19-establish-web-design-system` 与 `2026-10-19-prepare-web-shell-route-and-access-seams`。代码施工图固定基线 `292e3aa4d32f5def1b9926fcb5c657d78ea0bb01`，起始工作区 clean。
- 生产影响：`packages/contracts` 唯一仪表盘 DTO 与端口、`packages/core` 所属读模块与聚合用例、`packages/adapters` 所属 PostgreSQL 聚合、`apps/api` 闭合 HTTP 注册与生产组合、`apps/web` 查询／总览／路由／内部链接；调用方、测试、夹具和部署接线详列于 implementation-plan。
- 权限：入口资格不替代各来源读权，不要求权限交集，不扩大 reviewer 的 Agent 权限。统计不生成个人分派、风险等级、来源关联或不存在的关闭事实。
- RI-S5～RI-S6／RA-S3～RA-S7 仅呈现已经成立的业务事实及其精确引用，不改变专利计算、人工决定、领域 Schema 或硬预算。
- 无新第三方依赖、安装、模型服务或搜索索引；不改锁文件。迁移与持久化取舍在 design 固定，不留给实施者临时决定。
- 本轮只起草 apply 前置工件，不实现、提交、归档或提前创建 verification；实现后真实 PostgreSQL／HTTP／浏览器及权限限定审计才形成交付证据。
