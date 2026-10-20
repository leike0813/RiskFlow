## Why

UI 重做的 CH-1 设计系统、CH-2 壳层接缝和 CH-3 总览已经归档，工程域仍以五个只读页面和分散的管理入口承载日常工作。CH-4 需要把工程上下文、资料与监测、成员与访问、工程开通及接入处理事实组织为可独立验收的工程工作区，保全已有精确版本、授权与原件读取。

## What Changes

- 改造 `/projects`、资料目录/详情、监测入口/详情，使用生产设计系统、区域组合与业务用语；工程内页签统一来源，迁移生产内部 `/project/*` 调用方，已知旧地址永久精确解析。
- 补齐工程开通、工程上下文/空间区段修订、成员与资料访问、接入任务承载。工程开通与既有系统管理共用实现，系统管理员不因此获得工程业务权；业务修订与访问命令继续由原领域所有者执行。
- 核实并闭合真实缺失的公开窄读/命令接缝，不把部署 CLI 或内部 adapter 方法当作 Web 已有接口，不新建工程、权限或处理任务的平行事实。
- 资料原件仍为默认内容，解析清洗、监测批次/快照与可选清洗任务各按所属正式事实展示；缺少 Agent 权不阻断有权的资料读取。
- 用真实 Cookie、HTTP、PostgreSQL 和 Chromium 验收新承载、角色隔离、历史深链、取消/重试/并发及桌面缩放；不提前发布 CH-9 六导航、搜索或停靠组合。

## Capabilities

### New Capabilities

无。能力按行为所有权保持稳定，不为“工程”菜单建立新近义 capability。

### Modified Capabilities

- `web/engineering-and-knowledge-ui`：解除工程域的全局只读限制，定义工程工作区、上下文维护、成员访问及接入事实承载；知识治理与工序业务页不随本 change 改造。
- `domain/engineering-context-source-registry`：为已实现工程/区段修订及登记接入事实提供必要的有界公开接缝，保持不可变版本和原领域事务。
- `platform/local-identity-project-authorization`：明确工程工作区对已有工程管理、空间与资料访问能力的当前权限和有界目录使用，不新增角色或扩大系统管理员业务权。
- `platform/http-command-query-sse-shell`：登记上述工程窄接缝的严格 HTTP 契约、Cookie 身份注入和正式组合。

## Impact

- 生产改动预期位于 `apps/web` 工程页面/API/路由，`packages/contracts` 的相关窄接缝，C06/C11 所属 core/adapter，`apps/api` 及正式部署/浏览器组合；精确清单和现有符号由 implementation-plan 固定。
- 直接前置：已归档 `establish-web-design-system`、`prepare-web-shell-route-and-access-seams`；衔接已归档 `deliver-risk-overview-dashboard` 的资料/监测入口，不改总览统计和权限口径。
- 不新增依赖、角色、配置开关或数据库迁移，不修改锁文件，不复制业务 Schema，不重写历史资料、修订、授权、任务或审计。
- RI-S1/RI-S2/RI-S14：工程资料、接入事实、证据及当前权限；RA-S1：三维适用性与工程/空间精确版本。识别、P/C、风险矩阵、阈值、处置与治理发布规则保持原契约。
- 不实施浏览器文件上传、通用外部连接配置或新的解析/清洗启动流程；这些不属于本次新增四个承载页面的交付。资料接入在本包展示已有登记过程与正式结果，不以假上传按钮冒充新通路；既有部署投料流程继续由原所有者执行。
