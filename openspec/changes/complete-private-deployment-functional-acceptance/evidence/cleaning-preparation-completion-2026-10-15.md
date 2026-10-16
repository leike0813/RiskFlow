# D-49 实施与实机续验（v47–v52）

D-49 已批准。完成准备入口的工程检查及独立准备实机收口通过：当前有权用户消费原 v46 已完成任务，未新建任务或增加原任务用量，正式 inputs-ready 已被消费。标准正文补全、新标准库与检索组合已审核发布；v52 正式检索仍为 5/7 通过，dense/RRF Recall@5 不达标，代际 failed、没有 activation。原五现场资料父 RI/RA 及完整功能验收尚未完成，tasks 保持 5/19。

## 实现及工程证据

契约和 HTTP 增加 `engineering-data.complete-identification-preparation`，strict payload 只有完整 `agentTaskRef`，复用原 freeze 能力和成功 DTO。C11 转交 C15，C15 经显式注入的 C08 精确任务读取核对 completed、发起人/工程、冻结输入/策略/预算及结果；正文读取前复验当前资料和空间权限，完整消费 C04 并等待 verified，再复用原快照收口。没有再次执行 Agent。

结果表仅有 SELECT/INSERT；原尝试的 FOR UPDATE 实机返回 42501，现按已批准澄清在原 repeatable-read 事务内取得精确工程/任务 advisory lock，竞争沿原可重试事务重投，不增加数据库权限或迁移。新命令单独审计，决定工件按命令隔离；快照逻辑身份仍由原清单摘要决定。完成事件保持新命令真实因果，宿主通过 C15/C08/C06 原来源及 C03 原运行绑定证明接续资格，独立准备不会冒充父图。

生产文件为 contracts `ports/index.ts`、API `http.ts`、C11 registry、C15 cleaning store 和 `scripts/deployment/start.mjs`，扩展各自既有测试。没有修改普通授权 TTL、旧任务预算、模型、迁移或依赖。

工程命令及结果如下；日志根为实例 `logs/d49-engineering/`，分批结果不累加为全仓测试数。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| contracts/HTTP 既有套件 | 85 项通过 | 辅助 Agent 原工具回执，无独立日志副本 |
| C15 store、entrypoints、risk-flow composition | 3 套件 176 项通过 | `riskflow-d49-regression-final.log` |
| C11 registry | 43 项通过 | `riskflow-d49-registry.log` |
| core access | 9 项通过 | `riskflow-d49-access.log` |
| 最后完成入口/读取前权限回归 | 两次各 1 项通过、33 项未选运行 | `riskflow-d49-completion-last.log`、`riskflow-d49-completion-prebody.log` |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 通过，有既有构建体积警告 | `riskflow-d49-build-ready.log` |
| 8GiB `pnpm typecheck`、`pnpm lint` | 通过 | `riskflow-d49-typecheck-ready.log`、`riskflow-d49-lint.log`及原命令退出码 |
| `pnpm format:check`、全仓 OpenSpec strict | 通过；strict 44/0 | `riskflow-d49-format-final.log`、`riskflow-d49-strict.log` |

中间 stale contracts dist、FOR UPDATE 权限、新测试表格覆盖 fixture 和父因果 fixture 错误均保留原失败日志，修正后再验证。空的定向 lint 日志不能单独证明通过，结论沿原工具退出码及全仓 lint 结果。

## 原任务完成准备

实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。新命令 `physical-complete-original-cleaning-20261015-d49-v47` 于 10:29:39Z 返回正式准备：

- 准备：`identification-preparation-55a5149727ba4883e93d4718bec380fe0141db49@1`。
- 原任务：`agent-task:synthetic-station-tunnel-project:data-cleaning-task-55a5149727ba4883e93d4718bec380fe0141db49@1`。
- 原结果：`data-cleaning-result-55a5149727ba4883e93d4718bec380fe0141db49`，版本 `sha256:cb3e0d6982fce2f5d509b8c0e49e0f7de07b50ca1589925709817f8c514c6ffb`。
- 工程任务数前后均 10，结果引用及完整 budgetLedger 深比较不变。
- `inputs-ready-55a5149727ba4883e93d4718bec380fe0141db49` published、attempt 1，`risk-flow` completed 回执精确指向上述准备。

证据：`standard-cleaning-v47-completion/`、`logs/complete-original-cleaning-d49-v47.log`、`chrome-d49-original-task-completed-v47.png`。截图已查看，显示原任务已完成、信封、工具行动及候选；不能据此声称父 RI/RA 已接续。原五现场资料须走自身准备和原因果，19 资料知识准备不可替代。

## 标准正文及正式发布

沿 D-43 补同条号说明和续表，未改标准版本、条号或废止状态。STD-001 补第 62/69 页说明；STD-002 补第 24 页表 4.2.2 续表和脚注；STD-003 补第 111 页 7.8.6 说明，保留已废止历史标记。正文来自已验证 C11/C04 转换产物，不添加查询词或合成摘要。

物理 Chrome 批准后独立发布标准库 `knowledge-release-04a20112-b67d-42e3-9556-312ccdcfbfae@1`。三个条目分别 10/13/9 个证据、2379/1749/1859 字节正文。机理和案例仍各自沿合格正式准备与发布：`knowledge-release-0a6b0606-31f6-4001-98f2-6f5c727f9886@1`、`knowledge-release-dbf33d14-919f-4f06-a18f-3e650a541504@1`。

证据：`governance-publication-v48/standard-library/`、`governance-publication-v48/knowledge-members-completed.json`、`logs/publish-standard-text-v48.log`。`chrome-d48-standard-v48-review-completed.png` 显示决定成功，但详情仍在刷新；正式发布以 HTTP 回执为准。原发布已经成功后曾误执行重复恢复脚本，按钮因 TASK_ALREADY_DECIDED 禁用并超时，未重复决定；保留 `logs/finish-standard-text-v48.log`。

v49 组合 `knowledge-release-304f6c5c-3170-4299-8043-70b3b5a410ec@1` 的事件被尚在运行的旧 v47 Worker 提前消费。此操作顺序错误已报告，旧记录保留。Worker 停止后，经真实新治理命令和物理 Chrome 再次批准，发布 v51 组合 `knowledge-release-b33e7df3-3b60-4035-a083-7be249731961@1`；之后才冻结并启动 v52 对应策略/数据集。v50 只生成过制品，未运行，不能计作证据。

## v52 正式质量及诊断

`physical-20261015-v12` 数据集/策略只重绑正式成员、组合和版本；query/grade、TopK=5、预取 20、RRF 权重 1/1、模型、预算及七项门槛均保持。深比较证据：`d49-v52-input-invariants.json`。

正式代际版本：`sha256:c34eb72d481908cf564bac2d971fc749dc1bd71b643c8f7f412be9884dc0d1ec`，15 成员，failed，无 activation。正式质量文件 `logs/retrieval-quality/f6298d77-2859-47a0-819e-5a261a142c5a.json`，安全副本见 [retrieval-quality-v52.json](retrieval-quality-v52.json)。

| 门禁 | 实测 | 原阈值 | 结果 |
| --- | --- | --- | --- |
| dense Recall@5 | 0.638889 | ≥0.8 | FAIL |
| BM25 Recall@5 | 0.861111 | ≥0.8 | PASS |
| RRF Recall@5 | 0.666667 | ≥0.9 | FAIL |
| RRF nDCG@5 | 0.900235 | ≥0.8 | PASS |
| 双索引对账 | 1 | 1 | PASS |
| 授权泄漏 | 0 | 0 | PASS |
| Qdrant p95 | 50.236ms | ≤2000ms | PASS |

v51 事件首次消费 10:38:03Z，早于原发布授权的五分钟到期点。消费者回执 completed 只代表消费事实，不能替代质量门结果。outbox 保留 attempt 2 和首轮 DEPLOYMENT_EVENT_FAILED；没有重置事件或失败。首次读取 10:38:16Z 早于代际创建/提交，因而暂时缺代际；10:41:25Z 再读取得正式 failed 状态，不属于未生成代际缺陷。

新鲜真实人类授权下六查询只读诊断 `quality-ranking-diagnostic-d49-v52.json` 复现聚合召回。三个标准条目的 Qdrant contentDigest 与 v48 正式候选经共享 retrievalMemberText 计算的摘要全部一致；六查询的融合前五也符合独立两路排名复算。见 [retrieval-ranking-audit-v52.json](retrieval-ranking-audit-v52.json)。未发现正文漏投影或本次融合前五顺序错误；该诊断不证明所有检索实现均无缺陷。

机理/案例仍分别位于各查询前两名，缺失项全部为标准。一个需要复核的事实是：装备驱动/制动故障查询把 STD-003 标为 grade 2，但该条目仅含 7.8.6 气压作业及 15.5.3 警情报送；不含装备驱动或制动故障条款。其余规范可能是监测依据或通用管理背景，是否必须在纯机理问题的全库前五同时召回，需要区分业务目标与标签。此处只记录疑点，不改原标签、质量判定或算法，后续决定见 [检索验收目标决定稿](retrieval-acceptance-target-decision.md)。

## 当前运行及未完成项

API 保留 `functional-workspace-20261015-d49-v52`、HTTPS 19443；Worker 在取得失败结果后 SIGTERM 停止。制品 SHA256 `816654b2a3ff1dc2102413d7b7719cd1ffb5cd7711af8c26274cd6efa2f2745c`，5998917 字节。HEAD 仍为 `31ad1a2c47a377f20179e0008241034c14a3bec5`，累计 dirty 未提交；制品包含未提交实现，不等于 HEAD 检查点。

原五资料父运行的真实完成准备/接续、检索质量全通过、RI/RA 业务链、functional 报告、完整 Electron/Chrome 场景、重投/重启/恢复和最终门禁仍未完成。不勾 task、不提交/归档或创建 verification；不声称离线介质、三平台或目标 GPU 验收通过。
