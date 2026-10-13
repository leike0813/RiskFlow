# 剩余功能实施交接（2026-10-13）

当前 change：`complete-private-deployment-functional-acceptance`；前置工程 change：`deliver-offline-private-deployment-and-operations`。两者 schema 均为 orchestrated-delivery。本文件是当前交接事实源，取代 /tmp 下旧 C37 checkpoint/worker 交接中的任务数与“不创建新 change/verification”限制。用户明确要求拆分、原 change 写 verification、新 change 起草至 apply-ready；本轮未实施新 tasks、提交、归档或修改编排。

## 基线与当前状态

- 固定规划基线 HEAD：`b6e39eb41e9cc8b0c9840f6f58057155eb37de54`；前置增量尚有累计未提交实现，实际 dirty paths 以 git status 为准。不能把 HEAD 视为包含这些实现的检查点，角色交接前按授权审阅并形成真实 Git 检查点。
- 原 change 保留 43 项已实现工程任务；完整功能、正式来源补证、完整 Electron 与集成收口义务移到本 change，当前 14 项全部未执行。verification 只在本 change 实现、检查点和审计成立后生成。
- 本 change 的 proposal/specs/design/implementation-plan/tasks 五项 apply 前置已齐；`openspec instructions apply --change complete-private-deployment-functional-acceptance --json` 返回 `state: ready`、0/14。前置工程 change 的六项工件均为 done，但 verification 结论仍为 BLOCKED，CLI 工件状态不替代归档门核验。
- 当前 start.mjs 只允许 synthetic-acceptance 合置本地 C04。远程 put/open adapter 已实现，但 remote verifyContent 和完整 production host 仍缺闭合，明确拒绝启动；此项交 C38 F-03，不开放不完整宿主。

## 原任务拆分映射

| 原任务 | 原 change 保留的已实现部分 | 本 change 待完成部分 |
| --- | --- | --- |
| 4.3 / IP-04 | 精确配置/路线/空间 reader 与实际组合通路的工程实现 | IP-17 / 1.2：正式 C19/C24/C30 来源与错版/异空间/拒权的生产证据；沿现有通路修普通缺陷 |
| 5.1 / IP-05 | C15/C17/C20–C24、五共享 registry、一次绑定及请求/任务/事件作用域 | IP-19：真实清洗/知识/检索/候选/复核及终态 |
| 5.2 / IP-05 | C25/C27–C30、现场/偏差上下文、所属引用证明与 A3/A4 时序 | IP-19/IP-20：真实评估/预警/处置/校准及精确结果链 |
| 5.3 / IP-05 | 全 API ports/projection、C36 两阶段授权，已删除“只有骨架”的旧描述 | IP-19/IP-21：真实 HTTP 与可见 Web 业务结果 |
| 13.1 / IP-13 | 预检与两条基础 e2e 定义；未声称完整 Electron 已通过 | IP-18：共享对象/登录/上传下载/撤权/TLS/导航/SSE/任务继续全部真实场景与实跑 |
| 14.1 / IP-14 | 手册、配置示例、工程证据及命令作用说明 | IP-20/IP-22：实际功能报告、逐场景引用和最终索引 |
| 14.2 / IP-01–16 | 本次拆分、保留场景映射与原工程 verification 准备记录 | IP-22：真实功能/桌面全部证据、全仓门禁、固定功能检查点、Finalizer/必要一次审计；原工程归档也须独立固定其实现检查点和所需审计 |
| 16.1 / IP-16 | 真实合置 API/Worker 工厂/CLI、模型选取、观察和 provision 原身份续接 | IP-17/IP-19：实际配置/清单/秘密/HTTPS/正式资料环境和运行；完整远程 host 另交 F-03 |
| 16.2 / IP-16 | 严格三类只读终态观察、查询预算、同次引用核验、安全报告程序 | IP-20：完整运行配置与实际报告，其他正式领域事实用所属查询补证 |
| 16.3 / IP-16 | 不保留 checkbox；完全迁出原 change | IP-19–IP-22：完整正式链路、可见外部 Chrome、原身份重试/重启/适用恢复及最终功能验收 |

原已勾任务继续保留，仅按已实现工程边界表述；C38 移交从未属于这些 checkbox 的通过结论。不能将拆分解释为免除旧义务。

## 已完成实现与接续入口

- start.mjs：createDeploymentGraphsV1、createDeploymentApiV1、createDeploymentAgentRunnerV1、createDeploymentOutboxDispatchV1、createDeploymentWorkerV1/createDeploymentWorkerRuntimeV1、mainDeploymentV1。共享五类任务与 registry、硬预算、同一 checkpointer、一次绑定。API 整 handler 请求作用域，Agent 整任务作用域，后台事件按原签发来源复验。
- Workflow adapter：readEventParentRun/verifyEventConsumption，按 C06 原因果及 C03 启动收据、C30 精确链边、当前完整权限和 C04 正文有界只读证明。暂缺/不唯一失败重投；running/cancelled、单独输入或路由不能 ack。
- risk-flow consumer：图在回执事务外；事务内复验已提交消费事实再保存原回执。回执失败重投不重复已完成图。assessment 准备不走识别 apply，独立事件必须有正式 human 根来源证明。
- 识别 plan：readRegisteredWorkPlan 只读精确 I2 已登记计划，缺失 BUSINESS_BLOCKED，零新建。评估 A0 不再造 seed；A3 只冻结输入，A4 正式建议成功后读取创建时偏差版本并登记两条链边。
- 正式来源：C19 继续 scoring governance/basis/所属 adapter；C24 使用 createDeploymentAcceptanceRoutesV1；C30 走 createDeploymentRiskSpatialPairingV1 + riskInputFacts.readDeploymentRiskScopes。不要为调用未使用的泛化 helper 新建第二来源或第二规则表。
- functional.mjs 支持 Agent 任务详情、识别运行详情和运行总览投影的正式终态；非 query、不支持 DTO、错运行/引用、等待/超时均非 PASS。完整其他领域事实从正式所属查询留证，不给任意 DTO 猜通用 status。
- 启动入口：`node scripts/deployment/start.mjs --role api|worker --config <真实部署配置> --manifest <同发布清单>`。分别选实际 role，启动不迁移、不引导；SIGTERM/SIGINT 有界关闭，drain 未收口保留在用资源/原租约。
- 预置：`node scripts/deployment/provision.mjs --config <预置配置> --output <新报告>`；RISKFLOW_DEPLOYMENT_CONFIG/RISKFLOW_RELEASE_MANIFEST 指定基础配置路径。不调用不存在的 --help，也不直接 SQL 播种。
- 功能运行：`node scripts/acceptance/functional.mjs --pack <批准包> --config <本次functional配置> --output <新证据目录> [--resume]`。

## 已有证据与本次复验

2026-10-13 本次拆分核验重跑：

- 14 套件、383 项通过：entrypoints/composition/risk-flow-composition/assessment-composition/lifecycle/provision/acceptance/api-ports/functional/policies-readers/workflow adapter/risk-flow runtime/assessment runtime/Agent runner。
- `pnpm test:deployment`：20 套件、408 项通过，包含发布、mTLS、备份/恢复、模型与策略/秘密/初始化、安全壳。
- 模型/评分包/所属 adapter/API quality/Web 确认定向回归：14 套件、245 项通过，精确命令见前置 verification G3。三批有重叠，不累加为全仓结果。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm deps:check`、`pnpm deps:policy`、本次 Markdown 格式和 diff 检查通过；两个 change 的 strict 校验通过。
- 全仓 strict 本次为 32 passed / 11 failed（43 项），仍为原已归档规格长正文问题；前置 verification G8 留存实际日志，IP-22 承接门禁闭合。
- `pnpm test:browser`：86 passed / 2 failed，17.5 分钟、exit 1；两项首次及重试均失败，由 IP-21/5.1 接续，不能沿用旧 88/0。日志 `/tmp/riskflow-c37-split-browser-2026-10-13.log`，原失败和 retry1 trace 位于 `test-results/quality-browser/`。

| 本次 browser 缺口 | 已确认现象 | 后续范围与验收 |
| --- | --- | --- |
| agent-audit-operations.spec.ts:421 慢读/切工程取消 | aborted=0；测试固定等待 26 秒，未先证明切换时有在途请求 | IP-21 的原页面/既有场景：先建立可观察在途前置，再核对单在途、上下文取消和停止刷新；不删取消断言或放宽峰值 |
| assessment-warning-response.spec.ts:1515 重评启动 | 确认按钮点击超时；两次 trace 均显示按钮在视口外 | IP-21 的原确认组件/样式/既有场景：核对长信封与有限视口的自然点击、滚动及键盘操作；不 force 点击、不增加超时绕过，保持焦点/取消/冻结信封契约 |

先前证据保留为历史：八套件 261、另三套件 53、定向七套件 245、8 GiB API/Worker 构建和相关 lint/format；旧全仓 2035/129、旧 browser 88/0 是工程 harness，不是本次真实功能 PASS。2026-10-11 网络三能力 adapter smoke 已通过，但使用隔离 PostgreSQL/C04 测试存储、未证明生产授权；普通报告不含原响应或秘密。

原工程 verification 记录实际复验、历史证据及未完成固定检查点/限定审计。OpenSpec status 的工件 done 不等于正式验收 PASS；本 change 的 verification 尚不创建。

## 执行输入与资料边界

上轮只读环境核对：旧 `/tmp/riskflow-functional-runtime-OuUmoX/` 已不存在；原 PostgreSQL/Qdrant 容器停止，无当前 API/Worker/HTTPS，未找到可用的完整实际部署/同发布/业务运行配置。Ollama 批准版本/模型只读可达，不证明推理或完整就绪。模型/转换凭据仅确认环境存在，不输出，也不替代受限文件加载。

接续时重新核对真实环境，保留旧容器和数据；没有回复或过时快照不能当作部署配置。秘密用同 uid/0600 普通文件，公开配置不能含 token。MiniMax/Ollama 的精确身份按前置 D-23 复验，不自动换模型或加预算。

MinerU 当前事实需同时看新旧证据：V1 扫描缺字段及旧分页错误保留失败；`references/acceptance/mineru-v2/manifest.json`、`acceptance-report.json` 五格式已合格，本机 CPU/P4 Vulkan 基准及重启在 `local-benchmark-report.md`。这些只证明 parser/JSON-LD/资料质量或本机测量，必须在当前宿主经正式 C04/C11 新版本登记后再生成清洗/知识/检索输入。官网与自托管分开，旧临时工件身份不能沿用。预期/相关性标签不进入模型；合成样本待甲方复核。

全仓 `openspec validate --all --strict` 本次仍有 11 份已归档规格长正文失败，见 `.scratch/strict-validate-remediation.md`。本次两个 change strict 校验不会解决该既有问题，IP-22 仍须处理全仓门禁，不能删 strict 或擅自改他人规格。

## C38 最终交付移交（全部未完成）

以下保留原 F-ID 和原施工归属；C38 必须先闭合自己的规格/施工图/任务，再按最终代码和制品身份实施。本 change 的功能 PASS 不能证明这些项目通过。

| 移交 ID | 原任务 / IP | C38 必须完成的工作与证据 |
| --- | --- | --- |
| F-01 | 原 15.1 / IP-09、IP-13 | 原生构建机、正式离线缓存与批准签名；Windows NSIS、Linux AppImage、macOS DMG，核验真实 Electron/Chromium/Node、签名/公证、许可/SBOM；`pnpm desktop:package -- <target>` 的实际调用及产物须先独立核验。 |
| F-02 | 原 15.2 / IP-13 | 三平台真实安装与全部桌面行为取证。先把正式安装包身份校验及完整 Electron Playwright 场景接到交付命令；当前 `test:desktop` 单测不构成平台验收。 |
| F-03 | 原 15.3 / IP-10–IP-12、IP-14 | 正式证书、真实禁网三 VM、系统/驱动/llama.cpp/模型/OCR 全部介质；完整安装、后台任务、重启、损坏检测、索引重建、恢复与回退。先补齐真正执行场景的部署 smoke，核验既有发布/导入程序，不能用配置校验或环境标签通过。 |
| F-04 | 原 15.4 / IP-14 | 主 RTX 4090 24GB/128GB RAM 运行 Qwen3.8-27B，辅助 NVIDIA GPU 运行 MinerU 专用模型；按服务冻结设备 UUID、backend、量化/上下文与并发，embedding 默认保持独立 Ollama 主机。以相同标注样例核验云端/本地转换与模型质量，实测并行峰值显存/RAM、延迟/吞吐/排队、取消、容量和恢复耗时；先实现真实 benchmark，不虚报 RPO/RTO 或 SLA。辅助卡采购与制品许可依实测冻结；官网功能 PASS 不代替此项。 |
| F-05 | 原 15.5 / IP-14 | C38 Finalizer 按最终版本核对 F-01–F-04、合同交付材料及必要审计，生成 C38 最终 verification；任一正式证据缺失不得声明最终交付 PASS。 |

F-03 另承接当前明确缺失的 production 跨 VM host 和 remote checkpoint 正文证明：不能仅去掉 purpose 拒绝或把普通 open 的访问审计当 verifyContent，必须先设计完整 mTLS 身份/授权/有界正文证明和宿主装配，再取证。F-04 的 GPU/质量/介质不能继承官网或开发机报告为目标交付证明。

## 操作边界

当前拆分授权不等于提交、归档、安装依赖、清理数据或修改编排授权。既有文件用 apply_patch；Python 用共享 uv 环境；API/Worker 构建带 NODE_OPTIONS=--max-old-space-size=8192。查代码先精确 CodeGraph，保留所有已有 dirty 改动，不重用已结束 Agent session。后续实施、真实人工决定、正式检查点与最终归档按当时授权和实时状态推进。
