# 清洗模型输入与失败恢复补充提案

状态：用户已授权修复。原C04补充、D-32目录/Agent界面读取和D-33 DOCX字符引用修复均已完成工程验证及对应实跑；本提案处理16份治理资料清洗的新阻塞。

## 已核实的失败

- 正式任务 `data-cleaning-task-8f153fbb8f2c132fe5f1af0ed57658f345b4c368`，版本1。action1模型调用完成，action2领域工具失败，错误码AGENT_MODEL_FAILURE。实际用量停在模型1、工具1、输入1521/输出300 token、活动墙钟5303ms，没有候选或正式清洗结果。
- 真实C04已完整verified的action2意图把 `data-cleaning-manifest-8f153fbb…@sha256:9ce33ccf…` 当作source-version，请求不存在的 `manifest-preparation-slice`。其引用不属于16个冻结资料版本，工具拒绝正确，不能改映射或权限让它通过。
- `cleaning/runtime.ts` 模型消息仅包含清单工件引用、上一观察工件引用，现有两种领域工具不能按这些工件引用读取清单。模型没有可用于选择工具的真实资料/段身份，也不能获得上一轮观察的内容；该缺口不能由提示词要求“不要猜”修复。
- Worker在失败后反复领取同一任务，安全快照已记录644次attempt，未新增模型/工具调用，任务却继续running。已停止本实例Worker；API、HTTPS、数据库和证据保留。恢复读诊断现被C06部署上下文复验拒绝；最初循环的精确失败路径还需在隔离夹具复现，不能把当前拒绝归因为已证明的单一原因。

## 拟补充的施工范围

| 文件/接缝 | 动作 |
| --- | --- |
| `apps/worker/src/engineering-data/cleaning/runtime.ts`及既有runtime测试 | 模型渲染前经可信reader获取冻结集合内的真实资料/段/样本定位，以及当前观察的有界内容。正文仅来自原受权切片；不把正文复制进任务信封，不给模型通用工件/文件/数据库工具。消息、长度与token继续受冻结预算校验。 |
| `apps/worker/src/engineering-data/cleaning/composition.ts`、`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`及既有测试（仅必要接缝） | 复用原loadFrozenInput、精确C04读取和领域切片事实，提供模型输入所需的当前受权有界视图；保留C06复验、父继承、verified和源集合约束。 |
| `scripts/deployment/start.mjs`及既有entrypoints测试 | 装配reader，继续共用原模型网关和五类任务注册表。 |
| `apps/worker/src/agent-runtime/runner.ts`及既有runner测试 | 用真实失败行动与重复claim夹具定位恢复缺陷，修复可重试失败的同动作/同预算恢复及不可重试失败收口；不得循环空转、重置累计预算或把输入/权限错误泛化为模型临时故障。 |
| `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`及既有测试（仅需要时） | 只有重复claim/failed-action真实集成证明adapter缺陷时修其状态/恢复接缝；不引入迁移或改既有事实。 |
| 当前change design/implementation-plan/delta/证据 | 映射IP-19/IP-21；工程通过后在原物理显示器继续取证。 |

不新增公开HTTP/DTO字段、工具白名单类型、依赖、迁移或权限策略，不扩大模型、候选、工具和墙钟预算。旧失败和attempt保留；只有原契约允许的恢复才续接旧任务，若输入/策略修订必需新任务，则冻结新版本并明确记录，不把重投称原运行通过。

实施前补design与施工图；工程验证包括真实定位可用于调用、观察内容受权读取、集合外/撤权拒绝、失败恢复在预算内收口及重复claim不空转。完成后恢复Worker，按正式任务终态判断是否可继续治理发布。若需额外公共契约/授权设计再次升级。
