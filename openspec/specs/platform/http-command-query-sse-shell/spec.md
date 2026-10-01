# HTTP Command Query SSE Shell Specification

## Purpose

为 RiskFlow 提供版本化、服务端授权且可恢复的 HTTP 命令、查询与 SSE 交付边界，使浏览器和受控客户端只能通过既有模块契约访问工程事实、运行、复核、审计与有界 Agent 任务。

## Requirements

### Requirement: 会话 HTTP 边界必须使用安全 Cookie

系统 MUST 提供登录、修改密码和注销的版本化 HTTP 入口，并只通过 C06 本地身份接口创建、轮换和撤销会话。成功登录或修改密码 MUST 把 opaque session token 写入名为 `__Host-riskflow_session` 的 Cookie，属性固定为 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/` 且无 `Domain`；响应正文、普通日志、错误、指标和链路不得包含 token。所有使用 Cookie 的状态变更入口 MUST 拒绝跨站来源，请求不得通过 Authorization header、查询参数或请求正文替代会话 Cookie。

#### Scenario: 登录建立安全会话

- **WHEN** 调用方以合法登录尝试标识和凭据提交登录请求
- **THEN** HTTP 响应设置符合固定属性的会话 Cookie，并只返回不含 token 的会话元数据
- **AND** 相同登录尝试标识与相同载荷重试时观察到同一逻辑会话，不重复创建成功登录审计

#### Scenario: 修改密码轮换会话

- **WHEN** 已登录用户以当前 Cookie 成功修改密码
- **THEN** 旧会话立即失效，响应设置由 C06 返回的新会话 Cookie
- **AND** 旧 token 不能继续访问任一业务入口

#### Scenario: 注销清除会话

- **WHEN** 已登录用户提交同源注销请求
- **THEN** 系统通过 C06 撤销服务端会话并清除客户端 Cookie
- **AND** 后续使用原 Cookie 的请求返回不泄露账号状态的认证失败

#### Scenario: 跨站或伪造 token 被拒绝

- **WHEN** 状态变更请求来源不满足同源策略，或只在 header、查询参数、正文中提供 token
- **THEN** 系统在调用任一领域、复核、工作流或 Agent port 前拒绝请求
- **AND** 不创建授权上下文、业务事实、审计成功项或外部意图

### Requirement: HTTP 命令与查询必须映射闭合公共契约

系统 MUST 提供带主版本号的命令和查询入口，并使用闭合路由清单把每个入口映射到一个 C02 module branch、精确请求 Schema、结果 Schema 和对应公共 port 方法。HTTP 层 MUST 复用 C02/C06 strict DTO，未知 route、未知 `kind`、契约外字段、开放对象袋、任意补丁、SQL、文件路径或 URL MUST 在调用下游前失败；不得建立 `execute(any)`、通用仓储或第二套领域字段。

#### Scenario: 类型化命令往返

- **WHEN** 调用方提交一个已登记命令分支、合法命令身份、精确 payload 和服务端可验证的工程路径
- **THEN** 系统组装对应 C02 命令并调用唯一所属 port 方法
- **AND** 响应保持该方法 `succeeded | waiting | failed` 的闭合结果语义和精确结果引用

#### Scenario: 类型化查询往返

- **WHEN** 调用方提交一个已登记查询分支、合法查询身份和精确 payload
- **THEN** 系统调用唯一所属只读 port，并返回通过对应结果 Schema 校验的引用
- **AND** 查询不产生业务事实、命令收据或投影反写

#### Scenario: 契约外输入在边界失败

- **WHEN** 请求包含未知分支、额外授权字段、开放 patch、未声明字段或不匹配路径分支的 `kind`
- **THEN** 系统返回稳定的契约校验错误且不调用下游 port
- **AND** 不把未知字段删除后继续执行，也不记录完整非法正文

#### Scenario: 下游返回非法结果

- **WHEN** 下游实现返回不匹配登记结果 Schema 的对象
- **THEN** 系统以安全的终止性传输错误失败
- **AND** 不把非法对象或内部校验详情返回客户端

### Requirement: 授权上下文必须由服务端逐请求签发

每个受保护命令、查询和 SSE 连接 MUST 从会话 Cookie、路径中的目标工程、闭合 branch 以及已声明的空间/资料引用构造 C06 人类授权请求。系统 MUST 以 strict HTTP Schema 拒绝客户端提供的 actor、capability、`AuthorizationContextV1`、授权引用或工程外 scope/source grant，由 C06 `authorize` 返回当前最小上下文后再组装 C02 请求；所属 port 仍 MUST 在副作用或正文读取前按 C06 `verify` 语义复验。授权失败与目标不存在对无权调用方 MUST 不可区分。（横切 RI-S14、RI-S61～RI-S65；RA-S4～RA-S7）

#### Scenario: 当前工程成员取得最小授权

- **WHEN** 活跃会话在目标工程、空间和资料范围内具备该 route 对应 branch 能力
- **THEN** 系统使用 C06 返回的 actor、工程、单一所需 capability、空间、资料 grant 和策略版本组装请求
- **AND** 版本、证据与审计引用原样传给所属 port

#### Scenario: 客户端伪造授权字段

- **WHEN** 客户端提交额外 capability、其它 actor、其它工程空间、资料 grant 或完整授权上下文
- **THEN** strict HTTP Schema 拒绝整个伪造字段集合，且这些值不参与访问决定
- **AND** 系统只使用 C06 从当前事实签发的最小上下文

#### Scenario: 跨工程目标整体拒绝

- **WHEN** 路径工程、payload 引用、空间、资料或会话成员关系不能证明属于同一获准工程
- **THEN** 系统在读取目标存在性或调用下游前返回统一授权拒绝
- **AND** 不产生部分响应、业务事实、领域事件、Agent 行动或 SSE 事件

#### Scenario: 长连接期间撤权

- **WHEN** SSE 连接建立后账号、成员、空间、资料授权或策略版本被撤销
- **THEN** 下一次耐久事件读取前重新授权失败并终止连接
- **AND** 已撤权后产生的事件引用不会发送给该客户端

### Requirement: HTTP 写命令必须保持 C02 与 C03 幂等语义

每个 HTTP 写命令 MUST 携带非空命令标识和业务幂等键，并把路径工程、闭合命令种类与 strict payload 交给既有 C02/C03 幂等边界。相同工程、命令种类、幂等键与相同有效载荷的串行或并发重试 MUST 返回首次提交的同一逻辑结果；同键不同载荷 MUST 返回不可重试的幂等冲突。HTTP 层不得增加进程内幂等缓存、替换命令身份或在网络重试时重复提交副作用。

#### Scenario: 网络重试返回原结果

- **WHEN** 客户端在响应丢失后以原命令标识、幂等键和相同载荷重试
- **THEN** 系统返回首次提交的结果或等待引用
- **AND** 业务事实、审计、Outbox、复核任务、Agent 任务和工作流运行均不重复

#### Scenario: 并发重复命令只形成一个结果

- **WHEN** 两个 HTTP 请求并发提交相同幂等身份与载荷
- **THEN** 两个调用方观察到同一逻辑结果或一个可安全重试的进行中结果
- **AND** 下游只形成一次业务副作用

#### Scenario: 同键不同载荷冲突

- **WHEN** 调用方复用同一工程、命令种类和幂等键但改变 strict payload
- **THEN** 系统返回稳定、不可重试的幂等冲突及允许披露的原命令引用
- **AND** 不覆盖或重新执行首次命令

#### Scenario: 陈旧版本命令不自动改写

- **WHEN** 命令引用的目标精确版本已被替代或不再可决定
- **THEN** 系统返回稳定的陈旧版本/并发冲突
- **AND** 不把请求静默迁移到当前版本，客户端必须刷新后使用新命令与幂等键

### Requirement: HTTP 错误必须稳定且最小披露

系统 MUST 将 C02 `ModuleErrorV1`、C06 `AccessErrorV1`、请求校验失败和未知传输故障确定性映射到有限 HTTP 状态与版本化安全错误信封。响应 MUST 至少包含稳定错误代码、是否可重试、请求关联标识和允许披露的版本/诊断引用；客户端不得依赖完整文案决定路由。系统 MUST NOT 返回堆栈、SQL、连接串、驱动或模型错误正文、密码、Cookie/token、资料/证据正文、原始 Agent/LLM 响应、内部 SSE、思维链或未授权目标存在性。

#### Scenario: 已知模块错误确定性映射

- **WHEN** 下游返回授权、未找到、陈旧版本、幂等、业务阻断、瞬态、终止或契约不支持错误
- **THEN** HTTP 状态、稳定代码和 `retryable` 值按同一映射返回
- **AND** 相同错误种类不会因 route 或内部异常文案变化而改变客户端路由语义

#### Scenario: 瞬态错误保留重试身份

- **WHEN** 下游返回可重试瞬态失败
- **THEN** 响应仅返回允许披露的尝试、重试时点/策略和诊断引用
- **AND** 客户端重试仍使用原命令身份、幂等键、版本和工程作用域

#### Scenario: 未知异常安全收口

- **WHEN** route、序列化或下游调用抛出未分类异常
- **THEN** 系统返回终止性或暂时性通用传输错误及请求关联标识
- **AND** 内部异常对象、正文和敏感参数只进入受控诊断路径，不进入响应或普通日志

### Requirement: SSE 必须从耐久订阅游标恢复

系统 MUST 为获授权运行提供只读 SSE 入口，并只通过 C02 `ProjectionPortV1.subscribe` 取得与该运行关联的耐久 `DomainEventRefV1` 序列。路径 `runId` MUST 使用精确 `WorkflowRunRefV1.reference` 的无填充 canonical `base64url(JSON.stringify({entityId,versionId}))` 编码；服务端 MUST 解码、strict 校验并重新编码对比，禁止从裸实体 ID合成版本或按 Identifier 允许的分隔字符拆分。每个业务事件帧 MUST 使用领域 `eventId` 作为 SSE `id`，携带事件契约版本、运行引用和领域事件引用；连接 MUST 接受标准 `Last-Event-ID`，并可接受与其一致的显式起始游标。重连后 MUST 只发送游标之后的获准事件，重复读取由 `eventId` 幂等收口，不得使用仅存在于 API 进程内的序号。（横切 RI-S62～RI-S65；RA-S5～RA-S7）

#### Scenario: 精确运行引用无损往返

- **WHEN** 客户端把包含分隔符或非 ASCII 字符的运行实体标识与精确版本按 canonical 规则编码后订阅
- **THEN** 系统无损还原同一 `WorkflowRunRefV1` 并传给 `ProjectionPortV1.subscribe`
- **AND** 非 canonical、带 padding、缺失/额外字段或无法解码的路径值在授权与订阅前返回契约错误

#### Scenario: 从头订阅运行事件

- **WHEN** 已获 `projection.subscribe` 授权的调用方订阅一个运行且未提供游标
- **THEN** 系统按耐久顺序发送当前可见事件引用并继续等待后续事件
- **AND** 每个业务帧的 SSE `id` 等于其领域 `eventId`

#### Scenario: 断线后恢复

- **WHEN** 客户端以最后已处理的 `Last-Event-ID` 重连
- **THEN** 系统将该值传为 C02 `afterEventId` 并从下一条获准耐久事件继续
- **AND** API 重启或进程内状态丢失不会使已提交事件无法重放

#### Scenario: 两个游标冲突

- **WHEN** `Last-Event-ID` 与显式起始游标同时存在但值不同
- **THEN** 系统在打开事件流前返回不可重试的契约错误
- **AND** 不猜测较新游标、不跳过事件

#### Scenario: 未知或不属于运行的游标

- **WHEN** 投影端无法证明游标属于目标运行或可按当前权限继续
- **THEN** 系统返回安全的陈旧/未找到/授权错误并要求客户端重新查询运行状态
- **AND** 不从其它运行或工程拼接事件

### Requirement: SSE 必须有界并避免敏感信息泄露

SSE 连接 MUST 发送标准 `text/event-stream`、禁止不适合流式响应的缓冲，并使用不含业务数据的注释心跳维持连接。订阅轮询、单次批量、帧大小、心跳间隔和连接空闲时间 MUST 有固定上限；写入背压、客户端断开、服务关闭或授权失败 MUST 停止后续读取并清理资源。流中只能出现闭合事件引用与安全错误事件，不得出现命令入口、原始 Outbox 行、内部日志、证据正文、模型响应、Agent 思维链或未授权对象。

#### Scenario: 空闲连接发送安全心跳

- **WHEN** 已授权连接在一个心跳周期内没有新事件
- **THEN** 系统发送不带业务 payload 的 SSE 注释心跳
- **AND** 心跳不推进 `Last-Event-ID` 游标

#### Scenario: 慢客户端触发有界收口

- **WHEN** 客户端持续无法消费数据并达到冻结背压或连接上限
- **THEN** 系统停止读取更多事件并关闭连接
- **AND** 已提交事件仍保留在耐久投影中供客户端从最后确认游标恢复

#### Scenario: 客户端断开释放资源

- **WHEN** 客户端关闭连接或请求被中止
- **THEN** 系统停止订阅循环、心跳计时器和待处理写入
- **AND** 不取消工作流、Agent 任务或回滚已入库业务事实

#### Scenario: 流中发生错误

- **WHEN** 已打开流在后续订阅中遇到可安全披露的错误
- **THEN** 系统发送一个不带业务游标的闭合错误事件后终止连接
- **AND** 内部错误正文和无权事件引用不会写入流

### Requirement: 复核、审计与有界 Agent 不得通过 HTTP 旁路

C07 复核请求、类型化决定和追溯查询 MUST 只调用 `ReviewAuditPortV1`；C08 Agent 启动、恢复、取消和交互写命令确认 MUST 只调用 `AgentTaskPortV1`。HTTP 层 MUST NOT 提供直接修改复核状态、审计、Agent 预算/策略/候选、工作流检查点或领域事实的通用入口。交互 Agent 写命令在 C08 确认前不得执行，人工决定不得越过目标版本和确定性校验；预警与处置入口不得绕过已入库风险评估记录。（RA-S5～RA-S7）

#### Scenario: 类型化人工决定经 C07 提交

- **WHEN** 获授权复核者提交与当前复核任务类型和目标版本匹配的决定
- **THEN** HTTP 层调用 C07 `decideReview` 并返回其幂等结果引用
- **AND** 不直接改工作流状态、候选或审计表

#### Scenario: 陈旧复核决定被拒绝

- **WHEN** 调用方提交已替代任务或目标版本的复核决定
- **THEN** C07 的陈旧版本结果原样映射为不可重试 HTTP 冲突
- **AND** HTTP 层不把决定转移到新版本或生成替代决定

#### Scenario: 交互 Agent 命令等待用户确认

- **WHEN** C08 交互任务产生写命令提案但用户尚未确认
- **THEN** HTTP 查询/SSE 只能显示等待确认及提案引用
- **AND** 不提供跳过确认、扩大授权或直接执行提案的 route

#### Scenario: Agent 策略或预算越界

- **WHEN** 请求试图通过 HTTP 改模型、提示、工具白名单、预算、冻结输入或任务类型化增量
- **THEN** strict route 和 C08 共同拒绝请求
- **AND** 不创建替代任务、基线正式结果或未审计副作用

### Requirement: 版本、证据与审计引用必须跨传输保持可追溯

HTTP 和 SSE MUST 原样保留既有请求/结果中的工程、实体身份、精确版本、命令/查询/运行/任务/复核、证据定位、授权策略和审计引用，不得用展示字符串、当前版本或数据库行替换。无资料正文权限的调用方只能取得 C06/C07/投影明确允许的定位、脱敏摘要和引用；传输层不得自行扩充、反查或缓存正文。API 请求日志 MUST 只记录低基数 route、request/command/query/run 标识、工程、结果类别、HTTP 状态、耗时和允许披露的错误码，不记录 payload dump 或敏感正文。

#### Scenario: 查询结果保留历史版本

- **WHEN** 客户端查询历史风险、评估、预警、处置、复核、Agent 或运行结果
- **THEN** 响应保留下游返回的精确版本和因果引用
- **AND** 不自动替换为当前版本或复制另一模块拥有的事实

#### Scenario: 无正文权限时仍可安全追溯

- **WHEN** 调用方可查看结论和证据定位但无来源资料正文权限
- **THEN** 响应只含授权投影给出的定位、脱敏摘要和引用
- **AND** SSE、错误、日志、OpenAPI 示例和审计活动均不泄露正文或其存在性细节

#### Scenario: 请求关联不代替业务审计

- **WHEN** 一个命令成功产生事实、审计和 Outbox，或 C07/C08 形成任务事实
- **THEN** HTTP request id 只作为诊断关联信息返回和记录
- **AND** route 日志或 SSE 发送记录不得冒充 C03/C06/C07/C08 的耐久审计事实

### Requirement: OpenAPI 与上传边界必须来自当前 HTTP 契约

系统 MUST 提供可机器读取的 OpenAPI 文档，且命令、查询、会话、SSE 路径、请求/响应媒体类型、认证要求、幂等 header、稳定错误和 route 版本 MUST 从与运行时相同的闭合路由元数据派生。文档不得包含凭据、真实业务正文、未经授权的示例或第三方内部结构。本 change MUST NOT 提供业务文件上传、multipart 暂存或通用二进制入口；未登记上传请求必须在读取或缓冲正文前拒绝。

#### Scenario: 运行时与 OpenAPI 路由一致

- **WHEN** 验证者对比派生 OpenAPI 与实际注册 route
- **THEN** 每个已登记 route 的方法、路径、媒体类型、认证和结果族一致
- **AND** 不存在只在文档或只在运行时开放的业务 route

#### Scenario: OpenAPI 不复制领域 Schema

- **WHEN** C02/C06 请求或结果 Schema 被用于 HTTP route
- **THEN** 文档引用同一契约来源的派生描述或明确的传输投影
- **AND** 不维护另一套风险、评估、复核或 Agent 字段清单

#### Scenario: 未实现上传入口被早期拒绝

- **WHEN** 客户端向 C09 route 提交 multipart、二进制或未登记上传路径
- **THEN** 系统在落盘、缓冲或领域调用前返回不支持的媒体类型或不存在
- **AND** 不创建临时文件、工件引用、资料事实或处理任务

### Requirement: C09 必须保持 C10 消费边界

系统 MUST 将 C09 限定为 API platform：提供可由后续 C10 消费的 HTTP/SSE 契约与无网络监听副作用的应用工厂，但不得实现 React 组件、页面路由、导航、客户端缓存、EventSource 生命周期、权限置灰或任何 Web UI。命令、查询和 SSE 契约 MUST 可由真实 HTTP 注入测试独立验收，不要求启动开发服务器、Worker 或浏览器。

#### Scenario: C10 可独立消费 API 契约

- **WHEN** 后续 Web shell 使用发布的 route/OpenAPI 元数据调用 C09
- **THEN** 它只需提交会话、工程、声明的空间/资料引用、命令/查询身份、业务 payload 与 SSE 游标
- **AND** 不需要了解数据库、Outbox、C06/C07/C08 内部表、模型协议或领域实现

#### Scenario: API 工厂不启动监听或后台任务

- **WHEN** 测试或部署组合根创建 API 实例
- **THEN** 工厂只注册显式注入的依赖和 route
- **AND** 不自动监听端口、运行迁移、启动 Worker、轮询 Outbox 或创建 Web UI

### Requirement: HTTP 壳层必须登记唯一的预警确认入口

系统 MUST 在既有闭合业务路由清单中登记 `POST /api/v1/projects/:projectId/commands/warning-response.acknowledge`。该入口 MUST 使用预警处置 `acknowledge` 分支的精确请求 Schema、既有预警处置记录结果 Schema 和 `WarningResponsePortV1.record` 唯一分派；路由所需能力 MUST 从 `warning-response.acknowledge` 的公共 branch-capability 映射取得。运行时注册与 OpenAPI MUST 继续由同一活动路由元数据派生，不得增加专用 handler、第二套路由表、通用 `execute` 或平行确认入口。

HTTP 请求 MUST 只接受既有 v1 命令传输信封字段及 `{ warningRecordRef, warningResponseTaskRef }` strict payload。操作者、工程和版本化授权上下文 MUST 由会话 Cookie、路径工程、闭合 branch 与已声明空间/资料范围在服务端组装，客户端不得提交或覆盖；HTTP 层 MUST 原样传递命令标识、业务幂等键、发起时间和 payload，并原样校验/返回公共结果联合。授权失败与目标不存在对无权调用方 MUST 保持不可区分，HTTP 层不得自行读取或改变预警、任务、评估或处置事实。

#### Scenario: C26 或 C34 通过公共 HTTP 入口确认预警
- **WHEN** 获授权客户端向 `warning-response.acknowledge` 路由提交合法 v1 命令信封及预警/任务精确引用 payload
- **THEN** HTTP 壳层组装服务端拥有的工程、操作者与最小授权上下文，并只调用 `WarningResponsePortV1.record` 一次
- **AND** 成功响应只包含公共结果联合声明的确认状态与精确引用

#### Scenario: strict HTTP 边界先于授权和领域调用拒绝伪造输入
- **WHEN** 请求包含客户端提供的操作者、授权上下文、能力、工程覆盖、风险解除/任务关闭字段、未知 kind 或其它契约外字段
- **THEN** HTTP 壳层在授权和预警处置 port 调用前拒绝请求
- **AND** 不产生确认、审计、事件、通知或其它副作用

#### Scenario: 路由登记、授权能力和 OpenAPI 保持同源
- **WHEN** 验证者检查运行时路由清单、活动 port 路由、branch-capability 映射与生成的 OpenAPI
- **THEN** `warning-response.acknowledge` 仅出现为既有 v1 command 路径，绑定 `acknowledge` domain kind、`warning-response.record` 能力和预警处置 `record` 方法
- **AND** 不存在只在文档、只在运行时或绕过闭合路由清单的确认入口

#### Scenario: HTTP 重试不建立第二套幂等状态
- **WHEN** 客户端以相同命令标识、业务幂等键和 payload 重试确认，或复用同一业务幂等键提交不同引用
- **THEN** HTTP 壳层把请求交给既有公共幂等边界并原样映射其重放结果或不可重试冲突
- **AND** HTTP 层不缓存、合并、改写或重复执行确认命令


### Requirement: C32 只读查询分支必须登记在闭合路由清单

系统 MUST 在既有闭合业务路由清单中以 `POST /api/v1/projects/:projectId/queries/<branch>` 形态登记七条只读 query branch：`engineering-data.context-read`、`engineering-data.source-catalog`、`engineering-data.monitoring-catalog`、`engineering-data.read-result`、`knowledge-modeling.governance-read`、`knowledge-modeling.retrieval-result`、`projection.result-read`。每条 branch MUST 映射到精确请求 Schema、结果 Schema、唯一 port 方法和既有能力位（`engineering-data.read`、`knowledge-modeling.read`、`knowledge-modeling.retrieve`、`projection.query`），不得新增能力枚举值。运行时注册与 OpenAPI MUST 继续由同一活动路由元数据派生；对应端口未注入时该 branch MUST 不激活且不出现于 OpenAPI。（横切 RI-S1～RI-S6；RA-S1～RA-S7）

#### Scenario: 路由目录、能力映射与 OpenAPI 一致

- **WHEN** 验证者检查活动路由清单、branch-capability 映射与生成的 OpenAPI
- **THEN** 七条 branch 的路径、请求/结果 Schema、能力位与激活状态三者一致，不存在清单外查询入口

#### Scenario: 端口未注入时 branch 不激活

- **WHEN** 某只读端口未注入 API 装配
- **THEN** 对应 branch 返回与未知路由相同的失败，且不出现在 OpenAPI 中

### Requirement: C32 只读分支必须复用既有传输信封与失败形态

七条只读 branch 的 HTTP 请求 MUST 只接受既有 v1 查询传输信封字段（schemaVersion、requestedSpatialScopeRefs、requestedSourceVersionRefs、queryId、requestedAt 与 strict payload）；操作者、工程与授权上下文 MUST 由会话 Cookie、路径工程与闭合 branch 在服务端组装，客户端不得提交 actor、capability 或授权字段。成功响应原样返回公共结果联合；失败 MUST 使用既有 `HttpErrorV1` 形态，授权失败与目标不存在对无权调用方保持不可区分，不得因新分支引入新的错误码、第二套信封或正文旁路（如文件下载、任意 URL 取数）。（横切 RI-S14、RI-S61～RI-S65）

#### Scenario: 客户端提交越权字段被拒

- **WHEN** 请求包含 actorId、authorization、capability 或契约外字段
- **THEN** HTTP 层在调用下游前以契约无效失败，不触达端口

#### Scenario: 无权与不存在不可区分

- **WHEN** 无权调用方与目标不存在两种情形分别请求同一 branch
- **THEN** 两者得到相同状态码与同形错误体，响应差异不可用于枚举工程内对象

### Requirement: C33 只读查询分支必须登记在闭合路由清单

系统 MUST 在既有闭合业务路由清单中以 `POST /api/v1/projects/:projectId/queries/<branch>` 形态登记五条只读 query branch：`risk-identification.run-list`、`risk-identification.run-read`、`risk-identification.record-catalog`、`risk-identification.record-read`、`review-audit.queue-read`。每条 branch MUST 映射到精确请求 Schema、结果 Schema、唯一 port 方法和既有能力位（`risk-identification.read`、`review-audit.read`），不得新增能力枚举值。运行时注册与 OpenAPI MUST 继续由同一活动路由元数据派生；对应端口未注入时该 branch MUST 不激活且不出现于 OpenAPI。（RI-S5～RI-S6）

#### Scenario: 路由目录、能力映射与 OpenAPI 一致

- **WHEN** 验证者检查活动路由清单、branch-capability 映射与生成的 OpenAPI
- **THEN** 五条 branch 的路径、请求/结果 Schema、能力位与激活状态三者一致，不存在清单外查询入口

#### Scenario: 端口未注入时 branch 不激活

- **WHEN** 某只读端口未注入 API 装配
- **THEN** 对应 branch 返回与未知路由相同的失败，且不出现在 OpenAPI 中

### Requirement: C33 只读分支必须复用既有传输信封与失败形态

五条只读 branch 的 HTTP 请求 MUST 只接受既有 v1 查询传输信封字段（schemaVersion、requestedSpatialScopeRefs、requestedSourceVersionRefs、queryId、requestedAt 与 strict payload）；操作者、工程与授权上下文 MUST 由会话 Cookie、路径工程与闭合 branch 在服务端组装，客户端不得提交 actor、capability 或授权字段。成功响应原样返回公共结果联合；失败 MUST 使用既有 `HttpErrorV1` 形态，授权失败与目标不存在对无权调用方保持不可区分，不得因新分支引入新的错误码、第二套信封或正文旁路。（横切 RI-S14、RI-S61～RI-S65）

#### Scenario: 客户端提交越权字段被拒

- **WHEN** 请求包含 actorId、authorization、capability 或契约外字段
- **THEN** HTTP 层在调用下游前以契约无效失败，不触达端口

#### Scenario: 无权与不存在不可区分

- **WHEN** 无权调用方与目标不存在两种情形分别请求同一 branch
- **THEN** 两者得到相同状态码与同形错误体，响应差异不可用于枚举工程内对象
