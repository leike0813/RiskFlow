# 清洗上下文与恢复取证（2026-10-14）

历史状态：本文件记录D-34实现及v4/v6/v7失败，不作为当前阻塞结论。用户随后批准D-35并提高新任务预算，v9的16份资料清洗已正式完成；最新代码、发布与证据见 [D-35取证](cleaning-paged-budget-2026-10-15.md)。v7失败记录保留，不回填改写。tasks仍1/14，仅2.1完成；未提交、未归档、未创建verification。

## 实现与验证

- 清洗runtime通过可信loadFrozenInput/readObservation提供真实定位和受权观察，核对任务、冻结清单与策略绑定；保留C06/C04用途、完整消费和verified。定位用公共前缀和按种类分组无损表达，不假定标识格式。消息超限在模型调用前终止，不截断。切片集合外/上限错误按输入或工具预算分类。
- Worker恢复读取每次使用独立审计身份，修复同幂等键却改变requestedAt造成的C04冲突。失败工具重放原intent和输入，实际重试计入累计预算；工具完成回执使用agent-tool-observation包装并保留原领域观察引用。未进入行动的恢复失败正式收口，不重复领取空转。
- 模型输出申请使用剩余额度，正常行动不预留全部剩余重试次数；C08成功和失败均计入该行动实际重试。未知工具异常不再泛化为可重试模型错误。C08事务接缝保留已知Agent错误，C03回滚不变；Worker结算失败保留已经写入的行动回执引用。
- 最终runner/cleaning-model两套件30项通过（21+9），日志runtime-d34-final.log；真实C08数据库13项通过，日志adapter-d34-budget-classification.log。覆盖成功/失败重试、重试耗尽、超reservation结算拒绝与原台账不变，以及恢复证据不可读不继续领取。
- C15真实数据库31项通过（辅助Agent执行），包括同清单观察、异清单/错用途/缺失拒绝及集合外/超页typed错误。部署entrypoints123项通过，日志entrypoints-d34.log。
- 8GiB pnpm build最终通过，日志build-d34-latest.log；九个代码/测试/装配文件的ESLint、Prettier、change strict及git diff --check通过。全仓OpenSpec strict为44 passed/0 failed，日志openspec-strict-d34-final.log。首次构建四处类型错误和时钟测试19/20ms抖动保留；测试仍核验墙钟终止码及实际消耗，不锁定计时器毫秒舍入。

修改为D-34施工图列出的cleaning runtime/store、共享runner/C08 adapter、其四份既有测试及start.mjs。没有依赖、迁移、权限、工具白名单或业务HTTP字段变更。

## 三次实际结果

1. 原v4任务8f153fbb…：修复构建在原v5配置下经正式runOnce领取一次，因原授权SESSION_EXPIRED转为terminal-failure/AGENT_AUTHORIZATION_DENIED。实际model1/tool1、input1521/output300、active5303ms及原历史不变；证据governance-cleaning-v4/d34-terminal-*.json。该运行失败，不计清洗通过。
2. v6任务b3c021bf…：同16来源、原质量、原预算的新版本。在worker.cleaning.model-input-budget终止，model0/tool0。原定位正文64,471字节，外层消息序列化后超过65,536；证据governance-cleaning-v6/task-detail-*.json及input-size-*.json。没有截断或扩预算。
3. v7任务9d545013…：全部595段定位无损保留，定位正文降为22,959字节；纯还原检查exactRoundTrip=true。首次模型选择真实冻结资料及段，原领域工具成功，C08工具回执及原C04观察分别完整verified。第二次模型拿到观察后再次请求真实段，接着预算结算失败并正式终止；只有1次attempt，没有空转、候选、清洗结果或准备快照。

v7两次官网模型usage为输入7,793和8,635，实际累计16,428超过12,288；上下文累计17,267超过16,384。使用原第二次reservation与真实C04回执调用原settleAgentBudget，只读复现AGENT_BUDGET_EXHAUSTED/budget.settle.inputTokens。原C03包装使已保存的任务错误为AGENT_TOOL_FAILURE；原失败路径台账只显示输入7,793。C04原usage仍在，不能把这个数当实际总消耗。证据governance-cleaning-v7/task-detail-*.json、progress-*.json、tool-input-check-*.json、input-size-*.json。

## 发布与物理窗口

实例根：/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical。v8 release为functional-workspace-20261014-cleaning-ready-v8，配置deployment-cleaning-ready-v8.json，同发布清单release-cleaning-ready-v8.json；策略正文与v7相同。运行包3,177,311字节，SHA256 9712619b6d08e83b53a2a35be217137dafdf985a07443882a4724a8c94683502。codeCommit仅实际HEAD 31ad1a2c47a377f20179e0008241034c14a3bec5，dirty摘要另存identity，不称Git检查点或离线交付介质。

清洗策略physical-cleaning-policy@physical-20261014-v5、提示cleaning-prompt@physical-20261014-v3、预算cleaning-budget@physical-20261014-v3。所有max数值与原v3策略相同，保留原5份及治理16份质量引用。Chrome通过真实登录表单重新登录同账号；沿原DISPLAY=:0窗口自然点击v7任务行进入精确taskVersion=1详情，失败状态和预算可见，截图chrome-cleaning-v7-failure-detail.png及physical-visible-*.json。API/HTTPS仍可查看事实；Worker已正常SIGTERM停止，等待预算/定位契约补充后再运行。系统443服务没有重启，独立验收HTTPS仍19443。

## 剩余阻塞

完整清单每次进入模型仍消耗过多累计token；另需在联网前执行本行动剩余额度，并在超额失败时如实结算实际usage。具体待授权范围见[定位分页与预算提案](cleaning-paged-input-and-budget-scope-proposal.md)。不再反复提交相同负载，不把新运行计作旧任务通过。治理发布、检索、RI/RA完整终态、Electron、恢复和正式functional报告均未完成，不计PASS。
