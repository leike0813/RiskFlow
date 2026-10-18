# D-189/D-190批量验收收口（2026-10-17）

合成样本，待甲方复核。当前功能任务 **17/19**；2.2、5.1及6.1已闭合，6.2尚缺授权Git检查点，6.3尚未生成verification。本报告不是最终功能PASS或C38交付PASS。

受限实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。下列实例路径均相对该根。安全汇总为`d190-closeout/report.json`，20份原日志及SHA索引已耐久保存到同目录；秘密、Cookie、原文、模型响应和trace不复制到仓库。

## 当前发布与修复

实际发布`functional-workspace-20261017-d189-v173`，配置/清单`deployment-d189-v173.json`、`release-d189-v173.json`，migration000059；API4002019、Worker4002641、Caddy3849343，原HTTPS19443。Electron44.7.0，可见Chrome155.0.8059.39，桌面会话`:0`。制品6,066,039字节，SHA256 `ac1a7343b9763f7631522f3e275e4d85ce8d4ac37cb13c5fedb872e5bd7ecd7a`，打包时tar逐项比较通过，收口时制品摘要再次匹配。

HEAD仍为`e2dfe433a54d042d09d2ea2e31dc6c3e5c0adc43`，它不包含本轮未提交增量。打包时source/tests差异SHA为`8498658d9175024b12854b896c4fee0233213ddfd3e233394e4893dcd16b60b1`；其后D190只改桌面测试输入/断言与文档，生产运行物保持。当前差异及12个生产文件逐个摘要另存`d190-closeout/report.json`，不把旧HEAD说成最终实现检查点。

D184–D189已统一部署：恢复操作归属及独立调用会话、cleanup全部尝试；functional唯一主结果与只读观察身份；公开现场工件冻结、所属动作当前授权、父子传递与多空间配对恢复；入口身份绑定空间→现场关联。旧无现场身份保持，模型、预算、三项约束及所有旧终态/备份/双根保留。D188客户端测试等待原生文档及可见会话状态，不把无登录框误当已登录。

## 2.2：14个桌面场景的实际证据

完整命令为`pnpm exec playwright test -c playwright.desktop.config.ts`，环境显式指定本次deployment/release、desktop-build、desktop-acceptance及私有CA，DISPLAY=:0、retries=0。输出目录通过`--output`固定在`d189-desktop-active/full-v173-results`，原日志`d189-desktop-active/full-v173.log`及`d190-closeout/desktop-full.log`。

本次完整批次13通过、1失败，无skip。13项包括全部预检、关窗续接、启动、错误/正确口令、独立共享会话、资料读取、报告/原件实际保存及字节校验、Agent入口、真实不可信TLS拒绝、越界导航、撤权后读取关闭及成员恢复。原失败为SSE样例事件不足，保留原trace，未将该命令exit1改写为exit0。

原活动父运行`risk-flow-run:synthetic-station-tunnel-project:assess:5ca19a67f0963515357a72b3d7813994@5ca19a67f0963515357a72b3d781399466bf145447a510532f58630f1385afda`。正式任务精确引用见`desktop-preflight.json`。本轮先在Worker停住时SIGTERM原API，确认stopped/count0并以同发布重启，API自省401就绪后才启动Electron；原生关窗后只启动Worker。原任务completed，验收驱动读取C08正式结果及C34当前stateVersion后显式发送原`workflow.resume-run/agent-task-completed`，200且原父completed。该完成通知不是Worker自动发送。相关文件为`same-release-api-restart.json`、`worker-after-client-close.json`、`task-completion-notification-request-c.json`、`task-completion-notification-result-c.json`及`post-notification-parent.json`。

SSE只读登记证明该评估父只有1条assessment.recorded事件，不能满足2+2前置。D190显式提供同工程已完成识别运行的事件流身份及读取快照，当前会话经C33核对精确快照completed后订阅。事件流运行实体为`identification-run:synthetic-station-tunnel-project:risk-flow-run:synthetic-station-tunnel-project:identify-and-assess:df1a0a84ec47d2cef9e8e78f02f894f1`；事件身份版本`7f65c2d982036d22879a8cf354d7fac186eb8dec0b52830264bef3574bcd0d54`，C33读取快照版本`268243098b1f67d35ca5f867be4f62e5d75d3a0ef912f19260fbe89235a39eb2`。两者属同一实体，分别固定；实际登记22事件。第一次D190误把状态快照当事件身份，收到空流，失败保留，未改变服务端版本匹配。

定向命令为同一环境下`pnpm exec playwright test -c playwright.desktop.config.ts --grep '预检边界|SSE：'`，输入`desktop-acceptance-sse-d190-b.json`，输出`sse-d190-b-results`。2通过、16.2秒，含新增错实体/不完整输入拒绝及SSE真实2+2。两次订阅保持同一精确事件流身份，续页无重复标识、正式HTTPS/SSE200、不重发业务写命令。日志`d190-closeout/desktop-sse-final.log`。本轮所有14项均有通过证据，证据组合是完整13项与定向SSE；没有声称单次完整14项exit0，不为重建活动前置重复调用模型。

## 5.1：可见Chrome及桌面对齐

`d189-visible-acceptance/report.json`与三张实际窗口截图记录：真实登录后在预警详情自然打开正式确认对话框，确认命令200/succeeded，界面显示已确认及审计；点击实际关联评估链接到达同一记录，当前正式读取成功；页面内无会话请求401。预警`0ebd53d4-947f-4406-b470-b7a7802e1ea9@1`，关联评估`risk-assessment-record-3d36e448906aa985a76ecabdcdcda6c41a2fd69c46fe808162c9637f96e321f5@1`。两客户端使用同一HTTPS/数据库/正式对象，未造第二业务实现。

完整browser已90/90通过、无flaky或重试，原日志已归档为`d190-closeout/browser-final.log`，本轮未改Web生产代码，未重复90项。Chrome回执丢失及原信封重放、确认和Outbox各一条见`d187-visible-response-loss`；5.2/5.3仍沿原正式报告，不重做已通过恢复或重建。

## functional及工程门禁

本次functional先awaiting-human，原synthetic为SUBMITTED且捕获原任务；同一输出目录`--resume`后PASS/queryCount2，`d189-desktop-active/observation/functional.json`。没有新发模型/业务链或把旧失败父改判。完整识别、评估、预警、建议、预测、执行/反馈、偏差/校准及五类任务仍由`d183-formal-observation/observation-b/functional.json`七目标PASS与`d184-formal-reference-index-b/query-reference-index.json`15项正式查询逐边补证。

| 检查 | 实际结果与归档日志 |
| --- | --- |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck` | 通过；build.log、typecheck.log |
| 统一deployment/adapters/core/worker/HTTP回归 | 24套件572项通过；unified-regression.log，包含完整test:deployment范围 |
| 逐场景疑点的既有测试统一补证 | 9套件236项通过；scenario-closure.log，含清洗并发/图片、MinerU包边界、模型额度/usage、校准绑定及Agent纠错 |
| lint、format、deps:check、deps:policy | 通过；lint.log、format.log、deps.log、policy.log |
| `openspec validate --all --strict --no-interactive` | 44/44通过；openspec-all.log |
| 原完整`pnpm verify` | build/typecheck/lint/format通过，测试2735通过/1失败/3外部smoke skip，exit1；original-verify.log |

原verify唯一失败是与归档减负D04冲突的C11清单篡改断言，按D184删除后，该所属套件与本批受影响回归、后半工程门禁通过。没有再运行17分钟完整verify，也没有声称最终monolithic verify exit0。各批有重叠，不能相加为全仓覆盖；外部smoke skip不充作外部服务通过。

唯一限定审计Kuhn已完成并关闭；恢复会话与跨空间配对两项普通缺陷在其活动任务中修复并完成163/60项回归，父级升级的入口配对身份已由D189实现并纳入572项统一回归及v173制品。审计覆盖授权、持久化、集成与必要性能边界，不再派第二次审计。源码摘要与审计日志已归档，Git检查点及最终verification保持未完成。

## 6.1：索引与范围

[逐场景索引](scenario-index-2026-10-17.md)覆盖24份delta、112个Requirement及213个Scenario，原任务/IP与F-ID保持。11个仅缺文档定位的疑点已对照既有测试核实并在同一9套件补证；无新增覆盖率或文案测试。索引不是按标题猜测PASS，实际结论仍受各来源报告与所述边界约束。

6.2只剩按用户授权形成固定Git实现检查点；6.3须在该检查点之后核对证据并创建verification，当前未创建。C38签名/多平台安装、跨VM/禁网、本地介质、4090/辅助GPU及合同交付仍为F-01–F-05，全部未计本轮通过。旧失败、原备份、恢复根及受限trace均保留。
