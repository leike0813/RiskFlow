## Context

前置 change 的网络模型、API/Worker、三图、五类 Agent、正式权限与有界报告程序已有实现。当前 HEAD 为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`，仍有前置实现的 dirty 改动；这不是固定 implementation checkpoint。原施工基线及 IP-01–IP-16 保留于前置工件，本 change 从 IP-17 开始，具体交接见 handoff.md。

当前宿主仅接受 synthetic-acceptance 的合置本地 C04。mTLS put/open adapter 已实现，但 remote verifyContent 和完整跨 VM 宿主未开放。Electron e2e 只有两条基础用例。functional.mjs 已有正式只读终态观察与安全报告，尚无完整真实业务报告。MinerU V2 五格式及本机基准已有独立报告；V1 扫描失败不能改标签计通过，V2 parser 证据仍不等于生产 C04/C11 登记。

## Goals / Non-Goals

**Goals**：闭合剩余功能实现、正式来源、当前平台 Electron、真实模型业务、可见浏览器、恢复/重启适用场景与安全追溯报告，最后按固定检查点完成验收。

**Non-Goals**：重复宿主、第二套 catalog/reader/报告器，新增业务字段、迁移、依赖，C19 Agent 评分编制，跨 VM 正式宿主和远程正文证明扩展，签名/三平台正式安装、禁网/模型介质/4090 取证、HA/PITR/RPO/RTO/SLA、移动端。最终义务按 handoff.md 的 F-01–F-05 交 C38，不因本 change 功能通过而消失。

## Decisions

### D-25. 从当前公共接缝接续，不重复实现

完整读取前置 change 的 D-20–D-24 和本 change apply contextFiles。复用 createDeploymentGraphsV1、createDeploymentApiV1、createDeploymentWorkerV1、mainDeploymentV1、runProvisionV1 和 runFunctionalAcceptance。

C19 正式成员通过既有 scoring governance/basis resolver 及各所属模块正文读取；C24 通过 createDeploymentAcceptanceRoutesV1 读取精确登记及 C04；C30 使用 createDeploymentRiskSpatialPairingV1 和 riskInputFacts.readDeploymentRiskScopes。没有调用者的泛化 reader 不构成新增接线义务，也不为让名称出现而绕过现有通路。IP-17 用正式来源验证实际路径；不满足原契约时在该路径修复，不增加第二套来源。对原 4.3 的义务按行为和来源判断。

所有 task 保持既有权限、原版本、一次绑定环与五类 registry。常规确定性评估不创建必经 Agent；RI-S57 候选直接确定性校验；C19 本轮仅配置包治理分支。

### D-26. 当前功能实例固定为隔离合置部署

实例用严格 DeploymentConfigV1、ReleaseManifestV1、DeploymentPolicyCatalogV1 与 FunctionalAcceptanceConfigV1。公开配置只保存精确版本、端点、预算和秘密文件引用；秘密由受限文件加载，不能写入 Git、命令参数、日志或报告。配置 purpose 保持 synthetic-acceptance，本地 C04 和同库 referenceGuard 复用原工厂。

按显式 initialize → 正式授权/资料预置 → 审核发布业务配置 → 精确检索构建和门禁 → API/Worker → HTTPS Web 顺序运行。start 不执行迁移/引导；provision 的原身份重放保留已有密码、回执与事实。原容器和数据不覆盖、不批量清理；新隔离实例输入必须具备实际身份，不用示例值冒充批准值。

模型配置继续前置 D-23 的 MiniMax schema-prompt/low 与指定 Ollama 原生 Embedding；预算不能因为模型失败增加。服务/资料无资格或必需 OCR 缺失记 BLOCKED。mTLS adapter 工程测试不证明正式远程宿主 ready，相关实施与实机义务登记为 C38 F-03。

### D-27. 资料转换资格作为真实前置

以 adopt-mineru-document-ingestion 的官方协议、真实 C04 原响应、新资料版本、来源定位和关键字段质量为输入。读取 references/acceptance/mineru-v2/manifest.json、acceptance-report.json 和 local-benchmark-report.md：V2 五格式及试运行扫描已有源字段/关联/页码合格证据，复用该资格后仍需在本次宿主完成正式资料登记及新转换。官网和自托管证据分开；XLSX/CSV 保持原生解析。V1 扫描缺字段与原分页错误不通过改标签解决。

可先独立验证合格文本/结构化链路，本次正式扫描转换缺项仍记录 BLOCKED，完整范围不能 PASS。expected/scenarios/相关性标签和报告不进入模型。合成现场及检索材料固定五工序、六类机理及已批准约束，本地标识只经真实回执替换，不直接 SQL 播种业务结果。

### D-28. Electron 证据复用同一 HTTPS 和业务身份

当前可用平台以已构建主进程启动 Electron，复用应用 HTTPS 与正式 API，不要求正式安装包或签名。扩展 client.spec.ts 与其 acceptance 预检，使共享对象/独立会话、登录、授权上传下载、撤权、证书拒绝、越界导航、SSE 游标重连和窗口关闭后任务继续均有真实断言及失败 trace。

上传按原页面可用性及正式 provision/C04/C11 入口建立前置，不新增上传 HTTP 或假按钮；文件选择/上传仍受服务端权限。测试不能注入 Cookie/业务结果替代真实登录，不允许 ignoreHTTPSErrors、关闭 sandbox 或 Node 集成。重连不自动重发写命令，原人工确认和幂等身份不变。断网/证书/撤权测试只影响隔离实例和当前 Electron session。

桌面验收 JSON 是测试宿主输入，在 acceptance.mjs 以已有 Zod 定义 strict 结构：schemaVersion="1"、releaseId、projectId、loginName、passwordSecretFile、administratorLoginName、administratorPasswordSecretFile、functionalConfigFile、sharedObjectUrl、downloadArtifactRef、invalidCertificateOrigin、unapprovedOrigin。downloadArtifactRef 复用原 ArtifactRefV1Schema，URL 只限隔离验收目标；sharedObjectUrl 必须属于批准 HTTPS origin，两个拒绝目标须与批准 origin 不同。密码按前置受限文件加载规则读取，报告仅保留引用；不以此配置改变桌面产品或授权契约。任务/运行引用只从 functionalConfigFile 对应的同次正式回执读取。预检拒绝缺项、错工程/发布、非法链接/秘密和非 HTTPS 输入，不增加可任意执行的步骤或 HTTP 操作。

### D-29. 正式终态和可见交互各自取证

复用 synthetic.mjs 的 check/run、固定命令和 checkpoint；functional.mjs 只用 query 模式、显式 maxQueries/pollInterval/timeout 和同次 run 回执。expectedTerminalStatus 与 requiredReferences 不能通过缩减范围避开关键场景。报告保存正式对象、模型/策略/审计/C04 引用、输入身份、命令和失败类别，不保存秘密、Cookie、原始资料正文或思考内容。

覆盖资料/知识/检索 → RI-S57 → 确定性收口/人工复核 → 标准化风险 → 评估/预警 → 建议/人工决定 → 执行反馈，补会话流、拒权、错版本/空间、原身份重试、任务失败与预算耗尽。submitted、awaiting-human、超时、缺引用不能通过；人工发布、采纳与校准由正式确认完成，Agent 不代批。

可见外部 Chrome 访问实际同源 HTTPS，记录真实人工确认、页面和跨页精确追溯；可用 CDP 驱动可见窗口。headless browser harness 仅工程回归。服务重启、回执失败重投、损坏拒绝和索引重建在隔离环境按原契约取证；恢复必须新根、完整核验、确认后切换，不能覆盖原实例。不会把同机副本称为独立备份。

本次工程 browser 的慢读/工程切换场景复验在“切工程须中止在途读取”断言失败（aborted=0），已重试仍失败；测试用固定 26 秒等待后切工程，未先证明切换瞬间存在在途请求。此回归缺口由 IP-21 接续：先核对前置是否成立，测试以可观察在途请求建立场景，再按原单在途/上下文取消契约判断实现。不删除取消断言或放宽并发峰值，也不在没有复现依据时宣称产品缺陷。

同次重评启动场景也在确认按钮点击处失败，trace 显示按钮在视口之外。IP-21 在原确认组件与样式边界内核对长信封/有限视口下的实际可操作性，以自然点击、滚动和键盘完成原确认；不使用 force 点击或增大超时绕过。复用该场景及现有焦点/取消断言，不锁定 CSS 或布局细节。

### D-30. 验收与交付分阶段，不放宽门禁

IP-22 汇总每个 Requirement/Scenario/IP 的工程与实跑证据，必要限定审计为 security、persistence、integration，性能审查只覆盖流/轮询及原硬预算。主调度在已有授权下形成真实 Git 检查点后由 Finalizer 核验及修复，随后写本 change verification；每项实际缺陷、缺证据或待审计阻止 PASS。

当前工程命令为 pnpm verify、pnpm test:browser、pnpm test:deployment；API/Worker 编译保留 8 GiB NODE_OPTIONS。已归档规格严格校验的旧失败属于前置工程门禁，不自动去掉 strict 或顺手改写他人规格。执行时以实际结果分类，并由对应规格责任范围修复后才能声明全仓门禁通过。

正式 signing、安装矩阵、禁网三 VM、远程 host、真实 smoke/benchmark、4090/MinerU GPU 和合同材料由 C38 F-ID 独立规划取证。后续功能 delta 在前置工程 change 已同步后归档，避免重复 ADD 或提前替换不存在的主规格。

## Risks / Trade-offs

- 当前真实环境和批准输入未齐，规划 apply-ready 不表示可以直接声明业务 PASS。
- 扫描质量前置失败会阻塞完整功能报告，不能把局部文本运行当作完整通过。
- V2 parser 合格仍需本次正式 C04/C11 新版本，不能沿用临时报告中的工件身份。
- 网络服务版本、使用量与可用性必须按本次事实复验，旧 smoke 不能证明当前业务运行。
- dirty 前置实现需要独立检查点；本轮不提交、不修改编排状态。

## Migration Plan

1. 固定并核对前置实现和本规划基线；正式模块/主规格按前置 change 归档同步顺序消费。
2. 完成 IP-17 的来源和环境、IP-18 Electron 场景；依赖合格转换后运行 IP-19–IP-21。
3. IP-22 完成报告、门禁、检查点、Finalizer 和一次必要限定审计；最后才归档。
4. C38 消费 F-01–F-05 和两个 change 的真实证据，按最终制品重新取证。

## Open Questions

无影响实现契约的开放技术问题。实际环境、秘密、资料资格和人工批准是执行输入；缺项记录 BLOCKED，不填默认值。
