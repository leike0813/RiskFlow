# Implementation Plan

## 1. 实施基线与权威来源

固定规划 base commit：`b6e39eb41e9cc8b0c9840f6f58057155eb37de54`。前置 `deliver-offline-private-deployment-and-operations` 的 IP-01–IP-16 已有工作区实现，尚未全部提交；handoff.md 登记来源与实时状态。apply-ready 表示设计和施工图闭合，不表示已形成角色交接检查点。实施前审阅前置 dirty paths 并按授权形成实际检查点，若语义漂移回到 design 处理。

权威输入：本 change proposal、两个 delta、design D-25–D-30、tasks、handoff；前置 D-20–D-24/施工图/verification、相关已归档规格；MinerU V2 的真实合格样例与独立报告。模块 DTO、权限和事务沿既有事实源，不重新解释研究原文。

IP-17–IP-22 不与前置 IP 混淆。顺序为 IP-17 → IP-18/IP-19 → IP-20 → IP-21 → IP-22。C38 F-01–F-05 为阶段移交，非当前功能 task；其场景也映射到具体移交和原 IP，未执行不计通过。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-17 | scripts/deployment/start.mjs 的 loadDeploymentFoundationInputV1、initializeDeploymentV1 所在 initialization.ts、createDeploymentScoringGovernanceV1；composition/identification.mjs 的 createDeploymentAcceptanceRoutesV1；composition/risk-flow.mjs 的 createDeploymentRiskSpatialPairingV1 | 正式初始化、配置/权限/来源准备及精确读取；runtime 创建前使用已冻结策略 | 不直接写 SQL、第二来源目录或默认版本 |
| IP-18 | apps/desktop/test/e2e/client.spec.ts、acceptance.mjs；playwright.desktop.config.ts；apps/desktop/src/main.ts | 扩展测试宿主预检和真实 Electron 场景，复用批准 HTTPS | 不复制业务 UI、授权、Cookie 或任务状态 |
| IP-19 | start.mjs 的 createDeploymentGraphsV1/createDeploymentApiV1/createDeploymentWorkerV1/mainDeploymentV1；provision.mjs 的 runProvisionV1；synthetic.mjs 的 checkPack/runPack | 真实业务运行、正式人工确认、五类共享任务与原版本/预算 | 不重写组合、不增加任务定义 |
| IP-20 | functional.mjs 的 FunctionalAcceptanceConfigV1Schema、runFunctionalAcceptance、terminalStatusOfV1、requiredReferencesOfV1、synthetic.mjs 的 createReadOnlyQuerySession | 现有三类正式观察及同次结果身份核验，安全报告引用完整链；其他领域事实用既有正式查询留证 | 不用任意查询终态猜测或重新计算预期结果 |
| IP-21 | apps/web/test/browser 既有真实 HTTP/PostgreSQL harness；workflow adapter 的 readEventParentRun/verifyEventConsumption；risk-flow/runtime.ts；backup.mjs/restore.mjs | 工程回归与可见 Chrome 分开；实跑原身份重试、重启及隔离恢复 | 不把单独输入/路由、running/cancelled 或空查询当消费成功 |
| IP-22 | deployment/ACCEPTANCE.md、OPERATIONS.md；前置与本 change 证据 | 最终索引、主仓库门禁、检查点及 Finalizer/一次限定审计 | 不修改执行图或通过文档掩盖失败 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-17 | 1.1–1.2 | 功能验收必须证明正式来源与完整宿主 | start.mjs、三个 composition 文件、所属评分/风险输入 adapter；§7 精确清单 | 原真实来源补证，配置/清单/目录/工程绑定核对；只在现有路径修复范围内缺陷 | D-25/D-26：公共 DTO、最小权限、真实发布成员 |
| IP-18 | 2.1–2.2 | 桌面功能验收与正式离线发布分阶段的当前功能部分 | desktop e2e 两文件、Playwright 配置 | D-28 测试输入 strict 校验；实现八类真实场景和失败 trace；实跑当前平台 | 产品主进程安全、会话、TLS 和服务端授权 |
| IP-19 | 3.1–3.2 | 联网推理完成业务链路；三类正式来源贯通原业务链 | provision/synthetic/start、批准配置及安全运行工件 | 同次正式资料、配置审核/发布、检索、识别/复核、评估/预警、处置/决定、执行反馈；旧工件不能改标签 | D-27/D-29：原权限、预算、人工确认、版本和链路 |
| IP-20 | 4.1–4.2 | 功能报告必须对应同次正式终态与可见交互 | functional/synthetic 及测试、functional-run-config.example.json、evidence/ | 完整实际观察配置和结果链报告；保留等待/超时/缺引用/取消/拒权失败；仅必要时修原观察器 | 原 submitted 语义、查询白名单与安全报告 |
| IP-21 | 5.1–5.3 | 可见业务交互；重启与回执故障重投；兼容回退/损坏拒绝 | Web 生产 HTTPS、原 runtime/消费/恢复程序及对应测试 | 可见 Chrome 业务与当前 Electron 结果对齐；隔离故障注入和正式恢复证据 | D-29：确认/幂等、取消零写、保留原实例与双根 |
| IP-22 | 6.1–6.3 | 当前功能与最终交付分阶段；目标环境未齐时工程检查 | 手册、证据索引、tasks；verification 仅 Finalizer | 全仓门禁、固定检查点、逐场景报告和限定审计；保持 F-01–F-05 | D-30：没有待审计/缺证据的 PASS |

## 4. 调用与副作用顺序

1. 核验基线、release/code/migration/purpose、秘密文件、批准服务与策略；任何缺项在业务监听/写入前失败。保留旧容器、数据和账号，采用新的隔离实例。
2. 显式初始化 → C06 登录及管理授权 → 原 C04/C11 预置 → 新转换/资料段 → 业务配置待审 → 正式 C07/C16 发布 → 按真实回执绑定知识及检索代际。
3. 完成全部 provider/一次绑定环/五类 registry，启动独立 API/Worker、Caddy 静态生产构建和同源 HTTPS；真实模型/检索门禁不能被空轮询代替。
4. 原冻结命令及 task 预算推进图；模型候选进入确定性校验。按原人工确认提交复核/发布/采纳，不用配置自述的审核状态代替。
5. 原 query 会话观察精确同次任务/运行；业务、C04、审计和端到端链逐项核对。超时和人审保持原身份续接，取消不补造终态。
6. 可见 Chrome 和 Electron 从真实会话读取同一对象；断网/重连不重发写命令；关闭窗口不改变服务端已受理任务。
7. 故障仅在隔离实例：事实提交后回执失败重投 → 当前授权和已提交阶段事实复验 → 原短事务回执；备份全停写/全授权 → 新根恢复/完整核验 → 人工确认切换。失败不删除原根。
8. 安全报告与引用索引耐久保存，工程检查完成后按授权形成固定检查点，再由 Finalizer/必要 Auditor 形成 verification。

## 5. Schema、状态与持久化落实

生产 Schema、错误码、图状态、C03/C04/C06/C08/C19 事务和版本全部复用，数据库最终迁移仍为 000058。本 change 不增加生产迁移、表、第二引用登记或业务公开字段。三类终态观察：Agent 任务详情、识别运行详情、运行总览投影；Unsupported DTO 保持 BLOCKED。全链其他引用从正式所属查询与已登记关系逐项证明，不给任意 query 添加通用 status 判定。

唯一新增测试宿主 Schema 按 D-28，位于 desktop e2e acceptance.mjs，不进入产品 DTO。只读配置/报告及新证据写入新文件；秘密文件不提交，模型/资料原始响应继续 C04 权限保护，不复制进普通 Markdown/JSON。

阶段终态仍为 PASS/FAIL/BLOCKED，原 submitted/awaiting-human 未通过语义保持。上游准备、A3 冻结或仅路由登记不能证明正式业务成立；C29 使用建议创建时精确偏差版本，当前/历史空间与权限逐读核对。

## 6. 验收证据矩阵

下表列出全部新 delta 场景；同一 Requirement 在每行以“Requirement / Scenario”识别。当前可运行证据命令编号见表后；C38 移交场景不列作本 change 完成项。

| Requirement / Scenario | IP-ID | 测试文件/前置 | 关键断言 | 可运行证据 |
| --- | --- | --- | --- | --- |
| 当前功能验收与最终部署交付必须分开收口 / 无目标硬件完成当前功能验收 | IP-22 | 当前功能全部真实报告 | 仅功能 PASS，F-ID 未计通过 | V5、V6 |
| 同上 / 网络 API 或真实业务证据缺失 | IP-19/IP-20 | functional.test.mjs；真实服务 | 缺证据非零、无替身 | V2、V4 |
| 模型与 OCR 必须离线预置并隔离资源 / 联网推理完成业务链路 | IP-19 | network-api smoke；MinerU V2/new C11 | 精确后端、预算、C04/正式结果 | V3、V4 |
| 同上 / 预置服务身份与真实协议匹配 | IP-22 → C38 F-03/F-04（原 IP-10/IP-14） | C38 最终模型/OCR介质 | 真实离线协议与资源证据，未执行 | 当前仅 V6 移交核对；实际执行命令须 C38 规划闭合 |
| 同上 / OCR 饱和或崩溃 | IP-19/IP-21；本地 GPU 影响交 F-04 | 真实功能 OCR；原预算 | 原任务失败，其他模型任务不改身份/预算 | V4；按原服务控制在隔离实例注入故障 |
| 同上 / 模型制品或资源证明缺失 | IP-22 → C38 F-03/F-04 | 精确介质与宿主 | 缺项不称最终交付 | V6；真实制品取证留 C38 |
| 发布回退与目标环境验收必须有真实证据 / 兼容版本回退 | IP-21 | backup/restore tests；隔离实例 | 原精确确认、保留事实/根 | V1、按 OPERATIONS.md 的原回退命令实跑 |
| 同上 / 不兼容回退或缺少真实证据 | IP-20/IP-21 | restore.test.mjs、functional.test.mjs | 不换旧镜像补数据，不用 skip | V1、V2、V4 |
| 同上 / 在批准目标硬件形成基准 | IP-22 → C38 F-04 | 4090/128GB与辅助 GPU | 实测资源/性能，未执行 | V6；真实 benchmark 先由 C38 实现 |
| 同上 / 目标环境未齐时完成工程检查 | IP-22 | 全仓工程及当前功能报告 | 最终硬件不阻塞已完整功能；当前缺证据仍阻塞 | V5、V6 |
| 功能验收必须证明正式来源与完整宿主 / 三类正式来源贯通原业务链 | IP-17/IP-19 | policies-readers/assessment/risk-flow tests；正式来源 | 精确 C19/C24/C30 和两阶段授权 | V1、V4 |
| 同上 / 错来源或关键服务缺失 | IP-17/IP-19 | 相同套件及拒权场景 | 无权/错版/异空间失败、无默认值 | V1、V4 |
| 功能报告必须对应同次正式终态与可见交互 / 同次业务与可见浏览器具有完整证据 | IP-20/IP-21 | functional + 可见 Chrome | 同次链路、正式确认、安全双向追踪 | V4、V5 中 browser；另实际可见窗口证据 |
| 同上 / 人审等待或观察证据不完整 | IP-20 | functional.test.mjs；真实等待 | 非零且原身份续接、不代批 | V2、V4 |
| 同上 / 重启与回执故障重投 | IP-21 | workflow/risk-flow runtime/consumer tests；实际隔离故障 | 复验当前权限和已提交事实，效果不重复 | V1、V4；SIGTERM 后同发布原身份启动 |
| 桌面功能验收与正式离线发布分阶段 / C38 无公网环境安装正式客户端 | IP-22 → C38 F-01/F-02 | 三平台正式包/签名 | 逐平台真实安装，未执行 | V6；最终 package/e2e 命令由 C38 规划 |
| 同上 / 当前功能验收与 C38 平台证据缺失 | IP-18/IP-22 | 当前平台完整 Electron | 当前桌面特有行为实跑，未来不冒称通过 | V7、V6 |
| 同上 / 兼容界面更新与正式平台证据 | IP-18/IP-22 → F-01/F-02 | 同 HTTPS 界面更新 | 无 UI 副本/自动升级，缺签名不制正式包 | V7、V6 |

- **V1**：`pnpm test:deployment`，以及 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts`。
- **V2**：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`。
- **V3**：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`；完整 MinerU 资格按其 V2 真实 smoke 配置与 manifest，不复用 V1 失败件。
- **V4**：`node scripts/deployment/start.mjs --role api|worker --config <实际部署配置> --manifest <同发布清单>`（role 实际逐个选）；`node scripts/deployment/provision.mjs --config <真实预置配置> --output <新预置报告>`，部署配置与同发布清单分别由 RISKFLOW_DEPLOYMENT_CONFIG/RISKFLOW_RELEASE_MANIFEST 传路径；`node scripts/acceptance/functional.mjs --pack <批准包> --config <真实functional配置> --output <新证据目录> [--resume]`。秘密只走文件。
- **V5**：`NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`；工程命令不等于 V4/可见交互通过。
- **V6**：核对 handoff.md 原任务/IP/F-ID、实际 Git 检查点、全部场景报告与必要审计，`pnpm exec openspec validate complete-private-deployment-functional-acceptance --strict --no-interactive`。
- **V7**：`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm exec playwright test -c playwright.desktop.config.ts`；无签名包亦必须有真实 Electron、受信任 HTTPS 与完整场景，关键 skip 不通过。

## 7. 文件清单与升级条件

| IP-ID | 新增/修改文件 | 动作 |
| --- | --- | --- |
| IP-17 | deployment/config.example.json、model-gateway-config.example.json；start.mjs；composition/identification.mjs、assessment.mjs、risk-flow.mjs；entrypoints.test.mjs、assessment-composition.test.mjs、risk-flow-composition.test.mjs；packages/adapters/test/deployment/policies-readers.test.ts | 示例维持真实结构；核对来源/装配并修范围内行为，不写实际秘密或生产策略进示例 |
| IP-17/IP-19 | scripts/deployment/provision.mjs、provision.test.mjs；packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts、src/identification/read/postgres-standardized-risk-input-facts-reader.ts 及对应既有 tests | 沿原 C19/C30 接缝修来源缺陷（仅出现可复现缺陷时），不新增公开契约 |
| IP-18 | apps/desktop/test/e2e/acceptance.mjs、client.spec.ts；playwright.desktop.config.ts | D-28 输入与完整场景、trace；已有测试扩展，不增加产品 UI |
| IP-19/IP-20 | scripts/acceptance/synthetic.mjs、synthetic.test.mjs、functional.mjs、functional.test.mjs；deployment/functional-run-config.example.json | 复用正式操作与三类观察，补必要程序缺陷及完整配置示例 |
| IP-21 | scripts/deployment/composition/risk-flow.mjs、risk-flow-composition.test.mjs；packages/adapters/src/workflow/postgres-workflow-adapter.ts、test/workflow/postgres-workflow-adapter.test.ts；apps/worker/src/risk-flow/runtime.ts、test/risk-flow/runtime.test.ts | 原因果定位/消费证明/短事务回执的范围内缺陷与回归 |
| IP-21 | scripts/deployment/backup.mjs、backup.test.mjs、restore.mjs、restore.test.mjs、lifecycle.mjs、lifecycle.test.mjs | 有界停写/重启/恢复的范围内缺陷，保留原权限/事务/双根 |
| IP-21 | apps/web/test/browser/agent-audit-operations.spec.ts；apps/web/src/pages/AgentWorkbenchPage.tsx | 闭合本次慢读/切工程回归缺口；先修测试前置确定性，只有证实原取消/单在途契约缺陷时才修既有 owning 页面 |
| IP-21 | apps/web/test/browser/assessment-warning-response.spec.ts；apps/web/src/shared/CommandConfirmationDialog.tsx；apps/web/src/components/ConfirmButton.css | 闭合重评长信封确认按钮视口外不可点击的回归缺口；核对原组件/样式的有界滚动与自然操作，保留原确认、焦点、取消及冻结信封契约 |
| IP-22 | deployment/ACCEPTANCE.md、OPERATIONS.md；本 change tasks.md、handoff.md；新增本 change evidence/ 下安全报告和证据索引；verification.md 仅 Finalizer | 只记录真实命令、终态/引用、失败和阶段移交；受保护原响应仍 C04 |

实际部署/运行/秘密配置位于受控实例目录，不提交真实秘密。删除文件：无。保护：AGENTS 关键约束、全部归档规格/历史迁移、锁文件、执行图/Orca、研究原件、用户 dirty 改动、发布定义/预算/人工决定、前置 change 工程验收范围、MinerU 独立责任边界。

新公共字段、迁移、权限、事务、依赖、范围外文件、前置语义漂移或 CLI 不存在须升级并补 design；现有批准路径内普通缺陷在当前任务修复。没有对应修复需要时不为文案、提示词、DOM/CSS 或实现顺序补测试。实际环境缺项保留 BLOCKED，不删除关键断言或增加默认值。

## 8. 验收 Agent 授权与限定审计

全部当前 tasks 的行为和工程/真实证据均完成后，主调度按授权形成真实检查点，再交 Finalizer。Finalizer 基于本矩阵核验、范围内修复、回归及创建 verification，不改规格掩盖缺陷。security（秘密/联网资格/TLS/Electron）、persistence（原始响应/审计/检查点/恢复）、integration（来源/五任务/终态/人工确认）与必要的有界 performance 审计在同一收尾最多一次；发现普通缺陷由该活动 Task 闭合，不重复派发新审计。

未通过当前证据、待审计或主仓库门禁失败不得 PASS。C38 的未来物理平台/介质/硬件场景只登记移交状态，不能当作本 change 已通过任务，也不能用其缺项掩盖当前功能缺陷。
