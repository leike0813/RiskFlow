# D-47 正式 JSON-LD 读取修复与续验

状态：D-47已批准并完成生产修复、工程门禁及C15/C17回归，v40实机19资料冻结读取成功。本文记录v40历史节点：该任务20次模型/工具后因原5分钟授权到期终止。后续D-48已批准并取得v41正式准备/知识发布及v46到期后任务completed证据，当前仍有检索质量和准备收口缺口，见[D-48报告](agent-task-current-authorization-2026-10-15.md)；tasks仍5/19。下文D-48“待批”和API v40是历史状态。

## 范围与实现

文档转换Schema导出`STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1=16*1024*1024`，C15复用其原16MiB文档上限。通用reader按调用者传入上限读取，观察、清单及工具输出仍按原边界执行。

C17内部`readContentArtifact`缺省仍为4MiB，仅`checkStandardRetrievalText`中精确证据涉及的转换JSON-LD显式采用16MiB；该条目累计工件读取也限16MiB，包含清洗清单。清单、候选包及其它读取仍为4MiB。文档缓存仅限当前条目涉及的精确资料，不跨条目或全库读取。超限拒绝，不截断；当前授权、准备绑定、资料保留资格、C04完整消费及verified、证据顺序和正文一致性不变。模型、工具输出及检索质量预算不变。

源码限core文档转换schema、C15 store、C17 adapter；测试复用既有C15/C17文件。只同步当前change，不改主规格、依赖、HTTP、迁移或权限。

## 工程验证

`pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`：33项通过。此前针对C15错误4MiB钳制的有效红灯为完整文件1失败/32通过，修复后33通过；旧failed任务的再次读取返回ARTIFACT_ACCESS_DENIED，不作为绿灯，须由新正式任务验证。

`pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`：22项通过。扩展同一真实正文用例，合法5MiB文档通过；恰为16MiB文档加清单累计超额和超过16MiB文档均拒绝；合法结构的候选包超过4MiB仍拒绝。原精确正文、错快照/版本、撤权、损坏读取继续覆盖。大文档测试使用同一受权资料和Schema合法的合成表格字段，不复制原标准正文；没有另建多资料fixture或辅助层。

`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`及同额度`pnpm typecheck`通过；`pnpm lint`、`pnpm format:check`、`pnpm exec openspec validate --all --strict --no-interactive`（44/0）及`git diff --check`通过。补充C17测试后再次typecheck及定向lint/format通过。构建保留原大chunk提示。日志为`/tmp/riskflow-d47-{build,typecheck,cleaning-tests,knowledge-tests,lint,format,strict,final-typecheck,final-lint,final-format}.log`，副本保存在实例`logs/d47-engineering/`。

## 新制品与实机接续

实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。本轮冻结发布`functional-workspace-20261015-d46-v40`，包含D-46的C15读取修复及D-47共享边界；运行制品SHA256为`3773cea4881cff2282d8e9aa28e751da1c8679a919fcfa72ca3e5f18dfa6679f`，5993302字节。发布标签沿用已准备的v40脚本，不表示仅含D-46。C17扩展测试仍在准备时先接续已通过回归的C15路径，C17送审没有提前执行；随后C17整文件22项通过。运行制品生产代码未再改动。HEAD仍为`31ad1a2c47a377f20179e0008241034c14a3bec5`，累计dirty未提交，运行制品不冒充固定实现提交。

新清洗策略`physical-cleaning-policy@physical-20261015-d46-v2`保留Agent配置、覆盖率和保留率，新任务命令`physical-standard-originals-cleaning-20261015-v40`沿原19资料集合；STD-001/003使用合格v38引用，STD-002使用合格v39引用，不重复转换。v39失败任务及日志保持，不复活、不重置台账。

API/Worker已切换v40，通过原HTTP入口及物理Chrome会话创建新任务`agent-task:synthetic-station-tunnel-project:data-cleaning-task-160542df395742c8da8084bc7dc64e7fa788ea8b@1`。首次422/BUSINESS_BLOCKED属于等待清洗，不是准备成功。新任务受权冻结读取实际成功：全部19资料可读，STD-002有1721段及11张未识别表格图片。实机绿灯日志`logs/standard-cleaning-frozen-v40.log`，不会把旧failed任务的ARTIFACT_ACCESS_DENIED探针误称通过。

物理Chrome任务详情完整加载，运行头部、任务信封、工具行动及资源分区可见；父Agent已查看稳定截图`chrome-cleaning-task-v40-stable.png`，初始加载中的旧截图不作为完整详情证据。条款定位按真实正文条号及关联表格准备，未消费query/grade拼造正文，尚未发布新标准库。

新任务在`08:41:44.122Z`正式failed，safeError为`AGENT_AUTHORIZATION_DENIED/deployment-context`；已用20次模型/20次工具、输入88499 token、输出5605 token、对象513，没有候选或准备终态。C06同一上下文复验明确返回`SESSION_EXPIRED/verify.context`，签发时间为`08:36:44.025Z`，与固定5分钟TTL吻合。详见待批[D-48提案](agent-task-current-authorization-scope-proposal.md)。这是独立授权接缝缺口，不把D-47读取成功等同清洗成功，不改全局TTL或绕过撤权。

API继续v40/HTTPS19443，Worker在失败后已SIGTERM正常关闭。保留失败台账，等待授权设计批准后以新任务续验。原五现场资料父运行仍保持自身准备和因果入口，不用19资料知识准备替代。
