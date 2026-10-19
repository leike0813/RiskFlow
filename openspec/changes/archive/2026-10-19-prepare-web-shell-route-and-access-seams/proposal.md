## Why

CH-1 `establish-web-design-system` 已归档，但生产壳层仍以七导航、单值骨架和旧停靠集合组织页面，路由模板交集与实际读面授予尚未闭合。CH-2 必须先提供可被后续业务 change 消费的布局、路由及授权接缝，同时保全现有入口、精确版本与人工决定，不能先发布无目标承载的六导航。

## What Changes

- 将目标六导航及待办／助手结构落实为壳层契约和分阶段发布责任；CH-2 运行时保留现有七个入口、旧复核与处置承载，不提前启用 CH-3～CH-9 的业务重定向。
- 正式启用生产尺寸令牌对应的 152px／48px 左栏、22rem 可收起右栏和桌面缩放约束；不采用原型自动换列、自绘标题栏或移动端布局。
- 以有序区域块组合替代单值页面骨架元数据，复用现有 PageFrame、七态、页面组件及领域所有权，不建立数据驱动页面引擎。
- 修正完整逐段匹配及首个差异段静态优先、相同形状模板注册冲突，约束别名只作用于已登记模板，保持查询参数及精确身份。
- 核对实际导航→branch→能力→角色→前端投影链，只修缺失读面授予；新增独立 `review-todo.read` 聚合入口权限，不授予任何来源对象权限，不增加 reviewer 的 Agent 权限。聚合查询及数据契约归 CH-9。
- 统一生产确认控制器和对话框，移除 ConfirmButton 内第二套确认状态；冻结载荷、原身份重试、工程／路由／认证失效、系统管理及 Agent 类型化确认全部保留。
- 对原四个 web capability 作局部 delta，导航、组合骨架与停靠契约统一引用 shell；不搬迁领域能力或重写业务 Schema。

## Capabilities

### New Capabilities

无。复用既有能力；搜索、待办聚合及新仪表盘不在本 change。

### Modified Capabilities

- `platform/web-shell-interaction-primitives`：分阶段六导航、区域组合、目标布局、独立停靠授权、精确路由和统一确认。
- `platform/local-identity-project-authorization`：版本化默认角色读面授予、独立聚合入口能力及当前能力呈现，不改变系统管理员无业务特权和来源授权边界。
- `platform/http-command-query-sse-shell`：提供独立工程入口能力呈现，不把能力塞入原会话自省或当作正式授权凭据。
- `web/engineering-and-knowledge-ui`：组合骨架与导航验收引用公共壳层，工程／知识原查询、证据与版本边界不变。
- `web/identification-and-review-ui`：组合骨架与入口引用公共壳层，旧复核及历史精确读取在 CH-9 切换前保留。
- `web/assessment-warning-and-response-ui`：页面组合引用公共壳层，CH-6／CH-7 就绪前保留评估、矩阵和处置入口及原命令。
- `web/agent-audit-and-operations-ui`：取消固定七导航重复约束，辅助入口及停靠独立授权引用公共壳层，Agent、复核、审计及管理原语义不变。

## Impact

- 固定代码基线：`f2561cdcc0a5f9b6bfa5fec4302382e9421575ae`。构建前置仅 CH-1；CH-3～CH-9 的业务迁移、聚合、搜索、领域状态机和最终组合发布不属于本 change。
- 生产影响：`apps/web` 路由、壳层、PageFrame、确认调用方与权限投影；`packages/contracts` 能力映射、`packages/core` 角色策略及其真实传输接缝。精确文件和符号由 implementation-plan 固定。
- 不新增或升级依赖，不改锁文件；不改变 P/C、风险矩阵、Agent 预算、审计持久性及领域记录。Electron 继续加载同一 HTTPS Web，桌面宿主不另建业务界面。
- RI-S6／RI-S14、RA-S1～RA-S7 为横切追踪：工程／资料当前权限、精确版本、人工确认、证据脱敏与历史链路必须保留。本轮仅规划；实现与真实业务验收不冒充已完成。
