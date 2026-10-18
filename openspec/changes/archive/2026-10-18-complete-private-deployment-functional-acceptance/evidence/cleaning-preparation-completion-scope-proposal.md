# 清洗完成后的准备收口入口提案（D-49，已批准）

状态：用户已批准，纳入IP-19及原父运行接续的IP-21；实现、工程验证及原v46任务的独立完成准备实机验证通过，原父图接续仍待实机取证。续验标准正文和发布已完成，v52原七项检索门仍5/7通过、代际未激活，见[实机报告](cleaning-preparation-completion-2026-10-15.md)。实现澄清：结果表仅SELECT/INSERT，FOR UPDATE需要额外UPDATE权限；同一C03事务内改用按精确工程/任务的advisory lock串行核对，保留原repeatable-read、原提交边界及追加事实。竞争事务按原可重试事务失败收口并由原命令重投，不增加数据库权限或迁移。

## 已复现的问题

D-48实机任务`data-cleaning-task-55a5149727ba4883e93d4718bec380fe0141db49@1`在原启动授权到期后领取并completed；186条新行动授权均在原到期点之后，期限仍5分钟。其原准备HTTP命令在任务完成后重放401。新鲜真实登录独立调用C06同一invocationId仍返回SESSION_EXPIRED/authorize.context，见[实机报告](agent-task-current-authorization-2026-10-15.md)及实例`standard-cleaning-v46/completion-command-expiry-diagnostic.json`。

`apps/api/src/app.ts/runBusiness`按commandId签发普通上下文，C06原授权到期后拒绝同身份续用，行为符合D-48保留的安全边界。C15的`freezeIdentificationPreparation`既启动任务，又只在原freeze重放时调用`#finalizePreparation`消费结果；清单和任务摘要含原commandId/idempotencyKey，换新命令会创建另一任务。现有入口缺少“当前有权用户消费原已完成任务”的操作。不能把任务成功等同准备成功，也不能用新system身份、延长TTL、重写旧命令或另跑一次代替修复。

## 建议批准的契约

1. 在既有`EngineeringDataPortV1.freeze`增加strict分支`complete-identification-preparation`；HTTP命令为`engineering-data.complete-identification-preparation`，复用既有`engineering-data.freeze`能力。payload仅含完整类型化`agentTaskRef`，不接收任意清单、结果、路径、父运行、资料集合或可替换策略。使用新的commandId/idempotencyKey和当前真实会话授权，普通旧命令仍按原期限拒绝。成功返回原有`identification-preparation`结果形状。
2. C15从本模块正式清洗结果索引找到精确任务、清单及结果引用；通过显式注入的C08精确任务读取核对completed/data-cleaning/embedded、工程、原发起人、冻结输入、策略/模型/预算及结果引用。不存在、未完成、失败、取消、错任务/工程/发起人或版本不符均拒绝。原发起人同一且当前仍有权是本次收口边界，不新增转交任务能力。
3. 先验证新命令及当前权限，再按原用途读取C04清单/结果，完整消费并等待verified；从已验证清单导出精确工程修订、空间和资料范围并再次复验当前资格。新授权范围须覆盖原冻结范围，不能补共享、扩大范围、替换已冻结监测/转换/策略，亦不重新计算来源或重跑Agent。输入上限沿原清单/结果读取预算；失败不产生快照或inputs-ready。
4. 复用C15覆盖/排除决定与快照收口，原清单摘要仍决定唯一逻辑snapshotRef，不把新命令变成另一任务。新命令负责当前操作者、授权、提交时间与审计；原清单、任务及结果保持不可变。已存在快照时，在当前授权复验后返回原快照，另记录本次命令回执；同键异载荷冲突。并发收口以C15自有结果行在既有C03提交事务内串行核对，快照及inputs-ready只成立一次。提交前所需决定工件使用本次完成命令的独立写入身份，避免并发新授权之间的C04幂等冲突；失去竞争的命令只引用首次正式快照，不覆盖它。
5. inputs-ready保持现有DTO，producer/causation为真实完成命令，不能伪装原命令事件。部署组合从C15精确快照→原任务/清单窄读取得原受理来源，再通过既有C06来源/关联和C03运行绑定证明核对原父运行。原独立人类准备继续按独立分支消费；原父图准备只续接已证明的同一父运行，不接受客户端指定或用19资料准备代替原五资料准备。当前事件授权来自新完成命令，旧授权仅作不可变来源证据，不能提供执行资格。若原因果无法证明，拒绝事件消费，不猜测父运行。

本提案不修改C06普通到期语义或D-48任务租约语义，不允许completed任务继续以执行租约授权；不新增表、迁移、依赖、角色、通用重授权API或工作流状态机。

## 文件清单与复用

- `packages/contracts/src/ports/index.ts`及既有契约测试：freeze分支、payload及branch→既有capability映射；不复制Agent/准备Schema。
- `apps/api/src/http.ts`及既有`apps/api/test/http-shell.test.ts`：新正式command路由/strict映射，原HTTP身份语义保持。
- `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`及既有store测试/同目录fixture：完成入口、精确C08读取依赖、当前权限与C04读取、复用收口/并发/原因果窄读。必要导出仅限该目录`index.ts`。
- `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`及既有测试/fixture：既有freeze路由转交新分支，不跨层直接修改C08。
- `scripts/deployment/start.mjs`、`composition/api-ports.mjs`、`composition/risk-flow.mjs`及既有entrypoints/risk-flow-composition测试：注入C08/C15精确窄读，新完成事件按真实原受理来源验证独立或父运行因果，沿原C06/C03校验，不改历史记录。
- 当前change的proposal/design/implementation-plan/handoff、C15/C11/HTTP局部delta及安全证据；实例新增正式完成命令和回执。没有Web界面打磨、锁文件或主规格改写。

如果核对发现上述方案需要改变C06权限语义、事务隔离/迁移、事件DTO、额外公共字段或范围外文件，先升级，不以本提案笼统授权。

## 验证与续验

先在原adapter/HTTP/宿主测试复现跨5分钟任务完成后旧命令拒绝、正式完成入口缺失的行为边界；实现后验证新鲜授权可消费原任务、相同snapshotRef、单次事件及完整因果。覆盖普通旧授权继续到期拒绝、撤权/停用/安全版本变化、错工程/主体/任务/策略/输入/结果、未完成/失败/取消、C04损坏/超限/缺权、同键异载荷、并发及回执失败重投；检查不增加模型调用或预算用量。父图与独立准备分别取证，假父运行拒绝。

通过所属contract/adapter/HTTP/deployment回归及8GiB build/typecheck、lint/format/strict/diff后冻结新制品。在当前v46已完成任务上用新鲜真实登录执行正式完成命令并读取准备，不能再建任务冒充复用；任务数、结果引用、用量和旧失败保持，Chrome查看结果。随后沿D-43已批准范围补同条号说明及表4.2.2续表的真实证据，C17人审/独立发布并复跑原7项检索门；不承诺必然达标，不改query/grade/TopK/模型/预算/阈值。

## 批准边界

项目`AGENTS.md` §3及施工图§7要求新公共契约与计划外文件先升级；用户已批准本提案。实施保留现有安全、预算和质量边界，不提交、归档或创建verification。
