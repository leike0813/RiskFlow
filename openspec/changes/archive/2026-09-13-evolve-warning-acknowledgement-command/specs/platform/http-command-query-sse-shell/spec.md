## ADDED Requirements

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
