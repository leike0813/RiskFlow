## ADDED Requirements

### Requirement: C35 业务窄读必须进入唯一闭合路由目录

系统 MUST 登记 `agent-task.read`、`review-audit.read`、`projection.report-read` 三条版本化查询分支，分别绑定任务窄读、复核活动窄读和报告窄读端口，复用既有 `agent-task.read`、`review-audit.read`、`projection.export` 能力。运行时和 OpenAPI MUST 同源，端口未注入时均不激活。请求使用既有 strict 查询信封，由服务端拥有主体、工程与授权；不得提供 SQL、patch、任意文件/工件/URL 或通用调用入口。

#### Scenario: 注入与路由文档同源
- **WHEN** API 注入或不注入某个 C35 只读端口
- **THEN** 对应路由和 OpenAPI 同时存在或缺席，成功只调用该公共端口，未知操作及多余字段早期拒绝

#### Scenario: 无权或不存在同形
- **WHEN** 无权调用方读取存在或不存在的任务、复核/审计主题或报告
- **THEN** 返回同形安全失败，不泄露引用或敏感参数

### Requirement: C35 管理与健康路由必须保持系统授权和业务授权分离

系统 MUST 在同一系统路由目录登记 Cookie 管理身份读取、strict 管理目录/命令和有界健康快照入口。管理请求不能接受 actor、角色、管理授权引用或自造能力；服务端以当前会话调用 C06 系统管理证明，再分派原管理端口。健康和部署元数据仅允许当前管理员且使用显式注入的安全提供者，不启动探测循环、任意远程请求或 shell。所有响应禁止缓存，未注入能力不出现在 OpenAPI。

#### Scenario: 原管理命令真实执行
- **WHEN** 当前管理员提交合法命令、预期版本和幂等身份
- **THEN** HTTP 层补入服务端管理授权并只调用对应 C06 端口，错误沿既有安全信封返回

#### Scenario: 越权与缺少提供者
- **WHEN** 普通用户调用系统入口，或服务端没有健康提供者
- **THEN** 前者在查询任何状态前拒绝，后者不激活路由且不返回伪健康结果
