# D-40 检索授权与父图版本实施证据

用户已批准[范围提案](projection-authorization-and-graph-version-scope-proposal.md)。本轮继续原隔离物理验收实例，未提交、归档或创建verification，未修改UI。

## 实现与已完成检查

C06 `assertCommandCause`只增加hybrid-evidence明确分支，沿已有retrieve能力与已登记发布因果关联，其余身份、权限、空间/资料及有效期校验保持。既有C37数据库测试改为两分支共用流程，覆盖同身份重放、错命令、错父上下文、借用另一分支上下文及过期拒绝。

C30 `graphStateOf`读取同运行已登记graphVersion；状态生成也优先保留前次登记版本，防止风险验收事件的临时上下文覆盖原图。既有runtime测试夹具对父图检查点实际核对启动版本，子图仍按自身类型处理。没有依赖、迁移、表或HTTP字段变更。

- 父图原“命令身份绑定”回归在补真实版本校验后变红，见`/tmp/riskflow-graph-version-red-20261015.log`。修后整套父图与组合32项通过，见`/tmp/riskflow-d40-graph-green-20261015-c.log`。前两次运行暴露风险验收追加时覆盖版本的同根因缺陷，原日志保留，不以调整断言绕过。
- entrypoints与PostgreSQL foundation共147项通过，见`/tmp/riskflow-d40-deployment-regression-20261015.log`；批次可能重叠，不累加为业务验收通过。
- 8GiB `pnpm build`及`pnpm typecheck`通过；相关lint/format、`pnpm deps:check`通过（695模块/2329依赖）。全仓OpenSpec strict为44/0。构建仅保留既有前端chunk体积提示。
- C06单测按名称筛选时缺少原顺序测试的密码变更前置，登录失败；转为整文件运行后两分支主体流程通过，但测试参数化遗漏了尾部过期断言的变量作用域。已修为对两个真实派生上下文逐项验证过期，最终整文件24项通过，见`/tmp/riskflow-d40-auth-full-20261015-b.log`。

## 当前部署与业务边界

API已正常SIGTERM切换至`functional-workspace-20261015-d40-v23`，HTTPS仍为`https://localhost:19443`。制品SHA256 `7be287c789e026512e09e793a5204d82983d4b35a8a972c44f8e85aa6df6d9c7`、5738673字节，身份见实例`d40-v23-workspace-identity.json`。工程HEAD仍为`31ad1a2c47a377f20179e0008241034c14a3bec5`加dirty。技术预算与质量阈值未修改。

Worker暂时停止，用于保持原事件状态并准备新正式发布。旧事件过期/耗尽保留，不改成功或重置投递；新组合须重新经物理Chrome正式审核与独立发布，按真实新引用冻结数据集再立即消费。原五份资料工作流已提交准备阶段，尚需通过所属恢复路径继续，不能用existing回执或空总览查询充作识别终态。

## 实跑继续结果

新组合`knowledge-release-4f7ec838-549a-4d35-bdac-f415616a06aa@1`已在物理Chrome正式审核、独立发布（`governance-publication-v24/`）；同阈值数据集v4与新制品v25精确重绑，Worker立即消费。原授权拒绝已消失，真实embedding、15成员双索引写入及对账走到质量阶段；质量门报`generation-not-found`。提交后所属adapter可以读到同一代际及failed状态，未激活。这是质量门事务内创建、事务外窄读不可见的问题，[D-41接缝提案](retrieval-quality-transaction-scope-proposal.md)已请求批准；不跳读取、改阈值或改写本代失败。

父图原线程按已有runtime恢复能力、新的真实当前会话授权及已登记状态版本继续。先复现`Node preparing does not exist`，修复graph.recover使用既有阶段到节点映射；新增真实PG/检查点回归先红后绿，整文件18项通过。v26实跑又捕获恢复授权引用覆盖历史启动引用，导致C03原绑定被正确拒绝。节点更新现保留检查点启动引用，当前恢复授权继续独立复验、实际业务审计仍用当前授权；C03和C06的匹配条件没有放宽。测试夹具复验历史引用稳定，原伪造阶段用例保持合法启动引用后继续验证阶段拒绝，整文件18项通过，见`/tmp/riskflow-recovery-authorization-green-20261015-b.log`。

最终v27已重新build并冻结，SHA256 `6dba6166292fdb0083d08ded7ff7acc215f629836fdd8ba22a6c0b545af5a96e`、5738723字节，API已正常切换至`functional-workspace-20261015-d40-v27`。原运行`risk-flow-run:synthetic-station-tunnel-project:identify-and-assess:035157af5173eb1e3025be0da1894fa9@035157af5173eb1e3025be0da1894fa9e5722fd386597b6193bea4ab0a53fde6`正式恢复到`waiting/identification`，精确等待点为knowledge-preparation，见实例`business-chain-v27/recover-1792038858275.json`。这证明原线程恢复路径成立，不等于识别、风险记录或评估完成。Worker仍暂停，D-41待批准，不在旧failed代际上改写成功。

任务维持5/19。检索质量、识别/评估、C19真实组装/审核/发布及assessment-basis、其余Agent、完整functional/Electron和重启恢复仍未通过。
