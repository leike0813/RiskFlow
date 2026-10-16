## ADDED Requirements

### Requirement: 恢复命令支持显式识别准备引用

HTTP MUST 在现有workflow.resume-run命令中按共享strict Schema接收identification-preparation-ready原因及精确identificationPreparationSnapshotRef，保留workflowRunRef、expectedStateVersion、当前会话、workflow.resume能力及原模块结果。不得接收客户端主体/授权、准备正文、替换来源或父因果字段。

#### Scenario: 恢复原因进入原工作流端口

- **WHEN** 当前会话提交合法显式准备恢复命令
- **THEN** 沿原路由和可信信封调用WorkflowPort，由服务端核验后决定推进或失败，不据HTTP受理宣布业务成功

#### Scenario: 非法恢复字段或无当前权限

- **WHEN** 缺少准备引用、类型错误、存在额外字段，或当前会话无效/缺少恢复能力
- **THEN** 沿既有HTTP错误契约拒绝，不调用领域推进逻辑

### Requirement: 完成准备命令只接收精确任务引用

HTTP MUST 提供engineering-data.complete-identification-preparation命令，strict payload仅完整agentTaskRef，沿原commandId、幂等身份、当前真实会话及engineering-data.freeze能力校验，交给既有EngineeringDataPortV1.freeze。不得由客户端注入主体、授权、清单/结果、策略或父运行；成功继续使用identification-preparation结果形状。

#### Scenario: 合法完成命令路由

- **WHEN** 当前会话具备能力且提交合法精确任务引用
- **THEN** 新命令身份和受权主体进入完成准备分支，返回领域正式结果

#### Scenario: 非法字段或无当前会话

- **WHEN** payload含额外字段、缺少完整任务引用，或当前会话无效
- **THEN** 原HTTP契约拒绝请求，不调用准备完成逻辑

### Requirement: 适用规则集正式HTTP组装

系统 MUST 将knowledge-modeling.assemble-applicable-rule-set暴露为同源POST命令，复用strict信封、会话和治理权限，payload与公共窄命令一致。不得接受actor、授权、规则成员或人工决定自述；成功、等待和失败使用标准模块结果。

#### Scenario: HTTP请求分派与当前权限

- **WHEN** 当前会话提交合法精确组装请求或无权请求
- **THEN** 前者进入正式组装端口，后者在端口副作用前拒绝，确定性组装成功直接返回正式派生发布，内容审核仍沿原人工入口

### Requirement: 资料原件HTTP必须具有独立受权二进制通路

系统 MUST 提供精确sourceVersionRef的JSON元数据查询及同源GET原件路径，复用当前会话和engineering-data.read能力。成功二进制响应 MUST 在当前业务入口检查后按C04受控字节流发送，使用正确媒体/长度、安全文件名、no-store及nosniff，受版本化并发/暂存/字节/时间预算控制。不得以通用工件、路径、外链或Range绕过校验。

#### Scenario: 原件预览与保存

- **WHEN** 当前有权用户查询原件并请求inline或attachment
- **THEN** 返回同一登记版本的实际字节，下载名来自受权元数据并安全处理，不产生转换或业务写入

#### Scenario: 内容读取中断

- **WHEN** 读取开始前撤权、I/O失败、超限或客户端断连
- **THEN** 不提供伪成功正文，清理该请求暂存，保留正确错误与原预算
