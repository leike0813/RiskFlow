# Verification

## 验收对象

- Change：`complete-private-deployment-functional-acceptance`，schema为`orchestrated-delivery`。
- 输入实现HEAD：`96d98651d495fd4a48055aff908c8ae47fa2f577`，2026-10-18经用户明确批准提交45个已核对文件。
- 最终验收实现HEAD：`96d98651d495fd4a48055aff908c8ae47fa2f577`。本报告及任务/交接状态随后以纯文档提交保存；产品实现与测试文件不变，文档提交不作为另一轮运行制品。
- 验收Agent：Codex / GPT-6，接续同一Finalizer任务；唯一限定审计Agent为Kuhn，`01a14a65-9ef8-70e1-b3b4-0a6835b796f6`，已完成并关闭。
- 实际发布：`functional-workspace-20261017-d189-v173`，migration `000059`，同源HTTPS `https://localhost:19443`，真实Electron `44.7.0`及可见Chrome `155.0.8059.39`。
- 制品：6,066,039字节，SHA256 `ac1a7343b9763f7631522f3e275e4d85ce8d4ac37cb13c5fedb872e5bd7ecd7a`。打包时tar逐项比较通过；D190之后仅变更桌面测试输入/断言及文档。收口核对固定HEAD的12个生产文件与实机安全汇总摘要全部一致。
- 受限证据根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`；下文实例路径均相对此根。仓库仅保存安全索引，不复制口令、Cookie、资料正文、原始模型响应或trace。

## 结论

**PASS**：本change当前平台、synthetic-acceptance合置本地C04范围的真实功能验收完成，任务19/19。合成样本，待甲方复核。该结论覆盖已批准实现、正式来源与业务终态、权限/预算/审计/追溯、当前平台桌面及可见浏览器、适用故障和维护恢复边界。

范围完整性按24份delta、112个Requirement、213个Scenario及IP-17–IP-22核对；[逐场景索引](evidence/scenario-index-2026-10-17.md)保留每个规格原名、施工图和实际证据。最终索引复核未映射项和失效链接均为0。无尚待修复的范围内缺陷、必需证据缺口或待执行限定审计。C38 F-01–F-05属于已批准移交，不计入本结论；本change尚未归档。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| IP-17；1.1/1.2，来源/配置/权限 | [任务收口](evidence/task-closeout-2026-10-17.md)、[v163接续](evidence/resume-v163-2026-10-17.md)；`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs` | 94项通过；正式C19/C24/C30引用及错版、异空间、无权拒绝均有实证。 |
| IP-18；2.1/2.2/7.4，完整Electron行为 | [批量收口](evidence/batch-closeout-d189-d190-2026-10-17.md)；`pnpm exec playwright test -c playwright.desktop.config.ts`；同一环境`--grep '预检边界\|SSE：'` | 完整批次13通过/1失败、无skip；事件不足的SSE场景以显式已有识别运行定向闭合，预检及SSE共2项通过。全部14场景有通过证据，完整批次原exit1及trace保留。 |
| IP-18/IP-21；桌面关窗继续、SSE与共享对象 | `d189-desktop-active/`原关窗、重启及完成通知回执；`d190-closeout/report.json` | 原活动任务及原父completed；SSE当前C33核验快照后同一事件身份2+2、游标不重放、零业务写。完成通知由验收驱动显式发送，不宣称Worker自动通知。 |
| IP-19；3.1/3.2/7.1/7.3/8.1，正式业务及五类任务 | [任务收口](evidence/task-closeout-2026-10-17.md)、[原件与Agent界面](evidence/original-and-agent-ui-2026-10-15.md)、逐场景索引；`d184-formal-reference-index-b/query-reference-index.json` | MinerU合格新版本、配置审核发布、正式检索七门及识别/评估/预警/处置/执行反馈/偏差校准链通过；五类任务completed及预算可读。原件/复核/确定性组装沿正式入口留证，旧失败保持。 |
| IP-20；4.1/4.2，终态与RI/RA双向追踪 | `node scripts/acceptance/functional.mjs --pack <批准包> --config <实际functional配置> --output <原观察目录> --resume`；`d183-formal-observation/observation-b/functional.json`及`d189-desktop-active/observation/functional.json` | 七目标7/7及正式关联核对通过；桌面同次观察PASS/queryCount2。只读续查已有运行，无重发模型/业务链，缺引用、异运行及非终态不冒充通过。 |
| IP-21；5.1/7.2，可见Chrome与共享业务界面 | `pnpm test:browser`；`d189-visible-acceptance/report.json`及实际截图 | 90/90、无flaky或重试；真实登录、正式确认200/succeeded、预警到评估实际链接、无会话401；同一HTTPS、数据库和正式对象。 |
| IP-21；5.2，重投/重启/取消边界 | `d187-desktop-active/task52-report.json`、`d187-visible-response-loss/`；原Worker/Workflow/lifecycle回归 | SIGTERM/count0及同发布重启；原身份续接完成，提交后回执丢失的原信封重放200、确认事实/Outbox各一条；原取消后零写实证保留，不宣称模型在途取消。 |
| IP-21；5.3，维护/恢复/双索引/人工回退 | `d185-final-rollback/task53-report.json`、clean恢复根正式报告及质量日志；`scripts/deployment/backup.test.mjs`、`restore.test.mjs`所属回归 | 精确3孤儿维护、4259项恢复、15成员/七门7/7；人工兼容恢复副本切换/业务读取/返回源实例通过。旧v5因000058/000059不兼容明确拒绝，未切换，未冒称匹配副本恢复。 |
| IP-22；6.1，每个Requirement/Scenario与原任务 | [逐场景索引](evidence/scenario-index-2026-10-17.md)、[批量收口](evidence/batch-closeout-d189-d190-2026-10-17.md) | 24份delta/112 Requirement/213 Scenario覆盖；11个定位疑点按既有测试统一9套件236项补证，原任务/IP及F-ID保持。 |
| IP-22；6.2，工程门禁与实现检查点 | 下表工程命令、`d190-closeout/`原日志与`checkpoint-proposal.json`；`git show --stat 96d9865` | 45个文件与批准清单及摘要一致，无范围外暂存；12个生产文件及20份原日志摘要匹配。 |
| IP-22；6.3，最终核验与限定审计 | 本报告、下述唯一限定审计及最终OpenSpec/Git检查 | 当前平台范围完成，产品HEAD与实际证据一致；仅收口文档随后提交。 |

原任务拆分与移交逐项见[handoff.md](handoff.md)原任务表；IP-17对应1.1/1.2，IP-18对应2.1/2.2/7.4，IP-19对应3.1/3.2/7.1/7.3/8.1，IP-20对应4.1/4.2，IP-21对应5.1–5.3/7.2，IP-22对应6.1–6.3。

### 工程命令的实际结果

| 命令或批次 | 实际结果 |
| --- | --- |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` | 均通过，日志`d190-closeout/build.log`、`typecheck.log`、`lint.log`、`format.log`。 |
| `pnpm exec vitest run`统一deployment/adapters/core/worker/HTTP回归 | 24套件572项通过，含完整`pnpm test:deployment`范围；`unified-regression.log`。 |
| 逐场景疑点既有测试补证 | 9套件236项通过；`scenario-closure.log`。批次之间有重叠，不累加为独立覆盖数。 |
| `pnpm test:browser` | 90/90通过，flaky=0；`browser-final.log`。 |
| `pnpm deps:check`、`pnpm deps:policy` | 均通过；`deps.log`、`policy.log`。 |
| `openspec validate --all --strict --no-interactive` | 44/44通过；`openspec-all.log`。 |
| 原`NODE_OPTIONS=--max-old-space-size=8192 pnpm verify` | build/typecheck/lint/format通过，测试2735通过/1失败/3外部smoke skip，原exit1保持。失败为与已归档减负D04冲突的C11清单篡改断言，删除后所属和受影响回归及后半门禁均通过；未再次执行整条verify，不宣称最终monolithic exit0。 |
| 最终文档格式检查、`openspec validate complete-private-deployment-functional-acceptance --strict --no-interactive`、`git diff --check` | 均通过；任务19项已勾、未完成0项，收口文档链接有效、无活动管理口令。仅核验收口文档及状态，未重跑已通过实机业务。 |

### 验收期修复

已批准的历次修复记录在design、implementation-plan及逐场景索引，未通过的历史运行和资源消耗不改写。实现检查点收录本批D177–D190及唯一审计的范围内修复：同输入派生发布复用、C33按当前登记资源授权窄读、C04清单统一UTF-8排序和dry-run无副作用、原代际重建、恢复操作归属及独立授权会话/cleanup、functional主结果和观察身份、现场空间/来源配对及父子传递、测试按真实权限和会话状态读取、SSE测试分别固定事件身份与C33读取快照。详见[批量收口](evidence/batch-closeout-d189-d190-2026-10-17.md)与design D177–D190。

形成实现检查点后无产品代码或测试修改；本次只补最终verification及tasks/handoff/proposal收口状态，无新增依赖、迁移或服务启停。

## 限定审计

唯一限定审计已完成并关闭，未再次派发审计。范围为security/persistence/integration及必要performance边界：当前权限、跨空间配对及恢复调用会话，持久化操作归属/幂等/失败cleanup，宿主集成和有界读取/重建。

审计发现的恢复会话与跨空间配对两项普通缺陷在该活动Task内修复，163项及60项回归通过；父级升级的入口配对身份由D189闭合，已纳入572项统一回归和v173实机制品。审计结论及关闭状态见`d190-closeout/report.json`的`limitedAudit`；测试/源码证据为同目录`limited-audit-regression.log`、`limited-audit-closeout.log`及`limited-audit-source-manifest.json`。无待执行审计或未闭合发现。

## 后续注意事项

- 合成数据及合成检索质量测量待甲方复核，不据此声称真实工程准确率、目标硬件容量、RPO/RTO或SLA。
- F-01/F-02的正式签名/三平台安装，F-03的完整远程host/禁网三VM/本地介质，F-04的4090运行Qwen3.8-27B及辅助GPU MinerU/独立embedding实测，F-05合同最终交付全部未在本change通过，按handoff移交C38。
- Electron通过证据由原完整批次13项和SSE定向闭合组成；原完整verify的exit1及3个外部smoke skip原样保留。外部服务与目标本地模型证明不得从这些skip或官网结果推断。
- 原失败、备份、恢复双根、审计与受限trace保留。trace可能包含登录填写信息，只留受限实例；后续归档需沿OpenSpec同步/归档流程另行执行。
