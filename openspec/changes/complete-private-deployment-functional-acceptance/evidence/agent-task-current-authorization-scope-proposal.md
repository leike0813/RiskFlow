# 长时Agent任务的当前授权补充提案

状态：用户已批准（2026-10-15），D-48/IP-19代码、工程及实机到期执行验证已完成，见[实施报告](agent-task-current-authorization-2026-10-15.md)。任务完成后的准备收口仍有独立契约缺口，D-49待批；不将任务成功等同准备或完整功能验收成功。

## 已复现的问题

D-47修复后，v40正式19资料清洗任务`data-cleaning-task-160542df395742c8da8084bc7dc64e7fa788ea8b@1`已成功读取全部冻结资料，STD-002的11张未识别图片可见。任务完成20次模型调用及20次工具调用后，在`2026-10-15T08:41:44.122Z`以`AGENT_AUTHORIZATION_DENIED/deployment-context`失败，尚未产生候选或正式准备。

失败任务用量：输入88499 token、输出5605 token、对象513，均未耗尽原预算。授权签发时间为`08:36:44.025Z`，任务创建为`08:36:44.885Z`；C06上下文固定TTL为5分钟。实机经同一C06 `verifyDeploymentContext`重放返回`SESSION_EXPIRED/verify.context`，证据在实例`standard-cleaning-v40/authorization-diagnosis-*.json`及`logs/standard-cleaning-authorization-v40.log`。这次失败来源于任务沿用启动时短效上下文，与JSON-LD读取边界及token额度无关。

Worker已正常SIGTERM停止，API保留v40。旧失败、动作、工件及预算台账保持，不复活失败任务或修改既有期限。

## 拟批准的修正

将任务的不可变授权范围与单次动作的短效执行授权分开处理，复用C02已有`agent-task`调用身份及C06唯一授权入口，不增加HTTP端点或第二套权限判定。

1. C08提供内部窄读的任务执行授权依据，输入精确任务引用及当前Worker租约身份，输出已耐久的启动授权引用、工程/发起者、父运行、冻结范围/策略、当前运行状态和剩余预算。读取必须验证实际任务、未取消/终止、当前有效租约和原预算；不能只相信调用者传入的信封或Agent自报字段。复用已有`getTask`、`findAction`及租约校验，禁止C06跨模块直接读取C08表。
2. C06经显式注入的上述公开窄读复核真实任务绑定。对仍可执行的任务，启动时上下文仅作为已经成立的受理事实和范围上界；动作前重新检查当前账号、安全版本、工程成员、角色、空间、来源资格和策略，并按原部署下游分支白名单签发当前动作所需的短效上下文。仍用原5分钟有效期，不延长普通人类/系统上下文，不接受任意过期上下文自动续期，不扩大冻结范围。原启动上下文和任务信封不改写；每次签发、拒绝和精确任务/动作因果引用留审计。
3. Worker在原任务/动作执行作用域传递可信任务与租约依据。模型网关、C04工件及领域工具在副作用或正文读取前使用同一当前授权接缝；不能只修模型而让下一次工件读取或工具行动继续依赖过期启动上下文。持久化内容仍保留原任务及动作归属，恢复读取须复验当前资格；交互Agent的业务写入继续独立要求用户确认和新鲜人类授权。
4. 取消、终止、租约失效、预算耗尽、账号停用/密码重置、撤权、跨工程、错任务或扩大范围全部拒绝。普通上下文到期后仍拒绝；后台任务不保存会话token，不借system身份放权，不调整全局TTL、模型/工具预算、检索query/grade/TopK或质量门槛。

## 文件范围

生产改动限以下现有模块及其必要导出，不创建新子系统：

- `packages/core/src/agent-runtime/runtime.ts`、`index.ts`：任务执行授权依据的唯一内部端口/类型，复用现有任务、预算、引用Schema。
- `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`：从C08正式任务与有效租约有界读取依据，不新增业务表或迁移。
- `packages/adapters/src/auth/postgres-local-identity-access.ts`、`deployment-authorization.ts`：C06的任务当前授权签发/复验、精确因果和原下游白名单；保留普通授权到期及撤权约束。
- `apps/worker/src/agent-runtime/runner.ts`、`scripts/deployment/start.mjs`、必要的`scripts/deployment/composition/identification.mjs`：接可信执行作用域及统一当前授权，覆盖模型、工件和工具；不替换冻结信封或建立模块后门。

测试只扩展既有C06/C08 adapter、Worker runner及deployment entrypoints/composition测试。文档只同步当前change的proposal/design/implementation-plan/handoff、C06/C08局部delta与安全证据；主规格、依赖、迁移、HTTP及历史事实不变。若实际需要其它公共字段、文件、事务或权限语义，则另行升级，不扩大本次提案。

## 验证与续验

用受控时钟在既有测试中复现：普通启动上下文到期后仍被拒绝；同一真实、当前可执行且未耗预算的任务，经当前授权后可以继续原动作，模型/工件/工具路径一致。并覆盖错任务/父运行/工程、伪造或失效租约、范围扩大、撤权、安全版本变化、取消、终止、预算耗尽和审计失败，全部在模型/读取/写入前拒绝。沿原恢复幂等和预算测试，避免重新执行已完成动作。

回归及build/typecheck/lint/format/strict/diff通过后冻结新发布，用新清洗策略/命令创建新正式任务；不复活v39/v40失败，不重转三份合格标准。仍按原19资料、原30分钟任务预算、原模型和质量要求运行，越过5分钟节点取证后继续正式清洗准备、C17人审发布和检索门。没有真实终态不计PASS。

项目AGENTS.md §3与施工图§7要求公共授权接缝、计划外文件及权限语义先批准；用户已批准本提案，按上述范围实施。不提交、不归档、不创建verification。
