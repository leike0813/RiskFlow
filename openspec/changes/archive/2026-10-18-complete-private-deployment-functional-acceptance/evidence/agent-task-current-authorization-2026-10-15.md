# D-48 任务当前授权实施与实机续验

当前进度以[D-49实机报告](cleaning-preparation-completion-2026-10-15.md)为准：原v46已完成任务现已通过新完成入口取得正式准备，任务数及用量不变；新标准库和组合已发布，v52检索仍5/7通过。下文保留D-48时点的真实结果与当时缺口，不代表该准备入口仍待批准。

用户已批准D-48。代码、工程验证及v46启动授权到期后的真实任务执行已通过；v41正式19资料清洗及准备成功，新标准库与检索组合已审核发布。v45质量门5/7通过，dense/RRF召回失败，代际未激活。v46任务完成后的原准备命令重放因普通授权到期而拒绝，尚无v46准备快照；该独立收口问题需要补充设计。tasks保持5/19。

## 实现与工程验证

C08的`readExecutionAuthority`按真实任务和有效Worker租约读取可执行状态、取消和原预算；预算边界复用core既有`limitFor`。C06复用原部署关联与当前权限检查，原受理上下文只作为冻结范围依据，每次模型、工件、工具及恢复读取前签发并审计新的5分钟行动上下文。完整冻结范围撤权也拒绝。宿主在当前授权成功后沿原受理身份调用领域及工件，以维持幂等；冻结身份本身不提供执行资格。普通verify到期拒绝、原租约/预算/人工确认不变，授权事实不保存租约或会话token。

源码限core `agent-runtime/runtime.ts`、C08 `postgres-agent-task-adapter.ts`、C06 `deployment-authorization.ts`及`postgres-local-identity-access.ts`、Worker `agent-runtime/runner.ts`、`scripts/deployment/start.mjs`；扩展原C08/C06/runner/entrypoints测试，无新依赖、迁移或HTTP。覆盖“长时Agent行动按真实任务重新核验当前授权”“Worker统一携带可信任务执行依据”及其到期、资格、统一接缝和失效场景。

首轮六套件241项通过；补冻结边界时测试辅助函数命名错误产生1失败/240通过，修正后C06整文件25项、最终C06/宿主151项及runner23项通过。构建中的readonly数组错误也已修正。8GiB build/typecheck、lint/format、全仓strict44/0、diff通过。未隐去中间失败，日志已复制到实例`logs/d48-engineering/`，文件为`riskflow-d48-{regression-final,regression-complete,auth-final,auth-host-ready,runner-ready,build-complete,typecheck-ready,build-ready,ready-lint,format-ready,strict-complete}.log`。

## 清洗及正式发布

实例根`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，HTTPS19443。v41/v45/v46运行代码制品SHA256均为`022dfd8cfc50208b26c7cbbbf1d867f409b440996d4beebab560851e445ee36e`，5750368字节。HEAD仍`31ad1a2c47a377f20179e0008241034c14a3bec5`，累计dirty未提交，制品不冒充实现提交。

v41策略`physical-cleaning-policy@physical-20261015-d48-v1`；任务`data-cleaning-task-158cefc1276a2a11969f6881915365551627ff95@1`于09:24:22Z创建、09:27:12Z完成：5次模型、4次工具、输入22176/输出1408 token、1候选/114对象。原HTTP命令重放200/succeeded，正式准备`identification-preparation-158cefc1276a2a11969f6881915365551627ff95@1`。未跨5分钟，不能计作到期边界通过。物理Chrome已查看完成及候选/工具行动；证据`standard-cleaning-v41/`、`logs/standard-cleaning-prepare-v41-complete.log`、`chrome-cleaning-task-v41-complete.png`。

三份标准沿合格STD001/003 v38、STD002 v39，不重转。按原条号及对应表格取得真实JSON-LD正文，C17验证、物理Chrome批准并独立发布标准库`knowledge-release-0bef52c9-2358-46a2-b1af-9794ba17c45b@1`。STD001为7证据/1411字节，STD002为10证据/1413字节，STD003为2证据/191字节；原条号、版本、适用性及7.8.6废止历史标记保留。见`governance-publication-v42/standard-library/`。

物理Chrome批准并独立发布组合`knowledge-release-bb87adef-0f52-4f5d-be31-efe86df91bc0@1`，其成员为机理`knowledge-release-0a6b0606-31f6-4001-98f2-6f5c727f9886@1`、上述标准库、案例`knowledge-release-dbf33d14-919f-4f06-a18f-3e650a541504@1`，见`governance-publication-v44/retrieval-evidence-base/`。各成员按自身正式准备验证；没有用19资料准备替代原五现场资料父RI/RA准备。

v41临时标准put在store前因父引用未排序拒绝；v43组合提交因过时base而409/STALE_VERSION。两次失败保留，以符合原排序契约的新v42及实际当前base的新v44命令成功，不改生产接口或旧事实。

## v45正式质量与只读诊断

新策略/数据集`physical-20261015-v10`只重绑正式组合/成员引用；query、grade、TopK、阈值、模型和预算不变。模型和清洗body另作实际深比较，见`d48-v45-model-cleaning-invariants.json`。正式代际`sha256:70edce3311746f928d2827cb9b70ae97e4ef6fccd623cfad5688d3d10f612cf9`，15成员，对账通过，failed，无activation。

| 门禁 | 实测 | 原阈值 | 结果 |
| --- | --- | --- | --- |
| dense Recall@5 | 0.638889 | ≥0.8 | FAIL |
| BM25 Recall@5 | 0.819444 | ≥0.8 | PASS |
| RRF Recall@5 | 0.680556 | ≥0.9 | FAIL |
| RRF nDCG@5 | 0.900718 | ≥0.8 | PASS |
| 双索引对账 | 1 | 1 | PASS |
| 授权泄漏 | 0 | 0 | PASS |
| Qdrant p95 | 51.289ms | ≤2000ms | PASS |

正式报告`logs/retrieval-quality/481221fc-dd7b-4d22-8e68-361a1cd08796.json`。新鲜真实人类授权下的六查询只读诊断`quality-ranking-diagnostic-d48-v46.json`使用共享query渲染、同模型/策略/预算/代际，没有改写或激活代际，不能替代正式报告。对应机理/案例均位于前两名，前五缺失全部为规范条目。dense逐查询Recall为0.5/0.5/0.666667/0.5/0.666667/1；RRF为0.5/0.5/1/0.75/0.666667/0.666667，与正式聚合一致。规范确已投影，其dense排名可在7–15；下一步须核对真实正文覆盖和粒度，不塞查询词、改grade或降低阈值。

## v46到期边界与准备收口

新发布`functional-workspace-20261015-d48-v46`，仅新清洗策略版本`physical-20261015-d48-v2`，Agent模型、预算和覆盖率不变，仍原19资料。真实新任务`data-cleaning-task-55a5149727ba4883e93d4718bec380fe0141db49@1`于09:43:58.175Z创建；启动授权09:43:57.367Z，原5分钟到期点09:48:57.367Z。Worker停止期间查询pending、用量0、行动授权0；未修改时钟、数据库或任务事实。

09:49:04.173Z确认已过到期点后启动同发布Worker，任务09:50:08.803Z正式completed。实际3次模型、2次工具、输入11804/输出263 token、1候选/64对象，activeWallClockMs42112，未扩容。186条行动授权全部在原到期点之后签发；最终有界读取核验全部186条均为300000ms，保留父上下文、精确任务及动作引用。证据`logs/standard-cleaning-progress-v46-1.log`、`logs/task-action-authorizations-v46-{after-expiry,complete,all-verified}.log`及`standard-cleaning-v46/action-authorizations-*.json`。物理Chrome重新登录后已查看正式“已完成”、信封、工具及候选：`chrome-cleaning-task-v46-after-expiry-complete.png`。最初截图仅加载中，未用作终态证据。

原HTTP准备命令`physical-standard-originals-cleaning-20261015-v46`重放401/AUTHENTICATION_REQUIRED。以新鲜真实登录独立复现C06同一invocationId授权，明确SESSION_EXPIRED/authorize.context，排除密码、权限和任务失败；见`standard-cleaning-v46/completion-command-expiry-diagnostic.json`及`logs/preparation-completion-expiry-v46.log`。API按commandId签发，普通C06到期后不续用；C15只在原freeze重放内消费completed结果生成准备。其清单摘要含commandId/idempotencyKey，换新命令会生成另一任务，不能当作旧任务收口。没有伪造快照、改旧授权或用新任务冒充复用。

这是D-48任务执行之外的C15异步收口契约缺口：需明确新鲜授权下消费原精确任务与冻结清单的正式入口，并保留原父运行因果。当前只诊断，未修改该公共接口或普通TTL。Worker任务完成后SIGTERM停止；API继续v46/19443。原五现场资料父运行仍须用自身准备，不借19资料准备补绑定。

正文覆盖核对也发现STD002表4.2.2存在第24页续表、STD001/003同条号说明有未纳入正文的证据；这些受权转换内容可沿D-43构造新候选，但尚未发布或计作质量改善，不把来源覆盖不足断言为模型或检索代码缺陷。

未提交、归档、创建verification或勾未完成tasks；检索、RI/RA和完整功能验收仍未闭合。
