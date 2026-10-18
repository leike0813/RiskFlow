本 change 为剩余实现与真实功能取证，当前进度以以下任务勾选及 handoff.md 最新证据为准。任务 checkbox 只在行为与本次证据均成立后勾选。C38 F-01–F-05 是范围移交，不计当前 task；固定检查点和验收不由 CLI 工件存在性替代。

接续依赖：两项减负change均已归档并进入HEAD，按新语义继续本清单。当前17/19；本轮关闭2.2、5.1、6.1，证据见[evidence/batch-closeout-d189-d190-2026-10-17.md](evidence/batch-closeout-d189-d190-2026-10-17.md)及[逐场景索引](evidence/scenario-index-2026-10-17.md)。6.2尚缺授权Git检查点，6.3尚未生成verification。旧终态失败保留。下文历史“精确授权/完整性”按新入口检查和普通消费语义执行，专业质量与事务要求保持。

## 1. 来源与环境

- [x] 1.1（IP-17）核对前置实现检查点、当前配置/发布/迁移/秘密与隔离实例，补齐实际输入身份清单；环境定向106项及D-97/D-100宿主81项通过，原000058停写副本与审计已保存，显式迁移到减负要求的000059并运行d104-v110，purpose为synthetic-acceptance；基线、未提交源码差异、制品、配置与真实输入见evidence/resume-after-reduction-2026-10-16.md。
- [x] 1.2（IP-17）用正式 C19 成员、C24 路线及 C30 空间补证现有通路，修已批准范围内来源缺陷；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs`，另记录错版/异空间/无权的实际拒绝及正式来源引用。2026-10-17：94项通过，当前v163八项正式来源/拒绝探针PASS，见evidence/task-closeout-2026-10-17.md。

## 2. 完整 Electron 场景

- [x] 2.1（IP-18）按 D-28 在既有 acceptance.mjs 补 strict 测试输入与预检，扩展 client.spec.ts 的共享对象、登录、上传下载、撤权、证书拒绝、导航、SSE 重连及任务继续；验证：`pnpm exec playwright test -c playwright.desktop.config.ts --list` 核对全部场景定义，不能仅保留两条基础用例。2026-10-14 已定义 12 项场景/自检，预检边界自检通过；功能实跑留在 2.2，输入及工程证据见 evidence/readiness.md。
- [x] 2.2（IP-18；依赖 1.1/2.1，业务对象来自 3.1/3.2）在当前平台真实 Electron 和功能 HTTPS 实跑全部场景；验证：`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm exec playwright test -c playwright.desktop.config.ts`，保存版本和失败 trace，无关键 skip。2026-10-17：v173真实完整批次13通过/1失败，关窗原任务及原父completed；D190显式已有识别运行的事件身份/读取快照，当前C33核验后SSE原2+2/游标/零写及预检共2项通过，全部14场景有通过证据。保留原失败，不冒称单次完整14项exit0；无新模型，见本轮批量收口。

## 3. 正式业务运行

- [x] 3.1（IP-19；依赖 1.1/1.2）以 MinerU V2 合格材料及真实 C04/C11 新版本完成资料、策略/配置审核发布、检索构建和质量门禁，按同次回执绑定现场/来源；验证：`pnpm acceptance:synthetic check --pack <批准包>`、`node scripts/deployment/provision.mjs --config <实际预置配置> --output <新报告>` 及正式模块引用；旧临时响应不能充作生产登记。2026-10-17：批准包检查通过，六份正式预置/转换报告及配置摘要逐一匹配，七门通过的正式代际在v163仍active，现场来源读取成立；见evidence/task-closeout-2026-10-17.md。
- [x] 3.2（IP-19；依赖 3.1）从完整合置宿主执行识别/复核、评估/预警、处置建议/人工决定、执行反馈、五类任务及会话流，记录预算、权限、错误和正式结果；验证：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts` 与施工图 V4；真实业务不能用 adapter smoke 替代。2026-10-17：当前正式业务引用链逐边核对通过、五类任务completed及预算可读，原正式C05会话流与v159网络smoke通过；权限/失败/人工决定均保留，见evidence/task-closeout-2026-10-17.md。完整历史阶段观察缺陷继续归4.1/4.2，不计完整functional通过。

## 4. 终态与安全报告

- [x] 4.1（IP-20；依赖 3.2）补完整同次 functional 观察配置和正式查询引用索引，仅在出现可复现缺陷时修既有观察器；验证：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`，核对等待、超时、缺引用、异运行及不支持 DTO 均非 PASS。2026-10-17：D-183显式既有正式引用模式及C33真实请求字段修复，69项通过；七目标当前只读观察，不重开模型，见evidence/task-closeout-2026-10-17.md。
- [x] 4.2（IP-20；依赖 4.1）运行 `node scripts/acceptance/functional.mjs --pack <批准包> --config <实际functional配置> --output <新证据目录> [--resume]`，逐项核对正式终态、精确来源/模型/配置/审计/C04 引用和 RI/RA 双向追踪，报告不含秘密、Cookie、正文或思考内容。2026-10-17：同一观察报告7/7 PASS、10次当前正式查询与99个精确引用索引通过，父子预测按正式关联核对，原失败父不改判；桌面在途场景不计此证据。

## 5. 可见交互与故障边界

- [x] 5.1（IP-21；依赖 2.2/4.2）先闭合本次慢读/切工程 aborted=0 和重评确认按钮不可点击的 browser 回归缺口，再在可见外部 Chrome 完成真实登录、正式确认、拒权、跨页追溯与桌面对齐；验证：`pnpm test:browser` 全部通过，另保存实际可见窗口的操作/版本/结果引用，headless 不替代此证据。2026-10-17：完整browser90/90、无flaky/重试；v173可见Chrome真实登录/正式确认200、预警到评估实际链接及无会话401，截图/精确引用在d189-visible-acceptance/report.json；Electron同HTTPS及14场景已闭合，见本轮批量收口。
- [x] 5.2（IP-21；依赖 4.2）在隔离实例取证事实提交后回执失败重投、SIGTERM/同发布重启、原身份续接及取消零写；验证：`pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts scripts/deployment/risk-flow-composition.test.mjs scripts/deployment/lifecycle.test.mjs` 及实际重启/重投报告。2026-10-17：v172真实SIGTERM/count0及同发布重启，原Agent completed、显式正式完成通知200后原父completed、functional PASS；可见Chrome提交后中断HTTP成功响应，原信封重放200且确认/Outbox各一条；复用原取消后零写实证。d187-desktop-active/task52-report.json记录边界，不冒称Worker自动通知或模型在途取消，完整桌面继续归2.2。
- [x] 5.3（IP-21；依赖 4.2）以原运维权限完成适用维护、逻辑副本、新根恢复、双索引重建和人工兼容/不兼容回退核验；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs scripts/deployment/restore.test.mjs` 和 OPERATIONS.md 原命令的隔离实跑，保留旧实例/双根。人为损坏注入属于独立运维核验，不作为本轮正常业务链通过条件。2026-10-17：精确3孤儿维护/4259项恢复、原代际15成员和七门7/7均通过；D-185按真实备份C及运维修订2确认，原HTTPS切v169恢复副本，四业务查询/权限401/原命令重放200通过，返回v171源实例。v5真实启动因000058/000059不兼容拒绝，未切换、不冒称匹配副本恢复。531项统一回归、170项入口回归通过；实证d185-final-rollback/task53-report.json及安全索引。

## 6. 收口

- [x] 6.1（IP-22；依赖全部功能场景）同步 ACCEPTANCE/OPERATIONS 与本 change 安全证据索引，核对每个 Requirement/Scenario/IP、原任务与 F-ID，无遗漏或把未完成列成通过；验证：`pnpm exec openspec validate complete-private-deployment-functional-acceptance --strict --no-interactive`、`git diff --check` 和逐场景实际报告。2026-10-17：24份delta/112 Requirement/213 Scenario完整索引、原任务/IP及F-ID保持；11项定位疑点对照既有测试并统一9套件236项补证，20份原日志与安全汇总在d190-closeout；6.2/6.3及C38未改判，见本轮批量收口。
- [ ] 6.2（IP-22；依赖 6.1）运行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`，记录实际结果并闭合门禁；原已归档规格 strict 失败按责任范围解决，不删 strict 或静默忽略；按授权形成固定实现检查点。
- [ ] 6.3（IP-22；依赖 6.2）由 Finalizer/必要一次限定审计完成核验、范围内修复与回归，再创建 verification.md；验证：最终 HEAD 与实际证据一致，security/persistence/integration 及必要 performance 审计完成，无当前缺陷、缺证据或待审计的 PASS。

## 7. 已批准原件与Agent修正

- [x] 7.1（IP-19/D-36）完成原件JSON/二进制窄读、真实名称/可选上传文件名、历史/失败转换/当前权限和C04完整性；通过所属adapter、HTTP及宿主定向测试。
- [x] 7.2（IP-21/D-36/D-37）完成默认原件视图、PDF/位图/文本预览与Office原件下载，接唯一Agent侧栏/工作台/详情及候选校验；通过相关Web回归并在物理Chrome使用原实例资料取证。
- [x] 7.3（IP-19/D-38）修C17准备范围/逐组身份/验证工件隔离及pending复核动作，既有数据库与宿主回归通过并取得正式送审/决定/发布回执。
- [x] 7.4（IP-18/D-36/D-37）接Electron批准同源原件保存与PDF/Agent共享查看，真实当前平台操作、撤权/越界拒绝和字节一致性留证；不以headless替代。

## C38 最终交付移交

## 8. 已批准C19正式入口

- [x] 8.1（IP-17/IP-19/D-39；接续减负D-13）沿正式组装入口和新派生发布语义复验C19/C11/C18/C16，验证当前权限、准备/配置、重复提交及冲突处理；基础合成评分内容保留人工审核，物理Chrome经确定性组装自动形成发布及评估依据留证。2026-10-17：D-177修复同输入已有派生发布复用，31项先红后绿；v164物理Chrome原失败命令及重放200、四引用保持，冲突409/错配置422/错准备404/无会话401，修订/发布/工件数量不变，见evidence/task-closeout-2026-10-17.md。

F-01–F-05 的完整条目见 handoff.md；签名/三平台安装、完整远程 host、禁网三 VM、模型/OCR/系统介质、4090 与辅助 GPU、合同材料均未因本 change apply-ready 而执行或通过。
