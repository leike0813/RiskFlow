# 识别子运行沿真实父调用授权启动（D-52，已批准）

状态：用户已批准，调用身份修复已实现、回归和部署，真实C06预检通过该核验。领域执行授权尚未接通，原父未重试，见[D-52记录](identification-start-authorization-2026-10-15.md)及待批准[D-53](identification-domain-authorization-scope-proposal.md)。完整业务终态未通过。

## 当前证据

D-51 v56完成准备核验和唯一绑定审计，但父图恢复控制写因准备引用尚未登记、宿主仅支持识别子图的准备证明而503。该缺陷已在D-51文件范围内修复：先提交受权入口快照，宿主只对原父运行精确已登记准备再经C15/C04取证，两个先失败的检查点回归现已通过。v57实际恢复通过该边界，进入C24启动，父运行现为identification/retryable-failure，尚无识别子运行和新Agent任务。旧失败、检查点及绑定事实均保留，见[D-51报告](workflow-identification-preparation-binding-2026-10-15.md)。

`apps/worker/src/identification/graph/runtime.ts/start`固定用`workflow.start-run`及自行派生的`c24-workflow-start:…`身份请求授权。实际父命令已经是`workflow.resume-run`；`createDeploymentRuntimeAuthorizationV1`据此尝试把恢复授权派生成另一启动分支，当前批准策略拒绝`DEPLOYMENT_AUTHORIZATION_BRANCH_REJECTED`。现场只做授权探针，未调用子运行start或重试原流程；相同当前主体、相同真实恢复分支/调用身份核验成功。安全证据见[授权接缝](identification-start-authorization-gap-v57.json)。

这不是会话失效，也不能通过给恢复命令添加启动权限、改分支白名单、换system主体或重跑清洗解决。评估子运行已有`issuedInvocationId/authorizationBranch`模式，可复用其明确表达真实调用身份的方式。

## 建议批准的修正

1. 在现有内部`IdentificationGraphStartCommandV1`增加必填`issuedInvocationId`与`authorizationBranch`，复用已有ModuleBranchV1。C30 `identificationStartCommandFor`传入真实`run.commandId`和`run.authorizationBranch`；子运行自身稳定commandId/idempotencyKey、父运行/准备/图版本和业务输入时刻保持。
2. C24启动复验使用这两个真实字段，并将成功复验对应的调用身份固定到本次运行上下文。不再把当前恢复上下文硬派生为workflow.start-run；不猜测分支或在失败后换分支兜底。其余模型、领域行动仍经原C06受限下游签发。调用者自述不能提供执行资格，身份/分支必须与C06来源一致；错主体/工程/身份/分支及撤权照常拒绝，零子运行登记/模型任务。
3. 复用原C03启动回执和检查点绑定。新增字段只表达执行授权来源，不改变原不可变业务载荷、准备/输入版本、独立清洗因果或子运行身份。回执重投仍在当前权限下核验，保持同一父子关系，不新建运行冒充恢复。旧v56/v57失败不改写，不重置父运行重试计数或预算。
4. 工程验证后冻结新制品，用当前真实会话和正式workflow.resume-run/transient-recovered继续现有可重试父运行，expectedStateVersion及错误/诊断引用取当前正式记录。先核对原绑定仍为五资料准备，再记录C24真实身份、输入/策略、任务和阶段结果；如仍失败如实停留，不绕过校验或预判RI/RA通过。

## 文件范围

| 文件 | 内容 |
| --- | --- |
| `packages/core/src/identification/graph/ports.ts` | 内部启动命令增加上述两个必填字段，复用ModuleBranchV1，不新增HTTP/外部命令。 |
| `apps/worker/src/risk-flow/graph.ts` | 唯一生产调用点传入实际父命令身份和授权分支。 |
| `apps/worker/src/identification/graph/runtime.ts` | 启动复验及运行上下文使用真实身份，不改后续业务阶段或权限实现。 |
| `apps/worker/test/identification/graph/fixture.ts`、既有`runtime.test.ts`、`nested-boundary.test.ts` | 更新统一启动夹具，验证启动/恢复分支、错身份、撤权、父子绑定和重投；仅必要调整受影响断言。 |
| `apps/worker/test/risk-flow/runtime.test.ts`、`scripts/deployment/entrypoints.test.mjs` | 核对父图传递真实身份及真实授权分支策略，恢复不会请求workflow.start-run，原拒绝边界保持。 |
| 当前change的proposal/design/implementation-plan/handoff、domain/module-interfaces-events-workflows及identification/graph局部delta和安全证据 | 批准后同步D-52/IP-19/IP-21、C24当前精确分支授权约束和实机结果。 |

不改C06、分支白名单、TTL、事务、迁移、依赖、模型、预算、检索门槛、Web/UI或主规格。若还需其它公共字段、持久化或文件范围，按实际证据另行升级。

## 验证及批准依据

先在既有C24/C30/部署测试复现“父恢复授权却被当作启动分支”的调用链，再验证真实身份可复验、错误身份/工程/分支/当前撤权不产生业务副作用。保留原幂等回执、子运行身份及C03检查点证明；运行所属定向回归、8GiB build/typecheck、lint/format、全仓strict和diff。之后在同一物理Chrome用正式恢复命令续接，记录实际业务结果。

项目AGENTS.md §3与施工图§7要求新增契约及计划外文件先升级。本次C24内部端口字段及runtime/core端口范围已获用户批准；D-51既有批准继续有效。本轮不提交、归档或创建verification，tasks仍5/19。
