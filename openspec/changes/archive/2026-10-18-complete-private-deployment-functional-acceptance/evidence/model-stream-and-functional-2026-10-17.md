# 会话流与functional实机取证

当前已接续至v164，任务10/19，四项新增收口及C19原命令实机修复见[逐任务证据](task-closeout-2026-10-17.md)。下文各轮6/19保留为历史时点；完整functional及Electron仍未通过。

本轮已接续至v163，当前结论见 [v163验收接续](resume-v163-2026-10-17.md)：两份functional为PASS/queryCount1，最终Electron选定13项为12通过/1个SSE失败，关窗继续尚未执行。以下v162及更早记录保留各轮实际边界。

当前正式宿主及完整任务进度见[handoff.md](../handoff.md)，设计问题统一维护[defensive-design-ledger.md](defensive-design-ledger.md)。当前为v162：D173正常导航取消处理、D174报告来源透传及D175合法运行编码路由上限均已部署。v160完整browser为90/90通过（14.0m，无重试/跳过），之后D174报告定向1项通过、D175 HTTP shell/SSE 55项通过；不把旧完整轮说成最终版本全量回归。正式SSE在v161返回414、v162返回200/text/event-stream并收到同次事件，证据`d172-functional-desktop/sse-http-v161.json`、`sse-http-v162.json`及`sse-owner-diagnosis-v161.json`。

`d172-functional-desktop/operator-observation-v6/functional.json`为真实CLI PASS/queryCount1，包含同次资料交付、overview和export，但启动沿领域幂等返回原4d31ceff…completed运行，只证明该工具组合与历史重放。v8/v9显式capture不存在的agentTaskRef而BLOCKED，不能手补报告或当作活动任务。v162真实Electron共享对象、JSON工件下载、越界导航三个定向用例已通过；完整关窗继续与SSE游标重连仍未完成。当前仍6/19，无verification/提交/归档。以下为分轮历史，文中“在途”只代表该轮时点。

## v158–v159轮记录

正式隔离宿主`functional-workspace-20261017-d166-v158`保持原HTTPS/CA、migration000059、模型/策略/图版本。v157的API/Worker均SIGTERM正常stopped/count0；v158 API session55381、Worker6085。新制品5808487字节，SHA-256 `ad74459bb0fe6121001f6de4697b392b6bfd0a45590afd8b820c15ba9b860127`，tracked源码/测试diff `7b00f02b6fc5519202899147a2d481dbcbaeab778ac83b94e68a17152fc2776a`，tar比较及正式预检通过。

D166真实初评A3在C04父工件校验拒绝的根因已修复：决定工件使用自身行动当前授权，继续继承全部规则父工件。C25原38项、宿主组合根63项、8GB构建、lint/格式/strict/diff通过；555真实初评及回执丢失重试浏览器用例通过（1项、1.3分钟）。修复前全量81通过/9失败，失败trace保存在受限目录`d166-browser-assess/full-run-final-traces`；修复后全90项仍在运行，不提前写PASS。

C05会话流通过当前真实人员授权及正式宿主模型网关执行，6个连续增量、195字节用户可见文本，正常stop；MiniMax-M3.1-Flash-Preview实际224输入/36输出/260总token。maxOutputTokens4096，固定conversation/prompt/budget版本，原始响应由C04登记且经当前授权完整读取、SHA-256一致，未保存思考字段。本项仅证明C05流式调用，不冒称Agent任务完成或交互写命令确认通过。受限证据`d166-conversation-stream/request.json`、`result.json`，原响应`model-physical-conversation-stream-v158-model-raw-response@sha256:cbe8f53ac00eed528b757ed114e41e4337f957977b70e8a1350a61f0ac7232a4`。

真实functional首次执行在登录400/CONTRACT_INVALID，业务步骤未发送，原输出`d167-functional/before-origin-fix`保留。D167在共享synthetic请求函数发送服务端要求的同源Origin；现有测试替身按同一规则先红（7失败），修后synthetic/functional全部62项通过。修复后真实命令受理并完成新评估，C31摘要携当前状态版本，无法精确匹配启动回执，观察正确BLOCKED，见`after-origin-fix`。D168复用已有C34运行详情：原runRef与stateVersion明确分开，只接受同次精确runRef与正式run-result引用。工具63项、lint/格式/strict/diff通过。

`d167-functional/owner-observation/functional.json`真实CLI为PASS/queryCount1，已提交步骤与观察由CLI自己生成。启动回执为`risk-flow-run:synthetic-station-tunnel-project:assess:4d31ceff8125cc57da300f61785fa7ca@4d31ceff8125cc57da300f61785fa7ca80d61427a157210223bf56d252018c9a`，C34同次详情completed，正式`assessment-run-result`版本`f4e8aee715e355a7bbd8fd2b058148e11255db47fb1be8e38630dffde1124aff`，完整引用见该报告及`assessment-owner-read-v158.json`。新受限配置`owner-run-config.json`、`owner-functional-config.json`不手造run.json、不塞入旧回执。此PASS仅覆盖评估链路，不代表完整functional场景。工具源码已不同于v158制品，最终冻结待后续验证。

新全量browser中555初评重试、681取消零写及927独立行动已通过；1052在登记反馈后的分段出现500，独立诊断进程`/tmp/riskflow-d169-browser-diagnosis.log`在途。未把新失败或尚未完成的全量回归写为PASS。

整体tasks仍6/19。完整functional覆盖、全部真实Electron、可见权限/追溯与故障恢复运维尚未因此通过；无提交、归档或verification。本文仅含安全身份和结果，凭据、Cookie、资料正文、模型响应及内部思考不复制到仓库。
