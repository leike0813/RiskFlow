# platform/web-shell-interaction-primitives Specification

## Purpose
为 RiskFlow 提供无业务事实的 React Web shell 与一致交互原语，使后续领域页面只能在固定导航、上下文、权限、确认、证据、Agent、可访问性和 C09 传输边界内组合。

## Requirements

### Requirement: Web shell 必须提供七项业务导航与闭合路由

系统 MUST 提供“风险态势、工程项目、风险识别、风险评估、预警处置、知识与规则、复核与审计”七项且仅七项一级业务导航。业务根路由 MUST 分别为 `/overview`、`/projects`、`/identification`、`/assessment`、`/warnings`、`/knowledge`、`/review-audit`；会话路由只允许 `/login` 与 `/change-password`，`/` 在已认证且上下文可用时进入 `/overview`。Agent MUST 只作为右侧停靠面板出现，系统管理和后续业务详情不得由 C10 预建路由。

#### Scenario: 七项导航与路由一一对应

- **WHEN** 已认证用户进入 Web shell
- **THEN** 页面按固定顺序显示七项一级业务导航，每项只指向对应根路由
- **AND** 不显示第八项 Agent 导航、系统管理导航或规格外页面入口

#### Scenario: 未交付根页面不伪装业务能力

- **WHEN** 用户打开尚无后续 feature contribution 的合法业务根路由
- **THEN** shell 显示不含业务数据和写操作的不可用页状态
- **AND** 不生成风险数量、任务、图表、通知、示例事实或 Mock 操作入口

#### Scenario: 未登记路径安全失败

- **WHEN** 用户打开白名单外路径或尚未登记的业务详情路径
- **THEN** shell 显示不披露目标存在性的统一未找到页并保留七项导航
- **AND** 不猜测相近路径、不动态加载任意模块或调用通用后端入口

### Requirement: 工程空间工序上下文必须原子切换

Web shell MUST 维护版本化界面上下文，至少包含当前工程标识、可选空间区段精确引用、可选工序节点标识和只增的上下文修订号。工程/空间/工序切换 MUST 停留在当前合法页面，原子替换上下文并重新加载当前页面；不得把旧工程对象状态带入新上下文，也不得由 C10 推断工程层级、适用性元数据或工序事实。

#### Scenario: 切换工程清除旧内容

- **WHEN** 用户从一个工程切换到另一个获准工程
- **THEN** shell 在发起新查询前清除旧页面内容、空间区段和工序选择并增加上下文修订号
- **AND** 旧工程名称、对象、错误、证据或 Agent 自动上下文不在新工程加载期间闪现

#### Scenario: 切换空间或工序保持页面

- **WHEN** 用户在同一工程内切换获准空间区段或工序节点
- **THEN** 当前 pathname 保持不变并以新上下文重新加载页面 contribution
- **AND** 浏览器深链只表达经过共享 Schema 校验的标识/精确引用

#### Scenario: 无工程上下文时阻止业务页面读取

- **WHEN** 已认证用户尚未获得或选择可用工程
- **THEN** 七项导航可见但业务根页面显示工程上下文空态
- **AND** shell 不向 C09 构造空字符串、默认工程或跨工程查询

### Requirement: 五类页面骨架必须共享有限视图状态

系统 MUST 提供 A 列表页、B 对象详情页、C 运行监控页、D 治理与版本页、E 复核工作台五类结构骨架。每类骨架 MUST 使用同一闭合视图状态集合：`idle`、`loading`、`ready`、`empty`、`error`、`forbidden`、`unavailable`；状态变化不得保留与当前上下文不匹配的旧内容。

#### Scenario: 加载不闪烁为空态

- **WHEN** 合法页面开始加载且结果尚未返回
- **THEN** 页面显示与骨架相符的忙碌占位并向辅助技术标记加载中
- **AND** 不先显示空态、旧数据或虚构默认内容

#### Scenario: 空态只给真实下一步

- **WHEN** 获授权查询成功且返回业务定义的空结果
- **THEN** 页面显示空态及由 owning feature 提供的真实下一步
- **AND** 若没有已登记命令，空态不自行生成操作按钮

#### Scenario: 技术异常只显示安全摘要

- **WHEN** 页面收到 C09 安全错误信封或未分类传输失败
- **THEN** 页面只显示稳定错误代码、可重试性、请求关联标识和获准引用，并在可重试时提供重试
- **AND** 不显示堆栈、SQL、凭据、Cookie、原始 payload、证据正文、模型响应或内部文案

### Requirement: 权限态必须与业务不可用态和隐匿态分离

共享操作 MUST 使用闭合可用性状态表达“可执行、无权限、业务状态不可用、不可披露”。已知操作无权限时 MUST 使用原生 disabled 控件并说明所需能力；业务状态不可用 MUST 说明业务原因；跨工程、无目标可见性或服务端要求隐藏时 MUST 不渲染目标及其操作。客户端权限态只用于呈现，所有读取与写入仍由 C09/C06 服务端授权。

#### Scenario: 已知操作无权限

- **WHEN** 页面可披露某操作但当前授权投影不含所需能力
- **THEN** 操作保持可发现但不可聚焦提交，并通过可访问说明给出所需权限
- **AND** 点击、快捷键或脚本事件均不调用确认处理器或 C09

#### Scenario: 业务状态暂不可用

- **WHEN** 用户具备权限但对象状态或精确版本不允许命令
- **THEN** 操作置灰并显示 owning feature 返回的结构化业务原因
- **AND** 不将其误报为权限拒绝或自动迁移到当前版本

#### Scenario: 不可披露目标被隐藏

- **WHEN** 服务端不能向调用方区分目标不存在与无权访问
- **THEN** shell 显示统一拒绝/未找到状态，不渲染目标名称、数量、版本、证据或权限提示
- **AND** 不从缓存、URL、错误文案或停靠区泄露目标存在性

### Requirement: 右侧停靠区必须统一承载上下文与 Agent 面板

Web shell MUST 提供可收起的右侧停靠区，仅含“上下文”和“Agent”两个互斥面板。上下文面板 MUST 允许 owning feature 注入证据定位、版本与审计摘要、关联对象槽位；Agent 面板 MUST 允许 C35 注入同一任务/会话的只读视图。停靠区开合和活动面板可跨白名单页面保持，但不得持久化业务正文、创建第二套 Agent 会话或在页面切换时复制事实。

#### Scenario: 跨页面保持停靠状态

- **WHEN** 用户打开 Agent 面板后切换到另一合法业务根路由
- **THEN** 停靠区继续打开同一面板并更新当前页面上下文摘要
- **AND** 会话、任务和证据数据仍由 owning feature 的精确引用提供

#### Scenario: 无资料正文权限的证据脱敏

- **WHEN** 用户可见证据定位但没有来源资料正文权限
- **THEN** 上下文面板只显示资料名称、章节路径、资料段标识等获准定位摘要和固定脱敏提示
- **AND** 不显示原文、监测正文、相邻片段或“加载失败”造成的歧义

#### Scenario: 未接入 Agent 功能

- **WHEN** C35 尚未注册 Agent contribution 或当前用户不可使用 Agent
- **THEN** Agent 面板显示不可用/权限态且不提供对话输入、任务启动或写命令
- **AND** shell 不调用模型、不生成降级回答或维护本地伪会话

#### Scenario: Agent 只展示获准的可审计内容

- **WHEN** C35 注入当前用户可见的 Agent 会话或任务摘要
- **THEN** 面板只承载冻结上下文、策略/版本、工具、预算、类型化增量、确定性校验、证据和领域结果引用
- **AND** 不提供模型内部思维链、原始模型正文或第二套领域结果字段

### Requirement: 写命令必须经过统一确认原语

任何会产生业务事实或外部副作用的 UI 操作 MUST 在提交前展示确认卡或模态确认对话框，至少包含工程、目标对象、精确输入版本、预计生成的事实、外部副作用和所需权限。高影响命令 MUST 要求额外显式确认；取消或关闭不得提交。交互式 Agent 写命令 MUST 绑定 C08 `CommandProposalRefV1` 并只经 C09 `agent-task.confirm-command` 确认，普通业务命令由 owning feature 绑定其精确 C09 branch；C10 不拥有命令 payload 或业务幂等键生成规则。

#### Scenario: 普通命令确认后提交一次

- **WHEN** 有权用户检查确认摘要并确认普通命令
- **THEN** 原语调用 owning feature 提供的单一提交处理器并在进行中阻止重复点击
- **AND** 网络重试继续使用调用方提供的原命令标识、幂等键、工程和精确版本

#### Scenario: 高影响命令要求显式二次确认

- **WHEN** 发布、回滚、作废或批量复核等高影响命令进入确认
- **THEN** 默认焦点位于取消操作，完成额外确认前提交按钮保持禁用
- **AND** Escape、取消、路由离开或关闭对话框均不产生业务事实

#### Scenario: 无权限确认卡不可提交

- **WHEN** 确认摘要可见但当前权限态不允许命令
- **THEN** 确认按钮置灰并以可访问方式说明所需权限
- **AND** 不能通过 Enter、快捷键或 Agent 面板绕过服务端常规权限校验

#### Scenario: 陈旧版本确认失败

- **WHEN** 用户确认期间目标精确版本已被替代
- **THEN** C09 的陈旧版本错误按结构化异常呈现并要求刷新摘要
- **AND** shell 不自动改写目标版本、不复用确认结果提交新版本

### Requirement: 键盘和焦点行为必须可预测

shell、导航、停靠区、页面骨架和确认对话框 MUST 使用语义化 landmark 与原生交互元素，支持仅键盘操作、可见焦点、跳过导航、路由标题播报和焦点恢复。停靠区标签 MUST 遵循单选标签键盘模式；模态对话框 MUST 限制焦点范围，关闭后返回触发点。用户偏好减少动态效果时 MUST 禁用非必要动画。

#### Scenario: 键盘完成导航

- **WHEN** 用户仅使用 Tab、Shift+Tab、Enter 和浏览器前进后退
- **THEN** 可到达跳过导航、七项导航、页面主标题和所有可用操作，当前路由以文字和程序状态同时标识
- **AND** 路由变化后焦点移动到主标题并由礼貌 live region 播报

#### Scenario: 停靠区键盘操作

- **WHEN** 焦点位于右侧停靠区标签
- **THEN** 左右方向键、Home、End 切换“上下文/Agent”，Escape 收起并把焦点返回开启按钮
- **AND** 收起内容不可聚焦且不被辅助技术重复读取

#### Scenario: 确认对话框焦点收口

- **WHEN** 命令确认对话框打开
- **THEN** 背景区域不可交互，Tab 焦点留在对话框内，关闭后返回原触发控件
- **AND** 焦点不会因异步状态变化落到被卸载或禁用的提交按钮

### Requirement: 浏览器适配必须只消费 C09 公共传输契约

Web app MUST 通过同源原生 HTTP 消费 C09 会话、闭合 command/query 与 OpenAPI 3.1 路径，并通过原生 `EventSource` 消费运行事件。HTTP 请求 MUST 让浏览器发送 `__Host-riskflow_session` Cookie，不得从 JavaScript 读取 token 或使用 Authorization header/body/query 替代；command/query branch 必须来自 C01/C02 的闭合集合，响应由 owning feature 的共享 Schema 解码。Web app MUST NOT 导入 `apps/api`、直读数据库/Outbox、建立通用 RPC、生产 Mock 数据源或客户端事实缓存。

#### Scenario: C09 JSON 请求保持闭合

- **WHEN** owning feature 通过 Web 适配器提交一个已登记 branch
- **THEN** 适配器按 C09 `/api/v1/projects/:projectId/{commands|queries}/:branch` 形状发送 JSON、同源 Cookie、工程/空间/资料引用和调用方提供的身份字段
- **AND** 未知 branch、空工程、额外授权字段、开放 patch、URL 或文件路径在网络调用前失败

#### Scenario: OpenAPI 用作兼容性检查

- **WHEN** Web 构建或集成验证读取 `/api/v1/openapi.json`
- **THEN** 所消费的会话、command/query 和 SSE operation 必须在当前 C09 文档中存在且媒体类型/认证/状态族一致
- **AND** Web 不从 OpenAPI 动态生成任意调用器或维护第二套领域 Schema

#### Scenario: 原生 EventSource 处理运行事件

- **WHEN** 页面订阅一个 canonical 精确运行引用
- **THEN** 原生 EventSource 只监听 `domain-event-ref.v1` 与安全错误事件，把事件引用交给 owning feature 重新查询投影
- **AND** 浏览器负责标准重连和 `Last-Event-ID`，Web 不发明进程内序号、自有重连协议、事件事实缓存或 SSE 反向命令

#### Scenario: SSE 权限或流错误安全收口

- **WHEN** 连接因撤权、游标冲突、终止错误或网络关闭结束
- **THEN** 页面停止展示实时状态并通过结构化错误/重新查询入口恢复
- **AND** 不跳过事件、不切换工程、不取消运行、不显示内部错误正文

### Requirement: C10 必须保持业务和状态所有权边界

C10 MUST 只拥有 shell 布局、闭合导航/路由、上下文编排、页面骨架、短生命周期视图状态、权限呈现、停靠区、确认、焦点和 C09 浏览器适配。业务记录、项目/空间/工序事实、查询投影、通知、Agent 会话/任务、审计、命令结果、统计口径及页面深链 MUST 由后续 owning change 提供；C10 不持久化这些对象，也不以示例值填充页面。

#### Scenario: 刷新后从服务端重建

- **WHEN** 用户刷新浏览器或重新打开业务根路由
- **THEN** shell 只从 URL/会话恢复获准界面上下文并由 owning feature 重新查询 C09
- **AND** 不从 localStorage、sessionStorage、IndexedDB、Service Worker 或内存快照恢复业务事实

#### Scenario: 后续页面按所有权接入

- **WHEN** C32～C35 注册一个合法根路由的页面 contribution
- **THEN** contribution 复用共享骨架、状态、权限、停靠和确认契约并独立拥有其数据与命令绑定
- **AND** C10 不复制该页面 DTO、API payload、业务规则、事实或测试样例

### Requirement: Web 启动恢复正式会话并保护认证状态竞态

demo 和生产 Web 壳层 MUST 在启动时查询服务端当前会话，恢复完成前呈现检查状态，不跳转登录页、不发起业务查询。有效会话保持 URL 中的领域身份和精确版本；匿名会话沿用登录后回跳路径；受限会话必须进入改密路径。技术故障 MUST 呈现可重试恢复失败，不能当作匿名；迟到恢复、登录、改密或注销结果不得覆盖更近的认证操作。已有登出交互失败时保持原会话并允许重试，不宣称注销成功。（F-AG-01/02）

#### Scenario: 硬刷新和直接深链保持有效会话
- **WHEN** 浏览器携带有效 Cookie 刷新页面或直接打开含领域身份和精确版本的深链
- **THEN** 系统先恢复会话，再进入原目标页，不闪现登录表单、不改换目标版本

#### Scenario: 匿名恢复后保留登录回跳目标
- **WHEN** 自省确认当前没有有效会话
- **THEN** 系统进入登录路径并保留原目标，合法登录后返回原目标页

#### Scenario: 受限会话恢复后完成改密
- **WHEN** 当前会话有效但服务端声明首次改密限制
- **THEN** 系统呈现改密入口而不装载业务页，改密成功后按新元数据进入原目标

#### Scenario: 恢复故障可以重试
- **WHEN** 自省出现网络或服务端技术故障
- **THEN** 系统呈现可重试会话失败状态，重试成功后恢复原目标，失败期间不伪装成匿名

#### Scenario: 迟到认证响应不能覆盖新操作
- **WHEN** 旧恢复或认证请求在后续登录、改密或注销操作之后才返回
- **THEN** 系统丢弃旧响应，不恢复已被新操作替代的会话或错误状态

#### Scenario: 注销失败保持现有会话
- **WHEN** 已有登出入口收到注销技术失败
- **THEN** 系统保持原会话、显示可重试失败，只有成功注销或服务端确认会话失效才进入匿名
