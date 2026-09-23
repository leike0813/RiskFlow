## Why

C15/C17/C20/C21/C22 的识别链和 C25/C27/C29 的评估链已经有可追溯结果，但尚无统一、可重现的质量评估及跨页面真实浏览器验收证据。C10 将浏览器设施留给 C36，C14 将页面查询投影留给消费方；本 change 按批准记录 `approval://riskflow/C36/scope-2026-09-23-quality-evaluation-and-browser-acceptance` 闭合这两项接缝。

## What Changes

- 新增质量评估：对冻结数据集与精确运行结果计算识别准确率/精确率、覆盖度、跨来源一致性、评估可重放率和审计链完整率，保留分母、失败项、适用性快照及规则/配置版本；结论只引用 C04 证据工件和实际执行命令。优先真实脱敏样例；当前无甲方真实样例时明确标记“合成样本，待甲方复核”，不得外推为真实准确率。
- 新增 C36 自有页面查询投影及获授权读路径：在既有 `projection.query` 上仅增加 `quality-evaluation` 查询类型，支持按项目修订有界列表与精确报告引用查询；结果保留原 `queryResultRef`，仅附加有界 `qualitySummaries`/`nextCursor`。摘要只含工程、报告/数据集精确引用、样例类别、指标分子分母与值、证据引用和时间，不含领域正文；按 C06/C09 最小授权查询，不直读其它模块私表，索引只追加。旧 queryType 的请求与结果不变。
- 为跨页面/跨能力验收新增真实 Chromium 浏览器设施与可运行命令，覆盖登录、页面导航、投影读取、工程切换、拒权及证据可见性；不以 Mock 浏览器或 Mock 后端作正式证据。
- 测试期新增根目录 `devDependency`：`@playwright/test@1.63.0`，用于驱动真实 Chromium 和生成可复核 trace。仅在真实浏览器验收不再由本仓库执行、且等价设施已接管时移除；不进入生产运行时依赖。浏览器二进制按该版本固定并由测试环境单独供给，锁文件由主调度按批准设计串行处理。

## Capabilities

### New Capabilities

- `quality/evaluation-and-browser-acceptance`：冻结样例质量评估、C36 页面查询投影与真实浏览器跨能力验收。

### Modified Capabilities

无。C10/C13/C14、C02/C06/C09 的既有行为语义保持；仅在现有 `projection.query` 中增加 C36 所需的闭合查询类型与只读结果形状。

## Impact

- 依赖归档的 C04、C10、C13、C14、C15、C17、C20、C21、C22、C25、C27、C29 及其公共接口；不承担 C37/C38 的硬件 SLA 或后续交付。
- 计划触及 `packages/core` 的质量计算/Schema、`packages/adapters` 的 C36 投影索引与 C04 接线、`packages/contracts` 的最小加法、`apps/api` 的既有闭合查询接线、`apps/web` 的质量页面、根脚本/锁文件与浏览器测试。投影持久化与 migration 仅为 C36 自有索引；不改上游私表及既有公共契约语义。
- 无新增 capability、角色或权限值，无生产运行时依赖；正式质量结果依赖 C04 工件与 C03 审计/事务收口。
