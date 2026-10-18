# C24 领域执行与逐操作授权接线（D-53，已批准，已部署v59）

状态：已批准，源码和接线已部署v59，工程验证通过，真实业务未通过；详见[实施记录](identification-domain-authorization-2026-10-15.md)。本提案覆盖同一C24授权链，作为IP-19/IP-21补充；D-52已批准内容保持。

## 证据与根因

D-52已修正内部启动命令的issuedInvocationId/authorizationBranch传递，四套回归202项及新增6项授权边界检查通过，工程门禁通过。真实C06预检成功核验当前父恢复身份，随后在C24启动回执提交前拦截，发现它仍将仅有workflow.resume能力的控制上下文直接用作领域执行上下文。C24生产adapter的verifyAuthorization仅接受knowledge-modeling.retrieve、risk-identification.run、risk-identification.finalize三种单能力上下文，因此即便控制身份正确，接下来仍会拒绝。见[安全预检](identification-execution-authorization-preflight-v58.json)与[D-52记录](identification-start-authorization-2026-10-15.md)。

未重试原父图、登记识别子运行或创建模型/Agent任务；原父游标和任务数保持，未消耗其重试次数。v58制品已运行，实际父流程仍为v57留下的identification/retryable-failure，不能宣称识别通过。

读取调用链还存在同类接线缺口：C24 adapter按目标派生逐操作invocationId，却直接复用另一个调用的授权引用；I1依据、I2知识/准备、I3任务启动等由C24发起的模块调用需要各自已有分支授权。部署给C24的preparationReader目前是原始cleaning.store，C24所需的窄读输入不带authorization，而C15正式精确读取需要它。现有PostgresIdentificationPreparationKnowledgeReader已能按可信来源签发engineering-data.evidence-access并委托C15，应复用。评估图已有authorizeDownstream接缝；C21/C22也已有受限签发接缝，不重写其业务算法。

## 拟批准的设计

1. 保留D-52控制命令真实身份复验。C24在进入领域效果前，通过注入的窄authorizeDownstream接缝取得已有risk-identification.plan分支的真实执行授权，固定其实际签发身份到运行上下文和启动回执/检查点。它必须源于当前会话或已有合法任务/事件来源，并核对同工程、同主体、冻结空间/资料和精确父运行；缺少能力就拒绝。业务commandId/幂等键、父子身份、准备、图版本、输入时刻和预算不变，不延长或复活旧控制授权。
2. 在C24自身读写的公共adapter接缝增加窄issueReadContext注入：复用已有operation→invocationId和capability→branch事实源，先证明原上下文当前有效，再为该精确调用签发/验证对应分支。工程、主体、空间/资料、单能力和当前资格一致才返回；不把签名引用和其它invocationId混用，不接受任意权限/查询正文。部署组合必须接入该签发；其它已有调用者未注入时继续原严格复验，不提供伪上下文或放行兜底。
3. C24图使用同一个authorizeDownstream接缝给其主动发起的I1依据、I2知识读取、I3检索上下文/任务，以及I4–I9既有确定性校验/合并/验收调用签发已有用途分支，签发invocationId与随后commandId/requestId一致。已由C21/C22内部接缝签发的行动保持由其负责，不双重签发。I2准备窄读在部署组合复用既有PostgresIdentificationPreparationKnowledgeReader，按真实requestId和当前来源委托C15/C04，不暴露C15私表或任意读取。
4. C24当前恢复、取消和已有复核恢复接缝统一使用可证明的控制来源，再取得领域执行授权。必要的内部resume/cancel命令与恢复授权回调补齐D-52同形的真实issuedInvocationId/authorizationBranch元数据；回调返回它核验过的授权及对应元数据，不从字符串猜身份。原等待、Agent任务、复核决定与父子运行引用必须精确配对，不创建新事件或新的工作流状态机。
5. 生产签发继续通过createDeploymentAuthorizationScopeV1及C06原方法。执行上下文及其下游关联必须能由原批准策略、真实会话/任务来源和C03父子绑定证明，检查点对该真实执行授权及精确工件继续逐项核验。不得把workflow.resume直接加入C24领域能力表，不改分支白名单、角色、TTL、事务隔离、迁移或权限语义。

其中authorizeDownstream的类型化输入固定为当前工程/主体、既有ModuleBranchV1、精确invocationId、请求时间与受信冻结范围，输出为真实AuthorizationContextV1；issueReadContext固定为原上下文及同一逐操作目标/用途，不增加外部HTTP或通用重授权能力。内部恢复元数据仅由已有可信调用方提供并由C06校验。

## 文件范围

| 文件 | 修改目的 |
| --- | --- |
| `packages/core/src/identification/graph/ports.ts` | C24共用窄授权类型及必要内部恢复/取消来源元数据，复用现有分支/引用Schema。 |
| `apps/worker/src/identification/graph/runtime.ts`、`graph.ts`、`composition.ts`及既有`index.ts`（仅必要类型导出） | 控制与领域授权接线、统一逐操作签发、已有恢复回调元数据，不改业务算法。 |
| `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts` | 逐目标受限issueReadContext接缝，保留单能力/主体/范围、摘要、C04 verified和错版拒绝。 |
| `scripts/deployment/start.mjs`、`composition/identification.mjs` | 真实C06签发、执行上下文/下游关联、已有准备窄读复用及检查点接线；不调整授权策略。 |
| `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`、`wiring.ts`，`apps/worker/test/identification/graph`既有fixture、runtime、composition、nested-boundary、control-channels测试 | 精确身份/分支、撤权和重投、父子/等待/检查点回归；按实际受影响的既有用例调整。 |
| `scripts/deployment/composition.test.mjs`、`entrypoints.test.mjs`、`apps/worker/test/risk-flow/runtime.test.ts` | 真实生产组合接缝与父调用接续验证。 |
| 当前change proposal/design/implementation-plan/handoff、identification/graph及domain/module-interfaces-events-workflows局部delta和安全证据 | 批准后记录完整授权链和现场结果。 |

无新依赖、迁移、角色/权限规则、模型/预算、检索阈值、外部HTTP或UI。现有browser/demo/quality调用者若无需注入则保留原严格复验，不为新签发增加测试专用放行；若发现必须改动范围外生产契约或文件，再用实际证据升级。

## 验证与续验

先以现有真实PG/C06/C04测试设施在C24公开接缝复现“父控制授权进入领域读写”和“上下文引用/逐操作身份不匹配”。验证当前合法父恢复可获得既有领域能力，精确逐操作身份在真实C06下可读写；错主体/工程/范围/分支/签发身份、撤权、损坏及超限继续拒绝。仅使用“任意输入都返回同一context”的替身不能作为这条授权链的通过证据。

覆盖I0登记、I1正式依据、I2完整工作计划、I3受限任务启动及已有I4–I9接口的用途/身份配对，确认不扩大资料范围、无重复任务/记录。复验原输入时刻与精确发布/策略；业务版本不满足应如实等待，不改为最新值。恢复/取消/回执重投和检查点沿原父子事实，缺少合法来源即零新效果。

所属回归、8GiB build/typecheck、lint/format、全仓strict/diff通过后冻结新制品，才在现有物理Chrome用当前游标/错误/诊断引用恢复原父流程。保持五资料准备、现有失败和重试预算，逐项记录真实识别/Agent结果再继续RI/RA。任务仍按全部行为与证据满足后勾选，不把工程测试、预检或已绑定计作业务PASS。

项目AGENTS.md §3及施工图§7要求新公共/内部端口契约及计划外文件先升级。D-53用户已批准的源码和接线已部署v59，工程门禁通过；正式业务仍未通过。新范围由D-54另行提出，不提交、归档或创建verification。
