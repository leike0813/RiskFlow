## Why

C07/C08 已建立人工复核和有界 Agent 运行时，C31 已提供追溯与报告数据投影，C32–C34 已在 `demo/` 接通业务界面，但 Agent 仍显示静态回答，统一审计、报告导出和系统管理尚无可交付入口。C35 复用 `demo/v2` 的页面设计，将这些能力接到真实会话、版本、权限与耐久事实。

## What Changes

- 在既有 `demo/` 应用中复用 v2 的 Agent 三类视图、复核详情/运行/审计、报告和五个系统管理页面；沿用现有 React Router、会话恢复、工程上下文、证据抽屉、查询取消和命令确认。保留七项业务导航，Agent 与系统管理从外壳辅助入口进入。
- 为 C08 增加有界、授权的任务目录与详情读面，公开安全的工具行动、预算、增量校验和提案摘要；停靠栏与全屏共享一个任务选择和请求生命周期。启动、恢复、取消、确认只调用既有类型化命令，不增加通用聊天或工具执行入口。
- 复用 C33 队列和 C07 五类决定，补齐精确复核详情；识别修正使用已生成的修正候选引用，不直接编辑已发布记录。运行、审计与业务追溯各自保持所属事实和独立分页。
- 补齐 C07 只读活动明细，避免把现有 `trace` 返回的审计引用误当作可渲染时间线。报告复用 C31 登记投影与已有 `projection.export` 契约，生成真实、可重复读取的 JSON 工件；不以浏览器打印或静态 PDF 冒充系统报告。
- 用服务端当前系统管理员身份开放 C06 六项账号/工程管理动作；不从空业务能力集合推断管理员。数据源页读取现有登记元数据，模型页读取已部署的安全策略引用，健康页读取显式注入的有界健康快照。备份恢复页明确能力未接入，执行协议归 C37。
- 清除被替换界面的静态业务事实和假操作；v2 原件、审阅工具、fixture、契约镜像与状态注入只作为设计资料，不进入交付应用。

## Capabilities

### New Capabilities

- `web/agent-audit-and-operations-ui`：Agent 共享任务视图、统一复核/运行/审计、报告工件与最小系统管理界面及真实浏览器验收。

### Modified Capabilities

- `platform/unified-bounded-agent-runtime`：任务目录/详情与安全提案、工具行动、预算和校验只读投影。
- `platform/review-and-audit-runtime`：精确任务详情与业务/安全/拒绝活动的有界分页读面。
- `platform/local-identity-project-authorization`：基于当前会话的系统管理授权及安全目录读取；沿用六项管理命令和既有权限语义。
- `platform/http-command-query-sse-shell`：登记 C35 窄读、系统管理、健康与报告工件读取路由。
- `domain/module-interfaces-events-workflows`：C35 只读端口、报告策略/工件与可重放导出接缝。

## Impact

- 路线节点：C35 `deliver-agent-audit-and-operations-ui`；Manifest 直接依赖 C07/C08/C10/C31 均已归档。复用已归档 C06/C09/C32/C33/C34 和当前会话修复事实，不修改执行图。
- 实施基线：`08a3fed121635895dd4edb2f8c51cf689936d912`。当前分支为 `fix/production-assessment-seams-and-session-restoration`；起草不等同于受控派发或实现批准。
- 所有权：`demo/src/{agent,api,components,pages}`、相关 browser 验收、公共 contracts、C06/C07/C08 所属 adapter 的窄读与 C31 导出、API 闭合目录。完整文件清单与稳定 IP-ID 见施工图。
- 不引入第三方依赖、不变更锁文件。报告登记复用 C03 命令回执与 C04 工件；目录、游标和快照复用现有数据及索引，不新增表或迁移。
- 横切 RI-S1–RI-S6、RA-S1–RA-S7：保留资料段→工序→机理→风险→评估→预警→建议→偏差/校准的精确引用；不重算 P/C、不改矩阵/阈值、不改人工决定或 Agent 预算。
- Non-goals：自由文本通用 Agent、第二套持久化会话、模型/提示/工具/预算发布与切换、连接配置或探测、原始日志浏览、备份/恢复执行、PDF/DOCX 生成、正文下载、生产应用迁移及部署架构。报告的 MVP 格式为可审计 JSON；其它格式和 C37 运维能力必须另有批准契约后接入。
