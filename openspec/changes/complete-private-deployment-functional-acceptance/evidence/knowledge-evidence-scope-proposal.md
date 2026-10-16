# C17 准备范围与逐项取证身份修复提案

状态：用户已随原件与Agent界面方案批准实施，归D-38。D-35已实现且16份资料正式清洗完成；本提案不再调整预算。

## 实机复现

正式process-model候选已经provision写入C04，资料版本、595个保留段及准备快照真实存在。HTTP提交返回BUSINESS_BLOCKED，所有工序/依赖边为evidence-ineligible。相同候选补齐16份来源声明后另返回TERMINAL_FAILURE；该错误引用没有对应可读取诊断工件，不把虚拟引用当证据。

原生产composition下的临时诊断只包装公开方法、不修改源码，确认每次C17 readExactPreparation均返回AUTHORIZATION_DENIED。原因是C17请求没有声明范围，composition将缺省范围写为[]；而C15精确读取复验整个准备快照的空间与16资料范围。没有增加权限即可复现修正效果：使用同一实际账号，以原快照精确范围签发C06，第一组资料段全部eligible。

随后用相同requestId检查第二组不同证据，C11明确返回IDEMPOTENCY_CONFLICT，C17将其投影为segment-not-readable；使用独立requestId再次读取同组，全部eligible。程序 `reproduce-c17-reader-scope-and-identity-v10.mjs` 的assert与安全回执通过。原提交回调对全部节点与边固定使用 `${commandId}:evidence`，因此即使闭合范围，也会误拒绝后续项。

另发现C17验证工件的put命令只按packageDigest固定身份，却携带每次提交的issuedAt及authorization；同候选新提交改变请求载荷会与原C04幂等身份冲突。不会清除旧失败或强行重投原键。

## 最小修复

1. 由受信宿主来源解析器提供当前请求/任务已经声明的空间与sourceVersion范围，C17内部composition在请求未声明范围时使用这份冻结范围；显式范围仍按调用者声明。字段仅属内部受信来源接缝，不能从HTTP/模型直接接收授权上下文。C06继续复验当前账号、工程、分支及父范围；空范围、撤权、错工程/资料必须拒绝，不能扩大权限。
2. 每次不同领域证据校验使用独立、可重放的派生读取身份；同候选逐项读取不互相占位，原C11/C04幂等冲突不被忽略。
3. 验证工件put按本次提交命令隔离身份，内容继续保存packageDigest。相同提交可重放，新提交不覆盖旧工件或旧验证。

## 文件与验证

拟纳入IP-19：`apps/worker/src/identification-knowledge/composition.ts`及既有composition测试；`packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`及既有真实数据库测试；`scripts/deployment/start.mjs`及entrypoints既有测试；本change的design、implementation-plan、相关delta和安全证据。不新增依赖、迁移、业务HTTP字段、权限策略或模型工具。

验证使用当前公开接缝及既有测试：多来源准备快照下的正确读取、多个不同证据组、同候选新提交与相同命令重放；错工程/撤权/集合外继续拒绝。最终构建新制品后，用原16来源与质量、已冻结D-35预算重新提交知识候选，再沿原人工审核发布继续验收。旧失败保留。

升级理由：implementation-plan §7的精确文件清单未包含上述C17 adapter与Worker composition，原D-35也只批准清洗/预算/网关文件。项目规则要求“计划外公共契约/依赖/迁移/文件……必须升级”；[openspec-apply-change SKILL.md](/home/joshua/Workspace/Code/JavaScript/RiskFlow/.agents/skills/openspec-apply-change/SKILL.md)要求“When a task needs work beyond what the spec describes, surface the added scope and pause”。因此仅暂停本提案所涉生产源码修改，继续可以独立进行的C18配置治理准备。
