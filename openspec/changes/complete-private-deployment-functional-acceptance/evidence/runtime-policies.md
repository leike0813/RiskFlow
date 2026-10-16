# 本机合成验收运行策略（2026-10-14）

用户本轮明确要求接受 Ollama 微小版本不符，并生成一套策略配置。本次按现有 core Schema 编制十六类策略，没有复制测试 catalog、修改业务代码或引入依赖。配置限定 `synthetic-acceptance`，技术配置的授权不代表甲方正式业务规则批准。

最新API/Worker运行输入为 `deployment-d35-final-v10.json`（release `functional-workspace-20261014-d35-final-v10`），读取 `data/policies/catalog-d35-final-v10.json`。用户已批准D-35并授权提高新任务预算；清洗/知识/处置/校准策略冻结为 `physical-20261015-d35-v1`，清洗提示与工具同步新版本，保留原5份及治理16份质量引用、保留比例1。v9的16资料正式清洗完成、结果C04 verified、595段覆盖1、排除0；后续用最终构建v10。预算测算、实际59445输入/3126输出token及同次引用见 [D-35实跑证据](cleaning-paged-budget-2026-10-15.md)，原失败保留在 [D-34](cleaning-context-and-recovery-2026-10-14.md)。下述公开v1副本及旧表格是前阶段身份，不作为当前完整功能配置；当前四类累计预算以D-35表及实际新目录为准。

可审阅的公开配置为 [runtime-policy-catalog.json](runtime-policy-catalog.json)，结构及绑定检查结果为 [runtime-policy-validation.json](runtime-policy-validation.json)。实际实例目录为 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`；加载器读取其中的 `data/policies/catalog.json`。公开副本没有密码、token、Cookie 或私钥。

## 参数与边界

| 策略 | 本次配置 |
| --- | --- |
| 清洗 | 文档、资料段和监测样本保留比例均为 1；保护章、表、监测窗口及原始/更正/补充样本；有界切片读取 |
| 知识校验 | 覆盖五个必需工序；每工序至少 1 个机理及 1 份证据；单包最多 128 项 |
| 双路检索 | 2560 维 cosine 与中文 multilingual BM25；各路 prefetch 20，topK 5，RRF k=60、双路等权；Embedding 批量最多 2 项 |
| 检索验收 | dense/BM25 Recall@5 ≥0.8，RRF Recall@5 ≥0.9、NDCG@5 ≥0.8；完整对账比例 1、权限泄露 0；预热 1 次、测量 3 次，Qdrant p95 上限 2000 ms |
| 检索审阅 | 最多 32 个候选成员、1 次有界补搜，模型输出最多 4096 token；沿现有 C21 任务预算 |
| 风险候选 | 最多 4 条、总 token 4096、最多 1 轮修正、墙钟 600 秒；终止原因不得进入修正循环 |
| 合并与置信度 | 同节点合并，最多 8 个组成员；事件相似度 0.9、证据相似度 0.8；缺少必需置信度依据阻塞；所有组进入人工复核 |
| 重试 | 最多 2 次，退避 1000 ms；不改变原预算、模型或身份 |
| 清洗/知识/处置/校准 Agent | 已按任务类型提高新版本预算，详见D-35；清洗输入131072、输出32768、上下文196608，模型40/工具64、墙钟30分钟；同任务并发1，旧任务上限保留 |
| 评估与预警 | 只引用版本化成员；四类触发方向使用同一明确处置方向，通知仅发送给本次工程内实际验收管理员，渠道为站内通知 |
| 处置校验 | 保留目标、规范和现场三项校验；规范审核证据目前为空，未核实触发指标为禁忌条件，缺项时拒绝正式建议 |
| 校准 | 至少 1 份证据、最多 4 项领域操作；人工决定与发布仍使用原流程 |
| 评分 | 沿原配置包治理分支；策略完整声明原工具/预算接口，不因此新增必经评分 Agent |
| 导出 | 既有 risk-overview JSON；最多 20 页、1000 项、8 MiB，包含运行摘要、报告事实和缺席项 |

上述数值是用户授权生成并补充调整的合成验收技术配置，质量指标是要实际测量的门槛，尚无检索质量 PASS。运行中不自动降低门槛或扩预算；新预算在任务创建前固定。处置目标的 0/0/1 是待业务审阅的合成目标，当前没有规范许可或实际风险绑定，因此不会成为可执行的正式建议。

## Ollama 与实际装配

本次实测并固定 Ollama 0.40.3，新部署版本为 `2026-10-14-0.40.3`。模型仍为 qwen3-embedding:4b，权重摘要不变，2560 维；聊天仍为 MiniMax-M3.1-Flash-Preview、schema-prompt/low。未全局关闭版本校验，未增加网关预算。

真实三能力 smoke：1 项通过，结构化生成 usage 259 输入/35 输出 token，Embedding 29 输入 token/2560 维，会话流 26 个增量、216 输入/53 输出 token。它使用隔离 adapter 存储，单独记录，不替代正式业务终态。

实际 `createDeploymentApiV1` 已装配 data-cleaning、knowledge-authoring、retrieval-review、response-recommendation、calibration-suggestion 五类任务，关闭结果 settled=true、remaining=0。随后已启动独立 API、Worker、Qdrant 和同源 HTTPS。

既有 `policies-readers.test.ts`、`config-operations.test.ts` 定向回归：2 文件、45 项通过。配置及说明的 Prettier 检查、当前 change strict 与 `git diff --check` 通过；未为纯配置/文档新增测试，未重跑全仓门禁。

## 当前物理桌面

入口为 **https://localhost:19443/**，仅绑定回环。系统 `caddy.service` 保持关闭；验收 Caddy 使用实例独立配置。证书由本次短期私有 CA 签发（7 天），根证书以独立名称 `riskflow-physical-acceptance-20261014` 加入当前用户 NSS 信任库；不修改系统 CA，不使用 ignoreHTTPSErrors 或证书豁免。命令行通过显式 CA 校验，HTTP 200、ssl_verify_result=0。

物理显示器 `:0` 上的 Chrome 已在原页面填写登录名和受限文件中的密码，正式登录接口返回 200，进入 `/overview`；没有注入 Cookie 或业务结果。选择本次工程后，服务端返回实际工程修订 1 和新投影查询引用，评估/预警计数为 0。实际截图和安全回执在受控实例目录。

## 仍须正式业务回执

运行策略生成和宿主启动已完成；预测/校准发布、现场证据资格、实际风险分类绑定、规范审核以及知识/配置/检索证据库的正式发布仍须在本次实例完成。实例的 `deployment-ui-preparation.json` 是界面与预置阶段输入，不能当作完整业务验收配置；它保留显式待发布引用，相关业务读取必须阻塞而非返回假结果。

现场候选已通过 C04 正式 put，绑定真实 `sha256:` 工件引用；该候选的知识证据尚未取得本次正式资料来源，所以不声称现场资格已通过。对生成配置的后续业务绑定使用新版本及正式回执，不能把草案中的 awaiting 引用计入 functional 报告。

Electron 全部场景、后台正式终态、权限拒绝、SSE 恢复及重启/恢复仍未通过。本 change 保持 1/14，不把本次入口证据或工程测试计作功能 PASS。

## 物理界面发现的缺陷

在 1920×966 浏览器视口以及初始窄窗口，风险态势页标题与指标卡重叠。真实页面虽加载了局部 CSS，但生产入口 `apps/web/src/main.tsx` 只引入 AppShell.css，没有加载已有的 theme/tokens.css 和 theme/global.css；页面标题保留了浏览器默认字号/外边距，卡片令牌也未定义。demo 入口有这两条导入，生产入口缺失。

用户已授权将 main.tsx 纳入 IP-21，生产入口现已在 AppShell.css 前加载上述两条现有样式。`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、该入口 ESLint/Prettier 及工件格式检查通过。未在浏览器注入样式。

同一物理 Chrome 宽视口 1920×966 的标题下边为 260 px，首张指标卡上边为 280 px，已不重叠；card-radius=8px、topbar-height=68px，页面内容未溢出固定容器。窗口缩至 1016×677 后，标题下边 322 px、指标卡上边 342 px，同样不重叠；但现有风险态势页局部样式仍存在指标标签与 asOf 标签遮挡、固定高度/overflow:hidden 裁切底部内容的问题。窄窗口仅确认本次标题重叠修复成立，不作为全部布局 PASS；该局部样式不在本次两条入口导入的授权范围。Chrome 已恢复最大化。

既有四项 browser 回归（`--retries=0`）全部通过，耗时 2.7 分钟：确认对话框焦点/取消、慢读切工程取消、启动向导键盘/取消门控、1024×600 重评确认。未新增静态导入或 CSS 文案断言测试，未重跑完整 browser/verify。当前 change 的 strict 与 diff 检查通过；完整功能与窄窗口布局缺项继续保留。

实际截图 chrome-global-style-fixed-wide.png、chrome-global-style-fixed-narrow.png，几何结果 physical-style-wide-result.json、physical-style-narrow-result.json，以及构建身份 web-global-style-build-identity.json 位于受控实例目录；原失败截图保留。
